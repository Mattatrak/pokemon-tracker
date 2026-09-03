// Helpers purs - Pokémon Tracker
// Aucun état partagé, aucune dépendance à supabaseClient. Charge juste après config.js.
// Exception : celebrateCardAdded()/findCollectionNavTarget() lisent TAB_ROUTES (tracker.js) et
// allCollectionCards/allTcgdexSeries (tracker.js/progression.js) - uniquement au moment de l'appel,
// jamais au chargement du fichier, donc sans contrainte d'ordre de <script>.

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

// Déplacée depuis modules/public-profile.js (audit bundle 2026-09) : utilisée à la fois par
// collectors.js (widget Dashboard "Trouver un collectionneur", visible par tous, chargé eager) et
// public-profile.js (fiche profil complète, chargée à la demande) - devait rester dans un module
// toujours chargé, sinon collectors.js plantait dès qu'un résultat de recherche a un created_at,
// tant que public-profile.js n'avait pas encore été importé.
function formatPublicMemberSince(dateInput) {
    if (!dateInput) return '';
    const date = new Date(dateInput);
    return `Collectionneur depuis ${date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}`;
}

// ===== Isolation d'erreur entre sections independantes d'une meme page (audit senior 2026-09,
// generalise depuis dashboardRenderSafe qui n'existait que pour le Dashboard) : une section qui
// plante ne doit jamais empecher les autres de s'afficher, ni laisser la page dans un etat casse
// sans aucun retour visuel. =====

// Pour une section qui possede un unique conteneur DOM (un widget Dashboard, une liste Progression...)
// : sur erreur, remplace son contenu par un message de repli discret plutot que de laisser un
// conteneur a moitie rendu ou vide sans explication.
function renderSectionSafe(containerId, fn) {
    try {
        fn();
    } catch (error) {
        console.error(`Erreur de rendu (${containerId}):`, error);
        const el = document.getElementById(containerId);
        if (el) el.innerHTML = '<p class="render-error-text">Section indisponible</p>';
    }
}

