// Helpers purs - Pokémon Tracker
// Aucun état partagé, aucune dépendance à supabaseClient. Charge juste après config.js.

// Précharge une liste d'URLs d'image en arrière-plan (sans les insérer dans le DOM) - anticipe le
// chargement de la page suivante en pagination (Collection/Catalogue) pour un "Charger plus" plus
// fluide. new Image() suffit à déclencher le fetch navigateur ; entrées vides ignorées, doublons/
// déjà-en-cache dédupliqués par le navigateur lui-même via son cache HTTP normal.
function preloadImages(urls) {
    (urls || []).forEach(url => {
        if (!url) return;
        const img = new Image();
        img.src = url;
    });
}

// ===== Chargement differe des librairies CDN lourdes (perf, cf audit bundle 2026-09-01) =====
// Chart.js/Flatpickr/Papaparse n'etaient utilisees que par une fonctionnalite precise (graphique de
// prix, selecteur de date, import CSV) mais chargees via <script> bloquant sur CHAQUE page, meme
// Dashboard/Wishlist qui n'en ont jamais besoin. Injectees maintenant a la demande, au premier appel
// reel - la promesse est memorisee pour qu'un deuxieme appel (autre carte ouverte, autre champ date...)
// reutilise le meme chargement au lieu d'injecter le script une deuxieme fois.
function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Echec de chargement du script : ${src}`));
        document.head.appendChild(script);
    });
}

let chartLoadPromise = null;
function ensureChartLoaded() {
    if (typeof Chart !== 'undefined') return Promise.resolve();
    if (!chartLoadPromise) chartLoadPromise = loadScriptOnce('https://cdn.jsdelivr.net/npm/chart.js@4.5.1');
    return chartLoadPromise;
}

let flatpickrLoadPromise = null;
function ensureFlatpickrLoaded() {
    if (typeof flatpickr !== 'undefined') return Promise.resolve();
    if (!flatpickrLoadPromise) {
        flatpickrLoadPromise = loadScriptOnce('https://cdn.jsdelivr.net/npm/flatpickr@4.6.13')
            .then(() => loadScriptOnce('https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/l10n/fr.js'));
    }
    return flatpickrLoadPromise;
}

let papaLoadPromise = null;
function ensurePapaLoaded() {
    if (typeof Papa !== 'undefined') return Promise.resolve();
    if (!papaLoadPromise) papaLoadPromise = loadScriptOnce('https://cdn.jsdelivr.net/npm/papaparse@5.6.0/papaparse.min.js');
    return papaLoadPromise;
}

// Formate un prix en euros au format français (virgule décimale) - remplace les ~70 toFixed(2)
// dupliqués à travers le code, dont une partie affichait un point (incohérent avec le reste de
// l'app, entièrement en français). value peut être undefined/null/NaN (traité comme 0).
function formatPrice(value) {
    return (Number(value) || 0).toFixed(2).replace('.', ',') + '€';
}

// Retarde l'exécution de fn jusqu'à ce que delayMs se soient écoulés sans nouvel appel - utilisé sur
// les champs de recherche (Progression, Collection publique) pour éviter de relancer un filtrage/rendu
// coûteux à chaque frappe (retour utilisateur, 2026-08-19 : lag clavier sur mobile, gros set/grosse
// collection). N'affecte pas le coût du calcul lui-même, seulement la fréquence à laquelle il tourne.
function debounce(fn, delayMs) {
    let timeoutId = null;
    return function debounced(...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn.apply(this, args), delayMs);
    };
}

// Anneau de progression SVG (stroke-dashoffset animé au montage, cf .progress-ring dans styles.css) -
// r=27/viewBox 60 dimensionné pour se superposer exactement à un cercle de logo de 60px
// (.progression-set-logo-wrap, qui garde son overflow:hidden pour clipper l'image - l'anneau reste
// donc à l'intérieur du cercle plutôt que de déborder, pour ne pas être coupé par ce même overflow).
function progressRingSvg(pct) {
    const clamped = Math.max(0, Math.min(100, pct));
    const r = 27;
    const circumference = 2 * Math.PI * r;
    const offset = circumference * (1 - clamped / 100);
    const fillClass = clamped >= 100 ? 'progress-ring-fill is-complete' : 'progress-ring-fill';
    return `
        <svg class="progress-ring" viewBox="0 0 60 60" width="60" height="60" aria-hidden="true">
            <circle class="progress-ring-track" cx="30" cy="30" r="${r}"></circle>
            <circle class="${fillClass}" cx="30" cy="30" r="${r}" style="--ring-circumference:${circumference.toFixed(2)}px;--ring-offset:${offset.toFixed(2)}px"></circle>
        </svg>
    `;
}

function toLocalDateInputValue(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Handler onerror générique pour les <img> pointant vers TCGdex : certains sets n'ont pas
// leurs assets en /fr/, on retente une fois en /en/ avant d'abandonner (fallback appelé au 2e échec).
function handleTcgdexImgError(img, fallback) {
    if (!img.dataset.localeRetried && img.src.includes('/fr/')) {
        img.dataset.localeRetried = '1';
        img.src = img.src.replace('/fr/', '/en/');
        return;
    }
    if (typeof fallback === 'function') fallback(img);
    else if (fallback) img.outerHTML = fallback;
    else img.style.display = 'none';
}

// Handler onerror pour les sceaux de série (.modal-series-seal) : certains sets récents n'ont pas
// encore leur logo généré en .webp sur le CDN TCGdex (ex. me05 "Nuit Noire") alors que le .png existe -
// on retente une fois en .png avant d'abandonner.
function handleSealLogoError(img) {
    if (!img.dataset.formatRetried && img.src.endsWith('.webp')) {
        img.dataset.formatRetried = '1';
        img.src = img.src.replace(/\.webp$/, '.png');
        return;
    }
    img.remove();
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
    const icon = type === 'success' ? 'ti-circle-check' : 'ti-alert-circle';
    div.innerHTML = `<i class="ti ${icon} message-icon" aria-hidden="true"></i><span>${escapeHtml(text)}</span>`;
    container.innerHTML = '';
    container.appendChild(div);
    setTimeout(() => {
        div.classList.add('message--leaving');
        div.addEventListener('transitionend', () => div.remove(), { once: true });
        setTimeout(() => div.remove(), 300); // filet de sécurité si transitionend ne se déclenche pas
    }, 3000);
}

// Validation avant upload Storage (taille + type réel du fichier, pas juste l'attribut HTML
// accept="image/*" qui ne protège rien côté client). Appelée uniquement sur les File venant d'un
// <input type="file"> choisi par l'utilisateur — jamais sur les Blob récupérés en interne depuis
// TCGdex/Pokémon TCG API (déjà des images de confiance, pas une entrée utilisateur).
// Lève une Error avec un message affichable tel quel (showMessage) si le fichier est invalide.
const MAX_UPLOAD_IMAGE_BYTES = 15 * 1024 * 1024; // 15 Mo : généreux pour une photo de carte, bloque le reste

function validateImageFile(file) {
    if (!file) {
        throw new Error('Aucun fichier sélectionné.');
    }
    if (!file.type || !file.type.startsWith('image/')) {
        throw new Error('Le fichier doit être une image.');
    }
    if (file.size > MAX_UPLOAD_IMAGE_BYTES) {
        throw new Error(`Image trop lourde (${(file.size / (1024 * 1024)).toFixed(1)} Mo, maximum 15 Mo).`);
    }
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

// Fallback recherche par nom (utilisé seulement quand cardmarket_id est absent, cf. getCardmarketUrl
// ci-dessous). Un idProduct seul suffit pour un lien produit direct (voir card-detail.js), donc ce
// fallback n'est plus la voie principale - juste un filet de sécurité pour les items sans idProduct
// stocké (ex: anciens items wishlist ajoutés avant la colonne cardmarket_id).
function getCardmarketSearchUrl(name) {
    return `https://www.cardmarket.com/fr/Pokemon/Products/Search?searchString=${encodeURIComponent(name || '')}&exactMatch=1&language=2`;
}

