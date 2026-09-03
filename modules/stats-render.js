// Dashboard de l'onglet Stats - Pokémon Tracker
// Dépend de: supabaseClient/allCollectionCards/renderPriceMovers (tracker.js), getDuplicateGroupKey (collection.js),
// computeProgressionKpiData/allTcgdexSeries/loadSeriesProgress (progression.js), allWishlistItems (wishlist.js), Chart,
// initHoloGridEffect (card-grid-renderer.js)
// Etat possédé : rarityChartInstance, seriesValueChartInstance, valueHistoryChartInstance, valueHistoryRawData,
// currentValueHistoryRange, timelineChartInstance

let rarityChartInstance = null;
let seriesValueChartInstance = null;
let valueHistoryChartInstance = null;
let valueHistoryRawData = [];
let currentValueHistoryRange = 30;
let timelineChartInstance = null;

const STX_PALETTE = ['#e3bc84', '#3FA7A1', '#6bcbff', '#95e1a3', '#c77dff', '#ff9f6b', '#ff6b6b', '#8A93A6'];

// Chart.js anime ses tracés sur <canvas> indépendamment du CSS - le filet de sécurité global
// prefers-reduced-motion (motion-components.css) n'a donc aucune prise dessus, contrairement au
// reste du site. `defaultAnimation` reprend la config de chaque graphique (ou true pour son défaut),
// remplacée par `false` (aucune animation Chart.js) sous la préférence système.
function stxChartAnimation(defaultAnimation) {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? false : defaultAnimation;
}

// Rend un conteneur cliquable pour ouvrir la fiche carte (showCardDetail, modules/card-detail.js),
// même comportement que dans Collection. Utilisé partout où une carte possédée est référencée
// sur la page Statistiques (Records, Top hausses/baisses).
function stxMakeCardClickable(containerId, cardId) {
    const el = document.getElementById(containerId);
    if (!el || !cardId) return;
    el.classList.add('stx-clickable-card');
    el.onclick = () => showCardDetail(cardId);
}

// Ouvre une série/extension dans l'onglet Progression (openSetProgression, modules/progression.js),
// même écran que lorsqu'on clique un set depuis la liste des séries. Le setId TCGdex et le logo sont
// dérivés d'une carte possédée de cette série (même logique que le rattrapage logo, tracker.js).
function stxOpenSeries(seriesName) {
    const card = allCollectionCards.find(c => c.series === seriesName && c.tcgdex_id);
    if (!card) return;
    const setId = getSetIdFromTcgdexId(card.tcgdex_id);
    if (!setId) return;
    navigateToTab('tab-progression');
    openSetProgression(setId, seriesName, card.series_logo || '');
}

