// Listes de souhaits - Pokémon Tracker
// Dépend de: supabaseClient/API_BASE/API_EN/performCardAdd/refreshCollection/recordValueSnapshot/allCollectionCards (tracker.js),
// selectedCard/customPreviewImage (cards.js), showTextPromptModal/showConfirmModal (ui.js), showMessage (utils.js), normalizeForMatch (utils.js)
// Etat possédé : allWishlists, allWishlistItems, expandedWishlistIds, wishlistPriceMap, wishlistSearchQuery, wishlistSortMode, wishlistEditResolve

// window.x plutôt que let (ticket V2 Vite, type="module") pour allWishlists/allWishlistItems/
// wishlistPriceMap : lus depuis import-export.js/wishlist-detail.js/stats-render.js/dashboard.js/
// public-profile.js aussi. Les autres restent 100% locales à ce fichier, gardées en let normal.
window.allWishlists = [];
window.allWishlistItems = [];
let expandedWishlistIds = new Set();
window.wishlistPriceMap = {};
// window.x (ticket V2 Vite) : lu depuis wishlist-detail.js aussi (fiche détail item, P2-4).
window.wishlistPriceSignalMap = {};
let wishlistSearchQuery = '';
let wishlistSortMode = 'date-desc';
let wishlistEditResolve = null;

const WISHLIST_ICON_PRESET = ['🔥', '🌿', '⭐', '💧', '⚡', '🌙', '🎃', '🍀', '🎯', '💎'];
const WISHLIST_COLOR_PRESET = [
    { key: 'gold', hex: '#E8A93B' },
    { key: 'teal', hex: '#3FA7A1' },
    { key: 'purple', hex: '#C77DFF' },
    { key: 'red', hex: '#E8593B' },
    { key: 'blue', hex: '#4C8DF6' },
    { key: 'pink', hex: '#F06BA8' },
    { key: 'green', hex: '#5FBF6B' },
    { key: 'slate', hex: '#8A93A6' }
];
const WISHLIST_THUMB_CAP = 8;

// Duree de fraicheur (ms) en dessous de laquelle renderTab (tracker.js) saute un rechargement
// automatique de l'onglet Souhaits - lue depuis tracker.js via window.WISHLIST_RELOAD_STALE_MS
// (export plus bas), jamais dupliquee en dur la-bas.
window.WISHLIST_RELOAD_STALE_MS = 15000;

// Horodatage du dernier chargement reussi, lu par renderTab (tracker.js) pour eviter un refetch+
// rebuild complet de la grille a chaque simple visite de l'onglet (cf WISHLIST_RELOAD_STALE_MS
// juste au-dessus, tracker.js#renderTab pour l'usage). Mis a jour ici, dans loadWishlists()
// elle-meme (jamais dans les call sites) : ainsi les rafraichissements explicites apres mutation
// (moveWishlistItem, renameWishlist, deleteWishlist(Item), markWishlistItemOwned...) restent toujours
// a jour, seul l'appel automatique de renderTab decide de sauter ou non un chargement.
window.wishlistLastLoadedAt = 0;

// Signature du dernier contenu reellement rendu (JSON des donnees qui pilotent renderWishlistsUI) :
// permet de sauter completement le rebuild+fondu quand une revisite d'onglet (apres expiration de
// WISHLIST_RELOAD_STALE_MS) refetch des donnees strictement identiques - le cas le plus courant en
// pratique (rien n'a change entre deux visites rapprochees). Le clignotement signale par l'utilisateur
// (iPhone) persistait meme apres retrait du backdrop-filter et de l'auto-depliage : plutot que de
// continuer a deviner quelle propriete CSS pose probleme, on evite ici de reconstruire le DOM du tout
// quand ce n'est pas necessaire - zero rebuild = zero repaint possible, quelle qu'en soit la cause.
let wishlistLastRenderedSignature = null;

// Serialise les appels concurrents (audit senior 2026-09, "race sur loadWishlists") : pull-to-refresh,
// changement d'onglet et une mutation (deleteWishlistItem, moveWishlistItem...) peuvent tous appeler
// loadWishlists() à quelques ms d'intervalle. Sans verrou, deux Promise.all() en vol en même temps se
// résolvent dans un ordre non garanti par le réseau - le plus lent écrase l'état (potentiellement plus
// récent, si sa propre écriture vient tout juste d'être commit) posé par le plus rapide, perte
// silencieuse d'une mutation. Une simple queue de profondeur 1 (chaque appel attend que le précédent
// soit terminé avant de lancer son propre fetch) plutôt qu'un verrou "laisser tomber si déjà en cours"
// (cf quantityChangeInProgress, tracker.js) : plusieurs appelants font un `await loadWishlists()`
// juste après leur propre écriture et ont besoin d'un vrai rechargement frais, pas d'un résultat
// partagé potentiellement antérieur à leur propre mutation.
let wishlistLoadChain = Promise.resolve();

function loadWishlists() {
    const run = wishlistLoadChain.then(() => loadWishlistsSequenced());
    // Un échec dans un maillon ne doit jamais bloquer la chaîne pour les appels suivants - chaque
    // appelant gère déjà ses propres erreurs (aucun try/catch nécessaire ici).
    wishlistLoadChain = run.catch(() => {});
    return run;
}

