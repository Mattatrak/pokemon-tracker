// MobileBottomNavigation - Pokémon Tracker
// Navigation mobile (<=768px) : barre fixe en bas d'écran, pensée pour un usage au pouce.
// Totalement indépendante de DesktopNavbar.js (pas de media queries dans un composant partagé) :
// les deux sont rendus en parallèle, CSS (navigation.css) décide lequel est visible selon le breakpoint.
// Rendue une fois dans #mobile-bottom-nav-container (index.html) et mise à jour à chaque changement d'onglet.
// Dépend de : TAB_ROUTES (tracker.js), showMessage (modules/utils.js)
//
// Structure (5 emplacements fixes, jamais 6) : Accueil, Collection, Ajouter (FAB central), Souhaits, Plus.
// "Plus" remplace l'ancienne entrée Progression et ouvre un panneau compact (Progression/Statistiques/
// Mon profil/Se déconnecter) plutôt que d'ajouter un 6e bouton — à 360px, un item de plus aurait resserré
// les 5 existants sous ~50px et dégradé libellés/zones tactiles (cf audit).
// Le panneau est généré ici, dans le même conteneur que la barre (#mobile-bottom-nav-container) : pas
// besoin d'un conteneur statique séparé dans index.html, il est repositionné en absolute au-dessus de la
// barre par navigation.css.
// Ticket 1 : structure + ouverture/fermeture uniquement. Les 4 lignes du panneau n'appellent pas encore
// leurs actions définitives (navigation Progression/Stats, openProfileModal, handleLogout) — Ticket 2.

const MOBILE_NAV_PAGES_LEFT = [
    { id: 'tab-dashboard', label: 'Accueil', icon: 'ti-layout-dashboard' },
    { id: 'tab-collection', label: 'Collection', icon: 'ti-layout-grid' }
];
const MOBILE_NAV_PAGES_RIGHT = [
    { id: 'tab-wishlist', label: 'Souhaits', icon: 'ti-star' }
];

// Onglets qui, une fois actifs, allument "Plus" au lieu d'un item dédié (ils n'ont plus leur propre
// entrée dans la barre : Progression a été remplacée par Plus, Statistiques n'a jamais eu d'entrée).
const MOBILE_NAV_MORE_ACTIVE_TABS = ['tab-progression', 'tab-stats', 'tab-collectors', 'tab-user-profile'];

function renderMobileNavItem(p, activeTabId) {
    return `
        <a href="#${TAB_ROUTES[p.id]}" class="mobile-bottom-nav-item ${p.id === activeTabId ? 'active' : ''}">
            <span class="mobile-bottom-nav-icon"><i class="ti ${p.icon}" aria-hidden="true"></i></span>
            <span>${p.label}</span>
        </a>
    `;
}

function renderMobileMoreTrigger(activeTabId) {
    const isActive = MOBILE_NAV_MORE_ACTIVE_TABS.includes(activeTabId);
    return `
        <button type="button" id="mobile-nav-more-btn" class="mobile-bottom-nav-item ${isActive ? 'active' : ''}"
            onclick="toggleMobileMorePanel(event)" aria-haspopup="true" aria-expanded="false">
            <span class="mobile-bottom-nav-icon"><i class="ti ti-dots" aria-hidden="true"></i></span>
            <span>Plus</span>
        </button>
    `;
}

