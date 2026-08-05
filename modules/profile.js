// Profil utilisateur (pseudo + avatar) - Pokémon Tracker
// Dépend de : supabaseClient (tracker.js), showMessage (utils.js), handleLogout (auth.js, index.html uniquement)
// Table Supabase requise : profiles (id uuid PK -> auth.users.id, pseudo text, avatar_url text)
// Bucket Supabase Storage requis : avatar (public), rempli manuellement par l'utilisateur
// Etat possédé : currentUserProfile, cachedAvatarOptions

const AVATAR_BUCKET = 'avatar';
const PROFILE_FALLBACK_EMOJI = '🎮';

let currentUserProfile = null;
let cachedAvatarOptions = null; // liste des fichiers du bucket, chargée à la demande

async function loadUserProfile() {
    const { data: userData } = await supabaseClient.auth.getUser();
    const user = userData?.user;
    if (!user) return null;

    const { data, error } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

    if (error || !data) {
        currentUserProfile = { id: user.id, pseudo: '', avatar_url: null, created_at: user.created_at };
        return currentUserProfile;
    }

    // Filet de sécurité si la colonne created_at n'a pas encore été ajoutée à la table profiles
    // (ou une ligne existante d'avant cette colonne) : la date de création du compte auth reste fiable.
    currentUserProfile = { ...data, created_at: data.created_at || user.created_at };
    return currentUserProfile;
}

function formatMemberSince(dateInput) {
    if (!dateInput) return '';
    const date = new Date(dateInput);
    const formatted = date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    return `Collectionneur depuis ${formatted}`;
}

async function fetchAvatarOptions() {
    if (cachedAvatarOptions) return cachedAvatarOptions;

    const { data, error } = await supabaseClient.storage.from(AVATAR_BUCKET).list('', { limit: 100 });
    if (error || !data) {
        console.error('Erreur chargement des avatars (bucket "avatar"):', error);
        cachedAvatarOptions = [];
        return cachedAvatarOptions;
    }

    cachedAvatarOptions = data
        .filter(f => f.name && !f.name.startsWith('.'))
        .map(f => supabaseClient.storage.from(AVATAR_BUCKET).getPublicUrl(f.name).data.publicUrl);

    return cachedAvatarOptions;
}

function profileAvatarHtml(profile, sizePx = 36) {
    const p = profile || currentUserProfile;
    if (p?.avatar_url) {
        return `<img src="${p.avatar_url}" alt="" class="profile-avatar" style="width:${sizePx}px;height:${sizePx}px;" onerror="this.outerHTML='<span class=&quot;profile-avatar profile-avatar-fallback&quot; style=&quot;width:${sizePx}px;height:${sizePx}px;font-size:${Math.round(sizePx * 0.55)}px;&quot;>${PROFILE_FALLBACK_EMOJI}</span>'">`;
    }
    return `<span class="profile-avatar profile-avatar-fallback" style="width:${sizePx}px;height:${sizePx}px;font-size:${Math.round(sizePx * 0.55)}px;">${PROFILE_FALLBACK_EMOJI}</span>`;
}

async function openProfileModal() {
    const content = document.getElementById('profile-modal-content');
    const p = currentUserProfile || {};

    content.innerHTML = `
        <button class="modal-close" onclick="closeProfileModal()"><i class="ti ti-x" aria-hidden="true"></i></button>
        <div class="modal-title" style="margin-bottom: 1.25rem;">Mon profil</div>

        <div class="profile-modal-preview">
            ${profileAvatarHtml(p, 64)}
        </div>
        ${p.created_at ? `<p class="profile-member-since">${formatMemberSince(p.created_at)}</p>` : ''}

        <div class="form-group">
            <label for="profile-pseudo-input">Pseudo</label>
            <input type="text" id="profile-pseudo-input" maxlength="24" value="${escapeHtml(p.pseudo || '')}" placeholder="Ton pseudo" oninput="checkProfileDirty()">
        </div>

        <div class="form-group">
            <label>Avatar</label>
            <div class="profile-avatar-grid" id="profile-avatar-grid">
                <p class="dashboard-empty-text" style="padding:0.5rem 0;">Chargement des avatars...</p>
            </div>
        </div>

        <div class="modal-edit-actions">
            <button class="modal-save-btn" id="profile-save-btn" style="display:none;" onclick="saveProfile(this)"><i class="ti ti-device-floppy" aria-hidden="true"></i> Enregistrer</button>
        </div>
    `;

    content.dataset.selectedAvatarUrl = p.avatar_url || '';
    content.dataset.initialPseudo = p.pseudo || '';
    content.dataset.initialAvatarUrl = p.avatar_url || '';
    document.getElementById('profile-modal-overlay').classList.add('active');

    const urls = await fetchAvatarOptions();
    const grid = document.getElementById('profile-avatar-grid');
    if (!grid) return; // modale refermée avant la fin du chargement

    if (urls.length === 0) {
        grid.innerHTML = '<p class="dashboard-empty-text" style="padding:0.5rem 0;">Aucun avatar trouvé dans le bucket "avatar".</p>';
        return;
    }

    grid.innerHTML = urls.map(url => `
        <button type="button" class="profile-avatar-swatch ${url === content.dataset.selectedAvatarUrl ? 'selected' : ''}" data-url="${url}" onclick="selectProfileAvatar('${url}', this)">
            <img src="${url}" alt="" loading="lazy">
        </button>
    `).join('');
}

