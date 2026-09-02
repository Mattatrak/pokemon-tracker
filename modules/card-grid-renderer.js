// Rendu de carte partagé (Phase 3) + mécanique du morph View Transitions grille->détail (Phase 4),
// cf roadmap technique - Pokémon Tracker
// Dépend de: escapeHtml/renderFinishBadge/getRarityIconHtml (utils.js), getCollectionUploadPlaceholder (card-detail.js)
//
// Extraction pure du HTML de "carte en grille" (image + badges + overlay), jusqu'ici dupliqué
// quasi à l'identique dans 3 endroits : renderCollectionGrid (collection.js), et
// renderPublicCollectionGrid / renderPublicDuplicateCardsHtml (public-profile.js). Aucun changement
// visuel voulu, sauf un : l'échappement HTML est désormais appliqué uniformément dans les 3 contextes,
// y compris la collection perso (qui ne l'appliquait pas avant - la donnée y est réputée fiable, mais
// rien ne justifie de la traiter différemment des contextes publics ici).
//
// Volontairement PAS pensé pour Progression/Wishlist/Dashboard/future Vue Classeur : ces rendus ont
// des layouts réellement différents (bouton d'ajout rapide, résolution d'image en cascade, badges
// propres...), cf audit Phase 3 - les y forcer aurait ajouté des options que seul un appelant utilise.

// Icône statique affichée en cas d'erreur/absence d'image, pour les contextes en lecture seule
// (aucun upload possible : grilles publiques). Le contexte Collection perso a son propre fallback
// cliquable (getCollectionUploadPlaceholder, card-detail.js), passé via l'option imageFallback.
function getGridNoImageHtml() {
    return '<div class="collection-card-noimg"><i class="ti ti-photo-off" aria-hidden="true"></i></div>';
}

// Résolveur par défaut de l'image de la fiche cible : couvre card-detail-overlay ET
// public-card-detail-overlay (jamais les deux actifs en même temps), inchangé depuis Phase 4.
function defaultResolveModalImg() {
    return document.querySelector('.modal-overlay.active .modal-image');
}

