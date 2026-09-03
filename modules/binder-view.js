// Vue Classeur - 3e mode d'affichage de l'onglet Collection (Phase 4, cf roadmap technique)
// Dépend de: getFilteredSortedCollection/isCollectionMobileViewport/collectionViewMode/
// getCollectionEmptyStateHtml (collection.js), renderGridCardHtml (card-grid-renderer.js)
//
// Consomme exactement getFilteredSortedCollection() (mêmes filtres/tri/recherche que Galerie/Tableau,
// aucune logique de données propre au classeur - un set filtré devient donc automatiquement un
// "classeur de set" sans code dédié). Slots réutilisent renderGridCardHtml() tel quel (audit Phase 4 :
// .collection-card n'a pas de largeur en dur, s'adapte à son conteneur .binder-slot sans modification).
//
// Desktop = vraie double-page (2 pages de 9 = 18 cartes/double-page, décision produit 2026-08-14).
// Mobile (<=768px, même seuil que isCollectionMobileViewport()) = 1 page de 2x2 = 4 cartes, jamais de
// double-page miniature.
//
// B3 (clavier) + B4 (breakpoint/swipe mobile) : setupBinderLifecycle()/teardownBinderLifecycle()
// attachent/détachent en bloc keydown (document), matchMedia 768px (recalcul pagination + toggle
// pointer), click-capture et pointer events mobiles (posés sur #collection-binder-wrapper, jamais
// document) - jamais à chaque rendu de page. Appelés depuis setCollectionView() (collection.js) à
// l'entrée/sortie du mode binder, et depuis le hook hashchange (tracker.js) à la sortie/au retour de
// tab-collection en étant en mode binder.
//
// B6 : preloadAdjacentBinderPages() précharge les images de la double-page/page adjacente (précédente
// + suivante uniquement, jamais plus loin), appelée à chaque renderBinderView(). new Image() = pas de
// DOM monté, juste le cache HTTP du navigateur alimenté en avance.
//
// B8 (mobile) : slide+fade WAAPI léger sur goToBinderSpread(), cf animateBinderPageChange() plus bas.
// N'affecte aucun comportement de B1-B7 - seule la transition visuelle entre deux rendus change.
//
// B9 (desktop, branche tech/phase-4-binder-pageturn, dérivée de B8) : vrai flip 180deg d'un feuillet
// recto/verso superposé, hinge sur la reliure (refonte 2026-09, retour utilisateur - remplace une
// première version en rotation ~90deg jugée pas assez réaliste) - cf animateBinderDesktopFlip.

// window.x plutôt que let (ticket V2 Vite, type="module") : lu/écrit uniquement dans ce fichier pour
// l'instant, mais suit la convention du projet par cohérence avec collectionDisplayLimit (collection.js).
window.binderSpreadIndex = 0;

function resetBinderPage() {
    binderSpreadIndex = 0;
}

// 18 cartes/double-page desktop (2x9), 4 cartes/page mobile (2x2) - jamais de double-page miniature
// sur mobile (décision produit 2026-08-14, cf audit §4/§6).
function getBinderSpreadSize() {
    return isCollectionMobileViewport() ? 4 : 18;
}

function getBinderPageSize() {
    return isCollectionMobileViewport() ? 4 : 9;
}

// Rend N slots (9 desktop, 4 mobile) : une carte réelle via renderGridCardHtml si disponible, sinon
// une poche vide statique (garde la structure physique du classeur sur une double-page incomplète,
// cf audit §8 - jamais compactée).
function renderBinderPageGrid(cards, slotCount) {
    let html = '';
    for (let i = 0; i < slotCount; i++) {
        const card = cards[i];
        html += card
            ? `<div class="binder-slot">${renderGridCardHtml(card, { detailFn: 'showCardDetail', imageFallback: 'upload', showAcquisitionIcon: true })}</div>`
            : '<div class="binder-slot binder-slot-empty"></div>';
    }
    return html;
}

