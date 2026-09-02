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

// Origine de la fiche Wishlist actuellement ouverte (VT3, cf roadmap technique animations premium),
// même principe minimal que cardDetailOrigin (modules/card-detail.js) : seulement l'id d'item +
// l'id du conteneur d'où le clic est parti, jamais une référence DOM gardée pendant l'ouverture - la
// carte source est retrouvée dans le DOM réel au moment de la fermeture, pas avant. Un seul wrapper
// possible ici (pas de mode Galerie/Classeur/Récap côté Wishlist), donc pas de liste à étendre.
let wishlistDetailOrigin = null;
const WISHLIST_DETAIL_ORIGIN_CONTAINER_SELECTOR = '#wishlists-container';

// VT3 (cf roadmap technique animations premium) : morph carte -> détail réutilise l'infrastructure
// VT1 (runCardDetailMorphTransition, modules/card-grid-renderer.js) telle quelle, avec un résolveur
// d'image dédié (#wishlist-detail-overlay .wishlist-detail-image, pas .modal-image comme la fiche
// carte standard) - la Wishlist garde son overlay et sa logique métier propres, seule la mécanique de
// transition est partagée. Nom de transition partagé ('card-detail-morph', inchangé dans le helper) :
// sans risque, les overlays fiche carte / fiche Wishlist ne sont jamais actifs en même temps.
function openWishlistItemDetail(itemId, event) {
    const item = allWishlistItems.find(i => i.id === itemId);
    if (!item) {
        showMessage('Cette carte n\'est plus dans ta wishlist', 'error');
        return;
    }

    const originContainer = event?.currentTarget?.closest(WISHLIST_DETAIL_ORIGIN_CONTAINER_SELECTOR);
    wishlistDetailOrigin = originContainer ? { itemId, containerId: originContainer.id } : null;

    wishlistDetailCurrentItemId = itemId;
    wishlistDetailMoveOpen = false;
    wishlistDetailBusy = false;
    wishlistDetailAcquisitionOpen = false;
    wishlistDetailAcquisitionType = 'achat';
    wishlistDetailAcquisitionPrice = '';
    wishlistDetailAcquisitionDate = wishlistDetailTodayIso();

    runCardDetailMorphTransition(
        event,
        () => {
            renderWishlistItemDetail(item);
            document.getElementById('wishlist-detail-overlay').classList.add('active');
            lockBodyScrollForWishlistDetail();
        },
        () => document.querySelector('#wishlist-detail-overlay.active .wishlist-detail-image')
    );
}

// Retrouve la vignette source réellement VISIBLE (pas seulement présente dans le DOM - une liste
// Wishlist repliée, cf toggleWishlistSection, garde son contenu en mémoire DOM sans être visible).
// Même principe que findVisibleCardDetailSource (modules/card-detail.js) : offsetParent suffit, pas
// besoin de getComputedStyle.
function findVisibleWishlistDetailSource(containerId, itemId) {
    const container = document.getElementById(containerId);
    if (!container || container.offsetParent === null) return null;
    const el = container.querySelector(`[data-wishlist-item-id="${itemId}"]`);
    if (!el || el.offsetParent === null) return null;
    return el;
}

