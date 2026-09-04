// Recherche de collectionneurs (Phase 3) - Pokémon Tracker
// Dépend de: supabaseClient (tracker.js), escapeHtml (utils.js), profileAvatarHtml (modules/profile.js),
// formatPublicMemberSince (modules/public-profile.js)
// Route #/collectors, entrée fixe de TAB_ROUTES (tracker.js) — contrairement à #/user/<username>,
// aucune donnée à résoudre pour afficher le shell : tout est statique dans index.html, seul le
// conteneur de résultats est peuplé dynamiquement ici.
// Lecture seule stricte : uniquement profiles_public, jamais la table privée profiles, jamais
// get_cards_public/get_wishlists_public/get_wishlist_items_public (pas de N+1 par résultat).
// Bloc "Trouver un collectionneur" du Dashboard (modules/dashboard.js:renderDashboardCollectorsSearch) :
// même moteur de recherche (searchPublicCollectors + createCollectorsSearchController), pas de seconde
// implémentation — seuls la limite de résultats et le rendu compact diffèrent.
// Etat possédé : collectorsPageSearchController, dashboardCollectorsSearchController (chacun encapsule
// son propre timer/requestId, aucun global partagé entre les deux instances)

const COLLECTORS_MIN_QUERY_LENGTH = 2;
const COLLECTORS_DEBOUNCE_MS = 300;
const COLLECTORS_RESULT_LIMIT = 20;
// 5 -> 12 (retour utilisateur 2026-09, contenu adaptatif des cards Dashboard) : plafond de sécurité
// généreux, comme les autres widgets-listes - dashboardTrimListToFit (dashboard.js, cf
// renderDashboardCollectorsResults) retire ensuite ce qui ne rentre pas réellement dans la carte.
const DASHBOARD_COLLECTORS_RESULT_LIMIT = 12;

// Echappe les jokers ILIKE (% _ \) : la saisie utilisateur ne doit jamais agir comme un joker de
// recherche non voulu (même principe que public-profile.js pour la résolution de username).
function escapeCollectorsIlike(value) {
    return value.replace(/[%_\\]/g, '\\$&');
}

// Coeur de recherche partagé (Option A) : pure, sans effet de bord, réutilisée telle quelle par la
// vue #/collectors et par le bloc Dashboard. Deux requêtes séparées (username, pseudo) plutôt qu'un
// unique .or(...) : la valeur de recherche est interpolée telle quelle dans le filtre PostgREST, où
// virgules/parenthèses ont un sens syntaxique — un utilisateur tapant "a,b" y casserait la structure
// de la requête .or(). Le pire cas resterait une requête malformée/erreur (RLS reste la vraie barrière,
// aucune fuite possible), mais deux requêtes séparées évitent complètement cette classe de fragilité.
async function searchPublicCollectors(rawQuery, { limit = COLLECTORS_RESULT_LIMIT } = {}) {
    const pattern = `%${escapeCollectorsIlike(rawQuery)}%`;
    const columns = 'id, username, pseudo, avatar_url, created_at';

    const [byUsername, byPseudo] = await Promise.all([
        supabaseClient.from('profiles_public').select(columns).ilike('username', pattern).limit(limit),
        supabaseClient.from('profiles_public').select(columns).ilike('pseudo', pattern).limit(limit)
    ]);

    if (byUsername.error) throw byUsername.error;
    if (byPseudo.error) throw byPseudo.error;

    const merged = new Map();
    [...(byUsername.data || []), ...(byPseudo.data || [])].forEach(p => merged.set(p.id, p));

    return [...merged.values()]
        .sort((a, b) => (a.username || '').localeCompare(b.username || ''))
        .slice(0, limit);
}

function renderCollectorsHint(container, text) {
    container.innerHTML = `<p class="collectors-state-text">${text}</p>`;
}

function renderCollectorsLoading(container) {
    container.innerHTML = '<p class="collectors-state-text"><span class="loading"></span> Recherche...</p>';
}

