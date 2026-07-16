// ═══════════════════════════════════════════════════════════════════
// app-core.js — corps applicatif extrait d'index.html (v6.82, SaaS P3b).
// Script CLASSIQUE non-defer : exécuté à la position d'origine, APRÈS
// config.js/utils.js/data-*.js et AVANT les modules defer. Le scope
// lexical global (let/const top-level) reste partagé — sémantique
// identique au bloc inline. Extraction verbatim, zéro changement de code.
// ═══════════════════════════════════════════════════════════════════

// ================================================================
// CORE CONFIG — see config.js
// GOOGLE MAPS PLATFORM API — see config.js
// ================================================================
// Constants moved to config.js: BUCHAREST, OVERPASS, NOMINATIM,
// GOOGLE_API_KEY, GOOGLE_PLACES_URL, GOOGLE_GEOCODE_URL,
// _googleHasKey, _googleCache, GOOGLE_CACHE_KEY, GOOGLE_CACHE_TTL,
// MODEL_VERSION.

function loadGoogleCache() {
  try {
    const raw = localStorage.getItem(GOOGLE_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const now = Date.now();
    // Purge expired entries
    Object.keys(parsed).forEach(k => { if (now - parsed[k]._ts > GOOGLE_CACHE_TTL) delete parsed[k]; });
    return parsed;
  } catch(e) { return {}; }
}
function saveGoogleCache(cache) {
  try { localStorage.setItem(GOOGLE_CACHE_KEY, JSON.stringify(cache)); } catch(e) {}
}
let googlePlacesCache = loadGoogleCache();

// Rate limiter: max 5 requests/sec
const _gQueue = [];
let _gRunning = 0;
async function googleFetch(url, opts = {}) {
  if (!_googleHasKey()) return null;
  return new Promise((resolve, reject) => {
    _gQueue.push({ url, opts, resolve, reject });
    _drainGQueue();
  });
}
function _drainGQueue() {
  while (_gQueue.length > 0 && _gRunning < 5) {
    _gRunning++;
    const { url, opts, resolve, reject } = _gQueue.shift();
    fetch(url, opts).then(r => r.json()).then(d => { _gRunning--; resolve(d); _drainGQueue(); })
      .catch(e => { _gRunning--; resolve(null); _drainGQueue(); });
  }
  if (_gQueue.length > 0 && _gRunning >= 5) {
    setTimeout(_drainGQueue, 220);
  }
}

// Google Geocoding
async function googleGeocode(address) {
  const url = `${GOOGLE_GEOCODE_URL}?address=${encodeURIComponent(address)}&key=${GOOGLE_API_KEY}&region=ro`;
  const data = await googleFetch(url);
  if (data && data.results && data.results.length > 0) {
    const loc = data.results[0].geometry.location;
    return { lat: loc.lat, lng: loc.lng, formatted: data.results[0].formatted_address };
  }
  return null;
}

// Google Places Text Search (New API)
async function googlePlaceSearch(query) {
  const cacheKey = 'ts_' + query.toLowerCase().replace(/\s+/g, '_');
  if (googlePlacesCache[cacheKey]) return googlePlacesCache[cacheKey];

  const data = await googleFetch(`${GOOGLE_PLACES_URL}:searchText`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_API_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.rating,places.userRatingCount,places.currentOpeningHours,places.websiteUri,places.location,places.formattedAddress'
    },
    body: JSON.stringify({
      textQuery: query,
      locationBias: { circle: { center: { latitude: 44.4268, longitude: 26.1025 }, radius: 30000 } }
    })
  });
  if (data && data.places && data.places.length > 0) {
    const p = data.places[0];
    const result = {
      placeId: p.id,
      name: p.displayName?.text || query,
      rating: p.rating || null,
      reviewCount: p.userRatingCount || 0,
      isOpen: p.currentOpeningHours?.openNow ?? null,
      website: p.websiteUri || null,
      address: p.formattedAddress || null,
      lat: p.location?.latitude,
      lng: p.location?.longitude,
      _ts: Date.now()
    };
    googlePlacesCache[cacheKey] = result;
    saveGoogleCache(googlePlacesCache);
    return result;
  }
  return null;
}

// Google Nearby Search for gyms
async function googleNearbyGyms(lat, lng, radiusM) {
  if (!_googleHasKey()) return [];
  const cacheKey = `nearby_${lat.toFixed(3)}_${lng.toFixed(3)}_${radiusM}`;
  if (_googleCache[cacheKey]) return _googleCache[cacheKey];

  const data = await googleFetch(`${GOOGLE_PLACES_URL}:searchNearby`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_API_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.rating,places.userRatingCount,places.location,places.types,places.formattedAddress'
    },
    body: JSON.stringify({
      includedTypes: ['gym', 'fitness_center'],
      locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: Math.min(radiusM, 50000) } },
      maxResultCount: 20
    })
  });

  const results = [];
  if (data && data.places) {
    data.places.forEach(p => {
      results.push({
        name: p.displayName?.text || 'Unknown Gym',
        lat: p.location?.latitude,
        lng: p.location?.longitude,
        rating: p.rating || null,
        reviewCount: p.userRatingCount || 0,
        address: p.formattedAddress || '',
        source: 'google',
        segment: guessSeg(p.displayName?.text),
        size: guessSize(p.displayName?.text),
        members: Math.round(guessSize(p.displayName?.text) * 1.1),
        est: true,
        color: segColor(guessSeg(p.displayName?.text)),
        threat: segThreat(guessSeg(p.displayName?.text)),
        brand: 'google',
        id: Math.random()
      });
    });
  }
  _googleCache[cacheKey] = results;
  return results;
}

// Enrich VERIFIED_CLUBS with Google Places data (ratings, reviews, hours)
async function enrichWithGoogle(clubs) {
  if (!_googleHasKey()) { console.warn('[Google] No API key — skipping enrichment'); return clubs; }

  setStatus('loading', 'Enrichissement Google Places...');
  let enriched = 0;
  const batchSize = 5;

  for (let i = 0; i < clubs.length; i += batchSize) {
    const batch = clubs.slice(i, i + batchSize);
    const promises = batch.map(async (c) => {
      const cacheKey = 'ts_' + c.name.toLowerCase().replace(/\s+/g, '_');
      // Check cache first
      if (googlePlacesCache[cacheKey] && (Date.now() - googlePlacesCache[cacheKey]._ts < GOOGLE_CACHE_TTL)) {
        const cached = googlePlacesCache[cacheKey];
        c.gRating = cached.rating;
        c.gReviews = cached.reviewCount;
        c.gOpen = cached.isOpen;
        c.gWebsite = cached.website;
        c.gEnriched = true;
        enriched++;
        return;
      }
      const result = await googlePlaceSearch(c.name + ' gym Bucharest');
      if (result) {
        c.gRating = result.rating;
        c.gReviews = result.reviewCount;
        c.gOpen = result.isOpen;
        c.gWebsite = result.website;
        c.gEnriched = true;
        enriched++;
      }
    });
    await Promise.all(promises);
    // Brief pause between batches to respect rate limits
    if (i + batchSize < clubs.length) await new Promise(r => setTimeout(r, 250));
  }

  setStatus('ok', `${enriched}/${clubs.length} clubs enrichis via Google Places`);
  return clubs;
}

let map, circle, radius = 2000;
let compCluster = L.markerClusterGroup({maxClusterRadius:40,spiderfyOnMaxZoom:true,showCoverageOnHover:false});
let transportLayer = L.layerGroup();
let heatLayer = null;
let sectorPolys = {};
let selectedPt = null;
let analysisCache = {};
let opCache = {};
let demo = false;
let zones = [];
let allComps = [];
let curComps = [];
let sectorSAZ = {};

// ================================================================
// BUCHAREST SECTORS — Enhanced data
// ================================================================
// ================================================================
// BUCHAREST SECTORS — PINWHEEL (non-overlapping, shared radial edges)
// ================================================================
// 6 sectors share the center point (Piața Unirii) and pairwise share
// one outer corner point with each adjacent sector. By construction
// no two sectors can overlap.
//
// Outer corners are clockwise-ordered. Each sector polygon:
//   [center, corner_in, ...outer_arc, corner_out, center]
// ================================================================
const BUCHAREST_CENTER = [44.4268, 26.1025]; // Piața Unirii
// Shared corners between adjacent sectors (clockwise from north)
const SEC_N  = [44.525, 26.115];  // S1 ↔ S2
const SEC_NE = [44.437, 26.200];  // S2 ↔ S3
const SEC_SE = [44.370, 26.145];  // S3 ↔ S4
const SEC_S  = [44.343, 26.060];  // S4 ↔ S5
const SEC_SW = [44.395, 25.960];  // S5 ↔ S6
const SEC_NW = [44.495, 25.975];  // S6 ↔ S1

const SECTORS = [
  {id:1,name:'Secteur 1',center:[44.4787,26.0655],pop:217367,area:68,
   youngPct:.43,income:'high',incomeIdx:90,rentProxy:2200,commerceIdx:85,transportIdx:90,sportIdx:82,
   desc:'Aviatorilor, Dorobanti, Floreasca, Baneasa',color:'#22c55e',
   details:'Quartier le plus aise de Bucarest. Sieges d\'ambassades, quartier d\'affaires Floreasca-Barbu Vacarescu. Population CSP+ dominante. Forte presence World Class.',
   polygon:[BUCHAREST_CENTER, SEC_NW,
            [44.510, 25.995], [44.535, 26.030], [44.545, 26.070], [44.540, 26.100],
            SEC_N, BUCHAREST_CENTER]},
  {id:2,name:'Secteur 2',center:[44.4650,26.1450],pop:291557,area:32,
   youngPct:.44,income:'medium-high',incomeIdx:65,rentProxy:1200,commerceIdx:60,transportIdx:75,sportIdx:68,
   desc:'Obor, Pantelimon, Colentina, Tei',color:'#3b82f6',
   details:'Secteur dense et mixte. Marche Obor (plus grand de Bucarest). Zone en gentrification autour du lac Tei. Bonne desserte metro M1.',
   polygon:[BUCHAREST_CENTER, SEC_N,
            [44.525, 26.140], [44.510, 26.175], [44.480, 26.200],
            SEC_NE, BUCHAREST_CENTER]},
  {id:3,name:'Secteur 3',center:[44.4050,26.1600],pop:374737,area:34,
   youngPct:.44,income:'medium',incomeIdx:50,rentProxy:1000,commerceIdx:55,transportIdx:70,sportIdx:58,
   desc:'Titan, Dristor, Vitan, Hala Laminor',color:'#eab308',
   details:'Secteur le plus peuple de Bucarest. Forte densite residentielle (grands ensembles). Quartier Titan en pleine transformation avec le projet Hala Laminor (86,300m2). Metro M1+M3.',
   polygon:[BUCHAREST_CENTER, SEC_NE,
            [44.410, 26.205], [44.390, 26.195], [44.375, 26.170],
            SEC_SE, BUCHAREST_CENTER]},
  {id:4,name:'Secteur 4',center:[44.3820,26.1020],pop:268018,area:34,
   youngPct:.42,income:'medium-low',incomeIdx:40,rentProxy:850,commerceIdx:45,transportIdx:65,sportIdx:48,
   desc:'Berceni, Tineretului, Piata Sudului',color:'#f97316',
   details:'Zone residentielle sud en croissance rapide. Grand Arena Shopping est le principal pole commercial. Desserte metro M2. Potentiel de croissance demographique eleve.',
   polygon:[BUCHAREST_CENTER, SEC_SE,
            [44.360, 26.135], [44.343, 26.100], [44.338, 26.075],
            SEC_S, BUCHAREST_CENTER]},
  {id:5,name:'Secteur 5',center:[44.4020,26.0100],pop:240288,area:30,
   youngPct:.40,income:'low',incomeIdx:25,rentProxy:700,commerceIdx:35,transportIdx:55,sportIdx:35,
   desc:'Rahova, Ferentari, Cotroceni, 13 Septembrie',color:'#ef4444',
   details:'Secteur contraste : quartier universitaire Cotroceni (CSP+) vs Ferentari (quartier defavorise). Mixite sociale forte. Opportunite limitee au segment Cotroceni uniquement.',
   polygon:[BUCHAREST_CENTER, SEC_S,
            [44.350, 26.025], [44.370, 25.985], [44.388, 25.965],
            SEC_SW, BUCHAREST_CENTER]},
  {id:6,name:'Secteur 6',center:[44.4400,26.0050],pop:324994,area:38,
   youngPct:.43,income:'medium-high',incomeIdx:62,rentProxy:1100,commerceIdx:58,transportIdx:72,sportIdx:65,
   desc:'Militari, Drumul Taberei, Crangasi',color:'#8b5cf6',
   details:'Second bassin de population. Militari Residence = plus grand quartier residentiel recent d\'Europe (~40,000 habitants). Metro M5 recemment ouvert. Fort potentiel sous-exploite en fitness.',
   polygon:[BUCHAREST_CENTER, SEC_SW,
            [44.420, 25.935], [44.450, 25.925], [44.478, 25.945],
            SEC_NW, BUCHAREST_CENTER]},
];

// ================================================================
// COMPETITORS DATABASE — Verified March 2026, cross-referenced sources
// Sources: worldclass.ro, stayfit.ro, 18gym.ro, downtownfitness.ro,
//          absolutegym.ro, salsafitgym.ro, Overpass API, Nominatim geocoding
// Total: 83 verified clubs in Bucharest metro area
// ================================================================
const COMP_DB = [
  {name:'World Class',segment:'premium',avgSize:1500,avgMembers:2000,threat:'high',color:'#ef4444',price:'46-145',clubs:34,brand:'international'},
  {name:'Stay Fit',segment:'mid',avgSize:600,avgMembers:700,threat:'medium',color:'#f97316',price:'~32',clubs:28,brand:'local'},
  {name:'StayFit',segment:'mid',avgSize:600,avgMembers:700,threat:'medium',color:'#f97316',price:'~32',clubs:28,brand:'local'},
  {name:'18GYM',segment:'mid',avgSize:500,avgMembers:600,threat:'medium',color:'#f97316',price:'~36',clubs:6,brand:'local'},
  {name:'Downtown Fitness',segment:'mid-premium',avgSize:700,avgMembers:800,threat:'medium',color:'#f97316',price:'~35',clubs:5,brand:'local'},
  {name:'Nr1 Fitness',segment:'mid',avgSize:600,avgMembers:700,threat:'medium',color:'#f97316',price:'~25',clubs:5,brand:'international'},
  {name:'BeFIT',segment:'mid-premium',avgSize:900,avgMembers:1200,threat:'medium',color:'#f97316',price:'~28',clubs:1,brand:'local'},
  {name:'Absolute',segment:'independent',avgSize:400,avgMembers:400,threat:'low',color:'#22c55e',price:'~20',clubs:3,brand:'local'},
  {name:'SalsaFit',segment:'mid',avgSize:500,avgMembers:400,threat:'low',color:'#22c55e',price:'~20',clubs:1,brand:'local'},
  {name:'CrossFit',segment:'crossfit',avgSize:280,avgMembers:180,threat:'low',color:'#22c55e',price:'~40',clubs:5,brand:'local'},
  {name:'WoW',segment:'independent',avgSize:500,avgMembers:400,threat:'low',color:'#22c55e',price:'~15',clubs:1,brand:'local'},
];

// GOOGLE REVIEWS DATABASE — Method B for member estimation
// Calibrated multiplier: 8.5x (reviews -> members)
// Calibration: WC network 84,000 members / 45 clubs / avg 219 reviews = 8.5x
// Sources: top-rated.online, citymaps.ro, wheree.com, Google Maps (March 2026)
// REVIEWS_MULT recalibrated: 16 clubs verified via citymaps.ro (March 2026)
// WC 11 verified clubs avg 475 reviews vs 1,867 members = 3.9x per review
const REVIEWS_MULT = 3.9;
const REVIEWS_DB = {
// ✓ = verified from citymaps.ro scraping (March 2026). Others = estimated.
"World Class Charles de Gaulle":{r:285,g:4.3},"World Class Downtown":{r:1041,g:4.0},/*✓*/"World Class At The Grand":{r:346,g:4.0},/*✓*/"World Class Atlantis":{r:180,g:4.4},"World Class Caro":{r:624,g:4.0}/*✓*/,"World Class InCity":{r:501,g:4.2},/*✓*/"World Class Upground":{r:282,g:4.0}/*✓*/,"World Class One Cotroceni":{r:120,g:4.5},"World Class Planet":{r:150,g:4.3},"World Class Cosmopolis":{r:65,g:4.6},"World Class Asmita Gardens":{r:332,g:3.7},/*✓*/"World Class Mega Mall":{r:500,g:3.9},"World Class Militari Shopping":{r:583,g:4.5},/*✓*/"World Class Otopeni":{r:180,g:4.0},"World Class Park Lake":{r:450,g:3.8},"World Class Titan":{r:427,g:3.7},/*✓*/"World Class AFI Cotroceni":{r:526,g:4.2},/*✓*/"World Class AFI Tech":{r:221,g:4.4}/*✓*/,"World Class America House":{r:300,g:4.0},"World Class Bucuresti Mall":{r:450,g:3.8},"World Class Campus 6":{r:100,g:4.3},"World Class Expo Park":{r:220,g:4.1},"World Class Jiului":{r:140,g:4.0},"World Class Jolie Ville":{r:200,g:4.2},"World Class Lujerului":{r:429,g:3.8},/*✓*/"World Class Plaza Romania":{r:450,g:3.8},"World Class Sudului":{r:648,g:4.4},/*✓*/"World Class Titan Park":{r:283,g:4.3},/*✓*/"World Class Sema Park":{r:150,g:4.2},"World Class Veranda":{r:350,g:3.8},"World Class Oregon Park":{r:112,g:4.6},/*✓*/"World Class Eroii Revolutiei":{r:100,g:4.3},"World Class Promenada":{r:400,g:4.0},"World Class Pipera Plaza":{r:180,g:4.1},
"Stay Fit Romana":{r:674,g:4.4},/*✓*/"Stay Fit Titulescu":{r:400,g:4.0},"Stay Fit Domenii":{r:200,g:4.1},"Stay Fit Colosseum":{r:350,g:3.9},"Stay Fit Jiului":{r:120,g:4.0},"Stay Fit Dorobanti":{r:150,g:4.3},"Stay Fit Crangasi":{r:220,g:4.0},"Stay Fit Teiul Doamnei":{r:593,g:4.5}/*✓*/,"Stay Fit Pantelimon":{r:280,g:3.8},"Stay Fit Esplanada":{r:200,g:3.9},"Stay Fit Pipera":{r:140,g:4.2},"Stay Fit Pallady":{r:160,g:3.9},"Stay Fit Vitan":{r:225,g:3.9},/*✓*/"Stay Fit Cocor":{r:501,g:4.3},/*✓*/"Stay Fit Fizicienilor":{r:180,g:4.0},"Stay Fit Petre Ispirescu":{r:120,g:3.9},"Stay Fit Rahova":{r:150,g:3.8},"Stay Fit Liberty":{r:677,g:4.2},/*✓*/"Stay Fit Grand Arena":{r:200,g:3.9},"Stay Fit Prosper":{r:140,g:4.0},"Stay Fit Ghencea":{r:60,g:4.5},
"18GYM Green Gate":{r:100,g:4.2},"18GYM Mihai Bravu":{r:90,g:4.0},"18GYM Pantelimon":{r:75,g:4.1},"18GYM Chiajna":{r:55,g:4.0},"18GYM Monaco Towers":{r:80,g:4.3},"18GYM Pipera":{r:65,g:4.1},
"Downtown Fitness Vitan":{r:543,g:4.4},/*✓*/"Downtown Fitness Mihai Bravu":{r:300,g:4.4},"Downtown Fitness Mihalache":{r:400,g:4.3},"Downtown Fitness Matei Basarab":{r:130,g:4.6},"Downtown Fitness Obor":{r:350,g:4.4},
"Nr1 Fitness Militari":{r:120,g:4.2},"Nr1 Fitness Pipera":{r:65,g:4.1},"Nr1 Fitness Ghencea":{r:80,g:4.0},"Nr1 Fitness Pantelimon":{r:55,g:4.1},"Nr1 Fitness Titan":{r:95,g:4.2},
"CrossFit Columna (Uzina)":{r:146,g:4.8}/*✓*/,"CrossFit Nord BVS":{r:45,g:4.6},"CrossFit ROA":{r:30,g:4.5},"Replay CrossFit":{r:35,g:4.6},"Groove Box":{r:25,g:4.4},
"Absolute Gym Ghencea":{r:110,g:4.3},"Absolute Gym Titan":{r:75,g:4.1},"Absolute Gym Militari":{r:60,g:4.0},
"SalsaFit AFI Cotroceni":{r:90,g:4.2},"WoWGym Fundeni":{r:70,g:4.0},"Sweat Concept Promenada":{r:45,g:4.5},"Best Fitness Gym":{r:55,g:4.1}
};

// Club age database — years since opening (as of 2026)
// Method 1: known opening date (from press releases, official sites)
// Method 2: estimated from oldest Google review date
// Method 3: brand-average estimate
const CLUB_AGE = {
  // WORLD CLASS — Source: business-review.eu, worldclass.ro, romania-insider.com
  "World Class Charles de Gaulle":11, // W concept launched 2015
  "World Class Downtown":20, // ~2006, early expansion
  "World Class At The Grand":26, // first club, opened 2000
  "World Class Atlantis":10,
  "World Class Caro":12,
  "World Class InCity":10,
  "World Class Upground":6,
  "World Class One Cotroceni":4, // One Cotroceni Park opened ~2022
  "World Class Planet":8,
  "World Class Cosmopolis":1, // opened Jan 2025
  "World Class Asmita Gardens":8,
  "World Class Mega Mall":11, // Mega Mall opened 2015
  "World Class Militari Shopping":12,
  "World Class Otopeni":8,
  "World Class Park Lake":10, // ParkLake opened 2016
  "World Class Titan":15,
  "World Class AFI Cotroceni":14, // AFI opened 2009
  "World Class AFI Tech":5,
  "World Class America House":17, // 9th club, opened ~2009
  "World Class Bucuresti Mall":18, // Bucuresti Mall opened 1999
  "World Class Campus 6":3, // recent
  "World Class Expo Park":6,
  "World Class Jiului":5,
  "World Class Jolie Ville":8,
  "World Class Lujerului":10,
  "World Class Plaza Romania":14, // Plaza Romania opened 2006
  "World Class Sudului":6,
  "World Class Titan Park":5,
  "World Class Sema Park":4,
  "World Class Veranda":8, // Veranda opened 2016
  "World Class Oregon Park":5,
  "World Class Eroii Revolutiei":2, // recent opening
  "World Class Promenada":10, // Promenada opened 2013
  "World Class Pipera Plaza":10,
  // STAY FIT — Source: stayfit.ro, morphosiscapital.com
  "Stay Fit Titulescu":14, // first club, 2012
  "Stay Fit Romana":8,
  "Stay Fit Domenii":6, // acquired Neby Fitness
  "Stay Fit Colosseum":7,
  "Stay Fit Jiului":3,
  "Stay Fit Dorobanti":3,
  "Stay Fit Crangasi":4,
  "Stay Fit Teiul Doamnei":5,
  "Stay Fit Pantelimon":4,
  "Stay Fit Esplanada":3,
  "Stay Fit Pipera":4,
  "Stay Fit Pallady":3,
  "Stay Fit Vitan":8, // opened end 2018
  "Stay Fit Cocor":7, // opened early 2019
  "Stay Fit Fizicienilor":3,
  "Stay Fit Petre Ispirescu":3,
  "Stay Fit Rahova":3,
  "Stay Fit Liberty":7, // opened mid 2019
  "Stay Fit Grand Arena":3,
  "Stay Fit Prosper":3,
  "Stay Fit Ghencea":1, // opened Feb 2025
  // 18GYM — Source: 18gym.ro (national chain from Cluj, Bucharest expansion ~2022-2024)
  "18GYM Green Gate":3,"18GYM Mihai Bravu":3,"18GYM Pantelimon":2,
  "18GYM Chiajna":2,"18GYM Monaco Towers":2,"18GYM Pipera":2,
  // DOWNTOWN FITNESS — Source: listafirme.eu CUI 33347821 = registered ~2015
  "Downtown Fitness Vitan":8,"Downtown Fitness Mihai Bravu":5,
  "Downtown Fitness Mihalache":7,"Downtown Fitness Matei Basarab":2,
  "Downtown Fitness Obor":6,
  // NR1 FITNESS — Source: outsourcing-today.ro, opened Q1 2020
  "Nr1 Fitness Militari":6,"Nr1 Fitness Pipera":4,"Nr1 Fitness Ghencea":4,
  "Nr1 Fitness Pantelimon":3,"Nr1 Fitness Titan":3,
  // OTHERS
  "CrossFit Columna (Uzina)":8,"CrossFit Nord BVS":5,"CrossFit ROA":4,
  "Replay CrossFit":4,"Groove Box":5,
  "Absolute Gym Ghencea":10,"Absolute Gym Titan":8,"Absolute Gym Militari":6,
  "SalsaFit AFI Cotroceni":6,"WoWGym Fundeni":4,
  "Sweat Concept Promenada":3,"Best Fitness Gym":5,
};

// CORRECTED Method B: reviews/year x annual multiplier
// Calibration: WC avg = 219 reviews / avg 9.5 years = 23 reviews/year
// WC avg members = 1,867 → ratio = 1,867 / 23 = 81 members per review/year
// For recent clubs (<3 years): ratio higher because early reviews are more frequent
// For old clubs (>10 years): ratio lower because review fatigue + member churn
const REVIEWS_ANNUAL_MULT = 43; // members per (review/year) — recalibrated with 16 verified review counts

function getReviewData(name, club) {
  // Priority: live Google data (gRating/gReviews) > static REVIEWS_DB
  let reviewCount, rating;
  const rv = REVIEWS_DB[name];

  if(club && club.gEnriched && club.gReviews > 0) {
    // USE LIVE GOOGLE DATA
    reviewCount = club.gReviews;
    rating = club.gRating;
  } else if(rv) {
    reviewCount = rv.r;
    rating = rv.g;
  } else {
    return null;
  }

  const age = CLUB_AGE[name] || estimateAge(name);
  const reviewsPerYear = reviewCount / Math.max(1, age);
  let ageFactor = 1.0;
  if(age <= 2) ageFactor = 0.7;
  else if(age <= 4) ageFactor = 0.85;
  else if(age >= 12) ageFactor = 1.2;
  const mB_corrected = Math.round(reviewsPerYear * REVIEWS_ANNUAL_MULT * ageFactor);
  const src = (club && club.gEnriched) ? 'google' : 'static';
  return {r: reviewCount, g: rating, age, reviewsPerYear: Math.round(reviewsPerYear*10)/10, ageFactor, mB: mB_corrected, src};
}

// Fallback age estimation when not in database
function estimateAge(name) {
  const n = name.toLowerCase();
  // Brand-based estimation
  if(n.includes('world class')) return 10; // WC average
  if(n.includes('stay fit')) return 4; // SF average (fast expansion 2022-2025)
  if(n.includes('18gym')) return 2; // recent Bucharest entries
  if(n.includes('downtown')) return 5;
  if(n.includes('nr1')) return 4;
  if(n.includes('crossfit')) return 5;
  if(n.includes('absolute')) return 7;
  return 5; // generic default
}

// Target sites from BP
// TARGETS moved to data/targets.js

// ================================================================
// VERIFIED CLUBS DATABASE — 92 clubs, geocoded via Nominatim + manual corrections
// All coordinates verified against official websites & Google Maps
// ================================================================
// Estimation method: DUAL MODEL
// Method A (primary): Surface x Ratio — calibrated on WC (84k members / 45 clubs / avg ~1,870m2 = 0.93 mbr/m2)
//   Premium with pool: 0.85 mbr/m2 | Mid-range: 1.1 mbr/m2 | Low-cost: 1.5 mbr/m2 | Independent: 0.9 mbr/m2
// Method B (cross-check): Google Reviews x 5-8 (to be added when reviews scraped)
// 'v' suffix = verified surface from official source | no suffix = estimated from tier average
// VERIFIED_CLUBS + DEMO_COMPS moved to data/clubs.js

// Metro stations (demo)
const METRO = [
  {n:'Piata Victoriei',lat:44.4527,lng:26.0855,lines:'M1,M3'},{n:'Aviatorilor',lat:44.4610,lng:26.0870,lines:'M2'},
  {n:'Piata Romana',lat:44.4460,lng:26.0970,lines:'M2'},{n:'Universitate',lat:44.4355,lng:26.1002,lines:'M1,M3'},
  {n:'Unirii',lat:44.4268,lng:26.1008,lines:'M1,M2,M3'},{n:'Tineretului',lat:44.4135,lng:26.1050,lines:'M2'},
  {n:'Piata Sudului',lat:44.4010,lng:26.1050,lines:'M2'},{n:'Titan',lat:44.4130,lng:26.1550,lines:'M1'},
  {n:'Dristor',lat:44.4200,lng:26.1320,lines:'M1,M3'},{n:'Republica',lat:44.4250,lng:26.1500,lines:'M1'},
  {n:'Politehnica',lat:44.4390,lng:26.0480,lines:'M1'},{n:'Lujerului',lat:44.4340,lng:26.0330,lines:'M1'},
  {n:'Crangasi',lat:44.4460,lng:26.0350,lines:'M1'},{n:'Basarab',lat:44.4490,lng:26.0630,lines:'M1,M4'},
  {n:'Obor',lat:44.4510,lng:26.1240,lines:'M1'},{n:'Stefan cel Mare',lat:44.4530,lng:26.1100,lines:'M2'},
  {n:'Pipera',lat:44.4790,lng:26.1130,lines:'M2'},{n:'Aurel Vlaicu',lat:44.4720,lng:26.1050,lines:'M2'},
  {n:'Baneasa',lat:44.4890,lng:26.0850,lines:'M4'},{n:'Jiului',lat:44.4610,lng:26.0690,lines:'M4'},
  {n:'Eroilor',lat:44.4325,lng:26.0710,lines:'M1,M3'},{n:'Izvor',lat:44.4325,lng:26.0820,lines:'M3'},
  {n:'Drumul Taberei 34',lat:44.4240,lng:26.0280,lines:'M5'},{n:'Romancierilor',lat:44.4190,lng:26.0200,lines:'M5'},
  {n:'Orizont',lat:44.4260,lng:26.0100,lines:'M5'},{n:'Pacii',lat:44.4310,lng:25.9930,lines:'M1'},
  {n:'Gorjului',lat:44.4300,lng:26.0080,lines:'M1'},{n:'Iancului',lat:44.4380,lng:26.1160,lines:'M1'},
  {n:'1 Mai',lat:44.4640,lng:26.0710,lines:'M3'},{n:'Pajura',lat:44.4720,lng:26.0700,lines:'M4'},
  {n:'Preciziei',lat:44.4280,lng:25.9810,lines:'M3'},{n:'Petrache Poenaru',lat:44.4420,lng:26.0460,lines:'M1'},
  {n:'Grozavesti',lat:44.4380,lng:26.0560,lines:'M1'},{n:'Timpuri Noi',lat:44.4160,lng:26.1130,lines:'M1'},
  {n:'Mihai Bravu',lat:44.4220,lng:26.1270,lines:'M1,M3'},{n:'Nicolae Grigorescu',lat:44.4170,lng:26.1510,lines:'M1,M3'},
  {n:'Costin Georgian',lat:44.4200,lng:26.1630,lines:'M1'},{n:'Piata Muncii',lat:44.4340,lng:26.1210,lines:'M1'},
  {n:'Constantin Brancoveanu',lat:44.4080,lng:26.1070,lines:'M2'},{n:'Aparatorii Patriei',lat:44.3910,lng:26.1170,lines:'M2'},
  {n:'Dimitrie Leonida',lat:44.3800,lng:26.1260,lines:'M2'},{n:'Gara de Nord',lat:44.4470,lng:26.0710,lines:'M1,M4'},
  {n:'Grivita',lat:44.4560,lng:26.0690,lines:'M4'},{n:'Parc Bazilescu',lat:44.4770,lng:26.0530,lines:'M4'},
  {n:'Laminorului',lat:44.4830,lng:26.0460,lines:'M4'},{n:'Straulesti',lat:44.4900,lng:26.0360,lines:'M4'},
  {n:'Academia Militara',lat:44.4290,lng:26.0680,lines:'M5'},{n:'Favorit',lat:44.4230,lng:26.0230,lines:'M5'},
  {n:'Tudor Vladimirescu',lat:44.4210,lng:26.0300,lines:'M5'},{n:'Parc Drumul Taberei',lat:44.4200,lng:26.0190,lines:'M5'},
  {n:'Valea Ialomitei',lat:44.4280,lng:26.0050,lines:'M5'},{n:'Brancusi',lat:44.4290,lng:25.9970,lines:'M5'},
  {n:'Raul Doamnei',lat:44.4310,lng:25.9880,lines:'M5'},
];

// ================================================================
// CARTIERE (NEIGHBORHOODS) — ~50 quartiers avec pop estimee + prix immobilier
// Sources: INS Census 2021, imobiliare.ro, investropa.com, wikipedia
// Pop estimees = pop secteur repartie par densite relative des quartiers
// Prix = EUR/m2 moyen 2025, proxy pouvoir d'achat
// ================================================================

// --- INS CENSUS 2021 — Population par tranche d'âge × secteur ---
// Source: INSSE Recensământul 2021 (Table 1.03) + Populaţia după domiciliu 01.01.2022
// Census resident pop per sector applied with domicile-based age proportions
// https://www.recensamantromania.ro/rezultate-rpl-2021/
const INS_SECTOR_AGE = {
  1: { pop: 217367, age15_19: 8930, age20_24: 7934, age25_29: 10156, age30_34: 16960, age35_39: 19557, age40_44: 19918, pct1544: 0.384 },
  2: { pop: 291557, age15_19: 11233, age20_24: 10593, age25_29: 13205, age30_34: 22255, age35_39: 25829, age40_44: 28649, pct1544: 0.383 },
  3: { pop: 374737, age15_19: 14413, age20_24: 13987, age25_29: 18676, age30_34: 32127, age35_39: 35779, age40_44: 37169, pct1544: 0.406 },
  4: { pop: 268018, age15_19: 9993, age20_24: 9560, age25_29: 13694, age30_34: 23924, age35_39: 25405, age40_44: 25825, pct1544: 0.404 },
  5: { pop: 240288, age15_19: 10646, age20_24: 10440, age25_29: 12879, age30_34: 20792, age35_39: 21595, age40_44: 22266, pct1544: 0.411 },
  6: { pop: 324994, age15_19: 12319, age20_24: 11274, age25_29: 16514, age30_34: 27547, age35_39: 30118, age40_44: 33122, pct1544: 0.403 }
};

// Compute real target population ratio for a given sector (INS-based)
function getINSTargetRatio(sectorNum) {
  const d = INS_SECTOR_AGE[sectorNum];
  if(!d) return 0.40; // fallback
  return d.pct1544;
}

// Compute real age sub-distribution within 15-44 for a sector (for persona mapping)
function getINSAgeDistribution(sectorNum) {
  const d = INS_SECTOR_AGE[sectorNum];
  if(!d) return { young: 0.20, active: 0.33, mature: 0.47 }; // fallback
  const total1544 = d.age15_19 + d.age20_24 + d.age25_29 + d.age30_34 + d.age35_39 + d.age40_44;
  return {
    young:  (d.age15_19 + d.age20_24) / total1544,        // 15-24 → Étudiants
    active: (d.age25_29 + d.age30_34) / total1544,         // 25-34 → Jeunes Actifs
    mature: (d.age35_39 + d.age40_44) / total1544           // 35-44 → Familles/CSP+
  };
}

// CARTIERE moved to data/cartiere.js

// Custom sites management — use localStorage (persists across sessions)
// Schema: { id, lat, lng, name, notes, status, rating, analysisData, __v: 1 }
// __v = schema version — bump when shape changes; migrate on load.
const CUSTOM_SITE_SCHEMA_VERSION = 1;
const CUSTOM_SITE_NAME_MAX = 80;
const CUSTOM_SITE_NOTES_MAX = 500;

// v6.41 — `let` top-level = script-scoped, PAS accessible via window depuis les
// IIFE modules (cloud-sync.js notamment). On garde le `let` pour le scope local
// mais on mirror systématiquement sur `window.customSites` à chaque réassignation
// pour que cloud-sync puisse lire/muter la liste. Les .push/.pop mutent l'array
// en place donc restent visibles des deux côtés sans mirror additionnel.
let customSites = [];
window.customSites = customSites;

/** Load + migrate custom sites from localStorage. Quarantine corrupted entries. */
function _loadCustomSites() {
  const raw = (typeof safeStorage !== 'undefined') ? safeStorage.get('fpCustomSites', []) : (function(){
    try { return JSON.parse(localStorage.getItem('fpCustomSites') || '[]'); } catch { return []; }
  })();
  if (!Array.isArray(raw)) { customSites = []; window.customSites = customSites; return; }
  customSites = raw.filter(s => s && isFinite(s.lat) && isFinite(s.lng)).map(migrateCustomSite);
  window.customSites = customSites; // v6.41 — keep window mirror in sync
}

function migrateCustomSite(site) {
  // v0 (no __v) → v1: strip HTML from name/notes, add __v, ensure status default
  if (!site.__v || site.__v < 1) {
    site.name   = sanitizeText(site.name, CUSTOM_SITE_NAME_MAX) || ('Site ' + (site.id || ''));
    site.notes  = sanitizeText(site.notes, CUSTOM_SITE_NOTES_MAX);
    site.status = site.status || 'prospect';
    site.__v    = 1;
  }
  // v6.38 — CRDT fields for cross-device sync
  const now = Date.now();
  if (!site.updatedAt) site.updatedAt = site.createdAt || now;
  if (!site.createdAt) site.createdAt = site.updatedAt;
  if (site.deletedAt === undefined) site.deletedAt = null;
  if (!site.createdBy) site.createdBy = null; // legacy sites = unknown author
  return site;
}
window.migrateCustomSite = migrateCustomSite;

/** Strip control chars + tags from user-supplied text. Does NOT HTML-escape — use escapeHtml() at render. */
function sanitizeText(s, maxLen) {
  if (s == null) return '';
  return String(s).replace(/<[^>]*>/g, '').replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, maxLen || 500);
}

/**
 * Validate + add a custom site. Returns the site, or null on validation failure.
 * @param {number} lat in [-90, 90]
 * @param {number} lng in [-180, 180]
 * @param {string} [name]
 * @param {string} [notes]
 */
function addCustomSite(lat, lng, name, notes) {
  const latN = Number(lat), lngN = Number(lng);
  if (!isFinite(latN) || latN < -90 || latN > 90) {
    window.showToast?.('Latitude invalide (doit être entre -90 et 90)', 'error', { title: 'Site non ajouté' });
    return null;
  }
  if (!isFinite(lngN) || lngN < -180 || lngN > 180) {
    window.showToast?.('Longitude invalide (doit être entre -180 et 180)', 'error', { title: 'Site non ajouté' });
    return null;
  }
  const liveCount = customSites.filter(s => !s.deletedAt).length;
  const cleanName  = sanitizeText(name,  CUSTOM_SITE_NAME_MAX)  || ('Site ' + (liveCount + 1));
  const cleanNotes = sanitizeText(notes, CUSTOM_SITE_NOTES_MAX);

  const now = Date.now();
  const site = {
    id: now,
    lat: latN, lng: lngN,
    name: cleanName, notes: cleanNotes,
    status: 'prospect', rating: null, analysisData: null,
    createdBy: (currentUser?.email || '').toLowerCase().trim() || null, // v6.40 — window.currentUser absent (script-scoped let), lire la var directement
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    __v: CUSTOM_SITE_SCHEMA_VERSION
  };
  customSites.push(site);
  const saved = (typeof safeStorage !== 'undefined')
    ? safeStorage.set('fpCustomSites', customSites)
    : (function(){ try { localStorage.setItem('fpCustomSites', JSON.stringify(customSites)); return true; } catch { return false; } })();
  if (!saved) {
    customSites.pop();
    window.showToast?.('Impossible de sauvegarder (stockage plein ?). Supprime d\'anciens sites.', 'error', { title: 'Stockage' });
    return null;
  }
  renderCustomSites();
  refreshCustomMarkers(); // re-render avec numérotation continue (v6.32)
  window.cloudSync?.pushNow(); // v6.39: push immédiat (évite que mobile ferme l'app avant debounce)
  window._fpMobileRefreshSites?.(); // v6.37: sync mobile pins quand desktop ajoute
  try { window.AuditLog?.log({ action: 'site.add', target: cleanName, siteKey: latN.toFixed(3) + ',' + lngN.toFixed(3), meta: { notes: cleanNotes, status: 'prospect' } }); } catch {}
  return site;
}

// ────────────────────────────────────────────────────────────────────
// Cross-device sync (v6.28): Export/Import JSON via clipboard + URL.
// localStorage est isolé par device → sans backend, sync = manuel via copie.
// Format: JSON array de sites (compat fpCustomSites format brut). Base64
// pour URL safe (?import=<b64>).
// ────────────────────────────────────────────────────────────────────
async function exportCustomSites() {
  if (!customSites.length) { alert('Aucun site custom à exporter.'); return; }
  const json = JSON.stringify(customSites, null, 2);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  const url = location.origin + location.pathname + '?import=' + b64;
  const choice = prompt(
    `${customSites.length} site(s) prêt(s) à exporter.\n\n` +
    `Choisis ton mode :\n` +
    `  1 = Copier le JSON brut (paste dans "Importer" sur autre device)\n` +
    `  2 = Copier l'URL (ouvre l'URL sur autre device → import auto)\n\n` +
    `Tape 1 ou 2 :`,
    '2'
  );
  let payload, label;
  if (choice === '1') { payload = json; label = 'JSON'; }
  else if (choice === '2') { payload = url; label = 'URL'; }
  else return;
  try {
    await navigator.clipboard.writeText(payload);
    alert(`${label} copié dans le presse-papier ✓\n\nColle-le sur l'autre device pour récupérer tes sites.`);
  } catch (e) {
    prompt(`Copie manuelle (presse-papier indispo) — sélectionne tout puis copie :`, payload);
  }
}

function importCustomSitesPrompt() {
  const raw = prompt('Colle ici le JSON exporté (ou l\'URL ?import=…) :');
  if (!raw) return;
  let payload = raw.trim();
  // Si c'est une URL avec ?import=…, extraire le base64
  const m = payload.match(/[?&]import=([A-Za-z0-9+/=]+)/);
  if (m) {
    try { payload = decodeURIComponent(escape(atob(m[1]))); }
    catch { alert('URL invalide (base64 corrompu).'); return; }
  }
  try {
    const list = JSON.parse(payload);
    if (!Array.isArray(list)) throw new Error('format invalide (pas un array)');
    importCustomSites(list);
  } catch (e) {
    alert('Import échoué : ' + e.message);
  }
}

function importCustomSites(list) {
  // Merge avec dédoublonnage par lat/lng (4 décimales) — évite duplicates
  // si l'user importe 2x le même set.
  const existing = new Set(customSites.map(s => Number(s.lat).toFixed(4) + ',' + Number(s.lng).toFixed(4)));
  let added = 0, skipped = 0;
  for (const s of list) {
    if (!s || !isFinite(s.lat) || !isFinite(s.lng)) { skipped++; continue; }
    const key = Number(s.lat).toFixed(4) + ',' + Number(s.lng).toFixed(4);
    if (existing.has(key)) { skipped++; continue; }
    customSites.push(migrateCustomSite({...s, id: s.id || (Date.now() + Math.floor(Math.random()*1000))}));
    existing.add(key);
    added++;
  }
  if (typeof safeStorage !== 'undefined') safeStorage.set('fpCustomSites', customSites);
  else try { localStorage.setItem('fpCustomSites', JSON.stringify(customSites)); } catch {}
  renderCustomSites();
  refreshCustomMarkers();
  window.cloudSync?.pushNow(); // v6.39
  window._fpMobileRefreshSites?.(); // v6.37
  alert(`Import terminé ✓\n${added} site(s) ajouté(s)${skipped ? ` · ${skipped} doublon(s)/invalide(s) ignoré(s)` : ''}.`);
}

// Auto-import au boot si ?import=base64 dans l'URL.
// Différé pour s'assurer que customSites est chargé.
(function autoImportFromURL() {
  try {
    const params = new URLSearchParams(location.search);
    const b64 = params.get('import');
    if (!b64) return;
    setTimeout(() => {
      try {
        const json = decodeURIComponent(escape(atob(b64)));
        const list = JSON.parse(json);
        if (!Array.isArray(list) || !list.length) return;
        if (confirm(`Importer ${list.length} site(s) depuis l'URL ?\n(Ils seront ajoutés à tes sites existants, sans écrasement.)`)) {
          importCustomSites(list);
        }
        // Cleanup URL pour éviter ré-import au prochain hard refresh
        history.replaceState({}, '', location.pathname + location.hash);
      } catch (e) { console.warn('[autoImport] failed:', e); }
    }, 1800);
  } catch {}
})();

function removeCustomSite(id) {
  // v6.38 — soft delete (tombstone): le site reste en localStorage avec
  // deletedAt, ce qui permet de propager la suppression sur les autres devices
  // via cloud sync CRDT. Les tombstones sont purgés automatiquement après 30j
  // (cloud-sync.js purgeOldTombstones). L'affichage filtre les tombstones.
  const idStr = String(id);
  const site = customSites.find(s => String(s.id) === idStr);
  if (!site) return;
  site.deletedAt = Date.now();
  site.updatedAt = site.deletedAt;
  if (typeof safeStorage !== 'undefined') safeStorage.set('fpCustomSites', customSites);
  else try { localStorage.setItem('fpCustomSites', JSON.stringify(customSites)); } catch {}
  // Clean up orphaned overrides for the deleted site.
  if (isFinite(site.lat) && isFinite(site.lng)) {
    const key = site.lat.toFixed(3) + ',' + site.lng.toFixed(3);
    if (window._rentOverrides)    delete window._rentOverrides[key];
    if (window._chargeOverrides)  delete window._chargeOverrides[key];
    if (window._surfaceOverrides) delete window._surfaceOverrides[key];
    window.persistOverrides?.();
  }
  renderCustomSites();
  refreshCustomMarkers();
  window.cloudSync?.pushNow(); // v6.39
  window._fpMobileRefreshSites?.(); // v6.37
  try { window.AuditLog?.log({ action: 'site.remove', target: site.name, siteKey: Number(site.lat).toFixed(3) + ',' + Number(site.lng).toFixed(3) }); } catch {}
}

function qualifyCustomSite(id, status, rating) {
  const idStr = String(id);
  const site = customSites.find(s => String(s.id) === idStr);
  if (!site) return;
  const prevStatus = site.status;
  site.status = status;
  site.rating = rating;
  site.updatedAt = Date.now(); // v6.38 CRDT
  if (typeof safeStorage !== 'undefined') safeStorage.set('fpCustomSites', customSites);
  else try { localStorage.setItem('fpCustomSites', JSON.stringify(customSites)); } catch {}
  renderCustomSites();
  refreshCustomMarkers();
  window.cloudSync?.pushNow(); // v6.39
  window._fpMobileRefreshSites?.(); // v6.37
  try { window.AuditLog?.log({ action: 'site.qualify', target: site.name, siteKey: Number(site.lat).toFixed(3) + ',' + Number(site.lng).toFixed(3), field: 'status', before: prevStatus, after: status }); } catch {}
}

let customMarkersLayer = L.layerGroup();

// v6.55 — flag pour re-render les custom markers quand fp-logos.js est chargé
// (les premiers rendus pendant le boot utilisent un fallback HTML).
let _pendingCustomMarkers = false;
window.addEventListener('fp:logos-ready', () => {
  try {
    if (typeof renderTargetPinsDesktop === 'function') renderTargetPinsDesktop();
    if (_pendingCustomMarkers && typeof refreshCustomMarkers === 'function') {
      refreshCustomMarkers();
      _pendingCustomMarkers = false;
    }
  } catch (e) { console.warn('[fp:logos-ready] re-render failed:', e); }
});

function addCustomSiteMarker(site, displayNum) {
  // v6.55 — si fp-logos.js pas loadé, re-render plus tard via listener
  // fp:logos-ready (pas de retry ici car pourrait spammer sur imports batch).
  if (typeof window.fpLogoPinHTML !== 'function') {
    _pendingCustomMarkers = true; // flag: refreshCustomMarkers quand ready
  }
  // v6.48 — pin blanc stylisé FP (remplace ancien pin doré numéroté).
  // Logo FP + swoosh jaune centrés dans cercle blanc, badge numéro en coin.
  const palette = {
    prospect:  { light: '#f3c44f', dark: '#d4a017' },
    shortlist: { light: '#f3c44f', dark: '#d4a017' },
    validated: { light: '#34d399', dark: '#10b981' },
    rejected:  { light: '#f87171', dark: '#ef4444' },
  };
  const p = palette[site.status] || palette.prospect;
  const c = p.dark; // for popup status color
  const esc = (typeof escapeHtml === 'function') ? escapeHtml : (s => String(s||''));
  const num = displayNum != null ? displayNum : null;
  const pinHtml = (typeof window.fpLogoPinHTML === 'function')
    ? window.fpLogoPinHTML({ size: 48, num })
    : `<div style="width:48px;height:48px;background:#f3f4f6;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:900;color:#1f2937">FP${num != null ? ' '+num : ''}</div>`;
  const icon = L.divIcon({ className:'', html: pinHtml, iconSize:[56,56], iconAnchor:[28,28] });
  const mk=L.marker([site.lat,site.lng],{icon,draggable:false});
  // XSS-safe: user-supplied name/notes are escapeHtml'd before injection.
  // v6.43 — lien "Supprimer" dans le popup pour delete direct depuis la carte
  // (plus rapide qu'aller dans l'onglet "Mes sites"). confirmDeleteCustomSite
  // fait le confirm() natif + removeCustomSite(id) (soft-delete + push cloud).
  mk.bindPopup(`<h3>${esc(site.name)}</h3>
    <div class="ps"><span>Statut</span><span class="pv" style="color:${c}">${esc(site.status)}</span></div>
    <div class="ps"><span>Notes</span><span class="pv">${esc(site.notes) || '-'}</span></div>
    <div style="margin-top:8px;display:flex;justify-content:space-between;gap:8px;align-items:center">
      <a href="#" onclick="analyzeCustomSite(${Number(site.id)});return false" style="color:#d4a017;font-size:11px;font-weight:600">Analyser ce site &rarr;</a>
      <a href="#" onclick="confirmDeleteCustomSite(${Number(site.id)});return false" style="color:#f87171;font-size:11px;font-weight:600" title="Supprimer ce site">&#10005; Supprimer</a>
    </div>
  `);
  mk.siteId = site.id;
  customMarkersLayer.addLayer(mk);
}

// v6.43 — wrapper avec confirm() pour le lien "Supprimer" dans le popup Leaflet
// du pin custom. Appelle removeCustomSite (soft-delete + push cloud + UI refresh).
function confirmDeleteCustomSite(id) {
  const idStr = String(id);
  const site = customSites.find(s => String(s.id) === idStr);
  if (!site) { alert('Site introuvable. Rechargez la page.'); return; }
  if (!confirm(`Supprimer "${site.name}" ?\n\nLe site sera retiré de cet appareil et de tous tes autres appareils (iPhone, Mac…).`)) return;
  removeCustomSite(idStr);
  // Ferme le popup Leaflet ouvert (sinon il reste affiché sur un site qui n'existe plus)
  try { map?.closePopup?.(); } catch {}
}
window.confirmDeleteCustomSite = confirmDeleteCustomSite;

function refreshCustomMarkers() {
  customMarkersLayer.clearLayers();
  // Numérotation continue après TARGETS: pin 1-5 = TARGETS, pin 6+ = custom (v6.32).
  // v6.38: filtre les tombstones (deletedAt) — ne render que les sites vivants.
  // v6.70.1 — anti-doublons visuels (bug "logos FP en double", Paul):
  //   - custom à <150m d'un TARGET (ex: "Hala Laminor" ajouté via autocomplete)
  //     → le pin TARGET représente déjà le lieu, on ne rend pas un 2e logo
  //   - deux customs à <50m (ajouts multi-device avant sync) → 1er seulement
  //   La numérotation reste alignée sur la liste "Mes sites" (index conservé).
  const startNum = (typeof TARGETS !== 'undefined' ? TARGETS.length : 0) + 1;
  const live = customSites.filter(s => !s.deletedAt);
  const rendered = [];
  live.forEach((s, i) => {
    const nearTarget = (typeof TARGETS !== 'undefined')
      && TARGETS.some(t => haversine(t.lat, t.lng, s.lat, s.lng) < 150);
    const nearRendered = rendered.some(r => haversine(r.lat, r.lng, s.lat, s.lng) < 50);
    if (nearTarget || nearRendered) return;
    rendered.push(s);
    addCustomSiteMarker(s, startNum + i);
  });
}
window.refreshCustomMarkers = refreshCustomMarkers;

// v6.47 — fonction unifiée pour analyser n'importe quel site (TARGET ou custom).
// Avant: TARGETS → flyTarget(lat,lng) qui volait juste la map sans analyser.
//        Customs → analyzeCustomSite(id) qui analysait. Incohérent côté UX.
// Après: les deux passent par analyzeSiteAt → même flow (switchTab + loading +
// onMapClick pour SAZ/concurrents + runSiteAnalysis pour captage/P&L + sliders).
async function analyzeSiteAt(siteLike) {
  if (!siteLike || !isFinite(siteLike.lat) || !isFinite(siteLike.lng)) {
    console.error('analyzeSiteAt: site invalide', siteLike);
    return;
  }
  try { window.AuditLog?.log({ action: 'site.analyze', target: siteLike.name || 'Site', siteKey: Number(siteLike.lat).toFixed(3) + ',' + Number(siteLike.lng).toFixed(3) }); } catch {}
  // v6.65.3 — bascule le layout en mode data-centric : sidebar élargie, map réduite.
  try { setAnalyzingLayout(true); } catch {}
  switchTab('mysites');
  const card = el('siteAnalysisCard');
  if (card) {
    card.style.display = 'block';
    if (el('siteAnalysisContent')) {
      el('siteAnalysisContent').innerHTML = `<div style="text-align:center;padding:30px;color:var(--gray2)"><div class="spinner" style="margin:0 auto 10px"></div>Analyse en cours de <b>${(typeof escapeHtml==='function' ? escapeHtml(siteLike.name||'') : (siteLike.name||''))}</b>...</div>`;
    }
  }
  map.flyTo([siteLike.lat, siteLike.lng], 14);
  setTimeout(async () => {
    try { await onMapClick({ latlng: { lat: siteLike.lat, lng: siteLike.lng } }); } catch (e) { console.log('Map click:', e); }
    try { await runSiteAnalysis(siteLike); } catch (e) {
      console.error('Analysis error:', e);
      if (el('siteAnalysisContent')) el('siteAnalysisContent').innerHTML = '<div style="color:var(--red);padding:10px">Erreur: ' + e.message + '</div>';
    }
    switchTab('mysites');
    setTimeout(() => {
      const c = el('siteAnalysisCard');
      if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 300);
  }, 800);
}
window.analyzeSiteAt = analyzeSiteAt;

function analyzeCustomSite(id) {
  const idStr = String(id);
  const site = customSites.find(s => String(s.id) === idStr);
  if(!site) { console.error('Site not found:', id, customSites); alert('Site introuvable. Rechargez la page.'); return; }
  analyzeSiteAt(site);
}

// v6.47 — pour TARGETS (index dans TARGETS). Remplace flyTarget dans les vignettes.
function analyzeTargetByIdx(idx) {
  if (typeof TARGETS === 'undefined' || !TARGETS[idx]) return;
  analyzeSiteAt(TARGETS[idx]);
}
window.analyzeTargetByIdx = analyzeTargetByIdx;

// Find nearest cartier for a point
function findCartier(lat,lng) {
  let best=null,bd=Infinity;
  CARTIERE.forEach(c=>{
    const d=haversine(lat,lng,c.lat,c.lng);
    if(d<bd){bd=d;best=c}
  });
  return bd<2000?best:null;
}

// Neighborhood-level population estimate in radius
function estimatePopInRadiusGranular(lat,lng,r) {
  let totalPop=0,totalTarget=0,avgPrice=0,priceCount=0;
  CARTIERE.forEach(c=>{
    const d=haversine(lat,lng,c.lat,c.lng);
    // Use real INS age ratio per sector instead of hardcoded c.young
    const targetRatio = getINSTargetRatio(c.sector);
    if(d<=r) {
      totalPop+=c.pop;
      totalTarget+=Math.round(c.pop*targetRatio);
      avgPrice+=c.price;priceCount++;
    } else if(d<=r*1.5) {
      // Partial overlap — weighted by distance
      const weight=Math.max(0,1-(d-r)/(r*0.5));
      totalPop+=Math.round(c.pop*weight);
      totalTarget+=Math.round(c.pop*targetRatio*weight);
      avgPrice+=c.price;priceCount++;
    }
  });
  // Apply real population factor (census 1.72M but real ~2.9M = x1.7)
  totalPop = Math.round(totalPop * POP_REAL_FACTOR);
  totalTarget = Math.round(totalTarget * POP_REAL_FACTOR);
  return {pop:totalPop,target:totalTarget,avgPrice:priceCount>0?Math.round(avgPrice/priceCount):0};
}

// Revenue scenario modeling per zone
function revenueScenarios(popTarget,nbCompetitors,avgPrice,lat,lng) {
  // REVISED penetration model — FP is a NEW premium low-cost concept in Romania
  // FP advantage: international franchise, best price/quality ratio, brand new equipment
  // Romania fitness penetration: 5% national → 10-15% urban Bucharest potential
  // FP at 28 EUR/month = BELOW all mid-range competitors = massive market creation

  // Base penetration by income zone (price proxy)
  let basePenetration;
  if(avgPrice > 2000) basePenetration = 0.15;      // premium area: high willingness to pay
  else if(avgPrice > 1500) basePenetration = 0.12;  // medium-high
  else if(avgPrice > 1000) basePenetration = 0.10;  // medium
  else basePenetration = 0.07;                       // lower income

  // FLUX BONUS: foot traffic generators multiply penetration
  // A club in a 86,000m2 mall with metro access is NOT the same as a standalone
  let fluxBonus = 1.0;
  if(lat && lng) {
    const poi = poisInRadius(lat, lng, 1500);
    // Mall proximity = massive walk-in traffic
    if(poi.malls.length > 0) fluxBonus += 0.3;
    // Office workers = lunchtime/afterwork members
    if(poi.totalEmployees > 10000) fluxBonus += 0.25;
    else if(poi.totalEmployees > 3000) fluxBonus += 0.15;
    // University students = high conversion 18-25
    if(poi.totalStudents > 10000) fluxBonus += 0.2;
    else if(poi.totalStudents > 3000) fluxBonus += 0.1;
    // Metro station within 500m = accessibility boost
    const nearMetro = METRO.some(m => haversine(lat,lng,m.lat,m.lng) < 500);
    if(nearMetro) fluxBonus += 0.15;
  }

  // FP brand premium: international franchise entering underserved market = demand creation
  const brandPremium = 1.25; // FP creates 25% more demand than local brand would

  // Competition adjustment: less aggressive than before (FP ADDS to market, not just steals)
  const competitorImpact = nbCompetitors > 0 ? Math.max(0.5, 1 - nbCompetitors * 0.03) : 1;

  const effectivePenetration = basePenetration * fluxBonus * brandPremium * competitorImpact;

  const realistic = Math.round(popTarget * effectivePenetration);
  const pessimistic = Math.round(realistic * 0.65);
  const optimistic = Math.round(realistic * 1.4);

  const capMembers = n => n; // no cap — let model show full potential
  const monthlyARPU = getPanierMoyenHT(); // Uses blended ARPU (base + VAD premium/ultimate)

  // v6.46 — facturation 4 sem = 13 périodes/an (cf PNL_DEFAULTS.billingPeriodsPerYear)
  const periodsPerYear = (typeof PNL_DEFAULTS !== 'undefined' && PNL_DEFAULTS.billingPeriodsPerYear) || 13;
  return {
    pessimistic: {members:capMembers(pessimistic), ca:Math.round(capMembers(pessimistic)*monthlyARPU*periodsPerYear/1000)},
    realistic: {members:capMembers(realistic), ca:Math.round(capMembers(realistic)*monthlyARPU*periodsPerYear/1000)},
    optimistic: {members:capMembers(optimistic), ca:Math.round(capMembers(optimistic)*monthlyARPU*periodsPerYear/1000)},
    penetration: (effectivePenetration*100).toFixed(1),
    fluxBonus: Math.round(fluxBonus*100),
    breakeven: capMembers(realistic) >= 2800 ? 'OUI' : capMembers(realistic) >= 2000 ? 'POSSIBLE' : 'NON'
  };
}

// Cannibalization analysis between sites
async function cannibalizeRisk(site1,site2) {
  const dist = haversine(site1.lat,site1.lng,site2.lat,site2.lng);

  // Try Google Distance Matrix for real driving time
  let driveMins = null;
  if(_googleHasKey()) {
    try {
      const resp = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOGLE_API_KEY,
          'X-Goog-FieldMask': 'routes.duration' },
        body: JSON.stringify({
          origin: { location: { latLng: { latitude: site1.lat, longitude: site1.lng } } },
          destination: { location: { latLng: { latitude: site2.lat, longitude: site2.lng } } },
          travelMode: 'DRIVE'
        })
      });
      const data = await resp.json();
      if(data.routes?.[0]?.duration) driveMins = Math.round(parseInt(data.routes[0].duration.replace('s',''))/60);
    } catch(e) {}
  }

  // Population overlap via CARTIERE
  const cart1 = CARTIERE.filter(c => haversine(site1.lat, site1.lng, c.lat, c.lng) <= 3000);
  const cart2 = CARTIERE.filter(c => haversine(site2.lat, site2.lng, c.lat, c.lng) <= 3000);
  const names1 = new Set(cart1.map(c => c.name));
  const names2 = new Set(cart2.map(c => c.name));
  const sharedCartiere = cart1.filter(c => names2.has(c.name));
  const pop1 = cart1.reduce((a,c) => a + c.pop, 0);
  const pop2 = cart2.reduce((a,c) => a + c.pop, 0);
  const popShared = sharedCartiere.reduce((a,c) => a + c.pop, 0);
  const overlapPct1 = pop1 > 0 ? Math.round(popShared / pop1 * 100) : 0;
  const overlapPct2 = pop2 > 0 ? Math.round(popShared / pop2 * 100) : 0;
  const overlapData = { pop1, pop2, popShared, overlapPct1, overlapPct2, sharedCartiere: sharedCartiere.map(c=>c.name) };

  // Use driving time if available, else haversine distance
  let result;
  if(driveMins !== null) {
    if(driveMins > 15) result = {risk:'faible',pct:0,dist,driveMins};
    else if(driveMins > 10) result = {risk:'modere',pct:Math.round((1-driveMins/15)*30),dist,driveMins};
    else if(driveMins > 5) result = {risk:'significatif',pct:Math.round((1-driveMins/15)*50),dist,driveMins};
    else result = {risk:'critique',pct:Math.round((1-driveMins/10)*70),dist,driveMins};
  } else {
    // Fallback: haversine
    if(dist > 5000) result = {risk:'faible',pct:0,dist};
    else if(dist > 3000) result = {risk:'modere',pct:Math.round((1-dist/5000)*30),dist};
    else if(dist > 1500) result = {risk:'significatif',pct:Math.round((1-dist/5000)*50),dist};
    else result = {risk:'critique',pct:Math.round((1-dist/3000)*70),dist};
  }

  // Attach overlap data
  result.overlap = overlapData;
  return result;
}

// ================================================================
// POI DATABASE — Universities, Malls, Offices, Residential
// Sources: Nominatim geocoding, official websites, INS Romania
// ================================================================
// POIS moved to data/pois.js

let poiLayer = L.layerGroup();

// ================================================================
// INIT
// ================================================================
let mapInitialized = false;
function init() {
  if(mapInitialized) return;
  mapInitialized = true;
  // Google API key check
  if (!_googleHasKey()) {
    console.warn('[Google API] No API key configured. Set GOOGLE_API_KEY in source to enable Google Places, Geocoding, and Nearby Search. Using Nominatim/Overpass fallbacks.');
  } else {
    console.log('[Google API] Key detected — Google Places, Geocoding, and Nearby Search active');
  }
  map = L.map('map',{center:BUCHAREST,zoom:12,zoomControl:false,attributionControl:false});
  // Expose Leaflet map instance globally so out-of-IIFE modules (src/mobile.js, etc.) can use it.
  // `window.map` would otherwise be the #map DIV (auto-exposed by browsers).
  window._fpMap = map;
  window.dispatchEvent(new CustomEvent('fp:map-ready', { detail: { map } }));
  L.control.zoom({position:'topright'}).addTo(map);
  L.control.attribution({position:'bottomright',prefix:false}).addTo(map).addAttribution('&copy; OSM &copy; CARTO');

  // Map tile layers
  const tileDark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{maxZoom:19});
  const tileSatellite = L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',{maxZoom:20,attribution:'&copy; Google'});
  const tileStreet = L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',{maxZoom:20,attribution:'&copy; Google'});
  const tileHybrid = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',{maxZoom:20,attribution:'&copy; Google'});
  let currentTile = tileDark;
  tileDark.addTo(map);

  // Tile selector control
  const tileCtrl = L.control({position:'bottomright'});
  tileCtrl.onAdd = function(){
    const div = L.DomUtil.create('div','tile-selector');
    div.innerHTML = `
      <button class="tile-btn active" data-tile="dark" title="Dark">🌙</button>
      <button class="tile-btn" data-tile="satellite" title="Satellite">🛰️</button>
      <button class="tile-btn" data-tile="street" title="Street">🗺️</button>
      <button class="tile-btn" data-tile="hybrid" title="Hybrid">🌐</button>
    `;
    div.style.cssText = 'display:flex;gap:3px;background:rgba(17,24,39,.85);padding:4px 6px;border-radius:8px;border:1px solid rgba(71,85,115,.35);backdrop-filter:blur(8px)';
    div.querySelectorAll('.tile-btn').forEach(btn => {
      btn.style.cssText = 'width:28px;height:28px;border:1px solid transparent;border-radius:6px;background:transparent;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;transition:all .2s';
      btn.addEventListener('click', function(e){
        L.DomEvent.stopPropagation(e);
        const tiles = {dark:tileDark,satellite:tileSatellite,street:tileStreet,hybrid:tileHybrid};
        map.removeLayer(currentTile);
        currentTile = tiles[this.dataset.tile];
        currentTile.addTo(map);
        currentTile.bringToBack();
        div.querySelectorAll('.tile-btn').forEach(b=>b.style.borderColor='transparent');
        this.style.borderColor='var(--accent)';
      });
    });
    div.querySelector('[data-tile="dark"]').style.borderColor='var(--accent)';
    L.DomEvent.disableClickPropagation(div);
    return div;
  };
  tileCtrl.addTo(map);

  map.addLayer(compCluster);
  map.addLayer(transportLayer);
  map.addLayer(poiLayer);

  drawSectors();
  renderSectorList();
  renderTargets();
  initCharts();
  initTabs();
  initSearch();
  // v7.02 — chips de marques construites DÈS le boot (base vérifiée) : la
  // boîte « Filtrer concurrents » n'est plus jamais vide sur Explorer/Concurrence.
  try { buildBrandFilters(); } catch {}

  // ─── Pre-compute Monte Carlo pour Hala Laminor (~200ms, idle-time) ─────
  // Utilisé par le tour BP (slide Monte Carlo) pour afficher des chiffres
  // réels (pas inventés). Mis en cache dans window._fpMonteCarloHL.
  // Requête idle pour ne pas bloquer le boot critique.
  const _runHlMonteCarlo = () => {
    try {
      if (typeof TARGETS === 'undefined' || !TARGETS[0]) return;
      const hl = TARGETS[0]; // Hala Laminor = flagship
      const result = runCaptageAnalysis(hl.lat, hl.lng, 3000);
      if (result && result.monteCarlo) {
        window._fpMonteCarloHL = { siteName: hl.name, ...result.monteCarlo };
        console.log('[FP] Monte Carlo Hala Laminor ready:', window._fpMonteCarloHL.irr?.p50 + '% médian');
      }
    } catch(e) { console.warn('[FP] Monte Carlo HL failed:', e); }
  };
  if ('requestIdleCallback' in window) requestIdleCallback(_runHlMonteCarlo, { timeout: 3000 });
  else setTimeout(_runHlMonteCarlo, 1500);

  // Calibrate initial zoom: fitBounds over all TARGETS + padding that accounts
  // for mobile chrome (top bar 56px, peek sheet 168px) vs desktop sidebar.
  // This guarantees the 5 sites are always visible without user action.
  function calibrateInitialView() {
    try {
      if (typeof TARGETS === 'undefined' || !TARGETS.length) return;
      const bounds = L.latLngBounds(TARGETS.map(t => [t.lat, t.lng]));
      const isMobile = window.innerWidth <= 768;
      const padTop = isMobile ? 80 : 40;
      const padBottom = isMobile ? 200 : 40; // extra for bottom sheet
      const padLR = 40;
      map.fitBounds(bounds, {
        paddingTopLeft:     [padLR, padTop],
        paddingBottomRight: [padLR, padBottom],
        animate: false,
        maxZoom: 13
      });
    } catch (e) { console.warn('[FP] calibrateInitialView failed:', e); }
  }
  calibrateInitialView();
  // Re-calibrate on resize/orientation change
  let _calibT;
  window.addEventListener('resize', () => {
    clearTimeout(_calibT);
    _calibT = setTimeout(() => { map.invalidateSize(); calibrateInitialView(); }, 250);
  });
  window.addEventListener('orientationchange', () => setTimeout(() => {
    map.invalidateSize(); calibrateInitialView();
  }, 300));

  map.on('click', function(e) {
    if(addingSite) {
      addingSite = false;
      map.getContainer().style.cursor = analysisMode ? 'crosshair' : '';
      setStatus('ok','APIs connectees'+(_googleHasKey()?' + Google':''));
      const name = prompt('Nom du site :', 'Site '+(customSites.length+1)) || 'Site '+(customSites.length+1);
      const notes = prompt('Notes (optionnel) :', '') || '';
      const site = addCustomSite(e.latlng.lat, e.latlng.lng, name, notes);
      switchTab('mysites');
      runSiteAnalysis(site);
      return;
    }
    // Auto-trigger analysis sur les tabs dédiés à l'analyse d'un point de carte
    // (Concurrence + Fiche Site) même sans avoir activé Mode analyse — l'user
    // est là pour ça, pas besoin de toggle intermédiaire. Tab Explorer garde le
    // toggle pour éviter les clics accidentels pendant la navigation.
    const activeTab = document.querySelector('.tab.active')?.dataset?.tab;
    const autoAnalyzeTabs = ['compete', 'site'];
    if(!analysisMode && !autoAnalyzeTabs.includes(activeTab)) return;
    onMapClick(e);
  });
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){
      if(addingSite){addingSite=false;map.getContainer().style.cursor=analysisMode?'crosshair':'';setStatus('ok','APIs connectees'+(_googleHasKey()?' + Google':''));return}
      if(analysisMode){toggleAnalysisMode();return}
      closePanel();
    }
  });

  // Custom sites layer + restore
  map.addLayer(customMarkersLayer);
  refreshCustomMarkers();
  renderCustomSites();

  // Restore cache
  try{const c=sessionStorage.getItem('opCache');if(c){opCache=JSON.parse(c);updCache()}}catch(e){}

  // Auto-analyze all TARGETS when model version changes (cache was cleared)
  if(window._pendingAutoAnalyze) {
    window._pendingAutoAnalyze = false;
    console.log('[Auto-Analyze] Model updated — re-analyzing all TARGETS...');
    setTimeout(async () => {
      for(const t of TARGETS) {
        try {
          const r = runCaptageAnalysis(t.lat, t.lng, 3000);
          const exec = computeExecSummary(r);
          saveSiteAnalysis(t.name, t.lat, t.lng, r, exec);
          console.log(`[Auto-Analyze] ${t.name}: ${r.totalTheorique} mbr, ${exec.verdict} (${exec.total}pts)`);
        } catch(e) { console.warn('[Auto-Analyze] Error on ' + t.name, e); }
      }
      console.log('[Auto-Analyze] Done — all TARGETS refreshed');
    }, 1000);
  }
}

// ================================================================
// SECTORS DRAWING
// ================================================================
// Layer groups for sector polygons + labels, controlled by layers.sectors
let sectorPolyLayer = null;
let sectorLabelLayer = null;

function drawSectors() {
  // Build once; toggleLayer('sectors') controls visibility
  sectorPolyLayer  = L.layerGroup();
  sectorLabelLayer = L.layerGroup();
  SECTORS.forEach(s => {
    const poly = L.polygon(s.polygon,{
      color:s.color,weight:2,fillColor:s.color,fillOpacity:.12,
      smoothFactor:1
    });
    poly.on('click',e=>{L.DomEvent.stopPropagation(e);zoomSector(s.id)});
    poly.on('mouseover',function(){this.setStyle({fillOpacity:.28})});
    poly.on('mouseout',function(){this.setStyle({fillOpacity:.12})});
    poly.bindTooltip(`<b>${s.name}</b><br>${s.desc}<br>Pop: ${fmt(s.pop)} | 15-45: ${fmt(Math.round(s.pop*s.youngPct))}`,{
      sticky:true,className:'custom-tooltip',direction:'top'
    });
    sectorPolys[s.id] = poly;
    poly.addTo(sectorPolyLayer);

    // Label
    L.marker(s.center,{
      icon:L.divIcon({
        className:'',
        html:`<div style="background:${s.color};color:white;padding:3px 10px;border-radius:6px;font-size:11px;font-weight:700;white-space:nowrap;text-align:center;opacity:.85;font-family:var(--font);letter-spacing:.3px">${s.name}</div>`,
        iconSize:[80,24],iconAnchor:[40,12]
      })
    }).addTo(sectorLabelLayer);
  });
  // Start hidden — layers.sectors is false by default
  if (layers.sectors) {
    sectorPolyLayer.addTo(map);
    sectorLabelLayer.addTo(map);
  }
}

// ================================================================
// MAP CLICK — Core analysis flow
// ================================================================
let radiusHandle = null;
let popLabel = null;

// Estimate population in a circle based on sector density overlap
function estimatePopInRadius(lat,lng,r) {
  let totalPop=0, totalTarget=0;
  const rKm = r/1000;
  const circleArea = Math.PI * rKm * rKm;
  SECTORS.forEach(s=>{
    const dToCenter = haversine(lat,lng,s.center[0],s.center[1])/1000;
    const sectorRadius = Math.sqrt(s.area/Math.PI);
    const overlap = Math.max(0, Math.min(1, 1 - (dToCenter / (sectorRadius + rKm))));
    if(overlap > 0) {
      const densityKm2 = s.pop / s.area;
      const targetDensity = (s.pop * s.youngPct) / s.area;
      const contributingArea = Math.min(circleArea, s.area) * overlap;
      totalPop += Math.round(densityKm2 * contributingArea);
      totalTarget += Math.round(targetDensity * contributingArea);
    }
  });
  return {pop:totalPop, target:totalTarget};
}

// Count POIs within radius and estimate additional foot traffic
function poisInRadius(lat,lng,r) {
  const unis=[],malls=[],offices=[];
  let totalStudents=0, totalEmployees=0;
  POIS.forEach(p=>{
    if(haversine(lat,lng,p.lat,p.lng) <= r) {
      if(p.type==='university'){unis.push(p);totalStudents+=(p.students||0)}
      else if(p.type==='mall'){malls.push(p)}
      else if(p.type==='office'){offices.push(p);totalEmployees+=(p.employees||0)}
    }
  });
  return {unis,malls,offices,totalStudents,totalEmployees};
}

function updateRadiusLabel() {
  if(!circle || !selectedPt) return;
  const r = circle.getRadius();
  syncRadiusSlider();
  const est = estimatePopInRadiusGranular(selectedPt.lat, selectedPt.lng, r);
  const compsInRadius = VERIFIED_CLUBS.filter(c=>haversine(selectedPt.lat,selectedPt.lng,c.lat,c.lng)<=r).length;
  const poi = poisInRadius(selectedPt.lat, selectedPt.lng, r);

  if(popLabel) map.removeLayer(popLabel);
  const labelLat = selectedPt.lat;
  const labelLng = selectedPt.lng + (r / 111320 / Math.cos(selectedPt.lat * Math.PI/180));
  popLabel = L.marker([labelLat, labelLng], {
    icon: L.divIcon({
      className:'',
      html:`<div style="background:rgba(6,8,15,.94);border:1px solid rgba(212,160,23,.5);border-radius:8px;padding:7px 11px;font-size:10px;color:white;white-space:nowrap;font-family:var(--font);box-shadow:0 2px 10px rgba(0,0,0,.5)">
        <div style="font-weight:800;color:#d4a017;font-size:13px;margin-bottom:2px">${(r/1000).toFixed(1)} km</div>
        <div>Pop: <b>${fmt(est.pop)}</b></div>
        <div>Cible 15-45: <b style="color:#3b82f6">${fmt(est.target)}</b></div>
        <div>Clubs fitness: <b style="color:#f97316">${compsInRadius}</b></div>
        ${poi.unis.length?`<div>Universites: <b style="color:#a855f7">${poi.unis.length}</b> (${fmt(poi.totalStudents)} etud.)</div>`:''}
        ${poi.offices.length?`<div>Bureaux: <b style="color:#3b82f6">${poi.offices.length}</b> (~${fmt(poi.totalEmployees)} empl.)</div>`:''}
        ${poi.malls.length?`<div>Malls: <b style="color:#06b6d4">${poi.malls.length}</b></div>`:''}
      </div>`,
      iconSize:[160,80],iconAnchor:[-8,40]
    })
  }).addTo(map);
}

async function onMapClick(e) {
  const {lat,lng} = e.latlng;
  selectedPt = {lat,lng};

  if(circle) map.removeLayer(circle);
  if(radiusHandle) map.removeLayer(radiusHandle);
  if(popLabel) map.removeLayer(popLabel);
  if(isoLayer) { map.removeLayer(isoLayer); isoLayer = null; }

  // Draw isochrone if mode is walk/drive, otherwise circle
  if(isoMode !== 'circle') {
    drawIsochrone(lat, lng); // async, draws on map when ready
  }

  // Always draw circle too (for analysis calculations which use radius)
  circle = L.circle([lat,lng],{
    radius,color:'#d4a017',weight:2,fillColor:'#d4a017',fillOpacity: isoMode==='circle'?.06:.02, dashArray:'8,6'
  }).addTo(map);

  // Add draggable radius handle
  const handleLat = lat;
  const handleLng = lng + (radius / 111320 / Math.cos(lat * Math.PI/180));
  radiusHandle = L.circleMarker([handleLat, handleLng], {
    radius:7, color:'#d4a017', fillColor:'white', fillOpacity:1, weight:2,
    draggable:false // we handle drag via events
  }).addTo(map);

  // Enable drag on the handle to resize the catchment
  radiusHandle.on('mousedown', function(e){
    L.DomEvent.stopPropagation(e);
    map.dragging.disable();
    const onMove = function(ev){
      const newR = haversine(lat,lng,ev.latlng.lat,ev.latlng.lng);
      if(newR >= 200 && newR <= 10000) {
        radius = Math.round(newR);
        circle.setRadius(radius);
        radiusHandle.setLatLng(ev.latlng);
        updateRadiusLabel();
        // Update pill selection
        document.querySelectorAll('.radius-pill').forEach(p=>p.classList.remove('active'));
      }
    };
    const onUp = function(){
      map.off('mousemove',onMove);
      map.off('mouseup',onUp);
      map.dragging.enable();
      // Re-analyze with new radius
      analyzePoint(lat,lng,findSector(lat,lng));
    };
    map.on('mousemove',onMove);
    map.on('mouseup',onUp);
  });

  // Style the handle cursor
  radiusHandle.getElement && radiusHandle.getElement() && (radiusHandle.getElement().style.cursor='ew-resize');

  updateRadiusLabel();

  const sector = findSector(lat,lng);
  const popEst = estimatePopInRadiusGranular(lat,lng,radius);
  const poi = poisInRadius(lat,lng,radius);

  // Point info box
  el('pointBox').style.display='block';
  el('pointBoxContent').innerHTML=`
    <div class="map-stat"><span>Coordonnees</span><span class="map-stat-v" style="font-family:var(--mono);font-size:10px">${lat.toFixed(4)}, ${lng.toFixed(4)}</span></div>
    <div class="map-stat"><span>Secteur</span><span class="map-stat-v">${sector?sector.name:'Hors Bucarest'}</span></div>
    <div class="map-stat"><span>Rayon</span><span class="map-stat-v">${radius/1000} km</span></div>
    <div class="map-stat"><span>Pop. dans rayon</span><span class="map-stat-v" style="color:var(--blue)">${fmt(popEst.pop)}</span></div>
    <div class="map-stat"><span>Cible 15-45 ans</span><span class="map-stat-v" style="color:var(--green);font-weight:800">${fmt(popEst.target)}</span></div>
    ${sector?`<div class="map-stat"><span>Revenu zone</span><span class="map-stat-v">${sector.income}</span></div>`:''}
    ${poi.unis.length?`<div class="map-stat"><span>Universites</span><span class="map-stat-v" style="color:#a855f7">${poi.unis.length} (${fmt(poi.totalStudents)} etud.)</span></div>`:''}
    ${poi.offices.length?`<div class="map-stat"><span>Poles bureaux</span><span class="map-stat-v" style="color:var(--blue)">${poi.offices.length} (~${fmt(poi.totalEmployees)} empl.)</span></div>`:''}
    ${poi.malls.length?`<div class="map-stat"><span>Centres commerciaux</span><span class="map-stat-v" style="color:var(--cyan)">${poi.malls.length}</span></div>`:''}
    <div style="margin-top:6px;font-size:9px;color:var(--gray2)">Tirez le bord du cercle pour ajuster le rayon</div>
  `;

  await analyzePoint(lat,lng,sector);
}

async function analyzePoint(lat,lng,sector) {
  showLoad('Detection des concurrents...','Croisement base verifiee (92 clubs) + Overpass API');

  // Always start with verified database
  let verifiedInRadius = getDemoInRadius(lat,lng,radius);

  let comps;
  if(demo) {
    comps = verifiedInRadius;
  } else {
    // Fetch from Overpass and merge with verified DB (cross-reference)
    const overpassComps = await fetchOverpass(lat,lng,radius);
    // Merge: keep verified DB as base, add any Overpass result not already in verified
    const merged = [...verifiedInRadius];
    overpassComps.forEach(oc => {
      const alreadyExists = merged.some(vc =>
        haversine(vc.lat,vc.lng,oc.lat,oc.lng) < 150 // within 150m = same club
      );
      if(!alreadyExists) merged.push(oc);
    });
    comps = merged;
  }

  curComps = comps;

  // ═══ v7.01 — RENDU IMMÉDIAT, enrichissement ENSUITE ═══════════════
  // Le cœur de l'analyse (SAZ, verdict, P&L, concurrents) ne dépend
  // d'AUCUN appel réseau bloquant : on l'affiche TOUT DE SUITE. Les
  // temps de trajet Google (bonus cosmétique dans les popups) sont
  // enrichis après coup, en arrière-plan et bornés → l'analyse ne peut
  // plus jamais rester bloquée sur « Calcul distances réelles ».
  const saz = calcSAZ(lat,lng,sector,comps);
  displaySAZ(saz);
  displayComps(comps,lat,lng);
  updateSegChart(comps);
  addZone(lat,lng,sector,saz,comps);
  genSiteCard(lat,lng,sector,saz,comps);
  showCaptageForPoint(lat, lng);   // fiche site (verdict + P&L)
  hideLoad();

  // Enrichissement temps de trajet réels — fire-and-forget, borné à 5 s,
  // puis re-render des popups concurrents (sans jamais bloquer le reste).
  if (_googleHasKey() && comps.length > 0) {
    Promise.race([
      Promise.resolve().then(() => googleDistanceMatrix(lat, lng, comps)).catch(() => {}),
      new Promise(r => setTimeout(r, 5000)),
    ]).then(() => { try { displayComps(comps, lat, lng); } catch {} });
  }
}

function findSector(lat,lng) {
  let best=null,bd=Infinity;
  SECTORS.forEach(s=>{
    const d=Math.sqrt((lat-s.center[0])**2+(lng-s.center[1])**2);
    if(d<bd){bd=d;best=s}
  });
  return bd<.06?best:null;
}

// ================================================================
// OVERPASS API
// ================================================================
async function fetchOverpass(lat,lng,r) {
  const key=`${lat.toFixed(3)}_${lng.toFixed(3)}_${r}`;
  if(opCache[key]) return opCache[key];

  const q=`[out:json][timeout:30];(node["leisure"="fitness_centre"](around:${r},${lat},${lng});way["leisure"="fitness_centre"](around:${r},${lat},${lng});node["leisure"="sports_centre"](around:${r},${lat},${lng});way["leisure"="sports_centre"](around:${r},${lat},${lng});node["sport"="fitness"](around:${r},${lat},${lng});way["sport"="fitness"](around:${r},${lat},${lng});node["amenity"="gym"](around:${r},${lat},${lng});way["amenity"="gym"](around:${r},${lat},${lng}););out center body;`;

  try {
    // v7.01 — timeout dur : sans ça, un Overpass qui stalle ne rejette jamais
    // → le catch (fallback base vérifiée) n'était jamais atteint et l'analyse
    // bloquait avant même les distances.
    const _ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const _t = _ac ? setTimeout(() => _ac.abort(), 12000) : null;
    const res=await fetch(OVERPASS,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'data='+encodeURIComponent(q),signal:_ac?_ac.signal:undefined});
    if (_t) clearTimeout(_t);
    const data=await res.json();

    const comps=data.elements.map(el=>{
      const lt=el.lat||(el.center&&el.center.lat);
      const ln=el.lon||(el.center&&el.center.lon);
      if(!lt||!ln) return null;
      const nm=el.tags?.name||el.tags?.brand||'Salle inconnue';
      const m=matchDB(nm);
      return {id:el.id,name:nm,lat:lt,lng:ln,
        segment:m?.segment||guessSeg(nm),size:m?.avgSize||guessSize(nm),
        members:m?.avgMembers||guessMembers(nm),threat:m?.threat||'low',
        color:m?.color||'#22c55e',price:m?.price||'?',
        brand:m?.brand||'local',est:!m,source:'overpass'};
    }).filter(Boolean);

    const dd=dedup(comps);
    opCache[key]=dd;
    sessionStorage.setItem('opCache',JSON.stringify(opCache));
    updCache();
    return dd;
  } catch(e) {
    console.error('Overpass:',e);
    setStatus('err','Overpass indisponible — fallback estimations');
    return getDemoInRadius(lat,lng,r);
  }
}

async function fetchAllBucharest() {
  const key='all_buc';
  if(opCache[key]) return opCache[key];
  showLoad('Scan complet Bucarest...','Requete Overpass API — tous les POI fitness');

  const q=`[out:json][timeout:60];area["name"="București"]->.b;(node["leisure"="fitness_centre"](area.b);way["leisure"="fitness_centre"](area.b);node["leisure"="sports_centre"](area.b);way["leisure"="sports_centre"](area.b);node["sport"="fitness"](area.b);way["sport"="fitness"](area.b);node["amenity"="gym"](area.b);way["amenity"="gym"](area.b););out center body;`;

  try {
    const res=await fetch(OVERPASS,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'data='+encodeURIComponent(q)});
    const data=await res.json();
    const comps=data.elements.map(el=>{
      const lt=el.lat||(el.center&&el.center.lat);const ln=el.lon||(el.center&&el.center.lon);
      if(!lt||!ln)return null;
      const nm=el.tags?.name||el.tags?.brand||'Salle inconnue';const m=matchDB(nm);
      return{id:el.id,name:nm,lat:lt,lng:ln,segment:m?.segment||guessSeg(nm),size:m?.avgSize||guessSize(nm),
        members:m?.avgMembers||guessMembers(nm),threat:m?.threat||'low',color:m?.color||'#22c55e',
        price:m?.price||'?',brand:m?.brand||'local',est:!m,source:'overpass'};
    }).filter(Boolean);
    const dd=dedup(comps);
    opCache[key]=dd;
    allComps=dd;
    hideLoad();
    return dd;
  } catch(e) {
    hideLoad();
    setStatus('warn','Overpass indisponible — base verifiee (92 clubs)');
    // Always fallback to verified DB, never return empty
    const fallback = VERIFIED_CLUBS.map(c=>({...c,id:Math.random(),source:'verified',est:false,color:segColor(c.segment),threat:segThreat(c.segment),brand:'local'}));
    opCache[key]=fallback;
    allComps=fallback;
    return fallback;
  }
}

function matchDB(name) {
  if(!name) return null;
  const l=name.toLowerCase();
  return COMP_DB.find(c=>l.includes(c.name.toLowerCase()));
}
function guessSeg(n){if(!n)return'independent';const l=n.toLowerCase();if(l.includes('crossfit')||l.includes('box'))return'crossfit';if(l.includes('yoga')||l.includes('pilates'))return'boutique';return'independent'}
function guessSize(n){const s=guessSeg(n);return{premium:1500,mid:600,'mid-premium':800,lowcost:1000,independent:300,crossfit:250,boutique:200}[s]||300}
function guessMembers(n){const s=guessSeg(n);return{premium:2000,mid:600,'mid-premium':1000,lowcost:1500,independent:250,crossfit:150,boutique:100}[s]||250}
function dedup(list){const r=[];list.forEach(c=>{if(!r.some(x=>Math.abs(x.lat-c.lat)<.0003&&Math.abs(x.lng-c.lng)<.0003))r.push(c)});return r}
function getDemoInRadius(lat,lng,r){
  return VERIFIED_CLUBS.filter(c=>haversine(lat,lng,c.lat,c.lng)<=r).map(c=>{
    const m=matchDB(c.name);
    // Find enriched version from allComps if available
    const enriched = allComps.find(ac => ac.name === c.name && ac.gEnriched);
    const rv=getReviewData(c.name, enriched || c);
    const mA=c.members||0;
    const mB=rv?rv.mB:0;
    const membersAvg=mB>0?Math.round((mA+mB)/2):mA;
    return{...c,id:Math.random(),source:'verified',est:false,color:segColor(c.segment),
      threat:segThreat(c.segment),brand:m?.brand||'local',price:m?.price||'?',
      membersA:mA,membersB:mB,members:membersAvg};
  });
}
function segColor(s){return{premium:'#ef4444','mid-premium':'#f97316',mid:'#f97316',lowcost:'#eab308',independent:'#22c55e',crossfit:'#22c55e',boutique:'#8b5cf6',aggregator:'#eab308'}[s]||'#22c55e'}
function segThreat(s){return{premium:'high','mid-premium':'medium',mid:'medium',lowcost:'medium',independent:'low',crossfit:'low',boutique:'low'}[s]||'low'}

// ================================================================
// THREAT SCORE
// ================================================================
function threatScore(c,dist) {
  // Proximity 40% — use driving time if available, else haversine distance
  let prox;
  if(c.driveMins !== undefined) {
    if(c.driveMins<=3)prox=100;else if(c.driveMins<=5)prox=90;else if(c.driveMins<=8)prox=70;
    else if(c.driveMins<=12)prox=50;else if(c.driveMins<=15)prox=35;else if(c.driveMins<=20)prox=20;else prox=8;
  } else {
    if(dist<300)prox=100;else if(dist<500)prox=90;else if(dist<1000)prox=70;
    else if(dist<1500)prox=50;else if(dist<2000)prox=35;else if(dist<3000)prox=20;else prox=8;
  }

  // Size 25%
  let sz=30;
  if(c.size){if(c.size>1500)sz=100;else if(c.size>1000)sz=80;else if(c.size>600)sz=55;else if(c.size>300)sz=35;else sz=15}

  // Positioning 15% — same target segment = more dangerous
  const pos={premium:95,'mid-premium':75,mid:50,lowcost:35,independent:18,crossfit:12,boutique:10,aggregator:40};

  // Brand strength 10%
  const br=c.est?25:c.brand==='international'?90:c.brand==='local'?55:30;

  // Quality/Reputation 10% — Google rating + review volume (NEW)
  let qual = 50; // default neutral
  const gR = c.gRating, gN = c.gReviews || 0;
  if(gR) {
    if(gR >= 4.5 && gN > 500) qual = 95;       // excellent + well-known = very threatening
    else if(gR >= 4.2 && gN > 200) qual = 75;   // good + established
    else if(gR >= 4.0) qual = 55;                // decent
    else if(gR >= 3.5) qual = 35;                // mediocre = vulnerable
    else qual = 20;                               // poorly rated = easy to beat
  }

  return Math.round(prox*.40 + sz*.25 + (pos[c.segment]||20)*.15 + br*.10 + qual*.10);
}

// ================================================================
// SAZ — Score d'Attractivite de Zone
// ================================================================
// ================================================================
// SAZ v2 — Restructure autour de FLUX + DENSITE (50/50)
// Objectif business : clubs a fort traffic, generateurs de flux
// ================================================================

// Traffic generators with estimated daily footfall
// Metro ridership by station (estimated from 750k total/day, weighted by interchange + line)
// Interchanges = 2-5x regular stations, M2 busiest line, terminals lower
const METRO_RIDERSHIP = {};
(function(){
  // Interchange mega-stations
  const interchanges={Unirii:85000,Victoriei:70000,'Gara de Nord':55000,Dristor:45000,Eroilor:40000,Basarab:35000,'Nicolae Grigorescu':30000,'Mihai Bravu':28000};
  // M2 (busiest): avg 18k/station
  const m2busy={Pipera:25000,'Aurel Vlaicu':22000,'Stefan cel Mare':18000,'Piata Romana':28000,Universitate:30000,Tineretului:16000,'Piata Sudului':15000,'Constantin Brancoveanu':14000,'Eroii Revolutiei':16000,'Aparatorii Patriei':12000,'Dimitrie Leonida':10000,Aviatorilor:20000};
  // M1: avg 14k
  const m1={'Pantelimon':8000,Republica:12000,'Costin Georgian':10000,Titan:18000,'Piata Muncii':15000,'Piata Iancului':14000,Obor:16000};
  // M3: avg 12k
  const m3={Preciziei:8000,Pacii:10000,Gorjului:11000,Lujerului:14000,Politehnica:16000,'Anghel Saligny':8000,'Nicolae Teclu':7000,'1 Decembrie 1918':9000};
  // M4: avg 10k
  const m4={Grivita:10000,'1 Mai':12000,Jiului:9000,'Parc Bazilescu':8000,Laminorului:7000,Straulesti:6000,Pajura:8000};
  // M5: avg 12k
  const m5={'Academia Militara':14000,Orizont:11000,Favorit:10000,'Tudor Vladimirescu':10000,'Parc Drumul Taberei':13000,Romancierilor:9000,'Valea Ialomitei':8000,Brancusi:8000,'Raul Doamnei':7000};
  // Default for unlisted
  [interchanges,m2busy,m1,m3,m4,m5].forEach(obj=>Object.assign(METRO_RIDERSHIP,obj));
  // Add Timpuri Noi, Izvor
  METRO_RIDERSHIP['Timpuri Noi']=15000;METRO_RIDERSHIP['Izvor']=12000;
  METRO_RIDERSHIP['Petrache Poenaru']=9000;METRO_RIDERSHIP['Grozavesti']=14000;
  METRO_RIDERSHIP['Baneasa']=10000;METRO_RIDERSHIP['Crangasi']=12000;
  METRO_RIDERSHIP['Berceni']=8000;METRO_RIDERSHIP['Tudor Arghezi']=6000;
})();

// Get ridership for a metro station
function getMetroRidership(stationName) {
  for(const [key,val] of Object.entries(METRO_RIDERSHIP)) {
    if(stationName.includes(key) || key.includes(stationName)) return val;
  }
  return 10000; // default for unknown
}

const TRAFFIC_GENERATORS = {
  metroInterchange: [{name:'Unirii',lat:44.4268,lng:26.1008,dailyPax:85000},
    {name:'Victoriei',lat:44.4527,lng:26.0855,dailyPax:70000},
    {name:'Dristor',lat:44.4200,lng:26.1320,dailyPax:45000},
    {name:'Eroilor',lat:44.4325,lng:26.0710,dailyPax:40000},
    {name:'Basarab',lat:44.4490,lng:26.0630,dailyPax:35000},
    {name:'Nicolae Grigorescu',lat:44.4170,lng:26.1510,dailyPax:30000},
    {name:'Gara de Nord',lat:44.4470,lng:26.0710,dailyPax:55000}],
  malls: [
    // Tier 1: >40k visitors/day — regional destination malls
    {name:'AFI Cotroceni',lat:44.4315,lng:26.0520,dailyVisitors:60000},       // 90k m2 GLA, largest in Romania
    {name:'Mega Mall',lat:44.4418,lng:26.1522,dailyVisitors:35000},           // S2, 70k m2 GLA
    {name:'ParkLake',lat:44.4207,lng:26.1496,dailyVisitors:30000},            // S3, 70k m2 GLA, near Titan park
    {name:'Baneasa Shopping City',lat:44.5073,lng:26.0895,dailyVisitors:55000},// S1 nord, 55k m2 GLA + 35k extension | 20M visits/yr (PPTX officiel) | 380M€ CA/an | 350+ marques premium
    // Tier 2: 20-30k visitors/day — major district malls
    {name:'Sun Plaza',lat:44.3954,lng:26.1231,dailyVisitors:28000},           // S4, metro Piata Sudului
    {name:'Promenada Mall',lat:44.4782,lng:26.1034,dailyVisitors:25000},      // S1, Floreasca, 45k m2 GLA
    {name:'Unirea Shopping Center',lat:44.4275,lng:26.1019,dailyVisitors:25000},// S3, Piata Unirii, 84k m2 GLA
    {name:'Plaza Romania',lat:44.4285,lng:26.0352,dailyVisitors:20000},       // S6, metro Lujerului
    {name:'Bucuresti Mall',lat:44.4203,lng:26.1267,dailyVisitors:18000},      // S4, 1st mall in Romania (1999)
    // Tier 3: 10-20k visitors/day — neighborhood malls
    {name:'Militari Shopping',lat:44.4367,lng:25.9827,dailyVisitors:18000},    // S6 ouest, Militari Residence
    {name:'Veranda Mall',lat:44.4521,lng:26.1290,dailyVisitors:15000},        // S2, Obor district
    {name:'Grand Arena',lat:44.3742,lng:26.1204,dailyVisitors:15000},         // S4 sud, Berceni
    {name:'Liberty Center',lat:44.4102,lng:26.0937,dailyVisitors:10000},      // S5, Calea Rahovei/Progresului
    {name:'City Mall',lat:44.4130,lng:26.0920,dailyVisitors:8000},            // S5, Eroii Revolutiei (partly closed, low traffic)
    // Planned/Under construction — major projects
    {name:'Hala Laminor',lat:44.4258,lng:26.1492,dailyVisitors:35000},        // S3, 86.3k m2 GLA mixed-use, metro Republica, mairie S3, bureaux, université — ouverture 2027
    {name:'Dambovita Center',lat:44.4360,lng:26.0880,dailyVisitors:5000},     // S6, under development
  ],
  pedestrian: [{name:'Calea Victoriei',lat:44.4440,lng:26.0930,dailyPed:50000},
    {name:'Old Town Lipscani',lat:44.4320,lng:26.1000,dailyPed:40000},
    {name:'Bd Magheru',lat:44.4430,lng:26.0980,dailyPed:35000},
    {name:'Piata Romana',lat:44.4460,lng:26.0970,dailyPed:30000},
    {name:'Piata Universitatii',lat:44.4355,lng:26.1002,dailyPed:35000}],
  // Tram/Bus major corridors (STB 1B pax/year = ~2.7M/day)
  tramCorridor: [
    {name:'Bd Stefan cel Mare (tram 21/40)',lat:44.4530,lng:26.1100,dailyPax:25000},
    {name:'Bd Colentina (tram 21)',lat:44.4600,lng:26.1350,dailyPax:18000},
    {name:'Sos Mihai Bravu (tram 40)',lat:44.4200,lng:26.1300,dailyPax:20000},
    {name:'Sos Pantelimon (tram 1/40)',lat:44.4400,lng:26.1600,dailyPax:15000},
    {name:'Bd Iuliu Maniu (bus 137/301)',lat:44.4340,lng:26.0100,dailyPax:22000},
    {name:'Bd Magheru-Balcescu (bus 783/N)',lat:44.4400,lng:26.0970,dailyPax:20000},
    {name:'Calea Vacaresti (bus 116/312)',lat:44.4100,lng:26.1100,dailyPax:15000},
  ],
  // Parking capacity (relevant for suburban clubs)
  parking: [
    {name:'Hala Laminor',lat:44.4258,lng:26.1492,spaces:1325},
    {name:'AFI Cotroceni',lat:44.4315,lng:26.0520,spaces:3500},
    {name:'Mega Mall',lat:44.4418,lng:26.1522,spaces:2500},
    {name:'Militari Shopping',lat:44.4367,lng:25.9827,spaces:2500},
    {name:'ParkLake',lat:44.4207,lng:26.1496,spaces:2400},
    {name:'Sun Plaza',lat:44.3954,lng:26.1231,spaces:1900},
    {name:'Grand Arena',lat:44.3742,lng:26.1204,spaces:2000},
    {name:'Plaza Romania',lat:44.4285,lng:26.0352,spaces:1800},
    {name:'Baneasa Shopping',lat:44.5073,lng:26.0895,spaces:4500},// 2500 existants + 2000 extension
    {name:'Promenada',lat:44.4782,lng:26.1034,spaces:1600},
  ]
};

// SAZ weight configuration — adjustable by user
let sazWeights = {flux:33, densite:33, jeunesse:34};

// Calculate FLUX score (0-100) — proximity to traffic generators
function calcFluxScore(lat,lng) {
  let metroScore=0, mallScore=0, officeScore=0, uniScore=0, pedScore=0;

  // 1. Metro & Transport (weight: 40% of flux) — CRUCIAL for site viability
  //    Methodology: exponential distance decay + ridership normalization
  //    A metro station at <200m is a game-changer (direct footfall capture)

  // Metro interchanges (multiple lines = massive flux multiplier)
  TRAFFIC_GENERATORS.metroInterchange.forEach(m=>{
    const d=haversine(lat,lng,m.lat,m.lng);
    if(d<200) metroScore+=m.dailyPax/600;       // au pied = max impact
    else if(d<500) metroScore+=m.dailyPax/800;
    else if(d<1000) metroScore+=m.dailyPax/1500;
    else if(d<2000) metroScore+=m.dailyPax/4000;
  });

  // Per-station ridership (all 53 stations)
  let stationsNear = 0;
  METRO.forEach(m=>{
    const d=haversine(lat,lng,m.lat,m.lng);
    const pax=getMetroRidership(m.n)/1000;
    if(d<200) { metroScore+=pax*3.0; stationsNear++; }      // au pied du site
    else if(d<500) { metroScore+=pax*2.0; stationsNear++; }  // 5 min a pied
    else if(d<1000) { metroScore+=pax*1.0; stationsNear++; } // 10 min a pied
    else if(d<1500) metroScore+=pax*0.4;
    else if(d<2000) metroScore+=pax*0.15;
  });
  // Bonus multi-stations: several stations nearby = transit hub effect
  if(stationsNear >= 3) metroScore *= 1.3;
  else if(stationsNear >= 2) metroScore *= 1.15;

  // Tram/bus corridors (surface transit)
  TRAFFIC_GENERATORS.tramCorridor.forEach(t=>{
    const d=haversine(lat,lng,t.lat,t.lng);
    if(d<300) metroScore+=t.dailyPax/2000;
    else if(d<800) metroScore+=t.dailyPax/4000;
    else if(d<1500) metroScore+=t.dailyPax/8000;
  });
  metroScore=Math.min(100,Math.round(metroScore));

  // 2. Mall proximity & footfall (weight: 25% of flux)
  TRAFFIC_GENERATORS.malls.forEach(m=>{
    const d=haversine(lat,lng,m.lat,m.lng);
    if(d<200) mallScore+=m.dailyVisitors/400;       // dans le mall
    else if(d<500) mallScore+=m.dailyVisitors/700;   // adjacent
    else if(d<1000) mallScore+=m.dailyVisitors/1500;  // 10 min a pied
    else if(d<2000) mallScore+=m.dailyVisitors/4000;
    else if(d<3000) mallScore+=m.dailyVisitors/8000;
  });
  mallScore=Math.min(100,Math.round(mallScore));

  // 3. Office/Employee flux (weight: 15% of flux)
  POIS.filter(p=>p.type==='office').forEach(p=>{
    const d=haversine(lat,lng,p.lat,p.lng);
    const emp=p.employees||0;
    if(d<500) officeScore+=emp/400;
    else if(d<1500) officeScore+=emp/1500;
    else if(d<3000) officeScore+=emp/4000;
  });
  officeScore=Math.min(100,Math.round(officeScore));

  // 4. University/Student flux (weight: 10% of flux)
  POIS.filter(p=>p.type==='university').forEach(p=>{
    const d=haversine(lat,lng,p.lat,p.lng);
    const stu=p.students||0;
    if(d<500) uniScore+=stu/250;
    else if(d<1500) uniScore+=stu/800;
    else if(d<3000) uniScore+=stu/2500;
  });
  uniScore=Math.min(100,Math.round(uniScore));

  // 5. Pedestrian zone proximity (weight: 10% of flux)
  TRAFFIC_GENERATORS.pedestrian.forEach(p=>{
    const d=haversine(lat,lng,p.lat,p.lng);
    if(d<300) pedScore+=p.dailyPed/400;
    else if(d<800) pedScore+=p.dailyPed/1500;
    else if(d<2000) pedScore+=p.dailyPed/4000;
  });
  pedScore=Math.min(100,Math.round(pedScore));

  // Composite: Metro/Transport 40%, Mall 25%, Office 15%, Uni 10%, Ped 10%
  let composite = Math.round(metroScore*.40 + mallScore*.25 + officeScore*.15 + uniScore*.10 + pedScore*.10);

  // Google Activity Bonus: if Google-enriched clubs nearby have high review volume = busy area
  if(allComps && allComps.length > 0) {
    const nearbyEnriched = allComps.filter(c => c.gEnriched && haversine(lat,lng,c.lat,c.lng) < 800);
    if(nearbyEnriched.length > 0) {
      const avgReviews = nearbyEnriched.reduce((a,c) => a + (c.gReviews||0), 0) / nearbyEnriched.length;
      // High review volume near = high-activity zone → flux bonus
      if(avgReviews > 500) composite = Math.round(composite * 1.08); // +8% for very active zones
      else if(avgReviews > 200) composite = Math.round(composite * 1.04); // +4% for active zones
    }
  }

  return {total:Math.min(100,composite),metro:metroScore,mall:mallScore,office:officeScore,uni:uniScore,ped:pedScore};
}

// Calculate DENSITE score (0-100) — population density + income + competition
function calcDensiteScore(lat,lng,sector,comps) {
  if(!sector) return {total:0,pop:0,density:0,income:0,comp:0};

  const popTarget=Math.round(sector.pop*sector.youngPct);
  const maxTarget=Math.max(...SECTORS.map(s=>s.pop*s.youngPct));
  const popScore=Math.round((popTarget/maxTarget)*100);

  const dKm2=popTarget/sector.area;
  const maxDensity=Math.max(...SECTORS.map(s=>(s.pop*s.youngPct)/s.area));
  const densityScore=Math.round((dKm2/maxDensity)*100);

  const incomeScore=sector.incomeIdx;

  const n=comps.length;
  let compScore;
  if(n===0)compScore=100;else if(n<=1)compScore=90;else if(n<=3)compScore=70;
  else if(n<=5)compScore=50;else if(n<=8)compScore=30;else if(n<=12)compScore=15;else compScore=5;

  const total=Math.round(popScore*.30 + densityScore*.25 + incomeScore*.25 + compScore*.20);
  return {total,pop:popScore,density:densityScore,income:incomeScore,comp:compScore,
    details:{popTarget,totalPop:sector.pop,dKm2:Math.round(dKm2),nbComp:n}};
}

// ================================================================
// JEUNESSE SCORE (0-100) — Presence de population jeune 15-45
// ================================================================
function calcJeunesseScore(lat,lng,sector) {
  let uniScore=0, ageScore=0, newResScore=0, cartierYoung=0;

  // 1. Universites & etudiants a proximite (40% du score Jeunesse)
  let totalStudents=0;
  POIS.filter(p=>p.type==='university').forEach(p=>{
    const d=haversine(lat,lng,p.lat,p.lng);
    const stu=p.students||0;
    if(d<500) {totalStudents+=stu; uniScore+=stu/200;}
    else if(d<1000) {totalStudents+=Math.round(stu*.7); uniScore+=stu/400;}
    else if(d<2000) {totalStudents+=Math.round(stu*.3); uniScore+=stu/1000;}
    else if(d<3000) {totalStudents+=Math.round(stu*.1); uniScore+=stu/2500;}
  });
  uniScore=Math.min(100,Math.round(uniScore));

  // 2. Profil age du quartier (30% du score Jeunesse) — % jeunes du cartier
  const cartier=findCartier(lat,lng);
  if(cartier) {
    cartierYoung = cartier.young || .42;
    // Score relative: .46 = best (Grozavesti, Pallady), .38 = worst (Primaverii older)
    ageScore = Math.round(((cartierYoung - .38) / (.46 - .38)) * 100);
    ageScore = Math.max(0,Math.min(100,ageScore));
  } else if(sector) {
    cartierYoung = sector.youngPct;
    ageScore = Math.round(((cartierYoung - .38) / (.46 - .38)) * 100);
    ageScore = Math.max(0,Math.min(100,ageScore));
  }

  // 3. Nouveaux ensembles residentiels a proximite (20% du score) — attirent jeunes actifs
  POIS.filter(p=>p.type==='residential').forEach(p=>{
    const d=haversine(lat,lng,p.lat,p.lng);
    const inh=p.inhabitants||0;
    if(d<2000) newResScore+=inh/300;
    else if(d<4000) newResScore+=inh/1000;
  });
  newResScore=Math.min(100,Math.round(newResScore));

  // 4. Prix immobilier comme proxy gentrification jeune (10%) — zones mid-price = plus de jeunes
  let priceScore=50;
  if(cartier) {
    // Sweet spot pour jeunes actifs: 1400-2000 EUR/m2 (ni trop cher ni trop bas)
    const p=cartier.price;
    if(p>=1400 && p<=2000) priceScore=100;
    else if(p>=1000 && p<1400) priceScore=70;
    else if(p>2000 && p<=2500) priceScore=65;
    else if(p>2500) priceScore=40; // trop cher, plus age
    else priceScore=30; // trop bas, moins de pouvoir d'achat
  }

  const total=Math.round(uniScore*.40 + ageScore*.30 + newResScore*.20 + priceScore*.10);

  return {total:Math.min(100,total),uni:uniScore,age:ageScore,newRes:newResScore,price:priceScore,
    totalStudents,cartierYoung:Math.round(cartierYoung*100)};
}

// SAZ v3 = 33% FLUX + 33% DENSITE + 33% JEUNESSE
function calcSAZ(lat,lng,sector,comps) {
  const flux = calcFluxScore(lat,lng);
  const densite = calcDensiteScore(lat,lng,sector,comps);
  const jeunesse = calcJeunesseScore(lat,lng,sector);

  const wf=sazWeights.flux/100, wd=sazWeights.densite/100, wj=sazWeights.jeunesse/100;
  const total = Math.round(flux.total * wf + densite.total * wd + jeunesse.total * wj);

  return {total,
    // Flux components
    flux:flux.total, fluxMetro:flux.metro, fluxMall:flux.mall, fluxOffice:flux.office, fluxUni:flux.uni, fluxPed:flux.ped,
    // Densite components
    densite:densite.total, pop:densite.pop, density:densite.density, income:densite.income, comp:densite.comp,
    // Jeunesse components
    jeunesse:jeunesse.total, jeuUni:jeunesse.uni, jeuAge:jeunesse.age, jeuNewRes:jeunesse.newRes, jeuPrice:jeunesse.price,
    jeuTotalStudents:jeunesse.totalStudents, jeuCartierYoung:jeunesse.cartierYoung,
    // Legacy compat
    sport:sector?sector.sportIdx:0, transport:sector?sector.transportIdx:0,
    details:{popTarget:densite.details?.popTarget||0,totalPop:sector?.pop||0,dKm2:densite.details?.dKm2||0,
      sectorName:sector?.name||'',nbComp:densite.details?.nbComp||0,incomeLevel:sector?.income||''}
  };
}

function displaySAZ(saz) {
  const box=el('sazBox');box.style.display='block';
  const cls=saz.total>=70?'good':saz.total>=45?'medium':'bad';
  const reco=saz.total>=70?'GO':saz.total>=45?'PRUDENCE':'NO-GO';
  const recoCls=saz.total>=70?'reco-go':saz.total>=45?'reco-caution':'reco-nogo';
  const fluxC=saz.flux>=70?'var(--green)':saz.flux>=45?'var(--yellow)':'var(--red)';
  const densC=saz.densite>=70?'var(--green)':saz.densite>=45?'var(--yellow)':'var(--red)';
  const jeuC=saz.jeunesse>=70?'var(--green)':saz.jeunesse>=45?'var(--yellow)':'var(--red)';

  const bar=(val)=>{const c=val>=70?'var(--green)':val>=45?'var(--yellow)':'var(--red)';return `<div class="metric-bar"><div class="metric-fill" style="width:${val}%;background:${c}"></div></div><span class="metric-value" style="color:${c}">${val}</span>`};

  el('sazBoxContent').innerHTML=`
    <div style="text-align:center;margin-bottom:10px">
      <div class="saz-number ${cls}">${saz.total}</div>
      <div class="saz-sublabel">sur 100</div>
      <div class="${recoCls} reco-chip">${reco}</div>
    </div>
    <div style="display:flex;gap:6px;margin-bottom:10px">
      <div style="flex:1;background:var(--bg);border-radius:6px;padding:6px;text-align:center;border:1px solid ${fluxC}30">
        <div style="font-size:8px;font-weight:700;color:var(--cyan);margin-bottom:2px">FLUX ${sazWeights.flux}%</div>
        <div style="font-size:20px;font-weight:900;color:${fluxC}">${saz.flux}</div>
      </div>
      <div style="flex:1;background:var(--bg);border-radius:6px;padding:6px;text-align:center;border:1px solid ${densC}30">
        <div style="font-size:8px;font-weight:700;color:var(--purple);margin-bottom:2px">DENSITE ${sazWeights.densite}%</div>
        <div style="font-size:20px;font-weight:900;color:${densC}">${saz.densite}</div>
      </div>
      <div style="flex:1;background:var(--bg);border-radius:6px;padding:6px;text-align:center;border:1px solid ${jeuC}30">
        <div style="font-size:8px;font-weight:700;color:var(--green);margin-bottom:2px">JEUNESSE ${sazWeights.jeunesse}%</div>
        <div style="font-size:20px;font-weight:900;color:${jeuC}">${saz.jeunesse}</div>
      </div>
    </div>
    <div style="font-size:9px;font-weight:700;color:var(--cyan);margin-bottom:4px">FLUX — Generateurs de traffic</div>
    <div class="metric-row"><span class="metric-label">Metro & transports</span><span class="metric-weight">40%</span>${bar(saz.fluxMetro)}</div>
    <div class="metric-row"><span class="metric-label">Malls (footfall)</span><span class="metric-weight">25%</span>${bar(saz.fluxMall)}</div>
    <div class="metric-row"><span class="metric-label">Bureaux (employes)</span><span class="metric-weight">15%</span>${bar(saz.fluxOffice)}</div>
    <div class="metric-row"><span class="metric-label">Universites (etud.)</span><span class="metric-weight">10%</span>${bar(saz.fluxUni)}</div>
    <div class="metric-row"><span class="metric-label">Zones pietonnes</span><span class="metric-weight">10%</span>${bar(saz.fluxPed)}</div>
    <div style="font-size:9px;font-weight:700;color:var(--purple);margin:8px 0 4px">DENSITE — Population & marche</div>
    <div class="metric-row"><span class="metric-label">Pop. cible 15-45</span><span class="metric-weight">30%</span>${bar(saz.pop)}</div>
    <div class="metric-row"><span class="metric-label">Densite/km2</span><span class="metric-weight">25%</span>${bar(saz.density)}</div>
    <div class="metric-row"><span class="metric-label">Pouvoir achat</span><span class="metric-weight">25%</span>${bar(saz.income)}</div>
    <div class="metric-row"><span class="metric-label">Concurrence inv.</span><span class="metric-weight">20%</span>${bar(saz.comp)}</div>
    <div style="font-size:9px;font-weight:700;color:var(--green);margin:8px 0 4px">JEUNESSE — Pop. jeune & attractivite</div>
    <div class="metric-row"><span class="metric-label">Universites (${fmt(saz.jeuTotalStudents)} etud.)</span><span class="metric-weight">40%</span>${bar(saz.jeuUni)}</div>
    <div class="metric-row"><span class="metric-label">Age quartier (${saz.jeuCartierYoung}% jeunes)</span><span class="metric-weight">30%</span>${bar(saz.jeuAge)}</div>
    <div class="metric-row"><span class="metric-label">Nvx residentiels</span><span class="metric-weight">20%</span>${bar(saz.jeuNewRes)}</div>
    <div class="metric-row"><span class="metric-label">Prix immo (sweet spot)</span><span class="metric-weight">10%</span>${bar(saz.jeuPrice)}</div>
    ${saz.details.popTarget?`<div style="margin-top:6px;font-size:9px;color:var(--gray2)">Pop. cible: ${fmt(saz.details.popTarget)} | Conc: ${saz.details.nbComp} | ${saz.details.incomeLevel}</div>`:''}
  `;
}

// ================================================================
// BRAND FILTER SYSTEM
// ================================================================
let brandVisibility = {};
let lastDisplayedComps = [];

function extractBrand(name, segment) {
  if(!name) return 'Autre';
  const brands = ['World Class','Stay Fit','StayFit','18GYM','Downtown Fitness','Nr1 Fitness','CrossFit','Absolute','SalsaFit','WoWGym','Sweat Concept','Best Fitness','Groove Box'];
  for(const b of brands) {
    if(name.toLowerCase().includes(b.toLowerCase())) {
      if(b==='StayFit') return 'Stay Fit';
      if(b==='Groove Box') return 'CrossFit';
      return b;
    }
  }
  // Fallback: use segment to group unknowns
  if(segment === 'crossfit') return 'CrossFit';
  return 'Autre';
}

function buildBrandFilters(comps) {
  // Count from allComps (full map data) when available, else VERIFIED_CLUBS
  const source = allComps.length > 0 ? allComps : VERIFIED_CLUBS;
  const brands = {};
  source.forEach(c => {
    const b = extractBrand(c.name, c.segment);
    const col = c.color || segColor(c.segment) || '#22c55e';
    if(!brands[b]) brands[b] = {count:0, color:col};
    brands[b].count++;
  });
  Object.keys(brands).forEach(b => { if(brandVisibility[b]===undefined) brandVisibility[b]=true; });

  const html = Object.entries(brands).sort((a,b)=>b[1].count-a[1].count).map(([name, data]) => {
    const on = brandVisibility[name] !== false;
    return `<button class="btn btn-sm" style="font-size:9px;padding:3px 8px;${on?'background:'+data.color+'30;border-color:'+data.color+';color:white':'opacity:.35;text-decoration:line-through'}" onclick="toggleBrand('${name}')">
      <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${data.color};margin-right:3px"></span>${name} (${data.count})
    </button>`;
  }).join('');
  // Write to both containers (Explorer + Concurrence tabs)
  ['brandFilters','brandFiltersExplorer'].forEach(id=>{const c=el(id);if(c)c.innerHTML=html});
}

function toggleBrand(name) {
  brandVisibility[name] = !brandVisibility[name];
  applyBrandFilter();
}

function toggleAllBrands(state) {
  // v7.02 — s'assure que la liste des marques existe AVANT d'appliquer l'état,
  // sinon « Aucun » sur une session fraîche (brandVisibility vide) ne masquait
  // rien. On amorce depuis la meilleure source dispo (comps chargés ou base
  // vérifiée), puis on force tout à `state`.
  const source = (typeof allComps !== 'undefined' && allComps.length > 0) ? allComps : VERIFIED_CLUBS;
  source.forEach(c => { const b = extractBrand(c.name, c.segment); if (brandVisibility[b] === undefined) brandVisibility[b] = true; });
  Object.keys(brandVisibility).forEach(b => brandVisibility[b] = state);
  applyBrandFilter();
}

function applyBrandFilter() {
  // v6.98 — FIX : sur une session fraîche, lastDisplayedComps est vide tant
  // qu'aucune analyse / "Charger concurrents" n'a tourné → "Tout" et les
  // chips de marque n'affichaient RIEN (0/0). On amorce depuis la meilleure
  // source dispo : allComps (déjà chargés) sinon la base vérifiée (90 clubs).
  if (!lastDisplayedComps.length) {
    lastDisplayedComps = (typeof allComps !== 'undefined' && allComps.length > 0)
      ? allComps
      : VERIFIED_CLUBS.map(c => ({ ...c, id: Math.random(), source: 'verified', est: false,
          color: segColor(c.segment), threat: segThreat(c.segment), brand: 'local' }));
  }
  const filtered = lastDisplayedComps.filter(c => brandVisibility[extractBrand(c.name, c.segment)] !== false);
  // v7.03 — FIX visibilité : markercluster ne rend que ce qui est dans la
  // fenêtre de la carte. Un état résiduel (présentation / showreel / analyse)
  // pouvait laisser le conteneur carte à 0 px → filtre « sans effet » (pins
  // ajoutés mais jamais affichés). On resynchronise la taille AVANT de rendre.
  try { if (typeof map !== 'undefined' && map && map.invalidateSize) map.invalidateSize(false); } catch {}
  showCompsOnMap(filtered);
  // Cohérence : afficher des concurrents = la couche « Concurrents » est active.
  try { if (filtered.length && typeof layers !== 'undefined') { layers.competitors = true; el('tglCompetitors')?.classList.add('on'); } } catch {}
  buildBrandFilters();
  const badge = el('compCountBadge'); if (badge) badge.textContent = filtered.length + '/' + lastDisplayedComps.length;
}

// ================================================================
// COMPETITOR DISPLAY
// ================================================================
function showCompsOnMap(comps) {
  compCluster.clearLayers();
  comps.forEach(c=>{
    // v6.97 — enseignes clés (World Class, Stay Fit, 18GYM, Downtown…) :
    // pin de MARQUE (favicon officiel, fallback monogramme) au lieu du
    // point coloré. Le liseré garde la couleur du segment (lecture menace).
    const brandHtml = (typeof window.brandPinHTML === 'function') ? window.brandPinHTML(c.name, c.color) : null;
    const icon = brandHtml
      ? L.divIcon({className:'', html: brandHtml, iconSize:[30,30], iconAnchor:[15,15]})
      : L.divIcon({className:'',
          html:`<div style="width:13px;height:13px;background:${c.color};border:2px solid rgba(255,255,255,.8);border-radius:50%;box-shadow:0 0 8px ${c.color}80"></div>`,
          iconSize:[13,13],iconAnchor:[7,7]});
    const dist=selectedPt?haversine(selectedPt.lat,selectedPt.lng,c.lat,c.lng):null;
    const ts=dist!==null?threatScore(c,dist):null;

    const mk=L.marker([c.lat,c.lng],{icon});
    const tierColors={W:'#a855f7',Platinum:'#e2e8f0',Gold:'#fbbf24',Silver:'#94a3b8',Bronze:'#cd7f32'};
    const tierLabel=c.tier?`<div class="ps"><span>Tier</span><span class="pv" style="color:${tierColors[c.tier]||'#fff'};font-weight:800">${c.tier}</span></div>`:'';
    const rv=getReviewData(c.name, c);
    const mA=c.members||0;
    const mB=rv?rv.mB:0;
    const mAvg=mB>0?Math.round((mA+mB)/2):mA;
    // v6.69 — vélocité des avis (série temporelle ReviewsHistory)
    const vel = window.ReviewsHistory?.velocity?.(c.name) || null;
    const velLine = vel ? `<div class="ps"><span>Vélocité avis</span><span class="pv" style="color:${vel.trendPct > 15 ? 'var(--red)' : vel.trendPct < -15 ? 'var(--green)' : 'var(--gray)'}">${vel.perMonth}/mois ${vel.trendPct != null ? (vel.trendPct > 15 ? '↗ accélère' : vel.trendPct < -15 ? '↘ ralentit' : '→ stable') : ''} <span style="font-size:8px;color:var(--gray2)">(${vel.days}j)</span></span></div>` : '';
    // Google enrichment data
    const gLine = c.gEnriched ? `
      <div style="margin-top:4px;padding-top:4px;border-top:1px solid rgba(71,85,115,.2)">
        <div style="font-size:9px;font-weight:700;color:var(--accent);margin-bottom:3px">GOOGLE PLACES <span style="font-size:7px;background:rgba(212,160,23,.15);padding:1px 4px;border-radius:3px">LIVE</span></div>
        ${c.gRating?`<div class="ps"><span>Note Google</span><span class="pv" style="color:var(--accent)">★ ${c.gRating}/5 <span style="font-size:8px;color:var(--gray2)">(${fmt(c.gReviews)} avis)</span></span></div>`:''}
        ${velLine}
        ${c.gOpen!==null?`<div class="ps"><span>Statut</span><span class="pv" style="color:${c.gOpen?'var(--green)':'var(--red)'}"> ${c.gOpen?'Ouvert maintenant':'Ferme'}</span></div>`:''}
        ${c.gWebsite?`<div class="ps"><span>Site</span><span class="pv"><a href="${c.gWebsite}" target="_blank" style="color:var(--blue);font-size:9px">Visiter ↗</a></span></div>`:''}
      </div>` : '';

    mk.bindPopup(`<h3>${c.name}${c.gEnriched?' <span style="font-size:8px;color:var(--accent)">G✓</span>':''}</h3>
      <div class="ps"><span>Segment</span><span class="pv" style="color:${c.color}">${c.segment}</span></div>
      ${tierLabel}
      <div class="ps"><span>Surface</span><span class="pv">${c.size?c.size+' m2':'N/A'} ${c.sv?'<span style="color:var(--green);font-size:8px">verifie</span>':'<span style="color:var(--yellow);font-size:8px">est.</span>'}</span></div>
      <div style="margin-top:4px;padding-top:4px;border-top:1px solid rgba(71,85,115,.2)">
        <div style="font-size:9px;font-weight:700;color:var(--cyan);margin-bottom:3px">ESTIMATION MEMBRES (2 methodes)</div>
        <div class="ps"><span>A: Surface x ratio</span><span class="pv">${fmt(mA)}</span></div>
        ${rv?`<div class="ps"><span>B: Avis/an corrige (${rv.r} avis / ${rv.age}a = ${rv.reviewsPerYear}/an × ${Math.round(rv.ageFactor*81)})</span><span class="pv">${fmt(mB)}</span></div>
        <div class="ps"><span style="font-size:8px;color:var(--gray2)">Note Google: ${rv.g}★ | Age: ~${rv.age} ans | Facteur: x${rv.ageFactor}</span></div>
        <div class="ps"><span><b>Moyenne A+B</b></span><span class="pv" style="font-weight:800;color:var(--cyan)">${fmt(mAvg)}</span></div>`
        :`<div class="ps"><span>B: Reviews</span><span class="pv" style="color:var(--gray2)">N/A</span></div>`}
      </div>
      ${gLine}
      ${dist!==null?`<div class="ps"><span>Distance</span><span class="pv">${(dist/1000).toFixed(2)} km${c.driveMins!==undefined?' <span style="color:var(--blue);font-size:9px">🚗 '+c.driveMins+' min</span>':''}</span></div>`:''}
      ${ts!==null?`<div class="ps"><span>Menace</span><span class="pv" style="color:${ts>70?'var(--red)':ts>40?'var(--yellow)':'var(--green)'}">${ts}/100${c.driveMins!==undefined?' <span style="font-size:8px;color:var(--gray2)">(temps reel)</span>':''}</span></div>`:''}
      <div class="ps"><span>Prix</span><span class="pv">${c.price || (COMP_PRICES[c.segment] ? '~'+COMP_PRICES[c.segment] : '?')} EUR/mois</span></div>
      <button onclick="openRouteTo(${c.lat},${c.lng},'${encodeURIComponent(c.name || 'Concurrent')}')" style="width:100%;margin-top:8px;padding:8px;border-radius:8px;border:none;background:linear-gradient(135deg,#d4a017,#b8860b);color:#0a0d16;font-size:11px;font-weight:800;cursor:pointer;font-family:var(--font)">🧭 Itinéraire vers mon club</button>
    `);
    compCluster.addLayer(mk);
  });
}

// ═══════════════════════════════════════════════════════════════════
// v7.05 — ITINÉRAIRES : d'un concurrent vers MON club (OSRM, gratuit)
// Bouton 🧭 dans le popup concurrent → trace la route (voiture + à pied)
// vers le site FP le plus proche, avec durées/distances réelles.
// ═══════════════════════════════════════════════════════════════════
let fpRouteLayer = null;
let _fpRouteData = null;

function _decodePolyline(str, precision) {
  let index = 0, lat = 0, lng = 0, coords = [], factor = Math.pow(10, precision || 5), b;
  while (index < str.length) {
    let result = 1, shift = 0;
    do { b = str.charCodeAt(index++) - 63 - 1; result += b << shift; shift += 5; } while (b >= 0x1f);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    result = 1; shift = 0;
    do { b = str.charCodeAt(index++) - 63 - 1; result += b << shift; shift += 5; } while (b >= 0x1f);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    coords.push([lat / factor, lng / factor]);
  }
  return coords;
}

// Mon club le plus proche du concurrent : TARGETS + sites custom + point sélectionné.
function _nearestMySite(lat, lng) {
  const sites = [];
  try { if (typeof TARGETS !== 'undefined') TARGETS.forEach(t => sites.push({ name: t.name, lat: t.lat, lng: t.lng })); } catch {}
  try { (window.customSites || []).filter(s => !s.deletedAt).forEach(s => sites.push({ name: s.name, lat: s.lat, lng: s.lng })); } catch {}
  try { if (typeof selectedPt !== 'undefined' && selectedPt) sites.push({ name: 'Point sélectionné', lat: selectedPt.lat, lng: selectedPt.lng }); } catch {}
  let best = null, bd = Infinity;
  sites.forEach(s => { const d = haversine(lat, lng, s.lat, s.lng); if (d < bd) { bd = d; best = s; } });
  return best;
}

async function _osrmRoute(profile, from, to) {
  const path = profile === 'foot' ? 'routed-foot/route/v1/foot' : 'routed-car/route/v1/driving';
  const url = `https://routing.openstreetmap.de/${path}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=polyline`;
  const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = ac ? setTimeout(() => ac.abort(), 8000) : null;
  try {
    const r = await fetch(url, { signal: ac ? ac.signal : undefined });
    if (t) clearTimeout(t);
    const j = await r.json();
    const rt = j.routes && j.routes[0];
    if (!rt) return null;
    return { coords: _decodePolyline(rt.geometry, 5), min: Math.round(rt.duration / 60), km: +(rt.distance / 1000).toFixed(2) };
  } catch { if (t) clearTimeout(t); return null; }
}

async function openRouteTo(compLat, compLng, compNameEnc) {
  const compName = (() => { try { return decodeURIComponent(compNameEnc || ''); } catch { return String(compNameEnc || ''); } })();
  const mine = _nearestMySite(compLat, compLng);
  if (!mine) { try { window.showToast?.('Ajoute d’abord un de tes sites (onglet Mes Sites) pour tracer un itinéraire.', 'warn', { title: 'Itinéraire' }); } catch {} return; }
  try { map.closePopup(); } catch {}
  showLoad('Calcul de l’itinéraire…', `${compName} → ${mine.name}`);
  const from = { lat: compLat, lng: compLng }, to = { lat: mine.lat, lng: mine.lng };
  const [car, foot] = await Promise.all([_osrmRoute('car', from, to), _osrmRoute('foot', from, to)]);
  hideLoad();
  if (!car && !foot) { try { window.showToast?.('Service d’itinéraire momentanément indisponible — réessaie.', 'error', { title: 'Itinéraire' }); } catch {} return; }
  _fpRouteData = { car, foot, from, to, compName, mineName: mine.name, mode: car ? 'car' : 'foot' };
  _drawRoute(_fpRouteData.mode);
  _renderRouteCard();
}
window.openRouteTo = openRouteTo;

function _drawRoute(mode) {
  const d = _fpRouteData; if (!d || !d[mode]) return;
  d.mode = mode;
  if (fpRouteLayer) { try { map.removeLayer(fpRouteLayer); } catch {} }
  fpRouteLayer = L.layerGroup().addTo(map);
  const route = d[mode];
  const col = mode === 'car' ? '#d4a017' : '#06b6d4';
  L.polyline(route.coords, { color: '#05070d', opacity: .45, weight: 10, lineCap: 'round' }).addTo(fpRouteLayer);      // ombre douce
  L.polyline(route.coords, { color: col, weight: 5, opacity: .96, dashArray: mode === 'foot' ? '1,11' : null, lineCap: 'round', lineJoin: 'round' }).addTo(fpRouteLayer);
  L.circleMarker([d.from.lat, d.from.lng], { radius: 7, color: '#fff', fillColor: '#ef4444', fillOpacity: 1, weight: 2 })
    .bindTooltip('🏋 ' + d.compName, { direction: 'top', offset: [0, -6] }).addTo(fpRouteLayer);
  L.circleMarker([d.to.lat, d.to.lng], { radius: 8, color: '#fff', fillColor: '#d4a017', fillOpacity: 1, weight: 2 })
    .bindTooltip('📍 ' + d.mineName + ' (mon club)', { direction: 'top', offset: [0, -6] }).addTo(fpRouteLayer);
  try { map.fitBounds(L.latLngBounds(route.coords), { paddingTopLeft: [560, 80], paddingBottomRight: [60, 120], maxZoom: 15 }); } catch {}
}

function setRouteMode(mode) { _drawRoute(mode); _renderRouteCard(); }
window.setRouteMode = setRouteMode;

function closeRoute() {
  if (fpRouteLayer) { try { map.removeLayer(fpRouteLayer); } catch {} fpRouteLayer = null; }
  _fpRouteData = null;
  document.getElementById('fpRouteCard')?.remove();
}
window.closeRoute = closeRoute;

function _renderRouteCard() {
  const d = _fpRouteData; if (!d) return;
  document.getElementById('fpRouteCard')?.remove();
  const esc = (typeof escapeHtml === 'function') ? escapeHtml : (s => String(s || ''));
  const gmaps = `https://www.google.com/maps/dir/${d.from.lat},${d.from.lng}/${d.to.lat},${d.to.lng}`;
  const active = d.mode;
  const chip = (m, ico, label) => {
    const avail = !!d[m]; const on = active === m;
    const col = m === 'car' ? '#d4a017' : '#06b6d4';
    return `<button ${avail ? '' : 'disabled'} onclick="setRouteMode('${m}')" style="flex:1;padding:7px 4px;border-radius:9px;border:1px solid ${on ? col : 'rgba(71,85,115,.4)'};background:${on ? col + '22' : 'transparent'};color:${avail ? (on ? '#fff' : 'var(--gray)') : 'var(--gray2)'};font-size:11px;font-weight:700;cursor:${avail ? 'pointer' : 'not-allowed'};font-family:var(--font);transition:all .2s;opacity:${avail ? 1 : .4}">${ico} ${label}</button>`;
  };
  const cur = d[active];
  const line = (m, ico) => d[m] ? `<span style="color:${m === 'car' ? '#d4a017' : '#06b6d4'};font-weight:700">${ico} ${d[m].min} min</span> <span style="color:var(--gray2)">· ${d[m].km} km</span>` : `<span style="color:var(--gray2)">${ico} —</span>`;
  const card = document.createElement('div');
  card.id = 'fpRouteCard';
  card.style.cssText = 'position:fixed;right:18px;bottom:96px;z-index:1200;width:248px;background:linear-gradient(160deg,rgba(15,21,36,.96),rgba(9,13,24,.94));backdrop-filter:blur(16px);border:1px solid rgba(212,160,23,.4);border-radius:16px;padding:15px 16px;box-shadow:0 22px 60px rgba(0,0,0,.6);font-family:var(--font);animation:fpWowIn .4s cubic-bezier(.16,1,.3,1) both';
  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <div style="font-size:11px;font-weight:800;letter-spacing:1.5px;color:var(--accent)">🧭 ITINÉRAIRE</div>
      <button onclick="closeRoute()" style="background:transparent;border:none;color:var(--gray);font-size:16px;cursor:pointer;line-height:1">✕</button>
    </div>
    <div style="font-size:12px;color:var(--white);font-weight:600;line-height:1.4;margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:6px"><span style="width:8px;height:8px;border-radius:50%;background:#ef4444;flex-shrink:0"></span>${esc(d.compName)}</div>
      <div style="color:var(--gray2);font-size:14px;margin:1px 0 1px 3px">↓</div>
      <div style="display:flex;align-items:center;gap:6px"><span style="width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0"></span>${esc(d.mineName)} <span style="font-size:9px;color:var(--gray2)">(mon club)</span></div>
    </div>
    <div style="display:flex;gap:7px;margin-bottom:11px">${chip('car', '🚗', 'Voiture')}${chip('foot', '🚶', 'À pied')}</div>
    <div style="text-align:center;padding:8px 0;background:rgba(0,0,0,.25);border-radius:10px;margin-bottom:10px">
      <div style="font-size:30px;font-weight:900;font-family:var(--font-display,var(--font));color:${active === 'car' ? '#d4a017' : '#06b6d4'};line-height:1">${cur ? cur.min : '—'}<span style="font-size:14px;font-weight:700"> min</span></div>
      <div style="font-size:11px;color:var(--gray2);margin-top:2px">${cur ? cur.km + ' km' : ''} · ${active === 'car' ? 'en voiture' : 'à pied'}</div>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:11px;padding:0 2px">${line('car', '🚗')}${line('foot', '🚶')}</div>
    <a href="${gmaps}" target="_blank" rel="noopener" style="display:block;text-align:center;font-size:10px;color:var(--gray);text-decoration:none;border:1px solid var(--border);border-radius:8px;padding:6px">Ouvrir dans Google Maps ↗</a>`;
  document.body.appendChild(card);
}

function displayComps(comps,refLat,refLng) {
  lastDisplayedComps = comps; // store for brand filtering
  el('compCountBadge').textContent=comps.length;

  const sorted=comps.map(c=>({...c,dist:haversine(refLat,refLng,c.lat,c.lng)}))
    .map(c=>({...c,ts:threatScore(c,c.dist)}))
    .sort((a,b)=>b.ts-a.ts);

  el('compList').innerHTML=sorted.length===0
    ?'<p style="font-size:12px;color:var(--gray2);padding:10px">Aucun concurrent dans le rayon — <strong style="color:var(--green)">Zone blanche</strong></p>'
    :sorted.map(c=>{
      const tierBadge=c.tier?`<span style="color:${({W:'#a855f7',Platinum:'#e2e8f0',Gold:'#fbbf24',Silver:'#94a3b8',Bronze:'#cd7f32'})[c.tier]||'#fff'};font-weight:700;font-size:9px;background:rgba(255,255,255,.06);padding:1px 4px;border-radius:3px">${c.tier}</span>`:'';
      return `
    <div class="comp-card" onclick="map.flyTo([${c.lat},${c.lng}],16)">
      <div class="comp-dot" style="color:${c.color};background:${c.color}"></div>
      <div class="comp-body">
        <div class="comp-name">${c.name} ${tierBadge} ${c.est?'<span class="badge-est">est.</span>':''}${c.gEnriched?'<span style="color:var(--accent);font-size:8px;margin-left:3px">G✓</span>':''}</div>
        <div class="comp-meta">${c.segment} | ${(c.dist/1000).toFixed(1)}km${c.driveMins!==undefined?' • '+c.driveMins+'min':''} | ${c.size?c.size+'m2':'?'} | ${c.members?fmt(c.members)+' mbr':''}${c.gRating?' | ★'+c.gRating:''}</div>
      </div>
      <div class="comp-threat" style="color:${c.ts>70?'var(--red)':c.ts>40?'var(--yellow)':'var(--green)'}">${c.ts}</div>
    </div>`}).join('');

  // Summary
  const prem=sorted.filter(c=>c.segment==='premium').length;
  const mid=sorted.filter(c=>['mid','mid-premium'].includes(c.segment)).length;
  const low=sorted.filter(c=>['lowcost','independent','crossfit','boutique'].includes(c.segment)).length;
  const avgT=sorted.length?Math.round(sorted.reduce((a,c)=>a+c.ts,0)/sorted.length):0;
  const closest=sorted.length?sorted.sort((a,b)=>a.dist-b.dist)[0]:null;

  // Estimated total addressable members in zone
  const totalMembers=sorted.reduce((a,c)=>a+(c.members||0),0);
  const sector=findSector(refLat,refLng);
  const popTarget=sector?Math.round(sector.pop*sector.youngPct):0;
  const penetration=popTarget>0?((totalMembers/popTarget)*100).toFixed(1):0;
  // Market gap estimation
  const targetPenetration=10; // EU avg fitness penetration
  const potentialMembers=popTarget>0?Math.round(popTarget*targetPenetration/100):0;
  const gap=potentialMembers-totalMembers;
  const revenueEstimate=gap>0?Math.round(gap*23.14*12/1000):0;

  el('compSummary').innerHTML=`
    <div class="metric-row"><span class="metric-label">Total concurrents</span><span class="metric-value">${comps.length}</span></div>
    <div class="metric-row"><span class="metric-label">Premium (concurrent direct)</span><span class="metric-value" style="color:var(--red)">${prem}</span></div>
    <div class="metric-row"><span class="metric-label">Mid-range</span><span class="metric-value" style="color:var(--orange)">${mid}</span></div>
    <div class="metric-row"><span class="metric-label">Low-cost / Independant</span><span class="metric-value" style="color:var(--green)">${low}</span></div>
    <div class="metric-row"><span class="metric-label">Score menace moyen</span><span class="metric-value" style="color:${avgT>60?'var(--red)':avgT>35?'var(--yellow)':'var(--green)'}">${avgT}/100</span></div>
    ${closest?`<div class="metric-row"><span class="metric-label">Concurrent le + proche</span><span class="metric-value" style="font-size:10px">${closest.name}<br>(${(closest.dist/1000).toFixed(1)}km)</span></div>`:''}
    <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">
      <div class="metric-row"><span class="metric-label">Membres estimes zone</span><span class="metric-value">${fmt(totalMembers)} <span class="badge-est">est.</span></span></div>
      <div class="metric-row"><span class="metric-label">Penetration estimee</span><span class="metric-value">${penetration}%</span></div>
      <div class="metric-row"><span class="metric-label">Cible 10% penetration UE</span><span class="metric-value">${fmt(potentialMembers)}</span></div>
      <div class="metric-row"><span class="metric-label">Gap (opportunite)</span><span class="metric-value" style="color:${gap>0?'var(--green)':'var(--red)'}">${gap>0?'+':''}${fmt(gap)} membres</span></div>
      <div class="metric-row"><span class="metric-label">Pot. CA annuel (gap x panier)</span><span class="metric-value" style="color:var(--green)">${revenueEstimate>0?revenueEstimate+'k EUR':'-'}</span></div>
    </div>
  `;

  showCompsOnMap(sorted);
  buildBrandFilters(allComps.length ? allComps : comps);
}

// ================================================================
// CHARTS
// ================================================================
let segChart,gapChrt,finChart,priceChart;

function initCharts() {
  Chart.defaults.color='#8899b0';
  Chart.defaults.borderColor='rgba(71,85,115,.2)';
  Chart.defaults.font.family="'Inter',sans-serif";

  segChart=new Chart(el('segmentChart'),{
    type:'doughnut',
    data:{labels:['Premium','Mid-range','Low-cost','Independant','CrossFit/Boutique'],datasets:[{data:[0,0,0,0,0],backgroundColor:['#ef4444','#f97316','#eab308','#22c55e','#8b5cf6'],borderWidth:0,hoverOffset:6}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:'65%',plugins:{legend:{position:'right',labels:{boxWidth:8,font:{size:10},padding:8}}}}
  });

  gapChrt=new Chart(el('gapChart'),{
    type:'bar',
    data:{
      labels:SECTORS.map(s=>'S'+s.id+' '+s.desc.split(',')[0]),
      datasets:[
        {label:'Pop. cible 15-45 (k)',data:SECTORS.map(s=>Math.round(s.pop*s.youngPct/1000)),backgroundColor:'rgba(59,130,246,.5)',borderColor:'#3b82f6',borderWidth:1,borderRadius:4,order:2},
        {label:'Concurrents detectes',data:[0,0,0,0,0,0],backgroundColor:'rgba(239,68,68,.5)',borderColor:'#ef4444',borderWidth:1,borderRadius:4,order:1},
        {label:'Ratio pop/conc. (k)',data:[0,0,0,0,0,0],type:'line',borderColor:'#22c55e',backgroundColor:'transparent',borderWidth:2,pointRadius:4,pointBackgroundColor:'#22c55e',yAxisID:'y1',order:0}
      ]
    },
    options:{responsive:true,maintainAspectRatio:false,
      scales:{x:{grid:{display:false},ticks:{font:{size:9},maxRotation:30}},y:{grid:{color:'rgba(71,85,115,.15)'},ticks:{font:{size:9}}},y1:{position:'right',grid:{display:false},ticks:{font:{size:9},color:'#22c55e'}}},
      plugins:{legend:{labels:{boxWidth:8,font:{size:9.5},padding:6}}}
    }
  });

  finChart=new Chart(el('finChart'),{
    type:'line',
    data:{
      labels:['Y0','A1','A2','A3','A4','A5','A6','A7','A8','A9','A10'],
      datasets:[
        {label:'CA Enseigne (M EUR)',data:[0,0.44,1.95,4.9,11.5,18.9,31.0,40.5,45.8,49.0,51.3],borderColor:'#3b82f6',backgroundColor:'rgba(59,130,246,.08)',fill:true,tension:.35,pointRadius:3,pointHoverRadius:5},
        {label:'EBITDA (M EUR)',data:[-0.1,-0.3,-0.1,0.4,1.1,1.9,3.1,3.3,5.6,8.0,9.6],borderColor:'#22c55e',backgroundColor:'rgba(34,197,94,.08)',fill:true,tension:.35,pointRadius:3,pointHoverRadius:5},
        {label:'Clubs cumul.',data:[0,1,3,7,16,26,37,38,40,40,40],borderColor:'#eab308',borderDash:[5,3],yAxisID:'y1',tension:.3,pointRadius:2}
      ]
    },
    options:{responsive:true,maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      scales:{x:{grid:{display:false}},y:{grid:{color:'rgba(71,85,115,.15)'}},y1:{position:'right',grid:{display:false},ticks:{color:'#eab308'}}},
      plugins:{legend:{labels:{boxWidth:8,font:{size:9.5}}},tooltip:{backgroundColor:'rgba(17,24,39,.95)',borderColor:'rgba(71,85,115,.5)',borderWidth:1,titleFont:{weight:'700'},bodyFont:{size:11}}}
    }
  });

  priceChart=new Chart(el('pricingChart'),{
    type:'bar',
    data:{
      labels:['Fitness Park\n28 EUR','Nr1 Fitness\n30 EUR','Stay Fit\n32 EUR','18GYM\n36 EUR','Downtown\n42 EUR','World Class\n(Bronze) 46 EUR','World Class\n(Gold+) 80-145 EUR'],
      datasets:[{
        data:[28,30,32,36,42,46,145],
        backgroundColor:['rgba(212,160,23,.7)','#f97316','#f97316','#f97316','#f97316','#ef4444','#ef4444'],
        borderRadius:4,borderWidth:0
      }]
    },
    options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',
      scales:{x:{grid:{color:'rgba(71,85,115,.15)'},title:{display:true,text:'EUR/mois',font:{size:9},color:'var(--gray2)'}},y:{grid:{display:false},ticks:{font:{size:9}}}},
      plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>ctx.raw+' EUR/mois'}}}
    }
  });
}

function updateSegChart(comps) {
  const p=comps.filter(c=>c.segment==='premium').length;
  const m=comps.filter(c=>['mid','mid-premium'].includes(c.segment)).length;
  const l=comps.filter(c=>c.segment==='lowcost').length;
  const i=comps.filter(c=>c.segment==='independent').length;
  const x=comps.filter(c=>['crossfit','boutique'].includes(c.segment)).length;
  segChart.data.datasets[0].data=[p,m,l,i,x];
  segChart.update();
  try { window._fpMobile?.refreshClonedCharts?.(); } catch {}
}

function updateGapChart(counts) {
  gapChrt.data.datasets[1].data=counts;
  gapChrt.data.datasets[2].data=SECTORS.map((s,i)=>{
    const popK=Math.round(s.pop*s.youngPct/1000);
    return counts[i]>0?Math.round(popK/counts[i]):popK;
  });
  gapChrt.update();
  try { window._fpMobile?.refreshClonedCharts?.(); } catch {}
}

// ================================================================
// DASHBOARD
// ================================================================
function addZone(lat,lng,sector,saz,comps) {
  const closest=comps.length>0?comps.reduce((a,c)=>{const d=haversine(lat,lng,c.lat,c.lng);return d<a.d?{n:c.name,d}:a},{n:'',d:Infinity}):null;

  const popTarget=sector?Math.round(sector.pop*sector.youngPct):0;
  const totalMembers=comps.reduce((a,c)=>a+(c.members||0),0);
  const gap=popTarget>0?Math.round(popTarget*.10)-totalMembers:0;
  const potCA=gap>0?Math.round(gap*23.14*12/1000):0;

  const z={
    name:sector?sector.name:`${lat.toFixed(3)},${lng.toFixed(3)}`,
    lat,lng,pop:sector?sector.pop:0,popTarget,
    saz:saz.total,nbComp:comps.length,
    closest:closest?`${closest.n} (${(closest.d/1000).toFixed(1)}km)`:'-',
    potCA,
    reco:saz.total>=70?'GO':saz.total>=45?'PRUDENCE':'NO-GO'
  };

  const idx=zones.findIndex(x=>x.name===z.name);
  if(idx>=0)zones[idx]=z;else zones.push(z);
  renderDash();
}

function updateCompareSelects() {
  const allSites = [...zones.map(z=>({name:z.name,lat:z.lat,lng:z.lng})), ...TARGETS.map(t=>({name:t.name,lat:t.lat,lng:t.lng})), ...customSites.filter(s=>!s.deletedAt).map(s=>({name:s.name,lat:s.lat,lng:s.lng}))];
  // Dedupe by name
  const unique = [];
  allSites.forEach(s=>{if(!unique.find(u=>u.name===s.name))unique.push(s)});
  const opts = '<option value="">-- Choisir --</option>' + unique.map(s=>`<option value="${s.lat},${s.lng}">${s.name}</option>`).join('');
  if(el('compareA')) el('compareA').innerHTML = opts;
  if(el('compareB')) el('compareB').innerHTML = opts;
}

async function runComparison() {
  const vA = el('compareA')?.value;
  const vB = el('compareB')?.value;
  if(!vA || !vB) { el('comparisonResult').innerHTML='<p style="font-size:11px;color:var(--gray2)">Selectionnez 2 sites</p>'; return; }
  const [latA,lngA] = vA.split(',').map(Number);
  const [latB,lngB] = vB.split(',').map(Number);
  const nameA = el('compareA').selectedOptions[0].textContent;
  const nameB = el('compareB').selectedOptions[0].textContent;

  const cA = runCaptageAnalysis(latA, lngA, 3000);
  const cB = runCaptageAnalysis(latB, lngB, 3000);

  const dist = haversine(latA,lngA,latB,lngB);
  const cannibal = await cannibalizeRisk({lat:latA,lng:lngA},{lat:latB,lng:lngB});

  function bar(a,b,label){
    const max=Math.max(a,b,1);
    const pA=Math.round(a/max*100);const pB=Math.round(b/max*100);
    const better=a>b?'A':a<b?'B':'=';
    return `<div style="margin-bottom:6px">
      <div style="display:flex;justify-content:space-between;font-size:9px;margin-bottom:2px"><span>${label}</span></div>
      <div style="display:flex;gap:4px;align-items:center">
        <span style="font-size:10px;font-weight:700;width:45px;text-align:right;color:${better==='A'?'var(--green)':'var(--gray)'}">${fmt(a)}</span>
        <div style="flex:1;display:flex;height:8px;border-radius:4px;overflow:hidden;background:var(--bg)">
          <div style="width:${pA}%;background:var(--cyan);border-radius:4px 0 0 4px"></div>
          <div style="width:${100-pA}%"></div>
        </div>
        <div style="flex:1;display:flex;height:8px;border-radius:4px;overflow:hidden;background:var(--bg)">
          <div style="width:${100-pB}%"></div>
          <div style="width:${pB}%;background:#f97316;border-radius:0 4px 4px 0"></div>
        </div>
        <span style="font-size:10px;font-weight:700;width:45px;color:${better==='B'?'var(--green)':'var(--gray)'}">${fmt(b)}</span>
      </div>
    </div>`;
  }

  el('comparisonResult').innerHTML = `
    <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:10px;font-weight:700">
      <span style="color:var(--cyan)">${nameA}</span>
      <span style="color:var(--gray2)">${(dist/1000).toFixed(1)}km</span>
      <span style="color:#f97316">${nameB}</span>
    </div>
    ${bar(cA.saz.total,cB.saz.total,'SAZ Score')}
    ${bar(cA.saz.flux,cB.saz.flux,'Flux')}
    ${bar(cA.saz.densite,cB.saz.densite,'Densite')}
    ${bar(cA.saz.jeunesse,cB.saz.jeunesse,'Jeunesse')}
    ${bar(cA.totalTheorique,cB.totalTheorique,'Membres theoriques')}
    ${bar(cA.totalCaptifs,cB.totalCaptifs,'Captifs concurrents')}
    ${bar(cA.native.captured,cB.native.captured,'Natifs')}
    ${bar(cA.walkIn.walkInMembers,cB.walkIn.walkInMembers,'Walk-in mall')}
    ${bar(cA.comps.length,cB.comps.length,'Nb concurrents (3km)')}
    ${bar(cA.popTarget,cB.popTarget,'Pop. cible 15-45')}
    <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-size:10px">
      <div class="metric-row"><span class="metric-label">Distance entre sites</span><span class="metric-value">${(dist/1000).toFixed(1)} km</span></div>
      <div class="metric-row"><span class="metric-label">Cannibalisation</span><span class="metric-value" style="color:${cannibal.risk==='critique'?'var(--red)':cannibal.risk==='significatif'?'var(--orange)':'var(--green)'}">${cannibal.risk} (${cannibal.pct}%)</span></div>
      <div class="metric-row"><span class="metric-label"><b>Meilleur site</b></span><span class="metric-value" style="color:var(--green);font-weight:800">${cA.totalTheorique>cB.totalTheorique?nameA:nameB} (+${Math.abs(cA.totalTheorique-cB.totalTheorique)} mbr)</span></div>
    </div>
  `;
}

function renderDash() {
  el('dashBody').innerHTML=zones.sort((a,b)=>b.saz-a.saz).map(z=>`
    <tr onclick="map.flyTo([${z.lat},${z.lng}],14)" style="cursor:pointer">
      <td><b>${z.name}</b></td>
      <td>${fmt(z.pop)}</td>
      <td>${fmt(z.popTarget)}</td>
      <td style="font-weight:800;color:${z.saz>=70?'var(--green)':z.saz>=45?'var(--yellow)':'var(--red)'}">${z.saz}</td>
      <td>${z.nbComp}</td>
      <td style="font-size:10px;max-width:100px;overflow:hidden;text-overflow:ellipsis">${z.closest}</td>
      <td style="color:var(--green);font-weight:600">${z.potCA>0?z.potCA+'k':'-'}</td>
      <td class="reco-${z.reco.toLowerCase().replace('-','')}-text">${z.reco}</td>
    </tr>
  `).join('');
  updateCompareSelects();
}

function sortTable(col) {
  const keys=['name','pop','popTarget','saz','nbComp','closest','potCA','reco'];
  const k=keys[col];
  zones.sort((a,b)=>typeof a[k]==='string'?a[k].localeCompare(b[k]):b[k]-a[k]);
  renderDash();
}

function exportCSV() {
  if(!zones.length) return alert('Aucune zone analysee');
  const h='Zone,Population,Pop 15-45,SAZ,Concurrents,Plus proche,Pot CA (kEUR),Recommandation\n';
  const r=zones.map(z=>`${z.name},${z.pop},${z.popTarget},${z.saz},${z.nbComp},"${z.closest}",${z.potCA},${z.reco}`).join('\n');
  const b=new Blob([h+r],{type:'text/csv'});
  const u=URL.createObjectURL(b);const a=document.createElement('a');a.href=u;a.download='fp_romania_analysis.csv';a.click();URL.revokeObjectURL(u);
}

// ================================================================
// SITE CARD
// ================================================================
function genSiteCard(lat,lng,sector,saz,comps) {
  const sorted=comps.map(c=>({...c,dist:haversine(lat,lng,c.lat,c.lng)})).map(c=>({...c,ts:threatScore(c,c.dist)})).sort((a,b)=>a.dist-b.dist);
  const top5=sorted.slice(0,5);
  const reco=saz.total>=70?'GO':saz.total>=45?'PRUDENCE':'NO-GO';
  const recoCls=reco==='GO'?'reco-go':reco==='PRUDENCE'?'reco-caution':'reco-nogo';
  const sazCls=saz.total>=70?'good':saz.total>=45?'medium':'bad';

  const totalMembers=comps.reduce((a,c)=>a+(c.members||0),0);
  const popTarget=sector?Math.round(sector.pop*sector.youngPct):0;
  const penetration=popTarget>0?((totalMembers/popTarget)*100).toFixed(1):0;
  const gap=popTarget>0?Math.round(popTarget*.10)-totalMembers:0;

  let recoText;
  if(saz.total>=70) recoText='<strong style="color:var(--green)">Zone a fort potentiel.</strong> La combinaison d\'une population cible dense, d\'un pouvoir d\'achat favorable et d\'une pression concurrentielle moderee en fait un candidat prioritaire pour l\'implantation. La penetration fitness actuelle estimee a '+penetration+'% laisse un gap de marche de '+fmt(Math.max(0,gap))+' membres potentiels. Recommandation : <strong>poursuivre l\'analyse detaillee</strong> (negociation bail, etude de surface, visibilite).';
  else if(saz.total>=45) recoText='<strong style="color:var(--yellow)">Zone a potentiel modere.</strong> La pression concurrentielle ('+comps.length+' acteurs dans le rayon) et/ou le profil socio-demographique requierent une analyse approfondie. La penetration estimee de '+penetration+'% est '+(parseFloat(penetration)>5?'deja significative':'encore modeste')+'. Recommandation : <strong>analyse complementaire</strong> avant engagement — evaluer les conditions locatives et la visibilite du local.';
  else recoText='<strong style="color:var(--red)">Zone defavorable a l\'implantation.</strong> Le ratio population cible / concurrence est insuffisant pour garantir la viabilite du modele economique FP (objectif: 4,000 adherents a maturite). La penetration estimee de '+penetration+'% avec '+comps.length+' concurrents existants laisse peu de marge. Recommandation : <strong>explorer d\'autres localisations</strong>.';

  el('siteCardContent').innerHTML=`
    <div class="sc-section animate-in">
      <h3>&#128205; Localisation</h3>
      <div class="metric-row"><span class="metric-label">Coordonnees</span><span class="metric-value" style="font-family:var(--mono);font-size:10px">${lat.toFixed(4)}, ${lng.toFixed(4)}</span></div>
      <div class="metric-row"><span class="metric-label">Secteur</span><span class="metric-value">${sector?sector.name:'N/A'}</span></div>
      <div class="metric-row"><span class="metric-label">Quartier</span><span class="metric-value" style="font-size:10px">${sector?sector.desc:'N/A'}</span></div>
      <div class="metric-row"><span class="metric-label">Rayon d'analyse</span><span class="metric-value">${radius/1000} km</span></div>
    </div>

    <div class="sc-section animate-in">
      <h3>&#127919; Score Attractivite (SAZ) <span class="${recoCls} reco-chip" style="font-size:10px;margin-left:auto">${reco}</span></h3>
      <div style="text-align:center;padding:12px 0">
        <div class="saz-number ${sazCls}" style="font-size:48px">${saz.total}</div>
        <div class="saz-sublabel">sur 100</div>
      </div>
      <div class="metric-row"><span class="metric-label">Pop. 15-45</span><span class="metric-weight">25%</span><div class="metric-bar"><div class="metric-fill" style="width:${saz.pop}%;background:${saz.pop>=70?'var(--green)':saz.pop>=45?'var(--yellow)':'var(--red)'}"></div></div><span class="metric-value">${saz.pop}</span></div>
      <div class="metric-row"><span class="metric-label">Densite</span><span class="metric-weight">15%</span><div class="metric-bar"><div class="metric-fill" style="width:${saz.density}%;background:${saz.density>=70?'var(--green)':saz.density>=45?'var(--yellow)':'var(--red)'}"></div></div><span class="metric-value">${saz.density}</span></div>
      <div class="metric-row"><span class="metric-label">Pouvoir achat</span><span class="metric-weight">20%</span><div class="metric-bar"><div class="metric-fill" style="width:${saz.income}%;background:${saz.income>=70?'var(--green)':saz.income>=45?'var(--yellow)':'var(--red)'}"></div></div><span class="metric-value">${saz.income}</span></div>
      <div class="metric-row"><span class="metric-label">Pratique sport</span><span class="metric-weight">10%</span><div class="metric-bar"><div class="metric-fill" style="width:${saz.sport}%;background:${saz.sport>=70?'var(--green)':saz.sport>=45?'var(--yellow)':'var(--red)'}"></div></div><span class="metric-value">${saz.sport}</span></div>
      <div class="metric-row"><span class="metric-label">Concurrence inv.</span><span class="metric-weight">20%</span><div class="metric-bar"><div class="metric-fill" style="width:${saz.comp}%;background:${saz.comp>=70?'var(--green)':saz.comp>=45?'var(--yellow)':'var(--red)'}"></div></div><span class="metric-value">${saz.comp}</span></div>
      <div class="metric-row"><span class="metric-label">Transport</span><span class="metric-weight">10%</span><div class="metric-bar"><div class="metric-fill" style="width:${saz.transport}%;background:${saz.transport>=70?'var(--green)':saz.transport>=45?'var(--yellow)':'var(--red)'}"></div></div><span class="metric-value">${saz.transport}</span></div>
    </div>

    <div class="sc-section animate-in">
      <h3>&#128202; Demographie & marche</h3>
      ${sector?`
        <div class="metric-row"><span class="metric-label">Pop. totale secteur</span><span class="metric-value">${fmt(sector.pop)} hab.</span></div>
        <div class="metric-row"><span class="metric-label">Pop. cible 15-45 (${Math.round(sector.youngPct*100)}%)</span><span class="metric-value">${fmt(Math.round(sector.pop*sector.youngPct))}</span></div>
        <div class="metric-row"><span class="metric-label">Surface secteur</span><span class="metric-value">${sector.area} km2</span></div>
        <div class="metric-row"><span class="metric-label">Densite</span><span class="metric-value">${fmt(Math.round(sector.pop/sector.area))} hab/km2</span></div>
        <div class="metric-row"><span class="metric-label">Niveau revenu</span><span class="metric-value">${sector.income}</span></div>
        <div class="metric-row"><span class="metric-label">Loyer proxy</span><span class="metric-value">${sector.rentProxy} EUR/m2 <span class="badge-est">est.</span></span></div>
        <div class="metric-row"><span class="metric-label">Membres fitness estimes</span><span class="metric-value">${fmt(totalMembers)} <span class="badge-est">est.</span></span></div>
        <div class="metric-row"><span class="metric-label">Penetration estimee</span><span class="metric-value">${penetration}%</span></div>
        <div class="metric-row"><span class="metric-label">Gap vs 10% UE</span><span class="metric-value" style="color:${gap>0?'var(--green)':'var(--red)'}">${gap>0?'+':''}${fmt(gap)} mbr</span></div>
      `:'<p style="color:var(--gray2);font-size:12px">Hors zone Bucarest</p>'}
    </div>

    <div class="sc-section animate-in">
      <h3>&#128165; Top 5 concurrents <span class="badge badge-blue">${comps.length} total</span></h3>
      ${top5.length>0?top5.map((c,i)=>`
        <div class="comp-card" style="cursor:default">
          <div style="font-weight:800;color:var(--gray2);width:16px;font-size:13px">${i+1}</div>
          <div class="comp-dot" style="color:${c.color};background:${c.color}"></div>
          <div class="comp-body">
            <div class="comp-name">${c.name}</div>
            <div class="comp-meta">${c.segment} | ${(c.dist/1000).toFixed(1)}km | menace ${c.ts}/100</div>
          </div>
        </div>
      `).join(''):'<p style="color:var(--green);font-size:12px;padding:8px 0">Aucun concurrent — Zone blanche &#9989;</p>'}
    </div>

    <div class="sc-section animate-in">
      <h3>&#128161; Synthese & recommandation</h3>
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:14px;font-size:11.5px;line-height:1.7;color:var(--gray)">
        ${recoText}
      </div>
    </div>

    <div class="sc-section animate-in">
      <h3>&#128221; Notes</h3>
      <textarea class="notes-area" placeholder="Ajoutez vos observations, contraintes bail, surface disponible..."></textarea>
    </div>

    <div style="text-align:center;margin-top:14px">
      <button class="btn btn-primary" onclick="printCard()">Imprimer / Exporter fiche</button>
    </div>
  `;
}

function printCard() {
  const siteContent = el('siteCardContent')?.innerHTML || '';
  const captageContent = el('captageContentSite')?.innerHTML || '';
  const analysisContent = el('siteAnalysisContent')?.innerHTML || '';
  const w=window.open('','','width=800,height=1200');
  w.document.write(`<html><head><title>Fiche Site — FP Romania</title><style>
    body{font-family:Arial,sans-serif;padding:24px;color:#333;font-size:11px;max-width:750px;margin:0 auto;line-height:1.5}
    h3{font-size:13px;border-bottom:1px solid #e2e8f0;padding-bottom:6px;margin:18px 0 8px}
    .metric-row{display:flex;align-items:center;gap:8px;padding:3px 0}.metric-label{flex:1;color:#64748b}.metric-value{font-weight:700;text-align:right}.metric-bar{flex:0 0 60px;height:4px;background:#e2e8f0;border-radius:2px;overflow:hidden}.metric-fill{height:100%;border-radius:2px}.metric-weight{font-size:8px;color:#94a3b8;min-width:28px;text-align:right}
    .badge,.badge-est{font-size:9px;padding:1px 5px;border-radius:3px}.badge-blue{background:#dbeafe;color:#2563eb}
    .saz-number{font-size:42px;font-weight:900;text-align:center}.saz-sublabel{font-size:10px;color:#94a3b8;text-align:center}
    .reco-chip{display:inline-block;padding:3px 12px;border-radius:16px;font-size:10px;font-weight:700}
    .reco-go{background:#dcfce7;color:#166534;border:1px solid #86efac}.reco-caution{background:#fef9c3;color:#854d0e;border:1px solid #fde047}.reco-nogo{background:#fee2e2;color:#991b1b;border:1px solid #fca5a5}
    .comp-card,.comp-body{display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid #f1f5f9}.comp-dot{width:6px;height:6px;border-radius:50%}.comp-name{font-weight:600;font-size:10px}.comp-meta{font-size:9px;color:#94a3b8}
    .notes-area{width:100%;border:1px solid #e2e8f0;padding:8px;min-height:40px;border-radius:6px}
    .btn,.toggle,.info-tip,.admin-only{display:none}.animate-in{animation:none}
    input[type=range]{display:none}
    div[style*="background:var"]{background:#f8fafc!important;border:1px solid #e2e8f0!important}
    @media print{body{font-size:10px}h3{font-size:12px}}
    .page-break{page-break-before:always;margin-top:20px}
  </style></head><body>
    <div style="text-align:center;margin-bottom:20px;border-bottom:3px solid #d4a017;padding-bottom:15px">
      <h1 style="color:#d4a017;margin:0;font-size:20px">FITNESS PARK ROMANIA</h1>
      <p style="color:#666;margin:4px 0;font-size:11px">Fiche de Due Diligence — ${new Date().toLocaleDateString('fr-FR')}</p>
      <p style="color:#94a3b8;margin:2px 0;font-size:9px">Expansion Intelligence Platform | Isseo x Fitness Park</p>
    </div>
    ${siteContent}
    ${captageContent ? '<div class="page-break"><h2 style="color:#d4a017;font-size:16px;border-bottom:2px solid #d4a017;padding-bottom:8px">Potentiel de captage</h2>' + captageContent + '</div>' : ''}
    ${analysisContent ? '<div class="page-break"><h2 style="color:#d4a017;font-size:16px;border-bottom:2px solid #d4a017;padding-bottom:8px">Analyse detaillee</h2>' + analysisContent + '</div>' : ''}
    <div style="margin-top:30px;padding-top:10px;border-top:2px solid #d4a017;font-size:8px;color:#94a3b8;text-align:center">
      Document genere le ${new Date().toLocaleDateString('fr-FR')} a ${new Date().toLocaleTimeString('fr-FR')}<br>
      FP Romania Expansion Intelligence Platform | Isseo x Fitness Park<br>
      Sources: INS Romania Census 2021, OpenStreetMap, Overpass API, worldclass.ro, stayfit.ro, 18gym.ro, downtownfitness.ro<br>
      Les estimations de membres et les taux de captage sont des approximations basees sur des proxies (surface, reviews, prix)
    </div>
  </body></html>`);
  w.document.close();w.print();
}

// ================================================================
// ANALYZE ALL SECTORS
// ================================================================
async function analyzeAllSectors() {
  showLoad('Analyse complete des 6 secteurs...','Requetes Overpass API sequentielles');
  const counts=[];

  for(const s of SECTORS) {
    el('loaderSub').textContent=`Analyse ${s.name} (${s.desc.split(',')[0]})...`;
    let comps;
    if(demo) comps=getDemoInRadius(s.center[0],s.center[1],3000);
    else comps=await fetchOverpass(s.center[0],s.center[1],3000);

    const saz=calcSAZ(s.center[0],s.center[1],s,comps);
    sectorSAZ[s.id]=saz.total;
    counts.push(comps.length);
    addZone(s.center[0],s.center[1],s,saz,comps);

    // Recolor sector by SAZ
    if(sectorPolys[s.id]) {
      const c=saz.total>=70?'#22c55e':saz.total>=45?'#eab308':'#ef4444';
      sectorPolys[s.id].setStyle({fillColor:c,color:c,fillOpacity:.2});
    }
  }

  updateGapChart(counts);
  hideLoad();
  switchTab('dash');
}

// ================================================================
// LAYERS
// ================================================================
const layers={sectors:false,competitors:false,heatmap:false,transport:false,pois:false,cartiere:false,heatDensity:false,heatYouth:false};

function toggleLayer(name) {
  layers[name]=!layers[name];
  const tgl=el('tgl'+name.charAt(0).toUpperCase()+name.slice(1));
  if(tgl) tgl.classList.toggle('on');

  if(name==='sectors'){
    if (layers.sectors) {
      sectorPolyLayer?.addTo(map);
      sectorLabelLayer?.addTo(map);
    } else {
      if (sectorPolyLayer)  map.removeLayer(sectorPolyLayer);
      if (sectorLabelLayer) map.removeLayer(sectorLabelLayer);
    }
  }
  if(name==='competitors'){
    if(layers.competitors) loadAllCompetitors();
    else compCluster.clearLayers();
  }
  if(name==='heatmap'){
    if(layers.heatmap) genHeatmap();
    else if(heatLayer) map.removeLayer(heatLayer);
  }
  if(name==='transport'){
    if(layers.transport) loadTransport();
    else transportLayer.clearLayers();
  }
  if(name==='pois'){
    if(layers.pois) loadPois();
    else poiLayer.clearLayers();
  }
  if(name==='cartiere'){
    if(layers.cartiere){loadCartiere();map.addLayer(cartiereLayer)}
    else map.removeLayer(cartiereLayer);
  }
  if(name==='heatDensity'){
    if(layers.heatDensity) genHeatDensity();
    else if(heatDensityLayer) map.removeLayer(heatDensityLayer);
  }
  if(name==='heatYouth'){
    if(layers.heatYouth) genHeatYouth();
    else if(heatYouthLayer) map.removeLayer(heatYouthLayer);
  }
}

async function loadAllCompetitors() {
  // Always start with VERIFIED_CLUBS (92 clubs, accurate data)
  const verified = VERIFIED_CLUBS.map(c=>({...c,id:Math.random(),source:'verified',est:false,color:segColor(c.segment),threat:segThreat(c.segment),brand:'local'}));

  let comps;
  if(demo) {
    comps = verified;
  } else {
    // Fetch Overpass and merge: verified DB is the base, Overpass adds extras
    const overpass = await fetchAllBucharest();
    const merged = [...verified];
    overpass.forEach(oc => {
      const alreadyExists = merged.some(vc => haversine(vc.lat,vc.lng,oc.lat,oc.lng) < 150);
      if(!alreadyExists) merged.push(oc);
    });

    // Google Nearby Search as additional source (if API key available)
    if (_googleHasKey()) {
      try {
        const googleGyms = await googleNearbyGyms(BUCHAREST[0], BUCHAREST[1], 25000);
        let googleAdded = 0;
        googleGyms.forEach(gc => {
          const alreadyExists = merged.some(vc => haversine(vc.lat,vc.lng,gc.lat,gc.lng) < 150);
          if (!alreadyExists) { merged.push(gc); googleAdded++; }
        });
        if (googleAdded > 0) console.log(`[Google] +${googleAdded} clubs supplementaires detectes`);
      } catch(e) { console.warn('[Google Nearby] Error:', e); }
    }

    comps = merged;
  }
  allComps=comps;
  lastDisplayedComps=comps;
  showCompsOnMap(comps);
  buildBrandFilters(comps);
  if(!layers.competitors){layers.competitors=true;el('tglCompetitors').classList.add('on')}
  document.getElementById('btnLoadComp')?.classList.add('active');
  setStatus('ok',`${comps.length} concurrents charges`);

  // Enrich with Google Places data (async, non-blocking).
  // Bugfix: only re-render markers if the competitors layer is still on.
  // Otherwise the async .then() would re-populate the cluster after mobile
  // had explicitly hidden it (clusters re-appearing at zoom-out = surprise).
  if (_googleHasKey()) {
    enrichWithGoogle(comps).then(() => {
      if (layers.competitors) showCompsOnMap(comps);
      // v6.69 — snapshot des review counts pour la série temporelle vélocité
      try { window.ReviewsHistory?.maybeSnapshot?.(comps); } catch {}
    });
  }
}

async function genHeatmap() {
  // Ensure competitor data is loaded WITHOUT displaying markers or flipping the competitors toggle
  if(!allComps.length) {
    const wasCompetitorsOn = layers.competitors;
    await loadAllCompetitors();
    if(!wasCompetitorsOn) {
      // User only wanted the heatmap — hide the markers and reset the toggle
      compCluster.clearLayers();
      layers.competitors = false;
      const tgl = el('tglCompetitors');
      if(tgl) tgl.classList.remove('on');
      document.getElementById('btnLoadComp')?.classList.remove('active'); // v6.70.1 état bouton Actions
    }
  }
  if(heatLayer) map.removeLayer(heatLayer);
  // v6.57 — Paul: "heatmap trop marquee". Reduit l'intensite visuelle:
  //   - max 0.6 → 1.0   (plus de headroom avant saturation complete)
  //   - minOpacity 0.35 → 0.20  (moins presente en zone basse densite)
  //   - radius 45 → 38 / blur 35 → 28 (zones plus nettes, moins envahissantes)
  //   - gradient: stops etales + rouge adouci pour limiter les masses rouge vif
  heatLayer=L.heatLayer(allComps.map(c=>[c.lat,c.lng,1.0]),{
    radius:38,blur:28,maxZoom:13,max:1.0,minOpacity:0.20,
    gradient:{0.05:'#1e3a5f',0.25:'#3b82f6',0.5:'#06b6d4',0.7:'#eab308',0.85:'#f97316',1:'#dc2626'}
  }).addTo(map);
}

function loadTransport() {
  transportLayer.clearLayers();
  METRO.forEach(s=>{
    const icon=L.divIcon({className:'',
      html:`<div style="width:9px;height:9px;background:#3b82f6;border:2px solid rgba(255,255,255,.7);border-radius:2px;box-shadow:0 0 4px rgba(59,130,246,.5)"></div>`,
      iconSize:[9,9],iconAnchor:[5,5]});
    L.marker([s.lat,s.lng],{icon}).bindTooltip(`<b>${s.n}</b><br><span style="font-size:10px;color:#94a3b8">${s.lines}</span>`,{className:'custom-tooltip',direction:'top',offset:[0,-8]}).addTo(transportLayer);
  });
}

function loadPois() {
  poiLayer.clearLayers();
  const colors={university:'#a855f7',mall:'#06b6d4',office:'#3b82f6',residential:'#f59e0b'};
  const sizes={university:11,mall:10,office:9,residential:9};
  POIS.forEach(p=>{
    const c=colors[p.type]||'#fff';
    const sz=sizes[p.type]||9;
    const icon=L.divIcon({className:'',
      html:`<div style="width:${sz}px;height:${sz}px;background:${c};border:2px solid rgba(255,255,255,.7);border-radius:${p.type==='mall'?'2px':'50%'};box-shadow:0 0 6px ${c}80;font-size:0"></div>`,
      iconSize:[sz,sz],iconAnchor:[sz/2,sz/2]});
    const detail = p.students ? `${fmt(p.students)} etudiants` : p.employees ? `~${fmt(p.employees)} employes` : p.inhabitants ? `~${fmt(p.inhabitants)} habitants` : p.gla ? `${fmt(p.gla)} m2 GLA` : '';
    L.marker([p.lat,p.lng],{icon}).bindTooltip(
      `<b>${p.icon} ${p.name}</b><br><span style="font-size:10px;color:#94a3b8">${p.type} | ${detail}</span>`,
      {className:'custom-tooltip',direction:'top',offset:[0,-8]}
    ).addTo(poiLayer);
  });
}

// ================================================================
// CARTIERE LAYER — Neighborhoods colored by youth score
// ================================================================
let cartiereLayer = L.layerGroup();

function loadCartiere() {
  cartiereLayer.clearLayers();
  CARTIERE.forEach(c=>{
    const youngPct = c.young || .42;
    // Color by youth: green = high youth, red = low
    const score = Math.round(((youngPct - .38) / (.46 - .38)) * 100);
    const color = score >= 70 ? '#22c55e' : score >= 50 ? '#d4a017' : score >= 30 ? '#f97316' : '#ef4444';
    const radius = Math.sqrt(c.pop / 3000) * 200; // Size proportional to population

    const circle = L.circle([c.lat, c.lng], {
      radius: Math.max(250, Math.min(600, radius)),
      color: color, weight: 1, fillColor: color, fillOpacity: 0.2
    });
    circle.bindTooltip(`<b>${c.name}</b><br>
      Pop: ${fmt(c.pop)} | Jeunes: ${Math.round(youngPct*100)}%<br>
      Prix: ${fmt(c.price)} EUR/m2 | ${c.desc}`,
      {className:'custom-tooltip',direction:'top'});
    circle.addTo(cartiereLayer);

    // Label
    L.marker([c.lat, c.lng], {
      icon: L.divIcon({className:'',
        html:`<div style="font-size:8px;color:${color};font-weight:700;text-align:center;white-space:nowrap;opacity:.8">${c.name}</div>`,
        iconSize:[60,12],iconAnchor:[30,6]})
    }).addTo(cartiereLayer);
  });
}

// ================================================================
// HEATMAPS — Density & Youth
// ================================================================
let heatDensityLayer = null;
let heatYouthLayer = null;

// High-resolution density grid: 2700+ points, 330m resolution
// Generated from 83 cartiere census 2021 data with Gaussian interpolation
// Technique: each cartier population spreads via 2D Gaussian kernel (bandwidth ~900m)
// covering the entire city with smooth density gradients
const DENSITY_NIGHT=[[44.43,26.19,1.0],[44.519,26.075,0.6],[44.484,26.112,0.5],[44.421,26.18,0.5],[44.43,26.052,0.4],[44.438,26.187,0.4],[44.364,26.131,0.4],[44.431,26.18,0.4],[44.433,26.178,0.3],[44.428,25.988,0.3],[44.529,26.075,0.3],[44.428,26.196,0.3],[44.427,26.183,0.3],[44.424,26.184,0.3],[44.425,26.186,0.3],[44.447,26.007,0.3],[44.38,26.118,0.3],[44.424,26.159,0.2],[44.51,26.088,0.2],[44.355,26.091,0.2],[44.424,26.19,0.2],[44.438,26.192,0.2],[44.431,26.175,0.2],[44.424,26.189,0.2],[44.37,26.178,0.2],[44.412,26.081,0.2],[44.451,26.125,0.2],[44.394,26.118,0.2],[44.386,26.109,0.2],[44.438,26.025,0.2],[44.421,26.19,0.2],[44.43,26.058,0.2],[44.367,26.043,0.2],[44.441,26.076,0.2],[44.438,26.026,0.2],[44.445,26.078,0.2],[44.43,26.178,0.2],[44.383,26.001,0.2],[44.498,26.0,0.2],[44.412,26.165,0.2],[44.471,26.043,0.2],[44.49,26.016,0.2],[44.439,25.957,0.2],[44.424,26.149,0.2],[44.41,26.16,0.2],[44.438,26.019,0.2],[44.439,26.025,0.2],[44.431,26.02,0.2],[44.431,26.016,0.2],[44.412,26.118,0.2],[44.478,26.175,0.2],[44.478,26.181,0.2],[44.433,26.034,0.2],[44.478,26.067,0.2],[44.4,26.044,0.2],[44.444,26.022,0.2],[44.386,25.985,0.2],[44.434,26.189,0.2],[44.406,26.149,0.2],[44.486,25.979,0.2],[44.418,26.148,0.2],[44.395,25.974,0.2],[44.422,26.02,0.2],[44.475,26.162,0.2],[44.451,26.087,0.2],[44.43,26.037,0.2],[44.416,26.035,0.2],[44.409,26.034,0.2],[44.529,26.038,0.2],[44.465,26.127,0.1],[44.439,26.18,0.1],[44.421,26.139,0.1],[44.421,26.149,0.1],[44.439,26.133,0.1],[44.427,26.169,0.1],[44.415,26.159,0.1],[44.379,26.119,0.1],[44.431,26.01,0.1],[44.404,26.064,0.1],[44.436,26.026,0.1],[44.433,26.023,0.1],[44.433,26.022,0.1],[44.442,26.094,0.1],[44.439,26.166,0.1],[44.394,26.093,0.1],[44.416,26.151,0.1],[44.422,26.189,0.1],[44.428,26.093,0.1],[44.434,25.959,0.1],[44.456,25.963,0.1],[44.415,26.201,0.1],[44.427,26.062,0.1],[44.428,26.146,0.1],[44.425,26.146,0.1],[44.492,26.093,0.1],[44.439,26.013,0.1],[44.419,26.162,0.1],[44.41,26.166,0.1],[44.41,26.137,0.1],[44.439,26.0,0.1],[44.441,26.017,0.1],[44.431,26.019,0.1],[44.4,26.146,0.1],[44.395,26.122,0.1],[44.433,26.18,0.1],[44.433,26.181,0.1],[44.478,26.136,0.1],[44.419,26.127,0.1],[44.436,26.072,0.1],[44.43,26.16,0.1],[44.416,26.157,0.1],[44.425,26.175,0.1],[44.412,26.168,0.1],[44.395,26.116,0.1],[44.413,26.108,0.1],[44.389,26.093,0.1],[44.386,26.1,0.1],[44.38,26.128,0.1],[44.412,26.07,0.1],[44.438,26.02,0.1],[44.436,26.032,0.1],[44.436,26.016,0.1],[44.433,26.02,0.1],[44.373,26.118,0.1],[44.361,26.122,0.1],[44.412,26.128,0.1],[44.344,26.085,0.1],[44.403,25.986,0.1],[44.445,26.044,0.1],[44.407,26.19,0.1],[44.427,26.009,0.1],[44.48,26.163,0.1],[44.489,25.98,0.1],[44.425,26.076,0.1],[44.433,26.157,0.1],[44.438,26.103,0.1],[44.418,26.178,0.1],[44.421,26.174,0.1],[44.416,26.184,0.1],[44.391,26.094,0.1],[44.397,26.112,0.1],[44.385,26.103,0.1],[44.386,26.121,0.1],[44.377,26.121,0.1],[44.382,26.118,0.1],[44.382,26.128,0.1],[44.388,26.133,0.1],[44.385,26.133,0.1],[44.439,26.022,0.1],[44.433,26.174,0.1],[44.474,26.031,0.1],[44.438,26.022,0.1],[44.439,26.028,0.1],[44.436,26.023,0.1],[44.438,26.032,0.1],[44.433,26.015,0.1],[44.431,26.012,0.1],[44.431,26.029,0.1],[44.462,26.058,0.1],[44.415,26.18,0.1],[44.398,26.145,0.1],[44.428,26.189,0.1],[44.412,26.109,0.1],[44.391,26.013,0.1],[44.362,26.127,0.1],[44.391,26.146,0.1],[44.35,26.087,0.1],[44.385,26.13,0.1],[44.422,26.214,0.1],[44.401,25.983,0.1],[44.477,26.137,0.1],[44.368,26.125,0.1],[44.418,25.966,0.1],[44.421,26.193,0.1],[44.367,26.155,0.1],[44.415,26.199,0.1],[44.48,26.118,0.1],[44.395,26.168,0.1],[44.424,26.016,0.1],[44.438,26.137,0.1],[44.416,26.155,0.1],[44.422,26.175,0.1],[44.434,26.157,0.1],[44.418,26.177,0.1],[44.391,26.019,0.1],[44.412,26.14,0.1],[44.383,26.134,0.1],[44.383,26.099,0.1],[44.385,26.115,0.1],[44.436,26.017,0.1],[44.472,26.019,0.1],[44.454,26.044,0.1],[44.459,26.046,0.1],[44.404,26.069,0.1],[44.409,26.072,0.1],[44.438,26.017,0.1],[44.441,26.026,0.1],[44.439,26.017,0.1],[44.431,26.028,0.1],[44.445,26.031,0.1],[44.422,26.163,0.1],[44.412,26.02,0.1],[44.391,26.125,0.1],[44.444,26.066,0.1],[44.444,26.069,0.1],[44.407,26.203,0.1],[44.431,26.177,0.1],[44.413,26.11,0.1],[44.412,26.112,0.1],[44.439,26.096,0.1],[44.439,26.193,0.1],[44.43,26.04,0.1],[44.373,26.121,0.1],[44.43,26.193,0.1],[44.391,25.979,0.1],[44.391,26.007,0.1],[44.391,25.986,0.1],[44.415,26.09,0.1],[44.424,25.988,0.1],[44.453,25.986,0.1],[44.489,25.979,0.1],[44.368,26.136,0.1],[44.43,26.041,0.1],[44.412,26.085,0.1],[44.359,26.133,0.1],[44.365,26.181,0.1],[44.382,26.116,0.1],[44.418,26.019,0.1],[44.463,26.13,0.1],[44.453,26.119,0.1],[44.431,26.172,0.1],[44.447,26.13,0.1],[44.48,26.115,0.1],[44.422,26.177,0.1],[44.427,26.13,0.1],[44.412,26.175,0.1],[44.418,26.142,0.1],[44.41,26.172,0.1],[44.413,26.148,0.1],[44.418,26.169,0.1],[44.41,26.143,0.1],[44.416,26.183,0.1],[44.427,26.178,0.1],[44.412,26.136,0.1],[44.385,26.084,0.1],[44.413,26.142,0.1],[44.413,26.136,0.1],[44.385,26.137,0.1],[44.385,26.136,0.1],[44.445,26.127,0.1],[44.413,26.137,0.1],[44.41,26.139,0.1],[44.383,26.122,0.1],[44.379,26.125,0.1],[44.38,26.119,0.1],[44.388,26.128,0.1],[44.389,26.127,0.1],[44.438,26.159,0.1],[44.439,26.02,0.1],[44.478,26.174,0.1],[44.441,26.016,0.1],[44.41,26.069,0.1],[44.403,26.061,0.1],[44.441,26.023,0.1],[44.436,26.022,0.1],[44.436,26.025,0.1],[44.439,26.175,0.1],[44.431,26.015,0.1],[44.436,26.02,0.1],[44.388,26.091,0.1],[44.43,26.189,0.1],[44.477,26.18,0.1],[44.362,26.09,0.1],[44.516,26.07,0.1],[44.475,26.187,0.1],[44.49,26.118,0.1],[44.425,25.985,0.1],[44.367,26.19,0.1],[44.43,26.205,0.1],[44.48,26.159,0.1],[44.368,26.187,0.1],[44.397,25.973,0.1],[44.447,25.985,0.1],[44.439,26.165,0.1],[44.41,26.201,0.1],[44.407,25.986,0.1],[44.365,26.183,0.1],[44.439,25.96,0.1],[44.419,26.022,0.1],[44.451,26.122,0.1],[44.433,26.166,0.1],[44.418,26.149,0.1],[44.495,26.093,0.1],[44.495,26.091,0.1],[44.421,26.022,0.1],[44.413,26.139,0.1],[44.484,26.109,0.1],[44.441,26.134,0.1],[44.422,26.168,0.1],[44.385,26.097,0.1],[44.424,26.162,0.1],[44.413,26.166,0.1],[44.419,26.137,0.1],[44.415,26.139,0.1],[44.418,26.18,0.1],[44.413,26.18,0.1],[44.416,26.181,0.1],[44.433,26.195,0.1],[44.395,26.118,0.1],[44.398,26.106,0.1],[44.4,26.105,0.1],[44.419,26.171,0.1],[44.38,26.124,0.1],[44.382,26.124,0.1],[44.385,26.116,0.1],[44.383,26.116,0.1],[44.38,26.127,0.1],[44.382,26.133,0.1],[44.382,26.13,0.1],[44.389,26.128,0.1],[44.391,26.127,0.1],[44.383,26.133,0.1],[44.385,26.131,0.1],[44.388,26.131,0.1],[44.388,26.134,0.1],[44.392,26.128,0.1],[44.433,26.012,0.1],[44.454,26.049,0.1],[44.459,26.049,0.1],[44.459,26.047,0.1],[44.418,26.128,0.1],[44.415,26.13,0.1],[44.413,26.067,0.1],[44.412,26.069,0.1],[44.4,26.052,0.1],[44.415,26.066,0.1],[44.439,26.026,0.1],[44.438,26.028,0.1],[44.434,26.026,0.1],[44.438,26.031,0.1],[44.441,26.019,0.1],[44.436,26.038,0.1],[44.442,26.178,0.1],[44.433,26.009,0.1],[44.444,26.032,0.1],[44.431,26.031,0.1],[44.439,26.184,0.1],[44.457,26.079,0.1],[44.422,26.181,0.1],[44.392,26.096,0.1],[44.441,26.07,0.1],[44.412,26.171,0.1],[44.403,26.088,0.1],[44.431,26.178,0.1],[44.468,26.139,0.1],[44.475,26.181,0.1],[44.371,26.091,0.1],[44.416,26.097,0.1],[44.442,26.019,0.1],[44.425,26.01,0.1],[44.427,26.001,0.1],[44.425,26.003,0.1],[44.404,26.206,0.1],[44.438,26.19,0.1],[44.43,26.038,0.1],[44.522,26.026,0.1],[44.436,26.055,0.1],[44.374,26.047,0.1],[44.388,26.121,0.1],[44.41,26.087,0.1],[44.391,26.01,0.1],[44.389,26.013,0.1],[44.38,26.155,0.1],[44.395,25.98,0.1],[44.397,25.98,0.1],[44.539,26.073,0.1],[44.373,26.151,0.1],[44.416,26.09,0.1],[44.383,25.991,0.1],[44.367,26.115,0.1],[44.37,26.125,0.1],[44.4,26.208,0.1],[44.37,26.127,0.1],[44.442,26.056,0.1],[44.441,26.047,0.1],[44.428,26.031,0.1],[44.433,26.04,0.1],[44.377,26.192,0.1],[44.373,26.186,0.1],[44.365,26.18,0.1],[44.356,26.218,0.1],[44.368,26.044,0.1],[44.428,26.105,0.1],[44.427,26.078,0.1],[44.43,26.094,0.1],[44.422,26.015,0.1],[44.463,26.131,0.1],[44.465,26.13,0.1],[44.456,26.127,0.1],[44.46,26.128,0.1],[44.459,26.128,0.1],[44.463,26.118,0.1],[44.462,26.118,0.1],[44.433,26.155,0.1],[44.431,26.166,0.1],[44.421,26.142,0.1],[44.433,26.1,0.1],[44.445,26.13,0.1],[44.465,26.143,0.1],[44.465,26.142,0.1],[44.453,26.149,0.1],[44.447,26.131,0.1],[44.415,26.175,0.1],[44.416,26.154,0.1],[44.418,26.159,0.1],[44.415,26.081,0.1],[44.415,26.163,0.1],[44.412,26.166,0.1],[44.427,26.151,0.1],[44.418,26.168,0.1],[44.409,26.168,0.1],[44.41,26.168,0.1],[44.415,26.151,0.1],[44.419,26.139,0.1],[44.421,26.137,0.1],[44.415,26.146,0.1],[44.422,26.178,0.1],[44.444,26.119,0.1],[44.416,26.062,0.1],[44.41,26.067,0.1],[44.422,26.062,0.1],[44.41,26.14,0.1],[44.388,26.103,0.1],[44.406,26.177,0.1],[44.456,26.043,0.1],[44.412,26.146,0.1],[44.413,26.134,0.1],[44.416,26.142,0.1],[44.395,26.113,0.1],[44.4,26.1,0.1],[44.385,26.099,0.1],[44.383,26.096,0.1],[44.38,26.097,0.1],[44.38,26.121,0.1],[44.385,26.119,0.1],[44.383,26.127,0.1],[44.386,26.131,0.1],[44.382,26.136,0.1],[44.386,26.128,0.1],[44.413,26.149,0.1],[44.444,26.093,0.1],[44.441,26.013,0.1],[44.43,26.009,0.1],[44.456,26.046,0.1],[44.457,26.044,0.1],[44.459,26.05,0.1],[44.419,26.112,0.1],[44.413,26.125,0.1],[44.404,26.062,0.1],[44.409,26.067,0.1],[44.407,26.066,0.1],[44.407,26.069,0.1],[44.406,26.067,0.1],[44.409,26.075,0.1],[44.407,26.075,0.1],[44.439,26.019,0.1],[44.439,26.023,0.1],[44.439,26.015,0.1],[44.436,26.037,0.1],[44.433,26.017,0.1],[44.431,26.017,0.1],[44.431,26.025,0.1],[44.433,26.016,0.1],[44.43,26.015,0.1],[44.43,26.019,0.1],[44.439,26.031,0.1],[44.438,26.034,0.1],[44.422,26.162,0.1],[44.459,26.069,0.1],[44.465,26.073,0.1],[44.389,26.13,0.1],[44.462,26.136,0.1],[44.416,26.131,0.1],[44.441,26.09,0.1],[44.415,26.183,0.1],[44.413,26.109,0.1],[44.41,26.112,0.1],[44.41,26.113,0.1],[44.427,26.066,0.1],[44.49,26.088,0.1],[44.478,26.116,0.1],[44.404,25.992,0.1],[44.41,26.019,0.1],[44.406,26.143,0.1],[44.427,26.061,0.1],[44.425,26.064,0.1],[44.492,26.121,0.1],[44.424,26.064,0.1],[44.486,26.171,0.1],[44.389,26.009,0.1],[44.422,26.012,0.1],[44.356,26.043,0.1],[44.442,26.152,0.1],[44.424,26.192,0.1],[44.4,25.977,0.1],[44.407,25.973,0.1],[44.388,26.062,0.1],[44.37,26.137,0.1],[44.421,26.072,0.1],[44.422,26.211,0.1],[44.525,26.026,0.1],[44.37,26.148,0.1],[44.371,26.152,0.1],[44.413,26.088,0.1],[44.451,25.988,0.1],[44.445,26.02,0.1],[44.364,26.152,0.1],[44.388,26.13,0.1],[44.373,26.125,0.1],[44.371,26.125,0.1],[44.425,26.009,0.1],[44.374,26.127,0.1],[44.373,26.127,0.1],[44.489,25.983,0.1],[44.454,25.971,0.1],[44.386,26.023,0.1],[44.371,26.127,0.1],[44.499,26.032,0.1],[44.465,26.023,0.1],[44.496,26.003,0.1],[44.401,26.211,0.1],[44.367,26.18,0.1],[44.367,26.157,0.1],[44.358,26.131,0.1],[44.519,26.069,0.1],[44.364,26.18,0.1],[44.477,25.977,0.1],[44.406,26.11,0.1],[44.415,26.1,0.1],[44.438,25.986,0.1],[44.412,26.016,0.1],[44.421,26.019,0.1],[44.424,26.019,0.1],[44.424,26.022,0.1],[44.424,26.031,0.1],[44.48,26.124,0.1],[44.462,26.125,0.1],[44.457,26.128,0.1],[44.462,26.128,0.1],[44.46,26.13,0.1],[44.451,26.124,0.1],[44.459,26.121,0.1],[44.462,26.13,0.1],[44.46,26.113,0.1],[44.462,26.116,0.1],[44.442,26.159,0.1],[44.425,26.145,0.1],[44.421,26.148,0.1],[44.428,26.149,0.1],[44.43,26.155,0.1],[44.431,26.159,0.1],[44.433,26.159,0.1],[44.436,26.165,0.1],[44.428,26.174,0.1],[44.419,26.143,0.1],[44.422,26.14,0.1],[44.447,26.099,0.1],[44.493,26.097,0.1],[44.493,26.09,0.1],[44.456,26.049,0.1],[44.421,26.064,0.1],[44.447,26.128,0.1],[44.416,26.029,0.1],[44.416,26.026,0.1],[44.418,26.023,0.1],[44.422,26.044,0.1],[44.418,26.04,0.1],[44.465,26.14,0.1],[44.463,26.142,0.1],[44.462,26.134,0.1],[44.459,26.139,0.1],[44.453,26.145,0.1],[44.45,26.127,0.1],[44.444,26.148,0.1],[44.445,26.151,0.1],[44.424,26.136,0.1],[44.424,26.13,0.1],[44.427,26.128,0.1],[44.422,26.139,0.1],[44.415,26.155,0.1],[44.444,26.127,0.1],[44.422,26.166,0.1],[44.413,26.165,0.1],[44.413,26.175,0.1],[44.418,26.14,0.1],[44.409,26.146,0.1],[44.413,26.143,0.1],[44.416,26.139,0.1],[44.415,26.142,0.1],[44.413,26.172,0.1],[44.427,26.137,0.1],[44.409,26.172,0.1],[44.407,26.174,0.1],[44.441,26.116,0.1],[44.422,26.061,0.1],[44.385,26.082,0.1],[44.388,26.105,0.1],[44.418,26.181,0.1],[44.428,26.134,0.1],[44.428,26.133,0.1],[44.431,26.093,0.1],[44.427,26.177,0.1],[44.416,26.072,0.1],[44.412,26.143,0.1],[44.421,26.109,0.1],[44.428,26.108,0.1],[44.43,26.134,0.1],[44.43,26.133,0.1],[44.447,26.121,0.1],[44.41,26.115,0.1],[44.415,26.106,0.1],[44.392,26.093,0.1],[44.415,26.134,0.1],[44.4,26.099,0.1],[44.394,26.1,0.1],[44.382,26.097,0.1],[44.379,26.1,0.1],[44.38,26.1,0.1],[44.379,26.103,0.1],[44.383,26.113,0.1],[44.379,26.116,0.1],[44.377,26.119,0.1],[44.38,26.125,0.1],[44.379,26.121,0.1],[44.388,26.118,0.1],[44.386,26.118,0.1],[44.382,26.125,0.1],[44.383,26.128,0.1],[44.382,26.134,0.1],[44.386,26.134,0.1],[44.438,26.16,0.1],[44.501,26.022,0.1],[44.498,26.031,0.1],[44.427,26.168,0.1],[44.425,26.165,0.1],[44.439,26.012,0.1],[44.418,26.049,0.1],[44.457,26.047,0.1],[44.457,26.049,0.1],[44.456,26.05,0.1],[44.46,26.046,0.1],[44.421,26.116,0.1],[44.422,26.116,0.1],[44.416,26.133,0.1],[44.406,26.066,0.1],[44.407,26.067,0.1],[44.431,26.013,0.1],[44.406,26.069,0.1],[44.404,26.067,0.1],[44.407,26.061,0.1],[44.409,26.064,0.1],[44.412,26.072,0.1],[44.412,26.073,0.1],[44.409,26.076,0.1],[44.409,26.078,0.1],[44.406,26.075,0.1],[44.404,26.061,0.1],[44.403,26.062,0.1],[44.401,26.05,0.1],[44.416,26.069,0.1],[44.418,26.067,0.1],[44.413,26.069,0.1],[44.413,26.07,0.1],[44.418,26.061,0.1],[44.436,26.019,0.1],[44.436,26.031,0.1],[44.438,26.023,0.1],[44.431,26.009,0.1],[44.444,26.034,0.1],[44.439,26.035,0.1],[44.442,26.18,0.1],[44.436,26.009,0.1],[44.416,26.046,0.1],[44.418,26.015,0.1],[44.418,26.017,0.1],[44.462,26.072,0.1],[44.462,26.073,0.1],[44.444,26.076,0.1],[44.471,26.053,0.1],[44.441,26.004,0.1],[44.448,26.049,0.1],[44.386,26.127,0.1],[44.451,26.119,0.1],[44.398,26.143,0.1],[44.394,26.094,0.1],[44.392,26.094,0.1],[44.391,26.097,0.1],[44.425,26.067,0.1],[44.407,26.201,0.1],[44.427,26.187,0.1],[44.416,26.087,0.1],[44.415,26.11,0.1],[44.415,26.112,0.1],[44.439,26.093,0.1],[44.406,26.094,0.1],[44.439,26.053,0.1],[44.413,26.103,0.1],[44.425,26.096,0.1],[44.425,26.13,0.1],[44.412,26.125,0.1],[44.438,25.977,0.1],[44.522,26.082,0.1],[44.439,26.195,0.1],[44.427,25.974,0.1],[44.43,26.031,0.1],[44.493,26.125,0.1],[44.465,26.059,0.1],[44.528,26.047,0.1],[44.37,26.183,0.1],[44.371,26.14,0.1],[44.407,25.992,0.1],[44.395,25.976,0.1],[44.401,26.143,0.1],[44.371,26.136,0.1],[44.374,26.151,0.1],[44.45,26.203,0.1],[44.368,26.145,0.1],[44.447,25.983,0.1],[44.409,26.211,0.1],[44.368,26.131,0.1],[44.362,26.149,0.1],[44.454,25.988,0.1],[44.454,25.986,0.1],[44.505,26.084,0.1],[44.484,26.07,0.1],[44.447,25.977,0.1],[44.454,25.974,0.1],[44.456,25.97,0.1],[44.409,26.19,0.1],[44.434,26.001,0.1],[44.409,26.151,0.1],[44.362,26.13,0.1],[44.445,26.205,0.1],[44.465,26.037,0.1],[44.448,26.022,0.1],[44.374,26.11,0.1],[44.415,26.192,0.1],[44.413,26.198,0.1],[44.413,26.193,0.1],[44.403,26.206,0.1],[44.489,26.109,0.1],[44.412,26.198,0.1],[44.376,26.187,0.1],[44.355,26.145,0.1],[44.413,26.09,0.1],[44.362,26.152,0.1],[44.373,26.189,0.1],[44.532,25.959,0.1],[44.436,26.079,0.1],[44.457,26.109,0.1],[44.459,26.096,0.1],[44.463,26.09,0.1],[44.413,26.019,0.1],[44.415,26.02,0.1],[44.416,26.016,0.1],[44.421,26.015,0.1],[44.422,26.013,0.1],[44.422,26.019,0.1],[44.425,26.02,0.1],[44.425,26.028,0.1],[44.463,26.128,0.1],[44.462,26.131,0.1],[44.46,26.124,0.1],[44.459,26.122,0.1],[44.459,26.127,0.1],[44.457,26.127,0.1],[44.462,26.127,0.1],[44.462,26.133,0.1],[44.457,26.13,0.1],[44.453,26.127,0.1],[44.453,26.125,0.1],[44.422,26.142,0.1],[44.419,26.145,0.1],[44.428,26.151,0.1],[44.431,26.146,0.1],[44.436,26.16,0.1],[44.436,26.159,0.1],[44.431,26.165,0.1],[44.419,26.14,0.1],[44.418,26.151,0.1],[44.43,26.064,0.1],[44.445,26.093,0.1],[44.453,26.04,0.1],[44.445,26.128,0.1],[44.436,26.097,0.1],[44.415,26.034,0.1],[44.415,26.026,0.1],[44.421,26.026,0.1],[44.419,26.026,0.1],[44.425,26.04,0.1],[44.427,26.05,0.1],[44.419,26.043,0.1],[44.419,26.047,0.1],[44.418,26.139,0.1],[44.468,26.14,0.1],[44.466,26.139,0.1],[44.463,26.143,0.1],[44.463,26.134,0.1],[44.459,26.133,0.1],[44.46,26.133,0.1],[44.46,26.137,0.1],[44.444,26.155,0.1],[44.481,26.109,0.1],[44.422,26.13,0.1],[44.422,26.136,0.1],[44.401,26.099,0.1],[44.418,26.152,0.1],[44.416,26.159,0.1],[44.444,26.131,0.1],[44.442,26.134,0.1],[44.439,26.136,0.1],[44.442,26.136,0.1],[44.48,26.121,0.1],[44.416,26.013,0.1],[44.419,26.166,0.1],[44.413,26.168,0.1],[44.412,26.16,0.1],[44.41,26.169,0.1],[44.41,26.174,0.1],[44.412,26.172,0.1],[44.415,26.168,0.1],[44.413,26.169,0.1],[44.41,26.171,0.1],[44.413,26.146,0.1],[44.415,26.171,0.1],[44.442,26.118,0.1],[44.41,26.073,0.1],[44.418,26.062,0.1],[44.391,26.079,0.1],[44.409,26.142,0.1],[44.409,26.143,0.1],[44.416,26.085,0.1],[44.407,26.177,0.1],[44.406,26.174,0.1],[44.409,26.174,0.1],[44.43,26.136,0.1],[44.415,26.137,0.1],[44.418,26.134,0.1],[44.419,26.115,0.1],[44.441,26.1,0.1],[44.421,26.097,0.1],[44.427,26.166,0.1],[44.412,26.145,0.1],[44.413,26.14,0.1],[44.383,26.136,0.1],[44.442,26.016,0.1],[44.448,26.124,0.1],[44.448,26.122,0.1],[44.445,26.121,0.1],[44.424,26.075,0.1],[44.412,26.115,0.1],[44.415,26.14,0.1],[44.413,26.152,0.1],[44.395,26.119,0.1],[44.397,26.116,0.1],[44.394,26.11,0.1],[44.4,26.102,0.1],[44.386,26.103,0.1],[44.386,26.105,0.1],[44.38,26.093,0.1],[44.38,26.096,0.1],[44.377,26.108,0.1],[44.38,26.115,0.1],[44.383,26.115,0.1],[44.382,26.115,0.1],[44.383,26.118,0.1],[44.382,26.121,0.1],[44.385,26.121,0.1],[44.38,26.131,0.1],[44.382,26.131,0.1],[44.386,26.133,0.1],[44.38,26.134,0.1],[44.388,26.137,0.1],[44.391,26.134,0.1],[44.389,26.131,0.1],[44.474,26.019,0.1],[44.434,26.01,0.1],[44.389,26.203,0.1],[44.438,26.1,0.1],[44.412,26.148,0.1],[44.436,26.01,0.1],[44.433,26.01,0.1],[44.442,26.015,0.1],[44.436,26.0,0.1],[44.438,26.006,0.1],[44.421,26.043,0.1],[44.456,26.047,0.1],[44.421,26.115,0.1],[44.422,26.118,0.1],[44.422,26.119,0.1],[44.422,26.124,0.1],[44.416,26.128,0.1],[44.415,26.131,0.1],[44.415,26.085,0.1],[44.409,26.066,0.1],[44.407,26.062,0.1],[44.409,26.061,0.1],[44.407,26.059,0.1],[44.41,26.061,0.1],[44.41,26.066,0.1],[44.404,26.066,0.1],[44.413,26.062,0.1],[44.413,26.066,0.1],[44.41,26.072,0.1],[44.412,26.076,0.1],[44.412,26.078,0.1],[44.403,26.076,0.1],[44.403,26.058,0.1],[44.401,26.055,0.1],[44.403,26.066,0.1],[44.413,26.072,0.1],[44.419,26.066,0.1],[44.419,26.069,0.1],[44.416,26.066,0.1],[44.418,26.066,0.1],[44.419,26.062,0.1],[44.436,26.029,0.1],[44.439,26.029,0.1],[44.434,26.037,0.1],[44.434,26.04,0.1],[44.442,26.171,0.1],[44.433,26.028,0.1],[44.433,26.029,0.1],[44.431,26.022,0.1],[44.43,26.01,0.1],[44.445,26.032,0.1],[44.442,26.034,0.1],[44.442,26.032,0.1],[44.441,26.034,0.1],[44.438,26.035,0.1],[44.442,26.181,0.1],[44.433,25.998,0.1],[44.416,26.044,0.1],[44.418,26.02,0.1],[44.428,26.168,0.1],[44.415,26.017,0.1],[44.425,26.025,0.1],[44.427,26.026,0.1],[44.46,26.07,0.1],[44.454,26.076,0.1],[44.453,26.073,0.1],[44.454,26.073,0.1],[44.45,26.078,0.1],[44.469,26.052,0.1],[44.418,26.136,0.1],[44.436,26.099,0.1],[44.392,26.124,0.1],[44.386,26.136,0.1],[44.385,26.125,0.1],[44.477,26.05,0.1],[44.386,26.125,0.1],[44.444,26.096,0.1],[44.48,26.049,0.1],[44.447,26.097,0.1],[44.439,26.102,0.1],[44.406,26.093,0.1],[44.407,26.094,0.1],[44.444,26.006,0.1],[44.444,26.067,0.1],[44.395,26.094,0.1],[44.386,26.091,0.1],[44.448,26.053,0.1],[44.392,26.125,0.1],[44.469,26.142,0.1],[44.43,26.175,0.1],[44.418,26.084,0.1],[44.412,26.11,0.1],[44.409,26.116,0.1],[44.421,26.108,0.1],[44.441,26.015,0.1],[44.442,26.096,0.1],[44.468,26.137,0.1],[44.397,26.109,0.1],[44.483,25.979,0.1],[44.436,26.172,0.1],[44.447,26.122,0.1],[44.478,26.064,0.1],[44.4,26.116,0.1],[44.45,26.128,0.1],[44.404,25.991,0.1],[44.412,26.13,0.1],[44.444,25.959,0.1],[44.433,25.956,0.1],[44.447,25.965,0.1],[44.444,26.052,0.1],[44.385,26.146,0.1],[44.424,26.1,0.1],[44.422,26.133,0.1],[44.412,26.007,0.1],[44.421,26.004,0.1],[44.389,26.202,0.1],[44.444,25.985,0.1],[44.376,26.102,0.1],[44.454,26.14,0.1],[44.428,26.184,0.1],[44.398,26.163,0.1],[44.436,26.193,0.1],[44.436,26.192,0.1],[44.436,25.989,0.1],[44.457,26.038,0.1],[44.43,26.059,0.1],[44.359,26.09,0.1],[44.347,26.085,0.1],[44.407,26.187,0.1],[44.412,26.157,0.1],[44.389,26.026,0.1],[44.395,26.099,0.1],[44.421,26.073,0.1],[44.38,26.145,0.1],[44.385,26.145,0.1],[44.376,26.146,0.1],[44.37,26.154,0.1],[44.368,26.186,0.1],[44.395,25.982,0.1],[44.406,25.973,0.1],[44.4,25.979,0.1],[44.371,26.148,0.1],[44.371,26.151,0.1],[44.376,26.152,0.1],[44.373,26.152,0.1],[44.374,26.155,0.1],[44.371,26.155,0.1],[44.45,26.202,0.1],[44.397,26.124,0.1],[44.386,26.064,0.1],[44.371,26.128,0.1],[44.404,26.166,0.1],[44.445,26.081,0.1],[44.428,26.028,0.1],[44.404,26.02,0.1],[44.37,26.136,0.1],[44.457,25.998,0.1],[44.457,26.0,0.1],[44.448,26.0,0.1],[44.37,26.13,0.1],[44.35,26.091,0.1],[44.41,26.199,0.1],[44.421,26.195,0.1],[44.444,26.043,0.1],[44.445,26.023,0.1],[44.493,26.146,0.1],[44.448,25.991,0.1],[44.415,26.037,0.1],[44.361,26.152,0.1],[44.478,26.053,0.1],[44.486,26.108,0.1],[44.438,25.989,0.1],[44.361,26.136,0.1],[44.412,26.199,0.1],[44.38,26.183,0.1],[44.365,26.155,0.1],[44.365,26.157,0.1],[44.353,26.145,0.1],[44.463,26.035,0.1],[44.412,26.201,0.1],[44.373,26.19,0.1],[44.49,26.116,0.1],[44.477,25.979,0.1],[44.374,26.128,0.1],[44.376,26.189,0.1],[44.407,26.115,0.1],[44.434,26.082,0.1],[44.415,26.019,0.1],[44.419,26.017,0.1],[44.419,26.016,0.1],[44.438,26.097,0.1],[44.425,26.023,0.1],[44.424,26.038,0.1],[44.465,26.11,0.1],[44.454,26.102,0.1],[44.462,26.121,0.1],[44.46,26.125,0.1],[44.459,26.125,0.1],[44.46,26.127,0.1],[44.453,26.124,0.1],[44.454,26.106,0.1],[44.46,26.115,0.1],[44.465,26.118,0.1],[44.427,26.149,0.1],[44.424,26.14,0.1],[44.424,26.145,0.1],[44.424,26.143,0.1],[44.419,26.146,0.1],[44.436,26.163,0.1],[44.436,26.162,0.1],[44.434,26.166,0.1],[44.434,26.165,0.1],[44.433,26.163,0.1],[44.43,26.165,0.1],[44.43,26.168,0.1],[44.431,26.169,0.1],[44.419,26.142,0.1],[44.422,26.017,0.1],[44.444,26.017,0.1],[44.444,26.128,0.1],[44.415,26.032,0.1],[44.416,26.032,0.1],[44.418,26.025,0.1],[44.419,26.023,0.1],[44.422,26.026,0.1],[44.421,26.041,0.1],[44.419,26.038,0.1],[44.418,26.043,0.1],[44.418,26.137,0.1],[44.468,26.143,0.1],[44.468,26.145,0.1],[44.465,26.146,0.1],[44.444,26.142,0.1],[44.444,26.145,0.1],[44.444,26.157,0.1],[44.444,26.166,0.1],[44.442,26.169,0.1],[44.442,26.172,0.1],[44.441,26.181,0.1],[44.439,26.079,0.1],[44.439,26.078,0.1],[44.442,26.076,0.1],[44.424,26.134,0.1],[44.481,26.122,0.1],[44.424,26.131,0.1],[44.415,26.154,0.1],[44.421,26.162,0.1],[44.442,26.137,0.1],[44.424,26.169,0.1],[44.422,26.169,0.1],[44.424,26.165,0.1],[44.424,26.175,0.1],[44.454,26.099,0.1],[44.483,26.058,0.1],[44.383,26.1,0.1],[44.385,26.102,0.1],[44.412,26.163,0.1],[44.433,26.102,0.1],[44.413,26.154,0.1],[44.413,26.163,0.1],[44.412,26.177,0.1],[44.412,26.174,0.1],[44.413,26.151,0.1],[44.41,26.165,0.1],[44.409,26.169,0.1],[44.415,26.149,0.1],[44.416,26.148,0.1],[44.418,26.143,0.1],[44.416,26.143,0.1],[44.441,26.091,0.1],[44.406,26.146,0.1],[44.407,26.146,0.1],[44.409,26.171,0.1],[44.409,26.166,0.1],[44.412,26.151,0.1],[44.412,26.152,0.1],[44.413,26.177,0.1],[44.409,26.082,0.1],[44.418,26.174,0.1],[44.409,26.165,0.1],[44.416,26.166,0.1],[44.431,26.094,0.1],[44.444,26.118,0.1],[44.422,26.066,0.1],[44.391,26.081,0.1],[44.409,26.145,0.1],[44.407,26.143,0.1],[44.413,26.183,0.1],[44.415,26.181,0.1],[44.415,26.178,0.1],[44.406,26.175,0.1],[44.407,26.178,0.1],[44.438,26.133,0.1],[44.427,26.133,0.1],[44.407,26.093,0.1],[44.404,26.096,0.1],[44.442,26.073,0.1],[44.428,26.175,0.1],[44.415,26.108,0.1],[44.394,26.119,0.1],[44.43,26.108,0.1],[44.383,26.137,0.1],[44.428,26.131,0.1],[44.433,26.127,0.1],[44.424,26.122,0.1],[44.447,26.125,0.1],[44.454,26.04,0.1],[44.442,26.157,0.1],[44.412,26.116,0.1],[44.41,26.116,0.1],[44.391,26.093,0.1],[44.412,26.139,0.1],[44.409,26.14,0.1],[44.412,26.137,0.1],[44.397,26.115,0.1],[44.395,26.112,0.1],[44.392,26.109,0.1],[44.398,26.108,0.1],[44.398,26.102,0.1],[44.4,26.103,0.1],[44.383,26.106,0.1],[44.385,26.093,0.1],[44.383,26.097,0.1],[44.379,26.097,0.1],[44.419,26.169,0.1],[44.382,26.096,0.1],[44.382,26.099,0.1],[44.377,26.103,0.1],[44.379,26.102,0.1],[44.377,26.105,0.1],[44.38,26.106,0.1],[44.377,26.109,0.1],[44.38,26.116,0.1],[44.379,26.118,0.1],[44.379,26.124,0.1],[44.38,26.13,0.1],[44.389,26.125,0.1],[44.385,26.134,0.1],[44.386,26.137,0.1],[44.391,26.128,0.1],[44.391,26.133,0.1],[44.439,26.157,0.1],[44.438,26.157,0.1],[44.442,26.154,0.1],[44.499,26.031,0.1],[44.441,26.055,0.1],[44.451,26.07,0.1],[44.436,26.102,0.1],[44.438,26.102,0.1],[44.462,26.108,0.1],[44.442,26.017,0.1],[44.439,26.016,0.1],[44.416,26.047,0.1],[44.418,26.046,0.1],[44.416,26.043,0.1],[44.418,26.044,0.1],[44.454,26.05,0.1],[44.457,26.046,0.1],[44.456,26.052,0.1],[44.456,26.053,0.1],[44.456,26.055,0.1],[44.462,26.046,0.1],[44.46,26.047,0.1],[44.459,26.052,0.1],[44.422,26.113,0.1],[44.421,26.112,0.1],[44.422,26.122,0.1],[44.419,26.119,0.1],[44.412,26.124,0.1],[44.419,26.133,0.1],[44.421,26.133,0.1],[44.415,26.082,0.1],[44.406,26.061,0.1],[44.409,26.069,0.1],[44.407,26.07,0.1],[44.409,26.062,0.1],[44.41,26.062,0.1],[44.41,26.064,0.1],[44.406,26.059,0.1],[44.409,26.059,0.1],[44.412,26.062,0.1],[44.41,26.07,0.1],[44.41,26.075,0.1],[44.412,26.075,0.1],[44.41,26.076,0.1],[44.413,26.076,0.1],[44.409,26.079,0.1],[44.406,26.076,0.1],[44.403,26.059,0.1],[44.403,26.056,0.1],[44.401,26.053,0.1],[44.403,26.052,0.1],[44.436,26.087,0.1],[44.415,26.072,0.1],[44.416,26.067,0.1],[44.415,26.067,0.1],[44.416,26.061,0.1],[44.434,26.016,0.1],[44.434,26.023,0.1],[44.436,26.028,0.1],[44.436,26.034,0.1],[44.436,26.015,0.1],[44.445,26.168,0.1],[44.434,26.169,0.1],[44.438,26.172,0.1],[44.438,26.174,0.1],[44.43,26.016,0.1],[44.433,26.007,0.1],[44.441,26.032,0.1],[44.441,26.031,0.1],[44.441,26.035,0.1],[44.442,26.183,0.1],[44.422,26.16,0.1],[44.46,26.049,0.1],[44.456,26.041,0.1],[44.444,26.059,0.1],[44.421,26.163,0.1],[44.431,25.988,0.1],[44.438,25.983,0.1],[44.43,26.004,0.1],[44.418,26.047,0.1],[44.424,26.015,0.1],[44.424,26.142,0.1],[44.419,26.019,0.1],[44.425,26.034,0.1],[44.419,26.037,0.1],[44.459,26.078,0.1],[44.457,26.078,0.1],[44.456,26.078,0.1],[44.451,26.084,0.1],[44.451,26.072,0.1],[44.45,26.072,0.1],[44.466,26.055,0.1],[44.468,26.053,0.1],[44.471,26.049,0.1],[44.468,26.062,0.1],[44.444,26.097,0.1],[44.439,26.004,0.1],[44.441,26.006,0.1],[44.438,26.009,0.1],[44.397,26.108,0.1],[44.438,26.162,0.1],[44.438,26.166,0.1],[44.386,26.124,0.1],[44.445,26.09,0.1],[44.481,26.052,0.1],[44.445,26.143,0.1],[44.433,26.108,0.1],[44.466,26.113,0.1],[44.441,26.093,0.1],[44.444,26.146,0.1],[44.445,26.097,0.1],[44.451,26.121,0.1],[44.45,26.121,0.1],[44.434,26.087,0.1],[44.434,26.088,0.1],[44.407,26.091,0.1],[44.406,26.091,0.1],[44.457,26.097,0.1],[44.442,26.067,0.1],[44.441,26.069,0.1],[44.493,26.084,0.1],[44.489,26.038,0.1],[44.487,26.038,0.1],[44.486,26.037,0.1],[44.394,26.096,0.1],[44.395,26.096,0.1],[44.386,26.09,0.1],[44.389,26.091,0.1],[44.385,26.09,0.1],[44.424,26.07,0.1],[44.424,26.084,0.1],[44.406,26.078,0.1],[44.406,26.079,0.1],[44.436,26.088,0.1],[44.409,26.088,0.1],[44.436,26.1,0.1],[44.451,26.145,0.1],[44.412,26.108,0.1],[44.413,26.106,0.1],[44.41,26.11,0.1],[44.409,26.113,0.1],[44.409,26.115,0.1],[44.409,26.118,0.1],[44.412,26.113,0.1],[44.439,26.099,0.1],[44.451,26.088,0.1],[44.419,26.01,0.1],[44.441,26.081,0.1],[44.392,26.103,0.1],[44.389,26.105,0.1],[44.484,26.073,0.1],[44.409,26.127,0.1],[44.41,26.128,0.1],[44.478,26.115,0.1],[44.404,25.994,0.1],[44.441,26.022,0.1],[44.416,26.103,0.1],[44.404,26.093,0.1],[44.439,26.04,0.1],[44.457,25.979,0.1],[44.477,26.178,0.1],[44.418,26.001,0.1],[44.442,25.985,0.1],[44.444,25.989,0.1],[44.474,26.18,0.1],[44.422,26.064,0.1],[44.422,26.097,0.1],[44.431,26.072,0.1],[44.43,25.976,0.1],[44.376,26.121,0.1],[44.436,26.175,0.1],[44.436,26.184,0.1],[44.434,25.98,0.1],[44.434,25.979,0.1],[44.406,26.181,0.1],[44.374,26.116,0.1],[44.376,26.108,0.1],[44.431,26.041,0.1],[44.376,26.124,0.1],[44.438,26.108,0.1],[44.401,26.116,0.1],[44.374,26.122,0.1],[44.465,26.061,0.1],[44.525,26.038,0.1],[44.526,26.041,0.1],[44.362,26.023,0.1],[44.439,26.058,0.1],[44.359,26.028,0.1],[44.392,26.004,0.1],[44.358,26.137,0.1],[44.419,26.072,0.1],[44.48,26.157,0.1],[44.383,26.149,0.1],[44.38,26.143,0.1],[44.379,26.163,0.1],[44.382,26.157,0.1],[44.471,26.094,0.1],[44.478,26.119,0.1],[44.427,26.184,0.1],[44.41,26.152,0.1],[44.371,26.154,0.1],[44.413,26.082,0.1],[44.442,26.05,0.1],[44.368,26.154,0.1],[44.427,26.016,0.1],[44.395,26.032,0.1],[44.394,25.982,0.1],[44.447,26.202,0.1],[44.436,25.994,0.1],[44.436,25.992,0.1],[44.404,26.171,0.1],[44.496,25.991,0.1],[44.398,25.976,0.1],[44.492,26.069,0.1],[44.365,26.152,0.1],[44.392,26.006,0.1],[44.421,25.985,0.1],[44.403,26.009,0.1],[44.469,26.023,0.1],[44.465,26.022,0.1],[44.371,26.149,0.1],[44.37,26.149,0.1],[44.37,26.146,0.1],[44.367,26.152,0.1],[44.376,26.151,0.1],[44.374,26.154,0.1],[44.511,26.022,0.1],[44.448,26.202,0.1],[44.367,26.154,0.1],[44.371,26.139,0.1],[44.448,25.986,0.1],[44.448,25.98,0.1],[44.445,25.983,0.1],[44.471,26.112,0.1],[44.448,26.043,0.1],[44.416,26.187,0.1],[44.415,26.19,0.1],[44.416,26.189,0.1],[44.425,26.062,0.1],[44.388,26.064,0.1],[44.425,25.995,0.1],[44.475,26.174,0.1],[44.364,26.151,0.1],[44.368,26.155,0.1],[44.37,26.157,0.1],[44.471,26.175,0.1],[44.471,26.174,0.1],[44.418,26.085,0.1],[44.386,26.13,0.1],[44.434,26.154,0.1],[44.37,26.124,0.1],[44.361,26.151,0.1],[44.365,26.154,0.1],[44.377,26.127,0.1],[44.361,26.093,0.1],[44.358,26.096,0.1],[44.48,26.103,0.1],[44.428,26.016,0.1],[44.525,26.015,0.1],[44.445,26.067,0.1],[44.468,26.052,0.1],[44.448,25.998,0.1],[44.404,26.189,0.1],[44.419,26.001,0.1],[44.413,25.97,0.1],[44.442,26.043,0.1],[44.403,25.977,0.1],[44.441,26.049,0.1],[44.442,26.052,0.1],[44.516,26.019,0.1],[44.502,26.075,0.1],[44.444,25.977,0.1],[44.444,25.976,0.1],[44.444,25.973,0.1],[44.439,25.979,0.1],[44.415,26.198,0.1],[44.415,26.196,0.1],[44.415,26.035,0.1],[44.478,26.118,0.1],[44.37,26.184,0.1],[44.41,26.193,0.1],[44.425,25.989,0.1],[44.441,26.184,0.1],[44.361,26.134,0.1],[44.359,26.134,0.1],[44.413,26.05,0.1],[44.439,26.163,0.1],[44.368,26.159,0.1],[44.431,25.977,0.1],[44.401,26.154,0.1],[44.459,26.0,0.1],[44.418,26.07,0.1],[44.406,26.05,0.1],[44.52,26.061,0.1],[44.409,26.199,0.1],[44.448,25.956,0.1],[44.471,26.181,0.1],[44.388,26.003,0.1],[44.477,26.066,0.0],[44.453,26.088,0.0],[44.439,26.1,0.0],[44.379,26.136,0.0],[44.413,26.02,0.0],[44.413,26.015,0.0],[44.416,26.019,0.0],[44.416,26.02,0.0],[44.424,26.013,0.0],[44.459,26.108,0.0],[44.424,26.034,0.0],[44.441,26.053,0.0],[44.466,26.094,0.0],[44.463,26.124,0.0],[44.459,26.131,0.0],[44.456,26.128,0.0],[44.454,26.124,0.0],[44.456,26.106,0.0],[44.456,26.108,0.0],[44.459,26.113,0.0],[44.425,26.148,0.0],[44.442,26.16,0.0],[44.444,26.162,0.0],[44.424,26.146,0.0],[44.424,26.148,0.0],[44.422,26.148,0.0],[44.43,26.149,0.0],[44.428,26.148,0.0],[44.431,26.155,0.0],[44.431,26.162,0.0],[44.431,26.163,0.0],[44.433,26.162,0.0],[44.436,26.168,0.0],[44.433,26.165,0.0],[44.434,26.168,0.0],[44.43,26.171,0.0],[44.433,26.171,0.0],[44.434,26.172,0.0],[44.436,26.171,0.0],[44.421,26.14,0.0],[44.492,26.096,0.0],[44.422,26.016,0.0],[44.441,26.175,0.0],[44.431,26.062,0.0],[44.427,26.055,0.0],[44.428,26.066,0.0],[44.424,26.017,0.0],[44.46,26.1,0.0],[44.416,26.031,0.0],[44.415,26.029,0.0],[44.413,26.028,0.0],[44.418,26.028,0.0],[44.421,26.028,0.0],[44.422,26.025,0.0],[44.421,26.025,0.0],[44.425,26.041,0.0],[44.425,26.046,0.0],[44.425,26.049,0.0],[44.421,26.038,0.0],[44.466,26.146,0.0],[44.466,26.142,0.0],[44.466,26.148,0.0],[44.466,26.155,0.0],[44.463,26.137,0.0],[44.465,26.136,0.0],[44.463,26.136,0.0],[44.453,26.146,0.0],[44.451,26.151,0.0],[44.451,26.148,0.0],[44.46,26.136,0.0],[44.459,26.137,0.0],[44.457,26.137,0.0],[44.456,26.14,0.0],[44.457,26.105,0.0],[44.439,26.085,0.0],[44.438,26.088,0.0],[44.439,26.087,0.0],[44.465,26.103,0.0],[44.483,26.116,0.0],[44.481,26.047,0.0],[44.416,26.152,0.0],[44.444,26.137,0.0],[44.445,26.136,0.0],[44.444,26.133,0.0],[44.444,26.134,0.0],[44.442,26.13,0.0],[44.439,26.134,0.0],[44.442,26.131,0.0],[44.442,26.133,0.0],[44.424,26.168,0.0],[44.422,26.171,0.0],[44.425,26.166,0.0],[44.483,26.055,0.0],[44.483,26.056,0.0],[44.481,26.053,0.0],[44.385,26.1,0.0],[44.388,26.106,0.0],[44.383,26.102,0.0],[44.412,26.162,0.0],[44.413,26.162,0.0],[44.427,26.109,0.0],[44.416,26.16,0.0],[44.415,26.166,0.0],[44.416,26.168,0.0],[44.416,26.146,0.0],[44.431,26.16,0.0],[44.43,26.166,0.0],[44.407,26.145,0.0],[44.412,26.169,0.0],[44.412,26.154,0.0],[44.415,26.145,0.0],[44.415,26.143,0.0],[44.41,26.175,0.0],[44.413,26.171,0.0],[44.413,26.178,0.0],[44.412,26.178,0.0],[44.428,26.137,0.0],[44.416,26.178,0.0],[44.419,26.175,0.0],[44.419,26.174,0.0],[44.424,26.178,0.0],[44.407,26.172,0.0],[44.422,26.174,0.0],[44.421,26.172,0.0],[44.442,26.116,0.0],[44.409,26.07,0.0],[44.404,26.058,0.0],[44.422,26.059,0.0],[44.424,26.061,0.0],[44.424,26.062,0.0],[44.421,26.059,0.0],[44.419,26.059,0.0],[44.421,26.062,0.0],[44.389,26.076,0.0],[44.388,26.085,0.0],[44.416,26.105,0.0],[44.415,26.172,0.0],[44.413,26.184,0.0],[44.412,26.18,0.0],[44.407,26.175,0.0],[44.404,26.175,0.0],[44.404,26.178,0.0],[44.409,26.178,0.0],[44.463,26.099,0.0],[44.447,26.108,0.0],[44.43,26.137,0.0],[44.428,26.136,0.0],[44.416,26.137,0.0],[44.419,26.128,0.0],[44.424,26.103,0.0],[44.418,26.166,0.0],[44.428,26.177,0.0],[44.427,26.175,0.0],[44.41,26.142,0.0],[44.413,26.145,0.0],[44.385,26.085,0.0],[44.394,26.115,0.0],[44.43,26.109,0.0],[44.407,26.073,0.0],[44.418,26.165,0.0],[44.438,26.119,0.0],[44.431,26.131,0.0],[44.425,26.121,0.0],[44.427,26.121,0.0],[44.428,26.13,0.0],[44.445,26.119,0.0],[44.448,26.121,0.0],[44.439,26.105,0.0],[44.409,26.096,0.0],[44.395,26.109,0.0],[44.398,26.103,0.0],[44.398,26.105,0.0],[44.386,26.108,0.0],[44.385,26.109,0.0],[44.388,26.108,0.0],[44.383,26.105,0.0],[44.385,26.105,0.0],[44.383,26.108,0.0],[44.388,26.102,0.0],[44.388,26.1,0.0],[44.379,26.096,0.0],[44.386,26.096,0.0],[44.386,26.094,0.0],[44.38,26.094,0.0],[44.379,26.094,0.0],[44.385,26.094,0.0],[44.379,26.105,0.0],[44.382,26.1,0.0],[44.382,26.103,0.0],[44.38,26.108,0.0],[44.385,26.11,0.0],[44.377,26.118,0.0],[44.383,26.121,0.0],[44.385,26.122,0.0],[44.38,26.122,0.0],[44.382,26.127,0.0],[44.388,26.127,0.0],[44.383,26.131,0.0],[44.392,26.13,0.0],[44.391,26.13,0.0],[44.391,26.131,0.0],[44.466,26.049,0.0],[44.478,26.18,0.0],[44.447,26.127,0.0],[44.419,26.013,0.0],[44.422,26.09,0.0],[44.444,26.143,0.0],[44.436,26.013,0.0],[44.438,26.013,0.0],[44.434,26.102,0.0],[44.436,26.106,0.0],[44.438,26.106,0.0],[44.434,26.096,0.0],[44.438,26.109,0.0],[44.412,26.142,0.0],[44.41,26.146,0.0],[44.412,26.149,0.0],[44.415,26.133,0.0],[44.45,26.087,0.0],[44.481,26.088,0.0],[44.427,26.04,0.0],[44.428,26.041,0.0],[44.434,26.099,0.0],[44.418,26.041,0.0],[44.419,26.041,0.0],[44.454,26.047,0.0],[44.454,26.052,0.0],[44.453,26.052,0.0],[44.463,26.04,0.0],[44.459,26.053,0.0],[44.421,26.113,0.0],[44.421,26.11,0.0],[44.422,26.11,0.0],[44.419,26.116,0.0],[44.418,26.119,0.0],[44.418,26.121,0.0],[44.421,26.122,0.0],[44.421,26.124,0.0],[44.416,26.122,0.0],[44.413,26.124,0.0],[44.416,26.081,0.0],[44.416,26.082,0.0],[44.406,26.064,0.0],[44.407,26.064,0.0],[44.404,26.07,0.0],[44.406,26.062,0.0],[44.412,26.061,0.0],[44.413,26.064,0.0],[44.413,26.073,0.0],[44.407,26.072,0.0],[44.409,26.073,0.0],[44.407,26.076,0.0],[44.401,26.088,0.0],[44.407,26.081,0.0],[44.409,26.081,0.0],[44.403,26.055,0.0],[44.406,26.056,0.0],[44.43,26.097,0.0],[44.415,26.064,0.0],[44.418,26.064,0.0],[44.416,26.064,0.0],[44.424,26.181,0.0],[44.425,26.18,0.0],[44.419,26.061,0.0],[44.434,26.013,0.0],[44.434,26.015,0.0],[44.441,26.025,0.0],[44.438,26.029,0.0],[44.438,26.015,0.0],[44.442,26.013,0.0],[44.434,26.038,0.0],[44.438,26.037,0.0],[44.434,26.035,0.0],[44.442,26.163,0.0],[44.441,26.172,0.0],[44.444,26.172,0.0],[44.442,26.177,0.0],[44.433,26.168,0.0],[44.433,26.026,0.0],[44.434,26.029,0.0],[44.431,26.023,0.0],[44.433,26.019,0.0],[44.431,26.026,0.0],[44.444,26.031,0.0],[44.442,26.031,0.0],[44.439,26.032,0.0],[44.433,26.031,0.0],[44.454,26.041,0.0],[44.456,26.04,0.0],[44.445,26.056,0.0],[44.424,26.172,0.0],[44.433,25.988,0.0],[44.43,26.169,0.0],[44.425,26.019,0.0],[44.427,26.171,0.0],[44.428,26.169,0.0],[44.431,26.128,0.0],[44.43,26.119,0.0],[44.433,26.13,0.0],[44.421,26.017,0.0],[44.415,26.025,0.0],[44.425,26.035,0.0],[44.427,26.044,0.0],[44.425,26.043,0.0],[44.428,26.05,0.0],[44.421,26.046,0.0],[44.422,26.049,0.0],[44.457,26.064,0.0],[44.463,26.072,0.0],[44.462,26.075,0.0],[44.456,26.075,0.0],[44.454,26.081,0.0],[44.453,26.084,0.0],[44.451,26.081,0.0],[44.453,26.081,0.0],[44.453,26.075,0.0],[44.453,26.072,0.0],[44.448,26.078,0.0],[44.445,26.079,0.0],[44.444,26.078,0.0],[44.445,26.073,0.0],[44.448,26.07,0.0],[44.46,26.059,0.0],[44.471,26.05,0.0],[44.472,26.049,0.0],[44.474,26.047,0.0],[44.474,26.049,0.0],[44.472,26.05,0.0],[44.469,26.056,0.0],[44.471,26.058,0.0],[44.469,26.061,0.0],[44.466,26.072,0.0],[44.409,26.137,0.0],[44.459,26.124,0.0],[44.418,26.184,0.0],[44.441,26.102,0.0],[44.422,26.172,0.0],[44.439,26.006,0.0],[44.439,26.007,0.0],[44.442,26.166,0.0],[44.463,26.075,0.0],[44.462,26.076,0.0],[44.46,26.076,0.0],[44.444,26.064,0.0],[44.477,26.049,0.0],[44.477,26.047,0.0],[44.481,26.044,0.0],[44.442,26.142,0.0],[44.444,26.094,0.0],[44.445,26.116,0.0],[44.434,26.162,0.0],[44.438,26.139,0.0],[44.45,26.122,0.0],[44.442,26.025,0.0],[44.434,26.115,0.0],[44.439,26.174,0.0],[44.442,26.112,0.0],[44.442,26.1,0.0],[44.434,26.09,0.0],[44.447,26.029,0.0],[44.456,26.099,0.0],[44.442,26.069,0.0],[44.492,26.079,0.0],[44.484,26.038,0.0],[44.486,26.04,0.0],[44.391,26.096,0.0],[44.428,26.097,0.0],[44.392,26.081,0.0],[44.391,26.075,0.0],[44.392,26.082,0.0],[44.436,26.07,0.0],[44.425,26.069,0.0],[44.427,26.067,0.0],[44.425,26.07,0.0],[44.424,26.072,0.0],[44.422,26.072,0.0],[44.422,26.073,0.0],[44.424,26.076,0.0],[44.424,26.082,0.0],[44.404,26.078,0.0],[44.404,26.081,0.0],[44.442,26.088,0.0],[44.433,26.082,0.0],[44.427,26.145,0.0],[44.397,26.146,0.0],[44.388,26.139,0.0],[44.427,26.118,0.0],[44.419,26.165,0.0],[44.407,26.085,0.0],[44.448,26.099,0.0],[44.45,26.093,0.0],[44.445,26.096,0.0],[44.45,26.091,0.0],[44.397,26.119,0.0],[44.433,26.175,0.0],[44.428,26.186,0.0],[44.427,26.189,0.0],[44.45,26.088,0.0],[44.434,26.11,0.0],[44.445,26.145,0.0],[44.442,26.125,0.0],[44.442,26.124,0.0],[44.415,26.109,0.0],[44.415,26.113,0.0],[44.413,26.112,0.0],[44.436,26.109,0.0],[44.416,26.11,0.0],[44.425,26.103,0.0],[44.422,26.109,0.0],[44.406,26.124,0.0],[44.439,26.115,0.0],[44.433,26.131,0.0],[44.376,26.094,0.0],[44.427,26.124,0.0],[44.45,26.084,0.0],[44.445,26.099,0.0],[44.445,26.085,0.0],[44.438,26.112,0.0],[44.441,26.154,0.0],[44.434,26.155,0.0],[44.442,26.115,0.0],[44.422,26.108,0.0],[44.419,26.009,0.0],[44.418,26.007,0.0],[44.391,26.105,0.0],[44.395,26.106,0.0],[44.434,26.108,0.0],[44.477,26.184,0.0],[44.439,26.16,0.0],[44.391,26.124,0.0],[44.428,26.067,0.0],[44.475,26.066,0.0],[44.409,26.133,0.0],[44.418,26.079,0.0],[44.386,26.116,0.0],[44.45,26.124,0.0],[44.407,26.096,0.0],[44.448,26.087,0.0],[44.397,26.113,0.0],[44.444,26.055,0.0],[44.377,26.124,0.0],[44.398,26.119,0.0],[44.394,26.026,0.0],[44.388,26.116,0.0],[44.391,26.103,0.0],[44.422,26.093,0.0],[44.453,26.121,0.0],[44.415,26.102,0.0],[44.495,26.097,0.0],[44.49,26.125,0.0],[44.371,26.119,0.0],[44.447,26.037,0.0],[44.445,25.947,0.0],[44.441,26.02,0.0],[44.442,25.965,0.0],[44.418,26.097,0.0],[44.398,26.113,0.0],[44.385,26.128,0.0],[44.468,26.046,0.0],[44.492,26.088,0.0],[44.427,26.096,0.0],[44.427,26.097,0.0],[44.483,26.109,0.0],[44.484,26.11,0.0],[44.418,26.004,0.0],[44.418,26.003,0.0],[44.382,26.119,0.0],[44.444,25.988,0.0],[44.444,25.991,0.0],[44.442,25.989,0.0],[44.445,25.988,0.0],[44.445,25.986,0.0],[44.376,26.103,0.0],[44.38,26.169,0.0],[44.474,26.181,0.0],[44.433,26.19,0.0],[44.478,26.103,0.0],[44.419,26.099,0.0],[44.404,26.208,0.0],[44.442,26.113,0.0],[44.361,26.09,0.0],[44.406,25.992,0.0],[44.388,26.061,0.0],[44.388,26.006,0.0],[44.448,26.131,0.0],[44.431,26.192,0.0],[44.478,26.043,0.0],[44.407,26.18,0.0],[44.468,26.091,0.0],[44.382,26.081,0.0],[44.456,26.125,0.0],[44.427,26.099,0.0],[44.376,26.109,0.0],[44.427,26.076,0.0],[44.43,26.032,0.0],[44.365,26.148,0.0],[44.371,26.183,0.0],[44.469,26.112,0.0],[44.483,26.044,0.0],[44.359,26.088,0.0],[44.358,26.094,0.0],[44.346,26.085,0.0],[44.373,26.124,0.0],[44.371,26.124,0.0],[44.407,26.208,0.0],[44.528,26.04,0.0],[44.526,26.037,0.0],[44.528,26.041,0.0],[44.529,26.044,0.0],[44.409,26.091,0.0],[44.346,26.181,0.0],[44.361,26.029,0.0],[44.376,26.046,0.0],[44.412,26.087,0.0],[44.412,26.088,0.0],[44.38,26.165,0.0],[44.382,26.004,0.0],[44.389,26.01,0.0],[44.382,26.001,0.0],[44.406,25.985,0.0],[44.404,25.985,0.0],[44.365,26.133,0.0],[44.382,26.148,0.0],[44.382,26.146,0.0],[44.382,26.145,0.0],[44.377,26.151,0.0],[44.377,26.159,0.0],[44.376,26.159,0.0],[44.466,26.159,0.0],[44.407,25.991,0.0],[44.416,26.119,0.0],[44.531,26.058,0.0],[44.346,26.084,0.0],[44.41,26.151,0.0],[44.37,26.155,0.0],[44.48,26.116,0.0],[44.388,26.096,0.0],[44.37,26.152,0.0],[44.427,26.017,0.0],[44.478,26.058,0.0],[44.371,26.137,0.0],[44.441,26.041,0.0],[44.469,26.106,0.0],[44.439,25.977,0.0],[44.367,26.093,0.0],[44.492,26.118,0.0],[44.406,26.165,0.0],[44.398,25.991,0.0],[44.401,25.979,0.0],[44.37,26.14,0.0],[44.386,26.062,0.0],[44.365,26.151,0.0],[44.374,26.148,0.0],[44.389,26.007,0.0],[44.398,26.007,0.0],[44.424,25.995,0.0],[44.395,26.026,0.0],[44.392,26.012,0.0],[44.394,26.01,0.0],[44.392,26.007,0.0],[44.362,26.209,0.0],[44.37,26.151,0.0],[44.376,26.154,0.0],[44.376,26.149,0.0],[44.415,26.121,0.0],[44.371,26.157,0.0],[44.382,26.171,0.0],[44.38,26.171,0.0],[44.379,26.14,0.0],[44.38,26.139,0.0],[44.45,26.201,0.0],[44.374,26.152,0.0],[44.371,26.18,0.0],[44.377,26.146,0.0],[44.383,26.152,0.0],[44.373,26.154,0.0],[44.447,25.982,0.0],[44.451,25.986,0.0],[44.453,25.983,0.0],[44.535,26.062,0.0],[44.374,26.103,0.0],[44.37,26.134,0.0],[44.442,26.02,0.0],[44.441,26.16,0.0],[44.373,26.168,0.0],[44.413,26.192,0.0],[44.373,26.112,0.0],[44.371,26.116,0.0],[44.469,26.172,0.0],[44.428,26.029,0.0],[44.444,26.049,0.0],[44.373,26.128,0.0],[44.444,26.009,0.0],[44.478,26.137,0.0],[44.359,26.091,0.0],[44.511,26.02,0.0],[44.451,26.01,0.0],[44.451,26.003,0.0],[44.453,26.003,0.0],[44.434,26.174,0.0],[44.43,26.066,0.0],[44.362,26.116,0.0],[44.489,26.062,0.0],[44.379,26.189,0.0],[44.37,26.115,0.0],[44.463,26.061,0.0],[44.456,25.968,0.0],[44.457,26.159,0.0],[44.428,26.032,0.0],[44.388,26.025,0.0],[44.409,26.157,0.0],[44.407,26.157,0.0],[44.433,26.053,0.0],[44.41,26.214,0.0],[44.392,26.149,0.0],[44.447,25.979,0.0],[44.453,26.122,0.0],[44.43,26.1,0.0],[44.43,26.105,0.0],[44.4,25.985,0.0],[44.433,26.041,0.0],[44.422,26.192,0.0],[44.444,25.974,0.0],[44.444,25.982,0.0],[44.444,25.98,0.0],[44.493,26.122,0.0],[44.469,26.026,0.0],[44.468,26.026,0.0],[44.413,26.199,0.0],[44.415,26.193,0.0],[44.419,26.0,0.0],[44.376,26.177,0.0],[44.397,26.159,0.0],[44.397,26.16,0.0],[44.469,26.18,0.0],[44.468,26.177,0.0],[44.474,26.175,0.0],[44.418,26.189,0.0],[44.495,26.119,0.0],[44.495,26.122,0.0],[44.367,26.181,0.0],[44.451,26.183,0.0],[44.365,26.178,0.0],[44.367,26.186,0.0],[44.368,26.18,0.0],[44.367,26.159,0.0],[44.431,26.04,0.0],[44.368,26.177,0.0],[44.441,25.979,0.0],[44.383,26.143,0.0],[44.481,26.11,0.0],[44.376,26.201,0.0],[44.383,26.193,0.0],[44.374,26.13,0.0],[44.511,26.206,0.0],[44.513,26.205,0.0],[44.365,26.184,0.0],[44.48,26.041,0.0],[44.406,26.047,0.0],[44.418,26.0,0.0],[44.41,26.196,0.0],[44.459,26.175,0.0],[44.439,26.05,0.0],[44.495,26.118,0.0],[44.359,26.152,0.0],[44.371,26.19,0.0],[44.37,26.193,0.0],[44.468,25.963,0.0],[44.463,26.19,0.0],[44.472,26.174,0.0],[44.421,26.201,0.0],[44.451,25.959,0.0],[44.415,25.97,0.0],[44.474,26.183,0.0],[44.385,26.026,0.0],[44.489,26.121,0.0],[44.397,25.977,0.0],[44.442,26.097,0.0],[44.45,26.094,0.0],[44.472,26.07,0.0],[44.436,26.146,0.0],[44.499,26.072,0.0],[44.425,26.178,0.0],[44.415,26.022,0.0],[44.415,26.016,0.0],[44.412,26.019,0.0],[44.416,26.017,0.0],[44.421,26.013,0.0],[44.484,26.099,0.0],[44.442,26.072,0.0],[44.424,26.023,0.0],[44.424,26.035,0.0],[44.427,26.031,0.0],[44.425,26.031,0.0],[44.487,26.093,0.0],[44.475,26.109,0.0],[44.477,26.091,0.0],[44.465,26.106,0.0],[44.454,26.105,0.0],[44.463,26.127,0.0],[44.462,26.122,0.0],[44.463,26.122,0.0],[44.463,26.125,0.0],[44.46,26.122,0.0],[44.46,26.131,0.0],[44.459,26.13,0.0],[44.454,26.128,0.0],[44.454,26.127,0.0],[44.454,26.125,0.0],[44.457,26.121,0.0],[44.453,26.115,0.0],[44.453,26.11,0.0],[44.457,26.106,0.0],[44.46,26.11,0.0],[44.46,26.112,0.0],[44.462,26.119,0.0],[44.463,26.119,0.0],[44.463,26.121,0.0],[44.425,26.143,0.0],[44.428,26.143,0.0],[44.43,26.145,0.0],[44.428,26.145,0.0],[44.427,26.148,0.0],[44.444,26.159,0.0],[44.444,26.16,0.0],[44.424,26.139,0.0],[44.462,26.115,0.0],[44.463,26.115,0.0],[44.465,26.113,0.0],[44.463,26.113,0.0],[44.463,26.116,0.0],[44.453,26.109,0.0],[44.43,26.148,0.0],[44.431,26.154,0.0],[44.433,26.154,0.0],[44.431,26.148,0.0],[44.431,26.145,0.0],[44.43,26.159,0.0],[44.43,26.163,0.0],[44.431,26.157,0.0],[44.434,26.159,0.0],[44.433,26.16,0.0],[44.436,26.166,0.0],[44.434,26.163,0.0],[44.431,26.168,0.0],[44.431,26.171,0.0],[44.43,26.172,0.0],[44.428,26.171,0.0],[44.433,26.172,0.0],[44.419,26.148,0.0],[44.492,26.094,0.0],[44.424,26.02,0.0],[44.427,26.053,0.0],[44.454,26.043,0.0],[44.425,26.016,0.0],[44.419,26.131,0.0],[44.418,26.133,0.0],[44.415,26.031,0.0],[44.416,26.034,0.0],[44.413,26.031,0.0],[44.413,26.026,0.0],[44.419,26.028,0.0],[44.418,26.026,0.0],[44.416,26.023,0.0],[44.419,26.025,0.0],[44.424,26.028,0.0],[44.427,26.043,0.0],[44.427,26.049,0.0],[44.421,26.04,0.0],[44.422,26.04,0.0],[44.454,26.145,0.0],[44.453,26.148,0.0],[44.454,26.148,0.0],[44.46,26.134,0.0],[44.456,26.13,0.0],[44.445,26.142,0.0],[44.444,26.152,0.0],[44.441,26.178,0.0],[44.441,26.18,0.0],[44.441,26.084,0.0],[44.438,26.085,0.0],[44.438,26.087,0.0],[44.441,26.087,0.0],[44.434,26.085,0.0],[44.466,26.106,0.0],[44.468,26.108,0.0],[44.466,26.108,0.0],[44.465,26.105,0.0],[44.48,26.109,0.0],[44.493,26.081,0.0],[44.424,26.091,0.0],[44.427,26.094,0.0],[44.484,26.091,0.0],[44.415,26.177,0.0],[44.422,26.137,0.0],[44.483,26.046,0.0],[44.48,26.043,0.0],[44.415,26.152,0.0],[44.444,26.139,0.0],[44.441,26.133,0.0],[44.424,26.166,0.0],[44.422,26.165,0.0],[44.421,26.175,0.0],[44.427,26.172,0.0],[44.415,26.162,0.0],[44.415,26.16,0.0],[44.416,26.177,0.0],[44.413,26.155,0.0],[44.413,26.159,0.0],[44.413,26.16,0.0],[44.453,26.076,0.0],[44.415,26.174,0.0],[44.412,26.181,0.0],[44.416,26.162,0.0],[44.418,26.145,0.0],[44.416,26.145,0.0],[44.428,26.165,0.0],[44.415,26.157,0.0],[44.41,26.178,0.0],[44.41,26.177,0.0],[44.409,26.175,0.0],[44.41,26.082,0.0],[44.418,26.175,0.0],[44.406,26.172,0.0],[44.419,26.172,0.0],[44.43,26.093,0.0],[44.436,26.139,0.0],[44.442,26.119,0.0],[44.406,26.058,0.0],[44.422,26.067,0.0],[44.395,26.069,0.0],[44.389,26.078,0.0],[44.392,26.075,0.0],[44.386,26.087,0.0],[44.386,26.085,0.0],[44.389,26.085,0.0],[44.391,26.084,0.0],[44.391,26.085,0.0],[44.421,26.103,0.0],[44.483,26.097,0.0],[44.486,26.096,0.0],[44.453,26.096,0.0],[44.41,26.18,0.0],[44.415,26.186,0.0],[44.412,26.183,0.0],[44.415,26.184,0.0],[44.413,26.186,0.0],[44.419,26.181,0.0],[44.404,26.177,0.0],[44.463,26.097,0.0],[44.448,26.106,0.0],[44.438,26.134,0.0],[44.436,26.136,0.0],[44.431,26.136,0.0],[44.431,26.134,0.0],[44.433,26.137,0.0],[44.427,26.134,0.0],[44.422,26.125,0.0],[44.427,26.131,0.0],[44.419,26.108,0.0],[44.439,26.116,0.0],[44.427,26.165,0.0],[44.427,26.163,0.0],[44.425,26.177,0.0],[44.447,26.1,0.0],[44.392,26.115,0.0],[44.392,26.116,0.0],[44.392,26.119,0.0],[44.391,26.118,0.0],[44.434,26.109,0.0],[44.431,26.109,0.0],[44.469,26.14,0.0],[44.433,26.11,0.0],[44.427,26.125,0.0],[44.425,26.119,0.0],[44.447,26.124,0.0],[44.439,26.11,0.0],[44.459,26.097,0.0],[44.481,26.09,0.0],[44.481,26.087,0.0],[44.439,26.159,0.0],[44.439,26.155,0.0],[44.416,26.14,0.0],[44.392,26.112,0.0],[44.392,26.113,0.0],[44.397,26.11,0.0],[44.392,26.11,0.0],[44.395,26.11,0.0],[44.394,26.109,0.0],[44.391,26.113,0.0],[44.389,26.113,0.0],[44.391,26.109,0.0],[44.383,26.109,0.0],[44.386,26.106,0.0],[44.386,26.099,0.0],[44.386,26.102,0.0],[44.382,26.093,0.0],[44.383,26.093,0.0],[44.453,26.097,0.0],[44.453,26.102,0.0],[44.453,26.099,0.0],[44.38,26.099,0.0],[44.379,26.099,0.0],[44.38,26.103,0.0],[44.38,26.105,0.0],[44.382,26.105,0.0],[44.382,26.108,0.0],[44.382,26.102,0.0],[44.377,26.1,0.0],[44.379,26.113,0.0],[44.376,26.113,0.0],[44.385,26.118,0.0],[44.383,26.124,0.0],[44.382,26.122,0.0],[44.383,26.125,0.0],[44.389,26.134,0.0],[44.389,26.133,0.0],[44.394,26.128,0.0],[44.392,26.127,0.0],[44.441,26.157,0.0],[44.445,26.165,0.0],[44.468,26.049,0.0],[44.477,26.012,0.0],[44.478,26.178,0.0],[44.477,26.169,0.0],[44.46,26.056,0.0],[44.441,26.058,0.0],[44.486,26.032,0.0],[44.419,26.012,0.0],[44.441,26.125,0.0],[44.441,26.108,0.0],[44.438,26.094,0.0],[44.439,26.094,0.0],[44.436,26.105,0.0],[44.434,26.094,0.0],[44.438,26.105,0.0],[44.436,26.108,0.0],[44.416,26.127,0.0],[44.415,26.127,0.0],[44.428,26.166,0.0],[44.412,26.186,0.0],[44.427,26.038,0.0],[44.462,26.106,0.0],[44.438,26.012,0.0],[44.436,26.012,0.0],[44.434,26.009,0.0],[44.433,26.013,0.0],[44.434,25.998,0.0],[44.436,26.003,0.0],[44.431,26.001,0.0],[44.416,26.049,0.0],[44.424,26.049,0.0],[44.427,26.034,0.0],[44.462,26.04,0.0],[44.463,26.043,0.0],[44.422,26.115,0.0],[44.421,26.118,0.0],[44.419,26.122,0.0],[44.419,26.125,0.0],[44.418,26.122,0.0],[44.416,26.124,0.0],[44.418,26.124,0.0],[44.418,26.125,0.0],[44.418,26.127,0.0],[44.416,26.125,0.0],[44.415,26.125,0.0],[44.421,26.13,0.0],[44.419,26.134,0.0],[44.419,26.136,0.0],[44.413,26.075,0.0],[44.416,26.076,0.0],[44.416,26.078,0.0],[44.406,26.07,0.0],[44.412,26.064,0.0],[44.406,26.072,0.0],[44.413,26.078,0.0],[44.407,26.079,0.0],[44.412,26.079,0.0],[44.413,26.079,0.0],[44.407,26.082,0.0],[44.404,26.073,0.0],[44.403,26.075,0.0],[44.404,26.059,0.0],[44.406,26.055,0.0],[44.406,26.053,0.0],[44.419,26.067,0.0],[44.419,26.07,0.0],[44.394,26.067,0.0],[44.394,26.069,0.0],[44.433,26.094,0.0],[44.419,26.064,0.0],[44.434,26.017,0.0],[44.434,26.022,0.0],[44.434,26.031,0.0],[44.434,26.032,0.0],[44.436,26.044,0.0],[44.445,26.169,0.0],[44.442,26.175,0.0],[44.445,26.171,0.0],[44.43,26.017,0.0],[44.43,26.023,0.0],[44.441,26.029,0.0],[44.439,26.034,0.0],[44.441,26.183,0.0],[44.431,26.032,0.0],[44.434,26.012,0.0],[44.454,26.053,0.0],[44.453,26.044,0.0],[44.447,26.052,0.0],[44.448,26.05,0.0],[44.451,26.049,0.0],[44.433,25.986,0.0],[44.419,26.046,0.0],[44.416,26.05,0.0],[44.428,26.172,0.0],[44.419,26.029,0.0],[44.425,26.017,0.0],[44.424,26.177,0.0],[44.43,26.131,0.0],[44.43,26.128,0.0],[44.43,26.121,0.0],[44.431,26.125,0.0],[44.421,26.016,0.0],[44.413,26.022,0.0],[44.415,26.028,0.0],[44.418,26.032,0.0],[44.425,26.032,0.0],[44.425,26.029,0.0],[44.427,26.035,0.0],[44.422,26.047,0.0],[44.457,26.061,0.0],[44.459,26.067,0.0],[44.457,26.067,0.0],[44.462,26.07,0.0],[44.46,26.072,0.0],[44.459,26.076,0.0],[44.456,26.079,0.0],[44.454,26.075,0.0],[44.453,26.079,0.0],[44.453,26.078,0.0],[44.448,26.076,0.0],[44.453,26.067,0.0],[44.451,26.069,0.0],[44.454,26.064,0.0],[44.468,26.058,0.0],[44.469,26.058,0.0],[44.468,26.056,0.0],[44.466,26.058,0.0],[44.471,26.055,0.0],[44.469,26.055,0.0],[44.465,26.072,0.0],[44.465,26.07,0.0],[44.465,26.069,0.0],[44.463,26.073,0.0],[44.463,26.07,0.0],[44.409,26.139,0.0],[44.439,26.103,0.0],[44.434,26.093,0.0],[44.441,26.003,0.0],[44.438,26.007,0.0],[44.439,26.003,0.0],[44.439,26.01,0.0],[44.441,26.174,0.0],[44.427,26.106,0.0],[44.431,26.127,0.0],[44.439,26.124,0.0],[44.433,26.124,0.0],[44.445,26.137,0.0],[44.45,26.05,0.0],[44.445,26.133,0.0],[44.46,26.078,0.0],[44.431,26.07,0.0],[44.433,26.069,0.0],[44.385,26.124,0.0],[44.385,26.127,0.0],[44.444,26.181,0.0],[44.481,26.046,0.0],[44.48,26.05,0.0],[44.478,26.049,0.0],[44.438,26.124,0.0],[44.439,26.122,0.0],[44.436,26.124,0.0],[44.439,26.125,0.0],[44.442,26.148,0.0],[44.442,26.14,0.0],[44.431,26.108,0.0],[44.444,26.1,0.0],[44.448,26.119,0.0],[44.441,26.103,0.0],[44.447,26.119,0.0],[44.448,26.118,0.0],[44.444,26.091,0.0],[44.441,26.168,0.0],[44.439,26.143,0.0],[44.441,26.11,0.0],[44.439,26.109,0.0],[44.447,26.106,0.0],[44.436,26.115,0.0],[44.445,26.026,0.0],[44.428,26.118,0.0],[44.43,26.115,0.0],[44.425,26.1,0.0],[44.456,26.058,0.0],[44.442,26.106,0.0],[44.442,26.105,0.0],[44.416,26.13,0.0],[44.406,26.09,0.0],[44.438,26.099,0.0],[44.444,26.007,0.0],[44.444,26.07,0.0],[44.442,26.066,0.0],[44.492,26.081,0.0],[44.492,26.082,0.0],[44.492,26.084,0.0],[44.496,26.076,0.0],[44.418,26.116,0.0],[44.484,26.04,0.0],[44.434,26.097,0.0],[44.451,26.106,0.0],[44.428,26.096,0.0],[44.392,26.079,0.0],[44.391,26.078,0.0],[44.388,26.075,0.0],[44.389,26.075,0.0],[44.391,26.073,0.0],[44.392,26.073,0.0],[44.389,26.084,0.0],[44.424,26.069,0.0],[44.424,26.078,0.0],[44.404,26.079,0.0],[44.404,26.085,0.0],[44.462,26.097,0.0],[44.462,26.096,0.0],[44.442,26.09,0.0],[44.434,26.16,0.0],[44.442,26.075,0.0],[44.444,26.075,0.0],[44.434,26.058,0.0],[44.421,26.143,0.0],[44.445,26.149,0.0],[44.407,26.087,0.0],[44.447,26.096,0.0],[44.45,26.096,0.0],[44.413,26.181,0.0],[44.424,26.18,0.0],[44.41,26.088,0.0],[44.441,26.075,0.0],[44.433,26.186,0.0],[44.436,26.094,0.0],[44.436,26.096,0.0],[44.448,26.146,0.0],[44.441,26.124,0.0],[44.445,26.134,0.0],[44.48,26.094,0.0],[44.416,26.106,0.0],[44.416,26.108,0.0],[44.416,26.109,0.0],[44.425,26.102,0.0],[44.422,26.106,0.0],[44.425,26.109,0.0],[44.424,26.109,0.0],[44.407,26.125,0.0],[44.407,26.124,0.0],[44.438,26.115,0.0],[44.441,26.118,0.0],[44.434,26.134,0.0],[44.434,26.106,0.0],[44.434,26.113,0.0],[44.434,26.13,0.0],[44.448,26.115,0.0],[44.45,26.115,0.0],[44.43,26.124,0.0],[44.439,26.091,0.0],[44.441,26.115,0.0],[44.445,26.087,0.0],[44.401,26.093,0.0],[44.4,26.079,0.0],[44.469,26.139,0.0],[44.444,26.102,0.0],[44.445,26.1,0.0],[44.444,26.112,0.0],[44.445,26.11,0.0],[44.445,26.112,0.0],[44.41,26.099,0.0],[44.421,26.094,0.0],[44.424,26.093,0.0],[44.436,26.112,0.0],[44.438,26.113,0.0],[44.469,26.143,0.0],[44.45,26.076,0.0],[44.427,26.115,0.0],[44.419,26.007,0.0],[44.484,26.09,0.0],[44.438,26.13,0.0],[44.445,26.084,0.0],[44.427,26.122,0.0],[44.391,26.106,0.0],[44.392,26.105,0.0],[44.392,26.106,0.0],[44.394,26.103,0.0],[44.395,26.115,0.0],[44.441,26.064,0.0],[44.427,26.113,0.0],[44.483,26.091,0.0],[44.394,26.097,0.0],[44.428,26.094,0.0],[44.49,26.067,0.0],[44.433,26.128,0.0],[44.424,26.073,0.0],[44.472,26.064,0.0],[44.43,26.162,0.0],[44.422,26.18,0.0],[44.425,26.124,0.0],[44.386,26.139,0.0],[44.438,26.136,0.0],[44.407,26.09,0.0],[44.41,26.093,0.0],[44.409,26.125,0.0],[44.425,26.128,0.0],[44.424,26.128,0.0],[44.483,26.119,0.0],[44.448,26.125,0.0],[44.445,26.139,0.0],[44.439,26.043,0.0],[44.441,26.044,0.0],[44.445,26.131,0.0],[44.444,26.13,0.0],[44.45,26.125,0.0],[44.38,26.09,0.0],[44.424,26.119,0.0],[44.427,26.023,0.0],[44.466,26.118,0.0],[44.419,26.102,0.0],[44.383,26.14,0.0],[44.392,26.025,0.0],[44.413,26.128,0.0],[44.391,26.102,0.0],[44.495,26.09,0.0],[44.395,26.1,0.0],[44.489,26.09,0.0],[44.415,26.103,0.0],[44.456,26.082,0.0],[44.433,25.994,0.0],[44.41,26.02,0.0],[44.392,26.102,0.0],[44.395,26.105,0.0],[44.441,26.099,0.0],[44.448,26.128,0.0],[44.425,26.097,0.0],[44.425,26.099,0.0],[44.41,26.13,0.0],[44.413,26.133,0.0],[44.454,26.121,0.0],[44.466,26.047,0.0],[44.454,26.109,0.0],[44.424,26.01,0.0],[44.456,26.18,0.0],[44.412,26.127,0.0],[44.41,26.004,0.0],[44.45,26.013,0.0],[44.448,26.015,0.0],[44.45,26.01,0.0],[44.459,26.081,0.0],[44.513,26.079,0.0],[44.48,26.112,0.0],[44.398,26.112,0.0],[44.4,26.113,0.0],[44.471,26.069,0.0],[44.471,26.072,0.0],[44.421,26.171,0.0],[44.495,26.088,0.0],[44.38,26.091,0.0],[44.493,26.016,0.0],[44.434,25.974,0.0],[44.43,26.099,0.0],[44.489,26.127,0.0],[44.514,26.07,0.0],[44.419,26.004,0.0],[44.419,26.003,0.0],[44.421,26.006,0.0],[44.389,26.205,0.0],[44.389,26.201,0.0],[44.377,26.099,0.0],[44.444,26.035,0.0],[44.427,26.0,0.0],[44.442,25.988,0.0],[44.38,26.082,0.0],[44.427,26.211,0.0],[44.469,26.171,0.0],[44.466,26.171,0.0],[44.395,26.102,0.0],[44.398,26.097,0.0],[44.422,26.091,0.0],[44.422,26.1,0.0],[44.424,26.094,0.0],[44.472,26.154,0.0],[44.419,26.1,0.0],[44.421,26.091,0.0],[44.418,26.102,0.0],[44.419,26.094,0.0],[44.425,26.094,0.0],[44.434,26.131,0.0],[44.492,26.0,0.0],[44.489,26.012,0.0],[44.477,26.037,0.0],[44.477,26.029,0.0],[44.421,26.082,0.0],[44.428,26.075,0.0],[44.493,26.096,0.0],[44.406,25.989,0.0],[44.406,25.991,0.0],[44.425,26.209,0.0],[44.364,26.04,0.0],[44.475,26.112,0.0],[44.436,26.195,0.0],[44.385,26.003,0.0],[44.416,26.073,0.0],[44.415,26.061,0.0],[44.409,26.099,0.0],[44.436,25.991,0.0],[44.438,25.994,0.0],[44.438,25.997,0.0],[44.434,25.991,0.0],[44.434,25.997,0.0],[44.433,25.997,0.0],[44.438,25.971,0.0],[44.433,25.974,0.0],[44.438,25.968,0.0],[44.445,26.029,0.0],[44.441,26.028,0.0],[44.532,26.067,0.0],[44.409,26.18,0.0],[44.454,26.082,0.0],[44.477,26.102,0.0],[44.472,26.106,0.0],[44.451,26.14,0.0],[44.448,26.079,0.0],[44.45,26.079,0.0],[44.391,26.087,0.0],[44.388,26.007,0.0],[44.377,26.128,0.0],[44.376,26.128,0.0],[44.365,26.149,0.0],[44.365,26.146,0.0],[44.466,26.079,0.0],[44.495,26.127,0.0],[44.349,26.085,0.0],[44.359,26.094,0.0],[44.361,26.091,0.0],[44.415,26.122,0.0],[44.368,26.119,0.0],[44.425,25.986,0.0],[44.382,26.152,0.0],[44.385,26.155,0.0],[44.526,26.035,0.0],[44.407,26.181,0.0],[44.469,26.093,0.0],[44.406,26.088,0.0],[44.444,26.09,0.0],[44.51,26.069,0.0],[44.508,26.069,0.0],[44.51,26.07,0.0],[44.395,26.038,0.0],[44.409,26.094,0.0],[44.413,26.087,0.0],[44.409,26.09,0.0],[44.406,25.994,0.0],[44.388,26.015,0.0],[44.383,26.006,0.0],[44.403,25.985,0.0],[44.403,25.988,0.0],[44.407,25.988,0.0],[44.407,25.989,0.0],[44.389,26.006,0.0],[44.391,26.004,0.0],[44.391,26.006,0.0],[44.474,26.07,0.0],[44.422,26.01,0.0],[44.415,26.078,0.0],[44.477,26.157,0.0],[44.367,26.04,0.0],[44.386,26.145,0.0],[44.379,26.146,0.0],[44.38,26.152,0.0],[44.386,26.143,0.0],[44.377,26.149,0.0],[44.38,26.146,0.0],[44.382,26.149,0.0],[44.379,26.155,0.0],[44.376,26.16,0.0],[44.379,26.162,0.0],[44.377,26.154,0.0],[44.382,26.162,0.0],[44.45,26.137,0.0],[44.523,26.031,0.0],[44.379,26.168,0.0],[44.493,26.13,0.0],[44.38,26.137,0.0],[44.409,26.093,0.0],[44.481,26.118,0.0],[44.424,26.186,0.0],[44.532,26.059,0.0],[44.371,26.043,0.0],[44.419,26.058,0.0],[44.425,26.061,0.0],[44.447,26.201,0.0],[44.43,26.012,0.0],[44.368,26.133,0.0],[44.445,26.04,0.0],[44.418,26.099,0.0],[44.499,26.07,0.0],[44.406,26.145,0.0],[44.43,26.14,0.0],[44.395,26.031,0.0],[44.447,25.986,0.0],[44.434,25.995,0.0],[44.493,26.124,0.0],[44.365,26.093,0.0],[44.492,26.116,0.0],[44.496,25.992,0.0],[44.409,26.001,0.0],[44.403,25.995,0.0],[44.407,26.001,0.0],[44.415,26.118,0.0],[44.418,26.081,0.0],[44.421,25.983,0.0],[44.409,25.988,0.0],[44.41,25.986,0.0],[44.392,26.003,0.0],[44.404,26.015,0.0],[44.394,26.006,0.0],[44.389,25.985,0.0],[44.368,26.146,0.0],[44.368,26.151,0.0],[44.367,26.151,0.0],[44.371,26.146,0.0],[44.374,26.149,0.0],[44.439,26.149,0.0],[44.382,26.172,0.0],[44.383,26.172,0.0],[44.403,26.177,0.0],[44.403,26.175,0.0],[44.38,26.14,0.0],[44.448,26.203,0.0],[44.448,26.201,0.0],[44.373,26.18,0.0],[44.374,26.157,0.0],[44.374,26.16,0.0],[44.383,26.159,0.0],[44.41,26.006,0.0],[44.38,26.175,0.0],[44.373,26.157,0.0],[44.45,25.986,0.0],[44.401,26.112,0.0],[44.379,26.145,0.0],[44.37,26.143,0.0],[44.377,26.142,0.0],[44.382,26.142,0.0],[44.382,26.151,0.0],[44.448,25.979,0.0],[44.453,25.982,0.0],[44.451,25.985,0.0],[44.416,26.19,0.0],[44.422,26.183,0.0],[44.37,26.097,0.0],[44.373,26.136,0.0],[44.371,26.13,0.0],[44.444,26.023,0.0],[44.445,26.019,0.0],[44.428,26.012,0.0],[44.424,25.992,0.0],[44.441,26.162,0.0],[44.373,26.174,0.0],[44.374,26.169,0.0],[44.373,26.171,0.0],[44.46,25.986,0.0],[44.413,26.19,0.0],[44.416,26.192,0.0],[44.403,26.174,0.0],[44.404,26.168,0.0],[44.403,26.168,0.0],[44.404,26.163,0.0],[44.425,25.994,0.0],[44.391,26.067,0.0],[44.465,26.175,0.0],[44.463,26.169,0.0],[44.463,26.166,0.0],[44.471,26.172,0.0],[44.404,26.174,0.0],[44.386,26.166,0.0],[44.364,26.137,0.0],[44.368,26.134,0.0],[44.415,26.087,0.0],[44.365,26.116,0.0],[44.365,26.118,0.0],[44.364,26.128,0.0],[44.37,26.133,0.0],[44.37,26.139,0.0],[44.424,25.985,0.0],[44.489,26.13,0.0],[44.49,26.13,0.0],[44.391,26.059,0.0],[44.397,26.079,0.0],[44.513,26.02,0.0],[44.37,26.131,0.0],[44.439,26.049,0.0],[44.453,25.992,0.0],[44.451,26.013,0.0],[44.454,25.991,0.0],[44.457,25.994,0.0],[44.448,26.006,0.0],[44.45,26.003,0.0],[44.45,25.985,0.0],[44.379,26.148,0.0],[44.453,26.006,0.0],[44.427,26.019,0.0],[44.394,26.081,0.0],[44.481,25.973,0.0],[44.427,26.013,0.0],[44.501,26.07,0.0],[44.522,26.013,0.0],[44.487,26.062,0.0],[44.38,26.192,0.0],[44.349,26.087,0.0],[44.43,26.006,0.0],[44.448,25.976,0.0],[44.451,25.979,0.0],[44.453,25.98,0.0],[44.514,26.01,0.0],[44.454,25.977,0.0],[44.459,25.97,0.0],[44.407,26.088,0.0],[44.463,25.977,0.0],[44.459,25.971,0.0],[44.462,25.973,0.0],[44.46,25.979,0.0],[44.46,25.98,0.0],[44.46,25.982,0.0],[44.459,25.98,0.0],[44.462,25.98,0.0],[44.46,25.977,0.0],[44.46,25.976,0.0],[44.46,25.974,0.0],[44.428,26.022,0.0],[44.428,26.026,0.0],[44.407,26.013,0.0],[44.409,26.017,0.0],[44.487,26.064,0.0],[44.386,26.026,0.0],[44.451,26.073,0.0],[44.401,26.202,0.0],[44.391,26.058,0.0],[44.371,26.159,0.0],[44.385,26.148,0.0],[44.389,26.043,0.0],[44.448,25.977,0.0],[44.368,26.112,0.0],[44.368,26.11,0.0],[44.416,26.003,0.0],[44.492,26.119,0.0],[44.504,26.023,0.0],[44.431,26.102,0.0],[44.431,26.103,0.0],[44.43,26.102,0.0],[44.43,26.106,0.0],[44.46,25.973,0.0],[44.425,26.066,0.0],[44.457,26.193,0.0],[44.454,26.199,0.0],[44.514,26.019,0.0],[44.513,26.106,0.0],[44.356,26.221,0.0],[44.465,25.979,0.0],[44.444,26.02,0.0],[44.492,26.143,0.0],[44.474,26.148,0.0],[44.495,26.142,0.0],[44.492,26.145,0.0],[44.394,26.062,0.0],[44.368,26.124,0.0],[44.444,25.979,0.0],[44.444,25.983,0.0],[44.474,26.174,0.0],[44.462,26.169,0.0],[44.401,26.205,0.0],[44.478,26.108,0.0],[44.469,26.178,0.0],[44.471,26.178,0.0],[44.421,26.202,0.0],[44.418,26.198,0.0],[44.419,26.201,0.0],[44.415,26.195,0.0],[44.412,26.195,0.0],[44.38,26.184,0.0],[44.431,26.037,0.0],[44.442,25.977,0.0],[44.403,26.18,0.0],[44.403,26.178,0.0],[44.466,26.145,0.0],[44.379,26.174,0.0],[44.531,26.043,0.0],[44.486,26.069,0.0],[44.484,26.062,0.0],[44.445,25.976,0.0],[44.412,26.196,0.0],[44.379,26.19,0.0],[44.427,25.992,0.0],[44.409,26.023,0.0],[44.364,26.154,0.0],[44.37,26.16,0.0],[44.359,26.136,0.0],[44.495,26.121,0.0],[44.495,26.124,0.0],[44.495,26.125,0.0],[44.478,26.121,0.0],[44.424,26.066,0.0],[44.511,26.076,0.0],[44.403,25.982,0.0],[44.394,26.079,0.0],[44.38,26.172,0.0],[44.379,26.195,0.0],[44.451,26.085,0.0],[44.368,26.178,0.0],[44.361,26.154,0.0],[44.465,26.026,0.0],[44.466,26.052,0.0],[44.525,25.953,0.0],[44.353,26.143,0.0],[44.425,26.006,0.0],[44.403,26.122,0.0],[44.343,26.105,0.0],[44.45,26.199,0.0],[44.451,26.199,0.0],[44.38,26.016,0.0],[44.428,26.003,0.0],[44.37,26.102,0.0],[44.404,25.979,0.0],[44.407,25.971,0.0],[44.445,26.022,0.0],[44.442,26.007,0.0],[44.46,25.971,0.0],[44.511,26.075,0.0],[44.438,25.982,0.0],[44.355,26.211,0.0],[44.392,26.05,0.0],[44.531,26.047,0.0],[44.406,26.049,0.0],[44.415,26.052,0.0],[44.424,26.198,0.0],[44.483,26.166,0.0],[44.385,26.062,0.0],[44.439,25.968,0.0],[44.481,26.058,0.0],[44.481,26.059,0.0],[44.478,26.122,0.0],[44.342,26.108,0.0],[44.389,26.052,0.0],[44.37,26.18,0.0],[44.451,26.202,0.0],[44.438,26.196,0.0],[44.454,26.118,0.0],[44.454,26.134,0.0],[44.528,25.959,0.0],[44.41,26.029,0.0],[44.498,26.004,0.0],[44.505,26.006,0.0],[44.383,26.026,0.0],[44.528,26.037,0.0],[44.462,26.189,0.0],[44.495,26.218,0.0],[44.496,26.215,0.0],[44.496,26.217,0.0],[44.498,26.212,0.0],[44.465,26.183,0.0],[44.454,26.198,0.0],[44.453,26.199,0.0],[44.465,26.029,0.0],[44.383,26.028,0.0],[44.468,25.966,0.0],[44.466,25.971,0.0],[44.364,26.139,0.0],[44.397,26.07,0.0],[44.448,26.14,0.0],[44.457,26.09,0.0],[44.434,26.142,0.0],[44.433,26.142,0.0],[44.448,26.127,0.0],[44.415,26.023,0.0],[44.413,26.023,0.0],[44.459,26.109,0.0],[44.424,26.029,0.0],[44.424,26.026,0.0],[44.468,26.106,0.0],[44.439,26.052,0.0],[44.436,26.047,0.0],[44.454,26.11,0.0],[44.454,26.112,0.0],[44.486,26.1,0.0],[44.483,26.1,0.0],[44.465,26.128,0.0],[44.483,26.094,0.0],[44.481,26.099,0.0],[44.48,26.096,0.0],[44.481,26.1,0.0],[44.457,26.122,0.0],[44.453,26.118,0.0],[44.453,26.116,0.0],[44.453,26.108,0.0],[44.457,26.113,0.0],[44.425,26.14,0.0],[44.425,26.142,0.0],[44.428,26.142,0.0],[44.444,26.163,0.0],[44.465,26.116,0.0],[44.453,26.106,0.0],[44.453,26.112,0.0],[44.453,26.113,0.0],[44.451,26.118,0.0],[44.428,26.154,0.0],[44.428,26.152,0.0],[44.43,26.152,0.0],[44.433,26.152,0.0],[44.431,26.143,0.0],[44.43,26.157,0.0],[44.472,26.085,0.0],[44.481,26.097,0.0],[44.427,26.052,0.0],[44.425,26.053,0.0],[44.422,26.043,0.0],[44.43,26.113,0.0],[44.474,26.058,0.0],[44.428,26.055,0.0],[44.428,26.056,0.0],[44.463,26.096,0.0],[44.453,26.041,0.0],[44.413,26.029,0.0],[44.416,26.025,0.0],[44.421,26.023,0.0],[44.422,26.023,0.0],[44.422,26.028,0.0],[44.424,26.025,0.0],[44.424,26.043,0.0],[44.427,26.047,0.0],[44.392,26.121,0.0],[44.468,26.142,0.0],[44.463,26.145,0.0],[44.466,26.151,0.0],[44.454,26.143,0.0],[44.454,26.146,0.0],[44.457,26.139,0.0],[44.457,26.131,0.0],[44.447,26.133,0.0],[44.447,26.134,0.0],[44.447,26.137,0.0],[44.444,26.149,0.0],[44.444,26.165,0.0],[44.441,26.177,0.0],[44.463,26.1,0.0],[44.498,26.072,0.0],[44.466,26.088,0.0],[44.466,26.103,0.0],[44.439,26.084,0.0],[44.438,26.084,0.0],[44.436,26.085,0.0],[44.441,26.085,0.0],[44.439,26.081,0.0],[44.439,26.082,0.0],[44.441,26.082,0.0],[44.441,26.078,0.0],[44.434,26.084,0.0],[44.466,26.105,0.0],[44.468,26.109,0.0],[44.465,26.102,0.0],[44.463,26.103,0.0],[44.463,26.106,0.0],[44.478,26.09,0.0],[44.451,26.046,0.0],[44.484,26.119,0.0],[44.484,26.1,0.0],[44.424,26.133,0.0],[44.422,26.134,0.0],[44.483,26.05,0.0],[44.483,26.049,0.0],[44.484,26.055,0.0],[44.481,26.049,0.0],[44.418,26.157,0.0],[44.472,26.076,0.0],[44.442,26.139,0.0],[44.444,26.136,0.0],[44.424,26.171,0.0],[44.425,26.168,0.0],[44.421,26.165,0.0],[44.425,26.171,0.0],[44.421,26.168,0.0],[44.425,26.172,0.0],[44.453,26.09,0.0],[44.483,26.043,0.0],[44.483,26.041,0.0],[44.425,26.013,0.0],[44.483,26.099,0.0],[44.419,26.096,0.0],[44.383,26.119,0.0],[44.436,26.169,0.0],[44.418,26.171,0.0],[44.413,26.157,0.0],[44.421,26.136,0.0],[44.441,26.052,0.0],[44.428,26.163,0.0],[44.413,26.174,0.0],[44.409,26.177,0.0],[44.43,26.139,0.0],[44.418,26.172,0.0],[44.478,26.093,0.0],[44.403,26.053,0.0],[44.424,26.059,0.0],[44.4,26.088,0.0],[44.41,26.145,0.0],[44.481,26.119,0.0],[44.454,26.097,0.0],[44.43,26.118,0.0],[44.418,26.087,0.0],[44.415,26.169,0.0],[44.41,26.181,0.0],[44.447,26.142,0.0],[44.453,26.091,0.0],[44.453,26.093,0.0],[44.431,26.137,0.0],[44.436,26.14,0.0],[44.419,26.13,0.0],[44.425,26.133,0.0],[44.444,26.088,0.0],[44.422,26.103,0.0],[44.422,26.081,0.0],[44.433,26.106,0.0],[44.439,26.118,0.0],[44.439,26.121,0.0],[44.445,26.091,0.0],[44.447,26.094,0.0],[44.434,26.1,0.0],[44.477,26.151,0.0],[44.45,26.105,0.0],[44.448,26.093,0.0],[44.419,26.106,0.0],[44.424,26.106,0.0],[44.425,26.106,0.0],[44.421,26.105,0.0],[44.388,26.093,0.0],[44.383,26.088,0.0],[44.394,26.116,0.0],[44.394,26.113,0.0],[44.391,26.119,0.0],[44.418,26.163,0.0],[44.472,26.134,0.0],[44.41,26.017,0.0],[44.421,26.177,0.0],[44.431,26.106,0.0],[44.427,26.108,0.0],[44.436,26.11,0.0],[44.436,26.113,0.0],[44.439,26.131,0.0],[44.415,26.07,0.0],[44.427,26.127,0.0],[44.428,26.125,0.0],[44.472,26.056,0.0],[44.444,26.013,0.0],[44.46,26.04,0.0],[44.425,26.127,0.0],[44.425,26.122,0.0],[44.427,26.119,0.0],[44.431,26.124,0.0],[44.43,26.112,0.0],[44.431,26.133,0.0],[44.445,26.122,0.0],[44.444,26.121,0.0],[44.447,26.115,0.0],[44.439,26.113,0.0],[44.439,26.112,0.0],[44.439,26.106,0.0],[44.421,26.119,0.0],[44.48,26.088,0.0],[44.441,26.159,0.0],[44.428,26.212,0.0],[44.421,26.09,0.0],[44.386,26.088,0.0],[44.397,26.118,0.0],[44.398,26.099,0.0],[44.401,26.1,0.0],[44.388,26.113,0.0],[44.391,26.112,0.0],[44.389,26.115,0.0],[44.389,26.112,0.0],[44.389,26.11,0.0],[44.391,26.116,0.0],[44.391,26.11,0.0],[44.385,26.106,0.0],[44.383,26.103,0.0],[44.388,26.099,0.0],[44.382,26.094,0.0],[44.386,26.097,0.0],[44.383,26.094,0.0],[44.385,26.096,0.0],[44.453,26.103,0.0],[44.454,26.1,0.0],[44.38,26.102,0.0],[44.382,26.109,0.0],[44.379,26.109,0.0],[44.38,26.109,0.0],[44.377,26.115,0.0],[44.385,26.112,0.0],[44.385,26.113,0.0],[44.377,26.116,0.0],[44.377,26.113,0.0],[44.382,26.113,0.0],[44.382,26.11,0.0],[44.377,26.112,0.0],[44.376,26.116,0.0],[44.379,26.127,0.0],[44.386,26.119,0.0],[44.38,26.136,0.0],[44.388,26.136,0.0],[44.484,26.088,0.0],[44.486,26.088,0.0],[44.486,26.097,0.0],[44.486,26.093,0.0],[44.445,26.166,0.0],[44.441,26.155,0.0],[44.438,26.155,0.0],[44.471,26.041,0.0],[44.544,25.988,0.0],[44.457,26.056,0.0],[44.472,26.031,0.0],[44.477,26.009,0.0],[44.477,26.175,0.0],[44.48,26.178,0.0],[44.477,26.177,0.0],[44.48,26.18,0.0],[44.471,26.04,0.0],[44.46,26.055,0.0],[44.469,26.034,0.0],[44.472,26.038,0.0],[44.499,26.022,0.0],[44.499,26.02,0.0],[44.489,26.02,0.0],[44.441,26.056,0.0],[44.442,26.059,0.0],[44.484,26.034,0.0],[44.484,26.053,0.0],[44.484,26.032,0.0],[44.444,26.151,0.0],[44.447,26.078,0.0],[44.472,26.02,0.0],[44.472,26.026,0.0],[44.427,26.11,0.0],[44.448,26.094,0.0],[44.421,26.061,0.0],[44.418,26.013,0.0],[44.409,26.148,0.0],[44.45,26.09,0.0],[44.427,26.152,0.0],[44.495,26.134,0.0],[44.427,26.041,0.0],[44.46,26.106,0.0],[44.46,26.108,0.0],[44.46,26.105,0.0],[44.441,26.01,0.0],[44.441,26.012,0.0],[44.438,26.01,0.0],[44.442,26.01,0.0],[44.419,26.04,0.0],[44.418,26.037,0.0],[44.421,26.044,0.0],[44.454,26.046,0.0],[44.457,26.043,0.0],[44.459,26.041,0.0],[44.46,26.038,0.0],[44.462,26.041,0.0],[44.463,26.041,0.0],[44.462,26.043,0.0],[44.457,26.052,0.0],[44.46,26.043,0.0],[44.419,26.113,0.0],[44.422,26.121,0.0],[44.419,26.124,0.0],[44.416,26.121,0.0],[44.415,26.128,0.0],[44.456,26.044,0.0],[44.418,26.131,0.0],[44.412,26.066,0.0],[44.413,26.061,0.0],[44.412,26.067,0.0],[44.406,26.073,0.0],[44.41,26.078,0.0],[44.413,26.081,0.0],[44.404,26.072,0.0],[44.403,26.073,0.0],[44.401,26.052,0.0],[44.416,26.07,0.0],[44.397,26.069,0.0],[44.392,26.069,0.0],[44.431,26.097,0.0],[44.4,26.053,0.0],[44.415,26.062,0.0],[44.401,26.056,0.0],[44.418,26.059,0.0],[44.434,26.025,0.0],[44.436,26.04,0.0],[44.436,26.041,0.0],[44.438,26.041,0.0],[44.438,26.04,0.0],[44.438,26.043,0.0],[44.436,26.043,0.0],[44.434,26.044,0.0],[44.434,26.043,0.0],[44.436,26.035,0.0],[44.444,26.171,0.0],[44.438,26.171,0.0],[44.433,26.025,0.0],[44.43,26.022,0.0],[44.43,26.007,0.0],[44.444,26.029,0.0],[44.442,26.035,0.0],[44.422,26.159,0.0],[44.457,26.055,0.0],[44.453,26.043,0.0],[44.454,26.038,0.0],[44.453,26.053,0.0],[44.454,26.055,0.0],[44.453,26.055,0.0],[44.445,26.055,0.0],[44.447,26.058,0.0],[44.447,26.059,0.0],[44.447,26.055,0.0],[44.444,26.058,0.0],[44.433,26.001,0.0],[44.433,26.0,0.0],[44.431,26.0,0.0],[44.428,26.004,0.0],[44.415,26.046,0.0],[44.422,26.022,0.0],[44.419,26.02,0.0],[44.421,26.02,0.0],[44.425,26.022,0.0],[44.43,26.174,0.0],[44.427,26.139,0.0],[44.431,26.121,0.0],[44.43,26.13,0.0],[44.416,26.015,0.0],[44.413,26.017,0.0],[44.415,26.015,0.0],[44.413,26.016,0.0],[44.422,26.031,0.0],[44.422,26.032,0.0],[44.425,26.026,0.0],[44.427,26.046,0.0],[44.422,26.035,0.0],[44.421,26.047,0.0],[44.419,26.049,0.0],[44.421,26.049,0.0],[44.422,26.046,0.0],[44.428,26.058,0.0],[44.427,26.058,0.0],[44.457,26.066,0.0],[44.456,26.066,0.0],[44.456,26.064,0.0],[44.459,26.07,0.0],[44.457,26.069,0.0],[44.456,26.076,0.0],[44.456,26.081,0.0],[44.453,26.082,0.0],[44.451,26.082,0.0],[44.451,26.079,0.0],[44.45,26.073,0.0],[44.448,26.075,0.0],[44.448,26.073,0.0],[44.447,26.076,0.0],[44.442,26.078,0.0],[44.445,26.075,0.0],[44.454,26.066,0.0],[44.468,26.059,0.0],[44.466,26.056,0.0],[44.469,26.059,0.0],[44.465,26.055,0.0],[44.465,26.056,0.0],[44.463,26.056,0.0],[44.466,26.059,0.0],[44.466,26.053,0.0],[44.471,26.052,0.0],[44.472,26.052,0.0],[44.471,26.056,0.0],[44.468,26.064,0.0],[44.466,26.066,0.0],[44.466,26.07,0.0],[44.465,26.075,0.0],[44.475,26.052,0.0],[44.442,26.004,0.0],[44.439,26.009,0.0],[44.385,26.139,0.0],[44.462,26.099,0.0],[44.45,26.055,0.0],[44.45,26.053,0.0],[44.45,26.049,0.0],[44.459,26.079,0.0],[44.457,26.081,0.0],[44.431,26.069,0.0],[44.471,26.115,0.0],[44.472,26.112,0.0],[44.468,26.116,0.0],[44.472,26.115,0.0],[44.469,26.113,0.0],[44.472,26.113,0.0],[44.468,26.118,0.0],[44.444,26.183,0.0],[44.448,26.1,0.0],[44.448,26.109,0.0],[44.469,26.152,0.0],[44.447,26.087,0.0],[44.448,26.103,0.0],[44.447,26.103,0.0],[44.447,26.102,0.0],[44.447,26.11,0.0],[44.441,26.094,0.0],[44.45,26.1,0.0],[44.445,26.103,0.0],[44.441,26.096,0.0],[44.48,26.047,0.0],[44.483,26.047,0.0],[44.434,26.125,0.0],[44.441,26.127,0.0],[44.439,26.127,0.0],[44.434,26.127,0.0],[44.442,26.143,0.0],[44.441,26.149,0.0],[44.447,26.116,0.0],[44.442,26.102,0.0],[44.444,26.099,0.0],[44.463,26.076,0.0],[44.463,26.078,0.0],[44.468,26.076,0.0],[44.465,26.078,0.0],[44.442,26.146,0.0],[44.438,26.14,0.0],[44.439,26.14,0.0],[44.439,26.13,0.0],[44.436,26.142,0.0],[44.438,26.127,0.0],[44.433,26.122,0.0],[44.436,26.119,0.0],[44.445,26.108,0.0],[44.445,26.025,0.0],[44.441,26.109,0.0],[44.442,26.028,0.0],[44.444,26.026,0.0],[44.444,26.025,0.0],[44.431,26.116,0.0],[44.434,26.116,0.0],[44.428,26.116,0.0],[44.425,26.131,0.0],[44.438,26.118,0.0],[44.439,26.108,0.0],[44.444,26.028,0.0],[44.442,26.029,0.0],[44.442,26.026,0.0],[44.436,26.122,0.0],[44.438,26.121,0.0],[44.434,26.122,0.0],[44.436,26.121,0.0],[44.441,26.105,0.0],[44.442,26.108,0.0],[44.441,26.106,0.0],[44.442,26.11,0.0],[44.442,26.109,0.0],[44.444,26.109,0.0],[44.445,26.028,0.0],[44.465,26.091,0.0],[44.465,26.094,0.0],[44.463,26.093,0.0],[44.466,26.093,0.0],[44.466,26.091,0.0],[44.46,26.088,0.0],[44.459,26.093,0.0],[44.46,26.119,0.0],[44.456,26.097,0.0],[44.444,26.004,0.0],[44.493,26.082,0.0],[44.49,26.084,0.0],[44.49,26.082,0.0],[44.49,26.085,0.0],[44.492,26.085,0.0],[44.493,26.085,0.0],[44.495,26.078,0.0],[44.489,26.037,0.0],[44.487,26.04,0.0],[44.487,26.037,0.0],[44.483,26.038,0.0],[44.389,26.094,0.0],[44.451,26.108,0.0],[44.394,26.078,0.0],[44.392,26.078,0.0],[44.462,26.113,0.0],[44.46,26.118,0.0],[44.388,26.087,0.0],[44.448,26.052,0.0],[44.438,26.069,0.0],[44.436,26.069,0.0],[44.43,26.069,0.0],[44.424,26.079,0.0],[44.424,26.081,0.0],[44.422,26.084,0.0],[44.422,26.076,0.0],[44.425,26.206,0.0],[44.403,26.081,0.0],[44.401,26.079,0.0],[44.403,26.082,0.0],[44.421,26.066,0.0],[44.465,26.1,0.0],[44.444,26.11,0.0],[44.441,26.088,0.0],[44.427,26.112,0.0],[44.433,26.084,0.0],[44.43,26.081,0.0],[44.431,26.079,0.0],[44.456,26.136,0.0],[44.457,26.134,0.0],[44.459,26.134,0.0],[44.441,26.072,0.0],[44.419,26.163,0.0],[44.409,26.087,0.0],[44.451,26.09,0.0],[44.451,26.096,0.0],[44.451,26.093,0.0],[44.448,26.096,0.0],[44.45,26.099,0.0],[44.451,26.097,0.0],[44.418,26.183,0.0],[44.434,26.103,0.0],[44.433,26.078,0.0],[44.433,26.079,0.0],[44.434,26.076,0.0],[44.403,26.09,0.0],[44.474,26.096,0.0],[44.43,26.177,0.0],[44.428,26.187,0.0],[44.433,26.112,0.0],[44.438,26.096,0.0],[44.468,26.055,0.0],[44.447,26.145,0.0],[44.448,26.133,0.0],[44.444,26.125,0.0],[44.441,26.121,0.0],[44.442,26.127,0.0],[44.444,26.122,0.0],[44.486,26.094,0.0],[44.484,26.094,0.0],[44.484,26.097,0.0],[44.481,26.094,0.0],[44.478,26.094,0.0],[44.48,26.1,0.0],[44.412,26.053,0.0],[44.409,26.052,0.0],[44.413,26.113,0.0],[44.41,26.118,0.0],[44.422,26.105,0.0],[44.425,26.105,0.0],[44.425,26.108,0.0],[44.406,26.121,0.0],[44.403,26.121,0.0],[44.4,26.119,0.0],[44.444,26.18,0.0],[44.439,26.119,0.0],[44.434,26.118,0.0],[44.441,26.113,0.0],[44.438,26.116,0.0],[44.431,26.113,0.0],[44.442,26.128,0.0],[44.434,26.128,0.0],[44.436,26.13,0.0],[44.441,26.128,0.0],[44.434,26.112,0.0],[44.434,26.133,0.0],[44.433,26.133,0.0],[44.45,26.106,0.0],[44.447,26.109,0.0],[44.45,26.116,0.0],[44.453,26.105,0.0],[44.451,26.103,0.0],[44.451,26.105,0.0],[44.445,26.109,0.0],[44.448,26.105,0.0],[44.451,26.1,0.0],[44.45,26.118,0.0],[44.451,26.102,0.0],[44.447,26.112,0.0],[44.45,26.109,0.0],[44.448,26.116,0.0],[44.388,26.078,0.0],[44.373,26.094,0.0],[44.376,26.093,0.0],[44.374,26.094,0.0],[44.374,26.096,0.0],[44.428,26.124,0.0],[44.431,26.122,0.0],[44.447,26.088,0.0],[44.445,26.115,0.0],[44.445,26.113,0.0],[44.403,26.093,0.0],[44.404,26.097,0.0],[44.434,26.124,0.0],[44.465,26.137,0.0],[44.444,26.103,0.0],[44.451,26.099,0.0],[44.445,26.102,0.0],[44.444,26.108,0.0],[44.448,26.102,0.0],[44.448,26.085,0.0],[44.422,26.094,0.0],[44.419,26.093,0.0],[44.441,26.122,0.0],[44.442,26.121,0.0],[44.438,26.11,0.0],[44.441,26.112,0.0],[44.465,26.148,0.0],[44.444,26.113,0.0],[44.457,26.1,0.0],[44.45,26.075,0.0],[44.412,26.058,0.0],[44.428,26.109,0.0],[44.421,26.106,0.0],[44.433,26.076,0.0],[44.431,26.078,0.0],[44.431,26.076,0.0],[44.428,26.113,0.0],[44.457,26.096,0.0],[44.46,26.096,0.0],[44.436,26.133,0.0],[44.439,26.128,0.0],[44.438,26.131,0.0],[44.441,26.131,0.0],[44.436,26.131,0.0],[44.434,26.136,0.0],[44.436,26.134,0.0],[44.444,26.084,0.0],[44.442,26.085,0.0],[44.444,26.087,0.0],[44.442,26.082,0.0],[44.444,26.085,0.0],[44.445,26.088,0.0],[44.442,26.087,0.0],[44.4,26.058,0.0],[44.4,26.056,0.0],[44.394,26.105,0.0],[44.394,26.106,0.0],[44.397,26.105,0.0],[44.397,26.106,0.0],[44.389,26.106,0.0],[44.395,26.103,0.0],[44.436,26.116,0.0],[44.433,26.109,0.0],[44.436,26.127,0.0],[44.438,26.175,0.0],[44.447,26.157,0.0],[44.447,26.154,0.0],[44.468,26.152,0.0],[44.483,25.976,0.0],[44.434,26.151,0.0],[44.516,26.091,0.0],[44.386,26.01,0.0],[44.478,26.186,0.0],[44.428,26.112,0.0],[44.456,26.142,0.0],[44.425,26.163,0.0],[44.49,26.066,0.0],[44.422,26.112,0.0],[44.424,26.112,0.0],[44.428,26.1,0.0],[44.474,26.061,0.0],[44.472,26.059,0.0],[44.474,26.062,0.0],[44.459,26.136,0.0],[44.416,26.18,0.0],[44.422,26.075,0.0],[44.425,26.125,0.0],[44.38,26.112,0.0],[44.475,26.064,0.0],[44.477,26.062,0.0],[44.442,26.122,0.0],[44.444,26.124,0.0],[44.49,26.087,0.0],[44.41,26.127,0.0],[44.421,26.079,0.0],[44.409,26.131,0.0],[44.422,26.078,0.0],[44.41,26.131,0.0],[44.46,26.067,0.0],[44.463,26.069,0.0],[44.46,26.066,0.0],[44.462,26.066,0.0],[44.463,26.067,0.0],[44.483,26.118,0.0],[44.448,26.088,0.0],[44.451,26.127,0.0],[44.45,26.13,0.0],[44.395,26.093,0.0],[44.43,26.096,0.0],[44.466,26.09,0.0],[44.468,26.09,0.0],[44.469,26.09,0.0],[44.469,26.091,0.0],[44.4,26.115,0.0],[44.376,26.137,0.0],[44.398,26.116,0.0],[44.373,26.142,0.0],[44.376,26.139,0.0],[44.427,26.025,0.0],[44.431,26.14,0.0],[44.441,26.059,0.0],[44.394,26.124,0.0],[44.392,26.022,0.0],[44.465,26.087,0.0],[44.468,26.094,0.0],[44.445,26.035,0.0],[44.389,26.103,0.0],[44.389,26.102,0.0],[44.391,26.1,0.0],[44.4,26.118,0.0],[44.409,26.097,0.0],[44.529,26.192,0.0],[44.483,26.09,0.0],[44.486,26.091,0.0],[44.489,26.125,0.0],[44.492,26.124,0.0],[44.434,26.003,0.0],[44.487,26.091,0.0],[44.477,26.096,0.0],[44.386,26.112,0.0],[44.418,26.088,0.0],[44.41,26.122,0.0],[44.424,26.127,0.0],[44.425,26.134,0.0],[44.445,26.118,0.0],[44.422,26.053,0.0],[44.424,26.05,0.0],[44.442,25.959,0.0],[44.444,25.956,0.0],[44.444,25.957,0.0],[44.395,26.108,0.0],[44.386,26.115,0.0],[44.404,26.094,0.0],[44.406,26.096,0.0],[44.412,26.093,0.0],[44.404,26.091,0.0],[44.421,26.127,0.0],[44.448,26.145,0.0],[44.445,26.14,0.0],[44.434,26.137,0.0],[44.422,26.102,0.0],[44.409,26.13,0.0],[44.407,26.131,0.0],[44.409,26.134,0.0],[44.388,26.097,0.0],[44.388,26.094,0.0],[44.4,26.11,0.0],[44.398,26.1,0.0],[44.456,26.113,0.0],[44.465,26.139,0.0],[44.401,26.09,0.0],[44.401,26.091,0.0],[44.4,26.09,0.0],[44.469,26.046,0.0],[44.468,26.047,0.0],[44.454,26.059,0.0],[44.451,26.062,0.0],[44.463,26.082,0.0],[44.454,26.108,0.0],[44.492,26.192,0.0],[44.431,26.059,0.0],[44.397,26.102,0.0]];
const DENSITY_DAY=[[44.43,26.052,1.0],[44.427,26.148,0.8],[44.478,26.112,0.6],[44.425,26.149,0.6],[44.481,26.113,0.6],[44.481,26.112,0.5],[44.43,26.19,0.5],[44.433,26.052,0.5],[44.428,26.053,0.5],[44.478,26.108,0.5],[44.442,26.152,0.5],[44.519,26.075,0.5],[44.431,26.05,0.5],[44.43,26.053,0.4],[44.484,26.112,0.4],[44.475,26.187,0.4],[44.434,26.052,0.4],[44.434,26.082,0.4],[44.442,26.149,0.4],[44.471,26.109,0.4],[44.421,26.148,0.4],[44.539,26.073,0.4],[44.436,26.081,0.4],[44.425,26.148,0.4],[44.394,26.121,0.4],[44.478,26.103,0.4],[44.421,26.146,0.4],[44.356,26.218,0.4],[44.492,25.976,0.4],[44.421,26.149,0.4],[44.525,26.026,0.4],[44.51,26.088,0.3],[44.434,26.053,0.3],[44.424,26.149,0.3],[44.433,26.05,0.3],[44.43,26.058,0.3],[44.422,26.148,0.3],[44.434,26.055,0.3],[44.442,26.154,0.3],[44.532,25.959,0.3],[44.431,26.052,0.3],[44.478,26.11,0.3],[44.472,26.108,0.3],[44.434,26.079,0.3],[44.424,26.146,0.3],[44.419,26.148,0.3],[44.447,26.097,0.3],[44.507,26.09,0.3],[44.397,26.124,0.3],[44.477,26.105,0.3],[44.529,26.075,0.3],[44.48,26.115,0.3],[44.431,26.049,0.3],[44.433,26.049,0.3],[44.427,26.146,0.3],[44.439,26.052,0.3],[44.395,26.122,0.3],[44.43,26.05,0.3],[44.508,26.091,0.3],[44.508,26.087,0.3],[44.441,26.155,0.3],[44.478,26.116,0.3],[44.394,26.122,0.3],[44.428,26.146,0.3],[44.478,26.113,0.3],[44.481,26.109,0.3],[44.433,26.056,0.3],[44.43,26.102,0.3],[44.477,26.115,0.3],[44.436,26.05,0.3],[44.424,26.154,0.3],[44.395,26.127,0.3],[44.481,26.103,0.2],[44.478,26.115,0.2],[44.447,26.152,0.2],[44.439,25.983,0.2],[44.422,26.149,0.2],[44.418,26.151,0.2],[44.48,26.109,0.2],[44.433,26.081,0.2],[44.436,26.082,0.2],[44.525,26.015,0.2],[44.481,26.11,0.2],[44.421,26.18,0.2],[44.434,26.1,0.2],[44.445,26.066,0.2],[44.448,26.096,0.2],[44.445,26.151,0.2],[44.397,26.119,0.2],[44.425,26.102,0.2],[44.431,26.056,0.2],[44.438,26.049,0.2],[44.427,26.149,0.2],[44.444,26.155,0.2],[44.442,26.157,0.2],[44.412,26.116,0.2],[44.419,26.149,0.2],[44.445,26.099,0.2],[44.364,26.131,0.2],[44.442,26.05,0.2],[44.43,26.1,0.2],[44.507,26.087,0.2],[44.428,26.052,0.2],[44.427,26.152,0.2],[44.433,26.053,0.2],[44.434,26.05,0.2],[44.511,26.206,0.2],[44.438,26.187,0.2],[44.441,26.053,0.2],[44.418,26.149,0.2],[44.41,26.116,0.2],[44.442,26.148,0.2],[44.445,26.097,0.2],[44.448,26.099,0.2],[44.48,26.1,0.2],[44.477,26.184,0.2],[44.43,26.055,0.2],[44.347,26.183,0.2],[44.346,26.181,0.2],[44.474,26.108,0.2],[44.441,26.047,0.2],[44.439,26.05,0.2],[44.425,26.151,0.2],[44.428,26.105,0.2],[44.438,26.082,0.2],[44.444,26.151,0.2],[44.41,26.115,0.2],[44.433,26.047,0.2],[44.447,26.096,0.2],[44.431,26.18,0.2],[44.48,26.105,0.2],[44.431,26.053,0.2],[44.427,26.1,0.2],[44.362,26.209,0.2],[44.472,26.11,0.2],[44.474,26.109,0.2],[44.439,26.049,0.2],[44.472,26.109,0.2],[44.431,26.103,0.2],[44.427,26.102,0.2],[44.475,26.108,0.2],[44.439,26.084,0.2],[44.441,26.152,0.2],[44.392,26.125,0.2],[44.433,26.178,0.2],[44.431,26.078,0.2],[44.445,26.154,0.2],[44.428,25.988,0.2],[44.43,26.04,0.2],[44.43,26.037,0.2],[44.447,26.099,0.2],[44.394,26.119,0.2],[44.395,26.119,0.2],[44.436,26.084,0.2],[44.427,26.035,0.2],[44.445,26.078,0.2],[44.478,26.105,0.2],[44.445,25.947,0.2],[44.43,26.038,0.2],[44.436,26.055,0.2],[44.428,26.032,0.2],[44.48,26.103,0.2],[44.513,26.205,0.2],[44.436,26.078,0.2],[44.438,26.076,0.2],[44.428,26.035,0.1],[44.425,26.037,0.1],[44.451,26.125,0.1],[44.425,26.093,0.1],[44.419,26.151,0.1],[44.441,26.052,0.1],[44.38,26.118,0.1],[44.471,26.043,0.1],[44.425,26.103,0.1],[44.428,26.106,0.1],[44.439,26.053,0.1],[44.504,26.09,0.1],[44.477,26.106,0.1],[44.48,26.106,0.1],[44.433,26.055,0.1],[44.427,26.19,0.1],[44.419,26.152,0.1],[44.444,26.049,0.1],[44.356,26.221,0.1],[44.355,26.211,0.1],[44.428,26.196,0.1],[44.496,26.217,0.1],[44.425,26.146,0.1],[44.427,26.183,0.1],[44.424,26.184,0.1],[44.412,26.109,0.1],[44.425,26.105,0.1],[44.451,26.087,0.1],[44.478,26.067,0.1],[44.394,26.124,0.1],[44.48,26.112,0.1],[44.428,26.049,0.1],[44.355,26.091,0.1],[44.425,26.186,0.1],[44.48,26.116,0.1],[44.434,26.046,0.1],[44.431,26.047,0.1],[44.447,26.007,0.1],[44.442,26.052,0.1],[44.477,26.108,0.1],[44.422,26.154,0.1],[44.421,26.151,0.1],[44.412,26.081,0.1],[44.438,25.98,0.1],[44.528,25.959,0.1],[44.529,26.038,0.1],[44.495,26.218,0.1],[44.498,26.212,0.1],[44.43,26.049,0.1],[44.436,26.056,0.1],[44.422,26.151,0.1],[44.51,26.093,0.1],[44.508,26.093,0.1],[44.505,26.091,0.1],[44.507,26.093,0.1],[44.51,26.09,0.1],[44.508,26.094,0.1],[44.507,26.091,0.1],[44.508,26.088,0.1],[44.441,26.076,0.1],[44.475,26.109,0.1],[44.477,26.112,0.1],[44.483,26.102,0.1],[44.428,26.149,0.1],[44.48,26.102,0.1],[44.433,26.1,0.1],[44.444,26.148,0.1],[44.469,26.108,0.1],[44.427,26.151,0.1],[44.48,26.113,0.1],[44.425,26.106,0.1],[44.472,26.113,0.1],[44.478,26.047,0.1],[44.412,26.118,0.1],[44.478,26.175,0.1],[44.478,26.181,0.1],[44.475,26.112,0.1],[44.43,26.031,0.1],[44.367,26.043,0.1],[44.475,26.11,0.1],[44.471,26.11,0.1],[44.522,26.013,0.1],[44.484,26.115,0.1],[44.397,26.125,0.1],[44.397,26.121,0.1],[44.397,26.122,0.1],[44.434,25.982,0.1],[44.438,25.985,0.1],[44.438,25.986,0.1],[44.465,26.127,0.1],[44.424,26.148,0.1],[44.428,26.151,0.1],[44.43,26.148,0.1],[44.431,26.148,0.1],[44.469,26.109,0.1],[44.439,26.133,0.1],[44.428,26.108,0.1],[44.439,26.157,0.1],[44.448,26.094,0.1],[44.424,26.159,0.1],[44.448,26.1,0.1],[44.475,26.162,0.1],[44.45,26.096,0.1],[44.441,26.154,0.1],[44.475,26.103,0.1],[44.471,26.105,0.1],[44.478,26.109,0.1],[44.514,26.01,0.1],[44.471,26.108,0.1],[44.428,26.103,0.1],[44.441,26.05,0.1],[44.427,26.105,0.1],[44.525,25.953,0.1],[44.505,26.006,0.1],[44.496,26.215,0.1],[44.474,26.106,0.1],[44.475,26.105,0.1],[44.427,26.103,0.1],[44.45,26.097,0.1],[44.492,26.093,0.1],[44.439,26.078,0.1],[44.48,26.11,0.1],[44.478,26.102,0.1],[44.394,26.118,0.1],[44.433,26.102,0.1],[44.439,26.155,0.1],[44.386,26.109,0.1],[44.438,26.102,0.1],[44.427,26.034,0.1],[44.438,25.983,0.1],[44.462,26.058,0.1],[44.442,26.094,0.1],[44.448,26.097,0.1],[44.4,26.044,0.1],[44.444,26.047,0.1],[44.492,26.192,0.1],[44.361,26.149,0.1],[44.481,26.115,0.1],[44.438,26.192,0.1],[44.43,26.032,0.1],[44.353,26.214,0.1],[44.424,26.19,0.1],[44.416,26.035,0.1],[44.374,26.22,0.1],[44.439,26.149,0.1],[44.478,26.136,0.1],[44.431,26.037,0.1],[44.477,26.113,0.1],[44.377,25.989,0.1],[44.419,26.127,0.1],[44.427,26.143,0.1],[44.419,26.146,0.1],[44.419,26.145,0.1],[44.43,26.152,0.1],[44.444,26.152,0.1],[44.434,26.085,0.1],[44.438,26.103,0.1],[44.447,26.1,0.1],[44.412,26.115,0.1],[44.474,26.031,0.1],[44.453,26.14,0.1],[44.404,26.064,0.1],[44.438,26.025,0.1],[44.441,25.983,0.1],[44.392,26.124,0.1],[44.442,26.146,0.1],[44.439,26.148,0.1],[44.394,26.125,0.1],[44.445,26.149,0.1],[44.409,26.202,0.1],[44.431,26.175,0.1],[44.421,26.19,0.1],[44.424,26.189,0.1],[44.412,26.112,0.1],[44.428,26.093,0.1],[44.529,26.192,0.1],[44.481,26.106,0.1],[44.481,26.105,0.1],[44.428,26.038,0.1],[44.442,26.049,0.1],[44.471,26.112,0.1],[44.428,26.031,0.1],[44.48,26.163,0.1],[44.492,26.017,0.1],[44.409,26.034,0.1],[44.37,26.178,0.1],[44.526,25.951,0.1],[44.525,25.95,0.1],[44.427,26.062,0.1],[44.51,26.208,0.1],[44.511,26.208,0.1],[44.438,25.982,0.1],[44.425,26.215,0.1],[44.495,26.22,0.1],[44.487,25.97,0.1],[44.436,26.072,0.1],[44.45,26.127,0.1],[44.447,26.13,0.1],[44.444,26.154,0.1],[44.438,26.084,0.1],[44.439,26.082,0.1],[44.441,26.078,0.1],[44.434,26.084,0.1],[44.412,26.165,0.1],[44.41,26.16,0.1],[44.441,26.055,0.1],[44.454,26.044,0.1],[44.459,26.046,0.1],[44.438,26.026,0.1],[44.433,26.084,0.1],[44.431,26.079,0.1],[44.433,26.078,0.1],[44.433,26.079,0.1],[44.43,26.178,0.1],[44.409,26.116,0.1],[44.439,26.099,0.1],[44.447,26.157,0.1],[44.448,26.154,0.1],[44.474,26.069,0.1],[44.444,26.05,0.1],[44.444,26.052,0.1],[44.395,26.121,0.1],[44.424,26.1,0.1],[44.439,26.096,0.1],[44.49,26.016,0.1],[44.436,25.979,0.1],[44.516,26.07,0.1],[44.442,26.151,0.1],[44.489,26.186,0.1],[44.434,25.983,0.1],[44.428,26.076,0.1],[44.469,26.112,0.1],[44.438,26.081,0.1],[44.502,26.214,0.1],[44.383,26.001,0.1],[44.505,26.206,0.1],[44.445,26.044,0.1],[44.469,26.106,0.1],[44.541,26.121,0.1],[44.35,26.19,0.1],[44.477,26.137,0.1],[44.498,26.0,0.1],[44.347,26.066,0.1],[44.433,26.099,0.1],[44.43,26.105,0.1],[44.441,26.049,0.1],[44.48,26.118,0.1],[44.445,26.155,0.1],[44.431,26.035,0.1],[44.508,26.211,0.1],[44.525,26.209,0.1],[44.428,26.102,0.1],[44.425,26.155,0.1],[44.424,26.152,0.1],[44.439,25.957,0.1],[44.45,26.094,0.1],[44.425,26.076,0.1],[44.438,26.047,0.1],[44.463,26.13,0.1],[44.481,26.099,0.1],[44.453,26.119,0.1],[44.418,26.148,0.1],[44.495,26.093,0.1],[44.392,26.121,0.1],[44.438,26.078,0.1],[44.434,26.081,0.1],[44.438,26.137,0.1],[44.48,26.108,0.1],[44.484,26.109,0.1],[44.427,26.169,0.1],[44.427,26.13,0.1],[44.421,26.103,0.1],[44.431,26.106,0.1],[44.445,26.127,0.1],[44.379,26.119,0.1],[44.438,26.019,0.1],[44.544,25.988,0.1],[44.478,26.174,0.1],[44.395,25.974,0.1],[44.459,26.047,0.1],[44.412,26.07,0.1],[44.439,26.025,0.1],[44.431,26.02,0.1],[44.431,26.016,0.1],[44.436,25.983,0.1],[44.422,26.02,0.1],[44.457,26.079,0.1],[44.436,26.099,0.1],[44.444,26.094,0.1],[44.401,26.143,0.1],[44.398,26.145,0.1],[44.394,26.093,0.1],[44.445,26.096,0.1],[44.413,26.113,0.1],[44.41,26.112,0.1],[44.409,26.115,0.1],[44.412,26.113,0.1],[44.51,26.084,0.1],[44.445,26.1,0.1],[44.477,26.18,0.1],[44.478,26.186,0.1],[44.433,26.034,0.1],[44.428,26.1,0.1],[44.472,26.067,0.1],[44.444,26.046,0.1],[44.438,25.977,0.1],[44.43,26.099,0.1],[44.433,26.075,0.1],[44.434,26.075,0.1],[44.427,26.099,0.1],[44.43,26.056,0.1],[44.49,26.118,0.1],[44.507,26.214,0.1],[44.495,26.199,0.1],[44.505,26.087,0.1],[44.444,26.022,0.1],[44.517,26.015,0.1],[44.489,25.971,0.1],[44.401,26.208,0.1],[44.386,25.985,0.1],[44.431,26.102,0.1],[44.43,26.103,0.1],[44.434,26.189,0.1],[44.406,26.149,0.1],[44.431,26.04,0.1],[44.529,26.177,0.1],[44.439,26.151,0.1],[44.475,26.113,0.1],[44.498,26.218,0.1],[44.486,25.979,0.1],[44.442,26.046,0.1],[44.433,26.085,0.1],[44.438,26.075,0.1],[44.438,26.152,0.1],[44.447,26.155,0.1],[44.407,26.115,0.1],[44.436,26.047,0.1],[44.451,26.122,0.1],[44.495,26.091,0.1],[44.439,26.013,0.1],[44.439,26.18,0.1],[44.48,26.099,0.1],[44.421,26.139,0.1],[44.416,26.157,0.1],[44.419,26.162,0.1],[44.441,26.134,0.1],[44.425,26.175,0.1],[44.412,26.168,0.1],[44.41,26.166,0.1],[44.478,26.106,0.1],[44.391,26.019,0.1],[44.419,26.105,0.1],[44.395,26.116,0.1],[44.415,26.159,0.1],[44.391,26.094,0.1],[44.456,26.043,0.1],[44.413,26.108,0.1],[44.389,26.093,0.1],[44.41,26.137,0.1],[44.397,26.112,0.1],[44.386,26.1,0.1],[44.386,26.121,0.1],[44.382,26.118,0.1],[44.38,26.128,0.1],[44.382,26.128,0.1],[44.388,26.133,0.1],[44.385,26.133,0.1],[44.499,26.029,0.1],[44.438,26.1,0.1],[44.427,26.038,0.1],[44.434,26.099,0.1],[44.431,26.01,0.1],[44.439,26.0,0.1],[44.454,26.049,0.1],[44.456,26.046,0.1],[44.457,26.044,0.1],[44.459,26.049,0.1],[44.418,26.128,0.1],[44.404,26.069,0.1],[44.41,26.069,0.1],[44.409,26.072,0.1],[44.436,26.026,0.1],[44.441,26.017,0.1],[44.433,26.023,0.1],[44.433,26.022,0.1],[44.431,26.019,0.1],[44.425,26.034,0.1],[44.459,26.069,0.1],[44.465,26.073,0.1],[44.444,26.1,0.1],[44.439,26.166,0.1],[44.4,26.146,0.1],[44.444,26.066,0.1],[44.444,26.069,0.1],[44.434,26.056,0.1],[44.45,26.099,0.1],[44.416,26.151,0.1],[44.433,26.18,0.1],[44.422,26.189,0.1],[44.373,26.118,0.1],[44.448,26.134,0.1],[44.424,26.105,0.1],[44.451,26.1,0.1],[44.468,26.139,0.1],[44.451,26.099,0.1],[44.475,26.181,0.1],[44.49,26.088,0.1],[44.511,26.091,0.1],[44.361,26.122,0.1],[44.362,26.127,0.1],[44.434,25.959,0.1],[44.425,26.099,0.1],[44.474,26.11,0.1],[44.373,26.116,0.1],[44.35,26.087,0.1],[44.344,26.085,0.1],[44.522,26.026,0.1],[44.504,26.215,0.1],[44.541,26.093,0.1],[44.418,26.072,0.1],[44.385,26.13,0.1],[44.48,26.159,0.1],[44.395,26.124,0.1],[44.433,26.181,0.1],[44.49,26.189,0.1],[44.508,26.217,0.1],[44.359,26.149,0.1],[44.395,26.152,0.1],[44.504,26.091,0.1],[44.415,26.09,0.1],[44.477,26.139,0.1],[44.519,26.017,0.1],[44.508,26.085,0.1],[44.505,26.088,0.1],[44.409,26.195,0.1],[44.456,25.963,0.1],[44.499,26.032,0.1],[44.422,26.145,0.1],[44.415,26.201,0.1],[44.442,26.047,0.1],[44.43,26.041,0.1],[44.412,26.085,0.1],[44.347,26.159,0.1],[44.519,26.069,0.1],[44.504,26.087,0.1],[44.49,25.971,0.1],[44.504,26.085,0.1],[44.422,26.152,0.1],[44.424,26.151,0.1],[44.421,26.152,0.1],[44.419,26.155,0.1],[44.421,26.154,0.1],[44.511,26.088,0.1],[44.505,26.09,0.1],[44.507,26.096,0.1],[44.507,26.094,0.1],[44.511,26.09,0.1],[44.511,26.093,0.1],[44.502,26.091,0.1],[44.51,26.091,0.1],[44.505,26.093,0.1],[44.397,26.127,0.1],[44.395,26.125,0.1],[44.4,26.122,0.1],[44.398,26.122,0.1],[44.4,26.128,0.1],[44.397,26.128,0.1],[44.398,26.121,0.1],[44.439,26.1,0.1],[44.382,26.116,0.1],[44.493,26.201,0.1],[44.427,26.031,0.1],[44.463,26.131,0.1],[44.462,26.125,0.1],[44.457,26.128,0.1],[44.462,26.128,0.1],[44.465,26.13,0.1],[44.46,26.13,0.1],[44.456,26.127,0.1],[44.451,26.124,0.1],[44.46,26.128,0.1],[44.459,26.128,0.1],[44.462,26.13,0.1],[44.462,26.116,0.1],[44.463,26.118,0.1],[44.462,26.118,0.1],[44.43,26.16,0.1],[44.433,26.157,0.1],[44.496,26.091,0.1],[44.493,26.097,0.1],[44.493,26.09,0.1],[44.456,26.049,0.1],[44.445,26.13,0.1],[44.447,26.128,0.1],[44.419,26.043,0.1],[44.465,26.143,0.1],[44.465,26.142,0.1],[44.463,26.142,0.1],[44.462,26.134,0.1],[44.453,26.149,0.1],[44.447,26.131,0.1],[44.424,26.136,0.1],[44.444,26.127,0.1],[44.418,26.178,0.1],[44.418,26.177,0.1],[44.421,26.174,0.1],[44.444,26.119,0.1],[44.416,26.184,0.1],[44.428,26.134,0.1],[44.412,26.14,0.1],[44.385,26.084,0.1],[44.383,26.134,0.1],[44.385,26.137,0.1],[44.385,26.136,0.1],[44.447,26.121,0.1],[44.385,26.103,0.1],[44.383,26.099,0.1],[44.385,26.115,0.1],[44.379,26.125,0.1],[44.377,26.121,0.1],[44.388,26.128,0.1],[44.439,26.022,0.1],[44.433,26.174,0.1],[44.501,26.022,0.1],[44.498,26.031,0.1],[44.434,26.102,0.1],[44.436,26.105,0.1],[44.436,26.106,0.1],[44.444,26.093,0.1],[44.457,26.047,0.1],[44.457,26.049,0.1],[44.456,26.05,0.1],[44.46,26.046,0.1],[44.459,26.05,0.1],[44.413,26.067,0.1],[44.412,26.069,0.1],[44.403,26.061,0.1],[44.4,26.052,0.1],[44.415,26.066,0.1],[44.436,26.02,0.1],[44.438,26.02,0.1],[44.438,26.022,0.1],[44.439,26.028,0.1],[44.436,26.023,0.1],[44.438,26.032,0.1],[44.436,26.032,0.1],[44.436,26.016,0.1],[44.433,26.02,0.1],[44.433,26.015,0.1],[44.431,26.012,0.1],[44.431,26.029,0.1],[44.431,26.032,0.1],[44.462,26.072,0.1],[44.462,26.073,0.1],[44.444,26.076,0.1],[44.471,26.053,0.1],[44.468,26.062,0.1],[44.391,26.125,0.1],[44.415,26.18,0.1],[44.448,26.049,0.1],[44.45,26.102,0.1],[44.442,26.102,0.1],[44.462,26.136,0.1],[44.388,26.091,0.1],[44.441,26.07,0.1],[44.451,26.096,0.1],[44.431,26.177,0.1],[44.428,26.189,0.1],[44.374,26.118,0.1],[44.413,26.11,0.1],[44.409,26.113,0.1],[44.434,26.106,0.1],[44.428,26.099,0.1],[44.478,26.072,0.1],[44.451,26.094,0.1],[44.45,26.128,0.1],[44.391,26.013,0.1],[44.35,26.032,0.1],[44.52,26.181,0.1],[44.536,26.061,0.1],[44.424,26.102,0.1],[44.427,26.016,0.1],[44.412,26.128,0.1],[44.391,26.146,0.1],[44.424,26.099,0.1],[44.362,26.09,0.1],[44.522,26.082,0.1],[44.439,26.193,0.1],[44.475,26.102,0.1],[44.475,26.1,0.1],[44.425,26.064,0.1],[44.373,25.982,0.1],[44.492,26.121,0.1],[44.493,26.125,0.1],[44.373,26.121,0.1],[44.465,26.059,0.1],[44.424,26.064,0.1],[44.528,26.047,0.1],[44.486,26.171,0.1],[44.374,26.047,0.1],[44.41,26.087,0.1],[44.403,25.986,0.1],[44.343,26.152,0.1],[44.43,26.193,0.1],[44.444,26.053,0.1],[44.404,26.201,0.1],[44.493,26.199,0.1],[44.441,26.046,0.1],[44.407,26.19,0.1],[44.422,26.214,0.1],[44.401,25.983,0.1],[44.453,26.13,0.1],[44.416,26.09,0.1],[44.505,26.084,0.1],[44.427,26.009,0.1],[44.484,26.07,0.1],[44.477,26.103,0.1],[44.478,26.1,0.1],[44.386,26.023,0.1],[44.368,26.125,0.1],[44.442,26.056,0.1],[44.418,25.966,0.1],[44.465,26.037,0.1],[44.496,26.199,0.1],[44.421,26.193,0.1],[44.474,26.112,0.1],[44.368,26.136,0.1],[44.416,26.215,0.1],[44.367,26.155,0.1],[44.415,26.199,0.1],[44.433,26.04,0.1],[44.371,26.178,0.1],[44.489,26.109,0.1],[44.359,26.133,0.1],[44.395,26.168,0.1],[44.523,25.95,0.1],[44.505,26.212,0.1],[44.368,26.044,0.1],[44.489,25.98,0.1],[44.504,25.997,0.1],[44.471,26.209,0.1],[44.486,26.201,0.1],[44.49,26.193,0.1],[44.475,26.106,0.1],[44.472,26.105,0.1],[44.471,26.103,0.1],[44.477,26.097,0.1],[44.477,26.066,0.1],[44.427,26.078,0.1],[44.457,26.109,0.1],[44.459,26.096,0.1],[44.463,26.09,0.1],[44.511,26.085,0.1],[44.504,26.079,0.1],[44.418,26.019,0.1],[44.43,26.094,0.1],[44.48,26.124,0.1],[44.463,26.128,0.1],[44.459,26.122,0.1],[44.459,26.127,0.1],[44.462,26.133,0.1],[44.457,26.13,0.1],[44.453,26.127,0.1],[44.459,26.121,0.1],[44.46,26.113,0.1],[44.442,26.159,0.1],[44.431,26.146,0.1],[44.431,26.172,0.1],[44.421,26.064,0.1],[44.424,26.016,0.1],[44.445,26.093,0.1],[44.445,26.128,0.1],[44.418,26.04,0.1],[44.413,26.139,0.1],[44.424,26.162,0.1],[44.468,26.14,0.1],[44.466,26.139,0.1],[44.465,26.14,0.1],[44.463,26.134,0.1],[44.459,26.133,0.1],[44.46,26.137,0.1],[44.459,26.139,0.1],[44.453,26.145,0.1],[44.424,26.13,0.1],[44.422,26.13,0.1],[44.427,26.128,0.1],[44.416,26.155,0.1],[44.442,26.134,0.1],[44.442,26.136,0.1],[44.422,26.177,0.1],[44.422,26.175,0.1],[44.438,26.184,0.1],[44.385,26.097,0.1],[44.48,26.121,0.1],[44.38,26.1,0.1],[44.415,26.081,0.1],[44.413,26.166,0.1],[44.415,26.163,0.1],[44.412,26.175,0.1],[44.418,26.142,0.1],[44.419,26.137,0.1],[44.434,26.157,0.1],[44.41,26.172,0.1],[44.413,26.148,0.1],[44.427,26.137,0.1],[44.422,26.178,0.1],[44.418,26.169,0.1],[44.43,26.093,0.1],[44.442,26.118,0.1],[44.441,26.116,0.1],[44.416,26.062,0.1],[44.41,26.067,0.1],[44.422,26.061,0.1],[44.422,26.062,0.1],[44.41,26.143,0.1],[44.388,26.103,0.1],[44.416,26.183,0.1],[44.43,26.136,0.1],[44.428,26.133,0.1],[44.419,26.115,0.1],[44.431,26.093,0.1],[44.441,26.1,0.1],[44.428,26.169,0.1],[44.427,26.178,0.1],[44.412,26.136,0.1],[44.413,26.142,0.1],[44.413,26.136,0.1],[44.43,26.134,0.1],[44.43,26.133,0.1],[44.448,26.124,0.1],[44.448,26.122,0.1],[44.445,26.121,0.1],[44.413,26.137,0.1],[44.41,26.139,0.1],[44.395,26.118,0.1],[44.398,26.106,0.1],[44.4,26.105,0.1],[44.389,26.109,0.1],[44.383,26.122,0.1],[44.38,26.121,0.1],[44.385,26.119,0.1],[44.38,26.124,0.1],[44.382,26.124,0.1],[44.385,26.116,0.1],[44.38,26.119,0.1],[44.383,26.116,0.1],[44.38,26.127,0.1],[44.382,26.133,0.1],[44.382,26.13,0.1],[44.389,26.128,0.1],[44.391,26.127,0.1],[44.389,26.127,0.1],[44.383,26.133,0.1],[44.385,26.131,0.1],[44.386,26.131,0.1],[44.388,26.131,0.1],[44.386,26.128,0.1],[44.388,26.134,0.1],[44.392,26.128,0.1],[44.438,26.159,0.1],[44.436,26.017,0.1],[44.439,26.02,0.1],[44.472,26.019,0.1],[44.441,26.016,0.1],[44.418,26.049,0.1],[44.456,26.047,0.1],[44.459,26.052,0.1],[44.421,26.116,0.1],[44.422,26.116,0.1],[44.422,26.119,0.1],[44.416,26.128,0.1],[44.404,26.062,0.1],[44.409,26.067,0.1],[44.407,26.066,0.1],[44.407,26.067,0.1],[44.407,26.069,0.1],[44.406,26.067,0.1],[44.404,26.067,0.1],[44.407,26.061,0.1],[44.409,26.064,0.1],[44.412,26.072,0.1],[44.409,26.075,0.1],[44.407,26.075,0.1],[44.409,26.076,0.1],[44.406,26.075,0.1],[44.404,26.061,0.1],[44.403,26.062,0.1],[44.401,26.05,0.1],[44.416,26.069,0.1],[44.418,26.067,0.1],[44.419,26.066,0.1],[44.418,26.07,0.1],[44.413,26.07,0.1],[44.438,26.017,0.1],[44.441,26.023,0.1],[44.441,26.026,0.1],[44.436,26.022,0.1],[44.436,26.025,0.1],[44.439,26.017,0.1],[44.442,26.178,0.1],[44.439,26.175,0.1],[44.431,26.028,0.1],[44.431,26.015,0.1],[44.445,26.031,0.1],[44.439,26.184,0.1],[44.422,26.163,0.1],[44.424,25.997,0.1],[44.416,26.046,0.1],[44.416,26.04,0.1],[44.412,26.02,0.1],[44.427,26.032,0.1],[44.425,26.038,0.1],[44.46,26.07,0.1],[44.456,26.078,0.1],[44.454,26.076,0.1],[44.453,26.073,0.1],[44.454,26.073,0.1],[44.45,26.078,0.1],[44.469,26.052,0.1],[44.389,26.13,0.1],[44.422,26.181,0.1],[44.477,26.05,0.1],[44.444,26.096,0.1],[44.48,26.049,0.1],[44.441,26.103,0.1],[44.451,26.119,0.1],[44.45,26.121,0.1],[44.442,26.1,0.1],[44.439,26.102,0.1],[44.404,26.088,0.1],[44.392,26.096,0.1],[44.448,26.053,0.1],[44.404,26.087,0.1],[44.441,26.09,0.1],[44.412,26.171,0.1],[44.403,26.088,0.1],[44.434,26.103,0.1],[44.469,26.142,0.1],[44.407,26.203,0.1],[44.409,26.203,0.1],[44.43,26.189,0.1],[44.416,26.087,0.1],[44.439,26.093,0.1],[44.45,26.084,0.1],[44.475,26.183,0.1],[44.474,26.062,0.1],[44.427,26.066,0.1],[44.478,26.064,0.1],[44.475,26.066,0.1],[44.492,26.062,0.1],[44.425,26.13,0.1],[44.416,26.136,0.1],[44.43,26.096,0.1],[44.371,26.091,0.1],[44.361,26.124,0.1],[44.416,26.097,0.1],[44.442,26.019,0.1],[44.441,26.099,0.1],[44.422,26.133,0.1],[44.425,26.01,0.1],[44.425,26.0,0.1],[44.436,25.977,0.1],[44.436,26.053,0.1],[44.454,26.14,0.1],[44.474,26.189,0.1],[44.478,26.172,0.1],[44.427,26.061,0.1],[44.428,26.037,0.1],[44.465,26.061,0.1],[44.361,25.963,0.1],[44.425,25.985,0.1],[44.498,26.181,0.1],[44.483,26.165,0.1],[44.502,26.215,0.1],[44.367,26.19,0.1],[44.364,26.02,0.1],[44.43,26.205,0.1],[44.388,26.121,0.1],[44.539,26.093,0.1],[44.436,25.98,0.1],[44.478,26.157,0.1],[44.478,26.16,0.1],[44.356,26.043,0.1],[44.538,26.062,0.1],[44.505,26.208,0.1],[44.507,26.209,0.1],[44.496,26.205,0.1],[44.523,25.956,0.1],[44.368,26.187,0.1],[44.391,25.979,0.1],[44.397,25.973,0.1],[44.388,26.062,0.1],[44.502,26.211,0.1],[44.37,26.137,0.1],[44.421,26.072,0.1],[44.415,26.118,0.1],[44.492,26.069,0.1],[44.391,26.007,0.1],[44.391,25.986,0.1],[44.539,26.099,0.1],[44.536,26.145,0.1],[44.34,26.087,0.1],[44.373,26.151,0.1],[44.413,26.088,0.1],[44.447,25.985,0.1],[44.374,26.11,0.1],[44.445,26.081,0.1],[44.541,25.974,0.1],[44.35,26.05,0.1],[44.498,25.976,0.1],[44.373,26.125,0.1],[44.424,25.988,0.1],[44.367,26.115,0.1],[44.453,25.986,0.1],[44.489,25.979,0.1],[44.474,26.055,0.1],[44.37,26.125,0.1],[44.456,26.119,0.1],[44.517,26.016,0.1],[44.37,26.127,0.1],[44.431,26.1,0.1],[44.431,26.105,0.1],[44.439,25.982,0.1],[44.501,26.201,0.1],[44.505,26.214,0.1],[44.499,26.208,0.1],[44.493,26.202,0.1],[44.407,26.206,0.1],[44.439,26.165,0.1],[44.474,26.163,0.1],[44.541,26.171,0.1],[44.431,26.058,0.1],[44.478,26.053,0.1],[44.486,26.108,0.1],[44.41,26.201,0.1],[44.407,25.986,0.1],[44.373,26.186,0.1],[44.365,26.181,0.1],[44.365,26.183,0.1],[44.358,26.131,0.1],[44.438,25.988,0.1],[44.425,26.22,0.1],[44.463,26.035,0.1],[44.431,26.038,0.1],[44.51,26.202,0.1],[44.49,26.116,0.1],[44.376,26.047,0.1],[44.442,25.979,0.1],[44.37,26.217,0.1],[44.498,26.217,0.1],[44.475,26.186,0.1],[44.487,26.195,0.1],[44.438,26.052,0.1],[44.433,26.038,0.1],[44.406,26.11,0.0],[44.428,26.097,0.0],[44.436,26.079,0.0],[44.439,25.96,0.0],[44.415,26.1,0.0],[44.477,26.07,0.0],[44.419,26.022,0.0],[44.438,26.097,0.0],[44.422,26.015,0.0],[44.424,26.022,0.0],[44.424,26.038,0.0],[44.465,26.11,0.0],[44.454,26.102,0.0],[44.462,26.131,0.0],[44.462,26.121,0.0],[44.46,26.125,0.0],[44.46,26.124,0.0],[44.459,26.125,0.0],[44.46,26.127,0.0],[44.457,26.127,0.0],[44.462,26.127,0.0],[44.453,26.125,0.0],[44.453,26.124,0.0],[44.454,26.106,0.0],[44.46,26.115,0.0],[44.465,26.118,0.0],[44.424,26.14,0.0],[44.425,26.145,0.0],[44.43,26.155,0.0],[44.433,26.155,0.0],[44.436,26.165,0.0],[44.433,26.166,0.0],[44.431,26.166,0.0],[44.421,26.142,0.0],[44.422,26.14,0.0],[44.43,26.064,0.0],[44.444,26.128,0.0],[44.436,26.097,0.0],[44.416,26.032,0.0],[44.415,26.034,0.0],[44.416,26.026,0.0],[44.421,26.022,0.0],[44.425,26.04,0.0],[44.427,26.05,0.0],[44.422,26.044,0.0],[44.421,26.038,0.0],[44.419,26.047,0.0],[44.419,26.038,0.0],[44.415,26.171,0.0],[44.468,26.143,0.0],[44.468,26.145,0.0],[44.463,26.143,0.0],[44.465,26.146,0.0],[44.46,26.133,0.0],[44.444,26.142,0.0],[44.444,26.145,0.0],[44.441,26.177,0.0],[44.424,26.134,0.0],[44.481,26.122,0.0],[44.415,26.175,0.0],[44.424,26.131,0.0],[44.422,26.136,0.0],[44.48,26.043,0.0],[44.401,26.099,0.0],[44.416,26.154,0.0],[44.418,26.159,0.0],[44.415,26.155,0.0],[44.442,26.137,0.0],[44.444,26.131,0.0],[44.439,26.136,0.0],[44.422,26.168,0.0],[44.422,26.166,0.0],[44.489,26.118,0.0],[44.454,26.099,0.0],[44.483,26.055,0.0],[44.483,26.056,0.0],[44.483,26.058,0.0],[44.412,26.166,0.0],[44.413,26.175,0.0],[44.418,26.168,0.0],[44.409,26.168,0.0],[44.41,26.168,0.0],[44.415,26.151,0.0],[44.419,26.139,0.0],[44.421,26.137,0.0],[44.415,26.146,0.0],[44.413,26.143,0.0],[44.415,26.139,0.0],[44.418,26.18,0.0],[44.409,26.172,0.0],[44.431,26.094,0.0],[44.444,26.118,0.0],[44.41,26.073,0.0],[44.418,26.062,0.0],[44.422,26.066,0.0],[44.391,26.079,0.0],[44.385,26.082,0.0],[44.41,26.14,0.0],[44.388,26.105,0.0],[44.416,26.085,0.0],[44.413,26.18,0.0],[44.416,26.181,0.0],[44.406,26.177,0.0],[44.438,26.133,0.0],[44.427,26.133,0.0],[44.416,26.072,0.0],[44.421,26.109,0.0],[44.431,26.109,0.0],[44.43,26.108,0.0],[44.412,26.146,0.0],[44.413,26.134,0.0],[44.428,26.131,0.0],[44.433,26.127,0.0],[44.424,26.122,0.0],[44.447,26.125,0.0],[44.433,26.195,0.0],[44.424,26.075,0.0],[44.415,26.106,0.0],[44.392,26.093,0.0],[44.416,26.142,0.0],[44.415,26.134,0.0],[44.395,26.113,0.0],[44.4,26.099,0.0],[44.4,26.102,0.0],[44.4,26.1,0.0],[44.394,26.1,0.0],[44.385,26.093,0.0],[44.385,26.099,0.0],[44.383,26.096,0.0],[44.419,26.171,0.0],[44.38,26.097,0.0],[44.382,26.097,0.0],[44.379,26.1,0.0],[44.379,26.103,0.0],[44.383,26.113,0.0],[44.379,26.116,0.0],[44.377,26.119,0.0],[44.38,26.125,0.0],[44.379,26.121,0.0],[44.388,26.118,0.0],[44.386,26.118,0.0],[44.383,26.127,0.0],[44.382,26.125,0.0],[44.383,26.128,0.0],[44.382,26.134,0.0],[44.386,26.134,0.0],[44.386,26.133,0.0],[44.382,26.136,0.0],[44.389,26.131,0.0],[44.438,26.157,0.0],[44.438,26.16,0.0],[44.499,26.031,0.0],[44.413,26.149,0.0],[44.451,26.07,0.0],[44.427,26.168,0.0],[44.441,26.108,0.0],[44.436,26.102,0.0],[44.425,26.165,0.0],[44.481,26.088,0.0],[44.462,26.108,0.0],[44.441,26.013,0.0],[44.43,26.009,0.0],[44.433,26.012,0.0],[44.421,26.043,0.0],[44.454,26.05,0.0],[44.457,26.046,0.0],[44.456,26.052,0.0],[44.454,26.052,0.0],[44.456,26.053,0.0],[44.456,26.055,0.0],[44.453,26.052,0.0],[44.462,26.046,0.0],[44.46,26.047,0.0],[44.421,26.115,0.0],[44.422,26.113,0.0],[44.421,26.112,0.0],[44.419,26.112,0.0],[44.422,26.118,0.0],[44.422,26.122,0.0],[44.419,26.119,0.0],[44.422,26.124,0.0],[44.413,26.125,0.0],[44.415,26.13,0.0],[44.419,26.133,0.0],[44.421,26.133,0.0],[44.415,26.085,0.0],[44.409,26.069,0.0],[44.406,26.066,0.0],[44.431,26.013,0.0],[44.409,26.066,0.0],[44.406,26.069,0.0],[44.407,26.062,0.0],[44.409,26.061,0.0],[44.407,26.059,0.0],[44.41,26.061,0.0],[44.41,26.064,0.0],[44.41,26.066,0.0],[44.404,26.066,0.0],[44.413,26.062,0.0],[44.413,26.066,0.0],[44.41,26.072,0.0],[44.412,26.073,0.0],[44.41,26.076,0.0],[44.409,26.078,0.0],[44.412,26.076,0.0],[44.412,26.078,0.0],[44.403,26.076,0.0],[44.403,26.059,0.0],[44.403,26.058,0.0],[44.401,26.055,0.0],[44.403,26.066,0.0],[44.413,26.072,0.0],[44.416,26.067,0.0],[44.419,26.069,0.0],[44.416,26.066,0.0],[44.413,26.069,0.0],[44.416,26.061,0.0],[44.418,26.061,0.0],[44.418,26.066,0.0],[44.419,26.062,0.0],[44.439,26.019,0.0],[44.439,26.023,0.0],[44.439,26.026,0.0],[44.438,26.028,0.0],[44.434,26.026,0.0],[44.438,26.031,0.0],[44.439,26.015,0.0],[44.441,26.019,0.0],[44.436,26.038,0.0],[44.436,26.037,0.0],[44.433,26.017,0.0],[44.433,26.009,0.0],[44.431,26.017,0.0],[44.431,26.025,0.0],[44.433,26.016,0.0],[44.43,26.015,0.0],[44.43,26.019,0.0],[44.431,26.009,0.0],[44.444,26.032,0.0],[44.439,26.031,0.0],[44.438,26.034,0.0],[44.431,26.031,0.0],[44.442,26.18,0.0],[44.422,26.162,0.0],[44.46,26.049,0.0],[44.456,26.041,0.0],[44.454,26.041,0.0],[44.425,25.998,0.0],[44.416,26.044,0.0],[44.459,26.078,0.0],[44.457,26.078,0.0],[44.451,26.084,0.0],[44.451,26.081,0.0],[44.451,26.072,0.0],[44.45,26.072,0.0],[44.448,26.078,0.0],[44.445,26.079,0.0],[44.46,26.059,0.0],[44.466,26.055,0.0],[44.468,26.053,0.0],[44.471,26.049,0.0],[44.472,26.049,0.0],[44.465,26.069,0.0],[44.439,26.103,0.0],[44.444,26.097,0.0],[44.438,26.166,0.0],[44.462,26.076,0.0],[44.46,26.076,0.0],[44.386,26.127,0.0],[44.477,26.049,0.0],[44.445,26.09,0.0],[44.48,26.05,0.0],[44.481,26.052,0.0],[44.445,26.143,0.0],[44.433,26.108,0.0],[44.466,26.113,0.0],[44.441,26.093,0.0],[44.444,26.146,0.0],[44.451,26.121,0.0],[44.416,26.131,0.0],[44.398,26.143,0.0],[44.407,26.094,0.0],[44.433,26.006,0.0],[44.457,26.097,0.0],[44.444,26.067,0.0],[44.441,26.069,0.0],[44.493,26.084,0.0],[44.489,26.038,0.0],[44.487,26.038,0.0],[44.486,26.037,0.0],[44.486,26.04,0.0],[44.394,26.094,0.0],[44.392,26.094,0.0],[44.391,26.097,0.0],[44.425,26.067,0.0],[44.433,26.059,0.0],[44.436,26.1,0.0],[44.415,26.183,0.0],[44.431,26.178,0.0],[44.418,26.084,0.0],[44.448,26.136,0.0],[44.415,26.11,0.0],[44.413,26.109,0.0],[44.415,26.112,0.0],[44.412,26.11,0.0],[44.41,26.113,0.0],[44.421,26.108,0.0],[44.442,26.096,0.0],[44.406,26.094,0.0],[44.468,26.137,0.0],[44.444,26.102,0.0],[44.444,26.103,0.0],[44.451,26.088,0.0],[44.445,26.102,0.0],[44.413,26.103,0.0],[44.425,26.096,0.0],[44.447,26.122,0.0],[44.484,26.073,0.0],[44.48,26.066,0.0],[44.404,25.992,0.0],[44.379,26.128,0.0],[44.37,25.976,0.0],[44.373,25.979,0.0],[44.412,26.091,0.0],[44.522,26.181,0.0],[44.531,26.19,0.0],[44.495,26.097,0.0],[44.41,26.019,0.0],[44.409,26.22,0.0],[44.412,26.125,0.0],[44.425,26.001,0.0],[44.427,26.001,0.0],[44.471,26.069,0.0],[44.477,26.178,0.0],[44.484,26.11,0.0],[44.454,26.134,0.0],[44.425,26.003,0.0],[44.406,26.143,0.0],[44.404,26.14,0.0],[44.406,26.139,0.0],[44.474,26.18,0.0],[44.404,26.206,0.0],[44.438,26.19,0.0],[44.447,26.066,0.0],[44.489,26.187,0.0],[44.436,25.985,0.0],[44.448,26.131,0.0],[44.428,25.974,0.0],[44.427,25.974,0.0],[44.454,26.082,0.0],[44.431,26.055,0.0],[44.43,26.059,0.0],[44.438,26.108,0.0],[44.371,25.976,0.0],[44.483,26.044,0.0],[44.419,26.109,0.0],[44.359,25.965,0.0],[44.528,26.04,0.0],[44.525,26.038,0.0],[44.528,26.041,0.0],[44.526,26.041,0.0],[44.406,26.193,0.0],[44.496,26.206,0.0],[44.389,26.026,0.0],[44.413,26.102,0.0],[44.45,26.066,0.0],[44.522,26.186,0.0],[44.517,26.183,0.0],[44.391,26.01,0.0],[44.389,26.013,0.0],[44.389,26.009,0.0],[44.422,26.012,0.0],[44.343,26.16,0.0],[44.492,26.061,0.0],[44.421,26.073,0.0],[44.419,26.072,0.0],[44.495,26.177,0.0],[44.48,26.157,0.0],[44.38,26.155,0.0],[44.406,26.112,0.0],[44.407,26.112,0.0],[44.542,26.067,0.0],[44.471,26.094,0.0],[44.478,26.119,0.0],[44.424,26.192,0.0],[44.344,25.944,0.0],[44.349,26.183,0.0],[44.41,26.149,0.0],[44.496,26.203,0.0],[44.415,26.116,0.0],[44.371,26.14,0.0],[44.478,26.058,0.0],[44.407,25.992,0.0],[44.4,25.977,0.0],[44.395,25.98,0.0],[44.407,25.973,0.0],[44.371,26.136,0.0],[44.422,26.211,0.0],[44.469,26.11,0.0],[44.397,25.98,0.0],[44.371,26.148,0.0],[44.37,26.148,0.0],[44.371,26.152,0.0],[44.511,26.022,0.0],[44.368,26.145,0.0],[44.451,25.988,0.0],[44.535,26.062,0.0],[44.386,26.064,0.0],[44.445,26.02,0.0],[44.475,26.174,0.0],[44.364,26.152,0.0],[44.471,26.175,0.0],[44.471,26.174,0.0],[44.525,26.195,0.0],[44.383,25.991,0.0],[44.368,26.131,0.0],[44.371,25.98,0.0],[44.388,26.13,0.0],[44.487,26.187,0.0],[44.371,26.125,0.0],[44.362,26.149,0.0],[44.475,26.139,0.0],[44.448,26.022,0.0],[44.542,26.079,0.0],[44.522,26.022,0.0],[44.425,26.009,0.0],[44.52,26.017,0.0],[44.374,26.127,0.0],[44.373,26.127,0.0],[44.489,25.983,0.0],[44.445,26.067,0.0],[44.364,26.195,0.0],[44.502,26.199,0.0],[44.468,26.052,0.0],[44.447,25.977,0.0],[44.454,25.974,0.0],[44.454,25.971,0.0],[44.416,26.115,0.0],[44.445,26.059,0.0],[44.4,26.208,0.0],[44.434,26.001,0.0],[44.371,26.127,0.0],[44.362,26.13,0.0],[44.456,26.208,0.0],[44.48,25.98,0.0],[44.415,26.037,0.0],[44.516,26.019,0.0],[44.478,26.066,0.0],[44.502,26.075,0.0],[44.465,26.023,0.0],[44.493,26.146,0.0],[44.364,26.091,0.0],[44.413,26.198,0.0],[44.478,26.118,0.0],[44.361,26.152,0.0],[44.539,26.171,0.0],[44.496,26.003,0.0],[44.377,26.192,0.0],[44.401,26.211,0.0],[44.412,26.198,0.0],[44.413,26.05,0.0],[44.367,26.18,0.0],[44.365,26.18,0.0],[44.486,25.974,0.0],[44.355,26.145,0.0],[44.353,26.145,0.0],[44.367,26.157,0.0],[44.413,26.09,0.0],[44.433,26.105,0.0],[44.522,26.178,0.0],[44.362,26.152,0.0],[44.41,26.202,0.0],[44.51,26.22,0.0],[44.511,26.203,0.0],[44.364,26.18,0.0],[44.431,26.099,0.0],[44.465,26.209,0.0],[44.373,26.189,0.0],[44.495,26.118,0.0],[44.477,25.977,0.0],[44.522,26.145,0.0],[44.374,26.128,0.0],[44.52,26.061,0.0],[44.409,26.112,0.0],[44.496,26.209,0.0],[44.499,26.218,0.0],[44.498,26.22,0.0],[44.496,26.22,0.0],[44.495,26.202,0.0],[44.471,26.181,0.0],[44.368,26.012,0.0],[44.49,26.19,0.0],[44.489,26.196,0.0],[44.407,26.109,0.0],[44.436,26.103,0.0],[44.433,25.98,0.0],[44.441,25.977,0.0],[44.441,25.986,0.0],[44.407,26.139,0.0],[44.453,26.088,0.0],[44.474,26.066,0.0],[44.436,26.146,0.0],[44.37,25.974,0.0],[44.412,26.016,0.0],[44.413,26.019,0.0],[44.415,26.02,0.0],[44.416,26.016,0.0],[44.419,26.017,0.0],[44.421,26.019,0.0],[44.421,26.015,0.0],[44.422,26.013,0.0],[44.424,26.019,0.0],[44.422,26.019,0.0],[44.425,26.02,0.0],[44.425,26.023,0.0],[44.459,26.108,0.0],[44.424,26.035,0.0],[44.424,26.031,0.0],[44.425,26.028,0.0],[44.454,26.105,0.0],[44.466,26.094,0.0],[44.463,26.124,0.0],[44.46,26.122,0.0],[44.46,26.131,0.0],[44.459,26.131,0.0],[44.459,26.13,0.0],[44.456,26.128,0.0],[44.454,26.128,0.0],[44.454,26.124,0.0],[44.457,26.121,0.0],[44.456,26.106,0.0],[44.456,26.108,0.0],[44.459,26.113,0.0],[44.46,26.11,0.0],[44.463,26.119,0.0],[44.428,26.145,0.0],[44.442,26.16,0.0],[44.444,26.162,0.0],[44.424,26.145,0.0],[44.422,26.142,0.0],[44.424,26.143,0.0],[44.462,26.115,0.0],[44.463,26.116,0.0],[44.431,26.159,0.0],[44.433,26.159,0.0],[44.436,26.16,0.0],[44.436,26.162,0.0],[44.436,26.159,0.0],[44.433,26.163,0.0],[44.431,26.165,0.0],[44.43,26.165,0.0],[44.43,26.168,0.0],[44.431,26.169,0.0],[44.428,26.174,0.0],[44.419,26.143,0.0],[44.419,26.14,0.0],[44.492,26.094,0.0],[44.492,26.096,0.0],[44.495,26.096,0.0],[44.422,26.017,0.0],[44.431,26.062,0.0],[44.427,26.055,0.0],[44.428,26.066,0.0],[44.444,26.017,0.0],[44.453,26.04,0.0],[44.46,26.1,0.0],[44.415,26.032,0.0],[44.416,26.029,0.0],[44.416,26.031,0.0],[44.415,26.029,0.0],[44.415,26.026,0.0],[44.418,26.025,0.0],[44.418,26.023,0.0],[44.421,26.026,0.0],[44.419,26.026,0.0],[44.425,26.046,0.0],[44.425,26.049,0.0],[44.421,26.041,0.0],[44.418,26.043,0.0],[44.418,26.137,0.0],[44.418,26.139,0.0],[44.466,26.146,0.0],[44.466,26.142,0.0],[44.466,26.148,0.0],[44.466,26.155,0.0],[44.463,26.137,0.0],[44.465,26.136,0.0],[44.463,26.136,0.0],[44.453,26.146,0.0],[44.453,26.148,0.0],[44.451,26.151,0.0],[44.451,26.148,0.0],[44.46,26.136,0.0],[44.459,26.137,0.0],[44.457,26.137,0.0],[44.456,26.14,0.0],[44.456,26.13,0.0],[44.444,26.157,0.0],[44.444,26.166,0.0],[44.442,26.169,0.0],[44.441,26.181,0.0],[44.48,26.122,0.0],[44.487,26.096,0.0],[44.457,26.105,0.0],[44.439,26.079,0.0],[44.442,26.076,0.0],[44.468,26.108,0.0],[44.465,26.103,0.0],[44.483,26.116,0.0],[44.484,26.091,0.0],[44.422,26.139,0.0],[44.422,26.137,0.0],[44.481,26.047,0.0],[44.418,26.152,0.0],[44.416,26.159,0.0],[44.415,26.154,0.0],[44.421,26.162,0.0],[44.444,26.137,0.0],[44.445,26.136,0.0],[44.444,26.133,0.0],[44.444,26.134,0.0],[44.442,26.13,0.0],[44.439,26.134,0.0],[44.442,26.131,0.0],[44.442,26.133,0.0],[44.424,26.169,0.0],[44.422,26.169,0.0],[44.424,26.175,0.0],[44.481,26.053,0.0],[44.383,26.1,0.0],[44.385,26.102,0.0],[44.416,26.013,0.0],[44.413,26.163,0.0],[44.413,26.165,0.0],[44.419,26.166,0.0],[44.413,26.168,0.0],[44.413,26.154,0.0],[44.412,26.16,0.0],[44.41,26.169,0.0],[44.427,26.109,0.0],[44.412,26.177,0.0],[44.412,26.174,0.0],[44.41,26.174,0.0],[44.412,26.172,0.0],[44.413,26.151,0.0],[44.415,26.168,0.0],[44.413,26.169,0.0],[44.41,26.165,0.0],[44.409,26.169,0.0],[44.415,26.149,0.0],[44.418,26.14,0.0],[44.441,26.091,0.0],[44.407,26.146,0.0],[44.409,26.146,0.0],[44.41,26.171,0.0],[44.412,26.152,0.0],[44.413,26.146,0.0],[44.416,26.139,0.0],[44.415,26.142,0.0],[44.413,26.172,0.0],[44.413,26.177,0.0],[44.431,26.136,0.0],[44.428,26.137,0.0],[44.409,26.082,0.0],[44.418,26.174,0.0],[44.407,26.174,0.0],[44.416,26.166,0.0],[44.436,26.139,0.0],[44.442,26.116,0.0],[44.409,26.07,0.0],[44.422,26.059,0.0],[44.424,26.061,0.0],[44.421,26.059,0.0],[44.421,26.062,0.0],[44.389,26.076,0.0],[44.391,26.081,0.0],[44.409,26.142,0.0],[44.409,26.143,0.0],[44.409,26.145,0.0],[44.407,26.143,0.0],[44.486,26.096,0.0],[44.453,26.096,0.0],[44.415,26.181,0.0],[44.418,26.181,0.0],[44.407,26.177,0.0],[44.406,26.174,0.0],[44.409,26.174,0.0],[44.463,26.099,0.0],[44.447,26.108,0.0],[44.448,26.106,0.0],[44.43,26.137,0.0],[44.431,26.134,0.0],[44.428,26.136,0.0],[44.427,26.134,0.0],[44.415,26.137,0.0],[44.418,26.134,0.0],[44.419,26.128,0.0],[44.407,26.093,0.0],[44.404,26.096,0.0],[44.421,26.097,0.0],[44.442,26.073,0.0],[44.427,26.166,0.0],[44.427,26.177,0.0],[44.412,26.143,0.0],[44.412,26.145,0.0],[44.433,26.096,0.0],[44.415,26.108,0.0],[44.43,26.109,0.0],[44.469,26.14,0.0],[44.413,26.14,0.0],[44.383,26.136,0.0],[44.383,26.137,0.0],[44.428,26.109,0.0],[44.438,26.119,0.0],[44.433,26.11,0.0],[44.427,26.125,0.0],[44.431,26.131,0.0],[44.442,26.016,0.0],[44.425,26.121,0.0],[44.516,26.081,0.0],[44.427,26.121,0.0],[44.428,26.13,0.0],[44.445,26.119,0.0],[44.448,26.121,0.0],[44.439,26.105,0.0],[44.459,26.097,0.0],[44.454,26.04,0.0],[44.481,26.09,0.0],[44.481,26.087,0.0],[44.439,26.159,0.0],[44.391,26.093,0.0],[44.415,26.14,0.0],[44.409,26.14,0.0],[44.412,26.148,0.0],[44.413,26.152,0.0],[44.412,26.137,0.0],[44.397,26.115,0.0],[44.397,26.116,0.0],[44.394,26.11,0.0],[44.395,26.112,0.0],[44.392,26.109,0.0],[44.398,26.108,0.0],[44.398,26.102,0.0],[44.398,26.105,0.0],[44.4,26.103,0.0],[44.383,26.106,0.0],[44.386,26.103,0.0],[44.386,26.105,0.0],[44.385,26.105,0.0],[44.38,26.093,0.0],[44.379,26.094,0.0],[44.38,26.096,0.0],[44.383,26.097,0.0],[44.379,26.097,0.0],[44.453,26.097,0.0],[44.382,26.096,0.0],[44.382,26.099,0.0],[44.377,26.103,0.0],[44.379,26.102,0.0],[44.377,26.108,0.0],[44.377,26.105,0.0],[44.38,26.106,0.0],[44.377,26.109,0.0],[44.38,26.115,0.0],[44.383,26.115,0.0],[44.382,26.115,0.0],[44.38,26.116,0.0],[44.379,26.118,0.0],[44.383,26.118,0.0],[44.382,26.121,0.0],[44.385,26.121,0.0],[44.379,26.124,0.0],[44.38,26.131,0.0],[44.38,26.13,0.0],[44.382,26.131,0.0],[44.389,26.125,0.0],[44.385,26.134,0.0],[44.386,26.137,0.0],[44.38,26.134,0.0],[44.388,26.137,0.0],[44.391,26.128,0.0],[44.391,26.134,0.0],[44.391,26.133,0.0],[44.392,26.127,0.0],[44.441,26.157,0.0],[44.466,26.049,0.0],[44.475,26.013,0.0],[44.478,26.18,0.0],[44.477,26.169,0.0],[44.475,26.175,0.0],[44.447,26.127,0.0],[44.474,26.019,0.0],[44.438,26.094,0.0],[44.444,26.143,0.0],[44.434,26.01,0.0],[44.389,26.203,0.0],[44.438,26.106,0.0],[44.434,26.096,0.0],[44.438,26.109,0.0],[44.416,26.127,0.0],[44.415,26.127,0.0],[44.45,26.087,0.0],[44.427,26.04,0.0],[44.428,26.041,0.0],[44.439,26.012,0.0],[44.436,26.01,0.0],[44.433,26.01,0.0],[44.442,26.015,0.0],[44.436,26.0,0.0],[44.438,26.006,0.0],[44.416,26.047,0.0],[44.418,26.046,0.0],[44.418,26.041,0.0],[44.416,26.043,0.0],[44.418,26.044,0.0],[44.454,26.047,0.0],[44.463,26.04,0.0],[44.459,26.053,0.0],[44.422,26.115,0.0],[44.421,26.113,0.0],[44.421,26.11,0.0],[44.422,26.11,0.0],[44.419,26.116,0.0],[44.421,26.118,0.0],[44.418,26.119,0.0],[44.418,26.121,0.0],[44.421,26.122,0.0],[44.421,26.124,0.0],[44.419,26.125,0.0],[44.416,26.122,0.0],[44.418,26.122,0.0],[44.416,26.124,0.0],[44.418,26.124,0.0],[44.421,26.13,0.0],[44.412,26.124,0.0],[44.415,26.131,0.0],[44.416,26.133,0.0],[44.415,26.076,0.0],[44.416,26.081,0.0],[44.416,26.084,0.0],[44.415,26.082,0.0],[44.406,26.061,0.0],[44.406,26.064,0.0],[44.407,26.07,0.0],[44.404,26.07,0.0],[44.409,26.062,0.0],[44.41,26.062,0.0],[44.406,26.062,0.0],[44.406,26.059,0.0],[44.409,26.059,0.0],[44.412,26.062,0.0],[44.413,26.064,0.0],[44.41,26.07,0.0],[44.407,26.072,0.0],[44.41,26.075,0.0],[44.409,26.073,0.0],[44.412,26.075,0.0],[44.407,26.076,0.0],[44.413,26.076,0.0],[44.409,26.079,0.0],[44.406,26.076,0.0],[44.403,26.056,0.0],[44.401,26.053,0.0],[44.403,26.052,0.0],[44.403,26.055,0.0],[44.436,26.087,0.0],[44.415,26.072,0.0],[44.415,26.067,0.0],[44.43,26.097,0.0],[44.415,26.064,0.0],[44.418,26.064,0.0],[44.416,26.064,0.0],[44.419,26.061,0.0],[44.436,26.019,0.0],[44.436,26.029,0.0],[44.436,26.031,0.0],[44.438,26.023,0.0],[44.439,26.029,0.0],[44.434,26.037,0.0],[44.434,26.04,0.0],[44.442,26.163,0.0],[44.445,26.169,0.0],[44.442,26.171,0.0],[44.434,26.169,0.0],[44.438,26.172,0.0],[44.433,26.028,0.0],[44.433,26.029,0.0],[44.431,26.022,0.0],[44.43,26.01,0.0],[44.43,26.006,0.0],[44.444,26.034,0.0],[44.445,26.032,0.0],[44.442,26.034,0.0],[44.442,26.032,0.0],[44.441,26.034,0.0],[44.439,26.035,0.0],[44.438,26.035,0.0],[44.442,26.181,0.0],[44.441,26.192,0.0],[44.422,26.16,0.0],[44.436,26.009,0.0],[44.454,26.053,0.0],[44.456,26.04,0.0],[44.453,26.044,0.0],[44.445,26.056,0.0],[44.445,26.058,0.0],[44.444,26.059,0.0],[44.433,25.998,0.0],[44.43,26.004,0.0],[44.418,26.047,0.0],[44.418,26.038,0.0],[44.418,26.02,0.0],[44.424,26.015,0.0],[44.428,26.168,0.0],[44.431,26.128,0.0],[44.43,26.119,0.0],[44.433,26.13,0.0],[44.431,26.125,0.0],[44.418,26.015,0.0],[44.418,26.017,0.0],[44.415,26.017,0.0],[44.425,26.025,0.0],[44.427,26.026,0.0],[44.425,26.043,0.0],[44.422,26.035,0.0],[44.422,26.049,0.0],[44.419,26.037,0.0],[44.457,26.064,0.0],[44.463,26.072,0.0],[44.46,26.072,0.0],[44.462,26.075,0.0],[44.459,26.076,0.0],[44.456,26.079,0.0],[44.456,26.075,0.0],[44.454,26.081,0.0],[44.453,26.084,0.0],[44.453,26.079,0.0],[44.453,26.081,0.0],[44.453,26.075,0.0],[44.453,26.072,0.0],[44.448,26.076,0.0],[44.444,26.078,0.0],[44.445,26.073,0.0],[44.448,26.07,0.0],[44.453,26.067,0.0],[44.454,26.064,0.0],[44.468,26.058,0.0],[44.466,26.058,0.0],[44.471,26.05,0.0],[44.474,26.047,0.0],[44.474,26.049,0.0],[44.472,26.05,0.0],[44.471,26.055,0.0],[44.469,26.056,0.0],[44.471,26.058,0.0],[44.469,26.061,0.0],[44.466,26.072,0.0],[44.463,26.073,0.0],[44.418,26.136,0.0],[44.459,26.124,0.0],[44.441,26.102,0.0],[44.441,26.004,0.0],[44.386,26.136,0.0],[44.397,26.108,0.0],[44.439,26.124,0.0],[44.433,26.124,0.0],[44.45,26.05,0.0],[44.448,26.128,0.0],[44.438,26.162,0.0],[44.463,26.075,0.0],[44.444,26.064,0.0],[44.385,26.125,0.0],[44.386,26.124,0.0],[44.386,26.125,0.0],[44.481,26.046,0.0],[44.477,26.047,0.0],[44.481,26.044,0.0],[44.442,26.142,0.0],[44.431,26.108,0.0],[44.448,26.119,0.0],[44.445,26.116,0.0],[44.444,26.091,0.0],[44.441,26.166,0.0],[44.438,26.139,0.0],[44.45,26.122,0.0],[44.445,26.124,0.0],[44.434,26.115,0.0],[44.442,26.103,0.0],[44.442,26.112,0.0],[44.434,26.087,0.0],[44.434,26.088,0.0],[44.434,26.09,0.0],[44.416,26.13,0.0],[44.407,26.091,0.0],[44.406,26.093,0.0],[44.406,26.091,0.0],[44.456,26.099,0.0],[44.444,26.006,0.0],[44.444,26.07,0.0],[44.442,26.067,0.0],[44.492,26.082,0.0],[44.492,26.079,0.0],[44.492,26.084,0.0],[44.484,26.038,0.0],[44.484,26.04,0.0],[44.48,26.041,0.0],[44.394,26.096,0.0],[44.395,26.094,0.0],[44.395,26.096,0.0],[44.386,26.09,0.0],[44.389,26.091,0.0],[44.386,26.091,0.0],[44.385,26.09,0.0],[44.434,26.097,0.0],[44.425,26.069,0.0],[44.427,26.067,0.0],[44.425,26.07,0.0],[44.424,26.07,0.0],[44.424,26.072,0.0],[44.422,26.072,0.0],[44.424,26.084,0.0],[44.424,26.082,0.0],[44.406,26.078,0.0],[44.406,26.079,0.0],[44.404,26.081,0.0],[44.462,26.096,0.0],[44.442,26.088,0.0],[44.436,26.088,0.0],[44.444,26.075,0.0],[44.388,26.139,0.0],[44.427,26.118,0.0],[44.407,26.085,0.0],[44.406,26.087,0.0],[44.45,26.093,0.0],[44.45,26.091,0.0],[44.409,26.088,0.0],[44.403,26.087,0.0],[44.407,26.201,0.0],[44.43,26.175,0.0],[44.427,26.187,0.0],[44.45,26.088,0.0],[44.434,26.11,0.0],[44.436,26.094,0.0],[44.451,26.145,0.0],[44.445,26.145,0.0],[44.442,26.125,0.0],[44.442,26.124,0.0],[44.445,26.134,0.0],[44.436,26.109,0.0],[44.412,26.108,0.0],[44.413,26.106,0.0],[44.41,26.11,0.0],[44.409,26.118,0.0],[44.41,26.118,0.0],[44.422,26.109,0.0],[44.441,26.015,0.0],[44.439,26.115,0.0],[44.433,26.131,0.0],[44.448,26.115,0.0],[44.427,26.124,0.0],[44.442,26.093,0.0],[44.445,26.087,0.0],[44.444,26.112,0.0],[44.445,26.085,0.0],[44.438,26.112,0.0],[44.442,26.115,0.0],[44.484,26.09,0.0],[44.441,26.081,0.0],[44.427,26.122,0.0],[44.392,26.103,0.0],[44.397,26.109,0.0],[44.389,26.105,0.0],[44.434,26.108,0.0],[44.453,26.121,0.0],[44.483,25.979,0.0],[44.427,26.113,0.0],[44.428,26.094,0.0],[44.439,26.16,0.0],[44.436,26.172,0.0],[44.391,26.124,0.0],[44.433,26.128,0.0],[44.474,26.061,0.0],[44.472,26.061,0.0],[44.428,26.067,0.0],[44.444,26.105,0.0],[44.478,26.062,0.0],[44.409,26.127,0.0],[44.41,26.128,0.0],[44.418,26.079,0.0],[44.424,26.128,0.0],[44.444,26.13,0.0],[44.415,26.136,0.0],[44.45,26.124,0.0],[44.448,26.087,0.0],[44.4,26.116,0.0],[44.466,26.118,0.0],[44.404,25.994,0.0],[44.404,25.991,0.0],[44.397,26.113,0.0],[44.371,25.977,0.0],[44.37,25.977,0.0],[44.37,25.973,0.0],[44.394,26.026,0.0],[44.412,26.13,0.0],[44.352,26.029,0.0],[44.389,26.119,0.0],[44.495,26.09,0.0],[44.41,26.121,0.0],[44.49,26.125,0.0],[44.376,26.122,0.0],[44.441,26.022,0.0],[44.416,26.103,0.0],[44.444,25.959,0.0],[44.433,25.956,0.0],[44.447,25.965,0.0],[44.404,26.093,0.0],[44.385,26.146,0.0],[44.413,26.115,0.0],[44.439,26.04,0.0],[44.466,26.047,0.0],[44.468,26.046,0.0],[44.447,26.169,0.0],[44.412,26.007,0.0],[44.529,26.186,0.0],[44.492,26.088,0.0],[44.471,26.072,0.0],[44.538,26.136,0.0],[44.531,26.162,0.0],[44.358,26.091,0.0],[44.483,26.109,0.0],[44.421,26.004,0.0],[44.389,26.202,0.0],[44.531,26.145,0.0],[44.442,25.985,0.0],[44.444,25.985,0.0],[44.469,26.171,0.0],[44.376,26.102,0.0],[44.406,26.137,0.0],[44.407,26.137,0.0],[44.436,26.18,0.0],[44.474,26.181,0.0],[44.428,26.184,0.0],[44.422,26.064,0.0],[44.422,26.097,0.0],[44.477,26.029,0.0],[44.431,26.072,0.0],[44.43,25.976,0.0],[44.442,26.113,0.0],[44.431,26.214,0.0],[44.376,26.121,0.0],[44.398,26.163,0.0],[44.388,26.061,0.0],[44.454,26.116,0.0],[44.35,26.047,0.0],[44.436,26.193,0.0],[44.439,26.195,0.0],[44.436,26.192,0.0],[44.436,26.175,0.0],[44.428,25.992,0.0],[44.436,25.989,0.0],[44.457,26.038,0.0],[44.478,26.043,0.0],[44.406,26.181,0.0],[44.468,26.091,0.0],[44.374,26.116,0.0],[44.477,26.102,0.0],[44.388,26.122,0.0],[44.389,26.121,0.0],[44.472,26.106,0.0],[44.456,26.125,0.0],[44.376,26.108,0.0],[44.448,26.061,0.0],[44.431,26.041,0.0],[44.427,26.076,0.0],[44.448,26.079,0.0],[44.45,26.079,0.0],[44.376,26.124,0.0],[44.368,25.971,0.0],[44.548,26.07,0.0],[44.401,26.116,0.0],[44.481,26.043,0.0],[44.359,26.09,0.0],[44.347,26.085,0.0],[44.415,26.122,0.0],[44.374,26.122,0.0],[44.367,25.97,0.0],[44.526,26.037,0.0],[44.529,26.044,0.0],[44.526,26.035,0.0],[44.407,26.186,0.0],[44.407,26.187,0.0],[44.346,26.178,0.0],[44.34,26.155,0.0],[44.364,26.019,0.0],[44.362,26.023,0.0],[44.364,26.192,0.0],[44.362,26.193,0.0],[44.439,26.058,0.0],[44.359,26.028,0.0],[44.51,26.069,0.0],[44.412,26.157,0.0],[44.376,26.046,0.0],[44.395,26.099,0.0],[44.412,26.087,0.0],[44.519,26.181,0.0],[44.52,26.184,0.0],[44.522,26.184,0.0],[44.37,26.183,0.0],[44.419,26.079,0.0],[44.474,26.07,0.0],[44.358,26.137,0.0],[44.342,26.157,0.0],[44.344,26.037,0.0],[44.38,26.143,0.0],[44.38,26.145,0.0],[44.385,26.145,0.0],[44.379,26.163,0.0],[44.466,26.159,0.0],[44.504,26.211,0.0],[44.376,26.146,0.0],[44.481,26.118,0.0],[44.416,26.119,0.0],[44.427,26.184,0.0],[44.431,26.195,0.0],[44.434,26.181,0.0],[44.531,26.058,0.0],[44.368,25.976,0.0],[44.522,25.962,0.0],[44.507,26.215,0.0],[44.508,26.215,0.0],[44.37,26.154,0.0],[44.413,26.082,0.0],[44.409,26.119,0.0],[44.507,25.986,0.0],[44.368,26.154,0.0],[44.499,26.07,0.0],[44.395,26.032,0.0],[44.434,25.966,0.0],[44.368,26.186,0.0],[44.395,25.976,0.0],[44.395,25.982,0.0],[44.406,25.973,0.0],[44.4,25.979,0.0],[44.469,26.05,0.0],[44.43,26.14,0.0],[44.447,26.202,0.0],[44.492,26.118,0.0],[44.398,25.976,0.0],[44.386,26.062,0.0],[44.365,26.152,0.0],[44.388,25.979,0.0],[44.395,26.026,0.0],[44.403,26.009,0.0],[44.469,26.023,0.0],[44.49,26.214,0.0],[44.502,26.006,0.0],[44.371,26.151,0.0],[44.371,26.149,0.0],[44.37,26.149,0.0],[44.376,26.152,0.0],[44.374,26.151,0.0],[44.37,26.146,0.0],[44.373,26.152,0.0],[44.367,26.152,0.0],[44.376,26.151,0.0],[44.374,26.155,0.0],[44.374,26.154,0.0],[44.371,26.155,0.0],[44.373,26.149,0.0],[44.38,26.139,0.0],[44.45,26.203,0.0],[44.419,26.076,0.0],[44.45,26.202,0.0],[44.368,26.155,0.0],[44.367,26.154,0.0],[44.371,26.139,0.0],[44.447,25.983,0.0],[44.416,26.099,0.0],[44.416,26.189,0.0],[44.425,26.062,0.0],[44.388,26.064,0.0],[44.371,26.128,0.0],[44.441,26.16,0.0],[44.364,26.151,0.0],[44.37,26.157,0.0],[44.371,26.177,0.0],[44.409,26.211,0.0],[44.404,26.166,0.0],[44.407,26.162,0.0],[44.465,26.175,0.0],[44.469,26.172,0.0],[44.526,26.192,0.0],[44.525,26.196,0.0],[44.383,25.989,0.0],[44.428,26.028,0.0],[44.367,25.968,0.0],[44.367,25.966,0.0],[44.418,26.085,0.0],[44.404,26.02,0.0],[44.386,26.13,0.0],[44.493,25.97,0.0],[44.37,26.124,0.0],[44.37,26.136,0.0],[44.361,26.151,0.0],[44.478,26.137,0.0],[44.377,26.127,0.0],[44.361,26.093,0.0],[44.358,26.096,0.0],[44.511,26.02,0.0],[44.523,26.009,0.0],[44.454,25.988,0.0],[44.454,25.986,0.0],[44.457,25.998,0.0],[44.457,26.0,0.0],[44.448,26.0,0.0],[44.541,26.079,0.0],[44.542,26.085,0.0],[44.37,26.13,0.0],[44.428,26.016,0.0],[44.43,26.066,0.0],[44.35,26.091,0.0],[44.475,25.979,0.0],[44.538,26.171,0.0],[44.536,26.169,0.0],[44.501,26.07,0.0],[44.522,26.017,0.0],[44.52,26.019,0.0],[44.487,26.062,0.0],[44.489,26.062,0.0],[44.522,26.193,0.0],[44.481,26.108,0.0],[44.463,26.061,0.0],[44.456,25.97,0.0],[44.457,26.159,0.0],[44.459,26.159,0.0],[44.457,26.157,0.0],[44.533,26.001,0.0],[44.487,26.064,0.0],[44.418,26.076,0.0],[44.388,26.025,0.0],[44.383,26.004,0.0],[44.41,26.199,0.0],[44.409,26.19,0.0],[44.409,26.151,0.0],[44.451,26.073,0.0],[44.404,26.189,0.0],[44.447,26.081,0.0],[44.542,26.096,0.0],[44.445,26.205,0.0],[44.492,26.119,0.0],[44.453,26.122,0.0],[44.413,25.97,0.0],[44.413,25.971,0.0],[44.376,26.004,0.0],[44.403,25.977,0.0],[44.504,26.023,0.0],[44.43,26.106,0.0],[44.514,26.019,0.0],[44.433,26.041,0.0],[44.421,26.195,0.0],[44.444,26.043,0.0],[44.445,26.023,0.0],[44.444,25.973,0.0],[44.448,25.991,0.0],[44.493,26.122,0.0],[44.484,26.113,0.0],[44.415,26.192,0.0],[44.413,26.193,0.0],[44.415,26.035,0.0],[44.466,26.145,0.0],[44.409,26.198,0.0],[44.539,26.172,0.0],[44.539,26.169,0.0],[44.403,26.206,0.0],[44.438,25.989,0.0],[44.388,25.989,0.0],[44.441,26.184,0.0],[44.361,26.136,0.0],[44.361,26.134,0.0],[44.504,25.966,0.0],[44.469,26.18,0.0],[44.468,26.177,0.0],[44.474,26.175,0.0],[44.541,26.169,0.0],[44.495,26.119,0.0],[44.495,26.122,0.0],[44.478,26.121,0.0],[44.489,26.096,0.0],[44.412,26.199,0.0],[44.526,26.186,0.0],[44.525,26.199,0.0],[44.526,26.196,0.0],[44.359,26.134,0.0],[44.38,26.183,0.0],[44.416,26.1,0.0],[44.376,26.187,0.0],[44.466,26.052,0.0],[44.365,26.155,0.0],[44.365,26.157,0.0],[44.365,26.004,0.0],[44.489,26.19,0.0],[44.493,26.151,0.0],[44.401,26.154,0.0],[44.364,26.196,0.0],[44.37,26.199,0.0],[44.367,26.199,0.0],[44.362,26.181,0.0],[44.368,26.122,0.0],[44.474,26.067,0.0],[44.459,26.0,0.0],[44.412,26.201,0.0],[44.434,26.175,0.0],[44.433,25.957,0.0],[44.504,26.208,0.0],[44.531,26.047,0.0],[44.406,26.05,0.0],[44.406,26.047,0.0],[44.483,26.166,0.0],[44.495,26.189,0.0],[44.504,26.212,0.0],[44.465,26.208,0.0],[44.463,26.208,0.0],[44.481,26.058,0.0],[44.481,26.059,0.0],[44.498,26.169,0.0],[44.538,26.169,0.0],[44.459,26.175,0.0],[44.373,26.19,0.0],[44.529,26.143,0.0],[44.454,26.118,0.0],[44.498,25.966,0.0],[44.477,25.979,0.0],[44.528,25.953,0.0],[44.472,26.174,0.0],[44.352,26.192,0.0],[44.544,26.105,0.0],[44.447,25.96,0.0],[44.474,26.183,0.0],[44.477,26.195,0.0],[44.499,26.217,0.0],[44.499,26.215,0.0],[44.496,26.218,0.0],[44.465,26.183,0.0],[44.475,26.184,0.0],[44.388,26.003,0.0],[44.489,26.121,0.0],[44.376,26.189,0.0],[44.383,26.102,0.0],[44.442,26.097,0.0],[44.445,26.062,0.0],[44.379,26.136,0.0],[44.457,26.09,0.0],[44.472,26.07,0.0],[44.434,26.142,0.0],[44.507,26.085,0.0],[44.499,26.072,0.0],[44.425,26.178,0.0],[44.421,26.017,0.0],[44.413,26.02,0.0],[44.413,26.015,0.0],[44.415,26.019,0.0],[44.416,26.019,0.0],[44.416,26.02,0.0],[44.412,26.019,0.0],[44.416,26.017,0.0],[44.421,26.013,0.0],[44.419,26.016,0.0],[44.484,26.099,0.0],[44.442,26.072,0.0],[44.424,26.013,0.0],[44.424,26.034,0.0],[44.487,26.093,0.0],[44.477,26.076,0.0],[44.477,26.091,0.0],[44.465,26.106,0.0],[44.454,26.112,0.0],[44.495,26.085,0.0],[44.496,26.082,0.0],[44.487,26.094,0.0],[44.483,26.1,0.0],[44.463,26.127,0.0],[44.483,26.094,0.0],[44.481,26.1,0.0],[44.462,26.122,0.0],[44.463,26.122,0.0],[44.463,26.125,0.0],[44.454,26.127,0.0],[44.454,26.125,0.0],[44.453,26.118,0.0],[44.453,26.116,0.0],[44.453,26.115,0.0],[44.453,26.11,0.0],[44.453,26.108,0.0],[44.457,26.106,0.0],[44.457,26.113,0.0],[44.46,26.112,0.0],[44.462,26.119,0.0],[44.463,26.121,0.0],[44.428,26.142,0.0],[44.428,26.143,0.0],[44.43,26.145,0.0],[44.444,26.159,0.0],[44.444,26.16,0.0],[44.444,26.163,0.0],[44.445,26.16,0.0],[44.424,26.139,0.0],[44.463,26.115,0.0],[44.465,26.113,0.0],[44.463,26.113,0.0],[44.453,26.106,0.0],[44.453,26.109,0.0],[44.451,26.118,0.0],[44.43,26.149,0.0],[44.428,26.148,0.0],[44.431,26.154,0.0],[44.431,26.145,0.0],[44.431,26.143,0.0],[44.431,26.155,0.0],[44.43,26.159,0.0],[44.431,26.162,0.0],[44.431,26.163,0.0],[44.433,26.162,0.0],[44.431,26.157,0.0],[44.434,26.159,0.0],[44.436,26.163,0.0],[44.436,26.168,0.0],[44.434,26.166,0.0],[44.433,26.165,0.0],[44.434,26.165,0.0],[44.434,26.168,0.0],[44.434,26.163,0.0],[44.431,26.171,0.0],[44.43,26.171,0.0],[44.428,26.171,0.0],[44.433,26.172,0.0],[44.433,26.171,0.0],[44.434,26.172,0.0],[44.436,26.171,0.0],[44.419,26.142,0.0],[44.421,26.14,0.0],[44.481,26.097,0.0],[44.422,26.016,0.0],[44.441,26.175,0.0],[44.427,26.053,0.0],[44.474,26.058,0.0],[44.454,26.043,0.0],[44.424,26.017,0.0],[44.419,26.131,0.0],[44.418,26.133,0.0],[44.415,26.031,0.0],[44.416,26.034,0.0],[44.413,26.031,0.0],[44.413,26.026,0.0],[44.413,26.028,0.0],[44.418,26.028,0.0],[44.418,26.026,0.0],[44.419,26.023,0.0],[44.421,26.028,0.0],[44.422,26.026,0.0],[44.422,26.025,0.0],[44.421,26.025,0.0],[44.427,26.043,0.0],[44.425,26.041,0.0],[44.424,26.043,0.0],[44.427,26.049,0.0],[44.421,26.04,0.0],[44.422,26.04,0.0],[44.468,26.142,0.0],[44.466,26.151,0.0],[44.454,26.145,0.0],[44.454,26.148,0.0],[44.454,26.146,0.0],[44.45,26.148,0.0],[44.451,26.146,0.0],[44.46,26.134,0.0],[44.457,26.139,0.0],[44.447,26.133,0.0],[44.447,26.134,0.0],[44.448,26.137,0.0],[44.445,26.142,0.0],[44.444,26.165,0.0],[44.442,26.172,0.0],[44.441,26.178,0.0],[44.498,26.072,0.0],[44.538,26.131,0.0],[44.466,26.103,0.0],[44.441,26.084,0.0],[44.439,26.085,0.0],[44.438,26.085,0.0],[44.438,26.087,0.0],[44.438,26.088,0.0],[44.436,26.085,0.0],[44.441,26.087,0.0],[44.439,26.087,0.0],[44.466,26.105,0.0],[44.466,26.106,0.0],[44.466,26.108,0.0],[44.465,26.102,0.0],[44.465,26.105,0.0],[44.463,26.106,0.0],[44.463,26.108,0.0],[44.478,26.09,0.0],[44.451,26.046,0.0],[44.493,26.081,0.0],[44.481,26.121,0.0],[44.424,26.091,0.0],[44.427,26.094,0.0],[44.484,26.1,0.0],[44.415,26.177,0.0],[44.424,26.133,0.0],[44.422,26.134,0.0],[44.483,26.049,0.0],[44.483,26.046,0.0],[44.484,26.055,0.0],[44.481,26.049,0.0],[44.484,26.043,0.0],[44.416,26.152,0.0],[44.415,26.152,0.0],[44.444,26.139,0.0],[44.442,26.139,0.0],[44.441,26.133,0.0],[44.424,26.168,0.0],[44.424,26.166,0.0],[44.422,26.171,0.0],[44.424,26.165,0.0],[44.425,26.166,0.0],[44.421,26.175,0.0],[44.453,26.09,0.0],[44.483,26.043,0.0],[44.483,26.041,0.0],[44.385,26.1,0.0],[44.388,26.106,0.0],[44.483,26.099,0.0],[44.412,26.163,0.0],[44.415,26.16,0.0],[44.412,26.162,0.0],[44.413,26.162,0.0],[44.416,26.177,0.0],[44.43,26.162,0.0],[44.413,26.155,0.0],[44.413,26.159,0.0],[44.413,26.16,0.0],[44.453,26.076,0.0],[44.416,26.16,0.0],[44.415,26.166,0.0],[44.416,26.168,0.0],[44.416,26.148,0.0],[44.416,26.146,0.0],[44.418,26.143,0.0],[44.421,26.136,0.0],[44.416,26.143,0.0],[44.431,26.16,0.0],[44.43,26.166,0.0],[44.406,26.146,0.0],[44.407,26.145,0.0],[44.412,26.169,0.0],[44.409,26.171,0.0],[44.409,26.166,0.0],[44.412,26.154,0.0],[44.412,26.151,0.0],[44.415,26.157,0.0],[44.415,26.145,0.0],[44.415,26.143,0.0],[44.41,26.178,0.0],[44.41,26.175,0.0],[44.41,26.177,0.0],[44.413,26.171,0.0],[44.413,26.178,0.0],[44.412,26.178,0.0],[44.409,26.175,0.0],[44.43,26.139,0.0],[44.41,26.082,0.0],[44.416,26.178,0.0],[44.419,26.175,0.0],[44.419,26.174,0.0],[44.424,26.178,0.0],[44.406,26.172,0.0],[44.407,26.172,0.0],[44.422,26.174,0.0],[44.421,26.172,0.0],[44.409,26.165,0.0],[44.442,26.119,0.0],[44.404,26.058,0.0],[44.406,26.058,0.0],[44.422,26.067,0.0],[44.424,26.062,0.0],[44.419,26.059,0.0],[44.395,26.069,0.0],[44.389,26.078,0.0],[44.392,26.075,0.0],[44.388,26.085,0.0],[44.386,26.087,0.0],[44.386,26.085,0.0],[44.389,26.085,0.0],[44.391,26.084,0.0],[44.391,26.085,0.0],[44.416,26.105,0.0],[44.415,26.172,0.0],[44.454,26.097,0.0],[44.48,26.094,0.0],[44.483,26.097,0.0],[44.413,26.184,0.0],[44.413,26.183,0.0],[44.412,26.18,0.0],[44.415,26.184,0.0],[44.415,26.178,0.0],[44.419,26.181,0.0],[44.407,26.175,0.0],[44.406,26.175,0.0],[44.407,26.178,0.0],[44.404,26.175,0.0],[44.404,26.177,0.0],[44.404,26.178,0.0],[44.409,26.178,0.0],[44.463,26.097,0.0],[44.453,26.091,0.0],[44.453,26.093,0.0],[44.412,26.084,0.0],[44.438,26.134,0.0],[44.436,26.136,0.0],[44.431,26.137,0.0],[44.433,26.137,0.0],[44.416,26.137,0.0],[44.419,26.13,0.0],[44.422,26.125,0.0],[44.427,26.131,0.0],[44.444,26.088,0.0],[44.419,26.108,0.0],[44.424,26.103,0.0],[44.433,26.106,0.0],[44.439,26.121,0.0],[44.445,26.091,0.0],[44.439,26.116,0.0],[44.447,26.094,0.0],[44.418,26.166,0.0],[44.477,26.151,0.0],[44.427,26.165,0.0],[44.428,26.175,0.0],[44.428,26.177,0.0],[44.427,26.175,0.0],[44.45,26.105,0.0],[44.41,26.142,0.0],[44.413,26.145,0.0],[44.448,26.073,0.0],[44.448,26.093,0.0],[44.416,26.102,0.0],[44.385,26.085,0.0],[44.392,26.115,0.0],[44.392,26.116,0.0],[44.394,26.115,0.0],[44.392,26.119,0.0],[44.391,26.118,0.0],[44.434,26.109,0.0],[44.472,26.134,0.0],[44.421,26.087,0.0],[44.407,26.073,0.0],[44.418,26.165,0.0],[44.427,26.108,0.0],[44.431,26.112,0.0],[44.436,26.113,0.0],[44.439,26.131,0.0],[44.415,26.07,0.0],[44.427,26.127,0.0],[44.431,26.13,0.0],[44.425,26.127,0.0],[44.425,26.119,0.0],[44.425,26.122,0.0],[44.427,26.119,0.0],[44.43,26.112,0.0],[44.431,26.133,0.0],[44.433,26.119,0.0],[44.445,26.122,0.0],[44.447,26.124,0.0],[44.447,26.115,0.0],[44.439,26.11,0.0],[44.439,26.112,0.0],[44.421,26.119,0.0],[44.441,26.159,0.0],[44.422,26.07,0.0],[44.415,26.093,0.0],[44.409,26.096,0.0],[44.421,26.09,0.0],[44.416,26.14,0.0],[44.412,26.139,0.0],[44.392,26.112,0.0],[44.392,26.113,0.0],[44.397,26.11,0.0],[44.392,26.11,0.0],[44.395,26.11,0.0],[44.395,26.109,0.0],[44.394,26.109,0.0],[44.398,26.103,0.0],[44.391,26.109,0.0],[44.383,26.109,0.0],[44.386,26.108,0.0],[44.385,26.109,0.0],[44.385,26.106,0.0],[44.388,26.108,0.0],[44.383,26.105,0.0],[44.386,26.106,0.0],[44.383,26.108,0.0],[44.388,26.102,0.0],[44.386,26.099,0.0],[44.386,26.102,0.0],[44.388,26.1,0.0],[44.379,26.096,0.0],[44.386,26.096,0.0],[44.386,26.094,0.0],[44.38,26.094,0.0],[44.382,26.093,0.0],[44.383,26.093,0.0],[44.385,26.094,0.0],[44.453,26.102,0.0],[44.453,26.103,0.0],[44.453,26.099,0.0],[44.454,26.1,0.0],[44.419,26.169,0.0],[44.38,26.099,0.0],[44.379,26.099,0.0],[44.38,26.103,0.0],[44.379,26.105,0.0],[44.38,26.105,0.0],[44.382,26.1,0.0],[44.382,26.105,0.0],[44.382,26.103,0.0],[44.382,26.102,0.0],[44.38,26.108,0.0],[44.377,26.1,0.0],[44.379,26.113,0.0],[44.385,26.11,0.0],[44.376,26.113,0.0],[44.377,26.118,0.0],[44.383,26.121,0.0],[44.385,26.118,0.0],[44.385,26.122,0.0],[44.38,26.122,0.0],[44.383,26.124,0.0],[44.382,26.122,0.0],[44.383,26.125,0.0],[44.382,26.127,0.0],[44.388,26.127,0.0],[44.383,26.131,0.0],[44.38,26.136,0.0],[44.392,26.13,0.0],[44.391,26.13,0.0],[44.389,26.134,0.0],[44.389,26.133,0.0],[44.391,26.131,0.0],[44.394,26.128,0.0],[44.484,26.088,0.0],[44.486,26.088,0.0],[44.486,26.097,0.0],[44.486,26.093,0.0],[44.445,26.165,0.0],[44.438,26.155,0.0],[44.471,26.041,0.0],[44.468,26.049,0.0],[44.472,26.031,0.0],[44.477,26.01,0.0],[44.484,26.116,0.0],[44.48,26.178,0.0],[44.478,26.178,0.0],[44.477,26.177,0.0],[44.477,26.174,0.0],[44.48,26.18,0.0],[44.46,26.056,0.0],[44.463,26.052,0.0],[44.46,26.055,0.0],[44.49,26.034,0.0],[44.499,26.022,0.0],[44.499,26.02,0.0],[44.489,26.02,0.0],[44.441,26.058,0.0],[44.442,26.059,0.0],[44.486,26.032,0.0],[44.484,26.034,0.0],[44.484,26.053,0.0],[44.419,26.013,0.0],[44.445,26.131,0.0],[44.441,26.125,0.0],[44.447,26.078,0.0],[44.422,26.09,0.0],[44.439,26.094,0.0],[44.436,26.013,0.0],[44.438,26.013,0.0],[44.434,26.094,0.0],[44.438,26.105,0.0],[44.438,26.11,0.0],[44.436,26.108,0.0],[44.412,26.142,0.0],[44.41,26.146,0.0],[44.412,26.149,0.0],[44.415,26.133,0.0],[44.45,26.09,0.0],[44.428,26.166,0.0],[44.495,26.134,0.0],[44.412,26.186,0.0],[44.462,26.106,0.0],[44.46,26.108,0.0],[44.442,26.017,0.0],[44.439,26.016,0.0],[44.434,25.998,0.0],[44.436,25.998,0.0],[44.436,26.006,0.0],[44.431,26.001,0.0],[44.416,26.049,0.0],[44.419,26.041,0.0],[44.418,26.037,0.0],[44.421,26.044,0.0],[44.424,26.049,0.0],[44.454,26.046,0.0],[44.457,26.043,0.0],[44.459,26.041,0.0],[44.462,26.04,0.0],[44.462,26.041,0.0],[44.463,26.041,0.0],[44.462,26.043,0.0],[44.463,26.043,0.0],[44.457,26.052,0.0],[44.419,26.113,0.0],[44.422,26.121,0.0],[44.419,26.122,0.0],[44.419,26.124,0.0],[44.416,26.121,0.0],[44.415,26.128,0.0],[44.418,26.125,0.0],[44.418,26.127,0.0],[44.456,26.044,0.0],[44.416,26.125,0.0],[44.415,26.125,0.0],[44.413,26.124,0.0],[44.418,26.131,0.0],[44.419,26.134,0.0],[44.413,26.075,0.0],[44.416,26.076,0.0],[44.416,26.075,0.0],[44.416,26.078,0.0],[44.416,26.082,0.0],[44.41,26.079,0.0],[44.407,26.064,0.0],[44.406,26.07,0.0],[44.412,26.064,0.0],[44.412,26.061,0.0],[44.413,26.073,0.0],[44.406,26.072,0.0],[44.401,26.088,0.0],[44.413,26.078,0.0],[44.41,26.078,0.0],[44.407,26.079,0.0],[44.412,26.079,0.0],[44.413,26.079,0.0],[44.407,26.081,0.0],[44.407,26.082,0.0],[44.409,26.081,0.0],[44.404,26.073,0.0],[44.404,26.072,0.0],[44.403,26.075,0.0],[44.404,26.059,0.0],[44.406,26.055,0.0],[44.406,26.056,0.0],[44.406,26.053,0.0],[44.419,26.067,0.0],[44.419,26.07,0.0],[44.394,26.067,0.0],[44.394,26.069,0.0],[44.433,26.094,0.0],[44.431,26.097,0.0],[44.4,26.053,0.0],[44.424,26.181,0.0],[44.425,26.18,0.0],[44.419,26.064,0.0],[44.434,26.017,0.0],[44.434,26.016,0.0],[44.434,26.013,0.0],[44.434,26.015,0.0],[44.441,26.025,0.0],[44.434,26.023,0.0],[44.436,26.028,0.0],[44.438,26.029,0.0],[44.434,26.032,0.0],[44.436,26.034,0.0],[44.438,26.015,0.0],[44.442,26.013,0.0],[44.436,26.015,0.0],[44.434,26.038,0.0],[44.438,26.037,0.0],[44.436,26.044,0.0],[44.436,26.043,0.0],[44.433,26.037,0.0],[44.434,26.035,0.0],[44.441,26.172,0.0],[44.442,26.175,0.0],[44.444,26.172,0.0],[44.445,26.168,0.0],[44.442,26.177,0.0],[44.433,26.168,0.0],[44.438,26.174,0.0],[44.433,26.026,0.0],[44.434,26.029,0.0],[44.431,26.023,0.0],[44.433,26.019,0.0],[44.43,26.016,0.0],[44.43,26.017,0.0],[44.43,26.023,0.0],[44.431,26.026,0.0],[44.431,26.007,0.0],[44.433,26.007,0.0],[44.444,26.031,0.0],[44.442,26.031,0.0],[44.441,26.032,0.0],[44.441,26.031,0.0],[44.439,26.032,0.0],[44.441,26.029,0.0],[44.441,26.035,0.0],[44.439,26.034,0.0],[44.433,26.031,0.0],[44.441,26.183,0.0],[44.442,26.183,0.0],[44.457,26.055,0.0],[44.453,26.043,0.0],[44.453,26.053,0.0],[44.454,26.055,0.0],[44.453,26.055,0.0],[44.447,26.052,0.0],[44.448,26.05,0.0],[44.447,26.058,0.0],[44.447,26.059,0.0],[44.447,26.055,0.0],[44.444,26.058,0.0],[44.421,26.163,0.0],[44.424,26.172,0.0],[44.453,26.049,0.0],[44.451,26.049,0.0],[44.433,25.989,0.0],[44.433,25.988,0.0],[44.431,25.988,0.0],[44.419,26.046,0.0],[44.416,26.05,0.0],[44.43,26.169,0.0],[44.425,26.019,0.0],[44.425,26.017,0.0],[44.427,26.171,0.0],[44.424,26.177,0.0],[44.424,26.142,0.0],[44.43,26.082,0.0],[44.43,26.131,0.0],[44.43,26.128,0.0],[44.43,26.121,0.0],[44.419,26.019,0.0],[44.415,26.025,0.0],[44.415,26.028,0.0],[44.418,26.032,0.0],[44.425,26.032,0.0],[44.425,26.029,0.0],[44.425,26.035,0.0],[44.427,26.044,0.0],[44.428,26.05,0.0],[44.422,26.047,0.0],[44.421,26.046,0.0],[44.419,26.049,0.0],[44.457,26.061,0.0],[44.457,26.066,0.0],[44.456,26.066,0.0],[44.459,26.067,0.0],[44.457,26.067,0.0],[44.459,26.07,0.0],[44.462,26.07,0.0],[44.456,26.076,0.0],[44.454,26.075,0.0],[44.456,26.081,0.0],[44.453,26.082,0.0],[44.451,26.082,0.0],[44.451,26.079,0.0],[44.453,26.078,0.0],[44.45,26.073,0.0],[44.448,26.075,0.0],[44.447,26.076,0.0],[44.445,26.075,0.0],[44.451,26.069,0.0],[44.466,26.056,0.0],[44.469,26.059,0.0],[44.469,26.058,0.0],[44.465,26.055,0.0],[44.465,26.056,0.0],[44.468,26.056,0.0],[44.463,26.056,0.0],[44.471,26.052,0.0],[44.469,26.055,0.0],[44.471,26.056,0.0],[44.466,26.066,0.0],[44.466,26.067,0.0],[44.466,26.07,0.0],[44.465,26.072,0.0],[44.465,26.07,0.0],[44.463,26.07,0.0],[44.465,26.075,0.0],[44.409,26.137,0.0],[44.434,26.093,0.0],[44.418,26.184,0.0],[44.475,26.052,0.0],[44.422,26.172,0.0],[44.439,26.006,0.0],[44.439,26.004,0.0],[44.441,26.006,0.0],[44.439,26.007,0.0],[44.438,26.007,0.0],[44.438,26.009,0.0],[44.439,26.003,0.0],[44.439,26.01,0.0],[44.427,26.106,0.0],[44.431,26.127,0.0],[44.462,26.099,0.0],[44.445,26.137,0.0],[44.45,26.055,0.0],[44.45,26.049,0.0],[44.445,26.133,0.0],[44.442,26.166,0.0],[44.46,26.078,0.0],[44.459,26.079,0.0],[44.457,26.081,0.0],[44.431,26.07,0.0],[44.433,26.069,0.0],[44.431,26.069,0.0],[44.385,26.124,0.0],[44.376,26.131,0.0],[44.388,26.124,0.0],[44.385,26.127,0.0],[44.448,26.109,0.0],[44.469,26.152,0.0],[44.496,26.178,0.0],[44.448,26.103,0.0],[44.447,26.102,0.0],[44.45,26.1,0.0],[44.441,26.096,0.0],[44.48,26.047,0.0],[44.478,26.049,0.0],[44.434,26.125,0.0],[44.438,26.124,0.0],[44.439,26.122,0.0],[44.436,26.124,0.0],[44.441,26.127,0.0],[44.439,26.127,0.0],[44.439,26.125,0.0],[44.441,26.149,0.0],[44.442,26.14,0.0],[44.447,26.119,0.0],[44.448,26.118,0.0],[44.444,26.099,0.0],[44.463,26.076,0.0],[44.463,26.078,0.0],[44.468,26.076,0.0],[44.465,26.078,0.0],[44.434,26.162,0.0],[44.439,26.143,0.0],[44.438,26.14,0.0],[44.436,26.142,0.0],[44.441,26.11,0.0],[44.439,26.109,0.0],[44.447,26.106,0.0],[44.436,26.119,0.0],[44.436,26.115,0.0],[44.445,26.108,0.0],[44.441,26.109,0.0],[44.442,26.025,0.0],[44.431,26.116,0.0],[44.428,26.116,0.0],[44.428,26.118,0.0],[44.439,26.108,0.0],[44.436,26.122,0.0],[44.438,26.121,0.0],[44.43,26.115,0.0],[44.425,26.1,0.0],[44.456,26.058,0.0],[44.439,26.174,0.0],[44.442,26.106,0.0],[44.442,26.108,0.0],[44.442,26.105,0.0],[44.441,26.106,0.0],[44.442,26.109,0.0],[44.447,26.029,0.0],[44.466,26.093,0.0],[44.466,26.091,0.0],[44.406,26.09,0.0],[44.438,26.099,0.0],[44.456,26.097,0.0],[44.445,26.064,0.0],[44.442,26.066,0.0],[44.442,26.069,0.0],[44.493,26.082,0.0],[44.492,26.081,0.0],[44.49,26.084,0.0],[44.49,26.082,0.0],[44.49,26.085,0.0],[44.493,26.085,0.0],[44.495,26.078,0.0],[44.496,26.076,0.0],[44.418,26.116,0.0],[44.487,26.04,0.0],[44.487,26.037,0.0],[44.391,26.096,0.0],[44.451,26.106,0.0],[44.451,26.108,0.0],[44.428,26.096,0.0],[44.392,26.079,0.0],[44.392,26.081,0.0],[44.462,26.113,0.0],[44.46,26.118,0.0],[44.391,26.078,0.0],[44.388,26.075,0.0],[44.389,26.075,0.0],[44.391,26.075,0.0],[44.391,26.073,0.0],[44.392,26.073,0.0],[44.389,26.084,0.0],[44.392,26.082,0.0],[44.438,26.069,0.0],[44.436,26.069,0.0],[44.436,26.07,0.0],[44.43,26.069,0.0],[44.424,26.069,0.0],[44.422,26.073,0.0],[44.424,26.076,0.0],[44.424,26.078,0.0],[44.403,26.081,0.0],[44.404,26.078,0.0],[44.404,26.079,0.0],[44.404,26.085,0.0],[44.421,26.066,0.0],[44.465,26.1,0.0],[44.462,26.097,0.0],[44.442,26.09,0.0],[44.427,26.112,0.0],[44.433,26.082,0.0],[44.456,26.136,0.0],[44.457,26.134,0.0],[44.442,26.075,0.0],[44.434,26.058,0.0],[44.427,26.145,0.0],[44.397,26.146,0.0],[44.394,26.143,0.0],[44.419,26.165,0.0],[44.407,26.087,0.0],[44.451,26.09,0.0],[44.424,26.18,0.0],[44.41,26.088,0.0],[44.41,26.09,0.0],[44.441,26.075,0.0],[44.41,26.205,0.0],[44.433,26.175,0.0],[44.428,26.186,0.0],[44.427,26.189,0.0],[44.433,26.112,0.0],[44.438,26.096,0.0],[44.436,26.096,0.0],[44.447,26.145,0.0],[44.448,26.146,0.0],[44.448,26.133,0.0],[44.441,26.124,0.0],[44.448,26.13,0.0],[44.441,26.121,0.0],[44.442,26.127,0.0],[44.444,26.122,0.0],[44.445,26.125,0.0],[44.486,26.094,0.0],[44.484,26.094,0.0],[44.484,26.097,0.0],[44.481,26.094,0.0],[44.415,26.109,0.0],[44.415,26.113,0.0],[44.413,26.112,0.0],[44.416,26.106,0.0],[44.416,26.11,0.0],[44.425,26.109,0.0],[44.424,26.109,0.0],[44.425,26.108,0.0],[44.424,26.108,0.0],[44.407,26.125,0.0],[44.406,26.124,0.0],[44.407,26.124,0.0],[44.439,26.119,0.0],[44.434,26.118,0.0],[44.438,26.115,0.0],[44.441,26.118,0.0],[44.442,26.128,0.0],[44.436,26.13,0.0],[44.441,26.128,0.0],[44.434,26.112,0.0],[44.434,26.134,0.0],[44.434,26.133,0.0],[44.434,26.113,0.0],[44.434,26.13,0.0],[44.447,26.109,0.0],[44.45,26.115,0.0],[44.451,26.103,0.0],[44.451,26.105,0.0],[44.45,26.119,0.0],[44.451,26.102,0.0],[44.447,26.112,0.0],[44.448,26.116,0.0],[44.413,26.037,0.0],[44.376,26.094,0.0],[44.428,26.124,0.0],[44.43,26.124,0.0],[44.431,26.122,0.0],[44.439,26.091,0.0],[44.441,26.115,0.0],[44.447,26.088,0.0],[44.445,26.115,0.0],[44.401,26.093,0.0],[44.4,26.079,0.0],[44.434,26.124,0.0],[44.469,26.139,0.0],[44.445,26.11,0.0],[44.445,26.112,0.0],[44.41,26.099,0.0],[44.421,26.094,0.0],[44.424,26.093,0.0],[44.434,26.155,0.0],[44.436,26.112,0.0],[44.438,26.113,0.0],[44.441,26.112,0.0],[44.533,26.169,0.0],[44.469,26.143,0.0],[44.45,26.076,0.0],[44.412,26.058,0.0],[44.422,26.108,0.0],[44.427,26.115,0.0],[44.428,26.113,0.0],[44.456,26.091,0.0],[44.46,26.096,0.0],[44.419,26.009,0.0],[44.419,26.01,0.0],[44.418,26.007,0.0],[44.438,26.131,0.0],[44.438,26.13,0.0],[44.444,26.084,0.0],[44.442,26.085,0.0],[44.444,26.087,0.0],[44.445,26.084,0.0],[44.444,26.085,0.0],[44.445,26.088,0.0],[44.442,26.087,0.0],[44.391,26.105,0.0],[44.392,26.105,0.0],[44.392,26.106,0.0],[44.394,26.103,0.0],[44.395,26.106,0.0],[44.395,26.115,0.0],[44.447,26.154,0.0],[44.495,26.183,0.0],[44.441,26.064,0.0],[44.483,25.974,0.0],[44.49,26.127,0.0],[44.483,26.091,0.0],[44.394,26.097,0.0],[44.456,26.142,0.0],[44.49,26.067,0.0],[44.49,26.066,0.0],[44.424,26.073,0.0],[44.483,26.075,0.0],[44.472,26.064,0.0],[44.472,26.066,0.0],[44.474,26.064,0.0],[44.472,26.059,0.0],[44.422,26.18,0.0],[44.425,26.125,0.0],[44.425,26.124,0.0],[44.406,26.133,0.0],[44.475,26.064,0.0],[44.477,26.062,0.0],[44.475,26.062,0.0],[44.444,26.124,0.0],[44.49,26.087,0.0],[44.438,26.136,0.0],[44.407,26.09,0.0],[44.41,26.093,0.0],[44.409,26.133,0.0],[44.409,26.125,0.0],[44.46,26.067,0.0],[44.463,26.069,0.0],[44.46,26.066,0.0],[44.462,26.066,0.0],[44.425,26.128,0.0],[44.483,26.119,0.0],[44.448,26.125,0.0],[44.386,26.116,0.0],[44.448,26.088,0.0],[44.445,26.139,0.0],[44.439,26.043,0.0],[44.441,26.044,0.0],[44.439,26.044,0.0],[44.45,26.125,0.0],[44.45,26.13,0.0],[44.453,26.128,0.0],[44.38,26.09,0.0],[44.478,26.165,0.0],[44.407,26.096,0.0],[44.466,26.09,0.0],[44.469,26.09,0.0],[44.469,26.091,0.0],[44.424,26.119,0.0],[44.427,26.023,0.0],[44.427,26.022,0.0],[44.431,26.14,0.0],[44.419,26.102,0.0],[44.444,26.055,0.0],[44.359,25.97,0.0],[44.377,26.124,0.0],[44.398,26.119,0.0],[44.368,25.974,0.0],[44.365,25.973,0.0],[44.367,25.974,0.0],[44.367,25.973,0.0],[44.392,26.025,0.0],[44.391,26.02,0.0],[44.413,26.128,0.0],[44.465,26.087,0.0],[44.468,26.094,0.0],[44.349,26.031,0.0],[44.349,26.029,0.0],[44.35,26.034,0.0],[44.347,26.031,0.0],[44.35,26.029,0.0],[44.352,26.031,0.0],[44.389,26.108,0.0],[44.388,26.116,0.0],[44.391,26.103,0.0],[44.422,26.093,0.0],[44.415,26.102,0.0],[44.519,26.18,0.0],[44.52,26.18,0.0],[44.522,26.18,0.0],[44.505,26.081,0.0],[44.395,26.1,0.0],[44.483,26.09,0.0],[44.486,26.091,0.0],[44.49,26.124,0.0],[44.492,26.127,0.0],[44.489,26.125,0.0],[44.489,26.09,0.0],[44.487,26.091,0.0],[44.371,26.119,0.0],[44.447,26.037,0.0],[44.415,26.103,0.0],[44.456,26.082,0.0],[44.433,25.992,0.0],[44.442,25.944,0.0],[44.41,26.02,0.0],[44.441,26.02,0.0],[44.442,25.965,0.0],[44.436,25.954,0.0],[44.439,25.947,0.0],[44.445,26.047,0.0],[44.442,26.044,0.0],[44.392,26.102,0.0],[44.395,26.105,0.0],[44.418,26.097,0.0],[44.385,26.148,0.0],[44.448,26.145,0.0],[44.445,26.14,0.0],[44.434,26.137,0.0],[44.389,26.124,0.0],[44.425,26.097,0.0],[44.398,26.113,0.0],[44.385,26.128,0.0],[44.454,26.121,0.0],[44.456,26.113,0.0],[44.469,26.046,0.0],[44.468,26.047,0.0],[44.454,26.059,0.0],[44.451,26.062,0.0],[44.463,26.082,0.0],[44.454,26.108,0.0],[44.454,26.109,0.0],[44.424,26.01,0.0],[44.456,26.18,0.0],[44.412,26.127,0.0],[44.468,26.096,0.0],[44.457,25.979,0.0],[44.45,26.01,0.0],[44.459,26.081,0.0],[44.456,26.073,0.0],[44.528,26.187,0.0],[44.528,26.19,0.0],[44.389,26.145,0.0],[44.513,26.079,0.0],[44.398,26.112,0.0],[44.472,26.069,0.0],[44.539,26.134,0.0],[44.532,26.157,0.0],[44.538,26.133,0.0],[44.538,26.134,0.0],[44.541,26.137,0.0],[44.539,26.139,0.0],[44.541,26.131,0.0],[44.532,26.16,0.0],[44.495,26.087,0.0],[44.495,26.088,0.0],[44.496,26.085,0.0],[44.496,26.084,0.0],[44.496,26.087,0.0],[44.495,26.094,0.0],[44.493,26.094,0.0],[44.427,26.096,0.0],[44.427,26.097,0.0],[44.365,26.088,0.0],[44.38,26.091,0.0],[44.481,26.032,0.0],[44.493,26.016,0.0],[44.445,26.146,0.0],[44.38,26.154,0.0],[44.489,26.127,0.0],[44.514,26.07,0.0],[44.418,26.004,0.0],[44.418,26.003,0.0],[44.418,26.001,0.0],[44.514,26.072,0.0],[44.389,26.205,0.0],[44.389,26.201,0.0],[44.377,26.099,0.0],[44.382,26.119,0.0],[44.444,25.988,0.0],[44.444,25.989,0.0],[44.444,25.991,0.0],[44.442,25.989,0.0],[44.442,25.988,0.0],[44.445,25.988,0.0],[44.445,25.986,0.0],[44.525,26.059,0.0],[44.525,26.058,0.0],[44.525,26.055,0.0],[44.468,26.171,0.0],[44.466,26.171,0.0],[44.448,26.082,0.0],[44.376,26.103,0.0],[44.404,26.142,0.0],[44.398,26.097,0.0],[44.463,26.154,0.0],[44.38,26.169,0.0],[44.407,26.136,0.0],[44.422,26.091,0.0],[44.422,26.1,0.0],[44.424,26.094,0.0],[44.436,26.181,0.0],[44.472,26.154,0.0],[44.471,26.155,0.0],[44.434,26.186,0.0],[44.433,26.19,0.0],[44.529,26.073,0.0],[44.419,26.1,0.0],[44.421,26.091,0.0],[44.418,26.102,0.0],[44.419,26.094,0.0],[44.419,26.099,0.0],[44.425,26.094,0.0],[44.438,26.122,0.0],[44.434,26.131,0.0],[44.511,26.087,0.0],[44.477,26.037,0.0],[44.486,26.038,0.0],[44.484,26.044,0.0],[44.495,26.075,0.0],[44.419,26.085,0.0],[44.421,26.082,0.0],[44.428,26.075,0.0],[44.404,26.208,0.0],[44.472,26.062,0.0],[44.428,26.214,0.0],[44.422,26.128,0.0],[44.444,26.116,0.0],[44.493,26.096,0.0],[44.361,26.09,0.0],[44.504,25.991,0.0],[44.504,25.992,0.0],[44.505,25.992,0.0],[44.406,25.992,0.0],[44.535,26.172,0.0],[44.536,26.174,0.0],[44.535,26.171,0.0],[44.499,26.056,0.0],[44.456,26.121,0.0],[44.447,26.084,0.0],[44.364,26.04,0.0],[44.438,26.195,0.0],[44.436,26.187,0.0],[44.436,26.184,0.0],[44.436,26.195,0.0],[44.436,26.19,0.0],[44.492,26.13,0.0],[44.448,26.112,0.0],[44.388,26.006,0.0],[44.448,26.081,0.0],[44.456,26.088,0.0],[44.416,26.073,0.0],[44.427,26.07,0.0],[44.492,26.19,0.0],[44.416,26.059,0.0],[44.415,26.061,0.0],[44.49,26.187,0.0],[44.436,25.991,0.0],[44.431,26.192,0.0],[44.438,25.971,0.0],[44.434,25.98,0.0],[44.434,25.979,0.0],[44.529,26.076,0.0],[44.532,26.067,0.0],[44.407,26.18,0.0],[44.409,26.18,0.0],[44.382,26.085,0.0],[44.382,26.081,0.0],[44.466,26.043,0.0],[44.374,26.113,0.0],[44.376,26.109,0.0],[44.43,26.035,0.0],[44.451,26.14,0.0],[44.453,26.142,0.0],[44.391,26.087,0.0],[44.388,26.007,0.0],[44.377,26.128,0.0],[44.365,26.148,0.0],[44.365,26.146,0.0],[44.535,26.055,0.0],[44.531,26.052,0.0],[44.538,26.053,0.0],[44.466,26.079,0.0],[44.535,26.064,0.0],[44.536,26.075,0.0],[44.535,26.066,0.0],[44.539,26.067,0.0],[44.536,26.073,0.0],[44.533,26.064,0.0],[44.367,25.971,0.0],[44.373,25.98,0.0],[44.547,26.07,0.0],[44.55,26.07,0.0],[44.463,26.046,0.0],[44.419,26.118,0.0],[44.49,26.119,0.0],[44.489,26.116,0.0],[44.495,26.127,0.0],[44.496,26.131,0.0],[44.371,26.183,0.0],[44.483,26.105,0.0],[44.475,26.058,0.0],[44.349,26.085,0.0],[44.359,26.088,0.0],[44.35,26.085,0.0],[44.358,26.094,0.0],[44.346,26.085,0.0],[44.353,26.084,0.0],[44.359,26.094,0.0],[44.361,26.091,0.0],[44.37,26.122,0.0],[44.373,26.124,0.0],[44.371,26.124,0.0],[44.374,26.125,0.0],[44.368,26.119,0.0],[44.383,26.09,0.0],[44.361,25.966,0.0],[44.368,25.97,0.0],[44.444,26.038,0.0],[44.425,25.986,0.0],[44.382,26.152,0.0],[44.407,26.208,0.0],[44.526,26.04,0.0],[44.526,26.044,0.0],[44.528,26.046,0.0],[44.529,26.049,0.0],[44.407,26.181,0.0],[44.469,26.093,0.0],[44.409,26.091,0.0],[44.406,26.088,0.0],[44.444,26.09,0.0],[44.499,26.181,0.0],[44.499,26.18,0.0],[44.501,26.18,0.0],[44.474,26.072,0.0],[44.407,26.11,0.0],[44.493,26.214,0.0],[44.359,26.196,0.0],[44.35,26.211,0.0],[44.361,26.029,0.0],[44.359,26.032,0.0],[44.508,26.069,0.0],[44.508,26.07,0.0],[44.51,26.07,0.0],[44.52,26.079,0.0],[44.523,26.081,0.0],[44.394,26.035,0.0],[44.395,26.038,0.0],[44.46,26.081,0.0],[44.447,26.072,0.0],[44.409,26.094,0.0],[44.401,26.044,0.0],[44.412,26.088,0.0],[44.413,26.087,0.0],[44.409,26.09,0.0],[44.343,25.944,0.0],[44.52,26.183,0.0],[44.548,26.072,0.0],[44.38,26.165,0.0],[44.516,26.087,0.0],[44.406,25.994,0.0],[44.382,26.004,0.0],[44.388,26.015,0.0],[44.389,26.01,0.0],[44.382,26.001,0.0],[44.406,25.985,0.0],[44.404,25.985,0.0],[44.407,25.988,0.0],[44.392,26.004,0.0],[44.424,26.012,0.0],[44.365,26.133,0.0],[44.422,26.01,0.0],[44.542,26.093,0.0],[44.454,26.119,0.0],[44.34,26.148,0.0],[44.415,26.078,0.0],[44.439,25.965,0.0],[44.439,25.966,0.0],[44.542,26.07,0.0],[44.498,26.178,0.0],[44.477,26.157,0.0],[44.481,26.162,0.0],[44.523,26.175,0.0],[44.416,26.217,0.0],[44.35,26.028,0.0],[44.353,26.032,0.0],[44.355,26.032,0.0],[44.355,26.031,0.0],[44.353,26.035,0.0],[44.355,26.037,0.0],[44.352,26.016,0.0],[44.35,26.044,0.0],[44.352,26.049,0.0],[44.367,26.04,0.0],[44.347,26.038,0.0],[44.365,26.038,0.0],[44.382,26.148,0.0],[44.383,26.149,0.0],[44.382,26.146,0.0],[44.386,26.145,0.0],[44.382,26.154,0.0],[44.382,26.145,0.0],[44.386,26.143,0.0],[44.377,26.151,0.0],[44.38,26.159,0.0],[44.377,26.159,0.0],[44.376,26.16,0.0],[44.382,26.157,0.0],[44.376,26.155,0.0],[44.376,26.159,0.0],[44.45,26.137,0.0],[44.523,26.031,0.0],[44.523,26.029,0.0],[44.412,26.22,0.0],[44.416,26.22,0.0],[44.418,26.218,0.0],[44.416,26.218,0.0],[44.413,26.217,0.0],[44.379,26.168,0.0],[44.493,26.13,0.0],[44.495,26.001,0.0],[44.447,26.091,0.0],[44.407,25.991,0.0],[44.544,26.07,0.0],[44.38,26.137,0.0],[44.538,26.059,0.0],[44.433,26.189,0.0],[44.422,26.186,0.0],[44.413,26.116,0.0],[44.343,25.942,0.0],[44.533,26.059,0.0],[44.531,26.056,0.0],[44.538,26.061,0.0],[44.539,26.056,0.0],[44.531,26.055,0.0],[44.532,26.059,0.0],[44.352,26.084,0.0],[44.346,26.084,0.0],[44.371,26.043,0.0],[44.376,26.106,0.0],[44.419,26.058,0.0],[44.425,26.061,0.0],[44.477,26.109,0.0],[44.501,25.994,0.0],[44.447,26.201,0.0],[44.41,26.151,0.0],[44.41,26.152,0.0],[44.52,25.96,0.0],[44.486,26.18,0.0],[44.507,26.217,0.0],[44.505,26.217,0.0],[44.37,26.155,0.0],[44.371,26.154,0.0],[44.368,26.133,0.0],[44.445,26.04,0.0],[44.445,26.046,0.0],[44.436,25.96,0.0],[44.418,26.099,0.0],[44.388,26.096,0.0],[44.37,26.152,0.0],[44.368,26.152,0.0],[44.364,26.148,0.0],[44.425,26.066,0.0],[44.427,26.017,0.0],[44.477,26.044,0.0],[44.478,26.056,0.0],[44.438,25.963,0.0],[44.394,25.982,0.0],[44.406,26.145,0.0],[44.495,26.201,0.0],[44.371,26.137,0.0],[44.395,26.031,0.0],[44.447,25.986,0.0],[44.441,26.041,0.0],[44.471,26.106,0.0],[44.434,25.995,0.0],[44.493,26.124,0.0],[44.439,25.977,0.0],[44.436,25.994,0.0],[44.436,25.992,0.0],[44.413,26.055,0.0],[44.365,26.093,0.0],[44.367,26.093,0.0],[44.48,26.037,0.0],[44.418,26.118,0.0],[44.492,26.116,0.0],[44.492,26.113,0.0],[44.406,26.165,0.0],[44.404,26.171,0.0],[44.496,25.991,0.0],[44.496,25.992,0.0],[44.409,26.001,0.0],[44.398,25.991,0.0],[44.401,25.979,0.0],[44.37,26.14,0.0],[44.413,26.121,0.0],[44.466,26.076,0.0],[44.454,26.072,0.0],[44.457,26.076,0.0],[44.477,26.043,0.0],[44.477,26.041,0.0],[44.365,26.151,0.0],[44.374,26.148,0.0],[44.418,26.078,0.0],[44.418,26.081,0.0],[44.462,26.069,0.0],[44.451,26.075,0.0],[44.454,26.07,0.0],[44.392,26.006,0.0],[44.389,26.007,0.0],[44.398,26.007,0.0],[44.421,25.985,0.0],[44.424,25.995,0.0],[44.471,26.073,0.0],[44.48,26.038,0.0],[44.478,26.04,0.0],[44.462,26.061,0.0],[44.392,26.012,0.0],[44.394,26.01,0.0],[44.386,25.98,0.0],[44.392,26.007,0.0],[44.388,25.98,0.0],[44.465,26.022,0.0],[44.474,26.015,0.0],[44.469,26.049,0.0],[44.502,25.985,0.0],[44.502,25.986,0.0],[44.427,26.217,0.0],[44.37,26.151,0.0],[44.376,26.154,0.0],[44.368,26.146,0.0],[44.368,26.151,0.0],[44.367,26.151,0.0],[44.376,26.149,0.0],[44.445,26.069,0.0],[44.486,26.102,0.0],[44.415,26.121,0.0],[44.371,26.157,0.0],[44.382,26.171,0.0]];
const DENSITY_GRID=[[44.43,26.19,1.0],[44.43,26.052,1.0],[44.519,26.075,0.7],[44.484,26.112,0.6],[44.427,26.148,0.5],[44.421,26.18,0.5],[44.529,26.075,0.4],[44.478,26.112,0.4],[44.364,26.131,0.4],[44.425,26.149,0.4],[44.51,26.088,0.4],[44.438,26.187,0.4],[44.481,26.113,0.4],[44.481,26.112,0.4],[44.442,26.152,0.4],[44.431,26.18,0.4],[44.43,26.058,0.4],[44.475,26.187,0.3],[44.433,26.178,0.3],[44.428,25.988,0.3],[44.424,26.149,0.3],[44.539,26.073,0.3],[44.421,26.149,0.3],[44.478,26.108,0.3],[44.433,26.052,0.3],[44.421,26.148,0.3],[44.428,26.053,0.3],[44.434,26.082,0.3],[44.431,26.05,0.3],[44.356,26.218,0.3],[44.425,26.148,0.3],[44.442,26.149,0.3],[44.525,26.026,0.3],[44.478,26.103,0.3],[44.428,26.196,0.3],[44.43,26.053,0.3],[44.434,26.052,0.3],[44.427,26.183,0.3],[44.395,26.122,0.3],[44.447,26.007,0.3],[44.425,26.186,0.3],[44.38,26.118,0.3],[44.471,26.109,0.3],[44.424,26.184,0.3],[44.428,26.146,0.3],[44.436,26.081,0.3],[44.394,26.121,0.3],[44.532,25.959,0.3],[44.48,26.115,0.3],[44.422,26.148,0.2],[44.421,26.146,0.2],[44.355,26.091,0.2],[44.412,26.081,0.2],[44.424,26.159,0.2],[44.447,26.097,0.2],[44.397,26.124,0.2],[44.442,26.154,0.2],[44.492,25.976,0.2],[44.434,26.053,0.2],[44.445,26.078,0.2],[44.451,26.125,0.2],[44.424,26.146,0.2],[44.424,26.19,0.2],[44.434,26.055,0.2],[44.478,26.116,0.2],[44.419,26.148,0.2],[44.472,26.108,0.2],[44.433,26.05,0.2],[44.471,26.043,0.2],[44.43,26.037,0.2],[44.367,26.043,0.2],[44.438,26.192,0.2],[44.478,26.11,0.2],[44.431,26.175,0.2],[44.434,26.079,0.2],[44.481,26.109,0.2],[44.431,26.052,0.2],[44.427,26.146,0.2],[44.424,26.189,0.2],[44.386,26.109,0.2],[44.37,26.178,0.2],[44.441,26.076,0.2],[44.478,26.067,0.2],[44.433,26.049,0.2],[44.478,26.175,0.2],[44.394,26.118,0.2],[44.478,26.181,0.2],[44.438,26.025,0.2],[44.418,26.151,0.2],[44.421,26.19,0.2],[44.507,26.09,0.2],[44.412,26.118,0.2],[44.439,26.052,0.2],[44.478,26.115,0.2],[44.529,26.038,0.2],[44.451,26.087,0.2],[44.477,26.105,0.2],[44.498,26.0,0.2],[44.508,26.087,0.2],[44.383,26.001,0.2],[44.481,26.11,0.2],[44.508,26.091,0.2],[44.525,26.015,0.2],[44.438,26.026,0.2],[44.431,26.049,0.2],[44.43,26.178,0.2],[44.425,26.146,0.2],[44.43,26.102,0.2],[44.445,26.151,0.2],[44.441,26.155,0.2],[44.4,26.044,0.2],[44.43,26.05,0.2],[44.477,26.115,0.2],[44.442,26.05,0.2],[44.465,26.127,0.2],[44.444,26.155,0.2],[44.49,26.016,0.2],[44.418,26.149,0.2],[44.416,26.035,0.2],[44.433,26.056,0.2],[44.48,26.109,0.2],[44.394,26.122,0.2],[44.441,26.047,0.2],[44.412,26.109,0.2],[44.43,26.04,0.2],[44.436,26.05,0.2],[44.395,26.127,0.2],[44.439,26.133,0.2],[44.397,26.119,0.2],[44.412,26.165,0.2],[44.475,26.162,0.2],[44.478,26.113,0.2],[44.409,26.034,0.2],[44.439,26.025,0.2],[44.442,26.094,0.2],[44.424,26.154,0.2],[44.444,26.022,0.2],[44.41,26.16,0.2],[44.486,25.979,0.2],[44.481,26.103,0.2],[44.404,26.064,0.2],[44.431,26.016,0.2],[44.438,26.019,0.2],[44.427,26.149,0.2],[44.439,25.957,0.2],[44.431,26.02,0.2],[44.442,26.157,0.2],[44.422,26.149,0.2],[44.412,26.116,0.2],[44.434,26.189,0.2],[44.43,26.038,0.2],[44.447,26.152,0.2],[44.492,26.093,0.2],[44.478,26.136,0.2],[44.428,26.093,0.2],[44.386,25.985,0.2],[44.436,26.055,0.2],[44.448,26.096,0.2],[44.445,26.066,0.2],[44.439,25.983,0.2],[44.428,26.105,0.2],[44.406,26.149,0.2],[44.433,26.034,0.2],[44.511,26.206,0.2],[44.438,26.049,0.2],[44.436,26.082,0.2],[44.447,26.099,0.2],[44.392,26.125,0.2],[44.433,26.053,0.2],[44.425,26.102,0.2],[44.462,26.058,0.2],[44.422,26.02,0.2],[44.445,26.097,0.2],[44.418,26.148,0.2],[44.445,26.099,0.2],[44.431,26.056,0.2],[44.43,26.1,0.2],[44.419,26.127,0.2],[44.427,26.062,0.2],[44.433,26.081,0.2],[44.434,26.1,0.2],[44.395,25.974,0.2],[44.394,26.093,0.2],[44.41,26.116,0.2],[44.41,26.115,0.2],[44.456,25.963,0.1],[44.422,26.189,0.1],[44.438,26.103,0.1],[44.395,26.119,0.1],[44.433,26.1,0.1],[44.439,26.166,0.1],[44.415,26.159,0.1],[44.431,26.01,0.1],[44.433,26.022,0.1],[44.433,26.023,0.1],[44.439,26.18,0.1],[44.434,25.959,0.1],[44.379,26.119,0.1],[44.421,26.139,0.1],[44.416,26.151,0.1],[44.436,26.026,0.1],[44.415,26.201,0.1],[44.477,26.184,0.1],[44.48,26.163,0.1],[44.441,26.053,0.1],[44.427,26.169,0.1],[44.346,26.181,0.1],[44.448,26.099,0.1],[44.439,26.05,0.1],[44.436,26.072,0.1],[44.439,26.053,0.1],[44.419,26.149,0.1],[44.362,26.209,0.1],[44.413,26.108,0.1],[44.428,26.149,0.1],[44.344,26.085,0.1],[44.428,26.052,0.1],[44.425,26.076,0.1],[44.447,26.096,0.1],[44.419,26.162,0.1],[44.41,26.166,0.1],[44.431,26.103,0.1],[44.48,26.1,0.1],[44.48,26.103,0.1],[44.442,26.148,0.1],[44.474,26.031,0.1],[44.394,26.119,0.1],[44.43,26.031,0.1],[44.427,26.152,0.1],[44.507,26.087,0.1],[44.427,26.151,0.1],[44.431,26.019,0.1],[44.48,26.118,0.1],[44.412,26.112,0.1],[44.445,26.044,0.1],[44.454,26.044,0.1],[44.441,26.017,0.1],[44.428,26.032,0.1],[44.433,26.181,0.1],[44.434,26.05,0.1],[44.439,26.049,0.1],[44.41,26.137,0.1],[44.412,26.07,0.1],[44.433,26.18,0.1],[44.38,26.128,0.1],[44.389,26.093,0.1],[44.4,26.146,0.1],[44.439,26.0,0.1],[44.477,26.137,0.1],[44.425,26.175,0.1],[44.395,26.116,0.1],[44.433,26.047,0.1],[44.444,26.151,0.1],[44.427,26.035,0.1],[44.444,26.049,0.1],[44.427,26.009,0.1],[44.398,26.145,0.1],[44.438,26.137,0.1],[44.472,26.109,0.1],[44.412,26.128,0.1],[44.438,25.986,0.1],[44.447,26.13,0.1],[44.427,26.1,0.1],[44.407,26.19,0.1],[44.388,26.133,0.1],[44.442,26.052,0.1],[44.433,26.02,0.1],[44.439,26.084,0.1],[44.436,26.032,0.1],[44.403,25.986,0.1],[44.496,26.217,0.1],[44.361,26.122,0.1],[44.516,26.07,0.1],[44.425,26.103,0.1],[44.382,26.128,0.1],[44.347,26.183,0.1],[44.428,26.031,0.1],[44.489,25.98,0.1],[44.386,26.1,0.1],[44.373,26.118,0.1],[44.436,26.016,0.1],[44.43,26.041,0.1],[44.439,26.013,0.1],[44.439,26.096,0.1],[44.425,26.151,0.1],[44.416,26.157,0.1],[44.474,26.108,0.1],[44.385,26.13,0.1],[44.438,26.082,0.1],[44.43,26.055,0.1],[44.513,26.205,0.1],[44.412,26.168,0.1],[44.386,26.121,0.1],[44.382,26.118,0.1],[44.459,26.046,0.1],[44.43,26.16,0.1],[44.445,25.947,0.1],[44.444,26.148,0.1],[44.439,26.022,0.1],[44.427,26.13,0.1],[44.368,26.125,0.1],[44.413,26.11,0.1],[44.439,26.028,0.1],[44.528,25.959,0.1],[44.472,26.11,0.1],[44.421,26.174,0.1],[44.427,26.102,0.1],[44.428,26.151,0.1],[44.444,26.066,0.1],[44.453,26.119,0.1],[44.438,26.02,0.1],[44.433,26.015,0.1],[44.41,26.069,0.1],[44.444,26.069,0.1],[44.416,26.184,0.1],[44.48,26.105,0.1],[44.395,26.168,0.1],[44.368,26.136,0.1],[44.478,26.174,0.1],[44.431,26.012,0.1],[44.438,26.022,0.1],[44.445,26.127,0.1],[44.433,26.157,0.1],[44.415,26.09,0.1],[44.415,26.18,0.1],[44.404,26.069,0.1],[44.391,26.094,0.1],[44.422,26.214,0.1],[44.49,26.118,0.1],[44.355,26.211,0.1],[44.431,26.053,0.1],[44.401,25.983,0.1],[44.421,26.193,0.1],[44.477,26.18,0.1],[44.362,26.127,0.1],[44.463,26.13,0.1],[44.431,26.029,0.1],[44.409,26.072,0.1],[44.441,26.052,0.1],[44.48,26.116,0.1],[44.436,26.023,0.1],[44.373,26.121,0.1],[44.441,26.152,0.1],[44.397,26.112,0.1],[44.356,26.221,0.1],[44.433,26.174,0.1],[44.385,26.133,0.1],[44.385,26.103,0.1],[44.391,26.013,0.1],[44.377,26.121,0.1],[44.428,26.189,0.1],[44.415,26.199,0.1],[44.431,26.078,0.1],[44.418,26.178,0.1],[44.391,26.146,0.1],[44.474,26.109,0.1],[44.391,26.019,0.1],[44.418,25.966,0.1],[44.498,26.212,0.1],[44.428,26.108,0.1],[44.35,26.087,0.1],[44.495,26.093,0.1],[44.412,26.085,0.1],[44.367,26.155,0.1],[44.419,26.152,0.1],[44.419,26.145,0.1],[44.495,26.218,0.1],[44.418,26.128,0.1],[44.495,26.091,0.1],[44.434,26.157,0.1],[44.438,26.102,0.1],[44.388,26.128,0.1],[44.419,26.151,0.1],[44.453,25.986,0.1],[44.438,25.98,0.1],[44.438,26.017,0.1],[44.472,26.019,0.1],[44.438,25.983,0.1],[44.425,26.093,0.1],[44.436,26.084,0.1],[44.383,26.134,0.1],[44.392,26.124,0.1],[44.445,26.031,0.1],[44.407,26.203,0.1],[44.359,26.133,0.1],[44.425,26.037,0.1],[44.383,26.099,0.1],[44.412,26.14,0.1],[44.451,26.122,0.1],[44.441,26.134,0.1],[44.489,25.979,0.1],[44.48,26.112,0.1],[44.457,26.079,0.1],[44.475,26.112,0.1],[44.436,26.017,0.1],[44.422,26.163,0.1],[44.484,26.109,0.1],[44.391,26.125,0.1],[44.475,26.108,0.1],[44.403,26.061,0.1],[44.362,26.09,0.1],[44.425,26.105,0.1],[44.412,26.115,0.1],[44.436,26.02,0.1],[44.43,26.193,0.1],[44.478,26.105,0.1],[44.391,25.979,0.1],[44.385,26.084,0.1],[44.412,26.02,0.1],[44.431,26.028,0.1],[44.439,26.193,0.1],[44.391,26.007,0.1],[44.445,26.154,0.1],[44.416,26.155,0.1],[44.48,26.159,0.1],[44.441,26.154,0.1],[44.382,26.116,0.1],[44.365,26.181,0.1],[44.441,26.026,0.1],[44.391,25.986,0.1],[44.468,26.139,0.1],[44.459,26.047,0.1],[44.439,26.017,0.1],[44.424,26.016,0.1],[44.522,26.013,0.1],[44.418,26.177,0.1],[44.41,26.112,0.1],[44.431,26.177,0.1],[44.385,26.137,0.1],[44.422,26.175,0.1],[44.522,26.026,0.1],[44.424,25.988,0.1],[44.394,26.124,0.1],[44.385,26.115,0.1],[44.459,26.049,0.1],[44.438,26.032,0.1],[44.433,26.102,0.1],[44.439,26.157,0.1],[44.424,26.148,0.1],[44.379,26.125,0.1],[44.428,26.049,0.1],[44.413,26.137,0.1],[44.37,26.127,0.1],[44.433,26.04,0.1],[44.427,26.19,0.1],[44.385,26.116,0.1],[44.416,26.09,0.1],[44.415,26.066,0.1],[44.459,26.069,0.1],[44.444,26.052,0.1],[44.438,25.977,0.1],[44.388,26.091,0.1],[44.395,26.118,0.1],[44.416,26.183,0.1],[44.444,26.119,0.1],[44.472,26.113,0.1],[44.431,26.037,0.1],[44.38,26.119,0.1],[44.439,26.165,0.1],[44.388,26.134,0.1],[44.374,26.047,0.1],[44.504,26.09,0.1],[44.453,26.149,0.1],[44.368,26.187,0.1],[44.392,26.096,0.1],[44.439,26.078,0.1],[44.412,26.136,0.1],[44.433,26.055,0.1],[44.475,26.181,0.1],[44.496,26.215,0.1],[44.413,26.148,0.1],[44.456,26.127,0.1],[44.499,26.032,0.1],[44.418,26.019,0.1],[44.41,26.172,0.1],[44.397,25.973,0.1],[44.418,26.142,0.1],[44.456,26.043,0.1],[44.431,26.015,0.1],[44.48,26.106,0.1],[44.471,26.112,0.1],[44.413,26.067,0.1],[44.462,26.118,0.1],[44.368,26.044,0.1],[44.431,26.047,0.1],[44.456,26.046,0.1],[44.43,26.189,0.1],[44.439,26.175,0.1],[44.409,26.116,0.1],[44.436,26.099,0.1],[44.431,26.148,0.1],[44.442,26.056,0.1],[44.438,26.159,0.1],[44.41,26.087,0.1],[44.391,26.127,0.1],[44.463,26.131,0.1],[44.475,26.109,0.1],[44.425,26.106,0.1],[44.45,26.127,0.1],[44.401,26.143,0.1],[44.407,25.986,0.1],[44.43,26.032,0.1],[44.441,26.016,0.1],[44.425,25.985,0.1],[44.454,26.049,0.1],[44.475,26.11,0.1],[44.45,26.096,0.1],[44.438,26.076,0.1],[44.441,26.055,0.1],[44.418,26.169,0.1],[44.385,26.097,0.1],[44.383,26.122,0.1],[44.525,25.953,0.1],[44.428,26.035,0.1],[44.486,26.171,0.1],[44.38,26.127,0.1],[44.424,26.1,0.1],[44.43,26.205,0.1],[44.436,26.025,0.1],[44.441,26.023,0.1],[44.431,26.172,0.1],[44.444,26.093,0.1],[44.434,26.046,0.1],[44.43,26.148,0.1],[44.367,26.19,0.1],[44.519,26.069,0.1],[44.41,26.201,0.1],[44.385,26.136,0.1],[44.41,26.143,0.1],[44.389,26.127,0.1],[44.422,26.177,0.1],[44.448,26.094,0.1],[44.412,26.069,0.1],[44.49,26.088,0.1],[44.465,26.073,0.1],[44.441,26.07,0.1],[44.41,26.139,0.1],[44.439,26.02,0.1],[44.477,26.106,0.1],[44.427,26.178,0.1],[44.413,26.136,0.1],[44.365,26.183,0.1],[44.448,26.1,0.1],[44.505,26.006,0.1],[44.403,26.088,0.1],[44.419,26.146,0.1],[44.436,26.078,0.1],[44.457,26.044,0.1],[44.389,26.128,0.1],[44.4,26.052,0.1],[44.412,26.175,0.1],[44.413,26.142,0.1],[44.428,26.106,0.1],[44.462,26.128,0.1],[44.477,26.108,0.1],[44.422,26.181,0.1],[44.433,26.195,0.1],[44.448,26.049,0.1],[44.51,26.093,0.1],[44.484,26.07,0.1],[44.434,26.026,0.1],[44.431,26.178,0.1],[44.439,26.155,0.1],[44.37,26.137,0.1],[44.353,26.214,0.1],[44.404,26.206,0.1],[44.462,26.134,0.1],[44.415,26.163,0.1],[44.457,26.049,0.1],[44.385,26.119,0.1],[44.438,25.985,0.1],[44.462,26.13,0.1],[44.389,26.013,0.1],[44.447,26.128,0.1],[44.433,26.009,0.1],[44.388,26.131,0.1],[44.404,26.062,0.1],[44.406,26.067,0.1],[44.427,26.034,0.1],[44.444,26.152,0.1],[44.492,26.121,0.1],[44.447,26.131,0.1],[44.433,26.012,0.1],[44.508,26.093,0.1],[44.514,26.01,0.1],[44.373,26.186,0.1],[44.462,26.136,0.1],[44.416,26.181,0.1],[44.48,26.102,0.1],[44.441,26.09,0.1],[44.508,26.088,0.1],[44.38,26.155,0.1],[44.392,26.128,0.1],[44.398,26.106,0.1],[44.442,26.019,0.1],[44.419,26.171,0.1],[44.424,26.162,0.1],[44.424,26.064,0.1],[44.493,26.09,0.1],[44.46,26.13,0.1],[44.388,26.103,0.1],[44.38,26.121,0.1],[44.416,26.097,0.1],[44.434,26.085,0.1],[44.409,26.115,0.1],[44.508,26.094,0.1],[44.501,26.022,0.1],[44.383,26.133,0.1],[44.498,26.031,0.1],[44.493,26.125,0.1],[44.397,26.125,0.1],[44.382,26.124,0.1],[44.522,26.082,0.1],[44.465,26.037,0.1],[44.46,26.128,0.1],[44.358,26.131,0.1],[44.422,26.151,0.1],[44.475,26.103,0.1],[44.445,26.13,0.1],[44.465,26.13,0.1],[44.425,26.01,0.1],[44.436,26.038,0.1],[44.425,26.003,0.1],[44.447,25.985,0.1],[44.438,26.028,0.1],[44.377,26.192,0.1],[44.422,26.154,0.1],[44.382,26.13,0.1],[44.386,26.128,0.1],[44.444,26.076,0.1],[44.409,26.067,0.1],[44.456,26.049,0.1],[44.439,25.96,0.1],[44.471,26.11,0.1],[44.43,26.094,0.1],[44.462,26.116,0.1],[44.382,26.133,0.1],[44.465,26.143,0.1],[44.413,26.166,0.1],[44.422,26.062,0.1],[44.427,26.061,0.1],[44.433,26.166,0.1],[44.397,25.98,0.1],[44.388,26.121,0.1],[44.383,25.991,0.1],[44.439,26.184,0.1],[44.447,26.121,0.1],[44.465,26.142,0.1],[44.441,26.049,0.1],[44.413,26.18,0.1],[44.48,26.113,0.1],[44.441,26.019,0.1],[44.371,26.091,0.1],[44.507,26.091,0.1],[44.383,26.116,0.1],[44.388,26.062,0.1],[44.373,26.151,0.1],[44.484,26.115,0.1],[44.409,26.075,0.1],[44.43,26.049,0.1],[44.462,26.072,0.1],[44.436,26.056,0.1],[44.415,26.13,0.1],[44.413,26.088,0.1],[44.407,26.066,0.1],[44.469,26.109,0.1],[44.427,26.066,0.1],[44.441,26.05,0.1],[44.38,26.124,0.1],[44.459,26.128,0.1],[44.439,26.099,0.1],[44.436,26.022,0.1],[44.425,26.064,0.1],[44.483,26.102,0.1],[44.489,26.109,0.1],[44.416,26.062,0.1],[44.422,26.168,0.1],[44.463,26.142,0.1],[44.407,26.069,0.1],[44.469,26.112,0.1],[44.507,26.093,0.1],[44.421,26.151,0.1],[44.397,26.122,0.1],[44.391,26.01,0.1],[44.442,26.178,0.1],[44.478,26.109,0.1],[44.505,26.091,0.1],[44.469,26.108,0.1],[44.505,26.084,0.1],[44.465,26.059,0.1],[44.445,26.149,0.1],[44.415,26.139,0.1],[44.4,26.105,0.1],[44.492,26.192,0.1],[44.412,26.171,0.1],[44.407,26.075,0.1],[44.419,26.137,0.1],[44.434,25.982,0.1],[44.424,26.136,0.1],[44.377,25.989,0.1],[44.463,26.118,0.1],[44.397,26.121,0.1],[44.478,26.047,0.1],[44.438,26.031,0.1],[44.421,26.022,0.1],[44.385,26.131,0.1],[44.427,26.078,0.1],[44.428,26.134,0.1],[44.4,26.208,0.1],[44.389,26.13,0.1],[44.457,26.128,0.1],[44.459,26.05,0.1],[44.386,26.023,0.1],[44.365,26.18,0.1],[44.451,26.124,0.1],[44.37,26.125,0.1],[44.418,26.18,0.1],[44.413,26.139,0.1],[44.439,26.026,0.1],[44.428,26.103,0.1],[44.462,26.125,0.1],[44.438,26.19,0.1],[44.367,26.115,0.1],[44.439,26.149,0.1],[44.421,26.072,0.1],[44.374,26.22,0.1],[44.51,26.09,0.1],[44.419,26.022,0.1],[44.419,26.112,0.1],[44.431,26.093,0.1],[44.38,26.1,0.1],[44.364,26.18,0.1],[44.453,26.145,0.1],[44.416,26.087,0.1],[44.431,26.031,0.1],[44.442,26.134,0.1],[44.438,25.982,0.1],[44.373,26.127,0.1],[44.41,26.067,0.1],[44.404,25.992,0.1],[44.371,26.152,0.1],[44.427,26.128,0.1],[44.361,26.149,0.1],[44.367,26.157,0.1],[44.427,26.099,0.1],[44.433,26.016,0.1],[44.427,26.001,0.1],[44.459,26.121,0.1],[44.511,26.208,0.1],[44.406,26.075,0.1],[44.418,26.04,0.1],[44.413,26.109,0.1],[44.409,26.113,0.1],[44.471,26.105,0.1],[44.413,26.149,0.1],[44.373,26.125,0.1],[44.431,26.04,0.1],[44.448,26.053,0.1],[44.412,26.125,0.1],[44.388,26.105,0.1],[44.427,26.105,0.1],[44.471,26.108,0.1],[44.388,26.13,0.1],[44.404,26.061,0.1],[44.442,26.146,0.1],[44.416,26.131,0.1],[44.427,26.137,0.1],[44.407,25.973,0.1],[44.383,26.127,0.1],[44.425,26.096,0.1],[44.374,26.11,0.1],[44.422,26.012,0.1],[44.433,26.017,0.1],[44.526,25.951,0.1],[44.447,26.1,0.1],[44.433,26.155,0.1],[44.422,26.044,0.1],[44.418,26.049,0.1],[44.436,26.037,0.1],[44.422,26.015,0.1],[44.427,26.103,0.1],[44.413,26.069,0.1],[44.404,26.067,0.1],[44.415,26.081,0.1],[44.425,26.034,0.1],[44.37,26.148,0.1],[44.406,26.177,0.1],[44.427,26.143,0.1],[44.463,26.09,0.1],[44.48,26.11,0.1],[44.383,26.096,0.1],[44.481,26.115,0.1],[44.368,26.131,0.1],[44.41,26.168,0.1],[44.46,26.046,0.1],[44.454,25.971,0.1],[44.45,26.078,0.1],[44.355,26.145,0.1],[44.451,26.119,0.1],[44.528,26.047,0.1],[44.412,26.198,0.1],[44.442,26.159,0.1],[44.425,26.13,0.1],[44.416,26.046,0.1],[44.48,26.049,0.1],[44.409,26.064,0.1],[44.431,26.017,0.1],[44.422,26.211,0.1],[44.439,26.093,0.1],[44.413,26.07,0.1],[44.463,26.128,0.1],[44.418,26.159,0.1],[44.465,26.14,0.1],[44.422,26.116,0.1],[44.407,26.115,0.1],[44.412,26.113,0.1],[44.445,26.096,0.1],[44.415,26.183,0.1],[44.415,26.175,0.1],[44.493,26.097,0.1],[44.416,26.142,0.1],[44.453,26.073,0.1],[44.51,26.208,0.1],[44.412,26.146,0.1],[44.386,26.131,0.1],[44.439,26.031,0.1],[44.46,26.137,0.1],[44.471,26.053,0.1],[44.425,26.009,0.1],[44.385,26.082,0.1],[44.422,26.119,0.1],[44.406,26.094,0.1],[44.407,26.061,0.1],[44.382,26.136,0.1],[44.45,26.097,0.1],[44.418,26.067,0.1],[44.475,26.105,0.1],[44.367,26.18,0.1],[44.456,26.047,0.1],[44.433,26.079,0.1],[44.409,26.076,0.1],[44.43,26.133,0.1],[44.456,26.05,0.1],[44.46,26.113,0.1],[44.434,26.099,0.1],[44.421,26.109,0.1],[44.422,26.061,0.1],[44.382,26.134,0.1],[44.4,26.1,0.1],[44.421,26.142,0.1],[44.431,26.025,0.1],[44.489,25.983,0.1],[44.45,26.128,0.1],[44.43,26.009,0.1],[44.416,26.154,0.1],[44.422,26.162,0.1],[44.438,26.084,0.1],[44.469,26.106,0.1],[44.421,26.137,0.1],[44.364,26.152,0.1],[44.371,26.127,0.1],[44.445,26.02,0.1],[44.424,26.192,0.1],[44.487,25.97,0.1],[44.431,26.166,0.1],[44.444,26.094,0.1],[44.525,25.95,0.1],[44.401,26.05,0.1],[44.403,26.062,0.1],[44.409,26.168,0.1],[44.43,26.134,0.1],[44.444,26.127,0.1],[44.465,26.023,0.1],[44.43,26.015,0.1],[44.43,26.105,0.1],[44.428,26.133,0.1],[44.419,26.139,0.1],[44.424,26.13,0.1],[44.401,26.211,0.1],[44.459,26.139,0.1],[44.371,26.125,0.1],[44.444,26.032,0.1],[44.4,25.977,0.1],[44.428,26.038,0.1],[44.418,26.168,0.1],[44.41,26.14,0.1],[44.462,26.073,0.1],[44.439,26.015,0.1],[44.421,26.116,0.1],[44.441,26.116,0.1],[44.416,26.069,0.1],[44.474,26.106,0.1],[44.412,26.073,0.1],[44.407,26.067,0.1],[44.496,26.003,0.1],[44.385,26.099,0.1],[44.41,26.113,0.1],[44.356,26.043,0.1],[44.406,26.11,0.1],[44.412,26.166,0.1],[44.413,26.125,0.1],[44.419,26.043,0.1],[44.425,26.215,0.1],[44.395,25.98,0.1],[44.406,26.143,0.1],[44.438,26.034,0.1],[44.41,26.019,0.1],[44.43,26.019,0.1],[44.448,26.097,0.1],[44.412,26.072,0.1],[44.439,26.023,0.1],[44.502,26.214,0.1],[44.433,26.099,0.1],[44.43,26.152,0.1],[44.415,26.151,0.1],[44.374,26.127,0.1],[44.477,25.977,0.1],[44.495,26.22,0.1],[44.444,26.047,0.1],[44.439,26.019,0.1],[44.394,26.094,0.1],[44.477,26.112,0.1],[44.389,26.009,0.1],[44.395,26.113,0.1],[44.529,26.192,0.1],[44.38,26.097,0.1],[44.422,26.178,0.1],[44.438,26.1,0.1],[44.413,26.134,0.1],[44.457,26.047,0.1],[44.415,26.146,0.1],[44.421,26.064,0.1],[44.48,26.124,0.1],[44.362,26.152,0.1],[44.427,26.187,0.1],[44.41,26.061,0.1],[44.477,26.05,0.1],[44.406,26.066,0.1],[44.422,26.124,0.1],[44.413,26.198,0.1],[44.419,26.115,0.1],[44.394,26.1,0.1],[44.462,26.131,0.1],[44.459,26.122,0.1],[44.45,26.121,0.1],[44.445,26.081,0.1],[44.436,26.079,0.1],[44.43,26.064,0.1],[44.441,26.078,0.1],[44.406,26.069,0.1],[44.374,26.128,0.1],[44.444,26.154,0.1],[44.453,26.14,0.1],[44.413,26.103,0.1],[44.424,26.019,0.1],[44.477,26.113,0.1],[44.462,26.127,0.1],[44.448,26.022,0.1],[44.413,26.143,0.1],[44.415,26.155,0.1],[44.421,26.073,0.1],[44.468,26.062,0.1],[44.427,26.038,0.1],[44.422,26.13,0.1],[44.427,26.031,0.1],[44.413,26.113,0.1],[44.424,26.022,0.1],[44.457,26.109,0.1],[44.454,26.073,0.1],[44.492,26.069,0.1],[44.422,26.133,0.1],[44.371,26.148,0.1],[44.427,25.974,0.1],[44.361,26.152,0.1],[44.383,26.128,0.1],[44.379,26.1,0.1],[44.462,26.133,0.1],[44.347,26.066,0.1],[44.407,26.094,0.1],[44.392,26.093,0.1],[44.454,26.076,0.1],[44.41,26.073,0.1],[44.466,26.139,0.1],[44.41,26.066,0.1],[44.416,26.128,0.1],[44.422,26.136,0.1],[44.442,26.136,0.1],[44.418,26.14,0.1],[44.409,26.146,0.1],[44.46,26.124,0.1],[44.379,26.103,0.1],[44.447,25.977,0.1],[44.505,26.206,0.1],[44.398,26.143,0.1],[44.419,26.062,0.1],[44.481,26.106,0.1],[44.442,26.049,0.1],[44.422,26.139,0.1],[44.35,26.19,0.1],[44.373,26.189,0.1],[44.431,26.013,0.1],[44.438,26.023,0.1],[44.409,26.202,0.1],[44.419,26.066,0.1],[44.41,26.072,0.1],[44.525,26.209,0.1],[44.445,26.128,0.1],[44.425,26.099,0.1],[44.431,26.106,0.1],[44.447,25.983,0.1],[44.456,25.97,0.1],[44.431,26.009,0.1],[44.407,26.201,0.1],[44.392,26.094,0.1],[44.486,26.108,0.1],[44.424,26.075,0.1],[44.436,26.097,0.1],[44.419,26.069,0.1],[44.415,26.171,0.1],[44.433,26.159,0.1],[44.444,26.067,0.1],[44.46,26.133,0.1],[44.431,26.102,0.1],[44.401,26.099,0.1],[44.427,26.016,0.1],[44.448,26.122,0.1],[44.49,26.116,0.1],[44.418,26.015,0.1],[44.416,26.133,0.1],[44.438,26.16,0.1],[44.422,26.14,0.1],[44.409,26.151,0.1],[44.422,26.118,0.1],[44.442,26.118,0.1],[44.428,26.174,0.1],[44.428,26.076,0.1],[44.418,26.017,0.1],[44.413,26.165,0.1],[44.434,26.084,0.1],[44.439,26.082,0.1],[44.409,26.211,0.1],[44.445,26.09,0.1],[44.441,26.004,0.1],[44.404,26.066,0.1],[44.451,25.988,0.1],[44.454,25.974,0.1],[44.389,26.026,0.1],[44.382,26.097,0.1],[44.412,26.11,0.1],[44.403,26.206,0.1],[44.445,26.1,0.1],[44.368,26.145,0.1],[44.436,26.106,0.1],[44.445,26.093,0.1],[44.436,26.009,0.1],[44.489,26.186,0.1],[44.416,26.139,0.1],[44.412,26.143,0.1],[44.418,26.061,0.1],[44.379,26.121,0.1],[44.441,26.1,0.1],[44.415,26.085,0.1],[44.374,26.151,0.1],[44.478,26.186,0.1],[44.45,26.094,0.1],[44.382,26.125,0.1],[44.388,26.118,0.1],[44.379,26.116,0.1],[44.441,25.983,0.1],[44.391,26.097,0.1],[44.441,26.013,0.1],[44.421,26.103,0.1],[44.431,26.146,0.1],[44.463,26.134,0.1],[44.386,26.134,0.1],[44.386,26.127,0.1],[44.403,26.058,0.1],[44.413,26.072,0.1],[44.478,26.102,0.1],[44.418,26.07,0.1],[44.418,26.062,0.1],[44.415,26.034,0.1],[44.459,26.127,0.1],[44.48,26.121,0.1],[44.439,26.195,0.1],[44.434,26.001,0.1],[44.413,26.172,0.1],[44.383,26.113,0.1],[44.43,26.103,0.1],[44.415,26.192,0.1],[44.362,26.13,0.1],[44.425,26.145,0.1],[44.422,26.166,0.1],[44.438,26.081,0.1],[44.463,26.035,0.1],[44.386,26.133,0.1],[44.407,25.992,0.1],[44.418,26.066,0.1],[44.43,26.136,0.1],[44.415,26.134,0.1],[44.415,26.037,0.1],[44.447,26.157,0.1],[44.493,26.146,0.1],[44.448,26.124,0.1],[44.376,26.187,0.1],[44.434,26.102,0.1],[44.439,26.1,0.1],[44.445,26.205,0.1],[44.413,26.175,0.1],[44.43,26.099,0.1],[44.427,26.168,0.1],[44.401,26.055,0.1],[44.433,26.078,0.1],[44.407,26.062,0.1],[44.409,26.172,0.1],[44.439,26.035,0.1],[44.416,26.026,0.1],[44.453,26.125,0.1],[44.459,26.133,0.1],[44.526,26.041,0.1],[44.421,26.115,0.1],[44.415,26.1,0.1],[44.436,26.019,0.1],[44.508,26.211,0.1],[44.447,26.122,0.1],[44.421,26.108,0.1],[44.431,26.159,0.1],[44.459,26.096,0.1],[44.454,25.988,0.1],[44.465,26.061,0.1],[44.439,26.136,0.1],[44.409,26.078,0.1],[44.395,25.976,0.1],[44.4,26.099,0.1],[44.416,26.029,0.1],[44.469,26.052,0.1],[44.469,26.142,0.1],[44.353,26.145,0.1],[44.433,26.084,0.1],[44.454,26.14,0.1],[44.403,26.066,0.1],[44.457,26.127,0.1],[44.4,26.102,0.1],[44.439,26.012,0.1],[44.439,26.102,0.1],[44.415,26.106,0.1],[44.425,26.067,0.1],[44.416,26.066,0.1],[44.403,26.076,0.1],[44.454,25.986,0.1],[44.457,26.13,0.1],[44.371,26.136,0.1],[44.453,26.127,0.1],[44.413,26.09,0.1],[44.421,26.019,0.1],[44.444,26.096,0.1],[44.415,26.142,0.1],[44.38,26.125,0.1],[44.386,26.118,0.1],[44.415,26.112,0.1],[44.451,26.088,0.1],[44.416,26.072,0.1],[44.418,26.181,0.1],[44.463,26.143,0.1],[44.418,26.084,0.1],[44.45,26.203,0.1],[44.439,26.148,0.1],[44.394,26.125,0.1],[44.43,26.056,0.1],[44.444,26.131,0.1],[44.413,26.193,0.1],[44.377,26.119,0.1],[44.492,26.017,0.1],[44.37,26.183,0.1],[44.442,26.18,0.1],[44.541,26.121,0.1],[44.409,26.19,0.1],[44.46,26.07,0.1],[44.419,26.143,0.1],[44.436,26.165,0.1],[44.468,26.137,0.1],[44.478,26.053,0.1],[44.428,26.1,0.1],[44.445,26.121,0.1],[44.415,26.11,0.1],[44.431,26.079,0.1],[44.407,26.174,0.1],[44.456,26.078,0.1],[44.478,26.064,0.1],[44.468,26.14,0.1],[44.371,26.14,0.1],[44.362,26.149,0.1],[44.425,26.165,0.1],[44.442,26.096,0.1],[44.427,26.177,0.1],[44.412,26.078,0.1],[44.43,26.155,0.1],[44.389,26.131,0.1],[44.468,26.053,0.1],[44.459,26.052,0.1],[44.444,26.05,0.1],[44.415,26.026,0.1],[44.478,26.119,0.1],[44.438,26.006,0.1],[44.481,26.099,0.1],[44.483,26.058,0.1],[44.475,26.174,0.1],[44.486,26.037,0.1],[44.361,26.136,0.1],[44.389,26.202,0.1],[44.395,26.112,0.1],[44.442,26.102,0.1],[44.447,25.965,0.1],[44.385,26.146,0.1],[44.433,26.108,0.1],[44.407,26.093,0.1],[44.433,26.01,0.1],[44.376,26.152,0.1],[44.511,26.022,0.1],[44.413,26.05,0.1],[44.413,26.14,0.1],[44.41,26.064,0.1],[44.457,26.046,0.1],[44.37,26.13,0.1],[44.427,26.133,0.1],[44.468,26.052,0.1],[44.359,26.09,0.1],[44.484,26.073,0.1],[44.444,26.146,0.1],[44.368,26.186,0.1],[44.367,26.154,0.1],[44.49,25.971,0.1],[44.451,26.099,0.1],[44.447,26.125,0.1],[44.544,25.988,0.1],[44.481,26.105,0.1],[44.436,26.172,0.1],[44.416,26.032,0.1],[44.442,26.137,0.1],[44.418,26.044,0.1],[44.46,26.125,0.1],[44.418,26.134,0.1],[44.35,26.091,0.1],[44.431,26.094,0.1],[44.442,26.1,0.1],[44.416,26.085,0.1],[44.516,26.019,0.1],[44.413,26.146,0.1],[44.471,26.094,0.1],[44.424,26.152,0.1],[44.502,26.075,0.1],[44.41,26.062,0.1],[44.37,26.136,0.1],[44.371,26.155,0.1],[44.448,25.991,0.1],[44.376,26.121,0.1],[44.412,26.13,0.1],[44.438,26.047,0.1],[44.428,26.028,0.1],[44.409,26.143,0.1],[44.413,26.019,0.1],[44.373,26.19,0.1],[44.466,26.113,0.1],[44.424,26.122,0.1],[44.398,26.108,0.1],[44.419,26.026,0.1],[44.389,26.203,0.1],[44.395,26.121,0.1],[44.499,26.031,0.1],[44.438,26.108,0.1],[44.436,26.088,0.1],[44.415,26.072,0.1],[44.404,25.991,0.1],[44.493,26.084,0.1],[44.431,26.032,0.1],[44.38,26.145,0.1],[44.371,26.151,0.1],[44.418,26.043,0.1],[44.462,26.046,0.1],[44.436,26.031,0.1],[44.404,26.02,0.1],[44.451,26.1,0.1],[44.347,26.159,0.1],[44.442,26.016,0.1],[44.38,26.115,0.1],[44.407,26.187,0.1],[44.444,26.118,0.1],[44.413,26.062,0.1],[44.413,26.152,0.1],[44.388,26.137,0.1],[44.41,26.076,0.1],[44.477,26.066,0.1],[44.457,25.998,0.1],[44.431,26.035,0.1],[44.385,26.121,0.1],[44.448,26.154,0.1],[44.52,26.061,0.1],[44.46,26.127,0.1],[44.418,26.136,0.1],[44.456,26.041,0.1],[44.361,26.151,0.1],[44.409,26.142,0.1],[44.391,26.079,0.1],[44.413,26.066,0.1],[44.434,26.075,0.1],[44.441,26.093,0.1],[44.466,26.055,0.1],[44.41,26.169,0.1],[44.415,26.168,0.1],[44.474,26.18,0.1],[44.406,26.174,0.1],[44.406,26.076,0.1],[44.427,26.05,0.1],[44.422,26.142,0.1],[44.448,26.0,0.1],[44.433,25.998,0.1],[44.438,25.989,0.1],[44.418,26.139,0.1],[44.45,26.072,0.1],[44.394,26.11,0.1],[44.481,26.052,0.1],[44.433,26.028,0.1],[44.442,26.015,0.1],[44.412,26.199,0.1],[44.48,26.108,0.1],[44.495,26.199,0.1],[44.428,26.168,0.1],[44.419,26.166,0.1],[44.431,26.041,0.1],[44.438,26.157,0.1],[44.471,26.049,0.1],[44.498,26.218,0.1],[44.374,26.116,0.1],[44.412,26.007,0.1],[44.434,26.088,0.1],[44.434,26.081,0.1],[44.481,26.122,0.1],[44.419,26.072,0.1],[44.43,26.175,0.1],[44.462,26.108,0.1],[44.457,26.0,0.1],[44.416,26.043,0.1],[44.418,26.152,0.1],[44.438,26.152,0.1],[44.409,26.061,0.1],[44.383,26.136,0.1],[44.441,26.034,0.1],[44.528,26.04,0.1],[44.416,26.013,0.1],[44.422,26.013,0.1],[44.436,26.193,0.1],[44.421,26.004,0.1],[44.41,26.171,0.1],[44.425,26.04,0.1],[44.37,26.154,0.1],[44.442,26.151,0.1],[44.386,26.125,0.1],[44.541,26.093,0.1],[44.379,26.118,0.1],[44.445,26.032,0.1],[44.436,25.979,0.1],[44.472,26.067,0.1],[44.374,26.122,0.1],[44.416,26.016,0.1],[44.422,26.113,0.1],[44.433,26.029,0.1],[44.412,26.201,0.1],[44.392,26.103,0.1],[44.418,26.02,0.1],[44.428,26.169,0.1],[44.413,26.168,0.1],[44.434,26.087,0.1],[44.462,26.121,0.1],[44.404,26.166,0.1],[44.421,26.097,0.1],[44.415,26.082,0.1],[44.41,26.174,0.1],[44.374,26.155,0.1],[44.37,26.149,0.1],[44.459,26.078,0.1],[44.489,26.038,0.1],[44.489,25.971,0.1],[44.422,26.019,0.1],[44.412,26.016,0.1],[44.386,26.091,0.1],[44.365,26.157,0.1],[44.465,26.11,0.1],[44.444,25.959,0.1],[44.418,26.023,0.1],[44.436,26.102,0.1],[44.436,26.192,0.1],[44.416,26.044,0.1],[44.46,26.047,0.1],[44.456,26.052,0.1],[44.421,26.043,0.1],[44.451,26.121,0.1],[44.421,26.133,0.1],[44.383,26.115,0.1],[44.436,26.105,0.1],[44.519,26.017,0.1],[44.465,26.146,0.1],[44.409,26.066,0.1],[44.456,26.055,0.1],[44.436,26.047,0.1],[44.347,26.085,0.1],[44.376,26.189,0.1],[44.386,26.105,0.1],[44.383,26.118,0.1],[44.365,26.155,0.1],[44.413,26.169,0.1],[44.373,26.152,0.1],[44.424,26.175,0.1],[44.436,26.01,0.1],[44.529,26.177,0.1],[44.385,26.125,0.1],[44.442,26.073,0.1],[44.422,26.066,0.1],[44.438,26.078,0.1],[44.412,26.062,0.1],[44.376,26.124,0.1],[44.386,26.137,0.1],[44.382,26.131,0.1],[44.412,26.145,0.1],[44.386,26.13,0.1],[44.409,26.069,0.1],[44.415,26.131,0.1],[44.431,26.022,0.1],[44.406,25.973,0.1],[44.427,26.026,0.1],[44.454,26.106,0.1],[44.454,26.099,0.1],[44.398,26.163,0.1],[44.451,26.07,0.1],[44.457,26.078,0.1],[44.416,26.061,0.1],[44.406,26.093,0.1],[44.391,26.128,0.1],[44.433,26.075,0.1],[44.407,26.059,0.1],[44.412,26.148,0.1],[44.409,26.079,0.1],[44.46,26.049,0.1],[44.424,26.031,0.1],[44.425,26.025,0.1],[44.456,26.053,0.1],[44.386,26.103,0.1],[44.428,26.184,0.1],[44.454,26.102,0.1],[44.421,26.112,0.1],[44.421,26.015,0.1],[44.441,26.015,0.1],[44.477,26.178,0.1],[44.421,26.195,0.1],[44.48,26.157,0.1],[44.386,26.136,0.1],[44.438,26.166,0.1],[44.45,26.099,0.1],[44.475,26.113,0.1],[44.409,26.082,0.1],[44.434,26.037,0.1],[44.424,26.131,0.1],[44.403,26.059,0.1],[44.425,26.02,0.1],[44.436,25.989,0.1],[44.483,25.979,0.1],[44.397,26.116,0.1],[44.397,26.109,0.1],[44.392,26.121,0.1],[44.444,26.034,0.1],[44.459,26.125,0.1],[44.465,26.118,0.1],[44.41,26.199,0.1],[44.4,25.979,0.1],[44.391,26.134,0.1],[44.434,26.04,0.1],[44.424,26.134,0.1],[44.419,26.038,0.1],[44.445,26.143,0.1],[44.447,26.155,0.1],[44.433,25.956,0.1],[44.434,26.01,0.1],[44.445,26.023,0.1],[44.46,26.115,0.1],[44.377,26.108,0.1],[44.436,26.029,0.1],[44.451,26.072,0.1],[44.427,26.166,0.1],[44.444,26.097,0.1],[44.401,26.053,0.1],[44.45,26.202,0.1],[44.412,26.157,0.1],[44.454,26.05,0.1],[44.434,25.983,0.1],[44.385,26.093,0.1],[44.453,26.124,0.1],[44.43,26.108,0.1],[44.395,26.099,0.1],[44.431,26.165,0.1],[44.442,26.171,0.1],[44.444,26.1,0.1],[44.418,26.085,0.1],[44.412,26.16,0.1],[44.424,26.14,0.1],[44.409,26.174,0.1],[44.419,26.037,0.1],[44.433,26.127,0.1],[44.376,26.102,0.1],[44.444,26.043,0.1],[44.371,26.128,0.1],[44.475,26.066,0.1],[44.434,26.106,0.1],[44.41,26.11,0.1],[44.404,26.096,0.1],[44.487,26.038,0.1],[44.421,26.026,0.1],[44.425,26.062,0.1],[44.442,26.181,0.1],[44.395,26.094,0.1],[44.38,26.093,0.1],[44.38,26.183,0.1],[44.416,26.159,0.1],[44.444,26.006,0.1],[44.505,26.087,0.1],[44.428,26.131,0.1],[44.419,26.047,0.1],[44.424,26.038,0.1],[44.436,26.159,0.1],[44.406,26.05,0.1],[44.453,26.04,0.1],[44.428,26.102,0.1],[44.444,26.128,0.1],[44.425,26.155,0.1],[44.38,26.096,0.1],[44.474,26.019,0.1],[44.412,26.076,0.1],[44.439,26.058,0.1],[44.445,26.155,0.1],[44.419,26.14,0.1],[44.457,26.038,0.1],[44.477,25.979,0.1],[44.425,26.028,0.1],[44.415,26.137,0.1],[44.478,26.058,0.1],[44.382,26.115,0.1],[44.394,26.096,0.1],[44.415,26.017,0.1],[44.415,26.108,0.1],[44.451,26.084,0.1],[44.478,26.118,0.1],[44.416,26.067,0.1],[44.386,26.064,0.1],[44.471,26.181,0.1],[44.439,26.151,0.1],[44.471,26.174,0.1],[44.43,26.059,0.1],[44.415,26.14,0.1],[44.389,26.125,0.1],[44.436,26.0,0.1],[44.468,26.145,0.1],[44.442,26.032,0.1],[44.38,26.131,0.1],[44.444,26.142,0.1],[44.444,25.985,0.1],[44.415,26.02,0.1],[44.385,26.145,0.1],[44.438,26.097,0.1],[44.412,26.172,0.1],[44.4,26.116,0.1],[44.441,26.069,0.1],[44.436,26.16,0.1],[44.406,26.059,0.1],[44.38,26.134,0.1],[44.382,26.121,0.1],[44.444,26.145,0.1],[44.457,26.097,0.1],[44.525,26.038,0.1],[44.407,26.177,0.1],[44.376,26.146,0.1],[44.445,26.067,0.1],[44.474,26.069,0.1],[44.468,26.143,0.1],[44.395,25.982,0.1],[44.438,26.133,0.1],[44.438,26.035,0.1],[44.439,26.029,0.1],[44.419,26.119,0.1],[44.415,26.019,0.1],[44.37,26.184,0.1],[44.433,26.007,0.1],[44.382,26.157,0.1],[44.439,26.16,0.1],[44.35,26.032,0.1],[44.434,26.154,0.1],[44.424,26.061,0.1],[44.445,26.168,0.1],[44.424,26.151,0.1],[44.424,26.143,0.1],[44.37,26.134,0.1],[44.415,26.149,0.1],[44.504,26.085,0.1],[44.442,26.131,0.1],[44.442,26.034,0.1],[44.444,26.053,0.1],[44.371,26.139,0.1],[44.433,26.13,0.1],[44.444,26.046,0.1],[44.49,26.125,0.1],[44.419,26.017,0.1],[44.415,26.029,0.1],[44.389,26.105,0.1],[44.451,26.096,0.1],[44.438,26.106,0.1],[44.438,26.009,0.1],[44.434,26.165,0.1],[44.418,26.001,0.1],[44.412,26.174,0.1],[44.439,26.163,0.1],[44.409,26.195,0.1],[44.419,26.155,0.1],[44.507,26.214,0.1],[44.373,26.124,0.1],[44.445,26.073,0.1],[44.395,26.152,0.1],[44.379,26.124,0.1],[44.38,26.143,0.1],[44.406,26.061,0.1],[44.457,25.979,0.1],[44.371,26.149,0.1],[44.438,26.139,0.1],[44.412,26.124,0.1],[44.486,26.04,0.1],[44.444,25.989,0.1],[44.379,26.102,0.1],[44.398,26.102,0.1],[44.379,26.094,0.1],[44.38,26.106,0.1],[44.422,26.097,0.1],[44.448,26.202,0.1],[44.438,26.109,0.1],[44.463,26.072,0.1],[44.412,26.087,0.1],[44.407,26.178,0.1],[44.412,26.177,0.1],[44.49,26.189,0.1],[44.41,26.165,0.1],[44.43,26.165,0.1],[44.441,26.081,0.1],[44.442,26.047,0.1],[44.421,26.163,0.1],[44.504,26.091,0.1],[44.406,26.064,0.1],[44.51,26.091,0.1],[44.444,26.059,0.1],[44.409,26.14,0.1],[44.413,26.106,0.1],[44.398,26.105,0.1],[44.419,26.023,0.1],[44.481,26.047,0.1],[44.379,26.097,0.1],[44.492,26.118,0.1],[44.38,26.116,0.1],[44.451,26.094,0.1],[44.438,26.112,0.1],[44.463,26.075,0.1],[44.407,26.091,0.1],[44.495,26.097,0.1],[44.428,26.066,0.1],[44.454,26.081,0.1],[44.486,26.201,0.1],[44.511,26.02,0.1],[44.445,26.079,0.1],[44.43,26.168,0.1],[44.441,26.181,0.1],[44.41,26.07,0.1],[44.394,25.982,0.1],[44.436,26.175,0.1],[44.431,25.977,0.1],[44.448,25.998,0.1],[44.442,26.043,0.1],[44.504,26.087,0.1],[44.418,26.047,0.1],[44.418,26.137,0.1],[44.456,26.125,0.1],[44.472,26.049,0.1],[44.48,26.099,0.1],[44.403,26.009,0.1],[44.434,26.166,0.1],[44.388,26.127,0.1],[44.441,26.184,0.1],[44.37,26.146,0.1],[44.406,26.078,0.1],[44.508,26.085,0.1],[44.442,26.046,0.1],[44.453,26.052,0.1],[44.48,26.041,0.1],[44.359,26.091,0.1],[44.459,26.0,0.1],[44.481,26.053,0.1],[44.456,26.128,0.1],[44.431,26.1,0.1],[44.442,26.113,0.1],[44.395,26.026,0.1],[44.416,26.189,0.1],[44.535,26.062,0.1],[44.427,26.097,0.1],[44.434,26.169,0.1],[44.445,26.085,0.1],[44.409,26.199,0.1],[44.466,26.142,0.1],[44.404,25.994,0.1],[44.415,26.067,0.1],[44.422,26.049,0.1],[44.371,26.154,0.1],[44.418,26.143,0.1],[44.418,26.046,0.1],[44.394,26.115,0.1],[44.403,25.977,0.1],[44.388,26.003,0.1],[44.436,26.034,0.1],[44.441,26.032,0.1],[44.442,26.116,0.1],[44.453,26.122,0.1],[44.359,26.134,0.1],[44.383,26.097,0.1],[44.424,26.169,0.1],[44.424,26.072,0.1],[44.436,26.184,0.1],[44.436,26.087,0.1],[44.442,26.142,0.1],[44.412,26.139,0.1],[44.442,25.985,0.1],[44.444,26.162,0.1],[44.444,26.064,0.1],[44.383,26.137,0.1],[44.409,26.145,0.1],[44.441,26.035,0.1],[44.528,26.041,0.1],[44.416,26.187,0.1],[44.392,26.004,0.1],[44.505,26.212,0.1],[44.382,26.081,0.1],[44.46,26.1,0.1],[44.383,26.1,0.1],[44.413,26.151,0.1],[44.466,26.155,0.1],[44.424,26.165,0.1],[44.466,26.148,0.1],[44.41,26.075,0.1],[44.457,26.064,0.1],[44.416,26.137,0.1],[44.406,26.079,0.1],[44.474,26.175,0.1],[44.422,26.145,0.1],[44.469,26.18,0.1],[44.48,26.043,0.1],[44.444,26.157,0.1],[44.431,26.109,0.1],[44.441,26.031,0.1],[44.442,26.115,0.1],[44.422,26.017,0.1],[44.442,26.017,0.1],[44.418,26.119,0.1],[44.453,26.121,0.1],[44.438,26.119,0.1],[44.386,26.09,0.1],[44.409,26.118,0.1],[44.456,26.108,0.1],[44.439,26.079,0.1],[44.413,26.064,0.1],[44.419,26.169,0.1],[44.413,26.154,0.1],[44.388,26.139,0.1],[44.436,26.1,0.1],[44.441,26.099,0.1],[44.424,26.07,0.1],[44.441,26.091,0.1],[44.453,26.072,0.1],[44.444,26.078,0.1],[44.412,26.137,0.1],[44.46,26.136,0.1],[44.394,26.026,0.1],[44.456,26.14,0.1],[44.431,26.105,0.1],[44.416,26.103,0.1],[44.391,26.081,0.1],[44.427,26.109,0.1],[44.412,26.108,0.1],[44.418,26.025,0.1],[44.471,26.209,0.1],[44.383,26.106,0.1],[44.404,26.171,0.1],[44.441,26.102,0.1],[44.451,26.145,0.1],[44.358,26.094,0.1],[44.431,25.988,0.1],[44.453,26.075,0.1],[44.406,26.175,0.1],[44.45,26.088,0.1],[44.403,26.056,0.1],[44.454,26.124,0.1],[44.495,26.118,0.1],[44.386,26.096,0.1],[44.365,26.154,0.1],[44.392,26.006,0.1],[44.424,26.084,0.1],[44.456,26.106,0.1],[44.425,26.043,0.1],[44.447,26.202,0.1],[44.37,26.157,0.1],[44.468,26.177,0.1],[44.427,26.055,0.1],[44.459,26.175,0.1],[44.45,26.091,0.1],[44.444,26.166,0.1],[44.388,26.025,0.1],[44.45,26.084,0.1],[44.471,26.058,0.1],[44.403,26.052,0.1],[44.377,26.127,0.1],[44.409,26.059,0.1],[44.471,26.05,0.1],[44.422,26.026,0.1],[44.359,26.149,0.1],[44.418,26.121,0.1],[44.45,26.124,0.1],[44.434,26.09,0.1],[44.43,26.004,0.1],[44.413,26.163,0.1],[44.436,26.109,0.1],[44.441,26.108,0.1],[44.373,25.982,0.1],[44.502,26.091,0.1],[44.425,26.046,0.1],[44.406,26.091,0.1],[44.442,26.067,0.1],[44.453,26.081,0.1],[44.406,26.181,0.1],[44.422,26.059,0.1],[44.433,26.163,0.1],[44.438,26.162,0.1],[44.418,26.064,0.1],[44.454,26.04,0.1],[44.45,26.087,0.1],[44.386,26.124,0.1],[44.445,26.136,0.1],[44.465,26.136,0.1],[44.409,26.062,0.1],[44.406,26.124,0.1],[44.427,26.118,0.1],[44.382,26.096,0.1],[44.392,26.109,0.1],[44.484,26.038,0.1],[44.428,26.175,0.1],[44.365,26.152,0.1],[44.413,26.076,0.1],[44.388,26.061,0.1],[44.43,26.097,0.1],[44.492,26.088,0.1],[44.424,26.082,0.1],[44.441,26.103,0.1],[44.425,26.049,0.1],[44.441,26.006,0.1],[44.415,26.178,0.1],[44.422,26.16,0.1],[44.442,26.16,0.1],[44.374,26.154,0.1],[44.358,26.096,0.1],[44.448,26.078,0.1],[44.416,26.047,0.1],[44.474,26.183,0.1],[44.422,26.152,0.1],[44.438,26.075,0.1],[44.511,26.088,0.1],[44.407,26.143,0.1],[44.48,26.05,0.1],[44.441,26.046,0.1],[44.421,26.038,0.1],[44.364,26.151,0.1],[44.422,26.122,0.1],[44.397,26.108,0.1],[44.391,26.093,0.1],[44.427,26.121,0.1],[44.382,26.099,0.1],[44.495,26.119,0.1],[44.439,26.004,0.1],[44.413,26.177,0.1],[44.377,26.103,0.1],[44.388,26.064,0.1],[44.368,26.154,0.1],[44.43,26.01,0.1],[44.43,26.093,0.1],[44.389,26.076,0.1],[44.415,26.181,0.1],[44.493,26.201,0.1],[44.442,26.163,0.1],[44.416,26.148,0.1],[44.391,26.133,0.1],[44.359,26.028,0.1],[44.412,26.152,0.1],[44.511,26.091,0.1],[44.407,26.146,0.1],[44.45,26.093,0.1],[44.409,26.166,0.1],[44.388,26.116,0.1],[44.43,25.976,0.1],[44.436,25.983,0.1],[44.421,26.041,0.1],[44.391,26.096,0.1],[44.495,26.122,0.1],[44.465,26.022,0.1],[44.413,26.082,0.1],[44.41,26.193,0.1],[44.379,26.163,0.1],[44.43,26.096,0.1],[44.466,26.072,0.1],[44.431,26.062,0.1],[44.468,26.091,0.1],[44.442,26.076,0.1],[44.427,26.067,0.1],[44.416,26.143,0.1],[44.454,26.041,0.1],[44.439,26.04,0.1],[44.409,26.169,0.1],[44.445,26.145,0.1],[44.436,25.994,0.1],[44.41,26.128,0.1],[44.421,25.985,0.1],[44.397,26.113,0.1],[44.478,26.137,0.1],[44.377,26.109,0.1],[44.441,26.022,0.1],[44.517,26.015,0.1],[44.416,26.064,0.1],[44.493,26.199,0.1],[44.442,26.169,0.1],[44.448,26.087,0.1],[44.391,26.131,0.1],[44.52,26.181,0.1],[44.422,26.064,0.1],[44.438,26.174,0.1],[44.463,26.136,0.1],[44.454,26.052,0.1],[44.412,26.151,0.1],[44.511,26.09,0.1],[44.46,26.059,0.1],[44.419,26.133,0.1],[44.454,26.134,0.1],[44.507,26.094,0.1],[44.409,26.165,0.1],[44.383,26.149,0.1],[44.445,25.983,0.1],[44.4,26.103,0.1],[44.395,26.032,0.1],[44.415,26.032,0.1],[44.358,26.137,0.1],[44.428,26.097,0.1],[44.463,26.099,0.1],[44.439,26.103,0.1],[44.377,26.105,0.1],[44.368,26.155,0.1],[44.415,26.198,0.1],[44.421,26.017,0.1],[44.415,26.19,0.1],[44.499,26.029,0.1],[44.442,26.172,0.1],[44.504,26.215,0.1],[44.453,26.088,0.1],[44.484,26.11,0.1],[44.418,26.079,0.1],[44.428,26.13,0.1],[44.45,26.102,0.1],[44.511,26.093,0.1],[44.346,26.085,0.1],[44.434,25.98,0.1],[44.471,26.069,0.1],[44.439,25.979,0.1],[44.462,26.075,0.1],[44.373,26.116,0.1],[44.425,26.121,0.1],[44.425,26.023,0.1],[44.436,25.992,0.1],[44.415,26.035,0.1],[44.416,26.119,0.1],[44.474,26.047,0.1],[44.385,26.09,0.1],[44.401,26.208,0.1],[44.434,26.108,0.1],[44.526,26.037,0.1],[44.419,26.001,0.1],[44.368,26.159,0.1],[44.492,26.096,0.1],[44.431,26.169,0.1],[44.421,26.11,0.1],[44.395,26.096,0.1],[44.431,26.072,0.1],[44.425,25.989,0.1],[44.478,26.106,0.1],[44.376,26.046,0.1],[44.505,26.088,0.1],[44.438,26.172,0.1],[44.445,26.056,0.1],[44.409,26.171,0.1],[44.43,26.137,0.1],[44.483,26.044,0.1],[44.416,26.122,0.1],[44.397,26.115,0.1],[44.504,25.997,0.1],[44.444,25.973,0.1],[44.434,26.103,0.1],[44.404,26.093,0.1],[44.389,26.091,0.1],[44.415,26.196,0.1],[44.508,26.217,0.1],[44.421,26.113,0.1],[44.442,26.088,0.1],[44.474,26.11,0.1],[44.401,26.154,0.1],[44.407,26.072,0.1],[44.428,26.136,0.1],[44.361,26.093,0.1],[44.481,26.088,0.1],[44.413,25.97,0.1],[44.434,25.979,0.1],[44.507,26.096,0.1],[44.421,26.154,0.1],[44.489,26.062,0.1],[44.468,26.046,0.1],[44.38,26.13,0.1],[44.416,26.215,0.1],[44.401,26.116,0.1],[44.444,26.133,0.1],[44.444,25.976,0.1],[44.434,26.016,0.1],[44.445,26.119,0.1],[44.419,26.105,0.1],[44.439,26.105,0.1],[44.415,26.109,0.1],[44.436,26.028,0.1],[44.416,26.166,0.1],[44.425,25.995,0.1],[44.412,26.163,0.1],[44.434,26.056,0.1],[44.428,26.041,0.1],[44.471,26.175,0.1],[44.462,26.076,0.1],[44.442,26.124,0.1],[44.448,26.131,0.1],[44.382,26.119,0.1],[44.469,26.061,0.1],[44.459,26.137,0.1],[44.439,26.115,0.1],[44.409,26.127,0.1],[44.419,26.01,0.1],[44.413,26.183,0.1],[44.424,26.099,0.1],[44.43,26.016,0.1],[44.404,26.189,0.1],[44.523,25.95,0.1],[44.451,26.081,0.1],[44.463,26.061,0.1],[44.422,26.169,0.1],[44.469,26.023,0.1],[44.433,26.085,0.1],[44.407,26.07,0.1],[44.505,26.09,0.1],[44.418,26.174,0.1],[44.436,26.162,0.1],[44.421,26.062,0.1],[44.421,26.152,0.1],[44.385,26.102,0.1],[44.448,26.134,0.1],[44.376,26.108,0.1],[44.469,26.056,0.1],[44.424,26.102,0.1],[44.421,26.122,0.1],[44.425,26.069,0.1],[44.385,26.134,0.1],[44.444,26.102,0.1],[44.505,26.093,0.1],[44.428,26.137,0.1],[44.465,26.069,0.1],[44.424,26.142,0.1],[44.362,26.023,0.1],[44.477,26.049,0.1],[44.483,26.056,0.1],[44.38,26.139,0.1],[44.442,26.13,0.1],[44.474,26.062,0.1],[44.385,26.105,0.1],[44.406,26.146,0.1],[44.448,25.98,0.1],[44.51,26.084,0.1],[44.459,26.053,0.1],[44.371,26.137,0.1],[44.444,26.134,0.1],[44.419,26.016,0.1],[44.361,26.134,0.1],[44.439,26.016,0.1],[44.424,26.015,0.1],[44.415,26.118,0.1],[44.424,26.105,0.1],[44.483,26.116,0.1],[44.483,26.109,0.1],[44.442,26.183,0.1],[44.376,26.151,0.1],[44.459,26.113,0.1],[44.412,26.075,0.1],[44.496,26.199,0.1],[44.409,26.088,0.1],[44.424,26.145,0.1],[44.41,26.152,0.1],[44.442,26.133,0.1],[44.442,26.125,0.1],[44.448,26.043,0.1],[44.433,26.041,0.1],[44.433,26.131,0.1],[44.419,26.116,0.1],[44.367,26.152,0.1],[44.419,26.019,0.1],[44.457,26.105,0.1],[44.427,26.184,0.1],[44.444,26.017,0.1],[44.45,26.122,0.1],[44.386,26.062,0.1],[44.46,26.076,0.1],[44.43,26.066,0.1],[44.398,25.976,0.1],[44.419,26.142,0.1],[44.415,26.154,0.1],[44.436,26.163,0.1],[44.477,26.047,0.1],[44.421,26.162,0.1],[44.483,26.055,0.1],[44.37,26.124,0.1],[44.448,25.986,0.1],[44.343,26.152,0.1],[44.428,26.016,0.1],[44.434,26.023,0.1],[44.398,26.103,0.0],[44.368,26.18,0.0],[44.379,26.096,0.0],[44.492,26.116,0.0],[44.404,26.201,0.0],[44.451,26.003,0.0],[44.37,26.102,0.0],[44.466,26.094,0.0],[44.451,26.183,0.0],[44.395,26.109,0.0],[44.38,26.108,0.0],[44.448,26.106,0.0],[44.416,26.076,0.0],[44.412,26.088,0.0],[44.407,26.18,0.0],[44.376,26.149,0.0],[44.412,26.178,0.0],[44.392,26.081,0.0],[44.495,26.088,0.0],[44.407,26.172,0.0],[44.434,26.162,0.0],[44.496,26.205,0.0],[44.465,26.175,0.0],[44.413,26.145,0.0],[44.454,26.064,0.0],[44.441,26.172,0.0],[44.472,26.105,0.0],[44.4,26.122,0.0],[44.41,26.151,0.0],[44.431,26.125,0.0],[44.468,26.049,0.0],[44.427,26.032,0.0],[44.444,26.143,0.0],[44.365,26.184,0.0],[44.394,26.01,0.0],[44.388,26.085,0.0],[44.367,26.151,0.0],[44.492,26.119,0.0],[44.379,26.189,0.0],[44.43,26.121,0.0],[44.374,26.103,0.0],[44.498,26.217,0.0],[44.389,26.007,0.0],[44.422,26.192,0.0],[44.371,26.116,0.0],[44.407,26.085,0.0],[44.438,26.099,0.0],[44.407,26.175,0.0],[44.418,26.189,0.0],[44.49,26.193,0.0],[44.419,26.058,0.0],[44.466,26.047,0.0],[44.441,26.175,0.0],[44.456,26.079,0.0],[44.431,26.128,0.0],[44.385,26.026,0.0],[44.453,26.148,0.0],[44.427,26.125,0.0],[44.418,26.041,0.0],[44.453,25.983,0.0],[44.495,26.124,0.0],[44.388,26.096,0.0],[44.434,26.029,0.0],[44.409,26.137,0.0],[44.481,26.044,0.0],[44.415,26.122,0.0],[44.41,26.214,0.0],[44.472,26.05,0.0],[44.431,26.001,0.0],[44.415,26.025,0.0],[44.389,26.01,0.0],[44.391,26.075,0.0],[44.371,26.119,0.0],[44.433,26.11,0.0],[44.416,26.082,0.0],[44.453,26.11,0.0],[44.427,26.096,0.0],[44.382,26.171,0.0],[44.434,26.168,0.0],[44.418,26.004,0.0],[44.445,26.084,0.0],[44.428,26.145,0.0],[44.439,26.159,0.0],[44.419,26.061,0.0],[44.404,26.059,0.0],[44.507,26.209,0.0],[44.462,26.097,0.0],[44.37,26.14,0.0],[44.431,26.131,0.0],[44.404,25.985,0.0],[44.474,26.07,0.0],[44.422,26.04,0.0],[44.438,26.052,0.0],[44.469,26.172,0.0],[44.383,26.125,0.0],[44.379,26.105,0.0],[44.409,26.133,0.0],[44.398,26.007,0.0],[44.431,26.192,0.0],[44.37,26.193,0.0],[44.448,26.115,0.0],[44.427,26.189,0.0],[44.376,26.159,0.0],[44.422,26.093,0.0],[44.505,26.208,0.0],[44.438,26.015,0.0],[44.418,26.007,0.0],[44.412,26.18,0.0],[44.444,26.112,0.0],[44.392,26.082,0.0],[44.418,26.097,0.0],[44.365,26.133,0.0],[44.428,26.148,0.0],[44.424,26.062,0.0],[44.445,26.169,0.0],[44.368,26.124,0.0],[44.415,26.166,0.0],[44.424,25.995,0.0],[44.37,26.143,0.0],[44.483,26.165,0.0],[44.431,26.134,0.0],[44.472,26.106,0.0],[44.385,26.122,0.0],[44.406,26.165,0.0],[44.468,26.058,0.0],[44.478,26.072,0.0],[44.453,26.146,0.0],[44.427,26.131,0.0],[44.438,25.988,0.0],[44.407,26.124,0.0],[44.359,26.088,0.0],[44.444,26.055,0.0],[44.388,26.102,0.0],[44.477,26.029,0.0],[44.456,25.968,0.0],[44.425,26.18,0.0],[44.442,26.013,0.0],[44.438,26.115,0.0],[44.433,26.019,0.0],[44.416,26.178,0.0],[44.427,26.094,0.0],[44.463,26.07,0.0],[44.419,26.165,0.0],[44.419,26.067,0.0],[44.424,26.066,0.0],[44.398,25.991,0.0],[44.43,26.171,0.0],[44.379,26.14,0.0],[44.466,26.146,0.0],[44.419,26.0,0.0],[44.404,26.058,0.0],[44.466,26.049,0.0],[44.441,26.177,0.0],[44.415,26.064,0.0],[44.484,26.09,0.0],[44.416,26.031,0.0],[44.427,26.044,0.0],[44.427,26.134,0.0],[44.475,26.186,0.0],[44.469,26.171,0.0],[44.383,26.131,0.0],[44.413,26.112,0.0],[44.383,26.124,0.0],[44.481,26.046,0.0],[44.404,26.208,0.0],[44.38,26.122,0.0],[44.447,26.037,0.0],[44.447,26.127,0.0],[44.448,26.121,0.0],[44.365,26.146,0.0],[44.463,26.073,0.0],[44.438,26.013,0.0],[44.465,26.183,0.0],[44.419,26.07,0.0],[44.456,26.099,0.0],[44.424,26.069,0.0],[44.373,26.128,0.0],[44.466,26.052,0.0],[44.425,26.035,0.0],[44.43,26.166,0.0],[44.379,26.136,0.0],[44.374,26.148,0.0],[44.421,26.172,0.0],[44.442,25.989,0.0],[44.416,26.124,0.0],[44.427,26.04,0.0],[44.444,26.159,0.0],[44.433,25.988,0.0],[44.388,26.108,0.0],[44.541,26.171,0.0],[44.388,26.1,0.0],[44.398,26.113,0.0],[44.487,26.064,0.0],[44.367,26.159,0.0],[44.496,25.991,0.0],[44.436,26.124,0.0],[44.422,26.109,0.0],[44.454,26.082,0.0],[44.428,26.067,0.0],[44.434,26.172,0.0],[44.471,26.103,0.0],[44.436,26.094,0.0],[44.43,26.169,0.0],[44.441,26.183,0.0],[44.457,26.159,0.0],[44.466,26.145,0.0],[44.457,26.061,0.0],[44.451,25.986,0.0],[44.483,26.166,0.0],[44.478,26.178,0.0],[44.397,26.127,0.0],[44.416,26.127,0.0],[44.371,26.157,0.0],[44.45,26.079,0.0],[44.413,26.028,0.0],[44.481,26.059,0.0],[44.388,26.006,0.0],[44.37,26.115,0.0],[44.457,26.121,0.0],[44.442,26.119,0.0],[44.442,26.112,0.0],[44.448,26.119,0.0],[44.418,26.116,0.0],[44.401,26.088,0.0],[44.407,26.096,0.0],[44.439,26.174,0.0],[44.424,26.172,0.0],[44.41,26.082,0.0],[44.466,26.058,0.0],[44.425,26.124,0.0],[44.448,26.07,0.0],[44.416,26.13,0.0],[44.422,26.047,0.0],[44.484,26.091,0.0],[44.459,26.076,0.0],[44.444,26.075,0.0],[44.422,26.137,0.0],[44.392,26.127,0.0],[44.388,26.106,0.0],[44.398,26.119,0.0],[44.466,26.118,0.0],[44.456,26.04,0.0],[44.456,26.13,0.0],[44.487,26.062,0.0],[44.425,26.094,0.0],[44.422,26.115,0.0],[44.447,25.979,0.0],[44.427,26.113,0.0],[44.422,26.108,0.0],[44.438,26.029,0.0],[44.392,26.007,0.0],[44.428,26.171,0.0],[44.365,26.148,0.0],[44.439,26.087,0.0],[44.413,26.162,0.0],[44.361,26.029,0.0],[44.383,26.193,0.0],[44.466,26.159,0.0],[44.462,26.115,0.0],[44.424,26.168,0.0],[44.445,26.087,0.0],[44.404,26.07,0.0],[44.41,26.175,0.0],[44.498,26.181,0.0],[44.457,26.067,0.0],[44.489,26.187,0.0],[44.37,26.151,0.0],[44.38,26.165,0.0],[44.433,26.162,0.0],[44.469,26.093,0.0],[44.365,26.118,0.0],[44.475,26.1,0.0],[44.454,26.128,0.0],[44.511,26.076,0.0],[44.444,26.07,0.0],[44.444,26.16,0.0],[44.392,26.13,0.0],[44.398,26.122,0.0],[44.481,26.058,0.0],[44.441,26.041,0.0],[44.421,26.124,0.0],[44.489,26.13,0.0],[44.364,26.139,0.0],[44.442,26.02,0.0],[44.376,26.177,0.0],[44.422,26.11,0.0],[44.433,26.026,0.0],[44.365,26.151,0.0],[44.359,26.136,0.0],[44.434,26.174,0.0],[44.481,26.118,0.0],[44.415,26.087,0.0],[44.492,26.079,0.0],[44.421,26.094,0.0],[44.374,26.152,0.0],[44.448,26.076,0.0],[44.474,26.181,0.0],[44.416,26.136,0.0],[44.478,26.18,0.0],[44.463,26.125,0.0],[44.453,26.067,0.0],[44.397,26.128,0.0],[44.382,26.127,0.0],[44.51,26.202,0.0],[44.471,26.055,0.0],[44.46,26.131,0.0],[44.377,26.124,0.0],[44.43,26.128,0.0],[44.441,26.044,0.0],[44.431,26.108,0.0],[44.416,26.106,0.0],[44.422,26.016,0.0],[44.484,26.04,0.0],[44.418,26.028,0.0],[44.505,26.214,0.0],[44.383,26.109,0.0],[44.439,26.085,0.0],[44.419,26.175,0.0],[44.383,26.102,0.0],[44.492,26.082,0.0],[44.424,26.076,0.0],[44.431,26.058,0.0],[44.38,26.171,0.0],[44.415,26.172,0.0],[44.451,26.148,0.0],[44.448,26.079,0.0],[44.416,26.049,0.0],[44.391,26.124,0.0],[44.407,26.145,0.0],[44.427,26.145,0.0],[44.475,26.106,0.0],[44.439,26.125,0.0],[44.367,26.181,0.0],[44.409,26.157,0.0],[44.398,26.121,0.0],[44.436,26.139,0.0],[44.421,26.04,0.0],[44.37,26.217,0.0],[44.421,26.13,0.0],[44.416,26.019,0.0],[44.374,26.118,0.0],[44.427,26.122,0.0],[44.382,26.1,0.0],[44.391,26.087,0.0],[44.427,26.017,0.0],[44.46,26.112,0.0],[44.413,26.171,0.0],[44.428,26.075,0.0],[44.465,26.103,0.0],[44.413,26.073,0.0],[44.383,26.105,0.0],[44.35,26.05,0.0],[44.451,26.151,0.0],[44.447,26.108,0.0],[44.425,26.038,0.0],[44.37,26.152,0.0],[44.397,25.977,0.0],[44.463,26.124,0.0],[44.407,25.991,0.0],[44.475,26.102,0.0],[44.409,26.07,0.0],[44.403,26.055,0.0],[44.368,26.11,0.0],[44.498,25.976,0.0],[44.431,26.023,0.0],[44.441,26.133,0.0],[44.436,25.977,0.0],[44.493,26.13,0.0],[44.382,26.103,0.0],[44.416,26.105,0.0],[44.407,26.208,0.0],[44.359,26.152,0.0],[44.386,26.094,0.0],[44.392,26.012,0.0],[44.465,26.106,0.0],[44.541,25.974,0.0],[44.383,26.108,0.0],[44.436,26.112,0.0],[44.441,26.11,0.0],[44.436,26.015,0.0],[44.419,26.174,0.0],[44.462,26.119,0.0],[44.477,26.169,0.0],[44.364,26.02,0.0],[44.514,26.019,0.0],[44.425,26.041,0.0],[44.37,26.155,0.0],[44.38,26.169,0.0],[44.391,26.13,0.0],[44.453,26.076,0.0],[44.418,26.165,0.0],[44.412,26.149,0.0],[44.463,26.127,0.0],[44.401,25.979,0.0],[44.454,26.043,0.0],[44.444,26.172,0.0],[44.412,26.142,0.0],[44.409,26.073,0.0],[44.434,26.035,0.0],[44.418,26.0,0.0],[44.445,26.139,0.0],[44.439,26.124,0.0],[44.462,26.07,0.0],[44.373,26.112,0.0],[44.472,26.174,0.0],[44.425,26.019,0.0],[44.421,26.046,0.0],[44.431,26.026,0.0],[44.436,25.98,0.0],[44.441,25.979,0.0],[44.385,26.085,0.0],[44.422,26.025,0.0],[44.459,26.124,0.0],[44.501,26.07,0.0],[44.382,26.001,0.0],[44.46,26.11,0.0],[44.434,26.096,0.0],[44.392,26.105,0.0],[44.439,26.094,0.0],[44.517,26.016,0.0],[44.445,26.102,0.0],[44.404,26.085,0.0],[44.404,26.175,0.0],[44.436,26.108,0.0],[44.404,26.078,0.0],[44.492,26.084,0.0],[44.499,26.208,0.0],[44.463,26.137,0.0],[44.442,26.066,0.0],[44.453,26.079,0.0],[44.371,26.178,0.0],[44.463,26.04,0.0],[44.439,26.134,0.0],[44.434,26.038,0.0],[44.439,25.977,0.0],[44.367,26.093,0.0],[44.445,26.142,0.0],[44.456,26.058,0.0],[44.383,26.143,0.0],[44.445,26.134,0.0],[44.395,26.124,0.0],[44.391,26.103,0.0],[44.416,26.02,0.0],[44.416,26.11,0.0],[44.376,26.094,0.0],[44.468,25.963,0.0],[44.463,26.19,0.0],[44.469,26.14,0.0],[44.448,25.956,0.0],[44.526,26.035,0.0],[44.382,26.004,0.0],[44.439,26.007,0.0],[44.383,26.121,0.0],[44.418,26.122,0.0],[44.413,26.075,0.0],[44.492,26.094,0.0],[44.404,26.178,0.0],[44.43,26.006,0.0],[44.424,26.178,0.0],[44.404,26.081,0.0],[44.436,26.013,0.0],[44.431,26.16,0.0],[44.442,26.166,0.0],[44.459,26.097,0.0],[44.433,26.082,0.0],[44.442,26.069,0.0],[44.474,26.189,0.0],[44.407,26.157,0.0],[44.433,26.165,0.0],[44.392,26.05,0.0],[44.424,26.128,0.0],[44.367,26.186,0.0],[44.445,25.988,0.0],[44.439,26.032,0.0],[44.445,26.137,0.0],[44.415,26.127,0.0],[44.415,25.97,0.0],[44.539,26.171,0.0],[44.371,26.124,0.0],[44.459,26.13,0.0],[44.469,26.143,0.0],[44.454,26.109,0.0],[44.428,26.094,0.0],[44.444,26.031,0.0],[44.383,26.026,0.0],[44.428,26.177,0.0],[44.361,25.963,0.0],[44.43,26.106,0.0],[44.41,26.196,0.0],[44.424,26.181,0.0],[44.447,26.029,0.0],[44.451,26.073,0.0],[44.431,26.163,0.0],[44.431,26.155,0.0],[44.422,26.072,0.0],[44.478,26.1,0.0],[44.397,26.146,0.0],[44.433,26.175,0.0],[44.382,26.145,0.0],[44.416,26.146,0.0],[44.444,26.091,0.0],[44.412,26.061,0.0],[44.433,26.168,0.0],[44.418,26.166,0.0],[44.424,26.034,0.0],[44.419,26.125,0.0],[44.436,26.146,0.0],[44.385,26.094,0.0],[44.478,26.043,0.0],[44.536,26.145,0.0],[44.454,26.105,0.0],[44.361,26.124,0.0],[44.439,26.006,0.0],[44.413,26.178,0.0],[44.434,26.097,0.0],[44.394,26.081,0.0],[44.43,26.109,0.0],[44.441,26.025,0.0],[44.373,26.154,0.0],[44.404,26.087,0.0],[44.38,26.091,0.0],[44.493,26.202,0.0],[44.4,26.128,0.0],[44.382,26.148,0.0],[44.412,26.162,0.0],[44.371,26.18,0.0],[44.433,26.171,0.0],[44.531,26.19,0.0],[44.454,26.145,0.0],[44.412,26.154,0.0],[44.418,26.072,0.0],[44.496,26.091,0.0],[44.454,26.047,0.0],[44.383,26.152,0.0],[44.487,26.187,0.0],[44.419,26.128,0.0],[44.445,25.986,0.0],[44.415,26.133,0.0],[44.421,26.14,0.0],[44.395,26.125,0.0],[44.391,26.105,0.0],[44.376,26.103,0.0],[44.51,26.069,0.0],[44.531,26.043,0.0],[44.46,26.122,0.0],[44.419,26.009,0.0],[44.419,26.099,0.0],[44.538,26.062,0.0],[44.441,26.118,0.0],[44.415,26.103,0.0],[44.441,26.02,0.0],[44.415,26.193,0.0],[44.38,26.094,0.0],[44.421,26.201,0.0],[44.431,26.162,0.0],[44.416,26.16,0.0],[44.427,26.076,0.0],[44.371,26.19,0.0],[44.416,26.152,0.0],[44.504,26.023,0.0],[44.453,26.084,0.0],[44.371,26.183,0.0],[44.454,26.148,0.0],[44.409,26.178,0.0],[44.392,26.149,0.0],[44.361,26.09,0.0],[44.413,26.124,0.0],[44.409,26.081,0.0],[44.471,26.072,0.0],[44.419,26.041,0.0],[44.395,26.038,0.0],[44.385,26.1,0.0],[44.395,26.031,0.0],[44.406,25.985,0.0],[44.478,26.049,0.0],[44.433,26.124,0.0],[44.454,26.118,0.0],[44.365,26.178,0.0],[44.459,26.131,0.0],[44.444,26.13,0.0],[44.434,26.11,0.0],[44.377,26.118,0.0],[44.434,26.013,0.0],[44.428,26.186,0.0],[44.413,26.184,0.0],[44.445,26.116,0.0],[44.419,26.102,0.0],[44.413,26.087,0.0],[44.383,26.028,0.0],[44.477,26.097,0.0],[44.425,26.0,0.0],[44.4,25.985,0.0],[44.422,26.171,0.0],[44.422,26.073,0.0],[44.438,26.085,0.0],[44.382,26.146,0.0],[44.407,26.064,0.0],[44.454,26.053,0.0],[44.377,26.151,0.0],[44.419,26.134,0.0],[44.346,26.084,0.0],[44.424,26.035,0.0],[44.43,26.14,0.0],[44.539,26.093,0.0],[44.425,26.119,0.0],[44.406,26.047,0.0],[44.376,26.109,0.0],[44.463,26.115,0.0],[44.448,26.128,0.0],[44.45,26.05,0.0],[44.428,26.099,0.0],[44.386,26.108,0.0],[44.424,26.013,0.0],[44.388,26.075,0.0],[44.424,26.103,0.0],[44.425,26.07,0.0],[44.415,26.102,0.0],[44.453,26.097,0.0],[44.422,26.174,0.0],[44.397,26.159,0.0],[44.385,26.128,0.0],[44.444,26.103,0.0],[44.438,26.088,0.0],[44.46,26.072,0.0],[44.469,26.11,0.0],[44.45,26.201,0.0],[44.377,26.146,0.0],[44.415,26.052,0.0],[44.441,26.157,0.0],[44.421,26.059,0.0],[44.453,26.13,0.0],[44.474,26.049,0.0],[44.484,26.062,0.0],[44.502,26.215,0.0],[44.477,26.103,0.0],[44.425,26.066,0.0],[44.433,26.19,0.0],[44.442,26.177,0.0],[44.453,26.003,0.0],[44.427,26.175,0.0],[44.459,26.108,0.0],[44.444,26.009,0.0],[44.471,26.178,0.0],[44.428,26.037,0.0],[44.481,26.087,0.0],[44.41,26.146,0.0],[44.441,26.16,0.0],[44.415,26.145,0.0],[44.539,26.099,0.0],[44.385,26.109,0.0],[44.406,26.053,0.0],[44.463,26.121,0.0],[44.382,26.122,0.0],[44.391,26.109,0.0],[44.463,26.113,0.0],[44.418,26.124,0.0],[44.444,25.982,0.0],[44.531,26.047,0.0],[44.444,25.974,0.0],[44.434,26.015,0.0],[44.419,26.013,0.0],[44.502,26.211,0.0],[44.425,26.166,0.0],[44.421,26.025,0.0],[44.489,26.121,0.0],[44.422,26.09,0.0],[44.442,26.09,0.0],[44.433,26.006,0.0],[44.474,26.112,0.0],[44.407,26.081,0.0],[44.453,26.096,0.0],[44.422,26.172,0.0],[44.438,26.094,0.0],[44.469,26.026,0.0],[44.418,26.184,0.0],[44.495,26.177,0.0],[44.427,26.171,0.0],[44.412,26.169,0.0],[44.407,26.073,0.0],[44.46,26.078,0.0],[44.419,26.046,0.0],[44.481,26.09,0.0],[44.456,26.075,0.0],[44.532,26.067,0.0],[44.487,26.195,0.0],[44.43,26.149,0.0],[44.477,26.139,0.0],[44.41,26.142,0.0],[44.406,26.056,0.0],[44.451,25.959,0.0],[44.499,26.07,0.0],[44.474,26.055,0.0],[44.463,26.116,0.0],[44.442,25.965,0.0],[44.531,26.058,0.0],[44.376,26.201,0.0],[44.438,26.037,0.0],[44.433,26.128,0.0],[44.418,26.127,0.0],[44.433,26.031,0.0],[44.386,26.116,0.0],[44.434,26.115,0.0],[44.444,25.977,0.0],[44.43,26.119,0.0],[44.41,26.202,0.0],[44.523,25.956,0.0],[44.477,26.102,0.0],[44.421,26.028,0.0],[44.421,26.118,0.0],[44.493,26.122,0.0],[44.468,26.108,0.0],[44.478,26.121,0.0],[44.416,26.168,0.0],[44.495,26.09,0.0],[44.453,26.099,0.0],[44.397,26.16,0.0],[44.407,26.076,0.0],[44.486,26.096,0.0],[44.428,26.05,0.0],[44.434,26.155,0.0],[44.409,26.096,0.0],[44.434,26.058,0.0],[44.465,26.072,0.0],[44.436,26.168,0.0],[44.362,26.116,0.0],[44.436,26.07,0.0],[44.415,26.143,0.0],[44.504,26.079,0.0],[44.427,26.124,0.0],[44.406,25.992,0.0],[44.463,26.119,0.0],[44.438,26.13,0.0],[44.444,25.988,0.0],[44.444,26.137,0.0],[44.413,26.199,0.0],[44.536,26.061,0.0],[44.444,25.98,0.0],[44.368,26.177,0.0],[44.413,26.192,0.0],[44.424,26.017,0.0],[44.415,26.121,0.0],[44.373,26.168,0.0],[44.415,26.113,0.0],[44.395,26.106,0.0],[44.416,26.081,0.0],[44.376,26.154,0.0],[44.407,26.087,0.0],[44.416,26.073,0.0],[44.453,26.102,0.0],[44.419,26.059,0.0],[44.377,26.159,0.0],[44.409,26.091,0.0],[44.462,26.096,0.0],[44.436,26.171,0.0],[44.457,26.137,0.0],[44.374,26.13,0.0],[44.406,26.062,0.0],[44.385,26.11,0.0],[44.529,26.044,0.0],[44.442,26.031,0.0],[44.463,26.122,0.0],[44.453,26.044,0.0],[44.495,26.125,0.0],[44.444,25.991,0.0],[44.418,26.125,0.0],[44.413,26.015,0.0],[44.49,26.13,0.0],[44.424,26.02,0.0],[44.394,26.097,0.0],[44.41,26.118,0.0],[44.373,26.171,0.0],[44.415,26.116,0.0],[44.41,26.02,0.0],[44.507,25.986,0.0],[44.472,26.134,0.0],[44.416,26.084,0.0],[44.448,26.203,0.0],[44.422,26.091,0.0],[44.433,26.105,0.0],[44.407,26.09,0.0],[44.51,26.22,0.0],[44.444,26.02,0.0],[44.407,26.082,0.0],[44.486,26.102,0.0],[44.438,26.096,0.0],[44.49,26.19,0.0],[44.486,26.094,0.0],[44.392,26.073,0.0],[44.465,26.078,0.0],[44.403,26.177,0.0],[44.409,26.094,0.0],[44.434,25.997,0.0],[44.462,26.099,0.0],[44.43,26.069,0.0],[44.462,26.189,0.0],[44.43,26.159,0.0],[44.379,26.128,0.0],[44.415,26.157,0.0],[44.441,26.075,0.0],[44.389,25.985,0.0],[44.436,26.166,0.0],[44.389,26.134,0.0],[44.37,25.977,0.0],[44.457,26.043,0.0],[44.468,26.056,0.0],[44.448,26.146,0.0],[44.38,26.14,0.0],[44.478,26.16,0.0],[44.406,26.058,0.0],[44.371,26.146,0.0],[44.433,26.137,0.0],[44.438,26.136,0.0],[44.433,25.98,0.0],[44.428,26.116,0.0],[44.365,26.004,0.0],[44.536,26.075,0.0],[44.453,25.98,0.0],[44.419,26.122,0.0],[44.428,26.109,0.0],[44.49,26.133,0.0],[44.439,26.122,0.0],[44.419,26.025,0.0],[44.424,26.023,0.0],[44.379,26.099,0.0],[44.41,26.121,0.0],[44.373,26.174,0.0],[44.425,26.178,0.0],[44.415,26.022,0.0],[44.468,26.026,0.0],[44.37,26.097,0.0],[44.453,26.115,0.0],[44.416,26.177,0.0],[44.448,26.109,0.0],[44.38,26.103,0.0],[44.397,26.079,0.0],[44.463,26.166,0.0],[44.453,26.108,0.0],[44.478,26.122,0.0],[44.412,26.091,0.0],[44.444,26.023,0.0],[44.412,26.181,0.0],[44.386,26.166,0.0],[44.438,26.196,0.0],[44.418,26.099,0.0],[44.454,26.075,0.0],[44.383,26.09,0.0],[44.486,26.097,0.0],[44.403,26.09,0.0],[44.445,26.171,0.0],[44.403,26.18,0.0],[44.383,26.172,0.0],[44.492,26.062,0.0],[44.424,25.997,0.0],[44.43,26.162,0.0],[44.415,26.16,0.0],[44.498,26.07,0.0],[44.502,26.069,0.0],[44.441,26.168,0.0],[44.415,26.152,0.0],[44.544,26.105,0.0],[44.525,26.195,0.0],[44.422,26.134,0.0],[44.474,26.067,0.0],[44.376,26.122,0.0],[44.478,26.066,0.0],[44.484,26.171,0.0],[44.407,26.125,0.0],[44.428,26.022,0.0],[44.413,26.02,0.0],[44.419,26.028,0.0],[44.419,26.118,0.0],[44.394,26.103,0.0],[44.466,26.108,0.0],[44.368,26.178,0.0],[44.389,26.205,0.0],[44.457,26.113,0.0],[44.41,26.026,0.0],[44.395,26.115,0.0],[44.457,26.106,0.0],[44.442,26.105,0.0],[44.38,26.016,0.0],[44.442,26.007,0.0],[44.463,26.169,0.0],[44.442,26.097,0.0],[44.391,26.067,0.0],[44.448,26.015,0.0],[44.433,26.013,0.0],[44.438,26.012,0.0],[44.433,26.103,0.0],[44.407,26.088,0.0],[44.444,26.116,0.0],[44.418,26.102,0.0],[44.383,26.093,0.0],[44.392,26.079,0.0],[44.359,25.965,0.0],[44.434,26.16,0.0],[44.496,26.203,0.0],[44.394,26.143,0.0],[44.456,26.18,0.0],[44.441,26.178,0.0],[44.456,26.082,0.0],[44.466,26.043,0.0],[44.424,25.992,0.0],[44.421,26.171,0.0],[44.447,26.088,0.0],[44.406,26.072,0.0],[44.389,26.043,0.0],[44.37,26.133,0.0],[44.38,26.146,0.0],[44.37,25.976,0.0],[44.529,26.143,0.0],[44.448,26.145,0.0],[44.412,26.127,0.0],[44.433,25.986,0.0],[44.407,25.971,0.0],[44.541,26.079,0.0],[44.495,26.127,0.0],[44.438,26.134,0.0],[44.541,26.169,0.0],[44.355,26.037,0.0],[44.424,26.119,0.0],[44.379,26.195,0.0],[44.373,26.18,0.0],[44.451,26.199,0.0],[44.462,26.04,0.0],[44.466,26.103,0.0],[44.41,26.029,0.0],[44.523,26.031,0.0],[44.415,26.028,0.0],[44.389,26.201,0.0],[44.425,26.177,0.0],[44.462,25.973,0.0],[44.442,26.108,0.0],[44.422,26.01,0.0],[44.385,26.062,0.0],[44.422,26.1,0.0],[44.407,26.001,0.0],[44.504,25.966,0.0],[44.463,26.165,0.0],[44.433,26.106,0.0],[44.438,26.105,0.0],[44.407,26.181,0.0],[44.465,26.087,0.0],[44.434,26.163,0.0],[44.496,26.206,0.0],[44.465,26.177,0.0],[44.419,26.064,0.0],[44.436,26.085,0.0],[44.477,26.157,0.0],[44.441,26.084,0.0],[44.492,26.061,0.0],[44.441,26.174,0.0],[44.447,26.091,0.0],[44.415,26.061,0.0],[44.493,26.081,0.0],[44.431,26.127,0.0],[44.442,26.14,0.0],[44.416,26.125,0.0],[44.529,26.049,0.0],[44.474,26.163,0.0],[44.448,26.05,0.0],[44.422,26.035,0.0],[44.475,26.183,0.0],[44.428,26.118,0.0],[44.394,26.109,0.0],[44.496,25.992,0.0],[44.451,26.202,0.0],[44.441,26.124,0.0],[44.389,26.113,0.0],[44.466,26.106,0.0],[44.481,26.043,0.0],[44.451,26.105,0.0],[44.379,26.19,0.0],[44.431,26.097,0.0],[44.447,26.124,0.0],[44.448,26.118,0.0],[44.385,26.155,0.0],[44.442,26.103,0.0],[44.391,26.073,0.0],[44.499,26.218,0.0],[44.453,26.116,0.0],[44.463,26.078,0.0],[44.463,26.168,0.0],[44.444,26.122,0.0],[44.418,26.198,0.0],[44.412,26.183,0.0],[44.409,26.203,0.0],[44.511,26.023,0.0],[44.496,26.209,0.0],[44.466,26.056,0.0],[44.342,26.108,0.0],[44.507,26.215,0.0],[44.415,26.169,0.0],[44.447,26.102,0.0],[44.441,26.087,0.0],[44.477,26.062,0.0],[44.425,26.032,0.0],[44.425,26.22,0.0],[44.498,26.169,0.0],[44.415,26.162,0.0],[44.37,26.139,0.0],[44.474,26.174,0.0],[44.38,26.152,0.0],[44.478,26.172,0.0],[44.406,26.07,0.0],[44.385,26.118,0.0],[44.349,26.183,0.0],[44.371,26.159,0.0],[44.469,26.178,0.0],[44.349,26.085,0.0],[44.459,26.067,0.0],[44.442,25.979,0.0],[44.453,25.992,0.0],[44.501,26.201,0.0],[44.438,26.14,0.0],[44.444,26.058,0.0],[44.418,26.133,0.0],[44.413,26.022,0.0],[44.388,26.007,0.0],[44.522,26.07,0.0],[44.419,26.029,0.0],[44.409,26.139,0.0],[44.424,26.028,0.0],[44.441,26.127,0.0],[44.472,26.059,0.0],[44.451,26.108,0.0],[44.472,26.149,0.0],[44.451,26.01,0.0],[44.389,26.109,0.0],[44.422,26.106,0.0],[44.442,26.106,0.0],[44.463,26.171,0.0],[44.382,26.172,0.0],[44.412,26.186,0.0],[44.48,26.094,0.0],[44.46,26.184,0.0],[44.424,26.166,0.0],[44.413,26.055,0.0],[44.462,26.106,0.0],[44.441,26.18,0.0],[44.425,26.125,0.0],[44.421,26.082,0.0],[44.451,26.14,0.0],[44.389,26.052,0.0],[44.492,26.0,0.0],[44.431,26.133,0.0],[44.374,26.14,0.0],[44.416,26.034,0.0],[44.427,26.047,0.0],[44.442,26.139,0.0],[44.453,26.055,0.0],[44.438,25.994,0.0],[44.359,26.094,0.0],[44.45,26.076,0.0],[44.48,26.037,0.0],[44.412,26.031,0.0],[44.428,26.026,0.0],[44.34,26.087,0.0],[44.513,26.079,0.0],[44.389,26.119,0.0],[44.451,26.013,0.0],[44.37,26.112,0.0],[44.416,26.192,0.0],[44.364,26.04,0.0],[44.427,26.108,0.0],[44.401,26.093,0.0],[44.412,26.196,0.0],[44.438,26.113,0.0],[44.463,26.076,0.0],[44.376,26.16,0.0],[44.428,26.165,0.0],[44.486,26.112,0.0],[44.439,26.081,0.0],[44.413,26.155,0.0],[44.496,26.118,0.0],[44.368,26.133,0.0],[44.379,26.146,0.0],[44.441,26.003,0.0],[44.517,26.183,0.0],[44.352,26.029,0.0],[44.415,26.078,0.0],[44.425,26.128,0.0],[44.415,26.07,0.0],[44.451,26.046,0.0],[44.425,26.031,0.0],[44.421,26.175,0.0],[44.431,26.136,0.0],[44.431,26.038,0.0],[44.457,25.994,0.0],[44.493,26.082,0.0],[44.451,25.979,0.0],[44.427,26.043,0.0],[44.438,25.997,0.0],[44.48,25.98,0.0],[44.428,26.029,0.0],[44.46,25.973,0.0],[44.456,26.044,0.0],[44.361,26.154,0.0],[44.409,25.988,0.0],[44.379,26.109,0.0],[44.373,26.094,0.0],[44.441,26.125,0.0],[44.451,26.106,0.0],[44.447,26.133,0.0],[44.431,26.099,0.0],[44.364,26.133,0.0],[44.407,26.013,0.0],[44.427,26.013,0.0],[44.386,26.087,0.0],[44.413,26.159,0.0],[44.471,26.106,0.0],[44.419,26.076,0.0],[44.409,26.017,0.0],[44.456,26.097,0.0],[44.447,26.201,0.0],[44.43,26.172,0.0],[44.451,26.049,0.0],[44.374,26.146,0.0],[44.493,26.085,0.0],[44.416,26.04,0.0],[44.427,26.053,0.0],[44.442,25.988,0.0],[44.459,26.166,0.0],[44.349,26.087,0.0],[44.495,26.142,0.0],[44.454,26.125,0.0],[44.433,25.994,0.0],[44.394,26.113,0.0],[44.398,26.112,0.0],[44.379,26.015,0.0],[44.472,26.061,0.0],[44.447,25.986,0.0],[44.4,26.079,0.0],[44.528,26.037,0.0],[44.489,26.127,0.0],[44.442,26.025,0.0],[44.391,26.085,0.0],[44.416,26.19,0.0],[44.416,26.003,0.0],[44.391,26.078,0.0],[44.427,26.106,0.0],[44.535,26.064,0.0],[44.364,26.128,0.0],[44.495,26.202,0.0],[44.412,26.195,0.0],[44.465,26.102,0.0],[44.383,26.103,0.0],[44.383,26.006,0.0],[44.424,26.078,0.0],[44.404,26.168,0.0],[44.436,26.003,0.0],[44.523,26.009,0.0],[44.379,26.145,0.0],[44.415,26.174,0.0],[44.466,26.151,0.0],[44.41,26.078,0.0],[44.447,26.106,0.0],[44.421,26.091,0.0],[44.493,26.096,0.0],[44.416,26.14,0.0],[44.374,26.149,0.0],[44.489,26.09,0.0],[44.425,26.127,0.0],[44.395,26.069,0.0],[44.364,26.196,0.0],[44.451,25.985,0.0],[44.406,26.172,0.0],[44.459,26.177,0.0],[44.484,26.094,0.0],[44.459,26.079,0.0],[44.427,26.049,0.0],[44.433,26.154,0.0],[44.433,25.997,0.0],[44.418,26.145,0.0],[44.377,26.128,0.0],[44.46,25.979,0.0],[44.471,26.052,0.0],[44.368,26.012,0.0],[44.413,26.026,0.0],[44.46,25.971,0.0],[44.436,26.043,0.0],[44.487,26.066,0.0],[44.472,26.064,0.0],[44.498,25.966,0.0],[44.425,26.097,0.0],[44.472,26.154,0.0],[44.447,25.982,0.0],[44.427,26.019,0.0],[44.463,26.183,0.0],[44.438,26.122,0.0],[44.377,26.099,0.0],[44.386,26.085,0.0],[44.465,26.105,0.0],[44.392,26.003,0.0],[44.428,26.166,0.0],[44.394,26.067,0.0],[44.409,26.023,0.0],[44.419,26.172,0.0],[44.41,26.088,0.0],[44.404,26.073,0.0],[44.424,26.073,0.0],[44.41,26.178,0.0],[44.368,26.134,0.0],[44.404,26.163,0.0],[44.379,26.148,0.0],[44.415,26.177,0.0],[44.436,26.096,0.0],[44.431,26.055,0.0],[44.431,26.145,0.0],[44.468,26.174,0.0],[44.468,26.076,0.0],[44.478,26.09,0.0],[44.484,26.097,0.0],[44.427,25.992,0.0],[44.438,26.155,0.0],[44.444,26.163,0.0],[44.434,26.124,0.0],[44.368,26.112,0.0],[44.46,25.982,0.0],[44.445,26.04,0.0],[44.388,26.015,0.0],[44.471,26.145,0.0],[44.46,25.974,0.0],[44.403,25.982,0.0],[44.436,26.136,0.0],[44.456,26.136,0.0],[44.447,26.052,0.0],[44.425,26.1,0.0],[44.441,25.977,0.0],[44.422,26.121,0.0],[44.427,26.119,0.0],[44.493,26.124,0.0],[44.391,26.084,0.0],[44.427,26.112,0.0],[44.386,26.088,0.0],[44.505,26.026,0.0],[44.404,26.174,0.0],[44.413,26.16,0.0],[44.394,26.062,0.0],[44.462,26.113,0.0],[44.373,26.136,0.0],[44.373,25.979,0.0],[44.421,26.09,0.0],[44.477,26.163,0.0],[44.406,26.088,0.0],[44.453,26.078,0.0],[44.431,26.14,0.0],[44.484,26.1,0.0],[44.364,26.195,0.0],[44.438,26.069,0.0],[44.433,26.16,0.0],[44.407,25.988,0.0],[44.49,26.066,0.0],[44.365,26.116,0.0],[44.522,26.186,0.0],[44.454,26.127,0.0],[44.511,26.075,0.0],[44.49,26.058,0.0],[44.439,25.968,0.0],[44.46,26.134,0.0],[44.522,26.178,0.0],[44.445,26.133,0.0],[44.481,26.162,0.0],[44.43,26.131,0.0],[44.46,25.977,0.0],[44.445,25.976,0.0],[44.403,25.985,0.0],[44.43,26.124,0.0],[44.379,26.113,0.0],[44.472,26.07,0.0],[44.447,26.055,0.0],[44.498,26.22,0.0],[44.451,26.118,0.0],[44.528,26.046,0.0],[44.447,26.145,0.0],[44.425,26.006,0.0],[44.416,26.109,0.0],[44.495,26.121,0.0],[44.427,26.115,0.0],[44.364,26.137,0.0],[44.386,26.099,0.0],[44.392,26.016,0.0],[44.382,26.093,0.0],[44.392,26.106,0.0],[44.454,26.097,0.0],[44.438,26.121,0.0],[44.475,26.139,0.0],[44.428,26.172,0.0],[44.392,26.099,0.0],[44.365,26.149,0.0],[44.368,26.148,0.0],[44.409,26.119,0.0],[44.424,26.177,0.0],[44.404,26.079,0.0],[44.436,26.012,0.0],[44.425,26.143,0.0],[44.447,26.115,0.0],[44.404,26.072,0.0],[44.483,26.091,0.0],[44.41,26.177,0.0],[44.489,26.196,0.0],[44.37,26.16,0.0],[44.425,25.986,0.0],[44.431,26.143,0.0],[44.442,26.059,0.0],[44.52,26.079,0.0],[44.459,26.081,0.0],[44.407,26.05,0.0],[44.511,26.085,0.0],[44.434,26.13,0.0],[44.434,26.032,0.0],[44.496,26.076,0.0],[44.403,25.995,0.0],[44.516,26.076,0.0],[44.522,26.181,0.0],[44.46,25.98,0.0],[44.403,25.988,0.0],[44.465,25.979,0.0],[44.436,26.142,0.0],[44.498,26.133,0.0],[44.456,26.142,0.0],[44.425,26.016,0.0],[44.415,26.125,0.0],[44.436,26.044,0.0],[44.436,25.985,0.0],[44.533,26.064,0.0],[44.364,26.148,0.0],[44.386,26.102,0.0],[44.412,26.019,0.0],[44.454,26.198,0.0],[44.403,26.122,0.0],[44.454,26.1,0.0],[44.465,26.113,0.0],[44.418,26.026,0.0],[44.434,26.093,0.0],[44.392,26.102,0.0],[44.377,26.1,0.0],[44.439,26.091,0.0],[44.419,26.181,0.0],[44.368,26.151,0.0],[44.424,26.18,0.0],[44.373,26.149,0.0],[44.394,26.069,0.0],[44.415,26.186,0.0],[44.477,26.177,0.0],[44.483,26.094,0.0],[44.415,26.088,0.0],[44.492,26.081,0.0],[44.466,26.066,0.0],[44.436,26.195,0.0],[44.41,26.18,0.0],[44.489,26.012,0.0],[44.421,26.006,0.0],[44.431,26.154,0.0],[44.416,26.145,0.0],[44.463,25.977,0.0],[44.484,26.099,0.0],[44.433,26.069,0.0],[44.516,26.087,0.0],[44.45,26.09,0.0],[44.439,26.131,0.0],[44.439,26.034,0.0],[44.434,26.125,0.0],[44.522,26.184,0.0],[44.419,26.124,0.0],[44.471,26.056,0.0],[44.383,26.14,0.0],[44.462,26.16,0.0],[44.41,26.13,0.0],[44.445,26.131,0.0],[44.425,26.109,0.0],[44.415,26.031,0.0],[44.441,25.986,0.0],[44.416,26.017,0.0],[44.416,26.108,0.0],[44.463,26.097,0.0],[44.427,26.023,0.0],[44.427,26.211,0.0],[44.392,26.112,0.0],[44.419,26.094,0.0],[44.413,26.079,0.0],[44.424,26.093,0.0],[44.403,26.208,0.0],[44.477,26.07,0.0],[44.466,26.076,0.0],[44.368,26.146,0.0],[44.462,26.122,0.0],[44.41,26.093,0.0],[44.483,26.097,0.0],[44.441,26.106,0.0],[44.431,26.157,0.0],[44.38,26.082,0.0],[44.38,26.172,0.0],[44.374,26.157,0.0],[44.371,26.088,0.0],[44.448,26.081,0.0],[44.406,26.09,0.0],[44.416,26.05,0.0],[44.45,26.1,0.0],[44.444,26.085,0.0],[44.454,26.046,0.0],[44.45,26.003,0.0],[44.407,25.989,0.0],[44.486,26.069,0.0],[44.49,26.067,0.0],[44.434,26.031,0.0],[44.46,25.986,0.0],[44.425,26.209,0.0],[44.436,25.991,0.0],[44.364,26.154,0.0],[44.391,26.006,0.0],[44.397,26.11,0.0],[44.382,26.102,0.0],[44.392,26.115,0.0],[44.501,26.073,0.0],[44.459,25.97,0.0],[44.407,26.206,0.0],[44.434,26.009,0.0],[44.465,26.209,0.0],[44.445,26.112,0.0],[44.45,26.125,0.0],[44.424,26.186,0.0],[44.404,26.088,0.0],[44.466,26.079,0.0],[44.41,26.006,0.0],[44.368,26.149,0.0],[44.456,26.208,0.0],[44.483,26.1,0.0],[44.441,26.109,0.0],[44.498,26.004,0.0],[44.379,26.155,0.0],[44.415,26.184,0.0],[44.493,26.016,0.0],[44.489,26.108,0.0],[44.451,26.062,0.0],[44.38,26.175,0.0],[44.457,26.168,0.0],[44.374,26.16,0.0],[44.427,26.165,0.0],[44.453,26.082,0.0],[44.463,26.043,0.0],[44.433,26.172,0.0],[44.382,26.142,0.0],[44.444,26.088,0.0],[44.427,26.0,0.0],[44.412,26.058,0.0],[44.526,26.186,0.0],[44.428,26.124,0.0],[44.46,26.056,0.0],[44.434,26.131,0.0],[44.419,26.13,0.0],[44.368,26.119,0.0],[44.434,25.974,0.0],[44.487,26.091,0.0],[44.513,26.106,0.0],[44.542,26.067,0.0],[44.441,26.149,0.0],[44.436,26.053,0.0],[44.483,26.043,0.0],[44.425,26.017,0.0],[44.431,26.122,0.0],[44.447,26.059,0.0],[44.421,26.044,0.0],[44.416,26.121,0.0],[44.391,26.106,0.0],[44.425,26.108,0.0],[44.416,26.023,0.0],[44.499,26.056,0.0],[44.401,26.112,0.0],[44.51,26.07,0.0],[44.468,25.966,0.0],[44.401,26.202,0.0],[44.382,26.105,0.0],[44.434,26.012,0.0],[44.454,26.199,0.0],[44.439,26.01,0.0],[44.392,26.11,0.0],[44.419,26.003,0.0],[44.439,26.003,0.0],[44.434,26.094,0.0],[44.413,26.078,0.0],[44.424,26.091,0.0],[44.368,26.152,0.0],[44.415,26.195,0.0],[44.436,26.113,0.0],[44.41,26.099,0.0],[44.456,26.113,0.0],[44.421,26.202,0.0],[44.447,26.119,0.0],[44.457,26.081,0.0],[44.389,26.075,0.0],[44.385,26.124,0.0],[44.442,26.072,0.0],[44.427,26.07,0.0],[44.463,26.046,0.0],[44.386,26.143,0.0],[44.444,26.181,0.0],[44.444,26.084,0.0],[44.439,26.043,0.0],[44.434,26.134,0.0],[44.522,26.193,0.0],[44.377,26.142,0.0],[44.454,25.977,0.0],[44.462,26.169,0.0],[44.471,26.155,0.0],[44.445,26.14,0.0],[44.43,26.139,0.0],[44.362,26.193,0.0],[44.391,26.102,0.0],[44.463,26.106,0.0],[44.391,26.004,0.0],[44.401,26.205,0.0],[44.382,26.108,0.0],[44.386,26.106,0.0],[44.412,26.121,0.0],[44.469,26.139,0.0],[44.444,26.124,0.0],[44.392,26.113,0.0],[44.465,26.208,0.0],[44.445,26.11,0.0],[44.424,26.094,0.0],[44.43,26.012,0.0],[44.441,26.115,0.0],[44.389,26.085,0.0],[44.41,26.004,0.0],[44.477,26.091,0.0],[44.425,26.061,0.0],[44.404,26.177,0.0],[44.379,26.162,0.0],[44.395,26.093,0.0],[44.431,26.069,0.0],[44.389,26.078,0.0],[44.451,26.069,0.0],[44.425,25.994,0.0],[44.457,26.174,0.0],[44.385,26.127,0.0],[44.442,26.075,0.0],[44.416,26.059,0.0],[44.499,26.022,0.0],[44.422,26.165,0.0],[44.427,26.163,0.0],[44.422,26.067,0.0],[44.412,26.064,0.0],[44.454,26.055,0.0],[44.45,26.199,0.0],[44.463,26.041,0.0],[44.403,26.168,0.0],[44.386,26.139,0.0],[44.444,26.087,0.0],[44.413,26.031,0.0],[44.409,26.175,0.0],[44.434,26.137,0.0],[44.419,26.136,0.0],[44.496,26.084,0.0],[44.532,26.059,0.0],[44.441,26.058,0.0],[44.514,26.072,0.0],[44.447,26.066,0.0],[44.406,26.049,0.0],[44.483,26.041,0.0],[44.406,26.139,0.0],[44.421,25.983,0.0],[44.371,26.13,0.0],[44.428,26.003,0.0],[44.392,26.116,0.0],[44.45,25.985,0.0],[44.377,26.115,0.0],[44.459,25.971,0.0],[44.413,26.181,0.0],[44.43,26.112,0.0],[44.424,26.097,0.0],[44.441,26.028,0.0],[44.373,26.157,0.0],[44.456,26.119,0.0],[44.466,26.171,0.0],[44.502,26.199,0.0],[44.442,26.085,0.0],[44.421,26.013,0.0],[44.38,26.184,0.0],[44.442,26.175,0.0],[44.374,26.169,0.0],[44.453,26.091,0.0],[44.376,26.128,0.0],[44.45,26.105,0.0],[44.46,26.066,0.0],[44.444,26.09,0.0],[44.48,26.066,0.0],[44.454,25.991,0.0],[44.465,26.056,0.0],[44.439,25.982,0.0],[44.445,26.146,0.0],[44.419,26.131,0.0],[44.43,26.145,0.0],[44.441,26.159,0.0],[44.487,26.093,0.0],[44.477,26.037,0.0],[44.415,26.136,0.0],[44.421,26.143,0.0],[44.474,26.148,0.0],[44.385,26.003,0.0],[44.448,26.125,0.0],[44.371,25.976,0.0],[44.459,26.041,0.0],[44.469,26.055,0.0],[44.392,26.119,0.0],[44.526,26.04,0.0],[44.428,26.096,0.0],[44.34,26.155,0.0],[44.439,26.109,0.0],[44.45,26.137,0.0],[44.445,26.026,0.0],[44.419,26.012,0.0],[44.465,26.026,0.0],[44.46,26.118,0.0],[44.496,26.127,0.0],[44.424,26.01,0.0],[44.424,26.198,0.0],[44.43,26.115,0.0],[44.344,25.944,0.0],[44.445,26.019,0.0],[44.419,26.004,0.0],[44.43,26.017,0.0],[44.367,26.04,0.0],[44.436,26.122,0.0],[44.394,26.079,0.0],[44.441,26.121,0.0],[44.451,26.082,0.0],[44.379,26.168,0.0],[44.436,26.115,0.0],[44.457,26.09,0.0],[44.389,26.084,0.0],[44.421,26.016,0.0],[44.38,26.09,0.0],[44.468,26.096,0.0],[44.448,26.088,0.0],[44.343,26.105,0.0],[44.407,26.162,0.0],[44.418,26.175,0.0],[44.386,26.145,0.0],[44.418,26.078,0.0],[44.45,26.01,0.0],[44.49,26.082,0.0],[44.471,26.172,0.0],[44.383,26.159,0.0],[44.542,26.079,0.0],[44.513,26.02,0.0],[44.424,26.043,0.0],[44.487,26.096,0.0],[44.424,26.133,0.0],[44.441,26.064,0.0],[44.425,26.029,0.0],[44.447,26.072,0.0],[44.406,26.145,0.0],[44.514,26.07,0.0],[44.454,26.121,0.0],[44.469,26.058,0.0],[44.438,25.968,0.0],[44.434,26.113,0.0],[44.444,26.035,0.0],[44.439,26.112,0.0],[44.392,26.025,0.0],[44.445,26.029,0.0],[44.465,26.029,0.0],[44.522,26.145,0.0],[44.496,26.22,0.0],[44.445,26.022,0.0],[44.419,26.007,0.0],[44.451,26.085,0.0],[44.395,26.102,0.0],[44.431,26.168,0.0],[44.431,26.07,0.0],[44.353,26.143,0.0],[44.427,26.172,0.0],[44.453,26.09,0.0],[44.382,26.149,0.0],[44.418,26.081,0.0],[44.45,26.013,0.0],[44.465,26.07,0.0],[44.377,26.154,0.0],[44.454,26.146,0.0],[44.456,26.076,0.0],[44.513,26.023,0.0],[44.436,26.069,0.0],[44.404,25.979,0.0],[44.477,26.043,0.0],[44.395,26.044,0.0],[44.385,26.106,0.0],[44.391,26.113,0.0],[44.499,26.072,0.0],[44.406,25.991,0.0],[44.463,26.11,0.0],[44.531,26.052,0.0],[44.438,25.971,0.0],[44.428,26.012,0.0],[44.459,25.98,0.0],[44.444,26.038,0.0],[44.444,25.979,0.0],[44.413,26.19,0.0],[44.434,26.109,0.0],[44.45,25.986,0.0],[44.445,26.122,0.0],[44.419,26.108,0.0],[44.43,26.023,0.0],[44.538,26.169,0.0],[44.419,26.1,0.0],[44.379,26.174,0.0],[44.441,26.029,0.0],[44.457,26.193,0.0],[44.421,26.119,0.0],[44.395,26.105,0.0],[44.37,26.18,0.0],[44.508,26.215,0.0],[44.431,26.171,0.0],[44.489,26.118,0.0],[44.442,26.087,0.0],[44.416,26.162,0.0],[44.376,26.047,0.0],[44.382,26.152,0.0],[44.428,26.142,0.0],[44.454,26.059,0.0],[44.48,26.165,0.0],[44.413,26.133,0.0],[44.409,26.09,0.0],[44.403,26.075,0.0],[44.394,26.035,0.0],[44.409,26.18,0.0],[44.424,26.049,0.0],[44.377,26.149,0.0],[44.361,26.091,0.0],[44.424,26.139,0.0],[44.492,26.145,0.0],[44.445,26.058,0.0],[44.447,26.078,0.0],[44.508,26.069,0.0],[44.38,26.136,0.0],[44.468,26.142,0.0],[44.442,26.127,0.0],[44.406,25.994,0.0],[44.483,26.046,0.0],[44.448,25.977,0.0],[44.444,26.139,0.0],[44.371,25.977,0.0],[44.438,26.124,0.0],[44.454,26.119,0.0],[44.536,26.062,0.0],[44.486,26.032,0.0],[44.45,26.146,0.0],[44.475,26.064,0.0],[44.45,26.049,0.0],[44.409,26.22,0.0],[44.439,26.11,0.0],[44.424,26.109,0.0],[44.419,26.201,0.0],[44.413,26.186,0.0],[44.362,26.151,0.0],[44.487,26.037,0.0],[44.4,26.053,0.0],[44.395,26.1,0.0],[44.38,26.099,0.0],[44.391,26.059,0.0],[44.453,26.103,0.0],[44.422,26.18,0.0],[44.453,26.006,0.0],[44.463,26.154,0.0],[44.412,26.079,0.0],[44.463,26.056,0.0],[44.433,26.186,0.0],[44.438,26.184,0.0],[44.486,26.093,0.0],[44.438,26.087,0.0],[44.403,26.175,0.0],[44.409,26.093,0.0],[44.434,25.995,0.0],[44.445,26.069,0.0],[44.481,26.097,0.0],[44.49,26.084,0.0],[44.394,26.128,0.0],[44.439,26.143,0.0],[44.413,26.128,0.0],[44.367,26.199,0.0],[44.389,26.133,0.0],[44.421,26.066,0.0],[44.4,26.113,0.0],[44.483,26.049,0.0],[44.406,25.989,0.0],[44.433,26.038,0.0],[44.386,26.026,0.0],[44.365,26.093,0.0],[44.371,25.98,0.0],[44.419,26.113,0.0],[44.434,26.017,0.0],[44.398,26.097,0.0],[44.409,26.125,0.0],[44.404,26.015,0.0],[44.496,26.131,0.0],[44.481,25.973,0.0],[44.389,26.006,0.0],[44.477,26.012,0.0],[44.395,26.11,0.0],[44.416,26.078,0.0],[44.422,26.183,0.0],[44.38,26.192,0.0],[44.438,26.007,0.0],[44.376,26.143,0.0],[44.444,26.105,0.0],[44.392,26.075,0.0],[44.382,26.151,0.0],[44.444,26.007,0.0],[44.403,26.178,0.0],[44.465,26.169,0.0],[44.434,25.998,0.0],[44.403,26.081,0.0],[44.481,26.1,0.0],[44.49,26.087,0.0],[44.419,26.049,0.0],[44.492,26.143,0.0],[44.466,25.971,0.0],[44.447,26.076,0.0],[44.474,26.066,0.0],[44.422,26.125,0.0],[44.474,26.058,0.0],[44.376,26.113,0.0],[44.453,25.982,0.0],[44.448,26.133,0.0],[44.371,26.043,0.0],[44.448,25.976,0.0],[44.433,25.974,0.0],[44.418,26.032,0.0],[44.486,26.038,0.0],[44.469,26.152,0.0],[44.434,26.118,0.0],[44.45,26.055,0.0],[44.439,26.116,0.0],[44.413,26.102,0.0],[44.419,26.109,0.0],[44.492,26.113,0.0],[44.483,26.119,0.0],[44.466,26.091,0.0],[44.415,26.016,0.0],[44.38,26.105,0.0],[44.385,26.148,0.0],[44.453,26.109,0.0],[44.448,26.201,0.0],[44.52,26.017,0.0],[44.453,26.199,0.0],[44.448,26.103,0.0],[44.391,26.058,0.0],[44.448,26.006,0.0],[44.382,26.162,0.0],[44.418,26.003,0.0],[44.365,26.038,0.0],[44.433,26.094,0.0],[44.407,26.079,0.0],[44.434,26.159,0.0],[44.511,26.203,0.0],[44.428,26.143,0.0],[44.45,26.115,0.0],[44.409,26.099,0.0],[44.465,26.075,0.0],[44.409,26.001,0.0],[44.522,26.022,0.0],[44.471,26.18,0.0]];

// Population correction factor: census 1.72M = legal residents only
// Real population estimated 2.5-3M (Ilfov commuters, undeclared, expats)
const POP_REAL_FACTOR = 1.3; // conservative: census 1.72M + ~30% non-counted (was 1.7 = too aggressive)

let densityMode = 'combined'; // 'combined' | 'night' | 'day'

function setDensityMode(mode) {
  densityMode = mode;
  ['dmC','dmN','dmD'].forEach(id => {
    const b = el(id);
    if(b) b.style.cssText = 'font-size:8px;padding:2px 6px;' + (
      (mode==='combined'&&id==='dmC') || (mode==='night'&&id==='dmN') || (mode==='day'&&id==='dmD')
      ? 'background:rgba(212,160,23,.3);border-color:var(--accent);color:white'
      : ''
    );
  });
  if(layers.heatDensity) genHeatDensity();
}

function genHeatDensity() {
  if(heatDensityLayer) map.removeLayer(heatDensityLayer);
  // 3 grids from 397k buildings: night (residential), day (offices+unis+malls), combined
  // Calibrated on census per sector, landuse-filtered, volumetric (area x floors)
  const gridData = densityMode==='night' ? DENSITY_NIGHT : densityMode==='day' ? DENSITY_DAY : DENSITY_GRID;
  const gradients = {
    night: {0.05:'#0a0e1a',0.15:'#1a1040',0.3:'#2d1b69',0.45:'#4c1d95',0.6:'#7c3aed',0.75:'#a78bfa',0.9:'#c4b5fd',1:'#ede9fe'},
    day: {0.05:'#0a0e1a',0.15:'#1a2744',0.3:'#1e3a5f',0.45:'#2563eb',0.6:'#3b82f6',0.75:'#f59e0b',0.9:'#f97316',1:'#ef4444'},
    combined: {0.05:'#0a0e1a',0.12:'#0f1b3d',0.22:'#1e3a5f',0.32:'#2563eb',0.42:'#3b82f6',0.52:'#06b6d4',0.62:'#22c55e',0.72:'#84cc16',0.82:'#eab308',0.92:'#f97316',1:'#ef4444'}
  };
  heatDensityLayer = L.heatLayer(gridData, {
    radius: 16, blur: 14, maxZoom: 17, max: 0.7, minOpacity: 0.1,
    gradient: gradients[densityMode]
  }).addTo(map);
}

function genHeatYouth() {
  if(heatYouthLayer) map.removeLayer(heatYouthLayer);
  // Youth heatmap: universities + young neighborhoods
  const points = [];
  // Universities weighted by student count
  POIS.filter(p=>p.type==='university').forEach(p=>{
    const w = (p.students || 1000) / 10000;
    points.push([p.lat, p.lng, Math.min(1, w)]);
  });
  // Cartiere weighted by youth percentage
  CARTIERE.forEach(c=>{
    const youthWeight = ((c.young || .42) - .38) / .08; // 0 to 1
    const popWeight = c.pop / 60000; // normalized
    points.push([c.lat, c.lng, Math.min(1, youthWeight * popWeight * 1.5)]);
  });
  // New residential
  POIS.filter(p=>p.type==='residential').forEach(p=>{
    points.push([p.lat, p.lng, 0.4]);
  });
  heatYouthLayer = L.heatLayer(points, {
    radius: 30, blur: 22, maxZoom: 15, max: 1,
    gradient: {0.1:'#0c1021',0.25:'#1e293b',0.4:'#6d28d9',0.55:'#8b5cf6',0.7:'#a78bfa',0.85:'#22c55e',1:'#4ade80'}
  }).addTo(map);
}

// ================================================================
// SAZ WEIGHT SLIDERS
// ================================================================
function updateWeights() {
  let f=parseInt(el('wFlux').value), d=parseInt(el('wDens').value), j=parseInt(el('wJeu').value);
  const total=f+d+j;
  if(total!==100) {
    // Auto-adjust last one
    j=100-f-d;
    if(j<0){j=0;d=100-f}
    el('wJeu').value=j;
  }
  sazWeights={flux:f,densite:d,jeunesse:j};
  el('wFluxVal').textContent=f+'%';
  el('wDensVal').textContent=d+'%';
  el('wJeuVal').textContent=j+'%';
  // Re-analyze if point selected
  if(selectedPt) onMapClick({latlng:selectedPt});
}

function resetWeights() {
  el('wFlux').value=33;el('wDens').value=33;el('wJeu').value=34;
  sazWeights={flux:33,densite:33,jeunesse:34};
  el('wFluxVal').textContent='33%';el('wDensVal').textContent='33%';el('wJeuVal').textContent='34%';
  if(selectedPt) onMapClick({latlng:selectedPt});
}

function setPresetWeights(f,d,j) {
  el('wFlux').value=f;el('wDens').value=d;el('wJeu').value=j;
  sazWeights={flux:f,densite:d,jeunesse:j};
  el('wFluxVal').textContent=f+'%';el('wDensVal').textContent=d+'%';el('wJeuVal').textContent=j+'%';
  if(selectedPt) onMapClick({latlng:selectedPt});
}

// ================================================================
// OVERLAP ANALYSIS — BP sites catchment overlap
// ================================================================
// v6.70.1 — les graphiques overlap vivent dans un layer group dédié (avant:
// addTo(map) direct → cercles/lignes indélébiles sans reload, bug "impossible
// de décocher" signalé par Paul).
let overlapLayer = L.layerGroup();

function toggleOverlapAnalysis() {
  const btn = document.getElementById('btnOverlap');
  if (overlapLayer.getLayers().length) {
    overlapLayer.clearLayers();
    if (map.hasLayer(overlapLayer)) map.removeLayer(overlapLayer);
    btn?.classList.remove('active');
    setStatus('ok', 'Overlap masqué');
    return;
  }
  showOverlapAnalysis();
  if (overlapLayer.getLayers().length) {
    if (!map.hasLayer(overlapLayer)) map.addLayer(overlapLayer);
    btn?.classList.add('active');
  }
}

function showOverlapAnalysis() {
  const allSites = [...TARGETS, ...customSites.filter(s=>!s.deletedAt).map(s=>({name:s.name,lat:s.lat,lng:s.lng}))];
  if(allSites.length < 2) return;

  // Draw circles for all sites
  allSites.forEach(s=>{
    L.circle([s.lat, s.lng], {
      radius: 2000, color: '#d4a01780', weight: 1, fillColor: '#d4a017', fillOpacity: 0.05, dashArray: '4,4'
    }).addTo(overlapLayer);
  });

  // Find overlaps
  const overlaps = [];
  for(let i=0;i<allSites.length;i++){
    for(let j=i+1;j<allSites.length;j++){
      const d=haversine(allSites[i].lat,allSites[i].lng,allSites[j].lat,allSites[j].lng);
      if(d<4000){
        overlaps.push({a:allSites[i].name,b:allSites[j].name,dist:d,
          overlap:Math.max(0,Math.round((1-d/4000)*100))});
        // Draw overlap line
        L.polyline([[allSites[i].lat,allSites[i].lng],[allSites[j].lat,allSites[j].lng]],{
          color:d<2000?'#ef4444':d<3000?'#f97316':'#eab308',weight:2,dashArray:'6,4',opacity:.7
        }).bindTooltip(`${allSites[i].name} ↔ ${allSites[j].name}<br>${(d/1000).toFixed(1)}km | Overlap: ${Math.max(0,Math.round((1-d/4000)*100))}%`,
          {className:'custom-tooltip'}).addTo(overlapLayer);
      }
    }
  }
}

// ================================================================
// USER-EDITABLE PARAMS — persisted in localStorage, impact BP en direct
// 3 subscription tiers + loyer — calibre BP V17 (MF FP - BP RO)
// ================================================================
const FP_DEFAULTS = { priceBaseTTC: 28, pricePremiumTTC: 40, priceUltimateTTC: 50, loyerAnnuel: 236400, clubSurface: 1449 };
let TAUX_VAD = 0.20; // 20% clients sur forfaits superieurs (BP V17 C46) — modifiable par utilisateur
const TVA_RO = 0.21;   // TVA Roumanie (BP V17 C24)

function loadUserParams() {
  try { const s = localStorage.getItem('fp_user_params'); return s ? {...FP_DEFAULTS, ...JSON.parse(s)} : {...FP_DEFAULTS}; }
  catch(e) { return {...FP_DEFAULTS}; }
}
function saveUserParams(p) { try { localStorage.setItem('fp_user_params', JSON.stringify(p)); } catch(e){} }
let USER_PARAMS = loadUserParams();

// Live update: change a param, save, and re-render captage analysis
function updateUserParam(key, value) {
  const v = parseFloat(value);
  if(isNaN(v) || v <= 0) return;
  USER_PARAMS[key] = v;
  saveUserParams(USER_PARAMS);
  // Update summary line live
  updateParamSummary();
  // Re-render BOTH captage containers + P&L
  if(window._lastCaptageLocation) {
    const {lat, lng, radius} = window._lastCaptageLocation;
    // Single ref lookup (was racing: element could be removed between check and access).
    const cc = el('captageContent'); if(cc && cc.innerHTML) renderCaptageAnalysis('captageContent', lat, lng, radius);
    const ccs = el('captageContentSite'); if(ccs && ccs.innerHTML) renderCaptageAnalysis('captageContentSite', lat, lng, radius);
  }
}
function resetUserParams() {
  USER_PARAMS = {...FP_DEFAULTS};
  saveUserParams(USER_PARAMS);
  // Update input fields
  const ib = el('inputPriceBase'); if(ib) ib.value = USER_PARAMS.priceBaseTTC;
  const ip = el('inputPricePremium'); if(ip) ip.value = USER_PARAMS.pricePremiumTTC;
  const iu = el('inputPriceUltimate'); if(iu) iu.value = USER_PARAMS.priceUltimateTTC;
  TAUX_VAD = 0.20;
  const iv = el('inputVAD'); if(iv) iv.value = 20;
  const vl = el('vadLabel'); if(vl) vl.textContent = '20%';
  updateParamSummary();
  if(window._lastCaptageLocation) {
    const {lat, lng, radius} = window._lastCaptageLocation;
    if(el('captageContent') && el('captageContent').innerHTML) renderCaptageAnalysis('captageContent', lat, lng, radius);
    if(el('captageContentSite') && el('captageContentSite').innerHTML) renderCaptageAnalysis('captageContentSite', lat, lng, radius);
  }
}
function updateParamSummary() {
  const s = el('paramSummary');
  const pmHT = getPanierMoyenHT();
  const baseTTC = USER_PARAMS.priceBaseTTC;
  const premTTC = USER_PARAMS.pricePremiumTTC;
  const ultiTTC = USER_PARAMS.priceUltimateTTC;
  const vadPct = Math.round(TAUX_VAD * 100);
  if(s) s.innerHTML = `ARPU: <b style="color:var(--cyan)">${pmHT.toFixed(2)} EUR HT</b> (${(100-vadPct)}% × ${baseTTC}€ + ${vadPct}% × avg(${premTTC}+${ultiTTC})€ TTC) | Loyer Y1: <b style="color:var(--yellow)">${fmt(getSteppedRentMonthly(1,'objectifNego'))}/mois</b>`;
}
window._lastCaptageLocation = null;

// BP V17 convention: HT = TTC × (1 - TVA) [not TTC/(1+TVA)]
function toHT(ttc) { return ttc * (1 - TVA_RO); }
// PANIER MOYEN = Abonnement blended + Revenus accessoires (frais adhesion amorti + boissons/accessoires)
// France BP: panier moyen HT = 37.5€ soit ~70% au-dessus de l'abo base (19€ HT base France)
// Source: FP France BP model, panier stabilise M12+ à 37.5€ HT (col R)
// Revenus accessoires mensuels HT par membre actif
// France BP: panier moyen 37.5€ HT vs base abo 15.8€ HT → extras = ~22€ HT
// Romania ajusté pouvoir d'achat (~55% France) + marché naissant: 22 × 0.45 ≈ 5€ HT
// Compose: frais adhesion amorti (~1.1€), boissons/barres (~2€), PRM/accessoires (~1.5€), freeze fees (~0.4€)
const EXTRAS_HT_MONTHLY = 5.0;
function getPanierMoyenHT() {
  const baseHT = toHT(USER_PARAMS.priceBaseTTC);
  const premHT = toHT(USER_PARAMS.pricePremiumTTC);
  const ultiHT = toHT(USER_PARAMS.priceUltimateTTC);
  const avgVAD = (premHT + ultiHT) / 2;
  const aboBlended = (1 - TAUX_VAD) * baseHT + TAUX_VAD * avgVAD;
  return aboBlended + EXTRAS_HT_MONTHLY;
}
function getEffectiveRentAnnual() {
  return USER_PARAMS.loyerAnnuel || FP_DEFAULTS.loyerAnnuel;
}

// ================================================================
// CAPTAGE ENGINE v2 — 3 sources: Captifs + Natifs + Walk-in
// ================================================================
// FP positioning: prix TTC/month dynamique, premium low-cost international franchise
function getFP_MONTHLY_TTC() { return USER_PARAMS.priceBaseTTC; }
function getFP_MONTHLY_HT() { return getPanierMoyenHT(); }

// Competitor average prices TTC — VERIFIED March 2026
// Sources: worldclass.ro, stayfit.ro, downtownfitness.ro, 18gym.ro, nr1fitness
const COMP_PRICES = {
  premium:80,       // WC Silver/Gold avg (range 46-145 EUR)
  'mid-premium':42, // Downtown Fitness = 42 EUR (source: Paul / terrain)
  mid:32,           // Stay Fit = 32 EUR, 18GYM ~36 EUR (source: Paul / terrain)
  lowcost:30,       // Nr1 Fitness ~30 EUR (149 RON)
  independent:25,   // estimated
  crossfit:50,      // premium niche
  boutique:40       // estimated
};

// Capture rates V3 — FP = disrupteur low-cost qui casse le marché
// Benchmark Western Europe: quand Basic-Fit/PureGym entrent sur un marché,
// ils captent 15-25% des membres concurrents mid-range en 2 ans.
// FP en Roumanie = PREMIERE franchise low-cost internationale → effet encore plus fort.
// Churn annuel fitness = 25-30%. FP capte une part significative des churners
// car meilleur rapport qualité/prix + marque internationale + équipements neufs.
const CAPTURE_RATES = {
  premium: {rate:0.12, reason:'WC 46-145EUR → FP 28EUR. Ecart prix majeur (-50 à -117EUR). Churn WC ~20%, 60% considèrent alternatives low-cost = 12%. Benchmark: Basic-Fit capte ~10-15% du premium en WE'},
  'mid-premium': {rate:0.18, reason:'Downtown 42EUR → FP 28EUR = -33% prix. Positionnement quasi-identique, FP gagne sur prix + marque + équipements neufs. Churn ~25%, haute consideration = 18%'},
  mid: {rate:0.22, reason:'Stay Fit 32EUR / 18GYM 36EUR → FP 28EUR. Cible identique, FP moins cher avec marque internationale. Churn ~30%, très haute consideration = 22%. Benchmark WE: 20-25% de captage mid→lowcost'},
  lowcost: {rate:0.06, reason:'Déjà low-cost mais FP = marque internationale + équipements premium. Les insatisfaits qualité migrent vers le haut = 6%'},
  independent: {rate:0.15, reason:'Équipement vieillissant, pas de marque. FP offre modernité + prix compétitif. Churn ~35%, haute consideration = 15%'},
  crossfit: {rate:0.03, reason:'Niche communautaire, quasi zero transférabilité'},
  boutique: {rate:0.02, reason:'Expérience unique non substituable'},
};

// v6.65.1 — applique les overrides cloud/localStorage sur les rates au boot.
// Est aussi rappelée par cloud-sync quand un autre device push de nouveaux taux.
window.applyCaptureRatesOverride = function applyCaptureRatesOverride() {
  const o = window._captureRatesOverride;
  if (!o) return;
  if (o.premium     != null) CAPTURE_RATES.premium.rate      = o.premium / 100;
  if (o.midPremium  != null) CAPTURE_RATES['mid-premium'].rate = o.midPremium / 100;
  if (o.mid         != null) CAPTURE_RATES.mid.rate          = o.mid / 100;
  if (o.independent != null) CAPTURE_RATES.independent.rate  = o.independent / 100;
  if (o.lowcost     != null) CAPTURE_RATES.lowcost.rate      = o.lowcost / 100;
};

function distanceDecay(dist, driveMins) {
  // Use real driving time if available (Google Distance Matrix)
  if(driveMins !== undefined) {
    if(driveMins <= 3) return 1.0;
    if(driveMins <= 5) return 0.85;
    if(driveMins <= 8) return 0.65;
    if(driveMins <= 12) return 0.45;
    if(driveMins <= 15) return 0.25;
    if(driveMins <= 20) return 0.12;
    return 0.05;
  }
  // Fallback: haversine distance
  if(dist < 500) return 1.0;
  if(dist < 1000) return 0.85;
  if(dist < 1500) return 0.65;
  if(dist < 2000) return 0.45;
  if(dist < 3000) return 0.25;
  if(dist < 4000) return 0.12;
  return 0.05;
}

// Rating factor — uses live Google rating (gRating) with fallback to REVIEWS_DB
function ratingFactor(googleRating) {
  if(!googleRating) return 1.0;
  if(googleRating < 4.0) return 1 + (4.0 - googleRating) * 0.3;  // e.g. 3.6★ = +12%
  if(googleRating > 4.3) return 1 - (googleRating - 4.3) * 0.2;  // e.g. 4.6★ = -6%
  return 1.0;
}

// Competitor strength factor — more reviews = more established = harder to capture
function competitorStrength(reviewCount) {
  if(!reviewCount) return 1.0;
  if(reviewCount < 100) return 1.15;  // small/new club, easier to poach
  if(reviewCount <= 500) return 1.0;  // standard
  if(reviewCount <= 1000) return 0.85; // well-established
  return 0.75; // dominant player (1000+ reviews), very hard to capture
}

// NEW: Price elasticity — bigger price gap = more capture
function priceElasticity(compSegment) {
  const compPrice = COMP_PRICES[compSegment] || 30;
  const priceDiff = compPrice - getFP_MONTHLY_TTC();
  if(priceDiff <= 0) return 0.7;  // FP is MORE expensive → less capture
  // Each 10€ of savings = +15% capture boost
  return 1 + (priceDiff / 10) * 0.15;  // e.g. WC 80€ → diff 52€ → x1.78
}

// NEW: Walk-in conversion from mall/centre traffic
function calcWalkIn(lat, lng) {
  let dailyFootfall = 0;
  let sources = [];
  let isPremiumMall = false; // CA > 200M€ or >40k visitors/day = premium destination
  let isDestinationMall = false; // >40k visitors/day = city-wide catchment

  // Check nearby malls
  TRAFFIC_GENERATORS.malls.forEach(m => {
    const d = haversine(lat, lng, m.lat, m.lng);
    if(d < 300) {
      dailyFootfall += m.dailyVisitors;
      sources.push({name:m.name,visitors:m.dailyVisitors,type:'in-mall'});
      if(m.dailyVisitors >= 40000) { isPremiumMall = true; isDestinationMall = true; }
    }
    else if(d < 800) {
      dailyFootfall += m.dailyVisitors * 0.3;
      sources.push({name:m.name,visitors:Math.round(m.dailyVisitors*0.3),type:'adjacent'});
    }
  });

  // Walk-in conversion: unique visitors × conversion rate
  // Daily footfall = total visits/day. Average mall visitor comes ~2.5x/month = 30x/year
  const AVG_VISIT_FREQ = 30; // repeat visit frequency (Cushman & Wakefield EU benchmark)
  const annualUnique = Math.round(dailyFootfall * 300 / AVG_VISIT_FREQ); // ~300 operating days / repeat factor

  // PREMIUM MALL CONVERSION BOOST
  // Malls > 40k visitors/day = ultra-premium clientele (Baneasa 380M€ CA, AFI Cotroceni)
  // FP at 28€/month = dérisoire vs pouvoir d'achat → conversion rate 1.0% (vs 0.7% standard)
  const baseConversion = isPremiumMall ? 0.010 : 0.007;
  const walkInMembers = Math.round(annualUnique * baseConversion);

  return {
    dailyFootfall, annualUnique, walkInMembers, sources,
    conversionRate: baseConversion * 100, avgVisitFreq: AVG_VISIT_FREQ,
    isPremiumMall, isDestinationMall
  };
}

// DESTINATION MALL BONUS — natifs from extended catchment (10km)
// Malls like Baneasa/AFI are not neighborhood malls — people drive 15-20km.
// The standard 3km radius misses 80% of their real catchment.
// This bonus captures the extended population at a reduced conversion rate.
function calcDestinationBonus(lat, lng, walkInResult, standardRadius) {
  if(!walkInResult.isDestinationMall) return { bonusMembers: 0, extendedPop: 0, extendedRadius: 0 };
  const EXTENDED_RADIUS = 10000; // 10km for destination malls
  const extendedPop = estimatePopInRadiusGranular(lat, lng, EXTENDED_RADIUS);
  const standardPop = estimatePopInRadiusGranular(lat, lng, standardRadius);
  // Only count the ADDITIONAL population beyond standard radius
  const deltaPop = Math.max(0, extendedPop.target - standardPop.target);
  // These distant residents convert at a lower rate — they drive to the mall
  // but are less likely to commit to a gym (distance friction)
  // Rate: 0.4% of extended population beyond standard radius
  const EXTENDED_RATE = 0.004;
  const bonusMembers = Math.round(deltaPop * EXTENDED_RATE);
  return {
    bonusMembers,
    extendedPop: extendedPop.target,
    standardPop: standardPop.target,
    deltaPop,
    extendedRadius: EXTENDED_RADIUS,
    rate: EXTENDED_RATE
  };
}

// ================================================================
// BAIN-LEVEL METHODOLOGY — Personas, Bass, Churn/LTV, P&L/IRR
// ================================================================

// --- PERSONA SEGMENTATION ---
// 4 personas with differentiated behavior based on quartier price proxy
// Churn rates calibrated on FP France BP model (3800 mbr target, 300 clubs)
// France Y1 avg churn ~0.7%/mois, Y2+ avg ~3.5%/mois → persona spread around these anchors
// Annual renewal spike handled separately in cohortModel (see RENEWAL_CHURN_SPIKE)
const PERSONAS = {
  etudiants:   { label:'Etudiants',     age:'18-25', pctBase:0.25, propension:0.15, arpuMult:0.70, churnY1:0.012, churn:0.045, color:'#a78bfa' },
  jeunesActifs:{ label:'Jeunes Actifs', age:'25-35', pctBase:0.35, propension:0.18, arpuMult:1.00, churnY1:0.006, churn:0.030, color:'#38bdf8' },
  familles:    { label:'Familles',       age:'35-45', pctBase:0.25, propension:0.10, arpuMult:1.10, churnY1:0.005, churn:0.025, color:'#34d399' },
  cspPlus:     { label:'CSP+',           age:'25-45', pctBase:0.15, propension:0.14, arpuMult:1.30, churnY1:0.004, churn:0.020, color:'#fbbf24' }
};

// Annual renewal spike — France BP: 45% résiliation rate at 12-month renewal
// Translates to ~10-15% extra gross churn at months 13, 25, 37, 49
// This reflects contract anniversary churn (members who complete 1 year and don't renew)
const RENEWAL_CHURN_SPIKE = 0.12; // 12% of existing members churn at each anniversary
const RENEWAL_MONTHS = [13, 25, 37, 49]; // Annual contract renewal points

// Distribution based on REAL INS age data per sector + price proxy for CSP+ split
function getPersonaMix(cartiereList) {
  if(!cartiereList || cartiereList.length === 0) {
    return { etudiants:0.20, jeunesActifs:0.33, familles:0.32, cspPlus:0.15 };
  }

  // Weighted average of INS age distributions across nearby sectors
  const totalPop = cartiereList.reduce((a,c) => a + c.pop, 0);
  let wYoung = 0, wActive = 0, wMature = 0;
  const sectorPops = {};

  cartiereList.forEach(c => {
    const ageDist = getINSAgeDistribution(c.sector);
    const w = c.pop / totalPop;
    wYoung  += ageDist.young * w;   // 15-24
    wActive += ageDist.active * w;  // 25-34
    wMature += ageDist.mature * w;  // 35-44
    sectorPops[c.sector] = (sectorPops[c.sector] || 0) + c.pop;
  });

  // Price proxy splits mature (35-44) into familles vs CSP+
  const avgPrice = totalPop > 0
    ? cartiereList.reduce((a,c) => a + c.price * c.pop, 0) / totalPop
    : 1500;

  // CSP+ fraction of the mature band — higher in premium quartiers
  let cspFraction;
  if(avgPrice >= 2500)     cspFraction = 0.50; // Premium: half of 35-44 are CSP+
  else if(avgPrice >= 2000) cspFraction = 0.35;
  else if(avgPrice >= 1500) cspFraction = 0.20;
  else if(avgPrice >= 1200) cspFraction = 0.12;
  else                      cspFraction = 0.06; // Popular: very few CSP+

  // Also extract some CSP+ from active band (25-34 high earners)
  const cspFromActive = avgPrice >= 2000 ? 0.10 : avgPrice >= 1500 ? 0.05 : 0.02;

  const mix = {
    etudiants:   Math.round(wYoung * 100) / 100,
    jeunesActifs: Math.round((wActive * (1 - cspFromActive)) * 100) / 100,
    familles:    Math.round((wMature * (1 - cspFraction)) * 100) / 100,
    cspPlus:     Math.round((wMature * cspFraction + wActive * cspFromActive) * 100) / 100
  };

  // Normalize to sum = 1.0
  const sum = mix.etudiants + mix.jeunesActifs + mix.familles + mix.cspPlus;
  if(sum > 0) {
    mix.etudiants   = Math.round(mix.etudiants / sum * 100) / 100;
    mix.jeunesActifs = Math.round(mix.jeunesActifs / sum * 100) / 100;
    mix.familles    = Math.round(mix.familles / sum * 100) / 100;
    mix.cspPlus     = Math.round(1 - mix.etudiants - mix.jeunesActifs - mix.familles, 2);
    // Fix floating point
    mix.cspPlus = Math.round(mix.cspPlus * 100) / 100;
  }

  return mix;
}

// Blended ARPU based on persona mix — uses dynamic panier moyen from user params
function blendedARPU(personaMix) {
  const basePanier = getPanierMoyenHT();
  let arpu = 0;
  for(const [key, pct] of Object.entries(personaMix)) {
    arpu += pct * PERSONAS[key].arpuMult * basePanier;
  }
  return Math.round(arpu * 100) / 100;
}

// Blended churn rate based on persona mix
// month parameter: if ≤12, uses Y1 (low) churn; if >12, uses steady-state churn
// Source: FP France BP — Y1 avg 0.7%/mois, Y2+ avg 3.5%/mois
function blendedChurn(personaMix, month) {
  let churn = 0;
  const useY1 = month && month <= 12;
  for(const [key, pct] of Object.entries(personaMix)) {
    churn += pct * (useY1 ? PERSONAS[key].churnY1 : PERSONAS[key].churn);
  }
  return churn;
}

// Blended propension (weighted capture propensity)
function blendedPropension(personaMix) {
  let prop = 0;
  for(const [key, pct] of Object.entries(personaMix)) {
    prop += pct * PERSONAS[key].propension;
  }
  return prop;
}

// --- EMPIRICAL RAMP-UP MODEL ---
// Calibrated on real FP Spain data — 2 reference curves + Romania market adjustment
// Uses linear interpolation between real data points, then scales by site potential

// FP Spain Standard club — real monthly member counts
const SPAIN_STANDARD = [
  [1,0],[2,0],[3,830],[4,1050],[5,1380],[6,1710],[7,1930],[8,2040],[9,2350],[10,2500],[11,2656],[12,2700],
  [13,2750],[14,2800],[15,2900],[16,3000],[17,3050],[18,3100],[19,3200],[20,3250],[21,3300],[22,3400],[23,3450],[24,3500],
  [25,3550],[26,3600],[27,3650],[28,3700],[29,3750],[30,3800],[31,3850],[32,3900],[33,3950],[34,4000],[35,4050],[36,4100],
  [37,4150],[38,4200],[39,4250],[40,4300],[41,4400],[42,4500],[43,4550],[44,4600],[45,4650],[46,4700],[47,4800],[48,4900],
  [49,4950],[50,5000],[51,5020],[52,5040],[53,5060],[54,5080],[55,5100],[56,5120],[57,5140],[58,5150],[59,5170],[60,5200]
];
const SPAIN_STANDARD_M = 5200; // Reference saturation

// FP Spain Fort club — real monthly member counts (pre-sales agressives)
const SPAIN_FORT = [
  [1,500],[2,900],[3,1400],[4,2000],[5,2400],[6,2600],[7,3000],[8,3500],[9,3600],[10,3700],[11,3800],[12,3900],
  [13,3900],[14,4300],[15,4300],[16,4500],[17,4600],[18,4800],[19,4900],[20,5000],[21,5100],[22,5200],[23,5300],[24,5500],
  [25,5300],[26,5500],[27,5700],[28,5750],[29,5800],[30,5820],[31,5850],[32,5870],[33,5890],[34,5900],[35,5920],[36,5950],
  [37,5960],[38,5970],[39,5980],[40,5990],[41,5995],[42,6000],[43,6000],[44,6000],[45,6000],[46,6000],[47,6000],[48,6000],
  [49,6000],[50,6000],[51,6000],[52,6000],[53,6000],[54,6000],[55,6000],[56,6000],[57,6000],[58,6000],[59,6000],[60,6000]
];
const SPAIN_FORT_M = 6000; // Reference saturation

// 3 MARKET SCENARIOS — adapté pour la Roumanie (pas d'acteur FP-like existant)
const SCENARIOS = {
  conservateur: {
    label: 'Conservateur',
    sublabel: 'Marche roumain prudent',
    desc: 'Marche immature, pas de franchise low-cost internationale. Clients habitues aux prix bas locaux. Cap ~3500 mbr. Churn eleve (marche non-eduque).',
    capMultiplier: 0.65,    // Cap at ~65% of theoretical (max ~3500-4000)
    rampSpeed: 0.90,        // 10% slower than Spain (was 0.80, too aggressive slowdown)
    churnAdj: 1.25,         // 25% more churn (market education needed)
    color: '#ef4444',
    refCurve: SPAIN_STANDARD,
    refM: SPAIN_STANDARD_M
  },
  base: {
    label: 'Base',
    sublabel: 'Hybride RO/ES',
    desc: 'FP brand premium + prix competitif (28EUR vs WC 80EUR). 1er low-cost intl = forte attractivite. Cap ~4500 mbr.',
    capMultiplier: 0.85,    // Cap at ~85% of theoretical
    rampSpeed: 1.0,         // Spain-comparable (1st intl low-cost = novelty effect compensates market immaturity)
    churnAdj: 1.10,         // 10% more churn than Spain (market education needed)
    color: '#fbbf24',
    refCurve: SPAIN_STANDARD,
    refM: SPAIN_STANDARD_M
  },
  optimiste: {
    label: 'Optimiste',
    sublabel: 'Espagne-like',
    desc: 'FP premiere franchise internationale low-cost = disruption totale. Pre-ventes agressives. Cap ~5500+ mbr. Churn standard.',
    capMultiplier: 1.0,     // Full theoretical potential
    rampSpeed: 1.0,         // Spain speed
    churnAdj: 1.0,          // Spain-level churn
    color: '#34d399',
    refCurve: SPAIN_FORT,
    refM: SPAIN_FORT_M
  }
};

// Interpolate members at month t from reference curve
function interpolateCurve(month, refCurve) {
  if(month <= 0) return 0;
  // Find surrounding data points
  let before = refCurve[0], after = refCurve[refCurve.length-1];
  for(let i = 0; i < refCurve.length; i++) {
    if(refCurve[i][0] === month) return refCurve[i][1];
    if(refCurve[i][0] < month) before = refCurve[i];
    if(refCurve[i][0] > month) { after = refCurve[i]; break; }
  }
  if(month > after[0]) return after[1]; // Beyond data: plateau
  // Linear interpolation
  const frac = (month - before[0]) / (after[0] - before[0]);
  return Math.round(before[1] + frac * (after[1] - before[1]));
}

// Get gross members at month t for a scenario
function scenarioMembers(month, totalTheo, scenarioKey) {
  const sc = SCENARIOS[scenarioKey];
  const effectiveM = totalTheo * sc.capMultiplier;
  // Get reference fraction at adjusted month (rampSpeed stretches/compresses time)
  const adjustedMonth = Math.round(month * sc.rampSpeed);
  const refMembers = interpolateCurve(adjustedMonth, sc.refCurve);
  const refFraction = refMembers / sc.refM;
  return Math.round(effectiveM * refFraction);
}

// Full ramp-up projection for a scenario
function scenarioRampUp(totalTheorique, months, scenarioKey) {
  months = months || 60;
  const sc = SCENARIOS[scenarioKey];
  const effectiveM = totalTheorique * sc.capMultiplier;
  const result = [];
  for(let m = 1; m <= months; m++) {
    const members = scenarioMembers(m, totalTheorique, scenarioKey);
    result.push({
      month: m,
      pct: effectiveM > 0 ? Math.round(members / effectiveM * 100) : 0,
      members,
      ca: Math.round(members * getPanierMoyenHT() / 1000)
    });
  }
  return result;
}

// Legacy wrapper — replaces old monthlyRampUp (12 months only, uses 'base' scenario)
function monthlyRampUp(totalTheorique) {
  return scenarioRampUp(totalTheorique, 12, 'base');
}

// --- SEASONALITY MODEL ---
// Fitness has strong seasonal patterns (source: IHRSA, Deloitte fitness industry reports)
// Index: 1.0 = average month. >1 = above average acquisition, <1 = below average
const SEASONALITY = [
  1.35, // Jan — New Year resolutions, peak inscriptions
  1.20, // Feb — Momentum from Jan, still strong
  1.10, // Mar — Spring motivation
  0.95, // Apr — Declining, Easter holidays
  0.85, // May — Pre-summer drop
  0.75, // Jun — Summer starts, vacations begin
  0.70, // Jul — Peak vacation, lowest
  0.72, // Aug — Still vacation, slight uptick end of month
  1.15, // Sep — Rentrée, strong comeback
  1.05, // Oct — Stable
  0.95, // Nov — Pre-holiday slowdown
  1.03  // Dec — Slight bump (gift subscriptions, pre-Jan)
];
// Normalized so annual average = 1.0 (sum = 11.80, avg = 0.983 → close enough)

// --- COHORT MODEL ---
// Spain data = NET members (real observed, already reflects churn implicitly)
// Churn model calibrated on FP France BP: low Y1 churn + annual renewal spike
// We apply seasonality modulation on top for monthly CA variation
function cohortModel(totalTheorique, months, personaMix, scenarioKey) {
  months = months || 60;
  scenarioKey = scenarioKey || 'base';
  const arpu = blendedARPU(personaMix);
  const sc = SCENARIOS[scenarioKey];

  const data = [];
  let cumulCA = 0;
  let prevMembers = 0;

  for(let m = 1; m <= months; m++) {
    const netMembers = scenarioMembers(m, totalTheorique, scenarioKey);
    const newMembers = Math.max(0, netMembers - prevMembers);

    // Month-dependent churn: Y1 low engagement churn, Y2+ steady-state (France BP)
    const monthChurn = blendedChurn(personaMix, m) * sc.churnAdj;
    // Annual renewal spike at contract anniversary months (France BP: 45% résiliation)
    const isRenewal = RENEWAL_MONTHS.includes(m);
    const effectiveChurn = isRenewal ? monthChurn + RENEWAL_CHURN_SPIKE : monthChurn;
    const impliedChurned = prevMembers > 0 ? Math.max(0, Math.round(prevMembers * effectiveChurn)) : 0;
    prevMembers = netMembers;

    // Apply seasonality: affects ARPU (attendance-linked revenue) and acquisition
    const monthIdx = (m - 1) % 12; // 0=Jan, 11=Dec
    const seasonFactor = SEASONALITY[monthIdx];
    const seasonalARPU = arpu * (0.85 + 0.15 * seasonFactor); // 85% base + 15% seasonal
    // Seasonality also modulates effective members (some pause in summer)
    const effectiveMembers = Math.round(netMembers * (0.90 + 0.10 * seasonFactor));

    const monthCA = effectiveMembers * seasonalARPU;
    cumulCA += monthCA;

    data.push({
      month: m,
      year: Math.ceil(m / 12),
      grossMembers: netMembers,
      newMembers,
      churned: impliedChurned,
      netMembers: effectiveMembers,
      churnRate: effectiveChurn,
      isRenewalSpike: isRenewal,
      seasonFactor,
      monthlyCA: Math.round(monthCA),
      cumulCA: Math.round(cumulCA),
      arpu: Math.round(seasonalARPU * 100) / 100
    });
  }

  return data;
}

// --- SENSITIVITY / TORNADO ANALYSIS ---
// Varies each key parameter ±20% while holding others at base, measures IRR impact
const SENSITIVITY_PARAMS = [
  { key:'churn',    label:'Churn mensuel',    baseField:'churnRate', unit:'%',   pctRange:0.30 },
  { key:'capex',    label:'CAPEX ouverture',  baseField:'capex',     unit:'EUR', pctRange:0.25 },
  { key:'arpu',     label:'ARPU mensuel',     baseField:'arpu',      unit:'EUR', pctRange:0.20 },
  { key:'rent',     label:'Loyer mensuel',    baseField:'rent',      unit:'EUR', pctRange:0.30 },
  { key:'rampSpeed',label:'Vitesse ramp-up',  baseField:'rampSpeed', unit:'x',   pctRange:0.25 },
  { key:'opex',     label:'OPEX fixe',        baseField:'fixedOpex', unit:'EUR', pctRange:0.20 }
];

function runSensitivity(totalTheorique, personaMix, avgQuartierPrice) {
  // Base case IRR (using 'base' scenario)
  const baseCohort = cohortModel(totalTheorique, 60, personaMix, 'base');
  const basePnl = buildPnL(baseCohort, avgQuartierPrice);
  const baseIRR = basePnl.irr;
  const baseNPV = basePnl.npv;

  const results = [];

  for(const param of SENSITIVITY_PARAMS) {
    const lowMult = 1 - param.pctRange;
    const highMult = 1 + param.pctRange;

    // Run low scenario
    const irrLow = runSensitivityCase(totalTheorique, personaMix, avgQuartierPrice, param.key, lowMult);
    // Run high scenario
    const irrHigh = runSensitivityCase(totalTheorique, personaMix, avgQuartierPrice, param.key, highMult);

    // For churn/capex/rent/opex: low value = better IRR (inverse relationship)
    // For arpu/rampSpeed: low value = worse IRR (direct relationship)
    const isInverse = ['churn','capex','rent','opex'].includes(param.key);

    results.push({
      key: param.key,
      label: param.label,
      pctRange: param.pctRange,
      irrLow: irrLow,   // IRR when parameter is at -pctRange%
      irrHigh: irrHigh,  // IRR when parameter is at +pctRange%
      irrSpread: Math.abs(irrHigh - irrLow), // Total IRR swing
      isInverse
    });
  }

  // Sort by spread (most impactful first)
  results.sort((a, b) => b.irrSpread - a.irrSpread);

  return { baseIRR, baseNPV, params: results };
}

function runSensitivityCase(totalTheorique, personaMix, avgQuartierPrice, paramKey, multiplier) {
  let adjCapex = getScaledCapex();
  let adjArpuMult = 1.0;
  let adjChurnMult = 1.0;
  let adjRampMult = 1.0;
  let adjRentMult = 1.0;
  let adjOpexMult = 1.0; // applies to staff + FP Cloud

  switch(paramKey) {
    case 'churn': adjChurnMult = multiplier; break;
    case 'capex': adjCapex = Math.round(getScaledCapex() * multiplier); break;
    case 'arpu': adjArpuMult = multiplier; break;
    case 'rent': adjRentMult = multiplier; break;
    case 'rampSpeed': adjRampMult = multiplier; break;
    case 'opex': adjOpexMult = multiplier; break;
  }

  // Build adjusted cohort (month-dependent churn — France BP calibration)
  const arpu = blendedARPU(personaMix) * adjArpuMult;
  const data = [];
  let cumulCA = 0;

  for(let m = 1; m <= 60; m++) {
    const adjMonth = Math.round(m * (adjRampMult > 0 ? adjRampMult : 1));
    let netMembers = scenarioMembers(Math.min(adjMonth, 60), totalTheorique, 'base');
    // Month-dependent churn + renewal spike + sensitivity multiplier
    const baseMonthChurn = blendedChurn(personaMix, m) * SCENARIOS.base.churnAdj;
    const adjMonthChurn = baseMonthChurn * adjChurnMult;
    const extraChurnDelta = adjMonthChurn - baseMonthChurn;
    if(extraChurnDelta !== 0) {
      netMembers = Math.round(netMembers * (1 - extraChurnDelta));
    }
    const monthIdx = (m - 1) % 12;
    const seasonFactor = SEASONALITY[monthIdx];
    const seasonalARPU = arpu * (0.85 + 0.15 * seasonFactor);
    const effectiveMembers = Math.round(netMembers * (0.90 + 0.10 * seasonFactor));
    const monthCA = effectiveMembers * seasonalARPU;
    cumulCA += monthCA;

    data.push({
      month: m, year: Math.ceil(m/12), netMembers: effectiveMembers,
      monthlyCA: Math.round(monthCA), cumulCA: Math.round(cumulCA), arpu: seasonalARPU
    });
  }

  // Build adjusted P&L (mirrors buildPnL structure — stepped rent)
  const leasingMonthly = getScaledLeasingAnnual() / 12;
  let cumulCashFlow = -adjCapex;
  const cashflows = [-adjCapex];
  let ebitdaY5 = 0;

  for(let i = 0; i < data.length; i++) {
    const yearIdx = Math.floor(i / 12);
    const yearNum = yearIdx + 1;
    // v6.46 — facturation 4 sem = 13 périodes/an
    const caAdherents = Math.round(data[i].monthlyCA * PNL_DEFAULTS.billingFactor);
    const ptRevenue = Math.round(PNL_DEFAULTS.ptMonthlyRevenue * Math.pow(1 + PNL_DEFAULTS.ptGrowth, yearIdx));
    const totalCA = caAdherents + ptRevenue;
    const costOfSales = Math.round(totalCA * PNL_DEFAULTS.costOfSalesRate);
    const margeBrute = totalCA - costOfSales;
    const staffM = Math.round(getStaffMonthly(totalCA, yearNum) * adjOpexMult);
    const rentM = Math.round(getSteppedRentMonthly(yearNum, 'objectifNego') * adjRentMult);
    const fpCloud = Math.round(PNL_DEFAULTS.fpCloudMonthly * Math.pow(1 + PNL_DEFAULTS.fpCloudGrowth, yearIdx) * adjOpexMult);
    // v6.45 — time-decay OPEX ops (Y1 20% → Y5+ 12%). Avant: flat 0.12 legacy (optimiste Y1-Y4).
    const opexRateYear = PNL_DEFAULTS.opexOpsRateByYear?.[Math.min(yearIdx, 4)] ?? PNL_DEFAULTS.opexOpsRate;
    const opexOps = Math.round(totalCA * opexRateYear);
    const redevance = Math.round(caAdherents * PNL_DEFAULTS.redevanceRate);
    const fondsPub = Math.round(caAdherents * PNL_DEFAULTS.fondsPubRate);
    const taxLocal = Math.round(totalCA * PNL_DEFAULTS.taxLocalRate);
    const leasing = yearNum <= PNL_DEFAULTS.leasingYears ? leasingMonthly : 0;
    const totalOpex = staffM + rentM + fpCloud + opexOps + redevance + fondsPub + taxLocal;
    const ebitda = margeBrute - totalOpex;
    const cashFlow = ebitda - leasing;
    cumulCashFlow += cashFlow;
    cashflows.push(cashFlow);
    if(yearNum === 5) ebitdaY5 += ebitda;
  }

  // Terminal value (EBITDA Y5 × exit multiple)
  const sensTV = Math.round(Math.max(0, ebitdaY5) * PNL_DEFAULTS.exitMultiple);
  cashflows[cashflows.length - 1] += sensTV;

  return calcIRR(cashflows);
}

// --- LTV / CAC ---
function calcLTV(arpu, churnRate) {
  if(churnRate <= 0) return arpu * 120; // 10 year cap
  return Math.round(arpu / churnRate);
}

const DEFAULT_CAC = 50; // EUR — marketing local estimation

// ═══════════════════════════════════════════════════════════════════
// P&L / IRR / FINANCIAL MODEL — calibré BP harmonisé v6.35 (Avril 2026).
// Source unique: MF FP - BP RO - vFinancement mixte - Avril.xlsx, sheets:
//   HYPOTHESES (paramètres), PL_CLUB_TYPE (P&L succursale 10 ans),
//   01_DCF_BPI (scenario financement simple BPI — Paul demandé en ref).
// Changement majeur vs v6.25 (BP V17):
//   - Staff: refactor plug ETP × salaires (plus de % CA)
//   - targetMembers: 4000 → 3600
//   - fondsPubRate: 1% → 2%
//   - exitMultiple: 6× → 8×
//   - Ajout churnAnnual (4.3%), staffChargeRate RO réduit (2.25%), inflation salaires +6%/an
// Non modifié (demande Paul "plug depuis l'app"): rentSteps, serviceCharge,
// marketingFee, clubSurface — tout ça reste contrôlé via sliders per-site.
// ═══════════════════════════════════════════════════════════════════
const PNL_DEFAULTS = {
  capex: 1176000,            // EUR — Travaux 840k + Equip CAPEX 40%=336k (HYPOTHESES!C81)
  leasingAnnual: 100800,     // EUR/an — 504k equip leasing 60% / 5 ans (HYPOTHESES!C88)
  leasingYears: 5,           // Duree leasing
  // ═══════════════════════════════════════════════════════════════
  // STRUCTURE DE FINANCEMENT — par club (aligné scénario BPI)
  // ═══════════════════════════════════════════════════════════════
  // Par-club: 30% equity / 70% loan @ 4% / 7 ans (taux SG garantie BPI 60%).
  // Source: 01_DCF_BPI!C68 (taux 4% retenu au niveau MF consolidé).
  // Décision Paul v6.35: propager ce taux 4% à chaque club (vs 6.5% SME V17).
  // NB: au niveau MF consolidé (40 clubs), le BP utilise:
  //   equity fondateurs 3.2M + dette SG 8M @ 4% (grâce 2 ans, maturité 8 ans linéaire).
  //   cf 01_DCF_BPI!C64-C70.
  financing: {
    equityRatio:    0.30,    // % apport associés
    loanRatio:      0.70,    // % emprunt bancaire
    loanRate:       0.04,    // 4% taux SG/BPI (v6.35) — était 6.5% (V17 SME classique)
    loanTermYears:  7,       // 7 ans amortissement (par club)
  },
  // ─────────────────────────────────────────────────────────────
  // STAFF — plug direct ETP × salaires (BP Avril 2026, plus de % CA)
  // Source: HYPOTHESES!C55-C61. Total A1 brut = 84k, + charges 2.25% = 85.89k.
  // 3 ETP (pas 4 comme le titre "4 ETP" du sheet — verified: 36k + 2×24k = 84k).
  // ─────────────────────────────────────────────────────────────
  staff: {
    managerSalary:   36000,  // EUR/an brut — 1 Responsable de club
    nbManagers:      1,
    vendorSalary:    24000,  // EUR/an brut — par ETP
    nbVendors:       2,      // 2 vendeurs
    chargeRate:      0.0225, // 2.25% charges patronales RO (taux réduit)
    inflationRate:   0.06,   // +6%/an salaires (revalorisation)
  },
  // Legacy compat (kept for any caller that still reads these):
  staffRate: 0.09,
  staffFloorAnnual: 85890,   // Total A1 chargé (BP harmonisé) — était 65k (V17)
  staffGrowth: 0.06,         // +6%/an (était 3%)
  // STEPPED RENT — Hala Laminor offer data (non modifié, controlled via sliders app)
  // Surface: 1449 m² | Service charges: 5€/m² | Marketing fee: 0.5€/m²
  // NB: BP harmonisé Avril 2026 utilise loyer FLAT 16900 + charges 2800/mois (= 14.07€/m²
  // all-in) + inflation 2%/an (HYPOTHESES!C51-C54). Pour alignement BP type vs app,
  // l'user slide loyer 12€ + charges 2€ (cf. export BP que Paul utilise dans son Excel).
  rentSteps: {
    surface: 1449,           // m² (Hala Laminor reference — user slide pour autres sites)
    serviceCharge: 5.0,      // EUR/m²/mois
    marketingFee: 0.5,       // EUR/m²/mois
    offerInitiale: [
      { fromYear: 1, rent: 12.0 },
      { fromYear: 3, rent: 14.0 },
      { fromYear: 5, rent: 15.0 },
    ],
    objectifNego: [
      { fromYear: 1, rent: 10.5 },
      { fromYear: 3, rent: 11.5 },
      { fromYear: 5, rent: 13.0 },
    ],
    indexation: 0.03,
  },
  rentGrowth: 0.02,          // +2%/an BP Avril (HYPOTHESES!C54) — était 3% HICP
  fpCloudMonthly: 600,       // EUR/mois (HYPOTHESES!C64)
  fpCloudGrowth: 0.01,       // ~1%/an
  // ─────────────────────────────────────────────────────────────
  // OPEX OPS — time-decay ramp-up (HYPOTHESES!C65-C68 + PL_CLUB_TYPE ligne 23)
  // Base = % du CA Total. A1 20% → A3 16% → A5+ 12% (cruising).
  // Note: HYPOTHESES!C66 mentionne inflation OPEX +4.5%/an, mais le P&L Excel
  // ne l'applique pas au-delà du taux × CA (vérifié: A5 = 12% × CA_A5 exactement).
  // Paramètre gardé en mémoire pour futures simulations stress.
  // ─────────────────────────────────────────────────────────────
  opexOpsRateByYear: [0.20, 0.18, 0.16, 0.14, 0.12], // Y1 → Y5+ (cruising)
  opexOpsRate: 0.12,         // Legacy — utilisé si pas d'index année
  opexOpsInflation: 0.045,   // HYPOTHESES!C66 — actuellement inactif (reserved for stress)
  costOfSalesRate: 0.028,    // 2.8% CA Total — HYPOTHESES!C63
  redevanceRate: 0.06,       // 6% CA Adhérents — succursales paient direct FP France (HYPOTHESES!C21)
  fondsPubRate: 0.02,        // 2% CA Adhérents — HYPOTHESES!C17 (DOUBLÉ vs 1% V17)
  taxLocalRate: 0.02,        // 2% CA Total — HYPOTHESES!C69 (taxe foncière + taxes locales RO)
  ptMonthlyRevenue: 2000,    // EUR/mois — 4 PT × 500€/mois (HYPOTHESES!C48)
  ptGrowth: 0.05,            // +5%/an
  clubSurface: 1449,         // m² — Hala Laminor (BP type = 1400, user slide)
  dapAnnual: 117600,         // EUR/an — CAPEX 1176k / 10 ans (HYPOTHESES!C82)
  citRate: 0.16,             // CIT Roumanie 16% (HYPOTHESES!C23)
  discountRate: 0.12,        // WACC 12% (HYPOTHESES!C114)
  caGrowthA4A6: 0.05,        // +5%/an post-maturité A4-A6 (HYPOTHESES!C38)
  caGrowthA7Plus: 0.02,      // +2%/an long terme A7+ (HYPOTHESES!C39)
  targetMembers: 3600,       // Cible maturité A3 (HYPOTHESES!C34) — était 4000 V17
  churnAnnual: 0.043,        // 4.3% churn annuel post-maturité (HYPOTHESES!C37) — nouveau
  exitMultiple: 8,           // EV/EBITDA sortie (HYPOTHESES!C116) — était 6× V17
  terminalGrowth: 0.02,      // Gordon-Shapiro (HYPOTHESES!C115)
  // Tarifs HT (HYPOTHESES!C42-C47) — pour référence, l'engine utilise priceBaseTTC
  priceBaseTTC: 27.8,        // Tarif Standard TTC (HYPOTHESES!C42) — était 28
  priceStandardHT: 22.98,    // Standard HT (HYPOTHESES!C45)
  pricePremiumHT: 31.6,      // Premium HT (HYPOTHESES!C43)
  priceUltimateHT: 39.5,     // Ultimate HT (HYPOTHESES!C44)
  arpuMeanHT: 25.49,         // Panier moyen HT avec VAD 20% (HYPOTHESES!C47)
  TAUX_VAD: 0.20,            // % clients VAD (HYPOTHESES!C46)
  TVA_RO: 0.21,              // TVA Roumanie (HYPOTHESES!C24)
  // v6.46 — Facturation 4 semaines = 13 périodes/an (pattern FP/low-cost).
  // Source: Paul BP Avril 2026 "facturation tout les 4 semaines = 13 mois".
  // Appliqué comme multiplicateur sur caAdherents MENSUEL pour annualiser à 13 périodes.
  // Ne s'applique PAS au PT revenue (ptMonthlyRevenue reste × 12).
  billingPeriodsPerYear: 13,
  billingFactor:         13 / 12,   // ≈ 1.0833 — applique au caAdherents mensuel
};
// v6.53 — expose PNL_DEFAULTS sur window pour que les IIFE modules
// (onboarding-tour.js etc.) puissent lire les vraies valeurs BP sans
// hardcoder. Mirror inerte (ref): les mutations de PNL_DEFAULTS seraient
// visibles des 2 côtés (même objet).
window.PNL_DEFAULTS = PNL_DEFAULTS;

// Get monthly rent (all-in: base rent + service charges + marketing) for a given year
// scenario: 'offerInitiale' or 'objectifNego'
// Rent override system — allows slider to adjust rent in real-time
window._rentOverride = null;   // {y1: number} — overrides base rent Y1 (scales Y3/Y5 proportionally)
window._chargeOverride = null; // {chargeTotal: number} — overrides (serviceCharge + marketingFee)
window._surfaceOverride = null;// {surface: number} — overrides club surface m² (scales loyer annuel)

// Per-site override maps — PERSISTED in localStorage so slider adjustments
// survive across sessions (fpRentOverrides / fpChargeOverrides / fpSurfaceOverrides).
// Keys are "lat.toFixed(3),lng.toFixed(3)".
window._rentOverrides    = (typeof safeStorage !== 'undefined') ? (safeStorage.get('fpRentOverrides', {})    || {}) : {};
window._chargeOverrides  = (typeof safeStorage !== 'undefined') ? (safeStorage.get('fpChargeOverrides', {})  || {}) : {};
window._surfaceOverrides = (typeof safeStorage !== 'undefined') ? (safeStorage.get('fpSurfaceOverrides', {}) || {}) : {};
// v6.65.1 — rayon de captage par site (m) + taux de capture par segment (global).
window._radiusOverrides  = (typeof safeStorage !== 'undefined') ? (safeStorage.get('fpRadiusOverrides', {})  || {}) : {};
window._captureRatesOverride = (typeof safeStorage !== 'undefined') ? (safeStorage.get('fpCaptureRates', null) || null) : null;
// v6.67 — structure de financement (GLOBALE, pas par site — décision corporate).
// null = défauts BP (30% equity / 70% dette @ 4% / 7 ans).
// Shape: {enabled:bool, equityRatio:0-1, loanRate:0-0.12, loanTermYears:3-15, at:epochMs}
// `at` sert au LWW cross-device (cloud-sync).
window._financingOverride = (typeof safeStorage !== 'undefined') ? (safeStorage.get('fpFinancing', null) || null) : null;
// Si override présent au boot (cross-device ou session précédente), applique-les.
if (typeof window.applyCaptureRatesOverride === 'function') window.applyCaptureRatesOverride();

/** Persist the 5 override structures to localStorage. Cheap (< 2 KB).
 *  v6.49 — également poussés cloud (via cloudSync.push, debounce 700ms pour
 *  coalesce les rapid slider moves). Pull des overrides au polling 5s + boot.
 *  v6.65.1 — inclut radius + capture rates (manquaient avant). */
let _overridesPushTimer = null;
window.persistOverrides = function persistOverrides() {
  if (typeof safeStorage !== 'undefined') {
    safeStorage.set('fpRentOverrides',    window._rentOverrides    || {});
    safeStorage.set('fpChargeOverrides',  window._chargeOverrides  || {});
    safeStorage.set('fpSurfaceOverrides', window._surfaceOverrides || {});
    safeStorage.set('fpRadiusOverrides',  window._radiusOverrides  || {});
    if (window._captureRatesOverride) safeStorage.set('fpCaptureRates', window._captureRatesOverride);
    if (window._financingOverride)    safeStorage.set('fpFinancing',   window._financingOverride);
  }
  // Debounce cloud push — les sliders peuvent fire 10+ events en quelques ms.
  if (_overridesPushTimer) clearTimeout(_overridesPushTimer);
  _overridesPushTimer = setTimeout(() => {
    try { window.cloudSync?.pushNow?.(); } catch {}
  }, 700);
};

// v6.49 — listener global: si les overrides arrivent du cloud (autre device),
// refresh la liste + markers. v6.58 — ET re-run la fiche d'analyse ouverte
// pour que IRR/NPV/sliders desktop reflètent l'input mobile (ou vice versa)
// sans attendre un clic user.
window.addEventListener('fp:overrides-updated', () => {
  try { window.renderCustomSites?.(); } catch {}
  try { window.refreshCustomMarkers?.(); } catch {}
  // v6.58 — si la fiche analyse desktop est ouverte, re-run l'analyse
  // avec les nouveaux overrides. Sinon les KPI restent stale jusqu'au
  // prochain click "Analyser".
  try {
    const card = document.getElementById('siteAnalysisCard');
    const last = window._lastCaptageLocation;
    if (card && card.style.display !== 'none' && last && typeof renderCaptageAnalysis === 'function') {
      // v6.65.1 — prend le radius synchro cloud s'il existe pour ce site
      const key = last.lat.toFixed(3) + ',' + last.lng.toFixed(3);
      const effectiveRadius = (window._radiusOverrides && window._radiusOverrides[key]) || last.radius;
      renderCaptageAnalysis(last.containerId, last.lat, last.lng, effectiveRadius);
      // Sync sliders DOM à la nouvelle valeur
      if (effectiveRadius !== last.radius) {
        ['captageRadiusSliderSite', 'captageRadiusSlider'].forEach(id => { const s = el(id); if (s) s.value = effectiveRadius; });
        ['captageRadiusValSite', 'captageRadiusVal'].forEach(id => { const v = el(id); if (v) v.textContent = (effectiveRadius/1000) + ' km'; });
      }
    }
  } catch (e) { console.warn('[fp:overrides-updated] desktop re-analysis failed:', e); }
});

function getRentSteps(scenario) {
  const steps = PNL_DEFAULTS.rentSteps[scenario || 'objectifNego'];
  if(!window._rentOverride || scenario === 'offerInitiale') return steps;
  // Scale Y3/Y5 proportionally to Y1 override
  const origY1 = PNL_DEFAULTS.rentSteps.objectifNego[0].rent;
  const ratio = window._rentOverride.y1 / origY1;
  return steps.map(s => ({...s, rent: Math.round(s.rent * ratio * 10) / 10}));
}

function getSteppedRentMonthly(yearNum, scenario) {
  const steps = getRentSteps(scenario);
  // Surface can be overridden per site (modulable pour sites custom de taille différente)
  const surface = (window._surfaceOverride && scenario !== 'offerInitiale')
    ? window._surfaceOverride.surface
    : PNL_DEFAULTS.rentSteps.surface;
  // Charges (service + marketing) can be overridden per site
  const defaultCharge = PNL_DEFAULTS.rentSteps.serviceCharge + PNL_DEFAULTS.rentSteps.marketingFee;
  const charge = (window._chargeOverride && scenario !== 'offerInitiale')
    ? window._chargeOverride.chargeTotal
    : defaultCharge;
  // Find applicable rent step
  let rentPerSqm = steps[0].rent;
  for(const step of steps) {
    if(yearNum >= step.fromYear) rentPerSqm = step.rent;
  }
  // HICP indexation from Y2 onwards
  const hicpMult = yearNum > 1 ? Math.pow(1 + PNL_DEFAULTS.rentSteps.indexation, yearNum - 1) : 1.0;
  return Math.round(surface * (rentPerSqm + charge) * hicpMult);
}

// Staff = plug direct ETP × salaires × (1 + charges patronales RO) × inflation^(year-1).
// v6.35 refactor (BP harmonisé Avril 2026): avant, c'était max(9% CA, plancher 65k).
// Nouveau modèle BP : 3 ETP (1 manager + 2 vendeurs) plug sans ratio CA.
// Source: MF FP - BP RO - vFinancement mixte - Avril.xlsx, HYPOTHESES!B56-B61 + C60.
function getStaffMonthly(monthlyCA, yearNum) {
  const s = PNL_DEFAULTS.staff;
  if (!s) {
    // Backward compat — si staff object pas défini, retombe sur legacy
    const rateStaff = Math.round(monthlyCA * (PNL_DEFAULTS.staffRate || 0.09));
    const floorStaff = Math.round((PNL_DEFAULTS.staffFloorAnnual || 65000) / 12 * Math.pow(1 + (PNL_DEFAULTS.staffGrowth || 0.03), yearNum - 1));
    return Math.max(rateStaff, floorStaff);
  }
  // Salaires bruts annuels : managerSalary × nbManagers + vendorSalary × nbVendors
  const grossAnnual = (s.managerSalary * s.nbManagers) + (s.vendorSalary * s.nbVendors);
  // + charges patronales (Roumanie taux réduit 2.25%)
  const chargedAnnual = grossAnnual * (1 + s.chargeRate);
  // Inflation salaires +6%/an (revalorisation annuelle)
  const inflated = chargedAnnual * Math.pow(1 + s.inflationRate, yearNum - 1);
  return Math.round(inflated / 12);
}

/**
 * Returns the linear scale ratio between the active site's surface override
 * and the reference BP surface (Hala Laminor = 1449 m²). Default 1.0 when no override.
 * @returns {number}
 */
// Surface-scaled CAPEX + leasing — larger clubs require proportionally more
// fit-out (travaux €/m²) and equipment (machines, lockers, showers).
// Ratio = current surface / reference surface (Hala 1449 m²).
function getSurfaceScale() {
  const refSurface = PNL_DEFAULTS.rentSteps?.surface || 1449;
  const current = window._surfaceOverride?.surface || refSurface;
  return current / refSurface;
}
// v6.71 — sandbox Studio FCF : overrides scénario (null = comportement
// identique, baseline 197 assertions intacte). Posés/restaurés par
// FcfStudio.computeWith(), jamais persistés.
window._capexOverride = null;         // {capex: EUR} — remplace capex AVANT scale surface
window._exitMultipleOverride = null;  // {x: number} — remplace exitMultiple
// v6.93 — coût one-off AJOUTÉ après scale (droit d'entrée master-franchise
// 400 k€ HT, demande Paul). Sandbox Studio FCF uniquement : null partout
// ailleurs → zéro impact baseline (197 assertions intactes).
window._capexExtraOverride = null;    // {extra: EUR, label: string}

function getScaledCapex() {
  const base = (window._capexOverride && typeof window._capexOverride.capex === 'number')
    ? window._capexOverride.capex : PNL_DEFAULTS.capex;
  const extra = (window._capexExtraOverride && typeof window._capexExtraOverride.extra === 'number')
    ? window._capexExtraOverride.extra : 0;
  return Math.round(base * getSurfaceScale()) + extra;
}
function getScaledLeasingAnnual() { return Math.round(PNL_DEFAULTS.leasingAnnual * getSurfaceScale()); }
function getEffectiveExitMultiple() {
  return (window._exitMultipleOverride && typeof window._exitMultipleOverride.x === 'number')
    ? window._exitMultipleOverride.x : PNL_DEFAULTS.exitMultiple;
}

// ═══ v6.76 — POINT MORT EN ADHÉRENTS ═══════════════════════════════
// Combien de membres STABILISÉS faut-il pour être neutre sur l'année ?
//   kind 'ebitda' → équilibre opérationnel (EBITDA annuel = 0)
//   kind 'fcfe'   → équilibre bas de page (EBITDA − leasing − service
//                   de dette = 0) — le "résultat bas de page" de Paul.
// Méthode : INVERSION du moteur réel. On construit une cohorte plate de
// M membres sur 60 mois, on la passe dans buildPnL (qui applique TOUS
// les réglages courants : loyer/charges/surface du site, financement,
// CAPEX/sortie sandbox), et on cherche M par bisection jusqu'à ce que
// l'agrégat de l'année visée soit nul. Zéro réimplémentation → toujours
// cohérent avec le P&L affiché.
// yearIdx 0..4 (A1..A5) — le point mort varie avec l'année : paliers de
// loyer, OPEX 20%→12%, staff +6%/an, leasing A1-A5, dette sur sa durée.
// forceFinancing (optionnel) : 'equity' = force 100% fonds propres,
// 'ref' = force la structure BP (30/70), null/undefined = réglage courant.
function computeBreakEvenMembers(kind, yearIdx, forceFinancing) {
  const arpu = getFP_MONTHLY_HT();
  if (!arpu || arpu <= 0) return null;
  const savedFin = window._financingOverride;
  try {
    if (forceFinancing === 'equity') window._financingOverride = { enabled: false };
    else if (forceFinancing === 'ref') window._financingOverride = null;
    const evalM = (M) => {
      const cohort = Array.from({ length: 60 }, (_, i) => ({ month: i + 1, monthlyCA: M * arpu, netMembers: M, arpu }));
      const p = buildPnL(cohort, 0);
      const months = p.monthly.slice(yearIdx * 12, yearIdx * 12 + 12);
      return months.reduce((a, m) => a + (kind === 'fcfe' ? m.cashFlowEquity : m.ebitda), 0);
    };
    let lo = 0, hi = 10000;
    if (evalM(hi) < 0) return null;      // jamais rentable même à 10 000 mbr
    if (evalM(0) >= 0) return 0;
    for (let it = 0; it < 20; it++) {
      const mid = (lo + hi) / 2;
      if (evalM(mid) >= 0) hi = mid; else lo = mid;
    }
    return Math.ceil(hi);
  } finally {
    window._financingOverride = savedFin;
  }
}
window.computeBreakEvenMembers = computeBreakEvenMembers;

/**
 * Build a 60-month P&L + IRR/NPV for a site given its member cohort trajectory.
 * Pure function — reads PNL_DEFAULTS + window overrides (_rentOverride, _chargeOverride, _surfaceOverride).
 *
 * @param {Array<{month:number, monthlyCA:number, netMembers:number, arpu:number}>} cohortData
 *        60-entry array of monthly projections (from computeCohort).
 * @param {number} avgQuartierPrice Average revenue-weighted neighborhood price/mo.
 * @returns {{
 *   monthly: Array<object>,
 *   annualCA: number[],            // 5 years
 *   annualEBITDA: number[],        // 5 years
 *   breakevenMonth: number|null,
 *   paybackMonth: number|null,
 *   irr: number,                   // project IRR (unlevered) %
 *   npv: number,                   // at discountRate
 *   irrEquity: number,             // levered equity IRR %
 *   npvEquity: number,
 *   equity: number,
 *   loanPrincipal: number,
 *   loanMonthlyPayment: number,
 *   totalInterest: number,
 *   financing: object              // ref to PNL_DEFAULTS.financing
 * }}
 */
/**
 * v6.67 — structure de financement effective : défauts BP (30/70 @ 4% / 7 ans)
 * ou override user (window._financingOverride). enabled:false = 100% equity
 * (aucune dette bancaire). Sans override, retourne des valeurs STRICTEMENT
 * identiques aux défauts → la baseline de tests (197 assertions) est intacte.
 */
function getEffectiveFinancing() {
  const base = PNL_DEFAULTS.financing || { equityRatio: 1, loanRatio: 0, loanRate: 0, loanTermYears: 7 };
  const o = window._financingOverride;
  if (!o) return { equityRatio: base.equityRatio, loanRatio: base.loanRatio, loanRate: base.loanRate, loanTermYears: base.loanTermYears, enabled: true };
  if (o.enabled === false) return { equityRatio: 1, loanRatio: 0, loanRate: 0, loanTermYears: 0, enabled: false };
  const eq = (typeof o.equityRatio === 'number') ? Math.min(1, Math.max(0.05, o.equityRatio)) : base.equityRatio;
  return {
    equityRatio: eq,
    loanRatio: Math.max(0, 1 - eq),
    loanRate: (typeof o.loanRate === 'number') ? Math.min(0.15, Math.max(0, o.loanRate)) : base.loanRate,
    loanTermYears: (typeof o.loanTermYears === 'number') ? Math.min(15, Math.max(1, Math.round(o.loanTermYears))) : base.loanTermYears,
    enabled: true,
  };
}
window.getEffectiveFinancing = getEffectiveFinancing;

function buildPnL(cohortData, avgQuartierPrice) {
  const capex = getScaledCapex();
  const leasingMonthly = getScaledLeasingAnnual() / 12;
  const arpu = getFP_MONTHLY_HT();

  // ─── Financing structure: equity + bank loan on CAPEX ────────
  const fin = getEffectiveFinancing();
  const equity = Math.round(capex * fin.equityRatio);
  const loanPrincipal = capex * fin.loanRatio;
  const monthlyRate = fin.loanRate / 12;
  const loanMonths = fin.loanTermYears * 12;
  // Standard amortization payment: M = PV × r / (1 - (1+r)^-n)
  // Taux 0% avec dette → amortissement linéaire (évite division par zéro).
  const loanMonthlyPayment = loanMonths > 0 && loanPrincipal > 0
    ? (monthlyRate > 0
        ? loanPrincipal * monthlyRate / (1 - Math.pow(1 + monthlyRate, -loanMonths))
        : loanPrincipal / loanMonths)
    : 0;
  let loanOutstanding = loanPrincipal;

  let cumulCashFlow = -capex;                  // PROJECT cashflow (unlevered, drives irrBase)
  let cumulCashFlowEquity = -equity;           // EQUITY cashflow (levered, for irrEquity)
  const monthly = [];
  const annualCA = [0,0,0,0,0];
  const annualEBITDA = [0,0,0,0,0];
  // v6.67 — séries investisseur : FCFE (net free cash flow to equity, avant IS
  // — aligné sur le modèle qui ne modélise pas le CIT dans les cashflows) et
  // service de la dette (intérêts + principal) pour le DSCR.
  const annualFCFE = [0,0,0,0,0];
  const annualDebtService = [0,0,0,0,0];
  let breakevenMonth = null;
  let paybackMonth = null;
  let paybackEquityMonth = null;               // 1er mois où cumul FCFE > 0
  const cashflows = [-capex];                  // unlevered IRR inputs
  const cashflowsEquity = [-equity];           // levered IRR inputs

  for(let i = 0; i < cohortData.length && i < 60; i++) {
    const d = cohortData[i];
    const yearIdx = Math.floor(i / 12);
    const yearNum = yearIdx + 1; // A1, A2, ...

    // --- REVENUE ---
    // v6.46 — facturation 4 sem = 13 périodes/an → CA adhérents × 13/12
    const caAdherents = Math.round(d.monthlyCA * PNL_DEFAULTS.billingFactor);
    const ptRevenue = Math.round(PNL_DEFAULTS.ptMonthlyRevenue * Math.pow(1 + PNL_DEFAULTS.ptGrowth, yearIdx));
    const totalCA = caAdherents + ptRevenue;

    // --- COST OF SALES ---
    const costOfSales = Math.round(totalCA * PNL_DEFAULTS.costOfSalesRate);
    const margeBrute = totalCA - costOfSales;

    // --- OPEX ---
    // Staff = max(9% CA, plancher 4 ETP) — BP officiel FP
    const staffMonthly = getStaffMonthly(totalCA, yearNum);
    // Stepped rent — Hala Laminor paliers (objectif négo) + HICP indexation
    const rentMonthly = getSteppedRentMonthly(yearNum, 'objectifNego');
    // FP Cloud
    const fpCloud = Math.round(PNL_DEFAULTS.fpCloudMonthly * Math.pow(1 + PNL_DEFAULTS.fpCloudGrowth, yearIdx));
    // OPEX Ops with TIME-DECAY (Y1 20% → Y5+ 15%). Fixed costs like energy,
    // security, maintenance, insurance don't scale with CA, so ratio is higher
    // in ramp-up years and normalizes as CA grows. Conservative vs OnAir 10.8%.
    const opexRateYear = PNL_DEFAULTS.opexOpsRateByYear?.[Math.min(yearIdx, 4)]
                      ?? PNL_DEFAULTS.opexOpsRate;
    const opexOps = Math.round(totalCA * opexRateYear);
    // Redevance marque (6% of CA Adherents)
    const redevance = Math.round(caAdherents * PNL_DEFAULTS.redevanceRate);
    // Fonds publicitaire (2% of CA Adherents)
    const fondsPub = Math.round(caAdherents * PNL_DEFAULTS.fondsPubRate);
    // Impôts locaux RO (taxa pe clădiri + impozit local) — 2% du CA Total (v6.25)
    const taxLocal = Math.round(totalCA * PNL_DEFAULTS.taxLocalRate);
    // Leasing (Y1-Y5 only)
    const leasing = yearNum <= PNL_DEFAULTS.leasingYears ? leasingMonthly : 0;

    const totalOpex = staffMonthly + rentMonthly + fpCloud + opexOps + redevance + fondsPub + taxLocal;
    const ebitda = margeBrute - totalOpex;

    // --- FINANCING (loan amortization) ---
    let interestExp = 0, principalPay = 0;
    if (loanOutstanding > 0 && i < loanMonths) {
      interestExp = Math.round(loanOutstanding * monthlyRate);
      principalPay = Math.round(loanMonthlyPayment - interestExp);
      if (principalPay > loanOutstanding) principalPay = Math.round(loanOutstanding);
      loanOutstanding -= principalPay;
    }

    const cashFlow = ebitda - leasing;                               // unlevered (project)
    const cashFlowEquity = ebitda - leasing - interestExp - principalPay; // levered (equity)
    const resultatCourant = ebitda - interestExp;                    // avant impôts (after interest)

    cumulCashFlow += cashFlow;
    cumulCashFlowEquity += cashFlowEquity;

    if(yearIdx < 5) {
      annualCA[yearIdx] += totalCA;
      annualEBITDA[yearIdx] += ebitda;
      annualFCFE[yearIdx] += cashFlowEquity;
      annualDebtService[yearIdx] += interestExp + principalPay;
    }

    if(breakevenMonth === null && ebitda > 0) breakevenMonth = i + 1;
    if(paybackMonth === null && cumulCashFlow > 0) paybackMonth = i + 1;
    if(paybackEquityMonth === null && cumulCashFlowEquity > 0) paybackEquityMonth = i + 1;

    cashflows.push(cashFlow);
    cashflowsEquity.push(cashFlowEquity);

    monthly.push({
      month: i + 1, year: yearNum,
      ca: totalCA, caAdherents, ptRevenue, costOfSales, margeBrute,
      staffMonthly, rentMonthly, fpCloud, opexOps, redevance, fondsPub, taxLocal, leasing,
      totalOpex, ebitda, cashFlow, cumulCashFlow,
      // Financing fields
      interestExp, principalPay, loanOutstanding,
      resultatCourant, cashFlowEquity, cumulCashFlowEquity,
      fixedOpex: staffMonthly + fpCloud, // for display compat
      rent: rentMonthly, franchiseFee: redevance + fondsPub
    });
  }

  // --- Terminal Value (standard DCF — valeur de sortie Y5) ---
  // TV = EBITDA_Y5 × exit multiple, ajouté au dernier cashflow
  const ebitdaY5Annual = annualEBITDA[4] || 0;
  const terminalValue = Math.round(ebitdaY5Annual * getEffectiveExitMultiple());

  // IRR/NPV with terminal value (= investment horizon with exit)
  const cfWithTV = [...cashflows];
  cfWithTV[cfWithTV.length - 1] += terminalValue;
  const irr = calcIRR(cfWithTV);
  const npv = calcNPV(cfWithTV, PNL_DEFAULTS.discountRate);

  // IRR/NPV without terminal value (= pure operating cashflows 5 ans)
  const irrOps = calcIRR(cashflows);
  const npvOps = calcNPV(cashflows, PNL_DEFAULTS.discountRate);

  const rentY1 = getSteppedRentMonthly(1, 'objectifNego');
  const fixedOpexDisplay = Math.round(PNL_DEFAULTS.staffFloorAnnual / 12 + PNL_DEFAULTS.fpCloudMonthly);

  // Also compute IRR with offre initiale for comparison
  let irrOffreInitiale = null;
  {
    const cfInit = [-capex];
    for(let i = 0; i < cohortData.length && i < 60; i++) {
      const d = cohortData[i];
      const yIdx = Math.floor(i / 12);
      const yNum = yIdx + 1;
      // v6.46 — facturation 4 sem = 13 périodes/an
      const caAdh = Math.round(d.monthlyCA * PNL_DEFAULTS.billingFactor);
      const ptRev = Math.round(PNL_DEFAULTS.ptMonthlyRevenue * Math.pow(1 + PNL_DEFAULTS.ptGrowth, yIdx));
      const tCA = caAdh + ptRev;
      const cos = Math.round(tCA * PNL_DEFAULTS.costOfSalesRate);
      const mb = tCA - cos;
      const stf = getStaffMonthly(tCA, yNum);
      const rnt = getSteppedRentMonthly(yNum, 'offerInitiale');
      const fpc = Math.round(PNL_DEFAULTS.fpCloudMonthly * Math.pow(1 + PNL_DEFAULTS.fpCloudGrowth, yIdx));
      // v6.45 — time-decay (idem main P&L), pas flat 0.12 legacy
      const opxRate = PNL_DEFAULTS.opexOpsRateByYear?.[Math.min(yIdx, 4)] ?? PNL_DEFAULTS.opexOpsRate;
      const opx = Math.round(tCA * opxRate);
      const rdv = Math.round(caAdh * PNL_DEFAULTS.redevanceRate);
      const fpb = Math.round(caAdh * PNL_DEFAULTS.fondsPubRate);
      const lsg = yNum <= PNL_DEFAULTS.leasingYears ? leasingMonthly : 0;
      const totOpex = stf + rnt + fpc + opx + rdv + fpb;
      const ebt = mb - totOpex;
      cfInit.push(ebt - lsg);
    }
    // Add terminal value to offre initiale too
    const cfInitTV = [...cfInit];
    cfInitTV[cfInitTV.length - 1] += terminalValue;
    irrOffreInitiale = calcIRR(cfInitTV);
  }

  // ─── EQUITY IRR/NPV (levered — return to associates after debt service) ──
  const cfEqTV = [...cashflowsEquity];
  cfEqTV[cfEqTV.length - 1] += terminalValue;
  const irrEquity = calcIRR(cfEqTV);
  const npvEquity = calcNPV(cfEqTV, PNL_DEFAULTS.discountRate);

  // Total interest paid over loan term (sum monthly interest)
  const totalInterest = monthly.reduce((a, m) => a + (m.interestExp || 0), 0);

  // ─── v6.67 — Indicateurs investisseur (dette / equity) ────────────
  // DSCR annuel = (EBITDA − leasing) / service de la dette. null si pas de
  // service de dette cette année-là (dette OFF ou prêt déjà remboursé).
  const annualLeasing = annualEBITDA.map((_, y) =>
    (y + 1) <= PNL_DEFAULTS.leasingYears ? getScaledLeasingAnnual() : 0);
  const dscrByYear = annualDebtService.map((ds, y) =>
    ds > 0 ? Math.round(((annualEBITDA[y] - annualLeasing[y]) / ds) * 100) / 100 : null);
  const dscrValues = dscrByYear.filter(v => v !== null);
  const dscrMin = dscrValues.length ? Math.min(...dscrValues) : null;
  const dscrAvg = dscrValues.length
    ? Math.round(dscrValues.reduce((a, b) => a + b, 0) / dscrValues.length * 100) / 100 : null;
  // DSCR "cruising" (A2+) — l'A1 en ramp-up a souvent un EBITDA négatif,
  // structurellement non couvrant (financé par l'equity/BFR) : c'est le DSCR
  // des années de croisière que la banque regarde pour dimensionner la dette.
  const dscrCruise = dscrByYear.slice(1).filter(v => v !== null);
  const dscrMinCruise = dscrCruise.length ? Math.min(...dscrCruise) : null;
  // FCFE cumulé 5 ans (hors equity initiale, hors TV) + MOIC 5 ans avec exit.
  // MOIC = (Σ FCFE + valeur terminale) / equity investie.
  const fcfe5y = Math.round(annualFCFE.reduce((a, b) => a + b, 0));
  const moic = equity > 0
    ? Math.round(((fcfe5y + terminalValue) / equity) * 100) / 100 : null;

  return {
    monthly, annualCA: annualCA.map(Math.round), annualEBITDA: annualEBITDA.map(Math.round),
    capex, rent: rentY1, fixedOpex: fixedOpexDisplay,
    breakevenMonth, paybackMonth,
    irr, npv, irrOffreInitiale,
    irrOps, npvOps, terminalValue,
    // Financing
    equity, loanPrincipal, loanMonthlyPayment: Math.round(loanMonthlyPayment),
    irrEquity, npvEquity, totalInterest,
    financing: fin,
    // v6.67 — investisseur : FCFE, DSCR, MOIC, payback equity
    annualFCFE: annualFCFE.map(Math.round), fcfe5y,
    annualDebtService: annualDebtService.map(Math.round),
    dscrByYear, dscrMin, dscrAvg, dscrMinCruise, moic, paybackEquityMonth,
    totalCA5y: Math.round(annualCA.reduce((a,b)=>a+b,0)),
    avgMargin: monthly.length > 0 ? Math.round(monthly.slice(-12).reduce((a,m)=>a+m.ebitda,0) / 12) : 0,
    rentSteps: PNL_DEFAULTS.rentSteps, leasingMonthly
  };
}

// IRR calculation — bisection method (robust, no overflow)
function calcIRR(cashflows) {
  // Bisection between -50% and +200% monthly rate
  let lo = -0.5, hi = 2.0;
  const maxIter = 200;
  const tol = 1e-6;

  // Check if IRR exists (sum of all cashflows must be positive for positive IRR)
  const totalCF = cashflows.reduce((a,b) => a + b, 0);
  if(totalCF <= 0) {
    // Try to find negative IRR
    hi = 0;
    lo = -0.99;
  }

  for(let iter = 0; iter < maxIter; iter++) {
    const mid = (lo + hi) / 2;
    let npv = 0;
    for(let t = 0; t < cashflows.length; t++) {
      const denom = Math.pow(1 + mid, t);
      if(denom === 0 || !isFinite(denom)) break;
      npv += cashflows[t] / denom;
    }
    if(Math.abs(npv) < tol || (hi - lo) < tol) {
      // Convert monthly rate to annual
      const annualRate = Math.pow(1 + mid, 12) - 1;
      return Math.round(annualRate * 100 * 100) / 100; // % with 2 decimals
    }
    if(npv > 0) lo = mid; else hi = mid;
  }
  const annualRate = Math.pow(1 + (lo+hi)/2, 12) - 1;
  return Math.round(annualRate * 100 * 100) / 100;
}

// NPV calculation — rate is annual, cashflows are monthly
function calcNPV(cashflows, annualRate) {
  const monthlyRate = Math.pow(1 + annualRate, 1/12) - 1; // Convert annual to monthly
  let npv = 0;
  for(let t = 0; t < cashflows.length; t++) {
    npv += cashflows[t] / Math.pow(1 + monthlyRate, t);
  }
  return Math.round(npv);
}

// --- MONTE CARLO SIMULATION ---
// N iterations with random perturbations of key variables → distribution of IRR/NPV outcomes
function runMonteCarlo(totalTheorique, personaMix, avgQuartierPrice, iterations) {
  iterations = iterations || 1000;
  const results = { irr: [], npv: [], payback: [], breakeven: [], caA3: [] };

  // Box-Muller normal distribution
  function randn() {
    let u = 0, v = 0;
    while(u === 0) u = Math.random();
    while(v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // Perturbation ranges (mean=1.0, stddev)
  const vars = {
    captage:    { std: 0.15 }, // ±15% members théo
    arpu:       { std: 0.10 }, // ±10% ARPU
    churn:      { std: 0.20 }, // ±20% churn rate
    capex:      { std: 0.12 }, // ±12% CAPEX
    rent:       { std: 0.15 }, // ±15% loyer
    opex:       { std: 0.10 }, // ±10% OPEX
    rampSpeed:  { std: 0.15 }, // ±15% vitesse ramp-up
  };

  const baseARPU = blendedARPU(personaMix);

  for(let i = 0; i < iterations; i++) {
    // Random perturbations
    const pCapt = Math.max(0.5, 1 + randn() * vars.captage.std);
    const pArpu = Math.max(0.7, 1 + randn() * vars.arpu.std);
    const pChurn = Math.max(0.5, 1 + randn() * vars.churn.std);
    const pCapex = Math.max(0.7, 1 + randn() * vars.capex.std);
    const pRent = Math.max(0.6, 1 + randn() * vars.rent.std);
    const pOpex = Math.max(0.7, 1 + randn() * vars.opex.std);
    const pRamp = Math.max(0.5, 1 + randn() * vars.rampSpeed.std);

    const simTheo = Math.round(totalTheorique * pCapt);
    const simARPU = baseARPU * pArpu;

    // Build cohort with perturbed ramp speed
    const simCohort = [];
    let prevM = 0, cumulCA = 0;
    for(let m = 1; m <= 60; m++) {
      const adjMonth = Math.round(m * SCENARIOS.base.rampSpeed * pRamp);
      const refMembers = interpolateCurve(adjMonth, SPAIN_STANDARD);
      const refFrac = refMembers / SPAIN_STANDARD_M;
      const effectiveM = simTheo * SCENARIOS.base.capMultiplier;
      const netMembers = Math.round(effectiveM * refFrac);
      const monthIdx = (m - 1) % 12;
      const seasonFactor = SEASONALITY[monthIdx];
      const effMembers = Math.round(netMembers * (0.90 + 0.10 * seasonFactor));
      const monthCA = effMembers * simARPU * (0.85 + 0.15 * seasonFactor);
      cumulCA += monthCA;
      simCohort.push({ month: m, netMembers: effMembers, monthlyCA: Math.round(monthCA), arpu: simARPU });
      prevM = netMembers;
    }

    // Build P&L with perturbed costs (stepped rent)
    const capex = Math.round(getScaledCapex() * pCapex);
    const leasingMonthly = Math.round(getScaledLeasingAnnual() / 12);
    const cashflows = [-capex];
    let cumulCF = -capex, beMonth = null, pbMonth = null, mcEbitdaY5 = 0;
    const annualCA = [0,0,0,0,0];

    for(let m = 0; m < 60; m++) {
      const d = simCohort[m];
      const yearIdx = Math.floor(m / 12);
      const yearNum = yearIdx + 1;
      // v6.46 — facturation 4 sem = 13 périodes/an
      const caAdherents = Math.round(d.monthlyCA * PNL_DEFAULTS.billingFactor);
      const ptRev = Math.round(PNL_DEFAULTS.ptMonthlyRevenue * Math.pow(1.05, yearIdx));
      const totalCA = caAdherents + ptRev;
      const cos = Math.round(totalCA * PNL_DEFAULTS.costOfSalesRate);
      const margeBrute = totalCA - cos;
      const staffM = Math.round(getStaffMonthly(totalCA, yearNum) * pOpex);
      const rentM = Math.round(getSteppedRentMonthly(yearNum, 'objectifNego') * pRent);
      const fpCloud = Math.round(PNL_DEFAULTS.fpCloudMonthly * Math.pow(1.01, yearIdx) * pOpex);
      // v6.45 — time-decay (idem main P&L), pas flat 0.12 legacy
      const mcOpexRate = PNL_DEFAULTS.opexOpsRateByYear?.[Math.min(yearIdx, 4)] ?? PNL_DEFAULTS.opexOpsRate;
      const opexOps = Math.round(totalCA * mcOpexRate * pOpex);
      const redev = Math.round(caAdherents * (PNL_DEFAULTS.redevanceRate + PNL_DEFAULTS.fondsPubRate));
      const taxLocal = Math.round(totalCA * PNL_DEFAULTS.taxLocalRate);
      const leasing = yearNum <= 5 ? leasingMonthly : 0;
      const totalOpex = staffM + rentM + fpCloud + opexOps + redev + taxLocal;
      const ebitda = margeBrute - totalOpex;
      const cf = ebitda - leasing;
      cumulCF += cf;
      cashflows.push(cf);
      if(yearIdx < 5) annualCA[yearIdx] += totalCA;
      if(yearIdx === 4) mcEbitdaY5 += ebitda;
      if(beMonth === null && ebitda > 0) beMonth = m + 1;
      if(pbMonth === null && cumulCF > 0) pbMonth = m + 1;
    }

    // Terminal value
    const mcTV = Math.round(Math.max(0, mcEbitdaY5) * PNL_DEFAULTS.exitMultiple);
    cashflows[cashflows.length - 1] += mcTV;

    const irr = calcIRR(cashflows);
    const npv = calcNPV(cashflows, PNL_DEFAULTS.discountRate);
    results.irr.push(irr);
    results.npv.push(npv);
    results.payback.push(pbMonth || 61);
    results.breakeven.push(beMonth || 61);
    results.caA3.push(annualCA[2]);
  }

  // Sort and compute percentiles
  function percentile(arr, p) {
    const sorted = [...arr].sort((a,b) => a - b);
    const idx = Math.floor(p / 100 * sorted.length);
    return sorted[Math.min(idx, sorted.length - 1)];
  }
  function mean(arr) { return arr.reduce((a,b) => a + b, 0) / arr.length; }
  function stddev(arr) { const m = mean(arr); return Math.sqrt(arr.reduce((a,b) => a + (b-m)**2, 0) / arr.length); }

  // Probability of positive IRR
  const probPositiveIRR = Math.round(results.irr.filter(v => v > 0).length / iterations * 100);
  const probIRR15 = Math.round(results.irr.filter(v => v > 15).length / iterations * 100);
  const probPayback36 = Math.round(results.payback.filter(v => v <= 36).length / iterations * 100);

  // IRR histogram bins (for chart)
  const irrSorted = [...results.irr].sort((a,b) => a - b);
  const irrMin = Math.floor(irrSorted[0] / 5) * 5;
  const irrMax = Math.ceil(irrSorted[irrSorted.length-1] / 5) * 5;
  const bins = [];
  for(let b = irrMin; b < irrMax; b += 5) {
    const count = results.irr.filter(v => v >= b && v < b + 5).length;
    bins.push({ label: `${b}-${b+5}%`, count, pct: Math.round(count / iterations * 100), midpoint: b + 2.5 });
  }

  return {
    iterations,
    irr: { mean: Math.round(mean(results.irr)*10)/10, std: Math.round(stddev(results.irr)*10)/10, p5: percentile(results.irr, 5), p25: percentile(results.irr, 25), p50: percentile(results.irr, 50), p75: percentile(results.irr, 75), p95: percentile(results.irr, 95), min: irrSorted[0], max: irrSorted[irrSorted.length-1] },
    npv: { mean: Math.round(mean(results.npv)), std: Math.round(stddev(results.npv)), p5: percentile(results.npv, 5), p50: percentile(results.npv, 50), p95: percentile(results.npv, 95) },
    payback: { mean: Math.round(mean(results.payback)*10)/10, p50: percentile(results.payback, 50), p95: percentile(results.payback, 95) },
    caA3: { mean: Math.round(mean(results.caA3)), p5: percentile(results.caA3, 5), p95: percentile(results.caA3, 95) },
    probPositiveIRR, probIRR15, probPayback36,
    bins
  };
}

// --- EXECUTIVE SUMMARY / GO-NO-GO SCORING ---
// Weighted scoring algorithm — 100 points, Bain-level decision framework
function computeExecSummary(r) {
  const scores = {};

  // 1. MARKET SIZE (25 pts) — population cible + gap de pénétration
  const popPts = Math.min(12, r.popTarget / 5000); // 60k = 12pts max
  const gapPts = Math.min(8, r.native.penGap / 1.2); // 8.5pp gap = 8pts
  const mixPts = Math.min(5, (r.personaMix.jeunesActifs + r.personaMix.cspPlus) * 10); // Profil attractif
  scores.market = { score: Math.round((popPts + gapPts + mixPts) * 10) / 10, max: 25, label: 'Potentiel Marché',
    details: `Pop. cible ${fmt(r.popTarget)} | Gap pénétration +${r.native.penGap}pp | Mix JA+CSP+ ${Math.round((r.personaMix.jeunesActifs+r.personaMix.cspPlus)*100)}%` };

  // 2. FINANCIAL VIABILITY (25 pts) — IRR + payback + breakeven
  const basePnl = r.pnl.base;
  const irrPts = Math.min(10, Math.max(0, basePnl.irr / 3)); // 30%+ = 10pts
  const paybackPts = basePnl.paybackMonth ? Math.min(8, Math.max(0, (48 - basePnl.paybackMonth) / 5)) : 0;
  const bevenPts = basePnl.breakevenMonth ? Math.min(7, Math.max(0, (18 - basePnl.breakevenMonth) / 2)) : 0;
  scores.financial = { score: Math.round((irrPts + paybackPts + bevenPts) * 10) / 10, max: 25, label: 'Viabilité Financière',
    details: `IRR ${basePnl.irr}% | Payback M${basePnl.paybackMonth||'>60'} | Breakeven M${basePnl.breakevenMonth||'>60'}` };

  // 3. COMPETITIVE LANDSCAPE (20 pts) — capture volume + faible saturation
  const capturePts = Math.min(8, r.totalTheorique / 700); // 5600 = 8pts
  const saturationPts = Math.min(7, r.comps.length <= 3 ? 7 : r.comps.length <= 6 ? 5 : r.comps.length <= 10 ? 3 : 1);
  const ltvCacPts = Math.min(5, r.ltvCacRatio / 4); // 20x = 5pts
  scores.competitive = { score: Math.round((capturePts + saturationPts + ltvCacPts) * 10) / 10, max: 20, label: 'Paysage Concurrentiel',
    details: `${fmt(r.totalTheorique)} mbr théo | ${r.comps.length} concurrents | LTV/CAC ${r.ltvCacRatio}x` };

  // 4. LOCATION QUALITY (15 pts) — SAZ + accessibility
  const sazScore = r.saz ? Math.min(8, r.saz.total / 10) : 4;
  const walkInPts = Math.min(4, r.walkIn.walkInMembers / 100); // 400 walk-in = 4pts
  const accessPts = Math.min(3, r.native.captured > 1000 ? 3 : r.native.captured > 500 ? 2 : 1);
  scores.location = { score: Math.round((sazScore + walkInPts + accessPts) * 10) / 10, max: 15, label: 'Qualité Emplacement',
    details: `SAZ ${r.saz?.total||'?'}/100 | Walk-in ${fmt(r.walkIn.walkInMembers)} | Natifs ${fmt(r.native.captured)}` };

  // 5. RISK PROFILE (15 pts) — sensitivity resilience + downside protection
  const conservPnl = r.pnl.conservateur;
  const downsidePts = conservPnl.irr > 0 ? Math.min(7, conservPnl.irr / 2) : 0; // Even conservative is profitable
  const resilPts = Math.min(5, r.sensitivity.params.length > 0 ? Math.max(0, 5 - r.sensitivity.params[0].irrSpread / 3) : 2.5);
  const diversPts = Math.min(3, (r.totalCaptifs > 0 ? 1 : 0) + (r.native.captured > 0 ? 1 : 0) + (r.walkIn.walkInMembers > 0 ? 1 : 0));
  scores.risk = { score: Math.round((downsidePts + resilPts + diversPts) * 10) / 10, max: 15, label: 'Profil Risque',
    details: `IRR conservateur ${conservPnl.irr}% | Swing max ${r.sensitivity.params[0]?.irrSpread.toFixed(1)||'?'}pp | ${diversPts}/3 sources` };

  const total = Math.round(Object.values(scores).reduce((a, s) => a + s.score, 0) * 10) / 10;
  let verdict, verdictColor, verdictDesc;
  if (total >= 75) { verdict = 'GO'; verdictColor = '#10b981'; verdictDesc = 'Site recommandé — potentiel élevé, fondamentaux solides'; }
  else if (total >= 60) { verdict = 'GO CONDITIONNEL'; verdictColor = '#fbbf24'; verdictDesc = 'Site viable sous conditions — négocier loyer, optimiser lancement'; }
  else if (total >= 45) { verdict = 'WATCH'; verdictColor = '#f97316'; verdictDesc = 'Site à surveiller — potentiel insuffisant ou risques élevés'; }
  else { verdict = 'NO-GO'; verdictColor = '#ef4444'; verdictDesc = 'Site non recommandé — risque trop élevé vs. rendement'; }

  // Key risks & opportunities
  const risks = [];
  const opportunities = [];
  if (basePnl.irr < 15) risks.push('IRR base < 15% — marge de sécurité faible');
  if (r.comps.length > 8) risks.push(`Saturation concurrentielle (${r.comps.length} clubs dans ${r.captageRadius/1000}km)`);
  if (conservPnl.irr <= 0) risks.push('Scénario conservateur déficitaire — risque de perte');
  if (r.totalTheorique < 3000) risks.push(`Potentiel théorique < 3000 (${fmt(r.totalTheorique)}) — sous le seuil BP`);
  if (r.sensitivity.params[0]?.irrSpread > 12) risks.push(`Haute sensibilité au ${r.sensitivity.params[0].label}`);

  if (basePnl.irr > 25) opportunities.push(`IRR attractif (${basePnl.irr}%) — rendement bien au-dessus du WACC`);
  if (r.ltvCacRatio > 15) opportunities.push(`LTV/CAC exceptionnel (${r.ltvCacRatio}x) — acquisition client très efficiente`);
  if (r.native.captured > 1500) opportunities.push(`Fort potentiel de création de marché (${fmt(r.native.captured)} natifs)`);
  if (r.walkIn.walkInMembers > 200) opportunities.push(`Walk-in significatif (${fmt(r.walkIn.walkInMembers)} mbr)${r.walkIn.isPremiumMall?' — mall premium (conv. '+r.walkIn.conversionRate.toFixed(1)+'%)':' — flux captif'}`);
  if (r.destinationBonus?.bonusMembers > 0) opportunities.push(`Mall destination — +${fmt(r.destinationBonus.bonusMembers)} mbr catchment élargi (10km, ${fmt(r.destinationBonus.deltaPop)} pop.)`);
  if (r.popTarget > 40000) opportunities.push(`Bassin de population large (${fmt(r.popTarget)} cible 15-45)`);

  return { total, scores, verdict, verdictColor, verdictDesc, risks, opportunities };
}

// --- RENT SLIDER: REAL-TIME P&L RECALC ---

// ═══════════════════════════════════════════════════════════════════
// v6.67 — IMPACT KPI PAR CHANGEMENT D'HYPOTHÈSE
// Chaque modification loggée (loyer, charges, surface, financement)
// embarque le delta des KPIs investisseur (EBITDA Y5, IRR projet/equity,
// NPV, FCFE 5 ans, DSCR min) calculé en re-runnant buildPnL (pur, ~1ms)
// avec la valeur avant puis après. → Journal = historique monitorable
// des hypothèses avec impact chiffré.
// ═══════════════════════════════════════════════════════════════════

// Applique temporairement une valeur d'hypothèse (pour le calcul before/after).
// Retourne une fonction de restauration.
function _applyHypothesisValue(field, value) {
  const saves = {
    rentOv: window._rentOverride, chargeOv: window._chargeOverride,
    surfOv: window._surfaceOverride, finOv: window._financingOverride,
  };
  switch (field) {
    case 'loyer':    window._rentOverride    = (value == null) ? null : { y1: Number(value) }; break;
    case 'charges':  window._chargeOverride  = (value == null) ? null : { chargeTotal: Number(value) }; break;
    case 'surface':  window._surfaceOverride = (value == null) ? null : { surface: Number(value) }; break;
    case 'fin.dette':   window._financingOverride = Object.assign({}, window._financingOverride, { enabled: !!value }); break;
    case 'fin.equity':  window._financingOverride = Object.assign({ enabled: true }, window._financingOverride, { equityRatio: Number(value) / 100 }); break;
    case 'fin.taux':    window._financingOverride = Object.assign({ enabled: true }, window._financingOverride, { loanRate: Number(value) / 100 }); break;
    case 'fin.duree':   window._financingOverride = Object.assign({ enabled: true }, window._financingOverride, { loanTermYears: Number(value) }); break;
    default: return () => {};
  }
  return () => {
    window._rentOverride = saves.rentOv; window._chargeOverride = saves.chargeOv;
    window._surfaceOverride = saves.surfOv; window._financingOverride = saves.finOv;
  };
}

// KPIs compacts du scénario BASE avec la valeur donnée pour `field`.
// null si aucune analyse ouverte (pas de cohort → pas de P&L).
function _kpisWithValue(field, value) {
  try {
    if (!window._lastCaptageData?.r?.scenarios?.base?.cohort) return null;
    const { r, avgPrice } = window._lastCaptageData;
    const restore = _applyHypothesisValue(field, value);
    let p;
    try { p = buildPnL(r.scenarios.base.cohort, avgPrice); }
    finally { restore(); }
    return {
      ebitdaY5: Math.round((p.annualEBITDA?.[4] || 0) / 1000),   // k€
      irr: p.irr, irrEquity: p.irrEquity,
      npv: Math.round((p.npv || 0) / 1000),                      // k€
      fcfe5y: Math.round((p.fcfe5y || 0) / 1000),                // k€
      dscrMin: p.dscrMinCruise,
    };
  } catch { return null; }
}

// Delta complet before/after pour le journal. null si pas calculable.
function computeKpiImpact(field, before, after) {
  const kb = _kpisWithValue(field, before);
  const ka = _kpisWithValue(field, after);
  if (!kb || !ka) return null;
  return {
    before: kb, after: ka,
    dEbitdaY5: Math.round((ka.ebitdaY5 - kb.ebitdaY5) * 10) / 10,        // k€
    dIrr: Math.round((ka.irr - kb.irr) * 10) / 10,                        // pts
    dIrrEquity: Math.round((ka.irrEquity - kb.irrEquity) * 10) / 10,      // pts
    dFcfe5y: Math.round((ka.fcfe5y - kb.fcfe5y) * 10) / 10,               // k€
  };
}
window.computeKpiImpact = computeKpiImpact;

// v6.65 — helper pour logger les sliders d'hypothèses au relâchement user.
// Garde le "before" (1re valeur vue) et le "after" (dernière valeur vue)
// entre les onInput rapides, log au debounce 800ms.
// v6.67 — enrichi du delta KPI (meta.kpi) calculé au flush.
window._sliderLogTimers = window._sliderLogTimers || {};
window._sliderLogBefore = window._sliderLogBefore || {};
function logSliderChangeDebounced(field, before, after, siteKey, siteName) {
  if (!window.AuditLog) return;
  const k = field + '|' + (siteKey || 'global');
  if (!(k in window._sliderLogBefore)) window._sliderLogBefore[k] = before;
  clearTimeout(window._sliderLogTimers[k]);
  window._sliderLogTimers[k] = setTimeout(() => {
    const b = window._sliderLogBefore[k];
    if (b !== after) {
      try {
        const kpi = computeKpiImpact(field, b, after);
        window.AuditLog.log({
          action: field.startsWith('fin.') ? 'financement.' + field.slice(4) : 'slider.' + field,
          target: siteName || '(site inconnu)',
          siteKey, field, before: b, after,
          meta: kpi ? { kpi } : undefined,
        });
      } catch {}
    }
    delete window._sliderLogBefore[k];
    delete window._sliderLogTimers[k];
  }, 800);
}
window.logSliderChangeDebounced = logSliderChangeDebounced;

function onRentSliderChange(val) {
  const y1 = parseFloat(val);
  window._rentOverride = {y1};
  // Store per-site for persistence (in-memory map + localStorage cross-session)
  if(window._lastCaptageLocation) {
    const key = window._lastCaptageLocation.lat.toFixed(3) + ',' + window._lastCaptageLocation.lng.toFixed(3);
    const before = window._rentOverrides[key] ?? PNL_DEFAULTS.rentSteps.objectifNego[0].rent;
    const siteName = window._lastCaptageLocation.siteName || key;
    logSliderChangeDebounced('loyer', before, y1, key, siteName);
    window._rentOverrides[key] = y1;
    window.persistOverrides?.();
  }
  // Update slider label
  const lbl = document.getElementById('rent-slider-label');
  if(lbl) lbl.textContent = y1.toFixed(1) + '€/m²';
  // Update rent tier labels
  const steps = getRentSteps('objectifNego');
  const e = id => document.getElementById(id);
  if(e('rent-y1-sqm')) e('rent-y1-sqm').textContent = steps[0].rent + '€/m²';
  if(e('rent-y3-sqm')) e('rent-y3-sqm').textContent = steps[1].rent + '€/m²';
  if(e('rent-y5-sqm')) e('rent-y5-sqm').textContent = steps[2].rent + '€/m²';
  if(e('rent-y1-monthly')) e('rent-y1-monthly').textContent = fmt(getSteppedRentMonthly(1,'objectifNego')) + '/mois';
  if(e('rent-y3-monthly')) e('rent-y3-monthly').textContent = fmt(getSteppedRentMonthly(3,'objectifNego')) + '/mois';
  if(e('rent-y5-monthly')) e('rent-y5-monthly').textContent = fmt(getSteppedRentMonthly(5,'objectifNego')) + '/mois';
  // Debounce P&L recalc (heavier computation)
  clearTimeout(window._rentRecalcTimer);
  window._rentRecalcTimer = setTimeout(recalcPnLWithRent, 150);
}

// v6.33: parité mobile ↔ desktop — sliders charges + surface (même logique que mobile.js)
function onChargeSliderChange(val) {
  const v = parseFloat(val);
  window._chargeOverride = {chargeTotal: v};
  if(window._lastCaptageLocation) {
    const key = window._lastCaptageLocation.lat.toFixed(3) + ',' + window._lastCaptageLocation.lng.toFixed(3);
    window._chargeOverrides = window._chargeOverrides || {};
    const before = window._chargeOverrides[key] ?? (PNL_DEFAULTS.rentSteps.serviceCharge + PNL_DEFAULTS.rentSteps.marketingFee);
    const siteName = window._lastCaptageLocation.siteName || key;
    logSliderChangeDebounced('charges', before, v, key, siteName);
    window._chargeOverrides[key] = v;
    window.persistOverrides?.();
  }
  const lbl = document.getElementById('charge-slider-label');
  if(lbl) lbl.textContent = v.toFixed(1) + '€/m²';
  // Update monthly labels to reflect new charges (all tiers share same charges)
  const e = id => document.getElementById(id);
  if(e('rent-y1-monthly')) e('rent-y1-monthly').textContent = fmt(getSteppedRentMonthly(1,'objectifNego')) + '/mois';
  if(e('rent-y3-monthly')) e('rent-y3-monthly').textContent = fmt(getSteppedRentMonthly(3,'objectifNego')) + '/mois';
  if(e('rent-y5-monthly')) e('rent-y5-monthly').textContent = fmt(getSteppedRentMonthly(5,'objectifNego')) + '/mois';
  clearTimeout(window._chargeRecalcTimer);
  window._chargeRecalcTimer = setTimeout(recalcPnLWithRent, 150);
}

function onSurfaceSliderChange(val) {
  const v = parseInt(val, 10);
  window._surfaceOverride = {surface: v};
  if(window._lastCaptageLocation) {
    const key = window._lastCaptageLocation.lat.toFixed(3) + ',' + window._lastCaptageLocation.lng.toFixed(3);
    window._surfaceOverrides = window._surfaceOverrides || {};
    const before = window._surfaceOverrides[key] ?? PNL_DEFAULTS.rentSteps.surface;
    const siteName = window._lastCaptageLocation.siteName || key;
    logSliderChangeDebounced('surface', before, v, key, siteName);
    window._surfaceOverrides[key] = v;
    window.persistOverrides?.();
  }
  const lbl = document.getElementById('surface-slider-label');
  if(lbl) lbl.textContent = v + ' m²';
  // Update monthly labels (loyer mensuel = rent * surface → surface change le montant)
  const e = id => document.getElementById(id);
  if(e('rent-y1-monthly')) e('rent-y1-monthly').textContent = fmt(getSteppedRentMonthly(1,'objectifNego')) + '/mois';
  if(e('rent-y3-monthly')) e('rent-y3-monthly').textContent = fmt(getSteppedRentMonthly(3,'objectifNego')) + '/mois';
  if(e('rent-y5-monthly')) e('rent-y5-monthly').textContent = fmt(getSteppedRentMonthly(5,'objectifNego')) + '/mois';
  clearTimeout(window._surfaceRecalcTimer);
  window._surfaceRecalcTimer = setTimeout(recalcPnLWithRent, 150);
}

// ═══ v6.67 — FINANCEMENT: toggle dette + sliders (GLOBAL, tous sites) ═══
function _finGet() {
  // État courant effectif pour l'UI (défauts BP si pas d'override)
  const f = getEffectiveFinancing();
  return { enabled: f.enabled !== false && f.loanRatio > 0, equityPct: Math.round(f.equityRatio * 100),
           ratePct: Math.round(f.loanRate * 1000) / 10, term: f.loanTermYears };
}
function _finSet(patch) {
  const cur = window._financingOverride || {};
  const def = PNL_DEFAULTS.financing;
  window._financingOverride = Object.assign({
    enabled: cur.enabled !== false,
    equityRatio: cur.equityRatio ?? def.equityRatio,
    loanRate: cur.loanRate ?? def.loanRate,
    loanTermYears: cur.loanTermYears ?? def.loanTermYears,
  }, cur, patch, { at: Date.now() });
  window.persistOverrides?.();
  clearTimeout(window._finRecalcTimer);
  window._finRecalcTimer = setTimeout(recalcPnLWithRent, 150);
}
function _finSiteCtx() {
  const loc = window._lastCaptageLocation;
  return { siteKey: 'global', siteName: (loc?.siteName ? loc.siteName + ' (réglage global)' : 'Financement global') };
}
function onFinancingToggle(checked) {
  const before = _finGet().enabled;
  const { siteKey, siteName } = _finSiteCtx();
  logSliderChangeDebounced('fin.dette', before, !!checked, siteKey, siteName);
  _finSet({ enabled: !!checked });
  // Griser/dégriser les sliders
  ['finEquitySlider','finRateSlider','finTermSlider'].forEach(id => {
    const s = document.getElementById(id); if (s) s.disabled = !checked;
  });
  const wrap = document.getElementById('fin-sliders-wrap');
  if (wrap) wrap.style.opacity = checked ? '1' : '.35';
  // v6.91 — garder la case « 100% EQUITY » et son libellé cohérents même
  // en appel programmatique (le re-render ne recrée pas la case, il patche
  // seulement les KPI). checked = dette on ⇒ case equity décochée.
  const eqCb = document.getElementById('finEquityToggle');
  if (eqCb) eqCb.checked = !checked;
  const eqLbl = eqCb && eqCb.nextElementSibling;
  if (eqLbl) eqLbl.style.color = checked ? 'var(--gray2)' : '#34d399';
  const ratioLbl = document.getElementById('fin-equity-label');
  if (ratioLbl && !checked) ratioLbl.textContent = '100% / 0%';
}
// v6.91 — sélecteur « 100% EQUITY » explicite : COCHÉ = fonds propres seuls,
// aucun emprunt → les réglages de prêt se désactivent. C'est l'inverse du
// toggle dette historique (checked = dette on) ; on réutilise sa logique.
// Avant : la case cochait « dette on » alors que son libellé disait « 100%
// EQUITY » → cocher pour être en equity activait en fait le prêt (bug signalé).
function onEquityOnlyToggle(equityOnly) {
  onFinancingToggle(!equityOnly);
}
window.onEquityOnlyToggle = onEquityOnlyToggle;
function onFinEquitySlider(val) {
  const v = parseInt(val, 10);
  const before = _finGet().equityPct;
  const { siteKey, siteName } = _finSiteCtx();
  logSliderChangeDebounced('fin.equity', before, v, siteKey, siteName);
  _finSet({ equityRatio: v / 100 });
  const lbl = document.getElementById('fin-equity-label');
  if (lbl) lbl.textContent = v + '% / ' + (100 - v) + '%';
}
function onFinRateSlider(val) {
  const v = parseFloat(val);
  const before = _finGet().ratePct;
  const { siteKey, siteName } = _finSiteCtx();
  logSliderChangeDebounced('fin.taux', before, v, siteKey, siteName);
  _finSet({ loanRate: v / 100 });
  const lbl = document.getElementById('fin-rate-label');
  if (lbl) lbl.textContent = v.toFixed(2) + '%';
}
function onFinTermSlider(val) {
  const v = parseInt(val, 10);
  const before = _finGet().term;
  const { siteKey, siteName } = _finSiteCtx();
  logSliderChangeDebounced('fin.duree', before, v, siteKey, siteName);
  _finSet({ loanTermYears: v });
  const lbl = document.getElementById('fin-term-label');
  if (lbl) lbl.textContent = v + ' ans';
}

// P&L de RÉFÉRENCE (BP verrouillé, zéro override) pour la ligne "vs Référence".
// Pur et sans effet de bord : sauvegarde/restaure les 4 overrides.
function computeReferencePnL() {
  try {
    if (!window._lastCaptageData?.r?.scenarios?.base?.cohort) return null;
    const { r, avgPrice } = window._lastCaptageData;
    const saves = [window._rentOverride, window._chargeOverride, window._surfaceOverride, window._financingOverride];
    window._rentOverride = null; window._chargeOverride = null;
    window._surfaceOverride = null; window._financingOverride = null;
    let p;
    try { p = buildPnL(r.scenarios.base.cohort, avgPrice); }
    finally {
      [window._rentOverride, window._chargeOverride, window._surfaceOverride, window._financingOverride] = saves;
    }
    return p;
  } catch { return null; }
}
window.computeReferencePnL = computeReferencePnL;

function recalcPnLWithRent() {
  if(!window._lastCaptageData) return;
  const {r, avgPrice} = window._lastCaptageData;
  // Recalc PnL for all 3 scenarios with new rent
  const pnl = {};
  for(const key of ['conservateur','base','optimiste']) {
    pnl[key] = buildPnL(r.scenarios[key].cohort, avgPrice);
  }
  r.pnl = pnl;
  // Recompute scoring
  const exec = computeExecSummary(r);
  window._lastExecData = {r, exec};
  // Update DOM
  updatePnLDisplay(pnl, exec);
  // ═══ Persist KPIs (v6.21) ═══
  // Les sliders loyer/charges/surface mutent r.pnl. Sans MAJ de _siteAnalyses,
  // le Dashboard compare + export PDF affichaient l'IRR initial (figé). On
  // re-save ici pour garantir que TRI / NPV / payback / verdict sont toujours
  // synchrones avec la dernière valeur slider.
  const loc = window._lastCaptageLocation;
  if (loc && loc.siteName && typeof saveSiteAnalysis === 'function') {
    try { saveSiteAnalysis(loc.siteName, loc.lat, loc.lng, r, exec); }
    catch(e) { console.warn('[FP] saveSiteAnalysis after slider failed:', e); }
  }
}

function updatePnLDisplay(pnl, exec) {
  const e = id => document.getElementById(id);
  // Update P&L grid for each scenario
  for(const key of ['conservateur','base','optimiste']) {
    const p = pnl[key];
    for(let i=0;i<5;i++) {
      const caEl = e('pnl-ca'+(i+1)+'-'+key);
      if(caEl) caEl.textContent = fmt(Math.round(p.annualCA[i]/1000)) + 'k';
    }
    // Annual EBITDA (live update, margin % inline, colored by margin vs CA of same year)
    for(let i=0;i<5;i++) {
      const ebEl = e('pnl-ebitda'+(i+1)+'-'+key);
      if(ebEl) {
        const eb = p.annualEBITDA?.[i] || 0;
        const ca = p.annualCA?.[i] || 0;
        const m = ca > 0 ? Math.round(eb / ca * 100) : 0;
        ebEl.innerHTML = fmt(Math.round(eb/1000)) + 'k <span style="color:var(--gray2);font-weight:500">('+m+'%)</span>';
        ebEl.style.color = eb < 0 ? 'var(--red)' : m >= 35 ? 'var(--green)' : m >= 20 ? 'var(--yellow)' : 'var(--gray)';
      }
    }
    const beEl = e('pnl-be-'+key);
    if(beEl) { beEl.textContent = p.breakevenMonth ? 'M'+p.breakevenMonth : 'N/A'; beEl.style.color = p.breakevenMonth ? 'var(--green)' : 'var(--red)'; }
    const pbEl = e('pnl-pb-'+key);
    if(pbEl) { pbEl.textContent = p.paybackMonth ? 'M'+p.paybackMonth : '>60M'; pbEl.style.color = p.paybackMonth ? 'var(--green)' : 'var(--red)'; }
    const irrEl = e('pnl-irr-'+key);
    if(irrEl) { irrEl.innerHTML = '<b>'+p.irr+'%</b>'; irrEl.style.color = p.irr>15?'var(--green)':p.irr>8?'var(--yellow)':'var(--red)'; }
    const npvEl = e('pnl-npv-'+key);
    if(npvEl) { npvEl.textContent = fmt(Math.round(p.npv/1000))+'k'; npvEl.style.color = p.npv>0?'var(--green)':'var(--red)'; }
  }
  // Update loyer/mois box
  if(e('pnl-loyer-box')) e('pnl-loyer-box').textContent = fmt(pnl.base.rent);
  // Update exec summary
  if(e('exec-score')) { e('exec-score').textContent = exec.total; e('exec-score').style.color = exec.verdictColor; }
  if(e('exec-verdict')) { e('exec-verdict').textContent = exec.verdict; e('exec-verdict').style.color = exec.verdictColor; }
  if(e('exec-verdict-desc')) e('exec-verdict-desc').textContent = exec.verdictDesc;
  // Update score bars
  if(e('exec-scores-bars')) {
    e('exec-scores-bars').innerHTML = Object.values(exec.scores).map(s => {
      const pct = Math.round(s.score / s.max * 100);
      const col = pct >= 70 ? '#10b981' : pct >= 50 ? '#fbbf24' : '#ef4444';
      return `<div style="flex:1;text-align:center">
        <div style="font-size:7px;color:var(--gray2);margin-bottom:2px">${s.label}</div>
        <div style="height:4px;background:var(--bg);border-radius:2px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${col};border-radius:2px"></div></div>
        <div style="font-size:9px;font-weight:800;color:${col};margin-top:1px">${s.score}/${s.max}</div>
      </div>`;
    }).join('');
  }
  // Update offre initiale delta
  if(e('rent-offre-delta') && pnl.base.irrOffreInitiale !== null) {
    e('rent-offre-delta').innerHTML = `⚠ Si offre initiale bailleur (${PNL_DEFAULTS.rentSteps.offerInitiale[0].rent}→${PNL_DEFAULTS.rentSteps.offerInitiale[1].rent}→${PNL_DEFAULTS.rentSteps.offerInitiale[2].rent}€/m²) : IRR = ${pnl.base.irrOffreInitiale.toFixed(1)}% vs ${pnl.base.irr.toFixed(1)}% objectif négo → delta ${(pnl.base.irr - pnl.base.irrOffreInitiale).toFixed(1)} pts`;
  }
  // Update P&L chart if exists
  if(window._pnlChart) {
    try {
      const months = Array.from({length:60},(_,i)=>i+1);
      const scenarioKeys = ['conservateur','base','optimiste'];
      scenarioKeys.forEach((key,idx) => {
        if(window._pnlChart.data.datasets[idx]) {
          window._pnlChart.data.datasets[idx].data = pnl[key].monthly.map(m => Math.round(m.ebitda));
        }
      });
      window._pnlChart.update('none');
    } catch(err) { console.warn('Chart update failed:', err); }
  }

  // ═══ v6.67 — bloc FINANCEMENT (scénario base) + ligne "vs Référence BP" ═══
  updateFinancingDisplay(pnl.base);
}

function updateFinancingDisplay(p) {
  if (!p) return;
  const e = id => document.getElementById(id);
  const kEUR = v => fmt(Math.round((v || 0) / 1000)) + 'k';
  // Structure
  if (e('fin-kpi-equity'))   e('fin-kpi-equity').textContent   = kEUR(p.equity);
  if (e('fin-kpi-loan'))     e('fin-kpi-loan').textContent     = p.loanPrincipal > 0 ? kEUR(p.loanPrincipal) : '—';
  if (e('fin-kpi-pmt'))      e('fin-kpi-pmt').textContent      = p.loanMonthlyPayment > 0 ? fmt(p.loanMonthlyPayment) + '/mois' : '—';
  if (e('fin-kpi-interest')) e('fin-kpi-interest').textContent = p.totalInterest > 0 ? kEUR(p.totalInterest) : '—';
  // Indicateurs investisseur
  if (e('fin-kpi-irrproj')) { e('fin-kpi-irrproj').textContent = p.irr + '%'; e('fin-kpi-irrproj').style.color = p.irr > 15 ? 'var(--green)' : p.irr > 8 ? 'var(--yellow)' : 'var(--red)'; }
  if (e('fin-kpi-irreq'))   { e('fin-kpi-irreq').textContent   = p.irrEquity + '%'; e('fin-kpi-irreq').style.color = p.irrEquity > 15 ? 'var(--green)' : p.irrEquity > 8 ? 'var(--yellow)' : 'var(--red)'; }
  if (e('fin-kpi-fcfe'))    { e('fin-kpi-fcfe').textContent    = kEUR(p.fcfe5y); e('fin-kpi-fcfe').style.color = p.fcfe5y > 0 ? 'var(--green)' : 'var(--red)'; }
  if (e('fin-kpi-dscr'))    {
    const d = p.dscrMinCruise;
    e('fin-kpi-dscr').textContent = d != null ? d.toFixed(2) + '×' : 'n/a';
    // Seuil bancaire standard: DSCR ≥ 1.2 confortable, < 1.0 en tension
    e('fin-kpi-dscr').style.color = d == null ? 'var(--gray2)' : d >= 1.2 ? 'var(--green)' : d >= 1.0 ? 'var(--yellow)' : 'var(--red)';
    e('fin-kpi-dscr').title = p.dscrByYear ? 'DSCR par année: ' + p.dscrByYear.map((v,i)=>'A'+(i+1)+' '+(v!=null?v.toFixed(2)+'×':'—')).join(' · ') + ' (A1 = ramp-up)' : '';
  }
  if (e('fin-kpi-moic'))    { e('fin-kpi-moic').textContent    = p.moic != null ? p.moic.toFixed(1) + '×' : 'n/a'; e('fin-kpi-moic').style.color = (p.moic || 0) >= 2 ? 'var(--green)' : 'var(--yellow)'; }
  if (e('fin-kpi-pbeq'))    { e('fin-kpi-pbeq').textContent    = p.paybackEquityMonth ? 'M' + p.paybackEquityMonth : '>60M'; e('fin-kpi-pbeq').style.color = p.paybackEquityMonth ? 'var(--green)' : 'var(--red)'; }
  // v6.76 — bloc point mort en adhérents (dépend des mêmes réglages)
  try { renderBreakEvenBlock(); } catch {}
  // Ligne "vs Référence BP" — écart des réglages courants vs BP verrouillé
  const refEl = e('pnl-ref-delta');
  if (refEl) {
    const ref = computeReferencePnL();
    if (!ref) { refEl.style.display = 'none'; }
    else {
      const dEb = Math.round(((p.annualEBITDA?.[4] || 0) - (ref.annualEBITDA?.[4] || 0)) / 1000);
      const dIrr = Math.round((p.irr - ref.irr) * 10) / 10;
      const dIrrEq = Math.round((p.irrEquity - ref.irrEquity) * 10) / 10;
      const isRef = dEb === 0 && dIrr === 0 && dIrrEq === 0;
      refEl.style.display = '';
      const sgn = v => (v > 0 ? '+' : '') + v;
      const col = v => v > 0 ? 'var(--green)' : v < 0 ? 'var(--red)' : 'var(--gray2)';
      refEl.innerHTML = isRef
        ? `<span style="color:var(--green)">✓ Réglages = Référence BP</span> <span style="color:var(--gray2)">(OnAir calibré v6.x — EBITDA A5 ${fmt(Math.round((ref.annualEBITDA?.[4]||0)/1000))}k, IRR ${ref.irr}%, IRR Eq ${ref.irrEquity}%)</span>`
        : `<span style="color:var(--accent);font-weight:700">Écart vs Référence BP :</span> `
          + `EBITDA A5 <span style="color:${col(dEb)};font-weight:700">${sgn(dEb)}k€</span> · `
          + `IRR Projet <span style="color:${col(dIrr)};font-weight:700">${sgn(dIrr)} pts</span> · `
          + `IRR Equity <span style="color:${col(dIrrEq)};font-weight:700">${sgn(dIrrEq)} pts</span> `
          + `<span style="color:var(--gray2)">(réf: EBITDA ${fmt(Math.round((ref.annualEBITDA?.[4]||0)/1000))}k · IRR ${ref.irr}% · Eq ${ref.irrEquity}%)</span>`;
    }
  }
}
window.updateFinancingDisplay = updateFinancingDisplay;

// ═══ v6.76 — rendu du bloc POINT MORT (fiche site) ═════════════════
function renderBreakEvenBlock() {
  const box = document.getElementById('pnl-breakeven-block');
  if (!box) return;
  const r = window._lastCaptageData?.r;
  if (!r) { box.innerHTML = ''; return; }
  const fin = getEffectiveFinancing();
  const debtOn = fin.enabled !== false && fin.loanRatio > 0;

  // FCFE par année (A1..A5) + EBITDA croisière + variante 100% fonds propres
  const beFcfe = [0, 1, 2, 3, 4].map(y => computeBreakEvenMembers('fcfe', y));
  const beEbitda5 = computeBreakEvenMembers('ebitda', 4);
  const beEquity5 = computeBreakEvenMembers('fcfe', 4, 'equity');
  const beCruise = beFcfe[4];
  const debtCostMembers = (debtOn && beCruise != null && beEquity5 != null) ? beCruise - beEquity5 : null;
  const realiste = r.realiste || 0;
  const cushion = beCruise ? Math.round((realiste / beCruise - 1) * 100) : null;
  const cushionCol = cushion == null ? 'var(--gray2)' : cushion >= 50 ? 'var(--green)' : cushion >= 20 ? 'var(--yellow)' : 'var(--red)';

  // Jauge : point mort vs membres réalistes (échelle max = max des deux × 1.15)
  const gaugeMax = Math.max(realiste, beCruise || 0) * 1.15 || 1;
  const pctBE = Math.min(100, Math.round((beCruise || 0) / gaugeMax * 100));
  const pctReal = Math.min(100, Math.round(realiste / gaugeMax * 100));

  box.innerHTML = `
    <div style="background:#10b98108;border:1px solid #10b98130;border-radius:6px;padding:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <div style="font-size:8px;font-weight:700;color:var(--green)">🎯 POINT MORT — adhérents requis pour être neutre en FCFE (bas de page${debtOn ? ', dette incluse' : ', 100% equity'})</div>
        <div style="font-size:9px;font-weight:800;color:${cushionCol}">${cushion != null ? 'coussin ' + (cushion >= 0 ? '+' : '') + cushion + '%' : ''}</div>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:8px">
        <div style="flex:1;background:var(--bg);border-radius:5px;padding:6px 8px;text-align:center">
          <div style="font-size:15px;font-weight:900;color:var(--white)">${beCruise != null ? fmt(beCruise) : '—'}</div>
          <div style="font-size:6.5px;color:var(--gray2)">POINT MORT FCFE · CROISIÈRE (A5)</div>
        </div>
        <div style="flex:1;background:var(--bg);border-radius:5px;padding:6px 8px;text-align:center">
          <div style="font-size:15px;font-weight:900;color:var(--gray)">${beFcfe[0] != null ? fmt(beFcfe[0]) : '—'}</div>
          <div style="font-size:6.5px;color:var(--gray2)">POINT MORT FCFE · ANNÉE 1${debtOn ? ' (dette + leasing)' : ' (leasing)'}</div>
        </div>
        <div style="flex:1;background:var(--bg);border-radius:5px;padding:6px 8px;text-align:center" title="Point mort FCFE en croisière si le club était financé 100% en fonds propres (aucun service de dette) — indépendant du toggle dette.${debtCostMembers != null ? ' La dette coûte ' + fmt(debtCostMembers) + ' adhérents d’équilibre.' : ''}">
          <div style="font-size:15px;font-weight:900;color:var(--accent)">${beEquity5 != null ? fmt(beEquity5) : '—'}</div>
          <div style="font-size:6.5px;color:var(--gray2)">💰 SI 100% FONDS PROPRES${debtCostMembers != null ? ' <span style="color:var(--orange)">(dette: +' + fmt(debtCostMembers) + ')</span>' : ''}</div>
        </div>
        <div style="flex:1;background:var(--bg);border-radius:5px;padding:6px 8px;text-align:center">
          <div style="font-size:15px;font-weight:900;color:var(--gray)">${beEbitda5 != null ? fmt(beEbitda5) : '—'}</div>
          <div style="font-size:6.5px;color:var(--gray2)">POINT MORT EBITDA · opérationnel</div>
        </div>
        <div style="flex:1;background:var(--bg);border-radius:5px;padding:6px 8px;text-align:center;border:1px solid ${cushionCol}40">
          <div style="font-size:15px;font-weight:900;color:${cushionCol}">${fmt(realiste)}</div>
          <div style="font-size:6.5px;color:var(--gray2)">MEMBRES RÉALISTES DU SITE</div>
        </div>
      </div>
      <div style="position:relative;height:14px;background:var(--bg);border-radius:7px;overflow:visible;margin:2px 0 12px">
        <div style="position:absolute;left:0;width:${pctReal}%;height:100%;background:linear-gradient(90deg,${cushionCol}55,${cushionCol}99);border-radius:7px"></div>
        ${beCruise != null ? `<div style="position:absolute;left:${pctBE}%;top:-3px;bottom:-3px;width:2px;background:var(--red)" title="Point mort FCFE croisière: ${fmt(beCruise)} adhérents"></div>
        <div style="position:absolute;left:${pctBE}%;top:14px;transform:translateX(-50%);font-size:7px;color:var(--red);font-weight:700;white-space:nowrap">↑ ${fmt(beCruise)}</div>` : ''}
      </div>
      <div style="display:flex;gap:4px;margin-bottom:4px">
        ${beFcfe.map((v, y) => `
          <div style="flex:1;text-align:center;background:var(--bg);border-radius:4px;padding:3px 2px" title="Point mort FCFE en année ${y + 1} — paliers loyer, OPEX ${Math.round((PNL_DEFAULTS.opexOpsRateByYear[y] || .12) * 100)}%, staff +6%/an${y < PNL_DEFAULTS.leasingYears ? ', leasing' : ''}${debtOn && y < fin.loanTermYears ? ', dette' : ''}">
            <div style="font-size:6.5px;color:var(--gray2)">A${y + 1}</div>
            <div style="font-size:9px;font-weight:800;color:${v != null && realiste >= v ? 'var(--green)' : 'var(--red)'}">${v != null ? fmt(v) : '—'}</div>
          </div>`).join('')}
      </div>
      <div style="font-size:7px;color:var(--gray2);line-height:1.4">
        Calcul par inversion du moteur : cohorte stable de M membres → P&L complet avec TES réglages (loyer/charges/surface du site, ${debtOn ? Math.round(fin.equityRatio * 100) + '% equity / ' + Math.round(fin.loanRatio * 100) + '% dette @ ' + (fin.loanRate * 100).toFixed(1) + '%' : '100% fonds propres'}) → M tel que le FCFE annuel = 0.
        Le point mort baisse avec les années (OPEX dégressifs) puis remonte si palier de loyer — vert = les membres réalistes couvrent l'année.
      </div>
    </div>`;
}
window.renderBreakEvenBlock = renderBreakEvenBlock;

// --- MULTI-SITE RANKING ---
// Store all analyzed sites for comparison
// Cache-buster: AGGRESSIVE clear on model version change
// Clears: site analyses, custom site cached data, syncs custom site coords with TARGETS
// MODEL_VERSION moved to config.js
if(localStorage.getItem('fpModelVersion') !== MODEL_VERSION) {
  // 1. Clear ranked analyses cache
  localStorage.removeItem('fpSiteAnalyses');
  // 2. Clear stale analysisData from custom sites + sync coords with TARGETS
  try {
    const cs = JSON.parse(localStorage.getItem('fpCustomSites') || '[]');
    cs.forEach(site => {
      site.analysisData = null; // force re-analysis
      // Sync coordinates with TARGETS if name matches (fix stale coords)
      const target = TARGETS.find(t => t.name.toLowerCase() === (site.name||'').toLowerCase());
      if(target) { site.lat = target.lat; site.lng = target.lng; }
    });
    localStorage.setItem('fpCustomSites', JSON.stringify(cs));
  } catch(e) { console.warn('Custom sites cleanup:', e); }
  // 3. Clear sessionStorage caches
  sessionStorage.removeItem('opCache');
  // 4. Clear users + their signature so CANONICAL_USERS changes (new fields like
  //    recoveryHash) are re-seeded cleanly without triggering auth-guard's
  //    "tampered" alert.
  try { localStorage.removeItem('fpUsers'); localStorage.removeItem('fpUsersSig'); } catch {}
  localStorage.setItem('fpModelVersion', MODEL_VERSION);
  console.log('Model updated to ' + MODEL_VERSION + ' — ALL caches cleared');
  window._pendingAutoAnalyze = true;
  // Reload customSites variable with cleaned data
  _loadCustomSites();
}
// Load custom sites (if not already loaded by cache-buster)
if(customSites.length === 0) _loadCustomSites();
// Protège contre localStorage JSON corrompu — sinon toute la suite du script
// ne se charge pas (module-scope throw = app brickée).
try { window._siteAnalyses = JSON.parse(localStorage.getItem('fpSiteAnalyses') || '[]'); }
catch(e) { console.warn('[fp] fpSiteAnalyses corrompu, reset', e); window._siteAnalyses = []; try { localStorage.removeItem('fpSiteAnalyses'); } catch {} }

function saveSiteAnalysis(name, lat, lng, r, exec) {
  const existing = window._siteAnalyses.findIndex(s => Math.abs(s.lat - lat) < 0.001 && Math.abs(s.lng - lng) < 0.001);
  const entry = {
    name, lat, lng, timestamp: Date.now(),
    totalTheo: r.totalTheorique, irrBase: r.pnl.base.irr, irrConserv: r.pnl.conservateur.irr,
    payback: r.pnl.base.paybackMonth, breakeven: r.pnl.base.breakevenMonth,
    execScore: exec.total, verdict: exec.verdict, verdictColor: exec.verdictColor,
    popTarget: r.popTarget, compsCount: r.comps.length, ltvCac: r.ltvCacRatio,
    arpu: r.arpu, npvBase: r.pnl.base.npv, caA1: r.pnl.base.annualCA[0],
    caA3: r.pnl.base.annualCA[2], captifs: r.totalCaptifs, natifs: r.native.captured,
    walkIn: r.walkIn.walkInMembers,
    // v6.86 — KPIs investisseur pour le Dashboard Portefeuille
    irrEquity: r.pnl.base.irrEquity, fcfe5y: r.pnl.base.fcfe5y, moic: r.pnl.base.moic,
    ebitdaA5: r.pnl.base.annualEBITDA?.[4], equity: r.pnl.base.equity, capex: r.pnl.base.capex,
    paybackEquity: r.pnl.base.paybackEquityMonth, dscrMin: r.pnl.base.dscrMinCruise,
    sazTotal: r.saz?.total, sector: (typeof TARGETS!=='undefined' ? (TARGETS.find(t=>Math.abs(t.lat-lat)<0.01&&Math.abs(t.lng-lng)<0.01)?.sector) : null)
  };
  if (existing >= 0) window._siteAnalyses[existing] = entry;
  else window._siteAnalyses.push(entry);
  window._siteAnalyses.sort((a, b) => b.execScore - a.execScore);
  localStorage.setItem('fpSiteAnalyses', JSON.stringify(window._siteAnalyses));
}
// Exposé global pour mobile.js (autre module) — v6.21 fix persistance post-slider
window.saveSiteAnalysis = saveSiteAnalysis;

// ─── v6.65.3 — Bascule layout "mode analyse" (sidebar élargie, map réduite) ──
window.setAnalyzingLayout = function(on) {
  if (window.innerWidth <= 768) return;  // mobile intact (grid 1fr forcé par @media)
  const app = document.querySelector('.app');
  if (!app) return;
  const was = app.classList.contains('is-analyzing');
  if (on) app.classList.add('is-analyzing');
  else app.classList.remove('is-analyzing');
  // Leaflet recalcule la taille du container après la transition CSS (450ms).
  if (was !== on) {
    setTimeout(() => {
      try { if (typeof map !== 'undefined' && map && map.invalidateSize) map.invalidateSize(true); } catch {}
    }, 500);
  }
  const btn = document.getElementById('fpRestoreMapBtn');
  if (btn) btn.style.display = on ? 'inline-flex' : 'none';
};
window.addEventListener('resize', () => {
  if (window.innerWidth <= 768) {
    const a = document.querySelector('.app');
    if (a && a.classList.contains('is-analyzing')) a.classList.remove('is-analyzing');
  }
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !document.getElementById('bpSiteFullscreenModal') && !document.getElementById('fpActivityModal')) {
    const a = document.querySelector('.app');
    if (a && a.classList.contains('is-analyzing')) setAnalyzingLayout(false);
  }
});

// ─── v6.65 — Modal Journal d'activité multi-user ────────────────────
function openActivityLog() {
  let modal = document.getElementById('fpActivityModal');
  if (modal) modal.remove();
  modal = document.createElement('div');
  modal.id = 'fpActivityModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.82);backdrop-filter:blur(8px);z-index:10000;display:flex;align-items:stretch;justify-content:center;padding:24px;font-family:var(--font)';
  modal.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;width:100%;max-width:820px;max-height:100%;display:flex;flex-direction:column;overflow:hidden">
      <header style="padding:14px 18px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-size:14px;font-weight:800;color:var(--white)">📋 Journal d'activité</div>
          <div style="font-size:9px;color:var(--gray2);margin-top:2px">Toutes les actions des utilisateurs (100 dernières)</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <button onclick="openActivityLog()" title="Rafraîchir" style="background:transparent;border:1px solid var(--border);border-radius:6px;color:var(--gray);padding:5px 10px;cursor:pointer;font-size:10px">↻</button>
          <button onclick="document.getElementById('fpActivityModal')?.remove()" style="background:transparent;border:1px solid var(--border);border-radius:6px;color:var(--gray);width:32px;height:32px;cursor:pointer;font-size:14px;font-weight:700">✕</button>
        </div>
      </header>
      <div id="fpActivityBody" style="padding:12px 18px;overflow-y:auto;flex:1">
        <div style="text-align:center;color:var(--gray2);font-size:10px;padding:20px">Chargement…</div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  document.addEventListener('keydown', function h(e) { if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', h); }});
  renderActivityLog();
}
window.openActivityLog = openActivityLog;

async function renderActivityLog() {
  const body = document.getElementById('fpActivityBody');
  if (!body) return;
  if (!window.AuditLog?.fetch) {
    body.innerHTML = '<div style="color:var(--red);font-size:10px;padding:20px;text-align:center">Module AuditLog non chargé.</div>';
    return;
  }
  const resp = await window.AuditLog.fetch();
  if (resp.error) {
    body.innerHTML = `<div style="color:var(--yellow);font-size:10px;padding:20px;text-align:center">⚠ Backend audit non disponible (${resp.error}).<br>Les logs seront synchronisés au prochain accès prod.</div>`;
    return;
  }
  const entries = (resp.entries || []).slice().reverse();  // plus récent en premier
  if (!entries.length) {
    body.innerHTML = '<div style="color:var(--gray2);font-size:10px;padding:20px;text-align:center">Aucune activité encore enregistrée.</div>';
    return;
  }
  const shortUser = (email) => {
    if (!email) return '?';
    const local = String(email).split('@')[0];
    return local.charAt(0).toUpperCase() + local.slice(1, 10);
  };
  const timeAgo = (ts) => {
    if (!ts) return '';
    const d = Date.now() - ts;
    const s = Math.round(d / 1000);
    if (s < 60) return 'à l\u2019instant';
    const m = Math.round(s / 60);
    if (m < 60) return 'il y a ' + m + ' min';
    const h = Math.round(m / 60);
    if (h < 24) return 'il y a ' + h + ' h';
    const day = Math.round(h / 24);
    if (day < 7) return 'il y a ' + day + ' j';
    const dt = new Date(ts);
    return dt.getDate() + '/' + (dt.getMonth() + 1) + '/' + String(dt.getFullYear()).slice(2);
  };
  const actionIcon = (a) => {
    if (a?.startsWith('slider')) return '🎛️';
    if (a?.startsWith('financement')) return '💰';
    if (a === 'site.add') return '➕';
    if (a === 'site.remove') return '🗑️';
    if (a === 'site.qualify') return '🏷️';
    if (a === 'site.analyze') return '🔍';
    if (a?.startsWith('bp')) return '🏦';
    return '•';
  };
  const fmtVal = (v) => {
    if (v == null) return '—';
    if (typeof v === 'boolean') return v ? 'ON' : 'OFF';
    if (typeof v === 'number') {
      if (Math.abs(v) >= 1000) return v.toLocaleString('fr-FR');
      return String(v);
    }
    return String(v);
  };
  // v6.67 — badge d'impact KPI (delta EBITDA A5 / IRR / IRR Equity / FCFE)
  const impactBadge = (e) => {
    const k = e.meta?.kpi;
    if (!k) return '<span style="color:var(--gray2)">—</span>';
    const part = (label, v, unit) => {
      if (v == null || v === 0) return '';
      const col = v > 0 ? 'var(--green)' : 'var(--red)';
      return `<span style="white-space:nowrap;color:${col};font-weight:700">${label} ${v > 0 ? '+' : ''}${v}${unit}</span>`;
    };
    const parts = [
      part('EBITDA A5', k.dEbitdaY5, 'k€'),
      part('IRR', k.dIrr, 'pts'),
      part('IRR Eq', k.dIrrEquity, 'pts'),
      part('FCFE', k.dFcfe5y, 'k€'),
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : '<span style="color:var(--gray2)">neutre</span>';
  };
  body.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:10px">
      <thead>
        <tr style="border-bottom:1px solid var(--border);color:var(--gray2);font-size:8px;letter-spacing:0.5px">
          <th style="text-align:left;padding:6px 8px">QUAND</th>
          <th style="text-align:left;padding:6px 8px">QUI</th>
          <th style="text-align:left;padding:6px 8px">ACTION</th>
          <th style="text-align:left;padding:6px 8px">SITE</th>
          <th style="text-align:left;padding:6px 8px">CHAMP</th>
          <th style="text-align:right;padding:6px 8px">AVANT → APRÈS</th>
          <th style="text-align:right;padding:6px 8px" title="Impact sur le scénario Base au moment du changement">IMPACT KPI</th>
        </tr>
      </thead>
      <tbody>
        ${entries.map(e => `
          <tr style="border-bottom:1px solid rgba(71,85,115,.15)">
            <td style="padding:6px 8px;color:var(--gray2);white-space:nowrap" title="${new Date(e.ts).toLocaleString('fr-FR')}">${timeAgo(e.ts)}</td>
            <td style="padding:6px 8px;color:var(--accent);font-weight:700">${shortUser(e.user)}</td>
            <td style="padding:6px 8px;color:var(--white)">${actionIcon(e.action)} ${e.action || '—'}</td>
            <td style="padding:6px 8px;color:var(--white)">${(e.target || '—').replace(/</g,'&lt;')}</td>
            <td style="padding:6px 8px;color:var(--gray)">${e.field || '—'}</td>
            <td style="padding:6px 8px;text-align:right;color:var(--gray)">${(e.before != null || e.after != null) ? `<span style="color:var(--red)">${fmtVal(e.before)}</span> → <span style="color:var(--green)">${fmtVal(e.after)}</span>` : '—'}</td>
            <td style="padding:6px 8px;text-align:right;font-size:9px">${impactBadge(e)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <div style="font-size:8px;color:var(--gray2);margin-top:12px;text-align:center">${entries.length} entrées · dernière maj ${new Date(resp.ts).toLocaleString('fr-FR')} · Les entrées 🎛️/💰 portent l'impact KPI (scénario Base) calculé au moment du changement</div>
  `;
}

// v6.64 — persistance des 2 scénarios BP par site (appelée par BPSiteUI après
// chaque run). On stocke un sous-objet minimal (valeurs clés Y5 + TRI +
// payback) pour que le ranking puisse afficher le "delta localisation" sans
// avoir à ré-exécuter le moteur Excel.
window.saveBPSiteScenarios = function(params, kpis) {
  if (!params || !kpis || !isFinite(params.surface)) return;
  const lat = window._lastCaptageLocation?.lat;
  const lng = window._lastCaptageLocation?.lng;
  if (!isFinite(lat) || !isFinite(lng)) return;
  const idx = window._siteAnalyses.findIndex(s => Math.abs(s.lat - lat) < 0.001 && Math.abs(s.lng - lng) < 0.001);
  if (idx < 0) return;
  const packKPI = k => ({
    ca5: k.ca5, ebitda5: k.ebitda5, ebitdaMargin5: k.ebitdaMargin5,
    netResult5: k.netResult5, tri10: k.tri10, paybackYear: k.paybackYear,
  });
  window._siteAnalyses[idx].bpSite = {
    inputs: {
      surface: params.surface,
      loyerM2Month: params.loyerM2Month,
      chargesM2Month: params.chargesM2Month,
      captageMembers: params.captageMembers,
    },
    scenarioA: packKPI(kpis.a),
    scenarioB: packKPI(kpis.b),
    savedAt: Date.now(),
  };
  try { localStorage.setItem('fpSiteAnalyses', JSON.stringify(window._siteAnalyses)); } catch {}
};

function renderSiteRanking() {
  const analyses = window._siteAnalyses;
  if (analyses.length < 2) return '';
  return `
    <div style="background:linear-gradient(135deg,rgba(139,92,246,.08),rgba(139,92,246,.02));border:1px solid rgba(139,92,246,.25);border-radius:8px;padding:10px;margin-bottom:10px">
      <div style="font-size:9px;font-weight:700;color:#8b5cf6;margin-bottom:8px">MATRICE DE PRIORISATION — ${analyses.length} sites analysés</div>
      <div style="overflow-x:auto">
        <table style="width:100%;font-size:8px;border-collapse:collapse">
          <thead>
            <tr style="border-bottom:1px solid var(--border)">
              <th style="text-align:left;padding:3px 4px;color:var(--gray2)">#</th>
              <th style="text-align:left;padding:3px 4px;color:var(--gray2)">Site</th>
              <th style="text-align:center;padding:3px 4px;color:var(--gray2)">Score</th>
              <th style="text-align:center;padding:3px 4px;color:var(--gray2)">Verdict</th>
              <th style="text-align:right;padding:3px 4px;color:var(--gray2)">Mbr théo</th>
              <th style="text-align:right;padding:3px 4px;color:var(--gray2)">IRR</th>
              <th style="text-align:right;padding:3px 4px;color:var(--gray2)">Payback</th>
              <th style="text-align:right;padding:3px 4px;color:var(--gray2)">NPV</th>
              <th style="text-align:right;padding:3px 4px;color:var(--gray2)">CA A3</th>
            </tr>
          </thead>
          <tbody>
            ${analyses.map((s, i) => `<tr style="border-bottom:1px solid rgba(71,85,115,.08)${i===0?';background:rgba(16,185,129,.06)':''}">
              <td style="padding:3px 4px;color:${i===0?'var(--green)':'var(--gray2)'};font-weight:700">${i+1}</td>
              <td style="padding:3px 4px;font-weight:600;color:var(--white)">${s.name}</td>
              <td style="text-align:center;padding:3px 4px;font-weight:800;color:${s.execScore>=75?'#10b981':s.execScore>=60?'#fbbf24':s.execScore>=45?'#f97316':'#ef4444'}">${s.execScore}</td>
              <td style="text-align:center;padding:3px 4px"><span style="font-size:7px;padding:1px 5px;border-radius:3px;font-weight:700;color:${s.verdictColor};background:${s.verdictColor}15;border:1px solid ${s.verdictColor}30">${s.verdict}</span></td>
              <td style="text-align:right;padding:3px 4px">${fmt(s.totalTheo)}</td>
              <td style="text-align:right;padding:3px 4px;color:${s.irrBase>15?'var(--green)':s.irrBase>8?'var(--yellow)':'var(--red)'};font-weight:700">${s.irrBase}%</td>
              <td style="text-align:right;padding:3px 4px">${s.payback?'M'+s.payback:'>60M'}</td>
              <td style="text-align:right;padding:3px 4px;color:${s.npvBase>0?'var(--green)':'var(--red)'}">${fmt(Math.round(s.npvBase/1000))}k</td>
              <td style="text-align:right;padding:3px 4px">${fmt(Math.round(s.caA3/1000))}k</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div style="font-size:7px;color:var(--gray2);margin-top:6px">Classement par score global (marché + financier + concurrence + emplacement + risque). Cliquez "Analyser" sur chaque site pour mettre à jour.</div>
      <button onclick="clearSiteRanking()" style="margin-top:6px;font-size:8px;padding:2px 8px;background:transparent;border:1px solid var(--border);border-radius:4px;color:var(--gray2);cursor:pointer;font-family:var(--font)">Réinitialiser classement</button>
    </div>`;
}

function clearSiteRanking() {
  window._siteAnalyses = [];
  localStorage.removeItem('fpSiteAnalyses');
  // Re-render if visible
  if(window._lastCaptageLocation) {
    const {lat, lng, radius} = window._lastCaptageLocation;
    if(el('captageContent') && el('captageContent').innerHTML) renderCaptageAnalysis('captageContent', lat, lng, radius);
    if(el('captageContentSite') && el('captageContentSite').innerHTML) renderCaptageAnalysis('captageContentSite', lat, lng, radius);
  }
}

// --- PDF EXPORT ---
function exportPDF() {
  const container = el('captageContentSite') || el('captageContent');
  if(!container || !container.innerHTML) { alert('Analysez un site d\'abord'); return; }

  const siteName = window._lastCaptageLocation?.siteName || 'Site Analyse';
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head><title>FP Romania — Rapport ${siteName}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Inter',system-ui,sans-serif;background:#fff;color:#1a1a2e;padding:40px;font-size:11px;line-height:1.5}
    .header{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #d4a017;padding-bottom:16px;margin-bottom:24px}
    .header h1{font-size:22px;font-weight:800;color:#1a1a2e}
    .header .subtitle{font-size:11px;color:#666;margin-top:4px}
    .logo-text{font-size:16px;font-weight:800;color:#d4a017;text-align:right}
    .logo-text .isseo{font-size:10px;color:#888;font-weight:400}
    .section{margin-bottom:20px;page-break-inside:avoid}
    .section-title{font-size:13px;font-weight:700;color:#1a1a2e;border-left:4px solid #d4a017;padding-left:8px;margin-bottom:10px}
    .metric-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
    .metric-box{background:#f8f9fa;border:1px solid #e5e7eb;border-radius:6px;padding:8px;text-align:center}
    .metric-box .label{font-size:8px;color:#666;font-weight:600;text-transform:uppercase}
    .metric-box .value{font-size:18px;font-weight:800;margin-top:2px}
    .verdict-box{text-align:center;padding:16px;border-radius:8px;margin-bottom:16px}
    .verdict-box .score{font-size:48px;font-weight:900}
    .verdict-box .verdict{font-size:20px;font-weight:800;margin-top:4px}
    table{width:100%;border-collapse:collapse;font-size:10px}
    th{text-align:left;padding:4px 6px;border-bottom:2px solid #d4a017;font-weight:700;color:#666;font-size:9px;text-transform:uppercase}
    td{padding:4px 6px;border-bottom:1px solid #eee}
    .footer{margin-top:30px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:9px;color:#999;display:flex;justify-content:space-between}
    .go{color:#10b981} .nogo{color:#ef4444} .watch{color:#f97316} .cond{color:#fbbf24}
    @media print{body{padding:20px}@page{margin:15mm;size:A4}}
  </style></head><body>
    <div class="header">
      <div><h1>Rapport d'Analyse — ${siteName}</h1><div class="subtitle">Fitness Park Romania — Expansion Intelligence Platform | ${new Date().toLocaleDateString('fr-FR', {day:'numeric',month:'long',year:'numeric'})}</div></div>
      <div class="logo-text">FITNESS PARK<br><span class="isseo">powered by ISSEO</span></div>
    </div>
    <div id="pdfBody"></div>
    <div class="footer">
      <span>Confidentiel — Usage interne FP Master Franchise Romania</span>
      <span>Généré le ${new Date().toLocaleString('fr-FR')} | Méthodologie Bain-level v2</span>
    </div>
  </body></html>`);

  // Populate with data from last analysis
  const data = window._lastExecData;
  if(!data) { win.document.getElementById('pdfBody').innerHTML = container.innerHTML; win.print(); return; }
  const {r, exec} = data;
  const vClass = exec.verdict === 'GO' ? 'go' : exec.verdict === 'NO-GO' ? 'nogo' : exec.verdict === 'WATCH' ? 'watch' : 'cond';

  win.document.getElementById('pdfBody').innerHTML = `
    <div class="verdict-box" style="background:${exec.verdictColor}08;border:2px solid ${exec.verdictColor}">
      <div class="score" style="color:${exec.verdictColor}">${exec.total}/100</div>
      <div class="verdict ${vClass}">${exec.verdict}</div>
      <div style="font-size:11px;color:#666;margin-top:4px">${exec.verdictDesc}</div>
    </div>

    <div class="section">
      <div class="section-title">Scoring Détaillé</div>
      <table>
        <tr><th>Dimension</th><th>Score</th><th>Max</th><th>Détails</th></tr>
        ${Object.values(exec.scores).map(s => `<tr><td style="font-weight:600">${s.label}</td><td style="font-weight:700;color:${s.score/s.max>=0.7?'#10b981':s.score/s.max>=0.5?'#fbbf24':'#ef4444'}">${s.score}</td><td>/${s.max}</td><td style="font-size:9px;color:#666">${s.details}</td></tr>`).join('')}
      </table>
    </div>

    <div class="section">
      <div class="section-title">Métriques Clés</div>
      <div class="metric-grid">
        <div class="metric-box"><div class="label">Membres Théoriques</div><div class="value">${fmt(r.totalTheorique)}</div></div>
        <div class="metric-box"><div class="label">IRR (incl. TV ${PNL_DEFAULTS.exitMultiple}x)</div><div class="value" style="color:${r.pnl.base.irr>15?'#10b981':'#ef4444'}">${r.pnl.base.irr}%</div></div>
        <div class="metric-box"><div class="label">NPV (incl. TV)</div><div class="value" style="color:${r.pnl.base.npv>0?'#10b981':'#ef4444'}">${fmt(Math.round(r.pnl.base.npv/1000))}k€</div></div>
        <div class="metric-box"><div class="label">Payback Ops</div><div class="value">${r.pnl.base.paybackMonth?'M'+r.pnl.base.paybackMonth:'>60M'}</div></div>
        <div class="metric-box"><div class="label">LTV/CAC</div><div class="value">${r.ltvCacRatio}x</div></div>
        <div class="metric-box"><div class="label">CAPEX</div><div class="value">${fmt(Math.round(r.pnl.base.capex/1000))}k€</div></div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Décomposition Captage</div>
      <div class="metric-grid">
        <div class="metric-box" style="border-left:3px solid #f97316"><div class="label">Captifs (vols concurrents)</div><div class="value" style="color:#f97316">${fmt(r.totalCaptifs)}</div></div>
        <div class="metric-box" style="border-left:3px solid #10b981"><div class="label">Natifs (création marché)</div><div class="value" style="color:#10b981">${fmt(r.native.captured)}</div></div>
        <div class="metric-box" style="border-left:3px solid #06b6d4"><div class="label">Walk-in (trafic${r.walkIn.isPremiumMall?' premium':''})</div><div class="value" style="color:#06b6d4">${fmt(r.walkIn.walkInMembers)}</div>${r.walkIn.isPremiumMall?'<div class="sublabel">Conv. '+r.walkIn.conversionRate.toFixed(1)+'% (premium)</div>':''}</div>
        ${r.destinationBonus.bonusMembers > 0 ? `<div class="metric-box" style="border-left:3px solid #a78bfa"><div class="label">Destination bonus (10km)</div><div class="value" style="color:#a78bfa">${fmt(r.destinationBonus.bonusMembers)}</div><div class="sublabel">${fmt(r.destinationBonus.deltaPop)} pop. élargie</div></div>` : ''}
      </div>
    </div>

    <div class="section">
      <div class="section-title">P&L 5 ans — 3 Scénarios</div>
      <table>
        <tr><th>Année</th><th>Conservateur</th><th>Base</th><th>Optimiste</th></tr>
        ${[0,1,2,3,4].map(i => `<tr><td style="font-weight:600">A${i+1}</td><td>${fmt(Math.round(r.pnl.conservateur.annualCA[i]/1000))}k€</td><td style="font-weight:700">${fmt(Math.round(r.pnl.base.annualCA[i]/1000))}k€</td><td>${fmt(Math.round(r.pnl.optimiste.annualCA[i]/1000))}k€</td></tr>`).join('')}
        <tr style="border-top:1px solid #888"><td style="font-size:7px;color:#888">EBITDA A5</td><td style="font-size:7px">${fmt(Math.round(r.pnl.conservateur.annualEBITDA[4]/1000))}k€</td><td style="font-size:7px;font-weight:700">${fmt(Math.round(r.pnl.base.annualEBITDA[4]/1000))}k€</td><td style="font-size:7px">${fmt(Math.round(r.pnl.optimiste.annualEBITDA[4]/1000))}k€</td></tr>
        <tr><td style="font-size:7px;color:#888">TV (${PNL_DEFAULTS.exitMultiple}x EBITDA)</td><td style="font-size:7px">${fmt(Math.round(r.pnl.conservateur.terminalValue/1000))}k€</td><td style="font-size:7px;font-weight:700">${fmt(Math.round(r.pnl.base.terminalValue/1000))}k€</td><td style="font-size:7px">${fmt(Math.round(r.pnl.optimiste.terminalValue/1000))}k€</td></tr>
        <tr style="border-top:2px solid #d4a017"><td style="font-weight:700">IRR Projet (unlevered)</td><td style="color:${r.pnl.conservateur.irr>15?'#10b981':'#ef4444'}">${r.pnl.conservateur.irr.toFixed(1)}%</td><td style="font-weight:700;color:${r.pnl.base.irr>15?'#10b981':'#ef4444'}">${r.pnl.base.irr.toFixed(1)}%</td><td style="color:${r.pnl.optimiste.irr>15?'#10b981':'#ef4444'}">${r.pnl.optimiste.irr.toFixed(1)}%</td></tr>
        <tr><td style="font-weight:700">IRR Equity (levered) ⭐</td><td style="color:${r.pnl.conservateur.irrEquity>15?'#10b981':'#ef4444'}">${(r.pnl.conservateur.irrEquity ?? 0).toFixed(1)}%</td><td style="font-weight:700;color:${r.pnl.base.irrEquity>15?'#10b981':'#ef4444'}">${(r.pnl.base.irrEquity ?? 0).toFixed(1)}%</td><td style="color:${r.pnl.optimiste.irrEquity>15?'#10b981':'#ef4444'}">${(r.pnl.optimiste.irrEquity ?? 0).toFixed(1)}%</td></tr>
        <tr><td style="font-weight:700">NPV</td><td>${fmt(Math.round(r.pnl.conservateur.npv/1000))}k€</td><td style="font-weight:700">${fmt(Math.round(r.pnl.base.npv/1000))}k€</td><td>${fmt(Math.round(r.pnl.optimiste.npv/1000))}k€</td></tr>
        <tr><td style="font-weight:700">FCFE cumulé 5 ans (avant IS)</td><td>${fmt(Math.round((r.pnl.conservateur.fcfe5y||0)/1000))}k€</td><td style="font-weight:700">${fmt(Math.round((r.pnl.base.fcfe5y||0)/1000))}k€</td><td>${fmt(Math.round((r.pnl.optimiste.fcfe5y||0)/1000))}k€</td></tr>
        <tr><td style="font-weight:700">DSCR min (A2+, hors ramp-up A1)</td><td>${r.pnl.conservateur.dscrMinCruise != null ? r.pnl.conservateur.dscrMinCruise.toFixed(2)+'×' : 'n/a'}</td><td style="font-weight:700;color:${(r.pnl.base.dscrMinCruise||0)>=1.2?'#10b981':'#ef4444'}">${r.pnl.base.dscrMinCruise != null ? r.pnl.base.dscrMinCruise.toFixed(2)+'×' : 'n/a'}</td><td>${r.pnl.optimiste.dscrMinCruise != null ? r.pnl.optimiste.dscrMinCruise.toFixed(2)+'×' : 'n/a'}</td></tr>
        <tr><td style="font-weight:700">MOIC 5 ans (avec sortie 8× EBITDA)</td><td>${r.pnl.conservateur.moic != null ? r.pnl.conservateur.moic.toFixed(1)+'×' : 'n/a'}</td><td style="font-weight:700">${r.pnl.base.moic != null ? r.pnl.base.moic.toFixed(1)+'×' : 'n/a'}</td><td>${r.pnl.optimiste.moic != null ? r.pnl.optimiste.moic.toFixed(1)+'×' : 'n/a'}</td></tr>
      </table>
    </div>

    ${exec.risks.length > 0 ? `<div class="section">
      <div class="section-title" style="border-left-color:#ef4444">Risques Identifiés</div>
      <ul style="padding-left:16px">${exec.risks.map(r => `<li style="color:#ef4444;margin-bottom:3px"><span style="color:#333">${r}</span></li>`).join('')}</ul>
    </div>` : ''}

    ${exec.opportunities.length > 0 ? `<div class="section">
      <div class="section-title" style="border-left-color:#10b981">Opportunités</div>
      <ul style="padding-left:16px">${exec.opportunities.map(o => `<li style="color:#10b981;margin-bottom:3px"><span style="color:#333">${o}</span></li>`).join('')}</ul>
    </div>` : ''}

    ${r.monteCarlo ? `<div class="section">
      <div class="section-title" style="border-left-color:#8b5cf6">Monte Carlo — Stress Test (${r.monteCarlo.iterations} simulations)</div>
      <div class="metric-grid">
        <div class="metric-box"><div class="label">P(IRR > 0%)</div><div class="value" style="color:${r.monteCarlo.probPositiveIRR>=90?'#10b981':'#ef4444'}">${r.monteCarlo.probPositiveIRR}%</div></div>
        <div class="metric-box"><div class="label">P(IRR > 15%)</div><div class="value" style="color:${r.monteCarlo.probIRR15>=70?'#10b981':'#ef4444'}">${r.monteCarlo.probIRR15}%</div></div>
        <div class="metric-box"><div class="label">P(Payback ≤ 36M)</div><div class="value" style="color:${r.monteCarlo.probPayback36>=70?'#10b981':'#ef4444'}">${r.monteCarlo.probPayback36}%</div></div>
      </div>
      <table style="margin-top:8px">
        <tr><th>Métrique</th><th>P5 (pire)</th><th>P25</th><th>Médian</th><th>P75</th><th>P95 (meilleur)</th></tr>
        <tr><td>IRR</td><td style="color:#ef4444">${r.monteCarlo.irr.p5}%</td><td>${r.monteCarlo.irr.p25}%</td><td style="font-weight:700">${r.monteCarlo.irr.p50}%</td><td>${r.monteCarlo.irr.p75}%</td><td style="color:#10b981">${r.monteCarlo.irr.p95}%</td></tr>
        <tr><td>NPV</td><td style="color:#ef4444">${fmt(Math.round(r.monteCarlo.npv.p5/1000))}k€</td><td></td><td style="font-weight:700">${fmt(Math.round(r.monteCarlo.npv.p50/1000))}k€</td><td></td><td style="color:#10b981">${fmt(Math.round(r.monteCarlo.npv.p95/1000))}k€</td></tr>
      </table>
    </div>` : ''}

    ${window._siteAnalyses.length >= 2 ? `<div class="section">
      <div class="section-title" style="border-left-color:#8b5cf6">Matrice Comparative</div>
      <table>
        <tr><th>#</th><th>Site</th><th>Score</th><th>Verdict</th><th>Mbr Théo</th><th>IRR</th><th>NPV</th></tr>
        ${window._siteAnalyses.map((s,i) => `<tr${i===0?' style="background:#f0fdf4"':''}><td>${i+1}</td><td style="font-weight:600">${s.name}</td><td style="font-weight:800;color:${s.execScore>=75?'#10b981':s.execScore>=60?'#fbbf24':'#ef4444'}">${s.execScore}</td><td>${s.verdict}</td><td>${fmt(s.totalTheo)}</td><td>${s.irrBase}%</td><td>${fmt(Math.round(s.npvBase/1000))}k€</td></tr>`).join('')}
      </table>
    </div>` : ''}
  `;

  setTimeout(() => { win.print(); }, 500);
}

// --- ISOCHRONE OVERLAP ---
// Uses CARTIERE point-in-polygon to compute population overlap between 2 isochrones
function pointInPolygon(point, polygon) {
  // Ray-casting algorithm for point in polygon
  const [px, py] = point;
  let inside = false;
  const coords = polygon.coordinates ? polygon.coordinates[0] : polygon;
  if(!coords) return false;
  for(let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
    const [xi, yi] = coords[i];
    const [xj, yj] = coords[j];
    if(((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function computeOverlap(iso1GeoJSON, iso2GeoJSON) {
  if(!iso1GeoJSON || !iso2GeoJSON) return null;

  const poly1 = iso1GeoJSON.geometry || iso1GeoJSON;
  const poly2 = iso2GeoJSON.geometry || iso2GeoJSON;

  let pop1 = 0, pop2 = 0, popOverlap = 0;
  const overlapCartiere = [];

  CARTIERE.forEach(c => {
    const pt = [c.lng, c.lat]; // GeoJSON is [lng, lat]
    const in1 = pointInPolygon(pt, poly1);
    const in2 = pointInPolygon(pt, poly2);

    if(in1) pop1 += c.pop;
    if(in2) pop2 += c.pop;
    if(in1 && in2) {
      popOverlap += c.pop;
      overlapCartiere.push(c.name);
    }
  });

  return {
    pop1, pop2, popOverlap,
    overlapPct1: pop1 > 0 ? Math.round(popOverlap / pop1 * 100) : 0,
    overlapPct2: pop2 > 0 ? Math.round(popOverlap / pop2 * 100) : 0,
    overlapCartiere
  };
}

// Get nearby CARTIERE for persona analysis
function getNearbyCARTIERE(lat, lng, radiusM) {
  radiusM = radiusM || 3000;
  return CARTIERE.filter(c => haversine(lat, lng, c.lat, c.lng) <= radiusM);
}

// NATIVE DEMAND V3 — Western Europe penetration gap model
// Core insight: Romania fitness penetration ~4-5% vs Western Europe 15-20%.
// Low-cost disruptors (Basic-Fit, PureGym, FP) are THE driver of penetration growth.
// When low-cost enters a market, penetration jumps 3-6 pp in the catchment zone.
// Source: EuropeActive 2024, Deloitte European Health & Fitness Market Report
//
// Model: FP doesn't just steal from competitors — it CREATES the market.
// The "natifs" pool = people in the target demo who DON'T go to gym today
// but WOULD if a credible low-cost option existed (= the WE penetration gap).
const RO_PENETRATION = 0.045;  // Romania current fitness penetration (~4.5%)
const WE_PENETRATION_TARGET = 0.13; // Target with low-cost = ~13% (conservative WE avg)
// FP's share of the incremental market — calibrated for single-club reality
// One FP club (1,400m²) can realistically convert ~1,500-2,500 new gym-goers
// The rest of capacity comes from competitor capture (captifs)
const FP_MARKET_CREATION_SHARE = 0.18;
// Physical ceiling: one club can't create more than ~2,500 brand-new gym members
// (the rest of its capacity is filled by competitive capture)
const MAX_NATIVE_SINGLE_CLUB = Infinity; // no cap on native demand

function calcNativeDemand(popTarget, currentPenetration, fpAttractivite) {
  // Current local penetration (may differ from national average)
  const localPen = Math.max(currentPenetration / 100, RO_PENETRATION);

  // Penetration gap = opportunity for market creation
  const penGap = Math.max(0, WE_PENETRATION_TARGET - localPen);

  // Pool of potential NEW gym-goers in the target demographic
  const nativePool = Math.round(popTarget * penGap);

  // FP's capture of this new pool, modulated by local attractiveness
  // Higher attractiveness (good location score) → more of the gap FP can unlock
  const attractMult = 0.8 + fpAttractivite * 0.4; // range 0.8 - 1.2
  const captureRate = FP_MARKET_CREATION_SHARE * Math.min(attractMult, 1.3);
  const rawNative = Math.round(nativePool * captureRate);
  // Cap at single-club physical absorption limit
  const nativeCapture = Math.min(rawNative, MAX_NATIVE_SINGLE_CLUB);

  return {
    pool: nativePool,
    uplift: Math.round(captureRate * 100 * 10) / 10,
    penGap: Math.round(penGap * 1000) / 10, // in % with 1 decimal
    localPen: Math.round(localPen * 1000) / 10,
    targetPen: Math.round(WE_PENETRATION_TARGET * 100 * 10) / 10,
    captured: nativeCapture
  };
}

function runCaptageAnalysis(lat, lng, captageRadius) {
  captageRadius = captageRadius || 3000;
  const comps = getDemoInRadius(lat, lng, captageRadius);

  // === SOURCE 1: CAPTIFS (competitor capture) ===
  // Enhanced with Google Distance Matrix (real driving time) + live ratings + competitor strength
  const captageDetails = comps.map(c => {
    const dist = haversine(lat, lng, c.lat, c.lng);
    const baseRate = (CAPTURE_RATES[c.segment] || CAPTURE_RATES.independent).rate;
    const decay = distanceDecay(dist, c.driveMins); // uses driving time if available
    // Use live Google rating, fallback to static DB
    const rv = getReviewData(c.name, c);
    const rating = c.gRating || (rv ? rv.g : null);
    const rFactor = ratingFactor(rating);
    const pFactor = priceElasticity(c.segment);
    const sFactor = competitorStrength(c.gReviews || (rv ? rv.r : null)); // new: established club harder to capture
    const effectiveRate = baseRate * decay * rFactor * pFactor * sFactor;
    const mA = c.members || 0;
    const mB = rv ? rv.mB : 0;
    const membersEst = mB > 0 ? Math.round((mA + mB) / 2) : mA;
    const captured = Math.round(membersEst * effectiveRate);

    return {
      name: c.name, segment: c.segment, color: c.color,
      dist: Math.round(dist), driveMins: c.driveMins, membersA: mA, membersB: mB, membersEst,
      baseRate: Math.round(baseRate * 100),
      decay: Math.round(decay * 100),
      ratingFactor: Math.round(rFactor * 100),
      priceFactor: Math.round(pFactor * 100),
      strengthFactor: Math.round(sFactor * 100),
      effectiveRate: Math.round(effectiveRate * 100 * 10) / 10,
      captured, rating, reviewCount: c.gReviews || (rv ? rv.r : null),
      dataSrc: c.gEnriched ? 'Google Live' : 'DB statique',
      reason: (CAPTURE_RATES[c.segment] || CAPTURE_RATES.independent).reason
    };
  }).sort((a, b) => b.captured - a.captured);

  const totalCaptifs = captageDetails.reduce((a, c) => a + c.captured, 0);
  const totalMembersZone = captageDetails.reduce((a, c) => a + c.membersEst, 0);

  // === SOURCE 2: NATIFS (new gym-goers) ===
  const sector = findSector(lat, lng);
  const popGranular = estimatePopInRadiusGranular(lat, lng, captageRadius);
  const currentPenetration = popGranular.target > 0 ? (totalMembersZone / popGranular.target) * 100 : 0;
  const saz = calcSAZ(lat, lng, sector, comps);
  const fpAttract = ((saz.flux || 0) + (saz.jeunesse || 0)) / 200;
  const native = calcNativeDemand(popGranular.target, currentPenetration, fpAttract);

  // === SOURCE 3: WALK-IN (mall/centre traffic conversion) ===
  const walkIn = calcWalkIn(lat, lng);

  // === SOURCE 4: DESTINATION MALL BONUS (extended catchment 10km) ===
  // Premium destination malls (>40k visitors/day) attract from city-wide catchment
  // Standard 3km radius misses 80% of real catchment for Baneasa/AFI-type malls
  const destinationBonus = calcDestinationBonus(lat, lng, walkIn, captageRadius);

  // === TOTAL ===
  const rawTotal = totalCaptifs + native.captured + walkIn.walkInMembers + destinationBonus.bonusMembers;
  const totalTheorique = rawTotal; // no cap — show full theoretical potential
  const rampUp = monthlyRampUp(totalTheorique); // legacy 12-month for backward compat
  const pessimiste = Math.round(totalTheorique * 0.6);
  const realiste = totalTheorique;
  const optimiste = Math.round(totalTheorique * 1.3);

  // === BAIN-LEVEL ANALYTICS ===
  // Persona segmentation based on nearby quartiers
  const nearbyCARTIERE = getNearbyCARTIERE(lat, lng, captageRadius);
  const personaMix = getPersonaMix(nearbyCARTIERE);
  const arpu = blendedARPU(personaMix);
  const churnY1 = blendedChurn(personaMix, 6);   // Y1 rate (low, engagement period)
  const churnRate = blendedChurn(personaMix, 24); // Steady-state Y2+ rate

  // 3 market scenarios (Conservateur / Base / Optimiste)
  const scenarios = {};
  for(const key of ['conservateur','base','optimiste']) {
    const ramp = scenarioRampUp(totalTheorique, 60, key);
    const cohort = cohortModel(totalTheorique, 60, personaMix, key);
    scenarios[key] = { ramp, cohort };
  }

  // P&L / IRR / Financial model per scenario
  const avgPrice = nearbyCARTIERE.length > 0
    ? nearbyCARTIERE.reduce((a,c) => a + c.price * c.pop, 0) / nearbyCARTIERE.reduce((a,c) => a + c.pop, 0)
    : 1500;
  const pnl = {};
  for(const key of ['conservateur','base','optimiste']) {
    pnl[key] = buildPnL(scenarios[key].cohort, avgPrice);
  }

  // LTV / CAC
  const ltv = calcLTV(arpu, churnRate);
  const ltvCacRatio = Math.round(ltv / DEFAULT_CAC * 10) / 10;

  // Sensitivity / Tornado analysis
  const sensitivity = runSensitivity(totalTheorique, personaMix, avgPrice);

  // Monte Carlo simulation (1000 iterations)
  const monteCarlo = runMonteCarlo(totalTheorique, personaMix, avgPrice, 1000);

  return {
    captageRadius, comps: captageDetails,
    totalCaptifs, totalMembersZone,
    native, walkIn, destinationBonus,
    currentPenetration: Math.round(currentPenetration * 10) / 10,
    popTarget: popGranular.target,
    fpAttract: Math.round(fpAttract * 100),
    totalTheorique, pessimiste, realiste, optimiste,
    rampUp, saz,
    breakeven2800: totalTheorique >= 2800 ? 'OUI' : totalTheorique >= 2000 ? 'POSSIBLE' : 'NON',
    breakeven4000: totalTheorique >= 4000 ? 'OUI' : totalTheorique >= 3000 ? 'POSSIBLE' : 'NON',
    // Bain-level data
    personaMix, arpu, churnY1, churnRate,
    scenarios, pnl, sensitivity, monteCarlo,
    ltv, ltvCacRatio, cac: DEFAULT_CAC,
    avgQuartierPrice: Math.round(avgPrice),
    nearbyCARTIERE
  };
}

// Render captage analysis in a container
function renderCaptageAnalysis(containerId, lat, lng, captageRadius) {
  window._lastCaptageLocation = {lat, lng, radius: captageRadius, containerId};
  // Restore per-site rent/charge/surface overrides if previously adjusted
  const siteKey = lat.toFixed(3) + ',' + lng.toFixed(3);
  window._rentOverride    = window._rentOverrides[siteKey]    ? {y1: window._rentOverrides[siteKey]}                  : null;
  window._chargeOverride  = window._chargeOverrides[siteKey]  ? {chargeTotal: window._chargeOverrides[siteKey]}       : null;
  window._surfaceOverride = window._surfaceOverrides[siteKey] ? {surface: window._surfaceOverrides[siteKey]}          : null;
  const r = runCaptageAnalysis(lat, lng, captageRadius);
  const c = el(containerId);
  if(!c) return;

  // Executive Summary scoring
  const exec = computeExecSummary(r);
  window._lastExecData = {r, exec};
  // Store for real-time recalc (rent slider)
  window._lastCaptageData = {r, avgPrice: r.avgQuartierPrice, containerId};

  // Save to multi-site ranking
  const siteName = window._lastCaptageLocation?.siteName
    || customSites.find(s => Math.abs(s.lat-lat)<0.001 && Math.abs(s.lng-lng)<0.001)?.name
    || (typeof TARGETS !== 'undefined' ? TARGETS.find(t => Math.abs(t.lat-lat)<0.001 && Math.abs(t.lng-lng)<0.001)?.name : null)
    || `Site ${lat.toFixed(3)},${lng.toFixed(3)}`;
  window._lastCaptageLocation.siteName = siteName;
  saveSiteAnalysis(siteName, lat, lng, r, exec);

  const recoColor = r.totalTheorique >= 4000 ? 'var(--green)' : r.totalTheorique >= 2800 ? 'var(--yellow)' : 'var(--red)';
  const recoText = r.totalTheorique >= 4000 ? 'EXCELLENT' : r.totalTheorique >= 2800 ? 'VIABLE' : r.totalTheorique >= 2000 ? 'RISQUE' : 'INSUFFISANT';

  c.innerHTML = `
    <div style="background:linear-gradient(135deg,${exec.verdictColor}12,${exec.verdictColor}04);border:2px solid ${exec.verdictColor}50;border-radius:10px;padding:14px;margin-bottom:12px;position:relative">
      <div style="position:absolute;top:8px;right:10px;display:flex;gap:5px">
        <button onclick="ShareLink.shareMemo()" title="Crée un lien public LECTURE SEULE du mémo (30 jours) — à envoyer à un bailleur, une banque, FP France" style="font-size:8px;padding:3px 10px;background:transparent;border:1px solid var(--green);border-radius:4px;color:var(--green);cursor:pointer;font-weight:700;font-family:var(--font)">&#128279; Partager</button>
        <button onclick="AiAnalyst.open()" title="Pose tes questions au site en français — l'IA répond uniquement sur les chiffres du modèle" style="font-size:8px;padding:3px 10px;background:transparent;border:1px solid var(--cyan);border-radius:4px;color:var(--cyan);cursor:pointer;font-weight:700;font-family:var(--font)">&#128172; Analyste IA</button>
        <button onclick="ICMemo.open()" title="Mémo d'investment committee — 1 page A4 narrative, prête à imprimer" style="font-size:8px;padding:3px 10px;background:transparent;border:1px solid var(--accent);border-radius:4px;color:var(--accent);cursor:pointer;font-weight:700;font-family:var(--font)">&#128220; Mémo d'IC</button>
        <button onclick="exportPDF()" style="font-size:8px;padding:3px 10px;background:var(--accent);border:none;border-radius:4px;color:#000;cursor:pointer;font-weight:700;font-family:var(--font)">&#128196; Export PDF</button>
      </div>
      <div style="font-size:8px;font-weight:700;color:var(--gray2);letter-spacing:1px;margin-bottom:8px">EXECUTIVE SUMMARY</div>
      <div id="exec-summary-header" style="display:flex;align-items:center;gap:16px;margin-bottom:10px">
        <div style="text-align:center">
          <div id="exec-score" style="font-size:44px;font-weight:900;color:${exec.verdictColor};line-height:1">${exec.total}</div>
          <div style="font-size:8px;color:var(--gray2)">/100</div>
        </div>
        <div style="flex:1">
          <div id="exec-verdict" style="font-size:18px;font-weight:900;color:${exec.verdictColor};margin-bottom:2px">${exec.verdict}</div>
          <div id="exec-verdict-desc" style="font-size:9px;color:var(--gray)">${exec.verdictDesc}</div>
        </div>
      </div>
      <div id="exec-scores-bars" style="display:flex;gap:3px;margin-bottom:8px">
        ${Object.values(exec.scores).map(s => {
          const pct = Math.round(s.score / s.max * 100);
          const col = pct >= 70 ? '#10b981' : pct >= 50 ? '#fbbf24' : '#ef4444';
          return `<div style="flex:1;text-align:center">
            <div style="font-size:7px;color:var(--gray2);margin-bottom:2px">${s.label}</div>
            <div style="height:4px;background:var(--bg);border-radius:2px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${col};border-radius:2px"></div></div>
            <div style="font-size:9px;font-weight:800;color:${col};margin-top:1px">${s.score}/${s.max}</div>
          </div>`;
        }).join('')}
      </div>

      <!-- v6.72 P2b — "verdict d'abord": 4 chiffres en langage décideur + phrase EN CLAIR -->
      ${(() => {
        const pb = r.pnl.base;
        const ebA5 = pb.annualEBITDA?.[4] || 0;
        const margeA5 = pb.annualCA?.[4] > 0 ? Math.round(ebA5 / pb.annualCA[4] * 100) : 0;
        const tile = (val, label, reading, col) => `
          <div style="flex:1;background:var(--bg);border-radius:8px;padding:9px 10px;min-width:0">
            <div style="font-size:17px;font-weight:900;color:${col};line-height:1.1;white-space:nowrap">${val}</div>
            <div style="font-size:8px;font-weight:700;color:var(--gray);margin-top:3px">${label}</div>
            <div style="font-size:7.5px;color:var(--gray2);line-height:1.35;margin-top:2px">${reading}</div>
          </div>`;
        return `<div style="display:flex;gap:6px;margin-bottom:10px">
          ${tile(fmt(r.realiste), 'MEMBRES À MATURITÉ', 'scénario base — vs cible BP ' + fmt(PNL_DEFAULTS.targetMembers), r.realiste >= PNL_DEFAULTS.targetMembers ? 'var(--green)' : 'var(--yellow)')}
          ${tile((pb.irrEquity ?? 0).toFixed(0) + '%', 'IRR EQUITY', 'rendement annualisé de l’apport, dette incluse', pb.irrEquity > 30 ? 'var(--green)' : pb.irrEquity > 15 ? 'var(--yellow)' : 'var(--red)')}
          ${tile(fmt(Math.round((pb.fcfe5y || 0) / 1000)) + 'k€', 'FCFE 5 ANS', 'cash rendu à l’actionnaire (apport: ' + fmt(Math.round(pb.equity / 1000)) + 'k€)', (pb.fcfe5y || 0) > pb.equity ? 'var(--green)' : 'var(--yellow)')}
          ${tile(pb.paybackEquityMonth ? 'M' + pb.paybackEquityMonth : '>60M', 'RETOUR DE L’APPORT', pb.paybackEquityMonth ? 'ton argent est revenu — la suite est du gain' : 'apport non récupéré sur 5 ans', pb.paybackEquityMonth && pb.paybackEquityMonth <= 36 ? 'var(--green)' : pb.paybackEquityMonth ? 'var(--yellow)' : 'var(--red)')}
        </div>
        <div style="font-size:9px;color:var(--gray);line-height:1.55;background:var(--bg);border-left:3px solid ${exec.verdictColor};border-radius:0 6px 6px 0;padding:7px 10px;margin-bottom:10px">
          <b style="color:var(--white)">EN CLAIR :</b> ce site peut atteindre <b style="color:var(--white)">${fmt(r.realiste)} membres</b>,
          soit un EBITDA de <b style="color:var(--white)">${fmt(Math.round(ebA5/1000))} k€ (${margeA5}% de marge)</b> en année 5.
          Avec le financement de référence (${Math.round((pb.financing?.equityRatio ?? 0.3)*100)}% d'apport = ${fmt(Math.round(pb.equity/1000))} k€),
          l’apport ${pb.paybackEquityMonth ? 'revient en <b style="color:var(--white)">' + Math.ceil(pb.paybackEquityMonth/12*10)/10 + ' ans</b>' : 'n’est pas récupéré sur 5 ans'}
          et rapporte <b style="color:${exec.verdictColor}">${(pb.irrEquity ?? 0).toFixed(0)}% par an</b> (sortie à ${getEffectiveExitMultiple()}× l'EBITDA incluse).
        </div>`;
      })()}
      ${exec.risks.length > 0 || exec.opportunities.length > 0 ? `<div style="display:flex;gap:8px;font-size:8px;line-height:1.4">
        ${exec.risks.length > 0 ? `<div style="flex:1"><div style="color:var(--red);font-weight:700;margin-bottom:2px">⚠ Risques</div>${exec.risks.map(r=>'<div style="color:var(--gray2)">• '+r+'</div>').join('')}</div>` : ''}
        ${exec.opportunities.length > 0 ? `<div style="flex:1"><div style="color:var(--green);font-weight:700;margin-bottom:2px">★ Opportunités</div>${exec.opportunities.map(o=>'<div style="color:var(--gray2)">• '+o+'</div>').join('')}</div>` : ''}
      </div>` : ''}
    </div>

    ${renderSiteRanking()}

    <div style="text-align:center;padding:12px 0;margin-bottom:12px;background:var(--bg);border-radius:8px">
      <div style="font-size:9px;font-weight:700;color:var(--gray2);margin-bottom:4px">MEMBRES THEORIQUES A TERME</div>
      <div style="font-size:42px;font-weight:900;color:${recoColor};line-height:1">${fmt(r.realiste)}</div>
      <div style="font-size:11px;color:var(--gray2);margin-top:2px">Rayon captage: ${r.captageRadius/1000} km</div>
      <div style="display:inline-block;padding:3px 12px;border-radius:12px;font-size:10px;font-weight:700;margin-top:6px;color:${recoColor};border:1px solid ${recoColor}30;background:${recoColor}10">${recoText}</div>
    </div>

    <div style="display:flex;gap:4px;margin-bottom:12px;flex-wrap:wrap">
      <div style="flex:1;min-width:60px;background:var(--bg);border-radius:6px;padding:6px;text-align:center;border-left:3px solid #f97316">
        <div style="font-size:7px;font-weight:700;color:#f97316">CAPTIFS</div>
        <div style="font-size:18px;font-weight:900;color:#f97316">${fmt(r.totalCaptifs)}</div>
        <div style="font-size:7px;color:var(--gray2)">vols concurrents</div>
      </div>
      <div style="flex:1;min-width:60px;background:var(--bg);border-radius:6px;padding:6px;text-align:center;border-left:3px solid var(--green)">
        <div style="font-size:7px;font-weight:700;color:var(--green)">NATIFS</div>
        <div style="font-size:18px;font-weight:900;color:var(--green)">${fmt(r.native.captured)}</div>
        <div style="font-size:7px;color:var(--gray2)">création marché</div>
      </div>
      <div style="flex:1;min-width:60px;background:var(--bg);border-radius:6px;padding:6px;text-align:center;border-left:3px solid var(--cyan)">
        <div style="font-size:7px;font-weight:700;color:var(--cyan)">WALK-IN</div>
        <div style="font-size:18px;font-weight:900;color:var(--cyan)">${fmt(r.walkIn.walkInMembers)}</div>
        <div style="font-size:7px;color:var(--gray2)">${r.walkIn.isPremiumMall?'premium '+r.walkIn.conversionRate.toFixed(1)+'%':'trafic mall'}</div>
      </div>
      ${r.destinationBonus.bonusMembers > 0 ? `<div style="flex:1;min-width:60px;background:var(--bg);border-radius:6px;padding:6px;text-align:center;border-left:3px solid #a78bfa">
        <div style="font-size:7px;font-weight:700;color:#a78bfa">DESTINATION</div>
        <div style="font-size:18px;font-weight:900;color:#a78bfa">${fmt(r.destinationBonus.bonusMembers)}</div>
        <div style="font-size:7px;color:var(--gray2)">catchment 10km</div>
      </div>` : ''}
    </div>

    <div style="background:var(--bg);border-radius:8px;padding:10px;margin-bottom:10px">
      <div style="font-size:9px;font-weight:700;color:var(--accent);margin-bottom:6px">WATERFALL — Décomposition captage</div>
      <div style="position:relative;height:140px;width:100%;margin-bottom:4px"><canvas id="waterfallChart"></canvas></div>
      <div style="font-size:7px;color:var(--gray2)">Captifs ${Math.round(r.totalCaptifs/r.totalTheorique*100)}% | Natifs ${Math.round(r.native.captured/r.totalTheorique*100)}% | Walk-in ${Math.round(r.walkIn.walkInMembers/r.totalTheorique*100)}% du total</div>
    </div>

    <div style="background:var(--bg);border-radius:8px;padding:10px;margin-bottom:10px">
      <div style="font-size:9px;font-weight:700;color:var(--cyan);margin-bottom:6px">SCENARIOS</div>
      <div class="metric-row" style="color:var(--red)"><span class="metric-label">Pessimiste (x0.6)</span><span class="metric-value">${fmt(r.pessimiste)} mbr</span></div>
      <div class="metric-row" style="color:var(--yellow)"><span class="metric-label"><b>Realiste</b></span><span class="metric-value" style="font-weight:800">${fmt(r.realiste)} mbr</span></div>
      <div class="metric-row" style="color:var(--green)"><span class="metric-label">Optimiste (x1.4)</span><span class="metric-value">${fmt(r.optimiste)} mbr</span></div>
      <div class="metric-row"><span class="metric-label">Breakeven A1 (2,800)</span><span class="metric-value" style="color:${r.breakeven2800==='OUI'?'var(--green)':r.breakeven2800==='POSSIBLE'?'var(--yellow)':'var(--red)'};font-weight:700">${r.breakeven2800}</span></div>
      <div class="metric-row"><span class="metric-label">Objectif maturite (4,000)</span><span class="metric-value" style="color:${r.breakeven4000==='OUI'?'var(--green)':r.breakeven4000==='POSSIBLE'?'var(--yellow)':'var(--red)'};font-weight:700">${r.breakeven4000}</span></div>
    </div>

    <div style="background:var(--bg);border-radius:8px;padding:10px;margin-bottom:10px">
      <div style="font-size:9px;font-weight:700;color:var(--purple);margin-bottom:6px">SEGMENTATION PERSONAS — Mix zone</div>
      <div style="display:flex;gap:4px;margin-bottom:8px">
        ${Object.entries(r.personaMix).map(([key, pct]) => {
          const p = PERSONAS[key];
          return `<div style="flex:1;background:${p.color}15;border:1px solid ${p.color}30;border-radius:6px;padding:5px;text-align:center">
            <div style="font-size:8px;font-weight:700;color:${p.color}">${p.label}</div>
            <div style="font-size:16px;font-weight:900;color:${p.color}">${Math.round(pct*100)}%</div>
            <div style="font-size:7px;color:var(--gray2)">ARPU ×${p.arpuMult} | Churn Y1:${(p.churnY1*100).toFixed(1)}% → Y2+:${(p.churn*100).toFixed(1)}%</div>
          </div>`;
        }).join('')}
      </div>
      <div class="metric-row"><span class="metric-label">ARPU blended (HT)</span><span class="metric-value" style="font-weight:700;color:var(--cyan)">${r.arpu.toFixed(2)} EUR/mois</span></div>
      <div class="metric-row"><span class="metric-label">Churn blended</span><span class="metric-value">Y1: ${(r.churnY1*100).toFixed(1)}%/mois → Y2+: ${(r.churnRate*100).toFixed(1)}%/mois (${Math.round((1-Math.pow(1-r.churnRate,12))*100)}%/an) + spike renouvellement annuel ${(RENEWAL_CHURN_SPIKE*100).toFixed(0)}%</span></div>
      <div class="metric-row"><span class="metric-label">LTV</span><span class="metric-value" style="color:var(--green);font-weight:700">${fmt(r.ltv)} EUR</span></div>
      <div class="metric-row"><span class="metric-label">LTV/CAC ratio</span><span class="metric-value" style="color:${r.ltvCacRatio>=10?'var(--green)':r.ltvCacRatio>=5?'var(--yellow)':'var(--red)'};font-weight:700">${r.ltvCacRatio}x</span></div>
      <div style="font-size:7px;color:var(--gray2);margin-top:4px">Source: INS Recensământ 2021 (pop. par âge × secteur) | Prix quartier: ${r.avgQuartierPrice} EUR/m2 | CAC: ${r.cac} EUR</div>
    </div>

    <div style="background:var(--bg);border-radius:8px;padding:10px;margin-bottom:10px">
      <div style="font-size:9px;font-weight:700;color:var(--purple);margin-bottom:6px">PROJECTION 5 ANS — 3 Scenarios (calibre FP Espagne)</div>
      <div style="position:relative;height:180px;width:100%;margin-bottom:8px"><canvas id="bassChart"></canvas></div>
      <div style="display:flex;gap:8px;margin-bottom:6px">
        ${Object.entries(SCENARIOS).map(([k,sc]) => `<div style="font-size:8px;color:${sc.color}">● ${sc.label}</div>`).join('')}
        <div style="font-size:8px;color:var(--gray2)">- - Net churn</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;font-size:9px">
        ${Object.entries(SCENARIOS).map(([key, sc]) => {
          const cohort = r.scenarios[key].cohort;
          return `<div style="background:var(--bg2);border-radius:4px;padding:4px 6px;border-top:2px solid ${sc.color}">
            <div style="color:${sc.color};font-size:7px;font-weight:700">${sc.label.toUpperCase()}</div>
            <div style="color:var(--gray2);font-size:7px;margin-bottom:3px">${sc.sublabel}</div>
            <div class="metric-row"><span class="metric-label">M12</span><span class="metric-value">${fmt(cohort[11]?.netMembers||0)}</span></div>
            <div class="metric-row"><span class="metric-label">M24</span><span class="metric-value">${fmt(cohort[23]?.netMembers||0)}</span></div>
            <div class="metric-row"><span class="metric-label">M36</span><span class="metric-value">${fmt(cohort[35]?.netMembers||0)}</span></div>
            <div class="metric-row"><span class="metric-label">M60</span><span class="metric-value" style="font-weight:700;color:${sc.color}">${fmt(cohort[59]?.netMembers||0)}</span></div>
          </div>`;
        }).join('')}
      </div>
      <div style="font-size:7px;color:var(--gray2);margin-top:6px;line-height:1.4">
        ${Object.entries(SCENARIOS).map(([k,sc]) => `<b style="color:${sc.color}">${sc.label}</b>: ${sc.desc}`).join('<br>')}
      </div>
    </div>

    <div style="background:linear-gradient(135deg,rgba(212,160,23,.08),rgba(212,160,23,.02));border:1px solid rgba(212,160,23,.25);border-radius:8px;padding:10px;margin-bottom:10px">
      <div style="font-size:9px;font-weight:700;color:#d4a017;margin-bottom:8px">⚙ HYPOTHESES MODIFIABLES — Impact BP en direct</div>
      <div style="font-size:7px;color:var(--gray2);margin-bottom:8px">Modifiez les valeurs ci-dessous pour recalculer le Business Plan en temps reel. Sauvegarde automatique.</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px">
        <div>
          <label style="font-size:8px;font-weight:700;color:var(--gray);display:block;margin-bottom:2px">Prix Standard TTC (EUR)</label>
          <input id="inputPriceBase" type="number" step="0.5" min="15" max="60" value="${USER_PARAMS.priceBaseTTC}" style="width:100%;padding:5px 8px;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--white);font-size:13px;font-weight:700;font-family:var(--font)" onchange="updateUserParam('priceBaseTTC',this.value)">
        </div>
        <div>
          <label style="font-size:8px;font-weight:700;color:var(--gray);display:block;margin-bottom:2px">Taux VAD (%) — <span id="vadLabel">${Math.round(TAUX_VAD*100)}%</span></label>
          <input id="inputVAD" type="range" min="5" max="50" step="1" value="${Math.round(TAUX_VAD*100)}" style="width:100%;accent-color:var(--accent);cursor:pointer" oninput="TAUX_VAD=this.value/100;document.getElementById('vadLabel').textContent=this.value+'%';updateParamSummary();if(window._lastCaptageLocation){const{lat,lng,radius}=window._lastCaptageLocation;if(el('captageContent')&&el('captageContent').innerHTML)renderCaptageAnalysis('captageContent',lat,lng,radius);}">
          <div style="display:flex;justify-content:space-between;font-size:7px;color:var(--gray2);margin-top:1px"><span>5%</span><span>Prem+Ulti</span><span>50%</span></div>
        </div>
        <div>
          <label style="font-size:8px;font-weight:700;color:var(--gray);display:block;margin-bottom:2px">Prix Premium TTC (EUR)</label>
          <input id="inputPricePremium" type="number" step="0.5" min="20" max="80" value="${USER_PARAMS.pricePremiumTTC}" style="width:100%;padding:5px 8px;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--white);font-size:12px;font-family:var(--font)" onchange="updateUserParam('pricePremiumTTC',this.value)">
        </div>
        <div>
          <label style="font-size:8px;font-weight:700;color:var(--gray);display:block;margin-bottom:2px">Prix Ultimate TTC (EUR)</label>
          <input id="inputPriceUltimate" type="number" step="0.5" min="25" max="100" value="${USER_PARAMS.priceUltimateTTC}" style="width:100%;padding:5px 8px;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--white);font-size:12px;font-family:var(--font)" onchange="updateUserParam('priceUltimateTTC',this.value)">
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-top:1px solid rgba(212,160,23,.15)">
        <div id="paramSummary" style="font-size:8px;color:var(--gray2)">ARPU: <b style="color:var(--cyan)">${getPanierMoyenHT().toFixed(2)} EUR HT</b> (${100-Math.round(TAUX_VAD*100)}% × ${USER_PARAMS.priceBaseTTC}€ + ${Math.round(TAUX_VAD*100)}% × avg(${USER_PARAMS.pricePremiumTTC}+${USER_PARAMS.priceUltimateTTC})€ TTC) | Loyer Y1: <b style="color:var(--yellow)">${fmt(getSteppedRentMonthly(1,'objectifNego'))}/mois</b></div>
        <button onclick="resetUserParams()" style="font-size:8px;padding:2px 8px;background:transparent;border:1px solid var(--border);border-radius:4px;color:var(--gray2);cursor:pointer;font-family:var(--font)">Reset</button>
      </div>
    </div>

    <div style="background:var(--bg);border-radius:8px;padding:10px;margin-bottom:10px">
      <div style="font-size:9px;font-weight:700;color:var(--green);margin-bottom:6px">P&L / MODELE FINANCIER 5 ANS — Calibre BP V17</div>
      <div style="position:relative;height:160px;width:100%;margin-bottom:8px"><canvas id="pnlChart"></canvas></div>
      <div style="display:flex;gap:8px;margin-bottom:8px">
        ${Object.entries(SCENARIOS).map(([k,sc]) => `<div style="font-size:8px;color:${sc.color}">● ${sc.label}</div>`).join('')}
        <div style="font-size:8px;color:var(--gray2)">- - Breakeven</div>
      </div>
      <div id="pnl-grid" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;margin-bottom:8px">
        ${Object.entries(SCENARIOS).map(([key, sc]) => {
          const p = r.pnl[key];
          return `<div style="background:var(--bg2);border-radius:4px;padding:4px 6px;font-size:9px;border-top:2px solid ${sc.color}">
            <div style="color:${sc.color};font-size:7px;font-weight:700;margin-bottom:3px">${sc.label.toUpperCase()}</div>
            ${p.annualCA.map((ca,i) => `<div class="metric-row"><span class="metric-label">A${i+1} CA</span><span class="metric-value" id="pnl-ca${i+1}-${key}">${fmt(Math.round(ca/1000))}k</span></div>`).join('')}
            <div style="margin-top:4px;padding-top:4px;border-top:1px solid rgba(71,85,115,.15)">
              ${(p.annualEBITDA || []).map((eb,i) => {
                const ca = p.annualCA?.[i] || 0;
                const m = ca > 0 ? Math.round(eb / ca * 100) : 0;
                const col = eb < 0 ? 'var(--red)' : m >= 35 ? 'var(--green)' : m >= 20 ? 'var(--yellow)' : 'var(--gray)';
                return `<div class="metric-row"><span class="metric-label">A${i+1} EBITDA</span><span class="metric-value" id="pnl-ebitda${i+1}-${key}" style="color:${col}">${fmt(Math.round(eb/1000))}k <span style="color:var(--gray2);font-weight:500">(${m}%)</span></span></div>`;
              }).join('')}
            </div>
            <div style="margin-top:4px;padding-top:4px;border-top:1px solid rgba(71,85,115,.15)">
              <div class="metric-row"><span class="metric-label">Breakeven</span><span class="metric-value" id="pnl-be-${key}" style="color:${p.breakevenMonth?'var(--green)':'var(--red)'}">${p.breakevenMonth?'M'+p.breakevenMonth:'N/A'}</span></div>
              <div class="metric-row"><span class="metric-label">Payback</span><span class="metric-value" id="pnl-pb-${key}" style="color:${p.paybackMonth?'var(--green)':'var(--red)'}">${p.paybackMonth?'M'+p.paybackMonth:'>60M'}</span></div>
              <div class="metric-row"><span class="metric-label">IRR</span><span class="metric-value" id="pnl-irr-${key}" style="color:${p.irr>15?'var(--green)':p.irr>8?'var(--yellow)':'var(--red)'}"><b>${p.irr}%</b></span></div>
              <div class="metric-row"><span class="metric-label">NPV</span><span class="metric-value" id="pnl-npv-${key}" style="color:${p.npv>0?'var(--green)':'var(--red)'}">${fmt(Math.round(p.npv/1000))}k</span></div>
            </div>
          </div>`;
        }).join('')}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;margin-bottom:6px">
        <div style="background:var(--bg2);border-radius:4px;padding:6px;text-align:center">
          <div style="font-size:7px;color:var(--gray2)">CAPEX</div>
          <div style="font-size:14px;font-weight:800;color:var(--red)">${fmt(Math.round(r.pnl.base.capex/1000))}k</div>
        </div>
        <div style="background:var(--bg2);border-radius:4px;padding:6px;text-align:center">
          <div style="font-size:7px;color:var(--gray2)">LOYER/MOIS</div>
          <div id="pnl-loyer-box" style="font-size:14px;font-weight:800;color:var(--yellow)">${fmt(r.pnl.base.rent)}</div>
        </div>
        <div style="background:var(--bg2);border-radius:4px;padding:6px;text-align:center">
          <div style="font-size:7px;color:var(--gray2)">OPEX FIXE/MOIS</div>
          <div style="font-size:14px;font-weight:800;color:var(--gray)">${fmt(r.pnl.base.fixedOpex)}</div>
        </div>
      </div>
      <div style="font-size:7px;color:var(--gray2);line-height:1.4">
        CAPEX ${fmt(Math.round(PNL_DEFAULTS.capex/1000))}k + Leasing ${fmt(Math.round(PNL_DEFAULTS.leasingAnnual/1000))}k/an (5 ans) | Staff 3 ETP plug ${fmt(Math.round(PNL_DEFAULTS.staffFloorAnnual/1000))}k A1 (+${Math.round((PNL_DEFAULTS.staff?.inflationRate||0.06)*100)}%/an) | OPEX Ops ${Math.round(PNL_DEFAULTS.opexOpsRateByYear[0]*100)}%→${Math.round(PNL_DEFAULTS.opexOpsRateByYear[4]*100)}% CA | Redev ${Math.round(PNL_DEFAULTS.redevanceRate*100)}%+${Math.round(PNL_DEFAULTS.fondsPubRate*100)}% | CIT ${Math.round(PNL_DEFAULTS.citRate*100)}% | WACC ${Math.round(PNL_DEFAULTS.discountRate*100)}%
      </div>
      <div id="pnl-ref-delta" style="font-size:8px;margin-top:6px;padding:6px 8px;background:var(--bg2);border-radius:5px;line-height:1.5"></div>
      <div id="pnl-breakeven-block" style="margin-top:8px"></div>
      <div id="rent-block" style="background:#fbbf2410;border:1px solid #fbbf2430;border-radius:6px;padding:8px;margin-top:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <div style="font-size:8px;font-weight:700;color:var(--accent)">LOYER — Ajustable en direct (${PNL_DEFAULTS.rentSteps.surface} m²)</div>
          <div style="font-size:9px;font-weight:800;color:var(--accent)" id="rent-slider-label">${(window._rentOverride?.y1 || PNL_DEFAULTS.rentSteps.objectifNego[0].rent).toFixed(1)}€/m²</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span style="font-size:7px;color:var(--gray2)">5€</span>
          <input id="rentSlider" type="range" min="5" max="25" step="0.5" value="${window._rentOverride?.y1 || PNL_DEFAULTS.rentSteps.objectifNego[0].rent}" style="flex:1;accent-color:var(--accent);height:5px;cursor:pointer" oninput="onRentSliderChange(this.value)">
          <span style="font-size:7px;color:var(--gray2)">25€</span>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:6px">
          <div style="flex:1;background:var(--bg);border-radius:4px;padding:4px;text-align:center">
            <div style="font-size:7px;color:var(--gray2)">Y1-Y2</div>
            <div id="rent-y1-sqm" style="font-size:10px;font-weight:700;color:var(--green)">${getRentSteps('objectifNego')[0].rent}€/m²</div>
            <div id="rent-y1-monthly" style="font-size:7px;color:var(--gray2)">${fmt(getSteppedRentMonthly(1,'objectifNego'))}/mois</div>
          </div>
          <div style="flex:1;background:var(--bg);border-radius:4px;padding:4px;text-align:center">
            <div style="font-size:7px;color:var(--gray2)">Y3-Y4</div>
            <div id="rent-y3-sqm" style="font-size:10px;font-weight:700;color:var(--yellow)">${getRentSteps('objectifNego')[1].rent}€/m²</div>
            <div id="rent-y3-monthly" style="font-size:7px;color:var(--gray2)">${fmt(getSteppedRentMonthly(3,'objectifNego'))}/mois</div>
          </div>
          <div style="flex:1;background:var(--bg);border-radius:4px;padding:4px;text-align:center">
            <div style="font-size:7px;color:var(--gray2)">Y5+</div>
            <div id="rent-y5-sqm" style="font-size:10px;font-weight:700;color:var(--orange)">${getRentSteps('objectifNego')[2].rent}€/m²</div>
            <div id="rent-y5-monthly" style="font-size:7px;color:var(--gray2)">${fmt(getSteppedRentMonthly(5,'objectifNego'))}/mois</div>
          </div>
        </div>
        <div id="rent-footer" style="font-size:7px;color:var(--gray2)">
          Charges: ${PNL_DEFAULTS.rentSteps.serviceCharge}€/m² + Marketing: ${PNL_DEFAULTS.rentSteps.marketingFee}€/m² | Indexation HICP ~${(PNL_DEFAULTS.rentSteps.indexation*100).toFixed(0)}%/an
          ${r.pnl.base.irrOffreInitiale !== null ? `<br><span id="rent-offre-delta" style="color:var(--orange)">⚠ Si offre initiale bailleur (${PNL_DEFAULTS.rentSteps.offerInitiale[0].rent}→${PNL_DEFAULTS.rentSteps.offerInitiale[1].rent}→${PNL_DEFAULTS.rentSteps.offerInitiale[2].rent}€/m²) : IRR = ${r.pnl.base.irrOffreInitiale.toFixed(1)}% vs ${r.pnl.base.irr.toFixed(1)}% objectif négo → delta ${(r.pnl.base.irr - r.pnl.base.irrOffreInitiale).toFixed(1)} pts</span>` : ''}
        </div>

        <!-- v6.33: sliders charges + surface (parité mobile ↔ desktop) -->
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;margin-top:10px;padding-top:8px;border-top:1px solid rgba(212,160,23,.15)">
          <div style="font-size:8px;font-weight:700;color:var(--accent)">CHARGES + MARKETING €/m²</div>
          <div style="font-size:9px;font-weight:800;color:var(--accent)" id="charge-slider-label">${(window._chargeOverride?.chargeTotal ?? (PNL_DEFAULTS.rentSteps.serviceCharge + PNL_DEFAULTS.rentSteps.marketingFee)).toFixed(1)}€/m²</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span style="font-size:7px;color:var(--gray2)">0€</span>
          <input id="chargeSlider" type="range" min="0" max="12" step="0.5" value="${window._chargeOverride?.chargeTotal ?? (PNL_DEFAULTS.rentSteps.serviceCharge + PNL_DEFAULTS.rentSteps.marketingFee)}" style="flex:1;accent-color:var(--accent);height:5px;cursor:pointer" oninput="onChargeSliderChange(this.value)">
          <span style="font-size:7px;color:var(--gray2)">12€</span>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;margin-top:8px">
          <div style="font-size:8px;font-weight:700;color:var(--accent)">SURFACE m²</div>
          <div style="font-size:9px;font-weight:800;color:var(--accent)" id="surface-slider-label">${window._surfaceOverride?.surface ?? PNL_DEFAULTS.rentSteps.surface} m²</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <span style="font-size:7px;color:var(--gray2)">800</span>
          <input id="surfaceSlider" type="range" min="800" max="2500" step="50" value="${window._surfaceOverride?.surface ?? PNL_DEFAULTS.rentSteps.surface}" style="flex:1;accent-color:var(--accent);height:5px;cursor:pointer" oninput="onSurfaceSliderChange(this.value)">
          <span style="font-size:7px;color:var(--gray2)">2500</span>
        </div>
      </div>

      <!-- v6.67: FINANCEMENT — toggle dette bancaire + structure + KPIs investisseur -->
      ${(() => {
        const f = getEffectiveFinancing();
        const on = f.enabled !== false && f.loanRatio > 0;
        const pb = r.pnl.base;
        const kEUR = v => fmt(Math.round((v||0)/1000)) + 'k';
        return `
      <div id="financing-block" style="background:#3b82f610;border:1px solid #3b82f630;border-radius:6px;padding:8px;margin-top:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div style="font-size:8px;font-weight:700;color:#60a5fa">💰 FINANCEMENT — Dette bancaire (global, tous sites)</div>
          <label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:8px;color:var(--gray)" title="Coché = 100% fonds propres (aucun emprunt, les réglages de prêt se désactivent). Décoché = financement par dette.">
            <input id="finEquityToggle" type="checkbox" ${on ? '' : 'checked'} onchange="onEquityOnlyToggle(this.checked)" style="accent-color:#34d399;cursor:pointer">
            <span style="font-weight:700;color:${on ? 'var(--gray2)' : '#34d399'}">100% EQUITY</span>
          </label>
        </div>
        <div id="fin-sliders-wrap" style="opacity:${on ? '1' : '.35'}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <div style="font-size:8px;color:var(--gray)">Apport / Dette</div>
            <div id="fin-equity-label" style="font-size:9px;font-weight:800;color:#60a5fa">${Math.round(f.equityRatio*100)}% / ${Math.round(f.loanRatio*100)}%</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <span style="font-size:7px;color:var(--gray2)">10%</span>
            <input id="finEquitySlider" type="range" min="10" max="100" step="5" value="${Math.round(f.equityRatio*100)}" ${on ? '' : 'disabled'} style="flex:1;accent-color:#60a5fa;height:5px;cursor:pointer" oninput="onFinEquitySlider(this.value)">
            <span style="font-size:7px;color:var(--gray2)">100%</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <div style="font-size:8px;color:var(--gray)">Taux d'intérêt annuel</div>
            <div id="fin-rate-label" style="font-size:9px;font-weight:800;color:#60a5fa">${(f.loanRate*100).toFixed(2)}%</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <span style="font-size:7px;color:var(--gray2)">0.5%</span>
            <input id="finRateSlider" type="range" min="0.5" max="12" step="0.25" value="${(f.loanRate*100).toFixed(2)}" ${on ? '' : 'disabled'} style="flex:1;accent-color:#60a5fa;height:5px;cursor:pointer" oninput="onFinRateSlider(this.value)">
            <span style="font-size:7px;color:var(--gray2)">12%</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <div style="font-size:8px;color:var(--gray)">Durée d'amortissement</div>
            <div id="fin-term-label" style="font-size:9px;font-weight:800;color:#60a5fa">${f.loanTermYears} ans</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <span style="font-size:7px;color:var(--gray2)">3</span>
            <input id="finTermSlider" type="range" min="3" max="15" step="1" value="${f.loanTermYears}" ${on ? '' : 'disabled'} style="flex:1;accent-color:#60a5fa;height:5px;cursor:pointer" oninput="onFinTermSlider(this.value)">
            <span style="font-size:7px;color:var(--gray2)">15</span>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:4px;margin-bottom:6px">
          <div style="background:var(--bg);border-radius:4px;padding:5px;text-align:center">
            <div style="font-size:6.5px;color:var(--gray2)">EQUITY</div>
            <div id="fin-kpi-equity" style="font-size:10px;font-weight:800;color:#34d399">${kEUR(pb.equity)}</div>
          </div>
          <div style="background:var(--bg);border-radius:4px;padding:5px;text-align:center">
            <div style="font-size:6.5px;color:var(--gray2)">DETTE</div>
            <div id="fin-kpi-loan" style="font-size:10px;font-weight:800;color:#60a5fa">${pb.loanPrincipal > 0 ? kEUR(pb.loanPrincipal) : '—'}</div>
          </div>
          <div style="background:var(--bg);border-radius:4px;padding:5px;text-align:center">
            <div style="font-size:6.5px;color:var(--gray2)">MENSUALITÉ</div>
            <div id="fin-kpi-pmt" style="font-size:10px;font-weight:800;color:var(--white)">${pb.loanMonthlyPayment > 0 ? fmt(pb.loanMonthlyPayment)+'/mois' : '—'}</div>
          </div>
          <div style="background:var(--bg);border-radius:4px;padding:5px;text-align:center">
            <div style="font-size:6.5px;color:var(--gray2)">INTÉRÊTS TOT.</div>
            <div id="fin-kpi-interest" style="font-size:10px;font-weight:800;color:#f87171">${pb.totalInterest > 0 ? kEUR(pb.totalInterest) : '—'}</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;margin-bottom:4px">
          <div style="background:var(--bg);border-radius:4px;padding:5px;text-align:center">
            <div style="font-size:6.5px;color:var(--gray2)">IRR PROJET</div>
            <div id="fin-kpi-irrproj" style="font-size:11px;font-weight:800">${pb.irr}%</div>
          </div>
          <div style="background:var(--bg);border-radius:4px;padding:5px;text-align:center;border:1px solid rgba(212,160,23,.3)">
            <div style="font-size:6.5px;color:var(--accent);font-weight:700">IRR EQUITY ⭐</div>
            <div id="fin-kpi-irreq" style="font-size:11px;font-weight:800">${pb.irrEquity}%</div>
          </div>
          <div style="background:var(--bg);border-radius:4px;padding:5px;text-align:center">
            <div style="font-size:6.5px;color:var(--gray2)" title="Net Free Cash Flow to Equity cumulé 5 ans (avant IS, hors TV)">FCFE 5 ANS</div>
            <div id="fin-kpi-fcfe" style="font-size:11px;font-weight:800">${kEUR(pb.fcfe5y)}</div>
          </div>
          <div style="background:var(--bg);border-radius:4px;padding:5px;text-align:center">
            <div style="font-size:6.5px;color:var(--gray2)" title="Debt Service Coverage Ratio minimum en années de croisière (A2+) — banque exige ≥ 1.2. A1 ramp-up exclu (EBITDA négatif structurel).">DSCR (A2+)</div>
            <div id="fin-kpi-dscr" style="font-size:11px;font-weight:800">${pb.dscrMinCruise != null ? pb.dscrMinCruise.toFixed(2)+'×' : 'n/a'}</div>
          </div>
          <div style="background:var(--bg);border-radius:4px;padding:5px;text-align:center">
            <div style="font-size:6.5px;color:var(--gray2)" title="Multiple sur equity investie à 5 ans avec valeur de sortie (8× EBITDA A5)">MOIC 5A</div>
            <div id="fin-kpi-moic" style="font-size:11px;font-weight:800">${pb.moic != null ? pb.moic.toFixed(1)+'×' : 'n/a'}</div>
          </div>
          <div style="background:var(--bg);border-radius:4px;padding:5px;text-align:center">
            <div style="font-size:6.5px;color:var(--gray2)" title="Mois où le cumul FCFE devient positif (récupération de l'apport)">PAYBACK EQUITY</div>
            <div id="fin-kpi-pbeq" style="font-size:11px;font-weight:800">${pb.paybackEquityMonth ? 'M'+pb.paybackEquityMonth : '>60M'}</div>
          </div>
        </div>
        <div style="font-size:7px;color:var(--gray2);line-height:1.4">
          Référence BP: ${Math.round(PNL_DEFAULTS.financing.equityRatio*100)}% equity / ${Math.round(PNL_DEFAULTS.financing.loanRatio*100)}% dette @ ${(PNL_DEFAULTS.financing.loanRate*100).toFixed(1)}% sur ${PNL_DEFAULTS.financing.loanTermYears} ans (SG garantie BPI). FCFE = EBITDA − leasing − service dette (avant IS). Chaque réglage est journalisé avec son impact (📋 Journal).
        </div>
        <button onclick="FcfStudio.open()" style="width:100%;margin-top:8px;padding:9px;border-radius:7px;background:linear-gradient(135deg,rgba(96,165,250,.2),rgba(52,211,153,.15));border:1px solid rgba(96,165,250,.4);color:var(--white);font-size:10px;font-weight:800;cursor:pointer;font-family:var(--font)" title="Comparer 2 scénarios de cash flow côte à côte (dette, CAPEX, loyer, sortie…) — la Référence BP reste inviolable">
          ⚖️ STUDIO FCF — comparer des scénarios (dette, CAPEX, sortie…)
        </button>
      </div>`;
      })()}
    </div>

    <div style="background:linear-gradient(135deg,rgba(212,160,23,.07),rgba(16,185,129,.04));border:1px solid rgba(212,160,23,.3);border-radius:8px;padding:12px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;gap:8px">
        <div style="min-width:0;flex:1">
          <div style="font-size:10px;font-weight:800;color:var(--accent);letter-spacing:0.5px">🏦 BP DU SITE — 2 SCÉNARIOS</div>
          <div style="font-size:8px;color:var(--gray2);margin-top:2px">BP Franchise (cible ${fmt(3600)} mbr) vs Projection outil (${fmt(r.realiste)} mbr) — loyer/charges/surface du site appliqués aux deux</div>
        </div>
        <button onclick="BPSiteUI.openFullscreen()" style="font-size:8px;padding:5px 10px;background:transparent;border:1px solid var(--accent);border-radius:5px;color:var(--accent);cursor:pointer;font-family:var(--font);font-weight:700;flex-shrink:0;white-space:nowrap">⛶ Agrandir</button>
      </div>
      <div id="bpSiteContent">
        <div style="padding:16px;color:var(--gray2);font-size:9px;text-align:center">Initialisation du moteur BP…</div>
      </div>
    </div>

    <div style="background:var(--bg);border-radius:8px;padding:10px;margin-bottom:10px">
      <div style="font-size:9px;font-weight:700;color:var(--accent);margin-bottom:6px">BRIDGE CA ANNUEL — 3 Scénarios (k€)</div>
      <div style="position:relative;height:140px;width:100%;margin-bottom:4px"><canvas id="revenueBridgeChart"></canvas></div>
    </div>

    <div style="background:var(--bg);border-radius:8px;padding:10px;margin-bottom:10px">
      <div style="font-size:9px;font-weight:700;color:#f97316;margin-bottom:8px">SENSIBILITE — Tornado Chart (scenario Base)</div>
      <div style="font-size:8px;color:var(--gray2);margin-bottom:8px">Impact sur l'IRR (${r.sensitivity.baseIRR}% base) quand chaque variable est modifiee ±</div>
      ${r.sensitivity.params.map(p => {
        const maxSpread = Math.max(...r.sensitivity.params.map(x=>x.irrSpread));
        const barScale = maxSpread > 0 ? 100 / maxSpread : 1;
        // For inverse params: low value = high IRR (green on left), high value = low IRR (red on right)
        // For direct params: low value = low IRR (red on left), high value = high IRR (green on right)
        const leftIRR = p.isInverse ? p.irrHigh : p.irrLow;
        const rightIRR = p.isInverse ? p.irrLow : p.irrHigh;
        const leftLabel = p.isInverse ? '+'+Math.round(p.pctRange*100)+'%' : '-'+Math.round(p.pctRange*100)+'%';
        const rightLabel = p.isInverse ? '-'+Math.round(p.pctRange*100)+'%' : '+'+Math.round(p.pctRange*100)+'%';
        const leftDelta = leftIRR - r.sensitivity.baseIRR;
        const rightDelta = rightIRR - r.sensitivity.baseIRR;
        const leftW = Math.abs(leftDelta) * barScale;
        const rightW = Math.abs(rightDelta) * barScale;
        const leftColor = leftDelta < 0 ? '#ef4444' : '#34d399';
        const rightColor = rightDelta < 0 ? '#ef4444' : '#34d399';
        return `<div style="display:flex;align-items:center;gap:4px;margin-bottom:4px;font-size:9px">
          <div style="width:80px;text-align:right;color:var(--gray2);flex-shrink:0;font-size:8px">${p.label}</div>
          <div style="flex:1;display:flex;align-items:center;height:18px;position:relative">
            <div style="position:absolute;left:50%;top:0;bottom:0;width:1px;background:var(--gray2)40"></div>
            <div style="width:50%;display:flex;justify-content:flex-end;padding-right:2px">
              <div style="height:14px;width:${Math.min(leftW,48)}%;background:${leftColor};border-radius:2px 0 0 2px;display:flex;align-items:center;justify-content:flex-start;padding-left:3px">
                <span style="font-size:7px;color:white;white-space:nowrap">${leftDelta>0?'+':''}${leftDelta.toFixed(1)}%</span>
              </div>
            </div>
            <div style="width:50%;display:flex;justify-content:flex-start;padding-left:2px">
              <div style="height:14px;width:${Math.min(rightW,48)}%;background:${rightColor};border-radius:0 2px 2px 0;display:flex;align-items:center;justify-content:flex-end;padding-right:3px">
                <span style="font-size:7px;color:white;white-space:nowrap">${rightDelta>0?'+':''}${rightDelta.toFixed(1)}%</span>
              </div>
            </div>
          </div>
          <div style="width:25px;text-align:left;color:var(--gray2);font-size:7px;flex-shrink:0">±${Math.round(p.pctRange*100)}%</div>
        </div>`;
      }).join('')}
      <div style="display:flex;justify-content:space-between;font-size:7px;color:var(--gray2);margin-top:6px;padding:0 84px 0 84px">
        <span style="color:#ef4444">← Defavorable</span>
        <span>Base: ${r.sensitivity.baseIRR}%</span>
        <span style="color:#34d399">Favorable →</span>
      </div>
      <div style="font-size:7px;color:var(--gray2);margin-top:6px;line-height:1.4">
        Variable la plus impactante: <b style="color:var(--white)">${r.sensitivity.params[0]?.label}</b> (swing IRR: ${r.sensitivity.params[0]?.irrSpread.toFixed(1)}pp)
        ${r.sensitivity.params[1] ? '| 2e: <b style="color:var(--white)">'+r.sensitivity.params[1].label+'</b> ('+r.sensitivity.params[1].irrSpread.toFixed(1)+'pp)' : ''}
      </div>
    </div>

    <div style="background:linear-gradient(135deg,rgba(139,92,246,.08),rgba(139,92,246,.02));border:1px solid rgba(139,92,246,.25);border-radius:8px;padding:10px;margin-bottom:10px">
      <div style="font-size:9px;font-weight:700;color:#8b5cf6;margin-bottom:8px">MONTE CARLO — Stress Test Probabiliste (${r.monteCarlo.iterations} simulations)</div>
      <div style="font-size:7px;color:var(--gray2);margin-bottom:8px">Perturbation aleatoire de 7 variables cles (captage, ARPU, churn, CAPEX, loyer, OPEX, ramp-up) — distribution gaussienne</div>

      <div style="position:relative;height:130px;width:100%;margin-bottom:8px"><canvas id="mcHistogram"></canvas></div>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;margin-bottom:8px">
        <div style="background:var(--bg);border-radius:4px;padding:6px;text-align:center">
          <div style="font-size:7px;color:var(--gray2)">P(IRR > 0%)</div>
          <div style="font-size:18px;font-weight:900;color:${r.monteCarlo.probPositiveIRR>=90?'#10b981':r.monteCarlo.probPositiveIRR>=70?'#fbbf24':'#ef4444'}">${r.monteCarlo.probPositiveIRR}%</div>
          <div style="font-size:7px;color:var(--gray2)">projet rentable</div>
        </div>
        <div style="background:var(--bg);border-radius:4px;padding:6px;text-align:center">
          <div style="font-size:7px;color:var(--gray2)">P(IRR > 15%)</div>
          <div style="font-size:18px;font-weight:900;color:${r.monteCarlo.probIRR15>=70?'#10b981':r.monteCarlo.probIRR15>=40?'#fbbf24':'#ef4444'}">${r.monteCarlo.probIRR15}%</div>
          <div style="font-size:7px;color:var(--gray2)">objectif investisseur</div>
        </div>
        <div style="background:var(--bg);border-radius:4px;padding:6px;text-align:center">
          <div style="font-size:7px;color:var(--gray2)">P(Payback ≤ 36M)</div>
          <div style="font-size:18px;font-weight:900;color:${r.monteCarlo.probPayback36>=70?'#10b981':r.monteCarlo.probPayback36>=40?'#fbbf24':'#ef4444'}">${r.monteCarlo.probPayback36}%</div>
          <div style="font-size:7px;color:var(--gray2)">retour en 3 ans</div>
        </div>
      </div>

      <div style="background:var(--bg);border-radius:6px;padding:8px;margin-bottom:6px">
        <div style="font-size:8px;font-weight:700;color:var(--gray);margin-bottom:4px">DISTRIBUTION IRR (percentiles)</div>
        <div style="display:flex;align-items:center;gap:2px;height:20px;margin-bottom:4px">
          <div style="font-size:7px;color:var(--red);width:35px;text-align:right">${r.monteCarlo.irr.p5}%</div>
          <div style="flex:1;position:relative;height:14px;background:var(--bg2);border-radius:3px;overflow:hidden">
            <div style="position:absolute;left:${Math.max(0,Math.min(100,(r.monteCarlo.irr.p5-r.monteCarlo.irr.min)/(r.monteCarlo.irr.max-r.monteCarlo.irr.min)*100))}%;right:${Math.max(0,100-(r.monteCarlo.irr.p95-r.monteCarlo.irr.min)/(r.monteCarlo.irr.max-r.monteCarlo.irr.min)*100)}%;top:0;bottom:0;background:rgba(139,92,246,.25);border-radius:3px"></div>
            <div style="position:absolute;left:${Math.max(0,Math.min(100,(r.monteCarlo.irr.p25-r.monteCarlo.irr.min)/(r.monteCarlo.irr.max-r.monteCarlo.irr.min)*100))}%;right:${Math.max(0,100-(r.monteCarlo.irr.p75-r.monteCarlo.irr.min)/(r.monteCarlo.irr.max-r.monteCarlo.irr.min)*100)}%;top:2px;bottom:2px;background:rgba(139,92,246,.5);border-radius:2px"></div>
            <div style="position:absolute;left:${Math.max(0,Math.min(98,(r.monteCarlo.irr.p50-r.monteCarlo.irr.min)/(r.monteCarlo.irr.max-r.monteCarlo.irr.min)*100))}%;top:0;bottom:0;width:2px;background:#8b5cf6"></div>
          </div>
          <div style="font-size:7px;color:var(--green);width:35px">${r.monteCarlo.irr.p95}%</div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:7px;color:var(--gray2);padding:0 37px">
          <span>P5</span><span>P25: ${r.monteCarlo.irr.p25}%</span><span style="color:#8b5cf6;font-weight:700">Median: ${r.monteCarlo.irr.p50}%</span><span>P75: ${r.monteCarlo.irr.p75}%</span><span>P95</span>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:6px">
        <div style="background:var(--bg);border-radius:4px;padding:5px 6px">
          <div class="metric-row"><span class="metric-label" style="font-size:8px">IRR moyen</span><span class="metric-value" style="color:#8b5cf6;font-weight:700">${r.monteCarlo.irr.mean}% ± ${r.monteCarlo.irr.std}%</span></div>
          <div class="metric-row"><span class="metric-label" style="font-size:8px">NPV médian</span><span class="metric-value" style="color:${r.monteCarlo.npv.p50>0?'var(--green)':'var(--red)'}">${fmt(Math.round(r.monteCarlo.npv.p50/1000))}k€</span></div>
        </div>
        <div style="background:var(--bg);border-radius:4px;padding:5px 6px">
          <div class="metric-row"><span class="metric-label" style="font-size:8px">Payback médian</span><span class="metric-value">M${r.monteCarlo.payback.p50}</span></div>
          <div class="metric-row"><span class="metric-label" style="font-size:8px">CA A3 médian</span><span class="metric-value">${fmt(Math.round(r.monteCarlo.caA3.mean/1000))}k€</span></div>
        </div>
      </div>

      <div style="font-size:7px;color:var(--gray2);line-height:1.4">
        <b style="color:#8b5cf6">Interprétation</b> : ${r.monteCarlo.probPositiveIRR >= 90 ? 'Projet très robuste — rentable dans '+r.monteCarlo.probPositiveIRR+'% des scénarios simulés.' : r.monteCarlo.probPositiveIRR >= 70 ? 'Projet globalement viable mais sensible aux hypothèses — '+r.monteCarlo.probPositiveIRR+'% de probabilité de rentabilité.' : 'Projet risqué — seulement '+r.monteCarlo.probPositiveIRR+'% de probabilité de rentabilité. Revoir les hypothèses.'}
        Intervalle de confiance 90% IRR : [${r.monteCarlo.irr.p5}% — ${r.monteCarlo.irr.p95}%].
        ${r.monteCarlo.probIRR15 < 50 ? ' Attention : moins de 50% de chance d\'atteindre l\'objectif investisseur (IRR>15%).' : ''}
      </div>
    </div>

    ${r.walkIn.walkInMembers > 0 ? `
    <div style="background:var(--bg);border-radius:8px;padding:10px;margin-bottom:10px">
      <div style="font-size:9px;font-weight:700;color:var(--cyan);margin-bottom:6px">WALK-IN — Conversion trafic mall/centre</div>
      <div class="metric-row"><span class="metric-label">Trafic quotidien site</span><span class="metric-value">${fmt(r.walkIn.dailyFootfall)} visiteurs/jour</span></div>
      <div class="metric-row"><span class="metric-label">Visiteurs uniques/an</span><span class="metric-value">${fmt(r.walkIn.annualUnique)}</span></div>
      <div class="metric-row"><span class="metric-label">Taux conversion (benchmark)</span><span class="metric-value">${r.walkIn.conversionRate}%</span></div>
      <div class="metric-row"><span class="metric-label">Walk-in membres</span><span class="metric-value" style="color:var(--cyan);font-weight:700">${fmt(r.walkIn.walkInMembers)}</span></div>
      ${r.walkIn.sources.map(s=>`<div class="metric-row"><span class="metric-label" style="font-size:9px">${s.name} (${s.type})</span><span class="metric-value" style="font-size:9px">${fmt(s.visitors)}/jour</span></div>`).join('')}
    </div>` : ''}

    <div style="background:var(--bg);border-radius:8px;padding:10px;margin-bottom:10px">
      <div style="font-size:9px;font-weight:700;color:#f97316;margin-bottom:6px">CAPTAGE CONCURRENTS — ${r.comps.length} clubs dans ${r.captageRadius/1000}km</div>
      <div class="metric-row"><span class="metric-label">Membres total zone</span><span class="metric-value">${fmt(r.totalMembersZone)}</span></div>
      <div class="metric-row"><span class="metric-label">Penetration actuelle</span><span class="metric-value">${r.currentPenetration}%</span></div>
      <div class="metric-row"><span class="metric-label">Total captes</span><span class="metric-value" style="color:#f97316;font-weight:700">${fmt(r.totalCaptifs)}</span></div>
      <div style="max-height:200px;overflow-y:auto;margin-top:6px">
        ${r.comps.slice(0,15).map(comp => `
          <div style="display:flex;align-items:center;gap:6px;padding:5px 0;border-bottom:1px solid rgba(71,85,115,.1);font-size:10px">
            <div style="width:6px;height:6px;border-radius:50%;background:${comp.color};flex-shrink:0"></div>
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${comp.name}</div>
              <div style="color:var(--gray2);font-size:9px">${comp.segment} | ${(comp.dist/1000).toFixed(1)}km | ~${fmt(comp.membersEst)} mbr ${comp.rating?'| '+comp.rating+'★':''}</div>
              <div style="color:var(--gray2);font-size:8px">base ${comp.baseRate}% × dist ${comp.decay}%${comp.driveMins?' ('+comp.driveMins+'min)':''} × note ${comp.ratingFactor}% × prix ${comp.priceFactor}% × force ${comp.strengthFactor||100}%</div>
              <div style="color:var(--gray2);font-size:7px;margin-top:1px">${comp.dataSrc||'DB'} | ${comp.reviewCount?comp.reviewCount+' avis':'?'} | ★${comp.rating||'?'}</div>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-weight:800;color:#f97316">+${comp.captured}</div>
              <div style="color:var(--gray2);font-size:8px">${comp.effectiveRate}% taux</div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <div style="background:var(--bg);border-radius:8px;padding:10px;margin-bottom:10px">
      <div style="font-size:9px;font-weight:700;color:var(--green);margin-bottom:6px">CRÉATION DE MARCHÉ — Modèle penetration gap WE</div>
      <div class="metric-row"><span class="metric-label">Pop. cible 15-45 dans rayon</span><span class="metric-value">${fmt(r.popTarget)}</span></div>
      <div class="metric-row"><span class="metric-label">Pénétration locale actuelle</span><span class="metric-value">${r.native.localPen}%</span></div>
      <div class="metric-row"><span class="metric-label">Pénétration cible (benchmark WE)</span><span class="metric-value" style="color:var(--cyan)">${r.native.targetPen}%</span></div>
      <div class="metric-row"><span class="metric-label">Gap de pénétration</span><span class="metric-value" style="color:var(--yellow)">+${r.native.penGap} pp</span></div>
      <div class="metric-row"><span class="metric-label">Pool nouveaux pratiquants</span><span class="metric-value">${fmt(r.native.pool)}</span></div>
      <div class="metric-row"><span class="metric-label">Part FP (1er low-cost international)</span><span class="metric-value">${r.native.uplift}%</span></div>
      <div class="metric-row"><span class="metric-label">Natifs captés (création marché)</span><span class="metric-value" style="color:var(--green);font-weight:700">${fmt(r.native.captured)}</span></div>
    </div>

    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:10px;font-size:10px;color:var(--gray)">
      <div style="font-size:9px;font-weight:700;color:var(--cyan);margin-bottom:4px">METHODOLOGIE BAIN-LEVEL</div>
      <div style="line-height:1.6">
        <b>Captifs</b> = Σ (membres × taux_base × decay × note_Google × prix × force)<br>
        <b>Natifs</b> = Pop_cible × (Pen_WE − Pen_RO) × Part_FP — Modèle expansion marché low-cost (source: EuropeActive)<br>
        <b>Walk-in</b> = trafic_mall × 0.2%<br><br>
        <b>Personas</b> : Etudiants (ARPU×0.7, churn 3.5%), Jeunes Actifs (×1.0, 2.5%), Familles (×1.1, 2.0%), CSP+ (×1.3, 1.8%)<br>
        Mix base sur donnees INS Recensement 2021 (pop. par tranche d'age × secteur) + prix quartier (proxy CSP+)<br><br>
        <b>Bass Diffusion</b> : F(t) = (1-e<sup>-(p+q)t</sup>) / (1+(q/p)e<sup>-(p+q)t</sup>)<br>
        Standard: p=0.02, q=0.35 (60-70% ouvertures) | Fort: p=0.05, q=0.42 (30-40%)<br>
        Calibre sur donnees reelles FP Espagne (2 clubs)<br><br>
        <b>Churn/LTV</b> : Modele cohortes calibre sur BP FP France (3800 mbr, 300 clubs). Y1 churn bas (~0.7%/mois) + spike renouvellement annuel (12% a M13/M25/M37/M49) + Y2+ steady-state (~3%/mois). LTV = ARPU/churn. CAC ≈ 50 EUR<br>
        Membres_net(t) = Membres(t-1) + Nouveaux(t) - Churned(t)<br><br>
        <b>P&L</b> : Calibre BP harmonise Avril 2026 (v6.35) — CAPEX ${fmt(Math.round(PNL_DEFAULTS.capex/1000))}k + Leasing ${fmt(Math.round(PNL_DEFAULTS.leasingAnnual/1000))}k/an<br>
        Staff 3 ETP plug (1 manager ${fmt(PNL_DEFAULTS.staff?.managerSalary||36000)}€ + ${PNL_DEFAULTS.staff?.nbVendors||2} vendeurs ${fmt(PNL_DEFAULTS.staff?.vendorSalary||24000)}€, +${Math.round((PNL_DEFAULTS.staff?.chargeRate||0.0225)*100*10)/10}% charges, +${Math.round((PNL_DEFAULTS.staff?.inflationRate||0.06)*100)}%/an) | OPEX Ops ${Math.round(PNL_DEFAULTS.opexOpsRateByYear[0]*100)}%→${Math.round(PNL_DEFAULTS.opexOpsRateByYear[4]*100)}% CA time-decay | Redev ${Math.round(PNL_DEFAULTS.redevanceRate*100)}%+${Math.round(PNL_DEFAULTS.fondsPubRate*100)}% | Tax locale ${Math.round(PNL_DEFAULTS.taxLocalRate*100)}% | CIT ${Math.round(PNL_DEFAULTS.citRate*100)}%<br>
        IRR = bisection 60 mois + Terminal Value (EBITDA Y5 × ${PNL_DEFAULTS.exitMultiple}x exit multiple) | NPV @WACC ${PNL_DEFAULTS.discountRate*100}%<br>
        IRR Ops = cashflows operationnels purs (sans TV) | Payback = mois ou cumul CF ops > CAPEX<br><br>
        <b>Saisonnalite</b> : Jan +35%, Fev +20%, Jun-Aout -25 a -30%, Sep +15% (IHRSA)<br>
        Appliquee sur ARPU (15% saisonnier) + frequentation (10% saisonnier)<br><br>
        <b>Sensibilite</b> : Tornado chart — 6 variables cles variees ±20-30%<br>
        Churn, CAPEX, ARPU, Loyer, Vitesse ramp-up, OPEX fixe
      </div>
    </div>
  `;

  // === CHART.JS RENDERING ===
  // v6.67 — remplit la ligne "vs Référence BP" + KPIs financement au 1er rendu
  // (updatePnLDisplay ne tourne qu'aux mouvements de slider).
  setTimeout(() => { try { updateFinancingDisplay(r.pnl?.base); } catch {} }, 0);
  setTimeout(() => {
    const bassCanvas = document.getElementById('bassChart');
    if(bassCanvas && typeof Chart !== 'undefined') {
      const labels = Array.from({length:60}, (_,i) => (i%6===0||i===59) ? 'M'+(i+1) : '');
      const datasets = [];
      for(const [key, sc] of Object.entries(SCENARIOS)) {
        const cohort = r.scenarios[key].cohort;
        const ramp = r.scenarios[key].ramp;
        // Gross (solid line)
        datasets.push({ label:sc.label+' (brut)', data: ramp.map(m=>m.members), borderColor:sc.color, borderWidth:2, pointRadius:0, fill:false });
        // Net after churn (dashed)
        datasets.push({ label:sc.label+' (net)', data: cohort.map(m=>m.netMembers), borderColor:sc.color, borderDash:[4,4], borderWidth:1.5, pointRadius:0, fill:false });
      }
      new Chart(bassCanvas, {
        type: 'line',
        data: { labels, datasets },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display:false } },
          scales: {
            x: { ticks: { color:'#94a3b8', font:{size:8}, maxRotation:0 }, grid: { color:'#1e293b' } },
            y: { ticks: { color:'#94a3b8', font:{size:8}, callback: v => v >= 1000 ? (v/1000).toFixed(1)+'k' : v }, grid: { color:'#1e293b' } }
          }
        }
      });
    }

    // P&L chart — EBITDA per scenario
    const pnlCanvas = document.getElementById('pnlChart');
    if(pnlCanvas && typeof Chart !== 'undefined') {
      const labels = r.pnl.base.monthly.map(m => (m.month%6===0||m.month===1) ? 'M'+m.month : '');
      const datasets = [];
      for(const [key, sc] of Object.entries(SCENARIOS)) {
        const p = r.pnl[key];
        datasets.push({ label:sc.label+' EBITDA', data: p.monthly.map(m=>m.ebitda), borderColor:sc.color, borderWidth:2, pointRadius:0, fill:false });
      }
      // Breakeven line
      datasets.push({ label:'Breakeven', data: r.pnl.base.monthly.map(()=>0), borderColor:'#94a3b8', borderDash:[3,3], borderWidth:1, pointRadius:0, fill:false });
      window._pnlChart = new Chart(pnlCanvas, {
        type: 'line',
        data: { labels, datasets },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display:false } },
          scales: {
            x: { ticks: { color:'#94a3b8', font:{size:8}, maxRotation:0 }, grid: { color:'#1e293b' } },
            y: { ticks: { color:'#94a3b8', font:{size:8}, callback: v => Math.abs(v) >= 1000 ? (v/1000).toFixed(0)+'k' : v }, grid: { color:'#1e293b' } }
          }
        }
      });
    }

    // Waterfall chart — member source decomposition
    const wfCanvas = document.getElementById('waterfallChart');
    if(wfCanvas && typeof Chart !== 'undefined') {
      const captifs = r.totalCaptifs;
      const natifs = r.native.captured;
      const walkIn = r.walkIn.walkInMembers;
      const total = r.totalTheorique;
      new Chart(wfCanvas, {
        type: 'bar',
        data: {
          labels: ['Captifs', 'Natifs', 'Walk-in', 'TOTAL'],
          datasets: [
            { label: 'Invisible base', data: [0, captifs, captifs+natifs, 0], backgroundColor: 'transparent', borderWidth: 0, barPercentage: 0.6 },
            { label: 'Value', data: [captifs, natifs, walkIn, total],
              backgroundColor: ['#f97316', '#10b981', '#06b6d4', 'rgba(212,160,23,.7)'],
              borderColor: ['#f97316', '#10b981', '#06b6d4', '#d4a017'],
              borderWidth: 1, barPercentage: 0.6 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display:false }, tooltip: { callbacks: { label: ctx => ctx.dataset.label === 'Value' ? fmt(ctx.raw) + ' membres' : '' } } },
          scales: {
            x: { stacked: true, ticks: { color:'#94a3b8', font:{size:9} }, grid: { display:false } },
            y: { stacked: true, ticks: { color:'#94a3b8', font:{size:8}, callback: v => v >= 1000 ? (v/1000).toFixed(1)+'k' : v }, grid: { color:'#1e293b' } }
          }
        }
      });
    }

    // Monte Carlo histogram
    const mcCanvas = document.getElementById('mcHistogram');
    if(mcCanvas && typeof Chart !== 'undefined' && r.monteCarlo) {
      const mc = r.monteCarlo;
      new Chart(mcCanvas, {
        type: 'bar',
        data: {
          labels: mc.bins.map(b => b.label),
          datasets: [{
            data: mc.bins.map(b => b.count),
            backgroundColor: mc.bins.map(b => b.midpoint < 0 ? '#ef444480' : b.midpoint < 15 ? '#fbbf2480' : '#10b98180'),
            borderColor: mc.bins.map(b => b.midpoint < 0 ? '#ef4444' : b.midpoint < 15 ? '#fbbf24' : '#10b981'),
            borderWidth: 1, barPercentage: 0.95, categoryPercentage: 0.95
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display:false }, tooltip: { callbacks: { label: ctx => ctx.raw + ' simulations (' + mc.bins[ctx.dataIndex].pct + '%)' } } },
          scales: {
            x: { ticks: { color:'#94a3b8', font:{size:7}, maxRotation: 45 }, grid: { display:false } },
            y: { ticks: { color:'#94a3b8', font:{size:7} }, grid: { color:'#1e293b' } }
          }
        }
      });
    }

    // Revenue bridge chart (Annual CA A1→A5)
    const bridgeCanvas = document.getElementById('revenueBridgeChart');
    if(bridgeCanvas && typeof Chart !== 'undefined') {
      const years = ['A1','A2','A3','A4','A5'];
      const baseCA = r.pnl.base.annualCA.map(v => Math.round(v/1000));
      const conservCA = r.pnl.conservateur.annualCA.map(v => Math.round(v/1000));
      const optimCA = r.pnl.optimiste.annualCA.map(v => Math.round(v/1000));
      new Chart(bridgeCanvas, {
        type: 'bar',
        data: {
          labels: years,
          datasets: [
            { label: 'Conservateur', data: conservCA, backgroundColor: '#ef444440', borderColor: '#ef4444', borderWidth: 1 },
            { label: 'Base', data: baseCA, backgroundColor: '#fbbf2440', borderColor: '#fbbf24', borderWidth: 1 },
            { label: 'Optimiste', data: optimCA, backgroundColor: '#10b98140', borderColor: '#10b981', borderWidth: 1 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: true, labels: { color:'#94a3b8', font:{size:8}, boxWidth:12 } } },
          scales: {
            x: { ticks: { color:'#94a3b8', font:{size:9} }, grid: { display:false } },
            y: { ticks: { color:'#94a3b8', font:{size:8}, callback: v => v+'k€' }, grid: { color:'#1e293b' } }
          }
        }
      });
    }

    // === BP DU SITE — 2 scénarios côte à côte (v6.64) ===
    if (window.BPSiteUI && document.getElementById('bpSiteContent')) {
      const siteName = window._lastCaptageLocation?.siteName
        || (typeof customSites !== 'undefined' ? customSites.find(s => Math.abs(s.lat - lat) < 0.001 && Math.abs(s.lng - lng) < 0.001)?.name : null)
        || (typeof TARGETS !== 'undefined' ? TARGETS.find(t => Math.abs(t.lat - lat) < 0.001 && Math.abs(t.lng - lng) < 0.001)?.name : null)
        || 'Site';
      const surface = window._surfaceOverride?.surface ?? PNL_DEFAULTS.rentSteps.surface;
      const loyerM2 = window._rentOverride?.y1 ?? PNL_DEFAULTS.rentSteps.objectifNego[0].rent;
      const chargesM2 = window._chargeOverride?.chargeTotal ?? (PNL_DEFAULTS.rentSteps.serviceCharge + PNL_DEFAULTS.rentSteps.marketingFee);
      BPSiteUI.render('bpSiteContent', {
        siteName, siteKey: lat.toFixed(3) + ',' + lng.toFixed(3),
        surface, loyerM2Month: loyerM2, chargesM2Month: chargesM2,
        captageMembers: r.realiste,
      });
    }
  }, 100);
}

// ================================================================
// CUSTOM SITES MANAGEMENT
// ================================================================
let addingSite = false;

function startAddSite() {
  addingSite = true;
  setStatus('warn','Cliquez sur la carte pour placer votre site...');
  map.getContainer().style.cursor = 'crosshair';
}

// Hook into map click for adding sites
const origOnMapClick = onMapClick;
// We'll override in init after defining

function renderCustomSites() {
  const list = el('customSitesList');
  if(!list) return;
  const colors={prospect:'#d4a017',shortlist:'#d4a017',validated:'#10b981',rejected:'#ef4444'};
  const esc = (typeof escapeHtml === 'function') ? escapeHtml : (s => String(s||''));

  // v6.34 — demande Paul: fusionner TARGETS + customs dans "Mes sites".
  // Pin 1-5 = TARGETS BP hardcoded (non-supprimables, analysables), pin 6+ = customs.
  // v6.47 — vignette ENTIÈRE cliquable → analyzeTargetByIdx(i) (avant: onclick sur
  // bouton Analyser appelait flyTarget qui ne faisait QUE voler la map sans analyser).
  const targetCards = (typeof TARGETS !== 'undefined' ? TARGETS : []).map((t, i) => `
    <div class="comp-card" style="border-left:3px solid #d4a017;cursor:pointer" onclick="analyzeTargetByIdx(${i})" title="Cliquer pour analyser ${esc(t.name)}">
      <div style="flex:1;min-width:0">
        <div class="comp-name">${i+1}. ${esc(t.name)}</div>
        <div class="comp-meta">S${esc(t.sector)} · ${esc(t.area)} · ${esc(t.rent)} · P${esc(t.phase)}</div>
        <div style="display:flex;gap:4px;margin-top:6px;flex-wrap:wrap;align-items:center">
          <span style="padding:3px 8px;background:rgba(212,160,23,.12);border:1px solid rgba(212,160,23,.35);border-radius:4px;color:var(--accent);font-size:9px;font-weight:700;letter-spacing:.3px">TARGET BP</span>
          <span style="font-size:9px;color:${t.status?.includes('securise')?'var(--green)':'var(--yellow)'}">${esc(t.status)} · ${esc(t.opening)}</span>
          <button class="btn btn-sm" onclick="event.stopPropagation();analyzeTargetByIdx(${i})">Analyser</button>
        </div>
      </div>
    </div>
  `).join('');

  const startNum = (typeof TARGETS !== 'undefined' ? TARGETS.length : 0) + 1;
  // v6.38 — filtre les tombstones (sites soft-deleted). Seuls les sites vivants s'affichent.
  const liveSites = customSites.filter(s => !s.deletedAt);
  const customCards = liveSites.length === 0
    ? '<p style="font-size:11px;color:var(--gray2);padding:8px 0">Aucun site custom ajouté. Clique "+ Ajouter" pour en créer un (il sera numéroté ' + startNum + '+).</p>'
    : liveSites.map((s, i) => `
    <div class="comp-card" style="border-left:3px solid ${colors[s.status]||'#d4a017'};cursor:pointer" onclick="analyzeCustomSite(${s.id})" title="Cliquer pour analyser ${esc(s.name)}">
      <div style="flex:1;min-width:0">
        <div class="comp-name">${startNum + i}. ${esc(s.name)}${s.createdBy ? ` <span style="font-size:9px;color:var(--gray2);font-weight:400">· ${esc(s.createdBy.split('@')[0])}</span>` : ''}</div>
        <div class="comp-meta">${esc(s.notes) || 'Pas de notes'} | ${Number(s.lat).toFixed(4)}, ${Number(s.lng).toFixed(4)}</div>
        <div style="display:flex;gap:4px;margin-top:6px;flex-wrap:wrap" onclick="event.stopPropagation()">
          <select onchange="qualifyCustomSite(${s.id},this.value)" style="padding:3px 6px;background:var(--bg2);border:1px solid var(--border);border-radius:4px;color:var(--white);font-size:10px;font-family:var(--font)">
            <option value="prospect" ${s.status==='prospect'?'selected':''}>Prospect</option>
            <option value="shortlist" ${s.status==='shortlist'?'selected':''}>Shortlist</option>
            <option value="validated" ${s.status==='validated'?'selected':''}>Validé</option>
            <option value="rejected" ${s.status==='rejected'?'selected':''}>Rejeté</option>
          </select>
          <button class="btn btn-sm" onclick="analyzeCustomSite(${s.id})">Analyser</button>
          <button class="btn btn-sm" style="color:var(--red)" onclick="confirmDeleteCustomSite(${s.id})">Suppr.</button>
        </div>
      </div>
    </div>`).join('');

  list.innerHTML = targetCards + customCards;

  // v6.44 — resync automatique du clone mobile (FAB → Mes sites) après
  // chaque mutation. Sinon le site supprimé/ajouté reste stale dans le
  // secondary sheet tant que Paul n'a pas refermé+rouvert le FAB.
  document.querySelectorAll('[data-orig-id="customSitesList"]').forEach(clone => {
    if (clone !== list) clone.innerHTML = list.innerHTML;
  });

  // Update cannibalization
  if(customSites.filter(s=>!s.deletedAt).length >= 2) updateCannibalization();
}
window.renderCustomSites = renderCustomSites;

async function addSiteByAddress() {
  const addr = el('newSiteAddr').value.trim();
  if(!addr) return;
  try {
    let lat, lng;
    // Try Google Geocoding first (more accurate)
    if (_googleHasKey()) {
      const gResult = await googleGeocode(addr + ', Bucharest, Romania');
      if (gResult) { lat = gResult.lat; lng = gResult.lng; }
    }
    // Fallback to Nominatim
    if (lat === undefined) {
      const resp = await fetch(`${NOMINATIM}/search?format=json&q=${encodeURIComponent(addr+', Bucharest, Romania')}&limit=1`);
      const data = await resp.json();
      if (data.length > 0) { lat = parseFloat(data[0].lat); lng = parseFloat(data[0].lon); }
    }
    if (lat !== undefined) {
      const name = prompt('Nom du site :', addr.substring(0,40)) || addr.substring(0,40);
      const notes = prompt('Notes (optionnel) :', '') || '';
      const site = addCustomSite(lat, lng, name, notes);
      map.flyTo([lat,lng],15);
      el('newSiteAddr').value = '';
      setTimeout(()=>runSiteAnalysis(site),500);
    } else {
      alert('Adresse non trouvee. Essayez avec plus de details.');
    }
  } catch(e) { alert('Erreur geocodage: '+e.message); }
}

async function runSiteAnalysis(site) {
  const lat=site.lat, lng=site.lng;
  const sector = findSector(lat,lng);
  const cartier = findCartier(lat,lng);

  // Always use verified database first (92 clubs, works offline)
  let comps = getDemoInRadius(lat,lng,3000);
  // Try to enrich with Overpass if not in demo mode (non-blocking)
  if(!demo) {
    try {
      const overpassComps = await fetchOverpass(lat,lng,3000);
      overpassComps.forEach(oc=>{
        if(!comps.some(vc=>haversine(vc.lat,vc.lng,oc.lat,oc.lng)<150)) comps.push(oc);
      });
    } catch(e) { console.log('Overpass skipped, using verified DB only'); }
  }

  const popGranular = estimatePopInRadiusGranular(lat,lng,radius);
  const poi = poisInRadius(lat,lng,3000);
  const saz = calcSAZ(lat,lng,sector,comps);
  const scenarios = revenueScenarios(popGranular.target, comps.length, popGranular.avgPrice, lat, lng);

  // Save analysis to site
  site.analysisData = {saz,comps:comps.length,popGranular,poi,scenarios,cartier:cartier?.name,sector:sector?.name};
  localStorage.setItem('fpCustomSites',JSON.stringify(customSites));

  // Display analysis
  const card = el('siteAnalysisCard');
  card.style.display = 'block';

  const sorted = comps.map(c=>({...c,dist:haversine(lat,lng,c.lat,c.lng),ts:threatScore(c,haversine(lat,lng,c.lat,c.lng))})).sort((a,b)=>a.dist-b.dist);
  const top3 = sorted.slice(0,3);
  const premium = sorted.filter(c=>c.segment==='premium');
  const recoClass = saz.total>=70?'reco-go':saz.total>=45?'reco-caution':'reco-nogo';
  const recoText = saz.total>=70?'GO':saz.total>=45?'PRUDENCE':'NO-GO';

  el('siteAnalysisContent').innerHTML = `
    <div style="text-align:center;padding:8px 0">
      <div style="font-size:11px;font-weight:600;margin-bottom:4px">${site.name}</div>
      <div style="font-size:10px;color:var(--gray2)" id="ficheSubtitle">${cartier?cartier.name+' | ':''} ${sector?sector.name:'Hors zone'} | R=${radius/1000}km</div>
    </div>

    <div style="display:flex;gap:16px;justify-content:center;margin:12px 0">
      <div style="text-align:center">
        <div class="saz-number ${saz.total>=70?'good':saz.total>=45?'medium':'bad'}" style="font-size:36px">${saz.total}</div>
        <div class="saz-sublabel">SAZ</div>
        <div class="${recoClass} reco-chip" style="font-size:9px;margin-top:4px">${recoText}</div>
      </div>
      <div style="text-align:center">
        <div style="font-size:36px;font-weight:900;color:var(--blue)" id="ficheCible1545">${fmt(popGranular.target)}</div>
        <div class="saz-sublabel">Cible 15-45</div>
      </div>
      <div style="text-align:center">
        <div style="font-size:36px;font-weight:900;color:${comps.length>10?'var(--red)':comps.length>5?'var(--yellow)':'var(--green)'}" id="ficheNbComps">${comps.length}</div>
        <div class="saz-sublabel">Concurrents</div>
      </div>
    </div>

    <div style="background:var(--bg2);border-radius:8px;padding:10px;margin-bottom:10px">
      <div style="font-size:10px;font-weight:700;color:var(--cyan);margin-bottom:6px">QUARTIER (CARTIER)</div>
      ${cartier?`
        <div class="metric-row"><span class="metric-label">Nom</span><span class="metric-value">${cartier.name}</span></div>
        <div class="metric-row"><span class="metric-label">Population</span><span class="metric-value">${fmt(cartier.pop)}</span></div>
        <div class="metric-row"><span class="metric-label">Loyer cible (réf.)</span><span class="metric-value">12 EUR/m²/an HT/HC</span></div>
        <div class="metric-row"><span class="metric-label">Profil</span><span class="metric-value" style="font-size:10px">${cartier.desc}</span></div>
      `:'<div style="font-size:11px;color:var(--gray2)">Hors quartiers references</div>'}
    </div>

    <div style="background:var(--bg2);border:1px solid var(--accent)40;border-radius:8px;padding:10px;margin-bottom:10px">
      <div style="font-size:10px;font-weight:700;color:var(--accent);margin-bottom:8px">&#127758; ZONE DE CHALANDISE</div>
      <div style="display:flex;gap:4px;margin-bottom:8px">
        <div class="radius-pill" onclick="setRadiusFromFiche(1000)" style="padding:3px 8px;font-size:9px;border-radius:10px;cursor:pointer;border:1px solid var(--border);color:var(--gray2);${radius===1000?'background:var(--accent)30;border-color:var(--accent);color:white':''}">1 km</div>
        <div class="radius-pill" onclick="setRadiusFromFiche(2000)" style="padding:3px 8px;font-size:9px;border-radius:10px;cursor:pointer;border:1px solid var(--border);color:var(--gray2);${radius===2000?'background:var(--accent)30;border-color:var(--accent);color:white':''}">2 km</div>
        <div class="radius-pill" onclick="setRadiusFromFiche(3000)" style="padding:3px 8px;font-size:9px;border-radius:10px;cursor:pointer;border:1px solid var(--border);color:var(--gray2);${radius===3000?'background:var(--accent)30;border-color:var(--accent);color:white':''}">3 km</div>
        <div class="radius-pill" onclick="setRadiusFromFiche(5000)" style="padding:3px 8px;font-size:9px;border-radius:10px;cursor:pointer;border:1px solid var(--border);color:var(--gray2);${radius===5000?'background:var(--accent)30;border-color:var(--accent);color:white':''}">5 km</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <input type="range" id="ficheRadiusSlider" min="500" max="5000" step="100" value="${radius}" oninput="setRadiusFromFicheSlider(this.value)" style="flex:1;accent-color:var(--accent);height:4px;cursor:pointer">
        <span id="ficheRadiusLabel" style="font-size:11px;font-weight:700;color:var(--accent);min-width:42px;text-align:right">${(radius/1000).toFixed(1)} km</span>
      </div>
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        <button class="btn btn-sm iso-btn" id="isoWalkBtnF" onclick="setIsoMode('walk')" style="font-size:9px;${isoMode==='walk'?'background:rgba(212,160,23,.3);border-color:var(--accent);color:white':''}">&#128694; 10min marche</button>
        <button class="btn btn-sm iso-btn" id="isoDriveBtnF" onclick="setIsoMode('drive')" style="font-size:9px;${isoMode==='drive'?'background:rgba(212,160,23,.3);border-color:var(--accent);color:white':''}">&#128663; 10min voiture</button>
        <button class="btn btn-sm iso-btn" id="isoTransitBtnF" onclick="setIsoMode('transit')" style="font-size:9px;${isoMode==='transit'?'background:rgba(212,160,23,.3);border-color:var(--accent);color:white':''}">&#128647; 10min métro</button>
        <button class="btn btn-sm iso-btn" id="isoCircleBtnF" onclick="setIsoMode('circle')" style="font-size:9px;${isoMode==='circle'?'background:rgba(212,160,23,.3);border-color:var(--accent);color:white':''}">&#9898; Cercle</button>
      </div>
      <div style="font-size:7px;color:var(--gray2);margin-top:4px">Powered by Google Routes API — le cercle et les isochrones se mettent à jour sur la carte</div>
    </div>

    <div style="background:var(--bg2);border-radius:8px;padding:10px;margin-bottom:10px">
      <div style="font-size:10px;font-weight:700;color:var(--cyan);margin-bottom:6px" id="popZoneTitle">POPULATION ZONE (R=${radius/1000}km) — Calcul par quartier</div>
      <div class="metric-row"><span class="metric-label">Pop. totale</span><span class="metric-value" id="fichePopTotal">${fmt(popGranular.pop)}</span></div>
      <div class="metric-row"><span class="metric-label">Cible 15-45 ans</span><span class="metric-value" style="color:var(--blue)" id="fichePopTarget">${fmt(popGranular.target)}</span></div>
      <div class="metric-row"><span class="metric-label">Prix moyen zone</span><span class="metric-value" id="fichePrixMoyen">${fmt(popGranular.avgPrice)} EUR/m2</span></div>
      ${poi.unis.length?`<div class="metric-row"><span class="metric-label">Universites (${poi.unis.length})</span><span class="metric-value" style="color:#a855f7">${fmt(poi.totalStudents)} etudiants</span></div>`:''}
      ${poi.offices.length?`<div class="metric-row"><span class="metric-label">Bureaux (${poi.offices.length})</span><span class="metric-value">${fmt(poi.totalEmployees)} employes</span></div>`:''}
      ${poi.malls.length?`<div class="metric-row"><span class="metric-label">Malls</span><span class="metric-value">${poi.malls.length}</span></div>`:''}
    </div>

    <div style="background:var(--bg2);border-radius:8px;padding:10px;margin-bottom:10px">
      <div style="font-size:10px;font-weight:700;color:var(--cyan);margin-bottom:6px">CONCURRENCE (R=3km)</div>
      <div class="metric-row"><span class="metric-label">Total concurrents</span><span class="metric-value">${comps.length}</span></div>
      <div class="metric-row"><span class="metric-label">dont Premium (WC etc.)</span><span class="metric-value" style="color:var(--red)">${premium.length}</span></div>
      ${top3.map((c,i)=>`<div class="metric-row"><span class="metric-label">#${i+1} ${c.name}</span><span class="metric-value">${(c.dist/1000).toFixed(1)}km | menace ${c.ts}</span></div>`).join('')}
    </div>

  `;

  // Trigger captage analysis
  showCaptageForPoint(lat, lng);

  // Scroll to results
  setTimeout(()=>{
    const card = el('siteAnalysisCard');
    if(card) card.scrollIntoView({behavior:'smooth',block:'start'});
  },200);
}

let lastCaptagePoint = null;

function updateCaptureRates() {
  const before = { ...(window._captureRatesOverride || {
    premium: Math.round((CAPTURE_RATES.premium?.rate || 0) * 100),
    midPremium: Math.round((CAPTURE_RATES['mid-premium']?.rate || 0) * 100),
    mid: Math.round((CAPTURE_RATES.mid?.rate || 0) * 100),
    independent: Math.round((CAPTURE_RATES.independent?.rate || 0) * 100),
    lowcost: Math.round((CAPTURE_RATES.lowcost?.rate || 0) * 100),
  })};
  CAPTURE_RATES.premium.rate = parseInt(el('crPrem').value)/100;
  CAPTURE_RATES['mid-premium'].rate = parseInt(el('crMidP').value)/100;
  CAPTURE_RATES.mid.rate = parseInt(el('crMid').value)/100;
  CAPTURE_RATES.independent.rate = parseInt(el('crInd').value)/100;
  CAPTURE_RATES.lowcost.rate = parseInt(el('crLow').value)/100;
  el('crPremVal').textContent=el('crPrem').value+'%';
  el('crMidPVal').textContent=el('crMidP').value+'%';
  el('crMidVal').textContent=el('crMid').value+'%';
  el('crIndVal').textContent=el('crInd').value+'%';
  el('crLowVal').textContent=el('crLow').value+'%';
  // v6.65.1 — persist + cloud sync + audit log
  window._captureRatesOverride = {
    premium: parseInt(el('crPrem').value),
    midPremium: parseInt(el('crMidP').value),
    mid: parseInt(el('crMid').value),
    independent: parseInt(el('crInd').value),
    lowcost: parseInt(el('crLow').value),
  };
  window.persistOverrides?.();
  try {
    const after = window._captureRatesOverride;
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      logSliderChangeDebounced?.('taux capture', JSON.stringify(before), JSON.stringify(after), 'global', 'Taux capture concurrents');
    }
  } catch {}
  // Re-compute captage
  if(lastCaptagePoint) {
    const r = parseInt(el('captageRadiusSlider')?.value || 3000);
    renderCaptageAnalysis('captageContent', lastCaptagePoint.lat, lastCaptagePoint.lng, r);
  }
}

function updateCaptageRadius() {
  const r = parseInt(el('captageRadiusSlider').value);
  el('captageRadiusVal').textContent = (r/1000) + ' km';
  if(lastCaptagePoint) {
    // v6.65.1 — persist per-site + cloud sync + audit log
    const key = lastCaptagePoint.lat.toFixed(3) + ',' + lastCaptagePoint.lng.toFixed(3);
    const before = window._radiusOverrides[key] ?? 3000;
    const siteName = window._lastCaptageLocation?.siteName || key;
    window._radiusOverrides[key] = r;
    window.persistOverrides?.();
    try { logSliderChangeDebounced?.('rayon', before, r, key, siteName); } catch {}
    renderCaptageAnalysis('captageContent', lastCaptagePoint.lat, lastCaptagePoint.lng, r);
  }
}

function showCaptageForPoint(lat, lng) {
  lastCaptagePoint = {lat, lng};
  // v6.65.1 — si un rayon custom a été sauvegardé pour ce site, le restaurer
  // dans le slider + l'utiliser pour le render (sinon default 3000m).
  const key = lat.toFixed(3) + ',' + lng.toFixed(3);
  const savedRadius = (window._radiusOverrides && window._radiusOverrides[key]) || null;
  const effectiveRadius = savedRadius || parseInt(el('captageRadiusSlider')?.value || 3000);
  if (savedRadius) {
    const sSite = el('captageRadiusSliderSite');
    const vSite = el('captageRadiusValSite');
    if (sSite) sSite.value = savedRadius;
    if (vSite) vSite.textContent = (savedRadius / 1000) + ' km';
    const sMain = el('captageRadiusSlider');
    const vMain = el('captageRadiusVal');
    if (sMain) sMain.value = savedRadius;
    if (vMain) vMain.textContent = (savedRadius / 1000) + ' km';
  }
  // Render in Mes Sites tab
  const cc = el('captageCard');
  if(cc) {cc.style.display='block'; renderCaptageAnalysis('captageContent', lat, lng, effectiveRadius);}
  // Render in Fiche Site tab
  const cs = el('captageCardSite');
  if(cs) {cs.style.display='block'; renderCaptageAnalysis('captageContentSite', lat, lng, effectiveRadius);}
}

function updateCaptageRadiusSite() {
  const r = parseInt(el('captageRadiusSliderSite').value);
  el('captageRadiusValSite').textContent = (r/1000) + ' km';
  if(lastCaptagePoint) {
    // v6.65.1 — persist per-site + cross-device sync + audit log
    const key = lastCaptagePoint.lat.toFixed(3) + ',' + lastCaptagePoint.lng.toFixed(3);
    const before = window._radiusOverrides[key] ?? 3000;
    const siteName = window._lastCaptageLocation?.siteName || key;
    window._radiusOverrides[key] = r;
    window.persistOverrides?.();
    try { logSliderChangeDebounced?.('rayon', before, r, key, siteName); } catch {}
    renderCaptageAnalysis('captageContentSite', lastCaptagePoint.lat, lastCaptagePoint.lng, r);
  }
}

function updateCaptureRatesSite() {
  // v6.65.1 — capture "before" pour audit log (avant mutation des rates)
  const beforeRates = {
    premium: Math.round((CAPTURE_RATES.premium?.rate || 0) * 100),
    midPremium: Math.round((CAPTURE_RATES['mid-premium']?.rate || 0) * 100),
    mid: Math.round((CAPTURE_RATES.mid?.rate || 0) * 100),
    independent: Math.round((CAPTURE_RATES.independent?.rate || 0) * 100),
    lowcost: Math.round((CAPTURE_RATES.lowcost?.rate || 0) * 100),
  };
  CAPTURE_RATES.premium.rate = parseInt(el('crPremS').value)/100;
  CAPTURE_RATES['mid-premium'].rate = parseInt(el('crMidPS').value)/100;
  CAPTURE_RATES.mid.rate = parseInt(el('crMidS').value)/100;
  CAPTURE_RATES.independent.rate = parseInt(el('crIndS').value)/100;
  CAPTURE_RATES.lowcost.rate = parseInt(el('crLowS').value)/100;
  el('crPremValS').textContent=el('crPremS').value+'%';
  el('crMidPValS').textContent=el('crMidPS').value+'%';
  el('crMidValS').textContent=el('crMidS').value+'%';
  el('crIndValS').textContent=el('crIndS').value+'%';
  el('crLowValS').textContent=el('crLowS').value+'%';
  // Sync to Mes Sites sliders too
  if(el('crPrem')){el('crPrem').value=el('crPremS').value;el('crPremVal').textContent=el('crPremS').value+'%'}
  if(el('crMidP')){el('crMidP').value=el('crMidPS').value;el('crMidPVal').textContent=el('crMidPS').value+'%'}
  if(el('crMid')){el('crMid').value=el('crMidS').value;el('crMidVal').textContent=el('crMidS').value+'%'}
  if(el('crInd')){el('crInd').value=el('crIndS').value;el('crIndVal').textContent=el('crIndS').value+'%'}
  if(el('crLow')){el('crLow').value=el('crLowS').value;el('crLowVal').textContent=el('crLowS').value+'%'}
  // v6.65.1 — persist globalement (pas par site, ces sliders sont globaux) + cloud sync
  window._captureRatesOverride = {
    premium: parseInt(el('crPremS').value),
    midPremium: parseInt(el('crMidPS').value),
    mid: parseInt(el('crMidS').value),
    independent: parseInt(el('crIndS').value),
    lowcost: parseInt(el('crLowS').value),
  };
  window.persistOverrides?.();
  // Log : un seul log agrégé par vague d'input (via debounce dans AuditLog.log interne)
  try {
    const afterRates = { ...window._captureRatesOverride, midPremium: window._captureRatesOverride.midPremium };
    const changed = Object.keys(beforeRates).filter(k => beforeRates[k] !== afterRates[k]);
    if (changed.length) {
      logSliderChangeDebounced?.('taux capture', JSON.stringify(beforeRates), JSON.stringify(afterRates), 'global', 'Taux capture concurrents');
    }
  } catch {}
  if(lastCaptagePoint) {
    renderCaptageAnalysis('captageContentSite', lastCaptagePoint.lat, lastCaptagePoint.lng, parseInt(el('captageRadiusSliderSite')?.value||3000));
    renderCaptageAnalysis('captageContent', lastCaptagePoint.lat, lastCaptagePoint.lng, parseInt(el('captageRadiusSlider')?.value||3000));
  }
}

async function updateCannibalization() {
  const card = el('cannibalizationCard');
  if(customSites.filter(s=>!s.deletedAt).length < 2) { card.style.display='none'; return; }
  card.style.display = 'block';
  const allSites = [...TARGETS.map(t=>({name:t.name,lat:t.lat,lng:t.lng,type:'BP'})), ...customSites.filter(s=>!s.deletedAt).map(s=>({name:s.name,lat:s.lat,lng:s.lng,type:'custom'}))];

  let rows = '';
  for(let i=0;i<allSites.length;i++){
    for(let j=i+1;j<allSites.length;j++){
      const risk = await cannibalizeRisk(allSites[i],allSites[j]);
      if(risk.dist < 6000) {
        const riskColor = risk.risk==='critique'?'var(--red)':risk.risk==='significatif'?'var(--orange)':risk.risk==='modere'?'var(--yellow)':'var(--green)';
        const driveLabel = risk.driveMins ? ` • ${risk.driveMins}min 🚗` : '';
        const ov = risk.overlap;
        const overlapLabel = ov ? ` | Overlap: ${ov.overlapPct1}%↔${ov.overlapPct2}% (${fmt(ov.popShared)} hab)` : '';
        rows += `<div style="padding:6px 0;border-bottom:1px solid rgba(71,85,115,.15)">
          <div class="metric-row">
            <span class="metric-label" style="font-size:10px">${allSites[i].name} ↔ ${allSites[j].name}</span>
            <span class="metric-value" style="color:${riskColor};font-size:10px">${(risk.dist/1000).toFixed(1)}km${driveLabel} | ${risk.risk} (${risk.pct}%)</span>
          </div>
          ${ov ? `<div style="font-size:8px;color:var(--gray2);padding-left:4px;margin-top:2px">
            Pop. zone A: ${fmt(ov.pop1)} | Pop. zone B: ${fmt(ov.pop2)} | Partage: ${fmt(ov.popShared)} hab (${ov.overlapPct1}%↔${ov.overlapPct2}%)
            ${ov.sharedCartiere.length > 0 ? '<br>Quartiers partages: ' + ov.sharedCartiere.slice(0,5).join(', ') + (ov.sharedCartiere.length > 5 ? '...' : '') : ''}
          </div>` : ''}
        </div>`;
      }
    }
  }
  el('cannibalizationContent').innerHTML = rows || '<p style="font-size:11px;color:var(--green)">Aucun risque de cannibalisation detecte (&gt;5km entre sites)</p>';
}

// ================================================================
// SEARCH
// ================================================================
function initSearch() {
  let timeout;
  const inp=el('searchInput'),res=el('searchResults');
  inp.addEventListener('input',()=>{clearTimeout(timeout);const q=inp.value.trim();if(q.length<3){res.classList.remove('active');return}timeout=setTimeout(()=>searchAddr(q),400)});
  // v6.95 — Entrée = ÉTUDE IMMÉDIATE sur la meilleure adresse, sans avoir à
  // cliquer un résultat du menu. "Je pointe l'adresse → l'étude se lance."
  inp.addEventListener('keydown',(e)=>{
    if(e.key!=='Enter') return;
    e.preventDefault(); clearTimeout(timeout);
    runSearchStudy(inp.value.trim());
  });
  document.addEventListener('click',e=>{if(!e.target.closest('.search-wrap'))res.classList.remove('active')});
}

// v6.95 — géocodage robuste, partagé par le menu déroulant ET la touche
// Entrée. Corrige le bug : l'ancienne requête ajoutait « , Bucharest,
// Romania » à une adresse déjà complète (avec code postal) → 0 résultat.
// Ici : requête BRUTE + countrycodes=ro + biais viewbox Bucarest (pas
// borné, pour ne pas exclure la métropole). Google d'abord si la clé
// marche (souvent bloquée en prod → try/catch → repli OSM propre).
async function geocodeAddr(q) {
  q = (q || '').trim();
  if (!q) return [];
  if (_googleHasKey()) {
    try {
      const gData = await googleFetch(`${GOOGLE_PLACES_URL}:searchText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOGLE_API_KEY,
          'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location' },
        body: JSON.stringify({ textQuery: q, regionCode: 'RO',
          locationBias: { circle: { center: { latitude: 44.4268, longitude: 26.1025 }, radius: 30000 } },
          maxResultCount: 5 })
      });
      const hits = (gData?.places || []).map(p => ({
        lat: p.location?.latitude, lng: p.location?.longitude,
        label: ((p.displayName?.text || '') + ' — ' + (p.formattedAddress || '')).replace(/ — $/,'').slice(0, 80), src: 'Google'
      })).filter(h => h.lat != null && h.lng != null);
      if (hits.length) return hits;
    } catch (e) { /* clé bloquée / quota → repli OSM */ }
  }
  // Nominatim RO, biais Bucarest (viewbox = lon_min,lat_max,lon_max,lat_min)
  const vb = '25.90,44.60,26.35,44.30';
  const url = `${NOMINATIM}/search?format=jsonv2&q=${encodeURIComponent(q)}&limit=6&countrycodes=ro&addressdetails=1&viewbox=${vb}&bounded=0`;
  const r = await fetch(url, { headers: { 'Accept-Language': 'fr,ro,en' } });
  const data = await r.json();
  return (Array.isArray(data) ? data : []).map(d => ({
    lat: +d.lat, lng: +d.lon, label: (d.display_name || '').slice(0, 80), src: 'OSM'
  })).filter(h => isFinite(h.lat) && isFinite(h.lng));
}

const _searchMsg = (html, color) => {
  const res = el('searchResults');
  if (!res) return;
  res.innerHTML = `<div class="search-result-item" style="color:${color || 'var(--gray2)'};cursor:default">${html}</div>`;
  res.classList.add('active');
};

async function searchAddr(q) {
  _searchMsg('Recherche d’adresse…');
  try {
    const hits = await geocodeAddr(q);
    window._searchHits = { q, hits };
    const res = el('searchResults');
    if (!hits.length) { _searchMsg('Aucune adresse trouvée — précise la rue et le numéro'); return; }
    res.innerHTML = hits.map(h =>
      `<div class="search-result-item" onclick="pickSearch(${h.lat},${h.lng},decodeURIComponent('${encodeURIComponent(h.label)}'))">📍 ${h.label} <span style="color:var(--accent);font-size:8px">${h.src}</span></div>`
    ).join('') + `<div style="padding:6px 10px;font-size:9px;color:var(--gray2);border-top:1px solid var(--border)">↵ Entrée = étudier directement la 1ʳᵉ adresse</div>`;
    res.classList.add('active');
  } catch (e) { console.error('Search:', e); _searchMsg('Service d’adresses momentanément indisponible — réessaie', 'var(--red)'); }
}

// Entrée : géocode (ou réutilise le dernier résultat) puis lance l'étude
// immédiate sur la meilleure adresse.
async function runSearchStudy(q) {
  if (!q || q.length < 3) return;
  _searchMsg('📍 Localisation & étude de potentiel en cours…', 'var(--accent)');
  try {
    const cache = window._searchHits;
    const hits = (cache && cache.q === q && cache.hits.length) ? cache.hits : await geocodeAddr(q);
    if (!hits.length) { _searchMsg('Aucune adresse trouvée — précise la rue et le numéro'); return; }
    pickSearch(hits[0].lat, hits[0].lng, hits[0].label);
  } catch (e) { console.error('Search study:', e); _searchMsg('Service d’adresses momentanément indisponible — réessaie', 'var(--red)'); }
}

function pickSearch(lat, lng, label) {
  el('searchResults').classList.remove('active');
  lat = parseFloat(lat); lng = parseFloat(lng);
  if (label) {
    const short = label.length > 52 ? label.slice(0, 52) + '…' : label;
    const inp = el('searchInput'); if (inp) inp.value = short;
    window._searchSiteName = label;
  }
  map.flyTo([lat, lng], 15);
  setTimeout(async () => {
    try { await onMapClick({ latlng: { lat, lng } }); } catch (e) { console.error('pickSearch analyse:', e); }
    // v6.95 — l'étude est prête dans la Fiche : on y amène l'utilisateur et
    // on le guide vers la seule saisie restante pour le BP : loyer + charges.
    if (label && window._lastCaptageLocation) window._lastCaptageLocation.siteName = label;
    try { switchTab('site'); } catch {}
    setTimeout(guideToRentStep, 500);
  }, 550);
}

// Amène le bloc "conditions locatives" (loyer/charges) dans le champ de
// vision + flash doré + bulle "→ ajuste puis Éditer BP".
function guideToRentStep() {
  const anchor = document.getElementById('rentSlider') || document.getElementById('rent-slider-label');
  const block = anchor ? anchor.closest('.card, [id^="financing"], div') : null;
  const target = block || anchor;
  if (!target) return;
  try { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
  target.style.transition = 'box-shadow .4s ease';
  const prev = target.style.boxShadow;
  target.style.boxShadow = '0 0 0 2px var(--accent), 0 0 24px rgba(212,160,23,.4)';
  setTimeout(() => { target.style.boxShadow = prev; }, 2200);
  try { window.showToast?.('Site étudié — ajuste loyer & charges, puis « Éditer BP » pour le business plan.', 'success', { title: '📝 Dernière étape' }); } catch {}
}
window.pickSearch = pickSearch;
window.runSearchStudy = runSearchStudy;

// ================================================================
// TABS
// ================================================================
function initTabs() {
  document.querySelectorAll('.tab').forEach(t=>{
    t.addEventListener('click',()=>switchTab(t.dataset.tab));
  });
}
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===name));
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.toggle('active',p.id==='tab-'+name));
  // v7.02 — filet de sécurité : à chaque ouverture d'Explorer/Concurrence, on
  // (re)garantit que les chips de marques sont présentes (jamais de boîte vide).
  if (name === 'explore' || name === 'compete') { try { buildBrandFilters(); } catch {} }
  // Peupler les compareSelects avec TARGETS dès l'ouverture — sinon l'user voit
  // des dropdowns quasi-vides tant qu'aucune zone n'a été analysée.
  if(name==='dash' && typeof updateCompareSelects==='function') updateCompareSelects();
  // Force re-render desktop "Mes Sites" à chaque ouverture du tab — defensive
  // fix v6.27 : si le state localStorage a été modifié hors session (mobile,
  // autre tab, hard refresh sans wipe), la liste desktop pouvait rester vide.
  if(name==='mysites') {
    if (typeof _loadCustomSites === 'function') _loadCustomSites();
    if (typeof refreshCustomMarkers === 'function') refreshCustomMarkers();
    if (typeof renderCustomSites === 'function') renderCustomSites();
    // v6.49 — pull cloud immédiat pour attraper les modifs faites depuis iPhone
    // avant d'afficher la liste. Sans attendre le polling 5s.
    try {
      window.cloudSync?.pull?.().then(() => {
        if (typeof renderCustomSites === 'function') renderCustomSites();
        if (typeof refreshCustomMarkers === 'function') refreshCustomMarkers();
      });
    } catch {}
  }
}

// ================================================================
// SIDEBAR RENDER
// ================================================================
function renderSectorList() {
  const tr = (k) => (typeof window.t === 'function' ? window.t(k) : k);
  el('sectorList').innerHTML=SECTORS.map(s=>{
    const popT=Math.round(s.pop*s.youngPct);
    return `<div class="sector-row" onclick="zoomSector(${s.id})">
      <div class="sector-num" style="background:${s.color}20;color:${s.color}">${s.id}</div>
      <div class="sector-body">
        <h4>${s.name}</h4>
        <p>${s.desc}</p>
        <p>${tr('dsector.row.pop')}: ${fmt(s.pop)} | ${tr('dsector.row.youngRange')}: ${fmt(popT)} | ${s.income}</p>
      </div>
      <div class="sector-saz" id="sazS${s.id}" style="color:var(--gray2)">—</div>
    </div>`;
  }).join('');
}

function renderTargets() {
  el('targetSites').innerHTML=TARGETS.map(t=>`
    <div class="target-card ${t.phase===2?'phase2':''}" onclick="flyTarget(${t.lat},${t.lng})">
      <div class="target-phase" style="background:${t.phase===1?'rgba(212,160,23,.15)':'rgba(59,130,246,.15)'};color:${t.phase===1?'var(--accent)':'var(--blue)'}">P${t.phase}</div>
      <div class="target-body">
        <h4>${t.name}</h4>
        <p>S${t.sector} | ${t.area} | ${t.rent}</p>
        <div class="target-status" style="color:${t.status.includes('securise')?'var(--green)':'var(--yellow)'}">${t.status} — ${t.opening}</div>
      </div>
    </div>
  `).join('');

  // Desktop target pins on map (v6.31) — même style doré que custom sites pour
  // uniformité visuelle (demande Paul 2026-04-20). Mobile a déjà ses propres
  // pins numérotés via src/mobile.js.
  renderTargetPinsDesktop();
}

// Layer + renderer pour les 5 TARGETS desktop. Pins dorés avec numéro.
let targetMarkersLayer = (typeof L !== 'undefined') ? L.layerGroup() : null;
function renderTargetPinsDesktop() {
  if (!targetMarkersLayer || typeof map === 'undefined') return;
  // Mobile (≤ 768px) gère ses propres pins via src/mobile.js — éviter doublons.
  if (window.innerWidth <= 768) { targetMarkersLayer.clearLayers(); return; }
  // v6.55 — si fp-logos.js (defer) pas encore chargé, retry dans 100ms plutôt
  // que d'afficher le fallback HTML simplifié "FP N" (bug desktop signalé par Paul).
  if (typeof window.fpLogoPinHTML !== 'function') {
    setTimeout(renderTargetPinsDesktop, 100);
    return;
  }
  targetMarkersLayer.clearLayers();
  TARGETS.forEach((t, i) => {
    // v6.51 — pin FP fidèle image (size 48 + animations apple-like)
    const pinHtml = (typeof window.fpLogoPinHTML === 'function')
      ? window.fpLogoPinHTML({ size: 48, num: i + 1 })
      : `<div style="width:48px;height:48px;background:#f3f4f6;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:900;color:#1f2937">FP ${i+1}</div>`;
    const icon = L.divIcon({ className: '', html: pinHtml, iconSize: [56, 56], iconAnchor: [28, 28] });
    const mk = L.marker([t.lat, t.lng], { icon });
    const esc = (typeof escapeHtml === 'function') ? escapeHtml : (s => String(s||''));
    mk.bindPopup(`<h3>${esc(t.name)}</h3>
      <div class="ps"><span>Phase</span><span class="pv">P${t.phase}</span></div>
      <div class="ps"><span>Secteur</span><span class="pv">S${esc(t.sector)}</span></div>
      <div class="ps"><span>Surface</span><span class="pv">${esc(t.area)}</span></div>
      <div class="ps"><span>Loyer</span><span class="pv">${esc(t.rent)}</span></div>
      <div class="ps"><span>Statut</span><span class="pv">${esc(t.status)}</span></div>
      <div style="margin-top:6px"><a href="#" onclick="flyTarget(${t.lat},${t.lng});return false" style="color:#d4a017;font-size:11px;font-weight:600">Centrer carte &rarr;</a></div>`);
    targetMarkersLayer.addLayer(mk);
  });
  if (!map.hasLayer(targetMarkersLayer)) map.addLayer(targetMarkersLayer);
}

function zoomSector(id) {
  const s=SECTORS.find(x=>x.id===id);
  if(!s)return;
  map.flyTo(s.center,14);
  if(analysisMode) setTimeout(()=>onMapClick({latlng:{lat:s.center[0],lng:s.center[1]}}),500);
}

function flyTarget(lat,lng) {
  map.flyTo([lat,lng],15);
  if(analysisMode) setTimeout(()=>onMapClick({latlng:{lat,lng}}),500);
}

// ================================================================
// DEMO MODE
// ================================================================
function toggleDemoMode() {
  demo=!demo;
  el('demoBanner').classList.toggle('on',demo);
  document.getElementById('btnDemo')?.classList.toggle('active', demo);
  setStatus(demo?'warn':'ok',demo?'Mode demo actif':'APIs connectees'+(_googleHasKey()?' + Google':''));
  if(demo) {
    allComps=DEMO_COMPS.map(c=>({...c,id:Math.random(),source:'demo',est:false,color:segColor(c.segment),threat:segThreat(c.segment),brand:'local'}));
    lastDisplayedComps=allComps;
    showCompsOnMap(allComps);
    buildBrandFilters(allComps);
    if(!layers.competitors){layers.competitors=true;el('tglCompetitors').classList.add('on')}
  } else {
    // v6.70.1 — sortir du mode démo NETTOIE la carte (avant: les clubs démo
    // restaient affichés sans moyen de les retirer)
    compCluster.clearLayers();
    allComps=[]; lastDisplayedComps=[];
    layers.competitors=false;
    el('tglCompetitors')?.classList.remove('on');
    document.getElementById('btnLoadComp')?.classList.remove('active');
  }
}

// v6.70.1 — le bouton Actions "Charger concurrents" est un TOGGLE:
// 1er clic charge + affiche, 2e clic masque les clusters. (Les appels
// programmatiques — tests, heatmap — continuent d'utiliser
// loadAllCompetitors directement, comportement inchangé.)
function toggleCompetitorsAction() {
  const btn = document.getElementById('btnLoadComp');
  if (layers.competitors && allComps.length) {
    compCluster.clearLayers();
    layers.competitors = false;
    el('tglCompetitors')?.classList.remove('on');
    btn?.classList.remove('active');
    setStatus('ok', 'Concurrents masqués');
  } else {
    btn?.classList.add('active');
    loadAllCompetitors();
  }
}

// ================================================================
// ANALYSIS MODE
// ================================================================
let analysisMode = false;

function toggleAnalysisMode() {
  analysisMode = !analysisMode;
  el('tglAnalysis').classList.toggle('on', analysisMode);
  map.getContainer().style.cursor = analysisMode ? 'crosshair' : '';
  if(!analysisMode) clearAnalysis();
}

function clearAnalysis() {
  if(circle) { map.removeLayer(circle); circle = null; }
  if(radiusHandle) { map.removeLayer(radiusHandle); radiusHandle = null; }
  if(popLabel) { map.removeLayer(popLabel); popLabel = null; }
  if(isoLayer) { map.removeLayer(isoLayer); isoLayer = null; }
  selectedPt = null;
  el('pointBox').style.display = 'none';
  el('sazBox').style.display = 'none';
}

// Exit analysis mode — clears everything and hides all analysis panels
function exitAnalysis() {
  clearAnalysis();
  // Hide analysis cards
  const cards = ['siteAnalysisCard','captageCard','captageCardSite'];
  cards.forEach(id => { const c = el(id); if(c) c.style.display = 'none'; });
  // Reset iso mode
  isoMode = 'circle';
  document.querySelectorAll('.iso-btn').forEach(b => {
    b.style.cssText = 'font-size:9px;' + (b.id.includes('Circle') ? 'background:rgba(212,160,23,.3);border-color:var(--accent);color:white' : '');
  });
  // Switch back to main tab if on fiche site tab
  const tabs = document.querySelectorAll('.tab-btn');
  if(tabs.length > 0) tabs[0].click();
}

// ================================================================
// RADIUS
// ================================================================
let _radiusDebounce = null;

function setRadius(r) {
  radius=r;
  document.querySelectorAll('.radius-pill').forEach(p=>p.classList.toggle('active',parseInt(p.dataset.r)===r));
  syncRadiusSlider();
  if(selectedPt) onMapClick({latlng:selectedPt});
}

function setRadiusFromSlider(val) {
  radius = parseInt(val);
  el('radiusSliderLabel').textContent = (radius/1000).toFixed(1) + ' km';
  // Highlight matching pill or deselect all
  document.querySelectorAll('.radius-pill').forEach(p=>p.classList.toggle('active',parseInt(p.dataset.r)===radius));
  // Update circle live if visible
  if(circle) circle.setRadius(radius);
  if(radiusHandle && selectedPt) {
    const handleLng = selectedPt.lng + (radius / 111320 / Math.cos(selectedPt.lat * Math.PI/180));
    radiusHandle.setLatLng([selectedPt.lat, handleLng]);
  }
  // Debounce the full re-analysis (avoid spamming API on every slider tick)
  if(_radiusDebounce) clearTimeout(_radiusDebounce);
  _radiusDebounce = setTimeout(() => {
    if(selectedPt) onMapClick({latlng:selectedPt});
  }, 400);
}

function syncRadiusSlider() {
  const s = el('radiusSlider');
  if(s) { s.value = radius; }
  const l = el('radiusSliderLabel');
  if(l) l.textContent = (radius/1000).toFixed(1) + ' km';
  // Also sync fiche site slider if present
  const fs = el('ficheRadiusSlider');
  if(fs) fs.value = radius;
  const fl = el('ficheRadiusLabel');
  if(fl) fl.textContent = (radius/1000).toFixed(1) + ' km';
}

// Live update population stats in fiche site header when radius changes
function updateFichePopStats() {
  if(!selectedPt) return;
  const popG = estimatePopInRadiusGranular(selectedPt.lat, selectedPt.lng, radius);
  const compsInR = getDemoInRadius(selectedPt.lat, selectedPt.lng, radius);
  // Update header numbers
  const cible = el('ficheCible1545');
  if(cible) cible.textContent = fmt(popG.target);
  const nbC = el('ficheNbComps');
  if(nbC) { nbC.textContent = compsInR.length; nbC.style.color = compsInR.length>10?'var(--red)':compsInR.length>5?'var(--yellow)':'var(--green)'; }
  // Update population zone section
  const sub = el('ficheSubtitle');
  if(sub) sub.textContent = sub.textContent.replace(/R=[\d.]+km/, `R=${radius/1000}km`);
  const title = el('popZoneTitle');
  if(title) title.textContent = `POPULATION ZONE (R=${radius/1000}km) — Calcul par quartier`;
  const popT = el('fichePopTotal');
  if(popT) popT.textContent = fmt(popG.pop);
  const popTgt = el('fichePopTarget');
  if(popTgt) popTgt.textContent = fmt(popG.target);
  const prix = el('fichePrixMoyen');
  if(prix) prix.textContent = fmt(popG.avgPrice) + ' EUR/m2';
}

// Radius controls from Fiche Site panel — syncs with main panel + updates map
function setRadiusFromFiche(r) {
  radius = r;
  syncRadiusSlider();
  // Update circle visually
  if(circle) circle.setRadius(radius);
  if(radiusHandle && selectedPt) {
    const handleLng = selectedPt.lng + (radius / 111320 / Math.cos(selectedPt.lat * Math.PI/180));
    radiusHandle.setLatLng([selectedPt.lat, handleLng]);
  }
  // Instant population update in fiche
  updateFichePopStats();
  // Full re-analysis (captage etc.)
  if(selectedPt) onMapClick({latlng:selectedPt});
}

function setRadiusFromFicheSlider(val) {
  radius = parseInt(val);
  const fl = el('ficheRadiusLabel');
  if(fl) fl.textContent = (radius/1000).toFixed(1) + ' km';
  // Sync main slider too
  syncRadiusSlider();
  // Update circle live
  if(circle) circle.setRadius(radius);
  if(radiusHandle && selectedPt) {
    const handleLng = selectedPt.lng + (radius / 111320 / Math.cos(selectedPt.lat * Math.PI/180));
    radiusHandle.setLatLng([selectedPt.lat, handleLng]);
  }
  // INSTANT population update in header (no debounce)
  updateFichePopStats();
  // Debounce full analysis
  if(_radiusDebounce) clearTimeout(_radiusDebounce);
  _radiusDebounce = setTimeout(() => {
    if(selectedPt) onMapClick({latlng:selectedPt});
  }, 400);
}

// ================================================================
// ISOCHRONES — Real travel-time catchment areas
// ================================================================
let isoMode = 'circle'; // 'circle' | 'walk' | 'drive' | 'transit'
let isoLayer = null;

function setIsoMode(mode) {
  // Toggle: clicking the active mode hides the isochrone
  if(mode === isoMode && mode !== 'circle') {
    // Hide isochrone layer
    if(isoLayer) { map.removeLayer(isoLayer); isoLayer = null; }
    isoMode = 'circle';
    // Restore circle full opacity
    if(circle) circle.setStyle({fillOpacity: 0.06});
  } else if(mode === isoMode && mode === 'circle') {
    return; // already on circle, nothing to toggle
  } else {
    isoMode = mode;
    // Draw new isochrone (only if a point is selected)
    if(selectedPt) {
      if(isoMode !== 'circle') {
        drawIsochrone(selectedPt.lat, selectedPt.lng);
        if(circle) circle.setStyle({fillOpacity: 0.02}); // dim circle behind isochrone
      } else {
        if(isoLayer) { map.removeLayer(isoLayer); isoLayer = null; }
        if(circle) circle.setStyle({fillOpacity: 0.06});
      }
    }
  }
  // Update ALL iso buttons across both panels (main + fiche site)
  document.querySelectorAll('.iso-btn').forEach(b => {
    const isActive =
      (isoMode==='walk' && b.id.includes('Walk')) ||
      (isoMode==='drive' && b.id.includes('Drive')) ||
      (isoMode==='transit' && b.id.includes('Transit')) ||
      (isoMode==='circle' && b.id.includes('Circle'));
    b.style.cssText = 'font-size:9px;' + (isActive ? 'background:rgba(212,160,23,.3);border-color:var(--accent);color:white' : '');
  });
}

// Google Routes API — Isochrone generation
// Sends routes in N directions from center, collects reachable points to build polygon
async function googleIsochrone(lat, lng, travelMode, timeLimitSec, maxDistOverride) {
  if (!_googleHasKey()) return null;
  const DIRECTIONS = 24; // 24 rays every 15°
  const destinations = [];
  const maxDist = maxDistOverride || (travelMode === 'WALK' ? 0.015 : 0.06);

  for (let i = 0; i < DIRECTIONS; i++) {
    const angle = (i * 360 / DIRECTIONS) * Math.PI / 180;
    destinations.push({
      lat: lat + maxDist * Math.cos(angle),
      lng: lng + maxDist * Math.sin(angle)
    });
  }

  // Use Routes API computeRoutes for each direction
  const points = [];
  const batchSize = 6;
  for (let i = 0; i < destinations.length; i += batchSize) {
    const batch = destinations.slice(i, i + batchSize);
    const promises = batch.map(async (dest, idx) => {
      try {
        const resp = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': GOOGLE_API_KEY,
            'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.legs.steps.endLocation'
          },
          body: JSON.stringify({
            origin: { location: { latLng: { latitude: lat, longitude: lng } } },
            destination: { location: { latLng: { latitude: dest.lat, longitude: dest.lng } } },
            travelMode: travelMode,
            routingPreference: travelMode === 'DRIVE' ? 'TRAFFIC_AWARE' : undefined,
            ...(travelMode === 'TRANSIT' ? { transitPreferences: { routingPreference: 'LESS_WALKING' } } : {})
          })
        });
        const data = await resp.json();
        if (data.routes && data.routes[0]) {
          const route = data.routes[0];
          const durationSec = parseInt(route.duration?.replace('s','') || '9999');
          const distM = route.distanceMeters || 0;
          // If route is within time limit, use endpoint; otherwise interpolate
          if (durationSec <= timeLimitSec) {
            return { lat: dest.lat, lng: dest.lng, dur: durationSec };
          } else {
            // Scale back proportionally
            const ratio = timeLimitSec / durationSec;
            const steps = route.legs?.[0]?.steps;
            if (steps && steps.length > 1) {
              const targetIdx = Math.min(Math.floor(steps.length * ratio), steps.length - 1);
              const step = steps[targetIdx];
              return { lat: step.endLocation?.latLng?.latitude || lat, lng: step.endLocation?.latLng?.longitude || lng, dur: timeLimitSec };
            }
            return { lat: lat + (dest.lat-lat)*ratio, lng: lng + (dest.lng-lng)*ratio, dur: timeLimitSec };
          }
        }
        return null;
      } catch(e) { return null; }
    });
    const results = await Promise.all(promises);
    results.forEach(r => { if(r) points.push(r); });
  }

  if (points.length < 3) return null;

  // Sort points by angle to create a proper polygon
  points.sort((a,b) => {
    const angA = Math.atan2(a.lng - lng, a.lat - lat);
    const angB = Math.atan2(b.lng - lng, b.lat - lat);
    return angA - angB;
  });

  // Build GeoJSON polygon
  const coords = points.map(p => [p.lng, p.lat]);
  coords.push(coords[0]); // close polygon
  return {
    type: 'Feature',
    properties: { duration: timeLimitSec, mode: travelMode, points: points.length },
    geometry: { type: 'Polygon', coordinates: [coords] }
  };
}

// Fallback to ORS if Google fails
async function fetchIsochroneORS(lat, lng, profile, rangeSeconds) {
  const apiKey = localStorage.getItem('orsKey');
  if(!apiKey) return null;
  try {
    const resp = await fetch(`https://api.openrouteservice.org/v2/isochrones/${profile}`, {
      method: 'POST',
      headers: { 'Authorization': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ locations: [[lng, lat]], range: [rangeSeconds], range_type: 'time', smoothing: 25, attributes: ['area'] })
    });
    if(!resp.ok) return null;
    const data = await resp.json();
    return data?.features?.[0] || null;
  } catch(e) { return null; }
}

// ---- WALK isochrone — smooth circle at walking speed (no API needed) ----
// Walking is nearly isotropic (no road constraints), so a circle is accurate
// Seeded variation for organic but deterministic shape
function walkIsochrone(lat, lng, timeLimitMin) {
  const walkSpeed = 80; // m/min average urban walking
  const distM = walkSpeed * timeLimitMin; // ~800m for 10 min
  const N = 48; // smooth circle
  const coords = [];
  for(let i = 0; i < N; i++) {
    const angle = (i * 360 / N) * Math.PI / 180;
    // Deterministic organic variation based on angle (simulates blocks/roads)
    const jitter = 1.0 + 0.12 * Math.sin(angle * 3.7) + 0.08 * Math.cos(angle * 5.3);
    const dLat = (distM * jitter / 111320) * Math.cos(angle);
    const dLng = (distM * jitter / (111320 * Math.cos(lat * Math.PI/180))) * Math.sin(angle);
    coords.push([lng + dLng, lat + dLat]);
  }
  coords.push(coords[0]);
  return {
    type: 'Feature',
    properties: { duration: timeLimitMin * 60, mode: 'WALK', points: N },
    geometry: { type: 'Polygon', coordinates: [coords] }
  };
}

// ---- TRANSIT isochrone — metro stations + walking bubbles merged ----
// Bucharest metro network: 4 lines, 63 stations
const METRO_STATIONS = [
  // M1 (Dristor→Pantelimon + Republica)
  {name:'Dristor 1',lat:44.4175,lng:26.1395},{name:'Piata Muncii',lat:44.4220,lng:26.1450},
  {name:'Iancului',lat:44.4300,lng:26.1290},{name:'Obor',lat:44.4480,lng:26.1250},
  {name:'Stefan cel Mare',lat:44.4505,lng:26.1130},{name:'Piata Victoriei 1',lat:44.4528,lng:26.0854},
  {name:'Gara de Nord 1',lat:44.4465,lng:26.0700},{name:'Basarab 1',lat:44.4520,lng:26.0650},
  {name:'Crangasi',lat:44.4500,lng:26.0470},{name:'Grozavesti',lat:44.4350,lng:26.0610},
  {name:'Eroilor 1',lat:44.4355,lng:26.0720},{name:'Izvor',lat:44.4320,lng:26.0900},
  {name:'Piata Unirii 1',lat:44.4275,lng:26.1040},{name:'Timpuri Noi',lat:44.4185,lng:26.1080},
  {name:'Mihai Bravu',lat:44.4180,lng:26.1275},{name:'Dristor 2',lat:44.4175,lng:26.1395},
  {name:'Nicolae Grigorescu',lat:44.4165,lng:26.1520},{name:'Titan',lat:44.4155,lng:26.1600},
  {name:'1 Decembrie',lat:44.4150,lng:26.1680},{name:'Republica',lat:44.4130,lng:26.1770},
  // M2 (Pipera→Berceni)
  {name:'Pipera',lat:44.4793,lng:26.1217},{name:'Aurel Vlaicu',lat:44.4729,lng:26.1166},
  {name:'Aviatorilor',lat:44.4615,lng:26.0899},{name:'Piata Victoriei 2',lat:44.4528,lng:26.0854},
  {name:'Piata Romana',lat:44.4476,lng:26.0970},{name:'Universitate',lat:44.4358,lng:26.1020},
  {name:'Piata Unirii 2',lat:44.4275,lng:26.1040},{name:'Tineretului',lat:44.4100,lng:26.1050},
  {name:'Eroii Revolutiei',lat:44.4020,lng:26.0980},{name:'Constantin Brancoveanu',lat:44.3960,lng:26.0960},
  {name:'Piata Sudului',lat:44.3890,lng:26.0990},{name:'Aparatorii Patriei',lat:44.3810,lng:26.1070},
  {name:'Dimitrie Leonida',lat:44.3740,lng:26.1100},
  // M3 (Preciziei→Anghel Saligny)
  {name:'Preciziei',lat:44.4280,lng:26.0050},{name:'Pacii',lat:44.4310,lng:26.0190},
  {name:'Gorjului',lat:44.4290,lng:26.0090},{name:'Lujerului',lat:44.4315,lng:26.0280},
  {name:'Politehnica',lat:44.4380,lng:26.0500},{name:'Eroilor 2',lat:44.4355,lng:26.0720},
  {name:'Semnatoarea',lat:44.4330,lng:26.0780},{name:'1 Mai',lat:44.4670,lng:26.0700},
  {name:'Pajura',lat:44.4750,lng:26.0690},{name:'Jiului',lat:44.4730,lng:26.0620},
  // M4 (Gara de Nord→Străulești)
  {name:'Gara de Nord 2',lat:44.4465,lng:26.0700},{name:'Basarab 2',lat:44.4520,lng:26.0650},
  {name:'Laminorului',lat:44.4640,lng:26.0620},{name:'Straulesti',lat:44.4810,lng:26.0580},
  // M5 (Drumul Taberei→Eroilor)
  {name:'Raul Doamnei',lat:44.4225,lng:26.0160},{name:'Constantin Brancusi',lat:44.4240,lng:26.0040},
  {name:'Romancierilor',lat:44.4130,lng:26.0180},{name:'Drumul Taberei 34',lat:44.4170,lng:26.0280},
  {name:'Favorit',lat:44.4130,lng:26.0360},{name:'Orizont',lat:44.4130,lng:26.0490},
  {name:'Academia Militara',lat:44.4200,lng:26.0640},{name:'Eroilor 3',lat:44.4355,lng:26.0720}
];

function transitIsochrone(lat, lng, timeLimitMin) {
  const walkSpeed = 80; // m/min
  const metroSpeed = 600; // m/min (~36 km/h with stops, Bucharest metro)
  const walkToMetroBuffer = 0.5; // 30s buffer for entering station

  // Find all stations within walking distance
  const stationsWithDist = METRO_STATIONS.map(s => ({
    ...s, dist: haversine(lat, lng, s.lat, s.lng),
    walkMin: haversine(lat, lng, s.lat, s.lng) / walkSpeed
  })).filter(s => s.walkMin <= timeLimitMin); // reachable by walk alone

  // Sort by walking time
  stationsWithDist.sort((a,b) => a.walkMin - b.walkMin);

  // If no station reachable → walking-only isochrone
  if(stationsWithDist.length === 0 || stationsWithDist[0].walkMin + walkToMetroBuffer >= timeLimitMin) {
    return walkIsochrone(lat, lng, timeLimitMin);
  }

  // Build reachable station set: for each walkable station, find metro-reachable stations
  const reachableSet = new Map(); // stationName → {station, arrivalMin}

  stationsWithDist.forEach(entry => {
    const arriveAtStation = entry.walkMin + walkToMetroBuffer;
    if(arriveAtStation >= timeLimitMin) return;
    const metroTimeRemain = timeLimitMin - arriveAtStation;
    const metroRangeM = metroSpeed * metroTimeRemain;

    // This station itself is reachable
    if(!reachableSet.has(entry.name) || reachableSet.get(entry.name).arrivalMin > arriveAtStation) {
      reachableSet.set(entry.name, { ...entry, arrivalMin: arriveAtStation });
    }

    // Find stations reachable by metro from this entry station
    METRO_STATIONS.forEach(s2 => {
      const metroDist = haversine(entry.lat, entry.lng, s2.lat, s2.lng);
      if(metroDist <= metroRangeM) {
        const totalArrival = arriveAtStation + metroDist / metroSpeed;
        if(totalArrival < timeLimitMin) {
          if(!reachableSet.has(s2.name) || reachableSet.get(s2.name).arrivalMin > totalArrival) {
            reachableSet.set(s2.name, { ...s2, arrivalMin: totalArrival });
          }
        }
      }
    });
  });

  // Build merged polygon: union of walking circles from origin + each reachable station
  // Using multi-circle approach rendered as a single MultiPolygon
  const circles = [];

  // Walking circle from origin (full 10 min)
  const originCircle = makeCircleCoords(lat, lng, walkSpeed * timeLimitMin, 36);
  circles.push(originCircle);

  // Walking circle from each reachable station (remaining time)
  reachableSet.forEach(({lat: sLat, lng: sLng, arrivalMin, name}) => {
    const remainMin = timeLimitMin - arrivalMin;
    const walkRangeM = walkSpeed * remainMin;
    if(walkRangeM >= 100) { // at least 100m radius
      circles.push(makeCircleCoords(sLat, sLng, walkRangeM, 24));
    }
  });

  // Merge into single polygon using point union + convex hull
  const allPts = [];
  circles.forEach(c => c.forEach(p => allPts.push({lat: p[1], lng: p[0]})));
  const hull = convexHull(allPts);
  const coords = hull.map(p => [p.lng, p.lat]);
  coords.push(coords[0]);

  return {
    type: 'Feature',
    properties: { duration: timeLimitMin * 60, mode: 'TRANSIT', points: hull.length, stations: reachableSet.size },
    geometry: { type: 'Polygon', coordinates: [coords] }
  };
}

// Helper: generate circle coordinates [lng, lat] for a given center and radius
function makeCircleCoords(lat, lng, radiusM, numPoints) {
  const coords = [];
  for(let i = 0; i < numPoints; i++) {
    const angle = (i * 360 / numPoints) * Math.PI / 180;
    // Deterministic slight variation for natural shape
    const jitter = 1.0 + 0.08 * Math.sin(angle * 4.1) + 0.05 * Math.cos(angle * 6.7);
    const dLat = (radiusM * jitter / 111320) * Math.cos(angle);
    const dLng = (radiusM * jitter / (111320 * Math.cos(lat * Math.PI/180))) * Math.sin(angle);
    coords.push([lng + dLng, lat + dLat]);
  }
  return coords;
}

// Convex hull — Andrew's monotone chain (more robust than Graham scan)
function convexHull(points) {
  if(points.length < 3) return points;
  const pts = points.slice().sort((a,b) => a.lng - b.lng || a.lat - b.lat);

  // Build lower hull
  const lower = [];
  for(const p of pts) {
    while(lower.length >= 2) {
      const a = lower[lower.length-2], b = lower[lower.length-1];
      if((b.lng-a.lng)*(p.lat-a.lat) - (b.lat-a.lat)*(p.lng-a.lng) <= 0) lower.pop();
      else break;
    }
    lower.push(p);
  }
  // Build upper hull
  const upper = [];
  for(let i = pts.length-1; i >= 0; i--) {
    const p = pts[i];
    while(upper.length >= 2) {
      const a = upper[upper.length-2], b = upper[upper.length-1];
      if((b.lng-a.lng)*(p.lat-a.lat) - (b.lat-a.lat)*(p.lng-a.lng) <= 0) upper.pop();
      else break;
    }
    upper.push(p);
  }
  // Remove last point of each half (it's repeated)
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

async function drawIsochrone(lat, lng) {
  if(isoMode === 'circle') return;

  if(isoLayer) { map.removeLayer(isoLayer); isoLayer = null; }

  const modeMap = {
    walk:    { api:'WALK',    color:'#22c55e', label:'10 min à pied',     ors:'foot-walking', maxDist:0.015, speed:80  },
    drive:   { api:'DRIVE',   color:'#3b82f6', label:'10 min en voiture', ors:'driving-car',  maxDist:0.06,  speed:null },
    transit: { api:'TRANSIT', color:'#a855f7', label:'10 min en métro',   ors:null,           maxDist:0.04,  speed:null }
  };
  const cfg = modeMap[isoMode] || modeMap.drive;

  showLoad('Calcul isochrone...', `${cfg.label}`);

  let geojson = null;
  let source = '';

  // WALK: always use local model (walking is isotropic, no API needed)
  if(isoMode === 'walk') {
    geojson = walkIsochrone(lat, lng, 10);
    source = '~800m (vitesse marche 80m/min)';
  }
  // TRANSIT: local model with Bucharest metro network
  else if(isoMode === 'transit') {
    geojson = transitIsochrone(lat, lng, 10);
    source = `Réseau métro (${geojson?.properties?.stations || 0} stations accessibles)`;
  }
  // DRIVE: Google Routes API (road network matters)
  else {
    if (_googleHasKey()) {
      geojson = await googleIsochrone(lat, lng, cfg.api, 600, cfg.maxDist);
      if (geojson) { source = 'Google Routes API'; console.log(`[Google Routes] Isochrone DRIVE: ${geojson.properties.points} points`); }
    }
    // Fallback ORS
    if (!geojson && cfg.ors) {
      geojson = await fetchIsochroneORS(lat, lng, cfg.ors, 600);
      if (geojson) { source = 'OpenRouteService'; }
    }
    // Fallback geometric
    if (!geojson) {
      geojson = walkIsochrone(lat, lng, 62); // ~5km at 500m/min equivalent
      source = 'Estimation ~5km';
    }
  }

  if (geojson) {
    isoLayer = L.geoJSON(geojson, {
      style: { color: cfg.color, weight: 2.5, fillColor: cfg.color, fillOpacity: 0.12, dashArray: isoMode==='transit' ? '4,8' : '6,4' }
    }).addTo(map);

    isoLayer.bindTooltip(
      `<b>${cfg.label}</b><br><span style="font-size:10px">${source}</span>`,
      {className:'custom-tooltip', permanent:false, direction:'center'}
    );
  }

  hideLoad();
}

// ================================================================
// GOOGLE DISTANCE MATRIX
// ================================================================
const _distMatrixCache = {};

async function googleDistanceMatrix(originLat, originLng, competitors) {
  if (!_googleHasKey() || competitors.length === 0) return competitors;

  const cacheKey = `dm_${originLat.toFixed(3)}_${originLng.toFixed(3)}`;
  if (_distMatrixCache[cacheKey]) {
    // Apply cached results
    const cached = _distMatrixCache[cacheKey];
    competitors.forEach(c => {
      const key = `${c.lat.toFixed(4)}_${c.lng.toFixed(4)}`;
      if (cached[key]) { c.driveMins = cached[key].mins; c.driveMeters = cached[key].meters; }
    });
    return competitors;
  }

  // Google Routes Matrix API — batch up to 25 destinations
  const results = {};
  const batches = [];
  for (let i = 0; i < competitors.length; i += 25) {
    batches.push(competitors.slice(i, i + 25));
  }

  for (const batch of batches) {
    try {
      const body = {
        origins: [{ waypoint: { location: { latLng: { latitude: originLat, longitude: originLng } } } }],
        destinations: batch.map(c => ({
          waypoint: { location: { latLng: { latitude: c.lat, longitude: c.lng } } }
        })),
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE'
      };

      // v7.00 — timeout dur : sans ça, un appel Distance Matrix qui ne répond
      // pas bloquait TOUT le rendu de l'analyse (SAZ/verdict venant après le
      // await) → spinner « Calcul distances réelles » à l'infini.
      const _ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const _to = _ctrl ? setTimeout(() => _ctrl.abort(), 6000) : null;
      const resp = await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': GOOGLE_API_KEY,
          'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,status'
        },
        body: JSON.stringify(body),
        signal: _ctrl ? _ctrl.signal : undefined
      });
      if (_to) clearTimeout(_to);

      const data = await resp.json();
      if (Array.isArray(data)) {
        data.forEach(entry => {
          if (entry.status === 'OK' || entry.duration) {
            const c = batch[entry.destinationIndex];
            if (c) {
              const durSec = parseInt(entry.duration?.replace('s','') || '0');
              const mins = Math.round(durSec / 60);
              const meters = entry.distanceMeters || 0;
              c.driveMins = mins;
              c.driveMeters = meters;
              const key = `${c.lat.toFixed(4)}_${c.lng.toFixed(4)}`;
              results[key] = { mins, meters };
            }
          }
        });
      }
    } catch(e) { console.warn('[Distance Matrix] Batch error:', e); }
  }

  _distMatrixCache[cacheKey] = results;
  return competitors;
}

// ================================================================
// UTILITIES
// ================================================================
function el(id){return document.getElementById(id)}
// fmt + haversine moved to src/utils.js
// v7.00 — garde-fou : un spinner ne reste jamais bloqué > 22 s, même si un
// appel réseau ne rend jamais la main (sécurité par-dessus les timeouts).
let _fpLoadWatchdog = null;
function showLoad(t,s){el('loaderText').textContent=t||'Chargement...';el('loaderSub').textContent=s||'';el('loader').classList.add('on');
  try { clearTimeout(_fpLoadWatchdog); _fpLoadWatchdog = setTimeout(() => { try { el('loader').classList.remove('on'); } catch {} }, 22000); } catch {}}
function hideLoad(){try{clearTimeout(_fpLoadWatchdog);}catch{}el('loader').classList.remove('on')}
function setStatus(s,t){el('statusDot').className='status-dot '+s;el('statusText').textContent=t}
function updCache(){el('cacheInfo').textContent=`Cache: ${Object.keys(opCache).length} req`}
function closePanel(){el('app').classList.remove('panel-open');el('rightPanel').style.display='none'}

// ================================================================
// AUTH & USER MANAGEMENT
// ================================================================

// simpleHash moved to src/utils.js

// Auth storage strategy:
//   Mobile  → localStorage (persistent across sessions — no re-login needed)
//   Desktop → sessionStorage (cleared on tab close, 10min inactivity timeout)
// Rationale: on mobile the device itself is locked by biometrics; asking for
// a password on every visit is pure friction. On desktop (shared/work PC),
// we keep the tighter policy.
function _authIsMobile() {
  return window.innerWidth <= 768
      || /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}
// v6.78 — "Rester connecté" (coché par défaut) : la session vit en
// localStorage même sur desktop → plus de re-login à chaque onglet.
// Décoché → comportement historique (sessionStorage, fermé avec l'onglet).
function _authStayConnected() {
  try { return localStorage.getItem('fpStayConnected') !== '0'; } catch { return true; }
}
function _authStorage() {
  return (_authIsMobile() || _authStayConnected()) ? localStorage : sessionStorage;
}

// Users with passwords stored in localStorage (always)
// Check localStorage first (mobile remember-me), fallback to sessionStorage
// Protège contre JSON corrompu — sinon l'user est kické et ne peut plus se reconnecter.
let currentUser;
try {
  currentUser = JSON.parse(
    localStorage.getItem('fpCurrentUser') ||
    sessionStorage.getItem('fpCurrentUser') ||
    'null'
  );
} catch(e) {
  console.warn('[fp] fpCurrentUser corrompu, reset', e);
  try { localStorage.removeItem('fpCurrentUser'); sessionStorage.removeItem('fpCurrentUser'); } catch {}
  currentUser = null;
}
let userList;
try { userList = JSON.parse(localStorage.getItem('fpUsers')||'[]'); }
catch(e) { console.warn('[fp] fpUsers corrompu, reset', e); try { localStorage.removeItem('fpUsers'); } catch {} userList = []; }

// ── Inactivity timeout: auto-logout after 10 minutes (DESKTOP ONLY) ──
const SESSION_TIMEOUT_MS = 10 * 60 * 1000;
let _inactivityTimer = null;
function resetInactivityTimer() {
  // v6.77 — auto-logout d'inactivité DÉSACTIVÉ à la demande de Paul
  // (2026-07-15) : plus de "Session expirée" après 10 min sur desktop.
  // La session desktop reste en sessionStorage (fermée avec l'onglet).
  return;
}
['click','mousemove','keydown','scroll','touchstart'].forEach(evt =>
  document.addEventListener(evt, resetInactivityTimer, {passive:true})
);

// CANONICAL_USERS moved to data/users.js
// Seed default users if empty
if(userList.length === 0) {
  userList = CANONICAL_USERS.slice();
  localStorage.setItem('fpUsers', JSON.stringify(userList));
} else {
  // Migration: ensure every canonical user exists in the local list (adds new users on deploy)
  let _migrated = false;
  CANONICAL_USERS.forEach(cu => {
    const existing = userList.find(u => (u.email||'').toLowerCase() === cu.email.toLowerCase());
    if(!existing) {
      userList.push(cu);
      _migrated = true;
    }
  });
  if(_migrated) localStorage.setItem('fpUsers', JSON.stringify(userList));
}

// ═══ Login — v6.87 « Auth Pro » : SERVEUR d'abord, repli local ═══════
// Le mot de passe est vérifié par /api/auth (scrypt + cookie de session
// signé httpOnly — le même que lisent /api/sync & co). Si l'API est
// injoignable (offline, serveur statique local, CI), on retombe sur la
// vérification locale historique : l'app reste utilisable hors ligne et
// les suites de tests n'ont pas besoin d'un backend.
function finishLogin(user) {
  currentUser = user;
  _authStorage().setItem('fpCurrentUser', JSON.stringify(currentUser));
  // Clear the other storage so we don't double-persist
  if (_authStorage() === localStorage) sessionStorage.removeItem('fpCurrentUser');
  else localStorage.removeItem('fpCurrentUser');
  localStorage.setItem('fpLastEmail', user.email);
  resetInactivityTimer();
  document.getElementById('loginPage').style.display='none';
  document.getElementById('app').style.display='';
  if(document.getElementById('userAvatar')) document.getElementById('userAvatar').textContent = (user.name||user.email)[0].toUpperCase();
  init();
  applyRole();
  // Broadcast login for onboarding tour + future listeners
  try { window.dispatchEvent(new CustomEvent('fp:login-success', { detail: { user, email: user.email } })); } catch {}
}

function doLoginLocal(email, pw, errEl) {
  const user = userList.find(u => u.email.toLowerCase() === email);
  if(!user) { errEl.style.display='block'; errEl.textContent='Email non reconnu — demandez une invitation'; return; }
  if(user.pwHash && user.pwHash !== simpleHash(pw)) { errEl.style.display='block'; errEl.textContent='Mot de passe incorrect'; return; }
  finishLogin(user);
}

async function doLogin() {
  const email = document.getElementById('loginEmail').value.trim().toLowerCase();
  // v6.78 — trim: un espace parasite (copier-coller, clavier mobile) ne doit
  // plus faire échouer silencieusement la connexion.
  const pw = document.getElementById('loginPassword').value.trim();
  const errEl = document.getElementById('loginError');

  if(!email || !pw) { errEl.style.display='block'; errEl.textContent='Veuillez remplir tous les champs'; return; }

  // v6.78 — mémorise le choix "Rester connecté" AVANT de choisir le storage
  try {
    const stay = document.getElementById('loginStayConnected');
    if (stay) localStorage.setItem('fpStayConnected', stay.checked ? '1' : '0');
  } catch {}
  errEl.style.display = 'none';

  const btn = document.getElementById('loginBtn');
  const btnLabel = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'CONNEXION…'; }
  try {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 6000) : null;
    const r = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      signal: ctrl ? ctrl.signal : undefined,
      body: JSON.stringify({ action: 'login', email, password: pw, stay: _authStayConnected() }),
    });
    if (timer) clearTimeout(timer);
    if (r.ok) {
      const j = await r.json();
      window._serverSession = { ok: true, email: j.email, name: j.name, role: j.role, workspace: j.workspace };
      const av = document.getElementById('userAvatar');
      if (av) av.title = j.email + ' · rôle ' + j.role + ' · session serveur active';
      finishLogin({ email: j.email, name: j.name, role: j.role === 'admin' ? 'admin' : (j.role === 'viewer' ? 'viewer' : 'user') });
      return;
    }
    if (r.status === 401 || r.status === 403) {
      // Le serveur a répondu et a REFUSÉ → pas de repli local (il ferait
      // diverger les mots de passe). Message plat, pas de fuite d'existence.
      const j = await r.json().catch(() => ({}));
      errEl.style.display = 'block';
      errEl.textContent = j.error === 'NO_PASSWORD' ? (j.hint || 'Compte sans mot de passe — contactez l’admin.') : 'Email ou mot de passe incorrect';
      return;
    }
    // 404 / 501 / 5xx / 503 KV → pas d'API ici → vérification locale
    doLoginLocal(email, pw, errEl);
  } catch {
    // Réseau coupé ou timeout → mode offline : vérification locale
    doLoginLocal(email, pw, errEl);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = btnLabel; }
  }
}

// ── Password reset via phrase de récupération (v6.66) ────────────────
// 100% client. Compare simpleHash(phrase saisie) avec user.recoveryHash
// (défini dans data/users.js). Si match, met à jour user.pwHash dans
// localStorage. Aucun backend, aucun email — juste un secret partagé
// que l'utilisateur garde dans son gestionnaire de mots de passe.
function showPasswordResetModal() {
  const m = document.getElementById('passwordResetModal');
  if (!m) return;
  const emailField = document.getElementById('pwResetEmail');
  const loginEmail = document.getElementById('loginEmail');
  if (emailField && loginEmail && loginEmail.value) emailField.value = loginEmail.value;
  document.getElementById('pwResetPhrase').value = '';
  document.getElementById('pwResetNew1').value = '';
  document.getElementById('pwResetNew2').value = '';
  document.getElementById('pwResetStatus').textContent = '';
  const btn = document.getElementById('pwResetBtn');
  btn.disabled = false;
  btn.textContent = 'Valider';
  m.style.display = 'flex';
  setTimeout(() => (emailField?.value ? document.getElementById('pwResetPhrase') : emailField)?.focus(), 50);
}
function hidePasswordResetModal() {
  const m = document.getElementById('passwordResetModal');
  if (m) m.style.display = 'none';
}
async function doPasswordReset() {
  const email = (document.getElementById('pwResetEmail').value || '').trim().toLowerCase();
  const phrase = document.getElementById('pwResetPhrase').value || '';
  const pw1 = document.getElementById('pwResetNew1').value || '';
  const pw2 = document.getElementById('pwResetNew2').value || '';
  const status = document.getElementById('pwResetStatus');
  const btn = document.getElementById('pwResetBtn');

  const fail = (msg) => { btn.disabled = false; btn.textContent = 'Valider'; status.style.color = '#f87171'; status.textContent = msg; };

  if (!email || !email.includes('@')) return fail('Email invalide.');
  if (!phrase) return fail('Phrase de récupération requise.');
  if (pw1.length < 6) return fail('Mot de passe trop court (6 caractères min).');
  if (pw1 !== pw2) return fail('Les deux mots de passe ne correspondent pas.');

  // Message volontairement identique en cas d'email inconnu OU phrase fausse
  // (n'expose pas si l'email existe).
  const errPhrase = 'Email ou phrase de récupération incorrect.';

  // v6.87 — SERVEUR d'abord : si l'API répond, le nouveau mot de passe
  // vaut pour tous les appareils. Repli 100% local si injoignable.
  btn.disabled = true; btn.textContent = '…';
  let server = null; // 'ok' | 'bad' | 'down' | null (API absente)
  try {
    const r = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ action: 'recover', email, phrase, password: pw1 }) });
    if (r.ok) server = 'ok';
    else if (r.status === 400 || r.status === 401) server = 'bad';
    // 500/502/503 = l'API EXISTE mais a échoué (KV en panne…) : surtout pas
    // de repli local, il créerait un mdp qui ne marche que sur cet appareil.
    // (501 = serveur statique sans POST → repli local voulu, comme 404.)
    else if (r.status >= 500 && r.status !== 501) server = 'down';
  } catch {}
  if (server === 'bad') return fail(errPhrase);
  if (server === 'down') return fail('Erreur serveur — réessaie dans un instant.');

  const user = userList.find(u => u.email.toLowerCase() === email);
  if (server === null) {
    // API injoignable → vérification locale historique (v6.66)
    if (!user) return fail(errPhrase);
    if (!user.recoveryHash) return fail('Reset non disponible pour ce compte — contactez l\'admin.');
    if (simpleHash(phrase) !== user.recoveryHash) return fail(errPhrase);
  }

  // Maj locale (garde le repli offline aligné avec le serveur)
  const idx = userList.findIndex(u => u.email.toLowerCase() === email);
  if (idx >= 0) {
    userList[idx].pwHash = simpleHash(pw1);
    try { localStorage.setItem('fpUsers', JSON.stringify(userList)); } catch {}
    // Re-sign the list, sinon l'auth-guard verrait "tampered" au prochain boot
    // et reseederait les users canoniques (= perte du nouveau mdp).
    if (window._fpAuthGuard?.signUserList) window._fpAuthGuard.signUserList();
    else { try { localStorage.removeItem('fpUsersSig'); } catch {} }
  }
  status.style.color = '#34d399';
  status.textContent = server === 'ok' ? 'Mot de passe mis à jour ✓ (tous appareils)' : 'Mot de passe mis à jour ✓ (cet appareil)';
  btn.disabled = true;
  btn.textContent = 'OK';

  setTimeout(() => {
    hidePasswordResetModal();
    const loginEmail = document.getElementById('loginEmail');
    const loginPw = document.getElementById('loginPassword');
    if (loginEmail) loginEmail.value = email;
    if (loginPw) { loginPw.value = pw1; loginPw.focus(); }
  }, 1000);
}

// v6.87 — miroir local d'un changement de mot de passe SERVEUR réussi
// (🔑 Mon mot de passe / reset admin) : sans lui, le repli offline
// (doLoginLocal) rejetterait le NOUVEAU mot de passe et accepterait
// l'ancien. Même invariant que doPasswordReset applique déjà.
window._fpMirrorLocalPw = function (email, pw) {
  try {
    const idx = userList.findIndex(u => (u.email || '').toLowerCase() === String(email || '').toLowerCase());
    if (idx < 0) return;
    userList[idx].pwHash = simpleHash(pw);
    localStorage.setItem('fpUsers', JSON.stringify(userList));
    if (window._fpAuthGuard?.signUserList) window._fpAuthGuard.signUserList();
    else { try { localStorage.removeItem('fpUsersSig'); } catch {} }
  } catch {}
};

// ═══ v6.81 P2b — connexion par lien magique + session serveur ═══════
async function requestMagicLink() {
  const email = (document.getElementById('loginEmail')?.value || '').trim().toLowerCase();
  const st = document.getElementById('magicStatus');
  if (!email || !email.includes('@')) {
    st.style.color = '#fbbf24';
    st.textContent = 'Entre d’abord ton email dans le champ ci-dessous, puis re-clique.';
    document.getElementById('loginEmail')?.focus();
    return;
  }
  st.style.color = '#94a3b8';
  st.textContent = 'Envoi du lien…';
  try {
    const r = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ action: 'request', email }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) { st.style.color = '#34d399'; st.textContent = '📬 Email envoyé ! Clique le lien reçu (valable 15 min) — session de 30 jours.'; }
    else if (j.error === 'NO_RESEND_KEY') { st.style.color = '#fbbf24'; st.textContent = 'Bientôt actif — la clé email (Resend) n’est pas encore posée. Utilise le mot de passe.'; }
    else { st.style.color = '#f87171'; st.textContent = 'Erreur — utilise le mot de passe ci-dessous.'; }
  } catch { st.style.color = '#f87171'; st.textContent = 'Service indisponible ici — utilise le mot de passe.'; }
}
window.requestMagicLink = requestMagicLink;

// Session serveur (posée par le lien magique) : si valide, entre direct
// dans l'app — c'est elle qui fera foi après la bascule complète.
async function checkServerSession() {
  // v6.87 — un logout vient d'avoir lieu dans cet onglet : on saute UNE
  // vérification (le Set-Cookie d'effacement peut encore être en vol).
  try {
    if (sessionStorage.getItem('fpJustLoggedOut')) {
      sessionStorage.removeItem('fpJustLoggedOut');
      return null;
    }
  } catch {}
  try {
    const r = await fetch('/api/auth?action=me', { credentials: 'include', cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j.ok) return null;
    window._serverSession = j; // {email, name, role, workspace}
    const av = document.getElementById('userAvatar');
    if (document.getElementById('loginPage').style.display !== 'none') {
      // v6.87 — préserve 'viewer' (avant: tout non-admin devenait 'user'
      // et un lecteur voyait les contrôles d'édition)
      currentUser = { email: j.email, name: j.name, role: j.role === 'admin' ? 'admin' : (j.role === 'viewer' ? 'viewer' : 'user') };
      _authStorage().setItem('fpCurrentUser', JSON.stringify(currentUser));
      document.getElementById('loginPage').style.display = 'none';
      document.getElementById('app').style.display = '';
      if (av) av.textContent = (j.name || j.email)[0].toUpperCase();
      init(); applyRole();
      try { window.dispatchEvent(new CustomEvent('fp:login-success', { detail: { user: currentUser, email: j.email } })); } catch {}
    }
    if (av) av.title = j.email + ' · rôle ' + j.role + ' · session serveur active (30 j)';
    return j;
  } catch { return null; }
}
window.checkServerSession = checkServerSession;

// Check if already logged in (session-based — must re-login each visit)
function checkAuth() {
  if(currentUser && userList.find(u=>u.email===currentUser.email)) {
    document.getElementById('loginPage').style.display='none';
    document.getElementById('app').style.display='';
    if(document.getElementById('userAvatar')) document.getElementById('userAvatar').textContent = (currentUser.name||currentUser.email)[0].toUpperCase();
    resetInactivityTimer();
    init();
    applyRole();
    // Broadcast session-restored login for onboarding tour
    try { window.dispatchEvent(new CustomEvent('fp:login-success', { detail: { user: currentUser, email: currentUser.email } })); } catch {}
  }
  // Pre-fill email from localStorage for convenience (not session)
  const lastEmail = localStorage.getItem('fpLastEmail');
  if(lastEmail && document.getElementById('loginEmail')) {
    document.getElementById('loginEmail').value = lastEmail;
  }
  // v6.78 — restaure l'état "Rester connecté" + focus direct sur le bon champ
  try {
    const stay = document.getElementById('loginStayConnected');
    if (stay) stay.checked = _authStayConnected();
    if (document.getElementById('loginPage')?.style.display !== 'none') {
      const target = lastEmail ? document.getElementById('loginPassword') : document.getElementById('loginEmail');
      setTimeout(() => target?.focus(), 80);
    }
  } catch {}
}

// Logout — clear both storages for safety
async function doLogout() {
  if(currentUser?.email) localStorage.setItem('fpLastEmail', currentUser.email);
  // v6.87 — la session serveur est un cookie httpOnly STATELESS : seul le
  // Set-Cookie Max-Age=0 de la RÉPONSE logout l'efface. On attend donc la
  // réponse (bornée à 1500 ms) avant le reload, sinon checkServerSession
  // pourrait re-connecter avec le cookie encore vivant. Le flag session
  // couvre le cas où le timeout gagne la course.
  window._serverSession = null;
  try { sessionStorage.setItem('fpJustLoggedOut', '1'); } catch {}
  try {
    await Promise.race([
      fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', keepalive: true, body: JSON.stringify({ action: 'logout' }) }),
      new Promise(r => setTimeout(r, 1500)),
    ]);
  } catch {}
  currentUser = null;
  sessionStorage.removeItem('fpCurrentUser');
  localStorage.removeItem('fpCurrentUser');
  // also clear session signature (if auth-guard installed it)
  try { sessionStorage.removeItem('fpCurrentUserSig'); localStorage.removeItem('fpCurrentUserSig'); } catch {}
  if(_inactivityTimer) clearTimeout(_inactivityTimer);
  window.location.reload();
}

// v6.87 — l'auto-login par lien ?invite= est SUPPRIMÉ : le token était un
// simple base64 non signé, n'importe qui pouvait se forger un rôle admin.
// Les comptes se créent depuis le panneau Utilisateurs (annuaire serveur).
// On nettoie juste l'URL si un vieux lien traîne.
(function checkInvite(){
  const params = new URLSearchParams(window.location.search);
  if (params.get('invite')) window.history.replaceState({}, '', window.location.pathname);
})();

// Old default admin seeding removed — handled in AUTH section above

function isAdmin() { return !currentUser || currentUser.role === 'admin'; }

// v6.85 — notification non-destructive de conflit d'édition simultanée.
// Le serveur a conservé la version du collègue (plus récente) ; on le
// signale au lieu d'écraser en silence. L'utilisateur voit la valeur
// retenue et peut re-modifier s'il n'est pas d'accord.
function notifyOverrideConflicts(conflicts) {
  if (!Array.isArray(conflicts) || !conflicts.length) return;
  const label = { rent: 'loyer', charge: 'charges', surface: 'surface', radius: 'rayon' };
  const shortName = e => { try { return String(e || '').split('@')[0]; } catch { return e; } };
  const siteName = sk => {
    try {
      const [la, ln] = sk.split(',').map(Number);
      const t = (typeof TARGETS !== 'undefined') ? TARGETS.find(x => Math.abs(x.lat - la) < 0.01 && Math.abs(x.lng - ln) < 0.01) : null;
      if (t) return t.name;
      const c = (window.customSites || []).find(x => Math.abs(x.lat - la) < 0.01 && Math.abs(x.lng - ln) < 0.01);
      return c ? c.name : sk;
    } catch { return sk; }
  };
  const old = document.getElementById('fpConflictToast');
  if (old) old.remove();
  const box = document.createElement('div');
  box.id = 'fpConflictToast';
  box.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:100006;max-width:92vw;' +
    'background:linear-gradient(180deg,#1f2937,#111827);border:1px solid rgba(251,191,36,.5);border-radius:12px;' +
    'box-shadow:0 14px 40px rgba(0,0,0,.5);padding:12px 16px;font-family:var(--font,sans-serif);color:#e5e7eb';
  box.innerHTML =
    '<div style="font-size:12px;font-weight:800;color:#fbbf24;margin-bottom:6px">⚠ Modification simultanée détectée</div>' +
    conflicts.slice(0, 4).map(c =>
      `<div style="font-size:11px;line-height:1.5"><b>${shortName(c.by)}</b> a changé le <b>${label[c.kind] || c.kind}</b> de <b>${siteName(c.siteKey).replace(/</g, '&lt;')}</b> — sa valeur (<b style="color:#34d399">${c.theirValue}</b>) a été gardée, la tienne (${c.yourValue}) écartée.</div>`
    ).join('') +
    '<div style="font-size:9.5px;color:#94a3b8;margin-top:6px">Rien n\'a été perdu en silence. Ré-applique ta valeur si tu n\'es pas d\'accord.</div>' +
    '<div style="text-align:right;margin-top:8px"><button onclick="document.getElementById(\'fpConflictToast\')?.remove()" style="background:rgba(251,191,36,.15);border:1px solid rgba(251,191,36,.4);color:#fbbf24;border-radius:6px;padding:5px 12px;font-size:10px;font-weight:700;cursor:pointer">Compris</button></div>';
  document.body.appendChild(box);
  try { window.AuditLog?.log({ action: 'sync.conflict', target: conflicts.map(c => siteName(c.siteKey)).join(', '), meta: { conflicts } }); } catch {}
}
window.notifyOverrideConflicts = notifyOverrideConflicts;

// v6.83 — télécharge l'export complet du cloud (coffre hors-ligne).
async function downloadBackup() {
  const email = (currentUser?.email || '').toLowerCase();
  try {
    const url = '/api/backup?action=download&user=' + encodeURIComponent(email);
    const r = await fetch(url, { credentials: 'include' });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      alert(j.error === 'ADMIN_ONLY' ? 'Réservé aux administrateurs.' : (location.hostname === 'localhost' ? 'La sauvegarde fonctionne uniquement en production (base cloud).' : 'Erreur : ' + (j.error || r.status)));
      return;
    }
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'fp-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    try { window.AuditLog?.log({ action: 'backup.download', target: 'cloud' }); } catch {}
  } catch (e) { alert('Connexion impossible — réessaie.'); }
}
window.downloadBackup = downloadBackup;

function showUserPanel() {
  const panel = document.createElement('div');
  panel.id = 'userPanel';
  panel.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(6,8,15,.92);z-index:10000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px)';

  // v6.87 — session serveur admin → gestion des utilisateurs branchée sur
  // l'annuaire SERVEUR (multi-appareils). Sinon, mode local historique.
  const serverAdmin = window._serverSession?.role === 'admin' && window.AdminUsers;
  const adminBtns = serverAdmin ? window.AdminUsers.blockHtml() : (isAdmin() ? `
    <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
      <div style="font-size:11px;font-weight:700;color:var(--gray);margin-bottom:8px">INVITER UN UTILISATEUR <span style="font-size:9px;padding:2px 8px;border-radius:20px;background:rgba(148,163,184,.12);border:1px solid rgba(148,163,184,.35);color:#94a3b8;font-weight:700">MODE LOCAL — cet appareil</span></div>
      <div style="display:flex;gap:6px;margin-bottom:8px">
        <input type="email" id="inviteEmail" placeholder="email@example.com" style="flex:1;padding:8px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--white);font-size:12px;font-family:var(--font)">
        <input type="text" id="invitePw" placeholder="Mot de passe" style="width:100px;padding:8px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--white);font-size:12px;font-family:var(--font)">
        <select id="inviteRole" style="padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--white);font-size:11px;font-family:var(--font)">
          <option value="viewer">Viewer</option>
          <option value="admin">Admin</option>
        </select>
        <button class="btn btn-sm btn-primary" onclick="inviteUser()">Ajouter</button>
      </div>
      <div id="inviteLink" style="display:none;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:8px;font-size:10px;word-break:break-all;color:var(--cyan);margin-bottom:8px"></div>
      <div style="font-size:11px;font-weight:700;color:var(--gray);margin-bottom:8px;margin-top:12px">UTILISATEURS (${userList.length})</div>
      <div id="userListPanel" style="max-height:200px;overflow-y:auto">
        ${userList.map(u=>`
          <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;margin-bottom:4px;background:var(--card2)">
            <div style="width:28px;height:28px;border-radius:50%;background:${u.role==='admin'?'var(--accent)':'var(--blue)'};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:white">${(u.name||u.email)[0].toUpperCase()}</div>
            <div style="flex:1">
              <div style="font-size:12px;font-weight:600">${u.name||u.email.split('@')[0]}</div>
              <div style="font-size:10px;color:var(--gray2)">${u.email} — <span style="color:${u.role==='admin'?'var(--accent)':'var(--blue)'}">${u.role}</span></div>
            </div>
            ${u.email!==currentUser?.email?`<button class="btn btn-sm" style="color:var(--red);font-size:9px" onclick="removeUser('${u.email}')">Retirer</button>`:'<span style="font-size:9px;color:var(--gray2)">Vous</span>'}
          </div>
        `).join('')}
      </div>
    </div>
  ` : '');

  panel.innerHTML = `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:24px;width:440px;max-width:90vw;box-shadow:0 8px 40px rgba(0,0,0,.5)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <div style="font-size:14px;font-weight:700" data-i18n="duser.title">Gestion utilisateurs</div>
        <button onclick="document.getElementById('userPanel').remove()" style="background:none;border:none;color:var(--gray);font-size:18px;cursor:pointer">&times;</button>
      </div>
      <div style="display:flex;align-items:center;gap:10px;padding:12px;background:var(--bg2);border-radius:8px;margin-bottom:12px">
        <div style="width:36px;height:36px;border-radius:50%;background:${currentUser?.role==='admin'?'var(--accent)':'var(--blue)'};display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;color:white">${(currentUser?.name||'A')[0].toUpperCase()}</div>
        <div>
          <div style="font-size:13px;font-weight:600">${currentUser?.name||'Admin'}</div>
          <div style="font-size:11px;color:var(--gray2)">${currentUser?.email||'—'} — <span style="color:${currentUser?.role==='admin'?'var(--accent)':'var(--blue)'}; font-weight:700">${currentUser?.role||'admin'}</span></div>
        </div>
      </div>
      ${adminBtns}
      <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
        ${window._serverSession && window.AdminUsers ? '<button class="btn" style="flex:1;min-width:130px" onclick="AdminUsers.changeMyPw()">🔑 Mon mot de passe</button>' : ''}
        <button class="btn" style="flex:1;min-width:130px;color:var(--accent)" onclick="replayOnboardingTour()" data-i18n="duser.replay">&#9835; Revoir la presentation</button>
        <button class="btn" style="flex:1;min-width:100px;color:var(--red)" onclick="doLogout()" data-i18n="duser.logout">Deconnexion</button>
        <button class="btn" style="flex:1;min-width:80px" onclick="document.getElementById('userPanel').remove()" data-i18n="duser.close">Fermer</button>
      </div>
    </div>
  `;
  document.body.appendChild(panel);
  if (serverAdmin) window.AdminUsers.load();
  try { window.applyI18n?.(panel); } catch {}
}

// Lance directement le tour Apple-like (utilise depuis showDemoPanel).
function launchOnboardingTour() {
  try { document.getElementById('demoPanel')?.remove(); } catch {}
  try { document.getElementById('userPanel')?.remove(); } catch {}
  try { window.resetOnboardingTour?.(currentUser?.email); } catch {}
  try { window.startOnboardingTour?.(); } catch {}
}

// Alias conservé pour le bouton "Revoir la présentation" du user panel.
function replayOnboardingTour() { launchOnboardingTour(); }

// Panel dépliable "Démonstration" : accessible depuis le bouton bottom-left
// map overlay. Deux sections: (1) Visite guidée → lance le tour, (2) accordion
// "Comment ça marche ?" didactique avec diagrammes (6 étapes du pipeline).
function showDemoPanel() {
  // Toggle: si déjà ouvert, le fermer
  const existing = document.getElementById('demoPanel');
  if (existing) { existing.remove(); return; }

  const tr = (k) => (typeof window.t === 'function' ? window.t(k) : k);
  const panel = document.createElement('div');
  panel.id = 'demoPanel';
  panel.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(6,8,15,.82);z-index:10000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(10px);padding:20px;overflow-y:auto';
  panel.addEventListener('click', e => { if (e.target === panel) panel.remove(); });

  // Card titles/labels + steps content
  panel.innerHTML = `
    <div style="background:linear-gradient(180deg, #0f1422 0%, #0a0d17 100%);border:1px solid rgba(212,160,23,.2);border-radius:18px;width:780px;max-width:95vw;max-height:92vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.6);padding:28px;animation:demoFade .3s ease">
      <style>
        @keyframes demoFade { from {opacity:0;transform:scale(.96)} to {opacity:1;transform:scale(1)} }
        #demoPanel .dp-h1 { font-size:20px;font-weight:800;color:#fff;letter-spacing:-.3px;margin:0 }
        #demoPanel .dp-sub { font-size:12px;color:#94a3b8;margin-top:4px }
        #demoPanel .dp-closeX { background:none;border:none;color:#94a3b8;font-size:22px;cursor:pointer;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;transition:background .2s }
        #demoPanel .dp-closeX:hover { background:rgba(255,255,255,.06);color:#fff }
        #demoPanel .dp-section { background:rgba(15,20,35,.6);border:1px solid rgba(71,85,115,.3);border-radius:12px;padding:18px;margin-bottom:14px }
        #demoPanel .dp-section-head { display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none }
        #demoPanel .dp-section-title { font-size:14px;font-weight:700;color:#fff;display:flex;align-items:center;gap:10px }
        #demoPanel .dp-section-chev { color:var(--accent);font-size:12px;transition:transform .25s }
        #demoPanel .dp-section.open .dp-section-chev { transform:rotate(90deg) }
        #demoPanel .dp-section-body { display:none;margin-top:16px;padding-top:16px;border-top:1px solid rgba(71,85,115,.25) }
        #demoPanel .dp-section.open .dp-section-body { display:block;animation:demoFade .3s ease }
        #demoPanel .dp-cta { background:linear-gradient(135deg, #d4a017 0%, #b8890f 100%);color:#0a0d17;font-weight:800;font-size:13px;padding:12px 20px;border-radius:10px;border:none;cursor:pointer;letter-spacing:.3px;transition:transform .15s, box-shadow .2s;box-shadow:0 4px 14px rgba(212,160,23,.35) }
        #demoPanel .dp-cta:hover { transform:translateY(-1px);box-shadow:0 6px 18px rgba(212,160,23,.5) }
        #demoPanel .dp-step { display:flex;gap:14px;margin-bottom:18px }
        #demoPanel .dp-step-num { flex-shrink:0;width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg, rgba(212,160,23,.25), rgba(212,160,23,.08));border:1px solid rgba(212,160,23,.5);color:var(--accent);font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center }
        #demoPanel .dp-step-body h4 { font-size:13px;font-weight:700;color:#fff;margin:2px 0 6px }
        #demoPanel .dp-step-body p { font-size:11.5px;color:#94a3b8;line-height:1.6;margin:0 0 8px }
        #demoPanel .dp-step-viz { background:rgba(0,0,0,.3);border:1px solid rgba(71,85,115,.25);border-radius:8px;padding:12px;margin-top:8px;font-size:10.5px;color:#cbd5e1;font-family:ui-monospace, monospace;line-height:1.55;white-space:pre-wrap }
        #demoPanel .dp-grid-sources { display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:8px }
        #demoPanel .dp-src { background:rgba(0,0,0,.25);border:1px solid rgba(71,85,115,.3);border-radius:8px;padding:10px }
        #demoPanel .dp-src-icon { font-size:20px;margin-bottom:6px }
        #demoPanel .dp-src-title { font-size:11px;font-weight:700;color:#fff;margin-bottom:4px }
        #demoPanel .dp-src-desc { font-size:10px;color:#94a3b8;line-height:1.5 }
        #demoPanel .dp-saz { display:flex;gap:8px;margin:10px 0 }
        #demoPanel .dp-saz-pil { flex:1;background:rgba(0,0,0,.3);border:1px solid rgba(71,85,115,.3);border-radius:8px;padding:10px;text-align:center }
        #demoPanel .dp-saz-pct { font-size:18px;font-weight:800;color:var(--accent);letter-spacing:-.5px }
        #demoPanel .dp-saz-name { font-size:10px;font-weight:700;color:#fff;margin-top:2px }
        #demoPanel .dp-saz-detail { font-size:9px;color:#64748b;margin-top:4px;line-height:1.4 }

        /* ═══════════════════════════════════════════════════════
           Carousel "Comment ça marche ?" — Apple-like dynamique
           ═══════════════════════════════════════════════════════ */
        #demoPanel .hiw-section {
          padding: 0; overflow: hidden;
          background: linear-gradient(180deg, rgba(15,20,35,.7), rgba(10,13,23,.9));
          border: 1px solid rgba(212,160,23,.18);
        }
        #demoPanel .hiw-head {
          padding: 16px 18px 0; position: relative;
        }
        #demoPanel .hiw-progress {
          position: absolute; left: 0; right: 0; top: 0; height: 3px;
          background: rgba(255,255,255,.05);
          overflow: hidden;
        }
        #demoPanel .hiw-progress-bar {
          height: 100%; width: 16.66%;
          background: linear-gradient(90deg, #d4a017, #fbbf24);
          transition: width .5s cubic-bezier(.34,1.12,.52,1);
          box-shadow: 0 0 8px rgba(212,160,23,.5);
        }
        #demoPanel .hiw-stage {
          position: relative; min-height: 360px; margin-top: 12px;
        }
        #demoPanel .hiw-slide {
          position: absolute; inset: 0; padding: 0 18px 0;
          opacity: 0; pointer-events: none;
          transform: translateX(20px);
          transition: opacity .45s ease, transform .5s cubic-bezier(.34,1.12,.52,1);
          display: flex; flex-direction: column; gap: 12px;
        }
        #demoPanel .hiw-slide.active {
          opacity: 1; pointer-events: auto; transform: translateX(0);
        }
        #demoPanel .hiw-step-head {
          display: flex; align-items: center; gap: 12px;
        }
        #demoPanel .hiw-step-num {
          flex-shrink: 0; width: 36px; height: 36px; border-radius: 50%;
          background: linear-gradient(135deg, rgba(212,160,23,.25), rgba(212,160,23,.08));
          border: 1px solid rgba(212,160,23,.55);
          color: var(--accent); font-weight: 800; font-size: 14px;
          display: flex; align-items: center; justify-content: center;
        }
        #demoPanel .hiw-eyebrow {
          font-size: 10px; font-weight: 800; letter-spacing: 1.4px;
          text-transform: uppercase; margin-bottom: 4px;
        }
        #demoPanel .hiw-title {
          font-size: 18px; font-weight: 800; color: #fff;
          letter-spacing: -.3px; margin: 0; line-height: 1.2;
        }
        #demoPanel .hiw-desc {
          font-size: 12px; color: #94a3b8; line-height: 1.55;
          margin: 0;
        }
        #demoPanel .hiw-desc b { color: var(--accent); }
        #demoPanel .hiw-anim {
          flex: 1; min-height: 180px;
          background: rgba(8,11,20,.65); border: 1px solid rgba(255,255,255,.06);
          border-radius: 12px; padding: 14px;
          display: flex; align-items: center; justify-content: center;
          position: relative; overflow: hidden;
        }

        /* ─── Slide 1 : Cercle chalandise SVG ─── */
        #demoPanel .hiw-catch-svg { width: 220px; height: 220px; }
        #demoPanel .hiw-catch-c {
          stroke-dasharray: var(--l, 500);
          stroke-dashoffset: var(--l, 500);
          transform-origin: center;
        }
        #demoPanel .hiw-catch-c.c1 { --l: 251; }
        #demoPanel .hiw-catch-c.c2 { --l: 377; }
        #demoPanel .hiw-catch-c.c3 { --l: 502; }
        #demoPanel .hiw-slide.active.ready .hiw-catch-c.c1 {
          animation: hiwDrawCircle 1s cubic-bezier(.34,1.12,.52,1) .1s forwards;
        }
        #demoPanel .hiw-slide.active.ready .hiw-catch-c.c2 {
          animation: hiwDrawCircle 1s cubic-bezier(.34,1.12,.52,1) .35s forwards;
        }
        #demoPanel .hiw-slide.active.ready .hiw-catch-c.c3 {
          animation: hiwDrawCircle 1s cubic-bezier(.34,1.12,.52,1) .6s forwards;
        }
        @keyframes hiwDrawCircle { to { stroke-dashoffset: 0; } }
        #demoPanel .hiw-catch-pin {
          transform-origin: center;
          animation: hiwPinPulse 2s ease-in-out infinite;
        }
        #demoPanel .hiw-slide.active.ready .hiw-catch-glow {
          animation: hiwPinGlow 2s ease-out infinite;
        }
        @keyframes hiwPinPulse {
          0%,100% { r: 5; }
          50%     { r: 6.5; }
        }
        @keyframes hiwPinGlow {
          0%   { opacity: .8; r: 6; }
          100% { opacity: 0;  r: 28; }
        }
        #demoPanel .hiw-catch-lbl {
          opacity: 0;
          font-family: var(--font);
        }
        #demoPanel .hiw-slide.active.ready .hiw-catch-lbl:nth-of-type(1) {
          animation: hiwFadeIn .4s ease .6s forwards;
        }
        #demoPanel .hiw-slide.active.ready .hiw-catch-lbl:nth-of-type(2) {
          animation: hiwFadeIn .4s ease .85s forwards;
        }
        #demoPanel .hiw-slide.active.ready .hiw-catch-lbl:nth-of-type(3) {
          animation: hiwFadeIn .4s ease 1.1s forwards;
        }
        @keyframes hiwFadeIn { to { opacity: 1; } }

        /* ─── Slide 2 : 3 sources grid ─── */
        #demoPanel .hiw-sources-grid {
          display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;
          width: 100%; align-items: stretch;
        }
        #demoPanel .hiw-src {
          background: rgba(20,28,48,.75); border: 1px solid rgba(255,255,255,.12);
          border-radius: 10px; padding: 12px 10px;
          box-shadow: 0 2px 8px rgba(0,0,0,.25);
          opacity: 0; transform: translateY(16px) scale(.96);
          transition: opacity .5s ease, transform .6s cubic-bezier(.34,1.56,.52,1);
        }
        #demoPanel .hiw-slide.active.ready .hiw-src:nth-child(1) {
          transition-delay: .1s; opacity: 1; transform: translateY(0) scale(1);
        }
        #demoPanel .hiw-slide.active.ready .hiw-src:nth-child(2) {
          transition-delay: .25s; opacity: 1; transform: translateY(0) scale(1);
        }
        #demoPanel .hiw-slide.active.ready .hiw-src:nth-child(3) {
          transition-delay: .4s; opacity: 1; transform: translateY(0) scale(1);
        }
        #demoPanel .hiw-src-icon { font-size: 24px; margin-bottom: 6px; }
        #demoPanel .hiw-src-title { font-size: 12px; font-weight: 800; color: #fff; margin-bottom: 4px; }
        #demoPanel .hiw-src-desc { font-size: 10px; color: #94a3b8; line-height: 1.5; }

        /* ─── Slide 3 : SAZ 3 piliers avec rings ─── */
        #demoPanel .hiw-saz {
          display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;
          width: 100%;
        }
        #demoPanel .hiw-saz-pil {
          background: rgba(20,28,48,.75); border: 1px solid rgba(255,255,255,.12);
          border-radius: 10px; padding: 10px 8px;
          display: flex; flex-direction: column; align-items: center; text-align: center;
          box-shadow: 0 2px 8px rgba(0,0,0,.25);
          opacity: 0; transform: translateY(16px);
          transition: opacity .5s ease, transform .6s cubic-bezier(.34,1.12,.52,1);
        }
        #demoPanel .hiw-slide.active.ready .hiw-saz-pil:nth-child(1) {
          transition-delay: .1s; opacity: 1; transform: translateY(0);
        }
        #demoPanel .hiw-slide.active.ready .hiw-saz-pil:nth-child(2) {
          transition-delay: .25s; opacity: 1; transform: translateY(0);
        }
        #demoPanel .hiw-slide.active.ready .hiw-saz-pil:nth-child(3) {
          transition-delay: .4s; opacity: 1; transform: translateY(0);
        }
        #demoPanel .hiw-saz-ring { width: 50px; height: 50px; transform: rotate(-90deg); }
        #demoPanel .hiw-saz-ring-fg {
          stroke-dashoffset: var(--perim, 163);
          transition: stroke-dashoffset 1.1s cubic-bezier(.34,1.12,.52,1);
        }
        #demoPanel .hiw-slide.active.ready .hiw-saz-pil:nth-child(1) .hiw-saz-ring-fg {
          stroke-dashoffset: var(--dashoffset, 55);
          transition-delay: .3s;
        }
        #demoPanel .hiw-slide.active.ready .hiw-saz-pil:nth-child(2) .hiw-saz-ring-fg {
          stroke-dashoffset: var(--dashoffset, 55);
          transition-delay: .45s;
        }
        #demoPanel .hiw-slide.active.ready .hiw-saz-pil:nth-child(3) .hiw-saz-ring-fg {
          stroke-dashoffset: var(--dashoffset, 54);
          transition-delay: .6s;
        }
        #demoPanel .hiw-saz-pct { font-size: 16px; font-weight: 900; margin-top: 4px; letter-spacing: -.5px; }
        #demoPanel .hiw-saz-name { font-size: 9px; font-weight: 800; letter-spacing: .8px; margin-top: 2px; }
        #demoPanel .hiw-saz-detail { font-size: 8.5px; color: #64748b; margin-top: 4px; line-height: 1.4; }
        #demoPanel .hiw-verdict {
          font-size: 10.5px; color: #64748b; margin: 6px 0 0; text-align: center;
        }
        #demoPanel .hiw-verdict b { color: var(--accent); }

        /* ─── Slide 4 : Formule captage ─── */
        #demoPanel .hiw-formula {
          display: flex; flex-direction: column; gap: 8px;
          width: 100%; font-family: ui-monospace, monospace;
        }
        #demoPanel .hiw-fline {
          display: grid; grid-template-columns: 100px 18px 1fr; gap: 8px;
          align-items: baseline;
          font-size: 11px; color: #cbd5e1;
          opacity: 0; transform: translateX(-12px);
          transition: opacity .4s ease, transform .5s cubic-bezier(.34,1.12,.52,1);
        }
        #demoPanel .hiw-slide.active.ready .hiw-fline:nth-child(1) { transition-delay: .1s; opacity: 1; transform: translateX(0); }
        #demoPanel .hiw-slide.active.ready .hiw-fline:nth-child(2) { transition-delay: .3s; opacity: 1; transform: translateX(0); }
        #demoPanel .hiw-slide.active.ready .hiw-fline:nth-child(3) { transition-delay: .5s; opacity: 1; transform: translateX(0); }
        #demoPanel .hiw-slide.active.ready .hiw-fline:nth-child(4) { transition-delay: .7s; opacity: 1; transform: translateX(0); }
        #demoPanel .hiw-slide.active.ready .hiw-fline:nth-child(5) { transition-delay: .95s; opacity: 1; transform: translateX(0); }
        #demoPanel .hiw-fk { color: #94a3b8; font-weight: 700; }
        #demoPanel .hiw-feq { color: var(--accent); font-weight: 800; text-align: center; }
        #demoPanel .hiw-fv { color: #cbd5e1; font-size: 10.5px; }
        #demoPanel .hiw-ftotal { margin-top: 6px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,.08); }
        #demoPanel .hiw-ftotal .hiw-fk,
        #demoPanel .hiw-ftotal .hiw-fv { color: #fff; font-size: 13px; font-weight: 800; }
        #demoPanel .hiw-ftotal .hiw-total-v { color: #34d399; }

        /* ─── Slide 5 : P&L 3 scénarios ─── */
        #demoPanel .hiw-pnl {
          display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;
          width: 100%;
        }
        #demoPanel .hiw-pnl-s {
          background: linear-gradient(180deg, rgba(42,52,78,.95) 0%, rgba(28,36,56,.95) 100%);
          border-radius: 10px;
          border-top: 3px solid var(--c, #d4a017);
          border-left: 1px solid rgba(255,255,255,.12);
          border-right: 1px solid rgba(255,255,255,.12);
          border-bottom: 1px solid rgba(255,255,255,.12);
          padding: 12px 10px 14px;
          box-shadow: 0 4px 12px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.08);
          opacity: 0; transform: translateY(14px);
          transition: opacity .5s ease, transform .6s cubic-bezier(.34,1.56,.52,1);
        }
        #demoPanel .hiw-slide.active.ready .hiw-pnl-s:nth-child(1) { transition-delay: .1s; opacity: 1; transform: translateY(0); }
        #demoPanel .hiw-slide.active.ready .hiw-pnl-s:nth-child(2) { transition-delay: .25s; opacity: 1; transform: translateY(0); }
        #demoPanel .hiw-slide.active.ready .hiw-pnl-s:nth-child(3) { transition-delay: .4s; opacity: 1; transform: translateY(0); }
        #demoPanel .hiw-pnl-lbl {
          font-size: 8px; font-weight: 800; letter-spacing: .6px;
          text-transform: uppercase; color: var(--c, #d4a017);
        }
        #demoPanel .hiw-pnl-lbl.hiw-pnl-base { color: #d4a017; }
        #demoPanel .hiw-pnl-irr {
          margin-top: 6px; font-size: 20px; font-weight: 900;
          color: #fff; font-variant-numeric: tabular-nums;
        }
        #demoPanel .hiw-pnl-bar {
          margin-top: 8px; height: 4px; border-radius: 2px;
          background: rgba(255,255,255,.08); overflow: hidden;
        }
        #demoPanel .hiw-pnl-fill {
          height: 100%; background: var(--c, #d4a017); width: 0%;
        }
        #demoPanel .hiw-slide.active.ready .hiw-pnl-s:nth-child(1) .hiw-pnl-fill {
          animation: hiwPnlBar 1s cubic-bezier(.34,1.12,.52,1) .3s forwards;
        }
        #demoPanel .hiw-slide.active.ready .hiw-pnl-s:nth-child(2) .hiw-pnl-fill {
          animation: hiwPnlBar 1s cubic-bezier(.34,1.12,.52,1) .45s forwards;
        }
        #demoPanel .hiw-slide.active.ready .hiw-pnl-s:nth-child(3) .hiw-pnl-fill {
          animation: hiwPnlBar 1s cubic-bezier(.34,1.12,.52,1) .6s forwards;
        }
        @keyframes hiwPnlBar {
          0% { width: 0%; } 100% { width: var(--fill, 50%); }
        }
        #demoPanel .hiw-footnote {
          font-size: 10px; color: #64748b; margin: 6px 0 0; text-align: center;
        }

        /* ─── Slide 6 : Dashboard ─── */
        #demoPanel .hiw-dashboard {
          display: flex; flex-direction: column; gap: 4px;
          width: 100%;
        }
        #demoPanel .hiw-row {
          display: grid; grid-template-columns: 1.6fr .6fr 1fr .9fr .9fr;
          gap: 6px; align-items: center;
          padding: 8px 10px;
          background: linear-gradient(180deg, rgba(42,52,78,.85) 0%, rgba(28,36,56,.85) 100%);
          border-radius: 6px;
          border: 1px solid rgba(255,255,255,.1);
          box-shadow: 0 1px 3px rgba(0,0,0,.25);
          font-size: 11px; color: #e2e8f0;
          font-variant-numeric: tabular-nums;
          opacity: 0; transform: translateY(8px);
          transition: opacity .4s ease, transform .5s cubic-bezier(.34,1.12,.52,1);
        }
        #demoPanel .hiw-row-header {
          background: rgba(212,160,23,.08); color: var(--accent);
          font-size: 10px; font-weight: 800; letter-spacing: .5px;
          text-transform: uppercase;
        }
        #demoPanel .hiw-slide.active.ready .hiw-row:nth-child(1) { transition-delay: .0s; opacity: 1; transform: translateY(0); }
        #demoPanel .hiw-slide.active.ready .hiw-row:nth-child(2) { transition-delay: .15s; opacity: 1; transform: translateY(0); }
        #demoPanel .hiw-slide.active.ready .hiw-row:nth-child(3) { transition-delay: .3s; opacity: 1; transform: translateY(0); }
        #demoPanel .hiw-slide.active.ready .hiw-row:nth-child(4) { transition-delay: .45s; opacity: 1; transform: translateY(0); }
        #demoPanel .hiw-slide.active.ready .hiw-row:nth-child(5) { transition-delay: .6s; opacity: 1; transform: translateY(0); }
        #demoPanel .hiw-slide.active.ready .hiw-row:nth-child(6) { transition-delay: .75s; opacity: 1; transform: translateY(0); }
        #demoPanel .hiw-v {
          font-size: 9px; font-weight: 800; letter-spacing: .4px;
          padding: 3px 6px; border-radius: 4px; text-align: center;
        }
        #demoPanel .hiw-v.go    { background: rgba(52,211,153,.18); color: #34d399; }
        #demoPanel .hiw-v.cond  { background: rgba(212,160,23,.18); color: #d4a017; }
        #demoPanel .hiw-v.watch { background: rgba(249,115,22,.18); color: #f97316; }

        /* ─── Navigation footer ─── */
        #demoPanel .hiw-nav {
          display: flex; align-items: center; justify-content: space-between;
          gap: 12px; padding: 14px 18px 18px;
          border-top: 1px solid rgba(255,255,255,.05);
          margin-top: 8px;
        }
        #demoPanel .hiw-nav-btn {
          flex: 0 0 auto; min-width: 44px; height: 36px; padding: 0 14px;
          background: rgba(212,160,23,.12);
          border: 1px solid rgba(212,160,23,.35);
          border-radius: 10px;
          color: var(--accent); font-size: 12px; font-weight: 700;
          cursor: pointer; transition: background .2s, transform .15s, opacity .2s;
          font-family: var(--font);
        }
        #demoPanel .hiw-nav-btn:hover:not(:disabled) {
          background: rgba(212,160,23,.22);
          transform: translateY(-1px);
        }
        #demoPanel .hiw-nav-btn:disabled { opacity: .3; cursor: not-allowed; }
        #demoPanel .hiw-next { background: linear-gradient(135deg, #d4a017, #b8890f); color: #0a0d17; }
        #demoPanel .hiw-next:hover:not(:disabled) { background: linear-gradient(135deg, #e0b020, #c49512); }
        #demoPanel .hiw-dots {
          display: flex; gap: 6px; align-items: center;
        }
        #demoPanel .hiw-dot {
          width: 6px; height: 6px; border-radius: 3px;
          background: rgba(255,255,255,.2);
          cursor: pointer;
          transition: width .35s cubic-bezier(.34,1.6,.52,1), background .3s;
        }
        #demoPanel .hiw-dot.active {
          width: 20px; background: var(--accent);
          box-shadow: 0 0 8px rgba(212,160,23,.6);
        }

        @media (max-width: 640px) {
          #demoPanel .dp-grid-sources { grid-template-columns:1fr }
          #demoPanel .dp-saz { flex-direction:column }
          #demoPanel .hiw-sources-grid { grid-template-columns: 1fr; }
          #demoPanel .hiw-saz { grid-template-columns: 1fr; }
          #demoPanel .hiw-pnl { grid-template-columns: 1fr; }
          /* MOBILE: slides en block relatif au lieu d'absolute.
             Desktop: carousel horizontal avec transitions translateX.
             Mobile: 1 slide visible à la fois, stack qui pousse la hauteur -> tout le contenu accessible via scroll parent. */
          #demoPanel .hiw-stage { min-height: 0; }
          #demoPanel .hiw-slide {
            position: relative; inset: auto;
            display: none;
            transform: none;
            padding: 0 14px;
          }
          #demoPanel .hiw-slide.active { display: flex; }
          #demoPanel .hiw-row { grid-template-columns: 1.4fr .5fr .8fr .8fr .8fr; font-size: 10px; }
          #demoPanel .hiw-nav { position: sticky; bottom: 0; background: linear-gradient(180deg, rgba(10,13,23,0) 0%, rgba(10,13,23,.95) 30%); padding-top: 20px; }
        }
      </style>

      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px">
        <div>
          <div class="dp-h1" data-i18n="demopanel.title">Démonstration de l'outil</div>
          <div class="dp-sub" data-i18n="demopanel.sub">Comprends en 2 minutes comment on transforme une intuition immobilière en décision chiffrée.</div>
        </div>
        <button class="dp-closeX" onclick="document.getElementById('demoPanel').remove()">&times;</button>
      </div>

      <!-- Section 1: CTA Tour principal -->
      <div class="dp-section" style="background:linear-gradient(135deg, rgba(212,160,23,.1), rgba(212,160,23,.02));border-color:rgba(212,160,23,.4)">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">
          <div style="flex:1;min-width:240px">
            <div class="dp-section-title"><span style="font-size:18px">▶</span> <span data-i18n="demopanel.tour.title">Visite guidée</span></div>
            <div style="font-size:11.5px;color:#94a3b8;margin-top:6px;line-height:1.5" data-i18n="demopanel.tour.desc">8 slides Apple-style, animations live. Tu découvres la map, les pins, les sliders, le SAZ, le P&L et le financement. Durée ~90s.</div>
          </div>
          <button class="dp-cta" onclick="launchOnboardingTour()" data-i18n="demopanel.tour.cta">▶ Lancer</button>
        </div>
      </div>

      <!-- Section 1b: CTA BP cible pays -->
      <div class="dp-section" style="background:linear-gradient(135deg, rgba(96,165,250,.1), rgba(96,165,250,.02));border-color:rgba(96,165,250,.4)">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">
          <div style="flex:1;min-width:240px">
            <div class="dp-section-title"><span style="font-size:18px">📑</span> <span data-i18n="demopanel.bp.title">Construction du BP</span></div>
            <div style="font-size:11.5px;color:#94a3b8;margin-top:6px;line-height:1.5" data-i18n="demopanel.bp.desc">7 étapes Apple-style. Hypothèses clés, courbe revenus 10 ans, structure de coûts % CA, CAPEX 1,2M€, méthodologie Monte Carlo (1 000 simulations), verdict chiffré. ~80s.</div>
          </div>
          <button class="dp-cta" style="background:linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%);color:#0a0d17;box-shadow:0 4px 14px rgba(96,165,250,.35)" onclick="try{document.getElementById('demoPanel')?.remove();}catch{} window.startBpTour?.()" data-i18n="demopanel.bp.cta">▶ Lancer</button>
        </div>
      </div>

      <!-- Section 1c: CTA Sources de données -->
      <div class="dp-section" style="background:linear-gradient(135deg, rgba(167,139,250,.1), rgba(167,139,250,.02));border-color:rgba(167,139,250,.4)">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">
          <div style="flex:1;min-width:240px">
            <div class="dp-section-title"><span style="font-size:18px">📚</span> <span data-i18n="demopanel.sources.title">Sources de données</span></div>
            <div style="font-size:11.5px;color:#94a3b8;margin-top:6px;line-height:1.5" data-i18n="demopanel.sources.desc">6 étapes didactiques. INS census + OSM volumétrique, 92 clubs vérifiés, flux métro/tram/malls/bureaux, prix immobilier par quartier, rigueur et limites assumées. ~60s.</div>
          </div>
          <button class="dp-cta" style="background:linear-gradient(135deg, #a78bfa 0%, #8b5cf6 100%);color:#fff;box-shadow:0 4px 14px rgba(167,139,250,.35)" onclick="try{document.getElementById('demoPanel')?.remove();}catch{} window.startSourcesTour?.()" data-i18n="demopanel.sources.cta">▶ Lancer</button>
        </div>
      </div>

      <!-- Section 2: Comment ça marche (carousel Apple-like dynamique) -->
      <div class="dp-section hiw-section" id="dpHowItWorks">
        <div class="hiw-head">
          <div class="dp-section-title"><span style="font-size:18px">📖</span> <span data-i18n="demopanel.how.title">Comment ça marche ?</span></div>
          <div class="hiw-progress"><div class="hiw-progress-bar"></div></div>
        </div>

        <div class="hiw-stage">
          <!-- SLIDE 1 : Cercle de chalandise (SVG) -->
          <div class="hiw-slide active" data-hiw-idx="0">
            <div class="hiw-step-head">
              <div class="hiw-step-num">1</div>
              <div>
                <div class="hiw-eyebrow" style="color:#d4a017" data-i18n="hiw.s1.eyebrow">ÉTAPE 1 · CHALANDISE</div>
                <h3 class="hiw-title" data-i18n="demopanel.s1.title">Tu cliques sur la carte</h3>
              </div>
            </div>
            <p class="hiw-desc" data-i18n="demopanel.s1.desc.html">Un cercle apparaît autour du site candidat. C'est la <b>zone de chalandise</b> (rayon 1-5 km, slider). Tout ce qui tombe dedans devient ton bassin d'opportunité.</p>
            <div class="hiw-anim">
              <svg class="hiw-catch-svg" viewBox="0 0 200 200" aria-hidden="true">
                <!-- Cercles de chalandise en layers -->
                <circle class="hiw-catch-c c3" cx="100" cy="100" r="80" fill="none" stroke="rgba(212,160,23,.08)" stroke-width="1.5" stroke-dasharray="3 4"/>
                <circle class="hiw-catch-c c2" cx="100" cy="100" r="60" fill="none" stroke="rgba(212,160,23,.22)" stroke-width="1.5" stroke-dasharray="3 4"/>
                <circle class="hiw-catch-c c1" cx="100" cy="100" r="40" fill="none" stroke="#d4a017" stroke-width="2"/>
                <circle class="hiw-catch-glow" cx="100" cy="100" r="6" fill="#d4a017" opacity="0"/>
                <circle class="hiw-catch-pin" cx="100" cy="100" r="5" fill="#d4a017"/>
                <!-- Labels radii -->
                <text class="hiw-catch-lbl" x="100" y="55" text-anchor="middle" fill="rgba(212,160,23,.6)" font-size="9" font-weight="700">2 km</text>
                <text class="hiw-catch-lbl" x="100" y="35" text-anchor="middle" fill="rgba(212,160,23,.45)" font-size="8" font-weight="600">3 km</text>
                <text class="hiw-catch-lbl" x="100" y="15" text-anchor="middle" fill="rgba(212,160,23,.3)" font-size="7" font-weight="600">5 km</text>
              </svg>
            </div>
          </div>

          <!-- SLIDE 2 : 3 sources de data -->
          <div class="hiw-slide" data-hiw-idx="1">
            <div class="hiw-step-head">
              <div class="hiw-step-num">2</div>
              <div>
                <div class="hiw-eyebrow" style="color:#60a5fa" data-i18n="hiw.s2.eyebrow">ÉTAPE 2 · DATA</div>
                <h3 class="hiw-title" data-i18n="demopanel.s2.title">3 sources de data se croisent</h3>
              </div>
            </div>
            <p class="hiw-desc" data-i18n="demopanel.s2.desc">La plateforme interroge en temps réel ou depuis sa base calibrée les sources publiques les plus fiables pour Bucharest.</p>
            <div class="hiw-anim hiw-sources-grid">
              <div class="hiw-src">
                <div class="hiw-src-icon">🏠</div>
                <div class="hiw-src-title" data-i18n="demopanel.s2.src1.title">Population</div>
                <div class="hiw-src-desc" data-i18n="demopanel.s2.src1.desc">OSM + Census INS 2021. 397k bâtiments, 83 quartiers, pop ×1.7 (navetteurs Ilfov).</div>
              </div>
              <div class="hiw-src">
                <div class="hiw-src-icon">🏋️</div>
                <div class="hiw-src-title" data-i18n="demopanel.s2.src2.title">Concurrents</div>
                <div class="hiw-src-desc" data-i18n="demopanel.s2.src2.desc">Overpass live + base 92 clubs (WC, StayFit, 18GYM, Downtown, Nr1…).</div>
              </div>
              <div class="hiw-src">
                <div class="hiw-src-icon">🚇</div>
                <div class="hiw-src-title" data-i18n="demopanel.s2.src3.title">Flux & POI</div>
                <div class="hiw-src-desc" data-i18n="demopanel.s2.src3.desc">Google Routes + OSM. Isochrones 10min, 14 universités, 13 malls, 5 pôles bureaux.</div>
              </div>
            </div>
          </div>

          <!-- SLIDE 3 : SAZ 3 piliers -->
          <div class="hiw-slide" data-hiw-idx="2">
            <div class="hiw-step-head">
              <div class="hiw-step-num">3</div>
              <div>
                <div class="hiw-eyebrow" style="color:#8b5cf6" data-i18n="hiw.s3.eyebrow">ÉTAPE 3 · SCORE</div>
                <h3 class="hiw-title" data-i18n="demopanel.s3.title">Le SAZ pondère 3 piliers</h3>
              </div>
            </div>
            <p class="hiw-desc" data-i18n="demopanel.s3.desc">Score d'Attractivité de Zone 0-100, calibré sur les critères clés de succès d'un club fitness urbain à fort traffic. Poids ajustables par slider.</p>
            <div class="hiw-anim hiw-saz">
              <div class="hiw-saz-pil">
                <svg class="hiw-saz-ring" viewBox="0 0 60 60"><circle cx="30" cy="30" r="26" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="4"/><circle class="hiw-saz-ring-fg" cx="30" cy="30" r="26" fill="none" stroke="#06b6d4" stroke-width="4" stroke-linecap="round" stroke-dasharray="163" style="--perim:163;--dashoffset:55"/></svg>
                <div class="hiw-saz-pct" style="color:#06b6d4"><span data-counter data-target="33" data-suffix="%" data-format="integer">0%</span></div>
                <div class="hiw-saz-name" style="color:#06b6d4" data-i18n="demopanel.s3.flux">FLUX</div>
                <div class="hiw-saz-detail" data-i18n="demopanel.s3.fluxDet">métro · malls · bureaux · universités · piétons</div>
              </div>
              <div class="hiw-saz-pil">
                <svg class="hiw-saz-ring" viewBox="0 0 60 60"><circle cx="30" cy="30" r="26" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="4"/><circle class="hiw-saz-ring-fg" cx="30" cy="30" r="26" fill="none" stroke="#8b5cf6" stroke-width="4" stroke-linecap="round" stroke-dasharray="163" style="--perim:163;--dashoffset:55"/></svg>
                <div class="hiw-saz-pct" style="color:#8b5cf6"><span data-counter data-target="33" data-suffix="%" data-format="integer" data-delay="180">0%</span></div>
                <div class="hiw-saz-name" style="color:#8b5cf6" data-i18n="demopanel.s3.dens">DENSITÉ</div>
                <div class="hiw-saz-detail" data-i18n="demopanel.s3.densDet">pop 15-45 · pouvoir d'achat · concurrence inverse</div>
              </div>
              <div class="hiw-saz-pil">
                <svg class="hiw-saz-ring" viewBox="0 0 60 60"><circle cx="30" cy="30" r="26" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="4"/><circle class="hiw-saz-ring-fg" cx="30" cy="30" r="26" fill="none" stroke="#10b981" stroke-width="4" stroke-linecap="round" stroke-dasharray="163" style="--perim:163;--dashoffset:54"/></svg>
                <div class="hiw-saz-pct" style="color:#10b981"><span data-counter data-target="34" data-suffix="%" data-format="integer" data-delay="360">0%</span></div>
                <div class="hiw-saz-name" style="color:#10b981" data-i18n="demopanel.s3.youth">JEUNESSE</div>
                <div class="hiw-saz-detail" data-i18n="demopanel.s3.youthDet">universités · âge quartier · nouveaux résidentiels</div>
              </div>
            </div>
            <p class="hiw-verdict" data-i18n="demopanel.s3.verdict.html"><b>Verdict</b> : GO (70+) · GO COND (45-69) · WATCH (30-44) · NO-GO (&lt;30)</p>
          </div>

          <!-- SLIDE 4 : Captage formule -->
          <div class="hiw-slide" data-hiw-idx="3">
            <div class="hiw-step-head">
              <div class="hiw-step-num">4</div>
              <div>
                <div class="hiw-eyebrow" style="color:#f97316" data-i18n="hiw.s4.eyebrow">ÉTAPE 4 · CAPTAGE</div>
                <h3 class="hiw-title" data-i18n="demopanel.s4.title">Le captage projette les membres</h3>
              </div>
            </div>
            <p class="hiw-desc" data-i18n="demopanel.s4.desc">Pour chaque club concurrent dans le rayon, 4 facteurs calculent combien de membres switchent vers FP.</p>
            <div class="hiw-anim hiw-formula">
              <div class="hiw-fline"><span class="hiw-fk" data-i18n="hiw.capt.captifs">Captifs</span><span class="hiw-feq">=</span><span class="hiw-fv" data-i18n="hiw.capt.captifsF">taux switch × proximité × qualité (Google) × écart de prix</span></div>
              <div class="hiw-fline"><span class="hiw-fk" data-i18n="hiw.capt.natifs">Natifs</span><span class="hiw-feq">=</span><span class="hiw-fv" data-i18n="hiw.capt.natifsF">pop non-inscrite × taux de conversion</span></div>
              <div class="hiw-fline"><span class="hiw-fk">Walk-in</span><span class="hiw-feq">=</span><span class="hiw-fv" data-i18n="hiw.capt.walkinF">0,7% × visiteurs mall (si en CC)</span></div>
              <div class="hiw-fline"><span class="hiw-fk" data-i18n="hiw.capt.bonus">Dest. bonus</span><span class="hiw-feq">=</span><span class="hiw-fv" data-i18n="hiw.capt.bonusF">proximité POI premium (malls, bureaux)</span></div>
              <div class="hiw-fline hiw-ftotal"><span class="hiw-fk">TOTAL</span><span class="hiw-feq">=</span><span class="hiw-fv hiw-total-v"><span data-counter data-target="4823" data-format="fr-thousands" data-delay="1000">0</span> membres théoriques A3</span></div>
            </div>
          </div>

          <!-- SLIDE 5 : P&L scénarios -->
          <div class="hiw-slide" data-hiw-idx="4">
            <div class="hiw-step-head">
              <div class="hiw-step-num">5</div>
              <div>
                <div class="hiw-eyebrow" style="color:#34d399" data-i18n="hiw.s5.eyebrow">ÉTAPE 5 · P&L</div>
                <h3 class="hiw-title" data-i18n="demopanel.s5.title">Le P&L tombe directement</h3>
              </div>
            </div>
            <p class="hiw-desc" data-i18n="demopanel.s5.desc">Membres × 28€/mois × ramp-up (A1 70% / A2 90% / A3 100%) → CA, EBITDA, IRR projet, IRR equity, NPV, breakeven, payback en 3 scénarios.</p>
            <div class="hiw-anim hiw-pnl">
              <div class="hiw-pnl-s" style="--c:#f87171;--fill:36%">
                <div class="hiw-pnl-lbl" data-i18n="hiw.s5.conservative">CONSERVATEUR</div>
                <div class="hiw-pnl-irr"><span data-counter data-target="36" data-prefix="+" data-suffix="%" data-delay="0">+0%</span></div>
                <div class="hiw-pnl-bar"><div class="hiw-pnl-fill"></div></div>
              </div>
              <div class="hiw-pnl-s" style="--c:#d4a017;--fill:57%">
                <div class="hiw-pnl-lbl hiw-pnl-base" data-i18n="hiw.s5.base">BASE</div>
                <div class="hiw-pnl-irr"><span data-counter data-target="57.6" data-prefix="+" data-suffix="%" data-format="fr-decimal" data-delay="150">+0%</span></div>
                <div class="hiw-pnl-bar"><div class="hiw-pnl-fill"></div></div>
              </div>
              <div class="hiw-pnl-s" style="--c:#34d399;--fill:86%">
                <div class="hiw-pnl-lbl" data-i18n="hiw.s5.optimistic">OPTIMISTE</div>
                <div class="hiw-pnl-irr"><span data-counter data-target="86" data-prefix="+" data-suffix="%" data-delay="300">+0%</span></div>
                <div class="hiw-pnl-bar"><div class="hiw-pnl-fill"></div></div>
              </div>
            </div>
            <p class="hiw-footnote" data-i18n="hiw.s5.footnote">Modèle calibré OnAir Montreuil (franchise FP auditée Fiteco). CA 2,24 M€ · EBITDA 44,7% à maturité.</p>
          </div>

          <!-- SLIDE 6 : Dashboard comparaison -->
          <div class="hiw-slide" data-hiw-idx="5">
            <div class="hiw-step-head">
              <div class="hiw-step-num">6</div>
              <div>
                <div class="hiw-eyebrow" style="color:#a78bfa" data-i18n="hiw.s6.eyebrow">ÉTAPE 6 · DÉCISION</div>
                <h3 class="hiw-title" data-i18n="demopanel.s6.title">Tu compares et tu décides</h3>
              </div>
            </div>
            <p class="hiw-desc" data-i18n="demopanel.s6.desc.html">Dashboard avec tableau triable · export CSV · comparaison 2 sites côte à côte · détection cannibalisation (&lt;1,5 km = critique). Tu arbitres avec des chiffres, pas avec des intuitions.</p>
            <div class="hiw-anim hiw-dashboard">
              <div class="hiw-row hiw-row-header"><span>Site</span><span>SAZ</span><span>Membres</span><span>IRR</span><span>Verdict</span></div>
              <div class="hiw-row" data-verdict="go"><span>Hala Laminor</span><span>78</span><span>7 093</span><span style="color:#34d399">+57,6%</span><span class="hiw-v go">GO</span></div>
              <div class="hiw-row" data-verdict="go"><span>Baneasa</span><span>74</span><span>8 762</span><span style="color:#34d399">+60,5%</span><span class="hiw-v go">GO</span></div>
              <div class="hiw-row" data-verdict="cond"><span>Unirea</span><span>68</span><span>5 810</span><span style="color:#d4a017">+40,6%</span><span class="hiw-v cond">COND</span></div>
              <div class="hiw-row" data-verdict="watch"><span>Militari</span><span>52</span><span>3 339</span><span style="color:#f97316">+8,3%</span><span class="hiw-v watch">WATCH</span></div>
              <div class="hiw-row" data-verdict="watch"><span>Grand Arena</span><span>48</span><span>3 135</span><span style="color:#f87171">+3,6%</span><span class="hiw-v watch">WATCH</span></div>
            </div>
          </div>
        </div>

        <!-- Navigation footer -->
        <div class="hiw-nav">
          <button class="hiw-nav-btn hiw-prev" type="button" disabled>◀</button>
          <div class="hiw-dots">
            <div class="hiw-dot active"></div>
            <div class="hiw-dot"></div>
            <div class="hiw-dot"></div>
            <div class="hiw-dot"></div>
            <div class="hiw-dot"></div>
            <div class="hiw-dot"></div>
          </div>
          <button class="hiw-nav-btn hiw-next" type="button"><span data-i18n="hiw.next">Suivant</span> ▶</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(panel);
  try { window.applyI18n?.(panel); } catch {}

  // ─── Logique du carousel "Comment ça marche ?" ─────────────────────
  // 6 slides, navigation prev/next, dots, animations stagger via .ready class.
  (function initHiwCarousel() {
    const stage = panel.querySelector('.hiw-stage');
    const slides = panel.querySelectorAll('.hiw-slide');
    const dots = panel.querySelectorAll('.hiw-dot');
    const prevBtn = panel.querySelector('.hiw-prev');
    const nextBtn = panel.querySelector('.hiw-next');
    const progressBar = panel.querySelector('.hiw-progress-bar');
    if (!stage || !slides.length) return;
    let idx = 0;
    const total = slides.length;

    // Animation des counters via window.fpOnbAnimateCounters (exposée par onboarding-tour.js).
    // Fallback: animation inline si l'API n'est pas disponible.
    function runCounters(slide) {
      const counters = slide.querySelectorAll('[data-counter]');
      counters.forEach(el => {
        const target = parseFloat(el.dataset.target || '0');
        const suffix = el.dataset.suffix || '';
        const prefix = el.dataset.prefix || '';
        const format = el.dataset.format || '';
        const delay = parseInt(el.dataset.delay || '0', 10);
        const duration = 950;
        const kick = () => {
          const start = Date.now();
          const timer = setInterval(() => {
            const t = Math.min(1, (Date.now() - start) / duration);
            const eased = 1 - Math.pow(1 - t, 3);
            const v = target * eased;
            let s;
            if (format === 'fr-decimal') s = v.toFixed(1).replace('.', ',');
            else if (format === 'fr-thousands') s = Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
            else if (format === 'integer') s = Math.round(v).toString();
            else s = v.toFixed(target % 1 === 0 ? 0 : 1);
            el.textContent = prefix + s + suffix;
            if (t >= 1) clearInterval(timer);
          }, 33);
        };
        el.textContent = prefix + (format === 'fr-decimal' ? '0,0' : '0') + suffix;
        if (delay > 0) setTimeout(kick, delay);
        else kick();
      });
    }

    function goTo(newIdx) {
      if (newIdx < 0 || newIdx >= total) return;
      const prev = slides[idx];
      const next = slides[newIdx];
      prev.classList.remove('active', 'ready');
      next.classList.remove('leaving-left','leaving-right');
      next.classList.add('active');
      // Force reflow pour que la transition joue
      void next.offsetWidth;
      setTimeout(() => {
        next.classList.add('ready');
        runCounters(next);
      }, 50);
      dots.forEach((d, i) => d.classList.toggle('active', i === newIdx));
      prevBtn.disabled = newIdx === 0;
      nextBtn.innerHTML = newIdx === total - 1
        ? '<span data-i18n="hiw.restart">Rejouer</span> ↻'
        : '<span data-i18n="hiw.next">Suivant</span> ▶';
      try { window.applyI18n?.(nextBtn); } catch {}
      if (progressBar) progressBar.style.width = ((newIdx + 1) / total * 100) + '%';
      idx = newIdx;
    }

    prevBtn.addEventListener('click', () => goTo(idx - 1));
    nextBtn.addEventListener('click', () => {
      if (idx === total - 1) goTo(0);  // Rejouer
      else goTo(idx + 1);
    });
    dots.forEach((d, i) => d.addEventListener('click', () => goTo(i)));

    // Keyboard inside the panel
    panel.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' && idx < total - 1) { e.preventDefault(); goTo(idx + 1); }
      else if (e.key === 'ArrowLeft' && idx > 0) { e.preventDefault(); goTo(idx - 1); }
    });

    // Initial: slide 0 déjà en .active. Lance ready + counters après petit delay.
    setTimeout(() => {
      slides[0].classList.add('ready');
      runCounters(slides[0]);
      if (progressBar) progressBar.style.width = (100 / total) + '%';
    }, 150);
  })();

  // Escape pour fermer
  const onEsc = (e) => { if (e.key === 'Escape') { panel.remove(); document.removeEventListener('keydown', onEsc); } };
  document.addEventListener('keydown', onEsc);
}

function inviteUser() {
  const email = document.getElementById('inviteEmail')?.value?.trim();
  const pw = document.getElementById('invitePw')?.value?.trim();
  const role = document.getElementById('inviteRole')?.value || 'viewer';
  if(!email || !email.includes('@')) return alert('Email invalide');
  if(!pw || pw.length<4) return alert('Mot de passe requis (min 4 caracteres)');

  // Add to user list
  if(!userList.find(u=>u.email===email)) {
    userList.push({email, role, name:email.split('@')[0], pwHash:simpleHash(pw)});
    localStorage.setItem('fpUsers', JSON.stringify(userList));
    // v6.87 — re-signe la liste, sinon l'auth-guard verrait "tampered" au
    // prochain boot et WIPERAIT fpUsers (fausse alerte + compte perdu).
    if (window._fpAuthGuard?.signUserList) window._fpAuthGuard.signUserList();
    else { try { localStorage.removeItem('fpUsersSig'); } catch {} }
  }

  // v6.87 — plus de lien d'invitation (le token base64 non signé était
  // forgeable). En mode local le compte ne vaut que sur CET appareil ;
  // en ligne, l'annuaire serveur prend le relais.
  const linkDiv = document.getElementById('inviteLink');
  linkDiv.style.display = 'block';
  linkDiv.innerHTML = `<div style="font-size:10px;color:var(--green)">Compte local créé (${role}) — valable sur cet appareil. Connectez-vous en ligne pour créer un compte multi-appareils.</div>`;

  // Refresh panel
  document.getElementById('inviteEmail').value = '';
}

function removeUser(email) {
  userList = userList.filter(u=>u.email!==email);
  localStorage.setItem('fpUsers', JSON.stringify(userList));
  // v6.87 — même impératif de re-signature que inviteUser
  if (window._fpAuthGuard?.signUserList) window._fpAuthGuard.signUserList();
  else { try { localStorage.removeItem('fpUsersSig'); } catch {} }
  document.getElementById('userPanel').remove();
  showUserPanel();
}

function switchUser() {
  const email = prompt('Votre email :');
  if(!email) return;
  const user = userList.find(u=>u.email===email);
  if(user) {
    currentUser = user;
    _authStorage().setItem('fpCurrentUser', JSON.stringify(currentUser));
    document.getElementById('userPanel').remove();
    applyRole();
    showUserPanel();
  } else {
    alert('Utilisateur non trouve. Demandez une invitation a l\'admin.');
  }
}

function applyRole() {
  // Viewer restrictions: hide edit buttons, disable site adding
  const isV = currentUser?.role === 'viewer';
  document.querySelectorAll('.admin-only').forEach(el => el.style.display = isV ? 'none' : '');
}

// ================================================================
// BOOT — Check auth first
// ================================================================
checkAuth();
checkServerSession(); // v6.81 — la session magic link (si présente) prend le relais
