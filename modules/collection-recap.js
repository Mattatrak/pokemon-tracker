// RECAP COLLECTION (Phase 4, R3+) — vocation : "ouvrir une vue synthétique de ma collection actuelle et
// comprendre immédiatement ce que je possède", pas un second Dashboard/Statistiques/Progression (cf audit
// R1 de la roadmap technique). Dépend de : filtered fourni par renderFilteredCollection (collection.js,
// via getFilteredSortedCollection) — jamais allCollectionCards directement, pour respecter les filtres
// actifs sans dupliquer la logique de filtrage. Aucune requête Supabase : tout est dérivé des cartes déjà
// en mémoire.

function formatRecapEuro(amount) {
    return new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: 'EUR',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(amount);
}

// R3 - Plus-value globale. Exclut purchase_price<=0 (carte gratuite/booster vs prix d'achat inconnu :
// impossible à distinguer dans les données actuelles - décision produit 2026-08-14) plutôt que de les
// traiter comme un coût nul, ce qui gonflerait artificiellement la plus-value affichée.
function computeRecapNetValueData(cards) {
    let coveredQuantity = 0;
    let coveredMarketValue = 0;
    let coveredPurchaseCost = 0;

    cards.forEach(card => {
        const purchasePrice = Number(card.purchase_price || 0);
        if (purchasePrice <= 0) return;

        const quantity = Number(card.quantity || 1);
        coveredQuantity += quantity;
        coveredMarketValue += Number(card.market_value || 0) * quantity;
        coveredPurchaseCost += purchasePrice * quantity;
    });

    return {
        coveredQuantity,
        coveredMarketValue,
        coveredPurchaseCost,
        netValue: coveredMarketValue - coveredPurchaseCost
    };
}

function renderRecapValueSection(cards) {
    const section = document.getElementById('recap-section-value');
    if (!section) return;

    const { coveredQuantity, coveredMarketValue, coveredPurchaseCost, netValue } = computeRecapNetValueData(cards);

    if (coveredQuantity === 0) {
        section.innerHTML = `
            <div class="recap-value-block">
                <h3 class="recap-value-title">Plus-value globale</h3>
                <p class="recap-value-empty">Aucune carte de ce périmètre n'a de prix d'achat renseigné.</p>
            </div>
        `;
        return;
    }

    const isPositive = netValue >= 0;
    const sign = isPositive ? '+' : '−';

    section.innerHTML = `
        <div class="recap-value-block">
            <h3 class="recap-value-title">Plus-value globale</h3>
            <div class="recap-value-amount ${isPositive ? 'positive' : 'negative'}">${sign}${formatRecapEuro(Math.abs(netValue))}</div>
            <div class="recap-value-detail">
                <span>Valeur marché couverte : ${formatRecapEuro(coveredMarketValue)}</span>
                <span>Coût d'achat couvert : ${formatRecapEuro(coveredPurchaseCost)}</span>
            </div>
            <p class="recap-value-sub">Calculé sur ${coveredQuantity} exemplaire${coveredQuantity > 1 ? 's' : ''} avec prix d'achat renseigné</p>
        </div>
    `;
}

// R4 - État de la collection (condition + finish). Ordre "condition" repris de collection.js:176 /
// COLLECTION_CONDITION_LABELS (seul ordre métier NM>LP>MP>HP déjà reconnu par l'app, utilisé pour le
// picker de filtre). Aucun ordre équivalent n'existe pour "finish" : seules 'normal'/'reverse' sont les
// options standard proposées à l'ajout/l'édition d'une carte (card-detail.js, cards.js) - traité comme
// l'ordre reconnu. Dans les deux cas, toute valeur hors de cette liste (donnée historique/importée non
// standard, ou foil spécifique à un variant TCGdex pour finish) est ajoutée après, triée alphabétiquement
// - jamais un ordre de reduce() non déterministe.
const RECAP_CONDITION_ORDER = ['NM', 'LP', 'MP', 'HP'];
const RECAP_FINISH_ORDER = ['normal', 'reverse'];
const RECAP_FINISH_LABELS = { normal: 'Normale', reverse: 'Reverse' };

