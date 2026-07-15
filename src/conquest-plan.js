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
  // financingMode: 'ref' (financement global actuel) | 'equity' (0 dette)
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
      if (financingMode === 'equity') window._financingOverride = { enabled: false };
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
  function computePlan() {
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
      for (; m <= HORIZON - 6; m++) {
        const y = Math.floor(m / 12);
        if ((opensInYear[y] || 0) >= perYearCap) { m = (y + 1) * 12 - 1; continue; }
        // mode de financement de CE club à CE mois
        const useDebt = cfg.finMode === 'ref' || (cfg.finMode === 'hybrid' && bankableAt(m, plan, cfg));
        const variant = useDebt ? 'ref' : 'equity';
        if (!meta['_p_' + variant]) {
          const p = sitePnl(meta.site, meta.cannFactor, variant);
          p._posRunAt = consecutivePositiveAt(p, cfg.bankPosMonths);
          meta['_p_' + variant] = p;
        }
        const p = meta['_p_' + variant];
        if (!cfg.enforceCash || cashAvailableAt(m, plan, cfg) >= p.equity) {
          chosen = { ...meta, ...p, openMonth: m, financedByDebt: useDebt };
          break;
        }
      }
      if (!chosen) {
        // jamais finançable sur l'horizon → non planifié
        chosen = { ...meta, ...(meta['_p_equity'] || meta['_p_ref'] || sitePnl(meta.site, meta.cannFactor, cfg.finMode === 'ref' ? 'ref' : 'equity')), openMonth: null, financedByDebt: false };
        plan.push(chosen);
        continue;
      }
      plan.push(chosen);
      opensInYear[Math.floor(chosen.openMonth / 12)] = (opensInYear[Math.floor(chosen.openMonth / 12)] || 0) + 1;
      lastOpen = chosen.openMonth;
    }
    const scheduled = plan.filter(p => p.openMonth != null);
    // courbe consolidée (hors enveloppe initiale)
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
    // mois de bancabilité (post-hoc, sur le plan final)
    let bankMonth = null;
    for (let m = 0; m <= HORIZON; m++) {
      if (bankableAt(m, scheduled, cfg)) { bankMonth = m; break; }
    }
    S.results = {
      plan, scheduled, curve, cum, peakNeed, npv, bankMonth,
      totalEquity: scheduled.reduce((a, p) => a + p.equity, 0),
      totalTV: scheduled.reduce((a, p) => a + p.tv, 0),
      fcfeAtHorizon: cum[HORIZON],
      loanService: standardLoanAnnualService(),
    };
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

  function render() {
    const wrap = document.getElementById('fpConquest');
    if (!wrap || !S) return;
    try { S.chart?.destroy(); } catch {}
    const R = S.results, cfg = S.cfg;
    const feasible = R.peakNeed <= cfg.equityPool;
    const scheduledCount = R.scheduled.length;
    const unscheduled = R.plan.filter(p => p.openMonth == null);

    const ganttRow = (ps, idx) => {
      if (ps.openMonth == null) return `
        <div style="display:grid;grid-template-columns:24px 150px 1fr;gap:8px;align-items:center;padding:4px 0;border-bottom:1px solid rgba(71,85,115,.12);opacity:.5">
          <div></div>
          <div><div style="font-size:10px;font-weight:700;color:var(--red)">${idx + 1}. ${ps.site.name.replace(/</g,'&lt;')}</div>
          <div style="font-size:8px;color:var(--red)">non finançable sur 10 ans</div></div><div></div>
        </div>`;
      const left = (ps.openMonth / HORIZON * 100).toFixed(1);
      const width = Math.min(100 - left, ((HORIZON - ps.openMonth) / HORIZON * 100)).toFixed(1);
      const finBadge = ps.financedByDebt
        ? '<span style="color:#60a5fa;font-weight:700">🏦 dette 70%</span>'
        : '<span style="color:var(--accent);font-weight:700">💰 100% FP</span>';
      return `
        <div style="display:grid;grid-template-columns:24px 150px 1fr;gap:8px;align-items:center;padding:4px 0;border-bottom:1px solid rgba(71,85,115,.12)">
          <div style="display:flex;flex-direction:column;gap:1px">
            <button onclick="ConquestPlan._move(${idx},-1)" ${idx === 0 ? 'disabled' : ''} style="background:transparent;border:none;color:var(--gray2);cursor:pointer;font-size:9px;padding:0">▲</button>
            <button onclick="ConquestPlan._move(${idx},1)" ${idx === R.plan.length - 1 ? 'disabled' : ''} style="background:transparent;border:none;color:var(--gray2);cursor:pointer;font-size:9px;padding:0">▼</button>
          </div>
          <div>
            <div style="font-size:10px;font-weight:700;color:var(--white);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${idx + 1}. ${ps.site.name.replace(/</g,'&lt;')}</div>
            <div style="font-size:8px;color:var(--gray2)">${monthLabel(ps.openMonth)} · ${kE(ps.equity)} · ${finBadge}${ps.penaltyPct > 0 ? ` · <span style="color:var(--orange)">−${ps.penaltyPct}% cannib.</span>` : ''}</div>
          </div>
          <div style="position:relative;height:16px;background:var(--bg);border-radius:4px;overflow:hidden">
            <div style="position:absolute;left:${left}%;width:${width}%;height:100%;background:linear-gradient(90deg,${ps.financedByDebt ? '#60a5fa55' : '#d4a01766'},#34d39955);border-left:3px solid ${ps.financedByDebt ? '#60a5fa' : 'var(--accent)'};border-radius:3px"></div>
            <div style="position:absolute;left:${left}%;top:0;font-size:7px;color:var(--white);padding:2px 4px;font-weight:700">${F(ps.members)} mbr</div>
          </div>
        </div>`;
    };

    const bankTile = R.bankMonth != null
      ? [`🏦 ${monthLabel(R.bankMonth)}`, 'BANCABLE À PARTIR DE', 'critères remplis (détail à gauche)', 'var(--green)']
      : ['🏦 non atteint', 'BANCABILITÉ', 'critères non remplis sur 10 ans', 'var(--red)'];

    wrap.innerHTML = `
      <header style="padding:12px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
        <div>
          <div style="font-size:16px;font-weight:900;color:var(--white)">🗺️ Plan de Conquête — Bucarest</div>
          <div style="font-size:9px;color:var(--gray2);margin-top:2px">Séquencement sous contraintes de cash · cannibalisation inter-FP · bancabilité modélisée · horizon 10 ans</div>
        </div>
        <button onclick="ConquestPlan.close()" style="background:transparent;border:1px solid var(--border);border-radius:6px;color:var(--gray);width:34px;height:34px;cursor:pointer;font-size:15px;font-weight:700">✕</button>
      </header>

      <div style="flex:1;overflow-y:auto;padding:14px 20px">
        <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:14px">
          ${[
            [String(scheduledCount) + (unscheduled.length ? '<span style="font-size:10px;color:var(--red)"> +' + unscheduled.length + ' bloqués</span>' : ''), 'CLUBS PLANIFIÉS', 'sur ' + S.sites.filter(s => s.enabled).length + ' retenus', 'var(--white)'],
            [mE(R.peakNeed), 'PIC DE FINANCEMENT', 'besoin externe max (ramp-up inclus)', feasible ? 'var(--green)' : 'var(--red)'],
            bankTile,
            [mE(R.totalEquity), 'FONDS PROPRES ENGAGÉS', cfg.finMode === 'equity' ? '100% FP — aucune dette' : cfg.finMode === 'hybrid' ? 'FP puis dette dès bancabilité' : 'structure BP 30/70', 'var(--accent)'],
            [mE(Math.max(0, R.fcfeAtHorizon)), 'CASH GÉNÉRÉ À 10 ANS', 'FCFE consolidé cumulé net', R.fcfeAtHorizon > 0 ? 'var(--green)' : 'var(--red)'],
            [mE(R.totalTV), 'VALEUR PORTEFEUILLE', 'Σ sorties à ' + (typeof getEffectiveExitMultiple === 'function' ? getEffectiveExitMultiple() : 8) + '× EBITDA A5', 'var(--cyan)'],
          ].map(([v, l, h, c]) => `
            <div style="background:var(--bg2);border:1px solid var(--border);border-radius:9px;padding:10px 12px">
              <div style="font-size:16px;font-weight:900;color:${c};white-space:nowrap">${v}</div>
              <div style="font-size:7.5px;font-weight:700;color:var(--gray);letter-spacing:.5px;margin-top:2px">${l}</div>
              <div style="font-size:7px;color:var(--gray2);margin-top:1px">${h}</div>
            </div>`).join('')}
        </div>
        ${!feasible ? `<div style="background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.4);border-radius:8px;padding:8px 12px;font-size:10px;color:var(--red);font-weight:700;margin-bottom:12px">
          ⚠ Le pic de financement (${mE(R.peakNeed)}) dépasse ton enveloppe (${mE(cfg.equityPool)}) — augmente l'enveloppe, espace les ouvertures, ou passe en mode hybride.
        </div>` : ''}

        <div style="display:grid;grid-template-columns:290px 1fr;gap:14px;align-items:start">
          <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:12px">
            <div style="font-size:10px;font-weight:800;color:var(--accent);margin-bottom:6px">FINANCEMENT</div>
            ${[['ref', '🏦 Dette dès le départ (réf. BP 30/70)'], ['equity', '💰 Fonds propres uniquement'], ['hybrid', '💰→🏦 FP puis dette dès bancabilité']].map(([v, l]) => `
              <label style="display:flex;align-items:center;gap:6px;font-size:9.5px;color:${cfg.finMode === v ? 'var(--white)' : 'var(--gray2)'};cursor:pointer;padding:2px 0">
                <input type="radio" name="finMode" ${cfg.finMode === v ? 'checked' : ''} onchange="ConquestPlan._cfg('finMode','${v}')" style="accent-color:var(--accent)">${l}
              </label>`).join('')}

            <div style="font-size:9px;font-weight:800;color:#60a5fa;margin:10px 0 4px" title="Conventions bancaires standard — ajuste selon tes échanges avec les banques roumaines (BCR, BT, BRD…)">🏦 CRITÈRES DE BANCABILITÉ (réglables)</div>
            <label style="display:block;font-size:8.5px;color:var(--gray);margin-bottom:2px">Historique minimum du 1er club (mois)</label>
            <input type="number" min="6" max="36" value="${cfg.bankTrackMonths}" onchange="ConquestPlan._cfg('bankTrackMonths', parseInt(this.value,10))"
              style="width:100%;padding:6px 9px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--white);font-size:10px;margin-bottom:6px;font-family:var(--font)">
            <label style="display:block;font-size:8.5px;color:var(--gray);margin-bottom:2px">Mois consécutifs d'EBITDA positif exigés</label>
            <input type="number" min="3" max="24" value="${cfg.bankPosMonths}" onchange="ConquestPlan._cfg('bankPosMonths', parseInt(this.value,10))"
              style="width:100%;padding:6px 9px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--white);font-size:10px;margin-bottom:6px;font-family:var(--font)">
            <label style="display:block;font-size:8.5px;color:var(--gray);margin-bottom:2px">DSCR consolidé exigé (EBITDA 12M / service prêt : ${kE(R.loanService)}/an)</label>
            <input type="number" step="0.1" min="1" max="3" value="${cfg.bankDscr}" onchange="ConquestPlan._cfg('bankDscr', parseFloat(this.value))"
              style="width:100%;padding:6px 9px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--white);font-size:10px;margin-bottom:10px;font-family:var(--font)">

            <div style="font-size:10px;font-weight:800;color:var(--accent);margin:6px 0 6px">CONTRAINTES</div>
            <label style="display:block;font-size:8.5px;color:var(--gray);margin-bottom:2px">Enveloppe fonds propres (M€)</label>
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

            <div style="font-size:10px;font-weight:800;color:var(--accent);margin:6px 0 6px">SITES (${S.sites.filter(s => s.enabled).length}/${S.sites.length})</div>
            ${S.sites.map((s, i) => `
              <label style="display:flex;align-items:center;gap:6px;font-size:9.5px;color:${s.enabled ? 'var(--white)' : 'var(--gray2)'};cursor:pointer;padding:2px 0">
                <input type="checkbox" ${s.enabled ? 'checked' : ''} onchange="ConquestPlan._toggle(${i}, this.checked)" style="accent-color:var(--accent)">
                <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${s.name.replace(/</g,'&lt;')}</span>
                <span style="font-size:8px;color:var(--gray2)">${s.soloIrrEq != null ? s.soloIrrEq.toFixed(0) + '%' : ''}</span>
              </label>`).join('')}
          </div>

          <div>
            <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:12px">
              <div style="font-size:10px;font-weight:800;color:var(--white);margin-bottom:6px">TRÉSORERIE CONSOLIDÉE HOLDING
                <span style="font-size:8px;color:var(--gray2);font-weight:500">— cumul des flux (hors enveloppe, hors sorties). Point bas = besoin externe.${R.bankMonth != null ? ' Le point 🏦 = bancabilité.' : ''}</span></div>
              <div style="position:relative;height:240px"><canvas id="conquestChart"></canvas></div>
            </div>
            <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:12px">
              <div style="font-size:10px;font-weight:800;color:var(--white);margin-bottom:6px">SÉQUENCE D'OUVERTURES <span style="font-size:8px;color:var(--gray2);font-weight:500">— A1 à A10 · 💰 = fonds propres · 🏦 = dette 70%</span></div>
              ${R.plan.map((ps, idx) => ganttRow(ps, idx)).join('')}
              <div style="display:flex;justify-content:space-between;font-size:7px;color:var(--gray2);margin-top:4px;padding-left:182px">
                ${Array.from({ length: 10 }, (_, y) => `<span>A${y + 1}</span>`).join('')}
              </div>
            </div>
            <div style="font-size:8px;color:var(--gray2);margin-top:10px;line-height:1.6">
              Bancabilité = ① 1er club ≥ ${cfg.bankTrackMonths} mois d'exploitation · ② ≥ ${cfg.bankPosMonths} mois consécutifs d'EBITDA positif · ③ (EBITDA−leasing) 12 derniers mois ≥ ${cfg.bankDscr}× le service annuel d'un prêt club standard (${kE(R.loanService)}).
              Conventions standard à confronter aux banques roumaines — critères réglables à gauche.
              Cannibalisation : réduction de cohorte 50% × overlap (<4 km), avant P&L · >M60 : FCFE moyen année 5 · NPV @12% : ${kE(R.npv)}.
            </div>
          </div>
        </div>
      </div>`;

    try {
      if (typeof Chart !== 'undefined') {
        const labels = Array.from({ length: HORIZON + 1 }, (_, i) => i % 12 === 0 ? 'A' + (i / 12 + 1) : '');
        const datasets = [{
          data: R.cum, borderColor: '#d4a017', borderWidth: 2, pointRadius: 0,
          fill: { target: 'origin', above: 'rgba(52,211,153,.08)', below: 'rgba(239,68,68,.12)' },
        }];
        if (R.bankMonth != null) {
          const pt = new Array(HORIZON + 1).fill(null);
          pt[R.bankMonth] = R.cum[R.bankMonth];
          datasets.push({ data: pt, pointRadius: 7, pointStyle: 'rectRot', pointBackgroundColor: '#60a5fa', pointBorderColor: '#fff', pointBorderWidth: 1.5, showLine: false });
        }
        S.chart = new Chart(document.getElementById('conquestChart'), {
          type: 'line',
          data: { labels, datasets },
          options: {
            responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
            plugins: { legend: { display: false }, tooltip: { callbacks: {
              title: items => 'Mois ' + items[0].dataIndex + (R.bankMonth === items[0].dataIndex ? ' — 🏦 BANCABLE' : ''),
              label: ctx => 'Cumul : ' + F(Math.round(ctx.parsed.y / 1000)) + ' k€',
            }}},
            scales: {
              x: { ticks: { color: '#94a3b8', font: { size: 8 }, maxRotation: 0 }, grid: { color: '#1e293b' } },
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

  window.ConquestPlan = { open, close, _cfg, _toggle, _move };
})();
