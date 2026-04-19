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
    .fp-onb-slide { position: absolute; top: 0; left: 0; right: 0;
      opacity: 0; pointer-events: none;
      transform: translateX(0);
      transition: opacity .35s ease-out, transform .45s cubic-bezier(.22,.96,.36,1);
    }
    .fp-onb-slide.active { opacity: 1; pointer-events: auto; transform: translateX(0); }
    .fp-onb-slide.leaving-left  { opacity: 0; transform: translateX(-34px); pointer-events: none; }
    .fp-onb-slide.leaving-right { opacity: 0; transform: translateX(34px); pointer-events: none; }
    .fp-onb-slide.entering-left  { opacity: 0; transform: translateX(-34px); pointer-events: none; }
    .fp-onb-slide.entering-right { opacity: 0; transform: translateX(34px); pointer-events: none; }

    .fp-onb-slides-wrap { position: relative; flex: 1; min-height: 340px; }

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
    @keyframes fpOnbWidthGrow   { to { width: var(--w, 50%); } }
    @keyframes fpOnbCardIn      { to { opacity: 1; transform: translateY(0) scale(1); } }
    @keyframes fpOnbRingDraw    { to { stroke-dashoffset: var(--to, 0); } }
    @keyframes fpOnbRingDrawSmall { to { stroke-dashoffset: var(--to, 0); } }
    @keyframes fpOnbCheckDraw   { to { stroke-dashoffset: var(--to, 0); } }

    /* ═══ Responsive ═══ */
    @media (max-width: 480px) {
      .fp-onb-card { padding: 24px 20px 18px; border-radius: 28px; }
      .fp-onb-title { font-size: 22px; }
      .fp-onb-subtitle { font-size: 13px; }
      /* min-height augmenté pour accommoder sliders + IRR card sans chevaucher dots */
      .fp-onb-slides-wrap { min-height: 340px; }
      .fp-onb-demo { min-height: 150px; margin-bottom: 16px; }
      .fp-onb-demo-pins { height: 148px; }
      .fp-onb-demo-phone { width: 104px; height: 168px; }
      .fp-onb-demo-saz { width: 150px; height: 150px; }
      .fp-onb-demo-ready { width: 140px; height: 140px; }
      .fp-onb-btn-next { min-height: 44px; font-size: 14px; }
      /* Sliders demo: labels + values compacts pour ne pas déborder sur 375px */
      .fp-onb-demo-sliders { max-width: 100%; }
      .fp-onb-demo-sliders .row {
        grid-template-columns: 56px 1fr minmax(60px, auto);
        gap: 8px; font-size: 10px;
      }
      .fp-onb-demo-sliders .val { min-width: 0; font-size: 10.5px; }
      .fp-onb-demo-sliders .irr-card { padding: 10px 12px; }
      .fp-onb-demo-sliders .irr-card .v { font-size: 18px; }
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
      <div class="fp-onb-demo-bp-intro" style="display:flex;flex-direction:column;align-items:center;gap:14px;padding:10px 0">
        <img src="${fpLogo}" alt="Fitness Park" style="height:42px;width:auto;filter:drop-shadow(0 4px 12px rgba(212,160,23,.25));opacity:0;animation:fpOnbFadeIn .6s ease .1s forwards">
        <div style="font-size:11px;letter-spacing:2.5px;color:rgba(212,160,23,.8);font-weight:700">BP V17 · ROMANIA</div>
        <div class="fp-onb-demo-bp-stats" style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;width:100%;max-width:340px">
          <div style="background:rgba(24,32,52,.85);border-radius:10px;padding:10px 6px;text-align:center;border:1px solid rgba(255,255,255,.08)"><div style="font-size:18px;font-weight:900;color:var(--onb-tint)"><span data-counter data-target="40" data-delay="300">0</span></div><div style="font-size:8.5px;letter-spacing:.6px;color:rgba(255,255,255,.55);text-transform:uppercase;margin-top:2px">clubs A8</div></div>
          <div style="background:rgba(24,32,52,.85);border-radius:10px;padding:10px 6px;text-align:center;border:1px solid rgba(255,255,255,.08)"><div style="font-size:18px;font-weight:900;color:var(--onb-tint)"><span data-counter data-target="51.3" data-format="fr-decimal" data-suffix=" M€" data-delay="500">0</span></div><div style="font-size:8.5px;letter-spacing:.6px;color:rgba(255,255,255,.55);text-transform:uppercase;margin-top:2px">CA A10</div></div>
          <div style="background:rgba(24,32,52,.85);border-radius:10px;padding:10px 6px;text-align:center;border:1px solid rgba(255,255,255,.08)"><div style="font-size:18px;font-weight:900;color:#34d399"><span data-counter data-target="9.6" data-format="fr-decimal" data-suffix=" M€" data-delay="700">0</span></div><div style="font-size:8.5px;letter-spacing:.6px;color:rgba(255,255,255,.55);text-transform:uppercase;margin-top:2px">EBITDA A10</div></div>
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
      <div style="display:flex;flex-direction:column;gap:6px;width:100%">
        ${rows.map((r,i)=>`<div class="fp-onb-bp-row" style="display:grid;grid-template-columns:1.2fr auto;gap:10px;align-items:center;padding:8px 12px;background:rgba(24,32,52,.8);border-radius:8px;border-left:3px solid ${r.c};border-right:1px solid rgba(255,255,255,.06);border-top:1px solid rgba(255,255,255,.06);border-bottom:1px solid rgba(255,255,255,.06);opacity:0;transform:translateX(-10px);animation:fpOnbSlideIn .5s cubic-bezier(.34,1.12,.52,1) ${0.1 + i*0.1}s forwards"><div><div style="font-size:11px;font-weight:700;color:#fff">${r.lbl}</div><div style="font-size:9px;color:rgba(255,255,255,.5);margin-top:2px">${r.sub}</div></div><div style="font-size:14px;font-weight:900;color:${r.c};font-variant-numeric:tabular-nums">${r.val}</div></div>`).join('')}
      </div>
    `;
  }

  function demoBpRevenue() {
    // Courbe ramp-up CA sur 10 ans (clubs × prix × ramp-up)
    const years = [0.4, 1.9, 4.9, 11.5, 18.9, 31.0, 40.5, 45.8, 49.0, 51.3];
    const max = 52;
    return `
      <div style="width:100%;display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:3px;height:120px;padding:0 2px;border-bottom:1px solid rgba(255,255,255,.1)">
          ${years.map((v,i)=>`<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px"><div style="width:100%;height:${Math.round(v/max*100)}%;background:linear-gradient(180deg, var(--onb-tint), rgba(212,160,23,.4));border-radius:3px 3px 0 0;transform:scaleY(0);transform-origin:bottom;animation:fpOnbBarGrow .8s cubic-bezier(.34,1.12,.52,1) ${0.05 + i*0.08}s forwards"></div><div style="font-size:8px;color:rgba(255,255,255,.5);font-weight:600">A${i+1}</div></div>`).join('')}
        </div>
        <div style="display:flex;justify-content:space-between;padding:0 4px;font-size:10px;color:rgba(255,255,255,.65)">
          <span>CA · M€</span><span style="color:var(--onb-tint);font-weight:700"><span data-counter data-target="51.3" data-format="fr-decimal" data-suffix=" M€ A10" data-delay="900">0</span></span>
        </div>
      </div>
    `;
  }

  function demoBpCosts() {
    // Structure de coûts % CA (benchmark OnAir calibré)
    const costs = [
      { lbl: 'Staff',        pct: 9,    c: '#60a5fa' },
      { lbl: 'Loyer + charges', pct: 12.4, c: '#f97316' },
      { lbl: 'OPEX ops',     pct: 12,   c: '#34d399' },
      { lbl: 'Royalties MF', pct: 6,    c: '#a78bfa' },
      { lbl: 'Fonds pub',    pct: 1,    c: '#fbbf24' },
    ];
    const total = costs.reduce((a,c)=>a+c.pct, 0);
    return `
      <div style="width:100%;display:flex;flex-direction:column;gap:10px">
        ${costs.map((c,i)=>`<div style="opacity:0;transform:translateX(-8px);animation:fpOnbSlideIn .5s cubic-bezier(.34,1.12,.52,1) ${0.1+i*0.1}s forwards"><div style="display:flex;justify-content:space-between;align-items:baseline;font-size:10.5px;margin-bottom:3px"><span style="color:#fff;font-weight:700">${c.lbl}</span><span style="color:${c.c};font-weight:800">${c.pct}% du CA</span></div><div style="height:6px;background:rgba(255,255,255,.06);border-radius:3px;overflow:hidden"><div style="height:100%;background:${c.c};width:0;animation:fpOnbWidthGrow ${0.8 + i*0.1}s cubic-bezier(.34,1.12,.52,1) ${0.15 + i*0.1}s forwards;--w:${(c.pct/20)*100}%"></div></div></div>`).join('')}
        <div style="margin-top:4px;padding-top:8px;border-top:1px solid rgba(255,255,255,.1);display:flex;justify-content:space-between;font-size:11px;font-weight:800"><span style="color:#fff">Total OPEX</span><span style="color:var(--onb-tint)">${total.toFixed(1)}% · EBITDA 55%+</span></div>
      </div>
    `;
  }

  function demoBpCapex() {
    // CAPEX 1176k€ = fit-out 840 (71%) + équipement 336 (29%)
    return `
      <div style="width:100%;display:flex;flex-direction:column;gap:14px;align-items:center">
        <div style="display:flex;align-items:center;gap:16px">
          <svg viewBox="0 0 120 120" width="120" height="120" style="transform:rotate(-90deg)">
            <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="14"/>
            <circle cx="60" cy="60" r="50" fill="none" stroke="#d4a017" stroke-width="14" stroke-dasharray="314" stroke-dashoffset="314" style="animation:fpOnbRingDraw 1.2s cubic-bezier(.34,1.12,.52,1) .3s forwards;--to:91"/>
            <circle cx="60" cy="60" r="50" fill="none" stroke="#60a5fa" stroke-width="14" stroke-dasharray="314" stroke-dashoffset="314" transform="rotate(260 60 60)" style="animation:fpOnbRingDrawSmall 1.2s cubic-bezier(.34,1.12,.52,1) .6s forwards;--to:223"/>
          </svg>
          <div style="display:flex;flex-direction:column;gap:6px;font-size:11px">
            <div style="display:flex;align-items:center;gap:6px"><span style="width:10px;height:10px;background:#d4a017;border-radius:2px"></span><span style="color:#fff;font-weight:700">Fit-out</span><span style="color:rgba(255,255,255,.55)">840 k€ · 600€/m² × 1 400m²</span></div>
            <div style="display:flex;align-items:center;gap:6px"><span style="width:10px;height:10px;background:#60a5fa;border-radius:2px"></span><span style="color:#fff;font-weight:700">Équipement</span><span style="color:rgba(255,255,255,.55)">336 k€ · 60% en leasing 5 ans</span></div>
          </div>
        </div>
        <div style="text-align:center"><div style="font-size:10px;color:rgba(255,255,255,.55);letter-spacing:.8px;text-transform:uppercase">CAPEX total / club</div><div style="font-size:22px;font-weight:900;color:var(--onb-tint);margin-top:2px"><span data-counter data-target="1176" data-format="fr-thousands" data-suffix=" k€" data-delay="800">0</span></div></div>
      </div>
    `;
  }

  function demoBpMonteCarlo() {
    // Distribution IRR équité — histogramme simulé 1000 runs
    // Moyenne ~57%, écart-type ~12%, distribution normale
    const bars = [3, 8, 16, 28, 44, 58, 72, 88, 95, 92, 78, 60, 42, 26, 14, 6];
    const maxBar = 100;
    return `
      <div style="width:100%;display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;align-items:flex-end;gap:2px;height:100px;padding:0 4px;border-bottom:1px solid rgba(255,255,255,.1)">
          ${bars.map((v,i)=>`<div style="flex:1;height:${Math.round(v/maxBar*100)}%;background:linear-gradient(180deg, #a78bfa, rgba(167,139,250,.3));border-radius:2px 2px 0 0;transform:scaleY(0);transform-origin:bottom;animation:fpOnbBarGrow .6s cubic-bezier(.34,1.12,.52,1) ${0.05 + i*0.04}s forwards"></div>`).join('')}
        </div>
        <div style="display:flex;justify-content:space-between;font-size:9px;color:rgba(255,255,255,.5);padding:0 4px">
          <span>20%</span><span>40%</span><span style="color:var(--onb-tint);font-weight:800">57% médiane</span><span>80%</span><span>100%</span>
        </div>
        <div style="background:rgba(167,139,250,.1);border:1px solid rgba(167,139,250,.3);border-radius:8px;padding:8px 10px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;font-size:10px">
          <div><div style="color:rgba(255,255,255,.5);font-size:8.5px;text-transform:uppercase;letter-spacing:.5px">P10</div><div style="color:#fff;font-weight:800;margin-top:2px">+38%</div></div>
          <div><div style="color:rgba(255,255,255,.5);font-size:8.5px;text-transform:uppercase;letter-spacing:.5px">Médiane</div><div style="color:#a78bfa;font-weight:800;margin-top:2px">+57%</div></div>
          <div><div style="color:rgba(255,255,255,.5);font-size:8.5px;text-transform:uppercase;letter-spacing:.5px">P90</div><div style="color:#fff;font-weight:800;margin-top:2px">+79%</div></div>
        </div>
        <div style="font-size:9.5px;color:rgba(255,255,255,.5);text-align:center;font-style:italic">1 000 simulations · variables: prix, membres, loyer, churn, delay ouverture</div>
      </div>
    `;
  }

  function demoBpVerdict() {
    // Verdict final BP avec IRR/NPV + confetti
    return `
      <div style="width:100%;display:flex;flex-direction:column;gap:14px;align-items:center">
        <div style="width:100px;height:100px;border-radius:50%;background:radial-gradient(circle, rgba(34,197,94,.2), transparent 70%);display:flex;align-items:center;justify-content:center;position:relative">
          <svg viewBox="0 0 80 80" width="80" height="80">
            <circle cx="40" cy="40" r="34" fill="none" stroke="#22c55e" stroke-width="4" stroke-dasharray="214" stroke-dashoffset="214" stroke-linecap="round" style="animation:fpOnbRingDraw 1s cubic-bezier(.34,1.12,.52,1) .2s forwards;--to:0"/>
            <path d="M 26 40 L 36 52 L 56 30" fill="none" stroke="#22c55e" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="48" stroke-dashoffset="48" style="animation:fpOnbCheckDraw .5s cubic-bezier(.34,1.12,.52,1) .9s forwards;--to:0"/>
          </svg>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;width:100%;max-width:320px">
          <div style="background:rgba(24,32,52,.85);border-radius:10px;padding:10px 6px;text-align:center;border:1px solid rgba(255,255,255,.08);border-top:2px solid #22c55e"><div style="font-size:16px;font-weight:900;color:#22c55e"><span data-counter data-target="57.6" data-format="fr-decimal" data-prefix="+" data-suffix="%" data-delay="1100">+0%</span></div><div style="font-size:8px;letter-spacing:.6px;color:rgba(255,255,255,.55);text-transform:uppercase;margin-top:2px">IRR équité</div></div>
          <div style="background:rgba(24,32,52,.85);border-radius:10px;padding:10px 6px;text-align:center;border:1px solid rgba(255,255,255,.08);border-top:2px solid #d4a017"><div style="font-size:16px;font-weight:900;color:#d4a017"><span data-counter data-target="3.9" data-format="fr-decimal" data-suffix=" M€" data-delay="1300">0</span></div><div style="font-size:8px;letter-spacing:.6px;color:rgba(255,255,255,.55);text-transform:uppercase;margin-top:2px">NPV 5 ans</div></div>
          <div style="background:rgba(24,32,52,.85);border-radius:10px;padding:10px 6px;text-align:center;border:1px solid rgba(255,255,255,.08);border-top:2px solid #60a5fa"><div style="font-size:16px;font-weight:900;color:#60a5fa"><span data-counter data-target="38" data-suffix=" mois" data-delay="1500">0</span></div><div style="font-size:8px;letter-spacing:.6px;color:rgba(255,255,255,.55);text-transform:uppercase;margin-top:2px">Payback</div></div>
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
      <div style="width:100%;display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
        ${srcs.map((s,i)=>`<div style="background:rgba(24,32,52,.85);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:10px 6px;text-align:center;opacity:0;transform:translateY(10px) scale(.95);animation:fpOnbCardIn .5s cubic-bezier(.34,1.56,.52,1) ${0.1 + i*0.08}s forwards"><div style="font-size:22px;margin-bottom:4px">${s.icon}</div><div style="font-size:11px;font-weight:800;color:#fff">${s.name}</div><div style="font-size:9px;color:rgba(255,255,255,.55);margin-top:2px;line-height:1.3">${s.desc}</div></div>`).join('')}
      </div>
    `;
  }

  function demoDataPop() {
    return `
      <div style="width:100%;display:flex;flex-direction:column;gap:10px">
        <div style="background:rgba(24,32,52,.85);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:12px;opacity:0;animation:fpOnbFadeIn .5s ease .1s forwards">
          <div style="font-size:10px;letter-spacing:.6px;color:#60a5fa;text-transform:uppercase;font-weight:800">INS Census 2021</div>
          <div style="margin-top:6px;display:flex;align-items:baseline;gap:8px"><span style="font-size:22px;font-weight:900;color:#fff"><span data-counter data-target="1716961" data-format="fr-thousands" data-delay="200">0</span></span><span style="font-size:11px;color:rgba(255,255,255,.65)">habitants recensés</span></div>
          <div style="font-size:9.5px;color:rgba(255,255,255,.5);margin-top:3px">6 secteurs · 83 quartiers (cartiere)</div>
        </div>
        <div style="background:rgba(24,32,52,.85);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:12px;opacity:0;animation:fpOnbFadeIn .5s ease .35s forwards">
          <div style="font-size:10px;letter-spacing:.6px;color:#34d399;text-transform:uppercase;font-weight:800">+ Navetteurs Ilfov</div>
          <div style="margin-top:6px;display:flex;align-items:baseline;gap:8px"><span style="font-size:22px;font-weight:900;color:#fff">×<span data-counter data-target="1.7" data-format="fr-decimal" data-delay="400">0</span></span><span style="font-size:11px;color:rgba(255,255,255,.65)">pop réelle estimée</span></div>
          <div style="font-size:9.5px;color:rgba(255,255,255,.5);margin-top:3px"><span data-counter data-target="2.9" data-format="fr-decimal" data-suffix=" M" data-delay="600">0</span> hab. effective (census + non-déclarés + expats)</div>
        </div>
        <div style="background:rgba(24,32,52,.85);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:12px;opacity:0;animation:fpOnbFadeIn .5s ease .6s forwards">
          <div style="font-size:10px;letter-spacing:.6px;color:#a78bfa;text-transform:uppercase;font-weight:800">Volumétrie OSM</div>
          <div style="margin-top:6px;display:flex;align-items:baseline;gap:8px"><span style="font-size:22px;font-weight:900;color:#fff"><span data-counter data-target="397009" data-format="fr-thousands" data-delay="700">0</span></span><span style="font-size:11px;color:rgba(255,255,255,.65)">bâtiments</span></div>
          <div style="font-size:9.5px;color:rgba(255,255,255,.5);margin-top:3px">Pondération volumétrique · emprise × étages</div>
        </div>
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
      <div style="width:100%;display:flex;flex-direction:column;gap:8px">
        ${clubs.map((c,i)=>`<div style="display:grid;grid-template-columns:90px 1fr 40px;gap:8px;align-items:center;opacity:0;transform:translateX(-8px);animation:fpOnbSlideIn .4s cubic-bezier(.34,1.12,.52,1) ${0.1 + i*0.08}s forwards"><div style="font-size:10.5px;color:#fff;font-weight:700">${c.name}</div><div style="height:10px;border-radius:5px;background:rgba(255,255,255,.06);overflow:hidden"><div style="height:100%;background:${c.c};width:0;animation:fpOnbWidthGrow .7s cubic-bezier(.34,1.12,.52,1) ${0.2 + i*0.08}s forwards;--w:${Math.round(c.n/40*100)}%"></div></div><div style="font-size:10.5px;color:${c.c};font-weight:800;text-align:right">${c.n}</div></div>`).join('')}
        <div style="margin-top:6px;padding-top:8px;border-top:1px solid rgba(255,255,255,.1);display:flex;justify-content:space-between;font-size:10.5px"><span style="color:rgba(255,255,255,.6)">Total vérifié</span><span style="color:var(--onb-tint);font-weight:800">${total} clubs · Overpass API + check manuel</span></div>
      </div>
    `;
  }

  function demoDataFlux() {
    return `
      <div style="width:100%;display:flex;flex-direction:column;gap:10px">
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px">
          <div style="background:rgba(6,182,212,.1);border:1px solid rgba(6,182,212,.35);border-radius:10px;padding:10px;opacity:0;animation:fpOnbCardIn .5s cubic-bezier(.34,1.56,.52,1) .1s forwards"><div style="font-size:20px;margin-bottom:3px">🚇</div><div style="font-size:10px;letter-spacing:.4px;color:#06b6d4;font-weight:800;text-transform:uppercase">Métro Metrorex</div><div style="font-size:16px;font-weight:900;color:#fff;margin-top:4px"><span data-counter data-target="53" data-suffix=" stations" data-delay="300">0</span></div><div style="font-size:9px;color:rgba(255,255,255,.5);margin-top:2px">M1-M5 · 750k pax/jour</div></div>
          <div style="background:rgba(52,211,153,.1);border:1px solid rgba(52,211,153,.35);border-radius:10px;padding:10px;opacity:0;animation:fpOnbCardIn .5s cubic-bezier(.34,1.56,.52,1) .25s forwards"><div style="font-size:20px;margin-bottom:3px">🚋</div><div style="font-size:10px;letter-spacing:.4px;color:#34d399;font-weight:800;text-transform:uppercase">Tram/bus STB</div><div style="font-size:16px;font-weight:900;color:#fff;margin-top:4px"><span data-counter data-target="2.7" data-format="fr-decimal" data-suffix=" M" data-delay="450">0</span></div><div style="font-size:9px;color:rgba(255,255,255,.5);margin-top:2px">pax/jour · 7 corridors</div></div>
          <div style="background:rgba(249,115,22,.1);border:1px solid rgba(249,115,22,.35);border-radius:10px;padding:10px;opacity:0;animation:fpOnbCardIn .5s cubic-bezier(.34,1.56,.52,1) .4s forwards"><div style="font-size:20px;margin-bottom:3px">🛍️</div><div style="font-size:10px;letter-spacing:.4px;color:#f97316;font-weight:800;text-transform:uppercase">12 malls</div><div style="font-size:16px;font-weight:900;color:#fff;margin-top:4px"><span data-counter data-target="60000" data-format="fr-thousands" data-delay="600">0</span></div><div style="font-size:9px;color:rgba(255,255,255,.5);margin-top:2px">AFI Cotroceni / jour</div></div>
          <div style="background:rgba(167,139,250,.1);border:1px solid rgba(167,139,250,.35);border-radius:10px;padding:10px;opacity:0;animation:fpOnbCardIn .5s cubic-bezier(.34,1.56,.52,1) .55s forwards"><div style="font-size:20px;margin-bottom:3px">🏢</div><div style="font-size:10px;letter-spacing:.4px;color:#a78bfa;font-weight:800;text-transform:uppercase">Bureaux CBRE</div><div style="font-size:16px;font-weight:900;color:#fff;margin-top:4px"><span data-counter data-target="340000" data-format="fr-thousands" data-delay="750">0</span></div><div style="font-size:9px;color:rgba(255,255,255,.5);margin-top:2px">employés modernes</div></div>
        </div>
        <div style="font-size:9.5px;color:rgba(255,255,255,.55);text-align:center;font-style:italic">Google Routes API · isochrones 10 min marche/voiture/métro</div>
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
      <div style="width:100%;display:flex;flex-direction:column;gap:6px">
        ${hoods.map((h,i)=>`<div style="display:grid;grid-template-columns:80px 1fr auto;gap:8px;align-items:center;opacity:0;transform:translateX(-8px);animation:fpOnbSlideIn .4s cubic-bezier(.34,1.12,.52,1) ${0.1 + i*0.08}s forwards"><div style="font-size:10.5px;color:#fff;font-weight:700">${h.name}</div><div style="height:10px;border-radius:5px;background:rgba(255,255,255,.06);overflow:hidden"><div style="height:100%;background:${h.c};width:0;animation:fpOnbWidthGrow .7s cubic-bezier(.34,1.12,.52,1) ${0.2 + i*0.08}s forwards;--w:${Math.round(h.price/max*100)}%"></div></div><div style="font-size:10.5px;color:${h.c};font-weight:800;text-align:right">${h.price} €/m²</div></div>`).join('')}
        <div style="margin-top:6px;padding-top:8px;border-top:1px solid rgba(255,255,255,.1);font-size:9.5px;color:rgba(255,255,255,.55);text-align:center">Source : imobiliare.ro · investropa.com 2025 · proxy revenu/quartier</div>
      </div>
    `;
  }

  function demoDataRigor() {
    return `
      <div style="width:100%;display:flex;flex-direction:column;gap:10px;align-items:center">
        <div style="width:90px;height:90px;border-radius:50%;background:radial-gradient(circle, rgba(34,197,94,.2), transparent 70%);display:flex;align-items:center;justify-content:center">
          <svg viewBox="0 0 80 80" width="70" height="70"><circle cx="40" cy="40" r="34" fill="none" stroke="#22c55e" stroke-width="4" stroke-dasharray="214" stroke-dashoffset="214" stroke-linecap="round" style="animation:fpOnbRingDraw 1s cubic-bezier(.34,1.12,.52,1) .2s forwards;--to:0"/><path d="M 26 40 L 36 52 L 56 30" fill="none" stroke="#22c55e" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="48" stroke-dashoffset="48" style="animation:fpOnbCheckDraw .5s cubic-bezier(.34,1.12,.52,1) .9s forwards;--to:0"/></svg>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;width:100%">
          <div style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.25);border-radius:8px;font-size:10.5px;color:#fff;opacity:0;animation:fpOnbFadeIn .4s ease 1.1s forwards"><span style="color:#22c55e">✓</span>Cross-référence OSM × INS × Google</div>
          <div style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.25);border-radius:8px;font-size:10.5px;color:#fff;opacity:0;animation:fpOnbFadeIn .4s ease 1.3s forwards"><span style="color:#22c55e">✓</span>92 clubs validés manuellement</div>
          <div style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.25);border-radius:8px;font-size:10.5px;color:#fff;opacity:0;animation:fpOnbFadeIn .4s ease 1.5s forwards"><span style="color:#22c55e">✓</span>Modèle calibré OnAir Montreuil (Fiteco)</div>
          <div style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:rgba(249,115,22,.08);border:1px solid rgba(249,115,22,.25);border-radius:8px;font-size:10.5px;color:#fff;opacity:0;animation:fpOnbFadeIn .4s ease 1.7s forwards"><span style="color:#f97316">⚠</span>Limites assumées · onglet Sources</div>
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

    requestAnimationFrame(() => {
      next.classList.remove('entering-left', 'entering-right');
      next.classList.add('active');
      // Fire demo after slide-in so animations don't get clipped
      setTimeout(() => {
        next.classList.add('ready');
        animateCounters(next, newIdx);
        animateTyping(next);
      }, 380);
    });

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
    setTimeout(() => {
      overlay.classList.add('open');
      setTimeout(() => {
        first.classList.add('ready');
        animateCounters(first, 0);
        animateTyping(first);
      }, 380);
    }, 30);
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
