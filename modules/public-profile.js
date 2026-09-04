// Profil public (Phase 3) - Pokémon Tracker
// Dépend de: supabaseClient (tracker.js), escapeHtml/sortRaritiesByTier/buildRarityFilterRowHtml/
// getRarityGroupKey/getRarityIconHtml/renderFinishBadge/getTypesIconsHtml/getCardmarketUrl (utils.js),
// renderGridCardHtml/runCardDetailMorphTransition (card-grid-renderer.js), getDuplicateCardsWithQuantity (collection.js) —
// réutilisés en lecture seule (générateurs HTML purs / calcul pur). getDuplicateCardsWithQuantity applique la même définition
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
// profileMatchesB LIT allCollectionCards (déjà garanti chargé au moment de loadPublicProfile, cf init()
// dans modules/auth.js) en lecture seule, jamais écrit depuis ce fichier, et currentUserProfile
// (modules/profile.js) pour détecter la consultation de son propre profil.
// Etat possédé : viewedPublicProfile, viewedPublicCards, publicCollectionSort, publicCollectionRarityFilterValues,
// profileMatchesB, hasReciprocalTrade

let viewedPublicProfile = null;

// Collection publique tierce (lecture seule). Jamais lu/écrit dans allCollectionCards : source unique
// = get_cards_public(owner_id), déjà appelé une fois dans loadPublicProfile() pour les stats d'en-tête,
// son résultat est conservé ici plutôt que requêté une seconde fois pour la grille.
let viewedPublicCards = [];
let publicCollectionSort = 'value-desc';
let publicCollectionRarityFilterValues = new Set();

// Pagination de la grille collection publique (même principe que COLLECTION_PAGE_SIZE, collection.js) :
// trouvée manquante ici lors d'un diagnostic de lenteur réel (724 cartes/~3000 <img> injectées d'un
// coup pour un profil de 1780 cartes - la vraie cause du ralentissement constaté sur ces pages, pas
// les View Transitions). publicCollectionDisplayLimit repart à PUBLIC_COLLECTION_PAGE_SIZE à chaque
// nouveau profil chargé et à chaque filtre/tri/recherche changé (filterPublicCollectionAndDisplay).
const PUBLIC_COLLECTION_PAGE_SIZE = 60;
let publicCollectionDisplayLimit = PUBLIC_COLLECTION_PAGE_SIZE;

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
// globals déjà chargés (allCollectionCards, cf tracker.js) et des données publiques ci-dessus, aucune
// requête dédiée. profileMatchesB = sa wishlist trouvée dans MES doublons réellement échangeables
// (Phase 5, P5-1 : corrigé pour ne plus lire ma collection brute, cf loadPublicProfile - un exemplaire
// unique ne doit jamais générer de signal d'échange).
// profileMatchesA (ma wishlist ∩ sa collection BRUTE, non restreinte aux doublons) a existé un temps
// dans ce fichier mais retiré en Phase 5 (P5-1, audit demandé) : son seul consommateur était
// renderProfileMatchSection ci-dessous, où il se présentait de façon ambiguë comme une correspondance
// d'échange alors qu'il ne l'était pas (comptait aussi mes cartes en un seul exemplaire chez lui). La
// même direction ("ma wishlist trouvée chez lui"), correctement restreinte au surplus échangeable, est
// déjà couverte par profileDuplicateMatches - pas de perte d'information utile, juste une ambiguïté en
// moins. À réintroduire uniquement si un futur usage explicitement non lié à l'échange en a besoin.
let profileMatchesB = [];
// Signal "Pour moi" ∩ "Pour lui" (Phase 5, P5-1) : true si profileDuplicateMatches ET profileMatchesB
// (les deux tableaux déjà restreints au surplus échangeable) ont chacun au moins une correspondance.
// Affiché en badge "Match réciproque" dans la section Opportunités d'échange (P5-4).
let hasReciprocalTrade = false;

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

// formatPublicMemberSince déplacée dans modules/utils.js (audit bundle 2026-09) : collectors.js
// (toujours chargé, widget Dashboard) l'utilise aussi et ne doit pas dépendre de ce module,
// désormais chargé à la demande.

