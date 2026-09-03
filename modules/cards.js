// Recherche + aperçu + ajout onglet "Ajouter" - Pokémon Tracker
// Dépend de: supabaseClient/API_BASE/API_EN (tracker.js), utils.js, storage.js,
// allCollectionCards/performCardAdd/refreshCollection/recordValueSnapshot (tracker.js)
// Etat possédé : selectedCard, lastSearchResults, customPreviewImage, searchRequestId, currentMarketValue,
// catalogueViewUserSet

// Ex-let converties en propriétés window (ticket V2 Vite, type="module") : lues/écrites depuis
// d'autres fichiers (wishlist.js, public-profile.js, tracker.js), une déclaration locale isolerait
// ce fichier de leurs écritures/lectures. Toute autre ligne de ce fichier qui fait "nom = valeur"
// plus loin continue de cibler ces mêmes propriétés window sans autre changement.
window.selectedCard = null;
window.lastSearchResults = [];
window.customPreviewImage = null; // URL Supabase Storage une fois uploadée

window.currentMarketValue = 0;    // Valeur marché (CardMarket) de la carte actuellement sélectionnée

// Devient true dès que l'utilisateur clique explicitement sur un bouton grille/liste
// (setCatalogueView) : au-delà, on ne réapplique plus jamais le défaut mobile automatique
// pour respecter son choix pour le reste de la session (cf displaySearchResults).
let catalogueViewUserSet = false;

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

// Suggestions cliquables de l'etat "avant recherche" (audit design 2026-09, cf app-empty-state dans
// index.html) : simple raccourci, remplit le champ et relance la meme recherche que si l'utilisateur
// l'avait tapee lui-meme.
function runSuggestedCatalogueSearch(term) {
    document.getElementById('card-search').value = term;
    searchCards();
}

// Recherches recentes (retour utilisateur 2026-09, "on pourrait ajouter les recherches recentes")
// : localStorage, meme convention que les autres preferences d'affichage de ce projet
// (dashboardWidgetOrder...) - jamais synchronise entre appareils, pas critique. Plus recent en
// premier, dedupliqué insensible a la casse (retaper "pikachu" apres "Pikachu" fait juste remonter
// l'entree existante en tete plutot que d'avoir les deux versions cote a cote).
const CATALOGUE_RECENT_SEARCHES_KEY = 'catalogueRecentSearches';
const CATALOGUE_RECENT_SEARCHES_MAX = 6;

function getRecentCatalogueSearches() {
    try {
        const stored = JSON.parse(localStorage.getItem(CATALOGUE_RECENT_SEARCHES_KEY) || '[]');
        return Array.isArray(stored) ? stored.filter(t => typeof t === 'string' && t.trim()) : [];
    } catch (e) { return []; } // stockage corrompu, repli sur aucun historique
}

function recordRecentCatalogueSearch(term) {
    const recent = getRecentCatalogueSearches().filter(t => t.toLowerCase() !== term.toLowerCase());
    recent.unshift(term);
    localStorage.setItem(CATALOGUE_RECENT_SEARCHES_KEY, JSON.stringify(recent.slice(0, CATALOGUE_RECENT_SEARCHES_MAX)));
}