function renderBinderView(cards) {
    const wrapper = document.getElementById('collection-binder-wrapper');
    if (!wrapper) return;

    if (cards.length === 0) {
        // Vraiment vide (nouvel utilisateur) -> même état illustré que Galerie/Tableau ; un filtre
        // sans résultat reste le texte simple existant.
        wrapper.innerHTML = allCollectionCards.length === 0
            ? getCollectionEmptyStateHtml()
            : '<div class="binder-empty-state"><i class="ti ti-search-off" aria-hidden="true"></i><p>Aucune carte trouvée</p></div>';
        return;
    }

    const mobile = isCollectionMobileViewport();
    const spreadSize = getBinderSpreadSize();
    const pageSize = getBinderPageSize();
    const totalSpreads = Math.ceil(cards.length / spreadSize);

    // Borne défensive : le nombre de cartes a pu changer (filtre) sans que binderSpreadIndex soit
    // remis à 0 depuis un autre chemin d'appel que filterAndDisplay().
    if (binderSpreadIndex >= totalSpreads) binderSpreadIndex = totalSpreads - 1;
    if (binderSpreadIndex < 0) binderSpreadIndex = 0;

    const start = binderSpreadIndex * spreadSize;

    let pagesHtml;
    if (mobile) {
        const pageCards = cards.slice(start, start + pageSize);
        pagesHtml = `
            <div class="binder-page binder-page-left">
                <div class="binder-page-grid">${renderBinderPageGrid(pageCards, pageSize)}</div>
            </div>
        `;
    } else {
        const leftCards = cards.slice(start, start + pageSize);
        const rightCards = cards.slice(start + pageSize, start + pageSize * 2);
        pagesHtml = `
            <div class="binder-page binder-page-left">
                <div class="binder-page-grid">${renderBinderPageGrid(leftCards, pageSize)}</div>
            </div>
            <div class="binder-spine"></div>
            <div class="binder-page binder-page-right">
                <div class="binder-page-grid">${renderBinderPageGrid(rightCards, pageSize)}</div>
            </div>
        `;
    }

    const indicatorLabel = mobile
        ? `Page ${binderSpreadIndex + 1} sur ${totalSpreads}`
        : `Double-page ${binderSpreadIndex + 1} sur ${totalSpreads}`;

    wrapper.innerHTML = `
        <div class="binder-scene">
            <button type="button" class="binder-nav-btn binder-nav-prev" onclick="goToBinderSpread(-1)" ${binderSpreadIndex === 0 ? 'disabled' : ''} aria-label="Page précédente"><i class="ti ti-chevron-left" aria-hidden="true"></i></button>
            <div class="binder-book">
                <div class="binder-spread">${pagesHtml}</div>
            </div>
            <button type="button" class="binder-nav-btn binder-nav-next" onclick="goToBinderSpread(1)" ${binderSpreadIndex >= totalSpreads - 1 ? 'disabled' : ''} aria-label="Page suivante"><i class="ti ti-chevron-right" aria-hidden="true"></i></button>
        </div>
        <div class="binder-page-indicator">${indicatorLabel}</div>
    `;

    preloadAdjacentBinderPages(cards, spreadSize, totalSpreads);
}

// B6 : précharge silencieusement les images des double-pages/pages adjacentes (précédente + suivante),
// jamais plus loin. new Image() déclenche le fetch navigateur sans monter de DOM - aucun élément créé
// n'est jamais inséré dans le document, juste laissé au garbage collector une fois le fetch lancé (le
// cache HTTP du navigateur retient l'image, pas la référence JS). Cartes sans image (card.image absent,
// placeholder d'upload) ignorées - rien à précharger pour elles.
function preloadCardImages(cardsToPreload) {
    cardsToPreload.forEach(card => {
        if (card && card.image) new Image().src = card.image;
    });
}

function preloadAdjacentBinderPages(cards, spreadSize, totalSpreads) {
    if (binderSpreadIndex > 0) {
        const prevStart = (binderSpreadIndex - 1) * spreadSize;
        preloadCardImages(cards.slice(prevStart, prevStart + spreadSize));
    }
    if (binderSpreadIndex < totalSpreads - 1) {
        const nextStart = (binderSpreadIndex + 1) * spreadSize;
        preloadCardImages(cards.slice(nextStart, nextStart + spreadSize));
    }
}

function goToBinderSpread(delta) {
    animateBinderPageChange(delta, () => {
        binderSpreadIndex += delta;
        renderBinderView(getFilteredSortedCollection());
    });
}

// ===== Animation de changement de double-page/page (WAAPI, cf roadmap technique) =====
// Mobile (B8) : slide+fade léger sur .binder-book en entier. Desktop (B9) : vrai flip 180deg d'un seul
// feuillet recto/verso, hinge sur la reliure - cf animateBinderDesktopFlip plus bas pour le détail de
// la technique et son historique (plusieurs tentatives intermédiaires abandonnées avant celle-ci).
//
// BINDER_SLIDE_DISTANCE : aucun token --motion-distance-* existant n'est calibré pour ce cas (ils
// servent des micro-interactions hover de quelques px) - valeur minimale dédiée, volontairement petite.
// Durée/easing du mobile (B8) lisent directement --motion-duration-normal/--motion-ease-standard (cf
// readMotionDurationMs/readMotionEasing ci-dessous) plutôt que de dupliquer leur valeur en dur - un
// audit a trouvé un ancien duplicata (260ms) qui avait divergé du token (450ms) sans que rien ne le
// signale.
function readMotionDurationMs(varName, fallbackMs) {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    const ms = raw.endsWith('ms') ? parseFloat(raw) : raw.endsWith('s') ? parseFloat(raw) * 1000 : NaN;
    return Number.isFinite(ms) ? ms : fallbackMs;
}
function readMotionEasing(varName, fallback) {
    return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || fallback;
}
const BINDER_SLIDE_DISTANCE = 22; // px - mobile uniquement (B8)
const BINDER_ANIM_DURATION = readMotionDurationMs('--motion-duration-normal', 450); // mobile (B8) uniquement
// Desktop (B9) : rotation complète (180deg, contre 420ms/90deg avant refonte) - un feuillet qui voyage
// réellement d'une case à l'autre a besoin d'un peu plus de temps pour se lire, cf commentaire détaillé
// sur animateBinderDesktopFlip. Volontairement indépendante du token de durée partagé, comme avant.
// 480ms -> 750ms -> 600ms (retour utilisateur 2026-09, essai comparatif) : le geste a plus de temps
// pour se lire une fois la geometrie (charniere) et la case liberee (mi-course) corrigees, 750ms jugé
// un peu long.
const BINDER_FLIP_DURATION = 600; // ms - desktop uniquement (B9)
const BINDER_FLIP_EASING = 'cubic-bezier(0.65, 0, 0.35, 1)'; // accélère puis décélère, courbe symétrique
const BINDER_ANIM_EASING = readMotionEasing('--motion-ease-standard', 'cubic-bezier(0.2, 0, 0, 1)');

