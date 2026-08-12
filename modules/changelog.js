// Changelog - Pokémon Tracker
// Dépend de : APP_VERSION/CHANGELOG (data/changelog.js), escapeHtml (modules/utils.js), navigateToTab
// (tracker.js). Deux entrées : renderChangelogPage() pour la route #/changelog, maybeShowChangelogPopup()
// pour la popup "Nouveautés" appelée une fois depuis modules/auth.js après appReady = true.

const LAST_SEEN_CHANGELOG_KEY = 'poketracker:lastSeenChangelogVersion';

const CHANGELOG_TYPE_LABELS = {
    new: 'Nouveau',
    improved: 'Amélioré',
    fixed: 'Corrigé',
    fix: 'Correctif',
    security: 'Sécurité',
    removed: 'Retiré'
};

function renderChangelogEntryChanges(changes) {
    return changes.map(c => `
        <li class="changelog-change changelog-change--${escapeHtml(c.type)}">
            <span class="changelog-change-badge">${escapeHtml(CHANGELOG_TYPE_LABELS[c.type] || c.type)}</span>
            <span class="changelog-change-text">${escapeHtml(c.text)}</span>
        </li>
    `).join('');
}

function renderChangelogEntry(entry) {
    return `
        <article class="changelog-entry">
            <div class="changelog-entry-header">
                <h2 class="changelog-entry-version">Version ${escapeHtml(entry.version)}</h2>
                <span class="changelog-entry-date">${escapeHtml(entry.date)}</span>
            </div>
            <h3 class="changelog-entry-title">${escapeHtml(entry.title)}</h3>
            <ul class="changelog-change-list">${renderChangelogEntryChanges(entry.changes)}</ul>
        </article>
    `;
}

// Rendu de la route #/changelog (tab-changelog, cf tracker.js activateTabContent). CHANGELOG est déjà
// trié du plus récent au plus ancien (convention data/changelog.js), aucun tri à refaire ici.
function renderChangelogPage() {
    const container = document.getElementById('changelog-list');
    if (!container) return;
    container.innerHTML = CHANGELOG.map(renderChangelogEntry).join('');
}

function closeChangelogPopup() {
    const overlay = document.getElementById('changelog-popup-overlay');
    if (overlay) overlay.classList.remove('active');
}

// Marque la version courante comme vue puis ferme la popup - action volontaire de l'utilisateur (bouton
// "J'ai compris" ou clic sur le fond), jamais déclenchée automatiquement pour ne pas escamoter une version
// sans qu'elle ait été montrée.
function acknowledgeChangelogPopup() {
    localStorage.setItem(LAST_SEEN_CHANGELOG_KEY, APP_VERSION);
    closeChangelogPopup();
}

// Popup "Nouveautés" : affichée au plus une fois par version et par navigateur. N'affiche que si une
// entrée CHANGELOG correspond exactement à APP_VERSION (sinon rien à montrer) et si cette version n'a pas
// déjà été vue. Appelée une seule fois depuis modules/auth.js, après appReady = true (donc jamais pendant
// le login, jamais en concurrence avec une autre modale d'ouverture automatique - il n'y en a pas à ce
// point du chargement).
function maybeShowChangelogPopup() {
    const lastSeen = localStorage.getItem(LAST_SEEN_CHANGELOG_KEY);
    if (lastSeen === APP_VERSION) return;

    const entry = CHANGELOG.find(e => e.version === APP_VERSION);
    if (!entry) return;

    const overlay = document.getElementById('changelog-popup-overlay');
    const content = document.getElementById('changelog-popup-content');
    if (!overlay || !content) return;

    content.innerHTML = `
        <button class="modal-close" onclick="acknowledgeChangelogPopup()">✕</button>
        <div class="modal-scroll">
            <h2 class="changelog-popup-title">Nouveautés — Version ${escapeHtml(entry.version)}</h2>
            <p class="changelog-popup-subtitle">${escapeHtml(entry.title)}</p>
            <ul class="changelog-change-list">${renderChangelogEntryChanges(entry.changes)}</ul>
            <button type="button" class="btn-primary changelog-popup-confirm" onclick="acknowledgeChangelogPopup()">J'ai compris</button>
        </div>
    `;
    overlay.classList.add('active');
}
