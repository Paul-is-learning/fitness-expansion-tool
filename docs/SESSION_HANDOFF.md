# Session Handoff — FP Romania Expansion Tool

> **Pour reprendre le contexte** : Claude, lis ce fichier en priorité avant d'intervenir.
> Tout l'historique pertinent du projet est ici. Répond en mode compact, pas de flourish.

## Identité projet
- **Client** : Paul Becaud (Isseo) — master-franchisé Fitness Park Romania
- **Outil** : SPA HTML/JS, single-file `index.html` ~7500L + modules extraits
- **Deploy** : Vercel auto, domaine `fitnesspark.isseo-dev.com`
- **Users** : Paul (admin), Ulysse, Tomescu (localStorage seed)
- **Versions actuelle** : v6.8-reliability (voir CHANGELOG.md pour détail)

## Stack & structure
```
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
mobile.css              Responsive mobile-first (@media ≤ 768px)
desktop-polish.css      Glassmorphism + springs + pins desktop (@media ≥ 769px)
tests/analysis.html     197 assertions regression (baseline + invariants)
.baseline.json          Valeurs de référence 5 sites (regen à chaque recalib modèle)
docs/MODEL.md           Golden numbers documentation
docs/ARCHITECTURE.md    Layout fichiers + load order
```

## 5 TARGETS (priorité expansion)
1. **Hala Laminor** (Sec 3) — GO COND, IRR projet 57.6% / equity 89.3% — flagship
2. **Unirea Shopping Center** (Sec 3) — GO COND, IRR 40.6%
3. **Militari Shopping** (Sec 6) — WATCH, IRR 8.3%
4. **Grand Arena** (Sec 4) — WATCH, IRR 3.6%
5. **Baneasa Shopping City** (Sec 1) — GO COND, IRR 60.5% — destination mall premium

Custom sites additionnés via UI mobile (autocomplete Google Places) → stockés localStorage `fpCustomSites`.

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

## Dernière session
- v6.1 : OPEX time-decay Y1 20% → Y5 15%
- v6.2 : OPEX Y5+ compressé à 12% (décision Paul)
- v6.3 : Financement equity/loan 30/70 @ 6.5% / 7ans + IRR equity + 2 nouveaux accordions (Financement + BP Template)
- v6.4 : Slider charges €/m² per-site + live recalc