let binderAnimating = false;
// Token de génération : incrémenté à chaque animation démarrée ET à chaque teardown. Le .finally()
// d'une animation ne remet binderAnimating à false que s'il porte encore le token courant - évite
// qu'un .finally() tardif (ex: animation A dont le teardown a eu lieu pendant qu'elle tournait encore,
// suivi d'un retour rapide en mode binder qui démarre l'animation B) ne vienne remettre le flag à false
// pendant que B est en vol. Pas de scheduler/queue : juste un compteur comparé à la lecture.
let binderAnimationToken = 0;

// direction > 0 : navigation "suivant". direction < 0 : "précédent".
// renderFn : la mise à jour d'état + rerender existante (goToBinderSpread ci-dessus) - jamais réécrite,
// juste appelée à un moment différent selon la branche (immédiatement sur mobile, en fin d'animation
// sur desktop - cf animateBinderDesktopFlip).
function animateBinderPageChange(direction, renderFn) {
    // Navigation rapide (clics/swipes répétés) : on ignore plutôt que d'empiler ou d'interrompre une
    // animation en cours - stratégie la plus simple et la plus robuste (jamais deux animations ou deux
    // rerenders qui se chevauchent, jamais d'état binderSpreadIndex incohérent).
    if (binderAnimating) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const wrapper = document.getElementById('collection-binder-wrapper');
    const oldBook = wrapper ? wrapper.querySelector('.binder-book') : null;

    // Filet : sans support WAAPI, sans page déjà montée (état vide), ou reduced-motion -> comportement
    // instantané, jamais bloquant.
    if (prefersReducedMotion || !wrapper || !oldBook || typeof oldBook.animate !== 'function') {
        renderFn();
        return;
    }

    if (isCollectionMobileViewport()) {
        animateBinderMobileSlide(direction, renderFn, wrapper, oldBook);
    } else {
        animateBinderDesktopFlip(direction, renderFn, wrapper, oldBook);
    }
}

// B8 (mobile) : slide+fade sur .binder-book en entier (une seule page 2x2, pas de reliure à faire
// tourner) - clone-et-fade classique, comportement inchangé depuis l'origine.
function animateBinderMobileSlide(direction, renderFn, wrapper, oldBook) {
    binderAnimating = true;
    const myToken = ++binderAnimationToken;

    const oldRect = oldBook.getBoundingClientRect();
    const clone = oldBook.cloneNode(true);
    clone.setAttribute('aria-hidden', 'true');
    clone.inert = true;
    Object.assign(clone.style, {
        position: 'fixed',
        left: `${oldRect.left}px`,
        top: `${oldRect.top}px`,
        width: `${oldRect.width}px`,
        height: `${oldRect.height}px`,
        margin: '0',
        zIndex: '50',
        pointerEvents: 'none'
    });
    document.body.appendChild(clone);

    const timing = { duration: BINDER_ANIM_DURATION, easing: BINDER_ANIM_EASING, fill: 'none' };
    const exitAnims = animateBinderSlideExit(clone, direction, timing);

    renderFn(); // rebuild synchrone - la nouvelle page est en place dès cette ligne.

    const newBook = wrapper.querySelector('.binder-book');
    const enterAnims = (newBook && typeof newBook.animate === 'function')
        ? animateBinderSlideEnter(newBook, direction, timing)
        : [];

    Promise.all([...exitAnims, ...enterAnims].map(a => a.finished))
        .catch(() => {})
        .finally(() => {
            clone.remove();
            if (myToken === binderAnimationToken) binderAnimating = false;
        });
}

function animateBinderSlideExit(book, direction, timing) {
    const offset = direction > 0 ? -BINDER_SLIDE_DISTANCE : BINDER_SLIDE_DISTANCE;
    return [book.animate(
        [{ transform: 'translateX(0)', opacity: 1 }, { transform: `translateX(${offset}px)`, opacity: 0 }],
        timing
    )];
}

