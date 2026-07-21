// Helpers Supabase Storage/DB - Pokémon Tracker
// Dépend de modules/utils.js (sanitizeForPath, path builders, resizeImageToBlob/WebpBlob, resizeBlobToJpeg)
// et de supabaseClient (déclaré en haut de tracker.js). Aucun état partagé.

// Upload manuel d'un logo de série : même chemin déterministe que l'auto-téléchargement (dédup garantie),
// et applique le logo à TOUTES les cartes déjà en collection pour ce set
async function uploadSeriesSymbolManually(file, setId) {
    const blob = await resizeImageToWebpBlob(file, 100);
    const path = getSeriesSymbolPath(setId);

    const { error: uploadError } = await supabaseClient.storage
        .from('card-images')
        .upload(path, blob, { contentType: 'image/webp', upsert: true });
    if (uploadError) throw uploadError;

    const { data } = supabaseClient.storage.from('card-images').getPublicUrl(path);
    const symbolUrl = data.publicUrl;

    // Appliquer à toutes les cartes de ce set déjà en collection
    await supabaseClient.from('cards').update({ series_symbol: symbolUrl }).like('tcgdex_id', `${setId}-%`);

    return symbolUrl;
}

async function uploadSeriesLogoManually(file, setId) {
    const blob = await resizeImageToWebpBlob(file, 300);
    const path = getSeriesLogoPath(setId);

    const { error: uploadError } = await supabaseClient.storage
        .from('card-images')
        .upload(path, blob, { contentType: 'image/webp', upsert: true });
    if (uploadError) throw uploadError;

    const { data } = supabaseClient.storage.from('card-images').getPublicUrl(path);
    const logoUrl = data.publicUrl;

    // Appliquer à toutes les cartes de ce set déjà en collection
    await supabaseClient.from('cards').update({ series_logo: logoUrl }).like('tcgdex_id', `${setId}-%`);

    return logoUrl;
}

// Vérifie si un logo existe déjà en stockage pour ce set (auto ou uploadé manuellement)
async function checkExistingSeriesLogo(setId) {
    const { data } = await supabaseClient.storage
        .from('card-images')
        .list('logos', { search: `${sanitizeForPath(setId)}.webp` });

    if (data && data.length > 0) {
        const { data: urlData } = supabaseClient.storage.from('card-images').getPublicUrl(getSeriesLogoPath(setId));
        return urlData.publicUrl;
    }
    return null;
}

// Télécharge le logo d'une série (une seule fois par set, réutilisé pour toutes ses cartes)
async function fetchAndUploadSeriesSymbol(symbolBaseUrl, setId) {
    const path = getSeriesSymbolPath(setId);

    const { data: existing } = await supabaseClient.storage
        .from('card-images')
        .list('symbols', { search: `${sanitizeForPath(setId)}.webp` });

    if (existing && existing.length > 0) {
        const { data } = supabaseClient.storage.from('card-images').getPublicUrl(path);
        return data.publicUrl;
    }

    const response = await fetch(`${symbolBaseUrl}.webp`);
    if (!response.ok) throw new Error('Symbole introuvable sur TCGdex');

    const blob = await response.blob();

    const { error: uploadError } = await supabaseClient.storage
        .from('card-images')
        .upload(path, blob, { contentType: 'image/webp', upsert: true });

    if (uploadError) throw uploadError;

    const { data } = supabaseClient.storage.from('card-images').getPublicUrl(path);
    return data.publicUrl;
}

async function fetchAndUploadSeriesLogo(logoBaseUrl, setId) {
    const path = getSeriesLogoPath(setId);

    const { data: existing } = await supabaseClient.storage
        .from('card-images')
        .list('logos', { search: `${sanitizeForPath(setId)}.webp` });

    if (existing && existing.length > 0) {
        const { data } = supabaseClient.storage.from('card-images').getPublicUrl(path);
        return data.publicUrl;
    }

    const response = await fetch(`${logoBaseUrl}.webp`);
    if (!response.ok) throw new Error('Logo introuvable sur TCGdex');

    const blob = await response.blob();

    const { error: uploadError } = await supabaseClient.storage
        .from('card-images')
        .upload(path, blob, { contentType: 'image/webp', upsert: true });

    if (uploadError) throw uploadError;

    const { data } = supabaseClient.storage.from('card-images').getPublicUrl(path);
    return data.publicUrl;
}

// Vérifie si une image existe déjà en base pour cette carte (auto OU uploadée manuellement avant)
async function checkExistingImage(tcgdexId) {
    if (!tcgdexId) return null;

    const { data: existing } = await supabaseClient.storage
        .from('card-images')
        .list('tcgdex', { search: `${sanitizeForPath(tcgdexId)}.jpg` });

    if (existing && existing.length > 0) {
        const { data } = supabaseClient.storage.from('card-images').getPublicUrl(getTcgdexImagePath(tcgdexId));
        return data.publicUrl;
    }
    return null;
}

// Télécharge une image depuis une URL externe (TCGdex) et l'upload vers Supabase Storage
// Réutilise l'image existante si cette carte a déjà été téléchargée/uploadée une fois (déduplication)
async function fetchAndUploadExternalImage(externalUrl, tcgdexId) {
    const existingUrl = await checkExistingImage(tcgdexId);
    if (existingUrl) return existingUrl;

    const path = getTcgdexImagePath(tcgdexId);

    const response = await fetch(externalUrl);
    if (!response.ok) throw new Error('Impossible de télécharger l\'image source');

    const blob = await response.blob();
    const resizedBlob = await resizeBlobToJpeg(blob, 400);

    const { error: uploadError } = await supabaseClient.storage
        .from('card-images')
        .upload(path, resizedBlob, { contentType: 'image/jpeg', upsert: true });

    if (uploadError) throw uploadError;

    const { data } = supabaseClient.storage.from('card-images').getPublicUrl(path);
    return data.publicUrl;
}

// Upload une image personnelle (uploadée manuellement) vers Supabase Storage
// Si un tcgdexId est fourni, l'image est rangée au même endroit que les images auto (réutilisable plus tard)
async function uploadImageToStorage(file, tcgdexId = null) {
    const blob = await resizeImageToBlob(file, 400);
    const path = tcgdexId
        ? getTcgdexImagePath(tcgdexId)
        : `custom/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;

    const { error: uploadError } = await supabaseClient.storage
        .from('card-images')
        .upload(path, blob, { contentType: 'image/jpeg', upsert: true });

    if (uploadError) throw uploadError;

    const { data } = supabaseClient.storage.from('card-images').getPublicUrl(path);
    return data.publicUrl;
}

// Récupère la liste de toutes les images déjà stockées (dossier tcgdex/) en un seul appel
async function getStoredImageFilenames() {
    const { data, error } = await supabaseClient.storage
        .from('card-images')
        .list('tcgdex', { limit: 1000 });

    if (error || !data) return new Set();
    return new Set(data.map(f => f.name));
}

// Cherche si cette carte (même tcgdex_id + état, ou même nom/série/numéro + état) est déjà dans la collection
async function findExistingCardRow(tcgdexId, name, series, number, condition, finish = 'normal') {
    let query = supabaseClient.from('cards').select('*').eq('condition', condition).eq('finish', finish).limit(1);

    if (tcgdexId) {
        query = query.eq('tcgdex_id', tcgdexId);
    } else {
        query = query.eq('name', name).eq('series', series).eq('number', number);
    }

    const { data, error } = await query;
    if (error) {
        console.error(error);
        return null;
    }
    return data && data.length > 0 ? data[0] : null;
}
