# Architecture — Fitness Park Romania

## Philosophie

**Single-page app, zero-build, déploiement statique.**

L'outil est une application HTML/JS client-side déployée comme un fichier statique sur Vercel. Pas de bundler, pas de compilation, pas de backend. L'utilisateur final ouvre une URL, le navigateur télécharge les fichiers, et tout tourne côté client.

**Trade-off assumé :** on préfère la simplicité de maintenance ("j'édite un fichier, je push, c'est en ligne") à la sophistication technique. L'outil sert une démo B2B, pas 100k utilisateurs.

## Structure des fichiers

```
fitness-expansion-tool/
├── index.html              # Entry point — HTML markup + inline CSS + inline JS engine
├── config.js               # Constantes globales (Google API key, MODEL_VERSION)
├── test.html               # Smoke test de régression (ouvrir dans le navigateur)
│
├── data/                   # DATASETS — éditer ici pour mettre à jour les données
│   ├── targets.js          # 5 sites d'expansion prioritaires
│   ├── clubs.js            # 92 concurrents vérifiés
│   ├── cartiere.js         # 83 quartiers (pop, prix, % jeunes)
│   ├── pois.js             # 37 POIs (universités, malls, bureaux)
│   └── users.js            # Utilisateurs autorisés (login)
│
├── src/                    # MODULES LOGIQUES
│   └── utils.js            # simpleHash, haversine, fmt
│
├── docs/
│   └── ARCHITECTURE.md     # (ce fichier)
│
├── README.md               # Guide utilisateur
├── CHANGELOG.md            # Historique des changements
├── vercel.json             # Config déploiement
└── .baseline.json          # Valeurs de référence pour test.html
```

## Ordre de chargement (critique)

Les scripts sont chargés séquentiellement dans `<head>` (lignes 12-24 de index.html) :

1. **Libs externes** : Leaflet, MarkerCluster, Leaflet.heat, Chart.js (CDN)
2. **config.js** : constantes globales (BUCHAREST, GOOGLE_API_KEY, MODEL_VERSION)
3. **src/utils.js** : `simpleHash`, `haversine`, `fmt`
4. **data/targets.js** : `TARGETS` (5 sites)
5. **data/clubs.js** : `VERIFIED_CLUBS` + alias `DEMO_COMPS`
6. **data/cartiere.js** : `CARTIERE`
7. **data/pois.js** : `POIS`
8. **data/users.js** : `CANONICAL_USERS` — **dépend de simpleHash**
9. **Inline `<script>` d'index.html** : le reste (SECTORS, METRO, analyse, UI, auth, init)

⚠️ **Ne pas changer cet ordre.** `data/users.js` appelle `simpleHash()` au chargement → `src/utils.js` doit être chargé avant.

## Sommaire d'index.html (JS inline)

| Lignes | Section |
|---|---|
| ~920-940 | (Anciennes constantes globales — déplacées vers `config.js`) |
| ~945-1100 | Google Maps Platform API (fetch, cache, enrichment) |
| ~1110-1130 | State global (map, allComps, layers…) |
| ~1130-1160 | `SECTORS` (6 polygones de secteurs Bucharest) |
| ~1170-1290 | `COMP_DB`, `REVIEWS_DB`, `CLUB_AGE` + helpers reviews |
| ~1330-1340 | (TARGETS — déplacé) |
| ~1345-1460 | (VERIFIED_CLUBS, DEMO_COMPS — déplacés) |
| ~1465-1495 | `METRO` stations |
| ~1500-1530 | `INS_SECTOR_AGE` (stats démographiques) |
| ~1535-1625 | (CARTIERE — déplacé) |
| ~1630-1715 | Custom sites management (localStorage) |
| ~1720-1860 | Population estimation, revenue scenarios, cannibalization |
| ~1865-1905 | (POIS — déplacé) |
| ~1910-2020 | `init()` — DOMContentLoaded, map init |
| ~2025-2055 | Sectors drawing |
| ~2060-2250 | Map interactions (click, radius, analyze point) |
| ~2260-2340 | Overpass fetch (concurrents OSM) |
| ~2350-2395 | Competitor helpers (segments, couleurs, threat) |
| ~2400-2495 | `TRAFFIC_GENERATORS` + metro ridership |
| ~2500-2750 | SAZ scoring (flux, densité, jeunesse) |
| ~2755-2810 | Brand filters |
| ~2815-2920 | Competitor display on map |
| ~2925-3005 | Charts (Segmentation, Gap, Financial, Price) |
| ~3010-3100 | Compare zones, dashboard |
| ~3135-3260 | Site cards generation |
| ~3265-3290 | Sector-wide analysis |
| ~3295-3395 | Layer toggles, heatmap |
| ~3400-3445 | POIs, Cartiere layer |
| ~3450-3530 | Heatmaps (density, youth) |
| ~3535-3600 | SAZ weights controls |
| ~3605-4830 | **ANALYSIS ENGINE** — P&L, IRR, LTV/CAC, Monte Carlo |
| ~4835-4855 | Model version cache-buster |
| ~5150-5280 | `runCaptageAnalysis` (main entry) |
| ~5285-5700 | `renderCaptageAnalysis` + site analysis cards |
| ~5970-6020 | Site card metrics |
| ~6870-6880 | Utils (el, showLoad, setStatus) |
| ~6880-6900 | Auth state + session timeout |
| ~6905-6930 | User migration (ensures canonical users exist) |
| ~6930-7000 | Login / logout / role |

