# Changelog

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
