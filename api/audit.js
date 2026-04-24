// ─────────────────────────────────────────────────────────────────────
// /api/audit — Vercel Serverless Function (Node runtime).
//
// Journal d'activité multi-user (v6.65). Un seul log partagé entre les
// 4 users autorisés. Append-only, cap 500 entries (purge des plus
// anciennes automatique).
//
// Storage key: `fp:audit:log` (single KV key, array JSON).
//
// API:
//   GET  /api/audit                 → 200 { entries: [...], ts }
//   POST /api/audit { user, entry } → 200 { ok: true, count, ts }
//
// Whitelist serveur sur le POST (identique à /api/sync).
//
// Structure d'un entry (libre mais convention):
//   {
//     ts:      <epochMs>,          // timestamp serveur (imposé ici)
//     user:    <email>,            // imposé ici = body.user authentifié
//     action:  'slider.rent' | 'slider.charge' | 'slider.surface' |
//              'site.add' | 'site.remove' | 'site.qualify' |
//              'site.analyze' | 'bp.scenario' | ...
//     target:  <siteName ou id>,   // humain-lisible
//     siteKey: 'lat.xxx,lng.yyy',  // optionnel
//     field:   'loyer' | ...       // optionnel
//     before:  <any>,              // optionnel — valeur avant
//     after:   <any>,              // optionnel — valeur après
//     meta:    { ... },            // extra (device, source, ...)
//   }
// ─────────────────────────────────────────────────────────────────────

const KV_URL   = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const AUDIT_KEY = 'fp:audit:log';
const MAX_ENTRIES = 500;

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
    res.status(503).json({ error: 'KV_NOT_CONFIGURED' });
    return;
  }

  try {
    if (req.method === 'GET') {
      const payload = await kvGet(AUDIT_KEY);
      const entries = Array.isArray(payload?.entries) ? payload.entries : [];
      res.status(200).json({ entries, ts: payload?.ts || 0 });
      return;
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const user = String(body.user || '').toLowerCase().trim();
      const entry = body.entry && typeof body.entry === 'object' ? body.entry : null;
      if (!ALLOWED_USERS.has(user)) { res.status(403).json({ error: 'FORBIDDEN_USER' }); return; }
      if (!entry) { res.status(400).json({ error: 'BAD_PAYLOAD' }); return; }

      // Sanitize — cap sur taille de l'entrée pour éviter les abus.
      const serializedEntry = JSON.stringify(entry);
      if (serializedEntry.length > 8 * 1024) { res.status(413).json({ error: 'ENTRY_TOO_LARGE' }); return; }

      const ts = Date.now();
      const stamped = Object.assign({}, entry, { ts, user });

      const payload = await kvGet(AUDIT_KEY);
      const entries = Array.isArray(payload?.entries) ? payload.entries.slice() : [];
      entries.push(stamped);
      // Cap : garder les MAX_ENTRIES les plus récentes (FIFO purge).
      while (entries.length > MAX_ENTRIES) entries.shift();

      const nextPayload = { entries, ts };
      const serialized = JSON.stringify(nextPayload);
      if (serialized.length > 2 * 1024 * 1024) {
        // Sécurité : si jamais le log dépasse 2 Mo, on garde la 2e moitié.
        nextPayload.entries = entries.slice(Math.floor(entries.length / 2));
      }
      await kvSet(AUDIT_KEY, nextPayload);
      res.status(200).json({ ok: true, count: nextPayload.entries.length, ts });
      return;
    }

    res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  } catch (e) {
    console.error('[api/audit] error:', e);
    res.status(500).json({ error: 'INTERNAL', message: String(e.message || e) });
  }
};
