// Orchestrateur minimal View Transitions API (VT1, cf roadmap technique animations premium) - pas
// un framework d'animation : un point d'entrée unique par lequel chaque feature qui veut utiliser
// document.startViewTransition passe, pour mutualiser 3 choses seulement : support navigateur +
// prefers-reduced-motion, les View Transition Types (cf CSS :active-view-transition-type()), et la
// gestion de concurrence. Chaque appelant reste responsable de ses propres view-transition-name
// (assignation avant l'appel, cleanup dans .finished de la transition retournée) - l'orchestrateur
// ne connaît rien du métier.
//
// Types préparés pour la suite du chantier (VT2-VT5), un seul réellement utilisé pour l'instant
// (card-detail, cf runCardDetailMorphTransition dans card-grid-renderer.js) :
//   - navigation         : changement d'onglet (VT2, pas encore utilisé)
//   - card-detail        : ouverture/fermeture de la fiche carte (VT1)
//   - collection-reorder : réorganisation Collection au filtre/tri (VT4, pas encore utilisé)
//   - profile-open       : Collecteur -> profil public (VT5, pas encore utilisé)
const VIEW_TRANSITION_TYPES = ['navigation', 'card-detail', 'collection-reorder', 'profile-open'];

// Concurrence (cf audit VT) : document.activeViewTransition expose la transition en cours, si
// support - pas besoin de garder notre propre référence/flag. skipTransition() saute proprement à
// l'état final (résout .finished sans jouer l'animation) plutôt que de laisser une transition
// obsolète continuer au-dessus d'un DOM déjà remis à jour par la suivante. Volontairement pas de
// file d'attente : la dernière action utilisateur gagne toujours, priorité à l'état DOM final.
function runViewTransition(type, updateFn) {
    if (!VIEW_TRANSITION_TYPES.includes(type)) {
        console.error(`runViewTransition: type "${type}" inconnu`);
    }

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (typeof document.startViewTransition !== 'function' || reducedMotion) {
        updateFn();
        return null;
    }

    if (document.activeViewTransition) {
        document.activeViewTransition.skipTransition();
    }

    let transition;
    try {
        // Forme avec types (active :active-view-transition-type() côté CSS) : navigateurs récents
        // uniquement.
        transition = document.startViewTransition({ update: updateFn, types: [type] });
    } catch (err) {
        // Objet {update, types} non reconnu par ce navigateur : repli sur la forme historique
        // (fonction seule) - la transition fonctionne toujours, seul le ciblage CSS par type est
        // perdu (le sélecteur :active-view-transition-type() ne matchera simplement jamais).
        transition = document.startViewTransition(updateFn);
    }

    // Évite une rejection non gérée si la transition est skippée ou si updateFn lève (finished
    // rejette dans ces cas) - le cleanup des view-transition-name reste toujours à la charge de
    // l'appelant, via le .finished qu'il chaîne lui-même sur la transition retournée.
    transition.finished.catch(() => {});

    return transition;
}

window.runViewTransition = runViewTransition;
