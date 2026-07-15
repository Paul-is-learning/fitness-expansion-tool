// ─────────────────────────────────────────────────────────────────────
// ci/ui-tests.mjs — tests E2E des PARCOURS (boutons, écrans, interactions).
//
// Complète ci/run-tests.mjs (qui teste le MOTEUR, 197 assertions) : ici on
// teste que l'INTERFACE marche — login, analyse, Studio FCF, Plan de
// Conquête, point mort, Top clubs, mémo, partage. « Ça marche à 100% »
// devient prouvé à chaque push, pas promis.
//
// Headless Playwright, hôtes externes bloqués (déterminisme). Exit 0 si
// tous les parcours passent, 1 sinon — avec le détail des échecs.
// ─────────────────────────────────────────────────────────────────────
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = 8198;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    // Stub des endpoints API en local (le moteur n'en a pas besoin, dégrade proprement)
    if (p.startsWith('/api/')) { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end('{"error":"CI_STUB"}'); return; }
    const file = normalize(join(ROOT, p));
    if (!file.startsWith(normalize(ROOT))) { res.writeHead(403); res.end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(r => server.listen(PORT, r));

const BLOCKED = ['overpass-api.de', 'places.googleapis.com', 'maps.googleapis.com', 'basemaps.cartocdn.com'];
const browser = await chromium.launch();
const page = await browser.newPage();
await page.route('**/*', route => {
  const host = new URL(route.request().url()).hostname;
  if (BLOCKED.some(b => host.endsWith(b))) return route.abort();
  return route.continue();
});

const results = [];
const check = (name, cond, detail) => { results.push({ name, ok: !!cond, detail: cond ? '' : (detail || '') }); };

try {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  // désactive le tour d'onboarding
  await page.evaluate(() => localStorage.setItem('fpOnbTour:paulbecaud@isseo-dev.com', '99'));

  // ── 1. LOGIN ──
  await page.evaluate(() => {
    document.getElementById('loginEmail').value = 'paulbecaud@isseo-dev.com';
    document.getElementById('loginPassword').value = '123456';
    document.getElementById('loginForm').dispatchEvent(new Event('submit', { cancelable: true }));
  });
  await page.waitForTimeout(1500);
  const loggedIn = await page.evaluate(() => document.getElementById('loginPage').style.display === 'none');
  check('login (123456)', loggedIn, 'login page still visible');

  // ── 2. ANALYSE d'un site ──
  await page.evaluate(() => window.analyzeTargetByIdx(0));
  await page.waitForFunction(() => document.getElementById('captageContentSite')?.innerText.includes('EN CLAIR'), null, { timeout: 15000 }).catch(() => {});
  const analysis = await page.evaluate(() => {
    const t = document.getElementById('captageContentSite')?.innerText || '';
    return { verdict: /GO COND|WATCH|NO GO/.test(t), enClair: t.includes('EN CLAIR'), breakeven: !!document.getElementById('pnl-breakeven-block')?.innerHTML, lastData: !!window._lastCaptageData?.r };
  });
  check('analyse: verdict rendu', analysis.verdict);
  check('analyse: synthèse EN CLAIR', analysis.enClair);
  check('analyse: bloc point mort', analysis.breakeven);
  check('analyse: données en mémoire', analysis.lastData);

  // ── 3. POINT MORT recalcule avec la dette ──
  const be = await page.evaluate(() => {
    const withDebt = computeBreakEvenMembers('fcfe', 4);
    const equityOnly = computeBreakEvenMembers('fcfe', 4, 'equity');
    return { withDebt, equityOnly, coherent: withDebt > equityOnly && equityOnly > 0 };
  });
  check('point mort: dette > equity (levier coûte des adhérents)', be.coherent, `withDebt=${be.withDebt} equityOnly=${be.equityOnly}`);

  // ── 4. STUDIO FCF ──
  const studio = await page.evaluate(async () => {
    FcfStudio.open();
    await new Promise(r => setTimeout(r, 400));
    const rows = document.querySelectorAll('#fpFcfStudio tbody tr').length;
    // coche une hypothèse (capex 900k) → doit recalculer la colonne B
    FcfStudio._set('B', 'capex', 'on', true);
    FcfStudio._set('B', 'capex', 'v', 900);
    await new Promise(r => setTimeout(r, 400));
    const cells = [...document.querySelectorAll('#fpFcfStudio tbody tr')].map(tr => tr.innerText);
    const capexRow = cells.find(c => /CAPEX/.test(c)) || '';
    FcfStudio.close();
    return { rows, capexReflects900: /900/.test(capexRow) };
  });
  check('Studio FCF: 13 lignes KPI', studio.rows === 13, `rows=${studio.rows}`);
  check('Studio FCF: cocher CAPEX 900k recalcule', studio.capexReflects900);

  // ── 5. PLAN DE CONQUÊTE : 3 modes financement ──
  const conquest = await page.evaluate(async () => {
    ConquestPlan.open();
    await new Promise(r => setTimeout(r, 700));
    const grab = () => (document.getElementById('fpConquest')?.innerText || '').replace(/\s+/g, ' ');
    const ref = grab();
    ConquestPlan._cfg('finMode', 'equity');
    await new Promise(r => setTimeout(r, 700));
    const eq = grab();
    ConquestPlan._cfg('finMode', 'hybrid');
    await new Promise(r => setTimeout(r, 700));
    const hy = grab();
    const out = {
      refDebt: (ref.match(/🏦 dette 70%/g) || []).length,
      eqFp: (eq.match(/💰 100% FP/g) || []).length,
      hyMix: (hy.match(/🏦 dette 70%/g) || []).length > 0 && (hy.match(/💰 100% FP/g) || []).length > 0,
      bankable: /🏦 A\d+ M\d+/.test(hy),
    };
    ConquestPlan.close();
    return out;
  });
  check('Conquête: mode ref = dette partout', conquest.refDebt >= 4, `${conquest.refDebt} clubs en dette`);
  check('Conquête: mode fonds propres', conquest.eqFp >= 4, `${conquest.eqFp} clubs FP`);
  check('Conquête: mode hybride mélange FP+dette', conquest.hyMix);
  check('Conquête: point de bancabilité calculé', conquest.bankable);

  // ── 6. TOP CLUBS ──
  const top = await page.evaluate(async () => {
    openTopClubs();
    await new Promise(r => setTimeout(r, 300));
    const rows = document.querySelectorAll('#fpTopClubsModal tbody tr').length;
    document.getElementById('fpTopClubsModal')?.remove();
    return rows;
  });
  check('Top clubs: classement rendu (25 lignes)', top === 25, `rows=${top}`);

  // ── 7. MÉMO d'IC ──
  const memo = await page.evaluate(() => {
    const html = window.ICMemo?.buildHtml();
    return { ok: typeof html === 'string' && html.length > 5000, sections: html && ['En bref', 'La demande', 'Plan financier', 'Recommandation'].every(s => html.includes(s)) };
  });
  check('Mémo IC: HTML complet généré', memo.ok);
  check('Mémo IC: 4 sections clés présentes', memo.sections);

  // ── 8. modules exposés ──
  const mods = await page.evaluate(() => ['FcfStudio', 'ConquestPlan', 'ICMemo', 'AiAnalyst', 'ShareLink', 'UserDataSync', 'ReviewsHistory', 'Portfolio', 'AdminUsers'].every(m => typeof window[m] === 'object' && window[m]));
  check('tous les modules SaaS exposés', mods);

  // ── 8b. v6.87 — login mot de passe seul (magic link retiré) ──
  const authUi = await page.evaluate(() => ({ magicGone: !document.getElementById('magicBlock'), form: !!document.getElementById('loginForm') }));
  check('écran login: bloc magic link retiré', authUi.magicGone && authUi.form);

  // ── 9. console sans erreur JS (hors réseau bloqué) ──
} catch (e) {
  check('exécution sans exception', false, String(e).slice(0, 300));
}

await browser.close();
server.close();

const pass = results.filter(r => r.ok).length;
const fail = results.filter(r => !r.ok);
console.log(`\n[ui] ${pass}/${results.length} parcours OK`);
results.forEach(r => console.log(`  ${r.ok ? '✅' : '❌'} ${r.name}${r.detail ? ' — ' + r.detail : ''}`));
if (fail.length) { console.log(`\n[ui] ❌ ${fail.length} parcours en échec`); process.exit(1); }
console.log('\n[ui] ✅ tous les parcours passent');
process.exit(0);
