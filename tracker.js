// ===== CONFIGURATION SUPABASE =====
// ⚠️ Seule la clé "anon public" doit être ici, jamais la clé "service_role" !
const SUPABASE_URL = 'https://mmdcpkwygqsdaqnkimwb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1tZGNwa3d5Z3FzZGFxbmtpbXdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyOTA2MTYsImV4cCI6MjA5OTg2NjYxNn0.mae_gw0VWy0ep8h9FrjJj2XSdjrfeR3mW9_Nx0nIaQ0';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ===== CONFIG API TCGDEX =====
const API_BASE = 'https://api.tcgdex.net/v2/fr';
const API_EN = 'https://api.tcgdex.net/v2/en';

// ===== ETAT GLOBAL =====
// selectedCard, lastSearchResults, customPreviewImage, currentMarketValue, searchRequestId chargés depuis modules/cards.js
// customQuickAddImage, QUICKADD_DEFAULTS_KEY, getQuickAddDefaults, saveQuickAddDefaultsToStorage, openQuickAddSettingsModal,
// toggleQaSettingsPriceField, closeQuickAddSettingsModal, saveQuickAddSettings chargées depuis modules/progression.js

let allCollectionCards = [];   // Cache local de la collection chargée depuis Supabase
// sortColumn, sortDirection, duplicatesOnlyFilter, collectionRarityFilterValues, collectionViewMode chargés depuis modules/collection.js

// ===== UTILITAIRES =====
// Fonctions chargées depuis modules/utils.js : showMessage, resizeImageToBlob, resizeBlobToJpeg,
// sanitizeForPath, getTcgdexImagePath, getSeriesLogoPath, resizeImageToWebpBlob, getSeriesSymbolPath

// Fonctions chargées depuis modules/storage.js : uploadSeriesSymbolManually, uploadSeriesLogoManually,
// checkExistingSeriesLogo, fetchAndUploadSeriesSymbol, fetchAndUploadSeriesLogo, checkExistingImage,
// fetchAndUploadExternalImage, uploadImageToStorage, getStoredImageFilenames, findExistingCardRow

// Fonctions chargées depuis modules/cards.js : showSearchResultsSkeleton, searchCards, displaySearchResults,
// populateSearchFilters, applySearchFilters, renderSearchResults, selectCard, showPreviewUploadPlaceholder,
// handlePreviewImageUpload, addCard

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

// getStoredImageFilenames et findExistingCardRow chargées depuis modules/storage.js

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

// addCard chargée depuis modules/cards.js

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

// updateStats, recordValueSnapshot, renderHeroValueCard chargées depuis modules/stats.js

// sortCollection, updateSortArrows, applySorting, setCollectionRarityFilter, renderCollectionRarityRow,
// populateCollectionFilters, getDuplicateGroupKey, computeDuplicateGroupTotals, toggleDuplicatesFilter
// chargées depuis modules/collection.js

// exportCollectionToCSV, toggleCsvDropdown, closeCsvDropdown, exportFullBackupJson, handleJsonRestore,
// confirmAndProcessJsonRestore, downloadCsvTemplate, findTcgdexMatch, handleCsvImport, processCsvImportRows
// chargées depuis modules/import-export.js

// filterAndDisplay, renderCollectionTable, getGridNoImageHtml, renderCollectionGrid, changeQuantityInModal
// chargées depuis modules/collection.js

// showCardDetail, renderCardPriceChart, showCardEditForm, toggleEditPurchasePriceField, saveCardEdits,
// closeCardDetail, handleModalSeriesSymbolUpload, handleModalSeriesLogoUpload, getCollectionUploadPlaceholder,
// handleCollectionImageUpload chargées depuis modules/card-detail.js
// loadWishlists, toggleWishlistSection, renameWishlist, deleteWishlist, deleteWishlistItem,
// markWishlistItemOwned, renderWishlistsUI, openWishlistPicker, closeWishlistPicker, renderWishlistPicker,
// addCardToSpecificWishlist, createWishlistAndAddCard, createWishlistOnly chargées depuis modules/wishlist.js

// renderStatsCharts, formatMonthLabel, getCurrentMonthKey, loadMonthlySummaryOptions, renderMonthlySummary,
// renderStatsKpis, renderRarityChart, renderSeriesChart, renderSeriesValueChart, renderRoiSection,
// loadValueHistoryData, setValueHistoryRange, renderValueHistoryChart chargées depuis modules/stats-render.js
// Event listeners centralisés dans initEventListeners() en bas de ce fichier

// collectionViewMode, setCollectionView chargées depuis modules/collection.js

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

// loadSeriesProgress, handleProgressionSeriesLogoUpload, openSetProgression, setProgressionRarityFilter,
// populateProgressionRarityFilter, renderProgressionCardsGrid, computeAvailableFinishModes, renderProgressionFinishToggle,
// cardHasFinishVariant, setProgressionFinishMode, setProgressionFilter, backToSeriesProgress, addFromProgression,
// quickInstantAdd, getQuickAddUploadPlaceholderHtml, handleQuickAddImageUpload, showAddCardModal,
// toggleQuickAddPurchasePriceField, submitQuickAdd chargées depuis modules/progression.js

// initDatePicker chargée depuis modules/utils.js

// Rassemble ici tous les écouteurs d'événements globaux : appelée une seule fois à la fin de ce fichier,
// après le chargement de tous les modules, donc l'ordre de chargement des modules n'a plus d'importance.
function initEventListeners() {
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

    document.getElementById('progression-search').addEventListener('input', renderProgressionCardsGrid);
    document.getElementById('month-summary-select').addEventListener('change', renderMonthlySummary);
}

initEventListeners();

