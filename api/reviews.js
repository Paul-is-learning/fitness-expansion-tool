// ─────────────────────────────────────────────────────────────────────
// /api/reviews — Historique des review counts concurrents (v6.69).
//
// Série temporelle cross-device des compteurs d'avis Google par club,
// pour calculer la VÉLOCITÉ (avis/mois = proxy du flux de nouveaux
// membres, cf. Méthode B REVIEWS_ANNUAL_MULT).
//
// Storage KV : `fp:reviews-history` = { snapshots: [{ts, source, clubs}], ts }
//   snapshot.clubs = { "<club name>": { r: <reviewCount>, g: <rating> } }
//
// API :
//   GET  /api/reviews                    → 200 { snapshots, ts }
//   POST /api/reviews { user, snapshot } → 200 { ok, count }
//
// Règles serveur :
//   - whitelist users (identique /api/sync, /api/audit)
//   - au plus 1 snapshot conservé par fenêtre de 6 jours (anti-spam :
//     si le dernier snapshot a < 6 jours, le nouveau le REMPLACE)
//   - cap 48 snapshots (≈ 4 ans en cadence hebdo espacée), FIFO
//   - cap taille 64 KB / snapshot
// ─────────────────────────────────────────────────────────────────────

const KV_URL   = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const HISTORY_KEY = 'fp:reviews-history';
const MAX_SNAPSHOTS = 48;
const MIN_GAP_MS = 6 * 24 * 3600 * 1000; // 6 jours

const ALLOWED_USERS = new Set([
  'paulbecaud@isseo-dev.com',
  'pbecaud@isseo-dev.com',
  'ulysse.gaspard0@gmail.com',
  'tomescumh@yahoo.com',
]);

// ─── v6.81 (SaaS P2b) — dual-auth : cookie session (magic link) OU
// whitelist legacy (transition). Session éditeur/admin requise pour écrire.
const _crypto = require('crypto');
function readSession(req) {
  try {
    const c = (req.headers.cookie || '').split(/;\s*/).find(x => x.startsWith('fp_session='));
    if (!c) return null;
    const [payload, sig] = c.slice('fp_session='.length).split('.');
    const expect = _crypto.createHmac('sha256', KV_TOKEN).update(payload).digest('base64url');
    if (sig !== expect) return null;
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (Date.now() > s.x) return null;
    return { email: s.e, role: s.r, ws: s.w };
  } catch { return null; }
}
function isAuthorized(req, legacyUser, write) {
  const s = readSession(req);
  if (s) return write ? ['admin', 'editor'].includes(s.role) : true;
  return ALLOWED_USERS.has(String(legacyUser || '').toLowerCase().trim());
}


async function kvGet(key) {
  const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  if (!r.ok) throw new Error(`KV GET ${r.status}`);
  const json = await r.json();
  return json.result ? JSON.parse(json.result) : null;
}

async function kvSet(key, value) {
  const r = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'text/plain' },
    body: JSON.stringify(value),
  });
  if (!r.ok) throw new Error(`KV SET ${r.status}`);
  return r.json();
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  if (!KV_URL || !KV_TOKEN) {
    res.status(503).json({ error: 'KV_NOT_CONFIGURED' });
    return;
  }

  try {
    if (req.method === 'GET') {
      const payload = await kvGet(HISTORY_KEY);
      res.status(200).json({
        snapshots: Array.isArray(payload?.snapshots) ? payload.snapshots : [],
        ts: payload?.ts || 0,
      });
      return;
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const user = String(body.user || '').toLowerCase().trim();
      const snap = body.snapshot && typeof body.snapshot === 'object' ? body.snapshot : null;
      if (!isAuthorized(req, user, true)) { res.status(403).json({ error: 'FORBIDDEN_USER' }); return; }
      if (!snap || !snap.clubs || typeof snap.clubs !== 'object') {
        res.status(400).json({ error: 'BAD_PAYLOAD' }); return;
      }
      if (JSON.stringify(snap).length > 64 * 1024) {
        res.status(413).json({ error: 'SNAPSHOT_TOO_LARGE' }); return;
      }

      const payload = await kvGet(HISTORY_KEY);
      const snapshots = Array.isArray(payload?.snapshots) ? payload.snapshots.slice() : [];
      const stamped = {
        ts: (typeof snap.ts === 'number' && snap.ts > 0) ? snap.ts : Date.now(),
        source: String(snap.source || 'places'),
        by: user,
        clubs: snap.clubs,
      };

      const last = snapshots[snapshots.length - 1];
      if (last && (stamped.ts - last.ts) < MIN_GAP_MS && last.source !== 'seed') {
        // Fenêtre trop courte → remplace le dernier (garde le plus frais)
        snapshots[snapshots.length - 1] = stamped;
      } else {
        snapshots.push(stamped);
      }
      snapshots.sort((a, b) => a.ts - b.ts);
      while (snapshots.length > MAX_SNAPSHOTS) snapshots.shift();

      const ts = Date.now();
      await kvSet(HISTORY_KEY, { snapshots, ts });
      res.status(200).json({ ok: true, count: snapshots.length, ts });
      return;
    }

    res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  } catch (e) {
    console.error('[api/reviews] error:', e);
    res.status(500).json({ error: 'INTERNAL', message: String(e.message || e) });
  }
};
