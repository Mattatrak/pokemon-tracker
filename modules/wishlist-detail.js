// Fiche détail carte Wishlist - Pokémon Tracker
// Dépend de: allWishlistItems/allWishlists/wishlistPriceMap/markWishlistItemOwned/moveWishlistItem/
// deleteWishlistItem (modules/wishlist.js), allCollectionCards (tracker.js),
// escapeHtml/getCardmarketUrl/showMessage/initDatePicker (modules/utils.js)
// Etat possédé : wishlistDetailScrollLocked, wishlistDetailPrevBodyOverflow, wishlistDetailCurrentItemId,
// wishlistDetailMoveOpen, wishlistDetailBusy, wishlistDetailAcquisitionOpen, wishlistDetailAcquisitionType,
// wishlistDetailAcquisitionPrice, wishlistDetailAcquisitionDate
//
// Les actions mutantes (Je l'ai !/Déplacer/Retirer) appellent les fonctions métier existantes de
// modules/wishlist.js telles quelles (aucune requête Supabase ni règle métier changée ici). Cette
// fiche ne fait qu'orchestrer l'UI (verrou anti double-clic, panneau d'acquisition achat/booster,
// fermeture uniquement après succès réel).

let wishlistDetailScrollLocked = false;
let wishlistDetailPrevBodyOverflow = '';
let wishlistDetailCurrentItemId = null;
let wishlistDetailMoveOpen = false;
let wishlistDetailBusy = false;

// Panneau "Je l'ai !" (choix Achetée/Booster + prix + date) : wishlistDetailAcquisitionDate est la
// valeur de référence 'YYYY-MM-DD' (même convention que #card-date-added), resynchronisée depuis le
// DOM juste avant chaque appel bloquant pour survivre aux redessins (busy, échec).
let wishlistDetailAcquisitionOpen = false;
let wishlistDetailAcquisitionType = 'achat';
let wishlistDetailAcquisitionPrice = '';
let wishlistDetailAcquisitionDate = '';

function wishlistDetailTodayIso() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function openWishlistItemDetail(itemId) {
    const item = allWishlistItems.find(i => i.id === itemId);
    if (!item) {
        showMessage('Cette carte n\'est plus dans ta wishlist', 'error');
        return;
    }

    wishlistDetailCurrentItemId = itemId;
    wishlistDetailMoveOpen = false;
    wishlistDetailBusy = false;
    wishlistDetailAcquisitionOpen = false;
    wishlistDetailAcquisitionType = 'achat';
    wishlistDetailAcquisitionPrice = '';
    wishlistDetailAcquisitionDate = wishlistDetailTodayIso();

    renderWishlistItemDetail(item);
    document.getElementById('wishlist-detail-overlay').classList.add('active');
    lockBodyScrollForWishlistDetail();
}

function closeWishlistItemDetail() {
    const overlay = document.getElementById('wishlist-detail-overlay');
    if (overlay) overlay.classList.remove('active');
    unlockBodyScrollForWishlistDetail();
    destroyWishlistDetailAcquisitionDatePicker();
    wishlistDetailCurrentItemId = null;
    wishlistDetailMoveOpen = false;
    wishlistDetailBusy = false;
    wishlistDetailAcquisitionOpen = false;
}

// Redessine la fiche sur l'item courant sans la fermer/rouvrir : utilisé pour refléter un changement
// d'état purement UI (verrou "busy", panneau "Déplacer vers..." ou "Je l'ai !" ouvert/fermé) ou pour
// réafficher la fiche après un échec d'action (les données affichées peuvent avoir légèrement bougé
// entre-temps, ex. prix rafraîchi ailleurs, sans que ça pose de souci ici).
function refreshWishlistItemDetail() {
    const item = allWishlistItems.find(i => i.id === wishlistDetailCurrentItemId);
    if (!item) {
        closeWishlistItemDetail();
        return;
    }
    renderWishlistItemDetail(item);
}

function destroyWishlistDetailAcquisitionDatePicker() {
    const dateInput = document.getElementById('wishlist-detail-acquisition-date');
    if (dateInput && dateInput._flatpickr) dateInput._flatpickr.destroy();
}

