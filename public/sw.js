// App-shell service worker: caches the static pages/scripts/styles so the
// installed app still opens if the local server takes a moment to come up,
// and satisfies PWA installability. API calls always go to the network -
// this is a live local server app, not something meant to work truly
// offline, so caching API responses would just show stale data.
const CACHE_NAME = 'game-scheduler-shell-v2';
const SHELL_FILES = [
    '/checkin.html', '/manage.html', '/display.html', '/club.html', '/members.html', '/history.html',
    '/style.css', '/events.js', '/pwa.js',
    '/checkin.js', '/manage.js', '/display.js', '/club.js', '/members.js', '/history.js',
    '/manifest.json',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(SHELL_FILES))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (url.pathname.startsWith('/api/')) return;
    event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
