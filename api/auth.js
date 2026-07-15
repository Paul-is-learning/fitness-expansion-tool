// ─────────────────────────────────────────────────────────────────────
// /api/auth — Authentification serveur (Phase 2 SaaS, v6.80).
//
// Magic link email (zéro mot de passe) + sessions signées + annuaire
// utilisateurs avec RÔLES, sur l'infra existante (Upstash KV).
//
// Actions (POST JSON sauf mention) :
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

function makeSessionCookie(email, role, ws) {
  const payload = b64u(JSON.stringify({ e: email, r: role, w: ws, x: Date.now() + SESSION_DAYS * 864e5 }));
  const value = payload + '.' + sign(payload);
  return `fp_session=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
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
      if (!u) { res.status(403).json({ error: 'REVOKED' }); return; }
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
      const s = readSession(req);
      if (!s || s.role !== 'admin') { res.status(403).json({ error: 'ADMIN_ONLY' }); return; }
      const email = String(body.email || '').toLowerCase().trim();
      const role = ['admin', 'editor', 'viewer'].includes(body.role) ? body.role : 'viewer';
      if (!email.includes('@')) { res.status(400).json({ error: 'BAD_EMAIL' }); return; }
      const dir = await getDirectory();
      dir[email] = { name: String(body.name || email.split('@')[0]).slice(0, 60), role, ws: s.ws || 'fp-romania' };
      await kvSet(DIR_KEY, dir);
      res.status(200).json({ ok: true, count: Object.keys(dir).length });
      return;
    }

    // ── directory (admin) ─────────────────────────────────────────
    if (action === 'directory') {
      const s = readSession(req);
      if (!s || s.role !== 'admin') { res.status(403).json({ error: 'ADMIN_ONLY' }); return; }
      res.status(200).json({ ok: true, directory: await getDirectory() });
      return;
    }

    res.status(400).json({ error: 'UNKNOWN_ACTION' });
  } catch (e) {
    console.error('[api/auth] error:', e);
    res.status(500).json({ error: 'INTERNAL', message: String(e.message || e) });
  }
};
