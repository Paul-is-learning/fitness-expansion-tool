// ================================================================
// FITNESS PARK ROMANIA — MOBILE INTERACTIONS (v4.7)
// ================================================================
// Runtime mobile enhancements:
//   - Injects a top bar (logo + search pill + avatar) above the map
//   - Makes the sidebar a draggable bottom sheet with 3 snap points
//   - Adds a close button for the right panel full-screen overlay
//   - Converts hover-only tooltips to tap-to-open on touch devices
//   - Opens a full-screen search overlay when the pill is tapped
//   - Ensures Leaflet map invalidates size after layout changes
//
// Zero impact on desktop (all behavior gated by `isMobile()`).
// ================================================================

(function() {
  'use strict';

  const MOBILE_BREAKPOINT = 768;
  const isMobile = () => window.innerWidth <= MOBILE_BREAKPOINT;
  const qs = (s, ctx = document) => ctx.querySelector(s);
  const qsa = (s, ctx = document) => Array.from(ctx.querySelectorAll(s));

  // Snap points in pixels (must match CSS custom props --sheet-*)
  function snapPoints() {
    const vh = window.innerHeight;
    return {
      collapsed: parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sheet-collapsed')) || 140,
      mid: Math.round(vh * 0.55),
      full: vh - 80
    };
  }

  // ─── 1. TOP BAR ──────────────────────────────────────────────────
  function buildTopBar() {
    if (qs('.mobile-topbar')) return;
    const top = document.createElement('div');
    top.className = 'mobile-topbar';
    top.innerHTML = `
      <img class="logo-img" src="https://www.fitnesspark.fr/wp-content/uploads/2020/06/logo-fitness-park-white.png"
           alt="FP" onerror="this.style.display='none'">
      <div class="search-pill" id="mobileSearchPill">
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        <span>Rechercher à Bucarest…</span>
      </div>
      <div class="avatar-btn" id="mobileAvatar" onclick="if(typeof showUserPanel==='function') showUserPanel()">P</div>
    `;
    document.body.appendChild(top);

    // Sync avatar letter with current user
    const cu = (() => { try { return JSON.parse(sessionStorage.getItem('fpCurrentUser') || 'null'); } catch { return null; } })();
    if (cu) qs('#mobileAvatar').textContent = (cu.name || cu.email || '?')[0].toUpperCase();

    // Wire up search pill → overlay
    qs('#mobileSearchPill').addEventListener('click', openSearchOverlay);
  }

  // ─── 2. SEARCH OVERLAY ───────────────────────────────────────────
  function buildSearchOverlay() {
    if (qs('.mobile-search-overlay')) return;
    const ov = document.createElement('div');
    ov.className = 'mobile-search-overlay';
    ov.innerHTML = `
      <div class="row">
        <div class="back-btn" id="mobileSearchBack">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="m15 18-6-6 6-6"/>
          </svg>
        </div>
        <input type="text" id="mobileSearchInput" placeholder="Rechercher une adresse à Bucarest…" autocomplete="off">
      </div>
      <div class="results" id="mobileSearchResults"></div>
    `;
    document.body.appendChild(ov);

    qs('#mobileSearchBack').addEventListener('click', closeSearchOverlay);
    const input = qs('#mobileSearchInput');
    const realInput = qs('#searchInput'); // the desktop one wired to the geocoder
    if (realInput) {
      input.addEventListener('input', (e) => {
        realInput.value = e.target.value;
        realInput.dispatchEvent(new Event('input', { bubbles: true }));
        // Mirror desktop results into mobile overlay
        setTimeout(() => {
          const src = qs('#searchResults');
          const dst = qs('#mobileSearchResults');
          if (src && dst) {
            dst.innerHTML = src.innerHTML;
            // Re-wire click handlers — desktop uses onclick attributes which still work
          }
        }, 350);
      });
      // When a result is clicked, close overlay (delegate)
      qs('#mobileSearchResults').addEventListener('click', () => {
        setTimeout(closeSearchOverlay, 150);
      });
    }
  }

  function openSearchOverlay() {
    const ov = qs('.mobile-search-overlay');
    if (!ov) return;
    ov.classList.add('on');
    setTimeout(() => qs('#mobileSearchInput')?.focus(), 50);
  }
  function closeSearchOverlay() {
    qs('.mobile-search-overlay')?.classList.remove('on');
  }

  // ─── 3. BOTTOM SHEET ─────────────────────────────────────────────
  let currentSnap = 'collapsed'; // 'collapsed' | 'mid' | 'full'
  let sheetEl = null;

  function buildSheetHandle() {
    if (qs('.sheet-handle')) return;
    sheetEl = qs('.sidebar');
    if (!sheetEl) return;
    const handle = document.createElement('div');
    handle.className = 'sheet-handle';
    handle.setAttribute('role', 'button');
    handle.setAttribute('aria-label', 'Glisser pour redimensionner le panneau');
    sheetEl.insertBefore(handle, sheetEl.firstChild);

    // Tap to cycle snap points
    handle.addEventListener('click', (e) => {
      if (handle.dataset.dragged === '1') { handle.dataset.dragged = '0'; return; }
      const order = ['collapsed', 'mid', 'full'];
      const idx = order.indexOf(currentSnap);
      snapTo(order[(idx + 1) % order.length]);
    });

    // Drag to resize
    let startY = 0, startH = 0, dragging = false;

    function dragStart(y) {
      dragging = true;
      startY = y;
      startH = sheetEl.offsetHeight;
      sheetEl.classList.add('dragging');
      handle.dataset.dragged = '0';
    }
    function dragMove(y) {
      if (!dragging) return;
      const dy = startY - y;
      const h = Math.max(80, Math.min(window.innerHeight - 40, startH + dy));
      sheetEl.style.setProperty('--sheet-height', h + 'px');
      if (Math.abs(dy) > 6) handle.dataset.dragged = '1';
    }
    function dragEnd() {
      if (!dragging) return;
      dragging = false;
      sheetEl.classList.remove('dragging');
      // Snap to nearest point
      const h = sheetEl.offsetHeight;
      const sp = snapPoints();
      const candidates = [
        ['collapsed', sp.collapsed],
        ['mid',       sp.mid],
        ['full',      sp.full]
      ];
      let best = candidates[0], bestDist = Infinity;
      for (const c of candidates) {
        const d = Math.abs(h - c[1]);
        if (d < bestDist) { bestDist = d; best = c; }
      }
      snapTo(best[0]);
    }

    handle.addEventListener('touchstart', (e) => dragStart(e.touches[0].clientY), { passive: true });
    handle.addEventListener('touchmove',  (e) => dragMove(e.touches[0].clientY),  { passive: true });
    handle.addEventListener('touchend',   dragEnd);
    handle.addEventListener('mousedown',  (e) => { dragStart(e.clientY); e.preventDefault(); });
    window.addEventListener('mousemove',  (e) => dragMove(e.clientY));
    window.addEventListener('mouseup',    dragEnd);
  }

  function snapTo(snap) {
    if (!sheetEl) return;
    currentSnap = snap;
    const sp = snapPoints();
    sheetEl.style.setProperty('--sheet-height', sp[snap] + 'px');
    sheetEl.dataset.snap = snap;
    document.body.classList.toggle('sheet-full', snap === 'full');
    document.body.classList.toggle('sheet-mid',  snap === 'mid');
    // Invalidate Leaflet map size after transition
    setTimeout(() => {
      if (typeof window.map !== 'undefined' && window.map?.invalidateSize) window.map.invalidateSize();
    }, 400);
  }

  // Auto-expand sheet when user switches tabs (so they see the content)
  function hookTabSwitches() {
    qsa('.tab').forEach(t => {
      t.addEventListener('click', () => {
        const tab = t.dataset.tab;
        // Fiche (site analysis) = long content → snap to full
        // Dashboard = long content → snap to full
        // Others → mid is enough
        if (tab === 'site' || tab === 'dash') snapTo('full');
        else if (currentSnap === 'collapsed') snapTo('mid');
      });
    });
  }

  // Auto-snap to full when a site is clicked on the map (Fiche tab becomes active)
  function hookSiteClick() {
    // Observe tab activation changes
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes' && m.attributeName === 'class') {
          const t = m.target;
          if (t.classList?.contains('tab') && t.classList?.contains('active')) {
            const tab = t.dataset.tab;
            if (tab === 'site' && currentSnap !== 'full') snapTo('full');
          }
        }
      }
    });
    qsa('.tab').forEach(t => observer.observe(t, { attributes: true, attributeFilter: ['class'] }));
  }

  // ─── 4. RIGHT PANEL (site analysis) → full-screen ────────────────
  function buildCloseButton() {
    if (qs('.mobile-close-btn')) return;
    const btn = document.createElement('div');
    btn.className = 'mobile-close-btn';
    btn.innerHTML = '&times;';
    btn.setAttribute('aria-label', 'Fermer');
    btn.addEventListener('click', () => {
      if (typeof window.closePanel === 'function') window.closePanel();
      else qs('#app')?.classList.remove('panel-open');
      // Re-show the map/sheet
      setTimeout(() => { if (window.map?.invalidateSize) window.map.invalidateSize(); }, 200);
    });
    document.body.appendChild(btn);
  }

  // ─── 5. TOOLTIPS: tap-to-open ────────────────────────────────────
  function hookTooltips() {
    // Use event delegation to catch dynamically-added tooltips too
    document.addEventListener('click', (e) => {
      if (!isMobile()) return;
      const tip = e.target.closest('.info-tip');
      // Close other open tips
      if (!tip) {
        qsa('.info-tip.open').forEach(t => t.classList.remove('open'));
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      qsa('.info-tip.open').forEach(t => { if (t !== tip) t.classList.remove('open'); });
      tip.classList.toggle('open');
    }, true);
  }

  // ─── 6. LEAFLET MAP: ensure it fills viewport ────────────────────
  function fixMap() {
    if (!window.map) return;
    setTimeout(() => {
      window.map.invalidateSize();
      // Move zoom controls away from bottom-left default (under our sheet)
      const zoom = qs('.leaflet-control-zoom');
      if (zoom) {
        zoom.style.marginBottom = 'calc(var(--sheet-collapsed) + 10px)';
      }
    }, 300);
  }

  // ─── 7. ORIENTATION / RESIZE ─────────────────────────────────────
  function onResize() {
    if (!isMobile()) return;
    if (sheetEl) snapTo(currentSnap);
    fixMap();
  }

  // ─── 8. INIT ─────────────────────────────────────────────────────
  function init() {
    if (!isMobile()) return;
    buildTopBar();
    buildSearchOverlay();
    buildSheetHandle();
    buildCloseButton();
    hookTooltips();
    hookTabSwitches();
    hookSiteClick();
    fixMap();

    // Start collapsed so map is visible
    snapTo('collapsed');
  }

  // Wait for the app to be shown after login
  function waitForApp(cb, tries = 0) {
    const app = qs('#app');
    if (app && app.style.display !== 'none') { cb(); return; }
    if (tries > 40) return; // give up after ~20s
    setTimeout(() => waitForApp(cb, tries + 1), 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => waitForApp(init));
  } else {
    waitForApp(init);
  }

  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(onResize, 250));

  // Expose for debugging + programmatic snap
  window._mobile = { snapTo, isMobile, snapPoints };
})();
