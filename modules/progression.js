// Progression par série + ajout rapide - Pokémon Tracker
// Dépend de: supabaseClient/API_BASE/API_EN/allCollectionCards/performCardAdd/refreshCollection/recordValueSnapshot (tracker.js),
// sanitizeForPath/getSetIdFromTcgdexId/sortRaritiesByTier/buildRarityFilterRowHtml/getFoilIconHtml/buildFinishOptionsHtml/
// getRarityIconHtml/initDatePicker/getCardmarketUrl (utils.js), getStoredImageFilenames/uploadImageToStorage/uploadSeriesLogoManually (storage.js),
// showCardDetail/closeCardDetail (card-detail.js), getGridNoImageHtml (card-grid-renderer.js), showMessage (utils.js),
// openWishlistPicker/allWishlistItems (wishlist.js)
// Le HTML de renderProgressionCardsGrid appelle showAddCardModal/quickInstantAdd en onclick : ces deux sous-features
// sont couplées via le DOM, d'où leur regroupement dans un seul module.
// Etat possédé : customQuickAddImage, QUICKADD_DEFAULTS_KEY, allTcgdexSeries, currentProgressionSetId,
// currentProgressionCards, progressionFilter, progressionFinishMode, currentProgressionStoredFilenames,
// progressionRarityFilterValues

// window.x plutôt que let (ticket V2 Vite, type="module") : lu depuis tracker.js aussi.
window.customQuickAddImage = null; // URL Supabase Storage une fois uploadée (vignette d'ajout rapide)

// ===== REGLAGES D'AJOUT RAPIDE (Progression) =====

const QUICKADD_DEFAULTS_KEY = 'progressionQuickAddDefaults';

function getQuickAddDefaults() {
    try {
        const stored = localStorage.getItem(QUICKADD_DEFAULTS_KEY);
        if (stored) return JSON.parse(stored);
    } catch (e) { /* ignore */ }
    return { condition: 'NM', quantity: 1, acquisitionType: 'pack', purchasePrice: 0, date: null };
}

function saveQuickAddDefaultsToStorage(defaults) {
    localStorage.setItem(QUICKADD_DEFAULTS_KEY, JSON.stringify(defaults));
}

function openQuickAddSettingsModal() {
    const defaults = getQuickAddDefaults();
    const content = document.getElementById('quickadd-settings-content');

    content.innerHTML = `
        <button class="modal-close" onclick="closeQuickAddSettingsModal()">✕</button>
        <div class="modal-scroll">
            <div class="modal-title" style="margin-bottom: 1rem;">Réglages d'ajout rapide</div>
            <p style="color: var(--slate); font-size: 0.8rem; margin-bottom: 1rem;">
                Utilisés par le bouton "+" (ajout instantané) et pré-remplis dans la fenêtre détaillée.
            </p>
            <div class="edit-form-grid">
                <div class="form-group">
                    <label for="qa-settings-condition">État</label>
                    <select id="qa-settings-condition">
                        <option value="NM">Neuf (NM)</option>
                        <option value="LP">Très bon (LP)</option>
                        <option value="MP">Bon (MP)</option>
                        <option value="HP">Mauvais état (HP)</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="qa-settings-quantity">Quantité</label>
                    <input type="number" id="qa-settings-quantity" min="1" value="${defaults.quantity}">
                </div>
                <div class="form-group">
                    <label for="qa-settings-acquisition">Obtention</label>
                    <select id="qa-settings-acquisition" onchange="toggleQaSettingsPriceField()">
                        <option value="pack">Sortie d'un booster</option>
                        <option value="achat">Achetée</option>
                    </select>
                </div>
                <div class="form-group" id="qa-settings-price-group">
                    <label for="qa-settings-price">Prix payé (€)</label>
                    <input type="number" id="qa-settings-price" step="0.01" min="0" value="${defaults.purchasePrice}">
                </div>
                <div class="form-group">
                    <label for="qa-settings-date">Date d'acquisition (fixe)</label>
                    <input type="text" id="qa-settings-date" placeholder="jj/mm/aaaa">
                </div>
            </div>
            <button class="modal-save-btn full-width" onclick="saveQuickAddSettings()"><i class="ti ti-device-floppy" aria-hidden="true"></i> Enregistrer</button>
        </div>
    `;

    document.getElementById('qa-settings-condition').value = defaults.condition;
    document.getElementById('qa-settings-acquisition').value = defaults.acquisitionType;

    document.getElementById('quickadd-settings-overlay').classList.add('active');
    toggleQaSettingsPriceField();
    initDatePicker('#qa-settings-date', defaults.date || null);
}

function toggleQaSettingsPriceField() {
    const val = document.getElementById('qa-settings-acquisition').value;
    document.getElementById('qa-settings-price-group').style.display = val === 'pack' ? 'none' : '';
}

function closeQuickAddSettingsModal() {
    document.getElementById('quickadd-settings-overlay').classList.remove('active');
}

function saveQuickAddSettings() {
    const condition = document.getElementById('qa-settings-condition').value;
    const quantity = parseInt(document.getElementById('qa-settings-quantity').value) || 1;
    const acquisitionType = document.getElementById('qa-settings-acquisition').value;
    const purchasePrice = acquisitionType === 'pack' ? 0 : (parseFloat(document.getElementById('qa-settings-price').value) || 0);
    const date = document.getElementById('qa-settings-date').value || null;

    saveQuickAddDefaultsToStorage({ condition, quantity, acquisitionType, purchasePrice, date });
    showMessage('Réglages enregistrés', 'success');
    closeQuickAddSettingsModal();
}

// ===== PROGRESSION PAR SERIE =====

// window.x plutôt que let (ticket V2 Vite, type="module") pour allTcgdexSeries/currentProgressionSetId :
// lus depuis stats-render.js/dashboard.js/tracker.js aussi. currentProgressionCards reste 100% locale.
window.allTcgdexSeries = [];
window.currentProgressionSetId = null;
let currentProgressionCards = [];
let progressionFilter = 'all';
let progressionFinishMode = 'normal';
let currentProgressionStoredFilenames = new Set();
let progressionStoredLogoFilenames = new Set();
let progressionLogosLoaded = false;
let progressionLogoCachingTriggered = new Set(); // évite de relancer un upload déjà en cours pendant la session

// Logo d'un set/série : sert la version Supabase déjà cachée en priorité (rapide), sinon le lien TCGdex
// brut en attendant, et déclenche un hébergement en tâche de fond pour que le prochain chargement soit rapide.
function resolveCachedLogoUrl(id, rawLogoBase) {
    const filename = `${sanitizeForPath(id)}.webp`;
    if (progressionStoredLogoFilenames.has(filename)) {
        const { data } = supabaseClient.storage.from('card-images').getPublicUrl(`logos/${filename}`);
        return data.publicUrl;
    }
    if (rawLogoBase) {
        if (!progressionLogoCachingTriggered.has(id)) {
            progressionLogoCachingTriggered.add(id);
            fetchAndUploadSeriesLogo(rawLogoBase, id)
                .then(() => progressionStoredLogoFilenames.add(filename))
                .catch(error => console.error('Logo de série non récupéré (arrière-plan):', error));
        }
        return `${rawLogoBase}.webp`;
    }
    return '';
}

// ===== CÉLÉBRATION SET COMPLÉTÉ (retour utilisateur 2026-09, mockup "Micro-interactions" validé) =====
// Déclenchée depuis modules/cards.js#addCard() quand la carte qui vient d'être ajoutée fait passer un
// set de "presque complet" à 100%. Overlay non bloquant (pointer-events:none, auto-disparition) plutôt
// qu'un ancrage sur l'anneau du set dans la page Progression : la complétion se produit presque
// toujours depuis l'onglet Ajouter, où cet anneau n'existe pas à l'écran - contrairement au mockup
// initial qui l'animait sur place. Un seul déclenchement par complétion, jamais en boucle.
//
// Dépend d'allTcgdexSeries (cf commentaire window.allTcgdexSeries plus haut) : reste vide tant que
// l'onglet Progression n'a pas été visité au moins une fois dans la session (loadSeriesProgress
// ci-dessous) - comme l'objectif du Dashboard (même dépendance, cf markDashboardDirty), on accepte
// silencieusement de ne pas fêter cette complétion plutôt que de forcer un chargement réseau
// supplémentaire à chaque ajout de carte pour une feature purement cosmétique.
function celebrateSetComplete(setId) {
    if (!allTcgdexSeries || allTcgdexSeries.length === 0) return;

    let targetSet = null;
    for (const series of allTcgdexSeries) {
        targetSet = (series.sets || []).find(s => s.id === setId);
        if (targetSet) break;
    }
    if (!targetSet) return;

    const logoUrl = resolveCachedLogoUrl(targetSet.id, targetSet.logo);
    const logoHtml = logoUrl
        ? `<img src="${logoUrl}" class="app-celebration-icon-img" alt="" onerror="this.remove()">`
        : `<i class="ti ti-trophy" aria-hidden="true"></i>`;

    // showCelebrationBanner()/spawnCelebrationConfetti() (utils.js) : bandeau + confetti génériques,
    // partagés avec modules/cards.js#celebrateCardAddedBanner (retour utilisateur 2026-09).
    showCelebrationBanner(`
        <div class="app-celebration-icon-wrap">${logoHtml}</div>
        <div class="app-celebration-text">
            <span class="app-celebration-eyebrow"><i class="ti ti-check" aria-hidden="true"></i> Série complétée</span>
            <span class="app-celebration-title">${escapeHtml(targetSet.name || '')}</span>
        </div>
    `);
}