// Petit helper local (pas une abstraction globale, cf consigne R4) mutualisant le calcul de répartition
// pour condition ET finish : compte en quantity (pas en nombre de lignes), pourcentages basés sur la
// somme de quantity du scope filtré, jamais sur allCollectionCards. INCHANGÉ depuis R4 (cf retour R4bis :
// seule la représentation visuelle change, pas ce calcul ni son ordre par défaut).
function computeRecapBreakdown(cards, { getKey, order, getLabel }) {
    const counts = {};
    let totalQuantity = 0;

    cards.forEach(card => {
        const key = getKey(card);
        const quantity = Number(card.quantity || 1);
        counts[key] = (counts[key] || 0) + quantity;
        totalQuantity += quantity;
    });

    // Seules les clés réellement présentes sont incluses (pas de segment à 0 pour une catégorie absente).
    const knownKeys = order.filter(key => counts[key] !== undefined);
    const unknownKeys = Object.keys(counts).filter(key => !order.includes(key)).sort((a, b) => a.localeCompare(b));

    return [...knownKeys, ...unknownKeys].map(key => ({
        label: getLabel(key),
        quantity: counts[key],
        pct: totalQuantity > 0 ? Math.round((counts[key] / totalQuantity) * 100) : 0
    }));
}

// R4bis - abandon des doughnuts Chart.js (99% NM en Condition les rendait illisibles, Finition avait
// trop de petits segments) au profit d'un portrait synthétique texte/barres. pct vient déjà arrondi de
// computeRecapBreakdown ; un groupe non-nul qui arrondit à 0% affiche "<1%" plutôt qu'un "0%" trompeur.
function formatRecapPct(entry) {
    if (entry.pct === 0 && entry.quantity > 0) return '<1%';
    return `${entry.pct}%`;
}

// Condition : condition dominante en tête ("99% NM"), puis une seule barre segmentée (proportions
// réelles, pas les pct arrondis, pour ne pas perdre les petites parts à l'affichage) et une légende
// compacte quantité + pourcentage. Couleurs stables : même palette/même index que la Finition juste à
// côté, cohérent avec le reste du Récap (STX_PALETTE, déjà utilisée ailleurs dans l'app - toujours pas
// de Chart.js requis pour l'utiliser, c'est un simple tableau de couleurs).
function renderRecapConditionFacet(entries) {
    if (entries.length === 0) return '<p class="recap-value-empty">Aucune donnée.</p>';

    const total = entries.reduce((sum, e) => sum + e.quantity, 0);
    const dominant = entries.reduce((max, e) => (e.quantity > max.quantity ? e : max), entries[0]);

    const segments = entries.map((e, i) => `
        <span class="recap-bar-segment" style="width:${total > 0 ? (e.quantity / total) * 100 : 0}%; background:${STX_PALETTE[i % STX_PALETTE.length]}" title="${escapeHtml(e.label)} · ${e.quantity}"></span>
    `).join('');

    const legend = entries.map((e, i) => `
        <li>
            <span><span class="recap-mini-legend-dot" style="background:${STX_PALETTE[i % STX_PALETTE.length]}"></span>${escapeHtml(e.label)}</span>
            <span class="recap-mini-legend-value">${e.quantity} · ${formatRecapPct(e)}</span>
        </li>
    `).join('');

    return `
        <div class="recap-condition-headline">
            <span class="recap-condition-headline-pct">${formatRecapPct(dominant)}</span>
            <span class="recap-condition-headline-label">${escapeHtml(dominant.label)}</span>
        </div>
        <div class="recap-bar-segmented">${segments}</div>
        <ul class="recap-mini-legend">${legend}</ul>
    `;
}

