// DesktopNavbar - Pokémon Tracker
// Navigation horizontale desktop (>768px). Un seul DOM persistant, rendu une seule fois dans
// #desktop-nav-container (premier enfant de <body>, cf index.html) - hors de .container, des heroes et
// des .tab-content, jamais recréé par un rerender de page/onglet (NAV1, cf audit navbar du 2026-08-16 :
// l'ancienne architecture à 8 containers/onglet, dont un cas spécial Dashboard, est retirée).
// Masquée en CSS sous 768px (navigation.css) au profit de MobileBottomNavigation.js.
// Dépend de : TAB_ROUTES (tracker.js), handleLogout (modules/auth.js), escapeHtml (modules/utils.js)

const DESKTOP_NAV_PAGES = [
    { id: 'tab-dashboard', label: 'Accueil', icon: 'ti-layout-dashboard' },
    { id: 'tab-collection', label: 'Ma Collection', icon: 'ti-layout-grid' },
    { id: 'tab-progression', label: 'Progression', icon: 'ti-trophy' },
    { id: 'tab-stats', label: 'Statistiques', icon: 'ti-chart-bar' },
    { id: 'tab-wishlist', label: 'Souhaits', icon: 'ti-star' },
    { id: 'tab-add', label: 'Ajouter', icon: 'ti-plus' }
];

