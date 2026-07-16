// ─────────────────────────────────────────────────────────────────────
// src/showreel.js — v7.00 « Démo guidée » (showreel investisseur)
//
// Le mode présentation lance un DIDACTICIEL qui pilote l'outil tout seul,
// scène par scène, sur les vrais sites sauvegardés — « effet wow, il
// maîtrise son sujet ». v7.00 :
//   • légende affichée IMMÉDIATEMENT (l'action tourne en arrière-plan,
//     plafonnée en temps → plus jamais de blocage sur un calcul lent) ;
//   • SPOTLIGHT cinématique : la scène assombrit tout SAUF l'élément clé
//     (verdict, tuiles KPI, comparatif…) avec un halo doré animé, pour
//     guider l'attention de l'audience ;
//   • pilotage clavier → ← Espace Échap, barre de progression, points.
//
// Autonome (window.Showreel = { start, stop }). Zéro donnée inventée.
//
// v7.07 — FIX calibrage : les scènes fiche (03/04/05) forçaient l'onglet
// une seule fois puis surlignaient « à l'aveugle ». En prod (analyse plus
// lente), app-core rebasculait sur MES SITES APRÈS coup → la scène 04
// surlignait la ligne QUARTIER (CARTIER) au lieu du verdict. Corrigé par :
//   • analyzeAndWait() attend la fin RÉELLE de l'analyse + marge avant fiche ;
//   • showFiche(re) ré-affirme l'onglet fiche et attend le bloc VISIBLE ;
//   • trackSpot() efface le halo si sa cible devient masquée (plus de halo
//     fantôme en position:fixed par-dessus un bloc sans rapport) ;
//   • focus() cible STRICTEMENT la fiche visible, repli interne (jamais un
//     élément d'un autre onglet).
// ─────────────────────────────────────────────────────────────────────
(function () {
  'use strict';
  try { if (window !== window.top) return; } catch { return; }

  const $ = id => document.getElementById(id);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const fmtN = n => (n == null ? '—' : Math.round(n).toLocaleString('fr-FR').replace(/[\s,]/g, ' '));
  const val = v => (typeof v === 'function' ? v() : v);
  const capRun = (fn, ms) => Promise.race([Promise.resolve().then(fn).catch(() => {}), wait(ms)]);

  let scenes = [], idx = 0, running = false, autoplay = false, autoTimer = null, busy = false, spotRAF = null, spotSettle = null, sceneTicker = null;

  // ── Pilotage (défensif) ─────────────────────────────────────────────
  function closeAllPanels() {
    try { window.Portfolio?.close?.(); } catch {}
    try { window.ConquestPlan?.close?.(); } catch {}
    try { window.FcfStudio?.close?.(); } catch {}
    try { window.CompetitorIntel?.close?.(); } catch {}
    ['fpPortfolio','fpConquest','fpFcfStudio','ciPanel'].forEach(id => { try { $(id)?.remove(); } catch {} });
  }
  function targetIndexFor(site) {
    if (typeof TARGETS === 'undefined') return -1;
    return TARGETS.findIndex(t => Math.abs(t.lat - site.lat) < 0.01 && Math.abs(t.lng - site.lng) < 0.01);
  }
  async function analyzeAndWait(site) {
    const ti = targetIndexFor(site);
    try {
      if (ti >= 0) window.analyzeTargetByIdx(ti);
      else if (typeof window.onMapClick === 'function') window.onMapClick({ latlng: { lat: site.lat, lng: site.lng } });
    } catch {}
    for (let i = 0; i < 44; i++) {           // ~22 s max (le fetch a son propre timeout)
      const t = $('captageContentSite')?.innerText || '';
      if (/EN CLAIR|GO CONDITIONNEL|WATCH|NO GO/.test(t)) break;
      await wait(500);
    }
    // v7.10 — plus de grosse marge : l'ENFORCEUR de scène re-force l'onglet
    // fiche en continu, même si un callback tardif de l'analyse rebascule sur
    // MES SITES 10-20 s plus tard (réseau lent en prod). Petit settle suffit.
    await wait(400);
    try { window.switchTab?.('site'); } catch {}
    await wait(200);
  }
  // v7.07 — force l'onglet Fiche et attend que le bloc `re` y soit VISIBLE.
  // Ré-affirme switchTab('site') si un callback tardif de l'analyse a rebasculé
  // sur MES SITES. Renvoie l'élément trouvé (ou null au timeout).
  async function showFiche(re, ms) {
    ms = ms || 6000;
    try { window.switchTab?.('site'); } catch {}
    // v7.07 — attend non seulement le bloc VISIBLE, mais aussi que la LARGEUR de
    // la fiche soit STABLE (le layout analyse↔présentation oscille en début de
    // scène) : on ne surligne qu'une fois le layout figé, sinon un sous-bloc se
    // recadre de travers pendant la transition.
    let lastW = -1, stable = 0, found = null;
    for (let waited = 0; waited < ms; waited += 250) {
      const c = $('captageContentSite');
      if (c && c.offsetHeight > 0) {
        const t = findByText(c, re);
        const w = Math.round(c.getBoundingClientRect().width);
        if (t) {
          found = t;
          if (w === lastW) { if (++stable >= 2) return found; }
          else { stable = 0; lastW = w; }
        }
      } else {
        try { window.switchTab?.('site'); } catch {}   // un callback a rebasculé → on ré-affirme
      }
      await wait(250);
    }
    const c = $('captageContentSite');
    return (c && c.offsetHeight > 0) ? (findByText(c, re) || found) : found;
  }
  const savedSites = () => (window._siteAnalyses || []).slice().sort((a, b) => (b.execScore || 0) - (a.execScore || 0));

  // Remonte jusqu'à un ancêtre d'une taille « bloc » — pour ne pas surligner
  // un minuscule label (« 🟢 Saine ») mais la carte entière qui le contient.
  function blockOf(el, minW, minH) {
    minW = minW || 200; minH = minH || 48;
    let e = el;
    for (let i = 0; i < 6 && e && e.getBoundingClientRect; i++) {
      const r = e.getBoundingClientRect();
      if (r.width >= minW && r.height >= minH) return e;
      e = e.parentElement;
    }
    return el;
  }

  // v7.07 — plus petit ancêtre VISIBLE qui contient TOUS les textes donnés.
  // Déterministe (contrairement à blockOf dont le seuil de taille dérivait
  // avec la largeur variable de la fiche) : cible pile la grille des 4 tuiles.
  function boxWithAll(root, res) {
    if (!root) return null;
    const first = findByText(root, res[0]);
    let p = first;
    for (let i = 0; i < 7 && p; i++) {
      const t = p.innerText || '';
      if (p.offsetHeight > 0 && res.every(re => re.test(t))) return p;
      p = p.parentElement;
    }
    return null;
  }

  // Trouve l'élément le plus pertinent contenant un texte (pour le spotlight)
  function findByText(root, re, maxLen = 400) {
    if (!root) return null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
    let best = null;
    while (walker.nextNode()) {
      const el = walker.currentNode;
      const t = (el.innerText || '').trim();
      if (t && t.length < maxLen && re.test(t) && el.offsetHeight > 0) {
        if (!best || (el.innerText.length < best.innerText.length)) best = el;
      }
    }
    return best;
  }

  // ── Site HÉROS unique + données cohérentes ──────────────────────────
  // v7.06 : le tour choisit UN site au départ, l'analyse UNE fois, et TOUTES
  // les scènes « site » lisent SES chiffres (via son entrée _siteAnalyses,
  // matchée par coordonnées) — plus jamais les chiffres d'un autre site.
  const T = { hero: null };
  function pickHero() {
    const saved = savedSites();
    // 1er choix : un site sauvegardé qui correspond à un TARGET (analysable
    // proprement) ; sinon le meilleur sauvegardé ; sinon le flagship TARGETS[0].
    const isTarget = s => typeof TARGETS !== 'undefined' && TARGETS.some(t => Math.abs(t.lat - s.lat) < 0.01 && Math.abs(t.lng - s.lng) < 0.01);
    const h = saved.find(isTarget) || saved[0] || (typeof TARGETS !== 'undefined' && TARGETS[0]) || null;
    return h ? { name: h.name, lat: h.lat, lng: h.lng } : null;
  }
  // Chiffres du héros lus dans _siteAnalyses (rempli à l'analyse) — cohérents
  // avec ce qui est à l'écran, car c'est LE site qu'on vient d'analyser.
  function heroData() {
    const h = T.hero; if (!h) return {};
    const e = (window._siteAnalyses || []).find(s => Math.abs(s.lat - h.lat) < 0.006 && Math.abs(s.lng - h.lng) < 0.006);
    return e || {};
  }
  const vlabel = v => (typeof v === 'object' && v ? (v.label || v.text || 'Décision') : (v || 'Décision'));
  // Le bloc point mort a un ID dupliqué (2 onglets) : renvoie le VISIBLE.
  function visibleBreakeven() {
    return [...document.querySelectorAll('[id="pnl-breakeven-block"]')].find(b => b.getBoundingClientRect().height > 20) || null;
  }

  // ── Scènes : narration logique, spotlight = ce que dit la légende ──
  function buildScenes() {
    T.hero = pickHero();
    const hero = T.hero;
    const s = [];

    // 00 — Intro : vue marché
    s.push({
      kicker: 'EXPANSION INTELLIGENCE', title: 'Le cockpit d’expansion de Fitness Park Romania.',
      body: 'Géomarketing, modélisation financière et stratégie multi-sites dans un seul outil. En 2 minutes, du marché brut à la décision d’investissement. Je ne touche qu’aux flèches.',
      run: async () => { closeAllPanels(); try { window.setAnalyzingLayout?.(false); } catch {} try { window._fpMap?.setView?.([44.43, 26.10], 11); } catch {} },
    });

    // 01 — Le marché : Intel concurrence (bilans officiels + santé)
    s.push({
      kicker: '01 · LE MARCHÉ', title: 'Je connais mes concurrents mieux qu’eux-mêmes.',
      body: 'Bilans officiels ANAF, chiffre d’affaires, santé financière de chaque enseigne — 100 % public et légal. World Class, Stay Fit, 18GYM : je vois qui est solide et qui est fragile.',
      run: async () => { closeAllPanels(); try { window.CompetitorIntel?.open?.(); } catch {} await wait(500); try { window.CompetitorIntel?.tab?.('marche'); } catch {} await wait(300); },
      focus: () => { const p = $('ciPanel'); if (!p) return null; const t = findByText(p, /World Class/) || findByText(p, /Saine|À risque|Sous pression|Fragile/); return t ? blockOf(t, 230, 70) : p.querySelector('div'); },
    });

    // 02 — La concurrence géolocalisée : carte + filtre par enseigne
    s.push({
      kicker: '02 · LE TERRAIN', title: 'Chaque salle concurrente, géolocalisée et filtrable.',
      body: 'Toute la concurrence de Bucarest sur la carte, avec les logos des enseignes. Je filtre par marque, je vois les zones saturées et les trous à conquérir.',
      tab: 'explore',
      run: async () => {
        closeAllPanels();
        try { window.switchTab?.('explore'); } catch {}
        try { window._fpMap?.invalidateSize?.(false); } catch {}
        try { window.toggleAllBrands?.(true); } catch {}
        try { window._fpMap?.setView?.([44.43, 26.10], 12); } catch {}
        await wait(400);
      },
      focus: () => document.getElementById('brandFilterExplorer') || document.getElementById('brandFilters'),
    });

    // 03 — Je choisis un site : analyse temps réel → fiche d'analyse complète
    if (hero) s.push({
      kicker: '03 · L’ANALYSE', title: `Je pose un site : ${hero.name}.`,
      hold: 15000,   // autoplay : laisse le calcul finir avant d'avancer
      tab: 'site',   // l'enforceur re-force la fiche si l'analyse rebascule sur MES SITES
      body: 'Population captable, transports, universités, pôles bureaux, concurrence — l’outil croise tout en temps réel et sort une fiche d’analyse notée en quelques secondes.',
      run: async () => { closeAllPanels(); await analyzeAndWait(hero); await showFiche(/EXECUTIVE SUMMARY/); },
      // v7.12 — ANCRE STRUCTURELLE : la carte exec = parent de
      // #exec-summary-header (id stable posé par renderCaptageAnalysis).
      // La recherche par texte débordait pendant les re-rendus progressifs
      // (« EN CLAIR » pas encore monté → ancêtre trop large → halo géant).
      // Pendant le calcul (carte exec absente) : repli sur le bloc SAZ de la
      // fiche pour que l'audience ait déjà quelque chose sous les yeux.
      focus: () => {
        // NB: les ids exec-* existent AUSSI dans l'onglet Mes Sites (même
        // template) → on scope DANS la fiche (même piège que pnl-breakeven-block).
        const c = $('captageContentSite');
        const h = c && c.querySelector('#exec-summary-header');
        if (h && h.offsetHeight > 0) return h.parentElement;
        const sc = $('siteCardContent');
        const saz = sc && sc.offsetHeight > 0 && findByText(sc, /Score Attractivite|Score Attractivité/i);
        return saz ? blockOf(saz, 340, 120) : null;
      },
    });

    // 04 — Le verdict : chiffres du MÊME site
    if (hero) s.push({
      kicker: '04 · LE VERDICT', tab: 'site',
      title: () => { const d = heroData(); return `${vlabel(d.verdict)} · ${fmtN(d.totalTheo)} adhérents potentiels.`; },
      // NB : pas de « score /100 » ici — le gros chiffre à l'écran est le SAZ
      // (attractivité), distinct du verdict. On cite le verdict + les chiffres
      // financiers (identiques aux tuiles surlignées) pour rester cohérent.
      body: () => { const d = heroData(); return `La décision d’abord : IRR equity ${d.irrEquity != null ? Math.round(d.irrEquity) + ' %' : '—'}, FCFE 5 ans ${d.fcfe5y != null ? fmtN(Math.round(d.fcfe5y / 1000)) + ' k€' : '—'}, apport revenu en ${d.paybackEquity ? 'M' + d.paybackEquity : '—'}. Puis la démonstration chiffrée derrière.`; },
      run: async () => { await showFiche(/MEMBRES À MATURITÉ|IRR EQUITY|RETOUR DE L/); },
      // v7.12 — ancre structurelle : la rangée des 4 tuiles = frère suivant de
      // #exec-scores-bars (id stable du template renderCaptageAnalysis). Plus
      // de recherche par texte, qui débordait pendant les re-rendus. Repli :
      // la carte exec entière.
      focus: () => {
        const c = $('captageContentSite');
        const b = c && c.querySelector('#exec-scores-bars');
        const tiles = b && b.nextElementSibling;
        if (tiles && tiles.offsetHeight > 0) return tiles;
        const h = c && c.querySelector('#exec-summary-header');
        return (h && h.offsetHeight > 0) ? h.parentElement : null;
      },
    });

    // 05 — Forces / faiblesses en langage décideur (bloc Risques & Opportunités)
    if (hero) s.push({
      kicker: '05 · EN CLAIR', tab: 'site',
      title: 'Forces, faiblesses et synthèse — en langage décideur.',
      body: 'Pas de jargon : l’outil liste les risques et les opportunités du site, et résume le potentiel en une phrase. La lecture qu’un dirigeant fait en 5 secondes avant de trancher.',
      run: async () => { const t = await showFiche(/Opportunités|EN CLAIR/); try { t && t.scrollIntoView({ behavior: 'auto', block: 'center' }); } catch {} },
      // v7.12 — ancre structurelle dans la carte exec : après #exec-scores-bars
      // viennent [tuiles] → [EN CLAIR] → [Risques/Opportunités]. On cible le
      // bloc Risques/Opportunités, repli EN CLAIR (si aucun risque listé).
      focus: () => {
        const c = $('captageContentSite');
        const b = c && c.querySelector('#exec-scores-bars');
        const tiles = b && b.nextElementSibling;
        const enclair = tiles && tiles.nextElementSibling;
        const risks = enclair && enclair.nextElementSibling;
        if (risks && risks.offsetHeight > 0) return risks;
        if (enclair && enclair.offsetHeight > 0) return enclair;
        return null;
      },
    });

    // 06 — Point mort + modularité financière : Studio FCF (fiable, complet)
    if (hero) s.push({
      kicker: '06 · LE POINT MORT & LA MODULARITÉ', title: 'Combien d’adhérents pour être rentable — et je change tout en direct.',
      body: 'Point mort en adhérents, dette ou 100 % fonds propres, CAPEX, loyer, multiple de sortie, droit d’entrée master-franchise (+400 k€) : je coche, je décoche, je compare deux scénarios côte à côte. La Référence BP reste verrouillée comme garde-fou.',
      run: async () => { closeAllPanels(); try { window.FcfStudio?.open?.(); } catch {} await wait(500); },
      // v7.10 — la LIGNE entière du tableau (closest tr), pas le mini-label :
      // sur écran large le label seul donnait un halo minuscule au bord gauche.
      focus: () => { const p = $('fpFcfStudio'); if (!p) return null; const lbl = findByText(p, /Point mort FCFE/) || findByText(p, /Master-franchise/); if (lbl) { const row = lbl.closest('tr'); if (row) return row; return blockOf(lbl, 420, 26); } return p.querySelector('table'); },
    });

    // 07 — Le portefeuille : consolidation
    s.push({
      kicker: '07 · LE PORTEFEUILLE', title: 'Tous mes sites consolidés, en une vue.',
      body: 'Membres cumulés, FCFE 5 ans du portefeuille, fonds propres à déployer, score moyen — triable, exportable en Excel. La vision d’ensemble pour arbitrer.',
      run: async () => { closeAllPanels(); try { window.Portfolio?.open?.(); } catch {} await wait(500); },
      focus: () => { const p = $('fpPortfolio'); if (!p) return null; const t = findByText(p, /FCFE 5 ANS|MEMBRES CUMULÉS|SITES GO/); return t ? blockOf(t, 320, 60) : p.firstElementChild; },
    });

    // 08 — La stratégie : plan de conquête
    s.push({
      kicker: '08 · LA STRATÉGIE', title: 'Combien de clubs, dans quel ordre, avec quel financement.',
      body: 'Le plan de conquête séquence les ouvertures sous contrainte de cash : fonds propres d’abord, banque dès que je suis bancable. Cannibalisation modélisée, 3 stratégies de financement comparées.',
      run: async () => { closeAllPanels(); try { window.ConquestPlan?.open?.(); } catch {} await wait(500); },
      focus: () => { const p = $('fpConquest'); return p && (findByText(p, /Tu ouvres|SCÉNARIO/) || p.querySelector('header')); },
    });

    // 09 — Clôture
    s.push({
      kicker: 'EXPANSION INTELLIGENCE', title: 'Un seul outil, du marché à la décision.',
      body: 'Géomarketing, modélisation financière modulable, portefeuille consolidé, plan de conquête. Modulable, chiffré, sourcé. Des questions ?',
      run: async () => { closeAllPanels(); try { window.setAnalyzingLayout?.(false); } catch {} try { window._fpMap?.setView?.([44.43, 26.10], 11); } catch {} },
    });

    return s;
  }

  // ── CSS ─────────────────────────────────────────────────────────────
  function injectCss() {
    if ($('fpShowreelCss')) return;
    const st = document.createElement('style');
    st.id = 'fpShowreelCss';
    st.textContent = `
    #fpShowreel{position:fixed;inset:0;z-index:100060;pointer-events:none;font-family:var(--font,sans-serif);opacity:0;transition:opacity .5s ease}
    #fpShowreel.on{opacity:1}
    /* SPOTLIGHT — assombrit tout sauf l'élément clé */
    #fpsrSpot{position:fixed;border-radius:16px;pointer-events:none;z-index:100061;
      box-shadow:0 0 0 4px rgba(212,160,23,.9), 0 0 0 9999px rgba(5,7,13,.74), 0 0 60px rgba(212,160,23,.55) inset;
      /* v7.12 — glissade COURTE (.28s) : une transition longue laissait le halo
         en plein vol entre deux positions à chaque re-rendu de la fiche. */
      transition:opacity .45s ease, top .28s cubic-bezier(.16,1,.3,1), left .28s cubic-bezier(.16,1,.3,1), width .28s cubic-bezier(.16,1,.3,1), height .28s cubic-bezier(.16,1,.3,1);opacity:0}
    #fpsrSpot.on{opacity:1}
    #fpsrSpot::after{content:'';position:absolute;inset:-4px;border-radius:18px;border:2px solid rgba(244,214,126,.9);animation:fpsrRing 2.2s ease-in-out infinite}
    @keyframes fpsrRing{0%,100%{box-shadow:0 0 12px rgba(212,160,23,.4);opacity:.65}50%{box-shadow:0 0 26px rgba(244,214,126,.85);opacity:1}}
    /* letterbox léger quand pas de spotlight */
    .fpsr-bar{position:absolute;left:0;right:0;height:60px;background:linear-gradient(rgba(4,6,12,.9),rgba(4,6,12,0));pointer-events:none;z-index:100062;transition:opacity .5s}
    .fpsr-bar.bottom{bottom:0;top:auto;background:linear-gradient(rgba(4,6,12,0),rgba(4,6,12,.94));height:240px}
    #fpShowreel.spot .fpsr-bar{opacity:0}
    #fpsrCard{position:absolute;left:38px;bottom:48px;max-width:640px;pointer-events:auto;z-index:100064;
      background:linear-gradient(135deg,rgba(15,21,36,.94),rgba(9,13,24,.9));backdrop-filter:blur(18px);
      border:1px solid rgba(212,160,23,.4);border-left:3px solid var(--accent,#d4a017);border-radius:18px;
      padding:22px 26px;box-shadow:0 30px 80px rgba(0,0,0,.66);transform:translateY(16px) scale(.98);opacity:0;transition:all .6s cubic-bezier(.16,1,.3,1)}
    #fpsrCard.show{transform:none;opacity:1}
    /* v7.10 — esquive : si la cible du halo est dans la zone bas-gauche, la
       légende monte en haut pour ne jamais recouvrir ce qu'elle commente. */
    #fpsrCard.fpsr-dodge{bottom:auto;top:84px}
    #fpsrKicker{font-size:11px;font-weight:800;letter-spacing:2.5px;text-transform:uppercase;margin-bottom:9px;
      background:linear-gradient(90deg,#d4a017,#f4d67e,#d4a017);background-size:200% auto;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;animation:fpsrSheen 4s linear infinite}
    @keyframes fpsrSheen{to{background-position:200% center}}
    #fpsrTitle{font-family:var(--font-display,var(--font));font-size:27px;font-weight:900;line-height:1.14;color:#fff;letter-spacing:-.5px;margin-bottom:10px}
    #fpsrBody{font-size:15px;line-height:1.55;color:#cbd5e1;font-weight:400}
    #fpsrDots{position:absolute;top:20px;left:50%;transform:translateX(-50%);display:flex;gap:7px;pointer-events:auto;z-index:100064}
    .fpsr-dot{width:8px;height:8px;border-radius:50%;background:rgba(148,163,184,.35);transition:all .35s ease;cursor:pointer}
    .fpsr-dot.on{background:var(--accent,#d4a017);width:28px;border-radius:6px;box-shadow:0 0 14px rgba(212,160,23,.7)}
    #fpsrCtrl{position:absolute;right:30px;bottom:54px;display:flex;align-items:center;gap:11px;pointer-events:auto;z-index:100064}
    .fpsr-btn{width:46px;height:46px;border-radius:50%;border:1px solid rgba(212,160,23,.45);background:rgba(15,21,36,.9);
      color:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(10px);transition:all .2s}
    .fpsr-btn:hover{background:var(--accent,#d4a017);color:#0a0d16;transform:translateY(-2px) scale(1.06)}
    #fpsrHint{position:absolute;right:30px;bottom:22px;font-size:10px;color:#64748b;pointer-events:none;letter-spacing:.4px;z-index:100064}
    #fpsrBadge{position:absolute;top:18px;right:26px;font-size:10px;font-weight:800;letter-spacing:1.5px;color:#94a3b8;pointer-events:none;z-index:100064}
    #fpsrProg{position:absolute;top:0;left:0;height:3px;background:linear-gradient(90deg,#d4a017,#f4d67e);width:0;transition:width .5s cubic-bezier(.16,1,.3,1);box-shadow:0 0 12px rgba(212,160,23,.8);z-index:100064}
    @media (prefers-reduced-motion:reduce){#fpShowreel,#fpsrCard,#fpsrSpot{transition:none}#fpsrSpot::after,#fpsrKicker{animation:none}}
    `;
    document.head.appendChild(st);
  }

  function buildOverlay() {
    injectCss();
    if ($('fpShowreel')) return;
    const o = document.createElement('div');
    o.id = 'fpShowreel';
    o.innerHTML = `
      <div class="fpsr-bar top"></div><div class="fpsr-bar bottom"></div>
      <div id="fpsrProg"></div><div id="fpsrBadge">🎬 DÉMO GUIDÉE</div>
      <div id="fpsrDots"></div>
      <div id="fpsrCard"><div id="fpsrKicker"></div><div id="fpsrTitle"></div><div id="fpsrBody"></div></div>
      <div id="fpsrCtrl">
        <button class="fpsr-btn" id="fpsrPrev" title="Précédent (←)">‹</button>
        <button class="fpsr-btn" id="fpsrPlay" title="Lecture auto (Espace)">▶</button>
        <button class="fpsr-btn" id="fpsrNext" title="Suivant (→)">›</button>
        <button class="fpsr-btn" id="fpsrExit" title="Quitter (Échap)" style="border-color:rgba(239,68,68,.55)">✕</button>
      </div>
      <div id="fpsrHint">← → naviguer · Espace lecture auto · Échap quitter</div>`;
    document.body.appendChild(o);
    $('fpsrPrev').onclick = () => go(idx - 1);
    $('fpsrNext').onclick = () => go(idx + 1);
    $('fpsrExit').onclick = () => stop();
    $('fpsrPlay').onclick = () => toggleAuto();
    // setTimeout plutôt que rAF : le rAF est suspendu si l'onglet est en
    // arrière-plan → l'overlay resterait invisible. setTimeout tient bon.
    setTimeout(() => o.classList.add('on'), 20);
  }

  // ── Spotlight v7.10 — ENFORCEUR CONTINU ─────────────────────────────
  // Leçon des v7.06-7.09 : un halo posé UNE fois + des marges de timing
  // perdent toujours la course en prod (l'analyse rebascule l'onglet 10-20 s
  // plus tard sur réseau lent, la largeur de la fiche change, les compteurs
  // animés bougent les blocs). Nouveau contrat : pendant TOUTE la scène, un
  // ticker (450 ms) ré-affirme l'onglet déclaré par la scène (sc.tab),
  // RE-RÉSOUT la cible (sc.focus()) et recale le halo si elle a bougé de
  // plus de 6 px. Cible masquée → halo caché. Plus aucun pari sur le timing.
  function clearSpotlight() {
    cancelAnimationFrame(spotRAF); spotRAF = null;
    clearTimeout(spotSettle); clearInterval(spotSettle); spotSettle = null;
    clearInterval(sceneTicker); sceneTicker = null;
    _spotEl = null; _spotWant = null;
    const s = $('fpsrSpot'); if (s) { s.classList.remove('on'); setTimeout(() => s.remove(), 350); }
    $('fpShowreel')?.classList.remove('spot');
    window.removeEventListener('scroll', onSpotScroll, true);
    window.removeEventListener('resize', onSpotScroll);
  }
  let _spotEl = null;      // dernière cible résolue (informative)
  let _spotWant = null;    // dernière géométrie posée (anti-thrash)
  let _lastSpotScroll = 0; // rate-limit du scrollIntoView
  function onSpotScroll() { updateSpot(_spotEl); }
  // v7.12 — stabilité par GÉOMÉTRIE, plus par identité DOM : pendant l'analyse
  // la fiche se re-rend plusieurs fois (Overpass, enrichissement Google) et
  // recrée les mêmes éléments. L'ancienne logique voyait « une nouvelle
  // cible » à chaque re-rendu → re-scroll + nouvelle glissade de 0,6 s en
  // boucle = halo photographié en plein vol, coupé au milieu du texte.
  // Désormais : même géométrie (±8 px) = aucun mouvement, scroll seulement si
  // la cible est franchement hors écran (au plus 1×/1,2 s), et le halo
  // apparaît DIRECTEMENT à sa place (pas de vol d'arrivée).
  function updateSpot(t) {
    const s = $('fpsrSpot');
    if (!t || !t.isConnected || t.offsetHeight === 0) {
      if (s) s.style.opacity = '0';
      _spotEl = null; _spotWant = null;
      return;
    }
    _spotEl = t;
    const raw = t.getBoundingClientRect();
    const now = Date.now();
    if ((raw.bottom < 80 || raw.top > window.innerHeight - 80) && now - _lastSpotScroll > 1200) {
      try { t.scrollIntoView({ behavior: 'auto', block: 'center' }); } catch {}
      _lastSpotScroll = now;
    }
    const r = t.getBoundingClientRect();
    const pad = 12;
    const want = {
      top: Math.max(6, r.top - pad),
      left: Math.max(6, r.left - pad),
      w: Math.min(window.innerWidth - 12, r.width + pad * 2),
      h: Math.min(window.innerHeight - 12, r.height + pad * 2),
    };
    let el = s;
    let created = false;
    if (!el) {
      el = document.createElement('div');
      el.id = 'fpsrSpot';
      el.style.transition = 'none';            // 1er placement : direct, sans vol
      ($('fpShowreel') || document.body).appendChild(el);
      created = true;
      _spotWant = null;
    }
    el.style.opacity = '';
    const moved = !_spotWant || Math.abs(_spotWant.top - want.top) > 8 || Math.abs(_spotWant.left - want.left) > 8
      || Math.abs(_spotWant.w - want.w) > 8 || Math.abs(_spotWant.h - want.h) > 8;
    if (moved) {
      el.style.top = want.top + 'px'; el.style.left = want.left + 'px';
      el.style.width = want.w + 'px'; el.style.height = want.h + 'px';
      _spotWant = want;
      // Esquive de la légende — géométrique et déterministe (zone bas-gauche
      // PAR DÉFAUT de la carte), réévaluée quand le halo bouge vraiment.
      const card = $('fpsrCard');
      if (card) {
        const cw = card.offsetWidth || 640, ch = card.offsetHeight || 220;
        const zone = { left: 38, right: 38 + cw, bottom: window.innerHeight - 48, top: window.innerHeight - 48 - ch };
        const overlap = !(want.top + want.h < zone.top - 8 || want.top > zone.bottom + 8 || want.left + want.w < zone.left - 8 || want.left > zone.right + 8);
        card.classList.toggle('fpsr-dodge', overlap);
      }
    }
    if (created) {
      // reflow pour figer la position posée, puis on rend la main au CSS
      void el.offsetWidth;
      el.style.transition = '';
      setTimeout(() => { el.classList.add('on'); $('fpShowreel')?.classList.add('spot'); }, 20);
    }
  }
  // Ticker de scène : onglet + cible tenus en continu jusqu'à la scène suivante.
  function enforceScene(sc, sceneIdx) {
    clearInterval(sceneTicker);
    const tick = () => {
      if (!running || idx !== sceneIdx) { clearInterval(sceneTicker); sceneTicker = null; return; }
      if (sc.tab) {
        const panel = $('tab-' + sc.tab);
        if (panel && panel.offsetHeight === 0) { try { window.switchTab?.(sc.tab); } catch {} }
      }
      let t = null; try { t = sc.focus && sc.focus(); } catch {}
      updateSpot(t);
    };
    tick();
    sceneTicker = setInterval(tick, 450);
    window.addEventListener('scroll', onSpotScroll, true);
    window.addEventListener('resize', onSpotScroll);
  }

  function renderDots() {
    const d = $('fpsrDots'); if (!d) return;
    d.innerHTML = scenes.map((_, i) => `<div class="fpsr-dot${i === idx ? ' on' : ''}" data-i="${i}"></div>`).join('');
    d.querySelectorAll('.fpsr-dot').forEach(el => el.onclick = () => go(+el.dataset.i));
  }
  function renderLegend(sc) {
    if ($('fpsrKicker')) $('fpsrKicker').textContent = val(sc.kicker) || '';
    if ($('fpsrTitle')) $('fpsrTitle').textContent = val(sc.title) || '';
    if ($('fpsrBody')) $('fpsrBody').innerHTML = val(sc.body) || '';
  }

  async function go(i) {
    if (!running || busy) return;
    if (i < 0 || i >= scenes.length) return;
    busy = true; clearTimeout(autoTimer); clearSpotlight();
    idx = i;
    const sc = scenes[i];
    const card = $('fpsrCard');
    card?.classList.remove('show');
    if ($('fpsrProg')) $('fpsrProg').style.width = (i / (scenes.length - 1) * 100) + '%';
    renderDots();
    await wait(200);
    // 1) légende IMMÉDIATE — l'histoire s'affiche sans attendre le calcul
    renderLegend(sc);
    card?.classList.add('show');
    busy = false;
    // 2) action en arrière-plan, plafonnée → jamais de blocage
    capRun(sc.run, 16000).then(() => {
      if (!running || idx !== i) return;
      renderLegend(sc);                        // rafraîchit avec les données calculées
      const o = $('fpShowreel'); if (o) document.body.appendChild(o); // reste au-dessus des panneaux
      // v7.10 — l'enforceur tient onglet + halo pendant TOUTE la scène
      if (sc.focus || sc.tab) enforceScene(sc, i);
    });
    if (autoplay) autoTimer = setTimeout(() => go(idx + 1), sc.hold || 9000);
  }

  function toggleAuto() {
    autoplay = !autoplay;
    const b = $('fpsrPlay'); if (b) { b.textContent = autoplay ? '⏸' : '▶'; b.classList.toggle('on', autoplay); }
    clearTimeout(autoTimer);
    if (autoplay && running) autoTimer = setTimeout(() => go(idx + 1), scenes[idx]?.hold || 9000);
  }
  function onKey(e) {
    if (!running) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); go(idx + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(idx - 1); }
    else if (e.key === ' ') { e.preventDefault(); toggleAuto(); }
    else if (e.key === 'Escape') { e.preventDefault(); stop(); }
  }

  function start() {
    if (running) return;
    // v7.10 — si le tour d'onboarding (carte BIENVENUE) est ouvert, la démo
    // tournerait DERRIÈRE sa modale (halos posés au bon endroit mais app
    // masquée — vu en test headless profil vierge). On le ferme proprement
    // (clic sur son ✕ = son propre cleanup), puis purge de tout reliquat.
    try { document.querySelectorAll('.fp-onb-overlay .fp-onb-close').forEach(b => b.click()); } catch {}
    setTimeout(() => { try { document.querySelectorAll('.fp-onb-overlay').forEach(o => o.remove()); } catch {} }, 400);
    scenes = buildScenes();
    if (!scenes.length) return;
    running = true; idx = 0; autoplay = false;
    try { window.PresentationMode?.toggle?.(true); } catch {}
    buildOverlay();
    document.addEventListener('keydown', onKey, true);
    go(0);
  }
  function stop() {
    running = false; autoplay = false;
    clearTimeout(autoTimer); clearSpotlight();
    document.removeEventListener('keydown', onKey, true);
    closeAllPanels();
    try { window.PresentationMode?.toggle?.(false); } catch {}
    const o = $('fpShowreel'); if (o) { o.classList.remove('on'); setTimeout(() => o.remove(), 500); }
    // v7.03 — la carte peut avoir été redimensionnée pendant la démo : on la
    // resynchronise pour que l'Explorer (filtres/marqueurs) reste fonctionnel.
    try { setTimeout(() => window._fpMap?.invalidateSize?.(true), 400); } catch {}
  }
  window.Showreel = { start, stop };

  // ── Bouton 🎬 dans le header ────────────────────────────────────────
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
