// Service Worker - Pokémon Tracker
// Jeton de version de déploiement unique, partagé avec les query strings de index.html/login.html.
// A chaque déploiement touchant un fichier local : bumper ce jeton ICI + dans les deux HTML, en une
// seule passe, pour que CACHE_NAME et les URLs précachées correspondent exactement à ce qui est servi.
const DEPLOY_VERSION = '20260812-7';
const CACHE_NAME = `poketracker-${DEPLOY_VERSION}`;

// App shell minimal permettant de démarrer hors ligne après une première visite en ligne : les deux
// documents HTML, le nécessaire pour les faire fonctionner (CSS/JS locaux), le manifeste et les icônes.
// Ne couvre PAS : Supabase/TCGdex (jamais mis en cache, voir fetch handler), les CDN externes (Chart.js,
// flatpickr, PapaParse, Google Fonts, Tabler icons - jamais interceptés), ni les grandes images
// (Hero, cartes) - celles-ci sont couvertes en stale-while-revalidate au fil de l'usage, pas précachées.
// cache.addAll() échoue entièrement si UNE SEULE de ces URLs est absente ou renvoie une erreur : chaque
// chemin ci-dessous a été vérifié présent sur disque avant d'écrire cette liste (2026-08-05).
const CORE_ASSETS = [
    './',
    './index.html',
    './login.html',
    './manifest.json',
    './images/icon-192.png',
    './images/icon-512.png',
    './images/icon-180.png',
    './images/balle.png',
    `./styles.css?v=${DEPLOY_VERSION}`,
    `./styles-login.css?v=${DEPLOY_VERSION}`,
    `./css/layout-tokens.css?v=${DEPLOY_VERSION}`,
    `./css/motion-tokens.css?v=${DEPLOY_VERSION}`,
    `./css/motion-components.css?v=${DEPLOY_VERSION}`,
    `./components/navigation/navigation.css?v=${DEPLOY_VERSION}`,
    `./components/navigation/DesktopNavbar.js?v=${DEPLOY_VERSION}`,
    `./components/navigation/MobileBottomNavigation.js?v=${DEPLOY_VERSION}`,
    `./data/changelog.js?v=${DEPLOY_VERSION}`,
    `./modules/utils.js?v=${DEPLOY_VERSION}`,
    `./modules/storage.js?v=${DEPLOY_VERSION}`,
    `./modules/favorites.js?v=${DEPLOY_VERSION}`,
    `./modules/cards.js?v=${DEPLOY_VERSION}`,
    `./modules/stats.js?v=${DEPLOY_VERSION}`,
    `./modules/collection.js?v=${DEPLOY_VERSION}`,
    `./modules/import-export.js?v=${DEPLOY_VERSION}`,
    `./modules/card-detail.js?v=${DEPLOY_VERSION}`,
    `./modules/ui.js?v=${DEPLOY_VERSION}`,
    `./modules/wishlist.js?v=${DEPLOY_VERSION}`,
    `./modules/stats-render.js?v=${DEPLOY_VERSION}`,
    `./modules/progression.js?v=${DEPLOY_VERSION}`,
    `./modules/dashboard.js?v=${DEPLOY_VERSION}`,
    `./modules/profile.js?v=${DEPLOY_VERSION}`,
    `./tracker.js?v=${DEPLOY_VERSION}`,
    `./modules/auth.js?v=${DEPLOY_VERSION}`,
    `./modules/auth-login.js?v=${DEPLOY_VERSION}`,
    `./modules/admin.js?v=${DEPLOY_VERSION}`,
    `./modules/changelog.js?v=${DEPLOY_VERSION}`,
    `./modules/collectors.js?v=${DEPLOY_VERSION}`,
    `./modules/collector-match.js?v=${DEPLOY_VERSION}`,
    `./modules/public-profile.js?v=${DEPLOY_VERSION}`,
    `./modules/wishlist-detail.js?v=${DEPLOY_VERSION}`
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Réseau d'abord : tente le réseau, met à jour le cache si la réponse est valide, ne retombe sur le
// cache que si le réseau échoue (hors ligne). Utilisé pour les documents HTML et les scripts/styles
// locaux - garantit qu'un utilisateur en ligne reçoit toujours le code réellement déployé, jamais une
// version figée par un cache-first. fallbackUrl sert de dernier recours pour les navigations si l'URL
// exacte demandée n'est pas dans le cache (ex: jamais visitée hors ligne).
function networkFirst(request, fallbackUrl) {
    return fetch(request)
        .then((response) => {
            if (response.ok) {
                const responseClone = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
            }
            return response;
        })
        .catch(() =>
            caches.match(request).then((cached) => cached || (fallbackUrl ? caches.match(fallbackUrl) : undefined))
        );
}

// Cache d'abord avec revalidation en arrière-plan : sert immédiatement le cache s'il existe (pas
// d'attente réseau), relance quand même un fetch en parallèle pour rafraîchir le cache pour la
// prochaine fois. Si rien n'est en cache, utilise directement la réponse réseau. Utilisé pour les
// images/icônes locales - pas de revalidation bloquante à chaque affichage.
function staleWhileRevalidate(request) {
    return caches.match(request).then((cached) => {
        const fetchPromise = fetch(request).then((response) => {
            if (response.ok) {
                const responseClone = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
            }
            return response;
        }).catch(() => cached);
        return cached || fetchPromise;
    });
}

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Origine externe (Supabase, TCGdex, CDN Chart.js/flatpickr/PapaParse/Google Fonts/Tabler...) :
    // jamais interceptée, jamais mise en cache par ce Service Worker. Un seul garde-fou générique par
    // origine plutôt qu'une liste de hostnames - couvre aussi tout futur CDN sans y penser.
    if (url.origin !== self.location.origin) {
        return;
    }

    const isNavigation = event.request.mode === 'navigate' || event.request.destination === 'document';

    if (isNavigation) {
        // Une navigation vers login.html retombe sur login.html précaché ; toute autre navigation
        // applicative (index.html, ou une route hash sur le même document) retombe sur index.html.
        const fallbackUrl = url.pathname.endsWith('login.html') ? './login.html' : './index.html';
        event.respondWith(networkFirst(event.request, fallbackUrl));
        return;
    }

    if (event.request.destination === 'script' || event.request.destination === 'style') {
        event.respondWith(networkFirst(event.request));
        return;
    }

    if (event.request.destination === 'image' || event.request.destination === 'font') {
        event.respondWith(staleWhileRevalidate(event.request));
        return;
    }

    // Tout le reste (même origine, destination non classée) : réseau d'abord par défaut, cohérent avec
    // la priorité donnée à la fraîcheur du code sur la disponibilité hors ligne.
    event.respondWith(networkFirst(event.request));
});
