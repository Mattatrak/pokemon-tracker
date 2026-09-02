// Pull-to-refresh natif (mobile uniquement) - Pokémon Tracker
// Dépend de : refreshCollection/loadWishlists/renderDashboard/showMessage/appReady (tracker.js/
// modules/auth.js/modules/utils.js), filterAndDisplay (modules/collection.js),
// getEffectiveCollectionViewMode (modules/collection.js)
// Etat possédé : ptrStartY/ptrActive/ptrTriggered (état du geste en cours, jamais partagé ailleurs)
//
// Actif seulement sur mobile (≤768px, même seuil que le reste de l'app), seulement quand la page est
// déjà tout en haut au moment où le doigt se pose (window.scrollY === 0), et seulement sur Dashboard/
// Collection - jamais en mode Classeur (binder-view.js gère son propre geste de swipe horizontal
// page-à-page, un pull-to-refresh vertical concurrent y serait au mieux redondant, au pire en
// conflit). Écarté aussi si le geste est plus horizontal que vertical (carousel "Dernières
// acquisitions" du Dashboard) : seul un tir clairement vertical déclenche preventDefault.

const PTR_THRESHOLD = 70;       // px de tir avant déclenchement au relâchement
const PTR_MAX_PULL = 120;       // px, plafond visuel de l'indicateur
const PTR_PULL_RESISTANCE = 0.5; // l'indicateur suit le doigt à moitié moins vite (effet élastique)

let ptrStartX = 0;
let ptrStartY = 0;
let ptrActive = false;
let ptrDirectionLocked = null; // null tant qu'indéterminé, puis 'vertical' | 'horizontal'
let ptrTriggered = false;
let ptrRefreshing = false;

function ptrEligibleTab() {
    const activeTab = document.querySelector('.tab-content.active');
    if (!activeTab) return false;
    if (activeTab.id === 'tab-dashboard') return true;
    if (activeTab.id === 'tab-collection') {
        return typeof getEffectiveCollectionViewMode !== 'function' || getEffectiveCollectionViewMode() !== 'binder';
    }
    return false;
}

function ptrReset(indicator) {
    indicator.classList.remove('dragging', 'active');
    indicator.style.transform = 'translateX(-50%) translateY(0)';
}

function initPullToRefresh() {
    const indicator = document.getElementById('ptr-indicator');
    if (!indicator) return;

    document.addEventListener('touchstart', (e) => {
        if (ptrRefreshing) return;
        if (!window.matchMedia('(max-width: 768px)').matches) return;
        if (window.scrollY > 0) return;
        if (e.touches.length !== 1) return;
        if (typeof appReady !== 'undefined' && !appReady) return;
        if (!ptrEligibleTab()) return;

        ptrStartX = e.touches[0].clientX;
        ptrStartY = e.touches[0].clientY;
        ptrActive = true;
        ptrDirectionLocked = null;
        ptrTriggered = false;
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
        if (!ptrActive || ptrRefreshing) return;

        const dx = e.touches[0].clientX - ptrStartX;
        const dy = e.touches[0].clientY - ptrStartY;

        // Verrouille la direction du geste dès qu'il devient net (>8px), pour ne jamais intercepter
        // un scroll horizontal (carousel) commencé depuis le haut de la page.
        if (!ptrDirectionLocked && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
            ptrDirectionLocked = Math.abs(dy) > Math.abs(dx) ? 'vertical' : 'horizontal';
        }
        if (ptrDirectionLocked === 'horizontal') {
            ptrActive = false;
            return;
        }

        if (dy <= 0 || window.scrollY > 0) {
            // Remonté au-dessus du point de départ, ou un scroll natif a repris entre-temps : abandon
            // propre plutôt que de laisser l'indicateur figé à mi-course.
            ptrActive = false;
            ptrReset(indicator);
            return;
        }

        // preventDefault seulement une fois la direction confirmée verticale, jamais avant (sinon un
        // tap ou le tout début d'un geste horizontal se ferait bloquer inutilement).
        if (ptrDirectionLocked === 'vertical') e.preventDefault();

        const pull = Math.min(dy * PTR_PULL_RESISTANCE, PTR_MAX_PULL);
        indicator.classList.add('dragging');
        indicator.style.transform = `translateX(-50%) translateY(${pull}px)`;
        ptrTriggered = pull >= PTR_THRESHOLD;
        indicator.classList.toggle('active', ptrTriggered);
    }, { passive: false });

    document.addEventListener('touchend', () => {
        if (!ptrActive) return;
        ptrActive = false;
        indicator.classList.remove('dragging');

        if (ptrTriggered) {
            runPullToRefresh(indicator);
        } else {
            ptrReset(indicator);
        }
    });

    // Un geste interrompu par le système (appel entrant, notification...) ne doit pas laisser
    // l'indicateur bloqué à mi-course indéfiniment.
    document.addEventListener('touchcancel', () => {
        ptrActive = false;
        ptrReset(indicator);
    });
}

async function runPullToRefresh(indicator) {
    ptrRefreshing = true;
    indicator.classList.add('loading');
    indicator.style.transform = `translateX(-50%) translateY(${PTR_THRESHOLD}px)`;

    try {
        const activeTab = document.querySelector('.tab-content.active');
        await refreshCollection();
        if (activeTab?.id === 'tab-dashboard') {
            await loadWishlists();
            renderDashboard();
        } else if (activeTab?.id === 'tab-collection' && typeof filterAndDisplay === 'function') {
            filterAndDisplay();
        }
        showMessage('Actualisé', 'success');
    } catch (error) {
        console.error('Erreur pull-to-refresh:', error);
        showMessage('Erreur lors de l\'actualisation', 'error');
    } finally {
        ptrRefreshing = false;
        indicator.classList.remove('loading');
        ptrReset(indicator);
    }
}

document.addEventListener('DOMContentLoaded', initPullToRefresh);

// ===== Exports window (ticket V2 Vite, type="module") =====
window.initPullToRefresh = initPullToRefresh;
