// Widget "valeur totale" (hero card, affiché sur tous les onglets) - Pokémon Tracker
// Dépend de: supabaseClient (tracker.js), allCollectionCards (tracker.js), renderStatsCharts (stats-render.js), Chart
// Etat possédé : heroSparklineChart

function updateStats() {
    const total = allCollectionCards.reduce((sum, card) => sum + Number(card.quantity || 1), 0);
    const value = allCollectionCards.reduce((sum, card) => sum + (Number(card.market_value || 0) * Number(card.quantity || 1)), 0);
    const spent = allCollectionCards.reduce((sum, card) => sum + (Number(card.purchase_price || 0) * Number(card.quantity || 1)), 0);

    document.getElementById('total-cards').textContent = total;
    document.getElementById('total-spent').textContent = spent.toFixed(2) + '€';
    document.getElementById('hero-total-value').textContent = value.toFixed(2) + '€';

    return { total, value, spent };
}

async function recordValueSnapshot() {
    const { total, value, spent } = updateStats();
    const { error } = await supabaseClient.from('value_history').insert([{
        total_value: value,
        total_cards: total,
        total_spent: spent
    }]);
    if (error) console.error('Erreur enregistrement historique valeur:', error);

    // On ne recalcule les graphiques (coûteux : plusieurs requêtes + Chart.js) que si l'onglet est réellement affiché
    if (document.getElementById('tab-stats').classList.contains('active')) {
        renderStatsCharts();
    }
    renderHeroValueCard();
}

let heroSparklineChart = null;

async function renderHeroValueCard() {
    const { value } = updateStats();

    const { data, error } = await supabaseClient
        .from('value_history')
        .select('*')
        .order('recorded_at', { ascending: true })
        .limit(200);

    const fluctEl = document.getElementById('hero-fluctuation');

    if (error || !data || data.length === 0) {
        if (fluctEl) fluctEl.textContent = '';
        return;
    }

    // Mini-graphique en fond (sparkline)
    const canvas = document.getElementById('hero-sparkline');
    if (canvas && typeof Chart !== 'undefined') {
        const values = data.map(d => Number(d.total_value));
        const trendUp = values[values.length - 1] >= values[0];

        if (heroSparklineChart) heroSparklineChart.destroy();
        heroSparklineChart = new Chart(canvas, {
            type: 'line',
            data: {
                labels: values.map((_, i) => i),
                datasets: [{
                    data: values,
                    borderColor: trendUp ? '#4ade80' : '#ff6b6b',
                    backgroundColor: trendUp ? 'rgba(74, 222, 128, 0.15)' : 'rgba(255, 107, 107, 0.12)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                plugins: { legend: { display: false }, tooltip: { enabled: false } },
                scales: {
                    x: { display: false },
                    y: { display: false }
                }
            }
        });
    }

    // Fluctuation sur les dernières 24h
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    let baseline = data[0]; // par défaut : tout premier point connu (si collection < 24h)
    for (const point of data) {
        if (new Date(point.recorded_at).getTime() <= dayAgo) {
            baseline = point;
        } else {
            break;
        }
    }

    const delta = value - Number(baseline.total_value);
    if (fluctEl) {
        const sign = delta > 0 ? '+' : '';
        fluctEl.textContent = `${sign}${delta.toFixed(2)}€ (24h)`;
        fluctEl.className = 'hero-fluctuation ' + (delta > 0 ? 'positive' : delta < 0 ? 'negative' : 'neutral');
    }
}
