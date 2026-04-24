// ================================================================
// BP SITE UI — rend les 2 scénarios BP côte à côte dans la fiche site
// ================================================================
// Scénario A "BP Franchise" : targetMembers = baseline Excel (C34 = 3600)
// Scénario B "Projection outil" : targetMembers = captage réaliste calculé
//
// Les 2 scénarios partagent surface/loyer/charges du site et la courbe
// de ramp-up baseline (70%/90%/100%). Le delta = prime de localisation
// pure, non pollué par des hypothèses supplémentaires.
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
  function fmtPctDelta(v) {
    if (v == null || !isFinite(v)) return '–';
    const s = v >= 0 ? '+' : '';
    return s + (v * 100).toFixed(1) + 'pp';
  }
  function fmtNb(v) {
    if (v == null || !isFinite(v)) return '–';
    return FMT_EUR.format(Math.round(v));
  }

  // ───────────────── CORE ─────────────────

  // No shared chart state — we key instances to the canvas via Chart.getChart().

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

  // Verdict 1 phrase — prime de localisation EBITDA Y5.
  // Couleurs en hex pour permettre le suffix alpha (#rrggbbAA) dans les gradients.
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

  // Couleur delta selon signe et magnitude.
  function deltaColor(a, b, invertSign) {
    if (a == null || b == null) return 'var(--gray)';
    const d = invertSign ? (a - b) : (b - a);
    if (Math.abs(d) < 1e-9) return 'var(--gray)';
    return d > 0 ? 'var(--green)' : 'var(--red)';
  }

  function deltaAbs(a, b, fmt) {
    if (a == null || b == null) return '–';
    const d = b - a;
    const sign = d >= 0 ? '+' : '';
    return sign + fmt(d);
  }

  // ───────────────── RENDER ─────────────────

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

  function buildHTML(params, kpis, opts) {
    const { a, b } = kpis;
    const verdict = buildVerdict(a, b);
    const fullscreen = opts && opts.fullscreen;

    // KPI duel : CA Y5, EBITDA Y5, Marge EBITDA Y5, TRI 10a, Payback
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

    const chartHeight = fullscreen ? 260 : 180;
    const canvasId = (opts && opts.canvasId) || 'bpSiteChart';
    const chart = `
      <div style="background:var(--bg);border-radius:6px;padding:8px;margin-bottom:10px">
        <div style="font-size:8px;font-weight:700;color:var(--gray);margin-bottom:6px">COURBES A1 → A10 — CA & EBITDA</div>
        <div style="position:relative;height:${chartHeight}px;width:100%"><canvas id="${canvasId}"></canvas></div>
      </div>
    `;

    // Tableau A1→A10 : CA + EBITDA par année, 2 scénarios.
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
      <details ${fullscreen ? 'open' : ''} style="background:var(--bg);border-radius:6px;padding:8px">
        <summary style="cursor:pointer;font-size:8px;font-weight:700;color:var(--gray);list-style:none;outline:none">
          ▾ Détail A1 → A10 (CA, EBITDA, Marge)
        </summary>
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
        <br>Variables site appliquées : Surface <b style="color:var(--white)">${fmtNb(params.surface)} m²</b> ·
        Loyer <b style="color:var(--white)">${params.loyerM2Month}€/m²/mois</b> (${fmtK(params.loyerM2Month*params.surface)}/mois) ·
        Charges <b style="color:var(--white)">${params.chargesM2Month}€/m²/mois</b> (${fmtK(params.chargesM2Month*params.surface)}/mois)
        <br>Ramp-up identique (${Math.round((global.BPRunner.getBaselineInput('C35')||0.7)*100)}% → ${Math.round((global.BPRunner.getBaselineInput('C36')||0.9)*100)}% → 100%) — seule la <b>cible adhérents</b> diffère entre les 2 scénarios.
        <br>Source : moteur Excel BP v2Financement mix (3 659 formules, parité 1:1). Recalc ${kpis.a.elapsedMs?.toFixed(0) || '?'}ms × 2.
        <br><span style="color:var(--gray)">TRI/Payback recalculés avec CAPEX ${fmtK(Math.abs(kpis.a.capexTotal || 0))} en Y1 seulement (retraitement décidé par Paul — la maquette Excel répète =−HYPOTHESES!C81 sur 10 ans dans PL_CLUB_TYPE!C45:L45). Vue consolidée master-franchisé : <b>💰 Éditer BP</b>.</span>
      </div>
    `;

    const verdictBlock = `
      <div style="background:linear-gradient(135deg,${verdict.color}18,${verdict.color}04);border-left:3px solid ${verdict.color};border-radius:6px;padding:10px 12px;margin-bottom:12px">
        <div style="font-size:7px;font-weight:800;color:var(--gray2);letter-spacing:0.6px;margin-bottom:3px">VERDICT</div>
        <div style="font-size:${fullscreen ? 15 : 12}px;font-weight:800;color:${verdict.color};line-height:1.3">${verdict.text}</div>
      </div>
    `;

    return verdictBlock + kpiBar + chart + table + overrides;
  }

  function drawChart(canvasId, a, b) {
    const el = document.getElementById(canvasId);
    if (!el || typeof Chart === 'undefined') return;
    // Destroy any existing Chart instance bound to this canvas before re-drawing.
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
          x: { ticks: { color: '#94a3b8', font: { size: 8 } }, grid: { color: 'rgba(71,85,115,.12)' } },
          y: { ticks: { color: '#94a3b8', font: { size: 8 }, callback: v => (v/1000).toFixed(0) + 'k' }, grid: { color: 'rgba(71,85,115,.12)' } },
        },
      },
    });
  }

  // ───────────────── PUBLIC API ─────────────────

  // Render dans un container. Async, safe à re-appeler.
  // opts: { canvasId? } — override l'id du canvas si besoin d'éviter les collisions.
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
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);backdrop-filter:blur(8px);z-index:10000;display:flex;align-items:stretch;justify-content:center;padding:24px;animation:fadeIn 200ms ease-out;font-family:var(--font)';
    modal.innerHTML = `
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;width:100%;max-width:1200px;max-height:100%;display:flex;flex-direction:column;overflow:hidden">
        <header style="padding:14px 18px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;background:linear-gradient(135deg,rgba(212,160,23,.08),rgba(16,185,129,.06))">
          <div>
            <div style="font-size:14px;font-weight:800;color:var(--white)">🏦 BP du site · ${(data.params.siteName || 'Site').replace(/</g,'&lt;')}</div>
            <div style="font-size:8px;color:var(--gray2);margin-top:2px">2 scénarios comparés — BP Franchise vs Projection outil</div>
          </div>
          <button onclick="BPSiteUI.closeFullscreen()" style="background:transparent;border:1px solid var(--border);border-radius:6px;color:var(--gray);width:32px;height:32px;cursor:pointer;font-size:14px;font-weight:700">✕</button>
        </header>
        <div id="bpSiteFullscreenBody" style="padding:18px;overflow-y:auto;flex:1"></div>
      </div>
    `;
    document.body.appendChild(modal);
    const body = modal.querySelector('#bpSiteFullscreenBody');
    body.innerHTML = buildHTML(data.params, data.kpis, { fullscreen: true, canvasId: 'bpSiteChartFull' });
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
