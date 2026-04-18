# Changelog

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