// Markup identique au bloc statique d'index.html (#search-results) - reutilise ici pour y revenir
// apres une recherche effacee (input vide, cf tracker.js), plutot que de dupliquer une 3e fois ce
// HTML ou de laisser un panneau vide sans le message/les suggestions.
function catalogueSearchReadyHtml() {
    const recent = getRecentCatalogueSearches();
    // Exemples fixes tant qu'aucune recherche n'a encore ete faite sur cet appareil (premiere visite) -
    // le panneau ne doit jamais rester sans suggestions du tout.
    const chipTerms = recent.length > 0 ? recent : ['Pikachu', 'Dracaufeu-ex', '151', 'Nuit Noire'];
    const chipsLabel = recent.length > 0 ? 'Recherches récentes' : 'Essayez par exemple';

    return `
        <div class="app-empty-state catalogue-search-empty">
            <svg class="app-empty-icon" viewBox="0 0 100 100" aria-hidden="true">
                <circle cx="44" cy="44" r="28" fill="none" stroke="currentColor" stroke-width="3"/>
                <line x1="64" y1="64" x2="86" y2="86" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
            </svg>
            <div class="app-empty-title">Prêt à chercher</div>
            <p class="app-empty-text">Un nom, une série ou un numéro suffisent.</p>
            <div class="catalogue-search-suggestions-label">${chipsLabel}</div>
            <div class="catalogue-search-suggestions">
                ${chipTerms.map(term => `<button type="button" class="catalogue-search-chip" onclick="runSuggestedCatalogueSearch('${term.replace(/'/g, "\\'")}')">${escapeHtml(term)}</button>`).join('')}
            </div>
        </div>
    `;
}

// Etat "recherche sans resultat" (audit design 2026-09) : distinct de catalogueSearchReadyHtml
// ci-dessus - ne doit jamais laisser croire qu'aucune recherche n'a encore ete lancee alors qu'une
// vraie recherche vient d'echouer.
function catalogueSearchNoResultsHtml(search) {
    return `
        <div class="app-empty-state catalogue-search-empty">
            <svg class="app-empty-icon" viewBox="0 0 100 100" aria-hidden="true">
                <circle cx="44" cy="44" r="28" fill="none" stroke="currentColor" stroke-width="3"/>
                <line x1="64" y1="64" x2="86" y2="86" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
                <line x1="34" y1="44" x2="54" y2="44" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
            </svg>
            <div class="app-empty-title">Aucune carte trouvée</div>
            <p class="app-empty-text">Rien ne correspond à « ${escapeHtml(search)} ». Vérifiez l'orthographe ou essayez un autre terme.</p>
        </div>
    `;
}

// recordHistory=false pour la recherche automatique "au fil de la frappe" (tracker.js, debounce sur
// l'input) : sinon chaque fragment tape ("s", "st", "sta"...) se retrouvait enregistre comme une
// recherche a part entiere des que l'utilisateur marquait une pause de 350ms, polluant "Recherches
// recentes" de bouts de mots (retour utilisateur avec capture d'ecran, 2026-09). Seule une recherche
// deliberement validee (Entree, bouton Rechercher, clic sur une suggestion/illustrateur) doit compter.
async function searchCards({ recordHistory = true } = {}) {
    const search = document.getElementById('card-search').value.trim();
    if (!search) {
        showMessage('Veuillez entrer un nom, une série, un numéro ou un illustrateur', 'error');
        return;
    }

    if (recordHistory) recordRecentCatalogueSearch(search);

    const myRequestId = ++searchRequestId;

    const btn = document.getElementById('search-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="loading"></span>Recherche...';

    showSearchResultsSkeleton();

    // Recherche combinée : le champ peut matcher le nom, la série, l'illustrateur ou le
    // numéro. On interroge TCGdex sur chaque attribut en parallèle (FR+EN) et on
    // fusionne/déduplique les résultats par id de carte. localId seulement si des
    // chiffres sont tapés, pour éviter une requête inutile.
    const encoded = encodeURIComponent(search);
    const searchFields = ['name', 'illustrator', 'set.name'];
    if (/\d/.test(search)) searchFields.push('localId');

    const urls = [];
    for (const field of searchFields) {
        urls.push(`${API_BASE}/cards?${field}=${encoded}`);
        urls.push(`${API_EN}/cards?${field}=${encoded}`);
    }

    try {
        const settled = await Promise.allSettled(urls.map(url => fetch(url).then(r => r.json())));

        // Une recherche plus récente a déjà démarré entre-temps : on abandonne celle-ci
        if (myRequestId !== searchRequestId) return;

        const merged = [];
        const seenIds = new Set();
        for (const result of settled) {
            if (result.status !== 'fulfilled') continue;
            const list = Array.isArray(result.value) ? result.value : [];
            for (const card of list) {
                if (!seenIds.has(card.id)) {
                    merged.push(card);
                    seenIds.add(card.id);
                }
            }
        }

        if (merged.length === 0) {
            showMessage('Aucune carte trouvée', 'error');
            document.getElementById('search-results').innerHTML = catalogueSearchNoResultsHtml(search);
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

function searchByIllustrator() {
    if (!selectedCard?.illustrator) return;
    document.getElementById('card-search').value = selectedCard.illustrator;
    searchCards();
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

    // Défaut vue liste sur mobile (grille illisible à cette largeur, cf audit) : seulement tant que
    // l'utilisateur n'a jamais cliqué lui-même sur un bouton grille/liste (catalogueViewUserSet).
    // Même seuil que getCataloguePageSize() plus bas dans ce fichier (cohérence mobile/desktop).
    if (!catalogueViewUserSet && window.matchMedia('(max-width: 960px)').matches) {
        setCatalogueView('list', false);
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

// Desktop (>960px, cf .catalogue-scene) affiche plus de résultats par page grâce à la densité de
// grille retrouvée sans sélection ; mobile garde 8 pour éviter une liste trop longue. Lue à chaque
// reset/clic "Charger plus", jamais mise en cache : un resize entre-temps s'applique naturellement
// à la prochaine évaluation, sans listener dédié.
function getCataloguePageSize() {
    return window.matchMedia('(min-width: 961px)').matches ? 24 : 8;
}

let lastFilteredResults = [];
let catalogueVisibleCount = getCataloguePageSize();

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
    filtered = sortSearchResults(filtered);

    lastFilteredResults = filtered;
    catalogueVisibleCount = getCataloguePageSize();

    updateCatalogueResultsInfo(filtered.length);
    renderSearchResults(filtered.slice(0, catalogueVisibleCount));
    preloadNextCatalogueBatch(filtered);
    updateCatalogueLoadMoreButton(filtered.length);
}

function loadMoreCatalogueResults() {
    catalogueVisibleCount += getCataloguePageSize();
    renderSearchResults(lastFilteredResults.slice(0, catalogueVisibleCount));
    preloadNextCatalogueBatch(lastFilteredResults);
    updateCatalogueLoadMoreButton(lastFilteredResults.length);
}

// Anticipe le prochain "Charger plus de résultats" : précharge les images de la page suivante
// pendant que la page actuelle s'affiche (même URL /high.webp que renderSearchResults, cf ci-dessus).
function preloadNextCatalogueBatch(results) {
    const nextBatch = results.slice(catalogueVisibleCount, catalogueVisibleCount + getCataloguePageSize());
    preloadImages(nextBatch.map(c => c.image ? `${c.image}/high.webp` : (c._localImage || null)));
}

function updateCatalogueLoadMoreButton(totalCount) {
    const row = document.getElementById('catalogue-load-more-row');
    if (!row) return;
    const remaining = totalCount - catalogueVisibleCount;
    if (remaining > 0) {
        row.style.display = 'flex';
        document.getElementById('catalogue-load-more-btn').textContent = `Charger plus de résultats (${remaining} restante${remaining > 1 ? 's' : ''})`;
    } else {
        row.style.display = 'none';
    }
}

function renderSearchResults(cards) {
    const container = document.getElementById('search-results');

    if (cards.length === 0) {
        container.innerHTML = '<p style="text-align: center; padding: 1.5rem; color: #999;">Aucune carte ne correspond aux filtres</p>';
        container.classList.add('active');
        return;
    }

    container.innerHTML = cards.map(card => {
        const imageUrl = card.image ? `${card.image}/high.webp` : (card._localImage || '');
        const setName = card.set?.name || card.set?.id || 'N/A';
        const cardNumber = card.localId || '?';
        const logoUrl = card.set?.logo ? `${card.set.logo}.webp` : '';
        const imgHtml = imageUrl
            ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(card.name)}" class="search-result-img" onerror="handleTcgdexImgError(this, '<div class=&quot;no-image-placeholder small&quot;><i class=&quot;ti ti-photo-off&quot; aria-hidden=&quot;true&quot;></i></div>')">`
            : '<div class="no-image-placeholder small"><i class="ti ti-photo-off" aria-hidden="true"></i></div>';

        let price = 0;
        if (card.pricing?.cardmarket?.avg) {
            price = card.pricing.cardmarket.avg;
        } else if (card.pricing?.cardmarket?.['avg-holo']) {
            price = card.pricing.cardmarket['avg-holo'];
        }

        return `
            <div class="search-result-item" onclick="onSearchResultClick(${JSON.stringify(card).replace(/"/g, '&quot;')}, this)">
                ${imgHtml}
                <div class="search-result-info">
                    <div class="search-result-text">
                        <div class="search-result-name">${escapeHtml(card.name || '?')}</div>
                        <div class="search-result-set">${escapeHtml(setName)} - #${escapeHtml(cardNumber)}</div>
                        ${price > 0 ? `<div class="search-result-price">${formatPrice(price)}</div>` : ''}
                    </div>
                    ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" class="search-result-series-logo" alt="" onerror="handleSealLogoError(this)">` : ''}
                </div>
            </div>
        `;
    }).join('');
    container.classList.add('active');
}

// ===== APERCU DE CARTE =====

let selectionToken = 0;

// Transition en deux temps : si une carte était déjà affichée, on atténue l'ancien contenu
// (~90ms) avant de remplacer les données dans le DOM, puis on fait entrer le nouveau contenu.
// selectedCard est mis à jour immédiatement (synchrone) pour que le reste de l'app (ajout,
// double-clic rapide...) travaille toujours sur la bonne carte, même pendant la transition visuelle.
function selectCard(card) {
    const myToken = ++selectionToken;
    const hadPreviousCard = !!selectedCard;
    selectedCard = card;
    customPreviewImage = null;
    document.getElementById('search-results').classList.remove('active');

    const imageEl = document.querySelector('.preview-image');
    const detailsEl = document.querySelector('.preview-details');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (hadPreviousCard && !reduceMotion) {
        imageEl.classList.remove('card-swap-enter');
        detailsEl.classList.remove('card-swap-enter');
        imageEl.classList.add('card-swap-exit');
        detailsEl.classList.add('card-swap-exit');

        setTimeout(() => {
            // Une sélection plus récente a pris le relais entre-temps : on abandonne celle-ci
            if (myToken !== selectionToken) return;
            imageEl.classList.remove('card-swap-exit');
            detailsEl.classList.remove('card-swap-exit');
            applyCardToPreview(card);
            replaySelectionEntrance(imageEl);
            replaySelectionEntrance(detailsEl);
        }, 90);
    } else {
        applyCardToPreview(card);
        if (!reduceMotion) {
            replaySelectionEntrance(imageEl);
            replaySelectionEntrance(detailsEl);
        }
    }
}

function applyCardToPreview(card) {
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

    const imageUrl = card.image ? `${card.image}/high.webp` : '';
    const previewImageContainer = document.querySelector('.preview-image');
    // Même source que le logo du breadcrumb (#preview-series-logo plus bas) : sceau incliné sur le coin
    // de l'image, visible uniquement dans la modale mobile (.mobile-add-overlay-card, cf styles.css) -
    // sur la page Ajouter desktop, le logo reste uniquement dans le breadcrumb (retour utilisateur,
    // 2026-08-18 : "on a oublié d'appliquer le logo sur le modal d'ajout de carte").
    const previewSealLogoUrl = card.set?.logo ? `${card.set.logo}.webp` : '';
    const previewSealHtml = previewSealLogoUrl
        ? `<img src="${previewSealLogoUrl}" class="modal-series-seal preview-image-seal" alt="" onerror="handleSealLogoError(this)">`
        : '';

    document.getElementById('card-finish').innerHTML = buildFinishOptionsHtml(card, 'normal');

    if (imageUrl) {
        previewImageContainer.innerHTML = `<div class="preview-image-frame"><img id="preview-img" src="" alt="Carte">${previewSealHtml}</div>`;
        const img = document.getElementById('preview-img');
        img.onerror = function() {
            handleTcgdexImgError(img, showPreviewUploadPlaceholder);
        };
        img.src = imageUrl;
    } else if (card._localImage) {
        // Déjà su depuis la liste de recherche : pas besoin de re-vérifier
        customPreviewImage = card._localImage;
        previewImageContainer.innerHTML = `
            <div class="preview-image-frame">
                <img src="${card._localImage}" alt="Carte" style="cursor: pointer;" onclick="document.getElementById('preview-upload-input-2').click()">
                ${previewSealHtml}
            </div>
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
                    <div class="preview-image-frame">
                        <img src="${existingUrl}" alt="Carte" style="cursor: pointer;" onclick="document.getElementById('preview-upload-input-2').click()">
                        ${previewSealHtml}
                    </div>
                    <input type="file" id="preview-upload-input-2" accept="image/*" style="display:none" onchange="handlePreviewImageUpload(event)">
                `;
            }
        });
    }

    document.getElementById('preview-name').textContent = card.name || '-';
    document.getElementById('preview-set-text').textContent = card.set?.name || '-';
    const totalCards = card.set?.cardCount?.official || card.set?.cardCount?.total;
    document.getElementById('preview-number').textContent = card.localId
        ? (totalCards ? `${card.localId}/${totalCards}` : card.localId)
        : '-';

    const favStarEl = document.getElementById('preview-favorite-star');
    if (favStarEl) {
        if (card.id) {
            favStarEl.style.display = 'inline-flex';
            favStarEl.onclick = () => toggleFavorite(card.id, favStarEl);
            applyFavoriteButtonState(favStarEl, isFavorite(card.id));
        } else {
            favStarEl.style.display = 'none';
        }
    }

    let types = 'N/A';
    if (card.types && Array.isArray(card.types)) {
        types = card.types.join(', ');
    }
    document.getElementById('preview-type').innerHTML = `${getTypesIconsHtml(types)} ${types}`;

    const illustratorEl = document.getElementById('preview-illustrator');
    illustratorEl.textContent = card.illustrator || '-';
    illustratorEl.classList.toggle('preview-info-value-clickable', !!card.illustrator);

    document.getElementById('preview-rarity').innerHTML = `${getRarityIconHtml(card.rarity)} ${card.rarity || '-'}`;
    document.getElementById('preview-rarity-badge').innerHTML = card.rarity
        ? `${getRarityIconHtml(card.rarity)} ${card.rarity}`
        : '';

    let price = 0;
    let avg30 = 0;
    if (card.pricing?.cardmarket?.avg) {
        price = card.pricing.cardmarket.avg;
        avg30 = card.pricing.cardmarket.avg30 || 0;
    } else if (card.pricing?.cardmarket?.['avg-holo']) {
        price = card.pricing.cardmarket['avg-holo'];
        avg30 = card.pricing.cardmarket['avg30-holo'] || 0;
    }
    currentMarketValue = price;
    document.getElementById('preview-price').textContent = price > 0 ? formatPrice(price) : '-';
    document.getElementById('card-value').value = price > 0 ? price.toFixed(2) : '';

    const priceBox = document.getElementById('preview-price-box');
    const trendEl = document.getElementById('preview-price-trend');
    if (price > 0) {
        priceBox.style.display = '';
        document.getElementById('preview-price-big').textContent = formatPrice(price);
        if (avg30 > 0) {
            const deltaPct = ((price - avg30) / avg30) * 100;
            const arrow = deltaPct > 0 ? '▲' : deltaPct < 0 ? '▼' : '';
            trendEl.textContent = `${arrow} ${Math.abs(deltaPct).toFixed(1)}%`;
            trendEl.className = 'hero-fluctuation ' + (deltaPct > 0 ? 'positive' : deltaPct < 0 ? 'negative' : 'neutral');
        } else {
            trendEl.textContent = '';
            trendEl.className = 'hero-fluctuation';
        }
    } else {
        priceBox.style.display = 'none';
    }

    const cardmarketLink = document.getElementById('preview-cardmarket-link');
    cardmarketLink.href = getCardmarketUrl(card.pricing?.cardmarket?.idProduct, card.name);
    cardmarketLink.style.display = '';

    // Réinitialiser le mode d'obtention à "Achetée" par défaut pour chaque nouvelle carte
    document.getElementById('card-acquisition').value = 'achat';
    document.getElementById('purchase-price-group').style.display = '';

    document.getElementById('card-preview').classList.add('active');

    resetRelatedCardsBlock(card);
}

// ===== CARTES LIÉES (même set / même illustrateur que la carte sélectionnée) =====
// Comble le vide sous la fiche "collante" sans jamais faire doublon avec la recherche en cours -
// contrairement à un simple "autres éditions de ce Pokémon" (qu'une recherche par nom montre déjà),
// le set et l'illustrateur ne sont jamais des axes déjà couverts par ce que l'utilisateur a tapé.

let relatedCardsMode = 'set';
let relatedCardsToken = 0;
let relatedCardsCache = { set: null, illustrator: null };
const RELATED_CARDS_LIMIT = 6;

function resetRelatedCardsBlock(card) {
    relatedCardsMode = 'set';
    relatedCardsCache = { set: null, illustrator: null };

    const block = document.getElementById('related-cards-block');
    const setTab = document.querySelector('.related-cards-tab[data-mode="set"]');
    const illustratorTab = document.querySelector('.related-cards-tab[data-mode="illustrator"]');
    if (!block) return;

    if (!card?.id || !card.set?.id) {
        block.style.display = 'none';
        return;
    }

    block.style.display = '';
    setTab?.classList.add('active');
    illustratorTab?.classList.remove('active');
    if (illustratorTab) illustratorTab.disabled = !card.illustrator;

    loadRelatedCards(card);
}

function setRelatedCardsMode(mode) {
    if (mode === relatedCardsMode || !selectedCard) return;
    if (mode === 'illustrator' && !selectedCard.illustrator) return;

    relatedCardsMode = mode;
    document.querySelectorAll('.related-cards-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
    loadRelatedCards(selectedCard);
}

async function loadRelatedCards(card) {
    const myToken = ++relatedCardsToken;
    const mode = relatedCardsMode;
    const listEl = document.getElementById('related-cards-list');
    const titleEl = document.getElementById('related-cards-title');
    if (!listEl || !titleEl) return;

    if (relatedCardsCache[mode]) {
        renderRelatedCardsList(relatedCardsCache[mode], card);
        return;
    }

    listEl.innerHTML = '<div class="related-cards-loading"><span class="loading"></span></div>';
    titleEl.textContent = '';

    try {
        let briefCards = [];
        if (mode === 'set') {
            const res = await fetch(`${API_BASE}/sets/${card.set.id}`);
            const data = await res.json();
            briefCards = (data.cards || []).filter(c => c.id !== card.id);
        } else {
            const encoded = encodeURIComponent(card.illustrator);
            const settled = await Promise.allSettled([
                fetch(`${API_BASE}/cards?illustrator=${encoded}`).then(r => r.json()),
                fetch(`${API_EN}/cards?illustrator=${encoded}`).then(r => r.json()),
            ]);
            const seen = new Set();
            settled.forEach(r => {
                if (r.status !== 'fulfilled' || !Array.isArray(r.value)) return;
                r.value.forEach(c => {
                    if (c.id !== card.id && !seen.has(c.id)) { seen.add(c.id); briefCards.push(c); }
                });
            });
        }

        if (myToken !== relatedCardsToken) return; // sélection/onglet plus récent entre-temps

        // TCGdex ne renvoie que des objets brefs (id/localId/name/image) sur ces deux endpoints -
        // même limitation que la recherche principale (cf displaySearchResults) : détail complet
        // (prix/rareté) récupéré uniquement pour les quelques cartes réellement affichées, jamais pour
        // tout le lot (un set fait jusqu'à ~250 cartes).
        const shownBrief = briefCards.slice(0, RELATED_CARDS_LIMIT);
        const enriched = await Promise.all(shownBrief.map(enrichBriefCard));

        if (myToken !== relatedCardsToken) return;

        relatedCardsCache[mode] = { total: briefCards.length, cards: enriched };
        renderRelatedCardsList(relatedCardsCache[mode], card);
    } catch (error) {
        if (myToken !== relatedCardsToken) return;
        console.error('Erreur chargement cartes liées:', error);
        listEl.innerHTML = '<p class="related-cards-empty">Impossible de charger ces cartes pour le moment.</p>';
    }
}

// Même repli FR -> EN que displaySearchResults (certains sets récents n'ont pas leurs assets/textes FR).
async function enrichBriefCard(brief) {
    try {
        const res = await fetch(`${API_BASE}/cards/${brief.id}`);
        const detail = await res.json();
        if (detail && !detail.status) return detail;
        throw new Error('not found in FR');
    } catch {
        try {
            const enRes = await fetch(`${API_EN}/cards/${brief.id}`);
            return await enRes.json();
        } catch {
            return brief;
        }
    }
}

function renderRelatedCardsList(result, card) {
    const listEl = document.getElementById('related-cards-list');
    const titleEl = document.getElementById('related-cards-title');
    const mode = relatedCardsMode;
    const { total, cards } = result;

    titleEl.textContent = mode === 'set'
        ? `${total} autre${total > 1 ? 's' : ''} carte${total > 1 ? 's' : ''} dans ${card.set?.name || 'ce set'}`
        : `${total} autre${total > 1 ? 's' : ''} carte${total > 1 ? 's' : ''} de ${card.illustrator}`;

    if (cards.length === 0) {
        listEl.innerHTML = '<p class="related-cards-empty">Rien d\'autre à montrer ici.</p>';
        return;
    }

    listEl.innerHTML = cards.map(c => {
        const imageUrl = c.image ? `${c.image}/low.webp` : '';
        let price = 0;
        if (c.pricing?.cardmarket?.avg) price = c.pricing.cardmarket.avg;
        else if (c.pricing?.cardmarket?.['avg-holo']) price = c.pricing.cardmarket['avg-holo'];

        return `
            <div class="related-card-row" onclick="onSearchResultClick(${JSON.stringify(c).replace(/"/g, '&quot;')}, this)">
                ${imageUrl
                    ? `<img src="${imageUrl}" alt="" class="related-card-thumb" loading="lazy" onerror="this.outerHTML='<div class=&quot;related-card-thumb related-card-thumb-empty&quot;><i class=&quot;ti ti-photo-off&quot; aria-hidden=&quot;true&quot;></i></div>'">`
                    : '<div class="related-card-thumb related-card-thumb-empty"><i class="ti ti-photo-off" aria-hidden="true"></i></div>'
                }
                <div class="related-card-info">
                    <div class="related-card-name">${escapeHtml(c.name || '?')}</div>
                    <div class="related-card-set">${mode === 'set' ? (c.localId ? '#' + c.localId : '') : escapeHtml(c.set?.name || '')}</div>
                </div>
                ${price > 0 ? `<div class="related-card-price">${formatPrice(price)}</div>` : ''}
            </div>
        `;
    }).join('');
}

// Rejoue l'animation d'entrée CSS (.card-swap-enter) sur un élément après un changement de
// sélection de carte : reflow forcé pour redémarrer même si la classe était déjà présente
// (sélections rapides successives -> la dernière gagne, pas d'accumulation).
function replaySelectionEntrance(el) {
    if (!el) return;
    el.classList.remove('card-swap-enter');
    void el.offsetWidth;
    el.classList.add('card-swap-enter');
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

        const previewSealLogoUrl = selectedCard?.set?.logo ? `${selectedCard.set.logo}.webp` : '';
        const previewSealHtml = previewSealLogoUrl
            ? `<img src="${previewSealLogoUrl}" class="modal-series-seal preview-image-seal" alt="" onerror="handleSealLogoError(this)">`
            : '';

        previewImageContainer.innerHTML = `
            <div class="preview-image-frame">
                <img src="${publicUrl}" alt="Carte" style="cursor: pointer;" onclick="document.getElementById('preview-upload-input-2').click()">
                ${previewSealHtml}
            </div>
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