// Mécanique générique du morph View Transitions grille -> fiche détail (Phase 4, cf roadmap
// technique), partagée par showCardDetail (card-detail.js), showPublicCardDetail
// (public-profile.js) et openWishlistItemDetail (wishlist-detail.js, VT3) : seule la mécanique est
// ici, chaque contexte garde sa propre fonction de rendu (renderFn) et son propre modal.
//
// resolveModalImg (VT3, cf roadmap technique animations premium) : résout l'image de la fiche APRÈS
// renderFn() (le DOM de la fiche vient d'être inséré, à l'intérieur du même updateFn) - paramètre
// optionnel, par défaut defaultResolveModalImg ci-dessus, donc les appelants existants
// (Collection/Classeur/Récap/profil public) n'ont rien à changer. Seule la Wishlist, dont l'overlay
// et la classe d'image diffèrent (#wishlist-detail-overlay .wishlist-detail-image), passe un
// résolveur dédié - le nom partagé ('card-detail-morph') reste, lui, commun : les overlays sont
// mutuellement exclusifs (jamais deux ouverts à la fois), aucun risque de collision réelle.
//
// Retombe directement sur renderFn() sans transition si : API non supportée (Firefox à ce jour, cf
// mémoire firefox-wishlist-gpu-flicker), pas d'event (réouverture après édition, clic hors grille type
// renderProfileMatchThumb), ou pas d'image source (carte sans image / placeholder affiché) — dans tous
// les cas, aucun comportement ne dépend de la transition, seulement du rendu qu'elle enrobe.
//
// VT1 (cf roadmap technique animations premium) : consomme désormais runViewTransition
// (modules/view-transitions.js) au lieu d'appeler document.startViewTransition() directement -
// support/reduced-motion/concurrence gérés une seule fois pour tout le projet, ce fichier ne garde
// que ce qui lui est propre (quel élément nommer, quand nettoyer).
function runCardDetailMorphTransition(event, renderFn, resolveModalImg = defaultResolveModalImg) {
    const sourceImg = event?.currentTarget?.querySelector('img');
    // Desactive sur mobile (retour utilisateur, essai bottom sheet 2026-08-18) : le morph d'image entre
    // en concurrence avec le slide-up CSS du bottom sheet (styles.css, @media max-width:768px), jugee
    // plus propre sans lui - deja le cas de facto pour showPublicWishlistItemDetail (public-profile.js),
    // seul appelant qui n'a jamais utilise ce morph, prefere par l'utilisateur au comparatif. Desktop
    // inchange (le morph grille -> fiche y reste l'effet voulu).
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    if (typeof document.startViewTransition !== 'function' || !sourceImg || isMobile) {
        renderFn();
        return;
    }

    sourceImg.style.viewTransitionName = 'card-detail-morph';

    const cleanup = () => {
        sourceImg.style.viewTransitionName = '';
        const modalImg = resolveModalImg();
        if (modalImg) modalImg.style.viewTransitionName = '';
    };

    const transition = runViewTransition('card-detail', () => {
        // La grille reste rendue derrière l'overlay (recouverte, pas masquée) : sans ce retrait, le
        // nom resterait porté par sourceImg ET modalImg en même temps dans l'état "new" capturé par
        // le navigateur - deux éléments réellement visibles avec le même view-transition-name, ce qui
        // fait skipper toute la transition sans animation (cause du bug d'ouverture sans morph visible).
        sourceImg.style.viewTransitionName = '';
        renderFn();
        const modalImg = resolveModalImg();
        if (modalImg) modalImg.style.viewTransitionName = 'card-detail-morph';
    });

    if (!transition) {
        // reduced-motion / API indisponible : runViewTransition a déjà exécuté renderFn()
        // directement en synchrone, aucune transition réelle n'a eu lieu - on retire juste le nom
        // posé au-dessus avant de le savoir, rien d'autre à faire.
        cleanup();
        return;
    }

    transition.finished.finally(cleanup);
}

// Badge en haut à droite de la carte : soit la quantité possédée (masqué si 1 seul exemplaire), soit
// le nombre de doublons échangeables (toujours affiché, jamais les deux en même temps - un seul appelant
// utilise chaque mode).
function renderGridCardBadge(card, badgeMode) {
    if (badgeMode === 'duplicate') {
        return `<div class="qty-badge" title="Doublons disponibles">↔ ${card.duplicateQuantity}</div>`;
    }
    const qty = Number(card.quantity || 1);
    return qty > 1 ? `<div class="qty-badge">×${qty}</div>` : '';
}

// L'event de clic est toujours passé en 2e argument à detailFn (ex: showCardDetail(id, event)) : sert
// à showCardDetail pour retrouver l'image source du morph View Transitions (Phase 4, card-detail.js) —
// showPublicCardDetail(cardId) l'ignore simplement, aucune fonction n'est obligée de l'utiliser.
// data-card-id (VT1, cf roadmap technique animations premium) : rend la racine adressable par id
// réel, pour que closeCardDetail() (card-detail.js) puisse retrouver la carte source à la fermeture
// (fermeture symétrique fiche -> grille) sans dépendre d'une référence DOM gardée pendant l'ouverture.
//
// Plafond du delai de cascade (.card-stagger-in, css/motion-components.css) : au-dela de cet index,
// toutes les cartes partagent le meme delai maximal plutot que de continuer a grimper - sur une
// collection dense (700+ cartes), sans plafond la dernière carte attendrait plusieurs secondes avant
// meme de commencer son animation. Seules les premières lignes visibles à l'écran profitent vraiment
// de la cascade, le reste apparaît en bloc juste après.
const GRID_STAGGER_CAP = 24;