function animateBinderSlideEnter(book, direction, timing) {
    const offset = direction > 0 ? BINDER_SLIDE_DISTANCE : -BINDER_SLIDE_DISTANCE;
    return [book.animate(
        [{ transform: `translateX(${offset}px)`, opacity: 0 }, { transform: 'translateX(0)', opacity: 1 }],
        timing
    )];
}

// B9 (desktop) - refonte complète (retour utilisateur 2026-09) : après plusieurs tentatives ratées sur
// la version "swing 90deg puis disparaît" (ajout de profondeur/ombre/easing - toutes rejetées, cf
// historique retiré de ce commentaire par manque de valeur une fois la bonne piste trouvée), référence
// concrète fournie par l'utilisateur (illu-dex.web.app/binder) et inspectée en direct via DevTools.
//
// La différence clé avec l'ancienne version : au lieu de faire pivoter la VRAIE page du DOM sur place
// (qui rétrécit et disparaît dans le vide), un unique feuillet TEMPORAIRE recto/verso est superposé,
// ancré à son propre bord côté reliure (transform-origin, comme avant) et pivoté à 180deg COMPLETS
// (contre 90deg avant). Par la seule géométrie de rotateY autour d'un bord fixe, ce feuillet balaie
// visuellement de sa case de départ vers la case d'arrivée opposée - AUCUNE translation en JS
// nécessaire, juste la rotation. Son recto montre le contenu actuel de la case de départ (clone du
// vrai DOM), son verso montre déjà le contenu de la case d'arrivée une fois la double-page tournée
// (pré-calculé via computeBinderSpreadCards, sans toucher au DOM réel ni à binderSpreadIndex).
//
// `renderFn` (la vraie mise à jour de binderSpreadIndex + re-render) n'est appelée qu'À LA FIN, une
// fois le feuillet retiré - jamais avant. Résout enfin la tension "double-page entière vs flip page à
// page" qui avait fait abandonner cette piste à l'origine : le DOM réel ne change jamais sous les yeux
// de l'utilisateur pendant le flip (aucun "pop" de contenu à masquer), le feuillet est le seul élément
// visible qui bouge, exactement comme sur la référence observée.
function animateBinderDesktopFlip(direction, renderFn, wrapper, oldBook) {
    const oldLeft = oldBook.querySelector('.binder-page-left');
    const oldRight = oldBook.querySelector('.binder-page-right');
    const turningPage = direction > 0 ? oldRight : oldLeft;

    if (!turningPage || typeof turningPage.animate !== 'function') {
        renderFn();
        return;
    }

    binderAnimating = true;
    const myToken = ++binderAnimationToken;

    // "suivant" : la page DROITE tourne et atterrit à GAUCHE (comme dans un vrai livre - on tourne la
    // page de droite, elle rejoint la pile de gauche). "précédent" : l'inverse.
    const turningOrigin = direction > 0 ? 'left center' : 'right center';
    const landingClass = direction > 0 ? 'binder-page-left' : 'binder-page-right';
    // Même convention de signe que l'ancienne version 90deg (vérifiée géométriquement à l'époque) :
    // négatif si le pivot est à gauche, positif s'il est à droite - juste doublée à 180.
    const turningAngle = direction > 0 ? -180 : 180;

    const pageRect = turningPage.getBoundingClientRect();
    const newSpread = computeBinderNewSpreadCards(direction);
    // "suivant" atterrit sur la nouvelle page GAUCHE (verso du feuillet), "précédent" sur la nouvelle
    // page DROITE - cf commentaire sur turningOrigin/landingClass plus haut. sameSideCards : le contenu
    // de la case que le feuillet vient de libérer (même côté que turningPage), affiché à mi-course
    // directement dans le VRAI DOM (cf plus bas) - pas sur le feuillet, qui ne s'occupe que du verso.
    const landingCards = direction > 0 ? newSpread.leftCards : newSpread.rightCards;
    const sameSideCards = direction > 0 ? newSpread.rightCards : newSpread.leftCards;

    // Charnière recalée sur le CENTRE de la reliure, pas sur le bord de la page (retour utilisateur
    // 2026-09, capture "pas d'anneaux au milieu, la largeur se réajuste après") : la page elle-même
    // s'arrête avant la reliure (gap flex + .binder-spine, ~30-50px au total), donc ancrer le feuillet
    // sur turningPage.getBoundingClientRect() pivotait à cet endroit-là plutôt qu'au vrai centre de la
    // reliure. Sur 180deg, ce décalage se double et le feuillet atterrissait visiblement enfoncé dans
    // la reliure côté opposé, la masquant - d'où l'impression de "manque d'anneaux/largeur réduite" le
    // temps de l'animation, corrigée d'un coup au rendu final (renderFn) - un vrai "réajustement".
    // Le feuillet est donc élargi jusqu'au centre de la reliure ; son bord extérieur (loin de la
    // reliure) ne bouge pas. Le vrai contenu de page (recto ET verso) est réinséré à sa largeur
    // normale (pageRect.width) DANS cette boîte élargie, décalé du côté opposé à la reliure - la
    // tranche ajoutée reste transparente et laisse voir la reliure réelle (toujours dans le DOM normal,
    // jamais recouverte) par transparence.
    const spineEl = oldBook.querySelector('.binder-spine');
    const spineRect = spineEl ? spineEl.getBoundingClientRect() : null;
    const hingeX = spineRect
        ? spineRect.left + spineRect.width / 2
        : (direction > 0 ? pageRect.left : pageRect.right); // repli si .binder-spine absent (mobile n'arrive jamais ici)

    const boxLeft = direction > 0 ? hingeX : pageRect.left;
    const boxRight = direction > 0 ? pageRect.right : hingeX;
    const boxWidth = boxRight - boxLeft;
    // Décalage du contenu réel (largeur pageRect.width) à l'intérieur de la boîte élargie - toujours
    // du côté OPPOSÉ à la reliure (loin de hingeX), l'autre côté restant vide/transparent.
    const contentOffset = pageRect.left - boxLeft; // >=0 par construction

    const scene = document.createElement('div');
    scene.setAttribute('aria-hidden', 'true');
    scene.inert = true;
    Object.assign(scene.style, {
        position: 'fixed',
        left: `${boxLeft}px`,
        top: `${pageRect.top}px`,
        width: `${boxWidth}px`,
        height: `${pageRect.height}px`,
        // 1800px -> 2400px + origine décalée (retour utilisateur 2026-09, référence illu-dex.web.app -
        // valeurs exactes relevées via DevTools sur sa scène de flip) : distance de perspective plus
        // longue = raccourci 3D plus subtil, moins "grand-angle" ; perspective-origin légèrement
        // au-dessus du centre = angle de vue "on regarde le classeur d'en haut, posé sur une table",
        // plutôt que pile en face.
        perspective: '2400px',
        perspectiveOrigin: '50% 45%',
        zIndex: '60',
        pointerEvents: 'none'
    });

    const leaf = document.createElement('div');
    leaf.className = 'binder-flip-leaf';
    // Le pivot reste sur le bord de la boîte côté reliure - désormais exactement hingeX puisque ce
    // bord de la boîte a été recalé dessus ci-dessus.
    leaf.style.transformOrigin = turningOrigin;

    // Recto : clone direct du vrai DOM (garde exactement le même rendu que la page actuelle, images
    // déjà chargées comprises - pas de re-render depuis les données). Enveloppe transparente
    // (.binder-flip-face) de la largeur de la boîte élargie ; le clone lui-même retrouve sa largeur
    // réelle et son décalage via un style inline, positionné côté extérieur (loin de la reliure).
    const front = document.createElement('div');
    front.className = 'binder-flip-face binder-flip-face-front';
    const frontInner = turningPage.cloneNode(true);
    frontInner.removeAttribute('id');
    Object.assign(frontInner.style, {
        position: 'absolute', top: '0', left: `${contentOffset}px`, width: `${pageRect.width}px`, height: '100%'
    });
    front.appendChild(frontInner);

    // Verso : construit depuis les données (pas de vrai DOM existant pour ce contenu pas encore
    // affiché) - mêmes classes que la case d'ARRIVÉE pour hériter du bon arrondi/ombre visuels. Décalé
    // en miroir (right plutôt que left) : le verso porte sa propre rotation locale de 180deg (cf CSS,
    // pour ne pas apparaître inversé) qui mirrore aussi tout positionnement interne - "right:
    // contentOffset" ici produit donc bien "loin de la reliure" une fois cette rotation appliquée,
    // symétrique au recto (vérifié en direct, pas juste déduit sur le papier).
    const back = document.createElement('div');
    back.className = 'binder-flip-face binder-flip-face-back';
    const backInner = document.createElement('div');
    backInner.className = `binder-page ${landingClass}`;
    Object.assign(backInner.style, {
        position: 'absolute', top: '0', right: `${contentOffset}px`, width: `${pageRect.width}px`, height: '100%'
    });
    backInner.innerHTML = `<div class="binder-page-grid">${renderBinderPageGrid(landingCards, newSpread.pageSize)}</div>`;
    back.appendChild(backInner);

    leaf.appendChild(front);
    leaf.appendChild(back);
    scene.appendChild(leaf);
    document.body.appendChild(scene);

    // fill:'forwards' (pas 'none' comme B8/l'ancienne version) : `anim.finished` se résout un tick
    // après la fin réelle de l'animation (microtask), pas de façon strictement synchrone avec la
    // dernière frame peinte - avec fill:'none', le feuillet reprenait sa transform de base
    // (rotateY(0deg), donc recouvrait de nouveau sa case de DÉPART) pendant cette fenêtre, le temps
    // qu'au moins une frame soit peinte avant que .finally() ne le retire - visible comme un
    // "décalage"/flash au niveau de la reliure (retour utilisateur 2026-09, repéré sur vidéo). forwards
    // garde le feuillet figé à son état final (atterri, verso visible) jusqu'à son retrait explicite.
    const anim = leaf.animate(
        [{ transform: 'rotateY(0deg)' }, { transform: `rotateY(${turningAngle}deg)` }],
        { duration: BINDER_FLIP_DURATION, easing: BINDER_FLIP_EASING, fill: 'forwards' }
    );

    // Case libérée (retour utilisateur 2026-09, référence illu-dex.web.app - "la page de droite se
    // remplit avec les nouvelles cartes quand la page tournée passe le milieu") : dès que le feuillet a
    // dépassé 90deg (progress >= 0.5), il ne recouvre plus la case de DÉPART de turningPage (il est
    // parti recouvrir la case d'arrivée, cf le sens de rotation), qui redevient visible - jusque-là,
    // elle affichait encore l'ancien contenu. On la fait basculer sur le contenu de la NOUVELLE
    // double-page pour ce même côté à cet instant précis, directement dans le vrai DOM (turningPage
    // reste le même noeud, seule sa grille de cartes est remplacée) - sans toucher à binderSpreadIndex
    // ni à l'autre page, qui restent gérées par renderFn() en fin d'animation comme avant.
    // getComputedTiming().progress (pas un simple setTimeout à moitié de la durée) : reste correct même
    // si l'easing n'est pas parfaitement symétrique dans le temps.
    let sameSideSwapped = false;
    function checkSameSideSwap() {
        if (sameSideSwapped || myToken !== binderAnimationToken) return;
        const progress = anim.effect.getComputedTiming().progress;
        if (progress === null) return; // anim pas encore démarrée
        if (progress >= 0.5) {
            sameSideSwapped = true;
            if (turningPage.isConnected) {
                const grid = turningPage.querySelector('.binder-page-grid');
                if (grid) {
                    // Fondu d'apparition (retour utilisateur 2026-09, "trop brutal" puis "scintillement sur
                    // tout le classeur" avec un grid.animate() WAAPI) : une transition CSS statique (classe
                    // .binder-page-grid, binder.css) plutôt qu'une Animation WAAPI créée à la volée - un
                    // .animate() pendant que le feuillet tourne encore en 3D juste à côté semble forcer une
                    // recomposition GPU plus large que prévu (même famille de bug que le fondu de couverture
                    // plus haut dans ce fichier).
                    // Double rAF (pas juste un reflow forcé - testé, pas fiable) avant de repasser à
                    // opacity:1 : le navigateur a besoin d'un cycle de peinture complet avec opacity:0
                    // déjà committé pour traiter le retour à 1 comme une transition, pas un saut silencieux.
                    grid.style.opacity = '0';
                    grid.innerHTML = renderBinderPageGrid(sameSideCards, newSpread.pageSize);
                    requestAnimationFrame(() => requestAnimationFrame(() => {
                        if (grid.isConnected) grid.style.opacity = '1';
                    }));
                }
            }
            return;
        }
        requestAnimationFrame(checkSameSideSwap);
    }
    requestAnimationFrame(checkSameSideSwap);

    anim.finished
        .catch(() => {})
        .finally(() => {
            scene.remove();
            renderFn(); // seul moment où le DOM réel (les deux pages) change - synchrone, donc invisible
                        // (le feuillet vient d'être retiré sur la ligne précédente, rien à peindre entre les deux).
            if (myToken === binderAnimationToken) binderAnimating = false;
        });
}

