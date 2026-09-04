// Profil utilisateur (pseudo + avatar + identité publique) - Pokémon Tracker
// Dépend de : supabaseClient (tracker.js), showMessage (utils.js), handleLogout (auth.js, index.html uniquement)
// Table Supabase requise : profiles (id uuid PK -> auth.users.id, pseudo text, avatar_url text,
//   username text nullable unique insensible à la casse (index sur lower(username), cf
//   sql/migrations/2026-08-08_profiles_public_identity.sql), is_public/collection_visible/
//   wishlist_visible boolean not null default false)
// Bucket Supabase Storage requis : avatar (public), rempli manuellement par l'utilisateur
// Phase 1 uniquement : ces colonnes ne rendent RIEN lisible par un autre utilisateur (aucune RLS
// touchée). `pseudo` reste le nom d'affichage libre existant ; `username` est un identifiant public
// distinct, stable, réservé à une future route #/user/<username> (non implémentée ici).
// Etat possédé : currentUserProfile, cachedAvatarOptions

const AVATAR_BUCKET = 'avatar';
const PROFILE_FALLBACK_EMOJI = '🎮';

// Préfixe exact généré par supabaseClient.storage.from(AVATAR_BUCKET).getPublicUrl(...). Seule forme
// légitime d'avatar_url : cf. sql/migrations/2026-08-09_profiles_avatar_url_format.sql (même préfixe).
// Calculé à l'appel (pas en haut de fichier) : SUPABASE_URL est défini dans tracker.js, chargé APRES
// modules/profile.js dans index.html — y référer au chargement du script lèverait une ReferenceError
// et casserait tout ce module.
function getAvatarUrlPrefix() {
    return `${SUPABASE_URL}/storage/v1/object/public/${AVATAR_BUCKET}/`;
}
const USERNAME_FORMAT = /^[A-Za-z0-9_-]{3,20}$/;

// window.x plutôt que let (ticket V2 Vite, type="module") : currentUserProfile lu depuis
// DesktopNavbar.js/dashboard.js/public-profile.js aussi. cachedAvatarOptions reste 100% locale.
window.currentUserProfile = null;
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
        currentUserProfile = {
            id: user.id, pseudo: '', avatar_url: null, created_at: user.created_at,
            username: null, is_public: false, collection_visible: false, wishlist_visible: false
        };
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
        // avatar_url est un champ écrit librement par l'utilisateur (upsert direct possible en
        // contournant l'UI) : toujours échapper avant interpolation dans l'attribut src, sous peine
        // de XSS stocké visible par d'autres utilisateurs (profil public, recherche collectionneurs).
        return `<img src="${escapeHtml(p.avatar_url)}" alt="" class="profile-avatar" loading="lazy" style="width:${sizePx}px;height:${sizePx}px;" onerror="this.outerHTML='<span class=&quot;profile-avatar profile-avatar-fallback&quot; style=&quot;width:${sizePx}px;height:${sizePx}px;font-size:${Math.round(sizePx * 0.55)}px;&quot;>${PROFILE_FALLBACK_EMOJI}</span>'">`;
    }
    return `<span class="profile-avatar profile-avatar-fallback" style="width:${sizePx}px;height:${sizePx}px;font-size:${Math.round(sizePx * 0.55)}px;">${PROFILE_FALLBACK_EMOJI}</span>`;
}

