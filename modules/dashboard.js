// Onglet Dashboard - Pokémon Tracker
// Dépend de: allCollectionCards/supabaseClient/allWishlistItems/allTcgdexSeries/dashboardNeedsRefresh/wishlistPriceSignalMap (tracker.js/wishlist.js/progression.js),
// escapeHtml/getSetIdFromTcgdexId (utils.js), showCardDetail (card-detail.js), openSetProgression/fetchSetCardsDetailed/computeSetCompletionBudget (progression.js),
// activateTabContent (tracker.js), Chart
// Exécute fn et attrape toute erreur pour qu'une section en échec n'empêche pas le reste du Dashboard
// de s'afficher (le conteneur reçoit un message d'erreur discret à la place)
function dashboardRenderSafe(containerId, fn) {
    try {
        fn();
    } catch (error) {
        console.error(`Erreur de rendu Dashboard (${containerId}):`, error);
        const el = document.getElementById(containerId);
        if (el) el.innerHTML = '<p class="dashboard-error-text">Section indisponible</p>';
    }
}

async function renderDashboard() {
    if (!document.getElementById('dashboard-header')) return; // onglet pas encore présent dans le DOM

    if (!dashboardNeedsRefresh) return;

    dashboardBuildSkeleton();

    dashboardRenderSafe('dashboard-header', renderDashboardHeader);

    dashboardRenderSafe('dashboard-hero', renderDashboardHero);
    dashboardRenderSafe('dashboard-kpis', renderDashboardKpis);
    dashboardRenderSafe('dashboard-activity-body', renderDashboardActivity);
    dashboardRenderSafe('dashboard-objective-body', renderDashboardObjective);
    dashboardRenderSafe('dashboard-movers-body', renderDashboardTopMovers);
    dashboardRenderSafe('dashboard-acquisitions-body', renderDashboardAcquisitions);
    dashboardRenderSafe('dashboard-todo-body', renderDashboardTodo);
    dashboardRenderSafe('dashboard-wishlist-body', renderDashboardWishlist);
    dashboardRenderSafe('dashboard-collectors-body', renderDashboardCollectorsSearch);

    dashboardNeedsRefresh = false;
}

// Structure fixe des 3 zones (header/hero à part, KPI, grille principale, grille basse) : construite une
// seule fois par recalcul, chaque section remplit ensuite juste son propre conteneur interne
function dashboardBuildSkeleton() {
    document.getElementById('dashboard-main-grid').innerHTML = `
        <div class="dashboard-widget dashboard-widget-activity">
            <div class="dashboard-widget-header"><h3>Activité récente</h3></div>
            <div id="dashboard-activity-body"></div>
        </div>
        <div class="dashboard-widget dashboard-widget-objective">
            <div class="dashboard-widget-header"><h3>Objectif actuel</h3></div>
            <div id="dashboard-objective-body"></div>
        </div>
        <div class="dashboard-widget dashboard-widget-tall">
            <div class="dashboard-widget-header"><h3>Wishlist à surveiller</h3><button class="dashboard-widget-link" onclick="navigateToTab('tab-wishlist')">Voir tout</button></div>
            <div id="dashboard-wishlist-body"></div>
        </div>
        <div class="dashboard-widget">
            <div class="dashboard-widget-header"><h3>Dernières acquisitions</h3><button class="dashboard-widget-link" onclick="navigateToTab('tab-collection')">Voir tout</button></div>
            <div id="dashboard-acquisitions-body"></div>
        </div>
        <div class="dashboard-widget">
            <div class="dashboard-widget-header"><h3>À faire aujourd'hui</h3></div>
            <div id="dashboard-todo-body"></div>
        </div>
        <div class="dashboard-widget">
            <div class="dashboard-widget-header"><h3>Trouver un collectionneur</h3><button class="dashboard-widget-link" onclick="navigateToTab('tab-collectors')">Voir tout</button></div>
            <div id="dashboard-collectors-body"></div>
        </div>
        <div class="dashboard-widget dashboard-widget-full" id="dashboard-widget-movers" style="display:none;">
            <div class="dashboard-widget-header"><h3>Top hausses</h3></div>
            <div id="dashboard-movers-body"></div>
        </div>
    `;
}

function dashboardGoToProgressionSet(setId, setName, logoUrl) {
    navigateToTab('tab-progression');
    openSetProgression(setId, setName, logoUrl);
}

// ===== EN-TETE =====

function renderDashboardHeader() {
    const el = document.getElementById('dashboard-header');
    const lastRefresh = localStorage.getItem('lastPriceRefresh');
    const lastRefreshHtml = lastRefresh
        ? `<div class="dashboard-last-refresh"><i class="ti ti-refresh" aria-hidden="true"></i> Prix mis à jour le ${new Date(lastRefresh).toLocaleDateString('fr-FR')} à ${new Date(lastRefresh).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>`
        : '';

    el.innerHTML = `
        <div class="dashboard-header-text">
            <h1 class="dashboard-greeting">Bonjour !</h1>
            <p class="dashboard-subtitle">Voici un aperçu de votre collection aujourd'hui.</p>
        </div>
        <div class="dashboard-header-actions">
            ${lastRefreshHtml}
            <button class="dashboard-add-btn" onclick="navigateToTab('tab-add')"><i class="ti ti-plus" aria-hidden="true"></i> Ajouter une carte</button>
        </div>
    `;
}

