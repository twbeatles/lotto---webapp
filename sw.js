const CACHE_VERSION = 'v32';
const CACHE_APP_SHELL = `lotto-pension-pro-app-shell-${CACHE_VERSION}`;
const CACHE_DATA = `lotto-pension-pro-data-${CACHE_VERSION}`;
const FALLBACK_PRECACHE_MANIFEST = {
    version: `fallback-${CACHE_VERSION}`,
    appShell: [
        './',
        './index.html',
        './manifest.json',
        './assets/app.css',
        './assets/styles/tokens.css',
        './assets/styles/layout.css',
        './assets/styles/components.css',
        './assets/styles/pages.css',
        './assets/styles/modals.css',
        './assets/styles/responsive.css',
        './assets/vendor/pretendard/PretendardVariable.woff2',
        './assets/vendor/phosphor/src/regular/style.css',
        './assets/vendor/phosphor/src/regular/Phosphor.woff2',
        './assets/vendor/phosphor/src/bold/style.css',
        './assets/vendor/phosphor/src/bold/Phosphor-Bold.woff2',
        './assets/vendor/phosphor/src/fill/style.css',
        './assets/vendor/phosphor/src/fill/Phosphor-Fill.woff2'
    ],
    data: ['./data/pension720_stats.json', './data/winning_stats.json']
};

try {
    importScripts('./assets/sw-precache-manifest.js');
} catch (_e) {
    self.__SW_PRECACHE_MANIFEST = FALLBACK_PRECACHE_MANIFEST;
}

const PRECACHE_MANIFEST = self.__SW_PRECACHE_MANIFEST || FALLBACK_PRECACHE_MANIFEST;
const PRECACHE_MANIFEST_VERSION =
    typeof PRECACHE_MANIFEST.version === 'string' && PRECACHE_MANIFEST.version.trim()
        ? PRECACHE_MANIFEST.version.trim()
        : `missing-${CACHE_VERSION}`;
const APP_SHELL_ASSETS = Array.isArray(PRECACHE_MANIFEST.appShell)
    ? PRECACHE_MANIFEST.appShell
    : FALLBACK_PRECACHE_MANIFEST.appShell;
const DATA_CORE_ASSETS = Array.isArray(PRECACHE_MANIFEST.data)
    ? PRECACHE_MANIFEST.data
    : FALLBACK_PRECACHE_MANIFEST.data;
const ONLINE_CHECK_PATH_SUFFIX = '/online-check.txt';
const CACHE_HEALTH_PATH_SUFFIX = '/__cache-health.json';
let lastPrecacheHealth = {
    ok: true,
    cacheVersion: CACHE_VERSION,
    manifestVersion: PRECACHE_MANIFEST_VERSION,
    checkedAt: '',
    failures: []
};

self.addEventListener('message', (event) => {
    if (event.data?.action === 'skipWaiting') {
        self.skipWaiting();
    }
});

async function safePrecache() {
    const appShellCache = await caches.open(CACHE_APP_SHELL);
    const dataCache = await caches.open(CACHE_DATA);
    const failures = [];
    const jobs = [
        ...APP_SHELL_ASSETS.map(async (url) => {
            try {
                await appShellCache.add(url);
            } catch (e) {
                failures.push({ cache: 'appShell', url, message: String(e?.message || e || '') });
            }
        }),
        ...DATA_CORE_ASSETS.map(async (url) => {
            try {
                await dataCache.add(url);
            } catch (e) {
                failures.push({ cache: 'data', url, message: String(e?.message || e || '') });
            }
        })
    ];
    await Promise.allSettled(jobs);
    lastPrecacheHealth = {
        ok: failures.length === 0,
        cacheVersion: CACHE_VERSION,
        manifestVersion: PRECACHE_MANIFEST_VERSION,
        checkedAt: new Date().toISOString(),
        failures
    };
    try {
        await appShellCache.put(
            './__cache-health.json',
            new Response(JSON.stringify(lastPrecacheHealth), {
                headers: {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Cache-Control': 'no-store'
                }
            })
        );
    } catch (_e) {
        // Cache health reporting must not turn a tolerant install into a failed install.
    }
}