// Silhouette du chargement initial de la page #/collectors (retour utilisateur 2026-09, audit design) :
// reprend la forme réelle de .collectors-result-row (avatar 56px + deux lignes de texte, cf
// renderCollectorsResults) plutôt que le texte "Recherche..." partagé ci-dessus - celui-ci reste
// utilisé pour la recherche (déclenchée par une frappe, contexte différent : l'utilisateur vient de
// taper, un texte compact suffit) et pour le widget compact du Dashboard (avatars 32px, jamais cette
// silhouette calée sur 56px). N'inclut jamais les badges de signal d'échange (asymétriques par carte,
// une forme fixe donnerait une fausse impression de contenu déjà connu).
function renderCollectorsLoadingSkeleton(container, count = 4) {
    container.innerHTML = Array.from({ length: count }).map(() => `
        <div class="collectors-result-row">
            <div class="skeleton" style="width:56px; height:56px; border-radius:50%; flex-shrink:0;"></div>
            <div class="collectors-result-identity">
                <div class="skeleton" style="height:14px; width:40%; margin-bottom:8px;"></div>
                <div class="skeleton" style="height:11px; width:25%;"></div>
            </div>
        </div>
    `).join('');
}

function renderCollectorsError(container) {
    container.innerHTML = '<p class="collectors-state-text collectors-state-error"><i class="ti ti-alert-circle" aria-hidden="true"></i> Erreur de recherche, réessaie.</p>';
}

function renderCollectorsNoResults(container) {
    container.innerHTML = '<p class="collectors-state-text"><i class="ti ti-user-question" aria-hidden="true"></i> Aucun collectionneur trouvé.</p>';
}

// Vraiment aucun collectionneur public sur toute la plateforme (pas une recherche sans résultat,
// cf renderCollectorsNoResults juste au-dessus qui reste un texte simple) -> état illustré partagé.
function renderCollectorsNoPublicProfiles(container) {
    container.innerHTML = `
        <div class="app-empty-state">
            <svg class="app-empty-icon" viewBox="0 0 100 100" aria-hidden="true">
                <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" stroke-width="3"/>
                <line x1="10" y1="50" x2="90" y2="50" stroke="currentColor" stroke-width="3"/>
                <circle cx="50" cy="50" r="13" fill="none" stroke="currentColor" stroke-width="3"/>
                <circle cx="50" cy="50" r="4" fill="currentColor"/>
            </svg>
            <div class="app-empty-title">Aucun profil public pour l'instant</div>
            <p class="app-empty-text">Reviens plus tard : les collectionneurs qui rendent leur profil public apparaîtront ici.</p>
        </div>
    `;
}

// Phase 5 (P5-3) : un seul appel RPC pour tout le lot de profils déjà chargés (jamais un appel par
// profil - cf audit Phase 5 §7/§10, get_collector_trade_signals conçue exactement pour ce lot borné,
// P5-2). Échec réseau/RPC : dégradation silencieuse (Map vide -> aucun badge affiché) plutôt que casser
// l'affichage de la liste elle-même, cohérent avec le reste du fichier (cf onError des contrôleurs).
async function fetchCollectorTradeSignals(profiles) {
    const ids = (profiles || []).map(p => p.id).filter(Boolean);
    if (ids.length === 0) return new Map();

    try {
        const { data, error } = await supabaseClient.rpc('get_collector_trade_signals', { p_target_ids: ids });
        if (error) throw error;
        return new Map((data || []).map(row => [row.user_id, row]));
    } catch (error) {
        console.error('Erreur signaux d\'échange collecteurs:', error);
        return new Map();
    }
}

// Tri par opportunité (Phase 5, P5-3) : critères explicites déjà calculés par la RPC, jamais un score
// composite (cf audit - une "compatibilité 87%" a été explicitement écartée). Réciproque d'abord, puis
// ce que l'autre a pour moi, puis ce que j'ai pour lui. Un profil absent de signalsMap (self exclu,
// profil/collection/wishlist privé côté RPC, ou échec réseau) est traité comme {0,0,false} : Array.sort
// étant stable, ces profils gardent leur ordre d'origine entre eux - dégradation naturelle vers le tri
// existant (date d'inscription / pertinence recherche) sans code spécifique pour ce cas (audit §11).
function sortCollectorsByOpportunity(profiles, signalsMap) {
    const getSignal = (p) => signalsMap.get(p.id) || { for_me_count: 0, for_them_count: 0, is_reciprocal: false };

    return [...profiles].sort((a, b) => {
        const sa = getSignal(a);
        const sb = getSignal(b);
        if (sa.is_reciprocal !== sb.is_reciprocal) return sa.is_reciprocal ? -1 : 1;
        if (sa.for_me_count !== sb.for_me_count) return sb.for_me_count - sa.for_me_count;
        if (sa.for_them_count !== sb.for_them_count) return sb.for_them_count - sa.for_them_count;
        return 0;
    });
}

