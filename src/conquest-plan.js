// ═════════════════════════════════════════════════════════════════════
// PLAN DE CONQUÊTE (v6.73) — planificateur de déploiement multi-sites.
//
// L'outil évaluait les sites un par un ; ce module répond à la question
// du master-franchisé : DANS QUEL ORDRE ouvrir, À QUEL RYTHME, AVEC
// QUEL CASH. Il séquence les ouvertures sous contraintes, modélise la
// cannibalisation entre clubs FP, et produit la courbe de trésorerie
// consolidée holding + le pic de besoin de financement (le chiffre que
// la banque demande).
//
// Modèle :
//  - Chaque site = son P&L complet (buildPnL, overrides per-site
//    restaurés) → cashflows equity mensuels M1-M60 + equity initiale.
//  - Au-delà de M60 : FCFE mensuel = moyenne de l'année 5 (conservateur,
//    pas de croissance A7+ appliquée).
//  - Cannibalisation : pour chaque paire de sites FP à < 4 km, le site
//    ouvert EN SECOND subit une réduction de membres = 50% × overlap
//    (overlap = 1 − d/4000), cumulative si plusieurs voisins, cap 60%.
//    La pénalité est appliquée EN AMONT du P&L (cohorte réduite →
//    re-run buildPnL) : les coûts fixes restent, l'effet marge est réel.
//  - Séquencement : ordre par défaut = IRR equity décroissant,
//    réordonnable à la main. Chaque ouverture attend : (1) son tour
//    selon le rythme max/an et l'écart minimum, (2) que l'equity soit
//    disponible (pool initial + FCFE réinvestis si activé).
//  - Sandbox : mêmes garanties que le Studio FCF — overrides globaux
//    posés/restaurés, rien ne fuit, référence intacte.
// ═════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const F = (typeof fmt === 'function') ? fmt : (x => String(x));
  const kE = v => F(Math.round((v || 0) / 1000)) + ' k€';
  const mE = v => (v / 1e6).toFixed(2).replace('.', ',') + ' M€';
  const HORIZON = 120; // mois
  const LS_KEY = 'fpConquestConfig';

  let S = null; // état: {sites:[], order:[], cfg:{}, results, chart}

  // ─── Collecte des sites candidats (TARGETS + customs vivants) ────
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

  // ─── P&L d'un site, avec facteur de cannibalisation éventuel ─────
  // Retourne {equity, cfMonthly[60], fcfeY5Monthly, irrEquity, members, tv, capex}
  function sitePnl(site, cannibFactor) {
    const saves = {
      rent: window._rentOverride, charge: window._chargeOverride,
      surf: window._surfaceOverride,
    };
    try {
      const key = site.lat.toFixed(3) + ',' + site.lng.toFixed(3);
      window._rentOverride    = window._rentOverrides?.[key]    ? { y1: window._rentOverrides[key] } : null;
      window._chargeOverride  = window._chargeOverrides?.[key]  ? { chargeTotal: window._chargeOverrides[key] } : null;
      window._surfaceOverride = window._surfaceOverrides?.[key] ? { surface: window._surfaceOverrides[key] } : null;
      const radius = window._radiusOverrides?.[key] || 3000;
      const r = runCaptageAnalysis(site.lat, site.lng, radius);
      let cohort = r.scenarios.base.cohort;
      if (cannibFactor < 1) {
        cohort = cohort.map(m => ({ ...m, monthlyCA: m.monthlyCA * cannibFactor, netMembers: Math.round(m.netMembers * cannibFactor) }));
      }
      const p = buildPnL(cohort, r.avgQuartierPrice);
      const cf = p.monthly.map(m => m.cashFlowEquity);
      const y5 = p.monthly.slice(48, 60);
      const fcfeY5Monthly = y5.length ? y5.reduce((a, m) => a + m.cashFlowEquity, 0) / y5.length : 0;
      return {
        equity: p.equity, capex: p.capex, cfMonthly: cf, fcfeY5Monthly,
        irrEquity: p.irrEquity, irr: p.irr, members: Math.round(r.realiste * cannibFactor),
        membersRaw: r.realiste, tv: p.terminalValue, fcfe5y: p.fcfe5y,
      };
    } finally {
      window._rentOverride = saves.rent; window._chargeOverride = saves.charge;
      window._surfaceOverride = saves.surf;
    }
  }

  // ─── Cannibalisation : facteur pour le site j selon les aînés ─────
  function cannibalizationFactor(site, elders) {
    let penalty = 0;
    elders.forEach(e => {
      const d = haversine(site.lat, site.lng, e.lat, e.lng);
      if (d < 4000) penalty += 0.5 * (1 - d / 4000);
    });
    penalty = Math.min(0.6, penalty);
    return { factor: 1 - penalty, penaltyPct: Math.round(penalty * 100) };
  }

  // ─── Moteur de séquencement ───────────────────────────────────────
  function computePlan() {
    const cfg = S.cfg;
    const enabled = S.order.filter(id => S.sites[id].enabled);
    // 1. pénalités selon l'ordre (les aînés cannibalisent les cadets)
    const elders = [];
    const perSite = [];
    for (const id of enabled) {
      const site = S.sites[id];
      const cann = cannibalizationFactor(site, elders);
      const p = sitePnl(site, cann.factor);
      perSite.push({ id, site, ...p, penaltyPct: cann.penaltyPct });
      elders.push(site);
    }
    // 2. calendrier sous contraintes
    const minGap = Math.max(1, cfg.minGapMonths);
    const perYearCap = Math.max(1, cfg.maxPerYear);
    let lastOpen = -Infinity;
    const opensInYear = {};
    const plan = [];
    for (const ps of perSite) {
      let m = Math.max(0, lastOpen + minGap);
      // contrainte rythme annuel
      for (;;) {
        const y = Math.floor(m / 12);
        if ((opensInYear[y] || 0) < perYearCap) break;
        m = (y + 1) * 12;
      }
      // contrainte cash : equity dispo au mois m
      if (cfg.enforceCash) {
        for (; m <= HORIZON - 12; m++) {
          const y = Math.floor(m / 12);
          if ((opensInYear[y] || 0) >= perYearCap) { m = (y + 1) * 12 - 1; continue; }
          const cash = cashAvailableAt(m, plan, cfg);
          if (cash >= ps.equity) break;
        }
      }
      plan.push({ ...ps, openMonth: m });
      opensInYear[Math.floor(m / 12)] = (opensInYear[Math.floor(m / 12)] || 0) + 1;
      lastOpen = m;
    }
    // 3. courbe consolidée (sans le pool — le besoin externe se lit en négatif)
    const curve = new Array(HORIZON + 1).fill(0);
    plan.forEach(ps => {
      curve[ps.openMonth] -= ps.equity;
      for (let i = 0; i < HORIZON - ps.openMonth; i++) {
        const cf = i < 60 ? ps.cfMonthly[i] : ps.fcfeY5Monthly;
        curve[ps.openMonth + 1 + i] = (curve[ps.openMonth + 1 + i] || 0) + cf;
      }
    });
    const cum = [];
    curve.reduce((a, v, i) => (cum[i] = a + v), 0);
    const peakNeed = Math.max(0, -Math.min(...cum));
    // NPV consolidé @12% (mensuel), hors TV
    const rM = Math.pow(1.12, 1 / 12) - 1;
    const npv = curve.reduce((a, v, t) => a + v / Math.pow(1 + rM, t), 0);
    const totalEquity = plan.reduce((a, p) => a + p.equity, 0);
    const totalTV = plan.reduce((a, p) => a + p.tv, 0);
    const fcfeAtHorizon = cum[HORIZON];
    S.results = { plan, curve, cum, peakNeed, npv, totalEquity, totalTV, fcfeAtHorizon };
  }

  function cashAvailableAt(month, alreadyPlanned, cfg) {
    let cash = cfg.equityPool;
    alreadyPlanned.forEach(ps => {
      cash -= ps.equity;
      if (cfg.reinvest) {
        for (let i = 0; i < month - ps.openMonth; i++) {
          const cf = i < 60 ? ps.cfMonthly[i] : ps.fcfeY5Monthly;
          if (cf > 0) cash += cf; // seuls les FCFE positifs sont réinvestissables
        }
      }
    });
    return cash;
  }

  // ─── Config persistée ─────────────────────────────────────────────
  function loadCfg() {
    try { return { ...defaultCfg(), ...(JSON.parse(localStorage.getItem(LS_KEY) || '{}')) }; }
    catch { return defaultCfg(); }
  }
  function defaultCfg() {
    // Réf BP consolidé : equity fondateurs 3.2 M€ (01_DCF_BPI)
    return { equityPool: 3200000, maxPerYear: 2, minGapMonths: 4, reinvest: true, enforceCash: true };
  }
  function persistCfg() { try { localStorage.setItem(LS_KEY, JSON.stringify(S.cfg)); } catch {} }

  // ─── UI ───────────────────────────────────────────────────────────
  function open() {
    const cands = candidateSites();
    if (cands.length < 2) { alert('Il faut au moins 2 sites (TARGETS ou Mes sites) pour planifier une conquête.'); return; }
    S = {
      sites: cands.map((c, i) => ({ ...c, enabled: true, _id: i })),
      order: null, cfg: loadCfg(), results: null, chart: null,
    };
    // pré-calcul IRR de chaque site (sans cannibalisation) pour l'ordre par défaut
    const solo = S.sites.map((s, i) => ({ i, p: sitePnl(s, 1) }));
    solo.forEach(x => { Object.assign(S.sites[x.i], { soloIrrEq: x.p.irrEquity, soloMembers: x.p.membersRaw, soloEquity: x.p.equity }); });
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
    const y = Math.floor(m / 12) + 1;
    return 'A' + y + ' M' + ((m % 12) + 1);
  }

  function render() {
    const wrap = document.getElementById('fpConquest');
    if (!wrap || !S) return;
    try { S.chart?.destroy(); } catch {}
    const R = S.results;
    const cfg = S.cfg;
    const feasible = R.peakNeed <= cfg.equityPool;

    const ganttRow = (ps, idx) => {
      const left = (ps.openMonth / HORIZON * 100).toFixed(1);
      const width = Math.min(100 - left, ((HORIZON - ps.openMonth) / HORIZON * 100)).toFixed(1);
      return `
        <div style="display:grid;grid-template-columns:24px 150px 1fr;gap:8px;align-items:center;padding:4px 0;border-bottom:1px solid rgba(71,85,115,.12)">
          <div style="display:flex;flex-direction:column;gap:1px">
            <button onclick="ConquestPlan._move(${idx},-1)" ${idx === 0 ? 'disabled' : ''} style="background:transparent;border:none;color:var(--gray2);cursor:pointer;font-size:9px;padding:0">▲</button>
            <button onclick="ConquestPlan._move(${idx},1)" ${idx === S.order.filter(id => S.sites[id].enabled).length - 1 ? 'disabled' : ''} style="background:transparent;border:none;color:var(--gray2);cursor:pointer;font-size:9px;padding:0">▼</button>
          </div>
          <div>
            <div style="font-size:10px;font-weight:700;color:var(--white);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${idx + 1}. ${ps.site.name.replace(/</g,'&lt;')}</div>
            <div style="font-size:8px;color:var(--gray2)">${monthLabel(ps.openMonth)} · ${kE(ps.equity)} · IRR eq ${ps.irrEquity}%${ps.penaltyPct > 0 ? ` · <span style="color:var(--orange)">−${ps.penaltyPct}% cannib.</span>` : ''}</div>
          </div>
          <div style="position:relative;height:16px;background:var(--bg);border-radius:4px;overflow:hidden">
            <div style="position:absolute;left:${left}%;width:${width}%;height:100%;background:linear-gradient(90deg,#d4a01766,#34d39955);border-left:3px solid var(--accent);border-radius:3px"></div>
            <div style="position:absolute;left:${left}%;top:0;font-size:7px;color:var(--white);padding:2px 4px;font-weight:700">${F(ps.members)} mbr</div>
          </div>
        </div>`;
    };

    const enabledPlan = R.plan;
    wrap.innerHTML = `
      <header style="padding:12px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
        <div>
          <div style="font-size:16px;font-weight:900;color:var(--white)">🗺️ Plan de Conquête — Bucarest</div>
          <div style="font-size:9px;color:var(--gray2);margin-top:2px">Séquencement d'ouvertures sous contraintes de cash · cannibalisation inter-FP modélisée (cohortes réduites, coûts fixes conservés) · horizon 10 ans</div>
        </div>
        <button onclick="ConquestPlan.close()" style="background:transparent;border:1px solid var(--border);border-radius:6px;color:var(--gray);width:34px;height:34px;cursor:pointer;font-size:15px;font-weight:700">✕</button>
      </header>

      <div style="flex:1;overflow-y:auto;padding:14px 20px">
        <!-- KPIs consolidés -->
        <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:14px">
          ${[
            [String(enabledPlan.length), 'CLUBS PLANIFIÉS', 'sur ' + S.sites.length + ' sites candidats', 'var(--white)'],
            [mE(R.peakNeed), 'PIC DE FINANCEMENT', 'besoin externe max — le chiffre banque', feasible ? 'var(--green)' : 'var(--red)'],
            [mE(R.totalEquity), 'EQUITY DÉPLOYÉE', cfg.reinvest ? 'FCFE réinvestis en cours de route' : 'sans réinvestissement', 'var(--accent)'],
            [mE(Math.max(0, R.fcfeAtHorizon)), 'CASH GÉNÉRÉ À 10 ANS', 'FCFE consolidé cumulé net', R.fcfeAtHorizon > 0 ? 'var(--green)' : 'var(--red)'],
            [mE(R.totalTV), 'VALEUR PORTEFEUILLE', 'Σ sorties à ' + (typeof getEffectiveExitMultiple === 'function' ? getEffectiveExitMultiple() : 8) + '× EBITDA A5', 'var(--cyan)'],
          ].map(([v, l, h, c]) => `
            <div style="background:var(--bg2);border:1px solid var(--border);border-radius:9px;padding:10px 12px">
              <div style="font-size:17px;font-weight:900;color:${c};white-space:nowrap">${v}</div>
              <div style="font-size:7.5px;font-weight:700;color:var(--gray);letter-spacing:.5px;margin-top:2px">${l}</div>
              <div style="font-size:7px;color:var(--gray2);margin-top:1px">${h}</div>
            </div>`).join('')}
        </div>
        ${!feasible ? `<div style="background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.4);border-radius:8px;padding:8px 12px;font-size:10px;color:var(--red);font-weight:700;margin-bottom:12px">
          ⚠ Le pic de financement (${mE(R.peakNeed)}) dépasse ton enveloppe (${mE(cfg.equityPool)}) — augmente l'enveloppe, espace les ouvertures, ou active le réinvestissement.
        </div>` : ''}

        <div style="display:grid;grid-template-columns:290px 1fr;gap:14px;align-items:start">
          <!-- Contraintes + sites -->
          <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:12px">
            <div style="font-size:10px;font-weight:800;color:var(--accent);margin-bottom:8px">CONTRAINTES</div>
            <label style="display:block;font-size:9px;color:var(--gray);margin-bottom:2px">Enveloppe equity (M€) — réf. BP : 3,2 M€</label>
            <input type="number" step="0.1" min="0" value="${(cfg.equityPool / 1e6).toFixed(1)}" onchange="ConquestPlan._cfg('equityPool', parseFloat(this.value) * 1e6)"
              style="width:100%;padding:7px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--white);font-size:11px;margin-bottom:8px;font-family:var(--font)">
            <label style="display:block;font-size:9px;color:var(--gray);margin-bottom:2px">Ouvertures max / an</label>
            <input type="number" min="1" max="6" value="${cfg.maxPerYear}" onchange="ConquestPlan._cfg('maxPerYear', parseInt(this.value, 10))"
              style="width:100%;padding:7px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--white);font-size:11px;margin-bottom:8px;font-family:var(--font)">
            <label style="display:block;font-size:9px;color:var(--gray);margin-bottom:2px">Écart minimum entre ouvertures (mois)</label>
            <input type="number" min="1" max="24" value="${cfg.minGapMonths}" onchange="ConquestPlan._cfg('minGapMonths', parseInt(this.value, 10))"
              style="width:100%;padding:7px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--white);font-size:11px;margin-bottom:10px;font-family:var(--font)">
            <label style="display:flex;align-items:center;gap:6px;font-size:9.5px;color:var(--white);cursor:pointer;margin-bottom:5px">
              <input type="checkbox" ${cfg.reinvest ? 'checked' : ''} onchange="ConquestPlan._cfg('reinvest', this.checked)" style="accent-color:var(--accent)">
              Réinvestir les FCFE dans les ouvertures suivantes
            </label>
            <label style="display:flex;align-items:center;gap:6px;font-size:9.5px;color:var(--white);cursor:pointer;margin-bottom:12px">
              <input type="checkbox" ${cfg.enforceCash ? 'checked' : ''} onchange="ConquestPlan._cfg('enforceCash', this.checked)" style="accent-color:var(--accent)">
              Retarder une ouverture si le cash manque
            </label>
            <div style="font-size:10px;font-weight:800;color:var(--accent);margin:10px 0 6px">SITES (${S.sites.filter(s => s.enabled).length}/${S.sites.length})</div>
            ${S.sites.map((s, i) => `
              <label style="display:flex;align-items:center;gap:6px;font-size:9.5px;color:${s.enabled ? 'var(--white)' : 'var(--gray2)'};cursor:pointer;padding:2px 0">
                <input type="checkbox" ${s.enabled ? 'checked' : ''} onchange="ConquestPlan._toggle(${i}, this.checked)" style="accent-color:var(--accent)">
                <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${s.name.replace(/</g,'&lt;')}</span>
                <span style="font-size:8px;color:var(--gray2)">${s.soloIrrEq != null ? s.soloIrrEq.toFixed(0) + '%' : ''}</span>
              </label>`).join('')}
            <div style="font-size:7.5px;color:var(--gray2);margin-top:10px;line-height:1.5">
              Ordre par défaut : IRR equity décroissant. Réordonne avec ▲▼ — la cannibalisation dépend de l'ordre (le premier arrivé garde ses membres).
            </div>
          </div>

          <!-- Courbe + Gantt -->
          <div>
            <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:12px">
              <div style="font-size:10px;font-weight:800;color:var(--white);margin-bottom:6px">TRÉSORERIE CONSOLIDÉE HOLDING <span style="font-size:8px;color:var(--gray2);font-weight:500">— cumul des flux equity (hors enveloppe initiale, hors valeurs de sortie). Le point bas = besoin externe.</span></div>
              <div style="position:relative;height:240px"><canvas id="conquestChart"></canvas></div>
            </div>
            <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:12px">
              <div style="font-size:10px;font-weight:800;color:var(--white);margin-bottom:6px">SÉQUENCE D'OUVERTURES <span style="font-size:8px;color:var(--gray2);font-weight:500">— A1 à A10</span></div>
              ${enabledPlan.map((ps, idx) => ganttRow(ps, idx)).join('')}
              <div style="display:flex;justify-content:space-between;font-size:7px;color:var(--gray2);margin-top:4px;padding-left:182px">
                ${Array.from({ length: 10 }, (_, y) => `<span>A${y + 1}</span>`).join('')}
              </div>
            </div>
            <div style="font-size:8px;color:var(--gray2);margin-top:10px;line-height:1.6">
              Hypothèses : P&L de chaque site avec ses réglages actuels (loyer/charges/surface) et le financement global · au-delà de M60, FCFE = moyenne année 5 (pas de croissance A7+, conservateur) ·
              cannibalisation = réduction de cohorte de 50% × overlap (<4 km) sur le site ouvert en second, cap 60%, appliquée AVANT le P&L (l'effet sur la marge est réel) ·
              NPV consolidé @12% : ${kE(R.npv)} (hors valeurs de sortie).
            </div>
          </div>
        </div>
      </div>`;

    // Chart trésorerie
    try {
      if (typeof Chart !== 'undefined') {
        const labels = Array.from({ length: HORIZON + 1 }, (_, i) => i % 12 === 0 ? 'A' + (i / 12 + 1) : '');
        S.chart = new Chart(document.getElementById('conquestChart'), {
          type: 'line',
          data: { labels, datasets: [{
            data: R.cum, borderColor: '#d4a017', borderWidth: 2, pointRadius: 0,
            fill: { target: 'origin', above: 'rgba(52,211,153,.08)', below: 'rgba(239,68,68,.12)' },
          }]},
          options: {
            responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
            plugins: { legend: { display: false }, tooltip: { callbacks: {
              title: items => 'Mois ' + items[0].dataIndex + ' (' + monthLabel(Math.max(0, items[0].dataIndex - 1)) + ')',
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
    if (!S || isNaN(val) && typeof val !== 'boolean') return;
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
