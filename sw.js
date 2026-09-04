/**
 * Service worker: makes VoiceLift work with no signal.
 *
 * A gym is a concrete box in a basement. The whole app is ten static files,
 * so all of it is precached on install and served from cache first.
 *
 * Strategy is stale-while-revalidate: the cached copy answers immediately and
 * a fresh copy is fetched in the background for next time. A deploy therefore
 * lands on the second visit — or straight away, if the page accepts the
 * "new version" prompt and posts SKIP_WAITING.
 *
 * Bump CACHE_VERSION whenever the file list changes.
 */

const CACHE_VERSION = 'v8';
const CACHE_NAME = `voicelift-${CACHE_VERSION}`;

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/parser.js',
  './js/exercises.js',
  './js/store.js',
  './js/speech.js',
  './js/wakelock.js',
  './js/handsfree.js',
  './js/repair.js',
  './js/phonetic.js',
  './js/voicelog.js',
  './js/history.js',
  './js/totals.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Individual failures must not sink the whole install.
    await Promise.allSettled(PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' }))));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request, { ignoreSearch: true });

    const network = fetch(request).then((response) => {
      if (response && response.ok && response.type === 'basic') {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    }).catch(() => null);

    if (cached) return cached;

    const fresh = await network;
    if (fresh) return fresh;

    // Offline, uncached, and a page was asked for: hand back the shell.
    if (request.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    return new Response('Offline and not cached.', { status: 503, statusText: 'Offline' });
  })());
});
