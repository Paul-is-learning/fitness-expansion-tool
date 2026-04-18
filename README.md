# Fitness Park Romania — Expansion Intelligence Platform

> Outil d'analyse territoriale pour l'expansion de Fitness Park en Roumanie.
> Single-page app, déployée sur Vercel.

**🔗 Production :** https://fitnesspark.isseo-dev.com

## Quick start

```bash
# Dev local (Python 3)
python3 -m http.server 8091

# Ouvrir http://localhost:8091/index.html
```

Login admin : `paulbecaud@isseo-dev.com` / `FP2026!`

## Modifier l'outil

| Tâche | Fichier à éditer | Redéploiement ? |
|---|---|---|
| Ajouter/retirer un site cible | `data/targets.js` | `git push` |
| Ajouter/corriger un concurrent | `data/clubs.js` | `git push` |
| Mettre à jour un quartier | `data/cartiere.js` | `git push` |
| Ajouter un mall / université / bureau | `data/pois.js` | `git push` |
| Ajouter un utilisateur | `data/users.js` | `git push` |
| Changer une constante globale | `config.js` | `git push` |
| Modifier le moteur d'analyse | `index.html` (section ANALYSIS) | `git push` |

Le push sur `main` déclenche un redéploiement automatique Vercel (~30s).

## Tester avant de push

Deux niveaux de tests :

**Niveau rapide (5 baselines)** : `http://localhost:8091/test.html`
→ 95 cellules baseline. Pour vérif express.

**Niveau complet (197 assertions)** : `http://localhost:8091/tests/analysis.html`
→ Baselines + invariants + monotonicité + sensitivité + edge cases.
**Utilise celui-là** avant chaque push important.

Tous les points doivent être verts. Un point rouge = régression → ne pas pusher.

## Debug en prod (console)

```js
dumpInvariants()  // violations des règles du modèle (bornes, sommes, etc.)
dumpValidation()  // problèmes dans data/*.js (champs manquants, doublons)
dumpAuth()        // état auth, tentatives de login récentes
exportAudit()     // historique des analyses (copie JSON dans le presse-papiers)
replayAudit(entry)// rejoue une analyse avec les mêmes inputs pour reproduire un bug
```

## Architecture

Voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Changelog

Voir [CHANGELOG.md](CHANGELOG.md).
