// ─────────────────────────────────────────────────────────────────────
// /api/intel — Intel concurrence #2 (prix) + #3 (ouvertures).
//
// Récupère côté serveur (le navigateur ne peut pas, CORS) des données
// PUBLIQUES des chaînes concurrentes, les met en cache dans KV, et les
// sert à l'app. Rafraîchissement PARESSEUX : au 1er `data` après 7 j, on
// re-fetch en direct (pas besoin de cron). Bouton « Rafraîchir » côté admin.
//
// Sources 100 % publiques :
//   • Prix   : members.18gym.ro / members.stayfit.ro (membership-prices.php,
//              même logiciel) + worldclass.ro/abonamente.
//   • Ouvertures : stayfit.ro/cluburi/ (clubs marqués « presale » = pré-
//                  ouverture) ; géocodage Nominatim pour les poser sur la carte.
//
// Actions :
//   GET ?action=data           → { prices, openings, refreshedAt, stale }
//                                 (rafraîchit en direct si > 7 j et session OK)
//   GET ?action=refresh        → force le refresh (session éditeur/admin)
//
// Le bilan financier (#1) est un JSON statique du repo
// (data/competitors-financials.json), pas besoin de cette fonction.
// ─────────────────────────────────────────────────────────────────────
const crypto = require('crypto');

const KV_URL   = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const PRICES_KEY = 'fp:intel:prices';
const OPEN_KEY   = 'fp:intel:openings';
const STALE_MS = 7 * 24 * 3600 * 1000;
const UA = 'FitnessParkExpansionTool/1.0 (competitive research; contact paulbecaud@isseo-dev.com)';