function renderPublicProfileNotFound(container) {
    container.innerHTML = `
        <div class="user-profile-notfound">
            <i class="ti ti-user-question" aria-hidden="true"></i>
            <p>Profil introuvable ou privé</p>
        </div>
    `;
}

// VT4 (cf roadmap technique animations premium) : contexte préparé par un clic normal sur une carte
// Collecteur (modules/collectors.js#handleCollectorProfileClick), pour permettre à loadPublicProfile()
// de rendre un shell d'identité immédiatement, avant tout aller-retour réseau, et à tracker.js de
// choisir la transition 'profile-open' plutôt que 'navigation' (VT2) pour CETTE navigation précise.
// Associé explicitement à la route cible exacte (targetHash) : un clic sur A puis une navigation qui
// finit ailleurs (B, ou un retour en arrière) ne doit jamais laisser les données de A s'appliquer par
// erreur. Consommé une seule fois par loadPublicProfile() (jamais réutilisé), quel que soit le
// résultat (succès, erreur, profil introuvable) - tracker.js ne fait que le consulter (peek), jamais
// le vider lui-même.
let pendingCollectorProfileContext = null;

// Appelée uniquement par modules/collectors.js, sur un clic normal (même onglet, bouton gauche, sans
// modificateur) : aucune donnée ici ne vient d'un nouvel appel réseau, uniquement ce que la liste
// Collecteurs affiche déjà (avatar_url/pseudo/username/created_at).
function prepareCollectorProfileTransition(targetHash, profile) {
    pendingCollectorProfileContext = { targetHash, profile };
}

// Lecture seule (ne consomme pas) : utilisée par tracker.js pour décider du type de View Transition
// avant même d'appeler renderTab(), et par loadPublicProfile() pour savoir si un shell est pertinent.
// window.location.hash est déjà la valeur cible au moment où hashchange se déclenche - pas besoin de
// reconstruire/re-encoder quoi que ce soit ici.
function getPendingCollectorProfileContext(targetHash) {
    return (pendingCollectorProfileContext && pendingCollectorProfileContext.targetHash === targetHash)
        ? pendingCollectorProfileContext
        : null;
}

// Bloc identité (avatar + pseudo + username + ancienneté) : extrait de renderPublicProfileShell pour
// être réutilisé tel quel par le shell d'entrée (VT4, renderPublicProfileEntryShell ci-dessous) - même
// markup/classes exactement, donc aucun saut visuel de design quand les vraies données remplacent le
// shell (seules les sections qui suivent ce bloc changent).
function renderPublicProfileIdentityHeader(profile) {
    // Même raison qu'ailleurs (profile.js) : avatar_url est un champ contrôlable par l'utilisateur
    // consulté, jamais faire confiance à sa valeur brute dans un attribut HTML.
    const avatarHtml = profile.avatar_url
        ? `<img src="${escapeHtml(profile.avatar_url)}" alt="" class="user-profile-avatar">`
        : `<span class="user-profile-avatar user-profile-avatar-fallback"><i class="ti ti-user" aria-hidden="true"></i></span>`;

    return `
        <div class="user-profile-header">
            ${avatarHtml}
            <div class="user-profile-identity">
                <div class="user-profile-pseudo">${escapeHtml(profile.pseudo || profile.username)}</div>
                <div class="user-profile-username">@${escapeHtml(profile.username)}</div>
                ${profile.created_at ? `<div class="user-profile-member-since">${formatPublicMemberSince(profile.created_at)}</div>` : ''}
            </div>
        </div>
    `;
}

// Shell immédiat (VT4) : identité déjà connue (avatar/pseudo/username/ancienneté), rien d'autre -
// aucune statistique/donnée inventée (cartes, wishlist, doublons...), qui reste au chargement normal
// ci-dessous. Rendu de façon strictement synchrone, avant le premier await de loadPublicProfile().
function renderPublicProfileEntryShell(container, profile) {
    container.innerHTML = `
        ${renderPublicProfileIdentityHeader(profile)}
        <p class="dashboard-empty-text" style="padding:2rem 0; text-align:center;">Chargement...</p>
    `;
}

