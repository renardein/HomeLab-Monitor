const SW_VERSION = 'hlm-sw-v2';
const APP_SHELL_CACHE = `${SW_VERSION}-shell`;
const API_CACHE = `${SW_VERSION}-api`;

const APP_SHELL_URLS = [
  '/',
  '/css/styles.css',
  '/js/app.js',
  '/js/modules/refresh-data-manager.js',
  '/js/modules/app-navigation-manager.js',
  '/js/modules/monitor-draw-manager.js',
  '/js/modules/custom-theme-manager.js',
  '/js/modules/connection-manager.js',
  '/js/modules/monitor-view-router.js',
  '/js/modules/monitor-interactions.js',
  '/js/modules/monitor-screens.js',
  '/js/modules/monitor-hotkeys.js',
  '/js/modules/dashboard-time-weather-settings.js',
  '/manifest.webmanifest',
  '/pwa/icon-192.svg',
  '/pwa/icon-512.svg'
];

const API_OFFLINE_LITE_PATHS = [
  '/api/cluster/full',
  '/api/storage',
  '/api/backups/jobs',
  '/api/host-metrics/current',
  '/api/truenas/overview',
  '/api/settings/services',
  '/api/netdevices/current',
  '/api/ups/current',
  '/api/speedtest/summary',
  '/api/iperf3/summary',
  '/api/smart-sensors/current'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => {
      if (key !== APP_SHELL_CACHE && key !== API_CACHE) {
        return caches.delete(key);
      }
      return Promise.resolve();
    }));
    await self.clients.claim();
  })());
});

function isApiOfflineLiteRequest(url, method) {
  if (method !== 'GET') return false;
  return API_OFFLINE_LITE_PATHS.some((p) => url.pathname === p);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (url.origin !== self.location.origin) return;

  // HTML navigation: prefer fresh network document, fallback to cached shell.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const netRes = await fetch(req);
        if (netRes && netRes.ok) {
          const cache = await caches.open(APP_SHELL_CACHE);
          cache.put('/', netRes.clone()).catch(() => {});
        }
        return netRes;
      } catch (_) {
        const cachedRoot = await caches.match('/');
        if (cachedRoot) return cachedRoot;
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }

  // API offline-lite: network first, cache fallback
  if (isApiOfflineLiteRequest(url, req.method)) {
    event.respondWith((async () => {
      const cache = await caches.open(API_CACHE);
      try {
        const netRes = await fetch(req);
        if (netRes && netRes.ok) {
          cache.put(req, netRes.clone()).catch(() => {});
        }
        return netRes;
      } catch (_) {
        const cached = await cache.match(req);
        if (cached) return cached;
        return new Response(JSON.stringify({ error: 'offline_no_cached_data' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    })());
    return;
  }

  // App shell/static: cache first
  if (req.method === 'GET') {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const netRes = await fetch(req);
        const ct = (netRes.headers.get('content-type') || '').toLowerCase();
        if (netRes.ok && (ct.includes('text/') || ct.includes('javascript') || ct.includes('json') || ct.includes('svg'))) {
          const cache = await caches.open(APP_SHELL_CACHE);
          cache.put(req, netRes.clone()).catch(() => {});
        }
        return netRes;
      } catch (_) {
        const root = await caches.match('/');
        if (root) return root;
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })());
  }
});