// Balise <span> cliquable pour un nom de série, réutilisée partout où "Par extension",
// "Répartition valeur / série" ou "Extension préférée" affichent un nom de série.
function stxSeriesLinkHtml(seriesName) {
    const safeName = (seriesName || '').replace(/'/g, "\\'");
    return `<span class="stx-series-link" onclick="event.stopPropagation(); stxOpenSeries('${safeName}')">${seriesName}</span>`;
}

// Couleurs officielles des types Pokémon (mêmes teintes que les icônes d'énergie), utilisées
// dans "Par type" (section Composition) pour que la couleur corresponde au type réel.
const TYPE_COLORS = {
    'plante': '#7FAE73',
    'feu': '#C96A5D',
    'eau': '#6FA3C8',
    'electrik': '#D8B85C',
    'electrique': '#D8B85C',
    'psy': '#8E6BAF',
    'combat': '#A97B4B',
    'poison': '#A468B4',
    'sol': '#D9A441',
    'vol': '#8FA8DE',
    'insecte': '#9DB93C',
    'roche': '#B7A05C',
    'spectre': '#6E5C96',
    'dragon': '#6F7BFF',
    'tenebres': '#7B7A8D',
    'obscurite': '#7B7A8D',
    'acier': '#B7B9D0',
    'fee': '#F0A6C4',
    'incolore': '#C8C5BC',
    'metal': '#B7B9D0'
};

function getTypeColor(label, fallbackIndex) {
    return TYPE_COLORS[normalizeForMatch(label)] || STX_PALETTE[fallbackIndex % STX_PALETTE.length];
}

async function renderStatsCharts() {
    // statsNeedsRefresh reste vrai pendant toute la durée d'un rendu (mis à false seulement en fin de
    // fonction) : statsRenderInProgress est le vrai verrou anti-réentrance, empêchant un second appel
    // concurrent de démarrer un second rendu (ex: double clic rapide sur l'onglet Statistiques).
    if (!statsNeedsRefresh || statsRenderInProgress) return;
    // Verrou pose AVANT l'await (pas apres) : ensureChartLoaded() peut prendre plusieurs centaines de
    // ms au premier appel (chargement Chart.js a la demande, cf utils.js) - sans ca, un second appel
    // concurrent pendant ce chargement passerait le garde-fou ci-dessus avant que ce verrou soit pose.
    statsRenderInProgress = true;
    await ensureChartLoaded();
    // Capturée avant le rendu, comparée après : si une mutation a appelé markStatsDirty() pendant que
    // ce rendu tournait (ex: ajout d'une carte dans un autre onglet resté ouvert), la version aura
    // avancé et ce rendu ne doit pas se marquer propre avec des données déjà périmées.
    const versionAtStart = statsRenderVersion;

    try {
        // Couleurs de texte/grille adaptées au thème sombre
        Chart.defaults.color = '#8A93A6';
        Chart.defaults.borderColor = 'rgba(255,255,255,0.08)';
        Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

        // Les séries TCGdex ne sont chargées qu'à la première visite de l'onglet Progression :
        // on les charge ici aussi si besoin pour que "Séries complétées" soit correct.
        if (typeof allTcgdexSeries !== 'undefined' && allTcgdexSeries.length === 0 && typeof loadSeriesProgress === 'function') {
            loadSeriesProgress().then(renderStatsOverview);
        }

        // runSafe (utils.js) isole chaque section : avant, une exception dans un graphique
        // interrompait toute la suite de la sequence (les sections suivantes ne se rendaient jamais).
        runSafe(renderStatsKpis, 'stats-kpis');
        runSafe(renderStatsOverview, 'stats-overview');
        await loadMonthlySummaryOptions();
        await renderMonthlySummary();
        await renderStxTimeline();
        runSafe(renderRarityChart, 'rarity-chart');
        runSafe(renderTypeBarlist, 'type-barlist');
        runSafe(renderExtBarlist, 'ext-barlist');
        runSafe(renderSeriesValueChart, 'series-value-chart');
        runSafe(renderStxTopMovers, 'stx-top-movers');
        runSafe(renderStatsHabits, 'stats-habits');
        runSafe(renderStatsRecords, 'stats-records');
        await loadValueHistoryData();
        runSafe(renderValueHistoryChart, 'value-history-chart');
        runSafe(renderPriceMovers, 'price-movers');

        if (statsRenderVersion === versionAtStart) {
            statsNeedsRefresh = false;
        }
        // sinon : une mutation plus récente est survenue pendant ce rendu, reste dirty, sera rejouée
        // à la prochaine visite de l'onglet.
    } catch (error) {
        console.error('Erreur lors du rendu des statistiques:', error);
        // ne touche pas statsNeedsRefresh : reste dirty, une prochaine visite réessaiera.
    } finally {
        statsRenderInProgress = false;
    }
}

function formatMonthLabel(monthKey) {
    const [year, month] = monthKey.split('-').map(Number);
    const date = new Date(year, month - 1, 1);
    const label = date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    return label.charAt(0).toUpperCase() + label.slice(1);
}

function getCurrentMonthKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

async function loadMonthlySummaryOptions() {
    const select = document.getElementById('month-summary-select');
    const currentMonthKey = getCurrentMonthKey();

    const { data, error } = await supabaseClient
        .from('monthly_summary')
        .select('month')
        .order('month', { ascending: false });

    const months = (!error && data) ? data.map(row => row.month) : [];
    if (!months.includes(currentMonthKey)) months.unshift(currentMonthKey);

    const previousSelection = select.value;
    select.innerHTML = months.map(m => `<option value="${m}">${formatMonthLabel(m)}</option>`).join('');
    select.value = months.includes(previousSelection) ? previousSelection : currentMonthKey;
}

async function renderMonthlySummary() {
    const select = document.getElementById('month-summary-select');
    const monthKey = select.value || getCurrentMonthKey();

    const countEl = document.getElementById('month-cards-added');
    const spentEl = document.getElementById('month-spent');
    const valueAddedEl = document.getElementById('month-value-added');

    const { data, error } = await supabaseClient
        .from('monthly_summary')
        .select('*')
        .eq('month', monthKey)
        .maybeSingle();

    if (error || !data) {
        countEl.textContent = '0';
        spentEl.textContent = '0.00€';
        valueAddedEl.textContent = '0.00€';
        return;
    }

    countEl.textContent = data.cards_added || 0;
    spentEl.textContent = formatPrice(data.total_spent);
    valueAddedEl.textContent = formatPrice(data.value_added);
}

// ===== 6. TIMELINE : une carte par mois, reprend les lignes de monthly_summary déjà utilisées ci-dessus =====
async function renderStxTimeline() {
    const container = document.getElementById('stx-timeline-row');
    const canvas = document.getElementById('stx-timeline-chart');
    if (!container) return;

    container.innerHTML = Array.from({ length: 3 }).map(() => `
        <div class="stx-month-card">
            <div class="skeleton" style="height:12px; width:70%; margin-bottom:8px;"></div>
            <div class="skeleton" style="height:14px; width:50%; margin-bottom:6px;"></div>
            <div class="skeleton" style="height:10px; width:60%;"></div>
        </div>
    `).join('');

    const { data, error } = await supabaseClient
        .from('monthly_summary')
        .select('*')
        .order('month', { ascending: true });

    if (error || !data || data.length === 0) {
        container.innerHTML = '<p class="stx-timeline-empty">Pas encore d\'historique mensuel.</p>';
        if (timelineChartInstance) { timelineChartInstance.destroy(); timelineChartInstance = null; }
        return;
    }

    const currentMonthKey = getCurrentMonthKey();
    container.innerHTML = data.map(row => `
        <div class="stx-month-card${row.month === currentMonthKey ? ' active' : ''}">
            <div class="stx-month-label">${formatMonthLabel(row.month)}</div>
            <div class="stx-month-value">+${row.cards_added || 0} cartes</div>
            <div class="stx-month-sub">+${formatPrice(row.value_added)}</div>
        </div>
    `).join('');

    // Résumé visuel compact du même jeu de données (mensuel, cf. ci-dessus) : barres = cartes
    // ajoutées, courbe = valeur ajoutée. Aucun nouveau calcul, mêmes colonnes monthly_summary.
    if (canvas && typeof Chart !== 'undefined') {
        const labels = data.map(row => formatMonthLabel(row.month).split(' ')[0].slice(0, 3));
        const cardsData = data.map(row => Number(row.cards_added || 0));
        const valueData = data.map(row => Number(row.value_added || 0));

        if (timelineChartInstance) timelineChartInstance.destroy();

        timelineChartInstance = new Chart(canvas, {
            data: {
                labels,
                datasets: [
                    {
                        type: 'bar',
                        label: 'Cartes ajoutées',
                        data: cardsData,
                        backgroundColor: '#e3bc84',
                        borderRadius: 2,
                        barPercentage: 0.55,
                        yAxisID: 'y'
                    },
                    {
                        type: 'line',
                        label: 'Valeur ajoutée',
                        data: valueData,
                        borderColor: '#a78bfa',
                        backgroundColor: '#a78bfa',
                        borderWidth: 2,
                        tension: 0.3,
                        pointRadius: 4,
                        pointBackgroundColor: '#a78bfa',
                        pointBorderColor: '#1A1A1E',
                        pointBorderWidth: 1.5,
                        pointHitRadius: 8,
                        fill: false,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: stxChartAnimation(true),
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        align: 'start',
                        labels: {
                            boxWidth: 10,
                            boxHeight: 10,
                            color: 'rgba(255,255,255,0.65)',
                            font: { size: 11 },
                            padding: 14
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => ctx.dataset.type === 'line' ? formatPrice(ctx.parsed.y) : `${ctx.parsed.y} cartes`
                        }
                    }
                },
                scales: {
                    y: {
                        display: true,
                        beginAtZero: true,
                        title: { display: true, text: 'Cartes', color: 'rgba(255,255,255,0.4)', font: { size: 10 } },
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { color: 'rgba(255,255,255,0.4)', font: { size: 10 } }
                    },
                    y1: {
                        display: true,
                        beginAtZero: true,
                        position: 'right',
                        title: { display: true, text: 'Valeur (€)', color: 'rgba(255,255,255,0.4)', font: { size: 10 } },
                        grid: { display: false },
                        ticks: {
                            color: 'rgba(255,255,255,0.4)',
                            font: { size: 10 },
                            callback: (v) => `${v}€`
                        }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 10 } }
                    }
                }
            }
        });
    }
}