async function loadWishlistsSequenced() {
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

    await loadWishlistPrices();

    const signature = JSON.stringify({ w: allWishlists, i: allWishlistItems, p: wishlistPriceMap, e: [...expandedWishlistIds] });
    if (signature !== wishlistLastRenderedSignature) {
        wishlistLastRenderedSignature = signature;
        renderWishlistsUI();
    }

    markDashboardDirty();
    window.wishlistLastLoadedAt = Date.now();
}

// Signal de prix Wishlist (Phase 2, ticket P2-4, cf audit du 2026-08-14) : position du prix actuel
// dans l'historique réellement disponible (méthode B — la seule robuste à l'espacement irrégulier des
// observations, card_price_history n'étant alimentée que par des déclencheurs ad hoc, jamais un cron).
// Seuils délibérément conservateurs, faute de volume réel documenté pour calibrer autrement : ≥3
// observations ET ≥5 jours d'étalement avant d'afficher quoi que ce soit — sous ce seuil, silence,
// jamais un badge "historique insuffisant" qui encombrerait chaque carte peu suivie. Aucune requête
// supplémentaire : réutilise `rows`, déjà l'historique complet (pas juste le dernier prix) que
// loadWishlistPrices() récupère et jetait jusqu'ici.
function buildWishlistPriceSignals(rows) {
    const grouped = {};
    rows.forEach(row => {
        if (!grouped[row.tcgdex_id]) grouped[row.tcgdex_id] = [];
        grouped[row.tcgdex_id].push(row);
    });

    const signals = {};
    Object.keys(grouped).forEach(id => {
        // rows est déjà trié recorded_at desc (requête de loadWishlistPrices) : obs[0] = prix courant.
        const obs = grouped[id];
        const prices = obs.map(o => Number(o.market_value) || 0).filter(p => p > 0);
        if (prices.length < 3) return;

        const dates = obs.map(o => new Date(o.recorded_at).getTime()).filter(t => !isNaN(t));
        if (dates.length === 0) return;
        const spreadDays = (Math.max(...dates) - Math.min(...dates)) / 86400000;
        if (spreadDays < 5) return;

        const currentPrice = prices[0];
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        if (maxPrice === minPrice) return; // aucune variation observée, rien à signaler

        const range = maxPrice - minPrice;
        const nearLow = currentPrice <= minPrice + range * 0.1;
        const nearHigh = currentPrice >= maxPrice - range * 0.1;
        if (!nearLow && !nearHigh) return; // ni bas ni haut : pas de signal plutôt qu'un signal flou

        const type = nearLow ? 'low' : 'high';
        const preciseWindow = spreadDays >= 25; // assez proche de 30j pour l'annoncer explicitement
        const wording = type === 'low'
            ? (preciseWindow ? 'Prix bas par rapport aux 30 derniers jours' : 'Proche de son plus bas observé récemment')
            : (preciseWindow ? 'Prix élevé par rapport aux 30 derniers jours' : 'Proche de son plus haut observé récemment');

        signals[id] = { type, wording, count: prices.length, spreadDays: Math.round(spreadDays) };
    });

    return signals;
}

// Dernier prix marché connu par carte, via card_price_history (table partagée entre comptes, cf.
// mémoire rls_migration_progress) — la wishlist ne stocke pas de prix, seulement tcgdex_id.
async function loadWishlistPrices() {
    const uniqueIds = [...new Set(allWishlistItems.filter(i => i.tcgdex_id).map(i => i.tcgdex_id))];
    wishlistPriceMap = {};
    wishlistPriceSignalMap = {};
    if (uniqueIds.length === 0) return;

    const { data, error } = await supabaseClient
        .from('card_price_history')
        .select('tcgdex_id, market_value, recorded_at')
        .in('tcgdex_id', uniqueIds)
        .order('recorded_at', { ascending: false });

    if (error || !data) {
        console.error('Erreur chargement prix wishlist:', error);
        return;
    }

    data.forEach(row => {
        if (!(row.tcgdex_id in wishlistPriceMap)) {
            wishlistPriceMap[row.tcgdex_id] = Number(row.market_value) || 0;
        }
    });

    // Même `data` que ci-dessus (déjà l'historique complet, pas juste le dernier prix) : aucune
    // requête supplémentaire pour le signal de prix.
    wishlistPriceSignalMap = buildWishlistPriceSignals(data);

    // Une carte présente uniquement dans une wishlist (jamais possédée/rafraîchie) n'a jamais eu
    // de point dans card_price_history : on va chercher son prix directement sur TCGdex, et on
    // l'enregistre dans le cache partagé au passage pour éviter de le re-fetcher la prochaine fois.
    const missingIds = uniqueIds.filter(id => !(id in wishlistPriceMap));
    if (missingIds.length === 0) return;

    const fetchedRows = [];
    const batchSize = 5;
    for (let i = 0; i < missingIds.length; i += batchSize) {
        const batch = missingIds.slice(i, i + batchSize);
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
                wishlistPriceMap[id] = price;
                if (price > 0) fetchedRows.push({ tcgdex_id: id, market_value: price });
            } catch (error) {
                console.error(`Erreur récupération prix wishlist pour ${id}:`, error);
            }
        }));
    }

    if (fetchedRows.length > 0) {
        const { error: insertError } = await supabaseClient.from('card_price_history').insert(fetchedRows);
        if (insertError) console.error('Erreur enregistrement prix wishlist:', insertError);
    }
}

