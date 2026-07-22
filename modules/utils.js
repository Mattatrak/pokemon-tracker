// Helpers purs - Pokémon Tracker
// Aucun état partagé, aucune dépendance à supabaseClient. Charge juste après config.js.

function toLocalDateInputValue(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function showMessage(text, type = 'error') {
    const container = document.getElementById('message-container');
    const div = document.createElement('div');
    div.className = `message ${type}`;
    div.textContent = text;
    container.innerHTML = '';
    container.appendChild(div);
    setTimeout(() => div.remove(), 3000);
}

// Redimensionne une image et la convertit en Blob JPEG, prête à uploader
function resizeImageToBlob(file, maxWidth = 400) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const ratio = img.height / img.width;
                const canvas = document.createElement('canvas');
                canvas.width = Math.min(maxWidth, img.width);
                canvas.height = canvas.width * ratio;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.85);
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// Redimensionne un Blob (ex: image téléchargée) et retourne un Blob JPEG
function resizeBlobToJpeg(blob, maxWidth = 400) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
            const ratio = img.height / img.width;
            const canvas = document.createElement('canvas');
            canvas.width = Math.min(maxWidth, img.width);
            canvas.height = canvas.width * ratio;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            canvas.toBlob((resizedBlob) => {
                URL.revokeObjectURL(url);
                resolve(resizedBlob);
            }, 'image/jpeg', 0.85);
        };
        img.onerror = (e) => {
            URL.revokeObjectURL(url);
            reject(e);
        };
        img.src = url;
    });
}

// Transforme un id TCGdex en nom de fichier sûr (ex: "swsh3-136" -> "swsh3-136")
function sanitizeForPath(str) {
    return str.replace(/[^a-zA-Z0-9-_.]/g, '-');
}

function getTcgdexImagePath(tcgdexId) {
    return `tcgdex/${sanitizeForPath(tcgdexId)}.jpg`;
}

function getSeriesLogoPath(setId) {
    return `logos/${sanitizeForPath(setId)}.webp`;
}

// Redimensionne une image en gardant la transparence (utilisé pour les logos, contrairement aux JPEG des cartes)
function resizeImageToWebpBlob(file, maxWidth = 300) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const ratio = img.height / img.width;
                const canvas = document.createElement('canvas');
                canvas.width = Math.min(maxWidth, img.width);
                canvas.height = canvas.width * ratio;
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                canvas.toBlob((blob) => resolve(blob), 'image/webp', 0.92);
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function getSeriesSymbolPath(setId) {
    return `symbols/${sanitizeForPath(setId)}.webp`;
}

// Déduit l'identifiant du set à partir d'un identifiant TCGdex de carte (ex: "sv08-097" -> "sv08").
// Utilise le DERNIER tiret (pas le premier) car certains sets ont eux-mêmes un tiret dans leur
// identifiant (ex: séries ".5" comme Héros Transcendants, probablement "me2-5"), ce qui les
// confondrait sinon avec le set principal (ex: "me2" Flammes Fantasmagoriques).
function getSetIdFromTcgdexId(tcgdexId) {
    if (!tcgdexId) return null;
    const lastDash = tcgdexId.lastIndexOf('-');
    return lastDash === -1 ? tcgdexId : tcgdexId.substring(0, lastDash);
}

