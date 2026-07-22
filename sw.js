const CACHE_NAME = 'poketracker-v3';
const CORE_ASSETS = [
    './',
    './index.html',
    './login.html',
    './styles.css',
    './styles-login.css',
    './tracker.js',
    './manifest.json',
    './images/icon-192.png',
    './images/icon-512.png',
    './modules/utils.js',
    './modules/storage.js',
    './modules/cards.js',
    './modules/stats.js',
    './modules/collection.js',
    './modules/import-export.js',
    './modules/card-detail.js',
    './modules/ui.js',
    './modules/wishlist.js',
    './modules/stats-render.js',
    './modules/progression.js',
    './modules/auth.js',
    './modules/auth-login.js'
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

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Ne jamais mettre en cache les appels vers Supabase ou TCGdex : on veut toujours des données fraîches
    if (url.hostname.includes('supabase.co') || url.hostname.includes('tcgdex.net') || url.hostname.includes('assets.tcgdex')) {
        return; // laisse passer normalement au réseau
    }

    event.respondWith(
        caches.match(event.request).then((cached) => {
            const fetchPromise = fetch(event.request)
                .then((response) => {
                    if (response.ok && url.origin === self.location.origin) {
                        const responseClone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
                    }
                    return response;
                })
                .catch(() => cached); // hors-ligne : on retombe sur le cache si dispo

            return cached || fetchPromise;
        })
    );
});