// VT3 (cf roadmap technique animations premium) : fermeture symétrique à l'ouverture quand la
// vignette source est encore visible dans la liste - même principe que closeCardDetail
// (modules/card-detail.js). Si la source a disparu (liste repliée, item retiré/déplacé, recherche
// filtrée) : fermeture instantanée normale, jamais de morph forcé vers une destination inexistante.
function closeWishlistItemDetail() {
    const overlay = document.getElementById('wishlist-detail-overlay');
    if (!overlay || !overlay.classList.contains('active')) {
        wishlistDetailOrigin = null;
        return;
    }

    const finishClose = () => {
        unlockBodyScrollForWishlistDetail();
        destroyWishlistDetailAcquisitionDatePicker();
        wishlistDetailCurrentItemId = null;
        wishlistDetailMoveOpen = false;
        wishlistDetailBusy = false;
        wishlistDetailAcquisitionOpen = false;
    };

    const origin = wishlistDetailOrigin;
    wishlistDetailOrigin = null;

    const sourceEl = origin ? findVisibleWishlistDetailSource(origin.containerId, origin.itemId) : null;
    const sourceImg = sourceEl ? sourceEl.querySelector('img') : null;
    const modalImg = overlay.querySelector('.wishlist-detail-image');
    // Desactive sur mobile, symetrique a runCardDetailMorphTransition (card-grid-renderer.js) : sans
    // ce garde-fou, la fermeture (swipe ou croix) gardait le morph inverse alors que l'ouverture ne
    // l'a plus - signale par l'utilisateur ("la carte qui retourne a son emplacement" au swipe).
    const isMobile = window.matchMedia('(max-width: 768px)').matches;

    if (!sourceImg || !modalImg || typeof document.startViewTransition !== 'function' || isMobile) {
        overlay.classList.remove('active');
        finishClose();
        return;
    }

    modalImg.style.viewTransitionName = 'card-detail-morph';

    const cleanup = () => {
        modalImg.style.viewTransitionName = '';
        sourceImg.style.viewTransitionName = '';
    };

    const transition = runViewTransition('card-detail', () => {
        overlay.classList.remove('active');
        finishClose();
        modalImg.style.viewTransitionName = '';
        sourceImg.style.viewTransitionName = 'card-detail-morph';
    });

    if (!transition) {
        // reduced-motion : runViewTransition a déjà fermé l'overlay en synchrone, rien d'autre à
        // faire que de retirer les noms posés avant de le savoir.
        cleanup();
        return;
    }

    transition.finished.finally(cleanup);
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
    initHoloDetailEffect(document.getElementById('wishlist-detail-image-holo'));
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
    // P2-4 : même signal que les vignettes de liste (wishlist.js), texte complet ici où la place ne
    // manque pas — jamais affiché sur une carte déjà obtenue.
    const priceSignal = !owned ? wishlistPriceSignalMap[item.tcgdex_id] : null;
    const addedDate = item.created_at ? new Date(item.created_at).toLocaleDateString('fr-FR') : '';
    const otherLists = allWishlists.filter(l => l.id !== item.wishlist_id);
    const busy = wishlistDetailBusy;

    const imageHtml = item.image
        ? `<div class="modal-image-holo" id="wishlist-detail-image-holo">
            <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" class="wishlist-detail-image" onerror="this.outerHTML='<div class=&quot;no-image-placeholder modal-size&quot;><i class=&quot;ti ti-photo-off&quot; aria-hidden=&quot;true&quot;></i></div>'">
            <div class="collection-card-holo-sheen"></div>
            <div class="collection-card-holo-glare"></div>
           </div>`
        : `<div class="no-image-placeholder modal-size"><i class="ti ti-photo-off" aria-hidden="true"></i></div>`;

    const seriesLogoUrl = item.series_logo || getSeriesLogoUrl(item.tcgdex_id);
    const seriesSealHtml = seriesLogoUrl
        ? `<img src="${escapeHtml(seriesLogoUrl)}" class="modal-series-seal" alt="" onerror="handleSealLogoError(this)">`
        : '';

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
                    ${seriesSealHtml}
                    ${owned ? '<div class="qty-badge wishlist-thumb-owned-flag wishlist-detail-owned-flag"><i class="ti ti-check" aria-hidden="true"></i> Déjà possédée</div>' : ''}
                </div>
            </div>
            <div class="wishlist-detail-info-col">

                <div class="wishlist-detail-section wishlist-detail-identity">
                    <div class="modal-title-row">
                        <div class="modal-title">${escapeHtml(item.name)}</div>
                    </div>
                    <div class="wishlist-detail-series-row">
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
                        <div class="wishlist-detail-price">${price > 0 ? formatPrice(price) : 'Non disponible'}</div>
                        ${priceSignal ? `<div class="wishlist-detail-price-signal price-signal-${priceSignal.type}"><i class="ti ti-arrow-${priceSignal.type === 'low' ? 'down' : 'up'}" aria-hidden="true"></i> ${escapeHtml(priceSignal.wording)}</div>` : ''}
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
