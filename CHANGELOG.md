# Changelog

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
