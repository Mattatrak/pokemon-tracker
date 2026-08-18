// PWA - Pokémon Tracker (audit PWA du 2026-08-18)
// Deux responsabilités indépendantes, regroupées ici car toutes deux concernent l'installation/le
// cycle de vie de l'app en tant que PWA plutôt que sa logique métier : installation personnalisée
// (beforeinstallprompt) et bannière de mise à jour du service worker. Chargé sur index.html ET
// login.html (les deux enregistrent le service worker).
// Dépend de : rien (aucun état partagé avec les autres modules).

let deferredPwaInstallPrompt = null;

// App deja lancee en mode installe (icone ecran d'accueil, pas un onglet de navigateur) : proposer de
// "l'installer" n'a aucun sens, et un beforeinstallprompt residuel d'avant l'installation (capture par
// une session precedente, ou signal reste en cache navigateur) echoue silencieusement au prompt() - cf
// retour utilisateur (2026-08-18, "le clic ne fait rien" sur une app deja sur l'ecran d'accueil).
const isRunningStandalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true; // iOS Safari, pas de display-mode standalone fiable

// Empêche le mini-bandeau automatique de Chrome (comportement par défaut) : on garde l'événement pour
// le déclencher nous-mêmes, au clic sur notre propre bouton "Installer l'app" (menu Plus mobile / menu
// profil desktop, cf MobileBottomNavigation.js/DesktopNavbar.js), plutôt que de laisser le navigateur
// choisir seul le moment. Jamais déclenché sur Safari/iOS (API absente) - le bouton y reste masqué en
// permanence via .pwa-installable, jamais ajoutée à <body>.
window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    if (isRunningStandalone) return;
    deferredPwaInstallPrompt = event;
    document.body.classList.add('pwa-installable');
});

window.addEventListener('appinstalled', () => {
    deferredPwaInstallPrompt = null;
    document.body.classList.remove('pwa-installable');
});

async function triggerPwaInstall() {
    if (!deferredPwaInstallPrompt) return;
    const promptEvent = deferredPwaInstallPrompt;
    deferredPwaInstallPrompt = null;
    document.body.classList.remove('pwa-installable');
    try {
        promptEvent.prompt();
        await promptEvent.userChoice;
    } catch (err) {
        // Evenement capture perime (app installee entre-temps par un autre biais, ou deja consomme) -
        // pas d'erreur bloquante pour l'utilisateur, juste un console.error pour le diagnostic.
        console.error('Installation PWA impossible (invite perimee) :', err);
    }
}

// Affiche #sw-update-banner (index.html/login.html) dès qu'une nouvelle version est en attente, au
// lieu de la laisser prendre la main silencieusement (self.skipWaiting() retiré de sw.js) - évite
// qu'un onglet resté ouvert pendant un déploiement se retrouve avec un controllerchange en plein
// milieu d'une action (même famille de bug que le ReferenceError applySearchFilters du 2026-08-18,
// causé par un ordre de chargement inattendu).
function showSwUpdateBanner(registration) {
    const banner = document.getElementById('sw-update-banner');
    if (!banner || banner.classList.contains('visible')) return;
    banner.classList.add('visible');
    banner.setAttribute('aria-hidden', 'false');

    const reloadBtn = document.getElementById('sw-update-reload-btn');
    if (!reloadBtn) return;
    reloadBtn.onclick = () => {
        reloadBtn.disabled = true;
        navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
        registration.waiting?.postMessage('SKIP_WAITING');
    };
}

function registerServiceWorker() {
    navigator.serviceWorker.register('sw.js').then((registration) => {
        // Déjà une version en attente au moment de l'enregistrement (ex: onglet ouvert avant un
        // déploiement, un autre onglet a déjà déclenché le téléchargement) : bannière immédiate.
        // navigator.serviceWorker.controller absent = tout premier install de ce navigateur, rien à
        // signaler (pas une mise à jour).
        if (registration.waiting && navigator.serviceWorker.controller) {
            showSwUpdateBanner(registration);
        }

        registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            if (!newWorker) return;
            newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                    showSwUpdateBanner(registration);
                }
            });
        });
    }).catch((err) => console.error('Erreur Service Worker:', err));
}

// ===== Exports window (ticket V2 Vite, type="module") =====
window.triggerPwaInstall = triggerPwaInstall;
window.registerServiceWorker = registerServiceWorker;