// ===== 1. VUE D'ENSEMBLE =====
function renderStatsOverview() {
    const cardsEl = document.getElementById('stx-ov-cards');
    const seriesEl = document.getElementById('stx-ov-series');
    const seriesSubEl = document.getElementById('stx-ov-series-sub');
    const valueEl = document.getElementById('stx-ov-value');
    const investedEl = document.getElementById('stx-ov-invested');
    const wishlistEl = document.getElementById('stx-ov-wishlist');
    if (!cardsEl) return;

    // Réutilise les totaux déjà calculés par updateStats() (modules/stats.js), affichés dans le hero global.
    cardsEl.textContent = document.getElementById('total-cards')?.textContent || '0';
    valueEl.textContent = document.getElementById('hero-total-value')?.textContent || '0€';
    investedEl.textContent = document.getElementById('total-spent')?.textContent || '0€';

    if (typeof allWishlistItems !== 'undefined') {
        wishlistEl.textContent = allWishlistItems.length;
    }

    if (typeof computeProgressionKpiData === 'function' && typeof allTcgdexSeries !== 'undefined' && allTcgdexSeries.length > 0) {
        const { completed } = computeProgressionKpiData();
        const totalSets = allTcgdexSeries.reduce((sum, s) => sum + (s.sets || []).length, 0);
        seriesEl.textContent = completed;
        seriesSubEl.textContent = `Sur ${totalSets} séries`;
    } else {
        seriesEl.textContent = '-';
        seriesSubEl.textContent = '';
    }
}

// ===== KPI "Records" — carte la plus chère (repris dans la section Records) =====
function renderStatsKpis() {
    const topCardEl = document.getElementById('kpi-top-card');
    const topCardPriceEl = document.getElementById('kpi-top-card-price');
    const topSeriesEl = document.getElementById('stx-record-top-series');
    const topImgEl = document.getElementById('stx-record-top-img');
    if (!topCardEl) return;

    if (allCollectionCards.length === 0) {
        topCardEl.textContent = '-';
        topCardPriceEl.textContent = '';
        return;
    }

    const topCard = [...allCollectionCards].sort((a, b) => Number(b.market_value || 0) - Number(a.market_value || 0))[0];
    topCardEl.textContent = topCard.name;
    topCardPriceEl.textContent = formatPrice(topCard.market_value);
    if (topSeriesEl) topSeriesEl.textContent = (topCard.series && topCard.series !== 'N/A') ? topCard.series : '';
    if (topImgEl) {
        if (topCard.image) {
            topImgEl.src = topCard.image;
            topImgEl.style.display = '';
        } else {
            topImgEl.style.display = 'none';
        }
    }
    stxMakeCardClickable('stx-record-top-card', topCard.id);
}

// ===== 2. COMPOSITION : par rareté (donut + légende) =====
function renderRarityChart() {
    const canvas = document.getElementById('rarity-chart');
    const legendEl = document.getElementById('rarity-legend');
    const totalEl = document.getElementById('rarity-legend-total');
    if (!canvas) return;

    const counts = {};
    allCollectionCards.forEach(card => {
        const key = card.rarity || 'Non renseignée';
        counts[key] = (counts[key] || 0) + Number(card.quantity || 1);
    });

    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const labels = entries.map(e => e[0]);
    const values = entries.map(e => e[1]);
    const total = values.reduce((s, v) => s + v, 0);

    if (rarityChartInstance) rarityChartInstance.destroy();

    if (labels.length === 0) {
        if (legendEl) legendEl.innerHTML = '';
        if (totalEl) totalEl.textContent = '0';
        return;
    }

    rarityChartInstance = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data: values,
                backgroundColor: STX_PALETTE,
                borderColor: '#1A1A1E',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '68%',
            animation: stxChartAnimation(true),
            plugins: { legend: { display: false } }
        }
    });

    if (legendEl) {
        legendEl.innerHTML = entries.map((e, i) => `
            <li>
                <span><span class="stx-legend-dot" style="background:${STX_PALETTE[i % STX_PALETTE.length]}"></span>${e[0]}</span>
                <span class="stx-legend-pct">${((e[1] / total) * 100).toFixed(1)}%</span>
            </li>
        `).join('');
    }
    if (totalEl) totalEl.textContent = total;
}

