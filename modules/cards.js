// Recherche + aperçu + ajout onglet "Ajouter" - Pokémon Tracker
// Dépend de: supabaseClient/API_BASE/API_EN (tracker.js), utils.js, storage.js,
// allCollectionCards/performCardAdd/refreshCollection/recordValueSnapshot (tracker.js)
// Etat possédé : selectedCard, lastSearchResults, customPreviewImage, searchRequestId, currentMarketValue

let selectedCard = null;
let lastSearchResults = [];
let customPreviewImage = null; // URL Supabase Storage une fois uploadée

let currentMarketValue = 0;    // Valeur marché (CardMarket) de la carte actuellement sélectionnée

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
            btn.innerHTML = '<i class="ti ti-search" aria-hidden="true"></i> Rechercher';
        }
    }
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

        let price = 0;
        if (card.pricing?.cardmarket?.avg) {
            price = card.pricing.cardmarket.avg;
        } else if (card.pricing?.cardmarket?.['avg-holo']) {
            price = card.pricing.cardmarket['avg-holo'];
        }

        return `
            <div class="search-result-item" onclick="selectCard(${JSON.stringify(card).replace(/"/g, '&quot;')})">
                ${imgHtml}
                <div class="search-result-info">
                    <div class="search-result-name">${card.name || '?'}</div>
                    <div class="search-result-set">${logoUrl ? `<img src="${logoUrl}" class="series-logo-inline" alt="" onerror="this.remove()">` : ''}${setName} - #${cardNumber}</div>
                </div>
                ${price > 0 ? `<div class="search-result-price">${price.toFixed(2)}€</div>` : ''}
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
            <i class="ti ti-photo-off" aria-hidden="true"></i>
            <span class="upload-btn-pill"><i class="ti ti-upload" aria-hidden="true"></i> Choisir une image</span>
            <span class="upload-hint">PNG, JPG ou WEBP (max 5MB)</span>
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

// ===== AJOUT ONGLET "AJOUTER" =====

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
