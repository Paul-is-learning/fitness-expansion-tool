// ─────────────────────────────────────────────────────────────────────
// cloud-sync.js — cross-device sync (v6.38 CRDT per-site).
//
// Bridge client-side customSites <-> /api/sync (Vercel KV backend).
// Scénario: isolation par user (chaque user = son propre KV key
// `fp:custom-sites:<email>`). La sync garantit que les 2 devices d'un
// MÊME user restent cohérents Mac <-> iPhone.
//
// CRDT per-site (v6.38):
//   - Chaque site a `updatedAt` (ms epoch) + `deletedAt` (ms epoch ou null).
//   - Merge par site (pas par array entier): pour chaque lat/lng key,
//     on garde la version avec le plus grand max(updatedAt, deletedAt).
//   - Suppression = soft delete (tombstone). Propage correctement sur tous
//     devices. Les tombstones restent en local pour garantir la propagation
//     même si device B pull avant que device A ait push.
//   - Pull-before-push sur toute mutation: on récupère l'état cloud, on
//     merge, puis on push le merge. Évite les écrasements cross-device.
//
// Fallback: si /api/sync renvoie 503/404 (KV absent), mode local seul.
// ─────────────────────────────────────────────────────────────────────
(function () {
  'use strict';

  const ENDPOINT = '/api/sync';
  const DEBOUNCE_MS = 700;          // coalesce rapid edits (raccourci v6.38)
  const POLL_INTERVAL_MS = 5000;    // v6.49 — polling 5s (tab visible). ~500k KV calls/mois free tier.
  const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours (purge garbage)
  const STATUS_KEY = '_fpCloudSyncStatus';

  let pushTimer = null;
  let pollTimer = null;
  let kvAvailable = null;         // null = unknown, true = OK, false = 503/404/error
  let pushInFlight = false;       // réentrance guard
  let pendingPushAfterFlight = false;

  function key(s) {
    // clé stable par site: lat/lng 4 décimales + id fallback
    return Number(s.lat).toFixed(4) + ',' + Number(s.lng).toFixed(4);
  }

  function siteTs(s) {
    // timestamp le plus récent entre updatedAt et deletedAt
    const u = Number(s?.updatedAt) || 0;
    const d = Number(s?.deletedAt) || 0;
    return Math.max(u, d);
  }

  function getUser() {
    // v6.40 — lire directement depuis storage. La variable globale `currentUser`
    // est déclarée `let` top-level dans un classic script → script-scoped, PAS
    // accessible via `window.currentUser` depuis l'IIFE de ce module. Résultat
    // avant fix: getUser() retournait toujours '' → pushNow() early-return →
    // aucun POST ne partait jamais. Bug invisible car le backend stampait
    // quand même createdBy avec `body.user` (legacy). Lire storage est robuste.
    try {
      const raw = localStorage.getItem('fpCurrentUser') || sessionStorage.getItem('fpCurrentUser');
      if (!raw) return '';
      const u = JSON.parse(raw);
      return (u?.email || '').toLowerCase().trim();
    } catch { return ''; }
  }

  function setStatus(state, detail) {
    window[STATUS_KEY] = { state, detail, ts: Date.now() };
    try { window.dispatchEvent(new CustomEvent('fp:cloud-sync-status', { detail: window[STATUS_KEY] })); } catch {}
    try {
      const el = document.getElementById('fpCloudSyncBadge');
      if (!el) return;
      const palette = {
        ok:      { bg: 'rgba(16,185,129,.18)', fg: '#10b981', label: '☁ Synchronisé' },
        syncing: { bg: 'rgba(96,165,250,.18)', fg: '#60a5fa', label: '☁ Sync…' },
        offline: { bg: 'rgba(251,191,36,.18)', fg: '#fbbf24', label: '☁ Local seul' },
        error:   { bg: 'rgba(239,68,68,.18)',  fg: '#ef4444', label: '☁ Erreur' },
        unknown: { bg: 'rgba(148,163,184,.18)',fg: 'var(--gray2)', label: '☁ …' },
      };
      const p = palette[state] || palette.unknown;
      el.style.background = p.bg;
      el.style.color = p.fg;
      el.textContent = p.label;
      if (detail) el.title = `${state}: ${detail}`;
    } catch {}
  }

  /** Ensure every site has updatedAt. No-op if already set. Called at boot. */
  function stampExistingSites() {
    if (!Array.isArray(window.customSites)) return;
    const now = Date.now();
    let changed = false;
    for (const s of window.customSites) {
      if (!s.updatedAt) { s.updatedAt = s.createdAt || now; changed = true; }
      if (s.deletedAt === undefined) s.deletedAt = null;
    }
    if (changed) {
      try { window.safeStorage?.set('fpCustomSites', window.customSites); } catch {}
    }
  }

  /** Purge tombstones older than TTL (garbage collection). */
  function purgeOldTombstones() {
    if (!Array.isArray(window.customSites)) return;
    const cutoff = Date.now() - TOMBSTONE_TTL_MS;
    const before = window.customSites.length;
    // v6.41 — mutate in place (splice) au lieu de réassigner. Sinon la réf
    // `let customSites` dans index.html diverge de `window.customSites`.
    const kept = window.customSites.filter(s => !s.deletedAt || s.deletedAt > cutoff);
    window.customSites.splice(0, window.customSites.length, ...kept);
    if (window.customSites.length !== before) {
      try { window.safeStorage?.set('fpCustomSites', window.customSites); } catch {}
    }
  }

  /**
   * CRDT merge per-site: prend le plus récent entre local et remote.
   * Les tombstones (deletedAt) gagnent sur les versions plus anciennes.
   * Retourne le nombre de changements appliqués au local.
   */
  function mergeCRDT(remoteSites) {
    if (!Array.isArray(window.customSites)) return 0;
    const localMap = new Map(window.customSites.map(s => [key(s), s]));
    let changes = 0;
    for (const r of remoteSites) {
      if (!r || !isFinite(r.lat) || !isFinite(r.lng)) continue;
      const k = key(r);
      const l = localMap.get(k);
      if (!l) {
        // Nouveau site distant → ajoute (même si tombstone, pour propager la suppression)
        const migrated = typeof window.migrateCustomSite === 'function' ? window.migrateCustomSite({ ...r }) : { ...r };
        if (!migrated.updatedAt) migrated.updatedAt = r.updatedAt || r.createdAt || Date.now();
        if (migrated.deletedAt === undefined) migrated.deletedAt = r.deletedAt || null;
        window.customSites.push(migrated);
        localMap.set(k, migrated);
        changes++;
      } else if (siteTs(r) > siteTs(l)) {
        // Remote plus récent → écrase local
        Object.assign(l, r);
        if (!l.updatedAt) l.updatedAt = Date.now();
        if (l.deletedAt === undefined) l.deletedAt = null;
        changes++;
      }
      // else: local plus récent ou égal → on garde local
    }
    if (changes > 0) {
      try { window.safeStorage?.set('fpCustomSites', window.customSites); } catch {}
      try { window.renderCustomSites?.(); } catch {}
      try { window.refreshCustomMarkers?.(); } catch {}
      try { window._fpMobileRefreshSites?.(); } catch {}
      console.log(`[cloud-sync] CRDT merge: ${changes} change(s) applied from cloud`);
    }
    return changes;
  }

  /**
   * v6.49 — Merge des overrides per-site (loyer/charges/surface).
   * Stratégie simple: si remote a des overrides et (local vide OU remote ts ≥ local ts),
   * remote écrase local. Évite que local "gagne" silencieusement après reload.
   * Déclenche un rerender des fiches ouvertes si ça change.
   */
  function mergeOverrides(remote) {
    if (!remote || typeof remote !== 'object') return 0;
    let changes = 0;
    const maps = [
      ['rent',    '_rentOverrides'],
      ['charge',  '_chargeOverrides'],
      ['surface', '_surfaceOverrides'],
      ['radius',  '_radiusOverrides'],  // v6.65.1
    ];
    for (const [rKey, wKey] of maps) {
      const rObj = remote[rKey];
      if (!rObj || typeof rObj !== 'object') continue;
      const lObj = window[wKey] || (window[wKey] = {});
      for (const k in rObj) {
        if (lObj[k] !== rObj[k]) {
          lObj[k] = rObj[k];
          changes++;
        }
      }
    }
    // v6.65.1 — capture rates (global, pas par site). LWW simple.
    if (remote.captureRates && typeof remote.captureRates === 'object') {
      const before = window._captureRatesOverride || {};
      const after = remote.captureRates;
      let rateChanges = 0;
      for (const k of ['premium', 'midPremium', 'mid', 'independent', 'lowcost']) {
        if (before[k] !== after[k]) rateChanges++;
      }
      if (rateChanges > 0) {
        window._captureRatesOverride = after;
        try { window.applyCaptureRatesOverride?.(); } catch {}
        changes += rateChanges;
      }
    }
    // v6.61 — merge metadata "qui a édité" (LWW par entrée via at-timestamp)
    if (remote.meta && typeof remote.meta === 'object') {
      try {
        const safeS = (typeof window.safeStorage !== 'undefined') ? window.safeStorage : null;
        const localMeta = (safeS ? safeS.get('fpOverrideMeta', {}) : JSON.parse(localStorage.getItem('fpOverrideMeta') || '{}')) || {};
        let metaChanges = 0;
        for (const siteKey in remote.meta) {
          const rSite = remote.meta[siteKey] || {};
          const lSite = localMeta[siteKey] || (localMeta[siteKey] = {});
          for (const kind of ['rent', 'charge', 'surface']) {
            const rE = rSite[kind];
            const lE = lSite[kind];
            if (rE && (!lE || (rE.at || 0) > (lE.at || 0))) {
              lSite[kind] = { by: rE.by, at: rE.at };
              metaChanges++;
            }
          }
        }
        if (metaChanges > 0) {
          if (safeS) safeS.set('fpOverrideMeta', localMeta);
          else localStorage.setItem('fpOverrideMeta', JSON.stringify(localMeta));
          changes += metaChanges;
        }
      } catch (e) { console.warn('[cloud-sync] meta merge failed', e); }
    }
    if (changes > 0) {
      try { window.persistOverrides?.(); } catch {}
      // Signal aux UIs ouvertes qu'elles doivent recalculer (rent/charge/surface sliders).
      try { window.dispatchEvent(new CustomEvent('fp:overrides-updated', { detail: { changes } })); } catch {}
    }
    return changes;
  }

  async function pull() {
    const user = getUser();
    if (!user) return { ok: false, reason: 'NO_USER' };
    try {
      const r = await fetch(`${ENDPOINT}?user=${encodeURIComponent(user)}`, { cache: 'no-store' });
      if (r.status === 503 || r.status === 404) {
        kvAvailable = false;
        setStatus('offline', r.status === 404 ? '/api/sync absent' : 'KV not configured');
        return { ok: false, reason: 'KV_OFFLINE' };
      }
      if (!r.ok) { setStatus('error', `pull ${r.status}`); return { ok: false, reason: 'HTTP_' + r.status }; }
      kvAvailable = true;
      const data = await r.json();
      const remoteSites = Array.isArray(data.sites) ? data.sites : [];
      const changes = mergeCRDT(remoteSites);
      const ovChanges = mergeOverrides(data.overrides);
      const total = changes + ovChanges;
      setStatus('ok', `pull ${remoteSites.length}${total ? ` · ${total} maj` : ''}`);
      // Initial push si local non-vide et cloud vide (migration v6.29 legacy)
      if (remoteSites.length === 0 && Array.isArray(window.customSites) && window.customSites.filter(s => !s.deletedAt).length > 0) {
        console.log('[cloud-sync] cloud vide, push initial', window.customSites.length, 'sites (incl. tombstones)');
        await pushNow();
      }
      return { ok: true, count: remoteSites.length, changes: total };
    } catch (e) {
      setStatus('error', e.message || 'pull failed');
      return { ok: false, reason: 'NET', error: String(e) };
    }
  }

  /**
   * Pull-before-push: on récupère l'état cloud, on merge avec local
   * (CRDT per-site), puis on push l'union. Évite qu'un device en retard
   * écrase des modifications faites sur un autre device.
   */
  async function pushNow() {
    if (pushInFlight) { pendingPushAfterFlight = true; return; }
    const user = getUser();
    if (!user) return;
    if (!Array.isArray(window.customSites)) return;
    pushInFlight = true;
    setStatus('syncing', 'pull+merge+push');
    try {
      // Pull first to merge any remote changes we don't have yet (sites + overrides)
      try {
        const r = await fetch(`${ENDPOINT}?user=${encodeURIComponent(user)}`, { cache: 'no-store' });
        if (r.status === 503 || r.status === 404) { kvAvailable = false; setStatus('offline', 'KV absent'); return; }
        if (r.ok) {
          const data = await r.json();
          if (Array.isArray(data.sites)) mergeCRDT(data.sites);
          mergeOverrides(data.overrides);
          kvAvailable = true;
        }
      } catch {}

      // v6.49 — Push union sites + overrides (rent/charge/surface).
      // Overrides stockés localement sous window._rentOverrides etc. (cf index.html
      // persistOverrides). Cloud = dernière version écrite gagne (LWW simple).
      const overrides = {
        rent:    window._rentOverrides    || {},
        charge:  window._chargeOverrides  || {},
        surface: window._surfaceOverrides || {},
        radius:  window._radiusOverrides  || {},   // v6.65.1 rayon par site
        captureRates: window._captureRatesOverride || null, // v6.65.1 taux global
        meta:    (function(){
          try {
            const s = (typeof window.safeStorage !== 'undefined') ? window.safeStorage : null;
            return s ? (s.get('fpOverrideMeta', {}) || {}) : JSON.parse(localStorage.getItem('fpOverrideMeta') || '{}');
          } catch { return {}; }
        })(),
      };
      const r2 = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, sites: window.customSites, overrides }),
      });
      if (r2.status === 503) { kvAvailable = false; setStatus('offline', 'KV not configured'); return; }
      if (!r2.ok) { setStatus('error', `push ${r2.status}`); return; }
      kvAvailable = true;
      const data = await r2.json();
      const liveCount = window.customSites.filter(s => !s.deletedAt).length;
      setStatus('ok', `${liveCount} sites synchros`);
    } catch (e) {
      setStatus('error', e.message || 'push failed');
    } finally {
      pushInFlight = false;
      if (pendingPushAfterFlight) {
        pendingPushAfterFlight = false;
        setTimeout(pushNow, 200);
      }
    }
  }

  function schedulePush() {
    if (kvAvailable === false) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, DEBOUNCE_MS);
  }

  function startPolling() {
    if (pollTimer) return;
    const tick = async () => {
      if (document.visibilityState === 'visible' && kvAvailable !== false) {
        await pull();
      }
      pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
    };
    pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
  }

  // Public API
  window.cloudSync = {
    pull,
    push: schedulePush,
    pushNow,
    isAvailable: () => kvAvailable,
    status: () => window[STATUS_KEY] || { state: 'unknown' },
    // Debug utils
    _purgeTombstones: purgeOldTombstones,
    _stampSites: stampExistingSites,
  };

  // Auto-boot
  window.addEventListener('fp:login-success', async () => {
    stampExistingSites();
    purgeOldTombstones();
    await pull();
    startPolling();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && getUser() && kvAvailable !== false) pull();
  });

  // v6.39 — beacon push on pagehide (iOS Safari ferme les onglets en background
  // sans laisser le temps au fetch POST de partir). sendBeacon est garanti par
  // le navigateur pour survivre à l'unload. On ne pousse que si on a un user
  // canonical + au moins un site (live ou tombstone à propager).
  window.addEventListener('pagehide', () => {
    try {
      const user = getUser();
      if (!user) return;
      if (kvAvailable === false) return;
      if (!Array.isArray(window.customSites) || window.customSites.length === 0) return;
      // v6.49 — inclut aussi les overrides dans le beacon (sync cross-device même
      // si iOS ferme brutalement l'onglet juste après un slider change).
      const overrides = {
        rent:    window._rentOverrides    || {},
        charge:  window._chargeOverrides  || {},
        surface: window._surfaceOverrides || {},
        radius:  window._radiusOverrides  || {},   // v6.65.1 rayon par site
        captureRates: window._captureRatesOverride || null, // v6.65.1 taux global
        meta:    (function(){
          try {
            const s = (typeof window.safeStorage !== 'undefined') ? window.safeStorage : null;
            return s ? (s.get('fpOverrideMeta', {}) || {}) : JSON.parse(localStorage.getItem('fpOverrideMeta') || '{}');
          } catch { return {}; }
        })(),
      };
      const payload = JSON.stringify({ user, sites: window.customSites, overrides });
      const blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon?.(ENDPOINT, blob);
    } catch {}
  });
})();
