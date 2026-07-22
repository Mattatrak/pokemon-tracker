# Changelog

## Fix : bugs post-refactoring modulaire (crash login, XSS, cache PWA, date, tabs)

Corrections trouvées lors d'un audit complet du code suite au découpage de `tracker.js` en modules.

- **Crash sur `login.html`** : `initEventListeners()` (`tracker.js`) ciblait des éléments qui n'existent que sur `index.html`, provoquant une erreur JS à chaque chargement de la page de connexion. Appel désormais conditionné à la présence de ces éléments.
- **XSS stockée** : plusieurs champs texte utilisateur (note de carte, nom de liste de souhaits, nom de carte importée par CSV) étaient injectés tels quels via `innerHTML`. Ajout d'un helper `escapeHtml` (`modules/utils.js`) appliqué dans `modules/card-detail.js`, `modules/wishlist.js` et `modules/import-export.js`.
- **Highlight d'onglet cassé** : `switchTab` utilisait `event.target` au lieu de `event.currentTarget` — un clic sur l'icône d'un onglet (au lieu du texte) empêchait le bouton d'apparaître actif.
- **Cache du service worker obsolète** : la liste `CORE_ASSETS` de `sw.js` datait d'avant le découpage en modules et ne précachait aucun fichier de `modules/`, ni `login.html`/`styles-login.css`. Liste mise à jour, `CACHE_NAME` passé en `v3` pour forcer le renouvellement.
- **Ré-initialisation intempestive après connexion** : `onAuthStateChange` (`modules/auth.js`) relançait `init()` (rechargement complet de la collection, des souhaits, des stats et du date picker) à chaque rafraîchissement automatique du token Supabase (~toutes les heures), pas seulement à la connexion. Ajout d'un flag `appInitialized` pour ne l'exécuter qu'une fois par session.
- **Décalage de date dans la fiche d'édition** : la date d'acquisition était ré-affichée via `.toISOString()` (UTC) alors qu'elle est enregistrée en heure locale, pouvant afficher le mauvais jour selon le fuseau horaire. Nouveau helper `toLocalDateInputValue` (`modules/utils.js`) utilisé dans `modules/card-detail.js`.

## Fix : upload d'image sans photo ouvre maintenant la fiche détail

Cliquer sur une carte sans photo (grille ou tableau) ouvrait directement l'explorateur de fichiers, en court-circuitant la fiche détail. Ça ouvre maintenant la fiche détail comme n'importe quelle autre carte ; l'upload se fait depuis une zone dédiée ("Cliquer pour ajouter") à l'intérieur de la modale.

- `getCollectionUploadPlaceholder` (grille/tableau) : clic → `showCardDetail`, ne déclenche plus l'upload direct
- Nouvelle fonction `getModalUploadPlaceholder` (modale uniquement) : conserve l'ancien comportement clic → upload direct, avec un id d'input distinct (`modal-upload-{id}`) pour éviter toute collision avec le placeholder de la grille resté dans le DOM derrière la modale

## Refactoring modulaire de tracker.js

`tracker.js` (4474 lignes) découpé en 11 modules + un core réduit à 724 lignes, regroupés par couplage réel (état partagé et dépendances), pas par simple emplacement dans le fichier d'origine.

- `modules/utils.js` — helpers purs (formatage, redimensionnement d'image, raretés, finitions)
- `modules/storage.js` — upload et vérification d'existence Supabase Storage
- `modules/cards.js` — recherche de carte, aperçu, ajout depuis l'onglet "Ajouter"
- `modules/stats.js` — widget valeur totale (hero card)
- `modules/collection.js` — tri, filtres et rendu de la collection (grille/tableau)
- `modules/import-export.js` — export CSV, sauvegarde/restauration JSON, import CSV en masse
- `modules/card-detail.js` — modale détail/édition d'une carte, graphique de prix
- `modules/ui.js` — modales génériques (remplacent prompt()/confirm() natifs)
- `modules/wishlist.js` — listes de souhaits
- `modules/stats-render.js` — graphiques et KPIs de l'onglet Statistiques
- `modules/progression.js` — navigation par série et ajout rapide
- `modules/auth.js` — authentification, chargé en dernier
- `tracker.js` — état central de la collection, CRUD, rafraîchissement des prix, navigation des onglets, câblage centralisé des écouteurs d'événements

Aucun changement de comportement pour l'utilisateur : refactoring technique uniquement.
