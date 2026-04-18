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
  const SLIDE_COUNT = 8;
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

    .fp-onb-slides-wrap { position: relative; flex: 1; min-height: 280px; }

    /* ═══ DEMO: Welcome logo stroke-draw + sparks ═══ */
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
      width: var(--fill-target, 40%);
    }
    .fp-onb-demo-sliders .thumb {
      position: absolute; top: 50%; width: 14px; height: 14px; border-radius: 50%;
      background: white;
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--onb-tint,#d4a017) 40%, transparent), 0 2px 6px rgba(0,0,0,.4);
      transform: translate(-50%, -50%);
      left: var(--fill-target, 40%);
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
      stroke-dasharray: 1000;
      stroke-dashoffset: var(--dashoffset, 400);
    }
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
      width: var(--fill, 50%);
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
      width: 30%;
    }
    .fp-onb-demo-fin .ln {
      background: linear-gradient(90deg, #60a5fa, #3b82f6);
      width: 70%;
    }
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
      width: 136px; height: 230px;
      background: #0a0d17;
      border: 2px solid rgba(255,255,255,.12);
      border-radius: 22px;
      padding: 8px;
      transform: perspective(700px) rotateY(-12deg) rotateX(4deg);
      box-shadow: -15px 20px 50px rgba(0,0,0,.6),
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
      border-radius: 14px;
      padding: 18px 10px 10px;
      display: flex; flex-direction: column; gap: 10px;
    }
    .fp-onb-demo-phone .search {
      background: rgba(30,41,59,.7);
      border: 1px solid rgba(212,160,23,.3);
      border-radius: 9px;
      padding: 7px 9px;
      font-size: 10px; color: rgba(255,255,255,.85);
      min-height: 22px;
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
      padding: 8px 9px;
      background: rgba(212,160,23,.1);
      border: 1px solid rgba(212,160,23,.35);
      border-radius: 9px;
      font-size: 10px; color: rgba(255,255,255,.9);
      font-weight: 600;
    }
    .fp-onb-demo-phone .drop {
      width: 14px; height: 14px; border-radius: 50%;
      background: var(--onb-tint,#d4a017);
      position: absolute; bottom: 24px; left: 50%;
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

    /* ═══ Responsive ═══ */
    @media (max-width: 480px) {
      .fp-onb-card { padding: 24px 20px 18px; border-radius: 28px; }
      .fp-onb-title { font-size: 22px; }
      .fp-onb-subtitle { font-size: 13px; }
      .fp-onb-slides-wrap { min-height: 280px; }
      .fp-onb-demo { min-height: 150px; }
      .fp-onb-demo-pins { height: 148px; }
      .fp-onb-demo-phone { width: 118px; height: 200px; }
      .fp-onb-demo-saz { width: 150px; height: 150px; }
      .fp-onb-demo-ready { width: 140px; height: 140px; }
      .fp-onb-btn-next { min-height: 44px; font-size: 14px; }
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
  const SLIDES = [
    {
      tint: '#d4a017',
      eyebrow: 'BIENVENUE',
      title: 'FP Romania Expansion Intelligence',
      subtitle: 'L\'outil qui transforme 5 sites en décisions chiffrées. En 30 secondes par site, tu as un go / no-go défendable.',
      demo: demoWelcome,
      cta: 'Découvrir'
    },
    {
      tint: '#d4a017',
      eyebrow: 'CARTE LIVE',
      title: '5 sites priorisés, Bucharest',
      subtitle: 'Hala Laminor, Unirea, Militari, Grand Arena, Baneasa. Pins numérotés, swipe pour comparer, analyse auto en 1 tap.',
      demo: demoPins,
      cta: 'Suivant'
    },
    {
      tint: '#34d399',
      eyebrow: 'SIMULATION TEMPS RÉEL',
      title: 'Sliders loyer · charges · surface',
      subtitle: 'Ajuste les 3 paramètres par site. IRR, NPV, CAF, EBITDA recalculent en 90ms. Persistance par site, survit au reload.',
      demo: demoSliders,
      cta: 'Suivant'
    },
    {
      tint: '#60a5fa',
      eyebrow: 'SCORE ATTRACTIVITÉ',
      title: 'SAZ · flux · densité · jeunesse',
      subtitle: '3 anneaux animés qui résument la zone. Population captage 3 km + concurrents + démographie 15-45 ans.',
      demo: demoSaz,
      cta: 'Suivant'
    },
    {
      tint: '#f97316',
      eyebrow: 'P&L 3 SCÉNARIOS',
      title: 'Conservateur · Base · Optimiste',
      subtitle: 'CA annuel, EBITDA, IRR projet, NPV, breakeven, payback. Modèle calibré OnAir Montreuil (franchise audité Fiteco).',
      demo: demoPnl,
      cta: 'Suivant'
    },
    {
      tint: '#d4a017',
      eyebrow: 'FINANCEMENT',
      title: 'IRR Projet vs IRR Equity',
      subtitle: '30/70 equity/loan, 6,5% sur 7 ans. Effet levier calculé, intérêts cumulés modélisés, pitch banquier ready.',
      demo: demoFinancing,
      cta: 'Suivant'
    },
    {
      tint: '#a78bfa',
      eyebrow: 'SITES CUSTOM',
      title: 'Ajoute une adresse, analyse auto',
      subtitle: 'Recherche une adresse → sélectionne → confirme. Captage, P&L, verdict IRR s\'affichent en 2 secondes.',
      demo: demoPhone,
      cta: 'Suivant'
    },
    {
      tint: '#22c55e',
      eyebrow: 'PRÊT',
      title: 'À toi la décision',
      subtitle: 'Slide en carousel, ajuste les variables, compare, défends ton dossier. Bon pitch.',
      demo: demoReady,
      cta: 'Commencer'
    },
  ];

  // ─── Demo builders ────────────────────────────────────────────
  function demoWelcome() {
    return `
      <div class="fp-onb-demo-welcome">
        <svg viewBox="0 0 160 160" aria-hidden="true">
          <defs>
            <linearGradient id="fpOnbLogoGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="#fff"/>
              <stop offset="1" stop-color="var(--onb-tint,#d4a017)"/>
            </linearGradient>
          </defs>
          <!-- "FP" monogram -->
          <path class="logo-stroke" d="M 40 50 L 40 110 M 40 50 L 72 50 M 40 75 L 66 75" fill="none" stroke="url(#fpOnbLogoGrad)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
          <path class="logo-stroke" d="M 92 110 L 92 50 L 112 50 Q 122 50 122 62 Q 122 74 112 74 L 92 74" fill="none" stroke="url(#fpOnbLogoGrad)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
          <!-- Sparks -->
          <circle class="spark" cx="30"  cy="40"  r="2.5" fill="#d4a017"/>
          <circle class="spark" cx="132" cy="36"  r="2"   fill="#fbbf24"/>
          <circle class="spark" cx="140" cy="80"  r="2.5" fill="#d4a017"/>
          <circle class="spark" cx="130" cy="126" r="2"   fill="#fbbf24"/>
          <circle class="spark" cx="40"  cy="130" r="2.5" fill="#d4a017"/>
          <circle class="spark" cx="22"  cy="90"  r="2"   fill="#fbbf24"/>
        </svg>
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
    return `
      <div class="fp-onb-demo-sliders" aria-hidden="true">
        <div class="row">
          <span>Loyer</span>
          <div class="track" style="--fill-target:55%"><div class="fill"></div><div class="thumb"></div></div>
          <span class="val">11,5 €/m²</span>
        </div>
        <div class="row">
          <span>Charges</span>
          <div class="track" style="--fill-target:44%"><div class="fill"></div><div class="thumb"></div></div>
          <span class="val">5,5 €/m²</span>
        </div>
        <div class="row">
          <span>Surface</span>
          <div class="track" style="--fill-target:38%"><div class="fill"></div><div class="thumb"></div></div>
          <span class="val">1 449 m²</span>
        </div>
        <div class="irr-card">
          <div><div class="l">IRR projet · recalc live</div></div>
          <div class="v" data-counter data-target="57.6" data-suffix="%">0%</div>
        </div>
      </div>
    `;
  }

  function demoSaz() {
    // 3 rings concentric with different radius + stroke-dashoffset target
    // Perimeter = 2πr : r1=72 → P=452, r2=58 → P=364, r3=44 → P=276
    return `
      <div class="fp-onb-demo-saz" aria-hidden="true">
        <svg viewBox="0 0 180 180" width="180" height="180">
          <circle class="ring r1" cx="90" cy="90" r="72" stroke="#06b6d4"
                  stroke-dasharray="452" style="--dashoffset:${Math.round(452 * (1 - 0.65))}"/>
          <circle class="ring r2" cx="90" cy="90" r="58" stroke="#22c55e"
                  stroke-dasharray="364" style="--dashoffset:${Math.round(364 * (1 - 0.69))}"/>
          <circle class="ring r3" cx="90" cy="90" r="44" stroke="#fbbf24"
                  stroke-dasharray="276" style="--dashoffset:${Math.round(276 * (1 - 0.37))}"/>
        </svg>
        <div class="score">
          <div class="n" data-counter data-target="70" data-suffix="">0</div>
          <div class="s">Score SAZ</div>
        </div>
      </div>
    `;
  }

  function demoPnl() {
    const data = [
      { lbl: 'Conservateur', c: '#f87171', irr: '+36%',  fill: '36%' },
      { lbl: 'Base',         c: '#d4a017', irr: '+57%',  fill: '57%' },
      { lbl: 'Optimiste',    c: '#34d399', irr: '+86%',  fill: '86%' },
    ];
    return `
      <div class="fp-onb-demo-pnl" aria-hidden="true">
        ${data.map(s => `
          <div class="s" style="--c:${s.c};--fill:${s.fill}">
            <div class="lbl">${s.lbl}</div>
            <div class="irr">${s.irr}</div>
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
        </div>
        <div class="drop"></div>
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

  // ─── Counter animation ────────────────────────────────────────
  const counterCache = new Map();  // slideIdx-elemIdx-target → done
  function animateCounters(slide, slideIdx) {
    const counters = slide.querySelectorAll('[data-counter]');
    counters.forEach((el, i) => {
      const target = parseFloat(el.dataset.target || '0');
      const suffix = el.dataset.suffix || '';
      const key = slideIdx + '-' + i + '-' + target;
      if (counterCache.has(key)) {
        el.textContent = target.toFixed(target % 1 === 0 ? 0 : 1) + suffix;
        return;
      }
      counterCache.set(key, true);
      // setInterval-based ease-out cubic (reliable across preview/headless where rAF can throttle).
      const duration = 950;
      const fps = 30;
      const tickMs = 1000 / fps;
      const start = Date.now();
      const timer = setInterval(() => {
        const t = Math.min(1, (Date.now() - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        const v = target * eased;
        el.textContent = v.toFixed(target % 1 === 0 ? 0 : 1) + suffix;
        if (t >= 1) clearInterval(timer);
      }, tickMs);
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
    SLIDES.forEach((s, i) => {
      const slide = document.createElement('div');
      slide.className = 'fp-onb-slide';
      slide.dataset.idx = i;
      slide.innerHTML = `
        <div class="fp-onb-eyebrow">${s.eyebrow}</div>
        <h2 class="fp-onb-title" ${i === 0 ? 'id="fp-onb-active-title"' : ''}>${s.title}</h2>
        <p class="fp-onb-subtitle">${s.subtitle}</p>
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
          <strong>Passer le tour ?</strong>
          <button class="no" type="button">Non</button>
          <button class="yes" type="button">Oui</button>
        </div>
      `;
      actionsRow.querySelector('.yes').addEventListener('click', confirmDismiss);
      actionsRow.querySelector('.no').addEventListener('click', cancelDismissConfirm);
      // Auto-rollback 3.5s
      confirmTimer = setTimeout(cancelDismissConfirm, 3500);
      return;
    }
    actionsRow.innerHTML = `
      <button class="fp-onb-btn-skip" type="button">Passer</button>
      <button class="fp-onb-btn-next" type="button">
        <span>${SLIDES[currentIdx]?.cta || 'Suivant'}</span>
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
    overlay.style.setProperty('--onb-tint', SLIDES[newIdx].tint);

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
  function startOnboardingTour() {
    if (overlay && overlay.classList.contains('open')) return;
    buildOverlay();
    currentIdx = 0;

    // Initial state: show first slide
    const first = slidesWrap.querySelectorAll('.fp-onb-slide')[0];
    first.classList.add('active');
    dotsEl.querySelectorAll('.fp-onb-dot')[0].classList.add('active');
    overlay.style.setProperty('--onb-tint', SLIDES[0].tint);
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

  // ─── Auto-trigger on login events ─────────────────────────────
  // The app dispatches `fp:login-success` from doLogin() and checkAuth() (see index.html).
  window.addEventListener('fp:login-success', (ev) => {
    const email = ev?.detail?.email || ev?.detail?.user?.email;
    maybeStartOnboardingTour(email || 'anonymous');
  });
})();
