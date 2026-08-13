// Administration (repérage + correction des cartes sans image canonique) - Pokémon Tracker
// Dépend de : supabaseClient (tracker.js), currentUserIsAdmin (modules/auth.js), escapeHtml/showMessage/
// getSetIdFromTcgdexId (modules/utils.js), uploadImageToStorage (modules/storage.js), navigateToTab (tracker.js)
// Etat possédé : adminMissingImageCards, adminSearchQuery, adminUploadTargetTcgdexId, adminUploadFile,
// adminAutoSearchResult
//
// Portée volontairement étroite (V1) : uniquement le repérage + la correction des cartes sans image.
// Pas de back-office générique, pas de log visible, pas de filtres avancés - cf audit précédent.
// La vraie barrière de sécurité est côté serveur (is_admin() revérifié par chaque RPC) : ce module
// ne fait qu'éviter d'appeler les RPC pour rien si l'utilisateur courant n'est pas admin.

let adminMissingImageCards = [];
let adminSearchQuery = '';
let adminUploadTargetTcgdexId = null;
let adminUploadFile = null;
let adminAutoSearchResult = null;

// Mapping tcgdex_set_id -> pokemon_tcg_api_set_id, uniquement les sets réellement rencontrés dans les
// cartes sans image (cf audit Pokémon TCG API du 2026-08-11 : pas de dérivation automatique fiable,
// les conventions de nommage des Trainer Gallery/Galarian Gallery varient trop selon les générations
// pour être devinées sans risque de faux positif). A compléter au fil de l'eau quand un nouveau set
// apparaît dans la liste admin - jamais un scan/mapping de tout le catalogue.
const PTCG_SET_ID_MAP = {
    'swsh12.5tg': 'swsh12tg',   // Tempête Argentée Galerie de Dresseurs -> Silver Tempest Trainer Gallery
    'swsh11.5tg': 'swsh11tg',   // Origine Perdue Galerie de Dresseurs -> Lost Origin Trainer Gallery
    'swsh9.5tg': 'swsh9tg',     // Stars Étincelantes Galerie de Dresseurs -> Brilliant Stars Trainer Gallery
    'swsh10.5tg': 'swsh10tg',   // Astres Radieux Galerie de Dresseurs -> Astral Radiance Trainer Gallery
    // Convention différente ici (pt5, pas juste ".5" retiré) - confirme qu'il ne faut jamais généraliser
    // une règle de transformation, uniquement mapper au cas par cas après vérification directe.
    'swsh12.5gg': 'swsh12pt5gg', // Étincelles Étoilées Galerie Galar -> Crown Zenith Galarian Gallery
    // Identité (pas de transformation) : id identique des deux côtés. Couverture PTCG plus restreinte
    // que TCGdex sur ce set (196 cartes indexées vs 226) - certaines cartes svp-### resteront donc
    // "indisponible" même mappées, c'est attendu (promos ajoutées de façon irrégulière côté PTCG).
    'svp': 'svp', // SVP Black Star Promos -> Scarlet & Violet Black Star Promos
    // Identité également (vérifié directement sur l'API : set.id "swshp", 304 cartes indexées).
    // swshp-SWSH301 en particulier reste "indisponible" même mappé (absent du catalogue PTCG malgré
    // la présence de SWSH300/303/304/305/306/307) - même situation d'irrégularité que svp ci-dessus.
    'swshp': 'swshp' // SWSH Black Star Promos -> Sword & Shield Black Star Promos
};

const PTCG_API_BASE = 'https://api.pokemontcg.io/v2';
// Site statique GitHub Pages sans backend : cette clé est publiquement visible dans le code source
// par construction (aucun moyen de la cacher côté client). Décision assumée (voir conversation du
// 2026-08-11) plutôt qu'un oubli - clé gratuite, sans facturation, régénérable sur dev.pokemontcg.io
// si jamais elle est réutilisée par un tiers. Relève le plafond de 1000/jour (30/min) à 20000/jour.
const PTCG_API_KEY = 'f1b80e15-e53c-4981-850e-70b9bdd24a2f';

