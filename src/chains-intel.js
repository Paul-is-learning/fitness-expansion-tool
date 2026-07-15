// ─────────────────────────────────────────────────────────────────────
// chains-intel.js — Intelligence enseignes via comptes publics RO (v6.69).
//
// Toute société roumaine dépose ses comptes au Ministerul Finanțelor
// (mfinante.gov.ro) : CA, profit, effectifs = PUBLICS. Croisés avec les
// déclarations presse, ils donnent le membres/club moyen par enseigne —
// la meilleure approximation LÉGALE et CITABLE du KPI n°1 (abonnés/salle).
//
// Recherche du 2026-06-25 (sources en bas de chaque fiche). Chiffres
// vérifiés par recoupement ≥ 2 sources. À rafraîchir 1×/an à la
// publication des bilans (mai-juillet N+1).
//
// ⚠️ Leçons de méthode (pour la mise à jour annuelle) :
//   1. La cifra de afaceri est HT ; les ARPU catalogue sont TTC.
//   2. Identifier la BONNE entité : Stay Fit = STAY FIT IRIDE SA (pas
//      Stay Fit Gym SRL), 18GYM = EIGHTEENGYM SRL, Nr1 = NORDIC FITNESS
//      GROUP SRL. L'entité éponyme n'est pas toujours l'exploitant.
//   3. listafirme.eu affiche l'EUR converti au taux BNR de FIN d'exercice
//      (4.974 pour 2024, ~5.10 pour 2025).
//   4. L'ARPU réel implicite (CA÷membres déclarés) est 20-45% SOUS le
//      catalogue (corporate, famille, promos) : WC ~46€, SF ~28€, 18G ~26€.
// ─────────────────────────────────────────────────────────────────────

const CHAINS_INTEL = [
  {
    brand: 'World Class', entity: 'World Class Romania SA', cui: '16128511',
    fy: [
      { year: 2024, caRon: 232.9e6, caEur: 46.81e6, netEur: -5.29e6, staff: 370 },
      { year: 2025, caRon: 242.6e6, caEur: 47.58e6, netEur: -9.81e6, staff: 379 },
    ],
    declared: { members: 84000, clubs: 47, date: '2025-11', src: 'business-review.eu (comm. 25 ans)' },
    membersPerClub: 1787,        // 84 000 / 47 (déclaré)
    arpuImplicitEur: 46,         // CA 2025 / (84k × 12) — vs catalogue 46-145€
    note: 'Leader. Pertes nettes 2 ans de suite malgré CA stable — pression coûts.',
    sources: [
      'https://listafirme.eu/world-class-romania-sa-16128511/',
      'https://www.confidas.ro/profil/16128511/world-class-romania-sa',
      'https://business-review.eu/lifestyle/wellness/world-class-romania-celebrates-25-years-and-launches-plan-to-expand-access-to-movement-health-and-prevention-291344',
    ],
  },
  {
    brand: 'Stay Fit Gym', entity: 'Stay Fit Iride SA (Morphosis Capital)', cui: '41700478',
    fy: [
      { year: 2024, caRon: 71.05e6, caEur: 14.28e6, netEur: 0.07e6, staff: 204 },
      { year: 2025, caRon: 110e6, caEur: 21.57e6, netEur: 0.61e6, staff: 285 },
    ],
    declared: { members: 80000, clubs: 72, date: '2026 (site officiel; 42k/47 clubs nov. 2024)', src: 'stayfit.ro / revistabiz.ro' },
    membersPerClub: 1111,        // 80 000 / 72 (déclaré site)
    arpuImplicitEur: 28,         // vs catalogue 32€
    note: 'Hypercroissance : CA ×2.6 en 2 ans (41→110 M RON). Le challenger le plus agressif.',
    sources: [
      'https://listafirme.eu/stay-fit-iride-sa-41700478/',
      'https://termene.ro/firma/41700478-STAY-FIT-IRIDE-SA',
      'https://www.revistabiz.ro/stay-fit-gym-devine-cea-mai-mare-retea-de-fitness-din-romania-si-europa-de-est/',
    ],
  },
  {
    brand: '18GYM', entity: 'Eighteengym SRL (Târgu Mureș)', cui: '9829933',
    fy: [
      { year: 2024, caRon: 38.8e6, caEur: 7.81e6, netEur: 0.34e6, staff: 99 },
      { year: 2025, caRon: 88e6, caEur: 17.25e6, netEur: 1.90e6, staff: 191 },
    ],
    declared: { members: 56000, clubs: 38, date: '2025-2026', src: 'newmoney.ro (40k/35 salles juil. 2024, zi-de-zi.ro)' },
    membersPerClub: 1474,        // 56 000 / 38
    arpuImplicitEur: 26,         // vs catalogue 36€
    note: 'CA ×2.3 en 1 an. Levée 20 M€ (Enterprise Investors), objectif 150 salles. ⚠️ Réseau national 37-40 salles (6 à Bucarest dans notre base).',
    sources: [
      'https://listafirme.eu/eighteengym-srl-9829933/',
      'https://newmoney.ro/fitnessul-ca-pariu-antreprenorial-cum-a-construit-vlad-ronea-reteaua-18gym-si-ce-planuri-are-ca-sa-ajunga-la-150-de-sali-in-romania/',
      'https://economedia.ro/lantul-romanesc-de-sali-de-fitness-18gym-primeste-o-investitie-de-20-de-milioane-de-euro.html',
    ],
  },
  {
    brand: 'Downtown Fitness', entity: 'Downtown Fitness SRL', cui: '33347821',
    fy: [
      { year: 2024, caRon: 9.74e6, caEur: 1.96e6, netEur: 0.15e6, staff: 13 },
      { year: 2025, caRon: 14.16e6, caEur: 2.78e6, netEur: 0.66e6, staff: 17 },
    ],
    declared: { members: null, clubs: 4, date: '2026', src: 'downtownfitness.ro/locatii (aucune déclaration membres)' },
    membersPerClub: 1380,        // implicite: CA 2025 / (42€ HT-ajusté × 12) / 4 clubs
    arpuImplicitEur: null,
    note: '+45% CA en 2025. ⚠️ Le site officiel liste 4 clubs (Obor, Mihalache, M. Bravu, M. Basarab) — Vitan absent : fermeture à vérifier (notre base a 5 clubs dont Vitan 1800m²).',
    sources: [
      'https://listafirme.eu/downtown-fitness-srl-33347821/',
      'https://downtownfitness.ro/locatii/',
    ],
  },
  {
    brand: 'Nr1 Fitness', entity: 'Nordic Fitness Group SRL', cui: '42132740',
    fy: [
      { year: 2024, caRon: 4.38e6, caEur: 0.88e6, netEur: 0.05e6, staff: 3 },
      { year: 2025, caRon: 4.87e6, caEur: 0.95e6, netEur: 0.12e6, staff: 3 },
    ],
    declared: { members: null, clubs: 5, date: '—', src: 'aucune déclaration publique' },
    membersPerClub: 720,         // implicite: CA 2025 / (22€ × 12) / 5 clubs
    arpuImplicitEur: null,
    note: '⚠️ 3 salariés sur l\'entité — des clubs sont peut-être portés par d\'autres SRL/franchises : CA = plancher.',
    sources: [
      'https://termene.ro/firma/42132740-NORDIC-FITNESS-GROUP-SRL',
      'https://listafirme.eu/nordic-fitness-group-srl-42132740/',
    ],
  },
];