// Calcule le contenu des DEUX pages de la nouvelle double-page (celle vers laquelle on navigue) sans
// toucher à binderSpreadIndex ni au DOM réel - mêmes bornes défensives que renderBinderView (dupliquées
// ici à dessein : brancher sur le rendu réel aurait forcé à monter la nouvelle double-page en avance,
// exactement ce que cette technique évite, cf commentaire d'animateBinderDesktopFlip). Les deux côtés
// sont nécessaires : le verso du feuillet (case d'ARRIVÉE) ET la case que le feuillet vient de LIBÉRER,
// mise à jour à mi-course (retour utilisateur 2026-09, référence illu-dex - "la page de droite se
// remplit quand la page tournée passe le milieu").
function computeBinderNewSpreadCards(direction) {
    const cards = getFilteredSortedCollection();
    const spreadSize = getBinderSpreadSize();
    const pageSize = getBinderPageSize();
    const totalSpreads = Math.max(1, Math.ceil(cards.length / spreadSize));

    let index = binderSpreadIndex + direction;
    if (index >= totalSpreads) index = totalSpreads - 1;
    if (index < 0) index = 0;

    const start = index * spreadSize;
    return {
        pageSize,
        leftCards: cards.slice(start, start + pageSize),
        rightCards: cards.slice(start + pageSize, start + pageSize * 2)
    };
}

