// ─────────────────────────────────────────────────────────────────────
// /api/share — Liens de présentation publics (Phase 2 SaaS, v6.80).
//
// Crée des snapshots LECTURE SEULE (mémo d'IC, plus tard fiches)
// accessibles par URL tokenisée, expirables — pour envoyer à un
// bailleur, une banque, FP France… sans compte ni accès à l'outil.
//
//   POST { user, title, html, days? } → { ok, url, expiresAt }
//        (auth transition: whitelist legacy OU cookie session admin/editor)
//   GET  ?t=<token>                   → page HTML lecture seule (bannière
//        "document partagé" injectée, noindex), 410 si expiré.
//
// Storage : KV `fp:v2:share:<token>` TTL n jours (défaut 30, max 90).
// Cap 300 KB par document. Les visualisations restent statiques (le
// mémo est autonome, sans scripts).
// ─────────────────────────────────────────────────────────────────────

const crypto = require('crypto');

const KV_URL   = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const APP_URL  = process.env.APP_URL || 'https://fitnesspark.isseo-dev.com';

const ALLOWED_USERS = new Set([
  'paulbecaud@isseo-dev.com',
  'pbecaud@isseo-dev.com',
  'ulysse.gaspard0@gmail.com',
  'tomescumh@yahoo.com',
]);

async function kvGet(key) {
  const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${KV_TOKEN}` } });
  if (!r.ok) throw new Error(`KV GET ${r.status}`);
  const j = await r.json();
  return j.result ? JSON.parse(j.result) : null;
}
async function kvSet(key, value, ttlSec) {
  const r = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}?EX=${ttlSec}`, {
    method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'text/plain' }, body: JSON.stringify(value),
  });
  if (!r.ok) throw new Error(`KV SET ${r.status}`);
}

// Session cookie (miroir de api/auth.js — clé HMAC = KV_TOKEN)
function readSession(req) {
  try {
    const c = (req.headers.cookie || '').split(/;\s*/).find(x => x.startsWith('fp_session='));
    if (!c) return null;
    const [payload, sig] = c.slice('fp_session='.length).split('.');
    const expect = crypto.createHmac('sha256', KV_TOKEN).update(payload).digest('base64url');
    if (sig !== expect) return null;
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (Date.now() > s.x) return null;
    return { email: s.e, role: s.r };
  } catch { return null; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', APP_URL);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (!KV_URL || !KV_TOKEN) { res.status(503).json({ error: 'KV_NOT_CONFIGURED' }); return; }

  try {
    // ── GET : rendu public lecture seule ──────────────────────────
    if (req.method === 'GET') {
      const token = String(req.query?.t || '');
      const doc = /^[a-f0-9]{32,64}$/.test(token) ? await kvGet(`fp:v2:share:${token}`) : null;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      res.setHeader('Cache-Control', 'no-store');
      if (!doc) {
        res.status(410).end(`<!DOCTYPE html><meta charset="utf-8"><title>Lien expiré</title>
<body style="font-family:-apple-system,sans-serif;background:#0a0f1c;color:#e2e8f0;display:grid;place-items:center;min-height:100vh;margin:0">
<div style="text-align:center;padding:24px"><div style="font-size:40px">⏳</div>
<h2 style="margin:12px 0 6px">Ce lien a expiré ou n'existe pas</h2>
<p style="color:#94a3b8;font-size:14px">Demandez un nouveau lien à l'équipe Isseo.</p></div>`);
        return;
      }
      // Bannière lecture seule injectée dans le document snapshotté
      const banner = `<div style="position:sticky;top:0;z-index:9999;background:#0a0f1c;color:#fbbf24;font-family:-apple-system,sans-serif;font-size:12px;font-weight:700;padding:9px 16px;display:flex;justify-content:space-between;align-items:center;letter-spacing:.3px">
        <span>📄 Document partagé en lecture seule — Expansion Intelligence · Isseo</span>
        <span style="color:#64748b;font-weight:500">expire le ${new Date(doc.expiresAt).toLocaleDateString('fr-FR')}</span></div>`;
      let html = String(doc.html || '');
      html = html.includes('<body') ? html.replace(/<body([^>]*)>/i, `<body$1>${banner}`) : banner + html;
      if (!/name="robots"/i.test(html)) html = html.replace(/<head([^>]*)>/i, `<head$1><meta name="robots" content="noindex,nofollow">`);
      res.status(200).end(html);
      return;
    }

    // ── POST : création d'un lien ─────────────────────────────────
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      // Auth transition : session cookie (admin/editor) OU whitelist legacy
      const session = readSession(req);
      const legacyUser = String(body.user || '').toLowerCase().trim();
      let allowed = ALLOWED_USERS.has(legacyUser);
      if (!allowed && session) {
        // v6.87 — révocation immédiate : rôle relu dans l'annuaire VIVANT
        const dir = await kvGet('fp:v2:directory').catch(() => null);
        const u = dir && dir[session.email];
        allowed = !!(u && !u.disabled && ['admin', 'editor'].includes(u.role));
      }
      if (!allowed) { res.status(403).json({ error: 'FORBIDDEN' }); return; }

      const html = String(body.html || '');
      if (!html || html.length < 100) { res.status(400).json({ error: 'EMPTY_DOC' }); return; }
      if (html.length > 300 * 1024) { res.status(413).json({ error: 'DOC_TOO_LARGE' }); return; }
      const days = Math.min(90, Math.max(1, parseInt(body.days, 10) || 30));
      const token = crypto.randomBytes(20).toString('hex');
      const expiresAt = Date.now() + days * 864e5;
      await kvSet(`fp:v2:share:${token}`, {
        title: String(body.title || 'Document').slice(0, 120),
        html, by: session?.email || legacyUser, ts: Date.now(), expiresAt,
      }, days * 86400);
      res.status(200).json({ ok: true, url: `${APP_URL}/api/share?t=${token}`, expiresAt, days });
      return;
    }

    res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  } catch (e) {
    console.error('[api/share] error:', e);
    res.status(500).json({ error: 'INTERNAL', message: String(e.message || e) });
  }
};
