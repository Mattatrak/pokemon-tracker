// Sauvegarde du bucket Storage Supabase "card-images" - PokéTracker
// Lecture seule, clé anon uniquement (déjà publique, embarquée dans le JS client de l'app). Le bucket
// est configuré public : list() et download() fonctionnent avec anon sans policy SELECT dédiée sur
// storage.objects (vérifié empiriquement avant d'écrire ce script, racine + sous-dossier tcgdex/).
// Pas de service_role, pas de jeton de compte Supabase - seulement SUPABASE_PROJECT_URL/SUPABASE_ANON_KEY.
//
// Usage : node backup-storage.mjs <bucket> <outputDir>
// Variables d'env requises : SUPABASE_PROJECT_URL, SUPABASE_ANON_KEY

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [, , bucket, outputDir] = process.argv;
const SUPABASE_PROJECT_URL = process.env.SUPABASE_PROJECT_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!bucket || !outputDir) {
    console.error('Usage: node backup-storage.mjs <bucket> <outputDir>');
    process.exit(1);
}
if (!SUPABASE_PROJECT_URL || !SUPABASE_ANON_KEY) {
    console.error('SUPABASE_PROJECT_URL et SUPABASE_ANON_KEY sont requis (variables d\'env).');
    process.exit(1);
}

const LIST_PAGE_SIZE = 1000; // max accepté par l'API Storage Supabase

async function listPage(prefix, offset) {
    const res = await fetch(`${SUPABASE_PROJECT_URL}/storage/v1/object/list/${bucket}`, {
        method: 'POST',
        headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ prefix, limit: LIST_PAGE_SIZE, offset, sortBy: { column: 'name', order: 'asc' } })
    });
    if (!res.ok) {
        throw new Error(`list() a échoué pour le préfixe "${prefix}" (offset ${offset}) : HTTP ${res.status} ${await res.text()}`);
    }
    return res.json();
}

// Un dossier apparaît dans la réponse list() avec id/metadata à null (pas un vrai objet) - on le
// détecte ainsi pour décider de récurser dedans plutôt que de tenter de le télécharger comme fichier.
async function listAllFiles(prefix) {
    const files = [];
    let offset = 0;
    for (;;) {
        const page = await listPage(prefix, offset);
        if (page.length === 0) break;

        for (const entry of page) {
            const fullPath = prefix + entry.name;
            if (entry.id === null && entry.metadata === null) {
                const nested = await listAllFiles(`${fullPath}/`);
                files.push(...nested);
            } else {
                files.push({ path: fullPath, size: entry.metadata?.size ?? 0 });
            }
        }

        if (page.length < LIST_PAGE_SIZE) break;
        offset += LIST_PAGE_SIZE;
    }
    return files;
}

async function downloadFile(filePath, destRoot) {
    const url = `${SUPABASE_PROJECT_URL}/storage/v1/object/public/${bucket}/${filePath}`;
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Téléchargement échoué pour "${filePath}" : HTTP ${res.status}`);
    }
    const dest = path.join(destRoot, filePath);
    await mkdir(path.dirname(dest), { recursive: true });
    const buffer = Buffer.from(await res.arrayBuffer());
    await writeFile(dest, buffer);
    return buffer.length;
}

async function main() {
    console.log(`Listage récursif de "${bucket}"...`);
    const files = await listAllFiles('');
    console.log(`${files.length} fichier(s) trouvé(s).`);

    if (files.length === 0) {
        console.error('Aucun fichier trouvé - arrêt (pas de sauvegarde vide silencieuse).');
        process.exit(1);
    }

    let totalBytes = 0;
    let done = 0;
    for (const file of files) {
        totalBytes += await downloadFile(file.path, outputDir);
        done++;
        if (done % 50 === 0 || done === files.length) {
            console.log(`  ${done}/${files.length} fichiers téléchargés...`);
        }
    }

    console.log(`Terminé : ${files.length} fichiers, ${totalBytes} octets au total.`);

    if (totalBytes === 0) {
        console.error('Taille totale téléchargée = 0 octet - arrêt (backup invalide).');
        process.exit(1);
    }
}

main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});