// Point d'entrée de l'onglet #/admin (appelé depuis activateTabContent, tracker.js).
function renderAdminGate() {
    const panel = document.getElementById('admin-panel');
    if (!panel) return;

    if (!currentUserIsAdmin) {
        panel.innerHTML = `
            <button type="button" class="public-page-back-link" onclick="navigateToTab('tab-dashboard')"><i class="ti ti-arrow-left" aria-hidden="true"></i> Retour à PokéTracker</button>
            <div class="collectors-header">
                <h1 class="collectors-title">Administration</h1>
                <p class="collectors-subtitle">Accès réservé.</p>
            </div>
        `;
        return;
    }

    loadAdminMissingImages();
}

async function loadAdminMissingImages() {
    const countEl = document.getElementById('admin-missing-count');
    const tbody = document.getElementById('admin-missing-images-body');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="10" class="empty-state">Chargement...</td></tr>';

    const { data, error } = await supabaseClient.rpc('get_missing_image_cards');
    if (error) {
        console.error('Erreur chargement cartes sans image:', error);
        tbody.innerHTML = '<tr><td colspan="10" class="empty-state">Erreur de chargement.</td></tr>';
        return;
    }

    adminMissingImageCards = data || [];
    if (countEl) countEl.textContent = `Cartes sans image : ${adminMissingImageCards.length}`;
    renderAdminMissingImagesTable();
}

function onAdminSearchInput() {
    const input = document.getElementById('admin-search-input');
    adminSearchQuery = input ? input.value.trim().toLowerCase() : '';
    renderAdminMissingImagesTable();
}

function renderAdminMissingImagesTable() {
    const tbody = document.getElementById('admin-missing-images-body');
    if (!tbody) return;

    const filtered = adminSearchQuery
        ? adminMissingImageCards.filter(c =>
            (c.name || '').toLowerCase().includes(adminSearchQuery) ||
            (c.series || '').toLowerCase().includes(adminSearchQuery) ||
            (c.tcgdex_id || '').toLowerCase().includes(adminSearchQuery))
        : adminMissingImageCards;

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" class="empty-state">Aucune carte sans image${adminSearchQuery ? ' pour ce filtre' : ''}.</td></tr>`;
        return;
    }

    // data-tcgdex-id + this.dataset plutôt qu'interpoler tcgdex_id dans l'attribut onclick="...('${..}')" :
    // même raison que le correctif avatar_url (profile.js) - un tcgdex_id ne peut en pratique venir que
    // du catalogue TCGdex, mais rien ne le garantit strictement côté base (cf audit Ticket 0), donc même
    // défense en profondeur.
    tbody.innerHTML = filtered.map(c => `
        <tr>
            <td><div class="no-image-placeholder small"><i class="ti ti-photo-off" aria-hidden="true"></i></div></td>
            <td>${escapeHtml(c.name || 'N/A')}</td>
            <td>${escapeHtml(c.series || 'N/A')}</td>
            <td>${escapeHtml(c.number || '')}</td>
            <td>${escapeHtml(c.rarity || '')}</td>
            <td><code>${escapeHtml(c.tcgdex_id)}</code></td>
            <td style="text-align:center;">${Number(c.cards_count) || 0}</td>
            <td style="text-align:center;">${Number(c.wishlist_count) || 0}</td>
            <td style="text-align:center;">${Number(c.users_count) || 0}</td>
            <td style="text-align:center;">
                <button class="filter-toggle-btn" data-tcgdex-id="${escapeHtml(c.tcgdex_id)}" onclick="openAdminImageUploadModal(this.dataset.tcgdexId)">Ajouter une image</button>
                <button class="filter-toggle-btn" data-tcgdex-id="${escapeHtml(c.tcgdex_id)}" onclick="searchAdminAutoImage(this.dataset.tcgdexId)">Rechercher automatiquement</button>
            </td>
        </tr>
    `).join('');
}

// Une seule tentative de nouvel essai sur 5xx : l'API a été vue basculer 500 -> 200 sur un appel
// identique répété immédiatement, deux fois pendant l'usage réel de cette fonctionnalité (pas
// seulement pendant l'audit). Jamais de retry sur 404 (une carte absente reste absente) ni de
// second essai après le premier retry - un fallback non critique ne doit pas s'acharner.
async function fetchPtcgCard(ptcgId) {
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const response = await fetch(`${PTCG_API_BASE}/cards/${encodeURIComponent(ptcgId)}`, {
                headers: { 'X-Api-Key': PTCG_API_KEY }
            });
            if (response.ok) {
                const json = await response.json();
                return json?.data || null;
            }
            if (response.status < 500) return null; // 404 notamment : inutile de réessayer
        } catch (error) {
            console.error('Erreur recherche Pokémon TCG API:', error);
        }
    }
    return null;
}

