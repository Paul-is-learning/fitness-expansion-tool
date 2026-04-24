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

  // i18n helper — local alias so we don't shadow `t` used as a target-site variable
  const _t = (k, p) => (typeof window.t === 'function' ? window.t(k, p) : k);
  // HTML escape alias — use for any user-provided string (custom site names, notes).
  const _esc = (s) => (typeof escapeHtml === 'function' ? escapeHtml(s) : String(s == null ? '' : s));

  // ─── v6.61 OVERRIDE METADATA — qui a modifié quoi, quand ──────────
  // Structure : { [siteKey]: { rent: {by,at}, charge: {by,at}, surface: {by,at} } }
  // Persisté séparément des valeurs (fpRentOverrides etc.) pour ne pas casser
  // le format existant ni le cloud-sync CRDT actuel.
  const OVERRIDE_META_KEY = 'fpOverrideMeta';
  function loadOverrideMeta() {
    try {
      const s = (typeof safeStorage !== 'undefined') ? safeStorage : { get: () => null };
      return s.get(OVERRIDE_META_KEY, {}) || {};
    } catch { return {}; }
  }
  function saveOverrideMeta(meta) {
    try {
      const s = (typeof safeStorage !== 'undefined') ? safeStorage : null;
      if (s) s.set(OVERRIDE_META_KEY, meta);
      else localStorage.setItem(OVERRIDE_META_KEY, JSON.stringify(meta));
    } catch {}
  }
  function getCurrentEditorEmail() {
    try {
      const u = window.currentUser?.email;
      if (u) return String(u).trim().toLowerCase();
      const stored = localStorage.getItem('fpCurrentUser');
      if (stored) {
        const p = JSON.parse(stored);
        if (p?.email) return String(p.email).trim().toLowerCase();
      }
    } catch {}
    return 'utilisateur';
  }
  function markOverrideEdited(siteKey, kind) {
    if (!siteKey || !kind) return;
    const meta = loadOverrideMeta();
    meta[siteKey] = meta[siteKey] || {};
    meta[siteKey][kind] = { by: getCurrentEditorEmail(), at: Date.now() };
    saveOverrideMeta(meta);
  }
  function clearOverrideMeta(siteKey, kind) {
    if (!siteKey) return;
    const meta = loadOverrideMeta();
    if (!meta[siteKey]) return;
    if (kind) delete meta[siteKey][kind]; else delete meta[siteKey];
    saveOverrideMeta(meta);
  }
  window.fpOverrideMeta = { load: loadOverrideMeta, mark: markOverrideEdited, clear: clearOverrideMeta };

  // Display helper: "il y a 3 min", "hier", "Paul · 2h"
  function fmtTimeAgo(ts) {
    if (!ts) return '';
    const d = Date.now() - ts;
    const s = Math.round(d / 1000);
    if (s < 60) return 'à l\u2019instant';
    const m = Math.round(s / 60);
    if (m < 60) return 'il y a ' + m + ' min';
    const h = Math.round(m / 60);
    if (h < 24) return 'il y a ' + h + ' h';
    const day = Math.round(h / 24);
    if (day < 7) return 'il y a ' + day + ' j';
    const dt = new Date(ts);
    return dt.getDate() + '/' + (dt.getMonth() + 1);
  }
  // "Paul" from "paulbecaud@isseo-dev.com"
  function shortEditorName(email) {
    if (!email || email === 'utilisateur') return 'utilisateur';
    const local = String(email).split('@')[0];
    // Nicer: paulbecaud → Paul, pbecaud → P. Becaud, ulysse.gaspard0 → Ulysse, tomescumh → Tomescu
    const m = local.match(/^([a-z]+)/i);
    const first = m ? m[1] : local;
    return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
  }
  function overrideBadgeHTML(siteKey, kind) {
    const meta = loadOverrideMeta();
    const info = meta?.[siteKey]?.[kind];
    if (!info || !info.by) {
      return '<span style="font-size:9px;color:var(--gray2);font-weight:500">Valeur par défaut</span>';
    }
    const name = shortEditorName(info.by);
    const when = fmtTimeAgo(info.at);
    return `<span style="font-size:9px;color:var(--accent);font-weight:600" data-fp-editor="${kind}">Modifié par ${_esc(name)} · ${when}</span>`;
  }

  // State machine: peek | summary | detail
  let state = 'peek';
  let sheet = null;
  let activeIdx = 0; // index into TARGETS
  let analyses = []; // cached per-target analyses (lazy)
  let pinLayer = null;
  let pinMarkers = [];

  // Null-safe DOM queries: if ctx is null/undefined (element not yet in DOM,
  // or already removed), fall back to empty results rather than throwing.
  const qs  = (s, ctx) => (ctx || document).querySelector?.(s) || null;
  const qsa = (s, ctx) => Array.from((ctx || document).querySelectorAll?.(s) || []);

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
        // v6.38 CRDT: filtre les tombstones (sites soft-deleted)
        customs = list.filter(c => !c.deletedAt).map(c => ({
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
        <span data-i18n="topbar.search.placeholder">${window.t ? window.t('topbar.search.placeholder') : 'Bucarest…'}</span>
      </div>
      <button class="fp-locale-pill" id="fpLocalePill" type="button" title="${window.t ? window.t('topbar.locale.title') : ''}" aria-label="Toggle language">${window.t ? window.t('topbar.locale.label') : 'EN'}</button>
      <div class="fp-avatar" id="fpAvatar">P</div>
    `;
    document.body.appendChild(tb);

    const cu = (() => { try { return JSON.parse(sessionStorage.getItem('fpCurrentUser') || 'null'); } catch { return null; } })();
    if (cu) qs('#fpAvatar').textContent = (cu.name || cu.email || '?')[0].toUpperCase();
    qs('#fpAvatar').addEventListener('click', () => {
      if (typeof window.showUserPanel === 'function') window.showUserPanel();
    });
    qs('#fpSearchPill').addEventListener('click', openSearchOverlay);
    qs('#fpLocalePill').addEventListener('click', () => {
      if (typeof window.toggleLocale === 'function') {
        window.toggleLocale();
        haptic(8);
      }
    });
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
        <input type="text" id="fpSearchInput" placeholder="Ex: Bd. Iuliu Maniu 100, Bucarest" autocomplete="off" autocapitalize="off" autocorrect="off">
        <div class="fp-search-clear" id="fpSearchClear" title="Effacer">✕</div>
      </div>
      <div class="results" id="fpSearchResults"></div>
      <div class="fp-search-footer">Powered by Google Places</div>
    `;
    document.body.appendChild(ov);

    qs('#fpSearchBack').addEventListener('click', closeSearchOverlay);
    qs('#fpSearchClear').addEventListener('click', () => {
      qs('#fpSearchInput').value = '';
      qs('#fpSearchResults').innerHTML = '';
      qs('#fpSearchInput').focus();
    });

    wireAutocomplete();
  }

  // Session token for Google Places autocomplete (billing optimisation: 1 session = autocomplete→details = 1 charge)
  let _autocompleteSession = null;
  function newSessionToken() {
    _autocompleteSession = 'fp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
    return _autocompleteSession;
  }

  // Rate-limit autocomplete to protect Google Places quota.
  // 30 requests / 60s is conservative for a single user typing.
  const _acRateLimited = (typeof rateLimit === 'function')
    ? rateLimit((q, seq) => fetchAutocomplete(q, seq), 30, 60000)
    : (q, seq) => fetchAutocomplete(q, seq);

  function wireAutocomplete() {
    const input = qs('#fpSearchInput');
    if (!input || input.__autoWired) return;
    input.__autoWired = true;
    let debounceT;
    let reqSeq = 0;

    input.addEventListener('input', (e) => {
      clearTimeout(debounceT);
      const q = e.target.value.trim();
      if (q.length < 2) {
        qs('#fpSearchResults').innerHTML = '';
        return;
      }
      // Offline short-circuit: no Google call, hint user.
      if (typeof isOnline === 'function' && !isOnline()) {
        qs('#fpSearchResults').innerHTML = `<div class="fp-search-empty">${_t('common.offlineHint') || 'Hors ligne — recherche désactivée'}</div>`;
        return;
      }
      // 220ms debounce — strikes balance between responsiveness and quota
      debounceT = setTimeout(() => _acRateLimited(q, ++reqSeq), 220);
    });

    // First focus starts a new billing session
    input.addEventListener('focus', () => { if (!_autocompleteSession) newSessionToken(); });
  }

  async function fetchAutocomplete(query, seq) {
    const results = qs('#fpSearchResults');
    if (!results) return;
    // Inline loading hint
    results.innerHTML = `<div class="fp-search-loading">Recherche…</div>`;

    try {
      if (typeof GOOGLE_API_KEY === 'undefined' || !GOOGLE_API_KEY) {
        throw new Error('no-key');
      }
      const token = _autocompleteSession || newSessionToken();
      const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': GOOGLE_API_KEY
        },
        body: JSON.stringify({
          input: query,
          languageCode: 'fr',
          regionCode: 'RO',
          sessionToken: token,
          locationBias: {
            circle: { center: { latitude: 44.4268, longitude: 26.1025 }, radius: 40000 }
          }
        })
      });
      // Stale-response guard: only show latest sequence
      if (seq !== undefined && seq !== (+results.dataset.lastSeq || 0) && seq > 0) {
        results.dataset.lastSeq = seq;
      }
      if (!res.ok) throw new Error('api:' + res.status);
      const data = await res.json();
      renderAutocompleteResults(data.suggestions || []);
    } catch (e) {
      console.warn('[FP autocomplete]', e.message);
      // Fallback to Nominatim
      await fetchNominatimFallback(query);
    }
  }

  function renderAutocompleteResults(suggestions) {
    const results = qs('#fpSearchResults');
    if (!results) return;
    if (suggestions.length === 0) {
      results.innerHTML = `<div class="fp-search-empty">Aucun résultat</div>`;
      return;
    }
    results.innerHTML = suggestions.map(s => {
      const p = s.placePrediction;
      if (!p) return '';
      const main = p.structuredFormat?.mainText?.text || p.text?.text || '';
      const sec  = p.structuredFormat?.secondaryText?.text || '';
      return `
        <div class="fp-search-item" data-placeid="${p.placeId}">
          <svg class="fp-search-item-icon" viewBox="0 0 24 24"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/></svg>
          <div class="fp-search-item-text">
            <div class="main">${main}</div>
            <div class="sec">${sec}</div>
          </div>
        </div>
      `;
    }).join('');

    qsa('.fp-search-item', results).forEach(item => {
      item.addEventListener('click', async () => {
        haptic(12);
        const placeId = item.dataset.placeid;
        if (!placeId) return;
        await selectAutocompleteResult(placeId);
      });
    });
  }

  async function selectAutocompleteResult(placeId) {
    try {
      const token = _autocompleteSession;
      _autocompleteSession = null; // session closes on selection (billing)
      const res = await fetch('https://places.googleapis.com/v1/places/' + encodeURIComponent(placeId), {
        method: 'GET',
        headers: {
          'X-Goog-Api-Key': GOOGLE_API_KEY,
          'X-Goog-FieldMask': 'displayName,location,formattedAddress',
          ...(token ? { 'X-Goog-Session-Token': token } : {})
        }
      });
      const p = await res.json();
      const lat = p.location?.latitude;
      const lng = p.location?.longitude;
      if (!isFinite(lat) || !isFinite(lng)) throw new Error('no-coords');
      closeSearchOverlay();
      if (window._fpMap) window._fpMap.flyTo([lat, lng], 15, { duration: .7 });
      if (typeof window.onMapClick === 'function') {
        setTimeout(() => window.onMapClick({ latlng: { lat, lng } }), 400);
      }
    } catch (e) {
      console.warn('[FP autocomplete select]', e);
    }
  }

  async function fetchNominatimFallback(query) {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query + ', Bucharest, Romania')}&limit=5&addressdetails=1`);
      const data = await r.json();
      const results = qs('#fpSearchResults');
      if (!results) return;
      results.innerHTML = data.length === 0
        ? '<div class="fp-search-empty">Aucun résultat</div>'
        : data.map(d => `
          <div class="fp-search-item" data-lat="${d.lat}" data-lng="${d.lon}">
            <svg class="fp-search-item-icon" viewBox="0 0 24 24"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/></svg>
            <div class="fp-search-item-text">
              <div class="main">${(d.display_name||'').split(',')[0]}</div>
              <div class="sec">${(d.display_name||'').split(',').slice(1,3).join(', ')}</div>
            </div>
          </div>`).join('');
      qsa('.fp-search-item', results).forEach(item => {
        item.addEventListener('click', () => {
          const lat = parseFloat(item.dataset.lat), lng = parseFloat(item.dataset.lng);
          if (!isFinite(lat) || !isFinite(lng)) return;
          closeSearchOverlay();
          if (window._fpMap) window._fpMap.flyTo([lat, lng], 15, { duration: .7 });
          if (typeof window.onMapClick === 'function') {
            setTimeout(() => window.onMapClick({ latlng: { lat, lng } }), 400);
          }
        });
      });
    } catch (e) {
      const results = qs('#fpSearchResults');
      if (results) results.innerHTML = '<div class="fp-search-empty">Erreur de recherche</div>';
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
    // v6.46 — hero affiche IRR Equity (TRI leveragé) par défaut, ce que Paul demande
    const irrMetric = (a?.irrEquity != null) ? a.irrEquity : a?.irrBase;
    const irr = a ? fmtPct(irrMetric) : '—';
    const irrClass = irrMetric > 0 ? 'good' : (irrMetric < 0 ? 'bad' : '');
    const members = a ? fmtNum(a.members) : '—';
    const be = a?.beBase ? a.beBase + ' mo' : '—';
    const npv = a ? fmtM(a.npvBase) : '—';

    return `
      <div class="fp-site-card ${i === activeIdx ? 'active' : ''}" data-idx="${i}">
        <div class="fp-site-head">
          <div>
            <div class="fp-site-num">${_t('card.site')} ${i + 1}</div>
            <div class="fp-site-name">${_esc(t.name)}</div>
          </div>
          <span class="${verClass}">${verLabel}</span>
        </div>
        <div class="fp-site-meta">
          <span>${_t('card.sector')} <b>${_esc(t.sector)}</b></span>
          <span>${_t('card.phase')} <b>${_esc(t.phase)}</b></span>
          <span>${_esc(t.opening) || ''}</span>
        </div>
        <div class="fp-mini-metrics">
          <div class="fp-mini-metric"><div class="v">${members}</div><div class="l">${_t('card.members')}</div></div>
          <div class="fp-mini-metric ${irrClass}"><div class="v">${irr}</div><div class="l">IRR</div></div>
          <div class="fp-mini-metric"><div class="v">${npv}</div><div class="l">NPV</div></div>
        </div>
        <button class="fp-detail-cta" data-cta="detail">
          ${_t('card.ctaViewAnalysis')}
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
      // v6.49 — pull cloud immédiat à l'ouverture de la fiche pour récupérer
      // les overrides loyer/charges/surface modifiés depuis desktop. Sans attendre
      // les 5s du polling. v6.50 — en cas de changement, invalider le cache
      // analyses[activeIdx] puis re-run ensureAnalysis (qui détectera la nouvelle
      // signature overrides) + buildDetail.
      try {
        window.cloudSync?.pull?.().then((res) => {
          if (res && res.changes && res.changes > 0) {
            if (Array.isArray(analyses) && analyses[activeIdx]) analyses[activeIdx] = null;
            ensureAnalysis(activeIdx);
            if (typeof buildDetail === 'function') buildDetail();
          }
        });
      } catch {}
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

  // Pre-warm tile cache by fitting bounds over all sites WITH the current
  // calibrated view (no restore — this is our final view).
  // Called AFTER index.html's calibrateInitialView so we don't undo it.
  function prewarmTiles() {
    if (!window._fpMap || !L) return;
    try {
      const sites = getAllSites();
      if (sites.length === 0) return;
      // invalidateSize in case the sheet just appeared
      window._fpMap.invalidateSize();
      // Ensure bounds still cover all sites (accounts for custom sites added)
      const bounds = L.latLngBounds(sites.map(s => [s.lat, s.lng]));
      const isMobile = window.innerWidth <= 768;
      window._fpMap.fitBounds(bounds, {
        animate: false,
        paddingTopLeft:     [40, isMobile ? 80 : 40],
        paddingBottomRight: [40, isMobile ? 200 : 40],
        maxZoom: 13
      });
    } catch (e) { console.warn('[FP mobile] prewarm failed:', e); }
  }

  // ─── HAPTIC FEEDBACK ───────────────────────────────────────────
  function haptic(ms) {
    try { navigator.vibrate?.(ms); } catch {}
  }

  // ─── Per-site override restore / persist ─────────────────────
  // Called anywhere the active site changes OR a slider writes a value.
  // Keeps the 3 global singular overrides (`_rentOverride`, `_chargeOverride`,
  // `_surfaceOverride`) in sync with the per-site maps. Fundamental invariant:
  // sliders are always SCOPED to the active site, never leak to other sites.
  function siteKeyFor(t) { return t.lat.toFixed(3) + ',' + t.lng.toFixed(3); }
  function restoreSiteOverrides(key) {
    window._rentOverride    = window._rentOverrides?.[key]    ? { y1: window._rentOverrides[key] }                  : null;
    window._chargeOverride  = window._chargeOverrides?.[key]  ? { chargeTotal: window._chargeOverrides[key] }       : null;
    window._surfaceOverride = window._surfaceOverrides?.[key] ? { surface: window._surfaceOverrides[key] }          : null;
  }

  // ─── ACTIVATE SITE ─────────────────────────────────────────────
  function activateSite(i, flyTo) {
    const sites = getAllSites();
    if (!sites[i]) return;
    activeIdx = i;

    const t = sites[i];
    restoreSiteOverrides(siteKeyFor(t));

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

  // v6.52 — token par slot pour annuler les doIt concurrents stale.
  const _ensureRunToken = [];

  function ensureAnalysis(i) {
    if (typeof runCaptageAnalysis !== 'function') return;
    if (typeof computeExecSummary !== 'function') return;
    if (typeof loadAllCompetitors !== 'function') return;
    const sites = getAllSites();
    const t = sites[i];
    if (!t) return;
    const key = siteKeyFor(t);
    // Signature overrides actifs (lu à l'entrée pour cache check uniquement).
    const ovSigEntry = JSON.stringify({
      r: window._rentOverrides?.[key] ?? null,
      c: window._chargeOverrides?.[key] ?? null,
      s: window._surfaceOverrides?.[key] ?? null,
    });
    if (analyses[i] && analyses[i]._ovSig === ovSigEntry) { refreshCard(i); return; }

    // Cancellation token — un nouveau ensureAnalysis(i) stale tous les doIt précédents.
    _ensureRunToken[i] = (_ensureRunToken[i] || 0) + 1;
    const myToken = _ensureRunToken[i];

    const doIt = () => {
      // v6.52 — RESTORE overrides DANS doIt (juste avant le calcul). Sinon les
      // globals _rentOverride/_chargeOverride/_surfaceOverride sont écrasés par
      // d'autres ensureAnalysis() concurrents (race condition: 5 setTimeout
      // décalés, load comps async → globals = ceux du dernier site invoqué).
      if (_ensureRunToken[i] !== myToken) return; // call obsolète, skip
      restoreSiteOverrides(key);
      try {
        const r = runCaptageAnalysis(t.lat, t.lng, 3000);
        const exec = computeExecSummary(r);
        if (_ensureRunToken[i] !== myToken) return; // obsolète pendant le calc
        // Re-compute ovSig AU MOMENT du calcul (c'est ce qui compte).
        const ovSig = JSON.stringify({
          r: window._rentOverrides?.[key] ?? null,
          c: window._chargeOverrides?.[key] ?? null,
          s: window._surfaceOverrides?.[key] ?? null,
        });
        analyses[i] = {
          members: r.totalTheorique,
          irrBase: r.pnl?.base?.irr,
          irrEquity: r.pnl?.base?.irrEquity,
          npvBase: r.pnl?.base?.npv,
          beBase: r.pnl?.base?.breakevenMonth,
          verdict: typeof exec.verdict === 'object' ? exec.verdict.label : exec.verdict,
          score: exec.total,
          raw: r,
          _ovSig: ovSig,
        };
        refreshCard(i);
        hideCompetitorMarkers();
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
    if (!t) return;
    // v6.61 — restore + ensureAnalysis AVANT de lire analyses[activeIdx].
    // Garantit que les KPI hero reflètent les overrides persistés (même
    // si la fiche avait été cachée au boot avec un ovSig obsolète).
    try { restoreSiteOverrides(siteKeyFor(t)); } catch {}
    try { ensureAnalysis(activeIdx); } catch {}
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

    const totalSites = sites.length;
    const prevIdx = (activeIdx - 1 + totalSites) % totalSites;
    const nextIdx = (activeIdx + 1) % totalSites;

    const pbSuffix = a.beBase ? ' ' + a.beBase + ' ' + _t('detail.hero.paybackMonths') : ' ' + _t('detail.hero.paybackNA');

    det.innerHTML = `
      <div class="fp-detail-header">
        <div class="fp-detail-back" id="fpDetailBack" aria-label="${_t('fab.back')}">
          <svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>
        </div>
        <div class="fp-detail-title">
          <div class="t">${_esc(t.name)}</div>
          <div class="s">${_t('card.sector')} ${_esc(t.sector)} · ${_t('card.phase')} ${_esc(t.phase)} · ${activeIdx + 1} / ${totalSites}</div>
        </div>
        <span class="fp-verdict ${verClass}" style="font-size:10px">${_esc(String(a.verdict).replace('GO CONDITIONNEL', 'GO COND'))}</span>
      </div>
      <div class="fp-detail-nav">
        <button class="fp-detail-nav-btn" data-dir="prev" aria-label="${_t('detail.prevSite')}">
          <svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>
          <span class="fp-nav-label">${_esc(sites[prevIdx].name)}</span>
        </button>
        <div class="fp-detail-nav-sep"></div>
        <button class="fp-detail-nav-btn next" data-dir="next" aria-label="${_t('detail.nextSite')}">
          <span class="fp-nav-label">${_esc(sites[nextIdx].name)}</span>
          <svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>
        </button>
      </div>

      <!-- KEY METRICS HERO — data-fp-hero pour refresh robuste (v6.61) -->
      <div id="fpDetailHeroGrid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:14px">
        <div data-fp-hero="members" style="background:linear-gradient(135deg,rgba(30,41,59,.8) 0%,rgba(17,24,39,.4) 100%);border:1px solid var(--border);border-radius:12px;padding:14px">
          <div style="font-size:10px;color:var(--gray2);text-transform:uppercase;letter-spacing:.5px">${_t('detail.hero.members')}</div>
          <div data-fp-hero-value style="font-size:26px;font-weight:900;color:var(--white);line-height:1.1;margin-top:4px">${fmtNum(a.members)}</div>
          <div data-fp-hero-sub style="font-size:10px;color:var(--gray);margin-top:2px">${fmtNum(r.pessimiste)} – ${fmtNum(r.optimiste)}</div>
        </div>
        <div data-fp-hero="irr" style="background:linear-gradient(135deg,rgba(30,41,59,.8) 0%,rgba(17,24,39,.4) 100%);border:1px solid var(--border);border-radius:12px;padding:14px">
          <div style="font-size:10px;color:var(--gray2);text-transform:uppercase;letter-spacing:.5px">TRI Equity</div>
          <div data-fp-hero-value style="font-size:26px;font-weight:900;color:${(a.irrEquity ?? a.irrBase) > 0 ? '#34d399' : '#f87171'};line-height:1.1;margin-top:4px">${fmtPct(a.irrEquity ?? a.irrBase)}</div>
          <div data-fp-hero-sub style="font-size:10px;color:var(--gray);margin-top:2px">Projet: ${fmtPct(a.irrBase)} · ${_t('detail.hero.payback')}${pbSuffix}</div>
        </div>
        <div data-fp-hero="npv" style="background:linear-gradient(135deg,rgba(30,41,59,.8) 0%,rgba(17,24,39,.4) 100%);border:1px solid var(--border);border-radius:12px;padding:14px">
          <div style="font-size:10px;color:var(--gray2);text-transform:uppercase;letter-spacing:.5px">${_t('detail.hero.npv5yr')}</div>
          <div data-fp-hero-value style="font-size:22px;font-weight:900;color:${a.npvBase > 0 ? '#34d399' : '#f87171'};line-height:1.1;margin-top:4px">${fmtM(a.npvBase)}</div>
          <div data-fp-hero-sub style="font-size:10px;color:var(--gray);margin-top:2px">${_t('detail.hero.scenarioBase')}</div>
        </div>
        <div data-fp-hero="saz" style="background:linear-gradient(135deg,rgba(30,41,59,.8) 0%,rgba(17,24,39,.4) 100%);border:1px solid var(--border);border-radius:12px;padding:14px">
          <div style="font-size:10px;color:var(--gray2);text-transform:uppercase;letter-spacing:.5px">${_t('detail.hero.sazScore')}</div>
          <div data-fp-hero-value style="font-size:26px;font-weight:900;color:var(--accent);line-height:1.1;margin-top:4px">${Math.round(score)}<span style="font-size:13px;color:var(--gray2);font-weight:600">/100</span></div>
          <div data-fp-hero-sub style="font-size:10px;color:var(--gray);margin-top:2px">${_t('detail.hero.zoneAttractiveness')}</div>
        </div>
      </div>

      <!-- ACCORDION SECTIONS -->
      <div class="fp-accordion" id="fpAccordion">
        <div class="fp-accordion-item open" data-sec="loc">
          <div class="fp-accordion-head">
            <div class="icon">📍</div>
            <div class="lbl">${_t('acc.location')}</div>
            <svg class="chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>
          </div>
          <div class="fp-accordion-body">
            <div class="card">
              <div class="metric-row"><span class="metric-label">${_t('loc.coords')}</span><span class="metric-value">${t.lat.toFixed(4)}, ${t.lng.toFixed(4)}</span></div>
              <div class="metric-row"><span class="metric-label">${_t('loc.sector')}</span><span class="metric-value">${_t('card.sector')} ${_esc(t.sector)}</span></div>
              <div class="metric-row"><span class="metric-label">${_t('loc.surface')}</span><span class="metric-value">${_esc(t.area)}</span></div>
              <div class="metric-row"><span class="metric-label">${_t('loc.status')}</span><span class="metric-value" style="font-size:11px">${_esc(t.status)}</span></div>
              <div class="metric-row"><span class="metric-label">${_t('loc.targetRent')}</span><span class="metric-value">${_esc(t.rent)}</span></div>
              <div class="metric-row"><span class="metric-label">${_t('loc.opening')}</span><span class="metric-value">${_esc(t.opening) || '—'}</span></div>
            </div>
            ${t.note ? `<div class="card" style="padding:10px;font-size:11px;color:var(--gray);line-height:1.5">${_esc(t.note)}</div>` : ''}
          </div>
        </div>

        <div class="fp-accordion-item" data-sec="saz">
          <div class="fp-accordion-head">
            <div class="icon">🎯</div>
            <div class="lbl">${_t('acc.sazScore')}</div>
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
            <div class="lbl">${_t('acc.demographics')}</div>
            <div class="hint">${fmtNum(r.popTarget)} ${_t('demo.popTargetHint')}</div>
            <svg class="chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>
          </div>
          <div class="fp-accordion-body">
            <div class="card">
              <div class="metric-row"><span class="metric-label">${_t('demo.popTarget')}</span><span class="metric-value">${fmtNum(r.popTarget)}</span></div>
              <div class="metric-row"><span class="metric-label">${_t('demo.arpu')}</span><span class="metric-value">${r.arpu?.toFixed(2)} €/mo</span></div>
              <div class="metric-row"><span class="metric-label">${_t('demo.churnY1')}</span><span class="metric-value">${(r.churnY1*100).toFixed(1)}%</span></div>
              <div class="metric-row"><span class="metric-label">${_t('demo.churnY2')}</span><span class="metric-value">${(r.churnRate*100).toFixed(1)}%</span></div>
              <div class="metric-row"><span class="metric-label">${_t('demo.ltv')}</span><span class="metric-value">${fmtNum(r.ltv)} €</span></div>
              <div class="metric-row"><span class="metric-label">${_t('demo.ltvCac')}</span><span class="metric-value" style="color:${r.ltvCacRatio > 3 ? '#34d399' : '#f87171'}">${r.ltvCacRatio}×</span></div>
            </div>
          </div>
        </div>

        <div class="fp-accordion-item" data-sec="sources">
          <div class="fp-accordion-head">
            <div class="icon">🔀</div>
            <div class="lbl">${_t('acc.memberSources')}</div>
            <div class="hint">${fmtNum(a.members)} ${_t('src.total')}</div>
            <svg class="chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>
          </div>
          <div class="fp-accordion-body">
            <div class="card">
              ${sourceBar(_t('src.captured'),    r.totalCaptifs,                     a.members, '#f97316')}
              ${sourceBar(_t('src.native'),      r.native?.captured || 0,           a.members, '#22c55e')}
              ${sourceBar(_t('src.walkIn'),      r.walkIn?.walkInMembers || 0,       a.members, '#06b6d4')}
              ${(r.destinationBonus?.bonusMembers || 0) > 0 ? sourceBar(_t('src.destination'), r.destinationBonus.bonusMembers, a.members, '#a78bfa') : ''}
            </div>
          </div>
        </div>

        <div class="fp-accordion-item" data-sec="pnl">
          <div class="fp-accordion-head">
            <div class="icon">💰</div>
            <div class="lbl">${_t('acc.pnl3scenarios')}</div>
            <div class="hint">${fmtPct(a.irrBase)}</div>
            <svg class="chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>
          </div>
          <div class="fp-accordion-body">
            ${pnlCard(r)}
          </div>
        </div>

        <div class="fp-accordion-item" data-sec="financing">
          <div class="fp-accordion-head">
            <div class="icon">🏦</div>
            <div class="lbl">${_t('acc.financingEquity')}</div>
            <div class="hint">${fmtPct(r.pnl?.base?.irrEquity)}</div>
            <svg class="chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>
          </div>
          <div class="fp-accordion-body">
            ${financingCard(r.pnl?.base)}
          </div>
        </div>

        <div class="fp-accordion-item" data-sec="bptemplate">
          <div class="fp-accordion-head">
            <div class="icon">📚</div>
            <div class="lbl">${_t('acc.bpTemplate')}</div>
            <div class="hint">Template Romania</div>
            <svg class="chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>
          </div>
          <div class="fp-accordion-body">
            ${bpTemplateCard()}
          </div>
        </div>

        <div class="fp-accordion-item" data-sec="comps">
          <div class="fp-accordion-head">
            <div class="icon">🥊</div>
            <div class="lbl">${_t('acc.competitors')} (${r.comps.length})</div>
            <div class="hint">${fmtNum(r.totalCaptifs)} ${_t('comp.captifs')}</div>
            <svg class="chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>
          </div>
          <div class="fp-accordion-body">
            ${buildCompsMiniMap(r.comps, t)}
            <div class="card" style="padding:0;margin-top:10px">
              ${r.comps.slice(0, 10).map(c => `
                <div style="padding:10px 12px;border-bottom:1px solid rgba(71,85,115,.2);display:flex;align-items:center;gap:10px">
                  <div style="width:6px;height:34px;background:${c.color};border-radius:2px"></div>
                  <div style="flex:1;min-width:0">
                    <div style="font-size:12px;font-weight:600;color:var(--white);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_esc(c.name)}</div>
                    <div style="font-size:10px;color:var(--gray2)">${_esc(c.segment)} · ${(c.dist/1000).toFixed(1)}km · ${c.effectiveRate}% capt.</div>
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

      ${t._kind === 'custom' ? `
        <div class="fp-detail-danger" style="margin-top:18px;padding:14px;border:1px solid rgba(239,68,68,.25);border-radius:12px;background:rgba(239,68,68,.06)">
          <div style="font-size:11px;color:var(--gray2);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">Zone sensible</div>
          <button id="fpDeleteSite" data-id="${t._id}" style="width:100%;padding:12px;border-radius:10px;border:1px solid rgba(239,68,68,.35);background:rgba(239,68,68,.12);color:#f87171;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>
            Supprimer ce site
          </button>
          <div style="font-size:10px;color:var(--gray2);text-align:center;margin-top:8px">La suppression est synchronisée sur tous tes appareils.</div>
        </div>
      ` : ''}
    `;

    qs('#fpDetailBack').addEventListener('click', () => { haptic(10); transitionTo('summary'); });

    // v6.42 — Delete custom site from mobile detail view. Calls removeCustomSite
    // which does soft-delete + pushNow (CRDT tombstone propagates cross-device).
    const delBtn = qs('#fpDeleteSite', det);
    if (delBtn) {
      delBtn.addEventListener('click', async () => {
        haptic(20);
        const id = delBtn.dataset.id;
        const site = getAllSites()[activeIdx];
        const name = site?.name || 'ce site';
        if (!confirm(`Supprimer "${name}" ?\n\nCette action supprime le site sur cet appareil et sur tous tes autres appareils (Mac, iPhone…).`)) return;
        if (typeof removeCustomSite === 'function') {
          removeCustomSite(id);
        }
        // Back to summary: the site is gone from getAllSites() now (tombstone filtered).
        // Force a full rebuild of the carousel + pins, then close detail.
        window._fpMobileRefreshSites?.();
        // Activate nearest remaining site (or first) to avoid stale activeIdx
        const remaining = getAllSites();
        if (remaining.length > 0) {
          activateSite(Math.min(activeIdx, remaining.length - 1), false);
        }
        transitionTo('summary');
      });
    }

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

    // Rent + Charges + Surface sliders — live recomputation
    const slider = qs('#fpRentSlider');
    if (slider) slider.addEventListener('input', (e) => onRentSliderChange(e.target.value));
    const chargeSlider = qs('#fpChargeSlider');
    if (chargeSlider) chargeSlider.addEventListener('input', (e) => onChargeSliderChange(e.target.value));
    const surfaceSlider = qs('#fpSurfaceSlider');
    if (surfaceSlider) surfaceSlider.addEventListener('input', (e) => onSurfaceSliderChange(e.target.value));

    // Animate the hero metrics in from zero on detail open
    setTimeout(() => {
      const heroCards = qsa('#fpDetail > div[style*="grid-template-columns"] > div');
      if (heroCards.length >= 4) {
        const mNode = heroCards[0].querySelector('div[style*="font-size:26px"]');
        const iNode = heroCards[1].querySelector('div[style*="font-size:26px"]');
        const nNode = heroCards[2].querySelector('div[style*="font-size:22px"]');
        const sNode = heroCards[3].querySelector('div[style*="font-size:26px"]');
        if (mNode) animateNumber(mNode, 0, a.members,  700, v => fmtNum(v));
        if (iNode) animateNumber(iNode, 0, (a.irrEquity ?? a.irrBase), 700, v => fmtPct(v));
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
      { key: 'conservateur', label: _t('pnl.scenario.conservative'), color: '#f87171' },
      { key: 'base',         label: _t('pnl.scenario.base'),          color: 'var(--accent)' },
      { key: 'optimiste',    label: _t('pnl.scenario.optimistic'),    color: '#34d399' }
    ];
    // Rent slider UI — recomputes everything on input
    const currentRent = window._rentOverride?.y1 ?? 10.5;

    // Sparkline: cumulative cashflow over 60 months for BASE scenario
    const spark = buildSparkline(r.pnl?.base);
    const currentCharge = window._chargeOverride?.chargeTotal ?? 5.5; // 5 SC + 0.5 MF default
    const defaultSurface = (typeof PNL_DEFAULTS !== 'undefined' && PNL_DEFAULTS?.rentSteps?.surface) || 1449;
    const currentSurface = window._surfaceOverride?.surface ?? defaultSurface;
    // v6.61 — badges "Modifié par X il y a Y" pour chaque override
    const activeT = getAllSites()[activeIdx];
    const sKey = activeT ? siteKeyFor(activeT) : '';
    const rentBadge    = overrideBadgeHTML(sKey, 'rent');
    const chargeBadge  = overrideBadgeHTML(sKey, 'charge');
    const surfaceBadge = overrideBadgeHTML(sKey, 'surface');

    return `
      <!-- Cashflow sparkline (CAF annuelle) — wrapped in container for live update -->
      <div id="fpCafContainer">${spark}</div>

      <!-- Rent slider -->
      <div class="card" style="padding:14px 16px;margin-bottom:10px;background:linear-gradient(135deg,rgba(30,41,59,.8),rgba(17,24,39,.4))">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div>
            <div style="font-size:11px;color:var(--gray2);text-transform:uppercase;letter-spacing:.5px">${_t('slider.rent.label')}</div>
            <div style="font-size:13px;font-weight:700;color:var(--white)">${_t('slider.rent.sub')}</div>
          </div>
          <div style="text-align:right">
            <div id="fpRentValue" style="font-size:22px;font-weight:900;color:var(--accent);line-height:1">${currentRent.toFixed(1)}<span style="font-size:11px;color:var(--gray)"> €/m²</span></div>
          </div>
        </div>
        <input type="range" id="fpRentSlider" min="5" max="25" step="0.5" value="${currentRent}"
               style="width:100%;accent-color:var(--accent);margin:0">
        <div style="display:flex;justify-content:space-between;font-size:9px;color:var(--gray2);margin-top:2px">
          <span>5 €</span><span>${_t('slider.rent.marketHint')}</span><span>25 €</span>
        </div>
        <div id="fpRentBadge" style="margin-top:6px;text-align:right">${rentBadge}</div>

        <!-- Charges slider (service charges + marketing fee) -->
        <div style="height:1px;background:var(--border);margin:12px 0"></div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div>
            <div style="font-size:11px;color:var(--gray2);text-transform:uppercase;letter-spacing:.5px">${_t('slider.charge.label')}</div>
            <div style="font-size:13px;font-weight:700;color:var(--white)">${_t('slider.charge.sub')}</div>
          </div>
          <div style="text-align:right">
            <div id="fpChargeValue" style="font-size:22px;font-weight:900;color:#60a5fa;line-height:1">${currentCharge.toFixed(1)}<span style="font-size:11px;color:var(--gray)"> €/m²</span></div>
          </div>
        </div>
        <input type="range" id="fpChargeSlider" min="0" max="12" step="0.25" value="${currentCharge}"
               style="width:100%;accent-color:#60a5fa;margin:0">
        <div style="display:flex;justify-content:space-between;font-size:9px;color:var(--gray2);margin-top:2px">
          <span>0 €</span><span>${_t('slider.charge.standardHint')}</span><span>12 €</span>
        </div>
        <div id="fpChargeBadge" style="margin-top:6px;text-align:right">${chargeBadge}</div>

        <!-- Surface slider (m²) -->
        <div style="height:1px;background:var(--border);margin:12px 0"></div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div>
            <div style="font-size:11px;color:var(--gray2);text-transform:uppercase;letter-spacing:.5px">${_t('slider.surface.label')}</div>
            <div style="font-size:13px;font-weight:700;color:var(--white)">${_t('slider.surface.sub')}</div>
          </div>
          <div style="text-align:right">
            <div id="fpSurfaceValue" style="font-size:22px;font-weight:900;color:#a78bfa;line-height:1">${fmtNum(currentSurface)}<span style="font-size:11px;color:var(--gray)"> m²</span></div>
          </div>
        </div>
        <input type="range" id="fpSurfaceSlider" min="500" max="3000" step="50" value="${currentSurface}"
               style="width:100%;accent-color:#a78bfa;margin:0">
        <div style="display:flex;justify-content:space-between;font-size:9px;color:var(--gray2);margin-top:2px">
          <span>500 m²</span><span>${_t('slider.surface.refHint')}</span><span>3 000 m²</span>
        </div>
        <div id="fpSurfaceBadge" style="margin-top:6px;text-align:right">${surfaceBadge}</div>

        <div id="fpRentAllInHint" style="margin-top:10px;padding:8px 10px;background:rgba(212,160,23,.08);border-radius:6px;font-size:10px;color:var(--gray)">
          ${_t('slider.allInY1.prefix')}<b style="color:var(--accent);font-size:12px">${(currentRent + currentCharge).toFixed(1)} €/m²</b> × ${fmtNum(currentSurface)} m² = <b style="color:var(--accent)">${fmtM(Math.round(currentSurface * (currentRent + currentCharge) * 12))}${_t('slider.allInY1.perYear')}</b>
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
                <div><div style="color:var(--gray2)">${_t('pnl.npv')}</div><div class="fp-scenario-npv" data-key="${s.key}" style="font-weight:700;color:var(--white)">${fmtM(p.npv)}</div></div>
                <div><div style="color:var(--gray2)">${_t('pnl.breakeven')}</div><div class="fp-scenario-be" data-key="${s.key}" style="font-weight:700;color:var(--white)">${p.breakevenMonth ? p.breakevenMonth + ' ' + _t('pnl.moShort') : '—'}</div></div>
                <div><div style="color:var(--gray2)">${_t('pnl.payback')}</div><div class="fp-scenario-pb" data-key="${s.key}" style="font-weight:700;color:var(--white)">${p.paybackMonth ? p.paybackMonth + ' ' + _t('pnl.moShort') : '—'}</div></div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  // ─── COMPETITOR DISTRIBUTION: distance buckets + segments ──────
  // Readable infographic replacing the unreadable radar mini-map.
  // Shows two stacked views:
  //   1. Distribution by distance band (0-1km, 1-2km, 2-3km) — proximité
  //   2. Capture par marque (top brands that feed FP's captifs)
  function buildCompsMiniMap(comps, target) {
    if (!comps || comps.length === 0) return '';

    // ─── Distance buckets ───
    const bands = [
      { label: '0 – 1 km', min: 0,    max: 1000, color: '#ef4444', subtitle: 'proche' },
      { label: '1 – 2 km', min: 1000, max: 2000, color: '#f97316', subtitle: 'moyen' },
      { label: '2 – 3 km', min: 2000, max: 3000, color: '#eab308', subtitle: 'éloigné' }
    ];
    bands.forEach(b => {
      const inBand = comps.filter(c => c.dist >= b.min && c.dist < b.max);
      b.count   = inBand.length;
      b.captifs = inBand.reduce((a, c) => a + (c.captured || 0), 0);
      b.avgRate = inBand.length > 0 ? inBand.reduce((a, c) => a + (c.effectiveRate || 0), 0) / inBand.length : 0;
    });
    const maxBand = Math.max(...bands.map(b => b.count), 1);
    const totalCaptifs = comps.reduce((a, c) => a + (c.captured || 0), 0);

    const distanceBars = bands.map(b => `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(71,85,115,.2)">
        <div style="flex:0 0 78px">
          <div style="font-size:12px;font-weight:700;color:var(--white)">${b.label}</div>
          <div style="font-size:9px;color:var(--gray2);text-transform:uppercase;letter-spacing:.4px">${b.subtitle}</div>
        </div>
        <div style="flex:1;min-width:0;position:relative;height:24px;background:var(--card3);border-radius:12px;overflow:hidden">
          <div class="fp-band-fill" style="height:100%;width:${(b.count / maxBand * 100).toFixed(0)}%;background:linear-gradient(90deg,${b.color}aa,${b.color});border-radius:12px;transition:width .8s cubic-bezier(.22,.9,.3,1)"></div>
          <div style="position:absolute;left:10px;top:0;bottom:0;display:flex;align-items:center;font-size:11px;font-weight:700;color:var(--white);text-shadow:0 1px 2px rgba(0,0,0,.6)">${b.count} club${b.count > 1 ? 's' : ''}</div>
        </div>
        <div style="flex:0 0 auto;text-align:right;min-width:60px">
          <div style="font-size:14px;font-weight:800;color:${b.color};line-height:1">${fmtNum(b.captifs)}</div>
          <div style="font-size:9px;color:var(--gray2);margin-top:2px">captifs</div>
        </div>
      </div>
    `).join('');

    // ─── Brand / segment distribution ───
    const brands = {};
    comps.forEach(c => {
      const brand = (c.name || 'Autres').split(' ').slice(0, 2).join(' '); // "World Class", "Stay Fit"...
      if (!brands[brand]) brands[brand] = { count: 0, captifs: 0, color: c.color };
      brands[brand].count += 1;
      brands[brand].captifs += (c.captured || 0);
    });
    const brandList = Object.entries(brands)
      .sort((a, b) => b[1].captifs - a[1].captifs)
      .slice(0, 5);
    const maxBrand = brandList[0]?.[1]?.captifs || 1;

    const brandBars = brandList.map(([name, d]) => `
      <div style="display:flex;align-items:center;gap:8px;padding:6px 0">
        <div style="flex:0 0 96px;display:flex;align-items:center;gap:6px;min-width:0">
          <div style="width:8px;height:8px;border-radius:50%;background:${d.color};flex-shrink:0;box-shadow:0 0 6px ${d.color}66"></div>
          <div style="font-size:11px;font-weight:600;color:var(--white);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${name}</div>
        </div>
        <div style="flex:1;min-width:0;height:10px;background:var(--card3);border-radius:5px;overflow:hidden">
          <div class="fp-brand-fill" style="height:100%;width:${(d.captifs / maxBrand * 100).toFixed(0)}%;background:${d.color};border-radius:5px;transition:width 1s cubic-bezier(.22,.9,.3,1)"></div>
        </div>
        <div style="flex:0 0 auto;text-align:right;min-width:52px">
          <div style="font-size:11px;font-weight:700;color:var(--accent);line-height:1">${fmtNum(d.captifs)}</div>
          <div style="font-size:8px;color:var(--gray2)">${d.count} club${d.count > 1 ? 's' : ''}</div>
        </div>
      </div>
    `).join('');

    return `
      <!-- Distance distribution -->
      <div class="card" style="padding:14px 16px;margin-bottom:10px;background:linear-gradient(180deg,rgba(30,41,59,.45),rgba(17,24,39,.15))">
        <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:8px">
          <div>
            <div style="font-size:11px;color:var(--gray2);text-transform:uppercase;letter-spacing:.5px">Proximité concurrentielle</div>
            <div style="font-size:13px;font-weight:700;color:var(--white);margin-top:2px">${comps.length} concurrents dans 3 km</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:16px;font-weight:900;color:var(--accent);line-height:1">${fmtNum(totalCaptifs)}</div>
            <div style="font-size:9px;color:var(--gray2);margin-top:2px">captifs total</div>
          </div>
        </div>
        ${distanceBars}
      </div>

      <!-- Brand distribution (top 5 sources of captifs) -->
      <div class="card" style="padding:14px 16px;margin-bottom:10px;background:linear-gradient(180deg,rgba(30,41,59,.45),rgba(17,24,39,.15))">
        <div style="margin-bottom:10px">
          <div style="font-size:11px;color:var(--gray2);text-transform:uppercase;letter-spacing:.5px">Top marques — captifs potentiels</div>
          <div style="font-size:13px;font-weight:700;color:var(--white);margin-top:2px">D'où viennent nos ${fmtNum(totalCaptifs)} captifs</div>
        </div>
        ${brandBars}
      </div>
    `;
  }

  // ─── FINANCING CARD: equity/debt split + IRR project vs equity ──
  function financingCard(pnlBase) {
    if (!pnlBase) return '';
    const fin = pnlBase.financing || {};
    const equity = pnlBase.equity || 0;
    const loan = pnlBase.loanPrincipal || 0;
    const monthlyPmt = pnlBase.loanMonthlyPayment || 0;
    const totalInt = pnlBase.totalInterest || 0;
    const irrProj = pnlBase.irr;
    const irrEq = pnlBase.irrEquity;

    return `
      <div class="card" style="padding:14px 16px;margin-bottom:10px;background:linear-gradient(180deg,rgba(30,41,59,.45),rgba(17,24,39,.15))">
        <div style="font-size:11px;color:var(--gray2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">${_t('fin.structure')}</div>
        <div style="display:flex;height:28px;border-radius:6px;overflow:hidden;margin-bottom:10px">
          <div style="flex:${(fin.equityRatio || 0.3) * 100};background:linear-gradient(90deg,#34d399,#10b981);display:flex;align-items:center;justify-content:center;color:#000;font-size:10px;font-weight:800">${_t('fin.equityShort')} ${Math.round((fin.equityRatio || 0.3) * 100)}%</div>
          <div style="flex:${(fin.loanRatio || 0.7) * 100};background:linear-gradient(90deg,#3b82f6,#1d4ed8);display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:800">${_t('fin.loanShort')} ${Math.round((fin.loanRatio || 0.7) * 100)}%</div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:11px">
          <div><div style="color:var(--gray2)">${_t('fin.equity')}</div><div style="color:#34d399;font-weight:800;font-size:14px">${fmtM(equity)}</div></div>
          <div><div style="color:var(--gray2)">${_t('fin.loan')}</div><div style="color:#60a5fa;font-weight:800;font-size:14px">${fmtM(loan)}</div></div>
          <div><div style="color:var(--gray2)">${_t('fin.rate')}</div><div style="color:var(--white);font-weight:700">${((fin.loanRate || 0.065) * 100).toFixed(1)}%</div></div>
          <div><div style="color:var(--gray2)">${_t('fin.term')}</div><div style="color:var(--white);font-weight:700">${fin.loanTermYears || 7} ${_t('fin.years')}</div></div>
          <div><div style="color:var(--gray2)">${_t('fin.monthlyPmt')}</div><div style="color:var(--white);font-weight:700">${fmtNum(monthlyPmt)} €</div></div>
          <div><div style="color:var(--gray2)">${_t('fin.totalInterest')}</div><div style="color:#f87171;font-weight:700">${fmtM(totalInt)}</div></div>
        </div>
      </div>

      <div class="card" style="padding:14px 16px;margin-bottom:10px">
        <div style="font-size:11px;color:var(--gray2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">${_t('fin.irrProject')} vs ${_t('fin.irrEquity')}
          <span class="info-tip" style="display:inline-flex;width:16px;height:16px;border-radius:50%;background:var(--card3);color:var(--gray);align-items:center;justify-content:center;font-size:10px;font-weight:700;cursor:pointer;margin-left:4px">?
            <div class="tip-content"><strong>IRR Projet (unlevered)</strong> = rentabilité opérationnelle du club, peu importe comment il est financé. Base de décision go/no-go.<br><br>
            <strong>IRR Equity (levered)</strong> = rentabilité pour les associés après service de dette. Inclut l'effet de levier de l'emprunt → généralement plus élevé que l'IRR Projet quand le IRR Projet > taux d'emprunt.<br><br>
            <span style="color:var(--gray2)">Exemple: si IRR Projet 40% et taux 6.5%, l'effet levier amplifie → IRR Equity peut dépasser 60-80%.</span></div>
          </span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div style="padding:12px;background:rgba(30,41,59,.45);border-radius:8px">
            <div style="font-size:10px;color:var(--gray2);text-transform:uppercase">${_t('fin.irrProject')}</div>
            <div style="font-size:22px;font-weight:900;color:${irrProj > 0 ? '#34d399' : '#f87171'};margin-top:4px">${fmtPct(irrProj)}</div>
            <div style="font-size:9px;color:var(--gray2);margin-top:2px">${_t('fin.irrLabelUnlevered')}</div>
          </div>
          <div style="padding:12px;background:rgba(30,41,59,.45);border-radius:8px;border:1px solid rgba(212,160,23,.3)">
            <div style="font-size:10px;color:var(--accent);text-transform:uppercase;font-weight:700">${_t('fin.irrEquity')} ⭐</div>
            <div style="font-size:22px;font-weight:900;color:${irrEq > 0 ? '#34d399' : '#f87171'};margin-top:4px">${fmtPct(irrEq)}</div>
            <div style="font-size:9px;color:var(--gray2);margin-top:2px">${_t('fin.irrLabelLevered')}</div>
          </div>
        </div>
      </div>
    `;
  }

  // ─── BP TEMPLATE: didactic cost structure reference ─────────────
  function bpTemplateCard() {
    // Uses the current PNL_DEFAULTS values for display
    const P = (typeof PNL_DEFAULTS !== 'undefined' ? PNL_DEFAULTS : {});
    const opexCurve = P.opexOpsRateByYear || [0.20, 0.18, 0.16, 0.14, 0.12];
    const fin = P.financing || {};

    const row = (label, val, color, hint) => `
      <div style="display:flex;align-items:baseline;gap:10px;padding:7px 0;border-bottom:1px solid rgba(71,85,115,.18)">
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:600;color:var(--white)">${label}</div>
          ${hint ? `<div style="font-size:10px;color:var(--gray2);margin-top:2px">${hint}</div>` : ''}
        </div>
        <div style="flex:0 0 auto;font-size:14px;font-weight:800;color:${color || 'var(--accent)'};font-variant-numeric:tabular-nums">${val}</div>
      </div>
    `;

    return `
      <div class="card" style="padding:14px 16px;margin-bottom:10px;background:linear-gradient(180deg,rgba(30,41,59,.45),rgba(17,24,39,.15))">
        <div style="font-size:11px;color:var(--gray2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">${_t('bp.revenues')}</div>
        ${row('FP Base TTC', (P.priceBaseTTC || 28) + ' €/mo', '#34d399', '')}
        ${row('FP Premium TTC', (P.pricePremiumTTC || 40) + ' €/mo', '#34d399', '')}
        ${row('FP Ultimate TTC', (P.priceUltimateTTC || 50) + ' €/mo', '#34d399', '')}
        ${row(_t('bp.targetMembersMaturity'), fmtNum(P.targetMembers || 4000), 'var(--accent)', 'A3 (BP V17 C34)')}
      </div>

      <div class="card" style="padding:14px 16px;margin-bottom:10px">
        <div style="font-size:11px;color:var(--gray2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">${_t('bp.costRates')}</div>
        ${row(_t('bp.staff'), '9.0% ' + _t('bp.perCA'), '#f87171', '')}
        ${row(_t('bp.costOfSales'), ((P.costOfSalesRate || 0.028) * 100).toFixed(1) + '% ' + _t('bp.perCA'), '#f87171', '')}
        ${row(_t('bp.opexY1'), (opexCurve[0] * 100).toFixed(0) + '% ' + _t('bp.perCA'), '#f87171', '')}
        ${row(_t('bp.opexY5'), (opexCurve[4] * 100).toFixed(0) + '% ' + _t('bp.perCA'), '#f87171', '')}
        ${row(_t('bp.franchiseRoyalty'), ((P.redevanceRate || 0.06) * 100).toFixed(0) + '% ' + _t('bp.perCAAdh'), '#f87171', '')}
        ${row(_t('bp.adFund'), ((P.fondsPubRate || 0.01) * 100).toFixed(0) + '% ' + _t('bp.perCAAdh'), '#f87171', '')}
        ${row(_t('bp.fpCloud'), (P.fpCloudMonthly || 600) + ' ' + _t('bp.perMonth'), '#f87171', '')}
        ${row(_t('bp.leasing'), fmtNum((typeof getScaledLeasingAnnual === 'function' ? getScaledLeasingAnnual() : (P.leasingAnnual || 100800)) / 12) + ' ' + _t('bp.perMonth'), '#f87171', '')}
      </div>

      <div class="card" style="padding:14px 16px;margin-bottom:10px">
        <div style="font-size:11px;color:var(--gray2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">${_t('bp.rentStepped')}</div>
        ${row('Y1-Y2', '10.5 €/m² → 16 €/m² all-in', 'var(--accent)', '')}
        ${row('Y3-Y4', '11.5 €/m² → 17 €/m² all-in', 'var(--accent)', '')}
        ${row('Y5+', '13 €/m² → 18.5 €/m² all-in', 'var(--accent)', '')}
        ${row(_t('bp.indexation'), _t('bp.indexationVal'), 'var(--gray)', '')}
        ${row(_t('bp.surfaceType'), '1 449 m²', 'var(--accent)', 'Hala Laminor G-28 First Floor')}
      </div>

      <div class="card" style="padding:14px 16px;margin-bottom:10px">
        <div style="font-size:11px;color:var(--gray2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">${_t('bp.capexFinancing')}</div>
        ${(() => {
          const scaledCapex = typeof getScaledCapex === 'function' ? getScaledCapex() : (P.capex || 1176000);
          const ref = P.rentSteps?.surface || 1449;
          const surf = window._surfaceOverride?.surface || ref;
          const scaleHint = surf === ref ? 'Travaux 840k + Equip 336k (BP V17 C79)' : `${_t('bp.scaledSurface')} ${Math.round(surf)} m² / ${ref} m² ${_t('bp.refHala')}`;
          return `
            ${row(_t('bp.capexTotal'), fmtM(scaledCapex), 'var(--accent)', scaleHint)}
            ${row(_t('fin.equity'), ((fin.equityRatio || 0.3) * 100).toFixed(0) + '% = ' + fmtM(scaledCapex * (fin.equityRatio || 0.3)), '#34d399', '')}
            ${row(_t('fin.loan'), ((fin.loanRatio || 0.7) * 100).toFixed(0) + '% = ' + fmtM(scaledCapex * (fin.loanRatio || 0.7)), '#60a5fa', '')}
          `;
        })()}
        ${row(_t('bp.loanRate'), ((fin.loanRate || 0.065) * 100).toFixed(1) + '%', 'var(--white)', 'RO SME 2026')}
        ${row(_t('bp.loanTerm'), (fin.loanTermYears || 7) + ' ' + _t('fin.years'), 'var(--white)', '')}
      </div>

      <div class="card" style="padding:14px 16px;margin-bottom:10px">
        <div style="font-size:11px;color:var(--gray2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">${_t('bp.financialParams')}</div>
        ${row(_t('bp.wacc'), ((P.discountRate || 0.12) * 100).toFixed(0) + '%', 'var(--accent)', 'BP V17 C112')}
        ${row(_t('bp.cit'), ((P.citRate || 0.16) * 100).toFixed(0) + '%', 'var(--gray)', '')}
        ${row(_t('bp.exitMultiple'), (P.exitMultiple || 6) + '×', 'var(--accent)', '')}
        ${row(_t('bp.pnlHorizon'), _t('bp.pnlHorizonVal'), 'var(--gray)', '')}
        ${row(_t('bp.growthA4A6'), '+5%/an', 'var(--gray)', _t('bp.postMaturity'))}
        ${row(_t('bp.growthA7'), '+2%/an', 'var(--gray)', _t('bp.longTerm'))}
      </div>

      <div class="card" style="padding:14px 16px;background:linear-gradient(135deg,rgba(212,160,23,.08),transparent);border:1px solid rgba(212,160,23,.2)">
        <div style="font-size:11px;color:var(--accent);text-transform:uppercase;letter-spacing:.5px;font-weight:700;margin-bottom:6px">${_t('bp.onairBenchmark')}</div>
        <div style="font-size:12px;color:var(--white);line-height:1.55">
          <b>2.24 M€</b> · EBITDA <b>44.7%</b> · Staff <b>9.0%</b> · Loyer <b>12.4%</b> · OPEX <b>10.8%</b> · Royalties <b>4%</b>
        </div>
      </div>
    `;
  }

  // ─── CAF ANNUELLE (Capacité d'AutoFinancement par an) ──────────
  // Shows year-by-year EBITDA bars (proxy for CAF since no debt/tax in model)
  // Plus the average over Y2-Y5 (skipping ramp-up Y1) as the hero metric.
  function buildSparkline(pnlBase) {
    if (!pnlBase || !Array.isArray(pnlBase.annualEBITDA) || pnlBase.annualEBITDA.length === 0) return '';
    const caf = pnlBase.annualEBITDA.slice(0, 5); // Y1..Y5
    const n = caf.length;

    // Hero: average CAF over mature years (Y2-Y5) — excludes ramp-up effect
    const matureYears = caf.slice(1);
    const avgMature = matureYears.length ? matureYears.reduce((a,b)=>a+b,0) / matureYears.length : (caf[0] || 0);
    const endColor = avgMature >= 0 ? '#34d399' : '#f87171';
    const endLabel = avgMature >= 0 ? 'CAF moy. Y2-Y5' : 'CAF moy. (déficit Y2-Y5)';

    // Chart sizing
    const w = 300, h = 110, padX = 14, padTop = 14, padBot = 22;
    const maxAbs = Math.max(...caf.map(v => Math.abs(v)), 1);
    const barW = (w - padX * 2) / n * 0.6;
    const gap  = (w - padX * 2) / n * 0.4;
    const zeroY = h - padBot;

    // Scale: map each value to a y position (zero line is at zeroY, max = padTop)
    const scale = (v) => {
      const ratio = v / maxAbs;                 // -1..1
      const usable = zeroY - padTop;            // available height above zero
      return zeroY - ratio * usable;
    };

    let bars = '';
    for (let i = 0; i < n; i++) {
      const v = caf[i];
      const y = Math.min(scale(v), zeroY);
      const barH = Math.abs(zeroY - scale(v));
      const x = padX + i * ((w - padX * 2) / n) + gap / 2;
      const color = v >= 0 ? '#34d399' : '#f87171';
      const valLbl = fmtM(v);
      const lblY = v >= 0 ? y - 4 : y + barH + 11;
      bars += `
        <rect class="fp-caf-bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}"
              rx="3" fill="${color}" fill-opacity=".85"
              style="filter:drop-shadow(0 2px 4px ${color}55)"/>
        <text x="${(x + barW/2).toFixed(1)}" y="${lblY.toFixed(1)}"
              fill="${color}" font-size="9" font-weight="700" text-anchor="middle">${valLbl}</text>
        <text x="${(x + barW/2).toFixed(1)}" y="${(h - 4).toFixed(1)}"
              fill="rgba(148,163,184,.6)" font-size="9" text-anchor="middle">Y${i+1}</text>
      `;
    }

    return `
      <div class="card" style="padding:14px;margin-bottom:10px;background:linear-gradient(180deg,rgba(30,41,59,.4),rgba(17,24,39,.2))">
        <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:6px">
          <div>
            <div style="font-size:11px;color:var(--gray2);text-transform:uppercase;letter-spacing:.5px;display:flex;align-items:center;gap:6px">
              CAF annuelle
              <span class="info-tip" style="display:inline-flex;width:16px;height:16px;border-radius:50%;background:var(--card3);color:var(--gray);align-items:center;justify-content:center;font-size:10px;font-weight:700;cursor:pointer">?
                <div class="tip-content"><strong>CAF — Capacité d'AutoFinancement</strong><br><br>
                  Trésorerie générée par l'activité chaque année (EBITDA ≈ CAF dans ce modèle : pas de dette ni impôt modélisé).<br><br>
                  <b>Y1</b> = ramp-up (membres en croissance, souvent + bas)<br>
                  <b>Y2-Y5</b> = cruising speed, stabilité<br><br>
                  La <b style="color:#34d399">moyenne Y2-Y5</b> est le meilleur indicateur de la rentabilité structurelle — elle seule permet de juger si le club tient sur la durée.
                </div>
              </span>
            </div>
            <div style="font-size:13px;font-weight:700;color:var(--white);margin-top:2px">Évolution sur 5 ans · Base</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:18px;font-weight:900;color:${endColor};line-height:1">${fmtM(avgMature)}<span style="font-size:11px;color:var(--gray2);font-weight:500">/an</span></div>
            <div style="font-size:10px;color:var(--gray2);margin-top:2px">${endLabel}</div>
          </div>
        </div>
        <svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="display:block">
          <!-- Zero baseline -->
          <line x1="${padX}" y1="${zeroY}" x2="${w - padX}" y2="${zeroY}"
                stroke="rgba(148,163,184,.35)" stroke-width="1"/>
          ${bars}
        </svg>
      </div>
    `;
  }

  // ─── Live hint (Total all-in Y1) — reads current slider values ─
  function updateRentAllInHint() {
    const rent = parseFloat(qs('#fpRentSlider')?.value || 10.5);
    const charge = parseFloat(qs('#fpChargeSlider')?.value || 5.5);
    const surface = parseInt(qs('#fpSurfaceSlider')?.value || 1449, 10);
    const hint = qs('#fpRentAllInHint');
    if (!hint) return;
    const totalPerSqm = (rent + charge).toFixed(1);
    const annual = Math.round(surface * (rent + charge) * 12);
    hint.innerHTML = `${_t('slider.allInY1.prefix')}<b style="color:var(--accent);font-size:12px">${totalPerSqm} €/m²</b> × ${fmtNum(surface)} m² = <b style="color:var(--accent)">${fmtM(annual)}${_t('slider.allInY1.perYear')}</b>`;
  }

  // ─── Live surface recalc (m²) ──────────────────────────────────
  let surfaceDebounce;
  function onSurfaceSliderChange(val) {
    const v = parseInt(val, 10);
    const vEl = qs('#fpSurfaceValue');
    if (vEl) vEl.innerHTML = fmtNum(v) + '<span style="font-size:11px;color:var(--gray)"> m²</span>';
    haptic(4);
    updateRentAllInHint();
    clearTimeout(surfaceDebounce);
    surfaceDebounce = setTimeout(() => {
      window._surfaceOverride = { surface: v };
      // Persist per site (in-memory map + localStorage for cross-session)
      const t = getAllSites()[activeIdx];
      if (t) {
        const key = siteKeyFor(t);
        window._surfaceOverrides = window._surfaceOverrides || {};
        window._surfaceOverrides[key] = v;
        window.persistOverrides?.();
        markOverrideEdited(key, 'surface');
        refreshOverrideBadges(key);
      }
      recomputeCurrentAnalysis(parseFloat(qs('#fpRentSlider')?.value || 10.5));
    }, 90);
  }

  // ─── Live charge recalc (service + marketing fee €/m²) ────────
  let chargeDebounce;
  function onChargeSliderChange(val) {
    const v = parseFloat(val);
    const vEl = qs('#fpChargeValue');
    if (vEl) vEl.innerHTML = v.toFixed(1) + '<span style="font-size:11px;color:var(--gray)"> €/m²</span>';
    haptic(4);
    updateRentAllInHint();
    clearTimeout(chargeDebounce);
    chargeDebounce = setTimeout(() => {
      window._chargeOverride = { chargeTotal: v };
      // Persist per site (in-memory map + localStorage for cross-session)
      const t = getAllSites()[activeIdx];
      if (t) {
        const key = siteKeyFor(t);
        window._chargeOverrides = window._chargeOverrides || {};
        window._chargeOverrides[key] = v;
        window.persistOverrides?.();
        markOverrideEdited(key, 'charge');
        refreshOverrideBadges(key);
      }
      recomputeCurrentAnalysis(parseFloat(qs('#fpRentSlider')?.value || 10.5));
    }, 90);
  }

  // ─── Live rent recalc (triggered by slider) ────────────────────
  let rentDebounce;
  function onRentSliderChange(val) {
    const v = parseFloat(val);
    qs('#fpRentValue').innerHTML = v.toFixed(1) + '<span style="font-size:12px;color:var(--gray)"> €/m²</span>';
    haptic(4); // subtle tick per step
    updateRentAllInHint();
    clearTimeout(rentDebounce);
    rentDebounce = setTimeout(() => {
      // Persist per-site so override stays scoped to this site across navigations
      // AND across sessions (safeStorage write via persistOverrides).
      const t = getAllSites()[activeIdx];
      if (t) {
        const key = siteKeyFor(t);
        window._rentOverrides = window._rentOverrides || {};
        window._rentOverrides[key] = v;
        window.persistOverrides?.();
        markOverrideEdited(key, 'rent');
        refreshOverrideBadges(key);
      }
      recomputeCurrentAnalysis(v);
    }, 90);
  }

  // v6.61 — refresh the 3 override badges (rent/charge/surface) without rebuilding the card
  function refreshOverrideBadges(key) {
    if (!key) return;
    const rb = qs('#fpRentBadge');
    const cb = qs('#fpChargeBadge');
    const sb = qs('#fpSurfaceBadge');
    if (rb) rb.innerHTML = overrideBadgeHTML(key, 'rent');
    if (cb) cb.innerHTML = overrideBadgeHTML(key, 'charge');
    if (sb) sb.innerHTML = overrideBadgeHTML(key, 'surface');
  }
  function recomputeCurrentAnalysis(rentY1) {
    try {
      window._rentOverride = { y1: rentY1 };
      // Bugfix v6.8: was TARGETS[activeIdx] — broke slider for custom sites.
      const t = getAllSites()[activeIdx];
      if (!t) return;
      const r = runCaptageAnalysis(t.lat, t.lng, 3000);
      const exec = computeExecSummary(r);
      const a = analyses[activeIdx];
      const oldMembers = a?.members;
      const oldIrr = a?.irrEquity ?? a?.irrBase; // v6.46 — hero affiche Equity
      const oldNpv = a?.npvBase;
      if (a) {
        a.members   = r.totalTheorique;
        a.irrBase   = r.pnl?.base?.irr;
        a.irrEquity = r.pnl?.base?.irrEquity; // v6.46
        a.npvBase   = r.pnl?.base?.npv;
        a.beBase    = r.pnl?.base?.breakevenMonth;
        a.verdict   = typeof exec.verdict === 'object' ? exec.verdict.label : exec.verdict;
        a.score     = exec.total;
        a.raw       = r;
      }
      // ═══ Persist KPIs dans _siteAnalyses (v6.21) ═══
      // Critical : sans cet appel, le Dashboard compare (desktop) + l'export
      // PDF matrice comparative gardaient l'IRR initial après override slider.
      // On sync maintenant TRI / NPV / payback / verdict dans localStorage
      // `fpSiteAnalyses` (source de vérité cross-session).
      if (typeof window.saveSiteAnalysis === 'function' && t.name && t.lat != null && t.lng != null) {
        try { window.saveSiteAnalysis(t.name, t.lat, t.lng, r, exec); }
        catch (e) { console.warn('[FP mobile] saveSiteAnalysis failed:', e); }
      }
      // Update the active site card
      refreshCard(activeIdx);
      // Update hero metric cards (top of detail view) with animated counters
      updateDetailHero(r, a, { oldMembers, oldIrr, oldNpv });
      // Update P&L scenarios inline
      updatePnLInline(r);
      // Update Financement + BP Template accordion bodies (CAPEX + leasing scalent surface)
      const finBody = qs('.fp-accordion-item[data-sec="financing"] .fp-accordion-body');
      if (finBody) finBody.innerHTML = financingCard(r.pnl?.base);
      const bpBody = qs('.fp-accordion-item[data-sec="bptemplate"] .fp-accordion-body');
      if (bpBody) bpBody.innerHTML = bpTemplateCard();
      // Update CAF annuelle bars inline (live response to rent change)
      updateCafBarsInline(r);
      // Re-run invariants check (via audit wrapper automatic)
    } catch (e) { console.warn('[FP rent-slider] recompute failed:', e); }
  }

  // Regenerate the CAF annuelle sparkline card when rent changes
  function updateCafBarsInline(r) {
    const container = qs('#fpCafContainer');
    if (!container) return;
    const newHtml = buildSparkline(r.pnl?.base);
    if (!newHtml) return;
    container.innerHTML = newHtml;
    // Re-run the bar-grow animation
    const card = container.querySelector('.card');
    if (card) animateSparkline(card);
  }

  // v6.61 — update robuste via data-fp-hero attrs (plus de fragile sélecteur
  // basé sur inline style). Garanti de matcher le markup de buildDetail.
  function updateDetailHero(r, a, prev) {
    if (!a) return;
    const container = qs('#fpDetail');
    if (!container) return;

    // Sélecteurs directs via data-attrs — pas d'ambiguïté possible
    const heroVal = kind => qs(`[data-fp-hero="${kind}"] [data-fp-hero-value]`, container);
    const heroSub = kind => qs(`[data-fp-hero="${kind}"] [data-fp-hero-sub]`, container);

    const mNode = heroVal('members');
    const iNode = heroVal('irr');
    const nNode = heroVal('npv');
    const sNode = heroVal('saz');

    if (mNode) animateNumber(mNode, prev.oldMembers || 0, a.members, 500, (v) => fmtNum(v));
    if (iNode) {
      const irrShown = (a.irrEquity ?? a.irrBase);
      iNode.style.color = (irrShown > 0 ? '#34d399' : '#f87171');
      animateNumber(iNode, prev.oldIrr || 0, irrShown, 500, (v) => fmtPct(v));
    }
    if (nNode) {
      nNode.style.color = (a.npvBase > 0 ? '#34d399' : '#f87171');
      animateNumber(nNode, prev.oldNpv || 0, a.npvBase, 500, (v) => fmtM(v));
    }
    if (sNode) sNode.textContent = Math.round(a.score);

    // Sub-texts (projet IRR, payback, etc.) — toujours synchrones pour matcher la valeur affichée
    const mSub = heroSub('members');
    if (mSub && r) mSub.textContent = `${fmtNum(r.pessimiste)} – ${fmtNum(r.optimiste)}`;

    const iSub = heroSub('irr');
    if (iSub) {
      const pb = a.beBase ? a.beBase + ' ' + _t('detail.hero.paybackMonths') : _t('detail.hero.paybackNA');
      iSub.textContent = `Projet: ${fmtPct(a.irrBase)} · ${_t('detail.hero.payback')} ${pb}`;
    }

    // Refresh aussi la peek card du site actif pour garder header + KPIs aligned
    try { refreshCard(activeIdx); } catch {}
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

  // ─── CAF BARS: animate height from 0 ───────────────────────────
  function animateSparkline(container) {
    const bars = qsa('.fp-caf-bar', container);
    bars.forEach((bar, i) => {
      const origY = parseFloat(bar.getAttribute('y'));
      const origH = parseFloat(bar.getAttribute('height'));
      if (!isFinite(origY) || !isFinite(origH)) return;
      const isNegative = origH > 0 && origY > parseFloat(bar.closest('svg')?.getAttribute('height') || 110) / 2;
      // Start collapsed at baseline
      bar.setAttribute('y', isNegative ? origY : origY + origH);
      bar.setAttribute('height', 0);
      bar.style.transition = 'y .6s cubic-bezier(.22,.9,.3,1), height .6s cubic-bezier(.22,.9,.3,1)';
      setTimeout(() => {
        bar.setAttribute('y', origY);
        bar.setAttribute('height', origH);
      }, 80 + i * 90);
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

  // ─── DEMO FAB mobile (bottom-left) ─────────────────────────────
  // Miroir du FAB principal, avec icône play. Ouvre le showDemoPanel
  // qui propose: Visite guidée (tour) OU Comment ça marche (carousel 6 slides).
  function buildDemoFab() {
    if (qs('.fp-mobile-fab-demo')) return;
    const fab = document.createElement('div');
    fab.className = 'fp-mobile-fab-demo';
    fab.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M 7 4 L 19 12 L 7 20 Z"/></svg>`;
    fab.setAttribute('aria-label', 'Démonstration');
    document.body.appendChild(fab);
    fab.addEventListener('click', () => {
      try { haptic(18); } catch {}
      if (typeof window.showDemoPanel === 'function') window.showDemoPanel();
    });
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
        <div class="title">${_t('fab.layers') + ' & ' + _t('fab.competitors')}</div>
        <div class="close-btn" id="fpSecondaryClose">&times;</div>
      </div>
      <div class="fp-secondary-tabs" id="fpSecondaryTabs">
        <div class="fp-secondary-tab active" data-stab="layers">${_t('fab.layers')}</div>
        <div class="fp-secondary-tab" data-stab="concurrence">${_t('fab.competitors')}</div>
        <div class="fp-secondary-tab" data-stab="mysites">${_t('fab.mySites')}</div>
        <div class="fp-secondary-tab" data-stab="dash">${_t('fab.dashboard')}</div>
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

      // Render target sites into "Mes sites" clone body if applicable
      if (stab === 'mysites') {
        renderMySitesIntoClone(clone);
        setTimeout(() => enhanceAddSiteAutocomplete(clone), 100);
      }

      // Populate Dashboard compare dropdowns (desktop selects + sync)
      if (stab === 'dash') {
        try {
          if (typeof updateCompareSelects === 'function') updateCompareSelects();
        } catch {}
        // Re-sync dynamic HTML so the clone's selects reflect the now-populated source
        setTimeout(() => syncClonedDynamicContent(clone), 30);
      }

      // Rebuild Chart.js instances onto cloned canvases (Dashboard + Competition tabs).
      // Desktop owns the live Chart; cloned canvases are empty until we bind fresh ones.
      if (stab === 'dash' || stab === 'concurrence') {
        // Defer so layout is settled (chart-wrap height is 160-240px, needs DOM attach).
        setTimeout(() => rebuildClonedCharts(clone), 50);
      }

      // On any click in the clone, re-sync visual + dynamic HTML after
      // the click's onclick handlers ran (toggleLayer, toggleBrand, etc.).
      clone.addEventListener('click', (e) => {
        if (e.target.closest('input, textarea, select')) return;
        setTimeout(() => {
          syncToggleStates(clone);
          syncClonedDynamicContent(clone);
          if (qs('.fp-secondary-tab.active')?.dataset.stab === 'mysites') {
            renderMySitesIntoClone(clone);
          }
        }, 40);
      }, true);

      // Bridge <select data-orig-id=...> changes back to the desktop
      // DOM so that functions using el('compareA') / el('compareB')
      // see the user's chosen value. Also invoke their onchange handler.
      clone.addEventListener('change', (e) => {
        const sel = e.target.closest('select[data-orig-id]');
        if (!sel) return;
        const srcSel = document.getElementById(sel.dataset.origId);
        if (srcSel) {
          srcSel.value = sel.value;
          srcSel.dispatchEvent(new Event('change', { bubbles: true }));
          // Fallback: directly invoke the inline onchange function if set
          try {
            const handler = srcSel.getAttribute('onchange');
            if (handler) {
              // Usually "runComparison()" — call it directly after brief delay
              setTimeout(() => {
                try { new Function(handler).call(srcSel); } catch {}
                // Sync result container back to clone
                syncClonedDynamicContent(clone);
              }, 20);
            }
          } catch {}
        }
      }, true);
    }
  }

  // ─── ADD-SITE autocomplete (Google Places) inside "Mes sites" ──
  // Replaces the default "Adresse + Geocoder" form with live suggestions.
  function enhanceAddSiteAutocomplete(cloneRoot) {
    const input = cloneRoot.querySelector('[data-orig-id="newSiteAddr"]');
    if (!input || input.__autoWired) return;
    input.__autoWired = true;
    input.setAttribute('placeholder', 'Ex: Bd. Iuliu Maniu 100');
    input.setAttribute('autocomplete', 'off');

    // Container for suggestions (inserted after the input's parent row)
    const row = input.closest('div');
    const parent = row?.parentElement;
    if (!parent) return;

    const sugBox = document.createElement('div');
    sugBox.className = 'fp-addsite-sug';
    sugBox.style.cssText = 'display:none;margin-top:8px;max-height:280px;overflow-y:auto;border-radius:10px;border:1px solid var(--border);background:var(--card2)';
    parent.appendChild(sugBox);

    let debounceT, seq = 0, lastSession = null;
    const newSession = () => { lastSession = 'fp-add-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8); return lastSession; };

    input.addEventListener('input', (e) => {
      clearTimeout(debounceT);
      const q = e.target.value.trim();
      if (q.length < 2) { sugBox.style.display = 'none'; sugBox.innerHTML = ''; return; }
      const mySeq = ++seq;
      debounceT = setTimeout(async () => {
        sugBox.style.display = 'block';
        sugBox.innerHTML = '<div style="padding:10px;font-size:11px;color:var(--gray2);text-align:center">Recherche…</div>';
        try {
          if (typeof GOOGLE_API_KEY === 'undefined' || !GOOGLE_API_KEY) throw 'no-key';
          const token = lastSession || newSession();
          const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOGLE_API_KEY },
            body: JSON.stringify({
              input: q, languageCode: 'fr', regionCode: 'RO', sessionToken: token,
              locationBias: { circle: { center: { latitude: 44.4268, longitude: 26.1025 }, radius: 40000 } }
            })
          });
          if (mySeq !== seq) return; // stale
          if (!res.ok) throw 'api-err';
          const data = await res.json();
          renderSug(data.suggestions || [], 'google');
        } catch {
          // Nominatim fallback
          try {
            const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q + ', Bucharest, Romania')}&limit=5`);
            const data = await r.json();
            if (mySeq !== seq) return;
            renderSug(data.map(d => ({
              placePrediction: {
                text: { text: d.display_name },
                structuredFormat: {
                  mainText: { text: (d.display_name || '').split(',')[0] },
                  secondaryText: { text: (d.display_name || '').split(',').slice(1, 3).join(', ') }
                },
                _nominatim: { lat: parseFloat(d.lat), lng: parseFloat(d.lon) }
              }
            })), 'nominatim');
          } catch {
            sugBox.innerHTML = '<div style="padding:10px;font-size:11px;color:var(--gray2);text-align:center">Aucun résultat</div>';
          }
        }
      }, 220);
    });

    function renderSug(suggestions, source) {
      if (!suggestions || suggestions.length === 0) {
        sugBox.innerHTML = '<div style="padding:10px;font-size:11px;color:var(--gray2);text-align:center">Aucun résultat</div>';
        return;
      }
      sugBox.innerHTML = suggestions.slice(0, 6).map((s, i) => {
        const p = s.placePrediction;
        const main = p?.structuredFormat?.mainText?.text || p?.text?.text || '';
        const sec  = p?.structuredFormat?.secondaryText?.text || '';
        return `
          <div class="fp-addsite-sug-item" data-idx="${i}" style="padding:10px 12px;border-bottom:1px solid rgba(71,85,115,.2);cursor:pointer;display:flex;align-items:center;gap:10px">
            <svg width="18" height="18" viewBox="0 0 24 24" style="fill:var(--accent);flex-shrink:0"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/></svg>
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:700;color:var(--white);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${main}</div>
              <div style="font-size:10px;color:var(--gray);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${sec}</div>
            </div>
          </div>
        `;
      }).join('');
      qsa('.fp-addsite-sug-item', sugBox).forEach((item, i) => {
        item.addEventListener('click', () => selectAddSug(suggestions[i], source));
      });
    }

    async function selectAddSug(sug, source) {
      haptic(15);
      const p = sug.placePrediction;
      const name = p?.structuredFormat?.mainText?.text || p?.text?.text || 'Site custom';
      let lat, lng;
      if (source === 'nominatim') {
        lat = p._nominatim.lat; lng = p._nominatim.lng;
      } else if (p.placeId) {
        try {
          const token = lastSession;
          lastSession = null;
          const res = await fetch('https://places.googleapis.com/v1/places/' + encodeURIComponent(p.placeId), {
            method: 'GET',
            headers: {
              'X-Goog-Api-Key': GOOGLE_API_KEY,
              'X-Goog-FieldMask': 'displayName,location,formattedAddress',
              ...(token ? { 'X-Goog-Session-Token': token } : {})
            }
          });
          const detail = await res.json();
          lat = detail.location?.latitude;
          lng = detail.location?.longitude;
        } catch { alert('Impossible de récupérer les coordonnées'); return; }
      }
      if (!isFinite(lat) || !isFinite(lng)) { alert('Coordonnées invalides'); return; }
      if (typeof addCustomSite !== 'function') { alert('Fonction addCustomSite manquante'); return; }

      // Add to customSites + refresh views
      try {
        addCustomSite(lat, lng, name, '');
      } catch (e) { console.warn('addCustomSite failed:', e); }

      // Clean up UI
      input.value = '';
      sugBox.style.display = 'none';
      sugBox.innerHTML = '';

      // Refresh mobile pins + carousel + mes sites list
      try { window._fpMobileRefreshSites?.(); } catch {}

      // Close FAB + fly to new site + open summary
      closeSecondarySheet();
      if (window._fpMap) window._fpMap.flyTo([lat, lng], 15, { duration: .7 });
      setTimeout(() => {
        if (typeof window.onMapClick === 'function') window.onMapClick({ latlng: { lat, lng } });
        // Activate the new site (it's at the end of getAllSites)
        const all = getAllSites();
        const idx = all.findIndex(s => Math.abs(s.lat - lat) < 0.0001 && Math.abs(s.lng - lng) < 0.0001);
        if (idx >= 0) {
          activeIdx = idx;
          transitionTo('summary');
        }
      }, 450);
    }

    // Hide suggestions when clicking outside
    document.addEventListener('click', (ev) => {
      if (!sugBox.contains(ev.target) && ev.target !== input) {
        sugBox.style.display = 'none';
      }
    });
  }

  // ─── MES SITES: native mobile list + "+ Add site" CTA ──────────
  // Replaces the ugly cloned-desktop form with a clean list + prominent CTA.
  // The actual add-site flow lives in the dedicated full-screen overlay below.
  function renderMySitesIntoClone(cloneRoot) {
    const sites = getAllSites();

    // Hide the cloned desktop form (address input + list + buttons) — we render our own.
    Array.from(cloneRoot.children).forEach(child => {
      if (!child.classList.contains('fp-mysites-list') && !child.classList.contains('fp-addsite-cta-wrap')) {
        child.style.display = 'none';
      }
    });

    // Build a fresh list card
    const list = document.createElement('div');
    list.className = 'card fp-mysites-list';
    list.style.cssText = 'padding:0;margin-bottom:12px;overflow:hidden';
    list.innerHTML = `
      <div style="padding:12px 14px;border-bottom:1px solid var(--border);background:linear-gradient(90deg,rgba(212,160,23,.06),transparent)">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:14px">⭐</span>
          <div style="font-size:12px;font-weight:800;color:var(--accent);letter-spacing:.6px;text-transform:uppercase">${_t('mysites.allHeader').replace('⭐ ','').replace('⭐ ','')} (${sites.length})</div>
        </div>
      </div>
      ${sites.map((s, i) => {
        const isCustom = s._kind === 'custom';
        const kindLabel = isCustom ? _t('mysites.badgeCustom') : _t('mysites.badgePriority');
        const kindColor = isCustom ? '#a78bfa' : 'var(--accent)';
        return `
          <div class="fp-mysite-row" data-idx="${i}" style="padding:12px 14px;display:flex;align-items:center;gap:12px;cursor:pointer;border-bottom:1px solid rgba(71,85,115,.2);transition:background .2s">
            <div style="width:32px;height:32px;border-radius:50%;background:${kindColor};display:flex;align-items:center;justify-content:center;color:#000;font-weight:900;font-size:13px;flex-shrink:0">${i + 1}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:700;color:var(--white);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_esc(s.name)}</div>
              <div style="font-size:10px;color:var(--gray2);margin-top:2px">${_t('card.sector')} ${_esc(s.sector)} · ${_esc(s.opening) || _esc(s.status) || '—'}</div>
            </div>
            <div style="font-size:9px;font-weight:700;padding:3px 8px;border-radius:6px;background:${isCustom ? 'rgba(139,92,246,.15)' : 'rgba(212,160,23,.12)'};color:${kindColor};flex-shrink:0">${kindLabel}</div>
          </div>
        `;
      }).join('')}
    `;
    // Remove any previous renders
    cloneRoot.querySelectorAll('.fp-mysites-list, .fp-addsite-cta-wrap').forEach(el => el.remove());
    cloneRoot.insertBefore(list, cloneRoot.firstChild);

    // Sticky CTA at bottom of the tab body
    const ctaWrap = document.createElement('div');
    ctaWrap.className = 'fp-addsite-cta-wrap';
    ctaWrap.innerHTML = `
      <button class="fp-addsite-cta" type="button">
        <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
        <span>${_t('mysites.addNew')}</span>
      </button>
    `;
    cloneRoot.appendChild(ctaWrap);
    ctaWrap.querySelector('.fp-addsite-cta').addEventListener('click', () => {
      haptic(12);
      openAddSiteOverlay();
    });

    // Wire row clicks → activate site in map/carousel
    qsa('.fp-mysite-row', list).forEach(row => {
      row.addEventListener('click', () => {
        const i = parseInt(row.dataset.idx);
        haptic(12);
        closeSecondarySheet();
        setTimeout(() => {
          activateSite(i, true);
          transitionTo('summary');
        }, 250);
      });
      row.addEventListener('touchstart', () => { row.style.background = 'rgba(212,160,23,.08)'; }, { passive: true });
      row.addEventListener('touchend',   () => { row.style.background = ''; });
    });
  }

  // ─── ADD-SITE: full-screen native mobile overlay ───────────────
  // Replaces the cramped cloned-desktop form with a polished 3-step flow:
  //   1. Search (live Google Places autocomplete + Nominatim fallback)
  //   2. Preview (selected place + editable name + coordinates)
  //   3. Confirm (add + haptic + toast + auto-activate new site)
  let _addSiteSession = null;
  let _addSiteState   = { selected: null }; // { name, addr, lat, lng }

  function buildAddSiteOverlay() {
    if (qs('.fp-addsite-overlay')) return;
    const ov = document.createElement('div');
    ov.className = 'fp-addsite-overlay';
    ov.innerHTML = `
      <div class="fp-addsite-header">
        <div class="fp-addsite-back" id="fpAddSiteBack" role="button" aria-label="${_t('fab.back')}">
          <svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>
        </div>
        <div class="fp-addsite-title">
          <div class="t">${_t('addsite.title')}</div>
          <div class="s">${_t('addsite.subtitle')}</div>
        </div>
      </div>

      <div class="fp-addsite-input-wrap" id="fpAddSiteInputWrap">
        <svg class="search-icon" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        <input class="fp-addsite-input" id="fpAddSiteInput" type="text"
               placeholder="${_t('addsite.placeholder')}"
               autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
        <button class="fp-addsite-clear" id="fpAddSiteClear" type="button" aria-label="clear">✕</button>
      </div>

      <div class="fp-addsite-results" id="fpAddSiteResults">
        <div class="fp-addsite-hint">
          <span class="big">${_t('addsite.hint.bigIcon')}</span>
          ${_t('addsite.hint.text')}
        </div>
      </div>

      <div class="fp-addsite-footer">${_t('addsite.footer')}</div>
    `;
    document.body.appendChild(ov);

    qs('#fpAddSiteBack', ov).addEventListener('click', () => { haptic(8); closeAddSiteOverlay(); });
    qs('#fpAddSiteClear', ov).addEventListener('click', () => {
      const inp = qs('#fpAddSiteInput', ov);
      inp.value = ''; inp.focus();
      qs('#fpAddSiteInputWrap', ov).classList.remove('has-value');
      resetAddSiteResults();
    });

    const input = qs('#fpAddSiteInput', ov);
    let debounceT, reqSeq = 0;
    input.addEventListener('input', (e) => {
      const q = e.target.value.trim();
      qs('#fpAddSiteInputWrap', ov).classList.toggle('has-value', q.length > 0);
      clearTimeout(debounceT);
      if (q.length < 2) { resetAddSiteResults(); return; }
      const mySeq = ++reqSeq;
      debounceT = setTimeout(() => fetchAddSiteSuggestions(q, mySeq), 220);
    });
    input.addEventListener('focus', () => { if (!_addSiteSession) newAddSiteSession(); });
  }

  function newAddSiteSession() {
    _addSiteSession = 'fp-add-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    return _addSiteSession;
  }

  function resetAddSiteResults() {
    const results = qs('#fpAddSiteResults');
    if (!results) return;
    results.innerHTML = `
      <div class="fp-addsite-hint">
        <span class="big">${_t('addsite.hint.bigIcon')}</span>
        ${_t('addsite.hint.text')}
      </div>
    `;
    _addSiteState.selected = null;
  }

  async function fetchAddSiteSuggestions(query, seq) {
    const results = qs('#fpAddSiteResults');
    if (!results) return;
    results.innerHTML = `<div class="fp-addsite-loading">${_t('addsite.loading')}</div>`;

    if (typeof isOnline === 'function' && !isOnline()) {
      results.innerHTML = `<div class="fp-addsite-empty">${_t('common.offlineHint')}</div>`;
      return;
    }

    try {
      if (typeof GOOGLE_API_KEY === 'undefined' || !GOOGLE_API_KEY) throw new Error('no-key');
      const token = _addSiteSession || newAddSiteSession();
      const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOGLE_API_KEY },
        body: JSON.stringify({
          input: query, languageCode: window.getLocale?.() || 'fr', regionCode: 'RO',
          sessionToken: token,
          locationBias: { circle: { center: { latitude: 44.4268, longitude: 26.1025 }, radius: 40000 } }
        })
      });
      if (!res.ok) throw new Error('api:' + res.status);
      const data = await res.json();
      renderAddSiteSuggestions(data.suggestions || [], 'google');
    } catch (err) {
      // Nominatim fallback (works on localhost, no key required)
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query + ', Bucharest, Romania')}&limit=6`);
        const data = await r.json();
        renderAddSiteSuggestions(data.map(d => ({
          placePrediction: {
            text: { text: d.display_name },
            structuredFormat: {
              mainText: { text: (d.display_name || '').split(',')[0] },
              secondaryText: { text: (d.display_name || '').split(',').slice(1, 3).join(', ') }
            },
            _nominatim: { lat: parseFloat(d.lat), lng: parseFloat(d.lon) }
          }
        })), 'nominatim');
      } catch {
        results.innerHTML = `<div class="fp-addsite-empty">${_t('addsite.empty')}</div>`;
      }
    }
  }

  function renderAddSiteSuggestions(suggestions, source) {
    const results = qs('#fpAddSiteResults');
    if (!results) return;
    if (!suggestions || suggestions.length === 0) {
      results.innerHTML = `<div class="fp-addsite-empty">${_t('addsite.empty')}</div>`;
      return;
    }
    results.innerHTML = suggestions.slice(0, 6).map((s, i) => {
      const p = s.placePrediction || {};
      const main = p?.structuredFormat?.mainText?.text || p?.text?.text || '';
      const sec  = p?.structuredFormat?.secondaryText?.text || '';
      return `
        <div class="fp-addsite-results-item" data-idx="${i}" role="button">
          <div class="pin"><svg viewBox="0 0 24 24"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/></svg></div>
          <div class="text">
            <div class="main">${_esc(main)}</div>
            <div class="sec">${_esc(sec)}</div>
          </div>
          <svg class="arrow" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>
        </div>
      `;
    }).join('');
    qsa('.fp-addsite-results-item', results).forEach((item, i) => {
      item.addEventListener('click', () => selectAddSiteSuggestion(suggestions[i], source));
    });
  }

  async function selectAddSiteSuggestion(sug, source) {
    haptic(15);
    const p = sug.placePrediction || {};
    const name = p?.structuredFormat?.mainText?.text || p?.text?.text || 'Site custom';
    const addr = p?.text?.text || p?.structuredFormat?.secondaryText?.text || '';
    let lat, lng;

    const results = qs('#fpAddSiteResults');
    if (results) results.innerHTML = `<div class="fp-addsite-loading">${_t('addsite.loading')}</div>`;

    if (source === 'nominatim' && p._nominatim) {
      lat = p._nominatim.lat; lng = p._nominatim.lng;
    } else if (p.placeId) {
      const res = await window.safeAsync?.(async () => {
        const token = _addSiteSession;
        _addSiteSession = null;
        const r = await fetch('https://places.googleapis.com/v1/places/' + encodeURIComponent(p.placeId), {
          method: 'GET',
          headers: {
            'X-Goog-Api-Key': GOOGLE_API_KEY,
            'X-Goog-FieldMask': 'displayName,location,formattedAddress',
            ...(token ? { 'X-Goog-Session-Token': token } : {})
          }
        });
        if (!r.ok) throw new Error('places-detail:' + r.status);
        return r.json();
      }, 'addsite.fetchPlaceDetails');
      if (res?.ok) {
        lat = res.value.location?.latitude;
        lng = res.value.location?.longitude;
      }
    }

    if (!isFinite(lat) || !isFinite(lng)) {
      window.showToast?.(_t('addsite.error'), 'error');
      resetAddSiteResults();
      return;
    }

    _addSiteState.selected = { name, addr, lat, lng };
    renderAddSitePreview();
  }

  function renderAddSitePreview() {
    const results = qs('#fpAddSiteResults');
    const { name, addr, lat, lng } = _addSiteState.selected || {};
    if (!results || !name) return;
    results.innerHTML = `
      <div class="fp-addsite-preview">
        <div class="label">${_t('addsite.preview.label')}</div>
        <div class="pname">${_esc(name)}</div>
        <div class="paddr">${_esc(addr)}</div>
        <div class="coords">📌 ${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
        <label class="namefield" for="fpAddSiteName">${_t('addsite.preview.nameField')}</label>
        <input class="nameinput" id="fpAddSiteName" type="text" value="${_esc(name)}" maxlength="80">
        <button class="fp-addsite-confirm" id="fpAddSiteConfirm" type="button">
          <svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>
          <span>${_t('addsite.confirm')}</span>
        </button>
      </div>
    `;
    qs('#fpAddSiteConfirm').addEventListener('click', confirmAddSite);
  }

  function confirmAddSite() {
    const sel = _addSiteState.selected;
    if (!sel) return;
    haptic(22);
    const nameEl = qs('#fpAddSiteName');
    const finalName = (nameEl?.value || sel.name).trim().slice(0, 80);
    const btn = qs('#fpAddSiteConfirm');
    if (btn) btn.disabled = true;

    const site = (typeof addCustomSite === 'function') ? addCustomSite(sel.lat, sel.lng, finalName, '') : null;
    if (!site) {
      if (btn) btn.disabled = false;
      window.showToast?.(_t('addsite.error'), 'error');
      return;
    }

    // Refresh mobile views
    try { window._fpMobileRefreshSites?.(); } catch {}

    window.showToast?.(_t('addsite.added') + ' — ' + finalName, 'success', { duration: 3000 });
    closeAddSiteOverlay();

    // Auto-activate the newly added site after a short delay (let the carousel rebuild)
    setTimeout(() => {
      const all = getAllSites();
      const idx = all.findIndex(s => Math.abs(s.lat - sel.lat) < 0.0001 && Math.abs(s.lng - sel.lng) < 0.0001);
      if (idx >= 0) {
        closeSecondarySheet();
        activateSite(idx, true);
        transitionTo('summary');
      }
    }, 320);
  }

  function openAddSiteOverlay() {
    buildAddSiteOverlay();
    const ov = qs('.fp-addsite-overlay');
    if (!ov) return;
    _addSiteState.selected = null;
    resetAddSiteResults();
    const inp = qs('#fpAddSiteInput');
    if (inp) { inp.value = ''; }
    qs('#fpAddSiteInputWrap')?.classList.remove('has-value');
    // Open immediately (CSS transition handles the animation from opacity 0 → 1).
    ov.classList.add('open');
    setTimeout(() => inp?.focus(), 280);
  }

  function closeAddSiteOverlay() {
    const ov = qs('.fp-addsite-overlay');
    if (!ov) return;
    ov.classList.remove('open');
    const inp = qs('#fpAddSiteInput');
    if (inp) inp.blur();
  }

  function stripAllIds(root) {
    // Clear any id on children so we don't collide with the desktop sidebar.
    // Preserve original ID as data-orig-id so we can re-sync from source later.
    const all = root.querySelectorAll('[id]');
    all.forEach(el => {
      el.dataset.origId = el.id;
      el.removeAttribute('id');
    });
  }

  // Copy fresh innerHTML from desktop elements into the cloned equivalents.
  // Preserves <select> values and <input> values to avoid wiping user input.
  function syncClonedDynamicContent(cloneRoot) {
    const nodes = cloneRoot.querySelectorAll('[data-orig-id]');
    nodes.forEach(el => {
      const srcEl = document.getElementById(el.dataset.origId);
      if (!srcEl || srcEl === el) return;
      const tag = el.tagName?.toLowerCase();
      // <select>: copy options from source (dynamic content), preserve current value.
      if (tag === 'select') {
        const prevVal = el.value;
        el.innerHTML = srcEl.innerHTML;
        // Re-apply previous value if still a valid option; else fall back to source's value.
        const has = Array.from(el.options).some(o => o.value === prevVal);
        el.value = has ? prevVal : (srcEl.value || '');
        return;
      }
      // <input>/<textarea>: skip — user's typed text must not be wiped.
      if (tag === 'input' || tag === 'textarea') return;
      // <canvas>: innerHTML has no effect, and Chart.js draws into the 2D context.
      // Clones are re-bound to their own Chart instance via rebuildClonedCharts().
      if (tag === 'canvas') return;
      el.innerHTML = srcEl.innerHTML;
    });
  }

  // Deep-clone a Chart.js config while preserving functions (tooltip.callbacks, etc.).
  // structuredClone would strip functions; JSON.parse(JSON.stringify) would too.
  function cloneChartConfig(obj, seen = new WeakSet()) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (seen.has(obj)) return obj;
    seen.add(obj);
    if (Array.isArray(obj)) return obj.map(x => cloneChartConfig(x, seen));
    const out = {};
    for (const k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) {
        out[k] = cloneChartConfig(obj[k], seen);
      }
    }
    return out;
  }

  // Rebuild Chart.js instances on canvases inside a cloned tab-panel.
  // Desktop canvases own the live Chart instance; cloned canvases are empty until
  // we bind fresh Chart instances to them, using the desktop config as source of truth.
  let _clonedCharts = [];
  function rebuildClonedCharts(cloneRoot) {
    _clonedCharts.forEach(c => { try { c.destroy(); } catch {} });
    _clonedCharts = [];
    if (typeof Chart === 'undefined' || !cloneRoot) return;
    cloneRoot.querySelectorAll('canvas[data-orig-id]').forEach(canvas => {
      const origId = canvas.dataset.origId;
      const origCanvas = document.getElementById(origId);
      if (!origCanvas) return;
      const origChart = Chart.getChart(origCanvas);
      if (!origChart) return;
      try {
        const newChart = new Chart(canvas, {
          type: origChart.config.type,
          data: cloneChartConfig(origChart.config.data),
          options: cloneChartConfig(origChart.config.options || {})
        });
        _clonedCharts.push(newChart);
      } catch (e) {
        console.warn('[fp] rebuildClonedCharts failed for', origId, e);
      }
    });
  }

  // Public: allow desktop update functions to re-sync the mobile clone's charts
  // after updateSegChart/updateGapChart mutate the original datasets.
  function refreshClonedCharts() {
    const body = qs('#fpSecondaryBody');
    if (!body || !qs('.fp-secondary-sheet')?.classList.contains('open')) return;
    rebuildClonedCharts(body);
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
      // v6.51 — pin FP fidèle image (size 48 + animations apple-like)
      const active = i === activeIdx;
      const pinHtml = (typeof window.fpLogoPinHTML === 'function')
        ? `<div class="fp-target-pin${active ? ' active' : ''}">${window.fpLogoPinHTML({ size: 48, active, num: i + 1 })}</div>`
        : `<div class="fp-target-pin${active ? ' active' : ''}">${i + 1}</div>`;
      const iconDim = active ? 58 : 54; // wrapper + scale buffer
      const icon = L.divIcon({
        className: '',
        html: pinHtml,
        iconSize: [iconDim, iconDim], iconAnchor: [iconDim / 2, iconDim / 2]
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
    // Restore per-site overrides BEFORE ensureAnalysis so runCaptageAnalysis
    // uses the correct scoped values for this site (bugfix: sliders bleed
    // across sites on swipe/prev-next if we don't reset here).
    const sites = getAllSites();
    const t = sites[newIdx];
    if (t) restoreSiteOverrides(siteKeyFor(t));
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
    buildDemoFab();
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

  // ─── DESKTOP: numbered pins retirés ─────────────────────────────
  // Les pins numérotés (1-5 targets dorés, 6+ customs violets) sont un pattern
  // mobile (le carousel bottom-sheet mappe numéro → site). Sur desktop sans
  // carousel, les numéros n'ont aucun contexte et se superposent aux markers
  // étoilés natifs des custom sites (`addCustomSiteMarker`). Désactivé.
  // Desktop : TARGETS dans la sidebar (flyTarget au click) + customs via étoiles Leaflet.

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

  // v6.52 — listener cloud: si overrides mis à jour depuis un autre device,
  // invalider TOUT le cache analyses et re-ensure TOUS les sites (pas juste
  // activeIdx). Sinon les sites non-actifs gardent leurs valeurs stales
  // jusqu'à ce que l'user swipe dessus.
  window.addEventListener('fp:overrides-updated', () => {
    try {
      const sites = getAllSites();
      for (let i = 0; i < (analyses?.length || 0); i++) analyses[i] = null;
      if (typeof ensureAnalysis === 'function') {
        for (let i = 0; i < sites.length; i++) {
          setTimeout(() => ensureAnalysis(i), i * 30); // micro-stagger pour éviter freeze UI
        }
      }
      if (state === 'detail' && typeof buildDetail === 'function') buildDetail();
      if (typeof renderCarousel === 'function') renderCarousel();
    } catch (e) { console.warn('[FP mobile] fp:overrides-updated handler failed:', e); }
  });

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
  window._fpMobile = { transitionTo, activateSite, ensureAnalysis, isMobile, openAddSiteOverlay, closeAddSiteOverlay, refreshClonedCharts };

  // ─── Offline/online UX hint ───────────────────────────────────
  if (typeof onOnlineChange === 'function') {
    onOnlineChange((online) => {
      const msg = online ? _t('common.onlineBack') : _t('common.offlineBanner');
      const lvl = online ? 'success' : 'warn';
      try { window.showToast?.(msg, lvl, { duration: online ? 2500 : 6000 }); } catch {}
    });
    // Show banner at boot if already offline
    if (typeof isOnline === 'function' && !isOnline()) {
      try { window.showToast?.(_t('common.offlineBanner'), 'warn', { duration: 6000 }); } catch {}
    }
  }

  // ─── Re-render on locale change ───────────────────────────────
  // i18n strings are baked into rendered HTML, so we regenerate the
  // carousel + active detail view on toggle. Layers/FAB rebuild on next open.
  window.addEventListener('fp:locale-changed', () => {
    try {
      // Update topbar locale pill label + search placeholder
      const pill = qs('#fpLocalePill');
      if (pill) pill.textContent = _t('topbar.locale.label');
      const pillEl = qs('#fpLocalePill');
      if (pillEl) pillEl.setAttribute('title', _t('topbar.locale.title'));
      const searchSpan = qs('#fpSearchPill span');
      if (searchSpan) searchSpan.textContent = _t('topbar.search.placeholder');
      const searchInput = qs('#fpSearchInput');
      if (searchInput) searchInput.setAttribute('placeholder', _t('topbar.search.input'));

      // Rebuild carousel cards
      const sites = getAllSites();
      const car = qs('#fpCarousel');
      if (car) {
        car.innerHTML = sites.map((s, i) => renderCard(s, i, analyses[i])).join('');
        qsa('.fp-site-card', car).forEach((card, i) => {
          card.addEventListener('click', () => {
            if (i === activeIdx && state === 'peek') transitionTo('summary');
            else activateSite(i, true);
          });
        });
      }

      // Rebuild detail if open
      if (state === 'detail') buildDetail();

      // Close FAB sheet so it rebuilds with new locale on next open
      if (typeof closeSecondarySheet === 'function') {
        const bd = qs('.fp-secondary-backdrop');
        if (bd) closeSecondarySheet();
      }
    } catch (e) { console.warn('[FP i18n] re-render failed:', e); }
  });
})();
