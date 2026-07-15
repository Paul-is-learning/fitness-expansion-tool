// ─────────────────────────────────────────────────────────────────────
// /api/userdata — Synchro cloud des données "travail" partagées (v6.84).
//
// Ferme le trou : les scénarios FCF nommés et la config du Plan de
// Conquête restaient sur l'appareil de création. Ils sont maintenant
// partagés avec l'équipe et retrouvés partout.
//
//   GET  /api/userdata            → { scenarios, conquest, ts }
//   POST /api/userdata { patch }  → merge et renvoie l'état fusionné.
//        patch = { scenarios?, conquest? }  (chacun optionnel)
//
// Merge :
//   - scenarios : map siteKey → [ {name, ts, hyp}, … ]. Union par
//     (siteKey, name+ts) — un scénario est immuable une fois créé, donc
//     l'union suffit (pas de conflit). Cap 40 / site.
//   - conquest  : objet config unique. LWW par `ts` (dernier écrit gagne).
//
// Auth : cookie session (admin/editor pour écrire) OU whitelist legacy.
// ─────────────────────────────────────────────────────────────────────

const crypto = require('crypto');

const KV_URL   = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const SCEN_KEY = 'fp:v2:scenarios';
const CONQ_KEY = 'fp:v2:conquest';

const ALLOWED_USERS = new Set([
  'paulbecaud@isseo-dev.com', 'pbecaud@isseo-dev.com',
  'ulysse.gaspard0@gmail.com', 'tomescumh@yahoo.com',
]);

async function kvGet(key) {
  const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${KV_TOKEN}` } });
  if (!r.ok) throw new Error(`KV GET ${r.status}`);
  const j = await r.json();
  return j.result ? JSON.parse(j.result) : null;
}
async function kvSet(key, value) {
  const r = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'text/plain' }, body: JSON.stringify(value),
  });
  if (!r.ok) throw new Error(`KV SET ${r.status}`);
}
async function isAuthorized(req, legacyUser, write) {
  try {
    const c = (req.headers.cookie || '').split(/;\s*/).find(x => x.startsWith('fp_session='));
    if (c) {
      const [p, sig] = c.slice('fp_session='.length).split('.');
      if (crypto.createHmac('sha256', KV_TOKEN).update(p).digest('base64url') === sig) {
        const s = JSON.parse(Buffer.from(p, 'base64url').toString());
        if (Date.now() <= s.x) {
          // v6.87 — révocation immédiate : rôle relu dans l'annuaire VIVANT
          const dir = await kvGet('fp:v2:directory').catch(() => null);
          const u = dir && dir[s.e];
          if (u && !u.disabled) return write ? ['admin', 'editor'].includes(u.role) : true;
        }
      }
    }
  } catch {}
  return ALLOWED_USERS.has(String(legacyUser || '').toLowerCase().trim());
}

function mergeScenarios(remote, incoming) {
  const out = {};
  const all = { ...(remote || {}) };
  for (const sk in (incoming || {})) all[sk] = [...(all[sk] || []), ...(incoming[sk] || [])];
  for (const sk in all) {
    const seen = new Set();
    const list = [];
    for (const it of all[sk]) {
      if (!it || typeof it !== 'object') continue;
      const id = (it.name || '') + '|' + (it.ts || 0);
      if (seen.has(id)) continue;
      seen.add(id); list.push(it);
    }
    list.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    out[sk] = list.slice(-40);
  }
  return out;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.APP_URL || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (!KV_URL || !KV_TOKEN) { res.status(503).json({ error: 'KV_NOT_CONFIGURED' }); return; }

  try {
    if (req.method === 'GET') {
      const [scenarios, conquest] = await Promise.all([kvGet(SCEN_KEY), kvGet(CONQ_KEY)]);
      res.status(200).json({ ok: true, scenarios: scenarios || {}, conquest: conquest || null, ts: Date.now() });
      return;
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      if (!(await isAuthorized(req, body.user, true))) { res.status(403).json({ error: 'FORBIDDEN_USER' }); return; }
      const patch = body.patch || {};

      let scenarios = null, conquest = null;
      if (patch.scenarios && typeof patch.scenarios === 'object') {
        const remote = await kvGet(SCEN_KEY);
        scenarios = mergeScenarios(remote, patch.scenarios);
        if (JSON.stringify(scenarios).length > 512 * 1024) { res.status(413).json({ error: 'SCENARIOS_TOO_LARGE' }); return; }
        await kvSet(SCEN_KEY, scenarios);
      }
      if (patch.conquest && typeof patch.conquest === 'object') {
        const remote = await kvGet(CONQ_KEY);
        // LWW : n'écrase que si le patch est plus récent
        if (!remote || (patch.conquest.ts || 0) >= (remote.ts || 0)) { conquest = patch.conquest; await kvSet(CONQ_KEY, conquest); }
        else conquest = remote;
      }
      // renvoie l'état complet fusionné pour resync immédiate du client
      const [finalScen, finalConq] = await Promise.all([
        scenarios ? Promise.resolve(scenarios) : kvGet(SCEN_KEY),
        conquest ? Promise.resolve(conquest) : kvGet(CONQ_KEY),
      ]);
      res.status(200).json({ ok: true, scenarios: finalScen || {}, conquest: finalConq || null, ts: Date.now() });
      return;
    }

    res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  } catch (e) {
    console.error('[api/userdata] error:', e);
    res.status(500).json({ error: 'INTERNAL', message: String(e.message || e) });
  }
};
