// Onglet Dashboard - Pokémon Tracker
// Dépend de: allCollectionCards/supabaseClient/allWishlistItems/allTcgdexSeries/dashboardNeedsRefresh (tracker.js/wishlist.js/progression.js),
// escapeHtml/getSetIdFromTcgdexId (utils.js), showCardDetail (card-detail.js), openSetProgression (progression.js),
// activateTabContent (tracker.js), Chart
// Etat possédé : dashboardValueChartInstance, dashboardValueHistoryData

let dashboardValueChartInstance = null;
let dashboardValueHistoryData = null; // null = pas encore chargé, [] = chargé mais vide

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

// Classes de thème disponibles pour le Hero Engine
const THEME_CLASSES = [
    'dashboard-hero--electric',
    'dashboard-hero--fire',
    'dashboard-hero--water',
    'dashboard-hero--grass',
    'dashboard-hero--psychic',
    'dashboard-hero--dark',
    'dashboard-hero--dragon',
    'dashboard-hero--neutral'
];

// Retourne la classe CSS de thème basée sur le type principal de la carte
function getHeroThemeClass(card) {
    if (!card) return 'dashboard-hero--neutral';

    // Extrait le type: peut être une chaîne ou un tableau
    let type = null;
    if (typeof card.type === 'string') {
        type = card.type;
    } else if (Array.isArray(card.type) && card.type.length > 0) {
        type = card.type[0];
    }

    if (!type || typeof type !== 'string') return 'dashboard-hero--neutral';

    // Normalise: minuscules, trim des espaces
    const normalized = type.trim().toLowerCase();

    // Table de correspondance avec clés normalisées (EN et FR)
    const typeMap = {
        'lightning': 'dashboard-hero--electric',
        'electric': 'dashboard-hero--electric',
        'fire': 'dashboard-hero--fire',
        'water': 'dashboard-hero--water',
        'grass': 'dashboard-hero--grass',
        'psychic': 'dashboard-hero--psychic',
        'dark': 'dashboard-hero--dark',
        'darkness': 'dashboard-hero--dark',
        'dragon': 'dashboard-hero--dragon',
        'colorless': 'dashboard-hero--neutral',
        'normal': 'dashboard-hero--neutral',
        'bug': 'dashboard-hero--neutral',
        'flying': 'dashboard-hero--neutral',
        'ground': 'dashboard-hero--neutral',
        'rock': 'dashboard-hero--neutral',
        'ghost': 'dashboard-hero--neutral',
        'steel': 'dashboard-hero--neutral',
        'ice': 'dashboard-hero--neutral',
        'poison': 'dashboard-hero--neutral',
        'fighting': 'dashboard-hero--neutral',
        'fairy': 'dashboard-hero--neutral',
        'feu': 'dashboard-hero--fire',
        'eau': 'dashboard-hero--water',
        'électrique': 'dashboard-hero--electric',
        'plante': 'dashboard-hero--grass',
        'psy': 'dashboard-hero--psychic',
        'obscurité': 'dashboard-hero--dark',
        'combat': 'dashboard-hero--neutral',
        'incolore': 'dashboard-hero--neutral',
        'métal': 'dashboard-hero--neutral'
    };

    return typeMap[normalized] || 'dashboard-hero--neutral';
}

async function renderDashboard() {
    if (!document.getElementById('dashboard-header')) return; // onglet pas encore présent dans le DOM

    if (!dashboardNeedsRefresh) {
        if (dashboardValueChartInstance) dashboardValueChartInstance.resize();
        return;
    }

    dashboardBuildSkeleton();

    dashboardRenderSafe('dashboard-header', renderDashboardHeader);

    try {
        await dashboardLoadValueHistory();
    } catch (error) {
        console.error('Erreur chargement historique valeur (Dashboard):', error);
        dashboardValueHistoryData = [];
    }

    dashboardRenderSafe('dashboard-hero', renderDashboardHero);
    dashboardRenderSafe('dashboard-kpis', renderDashboardKpis);
    dashboardRenderSafe('dashboard-activity-body', renderDashboardActivity);
    dashboardRenderSafe('dashboard-objective-body', renderDashboardObjective);
    dashboardRenderSafe('dashboard-chart-body', renderDashboardValueChart);
    dashboardRenderSafe('dashboard-movers-body', renderDashboardTopMovers);
    dashboardRenderSafe('dashboard-acquisitions-body', renderDashboardAcquisitions);
    dashboardRenderSafe('dashboard-todo-body', renderDashboardTodo);
    dashboardRenderSafe('dashboard-wishlist-body', renderDashboardWishlist);

    dashboardNeedsRefresh = false;
}