function filterWishlist(query) {
    wishlistSearchQuery = query || '';
    renderWishlistsUI();
}

function setWishlistSort(mode) {
    wishlistSortMode = mode || 'date-desc';
    renderWishlistsUI();
}

function sortWishlistItems(items) {
    const sorted = [...items];
    if (wishlistSortMode === 'name-asc') {
        sorted.sort((a, b) => a.name.localeCompare(b.name));
    } else if (wishlistSortMode === 'price-desc') {
        sorted.sort((a, b) => (wishlistPriceMap[b.tcgdex_id] || 0) - (wishlistPriceMap[a.tcgdex_id] || 0));
    }
    // 'date-desc' : déjà l'ordre renvoyé par la requête (created_at desc)
    return sorted;
}

async function moveWishlistItem(itemId, targetWishlistId) {
    if (!targetWishlistId) return false;

    const { error } = await supabaseClient.from('wishlist').update({ wishlist_id: Number(targetWishlistId) }).eq('id', itemId);
    if (error) {
        showMessage('Erreur lors du déplacement', 'error');
        console.error(error);
        return false;
    }

    showMessage('Carte déplacée', 'success');
    await loadWishlists();
    return true;
}

function toggleWishlistSection(wishlistId) {
    if (expandedWishlistIds.has(wishlistId)) {
        expandedWishlistIds.delete(wishlistId);
    } else {
        expandedWishlistIds.add(wishlistId);
    }
    renderWishlistsUI();
}

async function renameWishlist(wishlistId) {
    const current = allWishlists.find(w => w.id === wishlistId);
    if (!current) return;

    const result = await showWishlistEditModal('Modifier la liste', {
        name: current.name,
        icon: current.icon || WISHLIST_ICON_PRESET[2],
        color: current.color || WISHLIST_COLOR_PRESET[0].hex
    });
    if (!result) return;

    const { error } = await supabaseClient.from('wishlists').update({ name: result.name, icon: result.icon, color: result.color }).eq('id', wishlistId);
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

    if (!await showConfirmModal(`Supprimer la liste "${escapeHtml(current.name)}" et toutes les cartes qu'elle contient ?`, 'Supprimer')) return;

    const { error } = await supabaseClient.from('wishlists').delete().eq('id', wishlistId);
    if (error) {
        showMessage('Erreur lors de la suppression de la liste', 'error');
        console.error(error);
        return;
    }

    expandedWishlistIds.delete(wishlistId);
    markStatsDirty(); // supprime aussi toutes les cartes de la liste (cascade) : le compte Stats change
    await loadWishlists();
}

async function deleteWishlistItem(itemId) {
    if (!await showConfirmModal('Retirer cette carte de cette liste ?', 'Retirer')) return false;

    const { error } = await supabaseClient.from('wishlist').delete().eq('id', itemId);
    if (error) {
        showMessage('Erreur lors de la suppression', 'error');
        console.error(error);
        return false;
    }

    markStatsDirty();
    await loadWishlists();
    return true;
}

// Ajoute la carte à la collection (sans la retirer de la liste de souhaits)
async function markWishlistItemOwned(itemId, { acquisitionType = 'achat', purchasePrice = 0, customDate = null } = {}) {
    const item = allWishlistItems.find(w => w.id === itemId);
    if (!item) return false;

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
            acquisitionType,
            purchasePrice,
            customImage: null,
            customDate
        });
    } catch (error) {
        showMessage('Erreur lors de l\'ajout à la collection', 'error');
        console.error(error);
        return false;
    }

    showMessage('Ajoutée à ta collection ! Pense à ajuster l\'état et le prix si besoin.', 'success');
    await refreshCollection();
    await recordValueSnapshot();
    renderWishlistsUI();
    return true;
}