// Bandeau + confetti (retour utilisateur 2026-09) plutôt que le geste plus discret celebrateCardAdded()
// (étincelles + carte volante, utils.js) : sur cette page précise les ajouts se font un par un - pas
// de série rapide comme sur la grille Progression, où la même notif marquante deviendrait fatigante
// (cf celebrateCardAdded() toujours en place là-bas et sur la wishlist). previewImgEl : l'<img> de la
// fiche preview, déjà résolue vers la bonne source (upload perso ou fallback TCGdex, cf applyCardToPreview)
// - réutilisée telle quelle plutôt que reconstruite depuis card.image, pour rester fidèle à ce que
// l'utilisateur voyait à l'écran juste avant l'ajout.
function celebrateCardAddedBanner(card, quantity) {
    const previewImgEl = document.querySelector('.preview-image img');
    const imgHtml = previewImgEl
        ? `<img src="${escapeHtml(previewImgEl.src)}" class="app-celebration-icon-img" alt="" onerror="this.remove()">`
        : `<i class="ti ti-cards" aria-hidden="true"></i>`;
    const eyebrow = quantity > 1 ? `${quantity} cartes ajoutées` : 'Carte ajoutée';

    showCelebrationBanner(`
        <div class="app-celebration-icon-wrap">${imgHtml}</div>
        <div class="app-celebration-text">
            <span class="app-celebration-eyebrow"><i class="ti ti-circle-check" aria-hidden="true"></i> ${eyebrow}</span>
            <span class="app-celebration-title">${escapeHtml(card.name || '')}</span>
        </div>
    `);
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

    // Capturés avant performCardAdd()/refreshCollection() (qui mettent à jour allCollectionCards) :
    // c'est la comparaison ownedBefore/ownedAfter, une fois l'ajout confirmé, qui détecte qu'un set
    // vient de passer à 100% (cf appel à celebrateSetComplete plus bas). selectedCard.id (pas
    // .tcgdex_id) : c'est le résultat brut de recherche TCGdex (cf onSearchResultClick), qui n'est
    // renommé en colonne tcgdex_id qu'à l'écriture en base par performCardAdd (tracker.js, card.id).
    const addedCardSetId = selectedCard.id ? getSetIdFromTcgdexId(selectedCard.id) : null;
    const setOwnedBefore = addedCardSetId ? getSetOwnedCount(addedCardSetId) : 0;

    const addBtn = document.querySelector('.add-panel-submit');
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
            finish
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

    // Avant tout reset du formulaire ci-dessous (qui masque la fiche preview) : celebrateCardAddedBanner()
    // lit encore selectedCard/.preview-image à cet instant. Remplace les toasts textuels
    // "carte(s) ajoutée(s)"/"Quantité mise à jour" qui tournaient ici auparavant (retour utilisateur
    // 2026-09 : l'animation seule suffit).
    celebrateCardAddedBanner(selectedCard, quantity);

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

    // Uniquement après un ajout Collection réellement réussi (jamais dans le catch ci-dessus) : la
    // modale mobile doit rester ouverte avec les champs conservés en cas d'erreur. closeMobileAddPanel()
    // ne dépend pas de selectedCard, donc fonctionne même après sa remise à null juste au-dessus.
    if (isMobileAddPanelOpen()) closeMobileAddPanel();

    await refreshCollection();
    await recordValueSnapshot();

    // Détection de complétion APRÈS refreshCollection() (allCollectionCards à jour) : ne se déclenche
    // que sur une vraie transition <100% -> 100%, jamais sur un ajout à un set déjà complet (result.merged
    // notamment - le compte de cartes distinctes ne bouge alors pas, ownedAfter === ownedBefore).
    if (addedCardSetId) {
        const total = getSetTotalCount(addedCardSetId);
        if (total > 0 && setOwnedBefore < total) {
            const setOwnedAfter = getSetOwnedCount(addedCardSetId);
            if (setOwnedAfter >= total) celebrateSetComplete(addedCardSetId);
        }
    }
}

