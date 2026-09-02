const { resolve } = require('node:path');
const { defineConfig } = require('vite');

// Phase 1 (préparation Vite) — objectif : même PokéTracker avant/après, uniquement build/packaging.
// Voir l'audit de préparation du 2026-08-14 pour le détail des choix ci-dessous. CommonJS (require/
// module.exports) plutôt qu'ESM : cohérent avec "type": "commonjs" du package.json (tout le reste du
// projet), évite l'avertissement Vite sur un fichier .js chargé en CommonJS mais écrit en syntaxe ESM.
module.exports = defineConfig({
    // Base relative : reproduit le comportement actuel (tous les chemins déjà relatifs dans le repo)
    // et fonctionne identiquement en local (servi à la racine) et sur GitHub Pages, qui sert le site
    // sous /pokemon-tracker/ (sous-chemin, pas une racine de domaine). Une base absolue en dur casserait
    // les assets en prod tout en fonctionnant parfaitement en local — le risque le plus critique identifié
    // dans l'audit, évité ici par construction.
    base: './',

    // Fichiers copiés tels quels, jamais hashés/traités : images/, manifest.json, sw.js (référencé par
    // nom exact via navigator.serviceWorker.register('sw.js'), ne doit jamais être renommé). Déplacement
    // physique des fichiers vers public/ fait au ticket V4 — l'ancien images/ à la racine du repo (copie
    // pré-Vite, jamais servie par ce publicDir) a été retiré le 2026-09-01, seul public/images/ existe
    // désormais.
    publicDir: 'public',

    build: {
        // Génère dist/.vite/manifest.json (entrée -> fichier hashé produit), fonctionnalité native de
        // Vite, sans dépendance supplémentaire. Sert de source de vérité au ticket V5 pour regénérer la
        // liste CORE_ASSETS du Service Worker à partir des vrais noms de fichiers buildés.
        manifest: true,

        rollupOptions: {
            // Deux points d'entrée HTML, correspondant aux deux pages réelles de l'app (section 4 de
            // l'audit) : pas de src/main.js à créer, index.html et login.html restent les entrées.
            input: {
                main: resolve(__dirname, 'index.html'),
                login: resolve(__dirname, 'login.html')
            }
        }
    }
});