// Pour une section qui ecrit dans plusieurs elements a la fois (graphiques/listes Statistiques) :
// pas de conteneur unique a remplacer par un message, mais la panne doit rester isolee - sans ca,
// une erreur dans un graphique interrompait toute la sequence de rendu suivante (cf renderStatsCharts).
function runSafe(fn, label) {
    try {
        fn();
    } catch (error) {
        console.error(`Erreur de rendu (${label}):`, error);
    }
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
    if (!container) return; // absent sur login.html - cf filet unhandledrejection plus bas, partagé par les deux pages
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

// Filet de securite final (audit senior 2026-09, "echecs silencieux sur actions async") : la
// quasi-totalite des actions utilisateur (supprimer/modifier/ajouter une carte, une liste de
// souhaits...) sont declenchees depuis des onclick="" inline sur des fonctions async. Le chemin
// d'erreur evident (l'appel Supabase lui-meme) est deja gere localement (showMessage + console.error)
// partout ou ca compte, mais rien n'attrapait jusqu'ici une exception survenant APRES - dans la
// reconciliation des stats mensuelles, un rafraichissement, un re-rendu... Sentry (error-tracking.js)
// captait deja ces rejets pour le suivi, mais l'utilisateur, lui, ne voyait absolument rien : au
// mieux un bouton reste bloque, au pire une action semble n'avoir rien fait. Filet generique plutot
// qu'auditer un par un chaque site d'appel (~90 fonctions async dans le projet, la plupart de simples
// utilitaires jamais invoques depuis un onclick).
window.addEventListener('unhandledrejection', (event) => {
    console.error('Promesse rejetée non gérée :', event.reason);
    showMessage("Une erreur inattendue s'est produite. Réessaie, et recharge la page si le problème persiste.", 'error');
});

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

// Nombre de cartes DISTINCTES possédées dans un set (même dérivation que ownedIdsBySet dans
// renderProgressionSeriesList, modules/progression.js - dupliquée ici en version ciblée sur un seul
// set pour que modules/cards.js#celebrateCardAdd puisse détecter une complétion sans dépendre de
// progression.js ni recalculer tous les sets à chaque ajout).
function getSetOwnedCount(setId) {
    if (!setId) return 0;
    const owned = new Set();
    allCollectionCards.forEach(card => {
        if (card.tcgdex_id && getSetIdFromTcgdexId(card.tcgdex_id) === setId) owned.add(card.tcgdex_id);
    });
    return owned.size;
}

// Total de cartes d'un set (secrètes incluses, même règle que renderProgressionSeriesList). Dépend
// d'allTcgdexSeries (progression.js), vide tant que l'onglet Progression n'a pas été visité au moins
// une fois dans la session - retourne alors 0, ce qui désactive silencieusement toute logique basée
// dessus (cf modules/cards.js#addCard, modules/progression.js#celebrateSetComplete) plutôt que de
// forcer un chargement réseau supplémentaire pour une feature cosmétique.
function getSetTotalCount(setId) {
    if (!setId || !allTcgdexSeries || allTcgdexSeries.length === 0) return 0;
    for (const series of allTcgdexSeries) {
        const set = (series.sets || []).find(s => s.id === setId);
        if (set) return set.cardCount?.total || set.cardCount?.official || 0;
    }
    return 0;
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

// Effet "foil" (retour utilisateur 2026-09, audit design) : dégradé chromatique statique sur le
// badge de prix des cartes des paliers de rareté élevés, pour les repérer d'un coup d'œil dans une
// grille de 60 cartes - comme sur une vraie table de tri. Seuil à illustration-rare.png (index 4 sur
// 9) : au-delà de "Double rare" (V/VMAX/VSTAR non full-art, très courant dans une collection normale,
// le foil deviendrait juste le bruit de fond plutôt qu'un signal) mais avant "Promo" (dernier de
// RARITY_ORDER, catégorie de provenance et non de rareté - une promo peut être commune).
const HIGH_RARITY_ICONS = new Set(['illustration-rare.png', 'ultra-rare.png', 'illustration-speciale-rare.png', 'mega-hyper-rare.webp']);
function isHighRarityCard(rarity) {
    return HIGH_RARITY_ICONS.has(RARITY_ICON_MAP[normalizeForMatch(rarity)]);
}

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

// ===== CÉLÉBRATION AJOUT DE CARTE (retour utilisateur 2026-09, mockup "Micro-interactions" validé) =====
// Point d'entrée partagé par tous les chemins d'ajout (onglet Ajouter/cards.js, Progression/
// progression.js, wishlist/wishlist.js) : remplace le toast textuel "carte(s) ajoutée(s)" qui tournait
// en parallèle auparavant sur chacun d'eux (retour utilisateur : l'animation seule suffit, les deux
// signaux pour un même événement faisaient doublon). Vivait uniquement dans modules/cards.js au
// départ, déplacé ici une fois réutilisé par un deuxième puis un troisième appelant.
//
// originEl/sourceImgEl acceptent soit un élément DOM vivant (lu ici, au moment de l'appel), soit un
// snapshot déjà capturé via captureCardAddOrigin()/captureCardAddSource() (voir plus bas) : un appelant
// qui ne peut pas garantir que ses éléments seront encore attachés au moment où cette fonction tourne
// (ex: quickInstantAdd, page Progression - retour utilisateur "l'animation fonctionne une fois sur
// cinq" : un second ajout cliqué pendant que le premier est encore en vol réseau déclenche un
// renderProgressionCardsGrid() qui détache le bouton/l'image du premier avant que sa propre animation
// n'ait pu lire leurs rects, qui partaient alors du coin (0,0) - invisible) doit capturer un snapshot
// AVANT tout await et le passer ici, plutôt que de garder l'élément DOM vivant en espérant qu'il tienne.
function celebrateCardAdded({ originEl, sourceImgEl, quantity = 1 } = {}) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const originRect = originEl && (originEl.rect || originEl.getBoundingClientRect());
    if (!originRect) return;

    const navTarget = findCollectionNavTarget();
    if (!navTarget) return;

    spawnAddSparks(originRect.left + originRect.width / 2, originRect.top);

    const dstRect = navTarget.getBoundingClientRect();
    const source = sourceImgEl && (sourceImgEl.rect ? sourceImgEl : { rect: sourceImgEl.getBoundingClientRect(), isImg: sourceImgEl.tagName === 'IMG', imgSrc: sourceImgEl.tagName === 'IMG' ? sourceImgEl.src : null });
    if (source) {
        flyGhostCard(source, dstRect, quantity);
    } else {
        popNavToast(dstRect, quantity);
    }
}

// Capture immuable des positions/apparence nécessaires à celebrateCardAdded(), à appeler AVANT tout
// await susceptible de laisser un autre ajout concurrent détacher ces éléments du DOM (cf commentaire
// ci-dessus). { rect, isImg, imgSrc } ne référence plus aucun nœud DOM une fois créé : totalement
// indépendant de ce qui arrive ensuite à la page.
function captureCardAddOrigin(el) {
    return el ? { rect: el.getBoundingClientRect() } : null;
}

function captureCardAddSource(el) {
    if (!el) return null;
    return {
        rect: el.getBoundingClientRect(),
        isImg: el.tagName === 'IMG',
        imgSrc: el.tagName === 'IMG' ? el.src : null
    };
}

// Le lien "Ma Collection" existe deux fois dans le DOM (DesktopNavbar.js + MobileBottomNavigation.js,
// CSS masque l'un des deux selon le breakpoint) : offsetParent === null détecte de façon fiable celui
// caché par display:none (pas juste hors-écran), sans dépendre d'un matchMedia dupliqué ici.
function findCollectionNavTarget() {
    const links = document.querySelectorAll(`a[href="#${TAB_ROUTES['tab-collection']}"]`);
    for (const link of links) {
        if (link.offsetParent !== null) return link;
    }
    return null;
}

// Canvas plein viewport, créé/détruit à chaque appel (pas de canvas persistant à gérer entre deux
// ajouts) : le coût d'une création est négligeable face à la complexité d'un état partagé entre
// célébrations qui pourraient se chevaucher (ajouts rapprochés).
function spawnAddSparks(x, y) {
    const canvas = document.createElement('canvas');
    canvas.className = 'add-celebration-canvas';
    const ratio = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * ratio;
    canvas.height = window.innerHeight * ratio;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);

    const particles = Array.from({ length: 20 }, () => {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1.3 + Math.random() * 2.4;
        return {
            x, y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 0.6,
            life: 1,
            size: 1.5 + Math.random() * 2,
            color: Math.random() > 0.35 ? '227,188,132' : '244,199,102' // --gold / --gold-bright (scrollbar)
        };
    });

    function frame() {
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        let alive = false;
        particles.forEach(p => {
            if (p.life <= 0) return;
            alive = true;
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.06;
            p.life -= 0.03;
            ctx.globalAlpha = Math.max(p.life, 0);
            ctx.fillStyle = `rgb(${p.color})`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.globalAlpha = 1;
        if (alive) requestAnimationFrame(frame);
        else canvas.remove();
    }
    requestAnimationFrame(frame);
}

// source : { rect, isImg, imgSrc } capturé par captureCardAddSource() (ou construit à la volée par
// celebrateCardAdded() si un élément DOM vivant a été passé directement) - jamais un nœud DOM lui-même,
// qui pourrait déjà être détaché au moment où cette fonction tourne (cf commentaire celebrateCardAdded).
function flyGhostCard(source, dstRect, quantity) {
    const srcRect = source.rect;
    const ghost = document.createElement('div');
    ghost.className = 'add-celebration-ghost';
    ghost.style.left = srcRect.left + 'px';
    ghost.style.top = srcRect.top + 'px';
    ghost.style.width = srcRect.width + 'px';
    ghost.style.height = srcRect.height + 'px';

    if (source.isImg && source.imgSrc) {
        const img = document.createElement('img');
        img.src = source.imgSrc;
        img.alt = '';
        ghost.appendChild(img);
    } else {
        ghost.classList.add('add-celebration-ghost-plain');
    }

    document.body.appendChild(ghost);

    // Cible le centre du lien nav, avec un décalage pour que le fantôme "disparaisse dedans" au lieu
    // de s'arrêter pile au centre géométrique (plus naturel pour un rectangle qui rétrécit en scale).
    const endX = dstRect.left + dstRect.width / 2 - srcRect.width * 0.075;
    const endY = dstRect.top + dstRect.height / 2 - srcRect.height * 0.075;

    requestAnimationFrame(() => {
        ghost.style.transform = `translate(${endX - srcRect.left}px, ${endY - srcRect.top}px) scale(0.15) rotate(8deg)`;
        ghost.style.opacity = '0';
    });

    setTimeout(() => {
        ghost.remove();
        popNavToast(dstRect, quantity);
    }, 520);
}

function popNavToast(dstRect, quantity) {
    const toast = document.createElement('div');
    toast.className = 'add-celebration-toast';
    toast.textContent = `+${quantity}`;
    toast.style.left = (dstRect.left + dstRect.width / 2) + 'px';
    toast.style.top = dstRect.top + 'px';
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('add-celebration-toast-active'));
    setTimeout(() => toast.remove(), 650);
}

// ===== BANDEAU DE CÉLÉBRATION GÉNÉRIQUE (retour utilisateur 2026-09, mockup "Micro-interactions"
// validé) =====
// Partagé par la complétion de set (modules/progression.js#celebrateSetComplete) et l'ajout de carte
// depuis l'onglet Ajouter (modules/cards.js#celebrateCardAddedBanner) - retour utilisateur : sur cette
// page précise les ajouts se font un par un (pas de série rapide comme sur la grille Progression), la
// même notif marquante que pour un set complété a donc sa place ici aussi. Vivait uniquement dans
// modules/progression.js au départ (spécifique aux sets), généralisée une fois réutilisée par un
// deuxième appelant. Ailleurs (Progression/wishlist), le geste plus discret celebrateCardAdded()
// (étincelles + carte volante) reste seul en place : la même notif à chaque ajout d'une série rapide y
// serait fatigante.
//
// innerHtml : contenu déjà construit par l'appelant (icône/image + libellé + nom) - cette fonction ne
// connaît ni sets ni cartes, seulement comment afficher/faire disparaître le bandeau et le confetti.
function showCelebrationBanner(innerHtml) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const banner = document.createElement('div');
    banner.className = 'app-celebration-banner';
    banner.innerHTML = innerHtml;
    document.body.appendChild(banner);
    requestAnimationFrame(() => banner.classList.add('show'));

    spawnCelebrationConfetti();

    setTimeout(() => {
        banner.classList.remove('show');
        setTimeout(() => banner.remove(), 500);
    }, 2600);
}

