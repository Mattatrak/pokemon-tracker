// Tri/filtre/rendu de l'onglet "Ma Collection" - Pokémon Tracker
// Dépend de: allCollectionCards/changeQuantity/deleteCard (tracker.js), sortRaritiesByTier/getRarityIconHtml/
// renderFinishBadge/buildRarityFilterRowHtml (utils.js), showCardDetail/closeCardDetail/getCollectionUploadPlaceholder (card-detail.js),
// renderGridCardHtml (card-grid-renderer.js), resetBinderPage/renderBinderView/setupBinderLifecycle/
// teardownBinderLifecycle (binder-view.js)
// Etat possédé : sortColumn, sortDirection, collectionFilters, collectionViewMode

// window.x plutôt que let (ticket V2 Vite, type="module") : sortColumn/sortDirection sont lus/écrits
// depuis tracker.js aussi.
window.sortColumn = 'value';
window.sortDirection = 'desc';

// Source de vérité unique pour tous les filtres Collection (refonte filtres, cf. audit du 2026-08-11).
// Seul point d'écriture manuel : le picker "+ Ajouter un filtre" (applyCollectionFilter/removeCollectionFilter
// ci-dessous) et filterCollectionByIllustrator() depuis la fiche détail. L'ancien panneau permanent de
// <select>/boutons a été retiré (Ticket 4) : plus aucun contrôle DOM à resynchroniser. rarity reste un
// Set (multi-valeur, group keys inchangées, cf. getRarityGroupKey) : OR entre raretés sélectionnées, AND
// avec les autres catégories. getFilteredSortedCollection() ne lit jamais le DOM des filtres directement
// (seule la recherche texte, volontairement hors de cet objet, reste lue depuis #search-collection).
let collectionFilters = {
    series: null,
    type: null,
    condition: null,
    rarity: new Set(),
    illustrator: null,
    duplicatesOnly: false
};

// Appelé uniquement depuis la fiche détail Collection (jamais depuis le profil public tiers, hors
// scope de ce ticket) : ferme la fiche, applique le filtre, et s'assure d'être sur #/collection (la
// fiche peut être ouverte depuis Dashboard/Progression/Stats, cf. showCardDetail() appelants). Alimente
// directement collectionFilters.illustrator : plus d'état séparé, comportement utilisateur inchangé.
function filterCollectionByIllustrator(illustrator) {
    const trimmed = (illustrator || '').trim();
    if (!trimmed) return;

    closeCardDetail();
    collectionFilters.illustrator = trimmed;
    filterAndDisplayReorder();
    navigateToTab('tab-collection');
}

// Libellés humains pour l'état (le Set/select stocke NM/LP/MP/HP) : même mapping que celui déjà utilisé
// en dur dans modules/card-detail.js et modules/public-profile.js pour la fiche détail (clés différentes
// — majuscules ici, car collectionFilters.condition reprend la valeur brute des <option> du select —
// donc pas une fonction partagée à extraire pour ce ticket, juste le même petit mapping local).
const COLLECTION_CONDITION_LABELS = { NM: 'Neuf', LP: 'Très bon', MP: 'Bon', HP: 'Mauvais état' };

// Retrouve un libellé de rareté lisible pour une group key technique (ex: "illustration-rare.png"),
// en cherchant la première carte de la collection dont la rareté brute mappe sur cette clé. Réutilise
// getRarityGroupKey (modules/utils.js) déjà utilisé partout ailleurs pour ce regroupement — pas de
// nouvelle table de mapping, juste un lookup sur allCollectionCards (déjà chargé).
function getRarityLabelForGroupKey(groupKey) {
    const card = allCollectionCards.find(c => getRarityGroupKey(c.rarity) === groupKey);
    if (card) return card.rarity;

    // Fallback défensif : après pruneStaleCollectionFilters() une group key orpheline ne devrait plus
    // apparaître, mais si elle survient quand même, ne jamais afficher un nom de fichier technique
    // (les group keys issues de RARITY_ICON_MAP, ex: "illustration-rare.png", contiennent toujours un
    // point — celles du repli normalizeForMatch, elles, n'en contiennent jamais et restent lisibles).
    return groupKey.includes('.') ? 'Rareté' : groupKey;
}

// Ordre d'affichage stable des chips de filtres actifs (Ticket 2 refonte filtres) : Série > Type > État >
// Rareté(s), triées par palier via RARITY_ORDER (modules/utils.js) pour rester groupées et cohérentes
// entre elles > Illustrateur > Doublons. Construit uniquement depuis collectionFilters (jamais le DOM),
// consommé par updateCollectionSummary() pour le rendu et par removeCollectionFilter() implicitement
// (les clés utilisées ici sont les mêmes que celles attendues par removeCollectionFilter).
function getActiveCollectionFilterChips() {
    const chips = [];

    if (collectionFilters.series) {
        chips.push({ key: 'series', label: `Série : ${collectionFilters.series}` });
    }
    if (collectionFilters.type) {
        chips.push({ key: 'type', label: `Type : ${collectionFilters.type}` });
    }
    if (collectionFilters.condition) {
        const label = COLLECTION_CONDITION_LABELS[collectionFilters.condition] || collectionFilters.condition;
        chips.push({ key: 'condition', label: `État : ${label}` });
    }
    if (collectionFilters.rarity.size > 0) {
        const sortedGroupKeys = [...collectionFilters.rarity].sort((a, b) => {
            const rankA = RARITY_ORDER.indexOf(a);
            const rankB = RARITY_ORDER.indexOf(b);
            return (rankA === -1 ? 999 : rankA) - (rankB === -1 ? 999 : rankB);
        });
        sortedGroupKeys.forEach(groupKey => {
            chips.push({ key: 'rarity', value: groupKey, label: `Rareté : ${getRarityLabelForGroupKey(groupKey)}` });
        });
    }
    if (collectionFilters.illustrator) {
        chips.push({ key: 'illustrator', label: `Illustrateur : ${collectionFilters.illustrator}` });
    }
    if (collectionFilters.duplicatesOnly) {
        chips.push({ key: 'duplicatesOnly', label: 'Doublons' });
    }

    return chips;
}

