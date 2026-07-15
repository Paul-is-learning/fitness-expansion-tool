// ─────────────────────────────────────────────────────────────────────
// /api/auth — Authentification serveur (Phase 2 SaaS, v6.80 · v6.87).
//
// v6.87 : login mot de passe côté serveur (scrypt) + gestion des
// utilisateurs (CRUD admin) + recover par phrase. Le magic link reste
// disponible (dormant tant que RESEND_API_KEY n'est pas posée).
//
// Actions v6.87 (POST JSON) :
//   { action:'login', email, password, stay }
//                                      → vérifie scrypt, pose le cookie
//                                        (365 j si stay, sinon 1 j).
//   { action:'recover', email, phrase, password }
//                                      → phrase de récupération OK ⇒
//                                        nouveau mot de passe.
//   { action:'set-password', password, current?, email? }
//                                      → soi-même (current requis) ou
//                                        admin (email cible).
//   GET ?action=users                  → ADMIN : liste sans empreintes.
//   { action:'user-save', email, name, role, password?, disabled? }
//                                      → ADMIN : créer/modifier.
//   { action:'user-delete', email }    → ADMIN : supprimer (garde-fous
//                                        self / dernier admin).
//
// Actions historiques (magic link, v6.80) :
//   { action:'request', email }        → envoie le lien magique (Resend).
//                                        Sans RESEND_API_KEY → 503 explicite.
//   GET ?action=verify&token=...       → valide le token (TTL 15 min),
//                                        pose le cookie de session (30 j),
//                                        redirige vers /.
//   GET ?action=me                     → { user, role, workspace } ou 401.
//   { action:'logout' }                → efface le cookie.
//   { action:'invite', email, role, name }
//                                      → ADMIN uniquement : ajoute un
//                                        utilisateur à l'annuaire.
//   GET ?action=directory              → ADMIN : liste l'annuaire.
//
// Sessions : cookie httpOnly `fp_session` = base64url(payload).HMAC-SHA256.
// Clé HMAC = KV_REST_API_TOKEN (secret serveur déjà présent — pas de
// nouvelle env var). Rotation du token KV = invalidation des sessions.
//
// Annuaire : KV `fp:v2:directory` = { [email]: {name, role, ws} }.
// Rôles : admin | editor | viewer. Workspace unique 'fp-romania' pour
// l'instant (multi-tenant : la clé ws est déjà partout).
//
// NOTE transition : les endpoints data (/api/sync, /api/audit…) gardent
// leur compat legacy (body.user) tant que le client n'a pas basculé.
// ─────────────────────────────────────────────────────────────────────

const crypto = require('crypto');

const KV_URL   = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM_EMAIL || 'Expansion Intelligence <onboarding@resend.dev>';
const APP_URL = process.env.APP_URL || 'https://fitnesspark.isseo-dev.com';

const DIR_KEY = 'fp:v2:directory';
const SESSION_DAYS = 30;
const LINK_TTL_SEC = 15 * 60;

// Annuaire initial (bootstrap idempotent) — miroir des users actuels.
const BOOTSTRAP = {
  'paulbecaud@isseo-dev.com':  { name: 'Paul Becaud',    role: 'admin',  ws: 'fp-romania' },
  'pbecaud@isseo-dev.com':     { name: 'Paul Becaud',    role: 'admin',  ws: 'fp-romania' },
  'ulysse.gaspard0@gmail.com': { name: 'Ulysse Gaspard', role: 'editor', ws: 'fp-romania' },
  'tomescumh@yahoo.com':       { name: 'Tomescu MH',     role: 'editor', ws: 'fp-romania' },
};