// ===== PHASE 2 CATALOGUE : bascule fiche consultation / formulaire d'ajout =====
// Purement visuel (classes CSS) : ne lit ni n'écrit aucune donnée, n'altère pas
// selectCard()/addCard(). Les champs du formulaire restent dans le DOM en permanence
// pour que addCard() continue de les trouver, qu'ils soient repliés ou non.

function toggleAddPanel(show) {
    const expand = document.getElementById('catalogue-add-expand');
    const toggleBtn = document.getElementById('add-panel-toggle');
    if (!expand) return;
    const next = typeof show === 'boolean' ? show : !expand.classList.contains('open');
    expand.classList.toggle('open', next);
    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', String(next));
}

// Grand desktop (>=1920px, cf mockup) : le panneau "Ajouter à ma collection" reste
// déplié par défaut pour remplir la fiche, au lieu de nécessiter un clic.
function isAddPanelDefaultOpen() {
    return window.matchMedia('(min-width: 1920px)').matches;
}

if (isAddPanelDefaultOpen()) toggleAddPanel(true);

function stepAddQuantity(delta) {
    const input = document.getElementById('card-quantity');
    if (!input) return;
    const min = Number(input.min) || 1;
    const max = Number(input.max) || 100;
    const next = Math.min(max, Math.max(min, (parseInt(input.value, 10) || min) + delta));
    input.value = next;
}