// buildWishlistDetailHtml() remplace tout le innerHTML de la carte à chaque redessin : l'instance
// flatpickr précédente (si le panneau d'acquisition était ouvert) doit être détruite avant, puis
// une nouvelle instance recréée après insertion, sinon flatpickr laisse un calendrier orphelin
// attaché à document.body (il n'est pas rattaché au DOM qu'on vient de remplacer).
function renderWishlistItemDetail(item) {
    const card = document.getElementById('wishlist-detail-card');
    if (!card) return;
    destroyWishlistDetailAcquisitionDatePicker();
    card.innerHTML = buildWishlistDetailHtml(item);
    if (wishlistDetailAcquisitionOpen) {
        initDatePicker('#wishlist-detail-acquisition-date', wishlistDetailAcquisitionDate);
    }
}

function lockBodyScrollForWishlistDetail() {
    if (wishlistDetailScrollLocked) return;
    wishlistDetailPrevBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    wishlistDetailScrollLocked = true;
}

function unlockBodyScrollForWishlistDetail() {
    if (!wishlistDetailScrollLocked) return;
    document.body.style.overflow = wishlistDetailPrevBodyOverflow;
    wishlistDetailScrollLocked = false;
}

// ===== ACTIONS =====
// Chacune : verrou anti double-clic, appel de la fonction métier existante (inchangée), puis
// fermeture uniquement si elle a retourné true. En échec (false) ou annulation (confirm refusé,
// lui aussi remonté comme false), la fiche reste ouverte et se contente de se redessiner.

function wishlistDetailOpenAcquisition() {
    if (wishlistDetailBusy) return;
    wishlistDetailAcquisitionOpen = true;
    refreshWishlistItemDetail();
}

function wishlistDetailCloseAcquisition() {
    if (wishlistDetailBusy) return;
    wishlistDetailAcquisitionOpen = false;
    refreshWishlistItemDetail();
}

function wishlistDetailSetAcquisitionType(type) {
    if (wishlistDetailBusy) return;
    wishlistDetailAcquisitionType = type;
    refreshWishlistItemDetail();
}

async function wishlistDetailConfirmAcquisition() {
    if (wishlistDetailBusy || !wishlistDetailCurrentItemId) return;

    // Resynchronise les champs saisis dans l'état avant de redessiner (busy) : sinon le prochain
    // rendu reconstruirait les inputs depuis l'état précédent et perdrait la saisie en cours.
    const priceInput = document.getElementById('wishlist-detail-acquisition-price');
    if (priceInput) wishlistDetailAcquisitionPrice = priceInput.value;
    const dateInput = document.getElementById('wishlist-detail-acquisition-date');
    if (dateInput && dateInput.value) wishlistDetailAcquisitionDate = dateInput.value;

    wishlistDetailBusy = true;
    refreshWishlistItemDetail();

    const purchasePrice = wishlistDetailAcquisitionType === 'pack'
        ? 0
        : (parseFloat(wishlistDetailAcquisitionPrice) || 0);

    const ok = await markWishlistItemOwned(wishlistDetailCurrentItemId, {
        acquisitionType: wishlistDetailAcquisitionType,
        purchasePrice,
        customDate: wishlistDetailAcquisitionDate || null
    });

    if (ok) {
        closeWishlistItemDetail();
    } else {
        wishlistDetailBusy = false;
        refreshWishlistItemDetail();
    }
}

function wishlistDetailToggleMove() {
    if (wishlistDetailBusy) return;
    wishlistDetailMoveOpen = !wishlistDetailMoveOpen;
    refreshWishlistItemDetail();
}

async function wishlistDetailMove(targetListId) {
    if (wishlistDetailBusy || !wishlistDetailCurrentItemId) return;
    wishlistDetailBusy = true;
    refreshWishlistItemDetail();

    const ok = await moveWishlistItem(wishlistDetailCurrentItemId, targetListId);

    if (ok) {
        closeWishlistItemDetail();
    } else {
        wishlistDetailBusy = false;
        refreshWishlistItemDetail();
    }
}

async function wishlistDetailRemove() {
    if (wishlistDetailBusy || !wishlistDetailCurrentItemId) return;
    wishlistDetailBusy = true;
    refreshWishlistItemDetail();

    // deleteWishlistItem gère elle-même le confirm() : un refus remonte false, comme un échec réseau —
    // dans les deux cas la fiche doit rester ouverte, donc même branchement.
    const ok = await deleteWishlistItem(wishlistDetailCurrentItemId);

    if (ok) {
        closeWishlistItemDetail();
    } else {
        wishlistDetailBusy = false;
        refreshWishlistItemDetail();
    }
}

