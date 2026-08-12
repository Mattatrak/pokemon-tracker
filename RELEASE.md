# Release PokéTracker

Ce projet distingue **deux versions indépendantes**, qui ne partagent pas de source
commune et ne doivent pas être confondues :

- **Version produit** — `APP_VERSION` (`data/changelog.js`). C'est la version que
  l'utilisateur voit (page `#/changelog`, popup "Nouveautés"). Change uniquement
  quand du contenu utilisateur mérite d'être annoncé.
- **Version déploiement/cache** — `DEPLOY_VERSION` (`sw.js`) + les jetons `?v=...`
  sur chaque `<script>`/`<link>` de `index.html` (et `login.html` s'il en a).
  Sert uniquement au cache-busting du Service Worker. Change à **chaque**
  déploiement qui touche un fichier local, même sans rapport avec le produit
  (typo, refactor, style).

Il n'existe pas de mécanisme qui synchronise ces deux versions automatiquement.
Rien n'empêche par exemple de déployer 3 fois (3 bumps de `DEPLOY_VERSION`) pour
une seule version produit (`APP_VERSION` inchangé). C'est normal.

## Checklist de release

1. **Choisir la version produit** (ex. `1.0.1` / `1.1.0`) — seulement si ce
   déploiement contient un changement à annoncer à l'utilisateur. Un déploiement
   purement technique peut ne pas bumper `APP_VERSION` du tout.

2. **Modifier `APP_VERSION`** dans `data/changelog.js`.

3. **Ajouter l'entrée `CHANGELOG` correspondante** dans `data/changelog.js`,
   en tête de tableau (le plus récent en premier). Le `version` de cette entrée
   doit être **identique caractère pour caractère** à `APP_VERSION` — sinon la
   popup "Nouveautés" ne trouvera jamais l'entrée et ne s'affichera jamais,
   silencieusement (aucune erreur levée).

4. **Bumper `DEPLOY_VERSION`** dans `sw.js` — à chaque déploiement touchant un
   fichier local, que `APP_VERSION` ait changé ou non.

5. **Pour chaque fichier JS/CSS modifié chargé avec `?v=` dans `index.html`** :
   mettre à jour son token de cache-busting dans le `<script src=...?v=...>` ou
   `<link href=...?v=...>` correspondant.

6. **Vérifier que chaque asset listé dans `CORE_ASSETS` (`sw.js`) porte
   EXACTEMENT la même URL (chemin + `?v=`) que celle demandée par `index.html`**
   pour ce même fichier. `sw.js` applique aujourd'hui un jeton unique
   (`DEPLOY_VERSION`) à tous les fichiers de `CORE_ASSETS`, alors que
   `index.html` porte des jetons potentiellement différents par fichier —
   **rien ne garantit automatiquement cette correspondance**, elle doit être
   vérifiée à la main à chaque release. Un décalage ne casse rien tant que
   l'utilisateur est en ligne (le Service Worker retombe sur le réseau), mais
   peut faire échouer le chargement du fichier concerné lors d'un premier accès
   hors ligne après déploiement.

7. **Vérifier la syntaxe** des fichiers modifiés (`node --check <fichier>.js`
   pour le JS).

8. **Déployer.**

9. **Tester** :
   - reload en ligne
   - refresh direct sur une route interne (ex. `#/changelog`)
   - popup "Nouveautés" (vider `localStorage.lastSeenChangelogVersion` pour la
     redéclencher)
   - page `#/changelog`
   - hors ligne, après un premier chargement réussi de la nouvelle version
