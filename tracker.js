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
let customQuickAddImage = null; // idem, mais pour la vignette d'ajout rapide (Progression)

// ===== REGLAGES D'AJOUT RAPIDE (Progression) =====

const QUICKADD_DEFAULTS_KEY = 'progressionQuickAddDefaults';

function getQuickAddDefaults() {
    try {
        const stored = localStorage.getItem(QUICKADD_DEFAULTS_KEY);
        if (stored) return JSON.parse(stored);
    } catch (e) { /* ignore */ }
    return { condition: 'NM', quantity: 1, acquisitionType: 'pack', purchasePrice: 0, date: null };
}

function saveQuickAddDefaultsToStorage(defaults) {
    localStorage.setItem(QUICKADD_DEFAULTS_KEY, JSON.stringify(defaults));
}

function openQuickAddSettingsModal() {
    const defaults = getQuickAddDefaults();
    const content = document.getElementById('quickadd-settings-content');

    content.innerHTML = `
        <button class="modal-close" onclick="closeQuickAddSettingsModal()">✕</button>
        <div class="modal-title" style="margin-bottom: 1rem;">Réglages d'ajout rapide</div>
        <p style="color: var(--slate); font-size: 0.8rem; margin-bottom: 1rem;">
            Utilisés par le bouton "+" (ajout instantané) et pré-remplis dans la fenêtre détaillée.
        </p>
        <div class="edit-form-grid">
            <div class="form-group">
                <label for="qa-settings-condition">État</label>
                <select id="qa-settings-condition">
                    <option value="NM">Neuf (NM)</option>
                    <option value="LP">Très bon (LP)</option>
                    <option value="MP">Bon (MP)</option>
                    <option value="HP">Mauvais état (HP)</option>
                </select>
            </div>
            <div class="form-group">
                <label for="qa-settings-quantity">Quantité</label>
                <input type="number" id="qa-settings-quantity" min="1" value="${defaults.quantity}">
            </div>
            <div class="form-group">
                <label for="qa-settings-acquisition">Obtention</label>
                <select id="qa-settings-acquisition" onchange="toggleQaSettingsPriceField()">
                    <option value="pack">Sortie d'un booster</option>
                    <option value="achat">Achetée</option>
                </select>
            </div>
            <div class="form-group" id="qa-settings-price-group">
                <label for="qa-settings-price">Prix payé (€)</label>
                <input type="number" id="qa-settings-price" step="0.01" min="0" value="${defaults.purchasePrice}">
            </div>
            <div class="form-group">
                <label for="qa-settings-date">Date d'acquisition (fixe)</label>
                <input type="text" id="qa-settings-date" placeholder="jj/mm/aaaa">
            </div>
        </div>
        <button class="modal-save-btn full-width" onclick="saveQuickAddSettings()"><i class="ti ti-device-floppy" aria-hidden="true"></i> Enregistrer</button>
    `;

    document.getElementById('qa-settings-condition').value = defaults.condition;
    document.getElementById('qa-settings-acquisition').value = defaults.acquisitionType;

    document.getElementById('quickadd-settings-overlay').classList.add('active');
    toggleQaSettingsPriceField();
    initDatePicker('#qa-settings-date', defaults.date || null);
}

function toggleQaSettingsPriceField() {
    const val = document.getElementById('qa-settings-acquisition').value;
    document.getElementById('qa-settings-price-group').style.display = val === 'pack' ? 'none' : '';
}

function closeQuickAddSettingsModal() {
    document.getElementById('quickadd-settings-overlay').classList.remove('active');
}

function saveQuickAddSettings() {
    const condition = document.getElementById('qa-settings-condition').value;
    const quantity = parseInt(document.getElementById('qa-settings-quantity').value) || 1;
    const acquisitionType = document.getElementById('qa-settings-acquisition').value;
    const purchasePrice = acquisitionType === 'pack' ? 0 : (parseFloat(document.getElementById('qa-settings-price').value) || 0);
    const date = document.getElementById('qa-settings-date').value || null;

    saveQuickAddDefaultsToStorage({ condition, quantity, acquisitionType, purchasePrice, date });
    showMessage('Réglages enregistrés', 'success');
    closeQuickAddSettingsModal();
}
let currentMarketValue = 0;    // Valeur marché (CardMarket) de la carte actuellement sélectionnée
let allCollectionCards = [];   // Cache local de la collection chargée depuis Supabase
let sortColumn = 'value';
let duplicatesOnlyFilter = false;
let sortDirection = 'desc';

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
function getSeriesSymbolPath(setId) {
    return `symbols/${sanitizeForPath(setId)}.webp`;
}

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

// ===== RECHERCHE DE CARTES (TCGdex) =====

function showSearchResultsSkeleton() {
    const container = document.getElementById('search-results');
    const rowsHtml = Array.from({ length: 4 }).map(() => `
        <div class="skeleton-row">
            <div class="skeleton" style="width:50px; height:70px; flex-shrink:0;"></div>
            <div style="flex:1;">
                <div class="skeleton" style="height:14px; width:60%; margin-bottom:8px;"></div>
                <div class="skeleton" style="height:11px; width:40%;"></div>
            </div>
        </div>
    `).join('');
    container.innerHTML = rowsHtml;
    container.classList.add('active');
}

let searchRequestId = 0;

