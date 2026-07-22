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

    const { data: recentDesc, error } = await supabaseClient
        .from('value_history')
        .select('*')
        .order('recorded_at', { ascending: false })
        .limit(200);

    const fluctEl = document.getElementById('hero-fluctuation');

    if (error || !recentDesc || recentDesc.length === 0) {
        if (fluctEl) fluctEl.textContent = '';
        return;
    }

    const data = recentDesc.slice().reverse(); // remis en ordre chronologique (ascendant)

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

// ===== TOP 10 VARIATIONS % (24H) =====

async function showTopMoversModal() {
    const content = document.getElementById('top-movers-content');
    content.innerHTML = `
        <button class="modal-close" onclick="closeTopMoversModal()">✕</button>
        <div class="modal-title" style="margin-bottom: 1rem;">Plus grosses variations (24h)</div>
        <p style="text-align: center; color: var(--slate); padding: 1rem;">Chargement...</p>
    `;
    document.getElementById('top-movers-overlay').classList.add('active');

    const uniqueIds = [...new Set(allCollectionCards.filter(c => c.tcgdex_id).map(c => c.tcgdex_id))];
    if (uniqueIds.length === 0) {
        content.innerHTML = `
            <button class="modal-close" onclick="closeTopMoversModal()">✕</button>
            <div class="modal-title" style="margin-bottom: 1rem;">Plus grosses variations (24h)</div>
            <p style="text-align: center; color: var(--slate); padding: 1rem;">Aucune carte avec un historique de prix.</p>
        `;
        return;
    }

    const { data, error } = await supabaseClient
        .from('card_price_history')
        .select('*')
        .in('tcgdex_id', uniqueIds)
        .order('recorded_at', { ascending: true });

    if (error || !data) {
        content.innerHTML = `
            <button class="modal-close" onclick="closeTopMoversModal()">✕</button>
            <div class="modal-title" style="margin-bottom: 1rem;">Plus grosses variations (24h)</div>
            <p style="text-align: center; color: var(--slate); padding: 1rem;">Erreur de chargement.</p>
        `;
        return;
    }

    const historyByCard = {};
    data.forEach(point => {
        if (!historyByCard[point.tcgdex_id]) historyByCard[point.tcgdex_id] = [];
        historyByCard[point.tcgdex_id].push(point);
    });

    const currentByCard = {};
    allCollectionCards.forEach(c => {
        if (c.tcgdex_id && !(c.tcgdex_id in currentByCard)) {
            currentByCard[c.tcgdex_id] = { name: c.name, number: c.number, value: Number(c.market_value || 0) };
        }
    });

    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const movers = [];

    uniqueIds.forEach(id => {
        const points = historyByCard[id];
        const current = currentByCard[id];
        if (!points || points.length === 0 || !current) return;

        let baseline = points[0];
        for (const point of points) {
            if (new Date(point.recorded_at).getTime() <= dayAgo) {
                baseline = point;
            } else {
                break;
            }
        }

        const baselineValue = Number(baseline.market_value);
        if (baselineValue <= 0) return;

        const delta = current.value - baselineValue;
        if (Math.abs(delta) < 0.005) return;

        movers.push({ name: current.name, number: current.number, delta, value: current.value });
    });

    movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    const top10 = movers.slice(0, 10);

    const listHtml = top10.length === 0
        ? '<p style="color: var(--slate); font-size: 0.85rem; text-align: center;">Aucune variation détectée sur 24h</p>'
        : top10.map(m => `
            <div class="mover-row">
                <span class="mover-name">${escapeHtml(m.name)} <span class="mover-number">#${escapeHtml(m.number)}</span></span>
                <span class="mover-delta ${m.delta > 0 ? 'positive' : 'negative'}"><span style="color: var(--slate);">${m.value.toFixed(2)}€</span> (${m.delta > 0 ? '+' : ''}${m.delta.toFixed(2)}€)</span>
            </div>
        `).join('');

    content.innerHTML = `
        <button class="modal-close" onclick="closeTopMoversModal()">✕</button>
        <div class="modal-title" style="margin-bottom: 1rem;">Plus grosses variations (24h)</div>
        ${listHtml}
    `;
}

function closeTopMoversModal() {
    document.getElementById('top-movers-overlay').classList.remove('active');
}