// Confetti aux couleurs de la marque (or/parchemin/vert succès - jamais arc-en-ciel), partant du
// centre-haut du viewport où atterrit .app-celebration-banner. Canvas créé/détruit à chaque appel
// (pas d'état partagé à gérer entre deux célébrations qui pourraient se chevaucher).
function spawnCelebrationConfetti() {
    const canvas = document.createElement('canvas');
    canvas.className = 'app-celebration-canvas';
    const ratio = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * ratio;
    canvas.height = window.innerHeight * ratio;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);

    const colors = ['227,188,132', '244,199,102', '126,217,167', '247,243,234'];
    const originX = window.innerWidth / 2;
    const originY = 110;
    const particles = Array.from({ length: 70 }, () => ({
        x: originX + (Math.random() - 0.5) * 140,
        y: originY + (Math.random() - 0.5) * 20,
        vx: (Math.random() - 0.5) * 4.5,
        vy: -3 - Math.random() * 3,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.35,
        size: 4 + Math.random() * 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        life: 1,
        decay: 0.006 + Math.random() * 0.006
    }));

    function frame() {
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        let alive = false;
        particles.forEach(p => {
            if (p.life <= 0) return;
            alive = true;
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.11;
            p.rot += p.vr;
            p.life -= p.decay;
            ctx.save();
            ctx.globalAlpha = Math.max(p.life, 0);
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.fillStyle = `rgb(${p.color})`;
            ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
            ctx.restore();
        });
        ctx.globalAlpha = 1;
        if (alive) requestAnimationFrame(frame);
        else canvas.remove();
    }
    requestAnimationFrame(frame);
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
window.formatPublicMemberSince = formatPublicMemberSince;
window.renderSectionSafe = renderSectionSafe;
window.runSafe = runSafe;
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
window.getSetOwnedCount = getSetOwnedCount;
window.getSetTotalCount = getSetTotalCount;
window.celebrateCardAdded = celebrateCardAdded;
window.captureCardAddOrigin = captureCardAddOrigin;
window.captureCardAddSource = captureCardAddSource;
window.showCelebrationBanner = showCelebrationBanner;
window.spawnCelebrationConfetti = spawnCelebrationConfetti;
window.findCollectionNavTarget = findCollectionNavTarget;
window.spawnAddSparks = spawnAddSparks;
window.flyGhostCard = flyGhostCard;
window.popNavToast = popNavToast;
window.normalizeForMatch = normalizeForMatch;
window.getCardmarketSearchUrl = getCardmarketSearchUrl;
window.getCardmarketUrl = getCardmarketUrl;
window.RARITY_ICON_MAP = RARITY_ICON_MAP;
window.isHighRarityCard = isHighRarityCard;
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

// Exports pour les tests unitaires (Vitest, cf vitest.config.js) uniquement - purement additif : une
// instruction export dans un module déjà chargé en <script type="module"> par le navigateur n'a aucun
// effet sur ce qui s'exécute côté client, les window.X = X ci-dessus restent la seule chose qui compte
// pour l'app elle-même.
export { formatPrice, getMarketValueForFinish, escapeHtml };
