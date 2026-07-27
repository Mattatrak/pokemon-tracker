// DesktopNavbar - Pokémon Tracker
// Navigation horizontale desktop (>768px). Rendue dans 3 emplacements possibles selon l'onglet actif :
// #desktop-nav-container (header), #progression-hero-nav-container (onglet Progression),
// et directement dans le hero du Dashboard (modules/dashboard.js). Masquée en CSS sous 768px
// (navigation.css) au profit de MobileBottomNavigation.js.
// Dépend de : navigateToTab (tracker.js), handleLogout (modules/auth.js)

function generateDesktopNavigation(activeTabId) {
    const pages = [
        { id: 'tab-dashboard', label: 'Accueil', icon: 'ti-layout-dashboard' },
        { id: 'tab-collection', label: 'Ma Collection', icon: 'ti-layout-grid' },
        { id: 'tab-progression', label: 'Progression', icon: 'ti-trophy' },
        { id: 'tab-stats', label: 'Statistiques', icon: 'ti-chart-bar' },
        { id: 'tab-wishlist', label: 'Souhaits', icon: 'ti-star' }
    ];

    const navCenter = pages
        .map(p => `<button class="dashboard-integrated-nav-link ${p.id === activeTabId ? 'active' : ''}" onclick="navigateToTab('${p.id}')">${p.label}</button>`)
        .join('');

    return `
        <div class="dashboard-integrated-nav">
            <div class="dashboard-integrated-nav-left">
                <div class="dashboard-integrated-nav-logo">
                    <img src="images/poke-tracker.png" alt="PokéTracker" class="dashboard-integrated-nav-logo-img">
                    <span>PokéTracker</span>
                </div>
            </div>
            <div class="dashboard-integrated-nav-center">
                ${navCenter}
            </div>
            <div class="dashboard-integrated-nav-right">
                <button class="dashboard-integrated-nav-action" title="Rechercher" onclick="navigateToTab('tab-add')"><i class="ti ti-search" aria-hidden="true"></i></button>
                <button class="dashboard-integrated-nav-action dashboard-integrated-nav-action--primary" title="Ajouter" onclick="navigateToTab('tab-add')"><i class="ti ti-plus" aria-hidden="true"></i></button>
                <button class="dashboard-integrated-nav-action" title="Profil" onclick="handleLogout()"><i class="ti ti-user" aria-hidden="true"></i></button>
            </div>
        </div>
    `;
}

function updateDesktopNavigation(tabId) {
    if (tabId === 'tab-dashboard') return;
    const containerId = tabId === 'tab-progression' ? 'progression-hero-nav-container' : 'desktop-nav-container';
    const navContainer = document.getElementById(containerId);
    if (navContainer) {
        navContainer.innerHTML = generateDesktopNavigation(tabId);
    }
}
