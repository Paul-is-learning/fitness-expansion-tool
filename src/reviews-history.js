// ─────────────────────────────────────────────────────────────────────
// reviews-history.js — vélocité des avis Google par concurrent (v6.69).
//
// Idée : le compteur d'avis d'un club croît avec son flux de nouveaux
// membres (Méthode B du dual model). En snapshottant les compteurs dans
// le temps, on obtient la VÉLOCITÉ (avis/mois) et sa tendance — un
// indicateur avancé de la dynamique commerciale de chaque concurrent,
// 100% légal (données publiques Google).
//
// - Seed t0 : REVIEWS_DB statique (scraping citymaps.ro, mars 2026).
// - Snapshots suivants : après chaque enrichWithGoogle réussi (Places
//   API), au plus 1 / 7 jours. Persistés localStorage + KV cross-device.
// - velocity(name) : Δavis / mois entre le plus ancien et le plus récent
//   point disponible (fenêtre ≥ 21 jours), + tendance vs le rythme
//   historique du club (reviewsPerYear de la Méthode B).
//
// API publique :
//   window.ReviewsHistory.maybeSnapshot(comps)  — hook post-enrichment
//   window.ReviewsHistory.velocity(name)        — {perMonth, delta, days, trendPct} | null
//   window.ReviewsHistory.openReport()          — modal classement vélocité
//   window.ReviewsHistory.sync()                — pull/push KV
//
// Dépendances globales (classic scripts, guards partout) :
//   REVIEWS_DB, CLUB_AGE?, estimateAge?, getReviewData, fmt, safeStorage?
// ─────────────────────────────────────────────────────────────────────
(function () {
  'use strict';

  const LS_KEY = 'fpReviewsHistory';
  const ENDPOINT = '/api/reviews';
  const SEED_TS = new Date('2026-03-15T12:00:00Z').getTime(); // date scraping citymaps.ro
  const MIN_SNAP_GAP_MS = 7 * 24 * 3600 * 1000;   // 1 snapshot / 7 jours max
  const MIN_VELOCITY_WINDOW_MS = 21 * 24 * 3600 * 1000; // fenêtre mini pour une vélocité fiable
  const LOCAL_CAP = 48;

  // Clubs dont le compteur t0 (mars 2026) était VÉRIFIÉ (marqueurs ✓ de
  // REVIEWS_DB, scraping citymaps.ro). Pour les autres, t0 était une
  // estimation → la "vélocité" vs seed mesurerait l'erreur d'estimation,
  // pas la croissance réelle. Leur vraie mesure démarre au 1er snapshot live.
  const VERIFIED_T0 = new Set([
    'World Class Downtown', 'World Class At The Grand', 'World Class Caro',
    'World Class InCity', 'World Class Upground', 'World Class Asmita Gardens',
    'World Class Militari Shopping', 'World Class Titan', 'World Class AFI Cotroceni',
    'World Class AFI Tech', 'World Class Lujerului', 'World Class Sudului',
    'World Class Titan Park', 'World Class Oregon Park',
    'Stay Fit Romana', 'Stay Fit Teiul Doamnei', 'Stay Fit Vitan',
    'Stay Fit Cocor', 'Stay Fit Liberty',
    'Downtown Fitness Vitan', 'CrossFit Columna (Uzina)',
  ]);

  function _storage() {
    return (typeof window.safeStorage !== 'undefined') ? window.safeStorage : null;
  }
  function load() {
    try {
      const s = _storage();
      const v = s ? s.get(LS_KEY, null) : JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      return (v && Array.isArray(v.snapshots)) ? v : { snapshots: [] };
    } catch { return { snapshots: [] }; }
  }
  function save(h) {
    try {
      h.snapshots.sort((a, b) => a.ts - b.ts);
      while (h.snapshots.length > LOCAL_CAP) h.snapshots.shift();
      const s = _storage();
      if (s) s.set(LS_KEY, h);
      else localStorage.setItem(LS_KEY, JSON.stringify(h));
    } catch {}
  }
  function getUser() {
    try {
      const raw = localStorage.getItem('fpCurrentUser') || sessionStorage.getItem('fpCurrentUser');
      return raw ? (JSON.parse(raw)?.email || '').toLowerCase().trim() : '';
    } catch { return ''; }
  }

  // ─── Seed t0 depuis la DB statique (une seule fois) ─────────────
  function ensureSeed(h) {
    if (h.snapshots.some(s => s.source === 'seed')) return false;
    if (typeof REVIEWS_DB === 'undefined') return false;
    const clubs = {};
    for (const name in REVIEWS_DB) {
      const e = REVIEWS_DB[name];
      if (e && typeof e.r === 'number') clubs[name] = { r: e.r, g: e.g };
    }
    if (!Object.keys(clubs).length) return false;
    h.snapshots.unshift({ ts: SEED_TS, source: 'seed', clubs });
    return true;
  }

  // ─── Snapshot après enrichment Places ───────────────────────────
  function maybeSnapshot(comps) {
    try {
      if (!Array.isArray(comps)) return;
      const enriched = comps.filter(c => c && c.gEnriched && c.gReviews > 0 && c.source === 'verified');
      if (enriched.length < 10) return; // trop partiel pour être un point de mesure
      const h = load();
      ensureSeed(h);
      const now = Date.now();
      const lastLive = [...h.snapshots].reverse().find(s => s.source !== 'seed');
      const clubs = {};
      enriched.forEach(c => { clubs[c.name] = { r: c.gReviews, g: c.gRating }; });
      const snap = { ts: now, source: 'places', clubs };
      if (lastLive && (now - lastLive.ts) < MIN_SNAP_GAP_MS) {
        // remplace le dernier point live (garde le plus frais, pas de spam)
        h.snapshots[h.snapshots.indexOf(lastLive)] = snap;
      } else {
        h.snapshots.push(snap);
      }
      save(h);
      pushRemote(snap);
    } catch (e) { console.warn('[ReviewsHistory] snapshot failed:', e); }
  }

  // ─── Sync KV (best-effort, silencieux hors prod) ────────────────
  async function pushRemote(snap) {
    const user = getUser();
    if (!user) return;
    try {
      await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, snapshot: snap }),
        keepalive: true,
      });
    } catch {}
  }
  async function sync() {
    try {
      const r = await fetch(ENDPOINT, { cache: 'no-store' });
      if (!r.ok) return { ok: false };
      const remote = await r.json();
      if (!Array.isArray(remote.snapshots)) return { ok: false };
      const h = load();
      ensureSeed(h);
      // union par ts (les snapshots sont immuables une fois écrits)
      const seen = new Set(h.snapshots.map(s => s.ts));
      remote.snapshots.forEach(s => { if (!seen.has(s.ts)) h.snapshots.push(s); });
      save(h);
      return { ok: true, count: h.snapshots.length };
    } catch { return { ok: false }; }
  }

  // ─── Vélocité par club ───────────────────────────────────────────
  function velocity(name) {
    try {
      const h = load();
      ensureSeed(h);
      // Le seed ne compte que si le t0 du club était vérifié (✓ mars 2026).
      const points = h.snapshots
        .filter(s => s.clubs && s.clubs[name] && typeof s.clubs[name].r === 'number')
        .filter(s => s.source !== 'seed' || VERIFIED_T0.has(name))
        .map(s => ({ ts: s.ts, r: s.clubs[name].r }));
      if (points.length < 2) return null;
      const first = points[0], last = points[points.length - 1];
      const spanMs = last.ts - first.ts;
      if (spanMs < MIN_VELOCITY_WINDOW_MS) return null;
      const months = spanMs / (30.44 * 24 * 3600 * 1000);
      const delta = last.r - first.r;
      const perMonth = Math.round((delta / months) * 10) / 10;
      // Compteur qui BAISSE sensiblement = fiche Google changée / avis purgés
      // (un total d'avis ne décroît quasi jamais organiquement) → à vérifier,
      // pas un signal business.
      const suspect = delta < 0 && Math.abs(delta) > Math.max(10, first.r * 0.1);
      // Tendance vs rythme historique du club (Méthode B : r total / âge)
      let trendPct = null;
      try {
        const rv = (typeof getReviewData === 'function') ? getReviewData(name, null) : null;
        if (rv && rv.reviewsPerYear > 0) {
          trendPct = Math.round((perMonth / (rv.reviewsPerYear / 12) - 1) * 100);
        }
      } catch {}
      return { perMonth, delta, days: Math.round(spanMs / 86400000), trendPct, from: first.r, to: last.r, suspect };
    } catch { return null; }
  }

  // ─── Rapport modal ───────────────────────────────────────────────
  function openReport() {
    const h = load();
    ensureSeed(h);
    save(h);
    const names = new Set();
    h.snapshots.forEach(s => Object.keys(s.clubs || {}).forEach(n => names.add(n)));
    const rows = [...names]
      .map(n => ({ name: n, v: velocity(n) }))
      .filter(x => x.v)
      .sort((a, b) => b.v.perMonth - a.v.perMonth);

    const fmtN = (typeof fmt === 'function') ? fmt : (x => String(x));
    // Sémantique FP : un concurrent qui ACCÉLÈRE = menace (rouge),
    // qui RALENTIT = opportunité de captage (vert).
    const trendBadge = (t) => {
      if (t == null) return '<span style="color:var(--gray2)">—</span>';
      const col = t > 15 ? 'var(--red)' : t < -15 ? 'var(--green)' : 'var(--gray)';
      const arrow = t > 15 ? '↗' : t < -15 ? '↘' : '→';
      return `<span style="color:${col};font-weight:700">${arrow} ${t > 0 ? '+' : ''}${t}%</span>`;
    };

    const old = document.getElementById('fpReviewsReportModal');
    if (old) old.remove();
    const modal = document.createElement('div');
    modal.id = 'fpReviewsReportModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(6,8,15,.92);z-index:10000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px);padding:20px';
    modal.innerHTML = `
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;width:100%;max-width:760px;max-height:100%;display:flex;flex-direction:column;overflow:hidden">
        <header style="padding:14px 18px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
          <div>
            <div style="font-size:14px;font-weight:800;color:var(--white)">📈 Vélocité des avis — concurrents</div>
            <div style="font-size:9px;color:var(--gray2);margin-top:2px">Δ avis Google / mois = proxy du flux de nouveaux membres · ${h.snapshots.length} snapshots (t0 = mars 2026)</div>
          </div>
          <div style="display:flex;gap:6px">
            <button id="fpRevSyncBtn" title="Sync cloud" style="background:transparent;border:1px solid var(--border);border-radius:6px;color:var(--gray);padding:5px 10px;cursor:pointer;font-size:10px">☁ Sync</button>
            <button onclick="document.getElementById('fpReviewsReportModal')?.remove()" style="background:transparent;border:1px solid var(--border);border-radius:6px;color:var(--gray);width:32px;height:32px;cursor:pointer;font-size:14px;font-weight:700">✕</button>
          </div>
        </header>
        <div style="padding:12px 18px;overflow-y:auto;flex:1">
          ${rows.length === 0
            ? `<div style="color:var(--gray2);font-size:10px;padding:20px;text-align:center">Pas encore assez de points de mesure (fenêtre mini 21 jours).<br>Charge les concurrents avec la clé Google active pour créer un snapshot, puis reviens dans quelques semaines — ou fais ☁ Sync si un autre device a déjà mesuré.</div>`
            : `<table style="width:100%;border-collapse:collapse;font-size:10px">
                <thead><tr style="border-bottom:1px solid var(--border);color:var(--gray2);font-size:8px;letter-spacing:.5px">
                  <th style="text-align:left;padding:6px 8px">CLUB</th>
                  <th style="text-align:right;padding:6px 8px">AVIS (t0 → now)</th>
                  <th style="text-align:right;padding:6px 8px">Δ</th>
                  <th style="text-align:right;padding:6px 8px">AVIS/MOIS</th>
                  <th style="text-align:right;padding:6px 8px" title="vs le rythme historique du club (total avis / âge)">TENDANCE</th>
                </tr></thead>
                <tbody>
                  ${rows.map(x => `
                    <tr style="border-bottom:1px solid rgba(71,85,115,.15)${x.v.suspect ? ';opacity:.55' : ''}">
                      <td style="padding:5px 8px;color:var(--white);font-weight:600">${x.name.replace(/</g,'&lt;')}${x.v.suspect ? ' <span title="Compteur en baisse — fiche Google probablement changée ou avis purgés : signal à ignorer" style="color:var(--yellow);font-size:8px">⚠ fiche à vérifier</span>' : ''}</td>
                      <td style="padding:5px 8px;text-align:right;color:var(--gray)">${fmtN(x.v.from)} → ${fmtN(x.v.to)} <span style="font-size:7.5px;color:var(--gray2)">(${x.v.days}j)</span></td>
                      <td style="padding:5px 8px;text-align:right;color:${x.v.delta >= 0 ? 'var(--green)' : 'var(--red)'};font-weight:700">${x.v.delta >= 0 ? '+' : ''}${fmtN(x.v.delta)}</td>
                      <td style="padding:5px 8px;text-align:right;color:var(--cyan);font-weight:800">${x.v.suspect ? '—' : x.v.perMonth}</td>
                      <td style="padding:5px 8px;text-align:right">${x.v.suspect ? '<span style="color:var(--gray2)">—</span>' : trendBadge(x.v.trendPct)}</td>
                    </tr>`).join('')}
                </tbody>
              </table>
              <div style="font-size:8px;color:var(--gray2);margin-top:10px;line-height:1.5">
                Lecture : un club qui accélère (↗) recrute plus vite que son rythme historique — pression concurrentielle en hausse dans sa zone.
                Un club qui décélère (↘) perd de la traction — opportunité de captage.<br>
                Fiabilité : seuls les clubs au comptage t0 <b>vérifié</b> (mars 2026, ~21 clubs) ont une vélocité immédiate — pour les autres,
                la mesure démarre au premier snapshot live (${new Date().toLocaleDateString('fr-FR')}) et sera disponible sous ~3-4 semaines.
              </div>`}
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    const syncBtn = modal.querySelector('#fpRevSyncBtn');
    if (syncBtn) syncBtn.addEventListener('click', async () => {
      syncBtn.textContent = '…';
      const r = await sync();
      syncBtn.textContent = r.ok ? '☁ ✓' : '☁ ✗';
      setTimeout(() => { modal.remove(); openReport(); }, 400);
    });
  }

  // Pull cloud au boot (best-effort, après un délai pour ne pas gêner le boot)
  setTimeout(() => { sync(); }, 4000);

  window.ReviewsHistory = { maybeSnapshot, velocity, openReport, sync };
})();