async function loadPublicProfile(username) {
    const container = document.getElementById('user-profile-content');
    if (!container) return;

    viewedPublicProfile = null;
    viewedPublicCards = [];
    publicCollectionSort = 'value-desc';
    publicCollectionRarityFilterValues = new Set();
    publicCollectionDisplayLimit = PUBLIC_COLLECTION_PAGE_SIZE;
    viewedPublicWishlists = [];
    viewedPublicWishlistItems = [];
    viewedPublicWishlistPriceMap = {};
    viewedPublicWishlistExpandedIds = new Set();
    profileMatchesB = [];
    viewedPublicDuplicateCards = [];
    profileDuplicateMatches = [];
    hasReciprocalTrade = false;

    if (!username) {
        pendingCollectorProfileContext = null; // jamais laissé traîner si la route finit sans username valide
        renderPublicProfileNotFound(container);
        return;
    }

    // VT4 : contexte Collecteur consommé ici, une seule fois, qu'il soit utilisé ou non ci-dessous.
    const shellCtx = getPendingCollectorProfileContext(window.location.hash);
    pendingCollectorProfileContext = null;

    if (shellCtx) {
        renderPublicProfileEntryShell(container, shellCtx.profile);
    } else {
        container.innerHTML = '<p class="dashboard-empty-text" style="padding:3rem 0; text-align:center;">Chargement...</p>';
    }

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
            // quantity substituée par duplicateQuantity (surplus au-delà de l'exemplaire principal) :
            // computeWishlistMatch ne lit que .quantity, aucune modification de cette fonction requise.
            const ownedCardsA = viewedPublicDuplicateCards.map(c => ({ ...c, quantity: c.duplicateQuantity }));
            profileDuplicateMatches = computeWishlistMatch(allWishlistItems, ownedCardsA);
            // Audit webdesign 2026-09 (F-Focus, quick win "Vignette enrichie") : condition/finish ne
            // sont pas recopiés par computeWishlistMatch (hors scope de ce module pur, cf son en-tête) -
            // rattachés ici depuis la carte source (celle de ownedCardId, même carte que celle qu'ouvre
            // le clic sur la vignette) pour affichage sur renderProfileMatchThumb.
            enrichMatchesWithConditionFinish(profileDuplicateMatches, ownedCardsA);
        }
        if (profile.wishlist_visible) {
            // "Pour lui" (Phase 5, P5-1) : mes doublons réellement échangeables ∩ sa wishlist - même
            // pipeline symétrique que profileDuplicateMatches ci-dessus (même filtre de raretés
            // getPublicDuplicateEligibleCards, même substitution quantity -> duplicateQuantity), pour
            // éviter deux définitions différentes d'une opportunité d'échange. AVANT : lisait
            // allCollectionCards brut, ce qui comptait aussi mes exemplaires uniques comme échangeables
            // - incorrect (cf audit Phase 5).
            const myDuplicateCards = getDuplicateCardsWithQuantity(getPublicDuplicateEligibleCards(allCollectionCards));
            const ownedCardsB = myDuplicateCards.map(c => ({ ...c, quantity: c.duplicateQuantity }));
            profileMatchesB = computeWishlistMatch(viewedPublicWishlistItems, ownedCardsB);
            enrichMatchesWithConditionFinish(profileMatchesB, ownedCardsB);
        }

        // Match réciproque : les deux signaux ("Pour moi" = profileDuplicateMatches, "Pour lui" =
        // profileMatchesB) sont déjà restreints au surplus échangeable à ce stade - hasPotentialTrade
        // n'a plus qu'à vérifier qu'aucun des deux n'est vide (modules/collector-match.js).
        hasReciprocalTrade = hasPotentialTrade(profileDuplicateMatches, profileMatchesB);
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
    container.innerHTML = `
        ${renderPublicProfileIdentityHeader(profile)}

        <div class="user-profile-stats">
            ${profile.collection_visible ? `
                <div class="user-profile-stat">
                    <div class="user-profile-stat-value">${profile.cardCount}</div>
                    <div class="user-profile-stat-label">Cartes</div>
                </div>
                <div class="user-profile-stat">
                    <div class="user-profile-stat-value">${formatPrice(profile.collectionValue)}</div>
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
                <div class="user-profile-section-title"><i class="ti ti-copy" aria-hidden="true"></i> Ses doublons disponibles</div>
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
                        <input type="text" id="public-collection-search" placeholder="Rechercher..." oninput="debouncedFilterPublicCollectionAndDisplay()">
                    </div>
                    <div class="catalogue-toolbar-actions">
                        <select id="public-collection-series-filter" onchange="filterPublicCollectionAndDisplay()">
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
                <div class="load-more-row" id="public-collection-load-more-row" style="display: none;">
                    <button class="filter-toggle-btn" id="public-collection-load-more-btn" onclick="loadMorePublicCollectionCards()"></button>
                </div>
            </div>
        ` : ''}
    `;

    // Survol holographique (retour utilisateur 2026-09, meme mecanique que la Galerie Collection
    // personnelle, card-grid-renderer.js) : un seul point d'ecoute delegue sur tout le conteneur du
    // profil, couvre a la fois la grille de collection et celle des doublons a l'echange sans
    // rattachement separe pour chacune.
    initHoloGridEffect(container);

    if (profile.collection_visible) {
        populatePublicCollectionSeriesFilter();
        renderPublicCollectionRarityRow();
        renderPublicCollectionGrid();
    }

    if (profile.wishlist_visible) {
        renderPublicWishlistLists();
    }
}

