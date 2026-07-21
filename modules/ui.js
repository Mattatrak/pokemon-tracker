// Modales génériques (remplacent prompt()/confirm() natifs) - Pokémon Tracker
// Aucune dépendance externe hormis le DOM. Etat possédé : textPromptResolve, confirmModalResolve

// ===== MODALE DE SAISIE DE TEXTE GENERIQUE (remplace prompt() natif) =====

let textPromptResolve = null;

function showTextPromptModal(title, defaultValue = '') {
    return new Promise((resolve) => {
        textPromptResolve = resolve;
        const content = document.getElementById('text-prompt-content');
        content.innerHTML = `
            <button class="modal-close" onclick="closeTextPrompt()">✕</button>
            <div class="modal-title" style="margin-bottom: 1rem;">${title}</div>
            <input type="text" id="text-prompt-input" value="${defaultValue.replace(/"/g, '&quot;')}" style="width:100%; margin-bottom: 1.25rem;">
            <div class="modal-edit-actions">
                <button class="modal-save-btn" onclick="submitTextPrompt()">Valider</button>
                <button class="modal-cancel-btn" onclick="closeTextPrompt()">Annuler</button>
            </div>
        `;
        document.getElementById('text-prompt-overlay').classList.add('active');

        const input = document.getElementById('text-prompt-input');
        setTimeout(() => { input.focus(); input.select(); }, 50);
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') submitTextPrompt();
        });
    });
}

function submitTextPrompt() {
    const value = document.getElementById('text-prompt-input').value.trim();
    document.getElementById('text-prompt-overlay').classList.remove('active');
    if (textPromptResolve) {
        textPromptResolve(value || null);
        textPromptResolve = null;
    }
}

function closeTextPrompt() {
    document.getElementById('text-prompt-overlay').classList.remove('active');
    if (textPromptResolve) {
        textPromptResolve(null);
        textPromptResolve = null;
    }
}

// ===== MODALE DE CONFIRMATION GENERIQUE (remplace confirm() natif) =====

let confirmModalResolve = null;

function showConfirmModal(message, confirmLabel = 'Confirmer') {
    return new Promise((resolve) => {
        confirmModalResolve = resolve;
        const content = document.getElementById('confirm-modal-content');
        content.innerHTML = `
            <button class="modal-close" onclick="closeConfirmModal(false)">✕</button>
            <div class="modal-title" style="margin-bottom: 1.25rem;">${message}</div>
            <div class="modal-edit-actions">
                <button class="modal-delete-btn-v2" style="flex: 1; margin-top: 0;" onclick="closeConfirmModal(true)">${confirmLabel}</button>
                <button class="modal-cancel-btn" onclick="closeConfirmModal(false)">Annuler</button>
            </div>
        `;
        document.getElementById('confirm-modal-overlay').classList.add('active');
    });
}

function closeConfirmModal(result) {
    document.getElementById('confirm-modal-overlay').classList.remove('active');
    if (confirmModalResolve) {
        confirmModalResolve(result);
        confirmModalResolve = null;
    }
}