// Chaque ligne ferme le panneau puis appelle directement la fonction existante (navigateToTab,
// openProfileModal, handleLogout) — jamais toggleProfileMenu (couplé au .profile-menu-wrap desktop),
// aucune logique dupliquée. Pas de stopPropagation ici : contrairement au bouton Plus, fermer avant
// d'agir est le comportement voulu, et closeMobileMorePanel() est idempotente si le listener document
// la rappelle en bulle.
function renderMobileMorePanel() {
    return `
        <div class="mobile-more-panel" id="mobile-more-panel" role="menu">
            <button type="button" class="mobile-more-panel-item" role="menuitem" onclick="closeMobileMorePanel(); navigateToTab('tab-progression');"><i class="ti ti-trophy" aria-hidden="true"></i> Progression</button>
            <button type="button" class="mobile-more-panel-item" role="menuitem" onclick="closeMobileMorePanel(); navigateToTab('tab-stats');"><i class="ti ti-chart-bar" aria-hidden="true"></i> Statistiques</button>
            <button type="button" class="mobile-more-panel-item" role="menuitem" onclick="closeMobileMorePanel(); navigateToTab('tab-collectors');"><i class="ti ti-users" aria-hidden="true"></i> Collectionneurs</button>
            <button type="button" class="mobile-more-panel-item" role="menuitem" onclick="closeMobileMorePanel(); openProfileModal();"><i class="ti ti-user-circle" aria-hidden="true"></i> Mon profil</button>
            <button type="button" class="mobile-more-panel-item mobile-more-panel-item-danger" role="menuitem" onclick="closeMobileMorePanel(); handleLogout();"><i class="ti ti-logout" aria-hidden="true"></i> Se déconnecter</button>
        </div>
    `;
}

function generateMobileBottomNav(activeTabId) {
    const left = MOBILE_NAV_PAGES_LEFT.map(p => renderMobileNavItem(p, activeTabId)).join('');
    const right = MOBILE_NAV_PAGES_RIGHT.map(p => renderMobileNavItem(p, activeTabId)).join('');

    return `
        ${left}
        <a href="#${TAB_ROUTES['tab-add']}" class="mobile-bottom-nav-fab" title="Ajouter" aria-label="Ajouter">
            <i class="ti ti-plus" aria-hidden="true"></i>
        </a>
        ${right}
        ${renderMobileMoreTrigger(activeTabId)}
        ${renderMobileMorePanel()}
    `;
}

function updateMobileBottomNav(tabId) {
    const navContainer = document.getElementById('mobile-bottom-nav-container');
    if (navContainer) {
        navContainer.innerHTML = generateMobileBottomNav(tabId);
    }
}

// Le conteneur (#mobile-bottom-nav-container) est entièrement régénéré (innerHTML) à chaque changement
// d'onglet : le panneau repart donc toujours fermé par défaut, sans état à réconcilier. Ouverture/fermeture
// pendant qu'un même onglet reste actif passe par la classe .open, gérée ici.
function toggleMobileMorePanel(event) {
    event.stopPropagation();
    const panel = document.getElementById('mobile-more-panel');
    const trigger = document.getElementById('mobile-nav-more-btn');
    if (!panel) return;

    const willOpen = !panel.classList.contains('open');
    panel.classList.toggle('open', willOpen);
    if (trigger) trigger.setAttribute('aria-expanded', String(willOpen));
}

// Idempotente et défensive à dessein : appelable sans vérifier au préalable si le panneau existe ou est
// déjà fermé (rerender en cours, onglet sans nav mobile, second appel rapproché...).
function closeMobileMorePanel() {
    const panel = document.getElementById('mobile-more-panel');
    if (!panel) return;
    panel.classList.remove('open');

    const trigger = document.getElementById('mobile-nav-more-btn');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
}

// Un seul listener installé pour toute la durée de vie de la page (code de module, exécuté une fois au
// chargement du script) plutôt qu'à l'intérieur de generateMobileBottomNav/toggleMobileMorePanel : la barre
// est régénérée à chaque changement d'onglet, ré-attacher un listener document à chaque fois l'accumulerait
// silencieusement. Le panneau et le déclencheur sont recherchés par id à chaque clic (jamais mis en cache),
// donc valables même après une régénération du conteneur.
document.addEventListener('click', (event) => {
    const panel = document.getElementById('mobile-more-panel');
    if (!panel || !panel.classList.contains('open')) return;

    const trigger = document.getElementById('mobile-nav-more-btn');
    if (panel.contains(event.target) || (trigger && trigger.contains(event.target))) return;

    closeMobileMorePanel();
});
