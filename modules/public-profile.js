// Profil public (Phase 3) - Pokémon Tracker
// Dépend de: supabaseClient (tracker.js), escapeHtml/sortRaritiesByTier/buildRarityFilterRowHtml/
// getRarityGroupKey/getRarityIconHtml/renderFinishBadge/getTypesIconsHtml/getCardmarketUrl (utils.js),
// getGridNoImageHtml/getDuplicateCardsWithQuantity (collection.js) — réutilisés en lecture seule
// (générateurs HTML purs / calcul pur). getDuplicateCardsWithQuantity applique la même définition
// métier du doublon que le filtre "Doublons" de la Collection propriétaire (aucune donnée SQL
// supplémentaire, aucune nouvelle notion "à l'échange" persistée, cf audit du 2026-08-12) pour la
// section "Doublons à l'échange" et le match associé. cardmarket_id exposé par
// get_cards_public/get_wishlist_items_public depuis 2026-08-09
// (sql/migrations/2026-08-09_public_surfaces_cardmarket_id.sql). computeWishlistMatch (Ticket 2,
// modules/collector-match.js, module pur sans effet de bord) pour le bloc "Correspondances avec toi".
// Route #/user/<username>, gérée par getTabIdFromHash()/activateTabContent() dans tracker.js (tabId
// "tab-user-profile"). Lecture seule stricte : n'interroge jamais cards/wishlist/wishlists directement,
// uniquement la vue profiles_public et les fonctions get_cards_public/get_wishlists_public/
// get_wishlist_items_public validées en Phase 2 (RLS + colonnes explicitement limitées côté SQL).
// Exception assumée : card_price_history est lue en direct (comme modules/wishlist.js le fait déjà côté
// propriétaire) — ce n'est pas une table privée, aucune colonne user_id, cache de prix partagé.
// Etat dédié à cette vue, jamais écrit depuis les globals personnels (allCollectionCards/allWishlists/
// allWishlistItems, cf tracker.js/wishlist.js) : les données publiques affichées ici (viewedPublicCards/
// viewedPublicWishlistItems/...) appartiennent à un autre utilisateur, les mélanger à l'état personnel
// serait une vraie fuite de confiance au moindre bug. Seule exception volontaire (Ticket 2) :
// profileMatchesA/B LISENT allWishlistItems/allCollectionCards (déjà garantis chargés au moment de
// loadPublicProfile, cf init() dans modules/auth.js) en lecture seule, jamais écrits depuis ce fichier,
// et currentUserProfile (modules/profile.js) pour détecter la consultation de son propre profil.
// Etat possédé : viewedPublicProfile, viewedPublicCards, publicCollectionSort, publicCollectionRarityFilterValues,
// profileMatchesA, profileMatchesB, profileMatchDetailExpanded

let viewedPublicProfile = null;

// Collection publique tierce (lecture seule). Jamais lu/écrit dans allCollectionCards : source unique
// = get_cards_public(owner_id), déjà appelé une fois dans loadPublicProfile() pour les stats d'en-tête,
// son résultat est conservé ici plutôt que requêté une seconde fois pour la grille.
let viewedPublicCards = [];
let publicCollectionSort = 'value-desc';
let publicCollectionRarityFilterValues = new Set();

// Wishlist publique tierce (lecture seule). Sources : get_wishlists_public/get_wishlist_items_public
// (Phase 2). viewedPublicWishlistPriceMap vient de card_price_history en lecture directe : ce n'est
// PAS une table privée (pas de colonne user_id, cache de prix marché partagé entre tous les comptes,
// cf. modules/wishlist.js:loadWishlistPrices qui fait exactement la même chose côté propriétaire) —
// aucune donnée liée à un utilisateur particulier n'y est lue.
let viewedPublicWishlists = [];
let viewedPublicWishlistItems = [];
let viewedPublicWishlistPriceMap = {};
let viewedPublicWishlistExpandedIds = new Set();

// Correspondances Wishlist/Collection (Ticket 2, modules/collector-match.js) — dérivées à 100% de
// globals déjà chargés (allWishlistItems/allCollectionCards, cf tracker.js/modules/auth.js:init())
// et des données publiques ci-dessus, aucune requête dédiée. profileMatchesA = ma wishlist trouvée
// dans sa collection ; profileMatchesB = sa wishlist trouvée dans ma collection.
let profileMatchesA = [];
let profileMatchesB = [];
let profileMatchDetailExpanded = false;

// Doublons à l'échange (V1 simplifiée, cf audit du 2026-08-12) : dérivés à 100% de viewedPublicCards
// via getDuplicateCardsWithQuantity (modules/collection.js, même définition métier que le filtre
// "Doublons" de la Collection propriétaire — pas de deuxième définition). Aucune donnée persistée,
// aucune requête dédiée. profileDuplicateMatches = doublons du profil consulté qui sont dans MA
// wishlist (allWishlistItems), calculé via computeWishlistMatch existant (modules/collector-match.js)
// en substituant quantity par duplicateQuantity — le principe "1 exemplaire principal + N doublons"
// s'applique aussi au matching (cf audit : 3 possédées = 2 potentiellement échangeables, pas 3).
let viewedPublicDuplicateCards = [];
let profileDuplicateMatches = [];

// Raretés jamais retenues comme "doublon à l'échange" (trop communes pour être un vrai signal
// d'échange, cf demande utilisateur du 2026-08-12) : Commune, Peu commune, Holo (rare de base).
// Comparaison par clé de groupe (getRarityGroupKey, utils.js) plutôt que par texte brut : couvre
// toutes les variantes de libellé TCGdex d'une même rareté (ex "Rare Holo"/"Holo Rare"/"Holographique"
// -> même groupe holo.webp). N'affecte QUE cette section et son matching : le filtre "Doublons" de la
// Collection propriétaire (modules/collection.js, getDuplicateCardsWithQuantity) reste inchangé et
// sans notion d'exclusion — l'exclusion est appliquée ici, en amont, sur les données déjà chargées.
const DUPLICATE_SECTION_EXCLUDED_RARITY_GROUPS = new Set(['commune.webp', 'peu-commune.webp', 'holo.webp']);

