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
const DASHBOARD_COLLECTORS_RESULT_LIMIT = 5;

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

function renderCollectorsError(container) {
    container.innerHTML = '<p class="collectors-state-text collectors-state-error"><i class="ti ti-alert-circle" aria-hidden="true"></i> Erreur de recherche, réessaie.</p>';
}

function renderCollectorsNoResults(container) {
    container.innerHTML = '<p class="collectors-state-text"><i class="ti ti-user-question" aria-hidden="true"></i> Aucun collectionneur trouvé.</p>';
}

function renderCollectorsNoPublicProfiles(container) {
    container.innerHTML = '<p class="collectors-state-text"><i class="ti ti-users-group" aria-hidden="true"></i> Aucun profil public pour l\'instant.</p>';
}

// Chaque résultat est un <a href="#/user/..."> natif : entièrement cliquable, s'appuie sur le routeur
// hashchange existant, aucun onclick/handler JS supplémentaire nécessaire. Ligne complète (vue #/collectors).
function renderCollectorsResults(container, profiles) {
    container.innerHTML = profiles.map(p => `
        <a href="#/user/${encodeURIComponent(p.username)}" class="collectors-result-row">
            ${profileAvatarHtml(p, 44)}
            <div class="collectors-result-identity">
                <div class="collectors-result-pseudo">${escapeHtml(p.pseudo || p.username)}</div>
                <div class="collectors-result-username">@${escapeHtml(p.username)}</div>
                ${p.created_at ? `<div class="collectors-result-since">${formatPublicMemberSince(p.created_at)}</div>` : ''}
            </div>
            <i class="ti ti-chevron-right collectors-result-chevron" aria-hidden="true"></i>
        </a>
    `).join('');
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
}

// Contrôleur de recherche réutilisable : encapsule debounce, minimum de caractères, anti-réponse
// obsolète (requestId) et gestion d'erreur — la partie subtile que Ticket précédent ne voulait pas
// voir dupliquée. Instance dédiée par appelant (closures, pas de globals partagés) : la vue #/collectors
// et le bloc Dashboard tournent chacun leur propre timer/requestId sans jamais se marcher dessus, même
// si les deux venaient à exister simultanément dans le DOM. Chaque appelant fournit seulement ses
// callbacks de rendu (les deux vues affichent des choses visuellement différentes).
function createCollectorsSearchController({ limit = COLLECTORS_RESULT_LIMIT, onHint, onLoading, onError, onNoResults, onResults }) {
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
        onResults(profiles);
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
function createDefaultCollectorsLoader({ limit, containerId, renderResults }) {
    let profiles = null; // null = pas encore chargé / erreur, [] = chargé mais vide
    let hasError = false;

    async function load() {
        const container = document.getElementById(containerId);
        renderCollectorsLoading(container);

        try {
            const { data, error } = await supabaseClient
                .from('profiles_public')
                .select('id, username, pseudo, avatar_url, created_at')
                .eq('is_public', true)
                .not('username', 'is', null)
                .order('created_at', { ascending: false })
                .limit(limit);
            if (error) throw error;
            profiles = data || [];
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
        renderResults(container, profiles);
    }

    return { load, renderFromCache };
}

// ===== Vue #/collectors (page complète, limite 20) =====

const collectorsPageDefaultLoader = createDefaultCollectorsLoader({
    limit: COLLECTORS_RESULT_LIMIT,
    containerId: 'collectors-search-results',
    renderResults: renderCollectorsResults
});

const collectorsPageSearchController = createCollectorsSearchController({
    limit: COLLECTORS_RESULT_LIMIT,
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
    onResults: (profiles) => renderCollectorsResults(document.getElementById('collectors-search-results'), profiles)
});

function onCollectorsSearchInput() {
    collectorsPageSearchController.handleInput(document.getElementById('collectors-search-input')?.value);
}

// Appelée à chaque activation de l'onglet (tracker.js:activateTabContent) : repart toujours d'un champ
// vide et recharge la liste par défaut (plutôt que de conserver une recherche précédente entre deux
// visites de la vue).
function resetCollectorsSearchView() {
    const input = document.getElementById('collectors-search-input');
    if (input) input.value = '';
    collectorsPageSearchController.reset();
    collectorsPageDefaultLoader.load();
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
window.renderCollectorsError = renderCollectorsError;
window.renderCollectorsNoResults = renderCollectorsNoResults;
window.renderCollectorsNoPublicProfiles = renderCollectorsNoPublicProfiles;
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