// Pokémon TCG API en fallback non critique (cf audit du 2026-08-11) : matching exact set+numéro
// uniquement, aucun fuzzy matching, aucune recherche par nom (le nom FR TCGdex ne correspond jamais
// au nom EN Pokémon TCG API - vérifié). Si le mapping de set est absent, ou si l'appel échoue pour
// n'importe quelle raison (404, 5xx - l'API a été vue instable en direct pendant l'audit -, timeout,
// erreur réseau), on affiche le même message discret et on s'arrête : jamais de blocage de l'upload
// manuel existant, jamais de distinction "carte inexistante" vs "panne".
async function searchAdminAutoImage(tcgdexId) {
    const card = adminMissingImageCards.find(c => c.tcgdex_id === tcgdexId);
    if (!card) return;

    const tcgdexSetId = getSetIdFromTcgdexId(tcgdexId);
    const ptcgSetId = PTCG_SET_ID_MAP[tcgdexSetId];

    if (!ptcgSetId) {
        showMessage('Image automatique indisponible — vous pouvez toujours l\'ajouter manuellement.', 'error');
        return;
    }

    const ptcgId = `${ptcgSetId}-${card.number}`;
    const data = await fetchPtcgCard(ptcgId);

    if (!data?.images?.large) {
        showMessage('Image automatique indisponible — vous pouvez toujours l\'ajouter manuellement.', 'error');
        return;
    }

    openAdminAutoImageModal(tcgdexId, data);
}

function openAdminAutoImageModal(tcgdexId, data) {
    adminAutoSearchResult = { tcgdexId, imageUrl: data.images.large };

    const content = document.getElementById('admin-image-upload-content');
    content.innerHTML = `
        <button class="modal-close" onclick="closeAdminImageUploadModal()">✕</button>
        <div class="modal-scroll">
            <div class="modal-title" style="margin-bottom: 1rem;">Image trouvée</div>
            <img src="${escapeHtml(data.images.large)}" alt="" style="max-width:100%;border-radius:12px;">
            <p style="margin-top:0.75rem;font-size:0.85rem;color:var(--text-primary);">${escapeHtml(data.name || '')}</p>
            <p style="font-size:0.8rem;color:var(--slate);">${escapeHtml(data.set?.name || '')} — #${escapeHtml(data.number || '')}</p>
            <p style="font-size:0.8rem;color:var(--gold);margin-top:0.5rem;">Image anglaise — Pokémon TCG API</p>
            <div class="modal-edit-actions">
                <button class="modal-save-btn" id="admin-auto-image-submit-btn" onclick="submitAdminAutoImage()"><i class="ti ti-device-floppy" aria-hidden="true"></i> Utiliser cette image</button>
                <button class="modal-cancel-btn" onclick="closeAdminImageUploadModal()">Annuler</button>
            </div>
        </div>
    `;
    document.getElementById('admin-image-upload-overlay').classList.add('active');
}

