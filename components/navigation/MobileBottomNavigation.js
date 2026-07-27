// MobileBottomNavigation - Pokémon Tracker
// Navigation mobile (<=768px) : barre fixe en bas d'écran, pensée pour un usage au pouce.
// Totalement indépendante de DesktopNavbar.js (pas de media queries dans un composant partagé) :
// les deux sont rendus en parallèle, CSS (navigation.css) décide lequel est visible selon le breakpoint.
// Rendue une fois dans #mobile-bottom-nav-container (index.html) et mise à jour à chaque changement d'onglet.
// Dépend de : navigateToTab (tracker.js), showMessage (modules/utils.js)

const MOBILE_NAV_PAGES = [
    { id: 'tab-dashboard', label: 'Accueil', icon: 'ti-layout-dashboard' },
    { id: 'tab-collection', label: 'Collection', icon: 'ti-layout-grid' },
    { id: 'tab-progression', label: 'Progression', icon: 'ti-trophy' },
    { id: 'tab-wishlist', label: 'Souhaits', icon: 'ti-star' }
];

// Emplacement réservé pour Paramètres/Profil/Déconnexion (écrans non implémentés dans ce sprint)
function openMoreMenu() {
    showMessage('Bientôt disponible', 'success');
}

function generateMobileBottomNav(activeTabId) {
    const items = MOBILE_NAV_PAGES
        .map(p => `
            <button class="mobile-bottom-nav-item ${p.id === activeTabId ? 'active' : ''}" onclick="navigateToTab('${p.id}')">
                <i class="ti ${p.icon}" aria-hidden="true"></i>
                <span>${p.label}</span>
            </button>
        `)
        .join('');

    return `
        ${items}
        <button class="mobile-bottom-nav-item" onclick="openMoreMenu()">
            <i class="ti ti-dots" aria-hidden="true"></i>
            <span>Plus</span>
        </button>
    `;
}

function updateMobileBottomNav(tabId) {
    const navContainer = document.getElementById('mobile-bottom-nav-container');
    if (navContainer) {
        navContainer.innerHTML = generateMobileBottomNav(tabId);
    }
}