function getPublicDuplicateEligibleCards(cards) {
    return (cards || []).filter(c => !DUPLICATE_SECTION_EXCLUDED_RARITY_GROUPS.has(getRarityGroupKey(c.rarity)));
}

// Id (viewedPublicCards) de la carte actuellement affichée dans la fiche détail publique, pour pouvoir
// rafraîchir uniquement son bouton "Ajouter à ma wishlist" après un ajout (cf. addPublicCardToWishlistInternal,
// modules/wishlist.js) sans re-render de toute la grille/du profil.
let publicCardDetailOpenId = null;

function getUsernameFromHash() {
    const route = window.location.hash.replace('#', '');
    if (!route.startsWith('/user/')) return null;
    const raw = route.slice('/user/'.length);
    try { return decodeURIComponent(raw); } catch { return raw; }
}

// Echappe les caractères spéciaux ILIKE (% _ \) : un username saisi directement dans l'URL par un
// visiteur ne doit jamais pouvoir agir comme joker de recherche lors de la résolution.
function escapePublicUsernameIlike(value) {
    return value.replace(/[%_\\]/g, '\\$&');
}

function formatPublicMemberSince(dateInput) {
    if (!dateInput) return '';
    const date = new Date(dateInput);
    return `Collectionneur depuis ${date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}`;
}

function renderPublicProfileNotFound(container) {
    container.innerHTML = `
        <div class="user-profile-notfound">
            <i class="ti ti-user-question" aria-hidden="true"></i>
            <p>Profil introuvable ou privé</p>
        </div>
    `;
}

async function loadPublicProfile(username) {
    const container = document.getElementById('user-profile-content');
    if (!container) return;

    viewedPublicProfile = null;
    viewedPublicCards = [];
    publicCollectionSort = 'value-desc';
    publicCollectionRarityFilterValues = new Set();
    viewedPublicWishlists = [];
    viewedPublicWishlistItems = [];
    viewedPublicWishlistPriceMap = {};
    viewedPublicWishlistExpandedIds = new Set();
    profileMatchesA = [];
    profileMatchesB = [];
    profileMatchDetailExpanded = false;
    viewedPublicDuplicateCards = [];
    profileDuplicateMatches = [];

    if (!username) {
        renderPublicProfileNotFound(container);
        return;
    }

    container.innerHTML = '<p class="dashboard-empty-text" style="padding:3rem 0; text-align:center;">Chargement...</p>';

    const { data: profile, error } = await supabaseClient
        .from('profiles_public')
        .select('id, username, pseudo, avatar_url, created_at, is_public, collection_visible, wishlist_visible')
        .ilike('username', escapePublicUsernameIlike(username))
        .maybeSingle();

    // Navigation vers une autre route/un autre profil pendant le chargement : ce résultat est obsolète
    if (getUsernameFromHash() !== username) return;

    if (error || !profile) {
        renderPublicProfileNotFound(container);
        return;
    }

    let cardCount = 0;
    let collectionValue = 0;
    if (profile.collection_visible) {
        const { data: cards } = await supabaseClient.rpc('get_cards_public', { p_user_id: profile.id });
        if (cards) {
            viewedPublicCards = cards;
            cardCount = cards.reduce((sum, c) => sum + Number(c.quantity || 0), 0);
            collectionValue = cards.reduce((sum, c) => sum + Number(c.quantity || 0) * Number(c.market_value || 0), 0);
            viewedPublicDuplicateCards = getDuplicateCardsWithQuantity(getPublicDuplicateEligibleCards(viewedPublicCards));
        }
    }

    let wishlistCount = 0;
    if (profile.wishlist_visible) {
        await loadPublicWishlistData(profile.id);
        wishlistCount = viewedPublicWishlistItems.length;
    }

    if (getUsernameFromHash() !== username) return;

    // Jamais pour son propre profil public (comparaison avec soi-même n'a aucun sens) : currentUserProfile
    // (modules/profile.js) est déjà chargé à ce stade (loadUserProfile() awaité avant tout dans init()).
    const isSelf = currentUserProfile && currentUserProfile.id === profile.id;
    if (!isSelf) {
        if (profile.collection_visible) {
            profileMatchesA = computeWishlistMatch(allWishlistItems, viewedPublicCards);
            // quantity substituée par duplicateQuantity (surplus au-delà de l'exemplaire principal) :
            // computeWishlistMatch ne lit que .quantity, aucune modification de cette fonction requise.
            profileDuplicateMatches = computeWishlistMatch(
                allWishlistItems,
                viewedPublicDuplicateCards.map(c => ({ ...c, quantity: c.duplicateQuantity }))
            );
        }
        if (profile.wishlist_visible) {
            profileMatchesB = computeWishlistMatch(viewedPublicWishlistItems, allCollectionCards);
        }
    }

    viewedPublicProfile = { ...profile, cardCount, collectionValue, wishlistCount };
    renderPublicProfileShell(container, viewedPublicProfile);
}

async function loadPublicWishlistData(ownerId) {
    const [{ data: lists }, { data: items }] = await Promise.all([
        supabaseClient.rpc('get_wishlists_public', { p_user_id: ownerId }),
        supabaseClient.rpc('get_wishlist_items_public', { p_user_id: ownerId })
    ]);
    viewedPublicWishlists = lists || [];
    viewedPublicWishlistItems = items || [];

    if (viewedPublicWishlists.length > 0) {
        viewedPublicWishlistExpandedIds.add(viewedPublicWishlists[0].id);
    }

    await loadPublicWishlistPrices();
}

