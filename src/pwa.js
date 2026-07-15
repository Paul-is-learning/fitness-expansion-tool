// ─────────────────────────────────────────────────────────────────────
// pwa.js — enregistrement du service worker + bannière hors-ligne (v6.81).
// Lecture offline : les fiches et assets déjà consultés restent
// disponibles sans réseau ; les écritures/API attendent le retour du net.
// ─────────────────────────────────────────────────────────────────────
(function () {
  'use strict';

  // ── Service worker ──
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then(
        reg => console.log('[PWA] service worker actif (scope ' + reg.scope + ')'),
        err => console.warn('[PWA] enregistrement SW échoué:', err)
      );
    });
  }

  // ── Bannière hors-ligne ──
  function banner(show) {
    let b = document.getElementById('fpOfflineBanner');
    if (!show) { b?.remove(); return; }
    if (b) return;
    b = document.createElement('div');
    b.id = 'fpOfflineBanner';
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:100010;background:#b45309;color:#fff;' +
      'font-family:var(--font,sans-serif);font-size:11px;font-weight:800;text-align:center;padding:6px 12px;letter-spacing:.4px';
    b.textContent = '📡 HORS LIGNE — lecture seule (données de la dernière synchronisation). Les modifications reprendront au retour du réseau.';
    document.body.appendChild(b);
  }
  window.addEventListener('offline', () => banner(true));
  window.addEventListener('online', () => banner(false));
  if (navigator.onLine === false) window.addEventListener('DOMContentLoaded', () => banner(true));
})();
