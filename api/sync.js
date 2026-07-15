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
      const overrides = (body.overrides && typeof body.overrides === 'object') ? body.overrides : null;
      if (!isAuthorized(req, user, true)) { res.status(403).json({ error: 'FORBIDDEN_USER' }); return; }
      if (!sites) { res.status(400).json({ error: 'BAD_PAYLOAD' }); return; }
      if (sites.length > 1000) { res.status(413).json({ error: 'TOO_MANY_SITES' }); return; }
      const serialized = JSON.stringify({ sites, overrides });
      if (serialized.length > 1 * 1024 * 1024) { res.status(413).json({ error: 'PAYLOAD_TOO_LARGE' }); return; }
      const ts = Date.now();
      for (const s of sites) { if (!s.createdBy) s.createdBy = user; }

      // ═══ v6.85 — MERGE serveur champ par champ (anti-conflit) ═══
      // Avant : le push écrasait tout l'objet overrides → une modif d'un
      // autre user sur un AUTRE site/champ était perdue. Maintenant on
      // fusionne clé par clé (rent/charge/surface/radius par siteKey) en
      // gardant la plus récente selon les timestamps de `meta`. Les
      // conflits RÉELS (même site+champ édité par 2 personnes) sont
      // signalés dans la réponse (`conflicts`) sans rien perdre en silence.
      const prev = (await kvGet(SHARED_KEY)) || {};
      const prevOv = (prev.overrides && typeof prev.overrides === 'object') ? prev.overrides : {};
      const conflicts = [];
      let mergedOv = overrides;
      if (overrides) {
        const at = (meta, sk, kind) => (meta && meta[sk] && meta[sk][kind] && meta[sk][kind].at) || 0;
        const byOf = (meta, sk, kind) => (meta && meta[sk] && meta[sk][kind] && meta[sk][kind].by) || null;
        const inMeta = overrides.meta || {}, prMeta = prevOv.meta || {};
        mergedOv = { meta: {} };
        for (const [mapKey, kind] of [['rent', 'rent'], ['charge', 'charge'], ['surface', 'surface'], ['radius', 'radius']]) {
          const inMap = overrides[mapKey] || {}, prMap = prevOv[mapKey] || {};
          const out = { ...prMap };
          const keys = new Set([...Object.keys(inMap), ...Object.keys(prMap)]);
          for (const sk of keys) {
            const inHas = sk in inMap, prHas = sk in prMap;
            if (inHas && !prHas) { out[sk] = inMap[sk]; continue; }
            if (!inHas && prHas) { continue; }
            // les deux ont une valeur : le plus récent gagne (par meta.at)
            const inAt = at(inMeta, sk, kind), prAt = at(prMeta, sk, kind);
            if (inMap[sk] !== prMap[sk]) {
              // conflit réel seulement si l'autre modif est plus récente que
              // la base que ce client connaissait (baseTs qu'il renvoie)
              const baseTs = Number(body.baseTs) || 0;
              if (prAt > baseTs && prAt >= inAt && byOf(prMeta, sk, kind) && byOf(prMeta, sk, kind) !== user) {
                conflicts.push({ siteKey: sk, kind, by: byOf(prMeta, sk, kind), theirValue: prMap[sk], yourValue: inMap[sk], at: prAt });
                out[sk] = prMap[sk]; // on garde la version distante (l'autre a été plus récent) — pas d'écrasement silencieux
                continue;
              }
              out[sk] = inAt >= prAt ? inMap[sk] : prMap[sk];
            } else out[sk] = inMap[sk];
          }
          mergedOv[mapKey] = out;
        }
        // captureRates : global, LWW simple
        mergedOv.captureRates = overrides.captureRates || prevOv.captureRates || null;
        // meta : union en gardant les entrées les plus récentes
        const outMeta = JSON.parse(JSON.stringify(prMeta));
        for (const sk in inMeta) {
          outMeta[sk] = outMeta[sk] || {};
          for (const kind in inMeta[sk]) {
            if (!outMeta[sk][kind] || (inMeta[sk][kind].at || 0) >= (outMeta[sk][kind].at || 0)) outMeta[sk][kind] = inMeta[sk][kind];
          }
        }
        mergedOv.meta = outMeta;
      }

      const payload = { sites, ts };
      if (mergedOv) payload.overrides = mergedOv;
      await kvSet(SHARED_KEY, payload);
      res.status(200).json({ ok: true, ts, count: sites.length, hasOverrides: !!mergedOv, conflicts, overrides: mergedOv });
      return;
    }

    res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  } catch (e) {
    console.error('[api/sync] error:', e);
    res.status(500).json({ error: 'INTERNAL', message: String(e.message || e) });
  }
};