async function openProfileModal() {
    const content = document.getElementById('profile-modal-content');
    const p = currentUserProfile || {};

    content.innerHTML = `
        <button class="modal-close" onclick="closeProfileModal()"><i class="ti ti-x" aria-hidden="true"></i></button>
        <div class="modal-scroll">
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

            <div class="profile-public-section">
                <div class="profile-public-section-title">Profil public</div>

                <div class="form-group">
                    <label for="profile-username-input">Username</label>
                    <input type="text" id="profile-username-input" maxlength="20" value="${escapeHtml(p.username || '')}" placeholder="3 à 20 caractères : lettres, chiffres, _ -" oninput="onProfileUsernameInput()">
                    <p class="profile-username-status" id="profile-username-status"></p>
                </div>

                <label class="profile-toggle-row">
                    <span>Rendre mon profil visible</span>
                    <input type="checkbox" id="profile-is-public-input" ${p.is_public ? 'checked' : ''} onchange="checkProfileDirty()">
                </label>
                <p class="profile-toggle-hint">Les réglages ci-dessous n'ont d'effet que si le profil est visible.</p>

                <label class="profile-toggle-row">
                    <span>Partager ma collection</span>
                    <input type="checkbox" id="profile-collection-visible-input" ${p.collection_visible ? 'checked' : ''} onchange="checkProfileDirty()">
                </label>

                <label class="profile-toggle-row">
                    <span>Partager ma wishlist</span>
                    <input type="checkbox" id="profile-wishlist-visible-input" ${p.wishlist_visible ? 'checked' : ''} onchange="checkProfileDirty()">
                </label>

                ${p.is_public && p.username ? `
                    <a class="profile-public-preview-link" href="#/user/${encodeURIComponent(p.username)}" onclick="closeProfileModal()">
                        <i class="ti ti-external-link" aria-hidden="true"></i> Voir mon profil public
                    </a>
                ` : ''}
            </div>

            <div class="modal-edit-actions">
                <button class="modal-save-btn" id="profile-save-btn" style="display:none;" onclick="saveProfile(this)"><i class="ti ti-device-floppy" aria-hidden="true"></i> Enregistrer</button>
            </div>
        </div>
    `;

    content.dataset.selectedAvatarUrl = p.avatar_url || '';
    content.dataset.initialPseudo = p.pseudo || '';
    content.dataset.initialAvatarUrl = p.avatar_url || '';
    content.dataset.initialUsername = p.username || '';
    content.dataset.initialIsPublic = p.is_public ? '1' : '0';
    content.dataset.initialCollectionVisible = p.collection_visible ? '1' : '0';
    content.dataset.initialWishlistVisible = p.wishlist_visible ? '1' : '0';
    document.getElementById('profile-modal-overlay').classList.add('active');

    const urls = await fetchAvatarOptions();
    const grid = document.getElementById('profile-avatar-grid');
    if (!grid) return; // modale refermée avant la fin du chargement

    if (urls.length === 0) {
        grid.innerHTML = '<p class="dashboard-empty-text" style="padding:0.5rem 0;">Aucun avatar trouvé dans le bucket "avatar".</p>';
        return;
    }

    // url provient du listing du bucket Storage "avatar" (getPublicUrl), pas d'un champ texte libre,
    // mais on échappe quand même par défense en profondeur et pour éviter toute casse d'attribut si un
    // nom de fichier contient des caractères spéciaux. On passe par data-url + this.dataset plutôt que
    // d'interpoler url dans l'attribut onclick="...('${url}')" : un ' échappé en &#39; par escapeHtml est
    // redécodé par le parseur HTML avant d'atteindre le JS, donc insuffisant à protéger un contexte
    // chaîne JS entre guillemets simples.
    grid.innerHTML = urls.map(url => `
        <button type="button" class="profile-avatar-swatch ${url === content.dataset.selectedAvatarUrl ? 'selected' : ''}" data-url="${escapeHtml(url)}" onclick="selectProfileAvatar(this.dataset.url, this)">
            <img src="${escapeHtml(url)}" alt="" loading="lazy">
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
    const usernameInput = document.getElementById('profile-username-input');
    const isPublicInput = document.getElementById('profile-is-public-input');
    const collectionVisibleInput = document.getElementById('profile-collection-visible-input');
    const wishlistVisibleInput = document.getElementById('profile-wishlist-visible-input');
    if (!content || !saveBtn || !pseudoInput) return;

    const dirty = pseudoInput.value.trim() !== content.dataset.initialPseudo
        || content.dataset.selectedAvatarUrl !== content.dataset.initialAvatarUrl
        || usernameInput.value.trim() !== content.dataset.initialUsername
        || (isPublicInput.checked ? '1' : '0') !== content.dataset.initialIsPublic
        || (collectionVisibleInput.checked ? '1' : '0') !== content.dataset.initialCollectionVisible
        || (wishlistVisibleInput.checked ? '1' : '0') !== content.dataset.initialWishlistVisible;

    saveBtn.style.display = dirty ? '' : 'none';
}

// Pas de vérification de disponibilité en direct : RLS "profiles" (SELECT scopée auth.uid()=id,
// cf audit pg_policies) empêche toute lecture des usernames des autres utilisateurs tant qu'aucune
// vue publique n'existe (Phase 2). Un contrôle qui interrogerait la table renverrait donc toujours
// "disponible", y compris pour un username déjà pris — trompeur plutôt qu'utile. Seul le format est
// validable côté client ; la collision réelle est tranchée par l'index unique en base au moment de
// l'enregistrement (cf error.code === '23505' dans saveProfile).
function onProfileUsernameInput() {
    checkProfileDirty();

    const statusEl = document.getElementById('profile-username-status');
    const input = document.getElementById('profile-username-input');
    if (!statusEl || !input) return;

    const value = input.value.trim();
    if (!value || USERNAME_FORMAT.test(value)) {
        statusEl.textContent = '';
        statusEl.className = 'profile-username-status';
    } else {
        statusEl.textContent = '3 à 20 caractères : lettres, chiffres, _ ou -';
        statusEl.className = 'profile-username-status profile-username-invalid';
    }
}

async function saveProfile(btn) {
    const content = document.getElementById('profile-modal-content');
    const pseudo = document.getElementById('profile-pseudo-input').value.trim();
    const avatar_url = content.dataset.selectedAvatarUrl || null;
    const usernameRaw = document.getElementById('profile-username-input').value.trim();
    const username = usernameRaw || null;
    const is_public = document.getElementById('profile-is-public-input').checked;
    const collection_visible = document.getElementById('profile-collection-visible-input').checked;
    const wishlist_visible = document.getElementById('profile-wishlist-visible-input').checked;

    if (!pseudo) {
        showMessage('Le pseudo ne peut pas être vide', 'error');
        return;
    }

    // Défense en profondeur : l'UI ne propose que des URLs issues de fetchAvatarOptions (donc déjà
    // conformes à ce préfixe). Un avatar_url qui ne matche pas ne peut venir que d'un état DOM corrompu
    // ou d'une manipulation directe — on refuse plutôt que d'envoyer une valeur non fiable à la base.
    if (avatar_url && !avatar_url.startsWith(getAvatarUrlPrefix())) {
        showMessage('Avatar invalide, choisis-en un dans la liste', 'error');
        return;
    }

    const statusEl = document.getElementById('profile-username-status');

    if (username && !USERNAME_FORMAT.test(username)) {
        if (statusEl) {
            statusEl.textContent = '3 à 20 caractères : lettres, chiffres, _ ou -';
            statusEl.className = 'profile-username-status profile-username-invalid';
        }
        showMessage('Username invalide (3 à 20 caractères : lettres, chiffres, _ ou -)', 'error');
        return;
    }

    // Le pseudo reste facultatif et n'importe quel visiteur/profil privé peut rester sans username ;
    // il devient obligatoire seulement quand le profil est rendu visible, puisqu'il sert d'identifiant
    // de la future URL publique (#/user/<username>, non implémentée en Phase 1).
    if (is_public && !username) {
        if (statusEl) {
            statusEl.textContent = 'Username requis pour rendre le profil visible';
            statusEl.className = 'profile-username-status profile-username-invalid';
        }
        showMessage('Choisis un username avant de rendre ton profil visible', 'error');
        return;
    }

    btn.disabled = true;
    const originalHtml = btn.innerHTML;
    btn.innerHTML = '<span class="loading"></span> Enregistrement...';

    const { data: userData } = await supabaseClient.auth.getUser();
    const userId = userData?.user?.id;

    const { error } = await supabaseClient
        .from('profiles')
        .upsert({ id: userId, pseudo, avatar_url, username, is_public, collection_visible, wishlist_visible });

    btn.disabled = false;
    btn.innerHTML = originalHtml;

    if (error) {
        // Filet de sécurité si un autre onglet/appareil a pris le même username entre la vérification
        // et l'enregistrement : l'index unique (profiles_username_lower_unique) le rejette côté base.
        if (error.code === '23505') {
            showMessage('Ce username vient d\'être pris, choisis-en un autre', 'error');
        } else {
            showMessage('Erreur lors de l\'enregistrement du profil', 'error');
            console.error(error);
        }
        return;
    }

    currentUserProfile = { id: userId, pseudo, avatar_url, username, is_public, collection_visible, wishlist_visible };
    showMessage('Profil mis à jour', 'success');
    closeProfileModal();

    const activeTab = document.querySelector('.tab-content.active');
    // rebuild:true : avatar/pseudo viennent de changer, la navbar globale (NAV1) doit les refléter -
    // sinon updateDesktopNavigation ne touche qu'à l'état actif, jamais à ces informations.
    if (activeTab && typeof updateDesktopNavigation === 'function') updateDesktopNavigation(activeTab.id, { rebuild: true });
    // Ne concerne plus que le contenu métier du hero (salutation, etc.) : la navbar n'y est plus injectée
    // depuis NAV1, mise à jour désormais gérée uniquement par la ligne ci-dessus.
    if (document.getElementById('dashboard-hero') && typeof renderDashboardHero === 'function') renderDashboardHero();
}

function closeProfileModal() {
    document.getElementById('profile-modal-overlay').classList.remove('active');
}

// Un seul #profile-menu existe dans le DOM depuis la navbar globale (NAV1) ; on continue malgré tout à
// le retrouver via le bouton cliqué (closest) plutôt que getElementById, plus direct et robuste par
// nature - pas de raison de réintroduire une dépendance à un id unique pour ce qui marchait déjà sans.
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

// ===== Exports window (ticket V2 Vite, type="module") =====
// Les déclarations top-level d'un module ES ne s'attachent plus automatiquement à window
// (contrairement à un <script> classique) : réexport explicite pour que les autres scripts
// (chargés en modules indépendants, sans import/export entre eux, scope global inchangé)
// puissent continuer à référencer ces noms tels quels — y compris depuis des onclick="..."
// inline dans du HTML généré. Liste exhaustive des déclarations top-level de ce fichier
// (hors variables déjà passées en window.x = ... directement à leur déclaration, cf audit
// du 2026-08-14 sur l'état mutable partagé entre fichiers).
window.AVATAR_BUCKET = AVATAR_BUCKET;
window.PROFILE_FALLBACK_EMOJI = PROFILE_FALLBACK_EMOJI;
window.getAvatarUrlPrefix = getAvatarUrlPrefix;
window.USERNAME_FORMAT = USERNAME_FORMAT;
window.cachedAvatarOptions = cachedAvatarOptions;
window.loadUserProfile = loadUserProfile;
window.formatMemberSince = formatMemberSince;
window.fetchAvatarOptions = fetchAvatarOptions;
window.profileAvatarHtml = profileAvatarHtml;
window.openProfileModal = openProfileModal;
window.selectProfileAvatar = selectProfileAvatar;
window.checkProfileDirty = checkProfileDirty;
window.onProfileUsernameInput = onProfileUsernameInput;
window.saveProfile = saveProfile;
window.closeProfileModal = closeProfileModal;
window.openProfileMenuEl = openProfileMenuEl;
window.toggleProfileMenu = toggleProfileMenu;
window.closeProfileMenu = closeProfileMenu;
