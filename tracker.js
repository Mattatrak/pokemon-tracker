// ===== CONFIGURATION SUPABASE =====
// ⚠️ Seule la clé "anon public" doit être ici, jamais la clé "service_role" !
const SUPABASE_URL = 'https://mmdcpkwygqsdaqnkimwb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1tZGNwa3d5Z3FzZGFxbmtpbXdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyOTA2MTYsImV4cCI6MjA5OTg2NjYxNn0.mae_gw0VWy0ep8h9FrjJj2XSdjrfeR3mW9_Nx0nIaQ0';

// "Se souvenir de moi" : route la session vers localStorage (persiste) ou sessionStorage (perdue à la
// fermeture du navigateur) selon ce flag, écrit par modules/auth-login.js avant la connexion. Flag absent =
// traité comme localStorage, pour rester compatible avec les sessions déjà persistées avant cette fonctionnalité.
const REMEMBER_ME_KEY = 'poketracker-remember-me';
const rememberAwareStorage = {
    getItem: (key) => (localStorage.getItem(REMEMBER_ME_KEY) === 'false' ? sessionStorage : localStorage).getItem(key),
    setItem: (key, value) => (localStorage.getItem(REMEMBER_ME_KEY) === 'false' ? sessionStorage : localStorage).setItem(key, value),
    removeItem: (key) => { localStorage.removeItem(key); sessionStorage.removeItem(key); }
};

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { storage: rememberAwareStorage }
});

// ===== CONFIG API TCGDEX =====
const API_BASE = 'https://api.tcgdex.net/v2/fr';
const API_EN = 'https://api.tcgdex.net/v2/en';

// ===== ETAT GLOBAL =====
// selectedCard, lastSearchResults, customPreviewImage, currentMarketValue, searchRequestId chargés depuis modules/cards.js
// customQuickAddImage, QUICKADD_DEFAULTS_KEY, getQuickAddDefaults, saveQuickAddDefaultsToStorage, openQuickAddSettingsModal,
// toggleQaSettingsPriceField, closeQuickAddSettingsModal, saveQuickAddSettings chargées depuis modules/progression.js

// window.x plutôt que let (ticket V2 Vite, type="module") : ces variables sont lues et/ou écrites
// depuis de nombreux autres fichiers (collection.js, dashboard.js, stats.js, stats-render.js,
// progression.js, wishlist.js, cards.js, card-detail.js, import-export.js, auth.js...). Une déclaration
// locale isolerait tracker.js de leurs écritures/lectures — cf audit du 2026-08-14. Toute ligne de ce
// fichier qui fait ensuite "nom = valeur"/"nom++" continue de cibler ces mêmes propriétés window.
window.allCollectionCards = [];   // Cache local de la collection chargée depuis Supabase

// ===== DASHBOARD (obsolescence) =====
// renderDashboard chargée depuis modules/dashboard.js. Marqué obsolète par refreshCollection()
// (ajout/suppression/quantité/prix) et loadWishlists() (souhaits) : pas de recalcul inutile ailleurs.
window.dashboardNeedsRefresh = true;

// Passe à true à la toute fin de init() (auth.js). Tant que c'est false, markDashboardDirty() ne
// déclenche aucun rendu immédiat : pendant le chargement initial, refreshCollection()/loadWishlists()/
// le chargement des séries appellent chacun markDashboardDirty(), et tab-dashboard est actif par
// défaut dans le HTML — sans ce garde-fou, le hero se re-rendait 2-3 fois pendant init() avec des
// données encore incomplètes (favoris pas chargés, etc.), d'où un flash visible du mauvais thème/carte
// avant l'affichage final correct.
window.appReady = false;

function markDashboardDirty() {
    dashboardNeedsRefresh = true;
    if (appReady && document.getElementById('tab-dashboard')?.classList.contains('active')) {
        renderDashboard();
    }
}
// sortColumn, sortDirection, collectionFilters, collectionViewMode chargés depuis modules/collection.js

// ===== STATISTIQUES (dirty flag) =====
// Marqué obsolète uniquement par de vraies écritures (refreshCollection() ; ajout/suppression d'un
// souhait dans modules/wishlist.js ; premier remplissage réel d'allTcgdexSeries dans
// modules/progression.js) — jamais par une simple relecture/revisite d'un autre onglet.
window.statsNeedsRefresh = true;
// Incrémenté à chaque markStatsDirty(). Permet à renderStatsCharts() (modules/stats-render.js) de
// détecter qu'une mutation a eu lieu PENDANT son propre rendu, et de rester dirty dans ce cas plutôt
// que de se marquer propre avec des données déjà périmées à l'instant où il finit.
window.statsRenderVersion = 0;
// Verrou anti-réentrance : statsNeedsRefresh reste vrai pendant toute la durée d'un rendu en cours,
// donc lui seul ne suffit pas à empêcher un second appel concurrent de démarrer un second rendu.
window.statsRenderInProgress = false;

function markStatsDirty() {
    statsNeedsRefresh = true;
    statsRenderVersion++;
}

// ===== UTILITAIRES =====
// Fonctions chargées depuis modules/utils.js : showMessage, resizeImageToBlob, resizeBlobToJpeg,
// sanitizeForPath, getTcgdexImagePath, getSeriesLogoPath, resizeImageToWebpBlob, getSeriesSymbolPath

