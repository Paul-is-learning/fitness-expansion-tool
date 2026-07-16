// ─────────────────────────────────────────────────────────────────────
// sw.js — Service worker (SaaS P3, v6.81) : lecture offline.
//
// Stratégies (conservatrices — un SW cassé est pire que pas de SW) :
//   /api/*            → réseau uniquement (503 JSON synthétique offline)
//   navigations HTML  → réseau d'abord, cache en secours (offline)
//   tout le reste GET → stale-while-revalidate (cache immédiat + refresh
//                       en arrière-plan), y compris CDN (réponses opaques)
//
// Versionné : bump CACHE quand la stratégie change → vieux caches purgés.
// ─────────────────────────────────────────────────────────────────────
const CACHE = 'fp-cache-v2';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // API : réseau seul — jamais de cache (données fraîches ou erreur claire)
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(req).catch(() =>
      new Response(JSON.stringify({ error: 'OFFLINE' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
    ));
    return;
  }

  // Navigations (HTML) : réseau d'abord, cache en secours
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const c = await caches.open(CACHE);
        c.put(req, fresh.clone());
        return fresh;
      } catch {
        const cached = await caches.match(req) || await caches.match('/');
        return cached || new Response('<meta charset="utf-8"><body style="font-family:sans-serif;background:#0a0f1c;color:#eee;display:grid;place-items:center;height:100vh"><div style="text-align:center"><h2>Hors ligne</h2><p>Reconnecte-toi pour charger l’application.</p></div>', { headers: { 'Content-Type': 'text/html' } });
      }
    })());
    return;
  }

  // v7.03 — LOGIQUE DE L'APP (même origine : /src/*.js, config.js, data/*) :
  // RÉSEAU D'ABORD. Un correctif de code arrive ainsi immédiatement au
  // prochain chargement (fini le « ça marche chez moi mais pas chez le user »
  // dû au cache). Repli cache uniquement si hors ligne.
  if (url.origin === location.origin && /\.(js|json)$/.test(url.pathname)) {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) { const c = await caches.open(CACHE); c.put(req, fresh.clone()).catch(() => {}); }
        return fresh;
      } catch {
        return (await caches.match(req)) || new Response('', { status: 504 });
      }
    })());
    return;
  }

  // Autres assets (même origine statiques + CDN) : stale-while-revalidate
  e.respondWith((async () => {
    const cached = await caches.match(req);
    const refresh = fetch(req).then(async (fresh) => {
      if (fresh && (fresh.ok || fresh.type === 'opaque')) {
        const c = await caches.open(CACHE);
        c.put(req, fresh.clone()).catch(() => {});
      }
      return fresh;
    }).catch(() => null);
    return cached || (await refresh) || new Response('', { status: 504 });
  })());
});