function renderWishlistsUI() {
    const container = document.getElementById('wishlists-container');
    updateWishlistKpis();
    if (!container) return;

    if (allWishlists.length === 0) {
        container.innerHTML = '<p class="empty-state"><i class="ti ti-star" aria-hidden="true"></i> Aucune liste de souhaits pour l\'instant</p>';
        playWishlistContainerFadeIn(container);
        return;
    }

    const ownedTcgdexIds = new Set(allCollectionCards.filter(c => c.tcgdex_id).map(c => c.tcgdex_id));
    const query = normalizeForMatch(wishlistSearchQuery);

    container.innerHTML = allWishlists.map(list => {
        const allItemsInList = allWishlistItems.filter(i => i.wishlist_id === list.id);
        const listValue = allItemsInList.reduce((sum, i) => {
            const owned = i.tcgdex_id && ownedTcgdexIds.has(i.tcgdex_id);
            return owned ? sum : sum + (wishlistPriceMap[i.tcgdex_id] || 0);
        }, 0);

        const visibleItems = query
            ? allItemsInList.filter(i => normalizeForMatch(i.name).includes(query) || normalizeForMatch(i.series).includes(query))
            : allItemsInList;
        const items = sortWishlistItems(visibleItems);
        const isExpanded = expandedWishlistIds.has(list.id);
        const shownItems = isExpanded ? items : items.slice(0, WISHLIST_THUMB_CAP);
        const overflowCount = isExpanded ? 0 : Math.max(0, items.length - WISHLIST_THUMB_CAP);

        const otherLists = allWishlists.filter(l => l.id !== list.id);
        const icon = list.icon || WISHLIST_ICON_PRESET[2];
        const color = list.color || WISHLIST_COLOR_PRESET[0].hex;

        const thumbsHtml = shownItems.map(item => {
            const owned = item.tcgdex_id && ownedTcgdexIds.has(item.tcgdex_id);
            const price = wishlistPriceMap[item.tcgdex_id] || 0;
            // P2-4 : badge compact, jamais affiché en même temps que "Obtenue" (l'un ou l'autre occupe
            // le coin haut-gauche, la carte est déjà obtenue ne concerne plus un signal d'achat).
            const signal = !owned ? wishlistPriceSignalMap[item.tcgdex_id] : null;

            return `
                <div class="wishlist-thumb-wrap">
                    <div class="collection-card wishlist-thumb-card" data-wishlist-item-id="${item.id}" onclick="openWishlistItemDetail(${item.id}, event)" title="${escapeHtml(item.name)}">
                        ${item.image
                            ? `<img src="${item.image}" alt="${escapeHtml(item.name)}" loading="lazy" onerror="this.style.display='none'">`
                            : '<div class="collection-card-noimg"><i class="ti ti-photo-off" aria-hidden="true"></i></div>'
                        }
                        ${owned ? '<div class="qty-badge wishlist-thumb-owned-flag"><i class="ti ti-check" aria-hidden="true"></i> Obtenue</div>' : ''}
                        ${signal ? `<div class="price-signal-badge price-signal-${signal.type}" title="${escapeHtml(signal.wording)}"><i class="ti ti-arrow-${signal.type === 'low' ? 'down' : 'up'}" aria-hidden="true"></i></div>` : ''}
                        ${price > 0 ? `<div class="price-badge">${formatPrice(price)}</div>` : ''}
                        <div class="collection-card-overlay">
                            <div class="collection-card-name">${escapeHtml(item.name)}</div>
                            <div class="collection-card-set">${item.series_logo ? `<img src="${item.series_logo}" class="series-logo-inline" alt="" onerror="this.remove()">` : ''}${escapeHtml(item.series)} · #${escapeHtml(item.number)}</div>
                        </div>
                    </div>
                </div>
            `;
        }).join('') + (overflowCount > 0 ? `<div class="wishlist-thumb-overflow" onclick="toggleWishlistSection(${list.id})">+${overflowCount} cartes</div>` : '');

        return `
            <div class="wishlist-list-card">
                <div class="wishlist-list-card-header" onclick="toggleWishlistSection(${list.id})">
                    <span class="wishlist-list-icon" style="background:${color}22; color:${color};">${icon}</span>
                    <div class="wishlist-list-card-title">
                        <span class="wishlist-list-name">${escapeHtml(list.name)}</span>
                        <span class="wishlist-count-badge">${allItemsInList.length} cartes</span>
                        ${listValue > 0 ? `<span class="wishlist-list-value">${formatPrice(listValue)}</span>` : ''}
                    </div>
                    <div class="wishlist-list-card-actions">
                        <button onclick="event.stopPropagation(); renameWishlist(${list.id})" title="Renommer"><i class="ti ti-edit" aria-hidden="true"></i></button>
                        <button onclick="event.stopPropagation(); deleteWishlist(${list.id})" title="Supprimer la liste"><i class="ti ti-trash" aria-hidden="true"></i></button>
                        <button onclick="event.stopPropagation(); toggleWishlistSection(${list.id})" title="${isExpanded ? 'Replier' : 'Déplier'}">
                            <i class="ti ti-chevron-right wishlist-chevron ${isExpanded ? 'expanded' : ''}" aria-hidden="true"></i>
                        </button>
                    </div>
                </div>
                <div class="wishlist-list-card-body" style="display: ${isExpanded ? 'block' : 'none'};">
                    ${items.length === 0
                        ? (query
                            ? '<p class="empty-state">Aucune carte ne correspond à ta recherche</p>'
                            : `
                                <div class="app-empty-state">
                                    <svg class="app-empty-icon" viewBox="0 0 100 100" aria-hidden="true">
                                        <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" stroke-width="3"/>
                                        <line x1="10" y1="50" x2="90" y2="50" stroke="currentColor" stroke-width="3"/>
                                        <circle cx="50" cy="50" r="13" fill="none" stroke="currentColor" stroke-width="3"/>
                                        <circle cx="50" cy="50" r="4" fill="currentColor"/>
                                    </svg>
                                    <div class="app-empty-title">Cette liste est vide</div>
                                    <p class="app-empty-text">Ajoutez les cartes que vous recherchez pour commencer cette liste.</p>
                                    <button class="filter-toggle-btn app-empty-cta" onclick="navigateToTab('tab-add')"><i class="ti ti-plus" aria-hidden="true"></i> Ajouter une carte</button>
                                </div>
                            `)
                        : `<div class="wishlist-thumb-grid">${thumbsHtml}</div>`
                    }
                </div>
            </div>
        `;
    }).join('');

    refreshWishlistThumbPlaceholders();
    playWishlistContainerFadeIn(container);
}

