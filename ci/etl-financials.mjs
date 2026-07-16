#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────
// ci/etl-financials.mjs — Intel #1 : bilans publics des concurrents.
//
// SOURCE : data.gov.ro (open data ANAF) — situations financières annuelles
// déposées par toutes les sociétés roumaines. 100 % public, gratuit, légal.
// Publié chaque année en juin (exercice N-1).
//
// CE QUE FAIT LE SCRIPT :
//   1. Interroge l'API CKAN de data.gov.ro pour trouver, pour l'année
//      demandée, (a) le bulk des bilans « WEB_BL_BS_SL » et (b) le fichier
//      d'identité « date_identificare_platitori » (noms + adresses).
//      → résout les URLs dynamiquement (les IDs de ressources changent
//        chaque année), donc le script survit aux millésimes.
//   2. Télécharge le bulk bilans, filtre le secteur fitness (CAEN 9313).
//   3. Streame le fichier d'identité (gros) et n'en garde que les lignes
//      des CUI fitness → noms, localité, secteur Bucarest, statut.
//   4. Écrit data/competitors-financials.json : agrégat marché + liste des
//      opérateurs + rattachement aux enseignes suivies (World Class, Stay
//      Fit, 18GYM) pour le badge « santé financière » de l'outil.
//
// RE-EXÉCUTION (annuelle, ~chaque juin) :
//   node ci/etl-financials.mjs            # année par défaut (ci-dessous)
//   node ci/etl-financials.mjs 2026       # forcer un exercice
//   git add data/competitors-financials.json && git commit && git push
//
// Sécurité : si le téléchargement échoue, le script NE touche PAS au JSON
// existant (pas d'écrasement par du vide).
// ─────────────────────────────────────────────────────────────────────
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dir, '..', 'data', 'competitors-financials.json');

const YEAR = Number(process.argv[2]) || 2025;   // exercice financier
const IDENTITY_YEAR = YEAR + 1;                  // identité publiée l'année N+1
const CAEN_FITNESS = 9313;                       // « Activités des centres de fitness »
const CKAN = 'https://data.gov.ro/api/3/action';

// Colonnes du bulk WEB_BL_BS_SL (ordre officiel, cf. spec .csv) :
// CUI,CAEN,I1..I20. Indices 0-based dans la ligne CSV :
const COL = { cui: 0, caen: 1, equity: 11, ca: 14, profitNet: 19, lossNet: 20, employees: 21 };

// CUI → enseigne suivie dans l'outil (pour le badge santé financière).
// ESX INTEL WORLD (agrégateur/reseller, pas un exploitant) est volontairement
// exclu du classement des opérateurs.
const CHAINS = {
  16128511: { enseigne: 'World Class', segment: 'premium' },
  41700478: { enseigne: 'Stay Fit Gym', segment: 'mid' },
  9829933:  { enseigne: '18GYM', segment: 'low-cost' },
  33347821: { enseigne: 'Downtown Fitness', segment: 'mid' },
};
const AGGREGATORS = new Set([38151434]); // ESX INTEL WORLD — exclu du top opérateurs

const n = v => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

async function ckanResourceUrl(datasetId, matcher) {
  const r = await fetch(`${CKAN}/package_show?id=${datasetId}`);
  if (!r.ok) throw new Error(`CKAN ${datasetId} → ${r.status}`);
  const j = await r.json();
  const res = (j.result?.resources || []).find(matcher);
  if (!res) throw new Error(`Ressource introuvable dans ${datasetId}`);
  return res.url;
}

async function downloadText(url) {
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`GET ${url} → ${r.status}`);
  return r.text();
}

// Streame un gros fichier ^-délimité encodé Windows-1250 et ne garde que les
// lignes dont le 1er champ (COD_FISCAL) est dans `cuiSet`.
async function streamIdentity(url, cuiSet, out) {
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`GET identity → ${r.status}`);
  const decoder = new TextDecoder('windows-1250');
  let buf = '';
  for await (const chunk of r.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      const tab = line.indexOf('^');
      if (tab < 0) continue;
      const cui = line.slice(0, tab).trim();
      if (cuiSet.has(cui)) {
        const f = line.split('^');
        out.set(cui, {
          name: (f[1] || '').trim(),
          city: (f[5] || '').trim(),
          sector: (f[11] || '').trim(),   // S1..S6 pour Bucarest
          judet: (f[22] || '').trim(),
          stare: (f[21] || '').trim(),
        });
      }
    }
  }
}

function healthOf(op) {
  // Santé financière lisible : solvabilité (fonds propres) + rentabilité.
  const solvent = op.equity > 0;
  const profitable = op.netResult > 0;
  if (solvent && profitable) return { label: 'Saine', level: 'ok', why: 'Fonds propres positifs et bénéficiaire' };
  if (solvent && !profitable) return { label: 'Sous pression', level: 'warn', why: 'En perte mais fonds propres positifs' };
  if (!solvent && profitable) return { label: 'Fragile', level: 'warn', why: 'Bénéficiaire mais fonds propres négatifs' };
  return { label: 'À risque', level: 'risk', why: 'En perte et fonds propres négatifs' };
}

