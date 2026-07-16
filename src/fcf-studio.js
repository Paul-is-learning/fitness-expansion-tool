// ═════════════════════════════════════════════════════════════════════
// FCF STUDIO (v6.71) — comparateur de scénarios financiers par site.
//
// Demande Paul (2026-07-15) : « comparer deux FCF d'un même site (avec ou
// sans dette, capex différents…), cocher/décocher/modifier des hypothèses
// en direct, sauvegarder. Conserver le modèle initial et les ajustements
// outil comme référence, TOUJOURS. »
//
// Architecture :
//   - 4 colonnes : RÉFÉRENCE BP (verrouillée, zéro override) ·
//     RÉGLAGES OUTIL (les sliders actuels de l'app, lecture seule ici) ·
//     SCÉNARIO A · SCÉNARIO B (bacs à sable éditables).
//   - Chaque hypothèse d'un scénario a une case "activée" : décochée →
//     la valeur de la RÉFÉRENCE s'applique (c'est le "décocher" demandé).
//   - Calcul 100% sandbox : computeWith() pose les overrides globaux,
//     exécute buildPnL (pur), puis RESTAURE tout dans un finally.
//     Rien n'est persisté, rien ne fuit — la baseline 197 tests garantit
//     que Référence = BP verrouillé à l'octet près.
//   - Sauvegarde : scénarios nommés par site (localStorage fpFcfScenarios)
//     + journalisation AuditLog (fcf.scenario-save).
//
// Dépendances globales (classic scripts, guards partout) : buildPnL,
// PNL_DEFAULTS, getEffectiveFinancing, fmt, Chart, AuditLog?,
// window._lastCaptageData / _lastCaptageLocation, overrides globaux.
// ═════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const LS_KEY = 'fpFcfScenarios';

  // ─── Définition des hypothèses éditables ────────────────────────
  // get(ref): valeur de référence (pour init + état "décoché")
  // apply(v): pose l'override global correspondant
  const HYPS = [
    { key: 'debt',    group: 'Financement', label: 'Dette bancaire', type: 'bool',
      hint: 'Décoché = 100% equity, aucun emprunt',
      get: () => true, fmt: v => v ? 'ON' : 'OFF' },
    { key: 'equity',  group: 'Financement', label: 'Apport (equity)', type: 'range', min: 10, max: 100, step: 5, unit: '%',
      hint: 'Part du CAPEX financée en fonds propres — le reste en dette',
      get: () => Math.round(PNL_DEFAULTS.financing.equityRatio * 100), fmt: v => v + '%' },
    { key: 'rate',    group: 'Financement', label: 'Taux d’intérêt', type: 'range', min: 0.5, max: 12, step: 0.25, unit: '%',
      hint: 'Taux annuel de l’emprunt (réf: 4% SG garantie BPI)',
      get: () => Math.round(PNL_DEFAULTS.financing.loanRate * 10000) / 100, fmt: v => v.toFixed(2) + '%' },
    { key: 'term',    group: 'Financement', label: 'Durée du prêt', type: 'range', min: 3, max: 15, step: 1, unit: 'ans',
      hint: 'Années d’amortissement de la dette',
      get: () => PNL_DEFAULTS.financing.loanTermYears, fmt: v => v + ' ans' },
    { key: 'capex',   group: 'Investissement', label: 'CAPEX', type: 'range', min: 600, max: 1800, step: 25, unit: 'k€',
      hint: 'Travaux + équipement (réf: 1 176 k€, scale avec la surface)',
      get: () => Math.round(PNL_DEFAULTS.capex / 1000), fmt: v => (typeof fmt === 'function' ? fmt(v) : v) + ' k€' },
    { key: 'exit',    group: 'Investissement', label: 'Multiple de sortie', type: 'range', min: 4, max: 12, step: 0.5, unit: '× EBITDA',
      hint: 'Valeur terminale = multiple × EBITDA A5 (réf: 8×)',
      get: () => PNL_DEFAULTS.exitMultiple, fmt: v => v + '×' },
    // v6.93 — droit d'entrée master-franchise (demande Paul, montant fourni :
    // 400 k€ HT). Simple case à cocher : ajouté au CAPEX du scénario et
    // financé selon sa structure apport/dette.
    { key: 'mf',      group: 'Investissement', label: 'Master-franchise', type: 'flag',
      hint: 'Droit d’entrée master-franchise : +400 k€ HT ajoutés au CAPEX, financés selon la structure du scénario',
      get: () => false, fmt: v => v ? '+400 k€ HT' : '—' },
    { key: 'rent',    group: 'Immobilier', label: 'Loyer Y1', type: 'range', min: 5, max: 25, step: 0.5, unit: '€/m²',
      hint: 'Palier Y1-Y2 — Y3/Y5 suivent proportionnellement',
      get: () => PNL_DEFAULTS.rentSteps.objectifNego[0].rent, fmt: v => v.toFixed(1) + ' €/m²' },
    { key: 'charges', group: 'Immobilier', label: 'Charges + mkt', type: 'range', min: 0, max: 12, step: 0.5, unit: '€/m²',
      hint: 'Charges locatives + fonds marketing du bailleur',
      get: () => PNL_DEFAULTS.rentSteps.serviceCharge + PNL_DEFAULTS.rentSteps.marketingFee, fmt: v => v.toFixed(1) + ' €/m²' },
    { key: 'surface', group: 'Immobilier', label: 'Surface', type: 'range', min: 800, max: 2500, step: 50, unit: 'm²',
      hint: 'Scale loyer annuel, CAPEX et leasing proportionnellement',
      get: () => PNL_DEFAULTS.rentSteps.surface, fmt: v => (typeof fmt === 'function' ? fmt(v) : v) + ' m²' },
  ];

  // ─── État runtime ────────────────────────────────────────────────
  // scénario = { name, hyp: {key: {on:bool, v:number|bool}} }
  let S = null; // {siteKey, siteName, cohort, avgPrice, ref, tool, A, B, chart}

  function defaultScenario(name) {
    const hyp = {};
    HYPS.forEach(h => { hyp[h.key] = { on: false, v: h.get() }; });
    return { name, hyp };
  }

  // ─── Sandbox compute ─────────────────────────────────────────────
  const MF_FEE = 400000; // droit d'entrée master-franchise, HT (montant Paul)

  // Pose les overrides du scénario, exécute fn(), restaure TOUT (finally).
  //   hyp == null   → référence BP (zéro override)
  //   hyp == 'tool' → réglages outil actuels (on ne touche à rien)
  function withOverrides(hyp, fn) {
    const saves = {
      rent: window._rentOverride, charge: window._chargeOverride,
      surf: window._surfaceOverride, fin: window._financingOverride,
      capex: window._capexOverride, exit: window._exitMultipleOverride,
      extra: window._capexExtraOverride,
    };
    try {
      if (hyp !== 'tool') {
        // repart de la référence BP pure…
        window._rentOverride = null; window._chargeOverride = null;
        window._surfaceOverride = null; window._financingOverride = null;
        window._capexOverride = null; window._exitMultipleOverride = null;
        window._capexExtraOverride = null;
        if (hyp) {
          // …puis applique les hypothèses ACTIVÉES du scénario
          // (g(k) peut être absent sur un scénario sauvegardé avant v6.93)
          const g = k => hyp[k] || { on: false, v: null };
          const finOn = g('equity').on || g('rate').on || g('term').on || g('debt').on;
          if (g('debt').on && g('debt').v === false) {
            window._financingOverride = { enabled: false };
          } else if (finOn) {
            window._financingOverride = {
              enabled: true,
              equityRatio: g('equity').on ? g('equity').v / 100 : PNL_DEFAULTS.financing.equityRatio,
              loanRate:    g('rate').on   ? g('rate').v / 100   : PNL_DEFAULTS.financing.loanRate,
              loanTermYears: g('term').on ? g('term').v         : PNL_DEFAULTS.financing.loanTermYears,
            };
          }
          if (g('capex').on)   window._capexOverride = { capex: g('capex').v * 1000 };
          if (g('exit').on)    window._exitMultipleOverride = { x: g('exit').v };
          if (g('rent').on)    window._rentOverride = { y1: g('rent').v };
          if (g('charges').on) window._chargeOverride = { chargeTotal: g('charges').v };
          if (g('surface').on) window._surfaceOverride = { surface: g('surface').v };
          if (g('mf').on && g('mf').v) window._capexExtraOverride = { extra: MF_FEE, label: 'Master-franchise' };
        }
      }
      return fn();
    } finally {
      window._rentOverride = saves.rent; window._chargeOverride = saves.charge;
      window._surfaceOverride = saves.surf; window._financingOverride = saves.fin;
      window._capexOverride = saves.capex; window._exitMultipleOverride = saves.exit;
      window._capexExtraOverride = saves.extra;
    }
  }
  function computeWith(hyp) { return withOverrides(hyp, () => buildPnL(S.cohort, S.avgPrice)); }

  // v6.93 — point mort en ADHÉRENTS par scénario (neutre FCFE, année 5 de
  // croisière) : réutilise computeBreakEvenMembers (bisection sur le vrai
  // moteur) DANS le sandbox du scénario. Mémoïsé (la bisection = ~20
  // buildPnL) pour garder les sliders fluides.
  const _beCache = new Map();
  function breakEvenWith(hyp, colKey) {
    const ck = colKey === 'tool'
      ? 'tool:' + JSON.stringify([window._rentOverride, window._chargeOverride, window._surfaceOverride, window._financingOverride, window._capexOverride, window._exitMultipleOverride])
      : colKey + ':' + (hyp ? JSON.stringify(hyp) : 'ref');
    if (_beCache.has(ck)) return _beCache.get(ck);
    let be = null;
    try {
      be = withOverrides(hyp, () =>
        typeof window.computeBreakEvenMembers === 'function' ? window.computeBreakEvenMembers('fcfe', 4) : null);
    } catch {}
    if (_beCache.size > 300) _beCache.clear();
    _beCache.set(ck, be);
    return be;
  }

  // ─── Persistance scénarios ───────────────────────────────────────
  function loadSaved() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; }
  }
  function persistSaved(all) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(all)); } catch {}
    // v6.84 — pousse les scénarios au cloud (partage équipe + retrouvés partout)
    try { window.UserDataSync?.pushScenarios(); } catch {}
  }
  function saveScenario(which) {
    const sc = S[which];
    const name = prompt('Nom du scénario :', sc.name === 'Scénario ' + which ? '' : sc.name);
    if (!name) return;
    sc.name = name.trim().slice(0, 40);
    const all = loadSaved();
    (all[S.siteKey] = all[S.siteKey] || []).push({ name: sc.name, ts: Date.now(), hyp: JSON.parse(JSON.stringify(sc.hyp)) });
    if (all[S.siteKey].length > 20) all[S.siteKey].shift();
    persistSaved(all);
    try {
      const p = computeWith(sc.hyp);
      window.AuditLog?.log({ action: 'fcf.scenario-save', target: S.siteName, siteKey: S.siteKey, field: sc.name,
        meta: { kpi: { irrEquity: p.irrEquity, fcfe5y: Math.round(p.fcfe5y / 1000), ebitdaY5: Math.round((p.annualEBITDA?.[4] || 0) / 1000) } } });
    } catch {}
    render();
  }
  function loadScenarioInto(which, idx) {
    const list = loadSaved()[S.siteKey] || [];
    const item = list[idx];
    if (!item) return;
    // v6.93 — merge avec les défauts : un scénario sauvegardé avant l'ajout
    // d'une hypothèse (ex. master-franchise) reste chargeable sans trou.
    const hyp = defaultScenario('').hyp;
    Object.assign(hyp, JSON.parse(JSON.stringify(item.hyp)));
    S[which] = { name: item.name, hyp };
    render();
  }
  function deleteSaved(idx) {
    const all = loadSaved();
    (all[S.siteKey] || []).splice(idx, 1);
    persistSaved(all);
    render();
  }

  // ─── Formatage ───────────────────────────────────────────────────
  const F = (typeof fmt === 'function') ? fmt : (x => String(x));
  const kE = v => F(Math.round((v || 0) / 1000)) + ' k€';
  const CLR = { ref: '#94a3b8', tool: '#60a5fa', A: '#d4a017', B: '#34d399' };

  // ─── Lignes KPI du tableau comparatif ────────────────────────────
  const ROWS = [
    { label: 'CAPEX', hint: 'Investissement initial (scale surface)', v: p => kE(p.capex), raw: p => p.capex, better: 'low' },
    { label: 'Equity investie', hint: 'Apport des associés', v: p => kE(p.equity), raw: p => p.equity, better: 'low' },
    { label: 'Dette bancaire', hint: 'Emprunt levé', v: p => p.loanPrincipal > 0 ? kE(p.loanPrincipal) : '—', raw: p => p.loanPrincipal },
    { label: 'EBITDA A5', hint: 'Rentabilité opérationnelle en vitesse de croisière', v: p => kE(p.annualEBITDA?.[4]), raw: p => p.annualEBITDA?.[4], better: 'high' },
    { label: 'FCFF 5 ans', hint: 'Free cash flow projet cumulé (avant dette)', v: p => kE(p.annualEBITDA.reduce((a, b) => a + b, 0) - p.leasingMonthly * 12 * Math.min(5, PNL_DEFAULTS.leasingYears)), raw: p => p.annualEBITDA.reduce((a, b) => a + b, 0), better: 'high' },
    { label: 'FCFE 5 ans', hint: 'Net free cash flow to equity cumulé (après service dette, avant IS)', v: p => kE(p.fcfe5y), raw: p => p.fcfe5y, better: 'high', star: true },
    { label: 'IRR Projet', hint: 'TRI unlevered — qualité intrinsèque du site', v: p => p.irr + '%', raw: p => p.irr, better: 'high', fmtDelta: d => Math.abs(d).toFixed(1) + ' pp' },
    { label: 'IRR Equity', hint: 'TRI levered — ton rendement d’actionnaire', v: p => p.irrEquity + '%', raw: p => p.irrEquity, better: 'high', star: true, fmtDelta: d => Math.abs(d).toFixed(1) + ' pp' },
    { label: 'NPV @12%', hint: 'Valeur actuelle nette au WACC de référence', v: p => kE(p.npv), raw: p => p.npv, better: 'high' },
    { label: 'DSCR min (A2+)', hint: 'Couverture du service de la dette — banque exige ≥ 1.2', v: p => p.dscrMinCruise != null ? p.dscrMinCruise.toFixed(2) + '×' : 'n/a', raw: p => p.dscrMinCruise, better: 'high', fmtDelta: d => Math.abs(d).toFixed(2) + '×' },
    { label: 'MOIC 5 ans', hint: 'Multiple sur equity investie (avec sortie)', v: p => p.moic != null ? p.moic.toFixed(1) + '×' : 'n/a', raw: p => p.moic, better: 'high', fmtDelta: d => Math.abs(d).toFixed(1) + '×' },
    { label: 'Payback equity', hint: 'Mois de récupération de l’apport via FCFE', v: p => p.paybackEquityMonth ? 'M' + p.paybackEquityMonth : '>60M', raw: p => p.paybackEquityMonth || 99, better: 'low', fmtDelta: d => Math.abs(Math.round(d)) + ' mois' },
    { label: 'Valeur terminale', hint: 'Multiple de sortie × EBITDA A5', v: p => kE(p.terminalValue), raw: p => p.terminalValue, better: 'high' },
  ];

  // ─── UI ──────────────────────────────────────────────────────────
  function open() {
    const d = window._lastCaptageData;
    const loc = window._lastCaptageLocation;
    if (!d?.r?.scenarios?.base?.cohort) { alert('Analyse d’abord un site (bouton Analyser) — le Studio FCF compare les scénarios du site ouvert.'); return; }
    S = {
      siteKey: loc ? loc.lat.toFixed(3) + ',' + loc.lng.toFixed(3) : 'global',
      siteName: loc?.siteName || 'Site',
      cohort: d.r.scenarios.base.cohort, avgPrice: d.avgPrice,
      A: defaultScenario('Scénario A'), B: defaultScenario('Scénario B'),
      chart: null,
    };
    // Suggestion didactique : A = sans dette (pour montrer l'effet de levier au 1er regard)
    S.A.hyp.debt = { on: true, v: false };
    S.A.name = 'Sans dette (100% equity)';
    const old = document.getElementById('fpFcfStudio');
    if (old) old.remove();
    const wrap = document.createElement('div');
    wrap.id = 'fpFcfStudio';
    wrap.style.cssText = 'position:fixed;inset:0;z-index:10001;background:rgba(6,8,15,.97);backdrop-filter:blur(10px);display:flex;flex-direction:column;overflow:hidden';
    document.body.appendChild(wrap);
    render();
    document.addEventListener('keydown', escClose);
  }
  function escClose(e) { if (e.key === 'Escape') close(); }
  function close() {
    document.getElementById('fpFcfStudio')?.remove();
    document.removeEventListener('keydown', escClose);
    try { S?.chart?.destroy(); } catch {}
    S = null;
  }

  function hypControls(which) {
    const sc = S[which];
    let lastGroup = '';
    return HYPS.map(h => {
      const st = sc.hyp[h.key];
      const groupHdr = h.group !== lastGroup
        ? `<div style="font-size:8px;font-weight:800;color:${CLR[which]};letter-spacing:.6px;margin:10px 0 4px;text-transform:uppercase">${h.group}</div>`
        : '';
      lastGroup = h.group;
      const refVal = h.fmt(h.get());
      const active = h.type === 'flag' ? (st.on && st.v) : st.on;
      const control = h.type === 'flag'
        ? `<span id="fcf-${which}-${h.key}-val" style="font-size:10px;font-weight:800;color:${active ? CLR[which] : 'var(--gray2)'}">${active ? '+400 k€ HT ajoutés au CAPEX' : '— (coche pour ajouter 400 k€ HT)'}</span>`
        : h.type === 'bool'
        ? `<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:10px;color:var(--white)">
             <input type="checkbox" ${st.v ? 'checked' : ''} ${st.on ? '' : 'disabled'}
               onchange="FcfStudio._set('${which}','${h.key}','v',this.checked)" style="accent-color:${CLR[which]}">
             <span id="fcf-${which}-${h.key}-val" style="font-weight:700">${st.v ? 'ON' : 'OFF'}</span>
           </label>`
        : `<div style="display:flex;align-items:center;gap:6px">
             <input type="range" min="${h.min}" max="${h.max}" step="${h.step}" value="${st.v}" ${st.on ? '' : 'disabled'}
               oninput="FcfStudio._set('${which}','${h.key}','v',parseFloat(this.value))"
               style="flex:1;accent-color:${CLR[which]};height:4px;cursor:pointer;opacity:${st.on ? 1 : .3}">
             <span id="fcf-${which}-${h.key}-val" style="font-size:9.5px;font-weight:800;color:${st.on ? CLR[which] : 'var(--gray2)'};min-width:58px;text-align:right">${st.on ? h.fmt(st.v) : refVal}</span>
           </div>`;
      return `${groupHdr}
        <div style="display:grid;grid-template-columns:16px 92px 1fr;gap:6px;align-items:center;padding:3px 0" title="${h.hint} · Référence: ${refVal}">
          <input type="checkbox" ${(h.type === 'flag' ? active : st.on) ? 'checked' : ''} onchange="FcfStudio._set('${which}','${h.key}','${h.type === 'flag' ? 'flag' : 'on'}',this.checked)"
            title="${h.type === 'flag' ? h.hint : 'Cocher = personnaliser cette hypothèse · Décocher = valeur de référence'}" style="accent-color:${CLR[which]};cursor:pointer">
          <span style="font-size:9.5px;color:${active ? 'var(--white)' : 'var(--gray2)'}">${h.label}</span>
          ${control}
        </div>`;
    }).join('');
  }

  function render() {
    const wrap = document.getElementById('fpFcfStudio');
    if (!wrap || !S) return;
    try { S.chart?.destroy(); } catch {}

    const pnls = { ref: computeWith(null), tool: computeWith('tool'), A: computeWith(S.A.hyp), B: computeWith(S.B.hyp) };
    // v6.93 — point mort FCFE en adhérents, par colonne (mémoïsé)
    const beMap = { ref: breakEvenWith(null, 'ref'), tool: breakEvenWith('tool', 'tool'), A: breakEvenWith(S.A.hyp, 'A'), B: breakEvenWith(S.B.hyp, 'B') };
    const mfOn = w => !!(S[w].hyp.mf && S[w].hyp.mf.on && S[w].hyp.mf.v);
    const saved = loadSaved()[S.siteKey] || [];

    // v6.93 — badge « vérité financement » : dérivé du P&L calculé, jamais
    // du nom du scénario (un preset renommé ne peut plus mentir).
    const finBadge = (w) => {
      const p = pnls[w];
      if (!p) return '';
      const debt = p.loanPrincipal > 0;
      const pct = debt ? Math.round(p.loanPrincipal / p.capex * 100) : 0;
      const core = debt
        ? `<span style="color:#60a5fa">🏦 apport ${100 - pct}% · dette ${pct}%</span>`
        : `<span style="color:#34d399">💰 100% fonds propres</span>`;
      return `<div style="font-size:9px;font-weight:700;margin-top:2px">${core}${mfOn(w) ? ' <span style="color:var(--accent)">· 🏷 +400k master-franchise</span>' : ''}</div>`;
    };

    // Δ 🅱−🅰 : cellule dédiée, signée et colorée (vert = B meilleur)
    const deltaCell = (raw, better, fmtDelta) => {
      const a = raw(pnls.A), b = raw(pnls.B);
      if (a == null || b == null || typeof a !== 'number' || typeof b !== 'number')
        return '<td style="padding:6px 10px;text-align:right;color:var(--gray2)">·</td>';
      const d = b - a;
      if (Math.abs(d) < 1e-9) return '<td style="padding:6px 10px;text-align:right;color:var(--gray2)">=</td>';
      const good = better === 'high' ? d > 0 : better === 'low' ? d < 0 : null;
      const col = good == null ? 'var(--gray2)' : good ? 'var(--green)' : 'var(--red)';
      const txt = fmtDelta ? fmtDelta(d) : (Math.abs(d) >= 1000 ? F(Math.round(d / 1000)) + ' k€' : String(Math.round(d * 100) / 100));
      return `<td style="padding:6px 10px;text-align:right;color:${col};font-weight:800">${d > 0 ? '+' : '−'}${txt.replace(/^[-−]/, '')}</td>`;
    };

    wrap.innerHTML = `
      <header style="padding:12px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
        <div>
          <div style="font-size:16px;font-weight:900;color:var(--white)">⚖️ Studio FCF — ${S.siteName.replace(/</g,'&lt;')}</div>
          <div style="font-size:9px;color:var(--gray2);margin-top:2px">Compare les cash flows de 4 jeux d'hypothèses. La <b style="color:${CLR.ref}">Référence BP</b> est inviolable — coche une hypothèse pour la personnaliser, décoche pour y revenir.</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          ${saved.length ? `<select id="fcfLoadSel" onchange="if(this.value!==''){FcfStudio._load('B',parseInt(this.value));this.value=''}" style="background:var(--card3);border:1px solid var(--border);border-radius:6px;color:var(--gray);font-size:9px;padding:6px">
            <option value="">📂 Charger dans B… (${saved.length})</option>
            ${saved.map((s, i) => `<option value="${i}">${s.name.replace(/</g,'&lt;')} · ${new Date(s.ts).toLocaleDateString('fr-FR')}</option>`).join('')}
          </select>` : ''}
          <button onclick="FcfStudio.close()" style="background:transparent;border:1px solid var(--border);border-radius:6px;color:var(--gray);width:34px;height:34px;cursor:pointer;font-size:15px;font-weight:700">✕</button>
        </div>
      </header>

      <div style="flex:1;overflow-y:auto;padding:14px 20px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
          ${['A', 'B'].map(w => `
            <div style="background:var(--bg2);border:1px solid ${CLR[w]}40;border-radius:10px;padding:12px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                <div style="font-size:11px;font-weight:800;color:${CLR[w]}">
                  ${w === 'A' ? '🅰' : '🅱'} ${S[w].name.replace(/</g,'&lt;')}
                  <span style="font-size:8px;color:var(--gray2);font-weight:500">· ${Object.values(S[w].hyp).filter(x => x.on).length} hypothèse(s) personnalisée(s)</span>
                  ${finBadge(w)}
                </div>
                <div style="display:flex;gap:5px">
                  <button onclick="FcfStudio._reset('${w}')" title="Tout décocher (retour référence)" style="background:transparent;border:1px solid var(--border);border-radius:5px;color:var(--gray2);font-size:8.5px;padding:4px 8px;cursor:pointer">↺ Réf</button>
                  <button onclick="FcfStudio._save('${w}')" title="Sauvegarder ce scénario" style="background:${CLR[w]}22;border:1px solid ${CLR[w]}55;border-radius:5px;color:${CLR[w]};font-size:8.5px;font-weight:700;padding:4px 8px;cursor:pointer">💾 Sauver</button>
                </div>
              </div>
              ${hypControls(w)}
            </div>`).join('')}
        </div>

        <div style="display:grid;grid-template-columns:1.15fr 1fr;gap:14px;align-items:start">
          <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;overflow:hidden">
            ${(() => {
              const nameA = S.A.name.replace(/</g, '&lt;').slice(0, 16);
              const nameB = S.B.name.replace(/</g, '&lt;').slice(0, 16);
              const rowHtml = (r) => {
                const differs = (() => { const a = r.raw(pnls.A), b = r.raw(pnls.B); return typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) > 1e-9; })();
                const bg = differs ? 'background:rgba(96,165,250,.06)' : (r.star ? 'background:rgba(212,160,23,.05)' : '');
                return `
                  <tr style="border-bottom:1px solid rgba(71,85,115,.12);${bg}" title="${r.hint}">
                    <td style="padding:6px 10px;color:var(--${r.star ? 'white' : 'gray'});font-weight:${r.star ? 800 : 500}">${r.label}${r.star ? ' ⭐' : ''}</td>
                    <td style="padding:6px 6px;text-align:right;color:${CLR.ref}">${r.v(pnls.ref)}</td>
                    <td style="padding:6px 6px;text-align:right;color:${CLR.tool}">${r.v(pnls.tool)}</td>
                    <td style="padding:6px 6px;text-align:right;color:${CLR.A};font-weight:700">${r.v(pnls.A)}</td>
                    <td style="padding:6px 6px;text-align:right;color:${CLR.B};font-weight:700">${r.v(pnls.B)}</td>
                    ${deltaCell(r.raw, r.better, r.fmtDelta)}
                  </tr>`;
              };
              // v6.93 — lignes spéciales : point mort (adhérents) + master-franchise
              const beRow = (() => {
                const f = v => v == null ? 'n/a' : F(v) + ' mbr';
                const a = beMap.A, b = beMap.B;
                const differs = typeof a === 'number' && typeof b === 'number' && a !== b;
                const dCell = (typeof a === 'number' && typeof b === 'number')
                  ? (a === b ? '<td style="padding:6px 10px;text-align:right;color:var(--gray2)">=</td>'
                     : `<td style="padding:6px 10px;text-align:right;color:${b < a ? 'var(--green)' : 'var(--red)'};font-weight:800">${b > a ? '+' : '−'}${F(Math.abs(b - a))} mbr</td>`)
                  : '<td style="padding:6px 10px;text-align:right;color:var(--gray2)">·</td>';
                return `
                  <tr style="border-bottom:1px solid rgba(71,85,115,.12);${differs ? 'background:rgba(96,165,250,.06)' : 'background:rgba(212,160,23,.05)'}"
                      title="Adhérents stabilisés requis pour être NEUTRE en FCFE (bas de page, année 5 de croisière) — dette du scénario incluse. Moins = mieux.">
                    <td style="padding:6px 10px;color:var(--white);font-weight:800">🎯 Point mort FCFE (adhérents) ⭐</td>
                    <td style="padding:6px 6px;text-align:right;color:${CLR.ref}">${f(beMap.ref)}</td>
                    <td style="padding:6px 6px;text-align:right;color:${CLR.tool}">${f(beMap.tool)}</td>
                    <td style="padding:6px 6px;text-align:right;color:${CLR.A};font-weight:800">${f(beMap.A)}</td>
                    <td style="padding:6px 6px;text-align:right;color:${CLR.B};font-weight:800">${f(beMap.B)}</td>
                    ${dCell}
                  </tr>`;
              })();
              const mfRow = `
                  <tr style="border-bottom:1px solid rgba(71,85,115,.12);${mfOn('A') !== mfOn('B') ? 'background:rgba(96,165,250,.06)' : ''}"
                      title="Droit d'entrée master-franchise (+400 k€ HT) — coché dans le panneau du scénario, ajouté à son CAPEX">
                    <td style="padding:6px 10px;color:var(--gray)">🏷 Frais master-franchise</td>
                    <td style="padding:6px 6px;text-align:right;color:${CLR.ref}">—</td>
                    <td style="padding:6px 6px;text-align:right;color:${CLR.tool}">—</td>
                    <td style="padding:6px 6px;text-align:right;color:${CLR.A};font-weight:700">${mfOn('A') ? '400 k€' : '—'}</td>
                    <td style="padding:6px 6px;text-align:right;color:${CLR.B};font-weight:700">${mfOn('B') ? '400 k€' : '—'}</td>
                    <td style="padding:6px 10px;text-align:right;color:var(--gray2)">${mfOn('A') === mfOn('B') ? '=' : '·'}</td>
                  </tr>`;
              // Injection : MF après « Dette bancaire », point mort après « FCFE 5 ans »
              const parts = [];
              ROWS.forEach(r => {
                parts.push(rowHtml(r));
                if (r.label === 'Dette bancaire') parts.push(mfRow);
                if (r.label === 'FCFE 5 ans') parts.push(beRow);
              });
              return `
            <table style="width:100%;border-collapse:collapse;font-size:10.5px">
              <thead><tr style="border-bottom:1px solid var(--border)">
                <th style="text-align:left;padding:8px 10px;font-size:8px;color:var(--gray2);letter-spacing:.5px">INDICATEUR</th>
                <th style="text-align:right;padding:8px 6px;font-size:8px;color:${CLR.ref}">RÉF. BP 🔒</th>
                <th style="text-align:right;padding:8px 6px;font-size:8px;color:${CLR.tool}">OUTIL</th>
                <th style="text-align:right;padding:8px 6px;font-size:8px;color:${CLR.A}" title="${S.A.name.replace(/"/g,'&quot;')}">🅰 ${nameA}</th>
                <th style="text-align:right;padding:8px 6px;font-size:8px;color:${CLR.B}" title="${S.B.name.replace(/"/g,'&quot;')}">🅱 ${nameB}</th>
                <th style="text-align:right;padding:8px 10px;font-size:8px;color:var(--white)">Δ 🅱−🅰</th>
              </tr></thead>
              <tbody>${parts.join('')}</tbody>
            </table>`;
            })()}
            <div style="font-size:8px;color:var(--gray2);padding:8px 10px;line-height:1.5">
              🔒 Référence BP = modèle verrouillé (OnAir calibré), jamais modifiable ici. Réglages outil = tes sliders actuels dans l'app.
              Les lignes <span style="display:inline-block;width:8px;height:8px;background:rgba(96,165,250,.35);border-radius:2px"></span> = 🅰 et 🅱 diffèrent.
              🎯 Point mort = adhérents stabilisés pour FCFE neutre (année 5, dette du scénario incluse).
              FCFE = EBITDA − leasing − service de dette (avant IS). Sortie = multiple × EBITDA A5 incluse dans IRR/NPV/MOIC.
            </div>
          </div>

          <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:12px">
            <div style="font-size:10px;font-weight:800;color:var(--white);margin-bottom:8px">FCFE CUMULÉ — 60 mois <span style="font-size:8px;color:var(--gray2);font-weight:500">(equity story : plus haut = plus de cash rendu à l'actionnaire)</span></div>
            <div style="position:relative;height:300px"><canvas id="fcfChart"></canvas></div>
            <div style="display:flex;gap:12px;margin-top:8px;font-size:8.5px;flex-wrap:wrap">
              <span style="color:${CLR.ref}">▬ ▬ Référence BP</span>
              <span style="color:${CLR.tool}">━ Réglages outil</span>
              <span style="color:${CLR.A}">━ ${S.A.name.replace(/</g,'&lt;')}</span>
              <span style="color:${CLR.B}">━ ${S.B.name.replace(/</g,'&lt;')}</span>
            </div>
          </div>
        </div>

        ${saved.length ? `
        <div style="margin-top:12px;background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:10px 12px">
          <div style="font-size:9px;font-weight:800;color:var(--gray);margin-bottom:6px">💾 SCÉNARIOS SAUVEGARDÉS — ${S.siteName.replace(/</g,'&lt;')}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${saved.map((s, i) => `
              <span style="display:inline-flex;align-items:center;gap:6px;background:var(--card3);border:1px solid var(--border);border-radius:6px;padding:4px 8px;font-size:9px;color:var(--white)">
                ${s.name.replace(/</g,'&lt;')}
                <a href="#" onclick="FcfStudio._load('A',${i});return false" title="Charger dans A" style="color:${CLR.A};text-decoration:none;font-weight:800">→🅰</a>
                <a href="#" onclick="FcfStudio._load('B',${i});return false" title="Charger dans B" style="color:${CLR.B};text-decoration:none;font-weight:800">→🅱</a>
                <a href="#" onclick="FcfStudio._del(${i});return false" title="Supprimer" style="color:var(--red);text-decoration:none">✕</a>
              </span>`).join('')}
          </div>
        </div>` : ''}
      </div>`;

    // ─── Chart ───
    try {
      if (typeof Chart !== 'undefined') {
        const cum = p => { let c = -p.equity; return p.monthly.map(m => (c += m.cashFlowEquity)); };
        const labels = Array.from({ length: 60 }, (_, i) => (i % 6 === 0 || i === 59) ? 'M' + (i + 1) : '');
        S.chart = new Chart(document.getElementById('fcfChart'), {
          type: 'line',
          data: { labels, datasets: [
            { label: 'Référence BP', data: cum(pnls.ref), borderColor: CLR.ref, borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, fill: false },
            { label: 'Réglages outil', data: cum(pnls.tool), borderColor: CLR.tool, borderWidth: 1.5, pointRadius: 0, fill: false },
            { label: S.A.name, data: cum(pnls.A), borderColor: CLR.A, borderWidth: 2.5, pointRadius: 0, fill: false },
            { label: S.B.name, data: cum(pnls.B), borderColor: CLR.B, borderWidth: 2.5, pointRadius: 0, fill: false },
          ]},
          options: {
            responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': ' + F(Math.round(ctx.parsed.y / 1000)) + ' k€' } } },
            scales: {
              x: { ticks: { color: '#94a3b8', font: { size: 8 }, maxRotation: 0 }, grid: { color: '#1e293b' } },
              y: { ticks: { color: '#94a3b8', font: { size: 8 }, callback: v => F(Math.round(v / 1000)) + 'k' }, grid: { color: '#1e293b' } },
            },
          },
        });
      }
    } catch (e) { console.warn('[FcfStudio] chart failed:', e); }
  }

  // ─── Handlers exposés (inline onclick) ───────────────────────────
  function _set(which, key, prop, val) {
    if (!S) return;
    if (!S[which].hyp[key]) S[which].hyp[key] = { on: false, v: null };
    if (prop === 'flag') {
      // v6.93 — hypothèse à case unique (master-franchise) : cocher = activer
      S[which].hyp[key].on = !!val;
      S[which].hyp[key].v = !!val;
    } else {
      S[which].hyp[key][prop] = val;
    }
    // v6.93 — anti-mensonge : le preset « Sans dette (100% equity) » perd son
    // nom si sa dette est réactivée (le titre ne doit jamais contredire les
    // chiffres — le badge financement sous le titre dit la vérité calculée).
    if (key === 'debt' && S[which].name === 'Sans dette (100% equity)') {
      const d = S[which].hyp.debt;
      if (!d.on || d.v !== false) S[which].name = 'Scénario ' + which;
    }
    render();
  }
  function _reset(which) { if (!S) return; const n = S[which].name; S[which] = defaultScenario(n); render(); }

  window.FcfStudio = { open, close, _set, _reset, _save: saveScenario, _load: loadScenarioInto, _del: deleteSaved };
})();
