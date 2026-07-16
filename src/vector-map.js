// ─────────────────────────────────────────────────────────────────────
// src/vector-map.js — v6.96 « fond de carte vectoriel »
//
// Upgrade PROGRESSIVE du fond de carte : le raster CARTO dark_all est
// remplacé par le style VECTORIEL CARTO « Dark Matter » rendu par
// MapLibre GL, embarqué DANS Leaflet via le plugin officiel
// @maplibre/maplibre-gl-leaflet. Résultat : textes et routes nets à
// tous les niveaux de zoom, rendu haute densité, zoom fractionnaire
// fluide — sans toucher une ligne des couches métier (heatmaps,
// secteurs, cercles, pins restent du pur Leaflet).
//
// Philosophie « enhancement » :
//   - chargé APRÈS le boot (window load + idle) → zéro impact perf P1 ;
//   - si WebGL absent / CDN injoignable / style en erreur → on ne fait
//     RIEN, le raster actuel reste (aucune régression possible) ;
//   - le sélecteur de fonds (🌙🛰️🗺️🌐) vit dans une closure d'app-core :
//     on se synchronise par écoute des clics (délégation), sans le
//     modifier — satellite/street/hybrid retirent le vecteur, retour
//     🌙 le remet.
// ─────────────────────────────────────────────────────────────────────
(function () {
  'use strict';

  // ═══ v7.04 — FOND VECTORIEL DÉSACTIVÉ ══════════════════════════════
  // Le rendu MapLibre GL gelait l'onglet quand beaucoup de marqueurs
  // concurrents s'affichaient par-dessus le canvas (« ça fait bugger le
  // SaaS » au clic sur les filtres). On revient au fond CARTO sombre
  // RASTER (rapide, stable, visuellement quasi identique) : le filtre
  // concurrents fonctionne parfaitement dessus. Le module reste en place
  // pour une éventuelle réactivation future, mais ne fait plus rien.
  return;

  // Pas d'upgrade dans une IFRAME (suite de tests, embeds) : le rendu GL y
  // est inutile et peut monopoliser le thread d'un contexte caché.
  try { if (window !== window.top) return; } catch { return; }

  const MAPLIBRE_JS  = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js';
  const MAPLIBRE_CSS = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css';
  const PLUGIN_JS    = 'https://unpkg.com/@maplibre/maplibre-gl-leaflet@0.0.22/leaflet-maplibre-gl.js';
  const STYLE_URL    = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

  let glLayer = null;      // L.maplibreGL une fois créé
  let active = false;      // vecteur actuellement affiché ?

  function webglOK() {
    try {
      const c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
    } catch { return false; }
  }

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = res; s.onerror = () => rej(new Error('load fail ' + src));
      document.head.appendChild(s);
    });
  }
  function loadCss(href) {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href;
    document.head.appendChild(l);
  }

  // Retire le tile layer raster CARTO dark (ajouté par la closure d'app-core)
  function removeDarkRaster(map) {
    const doomed = [];
    map.eachLayer(l => { if (l instanceof L.TileLayer && String(l._url || '').includes('dark_all')) doomed.push(l); });
    doomed.forEach(l => { try { map.removeLayer(l); } catch {} });
  }

  function showVector(map) {
    if (!glLayer) return;
    removeDarkRaster(map); // toujours : rattrape un raster re-ajouté par la closure
    if (active) return;
    try {
      glLayer.addTo(map);
      active = true;
      // le canvas GL vit dans le tilePane → toujours sous les overlays métier.
      // Un layer GL RE-ajouté (retour du mode satellite) peut rester non
      // peint tant que sa taille n'est pas resynchronisée → resize différé.
      setTimeout(() => { try { glLayer.getMaplibreMap?.()?.resize(); } catch {} }, 150);
    } catch (e) { console.warn('[vector-map] add fail:', e); }
  }
  function hideVector(map) {
    if (!glLayer || !active) return;
    try { map.removeLayer(glLayer); } catch (e) { console.warn('[vector-map] remove fail:', e); }
    active = false;
  }

  async function upgrade(map) {
    if (!webglOK()) { console.log('[vector-map] WebGL indisponible — raster conservé'); return; }
    try {
      loadCss(MAPLIBRE_CSS);
      await loadScript(MAPLIBRE_JS);
      await loadScript(PLUGIN_JS);
      if (!window.maplibregl || !L.maplibreGL) return;

      glLayer = L.maplibreGL({
        style: STYLE_URL,
        pane: 'tilePane',            // sous toutes les couches métier
        attribution: '',             // l'attribution © OSM © CARTO existe déjà
      });
      showVector(map);

      // Zoom fractionnaire fluide — seulement quand le vecteur est actif
      // (un raster serait flou entre deux niveaux). zoomSnap .25 : assez
      // fin pour être fluide, assez discret pour ne perturber aucun calcul.
      map.options.zoomSnap = 0.25;
      map.options.zoomDelta = 0.5;
      map.options.wheelPxPerZoomLevel = 90;

      // Synchronisation avec le sélecteur de fonds (closure intouchée).
      // ATTENTION : le handler d'app-core fait stopPropagation → la
      // délégation document ne reçoit RIEN. On s'attache donc directement
      // aux boutons : les listeners d'un même nœud s'exécutent tous, et
      // le nôtre (ajouté après) passe en second — parfait pour corriger
      // l'état après que la closure a permuté ses rasters.
      document.querySelectorAll('.tile-btn').forEach(btn => {
        btn.addEventListener('click', () => setTimeout(() => {
          if (btn.dataset.tile === 'dark') showVector(map);   // retire aussi le raster re-ajouté
          else hideVector(map);
        }, 0));
      });

      console.log('[vector-map] ✅ fond vectoriel CARTO Dark Matter actif (MapLibre GL)');
    } catch (e) {
      console.warn('[vector-map] upgrade abandonnée (raster conservé):', e.message || e);
    }
  }

  // Démarrage : après la carte ET après le boot complet (idle)
  function whenIdle(fn) {
    if (document.readyState === 'complete') {
      (window.requestIdleCallback || (cb => setTimeout(cb, 800)))(fn, { timeout: 4000 });
    } else {
      window.addEventListener('load', () => whenIdle(fn), { once: true });
    }
  }
  function start() {
    const map = window._fpMap;
    if (map) whenIdle(() => upgrade(map));
    else window.addEventListener('fp:map-ready', (e) => whenIdle(() => upgrade(e.detail.map)), { once: true });
  }
  start();
})();
