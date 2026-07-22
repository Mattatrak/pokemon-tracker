// Import/export CSV et JSON - Pokémon Tracker
// Dépend de: allCollectionCards/supabaseClient/API_BASE/API_EN/performCardAdd/refreshCollection/recordValueSnapshot (tracker.js),
// allWishlists/allWishlistItems/loadWishlists (wishlist.js), showConfirmModal (ui.js), showMessage/normalizeForMatch/parseCsvDate (utils.js), Papa (PapaParse)

// ===== EXPORT CSV =====

function exportCollectionToCSV() {
    if (allCollectionCards.length === 0) {
        showMessage('Ta collection est vide, rien à exporter', 'error');
        return;
    }

    const headers = [
        'Nom', 'Série', 'Numéro', 'Type', 'Rareté', 'État', 'Quantité',
        'Prix payé (€)', 'Valeur marché (€)', 'Obtention', 'Ajoutée le',
        'ID TCGdex', 'ID Cardmarket'
    ];

    const escapeCsvValue = (value) => {
        const str = String(value ?? '');
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    };

    const rows = allCollectionCards.map(card => [
        card.name,
        card.series,
        card.number,
        card.type,
        card.rarity,
        card.condition,
        card.quantity,
        Number(card.purchase_price || 0).toFixed(2),
        Number(card.market_value || 0).toFixed(2),
        card.acquisition_type === 'pack' ? 'Booster' : 'Achat',
        card.date_added,
        card.tcgdex_id || '',
        card.cardmarket_id || ''
    ].map(escapeCsvValue).join(','));

    // BOM UTF-8 en tête pour qu'Excel affiche bien les accents
    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const dateStr = new Date().toISOString().split('T')[0];
    link.download = `ma-collection-pokemon-${dateStr}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showMessage('Export CSV téléchargé !', 'success');
}

// ===== IMPORT CSV EN MASSE =====

function toggleCsvDropdown(event) {
    event.stopPropagation();
    document.getElementById('csv-dropdown-menu').classList.toggle('active');
}

function closeCsvDropdown() {
    document.getElementById('csv-dropdown-menu').classList.remove('active');
}

document.addEventListener('click', (e) => {
    const menu = document.getElementById('csv-dropdown-menu');
    if (menu && menu.classList.contains('active') && !e.target.closest('.csv-dropdown-wrap')) {
        menu.classList.remove('active');
    }
});

// ===== SAUVEGARDE / RESTAURATION COMPLETE (JSON) =====

async function exportFullBackupJson() {
    showMessage('Préparation de la sauvegarde...', 'success');

    try {
        const [cardsRes, wishlistsRes, wishlistItemsRes, valueHistoryRes, priceHistoryRes, monthlySummaryRes] = await Promise.all([
            supabaseClient.from('cards').select('*'),
            supabaseClient.from('wishlists').select('*'),
            supabaseClient.from('wishlist').select('*'),
            supabaseClient.from('value_history').select('*'),
            supabaseClient.from('card_price_history').select('*'),
            supabaseClient.from('monthly_summary').select('*')
        ]);

        const backup = {
            exportedAt: new Date().toISOString(),
            version: 1,
            cards: cardsRes.data || [],
            wishlists: wishlistsRes.data || [],
            wishlistItems: wishlistItemsRes.data || [],
            valueHistory: valueHistoryRes.data || [],
            cardPriceHistory: priceHistoryRes.data || [],
            monthlySummary: monthlySummaryRes.data || []
        };

        const jsonContent = JSON.stringify(backup, null, 2);
        const blob = new Blob([jsonContent], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const dateStr = new Date().toISOString().split('T')[0];
        link.download = `sauvegarde-pokemon-tracker-${dateStr}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        showMessage('Sauvegarde téléchargée !', 'success');
    } catch (error) {
        showMessage('Erreur lors de la préparation de la sauvegarde', 'error');
        console.error(error);
    }
}

