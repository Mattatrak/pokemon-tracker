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

function showApp() {
    document.getElementById('login-gate').style.display = 'none';
    document.getElementById('main-app-container').style.display = '';
}

function showLoginGate() {
    document.getElementById('login-gate').style.display = 'flex';
    document.getElementById('main-app-container').style.display = 'none';
}

async function handleLogout() {
    await supabaseClient.auth.signOut();
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');
    const btn = document.getElementById('login-submit-btn');

    errorEl.style.display = 'none';
    btn.disabled = true;
    btn.textContent = 'Connexion...';

    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

    if (error) {
        errorEl.textContent = 'Email ou mot de passe incorrect.';
        errorEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Se connecter';
    }
    // Si succès, onAuthStateChange ci-dessous se charge d'afficher l'app
});

supabaseClient.auth.onAuthStateChange((event, session) => {
    if (session) {
        showApp();
        init();
    } else {
        showLoginGate();
    }
});