// ===== 2. COMPOSITION : par type (liste à barres) — reprend card.type, même découpage multi-type
// que getTypesIconsHtml (modules/utils.js) =====
function renderTypeBarlist() {
    const container = document.getElementById('type-barlist');
    const totalEl = document.getElementById('type-legend-total');
    if (!container) return;

    const counts = {};
    allCollectionCards.forEach(card => {
        const type = card.type;
        if (!type || type === 'N/A') return;
        type.split(',').map(t => t.trim()).filter(Boolean).forEach(t => {
            counts[t] = (counts[t] || 0) + Number(card.quantity || 1);
        });
    });

    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const total = Object.values(counts).reduce((s, v) => s + v, 0);

    if (entries.length === 0) {
        container.innerHTML = '<p style="color: var(--slate); font-size: 0.8rem; text-align:center; padding: 1rem 0;">Pas encore de données.</p>';
        if (totalEl) totalEl.textContent = '0';
        return;
    }

    const max = entries[0][1];
    container.innerHTML = entries.map(([label, count], i) => `
        <div class="stx-type-row">
            <span class="stx-type-icon">${getTypeIconHtml(label, 26)}</span>
            <span class="stx-type-name">${label}</span>
            <div class="stx-type-track"><div class="stx-type-fill" style="width:${(count / max) * 100}%; background:linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.35) 100%), ${getTypeColor(label, i)}"></div></div>
            <span class="stx-type-pct">${((count / total) * 100).toFixed(1)}%</span>
        </div>
    `).join('');
    if (totalEl) totalEl.textContent = total;
}