function normalizeForMatch(str) {
    return (str || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

// Correspondance entre le texte de rareté (tel que renvoyé par TCGdex) et l'icône fournie par l'utilisateur.
// Plusieurs variantes par icône pour maximiser les chances de correspondance selon les libellés/époques.
// Si aucune correspondance : on affiche simplement le texte comme avant, rien ne casse.
const RARITY_ICON_MAP = {
    // Commune
    'commune': 'commune.webp',
    'common': 'commune.webp',

    // Peu commune
    'peu commune': 'peu-commune.webp',
    'uncommon': 'peu-commune.webp',

    // Holo (rare de base) - "Holo Rare" est un renommage plus récent de "Rare Holo"
    'rare': 'holo.webp',
    'rare holo': 'holo.webp',
    'holo rare': 'holo.webp',
    'holographique': 'holo.webp',

    // Double rare - inclut les V/VMAX/VSTAR non full-art, équivalent historique
    'double rare': 'double-rare.png',
    'holo rare v': 'double-rare.png',
    'holo rare vmax': 'double-rare.png',
    'holo rare vstar': 'double-rare.png',
    'shiny rare v': 'double-rare.png',
    'shiny rare vmax': 'double-rare.png',

    // Ultra rare - mécaniques spéciales historiques de rang comparable
    'ultra rare': 'ultra-rare.png',
    'shiny ultra rare': 'ultra-rare.png',
    'amazing rare': 'ultra-rare.png',
    'magnifique rare': 'ultra-rare.png',
    'radiant rare': 'ultra-rare.png',
    'rare prime': 'ultra-rare.png',
    'legend': 'ultra-rare.png',
    'rare holo lv.x': 'ultra-rare.png',
    'full art trainer': 'ultra-rare.png',
    'ace spec rare': 'ultra-rare.png',

    // Illustration rare
    'illustration rare': 'illustration-rare.png',

    // Illustration spéciale rare
    'special illustration rare': 'illustration-speciale-rare.png',
    'illustration speciale rare': 'illustration-speciale-rare.png',

    // Top tier / secrètes
    'hyper rare': 'mega-hyper-rare.webp',
    'mega hyper rare': 'mega-hyper-rare.webp',
    'secret rare': 'mega-hyper-rare.webp',
    'shiny rare': 'mega-hyper-rare.webp',
    'black white rare': 'mega-hyper-rare.webp',
    'classic collection': 'mega-hyper-rare.webp',

    // Promo
    'promo': 'promo.webp'
};

// Ordre d'affichage des raretés (du plus commun au plus rare), reprenant l'ordre visuel fourni
const RARITY_ORDER = [
    'commune.webp',
    'peu-commune.webp',
    'holo.webp',
    'double-rare.png',
    'illustration-rare.png',
    'ultra-rare.png',
    'illustration-speciale-rare.png',
    'mega-hyper-rare.webp',
    'promo.webp'
];

function sortRaritiesByTier(rarities) {
    return [...rarities].sort((a, b) => {
        const fileA = RARITY_ICON_MAP[normalizeForMatch(a)];
        const fileB = RARITY_ICON_MAP[normalizeForMatch(b)];
        const rankA = fileA ? RARITY_ORDER.indexOf(fileA) : 999;
        const rankB = fileB ? RARITY_ORDER.indexOf(fileB) : 999;
        if (rankA !== rankB) return rankA - rankB;
        return a.localeCompare(b);
    });
}

// Renvoie un libellé court pour la finition, ou null pour "normal" (pas besoin de l'afficher)
// Construit la liste des finitions réellement disponibles pour une carte donnée,
// à partir de variants_detailed (ex: Normale, Reverse, Pokéball, Énergie...)
function buildFinishOptionsFromCard(card) {
    const variants = card?.variants_detailed;
    const options = [];
    const seen = new Set();

    const addOption = (value, label) => {
        if (!seen.has(value)) {
            seen.add(value);
            options.push({ value, label });
        }
    };

    if (Array.isArray(variants) && variants.length > 0) {
        variants.forEach(v => {
            if (v.foil) {
                addOption(v.foil, v.foil);
            } else if (v.type === 'Normal' || v.type === 'Holo') {
                addOption('normal', 'Normale');
            } else if (v.type === 'Reverse') {
                addOption('reverse', 'Reverse');
            } else if (v.type) {
                addOption(v.type.toLowerCase().replace(/\s+/g, '_'), v.type);
            }
        });
    }

    // Toujours garantir "Normale" en secours, même si l'info n'est pas dans variants_detailed
    if (!seen.has('normal')) {
        options.unshift({ value: 'normal', label: 'Normale' });
    }

    return options;
}

// Construit le HTML des <option> pour un select de finition, à partir d'une carte
function buildFinishOptionsHtml(card, selectedValue = 'normal') {
    const options = buildFinishOptionsFromCard(card);
    return options.map(o => `<option value="${o.value}" ${o.value === selectedValue ? 'selected' : ''}>${o.label}</option>`).join('');
}

// Récupère le prix de marché correspondant exactement à la finition choisie, avec repli
// sur le prix Reverse classique, puis sur le prix Normal si rien de plus précis n'est trouvé
function getMarketValueForFinish(card, finishValue) {
    const variants = card?.variants_detailed;

    if (Array.isArray(variants) && variants.length > 0) {
        const matches = (v) => {
            if (v.foil) return v.foil === finishValue;
            if (v.type === 'Normal' || v.type === 'Holo') return finishValue === 'normal';
            if (v.type === 'Reverse') return finishValue === 'reverse';
            if (v.type) return finishValue === v.type.toLowerCase().replace(/\s+/g, '_');
            return false;
        };

        const exact = variants.find(matches);
        const exactPrice = exact?.pricing?.cardmarket?.avg ?? exact?.pricing?.cardmarket?.['avg-holo'];
        if (typeof exactPrice === 'number') return exactPrice;

        // Repli : prix Reverse classique (sans foil particulier)
        const reverseFallback = variants.find(v => v.type === 'Reverse' && !v.foil);
        const reversePrice = reverseFallback?.pricing?.cardmarket?.avg ?? reverseFallback?.pricing?.cardmarket?.['avg-holo'];
        if (typeof reversePrice === 'number') return reversePrice;

        // Dernier repli : prix Normal
        const normalFallback = variants.find(v => v.type === 'Normal');
        const normalPrice = normalFallback?.pricing?.cardmarket?.avg;
        if (typeof normalPrice === 'number') return normalPrice;
    }

    // Filet de sécurité générique (carte sans variants_detailed disponible)
    if (card?.pricing?.cardmarket?.avg) return card.pricing.cardmarket.avg;
    if (card?.pricing?.cardmarket?.['avg-holo']) return card.pricing.cardmarket['avg-holo'];
    return 0;
}

// Icônes de foil hébergées par l'utilisateur directement dans Supabase Storage (pas de fichier local)
const FOIL_ICON_MAP = {
    'pokeball': 'https://mmdcpkwygqsdaqnkimwb.supabase.co/storage/v1/object/public/card-images/ball/pokeball.png',
    'energie': 'https://mmdcpkwygqsdaqnkimwb.supabase.co/storage/v1/object/public/card-images/ball/energy.png',
    'copain ball': 'https://mmdcpkwygqsdaqnkimwb.supabase.co/storage/v1/object/public/card-images/ball/friendball.png',
    'love ball': 'https://mmdcpkwygqsdaqnkimwb.supabase.co/storage/v1/object/public/card-images/ball/loveball.png',
    'rapide ball': 'https://mmdcpkwygqsdaqnkimwb.supabase.co/storage/v1/object/public/card-images/ball/quickball.png',
    'team rocket': 'https://mmdcpkwygqsdaqnkimwb.supabase.co/storage/v1/object/public/card-images/ball/rocket.png',
    'sombre ball': 'https://mmdcpkwygqsdaqnkimwb.supabase.co/storage/v1/object/public/card-images/ball/duskball.png',
    'master ball': 'https://mmdcpkwygqsdaqnkimwb.supabase.co/storage/v1/object/public/card-images/ball/masterball.png'
};

function getFoilIconHtml(finish, sizePx = 16) {
    const url = FOIL_ICON_MAP[normalizeForMatch(finish)];
    if (!url) return '';
    return `<img src="${url}" alt="" class="foil-icon" style="width:${sizePx}px;height:${sizePx}px;">`;
}

// Construit le badge de finition : icône seule + info-bulle au survol si une icône existe,
// sinon le texte simple (ex: "Reverse", "1ère éd." qui n'ont pas d'icône dédiée)
function renderFinishBadge(finish, className, iconSize = 12) {
    const label = getFinishLabel(finish);
    if (!label) return '';
    const icon = getFoilIconHtml(finish, iconSize);
    if (icon) {
        return `<span class="${className}" data-tooltip="${label}">${icon}</span>`;
    }
    return `<span class="${className}">${label}</span>`;
}

function getFinishLabel(finish) {
    if (!finish || finish === 'normal') return null;
    const labels = { reverse: 'Reverse', holo: 'Holo', first_edition: '1ère éd.' };
    return labels[finish] || finish; // sinon on affiche le foil tel quel (Pokéball, Énergie...)
}

function getRarityIconHtml(rarity, sizePx = 16) {
    const filename = RARITY_ICON_MAP[normalizeForMatch(rarity)];
    if (!filename) return '';
    return `<img src="images/rarity/${filename}" alt="" class="rarity-icon" style="width:${sizePx}px;height:${sizePx}px;">`;
}

// Construit une ligne de boutons icônes pour filtrer par rareté (multi-sélection possible)
function buildRarityFilterRowHtml(rarities, activeValues, clickHandlerName) {
    const allBtn = `<button class="rarity-filter-btn ${activeValues.size === 0 ? 'active' : ''}" onclick="${clickHandlerName}('')" data-tooltip="Toutes les raretés" aria-label="Toutes les raretés"><i class="ti ti-asterisk" aria-hidden="true"></i></button>`;

    const rarityBtns = rarities.map(r => {
        const icon = getRarityIconHtml(r, 20);
        const isActive = activeValues.has(r);
        const safeR = r.replace(/'/g, "\\'");
        const content = icon || `<span class="rarity-filter-text">${r}</span>`;
        return `<button class="rarity-filter-btn ${isActive ? 'active' : ''} ${icon ? '' : 'rarity-filter-btn-text'}" onclick="${clickHandlerName}('${safeR}')" data-tooltip="${r}" aria-label="${r}">${content}</button>`;
    }).join('');

    return allBtn + rarityBtns;
}

// Convertit une date jj/mm/aaaa (saisie dans le CSV) en aaaa-mm-jj (attendu par performCardAdd)
function parseCsvDate(str) {
    if (!str) return null;
    const parts = str.trim().split(/[\/\-]/);
    if (parts.length !== 3) return null;
    const [d, m, y] = parts;
    if (!d || !m || !y) return null;
    return `${y.padStart(4, '20')}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

// Initialise Flatpickr avec le thème et la locale de l'app sur un champ de date donné
function initDatePicker(selector, presetValue) {
    if (typeof flatpickr === 'undefined') return;
    flatpickr(selector, {
        locale: 'fr',
        dateFormat: 'Y-m-d',
        altInput: true,
        altFormat: 'd/m/Y',
        maxDate: 'today',
        monthSelectorType: 'static',
        defaultDate: presetValue || null
    });
}