function markResultSelected(el) {
    document.querySelectorAll('.search-result-item.selected').forEach(item => item.classList.remove('selected'));
    el.classList.add('selected');
}

function onSearchResultClick(card, el) {
    selectCard(card);
    markResultSelected(el);
    toggleAddPanel(isAddPanelDefaultOpen());

    // openMobileAddPanel() est déjà défensive (no-op si >960px ou déjà ouverte) : rien à vérifier ici.
    openMobileAddPanel();
}

// ===== PHASE 3 CATALOGUE : tri, vue grille/liste, filtres avancés =====
// Filtrage/tri purement côté client sur lastSearchResults (déjà chargé par searchCards()).
// N'appelle ni ne modifie addCard()/selectCard()/performCardAdd() : aucune donnée persistée
// n'est lue ni écrite ici.

let activeSort = 'set-asc';

function getSearchResultPrice(card) {
    if (card.pricing?.cardmarket?.avg) return card.pricing.cardmarket.avg;
    if (card.pricing?.cardmarket?.['avg-holo']) return card.pricing.cardmarket['avg-holo'];
    return 0;
}

function sortSearchResults(cards) {
    const sorted = [...cards];
    if (activeSort === 'name-asc') {
        sorted.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } else if (activeSort === 'price-desc') {
        sorted.sort((a, b) => getSearchResultPrice(b) - getSearchResultPrice(a));
    } else {
        sorted.sort((a, b) => (a.set?.name || '').localeCompare(b.set?.name || ''));
    }
    return sorted;
}

