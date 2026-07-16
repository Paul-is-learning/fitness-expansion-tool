// ─────────────────────────────────────────────────────────────────────
// src/showreel.js — v6.99 « Démo guidée » (showreel investisseur)
//
// Demande Paul : le mode présentation doit lancer un DIDACTICIEL qui
// illustre les fonctionnalités en prenant exemple sur ses sites
// sauvegardés — « effet wow, le mec maîtrise de ouf son sujet ».
//
// PRINCIPE : l'outil se pilote TOUT SEUL, scène par scène — il analyse
// un vrai site, ouvre le comparateur de cash, le portefeuille, le plan
// de conquête — pendant qu'une légende storytelling raconte l'histoire.
// Le présentateur ne touche qu'aux flèches : → avance, ← revient,
// Espace = lecture auto, Échap = sortie. Zéro donnée inventée : tout
// vient de _siteAnalyses / du moteur réel.
//
// Autonome (aucun module modifié) : window.Showreel = { start, stop }.
// ─────────────────────────────────────────────────────────────────────
(function () {
  'use strict';
  try { if (window !== window.top) return; } catch { return; } // pas dans les iframes de test

  const $ = id => document.getElementById(id);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const fmtN = n => (n == null ? '—' : Math.round(n).toLocaleString('fr-FR').replace(/ |,/g, ' '));

  let scenes = [], idx = 0, running = false, autoplay = false, autoTimer = null, busy = false;

  // ── Helpers pilotage (tous défensifs) ───────────────────────────────
  const P = () => ({
    Portfolio: window.Portfolio, Conquest: window.ConquestPlan,
    Studio: window.FcfStudio, Intel: window.CompetitorIntel,
  });
  function closeAllPanels() {
    const p = P();
    try { p.Portfolio?.close?.(); } catch {}
    try { p.Conquest?.close?.(); } catch {}
    try { p.Studio?.close?.(); } catch {}
    try { p.Intel?.close?.(); } catch {}
    ['fpPortfolio','fpConquest','fpFcfStudio','ciPanel'].forEach(id => { try { $(id)?.remove(); } catch {} });
  }
  function targetIndexFor(site) {
    if (typeof TARGETS === 'undefined') return -1;
    return TARGETS.findIndex(t => Math.abs(t.lat - site.lat) < 0.01 && Math.abs(t.lng - site.lng) < 0.01);
  }
  // Analyse un site (par index TARGET si possible, sinon clic carte) et
  // ATTEND que la fiche soit prête (verdict rendu) — max ~16 s.
  async function analyzeAndWait(site) {
    const ti = targetIndexFor(site);
    try {
      if (ti >= 0) window.analyzeTargetByIdx(ti);
      else if (typeof window.onMapClick === 'function') window.onMapClick({ latlng: { lat: site.lat, lng: site.lng } });
    } catch {}
    for (let i = 0; i < 32; i++) {
      const t = $('captageContentSite')?.innerText || '';
      if (/EN CLAIR|GO|WATCH|NO GO/.test(t)) break;
      await wait(500);
    }
    try { window.switchTab?.('site'); } catch {}
  }
  const savedSites = () => (window._siteAnalyses || []).slice().sort((a, b) => (b.execScore || 0) - (a.execScore || 0));

  // ── Construction des scènes (dynamique, sur les vrais sites) ────────
  function buildScenes() {
    const sites = savedSites();
    const hero = sites[0] || (typeof TARGETS !== 'undefined' ? { name: TARGETS[0]?.name, lat: TARGETS[0]?.lat, lng: TARGETS[0]?.lng } : null);
    const s = [];

    s.push({
      kicker: 'EXPANSION INTELLIGENCE', title: 'De l’adresse au business plan, en direct.',
      body: 'Un outil qui transforme un point sur la carte en décision d’investissement chiffrée. Laisse-moi te montrer — je ne touche qu’aux flèches.',
      run: async () => { closeAllPanels(); try { window.setAnalyzingLayout?.(false); } catch {} try { window._fpMap?.flyTo([44.43, 26.10], 11, { duration: 1.2 }); } catch {} },
    });

    if (hero) s.push({
      kicker: '01 · L’ANALYSE', title: `Je pose un site : ${hero.name}.`,
      body: 'L’outil croise en temps réel la population captable, les transports, les universités, les bureaux — et toute la concurrence géolocalisée.',
      run: async () => { closeAllPanels(); await analyzeAndWait(hero); },
      hold: 12000,
    });

    if (hero) s.push({
      kicker: '02 · LE VERDICT', title: () => {
        const h = savedSites()[0] || hero;
        return `${h.verdict || 'Décision'} · Score ${h.execScore ?? '—'}/100.`;
      },
      body: () => {
        const h = savedSites()[0] || hero;
        return `${fmtN(h.totalTheo)} adhérents potentiels · IRR projet ${h.irrBase ?? '—'}% · IRR equity ${h.irrEquity ?? '—'}%. La décision d’abord, la démonstration ensuite.`;
      },
      run: async () => { try { window.switchTab?.('site'); } catch {} const c = $('captageContentSite'); try { c?.scrollTo({ top: 0, behavior: 'smooth' }); } catch {} },
    });

    s.push({
      kicker: '03 · LE TERRAIN', title: 'Chaque concurrent, géolocalisé — avec son logo.',
      body: 'World Class, Stay Fit, 18GYM, Downtown… je sais exactement qui m’entoure, à quelle distance, et quelle est leur menace.',
      run: async () => {
        try { window.switchTab?.('compete'); } catch {}
        try { window.toggleAllBrands?.(true); } catch {}
        try { window._fpMap?.flyTo([44.43, 26.10], 12, { duration: 1.2 }); } catch {}
      },
    });

    if (hero) s.push({
      kicker: '04 · LE CASH', title: 'Dette ou fonds propres ? Je compare sur le même site.',
      body: 'Point mort en adhérents, IRR equity, payback — deux scénarios côte à côte, la Référence BP verrouillée comme garde-fou. Y compris le droit d’entrée master-franchise en un clic.',
      run: async () => { closeAllPanels(); try { window.FcfStudio?.open?.(); } catch {} },
      hold: 13000,
    });

    if (savedSites().length >= 1) s.push({
      kicker: '05 · LA VUE D’ENSEMBLE', title: 'Tous mes sites, côte à côte.',
      body: 'FCFE cumulé, IRR equity, fonds propres à déployer, score moyen — le portefeuille d’expansion en une vue, exportable en un clic.',
      run: async () => { closeAllPanels(); try { window.Portfolio?.open?.(); } catch {} },
      hold: 12000,
    });

    s.push({
      kicker: '06 · LA STRATÉGIE', title: 'Combien de clubs, dans quel ordre, avec quel financement.',
      body: 'Le plan de conquête séquence les ouvertures sous contrainte de cash : fonds propres d’abord, banque dès que je suis bancable. 3 stratégies comparées.',
      run: async () => { closeAllPanels(); try { window.ConquestPlan?.open?.(); } catch {} },
      hold: 13000,
    });

    s.push({
      kicker: 'EXPANSION INTELLIGENCE', title: 'De la donnée brute à la décision d’investissement.',
      body: 'Géomarketing, modélisation financière, plan de conquête — un seul outil, du site au business plan. Des questions ?',
      run: async () => { closeAllPanels(); try { window.setAnalyzingLayout?.(false); } catch {} try { window._fpMap?.flyTo([44.43, 26.10], 11, { duration: 1.4 }); } catch {} },
    });

    return s;
  }

  // ── Overlay cinématique ─────────────────────────────────────────────
  function injectCss() {
    if ($('fpShowreelCss')) return;
    const st = document.createElement('style');
    st.id = 'fpShowreelCss';
    st.textContent = `
    #fpShowreel{position:fixed;inset:0;z-index:100060;pointer-events:none;font-family:var(--font,sans-serif);opacity:0;transition:opacity .5s ease}
    #fpShowreel.on{opacity:1}
    .fpsr-bar{position:absolute;left:0;right:0;height:56px;background:linear-gradient(rgba(4,6,12,.92),rgba(4,6,12,0));pointer-events:none}
    .fpsr-bar.bottom{bottom:0;top:auto;background:linear-gradient(rgba(4,6,12,0),rgba(4,6,12,.92));height:230px}
    #fpsrCard{position:absolute;left:36px;bottom:46px;max-width:620px;pointer-events:auto;
      background:linear-gradient(135deg,rgba(14,20,34,.9),rgba(10,14,26,.86));backdrop-filter:blur(14px);
      border:1px solid rgba(212,160,23,.35);border-left:3px solid var(--accent,#d4a017);border-radius:16px;
      padding:20px 24px;box-shadow:0 24px 70px rgba(0,0,0,.6);transform:translateY(14px);opacity:0;transition:all .55s cubic-bezier(.16,1,.3,1)}
    #fpsrCard.show{transform:none;opacity:1}
    #fpsrKicker{font-size:11px;font-weight:800;letter-spacing:2px;color:var(--accent,#d4a017);text-transform:uppercase;margin-bottom:8px}
    #fpsrTitle{font-family:var(--font-display,var(--font));font-size:26px;font-weight:900;line-height:1.15;color:#fff;letter-spacing:-.5px;margin-bottom:9px}
    #fpsrBody{font-size:14.5px;line-height:1.55;color:#cbd5e1;font-weight:400}
    #fpsrDots{position:absolute;top:18px;left:50%;transform:translateX(-50%);display:flex;gap:7px;pointer-events:auto}
    .fpsr-dot{width:8px;height:8px;border-radius:50%;background:rgba(148,163,184,.35);transition:all .35s ease;cursor:pointer}
    .fpsr-dot.on{background:var(--accent,#d4a017);width:26px;border-radius:6px;box-shadow:0 0 12px rgba(212,160,23,.6)}
    #fpsrCtrl{position:absolute;right:28px;bottom:52px;display:flex;align-items:center;gap:10px;pointer-events:auto}
    .fpsr-btn{width:44px;height:44px;border-radius:50%;border:1px solid rgba(212,160,23,.4);background:rgba(14,20,34,.85);
      color:#fff;font-size:17px;cursor:pointer;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px);transition:all .2s}
    .fpsr-btn:hover{background:var(--accent,#d4a017);color:#0a0d16;transform:translateY(-2px)}
    #fpsrHint{position:absolute;right:28px;bottom:22px;font-size:10px;color:#64748b;pointer-events:none;letter-spacing:.3px}
    #fpsrBadge{position:absolute;top:16px;right:24px;font-size:10px;font-weight:800;letter-spacing:1px;color:#64748b;pointer-events:none}
    #fpsrProg{position:absolute;top:0;left:0;height:2px;background:linear-gradient(90deg,#d4a017,#f4d67e);width:0;transition:width .4s ease;box-shadow:0 0 10px rgba(212,160,23,.7)}
    @media (prefers-reduced-motion:reduce){#fpShowreel,#fpsrCard{transition:none}}
    `;
    document.head.appendChild(st);
  }

  function buildOverlay() {
    injectCss();
    if ($('fpShowreel')) return;
    const o = document.createElement('div');
    o.id = 'fpShowreel';
    o.innerHTML = `
      <div class="fpsr-bar top"></div>
      <div class="fpsr-bar bottom"></div>
      <div id="fpsrProg"></div>
      <div id="fpsrBadge">🎬 DÉMO GUIDÉE</div>
      <div id="fpsrDots"></div>
      <div id="fpsrCard">
        <div id="fpsrKicker"></div>
        <div id="fpsrTitle"></div>
        <div id="fpsrBody"></div>
      </div>
      <div id="fpsrCtrl">
        <button class="fpsr-btn" id="fpsrPrev" title="Précédent (←)">‹</button>
        <button class="fpsr-btn" id="fpsrPlay" title="Lecture auto (Espace)">▶</button>
        <button class="fpsr-btn" id="fpsrNext" title="Suivant (→)">›</button>
        <button class="fpsr-btn" id="fpsrExit" title="Quitter (Échap)" style="border-color:rgba(239,68,68,.5)">✕</button>
      </div>
      <div id="fpsrHint">← → naviguer · Espace lecture auto · Échap quitter</div>`;
    document.body.appendChild(o);
    $('fpsrPrev').onclick = () => go(idx - 1);
    $('fpsrNext').onclick = () => go(idx + 1);
    $('fpsrExit').onclick = () => stop();
    $('fpsrPlay').onclick = () => toggleAuto();
    requestAnimationFrame(() => o.classList.add('on'));
  }

  function renderDots() {
    const d = $('fpsrDots'); if (!d) return;
    d.innerHTML = scenes.map((_, i) => `<div class="fpsr-dot${i === idx ? ' on' : ''}" data-i="${i}"></div>`).join('');
    d.querySelectorAll('.fpsr-dot').forEach(el => el.onclick = () => go(+el.dataset.i));
  }

  const val = (v) => (typeof v === 'function' ? v() : v);

  async function go(i) {
    if (!running || busy) return;
    if (i < 0 || i >= scenes.length) return;
    busy = true;
    clearTimeout(autoTimer);
    idx = i;
    const sc = scenes[i];
    const card = $('fpsrCard');
    card?.classList.remove('show');
    $('fpsrProg').style.width = ((i) / (scenes.length - 1) * 100) + '%';
    renderDots();
    await wait(180);
    try { await sc.run?.(); } catch (e) { console.warn('[showreel] scene', i, e); }
    // légende (peut dépendre de données fraîchement calculées → lue après run)
    if ($('fpsrKicker')) $('fpsrKicker').textContent = val(sc.kicker) || '';
    if ($('fpsrTitle')) $('fpsrTitle').textContent = val(sc.title) || '';
    if ($('fpsrBody')) $('fpsrBody').innerHTML = val(sc.body) || '';
    // garde l'overlay au-dessus des panneaux qui viennent de s'ouvrir
    const o = $('fpShowreel'); if (o) document.body.appendChild(o);
    card?.classList.add('show');
    busy = false;
    if (autoplay) autoTimer = setTimeout(() => go(idx + 1), sc.hold || 8500);
  }

  function toggleAuto() {
    autoplay = !autoplay;
    const b = $('fpsrPlay');
    if (b) { b.textContent = autoplay ? '⏸' : '▶'; b.classList.toggle('on', autoplay); }
    clearTimeout(autoTimer);
    if (autoplay && running) autoTimer = setTimeout(() => go(idx + 1), (scenes[idx]?.hold || 8500));
  }

  function onKey(e) {
    if (!running) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); go(idx + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(idx - 1); }
    else if (e.key === ' ') { e.preventDefault(); toggleAuto(); }
    else if (e.key === 'Escape') { e.preventDefault(); stop(); }
  }

  // ── API ─────────────────────────────────────────────────────────────
  function start() {
    if (running) return;
    scenes = buildScenes();
    if (!scenes.length) return;
    running = true; idx = 0; autoplay = false;
    // active le mode présentation (typo agrandie, contrôles techniques masqués)
    try { window.PresentationMode?.toggle?.(true); } catch {}
    buildOverlay();
    document.addEventListener('keydown', onKey, true);
    go(0);
  }
  function stop() {
    running = false; autoplay = false;
    clearTimeout(autoTimer);
    document.removeEventListener('keydown', onKey, true);
    closeAllPanels();
    try { window.PresentationMode?.toggle?.(false); } catch {}
    const o = $('fpShowreel');
    if (o) { o.classList.remove('on'); setTimeout(() => o.remove(), 500); }
  }

  window.Showreel = { start, stop };

  // ── Bouton 🎬 dans le header, à côté du 🎥 (desktop) ────────────────
  function installButton(tries) {
    if (window.innerWidth <= 768) return;
    if ($('fpShowreelBtn')) return;
    const anchor = $('fpPresentBtn') || $('fpDesktopLocale');
    if (!anchor) { if ((tries || 0) < 25) setTimeout(() => installButton((tries || 0) + 1), 400); return; }
    const btn = document.createElement('button');
    btn.id = 'fpShowreelBtn';
    btn.title = 'Démo guidée — l’outil se pilote tout seul sur tes sites sauvegardés (flèches pour avancer, Échap pour sortir)';
    btn.textContent = '🎬';
    btn.style.cssText = 'margin-left:6px;width:30px;height:30px;border-radius:8px;border:1px solid var(--border);background:var(--card3);color:var(--white);cursor:pointer;font-size:13px;vertical-align:middle';
    btn.onclick = () => start();
    anchor.insertAdjacentElement('afterend', btn);
  }
  if (document.readyState === 'complete') installButton(0);
  else window.addEventListener('load', () => installButton(0));
})();
