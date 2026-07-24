# Changelog

## Art Director Pass : Navigation Desktop Premium

Ajustements visuels subtils pour retrouver la sensation de navigation "suspendue" dans le Hero.

- **Navigation descendue** : groupe central et actions à droite décalés de 8px vers le bas (margin-top) tandis que le logo reste centré verticalement — crée une hiérarchie visuelle où le logo devient la signature du header et la navigation flotte dans le décor (`styles.css`).
- **Logo agrandi** : largeur/hauteur de 24px → 28px (+16.7%, arrondi grille 4px) pour mieux équilibrer la composition gauche-droite (`styles.css`).
- **Actions rapprochées** : gap entre les boutons Rechercher/Ajouter/Profil réduit de 1rem (16px) à 12px pour les percevoir comme un ensemble cohérent avec la navigation centrale (`styles.css`).

Tous les changements respectent la grille Design System (8px, 12px, 28px multiples de 4px). Aucune modification de hauteur header, responsive, logique ou composants — composition uniquement.

## Fix : Hover navbar — rectangle orange non-conforme

Sélecteur global `button:hover { background: var(--gold-hover); }` appliquait un background doré à TOUS les boutons, y compris les links de navigation navbar → rectangle orange visible au hover, non-conforme à la charte discrète du site.

- **Override spécifique nav links** : ajout `.dashboard-integrated-nav-link:hover { background: none !important; }` pour annuler le background doré sur les liens de navigation, garde juste le changement de couleur texte (`styles.css`).
- **Focus-visible neutre** : ajout `.dashboard-integrated-nav-link:focus-visible { outline: none; }` pour retirer l'outline doré au focus clavier, cohérent avec l'absence de background (`styles.css`).
- **Cache CSS forcé** : timestamp CSS mis à jour dans `index.html` (2026-07-24-0110 → 2026-07-24-0120) pour forcer rechargement du CSS depuis le navigateur (`index.html`).

Résultat : hover navbar discret (texte doré uniquement), conforme charte Design System.

## Sprint 1 Collection : Polish et restructuration UI

Refonte légère de la page Ma Collection pour améliorer lisibilité et réduire encombrement des contrôles.

- **Résumé des résultats** : ligne discrète entre toolbar et grille affichant nombre de cartes/valeur/tri appliqué, avec formatage français (12px espacement, couleurs hiérarchisées) (`index.html`, `modules/collection.js`, `styles.css`).
- **Réorganisation toolbar secondaire** : galerie/tableau, filtres raretés et tri/données organisés en 3 groupes via `display: grid; grid-template-columns: auto 1fr auto`, avec gap 24px (desktop), 16px (tablette à 1100px), empilés en colonne (mobile < 700px) (`index.html`, `styles.css`).
- **Optimisation espacements verticaux** : réduits selon grille Design System (recherche→filtres: 12px, filtres→toolbar: 16px, toolbar→résumé: 12px, résumé→grille: 16px), gain approx. 28px en hauteur visible sans compression (`styles.css`).
- **Augmentation gaps grille** : colonne 26px (+2px), ligne 28px (+4px) pour respiration cartes sans densité réduite (minmax 190px inchangé) (`styles.css`).
- **Polish hover cartes** : `translateY(-3px)` fluide (ease-out 180ms), ombre neutre sans glow doré, badge prix 12% plus lumineux via `filter: brightness(1.12)`, cohérent Design System (`styles.css`).

Aucun changement fonctionnel — polish et réorg visuelle uniquement.

## Refonte : Hero Engine du Dashboard

Redesign complet du composant Hero card avec fonds thématisés par type Pokémon et amélioration visuelle/lisibilité.