function updateCatalogueResultsInfo(count) {
    const label = document.getElementById('catalogue-results-label');
    const countEl = document.getElementById('catalogue-results-count');
    const query = document.getElementById('card-search').value.trim();
    if (label) {
        if (query) {
            const escaped = query.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            label.innerHTML = `Résultats pour : <span class="catalogue-toolbar-query-highlight">${escaped}</span>`;
        } else {
            label.textContent = '';
        }
    }
    if (countEl) countEl.textContent = query ? `${count} carte${count !== 1 ? 's' : ''} trouvée${count !== 1 ? 's' : ''}` : '';
}

function setSearchSort(value) {
    activeSort = value;
    applySearchFilters();
}

// isUserAction=false réservé au défaut mobile automatique (displaySearchResults) : ne marque pas
// catalogueViewUserSet, pour que ce défaut puisse continuer à s'appliquer tant que l'utilisateur n'a
// pas lui-même cliqué sur un bouton grille/liste (onclick="setCatalogueView('grid'|'list')", sans
// second argument, garde donc isUserAction=true).
function setCatalogueView(mode, isUserAction = true) {
    if (isUserAction) catalogueViewUserSet = true;
    const grid = document.getElementById('search-results');
    if (grid) grid.classList.toggle('list-view', mode === 'list');
    document.querySelectorAll('.catalogue-view-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === mode);
    });
}