// Lecture directe de card_price_history : table partagée, pas de colonne user_id, mêmes garanties
// que loadWishlistPrices() (modules/wishlist.js) côté propriétaire — pas une exception de sécurité.
async function loadPublicWishlistPrices() {
    viewedPublicWishlistPriceMap = {};
    const uniqueIds = [...new Set(viewedPublicWishlistItems.filter(i => i.tcgdex_id).map(i => i.tcgdex_id))];
    if (uniqueIds.length === 0) return;

    const { data, error } = await supabaseClient
        .from('card_price_history')
        .select('tcgdex_id, market_value, recorded_at')
        .in('tcgdex_id', uniqueIds)
        .order('recorded_at', { ascending: false });

    if (error || !data) return;

    data.forEach(row => {
        if (!(row.tcgdex_id in viewedPublicWishlistPriceMap)) {
            viewedPublicWishlistPriceMap[row.tcgdex_id] = Number(row.market_value) || 0;
        }
    });
}

function renderPublicProfileShell(container, profile) {
    // Même raison qu'ailleurs (profile.js) : avatar_url est un champ contrôlable par l'utilisateur
    // consulté, jamais faire confiance à sa valeur brute dans un attribut HTML.
    const avatarHtml = profile.avatar_url
        ? `<img src="${escapeHtml(profile.avatar_url)}" alt="" class="user-profile-avatar">`
        : `<span class="user-profile-avatar user-profile-avatar-fallback"><i class="ti ti-user" aria-hidden="true"></i></span>`;

    container.innerHTML = `
        <div class="user-profile-header">
            ${avatarHtml}
            <div class="user-profile-identity">
                <div class="user-profile-pseudo">${escapeHtml(profile.pseudo || profile.username)}</div>
                <div class="user-profile-username">@${escapeHtml(profile.username)}</div>
                ${profile.created_at ? `<div class="user-profile-member-since">${formatPublicMemberSince(profile.created_at)}</div>` : ''}
            </div>
        </div>

        <div class="user-profile-stats">
            ${profile.collection_visible ? `
                <div class="user-profile-stat">
                    <div class="user-profile-stat-value">${profile.cardCount}</div>
                    <div class="user-profile-stat-label">Cartes</div>
                </div>
                <div class="user-profile-stat">
                    <div class="user-profile-stat-value">${profile.collectionValue.toFixed(2)} €</div>
                    <div class="user-profile-stat-label">Valeur collection</div>
                </div>
            ` : ''}
            ${profile.wishlist_visible ? `
                <div class="user-profile-stat">
                    <div class="user-profile-stat-value">${profile.wishlistCount}</div>
                    <div class="user-profile-stat-label">Souhaits</div>
                </div>
            ` : ''}
        </div>

        ${renderProfileMatchSection(profile)}

        <div class="user-profile-sections">
            ${!profile.collection_visible ? `
                <div class="user-profile-section">
                    <div class="user-profile-section-title"><i class="ti ti-cards" aria-hidden="true"></i> Collection</div>
                    <p class="user-profile-section-placeholder user-profile-section-locked"><i class="ti ti-lock" aria-hidden="true"></i> Collection privée</p>
                </div>
            ` : ''}
            ${!profile.wishlist_visible ? `
                <div class="user-profile-section">
                    <div class="user-profile-section-title"><i class="ti ti-star" aria-hidden="true"></i> Wishlist</div>
                    <p class="user-profile-section-placeholder user-profile-section-locked"><i class="ti ti-lock" aria-hidden="true"></i> Wishlist privée</p>
                </div>
            ` : ''}
        </div>

        ${profile.wishlist_visible ? `
            <div class="user-profile-section user-profile-wishlist-browser">
                <div class="user-profile-section-title"><i class="ti ti-star" aria-hidden="true"></i> Wishlist</div>
                <div id="public-wishlist-lists"></div>
            </div>
        ` : ''}

        ${(profile.collection_visible && viewedPublicDuplicateCards.length > 0) ? `
            <div class="user-profile-section user-profile-duplicates-browser">
                <div class="user-profile-section-title"><i class="ti ti-copy" aria-hidden="true"></i> Doublons à l'échange</div>
                <div class="collection-display-case">
                    <div class="collection-grid">${renderPublicDuplicateCardsHtml()}</div>
                </div>
            </div>
        ` : ''}

        ${profile.collection_visible ? `
            <div class="user-profile-section user-profile-collection-browser">
                <div class="user-profile-section-title"><i class="ti ti-cards" aria-hidden="true"></i> Collection</div>
                <div class="catalogue-toolbar">
                    <div class="input-with-icon">
                        <i class="ti ti-search" aria-hidden="true"></i>
                        <input type="text" id="public-collection-search" placeholder="Rechercher..." oninput="renderPublicCollectionGrid()">
                    </div>
                    <div class="catalogue-toolbar-actions">
                        <select id="public-collection-series-filter" onchange="renderPublicCollectionGrid()">
                            <option value="">Toutes les séries</option>
                        </select>
                        <select class="catalogue-sort-select" onchange="setPublicCollectionSort(this.value)">
                            <option value="value-desc">Trier : Valeur (haut → bas)</option>
                            <option value="value-asc">Trier : Valeur (bas → haut)</option>
                            <option value="name-asc">Trier : Nom (A → Z)</option>
                            <option value="series-asc">Trier : Série (A → Z)</option>
                        </select>
                    </div>
                </div>
                <div class="rarity-filter-row" id="public-collection-rarity-row"></div>
                <div class="collection-display-case">
                    <div class="collection-grid" id="public-collection-grid"></div>
                </div>
            </div>
        ` : ''}
    `;

    if (profile.collection_visible) {
        populatePublicCollectionSeriesFilter();
        renderPublicCollectionRarityRow();
        renderPublicCollectionGrid();
    }

    if (profile.wishlist_visible) {
        renderPublicWishlistLists();
    }
}