// Rendu HTML pur des chips actifs (aucune lecture/écriture DOM ici) : une boucle sur getActiveCollectionFilterChips()
// plutôt qu'un bloc par filtre. Chaque × appelle removeCollectionFilter(key, value) — value uniquement
// nécessaire pour 'rarity' (multi-valeur), undefined pour les autres (ignoré par removeCollectionFilter).
function renderCollectionFilterChips() {
    return getActiveCollectionFilterChips().map(chip => `
        <span class="collection-filter-chip">
            ${escapeHtml(chip.label)}
            <button type="button" class="collection-filter-chip-remove" onclick="removeCollectionFilter('${chip.key}'${chip.value ? `, '${chip.value.replace(/'/g, "\\'")}'` : ''})" aria-label="Retirer ce filtre">×</button>
        </span>
    `).join('');
}

// Vide UNIQUEMENT le filtre ciblé dans collectionFilters puis relance le flow de rendu standard. Depuis
// le Ticket 4 (retrait de l'ancien panneau permanent), plus aucun contrôle à resynchroniser : le picker
// "+ Ajouter un filtre" (ci-dessous) reconstruit ses options depuis allCollectionCards à chaque ouverture.
function removeCollectionFilter(key, value) {
    switch (key) {
        case 'series':
            collectionFilters.series = null;
            break;
        case 'type':
            collectionFilters.type = null;
            break;
        case 'condition':
            collectionFilters.condition = null;
            break;
        case 'rarity':
            collectionFilters.rarity.delete(value);
            break;
        case 'illustrator':
            collectionFilters.illustrator = null;
            break;
        case 'duplicatesOnly':
            collectionFilters.duplicatesOnly = false;
            break;
        default:
            return;
    }
    filterAndDisplayReorder();
}

// ===== "AJOUTER UN FILTRE" — POPOVER 2 ETAPES (Ticket 3, seul moyen manuel d'ajouter un filtre depuis
// le Ticket 4 — l'ancien panneau permanent a été retiré). N'écrit jamais directement dans collectionFilters
// sans passer par applyCollectionFilter() ; construit toujours ses options depuis allCollectionCards.
let collectionFilterPickerStep = 'type'; // 'type' | 'value'
let collectionFilterPickerActiveKey = null;
let collectionFilterPickerSearchTerm = '';

// Liste déclarative des filtres proposables à l'étape 1 : pas un moteur générique (pas d'opérateurs, pas
// de comparaisons), juste les 6 filtres métier existants avec de quoi piloter l'étape 1 (label, mono/multi/
// booléen). Ordre = ordre d'affichage à l'étape 1 (repris de l'ordre des chips, Ticket 2).
const COLLECTION_FILTER_TYPES = [
    { key: 'series', label: 'Série' },
    { key: 'type', label: 'Type' },
    { key: 'condition', label: 'État' },
    { key: 'rarity', label: 'Rareté', multi: true },
    { key: 'illustrator', label: 'Illustrateur' },
    { key: 'duplicatesOnly', label: 'Doublons', boolean: true }
];

const COLLECTION_FILTER_PICKER_SEARCH_THRESHOLD = 10;

// Valeurs proposables à l'étape 2, dérivées uniquement de allCollectionCards (jamais de requête
// supplémentaire, jamais des <select> de l'ancien panneau). Pour 'rarity', renvoie des paires
// [groupKey, libellé] (même regroupement que buildRarityFilterRowHtml/getRarityGroupKey, réutilisés tels
// quels) ; pour les autres, un tableau de chaînes déjà triées.
function getCollectionFilterPickerOptions(filterKey) {
    if (filterKey === 'series') {
        return [...new Set(allCollectionCards.map(c => c.series).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
    }
    if (filterKey === 'type') {
        return [...new Set(allCollectionCards.map(c => c.type).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
    }
    if (filterKey === 'condition') {
        return ['NM', 'LP', 'MP', 'HP'].filter(code => allCollectionCards.some(c => c.condition === code));
    }
    if (filterKey === 'illustrator') {
        // Dédup case-insensitive en conservant le libellé original (première casse rencontrée) — même
        // règle de matching que collectionFilters.illustrator (trim + case-insensitive, cf. Ticket 1).
        const seen = new Map();
        allCollectionCards.forEach(c => {
            const raw = (c.illustrator || '').trim();
            if (!raw) return;
            const dedupKey = raw.toLowerCase();
            if (!seen.has(dedupKey)) seen.set(dedupKey, raw);
        });
        return [...seen.values()].sort((a, b) => a.localeCompare(b, 'fr'));
    }
    if (filterKey === 'rarity') {
        const rarities = sortRaritiesByTier([...new Set(allCollectionCards.map(c => c.rarity).filter(Boolean))]);
        const groups = new Map();
        rarities.forEach(r => {
            const key = getRarityGroupKey(r);
            if (!groups.has(key)) groups.set(key, r);
        });
        return [...groups.entries()];
    }
    return [];
}

// Un type de filtre est proposable à l'étape 1 si : booléen pas encore actif, multi (rareté) avec au
// moins une valeur restante non sélectionnée, ou mono pas encore actif ET avec au moins une valeur
// disponible dans la collection (ex: aucun illustrateur renseigné -> pas de ligne "Illustrateur").
function isCollectionFilterTypeAvailable(def) {
    if (def.boolean) {
        return !collectionFilters[def.key];
    }
    if (def.multi) {
        const groupKeys = getCollectionFilterPickerOptions(def.key).map(([groupKey]) => groupKey);
        return groupKeys.some(k => !collectionFilters.rarity.has(k));
    }
    if (collectionFilters[def.key]) return false;
    return getCollectionFilterPickerOptions(def.key).length > 0;
}

function hasAvailableCollectionFilterTypes() {
    return COLLECTION_FILTER_TYPES.some(isCollectionFilterTypeAvailable);
}

// Active/désactive le bouton "+ Ajouter un filtre" selon qu'il reste au moins un filtre proposable.
// Appelée depuis renderFilteredCollection() (donc à chaque filterAndDisplay, y compris reset/chip retiré).
function updateCollectionAddFilterButtonState() {
    const btn = document.getElementById('collection-add-filter-btn');
    if (!btn) return;
    btn.disabled = !hasAvailableCollectionFilterTypes();
}

function openCollectionFilterPicker() {
    const btn = document.getElementById('collection-add-filter-btn');
    if (btn && btn.disabled) return;

    collectionFilterPickerSearchTerm = '';
    showCollectionFilterTypeOptions();
    document.getElementById('collection-filter-picker')?.classList.add('active');
    btn?.setAttribute('aria-expanded', 'true');
    positionCollectionFilterPicker();
}

// Ferme le picker sans jamais toucher collectionFilters — aucune fermeture (clic extérieur, Escape, ×,
// sélection déjà appliquée avant l'appel) ne doit modifier un filtre au moment de fermer.
function closeCollectionFilterPicker() {
    const picker = document.getElementById('collection-filter-picker');
    if (!picker) return;
    picker.classList.remove('active', 'align-right');
    document.getElementById('collection-add-filter-btn')?.setAttribute('aria-expanded', 'false');
    collectionFilterPickerStep = 'type';
    collectionFilterPickerActiveKey = null;
    collectionFilterPickerSearchTerm = '';
}

// Repositionnement simple (pas de moteur de collision) : ancré à gauche du bouton par défaut, bascule à
// droite uniquement si ça déborde la fenêtre. Uniquement pertinent en desktop (position:absolute) ;
// en mobile le popover passe en panneau fixe plein-largeur (cf. styles.css), cette fonction est un no-op
// visuel dans ce cas (la classe est ajoutée mais sans effet, le CSS mobile l'ignore).
function positionCollectionFilterPicker() {
    const picker = document.getElementById('collection-filter-picker');
    if (!picker) return;
    picker.classList.remove('align-right');
    const rect = picker.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8) {
        picker.classList.add('align-right');
    }
}

// Etape 1 : liste des types de filtre encore proposables. Chaque ligne est un vrai <button> (a11y).
function showCollectionFilterTypeOptions() {
    collectionFilterPickerStep = 'type';
    collectionFilterPickerActiveKey = null;

    const availableTypes = COLLECTION_FILTER_TYPES.filter(isCollectionFilterTypeAvailable);

    const picker = document.getElementById('collection-filter-picker');
    if (!picker) return;

    picker.innerHTML = `
        <div class="cf-picker-header"><span>Ajouter un filtre</span></div>
        <div class="cf-picker-body">
            ${availableTypes.length > 0 ? availableTypes.map(def => `
                <button type="button" class="cf-picker-row" onclick="${def.boolean ? `applyCollectionFilter('${def.key}', true)` : `showCollectionFilterValueOptions('${def.key}')`}">
                    <span>${escapeHtml(def.label)}</span>
                    ${def.boolean ? '' : '<i class="ti ti-chevron-right" aria-hidden="true"></i>'}
                </button>
            `).join('') : '<p class="cf-picker-empty">Tous les filtres disponibles sont déjà actifs</p>'}
        </div>
    `;
    positionCollectionFilterPicker();
}

// Etape 2 : valeurs disponibles pour filterKey. Champ de recherche local seulement si la liste dépasse
// COLLECTION_FILTER_PICKER_SEARCH_THRESHOLD (pas de recherche systématique pour État/Rareté, courtes par
// nature). Rareté exclut les group keys déjà actives (cf. isCollectionFilterTypeAvailable côté étape 1).
function showCollectionFilterValueOptions(filterKey) {
    const def = COLLECTION_FILTER_TYPES.find(d => d.key === filterKey);
    if (!def) return;

    collectionFilterPickerStep = 'value';
    collectionFilterPickerActiveKey = filterKey;
    collectionFilterPickerSearchTerm = '';

    const picker = document.getElementById('collection-filter-picker');
    if (!picker) return;

    const rawOptionCount = getCollectionFilterPickerOptions(filterKey).length;

    picker.innerHTML = `
        <div class="cf-picker-header cf-picker-header-nav">
            <button type="button" class="cf-picker-back" onclick="showCollectionFilterTypeOptions()" aria-label="Retour"><i class="ti ti-chevron-left" aria-hidden="true"></i></button>
            <span>${escapeHtml(def.label)}</span>
        </div>
        ${rawOptionCount > COLLECTION_FILTER_PICKER_SEARCH_THRESHOLD ? `
            <div class="cf-picker-search">
                <input type="text" placeholder="Rechercher..." oninput="setCollectionFilterPickerSearch(this.value)">
            </div>
        ` : ''}
        <div class="cf-picker-body cf-picker-scroll" id="cf-picker-value-list">${renderCollectionFilterPickerValueRows()}</div>
    `;
    positionCollectionFilterPicker();
}

// Rend uniquement les lignes de valeurs (pas tout le popover) : appelé au premier affichage de l'étape 2
// et à chaque frappe dans la recherche locale, pour ne pas perdre le focus du champ de recherche.
function renderCollectionFilterPickerValueRows() {
    const filterKey = collectionFilterPickerActiveKey;
    if (!filterKey) return '';

    const term = collectionFilterPickerSearchTerm.trim().toLowerCase();
    let options = getCollectionFilterPickerOptions(filterKey);

    if (filterKey === 'rarity') {
        options = options.filter(([groupKey]) => !collectionFilters.rarity.has(groupKey));
        if (term) options = options.filter(([, label]) => label.toLowerCase().includes(term));
        if (options.length === 0) return '<p class="cf-picker-empty">Aucune rareté restante</p>';
        return options.map(([groupKey, label]) => `
            <button type="button" class="cf-picker-row" onclick="applyCollectionFilter('rarity', '${groupKey.replace(/'/g, "\\'")}')">
                <span>${escapeHtml(label)}</span>
            </button>
        `).join('');
    }

    if (filterKey === 'condition') {
        if (term) options = options.filter(code => (COLLECTION_CONDITION_LABELS[code] || code).toLowerCase().includes(term));
        if (options.length === 0) return '<p class="cf-picker-empty">Aucun résultat</p>';
        return options.map(code => `
            <button type="button" class="cf-picker-row" onclick="applyCollectionFilter('condition', '${code}')">
                <span>${escapeHtml(COLLECTION_CONDITION_LABELS[code] || code)}</span>
            </button>
        `).join('');
    }

    // series / type / illustrator : options = tableau de chaînes
    if (term) options = options.filter(v => v.toLowerCase().includes(term));
    if (options.length === 0) return '<p class="cf-picker-empty">Aucun résultat</p>';
    return options.map(value => `
        <button type="button" class="cf-picker-row" onclick="applyCollectionFilter('${filterKey}', '${value.replace(/'/g, "\\'")}')">
            <span>${escapeHtml(value)}</span>
        </button>
    `).join('');
}

function setCollectionFilterPickerSearch(value) {
    collectionFilterPickerSearchTerm = value;
    const list = document.getElementById('cf-picker-value-list');
    if (list) list.innerHTML = renderCollectionFilterPickerValueRows();
}

// Contrepartie générique de removeCollectionFilter() : écrit UNIQUEMENT dans collectionFilters, ferme le
// popover et relance le flow de rendu standard.
function applyCollectionFilter(filterKey, value) {
    switch (filterKey) {
        case 'series':
            collectionFilters.series = value;
            break;
        case 'type':
            collectionFilters.type = value;
            break;
        case 'condition':
            collectionFilters.condition = value;
            break;
        case 'rarity':
            collectionFilters.rarity.add(value);
            break;
        case 'illustrator':
            collectionFilters.illustrator = value;
            break;
        case 'duplicatesOnly':
            collectionFilters.duplicatesOnly = true;
            break;
        default:
            return;
    }
    closeCollectionFilterPicker();
    filterAndDisplayReorder();
}

// Clic extérieur = fermeture propre, jamais de modification de collectionFilters (cf. closeCollectionFilterPicker).
// IMPORTANT : on utilise e.composedPath() et non wrap.contains(e.target). Un clic sur une ligne du picker
// (ex: "Série") déclenche d'abord son onclick (showCollectionFilterValueOptions), qui réécrit
// picker.innerHTML AVANT que cet événement ne finisse de remonter jusqu'à document — la ligne cliquée est
// donc déjà détachée du DOM au moment où ce listener s'exécute. wrap.contains(e.target) sur un nœud détaché
// renvoie toujours false, ce qui faisait fermer le picker instantanément à chaque clic sur une ligne (bug :
// "il ne se passe rien"). composedPath() capture le chemin de propagation d'origine au moment du dispatch,
// donc reste correct même si les nœuds ont été retirés du DOM entre-temps.
document.addEventListener('click', (e) => {
    const wrap = document.getElementById('collection-add-filter-wrap');
    const picker = document.getElementById('collection-filter-picker');
    if (wrap && picker && picker.classList.contains('active') && !e.composedPath().includes(wrap)) {
        closeCollectionFilterPicker();
    }
});

function sortCollection(column) {
    if (sortColumn === column) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        sortColumn = column;
        sortDirection = 'asc';
    }
    updateSortArrows();
    filterAndDisplayReorder();
}

function updateSortArrows() {
    document.querySelectorAll('.sort-arrow').forEach(el => el.textContent = '');
    if (sortColumn) {
        const el = document.getElementById(`sort-arrow-${sortColumn}`);
        if (el) el.textContent = sortDirection === 'asc' ? '▲' : '▼';
    }
}

function applySorting(list) {
    if (!sortColumn) return list;

    const sorted = [...list].sort((a, b) => {
        let valA, valB;
        switch (sortColumn) {
            case 'name':
                valA = a.name || '';
                valB = b.name || '';
                return sortDirection === 'asc'
                    ? valA.localeCompare(valB, 'fr', { numeric: true })
                    : valB.localeCompare(valA, 'fr', { numeric: true });
            case 'series':
                valA = a.series || '';
                valB = b.series || '';
                return sortDirection === 'asc'
                    ? valA.localeCompare(valB, 'fr', { numeric: true })
                    : valB.localeCompare(valA, 'fr', { numeric: true });
            case 'number':
                valA = a.number || '';
                valB = b.number || '';
                return sortDirection === 'asc'
                    ? valA.localeCompare(valB, 'fr', { numeric: true })
                    : valB.localeCompare(valA, 'fr', { numeric: true });
            case 'condition':
                valA = a.condition || '';
                valB = b.condition || '';
                return sortDirection === 'asc'
                    ? valA.localeCompare(valB, 'fr', { numeric: true })
                    : valB.localeCompare(valA, 'fr', { numeric: true });
            case 'rarity':
                valA = a.rarity || '';
                valB = b.rarity || '';
                return sortDirection === 'asc'
                    ? valA.localeCompare(valB, 'fr', { numeric: true })
                    : valB.localeCompare(valA, 'fr', { numeric: true });
            case 'quantity':
                valA = Number(a.quantity || 1);
                valB = Number(b.quantity || 1);
                return sortDirection === 'asc' ? valA - valB : valB - valA;
            case 'value':
                valA = Number(a.market_value || 0) * Number(a.quantity || 1);
                valB = Number(b.market_value || 0) * Number(b.quantity || 1);
                return sortDirection === 'asc' ? valA - valB : valB - valA;
            default:
                return 0;
        }
    });

    return sorted;
}

// Purge collectionFilters.series/.type si leur valeur n'existe plus dans la collection (ex: suppression
// de la dernière carte de cette série) : un filtre sur une valeur disparue retombe silencieusement à
// "aucun filtre" plutôt que de filtrer indéfiniment sur une valeur fantôme. Anciennement fait en resynchronisant
// les <select> Série/Type reconstruits à chaque refreshCollection (cf. populateCollectionFilters avant
// Ticket 4) ; ces <select> ont été retirés (l'ancien panneau permanent n'existe plus, seul le picker
// "+ Ajouter un filtre" lit désormais allCollectionCards), donc plus de DOM à reconstruire ici — seule la
// purge d'état reste nécessaire. condition (liste fixe NM/LP/MP/HP) n'a jamais eu besoin de cette purge.
function pruneStaleCollectionFilters() {
    if (collectionFilters.series && !allCollectionCards.some(c => c.series === collectionFilters.series)) {
        collectionFilters.series = null;
    }
    if (collectionFilters.type && !allCollectionCards.some(c => c.type === collectionFilters.type)) {
        collectionFilters.type = null;
    }
    if (collectionFilters.illustrator) {
        const target = collectionFilters.illustrator.trim().toLowerCase();
        const stillExists = allCollectionCards.some(c => (c.illustrator || '').trim().toLowerCase() === target);
        if (!stillExists) collectionFilters.illustrator = null;
    }
    collectionFilters.rarity.forEach(groupKey => {
        const stillExists = allCollectionCards.some(c => getRarityGroupKey(c.rarity) === groupKey);
        if (!stillExists) collectionFilters.rarity.delete(groupKey);
    });
}

// Identifiant de regroupement d'une carte (même carte, peu importe l'état) pour détecter les doublons
function getDuplicateGroupKey(card) {
    const finishKey = card.finish || 'normal';
    return card.tcgdex_id ? `id:${card.tcgdex_id}:${finishKey}` : `nsn:${card.name}|${card.series}|${card.number}|${finishKey}`;
}

function computeDuplicateGroupTotals() {
    const totals = {};
    allCollectionCards.forEach(card => {
        const key = getDuplicateGroupKey(card);
        totals[key] = (totals[key] || 0) + Number(card.quantity || 1);
    });
    return totals;
}

// Version générique de la logique doublon ci-dessus (même regroupement via getDuplicateGroupKey, même
// seuil total > 1), mais paramétrée sur un tableau de cartes arbitraire au lieu du global
// allCollectionCards — réutilisable pour une collection publique tierce (profil public, matching).
// Ne modifie ni ne duplique la définition métier existante, se contente de l'appliquer ailleurs.
// Retourne une carte représentative par groupe (la première rencontrée) enrichie d'un champ
// duplicateQuantity = total du groupe - 1 : le total inclut l'exemplaire "principal" qu'on ne
// considère jamais comme échangeable, seul le surplus l'est (cf audit demandé : quantity=4 -> 3
// doublons potentiels, pas 4).
function getDuplicateCardsWithQuantity(cards) {
    const totals = {};
    const representative = {};

    (cards || []).forEach(card => {
        const key = getDuplicateGroupKey(card);
        totals[key] = (totals[key] || 0) + Number(card.quantity || 1);
        if (!representative[key]) representative[key] = card;
    });

    return Object.keys(totals)
        .filter(key => totals[key] > 1)
        .map(key => ({ ...representative[key], duplicateQuantity: totals[key] - 1 }));
}

// Un filtre actif (hors recherche, hors tri) : condition/série/type/rareté/doublons/illustrateur
function hasActiveCollectionFilters() {
    return !!collectionFilters.condition ||
        !!collectionFilters.series ||
        !!collectionFilters.type ||
        collectionFilters.rarity.size > 0 ||
        collectionFilters.duplicatesOnly ||
        !!collectionFilters.illustrator;
}

function updateResetFiltersButtonVisibility() {
    const btn = document.getElementById('collection-reset-filters-btn');
    if (!btn) return;
    btn.style.display = hasActiveCollectionFilters() ? 'inline-flex' : 'none';
}

function resetCollectionFilters() {
    collectionFilters.condition = null;
    collectionFilters.series = null;
    collectionFilters.type = null;
    collectionFilters.rarity.clear();
    collectionFilters.duplicatesOnly = false;
    collectionFilters.illustrator = null;

    filterAndDisplayReorder();
}

function getFilteredSortedCollection() {
    const searchTerm = document.getElementById('search-collection').value.toLowerCase();

    let filtered = allCollectionCards;
    if (searchTerm) {
        filtered = filtered.filter(c =>
            (c.name || '').toLowerCase().includes(searchTerm) ||
            (c.series || '').toLowerCase().includes(searchTerm)
        );
    }
    if (collectionFilters.condition) {
        filtered = filtered.filter(c => c.condition === collectionFilters.condition);
    }
    if (collectionFilters.series) {
        filtered = filtered.filter(c => c.series === collectionFilters.series);
    }
    if (collectionFilters.rarity.size > 0) {
        filtered = filtered.filter(c => collectionFilters.rarity.has(getRarityGroupKey(c.rarity)));
    }
    if (collectionFilters.type) {
        filtered = filtered.filter(c => c.type === collectionFilters.type);
    }
    if (collectionFilters.duplicatesOnly) {
        const totals = computeDuplicateGroupTotals();
        filtered = filtered.filter(c => (totals[getDuplicateGroupKey(c)] || 0) > 1);
    }
    if (collectionFilters.illustrator) {
        const target = collectionFilters.illustrator.toLowerCase();
        filtered = filtered.filter(c => (c.illustrator || '').trim().toLowerCase() === target);
    }

    return applySorting(filtered);
}

const COLLECTION_PAGE_SIZE = 60;
let collectionDisplayLimit = COLLECTION_PAGE_SIZE;
// "Charger plus" ne doit ajouter que les nouvelles cartes, jamais rejouer l'entrée sur les cartes déjà
// affichées (cf replayEntrance) : ça faisait clignoter toute la grille/le tableau en noir à chaque clic
// (le conteneur entier repassait par opacity:0 avant de refondre). Positionné juste avant l'appel à
// renderFilteredCollection() puis consommé et remis à false dans la même passe synchrone.
let isLoadMoreRender = false;

// Sélection multiple (édition en masse, vue Tableau)
let selectedCardIds = new Set();

function clearSelection() {
    selectedCardIds.clear();
    updateBulkActionsBar();
    updateSelectAllCheckboxState();
}

function toggleCardSelection(id) {
    if (selectedCardIds.has(id)) {
        selectedCardIds.delete(id);
    } else {
        selectedCardIds.add(id);
    }
    updateSelectAllCheckboxState();
    updateBulkActionsBar();
}

function toggleSelectAllVisible() {
    const selectAllCb = document.getElementById('select-all-checkbox');
    const checkboxes = document.querySelectorAll('#cards-list .row-select-checkbox');
    checkboxes.forEach(cb => {
        const id = Number(cb.dataset.id);
        cb.checked = selectAllCb.checked;
        if (selectAllCb.checked) selectedCardIds.add(id);
        else selectedCardIds.delete(id);
    });
    updateBulkActionsBar();
}

function updateSelectAllCheckboxState() {
    const selectAllCb = document.getElementById('select-all-checkbox');
    if (!selectAllCb) return;
    const checkboxes = [...document.querySelectorAll('#cards-list .row-select-checkbox')];
    const checkedCount = checkboxes.filter(cb => cb.checked).length;
    selectAllCb.checked = checkboxes.length > 0 && checkedCount === checkboxes.length;
    selectAllCb.indeterminate = checkedCount > 0 && checkedCount < checkboxes.length;
}

function updateBulkActionsBar() {
    const bar = document.getElementById('bulk-actions-bar');
    if (!bar) return;
    const count = selectedCardIds.size;
    bar.style.display = count > 0 ? 'flex' : 'none';
    document.getElementById('bulk-selection-count').textContent =
        `${count} carte${count > 1 ? 's' : ''} sélectionnée${count > 1 ? 's' : ''}`;
}

async function bulkUpdateCondition(newCondition) {
    if (!newCondition || selectedCardIds.size === 0) return;
    const ids = [...selectedCardIds];

    const { error } = await supabaseClient.from('cards').update({ condition: newCondition }).in('id', ids);
    if (error) {
        showMessage('Erreur lors de la mise à jour groupée', 'error');
        console.error(error);
        return;
    }

    showMessage(`État mis à jour pour ${ids.length} carte${ids.length > 1 ? 's' : ''}`, 'success');
    clearSelection();
    await refreshCollection();
}

async function bulkDeleteSelected() {
    const ids = [...selectedCardIds];
    if (ids.length === 0) return;
    if (!await showConfirmModal(`Supprimer ${ids.length} carte${ids.length > 1 ? 's' : ''} de la collection ?`, 'Supprimer')) return;

    const cardsToDelete = allCollectionCards.filter(c => ids.includes(c.id));

    const { error } = await supabaseClient.from('cards').delete().in('id', ids);
    if (error) {
        showMessage('Erreur lors de la suppression groupée', 'error');
        console.error(error);
        return;
    }

    // La suppression elle-même a réussi (ci-dessus) : cf deleteCard (tracker.js) pour la même
    // protection - sans elle, un échec ici laissait la grille locale périmée sans avertissement.
    try {
        // Réconcilier l'historique mensuel pour chaque carte supprimée (même logique que deleteCard)
        for (const card of cardsToDelete) {
            if (!card.created_at) continue;
            const addedDate = new Date(card.created_at);
            const monthKey = `${addedDate.getFullYear()}-${String(addedDate.getMonth() + 1).padStart(2, '0')}`;
            const qty = Number(card.quantity || 1);
            await adjustMonthlyStatsAmount(monthKey, -qty, -(Number(card.purchase_price || 0) * qty), -(Number(card.market_value || 0) * qty));
        }

        showMessage(`${ids.length} carte${ids.length > 1 ? 's' : ''} supprimée${ids.length > 1 ? 's' : ''}`, 'success');
        clearSelection();
        await refreshCollection();
        await recordValueSnapshot();
    } catch (error) {
        console.error(error);
        showMessage('Cartes supprimées, mais une erreur est survenue juste après (rafraîchissement) - recharge la page pour être sûr que tout est à jour.', 'error');
    }
}

function filterAndDisplay() {
    collectionDisplayLimit = COLLECTION_PAGE_SIZE; // toute recherche/filtre/tri repart de la première page
    resetBinderPage(); // idem pour le classeur (binder-view.js) : repart de la première double-page
    clearSelection(); // évite d'agir sur une sélection de cartes qu'on ne voit plus
    renderFilteredCollection();
}

// VT5 (cf roadmap technique animations premium) : au-delà duquel on n'anime plus la réorganisation du
// Tableau (perf + lisibilité - cf audit VT5). COLLECTION_PAGE_SIZE (60) est la page max réellement
// affichable, mais animer jusqu'à 60 lignes capturerait bien plus que ce qui est réellement visible
// sans défilement sur la plupart des écrans ; 24 reste dans la fourchette demandée (20-30), largement
// au-dessus du nombre de lignes visibles sans scroll, sans être si bas qu'un tri sur une trentaine de
// cartes filtrées perdrait tout son intérêt.
const COLLECTION_REORDER_MAX_ROWS = 24;

// VT5b (cf roadmap technique animations premium) : plafond de cartes Galerie animées simultanément -
// volontairement plus bas que COLLECTION_REORDER_MAX_ROWS (24, Tableau). La grille desktop
// (.collection-grid, minmax(190px,1fr)) tient ~5-6 colonnes sur une largeur de contenu courante ; avec
// des cartes en aspect-ratio 5/7 (~190-250px de large, donc ~270-350px de haut), une hauteur de
// viewport utile d'environ 700-800px après hero/filtres affiche grossièrement 2-3 rangées pleines,
// soit ~12-18 cartes. 16 couvre cet "écran de cartes" sans capturer toute la page.
const COLLECTION_GALLERY_REORDER_MAX_CARDS = 16;

// Carte "dans ou proche du viewport" (VT5b) : vérification ponctuelle via getBoundingClientRect() au
// moment de l'action, jamais un observer/listener persistant (cf demande explicite). Marge de 200px
// pour inclure les cartes juste sous le pli, dont le mouvement reste naturel sans qu'elles soient
// pixel-parfaitement visibles à l'instant T.
function isCollectionCardNearViewport(el, margin = 200) {
    const rect = el.getBoundingClientRect();
    return rect.bottom > -margin && rect.top < window.innerHeight + margin;
}

// VT5 (Tableau) : logique strictement inchangée depuis sa validation manuelle, simplement extraite
// pour être appelée depuis filterAndDisplayReorder() au même titre que la variante Galerie (VT5b)
// ci-dessous. Ne pas modifier seuil/noms/comportement ici.
function runCollectionTableReorder(intersection) {
    if (intersection.length < 2 || intersection.length > COLLECTION_REORDER_MAX_ROWS) {
        filterAndDisplay();
        return;
    }

    const intersectionSet = new Set(intersection);
    const tbody = document.getElementById('cards-list');

    const nameIntersectionRows = () => {
        tbody.querySelectorAll('tr[data-card-id]').forEach(tr => {
            if (intersectionSet.has(tr.dataset.cardId)) {
                tr.style.viewTransitionName = `collection-row-${tr.dataset.cardId}`;
            }
        });
    };
    const clearRowNames = () => {
        tbody.querySelectorAll('tr[data-card-id]').forEach(tr => {
            if (tr.style.viewTransitionName) tr.style.viewTransitionName = '';
        });
    };

    nameIntersectionRows();

    const transition = runViewTransition('collection-reorder', () => {
        clearRowNames();
        filterAndDisplay();
        nameIntersectionRows();
    });

    if (!transition) {
        clearRowNames();
        return;
    }

    transition.finished.finally(clearRowNames);
}

// VT5b (expérimental, cf roadmap technique animations premium) : même principe que le Tableau (VT5),
// mais restreint aux cartes qui sont À LA FOIS dans l'intersection OLD/NEW ET actuellement visibles
// (ou proches du viewport) - jamais les 60 cartes de la page. oldEls déjà en ordre DOM (haut en bas,
// gauche à droite) : filtrer puis tronquer à COLLECTION_GALLERY_REORDER_MAX_CARDS suffit à obtenir un
// sous-ensemble déterministe, pas besoin d'un tri supplémentaire.
//
// Élément animé : la racine .collection-card entière (pas seulement l'image) - c'est une boîte propre
// (aspect-ratio fixe, overflow:hidden, border-radius, un seul <img> + badges/overlay internes) dont le
// contenu est capturé comme un unique snapshot aplati ; animer seulement l'image aurait laissé les
// badges/overlay apparaître/disparaître indépendamment de l'image en mouvement, un résultat moins
// convaincant que "la carte physique se déplace".
function runCollectionGalleryReorder(intersection, oldEls) {
    const intersectionSet = new Set(intersection);
    const candidates = oldEls
        .filter(el => intersectionSet.has(el.dataset.cardId) && isCollectionCardNearViewport(el))
        .slice(0, COLLECTION_GALLERY_REORDER_MAX_CARDS)
        .map(el => el.dataset.cardId);

    if (candidates.length < 2) {
        filterAndDisplay();
        return;
    }

    const candidateSet = new Set(candidates);
    const grid = document.getElementById('collection-grid');

    const nameCandidateCards = () => {
        grid.querySelectorAll('.collection-card[data-card-id]').forEach(card => {
            if (candidateSet.has(card.dataset.cardId)) {
                card.style.viewTransitionName = `collection-gallery-card-${card.dataset.cardId}`;
            }
        });
    };
    const clearCardNames = () => {
        grid.querySelectorAll('.collection-card[data-card-id]').forEach(card => {
            if (card.style.viewTransitionName) card.style.viewTransitionName = '';
        });
    };

    nameCandidateCards(); // OLD

    const transition = runViewTransition('collection-reorder', () => {
        // Retrait avant re-render - même piège d'unicité que VT1/VT2/VT5.
        clearCardNames();
        filterAndDisplay();
        // Une candidate disparue du nouveau rendu (filtrée entre-temps, cas rare) ne matche
        // simplement aucun élément ici : pas d'erreur, juste pas de nom posé pour elle.
        nameCandidateCards(); // NEW
    });

    if (!transition) {
        clearCardNames();
        return;
    }

    transition.finished.finally(clearCardNames);
}

// VT5/VT5b (cf roadmap technique animations premium) : variante de filterAndDisplay() pour les
// actions utilisateur qui changent réellement le contenu du Tableau ou de la Galerie déjà affichés
// (filtre ajouté/retiré, tri, recherche après debounce) - jamais pour un changement de mode
// (setCollectionView), un refresh de données (refreshCollection, add/delete/édition d'une carte) ou
// le premier affichage : ces cas continuent d'appeler filterAndDisplay() directement, sans transition.
// C'est l'unique point de distinction retenu (cf audit VT5, section 4) - pas de flag global, juste
// deux points d'entrée différents vers le même rendu final.
//
// Ne réimplémente jamais getFilteredSortedCollection() : les ids OLD viennent du DOM réel de la vue
// affichée (data-card-id déjà posé sur chaque <tr>/.collection-card), les ids NEW du même appel/state
// que le rendu réel s'apprête à utiliser - jamais une resimulation séparée de la logique de filtre/tri.
//
// Galerie exclue sur mobile (VT5b, cf audit section 27) : grille à ~2 colonnes seulement en dessous de
// 768px (isCollectionMobileViewport), où une réorganisation peut déplacer une carte sur une très
// grande distance verticale (peu de colonnes = peu de voisins proches) - risque de mouvement chaotique
// plutôt que la sensation recherchée. Le Tableau, lui, n'est de toute façon jamais le mode effectif
// sous ce seuil (getEffectiveCollectionViewMode), donc rien à exclure spécifiquement pour lui.
function filterAndDisplayReorder() {
    const effectiveMode = getEffectiveCollectionViewMode();
    const isReorderableMode = effectiveMode === 'table' || (effectiveMode === 'grid' && !isCollectionMobileViewport());

    if (!isReorderableMode || !document.getElementById('tab-collection')?.classList.contains('active')) {
        filterAndDisplay();
        return;
    }

    const oldSelector = effectiveMode === 'table' ? '#cards-list tr[data-card-id]' : '#collection-grid .collection-card[data-card-id]';
    const oldEls = [...document.querySelectorAll(oldSelector)];
    const oldIds = oldEls.map(el => el.dataset.cardId);

    // Même page que celle que filterAndDisplay()/renderFilteredCollection() vont réellement afficher
    // (collectionDisplayLimit repart toujours à COLLECTION_PAGE_SIZE pour ces actions).
    const newIds = getFilteredSortedCollection().slice(0, COLLECTION_PAGE_SIZE).map(c => String(c.id));

    if (oldIds.length === 0 || oldIds.join(',') === newIds.join(',')) {
        // Vue vide avant, ou séquence strictement identique (cf section 15/16 de la demande VT5) :
        // rien à réorganiser.
        filterAndDisplay();
        return;
    }

    const newIdSet = new Set(newIds);
    const intersection = oldIds.filter(id => newIdSet.has(id));

    if (effectiveMode === 'table') {
        runCollectionTableReorder(intersection);
    } else {
        runCollectionGalleryReorder(intersection, oldEls);
    }
}

function loadMoreCollectionCards() {
    collectionDisplayLimit += COLLECTION_PAGE_SIZE;
    isLoadMoreRender = true;
    renderFilteredCollection();
}

function getSortLabel() {
    const sortLabels = {
        'name': 'Nom',
        'series': 'Série',
        'number': 'Numéro',
        'condition': 'État',
        'rarity': 'Rareté',
        'quantity': 'Quantité',
        'value': 'Valeur'
    };
    const label = sortLabels[sortColumn] || sortColumn;
    const direction = sortDirection === 'asc' ? 'croissante' : 'décroissante';
    return `${label} ${direction}`;
}

function updateCollectionSummary(filtered, page) {
    const summary = document.getElementById('collection-summary');
    if (!summary) return;

    const displayed = page.length;
    const total = allCollectionCards.length;
    const displayedValue = page.reduce((sum, card) => {
        const cardValue = Number(card.market_value || 0) * Number(card.quantity || 1);
        return sum + cardValue;
    }, 0);
    const sortLabel = getSortLabel();

    const formattedValue = new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: 'EUR',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(displayedValue);

    // summary-text-group isolé du reste : en mode Récap (cf styles.css, #tab-collection.collection-view-recap
    // .summary-text-group), seule cette partie (pagination/tri, sans sens sur des agrégats) est masquée -
    // les chips de filtres actifs restent visibles et fonctionnels (removeCollectionFilter inchangé).
    summary.innerHTML = `
        <span class="summary-text-group">
            <span class="summary-segment summary-count">
                <span class="summary-value">${displayed}</span>
                <span class="summary-label">carte${displayed > 1 ? 's' : ''} affichée${displayed > 1 ? 's' : ''}</span>
            </span>
            <span class="summary-separator">•</span>
            <span class="summary-segment">
                <span class="summary-label">sur</span>
                <span class="summary-value">${total}</span>
            </span>
            <span class="summary-separator">•</span>
            <span class="summary-segment">
                <span class="summary-label">Valeur :</span>
                <span class="summary-value">${formattedValue}</span>
            </span>
            <span class="summary-separator">•</span>
            <span class="summary-segment">
                <span class="summary-label">Tri :</span>
                <span class="summary-value">${sortLabel}</span>
            </span>
        </span>
        ${renderCollectionFilterChips()}
    `;
}

function renderCollectionHeaderKpis(filtered) {
    const totalEl = document.getElementById('collection-kpi-total');
    const valueEl = document.getElementById('collection-kpi-value');
    const spentEl = document.getElementById('collection-kpi-spent');
    if (!totalEl || !valueEl || !spentEl) return;

    const totalCards = allCollectionCards.reduce((sum, c) => sum + Number(c.quantity || 1), 0);
    const totalValue = allCollectionCards.reduce((sum, c) => sum + Number(c.market_value || 0) * Number(c.quantity || 1), 0);
    const totalSpent = allCollectionCards.reduce((sum, c) => sum + Number(c.purchase_price || 0) * Number(c.quantity || 1), 0);
    const uniqueCards = allCollectionCards.length;
    // Prix moyen calculé uniquement sur les cartes achetées (acquisition_type !== 'pack') : une
    // carte sortie d'un booster n'a pas de vrai "prix d'achat" individuel, l'inclure dilue la
    // moyenne à tort.
    const purchasedCards = allCollectionCards
        .filter(c => c.acquisition_type !== 'pack')
        .reduce((sum, c) => sum + Number(c.quantity || 1), 0);
    const avgPrice = purchasedCards > 0 ? totalSpent / purchasedCards : 0;

    totalEl.textContent = totalCards;
    valueEl.textContent = formatPrice(totalValue);
    spentEl.textContent = formatPrice(totalSpent);

    const totalSubEl = document.getElementById('collection-kpi-total-sub');
    const valueSubEl = document.getElementById('collection-kpi-value-sub');
    const spentSubEl = document.getElementById('collection-kpi-spent-sub');
    if (totalSubEl) totalSubEl.textContent = uniqueCards + ' cartes uniques';
    if (spentSubEl) spentSubEl.textContent = formatPrice(avgPrice) + ' / carte en moyenne';

    // Fluctuation du marché sur 24h (prix uniquement, cf. computeMarketFluctuation dans stats.js) —
    // remplace l'ancien "vs achat" qui ne reflétait pas un vrai mouvement de marché récent.
    if (valueSubEl) {
        valueSubEl.textContent = '...';
        computeMarketFluctuation(24 * 60 * 60 * 1000).then(fluctuation => {
            if (!fluctuation) {
                valueSubEl.textContent = 'Pas de variation sur 24h';
                valueSubEl.className = 'kpi-plaque-sub';
                return;
            }
            const sign = fluctuation.delta > 0 ? '+' : '';
            valueSubEl.textContent = `${sign}${formatPrice(fluctuation.delta)} sur 24h`;
            valueSubEl.className = 'kpi-plaque-sub ' + (fluctuation.delta > 0 ? 'positive' : fluctuation.delta < 0 ? 'negative' : '');
        });
    }
}

function renderFilteredCollection() {
    // Consommé immédiatement : ne doit s'appliquer qu'à cette passe de rendu, jamais à un appel suivant.
    const isLoadMore = isLoadMoreRender;
    isLoadMoreRender = false;

    const errorEl = document.getElementById('collection-render-error');
    if (errorEl) errorEl.style.display = 'none';

    // Contrairement au Dashboard/Statistiques (plusieurs sections independantes), la Collection rend
    // une seule vue a la fois dans des conteneurs distincts selon le mode (grille/tableau/classeur/
    // recap) : pas de conteneur unique a isoler section par section, donc un seul filet ici plutot
    // que renderSectionSafe/runSafe (utils.js). Sans ca, une exception laissait la page silencieusement
    // a moitie rendue (ex: KPIs mis a jour mais grille jamais rafraichie), sans aucun retour visuel.
    try {
        renderFilteredCollectionImpl(isLoadMore);
    } catch (error) {
        console.error('Erreur de rendu Collection:', error);
        if (errorEl) {
            errorEl.textContent = 'Affichage de la collection indisponible pour le moment.';
            errorEl.style.display = '';
        }
    }
}

function renderFilteredCollectionImpl(isLoadMore) {
    const filtered = getFilteredSortedCollection();
    const page = filtered.slice(0, collectionDisplayLimit);
    // Anticipe le "Charger plus" : précharge les images de la page suivante pendant que celle-ci
    // s'affiche, pour qu'elles soient déjà en cache navigateur au clic (Galerie/Tableau uniquement -
    // le Classeur gère sa propre pagination indépendante, cf commentaire plus bas).
    preloadImages(filtered.slice(collectionDisplayLimit, collectionDisplayLimit + COLLECTION_PAGE_SIZE).map(c => c.image));
    // On ne rend que la vue actuellement visible (gain de perf notable sur une grosse collection)
    const effectiveMode = getEffectiveCollectionViewMode();

    renderCollectionHeaderKpis(filtered);
    updateResetFiltersButtonVisibility();
    updateCollectionAddFilterButtonState();

    // Toujours mis à jour (y compris en Récap) : les chips de filtres actifs qu'il contient doivent
    // rester visibles/à jour quel que soit le mode. Seule la partie "60 cartes affichées · sur 724 ·
    // Valeur... · Tri..." (pagination/tri, sans sens pour des agrégats) est masquée en CSS pour le Récap
    // - cf #tab-collection.collection-view-recap .summary-text-group dans styles.css.
    updateCollectionSummary(filtered, page);

    if (effectiveMode === 'table') {
        renderCollectionTable(page, isLoadMore);
    } else if (effectiveMode === 'binder') {
        // Le classeur reçoit filtered en entier (pas page/collectionDisplayLimit) : sa pagination par
        // double-page (binder-view.js) est indépendante du "Charger plus" de Galerie/Tableau.
        renderBinderView(filtered);
    } else if (effectiveMode === 'recap') {
        // Récap (collection-recap.js) : agrégats calculés sur le même sous-ensemble filtré que les
        // autres vues (filtered, jamais allCollectionCards directement) - respecte série/condition/
        // finish/recherche actifs. Le tri n'a pas de sens pour des agrégats, filtered reste trié mais
        // ce n'est pas exploité ici.
        renderCollectionRecap(filtered);
    } else {
        renderCollectionGrid(page, isLoadMore);
    }

    // Le classeur gère sa propre pagination (précédent/suivant), le Récap n'affiche pas de liste de
    // cartes paginée : pas de ligne "Charger plus" dans les deux cas.
    const loadMoreRow = document.getElementById('load-more-row');
    if (effectiveMode === 'binder' || effectiveMode === 'recap') {
        loadMoreRow.style.display = 'none';
    } else {
        const remaining = filtered.length - page.length;
        if (remaining > 0) {
            loadMoreRow.style.display = 'flex';
            document.getElementById('load-more-btn').textContent = `Charger plus (${remaining} restante${remaining > 1 ? 's' : ''})`;
        } else {
            loadMoreRow.style.display = 'none';
        }
    }
}

function renderCollectionTable(filtered, isLoadMore) {
    const tbody = document.getElementById('cards-list');
    const tableWrapper = document.getElementById('collection-table-wrapper');

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="10" style="text-align: center; padding: 2rem;">
                    ${allCollectionCards.length === 0 ? getCollectionEmptyStateHtml() : `
                        <div class="empty-state">
                            <p><i class="ti ti-search-off" aria-hidden="true"></i> Aucune carte trouvée</p>
                        </div>
                    `}
                </td>
            </tr>
        `;
        updateSelectAllCheckboxState();
        replayEntrance(tableWrapper);
        return;
    }

    // "Charger plus" : les lignes déjà affichées restent en place (pas de rebuild, pas de replayEntrance
    // sur tout le tableau - même flash noir que la Galerie sinon). Seules les lignes nouvellement
    // révélées sont ajoutées.
    if (isLoadMore) {
        const alreadyRendered = tbody.children.length;
        const newCards = filtered.slice(alreadyRendered);
        tbody.insertAdjacentHTML('beforeend', newCards.map(renderCollectionTableRowHtml).join(''));
        updateSelectAllCheckboxState();
        return;
    }

    tbody.innerHTML = filtered.map(renderCollectionTableRowHtml).join('');

    updateSelectAllCheckboxState();
    replayEntrance(tableWrapper);
}

