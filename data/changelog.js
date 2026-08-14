// Changelog produit - Pokémon Tracker
// Source de vérité unique pour la version affichée à l'utilisateur (page #/changelog, popup "Nouveautés").
// Distinct des jetons techniques DEPLOY_VERSION (sw.js) et ?v=... (index.html), qui servent uniquement au
// cache-busting déploiement et n'ont pas vocation à être vus par l'utilisateur - cf workflow de release
// documenté dans sw.js. Bumper APP_VERSION et ajouter une entrée ici à chaque version publiée.
//
// Types autorisés pour changes[].type : 'new' | 'improved' | 'fixed' | 'fix' | 'security' | 'removed'.
// CHANGELOG est trié du plus récent au plus ancien : toujours insérer les nouvelles versions en tête.

const APP_VERSION = '1.0.1';

const CHANGELOG = [
    {
        version: '1.0.0',
        date: '2026-08-11 21:00',
        title: 'Première version publique',
        changes: [
            { type: 'new', text: 'Gestion complète de la collection : ajout depuis le catalogue TCGdex (recherche par nom, illustrateur, série ou numéro), suivi par état, finition, prix et quantité.' },
            { type: 'new', text: 'Liste de souhaits avec fiche détail dédiée et correspondances automatiques entre wishlist et collection.' },
            { type: 'new', text: 'Suivi de progression par série avec vue détaillée des cartes possédées et manquantes.' },
            { type: 'new', text: 'Statistiques et tableau de bord : valeur de la collection, évolution, cartes favorites.' },
            { type: 'new', text: 'Profils publics et page Collectionneurs pour découvrir et suivre d\'autres utilisateurs.' },
            { type: 'new', text: 'Import/export CSV et JSON de la collection.' },
            { type: 'new', text: 'Page d\'administration pour repérer et corriger les cartes sans image.' },
            { type: 'improved', text: 'Filtres de la page Collection dynamiques et navigation repensée pour mobile.' },
            { type: 'improved', text: 'Interface responsive, optimisée aussi bien sur ordinateur que sur mobile.' },
            { type: 'security', text: 'Isolation complète des données entre comptes (chaque utilisateur ne voit que sa propre collection).' }
        ]
    },

    {
        version: '1.0.1',
        date: '2026-08-12 02:00',
        title: 'Patch correctif mobile',
        changes: [
            { type: 'new', text: 'L\'affichage des résultats d\'une recherche de cartes depuis le menu ajouter s\'ouvre maintenant en mode tableau par défaut sur mobile.' },
            { type: 'fix', text: 'Comportement du scroll lorsqu\'une fenêtre est ouverte.' },
            { type: 'fix', text: 'Correctif alignement de la page wishlist pour mobile.' },
            { type: 'fix', text: 'Correctifs divers sur la page d\'ajout pour mobile.' },
            { type: 'fix', text: 'Correctifs sur le mécanisme de fermeture des fenêtre sur mobile.' },
            { type: 'improved', text: 'Améliorations visuelles de la page collectionneurs pour mobile.' },
            { type: 'improved', text: 'Améliorations visuelles de la page wishlist pour mobile.' },
                    ]
    },

    {
            version: '1.1.0',
            date: '2026-08-12 02:00',
            title: 'Patch correctif mobile',
            changes: [
                { type: 'new', text: 'Affichage des doublons échangeable dans la page collectionneur' },
                { type: 'new', text: 'Vue classeur depuis la collection' },
                { type: 'improved', text: 'Améliorations globale des performances du site.' },
                        ]
        }
];

// ===== Exports window (ticket V2 Vite, type="module") =====
// Les déclarations top-level d'un module ES ne s'attachent plus automatiquement à window
// (contrairement à un <script> classique) : réexport explicite pour que les autres scripts
// (chargés en modules indépendants, sans import/export entre eux, scope global inchangé)
// puissent continuer à référencer ces noms tels quels — y compris depuis des onclick="..."
// inline dans du HTML généré. Liste exhaustive des déclarations top-level de ce fichier
// (hors variables déjà passées en window.x = ... directement à leur déclaration, cf audit
// du 2026-08-14 sur l'état mutable partagé entre fichiers).
window.APP_VERSION = APP_VERSION;
window.CHANGELOG = CHANGELOG;
