// Authentification - Pokémon Tracker
// Dépend de: supabaseClient (tracker.js), refreshCollection/loadWishlists/renderStatsCharts/renderHeroValueCard/
// updateLastRefreshLabel/initDatePicker (autres modules + tracker.js). Charge en dernier : par le temps que ce
// script s'exécute, tous les autres modules sont déjà chargés (init() peut donc référencer leurs fonctions).

async function init() {
    await refreshCollection();
    await loadWishlists();
    await renderStatsCharts();
    await renderHeroValueCard();
    updateLastRefreshLabel();
    initDatePicker('#card-date-added');
}

async function handleLogout() {
    await supabaseClient.auth.signOut();
    window.location.href = 'login.html';
}

supabaseClient.auth.onAuthStateChange((event, session) => {
    if (session) {
        init();
    } else {
        window.location.href = 'login.html';
    }
});
