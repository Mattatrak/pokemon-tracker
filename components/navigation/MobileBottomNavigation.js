// MobileBottomNavigation - Pokémon Tracker
// Navigation mobile (<=768px) : barre fixe en bas d'écran, pensée pour un usage au pouce.
// Totalement indépendante de DesktopNavbar.js (pas de media queries dans un composant partagé) :
// les deux sont rendus en parallèle, CSS (navigation.css) décide lequel est visible selon le breakpoint.
// Rendue une fois dans #mobile-bottom-nav-container (index.html) et mise à jour à chaque changement d'onglet.
// Dépend de : navigateToTab (tracker.js), showMessage (modules/utils.js)

// Répartie de part et d'autre du bouton central (+) : 2 items à gauche, 2 à droite
const MOBILE_NAV_PAGES_LEFT = [
    { id: 'tab-dashboard', label: 'Accueil', icon: 'ti-layout-dashboard' },
    { id: 'tab-collection', label: 'Collection', icon: 'ti-layout-grid' }
];
const MOBILE_NAV_PAGES_RIGHT = [
    { id: 'tab-progression', label: 'Progression', icon: 'ti-trophy' },
    { id: 'tab-wishlist', label: 'Souhaits', icon: 'ti-star' }
];

function renderMobileNavItem(p, activeTabId) {
    return `
        <button class="mobile-bottom-nav-item ${p.id === activeTabId ? 'active' : ''}" onclick="navigateToTab('${p.id}')">
            <span class="mobile-bottom-nav-icon"><i class="ti ${p.icon}" aria-hidden="true"></i></span>
            <span>${p.label}</span>
        </button>
    `;
}

function generateMobileBottomNav(activeTabId) {
    const left = MOBILE_NAV_PAGES_LEFT.map(p => renderMobileNavItem(p, activeTabId)).join('');
    const right = MOBILE_NAV_PAGES_RIGHT.map(p => renderMobileNavItem(p, activeTabId)).join('');

    return `
        ${left}
        <button class="mobile-bottom-nav-fab" onclick="navigateToTab('tab-add')" title="Ajouter" aria-label="Ajouter">
            <i class="ti ti-plus" aria-hidden="true"></i>
        </button>
        ${right}
    `;
}

function updateMobileBottomNav(tabId) {
    const navContainer = document.getElementById('mobile-bottom-nav-container');
    if (navContainer) {
        navContainer.innerHTML = generateMobileBottomNav(tabId);
    }
}
