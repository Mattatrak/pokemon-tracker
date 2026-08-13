#!/usr/bin/env node
// Vérifications minimales avant déploiement (cf RELEASE.md, étapes 6 et 7) :
//   1. Syntaxe valide sur tous les fichiers JS du repo (node --check).
//   2. Cohérence entre les tokens ?v=... référencés par index.html/login.html et la liste précachée
//      CORE_ASSETS de sw.js — un décalage ne casse rien en ligne (Service Worker network-first sur
//      script/style) mais peut faire échouer un premier accès hors ligne juste après déploiement.
// N'empêche aucun déploiement (GitHub Pages sert directement depuis la branche, pas de pipeline de
// build) : sert uniquement à rendre visible, avant de pousser, ce que RELEASE.md demande de vérifier
// à la main aujourd'hui.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let hasError = false;

function fail(msg) {
    console.error(`✖ ${msg}`);
    hasError = true;
}

function ok(msg) {
    console.log(`✔ ${msg}`);
}

// 1. Syntaxe JS ---------------------------------------------------------------------------------

function listJsFiles(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) listJsFiles(full, out);
        else if (entry.name.endsWith('.js')) out.push(full);
    }
    return out;
}

const jsFiles = listJsFiles(ROOT);
let syntaxErrors = 0;
for (const file of jsFiles) {
    try {
        execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    } catch (err) {
        syntaxErrors++;
        fail(`Erreur de syntaxe : ${path.relative(ROOT, file)}`);
        const detail = (err.stderr || err.stdout || '').toString().trim();
        if (detail) console.error(detail.split('\n').slice(0, 5).map(l => `    ${l}`).join('\n'));
    }
}
if (syntaxErrors === 0) ok(`Syntaxe valide sur ${jsFiles.length} fichiers JS`);

// 2. Cohérence des tokens ?v= entre index.html/login.html et sw.js (CORE_ASSETS) ---------------

// Chemins locaux versionnés : modules/**, components/**, css/**, data/**, tracker.js, styles*.css.
// Volontairement étroit (pas de CDN, pas d'images) pour ne matcher que ce que sw.js précache.
const ASSET_PATH_RE = '(?:modules|components|css|data)/[^"\'`?]+\\.(?:js|css)|styles(?:-login)?\\.css|tracker\\.js';

function extractHtmlAssetVersions(htmlPath) {
    const html = fs.readFileSync(htmlPath, 'utf8');
    const re = new RegExp(`(?:src|href)="\\.?/?(${ASSET_PATH_RE})(?:\\?v=([^"]+))?"`, 'g');
    const versions = {};
    let m;
    while ((m = re.exec(html))) {
        versions[m[1]] = m[2] || null;
    }
    return versions;
}

function extractServiceWorkerAssets(swPath) {
    const sw = fs.readFileSync(swPath, 'utf8');
    const deployMatch = sw.match(/DEPLOY_VERSION\s*=\s*'([^']+)'/);
    const deployVersion = deployMatch ? deployMatch[1] : null;

    const coreMatch = sw.match(/CORE_ASSETS\s*=\s*\[([\s\S]*?)\n\];/);
    const assets = {};
    if (coreMatch) {
        const re = new RegExp(`\\.?/?(${ASSET_PATH_RE})(\\?v=\\$\\{DEPLOY_VERSION\\})?`, 'g');
        let m;
        while ((m = re.exec(coreMatch[1]))) {
            assets[m[1]] = m[2] ? deployVersion : null;
        }
    }
    return { deployVersion, assets };
}

const swPath = path.join(ROOT, 'sw.js');
const htmlFiles = ['index.html', 'login.html']
    .map(name => path.join(ROOT, name))
    .filter(p => fs.existsSync(p));

const { assets: swAssets } = extractServiceWorkerAssets(swPath);

// Comparaison fichier HTML par fichier HTML, jamais fusionnée : index.html et login.html peuvent
// légitimement référencer le même module avec des tokens différents (bumpés à des moments différents),
// une fusion écraserait silencieusement l'un des deux et fausserait la comparaison.
let versionMismatches = 0;
for (const htmlPath of htmlFiles) {
    const htmlName = path.basename(htmlPath);
    const htmlVersions = extractHtmlAssetVersions(htmlPath);

    for (const [file, swVersion] of Object.entries(swAssets)) {
        const htmlVersion = htmlVersions[file];
        if (htmlVersion === undefined) continue; // ce fichier HTML ne charge pas cet asset, normal (ex: modules propres à index.html absents de login.html)
        if (htmlVersion !== swVersion) {
            versionMismatches++;
            fail(`Token de version différent pour "${file}" dans ${htmlName} : "?v=${htmlVersion}" vs sw.js (DEPLOY_VERSION) "?v=${swVersion}"`);
        }
    }
}
if (versionMismatches === 0) {
    ok('Tokens de version cohérents entre index.html/login.html et sw.js (CORE_ASSETS)');
} else {
    console.error(`\n${versionMismatches} décalage(s) — ne bloque pas le déploiement (GitHub Pages sert directement`);
    console.error('la branche), mais peut faire échouer le premier accès hors ligne après ce déploiement.');
    console.error('Cf RELEASE.md étape 6.');
}

process.exit(hasError ? 1 : 0);
