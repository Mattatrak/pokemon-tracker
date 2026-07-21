// Modale détail/édition de carte - Pokémon Tracker
// Dépend de: allCollectionCards/supabaseClient/API_BASE/API_EN/adjustMonthlyStatsAmount/refreshCollection/recordValueSnapshot (tracker.js),
// getRarityIconHtml/renderFinishBadge/getSetIdFromTcgdexId/getFinishLabel/buildFinishOptionsHtml/initDatePicker (utils.js),
// uploadImageToStorage/uploadSeriesSymbolManually/uploadSeriesLogoManually (storage.js), showMessage (utils.js)
// Etat possédé : cardPriceChartInstance

function showCardDetail(cardId) {
    const card = allCollectionCards.find(c => c.id === cardId);
    if (!card) return;

    const qty = Number(card.quantity || 1);
    const marketValue = Number(card.market_value || 0);
    const purchasePrice = Number(card.purchase_price || 0);
    const lineTotal = marketValue * qty;
    const conditionClass = (card.condition || '').toLowerCase();
    const conditionLabels = { nm: 'Neuf', lp: 'Très bon', mp: 'Bon', hp: 'Mauvais état' };
    const conditionLabel = conditionLabels[conditionClass] || card.condition || '';
    const isPack = card.acquisition_type === 'pack';

    const modalCard = document.getElementById('card-detail-card');
    modalCard.innerHTML = `
        <button class="modal-close" onclick="closeCardDetail()">✕</button>
        <div class="modal-body">
            <div class="modal-image-wrap">
                ${card.image
                    ? `<img src="${card.image}" alt="${card.name}" class="modal-image" onerror="this.outerHTML=getModalUploadPlaceholder(${card.id})">`
                    : getModalUploadPlaceholder(card.id)
                }
                ${card.tcgdex_id ? `
                    <div class="card-price-chart-wrap">
                        <div class="card-price-chart-title">Historique de prix</div>
                        <canvas id="card-price-chart"></canvas>
                        <p id="card-price-chart-empty" class="card-price-chart-empty" style="display:none;">Historique pas encore disponible</p>
                        <div id="card-price-chart-range" class="card-price-chart-range"></div>
                        <div id="card-price-periods" class="card-price-periods"></div>
                    </div>
                ` : ''}
            </div>
            <div class="modal-info">
                <div class="modal-title">${card.name}</div>
                ${card.series_logo
                    ? `<img src="${card.series_logo}" class="modal-series-logo" alt="" onerror="this.remove()">`
                    : (card.tcgdex_id ? `
                        <div class="modal-logo-upload" onclick="document.getElementById('modal-logo-upload-input').click()">
                            <i class="ti ti-tag" aria-hidden="true"></i> Ajouter un logo de série
                        </div>
                        <input type="file" id="modal-logo-upload-input" accept="image/*" style="display:none" onchange="handleModalSeriesLogoUpload(event, '${getSetIdFromTcgdexId(card.tcgdex_id)}', ${card.id})">
                    ` : '')
                }
                <div class="modal-subtitle">${card.series} · #${card.number}</div>

                <div class="modal-badges">
                    <span class="modal-pill rarity-pill">${getRarityIconHtml(card.rarity, 14)} ${card.rarity || 'N/A'}</span>
                    <span class="modal-pill condition-pill ${conditionClass}">${conditionLabel} (${card.condition})</span>
                    ${renderFinishBadge(card.finish, 'modal-pill finish-pill', 14)}
                    <span class="modal-pill acquisition-pill">${isPack ? '<i class="ti ti-gift" aria-hidden="true"></i> Sortie d\'un booster' : '<i class="ti ti-shopping-bag" aria-hidden="true"></i> Achetée'}</span>
                    ${!card.series_symbol && card.tcgdex_id ? `
                        <span class="modal-pill symbol-upload-pill" onclick="document.getElementById('modal-symbol-upload-input').click()">
                            <i class="ti ti-plus" aria-hidden="true"></i> Symbole du set
                        </span>
                        <input type="file" id="modal-symbol-upload-input" accept="image/*" style="display:none" onchange="handleModalSeriesSymbolUpload(event, '${getSetIdFromTcgdexId(card.tcgdex_id)}', ${card.id})">
                    ` : ''}
                </div>

                <div class="modal-price-row">
                    <div class="modal-price-line">
                        <span class="modal-price-label">Valeur marché</span>
                        <span class="modal-price">${marketValue.toFixed(2)}€</span>
                    </div>
                    ${!isPack ? `
                    <div class="modal-price-line">
                        <span class="modal-price-label">Prix payé</span>
                        <span class="modal-price-secondary">${purchasePrice.toFixed(2)}€</span>
                    </div>` : ''}
                    ${qty > 1 ? `<div class="modal-price-total">Valeur totale : ${lineTotal.toFixed(2)}€ (×${qty})</div>` : ''}
                </div>

                ${card.type && card.type !== 'N/A' ? `<div class="modal-meta-line"><span class="modal-meta-label">Type</span> ${card.type}</div>` : ''}
                <div class="modal-meta-line"><span class="modal-meta-label">Quantité</span> ${qty}</div>
                ${card.date_added ? `<div class="modal-meta-line"><span class="modal-meta-label">Ajoutée le</span> ${card.date_added}</div>` : ''}
                ${card.notes ? `<div class="modal-note"><i class="ti ti-note" aria-hidden="true"></i> ${card.notes}</div>` : ''}

                <div class="modal-action-toolbar">
                    <button class="toolbar-action-btn" onclick="showCardEditForm(${card.id})">
                        <i class="ti ti-edit toolbar-action-icon" style="color: var(--gold);" aria-hidden="true"></i>
                        <span>Modifier</span>
                    </button>
                    <a href="${card.cardmarket_id
                        ? `https://www.cardmarket.com/en/Pokemon/Products?idProduct=${card.cardmarket_id}`
                        : `https://www.cardmarket.com/fr/Pokemon/Products/Search?searchString=${encodeURIComponent(card.name || '')}`
                    }" target="_blank" rel="noopener noreferrer" class="toolbar-action-btn">
                        <i class="ti ti-external-link toolbar-action-icon" style="color: var(--teal);" aria-hidden="true"></i>
                        <span>${card.cardmarket_id ? 'Cardmarket' : 'Chercher'}</span>
                    </a>
                </div>
                <button class="modal-delete-btn-v2" onclick="deleteCard(${card.id}); closeCardDetail();">
                    <i class="ti ti-trash" aria-hidden="true"></i>
                    <span>Supprimer de la collection</span>
                </button>
            </div>
        </div>
    `;

    document.getElementById('card-detail-overlay').classList.add('active');

    if (card.tcgdex_id) {
        renderCardPriceChart(card.tcgdex_id);
    }
}

let cardPriceChartInstance = null;

async function renderCardPriceChart(tcgdexId) {
    const canvas = document.getElementById('card-price-chart');
    const emptyMsg = document.getElementById('card-price-chart-empty');
    const rangeLabel = document.getElementById('card-price-chart-range');
    const periodsContainer = document.getElementById('card-price-periods');
    if (!canvas || typeof Chart === 'undefined') return;

    const { data, error } = await supabaseClient
        .from('card_price_history')
        .select('*')
        .eq('tcgdex_id', tcgdexId)
        .order('recorded_at', { ascending: true })
        .limit(100);

    if (cardPriceChartInstance) {
        cardPriceChartInstance.destroy();
        cardPriceChartInstance = null;
    }

    if (error || !data || data.length < 2) {
        canvas.style.display = 'none';
        if (rangeLabel) rangeLabel.style.display = 'none';
        if (periodsContainer) {
            periodsContainer.innerHTML = '';
            periodsContainer.style.display = 'none';
        }
        emptyMsg.style.display = 'block';
        return;
    }

    canvas.style.display = 'block';
    emptyMsg.style.display = 'none';

    const values = data.map(d => Number(d.market_value));
    const trendUp = values[values.length - 1] >= values[0];
    const lineColor = trendUp ? '#4ade80' : '#ff6b6b';
    const fillColor = trendUp ? 'rgba(74, 222, 128, 0.12)' : 'rgba(255, 107, 107, 0.1)';

    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    if (rangeLabel) {
        rangeLabel.style.display = 'flex';
        rangeLabel.innerHTML = minVal === maxVal
            ? `<span>Stable à ${minVal.toFixed(2)}€</span>`
            : `<span>Min ${minVal.toFixed(2)}€</span><span>Max ${maxVal.toFixed(2)}€</span>`;
    }

    if (periodsContainer) {
        const currentValue = values[values.length - 1];
        const now = Date.now();
        const periods = [
            { label: '1 jour', ms: 1 * 24 * 60 * 60 * 1000 },
            { label: '7 jours', ms: 7 * 24 * 60 * 60 * 1000 },
            { label: '30 jours', ms: 30 * 24 * 60 * 60 * 1000 }
        ];

        const rowsHtml = periods.map(p => {
            const cutoff = now - p.ms;
            // Point de référence : la donnée la plus récente à ou avant cette date
            let basePoint = null;
            for (const point of data) {
                if (new Date(point.recorded_at).getTime() <= cutoff) {
                    basePoint = point;
                } else {
                    break;
                }
            }

            if (!basePoint || Number(basePoint.market_value) === 0) {
                return `
                    <div class="period-row">
                        <span class="period-label">Depuis ${p.label}</span>
                        <span class="period-value neutral">—</span>
                    </div>
                `;
            }

            const baseValue = Number(basePoint.market_value);
            const pct = ((currentValue - baseValue) / baseValue) * 100;
            const deltaValue = currentValue - baseValue;
            const cls = pct > 0 ? 'positive' : pct < 0 ? 'negative' : 'neutral';
            const sign = pct > 0 ? '+' : '';

            return `
                <div class="period-row">
                    <span class="period-label">Depuis ${p.label}</span>
                    <span class="period-value ${cls}">${sign}${pct.toFixed(0)}% <span class="period-value-abs">(${sign}${deltaValue.toFixed(2)}€)</span></span>
                </div>
            `;
        }).join('');

        periodsContainer.style.display = '';
        periodsContainer.innerHTML = rowsHtml;
    }

    cardPriceChartInstance = new Chart(canvas, {
        type: 'line',
        data: {
            labels: data.map(d => new Date(d.recorded_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })),
            datasets: [{
                data: values,
                borderColor: lineColor,
                backgroundColor: fillColor,
                fill: true,
                tension: 0.3,
                pointRadius: 3,
                pointHoverRadius: 5,
                pointBackgroundColor: lineColor,
                pointBorderColor: '#1B2233',
                pointBorderWidth: 1.5,
                pointHitRadius: 8,
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#161B29',
                    titleColor: '#8A93A6',
                    bodyColor: '#F7F3EA',
                    borderColor: 'rgba(255,255,255,0.15)',
                    borderWidth: 1,
                    padding: 8,
                    displayColors: false,
                    titleFont: { size: 11 },
                    bodyFont: { size: 13, weight: 'bold' },
                    callbacks: { label: (ctx) => `${ctx.parsed.y.toFixed(2)}€` }
                }
            },
            scales: {
                x: { display: false },
                y: {
                    display: false,
                    beginAtZero: true,
                    suggestedMax: maxVal * 1.15 || 1
                }
            }
        }
    });
}

// ===== EDITION D'UNE CARTE DEPUIS LA FICHE DETAIL =====

async function showCardEditForm(cardId) {
    const card = allCollectionCards.find(c => c.id === cardId);
    if (!card) return;

    const isPack = card.acquisition_type === 'pack';
    const currentFinish = card.finish || 'normal';

    // Récupérer le détail complet (variants_detailed) pour proposer les vraies finitions disponibles
    let fullDetail = null;
    if (card.tcgdex_id) {
        try {
            let response = await fetch(`${API_BASE}/cards/${card.tcgdex_id}`);
            let detail = await response.json();
            if (!detail || detail.status) {
                const enResponse = await fetch(`${API_EN}/cards/${card.tcgdex_id}`);
                detail = await enResponse.json();
            }
            if (detail && !detail.status) fullDetail = detail;
        } catch (error) {
            console.error('Erreur récupération détails pour les finitions:', error);
        }
    }

    let finishOptionsHtml;
    if (fullDetail) {
        finishOptionsHtml = buildFinishOptionsHtml(fullDetail, currentFinish);
        if (!finishOptionsHtml.includes(`value="${currentFinish}"`)) {
            finishOptionsHtml += `<option value="${currentFinish}" selected>${getFinishLabel(currentFinish) || 'Normale'}</option>`;
        }
    } else {
        // Filet de sécurité si pas d'identifiant TCGdex ou requête échouée
        const fallbackOptions = [
            { value: 'normal', label: 'Normale' },
            { value: 'reverse', label: 'Reverse' },
            { value: 'first_edition', label: '1ère édition' }
        ];
        if (!fallbackOptions.some(o => o.value === currentFinish)) {
            fallbackOptions.push({ value: currentFinish, label: getFinishLabel(currentFinish) || currentFinish });
        }
        finishOptionsHtml = fallbackOptions.map(o => `<option value="${o.value}" ${o.value === currentFinish ? 'selected' : ''}>${o.label}</option>`).join('');
    }

    const modalCard = document.getElementById('card-detail-card');
    modalCard.innerHTML = `
        <button class="modal-close" onclick="closeCardDetail()">✕</button>
        <div class="modal-body">
            <div class="modal-image-wrap">
                ${card.image
                    ? `<img src="${card.image}" alt="${card.name}" class="modal-image" onerror="this.outerHTML=getModalUploadPlaceholder(${card.id})">`
                    : getModalUploadPlaceholder(card.id)
                }
            </div>
            <div class="modal-info">
                <div class="modal-title">${card.name}</div>
                <div class="modal-subtitle">${card.series} · #${card.number}</div>

                <div class="edit-form-grid">
                    <div class="form-group">
                        <label for="edit-condition">État</label>
                        <select id="edit-condition">
                            <option value="NM" ${card.condition === 'NM' ? 'selected' : ''}>Neuf (NM)</option>
                            <option value="LP" ${card.condition === 'LP' ? 'selected' : ''}>Très bon (LP)</option>
                            <option value="MP" ${card.condition === 'MP' ? 'selected' : ''}>Bon (MP)</option>
                            <option value="HP" ${card.condition === 'HP' ? 'selected' : ''}>Mauvais état (HP)</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="edit-finish">Finition</label>
                        <select id="edit-finish">
                            ${finishOptionsHtml}
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="edit-quantity">Quantité</label>
                        <input type="number" id="edit-quantity" value="${Number(card.quantity || 1)}" min="1" max="100">
                    </div>
                    <div class="form-group">
                        <label for="edit-acquisition">Obtention</label>
                        <select id="edit-acquisition" onchange="toggleEditPurchasePriceField()">
                            <option value="achat" ${!isPack ? 'selected' : ''}>Achetée</option>
                            <option value="pack" ${isPack ? 'selected' : ''}>Sortie d'un booster</option>
                        </select>
                    </div>
                    <div class="form-group" id="edit-purchase-price-group" style="${isPack ? 'display:none;' : ''}">
                        <label for="edit-purchase-price">Prix payé (€)</label>
                        <input type="number" id="edit-purchase-price" value="${Number(card.purchase_price || 0).toFixed(2)}" step="0.01" min="0">
                    </div>
                    <div class="form-group">
                        <label for="edit-date-added">Date d'acquisition</label>
                        <input type="text" id="edit-date-added" value="${card.created_at ? new Date(card.created_at).toISOString().split('T')[0] : ''}">
                    </div>
                </div>

                <div class="form-group" style="margin-bottom: 1rem;">
                    <label for="edit-notes">Note personnelle</label>
                    <textarea id="edit-notes" rows="2" placeholder="Cadeau de mamie, trouvée à la brocante...">${card.notes ? card.notes.replace(/</g, '&lt;') : ''}</textarea>
                </div>

                <div class="modal-edit-actions">
                    <button class="modal-save-btn" onclick="saveCardEdits(${card.id})"><i class="ti ti-device-floppy" aria-hidden="true"></i> Enregistrer</button>
                    <button class="modal-cancel-btn" onclick="showCardDetail(${card.id})">Annuler</button>
                </div>
            </div>
        </div>
    `;

    document.getElementById('card-detail-overlay').classList.add('active');
    initDatePicker('#edit-date-added');
}

function toggleEditPurchasePriceField() {
    const val = document.getElementById('edit-acquisition').value;
    document.getElementById('edit-purchase-price-group').style.display = val === 'pack' ? 'none' : '';
}

async function saveCardEdits(cardId) {
    const condition = document.getElementById('edit-condition').value;
    const finish = document.getElementById('edit-finish').value;
    const quantity = parseInt(document.getElementById('edit-quantity').value) || 1;
    const acquisitionType = document.getElementById('edit-acquisition').value;
    const purchasePrice = acquisitionType === 'pack'
        ? 0
        : (parseFloat(document.getElementById('edit-purchase-price').value) || 0);
    const dateValue = document.getElementById('edit-date-added').value;
    const notes = document.getElementById('edit-notes').value.trim();

    const existingCard = allCollectionCards.find(c => c.id === cardId);
    if (!existingCard) return;

    const marketValue = Number(existingCard.market_value || 0);

    // Ancienne contribution (avant modification) pour retirer du bon mois
    const oldQuantity = Number(existingCard.quantity || 1);
    const oldPurchasePrice = Number(existingCard.purchase_price || 0);
    const oldDate = existingCard.created_at ? new Date(existingCard.created_at) : new Date();
    const oldMonthKey = `${oldDate.getFullYear()}-${String(oldDate.getMonth() + 1).padStart(2, '0')}`;

    // Nouvelle date et nouvelle contribution
    const newDate = dateValue ? new Date(dateValue + 'T12:00:00') : oldDate;
    const newMonthKey = `${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, '0')}`;

    const updatePayload = {
        condition,
        finish,
        quantity,
        acquisition_type: acquisitionType,
        purchase_price: purchasePrice,
        notes: notes || null
    };
    if (dateValue) {
        updatePayload.date_added = newDate.toLocaleDateString('fr-FR');
        updatePayload.created_at = newDate.toISOString();
    }

    const { error } = await supabaseClient.from('cards').update(updatePayload).eq('id', cardId);

    if (error) {
        showMessage('Erreur lors de la modification', 'error');
        console.error(error);
        return;
    }

    // Réconcilier l'historique mensuel : retirer l'ancienne contribution, ajouter la nouvelle
    await adjustMonthlyStatsAmount(oldMonthKey, -oldQuantity, -(oldPurchasePrice * oldQuantity), -(marketValue * oldQuantity));
    await adjustMonthlyStatsAmount(newMonthKey, quantity, purchasePrice * quantity, marketValue * quantity);

    showMessage('Carte mise à jour', 'success');
    await refreshCollection();
    await recordValueSnapshot();
    showCardDetail(cardId);
}

function closeCardDetail() {
    document.getElementById('card-detail-overlay').classList.remove('active');
}

async function handleModalSeriesSymbolUpload(event, setId, cardId) {
    const file = event.target.files[0];
    if (!file) return;

    try {
        showMessage('Envoi du symbole...', 'success');
        await uploadSeriesSymbolManually(file, setId);
        showMessage('Symbole ajouté ! Il sera visible sur toutes les cartes de cette série.', 'success');
        await refreshCollection();
        showCardDetail(cardId);
    } catch (error) {
        showMessage('Erreur lors de l\'envoi du symbole', 'error');
        console.error(error);
    }
}

async function handleModalSeriesLogoUpload(event, setId, cardId) {
    const file = event.target.files[0];
    if (!file) return;

    try {
        showMessage('Envoi du logo...', 'success');
        await uploadSeriesLogoManually(file, setId);
        showMessage('Logo ajouté ! Il sera visible sur toutes les cartes de cette série.', 'success');
        await refreshCollection();
        showCardDetail(cardId);
    } catch (error) {
        showMessage('Erreur lors de l\'envoi du logo', 'error');
        console.error(error);
    }
}

// Placeholder utilisé dans la grille/tableau de collection : ouvre la fiche détail au clic
// (comme le reste de la carte), au lieu de lancer directement l'upload.
function getCollectionUploadPlaceholder(cardId, sizeClass = 'thumb') {
    return `<div class="no-image-placeholder ${sizeClass} upload-placeholder" onclick="event.stopPropagation(); showCardDetail(${cardId})">
        <i class="ti ti-photo-off" aria-hidden="true"></i>
    </div>`;
}

// Placeholder utilisé dans la modale de détail : clique dessus pour uploader une image directement
function getModalUploadPlaceholder(cardId) {
    return `<div class="no-image-placeholder modal-size upload-placeholder" onclick="document.getElementById('modal-upload-${cardId}').click()">
        <i class="ti ti-photo-off" aria-hidden="true"></i><br>
        <span class="upload-hint"><i class="ti ti-camera" aria-hidden="true"></i> Cliquer pour ajouter</span>
        <input type="file" id="modal-upload-${cardId}" accept="image/*" style="display:none" onchange="handleCollectionImageUpload(event, ${cardId})">
    </div>`;
}

async function handleCollectionImageUpload(event, cardId) {
    const file = event.target.files[0];
    if (!file) return;

    try {
        showMessage('Envoi de l\'image...', 'success');
        const cardEntry = allCollectionCards.find(c => c.id === cardId);
        const tcgdexId = cardEntry ? cardEntry.tcgdex_id : null;
        const publicUrl = await uploadImageToStorage(file, tcgdexId);

        const { error } = await supabaseClient
            .from('cards')
            .update({ image: publicUrl })
            .eq('id', cardId);

        if (error) throw error;

        showMessage('Image ajoutée !', 'success');
        await refreshCollection();
    } catch (error) {
        showMessage('Erreur lors de l\'envoi de l\'image', 'error');
        console.error(error);
    }
}
