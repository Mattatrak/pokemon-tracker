// Tri/filtre/rendu de l'onglet "Ma Collection" - Pokémon Tracker
// Dépend de: allCollectionCards/changeQuantity/deleteCard (tracker.js), sortRaritiesByTier/getRarityIconHtml/
// renderFinishBadge/buildRarityFilterRowHtml (utils.js), showCardDetail/closeCardDetail/getCollectionUploadPlaceholder (card-detail.js)
// Etat possédé : sortColumn, sortDirection, duplicatesOnlyFilter, collectionRarityFilterValues, collectionViewMode

let sortColumn = 'value';
let duplicatesOnlyFilter = false;
let sortDirection = 'desc';

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

function getFilteredSortedCollection() {
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

    return applySorting(filtered);
}

const COLLECTION_PAGE_SIZE = 60;
let collectionDisplayLimit = COLLECTION_PAGE_SIZE;

// Sélection multiple (édition en masse, vue Tableau)
let selectedCardIds = new Set();

function clearSelection() {
    selectedCardIds.clear();
    updateBulkActionsBar();
    updateSelectAllCheckboxState();
}

function toggleCardSelection(id) {
    if (selectedCardIds.has(id)) {
        selectedCardIds.delete(id);
    } else {
        selectedCardIds.add(id);
    }
    updateSelectAllCheckboxState();
    updateBulkActionsBar();
}

function toggleSelectAllVisible() {
    const selectAllCb = document.getElementById('select-all-checkbox');
    const checkboxes = document.querySelectorAll('#cards-list .row-select-checkbox');
    checkboxes.forEach(cb => {
        const id = Number(cb.dataset.id);
        cb.checked = selectAllCb.checked;
        if (selectAllCb.checked) selectedCardIds.add(id);
        else selectedCardIds.delete(id);
    });
    updateBulkActionsBar();
}

function updateSelectAllCheckboxState() {
    const selectAllCb = document.getElementById('select-all-checkbox');
    if (!selectAllCb) return;
    const checkboxes = [...document.querySelectorAll('#cards-list .row-select-checkbox')];
    const checkedCount = checkboxes.filter(cb => cb.checked).length;
    selectAllCb.checked = checkboxes.length > 0 && checkedCount === checkboxes.length;
    selectAllCb.indeterminate = checkedCount > 0 && checkedCount < checkboxes.length;
}

function updateBulkActionsBar() {
    const bar = document.getElementById('bulk-actions-bar');
    if (!bar) return;
    const count = selectedCardIds.size;
    bar.style.display = count > 0 ? 'flex' : 'none';
    document.getElementById('bulk-selection-count').textContent =
        `${count} carte${count > 1 ? 's' : ''} sélectionnée${count > 1 ? 's' : ''}`;
}

async function bulkUpdateCondition(newCondition) {
    if (!newCondition || selectedCardIds.size === 0) return;
    const ids = [...selectedCardIds];

    const { error } = await supabaseClient.from('cards').update({ condition: newCondition }).in('id', ids);
    if (error) {
        showMessage('Erreur lors de la mise à jour groupée', 'error');
        console.error(error);
        return;
    }

    showMessage(`État mis à jour pour ${ids.length} carte${ids.length > 1 ? 's' : ''}`, 'success');
    clearSelection();
    await refreshCollection();
}

async function bulkDeleteSelected() {
    const ids = [...selectedCardIds];
    if (ids.length === 0) return;
    if (!await showConfirmModal(`Supprimer ${ids.length} carte${ids.length > 1 ? 's' : ''} de la collection ?`, 'Supprimer')) return;

    const { error } = await supabaseClient.from('cards').delete().in('id', ids);
    if (error) {
        showMessage('Erreur lors de la suppression groupée', 'error');
        console.error(error);
        return;
    }

    showMessage(`${ids.length} carte${ids.length > 1 ? 's' : ''} supprimée${ids.length > 1 ? 's' : ''}`, 'success');
    clearSelection();
    await refreshCollection();
    await recordValueSnapshot();
}