async function loadSeriesProgress() {
    const container = document.getElementById('progression-series-list');
    container.innerHTML = Array.from({ length: 3 }).map(() => `
        <div class="skeleton-row" style="background: var(--panel); border-radius: 8px; margin-bottom: 0.75rem; border-bottom: none;">
            <div class="skeleton" style="width:44px; height:32px; flex-shrink:0;"></div>
            <div style="flex:1;">
                <div class="skeleton" style="height:14px; width:35%; margin-bottom:8px;"></div>
                <div class="skeleton" style="height:6px; width:80%;"></div>
            </div>
        </div>
    `).join('');

    try {
        if (allTcgdexSeries.length === 0) {
            const seriesListRes = await fetch(`${API_BASE}/series`);
            const seriesList = await seriesListRes.json();

            // Le détail de chaque série contient déjà ses sets complets (logo + cardCount)
            const detailedSeries = await Promise.all(
                seriesList.map(async (s) => {
                    try {
                        const res = await fetch(`${API_BASE}/series/${s.id}`);
                        return await res.json();
                    } catch {
                        return { ...s, sets: [] };
                    }
                })
            );

            // Séries les plus récentes en premier
            allTcgdexSeries = detailedSeries.sort((a, b) => {
                const dateA = a.releaseDate ? new Date(a.releaseDate).getTime() : 0;
                const dateB = b.releaseDate ? new Date(b.releaseDate).getTime() : 0;
                return dateB - dateA;
            });
            // Premier remplissage réel seulement (ce bloc est court-circuité par la condition ci-dessus
            // sur toute relecture suivante) : le KPI "séries complétées" de Stats peut changer.
            markStatsDirty();
        }

        if (!progressionLogosLoaded) {
            // Logos déjà stockés chez nous (auto ou uploadés manuellement), pour les sets sans logo TCGdex
            const { data: storedLogosData } = await supabaseClient.storage.from('card-images').list('logos', { limit: 1000 });
            progressionStoredLogoFilenames = new Set((storedLogosData || []).map(f => f.name));
            progressionLogosLoaded = true;
        }

        // Isolees l'une de l'autre (renderSectionSafe, cf utils.js) : une panne dans les KPI ne doit
        // pas effacer une liste de series deja correctement rendue, et inversement.
        renderSectionSafe('progression-series-list', renderProgressionSeriesList);
        renderSectionSafe('progression-stats-bottom', renderProgressionKpis);
        markDashboardDirty(); // le cache allTcgdexSeries vient peut-être d'être rempli : l'objectif du Dashboard peut changer
    } catch (error) {
        container.innerHTML = '<p style="text-align: center; padding: 2rem; color: var(--slate);">Erreur lors du chargement des séries</p>';
        console.error(error);
    }
}

// KPI de progression (remplacent les KPI globaux sur cette page) : réutilisent exactement la même
// donnée de possession (ownedIdsBySet dérivé de allCollectionCards/tcgdex_id) et la même règle de
// complétion (pct === 100, total incluant les cartes secrètes) que le catalogue (renderProgressionSeriesList).
// Un set à 0 carte possédée n'est jamais comptabilisé (ni en cours, ni complété).
function computeProgressionKpiData() {
    const ownedIdsBySet = {};
    allCollectionCards.forEach(card => {
        if (card.tcgdex_id) {
            const setId = getSetIdFromTcgdexId(card.tcgdex_id);
            if (!ownedIdsBySet[setId]) ownedIdsBySet[setId] = new Set();
            ownedIdsBySet[setId].add(card.tcgdex_id);
        }
    });

    let inProgress = 0;
    let completed = 0;
    let mostAdvanced = null; // { name, pct }, uniquement parmi les sets non terminés

    allTcgdexSeries.forEach(series => {
        (series.sets || []).forEach(set => {
            const officialCount = set.cardCount?.official || 0;
            const total = set.cardCount?.total || officialCount;
            const owned = ownedIdsBySet[set.id]?.size || 0;
            if (owned === 0 || total === 0) return; // set non commencé : pas comptabilisé

            const pct = Math.round((owned / total) * 100);

            if (pct === 100) {
                completed++;
            } else {
                inProgress++;
                if (!mostAdvanced || pct > mostAdvanced.pct) {
                    mostAdvanced = { name: set.name, pct };
                }
            }
        });
    });

    return { inProgress, completed, mostAdvanced };
}

function renderProgressionKpis() {
    const container = document.getElementById('progression-stats-bottom');
    if (!container) return;

    const { inProgress, completed, mostAdvanced } = computeProgressionKpiData();

    document.getElementById('progression-kpi-inprogress').textContent = inProgress;
    document.getElementById('progression-kpi-completed').textContent = completed;

    const pctEl = document.getElementById('progression-kpi-advanced-pct');
    const nameEl = document.getElementById('progression-kpi-advanced-name');

    if (mostAdvanced) {
        pctEl.textContent = `${mostAdvanced.pct}%`;
        nameEl.textContent = mostAdvanced.name;
    } else {
        pctEl.textContent = '—';
        nameEl.textContent = (inProgress === 0 && completed === 0) ? 'Aucun set commencé' : 'Aucun set en cours';
    }
}

// Rendu pur du catalogue (aucun appel réseau) : appelé après chargement initial et à chaque
// ouverture/fermeture de chapitre, pour rester instantané
// Priorisation des sets (Phase 2, ticket P2-3, cf audit du 2026-08-14) : deux catégories objectives,
// jamais un score composite. "Le moins cher à compléter" volontairement absent de cette V1 — demanderait
// de charger le prix de chaque carte manquante de chaque set en cours (aujourd'hui uniquement chargé
// à l'ouverture d'un set précis), trop coûteux pour un calcul à chaque affichage de la liste.
function computeProgressionPriorityGoals(ownedIdsBySet) {
    const inProgress = [];
    allTcgdexSeries.forEach(series => {
        (series.sets || []).forEach(set => {
            const officialCount = set.cardCount?.official || 0;
            const total = set.cardCount?.total || officialCount;
            const owned = ownedIdsBySet[set.id]?.size || 0;
            if (owned === 0 || total === 0) return;
            const pct = Math.round((owned / total) * 100);
            if (pct === 100) return;
            inProgress.push({ set, pct, missing: total - owned });
        });
    });

    if (inProgress.length === 0) return { almostDone: null, mostAccessible: null };

    const almostDone = inProgress.reduce((best, e) => (!best || e.pct > best.pct) ? e : best, null);
    const mostAccessible = inProgress.reduce((best, e) => (!best || e.missing < best.missing) ? e : best, null);

    return { almostDone, mostAccessible };
}