// Finition : barres horizontales classées par quantité décroissante (lecture visuelle immédiate),
// contrairement à Condition qui garde l'ordre métier de computeRecapBreakdown - re-tri fait ici, sur la
// copie retournée par le helper, pas dans computeRecapBreakdown lui-même (toujours utilisé tel quel par
// Condition). Longueur de barre relative à l'entrée la plus représentée, même principe que les barlists
// déjà en place dans Statistiques (stats-render.js: renderTypeBarlist/renderExtBarlist).
function renderRecapFinishFacet(entries) {
    if (entries.length === 0) return '<p class="recap-value-empty">Aucune donnée.</p>';

    const sorted = [...entries].sort((a, b) => b.quantity - a.quantity);
    const max = sorted[0].quantity;

    const rows = sorted.map((e, i) => `
        <div class="recap-finish-row">
            <span class="recap-finish-name">${escapeHtml(e.label)}</span>
            <div class="recap-finish-track"><div class="recap-finish-fill" style="width:${max > 0 ? (e.quantity / max) * 100 : 0}%; background:${STX_PALETTE[i % STX_PALETTE.length]}"></div></div>
            <span class="recap-finish-value">${e.quantity} · ${formatRecapPct(e)}</span>
        </div>
    `).join('');

    return `<div class="recap-finish-list">${rows}</div>`;
}

function renderRecapStateSection(cards) {
    const section = document.getElementById('recap-section-state');
    if (!section) return;

    if (cards.length === 0) {
        section.innerHTML = `
            <div class="recap-value-block">
                <h3 class="recap-value-title">État de la collection</h3>
                <p class="recap-value-empty">Aucune carte dans ce périmètre.</p>
            </div>
        `;
        return;
    }

    // Fallbacks alignés sur le reste de l'app : card.condition || 'NM' (cf stats-render.js:659),
    // card.finish || 'normal' (cf collection.js:510, dashboard.js:509, progression.js...).
    const conditionEntries = computeRecapBreakdown(cards, {
        getKey: card => card.condition || 'NM',
        order: RECAP_CONDITION_ORDER,
        getLabel: key => key
    });
    const finishEntries = computeRecapBreakdown(cards, {
        getKey: card => card.finish || 'normal',
        order: RECAP_FINISH_ORDER,
        getLabel: key => RECAP_FINISH_LABELS[key] || key
    });

    section.innerHTML = `
        <div class="recap-value-block">
            <h3 class="recap-value-title">État de la collection</h3>
            <div class="recap-state-grid">
                <div class="recap-state-facet">
                    <h4 class="recap-state-facet-title">Condition</h4>
                    ${renderRecapConditionFacet(conditionEntries)}
                </div>
                <div class="recap-state-facet">
                    <h4 class="recap-state-facet-title">Finition</h4>
                    ${renderRecapFinishFacet(finishEntries)}
                </div>
            </div>
        </div>
    `;
}

// R5 - Les pièces maîtresses (Top 5 cartes les plus précieuses, valeur UNITAIRE - jamais value*quantity).
// Exclut market_value absent/<=0 : aucune convention existante ne le fait pour le record "carte la plus
// chère" (stats-render.js:345, simple sort[0] sans filtre - acceptable pour un fallback à 1 résultat qui
// affiche toujours quelque chose), mais un Top 5 "pièces maîtresses" avec des entrées à 0€ n'aurait pas
// de sens pour l'objectif de cette section - décision propre à R5, pas un alignement sur l'existant.
// Départage déterministe (market_value égale) : nom, puis tcgdex_id - jamais l'ordre d'origine du tableau.
function computeRecapTopValuableCards(cards) {
    return [...cards]
        .filter(card => Number(card.market_value || 0) > 0)
        .sort((a, b) => {
            const valueDiff = Number(b.market_value || 0) - Number(a.market_value || 0);
            if (valueDiff !== 0) return valueDiff;
            const nameDiff = (a.name || '').localeCompare(b.name || '');
            if (nameDiff !== 0) return nameDiff;
            return String(a.tcgdex_id || '').localeCompare(String(b.tcgdex_id || ''));
        })
        .slice(0, 5);
}