// ─── v6.87 — Mots de passe côté serveur (scrypt) ─────────────────────
// Format stocké : "s2$<salt b64url>$<scrypt-32o b64url>" (N=16384,r=8,p=1).
// Empreintes seed = mots de passe ACTUELS des 4 comptes → zéro migration :
// chacun se connecte avec son mdp habituel, l'admin peut changer ensuite.
// Une entrée `pw` dans l'annuaire KV prime toujours sur le seed.
const SEED_PW = {
  'paulbecaud@isseo-dev.com':  's2$7kcEtNbh1dDtuTbCDvvL3A$WVmJ18CEQa4pBunxkFwdlzzIBW7ZfFDU9btGL6Yjemo',
  'pbecaud@isseo-dev.com':     's2$jgCjZqfjE1i-rijmO1MF2g$vVvOjpTbDLWdHxL0dE1VuKMj7Cc0RJxk0vvt0Yj0lvM',
  'ulysse.gaspard0@gmail.com': 's2$uFQAdqoTIGMLAPHqg4x1NQ$XvWT9JSTNjYAhkPQ3S_TIM3v5qrTsxMy2smCEqe6MM8',
  'tomescumh@yahoo.com':       's2$UGZuBWMp0suHHKMOjsJB8w$JKL1MQkDU6_vC0J-GDHVAWB5IPPl6PfUmZUQHqhda8Q',
};
// Phrase de récupération ("Mot de passe oublié ?") — même mécanique.
const SEED_REC = {
  'paulbecaud@isseo-dev.com': 's2$VeSsTJ3lQoJNvuESvQ--Tw$PDza8vpSBbIUvbs77KAYllqocIXu1jujz5jW0igi76M',
  'pbecaud@isseo-dev.com':    's2$zsV_JQrBC6HwSnIF-o1fhQ$OSFCNKQgrBSnFfjkJUDveAAkMjkqNBkTXaleYWX74RA',
};

function hashPw(pw) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const hash = crypto.scryptSync(String(pw), salt, 32, { N: 16384, r: 8, p: 1 }).toString('base64url');
  return `s2$${salt}$${hash}`;
}
function verifyPw(pw, stored) {
  try {
    const [v, salt, hash] = String(stored || '').split('$');
    if (v !== 's2' || !salt || !hash) return false;
    const got = crypto.scryptSync(String(pw), salt, 32, { N: 16384, r: 8, p: 1 });
    const want = Buffer.from(hash, 'base64url');
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  } catch { return false; }
}

// ─── KV helpers ──────────────────────────────────────────────────────
async function kvGet(key) {
  const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${KV_TOKEN}` } });
  if (!r.ok) throw new Error(`KV GET ${r.status}`);
  const j = await r.json();
  return j.result ? JSON.parse(j.result) : null;
}
async function kvSet(key, value, ttlSec) {
  const url = ttlSec ? `${KV_URL}/set/${encodeURIComponent(key)}?EX=${ttlSec}` : `${KV_URL}/set/${encodeURIComponent(key)}`;
  const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'text/plain' }, body: JSON.stringify(value) });
  if (!r.ok) throw new Error(`KV SET ${r.status}`);
}
async function kvDel(key) {
  await fetch(`${KV_URL}/del/${encodeURIComponent(key)}`, { method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN}` } });
}

// ─── Sessions signées ────────────────────────────────────────────────
const b64u = b => Buffer.from(b).toString('base64url');
const sign = payload => crypto.createHmac('sha256', KV_TOKEN).update(payload).digest('base64url');

function makeSessionCookie(email, role, ws, days) {
  const d = days || SESSION_DAYS;
  const payload = b64u(JSON.stringify({ e: email, r: role, w: ws, x: Date.now() + d * 864e5 }));
  const value = payload + '.' + sign(payload);
  return `fp_session=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${d * 86400}`;
}
function readSession(req) {
  try {
    const cookie = (req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith('fp_session='));
    if (!cookie) return null;
    const [payload, sig] = cookie.slice('fp_session='.length).split('.');
    if (!payload || !sig || sign(payload) !== sig) return null;
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!s.e || Date.now() > s.x) return null;
    return { email: s.e, role: s.r, ws: s.w };
  } catch { return null; }
}

// ─── Annuaire ────────────────────────────────────────────────────────
async function getDirectory() {
  let dir = await kvGet(DIR_KEY);
  if (!dir || typeof dir !== 'object') { dir = { ...BOOTSTRAP }; await kvSet(DIR_KEY, dir); }
  return dir;
}

// v6.87 — révocation IMMÉDIATE : le rôle du cookie est figé au login
// (jusqu'à 365 j), donc chaque action privilégiée revalide l'entrée
// VIVANTE de l'annuaire (rôle actuel + non désactivé). Sans ça, un admin
// supprimé/désactivé pouvait se ré-autopromouvoir avec son vieux cookie.
async function liveSession(req) {
  const s = readSession(req);
  if (!s) return null;
  const dir = await getDirectory();
  const u = dir[s.email];
  if (!u || u.disabled) return null;
  return { email: s.email, role: u.role, ws: u.ws, dir };
}

