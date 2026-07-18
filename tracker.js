// ===== CONFIGURATION SUPABASE =====
// ⚠️ Seule la clé "anon public" doit être ici, jamais la clé "service_role" !
const SUPABASE_URL = 'https://mmdcpkwygqsdaqnkimwb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1tZGNwa3d5Z3FzZGFxbmtpbXdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyOTA2MTYsImV4cCI6MjA5OTg2NjYxNn0.mae_gw0VWy0ep8h9FrjJj2XSdjrfeR3mW9_Nx0nIaQ0';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ===== CONFIG API TCGDEX =====
const API_BASE = 'https://api.tcgdex.net/v2/fr';
const API_EN = 'https://api.tcgdex.net/v2/en';

// ===== ETAT GLOBAL =====
let selectedCard = null;
let lastSearchResults = [];
let customPreviewImage = null; // URL Supabase Storage une fois uploadée
let currentMarketValue = 0;    // Valeur marché (CardMarket) de la carte actuellement sélectionnée
let allCollectionCards = [];   // Cache local de la collection chargée depuis Supabase
let sortColumn = null;
let duplicatesOnlyFilter = false;
let sortDirection = 'asc';

// ===== UTILITAIRES =====

function showMessage(text, type = 'error') {
    const container = document.getElementById('message-container');
    const div = document.createElement('div');
    div.className = `message ${type}`;
    div.textContent = text;
    container.innerHTML = '';
    container.appendChild(div);
    setTimeout(() => div.remove(), 3000);
}

// Redimensionne une image et la convertit en Blob JPEG, prête à uploader
function resizeImageToBlob(file, maxWidth = 400) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const ratio = img.height / img.width;
                const canvas = document.createElement('canvas');
                canvas.width = Math.min(maxWidth, img.width);
                canvas.height = canvas.width * ratio;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.85);
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// Redimensionne un Blob (ex: image téléchargée) et retourne un Blob JPEG
function resizeBlobToJpeg(blob, maxWidth = 400) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
            const ratio = img.height / img.width;
            const canvas = document.createElement('canvas');
            canvas.width = Math.min(maxWidth, img.width);
            canvas.height = canvas.width * ratio;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            canvas.toBlob((resizedBlob) => {
                URL.revokeObjectURL(url);
                resolve(resizedBlob);
            }, 'image/jpeg', 0.85);
        };
        img.onerror = (e) => {
            URL.revokeObjectURL(url);
            reject(e);
        };
        img.src = url;
    });
}

// Transforme un id TCGdex en nom de fichier sûr (ex: "swsh3-136" -> "swsh3-136")
function sanitizeForPath(str) {
    return str.replace(/[^a-zA-Z0-9-_.]/g, '-');
}

function getTcgdexImagePath(tcgdexId) {
    return `tcgdex/${sanitizeForPath(tcgdexId)}.jpg`;
}

function getSeriesLogoPath(setId) {
    return `logos/${sanitizeForPath(setId)}.webp`;
}

// Redimensionne une image en gardant la transparence (utilisé pour les logos, contrairement aux JPEG des cartes)
function resizeImageToWebpBlob(file, maxWidth = 300) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const ratio = img.height / img.width;
                const canvas = document.createElement('canvas');
                canvas.width = Math.min(maxWidth, img.width);
                canvas.height = canvas.width * ratio;
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                canvas.toBlob((blob) => resolve(blob), 'image/webp', 0.92);
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// Upload manuel d'un logo de série : même chemin déterministe que l'auto-téléchargement (dédup garantie),
// et applique le logo à TOUTES les cartes déjà en collection pour ce set
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

// ===== RECHERCHE DE CARTES (TCGdex) =====

async function searchCards() {
    const search = document.getElementById('card-search').value.trim();
    if (!search) {
        showMessage('Veuillez entrer un nom de carte', 'error');
        return;
    }

    const btn = document.getElementById('search-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="loading"></span>Recherche...';

    try {
        const [frResponse, enResponse] = await Promise.all([
            fetch(`${API_BASE}/cards?name=${encodeURIComponent(search)}`),
            fetch(`${API_EN}/cards?name=${encodeURIComponent(search)}`)
        ]);

        const frData = await frResponse.json();
        const enData = await enResponse.json();

        const frList = Array.isArray(frData) ? frData : [];
        const enList = Array.isArray(enData) ? enData : [];

        const merged = [...frList];
        const existingIds = new Set(frList.map(c => c.id));
        for (const card of enList) {
            if (!existingIds.has(card.id)) {
                merged.push(card);
                existingIds.add(card.id);
            }
        }

        if (merged.length === 0) {
            showMessage('Aucune carte trouvée', 'error');
            document.getElementById('search-results').innerHTML = '';
            return;
        }

        displaySearchResults(merged);
        showMessage(`${merged.length} carte(s) trouvée(s)`, 'success');
    } catch (error) {
        showMessage('Erreur lors de la recherche', 'error');
        console.error(error);
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'Chercher';
    }
}

// Récupère la liste de toutes les images déjà stockées (dossier tcgdex/) en un seul appel
async function getStoredImageFilenames() {
    const { data, error } = await supabaseClient.storage
        .from('card-images')
        .list('tcgdex', { limit: 1000 });

    if (error || !data) return new Set();
    return new Set(data.map(f => f.name));
}

async function displaySearchResults(cards) {
    const cardsWithDetails = await Promise.all(
        cards.map(async (card) => {
            try {
                const response = await fetch(`${API_BASE}/cards/${card.id}`);
                const detail = await response.json();
                if (detail && !detail.status) return detail;
                throw new Error('not found in FR');
            } catch {
                try {
                    const enResponse = await fetch(`${API_EN}/cards/${card.id}`);
                    return await enResponse.json();
                } catch {
                    return card;
                }
            }
        })
    );

    // Pour les cartes sans image TCGdex, vérifier si on en a déjà une stockée nous-mêmes
    const storedFilenames = await getStoredImageFilenames();
    for (const card of cardsWithDetails) {
        if (!card.image && card.id && storedFilenames.has(`${sanitizeForPath(card.id)}.jpg`)) {
            const { data } = supabaseClient.storage.from('card-images').getPublicUrl(getTcgdexImagePath(card.id));
            card._localImage = data.publicUrl;
        }
    }

    lastSearchResults = cardsWithDetails;
    populateSearchFilters(cardsWithDetails);
    renderSearchResults(cardsWithDetails);
}

function populateSearchFilters(cards) {
    const raritySelect = document.getElementById('filter-rarity');
    const seriesSelect = document.getElementById('filter-series');

    const rarities = [...new Set(cards.map(c => c.rarity).filter(Boolean))].sort();
    const series = [...new Set(cards.map(c => c.set?.name).filter(Boolean))].sort();

    raritySelect.innerHTML = '<option value="">Toutes les raretés</option>' +
        rarities.map(r => `<option value="${r}">${r}</option>`).join('');

    seriesSelect.innerHTML = '<option value="">Toutes les séries</option>' +
        series.map(s => `<option value="${s}">${s}</option>`).join('');
}

function applySearchFilters() {
    const rarityFilter = document.getElementById('filter-rarity').value;
    const seriesFilter = document.getElementById('filter-series').value;

    let filtered = lastSearchResults;
    if (rarityFilter) {
        filtered = filtered.filter(c => c.rarity === rarityFilter);
    }
    if (seriesFilter) {
        filtered = filtered.filter(c => c.set?.name === seriesFilter);
    }

    renderSearchResults(filtered);
}

function renderSearchResults(cards) {
    const container = document.getElementById('search-results');

    if (cards.length === 0) {
        container.innerHTML = '<p style="text-align: center; padding: 1.5rem; color: #999;">Aucune carte ne correspond aux filtres</p>';
        container.classList.add('active');
        return;
    }

    container.innerHTML = cards.map(card => {
        const imageUrl = card.image ? `${card.image}/high.png` : (card._localImage || '');
        const setName = card.set?.name || card.set?.id || 'N/A';
        const cardNumber = card.localId || '?';
        const logoUrl = card.set?.logo ? `${card.set.logo}.webp` : '';
        const imgHtml = imageUrl
            ? `<img src="${imageUrl}" alt="${card.name}" class="search-result-img" onerror="this.outerHTML='<div class=&quot;no-image-placeholder small&quot;>🎴</div>'">`
            : '<div class="no-image-placeholder small">🎴</div>';

        return `
            <div class="search-result-item" onclick="selectCard(${JSON.stringify(card).replace(/"/g, '&quot;')})">
                ${imgHtml}
                <div class="search-result-info">
                    <div class="search-result-name">${card.name || '?'}</div>
                    <div class="search-result-set">${logoUrl ? `<img src="${logoUrl}" class="series-logo-inline" alt="" onerror="this.remove()">` : ''}${setName} - #${cardNumber}</div>
                </div>
            </div>
        `;
    }).join('');
    container.classList.add('active');
}

// ===== APERCU DE CARTE =====

function selectCard(card) {
    selectedCard = card;
    customPreviewImage = null;
    document.getElementById('search-results').classList.remove('active');

    const imageUrl = card.image ? `${card.image}/high.png` : '';
    const previewImageContainer = document.querySelector('.preview-image');

    if (imageUrl) {
        previewImageContainer.innerHTML = '<img id="preview-img" src="" alt="Carte">';
        const img = document.getElementById('preview-img');
        img.onerror = function() {
            showPreviewUploadPlaceholder();
        };
        img.src = imageUrl;
    } else if (card._localImage) {
        // Déjà su depuis la liste de recherche : pas besoin de re-vérifier
        customPreviewImage = card._localImage;
        previewImageContainer.innerHTML = `
            <img src="${card._localImage}" alt="Carte" style="cursor: pointer;" onclick="document.getElementById('preview-upload-input-2').click()">
            <input type="file" id="preview-upload-input-2" accept="image/*" style="display:none" onchange="handlePreviewImageUpload(event)">
        `;
    } else {
        // TCGdex n'a pas d'image : on vérifie si on en a déjà une nous-mêmes (upload précédent)
        showPreviewUploadPlaceholder();
        checkExistingImage(card.id).then(existingUrl => {
            // On vérifie que la carte n'a pas changé entre temps
            if (existingUrl && selectedCard === card) {
                customPreviewImage = existingUrl;
                previewImageContainer.innerHTML = `
                    <img src="${existingUrl}" alt="Carte" style="cursor: pointer;" onclick="document.getElementById('preview-upload-input-2').click()">
                    <input type="file" id="preview-upload-input-2" accept="image/*" style="display:none" onchange="handlePreviewImageUpload(event)">
                `;
            }
        });
    }

    document.getElementById('preview-name').textContent = card.name || '-';
    document.getElementById('preview-set-text').textContent = card.set?.name || '-';
    const previewLogo = document.getElementById('preview-series-logo');
    const previewLogoUrl = card.set?.logo ? `${card.set.logo}.webp` : '';
    if (previewLogoUrl) {
        previewLogo.src = previewLogoUrl;
        previewLogo.style.display = 'inline-block';
        previewLogo.onerror = () => { previewLogo.style.display = 'none'; };
    } else {
        previewLogo.style.display = 'none';
    }
    document.getElementById('preview-number').textContent = card.localId || '-';

    let types = 'N/A';
    if (card.types && Array.isArray(card.types)) {
        types = card.types.join(', ');
    }
    document.getElementById('preview-type').textContent = types;

    document.getElementById('preview-rarity').textContent = card.rarity || '-';

    let price = 0;
    if (card.pricing?.cardmarket?.avg) {
        price = card.pricing.cardmarket.avg;
    } else if (card.pricing?.cardmarket?.['avg-holo']) {
        price = card.pricing.cardmarket['avg-holo'];
    }
    currentMarketValue = price;
    document.getElementById('preview-price').textContent = price > 0 ? price.toFixed(2) + '€' : '-';
    document.getElementById('card-value').value = price > 0 ? price.toFixed(2) : '';

    // Réinitialiser le mode d'obtention à "Achetée" par défaut pour chaque nouvelle carte
    document.getElementById('card-acquisition').value = 'achat';
    document.getElementById('purchase-price-group').style.display = '';

    document.getElementById('card-preview').classList.add('active');
}

function showPreviewUploadPlaceholder() {
    const previewImageContainer = document.querySelector('.preview-image');
    previewImageContainer.innerHTML = `
        <div class="no-image-placeholder large upload-placeholder" onclick="document.getElementById('preview-upload-input').click()">
            🎴<br>Pas d'image<br>
            <span class="upload-hint">📷 Cliquer pour ajouter</span>
        </div>
        <input type="file" id="preview-upload-input" accept="image/*" style="display:none" onchange="handlePreviewImageUpload(event)">
    `;
}

async function handlePreviewImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const previewImageContainer = document.querySelector('.preview-image');
    previewImageContainer.innerHTML = '<div class="no-image-placeholder large"><span class="loading" style="border-top-color: #ff6b6b;"></span><br>Envoi...</div>';

    try {
        const publicUrl = await uploadImageToStorage(file, selectedCard?.id);
        customPreviewImage = publicUrl;

        previewImageContainer.innerHTML = `
            <img src="${publicUrl}" alt="Carte" style="cursor: pointer;" onclick="document.getElementById('preview-upload-input-2').click()">
            <input type="file" id="preview-upload-input-2" accept="image/*" style="display:none" onchange="handlePreviewImageUpload(event)">
        `;
        showMessage('Image envoyée sur Supabase !', 'success');
    } catch (error) {
        showMessage('Erreur lors de l\'envoi de l\'image', 'error');
        console.error(error);
        showPreviewUploadPlaceholder();
    }
}

