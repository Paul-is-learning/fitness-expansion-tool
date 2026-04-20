# Cloud Sync Setup — 2 clicks (Vercel KV)

> **Pour quoi** : sync automatique des sites custom (`fpCustomSites`) entre tous tes devices (Mac Safari, iPhone Safari, etc.). Sans ça, le code retombe en mode "local seul" + l'export/import URL manuel.

> **Coût** : gratuit (Vercel KV Hobby tier — 30 000 commandes / mois, large pour notre use case ~5 users × ~20 sites).

> **Temps total** : ~3 minutes.

---

## Étape 1 — Créer le KV store Vercel (1 click)

1. Va sur https://vercel.com/dashboard
2. Sélectionne le projet `fitness-expansion-tool`
3. Onglet **Storage** (en haut)
4. Bouton **Create Database** → choisis **KV** (Redis)
5. Nom suggéré : `fp-romania-sync` · Region : `Frankfurt (fra1)` ou la plus proche
6. **Connect to Project** → coche `fitness-expansion-tool` + environnement `Production`

Vercel injecte automatiquement les variables d'environnement nécessaires :
- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`
- `KV_REST_API_READ_ONLY_TOKEN` (non utilisé par notre code)

## Étape 2 — Redéployer (1 click)

1. Onglet **Deployments**
2. Sur le dernier deployment → menu `…` → **Redeploy**
3. Attendre ~30s

## Étape 3 — Vérifier

1. Ouvre `https://fitnesspark.isseo-dev.com`
2. Login (paulbecaud@isseo-dev.com)
3. Onglet **Mes sites** → le badge à droite du titre devrait passer à **☁ Synchronisé** (vert)

Si ça reste en **☁ Local seul** (orange) :
- Ouvre devtools → onglet Network → recharge → cherche `/api/sync` (GET)
- Si la réponse est `503 KV_NOT_CONFIGURED` → étape 1 incomplète (KV pas connecté à ce projet/env)
- Si la réponse est `403 FORBIDDEN_USER` → ton email n'est pas dans la whitelist `ALLOWED_USERS` (cf. `api/sync.js`)
- Si autre erreur → check `Vercel → Functions → Logs`

---

## Comportement attendu une fois actif

| Action | Résultat |
|---|---|
| Login Mac | Pull auto des sites depuis le cloud → fusion avec localStorage Mac |
| Ajout d'un site sur iPhone | Push debounce 0.9s → cloud à jour |
| Ouvrir l'app sur Mac (tab focus) | Pull auto → site iPhone apparaît dans les ~secondes |
| Suppression d'un site | Push immédiat (debounce 0.9s) |
| Polling | Pull automatique toutes les 30s tant que le tab est visible |
| Mode offline (KV down ou pas configuré) | Code retombe sur localStorage seul + bouton "Importer" URL pour fix manuel |

## Sécurité

- Le endpoint `/api/sync` est public (CORS `*`) mais valide une whitelist d'emails côté serveur (`ALLOWED_USERS` dans `api/sync.js`)
- Pour ajouter un user : éditer `api/sync.js` → ajouter dans `ALLOWED_USERS` → push
- Les credentials KV ne sont JAMAIS envoyés au client — uniquement utilisés par la serverless function

## Limitations connues

- **Last-write-wins** au niveau de l'array entier : si Paul ajoute un site sur Mac à 10h00:00 ET sur iPhone à 10h00:01, le push iPhone écrase le push Mac. Risque faible avec debounce 0.9s + polling 30s.
- Pas de versionnement / history. Pour ça, faudrait passer à Postgres ou ajouter un champ `version` côté schema.
- Cap defensive : 500 sites max + 500 KB max par user. Au-delà → 413.
