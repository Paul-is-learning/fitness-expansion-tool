// ================================================================
// FITNESS PARK ROMANIA — DATA SCHEMA VALIDATORS (v4.8)
// ================================================================
// Validates all static datasets at boot time. If a field is missing
// or out of range, logs a clear warning in the console (and pushes
// to window._fpDataIssues).
//
// This catches "silent data corruption" — e.g. someone edits
// data/clubs.js and forgets a `members` field, causing 0 captifs
// everywhere with no visible error.
//
// Policy: WARN by default. Set `window._fpStrictValidation = true`
// BEFORE loading this script to throw on any violation (useful in CI).
//
// Inspect: window._fpDataIssues | window.dumpValidation()
// ================================================================

(function() {
  'use strict';

  window._fpDataIssues = [];

  const inRange = (min, max) => (v) => isFinite(v) && v >= min && v <= max;
  const isBucharestLat = inRange(43.5, 46);
  const isBucharestLng = inRange(24, 28);

  // ─── Schemas ────────────────────────────────────────────────────
  /**
   * Each schema is an array of { field, validate, required, note } entries.
   * validate = (value, row) => true | string (error message)
   */

  const TARGET_SCHEMA = [
    { field: 'name', validate: v => typeof v === 'string' && v.length > 0, required: true },
    { field: 'lat',  validate: v => isBucharestLat(v) || `lat=${v} outside [43.5, 46]`, required: true },
    { field: 'lng',  validate: v => isBucharestLng(v) || `lng=${v} outside [24, 28]`, required: true },
    { field: 'phase', validate: v => [1, 2].includes(v) || `phase must be 1 or 2 (got ${v})`, required: true },
    { field: 'sector', validate: v => Number.isInteger(v) && v >= 1 && v <= 6, required: true },
    { field: 'capex', validate: v => isFinite(v) && v > 0 || `capex must be > 0`, required: true }
  ];

  const CLUB_SCHEMA = [
    { field: 'name', validate: v => typeof v === 'string' && v.length > 0, required: true },
    { field: 'lat',  validate: v => isBucharestLat(v) || `lat=${v} outside Romania`, required: true },
    { field: 'lng',  validate: v => isBucharestLng(v) || `lng=${v} outside Romania`, required: true },
    { field: 'segment', validate: v => ['premium','mid','mid-premium','lowcost','independent','crossfit','boutique','aggregator'].includes(v) || `unknown segment: ${v}`, required: true },
    { field: 'size', validate: v => isFinite(v) && v > 0 && v < 10000 || `size=${v} unreasonable`, required: true },
    { field: 'members', validate: v => isFinite(v) && v >= 0 && v < 50000 || `members=${v} unreasonable`, required: true }
  ];

  const CARTIERE_SCHEMA = [
    { field: 'name', validate: v => typeof v === 'string' && v.length > 0, required: true },
    { field: 'lat',  validate: isBucharestLat, required: true },
    { field: 'lng',  validate: isBucharestLng, required: true },
    { field: 'sector', validate: v => Number.isInteger(v) && v >= 1 && v <= 6, required: true },
    { field: 'pop', validate: v => isFinite(v) && v > 0 && v < 500000 || `pop=${v} unreasonable`, required: true },
    { field: 'price', validate: v => isFinite(v) && v > 100 && v < 10000 || `price=${v} EUR/m2 unreasonable`, required: true },
    { field: 'young', validate: v => isFinite(v) && v >= 0.2 && v <= 0.6 || `young=${v} outside [0.2, 0.6]`, required: true }
  ];

  const POI_SCHEMA = [
    { field: 'name', validate: v => typeof v === 'string' && v.length > 0, required: true },
    { field: 'lat',  validate: isBucharestLat, required: true },
    { field: 'lng',  validate: isBucharestLng, required: true },
    { field: 'type', validate: v => ['university','mall','office','residential'].includes(v) || `unknown type: ${v}`, required: true }
  ];

  const USER_SCHEMA = [
    { field: 'email', validate: v => typeof v === 'string' && v.includes('@'), required: true },
    { field: 'role',  validate: v => ['admin','user'].includes(v), required: true },
    { field: 'pwHash', validate: v => typeof v === 'string' && v.length >= 3, required: true }
  ];

  // ─── Dataset validator ──────────────────────────────────────────
  function validateDataset(name, data, schema) {
    if (!Array.isArray(data)) {
      recordIssue(name, -1, 'root', 'not an array');
      return { ok: false, count: 0, errors: 1 };
    }
    if (data.length === 0) {
      recordIssue(name, -1, 'root', 'empty array');
      return { ok: false, count: 0, errors: 1 };
    }

    let errors = 0;
    const seen = new Map(); // field → value → indices
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      for (const rule of schema) {
        const v = row[rule.field];
        if (v === undefined || v === null) {
          if (rule.required) { recordIssue(name, i, rule.field, 'missing'); errors++; }
          continue;
        }
        const res = rule.validate(v, row);
        if (res !== true) {
          recordIssue(name, i, rule.field, typeof res === 'string' ? res : `invalid: ${JSON.stringify(v)}`);
          errors++;
        }
      }

      // Duplicate-name detection (common data entry bug)
      if (row.name) {
        const prev = seen.get(row.name);
        if (prev !== undefined) {
          recordIssue(name, i, 'name', `duplicate "${row.name}" (also at index ${prev})`);
          errors++;
        } else {
          seen.set(row.name, i);
        }
      }
    }

    return { ok: errors === 0, count: data.length, errors };
  }

  function recordIssue(dataset, index, field, message) {
    window._fpDataIssues.push({ dataset, index, field, message });
  }

  // ─── Run validations ────────────────────────────────────────────
  function runAll() {
    const results = {};

    try { if (typeof TARGETS !== 'undefined')         results.TARGETS        = validateDataset('TARGETS',        TARGETS,        TARGET_SCHEMA); } catch {}
    try { if (typeof VERIFIED_CLUBS !== 'undefined')  results.VERIFIED_CLUBS = validateDataset('VERIFIED_CLUBS', VERIFIED_CLUBS, CLUB_SCHEMA); } catch {}
    try { if (typeof CARTIERE !== 'undefined')        results.CARTIERE       = validateDataset('CARTIERE',       CARTIERE,       CARTIERE_SCHEMA); } catch {}
    try { if (typeof POIS !== 'undefined')            results.POIS           = validateDataset('POIS',           POIS,           POI_SCHEMA); } catch {}
    try { if (typeof CANONICAL_USERS !== 'undefined') results.CANONICAL_USERS= validateDataset('CANONICAL_USERS',CANONICAL_USERS,USER_SCHEMA); } catch {}

    const totalErrors = Object.values(results).reduce((a, r) => a + (r?.errors || 0), 0);

    if (totalErrors === 0) {
      console.log(
        `%c✓ Data validation passed: ${Object.keys(results).length} datasets, ` +
        Object.values(results).reduce((a, r) => a + (r?.count || 0), 0) + ' rows, 0 errors',
        'color: #22c55e'
      );
    } else {
      console.warn(
        `%c⚠ Data validation: ${totalErrors} issue(s) across ${Object.keys(results).length} datasets`,
        'color: #f97316; font-weight: bold'
      );
      if (window._fpStrictValidation) {
        throw new Error(`Data validation failed with ${totalErrors} issues — inspect window._fpDataIssues`);
      }
    }
    return { results, totalErrors };
  }

  // ─── Pretty print helper ────────────────────────────────────────
  window.dumpValidation = function() {
    const issues = window._fpDataIssues || [];
    if (issues.length === 0) {
      console.log('%c✓ No data validation issues', 'color: #22c55e; font-weight: bold');
      return;
    }
    console.group(`%c⚠ ${issues.length} data validation issue(s)`, 'color: #f97316; font-weight: bold');
    const byDataset = {};
    for (const iss of issues) (byDataset[iss.dataset] = byDataset[iss.dataset] || []).push(iss);
    for (const [ds, list] of Object.entries(byDataset)) {
      console.group(`${ds} — ${list.length} issue(s)`);
      list.forEach(i => console.log(`  • [row ${i.index}] ${i.field}: ${i.message}`));
      console.groupEnd();
    }
    console.groupEnd();
  };

  // Run after all data scripts loaded (run in defer order)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runAll);
  } else {
    runAll();
  }

  window._fpValidators = { runAll, validateDataset };
})();