- **Fonds thématisés par type** : 8 images de fond ajoutées (`images/electrique.png`, `feu.png`, `eau.png`, `plante.png`, `psy.png`, `tenebre.png`, `dragon.png`, `normal.png`) avec gradient overlay progressif pour lisibilité du texte (`styles.css`).
- **Panneau de contraste glassmorphe** : fond semi-transparent derrière les infos carte (droite) avec `backdrop-filter: blur(6px)` (mobile: `none`), dégradé `rgba(12,18,28,0.66) → rgba(12,18,28,0.38)`, ombres multiples et `border-radius: 16px` pour cohérence premium (`styles.css`).
- **Centrage vertical de la carte** : carte (image + drop-shadows) centrée en hauteur sans déplacer le texte via transforms compensatoires sur `.dashboard-hero-card-stage` et `.dashboard-hero-card-img-wrap` (`styles.css`).
- **Animation de rebond restaurée** : `animation: dashboard-hero-float 6s ease-in-out infinite` rétablie sur la carte (mouvements de 5px en hauteur), bloquée au hover avec `animation: none !important` (`styles.css`).
- **Profondeur sans bordure** : bordure supprimée, remplacée par ombres inset multiples — highlight blanc (0.14) en haut + ombre noire (0.25, blur 16px) pour créer relief 3D. Combine effet concave (inset) + separation (ombres externes) (`styles.css`).
- **Amélioration typographie** : `text-shadow: 0 2px 4px rgba(0,0,0,0.30)` ajouté sur tous les labels/noms/valeurs pour lisibilité sur backgrounds lumineux, ombre or renforcée sur la valeur marchande (`styles.css`).

## Fix : zone blanche au bord de l'écran sur mobile (rebond iOS Safari)

Sur mobile, glisser sur les côtés révélait une bande blanche au lieu du fond du site. `<html>` n'avait pas de couleur de fond (seul `<body>` en avait une) — pendant le rebond élastique de Safari iOS au-delà du contenu, c'est le fond par défaut du navigateur (blanc) qui apparaît. Ajout de `background: var(--bg)` sur `html`, plus `overflow-x: hidden` sur `html` et `body` en sécurité contre tout débordement horizontal (`styles.css`).

## Feat : édition en masse sur la vue Tableau de la collection

- **Sélection multiple** : case à cocher par ligne + case "tout sélectionner" dans l'en-tête, sur la vue Tableau de l'onglet Ma Collection (`index.html`, `modules/collection.js`).
- **Barre d'actions groupées** apparaît dès qu'au moins une carte est sélectionnée : compteur, changement d'état groupé (NM/LP/MP/HP), suppression groupée avec confirmation (`modules/collection.js`, `styles.css`).
- Une seule requête Supabase par action (`update().in('id', [...])` / `delete().in('id', [...])`), pas une par carte.
- La sélection repart à zéro à chaque changement de recherche/filtre/tri/vue, pour éviter d'agir sur des cartes qu'on ne voit plus.

## Amélioration : contraste, focus clavier, responsive et lisibilité

Corrections issues d'un audit visuel/UX complet du site.

- **Contraste panels/fond** : `--panel` et `--panel-light` éclaircis (`#1B2233`→`#212A44`, `#232B42`→`#293356`) pour que les blocs (stats, filtres, cartes) se détachent du fond au lieu de se fondre dedans (`styles.css`).
- **Focus clavier visible** : ajout d'une règle globale `:focus-visible` (anneau or, décalé de 2px) sur tous les éléments interactifs — jusqu'ici seuls les champs de formulaire avaient un style de focus (`styles.css`).
- **Largeur max augmentée** : `.container` passe de `1200px` à `1440px`, la grille de collection exploite mieux les grands écrans (6 colonnes au lieu de 5 sur un 1920px) (`styles.css`).
- **Header allégé** : `padding` réduit de `4rem` à `2.5rem` (desktop) et `1.75rem` sur mobile — stats et onglets visibles sans scroll à l'ouverture (`styles.css`).
- **Barre d'outils collection sur écran moyen** : `.view-toggle-row` gardait un `justify-content: space-between` hérité du desktop entre 769px et 1024px, créant un vide énorme entre le tri et le bouton "Données". Ajout d'un breakpoint dédié (`styles.css`).
- **Police du corps de texte** : ajout d'Inter (Google Fonts) à la place de la police système par défaut, cohérent avec Bebas Neue déjà utilisée sur les titres (`index.html`, `login.html`, `styles.css`).
- **Placeholder des champs plus lisible** : couleur `--slate` (ratio de contraste 4.6:1 sur le nouveau fond de panel, sous le seuil recommandé) remplacée par `#9CA5B8` (5.7:1) (`styles.css`).
- **Graphique "Top séries" en échelle logarithmique** : une seule série (Héros Transcendants, 214 cartes) écrasait l'échelle linéaire et rendait les 7 autres illisibles (barres de 2px). Passage en échelle log pour pouvoir comparer les petites séries entre elles (`modules/stats-render.js`).

