# Session Handoff — FP Romania Expansion Tool

> **Pour reprendre le contexte** : Claude, lis ce fichier en priorité avant d'intervenir.
> Tout l'historique pertinent du projet est ici. Répond en mode compact, pas de flourish.

## Identité projet
- **Client** : Paul Becaud (Isseo) — master-franchisé Fitness Park Romania
- **Outil** : SPA HTML/JS, single-file `index.html` ~7500L + modules extraits
- **Deploy** : Vercel auto, domaine `fitnesspark.isseo-dev.com`
- **Users** : Paul (admin), Ulysse, Tomescu (localStorage seed)
- **Versions actuelle** : v6.34-mes-sites-merged-list (voir CHANGELOG.md / git log pour détail)

## Stack & structure
```
api/sync.js             Vercel Serverless Function — backend KV pour sync custom sites (v6.29)
index.html              ~6800L (UI + moteur analyse + auth inline)
config.js               Constantes globales + MODEL_VERSION (cache-bust key)
data/*.js               TARGETS (5 sites), VERIFIED_CLUBS (92), CARTIERE (83),
                        POIS (37), CANONICAL_USERS
src/utils.js            simpleHash, haversine, fmt
src/mobile.js           Mobile v4.9+ : sheet 3 états + carousel + detail view
src/invariants.js       Runtime sanity checks (10 invariants)
src/validators.js       Schema check au boot
src/audit.js            Log des analyses sessionStorage
src/auth-guard.js       Rate limit + session sig
src/cloud-sync.js       Cross-device sync (pull/push debounced) → /api/sync (v6.29)
mobile.css              Responsive mobile-first (@media ≤ 768px)
desktop-polish.css      Glassmorphism + springs + pins desktop (@media ≥ 769px)
tests/analysis.html     197 assertions regression (baseline + invariants)
.baseline.json          Valeurs de référence 5 sites (regen à chaque recalib modèle)
docs/MODEL.md           Golden numbers documentation
docs/ARCHITECTURE.md    Layout fichiers + load order
```

## 5 TARGETS (priorité expansion — IRR Projet post-v6.25 incluant 2% impôts locaux)
1. **Hala Laminor** (Sec 3) — GO COND, IRR projet **55.4%** — flagship
2. **Baneasa Shopping City** (Sec 1) — GO COND, IRR **58.3%** — destination mall premium
3. **Unirea Shopping Center** (Sec 3) — GO COND, IRR **38.6%**
4. **Militari Shopping** (Sec 6) — WATCH, IRR **6.1%**
5. **Grand Arena** (Sec 4) — WATCH, IRR **1.4%**

Custom sites additionnés via UI desktop/mobile (autocomplete Google Places) → stockés localStorage `fpCustomSites` + sync auto cloud KV via `/api/sync` (v6.29+). Dans l'onglet "Mes sites" desktop (v6.34), TARGETS et customs sont mergés dans une seule liste numérotée 1-N, pins uniformes ronds dorés.

## Modèle financier — état actuel (v6.4)