// Signal directionnel (retour utilisateur 2026-09, audit design - maquette "Refonte Cartes
// Collectionneurs" validée) : les comptes pour/contre deviennent des flèches ↓/↑ plutôt que deux
// badges texte au même poids que "Match réciproque", pour que le sens de l'échange se lise d'un
// coup d'œil. Chiffres explicites (jamais un score), un seul appel par ligne à la Map déjà résolue -
// aucune requête ici. signal undefined (profil hors signalsMap, cf sortCollectorsByOpportunity) ->
// rien affiché, jamais un badge "0" trompeur.
function renderCollectorSignalBadges(signal) {
    if (!signal) return '';

    const arrows = [];
    if (signal.for_me_count > 0) {
        // "toi" (pas "vous") : aligné sur le registre déjà établi côté profil public pour ce même
        // signal ("Ce qu'il peut te proposer", modules/public-profile.js) - trouvé en audit P5-5,
        // incohérence de tutoiement/vouvoiement sur la même information entre les deux écrans.
        arrows.push(`<span class="collectors-signal-badge collectors-signal-for-me"><i class="ti ti-arrow-down" aria-hidden="true"></i> ${signal.for_me_count} pour toi</span>`);
    }
    if (signal.for_them_count > 0) {
        arrows.push(`<span class="collectors-signal-badge collectors-signal-for-them"><i class="ti ti-arrow-up" aria-hidden="true"></i> ${signal.for_them_count} pour lui</span>`);
    }
    const arrowsHtml = arrows.length > 0 ? `<div class="collectors-result-signals">${arrows.join('')}</div>` : '';

    // Pill séparée (pas dans le même flux que les flèches) : reste le signal le plus fort de la
    // carte, un match réciproque mérite de se voir même si l'écran est étroit et que le reste wrap.
    const reciprocalHtml = signal.is_reciprocal
        ? '<div class="collectors-signal-badge collectors-signal-reciprocal collectors-reciprocal-standalone"><i class="ti ti-repeat" aria-hidden="true"></i> Match réciproque</div>'
        : '';

    return arrowsHtml + reciprocalHtml;
}

// Niveau B (mémoire collectors_redesign_tier_b_deferred, validé le 2026-09-03) : jusqu'à 3 vignettes
// de la collection de la cible, déjà renvoyées par get_collector_trade_signals (preview_images,
// migration 2026-09-03_collector_preview_images.sql) - aucun appel réseau supplémentaire ici. 0 à 3
// images selon ce que la RPC a trouvé (collection masquée ou vide -> tableau vide, rien affiché).
function renderCollectorPreviewThumbnails(signal) {
    const images = signal?.preview_images;
    if (!images || images.length === 0) return '';

    return `
        <div class="collectors-result-preview">
            ${images.map(url => `<img src="${escapeHtml(url)}" alt="" loading="lazy" class="collectors-result-preview-thumb">`).join('')}
        </div>
    `;
}