// Bloc "Correspondances avec toi" (Ticket 2, s'appuie sur modules/collector-match.js). Wording
// volontairement neutre sur la quantité : "possédée en plusieurs exemplaires" ne dit jamais que le
// propriétaire souhaite s'en séparer, cf audit. Retourne '' (rien affiché) si aucune ligne pertinente
// (isSelf déjà filtré en amont via profileMatchesA/B laissés vides dans loadPublicProfile).
function renderProfileMatchSection(profile) {
    const summaryLines = [];

    // Match prioritaire (V1 doublons, cf audit du 2026-08-12) : placé en tête, wording explicite sur
    // l'actionnabilité réelle ("ses doublons", pas juste "sa collection"). Remplace la sous-ligne
    // "possédée en plusieurs exemplaires" de profileMatchesA ci-dessous (même signal, devenu redondant
    // maintenant qu'il existe une version précise) sans retirer la ligne principale de profileMatchesA,
    // qui reste utile même hors doublon (carte possédée en un seul exemplaire, toujours pas échangeable
    // mais toujours une info valide "il l'a").
    if (profileDuplicateMatches.length > 0) {
        const n = profileDuplicateMatches.length;
        summaryLines.push(`${n} de ses doublon${n > 1 ? 's' : ''} correspond${n > 1 ? 'ent' : ''} à ta wishlist`);
    }

    if (profileMatchesA.length > 0) {
        const n = profileMatchesA.length;
        summaryLines.push(`${n} carte${n > 1 ? 's' : ''} de ta wishlist ${n > 1 ? 'sont' : 'est'} dans sa collection`);
    }

    if (profileMatchesB.length > 0) {
        const n = profileMatchesB.length;
        summaryLines.push(`${n} carte${n > 1 ? 's' : ''} de sa wishlist ${n > 1 ? 'sont' : 'est'} dans ta collection`);
        const multipleB = profileMatchesB.filter(m => m.multiple).length;
        if (multipleB > 0) {
            summaryLines.push(`${multipleB} ${multipleB > 1 ? 'sont' : 'est'} présente${multipleB > 1 ? 's' : ''} en plusieurs exemplaires chez toi`);
        }
    }

    if (summaryLines.length === 0) return ''; // rien d'exploitable : ni collection privée à tester, ni wishlist vide/privée n'ont produit de match

    const expanded = profileMatchDetailExpanded;

    const groupsHtml = `
        ${profileDuplicateMatches.length > 0 ? `
            <div class="user-profile-match-group">
                <div class="user-profile-match-group-title">Ses doublons qui t'intéressent</div>
                <div class="wishlist-thumb-grid">${profileDuplicateMatches.map(m => renderProfileMatchThumb(m, `showPublicCardDetail(${m.ownedCardId})`)).join('')}</div>
            </div>
        ` : ''}
        ${profileMatchesA.length > 0 ? `
            <div class="user-profile-match-group">
                <div class="user-profile-match-group-title">Dans ta wishlist</div>
                <div class="wishlist-thumb-grid">${profileMatchesA.map(m => renderProfileMatchThumb(m, `showPublicCardDetail(${m.ownedCardId})`)).join('')}</div>
            </div>
        ` : ''}
        ${profileMatchesB.length > 0 ? `
            <div class="user-profile-match-group">
                <div class="user-profile-match-group-title">Dans la wishlist de ${escapeHtml(profile.pseudo || profile.username)}</div>
                <div class="wishlist-thumb-grid">${profileMatchesB.map(m => renderProfileMatchThumb(m, `showPublicWishlistItemDetail(${m.wishlistItemId})`)).join('')}</div>
            </div>
        ` : ''}
    `;

    return `
        <div class="user-profile-section user-profile-match-section">
            <div class="user-profile-match-header" onclick="toggleProfileMatchDetail()">
                <div class="user-profile-section-title"><i class="ti ti-repeat" aria-hidden="true"></i> Correspondances avec toi</div>
                <i class="ti ti-chevron-right wishlist-chevron ${expanded ? 'expanded' : ''}" aria-hidden="true"></i>
            </div>
            <div class="user-profile-match-summary">
                ${summaryLines.map(line => `<p>${escapeHtml(line)}</p>`).join('')}
            </div>
            <div class="user-profile-match-detail" style="display:${expanded ? 'block' : 'none'};">
                ${groupsHtml}
            </div>
        </div>
    `;
}

// Miniature de carte matchée : réutilise les classes visuelles de la wishlist publique. Clic ->
// rouvre la même fiche détail publique que les sections Collection/Wishlist plus bas sur cette page
// (showPublicCardDetail/showPublicWishlistItemDetail, déjà en lecture seule, aucune fonction
// propriétaire) — jamais une troisième fiche détail dédiée.
function renderProfileMatchThumb(match, onclickExpr) {
    return `
        <div class="wishlist-thumb-wrap">
            <div class="collection-card wishlist-thumb-card" onclick="${onclickExpr}" title="${escapeHtml(match.name)}">
                ${match.image
                    ? `<img src="${match.image}" alt="${escapeHtml(match.name)}" loading="lazy" onerror="this.style.display='none'">`
                    : '<div class="collection-card-noimg"><i class="ti ti-photo-off" aria-hidden="true"></i></div>'
                }
                ${match.multiple ? `<div class="qty-badge" title="Possédée en plusieurs exemplaires">×${match.ownedQty}</div>` : ''}
                <div class="collection-card-overlay">
                    <div class="collection-card-name">${escapeHtml(match.name)}</div>
                    <div class="collection-card-set">${escapeHtml(match.series || '')}</div>
                </div>
            </div>
        </div>
    `;
}

// Bascule DOM pure (pas de re-fetch/re-render du shell entier) : aucun état propriétaire touché,
// juste l'affichage du détail déjà présent dans le DOM.
function toggleProfileMatchDetail() {
    profileMatchDetailExpanded = !profileMatchDetailExpanded;
    const detail = document.querySelector('.user-profile-match-detail');
    const chevron = document.querySelector('.user-profile-match-header .wishlist-chevron');
    if (detail) detail.style.display = profileMatchDetailExpanded ? 'block' : 'none';
    if (chevron) chevron.classList.toggle('expanded', profileMatchDetailExpanded);
}