// ─── KV ──────────────────────────────────────────────────────────────
async function kvGet(key) {
  const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${KV_TOKEN}` } });
  if (!r.ok) return null;
  const j = await r.json();
  return j.result ? JSON.parse(j.result) : null;
}
async function kvSet(key, value) {
  await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'text/plain' }, body: JSON.stringify(value),
  }).catch(() => {});
}

// ─── Session (révocation immédiate via annuaire vivant) ──────────────
function readSession(req) {
  try {
    const c = (req.headers.cookie || '').split(/;\s*/).find(x => x.startsWith('fp_session='));
    if (!c) return null;
    const [p, sig] = c.slice('fp_session='.length).split('.');
    if (crypto.createHmac('sha256', KV_TOKEN).update(p).digest('base64url') !== sig) return null;
    const s = JSON.parse(Buffer.from(p, 'base64url').toString());
    return Date.now() > s.x ? null : { email: s.e, role: s.r };
  } catch { return null; }
}
// v6.88 — le refresh est une action d'ÉCRITURE qui déclenche des fetch
// sortants (sites concurrents + Nominatim) : SESSION serveur éditeur/admin
// OBLIGATOIRE. Pas de repli sur un email legacy en query (`?user=`), qui
// serait un email public non authentifié → n'importe qui pourrait forcer
// le refresh et empoisonner/vider le cache. (Intel est nouveau : aucun
// client legacy à ménager.)
async function canRefresh(req) {
  const s = readSession(req);
  if (!s) return false;
  const dir = await kvGet('fp:v2:directory').catch(() => null);
  const u = dir && dir[s.email];
  return !!(u && !u.disabled && ['admin', 'editor'].includes(u.role));
}

// ─── Fetch helper (timeout + jamais throw hors appelant) ─────────────
async function getText(url, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { redirect: 'follow', signal: ctrl.signal, headers: { 'User-Agent': UA, 'Accept-Language': 'ro,en' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally { clearTimeout(t); }
}
const strip = h => String(h)
  .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&#8211;|&ndash;/g, '-').replace(/\s+/g, ' ').trim();

// ─── PRIX ────────────────────────────────────────────────────────────
// members.*/membership-prices.php : blocs « NOM … Total de plată: 179.00 RON … pentru 28 zile »
// Ne garde que le suffixe en MAJUSCULES = le vrai nom du plan (le texte
// descriptif lowercase qui précède fuit sinon dans la capture).
function cleanPlanName(s) {
  const toks = s.trim().split(/\s+/);
  let i = toks.length;
  while (i > 0 && /^[A-ZĂÂÎȘȚ0-9+.&/-]+$/.test(toks[i - 1])) i--;
  return (toks.slice(i).join(' ') || s).replace(/\s*-\s*RECURENT$/i, '').trim();
}
function parseMembershipPrices(html, brand) {
  const txt = strip(html);
  const plans = [];
  // pattern : NOM (majuscules) ... Total de plată: 000.00 RON ... pentru NN zile
  const re = /([A-ZĂÂÎȘȚ][A-ZĂÂÎȘȚ0-9 +.\-]{2,40}?)\s+Dur[aă]t[aă] abonament:\s*(\d+)\s*zile[\s\S]{0,120}?Total de plat[aă]:\s*([\d.,]+)\s*RON/gi;
  let m; const seen = new Set();
  while ((m = re.exec(txt))) {
    const name = cleanPlanName(m[1]);
    const days = parseInt(m[2], 10);
    const price = parseFloat(m[3].replace(',', '.'));
    if (!price || days < 7) continue; // < 7 j = day-pass, écarté (fausserait l'ARPU)
    const key = name + price;
    if (seen.has(key)) continue; seen.add(key);
    plans.push({ name, priceRON: price, days, monthlyRON: Math.round(price * 30 / days) });
  }
  plans.sort((a, b) => a.monthlyRON - b.monthlyRON);
  const monthlies = plans.map(p => p.monthlyRON).filter(Boolean);
  return {
    brand, currency: 'RON', plans,
    entryMonthlyRON: monthlies.length ? Math.min(...monthlies) : null,
    topMonthlyRON: monthlies.length ? Math.max(...monthlies) : null,
  };
}

// World Class ne rend PAS ses prix dans le HTML statique (grille par tier de
// club chargée en JS) : on affiche la fourchette catalogue vérifiée à la main
// plutôt qu'un scraping fragile. À réviser si la grille WC change.
const WC_STATIC = {
  brand: 'World Class', currency: 'EUR', plans: [],
  entryMonthlyEUR: 48, topMonthlyEUR: 142,
  note: 'Tarifs par tier de club (Bronze→W), 48–142 €/mois. Non scrapable (JS) — catalogue relevé le 16/07/2026 sur worldclass.ro/abonamente.',
  static: true,
};

async function refreshPrices(prev) {
  const out = { brands: [], fetchedAt: Date.now(), errors: [] };
  const prevByBrand = {};
  for (const b of (prev?.brands || [])) prevByBrand[b.brand] = b;
  const jobs = [
    ['18GYM', 'https://members.18gym.ro/membership-prices.php?clubid=1031'],
    ['Stay Fit Gym', 'https://members.stayfit.ro/membership-prices.php?clubid=1001'],
  ];
  await Promise.all(jobs.map(async ([brand, url]) => {
    try {
      const html = await getText(url);
      const parsed = parseMembershipPrices(html, brand);
      // Si le parse ne rend rien (markup changé), on ne jette pas la dernière
      // grille valide connue.
      if (parsed.plans.length) out.brands.push(parsed);
      else if (prevByBrand[brand]) { out.brands.push({ ...prevByBrand[brand], stale: true }); out.errors.push({ brand, error: 'PARSE_EMPTY (dernière grille conservée)' }); }
      else out.brands.push(parsed);
    } catch (e) {
      out.errors.push({ brand, error: String(e.message || e) });
      if (prevByBrand[brand]) out.brands.push({ ...prevByBrand[brand], stale: true }); // garde le dernier bon
    }
  }));
  out.brands.push(WC_STATIC);
  out.brands.sort((a, b) => a.brand.localeCompare(b.brand));
  return out;
}

// ─── OUVERTURES (early warning) ──────────────────────────────────────
// stayfit.ro/cluburi/ : <li class="…sfg-presale…"> = club en pré-ouverture.
function parseStayFitOpenings(html) {
  const clubs = new Map(); // dédup par URL
  const re = /<li[^>]*class="[^"]*sfg-presale[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = re.exec(html))) {
    const block = m[1];
    const href = (block.match(/href="([^"]+)"/) || [])[1] || '';
    const name = strip(block);
    if (!name || !href) continue;
    const city = /\/bucuresti\//i.test(href) ? 'București' : (href.split('stayfit.ro/')[1] || '').split('/')[0] || '';
    clubs.set(href, { brand: 'Stay Fit Gym', name, area: name, city, url: href });
  }
  return [...clubs.values()];
}

// Nominatim — géocode « <club> <ville> Romania » (respecte le débit : séquentiel).
async function geocode(q) {
  try {
    const u = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ro&q=${encodeURIComponent(q)}`;
    const r = await fetch(u, { headers: { 'User-Agent': UA } });
    const j = await r.json();
    if (j && j[0]) return { lat: +j[0].lat, lng: +j[0].lon };
  } catch {}
  return { lat: null, lng: null };
}