function toggleCatalogueFilterPopover(event) {
    if (event) event.stopPropagation();
    document.getElementById('catalogue-filter-popover').classList.toggle('active');
}

document.addEventListener('click', (e) => {
    const popover = document.getElementById('catalogue-filter-popover');
    if (popover && popover.classList.contains('active') && !e.target.closest('.catalogue-filter-popover-wrap')) {
        popover.classList.remove('active');
    }
});

// ===== MODALE MOBILE "AJOUTER" (<=960px) =====
// Déplace physiquement .catalogue-sheet-sticky (même nœud, formulaire inclus) entre .catalogue-sheet-col
// (desktop) et #mobile-add-overlay-card (modale mobile) : un seul formulaire, jamais recréé/dupliqué,
// aucun ID dupliqué, aucun listener rajouté sur les champs (tout est déjà en onclick inline sur les
// éléments déplacés, donc conservé automatiquement par le déplacement).

function isMobileAddPanelViewport() {
    return window.matchMedia('(max-width: 960px)').matches;
}

function isMobileAddPanelOpen() {
    const overlay = document.getElementById('mobile-add-overlay');
    return !!overlay && overlay.classList.contains('active');
}

// Le popup flatpickr est positionné en absolute par rapport à l'input au moment de l'ouverture : un
// changement de parent pendant qu'il est ouvert le laisserait mal ancré, d'où la fermeture préalable
// systématique avant tout déplacement de nœud (ouverture comme fermeture de la modale).
function closeCardDateFlatpickr() {
    const input = document.getElementById('card-date-added');
    if (input && input._flatpickr) input._flatpickr.close();
}

