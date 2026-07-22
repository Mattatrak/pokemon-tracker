// Dashboard de l'onglet Stats - Pokémon Tracker
// Dépend de: supabaseClient/allCollectionCards/renderPriceMovers (tracker.js), getDuplicateGroupKey (collection.js), Chart
// Etat possédé : rarityChartInstance, seriesChartInstance, valueHistoryChartInstance, valueHistoryRawData,
// currentValueHistoryRange, seriesValueChartInstance

let rarityChartInstance = null;
let seriesChartInstance = null;
let valueHistoryChartInstance = null;
let valueHistoryRawData = [];
let currentValueHistoryRange = 30;

async function renderStatsCharts() {
    if (typeof Chart === 'undefined') return; // Chart.js pas encore chargé

    // Couleurs de texte/grille adaptées au thème sombre
    Chart.defaults.color = '#8A93A6';
    Chart.defaults.borderColor = 'rgba(255,255,255,0.08)';
    Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

    renderStatsKpis();
    await loadMonthlySummaryOptions();
    await renderMonthlySummary();
    renderRarityChart();
    renderSeriesChart();
    renderSeriesValueChart();
    renderRoiSection();
    await loadValueHistoryData();
    renderValueHistoryChart();
    renderPriceMovers();
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
    spentEl.textContent = Number(data.total_spent || 0).toFixed(2) + '€';
    valueAddedEl.textContent = Number(data.value_added || 0).toFixed(2) + '€';
}

function renderStatsKpis() {
    const topCardEl = document.getElementById('kpi-top-card');
    const topCardPriceEl = document.getElementById('kpi-top-card-price');
    const avgPriceEl = document.getElementById('kpi-avg-price');
    const seriesCountEl = document.getElementById('kpi-series-count');
    const topRarityEl = document.getElementById('kpi-top-rarity');
    const duplicatesValueEl = document.getElementById('kpi-duplicates-value');

    if (allCollectionCards.length === 0) {
        topCardEl.textContent = '-';
        topCardPriceEl.textContent = '';
        avgPriceEl.textContent = '-';
        seriesCountEl.textContent = '-';
        topRarityEl.textContent = '-';
        duplicatesValueEl.textContent = '-';
        return;
    }

    const topCard = [...allCollectionCards].sort((a, b) => Number(b.market_value || 0) - Number(a.market_value || 0))[0];
    topCardEl.textContent = topCard.name;
    topCardPriceEl.textContent = `${Number(topCard.market_value || 0).toFixed(2)}€`;

    const totalQty = allCollectionCards.reduce((sum, c) => sum + Number(c.quantity || 1), 0);
    const totalValue = allCollectionCards.reduce((sum, c) => sum + Number(c.market_value || 0) * Number(c.quantity || 1), 0);
    avgPriceEl.textContent = `${(totalQty > 0 ? totalValue / totalQty : 0).toFixed(2)}€`;

    const seriesSet = new Set(allCollectionCards.map(c => c.series).filter(s => s && s !== 'N/A'));
    seriesCountEl.textContent = seriesSet.size;

    const rarityCounts = {};
    allCollectionCards.forEach(c => {
        const r = c.rarity;
        if (!r || r === 'N/A') return;
        rarityCounts[r] = (rarityCounts[r] || 0) + Number(c.quantity || 1);
    });
    const topRarity = Object.entries(rarityCounts).sort((a, b) => b[1] - a[1])[0];
    topRarityEl.textContent = topRarity ? topRarity[0] : '-';

    // Valeur des doublons : pour chaque carte possédée en plusieurs exemplaires,
    // on garde la valeur d'un seul exemplaire de côté et on additionne le reste
    const duplicateGroups = {};
    allCollectionCards.forEach(card => {
        const key = getDuplicateGroupKey(card);
        if (!duplicateGroups[key]) {
            duplicateGroups[key] = { totalQty: 0, totalValue: 0, unitValue: Number(card.market_value || 0) };
        }
        duplicateGroups[key].totalQty += Number(card.quantity || 1);
        duplicateGroups[key].totalValue += Number(card.market_value || 0) * Number(card.quantity || 1);
    });

    let duplicatesValue = 0;
    Object.values(duplicateGroups).forEach(g => {
        if (g.totalQty > 1) {
            duplicatesValue += g.totalValue - g.unitValue;
        }
    });
    duplicatesValueEl.textContent = `${duplicatesValue.toFixed(2)}€`;
}

function renderRarityChart() {
    const canvas = document.getElementById('rarity-chart');
    if (!canvas) return;

    const counts = {};
    allCollectionCards.forEach(card => {
        const key = card.rarity || 'Non renseignée';
        counts[key] = (counts[key] || 0) + Number(card.quantity || 1);
    });

    const labels = Object.keys(counts);
    const values = Object.values(counts);

    if (rarityChartInstance) rarityChartInstance.destroy();

    if (labels.length === 0) return;

    rarityChartInstance = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data: values,
                backgroundColor: ['#E8A93B', '#3FA7A1', '#6bcbff', '#95e1a3', '#c77dff', '#ff9f6b', '#ff6b6b', '#8A93A6'],
                borderColor: '#1B2233',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { position: 'bottom' } }
        }
    });
}