async function main() {
  console.log(`[etl] exercice ${YEAR} (identité ${IDENTITY_YEAR}) — CAEN ${CAEN_FITNESS}`);

  // 1. Résolution dynamique des URLs
  const blUrl = await ckanResourceUrl(
    `situatii_financiare_${YEAR}`,
    r => /WEB_BL_BS_SL/i.test(r.name || '') && /\.txt$/i.test(r.name || '')
  );
  console.log('[etl] bilans :', blUrl);

  // 2. Bilans → filtre CAEN 9313
  const bl = await downloadText(blUrl);
  const lines = bl.split(/\r?\n/);
  const ops = [];
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split(',');
    if (f.length < 22) continue;
    if (n(f[COL.caen]) !== CAEN_FITNESS) continue;
    const ca = n(f[COL.ca]);
    const netResult = n(f[COL.profitNet]) - n(f[COL.lossNet]);
    ops.push({
      cui: String(f[COL.cui]).trim(),
      ca,
      netResult,
      netMargin: ca > 0 ? +(netResult / ca * 100).toFixed(1) : null,
      equity: n(f[COL.equity]),
      employees: n(f[COL.employees]),
    });
  }
  console.log(`[etl] ${ops.length} sociétés CAEN ${CAEN_FITNESS}`);
  if (!ops.length) throw new Error('0 société — format inattendu, abandon (JSON préservé)');

  // 3. Résolution des noms (identité, 2 parties a+b)
  const cuiSet = new Set(ops.map(o => o.cui));
  const names = new Map();
  for (const part of ['a', 'b']) {
    try {
      const url = await ckanResourceUrl(
        `date_de_identificare_platitori_actualizate_iunie_${IDENTITY_YEAR}`,
        r => new RegExp(`_${part}\\.txt$`, 'i').test(r.name || '')
      );
      await streamIdentity(url, cuiSet, names);
      console.log(`[etl] identité ${part} : ${names.size} noms cumulés`);
    } catch (e) { console.warn(`[etl] identité ${part} ignorée : ${e.message}`); }
  }

  // 4. Enrichissement + tri
  for (const o of ops) {
    const id = names.get(o.cui) || {};
    o.name = id.name || `CUI ${o.cui}`;
    o.city = id.city || '';
    o.sector = id.sector || '';
    o.judet = id.judet || '';
    o.bucharest = /BUCURE/i.test(id.judet || '') || /BUCURE/i.test(id.city || '');
    const chain = CHAINS[o.cui];
    if (chain) { o.enseigne = chain.enseigne; o.segment = chain.segment; }
    o.aggregator = AGGREGATORS.has(Number(o.cui));
    o.health = healthOf(o);
  }
  ops.sort((a, b) => b.ca - a.ca);

  // v6.88 — stats secteur calculées sur les OPÉRATEURS seuls (agrégateurs/
  // resellers exclus des deux côtés) : sinon totalCA gonfle et top3Share
  // divise un top-3 d'opérateurs par un total incluant un non-opérateur.
  const operators = ops.filter(o => !o.aggregator);
  const sectorCA = operators.reduce((s, o) => s + o.ca, 0);
  const payload = {
    meta: {
      sourceYear: YEAR,
      generatedAt: new Date().toISOString().slice(0, 10),
      source: 'data.gov.ro — Situații financiare anuale (ANAF)',
      datasetUrl: `https://data.gov.ro/dataset/situatii_financiare_${YEAR}`,
      caen: CAEN_FITNESS,
      note: 'CA neta / résultat net / fonds propres / effectifs, en RON. Les enseignes consolident leurs clubs dans une entité unique : CA par club = CA entité ÷ nb de clubs. Stats secteur : opérateurs seuls (agrégateurs exclus).',
      currency: 'RON',
    },
    sector: {
      operators: operators.length,
      totalFilings: ops.length,
      totalCA: sectorCA,
      top3Share: +(operators.slice(0, 3).reduce((s, o) => s + o.ca, 0) / sectorCA * 100).toFixed(1),
    },
    // enseignes suivies (badge santé financière)
    chains: operators.filter(o => o.enseigne).map(o => ({
      enseigne: o.enseigne, cui: o.cui, name: o.name, segment: o.segment,
      ca: o.ca, netResult: o.netResult, netMargin: o.netMargin,
      equity: o.equity, employees: o.employees, health: o.health,
    })),
    // radar marché : top opérateurs (hors agrégateurs)
    operators: operators.map(o => ({
      cui: o.cui, name: o.name, city: o.city, sector: o.sector, judet: o.judet,
      bucharest: o.bucharest, enseigne: o.enseigne || null,
      ca: o.ca, netResult: o.netResult, netMargin: o.netMargin,
      equity: o.equity, employees: o.employees, health: o.health,
    })),
  };

  writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');
  console.log(`[etl] ✅ écrit ${OUT}`);
  console.log(`[etl]    marché : ${(sectorCA / 1e6).toFixed(0)} M RON sur ${ops.length} sociétés ; top3 = ${payload.sector.top3Share}%`);
  for (const c of payload.chains) {
    console.log(`[etl]    ${c.enseigne.padEnd(18)} CA ${(c.ca / 1e6).toFixed(1)}M | net ${(c.netResult / 1e6).toFixed(1)}M | ${c.health.label}`);
  }
}

main().catch(e => {
  console.error('[etl] ÉCHEC :', e.message);
  if (existsSync(OUT)) console.error('[etl] JSON existant préservé (pas d’écrasement).');
  process.exit(1);
});