function renderCollectionTableRowHtml(card) {
        const qty = Number(card.quantity || 1);
        const lineTotal = Number(card.market_value || 0) * qty;
        const acquisitionIcon = card.acquisition_type === 'pack' ? '<i class="ti ti-gift" aria-hidden="true"></i>' : '<i class="ti ti-shopping-bag" aria-hidden="true"></i>';
        const acquisitionTitle = card.acquisition_type === 'pack' ? 'Sortie d\'un booster' : 'Achetée';
        return `
        <tr data-card-id="${card.id}">
            <td class="select-col"><input type="checkbox" class="row-select-checkbox" data-id="${card.id}" ${selectedCardIds.has(card.id) ? 'checked' : ''} onchange="toggleCardSelection(${card.id})"></td>
            <td>${card.image
                ? `<img src="${escapeHtml(card.image)}" alt="${escapeHtml(card.name)}" class="card-image-thumb" onerror="this.outerHTML=getCollectionUploadPlaceholder(${card.id})">`
                : getCollectionUploadPlaceholder(card.id)
            }</td>
            <td><strong class="row-name-link" onclick="showCardDetail(${card.id})">${escapeHtml(card.name)}</strong></td>
            <td>${card.series_logo ? `<img src="${escapeHtml(card.series_logo)}" class="series-logo-table" alt="" onerror="this.remove()">` : ''}${escapeHtml(card.series)}</td>
            <td>${escapeHtml(card.number)}</td>
            <td>
                <span class="badge ${escapeHtml((card.condition || '').toLowerCase())}">${escapeHtml(card.condition)}</span>
                ${renderFinishBadge(card.finish, 'badge finish-badge', 12)}
                <span title="${acquisitionTitle}" class="acquisition-icon">${acquisitionIcon}</span>
            </td>
            <td>${getRarityIconHtml(card.rarity)} ${card.rarity || 'N/A'}</td>
            <td style="text-align: center;">
                <div class="qty-stepper">
                    <button onclick="changeQuantity(${card.id}, -1, this)"><i class="ti ti-minus" aria-hidden="true"></i></button>
                    <span>${qty}</span>
                    <button onclick="changeQuantity(${card.id}, 1, this)"><i class="ti ti-plus" aria-hidden="true"></i></button>
                </div>
            </td>
            <td style="text-align: right;"><strong>${formatPrice(lineTotal)}</strong></td>
            <td style="text-align: center;">
                <button class="delete-btn" onclick="deleteCard(${card.id})"><i class="ti ti-trash" aria-hidden="true"></i></button>
            </td>
        </tr>
    `;
}

