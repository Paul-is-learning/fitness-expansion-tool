// ================================================================
// FITNESS PARK ROMANIA — AUDIT LOG (v4.8)
// ================================================================
// Records every call to runCaptageAnalysis with inputs + outputs +
// timestamp + user. Stored in sessionStorage (wiped on tab close).
//
// Purpose:
//   - Reproducibility: given an audit entry, you can replay the
//     analysis deterministically with exact same inputs.
//   - Debug: if a user says "I saw 35.5 NO-GO for Hala Laminor",
//     ask them to run window.exportAudit() and send us the JSON.
//   - Non-regression: before a deploy, run exportAudit(), redeploy,
//     rerun, diff. Any changed number must be explained.
//
// Limits: keeps last 100 entries (trims oldest) to avoid blowing
// sessionStorage quota.
//
// API:
//   window.exportAudit()         → full log as JSON string
//   window.exportAuditCsv()      → key metrics as CSV
//   window.clearAudit()          → wipe
//   window.replayAudit(entry)    → run the analysis again with same inputs
// ================================================================

(function() {
  'use strict';

  const KEY = 'fpAuditLog';
  const MAX = 100;

  function load() {
    try { return JSON.parse(sessionStorage.getItem(KEY) || '[]'); }
    catch { return []; }
  }
  function save(log) {
    try { sessionStorage.setItem(KEY, JSON.stringify(log)); }
    catch (e) { console.warn('[FP audit] save failed:', e.message); }
  }

  function record(entry) {
    const log = load();
    log.push(entry);
    while (log.length > MAX) log.shift();
    save(log);
  }

  function getUser() {
    try {
      const u = JSON.parse(sessionStorage.getItem('fpCurrentUser') || 'null');
      return u ? u.email : 'anonymous';
    } catch { return 'anonymous'; }
  }

  // ─── Wrap runCaptageAnalysis to record each call ───────────────
  function installWrapper() {
    if (typeof window.runCaptageAnalysis !== 'function') return false;
    if (window.runCaptageAnalysis.__fpAuditWrapped) return true;

    const original = window.runCaptageAnalysis;
    window.runCaptageAnalysis = function auditedRunCaptageAnalysis(lat, lng, captageRadius) {
      const t0 = performance.now();
      const result = original(lat, lng, captageRadius);
      const t1 = performance.now();

      // Record a COMPACT summary (not the full result — too much data)
      const entry = {
        ts: new Date().toISOString(),
        user: getUser(),
        modelVersion: typeof MODEL_VERSION !== 'undefined' ? MODEL_VERSION : 'unknown',
        durationMs: Math.round(t1 - t0),
        inputs: { lat, lng, captageRadius: captageRadius || 3000 },
        outputs: {
          members: result?.totalTheorique,
          captifs: result?.totalCaptifs,
          natifs: result?.native?.captured,
          walkIn: result?.walkIn?.walkInMembers,
          destBonus: result?.destinationBonus?.bonusMembers,
          compCount: result?.comps?.length,
          popTarget: result?.popTarget,
          saz: result?.saz ? { flux: result.saz.flux, densite: result.saz.densite, jeunesse: result.saz.jeunesse } : null,
          arpu: result?.arpu,
          churnRate: result?.churnRate,
          ltv: result?.ltv,
          ltvCac: result?.ltvCacRatio,
          irrBase: result?.pnl?.base?.irr,
          npvBase: result?.pnl?.base?.npv,
          breakevenBase: result?.pnl?.base?.breakevenMonth,
          paybackBase: result?.pnl?.base?.paybackMonth
        },
        rentOverride: window._rentOverride?.y1 || null
      };
      try { record(entry); } catch (e) { console.warn('[FP audit]', e); }
      return result;
    };
    // Preserve flag from invariants wrapper if present
    window.runCaptageAnalysis.__fpAuditWrapped = true;
    window.runCaptageAnalysis.__fpWrapped = original.__fpWrapped || window.runCaptageAnalysis.__fpWrapped;
    return true;
  }

  function tryInstall(tries = 0) {
    if (installWrapper()) return;
    if (tries > 20) return;
    setTimeout(() => tryInstall(tries + 1), 300);
  }

  if (document.readyState === 'complete') tryInstall();
  else window.addEventListener('load', () => tryInstall());

  // ─── Public API ────────────────────────────────────────────────
  window.exportAudit = function() {
    const log = load();
    const json = JSON.stringify(log, null, 2);
    console.log(`%c📋 Audit log: ${log.length} entries`, 'color: #d4a017; font-weight: bold');
    try {
      navigator.clipboard?.writeText(json);
      console.log('Copied to clipboard.');
    } catch {}
    return json;
  };

  window.exportAuditCsv = function() {
    const log = load();
    if (log.length === 0) return '';
    const headers = ['ts','user','lat','lng','radius','members','captifs','natifs','walkIn','destBonus','irrBase','npvBase','durationMs'];
    const rows = log.map(e => [
      e.ts, e.user,
      e.inputs?.lat, e.inputs?.lng, e.inputs?.captageRadius,
      e.outputs?.members, e.outputs?.captifs, e.outputs?.natifs, e.outputs?.walkIn, e.outputs?.destBonus,
      e.outputs?.irrBase, e.outputs?.npvBase,
      e.durationMs
    ].join(','));
    return headers.join(',') + '\n' + rows.join('\n');
  };

  window.clearAudit = function() {
    sessionStorage.removeItem(KEY);
    console.log('Audit log cleared.');
  };

  window.replayAudit = function(entry) {
    if (!entry || !entry.inputs) { console.warn('Invalid audit entry'); return null; }
    if (typeof runCaptageAnalysis !== 'function') { console.warn('runCaptageAnalysis not available'); return null; }
    const { lat, lng, captageRadius } = entry.inputs;
    const fresh = runCaptageAnalysis(lat, lng, captageRadius);
    const originalMembers = entry.outputs?.members;
    const newMembers = fresh?.totalTheorique;
    const drift = newMembers - originalMembers;
    console.log(`Replay @ (${lat},${lng}): original=${originalMembers}, now=${newMembers}, drift=${drift}`);
    return { original: entry.outputs, fresh, drift };
  };

  window._fpAudit = { load, record, MAX };
})();