// ===== COLLECTION (Supabase Database) =====

async function refreshCollection() {
    const { data, error } = await supabaseClient
        .from('cards')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        showMessage('Erreur lors du chargement de la collection', 'error');
        console.error(error);
        return;
    }

    allCollectionCards = data || [];
    await fillMissingSeriesLogos();
    updateStats();
    populateCollectionFilters();
    filterAndDisplay();
}

// Complète en mémoire les logos manquants avec ceux déjà stockés (auto ou uploadés manuellement),
// sans avoir à re-télécharger carte par carte
async function fillMissingSeriesLogos() {
    const missing = allCollectionCards.filter(c => !c.series_logo && c.tcgdex_id);
    if (missing.length === 0) return;

    const { data } = await supabaseClient.storage.from('card-images').list('logos', { limit: 1000 });
    if (!data) return;
    const stored = new Set(data.map(f => f.name));

    missing.forEach(card => {
        const setId = card.tcgdex_id.split('-')[0];
        const filename = `${sanitizeForPath(setId)}.webp`;
        if (stored.has(filename)) {
            const { data: urlData } = supabaseClient.storage.from('card-images').getPublicUrl(`logos/${filename}`);
            card.series_logo = urlData.publicUrl;
        }
    });
}

// Cherche si cette carte (même tcgdex_id + état, ou même nom/série/numéro + état) est déjà dans la collection
async function findExistingCardRow(tcgdexId, name, series, number, condition) {
    let query = supabaseClient.from('cards').select('*').eq('condition', condition).limit(1);

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

// Logique partagée d'ajout/fusion d'une carte en collection (utilisée par l'onglet Ajouter ET la vignette rapide depuis Progression)
async function performCardAdd(card, { condition, quantity, acquisitionType, purchasePrice, customImage, onImageUploadStart }) {
    let imageUrl = '';

    if (customImage) {
        imageUrl = customImage;
    } else if (card.image) {
        const tcgdexUrl = `${card.image}/high.png`;
        if (onImageUploadStart) onImageUploadStart();
        try {
            imageUrl = await fetchAndUploadExternalImage(tcgdexUrl, card.id);
        } catch (error) {
            console.error('Echec hébergement image, fallback lien TCGdex:', error);
            imageUrl = tcgdexUrl;
        }
    } else if (card.id) {
        const existingUrl = await checkExistingImage(card.id);
        if (existingUrl) imageUrl = existingUrl;
    }

    let seriesLogoUrl = null;
    if (card.set?.logo && card.set?.id) {
        try {
            seriesLogoUrl = await fetchAndUploadSeriesLogo(card.set.logo, card.set.id);
        } catch (error) {
            console.error('Logo de série non récupéré:', error);
        }
    }

    let marketValue = 0;
    if (card.pricing?.cardmarket?.avg) {
        marketValue = card.pricing.cardmarket.avg;
    } else if (card.pricing?.cardmarket?.['avg-holo']) {
        marketValue = card.pricing.cardmarket['avg-holo'];
    }

    const name = card.name || '?';
    const series = card.set?.name || 'N/A';
    const number = card.localId || '?';

    const existingRow = await findExistingCardRow(card.id, name, series, number, condition);

    if (existingRow) {
        const newQuantity = Number(existingRow.quantity || 1) + quantity;
        const updatePayload = { quantity: newQuantity, market_value: marketValue };
        if (!existingRow.image && imageUrl) updatePayload.image = imageUrl;
        if (!existingRow.series_logo && seriesLogoUrl) updatePayload.series_logo = seriesLogoUrl;
        if (!existingRow.cardmarket_id && card.pricing?.cardmarket?.idProduct) {
            updatePayload.cardmarket_id = card.pricing.cardmarket.idProduct;
        }

        const { error } = await supabaseClient.from('cards').update(updatePayload).eq('id', existingRow.id);
        if (error) throw error;
        return { merged: true, newQuantity };
    }

    let types = 'N/A';
    if (card.types && Array.isArray(card.types)) {
        types = card.types.join(', ');
    }

    const { error } = await supabaseClient.from('cards').insert([{
        name,
        series,
        number,
        type: types,
        rarity: card.rarity || 'N/A',
        condition,
        purchase_price: purchasePrice,
        market_value: marketValue,
        acquisition_type: acquisitionType,
        quantity,
        image: imageUrl,
        series_logo: seriesLogoUrl,
        tcgdex_id: card.id || null,
        cardmarket_id: card.pricing?.cardmarket?.idProduct || null,
        date_added: new Date().toLocaleDateString('fr-FR')
    }]);
    if (error) throw error;
    return { merged: false };
}

async function addCard() {
    if (!selectedCard) {
        showMessage('Veuillez sélectionner une carte', 'error');
        return;
    }

    const condition = document.getElementById('card-condition').value;
    const quantity = parseInt(document.getElementById('card-quantity').value) || 1;
    const acquisitionType = document.getElementById('card-acquisition').value;
    const purchasePrice = acquisitionType === 'pack'
        ? 0
        : (parseFloat(document.getElementById('card-value').value) || 0);

    const addBtn = document.querySelector('.form-section .full-width');
    const originalBtnText = addBtn.textContent;
    addBtn.disabled = true;

    let result;
    try {
        result = await performCardAdd(selectedCard, {
            condition,
            quantity,
            acquisitionType,
            purchasePrice,
            customImage: customPreviewImage,
            onImageUploadStart: () => { addBtn.innerHTML = '<span class="loading"></span>Sauvegarde de l\'image...'; }
        });
    } catch (error) {
        addBtn.disabled = false;
        addBtn.innerHTML = originalBtnText;
        showMessage('Erreur lors de l\'ajout à la collection', 'error');
        console.error(error);
        return;
    }

    addBtn.disabled = false;
    addBtn.innerHTML = originalBtnText;

    if (result.merged) {
        showMessage(`Quantité mise à jour : ${result.newQuantity} exemplaire(s) au total`, 'success');
    } else {
        showMessage(`${quantity} carte(s) ajoutée(s)`, 'success');
    }

    document.getElementById('card-search').value = '';
    document.getElementById('card-quantity').value = '1';
    document.getElementById('card-condition').value = 'NM';
    document.getElementById('card-value').value = '';
    document.getElementById('card-acquisition').value = 'achat';
    document.getElementById('purchase-price-group').style.display = '';
    document.getElementById('card-preview').classList.remove('active');
    selectedCard = null;
    customPreviewImage = null;
    currentMarketValue = 0;

    await refreshCollection();
    await recordValueSnapshot();
}

async function deleteCard(id) {
    if (!confirm('Supprimer cette carte ?')) return;

    const { error } = await supabaseClient.from('cards').delete().eq('id', id);

    if (error) {
        showMessage('Erreur lors de la suppression', 'error');
        console.error(error);
        return;
    }

    await refreshCollection();
    await recordValueSnapshot();
}

async function changeQuantity(id, delta) {
    const card = allCollectionCards.find(c => c.id === id);
    if (!card) return;

    const newQuantity = Number(card.quantity || 1) + delta;

    if (newQuantity <= 0) {
        if (!confirm('Retirer complètement cette carte de la collection ?')) return;
        const { error } = await supabaseClient.from('cards').delete().eq('id', id);
        if (error) {
            showMessage('Erreur lors de la suppression', 'error');
            console.error(error);
            return;
        }
    } else {
        const { error } = await supabaseClient.from('cards').update({ quantity: newQuantity }).eq('id', id);
        if (error) {
            showMessage('Erreur lors de la mise à jour', 'error');
            console.error(error);
            return;
        }
    }

    await refreshCollection();
    await recordValueSnapshot();
}

function updateStats() {
    const total = allCollectionCards.reduce((sum, card) => sum + Number(card.quantity || 1), 0);
    const value = allCollectionCards.reduce((sum, card) => sum + (Number(card.market_value || 0) * Number(card.quantity || 1)), 0);
    const spent = allCollectionCards.reduce((sum, card) => sum + (Number(card.purchase_price || 0) * Number(card.quantity || 1)), 0);

    document.getElementById('total-cards').textContent = total;
    document.getElementById('total-spent').textContent = spent.toFixed(2) + '€';
    document.getElementById('hero-total-value').textContent = value.toFixed(2) + '€';

    return { total, value, spent };
}

async function recordValueSnapshot() {
    const { total, value, spent } = updateStats();
    const { error } = await supabaseClient.from('value_history').insert([{
        total_value: value,
        total_cards: total,
        total_spent: spent
    }]);
    if (error) console.error('Erreur enregistrement historique valeur:', error);

    renderStatsCharts();
    renderHeroValueCard();
}

let heroSparklineChart = null;

async function renderHeroValueCard() {
    const { value } = updateStats();

    const { data, error } = await supabaseClient
        .from('value_history')
        .select('*')
        .order('recorded_at', { ascending: true })
        .limit(200);

    const fluctEl = document.getElementById('hero-fluctuation');

    if (error || !data || data.length === 0) {
        if (fluctEl) fluctEl.textContent = '';
        return;
    }

    // Mini-graphique en fond (sparkline)
    const canvas = document.getElementById('hero-sparkline');
    if (canvas && typeof Chart !== 'undefined') {
        const values = data.map(d => Number(d.total_value));
        const trendUp = values[values.length - 1] >= values[0];

        if (heroSparklineChart) heroSparklineChart.destroy();
        heroSparklineChart = new Chart(canvas, {
            type: 'line',
            data: {
                labels: values.map((_, i) => i),
                datasets: [{
                    data: values,
                    borderColor: trendUp ? '#4ade80' : '#ff6b6b',
                    backgroundColor: trendUp ? 'rgba(74, 222, 128, 0.15)' : 'rgba(255, 107, 107, 0.12)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                plugins: { legend: { display: false }, tooltip: { enabled: false } },
                scales: {
                    x: { display: false },
                    y: { display: false }
                }
            }
        });
    }

    // Fluctuation sur les dernières 24h
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    let baseline = data[0]; // par défaut : tout premier point connu (si collection < 24h)
    for (const point of data) {
        if (new Date(point.recorded_at).getTime() <= dayAgo) {
            baseline = point;
        } else {
            break;
        }
    }

    const delta = value - Number(baseline.total_value);
    if (fluctEl) {
        const sign = delta > 0 ? '+' : '';
        fluctEl.textContent = `${sign}${delta.toFixed(2)}€ (24h)`;
        fluctEl.className = 'hero-fluctuation ' + (delta > 0 ? 'positive' : delta < 0 ? 'negative' : 'neutral');
    }
}

function sortCollection(column) {
    if (sortColumn === column) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        sortColumn = column;
        sortDirection = 'asc';
    }
    updateSortArrows();
    filterAndDisplay();
}

function updateSortArrows() {
    document.querySelectorAll('.sort-arrow').forEach(el => el.textContent = '');
    if (sortColumn) {
        const el = document.getElementById(`sort-arrow-${sortColumn}`);
        if (el) el.textContent = sortDirection === 'asc' ? '▲' : '▼';
    }
}

function applySorting(list) {
    if (!sortColumn) return list;

    const sorted = [...list].sort((a, b) => {
        let valA, valB;
        switch (sortColumn) {
            case 'name':
                valA = a.name || '';
                valB = b.name || '';
                return sortDirection === 'asc'
                    ? valA.localeCompare(valB, 'fr', { numeric: true })
                    : valB.localeCompare(valA, 'fr', { numeric: true });
            case 'series':
                valA = a.series || '';
                valB = b.series || '';
                return sortDirection === 'asc'
                    ? valA.localeCompare(valB, 'fr', { numeric: true })
                    : valB.localeCompare(valA, 'fr', { numeric: true });
            case 'number':
                valA = a.number || '';
                valB = b.number || '';
                return sortDirection === 'asc'
                    ? valA.localeCompare(valB, 'fr', { numeric: true })
                    : valB.localeCompare(valA, 'fr', { numeric: true });
            case 'condition':
                valA = a.condition || '';
                valB = b.condition || '';
                return sortDirection === 'asc'
                    ? valA.localeCompare(valB, 'fr', { numeric: true })
                    : valB.localeCompare(valA, 'fr', { numeric: true });
            case 'rarity':
                valA = a.rarity || '';
                valB = b.rarity || '';
                return sortDirection === 'asc'
                    ? valA.localeCompare(valB, 'fr', { numeric: true })
                    : valB.localeCompare(valA, 'fr', { numeric: true });
            case 'quantity':
                valA = Number(a.quantity || 1);
                valB = Number(b.quantity || 1);
                return sortDirection === 'asc' ? valA - valB : valB - valA;
            case 'value':
                valA = Number(a.market_value || 0) * Number(a.quantity || 1);
                valB = Number(b.market_value || 0) * Number(b.quantity || 1);
                return sortDirection === 'asc' ? valA - valB : valB - valA;
            default:
                return 0;
        }
    });

    return sorted;
}

function populateCollectionFilters() {
    const seriesSelect = document.getElementById('filter-collection-series');
    const raritySelect = document.getElementById('filter-collection-rarity');
    const typeSelect = document.getElementById('filter-collection-type');

    const currentSeries = seriesSelect.value;
    const currentRarity = raritySelect.value;
    const currentType = typeSelect.value;

    const series = [...new Set(allCollectionCards.map(c => c.series).filter(Boolean))].sort();
    const rarities = [...new Set(allCollectionCards.map(c => c.rarity).filter(Boolean))].sort();
    const types = [...new Set(allCollectionCards.map(c => c.type).filter(Boolean))].sort();

    seriesSelect.innerHTML = '<option value="">Toutes les séries</option>' +
        series.map(s => `<option value="${s}">${s}</option>`).join('');
    raritySelect.innerHTML = '<option value="">Toutes les raretés</option>' +
        rarities.map(r => `<option value="${r}">${r}</option>`).join('');
    typeSelect.innerHTML = '<option value="">Tous les types</option>' +
        types.map(t => `<option value="${t}">${t}</option>`).join('');

    // Réappliquer la sélection précédente si elle existe toujours
    if (series.includes(currentSeries)) seriesSelect.value = currentSeries;
    if (rarities.includes(currentRarity)) raritySelect.value = currentRarity;
    if (types.includes(currentType)) typeSelect.value = currentType;
}

// Identifiant de regroupement d'une carte (même carte, peu importe l'état) pour détecter les doublons
function getDuplicateGroupKey(card) {
    return card.tcgdex_id ? `id:${card.tcgdex_id}` : `nsn:${card.name}|${card.series}|${card.number}`;
}

function computeDuplicateGroupTotals() {
    const totals = {};
    allCollectionCards.forEach(card => {
        const key = getDuplicateGroupKey(card);
        totals[key] = (totals[key] || 0) + Number(card.quantity || 1);
    });
    return totals;
}

function toggleDuplicatesFilter() {
    duplicatesOnlyFilter = !duplicatesOnlyFilter;
    document.getElementById('filter-duplicates-btn').classList.toggle('active', duplicatesOnlyFilter);
    filterAndDisplay();
}

// ===== EXPORT CSV =====

function exportCollectionToCSV() {
    if (allCollectionCards.length === 0) {
        showMessage('Ta collection est vide, rien à exporter', 'error');
        return;
    }

    const headers = [
        'Nom', 'Série', 'Numéro', 'Type', 'Rareté', 'État', 'Quantité',
        'Prix payé (€)', 'Valeur marché (€)', 'Obtention', 'Ajoutée le',
        'ID TCGdex', 'ID Cardmarket'
    ];

    const escapeCsvValue = (value) => {
        const str = String(value ?? '');
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    };

    const rows = allCollectionCards.map(card => [
        card.name,
        card.series,
        card.number,
        card.type,
        card.rarity,
        card.condition,
        card.quantity,
        Number(card.purchase_price || 0).toFixed(2),
        Number(card.market_value || 0).toFixed(2),
        card.acquisition_type === 'pack' ? 'Booster' : 'Achat',
        card.date_added,
        card.tcgdex_id || '',
        card.cardmarket_id || ''
    ].map(escapeCsvValue).join(','));

    // BOM UTF-8 en tête pour qu'Excel affiche bien les accents
    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const dateStr = new Date().toISOString().split('T')[0];
    link.download = `ma-collection-pokemon-${dateStr}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showMessage('Export CSV téléchargé !', 'success');
}

function filterAndDisplay() {
    const searchTerm = document.getElementById('search-collection').value.toLowerCase();
    const conditionFilter = document.getElementById('filter-condition').value;
    const seriesFilter = document.getElementById('filter-collection-series').value;
    const rarityFilter = document.getElementById('filter-collection-rarity').value;
    const typeFilter = document.getElementById('filter-collection-type').value;

    let filtered = allCollectionCards;
    if (searchTerm) {
        filtered = filtered.filter(c =>
            (c.name || '').toLowerCase().includes(searchTerm) ||
            (c.series || '').toLowerCase().includes(searchTerm)
        );
    }
    if (conditionFilter) {
        filtered = filtered.filter(c => c.condition === conditionFilter);
    }
    if (seriesFilter) {
        filtered = filtered.filter(c => c.series === seriesFilter);
    }
    if (rarityFilter) {
        filtered = filtered.filter(c => c.rarity === rarityFilter);
    }
    if (typeFilter) {
        filtered = filtered.filter(c => c.type === typeFilter);
    }
    if (duplicatesOnlyFilter) {
        const totals = computeDuplicateGroupTotals();
        filtered = filtered.filter(c => (totals[getDuplicateGroupKey(c)] || 0) > 1);
    }

    filtered = applySorting(filtered);

    renderCollectionTable(filtered);
    renderCollectionGrid(filtered);
}

function renderCollectionTable(filtered) {
    const tbody = document.getElementById('cards-list');

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" style="text-align: center; padding: 2rem;">
                    <div class="empty-state">
                        <p>🎴 Aucune carte trouvée</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = filtered.map(card => {
        const qty = Number(card.quantity || 1);
        const lineTotal = Number(card.market_value || 0) * qty;
        const acquisitionIcon = card.acquisition_type === 'pack' ? '🎁' : '💰';
        const acquisitionTitle = card.acquisition_type === 'pack' ? 'Sortie d\'un booster' : 'Achetée';
        return `
        <tr>
            <td>${card.image
                ? `<img src="${card.image}" alt="${card.name}" class="card-image-thumb" onerror="this.outerHTML=getCollectionUploadPlaceholder(${card.id})">`
                : getCollectionUploadPlaceholder(card.id)
            }</td>
            <td><strong class="row-name-link" onclick="showCardDetail(${card.id})">${card.name}</strong></td>
            <td>${card.series_logo ? `<img src="${card.series_logo}" class="series-logo-table" alt="" onerror="this.remove()">` : ''}${card.series}</td>
            <td>${card.number}</td>
            <td>
                <span class="badge ${(card.condition || '').toLowerCase()}">${card.condition}</span>
                <span title="${acquisitionTitle}" class="acquisition-icon">${acquisitionIcon}</span>
            </td>
            <td>${card.rarity || 'N/A'}</td>
            <td style="text-align: center;">
                <div class="qty-stepper">
                    <button onclick="changeQuantity(${card.id}, -1)">−</button>
                    <span>${qty}</span>
                    <button onclick="changeQuantity(${card.id}, 1)">+</button>
                </div>
            </td>
            <td style="text-align: right;"><strong>${lineTotal.toFixed(2)}€</strong></td>
            <td style="text-align: center;">
                <button class="delete-btn" onclick="deleteCard(${card.id})">🗑️</button>
            </td>
        </tr>
    `;
    }).join('');
}

function getGridNoImageHtml() {
    return '<div class="collection-card-noimg">🎴</div>';
}

function renderCollectionGrid(filtered) {
    const grid = document.getElementById('collection-grid');
    if (!grid) return;

    if (filtered.length === 0) {
        grid.innerHTML = '<div class="collection-grid-empty">🎴 Aucune carte trouvée</div>';
        return;
    }

    grid.innerHTML = filtered.map(card => {
        const qty = Number(card.quantity || 1);
        const lineTotal = Number(card.market_value || 0) * qty;
        const conditionClass = (card.condition || '').toLowerCase();
        const acquisitionIcon = card.acquisition_type === 'pack' ? '🎁' : '💰';
        const acquisitionTitle = card.acquisition_type === 'pack' ? 'Sortie d\'un booster' : 'Achetée';

        return `
            <div class="collection-card" onclick="showCardDetail(${card.id})">
                ${card.image
                    ? `<img src="${card.image}" alt="${card.name}" loading="lazy" onerror="this.outerHTML=getGridNoImageHtml()">`
                    : getGridNoImageHtml()
                }
                ${qty > 1 ? `<div class="qty-badge">×${qty}</div>` : ''}
                <div class="price-badge">${lineTotal.toFixed(2)}€</div>
                <div class="collection-card-overlay">
                    <div class="collection-card-name">${card.name}</div>
                    <div class="collection-card-set">${card.series_logo ? `<img src="${card.series_logo}" class="series-logo-inline" alt="" onerror="this.remove()">` : ''}${card.series} · #${card.number}</div>
                    <span class="condition-badge-grid ${conditionClass}">${card.condition}</span>
                    <span class="acquisition-icon" title="${acquisitionTitle}">${acquisitionIcon}</span>
                </div>
            </div>
        `;
    }).join('');
}

// ===== MODALE DETAIL CARTE =====

// Change la quantité depuis la fiche détail sans fermer la fenêtre (la ferme seulement si la carte a été supprimée)
async function changeQuantityInModal(id, delta) {
    await changeQuantity(id, delta);

    const stillExists = allCollectionCards.find(c => c.id === id);
    if (stillExists) {
        showCardDetail(id);
    } else {
        closeCardDetail();
    }
}

function showCardDetail(cardId) {
    const card = allCollectionCards.find(c => c.id === cardId);
    if (!card) return;

    const qty = Number(card.quantity || 1);
    const marketValue = Number(card.market_value || 0);
    const purchasePrice = Number(card.purchase_price || 0);
    const lineTotal = marketValue * qty;
    const conditionClass = (card.condition || '').toLowerCase();
    const conditionLabels = { nm: 'Neuf', lp: 'Très bon', mp: 'Bon', hp: 'Mauvais état' };
    const conditionLabel = conditionLabels[conditionClass] || card.condition || '';
    const isPack = card.acquisition_type === 'pack';

    const modalCard = document.getElementById('card-detail-card');
    modalCard.innerHTML = `
        <button class="modal-close" onclick="closeCardDetail()">✕</button>
        <div class="modal-body">
            <div class="modal-image-wrap">
                ${card.image
                    ? `<img src="${card.image}" alt="${card.name}" class="modal-image" onerror="this.outerHTML=getGridNoImageHtml()">`
                    : `<div class="modal-image-noimg">🎴</div>`
                }
            </div>
            <div class="modal-info">
                <div class="modal-title">${card.name}</div>
                ${card.series_logo
                    ? `<img src="${card.series_logo}" class="modal-series-logo" alt="" onerror="this.remove()">`
                    : (card.tcgdex_id ? `
                        <div class="modal-logo-upload" onclick="document.getElementById('modal-logo-upload-input').click()">
                            🏷️ Ajouter un logo de série
                        </div>
                        <input type="file" id="modal-logo-upload-input" accept="image/*" style="display:none" onchange="handleModalSeriesLogoUpload(event, '${card.tcgdex_id.split('-')[0]}', ${card.id})">
                    ` : '')
                }
                <div class="modal-subtitle">${card.series} · #${card.number}</div>

                <div class="modal-badges">
                    <span class="modal-pill rarity-pill">⭐ ${card.rarity || 'N/A'}</span>
                    <span class="modal-pill condition-pill ${conditionClass}">${conditionLabel} (${card.condition})</span>
                    <span class="modal-pill acquisition-pill">${isPack ? '🎁 Sortie d\'un booster' : '💰 Achetée'}</span>
                </div>

                <div class="modal-price-row">
                    <div class="modal-price-line">
                        <span class="modal-price-label">Valeur marché</span>
                        <span class="modal-price">${marketValue.toFixed(2)}€</span>
                    </div>
                    ${!isPack ? `
                    <div class="modal-price-line">
                        <span class="modal-price-label">Prix payé</span>
                        <span class="modal-price-secondary">${purchasePrice.toFixed(2)}€</span>
                    </div>` : ''}
                    ${qty > 1 ? `<div class="modal-price-total">Valeur totale : ${lineTotal.toFixed(2)}€ (×${qty})</div>` : ''}
                </div>

                ${card.type && card.type !== 'N/A' ? `<div class="modal-meta-line"><span class="modal-meta-label">Type</span> ${card.type}</div>` : ''}
                <div class="modal-meta-line"><span class="modal-meta-label">Quantité</span> ${qty}</div>
                ${card.date_added ? `<div class="modal-meta-line"><span class="modal-meta-label">Ajoutée le</span> ${card.date_added}</div>` : ''}

                <button class="modal-edit-btn" onclick="showCardEditForm(${card.id})">✏️ Modifier</button>
                <a href="${card.cardmarket_id
                    ? `https://www.cardmarket.com/en/Pokemon/Products?idProduct=${card.cardmarket_id}`
                    : `https://www.cardmarket.com/fr/Pokemon/Products/Search?searchString=${encodeURIComponent(card.name || '')}`
                }" target="_blank" rel="noopener noreferrer" class="modal-cardmarket-btn">🔎 ${card.cardmarket_id ? 'Voir sur Cardmarket' : 'Chercher sur Cardmarket'}</a>
                <button class="modal-delete-btn" onclick="deleteCard(${card.id}); closeCardDetail();">🗑️ Supprimer de la collection</button>
            </div>
        </div>
    `;

    document.getElementById('card-detail-overlay').classList.add('active');
}

// ===== EDITION D'UNE CARTE DEPUIS LA FICHE DETAIL =====

function showCardEditForm(cardId) {
    const card = allCollectionCards.find(c => c.id === cardId);
    if (!card) return;

    const isPack = card.acquisition_type === 'pack';

    const modalCard = document.getElementById('card-detail-card');
    modalCard.innerHTML = `
        <button class="modal-close" onclick="closeCardDetail()">✕</button>
        <div class="modal-body">
            <div class="modal-image-wrap">
                ${card.image
                    ? `<img src="${card.image}" alt="${card.name}" class="modal-image" onerror="this.outerHTML=getGridNoImageHtml()">`
                    : `<div class="modal-image-noimg">🎴</div>`
                }
            </div>
            <div class="modal-info">
                <div class="modal-title">${card.name}</div>
                <div class="modal-subtitle">${card.series} · #${card.number}</div>

                <div class="edit-form-grid">
                    <div class="form-group">
                        <label for="edit-condition">État</label>
                        <select id="edit-condition">
                            <option value="NM" ${card.condition === 'NM' ? 'selected' : ''}>Neuf (NM)</option>
                            <option value="LP" ${card.condition === 'LP' ? 'selected' : ''}>Très bon (LP)</option>
                            <option value="MP" ${card.condition === 'MP' ? 'selected' : ''}>Bon (MP)</option>
                            <option value="HP" ${card.condition === 'HP' ? 'selected' : ''}>Mauvais état (HP)</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="edit-quantity">Quantité</label>
                        <input type="number" id="edit-quantity" value="${Number(card.quantity || 1)}" min="1" max="100">
                    </div>
                    <div class="form-group">
                        <label for="edit-acquisition">Obtention</label>
                        <select id="edit-acquisition" onchange="toggleEditPurchasePriceField()">
                            <option value="achat" ${!isPack ? 'selected' : ''}>Achetée</option>
                            <option value="pack" ${isPack ? 'selected' : ''}>Sortie d'un booster</option>
                        </select>
                    </div>
                    <div class="form-group" id="edit-purchase-price-group" style="${isPack ? 'display:none;' : ''}">
                        <label for="edit-purchase-price">Prix payé (€)</label>
                        <input type="number" id="edit-purchase-price" value="${Number(card.purchase_price || 0).toFixed(2)}" step="0.01" min="0">
                    </div>
                </div>

                <div class="modal-edit-actions">
                    <button class="modal-save-btn" onclick="saveCardEdits(${card.id})">💾 Enregistrer</button>
                    <button class="modal-cancel-btn" onclick="showCardDetail(${card.id})">Annuler</button>
                </div>
            </div>
        </div>
    `;

    document.getElementById('card-detail-overlay').classList.add('active');
}

function toggleEditPurchasePriceField() {
    const val = document.getElementById('edit-acquisition').value;
    document.getElementById('edit-purchase-price-group').style.display = val === 'pack' ? 'none' : '';
}

async function saveCardEdits(cardId) {
    const condition = document.getElementById('edit-condition').value;
    const quantity = parseInt(document.getElementById('edit-quantity').value) || 1;
    const acquisitionType = document.getElementById('edit-acquisition').value;
    const purchasePrice = acquisitionType === 'pack'
        ? 0
        : (parseFloat(document.getElementById('edit-purchase-price').value) || 0);

    const { error } = await supabaseClient.from('cards').update({
        condition,
        quantity,
        acquisition_type: acquisitionType,
        purchase_price: purchasePrice
    }).eq('id', cardId);

    if (error) {
        showMessage('Erreur lors de la modification', 'error');
        console.error(error);
        return;
    }

    showMessage('Carte mise à jour', 'success');
    await refreshCollection();
    await recordValueSnapshot();
    showCardDetail(cardId);
}

function closeCardDetail() {
    document.getElementById('card-detail-overlay').classList.remove('active');
}

async function handleModalSeriesLogoUpload(event, setId, cardId) {
    const file = event.target.files[0];
    if (!file) return;

    try {
        showMessage('Envoi du logo...', 'success');
        await uploadSeriesLogoManually(file, setId);
        showMessage('Logo ajouté ! Il sera visible sur toutes les cartes de cette série.', 'success');
        await refreshCollection();
        showCardDetail(cardId);
    } catch (error) {
        showMessage('Erreur lors de l\'envoi du logo', 'error');
        console.error(error);
    }
}

function getCollectionUploadPlaceholder(cardId) {
    return `<div class="no-image-placeholder thumb upload-placeholder" onclick="document.getElementById('upload-${cardId}').click()">
        🎴
        <input type="file" id="upload-${cardId}" accept="image/*" style="display:none" onchange="handleCollectionImageUpload(event, ${cardId})">
    </div>`;
}

async function handleCollectionImageUpload(event, cardId) {
    const file = event.target.files[0];
    if (!file) return;

    try {
        showMessage('Envoi de l\'image...', 'success');
        const cardEntry = allCollectionCards.find(c => c.id === cardId);
        const tcgdexId = cardEntry ? cardEntry.tcgdex_id : null;
        const publicUrl = await uploadImageToStorage(file, tcgdexId);

        const { error } = await supabaseClient
            .from('cards')
            .update({ image: publicUrl })
            .eq('id', cardId);

        if (error) throw error;

        showMessage('Image ajoutée !', 'success');
        await refreshCollection();
    } catch (error) {
        showMessage('Erreur lors de l\'envoi de l\'image', 'error');
        console.error(error);
    }
}

// ===== LISTE DE SOUHAITS =====

let allWishlistItems = [];

async function refreshWishlist() {
    const { data, error } = await supabaseClient
        .from('wishlist')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Erreur chargement liste de souhaits:', error);
        return;
    }

    allWishlistItems = data || [];
    renderWishlist();
}

async function addToWishlist() {
    if (!selectedCard) {
        showMessage('Veuillez sélectionner une carte', 'error');
        return;
    }

    let imageUrl = customPreviewImage || (selectedCard.image ? `${selectedCard.image}/high.png` : '');
    const logoUrl = selectedCard.set?.logo ? `${selectedCard.set.logo}.webp` : null;

    const { error } = await supabaseClient.from('wishlist').insert([{
        tcgdex_id: selectedCard.id || null,
        name: selectedCard.name || '?',
        series: selectedCard.set?.name || 'N/A',
        number: selectedCard.localId || '?',
        rarity: selectedCard.rarity || 'N/A',
        image: imageUrl,
        series_logo: logoUrl
    }]);

    if (error) {
        showMessage('Erreur lors de l\'ajout à la liste de souhaits', 'error');
        console.error(error);
        return;
    }

    showMessage('Ajoutée à ta liste de souhaits !', 'success');
    document.getElementById('card-preview').classList.remove('active');
    selectedCard = null;
    customPreviewImage = null;

    await refreshWishlist();
}

async function deleteWishlistItem(id) {
    if (!confirm('Retirer cette carte de la liste de souhaits ?')) return;

    const { error } = await supabaseClient.from('wishlist').delete().eq('id', id);
    if (error) {
        showMessage('Erreur lors de la suppression', 'error');
        console.error(error);
        return;
    }

    await refreshWishlist();
}

// Déplace une carte de la liste de souhaits vers la collection
async function moveWishlistToCollection(id) {
    const item = allWishlistItems.find(w => w.id === id);
    if (!item) return;

    const existingRow = await findExistingCardRow(item.tcgdex_id, item.name, item.series, item.number, 'NM');

    let dbError = null;
    if (existingRow) {
        const newQuantity = Number(existingRow.quantity || 1) + 1;
        const { error } = await supabaseClient.from('cards').update({ quantity: newQuantity }).eq('id', existingRow.id);
        dbError = error;
    } else {
        const { error } = await supabaseClient.from('cards').insert([{
            name: item.name,
            series: item.series,
            number: item.number,
            type: 'N/A',
            rarity: item.rarity,
            condition: 'NM',
            purchase_price: 0,
            market_value: 0,
            acquisition_type: 'achat',
            quantity: 1,
            image: item.image,
            series_logo: item.series_logo || null,
            tcgdex_id: item.tcgdex_id,
            date_added: new Date().toLocaleDateString('fr-FR')
        }]);
        dbError = error;
    }

    if (dbError) {
        showMessage('Erreur lors du transfert vers la collection', 'error');
        console.error(dbError);
        return;
    }

    await supabaseClient.from('wishlist').delete().eq('id', id);

    showMessage('Carte déplacée vers ta collection ! Pense à ajuster l\'état et le prix.', 'success');
    await refreshWishlist();
    await refreshCollection();
    await recordValueSnapshot();
}

function renderWishlist() {
    const container = document.getElementById('wishlist-grid');
    if (!container) return;

    if (allWishlistItems.length === 0) {
        container.innerHTML = '<p class="empty-state">🌟 Ta liste de souhaits est vide</p>';
        return;
    }

    container.innerHTML = allWishlistItems.map(item => `
        <div class="wishlist-card">
            ${item.image
                ? `<img src="${item.image}" alt="${item.name}" class="wishlist-card-img" onerror="this.style.display='none'">`
                : '<div class="no-image-placeholder thumb">🎴</div>'
            }
            <div class="wishlist-card-info">
                <div class="wishlist-card-name">${item.name}</div>
                <div class="wishlist-card-set">${item.series_logo ? `<img src="${item.series_logo}" class="series-logo-inline" alt="" onerror="this.remove()">` : ''}${item.series} - #${item.number}</div>
            </div>
            <div class="wishlist-card-actions">
                <button class="wishlist-got-btn" onclick="moveWishlistToCollection(${item.id})">✅ Je l'ai !</button>
                <button class="delete-btn" onclick="deleteWishlistItem(${item.id})">🗑️</button>
            </div>
        </div>
    `).join('');
}

// ===== STATISTIQUES =====

let rarityChartInstance = null;
let seriesChartInstance = null;
let valueHistoryChartInstance = null;
let valueHistoryRawData = [];
let currentValueHistoryRange = 30;

async function renderStatsCharts() {
    if (typeof Chart === 'undefined') return; // Chart.js pas encore chargé

    // Couleurs de texte/grille adaptées au thème sombre
    Chart.defaults.color = '#8A93A6';
    Chart.defaults.borderColor = 'rgba(255,255,255,0.08)';
    Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

    renderStatsKpis();
    renderRarityChart();
    renderSeriesChart();
    await loadValueHistoryData();
    renderValueHistoryChart();
    renderPriceMovers();
}

function renderStatsKpis() {
    const topCardEl = document.getElementById('kpi-top-card');
    const topCardPriceEl = document.getElementById('kpi-top-card-price');
    const avgPriceEl = document.getElementById('kpi-avg-price');
    const seriesCountEl = document.getElementById('kpi-series-count');
    const topRarityEl = document.getElementById('kpi-top-rarity');

    if (allCollectionCards.length === 0) {
        topCardEl.textContent = '-';
        topCardPriceEl.textContent = '';
        avgPriceEl.textContent = '-';
        seriesCountEl.textContent = '-';
        topRarityEl.textContent = '-';
        return;
    }

    const topCard = [...allCollectionCards].sort((a, b) => Number(b.market_value || 0) - Number(a.market_value || 0))[0];
    topCardEl.textContent = topCard.name;
    topCardPriceEl.textContent = `${Number(topCard.market_value || 0).toFixed(2)}€`;

    const totalQty = allCollectionCards.reduce((sum, c) => sum + Number(c.quantity || 1), 0);
    const totalValue = allCollectionCards.reduce((sum, c) => sum + Number(c.market_value || 0) * Number(c.quantity || 1), 0);
    avgPriceEl.textContent = `${(totalQty > 0 ? totalValue / totalQty : 0).toFixed(2)}€`;

    const seriesSet = new Set(allCollectionCards.map(c => c.series).filter(s => s && s !== 'N/A'));
    seriesCountEl.textContent = seriesSet.size;

    const rarityCounts = {};
    allCollectionCards.forEach(c => {
        const r = c.rarity;
        if (!r || r === 'N/A') return;
        rarityCounts[r] = (rarityCounts[r] || 0) + Number(c.quantity || 1);
    });
    const topRarity = Object.entries(rarityCounts).sort((a, b) => b[1] - a[1])[0];
    topRarityEl.textContent = topRarity ? topRarity[0] : '-';
}

function renderRarityChart() {
    const canvas = document.getElementById('rarity-chart');
    if (!canvas) return;

    const counts = {};
    allCollectionCards.forEach(card => {
        const key = card.rarity || 'Non renseignée';
        counts[key] = (counts[key] || 0) + Number(card.quantity || 1);
    });

    const labels = Object.keys(counts);
    const values = Object.values(counts);

    if (rarityChartInstance) rarityChartInstance.destroy();

    if (labels.length === 0) return;

    rarityChartInstance = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data: values,
                backgroundColor: ['#E8A93B', '#3FA7A1', '#6bcbff', '#95e1a3', '#c77dff', '#ff9f6b', '#ff6b6b', '#8A93A6'],
                borderColor: '#1B2233',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { position: 'bottom' } }
        }
    });
}

function renderSeriesChart() {
    const canvas = document.getElementById('series-chart');
    if (!canvas) return;

    const counts = {};
    allCollectionCards.forEach(card => {
        const key = card.series;
        if (!key || key === 'N/A') return;
        counts[key] = (counts[key] || 0) + Number(card.quantity || 1);
    });

    // Top 8 séries
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const labels = sorted.map(s => s[0]);
    const values = sorted.map(s => s[1]);

    if (seriesChartInstance) seriesChartInstance.destroy();

    if (labels.length === 0) return;

    seriesChartInstance = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                data: values,
                backgroundColor: '#E8A93B',
                borderRadius: 4,
                barThickness: 18
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                x: { beginAtZero: true, ticks: { stepSize: 1 } },
                y: { ticks: { autoSkip: false } }
            }
        }
    });
}

async function loadValueHistoryData() {
    const { data, error } = await supabaseClient
        .from('value_history')
        .select('*')
        .order('recorded_at', { ascending: true })
        .limit(500);

    valueHistoryRawData = (!error && data) ? data : [];
}

function setValueHistoryRange(event, days) {
    currentValueHistoryRange = days;
    document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    renderValueHistoryChart();
}

function renderValueHistoryChart() {
    const canvas = document.getElementById('value-history-chart');
    if (!canvas || valueHistoryRawData.length === 0) return;

    let data = valueHistoryRawData;
    if (currentValueHistoryRange > 0) {
        const cutoff = Date.now() - currentValueHistoryRange * 24 * 60 * 60 * 1000;
        data = data.filter(d => new Date(d.recorded_at).getTime() >= cutoff);
        if (data.length === 0) data = valueHistoryRawData.slice(-1); // filet de sécurité
    }

    const labels = data.map(d => new Date(d.recorded_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }));
    const values = data.map(d => Number(d.total_value));
    const trendUp = values[values.length - 1] >= values[0];
    const lineColor = trendUp ? '#4ade80' : '#ff6b6b';
    const fillColor = trendUp ? 'rgba(74, 222, 128, 0.12)' : 'rgba(255, 107, 107, 0.1)';

    if (valueHistoryChartInstance) valueHistoryChartInstance.destroy();

    valueHistoryChartInstance = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                data: values,
                borderColor: lineColor,
                backgroundColor: fillColor,
                fill: true,
                tension: 0.3,
                pointRadius: 0,
                pointHitRadius: 10,
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => `${ctx.parsed.y.toFixed(2)}€`
                    }
                }
            },
            scales: {
                y: { beginAtZero: true },
                x: { ticks: { maxTicksLimit: 8, autoSkip: true } }
            }
        }
    });
}

// ===== EVENT LISTENERS =====
document.getElementById('search-collection').addEventListener('input', filterAndDisplay);
document.getElementById('filter-condition').addEventListener('change', filterAndDisplay);
document.getElementById('filter-collection-series').addEventListener('change', filterAndDisplay);
document.getElementById('filter-collection-rarity').addEventListener('change', filterAndDisplay);
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeCardDetail();
});

document.getElementById('filter-collection-type').addEventListener('change', filterAndDisplay);

document.getElementById('card-acquisition').addEventListener('change', (e) => {
    const group = document.getElementById('purchase-price-group');
    const input = document.getElementById('card-value');
    if (e.target.value === 'pack') {
        group.style.display = 'none';
        input.value = '0';
    } else {
        group.style.display = '';
    }
});
document.getElementById('grid-sort').addEventListener('change', (e) => {
    const val = e.target.value;
    if (!val) {
        sortColumn = null;
    } else {
        const [col, dir] = val.split('-');
        sortColumn = col;
        sortDirection = dir;
    }
    updateSortArrows();
    filterAndDisplay();
});
document.getElementById('card-search').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') searchCards();
});
document.getElementById('filter-rarity').addEventListener('change', applySearchFilters);
document.getElementById('filter-series').addEventListener('change', applySearchFilters);

// ===== VUE COLLECTION (Galerie / Tableau) =====

let collectionViewMode = 'grid';

function setCollectionView(mode) {
    collectionViewMode = mode;
    document.getElementById('view-btn-grid').classList.toggle('active', mode === 'grid');
    document.getElementById('view-btn-table').classList.toggle('active', mode === 'table');
    document.getElementById('collection-grid-wrapper').style.display = mode === 'grid' ? 'block' : 'none';
    document.getElementById('collection-table-wrapper').style.display = mode === 'table' ? 'block' : 'none';
    document.getElementById('grid-sort').style.display = mode === 'grid' ? 'inline-block' : 'none';
}

// ===== ONGLETS =====

function switchTab(event, tabId) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

    document.getElementById(tabId).classList.add('active');
    event.target.classList.add('active');

    // Chart.js a besoin que le canvas soit visible pour bien se dimensionner : on redessine à l'ouverture
    if (tabId === 'tab-stats') {
        renderStatsCharts();
    }

    if (tabId === 'tab-progression') {
        if (currentProgressionSetId && document.getElementById('progression-set-view').style.display === 'block') {
            renderProgressionCardsGrid();
        } else {
            loadSeriesProgress();
        }
    }
}

// ===== INITIALISATION =====
// ===== RAFRAICHISSEMENT DES PRIX MARCHE =====

function updateLastRefreshLabel() {
    const status = document.getElementById('refresh-prices-status');
    const last = localStorage.getItem('lastPriceRefresh');
    if (last) {
        const date = new Date(last);
        status.textContent = `Dernière mise à jour : ${date.toLocaleDateString('fr-FR')} à ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
    } else {
        status.textContent = 'Jamais rafraîchi';
    }
}

