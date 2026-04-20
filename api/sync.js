// ─────────────────────────────────────────────────────────────────────
// /api/sync — Vercel Serverless Function (Node runtime).
//
// Cross-device + cross-user sync for custom sites. Scénario B (partage
// équipe, v6.38): TOUS les users partagent le même espace.
//
// Storage key: `fp:custom-sites:shared` (single KV key).
// Chaque site garde `createdBy: <email>` pour traçabilité.
//
// Credentials (Vercel KV / Upstash): auto-injectés quand le KV store est
// connecté au projet: KV_REST_API_URL + KV_REST_API_TOKEN.
//
// Setup: docs/CLOUD_SYNC_SETUP.md (2 clicks Vercel dashboard).
//
// API:
//   GET  /api/sync                 → 200 { sites: [...], ts: <epochMs> }
//   POST /api/sync { user, sites } → 200 { ok: true, ts, count }
//
// Rétrocompat: GET /api/sync?user=<email> accepté mais ignoré (tous les
// users lisent le même espace partagé maintenant).
//
// Whitelist côté serveur sur le POST (empêche un user non canonique
// d'écrire, même si la URL KV fuit).
// ─────────────────────────────────────────────────────────────────────

const KV_URL   = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const SHARED_KEY = 'fp:custom-sites:shared';

// Whitelist des users autorisés à écrire (lecture libre pour tous les
// users authentifiés côté client via auth-guard).
const ALLOWED_USERS = new Set([
  'paulbecaud@isseo-dev.com',
  'pbecaud@isseo-dev.com',
  'ulysse.gaspard0@gmail.com',
  'tomescumh@yahoo.com',
]);

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
    res.status(503).json({ error: 'KV_NOT_CONFIGURED', hint: 'Connect Vercel KV in dashboard (Storage → KV) then redeploy.' });
    return;
  }

  try {
    if (req.method === 'GET') {
      // Lecture: tout le monde lit l'espace partagé (pas d'auth check côté serveur,
      // mais l'auth-guard client restreint qui peut ouvrir l'app).
      const payload = await kvGet(SHARED_KEY);
      res.status(200).json(payload || { sites: [], ts: 0 });
      return;
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const user = String(body.user || '').toLowerCase().trim();
      const sites = Array.isArray(body.sites) ? body.sites : null;
      // v6.49 — overrides per-site (rent / charge / surface) synchronisés aussi.
      // Maps keyed by "lat.toFixed(3),lng.toFixed(3)". LWW simple via ts global.
      const overrides = (body.overrides && typeof body.overrides === 'object') ? body.overrides : null;
      if (!ALLOWED_USERS.has(user)) { res.status(403).json({ error: 'FORBIDDEN_USER' }); return; }
      if (!sites) { res.status(400).json({ error: 'BAD_PAYLOAD' }); return; }
      if (sites.length > 1000) { res.status(413).json({ error: 'TOO_MANY_SITES' }); return; }
      const serialized = JSON.stringify({ sites, overrides });
      if (serialized.length > 1 * 1024 * 1024) { res.status(413).json({ error: 'PAYLOAD_TOO_LARGE' }); return; }
      const ts = Date.now();
      // Stamp createdBy on sites that don't have one (new sites from this user)
      for (const s of sites) {
        if (!s.createdBy) s.createdBy = user;
      }
      const payload = { sites, ts };
      if (overrides) payload.overrides = overrides;
      await kvSet(SHARED_KEY, payload);
      res.status(200).json({ ok: true, ts, count: sites.length, hasOverrides: !!overrides });
      return;
    }

    res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  } catch (e) {
    console.error('[api/sync] error:', e);
    res.status(500).json({ error: 'INTERNAL', message: String(e.message || e) });
  }
};
