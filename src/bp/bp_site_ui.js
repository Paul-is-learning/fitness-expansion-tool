// ================================================================
// BP SITE UI — rend les 2 scénarios BP côte à côte dans la fiche site
// ================================================================
// Scénario A "BP Franchise" : targetMembers = baseline Excel (C34 = 3600)
// Scénario B "Projection outil" : targetMembers = captage réaliste calculé
//
// Les 2 scénarios partagent surface/loyer/charges du site et la courbe
// de ramp-up baseline (70%/90%/100%). Le delta = prime de localisation
// pure, non pollué par des hypothèses supplémentaires.
//
// 2 modes d'affichage :
//   - inline (buildHTML)         — dans la fiche site, compact
//   - fullscreen (buildDashboardHTML) — modal data-viz plein écran (v6.65.2)
// ================================================================

(function(global) {
  'use strict';

  const FMT_EUR  = new Intl.NumberFormat('fr-FR');
  function fmtK(v) {
    if (v == null || !isFinite(v)) return '–';
    const a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M€';
    if (a >= 1e3) return (v / 1e3).toFixed(0) + 'k€';
    return FMT_EUR.format(Math.round(v)) + '€';
  }
  function fmtPct(v) {
    if (v == null || !isFinite(v)) return '–';
    return (v * 100).toFixed(1) + '%';
  }
  function fmtNb(v) {
    if (v == null || !isFinite(v)) return '–';
    return FMT_EUR.format(Math.round(v));
  }

  async function run2Scenarios(params) {
    await global.BPRunner.init();
    const targetMembersBP = global.BPRunner.getBaselineInput('C34') || 3600;
    const shared = {
      surface: params.surface,
      loyerM2Month: params.loyerM2Month,
      chargesM2Month: params.chargesM2Month,
    };
    const a = global.BPRunner.run(Object.assign({}, shared, { targetMembers: targetMembersBP }));
    const b = global.BPRunner.run(Object.assign({}, shared, { targetMembers: params.captageMembers }));
    return { a, b, targetMembersBP };
  }

  const C_OK = '#10b981', C_BAD = '#ef4444', C_NEU = '#94a3b8';
  function buildVerdict(a, b) {
    const ea = a.ebitda5, eb = b.ebitda5;
    if (ea == null || eb == null) return { text: 'Impossible de calculer le delta.', color: C_NEU };
    const delta = eb - ea;
    const pct = ea !== 0 ? (delta / Math.abs(ea)) * 100 : 0;
    const sign = delta >= 0 ? '+' : '';
    if (Math.abs(pct) < 2) {
      return { text: 'Site aligné sur le BP franchise (delta EBITDA Y5 < 2%).', color: C_NEU };
    }
    if (delta > 0) {
      return {
        text: `Site surperforme le BP franchise de ${sign}${pct.toFixed(0)}% EBITDA Y5 (${sign}${fmtK(delta)}).`,
        color: C_OK,
      };
    }
    return {
      text: `Site sous-performe le BP franchise de ${pct.toFixed(0)}% EBITDA Y5 (${fmtK(delta)}).`,
      color: C_BAD,
    };
  }

  function deltaColor(a, b, invertSign) {
    if (a == null || b == null) return 'var(--gray)';
    const d = invertSign ? (a - b) : (b - a);
    if (Math.abs(d) < 1e-9) return 'var(--gray)';
    return d > 0 ? 'var(--green)' : 'var(--red)';
  }

  function renderKPIRow(label, valA, valB, fmt) {
    const sign = (valA != null && valB != null && (valB - valA) >= 0) ? '+' : '';
    const col = deltaColor(valA, valB);
    return `
      <tr>
        <td style="padding:4px 6px;color:var(--gray2);font-size:8px;font-weight:600">${label}</td>
        <td style="padding:4px 6px;text-align:right;font-size:10px;font-weight:700;color:var(--accent)">${fmt(valA)}</td>
        <td style="padding:4px 6px;text-align:right;font-size:10px;font-weight:700;color:var(--green)">${fmt(valB)}</td>
        <td style="padding:4px 6px;text-align:right;font-size:9px;font-weight:700;color:${col}">${(valA != null && valB != null) ? (sign + fmt(valB - valA)) : '–'}</td>
      </tr>
    `;
  }

  // ─── DASHBOARD FULLSCREEN (v6.65.2) — Data-Viz mode ──────────────
  function buildDashboardHTML(params, kpis) {
    const { a, b } = kpis;
    const verdict = buildVerdict(a, b);
    const deltaEbitda = (b.ebitda5 != null && a.ebitda5 != null) ? (b.ebitda5 - a.ebitda5) : null;
    const deltaEbitdaPct = (deltaEbitda != null && a.ebitda5) ? (deltaEbitda / Math.abs(a.ebitda5) * 100) : null;
    const deltaTri = (b.tri10 != null && a.tri10 != null) ? (b.tri10 - a.tri10) : null;
    const paybackDelta = (a.paybackYear != null && b.paybackYear != null) ? (b.paybackYear - a.paybackYear) : null;

    const heroCard = (title, valueA, valueB, fmt, deltaLabel, deltaVal, deltaColorHex, deltaFmt) => `
      <div style="background:linear-gradient(160deg,rgba(30,41,59,.85) 0%,rgba(17,24,39,.55) 100%);border:1px solid var(--border);border-radius:14px;padding:20px 22px;display:flex;flex-direction:column;gap:8px;min-height:170px;position:relative;overflow:hidden">
        <div style="font-size:9px;font-weight:800;color:var(--gray2);letter-spacing:1.2px;text-transform:uppercase">${title}</div>
        <div style="display:flex;gap:18px;align-items:baseline;margin-top:6px;flex-wrap:wrap">
          <div style="display:flex;flex-direction:column">
            <div style="font-size:8px;font-weight:700;color:var(--accent);letter-spacing:0.8px">BP FRANCHISE</div>
            <div style="font-size:26px;font-weight:900;color:var(--accent);line-height:1;margin-top:2px;font-variant-numeric:tabular-nums">${fmt(valueA)}</div>
          </div>
          <div style="font-size:18px;color:var(--gray);align-self:center">→</div>
          <div style="display:flex;flex-direction:column">
            <div style="font-size:8px;font-weight:700;color:#10b981;letter-spacing:0.8px">PROJECTION OUTIL</div>
            <div style="font-size:32px;font-weight:900;color:#10b981;line-height:1;margin-top:2px;font-variant-numeric:tabular-nums">${fmt(valueB)}</div>
          </div>
        </div>
        ${deltaVal != null ? `<div style="margin-top:auto;padding-top:10px;border-top:1px solid rgba(71,85,115,.3);display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:9px;color:var(--gray2);font-weight:600;text-transform:uppercase;letter-spacing:0.5px">${deltaLabel}</span>
          <span style="font-size:14px;font-weight:800;color:${deltaColorHex};font-variant-numeric:tabular-nums">${deltaFmt(deltaVal)}</span>
        </div>` : ''}
      </div>
    `;

    const verdictHero = `
      <div style="background:linear-gradient(160deg,${verdict.color}22 0%,${verdict.color}06 100%);border:1px solid ${verdict.color}80;border-radius:14px;padding:20px 22px;display:flex;flex-direction:column;gap:10px;min-height:170px;position:relative;overflow:hidden">
        <div style="font-size:9px;font-weight:800;color:var(--gray2);letter-spacing:1.2px;text-transform:uppercase">Verdict — Prime de localisation</div>
        <div style="font-size:18px;font-weight:800;color:${verdict.color};line-height:1.25;margin-top:6px">${verdict.text}</div>
        <div style="margin-top:auto;padding-top:10px;border-top:1px solid ${verdict.color}40;display:flex;justify-content:space-between;align-items:center;font-size:9px;color:var(--gray2)">
          <span>Basé sur l'EBITDA Y5 · Club unitaire</span>
          <span style="color:${verdict.color};font-weight:700">${(params.siteName || 'Site').replace(/</g,'&lt;')}</span>
        </div>
      </div>
    `;

    const heroGrid = `
      <div style="display:grid;grid-template-columns:1.35fr 1fr 1fr 1fr;gap:12px;margin-bottom:16px">
        ${verdictHero}
        ${heroCard('EBITDA Y5', a.ebitda5, b.ebitda5, fmtK, 'Δ Localisation',
          deltaEbitda, deltaEbitda >= 0 ? '#10b981' : '#ef4444',
          v => ((v>=0?'+':'') + fmtK(v) + (deltaEbitdaPct != null ? ` (${(deltaEbitdaPct>=0?'+':'') + deltaEbitdaPct.toFixed(0)}%)` : '')))}
        ${heroCard('TRI 10 ans', a.tri10, b.tri10, fmtPct, 'Écart TRI',
          deltaTri, deltaTri >= 0 ? '#10b981' : '#ef4444',
          v => (v>=0?'+':'') + (v*100).toFixed(1) + ' pp')}
        ${heroCard('Payback', a.paybackYear, b.paybackYear, (v) => v ? 'A' + v : '> A10', 'Accélération',
          paybackDelta, paybackDelta != null && paybackDelta <= 0 ? '#10b981' : '#ef4444',
          v => (v === 0 ? '=' : (v > 0 ? '+' : '') + v + ' an' + (Math.abs(v) > 1 ? 's' : '')))}
      </div>
    `;

    const bigRow = (label, vA, vB, fmt, invertSign) => {
      const col = deltaColor(vA, vB, !!invertSign);
      const sign = vA != null && vB != null && (vB - vA) >= 0 ? '+' : '';
      return `
        <tr style="border-bottom:1px solid rgba(71,85,115,.15)">
          <td style="padding:12px 14px;font-size:11px;color:var(--gray);font-weight:600;letter-spacing:0.3px">${label}</td>
          <td style="padding:12px 14px;text-align:right;font-size:15px;font-weight:800;color:var(--accent);font-variant-numeric:tabular-nums">${fmt(vA)}</td>
          <td style="padding:12px 14px;text-align:right;font-size:15px;font-weight:800;color:#10b981;font-variant-numeric:tabular-nums">${fmt(vB)}</td>
          <td style="padding:12px 14px;text-align:right;font-size:12px;font-weight:800;color:${col};font-variant-numeric:tabular-nums">${(vA != null && vB != null) ? (sign + fmt(vB - vA)) : '–'}</td>
        </tr>
      `;
    };
    const comparisonTable = `
      <div style="background:linear-gradient(180deg,rgba(30,41,59,.6),rgba(17,24,39,.3));border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:16px">
        <div style="padding:14px 18px;background:rgba(15,23,42,.4);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
          <div style="font-size:11px;font-weight:800;color:var(--white);letter-spacing:0.8px">COMPARAISON COMPLÈTE · Y5</div>
          <div style="font-size:9px;color:var(--gray2)">Ramp-up identique (70 % → 90 % → 100 %) · Seule la cible adhérents diffère</div>
        </div>
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="background:rgba(15,23,42,.3)">
              <th style="padding:10px 14px;text-align:left;font-size:9px;color:var(--gray2);font-weight:700;letter-spacing:0.5px"></th>
              <th style="padding:10px 14px;text-align:right;font-size:9px;color:var(--accent);font-weight:800;letter-spacing:0.5px">A · BP FRANCHISE <span style="color:var(--gray2);font-weight:500">${fmtNb(kpis.targetMembersBP)} mbr</span></th>
              <th style="padding:10px 14px;text-align:right;font-size:9px;color:#10b981;font-weight:800;letter-spacing:0.5px">B · PROJECTION OUTIL <span style="color:var(--gray2);font-weight:500">${fmtNb(params.captageMembers)} mbr</span></th>
              <th style="padding:10px 14px;text-align:right;font-size:9px;color:var(--gray2);font-weight:700;letter-spacing:0.5px">Δ LOCALISATION</th>
            </tr>
          </thead>
          <tbody>
            ${bigRow('CA Y5', a.ca5, b.ca5, fmtK)}
            ${bigRow('EBITDA Y5', a.ebitda5, b.ebitda5, fmtK)}
            ${bigRow('Marge EBITDA Y5', a.ebitdaMargin5, b.ebitdaMargin5, fmtPct)}
            ${bigRow('Résultat net Y5', a.netResult5, b.netResult5, fmtK)}
            ${bigRow('TRI 10 ans', a.tri10, b.tri10, fmtPct)}
            <tr>
              <td style="padding:12px 14px;font-size:11px;color:var(--gray);font-weight:600">Payback</td>
              <td style="padding:12px 14px;text-align:right;font-size:15px;font-weight:800;color:var(--accent)">${a.paybackYear ? 'A' + a.paybackYear : '> A10'}</td>
              <td style="padding:12px 14px;text-align:right;font-size:15px;font-weight:800;color:#10b981">${b.paybackYear ? 'A' + b.paybackYear : '> A10'}</td>
              <td style="padding:12px 14px;text-align:right;font-size:12px;font-weight:800;color:${deltaColor(a.paybackYear, b.paybackYear, true)}">${
                paybackDelta != null ? (paybackDelta === 0 ? '=' : (paybackDelta > 0 ? '+' : '') + paybackDelta + ' an') : '–'
              }</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;

    const chartBlock = `
      <div style="background:linear-gradient(180deg,rgba(30,41,59,.6),rgba(17,24,39,.3));border:1px solid var(--border);border-radius:12px;padding:16px 18px;margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:6px">
          <div style="font-size:11px;font-weight:800;color:var(--white);letter-spacing:0.8px">📈 COURBES A1 → A10 · CA &amp; EBITDA</div>
          <div style="font-size:9px;color:var(--gray2)">Lignes pleines = CA · Lignes pointillées = EBITDA</div>
        </div>
        <div style="position:relative;height:380px;width:100%"><canvas id="bpSiteChartFull"></canvas></div>
      </div>
    `;

    const years = Array.from({length: 10}, (_, i) => 'A' + (i + 1));
    const tableRows = years.map((yr, i) => {
      const caA = a.ca[i], caB = b.ca[i];
      const ebA = a.ebitda[i], ebB = b.ebitda[i];
      const mA = a.ebitdaMargin[i], mB = b.ebitdaMargin[i];
      const nA = a.netResult[i], nB = b.netResult[i];
      const deltaEb = ebA != null && ebB != null ? ebB - ebA : null;
      return `<tr style="border-bottom:1px solid rgba(71,85,115,.08)">
        <td style="padding:8px 10px;font-size:10px;font-weight:800;color:var(--white);background:rgba(15,23,42,.3)">${yr}</td>
        <td style="padding:8px 10px;text-align:right;font-size:10px;color:var(--accent);font-variant-numeric:tabular-nums">${fmtK(caA)}</td>
        <td style="padding:8px 10px;text-align:right;font-size:10px;color:#10b981;font-variant-numeric:tabular-nums;font-weight:700">${fmtK(caB)}</td>
        <td style="padding:8px 10px;text-align:right;font-size:10px;color:var(--accent);font-variant-numeric:tabular-nums">${fmtK(ebA)}</td>
        <td style="padding:8px 10px;text-align:right;font-size:10px;color:#10b981;font-variant-numeric:tabular-nums;font-weight:700">${fmtK(ebB)}</td>
        <td style="padding:8px 10px;text-align:right;font-size:10px;color:${deltaEb != null && deltaEb >= 0 ? '#10b981' : '#ef4444'};font-variant-numeric:tabular-nums;font-weight:700">${deltaEb != null ? ((deltaEb>=0?'+':'') + fmtK(deltaEb)) : '–'}</td>
        <td style="padding:8px 10px;text-align:right;font-size:10px;color:var(--accent);opacity:.85;font-variant-numeric:tabular-nums">${fmtPct(mA)}</td>
        <td style="padding:8px 10px;text-align:right;font-size:10px;color:#10b981;opacity:.85;font-variant-numeric:tabular-nums">${fmtPct(mB)}</td>
        <td style="padding:8px 10px;text-align:right;font-size:10px;color:var(--accent);opacity:.7;font-variant-numeric:tabular-nums">${fmtK(nA)}</td>
        <td style="padding:8px 10px;text-align:right;font-size:10px;color:#10b981;opacity:.85;font-variant-numeric:tabular-nums">${fmtK(nB)}</td>
      </tr>`;
    }).join('');
    const detailTable = `
      <div style="background:linear-gradient(180deg,rgba(30,41,59,.6),rgba(17,24,39,.3));border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:16px">
        <div style="padding:14px 18px;background:rgba(15,23,42,.4);border-bottom:1px solid var(--border)">
          <div style="font-size:11px;font-weight:800;color:var(--white);letter-spacing:0.8px">📊 DÉTAIL ANNÉE PAR ANNÉE · A1 → A10</div>
        </div>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;min-width:900px">
            <thead>
              <tr style="background:rgba(15,23,42,.3)">
                <th style="padding:10px 10px;text-align:left;font-size:8px;color:var(--gray2);font-weight:700;letter-spacing:0.5px">ANNÉE</th>
                <th style="padding:10px 10px;text-align:right;font-size:8px;color:var(--accent);font-weight:700">CA · BP</th>
                <th style="padding:10px 10px;text-align:right;font-size:8px;color:#10b981;font-weight:700">CA · OUTIL</th>
                <th style="padding:10px 10px;text-align:right;font-size:8px;color:var(--accent);font-weight:700">EBITDA · BP</th>
                <th style="padding:10px 10px;text-align:right;font-size:8px;color:#10b981;font-weight:700">EBITDA · OUTIL</th>
                <th style="padding:10px 10px;text-align:right;font-size:8px;color:var(--gray2);font-weight:700">Δ EBITDA</th>
                <th style="padding:10px 10px;text-align:right;font-size:8px;color:var(--accent);font-weight:700">MARGE · BP</th>
                <th style="padding:10px 10px;text-align:right;font-size:8px;color:#10b981;font-weight:700">MARGE · OUTIL</th>
                <th style="padding:10px 10px;text-align:right;font-size:8px;color:var(--accent);font-weight:700">NET · BP</th>
                <th style="padding:10px 10px;text-align:right;font-size:8px;color:#10b981;font-weight:700">NET · OUTIL</th>
              </tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>
      </div>
    `;

    const inputTile = (label, val, unit, sub) => `
      <div style="background:rgba(15,23,42,.4);border:1px solid var(--border);border-radius:10px;padding:12px 14px">
        <div style="font-size:9px;color:var(--gray2);font-weight:700;letter-spacing:0.6px;text-transform:uppercase;margin-bottom:4px">${label}</div>
        <div style="font-size:20px;font-weight:800;color:var(--white);line-height:1;font-variant-numeric:tabular-nums">${val} <span style="font-size:11px;color:var(--gray);font-weight:500">${unit || ''}</span></div>
        ${sub ? `<div style="font-size:9px;color:var(--gray2);margin-top:4px">${sub}</div>` : ''}
      </div>
    `;
    const inputsGrid = `
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">
        ${inputTile('Surface', fmtNb(params.surface), 'm²', 'Slider fiche site')}
        ${inputTile('Loyer', params.loyerM2Month, '€/m²/mois', fmtK(params.loyerM2Month * params.surface) + '/mois')}
        ${inputTile('Charges', params.chargesM2Month, '€/m²/mois', fmtK(params.chargesM2Month * params.surface) + '/mois')}
        ${inputTile('Captage outil', fmtNb(params.captageMembers), 'membres', 'vs ' + fmtNb(kpis.targetMembersBP) + ' BP baseline')}
      </div>
    `;

    const metaFooter = `
      <div style="background:rgba(15,23,42,.3);border:1px solid var(--border);border-radius:10px;padding:12px 14px;font-size:9px;color:var(--gray2);line-height:1.5">
        <b style="color:var(--gray)">Source</b> — Moteur Excel BP v2Financement mix (${kpis.a.elapsedMs ? kpis.a.elapsedMs.toFixed(0) + ' ms × 2' : '—'}) · Parité 1:1 golden test 100 % · CAPEX ${fmtK(Math.abs(kpis.a.capexTotal || 0))} en Y1 uniquement · Lecture PL_CLUB_TYPE (club unitaire).
        <br><b style="color:var(--gray)">Ramp-up identique</b> ${Math.round((global.BPRunner.getBaselineInput('C35')||0.7)*100)} % A1 → ${Math.round((global.BPRunner.getBaselineInput('C36')||0.9)*100)} % A2 → 100 % A3+ · Seule la cible adhérents diffère entre les 2 scénarios.
      </div>
    `;

    return heroGrid + comparisonTable + chartBlock + detailTable + inputsGrid + metaFooter;
  }

  // ─── INLINE COMPACT (fiche site) ─────────────────────────────────
  function buildHTML(params, kpis, opts) {
    const { a, b } = kpis;
    const verdict = buildVerdict(a, b);
    const fullscreen = opts && opts.fullscreen;
    if (fullscreen) return buildDashboardHTML(params, kpis);

    const kpiBar = `
      <div style="display:grid;grid-template-columns:1.1fr 1fr 1fr 1fr;gap:6px;margin-bottom:10px">
        <div></div>
        <div style="text-align:center">
          <div style="font-size:7px;font-weight:800;color:var(--accent);letter-spacing:0.6px">BP FRANCHISE</div>
          <div style="font-size:7px;color:var(--gray2)">${fmtNb(kpis.targetMembersBP)} mbr cible</div>
        </div>
        <div style="text-align:center">
          <div style="font-size:7px;font-weight:800;color:var(--green);letter-spacing:0.6px">PROJECTION OUTIL</div>
          <div style="font-size:7px;color:var(--gray2)">${fmtNb(params.captageMembers)} mbr (captage)</div>
        </div>
        <div style="text-align:center">
          <div style="font-size:7px;font-weight:800;color:var(--gray);letter-spacing:0.6px">Δ</div>
          <div style="font-size:7px;color:var(--gray2)">prime localisation</div>
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:12px">
        <tbody>
          ${renderKPIRow('CA Y5',            a.ca5,           b.ca5,           fmtK)}
          ${renderKPIRow('EBITDA Y5',        a.ebitda5,       b.ebitda5,       fmtK)}
          ${renderKPIRow('Marge EBITDA Y5',  a.ebitdaMargin5, b.ebitdaMargin5, fmtPct)}
          ${renderKPIRow('Résultat net Y5',  a.netResult5,    b.netResult5,    fmtK)}
          ${renderKPIRow('TRI 10 ans',       a.tri10,         b.tri10,         fmtPct)}
          <tr>
            <td style="padding:4px 6px;color:var(--gray2);font-size:8px;font-weight:600">Payback</td>
            <td style="padding:4px 6px;text-align:right;font-size:10px;font-weight:700;color:var(--accent)">${a.paybackYear ? 'A' + a.paybackYear : '> A10'}</td>
            <td style="padding:4px 6px;text-align:right;font-size:10px;font-weight:700;color:var(--green)">${b.paybackYear ? 'A' + b.paybackYear : '> A10'}</td>
            <td style="padding:4px 6px;text-align:right;font-size:9px;font-weight:700;color:${deltaColor(a.paybackYear, b.paybackYear, true)}">${
              (a.paybackYear != null && b.paybackYear != null)
                ? ((b.paybackYear - a.paybackYear) === 0 ? '=' : (b.paybackYear - a.paybackYear < 0 ? '' : '+') + (b.paybackYear - a.paybackYear) + ' an')
                : (a.paybackYear == null && b.paybackYear != null) ? 'débloque' : '–'
            }</td>
          </tr>
        </tbody>
      </table>
    `;

    const canvasId = (opts && opts.canvasId) || 'bpSiteChart';
    const chart = `
      <div style="background:var(--bg);border-radius:6px;padding:8px;margin-bottom:10px">
        <div style="font-size:8px;font-weight:700;color:var(--gray);margin-bottom:6px">COURBES A1 → A10 — CA & EBITDA</div>
        <div style="position:relative;height:180px;width:100%"><canvas id="${canvasId}"></canvas></div>
      </div>
    `;

    const years = Array.from({length: 10}, (_, i) => 'A' + (i + 1));
    const tableRows = years.map((yr, i) => {
      const caA = a.ca[i], caB = b.ca[i];
      const ebA = a.ebitda[i], ebB = b.ebitda[i];
      const mA = a.ebitdaMargin[i], mB = b.ebitdaMargin[i];
      return `<tr style="border-bottom:1px solid rgba(71,85,115,.1)">
        <td style="padding:3px 6px;font-size:8px;font-weight:700;color:var(--gray)">${yr}</td>
        <td style="padding:3px 6px;text-align:right;font-size:8px;color:var(--accent)">${fmtK(caA)}</td>
        <td style="padding:3px 6px;text-align:right;font-size:8px;color:var(--green)">${fmtK(caB)}</td>
        <td style="padding:3px 6px;text-align:right;font-size:8px;color:var(--gray2)">${(caA != null && caB != null && caA !== 0) ? ((caB-caA)>=0?'+':'') + ((caB-caA)/Math.abs(caA)*100).toFixed(0)+'%' : '–'}</td>
        <td style="padding:3px 6px;text-align:right;font-size:8px;color:var(--accent)">${fmtK(ebA)}</td>
        <td style="padding:3px 6px;text-align:right;font-size:8px;color:var(--green)">${fmtK(ebB)}</td>
        <td style="padding:3px 6px;text-align:right;font-size:8px;color:var(--accent);opacity:.7">${fmtPct(mA)}</td>
        <td style="padding:3px 6px;text-align:right;font-size:8px;color:var(--green);opacity:.7">${fmtPct(mB)}</td>
      </tr>`;
    }).join('');
    const table = `
      <details style="background:var(--bg);border-radius:6px;padding:8px">
        <summary style="cursor:pointer;font-size:8px;font-weight:700;color:var(--gray);list-style:none;outline:none">▾ Détail A1 → A10 (CA, EBITDA, Marge)</summary>
        <div style="overflow-x:auto;margin-top:8px">
          <table style="width:100%;border-collapse:collapse;font-family:var(--font);min-width:520px">
            <thead>
              <tr style="border-bottom:1px solid rgba(71,85,115,.2)">
                <th style="padding:4px 6px;text-align:left;font-size:7px;color:var(--gray2);font-weight:700"></th>
                <th colspan="2" style="padding:4px 6px;text-align:center;font-size:7px;color:var(--gray);font-weight:700">CA</th>
                <th style="padding:4px 6px;text-align:right;font-size:7px;color:var(--gray2);font-weight:600">Δ%</th>
                <th colspan="2" style="padding:4px 6px;text-align:center;font-size:7px;color:var(--gray);font-weight:700">EBITDA</th>
                <th colspan="2" style="padding:4px 6px;text-align:center;font-size:7px;color:var(--gray);font-weight:700">Marge</th>
              </tr>
              <tr style="border-bottom:1px solid rgba(71,85,115,.2)">
                <th></th>
                <th style="padding:2px 6px;text-align:right;font-size:7px;color:var(--accent);font-weight:700">A · BP</th>
                <th style="padding:2px 6px;text-align:right;font-size:7px;color:var(--green);font-weight:700">B · Outil</th>
                <th></th>
                <th style="padding:2px 6px;text-align:right;font-size:7px;color:var(--accent);font-weight:700">A · BP</th>
                <th style="padding:2px 6px;text-align:right;font-size:7px;color:var(--green);font-weight:700">B · Outil</th>
                <th style="padding:2px 6px;text-align:right;font-size:7px;color:var(--accent);font-weight:700">A · BP</th>
                <th style="padding:2px 6px;text-align:right;font-size:7px;color:var(--green);font-weight:700">B · Outil</th>
              </tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>
      </details>
    `;

    const overrides = `
      <div style="font-size:7px;color:var(--gray2);margin-top:8px;line-height:1.5;padding:6px 8px;background:var(--bg2);border-radius:4px">
        <b style="color:var(--gray)">Vue P&L club unitaire (PL_CLUB_TYPE)</b> — 1 club, 10 ans.
        <br>Variables site appliquées : Surface <b style="color:var(--white)">${fmtNb(params.surface)} m²</b> · Loyer <b style="color:var(--white)">${params.loyerM2Month}€/m²/mois</b> (${fmtK(params.loyerM2Month*params.surface)}/mois) · Charges <b style="color:var(--white)">${params.chargesM2Month}€/m²/mois</b> (${fmtK(params.chargesM2Month*params.surface)}/mois)
        <br>Source : moteur Excel BP v2Financement mix, lecture 1:1 (parité golden test 100%). CAPEX ${fmtK(Math.abs(kpis.a.capexTotal || 0))} en Y1. Recalc ${kpis.a.elapsedMs?.toFixed(0) || '?'}ms × 2.
      </div>
    `;

    const verdictBlock = `
      <div style="background:linear-gradient(135deg,${verdict.color}18,${verdict.color}04);border-left:3px solid ${verdict.color};border-radius:6px;padding:10px 12px;margin-bottom:12px">
        <div style="font-size:7px;font-weight:800;color:var(--gray2);letter-spacing:0.6px;margin-bottom:3px">VERDICT</div>
        <div style="font-size:12px;font-weight:800;color:${verdict.color};line-height:1.3">${verdict.text}</div>
      </div>
    `;

    return verdictBlock + kpiBar + chart + table + overrides;
  }

  function drawChart(canvasId, a, b) {
    const el = document.getElementById(canvasId);
    if (!el || typeof Chart === 'undefined') return;
    const existing = Chart.getChart(el);
    if (existing) { try { existing.destroy(); } catch {} }
    const labels = Array.from({length: 10}, (_, i) => 'A' + (i + 1));
    new Chart(el, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'CA · BP Franchise',    data: a.ca,     borderColor: '#d4a017', backgroundColor: 'rgba(212,160,23,0.08)', borderWidth: 2, pointRadius: 2, fill: false, tension: 0.3 },
          { label: 'CA · Projection outil', data: b.ca,     borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.08)', borderWidth: 2, pointRadius: 2, fill: false, tension: 0.3 },
          { label: 'EBITDA · BP Franchise',    data: a.ebitda, borderColor: '#d4a017', borderDash: [4,4], borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.3 },
          { label: 'EBITDA · Projection outil', data: b.ebitda, borderColor: '#10b981', borderDash: [4,4], borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.3 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: true, position: 'bottom', labels: { color: '#94a3b8', font: { size: 9 }, boxWidth: 12 } },
          tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ': ' + fmtK(ctx.parsed.y) } },
        },
        scales: {
          x: { ticks: { color: '#94a3b8', font: { size: 9 } }, grid: { color: 'rgba(71,85,115,.12)' } },
          y: { ticks: { color: '#94a3b8', font: { size: 9 }, callback: v => (v/1000).toFixed(0) + 'k' }, grid: { color: 'rgba(71,85,115,.12)' } },
        },
      },
    });
  }

  // ─── PUBLIC API ──────────────────────────────────────────────────
  async function render(containerId, params, opts) {
    const c = document.getElementById(containerId);
    if (!c) return;
    const canvasId = (opts && opts.canvasId) || 'bpSiteChart';
    try {
      if (!global.BPEngine || !global.BPRunner) {
        c.innerHTML = `<div style="padding:12px;color:var(--gray2);font-size:9px;text-align:center">Moteur BP indisponible (scripts non chargés).</div>`;
        return;
      }
      c.innerHTML = `<div style="padding:16px;color:var(--gray2);font-size:9px;text-align:center">Calcul du BP du site en cours…</div>`;
      const kpis = await run2Scenarios(params);
      c.innerHTML = buildHTML(params, kpis, { fullscreen: false, canvasId });
      setTimeout(() => drawChart(canvasId, kpis.a, kpis.b), 0);
      global._lastBPSiteKPIs = { params, kpis };
      if (typeof global.saveBPSiteScenarios === 'function') {
        try { global.saveBPSiteScenarios(params, kpis); } catch {}
      }
    } catch (e) {
      console.error('[BPSiteUI] render error', e);
      c.innerHTML = `<div style="padding:12px;color:var(--red);font-size:9px;text-align:center">Erreur moteur BP : ${e.message}</div>`;
    }
  }

  function openFullscreen() {
    const data = global._lastBPSiteKPIs;
    if (!data) return;
    let modal = document.getElementById('bpSiteFullscreenModal');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'bpSiteFullscreenModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);backdrop-filter:blur(10px);z-index:10000;display:flex;align-items:stretch;justify-content:center;padding:20px;animation:fadeIn 200ms ease-out;font-family:var(--font)';
    modal.innerHTML = `
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:14px;width:100%;max-width:1600px;max-height:100%;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,.6)">
        <header style="padding:18px 24px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;background:linear-gradient(135deg,rgba(212,160,23,.1),rgba(16,185,129,.08));flex-shrink:0">
          <div>
            <div style="font-size:16px;font-weight:800;color:var(--white);letter-spacing:-0.2px">🏦 BP du site · ${(data.params.siteName || 'Site').replace(/</g,'&lt;')}</div>
            <div style="font-size:10px;color:var(--gray2);margin-top:3px;letter-spacing:0.2px">Dashboard Data-Viz — BP Franchise vs Projection outil · Club unitaire</div>
          </div>
          <button onclick="BPSiteUI.closeFullscreen()" title="Fermer (Esc)" style="background:transparent;border:1px solid var(--border);border-radius:8px;color:var(--gray);width:36px;height:36px;cursor:pointer;font-size:16px;font-weight:700;transition:all .15s ease">✕</button>
        </header>
        <div id="bpSiteFullscreenBody" style="padding:22px 24px;overflow-y:auto;flex:1"></div>
      </div>
    `;
    document.body.appendChild(modal);
    const body = modal.querySelector('#bpSiteFullscreenBody');
    body.innerHTML = buildHTML(data.params, data.kpis, { fullscreen: true });
    setTimeout(() => drawChart('bpSiteChartFull', data.kpis.a, data.kpis.b), 0);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeFullscreen(); });
    document.addEventListener('keydown', escHandler);
  }

  function escHandler(e) { if (e.key === 'Escape') closeFullscreen(); }

  function closeFullscreen() {
    const modal = document.getElementById('bpSiteFullscreenModal');
    if (modal) modal.remove();
    document.removeEventListener('keydown', escHandler);
  }

  global.BPSiteUI = { render, openFullscreen, closeFullscreen };
})(window);
