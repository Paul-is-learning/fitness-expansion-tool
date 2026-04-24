// ─────────────────────────────────────────────────────────────────────
// audit-log.js — client-side activity logging (v6.65).
//
// API :
//   window.AuditLog.log({ action, target, field?, before?, after?, siteKey?, meta? })
//     → POST async debouncé (pas de bloquant, pas de throw, best-effort)
//   window.AuditLog.fetch()       → Promise<{entries, ts}>
//   window.AuditLog.isAvailable() → boolean
//
// Mode offline (préview local, KV absent) : les logs sont queued en
// mémoire et dans localStorage `fpAuditQueue` (cap 50). Flush dès que
// la connectivité revient.
// ─────────────────────────────────────────────────────────────────────
(function() {
  'use strict';

  const ENDPOINT = '/api/audit';
  const QUEUE_KEY = 'fpAuditQueue';
  const QUEUE_MAX = 50;
  const FLUSH_DEBOUNCE_MS = 300;

  let endpointAvailable = null;  // null = unknown, true/false sticky per session
  let flushTimer = null;
  let memQueue = [];

  function getUser() {
    try {
      const raw = localStorage.getItem('fpCurrentUser') || sessionStorage.getItem('fpCurrentUser');
      if (!raw) return '';
      const u = JSON.parse(raw);
      return (u?.email || '').toLowerCase().trim();
    } catch { return ''; }
  }

  function loadQueue() {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); }
    catch { return []; }
  }
  function saveQueue(q) {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-QUEUE_MAX))); }
    catch {}
  }

  function log(entry) {
    if (!entry || typeof entry !== 'object') return;
    const user = getUser();
    if (!user) return;  // pas authentifié, on skip
    const stamped = Object.assign({ tsClient: Date.now() }, entry);
    memQueue.push({ user, entry: stamped });
    // Persist queue tant qu'elle n'est pas flushée (robustesse reload/offline)
    const persisted = loadQueue();
    persisted.push({ user, entry: stamped });
    saveQueue(persisted);
    scheduleFlush();
  }

  function scheduleFlush() {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, FLUSH_DEBOUNCE_MS);
  }

  async function postOne(user, entry) {
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user, entry }),
      keepalive: true,
    });
    if (!r.ok) throw new Error('audit POST ' + r.status);
    return r.json();
  }

  async function flush() {
    if (!memQueue.length) {
      // Re-hydrate depuis la queue persistée (ex: reload)
      const persisted = loadQueue();
      if (!persisted.length) return;
      memQueue = persisted.slice();
    }
    const batch = memQueue.slice();
    memQueue = [];
    saveQueue([]);  // on tentera ; en cas d'échec on re-persiste

    const failed = [];
    for (const item of batch) {
      try {
        await postOne(item.user, item.entry);
        endpointAvailable = true;
      } catch (e) {
        endpointAvailable = false;
        failed.push(item);
      }
    }
    if (failed.length) {
      memQueue = failed.concat(memQueue);
      saveQueue(memQueue);
    }
  }

  async function fetchLog() {
    try {
      const r = await fetch(ENDPOINT);
      if (!r.ok) return { entries: [], ts: 0, error: 'HTTP ' + r.status };
      return await r.json();
    } catch (e) {
      return { entries: [], ts: 0, error: String(e.message || e) };
    }
  }

  function isAvailable() { return endpointAvailable !== false; }

  // Flush on visibility change / beforeunload (best-effort).
  window.addEventListener('pagehide', () => {
    if (memQueue.length) {
      try {
        const payload = memQueue.map(m => JSON.stringify({ user: m.user, entry: m.entry })).join('\n');
        // sendBeacon ne supporte pas multi-messages direct; on préfère un
        // simple flush asynchrone — pagehide garantit le keepalive dans fetch.
      } catch {}
      flush();
    }
  });

  // Flush au boot si queue persistée existe.
  setTimeout(() => { if (loadQueue().length) scheduleFlush(); }, 500);

  window.AuditLog = { log, fetch: fetchLog, isAvailable };
})();