// État "vraiment vide" partagé Galerie/Tableau (aucune carte en collection, pas un filtre sans
// résultat) - même composant que la Wishlist/Progression (.app-empty-*, cf styles.css).
function getCollectionEmptyStateHtml() {
    return `
        <div class="app-empty-state">
            <svg class="app-empty-icon" viewBox="0 0 100 100" aria-hidden="true">
                <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" stroke-width="3"/>
                <line x1="10" y1="50" x2="90" y2="50" stroke="currentColor" stroke-width="3"/>
                <circle cx="50" cy="50" r="13" fill="none" stroke="currentColor" stroke-width="3"/>
                <circle cx="50" cy="50" r="4" fill="currentColor"/>
            </svg>
            <div class="app-empty-title">Ta collection est vide</div>
            <p class="app-empty-text">Ajoute ta première carte pour commencer à suivre ta collection.</p>
            <button class="filter-toggle-btn app-empty-cta" onclick="navigateToTab('tab-add')"><i class="ti ti-plus" aria-hidden="true"></i> Ajouter une carte</button>
        </div>
    `;
}

// Rejoue l'entrée douce du Motion System (.motion-enter) sur un conteneur dont le contenu vient
// d'être reconstruit (innerHTML) - reflow forcé pour redémarrer l'animation CSS à chaque rebuild
function replayEntrance(el) {
    if (!el) return;
    el.classList.remove('motion-enter');
    void el.offsetWidth;
    el.classList.add('motion-enter');
}

