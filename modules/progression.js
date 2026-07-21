// Progression par série + ajout rapide - Pokémon Tracker
// Dépend de: supabaseClient/API_BASE/API_EN/allCollectionCards/performCardAdd/refreshCollection/recordValueSnapshot (tracker.js),
// sanitizeForPath/getSetIdFromTcgdexId/sortRaritiesByTier/buildRarityFilterRowHtml/getFoilIconHtml/buildFinishOptionsHtml/
// getRarityIconHtml/initDatePicker (utils.js), getStoredImageFilenames/uploadImageToStorage/uploadSeriesLogoManually (storage.js),
// showCardDetail/closeCardDetail/getGridNoImageHtml (card-detail.js/collection.js), showMessage (utils.js)
// Le HTML de renderProgressionCardsGrid appelle showAddCardModal/quickInstantAdd en onclick : ces deux sous-features
// sont couplées via le DOM, d'où leur regroupement dans un seul module.
// Etat possédé : customQuickAddImage, QUICKADD_DEFAULTS_KEY, allTcgdexSeries, currentProgressionSetId,
// currentProgressionCards, progressionFilter, progressionFinishMode, currentProgressionStoredFilenames,
// progressionRarityFilterValues

let customQuickAddImage = null; // URL Supabase Storage une fois uploadée (vignette d'ajout rapide)

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