function filterAndDisplay() {
    collectionDisplayLimit = COLLECTION_PAGE_SIZE; // toute recherche/filtre/tri repart de la première page
    clearSelection(); // évite d'agir sur une sélection de cartes qu'on ne voit plus
    renderFilteredCollection();
}

function loadMoreCollectionCards() {
    collectionDisplayLimit += COLLECTION_PAGE_SIZE;
    renderFilteredCollection();
}

function getSortLabel() {
    const sortLabels = {
        'name': 'Nom',
        'series': 'Série',
        'number': 'Numéro',
        'condition': 'État',
        'rarity': 'Rareté',
        'quantity': 'Quantité',
        'value': 'Valeur'
    };
    const label = sortLabels[sortColumn] || sortColumn;
    const direction = sortDirection === 'asc' ? 'croissante' : 'décroissante';
    return `${label} ${direction}`;
}

function updateCollectionSummary(filtered, page) {
    const summary = document.getElementById('collection-summary');
    if (!summary) return;

    const displayed = page.length;
    const total = allCollectionCards.length;
    const displayedValue = page.reduce((sum, card) => {
        const cardValue = Number(card.market_value || 0) * Number(card.quantity || 1);
        return sum + cardValue;
    }, 0);
    const sortLabel = getSortLabel();

    const formattedValue = new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: 'EUR',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(displayedValue);

    summary.innerHTML = `
        <span class="summary-segment summary-count">
            <span class="summary-value">${displayed}</span>
            <span class="summary-label">carte${displayed > 1 ? 's' : ''} affichée${displayed > 1 ? 's' : ''}</span>
        </span>
        <span class="summary-separator">•</span>
        <span class="summary-segment">
            <span class="summary-label">sur</span>
            <span class="summary-value">${total}</span>
        </span>
        <span class="summary-separator">•</span>
        <span class="summary-segment">
            <span class="summary-label">Valeur :</span>
            <span class="summary-value">${formattedValue}</span>
        </span>
        <span class="summary-separator">•</span>
        <span class="summary-segment">
            <span class="summary-label">Tri :</span>
            <span class="summary-value">${sortLabel}</span>
        </span>
    `;
}

function renderFilteredCollection() {
    const filtered = getFilteredSortedCollection();
    const page = filtered.slice(0, collectionDisplayLimit);

    updateCollectionSummary(filtered, page);

    // On ne rend que la vue actuellement visible (gain de perf notable sur une grosse collection)
    if (collectionViewMode === 'table') {
        renderCollectionTable(page);
    } else {
        renderCollectionGrid(page);
    }

    const loadMoreRow = document.getElementById('load-more-row');
    const remaining = filtered.length - page.length;
    if (remaining > 0) {
        loadMoreRow.style.display = 'flex';
        document.getElementById('load-more-btn').textContent = `Charger plus (${remaining} restante${remaining > 1 ? 's' : ''})`;
    } else {
        loadMoreRow.style.display = 'none';
    }
}

function renderCollectionTable(filtered) {
    const tbody = document.getElementById('cards-list');

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="10" style="text-align: center; padding: 2rem;">
                    <div class="empty-state">
                        <p><i class="ti ti-search-off" aria-hidden="true"></i> Aucune carte trouvée</p>
                    </div>
                </td>
            </tr>
        `;
        updateSelectAllCheckboxState();
        return;
    }

    tbody.innerHTML = filtered.map(card => {
        const qty = Number(card.quantity || 1);
        const lineTotal = Number(card.market_value || 0) * qty;
        const acquisitionIcon = card.acquisition_type === 'pack' ? '<i class="ti ti-gift" aria-hidden="true"></i>' : '<i class="ti ti-shopping-bag" aria-hidden="true"></i>';
        const acquisitionTitle = card.acquisition_type === 'pack' ? 'Sortie d\'un booster' : 'Achetée';
        return `
        <tr>
            <td class="select-col"><input type="checkbox" class="row-select-checkbox" data-id="${card.id}" ${selectedCardIds.has(card.id) ? 'checked' : ''} onchange="toggleCardSelection(${card.id})"></td>
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

    updateSelectAllCheckboxState();
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