function renderProgressionPriorityGoals(ownedIdsBySet) {
    const container = document.getElementById('progression-priority-goals');
    if (!container) return;

    const { almostDone, mostAccessible } = computeProgressionPriorityGoals(ownedIdsBySet);
    if (!almostDone && !mostAccessible) {
        container.innerHTML = '';
        return;
    }

    const goalCardHtml = (label, entry) => {
        if (!entry) return '';
        const { set, pct, missing } = entry;
        const safeName = (set.name || '').replace(/'/g, "\\'");
        const logoUrl = resolveCachedLogoUrl(set.id, set.logo);
        return `
            <div class="progression-goal-card" onclick="runSetProgressionMorphTransition(event, '${set.id}', '${safeName}', '${logoUrl}')">
                <div class="progression-goal-label">${label}</div>
                ${logoUrl ? `<img src="${logoUrl}" class="progression-goal-logo" alt="" onerror="handleTcgdexImgError(this, (img) => img.remove())">` : ''}
                <div class="progression-goal-name">${set.name}</div>
                <div class="progression-goal-metric">${label === 'Presque terminé' ? `${pct}%` : `${missing} carte${missing > 1 ? 's' : ''} manquante${missing > 1 ? 's' : ''}`}</div>
            </div>
        `;
    };

    // Si le même set gagne les deux catégories, les deux cartes restent affichées : l'information
    // ("pourquoi ce set ressort") diffère même si la cible est identique.
    container.innerHTML = `
        <div class="progression-goals-row">
            ${goalCardHtml('Presque terminé', almostDone)}
            ${goalCardHtml('Ton objectif le plus accessible', mostAccessible)}
        </div>
    `;
}

function renderProgressionSeriesList() {
    const container = document.getElementById('progression-series-list');
    if (!container) return;

    // Compter les cartes DISTINCTES possédées par set (dérivé du tcgdex_id, insensible aux doublons d'état)
    const ownedIdsBySet = {};
    allCollectionCards.forEach(card => {
        if (card.tcgdex_id) {
            const setId = getSetIdFromTcgdexId(card.tcgdex_id);
            if (!ownedIdsBySet[setId]) ownedIdsBySet[setId] = new Set();
            ownedIdsBySet[setId].add(card.tcgdex_id);
        }
    });

    renderProgressionPriorityGoals(ownedIdsBySet);

    // Ne garder que les générations où au moins une extension est entamée
    const seriesWithOwnedSets = allTcgdexSeries
        .map(series => ({ series, sets: (series.sets || []).filter(set => (ownedIdsBySet[set.id]?.size || 0) > 0) }))
        .filter(entry => entry.sets.length > 0);

    // Compte neuf (ou aucune carte avec tcgdex_id) : sans ce garde, container.innerHTML devient une
    // chaîne vide et l'onglet Progression paraît cassé, alors que les KPI juste au-dessus affichent
    // déjà "Aucun set commencé".
    if (seriesWithOwnedSets.length === 0) {
        container.innerHTML = `
            <div class="app-empty-state">
                <svg class="app-empty-icon" viewBox="0 0 100 100" aria-hidden="true">
                    <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" stroke-width="3"/>
                    <line x1="10" y1="50" x2="90" y2="50" stroke="currentColor" stroke-width="3"/>
                    <circle cx="50" cy="50" r="13" fill="none" stroke="currentColor" stroke-width="3"/>
                    <circle cx="50" cy="50" r="4" fill="currentColor"/>
                </svg>
                <div class="app-empty-title">Aucune série commencée</div>
                <p class="app-empty-text">Ajoute ta première carte pour commencer à suivre ta progression.</p>
                <button class="filter-toggle-btn app-empty-cta" onclick="navigateToTab('tab-add')"><i class="ti ti-plus" aria-hidden="true"></i> Ajouter une carte</button>
            </div>
        `;
        return;
    }

    // "Decouvrir d'autres series" (retour utilisateur design 2026-09) : sur un compte avec peu de
    // series entamees, seriesWithOwnedSets ne rend que 1-2 blocs et la page s'arretait la, laissant
    // un grand vide sous le contenu - se lisait comme un bug de chargement plutot qu'un etat normal.
    // Reutilise .app-empty-state (deja partage Collection/Progression/Collecteurs) plutot qu'un
    // nouveau composant, avec un CTA vers une action deja existante (onglet Ajouter).
    const discoverMoreHtml = `
        <div class="app-empty-state progression-discover-more">
            <svg class="app-empty-icon" viewBox="0 0 100 100" aria-hidden="true">
                <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" stroke-width="3"/>
                <polygon points="50,28 58,50 50,72 42,50" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>
                <circle cx="50" cy="50" r="3" fill="currentColor"/>
            </svg>
            <div class="app-empty-title">D'autres séries vous attendent</div>
            <p class="app-empty-text">Ajoutez une carte d'une nouvelle série pour commencer à suivre sa progression ici.</p>
            <button class="filter-toggle-btn app-empty-cta" onclick="navigateToTab('tab-add')"><i class="ti ti-plus" aria-hidden="true"></i> Ajouter une carte</button>
        </div>
    `;

    container.innerHTML = seriesWithOwnedSets.map(({ series, sets }) => {
        const setsHtml = sets.map(set => {
            const officialCount = set.cardCount?.official || 0;
            const total = set.cardCount?.total || officialCount;
            const secretCount = Math.max(0, total - officialCount);
            const owned = ownedIdsBySet[set.id]?.size || 0;
            const pct = total > 0 ? Math.round((owned / total) * 100) : 0;
            const safeName = (set.name || '').replace(/'/g, "\\'");

            const logoUrl = resolveCachedLogoUrl(set.id, set.logo);

            const logoHtml = logoUrl
                ? `<img src="${logoUrl}" class="progression-set-logo" alt="" onerror="handleTcgdexImgError(this, (img) => img.remove())">`
                : `<div class="progression-set-logo-upload" onclick="event.stopPropagation(); document.getElementById('proglogo-${set.id}').click()" title="Ajouter un logo">
                    <i class="ti ti-tag" aria-hidden="true"></i>
                    <input type="file" id="proglogo-${set.id}" accept="image/*" style="display:none" onchange="event.stopPropagation(); handleProgressionSeriesLogoUpload(event, '${set.id}')">
                </div>`;

            // Etats visuels sobres : terminée / presque terminée / très peu commencée
            const isComplete = pct === 100;
            const isAlmost = pct >= 90 && pct < 100;
            const isLow = pct > 0 && pct < 10;
            const rowStateClass = isComplete ? 'is-complete' : isAlmost ? 'is-almost' : isLow ? 'is-low' : '';
            // Badge % distinct de l'état de la carte (rowStateClass) : gris tant qu'aucune carte n'est
            // possédée, vert une fois complète, or sinon - cf maquette grille validée (2026-08-16).
            const badgeClass = isComplete ? 'is-complete' : owned === 0 ? 'is-zero' : '';

            const subtitleHtml = isComplete
                ? `<span class="progression-set-complete"><i class="ti ti-check" aria-hidden="true"></i> Terminée</span>`
                : `${owned}/${officialCount} cartes`;

            return `
                <div class="progression-set-row ${rowStateClass}" onclick="runSetProgressionMorphTransition(event, '${set.id}', '${safeName}', '${logoUrl}')">
                    <span class="progression-set-pct-badge ${badgeClass}">${pct}%</span>
                    <div class="progression-set-logo-wrap">${logoHtml}${progressRingSvg(pct)}</div>
                    <div class="progression-set-info">
                        <div class="progression-set-name">${set.name}</div>
                        <div class="progression-set-count">
                            ${subtitleHtml}
                            ${secretCount > 0 ? `<span class="progression-secret-badge">+${secretCount} secrètes</span>` : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        // Résumé de progression du chapitre, agrégé à partir des extensions déjà entamées (données déjà chargées)
        const genOwned = sets.reduce((sum, set) => sum + (ownedIdsBySet[set.id]?.size || 0), 0);
        const genOfficial = sets.reduce((sum, set) => sum + (set.cardCount?.official || 0), 0);
        const genTotal = sets.reduce((sum, set) => sum + (set.cardCount?.total || set.cardCount?.official || 0), 0);
        const genPct = genTotal > 0 ? Math.round((genOwned / genTotal) * 100) : 0;

        // En-tête "eyebrow" (libellé + trait), inspiré de /guides sur duffus.fr - remplace l'ancien
        // bloc repliable (logo/nom/barre/%/chevron cliquable) : toutes les séries possédées restent
        // dépliées en permanence, cf maquette validée le 2026-08-16
        // (docs/inspiration-duffus-animations.md#4). seriesWithOwnedSets ne garde déjà que les séries
        // entamées, donc pas de risque de page à rallonge avec des dizaines de blocs vides.
        return `
            <div class="progression-series-block">
                <div class="progression-series-eyebrow">
                    <span class="progression-series-eyebrow-label">${series.name}</span>
                    <span class="progression-series-eyebrow-line"></span>
                    <span class="progression-series-eyebrow-pct">${genPct}% · ${genOwned}/${genOfficial}</span>
                </div>
                <div class="progression-sets-list">${setsHtml}</div>
            </div>
        `;
    }).join('') + discoverMoreHtml;
}

async function handleProgressionSeriesLogoUpload(event, setId) {
    const file = event.target.files[0];
    if (!file) return;

    try {
        showMessage('Envoi du logo...', 'success');
        await uploadSeriesLogoManually(file, setId);
        showMessage('Logo ajouté !', 'success');
        await refreshCollection();
        progressionLogosLoaded = false; // force le rafraîchissement du cache des logos stockés
        loadSeriesProgress();
    } catch (error) {
        showMessage('Erreur lors de l\'envoi du logo', 'error');
        console.error(error);
    }
}

// Récupère la liste complète et détaillée (rareté, prix, image) des cartes d'un set TCGdex, par lots
// de 5. Extrait d'openSetProgression pour être réutilisable par le Dashboard (P2-5, budget de
// l'objectif) sans dupliquer la logique de fetch/fallback FR→EN.
async function fetchSetCardsDetailed(setId, onProgress) {
    let response = await fetch(`${API_BASE}/cards?set=${setId}`);
    let data = await response.json();
    if (!Array.isArray(data) || data.length === 0) {
        const enResponse = await fetch(`${API_EN}/cards?set=${setId}`);
        data = await enResponse.json();
    }

    const basicList = (Array.isArray(data) ? data : []).filter(c => getSetIdFromTcgdexId(c.id) === setId);

    const detailed = [];
    const batchSize = 5;
    for (let i = 0; i < basicList.length; i += batchSize) {
        const batch = basicList.slice(i, i + batchSize);
        if (onProgress) onProgress(Math.min(i + batchSize, basicList.length), basicList.length);

        const results = await Promise.all(batch.map(async (card) => {
            try {
                const detailRes = await fetch(`${API_BASE}/cards/${card.id}`);
                const detail = await detailRes.json();
                if (detail && !detail.status) return detail;
                throw new Error('fr not found');
            } catch {
                try {
                    const enDetailRes = await fetch(`${API_EN}/cards/${card.id}`);
                    return await enDetailRes.json();
                } catch {
                    return card; // filet de sécurité minimal
                }
            }
        }));
        detailed.push(...results);
    }

    return detailed.sort((a, b) => (parseInt(a.localId) || 0) - (parseInt(b.localId) || 0));
}

// Repere sticky (nom du set + progression, cf progression-set-sticky-bar dans index.html) : revele
// une fois que .progression-set-title-row (le vrai titre, en haut) sort de l'ecran - utile sur un
// set dense (200+ cartes, cf Heros Transcendants) ou on perd de vue le nom/pourcentage en scrollant.
// IntersectionObserver plutot qu'un scroll listener : aucun recalcul a chaque frame de scroll, le
// navigateur ne notifie que sur le changement d'etat (visible <-> invisible).
let progressionStickyObserver = null;

function setupProgressionStickyBar() {
    if (progressionStickyObserver) progressionStickyObserver.disconnect();

    const titleRow = document.querySelector('#progression-set-view .progression-set-title-row');
    const stickyBar = document.getElementById('progression-set-sticky-bar');
    if (!titleRow || !stickyBar) return;

    progressionStickyObserver = new IntersectionObserver(([entry]) => {
        stickyBar.classList.toggle('visible', !entry.isIntersecting);
    });
    progressionStickyObserver.observe(titleRow);
}

// Deconnecte l'observer en quittant la vue detail d'un set (backToSeriesProgress) : sans ca, un
// observer reste actif par-dessus un titre qui n'est plus affiche (display:none), potentiellement
// un par aller-retour set -> liste -> set si jamais recree sans etre nettoye avant.
function teardownProgressionStickyBar() {
    if (progressionStickyObserver) {
        progressionStickyObserver.disconnect();
        progressionStickyObserver = null;
    }
    document.getElementById('progression-set-sticky-bar')?.classList.remove('visible');
}

// Morph Atlas -> détail de set (audit webdesign 2026-09, "[L] Transition de morph entre la vignette
// du set cliqué dans l'Atlas et le logo affiché en tête de #progression-set-title-row") - même
// principe que runCardDetailMorphTransition (card-grid-renderer.js) et le VT4 Collecteur -> profil
// public (view-transitions.js) : un seul élément partagé (le logo) morphe, le reste de la page ne
// fait l'objet d'aucun cross-fade (cf règles CSS :active-view-transition-type(set-progression)).
// Désactivé sur mobile, même convention établie pour tous les morphs de l'app (coût GPU/flou en
// mouvement) - et si aucune image source n'est trouvée (logo pas encore chargé, cf
// .progression-set-logo-upload en repli dans renderProgressionSeriesList/renderProgressionPriorityGoals).
// openSetProgression() elle-même n'est jamais modifiée : sa partie synchrone (titre/logo/skeleton)
// suffit à capturer l'état "après" du morph, la suite (fetch des cartes) continue normalement une
// fois la transition lancée - jamais attendue ici, elle retarderait le morph pour rien.
function runSetProgressionMorphTransition(event, setId, setName, logoUrl) {
    const sourceImg = event?.currentTarget?.querySelector('img.progression-set-logo, img.progression-goal-logo');
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    if (typeof document.startViewTransition !== 'function' || !sourceImg || isMobile) {
        openSetProgression(setId, setName, logoUrl);
        return;
    }

    sourceImg.style.viewTransitionName = 'set-progression-morph';

    const cleanup = () => {
        sourceImg.style.viewTransitionName = '';
        const destImg = document.getElementById('progression-set-logo');
        if (destImg) destImg.style.viewTransitionName = '';
    };

    const transition = runViewTransition('set-progression', () => {
        // Même raison que card-detail-morph (card-grid-renderer.js) : la carte source ET le logo de
        // destination ne doivent jamais porter le même view-transition-name en même temps dans l'état
        // "new" capturé par le navigateur, sous peine de transition skippée sans animation.
        sourceImg.style.viewTransitionName = '';
        openSetProgression(setId, setName, logoUrl);
        const destImg = document.getElementById('progression-set-logo');
        if (destImg) destImg.style.viewTransitionName = 'set-progression-morph';
    });

    if (!transition) {
        // reduced-motion / API indisponible : runViewTransition a déjà exécuté la fonction directement
        // en synchrone, aucune transition réelle n'a eu lieu.
        cleanup();
        return;
    }

    transition.finished.finally(cleanup);
}

async function openSetProgression(setId, setName, logoUrl) {
    currentProgressionSetId = setId;
    progressionFilter = 'all';
    progressionFinishMode = 'normal';
    progressionRarityFilterValues.clear();
    document.getElementById('progression-search').value = '';
    document.querySelectorAll('#tab-progression .view-toggle-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('prog-filter-all').classList.add('active');

    renderProgressionObjectiveControl();

    document.getElementById('progression-series-view').style.display = 'none';
    document.getElementById('progression-set-view').style.display = 'block';
    document.getElementById('progression-set-title').textContent = setName;
    document.getElementById('progression-sticky-title').textContent = setName;

    const logoImg = document.getElementById('progression-set-logo');
    const stickyLogo = document.getElementById('progression-sticky-logo');
    if (logoUrl) {
        logoImg.src = logoUrl;
        logoImg.style.display = 'inline-block';
        logoImg.onerror = () => { logoImg.style.display = 'none'; };
        stickyLogo.src = logoUrl;
        stickyLogo.style.display = 'inline-block';
        stickyLogo.onerror = () => { stickyLogo.style.display = 'none'; };
    } else {
        logoImg.style.display = 'none';
        stickyLogo.style.display = 'none';
    }

    setupProgressionStickyBar();

    const grid = document.getElementById('progression-cards-grid');
    const progressText = document.getElementById('progression-set-progress-text');
    grid.innerHTML = Array.from({ length: 12 }).map(() => `
        <div class="skeleton" style="aspect-ratio: 5/7; border-radius: 8px;"></div>
    `).join('');
    if (progressText) progressText.textContent = 'Chargement des cartes...';

    try {
        currentProgressionCards = await fetchSetCardsDetailed(setId, (done, total) => {
            if (progressText) progressText.textContent = `Chargement des cartes... ${done}/${total}`;
        });

        // Mis en cache une seule fois ici : évite de re-vérifier (et de vider la grille) à chaque
        // rafraîchissement (ex: après un ajout rapide), ce qui causait un saut de scroll en haut de page
        currentProgressionStoredFilenames = await getStoredImageFilenames();

        renderProgressionFinishToggle();
        populateProgressionRarityFilter();
        renderProgressionCardsGrid();
    } catch (error) {
        grid.innerHTML = '<p style="text-align: center; padding: 2rem; color: var(--slate);">Erreur lors du chargement des cartes</p>';
        console.error(error);
    }
}

// ===== OBJECTIF ÉPINGLÉ (audit webdesign 2026-09, "Objectifs de complétion personnalisés") =====
// Contrôle affiché dans l'en-tête de la vue détail d'un set (cf .progression-set-title-row,
// index.html) : bouton "Définir comme objectif" si ce set n'est pas l'objectif épinglé du Dashboard,
// sinon badge + champ d'échéance optionnel + bouton pour retirer. Le stockage (localStorage) et le
// calcul de progression vivent dans modules/dashboard.js (getDashboardPinnedObjective/
// saveDashboardPinnedObjective/dashboardComputeSetProgress), réutilisés ici tels quels.
function renderProgressionObjectiveControl() {
    const el = document.getElementById('progression-objective-control');
    if (!el) return;

    const pinned = getDashboardPinnedObjective();
    const isPinnedHere = pinned && pinned.setId === currentProgressionSetId;

    if (!isPinnedHere) {
        el.innerHTML = `
            <button type="button" class="progression-objective-pin-btn" onclick="pinDashboardObjective()">
                <i class="ti ti-pin" aria-hidden="true"></i> Définir comme objectif du Dashboard
            </button>
        `;
        return;
    }

    el.innerHTML = `
        <div class="progression-objective-pinned">
            <span class="progression-objective-pinned-label"><i class="ti ti-pin-filled" aria-hidden="true"></i> Objectif du Dashboard</span>
            <input type="text" id="progression-objective-deadline" placeholder="Échéance (optionnel)" value="${pinned.deadline ? escapeHtml(pinned.deadline) : ''}">
            <button type="button" class="progression-objective-remove-btn" onclick="unpinDashboardObjective()" title="Retirer cet objectif"><i class="ti ti-x" aria-hidden="true"></i></button>
        </div>
    `;
    initObjectiveDeadlinePicker('#progression-objective-deadline', pinned.deadline);
}

function pinDashboardObjective() {
    saveDashboardPinnedObjective(currentProgressionSetId, null);
    renderProgressionObjectiveControl();
    dashboardRerenderWidgetBody('objective');
}

// Appelé par flatpickr (onChange) quand l'échéance change - conserve le setId déjà épinglé, remplace
// juste la date. dateStr vide (croix flatpickr) -> deadline redevenue optionnelle (null), pas une
// chaîne vide stockée.
function onProgressionObjectiveDeadlineChange(dateStr) {
    const pinned = getDashboardPinnedObjective();
    if (!pinned || pinned.setId !== currentProgressionSetId) return;
    saveDashboardPinnedObjective(currentProgressionSetId, dateStr || null);
    dashboardRerenderWidgetBody('objective');
}

let progressionRarityFilterValues = new Set();

function setProgressionRarityFilter(value) {
    if (value === '') {
        progressionRarityFilterValues.clear();
    } else if (progressionRarityFilterValues.has(value)) {
        progressionRarityFilterValues.delete(value);
    } else {
        progressionRarityFilterValues.add(value);
    }
    populateProgressionRarityFilter();
    renderProgressionCardsGrid();
}

function populateProgressionRarityFilter() {
    const rarities = sortRaritiesByTier([...new Set(currentProgressionCards.map(c => c.rarity).filter(Boolean))]);
    document.getElementById('progression-rarity-filter-row').innerHTML =
        buildRarityFilterRowHtml(rarities, progressionRarityFilterValues, 'setProgressionRarityFilter');
}

// Budget de complétion (Phase 2, ticket P2-1/P2-2, cf audit du 2026-08-14) : prix TCGdex live déjà
// présent sur les cartes manquantes (currentProgressionCards, pas de requête supplémentaire), jamais
// card_price_history (quasi jamais peuplée pour une carte jamais possédée). Réutilise
// getMarketValueForFinish (modules/utils.js) — même résolution de prix par finition que le reste de
// l'app, pas une deuxième logique de prix. Un prix de 0 est traité comme "inconnu", jamais sommé
// comme gratuit (cf audit, cas limites). mostExpensive calculé dans la même passe pour P2-2, pas
// affiché ici.
function computeSetCompletionBudget(missingCards, finishMode) {
    let totalKnown = 0;
    let countKnown = 0;
    let countUnknown = 0;
    let mostExpensive = null;

    missingCards.forEach(card => {
        const price = getMarketValueForFinish(card, finishMode);
        if (price > 0) {
            totalKnown += price;
            countKnown++;
            if (!mostExpensive || price > mostExpensive.price) {
                mostExpensive = { card, price };
            }
        } else {
            countUnknown++;
        }
    });

    return { totalKnown, countKnown, countUnknown, mostExpensive };
}

function renderProgressionSetBudgetText(missingCount, budget) {
    const el = document.getElementById('progression-set-budget-text');
    if (!el) return;

    if (missingCount === 0) {
        el.textContent = '';
        return;
    }

    const { totalKnown, countKnown, countUnknown } = budget;

    if (countKnown === 0) {
        el.textContent = 'Prix inconnu pour toutes les cartes manquantes';
        return;
    }

    const amount = `<span class="budget-amount">≈ ${formatPrice(totalKnown)}</span>`;
    el.innerHTML = countUnknown === 0
        ? `${amount} pour compléter ce set (${countKnown} carte${countKnown > 1 ? 's' : ''})`
        : `${amount} pour les ${countKnown} carte${countKnown > 1 ? 's' : ''} manquante${countKnown > 1 ? 's' : ''} dont le prix est connu — ${countUnknown} sans estimation`;
}

async function renderProgressionCardsGrid() {
    const grid = document.getElementById('progression-cards-grid');
    const searchTerm = document.getElementById('progression-search').value.toLowerCase();

    // Index cartes possedees par tcgdex_id (audit 2026-08-15, categorie B) : construit une seule fois
    // par rendu (O(collection)) plutot que de laisser isOwnedInMode/ownedCardRow/ownedQuantity
    // rescanner allCollectionCards en entier a chaque carte du set (O(set*collection) - lag ressenti
    // sur un gros set avec une grosse collection). Cle = tcgdex_id, valeur = toutes les lignes
    // possedees pour cet id (generalement 1, plusieurs si differentes finitions/etats).
    const ownedRowsByTcgdexId = new Map();
    allCollectionCards.forEach(c => {
        if (!c.tcgdex_id) return;
        if (!ownedRowsByTcgdexId.has(c.tcgdex_id)) ownedRowsByTcgdexId.set(c.tcgdex_id, []);
        ownedRowsByTcgdexId.get(c.tcgdex_id).push(c);
    });

    // Une carte est "possédée" dans un mode donné si on en a une ligne avec cette finition précise
    // (les cartes sans finish renseigné - ajoutées avant cette fonctionnalité - comptent comme "normal")
    const isOwnedInMode = (tcgdexId, mode) => {
        const rows = ownedRowsByTcgdexId.get(tcgdexId);
        return !!rows && rows.some(c => (c.finish || 'normal') === mode);
    };

    let baseCards = currentProgressionCards;
    if (progressionFinishMode !== 'normal') {
        // Hors mode Normal, on ne montre que les cartes qui ont réellement cette finition précise
        baseCards = baseCards.filter(c => cardHasFinishVariant(c, progressionFinishMode));
    }

    const ownedCount = baseCards.filter(c => isOwnedInMode(c.id, progressionFinishMode)).length;
    const totalCount = baseCards.length;
    const pct = totalCount > 0 ? Math.round((ownedCount / totalCount) * 100) : 0;
    const progressLabel = `${ownedCount} / ${totalCount} cartes possédées · ${pct}%`;
    document.getElementById('progression-set-progress-text').textContent = progressLabel;
    // Miroir compact pour la barre sticky (progression-set-sticky-bar, index.html) - meme source,
    // mis a jour au meme endroit pour ne jamais desynchroniser les deux affichages.
    const stickyProgress = document.getElementById('progression-sticky-progress');
    if (stickyProgress) stickyProgress.textContent = `${pct}%`;

    // Un seul calcul pour le budget (P2-1) et la carte manquante la plus chère (P2-2) — même passe,
    // pas de logique dupliquée. Portée à toutes les cartes manquantes du set, indépendamment du
    // filtre affiché (recherche/possédées/manquantes/rareté) : le budget représente le set entier.
    const missingSetCards = baseCards.filter(c => !isOwnedInMode(c.id, progressionFinishMode));
    const setBudget = computeSetCompletionBudget(missingSetCards, progressionFinishMode);
    renderProgressionSetBudgetText(missingSetCards.length, setBudget);
    const mostExpensiveMissingId = setBudget.mostExpensive?.card?.id || null;

    let cards = baseCards;
    if (searchTerm) {
        cards = cards.filter(c =>
            (c.name || '').toLowerCase().includes(searchTerm) ||
            String(c.localId || '').toLowerCase().includes(searchTerm)
        );
    }
    if (progressionFilter === 'owned') {
        cards = cards.filter(c => isOwnedInMode(c.id, progressionFinishMode));
    } else if (progressionFilter === 'missing') {
        cards = cards.filter(c => !isOwnedInMode(c.id, progressionFinishMode));
    }

    if (progressionRarityFilterValues.size > 0) {
        cards = cards.filter(c => progressionRarityFilterValues.has(getRarityGroupKey(c.rarity)));
    }

    cards = [...cards].sort((a, b) => (parseInt(a.localId) || 0) - (parseInt(b.localId) || 0));

    if (cards.length === 0) {
        grid.innerHTML = `<p style="text-align: center; padding: 2rem; color: var(--slate);">${progressionFinishMode === 'reverse' ? 'Aucune carte reverse ne correspond' : 'Aucune carte ne correspond'}</p>`;
        return;
    }

    const storedFilenames = currentProgressionStoredFilenames;

    grid.innerHTML = cards.map(card => {
        const owned = isOwnedInMode(card.id, progressionFinishMode);
        const ownedRowsForCard = owned
            ? (ownedRowsByTcgdexId.get(card.id) || []).filter(c => (c.finish || 'normal') === progressionFinishMode)
            : [];
        const ownedCardRow = ownedRowsForCard[0] || null;
        const ownedQuantity = ownedRowsForCard.reduce((sum, c) => sum + Number(c.quantity || 1), 0);

        let imageUrl = '';
        if (ownedCardRow && ownedCardRow.image) {
            imageUrl = ownedCardRow.image; // Notre image (auto ou uploadée manuellement), déjà une URL complète
        } else if (storedFilenames.has(`${sanitizeForPath(card.id)}.jpg`)) {
            // On a déjà hébergé une image pour cette carte (même si elle n'est plus/pas encore en collection)
            const { data } = supabaseClient.storage.from('card-images').getPublicUrl(getTcgdexImagePath(card.id));
            imageUrl = data.publicUrl;
        } else if (card.image) {
            imageUrl = `${card.image}/low.webp`; // Lien brut TCGdex en secours
        }

        // P2-2 : mise en évidence de la carte manquante la plus chère du set (dérivée du même calcul
        // que le budget P2-1, aucune donnée/requête supplémentaire) — jamais "la plus difficile",
        // seulement "la plus chère", cf audit du 2026-08-14 sur les concepts à ne pas fusionner.
        const isMostExpensiveMissing = !owned && mostExpensiveMissingId && card.id === mostExpensiveMissingId;

        return `
            <div class="progression-card-item ${owned ? 'owned' : 'missing'} ${progressionFinishMode !== 'normal' ? 'reverse-mode' : ''} ${isMostExpensiveMissing ? 'most-expensive-missing' : ''}" ${owned && ownedCardRow ? `data-card-id="${ownedCardRow.id}" onclick="showCardDetail(${ownedCardRow.id}, event)"` : `onclick="addFromProgression('${card.id}', null)"`}>
                ${imageUrl
                    ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(card.name)}" loading="lazy" onerror="handleTcgdexImgError(this, '<div class=&quot;progression-card-noimg&quot;><i class=&quot;ti ti-photo-off&quot; aria-hidden=&quot;true&quot;></i></div>')">`
                    : '<div class="progression-card-noimg"><i class="ti ti-photo-off" aria-hidden="true"></i></div>'
                }
                ${ownedQuantity > 1 ? `<div class="qty-badge">×${ownedQuantity}</div>` : ''}
                ${isMostExpensiveMissing ? `<div class="most-expensive-badge" title="Carte manquante la plus chère de ce set">≈ ${formatPrice(setBudget.mostExpensive.price)}</div>` : ''}
                <button class="progression-add-badge" onclick="event.stopPropagation(); quickInstantAdd('${card.id}', this)">+</button>
                <div class="progression-card-label">#${escapeHtml(card.localId)} ${escapeHtml(card.name)}</div>
            </div>
        `;
    }).join('');
}

// Scanne toutes les cartes d'un set pour repérer les finitions spéciales réellement disponibles
// (Reverse classique, et chaque foil distinct : Pokéball, Énergie...)
function computeAvailableFinishModes(cards) {
    const modes = new Map();
    modes.set('normal', 'Normale');

    cards.forEach(card => {
        const variants = card.variants_detailed;
        if (!Array.isArray(variants)) return;
        variants.forEach(v => {
            if (v.foil) {
                if (!modes.has(v.foil)) modes.set(v.foil, v.foil);
            } else if (v.type === 'Reverse') {
                if (!modes.has('reverse')) modes.set('reverse', 'Reverse');
            }
        });
    });

    return modes;
}

function renderProgressionFinishToggle() {
    const container = document.getElementById('progression-finish-toggle-row');
    if (!container) return;

    const modes = computeAvailableFinishModes(currentProgressionCards);
    container.innerHTML = [...modes.entries()].map(([value, label]) => {
        const isActive = progressionFinishMode === value;

        if (value === 'normal') {
            return `<button class="view-toggle-btn ${isActive ? 'active' : ''}" onclick="setProgressionFinishMode('normal')">${label}</button>`;
        }

        const foilIcon = getFoilIconHtml(value, 24);
        if (foilIcon) {
            // Icône seule + info-bulle au survol, comme pour les icônes de rareté
            return `<button class="view-toggle-btn ${isActive ? 'active' : ''}" data-tooltip="${label}" onclick="setProgressionFinishMode('${value.replace(/'/g, "\\'")}')">${foilIcon}</button>`;
        }

        // Pas d'icône dédiée (ex: Reverse classique) : on garde le texte
        return `<button class="view-toggle-btn ${isActive ? 'active' : ''}" onclick="setProgressionFinishMode('${value.replace(/'/g, "\\'")}')"><i class="ti ti-sparkles" aria-hidden="true"></i> ${label}</button>`;
    }).join('');
}

// Une carte propose-t-elle réellement cette finition précise ?
function cardHasFinishVariant(card, mode) {
    if (mode === 'normal') return true;
    const variants = card.variants_detailed;
    if (!Array.isArray(variants)) return false;
    return variants.some(v => {
        if (v.foil) return v.foil === mode;
        if (v.type === 'Reverse' && mode === 'reverse') return true;
        return false;
    });
}

function setProgressionFinishMode(mode) {
    progressionFinishMode = mode;
    renderProgressionFinishToggle();
    renderProgressionCardsGrid();
}

function setProgressionFilter(filter) {
    progressionFilter = filter;
    document.querySelectorAll('#tab-progression .view-toggle-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`prog-filter-${filter}`).classList.add('active');
    renderProgressionCardsGrid();
}

function backToSeriesProgress() {
    document.getElementById('progression-series-view').style.display = 'block';
    document.getElementById('progression-set-view').style.display = 'none';
    currentProgressionSetId = null;
    teardownProgressionStickyBar();
    // Rafraîchir les compteurs de la liste (au cas où des cartes ont été ajoutées entre-temps)
    loadSeriesProgress();
}

async function addFromProgression(cardId, btnEl) {
    // Les détails complets sont déjà chargés dans currentProgressionCards
    const cached = currentProgressionCards.find(c => c.id === cardId);
    if (cached) {
        showAddCardModal(cached);
        return;
    }

    // Filet de sécurité si jamais la carte n'était pas dans le cache
    if (btnEl) {
        btnEl.disabled = true;
        btnEl.innerHTML = '<span class="loading" style="width:12px;height:12px;"></span>';
    }

    try {
        let response = await fetch(`${API_BASE}/cards/${cardId}`);
        let detail = await response.json();
        if (!detail || detail.status) {
            const enResponse = await fetch(`${API_EN}/cards/${cardId}`);
            detail = await enResponse.json();
        }
        showAddCardModal(detail);
    } catch (error) {
        showMessage('Erreur lors du chargement des détails de la carte', 'error');
        console.error(error);
    } finally {
        if (btnEl) {
            btnEl.disabled = false;
            btnEl.innerHTML = '+';
        }
    }
}

// Ajout instantané (bouton "+"), sans ouvrir de fenêtre, avec les réglages par défaut
async function quickInstantAdd(cardId, btnEl) {
    // Capturés AVANT tout await (donc avant que quoi que ce soit ait pu détacher btnEl du DOM) : la
    // grille affiche potentiellement des dizaines de boutons "+" à la fois, et chacun mène son propre
    // ajout de façon indépendante - si un second clic sur une autre carte termine sa propre requête
    // pendant que celle-ci attend encore le réseau, son renderProgressionCardsGrid() remplace toute la
    // grille en innerHTML et détache CE btnEl avant que cette fonction ait pu lire sa position (retour
    // utilisateur : "l'animation fonctionne une fois sur cinq depuis Progression" - le fantôme partait
    // alors du coin (0,0), invisible). captureCardAddOrigin/Source() (utils.js) figent la position et
    // l'apparence dès maintenant, indépendamment de tout ce qui arrive au DOM ensuite.
    const addOrigin = btnEl ? captureCardAddOrigin(btnEl) : null;
    const addSource = btnEl ? captureCardAddSource(btnEl.closest('.progression-card-item')?.querySelector('img')) : null;

    if (btnEl) {
        btnEl.disabled = true;
        btnEl.innerHTML = '<span class="loading" style="width:12px;height:12px;"></span>';
    }

    try {
        let cardData = currentProgressionCards.find(c => c.id === cardId);

        if (!cardData) {
            let response = await fetch(`${API_BASE}/cards/${cardId}`);
            let detail = await response.json();
            if (!detail || detail.status) {
                const enResponse = await fetch(`${API_EN}/cards/${cardId}`);
                detail = await enResponse.json();
            }
            cardData = detail;
        }

        const defaults = getQuickAddDefaults();

        // Capturé avant performCardAdd()/refreshCollection() (comme modules/cards.js#addCard) : la
        // comparaison ownedBefore/ownedAfter plus bas détecte une vraie transition vers 100%, jamais
        // un ajout à un set déjà complet. quickInstantAdd() est le chemin d'ajout "+" instantané de
        // cette page (retour utilisateur : la célébration de set complété ne se déclenchait ici ni
        // depuis quickInstantAdd ni depuis submitQuickAdd, contrairement à l'onglet Ajouter).
        const setId = getSetIdFromTcgdexId(cardId);
        const ownedBefore = getSetOwnedCount(setId);

        await performCardAdd(cardData, {
            condition: defaults.condition,
            quantity: defaults.quantity,
            acquisitionType: defaults.acquisitionType,
            purchasePrice: defaults.purchasePrice,
            customImage: null,
            customDate: defaults.date || null,
            finish: progressionFinishMode
        });

        // addOrigin/addSource sont déjà des snapshots figés (capturés avant le moindre await, cf plus
        // haut) : indépendants de ce que renderProgressionCardsGrid() fait au DOM juste en dessous.
        celebrateCardAdded({
            originEl: addOrigin,
            sourceImgEl: addSource,
            quantity: defaults.quantity
        });

        await refreshCollection();
        await recordValueSnapshot();
        renderProgressionCardsGrid();

        const total = getSetTotalCount(setId);
        if (total > 0 && ownedBefore < total && getSetOwnedCount(setId) >= total) celebrateSetComplete(setId);
    } catch (error) {
        showMessage('Erreur lors de l\'ajout rapide', 'error');
        console.error(error);
        if (btnEl) {
            btnEl.disabled = false;
            btnEl.innerHTML = '+';
        }
    }
}

function getQuickAddUploadPlaceholderHtml(tcgdexId) {
    return `<div class="no-image-placeholder modal-size upload-placeholder" onclick="document.getElementById('quickadd-upload-input').click()">
        <i class="ti ti-photo-off" aria-hidden="true"></i>
    </div>
    <input type="file" id="quickadd-upload-input" accept="image/*" style="display:none" onchange="handleQuickAddImageUpload(event, '${tcgdexId || ''}')">`;
}

async function handleQuickAddImageUpload(event, tcgdexId) {
    const file = event.target.files[0];
    if (!file) return;

    const slot = document.getElementById('quickadd-image-slot');
    slot.innerHTML = '<div class="no-image-placeholder modal-size"><span class="loading"></span></div>';

    try {
        const publicUrl = await uploadImageToStorage(file, tcgdexId || null);
        customQuickAddImage = publicUrl;

        slot.innerHTML = `
            <img src="${publicUrl}" alt="Carte" class="modal-image" style="cursor: pointer;" onclick="document.getElementById('quickadd-upload-input-2').click()">
            <input type="file" id="quickadd-upload-input-2" accept="image/*" style="display:none" onchange="handleQuickAddImageUpload(event, '${tcgdexId}')">
        `;
        showMessage('Image envoyée !', 'success');
    } catch (error) {
        showMessage('Erreur lors de l\'envoi de l\'image', 'error');
        console.error(error);
        slot.innerHTML = getQuickAddUploadPlaceholderHtml(tcgdexId);
    }
}

// Ouvre le picker de listes (modules/wishlist.js) avec cette carte TCGdex brute (jamais possedee,
// showAddCardModal n'est appelee que pour ce cas - cf le onclick conditionnel dans
// renderProgressionCardsGrid). Normalise vers la forme deja attendue par openWishlistPicker/
// addPublicCardToWishlistInternal - meme principe que openWishlistPickerForPublicCard
// (modules/public-profile.js), juste une forme source differente (TCGdex brut : card.set.name/
// card.localId/card.pricing... au lieu du gabarit deja plat cote profil public).
function openWishlistPickerForProgressionCard(card) {
    openWishlistPicker({
        tcgdex_id: card.id || null,
        name: card.name,
        series: card.set?.name || 'N/A',
        number: card.localId || '?',
        rarity: card.rarity || 'N/A',
        image: card.image ? `${card.image}/high.webp` : '',
        series_logo: card.set?.logo ? `${card.set.logo}.webp` : null,
        cardmarket_id: card.pricing?.cardmarket?.idProduct || null
    });
}

function showAddCardModal(card) {
    customQuickAddImage = null;
    const qaDefaults = getQuickAddDefaults();

    let marketPrice = 0;
    if (card.pricing?.cardmarket?.avg) {
        marketPrice = card.pricing.cardmarket.avg;
    } else if (card.pricing?.cardmarket?.['avg-holo']) {
        marketPrice = card.pricing.cardmarket['avg-holo'];
    }

    const cardmarketUrl = getCardmarketUrl(card.pricing?.cardmarket?.idProduct, card.name);
    const alreadyInWishlist = !!(card.id && typeof allWishlistItems !== 'undefined' && allWishlistItems.some(i => i.tcgdex_id === card.id));

    const imageUrl = card.image ? `${card.image}/high.webp` : '';

    const modalCard = document.getElementById('card-detail-card');
    modalCard.innerHTML = `
        <button class="modal-close" onclick="closeCardDetail()">✕</button>
        <div class="modal-scroll">
        <div class="modal-body">
            <div class="modal-image-wrap">
                <div class="modal-stand">
                    <div id="quickadd-image-slot" class="modal-image-frame">
                        ${imageUrl
                            ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(card.name)}" class="modal-image" onerror="handleTcgdexImgError(this, () => this.outerHTML=getGridNoImageHtml())">`
                            : getQuickAddUploadPlaceholderHtml(card.id)
                        }
                    </div>
                </div>
            </div>
            <div class="modal-info">
                <div class="modal-title-row">
                    <div class="modal-title">${escapeHtml(card.name)}</div>
                </div>
                <div class="modal-subtitle">${escapeHtml(card.set?.name || 'N/A')} · #${escapeHtml(card.localId || '?')}</div>

                <div class="modal-badges">
                    <span class="modal-pill rarity-pill">${getRarityIconHtml(card.rarity, 14)} ${escapeHtml(card.rarity || 'N/A')}</span>
                    ${marketPrice > 0 ? `<span class="modal-pill acquisition-pill"><i class="ti ti-currency-euro" aria-hidden="true"></i> ${formatPrice(marketPrice)} (marché)</span>` : ''}
                </div>

                <div class="edit-form-grid">
                    <div class="form-group">
                        <label for="quickadd-condition">État</label>
                        <select id="quickadd-condition">
                            <option value="NM">Neuf (NM)</option>
                            <option value="LP">Très bon (LP)</option>
                            <option value="MP">Bon (MP)</option>
                            <option value="HP">Mauvais état (HP)</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="quickadd-finish">Finition</label>
                        <select id="quickadd-finish">
                            ${buildFinishOptionsHtml(card, progressionFinishMode)}
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="quickadd-quantity">Quantité</label>
                        <input type="number" id="quickadd-quantity" value="${qaDefaults.quantity}" min="1" max="100">
                    </div>
                    <div class="form-group">
                        <label for="quickadd-acquisition">Obtention</label>
                        <select id="quickadd-acquisition" onchange="toggleQuickAddPurchasePriceField()">
                            <option value="achat">Achetée</option>
                            <option value="pack">Sortie d'un booster</option>
                        </select>
                    </div>
                    <div class="form-group" id="quickadd-purchase-price-group">
                        <label for="quickadd-purchase-price">Prix payé (€)</label>
                        <input type="number" id="quickadd-purchase-price" value="${qaDefaults.acquisitionType === 'pack' ? '' : qaDefaults.purchasePrice}" step="0.01" min="0" placeholder="optionnel">
                    </div>
                    <div class="form-group">
                        <label for="quickadd-date-added">Date d'acquisition</label>
                        <input type="text" id="quickadd-date-added" placeholder="jj/mm/aaaa">
                    </div>
                </div>

                <button class="modal-save-btn full-width" id="quickadd-submit-btn" onclick="submitQuickAdd(${JSON.stringify(card).replace(/"/g, '&quot;')})"><i class="ti ti-plus" aria-hidden="true"></i> Ajouter à ma collection</button>

                <div class="modal-actions-col" style="margin-top: 0.75rem;">
                    <button type="button" class="modal-action-row" ${alreadyInWishlist ? 'disabled' : `onclick="openWishlistPickerForProgressionCard(${JSON.stringify(card).replace(/"/g, '&quot;')})"`}>
                        <span class="modal-action-icon" style="color: #E8A93B;"><i class="ti ${alreadyInWishlist ? 'ti-check' : 'ti-star'}" aria-hidden="true"></i></span>
                        <span class="modal-action-text">
                            <span class="modal-action-title" style="color: #E8A93B;">${alreadyInWishlist ? 'Déjà dans ma wishlist' : 'Ajouter à ma wishlist'}</span>
                            ${!alreadyInWishlist ? '<span class="modal-action-subtitle">L\'ajouter à une de tes listes</span>' : ''}
                        </span>
                        ${!alreadyInWishlist ? '<i class="ti ti-chevron-right modal-action-chevron" aria-hidden="true"></i>' : ''}
                    </button>
                    <a href="${cardmarketUrl}" target="_blank" rel="noopener noreferrer" class="modal-action-row">
                        <span class="modal-action-icon" style="color: #6bcbff;"><i class="ti ti-external-link" aria-hidden="true"></i></span>
                        <span class="modal-action-text">
                            <span class="modal-action-title" style="color: #6bcbff;">${card.pricing?.cardmarket?.idProduct ? 'Ouvrir sur Cardmarket' : 'Chercher sur Cardmarket'}</span>
                            <span class="modal-action-subtitle">Voir l'annonce correspondante</span>
                        </span>
                        <i class="ti ti-chevron-right modal-action-chevron" aria-hidden="true"></i>
                    </a>
                </div>
            </div>
        </div>
        </div>
    `;

    document.getElementById('quickadd-condition').value = qaDefaults.condition;
    document.getElementById('quickadd-acquisition').value = qaDefaults.acquisitionType;

    document.getElementById('card-detail-overlay').classList.add('active');
    toggleQuickAddPurchasePriceField();
    initDatePicker('#quickadd-date-added', qaDefaults.date || null);
}

function toggleQuickAddPurchasePriceField() {
    const val = document.getElementById('quickadd-acquisition').value;
    document.getElementById('quickadd-purchase-price-group').style.display = val === 'pack' ? 'none' : '';
}

async function submitQuickAdd(card) {
    const condition = document.getElementById('quickadd-condition').value;
    const finish = document.getElementById('quickadd-finish').value;
    const quantity = parseInt(document.getElementById('quickadd-quantity').value) || 1;
    const acquisitionType = document.getElementById('quickadd-acquisition').value;
    const purchasePrice = acquisitionType === 'pack'
        ? 0
        : (parseFloat(document.getElementById('quickadd-purchase-price').value) || 0);
    const customDate = document.getElementById('quickadd-date-added').value || null;

    const btn = document.getElementById('quickadd-submit-btn');
    const originalText = btn.textContent;
    btn.disabled = true;

    // Même détection de complétion que quickInstantAdd/modules/cards.js#addCard ci-dessus, pour ce
    // second chemin d'ajout de la page Progression (modale ouverte depuis addFromProgression).
    const setId = card.id ? getSetIdFromTcgdexId(card.id) : null;
    const ownedBefore = setId ? getSetOwnedCount(setId) : 0;

    let result;
    try {
        result = await performCardAdd(card, {
            condition,
            quantity,
            acquisitionType,
            purchasePrice,
            customImage: customQuickAddImage,
            customDate,
            finish
        });
    } catch (error) {
        btn.disabled = false;
        btn.innerHTML = originalText;
        showMessage('Erreur lors de l\'ajout à la collection', 'error');
        console.error(error);
        return;
    }

    // Avant closeCardDetail() (qui masque la modale, donc met à zéro les rects de btn/image) :
    // même principe que modules/cards.js#addCard, celebrateCardAdded() lit les positions de façon
    // synchrone puis crée des clones indépendants du DOM source (retour utilisateur 2026-09 : le
    // toast textuel "carte(s) ajoutée(s)" ci-dessous est retiré, l'animation seule suffit).
    celebrateCardAdded({
        originEl: btn,
        sourceImgEl: document.querySelector('#quickadd-image-slot img'),
        quantity
    });

    closeCardDetail();
    customQuickAddImage = null;

    await refreshCollection();
    await recordValueSnapshot();

    // Rafraîchir la grille de progression pour refléter le nouvel ajout
    if (currentProgressionSetId) {
        renderProgressionCardsGrid();
    }

    if (setId) {
        const total = getSetTotalCount(setId);
        if (total > 0 && ownedBefore < total && getSetOwnedCount(setId) >= total) celebrateSetComplete(setId);
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
window.QUICKADD_DEFAULTS_KEY = QUICKADD_DEFAULTS_KEY;
window.getQuickAddDefaults = getQuickAddDefaults;
window.saveQuickAddDefaultsToStorage = saveQuickAddDefaultsToStorage;
window.openQuickAddSettingsModal = openQuickAddSettingsModal;
window.toggleQaSettingsPriceField = toggleQaSettingsPriceField;
window.closeQuickAddSettingsModal = closeQuickAddSettingsModal;
window.saveQuickAddSettings = saveQuickAddSettings;
window.currentProgressionCards = currentProgressionCards;
window.progressionFilter = progressionFilter;
window.progressionFinishMode = progressionFinishMode;
window.currentProgressionStoredFilenames = currentProgressionStoredFilenames;
window.progressionStoredLogoFilenames = progressionStoredLogoFilenames;
window.progressionLogosLoaded = progressionLogosLoaded;
window.progressionLogoCachingTriggered = progressionLogoCachingTriggered;
window.resolveCachedLogoUrl = resolveCachedLogoUrl;
window.celebrateSetComplete = celebrateSetComplete;
window.loadSeriesProgress = loadSeriesProgress;
window.computeProgressionKpiData = computeProgressionKpiData;
window.renderProgressionKpis = renderProgressionKpis;
window.renderProgressionSeriesList = renderProgressionSeriesList;
window.handleProgressionSeriesLogoUpload = handleProgressionSeriesLogoUpload;
window.setupProgressionStickyBar = setupProgressionStickyBar;
window.teardownProgressionStickyBar = teardownProgressionStickyBar;
window.openSetProgression = openSetProgression;
window.runSetProgressionMorphTransition = runSetProgressionMorphTransition;
window.renderProgressionObjectiveControl = renderProgressionObjectiveControl;
window.pinDashboardObjective = pinDashboardObjective;
window.onProgressionObjectiveDeadlineChange = onProgressionObjectiveDeadlineChange;
window.fetchSetCardsDetailed = fetchSetCardsDetailed;
window.computeSetCompletionBudget = computeSetCompletionBudget;
window.progressionRarityFilterValues = progressionRarityFilterValues;
window.setProgressionRarityFilter = setProgressionRarityFilter;
window.populateProgressionRarityFilter = populateProgressionRarityFilter;
window.renderProgressionCardsGrid = renderProgressionCardsGrid;
window.computeAvailableFinishModes = computeAvailableFinishModes;
window.renderProgressionFinishToggle = renderProgressionFinishToggle;
window.cardHasFinishVariant = cardHasFinishVariant;
window.setProgressionFinishMode = setProgressionFinishMode;
window.setProgressionFilter = setProgressionFilter;
window.backToSeriesProgress = backToSeriesProgress;
window.addFromProgression = addFromProgression;
window.quickInstantAdd = quickInstantAdd;
window.getQuickAddUploadPlaceholderHtml = getQuickAddUploadPlaceholderHtml;
window.handleQuickAddImageUpload = handleQuickAddImageUpload;
window.showAddCardModal = showAddCardModal;
window.openWishlistPickerForProgressionCard = openWishlistPickerForProgressionCard;
window.toggleQuickAddPurchasePriceField = toggleQuickAddPurchasePriceField;
window.submitQuickAdd = submitQuickAdd;

// Export pour les tests unitaires (Vitest, cf vitest.config.js) uniquement - voir le commentaire
// équivalent en fin de modules/utils.js : purement additif, aucun effet sur le comportement navigateur.
export { computeSetCompletionBudget };
