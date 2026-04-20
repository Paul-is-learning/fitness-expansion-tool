// ================================================================
// FITNESS PARK ROMANIA — ONBOARDING TOUR (Apple premium)
// ================================================================
// Standalone single-file tour. No build step. Loads BEFORE mobile.js.
//
// Public API:
//   window.startOnboardingTour()
//   window.maybeStartOnboardingTour(userId)
//   window.resetOnboardingTour(userId?)
//
// Behavior:
//   - Runs on the first 10 logins per user per device (localStorage counter).
//   - Dismiss via "Passer" (inline confirm "Sûr ? Oui/Non" with 3.5s rollback)
//     or Escape key (direct dismiss).
//   - 8 slides with live animated demos tailored to the FP Romania tool.
//   - Keyboard: ← → navigate, Esc dismiss.
//   - Touch: horizontal swipe on card.
//   - Haptic: navigator.vibrate on state changes, micro-pop fallback on iOS.
//   - iOS-safe scroll lock (position:fixed body + scrollY restore).
// ================================================================

(function () {
  'use strict';

  // ─── Constants ────────────────────────────────────────────────
  const MAX_RUNS = 10;
  const KEY_PREFIX = 'fpOnbTour:';    // localStorage key per user id
  // Nombre de slides du tour courant. Dynamique depuis v6.19 pour supporter
  // plusieurs tours (onboarding, BP cible pays, sources de données).
  let SLIDE_COUNT = 8;
  let activeSlides = null;  // Pointeur vers le set de slides actif (SLIDES|SLIDES_BP|...)
  const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

  // ─── Counter ──────────────────────────────────────────────────
  function counterKey(userId) { return KEY_PREFIX + (userId || 'anonymous'); }
  function getCount(userId) {
    try { return parseInt(localStorage.getItem(counterKey(userId)) || '0', 10) || 0; }
    catch { return 0; }
  }
  function bumpCount(userId) {
    try { localStorage.setItem(counterKey(userId), String(getCount(userId) + 1)); }
    catch {}
  }
  function resetCount(userId) {
    try {
      if (userId) localStorage.removeItem(counterKey(userId));
      else {
        // Reset all
        Object.keys(localStorage).forEach(k => k.startsWith(KEY_PREFIX) && localStorage.removeItem(k));
      }
    } catch {}
  }

  // ─── Haptic (vibrate + iOS fallback) ──────────────────────────
  function haptic(pattern) {
    try {
      if (!IS_IOS && navigator.vibrate) {
        navigator.vibrate(pattern);
      } else {
        // iOS fallback — micro pop on the card
        const card = document.querySelector('.fp-onb-card');
        if (!card) return;
        card.classList.add('fp-onb-pop');
        setTimeout(() => card.classList.remove('fp-onb-pop'), 220);
      }
    } catch {}
  }

  // ─── iOS-safe scroll lock ─────────────────────────────────────
  let savedScrollY = 0;
  let savedBodyStyles = null;
  function lockScroll() {
    savedScrollY = window.scrollY || window.pageYOffset || 0;
    savedBodyStyles = {
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
      overflow: document.body.style.overflow,
    };
    document.body.style.position = 'fixed';
    document.body.style.top = '-' + savedScrollY + 'px';
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';
  }
  function unlockScroll() {
    if (savedBodyStyles == null) return;
    Object.assign(document.body.style, savedBodyStyles);
    window.scrollTo(0, savedScrollY);
    savedBodyStyles = null;
  }

  // ─── Styles ───────────────────────────────────────────────────
  const STYLES = `
    .fp-onb-overlay {
      position: fixed; inset: 0;
      z-index: 100000;
      display: flex; align-items: center; justify-content: center;
      padding: max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left));
      background: radial-gradient(circle at var(--onb-bg1-x,30%) 20%, rgba(212,160,23,.18), transparent 60%),
                  radial-gradient(circle at var(--onb-bg2-x,70%) 80%, rgba(139,92,246,.15), transparent 60%),
                  rgba(6,8,15,.86);
      backdrop-filter: blur(28px) saturate(1.5);
      -webkit-backdrop-filter: blur(28px) saturate(1.5);
      pointer-events: none;
      transition: background .7s ease-out;
      overflow: hidden;
    }
    .fp-onb-overlay.open { pointer-events: auto; }

    .fp-onb-progress {
      position: absolute; top: max(10px, env(safe-area-inset-top)); left: 16px; right: 16px;
      height: 3px; border-radius: 2px;
      background: rgba(255,255,255,.08);
      overflow: hidden;
    }
    .fp-onb-progress-bar {
      height: 100%;
      background: linear-gradient(90deg, var(--onb-tint,#d4a017), color-mix(in srgb, var(--onb-tint,#d4a017) 70%, white 30%));
      box-shadow: 0 0 12px color-mix(in srgb, var(--onb-tint,#d4a017) 70%, transparent);
      width: 0%;
      transition: width .55s cubic-bezier(.22,.96,.36,1), background .6s;
      border-radius: 2px;
    }

    .fp-onb-card {
      width: min(480px, 100%);
      max-height: calc(100dvh - 48px);
      max-height: calc(100vh - 48px);
      display: flex; flex-direction: column;
      background: linear-gradient(180deg, rgba(24,30,46,.88) 0%, rgba(14,18,30,.92) 100%);
      border: 1px solid rgba(255,255,255,.06);
      border-radius: 32px;
      padding: 28px 26px 22px;
      box-shadow:
        0 30px 80px rgba(0,0,0,.55),
        0 1px 0 rgba(255,255,255,.08) inset,
        0 0 0 1px color-mix(in srgb, var(--onb-tint,#d4a017) 18%, transparent) inset;
      transition: box-shadow .6s;
    }

    .fp-onb-card.fp-onb-pop { animation: fpOnbPop .22s cubic-bezier(.34,1.6,.52,1); }
    @keyframes fpOnbPop { 0%,100% { transform: scale(1); } 50% { transform: scale(1.012); } }

    .fp-onb-close {
      position: absolute; top: 16px; right: 18px;
      width: 36px; height: 36px; border-radius: 50%;
      background: rgba(255,255,255,.06);
      border: 1px solid rgba(255,255,255,.08);
      color: rgba(255,255,255,.55);
      font-size: 16px; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: background .2s, color .2s, transform .15s;
      z-index: 10;
    }
    .fp-onb-close:hover { background: rgba(255,255,255,.1); color: rgba(255,255,255,.9); }
    .fp-onb-close:active { transform: scale(.92); }

    .fp-onb-slide {
      display: flex; flex-direction: column;
      gap: 14px;
    }
    .fp-onb-eyebrow {
      display: inline-block;
      font-size: 11px; font-weight: 700; letter-spacing: 1.4px;
      text-transform: uppercase;
      color: color-mix(in srgb, var(--onb-tint,#d4a017) 80%, white 20%);
      padding: 5px 10px;
      background: color-mix(in srgb, var(--onb-tint,#d4a017) 14%, transparent);
      border: 1px solid color-mix(in srgb, var(--onb-tint,#d4a017) 22%, transparent);
      border-radius: 999px;
      align-self: flex-start;
    }
    .fp-onb-title {
      font-size: 26px; font-weight: 900;
      letter-spacing: -.5px;
      line-height: 1.15;
      background: linear-gradient(135deg, #fff 0%, color-mix(in srgb, var(--onb-tint,#d4a017) 65%, #fff 35%) 100%);
      -webkit-background-clip: text; background-clip: text;
      -webkit-text-fill-color: transparent; color: transparent;
    }
    .fp-onb-subtitle {
      font-size: 14px; font-weight: 500;
      line-height: 1.55;
      color: rgba(255,255,255,.68);
    }

    .fp-onb-demo {
      margin: 10px 0 8px;
      min-height: 170px;
      display: flex; align-items: center; justify-content: center;
      position: relative;
    }

    .fp-onb-dots {
      display: flex; align-items: center; justify-content: center;
      gap: 7px;
      margin-top: 10px;
    }
    .fp-onb-dot {
      width: 6px; height: 6px; border-radius: 3px;
      background: rgba(255,255,255,.2);
      transition: width .35s cubic-bezier(.34,1.6,.52,1), background .3s, box-shadow .3s;
    }
    .fp-onb-dot.active {
      width: 22px;
      background: var(--onb-tint,#d4a017);
      box-shadow: 0 0 10px color-mix(in srgb, var(--onb-tint,#d4a017) 70%, transparent);
    }

    .fp-onb-actions {
      display: flex; align-items: center; justify-content: space-between;
      gap: 12px;
      margin-top: 16px;
    }
    .fp-onb-btn-skip {
      flex: 0 0 auto;
      background: transparent;
      border: none;
      color: rgba(255,255,255,.55);
      font-size: 13px; font-weight: 600;
      padding: 10px 4px;
      cursor: pointer;
      letter-spacing: .2px;
    }
    .fp-onb-btn-skip:hover { color: rgba(255,255,255,.85); }
    .fp-onb-btn-next {
      flex: 1;
      min-height: 46px;
      padding: 0 22px;
      background: linear-gradient(135deg, var(--onb-tint,#d4a017) 0%, color-mix(in srgb, var(--onb-tint,#d4a017) 75%, white 25%) 100%);
      border: none; border-radius: 14px;
      color: #0a0d17;
      font-family: inherit;
      font-size: 15px; font-weight: 800;
      letter-spacing: .2px;
      cursor: pointer;
      box-shadow: 0 8px 22px color-mix(in srgb, var(--onb-tint,#d4a017) 40%, transparent),
                  inset 0 1px 0 rgba(255,255,255,.3);
      transition: transform .2s cubic-bezier(.34,1.6,.52,1), box-shadow .2s, background .5s;
      display: flex; align-items: center; justify-content: center; gap: 8px;
    }
    .fp-onb-btn-next:active { transform: scale(.97); }
    .fp-onb-btn-next svg { width: 16px; height: 16px; stroke: #0a0d17; stroke-width: 3; fill: none; }

    /* Skip confirm inline */
    .fp-onb-skip-confirm {
      display: flex; align-items: center; gap: 10px;
      font-size: 12px; color: rgba(255,255,255,.75);
    }
    .fp-onb-skip-confirm strong { color: rgba(255,255,255,.92); font-weight: 700; }
    .fp-onb-skip-confirm button {
      background: rgba(255,255,255,.06);
      border: 1px solid rgba(255,255,255,.12);
      color: rgba(255,255,255,.9);
      font-size: 11px; font-weight: 700;
      padding: 5px 11px; border-radius: 8px;
      cursor: pointer;
      transition: background .15s;
    }
    .fp-onb-skip-confirm button.yes { background: rgba(239,68,68,.2); border-color: rgba(239,68,68,.4); }
    .fp-onb-skip-confirm button.no  { background: rgba(212,160,23,.12); border-color: rgba(212,160,23,.3); }
    .fp-onb-skip-confirm button:hover { filter: brightness(1.15); }

    /* ═══ Slide transitions ═══ */
    /* Slides stack dans un grid-cell commun : la cellule prend la hauteur du
       plus grand slide, donc le wrap s'auto-dimensionne sans JS de sync. */
    .fp-onb-slide {
      grid-column: 1;
      grid-row: 1;
      opacity: 0;
      pointer-events: none;
      transform: translateX(0);
      transition: opacity .35s ease-out, transform .45s cubic-bezier(.22,.96,.36,1);
      min-width: 0;
    }
    .fp-onb-slide.active { opacity: 1; pointer-events: auto; transform: translateX(0); }
    .fp-onb-slide.leaving-left  { opacity: 0; transform: translateX(-34px); pointer-events: none; }
    .fp-onb-slide.leaving-right { opacity: 0; transform: translateX(34px); pointer-events: none; }
    .fp-onb-slide.entering-left  { opacity: 0; transform: translateX(-34px); pointer-events: none; }
    .fp-onb-slide.entering-right { opacity: 0; transform: translateX(34px); pointer-events: none; }

    .fp-onb-slides-wrap {
      position: relative;
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      flex: 0 1 auto;
      min-height: 220px;
      overflow-y: auto;
      overflow-x: hidden;
      max-height: calc(100dvh - 200px);
      max-height: calc(100vh - 200px);
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
    }
    .fp-onb-slides-wrap::-webkit-scrollbar { display: none; }

    /* ═══ DEMO: Welcome logo stroke-draw + sparks ═══ */
    /* Logo slide BIENVENUE: fade-in + scale à l'entrée */
    .fp-onb-demo-welcome .fp-onb-welcome-stack img {
      opacity: 0;
      transform: translateY(6px) scale(.94);
      transition: opacity .6s ease, transform .7s cubic-bezier(.34,1.56,.52,1);
    }
    .fp-onb-slide.active.ready .fp-onb-demo-welcome .fp-onb-welcome-stack img {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
    .fp-onb-slide.active.ready .fp-onb-demo-welcome .fp-onb-welcome-stack img:nth-of-type(2) {
      transition-delay: .18s;
    }
    .fp-onb-demo-welcome svg { width: 160px; height: 160px; overflow: visible; }
    .fp-onb-demo-welcome .logo-stroke {
      stroke-dasharray: 420;
      stroke-dashoffset: 420;
    }
    .fp-onb-slide.ready .fp-onb-demo-welcome .logo-stroke {
      animation: fpOnbStroke 1.4s cubic-bezier(.6,0,.4,1) forwards;
    }
    @keyframes fpOnbStroke {
      to { stroke-dashoffset: 0; }
    }
    .fp-onb-demo-welcome .spark {
      opacity: 0; transform-origin: 80px 80px;
    }
    .fp-onb-slide.ready .fp-onb-demo-welcome .spark {
      animation: fpOnbSpark 1.6s cubic-bezier(.34,1.6,.52,1) forwards;
    }
    @keyframes fpOnbSpark {
      0%   { opacity: 0; transform: scale(.2) rotate(0); }
      50%  { opacity: 1; transform: scale(1) rotate(30deg); }
      100% { opacity: 0; transform: scale(1.4) rotate(60deg); }
    }

    /* ═══ DEMO: Pins cascade ═══ */
    .fp-onb-demo-pins {
      width: 100%; max-width: 360px;
      height: 170px;
      background:
        radial-gradient(ellipse at 40% 45%, rgba(212,160,23,.08), transparent 55%),
        linear-gradient(135deg, #141a2a 0%, #0e1321 100%);
      border: 1px solid rgba(255,255,255,.06);
      border-radius: 18px;
      position: relative;
      overflow: hidden;
    }
    .fp-onb-demo-pins::before {
      content: ''; position: absolute; inset: 0;
      background-image:
        linear-gradient(90deg, rgba(255,255,255,.03) 1px, transparent 1px),
        linear-gradient(rgba(255,255,255,.03) 1px, transparent 1px);
      background-size: 18px 18px;
      mask: radial-gradient(circle, black 0%, transparent 75%);
    }
    .fp-onb-demo-pins .pin {
      position: absolute;
      width: 26px; height: 26px; border-radius: 50%;
      background: linear-gradient(135deg, var(--onb-tint,#d4a017), color-mix(in srgb, var(--onb-tint,#d4a017) 70%, #000 30%));
      color: #0a0d17; font-weight: 900; font-size: 12px;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 6px 16px color-mix(in srgb, var(--onb-tint,#d4a017) 50%, transparent),
                  0 0 0 3px rgba(0,0,0,.3) inset;
      transform: translate(-50%, -50%);
      opacity: 1;
    }
    .fp-onb-slide.ready .fp-onb-demo-pins .pin {
      animation: fpOnbPinPop .6s cubic-bezier(.34,1.6,.52,1);
    }
    .fp-onb-slide.ready .fp-onb-demo-pins .pin:nth-child(1) { animation-delay: .0s; }
    .fp-onb-slide.ready .fp-onb-demo-pins .pin:nth-child(2) { animation-delay: .12s; }
    .fp-onb-slide.ready .fp-onb-demo-pins .pin:nth-child(3) { animation-delay: .24s; }
    .fp-onb-slide.ready .fp-onb-demo-pins .pin:nth-child(4) { animation-delay: .36s; }
    .fp-onb-slide.ready .fp-onb-demo-pins .pin:nth-child(5) { animation-delay: .48s; }
    @keyframes fpOnbPinPop {
      0%   { opacity: 0; transform: translate(-50%, -50%) scale(0); }
      60%  { opacity: 1; transform: translate(-50%, -50%) scale(1.18); }
      100% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
    }

    /* ═══ DEMO: Sliders (live) ═══ */
    .fp-onb-demo-sliders { width: 100%; max-width: 360px; display: flex; flex-direction: column; gap: 14px; }
    .fp-onb-demo-sliders .row {
      display: grid; grid-template-columns: 74px 1fr auto; gap: 10px; align-items: center;
      font-size: 11px; color: rgba(255,255,255,.65);
    }
    .fp-onb-demo-sliders .track {
      position: relative; height: 4px; border-radius: 2px;
      background: rgba(255,255,255,.08);
      overflow: visible;
    }
    .fp-onb-demo-sliders .fill {
      position: absolute; left: 0; top: 0; bottom: 0; border-radius: 2px;
      background: var(--onb-tint,#d4a017);
      /* Animation: slide from 0% to target à l'entrée du slide */
      width: 0%;
    }
    .fp-onb-demo-sliders .thumb {
      position: absolute; top: 50%; width: 14px; height: 14px; border-radius: 50%;
      background: white;
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--onb-tint,#d4a017) 40%, transparent), 0 2px 6px rgba(0,0,0,.4);
      transform: translate(-50%, -50%);
      left: 0%;
    }
    /* Play animation quand le slide est actif + ready */
    .fp-onb-slide.active.ready .fp-onb-demo-sliders .fill {
      animation: fpOnbSliderFill 1s cubic-bezier(.34,1.12,.52,1) forwards;
    }
    .fp-onb-slide.active.ready .fp-onb-demo-sliders .thumb {
      animation: fpOnbSliderThumb 1s cubic-bezier(.34,1.12,.52,1) forwards;
    }
    /* Stagger entre les 3 sliders pour un effet cascade (120ms delta) */
    .fp-onb-slide.active.ready .fp-onb-demo-sliders .row:nth-child(1) .fill,
    .fp-onb-slide.active.ready .fp-onb-demo-sliders .row:nth-child(1) .thumb { animation-delay: .0s; }
    .fp-onb-slide.active.ready .fp-onb-demo-sliders .row:nth-child(2) .fill,
    .fp-onb-slide.active.ready .fp-onb-demo-sliders .row:nth-child(2) .thumb { animation-delay: .12s; }
    .fp-onb-slide.active.ready .fp-onb-demo-sliders .row:nth-child(3) .fill,
    .fp-onb-slide.active.ready .fp-onb-demo-sliders .row:nth-child(3) .thumb { animation-delay: .24s; }
    @keyframes fpOnbSliderFill {
      0%   { width: 0%; }
      100% { width: var(--fill-target, 40%); }
    }
    @keyframes fpOnbSliderThumb {
      0%   { left: 0%; }
      100% { left: var(--fill-target, 40%); }
    }
    /* "Pulse" subtil sur le thumb juste après le passage (valeur verrouillée) */
    .fp-onb-slide.active.ready .fp-onb-demo-sliders .thumb::before {
      content: ''; position: absolute; inset: -4px; border-radius: 50%;
      border: 2px solid var(--onb-tint,#d4a017);
      opacity: 0;
      animation: fpOnbThumbPulse 1s ease-out 1.1s 2 both;
    }
    @keyframes fpOnbThumbPulse {
      0%   { opacity: .6; transform: scale(.8); }
      100% { opacity: 0;  transform: scale(2); }
    }
    .fp-onb-demo-sliders .val {
      font-weight: 800; color: color-mix(in srgb, var(--onb-tint,#d4a017) 70%, white 30%);
      font-variant-numeric: tabular-nums;
      min-width: 52px; text-align: right;
    }
    .fp-onb-demo-sliders .irr-card {
      margin-top: 6px;
      padding: 12px 14px;
      background: linear-gradient(135deg, rgba(52,211,153,.1), rgba(52,211,153,.02));
      border: 1px solid rgba(52,211,153,.3);
      border-radius: 12px;
      display: flex; align-items: center; justify-content: space-between;
    }
    .fp-onb-demo-sliders .irr-card .l { font-size: 10px; text-transform: uppercase; letter-spacing: .6px; color: rgba(255,255,255,.55); font-weight: 700; }
    .fp-onb-demo-sliders .irr-card .v { font-size: 22px; font-weight: 900; color: #34d399; font-variant-numeric: tabular-nums; }

    /* ═══ DEMO: SAZ radial 3 rings ═══ */
    .fp-onb-demo-saz { position: relative; width: 180px; height: 180px; }
    .fp-onb-demo-saz svg { transform: rotate(-90deg); }
    .fp-onb-demo-saz .ring {
      fill: none;
      stroke-width: 9;
      stroke-linecap: round;
      /* Ring full au repos, se "dessine" vers --dashoffset quand .ready */
      stroke-dashoffset: var(--perim, 1000);
      transition: stroke-dashoffset 1.1s cubic-bezier(.34,1.12,.52,1);
    }
    .fp-onb-slide.active.ready .fp-onb-demo-saz .ring {
      stroke-dashoffset: var(--dashoffset, 400);
    }
    .fp-onb-slide.active.ready .fp-onb-demo-saz .ring.r1 { transition-delay: .0s; }
    .fp-onb-slide.active.ready .fp-onb-demo-saz .ring.r2 { transition-delay: .15s; }
    .fp-onb-slide.active.ready .fp-onb-demo-saz .ring.r3 { transition-delay: .3s; }
    .fp-onb-demo-saz .score {
      position: absolute; inset: 0;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      font-variant-numeric: tabular-nums;
    }
    .fp-onb-demo-saz .score .n {
      font-size: 40px; font-weight: 900;
      color: var(--onb-tint,#d4a017);
      line-height: 1;
    }
    .fp-onb-demo-saz .score .s {
      font-size: 10px; text-transform: uppercase; letter-spacing: 1px;
      color: rgba(255,255,255,.5); font-weight: 700;
      margin-top: 4px;
    }

    /* ═══ DEMO: P&L 3 scenarios cards ═══ */
    .fp-onb-demo-pnl { width: 100%; display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .fp-onb-demo-pnl .s {
      padding: 10px 8px 12px;
      background: rgba(30,41,59,.55);
      border-radius: 12px;
      border-top: 2px solid var(--c, #d4a017);
    }
    .fp-onb-demo-pnl .s .lbl {
      font-size: 8px; font-weight: 800; letter-spacing: .6px;
      text-transform: uppercase; color: var(--c, #d4a017);
    }
    .fp-onb-demo-pnl .s .irr {
      margin-top: 8px;
      font-size: 20px; font-weight: 900;
      color: #fff;
      font-variant-numeric: tabular-nums;
    }
    .fp-onb-demo-pnl .s .bar {
      margin-top: 6px; height: 4px; border-radius: 2px;
      background: rgba(255,255,255,.08);
      overflow: hidden;
    }
    .fp-onb-demo-pnl .s .fill {
      height: 100%;
      background: var(--c, #d4a017);
      width: 0%;
    }
    /* Anim: fill bars grandissent de 0 à target en cascade à l'entrée du slide */
    .fp-onb-slide.active.ready .fp-onb-demo-pnl .s .fill {
      animation: fpOnbPnlBar 1.1s cubic-bezier(.34,1.12,.52,1) forwards;
    }
    .fp-onb-slide.active.ready .fp-onb-demo-pnl .s:nth-child(1) .fill { animation-delay: .0s; }
    .fp-onb-slide.active.ready .fp-onb-demo-pnl .s:nth-child(2) .fill { animation-delay: .15s; }
    .fp-onb-slide.active.ready .fp-onb-demo-pnl .s:nth-child(3) .fill { animation-delay: .3s; }
    @keyframes fpOnbPnlBar {
      0%   { width: 0%; }
      100% { width: var(--fill, 50%); }
    }

    /* ═══ DEMO: Financing equity/loan ═══ */
    .fp-onb-demo-fin { width: 100%; max-width: 380px; }
    .fp-onb-demo-fin .bar {
      height: 32px; border-radius: 10px; overflow: hidden;
      display: flex;
      box-shadow: 0 4px 14px rgba(0,0,0,.4);
    }
    .fp-onb-demo-fin .eq, .fp-onb-demo-fin .ln {
      display: flex; align-items: center; justify-content: center;
      color: white; font-size: 11px; font-weight: 800; letter-spacing: .4px;
    }
    .fp-onb-demo-fin .eq {
      background: linear-gradient(90deg, #34d399, #10b981);
      color: #052e1c;
      width: 0%;
    }
    .fp-onb-demo-fin .ln {
      background: linear-gradient(90deg, #60a5fa, #3b82f6);
      width: 0%;
    }
    /* Anim: equity et loan grandissent simultanément jusqu'à leur part finale */
    .fp-onb-slide.active.ready .fp-onb-demo-fin .eq {
      animation: fpOnbFinEq 1s cubic-bezier(.34,1.12,.52,1) forwards;
    }
    .fp-onb-slide.active.ready .fp-onb-demo-fin .ln {
      animation: fpOnbFinLn 1s cubic-bezier(.34,1.12,.52,1) forwards;
      animation-delay: .15s;
    }
    @keyframes fpOnbFinEq { 0% { width: 0%; } 100% { width: 30%; } }
    @keyframes fpOnbFinLn { 0% { width: 0%; } 100% { width: 70%; } }
    .fp-onb-demo-fin .stats {
      margin-top: 14px;
      display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
    }
    .fp-onb-demo-fin .stat {
      padding: 12px; border-radius: 12px;
      background: rgba(30,41,59,.55);
      border: 1px solid rgba(255,255,255,.06);
    }
    .fp-onb-demo-fin .stat.levered { border-color: color-mix(in srgb, var(--onb-tint,#d4a017) 40%, transparent); }
    .fp-onb-demo-fin .stat .l {
      font-size: 9px; letter-spacing: .5px; text-transform: uppercase;
      color: rgba(255,255,255,.55); font-weight: 700;
    }
    .fp-onb-demo-fin .stat .v {
      margin-top: 6px;
      font-size: 22px; font-weight: 900;
      font-variant-numeric: tabular-nums;
      color: #34d399;
    }
    .fp-onb-demo-fin .stat.levered .v { color: var(--onb-tint,#d4a017); }

    /* ═══ DEMO: Phone mockup (add site) ═══ */
    .fp-onb-demo-phone {
      /* Taille réduite: l'ancien 136×230 dépassait la slides-wrap (280px)
         et recouvrait visuellement les boutons Passer/Suivant. */
      width: 112px; height: 180px;
      background: #0a0d17;
      border: 2px solid rgba(255,255,255,.12);
      border-radius: 20px;
      padding: 7px;
      transform: perspective(700px) rotateY(-12deg) rotateX(4deg);
      box-shadow: -12px 16px 40px rgba(0,0,0,.55),
                  0 0 0 1px rgba(255,255,255,.05) inset;
      position: relative;
    }
    .fp-onb-demo-phone::before {
      content: ''; position: absolute; top: 6px; left: 50%; transform: translateX(-50%);
      width: 40px; height: 4px; border-radius: 2px;
      background: #1f2937;
    }
    .fp-onb-demo-phone-screen {
      width: 100%; height: 100%;
      background: linear-gradient(135deg, #0f1422, #0a0d17);
      border-radius: 13px;
      padding: 14px 8px 8px;
      display: flex; flex-direction: column; gap: 8px;
      position: relative;
      overflow: hidden;
    }
    .fp-onb-demo-phone .search {
      background: rgba(30,41,59,.7);
      border: 1px solid rgba(212,160,23,.3);
      border-radius: 8px;
      padding: 5px 7px;
      font-size: 9px; color: rgba(255,255,255,.85);
      min-height: 18px;
      font-variant-numeric: tabular-nums;
      position: relative;
    }
    .fp-onb-demo-phone .search::after {
      content: ''; display: inline-block; width: 1px; height: 11px;
      background: color-mix(in srgb, var(--onb-tint,#d4a017) 80%, white 20%);
      margin-left: 2px;
      vertical-align: middle;
      animation: fpOnbCaret 1s steps(1) infinite;
    }
    @keyframes fpOnbCaret { 0%,49% { opacity: 1; } 50%,100% { opacity: 0; } }
    .fp-onb-demo-phone .hit {
      padding: 6px 7px;
      background: rgba(212,160,23,.1);
      border: 1px solid rgba(212,160,23,.35);
      border-radius: 8px;
      font-size: 9px; color: rgba(255,255,255,.9);
      font-weight: 600;
    }
    .fp-onb-demo-phone .drop {
      width: 12px; height: 12px; border-radius: 50%;
      background: var(--onb-tint,#d4a017);
      /* Positionné dans .phone-screen (overflow:hidden, position:relative).
         Reste toujours à l'intérieur de l'écran même avec la perspective 3D du phone. */
      position: absolute; bottom: 16px; left: 50%;
      transform: translate(-50%, 0);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--onb-tint,#d4a017) 30%, transparent);
    }
    @keyframes fpOnbDrop {
      0%   { opacity: 0; transform: translate(-50%, -80px) scale(.2); }
      60%  { opacity: 1; transform: translate(-50%, -10px) scale(1.3); }
      100% { opacity: 1; transform: translate(-50%, 0) scale(1); }
    }

    /* ═══ DEMO: Ready check + confetti ═══ */
    .fp-onb-demo-ready { position: relative; width: 170px; height: 170px; }
    .fp-onb-demo-ready .ring {
      fill: none;
      stroke: var(--onb-tint,#d4a017);
      stroke-width: 8; stroke-linecap: round;
    }
    .fp-onb-demo-ready .check {
      fill: none;
      stroke: var(--onb-tint,#d4a017);
      stroke-width: 10; stroke-linecap: round; stroke-linejoin: round;
    }
    .fp-onb-demo-ready .flash {
      position: absolute; inset: 0; border-radius: 50%;
      background: radial-gradient(circle, color-mix(in srgb, var(--onb-tint,#d4a017) 50%, transparent), transparent 70%);
      opacity: 0;
    }
    .fp-onb-slide.ready .fp-onb-demo-ready .flash {
      animation: fpOnbFlash 1.2s ease-out forwards;
      animation-delay: .9s;
    }
    @keyframes fpOnbFlash {
      0%   { opacity: 0; transform: scale(.8); }
      30%  { opacity: 1; transform: scale(1.3); }
      100% { opacity: 0; transform: scale(2); }
    }
    .fp-onb-confetti {
      position: absolute; inset: 0;
      pointer-events: none;
      overflow: visible;
    }
    .fp-onb-confetti span {
      position: absolute;
      top: 50%; left: 50%;
      width: 7px; height: 11px;
      border-radius: 2px;
      opacity: 0;
    }
    .fp-onb-slide.ready .fp-onb-confetti span {
      animation: fpOnbConfetti 1.4s cubic-bezier(.22,.96,.36,1) forwards;
      animation-delay: 1.1s;
    }
    @keyframes fpOnbConfetti {
      0%   { opacity: 0; transform: translate(-50%, -50%) rotate(0) scale(0); }
      20%  { opacity: 1; }
      100% { opacity: 0; transform: translate(calc(-50% + var(--dx,0px)), calc(-50% + var(--dy,0px))) rotate(var(--rot,0deg)) scale(1); }
    }

    /* ═══ Animations réutilisables pour tours BP + Sources ═══ */
    @keyframes fpOnbFadeIn      { to { opacity: 1; } }
    @keyframes fpOnbSlideIn     { to { opacity: 1; transform: translateX(0); } }
    @keyframes fpOnbBarGrow     { to { transform: scaleY(1); } }
    /* Bars demoBpRevenue : animation gated par .ready (sinon consumed au boot
       car toutes slides rendues simultanément en grid-stack v6.23) */
    .fp-onb-revenue-bar { transform: scaleY(0); transform-origin: bottom; }
    .fp-onb-slide.ready .fp-onb-revenue-bar {
      animation: fpOnbBarGrow .85s cubic-bezier(.34,1.36,.4,1) var(--bar-delay, 0s) forwards;
    }
    @keyframes fpOnbWidthGrow   { to { width: var(--w, 50%); } }
    @keyframes fpOnbCardIn      { to { opacity: 1; transform: translateY(0) scale(1); } }
    @keyframes fpOnbRingDraw    { to { stroke-dashoffset: var(--to, 0); } }
    @keyframes fpOnbRingDrawSmall { to { stroke-dashoffset: var(--to, 0); } }
    @keyframes fpOnbCheckDraw   { to { stroke-dashoffset: var(--to, 0); } }

    /* ═══ 2027 WOW : shimmer, sparkles, iridescent glass ═══ */
    @keyframes fpOnbShineSweep {
      0%   { transform: translateX(-120%) skewX(-18deg); opacity: 0; }
      30%  { opacity: 1; }
      70%  { opacity: 1; }
      100% { transform: translateX(260%) skewX(-18deg); opacity: 0; }
    }
    @keyframes fpOnbIridescent {
      0%,100% { background-position: 0% 50%; }
      50%     { background-position: 100% 50%; }
    }
    @keyframes fpOnbBreathe {
      0%,100% { transform: translateY(0) scale(1); }
      50%     { transform: translateY(-1px) scale(1.002); }
    }
    @keyframes fpOnbSparkle {
      0%   { opacity: 0; transform: translate(var(--sx,0), var(--sy,0)) scale(.2) rotate(0deg); }
      40%  { opacity: 1; transform: translate(calc(var(--sx,0) * .6), calc(var(--sy,0) * .6)) scale(1.1) rotate(120deg); }
      100% { opacity: 0; transform: translate(var(--sx,0), var(--sy,0)) scale(0) rotate(240deg); }
    }
    @keyframes fpOnbGlowPulse {
      0%,100% { box-shadow: 0 0 0 0 var(--glow-color, rgba(212,160,23,.45)); }
      50%     { box-shadow: 0 0 18px 4px var(--glow-color, rgba(212,160,23,.45)); }
    }
    @keyframes fpOnbBarShine {
      0%   { transform: translateX(-100%); opacity: 0; }
      30%  { opacity: .9; }
      100% { transform: translateX(120%); opacity: 0; }
    }
    @keyframes fpOnbBlurIn {
      0%   { opacity: 0; filter: blur(8px); transform: translateY(6px); }
      100% { opacity: 1; filter: blur(0); transform: translateY(0); }
    }

    /* Shimmer gold sweep on key numbers */
    .fp-onb-wow-num {
      position: relative;
      display: inline-block;
      background: linear-gradient(100deg, currentColor 0%, color-mix(in srgb, currentColor 60%, #fff 40%) 45%, currentColor 55%, currentColor 100%);
      background-size: 250% 100%;
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
      color: transparent;
      animation: fpOnbIridescent 3.2s ease-in-out infinite;
    }
    /* Iridescent border frame — subtle animated gradient */
    .fp-onb-wow-frame {
      position: relative;
      isolation: isolate;
    }
    .fp-onb-wow-frame::before {
      content: '';
      position: absolute; inset: -1px;
      border-radius: inherit;
      padding: 1px;
      background: linear-gradient(120deg,
        color-mix(in srgb, var(--onb-tint,#d4a017) 55%, transparent) 0%,
        rgba(255,255,255,.4) 30%,
        color-mix(in srgb, var(--onb-tint,#d4a017) 40%, transparent) 55%,
        rgba(167,139,250,.45) 80%,
        color-mix(in srgb, var(--onb-tint,#d4a017) 55%, transparent) 100%);
      background-size: 280% 100%;
      animation: fpOnbIridescent 4.5s ease-in-out infinite;
      -webkit-mask: linear-gradient(#000,#000) content-box, linear-gradient(#000,#000);
      -webkit-mask-composite: xor;
              mask-composite: exclude;
      pointer-events: none;
      opacity: 0; transition: opacity .6s ease;
    }
    .fp-onb-slide.ready .fp-onb-wow-frame::before { opacity: 1; }
    /* Bar shine overlay — sweeps left→right inside a filled bar */
    .fp-onb-wow-bar { position: relative; overflow: hidden; }
    .fp-onb-wow-bar::after {
      content: ''; position: absolute; inset: 0;
      background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,.55) 50%, transparent 100%);
      transform: translateX(-100%);
      pointer-events: none;
    }
    .fp-onb-slide.ready .fp-onb-wow-bar::after {
      animation: fpOnbBarShine 1.6s ease-out var(--shine-delay, 1s) infinite;
    }
    /* Glassy card with inner gloss */
    .fp-onb-wow-glass {
      background: linear-gradient(155deg,
        rgba(255,255,255,.07) 0%,
        rgba(255,255,255,.02) 50%,
        rgba(255,255,255,.05) 100%),
        rgba(24,30,46,.75);
      backdrop-filter: blur(12px) saturate(1.3);
      -webkit-backdrop-filter: blur(12px) saturate(1.3);
      border: 1px solid rgba(255,255,255,.08);
      box-shadow:
        0 12px 28px rgba(0,0,0,.35),
        inset 0 1px 0 rgba(255,255,255,.08),
        inset 0 -1px 0 rgba(0,0,0,.25);
    }
    /* Sparkle particle layer — positioned absolute inside its parent */
    .fp-onb-sparkles {
      position: absolute; inset: 0; pointer-events: none; overflow: visible;
    }
    .fp-onb-sparkles span {
      position: absolute; top: 50%; left: 50%;
      width: 6px; height: 6px;
      background: radial-gradient(circle, #fff 0%, color-mix(in srgb, var(--onb-tint,#d4a017) 80%, transparent) 55%, transparent 70%);
      border-radius: 50%;
      opacity: 0;
      filter: drop-shadow(0 0 4px color-mix(in srgb, var(--onb-tint,#d4a017) 80%, transparent));
    }
    .fp-onb-slide.ready .fp-onb-sparkles span {
      animation: fpOnbSparkle 1.8s cubic-bezier(.2,.9,.3,1.2) forwards;
    }
    /* Blur-in entrance for rows / cards when slide becomes ready */
    .fp-onb-blur-in { opacity: 0; transform: translateY(6px); filter: blur(6px); }
    .fp-onb-slide.ready .fp-onb-blur-in {
      animation: fpOnbBlurIn .55s cubic-bezier(.22,.96,.36,1) var(--blur-delay,0s) forwards;
    }

    /* ═══ Responsive ═══ */
    @media (max-width: 480px) {
      .fp-onb-card {
        padding: 22px 18px 16px;
        border-radius: 28px;
      }
      .fp-onb-title { font-size: 21px; line-height: 1.15; }
      .fp-onb-subtitle { font-size: 12.5px; line-height: 1.45; }
      .fp-onb-slide { gap: 11px; }
      /* Wrap auto-height : JS sync wrap.style.height sur scrollHeight du slide actif.
         flex:0 0 auto empêche le flex layout du card d'écraser la hauteur JS.
         overflow-y:auto + max-height garantit que dots+actions restent toujours
         visibles même quand le contenu dépasse la hauteur disponible du card. */
      .fp-onb-slides-wrap { min-height: 200px; max-height: calc(100dvh - 170px); max-height: calc(100vh - 170px); }
      .fp-onb-demo { min-height: 130px; margin: 6px 0 4px; }
      .fp-onb-demo-pins { height: 148px; }
      .fp-onb-demo-phone { width: 104px; height: 168px; }
      .fp-onb-demo-saz { width: 150px; height: 150px; }
      .fp-onb-demo-ready { width: 140px; height: 140px; }
      .fp-onb-btn-next { min-height: 44px; font-size: 14px; }
      .fp-onb-actions { margin-top: 12px; }
      .fp-onb-dots { margin-top: 8px; }
      /* Sliders demo: labels + values compacts pour ne pas déborder sur 375px */
      .fp-onb-demo-sliders { max-width: 100%; }
      .fp-onb-demo-sliders .row {
        grid-template-columns: 56px 1fr minmax(60px, auto);
        gap: 8px; font-size: 10px;
      }
      .fp-onb-demo-sliders .val { min-width: 0; font-size: 10.5px; }
      .fp-onb-demo-sliders .irr-card { padding: 10px 12px; }
      .fp-onb-demo-sliders .irr-card .v { font-size: 18px; }

      /* ═══ Mobile density pour tours BP + Sources ═══ */
      /* BP assumptions rows */
      .fp-onb-bp-row {
        padding: 6px 10px !important;
        grid-template-columns: 1fr auto !important;
      }
      .fp-onb-bp-row .lbl { font-size: 10.5px !important; }
      .fp-onb-bp-row .sub { font-size: 8.5px !important; }
      .fp-onb-bp-row .val { font-size: 12.5px !important; }
      /* BP costs rows */
      .fp-onb-bp-cost-row .name { font-size: 10px !important; }
      .fp-onb-bp-cost-row .pct { font-size: 10px !important; }
      .fp-onb-bp-cost-row .note { font-size: 7.5px !important; line-height: 1.25 !important; }
      .fp-onb-bp-cost-row .bar { height: 3.5px !important; }
      /* Sources demo cards : grid 2x3 au lieu de 3x2 sur très petit écran */
      .fp-onb-data-grid { grid-template-columns: repeat(3, 1fr) !important; gap: 6px !important; }
      .fp-onb-data-grid .card { padding: 8px 4px !important; }
      .fp-onb-data-grid .icon { font-size: 18px !important; }
      .fp-onb-data-grid .name { font-size: 9.5px !important; }
      .fp-onb-data-grid .desc { font-size: 8px !important; line-height: 1.2 !important; }
      /* Sources pop cards stack compact */
      .fp-onb-data-pop .card { padding: 9px 11px !important; }
      .fp-onb-data-pop .eyebrow { font-size: 8.5px !important; }
      .fp-onb-data-pop .val { font-size: 18px !important; }
      .fp-onb-data-pop .unit { font-size: 10px !important; }
      .fp-onb-data-pop .sub { font-size: 8.5px !important; }
      /* Concurrents list + Immo list */
      .fp-onb-data-list .row { grid-template-columns: 72px 1fr 36px !important; gap: 6px !important; }
      .fp-onb-data-list .name { font-size: 10px !important; }
      .fp-onb-data-list .n { font-size: 10px !important; }
      .fp-onb-data-list .bar { height: 8px !important; }
      /* Flux cards 2x2 → tighter */
      .fp-onb-data-flux .card { padding: 8px !important; }
      .fp-onb-data-flux .eyebrow { font-size: 8.5px !important; }
      .fp-onb-data-flux .val { font-size: 14px !important; }
      /* Monte Carlo histogram — réduire cap */
      .fp-onb-bp-mc .hist { height: 88px !important; }
      .fp-onb-bp-mc .stats { padding: 7px 9px !important; }
      .fp-onb-bp-mc .stats .lbl { font-size: 8px !important; }
      .fp-onb-bp-mc .stats .v { font-size: 12px !important; }
      .fp-onb-bp-mc .cap { font-size: 8.5px !important; line-height: 1.3 !important; }
      /* Intro BP stats grid */
      .fp-onb-demo-bp-stats > div { padding: 8px 4px !important; }
      .fp-onb-demo-bp-stats > div > div:first-child { font-size: 16px !important; }
      .fp-onb-demo-bp-stats > div > div:last-child { font-size: 7.5px !important; }
      /* Capex stats compact */
      .fp-onb-bp-capex-legend { font-size: 10px !important; }
      .fp-onb-bp-capex-legend .sub { font-size: 8.5px !important; }
    }

    /* ═══ Reduced motion ═══ */
    @media (prefers-reduced-motion: reduce) {
      .fp-onb-overlay, .fp-onb-card, .fp-onb-slide, .fp-onb-eyebrow, .fp-onb-title, .fp-onb-subtitle,
      .fp-onb-demo-welcome .logo-stroke, .fp-onb-demo-welcome .spark,
      .fp-onb-demo-pins .pin, .fp-onb-demo-sliders .fill, .fp-onb-demo-sliders .thumb,
      .fp-onb-demo-saz .ring, .fp-onb-demo-pnl .s, .fp-onb-demo-pnl .s .fill,
      .fp-onb-demo-fin .eq, .fp-onb-demo-fin .ln,
      .fp-onb-demo-phone .hit, .fp-onb-demo-phone .drop,
      .fp-onb-demo-ready .ring, .fp-onb-demo-ready .check, .fp-onb-demo-ready .flash,
      .fp-onb-confetti span {
        animation: none !important;
        transition: none !important;
        opacity: 1 !important;
        stroke-dashoffset: 0 !important;
        transform: none !important;
        width: var(--fill-target, 100%) !important;
      }
    }

    /* ═══ Dark-by-default (this tool is always dark) — keeps fine in body.dark too ═══ */
    body.light .fp-onb-card {
      background: linear-gradient(180deg, rgba(255,255,255,.95) 0%, rgba(245,247,252,.98) 100%);
      border-color: rgba(0,0,0,.08);
    }
  `;

  function ensureStyles() {
    if (document.getElementById('fp-onb-styles')) return;
    const s = document.createElement('style');
    s.id = 'fp-onb-styles';
    s.textContent = STYLES;
    document.head.appendChild(s);
  }

  // ─── Slide definitions ────────────────────────────────────────
  // Les champs eyebrow/title/subtitle/cta sont des clés i18n résolues via
  // tr() au moment du render (support FR/EN dynamique). Les dictionnaires
  // sont dans src/i18n.js sous 'tour.s{1-8}.*'.
  const tr = (k) => (typeof window.t === 'function' ? window.t(k) : k);
  const SLIDES = [
    { tint: '#d4a017', eyebrow: 'tour.s1.eyebrow', title: 'tour.s1.title', subtitle: 'tour.s1.subtitle', demo: demoWelcome, cta: 'tour.s1.cta' },
    { tint: '#d4a017', eyebrow: 'tour.s2.eyebrow', title: 'tour.s2.title', subtitle: 'tour.s2.subtitle', demo: demoPins,    cta: 'tour.cta.next' },
    { tint: '#34d399', eyebrow: 'tour.s3.eyebrow', title: 'tour.s3.title', subtitle: 'tour.s3.subtitle', demo: demoSliders, cta: 'tour.cta.next' },
    { tint: '#60a5fa', eyebrow: 'tour.s4.eyebrow', title: 'tour.s4.title', subtitle: 'tour.s4.subtitle', demo: demoSaz,     cta: 'tour.cta.next' },
    { tint: '#f97316', eyebrow: 'tour.s5.eyebrow', title: 'tour.s5.title', subtitle: 'tour.s5.subtitle', demo: demoPnl,     cta: 'tour.cta.next' },
    { tint: '#d4a017', eyebrow: 'tour.s6.eyebrow', title: 'tour.s6.title', subtitle: 'tour.s6.subtitle', demo: demoFinancing, cta: 'tour.cta.next' },
    { tint: '#a78bfa', eyebrow: 'tour.s7.eyebrow', title: 'tour.s7.title', subtitle: 'tour.s7.subtitle', demo: demoPhone,   cta: 'tour.cta.next' },
    { tint: '#22c55e', eyebrow: 'tour.s8.eyebrow', title: 'tour.s8.title', subtitle: 'tour.s8.subtitle', demo: demoReady,   cta: 'tour.s8.cta' },
  ];

  // ═══ TOUR 2 : Business Plan cible pays (7 slides) ══════════════
  const SLIDES_BP = [
    { tint: '#d4a017', eyebrow: 'bp.s1.eyebrow', title: 'bp.s1.title', subtitle: 'bp.s1.subtitle', demo: demoBpIntro,     cta: 'tour.s1.cta' },
    { tint: '#60a5fa', eyebrow: 'bp.s2.eyebrow', title: 'bp.s2.title', subtitle: 'bp.s2.subtitle', demo: demoBpAssumptions, cta: 'tour.cta.next' },
    { tint: '#34d399', eyebrow: 'bp.s3.eyebrow', title: 'bp.s3.title', subtitle: 'bp.s3.subtitle', demo: demoBpRevenue,   cta: 'tour.cta.next' },
    { tint: '#f97316', eyebrow: 'bp.s4.eyebrow', title: 'bp.s4.title', subtitle: 'bp.s4.subtitle', demo: demoBpCosts,     cta: 'tour.cta.next' },
    { tint: '#d4a017', eyebrow: 'bp.s5.eyebrow', title: 'bp.s5.title', subtitle: 'bp.s5.subtitle', demo: demoBpCapex,     cta: 'tour.cta.next' },
    { tint: '#a78bfa', eyebrow: 'bp.s6.eyebrow', title: 'bp.s6.title', subtitle: 'bp.s6.subtitle', demo: demoBpMonteCarlo, cta: 'tour.cta.next' },
    { tint: '#22c55e', eyebrow: 'bp.s7.eyebrow', title: 'bp.s7.title', subtitle: 'bp.s7.subtitle', demo: demoBpVerdict,   cta: 'tour.s8.cta' },
  ];

  // ═══ TOUR 3 : Sources de données (6 slides) ════════════════════
  const SLIDES_SOURCES = [
    { tint: '#d4a017', eyebrow: 'data.s1.eyebrow', title: 'data.s1.title', subtitle: 'data.s1.subtitle', demo: demoDataIntro, cta: 'tour.s1.cta' },
    { tint: '#60a5fa', eyebrow: 'data.s2.eyebrow', title: 'data.s2.title', subtitle: 'data.s2.subtitle', demo: demoDataPop,   cta: 'tour.cta.next' },
    { tint: '#f87171', eyebrow: 'data.s3.eyebrow', title: 'data.s3.title', subtitle: 'data.s3.subtitle', demo: demoDataComps, cta: 'tour.cta.next' },
    { tint: '#06b6d4', eyebrow: 'data.s4.eyebrow', title: 'data.s4.title', subtitle: 'data.s4.subtitle', demo: demoDataFlux,  cta: 'tour.cta.next' },
    { tint: '#a78bfa', eyebrow: 'data.s5.eyebrow', title: 'data.s5.title', subtitle: 'data.s5.subtitle', demo: demoDataImmo,  cta: 'tour.cta.next' },
    { tint: '#22c55e', eyebrow: 'data.s6.eyebrow', title: 'data.s6.title', subtitle: 'data.s6.subtitle', demo: demoDataRigor, cta: 'tour.s8.cta' },
  ];

  // ─── Demo builders ────────────────────────────────────────────
  function demoWelcome() {
    // Logo officiel PNG (identique à la page de login) + "powered by ISSEO".
    // Les constantes window.FP_LOGO_PNG / ISSEO_LOGO_PNG sont fournies par
    // src/fp-logos.js (chargé avant ce module).
    const fpLogo = window.FP_LOGO_PNG || '';
    const isseoLogo = window.ISSEO_LOGO_PNG || '';
    return `
      <div class="fp-onb-demo-welcome">
        <div class="fp-onb-welcome-stack" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;width:100%;height:100%;position:relative">
          <img src="${fpLogo}" alt="Fitness Park" style="height:52px;width:auto;filter:drop-shadow(0 4px 12px rgba(212,160,23,.25))">
          <div style="display:flex;align-items:center;gap:10px;width:160px">
            <div style="flex:1;height:1px;background:linear-gradient(to right,transparent,rgba(212,160,23,.45))"></div>
            <span style="font-size:8px;color:rgba(212,160,23,.75);letter-spacing:2.5px;font-weight:700">POWERED BY</span>
            <div style="flex:1;height:1px;background:linear-gradient(to left,transparent,rgba(212,160,23,.45))"></div>
          </div>
          <img src="${isseoLogo}" alt="Isseo" style="height:28px;width:auto;opacity:.78">
          <!-- Sparks ambient, pour rester dans le style du slide precedent -->
          <svg viewBox="0 0 160 160" aria-hidden="true" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none">
            <circle class="spark" cx="20"  cy="24"  r="2.5" fill="#d4a017"/>
            <circle class="spark" cx="140" cy="30"  r="2"   fill="#fbbf24"/>
            <circle class="spark" cx="148" cy="110" r="2.5" fill="#d4a017"/>
            <circle class="spark" cx="132" cy="142" r="2"   fill="#fbbf24"/>
            <circle class="spark" cx="30"  cy="140" r="2.5" fill="#d4a017"/>
            <circle class="spark" cx="12"  cy="96"  r="2"   fill="#fbbf24"/>
          </svg>
        </div>
      </div>
    `;
  }

  function demoPins() {
    const positions = [
      { x: 62, y: 50, n: 1 },
      { x: 28, y: 72, n: 2 },
      { x: 46, y: 84, n: 3 },
      { x: 75, y: 72, n: 4 },
      { x: 82, y: 30, n: 5 },
    ];
    return `
      <div class="fp-onb-demo-pins" aria-hidden="true">
        ${positions.map(p => `<div class="pin" style="left:${p.x}%;top:${p.y}%">${p.n}</div>`).join('')}
      </div>
    `;
  }

  function demoSliders() {
    // Les 3 barres fill animent de 0% -> target via CSS keyframes à l'entrée.
    // Les valeurs textuelles s'animent via data-counter (compte de 0 -> target).
    // L'IRR recalcule en parallèle après un petit delay (effet "recalc live").
    return `
      <div class="fp-onb-demo-sliders" aria-hidden="true">
        <div class="row">
          <span>Loyer</span>
          <div class="track" style="--fill-target:55%"><div class="fill"></div><div class="thumb"></div></div>
          <span class="val"><span data-counter data-target="11.5" data-format="fr-decimal" data-suffix=" €/m²">0 €/m²</span></span>
        </div>
        <div class="row">
          <span>Charges</span>
          <div class="track" style="--fill-target:44%"><div class="fill"></div><div class="thumb"></div></div>
          <span class="val"><span data-counter data-target="5.5" data-format="fr-decimal" data-suffix=" €/m²" data-delay="120">0 €/m²</span></span>
        </div>
        <div class="row">
          <span>Surface</span>
          <div class="track" style="--fill-target:38%"><div class="fill"></div><div class="thumb"></div></div>
          <span class="val"><span data-counter data-target="1449" data-format="fr-thousands" data-suffix=" m²" data-delay="240">0 m²</span></span>
        </div>
        <div class="irr-card">
          <div><div class="l">IRR projet · recalc live</div></div>
          <div class="v" data-counter data-target="57.6" data-suffix="%" data-delay="600">0%</div>
        </div>
      </div>
    `;
  }

  function demoSaz() {
    // 3 rings concentric with different radius + stroke-dashoffset target.
    // Perimeter = 2πr : r1=72 → P=452, r2=58 → P=364, r3=44 → P=276.
    // --perim = perim complet (dashoffset au repos = ring caché), --dashoffset = cible animée.
    return `
      <div class="fp-onb-demo-saz" aria-hidden="true">
        <svg viewBox="0 0 180 180" width="180" height="180">
          <circle class="ring r1" cx="90" cy="90" r="72" stroke="#06b6d4"
                  stroke-dasharray="452" style="--perim:452;--dashoffset:${Math.round(452 * (1 - 0.65))}"/>
          <circle class="ring r2" cx="90" cy="90" r="58" stroke="#22c55e"
                  stroke-dasharray="364" style="--perim:364;--dashoffset:${Math.round(364 * (1 - 0.69))}"/>
          <circle class="ring r3" cx="90" cy="90" r="44" stroke="#fbbf24"
                  stroke-dasharray="276" style="--perim:276;--dashoffset:${Math.round(276 * (1 - 0.37))}"/>
        </svg>
        <div class="score">
          <div class="n" data-counter data-target="70" data-suffix="">0</div>
          <div class="s">Score SAZ</div>
        </div>
      </div>
    `;
  }

  function demoPnl() {
    // Fill bars + IRR comptent en cascade (stagger 150ms) à l'entrée du slide.
    const data = [
      { lbl: 'Conservateur', c: '#f87171', irr: 36, fill: '36%', delay: 0 },
      { lbl: 'Base',         c: '#d4a017', irr: 57, fill: '57%', delay: 150 },
      { lbl: 'Optimiste',    c: '#34d399', irr: 86, fill: '86%', delay: 300 },
    ];
    return `
      <div class="fp-onb-demo-pnl" aria-hidden="true">
        ${data.map(s => `
          <div class="s" style="--c:${s.c};--fill:${s.fill}">
            <div class="lbl">${s.lbl}</div>
            <div class="irr"><span data-counter data-target="${s.irr}" data-prefix="+" data-suffix="%" data-delay="${s.delay}">+0%</span></div>
            <div class="bar"><div class="fill"></div></div>
          </div>
        `).join('')}
      </div>
    `;
  }

  function demoFinancing() {
    return `
      <div class="fp-onb-demo-fin" aria-hidden="true">
        <div class="bar">
          <div class="eq">Equity 30%</div>
          <div class="ln">Emprunt 70%</div>
        </div>
        <div class="stats">
          <div class="stat">
            <div class="l">IRR projet</div>
            <div class="v" data-counter data-target="57.6" data-suffix="%">0%</div>
          </div>
          <div class="stat levered">
            <div class="l">IRR equity ⭐</div>
            <div class="v" data-counter data-target="89.3" data-suffix="%">0%</div>
          </div>
        </div>
      </div>
    `;
  }

  function demoPhone() {
    return `
      <div class="fp-onb-demo-phone" aria-hidden="true">
        <div class="fp-onb-demo-phone-screen">
          <div class="search" data-typing data-text="AFI Cotroceni"></div>
          <div class="hit">📍 AFI Cotroceni</div>
          <!-- Pin drop à l'intérieur du phone-screen (était sibling, sortait en 3D transform) -->
          <div class="drop"></div>
        </div>
      </div>
    `;
  }

  function demoReady() {
    const confetti = [];
    for (let i = 0; i < 40; i++) {
      const angle = (i / 40) * Math.PI * 2 + Math.random() * 0.3;
      const dist = 60 + Math.random() * 90;
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist;
      const rot = Math.random() * 720 - 360;
      const color = ['#d4a017', '#fbbf24', '#34d399', '#60a5fa', '#a78bfa', '#f97316'][i % 6];
      const delay = Math.random() * 0.25;
      confetti.push(`<span style="--dx:${dx.toFixed(0)}px;--dy:${dy.toFixed(0)}px;--rot:${rot.toFixed(0)}deg;background:${color};animation-delay:${(1.1 + delay).toFixed(2)}s"></span>`);
    }
    return `
      <div class="fp-onb-demo-ready" aria-hidden="true">
        <svg viewBox="0 0 170 170" width="170" height="170">
          <circle class="ring" cx="85" cy="85" r="70"/>
          <path class="check" d="M 55 88 L 78 110 L 118 66"/>
        </svg>
        <div class="flash"></div>
        <div class="fp-onb-confetti">${confetti.join('')}</div>
      </div>
    `;
  }

  // ═══ TOUR 2 : BP cible pays — demo builders ═══════════════════
  function demoBpIntro() {
    const fpLogo = window.FP_LOGO_PNG || '';
    return `
      <div class="fp-onb-demo-bp-intro" style="display:flex;flex-direction:column;align-items:center;gap:14px;padding:10px 0;position:relative">
        <div class="fp-onb-sparkles" aria-hidden="true">
          <span style="--sx:-60px;--sy:-40px;animation-delay:.6s"></span>
          <span style="--sx:55px;--sy:-30px;animation-delay:.9s"></span>
          <span style="--sx:-40px;--sy:50px;animation-delay:1.2s"></span>
          <span style="--sx:70px;--sy:45px;animation-delay:1.5s"></span>
        </div>
        <img src="${fpLogo}" alt="Fitness Park" style="height:42px;width:auto;filter:drop-shadow(0 4px 16px rgba(212,160,23,.35));opacity:0;animation:fpOnbFadeIn .6s ease .1s forwards">
        <div style="font-size:11px;letter-spacing:2.5px;font-weight:800" class="fp-onb-wow-num" data-wow-color="#d4a017">BP V17 · ROMANIA</div>
        <div class="fp-onb-demo-bp-stats" style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;width:100%;max-width:340px">
          <div class="fp-onb-wow-glass fp-onb-wow-frame fp-onb-blur-in" style="border-radius:12px;padding:10px 6px;text-align:center;--blur-delay:.2s"><div style="font-size:18px;font-weight:900;color:var(--onb-tint)"><span data-counter data-target="40" data-delay="300">0</span></div><div style="font-size:8.5px;letter-spacing:.6px;color:rgba(255,255,255,.6);text-transform:uppercase;margin-top:2px">clubs A8</div></div>
          <div class="fp-onb-wow-glass fp-onb-wow-frame fp-onb-blur-in" style="border-radius:12px;padding:10px 6px;text-align:center;--blur-delay:.35s"><div style="font-size:18px;font-weight:900;color:var(--onb-tint)"><span data-counter data-target="51.3" data-format="fr-decimal" data-suffix=" M€" data-delay="500">0</span></div><div style="font-size:8.5px;letter-spacing:.6px;color:rgba(255,255,255,.6);text-transform:uppercase;margin-top:2px">CA A10</div></div>
          <div class="fp-onb-wow-glass fp-onb-wow-frame fp-onb-blur-in" style="border-radius:12px;padding:10px 6px;text-align:center;--blur-delay:.5s"><div style="font-size:18px;font-weight:900;color:#34d399"><span data-counter data-target="9.6" data-format="fr-decimal" data-suffix=" M€" data-delay="700">0</span></div><div style="font-size:8.5px;letter-spacing:.6px;color:rgba(255,255,255,.6);text-transform:uppercase;margin-top:2px">EBITDA A10</div></div>
        </div>
      </div>
    `;
  }

  function demoBpAssumptions() {
    const rows = [
      { lbl: 'Prix mensuel',       val: '28 €',    sub: 'TTC · 23,14 HT',   c: '#d4a017' },
      { lbl: 'Membres cibles A3',  val: '4 000',   sub: 'par club mature',  c: '#60a5fa' },
      { lbl: 'Ramp-up A1 / A2',    val: '70% / 90%', sub: 'courbe maturité', c: '#34d399' },
      { lbl: 'Churn annuel',       val: '45%',     sub: 'standard low-cost EU', c: '#f97316' },
      { lbl: 'Redevance MF',       val: '6%',      sub: 'du CA HT → FP France', c: '#a78bfa' },
    ];
    return `
      <div style="display:flex;flex-direction:column;gap:5px;width:100%">
        ${rows.map((r,i)=>`<div class="fp-onb-bp-row fp-onb-blur-in" style="display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;padding:7px 11px;background:linear-gradient(135deg, rgba(24,32,52,.95) 0%, rgba(16,22,38,.95) 100%);border-radius:10px;border-left:3px solid ${r.c};border-right:1px solid rgba(255,255,255,.06);border-top:1px solid rgba(255,255,255,.06);border-bottom:1px solid rgba(255,255,255,.06);box-shadow:inset 0 1px 0 rgba(255,255,255,.04),0 2px 6px rgba(0,0,0,.18);--blur-delay:${0.1 + i*0.08}s"><div><div class="lbl" style="font-size:11px;font-weight:700;color:#fff">${r.lbl}</div><div class="sub" style="font-size:9px;color:rgba(255,255,255,.55);margin-top:2px">${r.sub}</div></div><div class="val" style="font-size:14px;font-weight:900;color:${r.c};font-variant-numeric:tabular-nums;text-shadow:0 0 14px color-mix(in srgb, ${r.c} 40%, transparent)">${r.val}</div></div>`).join('')}
      </div>
    `;
  }

  function demoBpRevenue() {
    // Courbe ramp-up CA enseigne 100% réseau (27 succ + 13 franc, 40 clubs A7).
    // Source: 01_DCF_BPI!R19 (TOTAL CA ENSEIGNE) — BP Avril 2026 v6.35.
    // Valeurs en M€ (arrondies à 0.01 près).
    const years = [0.88, 3.73, 10.33, 20.67, 27.75, 35.66, 42.53, 47.23, 49.71, 51.29];
    const max = 52;
    return `
      <div style="width:100%;display:flex;flex-direction:column;gap:10px;position:relative">
        <div class="fp-onb-sparkles" aria-hidden="true">
          <span style="--sx:80px;--sy:-50px;animation-delay:1.1s"></span>
          <span style="--sx:-70px;--sy:-30px;animation-delay:1.4s"></span>
        </div>
        <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:3px;height:120px;padding:0 2px;border-bottom:1px solid rgba(255,255,255,.1);position:relative">
          <div style="position:absolute;inset:0;background:radial-gradient(ellipse at bottom, rgba(212,160,23,.08), transparent 70%);pointer-events:none"></div>
          ${years.map((v,i)=>`<div style="flex:1;align-self:stretch;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:3px;position:relative"><div class="fp-onb-wow-bar fp-onb-revenue-bar" style="width:100%;height:${Math.round(v/max*100)}%;background:linear-gradient(180deg, var(--onb-tint), rgba(212,160,23,.35));border-radius:3px 3px 0 0;box-shadow:0 0 8px color-mix(in srgb, var(--onb-tint,#d4a017) 30%, transparent);--bar-delay:${0.05 + i*0.08}s;--shine-delay:${1 + i*0.08}s"></div><div style="font-size:8px;color:rgba(255,255,255,.5);font-weight:600">A${i+1}</div></div>`).join('')}
        </div>
        <div style="display:flex;justify-content:space-between;padding:0 4px;font-size:10px;color:rgba(255,255,255,.65)">
          <span>CA · M€</span><span style="color:var(--onb-tint);font-weight:700"><span data-counter data-target="51.3" data-format="fr-decimal" data-suffix=" M€ A10" data-delay="900">0</span></span>
        </div>
      </div>
    `;
  }

  function demoBpCosts() {
    // Structure de coûts calibrée BP harmonisé Avril 2026 (v6.35).
    // Source: MF FP - BP RO - vFinancement mixte - Avril.xlsx (PL_CLUB_TYPE, maturité A3).
    // Staff passé en plug ETP (plus un ratio CA): 3 ETP chargés = 86k A1 → ~9% CA A3.
    const costs = [
      { lbl: 'Cost of sales',  pct: 2.8,  c: '#94a3b8', note: 'accessoires VAD (BP C63)' },
      { lbl: 'Staff',          pct: 9,    c: '#60a5fa', note: '3 ETP plug direct · 86k A1 → 108k A5 (+6%/an)' },
      { lbl: 'Loyer + charges',pct: 19,   c: '#f97316', note: 'flat 19.7k€/mois · variable par site' },
      { lbl: 'OPEX ops Y1→Y5', pct: 16,   c: '#34d399', note: '20% Y1 → 12% Y5+ (time-decay)' },
      { lbl: 'Royalties MF',   pct: 6,    c: '#a78bfa', note: 'succursale paie FP France direct' },
      { lbl: 'Fonds pub',      pct: 2,    c: '#fbbf24', note: 'neutre MF (transparence)' },
      { lbl: 'Impôts locaux RO',pct: 2,   c: '#f87171', note: 'taxe foncière + taxes locales' },
    ];
    const total = costs.reduce((a,c)=>a+c.pct, 0);
    return `
      <div style="width:100%;display:flex;flex-direction:column;gap:4px">
        ${costs.map((c,i)=>`<div class="fp-onb-bp-cost-row fp-onb-blur-in" style="--blur-delay:${0.1+i*0.07}s"><div style="display:flex;justify-content:space-between;align-items:baseline;font-size:10px;margin-bottom:1px"><span class="name" style="color:#fff;font-weight:700">${c.lbl}</span><span class="pct" style="color:${c.c};font-weight:800;text-shadow:0 0 10px color-mix(in srgb, ${c.c} 40%, transparent)">${c.pct}% CA</span></div><div class="bar fp-onb-wow-bar" style="height:4px;background:rgba(255,255,255,.06);border-radius:2px;overflow:hidden;--shine-delay:${1.2 + i*0.1}s"><div style="height:100%;background:linear-gradient(90deg, ${c.c}, color-mix(in srgb, ${c.c} 70%, #fff 30%));width:0;animation:fpOnbWidthGrow ${0.85 + i*0.08}s cubic-bezier(.34,1.36,.4,1) ${0.2 + i*0.08}s forwards;--w:${Math.min((c.pct/16)*100, 100)}%;box-shadow:0 0 6px color-mix(in srgb, ${c.c} 50%, transparent)"></div></div><div class="note" style="font-size:8px;color:rgba(255,255,255,.45);margin-top:1px;font-style:italic;line-height:1.3">${c.note}</div></div>`).join('')}
        <div class="fp-onb-wow-glass fp-onb-wow-frame" style="margin-top:4px;padding:7px 10px;background:linear-gradient(135deg, rgba(34,197,94,.14), rgba(34,197,94,.06));border:1px solid rgba(34,197,94,.3);border-radius:10px;position:relative;overflow:hidden"><div style="display:flex;justify-content:space-between;font-size:10.5px;font-weight:800;position:relative;z-index:1"><span style="color:#fff">EBITDA cible Y5+</span><span style="color:#34d399">~42-53%</span></div><div style="font-size:8.5px;color:rgba(255,255,255,.55);margin-top:2px;line-height:1.35;position:relative;z-index:1">OnAir 44,7% (audit Fiteco) · v6.25 inclut 2% impôts locaux RO</div></div>
      </div>
    `;
  }

  function demoBpCapex() {
    // CAPEX 1176k€ = fit-out 840 (71%) + équipement 336 (29%)
    return `
      <div style="width:100%;display:flex;flex-direction:column;gap:12px;align-items:center;position:relative">
        <div class="fp-onb-sparkles" aria-hidden="true">
          <span style="--sx:-70px;--sy:-30px;animation-delay:1.4s"></span>
          <span style="--sx:75px;--sy:-20px;animation-delay:1.6s"></span>
        </div>
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;justify-content:center">
          <svg viewBox="0 0 120 120" width="108" height="108" style="transform:rotate(-90deg);filter:drop-shadow(0 0 12px rgba(212,160,23,.25))">
            <defs>
              <linearGradient id="fpCapexGoldGrad" x1="0" x2="1" y1="0" y2="1">
                <stop offset="0%" stop-color="#d4a017"/>
                <stop offset="100%" stop-color="#f3c44f"/>
              </linearGradient>
              <linearGradient id="fpCapexBlueGrad" x1="0" x2="1" y1="0" y2="1">
                <stop offset="0%" stop-color="#60a5fa"/>
                <stop offset="100%" stop-color="#93c5fd"/>
              </linearGradient>
            </defs>
            <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="14"/>
            <circle cx="60" cy="60" r="50" fill="none" stroke="url(#fpCapexGoldGrad)" stroke-width="14" stroke-dasharray="314" stroke-dashoffset="314" stroke-linecap="round" style="animation:fpOnbRingDraw 1.2s cubic-bezier(.34,1.12,.52,1) .3s forwards;--to:91"/>
            <circle cx="60" cy="60" r="50" fill="none" stroke="url(#fpCapexBlueGrad)" stroke-width="14" stroke-dasharray="314" stroke-dashoffset="314" stroke-linecap="round" transform="rotate(260 60 60)" style="animation:fpOnbRingDrawSmall 1.2s cubic-bezier(.34,1.12,.52,1) .6s forwards;--to:223"/>
          </svg>
          <div class="fp-onb-bp-capex-legend" style="display:flex;flex-direction:column;gap:6px;font-size:11px">
            <div style="display:flex;align-items:center;gap:6px"><span style="width:10px;height:10px;background:linear-gradient(135deg,#d4a017,#f3c44f);border-radius:3px;box-shadow:0 0 6px rgba(212,160,23,.5)"></span><span style="color:#fff;font-weight:700">Fit-out</span><span class="sub" style="color:rgba(255,255,255,.6)">840 k€ · 600€/m² × 1 400m²</span></div>
            <div style="display:flex;align-items:center;gap:6px"><span style="width:10px;height:10px;background:linear-gradient(135deg,#60a5fa,#93c5fd);border-radius:3px;box-shadow:0 0 6px rgba(96,165,250,.5)"></span><span style="color:#fff;font-weight:700">Équipement</span><span class="sub" style="color:rgba(255,255,255,.6)">336 k€ · 60% leasing 5 ans</span></div>
          </div>
        </div>
        <div style="text-align:center;width:100%"><div style="font-size:10px;color:rgba(255,255,255,.55);letter-spacing:.8px;text-transform:uppercase">CAPEX bilan / club</div><div style="font-size:22px;font-weight:900;color:var(--onb-tint);margin-top:2px;text-shadow:0 0 20px rgba(212,160,23,.4)"><span data-counter data-target="1176" data-format="fr-thousands" data-suffix=" k€" data-delay="800">0</span></div><div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(52,211,153,.25)"><div style="font-size:10px;color:rgba(52,211,153,.7);letter-spacing:.8px;text-transform:uppercase">Total cash + leasing</div><div style="font-size:30px;font-weight:900;color:#34d399;margin-top:2px;text-shadow:0 0 24px rgba(52,211,153,.5);line-height:1.1"><span data-counter data-target="1680" data-format="fr-thousands" data-suffix=" k€" data-delay="1100">0</span></div><div style="font-size:9px;color:rgba(255,255,255,.45);margin-top:3px;font-style:italic">incl. leasing 504 k€ (60% équip · 5 ans)</div></div></div>
      </div>
    `;
  }

  function demoBpMonteCarlo() {
    // Utilise les résultats Monte Carlo réels calculés au boot pour Hala Laminor
    // (window._fpMonteCarloHL). Fallback sur distribution illustrative si pas prêt.
    const mc = window._fpMonteCarloHL;
    let bins, p5, p50, p95, siteName, irrMin, irrMax, iterations;
    if (mc && mc.bins && mc.irr) {
      // Vrais chiffres
      bins = mc.bins.map(b => b.count);
      p5 = Math.round(mc.irr.p5);
      p50 = Math.round(mc.irr.p50);
      p95 = Math.round(mc.irr.p95);
      irrMin = Math.round(mc.irr.min);
      irrMax = Math.round(mc.irr.max);
      siteName = mc.siteName || 'Hala Laminor';
      iterations = mc.iterations || 1000;
    } else {
      // Fallback illustratif si le MC n'est pas encore calculé
      bins = [3, 8, 16, 28, 44, 58, 72, 88, 95, 92, 78, 60, 42, 26, 14, 6];
      p5 = 38; p50 = 57; p95 = 79; irrMin = 20; irrMax = 100;
      siteName = 'Hala Laminor';
      iterations = 1000;
    }
    const maxBar = Math.max(...bins, 1);
    // Position de la médiane dans les bars (pour label centré)
    const medianBinIdx = bins.length > 0 ? Math.floor(bins.length * (p50 - irrMin) / Math.max(irrMax - irrMin, 1)) : bins.length / 2;
    return `
      <div class="fp-onb-bp-mc" style="width:100%;display:flex;flex-direction:column;gap:9px;position:relative">
        <div class="fp-onb-sparkles" aria-hidden="true">
          <span style="--sx:0px;--sy:-35px;animation-delay:1.6s"></span>
          <span style="--sx:30px;--sy:-60px;animation-delay:1.9s"></span>
          <span style="--sx:-40px;--sy:-50px;animation-delay:2.1s"></span>
        </div>
        <div class="hist" style="display:flex;align-items:flex-end;gap:2px;height:100px;padding:0 4px;border-bottom:1px solid rgba(255,255,255,.1);position:relative">
          <div style="position:absolute;inset:0;background:radial-gradient(ellipse at 50% 100%, rgba(167,139,250,.12), transparent 70%);pointer-events:none"></div>
          ${bins.map((v,i)=>{ const isMed = i === medianBinIdx; const topC = isMed ? '#f3c44f' : '#c4b5fd'; const botC = isMed ? 'rgba(212,160,23,.25)' : 'rgba(167,139,250,.22)'; return `<div class="fp-onb-wow-bar" style="flex:1;height:${Math.round(v/maxBar*100)}%;background:linear-gradient(180deg, ${topC}, ${botC});border-radius:2px 2px 0 0;transform:scaleY(0);transform-origin:bottom;animation:fpOnbBarGrow .55s cubic-bezier(.34,1.36,.4,1) ${0.05 + i*0.035}s forwards;${isMed ? 'box-shadow:0 -1px 12px rgba(212,160,23,.55);' : ''}--shine-delay:${1.3 + i*0.04}s"></div>`; }).join('')}
        </div>
        <div style="display:flex;justify-content:space-between;font-size:9px;color:rgba(255,255,255,.5);padding:0 4px">
          <span>${irrMin}%</span><span style="color:var(--onb-tint);font-weight:800;text-shadow:0 0 10px rgba(212,160,23,.4)">médiane ${p50}%</span><span>${irrMax}%</span>
        </div>
        <div class="stats fp-onb-wow-glass fp-onb-wow-frame" style="border-radius:10px;padding:8px 10px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;font-size:10px;position:relative">
          <div class="fp-onb-blur-in" style="--blur-delay:.3s"><div class="lbl" style="color:rgba(255,255,255,.5);font-size:8.5px;text-transform:uppercase;letter-spacing:.5px">P5</div><div class="v" style="color:#fff;font-weight:800;margin-top:2px">+${p5}%</div></div>
          <div class="fp-onb-blur-in" style="--blur-delay:.45s;position:relative"><div class="lbl" style="color:rgba(255,255,255,.5);font-size:8.5px;text-transform:uppercase;letter-spacing:.5px">Médiane</div><div class="v" style="color:#d4a017;font-weight:900;margin-top:2px;text-shadow:0 0 14px rgba(212,160,23,.5)">+${p50}%</div></div>
          <div class="fp-onb-blur-in" style="--blur-delay:.6s"><div class="lbl" style="color:rgba(255,255,255,.5);font-size:8.5px;text-transform:uppercase;letter-spacing:.5px">P95</div><div class="v" style="color:#fff;font-weight:800;margin-top:2px">+${p95}%</div></div>
        </div>
        <div class="cap" style="font-size:9.5px;color:rgba(255,255,255,.55);text-align:center;font-style:italic;line-height:1.4">${iterations.toLocaleString('fr-FR')} simulations · ${siteName} · variables stochastiques : captage, ARPU, churn, CAPEX, loyer, OPEX, ramp-up${mc ? ' (temps réel)' : ' (illustratif)'}</div>
      </div>
    `;
  }

  function demoBpVerdict() {
    // Verdict final BP avec IRR/NPV + confetti
    return `
      <div style="width:100%;display:flex;flex-direction:column;gap:14px;align-items:center;position:relative">
        <div class="fp-onb-sparkles" aria-hidden="true">
          <span style="--sx:-90px;--sy:-45px;animation-delay:1.1s"></span>
          <span style="--sx:85px;--sy:-50px;animation-delay:1.3s"></span>
          <span style="--sx:-65px;--sy:40px;animation-delay:1.5s"></span>
          <span style="--sx:75px;--sy:35px;animation-delay:1.7s"></span>
          <span style="--sx:0px;--sy:-90px;animation-delay:1.9s"></span>
        </div>
        <div style="width:100px;height:100px;border-radius:50%;background:radial-gradient(circle, rgba(34,197,94,.25), transparent 70%);display:flex;align-items:center;justify-content:center;position:relative;animation:fpOnbBreathe 3s ease-in-out infinite">
          <svg viewBox="0 0 80 80" width="80" height="80" style="filter:drop-shadow(0 0 12px rgba(34,197,94,.4))">
            <circle cx="40" cy="40" r="34" fill="none" stroke="#22c55e" stroke-width="4" stroke-dasharray="214" stroke-dashoffset="214" stroke-linecap="round" style="animation:fpOnbRingDraw 1s cubic-bezier(.34,1.12,.52,1) .2s forwards;--to:0"/>
            <path d="M 26 40 L 36 52 L 56 30" fill="none" stroke="#22c55e" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="48" stroke-dashoffset="48" style="animation:fpOnbCheckDraw .5s cubic-bezier(.34,1.12,.52,1) .9s forwards;--to:0"/>
          </svg>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;width:100%;max-width:320px">
          <div class="fp-onb-wow-glass fp-onb-wow-frame fp-onb-blur-in" style="border-radius:12px;padding:10px 6px;text-align:center;border-top:2px solid #22c55e;--blur-delay:1.2s"><div style="font-size:16px;font-weight:900;color:#22c55e;text-shadow:0 0 14px rgba(34,197,94,.5)"><span data-counter data-target="57.6" data-format="fr-decimal" data-prefix="+" data-suffix="%" data-delay="1300">+0%</span></div><div style="font-size:8px;letter-spacing:.6px;color:rgba(255,255,255,.6);text-transform:uppercase;margin-top:2px">IRR équité</div></div>
          <div class="fp-onb-wow-glass fp-onb-wow-frame fp-onb-blur-in" style="border-radius:12px;padding:10px 6px;text-align:center;border-top:2px solid #d4a017;--blur-delay:1.4s"><div style="font-size:16px;font-weight:900;color:#d4a017;text-shadow:0 0 14px rgba(212,160,23,.5)"><span data-counter data-target="3.9" data-format="fr-decimal" data-suffix=" M€" data-delay="1500">0</span></div><div style="font-size:8px;letter-spacing:.6px;color:rgba(255,255,255,.6);text-transform:uppercase;margin-top:2px">NPV 5 ans</div></div>
          <div class="fp-onb-wow-glass fp-onb-wow-frame fp-onb-blur-in" style="border-radius:12px;padding:10px 6px;text-align:center;border-top:2px solid #60a5fa;--blur-delay:1.6s"><div style="font-size:16px;font-weight:900;color:#60a5fa;text-shadow:0 0 14px rgba(96,165,250,.5)"><span data-counter data-target="38" data-suffix=" mois" data-delay="1700">0</span></div><div style="font-size:8px;letter-spacing:.6px;color:rgba(255,255,255,.6);text-transform:uppercase;margin-top:2px">Payback</div></div>
        </div>
      </div>
    `;
  }

  // ═══ TOUR 3 : Sources de données — demo builders ══════════════
  function demoDataIntro() {
    const srcs = [
      { icon: '🏠', name: 'OSM',        desc: '397k bâtiments' },
      { icon: '📊', name: 'INS Census', desc: 'Recensement 2021' },
      { icon: '🏋️', name: 'Overpass',   desc: '92 clubs' },
      { icon: '🚇', name: 'Metrorex',   desc: '53 stations' },
      { icon: '🏢', name: 'Cushman',    desc: '340k bureaux' },
      { icon: '🗺️', name: 'Google',     desc: 'Routes + Places' },
    ];
    return `
      <div class="fp-onb-data-grid" style="width:100%;display:grid;grid-template-columns:repeat(3,1fr);gap:8px;position:relative">
        ${srcs.map((s,i)=>`<div class="card fp-onb-wow-glass fp-onb-wow-frame" style="border-radius:12px;padding:10px 6px;text-align:center;opacity:0;transform:translateY(10px) scale(.95);animation:fpOnbCardIn .55s cubic-bezier(.34,1.56,.52,1) ${0.1 + i*0.08}s forwards"><div class="icon" style="font-size:22px;margin-bottom:4px;filter:drop-shadow(0 0 6px color-mix(in srgb, var(--onb-tint,#d4a017) 50%, transparent))">${s.icon}</div><div class="name" style="font-size:11px;font-weight:800;color:#fff">${s.name}</div><div class="desc" style="font-size:9px;color:rgba(255,255,255,.6);margin-top:2px;line-height:1.3">${s.desc}</div></div>`).join('')}
      </div>
    `;
  }

  function demoDataPop() {
    const mk = (color, eyebrow, prefix, counter, unit, sub, delay) => `
      <div class="card fp-onb-wow-glass fp-onb-wow-frame fp-onb-blur-in" style="border-radius:12px;padding:11px 13px;--blur-delay:${delay}s;position:relative;overflow:hidden">
        <div style="position:absolute;inset:0;background:radial-gradient(circle at 0% 0%, color-mix(in srgb, ${color} 15%, transparent), transparent 60%);pointer-events:none"></div>
        <div class="eyebrow" style="font-size:9.5px;letter-spacing:.6px;color:${color};text-transform:uppercase;font-weight:800;position:relative">${eyebrow}</div>
        <div style="margin-top:5px;display:flex;align-items:baseline;gap:7px;position:relative"><span class="val" style="font-size:20px;font-weight:900;color:#fff;text-shadow:0 0 14px color-mix(in srgb, ${color} 35%, transparent)">${prefix}${counter}</span><span class="unit" style="font-size:11px;color:rgba(255,255,255,.65)">${unit}</span></div>
        <div class="sub" style="font-size:9.5px;color:rgba(255,255,255,.55);margin-top:3px;position:relative">${sub}</div>
      </div>`;
    return `
      <div class="fp-onb-data-pop" style="width:100%;display:flex;flex-direction:column;gap:8px">
        ${mk('#60a5fa', 'INS Census 2021', '', '<span data-counter data-target="1716961" data-format="fr-thousands" data-delay="200">0</span>', 'habitants recensés', '6 secteurs · 83 quartiers (cartiere)', 0.1)}
        ${mk('#34d399', '+ Navetteurs Ilfov', '×', '<span data-counter data-target="1.7" data-format="fr-decimal" data-delay="400">0</span>', 'pop réelle estimée', '<span data-counter data-target="2.9" data-format="fr-decimal" data-suffix=" M" data-delay="600">0</span> hab. effective (census + non-déclarés + expats)', 0.25)}
        ${mk('#a78bfa', 'Volumétrie OSM', '', '<span data-counter data-target="397009" data-format="fr-thousands" data-delay="700">0</span>', 'bâtiments', 'Pondération volumétrique · emprise × étages', 0.4)}
      </div>
    `;
  }

  function demoDataComps() {
    const clubs = [
      { name: 'World Class', n: 36, c: '#ef4444' },
      { name: 'Stay Fit', n: 28, c: '#f97316' },
      { name: '18GYM', n: 6, c: '#eab308' },
      { name: 'Downtown', n: 5, c: '#22c55e' },
      { name: 'Nr1', n: 5, c: '#a78bfa' },
      { name: 'Autres', n: 12, c: '#64748b' },
    ];
    const total = clubs.reduce((a,c)=>a+c.n,0);
    return `
      <div class="fp-onb-data-list" style="width:100%;display:flex;flex-direction:column;gap:7px">
        ${clubs.map((c,i)=>`<div class="row fp-onb-blur-in" style="display:grid;grid-template-columns:90px 1fr 40px;gap:8px;align-items:center;--blur-delay:${0.1 + i*0.07}s"><div class="name" style="font-size:10.5px;color:#fff;font-weight:700">${c.name}</div><div class="bar fp-onb-wow-bar" style="height:10px;border-radius:5px;background:rgba(255,255,255,.06);overflow:hidden;--shine-delay:${1 + i*0.1}s"><div style="height:100%;background:linear-gradient(90deg, ${c.c}, color-mix(in srgb, ${c.c} 70%, #fff 30%));width:0;animation:fpOnbWidthGrow .75s cubic-bezier(.34,1.36,.4,1) ${0.2 + i*0.07}s forwards;--w:${Math.round(c.n/40*100)}%;box-shadow:0 0 8px color-mix(in srgb, ${c.c} 40%, transparent)"></div></div><div class="n" style="font-size:10.5px;color:${c.c};font-weight:800;text-align:right;text-shadow:0 0 8px color-mix(in srgb, ${c.c} 40%, transparent)">${c.n}</div></div>`).join('')}
        <div style="margin-top:5px;padding-top:8px;border-top:1px solid rgba(255,255,255,.1);display:flex;justify-content:space-between;font-size:10px;gap:6px"><span style="color:rgba(255,255,255,.6)">Total vérifié</span><span style="color:var(--onb-tint);font-weight:800;text-align:right">${total} clubs · Overpass + check manuel</span></div>
      </div>
    `;
  }

  function demoDataFlux() {
    const card = (color, icon, eyebrow, counter, sub, delay) => `
      <div class="card fp-onb-wow-frame" style="background:linear-gradient(135deg, color-mix(in srgb, ${color} 12%, rgba(24,32,52,.85)), rgba(16,22,38,.9));border:1px solid color-mix(in srgb, ${color} 30%, transparent);border-radius:12px;padding:10px;opacity:0;animation:fpOnbCardIn .55s cubic-bezier(.34,1.56,.52,1) ${delay}s forwards;position:relative;overflow:hidden">
        <div style="position:absolute;top:-20px;right:-20px;width:60px;height:60px;background:radial-gradient(circle, color-mix(in srgb, ${color} 30%, transparent), transparent 70%);pointer-events:none"></div>
        <div class="icon" style="font-size:20px;margin-bottom:3px;filter:drop-shadow(0 0 6px color-mix(in srgb, ${color} 60%, transparent))">${icon}</div>
        <div class="eyebrow" style="font-size:9.5px;letter-spacing:.4px;color:${color};font-weight:800;text-transform:uppercase">${eyebrow}</div>
        <div class="val" style="font-size:16px;font-weight:900;color:#fff;margin-top:4px;text-shadow:0 0 12px color-mix(in srgb, ${color} 40%, transparent)">${counter}</div>
        <div class="sub" style="font-size:9px;color:rgba(255,255,255,.55);margin-top:2px">${sub}</div>
      </div>`;
    return `
      <div class="fp-onb-data-flux" style="width:100%;display:flex;flex-direction:column;gap:9px">
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:7px">
          ${card('#06b6d4', '🚇', 'Métro Metrorex', '<span data-counter data-target="53" data-suffix=" stations" data-delay="300">0</span>', 'M1-M5 · 750k pax/jour', 0.1)}
          ${card('#34d399', '🚋', 'Tram/bus STB', '<span data-counter data-target="2.7" data-format="fr-decimal" data-suffix=" M" data-delay="450">0</span>', 'pax/jour · 7 corridors', 0.25)}
          ${card('#f97316', '🛍️', '12 malls', '<span data-counter data-target="60000" data-format="fr-thousands" data-delay="600">0</span>', 'AFI Cotroceni / jour', 0.4)}
          ${card('#a78bfa', '🏢', 'Bureaux CBRE', '<span data-counter data-target="340000" data-format="fr-thousands" data-delay="750">0</span>', 'employés modernes', 0.55)}
        </div>
        <div style="font-size:9.5px;color:rgba(255,255,255,.55);text-align:center;font-style:italic;line-height:1.35">Google Routes API · isochrones 10 min marche/voiture/métro</div>
      </div>
    `;
  }

  function demoDataImmo() {
    const hoods = [
      { name: 'Primaverii', price: 3200, c: '#ef4444' },
      { name: 'Aviatorilor', price: 3000, c: '#f97316' },
      { name: 'Floreasca', price: 2600, c: '#d4a017' },
      { name: 'Dorobanti', price: 2800, c: '#f97316' },
      { name: 'Titan', price: 1400, c: '#22c55e' },
      { name: 'Ferentari', price: 700, c: '#64748b' },
    ];
    const max = 3500;
    return `
      <div class="fp-onb-data-list" style="width:100%;display:flex;flex-direction:column;gap:6px">
        ${hoods.map((h,i)=>`<div class="row fp-onb-blur-in" style="display:grid;grid-template-columns:80px 1fr auto;gap:8px;align-items:center;--blur-delay:${0.1 + i*0.07}s"><div class="name" style="font-size:10.5px;color:#fff;font-weight:700">${h.name}</div><div class="bar fp-onb-wow-bar" style="height:10px;border-radius:5px;background:rgba(255,255,255,.06);overflow:hidden;--shine-delay:${1 + i*0.1}s"><div style="height:100%;background:linear-gradient(90deg, ${h.c}, color-mix(in srgb, ${h.c} 70%, #fff 30%));width:0;animation:fpOnbWidthGrow .75s cubic-bezier(.34,1.36,.4,1) ${0.2 + i*0.07}s forwards;--w:${Math.round(h.price/max*100)}%;box-shadow:0 0 8px color-mix(in srgb, ${h.c} 40%, transparent)"></div></div><div class="n" style="font-size:10.5px;color:${h.c};font-weight:800;text-align:right;text-shadow:0 0 8px color-mix(in srgb, ${h.c} 40%, transparent);white-space:nowrap">${h.price} €/m²</div></div>`).join('')}
        <div style="margin-top:5px;padding-top:7px;border-top:1px solid rgba(255,255,255,.1);font-size:9.5px;color:rgba(255,255,255,.55);text-align:center;line-height:1.35">Source : imobiliare.ro · investropa.com 2025 · proxy revenu/quartier</div>
      </div>
    `;
  }

  function demoDataRigor() {
    const items = [
      { c: '#22c55e', sym: '✓', t: 'Cross-référence OSM × INS × Google', d: 1.1 },
      { c: '#22c55e', sym: '✓', t: '92 clubs validés manuellement',       d: 1.3 },
      { c: '#22c55e', sym: '✓', t: 'Modèle calibré OnAir Montreuil (Fiteco)', d: 1.5 },
      { c: '#f97316', sym: '⚠', t: 'Limites assumées · onglet Sources',   d: 1.7 },
    ];
    return `
      <div style="width:100%;display:flex;flex-direction:column;gap:10px;align-items:center;position:relative">
        <div class="fp-onb-sparkles" aria-hidden="true">
          <span style="--sx:-60px;--sy:-40px;animation-delay:1.3s"></span>
          <span style="--sx:60px;--sy:-40px;animation-delay:1.5s"></span>
        </div>
        <div style="width:90px;height:90px;border-radius:50%;background:radial-gradient(circle, rgba(34,197,94,.25), transparent 70%);display:flex;align-items:center;justify-content:center;animation:fpOnbBreathe 3s ease-in-out infinite">
          <svg viewBox="0 0 80 80" width="70" height="70" style="filter:drop-shadow(0 0 10px rgba(34,197,94,.4))"><circle cx="40" cy="40" r="34" fill="none" stroke="#22c55e" stroke-width="4" stroke-dasharray="214" stroke-dashoffset="214" stroke-linecap="round" style="animation:fpOnbRingDraw 1s cubic-bezier(.34,1.12,.52,1) .2s forwards;--to:0"/><path d="M 26 40 L 36 52 L 56 30" fill="none" stroke="#22c55e" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="48" stroke-dashoffset="48" style="animation:fpOnbCheckDraw .5s cubic-bezier(.34,1.12,.52,1) .9s forwards;--to:0"/></svg>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;width:100%">
          ${items.map(it => `<div class="fp-onb-wow-frame" style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:linear-gradient(135deg, color-mix(in srgb, ${it.c} 12%, transparent), color-mix(in srgb, ${it.c} 4%, transparent));border:1px solid color-mix(in srgb, ${it.c} 28%, transparent);border-radius:10px;font-size:10.5px;color:#fff;opacity:0;animation:fpOnbBlurIn .5s cubic-bezier(.22,.96,.36,1) ${it.d}s forwards"><span style="color:${it.c};font-weight:900;text-shadow:0 0 8px color-mix(in srgb, ${it.c} 60%, transparent)">${it.sym}</span>${it.t}</div>`).join('')}
        </div>
      </div>
    `;
  }

  // ─── Counter animation ────────────────────────────────────────
  // Format la valeur selon data-format: 'fr-decimal' (virgule, 1 décimale),
  // 'fr-thousands' (espace thousands, 0 décimale), par défaut point décimal anglais.
  function formatCounterValue(v, target, format) {
    if (format === 'fr-decimal') {
      return v.toFixed(1).replace('.', ',');
    }
    if (format === 'fr-thousands') {
      return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    }
    return v.toFixed(target % 1 === 0 ? 0 : 1);
  }

  const counterCache = new Map();  // slideIdx-elemIdx-target → done
  function animateCounters(slide, slideIdx) {
    const counters = slide.querySelectorAll('[data-counter]');
    counters.forEach((el, i) => {
      const target = parseFloat(el.dataset.target || '0');
      const suffix = el.dataset.suffix || '';
      const prefix = el.dataset.prefix || '';
      const format = el.dataset.format || '';
      const delay = parseInt(el.dataset.delay || '0', 10);
      const key = slideIdx + '-' + i + '-' + target;
      if (counterCache.has(key)) {
        el.textContent = prefix + formatCounterValue(target, target, format) + suffix;
        return;
      }
      counterCache.set(key, true);
      const duration = 950;
      const fps = 30;
      const tickMs = 1000 / fps;
      const kick = () => {
        const start = Date.now();
        const timer = setInterval(() => {
          const t = Math.min(1, (Date.now() - start) / duration);
          const eased = 1 - Math.pow(1 - t, 3);
          const v = target * eased;
          el.textContent = prefix + formatCounterValue(v, target, format) + suffix;
          if (t >= 1) clearInterval(timer);
        }, tickMs);
      };
      if (delay > 0) setTimeout(kick, delay);
      else kick();
    });
  }

  // ─── Typing animation (for phone search) ──────────────────────
  function animateTyping(slide) {
    const typers = slide.querySelectorAll('[data-typing]');
    typers.forEach(el => {
      const text = el.dataset.text || '';
      el.textContent = '';
      let i = 0;
      const tick = () => {
        if (i > text.length) return;
        el.textContent = text.slice(0, i);
        i++;
        setTimeout(tick, 70 + Math.random() * 40);
      };
      setTimeout(tick, 300);
    });
  }

  // ─── Overlay DOM + state ──────────────────────────────────────
  let overlay, card, slidesWrap, dotsEl, progressBar, skipBtn, nextBtn, actionsRow, currentIdx;
  let keyHandler, confirmTimer;

  function buildOverlay() {
    if (overlay) return;
    ensureStyles();

    overlay = document.createElement('div');
    overlay.className = 'fp-onb-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'fp-onb-active-title');
    overlay.innerHTML = `
      <div class="fp-onb-progress"><div class="fp-onb-progress-bar"></div></div>
      <div class="fp-onb-card" role="document">
        <button class="fp-onb-close" type="button" aria-label="Fermer">✕</button>
        <div class="fp-onb-slides-wrap"></div>
        <div class="fp-onb-dots" role="tablist" aria-label="Slides"></div>
        <div class="fp-onb-actions"></div>
      </div>
    `;
    document.body.appendChild(overlay);

    card = overlay.querySelector('.fp-onb-card');
    slidesWrap = overlay.querySelector('.fp-onb-slides-wrap');
    dotsEl = overlay.querySelector('.fp-onb-dots');
    progressBar = overlay.querySelector('.fp-onb-progress-bar');

    // Slides
    activeSlides.forEach((s, i) => {
      const slide = document.createElement('div');
      slide.className = 'fp-onb-slide';
      slide.dataset.idx = i;
      slide.innerHTML = `
        <div class="fp-onb-eyebrow">${tr(s.eyebrow)}</div>
        <h2 class="fp-onb-title" ${i === 0 ? 'id="fp-onb-active-title"' : ''}>${tr(s.title)}</h2>
        <p class="fp-onb-subtitle">${tr(s.subtitle)}</p>
        <div class="fp-onb-demo">${s.demo()}</div>
      `;
      slidesWrap.appendChild(slide);

      const dot = document.createElement('span');
      dot.className = 'fp-onb-dot';
      dot.setAttribute('role', 'tab');
      dot.dataset.idx = i;
      dotsEl.appendChild(dot);
    });

    // Actions
    actionsRow = overlay.querySelector('.fp-onb-actions');
    renderActions();

    // Close button
    overlay.querySelector('.fp-onb-close').addEventListener('click', () => askDismiss());

    // Swipe on card
    wireSwipe(card);
  }

  function renderActions(mode) {
    const isLast = currentIdx === SLIDE_COUNT - 1;
    if (mode === 'skipConfirm') {
      actionsRow.innerHTML = `
        <div class="fp-onb-skip-confirm">
          <strong>${tr('tour.skipConfirm.question')}</strong>
          <button class="no" type="button">${tr('tour.skipConfirm.no')}</button>
          <button class="yes" type="button">${tr('tour.skipConfirm.yes')}</button>
        </div>
      `;
      actionsRow.querySelector('.yes').addEventListener('click', confirmDismiss);
      actionsRow.querySelector('.no').addEventListener('click', cancelDismissConfirm);
      // Auto-rollback 3.5s
      confirmTimer = setTimeout(cancelDismissConfirm, 3500);
      return;
    }
    actionsRow.innerHTML = `
      <button class="fp-onb-btn-skip" type="button">${tr('tour.skip')}</button>
      <button class="fp-onb-btn-next" type="button">
        <span>${tr(activeSlides[currentIdx]?.cta || 'tour.cta.next')}</span>
        ${isLast ? '' : '<svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>'}
      </button>
    `;
    skipBtn = actionsRow.querySelector('.fp-onb-btn-skip');
    nextBtn = actionsRow.querySelector('.fp-onb-btn-next');
    skipBtn.addEventListener('click', askDismiss);
    nextBtn.addEventListener('click', () => {
      haptic(18);
      if (isLast) finish();
      else goToSlide(currentIdx + 1, 'right');
    });
  }

  function askDismiss() {
    if (confirmTimer) clearTimeout(confirmTimer);
    renderActions('skipConfirm');
  }
  function cancelDismissConfirm() {
    if (confirmTimer) clearTimeout(confirmTimer);
    confirmTimer = null;
    renderActions();
  }
  function confirmDismiss() {
    if (confirmTimer) clearTimeout(confirmTimer);
    finish({ skipped: true });
  }

  function wireSwipe(el) {
    let startX = 0, startY = 0, tracking = false, dragging = false;
    const THRESHOLD = 60;
    const ANGLE_GUARD = 1.4;

    el.addEventListener('touchstart', (e) => {
      const target = e.target;
      // Skip swipe inside tabs / data-no-swipe-nav (as per template)
      if (target.closest?.('.tabs, [data-no-swipe-nav]')) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      tracking = true; dragging = false;
    }, { passive: true });

    el.addEventListener('touchmove', (e) => {
      if (!tracking) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (!dragging && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * ANGLE_GUARD) dragging = true;
    }, { passive: true });

    el.addEventListener('touchend', (e) => {
      if (!tracking || !dragging) { tracking = false; return; }
      tracking = false; dragging = false;
      const dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) < THRESHOLD) return;
      if (dx < 0 && currentIdx < SLIDE_COUNT - 1) { haptic(12); goToSlide(currentIdx + 1, 'right'); }
      else if (dx > 0 && currentIdx > 0)          { haptic(12); goToSlide(currentIdx - 1, 'left');  }
    });
  }

  // NOOP : depuis v6.23 le wrap utilise CSS grid pour empiler les slides dans
  // une même cellule. La cellule prend la hauteur du plus grand slide, donc
  // plus besoin de sync JS. Gardé comme stub pour compat appels existants.
  function syncWrapHeight() { /* no-op */ }

  // Relance les animations inline (bars, shine, etc.) sur les slides visités
  // après le boot. Nécessaire car certains navigateurs (et headless) figent
  // les animations sur les éléments créés hors viewport (tous les slides sont
  // créés au boot avec opacity:0). On retire puis rend la règle `animation`
  // pour forcer un replay.
  function replayInlineAnimations(slide) {
    if (!slide) return;
    const nodes = slide.querySelectorAll('[style*="animation"]');
    nodes.forEach(n => {
      const orig = n.style.animation;
      if (!orig) return;
      n.style.animation = 'none';
      // Force reflow pour que 'none' prenne effet
      // eslint-disable-next-line no-unused-expressions
      n.offsetWidth;
      n.style.animation = orig;
    });
  }

  function goToSlide(newIdx, dir) {
    if (newIdx < 0 || newIdx >= SLIDE_COUNT) return;
    const prev = slidesWrap.querySelectorAll('.fp-onb-slide')[currentIdx];
    const next = slidesWrap.querySelectorAll('.fp-onb-slide')[newIdx];
    if (!prev || !next) return;

    prev.classList.remove('active', 'ready');
    prev.classList.add(dir === 'right' ? 'leaving-left' : 'leaving-right');
    // Clear counter cache for the departing slide so it re-plays if revisited
    for (const k of counterCache.keys()) {
      if (k.startsWith(currentIdx + '-')) counterCache.delete(k);
    }

    next.classList.remove('leaving-left', 'leaving-right', 'entering-left', 'entering-right');
    next.classList.add(dir === 'right' ? 'entering-right' : 'entering-left');

    // Force reflow
    // eslint-disable-next-line no-unused-expressions
    next.offsetWidth;

    // Double-RAF avec setTimeout fallback (certains navigateurs headless
    // suspendent RAF quand le tab perd le focus — on sécurise avec setTimeout).
    const promoteActive = () => {
      next.classList.remove('entering-left', 'entering-right');
      next.classList.add('active');
      // Reset scroll pour que les slides longs démarrent en haut
      if (slidesWrap) slidesWrap.scrollTop = 0;
      // Relance les animations des demos inline (bars, cards) qui peuvent
      // avoir été "consommées" au boot quand le slide était invisible.
      replayInlineAnimations(next);
      setTimeout(() => {
        next.classList.add('ready');
        animateCounters(next, newIdx);
        animateTyping(next);
      }, 380);
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(promoteActive);
    }
    // Toujours un fallback setTimeout pour contrer les RAF throttled
    setTimeout(() => {
      if (!next.classList.contains('active')) promoteActive();
    }, 50);

    // Update dots
    dotsEl.querySelectorAll('.fp-onb-dot').forEach((d, i) => d.classList.toggle('active', i === newIdx));

    // Update progress bar
    const pct = ((newIdx + 1) / SLIDE_COUNT) * 100;
    progressBar.style.width = pct + '%';

    // Update tint via CSS custom prop on overlay
    overlay.style.setProperty('--onb-tint', activeSlides[newIdx].tint);

    // Tilt the background radial positions for dynamism
    const bg1x = 30 + Math.cos(newIdx / SLIDE_COUNT * Math.PI * 2) * 20;
    const bg2x = 70 + Math.sin(newIdx / SLIDE_COUNT * Math.PI * 2) * 20;
    overlay.style.setProperty('--onb-bg1-x', bg1x + '%');
    overlay.style.setProperty('--onb-bg2-x', bg2x + '%');

    currentIdx = newIdx;
    renderActions();
    try { prev.querySelector('.fp-onb-btn-next')?.blur(); } catch {}
  }

  function finish(opts = {}) {
    overlay.classList.remove('open');
    if (opts.skipped) {
      // Mark as "run" so we don't show again this session, but allow future runs
    } else {
      // Celebration pattern
      haptic([18, 50, 18, 50, 40]);
    }
    if (keyHandler) { window.removeEventListener('keydown', keyHandler); keyHandler = null; }
    unlockScroll();
    setTimeout(() => {
      if (overlay && overlay.parentElement) {
        overlay.remove();
        overlay = null;
      }
    }, 500);
  }

  function wireKeyboard() {
    if (keyHandler) return;
    keyHandler = (e) => {
      if (!overlay || !overlay.classList.contains('open')) return;
      if (e.key === 'Escape') { e.preventDefault(); confirmDismiss(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); if (currentIdx < SLIDE_COUNT - 1) { haptic(10); goToSlide(currentIdx + 1, 'right'); } else finish(); }
      else if (e.key === 'ArrowLeft')  { e.preventDefault(); if (currentIdx > 0) { haptic(10); goToSlide(currentIdx - 1, 'left'); } }
    };
    window.addEventListener('keydown', keyHandler);
  }

  // ─── Public API ───────────────────────────────────────────────
  // customSlides optionnel: si fourni, lance un tour avec ce set de slides
  // au lieu du tour principal. Utilisé pour BP cible pays et Sources data.
  // Si un tour est déjà ouvert, il est fermé et remplacé par le nouveau.
  function startOnboardingTour(customSlides) {
    // Si un tour déjà ouvert avec les mêmes slides, no-op (évite double-click)
    const nextSlides = (Array.isArray(customSlides) && customSlides.length) ? customSlides : SLIDES;
    if (overlay && overlay.classList.contains('open') && activeSlides === nextSlides) return;
    // Nettoie l'overlay existant (d'un autre tour ou ancien instance) avant rebuild
    if (overlay) {
      try { overlay.remove(); } catch {}
      overlay = null; card = null; slidesWrap = null; dotsEl = null;
      progressBar = null; skipBtn = null; nextBtn = null; actionsRow = null;
      counterCache.clear();
      if (keyHandler) { try { window.removeEventListener('keydown', keyHandler); } catch {} keyHandler = null; }
      try { unlockScroll(); } catch {}
    }
    activeSlides = nextSlides;
    SLIDE_COUNT = activeSlides.length;
    buildOverlay();
    currentIdx = 0;

    // Initial state: show first slide
    const first = slidesWrap.querySelectorAll('.fp-onb-slide')[0];
    first.classList.add('active');
    dotsEl.querySelectorAll('.fp-onb-dot')[0].classList.add('active');
    overlay.style.setProperty('--onb-tint', activeSlides[0].tint);
    progressBar.style.width = (1 / SLIDE_COUNT * 100) + '%';

    lockScroll();
    wireKeyboard();

    // Force a layout so the browser registers the initial (closed) state
    // BEFORE we add the .open class — otherwise the opacity transition
    // can be skipped in certain browser/headless environments.
    void overlay.offsetWidth;
    syncWrapHeight(first);
    setTimeout(() => {
      overlay.classList.add('open');
      setTimeout(() => {
        first.classList.add('ready');
        animateCounters(first, 0);
        animateTyping(first);
        syncWrapHeight(first);
      }, 380);
    }, 30);
    // Resync sur resize (rotation mobile, clavier virtuel, etc.)
    if (!window.__fpOnbResizeBound) {
      window.addEventListener('resize', () => {
        const active = slidesWrap?.querySelector('.fp-onb-slide.active');
        if (active) syncWrapHeight(active);
      });
      window.__fpOnbResizeBound = true;
    }
    haptic(12);
  }

  function maybeStartOnboardingTour(userId) {
    try {
      const count = getCount(userId);
      if (count >= MAX_RUNS) return false;
      bumpCount(userId);
      // Delay slightly so the app UI is rendered before the tour covers it
      setTimeout(() => startOnboardingTour(), 600);
      return true;
    } catch { return false; }
  }

  function resetOnboardingTour(userId) {
    resetCount(userId);
    console.log('[FP onboarding] Counter reset' + (userId ? ' for ' + userId : ' (all users)') + '.');
  }

  window.startOnboardingTour = startOnboardingTour;
  window.maybeStartOnboardingTour = maybeStartOnboardingTour;
  window.resetOnboardingTour = resetOnboardingTour;
  // Tours secondaires: BP cible pays et Sources de données (même infrastructure,
  // slides différents). Accessibles depuis showDemoPanel.
  window.startBpTour = () => startOnboardingTour(SLIDES_BP);
  window.startSourcesTour = () => startOnboardingTour(SLIDES_SOURCES);

  // ─── Auto-trigger on login events ─────────────────────────────
  // The app dispatches `fp:login-success` from doLogin() and checkAuth() (see index.html).
  //
  // URL params (convenience, power-user shortcuts):
  //   ?tour=reset  — reset counter for current user then start the tour
  //   ?tour=1      — force-start the tour regardless of counter (no write)
  function handleTourURL(email) {
    try {
      const params = new URLSearchParams(location.search);
      const tourParam = params.get('tour');
      if (!tourParam) return false;
      if (tourParam === 'reset') {
        resetCount(email);
        // Clean the URL so a refresh doesn't re-trigger
        const u = new URL(location.href); u.searchParams.delete('tour');
        history.replaceState({}, '', u.pathname + u.search);
      }
      if (tourParam === 'reset' || tourParam === '1' || tourParam === 'start') {
        setTimeout(() => startOnboardingTour(), 500);
        return true;
      }
    } catch {}
    return false;
  }

  window.addEventListener('fp:login-success', (ev) => {
    const email = ev?.detail?.email || ev?.detail?.user?.email || 'anonymous';
    if (handleTourURL(email)) return;
    maybeStartOnboardingTour(email);
  });
})();
