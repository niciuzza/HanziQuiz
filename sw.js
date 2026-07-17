// Offline support. Cache name is tied to the same "?v=N" the rest of the app already bumps on
// every data.js/script.js/style.css change (see script.js's APP_BUILD) — registered as
// sw.js?v=N, read back here via self.location.search, so a version bump automatically busts
// this cache too with no separate process to remember.
const params = new URLSearchParams(self.location.search);
const VERSION = params.get('v') || 'dev';
const CACHE_NAME = `hanziquiz-${VERSION}`;

const CORE_ASSETS = [
  './',
  './index.html',
  `./style.css?v=${VERSION}`,
  `./script.js?v=${VERSION}`,
  `./data.js?v=${VERSION}`,
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
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

  // this app's own files: cache-first, so the app shell + vocabulary data work fully offline
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
    return;
  }

  // Google Fonts: not precached in full (the CJK font family alone is many MB across its
  // per-character-range subset files), but cache-first for whatever gets requested during
  // normal use, so characters already seen keep rendering in the custom font offline too —
  // anything never seen falls back to the system font (see style.css's font-family stacks),
  // which is a fine degradation, not a broken app
  if (url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com') {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        });
      })
    );
  }
});
