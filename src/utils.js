// ================================================================
// FITNESS PARK ROMANIA — UTILITIES
// ================================================================
// Small pure helpers used across the app. Loaded early so data
// modules (e.g. users.js) can rely on simpleHash.
//
// Contents:
//   simpleHash(str)       djb2-like hash → base36 string (client-side only)
//   haversine(a,b,c,d)    Great-circle distance in METERS between (a,b) and (c,d)
//   fmt(n)                French thousands-separated number, '0' if falsy
// ================================================================

/**
 * Weak client-side hash. NOT cryptographically secure.
 * Used only to avoid storing plaintext passwords in localStorage.
 * For real auth, migrate to a server + bcrypt / argon2.
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
 */
function fmt(n) {
  return n ? n.toLocaleString('fr-FR') : '0';
}