// options :
//   detailFn          - nom de la fonction globale appelée au clic ('showCardDetail' | 'showPublicCardDetail')
//   badgeMode         - 'quantity' (défaut, ×N si qty>1) | 'duplicate' (↔N, toujours affiché)
//   imageFallback     - 'static' (défaut, icône non cliquable) | 'upload' (placeholder cliquable, écriture possible)
//   showAcquisitionIcon - true pour afficher l'icône booster/achat (absente des vues publiques, acquisition_type non exposé)
//   staggerIndex      - position de la carte dans le rendu courant (0-based) : si fourni, ajoute
//                       .card-stagger-in + le delai correspondant (plafonne a GRID_STAGGER_CAP).
//                       Absent par defaut - opt-in par appelant (Galerie Collection uniquement pour
//                       l'instant, cf renderCollectionGrid), pas applique aux grilles publiques/
//                       Classeur sans decision explicite pour elles.
//   holoEffect        - false par defaut. true ajoute la classe + les calques du survol holographique
//                       (retour utilisateur 2026-09, cf initHoloGridEffect plus bas) - opt-in explicite
//                       par appelant, comme staggerIndex : seule la Galerie Collection l'active
//                       (renderCollectionGrid), jamais le Classeur (binder-view.js) ni les grilles
//                       publiques (public-profile.js), deja denses/tierces, pas le lieu d'un effet
//                       de mise en avant.
function renderGridCardHtml(card, options) {
    const { detailFn, badgeMode = 'quantity', imageFallback = 'static', showAcquisitionIcon = false, staggerIndex = null, holoEffect = false } = options;

    const qty = Number(card.quantity || 1);
    const lineTotal = Number(card.market_value || 0) * qty;
    const conditionClass = (card.condition || '').toLowerCase();
    const staggerClass = staggerIndex === null ? '' : ' card-stagger-in';
    const staggerStyle = staggerIndex === null
        ? ''
        : ` style="--card-stagger-delay: calc(var(--motion-stagger-fast) * ${Math.min(staggerIndex, GRID_STAGGER_CAP)})"`;

    const fallbackCall = imageFallback === 'upload'
        ? `getCollectionUploadPlaceholder(${card.id}, 'full')`
        : 'getGridNoImageHtml()';
    const fallbackHtml = imageFallback === 'upload'
        ? getCollectionUploadPlaceholder(card.id, 'full')
        : getGridNoImageHtml();

    let acquisitionHtml = '';
    if (showAcquisitionIcon) {
        const icon = card.acquisition_type === 'pack' ? '<i class="ti ti-gift" aria-hidden="true"></i>' : '<i class="ti ti-shopping-bag" aria-hidden="true"></i>';
        const title = card.acquisition_type === 'pack' ? 'Sortie d\'un booster' : 'Achetée';
        acquisitionHtml = `<span class="acquisition-icon" title="${title}">${icon}</span>`;
    }

    const holoClass = holoEffect ? ' collection-card-holo' : '';
    const holoLayersHtml = holoEffect
        ? '<div class="collection-card-holo-sheen"></div><div class="collection-card-holo-glare"></div>'
        : '';

    return `
        <div class="collection-card${staggerClass}${holoClass}" data-card-id="${card.id}"${staggerStyle} onclick="${detailFn}(${card.id}, event)">
            ${card.image
                ? `<img src="${escapeHtml(card.image)}" alt="${escapeHtml(card.name)}" loading="lazy" onerror="this.outerHTML=${fallbackCall}">`
                : fallbackHtml
            }
            ${holoLayersHtml}
            ${renderGridCardBadge(card, badgeMode)}
            <div class="price-badge">${formatPrice(lineTotal)}</div>
            <div class="set-rarity-badge-row">
                ${card.series_symbol ? `<img src="${escapeHtml(card.series_symbol)}" class="set-symbol-badge" alt="" title="${escapeHtml(card.series)}" onerror="this.remove()">` : ''}
                ${getRarityIconHtml(card.rarity) ? `<div class="rarity-badge-corner" title="${escapeHtml(card.rarity)}">${getRarityIconHtml(card.rarity, 18)}</div>` : ''}
            </div>
            <div class="collection-card-overlay">
                <div class="collection-card-name">${escapeHtml(card.name)}</div>
                <div class="collection-card-set">${card.series_logo ? `<img src="${escapeHtml(card.series_logo)}" class="series-logo-inline" alt="" onerror="this.remove()">` : ''}${escapeHtml(card.series)} · #${escapeHtml(card.number)}</div>
                <span class="condition-badge-grid ${escapeHtml(conditionClass)}">${escapeHtml(card.condition)}</span>
                ${renderFinishBadge(card.finish, 'condition-badge-grid finish-badge', 12)}
                ${acquisitionHtml}
            </div>
        </div>
    `;
}

