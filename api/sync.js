// ─────────────────────────────────────────────────────────────────────
// /api/sync — Vercel Serverless Function (Node runtime)
//
// Cross-device sync for custom sites (fpCustomSites). Backed by Vercel KV
// (Redis). Credentials auto-injected by Vercel when KV integration is
// connected: KV_REST_API_URL + KV_REST_API_TOKEN.
//
// Setup: see docs/CLOUD_SYNC_SETUP.md (2 clicks in Vercel dashboard).
//
// API:
//   GET  /api/sync?user=<email>   → 200 { sites: [...], ts: <epochMs> }
//   POST /api/sync body { user, sites } → 200 { ok: true, ts }
//
// If KV is not configured → 503 (client falls back to localStorage).
// Last-write-wins: POST overwrites the whole array for that user.
// ─────────────────────────────────────────────────────────────────────

const KV_URL   = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

// Canonical users allowed to sync (server-side whitelist — defensive,
// the client also enforces this via authGuard login).
const ALLOWED_USERS = new Set([
  'paulbecaud@isseo-dev.com',
  'pbecaud@isseo-dev.com',
  'ulysse.gaspard0@gmail.com',
  'tomescumh@yahoo.com',
]);

function userKey(email) {
  return `fp:custom-sites:${email.toLowerCase().trim()}`;
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
  // CORS: same-origin only in prod. Allow preview dev.
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
      const user = String(req.query.user || '').toLowerCase().trim();
      if (!ALLOWED_USERS.has(user)) { res.status(403).json({ error: 'FORBIDDEN_USER' }); return; }
      const payload = await kvGet(userKey(user));
      res.status(200).json(payload || { sites: [], ts: 0 });
      return;
    }

    if (req.method === 'POST') {
      // Body may arrive as object (Vercel auto-parses JSON) or as string
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const user = String(body.user || '').toLowerCase().trim();
      const sites = Array.isArray(body.sites) ? body.sites : null;
      if (!ALLOWED_USERS.has(user)) { res.status(403).json({ error: 'FORBIDDEN_USER' }); return; }
      if (!sites) { res.status(400).json({ error: 'BAD_PAYLOAD' }); return; }
      // Guardrail: cap at 500 sites / 500KB to avoid runaway writes
      if (sites.length > 500) { res.status(413).json({ error: 'TOO_MANY_SITES' }); return; }
      const serialized = JSON.stringify(sites);
      if (serialized.length > 500 * 1024) { res.status(413).json({ error: 'PAYLOAD_TOO_LARGE' }); return; }
      const ts = Date.now();
      await kvSet(userKey(user), { sites, ts });
      res.status(200).json({ ok: true, ts, count: sites.length });
      return;
    }

    res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  } catch (e) {
    console.error('[api/sync] error:', e);
    res.status(500).json({ error: 'INTERNAL', message: String(e.message || e) });
  }
};
