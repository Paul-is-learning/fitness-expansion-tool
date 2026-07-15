// ─────────────────────────────────────────────────────────────────────
// userdata-sync.js — synchro cloud des scénarios FCF + config Conquête
// (v6.84). Pont entre le localStorage (fpFcfScenarios, fpConquestConfig)
// et /api/userdata. Pull au boot + merge, push débouncé après changement.
// Dégrade proprement hors prod / hors ligne (tout reste en local).
// ─────────────────────────────────────────────────────────────────────
(function () {
  'use strict';

  const SCEN_LS = 'fpFcfScenarios';
  const CONQ_LS = 'fpConquestConfig';
  const ENDPOINT = '/api/userdata';

  function getUser() {
    try {
      const raw = localStorage.getItem('fpCurrentUser') || sessionStorage.getItem('fpCurrentUser');
      return raw ? (JSON.parse(raw)?.email || '').toLowerCase().trim() : '';
    } catch { return ''; }
  }
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

  // Merge scénarios local ← remote (union immuable par name+ts, cap 40/site)
  function mergeScenarios(localMap, remoteMap) {
    const out = { ...(localMap || {}) };
    for (const sk in (remoteMap || {})) {
      const seen = new Set((out[sk] || []).map(x => (x.name || '') + '|' + (x.ts || 0)));
      out[sk] = out[sk] || [];
      for (const it of remoteMap[sk]) {
        const id = (it.name || '') + '|' + (it.ts || 0);
        if (!seen.has(id)) { seen.add(id); out[sk].push(it); }
      }
      out[sk].sort((a, b) => (a.ts || 0) - (b.ts || 0));
      out[sk] = out[sk].slice(-40);
    }
    return out;
  }

  async function pull() {
    try {
      const r = await fetch(ENDPOINT, { credentials: 'include', cache: 'no-store' });
      if (!r.ok) return;
      const j = await r.json();
      if (!j.ok) return;
      // scénarios : merge (l'union ne perd jamais un scénario local)
      if (j.scenarios && Object.keys(j.scenarios).length) {
        const merged = mergeScenarios(lsGet(SCEN_LS), j.scenarios);
        lsSet(SCEN_LS, merged);
      }
      // conquest : LWW — le cloud gagne s'il est plus récent
      if (j.conquest && typeof j.conquest === 'object') {
        const local = lsGet(CONQ_LS);
        if (!local || (j.conquest.ts || 0) > (local.ts || 0)) lsSet(CONQ_LS, j.conquest);
      }
      try { window.dispatchEvent(new CustomEvent('fp:userdata-pulled')); } catch {}
    } catch {}
  }

  let pushTimer = null;
  function push(patch) {
    const user = getUser();
    if (!user) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(async () => {
      try {
        await fetch(ENDPOINT, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user, patch }),
          keepalive: true,
        });
      } catch {}
    }, 600);
  }

  // API : appelée par FcfStudio (après save/delete) et ConquestPlan (config)
  function pushScenarios() { push({ scenarios: lsGet(SCEN_LS) || {} }); }
  function pushConquest() {
    const c = lsGet(CONQ_LS);
    if (c) { c.ts = c.ts || Date.now(); push({ conquest: c }); }
  }

  // Pull au boot (après login) + quand une session s'ouvre
  window.addEventListener('fp:login-success', () => setTimeout(pull, 800));
  setTimeout(() => { if (getUser()) pull(); }, 2500);

  window.UserDataSync = { pull, pushScenarios, pushConquest };
})();
