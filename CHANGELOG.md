
# Changelog

## [v6.64.1-bp-site-club-type-capex-y1] — 2026-04-24

### 🩹 Fix post-review Paul — BP du site : chiffres par club honnêtes

Paul a regardé la v6.64 : « 17.42M€ EBITDA Y5 Laminor ne peut pas faire ça mec. » — Il avait raison, on lisait `PL_CONSO` (cumul master-franchisé multi-clubs) au lieu de `PL_CLUB_TYPE` (un club seul). Puis « Pas de capex tous les ans — Cf BP excel » : la maquette Excel répète `=-HYPOTHESES!$C$81` dans toutes les colonnes de `PL_CLUB_TYPE!C45:L45`, comptabilisant 10× le CAPEX sur l'horizon. Fix en 2 temps :

**1. Lecture PL_CLUB_TYPE au lieu de PL_CONSO**
- `bp_runner.js extractKPIs()` lit maintenant `PL_CLUB_TYPE` (un club, 10 ans) :
  - CA : row 12 "TOTAL CA - Ligne P&L"
  - EBITDA : row 34
  - Marge EBITDA : row 35
  - Résultat net : row 41
  - Operating CF : row 46
- Hala Laminor captage 7 093 mbr : EBITDA Y5 passe de 17.42M€ (consolidé 5 clubs) → **1.56M€ (1 club)**. Marge EBITDA 59.4%. Cohérent benchmark OnAir Montreuil (44% mature).

**2. Retraitement CAPEX Y1-uniquement**
- Le Excel source a `PL_CLUB_TYPE!C45..L45 = -HYPOTHESES!$C$81` → CAPEX 1.18M€ répété 10×. Le bon comportement : CAPEX payé en Y1, 0 ensuite.
- `bp_runner.js` ignore les rows 45, 47, 48 de la maquette et reconstitue : `capex[0] = -HYPOTHESES!C81`, `capex[1..9] = 0`, puis `netCF[i] = opCF[i] + capex[i]`, cumul recalculé, payback = 1re année cumul ≥ 0, TRI = `IRR(netCF)` via `BPEngine._internals.irr`.
- Résultat Hala Laminor :
  ```
  CAPEX       -1.22 M€ Y1 (0 ensuite)
  A · BP 3600    B · 7093      Δ
  EBITDA Y5   596 k€         1.56 M€       +960 k€ (+161%)
  Marge       44.4%          59.4%         +15.0 pp
  Net Y5      311 k€         1.12 M€       +806 k€
  TRI 10a     35.6%          113.3%        +77.7 pp
  Payback     A4             A3            -1 an
  ```
- TRI et payback ré-affichés dans le comparatif (ils étaient retirés en v6.64 pour cause de données non-interprétables).

**3. UI — transparence sur le retraitement**
- Note en bas du bloc BP du site : « TRI/Payback recalculés avec CAPEX X€ en Y1 seulement (la maquette Excel répète =−HYPOTHESES!C81 sur 10 ans dans PL_CLUB_TYPE!C45:L45). Vue consolidée master-franchisé : 💰 Éditer BP. »
- Honnêteté analytique > parité 1:1 muette : quand la source est cassée on le dit et on corrige explicitement.

### Tests

`tests/analysis.html` → **197/197 PASS**. Zéro régression.

---

## [v6.64-bp-site-2-scenarios] — 2026-04-24

### 🏦 BP du site — 2 scénarios comparés par site (desktop + mobile)

Quand Paul analyse un site, le moteur Excel BP (3 659 formules) tourne automatiquement avec **les 3 variables du site** (surface, loyer €/m²/mois, charges €/m²/mois) injectées dans `HYPOTHESES!C50/C51/C52`, puis 2 scénarios côte à côte :

- **Scénario A · BP Franchise** : `targetMembers = C34 baseline (3600)` — projection du BP officiel appliqué à ce local.
- **Scénario B · Projection outil** : `targetMembers = captage calculé par l'outil` (SAZ/démographie/concurrence) — ce que la réalité terrain prédit.

Ramp-up **identique** (70% / 90% / 100%) entre les deux → le delta est une **prime de localisation pure**, non polluée par des hypothèses supplémentaires. Honnêteté analytique > richesse visuelle.

### Livrables

- **`src/bp/bp_runner.js`** — wrapper singleton autour de `BPEngine.Model`. Charge `bp_ir.json` une seule fois (lazy `init()`), snapshot des valeurs baseline, `run({surface, loyerM2Month, chargesM2Month, targetMembers})` restore→apply→re-evaluate topo sans rebuild DAG. Extrait les KPIs via `findPLConsoRows()` heuristique de labels col A. **Perf 15-21 ms par scénario** (objectif < 25 ms tenu avec marge).

- **`src/bp/bp_site_ui.js`** — module UI autonome :
  - `render(containerId, params, {canvasId?})` — async, trigger les 2 runs, inject verdict + KPI duels + Chart.js + tableau A1→A10
  - `openFullscreen()` — modal plein écran 1200px (même contenu, courbes plus grandes, tableau ouvert par défaut)
  - Verdict 1 phrase auto-graduée : « Site surperforme le BP franchise de +XX% EBITDA Y5 (±Xk€) »
  - Delta < 2% = neutre (gris), > 0 = vert, < 0 = rouge
  - Chart.js `Chart.getChart(canvas)` pour destroy-then-redraw (pas de memory leak)

- **`index.html`** — bloc inline injecté dans `renderCaptageAnalysis` (entre P&L et BRIDGE CA), avec bouton ⛶ Agrandir. Fallback nom de site étendu à `TARGETS.find()` (avant : seulement `_lastCaptageLocation.siteName` + `customSites.find()` → nom générique pour TARGETS).

- **`src/mobile.js`** — nouvel accordéon `data-sec="bpsite"` entre le P&L 3 scénarios et Financement. Render lazy au 1er open (signature `surface|loyer|charges|captage|name` pour re-render seulement si les inputs changent).

- **Persistance** — `window.saveBPSiteScenarios(params, kpis)` écrit `bpSite.{inputs, scenarioA, scenarioB, savedAt}` dans chaque entrée `fpSiteAnalyses`. Permet au ranking de cross-référencer le delta de localisation sans ré-exécuter Excel.

### Résultat exemple (Hala Laminor)

```
BP Franchise (3600 mbr)   |  Projection outil (7093 mbr)  |  Δ
CA Y5        16.70 M€     |  32.21 M€                     |  +15.51 M€
EBITDA Y5    5.97 M€      |  17.42 M€                     |  +11.44 M€  (+192%)
Marge EBITDA 35.8%        |  54.1%                        |  +18.3 pp
TRI 10a      76.6%        |  132.0%                       |  +55.4 pp
Payback      A8           |  A4                           |  -4 an
```

Verdict auto : « Site surperforme le BP franchise de +192% EBITDA Y5 (+11.44M€). »

### Cohabitation avec le reste de l'app

- Les sliders loyer/charges/surface existants propagent leurs valeurs au BP du site via `window._rentOverrides[siteKey]` etc. → bouger un slider déclenche déjà `renderCaptageAnalysis` qui re-render le BP.
- Aucune modification des ratios `PNL_DEFAULTS` (figés post-OnAir v6.25). Le moteur BP est une source de vérité parallèle (Excel 1:1), il ne cannibalise pas le P&L 3 scénarios de l'outil.

### Tests

`tests/analysis.html` → **197/197 PASS**. Zéro régression sur le modèle existant.

### Prochain — P2c possible

- Waterfall CA→EBITDA→Résultat net Y5 pour chaque scénario
- Sensibilité univariée : courbe « delta EBITDA Y5 si captage ± 10% »
- Export PDF du comparatif 2 scénarios (one-pager bancable)

---

## [v6.63-bp-editor-live-P2a] — 2026-04-24

### 🎛️ Phase 2a — éditeur BP live fonctionnel

Livraison d'une UI complète branchée sur le moteur Excel→JS : **`/structure-couts.html`**. Paul bouge un slider, tous les KPIs se recalculent en temps réel.

### Livrables

- **`src/bp/bp_inputs.js`** — 42 inputs métadonnés (hors headers de section), typés strict (coord Excel, label, unité, type eur/pct/nb, min/max/step, baseline, groupe). Groupés en 8 sections visuelles : Franchise & redevances / Fiscalité / Commercial & offre / Ramp-up & croissance / Ressources humaines / Loyer & surface / OPEX opérationnels / CAPEX & leasing.

- **`structure-couts.html`** — page éditeur autonome :
  - Layout 2 colonnes : sidebar inputs + main content KPIs/tables
  - Panneau KPI sticky (CA A5, EBITDA A5, Marge EBITDA A5, TRI 10a, Payback, Recalc ms)
  - Deltas live vs baseline colorés (vert/rouge/gris)
  - Alertes automatiques : TRI < WACC (12%), Marge EBITDA < 20%, EBITDA négatif, TRI > 25% (✅)
  - P&L consolidée A1→A10 (CA, EBITDA, Marge, Résultat net)
  - P&L club type A1→A10
  - DCF comparaison BPI/Mix/Voblig sur horizons 5/7/10 ans
  - Recalcul incrémental via topo sort déjà calculé (on ne ré-évalue que les formules, pas le DAG)
  - Bouton "↺ Tout reset" pour revenir aux valeurs baseline Excel

### Mécanique de recalc

À chaque modification de slider :
1. Override `model.values['HYPOTHESES!C42'] = 40` (nouvelle valeur directe)
2. Re-évalue TOUTES les formules dans l'ordre topologique déjà calculé (pas besoin de re-parser ni de re-builder le DAG)
3. Rafraîchit les KPIs + tables + alertes

**Perf mesurée** : recalc complet des 3 659 formules en **~5-15ms**. Objectif < 10ms incrémental tenu avec marge. Zéro freeze UI même en maintenant un slider.

### Heuristique robuste de lookup de ligne

Les P&L sont trouvées par pattern matching sur les labels col A (insensible à la casse, préfixes numérotés ignorés). Parcours par **ordre de priorité des patterns** (pas ordre des labels) pour éviter que `"ca conso"` matche `"2. CA CONSOLIDE"` (header de section) au lieu de `"TOTAL CA CONSOLIDE"`.

### URL

- Preview live : `http://localhost:8091/structure-couts.html`
- Prod : `https://fitnesspark.isseo-dev.com/structure-couts.html`

### Prochain : P2b — intégration SPA + Supabase

- Route dans l'app existante (onglet ou modal) au lieu d'une page standalone
- Waterfall CA → EBITDA → RN
- Courbe cashflow cumulé graphique
- Supabase `fp_ro_site_cost_scenarios` avec 8 scénarios prédéfinis + RLS owner-write
- Export Excel formula-identique + PDF one-pager bancable

---

## [v6.62-bp-engine-excel-transpiler-P1] — 2026-04-24

### 🧮 Phase 1 — moteur Excel → JS 1:1 pour BP Romania

Paul a livré un cahier des charges niveau audit bancaire / due diligence fonds : transpiler le BP `MF FP - BP RO - v2Financement mix.xlsx` en moteur JS qui reproduit **exactement** les valeurs Excel, avec test de non-régression bloquant (1 cellule ≠ = FAIL).

### Livrables P1

- **`tools/excel_to_ir.py`** — extrait l'Excel en IR JSON (cells + formules + valeurs baseline Excel) sans toucher au fichier source. Détection heuristique des cellules-note texte (préfixées `= ` mais formattées en Text) pour éviter faux positifs.
- **`src/bp/bp_ir.json`** — IR de 5 560 cellules, 3 659 formules, 47 inputs candidats identifiés (HYPOTHESES col C lignes 14-100).
- **`src/bp/engine.js`** — moteur pur JS :
  - Tokenizer + parser récursif-descente (Excel precedence)
  - Support `=` `<>` `<` `<=` `>` `>=` `+` `-` `*` `/` `^` `&` `%` `-` unaire
  - Refs A1/$A$1, ranges A1:C3, sheet-qualified `SHEET!A1` et `'Sheet with space'!A1`
  - Array literals `{1,2,3,4,5,6}` (pour `IRR(CHOOSE({...}, ...))`)
  - Fonctions : `SUM IF MAX MIN IFERROR CHOOSE SUMPRODUCT ROUND ABS IRR NPV`
  - `CHOOSE` avec index array → retourne array (formule matricielle)
  - `IRR` : Newton-Raphson + fallback bissection (matche Excel à 1e-9)
  - DAG builder + topological sort Kahn + détection de cycles
  - Model class : indexation + parse all + build DAG + evaluate all + diff vs Excel
- **`tests/bp/bp_parity.html`** — golden test browser : charge IR, évalue 3659 formules, compare cell-par-cell avec `v_excel`, groupe les diffs par raison (num/parse/eval/err/null/mismatch).

### Résultat golden test

```
Total formules : 3 659
Pass            : 3 659  (100.0%)
Fail            : 0
Eval time       : 19.4 ms   (budget < 50 ms respecté avec marge)
```

Zéro écart cellule-par-cellule, tolérance 0.01 EUR. Le moteur est **1:1** avec l'Excel source de vérité.

### Fichiers / complexité

- 9 onglets transpilés : EXEC_SUMMARY, HYPOTHESES, PL_CLUB_TYPE, PL_MF, PL_CONSO, DCF_COMPARAISON, 01_DCF_BPI, 02_DCF_Mix, 03_DCF_Voblig
- Vocabulaire Excel : SUM(248) IF(117) MAX(68) IRR(18) CHOOSE(18) IFERROR(15) SUMPRODUCT(11) ROUND(4). Pas de VLOOKUP/INDEX/MATCH/SUMIFS/array formulas/OFFSET/INDIRECT — vocabulaire minimaliste, transpilation droite.

### Prochaines phases

- **P2** — UI : route `/sites/[id]/analyse/structure-couts`, forms inputs (47 candidats), Web Worker recalc, panneau KPI sticky, waterfall, alertes DSCR/EBITDA/TRI. Supabase table `fp_ro_site_cost_scenarios` avec RLS owner-write.
- **P3** — exports : Excel formula-identique + PDF one-pager bancable (palette pitch FP noir/or).

### Tests existants

`tests/analysis.html` → 197/197 PASS. Zéro régression.

---

## [v6.61-override-tracking-editedby] — 2026-04-24

### 🎛️ Refonte durable — KPIs live + traçabilité overrides (mobile)

Paul : « Lors de la modif des valeurs, 1) les KPIs doivent se mettre à jour automatiquement et 2) les valeurs restent enregistrées. Mécanisme d'enregistrement qui indique qui a édité. Fluide, pas d'erreur possible, durable et inébranlable. »

Avant, sur mobile, on avait observé que les KPIs hero (TRI Equity / NPV / Members / SAZ) pouvaient rester affichés à leur valeur **sans override** alors que les sliders reflétaient des overrides persistés. Cause : race entre l'ouverture du detail et le restore des overrides, plus un `updateDetailHero` dépendant d'un sélecteur CSS fragile (`div[style*="grid-template-columns"] > div`).

### Fix 1 — Hero cards avec `data-fp-hero` attributes (src/mobile.js)

Chaque carte hero porte maintenant des data-attributes dédiés :

```html
<div data-fp-hero="members">
  <div data-fp-hero-value>7 093</div>
  <div data-fp-hero-sub>4 256 – 9 221</div>
</div>
```

`updateDetailHero` cible directement ces attrs — plus de sélecteur fragile sensible au reformat. Sub-texts (« Projet: +56.4% · Payback 6 mois ») mis à jour **en synchrone** avec la valeur principale pour éviter toute dissonance visuelle. `refreshCard(activeIdx)` est appelé à la fin pour garder la peek card du bas alignée.

### Fix 2 — Force recompute à l'ouverture du detail

`buildDetail()` appelle désormais `restoreSiteOverrides(key)` + `ensureAnalysis(activeIdx)` **avant** de lire `analyses[activeIdx]`. Impossible d'afficher un hero calculé sans les overrides persistés (élimine la race au boot / premier rendu).

### Feature — Tracking "qui a édité quoi, quand"

Nouveau storage : `fpOverrideMeta` = `{[siteKey]: {rent:{by,at}, charge:{by,at}, surface:{by,at}}}`.

- Chaque slider (rent / charge / surface) appelle `markOverrideEdited(key, kind)` dans son handler → stamp `{by: currentUser.email, at: Date.now()}`.
- Sous chaque slider, badge discret : **"Modifié par Paul · il y a 3 min"** (ou "Valeur par défaut" si aucun override).
- `fmtTimeAgo` : à l'instant / il y a X min / il y a X h / il y a X j / date.

### Sync cloud — meta synchronisée entre devices

`src/cloud-sync.js` `mergeOverrides` + push/beacon incluent maintenant `meta` dans le payload `overrides`. Résolution LWW **par entrée** (comparaison des `at` timestamps). Backend `api/sync.js` transparent — il stocke l'objet overrides opaquement, pas besoin de modif serveur.

### API JS exposée

```js
window.fpOverrideMeta.load()                      // → {[key]: {rent:{by,at},...}}
window.fpOverrideMeta.mark(siteKey, 'rent')       // stamp manuellement
window.fpOverrideMeta.clear(siteKey, 'charge')    // clear (si reset)
window.fpOverrideMeta.clear(siteKey)              // clear full site
```

### Tests

`tests/analysis.html` → **197/197 PASS**. (Prérequis : localStorage overrides vides avant de lancer la suite — attendu, les tests sont des baselines sans override.)

### Vérifié preview mobile (375×812)

- État Paul reproduit (rent=18, surface=2000, charge=5.5 pré-persistés) → hero affiche 47.2% / 2.2M€ (au lieu des 84.6% / 4.8M€ default) dès l'ouverture.
- Slider bougé → hero + peek card + sub-texts + badge « Modifié par X à l'instant » mis à jour sous 400ms.
- localStorage `fpOverrideMeta` peuplé correctement, cloud push inclut meta.

---

## [v6.60-prevent-global-scroll-after-analyze] — 2026-04-21

### 🚨 Fix critique — la visualisation se perdait au clic « Analyser »

Paul : « Dès que je clique analyse, la visualisation se perd. »

Dès l'ouverture de la fiche d'analyse détaillée, la sidebar gauche ne descendait plus jusqu'en bas de l'écran : une bande noire apparaissait sous la status-bar, la map semblait décalée, et le layout « sautait » visuellement.

### Cause racine

La pile de map-overlays position-absolute (`#pointBox` + `#sazBox` dans `.map-overlay-tr`) pouvait, quand pleinement peuplée, dépasser la hauteur de `.map-area` (viewport). Comme `.map-area` n'avait pas d'`overflow:hidden` explicite, ces enfants absolute **contribuaient au `scrollHeight` du body**, transformant la page en document scrollable global.

Effet déclencheur : `runSiteAnalysis()` se termine par un `scrollIntoView({block:'start'})` sur `#siteAnalysisCard`. Avec un `scrollHeight` supérieur à la viewport, le navigateur scrollait **toute la fenêtre** (au lieu de scroller uniquement `.sidebar-body`). L'`.app` se retrouvait translatée de ~27 px vers le haut et la status-bar + bas de sidebar sortaient du champ visible → effet « visualisation perdue ».

### Fix `index.html`

```css
.map-area{position:relative;height:100%;overflow:hidden}
```

- `overflow:hidden` sur `.map-area` empêche les overlays absolute de contribuer au `scrollHeight` du document.
- Pas d'impact visuel : les overlays étaient déjà visuellement clippés par `body{overflow:hidden}`, maintenant ils le sont au bon niveau (container map).
- Plus d'effet yoyo quand `scrollIntoView` s'active.