// Fonctions chargées depuis modules/storage.js : uploadSeriesSymbolManually, uploadSeriesLogoManually,
// fetchAndUploadSeriesSymbol, fetchAndUploadSeriesLogo, checkExistingImage,
// fetchAndUploadExternalImage, uploadImageToStorage, getStoredImageFilenames, findExistingCardRow

// Fonctions chargées depuis modules/cards.js : showSearchResultsSkeleton, searchCards, displaySearchResults,
// populateSearchFilters, applySearchFilters, renderSearchResults, selectCard, showPreviewUploadPlaceholder,
// handlePreviewImageUpload, addCard

// ===== COLLECTION (Supabase Database) =====

// PostgREST plafonne toute réponse à 1000 lignes par défaut (db_max_rows) : une collection plus
// grande était donc silencieusement tronquée par le select('*') unique d'avant. Pagination par lots
// de 1000 via .range(), agrégés localement, tant qu'un lot revient plein (= il peut en rester après).
// order('id') en second critère : nécessaire pour un curseur stable quand plusieurs cartes partagent
// exactement le même created_at (tri sur created_at seul serait alors ambigu entre deux lots).
const COLLECTION_FETCH_PAGE_SIZE = 1000;

async function refreshCollection() {
    const fetchedCards = [];
    let from = 0;

    while (true) {
        const { data, error } = await supabaseClient
            .from('cards')
            .select('*')
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .range(from, from + COLLECTION_FETCH_PAGE_SIZE - 1);

        if (error) {
            // Un lot intermédiaire échoue : on garde l'ancien allCollectionCards plutôt que de publier
            // une collection partielle (mieux vaut des données obsolètes qu'une collection tronquée).
            showMessage('Erreur lors du chargement de la collection', 'error');
            console.error(error);
            return;
        }

        fetchedCards.push(...data);

        if (data.length < COLLECTION_FETCH_PAGE_SIZE) break;
        from += COLLECTION_FETCH_PAGE_SIZE;
    }

    allCollectionCards = fetchedCards;
    await fillMissingSeriesLogos();
    updateStats();
    pruneStaleCollectionFilters();
    filterAndDisplay();
    markDashboardDirty();
    markStatsDirty();
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

// Termine l'hébergement Supabase de l'image en tâche de fond (sans bloquer l'ajout) et met à jour la ligne une fois prête
function hostImageInBackground(tcgdexUrl, tcgdexId, rowId) {
    fetchAndUploadExternalImage(tcgdexUrl, tcgdexId)
        .then(url => supabaseClient.from('cards').update({ image: url }).eq('id', rowId))
        .then(({ error }) => { if (error) console.error('Erreur mise à jour image (arrière-plan):', error); })
        .catch(error => console.error('Echec hébergement image (arrière-plan):', error));
}

// Idem pour le logo/symbole de série (une fois par set, réutilisé ensuite via le cache Supabase)
function hostSeriesAssetsInBackground(card, rowId, hasLogo, hasSymbol) {
    if (!hasLogo && card.set?.logo && card.set?.id) {
        fetchAndUploadSeriesLogo(card.set.logo, card.set.id)
            .then(url => supabaseClient.from('cards').update({ series_logo: url }).eq('id', rowId))
            .then(({ error }) => { if (error) console.error('Erreur mise à jour logo (arrière-plan):', error); })
            .catch(error => console.error('Logo de série non récupéré (arrière-plan):', error));
    }
    if (!hasSymbol && card.set?.symbol && card.set?.id) {
        fetchAndUploadSeriesSymbol(card.set.symbol, card.set.id)
            .then(url => supabaseClient.from('cards').update({ series_symbol: url }).eq('id', rowId))
            .then(({ error }) => { if (error) console.error('Erreur mise à jour symbole (arrière-plan):', error); })
            .catch(error => console.error('Symbole de set non récupéré (arrière-plan):', error));
    }
}

async function performCardAdd(card, { condition, quantity, acquisitionType, purchasePrice, customImage, customDate, finish = 'normal' }) {
    const name = card.name || '?';
    const series = card.set?.name || 'N/A';
    const number = card.localId || '?';

    // Image : si déjà hébergée sur Supabase (dédup rapide) on l'utilise tout de suite, sinon on part
    // sur le lien TCGdex brut pour ne pas bloquer l'ajout, et l'upload se termine en tâche de fond.
    let imageUrl = customImage || '';
    let tcgdexFallbackUrl = '';
    let imageNeedsBackgroundUpload = false;
    if (!imageUrl && card.image) {
        tcgdexFallbackUrl = `${card.image}/high.webp`;
        const existingUrl = card.id ? await checkExistingImage(card.id) : null;
        if (existingUrl) {
            imageUrl = existingUrl;
        } else {
            imageUrl = tcgdexFallbackUrl;
            imageNeedsBackgroundUpload = true;
        }
    }

    const existingRow = await findExistingCardRow(card.id, name, series, number, condition, finish);

    const marketValue = getMarketValueForFinish(card, finish);

    // Date d'acquisition : utilise la date fournie (antidatage) ou aujourd'hui par défaut
    const acquisitionDate = customDate ? new Date(customDate + 'T12:00:00') : new Date();
    const dateAddedStr = acquisitionDate.toLocaleDateString('fr-FR');

    if (existingRow) {
        const newQuantity = Number(existingRow.quantity || 1) + quantity;
        const updatePayload = { quantity: newQuantity, market_value: marketValue };
        if (!existingRow.image && imageUrl) updatePayload.image = imageUrl;
        if (!existingRow.cardmarket_id && card.pricing?.cardmarket?.idProduct) {
            updatePayload.cardmarket_id = card.pricing.cardmarket.idProduct;
        }

        // La mise à jour de la carte et l'historique mensuel sont indépendants : en parallèle
        const [updateResult] = await Promise.all([
            supabaseClient.from('cards').update(updatePayload).eq('id', existingRow.id),
            recordMonthlyStats({ quantity, purchasePrice, marketValue, cardName: name, date: acquisitionDate })
        ]);
        if (updateResult.error) throw updateResult.error;

        if (imageNeedsBackgroundUpload) hostImageInBackground(tcgdexFallbackUrl, card.id, existingRow.id);
        hostSeriesAssetsInBackground(card, existingRow.id, !!existingRow.series_logo, !!existingRow.series_symbol);

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
            tcgdex_id: card.id || null,
            cardmarket_id: card.pricing?.cardmarket?.idProduct || null,
            date_added: dateAddedStr,
            created_at: acquisitionDate.toISOString(),
            finish,
            illustrator: card.illustrator || null
        }]).select().single(),
        recordMonthlyStats({ quantity, purchasePrice, marketValue, cardName: name, date: acquisitionDate })
    ]);
    if (insertResult.error) throw insertResult.error;

    const newRowId = insertResult.data.id;
    if (imageNeedsBackgroundUpload) hostImageInBackground(tcgdexFallbackUrl, card.id, newRowId);
    hostSeriesAssetsInBackground(card, newRowId, false, false);

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

    const card = allCollectionCards.find(c => c.id === id);

    const { error } = await supabaseClient.from('cards').delete().eq('id', id);

    if (error) {
        showMessage('Erreur lors de la suppression', 'error');
        console.error(error);
        return;
    }

    // Réconcilier l'historique mensuel : une carte supprimée ne doit plus compter dans
    // "cartes ajoutées"/"valeur ajoutée" du mois où elle avait été enregistrée (même logique
    // que la réconciliation lors d'une édition, cf. modules/card-detail.js).
    if (card && card.created_at) {
        const addedDate = new Date(card.created_at);
        const monthKey = `${addedDate.getFullYear()}-${String(addedDate.getMonth() + 1).padStart(2, '0')}`;
        const qty = Number(card.quantity || 1);
        await adjustMonthlyStatsAmount(monthKey, -qty, -(Number(card.purchase_price || 0) * qty), -(Number(card.market_value || 0) * qty));
    }

    await refreshCollection();
    await recordValueSnapshot();

    // Si la grille de Progression est ouverte derrière la fenêtre, la rafraîchir aussi
    const progressionSetView = document.getElementById('progression-set-view');
    if (progressionSetView && progressionSetView.style.display === 'block') {
        renderProgressionCardsGrid();
    }
}

