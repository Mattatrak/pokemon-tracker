// Rendu de carte partagé (Phase 3, cf roadmap technique) - Pokémon Tracker
// Dépend de: escapeHtml/renderFinishBadge/getRarityIconHtml (utils.js), getCollectionUploadPlaceholder (card-detail.js)
//
// Extraction pure du HTML de "carte en grille" (image + badges + overlay), jusqu'ici dupliqué
// quasi à l'identique dans 3 endroits : renderCollectionGrid (collection.js), et
// renderPublicCollectionGrid / renderPublicDuplicateCardsHtml (public-profile.js). Aucun changement
// visuel voulu, sauf un : l'échappement HTML est désormais appliqué uniformément dans les 3 contextes,
// y compris la collection perso (qui ne l'appliquait pas avant - la donnée y est réputée fiable, mais
// rien ne justifie de la traiter différemment des contextes publics ici).
//
// Volontairement PAS pensé pour Progression/Wishlist/Dashboard/future Vue Classeur : ces rendus ont
// des layouts réellement différents (bouton d'ajout rapide, résolution d'image en cascade, badges
// propres...), cf audit Phase 3 - les y forcer aurait ajouté des options que seul un appelant utilise.

// Icône statique affichée en cas d'erreur/absence d'image, pour les contextes en lecture seule
// (aucun upload possible : grilles publiques). Le contexte Collection perso a son propre fallback
// cliquable (getCollectionUploadPlaceholder, card-detail.js), passé via l'option imageFallback.
function getGridNoImageHtml() {
    return '<div class="collection-card-noimg"><i class="ti ti-photo-off" aria-hidden="true"></i></div>';
}

// Badge en haut à droite de la carte : soit la quantité possédée (masqué si 1 seul exemplaire), soit
// le nombre de doublons échangeables (toujours affiché, jamais les deux en même temps - un seul appelant
// utilise chaque mode).
function renderGridCardBadge(card, badgeMode) {
    if (badgeMode === 'duplicate') {
        return `<div class="qty-badge" title="Doublons disponibles">↔ ${card.duplicateQuantity}</div>`;
    }
    const qty = Number(card.quantity || 1);
    return qty > 1 ? `<div class="qty-badge">×${qty}</div>` : '';
}

// options :
//   detailFn          - nom de la fonction globale appelée au clic ('showCardDetail' | 'showPublicCardDetail')
//   badgeMode         - 'quantity' (défaut, ×N si qty>1) | 'duplicate' (↔N, toujours affiché)
//   imageFallback     - 'static' (défaut, icône non cliquable) | 'upload' (placeholder cliquable, écriture possible)
//   showAcquisitionIcon - true pour afficher l'icône booster/achat (absente des vues publiques, acquisition_type non exposé)
function renderGridCardHtml(card, options) {
    const { detailFn, badgeMode = 'quantity', imageFallback = 'static', showAcquisitionIcon = false } = options;

    const qty = Number(card.quantity || 1);
    const lineTotal = Number(card.market_value || 0) * qty;
    const conditionClass = (card.condition || '').toLowerCase();

    const fallbackCall = imageFallback === 'upload'
        ? `getCollectionUploadPlaceholder(${card.id}, 'full')`
        : 'getGridNoImageHtml()';
    const fallbackHtml = imageFallback === 'upload'
        ? getCollectionUploadPlaceholder(card.id, 'full')
        : getGridNoImageHtml();

    let acquisitionHtml = '';
    if (showAcquisitionIcon) {
        const icon = card.acquisition_type === 'pack' ? '<i class="ti ti-gift" aria-hidden="true"></i>' : '<i class="ti ti-shopping-bag" aria-hidden="true"></i>';
        const title = card.acquisition_type === 'pack' ? 'Sortie d\'un booster' : 'Achetée';
        acquisitionHtml = `<span class="acquisition-icon" title="${title}">${icon}</span>`;
    }

    return `
        <div class="collection-card" onclick="${detailFn}(${card.id})">
            ${card.image
                ? `<img src="${card.image}" alt="${escapeHtml(card.name)}" loading="lazy" onerror="this.outerHTML=${fallbackCall}">`
                : fallbackHtml
            }
            ${renderGridCardBadge(card, badgeMode)}
            <div class="price-badge">${lineTotal.toFixed(2)}€</div>
            <div class="set-rarity-badge-row">
                ${card.series_symbol ? `<img src="${card.series_symbol}" class="set-symbol-badge" alt="" title="${escapeHtml(card.series)}" onerror="this.remove()">` : ''}
                ${getRarityIconHtml(card.rarity) ? `<div class="rarity-badge-corner" title="${escapeHtml(card.rarity)}">${getRarityIconHtml(card.rarity, 18)}</div>` : ''}
            </div>
            <div class="collection-card-overlay">
                <div class="collection-card-name">${escapeHtml(card.name)}</div>
                <div class="collection-card-set">${card.series_logo ? `<img src="${card.series_logo}" class="series-logo-inline" alt="" onerror="this.remove()">` : ''}${escapeHtml(card.series)} · #${card.number}</div>
                <span class="condition-badge-grid ${conditionClass}">${card.condition}</span>
                ${renderFinishBadge(card.finish, 'condition-badge-grid finish-badge', 12)}
                ${acquisitionHtml}
            </div>
        </div>
    `;
}

window.getGridNoImageHtml = getGridNoImageHtml;
window.renderGridCardHtml = renderGridCardHtml;