// ===== B3 : clavier =====

function isEditableElement(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}

function handleBinderKeydown(e) {
    if (isEditableElement(document.activeElement)) return;
    if (e.key === 'ArrowLeft') {
        goToBinderSpread(-1);
    } else if (e.key === 'ArrowRight') {
        goToBinderSpread(1);
    }
}

// ===== B4 : breakpoint (matchMedia) - remplace l'ancien listener resize permanent (B1/B2) =====
// matchMedia('change') ne se déclenche qu'au franchissement réel du seuil 768px, jamais à chaque
// pixel de redimensionnement (contrairement à un listener 'resize' debouncé) - c'est la seule chose
// qui doit faire recalculer la pagination binder, puisque la taille de page (18 vs 4 cartes) ne
// dépend que de ce seuil, pas de la largeur exacte. Même chaîne de médias que isCollectionMobileViewport()
// (collection.js) pour rester cohérent avec le reste de l'app.

// Passage 18<->4 cartes/page déterministe et simple : convertit l'index de double-page actuel en
// "position approximative dans la collection" (spread * ancienne taille de page) puis retrouve la
// nouvelle double-page qui contient cette position. Ne prétend pas retomber sur exactement les mêmes
// cartes (non demandé) - garantit seulement un index valide, jamais négatif/hors bornes (renderBinderView
// clampe de toute façon en filet de sécurité), jamais d'erreur JS.
function handleBinderBreakpointChange(e) {
    const nowMobile = e.matches;
    const oldSpreadSize = nowMobile ? 18 : 4;
    const newSpreadSize = nowMobile ? 4 : 18;
    const approxCardIndex = binderSpreadIndex * oldSpreadSize;
    binderSpreadIndex = Math.floor(approxCardIndex / newSpreadSize);

    if (nowMobile) {
        attachBinderPointerHandlers();
    } else {
        detachBinderPointerHandlers();
    }
    renderBinderView(getFilteredSortedCollection());
}