// Verrou par carte (pas global) : changeQuantity() lit card.quantity depuis le cache local, donc deux
// clics rapides sur +/- de la MEME carte avant la fin du premier aller-retour réseau partent tous les
// deux de la même valeur de départ et un incrément est perdu silencieusement. Les autres cartes restent
// utilisables pendant ce temps (verrou par id, pas un verrou Collection global).
const quantityChangeInProgress = new Set();

async function changeQuantity(id, delta, btn) {
    if (quantityChangeInProgress.has(id)) return; // mutation déjà en cours sur cette carte : ignorer
    quantityChangeInProgress.add(id);

    // Désactivation visuelle des deux boutons +/- de cette carte : purement cosmétique en cas de succès
    // (refreshCollection() remplace la ligne juste après), utile surtout si l'appel échoue et que la
    // ligne n'est donc pas re-rendue.
    const stepperButtons = btn ? btn.closest('.qty-stepper')?.querySelectorAll('button') : null;
    if (stepperButtons) stepperButtons.forEach(b => b.disabled = true);

    try {
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

            // Réconcilier l'historique mensuel (même logique que deleteCard)
            if (card.created_at) {
                const addedDate = new Date(card.created_at);
                const monthKey = `${addedDate.getFullYear()}-${String(addedDate.getMonth() + 1).padStart(2, '0')}`;
                const qty = Number(card.quantity || 1);
                await adjustMonthlyStatsAmount(monthKey, -qty, -(Number(card.purchase_price || 0) * qty), -(Number(card.market_value || 0) * qty));
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
    } finally {
        quantityChangeInProgress.delete(id);
        if (stepperButtons) stepperButtons.forEach(b => b.disabled = false);
    }
}

// updateStats, recordValueSnapshot, renderHeroValueCard chargées depuis modules/stats.js

// sortCollection, updateSortArrows, applySorting, pruneStaleCollectionFilters, getDuplicateGroupKey,
// computeDuplicateGroupTotals chargées depuis modules/collection.js

// exportCollectionToCSV, toggleCsvDropdown, closeCsvDropdown, exportFullBackupJson, handleJsonRestore,
// confirmAndProcessJsonRestore, downloadCsvTemplate, findTcgdexMatch, handleCsvImport, processCsvImportRows
// chargées depuis modules/import-export.js

// filterAndDisplay, renderCollectionTable, renderCollectionGrid
// chargées depuis modules/collection.js

// getGridNoImageHtml, renderGridCardHtml
// chargées depuis modules/card-grid-renderer.js

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

// ===== NAVIGATION =====
// generateDesktopNavigation/updateDesktopNavigation chargées depuis components/navigation/DesktopNavbar.js
// generateMobileBottomNav/updateMobileBottomNav chargées depuis components/navigation/MobileBottomNavigation.js

// Table de correspondance tabId -> classe de page.
const TAB_PAGE_MAP = {
    'tab-dashboard': 'page-dashboard',
    'tab-add': 'page-add',
    'tab-collection': 'page-collection',
    'tab-progression': 'page-progression',
    'tab-stats': 'page-statistics',
    'tab-wishlist': 'page-wishlist',
    'tab-user-profile': 'page-user-profile',
    'tab-collectors': 'page-collectors',
    'tab-admin': 'page-admin',
    'tab-changelog': 'page-changelog'
};

// Table de correspondance tabId -> route de hash. Volontairement DIFFERENTE des tabId : tab-dashboard etc.
// sont déjà des id réels d'éléments du DOM (<div id="tab-dashboard">...). Si le hash de l'URL correspondait
// à un id existant, le navigateur le traiterait comme une ancre HTML native et déclencherait un scroll
// natif vers cet élément (au clic, au retour arrière, ou au chargement direct) — d'où des routes dédiées,
// préfixées par "/", qui ne matchent aucun id du DOM.
const TAB_ROUTES = {
    'tab-dashboard': '/dashboard',
    'tab-add': '/add',
    'tab-collection': '/collection',
    'tab-progression': '/progression',
    'tab-stats': '/statistics',
    'tab-wishlist': '/wishlist',
    'tab-collectors': '/collectors',
    'tab-admin': '/admin',
    'tab-changelog': '/changelog'
};

// Mapping inverse route -> tabId, dérivé de TAB_ROUTES pour éviter de dupliquer la liste à la main.
const ROUTE_TO_TAB = Object.fromEntries(
    Object.entries(TAB_ROUTES).map(([tabId, route]) => [route, tabId])
);

// Affiche l'onglet demandé (DOM + nav), et son rendu métier (activateTabContent) sauf si activateContent
// est explicitement à false. Ne touche jamais au hash de l'URL : c'est le hashchange (ou l'appel direct au
// chargement/après appReady) qui invoque cette fonction, jamais l'inverse — le hash est la seule source de
// vérité, il n'y a qu'un seul chemin de rendu possible.
// activateContent=false sert au tout premier affichage (avant que les données Supabase soient chargées) :
// la bonne section est visible immédiatement, mais son rendu métier (renderDashboard/loadWishlists/...)
// n'a lieu qu'une seule fois, après appReady = true (voir modules/auth.js), pour ne pas tourner sur des
// données encore vides puis une seconde fois pour rien une fois les données prêtes.
function renderTab(tabId, { activateContent = true } = {}) {
    const targetTab = document.getElementById(tabId);
    if (!targetTab) return; // tabId inconnu ou DOM pas prêt : on ignore plutôt que planter sur classList

    document.body.className = TAB_PAGE_MAP[tabId] || '';
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    targetTab.classList.add('active');

    updateDesktopNavigation(tabId);
    updateMobileBottomNav(tabId);
    if (activateContent) activateTabContent(tabId);
}

// Lit la route dans le hash de l'URL (ex: "#/collection" -> "/collection"), la valide dans ROUTE_TO_TAB
// et retourne le tabId correspondant, avec repli sur tab-dashboard si absent, vide, ou route inconnue.
// Cas particulier #/user/<username> (Phase 3, modules/public-profile.js) : route paramétrée, donc absente
// de ROUTE_TO_TAB par construction (table figée tabId<->route fixe) — interceptée avant ce lookup plutôt
// que d'étendre TAB_ROUTES/ROUTE_TO_TAB/navigateToTab, qui ne gèrent que des routes fixes 1:1 avec un tabId.
function getTabIdFromHash() {
    const route = window.location.hash.replace('#', '');
    if (route.startsWith('/user/')) return 'tab-user-profile';
    return Object.prototype.hasOwnProperty.call(ROUTE_TO_TAB, route) ? ROUTE_TO_TAB[route] : 'tab-dashboard';
}

// Point d'entrée pour toute navigation programmatique (widgets internes type dashboard/wishlist/stats qui
// redirigent vers un autre onglet). Normalise d'abord le tabId (repli sur tab-dashboard si inconnu), puis
// convertit ce validTabId en route et écrit le hash ; c'est le listener hashchange qui rend. Si le hash
// cible est déjà l'actuel (re-clic sur l'onglet actif), hashchange ne se déclenche pas : on rend directement
// avec ce même validTabId.
function navigateToTab(tabId) {
    const validTabId = Object.prototype.hasOwnProperty.call(TAB_ROUTES, tabId) ? tabId : 'tab-dashboard';
    const targetHash = '#' + TAB_ROUTES[validTabId];
    if (window.location.hash === targetHash) {
        renderTab(validTabId);
    } else {
        window.location.hash = targetHash;
    }
}

// VT2 (cf roadmap technique animations premium) : petit indicateur actif (.nav-active-dot, desktop
// ET mobile) qui glisse physiquement vers le nouvel onglet au lieu de disparaître/réapparaître.
// offsetParent !== null : seule visibilité réelle qui compte (desktop/mobile ne sont jamais visibles
// tous les deux à la fois, cf navigation.css, mais on vérifie plutôt que de supposer) - pas de
// media query JS dupliquée, la vérité vient du rendu réel.
function findVisibleNavActiveDot() {
    const dots = document.querySelectorAll('.nav-active-dot');
    for (const dot of dots) {
        if (dot.offsetParent !== null) return dot;
    }
    return null;
}

// Identité du bouton de nav qui porte un indicateur : href du lien pour un item standard, id pour le
// déclencheur "Plus" mobile (bouton, pas un lien). Sert uniquement à détecter si l'ancien et le
// nouvel indicateur actif désignent en réalité le MÊME bouton physique (ex: passer de Progression à
// Statistiques sur mobile allume "Plus" dans les deux cas, cf MOBILE_NAV_MORE_ACTIVE_TABS) - dans ce
// cas, pas de morph sur soi-même.
function getNavItemKey(dotEl) {
    const item = dotEl.closest('a, button');
    return item ? (item.getAttribute('href') || item.id || null) : null;
}

// Enveloppe doRenderTab dans une View Transition de type 'navigation' pour faire morpher
// nav-active-dot uniquement - jamais de cross-fade de page/hero (neutralisé en CSS, navigation.css).
// runViewTransition (modules/view-transitions.js) gère support/reduced-motion/concurrence ; ce qui
// suit ne s'occupe que du nommage du seul élément à animer (jamais deux à la fois dans un même
// snapshot, cf leçon VT1 sur l'unicité de view-transition-name).
function runNavIndicatorTransition(doRenderTab) {
    const oldDot = findVisibleNavActiveDot();
    if (!oldDot) {
        // Pas d'indicateur actif visible actuellement (route secondaire sans entrée dédiée sur
        // desktop, ex. admin/changelog/profil public) : rien à morpher, changement normal.
        doRenderTab();
        return;
    }
    const oldKey = getNavItemKey(oldDot);
    oldDot.style.viewTransitionName = 'nav-active-indicator';

    let newDot = null;

    const cleanup = () => {
        oldDot.style.viewTransitionName = '';
        if (newDot) newDot.style.viewTransitionName = '';
    };

    const transition = runViewTransition('navigation', () => {
        // La grille de nav reste rendue à l'écran pendant le rebuild (jamais masquée) : sans ce
        // retrait, sourceDot et le nouvel indicateur porteraient le même nom en même temps dans le
        // snapshot "new" (même piège que le morph carte en VT1).
        oldDot.style.viewTransitionName = '';
        doRenderTab();

        newDot = findVisibleNavActiveDot();
        if (newDot && getNavItemKey(newDot) !== oldKey) {
            newDot.style.viewTransitionName = 'nav-active-indicator';
        } else {
            // Même bouton physique déjà actif avant/après (ex. Plus sur mobile), ou aucun nouvel
            // indicateur visible (route secondaire) : aucun morph artificiel sur soi-même - on saute
            // la transition en cours plutôt que de jouer une animation sans rien à montrer.
            newDot = null;
            if (document.activeViewTransition) document.activeViewTransition.skipTransition();
        }
    });

    if (!transition) {
        // reduced-motion / API indisponible : doRenderTab() a déjà tourné en synchrone ci-dessus,
        // rien d'autre à faire que nettoyer les noms posés avant de le savoir.
        cleanup();
        return;
    }

    transition.finished.finally(cleanup);
}

// VT4 (cf roadmap technique animations premium) : variante de runNavIndicatorTransition pour la
// navigation Collecteur -> profil public, avec l'avatar comme unique shared element - jamais
// l'indicateur de nav en plus (une seule View Transition par changement de route, cf audit VT4 : si
// pendingCtx existe, ce type remplace entièrement 'navigation' pour cette navigation précise, il ne
// s'ajoute pas à elle). doRenderTab() (renderTab, y compris son appel à updateDesktopNavigation/
// updateMobileBottomNav) reste appelé normalement à l'intérieur : la navbar se met bien à jour, elle
// ne bénéficie juste pas ici de son propre morph d'indicateur.
function runProfileOpenTransition(pendingCtx, doRenderTab) {
    const sourceRow = document.querySelector(`#collectors-search-results [data-collector-id="${pendingCtx.profile.id}"]`);
    const sourceAvatar = sourceRow ? sourceRow.querySelector('img.profile-avatar') : null;

    if (!sourceAvatar || sourceAvatar.offsetParent === null) {
        // Pas d'avatar réel visible (fallback initiales, ou ligne scrollée hors DOM/masquée entre le
        // clic et ce hashchange) : navigation normale, sans transition - le shell (identité déjà
        // connue) reste rendu par loadPublicProfile() indépendamment de cette animation.
        doRenderTab();
        return;
    }

    sourceAvatar.style.viewTransitionName = 'collector-profile-avatar';

    let newAvatar = null;
    const cleanup = () => {
        sourceAvatar.style.viewTransitionName = '';
        if (newAvatar) newAvatar.style.viewTransitionName = '';
    };

    const transition = runViewTransition('profile-open', () => {
        // Même règle d'unicité que VT1/VT2 : retirer le nom de la source avant de l'assigner à la
        // cible, jamais les deux en même temps dans le snapshot "new".
        sourceAvatar.style.viewTransitionName = '';
        doRenderTab();

        // Le shell (loadPublicProfile, modules/public-profile.js) rend son avatar de façon strictement
        // synchrone avant son premier await lorsque ce même pendingCtx existe encore à ce moment - il
        // est donc déjà dans le DOM ici, juste après doRenderTab().
        newAvatar = document.querySelector('#user-profile-content img.user-profile-avatar');
        if (newAvatar) {
            newAvatar.style.viewTransitionName = 'collector-profile-avatar';
        } else if (document.activeViewTransition) {
            document.activeViewTransition.skipTransition();
        }
    });

    if (!transition) {
        cleanup();
        return;
    }

    transition.finished.finally(cleanup);
}

// Seule source de rendu déclenchée par un changement d'URL : clic sur un vrai lien de nav (<a href="#/xxx">),
// bouton précédent/suivant du navigateur, ou modification manuelle de l'URL. Peut se déclencher avant que
// les données soient chargées (ex: clic pendant le chargement initial) : activateContent est conditionné à
// appReady pour ne jamais lancer activateTabContent sur des données pas encore prêtes — seul le changement
// visuel d'onglet a lieu dans ce cas, le rendu métier réel étant de toute façon rejoué après appReady = true
// (voir l'appel dans modules/auth.js). Le tout premier rendu (tracker.js, avant ce listener) et le rendu
// post-appReady (modules/auth.js) appellent renderTab() directement, jamais via ce listener : aucune
// transition 'navigation' n'a donc jamais lieu au chargement initial (pas de position OLD pertinente, cf
// roadmap animations premium VT2).
window.addEventListener('hashchange', () => {
    // Hook minimal Vue Classeur (B3, cf roadmap technique) : le DOM de tab-collection n'est jamais
    // démonté (renderTab bascule juste .active, cf renderTab ci-dessus), donc le listener clavier du
    // classeur resterait actif en arrière-plan si on ne le détache pas explicitement en quittant
    // l'onglet. Vérifié avant renderTab (qui bascule .active vers la nouvelle cible).
    const targetTabId = getTabIdFromHash();
    if (collectionViewMode === 'binder' && targetTabId !== 'tab-collection' &&
        document.getElementById('tab-collection')?.classList.contains('active')) {
        teardownBinderLifecycle();
    }

    closeWishlistItemDetail();
    closeMobileMorePanel();
    closeMobileAddPanel();

    const doRenderTab = () => renderTab(targetTabId, { activateContent: appReady === true });

    // VT4 : priorité à 'profile-open' (avatar partagé) si un clic Collecteur a préparé cette
    // navigation exacte - jamais les deux transitions ('navigation' puis 'profile-open') pour un même
    // changement de route. Simple lecture (peek), ne consomme rien : seul loadPublicProfile()
    // (modules/public-profile.js) consomme réellement pendingCollectorProfileContext.
    const pendingProfileCtx = typeof getPendingCollectorProfileContext === 'function'
        ? getPendingCollectorProfileContext(window.location.hash)
        : null;

    if (pendingProfileCtx) {
        runProfileOpenTransition(pendingProfileCtx, doRenderTab);
    } else {
        runNavIndicatorTransition(doRenderTab);
    }

    // Symétrique : si on revient sur Collection alors que le classeur était le mode actif (jamais
    // réinitialisé, juste son listener détaché ci-dessus au moment de quitter), on réattache — sinon
    // les flèches resteraient silencieusement inactives après un aller-retour d'onglet. setupBinderLifecycle
    // est idempotent (cf binder-view.js), aucun risque de double-attache.
    if (targetTabId === 'tab-collection' && collectionViewMode === 'binder') {
        setupBinderLifecycle();
    }
});

// ===== ONGLETS =====

// Rendu paresseux propre à un onglet, extrait de switchTab pour être réutilisable sans évènement de
// clic (ex: boutons de navigation internes au Dashboard)
function activateTabContent(tabId) {
    if (tabId === 'tab-dashboard') {
        renderDashboard();
    }

    // Chart.js a besoin que le canvas soit visible pour bien se dimensionner : on redessine à l'ouverture
    if (tabId === 'tab-stats') {
        renderStatsCharts();
    }

    if (tabId === 'tab-progression') {
        if (currentProgressionSetId && document.getElementById('progression-set-view').style.display === 'block') {
            renderProgressionCardsGrid();
            loadFollowedSets();
        } else {
            loadSeriesProgress().then(loadFollowedSets);
        }
    }

    if (tabId === 'tab-wishlist') {
        loadWishlists();
    }

    if (tabId === 'tab-user-profile') {
        loadPublicProfile(getUsernameFromHash());
    }

    if (tabId === 'tab-collectors') {
        resetCollectorsSearchView();
    }

    if (tabId === 'tab-admin') {
        renderAdminGate();
    }

    if (tabId === 'tab-changelog') {
        renderChangelogPage();
    }
}

// ===== INITIALISATION =====
// ===== RAFRAICHISSEMENT DES PRIX MARCHE =====

// Verrou de réentrance : refreshAllMarketPrices() est déclenchable à la fois automatiquement au
// login (modules/auth.js, non attendue) et manuellement depuis le todo du Dashboard (modules/
// dashboard.js). Sans ce verrou, deux exécutions concurrentes dupliquent card_price_history et
// s'écrasent mutuellement sur localStorage (lastPriceMovers/lastPriceRefresh).
let marketPriceRefreshInProgress = false;

async function refreshAllMarketPrices() {
    if (marketPriceRefreshInProgress) {
        showMessage('Rafraîchissement des prix déjà en cours...', 'success');
        return;
    }
    marketPriceRefreshInProgress = true;

    try {
        await refreshAllMarketPricesInternal();
    } finally {
        marketPriceRefreshInProgress = false;
    }
}

async function refreshAllMarketPricesInternal() {
    const cardsWithId = allCollectionCards.filter(c => c.tcgdex_id);
    if (cardsWithId.length === 0) {
        showMessage('Aucune carte avec un identifiant TCGdex à rafraîchir', 'error');
        return;
    }

    const uniqueIds = [...new Set(cardsWithId.map(c => c.tcgdex_id))];
    const priceMap = {};
    const pricingDetailMap = {};
    const setInfoMap = {};

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

    localStorage.setItem('lastPriceRefresh', new Date().toISOString());

    const failCount = uniqueIds.length - Object.keys(priceMap).length;
    if (failCount > 0) {
        showMessage(`Prix du marché mis à jour (${failCount} carte${failCount > 1 ? 's' : ''} en échec, voir la console)`, 'error');
    } else {
        showMessage('Prix du marché mis à jour !', 'success');
    }
    await refreshCollection();
    await recordValueSnapshot();
    renderPriceMovers();
    purgeOldPriceHistory(); // non bloquant : ne retarde pas le retour à l'utilisateur
}

// Les stats/graphiques n'utilisent jamais plus de 30 jours d'historique : on garde une marge de 35j
// et on purge le reste à chaque rafraîchissement, pour éviter que card_price_history/value_history
// grossissent indéfiniment.
// Phase 3 : une purge serveur fiable existe désormais (Edge Function purge-price-history + pg_cron
// quotidien, cf supabase/functions/purge-price-history et sql/migrations/2026-08-14_schedule_price_history_purge.sql).
// Cet appel client reste un filet de sécurité tant que le cron n'est pas confirmé actif en prod —
// à retirer une fois vérifié (sinon purge redondante, sans risque mais inutile).
async function purgeOldPriceHistory() {
    const cutoff = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();

    const { error: cardHistError } = await supabaseClient.from('card_price_history').delete().lt('recorded_at', cutoff);
    if (cardHistError) console.error('Erreur purge card_price_history:', cardHistError);

    const { error: valueHistError } = await supabaseClient.from('value_history').delete().lt('recorded_at', cutoff);
    if (valueHistError) console.error('Erreur purge value_history:', valueHistError);
}

function renderPriceMovers() {
    const container = document.getElementById('price-movers-section');
    if (!container) return;

    const stored = localStorage.getItem('lastPriceMovers');
    if (!stored) {
        container.innerHTML = `
            <div class="stx-movers-empty">
                <i class="ti ti-refresh" aria-hidden="true"></i>
                <div class="stx-movers-empty-title">Aucun rafraîchissement récent</div>
                <p class="stx-movers-empty-sub">Clique sur « Rafraîchir les prix du marché » pour voir les variations.</p>
            </div>
        `;
        return;
    }

    const movers = JSON.parse(stored);
    const gainers = movers.filter(m => m.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 5);
    const losers = movers.filter(m => m.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 5);

    const renderList = (list, positive) => {
        if (list.length === 0) return '<p class="stx-movers-column-empty">Aucune variation</p>';
        return list.map(m => {
            // Résolution de la carte possédée par nom+numéro (même clé que la déduplication ci-dessus)
            // pour ouvrir sa fiche au clic, comme dans Collection.
            const owned = allCollectionCards.find(c => c.name === m.name && String(c.number) === String(m.number));
            const clickAttr = owned ? ` onclick="showCardDetail(${owned.id})"` : '';
            const clickClass = owned ? ' stx-clickable-card' : '';
            return `
            <div class="mover-row${clickClass}"${clickAttr}>
                <span class="mover-name">${m.name} <span class="mover-number">#${m.number}</span></span>
                <span class="mover-delta ${positive ? 'positive' : 'negative'}">${positive ? '+' : ''}${m.delta.toFixed(2)}€</span>
            </div>
        `;
        }).join('');
    };

    if (movers.length === 0) {
        container.innerHTML = `
            <div class="stx-movers-empty">
                <i class="ti ti-chart-bar" aria-hidden="true"></i>
                <div class="stx-movers-empty-title">Aucune variation</div>
                <p class="stx-movers-empty-sub">Aucune variation détectée lors du dernier rafraîchissement.</p>
            </div>
        `;
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
        // VT5 (cf roadmap technique animations premium) : filterAndDisplayReorder() plutôt que
        // filterAndDisplay() - une seule réorganisation après le debounce existant (inchangé, 150ms),
        // jamais une par frappe.
        collectionSearchDebounceTimer = setTimeout(filterAndDisplayReorder, 150);
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeCardDetail();
            closeWishlistItemDetail();
            closeMobileMorePanel();
            closeCollectionFilterPicker();

            // Priorité de couche : le picker Wishlist peut s'ouvrir par-dessus la modale Ajouter. Un appui
            // ne doit fermer que la couche du dessus : s'il est actif, on ferme uniquement lui (il n'avait
            // jusqu'ici aucun handler Échap) ; sinon, un appui suivant ferme la modale Ajouter en dessous.
            const wishlistPickerOverlay = document.getElementById('wishlist-picker-overlay');
            const wishlistPickerOpen = !!wishlistPickerOverlay && wishlistPickerOverlay.classList.contains('active');
            if (wishlistPickerOpen) {
                closeWishlistPicker();
            } else {
                closeMobileAddPanel();
            }
        }
    });

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
        // VT5b (cf roadmap technique animations premium) : c'est le vrai contrôle de tri Galerie/Classeur
        // (le Tableau a ses propres en-têtes cliquables, sortCollection() dans collection.js) - trouvé
        // manquant lors du test manuel VT5b, filterAndDisplay() ne déclenchait jamais la réorganisation
        // animée de la Galerie via ce sélecteur.
        filterAndDisplayReorder();
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

