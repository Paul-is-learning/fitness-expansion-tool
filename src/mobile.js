// ================================================================
// FITNESS PARK ROMANIA — MOBILE v4.9 "SITE BROWSER"
// ================================================================
// Runtime mobile-first experience:
//   - Immersive full-screen map with numbered pins for each TARGET
//   - Horizontal carousel at bottom: swipe to browse all candidates
//   - Tap a card or pin → rich summary (sheet snaps to summary state)
//   - Tap "Voir l'analyse complète" → accordion of the full analysis
//   - FAB bottom-right → secondary sheet for layers/tools
//   - Onboarding pulse on first visit
//
// Zero impact on desktop. All DOM is injected conditionally.
// ================================================================

(function() {
  'use strict';

  const MOBILE_BP = 768;
  const isMobile = () => window.innerWidth <= MOBILE_BP;

  // State machine: peek | summary | detail
  let state = 'peek';
  let sheet = null;
  let activeIdx = 0; // index into TARGETS
  let analyses = []; // cached per-target analyses (lazy)
  let pinLayer = null;
  let pinMarkers = [];

  const qs  = (s, ctx = document) => ctx.querySelector(s);
  const qsa = (s, ctx = document) => Array.from(ctx.querySelectorAll(s));

  // ─── ALL SITES = TARGETS + custom sites ────────────────────────
  // Merges the canonical 5 TARGETS with user-added custom sites so both
  // the map pins and the carousel reflect the same list.
  function getAllSites() {
    const canonicals = (typeof TARGETS !== 'undefined' ? TARGETS : []).map((t, i) => ({
      ...t, _kind: 'target', _origIndex: i
    }));
    let customs = [];
    try {
      const raw = localStorage.getItem('fpCustomSites') || '[]';
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        customs = list.map(c => ({
          name: c.name || 'Site custom',
          lat: c.lat,
          lng: c.lng,
          phase: c.phase || '—',
          sector: c.sector || '—',
          area: c.area || '—',
          rent: c.rent || '—',
          status: c.status || 'Custom',
          opening: c.opening || '',
          note: c.notes || '',
          capex: c.capex || 1176000,
          _kind: 'custom',
          _id: c.id
        }));
      }
    } catch {}
    return canonicals.concat(customs);
  }
  const fmtNum = (n) => n === null || n === undefined || !isFinite(n) ? '—' : Math.round(n).toLocaleString('fr-FR');
  const fmtPct = (n) => n === null || n === undefined || !isFinite(n) ? '—' : (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
  const fmtM = (n) => {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    const abs = Math.abs(n);
    if (abs >= 1e6) return (n / 1e6).toFixed(1).replace('.0','') + 'M€';
    if (abs >= 1e3) return Math.round(n / 1e3) + 'k€';
    return Math.round(n) + '€';
  };

  // ─── TOP BAR ──────────────────────────────────────────────────
  function buildTopBar() {
    if (qs('.fp-mobile-topbar')) return;
    // Reuse the desktop Fitness Park PNG logo (base64-embedded in index.html)
    const desktopLogo = qs('.sidebar-header img[alt="Fitness Park"]');
    const logoSrc = desktopLogo?.src || '';
    const logoHtml = logoSrc
      ? `<img class="fp-logo-img" src="${logoSrc}" alt="Fitness Park">`
      : `<div class="fp-logo">FITNESS <em>PARK</em></div>`;

    const tb = document.createElement('div');
    tb.className = 'fp-mobile-topbar';
    tb.innerHTML = `
      ${logoHtml}
      <div class="fp-search-pill" id="fpSearchPill">
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        <span>Bucarest…</span>
      </div>
      <div class="fp-avatar" id="fpAvatar">P</div>
    `;
    document.body.appendChild(tb);

    const cu = (() => { try { return JSON.parse(sessionStorage.getItem('fpCurrentUser') || 'null'); } catch { return null; } })();
    if (cu) qs('#fpAvatar').textContent = (cu.name || cu.email || '?')[0].toUpperCase();
    qs('#fpAvatar').addEventListener('click', () => {
      if (typeof window.showUserPanel === 'function') window.showUserPanel();
    });
    qs('#fpSearchPill').addEventListener('click', openSearchOverlay);
  }

  // ─── SEARCH OVERLAY ───────────────────────────────────────────
  function buildSearchOverlay() {
    if (qs('.fp-mobile-search-overlay')) return;
    const ov = document.createElement('div');
    ov.className = 'fp-mobile-search-overlay';
    ov.innerHTML = `
      <div class="row">
        <div class="back-btn" id="fpSearchBack">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="m15 18-6-6 6-6"/>
          </svg>
        </div>
        <input type="text" id="fpSearchInput" placeholder="Rechercher une adresse à Bucarest…" autocomplete="off">
      </div>
      <div class="results" id="fpSearchResults"></div>
    `;
    document.body.appendChild(ov);

    qs('#fpSearchBack').addEventListener('click', closeSearchOverlay);
    const input = qs('#fpSearchInput');
    const realInput = qs('#searchInput');
    if (realInput) {
      input.addEventListener('input', (e) => {
        realInput.value = e.target.value;
        realInput.dispatchEvent(new Event('input', { bubbles: true }));
        setTimeout(() => {
          const src = qs('#searchResults');
          const dst = qs('#fpSearchResults');
          if (src && dst) dst.innerHTML = src.innerHTML;
        }, 350);
      });
      qs('#fpSearchResults').addEventListener('click', () => setTimeout(closeSearchOverlay, 150));
    }
  }
  function openSearchOverlay() {
    qs('.fp-mobile-search-overlay')?.classList.add('on');
    setTimeout(() => qs('#fpSearchInput')?.focus(), 50);
  }
  function closeSearchOverlay() {
    qs('.fp-mobile-search-overlay')?.classList.remove('on');
  }

  // ─── SHEET + CAROUSEL ─────────────────────────────────────────
  function buildSheet() {
    if (qs('.fp-sheet')) return;
    sheet = document.createElement('div');
    sheet.className = 'fp-sheet';
    sheet.dataset.state = 'peek';
    sheet.innerHTML = `
      <div class="fp-sheet-handle" role="button" aria-label="Glisser pour redimensionner"></div>
      <div class="fp-sheet-carousel" id="fpCarousel"></div>
      <div class="fp-sheet-detail-scroll" id="fpDetail"></div>
    `;
    document.body.appendChild(sheet);

    renderCarousel();
    wireHandle();
    wireCarouselScroll();
  }

  function renderCarousel() {
    const car = qs('#fpCarousel');
    if (!car) return;
    const sites = getAllSites();
    if (sites.length === 0) {
      car.innerHTML = `<div class="fp-site-card"><div class="fp-site-name">Chargement…</div></div>`;
      return;
    }
    car.innerHTML = sites.map((t, i) => renderCard(t, i, analyses[i])).join('');
    qsa('.fp-site-card', car).forEach(card => {
      card.addEventListener('click', () => {
        const i = parseInt(card.dataset.idx);
        if (i === activeIdx && state === 'peek') {
          transitionTo('summary');
        } else {
          activateSite(i, true);
        }
      });
    });
  }

  function renderCard(t, i, a) {
    const verdict = a?.verdict || 'loading';
    const verClass = 'fp-verdict ' + verdictClass(verdict);
    const verLabel = verdict === 'loading' ? '…' : verdict.replace('GO CONDITIONNEL', 'GO COND');
    const irr = a ? fmtPct(a.irrBase) : '—';
    const irrClass = a?.irrBase > 0 ? 'good' : (a?.irrBase < 0 ? 'bad' : '');
    const members = a ? fmtNum(a.members) : '—';
    const be = a?.beBase ? a.beBase + ' mo' : '—';
    const npv = a ? fmtM(a.npvBase) : '—';

    return `
      <div class="fp-site-card ${i === activeIdx ? 'active' : ''}" data-idx="${i}">
        <div class="fp-site-head">
          <div>
            <div class="fp-site-num">SITE ${i + 1}</div>
            <div class="fp-site-name">${t.name}</div>
          </div>
          <span class="${verClass}">${verLabel}</span>
        </div>
        <div class="fp-site-meta">
          <span>Secteur <b>${t.sector}</b></span>
          <span>Phase <b>${t.phase}</b></span>
          <span>${t.opening || ''}</span>
        </div>
        <div class="fp-mini-metrics">
          <div class="fp-mini-metric"><div class="v">${members}</div><div class="l">Membres</div></div>
          <div class="fp-mini-metric ${irrClass}"><div class="v">${irr}</div><div class="l">IRR</div></div>
          <div class="fp-mini-metric"><div class="v">${npv}</div><div class="l">NPV</div></div>
        </div>
        <button class="fp-detail-cta" data-cta="detail">
          Voir l'analyse complète
          <svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
        </button>
      </div>
    `;
  }

  function verdictClass(v) {
    if (!v) return 'loading';
    const s = String(v).toUpperCase();
    if (s === 'GO') return 'go';
    if (s.includes('GO COND') || s.includes('CONDITIONNEL')) return 'go-cond';
    if (s.includes('WATCH')) return 'watch';
    if (s.includes('NO-GO') || s.includes('NO GO')) return 'no-go';
    return 'loading';
  }

  // ─── SHEET STATE TRANSITIONS (with parallax map zoom) ──────────
  function transitionTo(newState) {
    if (!sheet) return;
    state = newState;
    sheet.dataset.state = newState;
    document.body.classList.remove('fp-sheet-peek','fp-sheet-summary','fp-sheet-detail');
    document.body.classList.add('fp-sheet-' + newState);

    if (newState === 'peek')    sheet.style.height = 'var(--peek-h)';
    if (newState === 'summary') sheet.style.height = 'var(--summary-h)';
    if (newState === 'detail') {
      sheet.style.height = 'var(--detail-h)';
      buildDetail();
      setTimeout(() => wirePullDownDismiss(), 100);
    }

    // Parallax: subtle scale on the map as sheet grows (gives depth)
    const scaleByState = { peek: 1.0, summary: 0.97, detail: 0.92 };
    document.documentElement.style.setProperty('--map-parallax', scaleByState[newState] || 1);

    haptic(8);

    // Invalidate map size after transition
    setTimeout(() => {
      if (window._fpMap?.invalidateSize) window._fpMap.invalidateSize();
    }, 450);
  }

  // ─── HANDLE DRAG ───────────────────────────────────────────────
  function wireHandle() {
    const handle = qs('.fp-sheet-handle');
    if (!handle || handle.__wired) return;
    handle.__wired = true;

    let startY = 0, startH = 0, dragging = false, moved = false;

    const snaps = () => ({
      peek:    parseInt(getComputedStyle(document.documentElement).getPropertyValue('--peek-h')) || 168,
      summary: Math.round(window.innerHeight * 0.58),
      detail:  window.innerHeight - 72
    });

    function start(y) {
      dragging = true; moved = false;
      startY = y;
      startH = sheet.offsetHeight;
      sheet.classList.add('dragging');
    }
    function move(y) {
      if (!dragging) return;
      const dy = startY - y;
      if (Math.abs(dy) > 8) moved = true;
      const h = Math.max(80, Math.min(window.innerHeight - 40, startH + dy));
      sheet.style.height = h + 'px';
    }
    function end() {
      if (!dragging) return;
      dragging = false;
      sheet.classList.remove('dragging');
      const h = sheet.offsetHeight;
      const sp = snaps();
      const candidates = [['peek', sp.peek], ['summary', sp.summary], ['detail', sp.detail]];
      let best = candidates[0], bestD = Infinity;
      for (const [name, val] of candidates) {
        const d = Math.abs(h - val);
        if (d < bestD) { bestD = d; best = [name, val]; }
      }
      transitionTo(best[0]);
    }

    handle.addEventListener('touchstart', (e) => start(e.touches[0].clientY), { passive: true });
    handle.addEventListener('touchmove',  (e) => move(e.touches[0].clientY), { passive: true });
    handle.addEventListener('touchend',   end);
    handle.addEventListener('mousedown',  (e) => { start(e.clientY); e.preventDefault(); });
    window.addEventListener('mousemove',  (e) => dragging && move(e.clientY));
    window.addEventListener('mouseup',    end);
    handle.addEventListener('click', (e) => {
      if (moved) return;
      // Cycle: peek → summary → detail → peek
      transitionTo(state === 'peek' ? 'summary' : state === 'summary' ? 'detail' : 'peek');
    });
  }

  // ─── CAROUSEL SCROLL SYNC (with map fly-to) ────────────────────
  function wireCarouselScroll() {
    const car = qs('#fpCarousel');
    if (!car) return;

    let scrollTimeout, liveTimeout;

    // Live detection during scroll — updates pin highlight AND map view in real time
    // using setView(animate:false) to avoid Leaflet flyTo freeze/white-flash.
    car.addEventListener('scroll', () => {
      if (state !== 'peek') return;
      clearTimeout(liveTimeout);
      liveTimeout = setTimeout(() => {
        const best = detectCenteredCard(car);
        if (best !== -1 && best !== activeIdx) {
          activeIdx = best;
          updatePinHighlight();
          updateActiveCardUI();
          // Instant map recenter — zero lag during rapid swipes
          flyMapToActive(0, true);
        }
      }, 30);

      // After scroll settles, smooth finishing pan + haptic
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        const best = detectCenteredCard(car);
        if (best !== -1) {
          activeIdx = best;
          flyMapToActive(.3);
          haptic(10);
        }
      }, 220);
    }, { passive: true });

    // Delegate CTA clicks (tap → detail)
    car.addEventListener('click', (e) => {
      if (e.target.closest('[data-cta="detail"]')) {
        e.stopPropagation();
        haptic(15);
        transitionTo('detail');
      }
    });
  }

  function detectCenteredCard(car) {
    const cards = qsa('.fp-site-card', car);
    if (cards.length === 0) return -1;
    const carRect = car.getBoundingClientRect();
    const mid = carRect.left + carRect.width / 2;
    let best = -1, bestD = Infinity;
    cards.forEach((c, i) => {
      const r = c.getBoundingClientRect();
      const cMid = r.left + r.width / 2;
      const d = Math.abs(cMid - mid);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  function updatePinHighlight() {
    pinMarkers.forEach((m, idx) => {
      const el = m.getElement?.();
      if (el) {
        const inner = el.querySelector('.fp-target-pin');
        if (inner) inner.classList.toggle('active', idx === activeIdx);
      }
    });
  }
  function updateActiveCardUI() {
    qsa('.fp-site-card').forEach((c, idx) => c.classList.toggle('active', idx === activeIdx));
  }

  // When user is rapidly swiping the carousel, we use setView (instant, no animation)
  // to avoid the Leaflet flyTo freeze. A smooth pan is only used on an explicit tap
  // (big distance) or when the map is stationary long enough to animate nicely.
  function flyMapToActive(duration, instant) {
    if (!window._fpMap) return;
    const sites = getAllSites();
    const t = sites[activeIdx];
    if (!t) return;
    const cur = window._fpMap.getCenter();
    const dist = Math.hypot(cur.lat - t.lat, cur.lng - t.lng);
    if (instant) {
      // Hard setView, no animation — zero lag, perfect for rapid swipes
      window._fpMap.setView([t.lat, t.lng], Math.max(window._fpMap.getZoom(), 13), { animate: false });
    } else if (dist > 0.03) {
      // Short panTo (kinder on rendering than flyTo which re-projects everything)
      window._fpMap.panTo([t.lat, t.lng], { animate: true, duration: duration || .45 });
    } else {
      window._fpMap.panTo([t.lat, t.lng], { animate: true, duration: duration || .3 });
    }
  }

  // Pre-warm tile cache by briefly touching bounds that cover all target sites.
  // Leaflet will load tiles in this area, so subsequent setViews feel instant.
  function prewarmTiles() {
    if (!window._fpMap || !L) return;
    try {
      const sites = getAllSites();
      if (sites.length === 0) return;
      const bounds = L.latLngBounds(sites.map(s => [s.lat, s.lng]));
      // fitBounds with no animation — triggers tile load without moving the visible view
      const origCenter = window._fpMap.getCenter();
      const origZoom = window._fpMap.getZoom();
      window._fpMap.fitBounds(bounds.pad(0.25), { animate: false, padding: [60, 60] });
      // Restore the original Bucharest-wide view after a micro-delay
      setTimeout(() => {
        window._fpMap.setView(origCenter, origZoom, { animate: false });
      }, 50);
    } catch (e) { console.warn('[FP mobile] prewarm failed:', e); }
  }

  // ─── HAPTIC FEEDBACK ───────────────────────────────────────────
  function haptic(ms) {
    try { navigator.vibrate?.(ms); } catch {}
  }

  // ─── ACTIVATE SITE ─────────────────────────────────────────────
  function activateSite(i, flyTo) {
    const sites = getAllSites();
    if (!sites[i]) return;
    activeIdx = i;

    updatePinHighlight();
    updateActiveCardUI();

    const car = qs('#fpCarousel');
    const card = qsa('.fp-site-card', car)[i];
    if (car && card && flyTo) {
      const targetLeft = card.offsetLeft - (car.offsetWidth - card.offsetWidth) / 2;
      car.scrollTo({ left: targetLeft, behavior: 'smooth' });
    }

    ensureAnalysis(i);
    if (flyTo) flyMapToActive(.5);
    haptic(12);
    window.dispatchEvent(new CustomEvent('fp:site-activated', { detail: { index: i, target: sites[i] } }));
  }

  // Hide competitor clusters on mobile — focus stays on the FP targets.
  // The `allComps` array still populates (needed for analysis), we just
  // keep them invisible on the map until user explicitly enables.
  function hideCompetitorMarkers() {
    try {
      if (typeof compCluster !== 'undefined' && compCluster) compCluster.clearLayers();
      if (typeof layers !== 'undefined') layers.competitors = false;
      const tgl = document.getElementById('tglCompetitors');
      if (tgl) tgl.classList.remove('on');
    } catch {}
  }

  function ensureAnalysis(i) {
    if (analyses[i]) { refreshCard(i); return; }
    if (typeof runCaptageAnalysis !== 'function') return;
    if (typeof computeExecSummary !== 'function') return;
    if (typeof loadAllCompetitors !== 'function') return;
    const sites = getAllSites();
    const t = sites[i];
    if (!t) return;
    const doIt = () => {
      try {
        const r = runCaptageAnalysis(t.lat, t.lng, 3000);
        const exec = computeExecSummary(r);
        analyses[i] = {
          members: r.totalTheorique,
          irrBase: r.pnl?.base?.irr,
          npvBase: r.pnl?.base?.npv,
          beBase: r.pnl?.base?.breakevenMonth,
          verdict: typeof exec.verdict === 'object' ? exec.verdict.label : exec.verdict,
          score: exec.total,
          raw: r
        };
        refreshCard(i);
        hideCompetitorMarkers(); // keep the map clean post-analysis
      } catch (e) { console.warn('[FP mobile] analysis failed:', e); }
    };
    if (typeof allComps !== 'undefined' && allComps && allComps.length > 0) {
      doIt();
    } else {
      loadAllCompetitors().then(() => { hideCompetitorMarkers(); doIt(); });
    }
  }

  function refreshCard(i) {
    const card = qsa('.fp-site-card')[i];
    if (!card) return;
    const sites = getAllSites();
    const t = sites[i];
    if (!t) return;
    card.outerHTML = renderCard(t, i, analyses[i]);
    const newCard = qsa('.fp-site-card')[i];
    if (newCard) {
      newCard.classList.toggle('active', i === activeIdx);
      newCard.addEventListener('click', () => {
        if (i === activeIdx && state === 'peek') transitionTo('summary');
        else activateSite(i, true);
      });
    }
  }

  // ─── DETAIL VIEW (accordion) ──────────────────────────────────
  function buildDetail() {
    const det = qs('#fpDetail');
    if (!det) return;
    const sites = getAllSites();
    const t = sites[activeIdx];
    const a = analyses[activeIdx];
    if (!t) return;
    if (!a || !a.raw) {
      det.innerHTML = '<p style="padding:40px 20px;text-align:center;color:var(--gray)">Calcul en cours…</p>';
      setTimeout(() => { ensureAnalysis(activeIdx); buildDetail(); }, 600);
      return;
    }
    const r = a.raw;
    const sazFlux = Math.round(r.saz?.flux || 0);
    const sazDens = Math.round(r.saz?.densite || 0);
    const sazYouth = Math.round(r.saz?.jeunesse || 0);
    const score = a.score;
    const verClass = verdictClass(a.verdict);

    const totalSites = sites.length;
    const prevIdx = (activeIdx - 1 + totalSites) % totalSites;
    const nextIdx = (activeIdx + 1) % totalSites;

    det.innerHTML = `
      <div class="fp-detail-header">
        <div class="fp-detail-back" id="fpDetailBack" aria-label="Retour">
          <svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>
        </div>
        <div class="fp-detail-title">
          <div class="t">${t.name}</div>
          <div class="s">Secteur ${t.sector} · Phase ${t.phase} · ${activeIdx + 1} / ${totalSites}</div>
        </div>
        <span class="fp-verdict ${verClass}" style="font-size:10px">${String(a.verdict).replace('GO CONDITIONNEL', 'GO COND')}</span>
      </div>
      <div class="fp-detail-nav">
        <button class="fp-detail-nav-btn" data-dir="prev" aria-label="Site précédent">
          <svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>
          <span class="fp-nav-label">${sites[prevIdx].name}</span>
        </button>
        <div class="fp-detail-nav-sep"></div>
        <button class="fp-detail-nav-btn next" data-dir="next" aria-label="Site suivant">
          <span class="fp-nav-label">${sites[nextIdx].name}</span>
          <svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>
        </button>
      </div>

      <!-- KEY METRICS HERO -->
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:14px">
        <div style="background:linear-gradient(135deg,rgba(30,41,59,.8) 0%,rgba(17,24,39,.4) 100%);border:1px solid var(--border);border-radius:12px;padding:14px">
          <div style="font-size:10px;color:var(--gray2);text-transform:uppercase;letter-spacing:.5px">Membres cibles</div>
          <div style="font-size:26px;font-weight:900;color:var(--white);line-height:1.1;margin-top:4px">${fmtNum(a.members)}</div>
          <div style="font-size:10px;color:var(--gray);margin-top:2px">${fmtNum(r.pessimiste)} – ${fmtNum(r.optimiste)}</div>
        </div>
        <div style="background:linear-gradient(135deg,rgba(30,41,59,.8) 0%,rgba(17,24,39,.4) 100%);border:1px solid var(--border);border-radius:12px;padding:14px">
          <div style="font-size:10px;color:var(--gray2);text-transform:uppercase;letter-spacing:.5px">IRR base</div>
          <div style="font-size:26px;font-weight:900;color:${a.irrBase > 0 ? '#34d399' : '#f87171'};line-height:1.1;margin-top:4px">${fmtPct(a.irrBase)}</div>
          <div style="font-size:10px;color:var(--gray);margin-top:2px">Payback ${a.beBase ? a.beBase+' mois' : '—'}</div>
        </div>
        <div style="background:linear-gradient(135deg,rgba(30,41,59,.8) 0%,rgba(17,24,39,.4) 100%);border:1px solid var(--border);border-radius:12px;padding:14px">
          <div style="font-size:10px;color:var(--gray2);text-transform:uppercase;letter-spacing:.5px">NPV 5 ans</div>
          <div style="font-size:22px;font-weight:900;color:${a.npvBase > 0 ? '#34d399' : '#f87171'};line-height:1.1;margin-top:4px">${fmtM(a.npvBase)}</div>
          <div style="font-size:10px;color:var(--gray);margin-top:2px">Scénario base</div>
        </div>
        <div style="background:linear-gradient(135deg,rgba(30,41,59,.8) 0%,rgba(17,24,39,.4) 100%);border:1px solid var(--border);border-radius:12px;padding:14px">
          <div style="font-size:10px;color:var(--gray2);text-transform:uppercase;letter-spacing:.5px">Score SAZ</div>
          <div style="font-size:26px;font-weight:900;color:var(--accent);line-height:1.1;margin-top:4px">${Math.round(score)}<span style="font-size:13px;color:var(--gray2);font-weight:600">/100</span></div>
          <div style="font-size:10px;color:var(--gray);margin-top:2px">Attractivité zone</div>
        </div>
      </div>

      <!-- ACCORDION SECTIONS -->
      <div class="fp-accordion" id="fpAccordion">
        <div class="fp-accordion-item open" data-sec="loc">
          <div class="fp-accordion-head">
            <div class="icon">📍</div>
            <div class="lbl">Localisation</div>
            <svg class="chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>
          </div>
          <div class="fp-accordion-body">
            <div class="card">
              <div class="metric-row"><span class="metric-label">Coordonnées</span><span class="metric-value">${t.lat.toFixed(4)}, ${t.lng.toFixed(4)}</span></div>
              <div class="metric-row"><span class="metric-label">Secteur</span><span class="metric-value">Secteur ${t.sector}</span></div>
              <div class="metric-row"><span class="metric-label">Surface</span><span class="metric-value">${t.area}</span></div>
              <div class="metric-row"><span class="metric-label">Statut</span><span class="metric-value" style="font-size:11px">${t.status}</span></div>
              <div class="metric-row"><span class="metric-label">Loyer cible</span><span class="metric-value">${t.rent}</span></div>
              <div class="metric-row"><span class="metric-label">Ouverture</span><span class="metric-value">${t.opening || '—'}</span></div>
            </div>
            ${t.note ? `<div class="card" style="padding:10px;font-size:11px;color:var(--gray);line-height:1.5">${t.note}</div>` : ''}
          </div>
        </div>

        <div class="fp-accordion-item" data-sec="saz">
          <div class="fp-accordion-head">
            <div class="icon">🎯</div>
            <div class="lbl">Score attractivité (SAZ)</div>
            <div class="hint">${Math.round(score)}/100</div>
            <svg class="chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>
          </div>
          <div class="fp-accordion-body">
            ${sazRadial(sazFlux, sazDens, sazYouth, score)}
          </div>
        </div>

        <div class="fp-accordion-item" data-sec="demo">
          <div class="fp-accordion-head">
            <div class="icon">👥</div>
            <div class="lbl">Démographie & marché</div>
            <div class="hint">${fmtNum(r.popTarget)} cible</div>
            <svg class="chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>
          </div>
          <div class="fp-accordion-body">
            <div class="card">
              <div class="metric-row"><span class="metric-label">Pop. cible 15-45</span><span class="metric-value">${fmtNum(r.popTarget)}</span></div>
              <div class="metric-row"><span class="metric-label">ARPU blended</span><span class="metric-value">${r.arpu?.toFixed(2)} €/mo</span></div>
              <div class="metric-row"><span class="metric-label">Churn Y1</span><span class="metric-value">${(r.churnY1*100).toFixed(1)}%</span></div>
              <div class="metric-row"><span class="metric-label">Churn Y2+</span><span class="metric-value">${(r.churnRate*100).toFixed(1)}%</span></div>
              <div class="metric-row"><span class="metric-label">LTV</span><span class="metric-value">${fmtNum(r.ltv)} €</span></div>
              <div class="metric-row"><span class="metric-label">LTV / CAC</span><span class="metric-value" style="color:${r.ltvCacRatio > 3 ? '#34d399' : '#f87171'}">${r.ltvCacRatio}×</span></div>
            </div>
          </div>
        </div>

        <div class="fp-accordion-item" data-sec="sources">
          <div class="fp-accordion-head">
            <div class="icon">🔀</div>
            <div class="lbl">Sources de membres</div>
            <div class="hint">${fmtNum(a.members)} total</div>
            <svg class="chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>
          </div>
          <div class="fp-accordion-body">
            <div class="card">
              ${sourceBar('Captifs (concurrents)',    r.totalCaptifs,                     a.members, '#f97316')}
              ${sourceBar('Natifs (nouvelle demande)', r.native?.captured || 0,           a.members, '#22c55e')}
              ${sourceBar('Walk-in (mall)',           r.walkIn?.walkInMembers || 0,       a.members, '#06b6d4')}
              ${(r.destinationBonus?.bonusMembers || 0) > 0 ? sourceBar('Destination (10km)', r.destinationBonus.bonusMembers, a.members, '#a78bfa') : ''}
            </div>
          </div>
        </div>

        <div class="fp-accordion-item" data-sec="pnl">
          <div class="fp-accordion-head">
            <div class="icon">💰</div>
            <div class="lbl">P&L – 3 scénarios</div>
            <div class="hint">${fmtPct(a.irrBase)}</div>
            <svg class="chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>
          </div>
          <div class="fp-accordion-body">
            ${pnlCard(r)}
          </div>
        </div>

        <div class="fp-accordion-item" data-sec="comps">
          <div class="fp-accordion-head">
            <div class="icon">🥊</div>
            <div class="lbl">Concurrents (${r.comps.length})</div>
            <div class="hint">${fmtNum(r.totalCaptifs)} captifs</div>
            <svg class="chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>
          </div>
          <div class="fp-accordion-body">
            ${buildCompsMiniMap(r.comps, t)}
            <div class="card" style="padding:0;margin-top:10px">
              ${r.comps.slice(0, 10).map(c => `
                <div style="padding:10px 12px;border-bottom:1px solid rgba(71,85,115,.2);display:flex;align-items:center;gap:10px">
                  <div style="width:6px;height:34px;background:${c.color};border-radius:2px"></div>
                  <div style="flex:1;min-width:0">
                    <div style="font-size:12px;font-weight:600;color:var(--white);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.name}</div>
                    <div style="font-size:10px;color:var(--gray2)">${c.segment} · ${(c.dist/1000).toFixed(1)}km · ${c.effectiveRate}% capt.</div>
                  </div>
                  <div style="text-align:right;flex-shrink:0">
                    <div style="font-size:13px;font-weight:700;color:var(--accent)">${c.captured}</div>
                    <div style="font-size:9px;color:var(--gray2)">capt.</div>
                  </div>
                </div>
              `).join('')}
              ${r.comps.length > 10 ? `<div style="padding:10px;text-align:center;font-size:11px;color:var(--gray2)">+${r.comps.length - 10} autres</div>` : ''}
            </div>
          </div>
        </div>
      </div>
    `;

    qs('#fpDetailBack').addEventListener('click', () => { haptic(10); transitionTo('summary'); });

    // Prev / Next site navigation buttons
    qsa('.fp-detail-nav-btn', det).forEach(btn => {
      btn.addEventListener('click', () => {
        const dir = btn.dataset.dir;
        const sitesAll = getAllSites();
        const n = sitesAll.length;
        const newIdx = dir === 'next' ? (activeIdx + 1) % n : (activeIdx - 1 + n) % n;
        switchToSiteInDetail(newIdx, dir);
      });
    });

    // Horizontal swipe gesture to switch sites
    wireDetailHorizontalSwipe(det);

    // Accordion toggles with stagger animation + data-driven viz reveal
    qsa('.fp-accordion-item', det).forEach(item => {
      item.querySelector('.fp-accordion-head').addEventListener('click', () => {
        haptic(8);
        const willOpen = !item.classList.contains('open');
        item.classList.toggle('open');
        if (willOpen) {
          // Trigger viz animations when section opens
          setTimeout(() => {
            if (item.dataset.sec === 'saz') animateSazRadial(item);
            if (item.dataset.sec === 'pnl') animateSparkline(item);
          }, 120);
        }
      });
    });

    // Auto-animate SAZ if it's initially open (first accordion = loc, but trigger for any)
    setTimeout(() => {
      qsa('.fp-accordion-item.open', det).forEach(item => {
        if (item.dataset.sec === 'saz') animateSazRadial(item);
        if (item.dataset.sec === 'pnl') animateSparkline(item);
      });
    }, 200);

    // Rent slider live recomputation
    const slider = qs('#fpRentSlider');
    if (slider) {
      slider.addEventListener('input', (e) => onRentSliderChange(e.target.value));
    }

    // Animate the hero metrics in from zero on detail open
    setTimeout(() => {
      const heroCards = qsa('#fpDetail > div[style*="grid-template-columns"] > div');
      if (heroCards.length >= 4) {
        const mNode = heroCards[0].querySelector('div[style*="font-size:26px"]');
        const iNode = heroCards[1].querySelector('div[style*="font-size:26px"]');
        const nNode = heroCards[2].querySelector('div[style*="font-size:22px"]');
        const sNode = heroCards[3].querySelector('div[style*="font-size:26px"]');
        if (mNode) animateNumber(mNode, 0, a.members,  700, v => fmtNum(v));
        if (iNode) animateNumber(iNode, 0, a.irrBase,  700, v => fmtPct(v));
        if (nNode) animateNumber(nNode, 0, a.npvBase,  700, v => fmtM(v));
        if (sNode) animateNumber(sNode, 0, Math.round(a.score), 700, v => Math.round(v));
      }
    }, 80);
  }

  function sazBar(label, score, color) {
    return `
      <div style="display:flex;align-items:center;gap:10px;padding:6px 0">
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:600;color:var(--white)">${label}</div>
          <div style="height:6px;background:var(--card3);border-radius:3px;margin-top:6px;overflow:hidden">
            <div style="height:100%;width:${score}%;background:${color};border-radius:3px;transition:width .6s"></div>
          </div>
        </div>
        <div style="font-size:18px;font-weight:800;color:${color};min-width:40px;text-align:right">${score}</div>
      </div>
    `;
  }

  // ─── SAZ RADIAL CHART (3 concentric rings, Apple Watch style) ──
  function sazRadial(fluxScore, densScore, youthScore, globalScore) {
    // 3 concentric rings: outer=Flux (cyan), mid=Densité (green), inner=Jeunesse (amber)
    // Each ring is a full circle stroke-dashed based on score / 100
    const rings = [
      { score: fluxScore,  color: '#06b6d4', r: 56, label: 'Flux' },
      { score: densScore,  color: '#22c55e', r: 42, label: 'Densité' },
      { score: youthScore, color: '#f59e0b', r: 28, label: 'Jeunesse' }
    ];
    const size = 160;
    const cx = size / 2, cy = size / 2;
    const strokeW = 10;

    const ringsSVG = rings.map((r, idx) => {
      const circ = 2 * Math.PI * r.r;
      // Use CSS var trick: strokeDashoffset animates from `circ` (empty) to `circ * (1 - score/100)` (filled)
      return `
        <circle cx="${cx}" cy="${cy}" r="${r.r}"
                fill="none" stroke="${r.color}33" stroke-width="${strokeW}"/>
        <circle class="fp-radial-ring" data-ring="${idx}"
                cx="${cx}" cy="${cy}" r="${r.r}"
                fill="none" stroke="${r.color}" stroke-width="${strokeW}"
                stroke-dasharray="${circ}" stroke-dashoffset="${circ}"
                stroke-linecap="round"
                style="transform:rotate(-90deg);transform-origin:center;transition:stroke-dashoffset 1.2s cubic-bezier(.22,.9,.3,1);filter:drop-shadow(0 0 8px ${r.color}55)"
                data-target="${circ * (1 - r.score / 100)}"/>
      `;
    }).join('');

    const legend = rings.map(r => `
      <div style="display:flex;align-items:center;gap:8px;padding:4px 0">
        <div style="width:10px;height:10px;border-radius:50%;background:${r.color};box-shadow:0 0 8px ${r.color}88"></div>
        <div style="flex:1;font-size:12px;color:var(--white)">${r.label}</div>
        <div style="font-size:15px;font-weight:800;color:${r.color};font-variant-numeric:tabular-nums">${r.score}</div>
      </div>
    `).join('');

    return `
      <div class="card" style="padding:16px;display:flex;align-items:center;gap:16px">
        <div style="flex-shrink:0;position:relative;width:${size}px;height:${size}px">
          <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="overflow:visible">
            ${ringsSVG}
          </svg>
          <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none">
            <div class="fp-radial-score" style="font-size:30px;font-weight:900;color:var(--accent);line-height:1;font-variant-numeric:tabular-nums">0</div>
            <div style="font-size:9px;color:var(--gray2);text-transform:uppercase;letter-spacing:.5px;margin-top:2px">/ 100</div>
          </div>
        </div>
        <div style="flex:1;min-width:0">
          ${legend}
        </div>
      </div>
    `;
  }
  function sourceBar(label, value, total, color) {
    const pct = total > 0 ? Math.round(value / total * 100) : 0;
    return `
      <div style="display:flex;align-items:center;gap:10px;padding:6px 0">
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:600;color:var(--white);display:flex;justify-content:space-between">
            <span>${label}</span>
            <span style="color:${color};font-weight:700">${fmtNum(value)}</span>
          </div>
          <div style="height:5px;background:var(--card3);border-radius:2.5px;margin-top:6px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:${color};border-radius:2.5px;transition:width .6s"></div>
          </div>
          <div style="font-size:10px;color:var(--gray2);margin-top:2px">${pct}% du total</div>
        </div>
      </div>
    `;
  }
  function pnlCard(r) {
    const scenarios = [
      { key: 'conservateur', label: 'Conservateur', color: '#f87171' },
      { key: 'base',         label: 'Base',         color: 'var(--accent)' },
      { key: 'optimiste',    label: 'Optimiste',    color: '#34d399' }
    ];
    // Rent slider UI — recomputes everything on input
    const currentRent = window._rentOverride?.y1 ?? 10.5;

    // Sparkline: cumulative cashflow over 60 months for BASE scenario
    const spark = buildSparkline(r.pnl?.base);

    return `
      <!-- Cashflow sparkline -->
      ${spark}

      <!-- Rent slider -->
      <div class="card" style="padding:14px 16px;margin-bottom:10px;background:linear-gradient(135deg,rgba(30,41,59,.8),rgba(17,24,39,.4))">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <div>
            <div style="font-size:11px;color:var(--gray2);text-transform:uppercase;letter-spacing:.5px">Loyer Y1</div>
            <div style="font-size:14px;font-weight:700;color:var(--white)">Simulation en temps réel</div>
          </div>
          <div style="text-align:right">
            <div id="fpRentValue" style="font-size:24px;font-weight:900;color:var(--accent);line-height:1">${currentRent.toFixed(1)}<span style="font-size:12px;color:var(--gray)"> €/m²</span></div>
          </div>
        </div>
        <input type="range" id="fpRentSlider" min="5" max="25" step="0.5" value="${currentRent}"
               style="width:100%;accent-color:var(--accent);margin:0">
        <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--gray2);margin-top:4px">
          <span>5 €/m² aggressif</span>
          <span>Marché 10-14</span>
          <span>25 €/m² premium</span>
        </div>
      </div>

      <div class="card" id="fpPnlScenarios" style="padding:0">
        ${scenarios.map(s => {
          const p = r.pnl?.[s.key];
          if (!p) return '';
          return `
            <div style="padding:12px 14px;border-bottom:1px solid rgba(71,85,115,.2)">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                <div style="font-size:12px;font-weight:700;color:${s.color}">${s.label}</div>
                <div class="fp-scenario-irr" data-key="${s.key}" style="font-size:18px;font-weight:900;color:${p.irr > 0 ? '#34d399' : '#f87171'}">${fmtPct(p.irr)}</div>
              </div>
              <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;font-size:10px">
                <div><div style="color:var(--gray2)">NPV</div><div class="fp-scenario-npv" data-key="${s.key}" style="font-weight:700;color:var(--white)">${fmtM(p.npv)}</div></div>
                <div><div style="color:var(--gray2)">Breakeven</div><div class="fp-scenario-be" data-key="${s.key}" style="font-weight:700;color:var(--white)">${p.breakevenMonth ? p.breakevenMonth + ' mo' : '—'}</div></div>
                <div><div style="color:var(--gray2)">Payback</div><div class="fp-scenario-pb" data-key="${s.key}" style="font-weight:700;color:var(--white)">${p.paybackMonth ? p.paybackMonth + ' mo' : '—'}</div></div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  // ─── COMPS MINI-MAP: SVG radar showing comp density around site ──
  function buildCompsMiniMap(comps, target) {
    if (!comps || comps.length === 0 || !target) return '';
    const size = 240;
    const cx = size / 2, cy = size / 2;
    const maxDistKm = 3; // viz within 3km radius (scale up to fit)
    const pxPerKm = (size / 2 - 20) / maxDistKm;

    // Site at center + radius circles
    const ringLabels = [1, 2, 3]; // 1km, 2km, 3km

    // Comps as circles — size = captured, color = segment color
    const dots = comps.slice(0, 40).map((c, idx) => {
      const distKm = c.dist / 1000;
      if (distKm > maxDistKm) return ''; // cap
      // Project (lat,lng) difference onto the canvas preserving relative bearing
      const dLat = c.lat - target.lat;
      const dLng = (c.lng - target.lng) * Math.cos(target.lat * Math.PI / 180);
      const bearing = Math.atan2(dLng, dLat); // radians, 0 = north
      const r = distKm * pxPerKm;
      const x = cx + r * Math.sin(bearing);
      const y = cy - r * Math.cos(bearing);
      const dotR = Math.max(3, Math.min(10, 3 + Math.sqrt(c.captured / 20)));
      return `<circle class="fp-minimap-dot" data-idx="${idx}"
                cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${dotR}"
                fill="${c.color}" fill-opacity=".85"
                stroke="rgba(0,0,0,.4)" stroke-width="1"
                style="filter:drop-shadow(0 0 4px ${c.color}66);transition:transform .3s"/>`;
    }).join('');

    return `
      <div class="card" style="padding:14px 14px 4px;background:linear-gradient(180deg,rgba(30,41,59,.4),rgba(17,24,39,.1))">
        <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:8px">
          <div>
            <div style="font-size:11px;color:var(--gray2);text-transform:uppercase;letter-spacing:.5px">Densité concurrentielle</div>
            <div style="font-size:13px;font-weight:700;color:var(--white);margin-top:2px">Rayon 3 km</div>
          </div>
          <div style="font-size:11px;color:var(--gray)">taille = captifs</div>
        </div>
        <svg width="100%" viewBox="0 0 ${size} ${size}" style="display:block;max-width:${size}px;margin:0 auto">
          <defs>
            <radialGradient id="fpMinimapBg" cx="50%" cy="50%">
              <stop offset="0%"  stop-color="rgba(212,160,23,.15)"/>
              <stop offset="100%" stop-color="rgba(6,8,15,0)"/>
            </radialGradient>
          </defs>
          <!-- Background glow at center -->
          <circle cx="${cx}" cy="${cy}" r="${size/2 - 10}" fill="url(#fpMinimapBg)"/>

          <!-- Distance rings -->
          ${ringLabels.map(km => `
            <circle cx="${cx}" cy="${cy}" r="${km * pxPerKm}"
                    fill="none" stroke="rgba(148,163,184,.2)" stroke-width="1" stroke-dasharray="2 3"/>
            <text x="${cx + km * pxPerKm - 3}" y="${cy - 2}" fill="rgba(148,163,184,.5)" font-size="8" text-anchor="end">${km}km</text>
          `).join('')}

          <!-- Axis lines -->
          <line x1="${pad(10)}" y1="${cy}" x2="${size - 10}" y2="${cy}" stroke="rgba(148,163,184,.15)" stroke-width="1"/>
          <line x1="${cx}" y1="10" x2="${cx}" y2="${size - 10}" stroke="rgba(148,163,184,.15)" stroke-width="1"/>

          <!-- Competitor dots -->
          ${dots}

          <!-- FP site marker at center -->
          <circle cx="${cx}" cy="${cy}" r="14" fill="rgba(212,160,23,.3)"/>
          <circle cx="${cx}" cy="${cy}" r="10" fill="var(--accent)" stroke="white" stroke-width="2"
                  style="filter:drop-shadow(0 0 8px rgba(212,160,23,.6))">
            <animate attributeName="r" values="10;12;10" dur="2s" repeatCount="indefinite"/>
          </circle>
          <text x="${cx}" y="${cy + 4}" fill="#000" font-size="12" font-weight="900" text-anchor="middle">FP</text>

          <!-- N/S/E/W compass hints -->
          <text x="${cx}" y="14" fill="rgba(148,163,184,.4)" font-size="9" text-anchor="middle" font-weight="600">N</text>
        </svg>
      </div>
    `;
  }
  function pad(v) { return v; } // used above in mini-map

  // ─── SPARKLINE: cumulative cashflow over 60 months ─────────────
  function buildSparkline(pnlBase) {
    if (!pnlBase || !Array.isArray(pnlBase.monthly) || pnlBase.monthly.length < 2) return '';
    // Use pre-computed cumulCashFlow per monthly entry (from buildPnL)
    const cum = pnlBase.monthly.map(m => m.cumulCashFlow || 0);

    const w = 300, h = 100, pad = 10;
    const minV = Math.min(...cum, 0);
    const maxV = Math.max(...cum, 0);
    const range = maxV - minV || 1;
    const xs = cum.length;

    // Zero line y
    const zeroY = h - pad - ((0 - minV) / range) * (h - 2 * pad);

    // Build path points
    const pts = cum.map((v, i) => {
      const x = pad + (i / (xs - 1)) * (w - 2 * pad);
      const y = h - pad - ((v - minV) / range) * (h - 2 * pad);
      return [x, y];
    });
    const pathD = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');

    // Find breakeven: first index where cum crosses 0 upward
    let beMonth = pnlBase.breakevenMonth || null;
    let beX = null;
    if (beMonth && beMonth < xs) {
      beX = pad + (beMonth / (xs - 1)) * (w - 2 * pad);
    }

    // Fill area below line (subtle)
    const areaD = pathD + ' L' + pts[pts.length - 1][0].toFixed(1) + ',' + (h - pad) + ' L' + pad + ',' + (h - pad) + ' Z';

    const endValue = cum[cum.length - 1];
    const endColor = endValue >= 0 ? '#34d399' : '#f87171';
    const endLabel = endValue >= 0 ? 'profit net 5 ans' : 'perte nette 5 ans';
    const capex = pnlBase.capex || 0;

    return `
      <div class="card" style="padding:14px;margin-bottom:10px;background:linear-gradient(180deg,rgba(30,41,59,.4),rgba(17,24,39,.2))">
        <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:6px">
          <div>
            <div style="font-size:11px;color:var(--gray2);text-transform:uppercase;letter-spacing:.5px;display:flex;align-items:center;gap:6px">
              Profit cumulé
              <span class="info-tip" style="display:inline-flex;width:16px;height:16px;border-radius:50%;background:var(--card3);color:var(--gray);align-items:center;justify-content:center;font-size:10px;font-weight:700;cursor:pointer">?
                <div class="tip-content"><strong>Profit cumulé sur 5 ans</strong><br><br>
                  Somme des flux mensuels (recettes − dépenses − loyer − staff − redevance) <strong>après déduction du CAPEX initial</strong> (~${fmtM(capex)} EUR d'investissement).<br><br>
                  <b style="color:#34d399">Positif</b> = le club est rentable sur 5 ans : tu récupères ton investissement + tu génères du profit.<br>
                  <b style="color:#f87171">Négatif</b> = tu es encore en train de rembourser le CAPEX à la fin des 5 ans.<br><br>
                  <div style="color:var(--gray2);font-size:11px">Le "BE Xmo" sur la ligne indique le mois où le cashflow devient positif (breakeven opérationnel).</div>
                </div>
              </span>
            </div>
            <div style="font-size:13px;font-weight:700;color:var(--white);margin-top:2px">60 mois · Scénario base</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:18px;font-weight:900;color:${endColor};line-height:1">${fmtM(endValue)}</div>
            <div style="font-size:10px;color:var(--gray2);margin-top:2px">${endLabel}</div>
          </div>
        </div>
        <svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="display:block">
          <defs>
            <linearGradient id="fpSparkGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%"  stop-color="${endColor}" stop-opacity=".35"/>
              <stop offset="100%" stop-color="${endColor}" stop-opacity="0"/>
            </linearGradient>
          </defs>
          <!-- Zero baseline -->
          <line x1="${pad}" y1="${zeroY.toFixed(1)}" x2="${w - pad}" y2="${zeroY.toFixed(1)}"
                stroke="rgba(148,163,184,.3)" stroke-width="1" stroke-dasharray="2 3"/>
          <!-- Breakeven vertical line -->
          ${beX !== null ? `<line x1="${beX.toFixed(1)}" y1="${pad}" x2="${beX.toFixed(1)}" y2="${h - pad}"
                stroke="${endColor}" stroke-width="1" stroke-dasharray="3 2" opacity=".5"/>
                <text x="${beX.toFixed(1)}" y="${pad + 10}" fill="${endColor}" font-size="9" text-anchor="middle" opacity=".8">BE ${beMonth}mo</text>` : ''}
          <!-- Filled area -->
          <path d="${areaD}" fill="url(#fpSparkGrad)" opacity=".6"/>
          <!-- The line -->
          <path class="fp-sparkline-path" d="${pathD}" fill="none" stroke="${endColor}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" style="filter:drop-shadow(0 0 4px ${endColor}66)"/>
          <!-- End point dot -->
          <circle cx="${pts[pts.length - 1][0].toFixed(1)}" cy="${pts[pts.length - 1][1].toFixed(1)}" r="3" fill="${endColor}"/>
        </svg>
      </div>
    `;
  }

  // ─── Live rent recalc (triggered by slider) ────────────────────
  let rentDebounce;
  function onRentSliderChange(val) {
    const v = parseFloat(val);
    qs('#fpRentValue').innerHTML = v.toFixed(1) + '<span style="font-size:12px;color:var(--gray)"> €/m²</span>';
    haptic(4); // subtle tick per step
    clearTimeout(rentDebounce);
    rentDebounce = setTimeout(() => recomputeCurrentAnalysis(v), 90);
  }
  function recomputeCurrentAnalysis(rentY1) {
    try {
      window._rentOverride = { y1: rentY1 };
      const t = TARGETS[activeIdx];
      const r = runCaptageAnalysis(t.lat, t.lng, 3000);
      const exec = computeExecSummary(r);
      const a = analyses[activeIdx];
      const oldMembers = a?.members, oldIrr = a?.irrBase, oldNpv = a?.npvBase;
      if (a) {
        a.members  = r.totalTheorique;
        a.irrBase  = r.pnl?.base?.irr;
        a.npvBase  = r.pnl?.base?.npv;
        a.beBase   = r.pnl?.base?.breakevenMonth;
        a.verdict  = typeof exec.verdict === 'object' ? exec.verdict.label : exec.verdict;
        a.score    = exec.total;
        a.raw      = r;
      }
      // Update the active site card
      refreshCard(activeIdx);
      // Update hero metric cards (top of detail view) with animated counters
      updateDetailHero(r, a, { oldMembers, oldIrr, oldNpv });
      // Update P&L scenarios inline
      updatePnLInline(r);
      // Re-run invariants check (via audit wrapper automatic)
    } catch (e) { console.warn('[FP rent-slider] recompute failed:', e); }
  }

  function updateDetailHero(r, a, prev) {
    const container = qs('#fpDetail');
    if (!container) return;
    // Find the 4 hero cards — they have labels in uppercase
    const heroCards = qsa('#fpDetail > div[style*="grid-template-columns"] > div');
    // Cards order: Membres, IRR, NPV, SAZ
    if (heroCards.length >= 4) {
      const mNode = heroCards[0].querySelector('div[style*="font-size:26px"]');
      const iNode = heroCards[1].querySelector('div[style*="font-size:26px"]');
      const nNode = heroCards[2].querySelector('div[style*="font-size:22px"]');
      const sNode = heroCards[3].querySelector('div[style*="font-size:26px"]');
      if (mNode) animateNumber(mNode, prev.oldMembers || 0, a.members, 500, (v) => fmtNum(v));
      if (iNode) {
        iNode.style.color = (a.irrBase > 0 ? '#34d399' : '#f87171');
        animateNumber(iNode, prev.oldIrr || 0, a.irrBase, 500, (v) => fmtPct(v));
      }
      if (nNode) {
        nNode.style.color = (a.npvBase > 0 ? '#34d399' : '#f87171');
        animateNumber(nNode, prev.oldNpv || 0, a.npvBase, 500, (v) => fmtM(v));
      }
      if (sNode) sNode.textContent = Math.round(a.score);
      // Also update Payback hint
      const pbHint = heroCards[1].querySelector('div[style*="font-size:10px"][style*="color:var(--gray)"]');
      if (pbHint) pbHint.textContent = 'Payback ' + (a.beBase ? a.beBase + ' mois' : '—');
    }
  }

  function updatePnLInline(r) {
    ['conservateur','base','optimiste'].forEach(key => {
      const p = r.pnl?.[key];
      if (!p) return;
      const irrEl = qs(`.fp-scenario-irr[data-key="${key}"]`);
      const npvEl = qs(`.fp-scenario-npv[data-key="${key}"]`);
      const beEl  = qs(`.fp-scenario-be[data-key="${key}"]`);
      const pbEl  = qs(`.fp-scenario-pb[data-key="${key}"]`);
      if (irrEl) { irrEl.textContent = fmtPct(p.irr); irrEl.style.color = p.irr > 0 ? '#34d399' : '#f87171'; }
      if (npvEl) npvEl.textContent = fmtM(p.npv);
      if (beEl)  beEl.textContent  = p.breakevenMonth ? p.breakevenMonth + ' mo' : '—';
      if (pbEl)  pbEl.textContent  = p.paybackMonth ? p.paybackMonth + ' mo' : '—';
    });
  }

  // ─── SAZ RADIAL: animate rings from empty to filled ────────────
  function animateSazRadial(container) {
    const rings = qsa('.fp-radial-ring', container);
    // Stagger reveal per ring
    rings.forEach((ring, i) => {
      setTimeout(() => {
        ring.style.strokeDashoffset = ring.dataset.target;
      }, i * 140);
    });
    // Animate the center score number
    const scoreEl = container.querySelector('.fp-radial-score');
    if (scoreEl) {
      // Score was stored as the 4th arg in the accordion hint — pull from data
      const hint = container.querySelector('.fp-accordion-head .hint')?.textContent || '0';
      const targetScore = parseInt(hint);
      animateNumber(scoreEl, 0, targetScore, 900, v => Math.round(v));
    }
  }

  // ─── SPARKLINE: animate stroke reveal ──────────────────────────
  function animateSparkline(container) {
    const paths = qsa('.fp-sparkline-path', container);
    paths.forEach(path => {
      const len = path.getTotalLength?.() || 0;
      path.style.strokeDasharray = len;
      path.style.strokeDashoffset = len;
      // Force reflow
      path.getBoundingClientRect();
      path.style.transition = 'stroke-dashoffset 1.2s cubic-bezier(.22,.9,.3,1)';
      path.style.strokeDashoffset = 0;
    });
  }

  // ─── ANIMATED NUMBER COUNTING ──────────────────────────────────
  function animateNumber(el, from, to, duration, formatter) {
    if (!el) return;
    from = isFinite(from) ? from : 0;
    to = isFinite(to) ? to : 0;
    const start = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 3); // ease-out-cubic
    let rafId = null;
    function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      el.textContent = formatter(from + (to - from) * ease(t));
      if (t < 1) rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);
    // Safety fallback: guarantee final value is set even if rAF is throttled
    // (background tabs, some headless environments, older browsers)
    setTimeout(() => {
      if (rafId) cancelAnimationFrame(rafId);
      el.textContent = formatter(to);
    }, duration + 200);
  }

  // ─── FAB + SECONDARY SHEET ─────────────────────────────────────
  function buildFab() {
    if (qs('.fp-mobile-fab')) return;
    const fab = document.createElement('div');
    fab.className = 'fp-mobile-fab';
    fab.innerHTML = `<svg viewBox="0 0 24 24"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>`;
    fab.setAttribute('aria-label', 'Outils & couches');
    document.body.appendChild(fab);
    fab.addEventListener('click', openSecondarySheet);
  }

  function buildSecondarySheet() {
    if (qs('.fp-secondary-sheet')) return;
    // Backdrop
    const bd = document.createElement('div');
    bd.className = 'fp-secondary-backdrop';
    bd.addEventListener('click', closeSecondarySheet);
    document.body.appendChild(bd);

    // Sheet
    const sh = document.createElement('div');
    sh.className = 'fp-secondary-sheet';
    sh.innerHTML = `
      <div class="head">
        <div class="title">Outils & couches</div>
        <div class="close-btn" id="fpSecondaryClose">&times;</div>
      </div>
      <div class="fp-secondary-tabs" id="fpSecondaryTabs">
        <div class="fp-secondary-tab active" data-stab="layers">🗺️ Couches</div>
        <div class="fp-secondary-tab" data-stab="concurrence">🏋️ Concurrence</div>
        <div class="fp-secondary-tab" data-stab="mysites">📌 Mes sites</div>
        <div class="fp-secondary-tab" data-stab="dash">📊 Dashboard</div>
      </div>
      <div class="body" id="fpSecondaryBody"></div>
    `;
    document.body.appendChild(sh);

    qs('#fpSecondaryClose').addEventListener('click', closeSecondarySheet);
    qsa('.fp-secondary-tab').forEach(t => {
      t.addEventListener('click', () => switchSecondaryTab(t.dataset.stab));
    });
    switchSecondaryTab('layers');
  }

  function switchSecondaryTab(stab) {
    qsa('.fp-secondary-tab').forEach(t => t.classList.toggle('active', t.dataset.stab === stab));
    const body = qs('#fpSecondaryBody');
    if (!body) return;
    const map = {
      layers: 'tab-explore',
      concurrence: 'tab-compete',
      mysites: 'tab-mysites',
      dash: 'tab-dash'
    };
    const src = document.getElementById(map[stab]);
    if (src) {
      // Clone the tab-panel content, then STRIP all IDs on children
      // to avoid getElementById collisions with the (hidden) desktop copy.
      body.innerHTML = '';
      const clone = src.cloneNode(true);
      clone.id = '';
      clone.style.display = 'block';
      stripAllIds(clone);
      body.appendChild(clone);

      // Sync visual state from global `layers` to the clone's toggles
      syncToggleStates(clone);

      // On any click in the clone, re-sync visual state after the click fires
      clone.addEventListener('click', (e) => {
        if (e.target.closest('.toggle, .layer-label')) {
          // Wait for toggleLayer's own logic to run, then reflect state
          setTimeout(() => syncToggleStates(clone), 10);
        }
      }, true);
    }
  }

  function stripAllIds(root) {
    // Clear any id on children so we don't collide with the desktop sidebar
    const all = root.querySelectorAll('[id]');
    all.forEach(el => el.removeAttribute('id'));
  }

  function syncToggleStates(root) {
    // The clone's toggles have onclick="toggleLayer('xxx')" — reflect `layers[xxx]`
    // onto the toggle's 'on' class. Works for any toggle in the panel.
    if (typeof layers === 'undefined') return;
    const toggles = root.querySelectorAll('.toggle');
    toggles.forEach(t => {
      // Each toggle's onclick is like `toggleLayer('xxxxx')`. Extract the name.
      const onclickStr = t.getAttribute('onclick') || '';
      const m = onclickStr.match(/toggleLayer\s*\(\s*['"]([^'"]+)['"]\s*\)/);
      if (!m) return;
      const name = m[1];
      if (name in layers) {
        t.classList.toggle('on', !!layers[name]);
      }
    });
  }

  function openSecondarySheet() {
    buildSecondarySheet(); // lazy-build
    qs('.fp-secondary-sheet').classList.add('open');
    qs('.fp-secondary-backdrop').classList.add('on');
  }
  function closeSecondarySheet() {
    qs('.fp-secondary-sheet')?.classList.remove('open');
    qs('.fp-secondary-backdrop')?.classList.remove('on');
  }

  // ─── NUMBERED PINS FOR ALL SITES (targets + customs) ───────────
  function buildTargetPins() {
    if (!window._fpMap || typeof L === 'undefined') return;
    // Always rebuild to reflect latest custom sites
    if (pinLayer) {
      try { pinLayer.clearLayers(); } catch {}
    } else {
      pinLayer = L.layerGroup().addTo(window._fpMap);
    }
    pinMarkers = [];

    const sites = getAllSites();
    sites.forEach((t, i) => {
      const isCustom = t._kind === 'custom';
      const icon = L.divIcon({
        className: '',
        html: `<div class="fp-target-pin${i === activeIdx ? ' active' : ''}${isCustom ? ' fp-custom-pin' : ''}">${i + 1}</div>`,
        iconSize: [36, 36], iconAnchor: [18, 18]
      });
      const m = L.marker([t.lat, t.lng], { icon, zIndexOffset: 700 }).addTo(pinLayer);
      m.on('click', () => {
        activateSite(i, false);
        if (state === 'peek') transitionTo('summary');
      });
      pinMarkers.push(m);
    });
  }
  // Expose a public refresh so new custom sites appear immediately
  window._fpMobileRefreshSites = function() {
    renderCarousel();
    buildTargetPins();
  };

  // ─── DETAIL: switch to another site in-place (prev/next/swipe) ──
  function switchToSiteInDetail(newIdx, dir) {
    const det = qs('#fpDetail');
    if (!det) return;
    haptic(12);
    activeIdx = newIdx;
    updatePinHighlight();
    // Ensure analysis is ready for this site
    ensureAnalysis(newIdx);
    // Sync the hidden carousel underneath (so peek state is consistent)
    const car = qs('#fpCarousel');
    const card = qsa('.fp-site-card', car)[newIdx];
    if (car && card) {
      car.scrollTo({ left: card.offsetLeft, behavior: 'auto' });
    }
    updateActiveCardUI();
    // Pan map instantly to new site
    flyMapToActive(0, true);
    // Slide animation on the detail scroll area
    det.classList.remove('fp-detail-swipe-prev', 'fp-detail-swipe-next');
    if (dir) det.classList.add('fp-detail-swipe-' + dir);
    // Rebuild detail with the new site
    setTimeout(() => {
      buildDetail();
      det.classList.remove('fp-detail-swipe-prev', 'fp-detail-swipe-next');
      det.scrollTop = 0;
    }, 140);
  }

  function wireDetailHorizontalSwipe(det) {
    if (det.__swipeWired) return;
    det.__swipeWired = true;

    let startX = 0, startY = 0, tracking = false, dragging = false;
    const THRESHOLD = 60; // px to trigger switch
    const ANGLE_GUARD = 1.5; // horizontal must dominate vertical

    det.addEventListener('touchstart', (e) => {
      if (det.scrollTop > 10) return; // let vertical scroll take over
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      tracking = true;
      dragging = false;
    }, { passive: true });

    det.addEventListener('touchmove', (e) => {
      if (!tracking) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (!dragging && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * ANGLE_GUARD) {
        dragging = true;
      }
      if (dragging) {
        // Visual rubber band as user drags
        det.style.transform = `translateX(${dx * 0.35}px)`;
        det.style.transition = 'none';
      }
    }, { passive: true });

    det.addEventListener('touchend', (e) => {
      if (!tracking) return;
      tracking = false;
      if (!dragging) return;
      const dx = (e.changedTouches?.[0]?.clientX || 0) - startX;
      det.style.transform = '';
      det.style.transition = '';
      if (Math.abs(dx) > THRESHOLD) {
        const n = getAllSites().length;
        const newIdx = dx < 0 ? (activeIdx + 1) % n : (activeIdx - 1 + n) % n;
        switchToSiteInDetail(newIdx, dx < 0 ? 'next' : 'prev');
      }
    });
  }

  // ─── PULL-DOWN on detail sticky header → back to summary ───────
  function wirePullDownDismiss() {
    // Listen for touchstart/move/end on the detail scroll container
    const det = qs('#fpDetail');
    if (!det || det.__pullWired) return;
    det.__pullWired = true;

    let startY = 0, pulling = false, started = false;

    det.addEventListener('touchstart', (e) => {
      if (state !== 'detail') return;
      // Only start if scrolled to top (otherwise it's normal scroll)
      if (det.scrollTop > 2) return;
      startY = e.touches[0].clientY;
      started = true;
      pulling = false;
    }, { passive: true });

    det.addEventListener('touchmove', (e) => {
      if (!started) return;
      const dy = e.touches[0].clientY - startY;
      if (dy > 30 && !pulling) pulling = true;
      if (pulling && dy > 0) {
        // Rubber band: visual feedback on sheet via translateY
        const pullAmt = Math.min(100, dy * 0.6);
        sheet.style.transform = `translateY(${pullAmt}px)`;
        sheet.style.transition = 'none';
      }
    }, { passive: true });

    det.addEventListener('touchend', (e) => {
      if (!started) return;
      sheet.style.transform = '';
      sheet.style.transition = '';
      if (pulling) {
        const dy = (e.changedTouches?.[0]?.clientY || 0) - startY;
        if (dy > 80) {
          haptic(20);
          transitionTo('summary');
        }
      }
      started = false; pulling = false;
    });
  }

  // ─── DOUBLE-TAP map → zoom to nearest target ───────────────────
  function wireMapDoubleTap() {
    if (!window._fpMap || window._fpMap.__fpDblWired) return;
    window._fpMap.__fpDblWired = true;
    let lastTap = 0;
    window._fpMap.on('click', (e) => {
      const now = Date.now();
      if (now - lastTap < 320) {
        // Double-tap
        const { lat, lng } = e.latlng;
        let best = 0, bestD = Infinity;
        TARGETS.forEach((t, i) => {
          const d = Math.hypot(t.lat - lat, t.lng - lng);
          if (d < bestD) { bestD = d; best = i; }
        });
        activateSite(best, true);
        if (state === 'peek') transitionTo('summary');
        haptic(20);
      }
      lastTap = now;
    });
  }

  // ─── ONBOARDING: 3-step spotlight tour on first visit ──────────
  const TOUR_KEY = 'fpSeenTour';

  function maybeShowOnboarding() {
    // Legacy hint fallback (if they already dismissed the tour but haven't seen the hint)
    if (localStorage.getItem(TOUR_KEY) === '1') {
      if (localStorage.getItem('fpSeenOnboarding') !== '1') showQuickHint();
      return;
    }
    setTimeout(() => showTour(), 900);
  }

  function showQuickHint() {
    const hint = document.createElement('div');
    hint.className = 'fp-onboarding-hint';
    hint.textContent = 'Glisse pour explorer les sites';
    document.body.appendChild(hint);
    setTimeout(() => hint.classList.add('show'), 600);
    setTimeout(() => {
      hint.classList.remove('show');
      setTimeout(() => hint.remove(), 500);
      localStorage.setItem('fpSeenOnboarding', '1');
    }, 4500);
  }

  function showTour() {
    const steps = [
      {
        selector: '.fp-sheet-carousel',
        title: 'Parcours les 5 sites',
        body: 'Glisse horizontalement pour comparer tes candidats d\'expansion.',
        arrow: 'bottom'
      },
      {
        selector: '.fp-target-pin',
        title: 'Les pins sur la carte',
        body: 'Tap un pin → le site correspondant s\'active dans le carrousel.',
        arrow: 'top'
      },
      {
        selector: '.fp-detail-cta, .fp-site-card.active',
        title: 'L\'analyse complète',
        body: 'Tap "Voir l\'analyse" pour le P&L, scénarios, concurrents — avec slider loyer en temps réel.',
        arrow: 'bottom'
      }
    ];

    let current = 0;
    const overlay = document.createElement('div');
    overlay.className = 'fp-tour-overlay';
    overlay.innerHTML = `
      <svg class="fp-tour-svg" width="100%" height="100%" style="position:fixed;inset:0;pointer-events:none">
        <defs>
          <mask id="fpTourMask">
            <rect width="100%" height="100%" fill="white"/>
            <rect class="fp-tour-spot" x="0" y="0" width="0" height="0" rx="14" fill="black"/>
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(0,0,0,.72)" mask="url(#fpTourMask)"/>
      </svg>
      <div class="fp-tour-tooltip">
        <div class="fp-tour-progress">
          <span class="fp-tour-dot active"></span>
          <span class="fp-tour-dot"></span>
          <span class="fp-tour-dot"></span>
        </div>
        <div class="fp-tour-title"></div>
        <div class="fp-tour-body"></div>
        <div class="fp-tour-actions">
          <button class="fp-tour-skip">Passer</button>
          <button class="fp-tour-next">Suivant →</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    function positionSpot(selector) {
      const target = qs(selector.split(',')[0].trim());
      const rect = target?.getBoundingClientRect();
      const spot = overlay.querySelector('.fp-tour-spot');
      if (!rect || !spot) return null;
      const pad = 10;
      spot.setAttribute('x', Math.max(0, rect.left - pad));
      spot.setAttribute('y', Math.max(0, rect.top - pad));
      spot.setAttribute('width', rect.width + pad * 2);
      spot.setAttribute('height', rect.height + pad * 2);
      return rect;
    }

    function render(idx) {
      const step = steps[idx];
      const rect = positionSpot(step.selector);
      overlay.querySelector('.fp-tour-title').textContent = step.title;
      overlay.querySelector('.fp-tour-body').textContent = step.body;
      qsa('.fp-tour-dot', overlay).forEach((d, i) => d.classList.toggle('active', i === idx));
      const tooltip = overlay.querySelector('.fp-tour-tooltip');
      if (rect) {
        // Position tooltip above or below the spot
        const vh = window.innerHeight;
        const below = rect.top > vh / 2;
        if (below) {
          tooltip.style.top = 'auto';
          tooltip.style.bottom = (vh - rect.top + 16) + 'px';
        } else {
          tooltip.style.bottom = 'auto';
          tooltip.style.top = (rect.bottom + 16) + 'px';
        }
      }
      const nextBtn = overlay.querySelector('.fp-tour-next');
      nextBtn.textContent = (idx === steps.length - 1) ? 'Terminer' : 'Suivant →';
    }

    overlay.querySelector('.fp-tour-next').addEventListener('click', () => {
      haptic(10);
      current++;
      if (current >= steps.length) { finishTour(); return; }
      render(current);
    });
    overlay.querySelector('.fp-tour-skip').addEventListener('click', finishTour);

    function finishTour() {
      overlay.classList.add('closing');
      setTimeout(() => overlay.remove(), 400);
      localStorage.setItem(TOUR_KEY, '1');
      localStorage.setItem('fpSeenOnboarding', '1');
    }

    // Reposition on resize (orientation changes)
    window.addEventListener('resize', () => current < steps.length && render(current));

    // Force layout, then render + show in next macrotask (more reliable than rAF)
    overlay.getBoundingClientRect();
    setTimeout(() => {
      try { render(0); } catch(e) { console.warn('[FP tour] render0 failed:', e); }
      overlay.classList.add('on');
    }, 30);
  }

  // ─── TOOLTIPS: tap-to-open (carry-over) ────────────────────────
  function hookTooltips() {
    document.addEventListener('click', (e) => {
      if (!isMobile()) return;
      const tip = e.target.closest('.info-tip');
      if (!tip) {
        qsa('.info-tip.open').forEach(t => t.classList.remove('open'));
        return;
      }
      e.preventDefault(); e.stopPropagation();
      qsa('.info-tip.open').forEach(t => { if (t !== tip) t.classList.remove('open'); });
      tip.classList.toggle('open');
    }, true);
  }

  // ─── INIT ──────────────────────────────────────────────────────
  function init() {
    if (!isMobile()) return;
    buildTopBar();
    buildSearchOverlay();
    buildSheet();
    buildFab();
    hookTooltips();
    transitionTo('peek');

    // Pins on map — might need retry because map init is async
    tryBuildPins();
    // Kick off analysis for site 0 right away so the first card is populated
    setTimeout(() => ensureAnalysis(0), 400);
    setTimeout(() => {
      // And pre-compute the others in the background
      if (typeof TARGETS !== 'undefined') {
        for (let i = 1; i < TARGETS.length; i++) setTimeout(() => ensureAnalysis(i), i * 300);
      }
    }, 800);

    maybeShowOnboarding();
  }

  function tryBuildPins(tries = 0) {
    if (window._fpMap && typeof TARGETS !== 'undefined' && typeof L !== 'undefined') {
      buildTargetPins();
      wireMapDoubleTap();
      // Pre-warm tile cache around all sites → eliminates map freeze on swipe
      setTimeout(() => prewarmTiles(), 400);
      return;
    }
    if (tries > 30) return;
    setTimeout(() => tryBuildPins(tries + 1), 400);
  }

  // Wait for the app to appear post-login
  function waitForApp(cb, tries = 0) {
    const app = qs('#app');
    if (app && app.style.display !== 'none') { cb(); return; }
    if (tries > 60) return;
    setTimeout(() => waitForApp(cb, tries + 1), 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => waitForApp(init));
  } else {
    waitForApp(init);
  }

  // Resize / orientation
  window.addEventListener('resize', () => {
    if (!isMobile()) return;
    transitionTo(state);
    if (window._fpMap?.invalidateSize) setTimeout(() => window._fpMap.invalidateSize(), 300);
  });
  window.addEventListener('orientationchange', () => setTimeout(() => {
    if (window._fpMap?.invalidateSize) window._fpMap.invalidateSize();
  }, 400));

  // Expose debug handles
  window._fpMobile = { transitionTo, activateSite, ensureAnalysis, isMobile };
})();