function populatePublicCollectionSeriesFilter() {
    const select = document.getElementById('public-collection-series-filter');
    if (!select) return;
    const series = [...new Set(viewedPublicCards.map(c => c.series).filter(Boolean))].sort();
    select.innerHTML = '<option value="">Toutes les séries</option>' + series.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
}

function renderPublicCollectionRarityRow() {
    const row = document.getElementById('public-collection-rarity-row');
    if (!row) return;
    const rarities = sortRaritiesByTier([...new Set(viewedPublicCards.map(c => c.rarity).filter(Boolean))]);
    row.innerHTML = buildRarityFilterRowHtml(rarities, publicCollectionRarityFilterValues, 'setPublicCollectionRarityFilter', 20);
}

function setPublicCollectionRarityFilter(value) {
    if (value === '') {
        publicCollectionRarityFilterValues.clear();
    } else if (publicCollectionRarityFilterValues.has(value)) {
        publicCollectionRarityFilterValues.delete(value);
    } else {
        publicCollectionRarityFilterValues.add(value);
    }
    renderPublicCollectionRarityRow();
    renderPublicCollectionGrid();
}

function setPublicCollectionSort(value) {
    publicCollectionSort = value;
    renderPublicCollectionGrid();
}

function getFilteredSortedPublicCollection() {
    const searchTerm = (document.getElementById('public-collection-search')?.value || '').toLowerCase();
    const seriesFilter = document.getElementById('public-collection-series-filter')?.value || '';

    let filtered = viewedPublicCards;
    if (searchTerm) {
        filtered = filtered.filter(c =>
            (c.name || '').toLowerCase().includes(searchTerm) ||
            (c.series || '').toLowerCase().includes(searchTerm)
        );
    }
    if (seriesFilter) {
        filtered = filtered.filter(c => c.series === seriesFilter);
    }
    if (publicCollectionRarityFilterValues.size > 0) {
        filtered = filtered.filter(c => publicCollectionRarityFilterValues.has(getRarityGroupKey(c.rarity)));
    }

    const sorted = [...filtered];
    switch (publicCollectionSort) {
        case 'value-asc':
            sorted.sort((a, b) => (Number(a.market_value || 0) * Number(a.quantity || 1)) - (Number(b.market_value || 0) * Number(b.quantity || 1)));
            break;
        case 'name-asc':
            sorted.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'fr'));
            break;
        case 'series-asc':
            sorted.sort((a, b) => (a.series || '').localeCompare(b.series || '', 'fr'));
            break;
        case 'value-desc':
        default:
            sorted.sort((a, b) => (Number(b.market_value || 0) * Number(b.quantity || 1)) - (Number(a.market_value || 0) * Number(a.quantity || 1)));
    }
    return sorted;
}

// Section "Doublons à l'échange" (V1 simplifiée, cf audit du 2026-08-12). Même trame visuelle que
// renderPublicCollectionGrid (.collection-card, .price-badge, badges série/rareté) : aucune nouvelle
// fiche détail, clic -> showPublicCardDetail existant (card.id reste un id valide de viewedPublicCards,
// getDuplicateCardsWithQuantity ne fait que sélectionner une carte représentative par groupe). Le badge
// affiche duplicateQuantity (surplus au-delà de l'exemplaire principal), jamais quantity brute — cf audit
// "3 exemplaires = 2 doublons potentiels, pas 3".
function renderPublicDuplicateCardsHtml() {
    return viewedPublicDuplicateCards.map(card => {
        const lineTotal = Number(card.market_value || 0) * Number(card.quantity || 1);
        const conditionClass = (card.condition || '').toLowerCase();

        return `
            <div class="collection-card" onclick="showPublicCardDetail(${card.id})">
                ${card.image
                    ? `<img src="${card.image}" alt="${escapeHtml(card.name)}" loading="lazy" onerror="this.outerHTML=getGridNoImageHtml()">`
                    : getGridNoImageHtml()
                }
                <div class="qty-badge" title="Doublons disponibles">↔ ${card.duplicateQuantity}</div>
                <div class="price-badge">${lineTotal.toFixed(2)}€</div>
                <div class="set-rarity-badge-row">
                    ${card.series_symbol ? `<img src="${card.series_symbol}" class="set-symbol-badge" alt="" title="${escapeHtml(card.series)}" onerror="this.remove()">` : ''}
                    ${getRarityIconHtml(card.rarity) ? `<div class="rarity-badge-corner" title="${escapeHtml(card.rarity)}">${getRarityIconHtml(card.rarity, 18)}</div>` : ''}
                </div>
                <div class="collection-card-overlay">
                    <div class="collection-card-name">${escapeHtml(card.name)}</div>
                    <div class="collection-card-set">${card.series_logo ? `<img src="${card.series_logo}" class="series-logo-inline" alt="" onerror="this.remove()">` : ''}${escapeHtml(card.series)} · #${card.number}</div>
                    <span class="condition-badge-grid ${conditionClass}">${card.condition}</span>
                    ${renderFinishBadge(card.finish, 'condition-badge-grid finish-badge', 12)}
                </div>
            </div>
        `;
    }).join('');
}