// Adoucit le pop de chaque reconstruction complete du innerHTML (fetch reseau, cf
// WISHLIST_RELOAD_STALE_MS plus haut) : reutilise tab-content-fade-in (styles.css), meme duree/easing
// que le reste du site. Reset explicite de l'animation avant de la relancer (animation:none + reflow
// forcee via offsetWidth) car reappliquer la meme valeur de propriete animation ne relance pas une
// animation deja terminee - necessaire ici puisque #wishlists-container est le meme noeud DOM a chaque
// appel, jamais recree contrairement au contenu qu'il contient.
//
// Tentative du 2026-08-18 de ne jouer ce fondu qu'une fois par session (wishlistFirstFadeDone) : revert
// immediat, le scintillement rapporte par l'utilisateur etait en fait PIRE sans fondu (le swap instantane
// du innerHTML, plus le temps de chargement reseau des images, devenait plus brutal/visible que le
// fondu qui l'attenuait auparavant) - la cause reelle n'est donc pas le fondu lui-meme. A investiguer :
// probablement les <img> recreees a chaque rebuild qui repartent de zero (pas de cache navigateur chaud
// apres un moment sans visite), pas l'animation. wishlistFirstFadeDone laisse en place mais inutilise
// pour l'instant (aucune raison de le retirer avant la vraie cause identifiee).
function playWishlistContainerFadeIn(container) {
    container.style.animation = 'none';
    void container.offsetWidth;
    container.style.animation = 'tab-content-fade-in 300ms ease-in-out';
}

// Complète visuellement la dernière ligne de chaque grille de miniatures avec des emplacements
// vides purement décoratifs (non interactifs), pour éviter qu'une liste avec peu de cartes ne
// laisse un grand vide à droite. Le nombre de colonnes réellement affichées dépend de la largeur
// fluide du conteneur (cf. Ticket 1 : colonnes à largeur fixe, pas de 1fr) — on le déduit donc de
// la largeur mesurée du DOM plutôt que de le deviner, pour rester juste à toutes les tailles d'écran.
const WISHLIST_THUMB_CARD_WIDTH = { desktop: 190, mobile: 135 };
const WISHLIST_THUMB_CARD_GAP = { desktop: 26, mobile: 16 };

function refreshWishlistThumbPlaceholders() {
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    const cardWidth = isMobile ? WISHLIST_THUMB_CARD_WIDTH.mobile : WISHLIST_THUMB_CARD_WIDTH.desktop;
    const gap = isMobile ? WISHLIST_THUMB_CARD_GAP.mobile : WISHLIST_THUMB_CARD_GAP.desktop;

    document.querySelectorAll('.wishlist-thumb-grid').forEach(grid => {
        grid.querySelectorAll('.wishlist-thumb-placeholder').forEach(el => el.remove());

        const realCount = grid.querySelectorAll('.wishlist-thumb-wrap').length;
        const hasOverflowTile = !!grid.querySelector('.wishlist-thumb-overflow');
        if (realCount === 0 || hasOverflowTile) return;

        const width = grid.clientWidth;
        if (width === 0) return; // liste repliée, pas de mise en page à mesurer pour l'instant

        const columns = Math.max(1, Math.floor((width + gap) / (cardWidth + gap)));
        const remainder = realCount % columns;
        if (remainder === 0) return;

        const missing = columns - remainder;
        for (let i = 0; i < missing; i++) {
            const placeholder = document.createElement('div');
            placeholder.className = 'wishlist-thumb-placeholder';
            placeholder.title = 'Ajouter une carte';
            placeholder.addEventListener('click', () => navigateToTab('tab-add'));
            grid.appendChild(placeholder);
        }
    });
}

let wishlistPlaceholderResizeTimer = null;
window.addEventListener('resize', () => {
    clearTimeout(wishlistPlaceholderResizeTimer);
    wishlistPlaceholderResizeTimer = setTimeout(refreshWishlistThumbPlaceholders, 150);
});

function updateWishlistKpis() {
    const countEl = document.getElementById('wishlist-kpi-count');
    const valueEl = document.getElementById('wishlist-kpi-value');
    const listsEl = document.getElementById('wishlist-kpi-lists');
    const topPriceEl = document.getElementById('wishlist-kpi-top-price');
    const topNameEl = document.getElementById('wishlist-kpi-top-name');
    const topImgEl = document.getElementById('wishlist-kpi-top-img');
    const topEmojiEl = document.getElementById('wishlist-kpi-top-emoji');
    if (!countEl || !valueEl || !listsEl || !topPriceEl || !topNameEl || !topImgEl || !topEmojiEl) return;

    const ownedTcgdexIds = new Set(allCollectionCards.filter(c => c.tcgdex_id).map(c => c.tcgdex_id));
    const totalValue = allWishlistItems.reduce((sum, i) => {
        const owned = i.tcgdex_id && ownedTcgdexIds.has(i.tcgdex_id);
        return owned ? sum : sum + (wishlistPriceMap[i.tcgdex_id] || 0);
    }, 0);
    const topItem = allWishlistItems.reduce((best, i) => {
        const price = wishlistPriceMap[i.tcgdex_id] || 0;
        return price > (best ? (wishlistPriceMap[best.tcgdex_id] || 0) : 0) ? i : best;
    }, null);
    const topPrice = topItem ? (wishlistPriceMap[topItem.tcgdex_id] || 0) : 0;

    countEl.textContent = allWishlistItems.length;
    valueEl.textContent = formatPrice(totalValue);
    listsEl.textContent = allWishlists.length;
    topPriceEl.textContent = formatPrice(topPrice);

    if (topItem && topPrice > 0) {
        topNameEl.textContent = topItem.name;
        if (topItem.image) {
            topImgEl.src = topItem.image;
            topImgEl.alt = topItem.name;
            topImgEl.style.display = 'block';
            topEmojiEl.style.display = 'none';
        } else {
            topImgEl.style.display = 'none';
            topEmojiEl.style.display = 'flex';
        }
    } else {
        topNameEl.textContent = 'Carte la plus chère';
        topImgEl.style.display = 'none';
        topEmojiEl.style.display = 'flex';
    }
}

