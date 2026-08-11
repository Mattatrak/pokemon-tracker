// Changelog produit - Pokémon Tracker
// Source de vérité unique pour la version affichée à l'utilisateur (page #/changelog, popup "Nouveautés").
// Distinct des jetons techniques DEPLOY_VERSION (sw.js) et ?v=... (index.html), qui servent uniquement au
// cache-busting déploiement et n'ont pas vocation à être vus par l'utilisateur - cf workflow de release
// documenté dans sw.js. Bumper APP_VERSION et ajouter une entrée ici à chaque version publiée.
//
// Types autorisés pour changes[].type : 'new' | 'improved' | 'fixed' | 'security' | 'removed'.
// CHANGELOG est trié du plus récent au plus ancien : toujours insérer les nouvelles versions en tête.

const APP_VERSION = '1.0.0';

const CHANGELOG = [
    {
        version: '1.0.0',
        date: '2026-08-11',
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
    }
];
