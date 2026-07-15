// ═════════════════════════════════════════════════════════════════════
// MÉMO D'IC (v6.72 — P3 refonte) — export narratif "investment committee"
// du site analysé : une page A4 imprimable, structurée comme un vrai mémo
// d'investissement (En bref → Site → Demande → Concurrence → Plan
// financier → Risques → Recommandation), typographie print soignée.
//
// Données : window._lastCaptageData {r}, window._lastExecData {exec},
// window._lastCaptageLocation. Zéro calcul nouveau — pure mise en récit.
// ═════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const F = (typeof fmt === 'function') ? fmt : (x => String(x));
  const kE = v => F(Math.round((v || 0) / 1000)) + ' k€';
  const esc = s => String(s == null ? '' : s).replace(/</g, '&lt;');

  // Mitigants génériques mappés sur les motifs de risques du moteur
  const MITIGANTS = [
    { rx: /concurrent|densité|menace/i, m: 'Différenciation prix (÷2 vs premium) + plan d’acquisition pré-ouverture (founding members).' },
    { rx: /captifs|dépendance/i, m: 'Diversifier l’acquisition vers les natifs (offres découverte, entreprises locales).' },
    { rx: /loyer|bail/i, m: 'Négocier paliers + franchise de loyer ; clause de sortie an 3 (objectif négo déjà modélisé).' },
    { rx: /flux|piéton|accessibilit/i, m: 'Signalétique renforcée + partenariat mall (co-marketing entrées).' },
    { rx: /pénétration|marché|natifs/i, m: 'Budget éducation marché A1 + pricing d’appel 3 premiers mois.' },
    { rx: /IRR|NPV|rentabilit|payback/i, m: 'Optimiser CAPEX (phasage travaux) et renégocier le loyer — voir Studio FCF.' },
    { rx: /walk[- ]?in/i, m: 'Emplacement vitrine dans le mall + animations récurrentes.' },
  ];
  const mitigantFor = risk => (MITIGANTS.find(x => x.rx.test(risk)) || { m: 'Suivi mensuel post-ouverture + plan d’action correctif.' }).m;

  function open() {
    const d = window._lastCaptageData;
    const exec = window._lastExecData?.exec;
    const loc = window._lastCaptageLocation;
    if (!d?.r?.pnl?.base || !exec) { alert('Analyse d’abord un site — le mémo se génère depuis la fiche ouverte.'); return; }
    const r = d.r;
    const pb = r.pnl.base;
    const siteName = loc?.siteName || 'Site';
    const target = (typeof TARGETS !== 'undefined') ? TARGETS.find(t => t.name === siteName) : null;
    const surface = window._surfaceOverride?.surface ?? PNL_DEFAULTS.rentSteps.surface;
    const rentY1 = window._rentOverride?.y1 ?? PNL_DEFAULTS.rentSteps.objectifNego[0].rent;
    const chg = window._chargeOverride?.chargeTotal ?? (PNL_DEFAULTS.rentSteps.serviceCharge + PNL_DEFAULTS.rentSteps.marketingFee);
    const fin = pb.financing || PNL_DEFAULTS.financing;
    const ebA5 = pb.annualEBITDA?.[4] || 0;
    const margeA5 = pb.annualCA?.[4] > 0 ? Math.round(ebA5 / pb.annualCA[4] * 100) : 0;
    const topComps = [...(r.comps || [])]
      .map(c => ({ ...c, _d: (typeof haversine === 'function' && loc) ? haversine(loc.lat, loc.lng, c.lat, c.lng) : 0 }))
      .sort((a, b) => (b.captured || 0) - (a.captured || 0)).slice(0, 3);
    const sources = [
      { n: 'Captifs (clubs concurrents)', v: r.totalCaptifs || 0 },
      { n: 'Natifs (création de marché)', v: r.native?.captured || 0 },
      { n: 'Walk-in (flux du site)', v: r.walkIn?.walkInMembers || 0 },
      { n: 'Bonus destination', v: r.destinationBonus?.bonusMembers || 0 },
    ].filter(s => s.v > 0);
    const totSrc = sources.reduce((a, s) => a + s.v, 0) || 1;
    const conditions = (exec.risks || []).slice(0, 3).map(risk => 'Mitiger : ' + risk.split('—')[0].split('(')[0].trim());
    const dscrTip = pb.dscrByYear ? pb.dscrByYear.map((v, i) => 'A' + (i + 1) + ' ' + (v != null ? v.toFixed(2) + '×' : '—')).join(' · ') : '';
    const isGo = /GO/.test(exec.verdict);
    const vColor = isGo ? '#0f7b4d' : /WATCH/.test(exec.verdict) ? '#a16207' : '#b91c1c';
    const modelVersion = (typeof MODEL_VERSION !== 'undefined') ? MODEL_VERSION : '';
    const today = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

    const w = window.open('', '_blank');
    if (!w) { alert('Autorise les popups pour générer le mémo.'); return; }
    w.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
<title>Mémo IC — ${esc(siteName)}</title>
<style>
  @page { size: A4; margin: 16mm 15mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #1a202c; font-size: 10.5pt; line-height: 1.5; background: #fff; }
  .head { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 3px solid #d4a017; padding-bottom: 8px; margin-bottom: 4px; }
  .head .brand { font-family: Helvetica, Arial, sans-serif; font-weight: 900; font-size: 13pt; letter-spacing: .5px; }
  .head .brand span { color: #b8860b; }
  .head .meta { font-family: Helvetica, Arial, sans-serif; font-size: 7.5pt; color: #6b7280; text-align: right; }
  .conf { font-family: Helvetica, Arial, sans-serif; font-size: 7pt; color: #b91c1c; letter-spacing: 2px; text-align: right; margin-bottom: 14px; }
  h1 { font-size: 17pt; margin: 2px 0 2px; }
  .sub { font-size: 9.5pt; color: #6b7280; font-style: italic; margin-bottom: 12px; }
  h2 { font-family: Helvetica, Arial, sans-serif; font-size: 9pt; letter-spacing: 1.5px; color: #b8860b; border-bottom: 1px solid #e5e7eb; padding-bottom: 3px; margin: 16px 0 7px; text-transform: uppercase; }
  .verdict { display: inline-block; font-family: Helvetica, Arial, sans-serif; font-weight: 900; font-size: 12pt; color: #fff; background: ${vColor}; padding: 4px 14px; border-radius: 4px; letter-spacing: 1px; }
  .score { font-family: Helvetica, Arial, sans-serif; font-size: 9pt; color: #6b7280; margin-left: 8px; }
  table { width: 100%; border-collapse: collapse; font-family: Helvetica, Arial, sans-serif; font-size: 8.5pt; margin: 6px 0; }
  th { text-align: left; font-size: 7pt; letter-spacing: .8px; color: #6b7280; border-bottom: 1.5px solid #d1d5db; padding: 3px 6px; text-transform: uppercase; }
  td { padding: 4px 6px; border-bottom: 1px solid #f3f4f6; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 8px 0; }
  .kpi { border: 1px solid #e5e7eb; border-radius: 6px; padding: 7px 9px; }
  .kpi b { display: block; font-family: Helvetica, Arial, sans-serif; font-size: 13pt; color: #111; }
  .kpi span { font-family: Helvetica, Arial, sans-serif; font-size: 6.5pt; letter-spacing: .5px; color: #6b7280; text-transform: uppercase; }
  .kpi i { display: block; font-size: 7.5pt; color: #9ca3af; font-style: normal; margin-top: 2px; }
  .bar { height: 8px; background: #f3f4f6; border-radius: 4px; overflow: hidden; margin: 2px 0 6px; }
  .bar div { height: 100%; background: #d4a017; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  ul { padding-left: 16px; } li { margin-bottom: 3px; font-size: 9.5pt; }
  .risk { color: #b91c1c; } .mit { color: #374151; font-size: 8.5pt; font-style: italic; }
  .reco { border: 2px solid ${vColor}; border-radius: 8px; padding: 10px 14px; margin-top: 8px; background: ${vColor}0d; }
  .foot { margin-top: 18px; padding-top: 8px; border-top: 1px solid #e5e7eb; font-family: Helvetica, Arial, sans-serif; font-size: 6.5pt; color: #9ca3af; line-height: 1.6; }
  @media print { .noprint { display: none; } }
  .noprint { position: fixed; top: 12px; right: 12px; font-family: Helvetica, sans-serif; }
  .noprint button { padding: 8px 18px; background: #d4a017; color: #000; border: none; border-radius: 6px; font-weight: 700; cursor: pointer; font-size: 10pt; }
</style></head><body>
<div class="noprint"><button onclick="window.print()">🖨 Imprimer / PDF</button></div>

<div class="head">
  <div class="brand">FITNESS PARK <span>ROMANIA</span></div>
  <div class="meta">Mémo d’investissement · ${today}<br>Modèle ${esc(modelVersion)} · Isseo Expansion Intelligence</div>
</div>
<div class="conf">CONFIDENTIEL — COMITÉ D’INVESTISSEMENT</div>

<h1>${esc(siteName)}</h1>
<div class="sub">${target ? esc('Secteur ' + target.sector + ' · ' + target.area + ' · ' + target.status + ' — ouverture cible ' + target.opening) : esc('Bucarest · rayon d’analyse ' + (r.captageRadius / 1000) + ' km')}</div>

<div><span class="verdict">${esc(exec.verdict)}</span><span class="score">Score ${exec.total}/100 — ${esc(exec.verdictDesc)}</span></div>

<h2>1 · En bref</h2>
<p>Le site peut atteindre <b>${F(r.realiste)} membres</b> à maturité (scénario base ; fourchette ${F(r.pessimiste)}–${F(r.optimiste)}),
générant <b>${kE(ebA5)} d’EBITDA en année 5 (${margeA5}% de marge)</b>. Avec ${Math.round((fin.equityRatio || .3) * 100)}% d’apport
(${kE(pb.equity)}) et ${Math.round((fin.loanRatio || 0) * 100)}% de dette à ${((fin.loanRate || 0) * 100).toFixed(1)}%,
l’apport est ${pb.paybackEquityMonth ? 'récupéré en <b>' + Math.ceil(pb.paybackEquityMonth / 12 * 10) / 10 + ' ans</b>' : 'non récupéré sur l’horizon'}
pour un TRI actionnaire de <b>${(pb.irrEquity || 0).toFixed(1)}% par an</b> (sortie à ${typeof getEffectiveExitMultiple === 'function' ? getEffectiveExitMultiple() : 8}× l’EBITDA A5 incluse).</p>
<div class="kpis">
  <div class="kpi"><span>Membres à maturité</span><b>${F(r.realiste)}</b><i>cible BP : ${F(PNL_DEFAULTS.targetMembers)}</i></div>
  <div class="kpi"><span>TRI Equity</span><b>${(pb.irrEquity || 0).toFixed(1)}%</b><i>TRI projet : ${(pb.irr || 0).toFixed(1)}%</i></div>
  <div class="kpi"><span>FCFE cumulé 5 ans</span><b>${kE(pb.fcfe5y)}</b><i>apport : ${kE(pb.equity)}</i></div>
  <div class="kpi"><span>DSCR min (A2+)</span><b>${pb.dscrMinCruise != null ? pb.dscrMinCruise.toFixed(2) + '×' : 'n/a'}</b><i>exigence bancaire : ≥ 1.2×</i></div>
</div>

<div class="two">
<div>
<h2>2 · Le site</h2>
<table>
  <tr><td>Surface</td><td class="num"><b>${F(surface)} m²</b></td></tr>
  <tr><td>Loyer Y1 (objectif négo)</td><td class="num"><b>${rentY1.toFixed(1)} €/m²</b> + ${chg.toFixed(1)} charges</td></tr>
  <tr><td>CAPEX (scale surface)</td><td class="num"><b>${kE(pb.capex)}</b></td></tr>
  <tr><td>Leasing équipement</td><td class="num">${kE((pb.leasingMonthly || 0) * 12)}/an · 5 ans</td></tr>
  ${target ? `<tr><td>Statut foncier</td><td class="num">${esc(target.status)}</td></tr>` : ''}
</table>

<h2>3 · La demande</h2>
<table>
  <tr><td>Population cible (15-45) du bassin</td><td class="num"><b>${F(r.popTarget)}</b></td></tr>
  <tr><td>Score d’attractivité (SAZ)</td><td class="num"><b>${r.saz?.total ?? '—'}/100</b> (flux ${r.saz?.flux ?? '—'} · densité ${r.saz?.densite ?? '—'} · jeunesse ${r.saz?.jeunesse ?? '—'})</td></tr>
</table>
${sources.map(s => `<div style="font-family:Helvetica,sans-serif;font-size:8pt;display:flex;justify-content:space-between"><span>${esc(s.n)}</span><b>${F(s.v)}</b></div><div class="bar"><div style="width:${Math.round(s.v / totSrc * 100)}%"></div></div>`).join('')}
</div>
<div>
<h2>4 · La concurrence</h2>
<p style="font-size:9pt">${(r.comps || []).length} club(s) dans le rayon de ${(r.captageRadius / 1000)} km.
${topComps.length ? 'Principaux viviers de captation :' : 'Zone blanche — création de marché pure.'}</p>
${topComps.length ? `<table><tr><th>Club</th><th class="num">Membres est.</th><th class="num">Captables</th></tr>
  ${topComps.map(c => `<tr><td>${esc(c.name)}</td><td class="num">${F(c.membersEst || c.members || 0)}</td><td class="num"><b>${F(c.captured || 0)}</b></td></tr>`).join('')}</table>` : ''}

<h2>5 · Plan financier (scénario base)</h2>
<table>
  <tr><th></th><th class="num">A1</th><th class="num">A2</th><th class="num">A3</th><th class="num">A4</th><th class="num">A5</th></tr>
  <tr><td>CA (k€)</td>${(pb.annualCA || []).map(v => `<td class="num">${F(Math.round(v / 1000))}</td>`).join('')}</tr>
  <tr><td>EBITDA (k€)</td>${(pb.annualEBITDA || []).map(v => `<td class="num"${v < 0 ? ' style="color:#b91c1c"' : ''}>${F(Math.round(v / 1000))}</td>`).join('')}</tr>
  <tr><td>FCFE (k€)</td>${(pb.annualFCFE || []).map(v => `<td class="num"${v < 0 ? ' style="color:#b91c1c"' : ''}>${F(Math.round(v / 1000))}</td>`).join('')}</tr>
</table>
<p style="font-size:8pt;color:#6b7280">DSCR : ${dscrTip} · Breakeven M${pb.breakevenMonth ?? '—'} · NPV@12% ${kE(pb.npv)} · MOIC ${pb.moic != null ? pb.moic.toFixed(1) + '×' : 'n/a'} · Valeur de sortie ${kE(pb.terminalValue)}</p>
${(() => { try {
  const be = (typeof window.computeBreakEvenMembers === 'function') ? window.computeBreakEvenMembers('fcfe', 4) : null;
  if (be == null) return '';
  const cushion = Math.round((r.realiste / be - 1) * 100);
  return `<p style="font-size:9pt;margin-top:4px"><b>Point mort : ${F(be)} adhérents</b> (FCFE neutre en croisière, dette incluse) — le site en vise ${F(r.realiste)}, soit un coussin de sécurité de <b>${cushion >= 0 ? '+' : ''}${cushion}%</b>.</p>`;
} catch { return ''; } })()}
</div>
</div>

<h2>6 · Risques &amp; mitigants</h2>
<ul>
${(exec.risks || []).slice(0, 4).map(risk => `<li><span class="risk">${esc(risk)}</span><br><span class="mit">→ ${esc(mitigantFor(risk))}</span></li>`).join('') || '<li>Aucun risque majeur identifié par le moteur.</li>'}
</ul>
${(exec.opportunities || []).length ? `<p style="font-size:8.5pt;color:#0f7b4d">★ ${(exec.opportunities || []).slice(0, 3).map(esc).join(' · ')}</p>` : ''}

<h2>7 · Recommandation</h2>
<div class="reco">
  <b style="color:${vColor};font-family:Helvetica,sans-serif">${esc(exec.verdict)}</b> —
  ${isGo ? 'engager les négociations foncières' + (conditions.length ? ' sous conditions :' : '.') : /WATCH/.test(exec.verdict) ? 'surveiller — ne pas engager sans évolution des conditions ci-dessous :' : 'ne pas poursuivre en l’état.'}
  ${conditions.length ? `<ul style="margin-top:4px">${conditions.map(c => `<li style="font-size:9pt">${esc(c)}</li>`).join('')}</ul>` : ''}
</div>

<div class="foot">
  Sources : modèle P&amp;L calibré OnAir Montreuil (comptes audités Fiteco) harmonisé BP Avril 2026 · INS Recensământ 2021 ·
  comptes concurrents déposés Ministerul Finanțelor (recoupés presse) · relevés terrain Isseo · Google Places.
  FCFE avant IS. Généré le ${today} par Expansion Intelligence Platform (${esc(modelVersion)}) — document de travail interne, ne constitue pas un conseil en investissement.
</div>
</body></html>`);
    w.document.close();
    try { window.AuditLog?.log({ action: 'memo.export', target: siteName, siteKey: loc ? loc.lat.toFixed(3) + ',' + loc.lng.toFixed(3) : '' }); } catch {}
  }

  window.ICMemo = { open };
})();