// ===== MODALE EDITION LISTE (nom + icone + couleur) =====

function showWishlistEditModal(title, defaults) {
    defaults = defaults || { name: '', icon: WISHLIST_ICON_PRESET[2], color: WISHLIST_COLOR_PRESET[0].hex };
    return new Promise((resolve) => {
        wishlistEditResolve = resolve;
        const content = document.getElementById('wishlist-edit-content');
        content.innerHTML = `
            <button class="modal-close" onclick="closeWishlistEditModal()">✕</button>
            <div class="modal-scroll">
                <div class="modal-title" style="margin-bottom: 1rem;">${title}</div>
                <input type="text" id="wishlist-edit-name" value="${escapeHtml(defaults.name).replace(/"/g, '&quot;')}" placeholder="Nom de la liste" style="width:100%;">
                <div class="wishlist-edit-picker-label">Icône</div>
                <div class="wishlist-edit-icon-grid" id="wishlist-edit-icon-grid">
                    ${WISHLIST_ICON_PRESET.map(ic => `<button type="button" class="wishlist-edit-icon-swatch ${ic === defaults.icon ? 'selected' : ''}" data-icon="${ic}" onclick="selectWishlistEditIcon('${ic}')">${ic}</button>`).join('')}
                </div>
                <div class="wishlist-edit-picker-label">Couleur</div>
                <div class="wishlist-edit-color-grid" id="wishlist-edit-color-grid">
                    ${WISHLIST_COLOR_PRESET.map(c => `<button type="button" class="wishlist-edit-color-swatch ${c.hex === defaults.color ? 'selected' : ''}" data-color="${c.hex}" style="background:${c.hex};" onclick="selectWishlistEditColor('${c.hex}')"></button>`).join('')}
                </div>
                <div class="modal-edit-actions" style="margin-top: 1.25rem;">
                    <button class="modal-save-btn" onclick="submitWishlistEditModal()">Valider</button>
                    <button class="modal-cancel-btn" onclick="closeWishlistEditModal()">Annuler</button>
                </div>
            </div>
        `;
        content.dataset.icon = defaults.icon;
        content.dataset.color = defaults.color;
        document.getElementById('wishlist-edit-overlay').classList.add('active');

        const input = document.getElementById('wishlist-edit-name');
        setTimeout(() => { input.focus(); input.select(); }, 50);
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') submitWishlistEditModal();
        });
    });
}

function selectWishlistEditIcon(icon) {
    const content = document.getElementById('wishlist-edit-content');
    content.dataset.icon = icon;
    document.querySelectorAll('.wishlist-edit-icon-swatch').forEach(el => el.classList.toggle('selected', el.dataset.icon === icon));
}

function selectWishlistEditColor(color) {
    const content = document.getElementById('wishlist-edit-content');
    content.dataset.color = color;
    document.querySelectorAll('.wishlist-edit-color-swatch').forEach(el => el.classList.toggle('selected', el.dataset.color === color));
}

function submitWishlistEditModal() {
    const content = document.getElementById('wishlist-edit-content');
    const name = document.getElementById('wishlist-edit-name').value.trim();
    document.getElementById('wishlist-edit-overlay').classList.remove('active');
    if (wishlistEditResolve) {
        wishlistEditResolve(name ? { name, icon: content.dataset.icon, color: content.dataset.color } : null);
        wishlistEditResolve = null;
    }
}

function closeWishlistEditModal() {
    document.getElementById('wishlist-edit-overlay').classList.remove('active');
    if (wishlistEditResolve) {
        wishlistEditResolve(null);
        wishlistEditResolve = null;
    }
}

// ===== FENETRE DE CHOIX / CREATION DE LISTE (au moment d'ajouter une carte) =====

// Carte ciblée par le picker quand il est ouvert depuis un contexte hors "Ajouter" (ex: fiche détail
// publique tierce, modules/public-profile.js) : selectedCard reste réservé au flow Ajouter existant,
// jamais réutilisé/écrasé pour ne pas risquer de corrompre ce flow. wishlistPickerContext distingue les
// deux chemins dans addCardToSpecificWishlistInternal (image déjà hébergée côté publique -> pas de
// re-upload, pas de fermeture de #card-preview qui n'a aucun sens hors du flow Ajouter).
let wishlistPickerCard = null;
let wishlistPickerContext = 'add';

