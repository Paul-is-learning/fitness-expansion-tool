// ─────────────────────────────────────────────────────────────────────
// ci/run-tests.mjs — exécute la suite tests/analysis.html (197 assertions)
// en headless pour la CI. Sort avec le code 0 si "ALL PASS", 1 sinon.
//
// Déterminisme : les hôtes externes instables (Overpass, Google) sont
// bloqués — les fallbacks du code (VERIFIED_CLUBS, dégradation Places)
// sont précisément conçus pour fonctionner sans eux. Les CDN (Leaflet,
// Chart.js) restent accessibles car nécessaires au boot.
//
// Usage local :  node ci/run-tests.mjs   (nécessite: npx playwright install chromium)
// ─────────────────────────────────────────────────────────────────────
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = 8199;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    const file = normalize(join(ROOT, p));
    if (!file.startsWith(normalize(ROOT))) { res.writeHead(403); res.end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(r => server.listen(PORT, r));
console.log(`[ci] serving ${ROOT} on :${PORT}`);

const BLOCKED = ['overpass-api.de', 'places.googleapis.com', 'maps.googleapis.com', 'api.resend.com', 'api.anthropic.com'];
const browser = await chromium.launch();
const page = await browser.newPage();
await page.route('**/*', route => {
  const host = new URL(route.request().url()).hostname;
  if (BLOCKED.some(b => host.endsWith(b))) return route.abort();
  return route.continue();
});
page.on('pageerror', e => console.log('[page error]', String(e).slice(0, 200)));

let ok = false;
try {
  await page.goto(`http://localhost:${PORT}/tests/analysis.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /run/i }).click();
  // La suite affiche "✅ ALL PASS — 197/197" ou "Fail: N"
  await page.waitForFunction(
    () => /ALL PASS|Fail:\s*[1-9]/.test(document.body.innerText),
    null, { timeout: 240000, polling: 1000 }
  );
  const text = await page.evaluate(() => document.body.innerText);
  const summary = text.split('\n').filter(l => /(ALL PASS|Total:|Pass:|Fail:)/.test(l)).slice(0, 6);
  console.log('[ci] résultat :\n' + summary.map(s => '  ' + s).join('\n'));
  const fails = text.split('\n').filter(l => /got .+expected/.test(l)).slice(0, 20);
  if (fails.length) console.log('[ci] échecs :\n' + fails.map(s => '  ✗ ' + s).join('\n'));
  ok = /ALL PASS/.test(text);
} catch (e) {
  console.error('[ci] erreur d\'exécution :', String(e).slice(0, 500));
}

await browser.close();
server.close();
console.log(ok ? '[ci] ✅ 197/197 — OK pour déployer' : '[ci] ❌ ÉCHEC — ne pas déployer');
process.exit(ok ? 0 : 1);
