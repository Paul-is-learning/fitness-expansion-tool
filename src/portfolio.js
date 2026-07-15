// ═════════════════════════════════════════════════════════════════════
// portfolio.js — Dashboard Portefeuille (v6.86) : tous les sites analysés
// côte à côte, triables, avec export. Le "wow" de la revue d'ensemble :
// d'un coup d'œil, quel site prime, où est le cash, quel verdict.
//
// + Export Excel/CSV du BP d'un site (P&L A1-A5 + financement + KPIs)
//   pour retravailler dans Excel. Format .xls (HTML table) ouvrable
//   nativement par Excel — zéro dépendance.
//
// Source : window._siteAnalyses (persistées par saveSiteAnalysis).
// ═════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const F = (typeof fmt === 'function') ? fmt : (x => String(x));
  const kE = v => v == null ? '—' : F(Math.round(v / 1000)) + ' k€';
  let sortKey = 'execScore', sortDir = -1;

  const COLS = [
    { k: 'name', label: 'SITE', align: 'left', fmt: v => String(v).replace(/</g, '&lt;'), w: '150px' },
    { k: 'verdict', label: 'VERDICT', align: 'left', fmt: (v, r) => `<span style="color:${r.verdictColor};font-weight:800">${String(v).replace(/</g, '&lt;')}</span>` },
    { k: 'execScore', label: 'SCORE', align: 'right', fmt: v => `<b>${v}</b>/100` },
    { k: 'totalTheo', label: 'MEMBRES', align: 'right', fmt: v => F(v) },
    { k: 'irrBase', label: 'IRR PROJET', align: 'right', fmt: v => v != null ? v.toFixed(0) + '%' : '—' },
    { k: 'irrEquity', label: 'IRR EQUITY', align: 'right', fmt: v => v != null ? `<b style="color:${v > 30 ? 'var(--green)' : v > 15 ? 'var(--yellow)' : 'var(--red)'}">${v.toFixed(0)}%</b>` : '—' },
    { k: 'fcfe5y', label: 'FCFE 5A', align: 'right', fmt: v => kE(v) },
    { k: 'moic', label: 'MOIC', align: 'right', fmt: v => v != null ? v.toFixed(1) + '×' : '—' },
    { k: 'npvBase', label: 'NPV', align: 'right', fmt: v => kE(v) },
    { k: 'paybackEquity', label: 'PAYBACK EQ.', align: 'right', fmt: v => v ? 'M' + v : '—' },
    { k: 'dscrMin', label: 'DSCR', align: 'right', fmt: v => v != null ? v.toFixed(2) + '×' : '—' },
  ];

  function rows() {
    const list = (window._siteAnalyses || []).slice();
    list.sort((a, b) => {
      const va = a[sortKey] ?? -Infinity, vb = b[sortKey] ?? -Infinity;
      if (typeof va === 'string') return sortDir * String(va).localeCompare(String(vb));
      return sortDir * ((va > vb ? 1 : va < vb ? -1 : 0));
    });
    return list;
  }

  function open() {
    const list = window._siteAnalyses || [];
    if (!list.length) { alert('Analyse au moins un site — le portefeuille agrège tous les sites analysés.'); return; }
    const old = document.getElementById('fpPortfolio');
    if (old) old.remove();
    const wrap = document.createElement('div');
    wrap.id = 'fpPortfolio';
    wrap.style.cssText = 'position:fixed;inset:0;z-index:10001;background:rgba(6,8,15,.97);backdrop-filter:blur(10px);display:flex;flex-direction:column;overflow:hidden';
    document.body.appendChild(wrap);
    document.addEventListener('keydown', esc);
    render();
  }
  function esc(e) { if (e.key === 'Escape') close(); }
  function close() { document.getElementById('fpPortfolio')?.remove(); document.removeEventListener('keydown', esc); }

  function render() {
    const wrap = document.getElementById('fpPortfolio');
    if (!wrap) return;
    const list = rows();
    // agrégats portefeuille
    const sum = (k) => list.reduce((a, r) => a + (r[k] || 0), 0);
    const avg = (k) => list.length ? Math.round(list.reduce((a, r) => a + (r[k] || 0), 0) / list.length) : 0;
    const go = list.filter(r => /GO/.test(r.verdict || '')).length;

    wrap.innerHTML = `
      <header style="padding:12px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
        <div>
          <div style="font-size:16px;font-weight:900;color:var(--white)">📊 Dashboard Portefeuille — ${list.length} site${list.length > 1 ? 's' : ''}</div>
          <div style="font-size:9px;color:var(--gray2);margin-top:2px">Tous les sites analysés côte à côte · clique un en-tête pour trier · exports en bas</div>
        </div>
        <button onclick="Portfolio.close()" style="background:transparent;border:1px solid var(--border);border-radius:6px;color:var(--gray);width:34px;height:34px;cursor:pointer;font-size:15px;font-weight:700">✕</button>
      </header>
      <div style="flex:1;overflow:auto;padding:14px 20px">
        <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:14px">
          ${[
            [`${go}/${list.length}`, 'SITES GO', 'verdict favorable'],
            [F(sum('totalTheo')), 'MEMBRES CUMULÉS', 'à maturité, tous sites'],
            [kE(sum('fcfe5y')), 'FCFE 5 ANS CUMULÉ', 'cash equity du portefeuille'],
            [kE(sum('equity')), 'EQUITY TOTALE', 'apport à déployer'],
            [avg('execScore') + '/100', 'SCORE MOYEN', 'qualité moyenne'],
          ].map(([v, l, h]) => `
            <div style="background:var(--bg2);border:1px solid var(--border);border-radius:9px;padding:10px 12px">
              <div style="font-size:17px;font-weight:900;color:var(--accent);white-space:nowrap">${v}</div>
              <div style="font-size:7.5px;font-weight:700;color:var(--gray);letter-spacing:.5px;margin-top:2px">${l}</div>
              <div style="font-size:7px;color:var(--gray2)">${h}</div>
            </div>`).join('')}
        </div>
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;overflow:hidden">
          <table style="width:100%;border-collapse:collapse;font-size:10px">
            <thead><tr style="border-bottom:1px solid var(--border)">
              ${COLS.map(c => `<th onclick="Portfolio.sort('${c.k}')" style="text-align:${c.align};padding:8px 8px;font-size:8px;color:${sortKey === c.k ? 'var(--accent)' : 'var(--gray2)'};letter-spacing:.5px;cursor:pointer;white-space:nowrap;${c.w ? 'min-width:' + c.w : ''}">${c.label}${sortKey === c.k ? (sortDir < 0 ? ' ▾' : ' ▴') : ''}</th>`).join('')}
              <th style="padding:8px;font-size:8px;color:var(--gray2)">BP</th>
            </tr></thead>
            <tbody>
              ${list.map(r => `
                <tr style="border-bottom:1px solid rgba(71,85,115,.12)">
                  ${COLS.map(c => `<td style="text-align:${c.align};padding:6px 8px;color:var(--white)">${c.fmt(r[c.k], r)}</td>`).join('')}
                  <td style="text-align:center;padding:6px 8px"><button onclick="Portfolio.exportBP('${r.name.replace(/'/g, '&#39;')}')" title="Exporter le BP de ce site vers Excel" style="background:transparent;border:1px solid var(--green);border-radius:5px;color:var(--green);padding:2px 7px;cursor:pointer;font-size:9px">⬇ xls</button></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button onclick="Portfolio.exportPortfolioCSV()" style="padding:9px 16px;background:linear-gradient(135deg,rgba(16,185,129,.2),rgba(16,185,129,.1));border:1px solid var(--green);border-radius:8px;color:var(--green);font-weight:800;font-size:11px;cursor:pointer;font-family:var(--font)">⬇ Exporter le portefeuille (CSV)</button>
          <div style="flex:1"></div>
          <div style="font-size:8px;color:var(--gray2);align-self:center;line-height:1.5;max-width:50%">Les valeurs reflètent le scénario base avec tes réglages actuels par site. Ré-analyse un site pour le rafraîchir.</div>
        </div>
      </div>`;
  }

  function _sort(k) { if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = -1; } render(); }

  // ─── Export portefeuille CSV ──────────────────────────────────────
  function exportPortfolioCSV() {
    const list = rows();
    const cols = ['name', 'verdict', 'execScore', 'totalTheo', 'irrBase', 'irrEquity', 'fcfe5y', 'moic', 'npvBase', 'paybackEquity', 'dscrMin', 'ebitdaA5', 'equity', 'capex', 'sazTotal'];
    const head = ['Site', 'Verdict', 'Score', 'Membres', 'IRR Projet %', 'IRR Equity %', 'FCFE 5a €', 'MOIC', 'NPV €', 'Payback equity (mois)', 'DSCR', 'EBITDA A5 €', 'Equity €', 'CAPEX €', 'SAZ'];
    const lines = [head.join(';')];
    list.forEach(r => lines.push(cols.map(c => { const v = r[c]; return v == null ? '' : (typeof v === 'number' ? v : '"' + String(v).replace(/"/g, '""') + '"'); }).join(';')));
    downloadFile('portefeuille-fp-' + stamp() + '.csv', '﻿' + lines.join('\n'), 'text/csv');
    try { window.AuditLog?.log({ action: 'portfolio.export', target: list.length + ' sites' }); } catch {}
  }

  // ─── Export BP d'un site → .xls (HTML table, ouvrable Excel) ──────
  function exportBP(name) {
    const s = (window._siteAnalyses || []).find(x => x.name === name);
    if (!s) { alert('Site introuvable — ré-analyse-le.'); return; }
    // On reconstruit le P&L complet A1-A5 depuis le moteur si le site est
    // celui ouvert ; sinon on exporte les KPIs sauvegardés.
    const isOpen = window._lastCaptageData?.r && window._lastCaptageLocation?.siteName === name;
    const pnl = isOpen ? window._lastCaptageData.r.pnl.base : null;
    const cell = (v) => `<td>${v == null ? '' : v}</td>`;
    const eur = (v) => v == null ? '' : Math.round(v);
    let pnlRows = '';
    if (pnl) {
      const yrs = [0, 1, 2, 3, 4];
      const line = (label, arr, f) => `<tr><td><b>${label}</b></td>${arr.map(v => cell(f ? f(v) : v)).join('')}</tr>`;
      pnlRows = `
        <tr style="background:#d4a017;color:#000"><td><b>P&L (scénario base)</b></td>${yrs.map(y => `<td><b>A${y + 1}</b></td>`).join('')}</tr>
        ${line('CA (€)', pnl.annualCA.map(eur))}
        ${line('EBITDA (€)', pnl.annualEBITDA.map(eur))}
        ${line('FCFE (€)', (pnl.annualFCFE || []).map(eur))}
        ${line('Marge EBITDA %', pnl.annualEBITDA.map((e, i) => pnl.annualCA[i] ? Math.round(e / pnl.annualCA[i] * 100) : 0))}`;
    }
    const kv = (k, v) => `<tr>${cell(k)}${cell(v)}</tr>`;
    const html = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><style>td{border:1px solid #ccc;padding:4px 8px;font-family:Calibri,Arial}</style></head><body>
      <table>
        <tr style="background:#0a0f1c;color:#fbbf24"><td colspan="6"><b>BP — ${String(name).replace(/</g, '&lt;')} · Expansion Intelligence · ${stamp()}</b></td></tr>
        ${kv('Verdict', s.verdict)}${kv('Score /100', s.execScore)}${kv('Membres à maturité', s.totalTheo)}
        ${kv('IRR Projet %', s.irrBase)}${kv('IRR Equity %', s.irrEquity)}${kv('FCFE 5 ans €', eur(s.fcfe5y))}
        ${kv('MOIC', s.moic)}${kv('NPV €', eur(s.npvBase))}${kv('DSCR min', s.dscrMin)}
        ${kv('Payback equity (mois)', s.paybackEquity)}${kv('CAPEX €', eur(s.capex))}${kv('Equity €', eur(s.equity))}
        ${kv('EBITDA A5 €', eur(s.ebitdaA5))}${kv('SAZ /100', s.sazTotal)}
        <tr><td colspan="6"></td></tr>
        ${pnlRows || '<tr><td colspan="6"><i>Ouvre ce site (Analyser) puis ré-exporte pour le détail P&L A1-A5.</i></td></tr>'}
        <tr><td colspan="6"></td></tr>
        <tr><td colspan="6" style="font-size:9px;color:#666">Modèle calibré OnAir Montreuil + BP Avril 2026 · FCFE avant IS · généré par Expansion Intelligence (${(typeof MODEL_VERSION !== 'undefined' ? MODEL_VERSION : '')}).</td></tr>
      </table></body></html>`;
    downloadFile('BP-' + name.replace(/[^a-z0-9]+/gi, '-') + '-' + stamp() + '.xls', html, 'application/vnd.ms-excel');
    try { window.AuditLog?.log({ action: 'bp.export', target: name }); } catch {}
  }

  function stamp() { return new Date().toISOString().slice(0, 10); }
  function downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime + ';charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  window.Portfolio = { open, close, sort: _sort, exportPortfolioCSV, exportBP };
})();
