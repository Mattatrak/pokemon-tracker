// Authentification - Pokémon Tracker
// Dépend de: supabaseClient (tracker.js), refreshCollection/loadWishlists/renderStatsCharts/renderHeroValueCard/
// loadFavorites/initDatePicker (autres modules + tracker.js). Charge en dernier : par le temps que ce
// script s'exécute, tous les autres modules sont déjà chargés (init() peut donc référencer leurs fonctions).

// Clé sessionStorage utilisée pour faire traverser la route demandée (#/xxx) à travers la redirection vers
// login.html quand la session n'est pas valide. Portée session (pas localStorage) : la redirection login->app
// se fait dans le même onglet, aucun besoin de persistance au-delà. Consommée (lue + supprimée) une seule
// fois par modules/auth-login.js après une authentification réussie. Dupliquée ici et dans auth-login.js
// plutôt qu'ajoutée à tracker.js pour ne pas toucher au hash router.
const REDIRECT_ROUTE_KEY = 'poketracker-redirect-route';

// Dupliquée dans modules/auth-login.js (même raison que REDIRECT_ROUTE_KEY ci-dessus). Liste blanche
// réelle : les 6 routes fixes de ROUTE_TO_TAB, plus la forme paramétrée #/user/<username> (Phase 3,
// modules/public-profile.js) bornée au même format que la contrainte SQL sur profiles.username
// (3-20 caractères alphanumériques/_/-) — jamais une confiance aveugle dans la valeur stockée.
function isValidRedirectRoute(route) {
    return Object.prototype.hasOwnProperty.call(ROUTE_TO_TAB, route) || /^\/user\/[A-Za-z0-9_-]{3,20}$/.test(route);
}

async function init() {
    await loadUserProfile();
    await loadFavorites();
    await refreshCollection();

    // Peint le hero dès que ses seules dépendances réelles (favoris + collection) sont prêtes, sans
    // attendre loadWishlists/renderStatsCharts/etc. plus bas (inutiles pour le hero) : évite de garder
    // le placeholder "carte" affiché plus longtemps que nécessaire.
    if (document.getElementById('dashboard-hero')) renderDashboardHero();

    await loadWishlists();
    await renderStatsCharts();
    await renderHeroValueCard();
    await renderDashboard();
    appReady = true; // autorise markDashboardDirty() à re-rendre immédiatement à partir de maintenant
    renderTab(getTabIdFromHash()); // ré-applique l'onglet du hash une fois les données chargées (wishlists/stats/progression dépendent de allCollectionCards)
    initDatePicker('#card-date-added');
    updateMobileBottomNav('tab-dashboard');

    // Rafraîchit les prix du marché automatiquement si ça n'a pas été fait depuis plus de 24h
    const lastRefresh = localStorage.getItem('lastPriceRefresh');
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    if (!lastRefresh || new Date(lastRefresh).getTime() <= dayAgo) {
        refreshAllMarketPrices();
    }
}

async function handleLogout() {
    await supabaseClient.auth.signOut();
    window.location.href = 'login.html';
}

let appInitialized = false;

supabaseClient.auth.onAuthStateChange((event, session) => {
    if (session) {
        if (!appInitialized) {
            appInitialized = true;
            init();
        }
    } else {
        // Mémorise la route demandée (#/xxx) avant de partir sur login.html, pour pouvoir y revenir après
        // connexion (voir getPostLoginRedirectHash dans modules/auth-login.js). Validée contre ROUTE_TO_TAB
        // (liste blanche de routes internes, définie dans tracker.js) : jamais de valeur non reconnue stockée.
        const requestedRoute = window.location.hash.replace('#', '');
        if (isValidRedirectRoute(requestedRoute)) {
            sessionStorage.setItem(REDIRECT_ROUTE_KEY, requestedRoute);
        }
        window.location.replace('login.html');
    }
});