// ─── Email magic link ────────────────────────────────────────────────
async function sendMagicLink(email, name, url) {
  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#0a0f1c;color:#e2e8f0;border-radius:16px">
    <div style="text-align:center;margin-bottom:22px">
      <div style="font-size:20px;font-weight:800;color:#fbbf24">EXPANSION INTELLIGENCE</div>
      <div style="font-size:11px;color:#64748b;letter-spacing:1px;margin-top:4px">FITNESS PARK ROMANIA · ISSEO</div>
    </div>
    <p style="font-size:14px;line-height:1.6;color:#cbd5e1">Bonjour ${name || ''},<br>clique pour te connecter — le lien est valable <b style="color:#fff">15 minutes</b> et la session dure 30 jours.</p>
    <div style="text-align:center;margin:26px 0">
      <a href="${url}" style="display:inline-block;padding:14px 30px;background:#fbbf24;color:#0a0f1c;font-weight:700;font-size:14px;text-decoration:none;border-radius:10px">Se connecter</a>
    </div>
    <p style="font-size:10px;color:#475569;word-break:break-all">Ou copie ce lien : ${url}</p>
    <p style="font-size:10px;color:#475569;margin-top:18px">Si tu n'es pas à l'origine de cette demande, ignore cet email.</p>
  </div>`;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: RESEND_FROM, to: [email], subject: 'Ta connexion — Expansion Intelligence', html }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
}

// ─── Handler ─────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', APP_URL);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (!KV_URL || !KV_TOKEN) { res.status(503).json({ error: 'KV_NOT_CONFIGURED' }); return; }

  const q = req.query || {};
  let body = {};
  if (req.method === 'POST') {
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); }
    catch { res.status(400).json({ error: 'BAD_JSON' }); return; }
  }
  const action = String(body.action || q.action || '');

  try {
    // ═══ v6.87 — LOGIN mot de passe côté serveur ═════════════════
    // Vérif scrypt (annuaire KV, seed fallback), cookie de session
    // signé. Pas de rate-limit ni lockout (choix produit assumé :
    // outil privé, Paul a explicitement demandé zéro friction).
    if (action === 'login') {
      const email = String(body.email || '').toLowerCase().trim();
      const password = String(body.password || '');
      if (!email.includes('@') || !password) { res.status(400).json({ error: 'BAD_CREDENTIALS' }); return; }
      const dir = await getDirectory();
      const u = dir[email];
      // Message identique inconnu/mauvais mdp — pas de fuite d'existence.
      if (!u || u.disabled) { res.status(401).json({ error: 'INVALID_LOGIN' }); return; }
      const stored = u.pw || SEED_PW[email];
      if (!stored) { res.status(403).json({ error: 'NO_PASSWORD', hint: 'Demandez à l’admin de définir votre mot de passe.' }); return; }
      if (!verifyPw(password, stored)) { res.status(401).json({ error: 'INVALID_LOGIN' }); return; }
      const days = body.stay === false ? 1 : 365; // "Rester connecté" coché par défaut
      res.setHeader('Set-Cookie', makeSessionCookie(email, u.role, u.ws, days));
      u.lastLogin = Date.now();
      await kvSet(DIR_KEY, dir).catch(() => {}); // best-effort (lastLogin)
      res.status(200).json({ ok: true, email, name: u.name, role: u.role, workspace: u.ws, days });
      return;
    }

    // ── recover : phrase de récupération → nouveau mot de passe ──
    if (action === 'recover') {
      const email = String(body.email || '').toLowerCase().trim();
      const phrase = String(body.phrase || '');
      const password = String(body.password || '');
      if (!email.includes('@') || !phrase || password.length < 6) { res.status(400).json({ error: 'BAD_PAYLOAD' }); return; }
      const dir = await getDirectory();
      const u = dir[email];
      const rec = (u && u.rec) || SEED_REC[email];
      if (!u || u.disabled || !rec || !verifyPw(phrase, rec)) { res.status(401).json({ error: 'INVALID_RECOVERY' }); return; }
      u.pw = hashPw(password);
      await kvSet(DIR_KEY, dir);
      res.status(200).json({ ok: true });
      return;
    }

    // ── set-password : soi-même (mdp actuel requis) ou admin ─────
    if (action === 'set-password') {
      const s = await liveSession(req);
      if (!s) { res.status(401).json({ error: 'NO_SESSION' }); return; }
      const password = String(body.password || '');
      if (password.length < 6) { res.status(400).json({ error: 'PASSWORD_TOO_SHORT', hint: '6 caractères minimum.' }); return; }
      const dir = s.dir;
      const target = String(body.email || s.email).toLowerCase().trim();
      if (target !== s.email && s.role !== 'admin') { res.status(403).json({ error: 'ADMIN_ONLY' }); return; }
      const u = dir[target];
      if (!u) { res.status(404).json({ error: 'UNKNOWN_USER' }); return; }
      if (target === s.email && s.role !== 'admin') {
        const stored = u.pw || SEED_PW[target];
        if (!stored || !verifyPw(String(body.current || ''), stored)) { res.status(401).json({ error: 'BAD_CURRENT_PASSWORD' }); return; }
      }
      u.pw = hashPw(password);
      await kvSet(DIR_KEY, dir);
      res.status(200).json({ ok: true });
      return;
    }

    // ── users (admin) : annuaire sans les empreintes ──────────────
    if (action === 'users') {
      const s = await liveSession(req);
      if (!s || s.role !== 'admin') { res.status(403).json({ error: 'ADMIN_ONLY' }); return; }
      const dir = s.dir;
      const users = Object.entries(dir).map(([email, u]) => ({
        email, name: u.name, role: u.role, ws: u.ws,
        lastLogin: u.lastLogin || null,
        hasPw: !!(u.pw || SEED_PW[email]),
        disabled: !!u.disabled,
      }));
      res.status(200).json({ ok: true, users, me: s.email });
      return;
    }

    // ── user-save (admin) : créer / modifier un utilisateur ──────
    if (action === 'user-save') {
      const s = await liveSession(req);
      if (!s || s.role !== 'admin') { res.status(403).json({ error: 'ADMIN_ONLY' }); return; }
      const email = String(body.email || '').toLowerCase().trim();
      if (!email.includes('@')) { res.status(400).json({ error: 'BAD_EMAIL' }); return; }
      const role = ['admin', 'editor', 'viewer'].includes(body.role) ? body.role : 'viewer';
      const dir = s.dir;
      const isNew = !dir[email];
      if (email === s.email && role !== 'admin') { res.status(400).json({ error: 'CANT_DEMOTE_SELF', hint: 'Impossible de retirer son propre rôle admin.' }); return; }
      if (isNew && !(typeof body.password === 'string' && body.password.length >= 6)) { res.status(400).json({ error: 'PASSWORD_REQUIRED', hint: 'Mot de passe initial requis (6 caractères min).' }); return; }
      const u = dir[email] || { ws: s.ws || 'fp-romania' };
      u.name = String(body.name || u.name || email.split('@')[0]).slice(0, 60);
      u.role = role;
      if (typeof body.password === 'string' && body.password.length >= 6) u.pw = hashPw(body.password);
      if (typeof body.disabled === 'boolean') {
        if (email === s.email && body.disabled) { res.status(400).json({ error: 'CANT_DISABLE_SELF' }); return; }
        u.disabled = body.disabled;
      }
      dir[email] = u;
      await kvSet(DIR_KEY, dir);
      res.status(200).json({ ok: true, isNew, count: Object.keys(dir).length });
      return;
    }

    // ── user-delete (admin) ───────────────────────────────────────
    if (action === 'user-delete') {
      const s = await liveSession(req);
      if (!s || s.role !== 'admin') { res.status(403).json({ error: 'ADMIN_ONLY' }); return; }
      const email = String(body.email || '').toLowerCase().trim();
      if (email === s.email) { res.status(400).json({ error: 'CANT_DELETE_SELF' }); return; }
      const dir = s.dir;
      if (!dir[email]) { res.status(404).json({ error: 'UNKNOWN_USER' }); return; }
      const admins = Object.entries(dir).filter(([e, u]) => u.role === 'admin' && !u.disabled && e !== email);
      if (dir[email].role === 'admin' && admins.length === 0) { res.status(400).json({ error: 'LAST_ADMIN' }); return; }
      delete dir[email];
      await kvSet(DIR_KEY, dir);
      res.status(200).json({ ok: true, count: Object.keys(dir).length });
      return;
    }

    // ── request : envoi du lien magique ──────────────────────────
    if (action === 'request') {
      const email = String(body.email || '').toLowerCase().trim();
      if (!email.includes('@')) { res.status(400).json({ error: 'BAD_EMAIL' }); return; }
      const dir = await getDirectory();
      // Réponse plate (pas de fuite d'existence) — mais on n'envoie qu'aux connus.
      if (dir[email]) {
        if (!RESEND_API_KEY) { res.status(503).json({ error: 'NO_RESEND_KEY', hint: 'Ajouter RESEND_API_KEY dans Vercel pour activer le magic link.' }); return; }
        const token = crypto.randomBytes(24).toString('hex');
        await kvSet(`fp:v2:magic:${token}`, { email, ts: Date.now() }, LINK_TTL_SEC);
        await sendMagicLink(email, dir[email].name, `${APP_URL}/api/auth?action=verify&token=${token}`);
      }
      res.status(200).json({ ok: true });
      return;
    }

    // ── verify : consomme le token, pose la session, redirige ────
    if (action === 'verify') {
      const token = String(q.token || '');
      const rec = token ? await kvGet(`fp:v2:magic:${token}`) : null;
      if (!rec) { res.status(410).setHeader('Content-Type', 'text/html'); res.end('<meta charset="utf-8"><body style="font-family:sans-serif;background:#0a0f1c;color:#e2e8f0;display:grid;place-items:center;height:100vh"><div style="text-align:center"><h2>Lien expiré ou déjà utilisé</h2><p>Redemande un lien de connexion depuis l\'application.</p><a href="/" style="color:#fbbf24">← Retour</a></div>'); return; }
      await kvDel(`fp:v2:magic:${token}`);
      const dir = await getDirectory();
      const u = dir[rec.email];
      if (!u) { res.status(403).json({ error: 'UNKNOWN_USER' }); return; }
      res.setHeader('Set-Cookie', makeSessionCookie(rec.email, u.role, u.ws));
      res.writeHead(302, { Location: '/' });
      res.end();
      return;
    }

    // ── me : qui suis-je (session cookie) ────────────────────────
    if (action === 'me') {
      const s = readSession(req);
      if (!s) { res.status(401).json({ error: 'NO_SESSION' }); return; }
      const dir = await getDirectory();
      const u = dir[s.email];
      if (!u || u.disabled) { res.status(403).json({ error: 'REVOKED' }); return; }
      res.status(200).json({ ok: true, email: s.email, name: u.name, role: u.role, workspace: u.ws });
      return;
    }

    // ── logout ────────────────────────────────────────────────────
    if (action === 'logout') {
      res.setHeader('Set-Cookie', 'fp_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
      res.status(200).json({ ok: true });
      return;
    }

    // ── invite (admin) : ajoute/maj un utilisateur ────────────────
    if (action === 'invite') {
      const s = await liveSession(req);
      if (!s || s.role !== 'admin') { res.status(403).json({ error: 'ADMIN_ONLY' }); return; }
      const email = String(body.email || '').toLowerCase().trim();
      const role = ['admin', 'editor', 'viewer'].includes(body.role) ? body.role : 'viewer';
      if (!email.includes('@')) { res.status(400).json({ error: 'BAD_EMAIL' }); return; }
      const dir = s.dir;
      dir[email] = { name: String(body.name || email.split('@')[0]).slice(0, 60), role, ws: s.ws || 'fp-romania' };
      await kvSet(DIR_KEY, dir);
      res.status(200).json({ ok: true, count: Object.keys(dir).length });
      return;
    }

    // ── directory (admin) ─────────────────────────────────────────
    if (action === 'directory') {
      const s = await liveSession(req);
      if (!s || s.role !== 'admin') { res.status(403).json({ error: 'ADMIN_ONLY' }); return; }
      res.status(200).json({ ok: true, directory: s.dir });
      return;
    }

    res.status(400).json({ error: 'UNKNOWN_ACTION' });
  } catch (e) {
    console.error('[api/auth] error:', e);
    res.status(500).json({ error: 'INTERNAL', message: String(e.message || e) });
  }
};