### PNL_DEFAULTS (calibré OnAir Montreuil benchmark)
```js
// Revenus
priceBaseTTC: 28, pricePremiumTTC: 40, priceUltimateTTC: 50
TAUX_VAD: 0.20  // % clients forfaits supérieurs (slidable)
TVA_RO: 0.21

// Coûts % du CA
costOfSalesRate: 0.028      // OnAir réel 2.77%
opexOpsRateByYear: [0.20, 0.18, 0.16, 0.14, 0.12]  // Y1→Y5+ time-decay
  //                 Paul validé conservateur +1.2pp vs OnAir 10.8%
redevanceRate: 0.06         // Master-franchise Isseo (vs 4% OnAir classique)
fondsPubRate:  0.01         // Standard franchise EU
taxLocalRate:  0.02         // Impôts locaux RO (taxa pe clădiri) — ajout v6.25 (OnAir 2.2%)
staffRate: 0.09             // BP FP officiel
staffFloorAnnual: 65000     // 4 ETP Romania +3%/an inflation

// Loyer stepped objectifNego (Hala Laminor surface 1449 m²)
Y1-Y2: 10.5 €/m² + 5.5 charges → 16 €/m² all-in
Y3-Y4: 11.5 + 5.5 → 17
Y5+:   13   + 5.5 → 18.5
Indexation HICP 3%/an à partir Y2
Slider per-site rent (5-25) + slider per-site charges (0-12)

// CAPEX 1 176 000 €
Travaux 840k + Equip CAPEX 336k (leasing 504k @ 5 ans)

// Financement (v6.3)
equity 30% / emprunt 70% / taux 6.5% / 7 ans
→ IRR Projet (unlevered) + IRR Equity (levered)

// Divers
discountRate: 0.12, exitMultiple: 6, citRate: 0.16
targetMembers: 4000 (A3 maturité), caGrowthA4A6: 0.05
```

### Benchmark OnAir Montreuil (TEMATACA, Fiteco audité)
- CA 2.24 M€, EBITDA 44.7%, Net 25.4%, Y5 mature
- Staff 9% / Loyer 12.4% / OPEX ops 10.8% / Royalties 4% / Pub 1%
- Honoraires gestion 13.6% (holding) — NON modélisés (équivalent = 0 dividende BP)

## Mobile UX (v4.9-v5.x)

**Pattern "Site Browser"** inspiré Airbnb / Apple Maps :
- Map full-screen 100dvh
- Top bar : logo PNG officiel FP + search pill + avatar
- Bottom sheet 3 états : peek (168px carousel) / summary (58vh) / detail (100dvh)
- FAB ☰ bottom-right → secondary sheet (Couches / Concurrence / Mes sites / Dashboard)
- 5 pins numérotés dorés (targets) + custom pins violets
- Detail view : 4 hero metrics + 8 accordions :
  1. Localisation
  2. Score attractivité (SAZ) — radial 3 anneaux animés
  3. Démographie & marché
  4. Sources de membres (bars captifs/natifs/walkin/destBonus)
  5. P&L 3 scénarios (+ sparkline CAF annuelle Y1-Y5 + slider loyer + slider charges)
  6. Financement & IRR equity (equity/loan bar + IRR Projet vs Equity)
  7. Concurrents (proximité par distance + top marques)
  8. Structure coûts BP (type) — didactique avec benchmark OnAir

### Polish inclus (v5.x)
- Haptic vibration sur tap (navigator.vibrate)
- Spring animations cubic-bezier(.34,1.56,.64,1)
- Pulse pin actif, shimmer loading, parallax map scale
- Pull-down detail → summary, double-tap map → nearest target
- 3-step onboarding tour avec spotlight SVG mask
- Google Places autocomplete (search + add site)
- Session persistante mobile (localStorage, inactivity timer off)
- Toggle sync (data-orig-id preservation)

## Sécurité & reliability (v4.8)
- `src/invariants.js` : 10 checks runtime (total=somme, bornes, no-NaN)
- `src/validators.js` : schema des datasets au boot
- `src/audit.js` : log sessionStorage de chaque analyse
- `src/auth-guard.js` : rate limit 5/5min, signature HMAC localStorage
- Console debug : `dumpInvariants()`, `dumpValidation()`, `dumpAuth()`, `exportAudit()`

## Tests
`http://localhost:8091/tests/analysis.html` → **197/197 PASS**
Couverture : baseline 5 sites × 19 métriques + invariants + monotonicité + edge cases

## Commandes admin (console prod)
```js
dumpInvariants()  dumpValidation()  dumpAuth()  exportAudit()
window._fpMobile.transitionTo('summary'|'detail'|'peek')
window._fpMobile.activateSite(idx, true)
window._rentOverride = {y1: 12}         // override loyer base
window._chargeOverride = {chargeTotal: 7}  // override charges
window._surfaceOverride = {surface: 2000}  // override surface m²
```