// ===== HERO =====

function dashboardGetLastMovers() {
    try {
        const stored = localStorage.getItem('lastPriceMovers');
        return stored ? JSON.parse(stored) : [];
    } catch (e) {
        return [];
    }
}

// Rotation du favori mis en avant sur le hero : change automatiquement chaque jour (index basé sur le
// jour de l'année), sauf si l'utilisateur a cliqué sur "suivant" aujourd'hui, auquel cas ce choix
// manuel reste affiché jusqu'à minuit (stocké dans localStorage avec la date du jour).
const DASHBOARD_FEATURED_FAVORITE_KEY = 'dashboardFeaturedFavorite';

function dashboardGetFeaturedFavoriteIndex(count) {
    const today = new Date().toISOString().slice(0, 10);

    try {
        const stored = JSON.parse(localStorage.getItem(DASHBOARD_FEATURED_FAVORITE_KEY) || 'null');
        if (stored && stored.date === today && Number.isInteger(stored.index)) {
            return stored.index % count;
        }
    } catch (e) { /* stockage corrompu, on retombe sur la rotation par défaut */ }

    const startOfYear = new Date(new Date().getFullYear(), 0, 0);
    const dayOfYear = Math.floor((Date.now() - startOfYear.getTime()) / (24 * 60 * 60 * 1000));
    return dayOfYear % count;
}

function dashboardShowNextFavorite(count) {
    const today = new Date().toISOString().slice(0, 10);
    const nextIndex = (dashboardGetFeaturedFavoriteIndex(count) + 1) % count;
    localStorage.setItem(DASHBOARD_FEATURED_FAVORITE_KEY, JSON.stringify({ date: today, index: nextIndex }));
    renderDashboardHeroShowcase();
}

// Carte mise à l'honneur : un favori possédé (rotation quotidienne, cf. dashboardGetFeaturedFavoriteIndex),
// sinon la plus chère de la collection, sinon la première, sinon état vide. Factorisé hors de
// renderDashboardHero pour être appelable seul (renderDashboardHeroShowcase, cf. dashboardShowNextFavorite)
// sans reconstruire tout le hero - qui blanchissait au passage le badge de variation 7j le temps du
// re-fetch réseau (dashboardUpdateHeroVariation), un "flash" visible à chaque clic sur "carte suivante"
// alors que seule la carte affichée change, jamais la valeur totale/variation.
function getDashboardFeaturedCardHtml() {
    let featured = null;
    let favoriteCount = 0;
    if (allCollectionCards.length > 0) {
        const favoritedOwned = [];
        const seenFavoriteIds = new Set();
        allCollectionCards.forEach(c => {
            if (c.tcgdex_id && isFavorite(c.tcgdex_id) && !seenFavoriteIds.has(c.tcgdex_id)) {
                seenFavoriteIds.add(c.tcgdex_id);
                favoritedOwned.push(c);
            }
        });

        if (favoritedOwned.length > 0) {
            favoriteCount = favoritedOwned.length;
            featured = favoritedOwned[dashboardGetFeaturedFavoriteIndex(favoriteCount)];
        } else {
            const withValue = [...allCollectionCards].filter(c => Number(c.market_value || 0) > 0).sort((a, b) => Number(b.market_value || 0) - Number(a.market_value || 0));
            featured = withValue.length > 0 ? withValue[0] : allCollectionCards[0];
        }
    }

    // Média (image / placeholder) et métadonnées de la carte mise à l'honneur, ou état vide de collection
    let mediaHtml;
    let metaHtml;

    if (!featured) {
        mediaHtml = `<div class="dashboard-hero-card-placeholder"><i class="ti ti-cards" aria-hidden="true"></i></div>`;
        metaHtml = `<p class="dashboard-hero-empty-text">Ajoutez votre première carte pour la voir apparaître ici</p>`;
    } else {
        mediaHtml = featured.image
            ? `<div class="dashboard-hero-card-img-wrap"><div class="dashboard-hero-card-img-clip"><img src="${featured.image}" alt="${escapeHtml(featured.name)}" class="dashboard-hero-card-img" onerror="this.closest('.dashboard-hero-card-img-wrap').style.display='none'"></div></div>`
            : `<div class="dashboard-hero-card-placeholder"><i class="ti ti-cards" aria-hidden="true"></i></div>`;

        const movers = dashboardGetLastMovers();
        const mover = movers.find(m => m.name === featured.name && String(m.number) === String(featured.number));
        const moverHtml = mover
            ? `<div class="dashboard-hero-card-delta ${mover.delta > 0 ? 'dashboard-positive' : 'dashboard-negative'}"><i class="ti ${mover.delta > 0 ? 'ti-trending-up' : 'ti-trending-down'}" aria-hidden="true"></i> ${mover.delta > 0 ? '+' : ''}${formatPrice(mover.delta)} depuis le dernier rafraîchissement</div>`
            : '';

        const valueHtml = Number(featured.market_value || 0) > 0
            ? `<div class="dashboard-hero-card-value">${formatPrice(featured.market_value)}</div>`
            : `<div class="dashboard-hero-card-value dashboard-hero-card-value--empty">Valeur indisponible</div>`;

        // Bouton "suivant" : uniquement utile s'il y a plusieurs favoris à faire tourner
        const nextFavoriteHtml = favoriteCount > 1
            ? `<button type="button" class="dashboard-hero-card-next" onclick="dashboardShowNextFavorite(${favoriteCount})" title="Voir un autre favori" aria-label="Voir un autre favori"><i class="ti ti-chevron-right" aria-hidden="true"></i></button>`
            : '';

        metaHtml = `
            <div class="dashboard-hero-card-label-row">
                <div class="dashboard-hero-card-label">${favoriteCount > 0 ? 'Favori du jour' : 'Carte du jour'}</div>
                ${nextFavoriteHtml}
            </div>
            <div class="dashboard-hero-card-name">${escapeHtml(featured.name)}</div>
            ${featured.series ? `<div class="dashboard-hero-card-set">${escapeHtml(featured.series)}</div>` : ''}
            ${valueHtml}
            ${moverHtml}
        `;
    }

    return { mediaHtml, metaHtml };
}

