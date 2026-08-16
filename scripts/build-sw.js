#!/usr/bin/env node
// Exécuté après `vite build` (cf package.json) : lit dist/.vite/manifest.json (généré nativement par
// Vite, build.manifest dans vite.config.js) pour connaître les vrais noms de fichiers hashés produits,
// et régénère CACHE_NAME/CORE_ASSETS dans dist/sw.js en conséquence — remplace le bump manuel de
// DEPLOY_VERSION et la resynchronisation à la main de index.html/login.html/sw.js décrits dans
// RELEASE.md (obsolètes depuis Vite). Ne touche à rien d'autre dans sw.js : stratégies de cache,
// event listeners, fetch handler restent exactement ceux écrits dans public/sw.js.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const MANIFEST_PATH = path.join(DIST, '.vite', 'manifest.json');
const SW_PATH = path.join(DIST, 'sw.js');

const START_MARKER = '// ===== AUTO-GENERATED:START =====';
const END_MARKER = '// ===== AUTO-GENERATED:END =====';

// App shell stable, jamais hashé (copié tel quel depuis public/, cf ticket V4) : documents HTML,
// manifeste PWA, icônes référencées uniquement depuis manifest.json/ce fichier (pas par Vite).
const STATIC_CORE_ASSETS = [
    './',
    './index.html',
    './login.html',
    './manifest.json',
    './images/icon-192.png',
    './images/icon-512.png',
    './images/icon-180.png',
    './images/balle.png'
];

function fail(msg) {
    console.error(`✖ build-sw.js : ${msg}`);
    process.exit(1);
}

if (!fs.existsSync(MANIFEST_PATH)) {
    fail(`${path.relative(ROOT, MANIFEST_PATH)} introuvable — build.manifest doit être activé dans vite.config.js et \`vite build\` doit avoir tourné avant ce script.`);
}
if (!fs.existsSync(SW_PATH)) {
    fail(`${path.relative(ROOT, SW_PATH)} introuvable — public/sw.js doit être copié dans dist/ par le build (publicDir).`);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

// Récupère le .file (+ .css[]) d'une entrée du manifest, et de tout ce qu'elle importe statiquement
// (ex: le chunk utils partagé entre index.html et login.html) — pas de récursion profonde nécessaire,
// la structure actuelle du projet (pas d'imports ES entre nos fichiers) ne produit qu'un seul niveau.
function collectHashedFiles(entryKey, seen = new Set()) {
    const entry = manifest[entryKey];
    if (!entry || seen.has(entryKey)) return [];
    seen.add(entryKey);

    const files = [entry.file, ...(entry.css || [])];
    for (const importKey of entry.imports || []) {
        files.push(...collectHashedFiles(importKey, seen));
    }
    return files;
}

const hashedFiles = new Set();
for (const [key, entry] of Object.entries(manifest)) {
    if (!entry.isEntry) continue; // index.html / login.html uniquement, pas les chunks/assets listés à part
    for (const f of collectHashedFiles(key)) hashedFiles.add(f);
}

if (hashedFiles.size === 0) {
    fail('aucune entrée isEntry trouvée dans le manifest Vite — vite.config.js (rollupOptions.input) a-t-il changé ?');
}

const dynamicCoreAssets = [...hashedFiles].sort().map(f => `./${f}`);
const coreAssets = [...STATIC_CORE_ASSETS, ...dynamicCoreAssets];

// CACHE_NAME dérivé du contenu réel du manifest : change automatiquement si et seulement si un fichier
// précaché change (nouveau hash Vite quelque part) — plus besoin de bumper une version à la main.
const cacheHash = crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex').slice(0, 12);
const cacheName = `poketracker-${cacheHash}`;

const generatedBlock = [
    START_MARKER,
    `const CACHE_NAME = ${JSON.stringify(cacheName)};`,
    `const CORE_ASSETS = ${JSON.stringify(coreAssets, null, 4)};`,
    END_MARKER
].join('\n');

const swSource = fs.readFileSync(SW_PATH, 'utf8');
const startIdx = swSource.indexOf(START_MARKER);
const endIdx = swSource.indexOf(END_MARKER);
if (startIdx === -1 || endIdx === -1) {
    fail(`marqueurs ${START_MARKER} / ${END_MARKER} introuvables dans dist/sw.js — public/sw.js a-t-il été modifié sans garder ces marqueurs ?`);
}

const updatedSw = swSource.slice(0, startIdx) + generatedBlock + swSource.slice(endIdx + END_MARKER.length);
fs.writeFileSync(SW_PATH, updatedSw);

console.log(`✔ dist/sw.js régénéré : ${cacheName}, ${coreAssets.length} fichiers précachés (${dynamicCoreAssets.length} hashés + ${STATIC_CORE_ASSETS.length} stables)`);
