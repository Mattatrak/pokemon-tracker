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

const heroSparklineCharts = {};

// Variation de valeur sur une fenêtre de temps, basée uniquement sur card_price_history (prix marché
// par carte, alimenté seulement par les rafraîchissements de prix) plutôt que sur value_history (qui
// bouge aussi à chaque ajout/suppression/changement de quantité). La quantité ACTUELLE de chaque carte
// est utilisée des deux côtés du calcul (avant/après), ce qui neutralise tout changement de composition
// de la collection : seul un vrai mouvement de prix côté marché fait bouger ce chiffre.
async function computeMarketFluctuation(windowMs) {
    const uniqueIds = [...new Set(allCollectionCards.filter(c => c.tcgdex_id).map(c => c.tcgdex_id))];
    if (uniqueIds.length === 0) return null;

    // Fenêtre + tri décroissant avec limite explicite (voir showTopMoversModal pour l'explication
    // complète) : même avec un filtre de date, une grosse collection très rafraîchie peut dépasser
    // la limite par défaut de 1000 lignes de PostgREST. Trier du plus récent au plus ancien garantit
    // qu'une troncature éventuelle ne sacrifie que les points anciens, jamais les points récents.
    const windowStart = new Date(Date.now() - windowMs - 2 * 24 * 60 * 60 * 1000).toISOString();
    const { data: dataDesc, error } = await supabaseClient
        .from('card_price_history')
        .select('*')
        .in('tcgdex_id', uniqueIds)
        .gte('recorded_at', windowStart)
        .order('recorded_at', { ascending: false })
        .limit(20000);
    const data = dataDesc ? [...dataDesc].reverse() : dataDesc;

    if (error || !data || data.length === 0) return null;

    const historyByCard = {};
    data.forEach(point => {
        if (!historyByCard[point.tcgdex_id]) historyByCard[point.tcgdex_id] = [];
        historyByCard[point.tcgdex_id].push(point);
    });

    const qtyByCard = {};
    const currentPriceByCard = {};
    allCollectionCards.forEach(c => {
        if (!c.tcgdex_id) return;
        qtyByCard[c.tcgdex_id] = (qtyByCard[c.tcgdex_id] || 0) + Number(c.quantity || 1);
        if (!(c.tcgdex_id in currentPriceByCard)) currentPriceByCard[c.tcgdex_id] = Number(c.market_value || 0);
    });

    const cutoff = Date.now() - windowMs;
    let baselineTotal = 0;
    let currentTotal = 0;

    uniqueIds.forEach(id => {
        const points = historyByCard[id];
        if (!points || points.length === 0) return;

        let baseline = points[0];
        for (const point of points) {
            if (new Date(point.recorded_at).getTime() <= cutoff) baseline = point;
            else break;
        }

        const qty = qtyByCard[id] || 0;
        baselineTotal += Number(baseline.market_value) * qty;
        currentTotal += (currentPriceByCard[id] || 0) * qty;
    });

    return { delta: currentTotal - baselineTotal, baselineTotal, currentTotal };
}

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

    // Mini-graphique en fond (sparkline) — dupliqué sur chaque page qui affiche la carte valeur
    ['hero-sparkline', 'collection-hero-sparkline'].forEach(canvasId => {
        const canvas = document.getElementById(canvasId);
        if (!canvas || typeof Chart === 'undefined') return;

        const values = data.map(d => Number(d.total_value));
        const trendUp = values[values.length - 1] >= values[0];

        if (heroSparklineCharts[canvasId]) heroSparklineCharts[canvasId].destroy();
        heroSparklineCharts[canvasId] = new Chart(canvas, {
            type: 'line',
            data: {
                labels: values.map((_, i) => i),
                datasets: [{
                    data: values,
                    borderColor: trendUp ? '#7ED9A7' : '#ff6b6b',
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
    });

    // Fluctuation sur les dernières 24h (prix marché uniquement, cf. computeMarketFluctuation)
    const fluctuation = await computeMarketFluctuation(24 * 60 * 60 * 1000);
    if (fluctEl) {
        if (!fluctuation) {
            fluctEl.textContent = '';
            fluctEl.className = 'hero-fluctuation';
        } else {
            const sign = fluctuation.delta > 0 ? '+' : '';
            fluctEl.textContent = `${sign}${fluctuation.delta.toFixed(2)}€ (24h)`;
            fluctEl.className = 'hero-fluctuation ' + (fluctuation.delta > 0 ? 'positive' : fluctuation.delta < 0 ? 'negative' : 'neutral');
        }
    }
}

// ===== TOP 10 VARIATIONS % (24H) =====

async function showTopMoversModal() {
    const content = document.getElementById('top-movers-content');
    content.innerHTML = `
        <button class="modal-close" onclick="closeTopMoversModal()">✕</button>
        <div class="modal-scroll">
            <div class="modal-title" style="margin-bottom: 1rem;">Plus grosses variations (24h)</div>
            <p style="text-align: center; color: var(--slate); padding: 1rem;">Chargement...</p>
        </div>
    `;
    document.getElementById('top-movers-overlay').classList.add('active');

    const uniqueIds = [...new Set(allCollectionCards.filter(c => c.tcgdex_id).map(c => c.tcgdex_id))];
    if (uniqueIds.length === 0) {
        content.innerHTML = `
            <button class="modal-close" onclick="closeTopMoversModal()">✕</button>
            <div class="modal-scroll">
                <div class="modal-title" style="margin-bottom: 1rem;">Plus grosses variations (24h)</div>
                <p style="text-align: center; color: var(--slate); padding: 1rem;">Aucune carte avec un historique de prix.</p>
            </div>
        `;
        return;
    }

    // Fenêtre limitée à 3 jours : même avec ce filtre, une grosse collection très rafraîchie peut
    // encore dépasser la limite par défaut de 1000 lignes de PostgREST (vérifié en pratique). On
    // trie donc en DESCENDANT (le plus récent d'abord) avec une limite explicite généreuse, pour
    // que si troncature il y a malgré tout, ce soit les points les plus ANCIENS qui sautent — jamais
    // les points récents dont on a besoin pour "maintenant" et "il y a ~24h". On ré-inverse ensuite
    // pour retrouver l'ordre croissant attendu par le reste du code.
    const windowStart = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const { data: dataDesc, error } = await supabaseClient
        .from('card_price_history')
        .select('*')
        .in('tcgdex_id', uniqueIds)
        .gte('recorded_at', windowStart)
        .order('recorded_at', { ascending: false })
        .limit(20000);
    const data = dataDesc ? [...dataDesc].reverse() : dataDesc;

    if (error || !data) {
        content.innerHTML = `
            <button class="modal-close" onclick="closeTopMoversModal()">✕</button>
            <div class="modal-scroll">
                <div class="modal-title" style="margin-bottom: 1rem;">Plus grosses variations (24h)</div>
                <p style="text-align: center; color: var(--slate); padding: 1rem;">Erreur de chargement.</p>
            </div>
        `;
        return;
    }

    const historyByCard = {};
    data.forEach(point => {
        if (!historyByCard[point.tcgdex_id]) historyByCard[point.tcgdex_id] = [];
        historyByCard[point.tcgdex_id].push(point);
    });

    // Nom/numéro affichés depuis la collection, mais la VALEUR actuelle vient du dernier point de
    // card_price_history (même source que la fiche carte, cf. renderCardPriceChart) — sinon les deux
    // vues peuvent se contredire si cards.market_value n'est pas parfaitement synchronisé.
    const nameByCard = {};
    allCollectionCards.forEach(c => {
        if (c.tcgdex_id && !(c.tcgdex_id in nameByCard)) {
            nameByCard[c.tcgdex_id] = { name: c.name, number: c.number };
        }
    });

    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const movers = [];

    uniqueIds.forEach(id => {
        const points = historyByCard[id];
        const info = nameByCard[id];
        if (!points || points.length === 0 || !info) return;

        const current = { ...info, value: Number(points[points.length - 1].market_value) };

        let baseline = null;
        for (const point of points) {
            if (new Date(point.recorded_at).getTime() <= dayAgo) {
                baseline = point;
            } else {
                break;
            }
        }

        // Pas de point antérieur à 24h (carte trop récemment suivie) : impossible de calculer
        // une variation sur cette fenêtre, on n'affiche rien pour cette carte plutôt que de
        // comparer au premier point disponible (qui pourrait dater de quelques heures).
        if (!baseline) return;

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
        <div class="modal-scroll">
            <div class="modal-title" style="margin-bottom: 1rem;">Plus grosses variations (24h)</div>
            ${listHtml}
        </div>
    `;
}

function closeTopMoversModal() {
    document.getElementById('top-movers-overlay').classList.remove('active');
}

// ===== Exports window (ticket V2 Vite, type="module") =====
// Les déclarations top-level d'un module ES ne s'attachent plus automatiquement à window
// (contrairement à un <script> classique) : réexport explicite pour que les autres scripts
// (chargés en modules indépendants, sans import/export entre eux, scope global inchangé)
// puissent continuer à référencer ces noms tels quels — y compris depuis des onclick="..."
// inline dans du HTML généré. Liste exhaustive des déclarations top-level de ce fichier
// (hors variables déjà passées en window.x = ... directement à leur déclaration, cf audit
// du 2026-08-14 sur l'état mutable partagé entre fichiers).
window.updateStats = updateStats;
window.recordValueSnapshot = recordValueSnapshot;
window.heroSparklineCharts = heroSparklineCharts;
window.computeMarketFluctuation = computeMarketFluctuation;
window.renderHeroValueCard = renderHeroValueCard;
window.showTopMoversModal = showTopMoversModal;
window.closeTopMoversModal = closeTopMoversModal;