function openMobileAddPanel() {
    if (!isMobileAddPanelViewport()) return;
    if (isMobileAddPanelOpen()) return;

    const sheet = document.querySelector('.catalogue-sheet-sticky');
    const overlayCard = document.getElementById('mobile-add-overlay-card');
    const overlay = document.getElementById('mobile-add-overlay');
    if (!sheet || !overlayCard || !overlay) return;

    closeCardDateFlatpickr();
    overlayCard.appendChild(sheet);
    overlay.classList.add('active'); // verrou de scroll générique : cf syncModalScrollLock (tracker.js)
}

function closeMobileAddPanel() {
    if (!isMobileAddPanelOpen()) return;

    closeCardDateFlatpickr();
    document.getElementById('mobile-add-overlay').classList.remove('active');

    const sheet = document.querySelector('.catalogue-sheet-sticky');
    const desktopSlot = document.querySelector('.catalogue-sheet-col');
    if (sheet && desktopSlot) desktopSlot.appendChild(sheet);
}

// Un seul listener resize, débouncé, installé une fois au chargement du script (pas de duplication
// possible). N'agit que si le viewport franchit réellement le seuil 960px depuis le dernier passage
// (mobileAddPanelWasMobile sert de mémoire) : ne rerend jamais le formulaire, ne rappelle jamais
// selectCard(), s'appuie uniquement sur openMobileAddPanel()/closeMobileAddPanel() déjà défensives.
let mobileAddPanelWasMobile = isMobileAddPanelViewport();
let mobileAddPanelResizeTimer = null;
window.addEventListener('resize', () => {
    clearTimeout(mobileAddPanelResizeTimer);
    mobileAddPanelResizeTimer = setTimeout(() => {
        const isMobileNow = isMobileAddPanelViewport();
        if (isMobileNow === mobileAddPanelWasMobile) return;
        mobileAddPanelWasMobile = isMobileNow;

        if (isMobileNow) {
            if (selectedCard) openMobileAddPanel();
        } else {
            closeMobileAddPanel();
        }
    }, 150);
});

// ===== Exports window (ticket V2 Vite, type="module") =====
// Les déclarations top-level d'un module ES ne s'attachent plus automatiquement à window
// (contrairement à un <script> classique) : réexport explicite pour que les autres scripts
// (chargés en modules indépendants, sans import/export entre eux, scope global inchangé)
// puissent continuer à référencer ces noms tels quels — y compris depuis des onclick="..."
// inline dans du HTML généré. Liste exhaustive des déclarations top-level de ce fichier
// (hors variables déjà passées en window.x = ... directement à leur déclaration, cf audit
// du 2026-08-14 sur l'état mutable partagé entre fichiers).
window.catalogueViewUserSet = catalogueViewUserSet;
window.showSearchResultsSkeleton = showSearchResultsSkeleton;
window.searchRequestId = searchRequestId;
window.searchCards = searchCards;
window.runSuggestedCatalogueSearch = runSuggestedCatalogueSearch;
window.catalogueSearchReadyHtml = catalogueSearchReadyHtml;
window.catalogueSearchNoResultsHtml = catalogueSearchNoResultsHtml;
window.searchByIllustrator = searchByIllustrator;
window.displaySearchResults = displaySearchResults;
window.populateSearchFilters = populateSearchFilters;
window.getCataloguePageSize = getCataloguePageSize;
window.lastFilteredResults = lastFilteredResults;
window.catalogueVisibleCount = catalogueVisibleCount;
window.applySearchFilters = applySearchFilters;
window.loadMoreCatalogueResults = loadMoreCatalogueResults;
window.updateCatalogueLoadMoreButton = updateCatalogueLoadMoreButton;
window.renderSearchResults = renderSearchResults;
window.selectionToken = selectionToken;
window.selectCard = selectCard;
window.applyCardToPreview = applyCardToPreview;
window.replaySelectionEntrance = replaySelectionEntrance;
window.showPreviewUploadPlaceholder = showPreviewUploadPlaceholder;
window.handlePreviewImageUpload = handlePreviewImageUpload;
window.addCard = addCard;
window.toggleAddPanel = toggleAddPanel;
window.isAddPanelDefaultOpen = isAddPanelDefaultOpen;
window.stepAddQuantity = stepAddQuantity;
window.markResultSelected = markResultSelected;
window.onSearchResultClick = onSearchResultClick;
window.activeSort = activeSort;
window.getSearchResultPrice = getSearchResultPrice;
window.sortSearchResults = sortSearchResults;
window.updateCatalogueResultsInfo = updateCatalogueResultsInfo;
window.setSearchSort = setSearchSort;
window.setCatalogueView = setCatalogueView;
window.toggleCatalogueFilterPopover = toggleCatalogueFilterPopover;
window.isMobileAddPanelViewport = isMobileAddPanelViewport;
window.isMobileAddPanelOpen = isMobileAddPanelOpen;
window.closeCardDateFlatpickr = closeCardDateFlatpickr;
window.openMobileAddPanel = openMobileAddPanel;
window.closeMobileAddPanel = closeMobileAddPanel;
window.mobileAddPanelWasMobile = mobileAddPanelWasMobile;
window.mobileAddPanelResizeTimer = mobileAddPanelResizeTimer;
window.resetRelatedCardsBlock = resetRelatedCardsBlock;
window.setRelatedCardsMode = setRelatedCardsMode;