async function refreshAllMarketPrices() {
    const btn = document.getElementById('refresh-prices-btn');
    const status = document.getElementById('refresh-prices-status');

    const cardsWithId = allCollectionCards.filter(c => c.tcgdex_id);
    if (cardsWithId.length === 0) {
        showMessage('Aucune carte avec un identifiant TCGdex à rafraîchir', 'error');
        return;
    }

    const uniqueIds = [...new Set(cardsWithId.map(c => c.tcgdex_id))];
    const priceMap = {};
    let done = 0;

    btn.disabled = true;
    const originalText = btn.textContent;

    // Traiter par lots de 5 pour ne pas surcharger l'API
    const batchSize = 5;
    for (let i = 0; i < uniqueIds.length; i += batchSize) {
        const batch = uniqueIds.slice(i, i + batchSize);
        await Promise.all(batch.map(async (id) => {
            try {
                let response = await fetch(`${API_BASE}/cards/${id}`);
                let data = await response.json();
                if (!data || data.status) {
                    const enResponse = await fetch(`${API_EN}/cards/${id}`);
                    data = await enResponse.json();
                }
                let price = 0;
                if (data?.pricing?.cardmarket?.avg) {
                    price = data.pricing.cardmarket.avg;
                } else if (data?.pricing?.cardmarket?.['avg-holo']) {
                    price = data.pricing.cardmarket['avg-holo'];
                }
                priceMap[id] = price;
            } catch (error) {
                console.error(`Erreur récupération prix pour ${id}:`, error);
            }
            done++;
            btn.innerHTML = `<span class="loading"></span>Rafraîchissement... ${done}/${uniqueIds.length}`;
        }));
    }

    // Mettre à jour chaque carte concernée en base, en capturant les variations au passage
    const relevantCards = cardsWithId.filter(c => priceMap[c.tcgdex_id] !== undefined);
    const movers = [];

    const updates = relevantCards.map(c => {
        const oldValue = Number(c.market_value || 0);
        const newValue = priceMap[c.tcgdex_id];
        const delta = newValue - oldValue;
        if (Math.abs(delta) > 0.001) {
            movers.push({ name: c.name, number: c.number, oldValue, newValue, delta });
        }
        return supabaseClient.from('cards').update({ market_value: newValue }).eq('id', c.id);
    });

    await Promise.all(updates);

    // Dédupliquer par carte (une même carte peut avoir plusieurs lignes selon l'état)
    const moversByKey = {};
    movers.forEach(m => {
        const key = `${m.name}-${m.number}`;
        if (!moversByKey[key] || Math.abs(m.delta) > Math.abs(moversByKey[key].delta)) {
            moversByKey[key] = m;
        }
    });
    localStorage.setItem('lastPriceMovers', JSON.stringify(Object.values(moversByKey)));

    btn.disabled = false;
    btn.innerHTML = originalText;

    localStorage.setItem('lastPriceRefresh', new Date().toISOString());
    updateLastRefreshLabel();

    showMessage('Prix du marché mis à jour !', 'success');
    await refreshCollection();
    await recordValueSnapshot();
    renderPriceMovers();
}