// Reconstruit uniquement .dashboard-hero-showcase (carte + méta) - jamais la valeur totale, la
// variation 7j ou les KPI, qui ne dépendent pas de la carte mise à l'honneur.
function renderDashboardHeroShowcase() {
    const showcase = document.getElementById('dashboard-hero-showcase');
    if (!showcase) return;
    const { mediaHtml, metaHtml } = getDashboardFeaturedCardHtml();
    showcase.innerHTML = `
        <div class="dashboard-hero-card-stage">
            <div class="dashboard-hero-card-media">
                ${mediaHtml}
            </div>
        </div>
        <div class="dashboard-hero-card-meta">
            ${metaHtml}
        </div>
    `;
}

function renderDashboardHero() {
    const el = document.getElementById('dashboard-hero');
    const totalValue = allCollectionCards.reduce((sum, c) => sum + Number(c.market_value || 0) * Number(c.quantity || 1), 0);

    // Info de mise à jour des prix
    const lastRefresh = localStorage.getItem('lastPriceRefresh');
    const lastRefreshHtml = lastRefresh
        ? `<div class="dashboard-hero-last-refresh"><i class="ti ti-refresh" aria-hidden="true"></i> Prix mis à jour le ${new Date(lastRefresh).toLocaleDateString('fr-FR')} à ${new Date(lastRefresh).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>`
        : '';

    // Variation sur 7 jours : placeholder rempli après coup par dashboardUpdateHeroVariation (prix
    // marché uniquement, cf. computeMarketFluctuation dans stats.js — ne bouge pas avec les
    // ajouts/suppressions de cartes)
    const variationHtml = '<div class="dashboard-hero-variation" id="dashboard-hero-variation"></div>';

    const { mediaHtml, metaHtml } = getDashboardFeaturedCardHtml();

    el.innerHTML = `
        <div class="dashboard-hero-background" aria-hidden="true">
            <span class="dashboard-hero-nebula"></span>
            <span class="dashboard-hero-pokeball"></span>
            <span class="dashboard-hero-stars"></span>
        </div>

        <div class="dashboard-hero-summary">
            ${typeof currentUserProfile !== 'undefined' && currentUserProfile?.pseudo ? `<div class="dashboard-hero-greeting">Bonjour <span class="dashboard-hero-greeting-name">${escapeHtml(currentUserProfile.pseudo)}</span></div>` : ''}
            <div class="dashboard-hero-label">Valeur totale de la collection</div>
            <div class="dashboard-hero-value">${formatPrice(totalValue)}</div>
            ${variationHtml}
            ${lastRefreshHtml}
        </div>

        <div class="dashboard-hero-showcase" id="dashboard-hero-showcase">
            <div class="dashboard-hero-card-stage">
                <div class="dashboard-hero-card-media">
                    ${mediaHtml}
                </div>
            </div>
            <div class="dashboard-hero-card-meta">
                ${metaHtml}
            </div>
        </div>

        <div class="dashboard-kpis" id="dashboard-kpis">
            <div class="kpi-plaque kpi-plaque--value" id="dashboard-kpi-cards" onclick="navigateToTab('tab-collection')"></div>
            <div class="kpi-plaque kpi-plaque--value" id="dashboard-kpi-series" onclick="navigateToTab('tab-progression')"></div>
            <div class="kpi-plaque kpi-plaque--value" id="dashboard-kpi-spent" onclick="navigateToTab('tab-stats')"></div>
            <div class="kpi-plaque kpi-plaque--value" id="dashboard-kpi-wishlist" onclick="navigateToTab('tab-wishlist')"></div>
        </div>
    `;

    dashboardUpdateHeroVariation();
    renderDashboardKpis();
}

