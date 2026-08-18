// Modale détail/édition de carte - Pokémon Tracker
// Dépend de: allCollectionCards/supabaseClient/API_BASE/API_EN/adjustMonthlyStatsAmount/refreshCollection/recordValueSnapshot (tracker.js),
// getRarityIconHtml/renderFinishBadge/getSetIdFromTcgdexId/getFinishLabel/buildFinishOptionsHtml/initDatePicker (utils.js),
// uploadImageToStorage/uploadSeriesSymbolManually/uploadSeriesLogoManually (storage.js), showMessage (utils.js),
// runCardDetailMorphTransition (card-grid-renderer.js)
// Etat possédé : cardPriceChartInstance

// Origine de la fiche actuellement ouverte (VT1, cf roadmap technique animations premium), pour la
// fermeture symétrique fiche -> grille dans closeCardDetail() plus bas. Volontairement minimal :
// seulement l'id de carte + l'id du conteneur d'où le clic est parti (cf
// CARD_DETAIL_ORIGIN_CONTAINER_SELECTOR) - jamais une référence DOM gardée pendant toute l'ouverture,
// la carte source peut disparaître/être recréée entre-temps (filtre, tri, changement de mode) : on la
// retrouve dans le DOM réel au moment de la fermeture, pas avant. containerId évite qu'une carte
// visible dans un AUTRE mode/onglet (caché pendant que la fiche est ouverte) soit prise à tort pour
// la bonne source - une même carte peut exister dans plusieurs zones DOM à la fois.
let cardDetailOrigin = null;

// VT3 (cf roadmap technique animations premium) : liste explicite étendue à Progression/Dashboard
// (wrappers stables et évidents, cf audit VT3) plutôt qu'un attribut/registry générique - seulement 3
// entrées de plus, pas de justification à construire une abstraction pour si peu. Tableau Collection
// et Statistiques restent volontairement hors de cette liste (VT5, cf roadmap - showCardDetail y est
// encore appelé sans event, aucun changement ici).
const CARD_DETAIL_ORIGIN_CONTAINER_SELECTOR =
    '#collection-grid-wrapper, #collection-binder-wrapper, #collection-recap-wrapper, ' +
    '#progression-cards-grid, #dashboard-acquisitions-body, #dashboard-activity-body';

// Point d'entrée public (Phase 4, View Transitions, cf roadmap technique) : délègue la mécanique du
// morph à runCardDetailMorphTransition (card-grid-renderer.js, partagée avec showPublicCardDetail),
// ce fichier ne garde que son propre rendu (renderCardDetail).
function showCardDetail(cardId, event) {
    if (event?.currentTarget) {
        const originContainer = event.currentTarget.closest(CARD_DETAIL_ORIGIN_CONTAINER_SELECTOR);
        cardDetailOrigin = originContainer ? { cardId, containerId: originContainer.id } : null;
    } else if (!cardDetailOrigin || cardDetailOrigin.cardId !== cardId) {
        // Réouverture interne sans event (édition/upload, cf showCardEditForm/saveCardEdits plus
        // bas) pour une carte différente de l'origine déjà mémorisée, ou sans origine connue : pas
        // de source fiable à retenir. Si c'est la MÊME carte, on garde l'origine de l'ouverture
        // initiale - la fiche n'a jamais vraiment fermé entre les deux.
        cardDetailOrigin = null;
    }
    runCardDetailMorphTransition(event, () => renderCardDetail(cardId));
}