// ===== B4 : swipe (Pointer Events, posés sur le conteneur binder - jamais document) =====
// #collection-binder-wrapper est un nœud DOM stable (déclaré une fois dans index.html, jamais recréé -
// renderBinderView ne remplace que son innerHTML) : les listeners posés dessus survivent à tous les
// rendus de page suivants, aucun besoin de les ré-attacher à chaque renderBinderView().
//
// Axis-lock en 3 états (pending -> horizontal|vertical) : sous le seuil BINDER_SWIPE_INTENT_PX, on
// n'a pas encore d'avis (état 'pending', rien n'est empêché - le navigateur peut toujours décider de
// scroller). Une fois le seuil franchi, l'axe dominant est tranché UNE fois pour tout le geste ; si
// vertical, on abandonne complètement (aucun preventDefault, aucun état conservé) et le scroll natif
// reprend la main sans interférence. Seul l'état 'horizontal' appelle preventDefault (et seulement à
// partir de ce moment, jamais avant que l'axe soit tranché).
const BINDER_SWIPE_INTENT_PX = 10;
const BINDER_SWIPE_TRIGGER_PX = 56;

let binderSwipeState = null; // null | 'pending' | 'horizontal' | 'vertical'
let binderSwipeStartX = 0;
let binderSwipeStartY = 0;
let binderSwipePointerId = null;
let binderSuppressNextClick = false;
let binderSuppressClickTimer = null;

function handleBinderPointerDown(e) {
    binderSwipePointerId = e.pointerId;
    binderSwipeStartX = e.clientX;
    binderSwipeStartY = e.clientY;
    binderSwipeState = 'pending';
}

function handleBinderPointerMove(e) {
    if (binderSwipeState === null || e.pointerId !== binderSwipePointerId) return;
    if (binderSwipeState === 'vertical') return; // geste déjà abandonné pour ce pointer, rien à faire

    const dx = e.clientX - binderSwipeStartX;
    const dy = e.clientY - binderSwipeStartY;

    if (binderSwipeState === 'pending') {
        if (Math.abs(dx) < BINDER_SWIPE_INTENT_PX && Math.abs(dy) < BINDER_SWIPE_INTENT_PX) return;
        binderSwipeState = Math.abs(dx) > Math.abs(dy) * 1.5 ? 'horizontal' : 'vertical';
        if (binderSwipeState === 'vertical') return;
    }

    e.preventDefault(); // uniquement atteint quand l'axe est déjà tranché horizontal
}

function handleBinderPointerUp(e) {
    if (binderSwipeState === null || e.pointerId !== binderSwipePointerId) return;

    if (binderSwipeState === 'horizontal') {
        const dx = e.clientX - binderSwipeStartX;
        // Un vrai drag horizontal (même sous le seuil de déclenchement de page) ne doit jamais se
        // terminer par l'ouverture d'une fiche carte au relâchement - cf handleBinderClickCapture.
        binderSuppressNextClick = true;
        // Filet si aucun click ne consomme le flag (relâché au-dessus d'une zone vide). Le timer
        // précédent est explicitement annulé avant d'en reposer un (jamais deux en vol simultanément),
        // et nettoyé au teardown - sinon un swipe suivi d'un Binder->Galerie->Binder rapide (<400ms)
        // pourrait laisser un timer périmé annuler à tort la suppression d'un nouveau swipe.
        clearTimeout(binderSuppressClickTimer);
        binderSuppressClickTimer = setTimeout(() => {
            binderSuppressNextClick = false;
            binderSuppressClickTimer = null;
        }, 400);
        if (Math.abs(dx) >= BINDER_SWIPE_TRIGGER_PX) {
            goToBinderSpread(dx < 0 ? 1 : -1); // swipe gauche (dx<0) -> page suivante
        }
    }

    binderSwipeState = null;
    binderSwipePointerId = null;
}