## Flux de données

```
User clicks a site on map
    ↓
onMapClick(e) → analyzePoint(lat, lng)
    ↓
runCaptageAnalysis(lat, lng, 3000)  ← core
    ↓
[getDemoInRadius, calcSAZ, calcNativeDemand, calcWalkIn,
 calcDestinationBonus, cohortModel, buildPnL, runMonteCarlo]
    ↓
renderCaptageAnalysis(container, lat, lng, 3000)
    ↓
DOM update (P&L, scoring, charts, rent slider)
```

## Authentication

Modèle ultra-simple, **client-side only** :

1. `data/users.js` exporte `CANONICAL_USERS` (hardcoded)
2. Au chargement, une migration vérifie que chaque user canonique existe en localStorage
3. `doLogin()` compare `simpleHash(password)` aux hash stockés
4. Session en `sessionStorage` → expirée à la fermeture de l'onglet + auto-timeout 10min

**Limites :**
- Pas de réinitialisation de mot de passe autonome
- Un admin change un mot de passe en éditant `data/users.js` + push
- Pour ajouter un user, éditer `data/users.js` + push. Migration automatique sur prochain chargement du navigateur de l'user.

## Model versioning & cache-busting

`config.js` exporte `MODEL_VERSION`. Le cache-buster à la fin du JS d'index.html compare cette version au `localStorage.fpModelVersion` :

- Si différent → clear `fpSiteAnalyses`, clear `fpCustomSites.analysisData`, clear `opCache`
- Puis ré-aligne les coordonnées des custom sites sur `TARGETS` (nom-match)

**Bump `MODEL_VERSION` quand :**
- Les formules du moteur financier changent
- Les coordonnées des TARGETS changent
- Tu ajoutes/retires un dataset

## Smoke test (`test.html`)

Charge l'app dans un iframe, login automatique, exécute `runCaptageAnalysis()` sur les 5 TARGETS, compare aux valeurs de `.baseline.json`.

**Exécuter après chaque refactor :** ouvrir `http://localhost:8091/test.html` → bouton "Run tests".
Tout doit être ✓ vert. Rouge = régression.

**Régénérer la baseline** (après changement de modèle intentionnel) :
Ouvrir la console sur index.html et copier le JSON généré par la routine de capture (voir code de test.html pour la structure).

## Ce qui est ENCORE dans index.html (et pourquoi)

Non extrait intentionnellement :
- **SECTORS polygones** : dépend de logique de polygon-hit dans le même bloc. Risque/bénéfice défavorable.
- **TRAFFIC_GENERATORS** : fortement lié à `calcFluxScore()`. Extraction risquée.
- **Moteur d'analyse** (~1000 lignes) : ~40 fonctions inter-dépendantes via globals. Refactor propre = 1-2 jours.
- **UI rendering** : fortement couplé au DOM et aux charts. Refactor nécessite event-bus ou component system.
- **Auth logic** (doLogin, doLogout) : court, côtoie la session management, pas de gain à l'extraction.

Ces zones sont candidates pour une **Phase C** future si le besoin en tests unitaires devient réel.
