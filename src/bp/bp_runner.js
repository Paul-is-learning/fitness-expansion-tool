// ================================================================
// BP RUNNER — wrapper réutilisable autour de BPEngine
// ================================================================
// Permet à n'importe quelle page d'exécuter un scénario BP en
// injectant seulement les 4 variables métier du site (surface,
// loyer €/m²/mois, charges €/m²/mois, targetMembers) sans
// reconstruire le DAG ni recharger l'IR entre deux runs.
//
// Usage :
//   await BPRunner.init();               // lazy, 1 seule fois
//   const kpis = BPRunner.run({
//     surface: 1800,
//     loyerM2Month: 10.5,
//     chargesM2Month: 5.5,
//     targetMembers: 4200,
//   });
//
// Retourne { ca[10], ebitda[10], ebitdaMargin[10], netResult[10],
//           netCashCumul[10], ca5, ebitda5, ebitdaMargin5,
//           netResult5, tri5, tri10, paybackYear, elapsedMs }
// ================================================================

(function(global) {
  'use strict';

  let model = null;
  let baselineSnapshot = null;   // clone figé des values au baseline
  let plConsoRowsCache = null;   // rows trouvés une fois (labels ne bougent pas)
  let plClubRowsCache = null;
  let loadPromise = null;

  const IR_URL = 'src/bp/bp_ir.json';

  function cacheBustedUrl() {
    const v = (typeof global.MODEL_VERSION !== 'undefined') ? global.MODEL_VERSION : Date.now();
    return IR_URL + '?v=' + encodeURIComponent(v);
  }

  async function init() {
    if (model) return model;
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      if (!global.BPEngine || !global.BPEngine.Model) {
        throw new Error('BPRunner: BPEngine not loaded (expected src/bp/engine.js)');
      }
      const ir = await fetch(cacheBustedUrl()).then(r => {
        if (!r.ok) throw new Error('BPRunner: IR fetch failed (' + r.status + ')');
        return r.json();
      });
      model = new global.BPEngine.Model(ir);
      model.evaluateAll();
      // Snapshot initial — référence immuable (values sont des primitifs ou ExcelError)
      baselineSnapshot = Object.assign({}, model.values);
      // Index label→row une fois (les labels col A ne changent jamais)
      plConsoRowsCache = indexPLRows('PL_CONSO');
      plClubRowsCache  = indexPLRows('PL_CLUB_TYPE');
      return model;
    })();
    return loadPromise;
  }

  function isReady() { return !!model; }

  function restoreBaseline() {
    // On réécrit chaque clé depuis le snapshot → évite la pollution entre scénarios.
    for (const k in baselineSnapshot) {
      model.values[k] = baselineSnapshot[k];
    }
  }

  function applyOverrides(overrides) {
    for (const [coord, v] of Object.entries(overrides || {})) {
      model.values['HYPOTHESES!' + coord] = v;
    }
  }

  function reEvaluate() {
    const ctx = { sheet: null, get: (sh, coord) => {
      const kk = sh + '!' + coord.replace(/\$/g, '').toUpperCase();
      return (kk in model.values) ? model.values[kk] : 0;
    }};
    for (const k of model.order) {
      const entry = model.formulas[k];
      if (entry.parseError) continue;
      ctx.sheet = entry.sheet;
      try {
        model.values[k] = global.BPEngine.evaluate(entry.ast, ctx);
      } catch (e) {
        model.values[k] = e;
      }
    }
  }

  function getVal(sheet, coord) {
    const v = model.values[sheet + '!' + coord];
    if (v == null) return null;
    if (v instanceof Error) return null;
    if (typeof v === 'number' && !isFinite(v)) return null;
    return v;
  }

  // Build label→row map pour un onglet donné (col A = labels).
  function indexPLRows(sheetName) {
    const sheet = model.ir.sheets[sheetName];
    if (!sheet) return {};
    const labelMap = {};
    for (const [coord, c] of Object.entries(sheet.cells)) {
      if (c.t !== 's' || !coord.startsWith('A')) continue;
      const row = parseInt(coord.slice(1), 10);
      labelMap[(c.v || '').toString().toLowerCase().trim()] = row;
    }
    return labelMap;
  }

  // Priorité des patterns : on retourne le 1er pattern qui matche un label.
  function findRow(labelMap, patterns) {
    for (const p of patterns) {
      const needle = p.toLowerCase();
      for (const [lbl, row] of Object.entries(labelMap)) {
        if (lbl.includes(needle)) return row;
      }
    }
    return null;
  }

  function readRowPerYear(sheetName, row, cols) {
    if (!row) return Array(cols.length).fill(null);
    return cols.map(c => getVal(sheetName, c + row));
  }

  function extractKPIs() {
    // PL_CONSO : A1..A10 = cols D..M
    const cCols = ['D','E','F','G','H','I','J','K','L','M'];
    const rowCa     = findRow(plConsoRowsCache, ['total ca consolide', 'ca conso']);
    const rowEb     = findRow(plConsoRowsCache, ['ebitda consolide', 'ebitda conso']);
    const rowMarg   = findRow(plConsoRowsCache, ['marge ebitda / ca conso', 'marge ebitda']);
    const rowNet    = findRow(plConsoRowsCache, ['resultat net consolide', 'resultat net conso']);
    const rowCumul  = findRow(plConsoRowsCache, ['net cash flow cumule']);
    const ca     = readRowPerYear('PL_CONSO', rowCa,    cCols);
    const ebitda = readRowPerYear('PL_CONSO', rowEb,    cCols);
    const marg   = readRowPerYear('PL_CONSO', rowMarg,  cCols);
    const net    = readRowPerYear('PL_CONSO', rowNet,   cCols);
    const cumul  = readRowPerYear('PL_CONSO', rowCumul, cCols);

    // Payback = 1re année où cumul >= 0
    let payback = null;
    for (let i = 0; i < cumul.length; i++) {
      if (cumul[i] != null && cumul[i] >= 0) { payback = i + 1; break; }
    }

    // Club type (référence, utile pour le tableau côte à côte)
    const kCols = ['C','D','E','F','G','H','I','J','K','L'];
    const rowClubCa  = findRow(plClubRowsCache, ['total ca club', 'ca total', 'ca club']);
    const rowClubEb  = findRow(plClubRowsCache, ['ebitda club', 'ebitda']);
    const rowClubNet = findRow(plClubRowsCache, ['resultat net club', 'resultat net', 'net']);

    return {
      ca, ebitda, ebitdaMargin: marg, netResult: net, netCashCumul: cumul,
      ca5: ca[4], ebitda5: ebitda[4], ebitdaMargin5: marg[4], netResult5: net[4],
      tri5:  getVal('DCF_COMPARAISON', 'E28'),
      tri10: getVal('DCF_COMPARAISON', 'E42'),
      paybackYear: payback,
      club: {
        ca:     readRowPerYear('PL_CLUB_TYPE', rowClubCa,  kCols),
        ebitda: readRowPerYear('PL_CLUB_TYPE', rowClubEb,  kCols),
        net:    readRowPerYear('PL_CLUB_TYPE', rowClubNet, kCols),
      },
    };
  }

  // Transforme les 4 variables métier en overrides de coord BP HYPOTHESES.
  function paramsToOverrides(params) {
    const o = {};
    const surface = (params.surface != null) ? Number(params.surface) : null;
    if (surface != null && isFinite(surface) && surface > 0) {
      o.C50 = surface;
    }
    const loyerM2 = (params.loyerM2Month != null) ? Number(params.loyerM2Month) : null;
    if (loyerM2 != null && isFinite(loyerM2) && surface) {
      o.C51 = loyerM2 * surface; // EUR/mois absolu pour C51
    } else if (params.loyerMonthly != null) {
      o.C51 = Number(params.loyerMonthly);
    }
    const chargesM2 = (params.chargesM2Month != null) ? Number(params.chargesM2Month) : null;
    if (chargesM2 != null && isFinite(chargesM2) && surface) {
      o.C52 = chargesM2 * surface;
    } else if (params.chargesMonthly != null) {
      o.C52 = Number(params.chargesMonthly);
    }
    if (params.targetMembers != null) {
      const t = Number(params.targetMembers);
      if (isFinite(t) && t > 0) o.C34 = Math.round(t);
    }
    if (params.extraOverrides) Object.assign(o, params.extraOverrides);
    return o;
  }

  // Exécute un scénario : restore → apply → re-eval → extract.
  function run(params) {
    if (!model) throw new Error('BPRunner.run() called before init()');
    const t0 = performance.now();
    restoreBaseline();
    const overrides = paramsToOverrides(params || {});
    applyOverrides(overrides);
    reEvaluate();
    const kpis = extractKPIs();
    kpis.elapsedMs = performance.now() - t0;
    kpis.appliedOverrides = overrides;
    return kpis;
  }

  function getBaselineInput(coord) {
    if (!baselineSnapshot) return null;
    return baselineSnapshot['HYPOTHESES!' + coord];
  }

  global.BPRunner = { init, isReady, run, getBaselineInput };
})(window);
