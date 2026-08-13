# Release PokéTracker

Depuis la Phase 1 (migration Vite), le déploiement est automatique : un `git push` sur la branche
de déploiement suffit, `.github/workflows/deploy.yml` s'occupe du build (`npm run build`) et de la
publication sur GitHub Pages. Il n'y a plus de token de cache-busting (`?v=...`) ni de
`DEPLOY_VERSION` à synchroniser à la main — Vite hash automatiquement les fichiers buildés, et
`scripts/build-sw.js` régénère la liste précachée du Service Worker à partir du vrai manifest de
build à chaque `npm run build` (cf commit "Phase 1 V5").

Il reste une seule version à gérer manuellement : **`APP_VERSION`** (`data/changelog.js`) — la
version que l'utilisateur voit (page `#/changelog`, popup "Nouveautés"). Elle ne change que quand
du contenu utilisateur mérite d'être annoncé, indépendamment de la fréquence des déploiements
techniques.

## Checklist de release

1. **Choisir la version produit** (ex. `1.0.1` / `1.1.0`) — seulement si ce déploiement contient un
   changement à annoncer à l'utilisateur. Un déploiement purement technique peut ne pas bumper
   `APP_VERSION` du tout.

2. **Modifier `APP_VERSION`** dans `data/changelog.js`.

3. **Ajouter l'entrée `CHANGELOG` correspondante** dans `data/changelog.js`, en tête de tableau (le
   plus récent en premier). Le `version` de cette entrée doit être **identique caractère pour
   caractère** à `APP_VERSION` — sinon la popup "Nouveautés" ne trouvera jamais l'entrée et ne
   s'affichera jamais, silencieusement (aucune erreur levée).

4. **Vérifier localement avant de pousser** : `npm run check-release` (build complet + vérification
   que `dist/` contient bien `index.html`/`login.html`/`sw.js`). C'est aussi ce que la CI
   (`release-check.yml`) rejoue automatiquement sur chaque push/PR.

5. **Pousser** (`git push`) — `deploy.yml` build et publie automatiquement sur GitHub Pages.
   Nécessite que **Settings → Pages → Source** soit réglé sur "GitHub Actions" (à faire une fois,
   manuellement, pas par ce workflow).

6. **Tester** :
   - reload en ligne
   - refresh direct sur une route interne (ex. `#/changelog`)
   - popup "Nouveautés" (vider `localStorage.lastSeenChangelogVersion` pour la redéclencher)
   - page `#/changelog`
   - hors ligne, après un premier chargement réussi de la nouvelle version (Service Worker — cf
     DevTools > Application > Service Workers / Cache Storage)

## Développement local

- `npm install` — une fois, installe Vite.
- `npm run dev` — serveur de développement Vite (remplace `npx http-server` pour développer :
  Service Worker désactivé automatiquement en dev, cf `import.meta.env.PROD` dans
  `index.html`/`login.html`).
- `npm run build` — build de production dans `dist/`.
- `npm run preview` — sert `dist/` localement, pour valider un build avant de pousser.

`npx http-server` sur les fichiers source bruts (sans build) reste utilisable pour un test rapide
sans Vite, mais ne reflète pas le Service Worker ni le hashing des assets — préférer `npm run dev`
ou `npm run build && npm run preview` pour un test complet.