async function submitAdminAutoImage() {
    if (!adminAutoSearchResult) return;
    const { tcgdexId, imageUrl } = adminAutoSearchResult;

    const btn = document.getElementById('admin-auto-image-submit-btn');
    if (btn.disabled) return;
    btn.disabled = true;
    const originalHtml = btn.innerHTML;
    btn.innerHTML = '<span class="loading"></span> Import...';

    try {
        const response = await fetch(imageUrl);
        if (!response.ok) throw new Error('Téléchargement de l\'image source impossible');
        const blob = await response.blob();

        // uploadImageToStorage accepte n'importe quel Blob (pas seulement un File d'input) : même
        // pipeline resize/upload que l'upload manuel, écrase le chemin canonique tcgdex/<id>.jpg -
        // jamais l'URL Pokémon TCG API elle-même stockée en base.
        const publicUrl = await uploadImageToStorage(blob, tcgdexId);

        const { data, error } = await supabaseClient.rpc('admin_set_card_image', {
            p_tcgdex_id: tcgdexId,
            p_image_url: publicUrl
        });
        if (error) throw error;

        const result = Array.isArray(data) ? data[0] : data;
        const total = (Number(result?.cards_updated) || 0) + (Number(result?.wishlist_updated) || 0);
        showMessage(`Image importée depuis Pokémon TCG API, ${total} ligne(s) mise(s) à jour`, 'success');
        closeAdminImageUploadModal();
        await loadAdminMissingImages();
    } catch (error) {
        showMessage('Erreur lors de l\'import de l\'image', 'error');
        console.error(error);
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

function openAdminImageUploadModal(tcgdexId) {
    adminUploadTargetTcgdexId = tcgdexId;
    adminUploadFile = null;

    const card = adminMissingImageCards.find(c => c.tcgdex_id === tcgdexId);
    const label = card ? `${card.name} — ${card.series} #${card.number}` : tcgdexId;

    const content = document.getElementById('admin-image-upload-content');
    content.innerHTML = `
        <button class="modal-close" onclick="closeAdminImageUploadModal()">✕</button>
        <div class="modal-scroll">
            <div class="modal-title" style="margin-bottom: 1rem;">${escapeHtml(label)}</div>
            <div class="no-image-placeholder large upload-placeholder" id="admin-upload-preview" onclick="document.getElementById('admin-upload-file-input').click()">
                <i class="ti ti-photo-off" aria-hidden="true"></i>
                <span class="upload-btn-pill"><i class="ti ti-upload" aria-hidden="true"></i> Choisir une image</span>
            </div>
            <input type="file" id="admin-upload-file-input" accept="image/*" style="display:none" onchange="handleAdminImageFileChange(event)">
            <div class="modal-edit-actions">
                <button class="modal-save-btn" id="admin-upload-submit-btn" style="display:none;" onclick="submitAdminImageUpload()"><i class="ti ti-device-floppy" aria-hidden="true"></i> Valider</button>
                <button class="modal-cancel-btn" onclick="closeAdminImageUploadModal()">Annuler</button>
            </div>
        </div>
    `;
    document.getElementById('admin-image-upload-overlay').classList.add('active');
}

function closeAdminImageUploadModal() {
    document.getElementById('admin-image-upload-overlay').classList.remove('active');
    adminUploadTargetTcgdexId = null;
    adminUploadFile = null;
    adminAutoSearchResult = null;
}

function handleAdminImageFileChange(event) {
    const file = event.target.files[0];
    if (!file) return;
    adminUploadFile = file;

    // dataURL généré par le navigateur (pas une entrée utilisateur textuelle) : sûr à interpoler tel
    // quel dans un attribut src, même principe que les autres previews de fichier de l'app (cards.js).
    const reader = new FileReader();
    reader.onload = () => {
        const preview = document.getElementById('admin-upload-preview');
        if (preview) {
            preview.outerHTML = `<img id="admin-upload-preview" src="${reader.result}" alt="" style="max-width:100%;border-radius:12px;cursor:pointer;" onclick="document.getElementById('admin-upload-file-input').click()">`;
        }
    };
    reader.readAsDataURL(file);

    const submitBtn = document.getElementById('admin-upload-submit-btn');
    if (submitBtn) submitBtn.style.display = '';
}

async function submitAdminImageUpload() {
    if (!adminUploadFile || !adminUploadTargetTcgdexId) return;

    const btn = document.getElementById('admin-upload-submit-btn');
    if (btn.disabled) return;
    btn.disabled = true;
    const originalHtml = btn.innerHTML;
    btn.innerHTML = '<span class="loading"></span> Envoi...';

    try {
        // Chemin canonique déterministe (tcgdex/<id>.jpg, cf modules/storage.js:getTcgdexImagePath) :
        // réutilise le même helper que l'upload personnel utilisateur existant, donc les futurs ajouts
        // de cette carte par n'importe quel utilisateur réutilisent naturellement cette image via
        // checkExistingImage() - aucun code supplémentaire nécessaire pour ça.
        const publicUrl = await uploadImageToStorage(adminUploadFile, adminUploadTargetTcgdexId);

        const { data, error } = await supabaseClient.rpc('admin_set_card_image', {
            p_tcgdex_id: adminUploadTargetTcgdexId,
            p_image_url: publicUrl
        });

        if (error) throw error;

        const result = Array.isArray(data) ? data[0] : data;
        const total = (Number(result?.cards_updated) || 0) + (Number(result?.wishlist_updated) || 0);
        showMessage(`Image ajoutée, ${total} ligne(s) mise(s) à jour`, 'success');
        closeAdminImageUploadModal();
        await loadAdminMissingImages();
    } catch (error) {
        showMessage('Erreur lors de l\'envoi de l\'image', 'error');
        console.error(error);
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}
