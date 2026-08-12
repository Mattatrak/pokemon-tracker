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