function renderCollectionGrid(filtered, isLoadMore) {
    const grid = document.getElementById('collection-grid');
    if (!grid) return;

    initHoloGridEffect(grid); // no-op si deja attache, si tactile ou si prefers-reduced-motion

    if (filtered.length === 0) {
        // Vraiment aucune carte en collection (nouvel utilisateur) -> état illustré ; un filtre/une
        // recherche qui ne remonte rien reste un texte simple, ne mérite pas la même mise en avant.
        grid.innerHTML = allCollectionCards.length === 0 ? getCollectionEmptyStateHtml() :
            '<div class="collection-grid-empty"><i class="ti ti-search-off" aria-hidden="true"></i> Aucune carte trouvée</div>';
        replayEntrance(grid);
        return;
    }

    // "Charger plus" : les cartes déjà affichées restent en place (pas de rebuild, pas de replayEntrance
    // sur tout le conteneur - ça faisait passer toute la grille par opacity:0, d'où le flash noir signalé).
    // Seules les cartes nouvellement révélées sont ajoutées, avec leur propre entrée en cascade.
    if (isLoadMore) {
        const alreadyRendered = grid.children.length;
        const newCards = filtered.slice(alreadyRendered);
        grid.insertAdjacentHTML('beforeend', newCards.map((card, i) => renderGridCardHtml(card, {
            detailFn: 'showCardDetail',
            imageFallback: 'upload',
            showAcquisitionIcon: true,
            staggerIndex: i,
            holoEffect: true
        })).join(''));
        return;
    }

    grid.innerHTML = filtered.map((card, i) => renderGridCardHtml(card, {
        detailFn: 'showCardDetail',
        imageFallback: 'upload',
        showAcquisitionIcon: true,
        staggerIndex: i,
        holoEffect: true
    })).join('');

    replayEntrance(grid);
}