// Réutilise les classes CSS de la grille personnelle (.collection-card, .qty-badge, .price-badge,
// .collection-card-overlay, ...) — purement visuelles, aucun couplage JS à allCollectionCards. Pas
// d'icône d'obtention (acquisition_type absent de get_cards_public, volontairement non exposé), pas de
// placeholder d'upload au clic (aucune écriture possible ici) : simple icône statique en cas d'erreur image.
function renderPublicCollectionGrid() {
    const grid = document.getElementById('public-collection-grid');
    if (!grid) return;

    const filtered = getFilteredSortedPublicCollection();

    if (filtered.length === 0) {
        grid.innerHTML = '<div class="collection-grid-empty"><i class="ti ti-search-off" aria-hidden="true"></i> Aucune carte trouvée</div>';
        return;
    }

    grid.innerHTML = filtered.map(card => {
        const qty = Number(card.quantity || 1);
        const lineTotal = Number(card.market_value || 0) * qty;
        const conditionClass = (card.condition || '').toLowerCase();

        return `
            <div class="collection-card" onclick="showPublicCardDetail(${card.id})">
                ${card.image
                    ? `<img src="${card.image}" alt="${escapeHtml(card.name)}" loading="lazy" onerror="this.outerHTML=getGridNoImageHtml()">`
                    : getGridNoImageHtml()
                }
                ${qty > 1 ? `<div class="qty-badge">×${qty}</div>` : ''}
                <div class="price-badge">${lineTotal.toFixed(2)}€</div>
                <div class="set-rarity-badge-row">
                    ${card.series_symbol ? `<img src="${card.series_symbol}" class="set-symbol-badge" alt="" title="${escapeHtml(card.series)}" onerror="this.remove()">` : ''}
                    ${getRarityIconHtml(card.rarity) ? `<div class="rarity-badge-corner" title="${escapeHtml(card.rarity)}">${getRarityIconHtml(card.rarity, 18)}</div>` : ''}
                </div>
                <div class="collection-card-overlay">
                    <div class="collection-card-name">${escapeHtml(card.name)}</div>
                    <div class="collection-card-set">${card.series_logo ? `<img src="${card.series_logo}" class="series-logo-inline" alt="" onerror="this.remove()">` : ''}${escapeHtml(card.series)} · #${card.number}</div>
                    <span class="condition-badge-grid ${conditionClass}">${card.condition}</span>
                    ${renderFinishBadge(card.finish, 'condition-badge-grid finish-badge', 12)}
                </div>
            </div>
        `;
    }).join('');
}

// Fiche détail carte publique : overlay/DOM dédiés (#public-card-detail-*, index.html), jamais
// #card-detail-overlay (fiche propriétaire) pour ne jamais mélanger les deux flux. Aucun bouton
// Modifier/Retirer, aucune quantité modifiable, aucun prix d'achat ni date d'acquisition (colonnes
// absentes de get_cards_public par construction) : uniquement ce que la fonction publique expose déjà.
function showPublicCardDetail(cardId) {
    const card = viewedPublicCards.find(c => c.id === cardId);
    if (!card) return;

    publicCardDetailOpenId = cardId;

    const qty = Number(card.quantity || 1);
    const marketValue = Number(card.market_value || 0);
    const lineTotal = marketValue * qty;
    const conditionClass = (card.condition || '').toLowerCase();
    const conditionLabels = { nm: 'Neuf', lp: 'Très bon', mp: 'Bon', hp: 'Mauvais état' };
    const conditionLabel = conditionLabels[conditionClass] || card.condition || '';
    // cardmarket_id désormais exposé par get_cards_public (2026-08-09) : lien produit exact quand
    // disponible, repli recherche par nom sinon — même fonction que la fiche propriétaire.
    const cardmarketUrl = getCardmarketUrl(card.cardmarket_id, card.name);

    // "Ajouter à ma wishlist" : jamais sur mon propre profil public (comparaison avec soi-même n'a pas
    // de sens, cf. isSelf plus haut dans loadPublicProfile), jamais si déjà présente dans MA wishlist
    // (détection simple par tcgdex_id sur allWishlistItems, modules/wishlist.js — mes données à moi,
    // aucune lecture des données du propriétaire consulté).
    const isOwnPublicProfile = !!(currentUserProfile && viewedPublicProfile && currentUserProfile.id === viewedPublicProfile.id);
    const alreadyInMyWishlist = !!(card.tcgdex_id && typeof allWishlistItems !== 'undefined' && allWishlistItems.some(i => i.tcgdex_id === card.tcgdex_id));

    const modalCard = document.getElementById('public-card-detail-card');
    if (!modalCard) return;

    modalCard.innerHTML = `
        <button class="modal-close" onclick="closePublicCardDetail()"><i class="ti ti-x" aria-hidden="true"></i></button>
        <div class="modal-scroll">
        <div class="modal-body">
            <div class="modal-image-wrap">
                <div class="modal-stand">
                    ${card.image
                        ? `<img src="${card.image}" alt="${escapeHtml(card.name)}" class="modal-image" onerror="this.outerHTML=getGridNoImageHtml()">`
                        : getGridNoImageHtml()
                    }
                </div>
            </div>
            <div class="modal-info">
                <div class="modal-main-col">
                    <div class="modal-title-row">
                        <div class="modal-title">${escapeHtml(card.name)}</div>
                    </div>
                    ${card.series_logo ? `<img src="${card.series_logo}" class="modal-series-logo" alt="" onerror="this.remove()">` : ''}
                    <div class="modal-subtitle">${escapeHtml(card.series)} · #${card.number}</div>

                    <div class="modal-badges">
                        <span class="modal-pill rarity-pill">${getRarityIconHtml(card.rarity, 14)} ${escapeHtml(card.rarity || 'N/A')}</span>
                        <span class="modal-pill condition-pill ${conditionClass}">${conditionLabel} (${card.condition})</span>
                        ${renderFinishBadge(card.finish, 'modal-pill finish-pill', 14)}
                    </div>

                    <div class="modal-value-block">
                        <div class="modal-value-label">Valeur estimée</div>
                        <div class="modal-value-row">
                            <span class="modal-price">${marketValue.toFixed(2).replace('.', ',')}€</span>
                        </div>
                        ${qty > 1 ? `<div class="modal-price-total">Valeur totale : ${lineTotal.toFixed(2).replace('.', ',')}€ (×${qty})</div>` : ''}
                    </div>

                    <div class="modal-meta-actions-row">
                        <div class="modal-meta-list">
                            ${card.type && card.type !== 'N/A' ? `<div class="modal-meta-row"><span class="modal-meta-key">${getTypesIconsHtml(card.type, 20)} Type</span><span class="modal-meta-val">${escapeHtml(card.type)}</span></div>` : ''}
                            <div class="modal-meta-row"><span class="modal-meta-key"><i class="ti ti-stack-2" aria-hidden="true"></i> Quantité</span><span class="modal-meta-val">${qty}</span></div>
                            <div class="modal-meta-row"><span class="modal-meta-key"><i class="ti ti-hash" aria-hidden="true"></i> Numéro</span><span class="modal-meta-val">${card.number}</span></div>
                            ${card.illustrator ? `<div class="modal-meta-row"><span class="modal-meta-key"><i class="ti ti-user" aria-hidden="true"></i> Illustrateur</span><span class="modal-meta-val">${escapeHtml(card.illustrator)}</span></div>` : ''}
                        </div>

                        <div class="modal-actions-col">
                            ${!isOwnPublicProfile ? `
                                <button type="button" class="modal-action-row public-wishlist-add-btn" ${alreadyInMyWishlist ? 'disabled' : `onclick="openWishlistPickerForPublicCard(${card.id})"`}>
                                    <span class="modal-action-icon" style="color: #E8A93B;"><i class="ti ${alreadyInMyWishlist ? 'ti-check' : 'ti-star'}" aria-hidden="true"></i></span>
                                    <span class="modal-action-text">
                                        <span class="modal-action-title" style="color: #E8A93B;">${alreadyInMyWishlist ? 'Déjà dans ma wishlist' : 'Ajouter à ma wishlist'}</span>
                                        ${!alreadyInMyWishlist ? '<span class="modal-action-subtitle">L\'ajouter à une de tes listes</span>' : ''}
                                    </span>
                                    ${!alreadyInMyWishlist ? '<i class="ti ti-chevron-right modal-action-chevron" aria-hidden="true"></i>' : ''}
                                </button>
                            ` : ''}
                            <a href="${cardmarketUrl}" target="_blank" rel="noopener noreferrer" class="modal-action-row">
                                <span class="modal-action-icon" style="color: #6bcbff;"><i class="ti ti-external-link" aria-hidden="true"></i></span>
                                <span class="modal-action-text">
                                    <span class="modal-action-title" style="color: #6bcbff;">${card.cardmarket_id ? 'Ouvrir sur Cardmarket' : 'Chercher sur Cardmarket'}</span>
                                    <span class="modal-action-subtitle">Voir l'annonce correspondante</span>
                                </span>
                                <i class="ti ti-chevron-right modal-action-chevron" aria-hidden="true"></i>
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <div class="modal-disclaimer">
            <span class="modal-disclaimer-icon"><i class="ti ti-info-circle" aria-hidden="true"></i></span>
            <span class="modal-disclaimer-text">
                <span class="modal-disclaimer-title">Les prix sont fournis à titre indicatif par Cardmarket.</span>
                <span class="modal-disclaimer-sub">Mise à jour quotidienne.</span>
            </span>
        </div>
        </div>
    `;

    document.getElementById('public-card-detail-overlay').classList.add('active');
}