// ===== RENDU =====
// Passe design : même logique, mêmes onclick, mêmes flux async — seule la composition HTML/CSS
// change. Colonne droite en 3 blocs (identité / statut wishlist / valeur+actions) séparés par de
// simples filets, pas de nouveaux cadres. Logo de série sur une ligne dédiée (logo + série/numéro).
// Les 3 boutons mutants+cardmarket partagent la même famille visuelle (fond sombre, même hauteur,
// même rayon, même bordure) et ne se distinguent que par la couleur icône/texte ; Retirer reste un
// lien isolé, pas un pavé.

function buildWishlistDetailHtml(item) {
    const list = allWishlists.find(l => l.id === item.wishlist_id);
    const owned = !!(item.tcgdex_id && allCollectionCards.some(c => c.tcgdex_id === item.tcgdex_id));
    const price = wishlistPriceMap[item.tcgdex_id] || 0;
    const addedDate = item.created_at ? new Date(item.created_at).toLocaleDateString('fr-FR') : '';
    const otherLists = allWishlists.filter(l => l.id !== item.wishlist_id);
    const busy = wishlistDetailBusy;

    const imageHtml = item.image
        ? `<img src="${item.image}" alt="${escapeHtml(item.name)}" class="wishlist-detail-image" onerror="this.outerHTML='<div class=&quot;no-image-placeholder modal-size&quot;><i class=&quot;ti ti-photo-off&quot; aria-hidden=&quot;true&quot;></i></div>'">`
        : `<div class="no-image-placeholder modal-size"><i class="ti ti-photo-off" aria-hidden="true"></i></div>`;

    const seriesLogoHtml = item.series_logo
        ? `<img src="${item.series_logo}" class="wishlist-detail-series-logo" alt="" onerror="this.parentElement.classList.add('no-logo')">`
        : `<span class="wishlist-detail-series-logo-fallback"><i class="ti ti-tag" aria-hidden="true"></i></span>`;

    const listHtml = list
        ? `<span class="modal-pill wishlist-detail-list-pill" style="border-color:${list.color || '#8A93A6'}66; color:${list.color || '#8A93A6'};">${list.icon || '⭐'} ${escapeHtml(list.name)}</span>`
        : '';

    const acquisitionTriggerHtml = (!owned && !wishlistDetailAcquisitionOpen) ? `
        <button class="wishlist-detail-btn wishlist-detail-btn-primary" ${busy ? 'disabled' : ''} onclick="wishlistDetailOpenAcquisition()">
            <i class="ti ti-check" aria-hidden="true"></i>
            <span>Je l'ai !</span>
        </button>
    ` : '';

    const acquisitionPanelHtml = (!owned && wishlistDetailAcquisitionOpen) ? `
        <div class="wishlist-detail-acquisition-panel">
            <div class="wishlist-detail-acquisition-header">
                <div class="wishlist-detail-acquisition-title">Mode d'acquisition</div>
                <div class="wishlist-detail-acquisition-subtitle">Comment as-tu obtenu cette carte ?</div>
            </div>

            <div class="wishlist-detail-acquisition-choice">
                <button type="button" class="wishlist-detail-acquisition-choice-btn ${wishlistDetailAcquisitionType === 'achat' ? 'active' : ''}" ${busy ? 'disabled' : ''} onclick="wishlistDetailSetAcquisitionType('achat')">
                    <i class="ti ti-shopping-bag" aria-hidden="true"></i>
                    <span class="wishlist-detail-acquisition-choice-text">
                        <span class="wishlist-detail-acquisition-choice-title">Achetée</span>
                        <span class="wishlist-detail-acquisition-choice-sub">Achat à l'unité</span>
                    </span>
                </button>
                <button type="button" class="wishlist-detail-acquisition-choice-btn ${wishlistDetailAcquisitionType === 'pack' ? 'active' : ''}" ${busy ? 'disabled' : ''} onclick="wishlistDetailSetAcquisitionType('pack')">
                    <i class="ti ti-gift" aria-hidden="true"></i>
                    <span class="wishlist-detail-acquisition-choice-text">
                        <span class="wishlist-detail-acquisition-choice-title">Sortie de booster</span>
                    </span>
                </button>
            </div>

            ${wishlistDetailAcquisitionType === 'pack'
                ? '<p class="wishlist-detail-acquisition-hint">Aucun prix d\'achat individuel ne sera enregistré.</p>'
                : `
                <div class="wishlist-detail-acquisition-field">
                    <label for="wishlist-detail-acquisition-price">Prix d'achat</label>
                    <div class="wishlist-detail-acquisition-price-wrap">
                        <input type="number" id="wishlist-detail-acquisition-price" min="0" step="0.01" placeholder="optionnel" value="${escapeHtml(wishlistDetailAcquisitionPrice)}" ${busy ? 'disabled' : ''} oninput="wishlistDetailAcquisitionPrice = this.value">
                        <span class="wishlist-detail-acquisition-price-suffix">€</span>
                    </div>
                </div>
                `
            }

            <div class="wishlist-detail-acquisition-field">
                <label for="wishlist-detail-acquisition-date">Date d'acquisition</label>
                <input type="text" id="wishlist-detail-acquisition-date" placeholder="jj/mm/aaaa" ${busy ? 'disabled' : ''}>
            </div>

            <div class="wishlist-detail-acquisition-actions">
                <button class="wishlist-detail-acquisition-back" ${busy ? 'disabled' : ''} onclick="wishlistDetailCloseAcquisition()">
                    <i class="ti ti-arrow-left" aria-hidden="true"></i>
                    <span>Retour</span>
                </button>
                <button class="wishlist-detail-btn wishlist-detail-btn-primary" ${busy ? 'disabled' : ''} onclick="wishlistDetailConfirmAcquisition()">
                    ${busy ? '<span class="loading"></span>' : '<i class="ti ti-check" aria-hidden="true"></i>'}
                    <span>Ajouter à ma collection</span>
                </button>
            </div>
        </div>
    ` : '';

    const moveButtonHtml = otherLists.length === 0
        ? `
        <button class="wishlist-detail-btn wishlist-detail-btn-move" disabled>
            <i class="ti ti-arrow-right" aria-hidden="true"></i>
            <span>Déplacer</span>
        </button>
        `
        : `
        <button class="wishlist-detail-btn wishlist-detail-btn-move ${wishlistDetailMoveOpen ? 'active' : ''}" ${busy ? 'disabled' : ''} onclick="wishlistDetailToggleMove()">
            <i class="ti ti-arrow-right" aria-hidden="true"></i>
            <span>Déplacer</span>
        </button>
        `;

    const movePanelHtml = (otherLists.length > 0 && wishlistDetailMoveOpen) ? `
        <div class="wishlist-detail-move-panel">
            ${otherLists.map(l => `
                <button class="wishlist-detail-move-option" ${busy ? 'disabled' : ''} onclick="wishlistDetailMove(${l.id})">
                    <span class="wishlist-detail-move-option-icon">${l.icon || '⭐'}</span>
                    <span>${escapeHtml(l.name)}</span>
                    ${busy ? '<span class="loading"></span>' : ''}
                </button>
            `).join('')}
            <button class="wishlist-detail-move-cancel" ${busy ? 'disabled' : ''} onclick="wishlistDetailToggleMove()">Annuler</button>
        </div>
    ` : '';

    return `
        <button class="modal-close" onclick="closeWishlistItemDetail()"><i class="ti ti-x" aria-hidden="true"></i></button>
        <div class="wishlist-detail-scroll">
        <div class="wishlist-detail-layout">
            <div class="wishlist-detail-image-col">
                <div class="wishlist-detail-image-frame">
                    ${imageHtml}
                    ${owned ? '<div class="qty-badge wishlist-thumb-owned-flag wishlist-detail-owned-flag"><i class="ti ti-check" aria-hidden="true"></i> Déjà possédée</div>' : ''}
                </div>
            </div>
            <div class="wishlist-detail-info-col">

                <div class="wishlist-detail-section wishlist-detail-identity">
                    <div class="modal-title-row">
                        <div class="modal-title">${escapeHtml(item.name)}</div>
                    </div>
                    <div class="wishlist-detail-series-row">
                        ${seriesLogoHtml}
                        <span class="wishlist-detail-series-text">${escapeHtml(item.series)} · #${escapeHtml(item.number)}</span>
                    </div>
                    <div class="modal-badges">
                        ${item.rarity ? `<span class="modal-pill rarity-pill">${escapeHtml(item.rarity)}</span>` : ''}
                        ${listHtml}
                    </div>
                </div>

                <div class="wishlist-detail-divider"></div>

                <div class="wishlist-detail-section wishlist-detail-status">
                    <div class="wishlist-detail-status-row">
                        <span class="wishlist-detail-status-label">Ajoutée le</span>
                        <span class="wishlist-detail-status-value">${addedDate || '—'}</span>
                    </div>
                    <div class="wishlist-detail-status-row">
                        <span class="wishlist-detail-status-label">Statut</span>
                        <span class="wishlist-detail-status-value ${owned ? 'is-owned' : ''}">${owned ? 'Déjà possédée' : 'Non possédée'}</span>
                    </div>
                </div>

                <div class="wishlist-detail-divider"></div>

                <div class="wishlist-detail-section wishlist-detail-value-actions">
                    <div class="wishlist-detail-price-block">
                        <div class="modal-value-label">Prix marché</div>
                        <div class="wishlist-detail-price">${price > 0 ? price.toFixed(2).replace('.', ',') + '€' : 'Non disponible'}</div>
                    </div>

                    <div class="wishlist-detail-actions">
                        ${acquisitionTriggerHtml}
                        ${acquisitionPanelHtml}
                        ${wishlistDetailAcquisitionOpen ? '' : `
                        <div class="wishlist-detail-actions-secondary">
                            <a href="${getCardmarketUrl(item.cardmarket_id, item.name)}" target="_blank" rel="noopener noreferrer" class="wishlist-detail-btn wishlist-detail-btn-cardmarket">
                                <i class="ti ti-external-link" aria-hidden="true"></i>
                                <span>Cardmarket</span>
                            </a>
                            ${moveButtonHtml}
                        </div>
                        ${movePanelHtml}
                        <button class="wishlist-detail-remove-link" ${busy ? 'disabled' : ''} onclick="wishlistDetailRemove()">
                            ${busy ? '<span class="loading"></span> Suppression...' : 'Retirer de cette liste'}
                        </button>
                        `}
                    </div>
                </div>

            </div>
        </div>
        </div>
    `;
}

