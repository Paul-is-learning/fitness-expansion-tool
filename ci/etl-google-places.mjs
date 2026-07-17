// ─────────────────────────────────────────────────────────────────────
// ci/etl-google-places.mjs — Pack éco Google (v7.13)
//
// Rafraîchit 1×/mois les notes/avis Google des ~90 concurrents vérifiés
// → data/competitors-google.json (lu par l'app au runtime, ZÉRO appel
// Google côté client). Lancé par .github/workflows/google-places-refresh.yml.
//
// Env requis : GOOGLE_PLACES_ETL_KEY — clé Google SERVEUR dédiée (à créer
// dans la console Google, restreinte à l'API "Places API (New)" + quota
// journalier bas, ex. 200 req/jour). NE PAS réutiliser la clé client.
// Sans clé : sortie propre (exit 0) — le fichier reste tel quel.
//
// Coût : ~90 requêtes Text Search PAR MOIS au total (une par club),
// largement dans le palier gratuit mensuel de Google.
// ─────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'competitors-google.json');
const KEY = process.env.GOOGLE_PLACES_ETL_KEY || '';

if (!KEY) {
  console.log('[etl-google-places] GOOGLE_PLACES_ETL_KEY absent — rien à faire (exit 0).');
  console.log('  → Pour activer le refresh mensuel : créer une clé serveur Places API (New)');
  console.log('    dans la console Google, puis GitHub → Settings → Secrets → GOOGLE_PLACES_ETL_KEY.');
  process.exit(0);
}

// Charge VERIFIED_CLUBS depuis data/clubs.js (script classique → on l'évalue)
const clubsSrc = fs.readFileSync(path.join(ROOT, 'data', 'clubs.js'), 'utf8');
const VERIFIED_CLUBS = new Function(`${clubsSrc}; return VERIFIED_CLUBS;`)();
console.log(`[etl-google-places] ${VERIFIED_CLUBS.length} clubs à rafraîchir`);

const norm = (name) => name.toLowerCase().replace(/\s+/g, '_');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function searchPlace(club) {
  const resp = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': KEY,
      'X-Goog-FieldMask': 'places.displayName,places.rating,places.userRatingCount,places.websiteUri,places.location,places.formattedAddress',
    },
    body: JSON.stringify({ textQuery: `${club.name} gym Bucharest`, maxResultCount: 1, languageCode: 'ro' }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} — ${(await resp.text()).slice(0, 120)}`);
  const p = (await resp.json()).places?.[0];
  if (!p) return null;
  // Garde-fou géo : le résultat doit être à <2 km du club vérifié, sinon on
  // a matché un homonyme — on ignore (jamais de donnée douteuse).
  if (p.location) {
    const dLat = (p.location.latitude - club.lat) * 111320;
    const dLng = (p.location.longitude - club.lng) * 111320 * Math.cos(club.lat * Math.PI / 180);
    if (Math.hypot(dLat, dLng) > 2000) return null;
  }
  return {
    rating: p.rating ?? null,
    userRatingCount: p.userRatingCount ?? null,
    websiteUri: p.websiteUri ?? null,
    matchedName: p.displayName?.text ?? null,
    formattedAddress: p.formattedAddress ?? null,
  };
}

const places = {};
let ok = 0, miss = 0, err = 0;
for (const club of VERIFIED_CLUBS) {
  try {
    const r = await searchPlace(club);
    if (r) { places[norm(club.name)] = r; ok++; }
    else miss++;
  } catch (e) {
    err++;
    console.warn(`  ⚠ ${club.name}: ${e.message}`);
    if (err > 10) { console.error('[etl-google-places] Trop d\'erreurs — abandon sans écrire.'); process.exit(1); }
  }
  await sleep(150); // politesse quota
}

const out = {
  generated_at: new Date().toISOString().slice(0, 10),
  note: 'Généré par ci/etl-google-places.mjs — ne pas éditer à la main.',
  places,
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`[etl-google-places] ✅ ${ok} enrichis, ${miss} introuvables/écartés, ${err} erreurs → ${path.relative(ROOT, OUT)}`);