function renderPriceMovers() {
    const container = document.getElementById('price-movers-section');
    if (!container) return;

    const stored = localStorage.getItem('lastPriceMovers');
    if (!stored) {
        container.innerHTML = '<p style="text-align: center; color: var(--slate); padding: 1rem;">Clique sur "Rafraîchir les prix du marché" pour voir les variations.</p>';
        return;
    }

    const movers = JSON.parse(stored);
    const gainers = movers.filter(m => m.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 5);
    const losers = movers.filter(m => m.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 5);

    const renderList = (list, positive) => {
        if (list.length === 0) return '<p style="color: var(--slate); font-size: 0.85rem;">Aucune variation</p>';
        return list.map(m => `
            <div class="mover-row">
                <span class="mover-name">${m.name} <span class="mover-number">#${m.number}</span></span>
                <span class="mover-delta ${positive ? 'positive' : 'negative'}">${positive ? '+' : ''}${m.delta.toFixed(2)}€</span>
            </div>
        `).join('');
    };

    if (movers.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--slate); padding: 1rem;">Aucune variation détectée lors du dernier rafraîchissement.</p>';
        return;
    }

    container.innerHTML = `
        <div class="movers-columns">
            <div class="movers-column">
                <h4 class="movers-heading up">📈 En hausse</h4>
                ${renderList(gainers, true)}
            </div>
            <div class="movers-column">
                <h4 class="movers-heading down">📉 En baisse</h4>
                ${renderList(losers, false)}
            </div>
        </div>
    `;
}