// Bloc "Opportunités d'échange" (Phase 5, P5-4 - anciennement "Correspondances avec toi"). Retourne ''
// (rien affiché) si aucune direction n'a de correspondance (isSelf déjà filtré en amont via
// profileDuplicateMatches/profileMatchesB laissés vides dans loadPublicProfile) - pas de section vide
// sur les profils sans opportunité, pas de faux compteur à 0 (décision explicite, cf demande P5-4 §6).
// Toujours affichée dépliée (l'ancien résumé replié + détail à double-clic a été retiré : ce bloc EST
// déjà le détail, pas une redite d'un résumé au-dessus) - titres de groupe génériques ("il"/"tu") plutôt
// que le pseudo répété partout, décision produit explicite.
function renderProfileMatchSection(profile) {
    if (profileDuplicateMatches.length === 0 && profileMatchesB.length === 0) return '';

    // Une seule direction présente -> le groupe occupe toute la largeur (grid-column: 1/-1) plutôt que
    // de laisser une colonne vide à côté (la grille 2 colonnes de .trade-opportunity-groups ne s'adapte
    // pas seule au nombre d'enfants réels).
    const onlyOneDirection = profileDuplicateMatches.length === 0 || profileMatchesB.length === 0;
    const groupClass = onlyOneDirection ? 'user-profile-match-group user-profile-match-group-full' : 'user-profile-match-group';

    // Groupe A - "Pour moi" : ses doublons échangeables qui correspondent à ma wishlist. Flèche ↓ +
    // couleur "for-me" (audit webdesign 2026-09, quick win "Titres directionnels") : même vocabulaire
    // visuel que renderCollectorSignalBadges (collectors.js) pour ce même signal, plutôt qu'un titre
    // générique qui demande une seconde de réflexion ("qui est il, qui est tu ?").
    const groupA = profileDuplicateMatches.length > 0 ? `
        <div class="${groupClass}">
            <div class="user-profile-match-group-title user-profile-match-group-title-for-me"><i class="ti ti-arrow-down" aria-hidden="true"></i> Ce qu'il peut te proposer</div>
            <div class="wishlist-thumb-grid">${profileDuplicateMatches.map(m => renderProfileMatchThumb(m, `showPublicCardDetail(${m.ownedCardId})`)).join('')}</div>
        </div>
    ` : '';

    // Groupe B - "Pour lui" : mes doublons échangeables qui correspondent à sa wishlist. Flèche ↑ +
    // couleur "for-them", symétrique du groupe A.
    const groupB = profileMatchesB.length > 0 ? `
        <div class="${groupClass}">
            <div class="user-profile-match-group-title user-profile-match-group-title-for-them"><i class="ti ti-arrow-up" aria-hidden="true"></i> Ce que tu peux lui proposer</div>
            <div class="wishlist-thumb-grid">${profileMatchesB.map(m => renderProfileMatchThumb(m, `showPublicWishlistItemDetail(${m.wishlistItemId})`)).join('')}</div>
        </div>
    ` : '';

    return `
        <div class="user-profile-section user-profile-match-section">
            <div class="user-profile-match-header">
                <div class="user-profile-section-title"><i class="ti ti-repeat" aria-hidden="true"></i> Opportunités d'échange</div>
                ${hasReciprocalTrade ? '<span class="trade-reciprocal-badge">Match réciproque</span>' : ''}
            </div>
            <div class="trade-opportunity-groups">
                ${groupA}
                ${groupB}
            </div>
        </div>
    `;
}