if (document.getElementById('search-collection')) initEventListeners();

function initDesktopNavigation() {
    renderTab(getTabIdFromHash(), { activateContent: false });
}

document.addEventListener('DOMContentLoaded', initDesktopNavigation);

// ===== VERROU DE SCROLL PENDANT UNE MODALE =====
// Générique : ne connaît aucun modal en particulier, ne dépend d'aucune fonction d'ouverture/fermeture.
// Chaque modal bascule déjà .active sur son .modal-overlay (pattern déjà systématique dans ce projet) -
// un MutationObserver par overlay suffit à savoir si au moins un modal est ouvert, sans toucher aux ~14
// fonctions d'ouverture/fermeture existantes ni aux futures. Remplace lockMobileAddPanelScroll/
// unlockMobileAddPanelScroll (modules/cards.js), qui ne couvrait que la modale "Ajouter" mobile - retirées
// pour ne pas avoir deux mécanismes qui se disputent le même overflow.
//
// documentElement (html), pas body : body n'a jamais eu de règle overflow (cf styles.css, seul html a
// overflow-x:hidden en permanence) - c'est html qui est l'élément qui scroll réellement sur ce site.
// Verrouiller body.style.overflow n'avait donc aucun effet (vérifié en usage réel). overflow-x reste
// déjà hidden en CSS (permanent, non touché ici) ; seul overflow-y est ajouté temporairement pendant
// qu'un modal est ouvert, jamais overflow-x sur les deux (html et body) en même temps - c'est
// spécifiquement ce que le commentaire de html évite pour ne pas casser position:sticky.
let modalScrollLockPreviousOverflowY = '';
let modalScrollLocked = false;