// Meme logique que le bouton Cardmarket de la collection (card-detail.js:95-97, volontairement pas
// touche) : lien direct vers la fiche produit exacte si on a l'idProduct Cardmarket, sinon recherche
// par nom en secours.
function getCardmarketUrl(cardmarketId, name) {
    if (cardmarketId) {
        return `https://www.cardmarket.com/fr/Pokemon/Products?idProduct=${cardmarketId}&language=2`;
    }
    return getCardmarketSearchUrl(name);
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

// Clé de regroupement pour les filtres de rareté : deux libellés qui partagent la même icône
// (variantes historiques TCGdex, ex "Rare Holo"/"Holo Rare"/"Holographique" -> holo.webp) doivent
// tomber dans le même bouton de filtre. Sans icône mappée, chaque libellé reste son propre groupe.
function getRarityGroupKey(rarity) {
    return RARITY_ICON_MAP[normalizeForMatch(rarity)] || normalizeForMatch(rarity);
}

// Logos de type (énergie) uploadés par l'utilisateur dans Supabase Storage, un fichier par type
// (ex: card-images/energy/dragon.png). Nom de fichier déduit du type normalisé (minuscule, sans accent) ;
// si le fichier n'existe pas pour un type donné, l'icône est simplement retirée au chargement (onerror),
// le texte du type reste affiché tel quel à côté.
const TYPE_ICON_BASE_URL = 'https://mmdcpkwygqsdaqnkimwb.supabase.co/storage/v1/object/public/card-images/energy/';

function getTypeIconHtml(type, sizePx = 26) {
    if (!type) return '';
    const filename = `${normalizeForMatch(type)}.png`;
    return `<img src="${TYPE_ICON_BASE_URL}${filename}" alt="" class="type-icon" style="width:${sizePx}px;height:${sizePx}px;" onerror="this.remove()">`;
}

// card.type peut contenir plusieurs types joints par ", " (ex: "Feu, Vol") : une icône par type
function getTypesIconsHtml(typeString, sizePx = 22) {
    if (!typeString || typeString === 'N/A') return '';
    return typeString.split(',').map(t => t.trim()).filter(Boolean).map(t => getTypeIconHtml(t, sizePx)).join('');
}

// Construit une ligne de boutons icônes pour filtrer par rareté (multi-sélection possible).
// Les libellés qui partagent la même icône sont regroupés sous un seul bouton (cf getRarityGroupKey) ;
// activeValues stocke des clés de groupe, pas les libellés bruts.
function buildRarityFilterRowHtml(rarities, activeValues, clickHandlerName, iconSizePx = 20) {
    const allBtn = `<button class="rarity-filter-btn ${activeValues.size === 0 ? 'active' : ''}" onclick="${clickHandlerName}('')" data-tooltip="Toutes les raretés" aria-label="Toutes les raretés"><i class="ti ti-asterisk" aria-hidden="true"></i></button>`;

    // Un seul bouton représentatif par groupe (première rareté rencontrée pour ce groupe)
    const groups = new Map();
    rarities.forEach(r => {
        const key = getRarityGroupKey(r);
        if (!groups.has(key)) groups.set(key, r);
    });

    const rarityBtns = [...groups.entries()].map(([groupKey, r]) => {
        const icon = getRarityIconHtml(r, iconSizePx);
        const isActive = activeValues.has(groupKey);
        const safeKey = groupKey.replace(/'/g, "\\'");
        const content = icon || `<span class="rarity-filter-text">${r}</span>`;
        return `<button class="rarity-filter-btn ${isActive ? 'active' : ''} ${icon ? '' : 'rarity-filter-btn-text'}" onclick="${clickHandlerName}('${safeKey}')" data-tooltip="${r}" aria-label="${r}">${content}</button>`;
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
async function initDatePicker(selector, presetValue) {
    await ensureFlatpickrLoaded();
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

// ===== Exports window (ticket V2 Vite, type="module") =====
// Les déclarations top-level d'un module ES ne s'attachent plus automatiquement à window
// (contrairement à un <script> classique) : réexport explicite pour que les autres scripts
// (chargés en modules indépendants, sans import/export entre eux, scope global inchangé)
// puissent continuer à référencer ces noms tels quels — y compris depuis des onclick="..."
// inline dans du HTML généré. Liste exhaustive des déclarations top-level de ce fichier
// (hors variables déjà passées en window.x = ... directement à leur déclaration, cf audit
// du 2026-08-14 sur l'état mutable partagé entre fichiers).
window.formatPrice = formatPrice;
window.preloadImages = preloadImages;
window.toLocalDateInputValue = toLocalDateInputValue;
window.handleTcgdexImgError = handleTcgdexImgError;
window.handleSealLogoError = handleSealLogoError;
window.progressRingSvg = progressRingSvg;
window.escapeHtml = escapeHtml;
window.showMessage = showMessage;
window.MAX_UPLOAD_IMAGE_BYTES = MAX_UPLOAD_IMAGE_BYTES;
window.validateImageFile = validateImageFile;
window.resizeImageToBlob = resizeImageToBlob;
window.resizeBlobToJpeg = resizeBlobToJpeg;
window.sanitizeForPath = sanitizeForPath;
window.getTcgdexImagePath = getTcgdexImagePath;
window.getSeriesLogoPath = getSeriesLogoPath;
window.resizeImageToWebpBlob = resizeImageToWebpBlob;
window.ensureChartLoaded = ensureChartLoaded;
window.ensureFlatpickrLoaded = ensureFlatpickrLoaded;
window.ensurePapaLoaded = ensurePapaLoaded;
window.getSeriesSymbolPath = getSeriesSymbolPath;
window.getSetIdFromTcgdexId = getSetIdFromTcgdexId;
window.normalizeForMatch = normalizeForMatch;
window.getCardmarketSearchUrl = getCardmarketSearchUrl;
window.getCardmarketUrl = getCardmarketUrl;
window.RARITY_ICON_MAP = RARITY_ICON_MAP;
window.RARITY_ORDER = RARITY_ORDER;
window.sortRaritiesByTier = sortRaritiesByTier;
window.buildFinishOptionsFromCard = buildFinishOptionsFromCard;
window.buildFinishOptionsHtml = buildFinishOptionsHtml;
window.getMarketValueForFinish = getMarketValueForFinish;
window.FOIL_ICON_MAP = FOIL_ICON_MAP;
window.getFoilIconHtml = getFoilIconHtml;
window.renderFinishBadge = renderFinishBadge;
window.getFinishLabel = getFinishLabel;
window.getRarityIconHtml = getRarityIconHtml;
window.getRarityGroupKey = getRarityGroupKey;
window.TYPE_ICON_BASE_URL = TYPE_ICON_BASE_URL;
window.getTypeIconHtml = getTypeIconHtml;
window.getTypesIconsHtml = getTypesIconsHtml;
window.buildRarityFilterRowHtml = buildRarityFilterRowHtml;
window.debounce = debounce;
window.parseCsvDate = parseCsvDate;
window.initDatePicker = initDatePicker;