// ===== PROGRESSION PAR SERIE =====

let allTcgdexSeries = [];
let currentProgressionSetId = null;
let currentProgressionCards = [];
let progressionFilter = 'all';

async function loadSeriesProgress() {
    const container = document.getElementById('progression-series-list');
    container.innerHTML = '<p style="text-align: center; padding: 2rem; color: var(--slate);">Chargement des séries...</p>';

    try {
        if (allTcgdexSeries.length === 0) {
            const seriesListRes = await fetch(`${API_BASE}/series`);
            const seriesList = await seriesListRes.json();

            // Le détail de chaque série contient déjà ses sets complets (logo + cardCount)
            const detailedSeries = await Promise.all(
                seriesList.map(async (s) => {
                    try {
                        const res = await fetch(`${API_BASE}/series/${s.id}`);
                        return await res.json();
                    } catch {
                        return { ...s, sets: [] };
                    }
                })
            );

            // Séries les plus récentes en premier
            allTcgdexSeries = detailedSeries.sort((a, b) => {
                const dateA = a.releaseDate ? new Date(a.releaseDate).getTime() : 0;
                const dateB = b.releaseDate ? new Date(b.releaseDate).getTime() : 0;
                return dateB - dateA;
            });
        }

        // Compter les cartes DISTINCTES possédées par set (dérivé du tcgdex_id, insensible aux doublons d'état)
        const ownedIdsBySet = {};
        allCollectionCards.forEach(card => {
            if (card.tcgdex_id) {
                const setId = card.tcgdex_id.split('-')[0];
                if (!ownedIdsBySet[setId]) ownedIdsBySet[setId] = new Set();
                ownedIdsBySet[setId].add(card.tcgdex_id);
            }
        });

        // Logos déjà stockés chez nous (auto ou uploadés manuellement), pour les sets sans logo TCGdex
        const { data: storedLogosData } = await supabaseClient.storage.from('card-images').list('logos', { limit: 1000 });
        const storedLogoFilenames = new Set((storedLogosData || []).map(f => f.name));

        container.innerHTML = allTcgdexSeries.map(series => {
            const sets = (series.sets || []).filter(set => (ownedIdsBySet[set.id]?.size || 0) > 0);
            if (sets.length === 0) return '';

            const setsHtml = sets.map(set => {
                const total = set.cardCount?.official || 0;
                const owned = ownedIdsBySet[set.id]?.size || 0;
                const pct = total > 0 ? Math.round((owned / total) * 100) : 0;
                const safeName = (set.name || '').replace(/'/g, "\\'");

                let logoUrl = set.logo ? `${set.logo}.webp` : '';
                if (!logoUrl) {
                    const filename = `${sanitizeForPath(set.id)}.webp`;
                    if (storedLogoFilenames.has(filename)) {
                        const { data } = supabaseClient.storage.from('card-images').getPublicUrl(`logos/${filename}`);
                        logoUrl = data.publicUrl;
                    }
                }

                const logoHtml = logoUrl
                    ? `<img src="${logoUrl}" class="progression-set-logo" alt="" onerror="this.remove()">`
                    : `<div class="progression-set-logo-upload" onclick="event.stopPropagation(); document.getElementById('proglogo-${set.id}').click()" title="Ajouter un logo">
                        🏷️
                        <input type="file" id="proglogo-${set.id}" accept="image/*" style="display:none" onchange="event.stopPropagation(); handleProgressionSeriesLogoUpload(event, '${set.id}')">
                    </div>`;

                return `
                    <div class="progression-set-row" onclick="openSetProgression('${set.id}', '${safeName}', '${logoUrl}')">
                        ${logoHtml}
                        <div class="progression-set-info">
                            <div class="progression-set-name">${set.name}</div>
                            <div class="progression-progress-bar"><div class="progression-progress-fill" style="width:${pct}%"></div></div>
                        </div>
                        <div class="progression-set-count">${owned}/${total} · ${pct}%</div>
                        <span class="progression-chevron">›</span>
                    </div>
                `;
            }).join('');

            const seriesLogoUrl = series.logo ? `${series.logo}.webp` : '';

            return `
                <div class="progression-series-block">
                    <div class="progression-series-header">
                        ${seriesLogoUrl ? `<img src="${seriesLogoUrl}" class="progression-series-logo" alt="" onerror="this.remove()">` : ''}
                        <div>
                            <div class="progression-series-name">${series.name}</div>
                            <div class="progression-series-meta">${sets.length} extension${sets.length > 1 ? 's' : ''}</div>
                        </div>
                    </div>
                    <div class="progression-sets-list">${setsHtml}</div>
                </div>
            `;
        }).join('');
    } catch (error) {
        container.innerHTML = '<p style="text-align: center; padding: 2rem; color: var(--slate);">Erreur lors du chargement des séries</p>';
        console.error(error);
    }
}

async function handleProgressionSeriesLogoUpload(event, setId) {
    const file = event.target.files[0];
    if (!file) return;

    try {
        showMessage('Envoi du logo...', 'success');
        await uploadSeriesLogoManually(file, setId);
        showMessage('Logo ajouté !', 'success');
        await refreshCollection();
        loadSeriesProgress();
    } catch (error) {
        showMessage('Erreur lors de l\'envoi du logo', 'error');
        console.error(error);
    }
}

async function openSetProgression(setId, setName, logoUrl) {
    currentProgressionSetId = setId;
    progressionFilter = 'all';
    document.getElementById('progression-search').value = '';
    document.querySelectorAll('#tab-progression .view-toggle-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('prog-filter-all').classList.add('active');

    document.getElementById('progression-series-view').style.display = 'none';
    document.getElementById('progression-set-view').style.display = 'block';
    document.getElementById('progression-set-title').textContent = setName;

    const logoImg = document.getElementById('progression-set-logo');
    if (logoUrl) {
        logoImg.src = logoUrl;
        logoImg.style.display = 'inline-block';
        logoImg.onerror = () => { logoImg.style.display = 'none'; };
    } else {
        logoImg.style.display = 'none';
    }

    const grid = document.getElementById('progression-cards-grid');
    grid.innerHTML = '<p style="text-align: center; padding: 2rem; color: var(--slate);">Chargement des cartes...</p>';

    try {
        let response = await fetch(`${API_BASE}/cards?set=${setId}`);
        let data = await response.json();
        if (!Array.isArray(data) || data.length === 0) {
            const enResponse = await fetch(`${API_EN}/cards?set=${setId}`);
            data = await enResponse.json();
        }

        const basicList = Array.isArray(data) ? data : [];

        // Récupérer les détails complets (rareté, prix, image) par lots de 5
        const detailed = [];
        const batchSize = 5;
        for (let i = 0; i < basicList.length; i += batchSize) {
            const batch = basicList.slice(i, i + batchSize);
            grid.innerHTML = `<p style="text-align: center; padding: 2rem; color: var(--slate);">Chargement des cartes... ${Math.min(i + batchSize, basicList.length)}/${basicList.length}</p>`;

            const results = await Promise.all(batch.map(async (card) => {
                try {
                    const detailRes = await fetch(`${API_BASE}/cards/${card.id}`);
                    const detail = await detailRes.json();
                    if (detail && !detail.status) return detail;
                    throw new Error('fr not found');
                } catch {
                    try {
                        const enDetailRes = await fetch(`${API_EN}/cards/${card.id}`);
                        return await enDetailRes.json();
                    } catch {
                        return card; // filet de sécurité minimal
                    }
                }
            }));
            detailed.push(...results);
        }

        currentProgressionCards = detailed.sort((a, b) => {
            const numA = parseInt(a.localId) || 0;
            const numB = parseInt(b.localId) || 0;
            return numA - numB;
        });

        populateProgressionRarityFilter();
        renderProgressionCardsGrid();
    } catch (error) {
        grid.innerHTML = '<p style="text-align: center; padding: 2rem; color: var(--slate);">Erreur lors du chargement des cartes</p>';
        console.error(error);
    }
}

function populateProgressionRarityFilter() {
    const select = document.getElementById('progression-rarity-filter');
    const rarities = [...new Set(currentProgressionCards.map(c => c.rarity).filter(Boolean))].sort();
    select.innerHTML = '<option value="">Toutes les raretés</option>' +
        rarities.map(r => `<option value="${r}">${r}</option>`).join('');
}

function renderProgressionCardsGrid() {
    const grid = document.getElementById('progression-cards-grid');
    const ownedIds = new Set(allCollectionCards.filter(c => c.tcgdex_id).map(c => c.tcgdex_id));
    const searchTerm = document.getElementById('progression-search').value.toLowerCase();

    const ownedCount = currentProgressionCards.filter(c => ownedIds.has(c.id)).length;
    const totalCount = currentProgressionCards.length;
    const pct = totalCount > 0 ? Math.round((ownedCount / totalCount) * 100) : 0;
    document.getElementById('progression-set-progress-text').textContent = `${ownedCount} / ${totalCount} cartes possédées · ${pct}%`;

    let cards = currentProgressionCards;
    if (searchTerm) {
        cards = cards.filter(c =>
            (c.name || '').toLowerCase().includes(searchTerm) ||
            String(c.localId || '').toLowerCase().includes(searchTerm)
        );
    }
    if (progressionFilter === 'owned') {
        cards = cards.filter(c => ownedIds.has(c.id));
    } else if (progressionFilter === 'missing') {
        cards = cards.filter(c => !ownedIds.has(c.id));
    }

    const rarityFilter = document.getElementById('progression-rarity-filter').value;
    if (rarityFilter) {
        cards = cards.filter(c => c.rarity === rarityFilter);
    }

    cards = [...cards].sort((a, b) => (parseInt(a.localId) || 0) - (parseInt(b.localId) || 0));

    if (cards.length === 0) {
        grid.innerHTML = '<p style="text-align: center; padding: 2rem; color: var(--slate);">Aucune carte ne correspond</p>';
        return;
    }

    grid.innerHTML = cards.map(card => {
        const owned = ownedIds.has(card.id);
        const ownedCardRow = owned ? allCollectionCards.find(c => c.tcgdex_id === card.id) : null;

        let imageUrl = '';
        if (ownedCardRow && ownedCardRow.image) {
            imageUrl = ownedCardRow.image; // Notre image (auto ou uploadée manuellement), déjà une URL complète
        } else if (card.image) {
            imageUrl = `${card.image}/low.webp`; // Lien brut TCGdex en secours
        }

        return `
            <div class="progression-card-item ${owned ? 'owned' : 'missing'}">
                ${imageUrl
                    ? `<img src="${imageUrl}" alt="${card.name}" loading="lazy" onerror="this.style.display='none'">`
                    : '<div class="progression-card-noimg">🎴</div>'
                }
                ${owned
                    ? '<div class="progression-owned-badge">✓</div>'
                    : `<button class="progression-add-badge" onclick="event.stopPropagation(); addFromProgression('${card.id}', this)">+</button>`
                }
                <div class="progression-card-label">#${card.localId} ${card.name}</div>
            </div>
        `;
    }).join('');
}

function setProgressionFilter(filter) {
    progressionFilter = filter;
    document.querySelectorAll('#tab-progression .view-toggle-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`prog-filter-${filter}`).classList.add('active');
    renderProgressionCardsGrid();
}

function backToSeriesProgress() {
    document.getElementById('progression-series-view').style.display = 'block';
    document.getElementById('progression-set-view').style.display = 'none';
    currentProgressionSetId = null;
    // Rafraîchir les compteurs de la liste (au cas où des cartes ont été ajoutées entre-temps)
    loadSeriesProgress();
}

async function addFromProgression(cardId, btnEl) {
    // Les détails complets sont déjà chargés dans currentProgressionCards
    const cached = currentProgressionCards.find(c => c.id === cardId);
    if (cached) {
        showAddCardModal(cached);
        return;
    }

    // Filet de sécurité si jamais la carte n'était pas dans le cache
    if (btnEl) {
        btnEl.disabled = true;
        btnEl.innerHTML = '<span class="loading" style="width:12px;height:12px;border-width:2px;"></span>';
    }

    try {
        let response = await fetch(`${API_BASE}/cards/${cardId}`);
        let detail = await response.json();
        if (!detail || detail.status) {
            const enResponse = await fetch(`${API_EN}/cards/${cardId}`);
            detail = await enResponse.json();
        }
        showAddCardModal(detail);
    } catch (error) {
        showMessage('Erreur lors du chargement des détails de la carte', 'error');
        console.error(error);
    } finally {
        if (btnEl) {
            btnEl.disabled = false;
            btnEl.innerHTML = '+';
        }
    }
}

function showAddCardModal(card) {
    let marketPrice = 0;
    if (card.pricing?.cardmarket?.avg) {
        marketPrice = card.pricing.cardmarket.avg;
    } else if (card.pricing?.cardmarket?.['avg-holo']) {
        marketPrice = card.pricing.cardmarket['avg-holo'];
    }

    const imageUrl = card.image ? `${card.image}/high.png` : '';

    const modalCard = document.getElementById('card-detail-card');
    modalCard.innerHTML = `
        <button class="modal-close" onclick="closeCardDetail()">✕</button>
        <div class="modal-body">
            <div class="modal-image-wrap">
                ${imageUrl
                    ? `<img src="${imageUrl}" alt="${card.name}" class="modal-image" onerror="this.outerHTML=getGridNoImageHtml()">`
                    : `<div class="modal-image-noimg">🎴</div>`
                }
            </div>
            <div class="modal-info">
                <div class="modal-title">${card.name}</div>
                <div class="modal-subtitle">${card.set?.name || 'N/A'} · #${card.localId || '?'}</div>

                <div class="modal-badges">
                    <span class="modal-pill rarity-pill">⭐ ${card.rarity || 'N/A'}</span>
                    ${marketPrice > 0 ? `<span class="modal-pill acquisition-pill">💶 ${marketPrice.toFixed(2)}€ (marché)</span>` : ''}
                </div>

                <div class="edit-form-grid">
                    <div class="form-group">
                        <label for="quickadd-condition">État</label>
                        <select id="quickadd-condition">
                            <option value="NM">Neuf (NM)</option>
                            <option value="LP">Très bon (LP)</option>
                            <option value="MP">Bon (MP)</option>
                            <option value="HP">Mauvais état (HP)</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="quickadd-quantity">Quantité</label>
                        <input type="number" id="quickadd-quantity" value="1" min="1" max="100">
                    </div>
                    <div class="form-group">
                        <label for="quickadd-acquisition">Obtention</label>
                        <select id="quickadd-acquisition" onchange="toggleQuickAddPurchasePriceField()">
                            <option value="achat">Achetée</option>
                            <option value="pack">Sortie d'un booster</option>
                        </select>
                    </div>
                    <div class="form-group" id="quickadd-purchase-price-group">
                        <label for="quickadd-purchase-price">Prix payé (€)</label>
                        <input type="number" id="quickadd-purchase-price" value="${marketPrice > 0 ? marketPrice.toFixed(2) : ''}" step="0.01" min="0" placeholder="optionnel">
                    </div>
                </div>

                <button class="modal-save-btn full-width" id="quickadd-submit-btn" onclick="submitQuickAdd(${JSON.stringify(card).replace(/"/g, '&quot;')})">➕ Ajouter à ma collection</button>
            </div>
        </div>
    `;

    document.getElementById('card-detail-overlay').classList.add('active');
}

function toggleQuickAddPurchasePriceField() {
    const val = document.getElementById('quickadd-acquisition').value;
    document.getElementById('quickadd-purchase-price-group').style.display = val === 'pack' ? 'none' : '';
}

async function submitQuickAdd(card) {
    const condition = document.getElementById('quickadd-condition').value;
    const quantity = parseInt(document.getElementById('quickadd-quantity').value) || 1;
    const acquisitionType = document.getElementById('quickadd-acquisition').value;
    const purchasePrice = acquisitionType === 'pack'
        ? 0
        : (parseFloat(document.getElementById('quickadd-purchase-price').value) || 0);

    const btn = document.getElementById('quickadd-submit-btn');
    const originalText = btn.textContent;
    btn.disabled = true;

    let result;
    try {
        result = await performCardAdd(card, {
            condition,
            quantity,
            acquisitionType,
            purchasePrice,
            customImage: null,
            onImageUploadStart: () => { btn.innerHTML = '<span class="loading"></span>Sauvegarde de l\'image...'; }
        });
    } catch (error) {
        btn.disabled = false;
        btn.innerHTML = originalText;
        showMessage('Erreur lors de l\'ajout à la collection', 'error');
        console.error(error);
        return;
    }

    closeCardDetail();

    if (result.merged) {
        showMessage(`Quantité mise à jour : ${result.newQuantity} exemplaire(s) au total`, 'success');
    } else {
        showMessage(`${quantity} carte(s) ajoutée(s)`, 'success');
    }

    await refreshCollection();
    await recordValueSnapshot();

    // Rafraîchir la grille de progression pour refléter le nouvel ajout
    if (currentProgressionSetId) {
        renderProgressionCardsGrid();
    }
}

document.getElementById('progression-search').addEventListener('input', renderProgressionCardsGrid);
document.getElementById('progression-rarity-filter').addEventListener('change', renderProgressionCardsGrid);

async function init() {
    await refreshCollection();
    await refreshWishlist();
    await renderStatsCharts();
    await renderHeroValueCard();
    updateLastRefreshLabel();
}
init();