function closePublicCardDetail() {
    document.getElementById('public-card-detail-overlay')?.classList.remove('active');
    publicCardDetailOpenId = null;
}

// Ouvre le picker de listes existant (modules/wishlist.js) avec la carte publique tierce en paramètre
// explicite, sans jamais toucher à selectedCard (réservé au flow Ajouter). Normalise vers la forme
// attendue par addPublicCardToWishlistInternal : uniquement les champs utiles à une ligne wishlist,
// jamais quantity/condition/finish (propres à la collection, pas à la wishlist) ni l'id de la carte
// publique (n'a aucun sens hors de viewedPublicCards).
function openWishlistPickerForPublicCard(cardId) {
    const card = viewedPublicCards.find(c => c.id === cardId);
    if (!card) return;

    openWishlistPicker({
        tcgdex_id: card.tcgdex_id || null,
        name: card.name,
        series: card.series,
        number: card.number,
        rarity: card.rarity,
        image: card.image,
        series_logo: card.series_logo || null,
        cardmarket_id: card.cardmarket_id || null
    });
}

// Appelé par addPublicCardToWishlistInternal (modules/wishlist.js) après un ajout réussi : la fiche
// détail publique reste ouverte (aucune raison de la fermer, contrairement au flow Ajouter), seul son
// bouton doit refléter le nouvel état "déjà dans ma wishlist". Re-render complet du contenu de la
// fiche (pas seulement le bouton) : le plus simple ici, showPublicCardDetail ne fait aucun appel réseau.
function refreshPublicCardDetailWishlistState() {
    if (publicCardDetailOpenId === null) return;
    if (!document.getElementById('public-card-detail-overlay')?.classList.contains('active')) return;
    showPublicCardDetail(publicCardDetailOpenId);
}

