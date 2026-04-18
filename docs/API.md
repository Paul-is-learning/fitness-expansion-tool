# Public API — FP Romania Expansion Tool

Cette doc liste la surface publique `window.*` de l'app : globals, events, helpers. Ces contrats sont le socle à préserver lors des refactors (idéalement sans breaking change mineur).

## Globals principaux

### État modèle
| Global | Type | Description |
|---|---|---|
| `MODEL_VERSION` | string | Version du modèle. Change → cache busté. |
| `PNL_DEFAULTS` | object | Tous les paramètres du BP (prix, ratios, CAPEX, financement). |
| `TARGETS` | array | Les 5 sites d'expansion canoniques (lecture seule). |
| `VERIFIED_CLUBS` | array | 92 concurrents vérifiés (lecture seule). |
| `CARTIERE` | array | 83 quartiers de Bucharest (lecture seule). |
| `POIS` | array | 37 POIs (universités, malls, bureaux). |
| `GOOGLE_API_KEY` | string | Clé Google Places — domain-restricted. |

### Overrides live (sliders)
| Global | Type | Shape |
|---|---|---|
| `window._rentOverride` | object\|null | `{ y1: number }` loyer base Y1 €/m² |
| `window._rentOverrides` | object | `{ [siteKey]: rentY1 }` per-site |
| `window._chargeOverride` | object\|null | `{ chargeTotal: number }` charges + marketing fee €/m² |
| `window._chargeOverrides` | object | `{ [siteKey]: chargeTotal }` per-site |
| `window._surfaceOverride` | object\|null | `{ surface: number }` surface m² |
| `window._surfaceOverrides` | object | `{ [siteKey]: surface }` per-site |

`siteKey = lat.toFixed(3) + ',' + lng.toFixed(3)`

### Custom sites
Schema v1 dans `localStorage.fpCustomSites` :
```ts
{
  id: number,           // Date.now()
  lat: number,          // [-90, 90]
  lng: number,          // [-180, 180]
  name: string,         // max 80 chars, sanitized (no HTML)
  notes: string,        // max 500 chars, sanitized
  status: 'prospect' | 'shortlist' | 'validated' | 'rejected',
  rating: number | null,
  analysisData: object | null,
  __v: 1                // schema version
}
```

## Fonctions modèle (pures)

| Fn | Signature | Notes |
|---|---|---|
| `runCaptageAnalysis(lat, lng, radius)` | → result object | Cœur du modèle. Audité (voir `src/audit.js`). |
| `buildPnL(cohortData, avgQuartierPrice)` | → PnL object | Pure. Lit overrides window. |
| `computeExecSummary(result)` | → `{ verdict, total, ...scores }` | Scoring agrégé. |
| `getSteppedRentMonthly(yearNum, scenario)` | → number | Loyer mensuel palier (override-aware). |
| `getSurfaceScale()` | → number | Ratio surface actuel / ref 1449. |
| `getScaledCapex()` | → number | CAPEX scalé sur surface. |
| `getScaledLeasingAnnual()` | → number | Leasing scalé sur surface. |

## Helpers mobile (namespace `_fpMobile`)

```js
window._fpMobile = {
  transitionTo(state),     // 'peek' | 'summary' | 'detail'
  activateSite(i, flyTo),  // index dans getAllSites()
  ensureAnalysis(i),       // force recompute si pas en cache
  isMobile()               // bool, viewport ≤ 768px
}
```

## i18n (v6.7+)

```js
window.t(key, params?)     // lookup dans dict FR/EN
window.getLocale()         // 'fr' | 'en'
window.setLocale(loc)      // switch + emit 'fp:locale-changed'
window.toggleLocale()      // toggle FR↔EN
```

## Error handling (v6.8+)

```js
window.safeTry(fn, ctx)    // sync wrapper → { ok, value?, err? }
window.safeAsync(fn, ctx)  // async variant
window.showToast(msg, level, opts)   // level: 'info'|'warn'|'error'|'success'
window._fpErrors.list()    // read last 50 runtime errors
window._fpErrors.clear()
```

## Utils (chargés en `src/utils.js`)

```js
simpleHash(str)            // djb2 hash (NOT secure, for localStorage keys)
haversine(lat1, lng1, lat2, lng2)  // distance meters
fmt(n)                     // French thousands-separated
escapeHtml(s)              // XSS-safe HTML escape
safeStorage.get/set/remove // localStorage with quota handling
debounce(fn, ms)
rateLimit(fn, n, ms)
retry(fn, { attempts, baseDelayMs, shouldRetry })
isOnline()
onOnlineChange(handler)    // returns unsub fn
```

## Events

Tous via `window.addEventListener(name, ev => ev.detail...)` :

| Event | Detail | Déclenché par |
|---|---|---|
| `fp:site-activated` | `{ index, target }` | `activateSite()` mobile |
| `fp:locale-changed` | `{ locale }` | `setLocale()` / `toggleLocale()` |
| `fp:invariant-violation` | `{ invariant, value }` | Runtime invariants check (`src/invariants.js`) |

## Audit + debug console

```js
dumpInvariants()     // violations de règles détectées
dumpValidation()     // problèmes dans les données statiques
dumpAuth()           // état auth + tentatives de login
exportAudit()        // log des analyses (copié clipboard)
exportAuditCsv()     // CSV export
replayAudit(entry)   // rejoue une analyse
```

## Conventions de version

- `MODEL_VERSION` bumpé sur toute modif fonctionnelle du modèle ou du schéma localStorage
- Tests `tests/analysis.html` doivent rester 197/197 PASS
- `.baseline.json` regénéré uniquement sur recalibration intentionnelle
- CHANGELOG.md documenté en FR, format semver-like

## À ne PAS faire

- Lire `TARGETS` directement dans du code qui doit inclure les custom sites → utiliser `getAllSites()` (mobile) ou `customSites` union
- Injecter des strings user-provided (name, notes) sans `escapeHtml()` → XSS
- Écrire dans localStorage sans try/catch ou `safeStorage.set()` → quota exception silencieuse
- Modifier les ratios `PNL_DEFAULTS` sans bumper `MODEL_VERSION` + régénérer baseline