function renderSeriesChart() {
    const canvas = document.getElementById('series-chart');
    if (!canvas) return;

    const counts = {};
    allCollectionCards.forEach(card => {
        const key = card.series;
        if (!key || key === 'N/A') return;
        counts[key] = (counts[key] || 0) + Number(card.quantity || 1);
    });

    // Top 8 séries
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const labels = sorted.map(s => s[0]);
    const values = sorted.map(s => s[1]);

    if (seriesChartInstance) seriesChartInstance.destroy();

    if (labels.length === 0) return;

    seriesChartInstance = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                data: values,
                backgroundColor: '#E8A93B',
                borderRadius: 4,
                barThickness: 18
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                x: { type: 'logarithmic', ticks: { precision: 0, callback: v => Number.isInteger(Math.log10(v)) ? v : '' } },
                y: { ticks: { autoSkip: false } }
            }
        }
    });
}

let seriesValueChartInstance = null;

function renderSeriesValueChart() {
    const canvas = document.getElementById('series-value-chart');
    if (!canvas) return;

    const totals = {};
    allCollectionCards.forEach(card => {
        const key = card.series;
        if (!key || key === 'N/A') return;
        totals[key] = (totals[key] || 0) + Number(card.market_value || 0) * Number(card.quantity || 1);
    });

    // Top 8 séries par valeur
    const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const labels = sorted.map(s => s[0]);
    const values = sorted.map(s => s[1]);

    if (seriesValueChartInstance) seriesValueChartInstance.destroy();

    if (labels.length === 0) return;

    seriesValueChartInstance = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                data: values,
                backgroundColor: '#3FA7A1',
                borderRadius: 4,
                barThickness: 18
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.x.toFixed(2)}€` } }
            },
            scales: {
                x: { beginAtZero: true, ticks: { callback: (v) => `${v}€` } },
                y: { ticks: { autoSkip: false } }
            }
        }
    });
}

function renderRoiSection() {
    const container = document.getElementById('roi-section');
    if (!container) return;

    const candidates = allCollectionCards
        .filter(c => Number(c.purchase_price) > 0)
        .map(c => {
            const purchase = Number(c.purchase_price);
            const current = Number(c.market_value || 0);
            const qty = Number(c.quantity || 1);
            const gainPercent = ((current - purchase) / purchase) * 100;
            const gainAmount = (current - purchase) * qty;
            return { name: c.name, number: c.number, gainPercent, gainAmount };
        })
        .sort((a, b) => b.gainPercent - a.gainPercent)
        .slice(0, 5);

    if (candidates.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--slate); padding: 1rem;">Aucune carte avec un prix payé renseigné pour l\'instant.</p>';
        return;
    }

    container.innerHTML = candidates.map(c => {
        const cls = c.gainPercent > 0 ? 'positive' : c.gainPercent < 0 ? 'negative' : 'neutral';
        const sign = c.gainPercent > 0 ? '+' : '';
        return `
            <div class="mover-row">
                <span class="mover-name">${c.name} <span class="mover-number">#${c.number}</span></span>
                <span class="mover-delta ${cls}">${sign}${c.gainPercent.toFixed(0)}% <span class="period-value-abs">(${sign}${c.gainAmount.toFixed(2)}€)</span></span>
            </div>
        `;
    }).join('');
}

async function loadValueHistoryData() {
    const { data, error } = await supabaseClient
        .from('value_history')
        .select('*')
        .order('recorded_at', { ascending: true })
        .limit(500);

    valueHistoryRawData = (!error && data) ? data : [];
}

function setValueHistoryRange(event, days) {
    currentValueHistoryRange = days;
    document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    renderValueHistoryChart();
}

function renderValueHistoryChart() {
    const canvas = document.getElementById('value-history-chart');
    if (!canvas || valueHistoryRawData.length === 0) return;

    let data = valueHistoryRawData;
    if (currentValueHistoryRange > 0) {
        const cutoff = Date.now() - currentValueHistoryRange * 24 * 60 * 60 * 1000;
        data = data.filter(d => new Date(d.recorded_at).getTime() >= cutoff);
        if (data.length === 0) data = valueHistoryRawData.slice(-1); // filet de sécurité
    }

    const labels = data.map(d => new Date(d.recorded_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }));
    const values = data.map(d => Number(d.total_value));
    const trendUp = values[values.length - 1] >= values[0];
    const lineColor = trendUp ? '#4ade80' : '#ff6b6b';
    const fillColor = trendUp ? 'rgba(74, 222, 128, 0.12)' : 'rgba(255, 107, 107, 0.1)';

    if (valueHistoryChartInstance) valueHistoryChartInstance.destroy();

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
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => `${ctx.parsed.y.toFixed(2)}€`
                    }
                }
            },
            scales: {
                y: { beginAtZero: true },
                x: { ticks: { maxTicksLimit: 8, autoSkip: true } }
            }
        }
    });
}