// Remplit après coup le placeholder de variation 7j (nécessite un appel réseau à computeMarketFluctuation)
async function dashboardUpdateHeroVariation() {
    const variationEl = document.getElementById('dashboard-hero-variation');
    if (!variationEl) return;

    const fluctuation = await computeMarketFluctuation(7 * 24 * 60 * 60 * 1000);
    if (!fluctuation) {
        variationEl.innerHTML = '';
        return;
    }

    const { delta, baselineTotal } = fluctuation;
    const pct = baselineTotal > 0 ? (delta / baselineTotal) * 100 : 0;
    const cls = delta > 0 ? 'dashboard-positive' : delta < 0 ? 'dashboard-negative' : 'dashboard-neutral';
    const sign = delta > 0 ? '+' : '';
    variationEl.className = `dashboard-hero-variation ${cls}`;
    variationEl.innerHTML = `<i class="ti ${delta >= 0 ? 'ti-trending-up' : 'ti-trending-down'}" aria-hidden="true"></i> ${sign}${formatPrice(delta)} (${sign}${pct.toFixed(2)}%) sur 7 jours`;
}

// ===== KPI =====

function renderDashboardKpis() {
    const totalCards = allCollectionCards.reduce((sum, c) => sum + Number(c.quantity || 1), 0);
    const totalValue = allCollectionCards.reduce((sum, c) => sum + Number(c.market_value || 0) * Number(c.quantity || 1), 0);
    const totalSpent = allCollectionCards.reduce((sum, c) => sum + Number(c.purchase_price || 0) * Number(c.quantity || 1), 0);
    const seriesCount = new Set(allCollectionCards.map(c => c.series).filter(s => s && s !== 'N/A')).size;
    const gain = totalValue - totalSpent;
    const wishlistCount = typeof allWishlistItems !== 'undefined' ? allWishlistItems.length : 0;

    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const cardsThisWeek = allCollectionCards
        .filter(c => c.created_at && new Date(c.created_at).getTime() >= weekAgo)
        .reduce((sum, c) => sum + Number(c.quantity || 1), 0);
    const cardsSub = cardsThisWeek > 0 ? `+${cardsThisWeek} carte${cardsThisWeek > 1 ? 's' : ''} cette semaine` : '';

    const monthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const spentThisMonth = allCollectionCards
        .filter(c => c.created_at && new Date(c.created_at).getTime() >= monthAgo)
        .reduce((sum, c) => sum + Number(c.purchase_price || 0) * Number(c.quantity || 1), 0);
    const spentSub = spentThisMonth > 0 ? `+${formatPrice(spentThisMonth)} ce mois` : '';

    document.getElementById('dashboard-kpi-cards').innerHTML = dashboardKpiHtml('ti-cards', totalCards, 'cartes dans ma collection', '', cardsSub, 'c1');
    document.getElementById('dashboard-kpi-series').innerHTML = dashboardKpiHtml('ti-stack-2', seriesCount, 'séries différentes', '', '', 'c2');
    document.getElementById('dashboard-kpi-spent').innerHTML = dashboardKpiHtml('ti-wallet', formatPrice(totalSpent), 'investis', '', spentSub, 'c3');
    document.getElementById('dashboard-kpi-wishlist').innerHTML = dashboardKpiHtml('ti-star', wishlistCount, 'cartes en wishlist', '', '', 'c4');
}

// chipClass (passe premium 2026-09) : une teinte de puce par KPI (dashboard uniquement), pour
// distinguer les 4 KPI au coin de l'oeil sans avoir a lire le libelle - cf .kpi-plaque-icon.c2/c3/c4
// dans styles.css, scope a #dashboard-kpis pour ne pas affecter les .kpi-plaque partagees ailleurs
// (Collection/Stats/Progression restent toutes dorees).
function dashboardKpiHtml(icon, value, label, extraClass = '', sub = '', chipClass = '') {
    return `
        <span class="kpi-plaque-icon ${chipClass}"><i class="ti ${icon}" aria-hidden="true"></i></span>
        <div class="kpi-plaque-text">
            <div class="kpi-plaque-label">${label}</div>
            <div class="kpi-plaque-value ${extraClass}">${value}</div>
            ${sub ? `<div class="kpi-plaque-sub positive">${sub}</div>` : ''}
        </div>
    `;
}

// ===== ACTIVITE RECENTE =====

function dashboardRelativeTime(dateInput) {
    const date = new Date(dateInput);
    const diffMs = Date.now() - date.getTime();
    const diffMin = diffMs / 60000;
    if (diffMin < 60) return `Il y a ${Math.max(1, Math.round(diffMin))} min`;
    const diffH = diffMin / 60;
    if (diffH < 24) return `Il y a ${Math.round(diffH)} h`;
    const diffJ = Math.round(diffH / 24);
    if (diffJ === 1) return 'Hier';
    return `Il y a ${diffJ} j`;
}