// Composition locale plutôt que renderGridCardHtml (card-grid-renderer.js) : analysé avant d'écrire ce
// code. Deux incompatibilités réelles, pas seulement esthétiques : (1) son price-badge affiche
// market_value*quantity ("lineTotal"), alors que R5 doit montrer la valeur UNITAIRE - les afficher
// ensemble aurait été trompeur ; (2) son overlay (nom + série + logo + badge condition + badge finish +
// icône acquisition + badge rareté) est pensé pour la densité d'une grille de 60 cartes, pas pour 5
// "pièces maîtresses" mises en avant - le reproduire ici l'aurait rendu aussi chargé qu'une mini-Galerie,
// contraire à la consigne. Transformer renderGridCardHtml en usine à options pour ce seul appelant aurait
// ajouté de la complexité générale pour un besoin local. Ce qui EST réutilisé du socle partagé : escapeHtml,
// getGridNoImageHtml (fallback image identique aux grilles), et surtout le clic -> showCardDetail(id, event)
// exactement comme collection-card - runCardDetailMorphTransition (card-grid-renderer.js) lit
// event.currentTarget.querySelector('img') en interne, donc le morph View Transition fonctionne
// automatiquement dès que la structure clic+<img> est respectée, sans aucun code de transition propre à R5.
function renderRecapTopCardItem(card, rank) {
    const qty = Number(card.quantity || 1);
    const unitValue = Number(card.market_value || 0);

    return `
        <div class="recap-top-card" data-card-id="${card.id}" onclick="showCardDetail(${card.id}, event)">
            <span class="recap-top-card-rank">#${rank}</span>
            ${qty > 1 ? `<span class="recap-top-card-qty">×${qty}</span>` : ''}
            <div class="recap-top-card-image">
                ${card.image
                    ? `<img src="${card.image}" alt="${escapeHtml(card.name)}" loading="lazy" onerror="this.outerHTML=getGridNoImageHtml()">`
                    : getGridNoImageHtml()
                }
            </div>
            <div class="recap-top-card-name">${escapeHtml(card.name)}</div>
            <div class="recap-top-card-value">${formatRecapEuro(unitValue)}</div>
        </div>
    `;
}

function renderRecapTopCardsSection(cards) {
    const section = document.getElementById('recap-section-top-cards');
    if (!section) return;

    const topCards = computeRecapTopValuableCards(cards);

    if (topCards.length === 0) {
        section.innerHTML = `
            <div class="recap-value-block">
                <h3 class="recap-value-title">Les pièces maîtresses</h3>
                <p class="recap-value-empty">Aucune carte valorisée dans ce périmètre.</p>
            </div>
        `;
        return;
    }

    section.innerHTML = `
        <div class="recap-value-block">
            <h3 class="recap-value-title">Les pièces maîtresses</h3>
            <div class="recap-top-cards-grid">
                ${topCards.map((card, i) => renderRecapTopCardItem(card, i + 1)).join('')}
            </div>
        </div>
    `;
}

