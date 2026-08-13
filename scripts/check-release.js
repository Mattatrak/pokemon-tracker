#!/usr/bin/env node
// Vérification minimale avant déploiement (ticket V7, post-Vite). Avant Vite, ce script vérifiait la
// syntaxe fichier par fichier (node --check) et la cohérence des tokens ?v= entre index.html/login.html
// et sw.js (CORE_ASSETS) — les deux sont devenus sans objet : `vite build` échoue déjà sur une erreur
// de syntaxe/référence (au moins aussi bien que node --check), et il n'y a plus de token manuel à
// vérifier, scripts/build-sw.js régénère CORE_ASSETS depuis le vrai manifest de build (ticket V5).
// Reste : un build qui réussit et qui produit bien les 3 fichiers attendus dans dist/.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

console.log('→ npm run build');
execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });

const expected = ['index.html', 'login.html', 'sw.js'];
const missing = expected.filter(f => !fs.existsSync(path.join(DIST, f)));

if (missing.length > 0) {
    console.error(`✖ Fichier(s) manquant(s) dans dist/ après le build : ${missing.join(', ')}`);
    process.exit(1);
}

console.log(`✔ Build réussi, dist/ contient ${expected.join(', ')}`);
