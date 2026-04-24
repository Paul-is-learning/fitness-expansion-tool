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

  // IRR par méthode Newton-Raphson + bissection (copié/adapté du moteur BPEngine).
  // L'outil a déjà IRR en tant que fonction Excel (cashflows annuels) — on la
  // réutilise via BPEngine._internals.irr pour rester 1:1 avec Excel.
  function irr(cashflows) {
    if (!cashflows || cashflows.length < 2) return null;
    const fn = global.BPEngine?._internals?.irr;
    if (typeof fn === 'function') {
      try { const v = fn(cashflows); return isFinite(v) ? v : null; } catch { return null; }
    }
    return null;
  }

  function extractKPIs() {
    // PL_CLUB_TYPE (club unitaire) : A1..A10 = cols C..L.
    // C'est le VRAI P&L pertinent pour analyser un site — PL_CONSO cumule
    // plusieurs clubs ouverts sur l'horizon du master-franchisé et gonfle
    // artificiellement les chiffres Y5 (~ 5-6× un club seul).
    const kCols = ['C','D','E','F','G','H','I','J','K','L'];
    const rowCa     = findRow(plClubRowsCache, ['total ca - ligne p&l', 'total ca -', 'total ca  -', 'total ca']);
    const rowEb     = findRow(plClubRowsCache, ['ebitda']);                // row 34
    const rowMarg   = findRow(plClubRowsCache, ['marge ebitda']);          // row 35
    const rowNet    = findRow(plClubRowsCache, ['resultat net']);          // row 41
    const rowOpCF   = findRow(plClubRowsCache, ['operating cf', 'operating cash flow']);
    const ca     = readRowPerYear('PL_CLUB_TYPE', rowCa,    kCols);
    const ebitda = readRowPerYear('PL_CLUB_TYPE', rowEb,    kCols);
    const marg   = readRowPerYear('PL_CLUB_TYPE', rowMarg,  kCols);
    const net    = readRowPerYear('PL_CLUB_TYPE', rowNet,   kCols);
    const opCF   = readRowPerYear('PL_CLUB_TYPE', rowOpCF,  kCols);

    // RETRAITEMENT CAPEX — la maquette Excel répète `=-HYPOTHESES!$C$81`
    // dans PL_CLUB_TYPE!C45..L45, ce qui comptabilise 10× le CAPEX sur
    // l'horizon. Décision Paul : le CAPEX est **Y1 uniquement**. On lit
    // la valeur brute dans HYPOTHESES!C81 et on la met uniquement en Y1.
    // Le net CF / cumul / payback / TRI sont recalculés ici (pas lus dans
    // les rows 47-48 qui héritent du bug).
    const capexTotal = getVal('HYPOTHESES', 'C81');  // ex: 1176000
    const capexY1 = (capexTotal != null && isFinite(capexTotal)) ? -Math.abs(capexTotal) : 0;
    const capex = Array(kCols.length).fill(0);
    capex[0] = capexY1;

    // Operating CF par année : préfère row 46 (Operating CF) qui est =EBITDA
    // dans la maquette, sinon fallback EBITDA.
    const opCFClean = (opCF || []).map((v, i) => (v != null ? v : (ebitda[i] || 0)));

    // Net CF par année = Op CF + CAPEX (Y1 seul)
    const netCF = opCFClean.map((v, i) => v + (capex[i] || 0));

    // Cumul net CF recalculé
    const cumul = [];
    let sum = 0;
    for (const v of netCF) { sum += v; cumul.push(sum); }

    // Payback (par club) = 1re année où cash cumulé >= 0.
    let payback = null;
    for (let i = 0; i < cumul.length; i++) {
      if (cumul[i] != null && cumul[i] >= 0) { payback = i + 1; break; }
    }

    // TRI par club = IRR(netCF). Y0 = CAPEX, Yi = Op CF après impôt (approx
    // via le netCF retraité). Pour un IRR bancable on prendrait le résultat
    // net + DAP, mais ici on reste sur le cash flow simple Op CF - CAPEX Y1.
    let tri10Club = null;
    if (netCF.every(v => v != null)) {
      tri10Club = irr(netCF);
    }

    return {
      ca, ebitda, ebitdaMargin: marg, netResult: net, netCashCumul: cumul,
      ca5: ca[4], ebitda5: ebitda[4], ebitdaMargin5: marg[4], netResult5: net[4],
      tri10: tri10Club,
      tri10Consolidated: getVal('DCF_COMPARAISON', 'E42'),  // dispo pour info
      paybackYear: payback,
      capex, netCF,
      capexTotal: capexY1,
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