function renderCardDetail(cardId) {
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
    const illustratorName = (card.illustrator || '').trim();
    const safeIllustratorName = illustratorName.replace(/'/g, "\\'");

    const oldDateInput = document.getElementById('edit-date-added');
    if (oldDateInput && oldDateInput._flatpickr) oldDateInput._flatpickr.destroy();

    const modalCard = document.getElementById('card-detail-card');
    modalCard.innerHTML = `
        <button class="modal-close" onclick="closeCardDetail()"><i class="ti ti-x" aria-hidden="true"></i></button>
        <div class="modal-scroll">
        <div class="modal-body">
            <div class="modal-image-wrap">
                <div class="modal-stand">
                    ${card.image
                        ? `<img src="${card.image}" alt="${card.name}" class="modal-image" onerror="this.outerHTML=getModalUploadPlaceholder(${card.id})">`
                        : getModalUploadPlaceholder(card.id)
                    }
                </div>
                ${card.tcgdex_id ? `
                    <div class="card-price-chart-wrap" id="card-price-chart-wrap">
                        <div class="card-price-chart-header" onclick="toggleCardPriceChart('${card.tcgdex_id}')">
                            <div class="card-price-chart-title">Historique des prix</div>
                            <div class="card-price-chart-periods" id="card-price-chart-periods" onclick="event.stopPropagation()">
                                <button class="chart-period-btn" data-days="1" onclick="setCardPriceChartPeriod(1, this)">1J</button>
                                <button class="chart-period-btn" data-days="7" onclick="setCardPriceChartPeriod(7, this)">7J</button>
                                <button class="chart-period-btn active" data-days="30" onclick="setCardPriceChartPeriod(30, this)">30J</button>
                            </div>
                            <i class="ti ti-chevron-down card-price-chart-toggle" aria-hidden="true"></i>
                        </div>
                        <div class="card-price-chart-body">
                            <div class="card-price-chart-plot">
                                <canvas id="card-price-chart"></canvas>
                                <p id="card-price-chart-empty" class="card-price-chart-empty" style="display:none;">Historique pas encore disponible</p>
                                <div id="card-price-chart-range" class="card-price-chart-range"></div>
                            </div>
                            <div id="card-price-stat" class="card-price-stat"></div>
                        </div>
                    </div>
                ` : ''}
            </div>
            <div class="modal-info">
                <div class="modal-main-col">
                    <div class="modal-title-row">
                        <div class="modal-title">${card.name}</div>
                        ${card.tcgdex_id ? favoriteStarHtml(card.tcgdex_id) : ''}
                    </div>
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

                    <div class="modal-value-block">
                        <div class="modal-value-label">Valeur estimée</div>
                        <div class="modal-value-row">
                            <span class="modal-price">${marketValue.toFixed(2).replace('.', ',')}€</span>
                            <span class="modal-trend-dot"><i class="ti ti-chart-line" aria-hidden="true"></i></span>
                        </div>
                        ${!isPack ? `
                        <div class="modal-price-line">
                            <span class="modal-price-label">Prix payé</span>
                            <span class="modal-price-secondary">${purchasePrice.toFixed(2).replace('.', ',')}€</span>
                        </div>` : ''}
                        ${qty > 1 ? `<div class="modal-price-total">Valeur totale : ${lineTotal.toFixed(2).replace('.', ',')}€ (×${qty})</div>` : ''}
                    </div>

                    <div class="modal-meta-actions-row">
                        <div class="modal-meta-list">
                            ${card.type && card.type !== 'N/A' ? `<div class="modal-meta-row"><span class="modal-meta-key">${getTypesIconsHtml(card.type, 20)} Type</span><span class="modal-meta-val">${card.type}</span></div>` : ''}
                            <div class="modal-meta-row"><span class="modal-meta-key"><i class="ti ti-stack-2" aria-hidden="true"></i> Quantité</span><span class="modal-meta-val">${qty}</span></div>
                            ${card.date_added ? `<div class="modal-meta-row"><span class="modal-meta-key"><i class="ti ti-calendar" aria-hidden="true"></i> Ajoutée le</span><span class="modal-meta-val">${card.date_added}</span></div>` : ''}
                            <div class="modal-meta-row"><span class="modal-meta-key"><i class="ti ti-hash" aria-hidden="true"></i> Numéro</span><span class="modal-meta-val">${card.number}</span></div>
                            ${illustratorName ? `<div class="modal-meta-row"><span class="modal-meta-key"><i class="ti ti-user" aria-hidden="true"></i> Illustrateur</span><span class="modal-meta-val"><button type="button" class="illustrator-link" onclick="filterCollectionByIllustrator('${safeIllustratorName}')" data-tooltip="Voir toutes les cartes illustrées par ${escapeHtml(illustratorName)} dans ta collection">${escapeHtml(illustratorName)}</button></span></div>` : ''}
                        </div>

                        <div class="modal-actions-col">
                            <button class="modal-action-row" onclick="showCardEditForm(${card.id})">
                                <span class="modal-action-icon" style="color: #e3bc84;"><i class="ti ti-edit" aria-hidden="true"></i></span>
                                <span class="modal-action-text">
                                    <span class="modal-action-title" style="color: #e3bc84;">Modifier</span>
                                    <span class="modal-action-subtitle">Mettre à jour les informations</span>
                                </span>
                                <i class="ti ti-chevron-right modal-action-chevron" aria-hidden="true"></i>
                            </button>
                            <a href="${card.cardmarket_id
                                ? `https://www.cardmarket.com/fr/Pokemon/Products?idProduct=${card.cardmarket_id}&language=2`
                                : `https://www.cardmarket.com/fr/Pokemon/Products/Search?searchString=${encodeURIComponent(card.name || '')}&language=2`
                            }" target="_blank" rel="noopener noreferrer" class="modal-action-row">
                                <span class="modal-action-icon" style="color: #6bcbff;"><i class="ti ti-external-link" aria-hidden="true"></i></span>
                                <span class="modal-action-text">
                                    <span class="modal-action-title" style="color: #6bcbff;">${card.cardmarket_id ? 'Ouvrir sur Cardmarket' : 'Chercher sur Cardmarket'}</span>
                                    <span class="modal-action-subtitle">Voir l'annonce correspondante</span>
                                </span>
                                <i class="ti ti-chevron-right modal-action-chevron" aria-hidden="true"></i>
                            </a>
                            <button class="modal-action-row modal-action-row-danger" onclick="deleteCard(${card.id}); closeCardDetail();">
                                <span class="modal-action-icon"><i class="ti ti-trash" aria-hidden="true"></i></span>
                                <span class="modal-action-text">
                                    <span class="modal-action-title">Retirer de la collection</span>
                                    <span class="modal-action-subtitle">Supprimer cette carte</span>
                                </span>
                                <i class="ti ti-chevron-right modal-action-chevron" aria-hidden="true"></i>
                            </button>
                        </div>
                    </div>
                    ${card.notes ? `<div class="modal-note"><i class="ti ti-note" aria-hidden="true"></i> ${escapeHtml(card.notes)}</div>` : ''}
                </div>
            </div>
        </div>
        <div class="modal-disclaimer">
            <span class="modal-disclaimer-icon"><i class="ti ti-info-circle" aria-hidden="true"></i></span>
            <span class="modal-disclaimer-text">
                <span class="modal-disclaimer-title">Les prix sont fournis à titre indicatif par Cardmarket.</span>
                <span class="modal-disclaimer-sub">Mise à jour quotidienne.</span>
            </span>
        </div>
        </div>
    `;

    document.getElementById('card-detail-overlay').classList.add('active');

    if (card.tcgdex_id) {
        if (window.matchMedia('(max-width: 768px)').matches) {
            // Replié par défaut sur mobile (allégement fiche carte, 2026-08-18) : Chart.js n'est
            // initialisé qu'à la première ouverture du volet (toggleCardPriceChart ci-dessous), jamais
            // pendant qu'il est masqué - un canvas cache CSS (display:none) a des dimensions nulles,
            // Chart.js s'y dessinerait de façon cassée. Desktop inchangé (toujours déplié d'office).

            // Deplacement DOM reel (pas juste visuel via CSS order) : le graphique reste imbrique dans
            // .modal-image-wrap (colonne image desktop, cf CSS ::before/bleed dedie a cette largeur-la)
            // - impossible a repositionner en CSS pur sans casser cette mise en page desktop, jamais
            // touchee ici. Sur mobile uniquement, deplace apres le bloc prix (retour utilisateur : voir
            // la carte + le nom d'abord, le graphique vient ensuite) - le noeud (canvas, id, listeners)
            // n'est pas recree, juste reancre : le repli/depli et le chargement paresseux plus bas
            // continuent de fonctionner normalement.
            const chartWrap = document.getElementById('card-price-chart-wrap');
            const valueBlock = modalCard.querySelector('.modal-value-block');
            if (chartWrap && valueBlock) {
                valueBlock.insertAdjacentElement('afterend', chartWrap);
            }
        } else {
            // Décalé après la frame courante (fluidité mobile, cf roadmap technique animations
            // premium) : renderCardPriceChart() est déjà async (attend Supabase avant de dessiner),
            // donc rarement en concurrence avec l'animation en pratique, mais sur connexion
            // rapide/réponse déjà en cache navigateur, l'initialisation Chart.js pouvait tomber pile
            // pendant les toutes premières frames du morph - requestAnimationFrame garantit qu'elle ne
            // démarre jamais avant que le navigateur ait eu l'occasion de peindre au moins une frame.
            requestAnimationFrame(() => renderCardPriceChart(card.tcgdex_id));
        }
    }
}

// Volet repliable du graphique de prix sur mobile (allégement fiche carte, 2026-08-18) : desktop garde
// le graphique toujours déplié (cf renderCardDetail), cette fonction n'a d'effet visuel qu'en dessous
// de 768px (règles CSS scopées, styles.css). Chargement paresseux : Chart.js n'est initialisé qu'au
// premier dépli (dataset.loaded), jamais en amont sur un canvas encore masqué.
function toggleCardPriceChart(tcgdexId) {
    const wrap = document.getElementById('card-price-chart-wrap');
    if (!wrap) return;

    const expanding = !wrap.classList.contains('expanded');
    wrap.classList.toggle('expanded', expanding);

    if (expanding && wrap.dataset.loaded !== 'true') {
        wrap.dataset.loaded = 'true';
        renderCardPriceChart(tcgdexId);
    }
}

let cardPriceChartInstance = null;
let cardPriceChartData = null;

async function renderCardPriceChart(tcgdexId) {
    const canvas = document.getElementById('card-price-chart');
    if (!canvas || typeof Chart === 'undefined') return;

    // .not(...'is', null) : une ligne avec recorded_at absent (ancien point mal formé, ex. tout
    // premier insert avant l'ajout de cette colonne) trierait en dernier même en ordre croissant
    // (comportement NULLS LAST de Postgres), et serait alors prise à tort pour "la valeur actuelle"
    // par values[values.length - 1] plus bas.
    const { data, error } = await supabaseClient
        .from('card_price_history')
        .select('*')
        .eq('tcgdex_id', tcgdexId)
        .not('recorded_at', 'is', null)
        .order('recorded_at', { ascending: true })
        .limit(100);

    cardPriceChartData = (!error && data) ? data : [];
    renderCardPriceChartForPeriod(30);
}

function renderCardPriceChartForPeriod(days) {
    const canvas = document.getElementById('card-price-chart');
    const emptyMsg = document.getElementById('card-price-chart-empty');
    const rangeLabel = document.getElementById('card-price-chart-range');
    const statBlock = document.getElementById('card-price-stat');
    if (!canvas) return;

    const all = cardPriceChartData || [];
    const cutoff = days > 0 ? Date.now() - days * 24 * 60 * 60 * 1000 : 0;
    const data = days > 0 ? all.filter(d => new Date(d.recorded_at).getTime() >= cutoff) : all;

    if (cardPriceChartInstance) {
        cardPriceChartInstance.destroy();
        cardPriceChartInstance = null;
    }

    if (!data || data.length < 2) {
        canvas.style.display = 'none';
        if (rangeLabel) rangeLabel.style.display = 'none';
        if (statBlock) {
            statBlock.innerHTML = '';
            statBlock.style.display = 'none';
        }
        if (emptyMsg) emptyMsg.style.display = 'block';
        return;
    }

    canvas.style.display = 'block';
    if (emptyMsg) emptyMsg.style.display = 'none';

    const values = data.map(d => Number(d.market_value));
    const trendUp = values[values.length - 1] >= values[0];
    const lineColor = trendUp ? '#7ED9A7' : '#ff6b6b';
    const fillColor = trendUp ? 'rgba(74, 222, 128, 0.07)' : 'rgba(255, 107, 107, 0.06)';

    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    if (rangeLabel) {
        rangeLabel.style.display = 'flex';
        rangeLabel.innerHTML = minVal === maxVal
            ? `<span>Stable à ${minVal.toFixed(2)}€</span>`
            : `<span>Min ${minVal.toFixed(2)}€</span><span>Max ${maxVal.toFixed(2)}€</span>`;
    }

    if (statBlock) {
        const baseValue = values[0];
        const currentValue = values[values.length - 1];
        const periodLabel = days === 0 ? 'depuis le début' : `${days} derniers jours`;

        if (baseValue === 0) {
            statBlock.style.display = 'flex';
            statBlock.innerHTML = `
                <span class="card-price-stat-pct neutral">—</span>
                <span class="card-price-stat-caption">${periodLabel}</span>
            `;
        } else {
            const pct = ((currentValue - baseValue) / baseValue) * 100;
            const delta = currentValue - baseValue;
            const cls = pct > 0 ? 'positive' : pct < 0 ? 'negative' : 'neutral';
            const sign = pct > 0 ? '+' : '';
            statBlock.style.display = 'flex';
            statBlock.innerHTML = `
                <span class="card-price-stat-pct ${cls}">${sign}${pct.toFixed(0)}%</span>
                <span class="card-price-stat-abs ${cls}">(${sign}${delta.toFixed(2).replace('.', ',')}€)</span>
                <span class="card-price-stat-caption">${periodLabel}</span>
            `;
        }
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
                tension: 0.25,
                pointRadius: 0,
                pointHoverRadius: 4,
                pointHoverBackgroundColor: lineColor,
                pointHoverBorderColor: 'rgba(0,0,0,0.4)',
                pointHoverBorderWidth: 1.5,
                pointHitRadius: 8,
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: {
                padding: { top: 6, right: 2, bottom: 2, left: 2 }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#161B29',
                    titleColor: '#8A93A6',
                    bodyColor: '#F7F3EA',
                    borderColor: 'rgba(255,255,255,0.1)',
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

function setCardPriceChartPeriod(days, btn) {
    const container = document.getElementById('card-price-chart-periods');
    if (container) {
        container.querySelectorAll('.chart-period-btn').forEach(b => b.classList.remove('active'));
    }
    if (btn) btn.classList.add('active');
    renderCardPriceChartForPeriod(days);
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

    const oldDateInput = document.getElementById('edit-date-added');
    if (oldDateInput && oldDateInput._flatpickr) oldDateInput._flatpickr.destroy();

    const notesValue = card.notes || '';

    const modalCard = document.getElementById('card-detail-card');
    modalCard.innerHTML = `
        <button class="modal-close" onclick="closeCardDetail()"><i class="ti ti-x" aria-hidden="true"></i></button>
        <div class="modal-scroll">
        <div class="edit-form-header">
            <div class="edit-form-title">Informations de collection</div>
            <div class="edit-form-subtitle">Modifiez les détails de votre exemplaire.</div>
            <div class="edit-form-breadcrumb">
                ${card.series_logo ? `<img src="${card.series_logo}" class="edit-breadcrumb-logo" alt="" onerror="this.remove()">` : ''}
                <span>${card.series}</span>
                <span class="edit-breadcrumb-dot">·</span>
                <span>#${card.number}</span>
            </div>
        </div>
        <div class="modal-body edit-form-body">
            <div class="modal-image-wrap">
                ${card.image
                    ? `<img src="${card.image}" alt="${card.name}" class="modal-image" onerror="this.outerHTML=getModalUploadPlaceholder(${card.id})">`
                    : getModalUploadPlaceholder(card.id)
                }
                <div class="edit-info-box">
                    <i class="ti ti-info-circle" aria-hidden="true"></i>
                    <div class="edit-info-text">
                        <div class="edit-info-title">Vous éditez votre exemplaire de cette carte.</div>
                        <div class="edit-info-sub">Ces informations n'affectent pas la carte elle-même.</div>
                    </div>
                </div>
            </div>
            <div class="edit-fields-grid">
                <div class="edit-field-card">
                    <label class="edit-field-label" for="edit-condition"><i class="ti ti-shield-check" aria-hidden="true"></i> État</label>
                    <select id="edit-condition">
                        <option value="NM" ${card.condition === 'NM' ? 'selected' : ''}>Neuf (NM)</option>
                        <option value="LP" ${card.condition === 'LP' ? 'selected' : ''}>Très bon (LP)</option>
                        <option value="MP" ${card.condition === 'MP' ? 'selected' : ''}>Bon (MP)</option>
                        <option value="HP" ${card.condition === 'HP' ? 'selected' : ''}>Mauvais état (HP)</option>
                    </select>
                </div>
                <div class="edit-field-card">
                    <label class="edit-field-label" for="edit-finish"><i class="ti ti-sparkles" aria-hidden="true"></i> Finition</label>
                    <select id="edit-finish">
                        ${finishOptionsHtml}
                    </select>
                </div>
                <div class="edit-field-card">
                    <label class="edit-field-label" for="edit-quantity"><i class="ti ti-cube" aria-hidden="true"></i> Quantité</label>
                    <input type="number" id="edit-quantity" value="${Number(card.quantity || 1)}" min="1" max="100">
                </div>
                <div class="edit-field-card">
                    <label class="edit-field-label" for="edit-acquisition"><i class="ti ti-gift" aria-hidden="true"></i> Obtention</label>
                    <select id="edit-acquisition" onchange="toggleEditPurchasePriceField()">
                        <option value="achat" ${!isPack ? 'selected' : ''}>Achetée</option>
                        <option value="pack" ${isPack ? 'selected' : ''}>Sortie d'un booster</option>
                    </select>
                </div>
                <div class="edit-field-card" id="edit-purchase-price-group" style="${isPack ? 'display:none;' : ''}">
                    <label class="edit-field-label" for="edit-purchase-price"><i class="ti ti-currency-euro" aria-hidden="true"></i> Prix payé (€)</label>
                    <input type="number" id="edit-purchase-price" value="${Number(card.purchase_price || 0).toFixed(2)}" step="0.01" min="0">
                </div>
                <div class="edit-field-card">
                    <label class="edit-field-label" for="edit-date-added"><i class="ti ti-calendar" aria-hidden="true"></i> Date d'acquisition</label>
                    <input type="text" id="edit-date-added" value="${card.created_at ? toLocalDateInputValue(new Date(card.created_at)) : ''}">
                </div>
                <div class="edit-field-card edit-field-card-wide">
                    <label class="edit-field-label" for="edit-notes"><i class="ti ti-pencil" aria-hidden="true"></i> Note personnelle</label>
                    <textarea id="edit-notes" rows="2" maxlength="300" oninput="document.getElementById('edit-note-counter').textContent = this.value.length + ' / 300'" placeholder="Cadeau de mamie, trouvée à la brocante...">${escapeHtml(notesValue)}</textarea>
                    <div class="edit-note-counter" id="edit-note-counter">${notesValue.length} / 300</div>
                </div>
            </div>
        </div>
        </div>
        <div class="edit-form-actions">
            <button class="modal-cancel-btn" onclick="showCardDetail(${card.id})">Annuler</button>
            <button class="modal-save-btn" onclick="saveCardEdits(${card.id}, this)"><i class="ti ti-device-floppy" aria-hidden="true"></i> Enregistrer les modifications</button>
        </div>
    `;

    document.getElementById('card-detail-overlay').classList.add('active');
    initDatePicker('#edit-date-added');
}

function toggleEditPurchasePriceField() {
    const val = document.getElementById('edit-acquisition').value;
    document.getElementById('edit-purchase-price-group').style.display = val === 'pack' ? 'none' : '';
}

async function saveCardEdits(cardId, btn) {
    if (btn.disabled) return;
    const originalBtnHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="loading"></span> Enregistrement...';

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
        btn.disabled = false;
        btn.innerHTML = originalBtnHtml;
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

// Retrouve la carte source réellement VISIBLE (pas seulement présente dans le DOM) dans le
// conteneur d'origine mémorisé à l'ouverture (VT1). Un mode Collection caché (ex. Galerie masquée
// pendant que le Tableau est affiché, ou Classeur revenu sur une autre page) garde son contenu en
// mémoire DOM sans être visible - offsetParent est null pour tout élément display:none (lui-même ou
// un ancêtre), suffisant ici sans recourir à getComputedStyle.
function findVisibleCardDetailSource(containerId, cardId) {
    const container = document.getElementById(containerId);
    if (!container || container.offsetParent === null) return null;
    const el = container.querySelector(`[data-card-id="${cardId}"]`);
    if (!el || el.offsetParent === null) return null;
    return el;
}

// VT1 (cf roadmap technique animations premium) : fermeture symétrique à l'ouverture quand la carte
// source est encore visible dans sa vue d'origine - l'image de la fiche morphe vers son emplacement
// de départ au lieu de disparaître instantanément. Si la source a disparu (filtre changé, mode
// Collection changé, page Classeur tournée, carte plus dans le DOM/cachée) : fermeture instantanée
// normale, on ne force jamais de morph vers une destination inexistante ou non pertinente (pas de
// scroll automatique, pas de changement de filtre/page pour "retrouver" la carte).
function closeCardDetail() {
    const overlay = document.getElementById('card-detail-overlay');
    if (!overlay.classList.contains('active')) return;

    const origin = cardDetailOrigin;
    cardDetailOrigin = null;

    const sourceEl = origin ? findVisibleCardDetailSource(origin.containerId, origin.cardId) : null;
    const sourceImg = sourceEl ? sourceEl.querySelector('img') : null;
    const modalImg = overlay.querySelector('.modal-image');
    // Desactive sur mobile, symetrique a runCardDetailMorphTransition (card-grid-renderer.js) : sans
    // ce garde-fou, la fermeture (swipe ou croix) gardait le morph inverse alors que l'ouverture ne
    // l'a plus - signale par l'utilisateur ("la carte qui retourne a son emplacement" au swipe).
    const isMobile = window.matchMedia('(max-width: 768px)').matches;

    if (!sourceImg || !modalImg || typeof document.startViewTransition !== 'function' || isMobile) {
        overlay.classList.remove('active');
        return;
    }

    modalImg.style.viewTransitionName = 'card-detail-morph';

    const cleanup = () => {
        modalImg.style.viewTransitionName = '';
        sourceImg.style.viewTransitionName = '';
    };

    const transition = runViewTransition('card-detail', () => {
        // Symétrique à l'ouverture (cf card-grid-renderer.js) : retirer explicitement le nom de
        // modalImg avant de l'assigner à sourceImg, plutôt que de compter sur le fait que masquer
        // l'overlay le rend implicitement invisible avant la capture "new" - ce comportement n'est
        // pas garanti, autant ne jamais laisser deux éléments porter le même nom même brièvement.
        overlay.classList.remove('active');
        modalImg.style.viewTransitionName = '';
        sourceImg.style.viewTransitionName = 'card-detail-morph';
    });

    if (!transition) {
        // reduced-motion : runViewTransition a déjà fermé l'overlay en synchrone, rien d'autre à
        // faire que de retirer les noms posés avant de le savoir.
        cleanup();
        return;
    }

    transition.finished.finally(cleanup);
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

// ===== Exports window (ticket V2 Vite, type="module") =====
// Les déclarations top-level d'un module ES ne s'attachent plus automatiquement à window
// (contrairement à un <script> classique) : réexport explicite pour que les autres scripts
// (chargés en modules indépendants, sans import/export entre eux, scope global inchangé)
// puissent continuer à référencer ces noms tels quels — y compris depuis des onclick="..."
// inline dans du HTML généré. Liste exhaustive des déclarations top-level de ce fichier
// (hors variables déjà passées en window.x = ... directement à leur déclaration, cf audit
// du 2026-08-14 sur l'état mutable partagé entre fichiers).
window.showCardDetail = showCardDetail;
window.cardPriceChartInstance = cardPriceChartInstance;
window.cardPriceChartData = cardPriceChartData;
window.renderCardPriceChart = renderCardPriceChart;
window.toggleCardPriceChart = toggleCardPriceChart;
window.renderCardPriceChartForPeriod = renderCardPriceChartForPeriod;
window.setCardPriceChartPeriod = setCardPriceChartPeriod;
window.showCardEditForm = showCardEditForm;
window.toggleEditPurchasePriceField = toggleEditPurchasePriceField;
window.saveCardEdits = saveCardEdits;
window.closeCardDetail = closeCardDetail;
window.handleModalSeriesSymbolUpload = handleModalSeriesSymbolUpload;
window.handleModalSeriesLogoUpload = handleModalSeriesLogoUpload;
window.getCollectionUploadPlaceholder = getCollectionUploadPlaceholder;
window.getModalUploadPlaceholder = getModalUploadPlaceholder;
window.handleCollectionImageUpload = handleCollectionImageUpload;