// Structure fixe des 3 zones (header/hero à part, KPI, grille principale, grille basse) : construite une
// seule fois par recalcul, chaque section remplit ensuite juste son propre conteneur interne
function dashboardBuildSkeleton() {
    document.getElementById('dashboard-kpis').innerHTML = `
        <div class="dashboard-kpi-card dashboard-kpi-card-cards" id="dashboard-kpi-cards"></div>
        <div class="dashboard-kpi-card dashboard-kpi-card-series" id="dashboard-kpi-series"></div>
        <div class="dashboard-kpi-card dashboard-kpi-card-spent" id="dashboard-kpi-spent"></div>
        <div class="dashboard-kpi-card dashboard-kpi-card-gain" id="dashboard-kpi-gain"></div>
        <div class="dashboard-kpi-card dashboard-kpi-card-wishlist" id="dashboard-kpi-wishlist"></div>
    `;

    document.getElementById('dashboard-main-grid').innerHTML = `
        <div class="dashboard-widget dashboard-widget-activity">
            <div class="dashboard-widget-header"><h3>Activité récente</h3></div>
            <div id="dashboard-activity-body"></div>
        </div>
        <div class="dashboard-widget dashboard-widget-objective">
            <div class="dashboard-widget-header"><h3>Objectif actuel</h3></div>
            <div id="dashboard-objective-body"></div>
        </div>
        <div class="dashboard-widget dashboard-widget-wide dashboard-widget-chart">
            <div class="dashboard-widget-header"><h3>Évolution de la valeur (7j)</h3></div>
            <div id="dashboard-chart-body">
                <canvas id="dashboard-value-chart"></canvas>
            </div>
        </div>
        <div class="dashboard-widget dashboard-widget-full" id="dashboard-widget-movers" style="display:none;">
            <div class="dashboard-widget-header"><h3>Top hausses</h3></div>
            <div id="dashboard-movers-body"></div>
        </div>
    `;

    document.getElementById('dashboard-bottom-grid').innerHTML = `
        <div class="dashboard-widget">
            <div class="dashboard-widget-header"><h3>Dernières acquisitions</h3></div>
            <div id="dashboard-acquisitions-body"></div>
        </div>
        <div class="dashboard-widget">
            <div class="dashboard-widget-header"><h3>À faire aujourd'hui</h3></div>
            <div id="dashboard-todo-body"></div>
        </div>
        <div class="dashboard-widget">
            <div class="dashboard-widget-header"><h3>Wishlist à surveiller</h3></div>
            <div id="dashboard-wishlist-body"></div>
        </div>
    `;
}

// Va sur un autre onglet sans dépendre d'un évènement de clic (utilisé par les boutons du Dashboard)
function dashboardGoToTab(tabId, btnId) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    if (btnId) document.getElementById(btnId)?.classList.add('active');
    activateTabContent(tabId);
}