// window.x plutôt que let (ticket V2 Vite, type="module") : lu depuis tracker.js aussi.
window.collectionViewMode = 'grid';

function isCollectionMobileViewport() {
    return window.matchMedia('(max-width: 768px)').matches;
}

// Distingue la préférence utilisateur (collectionViewMode, changée uniquement par un clic sur le toggle)
// du mode réellement rendu : sous 768px, le tableau (10 colonnes, non scrollable) ne doit jamais être la
// vue active (cf audit mobile) — on rend la Galerie sans jamais réécrire la préférence elle-même, pour
// qu'un retour au-dessus de 768px réapplique automatiquement le Tableau si c'était le choix de l'utilisateur.
function getEffectiveCollectionViewMode() {
    return (collectionViewMode === 'table' && isCollectionMobileViewport()) ? 'grid' : collectionViewMode;
}

function setCollectionView(mode) {
    // Lifecycle du clavier binder (B3) : attache/détache uniquement au changement effectif de mode,
    // jamais à chaque appel (ex: re-clic sur le bouton déjà actif) - setup/teardown sont de toute façon
    // idempotents côté binder-view.js, mais ce garde évite le travail inutile.
    if (mode !== collectionViewMode) {
        if (collectionViewMode === 'binder') teardownBinderLifecycle();
        if (mode === 'binder') setupBinderLifecycle();
    }

    collectionViewMode = mode;
    // Lue en CSS (styles.css, filet mobile qui force la Galerie visible quand le Tableau est
    // indisponible <768px) pour ne pas s'appliquer par-dessus le Classeur/Récap : cf commentaire sur
    // #tab-collection:not(.collection-view-binder):not(.collection-view-recap) #collection-grid-wrapper.
    document.getElementById('tab-collection')?.classList.toggle('collection-view-binder', mode === 'binder');
    document.getElementById('tab-collection')?.classList.toggle('collection-view-recap', mode === 'recap');
    document.getElementById('view-btn-grid').classList.toggle('active', mode === 'grid');
    document.getElementById('view-btn-table').classList.toggle('active', mode === 'table');
    document.getElementById('view-btn-binder').classList.toggle('active', mode === 'binder');
    document.getElementById('view-btn-recap').classList.toggle('active', mode === 'recap');
    document.getElementById('collection-grid-wrapper').style.display = mode === 'grid' ? 'block' : 'none';
    document.getElementById('collection-table-wrapper').style.display = mode === 'table' ? 'block' : 'none';
    document.getElementById('collection-binder-wrapper').style.display = mode === 'binder' ? 'block' : 'none';
    document.getElementById('collection-recap-wrapper').style.display = mode === 'recap' ? 'block' : 'none';
    // Le tri par sélecteur reste pertinent en Classeur (Tableau a ses propres en-têtes cliquables) :
    // visible pour grid ET binder, masqué pour Tableau et Récap (pas de liste de cartes à trier ici).
    document.getElementById('grid-sort').style.display = (mode !== 'table' && mode !== 'recap') ? 'inline-block' : 'none';
    filterAndDisplay();
}