## Refonte : onglet Ajouter, header, stats et upload d'image de carte

- **Header** : logo remplacé par `images/poke-tracker.png` (agrandi, aligné à gauche dans la bannière avec le titre sur 2 lignes).
- **Stats globales** déplacées au-dessus des onglets (juste sous la bannière), refondues en 3 cartes avec icônes (`images/total-cartes.png`, `total-valeur.png`, `total-achat.png`), glow radial coloré par carte (violet/or/teal) et bordure gauche lumineuse assortie. La carte "Valeur totale" garde son sparkline et sa fluctuation 24h.
- **Onglet Ajouter fusionné** : la carte "aperçu" et le formulaire "Ajouter à ma collection" ne font plus qu'un (image à gauche, infos + champs à droite). Carte recherche avec décor `images/goldpokeball.png` en fond, résultats limités à 540px avec fond semi-transparent + flou, prix CardMarket affiché sur chaque résultat.
- **Bloc "Conseil"** ajouté sous les boutons d'ajout, avec icône `images/detective_pikachupng.png`.
- **Bouton "Rafraîchir les prix"** déplacé dans la barre d'onglets (aligné à droite), réduit à une icône ; le texte "Dernière mise à jour" simplifié pour n'afficher que la date/heure.
- **Fix** (`tracker.js`) : `refreshAllMarketPrices` restaurait le bouton via `textContent` après le compteur de progression, ce qui faisait disparaître l'icône — remplacé par `innerHTML`.

## Feat : pagination "Charger plus" sur la collection, purge auto de l'historique, alertes de refresh

- **Pagination "Charger plus"** sur l'onglet Ma Collection (grille et tableau) : 60 cartes affichées par page, bouton "Charger plus (N restantes)" pour la suite. Toute recherche/filtre/tri/changement de vue repart de la page 1 (`modules/collection.js`, `index.html`, `styles.css`).
- **Purge automatique de l'historique des prix** : `card_price_history` et `value_history` ne gardaient jamais rien, croissance illimitée (déjà ~15 000 lignes). Purge des points de plus de 35 jours à chaque rafraîchissement de prix — marge au-delà des 30 jours utilisés par les stats (`tracker.js`, fonction `purgeOldPriceHistory`).
- **Détail des variations en €** (au lieu du %) dans la modale "Plus grosses variations (24h)", triée par hausse/baisse en euros plutôt que par pourcentage — plus parlant pour repérer les cartes qui bougent vraiment (`modules/stats.js`).
- **Visibilité sur les échecs de rafraîchissement** : si des cartes échouent à récupérer leur prix TCGdex pendant un refresh, le message de fin l'indique désormais (`X cartes en échec, voir la console`) au lieu d'échouer silencieusement (`tracker.js`).

## Fix : warning Chart.js sur le graphique "Top séries" + nouvelle image de header

- **Fix warning console Chart.js** : le graphique "Top séries (par nombre de cartes)" forçait `ticks.stepSize: 1` sur l'axe X, ce qui demandait à Chart.js de générer une graduation par carte (jusqu'à 1289 sur une grosse collection) — plafonné à 1000 avec un warning en boucle. Remplacé par `ticks.precision: 0` : graduations entières mais espacement choisi automatiquement (`modules/stats-render.js`).
- **Nouvelle image de header** (`images/background-header.png`) remplace `images/header-banner.webp` dans `styles.css`. L'ancien fichier n'est plus référencé nulle part.

