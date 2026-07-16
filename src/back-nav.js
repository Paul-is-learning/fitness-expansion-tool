// ─────────────────────────────────────────────────────────────────────
// src/back-nav.js — v6.92 « Précédent = fermer, pas quitter »
//
// PROBLÈME : les panneaux plein écran (BP du site, Conquête, Portefeuille,
// Studio FCF, Intel…) s'ouvrent PAR-DESSUS la page sans entrée d'historique.
// Le bouton Précédent du navigateur quittait donc le SaaS (retour Vercel).
//
// SOLUTION : chaque ouverture de panneau pousse une entrée d'historique
// (history.pushState). Précédent (ou swipe back) ferme alors le panneau au
// sommet. Même logique pour le mode analyse (sidebar élargie) : Précédent
// revient à la carte. Quand plus rien n'est ouvert, Précédent reprend son
// comportement normal (quitter la page).
//
// Zéro modification des modules : un MutationObserver sur <body> détecte
// l'ajout/retrait des panneaux par leur id. Fermeture via ✕/Échap =
// l'entrée d'historique correspondante est consommée (history.back()
// silencieux) pour ne pas laisser d'entrées fantômes.
// ─────────────────────────────────────────────────────────────────────
(function () {
  'use strict';
  if (!window.history || !window.history.pushState) return;

  // Panneaux plein écran suivis : id → fermeture propre (fallback remove()).
  const CLOSERS = {
    bpSiteFullscreenModal: () => window.BPSiteUI?.closeFullscreen?.(),
    fpConquest:            () => window.ConquestPlan?.close?.(),
    ciPanel:               () => window.CompetitorIntel?.close?.(),
    fpPortfolio:           () => window.Portfolio?.close?.(),
    fpFcfStudio:           () => window.FcfStudio?.close?.(),
    fpAnalyst:             null,
    userPanel:             null,
    fpChainsIntelModal:    null,
    fpTopClubsModal:       null,
    fpActivityModal:       null,
    demoPanel:             null,
  };
  const PANEL_IDS = Object.keys(CLOSERS);

  const tracked = [];      // pile de nos entrées d'historique [{kind, id}]
  let ignorePops = 0;      // popstate déclenchés par NOS history.back()

  function pushEntry(kind, id) {
    try { history.pushState({ fpNav: kind, id: id || null }, '', location.href); } catch { return; }
    tracked.push({ kind, id: id || null });
  }
  // Consomme notre entrée d'historique quand la fermeture vient de l'UI
  // (✕, Échap, clic hors panneau) et non du bouton Précédent.
  function consumeTop(kind, id) {
    const top = tracked[tracked.length - 1];
    if (top && top.kind === kind && top.id === id) {
      tracked.pop();
      ignorePops++;
      try { history.back(); } catch { ignorePops--; }
      return;
    }
    // Fermé hors ordre (empilements exotiques) : on retire juste de la pile.
    const i = tracked.findIndex(t => t.kind === kind && t.id === id);
    if (i >= 0) tracked.splice(i, 1);
  }

  // ── Détection ouverture/fermeture des panneaux (aucun module modifié) ──
  const mo = new MutationObserver(muts => {
    for (const m of muts) {
      m.addedNodes.forEach(n => {
        if (n.nodeType === 1 && PANEL_IDS.includes(n.id)) pushEntry('panel', n.id);
      });
      m.removedNodes.forEach(n => {
        if (n.nodeType === 1 && PANEL_IDS.includes(n.id)) consumeTop('panel', n.id);
      });
    }
  });
  mo.observe(document.body, { childList: true });

  // ── Bouton Précédent / swipe back ────────────────────────────────────
  window.addEventListener('popstate', () => {
    if (ignorePops > 0) { ignorePops--; return; }
    const top = tracked.pop();
    if (!top) return; // rien d'ouvert chez nous → navigation normale
    if (top.kind === 'panel') {
      const el = document.getElementById(top.id);
      if (!el) return; // déjà fermé (entrée fantôme) → back "à vide", sans dégât
      const closer = CLOSERS[top.id];
      try { closer ? closer() : el.remove(); }
      catch { try { el.remove(); } catch {} }
      // NB : le retrait du DOM va re-déclencher l'observer → consumeTop ne
      // trouvera plus l'entrée (déjà dépilée) → no-op. Pas de double back.
    } else if (top.kind === 'analyse') {
      try {
        const app = document.querySelector('.app');
        if (app?.classList.contains('is-analyzing')) window.setAnalyzingLayout?.(false);
      } catch {}
    }
  });

  // ── Mode analyse (fiche site élargie) : Précédent = retour carte ─────
  // Hook de diagnostic (console) : window._fpBackNav.stack()
  window._fpBackNav = { stack: () => tracked.map(t => t.kind + ':' + (t.id || '')) };

  const origLayout = window.setAnalyzingLayout;
  if (typeof origLayout === 'function') {
    window.setAnalyzingLayout = function (on) {
      const app = document.querySelector('.app');
      const was = !!app?.classList.contains('is-analyzing');
      const r = origLayout.apply(this, arguments);
      const now = !!app?.classList.contains('is-analyzing');
      if (now && !was) pushEntry('analyse', null);          // entrée en mode analyse
      else if (!now && was) consumeTop('analyse', null);    // sortie via bouton/Échap
      return r;
    };
  }
})();
