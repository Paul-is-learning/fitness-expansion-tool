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
    const tb = document.createElement('div');
    tb.className = 'fp-mobile-topbar';
    tb.innerHTML = `
      <div class="fp-logo">FITNESS <em>PARK</em></div>
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
    const targets = (typeof TARGETS !== 'undefined' && TARGETS) ? TARGETS : [];
    if (targets.length === 0) {
      car.innerHTML = `<div class="fp-site-card"><div class="fp-site-name">Chargement…</div></div>`;
      return;
    }
    car.innerHTML = targets.map((t, i) => renderCard(t, i, analyses[i])).join('');
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

  // ─── SHEET STATE TRANSITIONS ──────────────────────────────────
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
    }

    // Invalidate map size after transition
    setTimeout(() => { if (window._fpMap?.invalidateSize) window._fpMap.invalidateSize(); }, 450);
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

  // ─── CAROUSEL SCROLL SYNC ──────────────────────────────────────
  function wireCarouselScroll() {
    const car = qs('#fpCarousel');
    if (!car) return;

    // Detect which card is centered via scrollLeft
    let scrollTimeout;
    car.addEventListener('scroll', () => {
      if (state !== 'peek') return; // only in peek
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        const cards = qsa('.fp-site-card', car);
        if (cards.length === 0) return;
        const carRect = car.getBoundingClientRect();
        const mid = carRect.left + carRect.width / 2;
        let best = 0, bestD = Infinity;
        cards.forEach((c, i) => {
          const r = c.getBoundingClientRect();
          const cMid = r.left + r.width / 2;
          const d = Math.abs(cMid - mid);
          if (d < bestD) { bestD = d; best = i; }
        });
        if (best !== activeIdx) activateSite(best, false);
      }, 120);
    }, { passive: true });

    // Delegate CTA clicks
    car.addEventListener('click', (e) => {
      if (e.target.closest('[data-cta="detail"]')) {
        e.stopPropagation();
        transitionTo('detail');
      }
    });
  }

  // ─── ACTIVATE SITE ─────────────────────────────────────────────
  function activateSite(i, flyTo) {
    if (typeof TARGETS === 'undefined') return;
    activeIdx = i;
    const target = TARGETS[i];

    // Update pin highlights
    pinMarkers.forEach((m, idx) => {
      const el = m.getElement?.();
      if (el) {
        const inner = el.querySelector('.fp-target-pin');
        if (inner) inner.classList.toggle('active', idx === i);
      }
    });

    // Update card active state
    qsa('.fp-site-card').forEach((c, idx) => c.classList.toggle('active', idx === i));

    // Scroll carousel to center this card
    const car = qs('#fpCarousel');
    const card = qsa('.fp-site-card', car)[i];
    if (car && card && flyTo) {
      const targetLeft = card.offsetLeft - (car.offsetWidth - card.offsetWidth) / 2;
      car.scrollTo({ left: targetLeft, behavior: 'smooth' });
    }

    // Compute analysis if not yet
    ensureAnalysis(i);

    // Fly map to site
    if (flyTo && window._fpMap && target) {
      window._fpMap.flyTo([target.lat, target.lng], Math.max(window._fpMap.getZoom(), 13), { duration: .8 });
    }

    // Dispatch event for external listeners
    window.dispatchEvent(new CustomEvent('fp:site-activated', { detail: { index: i, target } }));
  }

  function ensureAnalysis(i) {
    if (analyses[i]) { refreshCard(i); return; }
    if (typeof runCaptageAnalysis !== 'function') return;
    if (typeof computeExecSummary !== 'function') return;
    if (typeof loadAllCompetitors !== 'function') return;
    const t = TARGETS[i];
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
      } catch (e) { console.warn('[FP mobile] analysis failed:', e); }
    };
    if (typeof allComps !== 'undefined' && allComps && allComps.length > 0) {
      doIt();
    } else {
      loadAllCompetitors().then(doIt);
    }
  }

  function refreshCard(i) {
    const card = qsa('.fp-site-card')[i];
    if (!card) return;
    const t = TARGETS[i];
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
    const t = TARGETS[activeIdx];
    const a = analyses[activeIdx];
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

    det.innerHTML = `
      <div class="fp-detail-header">
        <div class="fp-detail-back" id="fpDetailBack">
          <svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>
        </div>
        <div class="fp-detail-title">
          <div class="t">${t.name}</div>
          <div class="s">Secteur ${t.sector} · Phase ${t.phase} · ${t.opening || ''}</div>
        </div>
        <span class="fp-verdict ${verClass}" style="font-size:10px">${String(a.verdict).replace('GO CONDITIONNEL', 'GO COND')}</span>
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
            <div class="card">
              ${sazBar('Flux trafic',    sazFlux,  '#06b6d4')}
              ${sazBar('Densité pop.',   sazDens,  '#22c55e')}
              ${sazBar('% Jeunesse',     sazYouth, '#f59e0b')}
            </div>
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
            <div class="card" style="padding:0">
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

    qs('#fpDetailBack').addEventListener('click', () => transitionTo('summary'));

    // Accordion toggles
    qsa('.fp-accordion-item', det).forEach(item => {
      item.querySelector('.fp-accordion-head').addEventListener('click', () => {
        item.classList.toggle('open');
      });
    });
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
    return `<div class="card" style="padding:0">
      ${scenarios.map(s => {
        const p = r.pnl?.[s.key];
        if (!p) return '';
        return `
          <div style="padding:12px 14px;border-bottom:1px solid rgba(71,85,115,.2)">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
              <div style="font-size:12px;font-weight:700;color:${s.color}">${s.label}</div>
              <div style="font-size:18px;font-weight:900;color:${p.irr > 0 ? '#34d399' : '#f87171'}">${fmtPct(p.irr)}</div>
            </div>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;font-size:10px">
              <div><div style="color:var(--gray2)">NPV</div><div style="font-weight:700;color:var(--white)">${fmtM(p.npv)}</div></div>
              <div><div style="color:var(--gray2)">Breakeven</div><div style="font-weight:700;color:var(--white)">${p.breakevenMonth ? p.breakevenMonth + ' mo' : '—'}</div></div>
              <div><div style="color:var(--gray2)">Payback</div><div style="font-weight:700;color:var(--white)">${p.paybackMonth ? p.paybackMonth + ' mo' : '—'}</div></div>
            </div>
          </div>
        `;
      }).join('')}
    </div>`;
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
    // Map our tabs to the desktop tab-panel ids
    const map = {
      layers: 'tab-explore',
      concurrence: 'tab-compete',
      mysites: 'tab-mysites',
      dash: 'tab-dash'
    };
    const src = document.getElementById(map[stab]);
    if (src) {
      // Clone the tab-panel content (so we don't move DOM & break desktop wiring)
      body.innerHTML = '';
      const clone = src.cloneNode(true);
      clone.id = '';
      clone.style.display = 'block';
      body.appendChild(clone);
      // Intercept clicks on toggles → route to real toggles on hidden desktop
      rehookToggles(body, src);
    }
  }
  function rehookToggles(cloneRoot, srcRoot) {
    // Original app uses `toggleLayer(name)` — onclick attributes survive cloning, OK.
    // Just ensure that when toggled, state synchronizes both UIs.
    // (clone re-executes the onclick, which toggles the global state)
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

  // ─── NUMBERED PINS FOR TARGETS ─────────────────────────────────
  function buildTargetPins() {
    if (!window._fpMap || typeof TARGETS === 'undefined' || pinMarkers.length > 0) return;
    if (typeof L === 'undefined') return;

    pinLayer = L.layerGroup().addTo(window._fpMap);
    TARGETS.forEach((t, i) => {
      const icon = L.divIcon({
        className: '',
        html: `<div class="fp-target-pin${i === activeIdx ? ' active' : ''}">${i + 1}</div>`,
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

  // ─── ONBOARDING HINT ───────────────────────────────────────────
  function maybeShowOnboarding() {
    if (localStorage.getItem('fpSeenOnboarding') === '1') return;
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
