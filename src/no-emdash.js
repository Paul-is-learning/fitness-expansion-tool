// ─────────────────────────────────────────────────────────────────────
// src/no-emdash.js — v7.08 « pas de tirets longs »
//
// Demande Paul : « retire les tirets longs (— –) de tout le SaaS, je n'aime
// pas ». On remplace, dans le TEXTE AFFICHÉ uniquement (jamais le code, jamais
// les commentaires), tout tiret cadratin « — » ou demi-cadratin « – » par un
// point médian « · » — le séparateur déjà utilisé partout dans l'app.
//
// Fonctionnement : un balayage au chargement + un MutationObserver qui nettoie
// tout texte rendu ensuite (analyses, réponses IA, i18n, popups carte…). Ne
// touche ni aux <script>/<style>, ni aux champs de saisie, ni au code source.
// Les fourchettes numériques (« 46–90 ») deviennent « 46-90 » (tiret court),
// pas un point médian, pour rester lisibles.
//
// Autonome, zéro dépendance. Idempotent (repasser dessus ne change rien).
// ─────────────────────────────────────────────────────────────────────
(function () {
  'use strict';
  try { if (window !== window.top) return; } catch { return; }

  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'NOSCRIPT']);
  const RANGE = /(\d)[ \t]*[—–][ \t]*(\d)/g; // fourchette → tiret court
  const DASH  = /[ \t]*[—–][ \t]*/g;         // sinon → point médian espacé
  const has = s => s && (s.indexOf('—') !== -1 || s.indexOf('–') !== -1);

  function fix(str) {
    if (!has(str)) return str;
    return str.replace(RANGE, '$1-$2').replace(DASH, ' · ');
  }

  function cleanTextNodes(root) {
    if (!root || !root.ownerDocument && root.nodeType !== 9 && root.nodeType !== 1) return;
    const doc = root.ownerDocument || document;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!has(n.nodeValue)) return NodeFilter.FILTER_REJECT;
        const p = n.parentNode;
        if (p && SKIP.has(p.nodeName)) return NodeFilter.FILTER_REJECT;
        if (p && p.isContentEditable) return NodeFilter.FILTER_REJECT; // ne pas gêner l'édition
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const todo = [];
    while (walker.nextNode()) todo.push(walker.currentNode);
    for (const n of todo) { const v = fix(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; }
  }

  function cleanAttrs(el) {
    if (!el || el.nodeType !== 1 || !el.getAttribute) return;
    for (const a of ['placeholder', 'title', 'aria-label', 'alt']) {
      const v = el.getAttribute && el.getAttribute(a);
      if (has(v)) { const nv = fix(v); if (nv !== v) el.setAttribute(a, nv); }
    }
  }

  function sweep(node) {
    if (!node) return;
    if (node.nodeType === 3) { const v = fix(node.nodeValue || ''); if (v !== node.nodeValue) node.nodeValue = v; return; }
    if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11) return;
    cleanTextNodes(node);
    if (node.nodeType === 1) {
      cleanAttrs(node);
      const els = node.querySelectorAll && node.querySelectorAll('[placeholder],[title],[aria-label],[alt]');
      if (els) els.forEach(cleanAttrs);
    }
  }

  // Traitement par lots (setTimeout, fiable même hors rendu actif) pour ne pas
  // balayer à chaque micro-mutation.
  let queued = [], scheduled = false;
  function flush() {
    scheduled = false;
    const batch = queued; queued = [];
    for (const n of batch) { try { sweep(n); } catch {} }
  }
  function schedule(n) {
    queued.push(n);
    if (!scheduled) { scheduled = true; setTimeout(flush, 16); }
  }

  function start() {
    try { if (has(document.title)) document.title = fix(document.title); } catch {}
    sweep(document.documentElement);
    try {
      const obs = new MutationObserver(muts => {
        for (const m of muts) {
          if (m.type === 'characterData' || m.type === 'attributes') schedule(m.target);
          else if (m.addedNodes) m.addedNodes.forEach(schedule);
        }
      });
      // On observe aussi les attributs visibles (title/placeholder/aria-label/alt)
      // car ils sont souvent posés en propriété APRÈS insertion (btn.title = …),
      // ce qu'une observation childList/characterData ne verrait pas.
      obs.observe(document.documentElement, {
        childList: true, subtree: true, characterData: true,
        attributes: true, attributeFilter: ['title', 'placeholder', 'aria-label', 'alt'],
      });
    } catch {}
    // Filet de sécurité : quelques balayages complets différés (boutons posés
    // au window.load, traductions i18n, titres réglés en propriété…).
    [300, 1200, 3000].forEach(ms => setTimeout(() => { try { sweep(document.documentElement); } catch {} }, ms));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