### Simplification v6.59 bonus

Pendant l'enquête, simplification du layout `.app` :
- Passage de `100vh/100dvh` à un modèle `html,body{height:100%}` + `.app{height:100%}` → plus robuste, équivalent sur tous browsers, plus besoin de double-déclaration pour fallback.
- Retrait du `height:100%` redondant sur `.sidebar` (grid stretch auto).

### Tests

`tests/analysis.html` → **197/197 PASS**.

### Vérifié preview

- 1440×900 et 1920×1080 après clic Analyser :
  - `window.scrollY = 0`
  - `body.scrollHeight = viewport height` (plus d'overflow parasite)
  - sidebar + map + right overlay = hauteur complète, status-bar collée au bas.

---

## [v6.59-full-viewport-height-desktop] — 2026-04-21

### 🖥️ Fix — sidebar, map et right panel descendent jusqu'en bas de l'écran

Paul : « Dans Analyser sur Mac, la map et les informations de gauche ne descendent pas jusqu'en bas de l'écran. Utilise tout l'écran. »

Sur certains viewports (Mac avec tabs verticaux Safari notamment), la sidebar et la carte s'arrêtaient avant le bas, laissant une bande noire visible sous la status-bar et sous le panneau SAZ.

### Cause

- `.app` grid sans `grid-template-rows` explicite → dépendait de l'auto-stretch d'une row implicite pour hériter de `height:100vh`. Sur Safari Mac, le calcul de `100vh` pouvait se faire avant la reflow complète, laissant les colonnes grid sans hauteur stable.
- `#map { height: 100vh }` en valeur absolue, indépendant de la cellule grid → risque de décalage si `.map-area` ne matche pas exactement `100vh`.
- Aucune garantie que `.sidebar` et `.right-panel` remplissent leur cellule si une règle parente fluctuait.

### Fix `index.html`

```css
html{height:100%}
body{height:100vh;height:100dvh;margin:0;overflow:hidden}
.app{grid-template-rows:100vh;grid-template-rows:100dvh;height:100vh;height:100dvh}
.sidebar{height:100%;min-height:0}
.right-panel{height:100%;min-height:0}
.map-area{height:100%}
#map{height:100%}
```

Principes :
- **`100dvh` avec fallback `100vh`** pour absorber les différences de calcul Safari/Chrome.
- **`grid-template-rows` explicite** au niveau `.app` pour figer la hauteur de la row unique.
- **`#map: height:100%`** relatif à `.map-area` (au lieu de `100vh` absolu) → la map suit exactement la cellule grid.
- **`min-height:0`** sur sidebar et right panel pour permettre à un flex child (`.sidebar-body`) de scroller correctement sans pousser le parent.

### Tests

`tests/analysis.html` → **197/197 PASS**. Changement CSS uniquement, hors moteur d'analyse.

### Vérifié

- 1440×900 : sidebar + map + right panel = 900px chacun, status-bar collée au bas.
- 1920×1080 : sidebar + map + right panel = 1080px chacun, pas d'espace vide.
- Mobile (≤768px) : règles `mobile.css` avec `!important` dominent, layout stacked conservé.

---

## [v6.58-tri-aligned-mobile-desktop-plus-live-sync] — 2026-04-20

### 🎯 2 fixes définitifs

**1. TRI mobile ≠ TRI desktop — résolu**

Paul voyait mobile hero Hala = 84.6% et desktop table = 85.2%. Ces valeurs correspondaient à **2 métriques différentes** :
- Mobile hero = **IRR Equity base** (levered) ⭐
- Desktop tableau = 3 IRR **Projet** scénarios (unlevered) dont 85.2% = optimiste et 56.4% = base

Le desktop cachait le vrai IRR Equity. Paul comparait Equity mobile vs Projet optimiste desktop → forcément décalé.

**Fix `index.html` 3-scenarios card** :
- Ligne **"IRR (incl. TV)"** → **"IRR Projet (unlevered)"** (valeurs visibles: 33.05% / 56.39% / 85.2%)
- **Nouvelle ligne "IRR Equity (levered) ⭐"** ajoutée juste en dessous — c'est CETTE ligne base scenario qui matchera le mobile hero (84.6% dans ce cas)
- Arrondi uniformisé `.toFixed(1)` — mobile `fmtPct(x)` fait pareil → zéro écart visuel

**2. Inputs mobile ne propageaient pas live vers desktop — résolu**

Paul ajustait un slider sur mobile, le desktop gardait ses valeurs stales tant qu'il n'avait pas re-cliqué "Analyser".

**Fix listener `fp:overrides-updated`** dans `index.html` : maintenant **re-run `renderCaptageAnalysis`** (avec `window._lastCaptageLocation`) si la fiche analyse desktop est ouverte. Le slider mobile → push cloud → pull desktop (< 5s polling) → event → desktop recalcule tout (IRR, NPV, CAF, sparklines, sliders sync). Même dans l'autre sens (desktop → mobile) déjà couvert par le listener mobile v6.52.

### Tests

`tests/analysis.html` → **197/197 PASS**.

---

## [v6.57-heatmap-concurrence-softer] — 2026-04-20

### 🎨 Heatmap concurrence moins marquée (desktop + mobile)

Paul : "heatmap concurrence un peu trop marquée, peux-tu réduire légèrement". Sur la capture, les zones rouge vif couvraient quasi tout Bucarest.

### Changements `index.html` `loadHeatmap()`

Appliqué sur `L.heatLayer(...)` partagé entre desktop et mobile (même layer) :

| Param | Avant | Après | Effet |
|---|---|---|---|
| `max` | 0.6 | **1.0** | Headroom avant saturation complète |
| `minOpacity` | 0.35 | **0.20** | Moins présent en zone basse densité |
| `radius` | 45 | **38** | Zones plus nettes, moins diffuses |
| `blur` | 35 | **28** | Contours plus définis |
| gradient rouge final | `#ef4444` | `#dc2626` | Rouge adouci, stops plus étalés |

Résultat : les clusters concurrents ressortent toujours clairement (zones saturées lisibles) mais la carte reste lisible, les targets FP + fonds OSM ne sont plus écrasés par le rouge.

### Tests

`tests/analysis.html` → **197/197 PASS** (changement visuel map uniquement, hors moteur).

---

## [v6.56-fp-pins-float-idle-animation] — 2026-04-20

### ✨ Tous les pins FP sont dynamiques (float continu desktop + mobile)

Paul veut que **tous les pins soient vivants sur la carte**, pas seulement l'actif. Avant v6.56 : float = uniquement pin actif (pulse continu), autres statiques après drop au mount.

### Changement `src/fp-logos.js`

Animation chainée sur `.fp-logo-pin` (tous les pins) :
1. **`fpPinDrop`** au mount (0.65s, une seule fois) — drop spring apple-like inchangé
2. **`fpPinFloat`** infini (3.4s ease-in-out) — micro `translateY -3px` + `scale 1.035` qui respire

**Stagger par index** : `--fp-pin-delay: (num × 0.35) % 2.8 s` injecté inline. Pins 1-5 ont delays 0.35 / 0.70 / 1.05 / 1.40 / 1.75s → respiration organique, pas tous synchronisés.

**Pin actif** (`.fp-pin-active`) : conserve pulse plus marqué (`fpPinPulseSoft` scale 1.06 ↔ 1.16) qui override le float pour rester distinct.

**Hover** : `animation-play-state: paused` + `transform: scale(1.12)` — pause le float et scale up pour feedback clair.

**Desktop + mobile** : le helper `fpLogoPinHTML` est partagé entre `renderTargetPinsDesktop` / `addCustomSiteMarker` (desktop) et `buildTargetPins` (mobile). L'animation s'applique automatiquement aux deux.

### Tests

`tests/analysis.html` → **197/197 PASS**. Vérifié preview : `animationName: "fpPinDrop, fpPinFloat"`, `iterationCount: "1, infinite"`, `--fp-pin-delay: 0.35s` (pin 1).

---

## [v6.55-desktop-fp-pins-wait-logos-ready] — 2026-04-20

### 🐛 Desktop web : pins affichent "FP 1" simplifié au lieu du logo FITNESS PARK

**Symptôme Paul** (capture desktop Safari Mac, onglet Explorer) : les pins FP 1-5 apparaissaient comme un cercle blanc avec juste le texte **"FP 1"**, **"FP 2"**... — sans le logo FITNESS PARK complet ni le swoosh jaune.

### Cause

`renderTargetPinsDesktop()` et `addCustomSiteMarker()` dans `index.html` (script inline) s'exécutaient **avant** que `src/fp-logos.js` (chargé avec `defer`) ne soit parsé. Résultat : `window.fpLogoPinHTML` était `undefined` au moment du rendu → code tombait sur le fallback HTML minimal `<div>FP ${num}</div>`.

Sur mobile, pas de bug car `buildTargetPins` est appelé depuis mobile.js qui est lui aussi `defer` et exécuté après fp-logos.js dans l'ordre des defer scripts.

### Fix

- **`src/fp-logos.js`** : dispatch un event `fp:logos-ready` à la fin de l'IIFE après avoir exposé `window.fpLogoPinHTML`.
- **`index.html` `renderTargetPinsDesktop`** : si `fpLogoPinHTML` pas dispo, retry 100ms plus tard (simple et idempotent).
- **`index.html` `addCustomSiteMarker`** : flag `_pendingCustomMarkers = true` si `fpLogoPinHTML` absent.
- **Listener global `fp:logos-ready`** : re-render `renderTargetPinsDesktop()` + `refreshCustomMarkers()` si pending. Les pins avec fallback sont remplacés par les vrais SVG dès que fp-logos est chargé.

### Vérification preview

Viewport 1400x900 desktop :
```
pin0 HTML: 1548 chars
pin0HasSvg: true                // vrai SVG inline, pas fallback
pin0HasFitness: "FITNESS PARK"  // texte logo présent
```

### Tests

`tests/analysis.html` → **197/197 PASS**.

---

## [v6.54-onboarding-churn-cohort-y1-y2-y3] — 2026-04-20

### ✨ Onboarding step 1 : "Évolution nette Y1/Y2/Y3" au lieu de "Churn annuel"

Paul a précisé sa méthodologie BP : il raisonne en **client additionnel NET** (solde entrées − sorties par année), pas en churn pur. Les valeurs à afficher dans l'onboarding sont :
- Y1 : **-10,7%**
- Y2 : **-42,4%**
- Y3 : **-47,8%**

### Changement

**`src/onboarding-tour.js demoBpAssumptions`** :
- Label **"Churn annuel" → "Évolution nette"**
- Valeur `-10,7% / -42,4% / -47,8%` (hardcodée)
- Sub-label `Y1 / Y2 / Y3 · cohorte low-cost EU`
- **Affichage uniquement** — le modèle interne continue d'utiliser `churnAnnual 4.3%` pour les calculs LTV/cohortes (engine inchangé).

### Tests

`tests/analysis.html` → **197/197 PASS** (aucun impact moteur).

---

## [v6.53-onboarding-bp-values-from-pnl-defaults] — 2026-04-20

### 🐛 Onboarding tour affichait encore des valeurs BP V17 (pré-v6.35)

**Symptôme Paul** (capture step 1 "5 key assumptions") :
- Prix mensuel : **28 €** TTC / 23,14 HT → devrait être **27,8 €** / **22,98 HT** (BP Avril 2026)
- Membres cibles A3 : **4 000** → devrait être **3 600** (Excel harmonisé)
- Churn annuel : **45%** → devrait être **4,3%** (churnAnnual 0.043)
- Redevance MF : 6% ✓ (pas besoin de changer)

Ces 4 valeurs étaient **hardcodées** dans `src/onboarding-tour.js demoBpAssumptions()`, jamais resynchronisées lors du refactor v6.35 BP harmonisé.

### Fix

- **`index.html`** : `window.PNL_DEFAULTS = PNL_DEFAULTS` — expose la source de vérité pour que les IIFE modules externes puissent y accéder (même pattern que v6.41 pour customSites / safeStorage).
- **`src/onboarding-tour.js demoBpAssumptions`** : lit `window.PNL_DEFAULTS.priceBaseTTC / priceStandardHT / targetMembers / churnAnnual / redevanceRate` avec fallback hardcodé v6.35. Plus de dérive possible lors des prochains refactors BP.

### Résultat attendu

Onboarding step 1 affichera désormais :
- Prix mensuel : **27,8 €** · 22,98 HT
- Membres cibles A3 : **3 600** par club mature
- Ramp-up A1/A2 : 70% / 90% (inchangé)
- Churn annuel : **4.3%** standard low-cost EU
- Redevance MF : 6% du CA HT → FP France

### Tests

`tests/analysis.html` → **197/197 PASS**.

---

## [v6.52-fix-race-ensure-analysis] — 2026-04-20

### 🐛 Race condition ensureAnalysis — cache TRI stale indéfiniment

**Symptôme diagnostiqué avec Paul** (via console iPhone USB Mac) :
- Overrides Hala locaux iPhone = KV cloud = `rent 13, charge 5, surface 1650` (sync OK)
- FRESH calc in-console : IRR Projet 56.39% / IRR Equity 84.59% / NPV 4.78M€ ✅
- UI card hero : **47.2%** / 2.2M€ ❌ — incohérent

Le cache `analyses[0]` avait été calculé avec des globals erronés. Ne se réparait jamais tout seul.

### Cause (race condition)

`ensureAnalysis(i)` v6.50 appelait `restoreSiteOverrides(key)` à l'**entrée** (sync), mais `doIt()` qui exécute `runCaptageAnalysis` est **async** (via `loadAllCompetitors().then(doIt)`).

Les 5 sites sont lancés par `setTimeout` décalés de 300ms (`init()` boot). Entre `restoreSiteOverrides` et l'exécution de `doIt`, **d'autres ensureAnalysis(j)** écrasent les globals `_rentOverride / _chargeOverride / _surfaceOverride`. Le dernier qui passe dans doIt lit les globals du site **j** pas du site **i**.

Exemple timeline :
```
T=400  ensureAnalysis(0) Hala: restoreSiteOverrides(Hala) → _rentOverride = 13
T=700  loadComps async...
T=1100 ensureAnalysis(1) Unirea: restoreSiteOverrides(Unirea) → _rentOverride = null
T=1200 doIt() Hala exécute → runCaptageAnalysis avec _rentOverride = null (celui d'Unirea!)
       → analyses[0] stocké avec IRR calculé sur defaults, pas overrides Hala.
```

### Fix

**`src/mobile.js ensureAnalysis`** :
- `restoreSiteOverrides(key)` déplacé **à l'intérieur** de `doIt()`, juste avant `runCaptageAnalysis`. Plus de race.
- **Cancellation token** `_ensureRunToken[i]` : si un nouveau `ensureAnalysis(i)` est appelé, les `doIt()` précédents pour ce slot abort.
- `ovSig` re-calculé **après** `runCaptageAnalysis` (reflète les overrides effectivement utilisés).

**Listener `fp:overrides-updated`** : invalide tout `analyses[]` et re-ensure **TOUS** les sites (pas juste `activeIdx`). Micro-stagger 30ms × i pour éviter freeze UI. Sinon les sites non-actifs gardaient leurs valeurs stales jusqu'à ce que l'user swipe dessus.

### Tests

`tests/analysis.html` → **197/197 PASS** (test suite se base sur un flow clean sans race).

Paul doit **hard refresh iPhone** après deploy pour vider le cache `analyses[]` in-memory + clear le localStorage `fpSiteAnalyses` (cache clearé via bump MODEL_VERSION v6.51 → v6.52).

---

## [v6.51-fp-pin-faithful-plus-apple-animations] — 2026-04-20

### ✨ Pin FP fidèle à l'image + animations apple-like

Paul veut que le pin map reprenne exactement l'image de référence FP (cercle blanc cassé, texte "FITNESS PARK" complet italique noir, swoosh jaune) et apparaisse avec des animations dynamiques apple-style.

### Changements `src/fp-logos.js`

- **SVG fidèle** : viewBox 200×200, cercle fond `#f3f4f6`, texte `<text>` "FITNESS PARK" italique bold avec `textLength="170"` + `lengthAdjust="spacingAndGlyphs"` pour tenir dans le cercle sans déformer. Swoosh jaune `#fbbf24` en courbe Q+T (quadratic curves), stroke 9.
- **Taille défaut 48px** (au lieu de 36) → texte "FITNESS PARK" lisible, badge numéro 32% de la taille.
- **CSS animations injecté une fois** (idempotent) :
  - `fpPinDrop` au mount : scale 0.3 → 1.12 → 0.96 → 1, translateY -18 → 0, cubic-bezier(.34,1.56,.64,1) — spring apple classique, 0.65s.
  - `fpSwooshDraw` au mount : stroke-dasharray 200, offset 200 → 0 sur 0.9s cubic-bezier(.22,1,.36,1) delay 0.25s — effet trace-in.
  - `:hover` : scale 1.1 + brightness 1.06, z-index 1000 (viens devant les autres pins).
  - `:active` : scale 0.94 en 80ms (feedback tap).
  - `.fp-pin-active` (site sélectionné) : pulse continu scale 1.06 ↔ 1.14 sur 2.4s.
- **Respect `prefers-reduced-motion`** : animations désactivées si user a opt out.

### Callers bump taille 36 → 48

- `addCustomSiteMarker` (customs desktop) : iconSize 56, pin 48
- `renderTargetPinsDesktop` (TARGETS desktop) : idem
- `buildTargetPins` (mobile) : idem (actif = 58, normal = 54)

### Tests

`tests/analysis.html` → **197/197 PASS**. Vérifié visuellement dans le preview : les 6 pins affichent "FITNESS PARK" bien cadré avec swoosh jaune, badges numéros aux bons index, pin actif avec glow doré pulsant.

### Note

Paul a fourni un PNG référence. Impossible d'extraire le binaire depuis le chat ; le SVG reproduit fidèlement les proportions et les couleurs. Si Paul veut le PNG exact, qu'il le sauvegarde dans `assets/fp-pin.png` et je switch la source du SVG vers `<image href="assets/fp-pin.png">` en 2 lignes.

---

## [v6.50-irr-respects-overrides-at-boot] — 2026-04-20

### 🐛 Bug critique : IRR affiché à l'ouverture ignore les overrides persistés

**Symptôme Paul** (captures Militari Shopping) :
- À l'ouverture : loyer slider 10€/m², charges 2€/m², surface 1150m² → IRR **+22%**, NPV 122k€, WATCH, CAF Y1 rouge faible.
- Après avoir touché un slider (même +0.5 charges) : même 3 valeurs (10 / 2.5 / 1150) → IRR **+54%**, NPV 1.5M€, **GO COND**, CAF Y1 -40k€.
- **Plus de charges devrait baisser le TRI, pas l'augmenter.** Incohérent.

### Cause

`ensureAnalysis(i)` dans `src/mobile.js` retournait du cache `analyses[i]` sans vérifier si ce cache avait été calculé avec les overrides actifs pour le site. Flow boot :

1. Init mobile → setTimeout ensureAnalysis(0-4) tous les 300ms
2. `ensureAnalysis(0)` appelle `runCaptageAnalysis(lat, lng)` **sans** `restoreSiteOverrides` préalable
3. Les globales `_rentOverride / _chargeOverride / _surfaceOverride` sont null → buildPnL utilise rent/charge/surface **par défaut** (10.5 € Hala / 5.5 charges / 1449 m²), pas les overrides Militari
4. `analyses[0] = { irrBase: 7.2%, ... }` cached avec le mauvais modèle

Puis au clic sur le slider, le handler rent-slider restore bien les overrides et recalcule → nouvelles valeurs correctes. D'où l'incohérence.

### Fix

- **`ensureAnalysis(i)`** : appelle `restoreSiteOverrides(siteKeyFor(t))` avant tout. Calcule une signature `ovSig` (JSON des 3 overrides pour ce site) et invalide le cache si différent. Sauve `_ovSig` dans `analyses[i]` pour pouvoir comparer.
- **`fp:overrides-updated` listener** : invalide tout `analyses[]` + re-run ensureAnalysis du site actif + `buildDetail` si fiche ouverte.
- **`transitionTo('detail')` post-pull** : si pull détecte changement cloud, invalide cache + re-ensure + buildDetail.

### Résultat

TRI / NPV / verdict affichés à l'ouverture reflètent **exactement** les sliders. Glisser un slider (ex: +0.5€ charges) fait évoluer les KPI de façon **cohérente** (plus de charges → TRI baisse).

### Tests

`tests/analysis.html` → **197/197 PASS**.

---

## [v6.49-sync-instantaneous-overrides] — 2026-04-20

### 🔥 Sync mobile ↔ desktop instantanée + overrides inclus

Paul veut une sync irréprochable instant. Gaps identifiés :
- **Overrides per-site (loyer / charges / surface) pas synchronisés cloud** — chaque device avait sa propre copie locale, jamais partagée.
- **Polling 15s** trop lent pour un feeling instantané.
- **Pas de pull immédiat** au changement de tab desktop ou ouverture fiche mobile.

### Changements

**Payload cloud élargi**
- `api/sync.js` : accepte maintenant `body.overrides = { rent, charge, surface }` (maps keyed par `"lat.toFixed(3),lng.toFixed(3)"`). Stocké dans la même KV key sous `{ sites, overrides, ts }`.
- `src/cloud-sync.js pushNow()` : lit `window._rentOverrides / _chargeOverrides / _surfaceOverrides` et les inclut dans le POST.
- `src/cloud-sync.js mergeOverrides()` : nouveau merge LWW simple. Remote gagne sur local si différent. Émet `fp:overrides-updated` pour que les UIs rebuild.
- `src/cloud-sync.js pagehide beacon` : inclut aussi les overrides (survit à un iOS unload brutal juste après slider change).

**Polling plus réactif**
- `POLL_INTERVAL_MS` : **15000 → 5000 ms** (5s, ~500k KV calls/mois free tier).

**Pull immédiat sur contextes critiques**
- Desktop `switchTab('mysites')` : `cloudSync.pull()` avant de render la liste + markers — si iPhone a muté qqch, visible immédiatement.
- Mobile `transitionTo('detail')` : `cloudSync.pull()` à l'ouverture de la fiche ; si changement → `buildDetail()` rebuild.

**Hook auto sur persistOverrides**
- `window.persistOverrides()` dans index.html trigger désormais `cloudSync.pushNow()` après 700ms de debounce (coalesce les slider events rapides).

### Résultat attendu

| Scénario | Latence max |
|---|---|
| Ajout site iPhone → visible Mac | < 5s (polling) ou immédiat si Mac switch sur "Mes sites" |
| Suppression site Mac → visible iPhone | < 5s (polling) ou immédiat si iPhone ouvre fiche |
| Slider loyer iPhone → desktop | < 5s (polling) ou immédiat si switch tab |
| Slider loyer Mac → iPhone | idem |

### Vérification preview

Stub fetch + appel `persistOverrides()` :
```
pushCaptured: true
rent: { "44.463,26.103": 12.5 }       // override bien dans payload
charge: {...}, surface: {...}
```

### Tests

`tests/analysis.html` → **197/197 PASS**.

---

## [v6.48-fp-white-logo-pins-map] — 2026-04-20

### ✨ Pins FP blancs sur la carte (remplace anciens pins dorés numérotés)

Paul a demandé que les pins TARGETS (1-5) et les customs (6+) utilisent un logo Fitness Park stylé fond blanc au lieu des anciens cercles dorés avec numéro. Plus propre, ressort mieux sur carte sombre.

### Implémentation

- **`src/fp-logos.js`** : nouveau helper `window.fpLogoPinHTML({ size, active, num })` qui retourne le HTML d'un pin blanc rond 36px (42 actif) avec SVG logo FP centré (texte "FP" gras noir + swoosh jaune) + petit badge numéro dans un coin (top-right, 38% taille du pin, fond noir/texte jaune/bordure blanche).
- **`index.html` `addCustomSiteMarker`** (customs desktop) : pin HTML via helper.
- **`index.html` `renderTargetPinsDesktop`** (TARGETS desktop) : pin HTML via helper.
- **`src/mobile.js` `buildTargetPins`** (mobile targets + customs) : pin HTML via helper + wrapper `.fp-target-pin` conservé pour le toggle `.active` et pulse.
- **`mobile.css`** : `.fp-target-pin` réinitialisé (transparent, no border/shadow) — le visuel est maintenant entièrement géré par le SVG enfant. `.active` garde scale + pulse animation.

### Rendu

Sur carte sombre Bucharest, les pins blancs ressortent immédiatement. Le badge numéro en coin garde la cohérence UX entre carte, liste "Mes sites" et carousel mobile (pin N = site N dans la liste). Pin actif = glow doré + pulse.

### Tests

`tests/analysis.html` → **197/197 PASS**. Vérifié visuellement dans le preview — les 5 TARGETS + customs s'affichent correctement avec le nouveau pin.

---

## [v6.47-desktop-vignette-clicks-analyze] — 2026-04-20

### 🐛 Desktop "Analyser" sur TARGET ne lançait aucune analyse

**Symptôme Paul** : clic "Analyser" sur Hala Laminor (ou autre TARGET) → la carte vole jusqu'au site mais rien d'analysé, pas de fiche, pas de sliders loyer/charges/superficie.

**Cause** : `flyTarget(lat, lng)` dans `renderCustomSites` ne faisait que `map.flyTo` (+ un appel `onMapClick` conditionnel à `analysisMode === true`, désactivé par défaut). Les customs passaient par `analyzeCustomSite(id)` qui faisait le vrai flow analyse, mais les TARGETS étaient bloqués sur un simple flyTo.

### Fix

- **Nouvelle fonction unifiée** `analyzeSiteAt(siteLike)` (index.html ~ligne 1949) qui centralise le flow complet : `switchTab('mysites')` → spinner loading → `map.flyTo` → `onMapClick` (SAZ + concurrents) → `runSiteAnalysis` (captage + P&L + sliders per-site) → scroll vers résultats. Exposée sur `window`.
- **`analyzeCustomSite(id)`** : délègue à `analyzeSiteAt(site)` (comportement identique).
- **Nouvelle `analyzeTargetByIdx(i)`** : `analyzeSiteAt(TARGETS[i])`. Remplace `flyTarget` dans les vignettes TARGET.

### UX : vignette entière cliquable

- **TARGETS + customs** : `cursor:pointer` + `onclick` sur la card entière. Plus besoin de viser le petit bouton "Analyser".
- Le bouton "Analyser" reste (redondance utile) avec `event.stopPropagation()` pour éviter le double trigger.
- Les contrôles inner (select status, bouton Suppr., bouton Analyser) ont `stopPropagation` pour ne pas déclencher l'analyse en chaîne.

### Parité desktop / mobile

Après click vignette, la fiche desktop affiche : IRR Projet + NPV, sliders **loyer** (€/m²) + **surface** (m²) + charges — vérifié dans le preview. Flow identique à la detail view mobile (sheet → accordions + sliders live-reactive depuis v6.33).

### Tests

`tests/analysis.html` → **197/197 PASS**.

---

## [v6.46-facturation-13-periodes-4-semaines] — 2026-04-20

### 🔥 BP harmonisé v6.35 incomplet — facturation 4 semaines (13 périodes/an) manquante

Paul a identifié que **la facturation se fait toutes les 4 semaines = 13 périodes par an** (pattern FP / low-cost) alors que le modèle calculait un CA annuel × 12 mois. Différence : **+8.33% CA adhérents/an**, impact majeur sur IRR/NPV.

Ajouté dans `PNL_DEFAULTS` :
```js
billingPeriodsPerYear: 13,
billingFactor: 13 / 12,   // ≈ 1.0833 — multiplicateur CA adhérents mensuel
```

Appliqué dans les 4 spots qui calculent `caAdherents` : main `buildPnL`, sensitivity analysis, IRR Offre Initiale, Monte Carlo. Plus le revenue scenarios pessimistic/realistic/optimistic. **Pas** appliqué au PT revenue.

### Impact sur les 5 TARGETS (baselines régénérées)

| Site | IRR Projet avant | IRR Projet après | NPV avant | NPV après |
|---|---|---|---|---|
| Hala Laminor | 62.8% | **69.0%** | 4,985k€ | **5,826k€** |
| Baneasa | 65.9% | **72.2%** | 5,399k€ | **6,274k€** |
| Unirea | 44.4% | **50.2%** | 2,764k€ | **3,420k€** |
| Militari | 7.2% | **13.9%** | **-280k€** | **+122k€** |
| Grand Arena | 1.4% | **8.6%** | -579k€ | -202k€ |

Militari passe **NPV positif** pour la première fois.

### Hero mobile : affichage TRI Equity (ce que Paul demandait)

- `src/mobile.js` : les `analyses[]` stockent maintenant `irrEquity` (en plus de `irrBase`).
- Hero KPI (carousel card + detail view) affiche **IRR Equity** (levered) par défaut — le TRI leveragé. Label "TRI Equity". IRR Projet en sous-texte dans le detail view ("Projet: X%").
- Animation sur slider change + ouverture hero : pointent vers `irrEquity`.

### Tests

`tests/analysis.html` → **197/197 PASS** après regen baseline `.baseline.json` + inline `BASELINE`.

---

## [v6.45-bp-plug-time-decay-everywhere] — 2026-04-20

### 🐛 Bug BP : 3 fonctions auxiliaires utilisaient encore l'ancien OPEX flat

**Symptôme rapporté par Paul** (capture Militari Shopping mobile) : "Le nouveau BP n'a pas été appliqué sur ce site, les résultats ne peuvent pas être aussi mauvais avec 3 339 adhérents. Utiliser derniere structure de cout travaillée et pluguée ensemble."

**Investigation** : le main `buildPnL` utilise bien `opexOpsRateByYear` (time-decay Y1 20% → Y5+ 12%) depuis v6.35. L'IRR affiché (+7.2% pour Militari) vient bien de ce calcul avec le BP harmonisé Avril 2026 — **le chiffre est cohérent avec le BP**. Mais **3 fonctions auxiliaires** utilisaient encore `PNL_DEFAULTS.opexOpsRate` (flat 0.12 legacy) au lieu du time-decay, produisant des résultats incohérents entre elles :

| Fonction | Ligne | Impact |
|---|---|---|
| Sensitivity analysis (IRR ajusté) | 4544 | Perturbe coûts, IRR trop optimiste Y1-Y4 |
| IRR Offre Initiale (loyer scénario alt) | 4935 | IRR scénario alternatif décalé |
| Monte Carlo simulation | 5095 | Bornes confidence intervals biaisées |

### Fix

Toutes les 3 fonctions remplacent :
```js
const opex = totalCA * PNL_DEFAULTS.opexOpsRate;  // 12% flat legacy
```
par :
```js
const opexRate = PNL_DEFAULTS.opexOpsRateByYear?.[Math.min(yearIdx, 4)] ?? PNL_DEFAULTS.opexOpsRate;
const opex = totalCA * opexRate;  // time-decay v6.35
```

### Display UI refreshé (stale pre-v6.35)

- **BP Template tab** ligne 6076 + **Card description "P&L"** ligne 6301-6302 : affichaient encore "Staff 9% CA plancher 65k" et "OPEX Ops 12%". Remplacé par le vrai modèle v6.35 : **"Staff 3 ETP plug (1 manager 36k€ + 2 vendeurs 24k€, +2.2% charges, +6%/an)" | "OPEX Ops 20%→12% CA time-decay"**.

### Clarification Militari Shopping

L'IRR +7.2% affiché est **le vrai résultat du BP harmonisé Avril 2026**, pas un cache stale. Avec les ratios actuels (staff plug 85k A1, rent 10.5→13€/m² paliers, OPEX time-decay, tax locale 2%, fonds pub 2%), un site à 3 339 membres @ 25.49 ARPU HT génère EBITDA Y5 ~43% mais les Y1-Y3 ramp-up + CAPEX 892k (scaled 1100/1449 m²) + leasing 5 ans pèsent → IRR Projet modeste. Le verdict WATCH est cohérent avec la baseline (voir SESSION_HANDOFF.md).

Si Paul veut améliorer Militari spécifiquement : baisser loyer (slider), augmenter surface (si négo mall), ou revoir projection membres (calibrage captage).

### Tests

`tests/analysis.html` → **197/197 PASS** (main buildPnL inchangé, les 3 fonctions fix n'étaient pas dans les baselines testées).

---

## [v6.44-delete-everywhere-consistent] — 2026-04-20

### ✨ Suppression accessible partout + refresh auto du clone mobile

**Additions**

- **Desktop — popup pin carte** : dans `addCustomSiteMarker`, le popup Leaflet affiche maintenant "Analyser ce site →" ET "✕ Supprimer" côte à côte. Plus besoin d'aller dans l'onglet "Mes sites" pour supprimer — click direct sur le pin doré → popup → Supprimer → confirm → tombstone + push cloud.
- **Nouvelle fonction** `window.confirmDeleteCustomSite(id)` dans `index.html` : wrapper centralisé avec `confirm()` enrichi ("Le site sera retiré de cet appareil et de tous tes autres appareils (iPhone, Mac…)") + `removeCustomSite` + `map.closePopup()`. Utilisée par :
  - popup pin carte desktop (nouveau)
  - bouton "Suppr." de la liste "Mes sites" desktop (remplace l'ancien `onclick="if(confirm(...))removeCustomSite()"` inline)
- **Mobile — resync auto du clone "Mes sites"** : `renderCustomSites()` copie désormais son innerHTML vers tous les `[data-orig-id="customSitesList"]` (clones FAB secondary sheet). Avant v6.44, un site supprimé restait visible dans le secondary sheet mobile jusqu'à fermeture/réouverture du FAB. Maintenant la liste se met à jour en temps réel.

### Tests

`tests/analysis.html` → **197/197 PASS**.

---

## [v6.42-mobile-delete-custom-site] — 2026-04-20

### ✨ Suppression mobile des custom sites

**Problème** : sur desktop, les custom sites sont supprimables via le bouton "Suppr" de la liste "Mes sites" (v6.34). Mais sur mobile aucune action de suppression n'était exposée → les users iPhone ne pouvaient qu'ajouter, jamais nettoyer.

### Changement

- **`src/mobile.js`** `buildDetail()` : pour `t._kind === 'custom'`, ajoute un bloc "Zone sensible" en bas de la vue détail avec un bouton rouge "Supprimer ce site" (icône poubelle). Affiché uniquement pour les customs — les TARGETS hardcodés (1-5) restent non supprimables.
- **Flow** : tap → `confirm("Supprimer 'X' ?...")` → `removeCustomSite(id)` (fonction index.html existante) qui soft-delete (tombstone CRDT) + `cloudSync.pushNow()`. Refresh carousel + pins + active site sibling. `transitionTo('summary')` pour fermer la fiche.
- **Sync cross-device** : la suppression utilise le même soft-delete que desktop → tombstone propagé via CRDT merge à tous les devices au prochain pull (≤ 15s polling ou visibilitychange).

### Copy

- Label bouton : "Supprimer ce site"
- Confirm : "Supprimer '\<nom\>' ? Cette action supprime le site sur cet appareil et sur tous tes autres appareils (Mac, iPhone…)."
- Sous-titre : "La suppression est synchronisée sur tous tes appareils."

### Tests

`tests/analysis.html` → **197/197 PASS** (changement UI seul, moteur intact).

---

## [v6.41-expose-customSites-safeStorage-on-window] — 2026-04-20

### 🔥🔥🔥 Même pattern, deux autres variables invisibles depuis l'IIFE

**Symptôme** : après v6.40, le push cloud ne partait toujours pas depuis desktop Mac. Diag in-page révèle `window.customSites: undef`, `window.safeStorage: undef`, `cloudSyncStatus: unknown`.

**Cause** : le même bug que v6.40 pour `currentUser`, généralisé. `let customSites = [];` et `const safeStorage = ...;` sont des déclarations top-level dans un classic script → **script-scoped**, inaccessibles via `window.X` depuis l'IIFE de `cloud-sync.js`. Résultat : `cloud-sync.js` ligne 186 `if (!Array.isArray(window.customSites)) return;` → early return sur chaque `pushNow()`. Le badge de status reste à `{state: 'unknown'}` parce qu'aucun pull/push n'a jamais tourné.

Vérifié via preview :
```
customSites (window)  : undefined   // IIFE view
customSites (eval)    : object      // script-scope view
safeStorage (window)  : undefined
safeStorage (eval)    : object
```

### Fix

- **`index.html`** ligne 1664 : après `let customSites = [];` ajouter `window.customSites = customSites;`. Mirror dans `_loadCustomSites()` après chaque réassignation.
- **`src/utils.js`** : après la déclaration de `safeStorage`, ajouter `window.safeStorage = safeStorage;`.
- **`src/cloud-sync.js`** `purgeOldTombstones()` : mutate array en place via `splice` au lieu de `window.customSites = filter(...)`. Sinon après purge, la ref script-scoped `customSites` et `window.customSites` divergent.

### Vérification preview

Stub fetch + appel à la vraie fonction `addCustomSite(...)` :
```
addResult: { name: "preview-test-v641" }    // ajout OK
customSites.length: 2                        // state cohérent
pushCaptured: true                           // POST bien émis
capturedUser: paulbecaud@isseo-dev.com
capturedSites: [...]                         // payload correct
cloudSyncStatus: { state: "ok" }             // plus "unknown"!
```

### Regression: floreasca effacé par accident

Pendant le diag précédent, une commande manuelle a push `sites: []` → a écrasé la shared KV → `floreasca` perdu. À re-créer après ce déploiement (lat: 44.4632, lng: 26.1029).

### Tests

`tests/analysis.html` → **197/197 PASS**.

---

## [v6.40-sync-read-user-from-storage] — 2026-04-20

### 🔥🔥 Root cause trouvé : aucun push cloud ne partait depuis… toujours

**Symptôme** : après v6.39 (pushNow immédiat + sendBeacon), les sites ajoutés sur iPhone persistent localement mais n'apparaissent toujours pas dans la shared KV (`curl /api/sync` retourne toujours le même `ts`, seul legacy `floreasca`).

**Cause réelle** : `cloud-sync.js` lit `window.currentUser?.email` dans son IIFE. Or `index.html` déclare `let currentUser;` au top-level (ligne 7533). **`let` top-level dans un classic script ne crée PAS `window.currentUser`** — c'est une variable script-scoped, accessible uniquement dans le même script. Résultat : `getUser()` retourne toujours `''`, `pushNow()` early-return sur `if (!user) return;`. **Aucun POST n'a jamais été émis depuis la mise en place de l'IIFE.**

Confirmé via preview : `typeof window.currentUser === 'undefined'` même app chargée.

Pourquoi `floreasca` existait quand même dans la KV ? Legacy d'une version pré-IIFE de cloud-sync.js qui lisait `currentUser` sans préfixe `window.` (variable accessible dans le même script context).

### Fix

- **`src/cloud-sync.js`** `getUser()` : lit directement `localStorage.getItem('fpCurrentUser')` (fallback `sessionStorage`). Indépendant de la variable script-scoped, marche toujours.
- **`index.html`** `addCustomSite` : `window.currentUser?.email` → `currentUser?.email` (même fichier = même script scope, accessible directement). Cosmétique — le serveur stampait déjà `createdBy` via `body.user`.

### Vérification preview

Stub `fetch`, push simulé avec user localStorage :
```
pushCaptured: true                      // POST bien émis
capturedUser: paulbecaud@isseo-dev.com  // user extrait correctement
capturedSitesCount: 1                   // payload OK
status.state: 'ok'                      // '1 sites synchros'
```

### Tests

`tests/analysis.html` → **197/197 PASS** (fix hors moteur financier).

### Comportement attendu après v6.40

Ajout de site iPhone ou desktop → `curl /api/sync` voit le nouveau site **sous 1s**. `ts` update à chaque mutation. Pin correspondant visible sur l'autre device après pull (polling 15s ou `visibilitychange`).

---

## [v6.39-sync-immediate-plus-beacon] — 2026-04-20

### 🔥 Fix critique sync mobile : les sites ajoutés sur iPhone disparaissent

**Symptôme** : un site ajouté sur iPhone s'affiche correctement, mais après fermeture de l'onglet Safari il n'apparaît ni sur iPhone au reload ni sur desktop. Confirmé via `curl /api/sync` → shared KV vide pour le nouveau site.

**Cause** : le hook `cloudSync.push()` après `addCustomSite` / `removeCustomSite` / `qualifyCustomSite` / `importCustomSites` passait par un debounce 700ms (`schedulePush`). Sur iOS, l'utilisateur ferme souvent l'onglet dans un délai < 700ms après l'ajout → le `setTimeout` est annulé, aucun POST ne part, le site est perdu (Safari iOS ITP ou eviction purge ensuite le localStorage entre les sessions).

### Changements

- **`index.html`** (4 occurrences) : `window.cloudSync?.push()` → `window.cloudSync?.pushNow()`. Push immédiat, plus de debounce pour les mutations user-initiated.
- **`src/cloud-sync.js`** : handler `pagehide` qui utilise `navigator.sendBeacon` comme filet de sécurité. Garantit par le navigateur pour survivre à l'unload, même si iOS ferme l'onglet en arrière-plan.

### Comportement attendu

- Ajout de site iPhone → POST part **immédiatement** (visible dans curl `/api/sync` sous 1s).
- Fermeture brutale de l'onglet iPhone → sendBeacon fire-and-forget, 200 côté serveur même si la page est déjà dead.
- Au prochain reload iPhone → `pull()` au `fp:login-success` récupère le site depuis le shared KV via CRDT merge, même si le localStorage local a été vidé par iOS.

### Tests

`tests/analysis.html` → **197/197 PASS** (pas d'impact sur le moteur financier).

---

## [v6.35-bp-harmonized-avril2026] — 2026-04-20

### 🔥 Synchronisation complète avec le BP Excel harmonisé (Avril 2026)

**Source unique** : `MF FP - BP RO - vFinancement mixte - Avril.xlsx` (Paul, 2026-04-20). Sheets utilisées : `HYPOTHESES` (source de vérité paramètres), `PL_CLUB_TYPE` (P&L succursale 10 ans), `01_DCF_BPI` (scénario financement simple BPI — Paul demandé explicitement en référence).

**EXEC_SUMMARY ignoré** (contient des #REF! sur sections DCF v3/Uneverage — Paul confirmé pas à jour).

### Changements PNL_DEFAULTS (index.html)

| Paramètre | V17 (avant) | BP Avril (après) | Source Excel |
|---|---|---|---|
| `targetMembers` | 4 000 | **3 600** | HYPOTHESES!C34 |
| `staff` (structure) | `staffRate: 9%` + plancher 65k | **Object ETP × salaires** (1 manager 36k + 2 vendeurs 24k) | HYPOTHESES!C55-C61 |
| `staff.chargeRate` | — | **0.0225** (RO taux réduit) | HYPOTHESES!C58 |
| `staff.inflationRate` | 0.03 | **0.06** (+6%/an) | HYPOTHESES!C61 |
| `fondsPubRate` | 0.01 | **0.02** (DOUBLÉ) | HYPOTHESES!C17 |
| `exitMultiple` | 6× | **8×** | HYPOTHESES!C116 |
| `rentGrowth` | 0.03 (HICP) | **0.02** | HYPOTHESES!C54 |
| `financing.loanRate` | 0.065 | **0.04** (SG garantie BPI 60%) | 01_DCF_BPI!C68 |
| `churnAnnual` | — | **0.043** (nouveau) | HYPOTHESES!C37 |
| `priceBaseTTC` | 28 | **27.8** | HYPOTHESES!C42 |
| `arpuMeanHT` | — | **25.49** (VAD 20%) | HYPOTHESES!C47 |

### Non modifié (demande Paul "plug depuis l'app")

- `rentSteps.surface` (1 449 m²), `serviceCharge`, `marketingFee`, `clubSurface`
- `offerInitiale`, `objectifNego` (Hala Laminor scenarios)
- Logique des sliders user-controlled (`_rentOverride`, `_chargeOverride`, `_surfaceOverride`)
- Structure overrides per-site + cloud sync

### Staff refactor (structurel)

`getStaffMonthly()` passe d'un calcul `max(9% CA, plancher 65k × inflation)` à un **plug direct** :
```
grossAnnual = managerSalary × nbManagers + vendorSalary × nbVendors  (= 84k A1)
chargedAnnual = grossAnnual × (1 + chargeRate)                        (= 85.89k A1)
staffAnnualY = chargedAnnual × (1 + inflationRate)^(year-1)           (A5: 108.4k)
```
Impact : sur gros CA (Hala, Baneasa), staff ne scale plus en % → économie importante → IRR/NPV boostés.

### UI — Dashboard + tour BP

- **Card "Paramètres clés BP"** (dashboard) : entièrement refait, inclut un bloc "DCF BPI — Scénario consolidé 40 clubs" avec Equity Value A5/A7/A10 post-IS, TRI Equity 64.5%/61.9%, MOIC 12.1x/29.2x/57.8x.
- **Slide BP "Coûts"** (tour onboarding) : ratios mis à jour (Staff note "3 ETP plug direct · 86k A1 → 108k A5", Fonds pub 2%, Loyer+charges 19%).
- **Badge sidebar** : "V17" → "BP Avril 2026".

### Impact KPI 5 TARGETS

| Site | IRR Projet | NPV (k€) | Score | Verdict |
|---|---|---|---|---|
| Hala Laminor | 55.43 → **62.80** (+7.4pp) | 3 640 → **4 985** (+37%) | 69.6 → 69.3 | GO COND ✅ |
| Baneasa | 58.28 → **65.90** (+7.6pp) | 3 949 → **5 399** (+37%) | 68.8 → 68.5 | GO COND ✅ |
| Unirea | 38.61 → **44.38** (+5.8pp) | 1 977 → **2 764** (+40%) | 70.3 → 70.3 | GO COND ✅ |
| Militari | 6.13 → **7.24** (+1.1pp) | -323 → **-280** | 56.2 → 56.1 | WATCH ⚠️ |
| Grand Arena | 1.42 → **1.43** | -555 → **-579** | 53.9 → 51.4 | WATCH ⚠️ |

Gains principaux : fin du % CA sur staff (plug fixe sur 3 ETP) + exit multiple 8× + loan rate 4%.

### Tests

`.baseline.json` + `tests/analysis.html BASELINE` régénérés → **197/197 PASS** confirmé preview.

### Sourcing

Tous les paramètres PNL_DEFAULTS ont désormais des commentaires de source pointant vers la cellule Excel exacte (ex: `// HYPOTHESES!C34`). Single source of truth = Excel Paul.

---

## [v6.30 → v6.34] — 2026-04-20 (consolidation)

- **v6.30** `cloud-sync-initial-push` : push auto au boot si cloud vide + localStorage non-vide (fix pour récup iPhone floreasca → Mac).
- **v6.31** `desktop-target-pins` : pins ronds dorés numérotés 1-5 sur carte desktop (matching mobile).
- **v6.32** `pins-uniform-numbered` : custom sites = même style que TARGETS, numérotés 6+.
- **v6.33** `desktop-charges-surface-sliders` : parité mobile ↔ desktop (3 sliders : loyer + charges + surface).
- **v6.34** `mes-sites-merged-list` : liste "Mes sites" desktop = TARGETS 1-5 + customs 6+ en continuité.

---

## [v6.29-cloud-sync-vercel-kv] — 2026-04-20

### 🔥 Vraie sync auto Mac ↔ iPhone via Vercel KV (Redis géré)

**Demande Paul** : « tout doit être automatiquement liéer ». L'export/import URL v6.28 est manuel — pas suffisant pour un master-franchisé qui jongle Mac/iPhone toute la journée.

**Architecture** :
- **`api/sync.js`** : Vercel Serverless Function (Node runtime) qui fait passerelle vers Vercel KV (Redis hosté). Endpoints :
  - `GET /api/sync?user=<email>` → `{ sites, ts }`
  - `POST /api/sync { user, sites }` → upsert
  - Whitelist server-side : 4 emails canoniques. Cap 500 sites / 500 KB.
  - Fallback `503 KV_NOT_CONFIGURED` si la KV integration n'est pas connectée → client retombe sur localStorage.
- **`src/cloud-sync.js`** : layer client `window.cloudSync` exposé.
  - `pull()` au boot (event `fp:login-success`) + à chaque `visibilitychange visible`
  - `push()` debounce 0.9s après chaque mutation
  - Polling léger 30s tant que tab visible
  - Last-write-wins (acceptable pour 4 users × 1-20 sites)
  - Merge defensive par lat/lng 4-décimales (pas d'écrasement local non remonté)
- **Hooks index.html** : `cloudSync.push()` ajouté après `addCustomSite`, `removeCustomSite`, `qualifyCustomSite`, `importCustomSites`.
- **Badge UI** dans le card "Mes sites" : 🟢 Synchronisé / 🟡 Local seul / 🔴 Erreur.

**Action Paul (2-3 min, doc complète `docs/CLOUD_SYNC_SETUP.md`)** :
1. Vercel dashboard → projet → Storage → Create KV Database → Connect au projet
2. Redeploy
3. Vérifier badge "☁ Synchronisé" vert sur l'app

**Une fois actif** :
- Ajout site iPhone → ~1s plus tard visible sur Mac (au prochain pull / focus)
- Suppression Mac → push immédiat → propagé à iPhone
- Polling 30s tant que tab visible
- Hors KV configuré : mode dégradé localStorage + export/import URL (rien ne casse)

**Sécurité** : credentials KV jamais exposés au client (env vars Vercel) ; whitelist email server-side ; CORS `*` mais 403 si user inconnu.

**Coût** : Vercel KV Hobby gratuit (30k commandes/mois). Notre usage estimé ~50/jour → 1.5k/mois. Marge ×20.

---

## [v6.28-cross-device-sync] — 2026-04-20

### Sync sites custom Mac ↔ iPhone (sans backend) — Export/Import JSON

**Problème** : `localStorage` est **isolé par device + navigateur**. Paul ajoute un site sur iPhone Safari, il n'apparaît pas sur Mac Safari. Sans backend, sync auto impossible. Solution : sync manuelle via clipboard et URL.

**Fonctionnalités ajoutées** :
1. **Bouton "↗ Exporter"** dans le card "Mes sites" → prompt 2 modes :
   - `1` = Copie le JSON brut dans le presse-papier (à coller via "Importer" sur autre device)
   - `2` = Copie une URL `?import=<base64>` partageable (auto-import sur autre device)
2. **Bouton "↙ Importer"** → prompt textarea, accepte JSON brut OU URL `?import=…` (extrait base64 si URL).
3. **Auto-import via URL** : si l'app est ouverte avec `?import=<b64>`, prompt confirm puis import. URL nettoyée après (history.replaceState) pour éviter ré-import au refresh.
4. **Dédoublonnage automatique** : merge par lat/lng (4 décimales). Importer 2× la même liste = no-op (les doublons sont skip silencieusement).
5. **Migration appliquée** : chaque site importé passe par `migrateCustomSite` pour normaliser le schéma + sanitize text.

**Workflow Paul** :
- Sur iPhone (où "Floreasca" est présent) → onglet Mes Sites → "↗ Exporter" → choix `2` (URL) → URL copiée
- L'envoyer à soi-même par email/iMessage
- Ouvrir l'URL sur Mac Safari → confirm "Importer 1 site ?" → site ajouté
- Plus jamais besoin de re-saisir manuellement

**Fichiers touchés** :
- `index.html` : 4 nouvelles fonctions (`exportCustomSites`, `importCustomSitesPrompt`, `importCustomSites`, IIFE `autoImportFromURL`) + 2 boutons UI dans le card Mes Sites.
- `config.js` : bump `MODEL_VERSION` → `v6.28-cross-device-sync`.

**Vérifié en preview** : roundtrip complet URL → auto-import → site ajouté → URL nettoyée + dédoublonnage 1 dup ignoré / 1 nouveau ajouté.

---

## [v6.27-mes-sites-fix] — 2026-04-20

### Bugs fixés "Mes sites" + harmonisation pins custom dorés

**Demande Paul** : (1) sites custom n'apparaissent plus sur desktop alors que mobile OK ; (2) nouveaux sites doivent avoir la même vignette dorée que les TARGETS ; (3) bouton Suppr non-fonctionnel ressenti.

**Fixes** :
1. **Pin custom desktop = doré** (au lieu de violet `#8b5cf6` par défaut) → `addCustomSiteMarker` colors map: `prospect:'#d4a017', shortlist:'#d4a017'`. `validated` reste vert, `rejected` reste rouge.
2. **Pin custom mobile = doré** → CSS `.fp-target-pin.fp-custom-pin` override neutralisé (héritait avant un gradient violet `#a78bfa→#8b5cf6` !important). Désormais identique au TARGETS gold pin.
3. **Border-left card desktop = doré** → `renderCustomSites` colors map alignée idem.
4. **Defensive re-render à l'ouverture du tab "mysites"** → `switchTab('mysites')` appelle désormais `_loadCustomSites()` + `refreshCustomMarkers()` + `renderCustomSites()`. Évite que le state localStorage modifié hors-session (mobile, autre tab, hard refresh sans wipe) laisse la liste desktop vide.
5. **ID match laxe Number/String** dans `removeCustomSite`, `qualifyCustomSite`, `analyzeCustomSite` → `String(s.id) === String(id)` au lieu de `===` strict. Évite no-op silencieux si l'ID a dérivé en string via migration JSON.
6. **`qualifyCustomSite` re-refresh markers** (manquait) — changement de status remet à jour la couleur du pin sur la carte.

**Vérifié en preview** : 1 site seedé → border-left `rgb(212,160,23)` doré ✅ → bouton Suppr → 0 sites + liste re-rendue ✅.

**Fichiers touchés** :
- `index.html` : `addCustomSiteMarker`/`renderCustomSites` colors → doré ; `switchTab('mysites')` re-render defensive ; ID match `String()` dans 3 fonctions ; `qualifyCustomSite` ajoute `refreshCustomMarkers()`.
- `mobile.css` : `.fp-target-pin.fp-custom-pin` override violet supprimé.
- `config.js` : bump `MODEL_VERSION` → `v6.27-mes-sites-fix`.

---

## [v6.26-capex-leasing-total] — 2026-04-19

### UX : vignette CAPEX du tour BP affiche aussi le total cash + leasing

Demande Paul : voir d'un coup d'œil l'engagement total réel par club, pas seulement le CAPEX bilan.

- Big number renommé "CAPEX total / club" → **"CAPEX BILAN / CLUB"** (clarification : c'est l'investissement comptabilisé au bilan, hors leasing).
- Ajout sous-ligne avec separator : **"+ leasing 504 k€ (60% équip · 5 ans) → Total cash + leasing 1 680 k€"**. Le total est en vert (#34d399) et utilise le data-counter d'animation.
- Aucun changement modèle — purement UI/UX. Calculs P&L inchangés.
- Bump MODEL_VERSION → `v6.26-capex-leasing-total` (cache-bust assets navigateur).

---

## [v6.25-impots-locaux-2pct] — 2026-04-19

### Conservatisme investisseur : ajout 2% impôts locaux RO dans le P&L

**Décision Paul (master-franchisé)** : intégrer une charge "impôts locaux Roumanie" (taxa pe clădiri + impozit local activitate) à 2% du CA Total, figée dans `PNL_DEFAULTS`. Sourcing : OnAir Montreuil 2.2% du CA (audit Fiteco), arrondi à 2% pour FP Romania.

**Pourquoi** : ligne absente du modèle V17 initial. Pour un BP "décision investisseur" (capital propre engagé), il faut couvrir les charges réelles non-skippables. La taxa pe clădiri RO s'applique sur la valeur cadastrale du local et l'impozit local sur l'activité — incontournables.

**Implémentation** :
- `PNL_DEFAULTS.taxLocalRate = 0.02` (% du CA Total, pas seulement adhérents)
- Charge externe → pèse sur EBITDA (avant DAP, intérêts, IS)
- Intégrée dans les 3 calculs P&L : main `runFinancialModel` (L4529), sensitivity `runSensitivityIRR` (L4254), Monte Carlo `runMonteCarloSimulation` (L4769)
- Persistée dans le `monthly[]` array pour affichage future
- Slide BP "Coûts" du tour onboarding mise à jour : ajout ligne "Impôts locaux RO 2% CA · taxa pe clădiri · OnAir 2,2%" + EBITDA cible Y5+ ajusté de "44-55%" → "42-53%"

**Impact KPI sur les 5 TARGETS** (baseline v6.24 → v6.25) :

| Site | IRR Projet | NPV (k€) | Payback (mo) | Score | Verdict |
|---|---|---|---|---|---|
| Hala Laminor | 57.63 → **55.43** (-2.2pp) | 3 873 → **3 640** | 41 → 43 | 70 → 69.6 | GO COND ✅ |
| Baneasa | 60.52 → **58.28** (-2.2pp) | 4 192 → **3 949** | 40 → 41 | 69 → 68.8 | GO COND ✅ |
| Unirea | 40.64 → **38.61** (-2.0pp) | 2 160 → **1 977** | 54 → 56 | 70.8 → 70.3 | GO COND ✅ |
| Militari | 8.28 → **6.13** (-2.2pp) | -210 → **-323** | n/a | 57.5 → 56.2 | WATCH ⚠️ |
| Grand Arena | 3.65 → **1.42** (-2.2pp) | -448 → **-555** | n/a | 54.6 → 53.9 | WATCH ⚠️ |

**Aucun verdict ne bascule** — les 3 GO CONDITIONNEL restent solides, les 2 WATCH s'enfoncent légèrement (mais étaient déjà watch).

**Tests** : `.baseline.json` + `tests/analysis.html BASELINE` régénérés. **197/197 PASS** confirmé en preview.

**Fichiers touchés** :
- `index.html` : `PNL_DEFAULTS.taxLocalRate` ajouté + 3 spots de calcul P&L + persistance `monthly` array.
- `src/onboarding-tour.js` : slide `demoBpCosts` étendue (7 lignes au lieu de 6) + EBITDA cible ajusté.
- `tests/analysis.html` + `.baseline.json` : régénérés avec nouveaux IRR/NPV/PB/Score.
- `config.js` : bump `MODEL_VERSION` → `v6.25-impots-locaux-2pct`.

---

## [v6.24-revenue-bars-ready-gated] — 2026-04-19

### Bug fixé : courbe de revenus A1→A10 (slide REVENUS du tour BP) invisible

**Symptôme** : sur le slide "ÉTAPE 2 · REVENUS", l'axe X (A1...A10) et le label "CA · M€ · 51,3 M€ A10" s'affichaient, mais les barres de la courbe ramp-up restaient à hauteur 0 — grand espace vide entre subtitle et axe.

**Root cause** (deux problèmes superposés) :
1. **Sizing cassé** : le wrapper intermédiaire de chaque barre (`flex:1; flex-direction:column; align-items:center`) avait hauteur `auto` car le bar-container parent utilisait `align-items:flex-end` (pas de stretch sur l'axe transverse). La barre `height:${pct}%` référait donc à un parent à hauteur `auto` → résolution à 0 par la spec CSS.
2. **Animation potentiellement consumed au boot** : depuis le grid-stack v6.23, toutes les slides sont rendues simultanément ; les animations `forwards` inline déclarées sur les barres se terminaient pendant que le slide était invisible. Le replay JS (`replayInlineAnimations`) ne re-déclenchait pas systématiquement.

**Fix** :
- **Sizing** : ajout `align-self:stretch; justify-content:flex-end` sur le wrapper intermédiaire → il prend les 120px du bar-container, la barre `height:%` calcule correctement.
- **Animation** : nouvelle classe `fp-onb-revenue-bar` avec `transform:scaleY(0)` initial. L'animation `fpOnbBarGrow` est conditionnée par `.fp-onb-slide.ready .fp-onb-revenue-bar` (CSS rule, pas inline) avec delay via variable `--bar-delay`. Garantit que l'anim démarre seulement quand le slide est promoted (via la classe `.ready` ajoutée 380ms après promote dans `goToSlide`).

**Vérification** : barres A1=1px → A10=109px (sur 120px max), animation propre au passage du slide. Screenshot validé.

**Fichiers touchés** :
- `src/onboarding-tour.js` : nouvelle classe `.fp-onb-revenue-bar` + CSS rule gated `.fp-onb-slide.ready` ; HTML `demoBpRevenue` refait (wrapper stretch + delay en var CSS, animation inline supprimée).
- `config.js` : bump `MODEL_VERSION` → `v6.24-revenue-bars-ready-gated`.

---

## [v6.23-tour-grid-stack-layout] — 2026-04-19

### Bug fixé (V2) : chevauchement contenu/nav persistant sur tours BP + Sources

**Symptôme** (après v6.22 qui n'avait fixé que partiellement) : le contenu des slides BP (Hypothèses, Coûts) et Sources débordait sur les dots de navigation et le bouton "Suivant". Reproductible sur tous les viewports, les fenêtres étaient "presque toutes inutilisables" (Paul, 2026-04-19).

**Root cause** (cause profonde identifiée) : les slides avaient `position: absolute` → elles ne contribuaient pas à la hauteur naturelle du wrap. Un `syncWrapHeight` JS lisait `slide.scrollHeight` et forçait `slidesWrap.style.height`, mais cette sync avait des problèmes de timing (RAF throttling, animation delays) et interactions complexes avec flex-shrink + max-height. Résultat : hauteur JS parfois trop petite → contenu absolue overflow → chevauche les frères flex (dots, actions).

**Fix** (refonte) : **CSS grid stacking** au lieu de position:absolute.
- `.fp-onb-slides-wrap { display: grid; grid-template-columns: minmax(0, 1fr); }`
- `.fp-onb-slide { grid-column: 1; grid-row: 1; }` → toutes les slides partagent la même cellule grid
- La cellule grid prend automatiquement la hauteur du plus grand slide
- Plus aucun JS de height sync (fonction `syncWrapHeight` devenue no-op stub)
- `overflow-y: auto` + `max-height: calc(100vh - 200px)` comme safety net si le plus grand slide dépasse le viewport
- `scrollTop = 0` au changement de slide pour repartir du haut

**Tradeoff assumé** : les slides courtes ont ~60-80px d'espace vide en bas (la cellule grid prend la hauteur de la plus grande slide du tour). Acceptable vs. le chevauchement bloquant.

**Fichiers touchés** :
- `src/onboarding-tour.js` : CSS `.fp-onb-slide` + `.fp-onb-slides-wrap` refaites grid (position:absolute supprimée) ; `syncWrapHeight` → stub no-op ; `promoteActive` reset scrollTop.
- `config.js` : bump `MODEL_VERSION` → `v6.23-tour-grid-stack-layout`.

---

## [v6.22-tour-slides-wrap-overflow] — 2026-04-19

### Bug fixé : dernier item des slides BP (Hypothèses, Coûts) masqué par les dots/bouton Suivant

**Symptôme** : le slide "5 hypothèses clés" (slide 2) affichait "Redevance MF" derrière la nav. Même bug sur slide 4 "Structure de coûts" : le card "EBITDA cible Y5+" chevauchait les dots et le bouton "Suivant". Reproductible sur toutes tailles d'écran où la hauteur du contenu dépassait l'espace disponible.

**Root cause** : `.fp-onb-slides-wrap` avait `flex: 1 / flex: 0 0 auto` + hauteur JS via `syncWrapHeight` SANS `overflow`. Quand le contenu du slide dépassait l'espace dispo dans le card (contraint par `max-height: calc(100dvh - 48px)`), le slides-wrap débordait vers le bas. Les dots et actions (frères dans le flex column) se retrouvaient visuellement AU-DESSUS du contenu overflow à cause du `overflow: visible` par défaut. Le dernier item du slide flottait derrière les éléments de navigation.

**Fix** : ajout de `overflow-y: auto` + `max-height: calc(100dvh - 220px)` + `-webkit-overflow-scrolling: touch` + `scrollbar-width: none` sur la règle **de base** `.fp-onb-slides-wrap` (pas seulement en media query mobile). Quand le contenu dépasse, il scrolle DANS le wrap → dots+actions restent toujours visibles en dessous. Règle mobile simplifiée pour juste override `min-height` (220px) et `max-height` (calc(100dvh - 180px) vu la padding card réduite).

**Fichiers touchés** :
- `src/onboarding-tour.js` : règle de base `.fp-onb-slides-wrap` étendue (overflow + max-height universelle) ; media query mobile simplifiée.
- `config.js` : bump `MODEL_VERSION` → `v6.22-tour-slides-wrap-overflow`.

---

## [v6.21-persist-kpis-post-slider] — 2026-04-19

### 🔥 Bug critique fixé : KPIs (TRI, NPV, verdict) non persistés après ajustement loyer/charges/surface

**Symptôme** : utilisateur bouge les sliders loyer/charges/surface sur un site → les valeurs s'enregistrent dans `_rentOverrides`/`_chargeOverrides`/`_surfaceOverrides` + localStorage, l'affichage live du P&L/IRR se met bien à jour. **MAIS** quand il navigue vers le Dashboard compare ou lance l'export PDF, le TRI affiché est celui de l'analyse INITIALE, pas celui recalculé après slider.

**Root cause** (diagnostic via audit complet du flow) :
- `window._siteAnalyses` (source de vérité persistée dans `localStorage.fpSiteAnalyses`) est alimenté par `saveSiteAnalysis(name, lat, lng, r, exec)`.
- Cette fonction est appelée **uniquement** à 2 endroits : auto-analyse target au launch (ligne 1956) et fin de `renderCaptageAnalysis` (ligne 5433).
- `recalcPnLWithRent()` (desktop, ligne 4871) et `recomputeCurrentAnalysis()` (mobile.js, ligne 1559) recalculent correctement `r.pnl` + `exec` mais **ne persistaient jamais** le résultat dans `_siteAnalyses`.
- Conséquence : la matrice comparative (exportPDF ligne 5184) et tout consommateur de `_siteAnalyses` lisait des chiffres figés.

**Fix** :
1. `recalcPnLWithRent()` (desktop) appelle maintenant `saveSiteAnalysis(loc.siteName, loc.lat, loc.lng, r, exec)` à la fin, avec try/catch défensif.
2. `recomputeCurrentAnalysis()` (mobile) appelle `window.saveSiteAnalysis(t.name, t.lat, t.lng, r, exec)` après avoir mis à jour le cache local `analyses[activeIdx]`.
3. `saveSiteAnalysis` est maintenant exposé via `window.saveSiteAnalysis = saveSiteAnalysis` (nécessaire pour mobile.js qui est un module séparé).

**Test runtime (preview mobile Hala Laminor)** :
- IRR initial = 57,63%
- Override loyer Y1 = 18 €/m² (vs default 10,5) → IRR _siteAnalyses = 44,86% (delta -12,77 pts ✓)
- NPV : 3,87 M€ → 2,69 M€ (direction correcte, loyer↑ → NPV↓ ✓)
- localStorage `fpSiteAnalyses` écrit synchro (lsMatch: true ✓)

**Fichiers touchés** :
- `index.html` : `recalcPnLWithRent` +8 lignes (persist + guard), +1 ligne `window.saveSiteAnalysis` export.
- `src/mobile.js` : `recomputeCurrentAnalysis` +7 lignes (persist via window.saveSiteAnalysis + guard).
- `config.js` : bump `MODEL_VERSION` → `v6.21-persist-kpis-post-slider`.

**Tests** : 197/197 PASS (changements purement couche persistance, aucun impact modèle).

**Impact user** : le Dashboard compare, la matrice comparative de l'export PDF, et tout futur consommateur de `_siteAnalyses` reflètent désormais les KPIs RÉELS après override. Cross-session OK (localStorage persist).

---

## [v6.20-mobile-tours-2027] — 2026-04-19

### Fix mobile + effets "2027 ultra-moderne" sur les tours BP et Sources

**Contexte** : les démos 2 (BP cible pays) et 3 (Sources data) étaient complètement illisibles sur mobile 375px — le CTA bouton chevauchait les 2 dernières lignes de contenu (cost structure 6 rows, assumptions 5 rows, pop cards 3 niveaux, 4 flux cards). Root cause : `.fp-onb-slide { position:absolute }` dans un wrap à `min-height:340px` fixe → le contenu dense débordait sous les dots/CTA.

**Fix structurel — auto-height du slides-wrap**
- Nouveau `syncWrapHeight(slide)` : mesure `slide.scrollHeight` et l'applique à `slidesWrap.style.height` (immédiat + T+30ms + T+420ms pour ré-mesurer après `.ready`).
- Mobile CSS : `.fp-onb-slides-wrap { flex: 0 0 auto }` — empêche le flex layout d'écraser la hauteur JS.
- Appelé au `buildOverlay` initial + à chaque `goToSlide` + sur resize (rotation, clavier virtuel).

**Fix robustesse — double-RAF + fallback setTimeout**
- `goToSlide` promouvait `.active` via `requestAnimationFrame` seul → dans les navigateurs qui throttlent RAF sur tab inactive, les slides restaient coincées en `entering-right`/`leaving-left` sans jamais devenir `active`. Ajout d'un `setTimeout(50ms)` fallback qui promeut `.active` si RAF n'a pas tiré.
- `replayInlineAnimations()` : quand un slide devient actif, re-déclenche les animations inline (bars, cards) qui peuvent avoir été "consommées" au boot quand le slide était invisible.

**Compactage typo mobile tours BP + Sources**
- 15 nouvelles règles `@media (max-width:480px)` ciblant les classes sémantiques : `.fp-onb-bp-row`, `.fp-onb-bp-cost-row`, `.fp-onb-data-grid`, `.fp-onb-data-pop`, `.fp-onb-data-list`, `.fp-onb-data-flux`, `.fp-onb-bp-mc`.
- Paddings serrés (6-11px vs 10-14px), font-sizes réduits (8-10.5px vs 10-12px) pour 6 cost rows, 5 assumptions, 3 pop cards, 6 comp clubs, 6 immo neighborhoods, 4 flux cards, histogram Monte Carlo.
- Subtitle mobile : 12.5px / line-height 1.45. Title mobile : 21px line-height 1.15.

**Effets 2027 "waouhhh" (nouvelles classes utilitaires)**
- `.fp-onb-wow-glass` — glassmorphism dark avec `backdrop-filter: blur(12px) saturate(1.3)` + double inset border.
- `.fp-onb-wow-frame` — bordure iridescente animée (gradient gold × purple × gold qui oscille via `fpOnbIridescent` 4.5s).
- `.fp-onb-wow-bar` — shine sweep blanc 90° qui glisse de gauche à droite dans les progress bars (infinite, delay étalé).
- `.fp-onb-sparkles` — particules radiales qui apparaissent/explosent depuis le centre vers des positions `--sx`/`--sy` custom (keyframe `fpOnbSparkle` 1.8s).
- `.fp-onb-blur-in` — entrée avec blur(8px) → blur(0) + translateY + opacity (keyframe `fpOnbBlurIn` 0.55s, per-row delay).
- `fpOnbBreathe` — "respiration" subtile (scale 1.002 + translateY -1px) sur les check icons verdict.
- Spring curves : `cubic-bezier(.34,1.36,.4,1)` sur bars growth et `cubic-bezier(.34,1.56,.52,1)` sur card-in.

**Redesign visuel des 12 demos (6 BP + 6 Sources)**
- BP : Intro (3 stat tiles glassy + sparkles), Assumptions (rows blur-in stagger), Revenue (bars spring overshoot + radial glow ambient + shine sweep), Costs (bars gradient + glow + EBITDA banner glassy), Capex (gradients SVG + drop-shadow), Monte Carlo (bars purple/gold + median glow + stats P5/P50/P95 glassy + sparkles), Verdict (ring breathing + 5 sparkles + 3 KPI tiles glassy).
- Sources : Intro (6 source cards glassy + frame iridescent), Pop (3 cards glassy avec radial corner glow), Comps (bars gradient + shine staggered), Flux (4 metric cards radial corner + icons drop-shadow), Immo (bars color-coded), Rigor (ring breathing + 4 items frame iridescent + sparkles).

**Fichiers touchés**
- `src/onboarding-tour.js` : +100 lignes CSS (wow effects + mobile responsive), +30 lignes JS (syncWrapHeight + replayInlineAnimations + double-RAF fallback + resize handler), 12 fonctions demo redesignées.
- `config.js` : bump `MODEL_VERSION` → `v6.20-mobile-tours-2027`.

**Tests** : 197/197 PASS (changements purement UI/CSS/layout, aucun impact modèle financier).

---

## [v6.10-hardening] — 2026-04-18

### Audit complet + 3 fix de fiabilité (cible 100/100 fonctionnalité)

**Contexte** : audit exhaustif du codebase (code + preview mobile/desktop) pour détecter les vrais bugs avant de prétendre 100/100. 90 onclick handlers checked → 0 manquant ; 8 accordions mobile + sliders rent/charge/surface + per-site override isolation : OK ; locale toggle FR/EN : OK ; 6 tabs desktop + 8 layer toggles + 22 brand filters : OK ; charts clonés (v6.9) : OK. 3 bugs réels identifiés et corrigés :

**Fix #1 — Desktop : `compareSelects` vides à l'ouverture du tab Dashboard**
`switchTab('dash')` ne peuplait pas les dropdowns de comparaison — l'user voyait juste `-- Choisir --` tant qu'il n'avait pas déjà analysé une zone. Les 5 TARGETS existent en mémoire dès le boot mais n'étaient injectés que via `renderDash()` (appelé depuis `addZone()`). Fix : appeler `updateCompareSelects()` directement dans `switchTab('dash')`.

**Fix #2 — JSON.parse module-scope sans try/catch → app brickée si localStorage corrompu**
3 parses au niveau module (pas dans une fonction) faisaient planter tout le script si la valeur était invalide :
- `window._siteAnalyses = JSON.parse(localStorage.getItem('fpSiteAnalyses') || '[]')`
- `currentUser = JSON.parse(...)` (localStorage OR sessionStorage)
- `userList = JSON.parse(localStorage.getItem('fpUsers')||'[]')`

Symptôme : l'user avec une clé corrompue (bug antérieur, manip manuelle) ne pouvait plus charger l'app du tout. Fix : try/catch avec fallback sûr + auto-cleanup de la clé corrompue. Validé en preview : avec 3 clés corrompues, l'app charge la login page au lieu de crasher, l'user peut se reconnecter, les users canoniques sont re-seedés.

**Fix #3 — Race condition dans `updateUserParams()` re-render captage**
`if(el('captageContent') && el('captageContent').innerHTML)` appelait `el()` deux fois → théoriquement l'élément pouvait être retiré entre les deux appels. Fix : single ref stockée dans une variable locale (`const cc = el('...')`).

**Non-bugs confirmés** : doLogin errEl null (faux positif — #loginError toujours présent), compareSelects selectedOptions[0] (guardé par vA/vB check), Chart.js canvas null (tous présents au boot), email.toLowerCase null (tous les seed users ont un email). Ces items de l'audit initial ont été vérifiés et écartés.

**Tests** : 197/197 PASS (aucun impact modèle, uniquement couche défensive + UX).

---

## [v6.9-mobile-charts] — 2026-04-18

### Fix : charts vides dans le FAB secondary sheet mobile

**Bug reporté** : "Pricing benchmark non actif sur mobile" — la card apparaissait avec son titre mais le canvas était totalement vide. Même symptôme sur `finChart` (Trajectoire financière réseau), `segmentChart` (Répartition par segment) et `gapChart` (Gap Analysis).

**Cause racine** : le FAB secondary sheet mobile clone le `<div class="tab-panel">` desktop via `cloneNode(true)` puis `stripAllIds()`. Le canvas cloné perd son ID et n'est plus connu de Chart.js — le Chart original continue de dessiner dans le canvas desktop (caché), le clone reste vide. `syncClonedDynamicContent()` copiait aussi `innerHTML` sur les canvas (inopérant et trompeur).

**Fix** (`src/mobile.js`) :
- Nouvelle fonction `rebuildClonedCharts(cloneRoot)` : pour chaque `canvas[data-orig-id]`, récupère l'instance originale via `Chart.getChart(origCanvas)`, clone en profondeur `config.data` + `config.options` (en préservant les fonctions type `tooltip.callbacks.label`), et crée une nouvelle instance Chart.js sur le canvas cloné.
- Branchée dans `switchSecondaryTab` pour `stab in {dash, concurrence}` (50ms de délai pour laisser le DOM se stabiliser).
- Destruction propre des charts clones précédents à chaque rebuild pour éviter les fuites mémoire.
- `syncClonedDynamicContent` : skip explicite des `<canvas>` (innerHTML n'avait aucun effet utile et risquait de perturber Chart.js).
- Exposé `window._fpMobile.refreshClonedCharts()` + hooks dans `updateSegChart` et `updateGapChart` (index.html) pour re-render le clone dès que les datasets originaux changent (load concurrents Overpass).

**Tests** : 197/197 PASS (aucun impact modèle).

---

## [v6.8-reliability] — 2026-04-18

### Reliability + code quality upgrade (target note ≥ 8/10)

**Sécurité (XSS + input validation)**
- `addCustomSite()` valide lat/lng bounds + sanitise name/notes (strip HTML + control chars + max length 80/500) + ajoute schema `__v: 1`
- `addCustomSiteMarker()` popup : `site.name` + `site.notes` + `site.id` désormais escape/Number-cast → bloque XSS via nom de site malicieux (`<img onerror=...>`)
- Renders mobile (`renderCard`, `buildDetail`, competitor list, mysites list) : tous les champs user-provided passent par `_esc()` (alias `escapeHtml`)
- **Migration auto** des customSites v0 → v1 à chaque boot (strip HTML sur données existantes)

**Error handling global (nouveau `src/errors.js`, chargé en 1er)**
- `window.onerror` + `unhandledrejection` capturés + dédupliqués (fenêtre 3s)
- Toast user-visible auto-hide 6s, manual close, 4 niveaux (info/warn/error/success)
- Noisy third-party filters (Leaflet tile errors, Overpass 429s, ResizeObserver loops) supprimés du toast mais loggés
- Persistance `sessionStorage.fpErrorLog` (50 dernières)
- Helpers `window.safeTry(fn, ctx)` + `window.safeAsync(fn, ctx)` retournent `{ ok, value?, err? }` — never throw
- Public : `window._fpErrors.list()`, `.clear()`, `.show(msg, level)`

**localStorage safety**
- `safeStorage.get/set/remove` wrapper dans `src/utils.js` : never throws, gère quota exceeded avec toast user-visible
- `addCustomSite` rollback en cas d'échec de sauvegarde

**Offline / rate limiting**
- `rateLimit(fn, max, windowMs)` : Google Places autocomplete capé à 30 req/min (protection quota)
- `retry(fn, opts)` : exponential backoff pour Overpass/Nominatim
- `isOnline()` + `onOnlineChange(handler)` : toast "hors ligne" au boot + sur transitions
- Autocomplete search court-circuité en offline (hint "Hors ligne — recherche désactivée")

**Bugfixes latents**
- `recomputeCurrentAnalysis()` (mobile) : utilisait `TARGETS[activeIdx]` → cassait pour les custom sites. Remplacé par `getAllSites()[activeIdx]` + guard null.

**Code quality**
- `src/utils.js` enrichi : `escapeHtml`, `safeStorage`, `debounce`, `rateLimit`, `retry`, `isOnline`, `onOnlineChange` + JSDoc partout
- JSDoc sur `buildPnL()`, `getSurfaceScale()` (types retour + inputs documentés)
- Mobile module : `_t()` alias i18n + `_esc()` alias escapeHtml (évite shadow + garantit escape)

**Docs**
- Nouveau `docs/API.md` : documente toute la surface publique `window.*`, events, helpers, schema customSites, conventions de version
- À lire en premier pour tout refactor / onboarding nouveau dev

**Tests : 197/197 PASS** (aucun impact modèle — pure couche défensive)

### Upgrade note pragmatique estimée : 8,2 → **8,7 / 10**
- Fiabilité : +0,3 (error boundary + offline + XSS closed)
- Code quality : +0,2 (utils consolidés + JSDoc types)
- Longévité : +0,2 (schema versioning + docs/API.md + migrations)

Restent à faire pour 9+/10 : backend + DB migration, backtest contre clubs ouverts, ML recalibration (cf. roadmap v7+).

---

## [v6.7-i18n-fr-en] — 2026-04-18

### Traduction FR ↔ EN via toggle pill

Nouveau module `src/i18n.js` avec dictionnaire FR/EN (~140 clés), helper `window.t(key, params)`, persistance `localStorage.fpLocale`, et event `fp:locale-changed` pour re-render dynamique.

**Pill toggle** visible top bar mobile (à côté de l'avatar) + sidebar desktop (à côté du version badge). Click → switch locale immédiat + rebuild carousel + detail si ouvert. Haptic feedback sur mobile.

**Coverage v1** (≥95% surfaces mobile visibles) :
- Top bar (search pill, placeholder, locale pill)
- Carousel card (SITE, Secteur/Sector, Phase, Members, Voir l'analyse complète / View full analysis)
- Detail header + nav (prev/next site, verdict)
- Hero metrics (Members/Target, IRR, NPV, SAZ Score, Payback)
- Accordion heads (Location, SAZ Score, Demographics, Member sources, P&L, Financing, BP template, Competitors)
- Sliders (Loyer/Rent, Charges, Surface + hints)
- P&L scenarios (Conservative/Base/Optimistic, NPV, Breakeven, Payback)
- Financing card (Equity, Loan, Rate, Term, Monthly payment, Interest, Project IRR, Equity IRR)
- BP template card (Revenue, Costs, Rent stepped, CAPEX & Financing, Financial params, OnAir benchmark)
- FAB secondary sheet tabs (Layers, Competition, My sites, Dashboard)

**Non traduit en v1 (resté FR)** :
- Sparkline CAF annuelle header text ("Évolution sur 5 ans · Base")
- Tooltip content inside info-tips (e.g. IRR Projet vs Equity explanatory text)
- Onboarding tour (affiché une fois, localStorage)
- Desktop captage analysis deep content (tabs + analysis text)
- Admin UI (user management, invite links)

**Architecture i18n** :
```js
const _t = (k, p) => (typeof window.t === 'function' ? window.t(k, p) : k);
// Local alias dans mobile.js pour éviter shadowing avec `t` = target site
// Toggle: window.toggleLocale() → emit 'fp:locale-changed' → listeners rebuild
```

**Files** :
- `src/i18n.js` (nouveau, 280 lignes, dict FR + EN)
- `src/mobile.js` (+~150 remplacements `_t('key')`)
- `mobile.css` (+`.fp-locale-pill` styling)
- `index.html` (chargement i18n.js avant mobile.js + pill desktop)
- `config.js` MODEL_VERSION v6.7

Tests 197/197 PASS (i18n est purement UI, pas d'impact modèle).

---

## [v6.6-capex-scales-surface] — 2026-04-18

### CAPEX + Leasing scalés sur surface

Les investissements upfront scalent désormais linéairement avec la surface :
- **CAPEX** ref = 1 176 k€ à 1 449 m² → **812 €/m²** (travaux 580 + équip 232)
- **Leasing** ref = 100,8 k€/an à 1 449 m² → **69,6 €/m²/an**

Helpers `getScaledCapex()` et `getScaledLeasingAnnual()` appliquent le ratio `_surfaceOverride.surface / PNL_DEFAULTS.rentSteps.surface`. Si pas d'override → ratio = 1, valeurs BP d'origine.

**Exemples** (loyer objectif négo, autres variables figées) :
| Surface | Loyer Y1 | CAPEX | Leasing/an | Impact IRR approx. |
|---|---:|---:|---:|---:|
| 800 m² | 12,8 k€/mo | 650 k€ | 55,6 k€ | +pp (site petit, moins de CAPEX à amortir) |
| 1 449 m² (ref Hala) | 23,2 k€/mo | 1 176 k€ | 100,8 k€ | = baseline |
| 2 000 m² | 32,0 k€/mo | 1 623 k€ | 139,1 k€ | mix selon captage vs CAPEX |
| 3 000 m² | 48,0 k€/mo | 2 435 k€ | 208,7 k€ | IRR probablement dégradé si captage n'augmente pas proportionnellement |

Applied partout où CAPEX / leasing sont utilisés :
- `buildPnL()` — P&L principal
- `runSensitivityCase()` — sensibilité mono-paramètre
- Scénarios Monte Carlo (conservateur/base/optimiste)
- `bpTemplateCard()` mobile — affiche dynamiquement les valeurs scalées

Tests 197/197 PASS (surface défaut 1449 → ratio 1 → valeurs inchangées).

---

## [v6.5-surface-slider] — 2026-04-18

### Slider surface m² per-site + restore overrides au switch

Troisième slider dans l'accordion P&L pour ajuster la surface du club (500-3000 m², défaut 1 449 m² Hala), **per-site persistant** via `window._surfaceOverrides[siteKey]`. Modulable parce que chaque site d'expansion peut avoir une surface différente qui impacte directement le loyer annuel (surface × €/m² × 12).

`getSteppedRentMonthly` lit la surface depuis l'override si défini.

**Restore overrides au changement de site (mobile)** : `activateSite(i)` restaure désormais `_rentOverride`, `_chargeOverride`, `_surfaceOverride` depuis la map per-site (ou reset à null si le site n'a pas de custom) — corrige le bug latent où les sliders d'un site A polluaient l'analyse du site B.

**Hint live "Total all-in Y1"** : factorisé en `updateRentAllInHint()`, appelé par les 3 handlers. Affichage immédiat sans attendre le debounce.

```js
window._surfaceOverride = null;       // {surface: number}
window._surfaceOverrides = {};        // per-site: siteKey → surface m²
```

Note : **CAPEX reste fixe** (1 176 k€) pour l'instant — la structure de coûts figée (post-calibration OnAir v6.x) ne bouge pas. Si besoin d'ajuster CAPEX proportionnellement à la surface, à faire dans une version ultérieure.

Tests 197/197 PASS (baseline inchangée puisque la surface par défaut reste 1 449 m²).

---

## [v6.4-charges-slider] — 2026-04-18

### Slider charges €/m² per-site + live recalc

Ajout d'un deuxième slider dans l'accordion P&L pour ajuster service charges + marketing fee (0-12 €/m², défaut 5.5 €/m²), **per-site persistant** via `window._chargeOverrides[siteKey]`.

`getSteppedRentMonthly` applique l'override des charges si défini. Tous les KPIs (IRR, NPV, CAF, EBITDA, breakeven, payback, IRR Equity) recalculent en live (debounce 90ms).

Total all-in Y1 affiché sous le slider avec annuel prévu :
```
Total all-in Y1 : 16.0 €/m² × 1 449 m² = 278k€/an
```

Tests 197/197 PASS.

---

## [v6.3-financing-bptemplate] — 2026-04-18

### Structure de financement + IRR Equity + Onglet didactique BP

**1. Intérêts d'emprunt enfin modélisés** (oubli v5.x corrigé)

OnAir Montreuil porte un emprunt 495 k€ et paie 10.7 k€ d'intérêts/an. Notre BP le faisait complètement implicite (CAPEX 100% equity). Désormais:

```js
PNL_DEFAULTS.financing = {
  equityRatio:   0.30,    // 30% apport associés
  loanRatio:     0.70,    // 70% emprunt bancaire
  loanRate:      0.065,   // 6.5% (RO SME 2026)
  loanTermYears: 7,       // Standard franchise loan
}
```

Pour CAPEX 1 176 k€ :
- Equity : 353 k€
- Emprunt : 823 k€
- Échéance mensuelle : 12 224 €
- Intérêts cumulés 7 ans : **~185 k€**
- Intérêts Y1 (CA faible) : ~52 k€/an (2.1% CA)
- Intérêts Y5 (CA cruising) : ~17 k€/an (0.9% CA)

**2. Nouveau indicateur : IRR Equity (levered)**

`buildPnL` retourne maintenant :
- `irr` / `npv` : **IRR Projet (unlevered)** — perf opérationnelle pure, décision go/no-go (inchangé, baseline intacte)
- `irrEquity` / `npvEquity` : **IRR Equity (levered)** — retour aux associés après service de dette

Hala Laminor : IRR Projet 57.6% → IRR Equity **89.3%** (effet levier +32pp, car IRR > taux emprunt 6.5%).

**3. Nouvel accordion mobile "Financement & IRR equity"**
Card visuelle avec :
- Barre de répartition Equity 30% / Emprunt 70%
- Apport, Emprunt, Taux, Durée, Échéance, Intérêts cumulés
- IRR Projet (unlevered) vs IRR Equity (levered) côte à côte
- Info-tip ? explicatif du concept

**4. Nouvel accordion mobile "Structure coûts BP (type)" — didactique**
Référence complète des hypothèses du BP pour infos:
- **Revenus** : prix TTC Base/Premium/Ultimate, cible membres maturité
- **Coûts taux appliqués** : Staff 9%, COGS 2.8%, OPEX ops curve 20→12%, Redevance 6%, Fonds pub 1%, FP Cloud, Leasing
- **Loyer stepped** : Y1-Y2, Y3-Y4, Y5+, indexation HICP 3%, surface 1449 m²
- **CAPEX & Financement** : 1.2M€ avec split 30/70 equity/loan à 6.5% sur 7 ans
- **Paramètres financiers & sortie** : WACC 12%, CIT 16%, exit EV/EBITDA 6×, croissance A4-A6 5%, A7+ 2%
- **Benchmark OnAir Montreuil** (card gold) : CA 2.24M€, EBITDA 44.7%, tous ratios comparatifs

**Non-régression :**
- Tests 197/197 PASS (IRR Projet inchangé, seuls ajouts de nouveaux champs)

**Fichiers :**
- `index.html` : `PNL_DEFAULTS.financing` + amortization dans `buildPnL` + retour `irrEquity`/`npvEquity`/`totalInterest`/etc.
- `src/mobile.js` : 2 nouveaux accordions (`financing`, `bptemplate`) avec cards dédiées `financingCard()` et `bpTemplateCard()`
- `config.js` : MODEL_VERSION v6.3

---

## [v6.2-opex-12pct-cruising] — 2026-04-18

### OPEX ops Y5+ compressé à 12% (décote Romania appliquée)

**Rationale :**
OnAir Montreuil (franchise audité) fait 10.8% d'OPEX ops en France en Y5 mature. Romania a des avantages structurels nets (salaires staff opérationnel −60%, télécom −30%, marketing local −25%, électricité −15-25%). Il est cohérent d'appliquer une décote modérée plutôt que de rester à 15%.

**Nouvelle courbe:**
```js
opexOpsRateByYear: [0.20, 0.18, 0.16, 0.14, 0.12]  // linear -2pp/an
```

| Année | Taux | Écart vs v6.1 |
|---|---:|---|
| Y1 | 20% | = |
| Y2 | 18% | = |
| Y3 | 16% | −1pp |
| Y4 | 14% | −2pp |
| Y5+ | **12%** | **−3pp** |

**Positionnement vs benchmarks :**
- OnAir Montreuil Y5 réel: 10.8% → notre 12% = **+1.2pp de marge de sécurité**
- Romania théorique (OnAir − décote labor/telecom): ~8% → notre 12% = **+4pp de buffer**
- **Reste conservateur** — marge suffisante pour imprévus (inflation RO, choc énergie)

**Impact sur les 5 sites:**
| Site | IRR v6.1 (15%) | IRR v6.2 (12%) | Δ NPV |
|---|---:|---:|---:|
| Hala Laminor | 55.78% | **57.63%** | +268 k€ |
| Baneasa | 58.68% | **60.52%** | +279 k€ |
| Unirea | 38.68% | **40.64%** | +210 k€ |
| Militari | 5.71% | **8.28%** | +130 k€ |
| Grand Arena | 0.90% | **3.65%** | +123 k€ |

→ **Gain moyen +200 k€ NPV par site**, Grand Arena/Militari désormais nettement positifs (toujours WATCH à cause du flux faible mais IRR double).

**Défense devant investisseur :**
> "Notre benchmark OnAir Montreuil (franchise fitness 1 club cruising Y5, CA 2.24M€, audité par Fiteco) affiche 10.8% d'OPEX ops hors management fees. Le BP Romania retient **12% en cruising** (+1.2pp de marge de sécurité vs France), malgré l'avantage structurel du marché roumain (salaires sécurité/ménage −60%, télécom −30%). En phase ramp-up Y1-Y4, la courbe grimpe de 20% à 14% pour refléter la dilution naturelle des coûts fixes sur un CA en croissance."

**Files:**
- `index.html` : `opexOpsRateByYear: [0.20, 0.18, 0.16, 0.14, 0.12]`
- `config.js` : `MODEL_VERSION = 'v6.2-opex-12pct-cruising'`
- `.baseline.json` + `tests/analysis.html` : baseline réalignée → 197/197 PASS
- `docs/MODEL.md` : section OnAir Calibration mise à jour

---

## [v6.1-opex-timedecay] — 2026-04-18

### Time-decay sur OPEX ops (ramp-up plus réaliste)

**Problème identifié :**
OnAir Montreuil (ratio 10.8% OPEX ops) est un club en **Y5 mature**, ramp-up terminé. Notre BP appliquait le taux cruising 15% même en Y1 — incohérent car les coûts fixes (énergie, sécu, maintenance, assurance, IT) ne varient pas avec le volume de membres.

**Solution — formule time-decay linéaire :**
```js
opexOpsRateByYear: [0.20, 0.18, 0.17, 0.16, 0.15]  // Y1 → Y5+ (cruising)
```

| Année | OPEX ops | Justification |
|---|---:|---|
| Y1 | 20% | Start-up : coûts fixes à pleine charge + marketing grand opening sur CA faible |
| Y2 | 18% | Ramp-up — CA double vs Y1 mais fixes inchangés |
| Y3 | 17% | Membres proches cruising, dilution progressive |
| Y4 | 16% | Mature, économies d'échelle établies |
| Y5+ | **15%** | **Floor conservateur** — pas de décote Romania appliquée, marge de sécurité +4.2pp vs OnAir réel 10.8% |

**Principe préservé :**
- Romania charges théoriquement < France, MAIS on **n'applique pas** cette décote → reste **conservateur**
- Seule la décroissance temporelle est modélisée (incontestable d'un point de vue comptable)

**Impact sur les 5 sites :**
| Site | IRR v6.0 | IRR v6.1 | Δ |
|---|---:|---:|---|
| Baneasa | 60.57% | **58.68%** | −1.9pp |
| Hala Laminor | 57.57% | **55.78%** | −1.8pp |
| Unirea | 40.02% | **38.68%** | −1.3pp |
| Militari | 6.51% | **5.71%** | −0.8pp |
| Grand Arena | 1.65% | **0.9%** | −0.75pp |

→ NPV moyen −80k€/site (variable selon taille)
→ Numbers plus **réalistes en phase ramp-up** (Y1-Y2), identiques en cruising (Y5+)

**Template futurs BP:**
```js
PNL_DEFAULTS.opexOpsRateByYear = [0.20, 0.18, 0.17, 0.16, 0.15]
// À utiliser via:
const opexRate = PNL_DEFAULTS.opexOpsRateByYear[Math.min(yearIdx, 4)];
```

**Fichiers:**
- `index.html` : nouveau `opexOpsRateByYear` dans `PNL_DEFAULTS`, `buildPnL` utilise l'index par année
- `config.js` : `MODEL_VERSION = 'v6.1-opex-timedecay'`
- `.baseline.json` + `tests/analysis.html` : baseline réalignée → 197/197 PASS
- `docs/MODEL.md` : section OnAir Calibration mise à jour

---

## [v6.0-onair-calibrated] — 2026-04-18

### Recalibration complète du BP — benchmark OnAir Montreuil

Après analyse du **bilan TEMATACA** (franchise OnAir Montreuil, exercice 09/2024 → 08/2025, CA 2.24 M€, EBITDA 44.7%, certifié Fiteco), les taux de charges du BP Romania ont été recalés sur le réel.

**Modifications `PNL_DEFAULTS`:**
| Poste | v5.x | v6.0 | OnAir réel | Raison |
|---|---:|---:|---:|---|
| `costOfSalesRate` | 5.0% | **2.8%** | 2.77% | OnAir vend 8.4% du CA en marchandises avec 68% de marge → COGS réel 2.77%. Notre 5% implicitait 15% du CA en VAD, irréaliste. |
| `opexOpsRate` | 20.0% | **15.0%** | ~12% | OnAir hors staff/loyer/franchise/COGS = ~12%. Romania: économies d'échelle sur salaires/énergie/sécu. 15% = conservateur. |
| `fondsPubRate` | 2.0% | **1.0%** | 1.0% | Standard franchise fitness EU. Pas de raison d'être 2× plus haut. |
| `redevanceRate` | 6.0% | **6.0%** (inchangé) | 4.0% | Maintenu à 6% car **master-franchise Isseo** a un taux supérieur à la franchise classique OnAir. |

**Impact sur les 5 sites (NPV base 5 ans):**
| Site | IRR avant | IRR après | NPV avant | NPV après |
|---|---:|---:|---:|---:|
| Hala Laminor | 48.0% | **57.6%** | 2.74 M€ | **3.70 M€** |
| Baneasa Shopping City | 50.8% | **60.6%** | 3.02 M€ | **4.01 M€** |
| Unirea Shopping Center | 31.0% | **40.0%** | 1.28 M€ | **2.02 M€** |
| Grand Arena | −9.4% | **+1.7%** | −0.96 M€ | **−0.53 M€** |
| Militari Shopping | −3.8% | **+6.5%** | −0.76 M€ | **−0.29 M€** |

→ **Gain moyen: +10pp IRR, +600 k€ NPV par site**
→ Grand Arena et Militari passent d'IRR négatif à légèrement positif (toujours WATCH à cause du flux faible)

**Template futur BP (à utiliser pour tous les nouveaux sites)**:
```js
PNL_DEFAULTS = {
  // Calibrated OnAir Montreuil benchmark (Fiteco 09/2024-08/2025)
  costOfSalesRate: 0.028,    // Cost of Sales (achats marchandises revendues)
  opexOpsRate:     0.15,     // OPEX ops (énergie, maint, assu, télécom, marketing local)
  redevanceRate:   0.06,     // Master-franchise Isseo (vs 4% franchise classique)
  fondsPubRate:    0.01,     // Fonds publicitaire réseau
  staffRate:       0.09,     // Staff (BP FP officiel)
  staffFloorAnnual: 65000,   // Plancher 4 ETP Romania
  // ... (loyer stepped + leasing + FP Cloud inchangés)
}
```

**Fichiers mis à jour:**
- `index.html` : `PNL_DEFAULTS` avec commentaires OnAir benchmark
- `config.js` : `MODEL_VERSION = 'v6.0-onair-calibrated'`
- `.baseline.json` : nouvelles valeurs de référence pour les 5 sites
- `tests/analysis.html` : BASELINE aligné (197/197 PASS avec nouvelles valeurs)
- `docs/MODEL.md` : section "OnAir Calibration v6.0" documente la méthodologie

---

## [v5.9-session-zoom-caf] — 2026-04-18

### 4 améliorations post-test Paul

**1. Session mobile persistante (plus de re-login)**
- Mobile détecté via `innerWidth ≤ 768` OR user-agent → `localStorage.fpCurrentUser`
- Desktop → `sessionStorage.fpCurrentUser` (sécurité préservée — disparaît à la fermeture de l'onglet)
- **Timer d'inactivité 10min désactivé sur mobile** (biométrie du device suffit), maintenu desktop
- `doLogout()` clear les DEUX storages pour safety
- Invite link + switchUser utilisent `_authStorage()` selon device
- `auth-guard.js` : `_readUser()` lit depuis les 2 storages, sigs écrit dans le bon selon `_storage()`

**2. Fix Dashboard comparaison sites (selects ne rien ne se passait)**
- Bug : les selects Site A/Site B du clone FAB avaient leurs IDs strippés → `el('compareA').value` retournait le desktop select vide
- Fix :
  - `stripAllIds` garde `data-orig-id`
  - Nouveau handler `change` sur clone : propage la valeur au desktop select + trigger son `onchange` → `runComparison()` s'exécute correctement
  - `syncClonedDynamicContent` refuse de toucher les `<select>` / `<input>` / `<textarea>` (préserve user input)

**3. Calibration zoom map au boot (plus besoin de dézoomer)**
- Avant : `zoom:12` hardcoded → recadrage manuel nécessaire selon la taille écran
- Après : `calibrateInitialView()` = `fitBounds(5 TARGETS)` avec padding adapté :
  - Desktop : 40px all sides
  - Mobile : 80px top + 200px bottom (comptable top bar + peek sheet)
  - `maxZoom: 13` pour ne pas zoomer trop sur un cluster
- Recalibrage automatique sur `resize` et `orientationchange` (250ms debounce)
- `prewarmTiles` mobile utilise aussi fitBounds (plus de restore qui cassait le zoom)

**4. CAF annuelle update LIVE avec le slider loyer**
- Avant : le slider loyer updatait hero metrics + scénarios, mais les barres CAF restaient figées
- Après : `recomputeCurrentAnalysis` appelle maintenant `updateCafBarsInline(r)` qui :
  - Regénère le HTML de la sparkline (via `buildSparkline(r.pnl.base)`)
  - Remplace `#fpCafContainer.innerHTML`
  - Relance l'animation des barres (stagger 90ms)
- Exemple : loyer 10.5→20 €/m² → CAF moy. Y2-Y5 passe de 596k€ à 398k€, barres redessinées

**Non-régression :**
- Tests 197/197 PASS ✓

---

## [v5.8-viz-autocomplete] — 2026-04-18

### 3 fixes post-test Paul

**1. Dashboard Site A / Site B dropdowns vides**
- Symptôme : dans FAB → Dashboard, les selects "Site A" / "Site B" n'avaient aucune option → impossible de comparer deux sites.
- Cause : `updateCompareSelects()` n'était appelée qu'à `addZone()` (click map analyzé). Au boot, les selects desktop étaient vides → clone FAB vide.
- Fix : dans `switchSecondaryTab('dash')`, appel explicite de `updateCompareSelects()` avant `syncClonedDynamicContent`. Les 5 TARGETS + customs apparaissent immédiatement.

**2. Mini-map concurrents illisible → nouvelle viz claire**
- Avant : radar SVG avec dots minuscules, pratiquement invisibles
- Après : **2 cards empilées** :
  - **Proximité concurrentielle** — 3 barres horizontales par tranche de distance :
    - 0-1 km (PROCHE) : X clubs / Y captifs (couleur rouge)
    - 1-2 km (MOYEN) : X clubs / Y captifs (couleur orange)
    - 2-3 km (ÉLOIGNÉ) : X clubs / Y captifs (couleur jaune)
    - Chaque barre montre count + captifs à droite
  - **Top marques — captifs potentiels** : top 5 brands avec barres proportionnelles aux captifs (World Class, Downtown, Stay Fit…)
- Animation `width` 800ms cubic-bezier smooth
- Typographie hiérarchique, lisible

**3. Autocomplete Google Places pour ajouter un site custom**
- Avant : input "Adresse" + bouton "Geocoder" (Nominatim basic)
- Après : **autocomplete live** directement dans le champ
  - Debounce 220ms, suggestions dès 2 chars
  - Session token + placeId resolution (comme la search principale)
  - Fallback Nominatim si Google indispo
  - Sur sélection : appel direct `addCustomSite(lat, lng, name)` → fermeture FAB → flyTo + snap summary
  - Le site ajouté apparaît dans carrousel + pins + Mes sites immédiatement via `_fpMobileRefreshSites`

**Non-régression :**
- Tests 197/197 PASS ✓

---

## [v5.7-fab-fixes] — 2026-04-18

### 3 fixes post-test Paul

**1. Bug filter concurrents — toggles impossibles à réactiver**
- Symptôme : cliquer "World Class" dans le FAB mobile → vignette barrée (strike-through). Click suivant → aucune réaction visuelle, état figé.
- Cause : le clone du tab-compete avait ses IDs strippés. Quand `toggleBrand('World Class')` fire, il update le global `brandVisibility` + rebuild les conteneurs desktop `#brandFilters` et `#brandFiltersExplorer`. Le clone dans le FAB reste stale → pas de repaint → user confus.
- Fix : `stripAllIds()` préserve l'ID original en `data-orig-id`. Nouvelle fonction `syncClonedDynamicContent(clone)` qui recopie le innerHTML depuis le desktop après chaque click. Hooké sur tout click dans le clone (40ms delay pour laisser les handlers finir).
- Résultat : toggles, filters, compteurs tous en sync visuel instant.

**2. "Mes sites" vide — section invisible sur mobile**
- Symptôme : onglet "Mes sites" du FAB montrait seulement le formulaire d'ajout, pas la liste des sites existants.
- Fix : `renderMySitesIntoClone(cloneRoot)` insère en tête du clone une card "⭐ TOUS LES SITES (N)" avec les TARGETS + customSites, chacun avec :
  - Badge numéroté (gold pour TARGETS, violet pour customs)
  - Nom + secteur + ouverture
  - Badge "Priorité" ou "Custom"
  - Click → ferme le FAB + fly-to map + snap summary
- Résultat : l'user voit ses 5 sites priorisés + ses customs directement.

**3. Icône PWA = vrai logo horizontal Fitness Park**
- Avant : icône carrée générée "FP + underline" (stylisée mais pas le vrai logo)
- Après : PNG base64 officiel du logo horizontal de `index.html` extrait + redimensionné (82% de l'icône) + centré sur fond `#06080f`
- Tagline "SE DÉPASSER - SE SURPASSER" visible sur les grandes tailles (180, 192, 512)
- Tous les assets régénérés : favicon, apple-touch-icon, icon-192, icon-512

**Non-régression :**
- Tests 197/197 PASS ✓
- Desktop inchangé

---

## [v5.6-clean-sectors] — 2026-04-18

### Secteurs Bucharest : pinwheel non-overlapping + default OFF

**Avant :**
- 6 polygones dessinés à la main avec des coordonnées arbitraires
- Edges non-partagés entre secteurs voisins → chevauchements visibles
- Activés par défaut (pollution visuelle au boot)

**Après — pattern pinwheel :**
- Centre commun : **Piața Unirii** (44.4268, 26.1025)
- 6 points d'angle extérieurs (`SEC_N`, `SEC_NE`, `SEC_SE`, `SEC_S`, `SEC_SW`, `SEC_NW`) **partagés** entre secteurs voisins
- Chaque polygon : `[centre, corner_in, arc_extérieur, corner_out, centre]`
- **Impossible de chevaucher** par construction mathématique
- Visuellement = tranches de pizza depuis Piața Unirii, avec arcs extérieurs qui approximent les vraies limites

**Logique layer :**
- `layers.sectors = false` par défaut (plus propre au boot)
- `drawSectors()` crée les polygons dans des layerGroups (`sectorPolyLayer`, `sectorLabelLayer`)
- N'ajoute à la carte que si `layers.sectors === true`
- `toggleLayer('sectors')` montre/cache les deux layer groups
- Toggle HTML : classe `on` retirée par défaut (visual sync)

**Trade-off assumé :**
- Les vraies limites admin de Bucharest sont plus complexes (suivent des rues)
- Le pinwheel est une **approximation géométrique propre**, plus lisible qu'un vrai admin boundary sur un petit écran
- Alternative rejetée : fetch OSM admin_level=9 au boot (dépendance réseau + complexité)

**Impact calculs :**
- `estimatePopInRadius` et `findSector` utilisent les nouveaux polygons
- Unirea Shopping Center : `sazDens` 61 → 48, `score` 68.6 → 68.2
- Autres sites : identiques
- **Baseline mise à jour** : `.baseline.json` + `tests/analysis.html`

**Tests :** 197/197 PASS ✓

---

## [v5.5-desktop-polish] — 2026-04-18

### Desktop Apple-like art layer

Même traitement polish que mobile, adapté pour grands écrans. Aucun changement fonctionnel ou de data.

**`desktop-polish.css` (nouveau, 15KB, gated `@media (min-width: 769px)`) :**

- **Sidebar glassmorphique** : backdrop-filter blur 20px + saturate 180%, gradient vertical subtil, inner sheen radial gold-tinted
- **Header** : logo scale-on-hover + drop-shadow dynamique, version badge avec inner light, avatar gradient cuivré + spring scale
- **Search input** : focus ring 3px gold tint + border accent + glow, icône stroke change au focus
- **Tabs** : pills au lieu d'underline, gradient bottom bar au lieu d'underline, hover background subtil
- **Cards** : backdrop-filter blur 12px + saturate 140%, hover lift (-2px) + glow gold + border accent
- **Card titles** : gradient text (blanc → gold), icône avec drop-shadow gold
- **Toggles** : plus grands (40×22), gradient gold on state + inner highlight + drop-shadow, spring transition
- **Boutons** : gradient gold soft, hover lift + glow, active scale .98
- **Metric rows** : hover background subtil + padding shift (rétroaction)
- **Scrollbar** : branded gold gradient
- **Map overlays** : glass + hover lift
- **Zoom controls** : boutons ronds glass + spring scale
- **Tile selector** : container glass unifié, items rounded
- **Legend / status bar** : glass pills
- **Boot animation** : fade-in 600ms sur #app
- **Chart canvas** : glow radial gold subtil en fond
- **Info tips** : spring scale 1.2 + color shift on hover
- `prefers-reduced-motion` respecté

**Pins numérotés FP sur map desktop :**
- Les 5 pins numérotés (1-5) sont maintenant visibles sur desktop aussi
- Même style que mobile : gold gradient, pulse animation sur actif, hover scale
- Custom sites en pins violet
- Appellent `activateSite` → sync carousel mobile + analyse desktop
- Click pin → active site dans le carrousel (et ouvre summary si mobile)

**Competitor clusters polish :**
- Gradient gold + shadow + inner highlight (au lieu de simple fond gold)

**Non-régression :**
- Tests 197/197 PASS ✓
- Mobile inchangé (gated media query)

**Fichiers :**
- `desktop-polish.css` (nouveau, ~540 lignes)
- `index.html` : ajout `<link rel="stylesheet" href="desktop-polish.css">`
- `src/mobile.js` : `initDesktopPins()` pour activer les pins desktop (initialement gated mobile-only)

---

## [v5.4-autocomplete-caf-pwa] — 2026-04-18

### 3 demandes post-test Paul

**1. Google Places Autocomplete**
- Avant : search classique avec bouton "Geocoder" (Nominatim ou Google Places Text Search, résultats après 3 chars + 400ms)
- Maintenant : **vrai autocomplete** via `places:autocomplete` (Google Places API New)
  - Debounce 220ms, déclenche dès 2 chars
  - Suggestions avec titre principal + sous-titre (structuredFormat Google)
  - Biased sur Bucarest (lat/lng 44.4268/26.1025, radius 40km)
  - Session token pour billing optimisé (1 session = autocomplete + détails = 1 charge)
  - Sur sélection : `places/{placeId}` → lat/lng → flyTo + analyse
  - Fallback Nominatim si pas de clé Google ou erreur
- UI : items cards style iOS avec icône pin gold, hover/active feedback, clear button (✕), footer "Powered by Google Places"

**2. Icône PWA officielle Fitness Park**
- Avant : icône générique "F" sur fond sombre quand ajouté à l'écran d'accueil
- Maintenant : **logo carré FP + underline gold** généré (Python PIL) :
  - `favicon.png` (32×32)
  - `apple-touch-icon.png` (180×180) — iOS home screen
  - `icon-192.png` + `icon-512.png` — Android PWA
  - `manifest.json` avec name, short_name, theme_color #d4a017, icons array
- Meta tags ajoutés : `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style: black-translucent`, `apple-mobile-web-app-title: FP Romania`

**3. CAF annuelle au lieu de "Profit cumulé 5 ans"**
- Avant : 1 nombre cumulé "761k€ final positif" + sparkline cashflow cumulé
- Maintenant : **Bar chart CAF par an** (Capacité d'AutoFinancement = EBITDA annuel)
  - 5 barres verticales Y1→Y5, couleur green si positif, red si négatif
  - Valeurs inline en labels au-dessus de chaque barre (58k€, 411k€, 535k€, 674k€, 765k€…)
  - Drop-shadow coloré sur chaque barre
  - Animation entry : barres grandissent depuis la baseline (stagger 90ms)
  - **Hero chiffre** : `596k€/an CAF moy. Y2-Y5` (moyenne des années matures, exclut ramp-up Y1)
- Info-tip (?) explique la distinction Y1 (ramp-up) vs Y2-Y5 (structurel)

**Non-régression :**
- Tests 197/197 PASS ✓
- Desktop inchangé

**Fichiers ajoutés :**
- `favicon.png`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`
- `manifest.json`

---

## [v5.3-fluid-nav] — 2026-04-18

### 3 demandes après test iPhone

**1. Fix map freeze pendant le swipe carrousel**
- Bug : en swipe rapide, la carte en fond freeze brièvement (white flash visible sur screenshot de Paul)
- Cause : `flyTo` / `panTo` de Leaflet lancent des animations coûteuses qui se chevauchent
- Fix 1 : **pre-warm tile cache** au boot — `fitBounds` instantané autour des 5 sites pour forcer le chargement des tiles, puis restauration de la vue. Les tiles sont en cache → plus de lag.
- Fix 2 : **setView(animate:false)** pendant le scroll live du carrousel au lieu de flyTo. Zéro animation Leaflet = zéro freeze. Un `panTo` très court (300ms) est joué à la fin du settle pour polish.
- Fix 3 : `getAllSites()` utilisé partout au lieu de `TARGETS` direct.

**2. Centralisation "Mes sites" = TARGETS + custom sites**
- Avant : seuls les 5 TARGETS apparaissaient dans le carrousel + pins map
- Maintenant : `getAllSites()` merge TARGETS canoniques + `fpCustomSites` de localStorage
  - Carrousel montre tous (cards sans distinction)
  - Pins map : **TARGETS en gold**, **custom sites en violet** (fp-custom-pin)
  - Pin violet a sa propre animation pulse (`fpPinPulsePurple`)
- API publique `window._fpMobileRefreshSites()` : à appeler après ajout/retrait d'un custom site → renderCarousel + rebuild pins

**3. Navigation detail view plus naturelle**
- **Nav bar prev/next** dans le detail view :
  - Boutons `← Site précédent` / `Site suivant →` qui montrent le nom du site adjacent
  - Tap = switch in-place du detail (haptic + pan map instant + refresh accordions)
- **Swipe horizontal** sur le detail :
  - Rubber band pendant le drag (0.35 resistance)
  - Guard anti-conflict avec scroll vertical (ratio dominance 1.5)
  - > 60px = switch de site
- Subtitle updated avec "X / N" (1/6, 2/6, etc.)
- Wrap circulaire : dernier site → prev vers premier et inversement

**Non-régression :**
- Tests 197/197 PASS ✓
- Desktop inchangé

---

## [v5.2-polish-fixes] — 2026-04-18

### 3 fixes demandés par Paul après test sur iPhone

**1. Toggle sync dans le FAB secondary sheet**
- Bug : cocher/décocher un layer agissait sur la carte mais le toggle visuel ne changeait pas d'état
- Cause : clone du DOM desktop → IDs dupliqués → `getElementById` retournait le toggle desktop (caché), le clone gardait son état initial
- Fix : `stripAllIds(clone)` avant d'ajouter au DOM + `syncToggleStates(clone)` qui lit l'état global `layers[name]` et met à jour la classe `.on` après chaque click (event delegation)
- Résultat : le toggle s'allume/s'éteint visuellement en sync avec l'état réel

**2. Logo Fitness Park**
- Avant : texte stylisé "FITNESS PARK" en gold
- Après : vraie image logo (PNG base64 embedded dans index.html desktop, réutilisée dans le topbar mobile)
- Code : `qs('.sidebar-header img[alt="Fitness Park"]').src` → copié dans `<img class="fp-logo-img">` du topbar
- CSS : height 28px (24px sur 360px viewport) + drop-shadow

**3. Clarification "761k€ final positif"**
- Avant : affichage "761k€ | final positif" — ambigu pour l'utilisateur
- Après : "Profit cumulé | 761k€ | profit net 5 ans" + **info-tip `?` cliquable** expliquant :
  - Somme flux mensuels (recettes − dépenses − loyer − staff − redevance) après déduction du CAPEX initial (~1.18M€)
  - Positif = rentable sur 5 ans : CAPEX récupéré + profit
  - Négatif = encore en train de rembourser le CAPEX
  - Rappel de ce que signifie "BE Xmo" (breakeven opérationnel)

**Non-régression :**
- Tests 197/197 PASS ✓
- Desktop inchangé

---

## [v5.1-data-storytelling] — 2026-04-18

### Data visualization + gestures + onboarding (axes 4, 5, 9)

**Axe 5 — Data storytelling :**
- **SAZ radial chart** Apple Watch-style : 3 anneaux concentriques animés (Flux cyan / Densité vert / Jeunesse amber)
  - Score central gros chiffre gold qui compte de 0 à la valeur cible (900ms ease-out-cubic)
  - Anneaux : `stroke-dashoffset` animé depuis 360° → % cible (1.2s cascade avec stagger 140ms)
  - Drop-shadow colorée par anneau
  - Légende à droite avec dots glowing
- **Sparkline cashflow 60 mois** dans accordion P&L :
  - SVG path avec gradient area fill
  - Ligne verticale dashed sur le breakeven month avec label
  - End dot coloré (vert si positif, rouge si négatif)
  - Animation stroke-dashoffset reveal (1.2s)
  - Affiche le total final en gros
- **Mini-map concurrents** radar SVG :
  - FP au centre (pulse animation 2s)
  - 3 anneaux de distance (1/2/3 km) dashed
  - Compass "N"
  - Dots concurrents positionnés par bearing lat/lng, taille = captifs, color = segment
  - Drop-shadow colorée sur chaque dot

**Axe 4 — Gesture richness :**
- **Pull-down sur detail view** → retour summary (rubber band effect)
  - Détecte scroll top + touchmove vers le bas
  - Sheet translate avec resistance (dy * 0.6)
  - > 80px = transition vers summary + haptic
- **Double-tap sur la carte** → zoom sur le site cible le plus proche
  - Détection via timestamp (double-tap threshold 320ms)
  - `flyTo` + active site dans carrousel
  - Transition to summary si en peek

**Axe 9 — Onboarding tour :**
- 3 étapes au 1er login avec **spotlight effect** (SVG mask cut-out)
- Tooltip gold-bordered avec :
  - 3 progress dots
  - Title + body + Suivant / Passer
  - Repositioned below or above spotlight selon zone
- Animation `fpTourPop` spring 450ms
- Skippable, stocké dans localStorage `fpSeenTour`

**Fix :**
- `animateNumber` : ajout fallback setTimeout pour garantir la valeur finale quand rAF est throttled (onglets background, environnements headless)

**Non-régression :**
- Tests 197/197 PASS ✓
- Desktop strictement inchangé

**Fichiers modifiés :**
- `mobile.css` : `.fp-tour-overlay`, `.fp-tour-tooltip`, `.fp-tour-spot` (SVG mask), tour animations
- `src/mobile.js` : `sazRadial`, `animateSazRadial`, `buildSparkline`, `animateSparkline`, `buildCompsMiniMap`, `wirePullDownDismiss`, `wireMapDoubleTap`, `showTour`
- `config.js` : MODEL_VERSION v5.1

---

## [v5.0-apple-like] — 2026-04-18

### UX excellence — polish "Apple-like 2026"

**3 demandes explicites Paul :**
- ✅ **Clusters concurrents masqués par défaut mobile** → carte ne montre que les 5 pins FP numérotés (focus total)
- ✅ **Swipe carrousel ↔ map pin sync** → le swipe change aussi le pin actif + `flyTo` la carte (smooth 700ms)
- ✅ **Slider loyer inline dans le detail P&L** → glisse 5-25 €/m² avec affichage live gros chiffre gold + recalcule les 3 scénarios en temps réel (debounce 90ms)

**Micro-interactions haptiques** (axes 1 + 5)
- `navigator.vibrate` sur chaque tap majeur (8-15ms selon action)
- Transitions de state sheet : vibration subtile
- Slider : tick léger par pas
- Carousel scroll settle : vibration après fly-to
- CTAs : vibration forte (15ms) au déclenchement

**Motion design** (axe 3)
- Hero metrics sur detail : **animated number counting** (0→valeur en 700ms ease-out-cubic)
- Recomputation loyer : animation incrémentale des nouveaux chiffres (500ms)
- Accordion items : **stagger entry** (50-400ms, 6 sections en cascade)
- FAB : `scale(0) rotate(-90deg)` en état detail (disparait en rotation)
- Sheet transitions : cubic-bezier spring (.34, 1.56, .64, 1)
- `prefers-reduced-motion` respected

**Profondeur visuelle** (axe 2)
- Active pin : **pulse animation** (`fpPinPulse` 2.2s) + halo radiant
- Verdict pills : **glow match** leur couleur (box-shadow coloré)
- Active site card : radial gradient gold + border glow
- CTAs : shimmer sweep animé (2.4s infinite)
- Cards loading : **shimmer placeholders** sur les valeurs "—"
- FAB + avatar + search pill : spring scale sur tap (.9 / .97)

**Parallax depth** (axe 6)
- Map scale 1 → 0.97 → 0.92 quand sheet peek → summary → detail
- Transform-origin `center 35%` pour que le zoom paraisse naturel
- Transition 500ms cubic-bezier smooth

**Accessibilité**
- `@media (prefers-reduced-motion: reduce)` désactive toutes les animations non-essentielles
- Fingerprint auth retiré `screen.width` (v4.9 fix)

**Impact visible :**
- Carte mobile montre UNIQUEMENT les 5 pins FP (plus 40 clusters jaunes qui obscurcissaient)
- Swipe carousel = la carte suit (effet wow Google Maps style)
- Le slider permet de tester 5→25 €/m² en 1 seconde et voir l'IRR changer de +8% à +76%
- Chaque tap a un feedback kinesthésique (vibration + scale)
- Les chiffres s'animent (plus premium que flash statique)

**Non-régression:**
- Tests 197/197 PASS ✓
- Desktop strictement inchangé

**Fichiers modifiés :**
- `mobile.css` (21KB) — spring vars, pulse keyframes, shimmer, parallax, verdict glows
- `src/mobile.js` (32KB) — haptic helper, live pin update, rent slider + recompute, animated counters, map flyTo sync
- `config.js` — MODEL_VERSION bump

---

## [v4.9-mobile-excellence] — 2026-04-18

### Mobile — refonte complète "Site Browser"
Remplace la v4.7 qui était un emballage mobile sur paradigmes desktop. Nouveau pattern inspiré d'Airbnb / Apple Maps.

**3 états de l'interface (bottom sheet):**
- **PEEK (168px)** : handle + carrousel horizontal des 5 sites cibles — swipe pour parcourir
- **SUMMARY (58vh)** : focus sur le site sélectionné, **4 hero metrics** (Membres / IRR / NPV / SAZ) + CTA "Voir l'analyse complète"
- **DETAIL (100dvh-72px)** : back button + **6 accordions** (Localisation / SAZ / Démographie / Sources / P&L / Concurrents) avec hints visibles en fermé

**Nouveautés visuelles:**
- **Pins numérotés 1-5** blancs sur la carte pour les sites cibles (se distinguent des clusters concurrents jaunes)
- **Carrousel de cards** avec scroll-snap, active card stylisée (border gold + glow)
- **Verdict pills colorés** (GO vert, GO COND turquoise, WATCH orange, NO-GO rouge)
- **Typography hiérarchique** : métriques 22-26px bold, labels 10px uppercase
- **FAB bottom-right** (☰) → secondary sheet avec 4 pills (Couches / Concurrence / Mes sites / Dashboard) — reprend le contenu des tabs desktop sans les encombrer sur mobile
- **Search overlay plein écran** quand tap sur la pill de recherche
- **Onboarding hint** au 1er login : "Glisse pour explorer les sites" (disparaît après 4.5s, stocké localStorage)

**Animations:**
- Transitions sheet `cubic-bezier(.22,.8,.28,1)` 420ms
- Carousel swipe natif avec scroll-snap CSS
- Cards active: `transform: scale(.985)` au tap
- Accordion chevron rotation 250ms
- Detail metric cards fade-in subtle

**Data flow sur mobile:**
- Auto-analyse des 5 TARGETS au premier login (staggered 300ms each)
- Cache des résultats dans `analyses[]` (évite re-calcul au swipe)
- Tap d'un pin map → active site dans carrousel + flyTo carte + snap to summary
- Tap d'une card → snap to summary si site déjà actif, sinon activate

**Viewports testés:**
- 320×568 (iPhone SE 1st gen) ✓
- 375×812 (iPhone X/11/12/13) ✓
- 414×896 (iPhone Plus/Max) ✓
- 768×1024 (iPad portrait) ✓
- 1280×800 (desktop) ✓ **strictement identique**

**Non-régression:**
- Tests 197/197 PASS ✓
- Desktop (> 768px) zéro DOM ajouté (hide via `@media (min-width: 769px)`)

**Fichiers modifiés:**
- `mobile.css` (17KB) — patterns `.fp-sheet`, `.fp-site-card`, `.fp-accordion`, etc. (préfixe `.fp-` pour éviter collisions)
- `src/mobile.js` (24KB) — carousel + state machine + detail accordion + FAB + onboarding
- `index.html` — expose `window._fpMap` pour que mobile.js accède à l'instance Leaflet (correction bug: `window.map` est le `<div id="map">`, pas la map)
- `src/auth-guard.js` — fingerprint stabilisé (retrait de `screen.width` → évite faux tamper au resize)

**Architecture:**
```
PEEK              SUMMARY            DETAIL
─────             ─────              ─────
Map (full)        Map (top 20%)      Map (top 8%)
↓                 ↓                  ↓
Carousel      →   Site card (active) Active card (pinned)
[1][2][3][4][5]   + CTA              + 4 hero metrics
                                     + 6 accordions
FAB ☰
```

**Debug tools (console):**
```js
window._fpMobile.transitionTo('summary')    // force state change
window._fpMobile.activateSite(2, true)      // activate site 3 + flyTo
window._fpMobile.ensureAnalysis(1)          // recompute analysis
```

### Auth-guard fix
- Session fingerprint enlève `window.screen.width` → stable au resize/rotation
- Runtime tamper check passe à 60s avec tolérance 2 échecs consécutifs (évite les faux positifs)

---

## [v4.8-reliability] — 2026-04-18

### Reliability hardening — couche défensive complète

**Nouveau : moteur d'invariants runtime** (`src/invariants.js`)
- 10 invariants machine-checked après chaque `runCaptageAnalysis()`
- Vérifie : somme(captifs+natifs+walkIn+destBonus) == totalTheorique, no-NaN, bornes SAZ, bornes ARPU/churn/IRR, coords valides
- Violations loguées dans `window._fpIssues` + événement `fp:invariant-violation`
- `window.dumpInvariants()` pour pretty-print

**Nouveau : data schema validators** (`src/validators.js`)
- Validation au boot de TARGETS, VERIFIED_CLUBS, CARTIERE, POIS, CANONICAL_USERS
- Détecte : champs manquants, valeurs hors-range, doublons de noms
- Mode strict opt-in via `window._fpStrictValidation = true` (CI)
- `window.dumpValidation()` pour inspecter
- **Corrigé** : 3 vrais duplicates révélés par le validator (WC Cosmopolis, WC Otopeni, Progresul)

**Nouveau : audit log** (`src/audit.js`)
- Chaque appel à `runCaptageAnalysis` enregistre inputs + outputs + timestamp + user
- 100 dernières entrées en sessionStorage
- API : `exportAudit()` (JSON), `exportAuditCsv()` (CSV), `replayAudit(entry)` (reproductibilité)
- Permet le debug post-mortem et le test de non-régression inter-deploys

**Nouveau : auth hardening** (`src/auth-guard.js`)
- Rate limiting : 5 échecs → lockout 5 min
- Signature HMAC de `fpUsers` → détecte altération localStorage + reset auto
- Signature de session liée au fingerprint (userAgent + locale + screen) → détecte copy-paste de session
- Check périodique de la signature session (30s)
- Log d'événements : `window._fpAuthEvents`, `window.dumpAuth()`

**Nouveau : suite de tests étendue** (`tests/analysis.html`)
- **197 assertions** (vs 95 dans test.html — déprécié)
- 10 groupes : baseline regression, invariants, bornes numériques, monotonicité scénarios, monotonicité rayon, sensibilité loyer, edge cases (sea/tiny radius), subsystèmes installés
- **197/197 PASS** ✓

**Nouveau : golden numbers doc** (`docs/MODEL.md`)
- Chaque constante du modèle documentée : valeur, source, justification, date de calibration
- Inclut : CAPTURE_RATES, distance decay, walk-in 0.7%/1.0%, destination mall 10km/0.4%, POP_REAL_FACTOR 1.3, REVIEWS_ANNUAL_MULT 43, TAUX_VAD 20%, TVA_RO 21%, CAPEX 1,176k€, etc.
- Playbook "how to modify a constant" avec checklist (bump version → run tests → update baseline)

### Data fixes révélés par les validators
- `VERIFIED_CLUBS` : renommé "World Class Cosmopolis" banlieue → "World Class Cosmopolis (Ilfov)"
- `VERIFIED_CLUBS` : renommé "World Class Otopeni" duplicate → "World Class Otopeni (alt)"
- `CARTIERE` : renommé "Progresul" (sector 4) → "Progresul (S4)" pour distinguer du Progresul sector 5

### Scripts chargés à l'init (dans l'ordre)
```
config.js → src/utils.js → data/*.js →
src/validators.js → src/invariants.js → src/audit.js →
src/auth-guard.js → src/mobile.js
```

**Zero impact utilisateur final** (sauf + robustesse). Toute la couche défensive est transparente.

### Debug cheatsheet (à taper dans la console sur prod)
```js
dumpInvariants()  // violations de règles détectées
dumpValidation()  // problèmes dans les données statiques
dumpAuth()        // état auth + tentatives de login
exportAudit()     // log des analyses (copié dans le presse-papiers)
replayAudit(window._fpAudit.load()[0])  // rejoue une analyse
```

---

## [v4.7-mobile] — 2026-04-18

### Mobile Overhaul (15/10)
Refonte complète du mobile inspirée de Google Maps / Apple Maps / Citymapper.

**Nouveau pattern :**
- **Carte plein écran** (100dvh) comme hero visual
- **Bottom sheet draggable** 3 snap points :
  - `collapsed` (140px) — handle + tabs visibles
  - `mid` (55vh) — pour browsing
  - `full` (vh - 80) — pour analyse détaillée
- **Top bar flottant** compact : search pill + avatar
- **Search overlay plein écran** (tap sur la pill)
- **Fiche site → auto-snap à `full`** quand on clique un site sur la carte
- **Close button** flottant pour fermer la Fiche

**Touch-first :**
- Tap targets ≥ 44px (WCAG)
- Tooltips `.info-tip` → **tap-to-open** (au lieu de hover)
- Slider loyer : thumb 28px + track 6px
- Toggles : 44×26px avec dot 20px
- `touch-action: manipulation` pour éviter double-tap zoom

**Responsive breakpoints :**
- ≤ 768px → layout mobile (bottom sheet)
- ≤ 414px → compact (plus petit, plus dense)
- ≤ 360px → ultra-compact (iPhone SE, vieux Androids)
- Paysage ≤ 500px haut → sheet collapsed à 80px

**Gestion safe-area :**
- `env(safe-area-inset-top/bottom)` respectée partout
- `100dvh` (dynamic viewport) pour éviter le bug barre d'URL mobile

**Fichiers ajoutés :**
- `mobile.css` (14KB) — toute la feuille responsive
- `src/mobile.js` (11KB) — drag sheet, tooltips tap, search overlay

**Desktop :** strictement identique à v3.1. Les éléments mobiles sont hidden via `@media (min-width: 769px)`.

**Verification :**
- Tests visuels sur 320, 375, 414, 768, 1280px ✓
- `test.html` : **95/95 cells PASS** (zero régression calcul) ✓

---

## [v3.1-refactor] — 2026-04-18

### Architecture
- **Extraction modulaire** : les datasets les plus édités sont maintenant dans des fichiers séparés :
  - `data/targets.js` — 5 sites d'expansion
  - `data/clubs.js` — 92 concurrents vérifiés (+ alias `DEMO_COMPS`)
  - `data/cartiere.js` — 83 quartiers
  - `data/pois.js` — 37 POIs (universités, malls, bureaux)
  - `data/users.js` — utilisateurs autorisés
- **Centralisation des constantes** : `config.js` concentre la clé Google API, endpoints OSM, `MODEL_VERSION`.
- **Utilitaires** : `src/utils.js` expose `simpleHash`, `haversine`, `fmt`.
- **index.html** passe de 7122 à 6860 lignes (-3.7%, extraction de 262 lignes de données).

### Qualité
- **Test de régression** : nouveau `test.html` qui compare les valeurs analytiques aux 5 sites cibles vs `.baseline.json`.
- **Documentation** : `README.md` + `docs/ARCHITECTURE.md` + ce changelog.
- **Zero régression** vérifiée : les 95 cellules de métriques clés (members, IRR, NPV, breakeven, scores…) matchent au bit près la baseline pré-refactor.

### Migration
- Users existants auto-migrés au prochain chargement (migration dans cache-buster).
- Aucune action requise côté utilisateur final.

---

## [v3.0-users] — 2026-04

### Users
- Ajout user `tomescumh@yahoo.com` (role: user).
- Nouveau système de migration automatique : tout utilisateur ajouté à `CANONICAL_USERS` est auto-injecté dans les localStorage existants.

---

## [v2.9-destination] — 2026-04

### Modèle
- **Premium mall conversion** : taux walk-in 1.0% (vs 0.7% standard) pour malls >40k visiteurs/jour.
- **Destination mall bonus** : rayon étendu 10km pour malls premium (Baneasa, AFI…) qui attirent une clientèle city-wide.

### Impact chiffré (Baneasa Shopping City)
- Membres : 4,423 → 8,762 (+98%)
- IRR : 3.6% → 50.8%
- Verdict : WATCH → GO CONDITIONNEL

---

## [v2.8] — 2026-04

### Fixes critiques
- **Hala Laminor bug résolu** : le site affichait 35.5 NO-GO avec FLUX 0 malgré v2.3. Cause = custom sites en localStorage avec coordonnées périmées + `analysisData` caché obsolète.
- Cache-buster aggressive : clear `fpSiteAnalyses` + sync coordonnées custom sites avec `TARGETS` par nom-match + clear `opCache` sessionStorage.
- Coordonnées Militari, Grand Arena, Baneasa alignées avec `TRAFFIC_GENERATORS.malls`.

### Données
- Baneasa : visiteurs/jour 30k → 55k (20M/an selon PPTX officiel).
- Ajout de Baneasa Business & Technology Park (12k employés).

---

## [v2.7 et antérieures]
Voir historique Git.