function syncModalScrollLock() {
    const anyModalActive = document.querySelector('.modal-overlay.active') !== null;
    if (anyModalActive && !modalScrollLocked) {
        modalScrollLockPreviousOverflowY = document.documentElement.style.overflowY;
        document.documentElement.style.overflowY = 'hidden';
        modalScrollLocked = true;
    } else if (!anyModalActive && modalScrollLocked) {
        document.documentElement.style.overflowY = modalScrollLockPreviousOverflowY;
        modalScrollLocked = false;
    }
}

document.querySelectorAll('.modal-overlay').forEach(overlay => {
    new MutationObserver(syncModalScrollLock).observe(overlay, { attributes: true, attributeFilter: ['class'] });
});

// ===== Exports window (ticket V2 Vite, type="module") =====
// Les déclarations top-level d'un module ES ne s'attachent plus automatiquement à window
// (contrairement à un <script> classique) : réexport explicite pour que les autres scripts
// (chargés en modules indépendants, sans import/export entre eux, scope global inchangé)
// puissent continuer à référencer ces noms tels quels — y compris depuis des onclick="..."
// inline dans du HTML généré. Liste exhaustive des déclarations top-level de ce fichier
// (hors variables déjà passées en window.x = ... directement à leur déclaration, cf audit
// du 2026-08-14 sur l'état mutable partagé entre fichiers).
window.SUPABASE_URL = SUPABASE_URL;
window.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;
window.REMEMBER_ME_KEY = REMEMBER_ME_KEY;
window.rememberAwareStorage = rememberAwareStorage;
window.supabaseClient = supabaseClient;
window.API_BASE = API_BASE;
window.API_EN = API_EN;
window.markDashboardDirty = markDashboardDirty;
window.markStatsDirty = markStatsDirty;
window.refreshCollection = refreshCollection;
window.fillMissingSeriesLogos = fillMissingSeriesLogos;
window.adjustMonthlyStatsAmount = adjustMonthlyStatsAmount;
window.recordMonthlyStats = recordMonthlyStats;
window.hostImageInBackground = hostImageInBackground;
window.hostSeriesAssetsInBackground = hostSeriesAssetsInBackground;
window.performCardAdd = performCardAdd;
window.deleteCard = deleteCard;
window.quantityChangeInProgress = quantityChangeInProgress;
window.changeQuantity = changeQuantity;
window.TAB_PAGE_MAP = TAB_PAGE_MAP;
window.TAB_ROUTES = TAB_ROUTES;
window.ROUTE_TO_TAB = ROUTE_TO_TAB;
window.renderTab = renderTab;
window.getTabIdFromHash = getTabIdFromHash;
window.navigateToTab = navigateToTab;
window.activateTabContent = activateTabContent;
window.marketPriceRefreshInProgress = marketPriceRefreshInProgress;
window.refreshAllMarketPrices = refreshAllMarketPrices;
window.refreshAllMarketPricesInternal = refreshAllMarketPricesInternal;
window.purgeOldPriceHistory = purgeOldPriceHistory;
window.renderPriceMovers = renderPriceMovers;
window.initEventListeners = initEventListeners;
window.initDesktopNavigation = initDesktopNavigation;
window.modalScrollLockPreviousOverflowY = modalScrollLockPreviousOverflowY;
window.modalScrollLocked = modalScrollLocked;
window.syncModalScrollLock = syncModalScrollLock;