// Survol holographique (retour utilisateur 2026-09, mockup "Carte Holographique" valide) : incline
// la carte et fait suivre un reflet prismatique au curseur, comme un vrai film holo qu'on incline
// entre les mains - remplace deux tentatives precedentes (halo dore, reflet de vitrine) restees trop
// plates pour se voir sur une vignette de 190px, celle-ci reagit en temps reel au lieu d'etre un
// calque statique.
//
// Delegation sur le CONTENEUR de grille (pas un listener par carte) : une grille peut afficher
// jusqu'a 60 cartes + "Charger plus" en ajoute d'autres - un mousemove global, un closest() par
// evenement, est negligeable comparé a 60+ listeners recrees a chaque re-rendu. Attache UNE seule
// fois par conteneur (dataset.holoBound), le mousemove reevalue closest() a chaque appel donc suit
// les re-rendus (insertAdjacentHTML/innerHTML) sans jamais avoir besoin d'etre reattache.
//
// mouseout (bubbles) plutot que mouseleave (ne bubble pas) pour detecter la sortie d'UNE carte
// precise tout en restant delegue sur le conteneur - mouseleave sur le conteneur ne se declencherait
// qu'en quittant la grille entiere, pas en passant d'une carte a l'autre.
//
// Desactive entierement sur tactile (hover:none, pas de curseur a suivre en continu) et sous
// prefers-reduced-motion - la carte garde alors sa seule elevation au survol deja existante
// (.collection-card:hover, styles.css).
function initHoloGridEffect(container) {
    if (!container || container.dataset.holoBound) return;
    if (!window.matchMedia('(hover: hover)').matches || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    container.dataset.holoBound = 'true';

    const TILT_MAX_DEG = 10; // plus discret que le mockup (22°) : ces cartes restent cliquables au milieu d'une grille dense, un tilt trop marque genererait la lecture du nom/prix au survol

    container.addEventListener('mousemove', (e) => {
        const card = e.target.closest('.collection-card-holo');
        if (!card) return;
        const rect = card.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;
        const rotateY = (x - 0.5) * TILT_MAX_DEG;
        const rotateX = (0.5 - y) * TILT_MAX_DEG;
        // translateY(-3px) reprend la meme elevation que .collection-card:hover (styles.css) - sans
        // elle, cet inline style (qui gagne toujours sur la regle :hover) supprimerait l'elevation
        // existante des que la souris bouge, pas seulement l'angle.
        card.style.transform = `perspective(700px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-3px) scale(1.03)`;
        card.style.setProperty('--holo-x', `${x * 100}%`);
        card.style.setProperty('--holo-y', `${y * 100}%`);
        card.style.setProperty('--holo-glare', `${x * 100}%`);
        card.classList.add('is-holo-active');
    });

    container.addEventListener('mouseout', (e) => {
        const card = e.target.closest('.collection-card-holo');
        if (!card || card.contains(e.relatedTarget)) return;
        card.style.transform = '';
        card.classList.remove('is-holo-active');
    });
}

window.getGridNoImageHtml = getGridNoImageHtml;
window.initHoloGridEffect = initHoloGridEffect;
window.renderGridCardHtml = renderGridCardHtml;
window.runCardDetailMorphTransition = runCardDetailMorphTransition;