async function searchCards() {
    const search = document.getElementById('card-search').value.trim();
    if (!search) {
        showMessage('Veuillez entrer un nom de carte', 'error');
        return;
    }

    const myRequestId = ++searchRequestId;

    const btn = document.getElementById('search-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="loading"></span>Recherche...';

    showSearchResultsSkeleton();

    try {
        const [frResponse, enResponse] = await Promise.all([
            fetch(`${API_BASE}/cards?name=${encodeURIComponent(search)}`),
            fetch(`${API_EN}/cards?name=${encodeURIComponent(search)}`)
        ]);

        const frData = await frResponse.json();
        const enData = await enResponse.json();

        // Une recherche plus récente a déjà démarré entre-temps : on abandonne celle-ci
        if (myRequestId !== searchRequestId) return;

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

        await displaySearchResults(merged);
        if (myRequestId !== searchRequestId) return;
        showMessage(`${merged.length} carte(s) trouvée(s)`, 'success');
    } catch (error) {
        if (myRequestId !== searchRequestId) return;
        showMessage('Erreur lors de la recherche', 'error');
        console.error(error);
    } finally {
        if (myRequestId === searchRequestId) {
            btn.disabled = false;
            btn.innerHTML = 'Chercher';
        }
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
    applySearchFilters();
}

function populateSearchFilters(cards) {
    const raritySelect = document.getElementById('filter-rarity');
    const seriesSelect = document.getElementById('filter-series');

    const currentRarity = raritySelect.value;
    const currentSeries = seriesSelect.value;

    const rarities = [...new Set(cards.map(c => c.rarity).filter(Boolean))].sort();
    const series = [...new Set(cards.map(c => c.set?.name).filter(Boolean))].sort();

    raritySelect.innerHTML = '<option value="">Toutes les raretés</option>' +
        rarities.map(r => `<option value="${r}">${r}</option>`).join('');

    seriesSelect.innerHTML = '<option value="">Toutes les séries</option>' +
        series.map(s => `<option value="${s}">${s}</option>`).join('');

    // Reappliquer la sélection précédente si elle existe toujours parmi les nouveaux résultats
    if (rarities.includes(currentRarity)) raritySelect.value = currentRarity;
    if (series.includes(currentSeries)) seriesSelect.value = currentSeries;
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
            ? `<img src="${imageUrl}" alt="${card.name}" class="search-result-img" onerror="this.outerHTML='<div class=&quot;no-image-placeholder small&quot;><i class=&quot;ti ti-photo-off&quot; aria-hidden=&quot;true&quot;></i></div>'">`
            : '<div class="no-image-placeholder small"><i class="ti ti-photo-off" aria-hidden="true"></i></div>';

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

    // Vérifier si cette carte est déjà dans la collection (par identifiant TCGdex)
    const duplicateAlert = document.getElementById('preview-duplicate-alert');
    const ownedRows = card.id ? allCollectionCards.filter(c => c.tcgdex_id === card.id) : [];
    if (ownedRows.length > 0) {
        const totalQty = ownedRows.reduce((sum, r) => sum + Number(r.quantity || 1), 0);
        const conditionsCount = {};
        ownedRows.forEach(r => {
            conditionsCount[r.condition] = (conditionsCount[r.condition] || 0) + Number(r.quantity || 1);
        });
        const conditionsText = Object.entries(conditionsCount).map(([cond, qty]) => `${cond} ×${qty}`).join(', ');

        duplicateAlert.innerHTML = `<span class="duplicate-alert-badge"><i class="ti ti-copy" aria-hidden="true"></i> Tu en as déjà ${totalQty} (${conditionsText})</span>`;
        duplicateAlert.style.display = 'block';
    } else {
        duplicateAlert.style.display = 'none';
        duplicateAlert.innerHTML = '';
    }

    const imageUrl = card.image ? `${card.image}/high.png` : '';
    const previewImageContainer = document.querySelector('.preview-image');

    document.getElementById('card-finish').innerHTML = buildFinishOptionsHtml(card, 'normal');

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

    document.getElementById('preview-rarity').innerHTML = `${getRarityIconHtml(card.rarity)} ${card.rarity || '-'}`;

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
            <i class="ti ti-photo-off" aria-hidden="true"></i><br>Pas d'image<br>
            <span class="upload-hint"><i class="ti ti-camera" aria-hidden="true"></i> Cliquer pour ajouter</span>
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
        const setId = getSetIdFromTcgdexId(card.tcgdex_id);
        const filename = `${sanitizeForPath(setId)}.webp`;
        if (stored.has(filename)) {
            const { data: urlData } = supabaseClient.storage.from('card-images').getPublicUrl(`logos/${filename}`);
            card.series_logo = urlData.publicUrl;
        }
    });
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

// Logique partagée d'ajout/fusion d'une carte en collection (utilisée par l'onglet Ajouter ET la vignette rapide depuis Progression)
// Enregistre un ajout dans l'historique mensuel persistant (indépendant des suppressions futures)
// Ajuste (positivement ou négativement) les compteurs d'un mois donné, pour réconcilier
// l'historique quand une carte existante est modifiée (date, quantité, prix payé)
async function adjustMonthlyStatsAmount(monthKey, quantityDelta, spentDelta, valueDelta) {
    const { data: existing, error: fetchError } = await supabaseClient
        .from('monthly_summary')
        .select('*')
        .eq('month', monthKey)
        .maybeSingle();

    if (fetchError) {
        console.error('Erreur lecture historique mensuel:', fetchError);
        return;
    }

    if (existing) {
        const { error } = await supabaseClient.from('monthly_summary').update({
            cards_added: Math.max(0, Number(existing.cards_added || 0) + quantityDelta),
            total_spent: Math.max(0, Number(existing.total_spent || 0) + spentDelta),
            value_added: Math.max(0, Number(existing.value_added || 0) + valueDelta),
            updated_at: new Date().toISOString()
        }).eq('id', existing.id);
        if (error) console.error('Erreur ajustement historique mensuel:', error);
    } else if (quantityDelta > 0) {
        const { error } = await supabaseClient.from('monthly_summary').insert([{
            month: monthKey,
            cards_added: quantityDelta,
            total_spent: Math.max(0, spentDelta),
            value_added: Math.max(0, valueDelta)
        }]);
        if (error) console.error('Erreur création historique mensuel:', error);
    }
}

async function recordMonthlyStats({ quantity, purchasePrice, marketValue, cardName, date }) {
    const targetDate = date || new Date();
    const monthKey = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}`;

    const { data: existing, error: fetchError } = await supabaseClient
        .from('monthly_summary')
        .select('*')
        .eq('month', monthKey)
        .maybeSingle();

    if (fetchError) {
        console.error('Erreur lecture historique mensuel:', fetchError);
        return;
    }

    const addedSpent = purchasePrice * quantity;
    const addedValue = marketValue * quantity;

    if (existing) {
        let topCardName = existing.top_card_name;
        let topCardValue = Number(existing.top_card_value || 0);
        if (marketValue > topCardValue) {
            topCardValue = marketValue;
            topCardName = cardName;
        }

        const { error } = await supabaseClient.from('monthly_summary').update({
            cards_added: Number(existing.cards_added || 0) + quantity,
            total_spent: Number(existing.total_spent || 0) + addedSpent,
            value_added: Number(existing.value_added || 0) + addedValue,
            top_card_name: topCardName,
            top_card_value: topCardValue,
            updated_at: new Date().toISOString()
        }).eq('id', existing.id);

        if (error) console.error('Erreur mise à jour historique mensuel:', error);
    } else {
        const { error } = await supabaseClient.from('monthly_summary').insert([{
            month: monthKey,
            cards_added: quantity,
            total_spent: addedSpent,
            value_added: addedValue,
            top_card_name: cardName,
            top_card_value: marketValue
        }]);

        if (error) console.error('Erreur création historique mensuel:', error);
    }
}

async function performCardAdd(card, { condition, quantity, acquisitionType, purchasePrice, customImage, onImageUploadStart, customDate, finish = 'normal' }) {
    const name = card.name || '?';
    const series = card.set?.name || 'N/A';
    const number = card.localId || '?';

    // Image, logo de série et recherche de doublon ne dépendent pas les uns des autres : on les lance en parallèle
    const imagePromise = (async () => {
        if (customImage) return customImage;
        if (card.image) {
            const tcgdexUrl = `${card.image}/high.png`;
            if (onImageUploadStart) onImageUploadStart();
            try {
                return await fetchAndUploadExternalImage(tcgdexUrl, card.id);
            } catch (error) {
                console.error('Echec hébergement image, fallback lien TCGdex:', error);
                return tcgdexUrl;
            }
        } else if (card.id) {
            const existingUrl = await checkExistingImage(card.id);
            return existingUrl || '';
        }
        return '';
    })();

    const logoPromise = (async () => {
        if (card.set?.logo && card.set?.id) {
            try {
                return await fetchAndUploadSeriesLogo(card.set.logo, card.set.id);
            } catch (error) {
                console.error('Logo de série non récupéré:', error);
                return null;
            }
        }
        return null;
    })();

    const symbolPromise = (async () => {
        if (card.set?.symbol && card.set?.id) {
            try {
                return await fetchAndUploadSeriesSymbol(card.set.symbol, card.set.id);
            } catch (error) {
                console.error('Symbole de set non récupéré:', error);
                return null;
            }
        }
        return null;
    })();

    const existingRowPromise = findExistingCardRow(card.id, name, series, number, condition, finish);

    const [imageUrl, seriesLogoUrl, seriesSymbolUrl, existingRow] = await Promise.all([imagePromise, logoPromise, symbolPromise, existingRowPromise]);

    const marketValue = getMarketValueForFinish(card, finish);

    // Date d'acquisition : utilise la date fournie (antidatage) ou aujourd'hui par défaut
    const acquisitionDate = customDate ? new Date(customDate + 'T12:00:00') : new Date();
    const dateAddedStr = acquisitionDate.toLocaleDateString('fr-FR');

    if (existingRow) {
        const newQuantity = Number(existingRow.quantity || 1) + quantity;
        const updatePayload = { quantity: newQuantity, market_value: marketValue };
        if (!existingRow.image && imageUrl) updatePayload.image = imageUrl;
        if (!existingRow.series_logo && seriesLogoUrl) updatePayload.series_logo = seriesLogoUrl;
        if (!existingRow.series_symbol && seriesSymbolUrl) updatePayload.series_symbol = seriesSymbolUrl;
        if (!existingRow.cardmarket_id && card.pricing?.cardmarket?.idProduct) {
            updatePayload.cardmarket_id = card.pricing.cardmarket.idProduct;
        }

        // La mise à jour de la carte et l'historique mensuel sont indépendants : en parallèle
        const [updateResult] = await Promise.all([
            supabaseClient.from('cards').update(updatePayload).eq('id', existingRow.id),
            recordMonthlyStats({ quantity, purchasePrice, marketValue, cardName: name, date: acquisitionDate })
        ]);
        if (updateResult.error) throw updateResult.error;

        // Simple instantané (pas de pré-remplissage, la carte existe déjà dans l'historique)
        if (card.id && marketValue > 0) {
            supabaseClient.from('card_price_history').insert([{ tcgdex_id: card.id, market_value: marketValue }])
                .then(({ error }) => { if (error) console.error('Erreur historique prix carte:', error); });
        }

        return { merged: true, newQuantity };
    }

    let types = 'N/A';
    if (card.types && Array.isArray(card.types)) {
        types = card.types.join(', ');
    }

    // Idem : l'insertion de la carte et l'historique mensuel sont indépendants
    const [insertResult] = await Promise.all([
        supabaseClient.from('cards').insert([{
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
            series_symbol: seriesSymbolUrl,
            tcgdex_id: card.id || null,
            cardmarket_id: card.pricing?.cardmarket?.idProduct || null,
            date_added: dateAddedStr,
            created_at: acquisitionDate.toISOString(),
            finish
        }]),
        recordMonthlyStats({ quantity, purchasePrice, marketValue, cardName: name, date: acquisitionDate })
    ]);
    if (insertResult.error) throw insertResult.error;

    // Nouvelle carte : on pré-remplit l'historique avec les moyennes TCGdex (avg1/avg7/avg30) en plus
    // de l'instantané actuel, pour avoir un vrai repère de tendance dès le premier ajout
    if (card.id && marketValue > 0) {
        const historyRows = [{ tcgdex_id: card.id, market_value: marketValue }];
        const cm = card.pricing?.cardmarket;
        const nowMs = Date.now();

        if (cm && typeof cm.avg1 === 'number' && cm.avg1 > 0) {
            historyRows.push({
                tcgdex_id: card.id,
                market_value: cm.avg1,
                recorded_at: new Date(nowMs - 1 * 24 * 60 * 60 * 1000).toISOString()
            });
        }
        if (cm && typeof cm.avg7 === 'number' && cm.avg7 > 0) {
            historyRows.push({
                tcgdex_id: card.id,
                market_value: cm.avg7,
                recorded_at: new Date(nowMs - 7 * 24 * 60 * 60 * 1000).toISOString()
            });
        }
        if (cm && typeof cm.avg30 === 'number' && cm.avg30 > 0) {
            historyRows.push({
                tcgdex_id: card.id,
                market_value: cm.avg30,
                recorded_at: new Date(nowMs - 30 * 24 * 60 * 60 * 1000).toISOString()
            });
        }

        supabaseClient.from('card_price_history').insert(historyRows)
            .then(({ error }) => { if (error) console.error('Erreur historique prix carte:', error); });
    }

    return { merged: false };
}

async function addCard() {
    if (!selectedCard) {
        showMessage('Veuillez sélectionner une carte', 'error');
        return;
    }

    const condition = document.getElementById('card-condition').value;
    const finish = document.getElementById('card-finish').value;
    const quantity = parseInt(document.getElementById('card-quantity').value) || 1;
    const acquisitionType = document.getElementById('card-acquisition').value;
    const purchasePrice = acquisitionType === 'pack'
        ? 0
        : (parseFloat(document.getElementById('card-value').value) || 0);
    const customDate = document.getElementById('card-date-added').value || null;

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
            customDate,
            finish,
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
    document.getElementById('card-finish').innerHTML = '<option value="normal">Normale</option>';
    document.getElementById('card-value').value = '';
    document.getElementById('card-acquisition').value = 'achat';
    const cardDateInput = document.getElementById('card-date-added');
    if (cardDateInput._flatpickr) cardDateInput._flatpickr.clear();
    document.getElementById('purchase-price-group').style.display = '';
    document.getElementById('card-preview').classList.remove('active');
    selectedCard = null;
    customPreviewImage = null;
    currentMarketValue = 0;

    await refreshCollection();
    await recordValueSnapshot();
}

async function deleteCard(id) {
    if (!await showConfirmModal('Supprimer cette carte ?', 'Supprimer')) return;

    const { error } = await supabaseClient.from('cards').delete().eq('id', id);

    if (error) {
        showMessage('Erreur lors de la suppression', 'error');
        console.error(error);
        return;
    }

    await refreshCollection();
    await recordValueSnapshot();

    // Si la grille de Progression est ouverte derrière la fenêtre, la rafraîchir aussi
    const progressionSetView = document.getElementById('progression-set-view');
    if (progressionSetView && progressionSetView.style.display === 'block') {
        renderProgressionCardsGrid();
    }
}

async function changeQuantity(id, delta) {
    const card = allCollectionCards.find(c => c.id === id);
    if (!card) return;

    const newQuantity = Number(card.quantity || 1) + delta;

    if (newQuantity <= 0) {
        if (!await showConfirmModal('Retirer complètement cette carte de la collection ?', 'Retirer')) return;
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

    // Si la grille de Progression est ouverte derrière la fenêtre, la rafraîchir aussi
    const progressionSetView = document.getElementById('progression-set-view');
    if (progressionSetView && progressionSetView.style.display === 'block') {
        renderProgressionCardsGrid();
    }
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

    // On ne recalcule les graphiques (coûteux : plusieurs requêtes + Chart.js) que si l'onglet est réellement affiché
    if (document.getElementById('tab-stats').classList.contains('active')) {
        renderStatsCharts();
    }
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

let collectionRarityFilterValues = new Set();

function setCollectionRarityFilter(value) {
    if (value === '') {
        collectionRarityFilterValues.clear();
    } else if (collectionRarityFilterValues.has(value)) {
        collectionRarityFilterValues.delete(value);
    } else {
        collectionRarityFilterValues.add(value);
    }
    renderCollectionRarityRow();
    filterAndDisplay();
}

function renderCollectionRarityRow() {
    const rarities = sortRaritiesByTier([...new Set(allCollectionCards.map(c => c.rarity).filter(Boolean))]);
    document.getElementById('filter-collection-rarity-row').innerHTML =
        buildRarityFilterRowHtml(rarities, collectionRarityFilterValues, 'setCollectionRarityFilter');
}

function populateCollectionFilters() {
    const seriesSelect = document.getElementById('filter-collection-series');
    const typeSelect = document.getElementById('filter-collection-type');

    const currentSeries = seriesSelect.value;
    const currentType = typeSelect.value;

    const series = [...new Set(allCollectionCards.map(c => c.series).filter(Boolean))].sort();
    const types = [...new Set(allCollectionCards.map(c => c.type).filter(Boolean))].sort();

    seriesSelect.innerHTML = '<option value="">Toutes les séries</option>' +
        series.map(s => `<option value="${s}">${s}</option>`).join('');
    typeSelect.innerHTML = '<option value="">Tous les types</option>' +
        types.map(t => `<option value="${t}">${t}</option>`).join('');

    renderCollectionRarityRow();

    // Réappliquer la sélection précédente si elle existe toujours
    if (series.includes(currentSeries)) seriesSelect.value = currentSeries;
    if (types.includes(currentType)) typeSelect.value = currentType;
}

// Identifiant de regroupement d'une carte (même carte, peu importe l'état) pour détecter les doublons
function getDuplicateGroupKey(card) {
    const finishKey = card.finish || 'normal';
    return card.tcgdex_id ? `id:${card.tcgdex_id}:${finishKey}` : `nsn:${card.name}|${card.series}|${card.number}|${finishKey}`;
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

// ===== IMPORT CSV EN MASSE =====

function toggleCsvDropdown(event) {
    event.stopPropagation();
    document.getElementById('csv-dropdown-menu').classList.toggle('active');
}

function closeCsvDropdown() {
    document.getElementById('csv-dropdown-menu').classList.remove('active');
}

document.addEventListener('click', (e) => {
    const menu = document.getElementById('csv-dropdown-menu');
    if (menu && menu.classList.contains('active') && !e.target.closest('.csv-dropdown-wrap')) {
        menu.classList.remove('active');
    }
});

// ===== SAUVEGARDE / RESTAURATION COMPLETE (JSON) =====

async function exportFullBackupJson() {
    showMessage('Préparation de la sauvegarde...', 'success');

    try {
        const [cardsRes, wishlistsRes, wishlistItemsRes, valueHistoryRes, priceHistoryRes, monthlySummaryRes] = await Promise.all([
            supabaseClient.from('cards').select('*'),
            supabaseClient.from('wishlists').select('*'),
            supabaseClient.from('wishlist').select('*'),
            supabaseClient.from('value_history').select('*'),
            supabaseClient.from('card_price_history').select('*'),
            supabaseClient.from('monthly_summary').select('*')
        ]);

        const backup = {
            exportedAt: new Date().toISOString(),
            version: 1,
            cards: cardsRes.data || [],
            wishlists: wishlistsRes.data || [],
            wishlistItems: wishlistItemsRes.data || [],
            valueHistory: valueHistoryRes.data || [],
            cardPriceHistory: priceHistoryRes.data || [],
            monthlySummary: monthlySummaryRes.data || []
        };

        const jsonContent = JSON.stringify(backup, null, 2);
        const blob = new Blob([jsonContent], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const dateStr = new Date().toISOString().split('T')[0];
        link.download = `sauvegarde-pokemon-tracker-${dateStr}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        showMessage('Sauvegarde téléchargée !', 'success');
    } catch (error) {
        showMessage('Erreur lors de la préparation de la sauvegarde', 'error');
        console.error(error);
    }
}

