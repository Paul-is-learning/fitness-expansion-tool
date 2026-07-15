// ═════════════════════════════════════════════════════════════════════
// LEXIQUE DIDACTIQUE (v6.72 — P2a refonte) — les termes métier expliqués
// au survol, partout dans les fiches d'analyse.
//
// Principe : après chaque rendu de fiche (renderCaptageAnalysis), on
// scanne le texte du conteneur et on enveloppe la 1re occurrence visible
// de chaque terme connu d'un <span class="fp-lex"> (pointillé discret).
// Le survol affiche une carte : définition simple + repère chiffré.
// Lecture seule — ne touche ni au moteur ni aux données.
// ═════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  // ─── Dictionnaire — définition courte + repère concret ───────────
  // pattern: regex (insensible casse sauf sigles), def: 1-2 phrases max.
  const TERMS = [
    { rx: /\bSAZ\b/, t: 'SAZ — Score d’Attractivité de Zone',
      d: 'Note /100 combinant flux piéton (métro, malls, bureaux), densité de population cible et jeunesse du quartier. Pondérable via les curseurs Flux/Densité/Jeunesse.',
      r: '≥ 70 excellent · 45-70 correct · < 45 faible' },
    { rx: /\bcaptifs?\b/i, t: 'Membres captifs',
      d: 'Adhérents ACTUELS des clubs concurrents dans la zone, susceptibles de changer pour Fitness Park (prix ÷2 vs premium). Estimés club par club selon distance, segment et notes Google.',
      r: 'Taux de capture : 8-15% selon segment du concurrent' },
    { rx: /\bnatifs?\b/i, t: 'Membres natifs',
      d: 'Habitants de la zone qui ne sont PAS encore inscrits en salle et que l’arrivée d’un club low-cost convertit (création de marché).',
      r: 'Pénétration fitness RO ~5% vs 10-12% en France → gisement' },
    { rx: /\bwalk[- ]?in\b/i, t: 'Walk-in',
      d: 'Membres issus du flux spontané du site (passage mall, visibilité vitrine) — sans acquisition marketing.',
      r: 'Fort dans les malls destination (Baneasa: +5 500)' },
    { rx: /\bIRR Projet\b|\bTRI Projet\b/i, t: 'IRR Projet (unlevered)',
      d: 'Rentabilité annualisée du site en supposant un financement 100% fonds propres. Mesure la qualité INTRINSÈQUE du site, avant toute ingénierie financière.',
      r: 'Base du go/no-go : > 15% requis, > 30% excellent' },
    { rx: /\bIRR Equity\b|\bTRI Equity\b/i, t: 'IRR Equity (levered)',
      d: 'Rentabilité annualisée de TON apport après service de la dette. L’emprunt amplifie le rendement quand l’IRR projet dépasse le taux d’intérêt (effet de levier).',
      r: 'Réf. BP : dette 70% @ 4% → levier ≈ +35 pts vs IRR projet' },
    { rx: /\bFCFE\b/, t: 'FCFE — Free Cash Flow to Equity',
      d: 'Cash réellement rendu à l’actionnaire chaque année : EBITDA − leasing − intérêts − remboursement du capital (avant IS, aligné modèle).',
      r: 'Cumulé 5 ans : la vraie « paie » de ton investissement' },
    { rx: /\bFCFF\b/, t: 'FCFF — Free Cash Flow to Firm',
      d: 'Cash généré par le site avant toute dette : EBITDA − leasing. Sert à comparer des sites indépendamment du financement.',
      r: '= flux « projet » qui alimente l’IRR unlevered' },
    { rx: /\bDSCR\b/, t: 'DSCR — Debt Service Coverage Ratio',
      d: 'Combien de fois le cash opérationnel couvre l’échéance annuelle de dette (intérêts + capital). LE ratio que la banque regarde.',
      r: '≥ 1.2 exigé par les banques · A1 exclu (ramp-up)' },
    { rx: /\bMOIC\b/, t: 'MOIC — Multiple On Invested Capital',
      d: 'Combien d’euros récupérés pour 1 € d’apport, sur 5 ans avec revente (multiple × EBITDA A5). Complète l’IRR : le multiple dit « combien », l’IRR dit « à quelle vitesse ».',
      r: '≥ 2× bien · ≥ 3× excellent (private equity)' },
    { rx: /\bNPV\b|\bVAN\b/, t: 'NPV — Valeur Actuelle Nette',
      d: 'Somme des cash flows futurs actualisés au WACC (12%), moins l’investissement. Positive = le site crée de la valeur au-delà du coût du capital.',
      r: '> 0 requis · comparer entre sites à CAPEX égal' },
    { rx: /\bWACC\b/, t: 'WACC — coût moyen pondéré du capital',
      d: 'Le rendement minimum exigé pour justifier l’investissement (mix coût de la dette + attente des actionnaires). Sert de taux d’actualisation.',
      r: 'Réf. modèle : 12%' },
    { rx: /\bEBITDA\b/, t: 'EBITDA',
      d: 'Résultat opérationnel avant intérêts, impôts et amortissements : CA − coûts d’exploitation. Le « moteur cash » du club.',
      r: 'Réf. OnAir mature : 44.7% du CA · seuil sain ≥ 35%' },
    { rx: /\bchurn\b/i, t: 'Churn',
      d: 'Taux d’attrition : % des membres qui résilient chaque année. Plus il est bas, moins il faut recruter pour maintenir la base.',
      r: 'Modèle : 4.3%/an post-maturité (HYPOTHESES!C37)' },
    { rx: /\bLTV\s*\/\s*CAC\b|\bLTV\/CAC\b/, t: 'LTV / CAC',
      d: 'Valeur-vie d’un membre (marge × durée de vie) divisée par son coût d’acquisition. Mesure l’efficience marketing.',
      r: '> 3 sain · > 10 exceptionnel' },
    { rx: /\bLTV\b/, t: 'LTV — LifeTime Value',
      d: 'Marge totale générée par un membre sur toute sa durée de vie (ARPU × marge × 1/churn).',
      r: 'Modèle : ~950 € par membre' },
    { rx: /\bCAC\b/, t: 'CAC — Coût d’Acquisition Client',
      d: 'Dépense marketing + vente pour recruter UN membre.',
      r: 'Modèle : ~50 € (standard low-cost EU)' },
    { rx: /\bARPU\b/, t: 'ARPU — revenu moyen par membre',
      d: 'Panier mensuel moyen HT, mix des forfaits (Base/Premium/Ultimate) et % VAD inclus.',
      r: 'Modèle : 25.49 € HT · concurrents RO réels : 26-46 € TTC' },
    { rx: /\bbreakeven\b/i, t: 'Breakeven',
      d: 'Premier mois où l’EBITDA mensuel devient positif : le club couvre ses charges courantes.',
      r: 'M5-M7 = très bon pour un low-cost' },
    { rx: /\bpayback equity\b/i, t: 'Payback equity',
      d: 'Mois où le cumul des FCFE rembourse l’apport initial : ton argent est revenu, la suite est du gain.',
      r: '< M36 attractif pour un club' },
    { rx: /\bpayback\b/i, t: 'Payback',
      d: 'Mois où le cumul des cash flows projet rembourse le CAPEX total (vision 100% equity).',
      r: '< M48 = bon standard fitness' },
    { rx: /\bvaleur terminale\b|\bTV\b(?=[^A-Za-z]|$)/i, t: 'Valeur terminale (TV)',
      d: 'Prix de revente théorique du club en fin d’horizon : multiple × EBITDA A5. Incluse dans IRR/NPV/MOIC « avec sortie ».',
      r: 'Réf. : 8× EBITDA A5 (HYPOTHESES!C116)' },
    { rx: /\beffet de levier\b/i, t: 'Effet de levier',
      d: 'Financer par la dette ce qui rapporte plus que son taux d’intérêt amplifie le rendement des fonds propres — au prix d’un risque accru (service de dette fixe).',
      r: 'Comparer les 2 dans le ⚖️ Studio FCF' },
    { rx: /\bramp[- ]?up\b/i, t: 'Ramp-up',
      d: 'Phase de montée en charge (M1-M24) : les membres arrivent par cohortes, l’EBITDA est d’abord négatif puis bascule au breakeven.',
      r: 'Cible maturité : 3 600 membres à A3' },
    { rx: /\bcohortes?\b/i, t: 'Cohorte',
      d: 'Groupe de membres inscrits le même mois, suivi dans le temps avec son churn propre — la base du modèle de revenus mois par mois.',
      r: '60 mois simulés par scénario' },
    { rx: /\bVAD\b/, t: 'VAD — ventes additionnelles',
      d: '% de clients sur forfaits supérieurs (Premium/Ultimate) et services (PT, boissons). Tire l’ARPU vers le haut.',
      r: 'Modèle : 20% (HYPOTHESES!C46)' },
    { rx: /\bredevance\b/i, t: 'Redevance',
      d: 'Royalties versées au franchiseur, % du CA adhérents.',
      r: 'Modèle : 6% + 2% fonds publicitaire' },
    { rx: /\bzone blanche\b/i, t: 'Zone blanche',
      d: 'Zone sans concurrent dans le rayon : toute la demande captable est « native » — création de marché pure.',
      r: 'Opportunité maximale, risque d’éducation du marché' },
  ];

  // ─── Injection CSS (une fois) ─────────────────────────────────────
  function injectCss() {
    if (document.getElementById('fpLexCss')) return;
    const st = document.createElement('style');
    st.id = 'fpLexCss';
    st.textContent = `
      .fp-lex { border-bottom: 1px dotted rgba(212,160,23,.55); cursor: help; position: relative; }
      .fp-lex:hover { border-bottom-color: var(--accent, #d4a017); }
      #fpLexTip {
        position: fixed; z-index: 100002; max-width: 320px; pointer-events: none;
        background: linear-gradient(180deg, #131a2b, #0d1322);
        border: 1px solid rgba(212,160,23,.45); border-radius: 10px;
        padding: 10px 12px; box-shadow: 0 12px 34px rgba(0,0,0,.55);
        opacity: 0; transition: opacity .12s ease; font-family: var(--font, sans-serif);
      }
      #fpLexTip.show { opacity: 1; }
      #fpLexTip .t { font-size: 11px; font-weight: 800; color: #d4a017; margin-bottom: 4px; }
      #fpLexTip .d { font-size: 10px; color: #cbd5e1; line-height: 1.55; }
      #fpLexTip .r { font-size: 9px; color: #64748b; margin-top: 6px; padding-top: 5px;
                     border-top: 1px solid rgba(71,85,115,.3); }
      body.presentation-mode .fp-lex { border-bottom: none; cursor: default; }
    `;
    document.head.appendChild(st);
  }

  // ─── Tooltip singleton ────────────────────────────────────────────
  let tip = null;
  function ensureTip() {
    if (tip) return tip;
    tip = document.createElement('div');
    tip.id = 'fpLexTip';
    document.body.appendChild(tip);
    return tip;
  }
  function showTip(el, term) {
    if (document.body.classList.contains('presentation-mode')) return;
    const t = ensureTip();
    t.innerHTML = `<div class="t">${term.t}</div><div class="d">${term.d}</div>${term.r ? `<div class="r">📏 ${term.r}</div>` : ''}`;
    const rect = el.getBoundingClientRect();
    t.classList.add('show');
    // position: au-dessus si possible, sinon en dessous ; clamp horizontal
    const w = Math.min(320, window.innerWidth - 20);
    let x = Math.max(10, Math.min(rect.left, window.innerWidth - w - 10));
    t.style.left = x + 'px';
    t.style.top = '0px';
    const h = t.offsetHeight || 90;
    const above = rect.top - h - 8;
    t.style.top = (above > 8 ? above : rect.bottom + 8) + 'px';
  }
  function hideTip() { tip?.classList.remove('show'); }

  // ─── Annotation d'un conteneur ────────────────────────────────────
  // 1 seule occurrence marquée par terme et par passage (sinon bruit).
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A', 'CANVAS', 'SVG']);
  // Anti-boucle : l'observer doit IGNORER les mutations produites par
  // annotate() lui-même (sinon annotation → mutation → ré-annotation → ∞).
  let _suppress = false;
  function annotate(root) {
    if (!root || root.__fpLexDone) return;
    injectCss();
    _suppress = true;
    try { _annotateInner(root); }
    finally { setTimeout(() => { _suppress = false; }, 0); }
  }
  function _annotateInner(root) {
    const seen = new Set();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!n.nodeValue || n.nodeValue.trim().length < 3) return NodeFilter.FILTER_REJECT;
        let p = n.parentElement;
        for (let i = 0; p && i < 6; i++, p = p.parentElement) {
          if (SKIP_TAGS.has(p.tagName) || p.classList?.contains('fp-lex')) return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      let text = node.nodeValue;
      for (let ti = 0; ti < TERMS.length; ti++) {
        if (seen.has(ti)) continue;
        const m = text.match(TERMS[ti].rx);
        if (!m || m.index == null) continue;
        seen.add(ti);
        // découpe le text node : avant | terme | après
        const before = text.slice(0, m.index);
        const word = m[0];
        const after = text.slice(m.index + word.length);
        const span = document.createElement('span');
        span.className = 'fp-lex';
        span.textContent = word;
        span.dataset.fpLex = String(ti);
        const frag = document.createDocumentFragment();
        if (before) frag.appendChild(document.createTextNode(before));
        frag.appendChild(span);
        if (after) frag.appendChild(document.createTextNode(after));
        node.parentNode.replaceChild(frag, node);
        break; // ce text node est consommé — on passe au suivant
      }
      if (seen.size >= TERMS.length) break;
    }
    root.__fpLexDone = true;
  }

  // ─── Événements délégués (un seul listener global) ────────────────
  document.addEventListener('mouseover', e => {
    const el = e.target.closest?.('.fp-lex');
    if (!el) return;
    const term = TERMS[parseInt(el.dataset.fpLex, 10)];
    if (term) showTip(el, term);
  });
  document.addEventListener('mouseout', e => {
    if (e.target.closest?.('.fp-lex')) hideTip();
  });
  window.addEventListener('scroll', hideTip, { passive: true, capture: true });

  // ─── Hooks de rendu : fiches d'analyse + panneaux ────────────────
  // Observer léger : quand #captageContentSite (ou modaux connus) change,
  // re-annote après stabilisation (debounce 400ms).
  let timer = null;
  const targetsSel = ['captageContentSite', 'captageContent', 'bpSiteContent'];
  function scheduleAnnotate() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      targetsSel.forEach(id => {
        const el = document.getElementById(id);
        if (el && el.innerHTML && !el.__fpLexDone) annotate(el);
      });
    }, 400);
  }
  const mo = new MutationObserver(muts => {
    if (_suppress) return;
    for (const m of muts) {
      const t = m.target;
      if (t.nodeType !== 1) continue;
      const hit = targetsSel.some(id => t.id === id || t.closest?.('#' + id));
      if (hit) {
        // le contenu a changé → il faudra ré-annoter
        targetsSel.forEach(id => { const el = document.getElementById(id); if (el && (t.id === id || t.closest?.('#' + id))) el.__fpLexDone = false; });
        scheduleAnnotate();
        return;
      }
    }
  });
  function boot() {
    try { mo.observe(document.body, { childList: true, subtree: true }); } catch {}
    scheduleAnnotate();
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') boot();
  else document.addEventListener('DOMContentLoaded', boot);

  // API publique (memo IC réutilise les définitions)
  window.FpLexicon = { TERMS, annotate };
})();
