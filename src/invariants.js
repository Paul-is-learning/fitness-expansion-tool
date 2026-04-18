// ================================================================
// FITNESS PARK ROMANIA — RUNTIME INVARIANTS (v4.8)
// ================================================================
// Wraps critical analysis functions with post-call sanity checks.
// On violation: warn in console + push to window._fpIssues +
// emit a `fp:invariant-violation` event (listenable for telemetry).
//
// Invariants are NON-BLOCKING: the analysis still returns its result.
// This is a watchdog, not a gatekeeper. Use validators.js for boot-time
// checks that SHOULD prevent app startup.
//
// To inspect violations at runtime:
//   window._fpIssues          // array of all issues since page load
//   window.dumpInvariants()   // pretty-print
// ================================================================

(function() {
  'use strict';

  window._fpIssues = [];
  const TOLERANCE = 2; // allowed rounding drift (members)

  /**
   * Register one invariant check.
   * @param {string} id              Short machine-readable id
   * @param {string} description     Human-readable what it checks
   * @param {Function} predicate     (ctx, result) => true | string (error message)
   */
  const INVARIANTS = [];
  function addInvariant(id, description, predicate) {
    INVARIANTS.push({ id, description, predicate });
  }

  // ─── Invariants on runCaptageAnalysis return value ─────────────
  addInvariant('ana.total-sum',
    'totalTheorique must equal captifs + natifs + walkIn + destBonus',
    (ctx, r) => {
      const expected = (r.totalCaptifs || 0)
                     + (r.native?.captured || 0)
                     + (r.walkIn?.walkInMembers || 0)
                     + (r.destinationBonus?.bonusMembers || 0);
      const diff = Math.abs(r.totalTheorique - expected);
      return diff <= TOLERANCE || `totalTheorique=${r.totalTheorique} but sum=${expected} (diff=${diff})`;
    });

  addInvariant('ana.captifs-sum',
    'totalCaptifs must equal sum of comps[].captured',
    (ctx, r) => {
      if (!Array.isArray(r.comps)) return true;
      const s = r.comps.reduce((a, c) => a + (c.captured || 0), 0);
      const diff = Math.abs(r.totalCaptifs - s);
      return diff <= TOLERANCE || `totalCaptifs=${r.totalCaptifs} but sum=${s} (diff=${diff})`;
    });

  addInvariant('ana.no-nan',
    'No NaN/Infinity in key numerics',
    (ctx, r) => {
      const keys = ['totalTheorique', 'totalCaptifs', 'popTarget', 'currentPenetration', 'arpu', 'churnY1', 'churnRate', 'ltv', 'ltvCacRatio'];
      for (const k of keys) {
        const v = r[k];
        if (v === undefined) continue;
        if (!isFinite(v)) return `${k} is not finite: ${v}`;
      }
      return true;
    });

  addInvariant('ana.saz-bounds',
    'SAZ scores must be ∈ [0, 100]',
    (ctx, r) => {
      const s = r.saz || {};
      for (const k of ['flux', 'densite', 'jeunesse']) {
        const v = s[k];
        if (v === undefined || v === null) continue;
        if (v < -0.01 || v > 100.01) return `saz.${k}=${v} out of [0,100]`;
      }
      return true;
    });

  addInvariant('ana.arpu-sanity',
    'ARPU must be in reasonable range (€10 – €80/month)',
    (ctx, r) => {
      if (r.arpu === undefined || r.arpu === null) return true;
      if (r.arpu < 10 || r.arpu > 80) return `arpu=${r.arpu} out of [10, 80]`;
      return true;
    });

  addInvariant('ana.churn-bounds',
    'Churn rates must be ∈ [0, 1]',
    (ctx, r) => {
      for (const k of ['churnY1', 'churnRate']) {
        const v = r[k];
        if (v === undefined || v === null) continue;
        if (v < -0.001 || v > 1.001) return `${k}=${v} out of [0,1]`;
      }
      return true;
    });

  addInvariant('ana.pop-nonneg',
    'popTarget must be ≥ 0',
    (ctx, r) => (r.popTarget === undefined || r.popTarget >= 0) || `popTarget=${r.popTarget} is negative`);

  addInvariant('ana.irr-sanity',
    'IRR must be finite and in [-100, 500]',
    (ctx, r) => {
      const pnls = r.pnl;
      if (!pnls) return true;
      for (const key of Object.keys(pnls)) {
        const irr = pnls[key]?.irr;
        if (irr === undefined || irr === null) continue;
        if (!isFinite(irr)) return `pnl.${key}.irr not finite: ${irr}`;
        if (irr < -100.01 || irr > 500) return `pnl.${key}.irr=${irr} unreasonable`;
      }
      return true;
    });

  addInvariant('ana.ltv-positive',
    'LTV must be positive if we have members',
    (ctx, r) => {
      if (!r.ltv || r.ltv === undefined) return true;
      if (r.totalTheorique > 0 && r.ltv <= 0) return `ltv=${r.ltv} with members=${r.totalTheorique}`;
      return true;
    });

  addInvariant('ana.inputs-valid',
    'Input lat/lng/radius must be valid',
    (ctx, r) => {
      if (ctx.lat === undefined || ctx.lng === undefined) return true;
      if (!isFinite(ctx.lat) || !isFinite(ctx.lng)) return `invalid coords lat=${ctx.lat} lng=${ctx.lng}`;
      if (ctx.lat < 43 || ctx.lat > 46) return `lat=${ctx.lat} outside Romania range [43,46]`;
      if (ctx.lng < 25 || ctx.lng > 27) return `lng=${ctx.lng} outside Bucharest-region range [25,27]`;
      if (ctx.captageRadius !== undefined && (ctx.captageRadius < 500 || ctx.captageRadius > 15000))
        return `captageRadius=${ctx.captageRadius} outside [500m, 15km]`;
      return true;
    });

  // ─── Run all invariants against a result ───────────────────────
  function check(ctx, result) {
    const failures = [];
    for (const inv of INVARIANTS) {
      let res;
      try { res = inv.predicate(ctx, result); }
      catch (e) { res = `invariant threw: ${e.message}`; }
      if (res !== true) failures.push({ id: inv.id, message: res, description: inv.description });
    }
    if (failures.length) {
      const issue = {
        ts: new Date().toISOString(),
        fn: ctx.fn,
        inputs: { lat: ctx.lat, lng: ctx.lng, captageRadius: ctx.captageRadius },
        failures
      };
      window._fpIssues.push(issue);
      console.warn('[FP invariant]', issue);
      window.dispatchEvent(new CustomEvent('fp:invariant-violation', { detail: issue }));
    }
    return failures;
  }

  // ─── Wrap runCaptageAnalysis ───────────────────────────────────
  function installWrappers() {
    if (typeof window.runCaptageAnalysis !== 'function') {
      // Function not loaded yet; retry
      return false;
    }
    if (window.runCaptageAnalysis.__fpWrapped) return true;

    const original = window.runCaptageAnalysis;
    window.runCaptageAnalysis = function wrappedRunCaptageAnalysis(lat, lng, captageRadius) {
      const result = original(lat, lng, captageRadius);
      try {
        check({ fn: 'runCaptageAnalysis', lat, lng, captageRadius }, result);
      } catch (e) {
        console.warn('[FP invariant] check threw:', e);
      }
      return result;
    };
    window.runCaptageAnalysis.__fpWrapped = true;
    return true;
  }

  // Install after everything loads
  function tryInstall(tries = 0) {
    if (installWrappers()) return;
    if (tries > 20) {
      console.warn('[FP invariants] failed to install wrappers after 20 retries');
      return;
    }
    setTimeout(() => tryInstall(tries + 1), 300);
  }

  if (document.readyState === 'complete') tryInstall();
  else window.addEventListener('load', () => tryInstall());

  // ─── Pretty-print helper for debugging ─────────────────────────
  window.dumpInvariants = function() {
    const issues = window._fpIssues || [];
    if (issues.length === 0) {
      console.log('%c✓ No invariant violations since page load', 'color: #22c55e; font-weight: bold');
      return;
    }
    console.group(`%c⚠ ${issues.length} invariant violation(s)`, 'color: #f97316; font-weight: bold');
    issues.forEach((issue, i) => {
      console.group(`[${i + 1}] ${issue.ts} — ${issue.fn} @ (${issue.inputs.lat}, ${issue.inputs.lng})`);
      issue.failures.forEach(f => console.log(`  • ${f.id}: ${f.message}`));
      console.groupEnd();
    });
    console.groupEnd();
  };

  window._fpInvariants = { INVARIANTS, check, addInvariant };
})();