// Le CSS masque déjà le tableau/le bouton Tableau et force la Galerie visible sous 768px (aucun flash
// possible, appliqué par le navigateur avant tout JS). Reste à re-peupler la bonne vue quand on franchit
// le seuil pendant que la préférence est "table" : sinon la Galerie révélée par le CSS peut rester vide
// (jamais rendue tant qu'on était en mode Tableau), ou le Tableau rester non re-peuplé au retour desktop.
// Aucun effet quand la préférence est "grid" (l'affichage effectif ne dépend alors jamais du viewport).
let collectionViewResizeTimer = null;
window.addEventListener('resize', () => {
    if (collectionViewMode !== 'table') return;
    clearTimeout(collectionViewResizeTimer);
    collectionViewResizeTimer = setTimeout(renderFilteredCollection, 150);
});

// Script de maintenance ponctuel : récupère l'illustrateur (TCGdex) pour les cartes ajoutées
// avant l'introduction du champ illustrator. A lancer une fois depuis la console (backfillIllustrators()).
async function backfillIllustrators() {
    const missing = allCollectionCards.filter(c => c.tcgdex_id && !c.illustrator);
    if (missing.length === 0) {
        showMessage('Aucune carte à mettre à jour', 'success');
        return;
    }

    showMessage(`Mise à jour de ${missing.length} carte(s)...`, 'success');
    let updated = 0;

    for (const card of missing) {
        try {
            let response = await fetch(`${API_BASE}/cards/${card.tcgdex_id}`);
            let detail = await response.json();
            if (!detail || detail.status) {
                const enResponse = await fetch(`${API_EN}/cards/${card.tcgdex_id}`);
                detail = await enResponse.json();
            }
            if (detail && !detail.status && detail.illustrator) {
                const { error } = await supabaseClient.from('cards').update({ illustrator: detail.illustrator }).eq('id', card.id);
                if (!error) updated++;
            }
        } catch (error) {
            console.error('Erreur backfill illustrateur pour carte', card.id, error);
        }
        await new Promise(r => setTimeout(r, 150));
    }

    await refreshCollection();
    showMessage(`Illustrateur ajouté sur ${updated}/${missing.length} carte(s)`, 'success');
}