function openWishlistPicker(externalCard = null) {
    if (externalCard) {
        wishlistPickerCard = externalCard;
        wishlistPickerContext = 'public';
    } else {
        if (!selectedCard) {
            showMessage('Veuillez sélectionner une carte', 'error');
            return;
        }
        wishlistPickerCard = null;
        wishlistPickerContext = 'add';
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
            <span>${escapeHtml(list.name)}</span>
            <i class="ti ti-chevron-right" aria-hidden="true"></i>
        </div>
    `).join('');

    content.innerHTML = `
        <button class="modal-close" onclick="closeWishlistPicker()">✕</button>
        <div class="modal-scroll">
        <div class="modal-title" style="margin-bottom: 1rem;">Ajouter à quelle liste ?</div>
        <div class="wishlist-picker-list">
            ${listsHtml || '<p class="empty-state" style="padding: 1rem;">Aucune liste pour l\'instant</p>'}
        </div>
        <div class="wishlist-picker-new">
            <input type="text" id="new-wishlist-name" placeholder="Nom d'une nouvelle liste">
            <button class="wishlist-picker-add-btn" onclick="createWishlistAndAddCard()"><i class="ti ti-plus" aria-hidden="true"></i> Ajouter</button>
        </div>
        </div>
    `;
}

// Verrou partagé par les 2 actions du picker (ajouter à une liste existante / créer une liste + ajouter) :
// aucun garde n'existait avant, un double-clic pouvait insérer deux fois la même carte ou créer deux
// listes identiques. Un seul flag suffit ici (pas un verrou Wishlist global) car ces deux actions ne
// peuvent de toute façon pas être menées en parallèle depuis la même modale picker.
let wishlistPickerBusy = false;

async function addCardToSpecificWishlist(wishlistId) {
    if (wishlistPickerBusy) return;
    wishlistPickerBusy = true;
    try {
        await addCardToSpecificWishlistInternal(wishlistId);
    } finally {
        wishlistPickerBusy = false;
    }
}

async function addCardToSpecificWishlistInternal(wishlistId) {
    if (wishlistPickerContext === 'public') {
        return addPublicCardToWishlistInternal(wishlistId);
    }

    if (!selectedCard) return;

    // Image : si déjà hébergée sur Supabase (dédup rapide) on l'utilise tout de suite, sinon on part
    // sur le lien TCGdex brut pour ne pas bloquer l'ajout, et l'upload se termine en tâche de fond.
    let imageUrl = customPreviewImage || '';
    let tcgdexFallbackUrl = '';
    let imageNeedsBackgroundUpload = false;
    if (!imageUrl && selectedCard.image) {
        tcgdexFallbackUrl = `${selectedCard.image}/high.webp`;
        const existingUrl = selectedCard.id ? await checkExistingImage(selectedCard.id) : null;
        if (existingUrl) {
            imageUrl = existingUrl;
        } else {
            imageUrl = tcgdexFallbackUrl;
            imageNeedsBackgroundUpload = true;
        }
    }
    const logoUrl = selectedCard.set?.logo ? `${selectedCard.set.logo}.webp` : null;

    const { data, error } = await supabaseClient.from('wishlist').insert([{
        wishlist_id: wishlistId,
        tcgdex_id: selectedCard.id || null,
        name: selectedCard.name || '?',
        series: selectedCard.set?.name || 'N/A',
        number: selectedCard.localId || '?',
        rarity: selectedCard.rarity || 'N/A',
        image: imageUrl,
        series_logo: logoUrl,
        cardmarket_id: selectedCard.pricing?.cardmarket?.idProduct || null
    }]).select().single();

    if (error) {
        showMessage('Erreur lors de l\'ajout à la liste de souhaits', 'error');
        console.error(error);
        return;
    }

    markStatsDirty();

    if (imageNeedsBackgroundUpload) {
        fetchAndUploadExternalImage(tcgdexFallbackUrl, selectedCard.id)
            .then(url => supabaseClient.from('wishlist').update({ image: url }).eq('id', data.id))
            .then(({ error: updateError }) => { if (updateError) console.error('Erreur mise à jour image wishlist (arrière-plan):', updateError); })
            .catch(err => console.error('Echec hébergement image wishlist (arrière-plan):', err));
    }

    showMessage('Ajoutée à ta liste de souhaits !', 'success');
    closeWishlistPicker();
    document.getElementById('card-preview').classList.remove('active');
    selectedCard = null;
    customPreviewImage = null;

    // Uniquement après un ajout Wishlist réellement confirmé (le insert Supabase a déjà réussi au-dessus,
    // aucune erreur n'a fait de "return" avant ce point) : ferme la modale Ajouter mobile si elle est
    // ouverte. closeMobileAddPanel() est définie dans modules/cards.js, chargé avant ce module.
    if (typeof isMobileAddPanelOpen === 'function' && isMobileAddPanelOpen()) closeMobileAddPanel();

    await loadWishlists();
}

// Ajout depuis une fiche détail publique tierce (modules/public-profile.js). wishlistPickerCard porte
// déjà une image hébergée sur Supabase (celle de la collection du propriétaire consulté) : pas de
// re-upload/dédup à faire ici, contrairement au flow Ajouter. wishlist_id ci-dessous vient toujours de
// allWishlists (mes listes à moi) donc l'insert crée une ligne chez MOI ; la RLS empêche de toute façon
// toute écriture ciblant un autre user_id.
async function addPublicCardToWishlistInternal(wishlistId) {
    if (!wishlistPickerCard) return;
    const card = wishlistPickerCard;

    const { error } = await supabaseClient.from('wishlist').insert([{
        wishlist_id: wishlistId,
        tcgdex_id: card.tcgdex_id || null,
        name: card.name || '?',
        series: card.series || 'N/A',
        number: card.number || '?',
        rarity: card.rarity || 'N/A',
        image: card.image || '',
        series_logo: card.series_logo || null,
        cardmarket_id: card.cardmarket_id || null
    }]);

    if (error) {
        showMessage('Erreur lors de l\'ajout à la liste de souhaits', 'error');
        console.error(error);
        return;
    }

    markStatsDirty();
    showMessage('Ajoutée à ta liste de souhaits !', 'success');
    closeWishlistPicker();
    wishlistPickerCard = null;

    await loadWishlists();
    if (typeof refreshPublicCardDetailWishlistState === 'function') refreshPublicCardDetailWishlistState();
}

async function createWishlistAndAddCard() {
    if (wishlistPickerBusy) return;
    wishlistPickerBusy = true;

    try {
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
        // Appel direct à la version interne (sans garde) : le verrou est déjà tenu par cet appelant,
        // addCardToSpecificWishlist() ferait un no-op puisque wishlistPickerBusy est déjà true.
        await addCardToSpecificWishlistInternal(data.id);
    } finally {
        wishlistPickerBusy = false;
    }
}

// Verrou dédié : flow indépendant du picker (bouton "Nouvelle liste" de la page Wishlist, pas de la
// modale Ajouter), pas de raison de partager wishlistPickerBusy.
let createWishlistOnlyBusy = false;

async function createWishlistOnly() {
    if (createWishlistOnlyBusy) return;
    createWishlistOnlyBusy = true;

    try {
        const result = await showWishlistEditModal('Nouvelle liste', { name: '', icon: WISHLIST_ICON_PRESET[2], color: WISHLIST_COLOR_PRESET[0].hex });
        if (!result) return;

        const { error } = await supabaseClient.from('wishlists').insert([{ name: result.name, icon: result.icon, color: result.color }]);
        if (error) {
            showMessage('Erreur lors de la création de la liste', 'error');
            console.error(error);
            return;
        }

        await loadWishlists();
    } finally {
        createWishlistOnlyBusy = false;
    }
}

// ===== Exports window (ticket V2 Vite, type="module") =====
// Les déclarations top-level d'un module ES ne s'attachent plus automatiquement à window
// (contrairement à un <script> classique) : réexport explicite pour que les autres scripts
// (chargés en modules indépendants, sans import/export entre eux, scope global inchangé)
// puissent continuer à référencer ces noms tels quels — y compris depuis des onclick="..."
// inline dans du HTML généré. Liste exhaustive des déclarations top-level de ce fichier
// (hors variables déjà passées en window.x = ... directement à leur déclaration, cf audit
// du 2026-08-14 sur l'état mutable partagé entre fichiers).
window.expandedWishlistIds = expandedWishlistIds;
window.wishlistSearchQuery = wishlistSearchQuery;
window.wishlistSortMode = wishlistSortMode;
window.wishlistEditResolve = wishlistEditResolve;
window.WISHLIST_ICON_PRESET = WISHLIST_ICON_PRESET;
window.WISHLIST_COLOR_PRESET = WISHLIST_COLOR_PRESET;
window.WISHLIST_THUMB_CAP = WISHLIST_THUMB_CAP;
window.loadWishlists = loadWishlists;
window.loadWishlistPrices = loadWishlistPrices;
window.filterWishlist = filterWishlist;
window.setWishlistSort = setWishlistSort;
window.sortWishlistItems = sortWishlistItems;
window.moveWishlistItem = moveWishlistItem;
window.toggleWishlistSection = toggleWishlistSection;
window.renameWishlist = renameWishlist;
window.deleteWishlist = deleteWishlist;
window.deleteWishlistItem = deleteWishlistItem;
window.markWishlistItemOwned = markWishlistItemOwned;
window.renderWishlistsUI = renderWishlistsUI;
window.WISHLIST_THUMB_CARD_WIDTH = WISHLIST_THUMB_CARD_WIDTH;
window.WISHLIST_THUMB_CARD_GAP = WISHLIST_THUMB_CARD_GAP;
window.refreshWishlistThumbPlaceholders = refreshWishlistThumbPlaceholders;
window.wishlistPlaceholderResizeTimer = wishlistPlaceholderResizeTimer;
window.updateWishlistKpis = updateWishlistKpis;
window.showWishlistEditModal = showWishlistEditModal;
window.selectWishlistEditIcon = selectWishlistEditIcon;
window.selectWishlistEditColor = selectWishlistEditColor;
window.submitWishlistEditModal = submitWishlistEditModal;
window.closeWishlistEditModal = closeWishlistEditModal;
window.wishlistPickerCard = wishlistPickerCard;
window.wishlistPickerContext = wishlistPickerContext;
window.openWishlistPicker = openWishlistPicker;
window.closeWishlistPicker = closeWishlistPicker;
window.renderWishlistPicker = renderWishlistPicker;
window.wishlistPickerBusy = wishlistPickerBusy;
window.addCardToSpecificWishlist = addCardToSpecificWishlist;
window.addCardToSpecificWishlistInternal = addCardToSpecificWishlistInternal;
window.addPublicCardToWishlistInternal = addPublicCardToWishlistInternal;
window.createWishlistAndAddCard = createWishlistAndAddCard;
window.createWishlistOnlyBusy = createWishlistOnlyBusy;
window.createWishlistOnly = createWishlistOnly;