// VT4 (cf roadmap technique animations premium) : clic normal (même onglet, bouton gauche, sans
// modificateur) sur une carte Collecteur -> prépare un shell + avatar partagé pour le profil public
// ciblé, consommés par modules/public-profile.js#loadPublicProfile et tracker.js (choix de la
// transition 'profile-open'). Un clic modifié (Ctrl/Cmd/Maj/Alt/bouton non-gauche, ex. nouvel onglet)
// ne doit rien préparer et laisser le lien natif faire son travail normal - jamais de preventDefault.
// Données lues directement sur l'ancre (data-collector-*) plutôt que reconstruites : uniquement ce
// que la liste Collecteurs affiche déjà, aucun nouvel appel réseau.
function handleCollectorProfileClick(event, anchorEl) {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
        return;
    }
    if (typeof prepareCollectorProfileTransition !== 'function') return;

    prepareCollectorProfileTransition(anchorEl.getAttribute('href'), {
        id: anchorEl.dataset.collectorId,
        avatar_url: anchorEl.dataset.collectorAvatarUrl || null,
        pseudo: anchorEl.dataset.collectorPseudo,
        username: anchorEl.dataset.collectorUsername,
        created_at: anchorEl.dataset.collectorCreatedAt || null
    });
}

// Chaque résultat est un <a href="#/user/..."> natif : entièrement cliquable, s'appuie sur le routeur
// hashchange existant. Ligne complète (vue #/collectors) - seule cette variante prépare la transition
// VT4 (data-collector-id sert aussi à retrouver l'avatar source réellement visible au moment où la
// transition démarre, cf tracker.js#runProfileOpenTransition) ; la variante compacte Dashboard
// (renderDashboardCollectorsResults, ci-dessous) n'est volontairement pas concernée, cf audit VT4 -
// même rendu visuel mais fonction de template distincte, hors scope de ce ticket.
// signalsMap (Phase 5, P5-3) : optionnel, défaut vide - la variante Dashboard n'affiche jamais de
// badges, seule la page #/collectors complète les demande (withTradeSignals, plus bas).
function renderCollectorsResults(container, profiles, signalsMap = new Map()) {
    container.innerHTML = profiles.map(p => {
        const signal = signalsMap.get(p.id);
        return `
        <a href="#/user/${encodeURIComponent(p.username)}" class="collectors-result-row${signal?.is_reciprocal ? ' collectors-result-row-reciprocal' : ''}"
            data-collector-id="${p.id}"
            data-collector-avatar-url="${p.avatar_url ? escapeHtml(p.avatar_url) : ''}"
            data-collector-pseudo="${escapeHtml(p.pseudo || p.username)}"
            data-collector-username="${escapeHtml(p.username)}"
            data-collector-created-at="${p.created_at || ''}"
            onclick="handleCollectorProfileClick(event, this)">
            ${profileAvatarHtml(p, 56)}
            <div class="collectors-result-identity">
                <div class="collectors-result-pseudo">${escapeHtml(p.pseudo || p.username)}</div>
                <div class="collectors-result-username">@${escapeHtml(p.username)}</div>
                ${p.created_at ? `<div class="collectors-result-since">${formatPublicMemberSince(p.created_at)}</div>` : ''}
                ${renderCollectorSignalBadges(signal)}
            </div>
            ${renderCollectorPreviewThumbnails(signal)}
            <i class="ti ti-chevron-right collectors-result-chevron" aria-hidden="true"></i>
        </a>
    `;
    }).join('');
}

// Variante compacte (bloc Dashboard) : avatar + pseudo + @username uniquement, pas de date d'arrivée
// ni de chevron — reste secondaire visuellement par rapport au reste du Dashboard.
function renderDashboardCollectorsResults(container, profiles) {
    container.innerHTML = profiles.map(p => `
        <a href="#/user/${encodeURIComponent(p.username)}" class="collectors-result-row collectors-result-row-compact">
            ${profileAvatarHtml(p, 32)}
            <div class="collectors-result-identity">
                <div class="collectors-result-pseudo">${escapeHtml(p.pseudo || p.username)}</div>
                <div class="collectors-result-username">@${escapeHtml(p.username)}</div>
            </div>
        </a>
    `).join('');
    // Contenu adaptatif à la taille de la carte (retour utilisateur 2026-09, même mécanisme que les
    // autres widgets-listes du Dashboard, cf dashboardTrimListToFit dans modules/dashboard.js).
    window.dashboardTrimListToFit(container, '.collectors-result-row');
}

