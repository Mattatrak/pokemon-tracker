// Login form handling - Pokémon Tracker
// Dépend de: supabaseClient (tracker.js)

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
    } else {
        window.location.href = 'index.html';
    }
});
