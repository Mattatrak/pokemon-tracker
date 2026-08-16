// Favoris - Pokémon Tracker
// Dépend de: supabaseClient (tracker.js), showMessage (utils.js)
// Etat possédé : favoriteTcgdexIds (Set des tcgdex_id en favoris pour l'utilisateur connecté)

let favoriteTcgdexIds = new Set();

async function loadFavorites() {
    const { data, error } = await supabaseClient.from('favorites').select('tcgdex_id');
    if (error) {
        console.error('Erreur chargement favoris:', error);
        return;
    }
    favoriteTcgdexIds = new Set((data || []).map(f => f.tcgdex_id));
}

function isFavorite(tcgdexId) {
    return !!tcgdexId && favoriteTcgdexIds.has(tcgdexId);
}

async function toggleFavorite(tcgdexId, buttonEl) {
    if (!tcgdexId || (buttonEl && buttonEl.disabled)) return;
    if (buttonEl) buttonEl.disabled = true;

    const currentlyFavorite = favoriteTcgdexIds.has(tcgdexId);
    const { error } = currentlyFavorite
        ? await supabaseClient.from('favorites').delete().eq('tcgdex_id', tcgdexId)
        : await supabaseClient.from('favorites').insert([{ tcgdex_id: tcgdexId }]);

    if (buttonEl) buttonEl.disabled = false;

    if (error) {
        showMessage(currentlyFavorite ? 'Erreur lors du retrait des favoris' : 'Erreur lors de l\'ajout aux favoris', 'error');
        console.error(error);
        return;
    }

    if (currentlyFavorite) favoriteTcgdexIds.delete(tcgdexId);
    else favoriteTcgdexIds.add(tcgdexId);

    if (buttonEl) applyFavoriteButtonState(buttonEl, !currentlyFavorite);
}

function applyFavoriteButtonState(buttonEl, active) {
    buttonEl.classList.toggle('favorite-star-active', active);
    buttonEl.title = active ? 'Retirer des favoris' : 'Ajouter aux favoris';
    const icon = buttonEl.querySelector('i');
    if (icon) icon.className = active ? 'ti ti-star-filled' : 'ti ti-star';
}

// Bouton étoile prêt à insérer dans un template HTML (fiche détail collection)
function favoriteStarHtml(tcgdexId) {
    if (!tcgdexId) return '';
    const active = isFavorite(tcgdexId);
    return `
        <button type="button" class="favorite-star${active ? ' favorite-star-active' : ''}" onclick="event.stopPropagation(); toggleFavorite('${tcgdexId}', this)" title="${active ? 'Retirer des favoris' : 'Ajouter aux favoris'}" aria-label="Ajouter aux favoris">
            <i class="ti ${active ? 'ti-star-filled' : 'ti-star'}" aria-hidden="true"></i>
        </button>
    `;
}

// ===== Exports window (ticket V2 Vite, type="module") =====
// Les déclarations top-level d'un module ES ne s'attachent plus automatiquement à window
// (contrairement à un <script> classique) : réexport explicite pour que les autres scripts
// (chargés en modules indépendants, sans import/export entre eux, scope global inchangé)
// puissent continuer à référencer ces noms tels quels — y compris depuis des onclick="..."
// inline dans du HTML généré. Liste exhaustive des déclarations top-level de ce fichier
// (hors variables déjà passées en window.x = ... directement à leur déclaration, cf audit
// du 2026-08-14 sur l'état mutable partagé entre fichiers).
window.favoriteTcgdexIds = favoriteTcgdexIds;
window.loadFavorites = loadFavorites;
window.isFavorite = isFavorite;
window.toggleFavorite = toggleFavorite;
window.applyFavoriteButtonState = applyFavoriteButtonState;
window.favoriteStarHtml = favoriteStarHtml;