// R6 - Doublons. Aucune nouvelle logique de regroupement : réutilise getDuplicateCardsWithQuantity
// (collection.js), déjà générique sur un tableau arbitraire (écrite pour le profil public/matching) et
// déjà exposée sur window - aucune modification de collection.js nécessaire pour R6. Le groupement
// (getDuplicateGroupKey, collection.js:509 : tcgdex_id+finish, ou nom+série+numéro+finish en repli)
// reste la seule source de vérité - deux finitions différentes d'une même carte restent deux groupes
// distincts par construction, pas une décision prise ici.
//
// getDuplicateCardsWithQuantity retourne duplicateQuantity = total du groupe - 1 (le "surplus", cf son
// commentaire dans collection.js : l'exemplaire principal n'est jamais compté comme doublon). R6 doit
// afficher la quantité TOTALE possédée (consigne explicite), pas le surplus : totalQuantity =
// duplicateQuantity + 1, recalculé ici plutôt que dupliquer le calcul des totaux par groupe.
// Classement : quantité totale décroissante, puis nom, puis id (représentant du groupe) - déterministe,
// jamais l'ordre de sortie d'Object.keys/reduce.
function computeRecapDuplicateGroups(cards) {
    return getDuplicateCardsWithQuantity(cards)
        .map(card => ({ ...card, totalQuantity: card.duplicateQuantity + 1 }))
        .sort((a, b) => {
            const qtyDiff = b.totalQuantity - a.totalQuantity;
            if (qtyDiff !== 0) return qtyDiff;
            const nameDiff = (a.name || '').localeCompare(b.name || '');
            if (nameDiff !== 0) return nameDiff;
            return (a.id || 0) - (b.id || 0);
        });
}

// La "carte représentative" d'un groupe (première rencontrée par getDuplicateCardsWithQuantity) reste
// une vraie ligne Collection avec un id réel : cliquer ouvre donc sans ambiguïté sa fiche détail, même
// mécanique clic -> showCardDetail(id, event) que R5 (morph View Transition inclus par construction,
// aucun code de transition propre à R6). Série toujours affichée (aide à distinguer un même nom entre
// deux sets), finish uniquement si renderFinishBadge a quelque chose à en dire (masqué pour 'normal',
// cf utils.js:376 - pas de logique de libellé finish dupliquée ici).
function renderRecapDuplicateItem(group) {
    return `
        <div class="recap-dup-item" data-card-id="${group.id}" onclick="showCardDetail(${group.id}, event)">
            <div class="recap-dup-thumb">
                ${group.image
                    ? `<img src="${group.image}" alt="${escapeHtml(group.name)}" loading="lazy" onerror="this.outerHTML=getGridNoImageHtml()">`
                    : getGridNoImageHtml()
                }
            </div>
            <div class="recap-dup-info">
                <div class="recap-dup-name">${escapeHtml(group.name)}</div>
                <div class="recap-dup-meta">${escapeHtml(group.series || '')}${renderFinishBadge(group.finish, 'recap-dup-finish', 11)}</div>
            </div>
            <div class="recap-dup-qty">×${group.totalQuantity}</div>
        </div>
    `;
}

function renderRecapDuplicatesSection(cards) {
    const section = document.getElementById('recap-section-duplicates');
    if (!section) return;

    const groups = computeRecapDuplicateGroups(cards);

    if (groups.length === 0) {
        section.innerHTML = `
            <div class="recap-value-block">
                <h3 class="recap-value-title">Doublons</h3>
                <p class="recap-value-empty">Aucun doublon dans ce périmètre.</p>
            </div>
        `;
        return;
    }

    const topGroups = groups.slice(0, 5);
    const remaining = groups.length - topGroups.length;

    section.innerHTML = `
        <div class="recap-value-block">
            <h3 class="recap-value-title">Doublons</h3>
            <div class="recap-dup-list">
                ${topGroups.map(renderRecapDuplicateItem).join('')}
            </div>
            ${remaining > 0 ? `<p class="recap-value-sub">+ ${remaining} autre${remaining > 1 ? 's' : ''} groupe${remaining > 1 ? 's' : ''}</p>` : ''}
        </div>
    `;
}

// Point d'entrée appelé par renderFilteredCollection (collection.js) à chaque changement de mode/filtre
// tant qu'on est en vue Récap.
function renderCollectionRecap(cards) {
    renderRecapValueSection(cards);
    renderRecapStateSection(cards);
    renderRecapTopCardsSection(cards);
    renderRecapDuplicatesSection(cards);
}

window.renderCollectionRecap = renderCollectionRecap;