function handleBinderPointerCancel(e) {
    if (e.pointerId !== binderSwipePointerId) return;
    binderSwipeState = null;
    binderSwipePointerId = null;
}

// Capture (3e argument true) : s'exécute avant l'onclick du slot cliqué (posé en bulle par
// renderGridCardHtml), donc peut l'empêcher d'atteindre sa cible. Scopé à #collection-binder-wrapper
// uniquement - n'intercepte jamais un clic en Galerie/Tableau.
function handleBinderClickCapture(e) {
    if (binderSuppressNextClick) {
        binderSuppressNextClick = false;
        e.stopPropagation();
        e.preventDefault();
    }
}

let binderPointerHandlersAttached = false;

function attachBinderPointerHandlers() {
    if (binderPointerHandlersAttached) return;
    const wrapper = document.getElementById('collection-binder-wrapper');
    if (!wrapper) return;
    wrapper.addEventListener('pointerdown', handleBinderPointerDown);
    wrapper.addEventListener('pointermove', handleBinderPointerMove);
    wrapper.addEventListener('pointerup', handleBinderPointerUp);
    wrapper.addEventListener('pointercancel', handleBinderPointerCancel);
    binderPointerHandlersAttached = true;
}

function detachBinderPointerHandlers() {
    if (!binderPointerHandlersAttached) return;
    const wrapper = document.getElementById('collection-binder-wrapper');
    if (wrapper) {
        wrapper.removeEventListener('pointerdown', handleBinderPointerDown);
        wrapper.removeEventListener('pointermove', handleBinderPointerMove);
        wrapper.removeEventListener('pointerup', handleBinderPointerUp);
        wrapper.removeEventListener('pointercancel', handleBinderPointerCancel);
    }
    binderPointerHandlersAttached = false;
    binderSwipeState = null;
    binderSwipePointerId = null;
    clearTimeout(binderSuppressClickTimer);
    binderSuppressClickTimer = null;
    binderSuppressNextClick = false;
}

// ===== Lifecycle unifié (B3 + B4) =====
// binderKeydownHandler reste le seul indicateur d'état "lifecycle actif" (idempotence) : tout le
// reste (matchMedia, click-capture, pointer si mobile) est attaché/détaché en bloc avec lui, jamais
// indépendamment. Appelé uniquement par setCollectionView() (collection.js, entrée/sortie du mode
// binder) et par le hook hashchange (tracker.js, sortie/retour sur tab-collection en mode binder) -
// jamais à chaque rendu de page.

let binderKeydownHandler = null;
let binderMql = null;

function setupBinderLifecycle() {
    if (binderKeydownHandler) return; // déjà attaché, idempotent

    binderKeydownHandler = handleBinderKeydown;
    document.addEventListener('keydown', binderKeydownHandler);

    binderMql = window.matchMedia('(max-width: 768px)');
    binderMql.addEventListener('change', handleBinderBreakpointChange);

    const wrapper = document.getElementById('collection-binder-wrapper');
    if (wrapper) wrapper.addEventListener('click', handleBinderClickCapture, true);

    if (binderMql.matches) attachBinderPointerHandlers();
}

function teardownBinderLifecycle() {
    if (!binderKeydownHandler) return; // rien à faire, déjà démonté (ou jamais monté)

    document.removeEventListener('keydown', binderKeydownHandler);
    binderKeydownHandler = null;

    if (binderMql) {
        binderMql.removeEventListener('change', handleBinderBreakpointChange);
        binderMql = null;
    }

    const wrapper = document.getElementById('collection-binder-wrapper');
    if (wrapper) wrapper.removeEventListener('click', handleBinderClickCapture, true);

    detachBinderPointerHandlers();

    // B8 : filet défensif si on quitte le mode binder pendant qu'une animation de page est en vol.
    // Reset immédiat du flag (repartir propre sans attendre le .finally() de l'animation en cours) +
    // incrément du token pour invalider ce même .finally() tardif - sans ça, une animation A dont le
    // teardown a eu lieu pendant qu'elle tournait encore, suivie d'un retour rapide qui démarre
    // l'animation B, verrait le .finally() de A remettre binderAnimating à false pendant que B est
    // encore en vol (course corrigée après retour utilisateur, cf conversation).
    binderAnimating = false;
    binderAnimationToken++;
}

window.resetBinderPage = resetBinderPage;
window.getBinderSpreadSize = getBinderSpreadSize;
window.getBinderPageSize = getBinderPageSize;
window.renderBinderView = renderBinderView;
window.goToBinderSpread = goToBinderSpread;
window.setupBinderLifecycle = setupBinderLifecycle;
window.teardownBinderLifecycle = teardownBinderLifecycle;