// ===== Exports window (ticket V2 Vite, type="module") =====
// Les déclarations top-level d'un module ES ne s'attachent plus automatiquement à window
// (contrairement à un <script> classique) : réexport explicite pour que les autres scripts
// (chargés en modules indépendants, sans import/export entre eux, scope global inchangé)
// puissent continuer à référencer ces noms tels quels — y compris depuis des onclick="..."
// inline dans du HTML généré. Liste exhaustive des déclarations top-level de ce fichier
// (hors variables déjà passées en window.x = ... directement à leur déclaration, cf audit
// du 2026-08-14 sur l'état mutable partagé entre fichiers).
window.collectionFilters = collectionFilters;
window.filterCollectionByIllustrator = filterCollectionByIllustrator;
window.COLLECTION_CONDITION_LABELS = COLLECTION_CONDITION_LABELS;
window.getRarityLabelForGroupKey = getRarityLabelForGroupKey;
window.getActiveCollectionFilterChips = getActiveCollectionFilterChips;
window.renderCollectionFilterChips = renderCollectionFilterChips;
window.removeCollectionFilter = removeCollectionFilter;
window.collectionFilterPickerStep = collectionFilterPickerStep;
window.collectionFilterPickerActiveKey = collectionFilterPickerActiveKey;
window.collectionFilterPickerSearchTerm = collectionFilterPickerSearchTerm;
window.COLLECTION_FILTER_TYPES = COLLECTION_FILTER_TYPES;
window.COLLECTION_FILTER_PICKER_SEARCH_THRESHOLD = COLLECTION_FILTER_PICKER_SEARCH_THRESHOLD;
window.getCollectionFilterPickerOptions = getCollectionFilterPickerOptions;
window.isCollectionFilterTypeAvailable = isCollectionFilterTypeAvailable;
window.hasAvailableCollectionFilterTypes = hasAvailableCollectionFilterTypes;
window.updateCollectionAddFilterButtonState = updateCollectionAddFilterButtonState;
window.openCollectionFilterPicker = openCollectionFilterPicker;
window.closeCollectionFilterPicker = closeCollectionFilterPicker;
window.positionCollectionFilterPicker = positionCollectionFilterPicker;
window.showCollectionFilterTypeOptions = showCollectionFilterTypeOptions;
window.showCollectionFilterValueOptions = showCollectionFilterValueOptions;
window.renderCollectionFilterPickerValueRows = renderCollectionFilterPickerValueRows;
window.setCollectionFilterPickerSearch = setCollectionFilterPickerSearch;
window.applyCollectionFilter = applyCollectionFilter;
window.sortCollection = sortCollection;
window.updateSortArrows = updateSortArrows;
window.applySorting = applySorting;
window.pruneStaleCollectionFilters = pruneStaleCollectionFilters;
window.getDuplicateGroupKey = getDuplicateGroupKey;
window.computeDuplicateGroupTotals = computeDuplicateGroupTotals;
window.getDuplicateCardsWithQuantity = getDuplicateCardsWithQuantity;
window.hasActiveCollectionFilters = hasActiveCollectionFilters;
window.updateResetFiltersButtonVisibility = updateResetFiltersButtonVisibility;
window.resetCollectionFilters = resetCollectionFilters;
window.getFilteredSortedCollection = getFilteredSortedCollection;
window.COLLECTION_PAGE_SIZE = COLLECTION_PAGE_SIZE;
window.collectionDisplayLimit = collectionDisplayLimit;
window.selectedCardIds = selectedCardIds;
window.clearSelection = clearSelection;
window.toggleCardSelection = toggleCardSelection;
window.toggleSelectAllVisible = toggleSelectAllVisible;
window.updateSelectAllCheckboxState = updateSelectAllCheckboxState;
window.updateBulkActionsBar = updateBulkActionsBar;
window.bulkUpdateCondition = bulkUpdateCondition;
window.bulkDeleteSelected = bulkDeleteSelected;
window.filterAndDisplay = filterAndDisplay;
window.filterAndDisplayReorder = filterAndDisplayReorder;
window.loadMoreCollectionCards = loadMoreCollectionCards;
window.getSortLabel = getSortLabel;
window.updateCollectionSummary = updateCollectionSummary;
window.renderCollectionHeaderKpis = renderCollectionHeaderKpis;
window.renderFilteredCollection = renderFilteredCollection;
window.renderCollectionTable = renderCollectionTable;
window.replayEntrance = replayEntrance;
window.getCollectionEmptyStateHtml = getCollectionEmptyStateHtml;
window.renderCollectionGrid = renderCollectionGrid;
window.isCollectionMobileViewport = isCollectionMobileViewport;
window.getEffectiveCollectionViewMode = getEffectiveCollectionViewMode;
window.setCollectionView = setCollectionView;
window.collectionViewResizeTimer = collectionViewResizeTimer;
window.backfillIllustrators = backfillIllustrators;