// Contrôleur de recherche réutilisable : encapsule debounce, minimum de caractères, anti-réponse
// obsolète (requestId) et gestion d'erreur — la partie subtile que Ticket précédent ne voulait pas
// voir dupliquée. Instance dédiée par appelant (closures, pas de globals partagés) : la vue #/collectors
// et le bloc Dashboard tournent chacun leur propre timer/requestId sans jamais se marcher dessus, même
// si les deux venaient à exister simultanément dans le DOM. Chaque appelant fournit seulement ses
// callbacks de rendu (les deux vues affichent des choses visuellement différentes).
function createCollectorsSearchController({ limit = COLLECTORS_RESULT_LIMIT, withTradeSignals = false, onHint, onLoading, onError, onNoResults, onResults }) {
    let timer = null;
    let requestId = 0;

    async function run(query) {
        const myRequestId = requestId;
        onLoading();

        let profiles;
        try {
            profiles = await searchPublicCollectors(query, { limit });
        } catch (error) {
            if (myRequestId !== requestId) return; // une saisie plus récente a déjà pris le relais
            console.error('Erreur recherche collectionneurs:', error);
            onError();
            return;
        }

        if (myRequestId !== requestId) return;

        if (profiles.length === 0) {
            onNoResults();
            return;
        }

        // Phase 5 (P5-3) : second aller-retour async (RPC signaux) - re-vérifié après coup, une saisie
        // plus récente a pu invalider requestId pendant l'attente, exactement comme pour searchPublicCollectors
        // ci-dessus.
        const signalsMap = withTradeSignals ? await fetchCollectorTradeSignals(profiles) : new Map();
        if (myRequestId !== requestId) return;

        const sorted = withTradeSignals ? sortCollectorsByOpportunity(profiles, signalsMap) : profiles;
        onResults(sorted, signalsMap);
    }

    function handleInput(rawValue) {
        clearTimeout(timer);
        requestId++; // invalide toute recherche en vol dont le résultat ne correspond plus à la saisie actuelle

        const value = (rawValue || '').trim();

        if (value.length === 0) {
            onHint('');
            return;
        }
        if (value.length < COLLECTORS_MIN_QUERY_LENGTH) {
            onHint(`Tape au moins ${COLLECTORS_MIN_QUERY_LENGTH} caractères...`);
            return;
        }

        timer = setTimeout(() => run(value), COLLECTORS_DEBOUNCE_MS);
    }

    function reset() {
        clearTimeout(timer);
        requestId++;
        onHint('');
    }

    return { handleInput, reset };
}

// Liste par défaut (profils publics, hors recherche), factorisée : la vue #/collectors (limite 20)
// et le bloc Dashboard (limite 5) partagent la même logique de chargement/cache, seuls le conteneur
// cible, la limite et le renderer de résultat diffèrent. Cache mémoire par instance (pas de re-requête
// réseau à chaque vidage du champ de recherche).
//
// Tri created_at desc : les profils les plus récents en tête, cohérent avec l'idée de "découvrir" de
// nouveaux collectionneurs. is_public=true explicite malgré la RLS déjà restrictive sur profiles_public
// (policy "select public profiles" OR "select own profile") : sans ce filtre, le propre profil de
// l'utilisateur connecté remonterait dans la liste "publique" même s'il est resté privé. username non
// null requis : un profil public sans username n'a pas d'URL #/user/<username> valide à afficher ici.
// renderLoading (retour utilisateur 2026-09, audit design) : optionnel, replie sur le texte
// "Recherche..." partagé si absent (comportement inchangé pour le loader Dashboard, qui ne le passe
// pas) - seule la vue #/collectors passe renderCollectorsLoadingSkeleton (silhouette calée sur la vraie
// forme des cartes, plus appropriée pour un premier chargement de page que pour le petit widget compact.
function createDefaultCollectorsLoader({ limit, containerId, renderResults, withTradeSignals = false, renderLoading = renderCollectorsLoading }) {
    let profiles = null; // null = pas encore chargé / erreur, [] = chargé mais vide
    let signalsMap = new Map();
    let hasError = false;

    async function load() {
        const container = document.getElementById(containerId);
        renderLoading(container);

        try {
            const { data, error } = await supabaseClient
                .from('profiles_public')
                .select('id, username, pseudo, avatar_url, created_at')
                .eq('is_public', true)
                .not('username', 'is', null)
                .order('created_at', { ascending: false })
                .limit(limit);
            if (error) throw error;

            // Phase 5 (P5-3) : signaux + tri résolus une seule fois ici et mis en cache avec les profils
            // (pas à chaque renderFromCache) - withTradeSignals=false pour le loader Dashboard, qui
            // n'appelle jamais get_collector_trade_signals.
            signalsMap = withTradeSignals ? await fetchCollectorTradeSignals(data || []) : new Map();
            profiles = withTradeSignals ? sortCollectorsByOpportunity(data || [], signalsMap) : (data || []);
            hasError = false;
        } catch (error) {
            console.error('Erreur chargement profils publics:', error);
            profiles = null;
            hasError = true;
        }

        renderFromCache();
    }

    function renderFromCache() {
        const container = document.getElementById(containerId);
        if (hasError) {
            renderCollectorsError(container);
            return;
        }
        if (profiles === null) {
            renderCollectorsLoading(container);
            return;
        }
        if (profiles.length === 0) {
            renderCollectorsNoPublicProfiles(container);
            return;
        }
        renderResults(container, profiles, signalsMap);
    }

    return { load, renderFromCache };
}

