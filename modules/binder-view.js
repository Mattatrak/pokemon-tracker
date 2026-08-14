// Vue Classeur - 3e mode d'affichage de l'onglet Collection (Phase 4, cf roadmap technique)
// Dépend de: getFilteredSortedCollection/isCollectionMobileViewport/collectionViewMode (collection.js),
// renderGridCardHtml (card-grid-renderer.js)
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
// B8 (branche tech/phase-4-binder-animation, expérimentation isolée et réversible) : slide+fade WAAPI
// sur goToBinderSpread(), cf animateBinderPageChange() plus bas. N'affecte aucun comportement de
// B1-B7 - seule la transition visuelle entre deux rendus change.

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
        wrapper.innerHTML = '<div class="binder-empty-state"><i class="ti ti-search-off" aria-hidden="true"></i><p>Aucune carte trouvée</p></div>';
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

// ===== B8 : animation de changement de double-page/page (WAAPI, cf roadmap technique) =====
// Expérimentation isolée (branche tech/phase-4-binder-animation) : slide+fade léger sur .binder-book
// uniquement (les boutons/compteur restent fixes, rebuild instantané via renderFn). Deux animations
// concurrentes (ancienne page qui sort, nouvelle qui entre depuis l'autre côté) plutôt que deux phases
// séquentielles : la durée totale reste celle d'une seule des deux (elles tournent en parallèle), pas
// la somme des deux.
//
// BINDER_SLIDE_DISTANCE : aucun token --motion-distance-* existant n'est calibré pour ce cas (ils
// servent des micro-interactions hover de quelques px) - valeur minimale dédiée, volontairement petite.
// Durée/easing en revanche réutilisent tels quels les tokens motion-tokens.css existants.
const BINDER_SLIDE_DISTANCE = 22; // px
const BINDER_ANIM_DURATION = 260; // ms, reprend --motion-duration-normal
const BINDER_ANIM_EASING = 'cubic-bezier(0.2, 0, 0, 1)'; // reprend --motion-ease-standard

let binderAnimating = false;
// Token de génération : incrémenté à chaque animation démarrée ET à chaque teardown. Le .finally()
// d'une animation ne remet binderAnimating à false que s'il porte encore le token courant - évite
// qu'un .finally() tardif (ex: animation A dont le teardown a eu lieu pendant qu'elle tournait encore,
// suivi d'un retour rapide en mode binder qui démarre l'animation B) ne vienne remettre le flag à false
// pendant que B est en vol. Pas de scheduler/queue : juste un compteur comparé à la lecture.
let binderAnimationToken = 0;

// direction > 0 : nouvelle page vient de la droite (navigation "suivant"). direction < 0 : inverse.
// renderFn : la mise à jour d'état + rerender existante (goToBinderSpread ci-dessus) - jamais réécrite.
function animateBinderPageChange(direction, renderFn) {
    // Navigation rapide (clics/swipes répétés) : on ignore plutôt que d'empiler ou d'interrompre une
    // animation en cours - stratégie la plus simple et la plus robuste (jamais deux animations ou deux
    // rerenders qui se chevauchent, jamais d'état binderSpreadIndex incohérent).
    if (binderAnimating) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const wrapper = document.getElementById('collection-binder-wrapper');
    const oldBook = wrapper ? wrapper.querySelector('.binder-book') : null;

    // Filet : sans support WAAPI, sans page déjà montée (état vide), ou reduced-motion -> comportement
    // strictement identique à avant B8 (changement instantané), jamais bloquant.
    if (prefersReducedMotion || !wrapper || !oldBook || typeof oldBook.animate !== 'function') {
        renderFn();
        return;
    }

    binderAnimating = true;
    const myToken = ++binderAnimationToken;

    // Clone positionné en fixed (coordonnées déjà en repère viewport via getBoundingClientRect, aucun
    // besoin de rendre .binder-scene position:relative pour ça) et ajouté à document.body - survit au
    // wrapper.innerHTML de renderBinderView() qui va suivre (lequel détruirait un enfant de .binder-scene).
    // pointer-events:none : ne doit jamais intercepter un clic destiné à la nouvelle page en dessous.
    // aria-hidden + inert : c'est un doublon visuel temporaire du contenu réel, jamais interactif -
    // ne doit jamais être exposé aux technologies d'assistance ni recevoir le focus clavier.
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

    const exitOffset = direction > 0 ? -BINDER_SLIDE_DISTANCE : BINDER_SLIDE_DISTANCE;
    const enterOffset = direction > 0 ? BINDER_SLIDE_DISTANCE : -BINDER_SLIDE_DISTANCE;
    const timing = { duration: BINDER_ANIM_DURATION, easing: BINDER_ANIM_EASING, fill: 'none' };

    const exitAnim = clone.animate(
        [{ transform: 'translateX(0)', opacity: 1 }, { transform: `translateX(${exitOffset}px)`, opacity: 0 }],
        timing
    );

    renderFn(); // rebuild synchrone (index déjà avancé par l'appelant) - la nouvelle page est en place
                // dès cette ligne, ses handlers de clic sont donc déjà actifs pendant l'animation.

    const newBook = wrapper.querySelector('.binder-book');
    const enterAnim = (newBook && typeof newBook.animate === 'function')
        ? newBook.animate(
            [{ transform: `translateX(${enterOffset}px)`, opacity: 0 }, { transform: 'translateX(0)', opacity: 1 }],
            timing
        )
        : null;

    // fill:'none' (par défaut) : chaque élément revient automatiquement à son état CSS normal une fois
    // l'animation terminée - aucun style inline résiduel à retirer nous-mêmes. .finally() garantit le
    // nettoyage (clone + flag) même si une des deux animations est annulée entretemps (ex: navigation
    // hors de Collection pendant l'animation).
    Promise.all([exitAnim.finished, enterAnim ? enterAnim.finished : Promise.resolve()])
        .catch(() => {})
        .finally(() => {
            clone.remove(); // toujours retiré, même si le token a changé entretemps (son propre clone)
            if (myToken === binderAnimationToken) binderAnimating = false; // cf commentaire du token plus haut
        });
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
