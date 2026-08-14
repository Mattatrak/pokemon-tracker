// Correspondances Wishlist/Collection (Ticket 1) - Pokémon Tracker
// Module pur : aucune dépendance à supabaseClient, aucun effet de bord, ne modifie jamais les
// tableaux reçus en argument. Sert de socle de calcul au bloc "Correspondances avec toi"
// (modules/public-profile.js) — matching uniquement par tcgdex_id, jamais par nom (cf audit :
// deux cartes de séries différentes peuvent partager un nom, jamais un tcgdex_id).

// Agrège quantity par tcgdex_id sur un tableau de cartes (collection perso OU collection publique
// tierce, même forme suffisante : { tcgdex_id, quantity }). Une carte peut apparaître en plusieurs
// rows (conditions/finish différents) pour un même tcgdex_id : toutes sommées ensemble. Quantité
// absente/invalide traitée comme 1 (même convention que le reste du code, cf. cards.js/wishlist.js
// `Number(x.quantity || 1)`), jamais 0 ou NaN qui fausserait un total.
function sumQuantityByTcgdexId(cards) {
    const totals = new Map();

    (cards || []).forEach(card => {
        const id = card?.tcgdex_id;
        if (!id) return;

        const raw = Number(card.quantity);
        const safeQty = Number.isFinite(raw) && raw > 0 ? raw : 1;

        totals.set(id, (totals.get(id) || 0) + safeQty);
    });

    return totals;
}

// Intersection wishlist -> cartes possédées, matching strict par tcgdex_id. Utilisable dans les deux
// sens (ma wishlist vs sa collection publique, ou l'inverse) : seule la forme des entrées compte
// ({ tcgdex_id, name, image, series, id } pour wishlistItems, { tcgdex_id, quantity, id } pour
// ownedCards). Ne recopie que les champs utiles à l'UI (pas purchase_price/market_value/condition/
// finish : hors scope de ce bloc, jamais lus ici). wishlistItemId/ownedCardId servent uniquement à
// rouvrir la fiche détail existante (showPublicCardDetail/showPublicWishlistItemDetail côté appelant),
// jamais utilisés pour du calcul ici.
function computeWishlistMatch(wishlistItems, ownedCards) {
    const ownedTotals = sumQuantityByTcgdexId(ownedCards);

    // Premier id rencontré par tcgdex_id (une carte peut avoir plusieurs rows/conditions) : suffisant
    // pour rouvrir une fiche détail représentative, pas pour du calcul de quantité (déjà fait ci-dessus).
    const ownedFirstId = new Map();
    (ownedCards || []).forEach(card => {
        const id = card?.tcgdex_id;
        if (id && !ownedFirstId.has(id)) ownedFirstId.set(id, card.id);
    });

    const seen = new Set();
    const matches = [];

    (wishlistItems || []).forEach(item => {
        const id = item?.tcgdex_id;
        if (!id || seen.has(id)) return; // tcgdex_id absent, ou carte wishlist déjà traitée (dédup)
        if (!ownedTotals.has(id)) return;

        seen.add(id);
        const ownedQty = ownedTotals.get(id);

        matches.push({
            tcgdex_id: id,
            name: item.name,
            image: item.image,
            series: item.series || '',
            ownedQty,
            // multiple (ownedQty>=2) : conservé pour d'éventuels autres usages (affichage informatif),
            // mais ne détermine plus l'existence d'une opportunité d'échange (Phase 5, P5-1) — c'est
            // désormais au tableau reçu par cette fonction d'être déjà filtré au surplus échangeable
            // (cf hasPotentialTrade ci-dessous). Un ownedQty=1 sur un tableau déjà filtré au surplus
            // représente bien une carte à proposer.
            multiple: ownedQty >= 2,
            wishlistItemId: item.id,
            ownedCardId: ownedFirstId.get(id)
        });
    });

    return matches;
}

// Match réciproque (Phase 5, P5-1) : true si chaque sens du matching a au moins une correspondance.
// CONTRAT IMPORTANT — matchesA/matchesB doivent DÉJÀ représenter des correspondances échangeables : le
// surplus réel (duplicateQuantity, cf getDuplicateCardsWithQuantity/modules/collection.js), jamais une
// quantité totale possédée brute. Cette fonction ne fait plus la distinction elle-même (elle faisait
// auparavant .some(m => m.multiple), un seuil ownedQty>=2 qui n'a plus de sens une fois que ownedQty
// représente déjà un surplus : un surplus de 1 suffit à avoir quelque chose à proposer, la fonction ne
// doit pas en exiger 2). Ne préjuge toujours pas de l'intention réelle du propriétaire de céder la carte.
function hasPotentialTrade(matchesA, matchesB) {
    return (matchesA || []).length > 0 && (matchesB || []).length > 0;
}

// ===== Exports window (ticket V2 Vite, type="module") =====
// Les déclarations top-level d'un module ES ne s'attachent plus automatiquement à window
// (contrairement à un <script> classique) : réexport explicite pour que les autres scripts
// (chargés en modules indépendants, sans import/export entre eux, scope global inchangé)
// puissent continuer à référencer ces noms tels quels — y compris depuis des onclick="..."
// inline dans du HTML généré. Liste exhaustive des déclarations top-level de ce fichier
// (hors variables déjà passées en window.x = ... directement à leur déclaration, cf audit
// du 2026-08-14 sur l'état mutable partagé entre fichiers).
window.sumQuantityByTcgdexId = sumQuantityByTcgdexId;
window.computeWishlistMatch = computeWishlistMatch;
window.hasPotentialTrade = hasPotentialTrade;