function renderDashboardActivity() {
    const el = document.getElementById('dashboard-activity-body');

    const recentAdds = allCollectionCards.slice(0, 3).map(c => ({
        type: 'add',
        id: c.id,
        name: c.name,
        series: c.series,
        date: c.created_at,
        value: Number(c.market_value || 0)
    }));

    const movers = dashboardGetLastMovers()
        .slice()
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    const items = [...recentAdds];
    for (const m of movers) {
        if (items.length >= 4) break;
        items.push({ type: 'mover', name: m.name, number: m.number, delta: m.delta });
    }

    if (items.length === 0) {
        el.innerHTML = '<p class="dashboard-empty-text">Aucune activité pour l\'instant</p>';
        return;
    }

    el.innerHTML = items.slice(0, 4).map(item => {
        if (item.type === 'add') {
            return `
                <div class="dashboard-activity-row" ${item.id != null ? `data-card-id="${item.id}" onclick="showCardDetail(${item.id}, event)"` : ''}>
                    <div class="dashboard-activity-text">
                        <div class="dashboard-activity-name">${escapeHtml(item.name)}</div>
                        <div class="dashboard-activity-sub">${escapeHtml(item.series || '')} · Ajoutée</div>
                    </div>
                    <div class="dashboard-activity-right">
                        <div class="dashboard-activity-time">${dashboardRelativeTime(item.date)}</div>
                    </div>
                </div>
            `;
        }
        const cls = item.delta > 0 ? 'dashboard-positive' : 'dashboard-negative';
        return `
            <div class="dashboard-activity-row">
                <div class="dashboard-activity-text">
                    <div class="dashboard-activity-name">${escapeHtml(item.name)}</div>
                    <div class="dashboard-activity-sub">#${escapeHtml(String(item.number))} · Prix ${item.delta > 0 ? 'en hausse' : 'en baisse'}</div>
                </div>
                <div class="dashboard-activity-right">
                    <div class="dashboard-activity-delta ${cls}">${item.delta > 0 ? '+' : ''}${formatPrice(item.delta)}</div>
                </div>
            </div>
        `;
    }).join('');
}

// ===== OBJECTIF ACTUEL =====

// Cherche la série incomplète avec la meilleure progression, uniquement à partir du cache déjà chargé
// par l'onglet Progression (allTcgdexSeries) : aucun nouvel appel API n'est déclenché depuis le Dashboard
function dashboardFindBestObjective() {
    if (typeof allTcgdexSeries === 'undefined' || allTcgdexSeries.length === 0) return null;

    const ownedIdsBySet = {};
    allCollectionCards.forEach(card => {
        if (card.tcgdex_id) {
            const setId = getSetIdFromTcgdexId(card.tcgdex_id);
            if (!ownedIdsBySet[setId]) ownedIdsBySet[setId] = new Set();
            ownedIdsBySet[setId].add(card.tcgdex_id);
        }
    });

    let best = null;
    allTcgdexSeries.forEach(series => {
        (series.sets || []).forEach(set => {
            const officialCount = set.cardCount?.official || 0;
            if (officialCount === 0) return;
            const owned = ownedIdsBySet[set.id]?.size || 0;
            if (owned === 0) return;
            const pct = owned / officialCount;
            if (pct >= 1) return;
            if (!best || pct > best.pct) {
                let logoUrl = set.logo ? `${set.logo}.webp` : '';
                best = { setId: set.id, setName: set.name, logoUrl, owned, total: officialCount, pct };
            }
        });
    });

    return best;
}

// Token de course (P2-5) : incrémenté à chaque appel, permet à dashboardEnrichObjectiveBudget de
// vérifier avant d'écrire dans le DOM que l'objectif affiché n'a pas changé entretemps (le widget
// peut être reconstruit par un nouveau renderDashboard pendant que le fetch du budget est en vol).
let dashboardObjectiveToken = 0;

