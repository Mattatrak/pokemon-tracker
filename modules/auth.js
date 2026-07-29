// Authentification - Pokémon Tracker
// Dépend de: supabaseClient (tracker.js), refreshCollection/loadWishlists/renderStatsCharts/renderHeroValueCard/
// loadFavorites/initDatePicker (autres modules + tracker.js). Charge en dernier : par le temps que ce
// script s'exécute, tous les autres modules sont déjà chargés (init() peut donc référencer leurs fonctions).

async function init() {
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
        window.location.href = 'login.html';
    }
});