// ===== Vue #/collectors (page complète, limite 20) =====

// withTradeSignals: true uniquement ici (page #/collectors) - le widget Dashboard plus bas n'active
// jamais get_collector_trade_signals, cohérent avec le scope P5-3 ("page Collecteurs").
const collectorsPageDefaultLoader = createDefaultCollectorsLoader({
    limit: COLLECTORS_RESULT_LIMIT,
    containerId: 'collectors-search-results',
    renderResults: renderCollectorsResults,
    withTradeSignals: true,
    renderLoading: (container) => renderCollectorsLoadingSkeleton(container, 4)
});

const collectorsPageSearchController = createCollectorsSearchController({
    limit: COLLECTORS_RESULT_LIMIT,
    withTradeSignals: true,
    // Champ vidé (text === '') : réafficher la liste par défaut depuis le cache plutôt qu'un état
    // vide. Saisie à 1 caractère (text = hint réel) : garder le hint compact, ne pas toucher au cache.
    onHint: (text) => {
        if (text === '') {
            collectorsPageDefaultLoader.renderFromCache();
        } else {
            renderCollectorsHint(document.getElementById('collectors-search-results'), text);
        }
    },
    onLoading: () => renderCollectorsLoading(document.getElementById('collectors-search-results')),
    onError: () => renderCollectorsError(document.getElementById('collectors-search-results')),
    onNoResults: () => renderCollectorsNoResults(document.getElementById('collectors-search-results')),
    onResults: (profiles, signalsMap) => renderCollectorsResults(document.getElementById('collectors-search-results'), profiles, signalsMap)
});

function onCollectorsSearchInput() {
    collectorsPageSearchController.handleInput(document.getElementById('collectors-search-input')?.value);
}

// Appelée à chaque activation de l'onglet (tracker.js:activateTabContent) : repart toujours d'un champ
// vide et recharge la liste par défaut (plutôt que de conserver une recherche précédente entre deux
// visites de la vue). Retourne la Promise de chargement (retour utilisateur 2026-09) : activateTabContent
// l'agrège avec les autres onglets pour piloter la barre de progression de navigation - ce chargement
// tournait déjà en async, seule la valeur de retour manquait pour que l'appelant puisse l'attendre.
function resetCollectorsSearchView() {
    const input = document.getElementById('collectors-search-input');
    if (input) input.value = '';
    collectorsPageSearchController.reset();
    return collectorsPageDefaultLoader.load();
}

// ===== Bloc Dashboard "Trouver un collectionneur" (limite 5, rendu compact) =====
// Shell HTML (titre/sous-titre/input/lien "Voir tout") construit par modules/dashboard.js:
// renderDashboardCollectorsSearch — ce fichier ne gère que la logique de recherche elle-même.
// renderDashboardCollectorsSearch appelle dashboardCollectorsDefaultLoader.load() juste après avoir
// injecté le shell (le conteneur #dashboard-collectors-results doit exister dans le DOM avant).

