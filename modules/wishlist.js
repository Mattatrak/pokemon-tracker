// Listes de souhaits - Pokémon Tracker
// Dépend de: supabaseClient/API_BASE/API_EN/performCardAdd/refreshCollection/recordValueSnapshot/allCollectionCards (tracker.js),
// selectedCard/customPreviewImage (cards.js), showTextPromptModal/showConfirmModal (ui.js), showMessage (utils.js)
// Etat possédé : allWishlists, allWishlistItems, expandedWishlistIds

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
                            ? `<img src="${item.image}" alt="${escapeHtml(item.name)}" class="wishlist-card-img" onerror="this.style.display='none'">`
                            : '<div class="no-image-placeholder thumb"><i class="ti ti-photo-off" aria-hidden="true"></i></div>'
                        }
                        <div class="wishlist-card-info">
                            <div class="wishlist-card-name">${escapeHtml(item.name)}</div>
                            <div class="wishlist-card-set">${item.series_logo ? `<img src="${item.series_logo}" class="series-logo-inline" alt="" onerror="this.remove()">` : ''}${escapeHtml(item.series)} - #${escapeHtml(item.number)}</div>
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
                        <span>${escapeHtml(list.name)}</span>
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
            <span>${escapeHtml(list.name)}</span>
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
