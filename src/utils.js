// ================================================================
// FITNESS PARK ROMANIA — UTILITIES
// ================================================================
// Small pure helpers + reliability primitives.
//
// Core (pure):
//   simpleHash(str)       djb2-like hash → base36 string (client-side only)
//   haversine(a,b,c,d)    Great-circle distance in METERS between points
//   fmt(n)                French thousands-separated number, '0' if falsy
//   escapeHtml(s)         Safe HTML escape (for user-provided strings in templates)
//
// Reliability:
//   safeStorage           localStorage wrapper with quota handling + JSON
//   debounce(fn, ms)      Classic trailing-edge debounce
//   rateLimit(fn, n, ms)  Token bucket: max n calls per window
//   retry(fn, opts)       Exponential backoff for async operations
//   isOnline()            navigator.onLine check
//   onOnlineChange(fn)    Subscribe to online/offline transitions
// ================================================================

/**
 * Weak client-side hash. NOT cryptographically secure.
 * Used only to avoid storing plaintext passwords in localStorage.
 * For real auth, migrate to a server + bcrypt / argon2.
 * @param {string} str
 * @returns {string}
 */
function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

/**
 * Great-circle distance between two lat/lng points (meters).
 * @param {number} a lat1
 * @param {number} b lng1
 * @param {number} c lat2
 * @param {number} d lng2
 * @returns {number} distance in meters
 */
function haversine(a, b, c, d) {
  const R = 6371000;
  const dL = (c - a) * Math.PI / 180;
  const dN = (d - b) * Math.PI / 180;
  const x = Math.sin(dL / 2) ** 2
          + Math.cos(a * Math.PI / 180) * Math.cos(c * Math.PI / 180)
          * Math.sin(dN / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/**
 * French number formatting (1 234 567). Returns '0' for 0/null/undefined.
 * @param {number|null|undefined} n
 * @returns {string}
 */
function fmt(n) {
  return n ? n.toLocaleString('fr-FR') : '0';
}

/**
 * HTML-escape a string for safe inclusion in template literals.
 * ALWAYS use for user-provided strings (site names, notes, email, etc.)
 * Prevents XSS via custom site names like `<img onerror=...>`.
 * @param {*} s
 * @returns {string}
 */
function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

/**
 * localStorage wrapper that:
 *   - Never throws (quota exceeded, disabled storage, JSON parse error)
 *   - Auto-JSON serializes/deserializes
 *   - Returns sensible fallbacks (null on missing, false on write failure)
 * Usage:
 *   safeStorage.get('fpKey', defaultValue)
 *   safeStorage.set('fpKey', value) → true/false
 *   safeStorage.remove('fpKey')
 *   safeStorage.quotaExceeded() → boolean (last write failed due to quota)
 */
const safeStorage = (() => {
  let _quotaExceeded = false;

  function get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch { return fallback; }
  }
  function set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      _quotaExceeded = false;
      return true;
    } catch (e) {
      if (/quota|exceed/i.test(e.message || '')) {
        _quotaExceeded = true;
        try { window.showToast?.('Espace local saturé. Supprime d\'anciens sites custom pour libérer.', 'warn', { title: 'Stockage plein' }); } catch {}
      }
      return false;
    }
  }
  function remove(key) {
    try { localStorage.removeItem(key); return true; } catch { return false; }
  }
  function quotaExceeded() { return _quotaExceeded; }

  return { get, set, remove, quotaExceeded };
})();
// v6.41 — expose sur window pour que les IIFE modules (cloud-sync.js…) puissent
// lire `window.safeStorage`. Sans ça, `const` top-level reste script-scoped.
window.safeStorage = safeStorage;

/**
 * Classic trailing-edge debounce. Returns a function that delays invoking `fn`
 * until `delay` ms have elapsed since the last call. Arguments of the LAST call win.
 * @template F
 * @param {F} fn
 * @param {number} delay ms
 * @returns {F}
 */
function debounce(fn, delay) {
  let t;
  return function debounced(...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * Token-bucket rate limiter. Max `maxCalls` within `windowMs` ms.
 * Excess calls are dropped (and return `undefined`).
 * Useful for capping Google Places / Overpass calls to stay within quota.
 * @template F
 * @param {F} fn
 * @param {number} maxCalls
 * @param {number} windowMs
 * @returns {F}
 */
function rateLimit(fn, maxCalls, windowMs) {
  const calls = [];
  return function limited(...args) {
    const now = Date.now();
    while (calls.length && now - calls[0] > windowMs) calls.shift();
    if (calls.length >= maxCalls) {
      console.warn('[FP rateLimit] dropped call:', fn.name || '(anon)');
      return undefined;
    }
    calls.push(now);
    return fn.apply(this, args);
  };
}

/**
 * Retry an async function with exponential backoff.
 * Bails out early on 4xx-ish errors (non-retryable by default).
 * @param {() => Promise<any>} fn
 * @param {object} [opts]
 * @param {number} [opts.attempts=3]
 * @param {number} [opts.baseDelayMs=400]
 * @param {(err:Error) => boolean} [opts.shouldRetry] custom predicate
 * @returns {Promise<any>}
 */
async function retry(fn, opts = {}) {
  const { attempts = 3, baseDelayMs = 400 } = opts;
  const shouldRetry = opts.shouldRetry || ((err) => {
    const m = String(err?.message || err).toLowerCase();
    return !/4\d\d|bad request|unauthor|forbidden/.test(m);
  });
  let last;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (e) {
      last = e;
      if (i === attempts - 1 || !shouldRetry(e)) throw e;
      const delay = baseDelayMs * Math.pow(2, i) + Math.random() * 120;
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw last;
}

/** @returns {boolean} */
function isOnline() {
  return (typeof navigator !== 'undefined') ? (navigator.onLine !== false) : true;
}

/**
 * Subscribe to online/offline transitions. Returns unsubscribe fn.
 * @param {(online:boolean) => void} handler
 * @returns {() => void}
 */
function onOnlineChange(handler) {
  const onOn  = () => { try { handler(true); } catch {} };
  const onOff = () => { try { handler(false); } catch {} };
  window.addEventListener('online', onOn);
  window.addEventListener('offline', onOff);
  return () => {
    window.removeEventListener('online', onOn);
    window.removeEventListener('offline', onOff);
  };
}
