// ═════════════════════════════════════════════════════════════════════
// MODE PRÉSENTATION (v6.72 — P2c refonte) — vue "partage d'écran
// investisseur" : typographie agrandie, curseurs et contrôles techniques
// masqués, focus sur le verdict et les chiffres. Toggle 🎥 dans le
// header, Échap pour sortir. Rien n'est persisté.
// ═════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  function injectCss() {
    if (document.getElementById('fpPresentCss')) return;
    const st = document.createElement('style');
    st.id = 'fpPresentCss';
    st.textContent = `
      /* ── Mode présentation : plus grand, plus calme ── */
      body.presentation-mode #captageContentSite,
      body.presentation-mode #captageContent {
        font-size: 115%;
        zoom: 1.18;
      }
      /* masque les contrôles techniques (négociation en interne, pas devant l'investisseur) */
      body.presentation-mode #rent-block,
      body.presentation-mode #financing-block > #fin-sliders-wrap,
      body.presentation-mode #financing-block label,
      body.presentation-mode input[type="range"],
      body.presentation-mode .radius-pill,
      body.presentation-mode button[onclick*="FcfStudio"],
      body.presentation-mode button[onclick*="exportPDF"],
      body.presentation-mode button[onclick*="resetUserParams"],
      body.presentation-mode .no-present {
        display: none !important;
      }
      /* bannière discrète */
      #fpPresentBanner {
        display: none; position: fixed; bottom: 14px; left: 50%; transform: translateX(-50%);
        z-index: 100003; background: rgba(212,160,23,.92); color: #10131c;
        font-family: var(--font, sans-serif); font-size: 11px; font-weight: 800;
        padding: 7px 18px; border-radius: 999px; box-shadow: 0 8px 24px rgba(0,0,0,.4);
        letter-spacing: .4px; cursor: pointer;
      }
      body.presentation-mode #fpPresentBanner { display: block; }
      /* bouton header */
      #fpPresentBtn.on { background: var(--accent) !important; color: #10131c !important; }
    `;
    document.head.appendChild(st);
  }

  function toggle(force) {
    injectCss();
    const on = typeof force === 'boolean' ? force : !document.body.classList.contains('presentation-mode');
    document.body.classList.toggle('presentation-mode', on);
    document.getElementById('fpPresentBtn')?.classList.toggle('on', on);
    // v7.03 — le mode présentation grossit la typo (zoom) : à l'entrée comme à
    // la sortie, la carte Leaflet doit recalculer sa taille, sinon elle reste
    // mal dimensionnée (0 px) et les marqueurs concurrents ne s'affichent plus.
    try { setTimeout(() => window._fpMap?.invalidateSize?.(true), 360); } catch {}
    if (on && !document.getElementById('fpPresentBanner')) {
      const b = document.createElement('div');
      b.id = 'fpPresentBanner';
      b.textContent = '🎥 Mode présentation — Échap ou clic ici pour sortir';
      b.onclick = () => toggle(false);
      document.body.appendChild(b);
    }
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.body.classList.contains('presentation-mode')) toggle(false);
  });

  // ── Bouton 🎥 dans le header (desktop uniquement) ──
  function installButton(tries) {
    if (window.innerWidth <= 768) return;
    if (document.getElementById('fpPresentBtn')) return;
    // point d'ancrage : à côté du sélecteur de langue EN dans le header
    const anchor = document.getElementById('fpDesktopLocale');
    const host = anchor?.parentElement;
    if (!host) { if ((tries || 0) < 20) setTimeout(() => installButton((tries || 0) + 1), 400); return; }
    const btn = document.createElement('button');
    btn.id = 'fpPresentBtn';
    btn.title = 'Mode présentation investisseur — grossit la typographie, masque les curseurs et contrôles techniques (Échap pour sortir)';
    btn.textContent = '🎥';
    btn.style.cssText = 'margin-left:6px;width:30px;height:30px;border-radius:8px;border:1px solid var(--border);background:var(--card3);color:var(--white);cursor:pointer;font-size:13px;vertical-align:middle';
    btn.onclick = () => toggle();
    anchor.insertAdjacentElement('afterend', btn);
  }
  if (document.readyState === 'complete') installButton(0);
  else window.addEventListener('load', () => installButton(0));

  window.PresentationMode = { toggle };
})();