function renderDashboardObjective() {
    const el = document.getElementById('dashboard-objective-body');
    const best = dashboardFindBestObjective();
    dashboardObjectiveToken++;
    const myToken = dashboardObjectiveToken;

    if (!best) {
        el.innerHTML = `
            <div class="dashboard-widget-empty-compact">
                <i class="ti ti-aperture" aria-hidden="true"></i>
                <p class="dashboard-empty-text" style="padding:0;">Aucun objectif sélectionné</p>
                <p class="dashboard-empty-subtext">Choisissez une série depuis l'onglet Progression.</p>
            </div>
        `;
        return;
    }

    const pctDisplay = Math.round(best.pct * 100);
    const safeName = (best.setName || '').replace(/'/g, "\\'");

    // Compteur wishlist "prix bas" (P2-5) : réutilise wishlistPriceSignalMap (P2-4), déjà en mémoire,
    // zéro requête supplémentaire. Silence si aucune carte concernée, comme le reste de P2-4.
    const lowPriceCount = (typeof allWishlistItems !== 'undefined' ? allWishlistItems : [])
        .filter(item => item.tcgdex_id && wishlistPriceSignalMap[item.tcgdex_id]?.type === 'low').length;
    const lowPriceLine = lowPriceCount > 0
        ? `<div class="dashboard-objective-extra"><i class="ti ti-tag" aria-hidden="true"></i> ${lowPriceCount} carte${lowPriceCount > 1 ? 's' : ''} en wishlist à prix bas en ce moment</div>`
        : '';

    el.innerHTML = `
        <div class="dashboard-objective-row">
            <div class="dashboard-objective-ring-wrap">
                ${progressRingSvg(pctDisplay)}
                <span class="dashboard-objective-ring-pct">${pctDisplay}%</span>
            </div>
            <div class="dashboard-objective-row-text">
                ${best.logoUrl ? `<img src="${best.logoUrl}" alt="" class="dashboard-objective-logo" onerror="this.remove()">` : ''}
                <div class="dashboard-objective-name">${escapeHtml(best.setName)}</div>
            </div>
        </div>
        <div class="dashboard-objective-count">${best.owned} / ${best.total} cartes</div>
        <div class="dashboard-objective-extra" id="dashboard-objective-budget"></div>
        ${lowPriceLine}
        <button class="dashboard-btn-primary dashboard-btn-full" onclick="dashboardGoToProgressionSet('${best.setId}', '${safeName}', '${best.logoUrl}')">Continuer la série</button>
    `;

    dashboardEnrichObjectiveBudget(best, myToken);
}

// Cache localStorage du budget de complétion de l'objectif (P2-5) : évite de refetch les prix des
// cartes manquantes à chaque visite du Dashboard le même jour (TCGdex ne met à jour ses prix qu'1x/jour,
// cf mémoire tcgdex_update_cadence — un fetch plus fréquent n'apporterait rien).
function dashboardObjectiveBudgetCacheKey(setId) {
    return `dashboardObjectiveBudget_${setId}`;
}

function dashboardReadObjectiveBudgetCache(setId) {
    try {
        const cached = JSON.parse(localStorage.getItem(dashboardObjectiveBudgetCacheKey(setId)) || 'null');
        if (!cached || cached.date !== new Date().toDateString()) return null;
        return cached.budget;
    } catch {
        return null;
    }
}

function dashboardWriteObjectiveBudgetCache(setId, budget) {
    try {
        localStorage.setItem(dashboardObjectiveBudgetCacheKey(setId), JSON.stringify({ date: new Date().toDateString(), budget }));
    } catch {
        // localStorage indisponible/plein : tant pis, pas de cache cette fois
    }
}

// Complète la ligne budget du widget Objectif après coup (P2-5, réutilise computeSetCompletionBudget
// de P2-1/progression.js). "Possédée" = même définition par défaut que l'onglet Progression en mode
// normal (une carte sans finish enregistré compte comme normal). myToken évite d'écrire une réponse
// tardive si l'utilisateur a changé d'objectif ou de série entretemps (widget déjà reconstruit).
async function dashboardEnrichObjectiveBudget(best, myToken) {
    let budget = dashboardReadObjectiveBudgetCache(best.setId);

    if (!budget) {
        try {
            const setCards = await fetchSetCardsDetailed(best.setId);
            if (myToken !== dashboardObjectiveToken) return;

            const ownedIds = new Set(
                allCollectionCards
                    .filter(c => c.tcgdex_id && (c.finish || 'normal') === 'normal')
                    .map(c => c.tcgdex_id)
            );
            const missingCards = setCards.filter(c => !ownedIds.has(c.id));
            const full = computeSetCompletionBudget(missingCards, 'normal');
            budget = { totalKnown: full.totalKnown, countKnown: full.countKnown, countUnknown: full.countUnknown };
            dashboardWriteObjectiveBudgetCache(best.setId, budget);
        } catch (error) {
            console.error('Erreur budget objectif Dashboard:', error);
            return;
        }
    }

    if (myToken !== dashboardObjectiveToken) return;
    const budgetEl = document.getElementById('dashboard-objective-budget');
    if (!budgetEl) return;

    if (budget.countKnown === 0) {
        budgetEl.innerHTML = '';
        return;
    }

    budgetEl.innerHTML = `<i class="ti ti-wallet" aria-hidden="true"></i> ≈ ${formatPrice(budget.totalKnown)} pour compléter cette série${budget.countUnknown > 0 ? ` (${budget.countUnknown} sans prix connu)` : ''}`;
}

// ===== TOP HAUSSES =====

function renderDashboardTopMovers() {
    const widget = document.getElementById('dashboard-widget-movers');
    const el = document.getElementById('dashboard-movers-body');
    const movers = dashboardGetLastMovers();
    const gainers = movers.filter(m => m.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 3);

    // Pas de hausse : le widget entier disparaît (pas d'emplacement vide dans la grille)
    if (gainers.length === 0) {
        if (widget) widget.style.display = 'none';
        return;
    }
    if (widget) widget.style.display = '';

    el.innerHTML = gainers.map(m => `
        <div class="dashboard-mover-row">
            <span class="dashboard-mover-name">${escapeHtml(m.name)} <span class="dashboard-mover-number">#${escapeHtml(String(m.number))}</span></span>
            <span class="dashboard-mover-delta dashboard-positive">+${formatPrice(m.delta)}</span>
        </div>
    `).join('');
}

// ===== DERNIERES ACQUISITIONS =====

function renderDashboardAcquisitions() {
    const el = document.getElementById('dashboard-acquisitions-body');
    const cards = allCollectionCards.slice(0, 5);

    if (cards.length === 0) {
        el.innerHTML = '<p class="dashboard-empty-text">Votre collection est vide</p>';
        return;
    }

    el.innerHTML = `<div class="dashboard-acquisitions-scroll">${cards.map(c => `
        <div class="dashboard-acquisition-card" data-card-id="${c.id}" onclick="showCardDetail(${c.id}, event)">
            <div class="dashboard-acquisition-card-img-wrap">
                ${c.image
                    ? `<img src="${c.image}" alt="${escapeHtml(c.name)}" loading="lazy" onerror="this.style.display='none'">`
                    : '<div class="no-image-placeholder thumb"><i class="ti ti-photo-off" aria-hidden="true"></i></div>'
                }
            </div>
            <div class="dashboard-acquisition-name">${escapeHtml(c.name)}</div>
            ${Number(c.market_value || 0) > 0 ? `<div class="dashboard-acquisition-value">${formatPrice(c.market_value)}</div>` : ''}
            <div class="dashboard-acquisition-time">${dashboardRelativeTime(c.created_at)}</div>
        </div>
    `).join('')}</div>`;
}

// ===== A FAIRE AUJOURD'HUI =====

function renderDashboardTodo() {
    const el = document.getElementById('dashboard-todo-body');
    const items = [];

    const lastRefresh = localStorage.getItem('lastPriceRefresh');
    const lastRefreshText = lastRefresh
        ? `Dernière mise à jour : ${new Date(lastRefresh).toLocaleDateString('fr-FR')}`
        : 'Jamais rafraîchi';
    items.push(`
        <div class="dashboard-todo-row" onclick="refreshAllMarketPrices()">
            <span class="dashboard-todo-icon"><i class="ti ti-refresh" aria-hidden="true"></i></span>
            <div class="dashboard-todo-text">
                <div class="dashboard-todo-title">Mettre à jour les prix du marché</div>
                <div class="dashboard-todo-sub">${lastRefreshText}</div>
            </div>
        </div>
    `);

    const best = dashboardFindBestObjective();
    if (best) {
        const pctDisplay = Math.round(best.pct * 100);
        const safeName = (best.setName || '').replace(/'/g, "\\'");
        items.push(`
            <div class="dashboard-todo-row" onclick="dashboardGoToProgressionSet('${best.setId}', '${safeName}', '${best.logoUrl}')">
                <span class="dashboard-todo-icon"><i class="ti ti-trophy" aria-hidden="true"></i></span>
                <div class="dashboard-todo-text">
                    <div class="dashboard-todo-title">Vous êtes à ${pctDisplay}% de la série ${escapeHtml(best.setName)}</div>
                    <div class="dashboard-todo-sub">Encore ${best.total - best.owned} carte${best.total - best.owned > 1 ? 's' : ''} pour la compléter</div>
                </div>
            </div>
        `);
    }

    el.innerHTML = items.join('');
}

// ===== WISHLIST A SURVEILLER =====

function dashboardWishlistEmptyHtml(text) {
    return `
        <div class="dashboard-widget-empty-compact">
            <i class="ti ti-star" aria-hidden="true"></i>
            <p class="dashboard-empty-text" style="padding:0;">${text}</p>
            <button class="dashboard-btn-secondary" onclick="navigateToTab('tab-wishlist')">Voir mes souhaits</button>
        </div>
    `;
}

function renderDashboardWishlist() {
    const el = document.getElementById('dashboard-wishlist-body');
    if (typeof allWishlistItems === 'undefined' || allWishlistItems.length === 0) {
        el.innerHTML = dashboardWishlistEmptyHtml('Aucune carte dans vos listes de souhaits');
        return;
    }

    const ownedTcgdexIds = new Set(allCollectionCards.filter(c => c.tcgdex_id).map(c => c.tcgdex_id));
    const items = allWishlistItems.filter(i => !(i.tcgdex_id && ownedTcgdexIds.has(i.tcgdex_id))).slice(0, 6);

    if (items.length === 0) {
        el.innerHTML = dashboardWishlistEmptyHtml('Toutes vos cartes en wishlist sont déjà possédées');
        return;
    }

    el.innerHTML = items.map(item => {
        const price = (typeof wishlistPriceMap !== 'undefined' && item.tcgdex_id && wishlistPriceMap[item.tcgdex_id])
            ? Number(wishlistPriceMap[item.tcgdex_id])
            : Number(item.market_value || 0);
        const priceHtml = price > 0 ? `<div class="dashboard-wishlist-price">${formatPrice(price)}</div>` : '';
        const trendHtml = item.tcgdex_id ? `<div class="dashboard-wishlist-trend" id="dashboard-wishlist-trend-${item.tcgdex_id}"></div>` : '';

        return `
        <div class="dashboard-wishlist-row" onclick="openWishlistItemDetail(${item.id}, event)">
            ${item.image
                ? `<img src="${item.image}" alt="${escapeHtml(item.name)}" class="dashboard-wishlist-img" onerror="this.style.display='none'">`
                : '<div class="no-image-placeholder thumb"><i class="ti ti-photo-off" aria-hidden="true"></i></div>'
            }
            <div class="dashboard-wishlist-text">
                <div class="dashboard-wishlist-name">${escapeHtml(item.name)}</div>
                <div class="dashboard-wishlist-set">${escapeHtml(item.series || '')}</div>
            </div>
            <div class="dashboard-wishlist-right">
                ${priceHtml}
                ${trendHtml}
            </div>
        </div>
    `;
    }).join('');

    dashboardUpdateWishlistTrends(items.filter(i => i.tcgdex_id));
}

// ===== TROUVER UN COLLECTIONNEUR =====
// Shell statique uniquement : toute la logique de recherche (debounce, requestId, requêtes
// profiles_public, rendu des résultats/états) vit dans modules/collectors.js
// (dashboardCollectorsSearchController) et est partagée avec la vue #/collectors — pas de seconde
// implémentation ici. Rebâti à chaque rafraîchissement du Dashboard comme les autres widgets (une
// recherche en cours dans ce champ est donc réinitialisée si le Dashboard se rafraîchit pendant la
// frappe, même comportement pré-existant que tous les autres widgets de cette grille).
function renderDashboardCollectorsSearch() {
    const el = document.getElementById('dashboard-collectors-body');
    if (!el) return;

    el.innerHTML = `
        <p class="dashboard-empty-subtext" style="padding:0 0 0.75rem;">Retrouvez vos amis et découvrez leurs collections.</p>
        <div class="input-with-icon">
            <i class="ti ti-search" aria-hidden="true"></i>
            <input type="text" id="dashboard-collectors-input" placeholder="Rechercher un pseudo ou @username" oninput="onDashboardCollectorsSearchInput()">
        </div>
        <div class="collectors-search-results dashboard-collectors-results" id="dashboard-collectors-results"></div>
    `;

    dashboardCollectorsDefaultLoader.load();
}

// Remplit après coup la variation 24h de chaque carte en wishlist (nécessite un appel réseau
// à card_price_history, cf. même pattern que dashboardUpdateHeroVariation)
async function dashboardUpdateWishlistTrends(items) {
    if (items.length === 0) return;

    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const tcgdexIds = items.map(i => i.tcgdex_id);

    const { data, error } = await supabaseClient
        .from('card_price_history')
        .select('tcgdex_id, market_value, recorded_at')
        .in('tcgdex_id', tcgdexIds)
        .lte('recorded_at', cutoff)
        .order('recorded_at', { ascending: false });

    if (error || !data) return;

    items.forEach(item => {
        const el = document.getElementById(`dashboard-wishlist-trend-${item.tcgdex_id}`);
        if (!el) return;

        const basePoint = data.find(d => d.tcgdex_id === item.tcgdex_id);
        if (!basePoint) return;

        const baseValue = Number(basePoint.market_value);
        const currentValue = (typeof wishlistPriceMap !== 'undefined' && wishlistPriceMap[item.tcgdex_id])
            ? Number(wishlistPriceMap[item.tcgdex_id])
            : Number(item.market_value || 0);
        if (baseValue === 0) return;

        const delta = currentValue - baseValue;
        const cls = delta > 0 ? 'dashboard-positive' : delta < 0 ? 'dashboard-negative' : '';
        const sign = delta > 0 ? '+' : '';
        el.className = `dashboard-wishlist-trend ${cls}`;
        el.innerHTML = `<i class="ti ${delta >= 0 ? 'ti-arrow-up' : 'ti-arrow-down'}" aria-hidden="true"></i> ${sign}${formatPrice(delta)}`;
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
window.dashboardRenderSafe = dashboardRenderSafe;
window.renderDashboard = renderDashboard;
window.dashboardBuildSkeleton = dashboardBuildSkeleton;
window.dashboardGoToProgressionSet = dashboardGoToProgressionSet;
window.renderDashboardHeader = renderDashboardHeader;
window.dashboardGetLastMovers = dashboardGetLastMovers;
window.DASHBOARD_FEATURED_FAVORITE_KEY = DASHBOARD_FEATURED_FAVORITE_KEY;
window.dashboardGetFeaturedFavoriteIndex = dashboardGetFeaturedFavoriteIndex;
window.dashboardShowNextFavorite = dashboardShowNextFavorite;
window.getDashboardFeaturedCardHtml = getDashboardFeaturedCardHtml;
window.renderDashboardHeroShowcase = renderDashboardHeroShowcase;
window.renderDashboardHero = renderDashboardHero;
window.dashboardUpdateHeroVariation = dashboardUpdateHeroVariation;
window.renderDashboardKpis = renderDashboardKpis;
window.dashboardKpiHtml = dashboardKpiHtml;
window.dashboardRelativeTime = dashboardRelativeTime;
window.renderDashboardActivity = renderDashboardActivity;
window.dashboardFindBestObjective = dashboardFindBestObjective;
window.renderDashboardObjective = renderDashboardObjective;
window.renderDashboardTopMovers = renderDashboardTopMovers;
window.renderDashboardAcquisitions = renderDashboardAcquisitions;
window.renderDashboardTodo = renderDashboardTodo;
window.dashboardWishlistEmptyHtml = dashboardWishlistEmptyHtml;
window.renderDashboardWishlist = renderDashboardWishlist;
window.renderDashboardCollectorsSearch = renderDashboardCollectorsSearch;
window.dashboardUpdateWishlistTrends = dashboardUpdateWishlistTrends;
