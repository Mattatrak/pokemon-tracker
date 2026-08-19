# Roadmap — Polish mobile (visuel + technique)

> Branche : `feat/mobile-experience-polish`
> Origine : session du 2026-08-19, suite à l'audit visuel mobile et aux micro-animations
> (sceau de série, étoile favori) déjà livrées sur `poke-trackerV2`.

Sept chantiers retenus parmi les pistes proposées lors de l'audit. Pas de bug à corriger ici —
uniquement de l'amélioration : rendre l'app plus agréable et plus rapide sans rien casser.

---

## Ordre proposé

1. Centraliser le formatage des prix
2. Vérifier le score PWA / Lighthouse
3. États vides personnalisés
4. Skeleton loading
5. Précharger les images de pagination
6. Vibration haptique
7. Pull-to-refresh natif

Les deux premiers sont des fondations peu risquées (refacto + audit, aucun changement visible
en soi) ; les trois suivants sont des ajouts visuels indépendants les uns des autres ; les deux
derniers touchent au geste tactile mobile, plus sensibles à tester en conditions réelles — traités
en dernier.

---

## 1. Centraliser le formatage des prix

**Constat** : `toFixed(2)` + `€` dupliqué dans au moins 6 fichiers (`card-detail.js`,
`card-grid-renderer.js`, `cards.js`, `collection.js`, `dashboard.js`, `collection-recap.js`), avec
des incohérences virgule/point selon le fichier.

**Scope** : une fonction `formatPrice(value)` unique dans `modules/utils.js`, appelée partout à la
place des `toFixed(2)` locaux. Comportement identique partout après coup (pas de changement visuel
voulu), juste une seule source de vérité.

**Risque** : faible — remplacement mécanique, mais à vérifier visuellement sur chaque page
touchée (le format doit rester identique à l'existant).

---

## 2. Vérifier le score PWA / Lighthouse

**Constat** : pas revisité depuis un moment (manifest, icônes, cache offline).

**Scope** : audit seul dans un premier temps (Lighthouse via Chrome DevTools ou CLI) — lister ce
qui manque ou est mal configuré, sans forcément tout corriger dans la foulée. Sert aussi à vérifier
que le nettoyage des `?v=` de ce soir n'a rien cassé côté service worker.

**Risque** : nul pour l'audit lui-même ; les corrections éventuelles seront scopées au cas par cas
une fois les résultats connus.

---

## 3. États vides personnalisés

**Constat** : la Wishlist a déjà un bel état vide illustré (SVG dédié). Les autres pages ("aucune
carte", recherche sans résultat, collection publique vide...) restent sur un texte générique.

**Scope** : identifier tous les états vides de l'app (Collection, Progression, recherche
Catalogue, Collectionneurs...) et leur appliquer un traitement cohérent avec celui de la Wishlist —
illustration légère + texte engageant, pas juste "Aucun résultat".

**Risque** : faible, purement additif (un état qui ne s'affichait qu'en l'absence de contenu).

---

## 4. Skeleton loading

**Constat** : les grilles (Collection, Catalogue, Progression) et le Dashboard affichent un
spinner ou un vide pendant le chargement, pas de silhouette de contenu.

**Scope** : composant CSS de skeleton réutilisable (blocs pulsants aux dimensions des vraies
cartes/widgets), affiché pendant les chargements réseau identifiés (chargement collection,
recherche catalogue, dashboard au premier rendu).

**Risque** : moyen — touche aux séquences de rendu existantes, à tester soigneusement pour ne pas
réintroduire un scintillement (cf. le fix Souhaits de ce soir : ne jamais rebuild pour rien).

---

## 5. Précharger les images de pagination

**Constat** : en pagination (Collection, Catalogue), les images de la page suivante ne commencent
à charger qu'au clic "Charger plus" / changement de page.

**Scope** : précharger (`<link rel="preload">` ou `Image()` en JS) les images de la page N+1 dès
que la page N est affichée, pour un scroll/pagination plus fluide.

**Risque** : faible, mais à doser (ne pas précharger trop large sur mobile/connexion lente —
prévoir une limite raisonnable, ex. juste la page suivante, pas tout le set).

---

## 6. Vibration haptique

**Constat** : aucun retour haptique actuellement. Évoqué plus tôt dans la session comme piste
"petit détail qui fait l'âme de l'app", aux côtés du sceau/étoile animés déjà livrés.

**Scope** : `navigator.vibrate()` (API Vibration, supportée en PWA Android — **pas iOS Safari**,
donc dégradation silencieuse à prévoir) sur les actions clés : ajout carte, toggle favori.
Vibration courte (10-20ms), jamais intrusive.

**Risque** : faible techniquement, mais impact réel nul sur iPhone (l'appareil de test principal
cette session) — à garder en tête avant d'y passer du temps.

---

## 7. Pull-to-refresh natif

**Constat** : geste PWA standard absent sur Dashboard/Collection.

**Scope** : geste de tir vers le bas en haut de page → indicateur de chargement → refetch des
données (réutilise les fonctions de chargement existantes, `loadWishlists`-like). À restreindre au
haut de page réel (ne pas interférer avec le scroll normal ni avec un carousel horizontal).

**Risque** : moyen-élevé — comportement tactile fin, conflits possibles avec le scroll natif iOS/
Android et les carousels existants (Dernières acquisitions). Le plus délicat des sept, prévoir un
temps de test dédié sur appareil réel.

---

## Définition de "terminé" pour cette roadmap

Comme pour le reste du produit (cf. `05-roadmap.md`) : pas seulement "développé", mais cohérent
visuellement, sans régression de performance, testé sur mobile réel (pas uniquement le simulateur
de dev), et sans avoir réintroduit un scintillement ou un flash déjà corrigé ailleurs dans l'app.
