// ═════════════════════════════════════════════════════════════════════
// PLAN DE CONQUÊTE (v6.73, +bancabilité v6.75) — planificateur de
// déploiement multi-sites.
//
// Répond à la question du master-franchisé : DANS QUEL ORDRE ouvrir,
// À QUEL RYTHME, AVEC QUEL CASH — et depuis v6.75 : AVEC QUEL
// FINANCEMENT, y compris le point de bancabilité (à partir de quand
// les banques locales financeraient théoriquement les ouvertures).
//
// Modes de financement :
//   'ref'    — dette dès le départ (structure BP : 30% FP / 70% dette)
//   'equity' — 100% fonds propres (Paul y va seul ; ouvertures gated
//              par le cash → temporalité réaliste de l'auto-financement)
//   'hybrid' — fonds propres d'abord, puis dette dès que le portefeuille
//              devient BANCABLE.
//
// Bancabilité (critères TRANSPARENTS et RÉGLABLES — conventions
// bancaires standard, à ajuster selon les banques roumaines) :
//   1. Track record : le club le plus ancien a ≥ N mois d'exploitation
//   2. Preuve d'exploitation : le 1er club a enchaîné ≥ K mois
//      consécutifs d'EBITDA positif
//   3. Capacité : (EBITDA − leasing) consolidé des 12 derniers mois
//      ≥ cible DSCR × service annuel d'un prêt club standard
//      (70% du CAPEX @ taux réf sur la durée réf)
//   → Le mois de bancabilité = premier mois où les 3 sont vrais.
//
// Autres modèles inchangés (cf. v6.73) : cannibalisation par réduction
// de cohorte AVANT P&L, extension >M60 au FCFE moyen année 5, sandbox
// overrides étanche.
// ═════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const F = (typeof fmt === 'function') ? fmt : (x => String(x));
  const kE = v => F(Math.round((v || 0) / 1000)) + ' k€';
  const mE = v => (v / 1e6).toFixed(2).replace('.', ',') + ' M€';
  const HORIZON = 120; // mois
  const LS_KEY = 'fpConquestConfig';

  let S = null; // {sites, order, cfg, results, chart}

  // ─── Candidats (TARGETS + customs vivants) ────────────────────────
  function candidateSites() {
    const out = [];
    if (typeof TARGETS !== 'undefined') TARGETS.forEach(t => out.push({ name: t.name, lat: t.lat, lng: t.lng, kind: 'target' }));
    try {
      (window.customSites || []).filter(s => !s.deletedAt).forEach(s => {
        if (!out.some(o => Math.abs(o.lat - s.lat) < 0.0015 && Math.abs(o.lng - s.lng) < 0.0015))
          out.push({ name: s.name, lat: s.lat, lng: s.lng, kind: 'custom' });
      });
    } catch {}
    return out;
  }

  // ─── P&L d'un site (sandbox) ──────────────────────────────────────
  // financingMode définit une structure de financement FIXE pour comparer
  // les scénarios, INDÉPENDANTE du réglage P&L global de l'app :
  //   'ref'    → structure BP de référence verrouillée (30% FP / 70% dette)
  //              = _financingOverride null → buildPnL retombe sur PNL_DEFAULTS
  //   'equity' → 100% fonds propres, zéro dette
  // (Avant v6.89 : 'ref' héritait du toggle global — si Paul avait mis le
  //  P&L en 100% FP, le scénario « Dette » était identique à « Fonds propres ».)
  function sitePnl(site, cannibFactor, financingMode) {
    const saves = {
      rent: window._rentOverride, charge: window._chargeOverride,
      surf: window._surfaceOverride, fin: window._financingOverride,
    };
    try {
      const key = site.lat.toFixed(3) + ',' + site.lng.toFixed(3);
      window._rentOverride    = window._rentOverrides?.[key]    ? { y1: window._rentOverrides[key] } : null;
      window._chargeOverride  = window._chargeOverrides?.[key]  ? { chargeTotal: window._chargeOverrides[key] } : null;
      window._surfaceOverride = window._surfaceOverrides?.[key] ? { surface: window._surfaceOverrides[key] } : null;
      window._financingOverride = financingMode === 'equity'
        ? { enabled: false }         // 100% fonds propres
        : null;                      // 'ref' → BP 30/70 verrouillé (ignore le toggle global)
      const radius = window._radiusOverrides?.[key] || 3000;
      const r = runCaptageAnalysis(site.lat, site.lng, radius);
      let cohort = r.scenarios.base.cohort;
      if (cannibFactor < 1) {
        cohort = cohort.map(m => ({ ...m, monthlyCA: m.monthlyCA * cannibFactor, netMembers: Math.round(m.netMembers * cannibFactor) }));
      }
      const p = buildPnL(cohort, r.avgQuartierPrice);
      const cf = p.monthly.map(m => m.cashFlowEquity);
      const ebitda = p.monthly.map(m => m.ebitda);
      const y5 = p.monthly.slice(48, 60);
      const fcfeY5Monthly = y5.length ? y5.reduce((a, m) => a + m.cashFlowEquity, 0) / y5.length : 0;
      const ebitdaY5Monthly = y5.length ? y5.reduce((a, m) => a + m.ebitda, 0) / y5.length : 0;
      return {
        equity: p.equity, capex: p.capex, cfMonthly: cf, ebitdaMonthly: ebitda,
        leasingMonthly: p.leasingMonthly || 0, fcfeY5Monthly, ebitdaY5Monthly,
        irrEquity: p.irrEquity, irr: p.irr, members: Math.round(r.realiste * cannibFactor),
        membersRaw: r.realiste, tv: p.terminalValue, fcfe5y: p.fcfe5y,
      };
    } finally {
      window._rentOverride = saves.rent; window._chargeOverride = saves.charge;
      window._surfaceOverride = saves.surf; window._financingOverride = saves.fin;
    }
  }

  // ─── Cannibalisation ──────────────────────────────────────────────
  function cannibalizationFactor(site, elders) {
    let penalty = 0;
    elders.forEach(e => {
      const d = haversine(site.lat, site.lng, e.lat, e.lng);
      if (d < 4000) penalty += 0.5 * (1 - d / 4000);
    });
    penalty = Math.min(0.6, penalty);
    return { factor: 1 - penalty, penaltyPct: Math.round(penalty * 100) };
  }

  // ─── Bancabilité ──────────────────────────────────────────────────
  // Service annuel d'un prêt "club standard" (70% CAPEX réf @ taux réf).
  function standardLoanAnnualService() {
    const fin = PNL_DEFAULTS.financing;
    const P = PNL_DEFAULTS.capex * fin.loanRatio;
    const rM = fin.loanRate / 12, n = fin.loanTermYears * 12;
    const pmt = rM > 0 ? P * rM / (1 - Math.pow(1 + rM, -n)) : P / n;
    return pmt * 12;
  }
  // (EBITDA − leasing) opéré du club ps à son mois d'exploitation i (0-based)
  function clubOpEbitda(ps, i) {
    if (i < 0) return 0;
    if (i < 60) return ps.ebitdaMonthly[i] - (i < 60 ? ps.leasingMonthly : 0);
    return ps.ebitdaY5Monthly; // leasing terminé après M60
  }
  // Mois d'exploitation (1-based) où le club atteint K mois consécutifs
  // d'EBITDA positif (null si jamais sur 60 mois).
  function consecutivePositiveAt(ps, K) {
    let run = 0;
    for (let i = 0; i < 60; i++) {
      run = ps.ebitdaMonthly[i] > 0 ? run + 1 : 0;
      if (run >= K) return i + 1;
    }
    return null;
  }
  // Le portefeuille (clubs planifiés jusqu'ici) est-il bancable au mois m ?
  function bankableAt(m, planned, cfg) {
    if (!planned.length) return false;
    const oldest = planned[0];
    // 1. track record
    if (m - oldest.openMonth < cfg.bankTrackMonths) return false;
    // 2. K mois consécutifs d'EBITDA positif sur le 1er club
    const okAt = oldest._posRunAt;
    if (okAt == null || (m - oldest.openMonth) < okAt) return false;
    // 3. DSCR consolidé trailing 12M vs service d'un prêt standard
    let t12 = 0;
    planned.forEach(ps => {
      for (let j = Math.max(0, m - ps.openMonth - 12); j < m - ps.openMonth; j++) t12 += clubOpEbitda(ps, j);
    });
    return t12 >= cfg.bankDscr * standardLoanAnnualService();
  }

  // ─── Moteur de séquencement ───────────────────────────────────────
  // Calcule UN scénario de financement (finMode) sur l'ordre/contraintes
  // courants et RETOURNE son résultat (sans muter S) — permet de calculer
  // les 3 scénarios côte à côte pour un même projet.
  function runScenario(finMode) {
    const cfg = S.cfg;
    const enabled = S.order.filter(id => S.sites[id].enabled);
    const elders = [];
    const perSite = [];
    for (const id of enabled) {
      const site = S.sites[id];
      const cann = cannibalizationFactor(site, elders);
      perSite.push({ id, site, cannFactor: cann.factor, penaltyPct: cann.penaltyPct });
      elders.push(site);
    }
    const minGap = Math.max(1, cfg.minGapMonths);
    const perYearCap = Math.max(1, cfg.maxPerYear);
    let lastOpen = -Infinity;
    const opensInYear = {};
    const plan = [];
    for (const meta of perSite) {
      let m = Math.max(0, lastOpen + minGap);
      let chosen = null;
      let reason = null; // pourquoi ce mois (pour la lisibilité)
      for (; m <= HORIZON - 6; m++) {
        const y = Math.floor(m / 12);
        if ((opensInYear[y] || 0) >= perYearCap) { m = (y + 1) * 12 - 1; reason = 'cap'; continue; }
        // mode de financement de CE club à CE mois
        const bankable = bankableAt(m, plan, cfg);
        const useDebt = finMode === 'ref' || (finMode === 'hybrid' && bankable);
        const variant = useDebt ? 'ref' : 'equity';
        if (!meta['_p_' + variant]) {
          const p = sitePnl(meta.site, meta.cannFactor, variant);
          p._posRunAt = consecutivePositiveAt(p, cfg.bankPosMonths);
          meta['_p_' + variant] = p;
        }
        const p = meta['_p_' + variant];
        if (!cfg.enforceCash || cashAvailableAt(m, plan, cfg) >= p.equity) {
          chosen = { ...meta, ...p, openMonth: m, financedByDebt: useDebt, reason };
          break;
        }
        reason = 'cash'; // le cash manque à ce mois → on décale
      }
      if (!chosen) {
        chosen = { ...meta, ...(meta['_p_equity'] || meta['_p_ref'] || sitePnl(meta.site, meta.cannFactor, finMode === 'ref' ? 'ref' : 'equity')), openMonth: null, financedByDebt: false, reason: 'blocked' };
        plan.push(chosen);
        continue;
      }
      plan.push(chosen);
      opensInYear[Math.floor(chosen.openMonth / 12)] = (opensInYear[Math.floor(chosen.openMonth / 12)] || 0) + 1;
      lastOpen = chosen.openMonth;
    }
    const scheduled = plan.filter(p => p.openMonth != null);
    const curve = new Array(HORIZON + 1).fill(0);
    scheduled.forEach(ps => {
      curve[ps.openMonth] -= ps.equity;
      for (let i = 0; i < HORIZON - ps.openMonth; i++) {
        const cf = i < 60 ? ps.cfMonthly[i] : ps.fcfeY5Monthly;
        curve[ps.openMonth + 1 + i] = (curve[ps.openMonth + 1 + i] || 0) + cf;
      }
    });
    const cum = [];
    curve.reduce((a, v, i) => (cum[i] = a + v), 0);
    const peakNeed = Math.max(0, -Math.min(...cum));
    const rM = Math.pow(1.12, 1 / 12) - 1;
    const npv = curve.reduce((a, v, t) => a + v / Math.pow(1 + rM, t), 0);
    let bankMonth = null;
    for (let m = 0; m <= HORIZON; m++) { if (bankableAt(m, scheduled, cfg)) { bankMonth = m; break; } }
    const openMonths = scheduled.map(p => p.openMonth);
    return {
      finMode, plan, scheduled, curve, cum, peakNeed, npv, bankMonth,
      firstOpen: openMonths.length ? Math.min(...openMonths) : null,
      lastOpen: openMonths.length ? Math.max(...openMonths) : null,
      nbClubs: scheduled.length,
      nbBlocked: plan.length - scheduled.length,
      totalEquity: scheduled.reduce((a, p) => a + p.equity, 0),
      totalTV: scheduled.reduce((a, p) => a + p.tv, 0),
      fcfeAtHorizon: cum[HORIZON],
      loanService: standardLoanAnnualService(),
      feasible: peakNeed <= cfg.equityPool,
    };
  }

  // Calcule les 3 scénarios pour le même projet (ordre + contraintes figés).
  function computePlan() {
    S.scenarios = { ref: runScenario('ref'), equity: runScenario('equity'), hybrid: runScenario('hybrid') };
    S.results = S.scenarios[S.cfg.finMode] || S.scenarios.ref;
  }

  function cashAvailableAt(month, alreadyPlanned, cfg) {
    let cash = cfg.equityPool;
    alreadyPlanned.forEach(ps => {
      if (ps.openMonth == null) return;
      cash -= ps.equity;
      if (cfg.reinvest) {
        for (let i = 0; i < month - ps.openMonth; i++) {
          const cf = i < 60 ? ps.cfMonthly[i] : ps.fcfeY5Monthly;
          if (cf > 0) cash += cf;
        }
      }
    });
    return cash;
  }

  // ─── Config ───────────────────────────────────────────────────────
  function defaultCfg() {
    return {
      equityPool: 3200000, maxPerYear: 2, minGapMonths: 4, reinvest: true, enforceCash: true,
      finMode: 'ref', bankTrackMonths: 12, bankPosMonths: 6, bankDscr: 1.2,
    };
  }
  function loadCfg() {
    try { return { ...defaultCfg(), ...(JSON.parse(localStorage.getItem(LS_KEY) || '{}')) }; }
    catch { return defaultCfg(); }
  }
  function persistCfg() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(S.cfg)); } catch {}
    // v6.84 — synchro cloud de la config du plan (LWW par ts)
    try { S.cfg.ts = Date.now(); localStorage.setItem(LS_KEY, JSON.stringify(S.cfg)); window.UserDataSync?.pushConquest(); } catch {}
  }

  // ─── UI ───────────────────────────────────────────────────────────
  function open() {
    const cands = candidateSites();
    if (cands.length < 2) { alert('Il faut au moins 2 sites (TARGETS ou Mes sites) pour planifier une conquête.'); return; }
    S = { sites: cands.map((c, i) => ({ ...c, enabled: true, _id: i })), order: null, cfg: loadCfg(), results: null, chart: null };
    const solo = S.sites.map((s, i) => ({ i, p: sitePnl(s, 1, 'ref') }));
    solo.forEach(x => Object.assign(S.sites[x.i], { soloIrrEq: x.p.irrEquity }));
    S.order = solo.sort((a, b) => b.p.irrEquity - a.p.irrEquity).map(x => x.i);
    const old = document.getElementById('fpConquest');
    if (old) old.remove();
    const wrap = document.createElement('div');
    wrap.id = 'fpConquest';
    wrap.style.cssText = 'position:fixed;inset:0;z-index:10001;background:rgba(6,8,15,.97);backdrop-filter:blur(10px);display:flex;flex-direction:column;overflow:hidden';
    document.body.appendChild(wrap);
    document.addEventListener('keydown', escClose);
    recompute();
  }
  function escClose(e) { if (e.key === 'Escape') close(); }
  function close() {
    document.getElementById('fpConquest')?.remove();
    document.removeEventListener('keydown', escClose);
    try { S?.chart?.destroy(); } catch {}
    S = null;
  }
  function recompute() { computePlan(); render(); }

  function monthLabel(m) {
    if (m == null) return '—';
    return 'A' + (Math.floor(m / 12) + 1) + ' M' + ((m % 12) + 1);
  }

  const SCEN = {
    ref:    { icon: '🏦', label: 'Dette dès le départ', sub: 'structure BP 30/70', color: '#60a5fa' },
    equity: { icon: '💰', label: '100% Fonds propres', sub: 'zéro dette, autofinancé', color: '#d4a017' },
    hybrid: { icon: '💰→🏦', label: 'Hybride', sub: 'FP puis dette dès bancabilité', color: '#34d399' },
  };
  const esc = s => String(s).replace(/</g, '&lt;');

  function render() {
    const wrap = document.getElementById('fpConquest');
    if (!wrap || !S) return;
    try { S.chart?.destroy(); } catch {}
    const cfg = S.cfg, SC = S.scenarios, active = cfg.finMode, R = SC[active];
    const meta = SCEN[active];

    // "meilleur" par métrique (pour surligner l'avantage de chaque scénario)
    const modes = ['ref', 'equity', 'hybrid'];
    const best = {
      nbClubs: Math.max(...modes.map(m => SC[m].nbClubs)),
      peakNeed: Math.min(...modes.map(m => SC[m].peakNeed)),
      fcfe: Math.max(...modes.map(m => SC[m].fcfeAtHorizon)),
    };

    // ── Barre-réponse : combien d'ouvertures et quand ──
    const answer = R.nbClubs === 0
      ? `<span style="color:var(--red)">Aucune ouverture possible avec ces réglages.</span> Augmente l'enveloppe ou assouplis les contraintes.`
      : `Tu ouvres <b style="color:${meta.color}">${R.nbClubs} club${R.nbClubs > 1 ? 's' : ''}</b>${R.nbBlocked ? ` <span style="color:var(--red);font-size:12px">(+${R.nbBlocked} bloqué${R.nbBlocked > 1 ? 's' : ''})</span>` : ''} en 10 ans · 1<sup>re</sup> ouverture <b>${monthLabel(R.firstOpen)}</b> · dernière <b>${monthLabel(R.lastOpen)}</b> · pic de trésorerie <b style="color:${R.feasible ? 'var(--green)' : 'var(--red)'}">${mE(R.peakNeed)}</b>${R.bankMonth != null ? ` · bancable <b style="color:var(--green)">${monthLabel(R.bankMonth)}</b>` : ''}`;

    // ── Carte scénario ──
    const scenCard = (m) => {
      const s = SC[m], meta2 = SCEN[m], on = m === active;
      const cell = (val, isBest, help) => `<div style="display:flex;justify-content:space-between;align-items:baseline;padding:3px 0;border-bottom:1px solid rgba(71,85,115,.15)">
        <span style="font-size:8.5px;color:var(--gray2)">${help}</span>
        <b style="font-size:10.5px;color:${isBest ? 'var(--green)' : 'var(--white)'}">${val}${isBest ? ' ✦' : ''}</b></div>`;
      return `<div onclick="ConquestPlan._selectScenario('${m}')" style="flex:1;cursor:pointer;background:${on ? 'linear-gradient(180deg,' + meta2.color + '18,var(--bg2))' : 'var(--bg2)'};border:1.5px solid ${on ? meta2.color : 'var(--border)'};border-radius:11px;padding:11px 12px;transition:all .15s">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
          <div style="font-size:11px;font-weight:800;color:${on ? meta2.color : 'var(--white)'}">${meta2.icon} ${meta2.label}</div>
          ${on ? `<span style="font-size:7.5px;font-weight:800;color:${meta2.color};background:${meta2.color}22;padding:2px 6px;border-radius:20px">✓ AFFICHÉ</span>` : `<span style="font-size:8px;color:var(--gray2)">cliquer</span>`}
        </div>
        <div style="font-size:26px;font-weight:900;color:${on ? meta2.color : 'var(--white)'};line-height:1">${s.nbClubs}<span style="font-size:10px;color:var(--gray2);font-weight:600"> clubs${s.nbBlocked ? ' <span style="color:var(--red)">+' + s.nbBlocked + ' bloqués</span>' : ''}</span></div>
        <div style="margin-top:8px">
          ${cell(monthLabel(s.lastOpen), false, 'Dernière ouverture')}
          ${cell(mE(s.peakNeed), s.peakNeed === best.peakNeed, 'Pic de financement')}
          ${cell(mE(s.totalEquity), false, 'Fonds propres engagés')}
          ${cell(mE(Math.max(0, s.fcfeAtHorizon)), s.fcfeAtHorizon === best.fcfe, 'Cash 10 ans')}
          ${cell(s.bankMonth != null ? monthLabel(s.bankMonth) : '—', false, 'Bancable dès')}
        </div>
      </div>`;
    };

    // ── Calendrier d'ouvertures (scénario affiché) — grille par année ──
    // On n'affiche que les années utiles (jusqu'à la dernière ouverture + 1),
    // stable entre scénarios → colonnes larges et noms lisibles.
    const lastY = Math.max(0, ...modes.map(m => SC[m].lastOpen != null ? Math.floor(SC[m].lastOpen / 12) : 0));
    const nYears = Math.min(10, Math.max(5, lastY + 2));
    const byYear = Array.from({ length: nYears }, () => []);
    R.scheduled.forEach((ps) => { const y = Math.floor(ps.openMonth / 12); if (y < nYears) byYear[y].push(ps); });
    const globalIdx = new Map(R.plan.map((p, i) => [p, i]));
    const chip = (ps) => {
      const finBadge = ps.financedByDebt ? '🏦' : '💰';
      const reasonChip = ps.reason === 'cash' ? '<span title="Décalé : le cash manquait avant" style="color:var(--orange)">⏳</span>'
        : (ps.financedByDebt && active === 'hybrid') ? '<span title="Financé par dette (portefeuille bancable)" style="color:#60a5fa">🏦</span>' : '';
      const idx = globalIdx.get(ps);
      return `<div onmouseover="ConquestPlan._hi(${ps.openMonth})" title="${esc(ps.site.name)} — ouverture ${monthLabel(ps.openMonth)}, ${F(ps.members)} membres, ${ps.financedByDebt ? 'financé par dette (70%)' : '100% fonds propres'} (${kE(ps.equity)})" style="background:linear-gradient(180deg,${ps.financedByDebt ? '#60a5fa22' : '#d4a01722'},var(--bg));border:1px solid ${ps.financedByDebt ? '#60a5fa66' : '#d4a01766'};border-left:3px solid ${ps.financedByDebt ? '#60a5fa' : 'var(--accent)'};border-radius:7px;padding:6px 8px;margin-bottom:5px;cursor:default">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:4px">
          <span style="font-size:9.5px;font-weight:800;color:var(--white);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${finBadge} ${esc(ps.site.name)}</span>
          <span style="display:flex;flex-direction:column">
            <button onclick="event.stopPropagation();ConquestPlan._move(${idx},-1)" style="background:none;border:none;color:var(--gray2);cursor:pointer;font-size:8px;padding:0;line-height:1">▲</button>
            <button onclick="event.stopPropagation();ConquestPlan._move(${idx},1)" style="background:none;border:none;color:var(--gray2);cursor:pointer;font-size:8px;padding:0;line-height:1">▼</button>
          </span>
        </div>
        <div style="font-size:8px;color:var(--gray2);margin-top:2px">M${(ps.openMonth % 12) + 1} · ${F(ps.members)} mbr · ${kE(ps.equity)} ${reasonChip}${ps.penaltyPct > 0 ? ` <span style="color:var(--orange)" title="Cannibalisation">−${ps.penaltyPct}%</span>` : ''}</div>
      </div>`;
    };
    const yearCol = (clubs, y) => {
      const isBank = R.bankMonth != null && Math.floor(R.bankMonth / 12) === y;
      return `<div style="flex:1;min-width:0;background:${isBank ? 'rgba(96,165,250,.06)' : 'transparent'};border-right:1px solid rgba(71,85,115,.15);padding:0 4px">
        <div style="text-align:center;font-size:9px;font-weight:800;color:${isBank ? '#60a5fa' : 'var(--gray)'};padding:3px 0;border-bottom:1px solid rgba(71,85,115,.2);margin-bottom:6px">A${y + 1}${isBank ? ' 🏦' : ''}</div>
        ${clubs.map(chip).join('') || '<div style="height:2px"></div>'}
      </div>`;
    };
    const blocked = R.plan.filter(p => p.openMonth == null);

    wrap.innerHTML = `
      <header style="padding:12px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
        <div>
          <div style="font-size:16px;font-weight:900;color:var(--white)">🗺️ Plan de Conquête — Bucarest</div>
          <div style="font-size:9px;color:var(--gray2);margin-top:2px">Combien de clubs, dans quel ordre, à quel rythme, avec quel financement — 3 scénarios comparés · horizon 10 ans</div>
        </div>
        <button onclick="ConquestPlan.close()" style="background:transparent;border:1px solid var(--border);border-radius:6px;color:var(--gray);width:34px;height:34px;cursor:pointer;font-size:15px;font-weight:700">✕</button>
      </header>

      <div style="flex:1;overflow-y:auto;padding:14px 20px">
        <!-- BARRE-RÉPONSE -->
        <div style="background:linear-gradient(90deg,${meta.color}1c,var(--bg2));border:1px solid ${meta.color}55;border-left:4px solid ${meta.color};border-radius:11px;padding:12px 16px;margin-bottom:14px">
          <div style="font-size:8px;font-weight:800;color:${meta.color};letter-spacing:1px;margin-bottom:3px">🎯 SCÉNARIO ${meta.label.toUpperCase()}</div>
          <div style="font-size:14px;color:var(--white);line-height:1.5">${answer}</div>
          ${!R.feasible && R.nbClubs > 0 ? `<div style="font-size:9.5px;color:var(--red);margin-top:5px;font-weight:700">⚠ Le pic (${mE(R.peakNeed)}) dépasse ton enveloppe (${mE(cfg.equityPool)}) — augmente l'enveloppe, espace les ouvertures, ou choisis un scénario avec dette.</div>` : ''}
        </div>

        <!-- COMPARATEUR 3 SCÉNARIOS -->
        <div style="font-size:9px;font-weight:800;color:var(--gray);letter-spacing:.5px;margin-bottom:6px">⚖️ COMPARE LES 3 STRATÉGIES DE FINANCEMENT — même projet, même ordre <span style="color:var(--gray2);font-weight:500">· clique une carte pour l'afficher en détail · ✦ = meilleur</span></div>
        <div style="display:flex;gap:10px;margin-bottom:16px">
          ${modes.map(scenCard).join('')}
        </div>

        <div style="display:grid;grid-template-columns:270px 1fr;gap:14px;align-items:start">
          <!-- CONTRÔLES -->
          <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:12px">
            <div style="font-size:10px;font-weight:800;color:var(--accent);margin-bottom:6px">CONTRAINTES</div>
            <label style="display:block;font-size:8.5px;color:var(--gray);margin-bottom:2px">Enveloppe fonds propres disponible (M€)</label>
            <input type="number" step="0.1" min="0" value="${(cfg.equityPool / 1e6).toFixed(1)}" onchange="ConquestPlan._cfg('equityPool', parseFloat(this.value) * 1e6)"
              style="width:100%;padding:6px 9px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--white);font-size:10px;margin-bottom:6px;font-family:var(--font)">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
              <div><label style="display:block;font-size:8.5px;color:var(--gray);margin-bottom:2px">Max ouv./an</label>
              <input type="number" min="1" max="6" value="${cfg.maxPerYear}" onchange="ConquestPlan._cfg('maxPerYear', parseInt(this.value,10))"
                style="width:100%;padding:6px 9px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--white);font-size:10px;font-family:var(--font)"></div>
              <div><label style="display:block;font-size:8.5px;color:var(--gray);margin-bottom:2px">Écart min (mois)</label>
              <input type="number" min="1" max="24" value="${cfg.minGapMonths}" onchange="ConquestPlan._cfg('minGapMonths', parseInt(this.value,10))"
                style="width:100%;padding:6px 9px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--white);font-size:10px;font-family:var(--font)"></div>
            </div>
            <label style="display:flex;align-items:center;gap:6px;font-size:9px;color:var(--white);cursor:pointer;margin:8px 0 4px">
              <input type="checkbox" ${cfg.reinvest ? 'checked' : ''} onchange="ConquestPlan._cfg('reinvest', this.checked)" style="accent-color:var(--accent)">
              Réinvestir les FCFE dans les ouvertures
            </label>
            <label style="display:flex;align-items:center;gap:6px;font-size:9px;color:var(--white);cursor:pointer;margin-bottom:10px">
              <input type="checkbox" ${cfg.enforceCash ? 'checked' : ''} onchange="ConquestPlan._cfg('enforceCash', this.checked)" style="accent-color:var(--accent)">
              Retarder une ouverture si le cash manque
            </label>

            <div style="font-size:9px;font-weight:800;color:#60a5fa;margin:6px 0 4px" title="Conventions bancaires standard — ajuste selon tes échanges avec les banques roumaines (BCR, BT, BRD…)">🏦 CRITÈRES DE BANCABILITÉ (réglables)</div>
            <label style="display:block;font-size:8.5px;color:var(--gray);margin-bottom:2px">Historique min. du 1<sup>er</sup> club (mois)</label>
            <input type="number" min="6" max="36" value="${cfg.bankTrackMonths}" onchange="ConquestPlan._cfg('bankTrackMonths', parseInt(this.value,10))"
              style="width:100%;padding:6px 9px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--white);font-size:10px;margin-bottom:6px;font-family:var(--font)">
            <label style="display:block;font-size:8.5px;color:var(--gray);margin-bottom:2px">Mois consécutifs d'EBITDA positif</label>
            <input type="number" min="3" max="24" value="${cfg.bankPosMonths}" onchange="ConquestPlan._cfg('bankPosMonths', parseInt(this.value,10))"
              style="width:100%;padding:6px 9px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--white);font-size:10px;margin-bottom:6px;font-family:var(--font)">
            <label style="display:block;font-size:8.5px;color:var(--gray);margin-bottom:2px">DSCR exigé (service prêt ${kE(R.loanService)}/an)</label>
            <input type="number" step="0.1" min="1" max="3" value="${cfg.bankDscr}" onchange="ConquestPlan._cfg('bankDscr', parseFloat(this.value))"
              style="width:100%;padding:6px 9px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--white);font-size:10px;margin-bottom:10px;font-family:var(--font)">

            <div style="font-size:10px;font-weight:800;color:var(--accent);margin:6px 0 6px">SITES RETENUS (${S.sites.filter(s => s.enabled).length}/${S.sites.length})</div>
            ${S.sites.map((s, i) => `
              <label style="display:flex;align-items:center;gap:6px;font-size:9.5px;color:${s.enabled ? 'var(--white)' : 'var(--gray2)'};cursor:pointer;padding:2px 0">
                <input type="checkbox" ${s.enabled ? 'checked' : ''} onchange="ConquestPlan._toggle(${i}, this.checked)" style="accent-color:var(--accent)">
                <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.name)}</span>
                <span style="font-size:8px;color:var(--gray2)" title="IRR fonds propres en solo">${s.soloIrrEq != null ? s.soloIrrEq.toFixed(0) + '%' : ''}</span>
              </label>`).join('')}
          </div>

          <!-- CALENDRIER + COURBES -->
          <div>
            <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:12px">
              <div style="font-size:10px;font-weight:800;color:var(--white);margin-bottom:8px">📅 CALENDRIER D'OUVERTURES <span style="font-size:8px;color:var(--gray2);font-weight:500">— scénario ${meta.label} · 💰 fonds propres · 🏦 dette · ⏳ décalé faute de cash · glisse ▲▼ pour changer les priorités</span></div>
              <div style="display:flex;align-items:stretch;min-height:60px">${byYear.map(yearCol).join('')}</div>
              ${blocked.length ? `<div style="margin-top:8px;padding-top:8px;border-top:1px dashed rgba(239,68,68,.3);font-size:9px;color:var(--red)">🚫 Non finançables sur 10 ans avec ce scénario : <b>${blocked.map(p => esc(p.site.name)).join(', ')}</b> — passe en mode dette ou augmente l'enveloppe.</div>` : ''}
            </div>
            <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:12px">
              <div style="font-size:10px;font-weight:800;color:var(--white);margin-bottom:2px">💶 TRÉSORERIE CONSOLIDÉE — les 3 scénarios superposés
                <span style="font-size:8px;color:var(--gray2);font-weight:500">— cumul des flux (hors enveloppe/sorties). Point bas = besoin externe max. Le scénario affiché est en gras.</span></div>
              <div style="display:flex;gap:12px;margin:6px 0 4px">
                ${modes.map(m => `<span style="font-size:8.5px;color:${SCEN[m].color};font-weight:${m === active ? 800 : 500}">${m === active ? '● ' : '○ '}${SCEN[m].icon} ${SCEN[m].label}</span>`).join('')}
              </div>
              <div style="position:relative;height:230px"><canvas id="conquestChart"></canvas></div>
            </div>
            <div style="font-size:8px;color:var(--gray2);margin-top:10px;line-height:1.6">
              Bancabilité = ① 1<sup>er</sup> club ≥ ${cfg.bankTrackMonths} mois d'exploitation · ② ≥ ${cfg.bankPosMonths} mois consécutifs d'EBITDA positif · ③ (EBITDA−leasing) 12 derniers mois ≥ ${cfg.bankDscr}× le service d'un prêt club standard (${kE(R.loanService)}/an). Conventions standard à confronter aux banques roumaines.
              Cannibalisation : réduction de cohorte 50% × overlap (<4 km), avant P&L · >M60 : FCFE moyen année 5 · NPV @12% du scénario affiché : ${kE(R.npv)}.
            </div>
          </div>
        </div>
      </div>`;

    try {
      if (typeof Chart !== 'undefined') {
        const labels = Array.from({ length: HORIZON + 1 }, (_, i) => i % 12 === 0 ? 'A' + (i / 12 + 1) : '');
        const datasets = modes.map(m => ({
          label: SCEN[m].label,
          data: SC[m].cum,
          borderColor: SCEN[m].color,
          borderWidth: m === active ? 2.6 : 1.2,
          borderDash: m === active ? [] : [4, 3],
          pointRadius: 0, tension: 0.15,
          fill: m === active ? { target: 'origin', above: 'rgba(52,211,153,.07)', below: 'rgba(239,68,68,.1)' } : false,
          order: m === active ? 0 : 2,
        }));
        if (R.bankMonth != null) {
          const pt = new Array(HORIZON + 1).fill(null);
          pt[R.bankMonth] = R.cum[R.bankMonth];
          datasets.push({ label: 'Bancable', data: pt, pointRadius: 7, pointStyle: 'rectRot', pointBackgroundColor: meta.color, pointBorderColor: '#fff', pointBorderWidth: 1.5, showLine: false, order: 0 });
        }
        S.chart = new Chart(document.getElementById('conquestChart'), {
          type: 'line',
          data: { labels, datasets },
          options: {
            responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { display: false }, tooltip: { callbacks: {
              title: items => 'A' + (Math.floor(items[0].dataIndex / 12) + 1) + ' M' + ((items[0].dataIndex % 12) + 1) + (R.bankMonth === items[0].dataIndex ? ' — 🏦 BANCABLE' : ''),
              label: ctx => ctx.dataset.label + ' : ' + F(Math.round(ctx.parsed.y / 1000)) + ' k€',
            }}},
            scales: {
              x: { ticks: { color: '#94a3b8', font: { size: 8 }, maxRotation: 0, autoSkip: false, callback: (v, i) => i % 12 === 0 ? 'A' + (i / 12 + 1) : '' }, grid: { color: '#1e293b' } },
              y: { ticks: { color: '#94a3b8', font: { size: 8 }, callback: v => (v / 1e6).toFixed(1) + 'M' }, grid: { color: '#1e293b' } },
            },
          },
        });
      }
    } catch (e) { console.warn('[Conquest] chart failed:', e); }
  }

  // ─── Handlers ─────────────────────────────────────────────────────
  function _cfg(key, val) {
    if (!S) return;
    if (typeof val === 'number' && isNaN(val)) return;
    S.cfg[key] = val;
    persistCfg();
    recompute();
  }
  // Choisir le scénario AFFICHÉ : les 3 sont déjà calculés → simple re-render
  // (pas de recompute), et on persiste le choix.
  function _selectScenario(mode) {
    if (!S || !S.scenarios[mode]) return;
    S.cfg.finMode = mode;
    S.results = S.scenarios[mode];
    persistCfg();
    render();
  }
  // Survol d'une ouverture → surligne le mois sur la courbe de trésorerie.
  function _hi(month) {
    try {
      if (!S?.chart) return;
      const idx = S.chart.data.datasets.findIndex(d => d.label === SCEN[S.cfg.finMode].label);
      if (idx >= 0) S.chart.setActiveElements([{ datasetIndex: idx, index: month }]);
      S.chart.tooltip?.setActiveElements([{ datasetIndex: idx, index: month }], {});
      S.chart.update();
    } catch {}
  }
  function _toggle(siteIdx, on) { if (!S) return; S.sites[siteIdx].enabled = on; recompute(); }
  function _move(planIdx, dir) {
    if (!S) return;
    const enabledIds = S.order.filter(id => S.sites[id].enabled);
    const j = planIdx + dir;
    if (j < 0 || j >= enabledIds.length) return;
    const a = enabledIds[planIdx], b = enabledIds[j];
    const ia = S.order.indexOf(a), ib = S.order.indexOf(b);
    S.order[ia] = b; S.order[ib] = a;
    recompute();
  }

  window.ConquestPlan = { open, close, _cfg, _selectScenario, _hi, _toggle, _move };
})();