## Patterns de code importants

### Rent / charges / surface override per-site
```js
window._rentOverrides[siteKey]     // {siteKey: rentY1}
window._chargeOverrides[siteKey]   // {siteKey: chargeTotal}
window._surfaceOverrides[siteKey]  // {siteKey: surface m²}
// Sont appliqués via window._rentOverride / _chargeOverride / _surfaceOverride (singulier)
// Restore auto : activateSite(i) mobile + renderCaptageAnalysis desktop
```

### Mobile clone strategy (FAB secondary sheet)
- Clone des tab-panels desktop dans le FAB
- `stripAllIds(clone)` → `data-orig-id` préservé
- Change handler bridge clone.select → desktop select.value + onchange
- `syncClonedDynamicContent(clone)` recopie innerHTML desktop → clone (sauf form controls)

### Cache-bust MODEL_VERSION
Bump `MODEL_VERSION` dans `config.js` quand modèle change → clear `fpSiteAnalyses` + `fpCustomSites.analysisData` + `opCache`.

## Règles de conduite avec Paul
1. **Mode compact** : pas de flourish, pas de tableaux exhaustifs sauf demande explicite
2. **Pragmatique direct** : quand il demande mon avis, je tranche (pas 3 options molles)
3. **Tests après chaque changement** : 197/197 doit rester green (update baseline si calibration intentionnelle)
4. **Commit + push après chaque feature validée** : bump MODEL_VERSION, update CHANGELOG
5. **Si PDF sandbox Mail** : demander de déplacer sur ~/Desktop
6. **`cd` dans bash** : toujours utiliser `/Users/paulbecaud/Desktop/fitness-expansion-tool` absolute

## Points ouverts / à surveiller
- Scenario mode "Optimiste+" à 9.2% OPEX cruising (refusé par Paul, resté à 12%)
- Management fee Isseo potentiel (non modélisé, équivalent honoraires gestion OnAir 13.6%)
- Impôts locaux RO (CET-équivalent, non modélisé, OnAir 2.2% CA)
- Pour future séance : possibilité d'ajouter scénario "stress test" sur chaque param
- Plateforme admin user creation — discuté mais finalement hardcoded dans `data/users.js`

## Dernière session (2026-04-20 · v6.23 → v6.34)

### Onboarding tour — stabilisation rendu (v6.23 → v6.24)
- **v6.23** : refonte slides en CSS grid stacking (toutes slides partagent la même cellule grid, hauteur = plus grand slide) → fix chevauchement contenu/dots/CTA sur slides BP + Sources. `syncWrapHeight` JS devient no-op.
- **v6.23** : bouton 🔄 **hard refresh** in-app (bottom-left, doré) qui clear CacheStorage + unregister SW + reload avec `?hard=ts`.
- **v6.24** : fix courbe revenus A1→A10 invisible sur slide BP — wrapper de chaque barre reçoit `align-self:stretch + justify-content:flex-end` (avant: parent `auto` → `height:%` résolvait à 0) + animation `fpOnbBarGrow` gated par `.fp-onb-slide.ready` (avant: animations `forwards` inline consumed au boot avec grid-stack).

### Modèle financier — conservatisme investisseur (v6.25)
- **Décision Paul master-franchisé** : ajout `taxLocalRate: 0.02` dans `PNL_DEFAULTS` (OnAir Montreuil 2.2%, arrondi). Intégré dans 3 spots P&L (main, sensitivity, Monte Carlo) + persisté dans `monthly[]`.
- Impact 5 TARGETS : IRR -2.0 à -2.2pp, NPV -100 à -250k€, payback +1-2 mo. **Aucun verdict ne bascule** (3 GO COND, 2 WATCH inchangés).
- Slide BP "Coûts" du tour étendue à 7 lignes + EBITDA cible Y5+ 44-55% → 42-53%. Subtitles FR/EN i18n synchros.
- `.baseline.json` + `tests/analysis.html BASELINE` régénérés → **197/197 PASS** confirmé.

