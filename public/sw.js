// Service Worker - Pokémon Tracker
// CACHE_NAME et CORE_ASSETS ci-dessous sont générés automatiquement par scripts/build-sw.js (exécuté
// après `vite build`, à partir de dist/.vite/manifest.json) — ne plus les éditer à la main, ce fichier
// source (public/sw.js) ne contient que des valeurs de secours utilisées si le script de génération
// n'a pas tourné (ex: `vite dev`, où le Service Worker est de toute façon désactivé, cf tracker.js/
// auth.js — import.meta.env.PROD). Pour changer ce qui est précaché, modifier ce que référencent
// index.html/login.html (Vite le détecte automatiquement), pas ce fichier.
// ===== AUTO-GENERATED:START =====
const CACHE_NAME = 'poketracker-dev';
const CORE_ASSETS = [];
// ===== AUTO-GENERATED:END =====

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
            // ignoreVary: la Cache API respecte par défaut l'en-tête Vary de la réponse d'origine - un
            // Vary présent sur certaines réponses statiques (observé sur les CSS servis par vite preview,
            // absent sur les JS) suffit à faire échouer un match pourtant réellement précaché. Aucune
            // réponse ici n'est jamais négociée par en-tête (pas de contenu différent par Accept/Origin),
            // ignorer Vary est donc sans risque de corruption de cache.
            caches.match(request, { ignoreVary: true }).then((cached) => cached || (fallbackUrl ? caches.match(fallbackUrl, { ignoreVary: true }) : undefined))
        );
}

// Cache d'abord avec revalidation en arrière-plan : sert immédiatement le cache s'il existe (pas
// d'attente réseau), relance quand même un fetch en parallèle pour rafraîchir le cache pour la
// prochaine fois. Si rien n'est en cache, utilise directement la réponse réseau. Utilisé pour les
// images/icônes locales - pas de revalidation bloquante à chaque affichage.
function staleWhileRevalidate(request) {
    return caches.match(request, { ignoreVary: true }).then((cached) => {
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
