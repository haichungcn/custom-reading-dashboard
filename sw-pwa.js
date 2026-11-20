/**
 * Calm Morning Gateway — Standalone Mobile PWA Offline Service Worker (`sw-pwa.js`)
 *
 * Pre-caches core shell assets for iOS/iPadOS/Android offline resilience.
 * Uses async/await exclusively (no promise chaining).
 * - Network-first for GitHub Gist API & external RSS feeds
 * - Cache-first with background refresh for same-origin static assets
 */

const CACHE_NAME = 'calm-gateway-pwa-v4';

const PRECACHE_URLS = [
  './',
  './index.html',
  './pwa-manifest.json',
  './css/tokens.css',
  './css/layout.css',
  './css/components.css',
  './js/app.js',
  './js/store.js',
  './js/backgrounds.js',
  './js/widgets.js',
  './js/gist-sync.js',
  './js/rss-engine.js',
  './js/wellness.js',
  './icons/icon-48.png',
  './icons/icon-128.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(PRECACHE_URLS);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key !== CACHE_NAME)
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

/**
 * Network-first strategy for GitHub API and external RSS feeds.
 * Never serves stale cached API mutations; falls back gracefully if offline.
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function handleNetworkFirst(request) {
  try {
    return await fetch(request);
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ offline: true }), {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Cache-first with background refresh for same-origin static assets.
 * @param {Request} request
 * @param {FetchEvent} event
 * @returns {Promise<Response>}
 */
async function handleStaticAsset(request, event) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, {
    ignoreSearch: request.mode === 'navigate'
  });

  const refreshPromise = (async () => {
    try {
      const response = await fetch(request);
      if (response && response.ok && response.type === 'basic') {
        await cache.put(request, response.clone());
      }
      return response;
    } catch {
      return null;
    }
  })();

  if (cached) {
    event.waitUntil(refreshPromise);
    return cached;
  }

  const networkResponse = await refreshPromise;
  if (networkResponse) {
    return networkResponse;
  }

  if (request.mode === 'navigate') {
    const fallback = await cache.match('./index.html');
    if (fallback) return fallback;
  }

  return new Response('Offline', { status: 503, statusText: 'Offline' });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  const isExternalOrApi = url.origin !== self.location.origin || url.hostname === 'api.github.com';
  if (isExternalOrApi) {
    event.respondWith((async () => await handleNetworkFirst(request))());
    return;
  }

  event.respondWith((async () => await handleStaticAsset(request, event))());
});