function handleJsonRestore(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = JSON.parse(e.target.result);
            await confirmAndProcessJsonRestore(data);
        } catch (error) {
            showMessage('Fichier de sauvegarde invalide ou illisible', 'error');
            console.error(error);
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

async function confirmAndProcessJsonRestore(data) {
    const cardCount = data.cards?.length || 0;
    const wishlistCount = data.wishlists?.length || 0;

    if (!await showConfirmModal(
        `Restaurer va importer jusqu'à ${cardCount} carte(s) et ${wishlistCount} liste(s) de souhaits. Les cartes et souhaits déjà présents dans ta collection actuelle seront automatiquement ignorés (pas de doublons créés). Continuer ?`,
        'Restaurer'
    )) return;

    const content = document.getElementById('csv-import-content');
    document.getElementById('csv-import-overlay').classList.add('active');
    content.innerHTML = `
        <div class="modal-title" style="margin-bottom: 1rem;">Restauration en cours...</div>
        <p style="color: var(--slate);">Merci de patienter, ne ferme pas cette fenêtre.</p>
    `;

    const errors = [];
    let cardsInserted = 0, cardsSkipped = 0;
    let wishlistsCreated = 0, wishlistsReused = 0;
    let itemsInserted = 0, itemsSkipped = 0;

    // 1. Listes de souhaits : réutiliser celle existante si le nom correspond déjà
    const wishlistIdMap = {};
    try {
        if (data.wishlists && data.wishlists.length > 0) {
            for (const w of data.wishlists) {
                const existing = allWishlists.find(existingW => existingW.name === w.name);
                if (existing) {
                    wishlistIdMap[w.id] = existing.id;
                    wishlistsReused++;
                } else {
                    const { id: oldId, ...rest } = w;
                    const { data: inserted, error } = await supabaseClient.from('wishlists').insert([rest]).select().single();
                    if (!error && inserted) {
                        wishlistIdMap[oldId] = inserted.id;
                        wishlistsCreated++;
                    }
                }
            }
        }
    } catch (error) {
        errors.push('listes de souhaits');
        console.error(error);
    }

    // 2. Cartes de souhaits : ignorer si déjà présente dans la même liste (même tcgdex_id)
    try {
        if (data.wishlistItems && data.wishlistItems.length > 0) {
            const rowsToInsert = [];
            for (const item of data.wishlistItems) {
                const newWishlistId = wishlistIdMap[item.wishlist_id];
                if (!newWishlistId) continue;

                const alreadyExists = allWishlistItems.some(existingItem =>
                    existingItem.wishlist_id === newWishlistId && existingItem.tcgdex_id === item.tcgdex_id
                );
                if (alreadyExists) {
                    itemsSkipped++;
                    continue;
                }

                const { id, ...rest } = item;
                rowsToInsert.push({ ...rest, wishlist_id: newWishlistId });
            }
            if (rowsToInsert.length > 0) {
                const { error } = await supabaseClient.from('wishlist').insert(rowsToInsert);
                if (error) throw error;
                itemsInserted = rowsToInsert.length;
            }
        }
    } catch (error) {
        errors.push('cartes de souhaits');
        console.error(error);
    }

    // 3. Collection : ignorer si une carte identique (même tcgdex_id + état, ou nom/série/numéro/état) existe déjà
    try {
        if (data.cards && data.cards.length > 0) {
            const rowsToInsert = [];
            for (const card of data.cards) {
                const exists = allCollectionCards.some(c => {
                    if (card.tcgdex_id && c.tcgdex_id) {
                        return c.tcgdex_id === card.tcgdex_id && c.condition === card.condition;
                    }
                    return c.name === card.name && c.series === card.series && c.number === card.number && c.condition === card.condition;
                });
                if (exists) {
                    cardsSkipped++;
                    continue;
                }
                const { id, ...rest } = card;
                rowsToInsert.push(rest);
            }
            for (let i = 0; i < rowsToInsert.length; i += 100) {
                const { error } = await supabaseClient.from('cards').insert(rowsToInsert.slice(i, i + 100));
                if (error) throw error;
            }
            cardsInserted = rowsToInsert.length;
        }
    } catch (error) {
        errors.push('collection de cartes');
        console.error(error);
    }

    // 4. Historiques de valeur/prix : simples journaux, pas de notion de doublon à vérifier
    try {
        if (data.valueHistory && data.valueHistory.length > 0) {
            const rows = data.valueHistory.map(({ id, ...rest }) => rest);
            for (let i = 0; i < rows.length; i += 200) {
                await supabaseClient.from('value_history').insert(rows.slice(i, i + 200));
            }
        }
    } catch (error) {
        errors.push('historique de valeur');
        console.error(error);
    }

    try {
        if (data.cardPriceHistory && data.cardPriceHistory.length > 0) {
            const rows = data.cardPriceHistory.map(({ id, ...rest }) => rest);
            for (let i = 0; i < rows.length; i += 200) {
                await supabaseClient.from('card_price_history').insert(rows.slice(i, i + 200));
            }
        }
    } catch (error) {
        errors.push('historique de prix par carte');
        console.error(error);
    }

    // 5. Historique mensuel : ignorer les mois déjà présents (contrainte unique sur "month")
    try {
        if (data.monthlySummary && data.monthlySummary.length > 0) {
            const { data: existingMonthsData } = await supabaseClient.from('monthly_summary').select('month');
            const existingMonths = new Set((existingMonthsData || []).map(m => m.month));
            const rows = data.monthlySummary
                .filter(m => !existingMonths.has(m.month))
                .map(({ id, ...rest }) => rest);
            if (rows.length > 0) {
                const { error } = await supabaseClient.from('monthly_summary').insert(rows);
                if (error) throw error;
            }
        }
    } catch (error) {
        errors.push('historique mensuel');
        console.error(error);
    }

    await refreshCollection();
    await loadWishlists();

    content.innerHTML = `
        <div class="modal-title" style="margin-bottom: 1rem;">Restauration terminée</div>
        <p style="color: var(--text-primary); line-height: 1.6;">
            <strong style="color: #4ade80;">${cardsInserted}</strong> carte(s) ajoutée(s) <span style="color: var(--slate);">· ${cardsSkipped} déjà présente(s), ignorée(s)</span><br>
            <strong style="color: #4ade80;">${wishlistsCreated}</strong> liste(s) créée(s) <span style="color: var(--slate);">· ${wishlistsReused} réutilisée(s)</span><br>
            <strong style="color: #4ade80;">${itemsInserted}</strong> souhait(s) ajouté(s) <span style="color: var(--slate);">· ${itemsSkipped} déjà présent(s), ignoré(s)</span>
            ${errors.length > 0 ? `<br><span style="color: #ff6b6b;">Soucis sur : ${errors.join(', ')}</span>` : ''}
        </p>
        <button class="modal-save-btn full-width" style="margin-top: 1.25rem;" onclick="document.getElementById('csv-import-overlay').classList.remove('active')">Fermer</button>
    `;
}

function downloadCsvTemplate() {
    const headers = ['Nom', 'Serie', 'Numero', 'Etat', 'Quantite', 'Prix', 'Obtention', 'Date'];
    const example = ['Pikachu', 'Ecarlate et Violet', '025', 'NM', '1', '3.50', 'achat', '15/03/2026'];
    const csvContent = '\uFEFF' + [headers.join(','), example.join(',')].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'modele-import-pokemon.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// Déduit l'identifiant du set à partir d'un identifiant TCGdex de carte (ex: "sv08-097" -> "sv08").
// Utilise le DERNIER tiret (pas le premier) car certains sets ont eux-mêmes un tiret dans leur
// identifiant (ex: séries ".5" comme Héros Transcendants, probablement "me2-5"), ce qui les
// confondrait sinon avec le set principal (ex: "me2" Flammes Fantasmagoriques).
function getSetIdFromTcgdexId(tcgdexId) {
    if (!tcgdexId) return null;
    const lastDash = tcgdexId.lastIndexOf('-');
    return lastDash === -1 ? tcgdexId : tcgdexId.substring(0, lastDash);
}

function normalizeForMatch(str) {
    return (str || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

// Correspondance entre le texte de rareté (tel que renvoyé par TCGdex) et l'icône fournie par l'utilisateur.
// Plusieurs variantes par icône pour maximiser les chances de correspondance selon les libellés/époques.
// Si aucune correspondance : on affiche simplement le texte comme avant, rien ne casse.
const RARITY_ICON_MAP = {
    // Commune
    'commune': 'commune.webp',
    'common': 'commune.webp',

    // Peu commune
    'peu commune': 'peu-commune.webp',
    'uncommon': 'peu-commune.webp',

    // Holo (rare de base) - "Holo Rare" est un renommage plus récent de "Rare Holo"
    'rare': 'holo.webp',
    'rare holo': 'holo.webp',
    'holo rare': 'holo.webp',
    'holographique': 'holo.webp',

    // Double rare - inclut les V/VMAX/VSTAR non full-art, équivalent historique
    'double rare': 'double-rare.png',
    'holo rare v': 'double-rare.png',
    'holo rare vmax': 'double-rare.png',
    'holo rare vstar': 'double-rare.png',
    'shiny rare v': 'double-rare.png',
    'shiny rare vmax': 'double-rare.png',

    // Ultra rare - mécaniques spéciales historiques de rang comparable
    'ultra rare': 'ultra-rare.png',
    'shiny ultra rare': 'ultra-rare.png',
    'amazing rare': 'ultra-rare.png',
    'magnifique rare': 'ultra-rare.png',
    'radiant rare': 'ultra-rare.png',
    'rare prime': 'ultra-rare.png',
    'legend': 'ultra-rare.png',
    'rare holo lv.x': 'ultra-rare.png',
    'full art trainer': 'ultra-rare.png',
    'ace spec rare': 'ultra-rare.png',

    // Illustration rare
    'illustration rare': 'illustration-rare.png',

    // Illustration spéciale rare
    'special illustration rare': 'illustration-speciale-rare.png',
    'illustration speciale rare': 'illustration-speciale-rare.png',

    // Top tier / secrètes
    'hyper rare': 'mega-hyper-rare.webp',
    'mega hyper rare': 'mega-hyper-rare.webp',
    'secret rare': 'mega-hyper-rare.webp',
    'shiny rare': 'mega-hyper-rare.webp',
    'black white rare': 'mega-hyper-rare.webp',
    'classic collection': 'mega-hyper-rare.webp',

    // Promo
    'promo': 'promo.webp'
};

// Ordre d'affichage des raretés (du plus commun au plus rare), reprenant l'ordre visuel fourni
const RARITY_ORDER = [
    'commune.webp',
    'peu-commune.webp',
    'holo.webp',
    'double-rare.png',
    'illustration-rare.png',
    'ultra-rare.png',
    'illustration-speciale-rare.png',
    'mega-hyper-rare.webp',
    'promo.webp'
];

function sortRaritiesByTier(rarities) {
    return [...rarities].sort((a, b) => {
        const fileA = RARITY_ICON_MAP[normalizeForMatch(a)];
        const fileB = RARITY_ICON_MAP[normalizeForMatch(b)];
        const rankA = fileA ? RARITY_ORDER.indexOf(fileA) : 999;
        const rankB = fileB ? RARITY_ORDER.indexOf(fileB) : 999;
        if (rankA !== rankB) return rankA - rankB;
        return a.localeCompare(b);
    });
}

// Renvoie un libellé court pour la finition, ou null pour "normal" (pas besoin de l'afficher)
// Construit la liste des finitions réellement disponibles pour une carte donnée,
// à partir de variants_detailed (ex: Normale, Reverse, Pokéball, Énergie...)
function buildFinishOptionsFromCard(card) {
    const variants = card?.variants_detailed;
    const options = [];
    const seen = new Set();

    const addOption = (value, label) => {
        if (!seen.has(value)) {
            seen.add(value);
            options.push({ value, label });
        }
    };

    if (Array.isArray(variants) && variants.length > 0) {
        variants.forEach(v => {
            if (v.foil) {
                addOption(v.foil, v.foil);
            } else if (v.type === 'Normal' || v.type === 'Holo') {
                addOption('normal', 'Normale');
            } else if (v.type === 'Reverse') {
                addOption('reverse', 'Reverse');
            } else if (v.type) {
                addOption(v.type.toLowerCase().replace(/\s+/g, '_'), v.type);
            }
        });
    }

    // Toujours garantir "Normale" en secours, même si l'info n'est pas dans variants_detailed
    if (!seen.has('normal')) {
        options.unshift({ value: 'normal', label: 'Normale' });
    }

    return options;
}

// Construit le HTML des <option> pour un select de finition, à partir d'une carte
function buildFinishOptionsHtml(card, selectedValue = 'normal') {
    const options = buildFinishOptionsFromCard(card);
    return options.map(o => `<option value="${o.value}" ${o.value === selectedValue ? 'selected' : ''}>${o.label}</option>`).join('');
}

// Récupère le prix de marché correspondant exactement à la finition choisie, avec repli
// sur le prix Reverse classique, puis sur le prix Normal si rien de plus précis n'est trouvé
function getMarketValueForFinish(card, finishValue) {
    const variants = card?.variants_detailed;

    if (Array.isArray(variants) && variants.length > 0) {
        const matches = (v) => {
            if (v.foil) return v.foil === finishValue;
            if (v.type === 'Normal' || v.type === 'Holo') return finishValue === 'normal';
            if (v.type === 'Reverse') return finishValue === 'reverse';
            if (v.type) return finishValue === v.type.toLowerCase().replace(/\s+/g, '_');
            return false;
        };

        const exact = variants.find(matches);
        const exactPrice = exact?.pricing?.cardmarket?.avg ?? exact?.pricing?.cardmarket?.['avg-holo'];
        if (typeof exactPrice === 'number') return exactPrice;

        // Repli : prix Reverse classique (sans foil particulier)
        const reverseFallback = variants.find(v => v.type === 'Reverse' && !v.foil);
        const reversePrice = reverseFallback?.pricing?.cardmarket?.avg ?? reverseFallback?.pricing?.cardmarket?.['avg-holo'];
        if (typeof reversePrice === 'number') return reversePrice;

        // Dernier repli : prix Normal
        const normalFallback = variants.find(v => v.type === 'Normal');
        const normalPrice = normalFallback?.pricing?.cardmarket?.avg;
        if (typeof normalPrice === 'number') return normalPrice;
    }

    // Filet de sécurité générique (carte sans variants_detailed disponible)
    if (card?.pricing?.cardmarket?.avg) return card.pricing.cardmarket.avg;
    if (card?.pricing?.cardmarket?.['avg-holo']) return card.pricing.cardmarket['avg-holo'];
    return 0;
}

// Icônes de foil hébergées par l'utilisateur directement dans Supabase Storage (pas de fichier local)
const FOIL_ICON_MAP = {
    'pokeball': 'https://mmdcpkwygqsdaqnkimwb.supabase.co/storage/v1/object/public/card-images/ball/pokeball.png',
    'energie': 'https://mmdcpkwygqsdaqnkimwb.supabase.co/storage/v1/object/public/card-images/ball/energy.png',
    'copain ball': 'https://mmdcpkwygqsdaqnkimwb.supabase.co/storage/v1/object/public/card-images/ball/friendball.png',
    'love ball': 'https://mmdcpkwygqsdaqnkimwb.supabase.co/storage/v1/object/public/card-images/ball/loveball.png',
    'rapide ball': 'https://mmdcpkwygqsdaqnkimwb.supabase.co/storage/v1/object/public/card-images/ball/quickball.png',
    'team rocket': 'https://mmdcpkwygqsdaqnkimwb.supabase.co/storage/v1/object/public/card-images/ball/rocket.png',
    'sombre ball': 'https://mmdcpkwygqsdaqnkimwb.supabase.co/storage/v1/object/public/card-images/ball/duskball.png',
    'master ball': 'https://mmdcpkwygqsdaqnkimwb.supabase.co/storage/v1/object/public/card-images/ball/masterball.png'
};

function getFoilIconHtml(finish, sizePx = 16) {
    const url = FOIL_ICON_MAP[normalizeForMatch(finish)];
    if (!url) return '';
    return `<img src="${url}" alt="" class="foil-icon" style="width:${sizePx}px;height:${sizePx}px;">`;
}

// Construit le badge de finition : icône seule + info-bulle au survol si une icône existe,
// sinon le texte simple (ex: "Reverse", "1ère éd." qui n'ont pas d'icône dédiée)
function renderFinishBadge(finish, className, iconSize = 12) {
    const label = getFinishLabel(finish);
    if (!label) return '';
    const icon = getFoilIconHtml(finish, iconSize);
    if (icon) {
        return `<span class="${className}" data-tooltip="${label}">${icon}</span>`;
    }
    return `<span class="${className}">${label}</span>`;
}

function getFinishLabel(finish) {
    if (!finish || finish === 'normal') return null;
    const labels = { reverse: 'Reverse', holo: 'Holo', first_edition: '1ère éd.' };
    return labels[finish] || finish; // sinon on affiche le foil tel quel (Pokéball, Énergie...)
}

function getRarityIconHtml(rarity, sizePx = 16) {
    const filename = RARITY_ICON_MAP[normalizeForMatch(rarity)];
    if (!filename) return '';
    return `<img src="images/rarity/${filename}" alt="" class="rarity-icon" style="width:${sizePx}px;height:${sizePx}px;">`;
}

// Construit une ligne de boutons icônes pour filtrer par rareté (multi-sélection possible)
function buildRarityFilterRowHtml(rarities, activeValues, clickHandlerName) {
    const allBtn = `<button class="rarity-filter-btn ${activeValues.size === 0 ? 'active' : ''}" onclick="${clickHandlerName}('')" data-tooltip="Toutes les raretés" aria-label="Toutes les raretés"><i class="ti ti-asterisk" aria-hidden="true"></i></button>`;

    const rarityBtns = rarities.map(r => {
        const icon = getRarityIconHtml(r, 20);
        const isActive = activeValues.has(r);
        const safeR = r.replace(/'/g, "\\'");
        const content = icon || `<span class="rarity-filter-text">${r}</span>`;
        return `<button class="rarity-filter-btn ${isActive ? 'active' : ''} ${icon ? '' : 'rarity-filter-btn-text'}" onclick="${clickHandlerName}('${safeR}')" data-tooltip="${r}" aria-label="${r}">${content}</button>`;
    }).join('');

    return allBtn + rarityBtns;
}

// Convertit une date jj/mm/aaaa (saisie dans le CSV) en aaaa-mm-jj (attendu par performCardAdd)
function parseCsvDate(str) {
    if (!str) return null;
    const parts = str.trim().split(/[\/\-]/);
    if (parts.length !== 3) return null;
    const [d, m, y] = parts;
    if (!d || !m || !y) return null;
    return `${y.padStart(4, '20')}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

// Cherche la carte correspondante sur TCGdex (nom + série + numéro)
async function findTcgdexMatch(nom, serie, numero) {
    const [frRes, enRes] = await Promise.all([
        fetch(`${API_BASE}/cards?name=${encodeURIComponent(nom)}`),
        fetch(`${API_EN}/cards?name=${encodeURIComponent(nom)}`)
    ]);
    const frData = await frRes.json();
    const enData = await enRes.json();
    const combined = [...(Array.isArray(frData) ? frData : []), ...(Array.isArray(enData) ? enData : [])];

    const normNum = normalizeForMatch(numero).replace(/^0+/, '');
    const normSerie = normalizeForMatch(serie);

    const matches = combined.filter(c => {
        const cNum = normalizeForMatch(c.localId).replace(/^0+/, '');
        const cSet = normalizeForMatch(c.set?.name);
        const numMatches = normNum === '' || cNum === normNum;
        const serieMatches = normSerie === '' || cSet.includes(normSerie) || normSerie.includes(cSet);
        return numMatches && serieMatches;
    });

    // Dédupliquer par id (une carte peut apparaître via la recherche FR et EN)
    return [...new Map(matches.map(m => [m.id, m])).values()];
}

function handleCsvImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
            processCsvImportRows(results.data);
        },
        error: (error) => {
            showMessage('Erreur lors de la lecture du fichier CSV', 'error');
            console.error(error);
        }
    });

    event.target.value = ''; // permet de réimporter le même fichier si besoin
}

async function processCsvImportRows(rows) {
    const content = document.getElementById('csv-import-content');
    document.getElementById('csv-import-overlay').classList.add('active');

    const validRows = rows.filter(r => r.Nom && r.Nom.trim());
    const total = validRows.length;

    if (total === 0) {
        content.innerHTML = `
            <div class="modal-title" style="margin-bottom: 1rem;">Import CSV</div>
            <p style="color: var(--slate);">Aucune ligne valide trouvée dans ce fichier (colonne "Nom" manquante ou vide).</p>
            <button class="modal-save-btn full-width" style="margin-top: 1rem;" onclick="document.getElementById('csv-import-overlay').classList.remove('active')">Fermer</button>
        `;
        return;
    }

    let successCount = 0;
    const failures = [];

    for (let i = 0; i < validRows.length; i++) {
        const row = validRows[i];
        content.innerHTML = `
            <div class="modal-title" style="margin-bottom: 1rem;">Import en cours...</div>
            <p style="color: var(--slate);">${i + 1} / ${total} — ${row.Nom}</p>
        `;

        try {
            const matches = await findTcgdexMatch(row.Nom, row.Serie, row.Numero);

            if (matches.length !== 1) {
                failures.push({
                    nom: row.Nom,
                    raison: matches.length === 0 ? 'Aucune correspondance trouvée' : `${matches.length} correspondances possibles (ambigu)`
                });
                continue;
            }

            // Récupérer les détails complets (prix, image...) pour un ajout fidèle
            let detail = null;
            try {
                let r = await fetch(`${API_BASE}/cards/${matches[0].id}`);
                let d = await r.json();
                if (!d || d.status) {
                    const r2 = await fetch(`${API_EN}/cards/${matches[0].id}`);
                    d = await r2.json();
                }
                if (d && !d.status) detail = d;
            } catch (e) { /* on utilisera le filet de sécurité ci-dessous */ }

            if (!detail) detail = matches[0];

            const condition = (row.Etat || 'NM').trim().toUpperCase();
            const quantity = parseInt(row.Quantite) || 1;
            const purchasePrice = parseFloat((row.Prix || '0').replace(',', '.')) || 0;
            const acquisitionType = normalizeForMatch(row.Obtention) === 'booster' ? 'pack' : 'achat';
            const customDate = parseCsvDate(row.Date);

            await performCardAdd(detail, {
                condition: ['NM', 'LP', 'MP', 'HP'].includes(condition) ? condition : 'NM',
                quantity,
                acquisitionType,
                purchasePrice,
                customImage: null,
                customDate
            });

            successCount++;
        } catch (error) {
            failures.push({ nom: row.Nom, raison: 'Erreur inattendue' });
            console.error(error);
        }
    }

    await refreshCollection();
    await recordValueSnapshot();

    const failuresHtml = failures.length === 0
        ? ''
        : `
            <div style="margin-top: 1rem; max-height: 200px; overflow-y: auto;">
                <div style="color: var(--slate); font-size: 0.8rem; margin-bottom: 0.5rem;">Lignes ignorées :</div>
                ${failures.map(f => `
                    <div style="font-size: 0.8rem; padding: 0.4rem 0; border-bottom: 1px solid var(--border);">
                        <strong>${f.nom}</strong> — <span style="color: var(--slate);">${f.raison}</span>
                    </div>
                `).join('')}
            </div>
        `;

    content.innerHTML = `
        <div class="modal-title" style="margin-bottom: 1rem;">Import terminé</div>
        <p style="color: var(--text-primary);">
            <span style="color: #4ade80; font-weight: 700;">${successCount}</span> carte(s) ajoutée(s)
            ${failures.length > 0 ? `· <span style="color: #ff6b6b; font-weight: 700;">${failures.length}</span> ignorée(s)` : ''}
        </p>
        ${failuresHtml}
        <button class="modal-save-btn full-width" style="margin-top: 1.25rem;" onclick="document.getElementById('csv-import-overlay').classList.remove('active')">Fermer</button>
    `;
}

function filterAndDisplay() {
    const searchTerm = document.getElementById('search-collection').value.toLowerCase();
    const conditionFilter = document.getElementById('filter-condition').value;
    const seriesFilter = document.getElementById('filter-collection-series').value;
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
    if (collectionRarityFilterValues.size > 0) {
        filtered = filtered.filter(c => collectionRarityFilterValues.has(c.rarity));
    }
    if (typeFilter) {
        filtered = filtered.filter(c => c.type === typeFilter);
    }
    if (duplicatesOnlyFilter) {
        const totals = computeDuplicateGroupTotals();
        filtered = filtered.filter(c => (totals[getDuplicateGroupKey(c)] || 0) > 1);
    }

    filtered = applySorting(filtered);

    // On ne rend que la vue actuellement visible (gain de perf notable sur une grosse collection)
    if (collectionViewMode === 'table') {
        renderCollectionTable(filtered);
    } else {
        renderCollectionGrid(filtered);
    }
}

function renderCollectionTable(filtered) {
    const tbody = document.getElementById('cards-list');

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" style="text-align: center; padding: 2rem;">
                    <div class="empty-state">
                        <p><i class="ti ti-search-off" aria-hidden="true"></i> Aucune carte trouvée</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = filtered.map(card => {
        const qty = Number(card.quantity || 1);
        const lineTotal = Number(card.market_value || 0) * qty;
        const acquisitionIcon = card.acquisition_type === 'pack' ? '<i class="ti ti-gift" aria-hidden="true"></i>' : '<i class="ti ti-shopping-bag" aria-hidden="true"></i>';
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
                ${renderFinishBadge(card.finish, 'badge finish-badge', 12)}
                <span title="${acquisitionTitle}" class="acquisition-icon">${acquisitionIcon}</span>
            </td>
            <td>${getRarityIconHtml(card.rarity)} ${card.rarity || 'N/A'}</td>
            <td style="text-align: center;">
                <div class="qty-stepper">
                    <button onclick="changeQuantity(${card.id}, -1)"><i class="ti ti-minus" aria-hidden="true"></i></button>
                    <span>${qty}</span>
                    <button onclick="changeQuantity(${card.id}, 1)"><i class="ti ti-plus" aria-hidden="true"></i></button>
                </div>
            </td>
            <td style="text-align: right;"><strong>${lineTotal.toFixed(2)}€</strong></td>
            <td style="text-align: center;">
                <button class="delete-btn" onclick="deleteCard(${card.id})"><i class="ti ti-trash" aria-hidden="true"></i></button>
            </td>
        </tr>
    `;
    }).join('');
}

function getGridNoImageHtml() {
    return '<div class="collection-card-noimg"><i class="ti ti-photo-off" aria-hidden="true"></i></div>';
}

function renderCollectionGrid(filtered) {
    const grid = document.getElementById('collection-grid');
    if (!grid) return;

    if (filtered.length === 0) {
        grid.innerHTML = '<div class="collection-grid-empty"><i class="ti ti-search-off" aria-hidden="true"></i> Aucune carte trouvée</div>';
        return;
    }

    grid.innerHTML = filtered.map(card => {
        const qty = Number(card.quantity || 1);
        const lineTotal = Number(card.market_value || 0) * qty;
        const conditionClass = (card.condition || '').toLowerCase();
        const acquisitionIcon = card.acquisition_type === 'pack' ? '<i class="ti ti-gift" aria-hidden="true"></i>' : '<i class="ti ti-shopping-bag" aria-hidden="true"></i>';
        const acquisitionTitle = card.acquisition_type === 'pack' ? 'Sortie d\'un booster' : 'Achetée';

        return `
            <div class="collection-card" onclick="showCardDetail(${card.id})">
                ${card.image
                    ? `<img src="${card.image}" alt="${card.name}" loading="lazy" onerror="this.outerHTML=getCollectionUploadPlaceholder(${card.id}, 'full')">`
                    : getCollectionUploadPlaceholder(card.id, 'full')
                }
                ${qty > 1 ? `<div class="qty-badge">×${qty}</div>` : ''}
                <div class="price-badge">${lineTotal.toFixed(2)}€</div>
                <div class="set-rarity-badge-row">
                    ${card.series_symbol ? `<img src="${card.series_symbol}" class="set-symbol-badge" alt="" title="${card.series}" onerror="this.remove()">` : ''}
                    ${getRarityIconHtml(card.rarity) ? `<div class="rarity-badge-corner" title="${card.rarity}">${getRarityIconHtml(card.rarity, 18)}</div>` : ''}
                </div>
                <div class="collection-card-overlay">
                    <div class="collection-card-name">${card.name}</div>
                    <div class="collection-card-set">${card.series_logo ? `<img src="${card.series_logo}" class="series-logo-inline" alt="" onerror="this.remove()">` : ''}${card.series} · #${card.number}</div>
                    <span class="condition-badge-grid ${conditionClass}">${card.condition}</span>
                    ${renderFinishBadge(card.finish, 'condition-badge-grid finish-badge', 12)}
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
                    ? `<img src="${card.image}" alt="${card.name}" class="modal-image" onerror="this.outerHTML=getCollectionUploadPlaceholder(${card.id}, 'modal-size')">`
                    : getCollectionUploadPlaceholder(card.id, 'modal-size')
                }
                ${card.tcgdex_id ? `
                    <div class="card-price-chart-wrap">
                        <div class="card-price-chart-title">Historique de prix</div>
                        <canvas id="card-price-chart"></canvas>
                        <p id="card-price-chart-empty" class="card-price-chart-empty" style="display:none;">Historique pas encore disponible</p>
                        <div id="card-price-chart-range" class="card-price-chart-range"></div>
                        <div id="card-price-periods" class="card-price-periods"></div>
                    </div>
                ` : ''}
            </div>
            <div class="modal-info">
                <div class="modal-title">${card.name}</div>
                ${card.series_logo
                    ? `<img src="${card.series_logo}" class="modal-series-logo" alt="" onerror="this.remove()">`
                    : (card.tcgdex_id ? `
                        <div class="modal-logo-upload" onclick="document.getElementById('modal-logo-upload-input').click()">
                            <i class="ti ti-tag" aria-hidden="true"></i> Ajouter un logo de série
                        </div>
                        <input type="file" id="modal-logo-upload-input" accept="image/*" style="display:none" onchange="handleModalSeriesLogoUpload(event, '${getSetIdFromTcgdexId(card.tcgdex_id)}', ${card.id})">
                    ` : '')
                }
                <div class="modal-subtitle">${card.series} · #${card.number}</div>

                <div class="modal-badges">
                    <span class="modal-pill rarity-pill">${getRarityIconHtml(card.rarity, 14)} ${card.rarity || 'N/A'}</span>
                    <span class="modal-pill condition-pill ${conditionClass}">${conditionLabel} (${card.condition})</span>
                    ${renderFinishBadge(card.finish, 'modal-pill finish-pill', 14)}
                    <span class="modal-pill acquisition-pill">${isPack ? '<i class="ti ti-gift" aria-hidden="true"></i> Sortie d\'un booster' : '<i class="ti ti-shopping-bag" aria-hidden="true"></i> Achetée'}</span>
                    ${!card.series_symbol && card.tcgdex_id ? `
                        <span class="modal-pill symbol-upload-pill" onclick="document.getElementById('modal-symbol-upload-input').click()">
                            <i class="ti ti-plus" aria-hidden="true"></i> Symbole du set
                        </span>
                        <input type="file" id="modal-symbol-upload-input" accept="image/*" style="display:none" onchange="handleModalSeriesSymbolUpload(event, '${getSetIdFromTcgdexId(card.tcgdex_id)}', ${card.id})">
                    ` : ''}
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
                ${card.notes ? `<div class="modal-note"><i class="ti ti-note" aria-hidden="true"></i> ${card.notes}</div>` : ''}

                <div class="modal-action-toolbar">
                    <button class="toolbar-action-btn" onclick="showCardEditForm(${card.id})">
                        <i class="ti ti-edit toolbar-action-icon" style="color: var(--gold);" aria-hidden="true"></i>
                        <span>Modifier</span>
                    </button>
                    <a href="${card.cardmarket_id
                        ? `https://www.cardmarket.com/en/Pokemon/Products?idProduct=${card.cardmarket_id}`
                        : `https://www.cardmarket.com/fr/Pokemon/Products/Search?searchString=${encodeURIComponent(card.name || '')}`
                    }" target="_blank" rel="noopener noreferrer" class="toolbar-action-btn">
                        <i class="ti ti-external-link toolbar-action-icon" style="color: var(--teal);" aria-hidden="true"></i>
                        <span>${card.cardmarket_id ? 'Cardmarket' : 'Chercher'}</span>
                    </a>
                </div>
                <button class="modal-delete-btn-v2" onclick="deleteCard(${card.id}); closeCardDetail();">
                    <i class="ti ti-trash" aria-hidden="true"></i>
                    <span>Supprimer de la collection</span>
                </button>
            </div>
        </div>
    `;

    document.getElementById('card-detail-overlay').classList.add('active');

    if (card.tcgdex_id) {
        renderCardPriceChart(card.tcgdex_id);
    }
}

let cardPriceChartInstance = null;

async function renderCardPriceChart(tcgdexId) {
    const canvas = document.getElementById('card-price-chart');
    const emptyMsg = document.getElementById('card-price-chart-empty');
    const rangeLabel = document.getElementById('card-price-chart-range');
    const periodsContainer = document.getElementById('card-price-periods');
    if (!canvas || typeof Chart === 'undefined') return;

    const { data, error } = await supabaseClient
        .from('card_price_history')
        .select('*')
        .eq('tcgdex_id', tcgdexId)
        .order('recorded_at', { ascending: true })
        .limit(100);

    if (cardPriceChartInstance) {
        cardPriceChartInstance.destroy();
        cardPriceChartInstance = null;
    }

    if (error || !data || data.length < 2) {
        canvas.style.display = 'none';
        if (rangeLabel) rangeLabel.style.display = 'none';
        if (periodsContainer) {
            periodsContainer.innerHTML = '';
            periodsContainer.style.display = 'none';
        }
        emptyMsg.style.display = 'block';
        return;
    }

    canvas.style.display = 'block';
    emptyMsg.style.display = 'none';

    const values = data.map(d => Number(d.market_value));
    const trendUp = values[values.length - 1] >= values[0];
    const lineColor = trendUp ? '#4ade80' : '#ff6b6b';
    const fillColor = trendUp ? 'rgba(74, 222, 128, 0.12)' : 'rgba(255, 107, 107, 0.1)';

    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    if (rangeLabel) {
        rangeLabel.style.display = 'flex';
        rangeLabel.innerHTML = minVal === maxVal
            ? `<span>Stable à ${minVal.toFixed(2)}€</span>`
            : `<span>Min ${minVal.toFixed(2)}€</span><span>Max ${maxVal.toFixed(2)}€</span>`;
    }

    if (periodsContainer) {
        const currentValue = values[values.length - 1];
        const now = Date.now();
        const periods = [
            { label: '1 jour', ms: 1 * 24 * 60 * 60 * 1000 },
            { label: '7 jours', ms: 7 * 24 * 60 * 60 * 1000 },
            { label: '30 jours', ms: 30 * 24 * 60 * 60 * 1000 }
        ];

        const rowsHtml = periods.map(p => {
            const cutoff = now - p.ms;
            // Point de référence : la donnée la plus récente à ou avant cette date
            let basePoint = null;
            for (const point of data) {
                if (new Date(point.recorded_at).getTime() <= cutoff) {
                    basePoint = point;
                } else {
                    break;
                }
            }

            if (!basePoint || Number(basePoint.market_value) === 0) {
                return `
                    <div class="period-row">
                        <span class="period-label">Depuis ${p.label}</span>
                        <span class="period-value neutral">—</span>
                    </div>
                `;
            }

            const baseValue = Number(basePoint.market_value);
            const pct = ((currentValue - baseValue) / baseValue) * 100;
            const deltaValue = currentValue - baseValue;
            const cls = pct > 0 ? 'positive' : pct < 0 ? 'negative' : 'neutral';
            const sign = pct > 0 ? '+' : '';

            return `
                <div class="period-row">
                    <span class="period-label">Depuis ${p.label}</span>
                    <span class="period-value ${cls}">${sign}${pct.toFixed(0)}% <span class="period-value-abs">(${sign}${deltaValue.toFixed(2)}€)</span></span>
                </div>
            `;
        }).join('');

        periodsContainer.style.display = '';
        periodsContainer.innerHTML = rowsHtml;
    }

    cardPriceChartInstance = new Chart(canvas, {
        type: 'line',
        data: {
            labels: data.map(d => new Date(d.recorded_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })),
            datasets: [{
                data: values,
                borderColor: lineColor,
                backgroundColor: fillColor,
                fill: true,
                tension: 0.3,
                pointRadius: 3,
                pointHoverRadius: 5,
                pointBackgroundColor: lineColor,
                pointBorderColor: '#1B2233',
                pointBorderWidth: 1.5,
                pointHitRadius: 8,
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#161B29',
                    titleColor: '#8A93A6',
                    bodyColor: '#F7F3EA',
                    borderColor: 'rgba(255,255,255,0.15)',
                    borderWidth: 1,
                    padding: 8,
                    displayColors: false,
                    titleFont: { size: 11 },
                    bodyFont: { size: 13, weight: 'bold' },
                    callbacks: { label: (ctx) => `${ctx.parsed.y.toFixed(2)}€` }
                }
            },
            scales: {
                x: { display: false },
                y: {
                    display: false,
                    beginAtZero: true,
                    suggestedMax: maxVal * 1.15 || 1
                }
            }
        }
    });
}

// ===== EDITION D'UNE CARTE DEPUIS LA FICHE DETAIL =====

async function showCardEditForm(cardId) {
    const card = allCollectionCards.find(c => c.id === cardId);
    if (!card) return;

    const isPack = card.acquisition_type === 'pack';
    const currentFinish = card.finish || 'normal';

    // Récupérer le détail complet (variants_detailed) pour proposer les vraies finitions disponibles
    let fullDetail = null;
    if (card.tcgdex_id) {
        try {
            let response = await fetch(`${API_BASE}/cards/${card.tcgdex_id}`);
            let detail = await response.json();
            if (!detail || detail.status) {
                const enResponse = await fetch(`${API_EN}/cards/${card.tcgdex_id}`);
                detail = await enResponse.json();
            }
            if (detail && !detail.status) fullDetail = detail;
        } catch (error) {
            console.error('Erreur récupération détails pour les finitions:', error);
        }
    }

    let finishOptionsHtml;
    if (fullDetail) {
        finishOptionsHtml = buildFinishOptionsHtml(fullDetail, currentFinish);
        if (!finishOptionsHtml.includes(`value="${currentFinish}"`)) {
            finishOptionsHtml += `<option value="${currentFinish}" selected>${getFinishLabel(currentFinish) || 'Normale'}</option>`;
        }
    } else {
        // Filet de sécurité si pas d'identifiant TCGdex ou requête échouée
        const fallbackOptions = [
            { value: 'normal', label: 'Normale' },
            { value: 'reverse', label: 'Reverse' },
            { value: 'first_edition', label: '1ère édition' }
        ];
        if (!fallbackOptions.some(o => o.value === currentFinish)) {
            fallbackOptions.push({ value: currentFinish, label: getFinishLabel(currentFinish) || currentFinish });
        }
        finishOptionsHtml = fallbackOptions.map(o => `<option value="${o.value}" ${o.value === currentFinish ? 'selected' : ''}>${o.label}</option>`).join('');
    }

    const modalCard = document.getElementById('card-detail-card');
    modalCard.innerHTML = `
        <button class="modal-close" onclick="closeCardDetail()">✕</button>
        <div class="modal-body">
            <div class="modal-image-wrap">
                ${card.image
                    ? `<img src="${card.image}" alt="${card.name}" class="modal-image" onerror="this.outerHTML=getCollectionUploadPlaceholder(${card.id}, 'modal-size')">`
                    : getCollectionUploadPlaceholder(card.id, 'modal-size')
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
                        <label for="edit-finish">Finition</label>
                        <select id="edit-finish">
                            ${finishOptionsHtml}
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
                    <div class="form-group">
                        <label for="edit-date-added">Date d'acquisition</label>
                        <input type="text" id="edit-date-added" value="${card.created_at ? new Date(card.created_at).toISOString().split('T')[0] : ''}">
                    </div>
                </div>

                <div class="form-group" style="margin-bottom: 1rem;">
                    <label for="edit-notes">Note personnelle</label>
                    <textarea id="edit-notes" rows="2" placeholder="Cadeau de mamie, trouvée à la brocante...">${card.notes ? card.notes.replace(/</g, '&lt;') : ''}</textarea>
                </div>

                <div class="modal-edit-actions">
                    <button class="modal-save-btn" onclick="saveCardEdits(${card.id})"><i class="ti ti-device-floppy" aria-hidden="true"></i> Enregistrer</button>
                    <button class="modal-cancel-btn" onclick="showCardDetail(${card.id})">Annuler</button>
                </div>
            </div>
        </div>
    `;

    document.getElementById('card-detail-overlay').classList.add('active');
    initDatePicker('#edit-date-added');
}

function toggleEditPurchasePriceField() {
    const val = document.getElementById('edit-acquisition').value;
    document.getElementById('edit-purchase-price-group').style.display = val === 'pack' ? 'none' : '';
}

async function saveCardEdits(cardId) {
    const condition = document.getElementById('edit-condition').value;
    const finish = document.getElementById('edit-finish').value;
    const quantity = parseInt(document.getElementById('edit-quantity').value) || 1;
    const acquisitionType = document.getElementById('edit-acquisition').value;
    const purchasePrice = acquisitionType === 'pack'
        ? 0
        : (parseFloat(document.getElementById('edit-purchase-price').value) || 0);
    const dateValue = document.getElementById('edit-date-added').value;
    const notes = document.getElementById('edit-notes').value.trim();

    const existingCard = allCollectionCards.find(c => c.id === cardId);
    if (!existingCard) return;

    const marketValue = Number(existingCard.market_value || 0);

    // Ancienne contribution (avant modification) pour retirer du bon mois
    const oldQuantity = Number(existingCard.quantity || 1);
    const oldPurchasePrice = Number(existingCard.purchase_price || 0);
    const oldDate = existingCard.created_at ? new Date(existingCard.created_at) : new Date();
    const oldMonthKey = `${oldDate.getFullYear()}-${String(oldDate.getMonth() + 1).padStart(2, '0')}`;

    // Nouvelle date et nouvelle contribution
    const newDate = dateValue ? new Date(dateValue + 'T12:00:00') : oldDate;
    const newMonthKey = `${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, '0')}`;

    const updatePayload = {
        condition,
        finish,
        quantity,
        acquisition_type: acquisitionType,
        purchase_price: purchasePrice,
        notes: notes || null
    };
    if (dateValue) {
        updatePayload.date_added = newDate.toLocaleDateString('fr-FR');
        updatePayload.created_at = newDate.toISOString();
    }

    const { error } = await supabaseClient.from('cards').update(updatePayload).eq('id', cardId);

    if (error) {
        showMessage('Erreur lors de la modification', 'error');
        console.error(error);
        return;
    }

    // Réconcilier l'historique mensuel : retirer l'ancienne contribution, ajouter la nouvelle
    await adjustMonthlyStatsAmount(oldMonthKey, -oldQuantity, -(oldPurchasePrice * oldQuantity), -(marketValue * oldQuantity));
    await adjustMonthlyStatsAmount(newMonthKey, quantity, purchasePrice * quantity, marketValue * quantity);

    showMessage('Carte mise à jour', 'success');
    await refreshCollection();
    await recordValueSnapshot();
    showCardDetail(cardId);
}

function closeCardDetail() {
    document.getElementById('card-detail-overlay').classList.remove('active');
}

async function handleModalSeriesSymbolUpload(event, setId, cardId) {
    const file = event.target.files[0];
    if (!file) return;

    try {
        showMessage('Envoi du symbole...', 'success');
        await uploadSeriesSymbolManually(file, setId);
        showMessage('Symbole ajouté ! Il sera visible sur toutes les cartes de cette série.', 'success');
        await refreshCollection();
        showCardDetail(cardId);
    } catch (error) {
        showMessage('Erreur lors de l\'envoi du symbole', 'error');
        console.error(error);
    }
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

function getCollectionUploadPlaceholder(cardId, sizeClass = 'thumb') {
    return `<div class="no-image-placeholder ${sizeClass} upload-placeholder" onclick="event.stopPropagation(); document.getElementById('upload-${cardId}').click()">
        <i class="ti ti-photo-off" aria-hidden="true"></i>
        <input type="file" id="upload-${cardId}" accept="image/*" style="display:none" onchange="event.stopPropagation(); handleCollectionImageUpload(event, ${cardId})">
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

// ===== LISTES DE SOUHAITS (multiples) =====

let allWishlists = [];
let allWishlistItems = [];
let expandedWishlistIds = new Set();

async function loadWishlists() {
    const [wishlistsRes, itemsRes] = await Promise.all([
        supabaseClient.from('wishlists').select('*').order('created_at', { ascending: true }),
        supabaseClient.from('wishlist').select('*').order('created_at', { ascending: false })
    ]);

    if (wishlistsRes.error) console.error('Erreur chargement listes:', wishlistsRes.error);
    if (itemsRes.error) console.error('Erreur chargement souhaits:', itemsRes.error);

    allWishlists = wishlistsRes.data || [];
    allWishlistItems = itemsRes.data || [];

    // Ouvrir la première liste par défaut si rien n'est encore déplié
    if (expandedWishlistIds.size === 0 && allWishlists.length > 0) {
        expandedWishlistIds.add(allWishlists[0].id);
    }

    renderWishlistsUI();
}

function toggleWishlistSection(wishlistId) {
    if (expandedWishlistIds.has(wishlistId)) {
        expandedWishlistIds.delete(wishlistId);
    } else {
        expandedWishlistIds.add(wishlistId);
    }
    renderWishlistsUI();
}

// ===== MODALE DE SAISIE DE TEXTE GENERIQUE (remplace prompt() natif) =====

let textPromptResolve = null;

function showTextPromptModal(title, defaultValue = '') {
    return new Promise((resolve) => {
        textPromptResolve = resolve;
        const content = document.getElementById('text-prompt-content');
        content.innerHTML = `
            <button class="modal-close" onclick="closeTextPrompt()">✕</button>
            <div class="modal-title" style="margin-bottom: 1rem;">${title}</div>
            <input type="text" id="text-prompt-input" value="${defaultValue.replace(/"/g, '&quot;')}" style="width:100%; margin-bottom: 1.25rem;">
            <div class="modal-edit-actions">
                <button class="modal-save-btn" onclick="submitTextPrompt()">Valider</button>
                <button class="modal-cancel-btn" onclick="closeTextPrompt()">Annuler</button>
            </div>
        `;
        document.getElementById('text-prompt-overlay').classList.add('active');

        const input = document.getElementById('text-prompt-input');
        setTimeout(() => { input.focus(); input.select(); }, 50);
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') submitTextPrompt();
        });
    });
}

function submitTextPrompt() {
    const value = document.getElementById('text-prompt-input').value.trim();
    document.getElementById('text-prompt-overlay').classList.remove('active');
    if (textPromptResolve) {
        textPromptResolve(value || null);
        textPromptResolve = null;
    }
}

function closeTextPrompt() {
    document.getElementById('text-prompt-overlay').classList.remove('active');
    if (textPromptResolve) {
        textPromptResolve(null);
        textPromptResolve = null;
    }
}

// ===== MODALE DE CONFIRMATION GENERIQUE (remplace confirm() natif) =====

let confirmModalResolve = null;

function showConfirmModal(message, confirmLabel = 'Confirmer') {
    return new Promise((resolve) => {
        confirmModalResolve = resolve;
        const content = document.getElementById('confirm-modal-content');
        content.innerHTML = `
            <button class="modal-close" onclick="closeConfirmModal(false)">✕</button>
            <div class="modal-title" style="margin-bottom: 1.25rem;">${message}</div>
            <div class="modal-edit-actions">
                <button class="modal-delete-btn-v2" style="flex: 1; margin-top: 0;" onclick="closeConfirmModal(true)">${confirmLabel}</button>
                <button class="modal-cancel-btn" onclick="closeConfirmModal(false)">Annuler</button>
            </div>
        `;
        document.getElementById('confirm-modal-overlay').classList.add('active');
    });
}

function closeConfirmModal(result) {
    document.getElementById('confirm-modal-overlay').classList.remove('active');
    if (confirmModalResolve) {
        confirmModalResolve(result);
        confirmModalResolve = null;
    }
}

async function renameWishlist(wishlistId) {
    const current = allWishlists.find(w => w.id === wishlistId);
    if (!current) return;

    const newName = await showTextPromptModal('Renommer la liste', current.name);
    if (!newName || newName === current.name) return;

    const { error } = await supabaseClient.from('wishlists').update({ name: newName }).eq('id', wishlistId);
    if (error) {
        showMessage('Erreur lors du renommage', 'error');
        console.error(error);
        return;
    }
    await loadWishlists();
}

async function deleteWishlist(wishlistId) {
    const current = allWishlists.find(w => w.id === wishlistId);
    if (!current) return;

    if (!await showConfirmModal(`Supprimer la liste "${current.name}" et toutes les cartes qu'elle contient ?`, 'Supprimer')) return;

    const { error } = await supabaseClient.from('wishlists').delete().eq('id', wishlistId);
    if (error) {
        showMessage('Erreur lors de la suppression de la liste', 'error');
        console.error(error);
        return;
    }

    expandedWishlistIds.delete(wishlistId);
    await loadWishlists();
}

async function deleteWishlistItem(itemId) {
    if (!await showConfirmModal('Retirer cette carte de cette liste ?', 'Retirer')) return;

    const { error } = await supabaseClient.from('wishlist').delete().eq('id', itemId);
    if (error) {
        showMessage('Erreur lors de la suppression', 'error');
        console.error(error);
        return;
    }

    await loadWishlists();
}

// Ajoute la carte à la collection (sans la retirer de la liste de souhaits)
async function markWishlistItemOwned(itemId) {
    const item = allWishlistItems.find(w => w.id === itemId);
    if (!item) return;

    let cardData = null;
    if (item.tcgdex_id) {
        try {
            let response = await fetch(`${API_BASE}/cards/${item.tcgdex_id}`);
            let detail = await response.json();
            if (!detail || detail.status) {
                const enResponse = await fetch(`${API_EN}/cards/${item.tcgdex_id}`);
                detail = await enResponse.json();
            }
            if (detail && !detail.status) cardData = detail;
        } catch (error) {
            console.error('Erreur récupération détails carte:', error);
        }
    }

    // Filet de sécurité si TCGdex ne répond pas : on reconstruit un objet minimal à partir des données stockées
    if (!cardData) {
        cardData = {
            id: item.tcgdex_id || null,
            name: item.name,
            localId: item.number,
            rarity: item.rarity,
            set: { name: item.series },
            image: null
        };
    }

    try {
        await performCardAdd(cardData, {
            condition: 'NM',
            quantity: 1,
            acquisitionType: 'achat',
            purchasePrice: 0,
            customImage: null
        });
    } catch (error) {
        showMessage('Erreur lors de l\'ajout à la collection', 'error');
        console.error(error);
        return;
    }

    showMessage('Ajoutée à ta collection ! Pense à ajuster l\'état et le prix si besoin.', 'success');
    await refreshCollection();
    await recordValueSnapshot();
    renderWishlistsUI();
}

function renderWishlistsUI() {
    const container = document.getElementById('wishlists-container');
    if (!container) return;

    if (allWishlists.length === 0) {
        container.innerHTML = '<p class="empty-state"><i class="ti ti-star" aria-hidden="true"></i> Aucune liste de souhaits pour l\'instant</p>';
        return;
    }

    const ownedTcgdexIds = new Set(allCollectionCards.filter(c => c.tcgdex_id).map(c => c.tcgdex_id));

    container.innerHTML = allWishlists.map(list => {
        const items = allWishlistItems.filter(i => i.wishlist_id === list.id);
        const isExpanded = expandedWishlistIds.has(list.id);

        const itemsHtml = items.length === 0
            ? '<p class="empty-state" style="padding: 1.5rem;">Aucune carte dans cette liste</p>'
            : `<div class="wishlist-grid">${items.map(item => {
                const owned = item.tcgdex_id && ownedTcgdexIds.has(item.tcgdex_id);
                return `
                    <div class="wishlist-card">
                        ${item.image
                            ? `<img src="${item.image}" alt="${item.name}" class="wishlist-card-img" onerror="this.style.display='none'">`
                            : '<div class="no-image-placeholder thumb"><i class="ti ti-photo-off" aria-hidden="true"></i></div>'
                        }
                        <div class="wishlist-card-info">
                            <div class="wishlist-card-name">${item.name}</div>
                            <div class="wishlist-card-set">${item.series_logo ? `<img src="${item.series_logo}" class="series-logo-inline" alt="" onerror="this.remove()">` : ''}${item.series} - #${item.number}</div>
                        </div>
                        <div class="wishlist-card-actions">
                            ${owned
                                ? '<span class="wishlist-owned-badge"><i class="ti ti-check" aria-hidden="true"></i> Déjà dans ta collection</span>'
                                : `<button class="wishlist-got-btn" onclick="markWishlistItemOwned(${item.id})"><i class="ti ti-check" aria-hidden="true"></i> Je l'ai !</button>`
                            }
                            <button class="delete-btn" onclick="deleteWishlistItem(${item.id})"><i class="ti ti-trash" aria-hidden="true"></i></button>
                        </div>
                    </div>
                `;
            }).join('')}</div>`;

        return `
            <div class="wishlist-section">
                <div class="wishlist-section-header" onclick="toggleWishlistSection(${list.id})">
                    <div class="wishlist-section-title">
                        <i class="ti ti-chevron-right wishlist-chevron ${isExpanded ? 'expanded' : ''}" aria-hidden="true"></i>
                        <span>${list.name}</span>
                        <span class="wishlist-count-badge">${items.length}</span>
                    </div>
                    <div class="wishlist-section-actions">
                        <button onclick="event.stopPropagation(); renameWishlist(${list.id})" title="Renommer"><i class="ti ti-edit" aria-hidden="true"></i></button>
                        <button onclick="event.stopPropagation(); deleteWishlist(${list.id})" title="Supprimer la liste"><i class="ti ti-trash" aria-hidden="true"></i></button>
                    </div>
                </div>
                <div class="wishlist-section-body" style="display: ${isExpanded ? 'block' : 'none'};">
                    ${itemsHtml}
                </div>
            </div>
        `;
    }).join('');
}

// ===== FENETRE DE CHOIX / CREATION DE LISTE (au moment d'ajouter une carte) =====

function openWishlistPicker() {
    if (!selectedCard) {
        showMessage('Veuillez sélectionner une carte', 'error');
        return;
    }
    renderWishlistPicker();
    document.getElementById('wishlist-picker-overlay').classList.add('active');
}

function closeWishlistPicker() {
    document.getElementById('wishlist-picker-overlay').classList.remove('active');
}

function renderWishlistPicker() {
    const content = document.getElementById('wishlist-picker-content');
    const listsHtml = allWishlists.map(list => `
        <div class="wishlist-picker-item" onclick="addCardToSpecificWishlist(${list.id})">
            <span>${list.name}</span>
            <i class="ti ti-chevron-right" aria-hidden="true"></i>
        </div>
    `).join('');

    content.innerHTML = `
        <button class="modal-close" onclick="closeWishlistPicker()">✕</button>
        <div class="modal-title" style="margin-bottom: 1rem;">Ajouter à quelle liste ?</div>
        <div class="wishlist-picker-list">
            ${listsHtml || '<p class="empty-state" style="padding: 1rem;">Aucune liste pour l\'instant</p>'}
        </div>
        <div class="wishlist-picker-new">
            <input type="text" id="new-wishlist-name" placeholder="Nom d'une nouvelle liste">
            <button class="wishlist-picker-add-btn" onclick="createWishlistAndAddCard()"><i class="ti ti-plus" aria-hidden="true"></i> Ajouter</button>
        </div>
    `;
}

async function addCardToSpecificWishlist(wishlistId) {
    if (!selectedCard) return;

    let imageUrl = customPreviewImage || (selectedCard.image ? `${selectedCard.image}/high.png` : '');
    const logoUrl = selectedCard.set?.logo ? `${selectedCard.set.logo}.webp` : null;

    const { error } = await supabaseClient.from('wishlist').insert([{
        wishlist_id: wishlistId,
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
    closeWishlistPicker();
    document.getElementById('card-preview').classList.remove('active');
    selectedCard = null;
    customPreviewImage = null;

    await loadWishlists();
}

async function createWishlistAndAddCard() {
    const input = document.getElementById('new-wishlist-name');
    const name = input.value.trim();
    if (!name) {
        showMessage('Donne un nom à ta nouvelle liste', 'error');
        return;
    }

    const { data, error } = await supabaseClient.from('wishlists').insert([{ name }]).select().single();
    if (error) {
        showMessage('Erreur lors de la création de la liste', 'error');
        console.error(error);
        return;
    }

    allWishlists.push(data);
    expandedWishlistIds.add(data.id);
    await addCardToSpecificWishlist(data.id);
}

async function createWishlistOnly() {
    const name = await showTextPromptModal('Nom de la nouvelle liste');
    if (!name) return;

    const { error } = await supabaseClient.from('wishlists').insert([{ name }]);
    if (error) {
        showMessage('Erreur lors de la création de la liste', 'error');
        console.error(error);
        return;
    }

    await loadWishlists();
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
    await loadMonthlySummaryOptions();
    await renderMonthlySummary();
    renderRarityChart();
    renderSeriesChart();
    renderSeriesValueChart();
    renderRoiSection();
    await loadValueHistoryData();
    renderValueHistoryChart();
    renderPriceMovers();
}

function formatMonthLabel(monthKey) {
    const [year, month] = monthKey.split('-').map(Number);
    const date = new Date(year, month - 1, 1);
    const label = date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    return label.charAt(0).toUpperCase() + label.slice(1);
}

function getCurrentMonthKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

async function loadMonthlySummaryOptions() {
    const select = document.getElementById('month-summary-select');
    const currentMonthKey = getCurrentMonthKey();

    const { data, error } = await supabaseClient
        .from('monthly_summary')
        .select('month')
        .order('month', { ascending: false });

    const months = (!error && data) ? data.map(row => row.month) : [];
    if (!months.includes(currentMonthKey)) months.unshift(currentMonthKey);

    const previousSelection = select.value;
    select.innerHTML = months.map(m => `<option value="${m}">${formatMonthLabel(m)}</option>`).join('');
    select.value = months.includes(previousSelection) ? previousSelection : currentMonthKey;
}

async function renderMonthlySummary() {
    const select = document.getElementById('month-summary-select');
    const monthKey = select.value || getCurrentMonthKey();

    const countEl = document.getElementById('month-cards-added');
    const spentEl = document.getElementById('month-spent');
    const valueAddedEl = document.getElementById('month-value-added');

    const { data, error } = await supabaseClient
        .from('monthly_summary')
        .select('*')
        .eq('month', monthKey)
        .maybeSingle();

    if (error || !data) {
        countEl.textContent = '0';
        spentEl.textContent = '0.00€';
        valueAddedEl.textContent = '0.00€';
        return;
    }

    countEl.textContent = data.cards_added || 0;
    spentEl.textContent = Number(data.total_spent || 0).toFixed(2) + '€';
    valueAddedEl.textContent = Number(data.value_added || 0).toFixed(2) + '€';
}

function renderStatsKpis() {
    const topCardEl = document.getElementById('kpi-top-card');
    const topCardPriceEl = document.getElementById('kpi-top-card-price');
    const avgPriceEl = document.getElementById('kpi-avg-price');
    const seriesCountEl = document.getElementById('kpi-series-count');
    const topRarityEl = document.getElementById('kpi-top-rarity');
    const duplicatesValueEl = document.getElementById('kpi-duplicates-value');

    if (allCollectionCards.length === 0) {
        topCardEl.textContent = '-';
        topCardPriceEl.textContent = '';
        avgPriceEl.textContent = '-';
        seriesCountEl.textContent = '-';
        topRarityEl.textContent = '-';
        duplicatesValueEl.textContent = '-';
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

    // Valeur des doublons : pour chaque carte possédée en plusieurs exemplaires,
    // on garde la valeur d'un seul exemplaire de côté et on additionne le reste
    const duplicateGroups = {};
    allCollectionCards.forEach(card => {
        const key = getDuplicateGroupKey(card);
        if (!duplicateGroups[key]) {
            duplicateGroups[key] = { totalQty: 0, totalValue: 0, unitValue: Number(card.market_value || 0) };
        }
        duplicateGroups[key].totalQty += Number(card.quantity || 1);
        duplicateGroups[key].totalValue += Number(card.market_value || 0) * Number(card.quantity || 1);
    });

    let duplicatesValue = 0;
    Object.values(duplicateGroups).forEach(g => {
        if (g.totalQty > 1) {
            duplicatesValue += g.totalValue - g.unitValue;
        }
    });
    duplicatesValueEl.textContent = `${duplicatesValue.toFixed(2)}€`;
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

let seriesValueChartInstance = null;

function renderSeriesValueChart() {
    const canvas = document.getElementById('series-value-chart');
    if (!canvas) return;

    const totals = {};
    allCollectionCards.forEach(card => {
        const key = card.series;
        if (!key || key === 'N/A') return;
        totals[key] = (totals[key] || 0) + Number(card.market_value || 0) * Number(card.quantity || 1);
    });

    // Top 8 séries par valeur
    const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const labels = sorted.map(s => s[0]);
    const values = sorted.map(s => s[1]);

    if (seriesValueChartInstance) seriesValueChartInstance.destroy();

    if (labels.length === 0) return;

    seriesValueChartInstance = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                data: values,
                backgroundColor: '#3FA7A1',
                borderRadius: 4,
                barThickness: 18
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.x.toFixed(2)}€` } }
            },
            scales: {
                x: { beginAtZero: true, ticks: { callback: (v) => `${v}€` } },
                y: { ticks: { autoSkip: false } }
            }
        }
    });
}

function renderRoiSection() {
    const container = document.getElementById('roi-section');
    if (!container) return;

    const candidates = allCollectionCards
        .filter(c => Number(c.purchase_price) > 0)
        .map(c => {
            const purchase = Number(c.purchase_price);
            const current = Number(c.market_value || 0);
            const qty = Number(c.quantity || 1);
            const gainPercent = ((current - purchase) / purchase) * 100;
            const gainAmount = (current - purchase) * qty;
            return { name: c.name, number: c.number, gainPercent, gainAmount };
        })
        .sort((a, b) => b.gainPercent - a.gainPercent)
        .slice(0, 5);

    if (candidates.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--slate); padding: 1rem;">Aucune carte avec un prix payé renseigné pour l\'instant.</p>';
        return;
    }

    container.innerHTML = candidates.map(c => {
        const cls = c.gainPercent > 0 ? 'positive' : c.gainPercent < 0 ? 'negative' : 'neutral';
        const sign = c.gainPercent > 0 ? '+' : '';
        return `
            <div class="mover-row">
                <span class="mover-name">${c.name} <span class="mover-number">#${c.number}</span></span>
                <span class="mover-delta ${cls}">${sign}${c.gainPercent.toFixed(0)}% <span class="period-value-abs">(${sign}${c.gainAmount.toFixed(2)}€)</span></span>
            </div>
        `;
    }).join('');
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
let collectionSearchDebounceTimer = null;
document.getElementById('search-collection').addEventListener('input', () => {
    clearTimeout(collectionSearchDebounceTimer);
    collectionSearchDebounceTimer = setTimeout(filterAndDisplay, 150);
});
document.getElementById('filter-condition').addEventListener('change', filterAndDisplay);
document.getElementById('filter-collection-series').addEventListener('change', filterAndDisplay);
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

let searchDebounceTimer = null;
document.getElementById('card-search').addEventListener('input', () => {
    const value = document.getElementById('card-search').value.trim();
    clearTimeout(searchDebounceTimer);

    if (value.length < 2) {
        document.getElementById('search-results').classList.remove('active');
        document.getElementById('search-results').innerHTML = '';
        return;
    }

    searchDebounceTimer = setTimeout(() => {
        searchCards();
    }, 350);
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
    filterAndDisplay();
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

    if (tabId === 'tab-wishlist') {
        loadWishlists();
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
    const pricingDetailMap = {};
    const setInfoMap = {};
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
                pricingDetailMap[id] = data?.pricing?.cardmarket || null;
                setInfoMap[id] = data?.set || null;
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

    // Enregistrer un instantané d'historique par carte unique (pas par ligne, pour éviter les doublons)
    const historyInserts = uniqueIds
        .filter(id => priceMap[id] !== undefined)
        .map(id => ({ tcgdex_id: id, market_value: priceMap[id] }));
    if (historyInserts.length > 0) {
        const { error: historyError } = await supabaseClient.from('card_price_history').insert(historyInserts);
        if (historyError) console.error('Erreur historique prix par carte:', historyError);
    }

    // Enrichir automatiquement l'historique (avg1/avg7/avg30) des cartes qui en ont besoin :
    // soit jamais enrichies du tout, soit enrichies partiellement (ex: avg7/avg30 mais sans avg1,
    // comme certaines cartes touchées pendant la mise au point de cette fonctionnalité)
    await Promise.all(uniqueIds.map(async (id) => {
        const cm = pricingDetailMap[id];
        if (!cm) return;

        const { data: historyRows, error: historyErr } = await supabaseClient
            .from('card_price_history')
            .select('recorded_at')
            .eq('tcgdex_id', id);

        if (historyErr || !historyRows || historyRows.length === 0) return;

        const nowMs = Date.now();
        const ages = historyRows.map(r => (nowMs - new Date(r.recorded_at).getTime()) / (24 * 60 * 60 * 1000));
        const hasOldPoint = ages.some(a => a >= 6);
        const hasOneDayPoint = ages.some(a => a >= 0.5 && a <= 1.5);

        const backfillRows = [];

        if (!hasOldPoint) {
            // Jamais enrichie : on ajoute les 3 points de repère
            if (typeof cm.avg1 === 'number' && cm.avg1 > 0) {
                backfillRows.push({ tcgdex_id: id, market_value: cm.avg1, recorded_at: new Date(nowMs - 1 * 24 * 60 * 60 * 1000).toISOString() });
            }
            if (typeof cm.avg7 === 'number' && cm.avg7 > 0) {
                backfillRows.push({ tcgdex_id: id, market_value: cm.avg7, recorded_at: new Date(nowMs - 7 * 24 * 60 * 60 * 1000).toISOString() });
            }
            if (typeof cm.avg30 === 'number' && cm.avg30 > 0) {
                backfillRows.push({ tcgdex_id: id, market_value: cm.avg30, recorded_at: new Date(nowMs - 30 * 24 * 60 * 60 * 1000).toISOString() });
            }
        } else if (!hasOneDayPoint) {
            // Déjà enrichie (avg7/avg30 ou historique réel ancien) mais il manque le point ~1 jour
            if (typeof cm.avg1 === 'number' && cm.avg1 > 0) {
                backfillRows.push({ tcgdex_id: id, market_value: cm.avg1, recorded_at: new Date(nowMs - 1 * 24 * 60 * 60 * 1000).toISOString() });
            }
        }

        if (backfillRows.length > 0) {
            const { error: backfillError } = await supabaseClient.from('card_price_history').insert(backfillRows);
            if (backfillError) console.error('Erreur enrichissement historique prix:', backfillError);
        }
    }));

    // Rattraper le logo et le symbole de série pour les cartes qui n'en ont pas encore (ex: ajoutées
    // avant l'introduction de ces fonctionnalités) - en réutilisant les détails déjà récupérés ci-dessus
    await Promise.all(uniqueIds.map(async (id) => {
        const setInfo = setInfoMap[id];
        if (!setInfo) return;

        const rowsForThisCard = allCollectionCards.filter(c => c.tcgdex_id === id);
        const missingLogo = rowsForThisCard.some(c => !c.series_logo) && setInfo.logo;
        const missingSymbol = rowsForThisCard.some(c => !c.series_symbol) && setInfo.symbol;
        if (!missingLogo && !missingSymbol) return;

        const updatePayload = {};
        if (missingLogo) {
            try {
                updatePayload.series_logo = await fetchAndUploadSeriesLogo(setInfo.logo, setInfo.id);
            } catch (error) {
                console.error('Rattrapage logo échoué:', error);
            }
        }
        if (missingSymbol) {
            try {
                updatePayload.series_symbol = await fetchAndUploadSeriesSymbol(setInfo.symbol, setInfo.id);
            } catch (error) {
                console.error('Rattrapage symbole échoué:', error);
            }
        }

        if (Object.keys(updatePayload).length > 0) {
            const { error } = await supabaseClient.from('cards').update(updatePayload).eq('tcgdex_id', id);
            if (error) console.error('Erreur mise à jour logo/symbole:', error);
        }
    }));

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
                <h4 class="movers-heading up"><i class="ti ti-trending-up" aria-hidden="true"></i> En hausse</h4>
                ${renderList(gainers, true)}
            </div>
            <div class="movers-column">
                <h4 class="movers-heading down"><i class="ti ti-trending-down" aria-hidden="true"></i> En baisse</h4>
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
let progressionFinishMode = 'normal';
let currentProgressionStoredFilenames = new Set();

async function loadSeriesProgress() {
    const container = document.getElementById('progression-series-list');
    container.innerHTML = Array.from({ length: 3 }).map(() => `
        <div class="skeleton-row" style="background: var(--panel); border-radius: 8px; margin-bottom: 0.75rem; border-bottom: none;">
            <div class="skeleton" style="width:44px; height:32px; flex-shrink:0;"></div>
            <div style="flex:1;">
                <div class="skeleton" style="height:14px; width:35%; margin-bottom:8px;"></div>
                <div class="skeleton" style="height:6px; width:80%;"></div>
            </div>
        </div>
    `).join('');

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
                const setId = getSetIdFromTcgdexId(card.tcgdex_id);
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
                const officialCount = set.cardCount?.official || 0;
                const total = set.cardCount?.total || officialCount;
                const secretCount = Math.max(0, total - officialCount);
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
                        <i class="ti ti-tag" aria-hidden="true"></i>
                        <input type="file" id="proglogo-${set.id}" accept="image/*" style="display:none" onchange="event.stopPropagation(); handleProgressionSeriesLogoUpload(event, '${set.id}')">
                    </div>`;

                return `
                    <div class="progression-set-row" onclick="openSetProgression('${set.id}', '${safeName}', '${logoUrl}')">
                        ${logoHtml}
                        <div class="progression-set-info">
                            <div class="progression-set-name">${set.name}</div>
                            <div class="progression-progress-bar"><div class="progression-progress-fill" style="width:${pct}%"></div></div>
                        </div>
                        <div class="progression-set-count">
                            ${owned}/${officialCount} · ${pct}%
                            ${secretCount > 0 ? `<span class="progression-secret-badge">+${secretCount} secrètes</span>` : ''}
                        </div>
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
    progressionFinishMode = 'normal';
    progressionRarityFilterValues.clear();
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
    const progressText = document.getElementById('progression-set-progress-text');
    grid.innerHTML = Array.from({ length: 12 }).map(() => `
        <div class="skeleton" style="aspect-ratio: 5/7; border-radius: 8px;"></div>
    `).join('');
    if (progressText) progressText.textContent = 'Chargement des cartes...';

    try {
        let response = await fetch(`${API_BASE}/cards?set=${setId}`);
        let data = await response.json();
        if (!Array.isArray(data) || data.length === 0) {
            const enResponse = await fetch(`${API_EN}/cards?set=${setId}`);
            data = await enResponse.json();
        }

        const basicList = (Array.isArray(data) ? data : []).filter(c => getSetIdFromTcgdexId(c.id) === setId);

        // Récupérer les détails complets (rareté, prix, image) par lots de 5
        const detailed = [];
        const batchSize = 5;
        for (let i = 0; i < basicList.length; i += batchSize) {
            const batch = basicList.slice(i, i + batchSize);
            if (progressText) progressText.textContent = `Chargement des cartes... ${Math.min(i + batchSize, basicList.length)}/${basicList.length}`;

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

        // Mis en cache une seule fois ici : évite de re-vérifier (et de vider la grille) à chaque
        // rafraîchissement (ex: après un ajout rapide), ce qui causait un saut de scroll en haut de page
        currentProgressionStoredFilenames = await getStoredImageFilenames();

        renderProgressionFinishToggle();
        populateProgressionRarityFilter();
        renderProgressionCardsGrid();
    } catch (error) {
        grid.innerHTML = '<p style="text-align: center; padding: 2rem; color: var(--slate);">Erreur lors du chargement des cartes</p>';
        console.error(error);
    }
}

let progressionRarityFilterValues = new Set();

function setProgressionRarityFilter(value) {
    if (value === '') {
        progressionRarityFilterValues.clear();
    } else if (progressionRarityFilterValues.has(value)) {
        progressionRarityFilterValues.delete(value);
    } else {
        progressionRarityFilterValues.add(value);
    }
    populateProgressionRarityFilter();
    renderProgressionCardsGrid();
}

function populateProgressionRarityFilter() {
    const rarities = sortRaritiesByTier([...new Set(currentProgressionCards.map(c => c.rarity).filter(Boolean))]);
    document.getElementById('progression-rarity-filter-row').innerHTML =
        buildRarityFilterRowHtml(rarities, progressionRarityFilterValues, 'setProgressionRarityFilter');
}

async function renderProgressionCardsGrid() {
    const grid = document.getElementById('progression-cards-grid');
    const searchTerm = document.getElementById('progression-search').value.toLowerCase();

    // Une carte est "possédée" dans un mode donné si on en a une ligne avec cette finition précise
    // (les cartes sans finish renseigné - ajoutées avant cette fonctionnalité - comptent comme "normal")
    const isOwnedInMode = (tcgdexId, mode) =>
        allCollectionCards.some(c => c.tcgdex_id === tcgdexId && (c.finish || 'normal') === mode);

    let baseCards = currentProgressionCards;
    if (progressionFinishMode !== 'normal') {
        // Hors mode Normal, on ne montre que les cartes qui ont réellement cette finition précise
        baseCards = baseCards.filter(c => cardHasFinishVariant(c, progressionFinishMode));
    }

    const ownedCount = baseCards.filter(c => isOwnedInMode(c.id, progressionFinishMode)).length;
    const totalCount = baseCards.length;
    const pct = totalCount > 0 ? Math.round((ownedCount / totalCount) * 100) : 0;
    document.getElementById('progression-set-progress-text').textContent = `${ownedCount} / ${totalCount} cartes possédées · ${pct}%`;

    let cards = baseCards;
    if (searchTerm) {
        cards = cards.filter(c =>
            (c.name || '').toLowerCase().includes(searchTerm) ||
            String(c.localId || '').toLowerCase().includes(searchTerm)
        );
    }
    if (progressionFilter === 'owned') {
        cards = cards.filter(c => isOwnedInMode(c.id, progressionFinishMode));
    } else if (progressionFilter === 'missing') {
        cards = cards.filter(c => !isOwnedInMode(c.id, progressionFinishMode));
    }

    if (progressionRarityFilterValues.size > 0) {
        cards = cards.filter(c => progressionRarityFilterValues.has(c.rarity));
    }

    cards = [...cards].sort((a, b) => (parseInt(a.localId) || 0) - (parseInt(b.localId) || 0));

    if (cards.length === 0) {
        grid.innerHTML = `<p style="text-align: center; padding: 2rem; color: var(--slate);">${progressionFinishMode === 'reverse' ? 'Aucune carte reverse ne correspond' : 'Aucune carte ne correspond'}</p>`;
        return;
    }

    const storedFilenames = currentProgressionStoredFilenames;

    grid.innerHTML = cards.map(card => {
        const owned = isOwnedInMode(card.id, progressionFinishMode);
        const ownedCardRow = owned
            ? allCollectionCards.find(c => c.tcgdex_id === card.id && (c.finish || 'normal') === progressionFinishMode)
            : null;
        const ownedQuantity = owned
            ? allCollectionCards
                .filter(c => c.tcgdex_id === card.id && (c.finish || 'normal') === progressionFinishMode)
                .reduce((sum, c) => sum + Number(c.quantity || 1), 0)
            : 0;

        let imageUrl = '';
        if (ownedCardRow && ownedCardRow.image) {
            imageUrl = ownedCardRow.image; // Notre image (auto ou uploadée manuellement), déjà une URL complète
        } else if (storedFilenames.has(`${sanitizeForPath(card.id)}.jpg`)) {
            // On a déjà hébergé une image pour cette carte (même si elle n'est plus/pas encore en collection)
            const { data } = supabaseClient.storage.from('card-images').getPublicUrl(getTcgdexImagePath(card.id));
            imageUrl = data.publicUrl;
        } else if (card.image) {
            imageUrl = `${card.image}/low.webp`; // Lien brut TCGdex en secours
        }

        return `
            <div class="progression-card-item ${owned ? 'owned' : 'missing'} ${progressionFinishMode !== 'normal' ? 'reverse-mode' : ''}" ${owned && ownedCardRow ? `onclick="showCardDetail(${ownedCardRow.id})"` : `onclick="addFromProgression('${card.id}', null)"`}>
                ${imageUrl
                    ? `<img src="${imageUrl}" alt="${card.name}" loading="lazy" onerror="this.style.display='none'">`
                    : '<div class="progression-card-noimg"><i class="ti ti-photo-off" aria-hidden="true"></i></div>'
                }
                ${ownedQuantity > 1 ? `<div class="qty-badge">×${ownedQuantity}</div>` : ''}
                <button class="progression-add-badge" onclick="event.stopPropagation(); quickInstantAdd('${card.id}', this)">+</button>
                <div class="progression-card-label">#${card.localId} ${card.name}</div>
            </div>
        `;
    }).join('');
}

// Scanne toutes les cartes d'un set pour repérer les finitions spéciales réellement disponibles
// (Reverse classique, et chaque foil distinct : Pokéball, Énergie...)
function computeAvailableFinishModes(cards) {
    const modes = new Map();
    modes.set('normal', 'Normale');

    cards.forEach(card => {
        const variants = card.variants_detailed;
        if (!Array.isArray(variants)) return;
        variants.forEach(v => {
            if (v.foil) {
                if (!modes.has(v.foil)) modes.set(v.foil, v.foil);
            } else if (v.type === 'Reverse') {
                if (!modes.has('reverse')) modes.set('reverse', 'Reverse');
            }
        });
    });

    return modes;
}

function renderProgressionFinishToggle() {
    const container = document.getElementById('progression-finish-toggle-row');
    if (!container) return;

    const modes = computeAvailableFinishModes(currentProgressionCards);
    container.innerHTML = [...modes.entries()].map(([value, label]) => {
        const isActive = progressionFinishMode === value;

        if (value === 'normal') {
            return `<button class="view-toggle-btn ${isActive ? 'active' : ''}" onclick="setProgressionFinishMode('normal')">${label}</button>`;
        }

        const foilIcon = getFoilIconHtml(value, 24);
        if (foilIcon) {
            // Icône seule + info-bulle au survol, comme pour les icônes de rareté
            return `<button class="view-toggle-btn ${isActive ? 'active' : ''}" data-tooltip="${label}" onclick="setProgressionFinishMode('${value.replace(/'/g, "\\'")}')">${foilIcon}</button>`;
        }

        // Pas d'icône dédiée (ex: Reverse classique) : on garde le texte
        return `<button class="view-toggle-btn ${isActive ? 'active' : ''}" onclick="setProgressionFinishMode('${value.replace(/'/g, "\\'")}')"><i class="ti ti-sparkles" aria-hidden="true"></i> ${label}</button>`;
    }).join('');
}

// Une carte propose-t-elle réellement cette finition précise ?
function cardHasFinishVariant(card, mode) {
    if (mode === 'normal') return true;
    const variants = card.variants_detailed;
    if (!Array.isArray(variants)) return false;
    return variants.some(v => {
        if (v.foil) return v.foil === mode;
        if (v.type === 'Reverse' && mode === 'reverse') return true;
        return false;
    });
}

function setProgressionFinishMode(mode) {
    progressionFinishMode = mode;
    renderProgressionFinishToggle();
    renderProgressionCardsGrid();
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

// Ajout instantané (bouton "+"), sans ouvrir de fenêtre, avec les réglages par défaut
async function quickInstantAdd(cardId, btnEl) {
    if (btnEl) {
        btnEl.disabled = true;
        btnEl.innerHTML = '<span class="loading" style="width:12px;height:12px;border-width:2px;"></span>';
    }

    try {
        let cardData = currentProgressionCards.find(c => c.id === cardId);

        if (!cardData) {
            let response = await fetch(`${API_BASE}/cards/${cardId}`);
            let detail = await response.json();
            if (!detail || detail.status) {
                const enResponse = await fetch(`${API_EN}/cards/${cardId}`);
                detail = await enResponse.json();
            }
            cardData = detail;
        }

        const defaults = getQuickAddDefaults();

        await performCardAdd(cardData, {
            condition: defaults.condition,
            quantity: defaults.quantity,
            acquisitionType: defaults.acquisitionType,
            purchasePrice: defaults.purchasePrice,
            customImage: null,
            customDate: defaults.date || null,
            finish: progressionFinishMode
        });

        showMessage(`${cardData.name} ajoutée !`, 'success');
        await refreshCollection();
        await recordValueSnapshot();
        renderProgressionCardsGrid();
    } catch (error) {
        showMessage('Erreur lors de l\'ajout rapide', 'error');
        console.error(error);
        if (btnEl) {
            btnEl.disabled = false;
            btnEl.innerHTML = '+';
        }
    }
}

function getQuickAddUploadPlaceholderHtml(tcgdexId) {
    return `<div class="no-image-placeholder modal-size upload-placeholder" onclick="document.getElementById('quickadd-upload-input').click()">
        <i class="ti ti-photo-off" aria-hidden="true"></i>
    </div>
    <input type="file" id="quickadd-upload-input" accept="image/*" style="display:none" onchange="handleQuickAddImageUpload(event, '${tcgdexId || ''}')">`;
}

async function handleQuickAddImageUpload(event, tcgdexId) {
    const file = event.target.files[0];
    if (!file) return;

    const slot = document.getElementById('quickadd-image-slot');
    slot.innerHTML = '<div class="no-image-placeholder modal-size"><span class="loading" style="border-top-color: #ff6b6b;"></span></div>';

    try {
        const publicUrl = await uploadImageToStorage(file, tcgdexId || null);
        customQuickAddImage = publicUrl;

        slot.innerHTML = `
            <img src="${publicUrl}" alt="Carte" class="modal-image" style="cursor: pointer;" onclick="document.getElementById('quickadd-upload-input-2').click()">
            <input type="file" id="quickadd-upload-input-2" accept="image/*" style="display:none" onchange="handleQuickAddImageUpload(event, '${tcgdexId}')">
        `;
        showMessage('Image envoyée !', 'success');
    } catch (error) {
        showMessage('Erreur lors de l\'envoi de l\'image', 'error');
        console.error(error);
        slot.innerHTML = getQuickAddUploadPlaceholderHtml(tcgdexId);
    }
}

function showAddCardModal(card) {
    customQuickAddImage = null;
    const qaDefaults = getQuickAddDefaults();

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
                <div id="quickadd-image-slot">
                    ${imageUrl
                        ? `<img src="${imageUrl}" alt="${card.name}" class="modal-image" onerror="this.outerHTML=getGridNoImageHtml()">`
                        : getQuickAddUploadPlaceholderHtml(card.id)
                    }
                </div>
            </div>
            <div class="modal-info">
                <div class="modal-title">${card.name}</div>
                <div class="modal-subtitle">${card.set?.name || 'N/A'} · #${card.localId || '?'}</div>

                <div class="modal-badges">
                    <span class="modal-pill rarity-pill">${getRarityIconHtml(card.rarity, 14)} ${card.rarity || 'N/A'}</span>
                    ${marketPrice > 0 ? `<span class="modal-pill acquisition-pill"><i class="ti ti-currency-euro" aria-hidden="true"></i> ${marketPrice.toFixed(2)}€ (marché)</span>` : ''}
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
                        <label for="quickadd-finish">Finition</label>
                        <select id="quickadd-finish">
                            ${buildFinishOptionsHtml(card, progressionFinishMode)}
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="quickadd-quantity">Quantité</label>
                        <input type="number" id="quickadd-quantity" value="${qaDefaults.quantity}" min="1" max="100">
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
                        <input type="number" id="quickadd-purchase-price" value="${qaDefaults.acquisitionType === 'pack' ? '' : qaDefaults.purchasePrice}" step="0.01" min="0" placeholder="optionnel">
                    </div>
                    <div class="form-group">
                        <label for="quickadd-date-added">Date d'acquisition</label>
                        <input type="text" id="quickadd-date-added" placeholder="jj/mm/aaaa">
                    </div>
                </div>

                <button class="modal-save-btn full-width" id="quickadd-submit-btn" onclick="submitQuickAdd(${JSON.stringify(card).replace(/"/g, '&quot;')})"><i class="ti ti-plus" aria-hidden="true"></i> Ajouter à ma collection</button>
            </div>
        </div>
    `;

    document.getElementById('quickadd-condition').value = qaDefaults.condition;
    document.getElementById('quickadd-acquisition').value = qaDefaults.acquisitionType;

    document.getElementById('card-detail-overlay').classList.add('active');
    toggleQuickAddPurchasePriceField();
    initDatePicker('#quickadd-date-added', qaDefaults.date || null);
}

function toggleQuickAddPurchasePriceField() {
    const val = document.getElementById('quickadd-acquisition').value;
    document.getElementById('quickadd-purchase-price-group').style.display = val === 'pack' ? 'none' : '';
}

async function submitQuickAdd(card) {
    const condition = document.getElementById('quickadd-condition').value;
    const finish = document.getElementById('quickadd-finish').value;
    const quantity = parseInt(document.getElementById('quickadd-quantity').value) || 1;
    const acquisitionType = document.getElementById('quickadd-acquisition').value;
    const purchasePrice = acquisitionType === 'pack'
        ? 0
        : (parseFloat(document.getElementById('quickadd-purchase-price').value) || 0);
    const customDate = document.getElementById('quickadd-date-added').value || null;

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
            customImage: customQuickAddImage,
            customDate,
            finish,
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
    customQuickAddImage = null;

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
document.getElementById('month-summary-select').addEventListener('change', renderMonthlySummary);

// Initialise Flatpickr avec le thème et la locale de l'app sur un champ de date donné
function initDatePicker(selector, presetValue) {
    if (typeof flatpickr === 'undefined') return;
    flatpickr(selector, {
        locale: 'fr',
        dateFormat: 'Y-m-d',
        altInput: true,
        altFormat: 'd/m/Y',
        maxDate: 'today',
        monthSelectorType: 'static',
        defaultDate: presetValue || null
    });
}

async function init() {
    await refreshCollection();
    await loadWishlists();
    await renderStatsCharts();
    await renderHeroValueCard();
    updateLastRefreshLabel();
    initDatePicker('#card-date-added');
}
init();