// ===== 2. COMPOSITION : par extension, Top 6 (liste à barres) — même regroupement card.series
// que l'ancien graphique "Top séries (par nombre de cartes)" =====
function renderExtBarlist() {
    const container = document.getElementById('ext-barlist');
    const totalEl = document.getElementById('ext-legend-total');
    if (!container) return;

    const counts = {};
    allCollectionCards.forEach(card => {
        const key = card.series;
        if (!key || key === 'N/A') return;
        counts[key] = (counts[key] || 0) + Number(card.quantity || 1);
    });

    const allEntries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const entries = allEntries.slice(0, 8);
    const total = Object.values(counts).reduce((s, v) => s + v, 0);

    if (entries.length === 0) {
        container.innerHTML = '<p style="color: var(--slate); font-size: 0.8rem; text-align:center; padding: 1rem 0;">Pas encore de données.</p>';
        if (totalEl) totalEl.textContent = '0';
        return;
    }

    const max = entries[0][1];
    container.innerHTML = entries.map(([label, count], i) => {
        const safeName = label.replace(/'/g, "\\'");
        return `
        <div class="stx-ext-row">
            <span class="stx-ext-dot" style="background:${STX_PALETTE[i % STX_PALETTE.length]}"></span>
            <span class="stx-ext-name stx-series-link" onclick="stxOpenSeries('${safeName}')">${label}</span>
            <div class="stx-ext-track"><div class="stx-ext-fill" style="width:${(count / max) * 100}%; background:linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.35) 100%), ${STX_PALETTE[i % STX_PALETTE.length]}"></div></div>
            <span class="stx-ext-pct">${((count / total) * 100).toFixed(1)}%</span>
        </div>
    `;
    }).join('');
    if (totalEl) totalEl.textContent = total;
}

// ===== 3. VALEUR & INVESTISSEMENT : répartition de la valeur par série (donut + légende) — même
// calcul de totaux par série que l'ancien graphique "Top séries (par valeur)", regroupé Top 5 + Autres =====
// Info-bulle HTML personnalisee (audit design 2026-09) : le tooltip natif de Chart.js ne peut pas
// afficher d'image, donc le logo du set repose sur le mode "external" de Chart.js qui delegue tout
// le rendu a ce noeud, cree une seule fois et reutilise a chaque survol (meme principe que
// .nav-progress-bar dans tracker.js).
let seriesValueTooltipEl = null;
function getSeriesValueTooltipEl() {
    if (!seriesValueTooltipEl) {
        seriesValueTooltipEl = document.createElement('div');
        seriesValueTooltipEl.className = 'stx-chart-tooltip';
        document.body.appendChild(seriesValueTooltipEl);
    }
    return seriesValueTooltipEl;
}

function seriesValueTooltipHandler(context, entries, seriesLogoMap, grandTotal) {
    const { chart, tooltip } = context;
    const el = getSeriesValueTooltipEl();

    if (tooltip.opacity === 0) {
        el.style.opacity = '0';
        return;
    }

    const dp = tooltip.dataPoints && tooltip.dataPoints[0];
    if (dp) {
        const [label, value] = entries[dp.dataIndex];
        const logoUrl = seriesLogoMap[label];
        const pct = grandTotal > 0 ? ((value / grandTotal) * 100).toFixed(1) : '0.0';
        el.innerHTML = `
            ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="" class="stx-chart-tooltip-logo" onerror="this.remove()">` : ''}
            <div class="stx-chart-tooltip-text">
                <div class="stx-chart-tooltip-title">${escapeHtml(label)}</div>
                <div class="stx-chart-tooltip-value">${formatPrice(value)} · ${pct}%</div>
            </div>
        `;
    }

    const rect = chart.canvas.getBoundingClientRect();
    el.style.opacity = '1';
    el.style.left = `${rect.left + tooltip.caretX}px`;
    el.style.top = `${rect.top + tooltip.caretY}px`;
}

function renderSeriesValueChart() {
    const canvas = document.getElementById('series-value-chart');
    const legendEl = document.getElementById('series-value-legend');
    const totalEl = document.getElementById('series-value-total');
    if (!canvas) return;

    const totals = {};
    const seriesLogoMap = {};
    allCollectionCards.forEach(card => {
        const key = card.series;
        if (!key || key === 'N/A') return;
        totals[key] = (totals[key] || 0) + Number(card.market_value || 0) * Number(card.quantity || 1);
        if (card.series_logo && !seriesLogoMap[key]) seriesLogoMap[key] = card.series_logo;
    });

    const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
    const top5 = sorted.slice(0, 5);
    const othersTotal = sorted.slice(5).reduce((s, [, v]) => s + v, 0);
    const entries = othersTotal > 0 ? [...top5, ['Autres', othersTotal]] : top5;

    const labels = entries.map(e => e[0]);
    const values = entries.map(e => e[1]);
    const grandTotal = values.reduce((s, v) => s + v, 0);

    if (seriesValueChartInstance) seriesValueChartInstance.destroy();
    if (seriesValueTooltipEl) seriesValueTooltipEl.style.opacity = '0';

    if (labels.length === 0) {
        if (legendEl) legendEl.innerHTML = '';
        if (totalEl) totalEl.textContent = '-';
        return;
    }

    seriesValueChartInstance = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data: values,
                backgroundColor: STX_PALETTE,
                borderColor: '#1A1A1E',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '68%',
            animation: stxChartAnimation(true),
            plugins: {
                legend: { display: false },
                tooltip: {
                    enabled: false,
                    external: (context) => seriesValueTooltipHandler(context, entries, seriesLogoMap, grandTotal)
                }
            }
        }
    });

    if (legendEl) {
        legendEl.innerHTML = entries.map((e, i) => `
            <li>
                <span><span class="stx-legend-dot" style="background:${STX_PALETTE[i % STX_PALETTE.length]}"></span>${e[0] === 'Autres' ? e[0] : stxSeriesLinkHtml(e[0])}</span>
                <span class="stx-legend-pct">${grandTotal > 0 ? ((e[1] / grandTotal) * 100).toFixed(1) : '0.0'}%</span>
            </li>
        `).join('');
    }
    if (totalEl) totalEl.textContent = formatPrice(grandTotal);
}

// Calcule la liste des cartes avec prix payé renseigné, triée par variation % décroissante.
// Réutilisé par le Top hausses/baisses et les records "plus grosse hausse/baisse".
function computeRoiCandidates() {
    return allCollectionCards
        .filter(c => Number(c.purchase_price) > 0)
        .map(c => {
            const purchase = Number(c.purchase_price);
            const current = Number(c.market_value || 0);
            const qty = Number(c.quantity || 1);
            const gainPercent = ((current - purchase) / purchase) * 100;
            const gainAmount = (current - purchase) * qty;
            return { id: c.id, name: c.name, number: c.number, image: c.image, series: c.series, gainPercent, gainAmount };
        })
        .sort((a, b) => b.gainPercent - a.gainPercent);
}

function stxMoverRowHtml(c, useAmount = false) {
    const metric = useAmount ? c.gainAmount : c.gainPercent;
    const cls = metric > 0 ? 'positive' : metric < 0 ? 'negative' : 'neutral';
    const sign = metric > 0 ? '+' : '';
    const label = useAmount ? `${sign}${formatPrice(c.gainAmount)}` : `${sign}${c.gainPercent.toFixed(0)}% <span class="period-value-abs">(${c.gainAmount > 0 ? '+' : ''}${formatPrice(c.gainAmount)})</span>`;
    return `
        <div class="mover-row stx-clickable-card" onclick="showCardDetail(${c.id})">
            <span class="mover-name">${escapeHtml(c.name)} <span class="mover-number">#${c.number}</span></span>
            <span class="mover-delta ${cls}">${label}</span>
        </div>
    `;
}

// ===== 3. VALEUR & INVESTISSEMENT : Top 3 hausses/baisses =====
function renderStxTopMovers() {
    const gainsEl = document.getElementById('stx-top-gains');
    const lossesEl = document.getElementById('stx-top-losses');
    if (!gainsEl) return;

    const candidates = computeRoiCandidates();
    if (candidates.length === 0) {
        const emptyMsg = '<p style="text-align: center; color: var(--slate); padding: 0.5rem;">Aucune carte avec un prix payé renseigné.</p>';
        if (gainsEl) gainsEl.innerHTML = emptyMsg;
        if (lossesEl) lossesEl.innerHTML = emptyMsg;
        return;
    }

    const top3Gains = candidates.slice(0, 3);
    const top3Losses = candidates.slice(-3).reverse();

    if (gainsEl) gainsEl.innerHTML = top3Gains.map(c => stxMoverRowHtml(c)).join('');
    if (lossesEl) lossesEl.innerHTML = top3Losses.map(c => stxMoverRowHtml(c)).join('');
}

// ===== 4. HABITUDES DE COLLECTION =====
function renderStatsHabits() {
    const avgPriceEl = document.getElementById('stx-habit-avg-price');
    const topSeriesEl = document.getElementById('stx-habit-top-series');
    const topTypeEl = document.getElementById('stx-habit-top-type');
    const topIllustratorEl = document.getElementById('stx-habit-top-illustrator');
    const conditionEl = document.getElementById('stx-habit-condition');
    const conditionSubEl = document.getElementById('stx-habit-condition-sub');
    if (!avgPriceEl) return;

    if (allCollectionCards.length === 0) {
        [avgPriceEl, topSeriesEl, topTypeEl, topIllustratorEl, conditionEl].forEach(el => { if (el) el.textContent = '-'; });
        return;
    }

    // Prix moyen par carte — même formule que l'ancien KPI "Prix moyen / carte"
    const totalQty = allCollectionCards.reduce((sum, c) => sum + Number(c.quantity || 1), 0);
    const totalValue = allCollectionCards.reduce((sum, c) => sum + Number(c.market_value || 0) * Number(c.quantity || 1), 0);
    avgPriceEl.textContent = formatPrice(totalQty > 0 ? totalValue / totalQty : 0);

    // Extension préférée — reprend le regroupement par série (renderExtBarlist)
    const seriesCounts = {};
    allCollectionCards.forEach(card => {
        if (!card.series || card.series === 'N/A') return;
        seriesCounts[card.series] = (seriesCounts[card.series] || 0) + Number(card.quantity || 1);
    });
    const topSeries = Object.entries(seriesCounts).sort((a, b) => b[1] - a[1])[0];
    topSeriesEl.innerHTML = topSeries ? stxSeriesLinkHtml(topSeries[0]) : '-';

    // Type préféré — reprend le regroupement par type (renderTypeBarlist)
    const typeCounts = {};
    allCollectionCards.forEach(card => {
        if (!card.type || card.type === 'N/A') return;
        card.type.split(',').map(t => t.trim()).filter(Boolean).forEach(t => {
            typeCounts[t] = (typeCounts[t] || 0) + Number(card.quantity || 1);
        });
    });
    const topType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0];
    topTypeEl.textContent = topType ? topType[0] : '-';

    // Illustrateur le plus présent
    const illustratorCounts = {};
    allCollectionCards.forEach(card => {
        if (!card.illustrator) return;
        illustratorCounts[card.illustrator] = (illustratorCounts[card.illustrator] || 0) + Number(card.quantity || 1);
    });
    const topIllustrator = Object.entries(illustratorCounts).sort((a, b) => b[1] - a[1])[0];
    topIllustratorEl.textContent = topIllustrator ? topIllustrator[0] : '-';

    // État moyen — % de cartes en Near Mint (condition NM)
    const conditionCounts = {};
    allCollectionCards.forEach(card => {
        const cond = card.condition || 'NM';
        conditionCounts[cond] = (conditionCounts[cond] || 0) + Number(card.quantity || 1);
    });
    const nmPct = totalQty > 0 ? ((conditionCounts['NM'] || 0) / totalQty) * 100 : 0;
    conditionEl.textContent = `${nmPct.toFixed(0)}%`;
    if (conditionSubEl) conditionSubEl.textContent = 'Near Mint';
}

// ===== 5. RECORDS DE COLLECTION =====
function renderStatsRecords() {
    const oldestNameEl = document.getElementById('stx-record-oldest-name');
    if (!oldestNameEl) return;

    // Survol holographique (retour utilisateur 2026-09, meme mecanique que la Galerie Collection,
    // card-grid-renderer.js) : les 6 vignettes sont du HTML statique (index.html), jamais regenerees -
    // contrairement aux grilles dynamiques ou holoEffect est un flag passe a renderGridCardHtml a
    // chaque rendu, initHoloGridEffect() est donc appele ici plutot que la-bas. Idempotent (dataset.
    // holoBound, card-grid-renderer.js) : sans risque a rappeler a chaque renderStatsRecords().
    initHoloGridEffect(document.querySelector('.stx-records-grid'));

    if (allCollectionCards.length === 0) return;

    // Carte achetée la plus chère — reprend card.purchase_price (même pattern que "carte la plus
    // chère" trié sur market_value)
    const withPaidPrice = allCollectionCards.filter(c => Number(c.purchase_price) > 0);
    if (withPaidPrice.length > 0) {
        const mostExpensivePaid = [...withPaidPrice].sort((a, b) => Number(b.purchase_price) - Number(a.purchase_price))[0];
        const paidNameEl = document.getElementById('stx-record-paid-name');
        const paidPriceEl = document.getElementById('stx-record-paid-price');
        paidNameEl.textContent = mostExpensivePaid.name;
        paidNameEl.classList.remove('stx-trophy-empty');
        const paidSeriesEl = document.getElementById('stx-record-paid-series');
        if (paidSeriesEl) paidSeriesEl.textContent = (mostExpensivePaid.series && mostExpensivePaid.series !== 'N/A') ? mostExpensivePaid.series : '';
        paidPriceEl.textContent = formatPrice(mostExpensivePaid.purchase_price);
        paidPriceEl.classList.remove('stx-trophy-empty', 'stx-trophy-value-sm');
        const img = document.getElementById('stx-record-paid-img');
        if (img) {
            if (mostExpensivePaid.image) { img.src = mostExpensivePaid.image; img.style.display = ''; }
            else img.style.display = 'none';
        }
        stxMakeCardClickable('stx-record-paid-card', mostExpensivePaid.id);
    }

    // Carte la plus ancienne — reprend card.created_at (déjà utilisé pour la date d'ajout en édition)
    const withDate = allCollectionCards.filter(c => c.created_at);
    if (withDate.length > 0) {
        const oldest = [...withDate].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))[0];
        oldestNameEl.textContent = oldest.name;
        const oldestSeriesEl = document.getElementById('stx-record-oldest-series');
        if (oldestSeriesEl) oldestSeriesEl.textContent = (oldest.series && oldest.series !== 'N/A') ? oldest.series : '';
        document.getElementById('stx-record-oldest-date').textContent = `Depuis le ${new Date(oldest.created_at).toLocaleDateString('fr-FR')}`;
        const img = document.getElementById('stx-record-oldest-img');
        if (img) {
            if (oldest.image) { img.src = oldest.image; img.style.display = ''; }
            else img.style.display = 'none';
        }
        stxMakeCardClickable('stx-record-oldest-card', oldest.id);
    }

    // Plus grosse hausse / baisse en valeur — reprend les mêmes candidats que le ROI (computeRoiCandidates)
    const candidates = computeRoiCandidates();
    if (candidates.length > 0) {
        const byAmount = [...candidates].sort((a, b) => b.gainAmount - a.gainAmount);
        const biggestGain = byAmount[0];
        const biggestLoss = byAmount[byAmount.length - 1];

        if (biggestGain && biggestGain.gainAmount > 0) {
            const gainNameEl = document.getElementById('stx-record-gain-name');
            const gainAmountEl = document.getElementById('stx-record-gain-amount');
            gainNameEl.textContent = biggestGain.name;
            gainNameEl.classList.remove('stx-trophy-empty');
            const gainSeriesEl = document.getElementById('stx-record-gain-series');
            if (gainSeriesEl) gainSeriesEl.textContent = (biggestGain.series && biggestGain.series !== 'N/A') ? biggestGain.series : `#${biggestGain.number}`;
            gainAmountEl.textContent = `+${formatPrice(biggestGain.gainAmount)}`;
            gainAmountEl.classList.remove('stx-trophy-empty', 'stx-trophy-value-sm');
            const gainPctEl = document.getElementById('stx-record-gain-pct');
            if (gainPctEl) gainPctEl.textContent = `+${biggestGain.gainPercent.toFixed(0)}%`;
            const img = document.getElementById('stx-record-gain-img');
            if (img && biggestGain.image) { img.src = biggestGain.image; img.style.display = ''; }
            stxMakeCardClickable('stx-record-gain-card', biggestGain.id);
        }
        if (biggestLoss && biggestLoss.gainAmount < 0) {
            const lossNameEl = document.getElementById('stx-record-loss-name');
            const lossAmountEl = document.getElementById('stx-record-loss-amount');
            lossNameEl.textContent = biggestLoss.name;
            lossNameEl.classList.remove('stx-trophy-empty');
            const lossSeriesEl = document.getElementById('stx-record-loss-series');
            if (lossSeriesEl) lossSeriesEl.textContent = (biggestLoss.series && biggestLoss.series !== 'N/A') ? biggestLoss.series : `#${biggestLoss.number}`;
            lossAmountEl.textContent = formatPrice(biggestLoss.gainAmount);
            lossAmountEl.classList.remove('stx-trophy-empty', 'stx-trophy-value-sm');
            const lossPctEl = document.getElementById('stx-record-loss-pct');
            if (lossPctEl) lossPctEl.textContent = `${biggestLoss.gainPercent.toFixed(0)}%`;
            const img = document.getElementById('stx-record-loss-img');
            if (img && biggestLoss.image) { img.src = biggestLoss.image; img.style.display = ''; }
            stxMakeCardClickable('stx-record-loss-card', biggestLoss.id);
        }
    }

    // Carte la plus collectionnée — reprend card.quantity (exemplaires possédés par CET utilisateur,
    // pas de comparaison inter-utilisateurs possible : isolation RLS par user_id)
    const mostOwned = [...allCollectionCards].sort((a, b) => Number(b.quantity || 1) - Number(a.quantity || 1))[0];
    if (mostOwned) {
        document.getElementById('stx-record-most-name').textContent = mostOwned.name;
        const mostSeriesEl = document.getElementById('stx-record-most-series');
        if (mostSeriesEl) mostSeriesEl.textContent = (mostOwned.series && mostOwned.series !== 'N/A') ? mostOwned.series : '';
        document.getElementById('stx-record-most-qty').textContent = `×${Number(mostOwned.quantity || 1)} exemplaires`;
        const img = document.getElementById('stx-record-most-img');
        if (img) {
            if (mostOwned.image) { img.src = mostOwned.image; img.style.display = ''; }
            else img.style.display = 'none';
        }
        stxMakeCardClickable('stx-record-most-card', mostOwned.id);
    }
}