// Marché total RO (Forbes, comptes agrégés CAEN 9313) :
// 970 M RON en 2024, 2 234 opérateurs. ⚠️ N°3 national = "ESX Intel World SRL"
// (63 M RON 2024) — enseigne non identifiée dans notre base, à investiguer.
const CHAINS_MARKET_NOTE = {
  totalRon2024: 970e6, operators: 2234,
  unknownTop3: 'ESX Intel World SRL — 63 M RON (2024), enseigne à identifier',
  src: 'https://www.forbes.ro/piata-de-fitness-din-romania-a-atins-970-milioane-lei-in-2024-romancele-investesc-tot-mai-mult-in-coaching-si-sanatate-personalizata-468604',
};

// ─── Modal rapport ───────────────────────────────────────────────────
function openChainsIntel() {
  const fmtM = v => v == null ? '—' : (Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1).replace('.', ',') + ' M' : Math.round(v / 1000) + ' k');
  const old = document.getElementById('fpChainsIntelModal');
  if (old) old.remove();
  const modal = document.createElement('div');
  modal.id = 'fpChainsIntelModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(6,8,15,.92);z-index:10000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px);padding:20px';
  modal.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;width:100%;max-width:900px;max-height:100%;display:flex;flex-direction:column;overflow:hidden">
      <header style="padding:14px 18px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-size:14px;font-weight:800;color:var(--white)">🏢 Enseignes — comptes publics (Ministerul Finanțelor)</div>
          <div style="font-size:9px;color:var(--gray2);margin-top:2px">CA déposés (HT) + déclarations presse → membres/club par enseigne. Sources officielles, citables banque/investisseur. Recherche 2026-06-25.</div>
        </div>
        <button onclick="document.getElementById('fpChainsIntelModal')?.remove()" style="background:transparent;border:1px solid var(--border);border-radius:6px;color:var(--gray);width:32px;height:32px;cursor:pointer;font-size:14px;font-weight:700">✕</button>
      </header>
      <div style="padding:12px 18px;overflow-y:auto;flex:1">
        <table style="width:100%;border-collapse:collapse;font-size:10px">
          <thead><tr style="border-bottom:1px solid var(--border);color:var(--gray2);font-size:8px;letter-spacing:.5px">
            <th style="text-align:left;padding:6px 8px">ENSEIGNE</th>
            <th style="text-align:right;padding:6px 8px">CA 2024 → 2025 (€)</th>
            <th style="text-align:right;padding:6px 8px">RÉSULTAT 2025</th>
            <th style="text-align:right;padding:6px 8px">MEMBRES (décl.)</th>
            <th style="text-align:right;padding:6px 8px">CLUBS</th>
            <th style="text-align:right;padding:6px 8px;color:var(--accent)">MBR/CLUB</th>
            <th style="text-align:right;padding:6px 8px">ARPU RÉEL</th>
          </tr></thead>
          <tbody>
            ${CHAINS_INTEL.map(c => {
              const g24 = c.fy.find(f => f.year === 2024), g25 = c.fy.find(f => f.year === 2025);
              const growth = g24 && g25 ? Math.round((g25.caEur / g24.caEur - 1) * 100) : null;
              return `
              <tr style="border-bottom:1px solid rgba(71,85,115,.15)">
                <td style="padding:6px 8px">
                  <div style="color:var(--white);font-weight:700">${c.brand}</div>
                  <div style="font-size:8px;color:var(--gray2)">${c.entity} · CUI ${c.cui}</div>
                </td>
                <td style="padding:6px 8px;text-align:right;color:var(--white)">${fmtM(g24?.caEur)}€ → <b>${fmtM(g25?.caEur)}€</b>
                  ${growth != null ? `<div style="font-size:8px;color:${growth > 20 ? 'var(--red)' : growth > 5 ? 'var(--yellow)' : 'var(--gray2)'};font-weight:700">${growth > 0 ? '+' : ''}${growth}%/an${growth > 20 ? ' ⚠️' : ''}</div>` : ''}
                </td>
                <td style="padding:6px 8px;text-align:right;color:${(g25?.netEur || 0) >= 0 ? 'var(--green)' : 'var(--red)'};font-weight:700">${fmtM(g25?.netEur)}€</td>
                <td style="padding:6px 8px;text-align:right;color:var(--white)">${c.declared.members ? (c.declared.members / 1000) + ' k' : '—'}<div style="font-size:7.5px;color:var(--gray2)">${c.declared.date}</div></td>
                <td style="padding:6px 8px;text-align:right;color:var(--gray)">${c.declared.clubs || '—'}</td>
                <td style="padding:6px 8px;text-align:right;color:var(--accent);font-weight:800;font-size:12px">${c.membersPerClub ? c.membersPerClub.toLocaleString('fr-FR') : '—'}</td>
                <td style="padding:6px 8px;text-align:right;color:var(--cyan)">${c.arpuImplicitEur ? c.arpuImplicitEur + '€/mois' : 'est.'}</td>
              </tr>
              <tr style="border-bottom:1px solid rgba(71,85,115,.25)">
                <td colspan="7" style="padding:2px 8px 8px;font-size:8.5px;color:var(--gray2);line-height:1.4">${c.note}
                  ${c.sources.map((s, i) => ` <a href="${s}" target="_blank" rel="noopener" style="color:var(--blue);text-decoration:none">[${i + 1}]</a>`).join('')}
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
        <div style="margin-top:12px;padding:10px;background:var(--bg);border-radius:6px;font-size:9px;color:var(--gray);line-height:1.6">
          <b style="color:var(--accent)">Marché total RO 2024 :</b> ${(CHAINS_MARKET_NOTE.totalRon2024 / 1e6).toFixed(0)} M RON · ${CHAINS_MARKET_NOTE.operators.toLocaleString('fr-FR')} opérateurs
          <a href="${CHAINS_MARKET_NOTE.src}" target="_blank" rel="noopener" style="color:var(--blue);text-decoration:none">[Forbes]</a><br>
          <b style="color:var(--yellow)">⚠️ À investiguer :</b> ${CHAINS_MARKET_NOTE.unknownTop3}.<br>
          <b style="color:var(--green)">✓ Validation :</b> les estimations membres/club de notre base (surface × ratio, calibrée WC 84k) sont cohérentes avec les
          comptes officiels — WC ~1 790 déclaré vs ~1 870 modèle, Stay Fit ~1 100 vs ~1 100, 18GYM ~1 470 vs 1 200, Nr1 ~720 vs 600.
          L'ARPU réel des concurrents (26-46€ TTC-mix) est nettement SOUS leur catalogue — pertinent pour le pricing FP 27,8€.
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}
window.openChainsIntel = openChainsIntel;
window.CHAINS_INTEL = CHAINS_INTEL;