// ===== Exports window (ticket V2 Vite, type="module") =====
// Les déclarations top-level d'un module ES ne s'attachent plus automatiquement à window
// (contrairement à un <script> classique) : réexport explicite pour que les autres scripts
// (chargés en modules indépendants, sans import/export entre eux, scope global inchangé)
// puissent continuer à référencer ces noms tels quels — y compris depuis des onclick="..."
// inline dans du HTML généré. Liste exhaustive des déclarations top-level de ce fichier
// (hors variables déjà passées en window.x = ... directement à leur déclaration, cf audit
// du 2026-08-14 sur l'état mutable partagé entre fichiers).
window.wishlistDetailScrollLocked = wishlistDetailScrollLocked;
window.wishlistDetailPrevBodyOverflow = wishlistDetailPrevBodyOverflow;
window.wishlistDetailCurrentItemId = wishlistDetailCurrentItemId;
window.wishlistDetailMoveOpen = wishlistDetailMoveOpen;
window.wishlistDetailBusy = wishlistDetailBusy;
window.wishlistDetailAcquisitionOpen = wishlistDetailAcquisitionOpen;
window.wishlistDetailAcquisitionType = wishlistDetailAcquisitionType;
window.wishlistDetailAcquisitionPrice = wishlistDetailAcquisitionPrice;
window.wishlistDetailAcquisitionDate = wishlistDetailAcquisitionDate;
window.wishlistDetailTodayIso = wishlistDetailTodayIso;
window.openWishlistItemDetail = openWishlistItemDetail;
window.closeWishlistItemDetail = closeWishlistItemDetail;
window.refreshWishlistItemDetail = refreshWishlistItemDetail;
window.destroyWishlistDetailAcquisitionDatePicker = destroyWishlistDetailAcquisitionDatePicker;
window.renderWishlistItemDetail = renderWishlistItemDetail;
window.lockBodyScrollForWishlistDetail = lockBodyScrollForWishlistDetail;
window.unlockBodyScrollForWishlistDetail = unlockBodyScrollForWishlistDetail;
window.wishlistDetailOpenAcquisition = wishlistDetailOpenAcquisition;
window.wishlistDetailCloseAcquisition = wishlistDetailCloseAcquisition;
window.wishlistDetailSetAcquisitionType = wishlistDetailSetAcquisitionType;
window.wishlistDetailConfirmAcquisition = wishlistDetailConfirmAcquisition;
window.wishlistDetailToggleMove = wishlistDetailToggleMove;
window.wishlistDetailMove = wishlistDetailMove;
window.wishlistDetailRemove = wishlistDetailRemove;
window.buildWishlistDetailHtml = buildWishlistDetailHtml;
