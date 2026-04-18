// ================================================================
// FITNESS PARK ROMANIA — ERROR HANDLING (v6.8)
// ================================================================
// Defensive layer for runtime errors:
//   - Captures uncaught errors + unhandled promise rejections
//   - De-duplicates repeats (same stack within 3s)
//   - Surfaces user-visible toast (auto-hide 6s, manual close)
//   - Persists last 50 in sessionStorage under `fpErrorLog`
//   - Integrates with audit log (records error alongside analysis audit)
//
// Public API (window):
//   safeTry(fn, ctx)       Sync try/catch wrapper, returns {ok, value, err}
//   safeAsync(fn, ctx)     Async variant (await)
//   showToast(msg, level)  Manual toast (level: info|warn|error|success)
//   window._fpErrors       .list() .clear()
// ================================================================

(function () {
  'use strict';

  const STORAGE_KEY = 'fpErrorLog';
  const MAX_ERRORS = 50;
  const DEDUP_WINDOW_MS = 3000;

  const recent = new Map(); // stack → timestamp

  // ─── Storage ───────────────────────────────────────────────────
  function load() {
    try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]'); }
    catch { return []; }
  }
  function save(log) {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(log)); }
    catch {} // quota — silent (we're already in error handling)
  }

  function record(entry) {
    const log = load();
    log.push(entry);
    while (log.length > MAX_ERRORS) log.shift();
    save(log);
  }

  // ─── Dedup ─────────────────────────────────────────────────────
  function shouldSuppress(key) {
    const now = Date.now();
    const last = recent.get(key);
    if (last && now - last < DEDUP_WINDOW_MS) return true;
    recent.set(key, now);
    // Sweep old entries to avoid memory creep
    if (recent.size > 100) {
      for (const [k, ts] of recent) {
        if (now - ts > DEDUP_WINDOW_MS * 4) recent.delete(k);
      }
    }
    return false;
  }

  // ─── Toast UI ──────────────────────────────────────────────────
  const TOAST_STYLES = `
    .fp-toast-container { position: fixed; top: 16px; right: 16px; z-index: 99999; display: flex; flex-direction: column; gap: 8px; max-width: min(92vw, 420px); pointer-events: none; }
    .fp-toast { pointer-events: auto; padding: 12px 14px; border-radius: 10px; background: rgba(17,24,39,.98); border: 1px solid rgba(212,160,23,.35); color: #e5e7eb; font-size: 13px; line-height: 1.45; box-shadow: 0 6px 24px rgba(0,0,0,.35); backdrop-filter: blur(10px) saturate(160%); display: grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: center; animation: fpToastIn .3s cubic-bezier(.22,.9,.3,1); }
    .fp-toast.error { border-color: rgba(239,68,68,.6); }
    .fp-toast.warn  { border-color: rgba(245,158,11,.6); }
    .fp-toast.success { border-color: rgba(34,197,94,.6); }
    .fp-toast .icon { font-size: 18px; line-height: 1; }
    .fp-toast .body { min-width: 0; word-break: break-word; }
    .fp-toast .title { font-weight: 700; color: #fff; margin-bottom: 2px; }
    .fp-toast .close { cursor: pointer; color: #9ca3af; font-size: 18px; line-height: 1; padding: 2px 6px; border-radius: 4px; transition: background .15s; }
    .fp-toast .close:hover { background: rgba(255,255,255,.08); color: #fff; }
    .fp-toast.leaving { animation: fpToastOut .25s ease-in forwards; }
    @keyframes fpToastIn  { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes fpToastOut { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(-8px); } }
    @media (prefers-reduced-motion: reduce) {
      .fp-toast { animation: none; }
      .fp-toast.leaving { animation: none; opacity: 0; }
    }
  `;

  function ensureStyles() {
    if (document.getElementById('fp-toast-styles')) return;
    const s = document.createElement('style');
    s.id = 'fp-toast-styles';
    s.textContent = TOAST_STYLES;
    document.head.appendChild(s);
  }

  function ensureContainer() {
    let c = document.querySelector('.fp-toast-container');
    if (!c) {
      c = document.createElement('div');
      c.className = 'fp-toast-container';
      (document.body || document.documentElement).appendChild(c);
    }
    return c;
  }

  function showToast(msg, level = 'info', opts = {}) {
    try {
      if (!document.body) { // called before DOM ready
        document.addEventListener('DOMContentLoaded', () => showToast(msg, level, opts), { once: true });
        return;
      }
      ensureStyles();
      const c = ensureContainer();
      const t = document.createElement('div');
      t.className = 'fp-toast ' + level;
      const icon = level === 'error' ? '⚠️' : level === 'warn' ? '⚠️' : level === 'success' ? '✓' : 'ℹ️';
      const title = opts.title || (level === 'error' ? 'Erreur' : level === 'warn' ? 'Attention' : level === 'success' ? 'OK' : 'Info');
      const body = String(msg || '').slice(0, 300);
      // Escape manually (avoid coupling to utils.js load order)
      const escape = (s) => s.replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
      t.innerHTML = `
        <div class="icon">${icon}</div>
        <div class="body"><div class="title">${escape(title)}</div><div>${escape(body)}</div></div>
        <div class="close" role="button" aria-label="Close">×</div>
      `;
      const dismiss = () => {
        t.classList.add('leaving');
        setTimeout(() => t.remove(), 250);
      };
      t.querySelector('.close').addEventListener('click', dismiss);
      c.appendChild(t);
      const duration = opts.duration ?? (level === 'error' ? 8000 : 6000);
      if (duration > 0) setTimeout(dismiss, duration);
      return t;
    } catch {} // never throw from error path
  }

  // ─── Error handling core ───────────────────────────────────────
  function handleError(ctx, err) {
    try {
      const stackKey = (err && err.stack ? err.stack : String(err)).slice(0, 200);
      const key = ctx + '|' + stackKey;
      if (shouldSuppress(key)) return;

      const entry = {
        ts: new Date().toISOString(),
        ctx: ctx || 'unknown',
        message: err && err.message ? err.message : String(err),
        stack: err && err.stack ? String(err.stack).slice(0, 2000) : null,
        url: location.href,
        ua: navigator.userAgent
      };
      record(entry);
      console.error('[FP error]', ctx, err);

      // User-visible toast (suppressed for noisy third-party failures)
      if (!isNoisyThirdParty(err)) {
        showToast((err && err.message) || String(err), 'error', { title: 'Erreur: ' + ctx });
      }
    } catch {} // never throw
  }

  function isNoisyThirdParty(err) {
    const msg = String(err && err.message || err).toLowerCase();
    // Leaflet tile load errors, Overpass 429s, extension errors, ResizeObserver loop (harmless Chrome quirk)
    return /resizeobserver loop|leaflet|tile|overpass|nominatim|google.*quota|network request failed/.test(msg);
  }

  /** Sync wrapper: returns { ok: bool, value?, err? } — never throws. */
  function safeTry(fn, ctx) {
    try {
      return { ok: true, value: fn() };
    } catch (err) {
      handleError(ctx || 'safeTry', err);
      return { ok: false, err };
    }
  }

  /** Async wrapper: returns { ok, value?, err? }. */
  async function safeAsync(fn, ctx) {
    try {
      return { ok: true, value: await fn() };
    } catch (err) {
      handleError(ctx || 'safeAsync', err);
      return { ok: false, err };
    }
  }

  // ─── Global listeners ──────────────────────────────────────────
  window.addEventListener('error', (ev) => {
    handleError('window.error', ev.error || new Error(ev.message));
  });
  window.addEventListener('unhandledrejection', (ev) => {
    handleError('unhandledrejection', ev.reason || new Error('Unhandled rejection'));
  });

  // ─── Expose ────────────────────────────────────────────────────
  window.safeTry    = safeTry;
  window.safeAsync  = safeAsync;
  window.showToast  = showToast;
  window._fpErrors  = {
    list: load,
    clear: () => { sessionStorage.removeItem(STORAGE_KEY); console.log('Error log cleared.'); },
    show: (msg, level, opts) => showToast(msg, level, opts)
  };
})();
