// Login form handling - Pokémon Tracker
// Dépend de: supabaseClient, REMEMBER_ME_KEY, ROUTE_TO_TAB, TAB_ROUTES (tracker.js)

// Dupliquée depuis modules/auth.js (voir commentaire là-bas) pour ne pas toucher à tracker.js.
const REDIRECT_ROUTE_KEY = 'poketracker-redirect-route';

// Dupliquée depuis modules/auth.js (même raison). Liste blanche réelle, pas une confiance aveugle dans
// sessionStorage : les 6 routes fixes plus #/user/<username> borné au format de profiles.username.
function isValidRedirectRoute(route) {
    return Object.prototype.hasOwnProperty.call(ROUTE_TO_TAB, route) || /^\/user\/[A-Za-z0-9_-]{3,20}$/.test(route);
}

// Consomme (lit + supprime, usage unique) la route mémorisée par modules/auth.js avant la redirection vers
// login.html. Revalidée contre ROUTE_TO_TAB (défense en profondeur : jamais faire confiance à une valeur
// lue en storage sans revalidation) — repli sur /dashboard si absente ou invalide.
function getPostLoginRedirectHash() {
    const requestedRoute = sessionStorage.getItem(REDIRECT_ROUTE_KEY);
    sessionStorage.removeItem(REDIRECT_ROUTE_KEY);
    const validRoute = requestedRoute && isValidRedirectRoute(requestedRoute)
        ? requestedRoute
        : TAB_ROUTES['tab-dashboard'];
    return './#' + validRoute;
}

function showLoginView() {
    document.querySelectorAll('.login-view').forEach(v => v.classList.remove('active'));
    document.getElementById('login-view').classList.add('active');
}

function showSignupView() {
    document.querySelectorAll('.login-view').forEach(v => v.classList.remove('active'));
    document.getElementById('signup-view').classList.add('active');
}

function showForgotView() {
    document.querySelectorAll('.login-view').forEach(v => v.classList.remove('active'));
    document.getElementById('forgot-view').classList.add('active');
}

function showResetView() {
    document.querySelectorAll('.login-view').forEach(v => v.classList.remove('active'));
    document.getElementById('reset-view').classList.add('active');
}

document.getElementById('forgot-password-link').addEventListener('click', (e) => {
    e.preventDefault();
    showForgotView();
});
document.getElementById('signup-link').addEventListener('click', (e) => {
    e.preventDefault();
    showSignupView();
});
document.getElementById('signup-back-link').addEventListener('click', (e) => {
    e.preventDefault();
    showLoginView();
});
document.getElementById('forgot-back-link').addEventListener('click', (e) => {
    e.preventDefault();
    showLoginView();
});

// ===== CONNEXION =====

document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const remember = document.getElementById('login-remember').checked;
    const errorEl = document.getElementById('login-error');
    const btn = document.getElementById('login-submit-btn');

    errorEl.style.display = 'none';
    btn.disabled = true;
    btn.textContent = 'Connexion...';

    localStorage.setItem(REMEMBER_ME_KEY, remember ? 'true' : 'false');

    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

    if (error) {
        errorEl.textContent = 'Email ou mot de passe incorrect.';
        errorEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Se connecter';
    } else {
        window.location.replace(getPostLoginRedirectHash());
    }
});

// ===== INSCRIPTION =====

document.getElementById('signup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pseudo = document.getElementById('signup-pseudo').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    const passwordConfirm = document.getElementById('signup-password-confirm').value;
    const errorEl = document.getElementById('signup-error');
    const successEl = document.getElementById('signup-success');
    const btn = document.getElementById('signup-submit-btn');

    errorEl.style.display = 'none';
    successEl.style.display = 'none';

    if (password !== passwordConfirm) {
        errorEl.textContent = 'Les mots de passe ne correspondent pas.';
        errorEl.style.display = 'block';
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Création...';

    // Sans emailRedirectTo, Supabase retombe sur le "Site URL" configuré dans le dashboard du projet
    // pour le lien de confirmation de l'e-mail — qui peut valoir localhost (valeur par défaut) et n'a
    // aucune raison de correspondre à l'origine réelle d'où l'inscription a été faite. Même pattern que
    // resetPasswordForEmail juste plus bas dans ce fichier.
    const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin + window.location.pathname }
    });

    if (error) {
        btn.disabled = false;
        btn.textContent = 'Créer mon compte';
        errorEl.textContent = error.message.includes('already registered') || error.message.includes('User already')
            ? 'Un compte existe déjà avec cette adresse e-mail.'
            : 'Impossible de créer le compte. Réessaie.';
        errorEl.style.display = 'block';
        return;
    }

    if (data.user) {
        // Profil créé même si la confirmation e-mail est activée (data.user existe dans les deux cas,
        // data.session seulement si la confirmation est désactivée). Erreur non bloquante pour l'inscription
        // (ex: table profiles pas encore migrée) : le profil pourra être complété plus tard via la modale.
        const { error: profileError } = await supabaseClient.from('profiles').insert({
            id: data.user.id,
            pseudo
        });
        if (profileError) console.error('Erreur création profil:', profileError);
    }

    btn.disabled = false;
    btn.textContent = 'Créer mon compte';

    if (data.session) {
        // Confirmation e-mail désactivée côté Supabase : le compte est actif immédiatement
        window.location.replace(getPostLoginRedirectHash());
        return;
    }

    successEl.textContent = 'Compte créé ! Vérifie ta boîte mail pour confirmer ton adresse avant de te connecter.';
    successEl.style.display = 'block';
    document.getElementById('signup-form').reset();
});

// ===== MOT DE PASSE OUBLIE =====

document.getElementById('forgot-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('forgot-email').value.trim();
    const errorEl = document.getElementById('forgot-error');
    const successEl = document.getElementById('forgot-success');
    const btn = document.getElementById('forgot-submit-btn');

    errorEl.style.display = 'none';
    successEl.style.display = 'none';
    btn.disabled = true;
    btn.textContent = 'Envoi...';

    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname
    });

    btn.disabled = false;
    btn.textContent = 'Envoyer le lien';

    if (error) {
        errorEl.textContent = 'Impossible d\'envoyer l\'e-mail. Réessaie plus tard.';
        errorEl.style.display = 'block';
        return;
    }

    successEl.textContent = 'Si un compte existe avec cette adresse, un e-mail de réinitialisation vient d\'être envoyé.';
    successEl.style.display = 'block';
    document.getElementById('forgot-form').reset();
});

// ===== NOUVEAU MOT DE PASSE (lien de récupération) =====

document.getElementById('reset-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('reset-password').value;
    const passwordConfirm = document.getElementById('reset-password-confirm').value;
    const errorEl = document.getElementById('reset-error');
    const btn = document.getElementById('reset-submit-btn');

    errorEl.style.display = 'none';

    if (password !== passwordConfirm) {
        errorEl.textContent = 'Les mots de passe ne correspondent pas.';
        errorEl.style.display = 'block';
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Validation...';

    const { error } = await supabaseClient.auth.updateUser({ password });

    if (error) {
        errorEl.textContent = 'Impossible de mettre à jour le mot de passe. Redemande un lien.';
        errorEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Valider le nouveau mot de passe';
        return;
    }

    window.location.replace(getPostLoginRedirectHash());
});

supabaseClient.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') {
        showResetView();
    }
});
