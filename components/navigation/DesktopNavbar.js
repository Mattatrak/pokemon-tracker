// DesktopNavbar - Pokémon Tracker
// Navigation horizontale desktop (>768px). Rendue dans 3 emplacements possibles selon l'onglet actif :
// #desktop-nav-container (header), #progression-hero-nav-container (onglet Progression),
// #collection-hero-nav-container (onglet Collection), #stats-hero-nav-container (onglet Statistiques),
// #wishlist-hero-nav-container (onglet Souhaits), #catalogue-hero-nav-container (onglet Ajouter),
// et directement dans le hero du Dashboard
// (modules/dashboard.js). Masquée en CSS sous 768px
// (navigation.css) au profit de MobileBottomNavigation.js.
// Dépend de : TAB_ROUTES (tracker.js), handleLogout (modules/auth.js)

function generateDesktopNavigation(activeTabId) {
    const pages = [
        { id: 'tab-dashboard', label: 'Accueil', icon: 'ti-layout-dashboard' },
        { id: 'tab-collection', label: 'Ma Collection', icon: 'ti-layout-grid' },
        { id: 'tab-progression', label: 'Progression', icon: 'ti-trophy' },
        { id: 'tab-stats', label: 'Statistiques', icon: 'ti-chart-bar' },
        { id: 'tab-wishlist', label: 'Souhaits', icon: 'ti-star' }
    ];

    // nav-active-dot (VT2, cf roadmap technique animations premium) : vrai nœud DOM plutôt qu'un
    // ::after CSS, uniquement dans l'item actif - nécessaire pour lui assigner dynamiquement
    // view-transition-name (tracker.js#runNavIndicatorTransition) et le faire glisser vers le nouvel
    // onglet au lieu de disparaître/réapparaître.
    const navCenter = pages
        .map(p => {
            const isActive = p.id === activeTabId;
            return `<a href="#${TAB_ROUTES[p.id]}" class="dashboard-integrated-nav-link ${isActive ? 'active' : ''}">${p.label}${isActive ? '<span class="nav-active-dot" aria-hidden="true"></span>' : ''}</a>`;
        })
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
                <a href="#${TAB_ROUTES['tab-add']}" class="dashboard-integrated-nav-action" title="Rechercher"><i class="ti ti-search" aria-hidden="true"></i></a>
                <a href="#${TAB_ROUTES['tab-add']}" class="dashboard-integrated-nav-action dashboard-integrated-nav-action--primary" title="Ajouter"><i class="ti ti-plus" aria-hidden="true"></i></a>
                <div class="profile-menu-wrap">
                    <button class="dashboard-integrated-nav-action dashboard-integrated-nav-action--profile" title="Mon profil" onclick="toggleProfileMenu(event)">
                        ${typeof currentUserProfile !== 'undefined' && currentUserProfile ? profileAvatarHtml(currentUserProfile, 32) : '<i class="ti ti-user" aria-hidden="true"></i>'}
                    </button>
                    <div class="profile-menu" id="profile-menu">
                        <button class="profile-menu-item" onclick="closeProfileMenu(); navigateToTab('tab-collectors');"><i class="ti ti-users" aria-hidden="true"></i> Collectionneurs</button>
                        <button class="profile-menu-item" onclick="closeProfileMenu(); openProfileModal();"><i class="ti ti-user-circle" aria-hidden="true"></i> Mon profil</button>
                        <button class="profile-menu-item" onclick="closeProfileMenu(); navigateToTab('tab-changelog');"><i class="ti ti-sparkles" aria-hidden="true"></i> Nouveautés</button>
                        ${typeof currentUserIsAdmin !== 'undefined' && currentUserIsAdmin ? `<button class="profile-menu-item" onclick="closeProfileMenu(); navigateToTab('tab-admin');"><i class="ti ti-shield-lock" aria-hidden="true"></i> Administration</button>` : ''}
                        <button class="profile-menu-item profile-menu-item-danger" onclick="handleLogout()"><i class="ti ti-logout" aria-hidden="true"></i> Se déconnecter</button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function updateDesktopNavigation(tabId) {
    if (tabId === 'tab-dashboard') return;
    const containerMap = {
        'tab-progression': 'progression-hero-nav-container',
        'tab-collection': 'collection-hero-nav-container',
        'tab-stats': 'stats-hero-nav-container',
        'tab-wishlist': 'wishlist-hero-nav-container',
        'tab-add': 'catalogue-hero-nav-container',
        // Ajoutés avec le hero de tab-collectors/tab-user-profile (audit visuel léger) : avant cela,
        // ces deux tabs retombaient sur 'desktop-nav-container' qui n'existe nulle part dans le DOM
        // (aucune nav ne s'y rendait sur desktop, seul le bouton de retour statique permettait de
        // revenir - retiré depuis que la nav intégrée au hero le fait).
        'tab-collectors': 'collectors-hero-nav-container',
        'tab-user-profile': 'user-profile-hero-nav-container'
    };
    const containerId = containerMap[tabId] || 'desktop-nav-container';
    const navContainer = document.getElementById(containerId);
    if (navContainer) {
        navContainer.innerHTML = generateDesktopNavigation(tabId);
    }
}

// ===== Exports window (ticket V2 Vite, type="module") =====
// Les déclarations top-level d'un module ES ne s'attachent plus automatiquement à window
// (contrairement à un <script> classique) : réexport explicite pour que les autres scripts
// (chargés en modules indépendants, sans import/export entre eux, scope global inchangé)
// puissent continuer à référencer ces noms tels quels — y compris depuis des onclick="..."
// inline dans du HTML généré. Liste exhaustive des déclarations top-level de ce fichier
// (hors variables déjà passées en window.x = ... directement à leur déclaration, cf audit
// du 2026-08-14 sur l'état mutable partagé entre fichiers).
window.generateDesktopNavigation = generateDesktopNavigation;
window.updateDesktopNavigation = updateDesktopNavigation;