const dashboardCollectorsDefaultLoader = createDefaultCollectorsLoader({
    limit: DASHBOARD_COLLECTORS_RESULT_LIMIT,
    containerId: 'dashboard-collectors-results',
    renderResults: renderDashboardCollectorsResults
});

const dashboardCollectorsSearchController = createCollectorsSearchController({
    limit: DASHBOARD_COLLECTORS_RESULT_LIMIT,
    onHint: (text) => {
        if (text === '') {
            dashboardCollectorsDefaultLoader.renderFromCache();
        } else {
            renderCollectorsHint(document.getElementById('dashboard-collectors-results'), text);
        }
    },
    onLoading: () => renderCollectorsLoading(document.getElementById('dashboard-collectors-results')),
    onError: () => renderCollectorsError(document.getElementById('dashboard-collectors-results')),
    onNoResults: () => renderCollectorsNoResults(document.getElementById('dashboard-collectors-results')),
    onResults: (profiles) => renderDashboardCollectorsResults(document.getElementById('dashboard-collectors-results'), profiles)
});

function onDashboardCollectorsSearchInput() {
    dashboardCollectorsSearchController.handleInput(document.getElementById('dashboard-collectors-input')?.value);
}

// ===== Exports window (ticket V2 Vite, type="module") =====
// Les déclarations top-level d'un module ES ne s'attachent plus automatiquement à window
// (contrairement à un <script> classique) : réexport explicite pour que les autres scripts
// (chargés en modules indépendants, sans import/export entre eux, scope global inchangé)
// puissent continuer à référencer ces noms tels quels — y compris depuis des onclick="..."
// inline dans du HTML généré. Liste exhaustive des déclarations top-level de ce fichier
// (hors variables déjà passées en window.x = ... directement à leur déclaration, cf audit
// du 2026-08-14 sur l'état mutable partagé entre fichiers).
window.COLLECTORS_MIN_QUERY_LENGTH = COLLECTORS_MIN_QUERY_LENGTH;
window.COLLECTORS_DEBOUNCE_MS = COLLECTORS_DEBOUNCE_MS;
window.COLLECTORS_RESULT_LIMIT = COLLECTORS_RESULT_LIMIT;
window.DASHBOARD_COLLECTORS_RESULT_LIMIT = DASHBOARD_COLLECTORS_RESULT_LIMIT;
window.escapeCollectorsIlike = escapeCollectorsIlike;
window.searchPublicCollectors = searchPublicCollectors;
window.renderCollectorsHint = renderCollectorsHint;
window.renderCollectorsLoading = renderCollectorsLoading;
window.renderCollectorsLoadingSkeleton = renderCollectorsLoadingSkeleton;
window.renderCollectorsError = renderCollectorsError;
window.renderCollectorsNoResults = renderCollectorsNoResults;
window.fetchCollectorTradeSignals = fetchCollectorTradeSignals;
window.sortCollectorsByOpportunity = sortCollectorsByOpportunity;
window.renderCollectorSignalBadges = renderCollectorSignalBadges;
window.renderCollectorsNoPublicProfiles = renderCollectorsNoPublicProfiles;
window.handleCollectorProfileClick = handleCollectorProfileClick;
window.renderCollectorsResults = renderCollectorsResults;
window.renderDashboardCollectorsResults = renderDashboardCollectorsResults;
window.createCollectorsSearchController = createCollectorsSearchController;
window.createDefaultCollectorsLoader = createDefaultCollectorsLoader;
window.collectorsPageDefaultLoader = collectorsPageDefaultLoader;
window.collectorsPageSearchController = collectorsPageSearchController;
window.onCollectorsSearchInput = onCollectorsSearchInput;
window.resetCollectorsSearchView = resetCollectorsSearchView;
window.dashboardCollectorsDefaultLoader = dashboardCollectorsDefaultLoader;
window.dashboardCollectorsSearchController = dashboardCollectorsSearchController;
window.onDashboardCollectorsSearchInput = onDashboardCollectorsSearchInput;
