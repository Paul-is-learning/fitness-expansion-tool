// ─────────────────────────────────────────────────────────────────────
// src/competitor-intel.js — 🎯 Intel Concurrence (v6.88)
//
// Hub de renseignement concurrentiel, 3 sources 100 % publiques & légales :
//   1. MARCHÉ   — bilans officiels ANAF (data/competitors-financials.json,
//                 généré par ci/etl-financials.mjs) : CA, résultat net,
//                 fonds propres, santé financière, radar du secteur.
//   2. PRIX     — grilles publiques des chaînes (via /api/intel) : ARPU
//                 implicite, ladder par plan, benchmark.
//   3. OUVERTURES — clubs concurrents en pré-ouverture (early warning),
//                 géocodés → posés sur la carte.
//
// Expose : window.CompetitorIntel = { open, close, tab, refresh, focus }
// ─────────────────────────────────────────────────────────────────────
(function () {
  'use strict';

  let _fin = null;      // financials JSON (chargé 1×)
  let _intel = null;    // { prices, openings, refreshedAt, stale }
  let _tab = 'marche';
  let _openMarkers = [];

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtM = v => v == null ? '—' : (Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1).replace('.', ',') + ' M' : Math.round(v / 1e3) + ' k');
  const eur = ron => Math.round(ron / 4.98); // RON→EUR indicatif (cours ~4,98)
  const HEALTH = {
    ok:   { color: '#34d399', bg: 'rgba(52,211,153,.12)', dot: '🟢' },
    warn: { color: '#fbbf24', bg: 'rgba(251,191,36,.12)', dot: '🟡' },
    risk: { color: '#f87171', bg: 'rgba(248,113,113,.12)', dot: '🔴' },
  };
  const agoDays = ts => ts ? Math.floor((Date.now() - ts) / 864e5) : null;

  async function loadFinancials() {
    if (_fin) return _fin;
    try {
      const r = await fetch('data/competitors-financials.json', { cache: 'no-cache' });
      _fin = await r.json();
    } catch { _fin = { error: true }; }
    return _fin;
  }
  async function loadIntel(force) {
    try {
      const url = '/api/intel?action=' + (force ? 'refresh' : 'data');
      const r = await fetch(url, { credentials: 'include', cache: 'no-store' });
      if (r.ok) _intel = await r.json();
      else if (r.status === 403 && force) return { forbidden: true };
    } catch {}
    return _intel;
  }

  // ─── Ouverture du panneau ──────────────────────────────────────────
  async function open(tab) {
    _tab = tab || 'marche';
    if (document.getElementById('ciPanel')) close();
    const wrap = document.createElement('div');
    wrap.id = 'ciPanel';
    wrap.style.cssText = 'position:fixed;inset:0;z-index:10001;background:rgba(6,8,15,.97);backdrop-filter:blur(10px);display:flex;flex-direction:column;overflow:hidden';
    wrap.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 22px;border-bottom:1px solid rgba(71,85,115,.35);flex-shrink:0">
        <div>
          <div style="font-size:16px;font-weight:800;color:#fff">🎯 Intel Concurrence</div>
          <div style="font-size:10px;color:#94a3b8;margin-top:2px">Sources 100 % publiques & légales — bilans officiels, prix catalogue, pré-ouvertures.</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <button id="ciRefresh" class="btn btn-sm" title="Rafraîchir prix + ouvertures (récupère les pages concurrentes en direct)" style="font-size:11px">↻ Rafraîchir</button>
          <button class="btn btn-sm" onclick="CompetitorIntel.close()" style="font-size:15px;padding:4px 10px">&times;</button>
        </div>
      </div>
      <div style="display:flex;gap:4px;padding:10px 22px 0;flex-shrink:0">
        ${[['marche', '📊 Marché & santé'], ['prix', '💶 Prix & ARPU'], ['ouvertures', '🚧 Ouvertures']].map(([k, l]) =>
          `<button data-citab="${k}" onclick="CompetitorIntel.tab('${k}')" style="padding:8px 14px;border:none;border-bottom:2px solid transparent;background:transparent;color:#94a3b8;font-size:12px;font-weight:700;font-family:var(--font);cursor:pointer">${l}</button>`).join('')}
      </div>
      <div id="ciBody" style="flex:1;overflow-y:auto;padding:18px 22px 40px"></div>`;
    document.body.appendChild(wrap);
    document.getElementById('ciRefresh').onclick = refresh;
    _renderTabBar();
    document.getElementById('ciBody').innerHTML = '<div style="color:#94a3b8;font-size:13px;padding:40px;text-align:center">Chargement…</div>';
    await Promise.all([loadFinancials(), loadIntel(false)]);
    _render();
  }
  function close() { document.getElementById('ciPanel')?.remove(); _clearMarkers(); }

  function tab(k) { _tab = k; _renderTabBar(); _render(); }
  function _renderTabBar() {
    document.querySelectorAll('#ciPanel [data-citab]').forEach(b => {
      const on = b.getAttribute('data-citab') === _tab;
      b.style.color = on ? '#fff' : '#94a3b8';
      b.style.borderBottomColor = on ? 'var(--accent)' : 'transparent';
    });
  }

  async function refresh() {
    const btn = document.getElementById('ciRefresh');
    if (btn) { btn.disabled = true; btn.textContent = '↻ …'; }
    const r = await loadIntel(true);
    if (btn) { btn.disabled = false; btn.textContent = '↻ Rafraîchir'; }
    if (r && r.forbidden) { alert('Rafraîchissement réservé aux comptes éditeur/admin connectés au serveur.'); return; }
    _render();
  }

  function _render() {
    const b = document.getElementById('ciBody');
    if (!b) return;
    if (_tab === 'marche') b.innerHTML = _renderMarche();
    else if (_tab === 'prix') b.innerHTML = _renderPrix();
    else b.innerHTML = _renderOuvertures();
  }

  // ─── 1. MARCHÉ & SANTÉ ─────────────────────────────────────────────
  function _renderMarche() {
    if (!_fin || _fin.error) return _empty('Bilans indisponibles — data/competitors-financials.json manquant.');
    const m = _fin.meta, chains = _fin.chains || [], ops = _fin.operators || [];
    const buc = ops.filter(o => o.bucharest);
    const card = c => {
      const h = HEALTH[c.health.level] || HEALTH.warn;
      return `<div style="flex:1;min-width:210px;background:var(--card2);border:1px solid ${h.color}44;border-left:3px solid ${h.color};border-radius:12px;padding:14px">
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <div style="font-size:14px;font-weight:800;color:#fff">${esc(c.enseigne)}</div>
          <div style="font-size:10px;font-weight:700;color:${h.color}">${h.dot} ${esc(c.health.label)}</div>
        </div>
        <div style="font-size:10px;color:#64748b;margin-bottom:8px">${esc(c.name)}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11px">
          <div><div style="color:#64748b;font-size:9px">CA ${m.sourceYear}</div><b style="color:#e2e8f0">${fmtM(c.ca)} RON</b></div>
          <div><div style="color:#64748b;font-size:9px">Résultat net</div><b style="color:${c.netResult >= 0 ? '#34d399' : '#f87171'}">${c.netResult >= 0 ? '+' : ''}${fmtM(c.netResult)}</b></div>
          <div><div style="color:#64748b;font-size:9px">Fonds propres</div><b style="color:${c.equity >= 0 ? '#e2e8f0' : '#f87171'}">${fmtM(c.equity)}</b></div>
          <div><div style="color:#64748b;font-size:9px">Marge nette</div><b style="color:#e2e8f0">${c.netMargin == null ? '—' : c.netMargin + '%'}</b></div>
        </div>
        <div style="font-size:9px;color:#94a3b8;margin-top:8px;line-height:1.4">${esc(c.health.why)}.</div>
      </div>`;
    };
    const rows = buc.slice(0, 20).map((o, i) => {
      const h = HEALTH[o.health.level] || HEALTH.warn;
      return `<tr style="border-bottom:1px solid rgba(71,85,115,.2)">
        <td style="padding:6px 8px;color:#64748b">${i + 1}</td>
        <td style="padding:6px 8px;color:#e2e8f0">${esc(o.name)}${o.enseigne ? ` <span style="font-size:9px;color:var(--accent)">${esc(o.enseigne)}</span>` : ''}</td>
        <td style="padding:6px 8px;text-align:right;color:#e2e8f0">${fmtM(o.ca)}</td>
        <td style="padding:6px 8px;text-align:right;color:${o.netResult >= 0 ? '#34d399' : '#f87171'}">${o.netResult >= 0 ? '+' : ''}${fmtM(o.netResult)}</td>
        <td style="padding:6px 8px;text-align:right;color:#94a3b8">${o.employees || '—'}</td>
        <td style="padding:6px 8px;text-align:center">${h.dot}</td>
      </tr>`;
    }).join('');
    return `
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px">${chains.map(card).join('')}</div>
      <div style="background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.25);border-radius:10px;padding:12px 14px;margin-bottom:18px;font-size:11px;color:#cbd5e1;line-height:1.6">
        💡 <b>Lecture</b> : les enseignes consolident tous leurs clubs dans une société unique — le <b>CA par club</b> = CA de l'entité ÷ nombre de clubs. Ces chiffres viennent des <b>bilans officiels déposés à l'ANAF</b> (${esc(m.source)}), exercice <b>${m.sourceYear}</b> — citables face à une banque ou un investisseur.
      </div>
      <div style="font-size:12px;font-weight:700;color:#cbd5e1;margin-bottom:8px">Radar marché — opérateurs à Bucarest (${buc.length} sociétés · secteur RO : ${fmtM(_fin.sector.totalCA)} RON sur ${_fin.sector.operators} opérateurs, top 3 = ${_fin.sector.top3Share}%)</div>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px">
        <thead><tr style="color:#64748b;text-align:left;border-bottom:1px solid rgba(71,85,115,.4)">
          <th style="padding:6px 8px">#</th><th style="padding:6px 8px">Société</th>
          <th style="padding:6px 8px;text-align:right">CA (RON)</th><th style="padding:6px 8px;text-align:right">Net</th>
          <th style="padding:6px 8px;text-align:right">Salariés</th><th style="padding:6px 8px;text-align:center">Santé</th>
        </tr></thead><tbody>${rows}</tbody></table></div>
      <div style="font-size:9px;color:#64748b;margin-top:10px">Source : <a href="${esc(m.datasetUrl)}" target="_blank" rel="noopener" style="color:var(--blue)">${esc(m.datasetUrl)}</a> · généré le ${esc(m.generatedAt)} · re-jouable via <code>ci/etl-financials.mjs</code></div>`;
  }

  // ─── 2. PRIX & ARPU ────────────────────────────────────────────────
  function _renderPrix() {
    const p = _intel && _intel.prices;
    if (!p || !p.brands || !p.brands.length) return _empty('Prix non chargés — clique « ↻ Rafraîchir » (compte éditeur/admin requis).', true);
    const fresh = ago(p.fetchedAt);
    const cards = p.brands.map(b => {
      const isEur = b.currency === 'EUR';
      const entry = isEur ? b.entryMonthlyEUR : b.entryMonthlyRON;
      const top = isEur ? b.topMonthlyEUR : b.topMonthlyRON;
      const entryEur = entry == null ? null : (isEur ? entry : eur(entry));
      const topEur = top == null ? null : (isEur ? top : eur(top));
      const ladder = (b.plans || []).slice(0, 6).map(pl =>
        `<div style="display:flex;justify-content:space-between;font-size:10px;padding:2px 0;border-bottom:1px dotted rgba(71,85,115,.2)">
           <span style="color:#94a3b8">${esc(pl.name)}</span>
           <b style="color:#e2e8f0">${pl.monthlyRON} RON/mois</b>
         </div>`).join('');
      return `<div style="flex:1;min-width:230px;background:var(--card2);border:1px solid rgba(71,85,115,.35);border-radius:12px;padding:14px">
        <div style="font-size:14px;font-weight:800;color:#fff;margin-bottom:8px">${esc(b.brand)}</div>
        <div style="display:flex;gap:14px;margin-bottom:10px">
          <div><div style="color:#64748b;font-size:9px">ENTRÉE</div><b style="color:#34d399;font-size:15px">${entry == null ? '—' : entry + (isEur ? '€' : ' RON')}</b><div style="font-size:9px;color:#64748b">${entryEur ? '≈ ' + entryEur + '€/mois' : ''}</div></div>
          <div><div style="color:#64748b;font-size:9px">PREMIUM</div><b style="color:#e2e8f0;font-size:15px">${top == null ? '—' : top + (isEur ? '€' : ' RON')}</b><div style="font-size:9px;color:#64748b">${topEur ? '≈ ' + topEur + '€/mois' : ''}</div></div>
        </div>
        ${ladder ? `<div style="margin-top:6px">${ladder}</div>` : `<div style="font-size:10px;color:#64748b">${esc(b.note || 'Fourchette catalogue.')}</div>`}
      </div>`;
    }).join('');
    const errs = (p.errors || []).length ? `<div style="font-size:10px;color:#f87171;margin-top:10px">⚠️ Non récupéré : ${p.errors.map(e => esc(e.brand)).join(', ')} (structure du site modifiée ?)</div>` : '';
    return `
      <div style="font-size:11px;color:#94a3b8;margin-bottom:14px">Grilles catalogue publiques (page d'abonnements officielle de chaque chaîne). ${fresh}</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap">${cards}</div>${errs}
      <div style="background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.25);border-radius:10px;padding:12px 14px;margin-top:16px;font-size:11px;color:#cbd5e1;line-height:1.6">
        💡 Le <b>prix d'entrée</b> = le plan le moins cher affiché ; c'est le ticket d'attaque du concurrent. Croisé avec le CA/club (onglet Marché), il donne l'<b>ARPU réel</b> par enseigne — utile pour caler l'hypothèse de prix de tes propres sites.
      </div>`;
  }

  // ─── 3. OUVERTURES (early warning) ─────────────────────────────────
  function _renderOuvertures() {
    const o = _intel && _intel.openings;
    if (!o || !o.clubs) return _empty('Ouvertures non chargées — clique « ↻ Rafraîchir » (compte éditeur/admin requis).', true);
    const clubs = o.clubs || [];
    _clearMarkers();
    if (!clubs.length) return `
      <div style="font-size:11px;color:#94a3b8;margin-bottom:12px">${ago(o.fetchedAt)}</div>
      <div style="text-align:center;color:#64748b;font-size:13px;padding:40px">Aucune pré-ouverture concurrente détectée pour l'instant.<br><span style="font-size:11px">On surveille les clubs marqués « pré-vente » chez Stay Fit Gym. Reviens après un rafraîchissement.</span></div>`;
    _plotMarkers(clubs);
    const rows = clubs.map(c => `
      <div style="display:flex;align-items:center;gap:12px;padding:11px 12px;background:var(--card2);border:1px solid rgba(248,113,113,.25);border-left:3px solid #f87171;border-radius:10px;margin-bottom:8px">
        <div style="font-size:20px">🚧</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:700;color:#fff">${esc(c.brand)} — ${esc(c.name)}</div>
          <div style="font-size:10px;color:#94a3b8">${esc(c.city || '')} · pré-ouverture détectée${c.firstSeen ? ' le ' + esc(c.firstSeen) : ''} · <a href="${esc(c.url)}" target="_blank" rel="noopener" style="color:var(--blue)">page club ↗</a></div>
        </div>
        ${c.lat && c.lng
          ? `<button class="btn btn-sm" style="font-size:10px" onclick="CompetitorIntel.focus(${c.lat},${c.lng})">📍 Carte</button>`
          : `<span style="font-size:9px;color:#64748b">non géolocalisé</span>`}
      </div>`).join('');
    return `
      <div style="font-size:11px;color:#94a3b8;margin-bottom:12px">Clubs concurrents en <b style="color:#f87171">pré-ouverture</b> (marqués « pré-vente » sur le site de l'enseigne) — signal d'implantation avant l'ouverture réelle. ${ago(o.fetchedAt)}</div>
      ${rows}
      <div style="background:rgba(248,113,113,.06);border:1px solid rgba(248,113,113,.2);border-radius:10px;padding:12px 14px;margin-top:14px;font-size:11px;color:#cbd5e1;line-height:1.6">
        💡 Chaque pré-ouverture est posée sur la carte principale (📍). Croise-la avec tes sites cibles : un concurrent qui pré-vend à &lt; 1,5 km d'un site que tu vises change le calcul de captation.
      </div>`;
  }

  // ─── Carte ─────────────────────────────────────────────────────────
  function _clearMarkers() {
    const map = window._fpMap;
    _openMarkers.forEach(mk => { try { map && map.removeLayer(mk); } catch {} });
    _openMarkers = [];
  }
  function _plotMarkers(clubs) {
    const map = window._fpMap;
    if (!map || !window.L) return;
    clubs.forEach(c => {
      if (!c.lat || !c.lng) return;
      const icon = L.divIcon({
        className: 'ci-open-pin',
        html: `<div style="background:#f87171;width:18px;height:18px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center"><span style="transform:rotate(45deg);font-size:9px">🚧</span></div>`,
        iconSize: [18, 18], iconAnchor: [9, 18],
      });
      const mk = L.marker([c.lat, c.lng], { icon }).bindTooltip(
        `<b>${esc(c.brand)} — ${esc(c.name)}</b><br><span style="font-size:10px;color:#f87171">Pré-ouverture concurrente</span>`,
        { className: 'custom-tooltip', direction: 'top', offset: [0, -14] });
      try { mk.addTo(map); _openMarkers.push(mk); } catch {}
    });
  }
  function focus(lat, lng) {
    const map = window._fpMap;
    if (!map) return;
    // Ferme le panneau MAIS garde les marqueurs 🚧 (sinon on zoomerait sur un
    // point vide, le pin qu'on veut voir venant d'être retiré par close()).
    document.getElementById('ciPanel')?.remove();
    try { map.setView([lat, lng], 15, { animate: false }); } catch {}
  }

  // ─── utils ─────────────────────────────────────────────────────────
  function ago(ts) {
    const d = agoDays(ts);
    if (ts === 0 || d == null) return 'Jamais rafraîchi.';
    if (d === 0) return 'Mis à jour aujourd’hui.';
    return `Mis à jour il y a ${d} j.` + (d > 8 ? ' <span style="color:#fbbf24">(rafraîchis pour actualiser)</span>' : '');
  }
  function _empty(msg, canRefresh) {
    return `<div style="text-align:center;color:#64748b;font-size:13px;padding:50px 20px">${esc(msg)}</div>`;
  }

  window.CompetitorIntel = { open, close, tab, refresh, focus };
})();
