# SaaS Roadmap — Expansion Intelligence Platform

> Document d'architecture vivant. Décisions actées avec Paul le 2026-07-15
> (12 questions/réponses). À lire avant toute session "optimisation SaaS".

## Décisions actées (Paul, 2026-07-15)

| Axe | Décision |
|---|---|
| Horizon utilisateurs | Multi master-franchisés (multi-tenant, plusieurs pays) |
| Rôles | Admin / Éditeur / Lecteur / Lien de présentation public (read-only, expirable) |
| Modèle de données | Perso + partage explicite (brouillons privés → publication au workspace) |
| Auth | Magic link email (zéro mot de passe), sessions 30 j |
| Budget infra | ~0 €/mois (free tiers) — passage à ~20 €/mois quand 2e pays actif |
| Source de vérité | Serveur (localStorage = cache uniquement) |
| Offline | Lecture seule (PWA) |
| Refactor | Progressif, 197 tests comme filet, app déployable chaque jour |
| CI | Bloquante |
| Langues | FR + EN (existant) |
| Fluidité prioritaire | Mobile ET desktop |

## Architecture cible (phase 2+)

- **DB** : Neon Postgres free tier (0.5 GB, autosuspend avec resume ~500 ms —
  PAS de suppression pour inactivité, contrairement à Upstash free ; garder
  quand même le cron keep-alive quotidien).
- **Schéma** : `users`, `workspaces` (= pays/MF, ex. "FP Romania"),
  `memberships` (user × workspace × role), `sites`, `overrides`, `scenarios`
  (FCF + conquest), `analyses`, `audit_log`, `share_links` (token, scope,
  expiry). Données "perso" = ligne avec `visibility: private|workspace`.
- **Auth** : `/api/auth/request` (envoie le magic link via Resend, free 3k/mois)
  → `/api/auth/verify` (JWT signé, cookie httpOnly SameSite=Lax, 30 j).
  Suppression totale de l'auth localStorage actuelle à la bascule.
- **API** : fonctions Vercel `/api/*` (limite Hobby 12 fonctions → regrouper en
  routeurs : `/api/data` (CRUD), `/api/auth`, `/api/analyst`, `/api/share`).
- **Migration** : script one-shot KV → Postgres (sites/overrides/audit/reviews),
  double-écriture pendant 1 semaine, puis bascule lecture.
- **Client** : `cloud-sync.js` devient un client API générique avec file
  offline (pattern déjà en place dans audit-log.js).

## Phase 0 — Filets (fait le 2026-07-15)

- CI GitHub Actions : les 197 assertions tournent en headless (Playwright)
  à chaque push. Hôtes externes instables bloqués (Overpass, Google) pour
  le déterminisme — les fallbacks du code sont précisément conçus pour ça.
- **Blocage réel des déploiements (étape 2, nécessite une action Paul)** :
  Vercel Hobby ne sait pas conditionner un deploy à la CI. Solution retenue :
  désactiver l'auto-deploy Git dans Vercel et déployer DEPUIS l'Action
  (`vercel deploy --prod`) uniquement si les tests sont verts.
  → Paul : créer un token sur vercel.com/account/tokens et l'ajouter dans
  GitHub → repo Settings → Secrets → `VERCEL_TOKEN`. Ensuite me le dire.

## Phase 1 — Perf boot (fait le 2026-07-15)

- AVANT : `Cache-Control: no-store` sur TOUT → ~850 KB de HTML + ~500 KB de
  scripts re-téléchargés à chaque visite (douloureux en 4G).
- APRÈS : no-store conservé sur `index.html`/`config.js`/`/api/*` (fraîcheur),
  mais `src/`, `data/`, CSS, images → `max-age=300, stale-while-revalidate=604800`
  (repeat loads instantanés, fraîcheur ≤ 5 min après un deploy, zéro build step).
- `preconnect` vers unpkg, jsdelivr, basemaps.cartocdn.com.
- Étape suivante (P3) : extraire l'inline script d'index.html (~700 KB) vers
  des fichiers `src/app-*.js` cacheables → HTML < 100 KB.

## Phase 2 — Backend multi-tenant (2-3 sessions)

Ordre : schéma+DB → auth magic link → API data + rôles → migration KV →
share links → suppression auth localStorage.

## Phase 3 — PWA + extraction monofichier

Service worker (lecture offline des fiches consultées), manifest déjà présent.
Extraction progressive du monofichier (classic scripts, ordre préservé —
le scope lexical global est partagé entre fichiers, sémantique identique).

## Garde-fous permanents

- Les 197 assertions ne sont JAMAIS contournées (protocole MODEL.md pour
  toute dérive de baseline).
- La Référence BP reste verrouillée à travers toutes les phases.
- Chaque phase est déployable indépendamment ; pas de branche longue durée.