async function loadValueHistoryData() {
    const { data, error } = await supabaseClient
        .from('value_history')
        .select('*')
        .order('recorded_at', { ascending: false })
        .limit(500);

    // Idem dashboard.js : trier descendant avant le limit pour garder les 500 PLUS RECENTS points,
    // puis remettre en ordre chronologique pour l'affichage.
    valueHistoryRawData = (!error && data) ? data.slice().reverse() : [];
}

function setValueHistoryRange(event, days) {
    currentValueHistoryRange = days;
    document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    renderValueHistoryChart();
}

async function renderValueHistoryChart() {
    const canvas = document.getElementById('value-history-chart');
    if (!canvas || valueHistoryRawData.length === 0) return;
    // Garde propre (contrairement a renderRarityChart/renderSeriesValueChart) : accessible aussi via
    // setValueHistoryRange (boutons 7j/30j/Tout), en dehors du chemin renderStatsCharts qui a deja
    // attendu ensureChartLoaded() plus haut - un clic rapide juste apres la premiere ouverture de
    // l'onglet Statistiques pourrait sinon tomber avant la fin du chargement de Chart.js.
    await ensureChartLoaded();

    let data = valueHistoryRawData;
    if (currentValueHistoryRange > 0) {
        const cutoff = Date.now() - currentValueHistoryRange * 24 * 60 * 60 * 1000;
        data = data.filter(d => new Date(d.recorded_at).getTime() >= cutoff);
        if (data.length === 0) data = valueHistoryRawData.slice(-1); // filet de sécurité
    }

    const labels = data.map(d => new Date(d.recorded_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }));
    const values = data.map(d => Number(d.total_value));
    const trendUp = values[values.length - 1] >= values[0];
    const lineColor = trendUp ? '#e3bc84' : '#ff6b6b';
    const fillColor = trendUp ? 'rgba(227, 188, 132, 0.1)' : 'rgba(255, 107, 107, 0.06)';

    // Lecture rapide "valeur actuelle / variation sur la période" — dérivée des mêmes points
    // que le graphique (values), aucune donnée supplémentaire calculée.
    const evoValueEl = document.getElementById('stx-evo-value');
    const evoDeltaEl = document.getElementById('stx-evo-delta');
    if (evoValueEl && evoDeltaEl) {
        const current = values[values.length - 1];
        const delta = current - values[0];
        const pct = values[0] > 0 ? (delta / values[0]) * 100 : 0;
        evoValueEl.textContent = formatPrice(current);
        evoDeltaEl.textContent = `${delta >= 0 ? '+' : ''}${formatPrice(delta)} (${delta >= 0 ? '+' : ''}${pct.toFixed(1)}%)`;
        evoDeltaEl.className = `stx-evo-delta ${delta > 0 ? 'positive' : delta < 0 ? 'negative' : ''}`;
    }

    if (valueHistoryChartInstance) valueHistoryChartInstance.destroy();

    // Tracé progressif (retour utilisateur 2026-09, audit design) : la courbe se dessine de gauche à
    // droite plutôt que d'apparaître d'un bloc - recette Chart.js officielle (delay croissant par
    // point sur x ET y), pas la simple interpolation par défaut (animation:true ci-dessous avant ce
    // chantier) qui anime chaque point depuis l'axe X *en même temps*, sans effet de révélation
    // directionnelle. previousY() fait partir chaque point de la position Y du point précédent (pas
    // de zéro) : la ligne semble "s'étirer" d'un point au suivant plutôt que rebondir depuis le bas à
    // chaque segment. xStarted/yStarted sur le ctx (muté, pattern officiel Chart.js) : le délai ne
    // doit être appliqué qu'une fois par point, jamais à chaque frame d'interpolation de ce même point.
    const drawDuration = 600;
    const delayPerPoint = values.length > 1 ? drawDuration / values.length : 0;
    const previousY = (ctx) => {
        if (ctx.index === 0) return ctx.chart.scales.y.getPixelForValue(0);
        const meta = ctx.chart.getDatasetMeta(ctx.datasetIndex);
        const prevPoint = meta.data[ctx.index - 1];
        return prevPoint ? prevPoint.getProps(['y'], true).y : ctx.chart.scales.y.getPixelForValue(0);
    };
    const drawLineAnimation = {
        x: {
            type: 'number', easing: 'linear', duration: delayPerPoint, from: NaN,
            delay(ctx) {
                if (ctx.type !== 'data' || ctx.xStarted) return 0;
                ctx.xStarted = true;
                return ctx.index * delayPerPoint;
            }
        },
        y: {
            type: 'number', easing: 'linear', duration: delayPerPoint, from: previousY,
            delay(ctx) {
                if (ctx.type !== 'data' || ctx.yStarted) return 0;
                ctx.yStarted = true;
                return ctx.index * delayPerPoint;
            }
        }
    };

    valueHistoryChartInstance = new Chart(canvas, {
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
                borderWidth: 2.5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: stxChartAnimation(drawLineAnimation),
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => formatPrice(ctx.parsed.y),
                        // Variation vs le point precedent (retour utilisateur 2026-09, audit design) :
                        // chaque point du graphique est un total agrege par date, pas une carte
                        // individuelle - impossible d'y montrer une mini-carte (proposition initiale de
                        // l'audit, ecartee apres verification). La variation ligne a ligne est
                        // l'enrichissement qui a du sens ici a la place. Aucune ligne pour le tout
                        // premier point (rien avant) ni si la valeur n'a pas bouge (0,00€ vs jour
                        // precedent serait du bruit, pas une info).
                        afterLabel: (ctx) => {
                            const i = ctx.dataIndex;
                            if (i === 0) return undefined;
                            const delta = values[i] - values[i - 1];
                            if (delta === 0) return undefined;
                            return `${delta > 0 ? '+' : ''}${formatPrice(delta)} vs jour précédent`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(255,255,255,0.04)' },
                    ticks: { color: 'rgba(255,255,255,0.32)' }
                },
                x: {
                    grid: { display: false },
                    ticks: { maxTicksLimit: 8, autoSkip: true, color: 'rgba(255,255,255,0.32)' }
                }
            }
        }
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
window.rarityChartInstance = rarityChartInstance;
window.seriesValueChartInstance = seriesValueChartInstance;
window.valueHistoryChartInstance = valueHistoryChartInstance;
window.valueHistoryRawData = valueHistoryRawData;
window.currentValueHistoryRange = currentValueHistoryRange;
window.timelineChartInstance = timelineChartInstance;
window.STX_PALETTE = STX_PALETTE;
window.stxMakeCardClickable = stxMakeCardClickable;
window.stxOpenSeries = stxOpenSeries;
window.stxSeriesLinkHtml = stxSeriesLinkHtml;
window.TYPE_COLORS = TYPE_COLORS;
window.getTypeColor = getTypeColor;
window.renderStatsCharts = renderStatsCharts;
window.formatMonthLabel = formatMonthLabel;
window.getCurrentMonthKey = getCurrentMonthKey;
window.loadMonthlySummaryOptions = loadMonthlySummaryOptions;
window.renderMonthlySummary = renderMonthlySummary;
window.renderStxTimeline = renderStxTimeline;
window.renderStatsOverview = renderStatsOverview;
window.renderStatsKpis = renderStatsKpis;
window.renderRarityChart = renderRarityChart;
window.renderTypeBarlist = renderTypeBarlist;
window.renderExtBarlist = renderExtBarlist;
window.renderSeriesValueChart = renderSeriesValueChart;
window.computeRoiCandidates = computeRoiCandidates;
window.stxMoverRowHtml = stxMoverRowHtml;
window.renderStxTopMovers = renderStxTopMovers;
window.renderStatsHabits = renderStatsHabits;
window.renderStatsRecords = renderStatsRecords;
window.loadValueHistoryData = loadValueHistoryData;
window.setValueHistoryRange = setValueHistoryRange;
window.renderValueHistoryChart = renderValueHistoryChart;