function handleJsonRestore(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = JSON.parse(e.target.result);
            await confirmAndProcessJsonRestore(data);
        } catch (error) {
            showMessage('Fichier de sauvegarde invalide ou illisible', 'error');
            console.error(error);
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

async function confirmAndProcessJsonRestore(data) {
    const cardCount = data.cards?.length || 0;
    const wishlistCount = data.wishlists?.length || 0;

    if (!await showConfirmModal(
        `Restaurer va importer jusqu'à ${cardCount} carte(s) et ${wishlistCount} liste(s) de souhaits. Les cartes et souhaits déjà présents dans ta collection actuelle seront automatiquement ignorés (pas de doublons créés). Continuer ?`,
        'Restaurer'
    )) return;

    const content = document.getElementById('csv-import-content');
    document.getElementById('csv-import-overlay').classList.add('active');
    content.innerHTML = `
        <div class="modal-title" style="margin-bottom: 1rem;">Restauration en cours...</div>
        <p style="color: var(--slate);">Merci de patienter, ne ferme pas cette fenêtre.</p>
    `;

    const errors = [];
    let cardsInserted = 0, cardsSkipped = 0;
    let wishlistsCreated = 0, wishlistsReused = 0;
    let itemsInserted = 0, itemsSkipped = 0;

    // 1. Listes de souhaits : réutiliser celle existante si le nom correspond déjà
    const wishlistIdMap = {};
    try {
        if (data.wishlists && data.wishlists.length > 0) {
            for (const w of data.wishlists) {
                const existing = allWishlists.find(existingW => existingW.name === w.name);
                if (existing) {
                    wishlistIdMap[w.id] = existing.id;
                    wishlistsReused++;
                } else {
                    const { id: oldId, ...rest } = w;
                    const { data: inserted, error } = await supabaseClient.from('wishlists').insert([rest]).select().single();
                    if (!error && inserted) {
                        wishlistIdMap[oldId] = inserted.id;
                        wishlistsCreated++;
                    }
                }
            }
        }
    } catch (error) {
        errors.push('listes de souhaits');
        console.error(error);
    }

    // 2. Cartes de souhaits : ignorer si déjà présente dans la même liste (même tcgdex_id)
    try {
        if (data.wishlistItems && data.wishlistItems.length > 0) {
            const rowsToInsert = [];
            for (const item of data.wishlistItems) {
                const newWishlistId = wishlistIdMap[item.wishlist_id];
                if (!newWishlistId) continue;

                const alreadyExists = allWishlistItems.some(existingItem =>
                    existingItem.wishlist_id === newWishlistId && existingItem.tcgdex_id === item.tcgdex_id
                );
                if (alreadyExists) {
                    itemsSkipped++;
                    continue;
                }

                const { id, ...rest } = item;
                rowsToInsert.push({ ...rest, wishlist_id: newWishlistId });
            }
            if (rowsToInsert.length > 0) {
                const { error } = await supabaseClient.from('wishlist').insert(rowsToInsert);
                if (error) throw error;
                itemsInserted = rowsToInsert.length;
            }
        }
    } catch (error) {
        errors.push('cartes de souhaits');
        console.error(error);
    }

    // 3. Collection : ignorer si une carte identique (même tcgdex_id + état, ou nom/série/numéro/état) existe déjà
    try {
        if (data.cards && data.cards.length > 0) {
            const rowsToInsert = [];
            for (const card of data.cards) {
                const exists = allCollectionCards.some(c => {
                    if (card.tcgdex_id && c.tcgdex_id) {
                        return c.tcgdex_id === card.tcgdex_id && c.condition === card.condition;
                    }
                    return c.name === card.name && c.series === card.series && c.number === card.number && c.condition === card.condition;
                });
                if (exists) {
                    cardsSkipped++;
                    continue;
                }
                const { id, ...rest } = card;
                rowsToInsert.push(rest);
            }
            for (let i = 0; i < rowsToInsert.length; i += 100) {
                const { error } = await supabaseClient.from('cards').insert(rowsToInsert.slice(i, i + 100));
                if (error) throw error;
            }
            cardsInserted = rowsToInsert.length;
        }
    } catch (error) {
        errors.push('collection de cartes');
        console.error(error);
    }

    // 4. Historiques de valeur/prix : simples journaux, pas de notion de doublon à vérifier
    try {
        if (data.valueHistory && data.valueHistory.length > 0) {
            const rows = data.valueHistory.map(({ id, ...rest }) => rest);
            for (let i = 0; i < rows.length; i += 200) {
                await supabaseClient.from('value_history').insert(rows.slice(i, i + 200));
            }
        }
    } catch (error) {
        errors.push('historique de valeur');
        console.error(error);
    }

    try {
        if (data.cardPriceHistory && data.cardPriceHistory.length > 0) {
            const rows = data.cardPriceHistory.map(({ id, ...rest }) => rest);
            for (let i = 0; i < rows.length; i += 200) {
                await supabaseClient.from('card_price_history').insert(rows.slice(i, i + 200));
            }
        }
    } catch (error) {
        errors.push('historique de prix par carte');
        console.error(error);
    }

    // 5. Historique mensuel : ignorer les mois déjà présents (contrainte unique sur "month")
    try {
        if (data.monthlySummary && data.monthlySummary.length > 0) {
            const { data: existingMonthsData } = await supabaseClient.from('monthly_summary').select('month');
            const existingMonths = new Set((existingMonthsData || []).map(m => m.month));
            const rows = data.monthlySummary
                .filter(m => !existingMonths.has(m.month))
                .map(({ id, ...rest }) => rest);
            if (rows.length > 0) {
                const { error } = await supabaseClient.from('monthly_summary').insert(rows);
                if (error) throw error;
            }
        }
    } catch (error) {
        errors.push('historique mensuel');
        console.error(error);
    }

    await refreshCollection();
    await loadWishlists();

    content.innerHTML = `
        <div class="modal-title" style="margin-bottom: 1rem;">Restauration terminée</div>
        <p style="color: var(--text-primary); line-height: 1.6;">
            <strong style="color: #4ade80;">${cardsInserted}</strong> carte(s) ajoutée(s) <span style="color: var(--slate);">· ${cardsSkipped} déjà présente(s), ignorée(s)</span><br>
            <strong style="color: #4ade80;">${wishlistsCreated}</strong> liste(s) créée(s) <span style="color: var(--slate);">· ${wishlistsReused} réutilisée(s)</span><br>
            <strong style="color: #4ade80;">${itemsInserted}</strong> souhait(s) ajouté(s) <span style="color: var(--slate);">· ${itemsSkipped} déjà présent(s), ignoré(s)</span>
            ${errors.length > 0 ? `<br><span style="color: #ff6b6b;">Soucis sur : ${errors.join(', ')}</span>` : ''}
        </p>
        <button class="modal-save-btn full-width" style="margin-top: 1.25rem;" onclick="document.getElementById('csv-import-overlay').classList.remove('active')">Fermer</button>
    `;
}

function downloadCsvTemplate() {
    const headers = ['Nom', 'Serie', 'Numero', 'Etat', 'Quantite', 'Prix', 'Obtention', 'Date'];
    const example = ['Pikachu', 'Ecarlate et Violet', '025', 'NM', '1', '3.50', 'achat', '15/03/2026'];
    const csvContent = '\uFEFF' + [headers.join(','), example.join(',')].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'modele-import-pokemon.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// Cherche la carte correspondante sur TCGdex (nom + série + numéro)
async function findTcgdexMatch(nom, serie, numero) {
    const [frRes, enRes] = await Promise.all([
        fetch(`${API_BASE}/cards?name=${encodeURIComponent(nom)}`),
        fetch(`${API_EN}/cards?name=${encodeURIComponent(nom)}`)
    ]);
    const frData = await frRes.json();
    const enData = await enRes.json();
    const combined = [...(Array.isArray(frData) ? frData : []), ...(Array.isArray(enData) ? enData : [])];

    const normNum = normalizeForMatch(numero).replace(/^0+/, '');
    const normSerie = normalizeForMatch(serie);

    const matches = combined.filter(c => {
        const cNum = normalizeForMatch(c.localId).replace(/^0+/, '');
        const cSet = normalizeForMatch(c.set?.name);
        const numMatches = normNum === '' || cNum === normNum;
        const serieMatches = normSerie === '' || cSet.includes(normSerie) || normSerie.includes(cSet);
        return numMatches && serieMatches;
    });

    // Dédupliquer par id (une carte peut apparaître via la recherche FR et EN)
    return [...new Map(matches.map(m => [m.id, m])).values()];
}

function handleCsvImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
            processCsvImportRows(results.data);
        },
        error: (error) => {
            showMessage('Erreur lors de la lecture du fichier CSV', 'error');
            console.error(error);
        }
    });

    event.target.value = ''; // permet de réimporter le même fichier si besoin
}