self.addEventListener('install', (event) => {
    event.waitUntil(safePrecache());
});

async function putIfOk(cacheName, request, response) {
    if (!response || (!response.ok && response.type !== 'opaque')) return;
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
}

async function matchCachedResponse(cache, request, options = {}) {
    const cached = await cache.match(request);
    if (cached) return cached;

    if (options.ignoreSearch) {
        const url = new URL(request.url);
        if (url.search) {
            return cache.match(request, { ignoreSearch: true });
        }
    }
    return null;
}

async function networkFirstWithTimeout(request, cacheName, timeoutMs = 2500, options = {}) {
    const cache = await caches.open(cacheName);
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timeoutId = null;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            if (controller) controller.abort();
            reject(new Error('network-timeout'));
        }, timeoutMs);
    });

    try {
        const fetchOptions = controller ? { signal: controller.signal } : undefined;
        const networkRes = await Promise.race([fetch(request, fetchOptions), timeoutPromise]);
        if (options.fallbackOnErrorStatus && !networkRes.ok && networkRes.type !== 'opaque') {
            const cached = await matchCachedResponse(cache, request, options);
            if (cached) return cached;
        }
        try {
            await putIfOk(cacheName, request, networkRes);
        } catch (_e) {
            // A cache write failure should not hide a successful network response.
        }
        return networkRes;
    } catch (e) {
        const cached = await matchCachedResponse(cache, request, options);
        if (cached) return cached;
        if (request.mode === 'navigate') {
            return cache.match('./index.html');
        }
        throw e;
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}

async function staleWhileRevalidate(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    const networkPromise = fetch(request)
        .then((res) => {
            putIfOk(cacheName, request, res).catch(() => null);
            return res;
        })
        .catch(() => null);

    if (cached) {
        networkPromise.catch(() => null);
        return cached;
    }
    const network = await networkPromise;
    if (network) return network;
    if (request.mode === 'navigate') {
        const shell = await caches.open(CACHE_APP_SHELL);
        return shell.match('./index.html');
    }
    return new Response('오프라인', { status: 503, statusText: 'Offline' });
}

function isAppShellCodeRequest(request, url) {
    const destination = String(request.destination || '');
    if (['script', 'style', 'worker', 'font'].includes(destination)) return true;
    return /\.(?:js|css|woff2?|ttf)$/i.test(url.pathname);
}

function isDataAssetRequest(url) {
    return /\/data\/[^/]+\.json$/i.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;
    if (url.pathname.endsWith(ONLINE_CHECK_PATH_SUFFIX)) return;
    if (url.pathname.endsWith(CACHE_HEALTH_PATH_SUFFIX)) {
        event.respondWith(
            caches
                .open(CACHE_APP_SHELL)
                .then((cache) => cache.match('./__cache-health.json'))
                .then(
                    (cached) =>
                        cached ||
                        new Response(JSON.stringify(lastPrecacheHealth), {
                            headers: {
                                'Content-Type': 'application/json; charset=utf-8',
                                'Cache-Control': 'no-store'
                            }
                        })
                )
        );
        return;
    }

    if (isDataAssetRequest(url)) {
        event.respondWith(networkFirstWithTimeout(event.request, CACHE_DATA, 3500, { fallbackOnErrorStatus: true }));
        return;
    }

    if (event.request.mode === 'navigate') {
        event.respondWith(networkFirstWithTimeout(event.request, CACHE_APP_SHELL, 3500));
        return;
    }

    // JS/CSS/font assets must prefer the network so deployed fixes do not get stuck behind stale app-shell cache.
    if (isAppShellCodeRequest(event.request, url)) {
        event.respondWith(networkFirstWithTimeout(event.request, CACHE_APP_SHELL, 3500, { ignoreSearch: true }));
        return;
    }

    event.respondWith(staleWhileRevalidate(event.request, CACHE_APP_SHELL));
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        (async () => {
            const valid = new Set([CACHE_APP_SHELL, CACHE_DATA]);
            const keys = await caches.keys();
            await Promise.all(
                keys.map((key) => {
                    if (!valid.has(key)) return caches.delete(key);
                    return Promise.resolve();
                })
            );
            await self.clients.claim();
        })()
    );
});