async function refreshOpenings(prev) {
  const out = { clubs: [], fetchedAt: Date.now(), errors: [] };
  const prevByUrl = {};
  for (const c of (prev?.clubs || [])) prevByUrl[c.url] = c;
  try {
    const html = await getText('https://stayfit.ro/cluburi/');
    const found = parseStayFitOpenings(html);
    let geocoded = 0;
    const GEO_CAP = 6; // borne le temps de requête (Nominatim ≤ 1/s, Vercel Hobby ≤ 10 s).
    for (const c of found) {                            // les coords déjà connues persistent
      const was = prevByUrl[c.url] || {};               // → au fil des refresh, tout finit géocodé
      let lat = was.lat, lng = was.lng;
      if (!lat && geocoded < GEO_CAP) {
        // Les noms de clubs SONT des rues/quartiers → géocode « zone, ville, RO »
        // (sans le préfixe enseigne, sinon Nominatim ne résout pas).
        const cityLabel = /bucure/i.test(c.city) ? 'București' : (c.city || 'România');
        const g = await geocode(`${c.name}, ${cityLabel}, România`);
        lat = g.lat; lng = g.lng; geocoded++;
        await new Promise(r => setTimeout(r, 1000));
      }
      out.clubs.push({ ...c, lat, lng, firstSeen: was.firstSeen || new Date().toISOString().slice(0, 10) });
    }
  } catch (e) {
    // Panne transitoire du site : on CONSERVE la dernière liste connue (avec
    // ses coords géocodées) plutôt que d'écraser le cache par du vide.
    out.errors.push({ brand: 'Stay Fit Gym', error: String(e.message || e) });
    if (prev?.clubs?.length) out.clubs = prev.clubs;
  }
  return out;
}

// ─── Handler ─────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.APP_URL || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (!KV_URL || !KV_TOKEN) { res.status(503).json({ error: 'KV_NOT_CONFIGURED' }); return; }

  const q = req.query || {};
  const action = String(q.action || 'data');

  try {
    let prices = await kvGet(PRICES_KEY);
    let openings = await kvGet(OPEN_KEY);
    const now = Date.now();
    const stale = !prices || !openings || (now - (prices.fetchedAt || 0) > STALE_MS);

    const forced = action === 'refresh';
    // rafraîchit si : refresh explicite (session éditeur/admin), OU data stale
    // + session éditeur/admin. Un lecteur/anonyme lit seulement le cache.
    const mayWrite = await canRefresh(req);
    if ((forced || (action === 'data' && stale)) && mayWrite) {
      const [p, o] = await Promise.all([refreshPrices(prices), refreshOpenings(openings)]);
      prices = p; openings = o;
      await Promise.all([kvSet(PRICES_KEY, p), kvSet(OPEN_KEY, o)]);
    } else if (forced && !mayWrite) {
      res.status(403).json({ error: 'FORBIDDEN' }); return;
    }

    res.status(200).json({
      ok: true,
      prices: prices || { brands: [], fetchedAt: 0, errors: [] },
      openings: openings || { clubs: [], fetchedAt: 0, errors: [] },
      refreshedAt: prices?.fetchedAt || 0,
      stale: !prices || (now - (prices?.fetchedAt || 0) > STALE_MS),
    });
  } catch (e) {
    console.error('[api/intel] error:', e);
    res.status(500).json({ error: 'INTERNAL', message: String(e.message || e) });
  }
};
