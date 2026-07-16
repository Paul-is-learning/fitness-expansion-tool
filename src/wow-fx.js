// ─────────────────────────────────────────────────────────────────────
// src/wow-fx.js — v6.94 « couche wow »
//
// Effets dynamiques par-dessus le polish v6.90, dans le même registre
// premium (Apple × LV) mais avec plus de vie :
//   1. COMPTEURS ANIMÉS — les gros chiffres (KPIs, IRR, k€, adhérents)
//      comptent de 0 à leur valeur à l'ouverture des panneaux et de la
//      fiche d'analyse. Le texte final est restauré à l'octet près.
//   2. CASCADE — les blocs d'un panneau apparaissent en escalier.
//   3. CARTE VIVANTE — pulsation dorée douce des pins Fitness Park
//      (plus marquée sur le pin actif).
//   4. VERDICT — pop élastique du chip GO/WATCH/NO GO.
//   5. COURBES — Chart.js se dessine en douceur (800 ms easeOutQuart).
//
// Garde-fous : prefers-reduced-motion respecté (tout coupé), zéro
// modification des modules (observer DOM, comme back-nav), texte final
// des compteurs = texte d'origine exact (aucun risque pour les tests).
// ─────────────────────────────────────────────────────────────────────
(function () {
  'use strict';

  // ── CSS ──────────────────────────────────────────────────────────
  const st = document.createElement('style');
  st.id = 'fpWowCss';
  st.textContent = `
  @keyframes fpWowIn { from { opacity:0; transform:translateY(14px) scale(.985); } to { opacity:1; transform:none; } }
  .fp-wow-in { animation: fpWowIn .55s cubic-bezier(.16,1,.3,1) both; animation-delay: var(--wow-d, 0s); }

  /* Carte vivante — halo doré qui respire sur les pins FP */
  .fp-logo-pin::after { content:''; position:absolute; inset:-7px; border-radius:50%;
    border:2px solid rgba(212,160,23,.38); animation: fpPinPulse 3.2s cubic-bezier(.4,0,.2,1) infinite; pointer-events:none; }
  .fp-logo-pin.fp-pin-active::after { border-color: rgba(212,160,23,.75); animation-duration: 2.2s; }
  @keyframes fpPinPulse { 0% { transform:scale(.78); opacity:.9; } 70%,100% { transform:scale(1.28); opacity:0; } }

  /* Verdict — pop élastique */
  .reco-chip { animation: fpChipPop .55s cubic-bezier(.34,1.5,.5,1) both; }
  @keyframes fpChipPop { from { opacity:0; transform:scale(.55); } to { opacity:1; transform:scale(1); } }

  @media (prefers-reduced-motion: reduce) {
    .fp-wow-in, .reco-chip { animation: none !important; }
    .fp-logo-pin::after { display: none !important; }
  }`;
  document.head.appendChild(st);

  const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) return; // CSS neutralisé ci-dessus, pas de JS d'animation non plus

  // ── Chart.js : les courbes se dessinent ──────────────────────────
  const softenCharts = () => {
    try {
      if (window.Chart?.defaults) {
        window.Chart.defaults.animation = Object.assign({}, window.Chart.defaults.animation,
          { duration: 800, easing: 'easeOutQuart' });
      }
    } catch {}
  };
  softenCharts();
  window.addEventListener('load', softenCharts, { once: true });

  // ── 1. Compteurs animés ──────────────────────────────────────────
  // Reconnaît "12 345", "104.45%", "1 576 k€", "2 367 mbr", "30.8×", "M31"…
  const NUM_RE = /^([^\d−-]{0,8})(−|-)?(\d{1,3}(?:[\s  ]\d{3})+|\d+)(?:([.,])(\d+))?([^\d]{0,10})$/;

  function countUp(el) {
    if (el.__fpWow) return;
    const raw = el.textContent.trim();
    if (!raw || raw.length > 24) return;
    const m = raw.match(NUM_RE);
    if (!m) return;
    const [, pre, neg, intPart, decSep, decPart, post] = m;
    const target = parseFloat((neg ? '-' : '') + intPart.replace(/[\s  ]/g, '') + (decPart ? '.' + decPart : ''));
    if (!isFinite(target) || Math.abs(target) < 2) return;
    el.__fpWow = true;
    // Filet de sécurité : restauration du texte EXACT même si la chaîne
    // requestAnimationFrame est suspendue (onglet en arrière-plan, etc.)
    const safety = setTimeout(() => { el.textContent = raw; }, 2600);
    const dec = decPart ? decPart.length : 0;
    const grouped = /[\s  ]/.test(intPart);
    const fmtV = (v) => {
      let s = Math.abs(v).toFixed(dec);
      if (grouped) {
        const [i, d] = s.split('.');
        s = i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (d ? (decSep || '.') + d : '');
      } else if (dec && decSep === ',') s = s.replace('.', ',');
      return (v < 0 ? '−' : '') + s;
    };
    const dur = 700 + Math.min(500, Math.abs(target) / 40); // gros chiffres = un poil plus long
    const t0 = performance.now();
    const ease = t => 1 - Math.pow(1 - t, 4);
    (function tick(now) {
      if (!el.isConnected) { clearTimeout(safety); el.textContent = raw; return; } // panneau fermé pendant l'anim
      const p = Math.min(1, (now - t0) / dur);
      el.textContent = pre + fmtV(target * ease(p)) + post;
      if (p < 1) requestAnimationFrame(tick);
      else { clearTimeout(safety); el.textContent = raw; } // restauration EXACTE du texte d'origine
    })(t0);
  }

  function animateNumbers(root) {
    try {
      if (!root) return;
      if (document.hidden) return; // onglet caché : rAF suspendu → pas d'anim, texte intact
      let n = 0;
      for (const el of root.querySelectorAll('div,span,td,b,strong')) {
        if (n >= 60) break;
        if (el.childElementCount) continue;
        const t = el.textContent.trim();
        if (!t || t.length > 24 || !/\d/.test(t) || !NUM_RE.test(t)) continue;
        const cs = getComputedStyle(el);
        if (parseFloat(cs.fontSize) >= 13 && (parseInt(cs.fontWeight) || 400) >= 700) { countUp(el); n++; }
      }
    } catch {}
  }

  // ── 2. Cascade + compteurs à l'ouverture des panneaux ────────────
  const PANELS = ['bpSiteFullscreenModal', 'fpConquest', 'ciPanel', 'fpPortfolio',
    'fpFcfStudio', 'fpAnalyst', 'userPanel', 'fpChainsIntelModal', 'fpTopClubsModal', 'fpActivityModal'];

  function stagger(panel) {
    try {
      let i = 0;
      for (const b of panel.querySelectorAll(':scope > *, :scope > div > *')) {
        if (i >= 14) break;
        if (!(b instanceof HTMLElement) || b.tagName === 'STYLE' || b.tagName === 'SCRIPT') continue;
        b.classList.add('fp-wow-in');
        b.style.setProperty('--wow-d', (i * 0.05).toFixed(2) + 's');
        i++;
      }
    } catch {}
  }

  const mo = new MutationObserver(muts => {
    for (const m of muts) m.addedNodes.forEach(n => {
      if (n.nodeType === 1 && PANELS.includes(n.id)) {
        // le contenu est injecté (innerHTML) juste après l'append → petit délai
        setTimeout(() => { stagger(n); animateNumbers(n); }, 80);
      }
    });
  });
  mo.observe(document.body, { childList: true });

  // ── 3. Fiche d'analyse : compteurs quand l'analyse s'affiche ─────
  // (transition off→on du mode analyse ; deux passes car la fiche se
  // remplit progressivement — chaque élément ne compte qu'une fois)
  const origLayout = window.setAnalyzingLayout;
  if (typeof origLayout === 'function') {
    window.setAnalyzingLayout = function (on) {
      const app = document.querySelector('.app');
      const was = !!app?.classList.contains('is-analyzing');
      const r = origLayout.apply(this, arguments);
      if (on && !was) {
        [800, 1800].forEach(d => setTimeout(() => animateNumbers(document.getElementById('captageContentSite')), d));
      }
      return r;
    };
  }
})();
