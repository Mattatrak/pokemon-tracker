// Login form handling - Pokémon Tracker
// Dépend de: supabaseClient, REMEMBER_ME_KEY (tracker.js)

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
        window.location.href = 'index.html';
    }
});

// ===== INSCRIPTION =====

document.getElementById('signup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
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

    const { data, error } = await supabaseClient.auth.signUp({ email, password });

    btn.disabled = false;
    btn.textContent = 'Créer mon compte';

    if (error) {
        errorEl.textContent = error.message.includes('already registered') || error.message.includes('User already')
            ? 'Un compte existe déjà avec cette adresse e-mail.'
            : 'Impossible de créer le compte. Réessaie.';
        errorEl.style.display = 'block';
        return;
    }

    if (data.session) {
        // Confirmation e-mail désactivée côté Supabase : le compte est actif immédiatement
        window.location.href = 'index.html';
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

    window.location.href = 'index.html';
});

supabaseClient.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') {
        showResetView();
    }
});
