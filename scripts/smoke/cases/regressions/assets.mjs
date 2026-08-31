import { assert, readFile, resolve } from './support.mjs';
import { readdir, stat } from 'node:fs/promises';
import { relative } from 'node:path';
import { runInNewContext } from 'node:vm';
import { safeHtml } from '../../../../assets/modules/utils/dom.js';
import { buildPrecacheManifest, renderManifestSource } from '../../../generate_sw_manifest.mjs';
import { getDataBaseline, updateDocSource } from '../../../update_docs_data_baseline.mjs';

function normalizeLineEndings(text = '') {
    return String(text).replace(/\r\n/g, '\n');
}

async function runRuntimeAssetLocalizationRegression() {
    const targets = ['index.html', 'assets/app.css', 'assets/modules/utils/loader.js'];
    for (const target of targets) {
        const text = await readFile(resolve(process.cwd(), target), 'utf8');
        assert.ok(
            !/cdn\.jsdelivr\.net|unpkg\.com|@import url\(/.test(text),
            `${target} must not reference runtime CDN assets`
        );
    }
}

async function runServiceWorkerReloadPolicyRegression() {
    const pwaSource = await readFile(resolve(process.cwd(), 'assets/modules/bootstrap/pwa.js'), 'utf8');
    assert.match(
        pwaSource,
        /let reloadOnControllerChange = false;/,
        'SW script must gate reloads behind explicit update acceptance'
    );
    assert.match(
        pwaSource,
        /navigator\.serviceWorker\s*\.register\('sw\.js',\s*\{\s*updateViaCache: 'none'\s*\}\)/,
        'SW registration must bypass stale HTTP cache when checking for updates'
    );
    assert.match(pwaSource, /reloadOnControllerChange = true;/, 'update acceptance must arm controllerchange reload');
    assert.match(
        pwaSource,
        /if \(refreshing \|\| !reloadOnControllerChange\) return;/,
        'controllerchange must ignore first-install activation'
    );
    assert.match(
        pwaSource,
        /if \(e\.data\?\.type === 'SW_ACTIVATED' && e\.data\?\.senderId !== channelClientId\)/,
        'remote tabs must reload only after activation-complete broadcast from another tab'
    );
    assert.match(
        pwaSource,
        /updateChannel\?\.postMessage\(\{ type: 'SW_ACTIVATED', senderId: channelClientId \}\);/,
        'activation-complete broadcast must happen after controllerchange'
    );
    assert.doesNotMatch(pwaSource, /SW_UPDATED/, 'legacy immediate reload broadcast must be removed');
    assert.match(
        pwaSource,
        /if \(reg\.waiting && navigator\.serviceWorker\.controller\) \{\s*setUpdateReady\(reg\.waiting\);/m,
        'existing waiting SW must surface the update toast immediately'
    );
    assert.match(
        pwaSource,
        /window\.lottoPwaUpdate\.check\(\)\.catch\(\(\) => \{\}\);/,
        'registration flow must proactively check for a newer SW script'
    );
    assert.match(pwaSource, /window\.lottoPwaUpdate = \{/, 'PWA lifecycle must expose update controls for settings UI');
    assert.match(
        pwaSource,
        /new CustomEvent\('lotto:pwa-update-state'/,
        'PWA lifecycle must dispatch update state changes'
    );
    assert.match(
        pwaSource,
        /새 앱 버전이 준비되었습니다\. 지금 적용하면 화면이 한 번 새로고침됩니다\./,
        'PWA update toast must explain the reload'
    );
}

async function runServiceWorkerCoreDataPrecacheRegression() {
    const swSource = await readFile(resolve(process.cwd(), 'sw.js'), 'utf8');
    assert.match(swSource, /const CACHE_VERSION = 'v32';/, 'service worker cache version must match release baseline');
    assert.match(
        swSource,
        /lotto-pension-pro-app-shell-/,
        'service worker app-shell cache must use the rebranded slug'
    );
    assert.match(
        swSource,
        /await cache\.put\(request, response\.clone\(\)\);/,
        'service worker cache writes must be awaited to avoid dropped mobile cache updates'
    );
    assert.match(
        swSource,
        /async function matchCachedResponse\(cache, request, options = \{\}\)/,
        'service worker must centralize cache fallback matching'
    );
    assert.match(
        swSource,
        /cache\.match\(request, \{ ignoreSearch: true \}\)/,
        'versioned worker and module assets must be reachable from precache while offline'
    );
    assert.match(
        swSource,
        /importScripts\('\.\/assets\/sw-precache-manifest\.js'\);/,
        'service worker must import the generated precache manifest'
    );
    assert.match(
        swSource,
        /const PRECACHE_MANIFEST = self\.__SW_PRECACHE_MANIFEST \|\| FALLBACK_PRECACHE_MANIFEST;/,
        'service worker must consume the generated precache manifest'
    );
    assert.match(swSource, /PRECACHE_MANIFEST_VERSION/, 'service worker must track the generated manifest version');
    assert.match(swSource, /manifestVersion: PRECACHE_MANIFEST_VERSION/, 'cache health must include manifest version');
    assert.match(
        swSource,
        /const DATA_CORE_ASSETS = Array\.isArray\(PRECACHE_MANIFEST\.data\)/,
        'service worker must read data precache entries from the manifest'
    );
    assert.match(
        swSource,
        /const ONLINE_CHECK_PATH_SUFFIX = '\/online-check\.txt';/,
        'service worker must reserve the online-check path'
    );
    assert.match(
        swSource,
        /if \(url\.pathname\.endsWith\(ONLINE_CHECK_PATH_SUFFIX\)\) return;/,
        'service worker must bypass cache handling for the online-check probe path'
    );
    assert.match(
        swSource,
        /\.\/data\/winning_stats\.json/,
        'winning_stats.json must stay in the precache manifest fallback'
    );
    assert.match(
        swSource,
        /\.\/data\/pension720_stats\.json/,
        'pension720_stats.json must stay in the precache manifest fallback'
    );
    assert.match(
        swSource,
        /const dataCache = await caches\.open\(CACHE_DATA\);/,
        'data cache must be opened during install precache'
    );
    assert.match(
        swSource,
        /networkFirstWithTimeout\(event\.request, CACHE_DATA, 3500, \{ fallbackOnErrorStatus: true \}\)/,
        'data cache must prefer network-first delivery with cached fallback'
    );
    assert.doesNotMatch(
        swSource,
        /staleWhileRevalidate\(event\.request, CACHE_DATA\)/,
        'data cache must not use stale-while-revalidate for first responses'
    );
    assert.match(
        swSource,
        /function isAppShellCodeRequest\(request, url\)/,
        'service worker must classify JS/CSS/font assets separately'
    );
    assert.match(
        swSource,
        /function isDataAssetRequest\(url\)/,
        'service worker must classify data JSON separately from manifest.json'
    );
    assert.doesNotMatch(
        swSource,
        /url\.pathname\.endsWith\('\.json'\)/,
        'manifest.json must not be treated as mutable data-cache JSON'
    );
    assert.match(
        swSource,
        /networkFirstWithTimeout\(event\.request, CACHE_APP_SHELL, 3500, \{ ignoreSearch: true \}\)/,
        'app-shell code assets must prefer network-first delivery'
    );
    assert.match(swSource, /new AbortController\(\)/, 'network-first timeout must be able to abort fetches');
    assert.match(swSource, /clearTimeout\(timeoutId\)/, 'network-first timeout must clear its timer');
    assert.doesNotMatch(
        swSource,
        /__network_probe/,
        'service worker must not special-case the deprecated probe route anymore'
    );
}

async function runServiceWorkerDataNetworkFirstRegression() {
    const swSource = await readFile(resolve(process.cwd(), 'sw.js'), 'utf8');
    const store = new Map();
    const cache = {
        async put(request, response) {
            store.set(request.url, response.clone());
        },
        async match(request) {
            return store.get(request.url)?.clone() || null;
        }
    };
    const context = {
        caches: {
            async open() {
                return cache;
            }
        },
        console,
        fetch: async () => new Response('network-316', { status: 200 }),
        Response,
        self: {
            __SW_PRECACHE_MANIFEST: null,
            addEventListener() {}
        },
        setTimeout,
        clearTimeout,
        AbortController,
        URL
    };
    runInNewContext(swSource, context);

    const request = new Request('https://example.test/data/pension720_stats.json');
    await cache.put(request, new Response('cached-315', { status: 200 }));
    const options = { fallbackOnErrorStatus: true };
    const networkResult = await context.networkFirstWithTimeout(request, 'data-cache', 3500, options);
    assert.equal(await networkResult.text(), 'network-316', 'data request must prefer a fresh network response');
    assert.equal(
        await (await cache.match(request)).text(),
        'network-316',
        'network data response must refresh the data cache'
    );

    context.fetch = async () => {
        throw new Error('offline');
    };
    const cachedResult = await context.networkFirstWithTimeout(request, 'data-cache', 3500, options);
    assert.equal(await cachedResult.text(), 'network-316', 'data request must fall back to cached data when offline');

    context.fetch = async () => new Response('server-error', { status: 503 });
    const errorStatusResult = await context.networkFirstWithTimeout(request, 'data-cache', 3500, options);
    assert.equal(
        await errorStatusResult.text(),
        'network-316',
        'data request must fall back to cached data when the network returns an error status'
    );

    let abortObserved = false;
    context.fetch = async (_request, fetchOptions = {}) =>
        new Promise((_, reject) => {
            fetchOptions?.signal?.addEventListener(
                'abort',
                () => {
                    abortObserved = true;
                    reject(new Error('aborted'));
                },
                { once: true }
            );
        });
    const timeoutResult = await context.networkFirstWithTimeout(request, 'data-cache', 1, options);
    assert.equal(
        await timeoutResult.text(),
        'network-316',
        'timed-out data request must still fall back to cached data'
    );
    assert.equal(abortObserved, true, 'timed-out network-first fetch must be aborted');
}

async function runContentSecurityPolicyMetaRegression() {
    const indexSource = await readFile(resolve(process.cwd(), 'index.html'), 'utf8');
    assert.match(
        indexSource,
        /http-equiv="Content-Security-Policy"/,
        'index must declare a progressive Content-Security-Policy meta tag'
    );
    assert.match(indexSource, /default-src 'self'/, 'CSP must default to self');
    assert.match(indexSource, /script-src 'self'/, 'CSP must restrict scripts to self');
    assert.match(indexSource, /connect-src 'self' https:/, 'CSP must allow https connect for custom proxies and CORS relays');
}

async function runWebManifestInstallabilityRegression() {
    const manifest = JSON.parse(await readFile(resolve(process.cwd(), 'manifest.json'), 'utf8'));

    assert.equal(manifest.name, '로또·연금복권 프로', 'web manifest name must be readable Korean text');
    assert.equal(manifest.short_name, '복권 프로', 'web manifest short_name must be readable Korean text');
    assert.equal(manifest.id, './index.html', 'web manifest id must pin Android app identity');
    assert.equal(manifest.scope, './', 'web manifest scope must cover the GitHub Pages subpath app shell');
    assert.equal(manifest.lang, 'ko-KR', 'web manifest must declare its Korean locale');
    assert.equal(manifest.display, 'standalone', 'web manifest must stay installable as a standalone app');
    assert.ok(
        Array.isArray(manifest.display_override) && manifest.display_override.includes('standalone'),
        'web manifest display_override must preserve standalone preference'
    );
    assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2, 'web manifest must include install icons');
    manifest.icons.forEach((icon) => {
        assert.match(icon.src || '', /^assets\/icons\/icon-\d+\.png$/, 'manifest icons must use relative assets');
        assert.match(icon.purpose || '', /maskable/, 'manifest icons must opt into Android maskable rendering');
    });
}

async function runPwaUpdateSettingsUiRegression() {
    const [indexSource, pwaInstallUpdateControlsSource] = await Promise.all([
        readFile(resolve(process.cwd(), 'index.html'), 'utf8'),
        readFile(resolve(process.cwd(), 'assets/modules/core/app/pwaInstall/updateControls.js'), 'utf8')
    ]);
    const pwaInstallSource = pwaInstallUpdateControlsSource;

    assert.match(indexSource, /id="pwaUpdateCheckBtn"/, 'settings modal must include a PWA update button');
    assert.match(indexSource, /id="pwaUpdateBadge"/, 'settings modal must include a PWA update status badge');
    assert.match(indexSource, /id="pwaCacheBadge"/, 'settings modal must include a PWA cache health badge');
    assert.match(indexSource, /id="pwaCacheNote"/, 'settings modal must include a PWA cache health note');
    assert.match(
        pwaInstallSource,
        /window\.addEventListener\('lotto:pwa-update-state'/,
        'settings UI must subscribe to PWA update state events'
    );
    assert.match(
        pwaInstallSource,
        /준비된 업데이트 적용/,
        'settings update button must switch to apply wording when an update is ready'
    );
    assert.match(pwaInstallSource, /api\.apply\(\)/, 'settings update button must apply a waiting service worker');
}

async function runServiceWorkerManifestParityRegression() {
    const manifestSource = await readFile(resolve(process.cwd(), 'assets/sw-precache-manifest.js'), 'utf8');
    const expectedManifest = await buildPrecacheManifest();

    assert.equal(
        normalizeLineEndings(manifestSource).trim(),
        normalizeLineEndings(renderManifestSource(expectedManifest)).trim(),
        'generated SW precache manifest must stay in sync with the manifest generator'
    );
    assert.match(manifestSource, /"version": "sha256-[a-f0-9]{16}"/, 'generated manifest must include a content hash');
    assert.doesNotMatch(
        manifestSource,
        /online-check\.txt/,
        'online-check probe file must stay out of the precache manifest'
    );
}

async function runServiceWorkerPrecacheReachabilityRegression() {
    const manifest = await buildPrecacheManifest();
    const entries = [...(manifest.appShell || []), ...(manifest.data || [])];

    for (const entry of entries) {
        if (entry === './') continue;
        assert.match(entry, /^\.\//, `precache entry must be a relative same-origin path: ${entry}`);
        const filePath = resolve(process.cwd(), entry.replace(/^\.\//, ''));
        const info = await stat(filePath);
        assert.equal(info.isFile(), true, `precache entry must point to an existing file: ${entry}`);
    }
}

async function runDocsDataBaselineRegression() {
    const baseline = getDataBaseline(
        JSON.parse(await readFile(resolve(process.cwd(), 'data/winning_stats.json'), 'utf8')),
        JSON.parse(await readFile(resolve(process.cwd(), 'data/pension720_stats.json'), 'utf8'))
    );
    const docs = ['README.md', 'claude.md', 'gemini.md', 'deploy_github_pages.md'];

    for (const doc of docs) {
        const source = await readFile(resolve(process.cwd(), doc), 'utf8');
        assert.equal(updateDocSource(source, baseline), source, `${doc} must match the checked-in data baseline`);
    }
}

function runSafeHtmlHelperRegression() {
    const userValue = '<img src=x onerror=alert(1)>';
    const rendered = safeHtml`<span>${userValue}</span>`;
    assert.equal(
        rendered,
        '<span>&lt;img src=x onerror=alert(1)&gt;</span>',
        'safeHtml must escape interpolated values'
    );
}

async function runHiddenAttributeStyleRegression() {
    const layoutSource = await readFile(resolve(process.cwd(), 'assets/styles/layout.css'), 'utf8');
    const htmlSource = await readFile(resolve(process.cwd(), 'index.html'), 'utf8');
    assert.match(
        layoutSource,
        /\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/,
        'hidden elements must stay visually hidden even when inline styles set display'
    );
    assert.match(
        htmlSource,
        /<div\b(?=[^>]*\bid="offlineBanner")(?=[^>]*\bhidden\b)(?=[^>]*\baria-hidden="true")/,
        'offline banner must still default to the hidden state in markup'
    );
}

async function runLocalFontPathRegression() {
    const tokensSource = await readFile(resolve(process.cwd(), 'assets/styles/tokens.css'), 'utf8');
    assert.match(
        tokensSource,
        /src:\s*url\('\.\.\/vendor\/pretendard\/PretendardVariable\.woff2'\)/,
        'Pretendard font path must stay relative to the deployed assets/styles directory'
    );
}

async function collectJsFiles(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const fullPath = resolve(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...(await collectJsFiles(fullPath)));
        } else if (entry.isFile() && /\.m?js$/.test(entry.name)) {
            files.push(fullPath);
        }
    }
    return files;
}

async function runInnerHtmlAllowlistRegression() {
    const { INNERHTML_ALLOWLIST } = await import('../../../lib/innerhtml_allowlist.mjs');
    const files = await collectJsFiles(resolve(process.cwd(), 'assets/modules'));
    const actual = {};
    for (const file of files) {
        const source = await readFile(file, 'utf8');
        const count = (source.match(/\binnerHTML\b/g) || []).length;
        if (!count) continue;
        const relativePath = relative(process.cwd(), file).replaceAll('\\', '/');
        actual[relativePath] = count;
    }

    assert.deepEqual(actual, INNERHTML_ALLOWLIST, 'innerHTML usage must stay within the reviewed per-file allowlist');
}

async function runInnerHtmlEscapeAuditRegression() {
    const { spawnSync } = await import('node:child_process');
    const result = spawnSync(process.execPath, ['scripts/check_innerhtml_escape.mjs'], {
        cwd: process.cwd(),
        encoding: 'utf8'
    });
    assert.equal(
        result.status,
        0,
        `innerHTML escape audit failed: ${result.stderr || result.stdout || 'unknown error'}`
    );
}

async function runUtf8KoreanIntegrityRegression() {
    const { spawnSync } = await import('node:child_process');
    const result = spawnSync(process.execPath, ['scripts/check_utf8_korean.mjs'], {
        cwd: process.cwd(),
        encoding: 'utf8'
    });
    assert.equal(
        result.status,
        0,
        `utf8 korean integrity check failed: ${result.stderr || result.stdout || 'unknown error'}`
    );
}

export {
    runHiddenAttributeStyleRegression,
    runInnerHtmlAllowlistRegression,
    runInnerHtmlEscapeAuditRegression,
    runLocalFontPathRegression,
    runDocsDataBaselineRegression,
    runSafeHtmlHelperRegression,
    runPwaUpdateSettingsUiRegression,
    runRuntimeAssetLocalizationRegression,
    runServiceWorkerDataNetworkFirstRegression,
    runServiceWorkerCoreDataPrecacheRegression,
    runServiceWorkerManifestParityRegression,
    runServiceWorkerPrecacheReachabilityRegression,
    runServiceWorkerReloadPolicyRegression,
    runContentSecurityPolicyMetaRegression,
    runWebManifestInstallabilityRegression,
    runUtf8KoreanIntegrityRegression
};