## Feat : détail des variations 24h, rafraîchissement auto des prix, favicon, thème des toasts

- **Fix fluctuation 24h** : le calcul de `+X€ (24h)` de la hero card interrogeait `value_history` triée par ordre chronologique croissant avec `limit(200)` — sur une collection avec plus de 200 snapshots, ça récupérait les 200 plus **vieux** points au lieu des plus récents, faussant complètement le calcul (`modules/stats.js`). Tri inversé + remis en ordre en JS.
- **Nouvelle modale "Plus grosses variations (24h)"** : clic sur toute la hero card (`.hero-value-card`, pas juste le texte de fluctuation) ouvre le détail des 10 cartes ayant le plus varié en % sur 24h, prix actuel affiché en gris avant le %. Basé sur `card_price_history` (déjà alimentée par `refreshAllMarketPrices`), même logique de recherche de point de référence que la fluctuation globale. Nouvelle modale `#top-movers-overlay` dans `index.html`, logique dans `modules/stats.js`.
- **Rafraîchissement auto des prix à la connexion** : `init()` (`modules/auth.js`) déclenche `refreshAllMarketPrices()` en tâche de fond (non bloquant) si le dernier rafraîchissement date de plus de 24h ou n'a jamais eu lieu — évite de le refaire à chaque simple reconnexion/rechargement.
- **Favicon** : ajout de `<link rel="icon">` sur `index.html` et `login.html` (404 navigateur sur `/favicon.ico` corrigée).
- **Thème des messages toast** (`.message.success` / `.message.error`) : remplacement des couleurs Bootstrap par défaut (vert/rouge pastel) par la palette du site (or/rouge doux sur fond navy), cohérent avec le reste de l'UI.

## Feat : mot de passe oublié, inscription et "se souvenir de moi"

Les 3 éléments de `login.html` qui n'avaient aucun effet (checkbox, lien mot de passe oublié, lien inscription) sont maintenant fonctionnels.

- **Inscription** : nouvelle vue `#signup-view` sur `login.html` (email + mot de passe + confirmation), appelle `supabaseClient.auth.signUp()`. Confirmation par e-mail requise avant connexion (comportement par défaut Supabase) ; si la confirmation email est désactivée côté dashboard, redirection directe vers `index.html`.
- **Mot de passe oublié** : nouvelle vue `#forgot-view`, appelle `supabaseClient.auth.resetPasswordForEmail()`. Le lien reçu par e-mail ramène sur `login.html`, qui détecte l'event Supabase `PASSWORD_RECOVERY` et bascule automatiquement sur une 4e vue `#reset-view` pour saisir le nouveau mot de passe (`supabaseClient.auth.updateUser()`).
- **Se souvenir de moi** : nouvel adaptateur de storage personnalisé (`rememberAwareStorage` dans `tracker.js`) qui route la session Supabase vers `localStorage` (coché, persiste après fermeture du navigateur) ou `sessionStorage` (décoché, perdue à la fermeture). Flag `poketracker-remember-me` écrit par `modules/auth-login.js` avant chaque connexion.
- Pas de nouvelle page HTML : tout se passe dans `login.html` via un système de 4 vues togglées en JS, sur le même principe que `switchTab` dans `tracker.js`.

**A savoir / dépendances externes (dashboard Supabase, pas dans ce repo)** :
- Le service d'e-mail intégré de Supabase (sans SMTP custom) limite fort l'envoi — environ 2 à 4 e-mails/heure sur la configuration par défaut. Suffisant pour un usage perso, mais un pic de tests ou d'inscriptions fera remonter une erreur `over_email_send_rate_limit`. Pour lever la limite : configurer un SMTP custom (Resend, SendGrid...) dans Authentication → Emails, ou désactiver "Confirm email" dans Authentication → Providers → Email si la confirmation n'est pas nécessaire.
- `resetPasswordForEmail` nécessite que l'URL de redirection (`login.html`) soit autorisée dans Authentication → URL Configuration → Redirect URLs du dashboard Supabase.

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