function selectProfileAvatar(url, btn) {
    document.getElementById('profile-modal-content').dataset.selectedAvatarUrl = url;
    btn.parentElement.querySelectorAll('.profile-avatar-swatch').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');

    const preview = document.querySelector('.profile-modal-preview');
    if (preview) preview.innerHTML = profileAvatarHtml({ avatar_url: url }, 64);

    checkProfileDirty();
}

function checkProfileDirty() {
    const content = document.getElementById('profile-modal-content');
    const saveBtn = document.getElementById('profile-save-btn');
    const pseudoInput = document.getElementById('profile-pseudo-input');
    if (!content || !saveBtn || !pseudoInput) return;

    const dirty = pseudoInput.value.trim() !== content.dataset.initialPseudo
        || content.dataset.selectedAvatarUrl !== content.dataset.initialAvatarUrl;

    saveBtn.style.display = dirty ? '' : 'none';
}

async function saveProfile(btn) {
    const content = document.getElementById('profile-modal-content');
    const pseudo = document.getElementById('profile-pseudo-input').value.trim();
    const avatar_url = content.dataset.selectedAvatarUrl || null;

    if (!pseudo) {
        showMessage('Le pseudo ne peut pas être vide', 'error');
        return;
    }

    btn.disabled = true;
    const originalHtml = btn.innerHTML;
    btn.innerHTML = '<span class="loading"></span> Enregistrement...';

    const { data: userData } = await supabaseClient.auth.getUser();
    const userId = userData?.user?.id;

    const { error } = await supabaseClient
        .from('profiles')
        .upsert({ id: userId, pseudo, avatar_url });

    btn.disabled = false;
    btn.innerHTML = originalHtml;

    if (error) {
        showMessage('Erreur lors de l\'enregistrement du profil', 'error');
        console.error(error);
        return;
    }

    currentUserProfile = { id: userId, pseudo, avatar_url };
    showMessage('Profil mis à jour', 'success');
    closeProfileModal();

    const activeTab = document.querySelector('.tab-content.active');
    if (activeTab && typeof updateDesktopNavigation === 'function') updateDesktopNavigation(activeTab.id);
    if (document.getElementById('dashboard-hero') && typeof renderDashboardHero === 'function') renderDashboardHero();
}

function closeProfileModal() {
    document.getElementById('profile-modal-overlay').classList.remove('active');
}

// getElementById('profile-menu') ne suffit pas : chaque page (Dashboard/Collection/Stats/...) a sa
// propre nav avec le même id, toutes présentes dans le DOM en même temps (seul le tab-content actif
// est visible) - getElementById renvoie toujours la première (celle du Dashboard), pas forcément
// celle actuellement visible/cliquée. On retrouve donc le menu via le bouton cliqué.
let openProfileMenuEl = null;

function toggleProfileMenu(event) {
    event.stopPropagation();
    const wrap = event.currentTarget.closest('.profile-menu-wrap');
    const menu = wrap ? wrap.querySelector('.profile-menu') : null;
    if (!menu) return;

    const willOpen = menu !== openProfileMenuEl || !menu.classList.contains('active');
    if (openProfileMenuEl) openProfileMenuEl.classList.remove('active');
    openProfileMenuEl = willOpen ? menu : null;
    if (willOpen) menu.classList.add('active');
}

function closeProfileMenu() {
    if (openProfileMenuEl) openProfileMenuEl.classList.remove('active');
    openProfileMenuEl = null;
}

document.addEventListener('click', (event) => {
    if (openProfileMenuEl && !openProfileMenuEl.parentElement.contains(event.target)) {
        closeProfileMenu();
    }
});