### UX — CAPEX et v2.8 (v6.26)
- **v6.26** : vignette CAPEX du tour BP affiche maintenant 2 montants empilés : CAPEX bilan **1 176 k€** (22px doré, secondaire) + **Total cash + leasing 1 680 k€** (30px vert brillant, dominant) — demande Paul "en plus gros", logique investisseur vs compta.
- Cleanup **v2.8 supprimée définitivement** : badge sidebar + règle CSS orpheline + BUILD comment + meta + footers. Single source of truth = `config.js MODEL_VERSION`.

### Sites custom — fixes + cross-device sync (v6.27 → v6.30)
- **v6.27** : pin custom doré (uniforme TARGETS) au lieu de violet. Border-left card doré. `switchTab('mysites')` force re-render defensive (`_loadCustomSites` + `refreshCustomMarkers` + `renderCustomSites`). ID match laxe `String(s.id) === String(id)` dans `removeCustomSite` / `qualifyCustomSite` / `analyzeCustomSite` (évite no-op silencieux).
- **v6.28** : export/import JSON via clipboard + URL `?import=<base64>` (fallback manuel cross-device).
- **v6.29** : **Vraie sync auto Mac↔iPhone via Vercel KV (Upstash Redis)**. Architecture :
  - `api/sync.js` : Vercel Serverless Function (Node). `GET /api/sync?user=<email>` → `{sites, ts}` ; `POST` → upsert. Whitelist 4 emails server-side. Cap 500 sites / 500KB. Fallback `503` si KV non configuré.
  - `src/cloud-sync.js` : `window.cloudSync` exposé (`pull`, `push`, `pushNow`, `isAvailable`, `status`). pull() au boot (event `fp:login-success`) + `visibilitychange` + polling 30s. push() debounce 0.9s après mutations. Last-write-wins + dedup lat/lng 4-décimales.
  - Hooks dans `addCustomSite`, `removeCustomSite`, `qualifyCustomSite`, `importCustomSites`.
  - Badge UI `#fpCloudSyncBadge` : 🟢 Synchronisé / 🟡 Local seul / 🔴 Erreur.
- **v6.30** : fix push initial — si pull retourne `{sites:[], ts:0}` ET `customSites.length > 0`, push automatique pour uploader les sites localStorage pré-v6.29. Sinon iPhone/Mac restent désynchros tant qu'aucun site n'est modifié post-v6.29.
- **Setup Paul effectué** : Upstash Redis connecté au projet Vercel (région fra1, free 500k commandes/mois, env vars `KV_REST_API_URL` + `KV_REST_API_TOKEN` injectées). Redeploy fait. `/api/sync` répond **HTTP 200**. Doc `docs/CLOUD_SYNC_SETUP.md`.

### Harmonisation pins + parité desktop/mobile (v6.31 → v6.34)
- **v6.31** : pins TARGETS **sur la carte desktop** (manquaient avant, juste liste sidebar). Nouvelle fonction `renderTargetPinsDesktop()` → `targetMarkersLayer` Leaflet avec divIcons ronds dorés 30px numérotés 1-5. Skip si viewport ≤ 768px (mobile.js gère ses propres pins).
- **v6.32** : pins custom sites **même style que TARGETS** (ronds dorés numérotés 6+). Avant : carrés 22px avec étoile (★). Après : ronds 30px gradient doré/vert/rouge selon status. `refreshCustomMarkers` calcule `startNum = TARGETS.length + 1` et incrémente par site. `addCustomSite` appelle `refreshCustomMarkers()` pour garder la numérotation continue.
- **v6.33** : parité mobile ↔ desktop sur les sliders fiche site. Avant : mobile avait loyer + charges + surface, desktop avait seulement loyer. Après : desktop a les 3 (`onChargeSliderChange` + `onSurfaceSliderChange` ajoutées, même logique que `src/mobile.js`). Debounce 150ms recalc 3 scénarios P&L + persist `_siteAnalyses`.
- **v6.34** : liste "Mes sites d'implantation" desktop **fusionne TARGETS + customs** numérotés 1-N. TARGETS (1-5) = border-left doré, badge `TARGET BP`, bouton **Analyser** seul (non-supprimables car hardcoded). Customs (6+) = select status (prospect/shortlist/validé/rejeté) + **Analyser** + **Suppr**. Ajout/suppression reflète immédiatement le DOM, le localStorage et le cloud KV.