function dashboardGoToProgressionSet(setId, setName, logoUrl) {
    dashboardGoToTab('tab-progression', 'tab-btn-progression');
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
            <button class="dashboard-add-btn" onclick="dashboardGoToTab('tab-add', 'tab-btn-add')"><i class="ti ti-plus" aria-hidden="true"></i> Ajouter une carte</button>
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

function renderDashboardHero() {
    const el = document.getElementById('dashboard-hero');
    const totalValue = allCollectionCards.reduce((sum, c) => sum + Number(c.market_value || 0) * Number(c.quantity || 1), 0);

    // Variation sur 7 jours, calculée à partir de value_history si on a un point suffisamment ancien
    let variationHtml = '';
    if (dashboardValueHistoryData && dashboardValueHistoryData.length > 0) {
        const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        let baseline = dashboardValueHistoryData[0];
        for (const point of dashboardValueHistoryData) {
            if (new Date(point.recorded_at).getTime() <= weekAgo) baseline = point;
            else break;
        }
        const baselineValue = Number(baseline.total_value);
        const delta = totalValue - baselineValue;
        const pct = baselineValue > 0 ? (delta / baselineValue) * 100 : 0;
        const cls = delta > 0 ? 'dashboard-positive' : delta < 0 ? 'dashboard-negative' : 'dashboard-neutral';
        const sign = delta > 0 ? '+' : '';
        variationHtml = `<div class="dashboard-hero-variation ${cls}"><i class="ti ${delta >= 0 ? 'ti-trending-up' : 'ti-trending-down'}" aria-hidden="true"></i> ${sign}${delta.toFixed(2)}€ (${sign}${pct.toFixed(2)}%) sur 7 jours</div>`;
    }

    // Carte mise à l'honneur : la plus chère, sinon la dernière ajoutée, sinon état vide
    let featured = null;
    if (allCollectionCards.length > 0) {
        const withValue = [...allCollectionCards].filter(c => Number(c.market_value || 0) > 0).sort((a, b) => Number(b.market_value || 0) - Number(a.market_value || 0));
        featured = withValue.length > 0 ? withValue[0] : allCollectionCards[0];
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
            ? `<div class="dashboard-hero-card-delta ${mover.delta > 0 ? 'dashboard-positive' : 'dashboard-negative'}"><i class="ti ${mover.delta > 0 ? 'ti-trending-up' : 'ti-trending-down'}" aria-hidden="true"></i> ${mover.delta > 0 ? '+' : ''}${mover.delta.toFixed(2)}€ depuis le dernier rafraîchissement</div>`
            : '';

        const valueHtml = Number(featured.market_value || 0) > 0
            ? `<div class="dashboard-hero-card-value">${Number(featured.market_value).toFixed(2)}€</div>`
            : `<div class="dashboard-hero-card-value dashboard-hero-card-value--empty">Valeur indisponible</div>`;

        metaHtml = `
            <div class="dashboard-hero-card-label">Carte du jour</div>
            <div class="dashboard-hero-card-name">${escapeHtml(featured.name)}</div>
            ${featured.series ? `<div class="dashboard-hero-card-set">${escapeHtml(featured.series)}</div>` : ''}
            ${valueHtml}
            ${moverHtml}
        `;
    }

    el.innerHTML = `
        <div class="dashboard-hero-background" aria-hidden="true">
            <span class="dashboard-hero-nebula"></span>
            <span class="dashboard-hero-pokeball"></span>
            <span class="dashboard-hero-stars"></span>
        </div>

        <div class="dashboard-hero-summary">
            <div class="dashboard-hero-label">Valeur totale de la collection</div>
            <div class="dashboard-hero-value">${totalValue.toFixed(2)}€</div>
            ${variationHtml}
            <div class="dashboard-hero-actions">
                <button class="dashboard-btn-primary" onclick="dashboardGoToTab('tab-collection', 'tab-btn-collection')"><i class="ti ti-layout-grid" aria-hidden="true"></i> Voir ma collection</button>
                <button class="dashboard-btn-secondary" onclick="dashboardGoToTab('tab-stats', 'tab-btn-stats')"><i class="ti ti-chart-bar" aria-hidden="true"></i> Voir les statistiques</button>
            </div>
        </div>

        <div class="dashboard-hero-showcase">
            <div class="dashboard-hero-card-stage">
                <div class="dashboard-hero-card-media">
                    ${mediaHtml}
                </div>
            </div>
            <div class="dashboard-hero-card-meta">
                ${metaHtml}
            </div>
        </div>
    `;

    // Applique la classe de thème basée sur le type de la carte
    const themeClass = getHeroThemeClass(featured);
    THEME_CLASSES.forEach(cls => el.classList.remove(cls));
    el.classList.add(themeClass);
}

// ===== KPI =====

function renderDashboardKpis() {
    const totalCards = allCollectionCards.reduce((sum, c) => sum + Number(c.quantity || 1), 0);
    const totalValue = allCollectionCards.reduce((sum, c) => sum + Number(c.market_value || 0) * Number(c.quantity || 1), 0);
    const totalSpent = allCollectionCards.reduce((sum, c) => sum + Number(c.purchase_price || 0) * Number(c.quantity || 1), 0);
    const seriesCount = new Set(allCollectionCards.map(c => c.series).filter(s => s && s !== 'N/A')).size;
    const gain = totalValue - totalSpent;
    const wishlistCount = typeof allWishlistItems !== 'undefined' ? allWishlistItems.length : 0;

    document.getElementById('dashboard-kpi-cards').innerHTML = dashboardKpiHtml('ti-cards', totalCards, 'cartes dans ma collection');
    document.getElementById('dashboard-kpi-series').innerHTML = dashboardKpiHtml('ti-stack-2', seriesCount, 'séries différentes');
    document.getElementById('dashboard-kpi-spent').innerHTML = dashboardKpiHtml('ti-wallet', `${totalSpent.toFixed(2)}€`, 'investis');
    document.getElementById('dashboard-kpi-gain').innerHTML = dashboardKpiHtml(
        gain >= 0 ? 'ti-trending-up' : 'ti-trending-down',
        `${gain >= 0 ? '+' : ''}${gain.toFixed(2)}€`,
        'plus-value',
        gain >= 0 ? 'dashboard-positive' : 'dashboard-negative'
    );
    document.getElementById('dashboard-kpi-wishlist').innerHTML = dashboardKpiHtml('ti-star', wishlistCount, 'cartes en wishlist');
}

function dashboardKpiHtml(icon, value, label, extraClass = '') {
    return `
        <span class="dashboard-kpi-icon"><i class="ti ${icon}" aria-hidden="true"></i></span>
        <div class="dashboard-kpi-text">
            <div class="dashboard-kpi-value ${extraClass}">${value}</div>
            <div class="dashboard-kpi-label">${label}</div>
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
                <div class="dashboard-activity-row" ${item.id != null ? `onclick="showCardDetail(${item.id})"` : ''}>
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
                    <div class="dashboard-activity-delta ${cls}">${item.delta > 0 ? '+' : ''}${item.delta.toFixed(2)}€</div>
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

function renderDashboardObjective() {
    const el = document.getElementById('dashboard-objective-body');
    const best = dashboardFindBestObjective();

    if (!best) {
        el.innerHTML = `
            <p class="dashboard-empty-text">Aucun objectif sélectionné</p>
            <p class="dashboard-empty-subtext">Choisissez une série depuis l'onglet Progression.</p>
        `;
        return;
    }

    const pctDisplay = Math.round(best.pct * 100);
    const safeName = (best.setName || '').replace(/'/g, "\\'");

    el.innerHTML = `
        <div class="dashboard-objective-row">
            ${best.logoUrl ? `<img src="${best.logoUrl}" alt="" class="dashboard-objective-logo" onerror="this.remove()">` : ''}
            <div class="dashboard-objective-name">${escapeHtml(best.setName)}</div>
        </div>
        <div class="progression-progress-bar"><div class="progression-progress-fill" style="width:${pctDisplay}%"></div></div>
        <div class="dashboard-objective-count">${best.owned} / ${best.total} cartes · ${pctDisplay}%</div>
        <button class="dashboard-btn-primary dashboard-btn-full" onclick="dashboardGoToProgressionSet('${best.setId}', '${safeName}', '${best.logoUrl}')">Continuer la série</button>
    `;
}

// ===== EVOLUTION DE LA VALEUR (7 JOURS) =====

async function dashboardLoadValueHistory() {
    const { data, error } = await supabaseClient
        .from('value_history')
        .select('*')
        .order('recorded_at', { ascending: true })
        .limit(200);

    dashboardValueHistoryData = (!error && data) ? data : [];
}

function renderDashboardValueChart() {
    const body = document.getElementById('dashboard-chart-body');
    const data = (dashboardValueHistoryData || []).filter(d => new Date(d.recorded_at).getTime() >= Date.now() - 7 * 24 * 60 * 60 * 1000);

    if (data.length < 2) {
        body.innerHTML = '<p class="dashboard-empty-text">Historique pas encore disponible</p>';
        dashboardValueChartInstance = null;
        return;
    }

    body.innerHTML = '<canvas id="dashboard-value-chart"></canvas>';
    const canvas = document.getElementById('dashboard-value-chart');
    if (!canvas || typeof Chart === 'undefined') return;

    const labels = data.map(d => new Date(d.recorded_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }));
    const values = data.map(d => Number(d.total_value));
    const trendUp = values[values.length - 1] >= values[0];
    const lineColor = trendUp ? '#4ade80' : '#ff6b6b';
    const fillColor = trendUp ? 'rgba(74, 222, 128, 0.12)' : 'rgba(255, 107, 107, 0.1)';

    if (dashboardValueChartInstance) dashboardValueChartInstance.destroy();

    dashboardValueChartInstance = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                data: values,
                borderColor: lineColor,
                backgroundColor: fillColor,
                fill: true,
                tension: 0.3,
                pointRadius: 0,
                pointHitRadius: 10,
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.y.toFixed(2)}€` } }
            },
            scales: {
                y: { beginAtZero: true },
                x: { ticks: { maxTicksLimit: 7, autoSkip: true } }
            }
        }
    });
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
            <span class="dashboard-mover-delta dashboard-positive">+${m.delta.toFixed(2)}€</span>
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
        <div class="dashboard-acquisition-card" onclick="showCardDetail(${c.id})">
            <div class="dashboard-acquisition-card-img-wrap">
                ${c.image
                    ? `<img src="${c.image}" alt="${escapeHtml(c.name)}" loading="lazy" onerror="this.style.display='none'">`
                    : '<div class="no-image-placeholder thumb"><i class="ti ti-photo-off" aria-hidden="true"></i></div>'
                }
            </div>
            <div class="dashboard-acquisition-name">${escapeHtml(c.name)}</div>
            ${Number(c.market_value || 0) > 0 ? `<div class="dashboard-acquisition-value">${Number(c.market_value).toFixed(2)}€</div>` : ''}
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
            <button class="dashboard-btn-secondary" onclick="dashboardGoToTab('tab-wishlist', 'tab-btn-wishlist')">Voir mes souhaits</button>
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
    const items = allWishlistItems.filter(i => !(i.tcgdex_id && ownedTcgdexIds.has(i.tcgdex_id))).slice(0, 3);

    if (items.length === 0) {
        el.innerHTML = dashboardWishlistEmptyHtml('Toutes vos cartes en wishlist sont déjà possédées');
        return;
    }

    el.innerHTML = items.map(item => `
        <div class="dashboard-wishlist-row">
            ${item.image
                ? `<img src="${item.image}" alt="${escapeHtml(item.name)}" class="dashboard-wishlist-img" onerror="this.style.display='none'">`
                : '<div class="no-image-placeholder thumb"><i class="ti ti-photo-off" aria-hidden="true"></i></div>'
            }
            <div class="dashboard-wishlist-text">
                <div class="dashboard-wishlist-name">${escapeHtml(item.name)}</div>
                <div class="dashboard-wishlist-set">${escapeHtml(item.series || '')}</div>
            </div>
        </div>
    `).join('');
}