// Rendu des listes de wishlist publiques. Réutilise les classes visuelles de la wishlist propriétaire
// (.wishlist-list-card, .wishlist-thumb-grid, .collection-card wishlist-thumb-card, ...) — purement
// CSS, aucune fonction de modules/wishlist.js appelée. Pattern de navigation identique à l'existant
// (cartes de listes repliables/dépliables au clic sur l'en-tête) plutôt qu'une nouvelle UX : la
// première liste est ouverte par défaut (même comportement que loadWishlists()), les autres au clic.
// Ni renommer/supprimer/déplacer/"Je l'ai !" : uniquement un chevron pour replier/déplier.
function renderPublicWishlistLists() {
    const container = document.getElementById('public-wishlist-lists');
    if (!container) return;

    if (viewedPublicWishlistItems.length === 0) {
        container.innerHTML = '<p class="user-profile-section-placeholder">Cette wishlist ne contient encore aucune carte.</p>';
        return;
    }

    container.innerHTML = viewedPublicWishlists.map(list => {
        const items = viewedPublicWishlistItems.filter(i => i.wishlist_id === list.id);
        const listValue = items.reduce((sum, i) => sum + (viewedPublicWishlistPriceMap[i.tcgdex_id] || 0), 0);
        const isExpanded = viewedPublicWishlistExpandedIds.has(list.id);
        const icon = list.icon || '⭐';
        const color = list.color || '#E8A93B';

        const thumbsHtml = items.map(item => {
            const price = viewedPublicWishlistPriceMap[item.tcgdex_id] || 0;
            return `
                <div class="wishlist-thumb-wrap">
                    <div class="collection-card wishlist-thumb-card" onclick="showPublicWishlistItemDetail(${item.id})" title="${escapeHtml(item.name)}">
                        ${item.image
                            ? `<img src="${item.image}" alt="${escapeHtml(item.name)}" loading="lazy" onerror="this.style.display='none'">`
                            : '<div class="collection-card-noimg"><i class="ti ti-photo-off" aria-hidden="true"></i></div>'
                        }
                        ${price > 0 ? `<div class="price-badge">${price.toFixed(2)}€</div>` : ''}
                        <div class="collection-card-overlay">
                            <div class="collection-card-name">${escapeHtml(item.name)}</div>
                            <div class="collection-card-set">${escapeHtml(item.series || '')}</div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div class="wishlist-list-card">
                <div class="wishlist-list-card-header" onclick="togglePublicWishlistSection(${list.id})">
                    <span class="wishlist-list-icon" style="background:${color}22; color:${color};">${escapeHtml(icon)}</span>
                    <div class="wishlist-list-card-title">
                        <span class="wishlist-list-name">${escapeHtml(list.name)}</span>
                        <span class="wishlist-count-badge">${items.length} carte${items.length > 1 ? 's' : ''}</span>
                        ${listValue > 0 ? `<span class="wishlist-list-value">${listValue.toFixed(2)}€</span>` : ''}
                    </div>
                    <div class="wishlist-list-card-actions">
                        <i class="ti ti-chevron-right wishlist-chevron ${isExpanded ? 'expanded' : ''}" aria-hidden="true"></i>
                    </div>
                </div>
                <div class="wishlist-list-card-body" style="display:${isExpanded ? 'block' : 'none'};">
                    ${items.length === 0
                        ? '<p class="empty-state">Cette liste ne contient encore aucune carte.</p>'
                        : `<div class="wishlist-thumb-grid">${thumbsHtml}</div>`}
                </div>
            </div>
        `;
    }).join('');
}

function togglePublicWishlistSection(listId) {
    if (viewedPublicWishlistExpandedIds.has(listId)) {
        viewedPublicWishlistExpandedIds.delete(listId);
    } else {
        viewedPublicWishlistExpandedIds.add(listId);
    }
    renderPublicWishlistLists();
}

// Réutilise le même overlay/DOM que showPublicCardDetail (#public-card-detail-overlay) plutôt que d'en
// créer un troisième : structure modal-* générique, seul le contenu diffère (pas de rareté/type/numéro/
// état/finition/quantité, colonnes absentes de get_wishlist_items_public par construction).
function showPublicWishlistItemDetail(itemId) {
    const item = viewedPublicWishlistItems.find(i => i.id === itemId);
    if (!item) return;

    const price = viewedPublicWishlistPriceMap[item.tcgdex_id] || 0;
    // cardmarket_id désormais exposé par get_wishlist_items_public (2026-08-09) : lien produit exact
    // quand disponible, repli recherche par nom sinon.
    const cardmarketUrl = getCardmarketUrl(item.cardmarket_id, item.name);

    const modalCard = document.getElementById('public-card-detail-card');
    if (!modalCard) return;

    modalCard.innerHTML = `
        <button class="modal-close" onclick="closePublicCardDetail()"><i class="ti ti-x" aria-hidden="true"></i></button>
        <div class="modal-scroll">
        <div class="modal-body">
            <div class="modal-image-wrap">
                <div class="modal-stand">
                    ${item.image
                        ? `<img src="${item.image}" alt="${escapeHtml(item.name)}" class="modal-image" onerror="this.outerHTML=getGridNoImageHtml()">`
                        : getGridNoImageHtml()
                    }
                </div>
            </div>
            <div class="modal-info">
                <div class="modal-main-col">
                    <div class="modal-title-row">
                        <div class="modal-title">${escapeHtml(item.name)}</div>
                    </div>
                    <div class="modal-subtitle">${escapeHtml(item.series || '')}</div>

                    ${price > 0 ? `
                        <div class="modal-value-block">
                            <div class="modal-value-label">Valeur estimée</div>
                            <div class="modal-value-row">
                                <span class="modal-price">${price.toFixed(2).replace('.', ',')}€</span>
                            </div>
                        </div>
                    ` : ''}

                    <div class="modal-meta-actions-row">
                        <div class="modal-actions-col">
                            <a href="${cardmarketUrl}" target="_blank" rel="noopener noreferrer" class="modal-action-row">
                                <span class="modal-action-icon" style="color: #6bcbff;"><i class="ti ti-external-link" aria-hidden="true"></i></span>
                                <span class="modal-action-text">
                                    <span class="modal-action-title" style="color: #6bcbff;">${item.cardmarket_id ? 'Ouvrir sur Cardmarket' : 'Chercher sur Cardmarket'}</span>
                                    <span class="modal-action-subtitle">Voir l'annonce correspondante</span>
                                </span>
                                <i class="ti ti-chevron-right modal-action-chevron" aria-hidden="true"></i>
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <div class="modal-disclaimer">
            <span class="modal-disclaimer-icon"><i class="ti ti-info-circle" aria-hidden="true"></i></span>
            <span class="modal-disclaimer-text">
                <span class="modal-disclaimer-title">Les prix sont fournis à titre indicatif par Cardmarket.</span>
                <span class="modal-disclaimer-sub">Mise à jour quotidienne.</span>
            </span>
        </div>
        </div>
    `;

    document.getElementById('public-card-detail-overlay').classList.add('active');
}