// Rattache condition/finish à chaque match (mutation en place) depuis la carte source correspondant
// à ownedCardId - même carte que celle qu'ouvre le clic sur la vignette (showPublicCardDetail côté
// groupe A, ou allCollectionCards côté groupe B), donc l'état affiché sur la vignette est toujours
// celui de la fiche qu'elle ouvre réellement.
function enrichMatchesWithConditionFinish(matches, sourceCards) {
    const byId = new Map(sourceCards.map(c => [c.id, c]));
    matches.forEach(m => {
        const src = byId.get(m.ownedCardId);
        if (src) {
            m.condition = src.condition;
            m.finish = src.finish;
        }
    });
}

// Miniature de carte matchée : réutilise les classes visuelles de la wishlist publique. Clic ->
// rouvre la même fiche détail publique que les sections Collection/Wishlist plus bas sur cette page
// (showPublicCardDetail/showPublicWishlistItemDetail, déjà en lecture seule, aucune fonction
// propriétaire) — jamais une troisième fiche détail dédiée. condition/finish (audit webdesign
// 2026-09, quick win "Vignette enrichie") : même badge que la grille Collection perso
// (renderGridCardHtml, card-grid-renderer.js) - .condition-badge-grid + renderFinishBadge - pour que
// les deux infos qui comptent le plus pour décider d'un échange soient visibles sans ouvrir la fiche.
function renderProfileMatchThumb(match, onclickExpr) {
    const conditionClass = (match.condition || '').toLowerCase();
    return `
        <div class="wishlist-thumb-wrap">
            <div class="collection-card wishlist-thumb-card" onclick="${onclickExpr}" title="${escapeHtml(match.name)}">
                ${match.image
                    ? `<img src="${escapeHtml(match.image)}" alt="${escapeHtml(match.name)}" loading="lazy" onerror="this.style.display='none'">`
                    : '<div class="collection-card-noimg"><i class="ti ti-photo-off" aria-hidden="true"></i></div>'
                }
                ${match.multiple ? `<div class="qty-badge" title="Possédée en plusieurs exemplaires">×${match.ownedQty}</div>` : ''}
                <div class="collection-card-overlay">
                    <div class="collection-card-name">${escapeHtml(match.name)}</div>
                    <div class="collection-card-set">${escapeHtml(match.series || '')}</div>
                    ${match.condition ? `<span class="condition-badge-grid ${escapeHtml(conditionClass)}">${escapeHtml(match.condition)}</span>` : ''}
                    ${renderFinishBadge(match.finish, 'condition-badge-grid finish-badge', 12)}
                </div>
            </div>
        </div>
    `;
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
    filterPublicCollectionAndDisplay();
}

function setPublicCollectionSort(value) {
    publicCollectionSort = value;
    filterPublicCollectionAndDisplay();
}

// Repart toujours à la première page (comme filterAndDisplay(), collection.js) : recherche/série/tri/
// rareté changés doivent réafficher depuis publicCollectionDisplayLimit initial, jamais garder la
// pagination d'un filtre précédent.
function filterPublicCollectionAndDisplay() {
    publicCollectionDisplayLimit = PUBLIC_COLLECTION_PAGE_SIZE;
    renderPublicCollectionGrid();
}