### Règles confirmées (à préserver)
- Tests `tests/analysis.html` doivent rester **197/197 PASS** (update `.baseline.json` + inline `BASELINE` si recalibration intentionnelle).
- Chaque commit = bump `MODEL_VERSION` dans `config.js` + entrée dans `CHANGELOG.md`.
- Sync edits vers `/tmp/fitness-serve/*` pour que le preview Python http.server marche.
- Les ratios de `PNL_DEFAULTS` sont figés post-calibration OnAir — seuls loyer/charges/surface sont variables par site (+ `taxLocalRate` 2% figé v6.25).

## Sessions précédentes (≤ v6.25)
- **Décision investisseur** (Paul, master-franchisé) : ajout 2% impôts locaux RO (taxa pe clădiri) dans `PNL_DEFAULTS.taxLocalRate`. Sourcing OnAir Montreuil 2.2%.
- Charge externe → pèse sur EBITDA, intégrée dans 3 spots P&L (sensitivity, main, Monte Carlo).
- Slide BP "Coûts" du tour étendue à 7 lignes ; EBITDA cible Y5+ ajusté 44-55% → 42-53%.
- Baselines régénérés : IRR -2.0 à -2.2pp sur tous sites, NPV -100 à -250k€, payback +1-2 mo. **Aucun verdict ne bascule** (3 GO COND, 2 WATCH inchangés).
- Tests 197/197 PASS confirmé en preview.
- v6.24 (intermédiaire) : fix courbe revenus A1→A10 invisible (sizing flex `align-self:stretch` + animation gated `.fp-onb-slide.ready`).

## Sessions précédentes (≤ v6.23)
- Diagnostic : sur desktop 1440×900, ancien CSS persistait à cause du cache navigateur (.js chargés avec `defer`). Mobile était refresh, desktop non. Code lui-même clean (vérifié screenshot).
- Solutions cache desktop : (1) bouton 🔄 in-app bottom-left, (2) Cmd+Shift+R (Chrome/Arc/Edge) ou Cmd+Option+R (Safari), (3) DevTools → Network → "Disable cache" + Cmd+R.
- Bump MODEL_VERSION → `v6.23-tour-grid-stack-layout` purge auto les caches internes (`fpSiteAnalyses`, `fpCustomSites.analysisData`, `opCache`) au prochain reload.
- Travaux v6.13 → v6.23 (commits récents) : onboarding tours i18n FR/EN 8 slides, demo panel "Comment ça marche" carousel 6 slides Apple-like, tours BP/Sources lisibles + effets 2027, slide BP fidèle structure OnAir-calibrated, fix persistance KPIs après override loyer/charges/surface (commit `63063aa`).

## Sessions historiques
- v6.1 : OPEX time-decay Y1 20% → Y5 15%
- v6.2 : OPEX Y5+ compressé à 12% (décision Paul)
- v6.3 : Financement equity/loan 30/70 @ 6.5% / 7ans + IRR equity + 2 nouveaux accordions (Financement + BP Template)
- v6.4 : Slider charges €/m² per-site + live recalc