// Retourne le contenu interne de #desktop-nav-container (pas le wrapper .dashboard-integrated-nav
// lui-même : c'est le container global qui porte cette classe en dur dans index.html, pour ne jamais la
// perdre entre deux rebuilds). .dashboard-integrated-nav-inner (NAV3.2) borne la largeur du contenu
// (logo/nav/actions) sans affecter le fond plein-largeur du shell, resté sur l'élément sticky lui-même
// (navigation.css) - un niveau de nesting en plus, sans impact sur les querySelector ci-dessous
// (recherche par descendant, indifférente à la profondeur). Onglets secondaires (Collecteurs/Profil
// public/Admin/Changelog) : activeTabId ne matche aucune page de DESKTOP_NAV_PAGES, donc aucun lien actif
// / aucun nav-active-dot - comportement volontairement inchangé (cf tracker.js#runNavIndicatorTransition,
// déjà prévu pour ce cas).
function generateDesktopNavigation(activeTabId) {
    // nav-active-dot (VT2, cf roadmap technique animations premium) : vrai nœud DOM plutôt qu'un
    // ::after CSS, uniquement dans l'item actif - nécessaire pour lui assigner dynamiquement
    // view-transition-name (tracker.js#runNavIndicatorTransition) et le faire glisser vers le nouvel
    // onglet au lieu de disparaître/réapparaître.
    const navCenter = DESKTOP_NAV_PAGES
        .map(p => {
            const isActive = p.id === activeTabId;
            return `<a href="#${TAB_ROUTES[p.id]}" class="dashboard-integrated-nav-link ${isActive ? 'active' : ''}">${p.label}${isActive ? '<span class="nav-active-dot" aria-hidden="true"></span>' : ''}</a>`;
        })
        .join('');

    // Pseudo (NAV3.2) : déjà chargé dans currentUserProfile (modules/profile.js#loadUserProfile), aucun
    // appel réseau supplémentaire. escapeHtml comme partout où ce champ est interpolé (saisie libre,
    // cf modules/dashboard.js#renderDashboardHero pour le même garde-fou). Absent (profil pas encore
    // chargé, ou pseudo vide) : bouton profil reste un simple rond avatar/icône, comme avant NAV3.2.
    const hasProfile = typeof currentUserProfile !== 'undefined' && currentUserProfile;
    const avatarHtml = hasProfile ? profileAvatarHtml(currentUserProfile, 32) : '<i class="ti ti-user" aria-hidden="true"></i>';
    const pseudoHtml = hasProfile && currentUserProfile.pseudo
        ? `<span class="dashboard-integrated-nav-profile-name">${escapeHtml(currentUserProfile.pseudo)}</span>`
        : '';

    return `
        <div class="dashboard-integrated-nav-inner">
            <div class="dashboard-integrated-nav-left">
                <a href="#${TAB_ROUTES['tab-dashboard']}" class="dashboard-integrated-nav-logo">
                    <img src="images/poke-tracker.png" alt="PokéTracker" class="dashboard-integrated-nav-logo-img">
                    <span>PokéTracker</span>
                </a>
            </div>
            <div class="dashboard-integrated-nav-center">
                ${navCenter}
            </div>
            <div class="dashboard-integrated-nav-right">
                <a href="#${TAB_ROUTES['tab-add']}" class="dashboard-integrated-nav-action" title="Rechercher"><i class="ti ti-search" aria-hidden="true"></i></a>
                <div class="profile-menu-wrap">
                    <button class="dashboard-integrated-nav-action dashboard-integrated-nav-action--profile${pseudoHtml ? ' dashboard-integrated-nav-action--profile-named' : ''}" title="Mon profil" onclick="toggleProfileMenu(event)">
                        ${avatarHtml}${pseudoHtml}
                    </button>
                    <div class="profile-menu" id="profile-menu">
                        <button class="profile-menu-item" onclick="closeProfileMenu(); navigateToTab('tab-collectors');"><i class="ti ti-users" aria-hidden="true"></i> Collectionneurs</button>
                        <button class="profile-menu-item" onclick="closeProfileMenu(); openProfileModal();"><i class="ti ti-user-circle" aria-hidden="true"></i> Mon profil</button>
                        <button class="profile-menu-item" onclick="closeProfileMenu(); navigateToTab('tab-changelog');"><i class="ti ti-sparkles" aria-hidden="true"></i> Nouveautés</button>
                        <button class="profile-menu-item pwa-install-item" onclick="closeProfileMenu(); triggerPwaInstall();"><i class="ti ti-download" aria-hidden="true"></i> Installer l'app</button>
                        ${typeof currentUserIsAdmin !== 'undefined' && currentUserIsAdmin ? `<button class="profile-menu-item" onclick="closeProfileMenu(); navigateToTab('tab-admin');"><i class="ti ti-shield-lock" aria-hidden="true"></i> Administration</button>` : ''}
                        <button class="profile-menu-item profile-menu-item-danger" onclick="handleLogout()"><i class="ti ti-logout" aria-hidden="true"></i> Se déconnecter</button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// tabId : onglet à refléter comme actif (ou aucun, cf commentaire generateDesktopNavigation ci-dessus).
// { rebuild: true } : régénère tout le contenu (avatar/pseudo/statut admin), utilisé uniquement quand ces
// informations viennent de changer (modules/auth.js après chargement du profil, modules/profile.js après
// édition) - jamais à chaque navigation. Sans ce flag, seul l'état actif (.active + nav-active-dot) est
// mis à jour sur le DOM existant : pas de rebuild complet juste pour passer d'un onglet à l'autre.
function updateDesktopNavigation(tabId, { rebuild = false } = {}) {
    const container = document.getElementById('desktop-nav-container');
    if (!container) return;

    if (rebuild || !container.dataset.navReady) {
        container.innerHTML = generateDesktopNavigation(tabId);
        container.dataset.navReady = 'true';
        return;
    }

    DESKTOP_NAV_PAGES.forEach(p => {
        // Scopé à .dashboard-integrated-nav-center : le logo pointe aussi vers #/dashboard (NAV1, logo
        // cliquable), donc une recherche sur tout le container matcherait le logo en premier pour
        // tab-dashboard (même href, mais logo placé avant le nav-center dans le DOM) plutôt que le vrai
        // lien "Accueil" - cause du bug VT2 spécifique aux navigations vers/depuis Dashboard.
        const link = container.querySelector(`.dashboard-integrated-nav-center a[href="#${TAB_ROUTES[p.id]}"]`);
        if (!link) return;
        const isActive = p.id === tabId;
        link.classList.toggle('active', isActive);
        let dot = link.querySelector('.nav-active-dot');
        if (isActive && !dot) {
            dot = document.createElement('span');
            dot.className = 'nav-active-dot';
            dot.setAttribute('aria-hidden', 'true');
            link.appendChild(dot);
        } else if (!isActive && dot) {
            dot.remove();
        }
    });
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