// Wrapper stable (une seule instance debounce(), pas recréée à chaque frappe - sinon plus de mémoire du
// timeoutId précédent, le debounce ne servirait à rien). Initialisation paresseuse au premier appel
// plutôt qu'un `debounce(...)` direct au chargement du module : debounce() vient de utils.js (autre
// script), et résoudre un nom cross-module au chargement (pas à l'appel) a déjà causé un ReferenceError
// en prod par le passé (chunking Vite non déterministe, cf commit dd1ae64/applySearchFilters) - même
// précaution ici.
let _debouncedFilterPublicCollectionAndDisplay = null;
function debouncedFilterPublicCollectionAndDisplay() {
    if (!_debouncedFilterPublicCollectionAndDisplay) {
        _debouncedFilterPublicCollectionAndDisplay = debounce(filterPublicCollectionAndDisplay, 250);
    }
    _debouncedFilterPublicCollectionAndDisplay();
}

function loadMorePublicCollectionCards() {
    publicCollectionDisplayLimit += PUBLIC_COLLECTION_PAGE_SIZE;
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

// Section "Doublons à l'échange" (V1 simplifiée, cf audit du 2026-08-12) : aucune nouvelle fiche
// détail, clic -> showPublicCardDetail existant (card.id reste un id valide de viewedPublicCards,
// getDuplicateCardsWithQuantity ne fait que sélectionner une carte représentative par groupe). Le badge
// affiche duplicateQuantity (surplus au-delà de l'exemplaire principal), jamais quantity brute — cf audit
// "3 exemplaires = 2 doublons potentiels, pas 3". Rendu partagé avec renderPublicCollectionGrid, cf
// card-grid-renderer.js (Phase 3).
function renderPublicDuplicateCardsHtml() {
    return viewedPublicDuplicateCards.map(card => renderGridCardHtml(card, {
        detailFn: 'showPublicCardDetail',
        badgeMode: 'duplicate',
        holoEffect: true
    })).join('');
}

// Rendu partagé avec la grille personnelle (renderCollectionGrid, collection.js), cf
// card-grid-renderer.js (Phase 3). Pas d'icône d'obtention ici (acquisition_type absent de
// get_cards_public, volontairement non exposé) ni de placeholder d'upload au clic (aucune écriture
// possible sur un profil public) : options par défaut de renderGridCardHtml, pas besoin de les passer.
function renderPublicCollectionGrid() {
    const grid = document.getElementById('public-collection-grid');
    if (!grid) return;

    const filtered = getFilteredSortedPublicCollection();
    const page = filtered.slice(0, publicCollectionDisplayLimit);

    if (filtered.length === 0) {
        grid.innerHTML = '<div class="collection-grid-empty"><i class="ti ti-search-off" aria-hidden="true"></i> Aucune carte trouvée</div>';
        updatePublicCollectionLoadMoreRow(0, 0);
        return;
    }

    grid.innerHTML = page.map(card => renderGridCardHtml(card, {
        detailFn: 'showPublicCardDetail',
        holoEffect: true
    })).join('');
    updatePublicCollectionLoadMoreRow(filtered.length, page.length);
}

function updatePublicCollectionLoadMoreRow(totalCount, shownCount) {
    const row = document.getElementById('public-collection-load-more-row');
    const btn = document.getElementById('public-collection-load-more-btn');
    if (!row || !btn) return;

    const remaining = totalCount - shownCount;
    if (remaining > 0) {
        row.style.display = 'flex';
        btn.textContent = `Charger plus (${remaining} restante${remaining > 1 ? 's' : ''})`;
    } else {
        row.style.display = 'none';
    }
}

// Point d'entrée public (Phase 4, View Transitions) : délègue la mécanique du morph à
// runCardDetailMorphTransition (card-grid-renderer.js, partagée avec showCardDetail/card-detail.js),
// ce fichier ne garde que son propre rendu (renderPublicCardDetail).
function showPublicCardDetail(cardId, event) {
    runCardDetailMorphTransition(event, () => renderPublicCardDetail(cardId));
}

// Fiche détail carte publique : overlay/DOM dédiés (#public-card-detail-*, index.html), jamais
// #card-detail-overlay (fiche propriétaire) pour ne jamais mélanger les deux flux. Aucun bouton
// Modifier/Retirer, aucune quantité modifiable, aucun prix d'achat ni date d'acquisition (colonnes
// absentes de get_cards_public par construction) : uniquement ce que la fonction publique expose déjà.
function renderPublicCardDetail(cardId) {
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
    const seriesLogoUrl = card.series_logo || getSeriesLogoUrl(card.tcgdex_id);

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
                    <div class="modal-image-frame">
                        ${card.image
                            ? `<div class="modal-image-holo" id="public-card-detail-image-holo">
                                <img src="${escapeHtml(card.image)}" alt="${escapeHtml(card.name)}" class="modal-image" onerror="this.outerHTML=getGridNoImageHtml()">
                                <div class="collection-card-holo-sheen"></div>
                                <div class="collection-card-holo-glare"></div>
                               </div>`
                            : getGridNoImageHtml()
                        }
                        ${seriesLogoUrl ? `<img src="${escapeHtml(seriesLogoUrl)}" class="modal-series-seal" alt="" onerror="handleSealLogoError(this)">` : ''}
                    </div>
                </div>
            </div>
            <div class="modal-info">
                <div class="modal-main-col">
                    <div class="modal-title-row">
                        <div class="modal-title">${escapeHtml(card.name)}</div>
                    </div>
                    <div class="modal-subtitle">${escapeHtml(card.series)} · #${card.number}</div>

                    <div class="modal-badges">
                        <span class="modal-pill rarity-pill">${getRarityIconHtml(card.rarity, 14)} ${escapeHtml(card.rarity || 'N/A')}</span>
                        <span class="modal-pill condition-pill ${conditionClass}">${conditionLabel} (${card.condition})</span>
                        ${renderFinishBadge(card.finish, 'modal-pill finish-pill', 14)}
                    </div>

                    <div class="modal-value-block">
                        <div class="modal-value-label">Valeur estimée</div>
                        <div class="modal-value-row">
                            <span class="modal-price">${formatPrice(marketValue)}</span>
                        </div>
                        ${qty > 1 ? `<div class="modal-price-total">Valeur totale : ${formatPrice(lineTotal)} (×${qty})</div>` : ''}
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
    initHoloDetailEffect(document.getElementById('public-card-detail-image-holo'));
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
                            ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" loading="lazy" onerror="this.style.display='none'">`
                            : '<div class="collection-card-noimg"><i class="ti ti-photo-off" aria-hidden="true"></i></div>'
                        }
                        ${price > 0 ? `<div class="price-badge${isHighRarityCard(item.rarity) ? ' price-badge-foil' : ''}">${formatPrice(price)}</div>` : ''}
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
                        ${listValue > 0 ? `<span class="wishlist-list-value">${formatPrice(listValue)}</span>` : ''}
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
    const seriesLogoUrl = item.series_logo || getSeriesLogoUrl(item.tcgdex_id);

    const modalCard = document.getElementById('public-card-detail-card');
    if (!modalCard) return;

    modalCard.innerHTML = `
        <button class="modal-close" onclick="closePublicCardDetail()"><i class="ti ti-x" aria-hidden="true"></i></button>
        <div class="modal-scroll">
        <div class="modal-body">
            <div class="modal-image-wrap">
                <div class="modal-stand">
                    <div class="modal-image-frame">
                        ${item.image
                            ? `<div class="modal-image-holo" id="public-card-detail-image-holo">
                                <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" class="modal-image" onerror="this.outerHTML=getGridNoImageHtml()">
                                <div class="collection-card-holo-sheen"></div>
                                <div class="collection-card-holo-glare"></div>
                               </div>`
                            : getGridNoImageHtml()
                        }
                        ${seriesLogoUrl ? `<img src="${escapeHtml(seriesLogoUrl)}" class="modal-series-seal" alt="" onerror="handleSealLogoError(this)">` : ''}
                    </div>
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
                                <span class="modal-price">${formatPrice(price)}</span>
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
    initHoloDetailEffect(document.getElementById('public-card-detail-image-holo'));
}

// ===== Exports window (ticket V2 Vite, type="module") =====
// Les déclarations top-level d'un module ES ne s'attachent plus automatiquement à window
// (contrairement à un <script> classique) : réexport explicite pour que les autres scripts
// (chargés en modules indépendants, sans import/export entre eux, scope global inchangé)
// puissent continuer à référencer ces noms tels quels — y compris depuis des onclick="..."
// inline dans du HTML généré. Liste exhaustive des déclarations top-level de ce fichier
// (hors variables déjà passées en window.x = ... directement à leur déclaration, cf audit
// du 2026-08-14 sur l'état mutable partagé entre fichiers).
window.viewedPublicProfile = viewedPublicProfile;
window.viewedPublicCards = viewedPublicCards;
window.publicCollectionSort = publicCollectionSort;
window.publicCollectionRarityFilterValues = publicCollectionRarityFilterValues;
window.viewedPublicWishlists = viewedPublicWishlists;
window.viewedPublicWishlistItems = viewedPublicWishlistItems;
window.viewedPublicWishlistPriceMap = viewedPublicWishlistPriceMap;
window.viewedPublicWishlistExpandedIds = viewedPublicWishlistExpandedIds;
window.profileMatchesB = profileMatchesB;
window.hasReciprocalTrade = hasReciprocalTrade;
window.viewedPublicDuplicateCards = viewedPublicDuplicateCards;
window.profileDuplicateMatches = profileDuplicateMatches;
window.DUPLICATE_SECTION_EXCLUDED_RARITY_GROUPS = DUPLICATE_SECTION_EXCLUDED_RARITY_GROUPS;
window.getPublicDuplicateEligibleCards = getPublicDuplicateEligibleCards;
window.publicCardDetailOpenId = publicCardDetailOpenId;
window.getUsernameFromHash = getUsernameFromHash;
window.escapePublicUsernameIlike = escapePublicUsernameIlike;
window.renderPublicProfileNotFound = renderPublicProfileNotFound;
window.prepareCollectorProfileTransition = prepareCollectorProfileTransition;
window.getPendingCollectorProfileContext = getPendingCollectorProfileContext;
window.renderPublicProfileIdentityHeader = renderPublicProfileIdentityHeader;
window.renderPublicProfileEntryShell = renderPublicProfileEntryShell;
window.loadPublicProfile = loadPublicProfile;
window.loadPublicWishlistData = loadPublicWishlistData;
window.loadPublicWishlistPrices = loadPublicWishlistPrices;
window.renderPublicProfileShell = renderPublicProfileShell;
window.renderProfileMatchSection = renderProfileMatchSection;
window.renderProfileMatchThumb = renderProfileMatchThumb;
window.populatePublicCollectionSeriesFilter = populatePublicCollectionSeriesFilter;
window.renderPublicCollectionRarityRow = renderPublicCollectionRarityRow;
window.setPublicCollectionRarityFilter = setPublicCollectionRarityFilter;
window.setPublicCollectionSort = setPublicCollectionSort;
window.filterPublicCollectionAndDisplay = filterPublicCollectionAndDisplay;
window.debouncedFilterPublicCollectionAndDisplay = debouncedFilterPublicCollectionAndDisplay;
window.loadMorePublicCollectionCards = loadMorePublicCollectionCards;
window.getFilteredSortedPublicCollection = getFilteredSortedPublicCollection;
window.renderPublicDuplicateCardsHtml = renderPublicDuplicateCardsHtml;
window.renderPublicCollectionGrid = renderPublicCollectionGrid;
window.showPublicCardDetail = showPublicCardDetail;
window.closePublicCardDetail = closePublicCardDetail;
window.openWishlistPickerForPublicCard = openWishlistPickerForPublicCard;
window.refreshPublicCardDetailWishlistState = refreshPublicCardDetailWishlistState;
window.renderPublicWishlistLists = renderPublicWishlistLists;
window.togglePublicWishlistSection = togglePublicWishlistSection;
window.showPublicWishlistItemDetail = showPublicWishlistItemDetail;