async function processCsvImportRows(rows) {
    const content = document.getElementById('csv-import-content');
    document.getElementById('csv-import-overlay').classList.add('active');

    const validRows = rows.filter(r => r.Nom && r.Nom.trim());
    const total = validRows.length;

    if (total === 0) {
        content.innerHTML = `
            <div class="modal-title" style="margin-bottom: 1rem;">Import CSV</div>
            <p style="color: var(--slate);">Aucune ligne valide trouvée dans ce fichier (colonne "Nom" manquante ou vide).</p>
            <button class="modal-save-btn full-width" style="margin-top: 1rem;" onclick="document.getElementById('csv-import-overlay').classList.remove('active')">Fermer</button>
        `;
        return;
    }

    let successCount = 0;
    const failures = [];

    for (let i = 0; i < validRows.length; i++) {
        const row = validRows[i];
        content.innerHTML = `
            <div class="modal-title" style="margin-bottom: 1rem;">Import en cours...</div>
            <p style="color: var(--slate);">${i + 1} / ${total} — ${escapeHtml(row.Nom)}</p>
        `;

        try {
            const matches = await findTcgdexMatch(row.Nom, row.Serie, row.Numero);

            if (matches.length !== 1) {
                failures.push({
                    nom: row.Nom,
                    raison: matches.length === 0 ? 'Aucune correspondance trouvée' : `${matches.length} correspondances possibles (ambigu)`
                });
                continue;
            }

            // Récupérer les détails complets (prix, image...) pour un ajout fidèle
            let detail = null;
            try {
                let r = await fetch(`${API_BASE}/cards/${matches[0].id}`);
                let d = await r.json();
                if (!d || d.status) {
                    const r2 = await fetch(`${API_EN}/cards/${matches[0].id}`);
                    d = await r2.json();
                }
                if (d && !d.status) detail = d;
            } catch (e) { /* on utilisera le filet de sécurité ci-dessous */ }

            if (!detail) detail = matches[0];

            const condition = (row.Etat || 'NM').trim().toUpperCase();
            const quantity = parseInt(row.Quantite) || 1;
            const purchasePrice = parseFloat((row.Prix || '0').replace(',', '.')) || 0;
            const acquisitionType = normalizeForMatch(row.Obtention) === 'booster' ? 'pack' : 'achat';
            const customDate = parseCsvDate(row.Date);

            await performCardAdd(detail, {
                condition: ['NM', 'LP', 'MP', 'HP'].includes(condition) ? condition : 'NM',
                quantity,
                acquisitionType,
                purchasePrice,
                customImage: null,
                customDate
            });

            successCount++;
        } catch (error) {
            failures.push({ nom: row.Nom, raison: 'Erreur inattendue' });
            console.error(error);
        }
    }

    await refreshCollection();
    await recordValueSnapshot();

    const failuresHtml = failures.length === 0
        ? ''
        : `
            <div style="margin-top: 1rem; max-height: 200px; overflow-y: auto;">
                <div style="color: var(--slate); font-size: 0.8rem; margin-bottom: 0.5rem;">Lignes ignorées :</div>
                ${failures.map(f => `
                    <div style="font-size: 0.8rem; padding: 0.4rem 0; border-bottom: 1px solid var(--border);">
                        <strong>${escapeHtml(f.nom)}</strong> — <span style="color: var(--slate);">${escapeHtml(f.raison)}</span>
                    </div>
                `).join('')}
            </div>
        `;

    content.innerHTML = `
        <div class="modal-title" style="margin-bottom: 1rem;">Import terminé</div>
        <p style="color: var(--text-primary);">
            <span style="color: #4ade80; font-weight: 700;">${successCount}</span> carte(s) ajoutée(s)
            ${failures.length > 0 ? `· <span style="color: #ff6b6b; font-weight: 700;">${failures.length}</span> ignorée(s)` : ''}
        </p>
        ${failuresHtml}
        <button class="modal-save-btn full-width" style="margin-top: 1.25rem;" onclick="document.getElementById('csv-import-overlay').classList.remove('active')">Fermer</button>
    `;
}
