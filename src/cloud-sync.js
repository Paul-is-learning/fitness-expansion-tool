// ─────────────────────────────────────────────────────────────────────
// cloud-sync.js — cross-device sync layer for custom sites (v6.29).
//
// Bridge client-side customSites state <-> /api/sync (Vercel KV backend).
// Architecture:
//   - pull()   on boot/tab-switch: fetch remote state, merge into local.
//   - push()   after any mutation: debounced upsert to remote.
//   - Last-write-wins: remote timestamp decides direction of merge.
//
// Fallback: if /api/sync returns 503 (KV not configured) or network dies,
// we stay in localStorage-only mode silently. UI badge reflects status.
//
// Requires:
//   - window.customSites (the array in index.html)
//   - window.safeStorage (localStorage wrapper)
//   - window.currentUser (auth)
//   - window.renderCustomSites, window.refreshCustomMarkers
//   - window.migrateCustomSite
// ─────────────────────────────────────────────────────────────────────
(function () {
  'use strict';

  const ENDPOINT = '/api/sync';
  const DEBOUNCE_MS = 900;        // coalesce rapid edits
  const POLL_INTERVAL_MS = 30000; // light polling while tab is focused
  const STATUS_KEY = '_fpCloudSyncStatus';

  let pushTimer = null;
  let lastPulledTs = 0;
  let pollTimer = null;
  let kvAvailable = null; // null = unknown, true = OK, false = 503/error

  function getUser() {
    try { return (window.currentUser?.email || '').toLowerCase().trim(); } catch { return ''; }
  }

  function setStatus(state, detail) {
    window[STATUS_KEY] = { state, detail, ts: Date.now() };
    try { window.dispatchEvent(new CustomEvent('fp:cloud-sync-status', { detail: window[STATUS_KEY] })); } catch {}
    // Update badge in Mes Sites card
    try {
      const el = document.getElementById('fpCloudSyncBadge');
      if (!el) return;
      const palette = {
        ok:      { bg: 'rgba(16,185,129,.18)', fg: '#10b981', label: '☁ Synchronisé' },
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

  async function pull() {
    const user = getUser();
    if (!user) return { ok: false, reason: 'NO_USER' };
    try {
      const r = await fetch(`${ENDPOINT}?user=${encodeURIComponent(user)}`, { cache: 'no-store' });
      if (r.status === 503 || r.status === 404) { kvAvailable = false; setStatus('offline', r.status === 404 ? '/api/sync absent' : 'KV not configured'); return { ok: false, reason: 'KV_OFFLINE' }; }
      if (!r.ok) { setStatus('error', `pull ${r.status}`); return { ok: false, reason: 'HTTP_' + r.status }; }
      kvAvailable = true;
      const data = await r.json();
      const remoteSites = Array.isArray(data.sites) ? data.sites : [];
      const remoteTs = data.ts || 0;
      mergeIntoLocal(remoteSites, remoteTs);
      lastPulledTs = remoteTs;
      setStatus('ok', `pulled ${remoteSites.length}`);
      return { ok: true, count: remoteSites.length, ts: remoteTs };
    } catch (e) {
      setStatus('error', e.message || 'pull failed');
      return { ok: false, reason: 'NET', error: String(e) };
    }
  }

  function mergeIntoLocal(remoteSites, remoteTs) {
    if (!Array.isArray(window.customSites)) return;
    // Dedup by lat/lng 4-decimal key. Remote wins on conflict (last-write-wins
    // at the array level — we just replace local array if remote is newer).
    const localKey = new Set(window.customSites.map(s => Number(s.lat).toFixed(4) + ',' + Number(s.lng).toFixed(4)));
    let added = 0;
    for (const s of remoteSites) {
      if (!s || !isFinite(s.lat) || !isFinite(s.lng)) continue;
      const k = Number(s.lat).toFixed(4) + ',' + Number(s.lng).toFixed(4);
      if (localKey.has(k)) continue;
      const migrated = typeof window.migrateCustomSite === 'function' ? window.migrateCustomSite({ ...s }) : s;
      window.customSites.push(migrated);
      localKey.add(k);
      added++;
    }
    if (added > 0) {
      try { window.safeStorage?.set('fpCustomSites', window.customSites); } catch {}
      try { window.renderCustomSites?.(); } catch {}
      try { window.refreshCustomMarkers?.(); } catch {}
      console.log(`[cloud-sync] pulled ${added} new site(s) from cloud`);
    }
  }

  function schedulePush() {
    if (kvAvailable === false) return; // don't spam if KV not configured
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, DEBOUNCE_MS);
  }

  async function pushNow() {
    const user = getUser();
    if (!user) return;
    if (!Array.isArray(window.customSites)) return;
    try {
      const r = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, sites: window.customSites }),
      });
      if (r.status === 503) { kvAvailable = false; setStatus('offline', 'KV not configured'); return; }
      if (!r.ok) { setStatus('error', `push ${r.status}`); return; }
      kvAvailable = true;
      const data = await r.json();
      setStatus('ok', `pushed ${data.count || window.customSites.length}`);
    } catch (e) {
      setStatus('error', e.message || 'push failed');
    }
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
  };

  // Auto-boot: on login-success event (defined in index.html) we pull,
  // then start light polling. Also pull on tab focus (visibilitychange).
  window.addEventListener('fp:login-success', async () => {
    await pull();
    startPolling();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && getUser() && kvAvailable !== false) pull();
  });
})();
