/* eslint-disable no-unused-vars */
import {
    assert,
    compareLottoOfficialFreshness,
    createDocumentStub,
    createField,
    DataManager,
    estimateLatestDrawKST,
    fetchOfficialDraw,
    LottoApp,
    readFile,
    resolve
} from '../support.mjs';
import { buildBuiltinCorsFetchUrls } from '../../../../../assets/modules/core/data/sync/builtinProviders.js';
import {
    classifyCorsRelayFailure,
    inspectCorsproxyCandidate,
    isCurrentCorsproxyUrl,
    isLegacyCorsproxyUrl
} from '../../../../lib/corsRelayContract.mjs';

async function runSyncInvalidPayloadRegression() {
    const dm = new DataManager();

    const syncLogs = [];

    const uiLogs = [];

    dm.buildCustomSingleFetchUrls = () => [
        {
            label: 'test-proxy',

            url: 'https://proxy.example/proxy/latest?draw_no=1210'
        }
    ];

    dm.buildBuiltInSingleFetchUrls = () => [];

    dm.fetchWithTimeout = async () => ({
        ok: true,

        async text() {
            return JSON.stringify({ foo: 'bar', meta: { ok: true } });
        }
    });

    dm.logSync = (code, message, meta = null) => {
        syncLogs.push({ code, message, meta });
    };

    const result = await dm.fetchOneDraw(1210, { url: 'https://proxy.example/proxy/latest' }, (message, code, meta) => {
        uiLogs.push({ message, code, meta });
    });

    assert.equal(result, null, 'unexpected payload shape must not be accepted as draw data');

    assert.ok(
        syncLogs.some((entry) => entry.code === 'SYNC_FETCH_ONE_INVALID_PAYLOAD'),

        'unexpected payload shape must emit a sync diagnostic log'
    );

    assert.ok(
        uiLogs.some((entry) => entry.code === 'SYNC_FETCH_ONE_INVALID_PAYLOAD'),

        'unexpected payload shape must surface through sync log callback'
    );
}

function runSyncPayloadDrawIntegerGuardRegression() {
    const dm = new DataManager();

    assert.equal(
        dm.normalizeDrawItem({
            draw_no: 1210.5,

            date: '2026-02-07',

            numbers: [1, 2, 3, 4, 5, 6],

            bonus: 7
        }),

        null,

        'decimal draw_no must be rejected'
    );

    assert.equal(
        dm.normalizeDrawItem({
            ltEpsd: '1211.5',

            ltRflYmd: '20260214',

            tm1WnNo: 1,

            tm2WnNo: 2,

            tm3WnNo: 3,

            tm4WnNo: 4,

            tm5WnNo: 5,

            tm6WnNo: 6,

            bnsWnNo: 7
        }),

        null,

        'decimal official ltEpsd must be rejected'
    );

    assert.equal(
        dm.sanitizeLocalUpdates([
            {
                draw_no: 1212.5,

                date: '2026-02-21',

                numbers: [1, 2, 3, 4, 5, 6],

                bonus: 7
            }
        ]).droppedInvalid,

        1,

        'decimal local update draw numbers must be dropped as invalid'
    );
}

function runMalformedDrawDateRejectedRegression() {
    const dm = new DataManager();

    assert.equal(
        dm.normalizeDrawItem({
            draw_no: 1210,

            date: '<img src=x onerror=alert(1)>',

            numbers: [1, 2, 3, 4, 5, 6],

            bonus: 7
        }),

        null,

        'draw date must reject non-YYYY-MM-DD text'
    );

    assert.equal(
        dm.normalizeDrawItem({
            draw_no: 1210,

            date: '2026-02-31',

            numbers: [1, 2, 3, 4, 5, 6],

            bonus: 7
        }),

        null,

        'draw date must reject impossible calendar dates'
    );

    assert.deepEqual(
        dm.normalizeDrawItem({
            ltEpsd: 1210,

            ltRflYmd: '20260425',

            tm1WnNo: 1,

            tm2WnNo: 2,

            tm3WnNo: 3,

            tm4WnNo: 4,

            tm5WnNo: 5,

            tm6WnNo: 6,

            bnsWnNo: 7
        })?.date,

        '2026-04-25',

        'official 8-digit dates must normalize to YYYY-MM-DD'
    );
}

function runBuiltInSyncProviderRegression() {
    const dm = new DataManager();

    const urls = dm.buildBuiltInSingleFetchUrls(1215);

    assert.equal(urls[0]?.label, '공식 API', 'Node/script built-in sync may try the official API first');

    assert.match(
        urls[0]?.url || '',
        /https:\/\/www\.dhlottery\.co\.kr\/lt645\/selectPstLt645Info\.do\?srchLtEpsd=1215/,
        'official API candidate must target the requested draw number directly'
    );

    const corsproxy = urls.find((item) => item.label === 'corsproxy.io');
    assert.ok(corsproxy, 'built-in sync must keep corsproxy.io as a fallback provider');
    assert.equal(
        isCurrentCorsproxyUrl(corsproxy?.url || ''),
        true,
        'corsproxy.io must use the current ?url= API (legacy ?<encoded-url> is rejected as keyless_legacy_url)'
    );
    assert.equal(
        isLegacyCorsproxyUrl(corsproxy?.url || ''),
        false,
        'built-in corsproxy.io candidate must not keep the rejected legacy URL form'
    );
    assert.equal(inspectCorsproxyCandidate(corsproxy).ok, true, 'corsproxy.io candidate must pass the relay contract');

    assert.ok(
        urls.some((item) => item.label === 'CodeTabs'),
        'built-in sync may still keep CodeTabs as a last fallback provider'
    );

    const browserSafe = buildBuiltinCorsFetchUrls(
        'https://www.dhlottery.co.kr/lt645/selectPstLt645Info.do?srchLtEpsd=1215',
        { includeDirectOfficial: false }
    );
    assert.equal(
        browserSafe.some((item) => item.label === '공식 API'),
        false,
        'browser-safe built-in list must skip the direct official API candidate'
    );
    const browserCorsproxy = browserSafe.find((item) => item.label === 'corsproxy.io');
    assert.ok(browserCorsproxy, 'browser-safe built-in list must keep corsproxy.io');
    assert.match(
        browserCorsproxy?.url || '',
        /^https:\/\/corsproxy\.io\/\?url=/,
        'browser-safe corsproxy.io candidate must use the current ?url= API'
    );

    assert.equal(dm.isAbortError(dm.createAbortError()), true, 'explicit sync abort errors must still be recognized');

    assert.equal(
        dm.isAbortError({ name: 'TypeError', message: 'net::ERR_ABORTED' }),
        false,
        'generic provider failures must not be misclassified as user aborts'
    );

    const timeoutErr = dm.createTimeoutError(4500);
    assert.equal(timeoutErr.name, 'TimeoutError', 'sync timeout errors must use TimeoutError name');
    assert.equal(timeoutErr.code, 'SYNC_FETCH_TIMEOUT', 'sync timeout errors must carry SYNC_FETCH_TIMEOUT');
    assert.equal(dm.isTimeoutError(timeoutErr), true, 'createTimeoutError must be recognized as a timeout');
    assert.equal(
        dm.isAbortError(timeoutErr),
        false,
        'request timeouts must not be misclassified as user sync aborts'
    );
}

function runCorsRelayContractRegression() {
    const officialTarget = 'https://www.dhlottery.co.kr/lt645/selectPstLt645Info.do?srchLtEpsd=1215';
    const current = `https://corsproxy.io/?url=${encodeURIComponent(officialTarget)}`;
    const legacy = `https://corsproxy.io/?${encodeURIComponent(officialTarget)}`;

    assert.equal(isCurrentCorsproxyUrl(current), true, 'current corsproxy.io URL must match ?url=');
    assert.equal(isLegacyCorsproxyUrl(legacy), true, 'legacy corsproxy.io ?<encoded-url> must be detected');
    assert.equal(
        inspectCorsproxyCandidate({ label: 'corsproxy.io', url: legacy }).kind,
        'contract',
        'legacy corsproxy.io URL must fail the relay contract before any network call'
    );

    const legacyHttp = classifyCorsRelayFailure({
        status: 403,
        body: JSON.stringify({
            success: false,
            status: 403,
            error: 'keyless_legacy_url',
            message: 'Anonymous legacy proxy URLs are no longer supported.'
        }),
        url: legacy
    });
    assert.equal(legacyHttp.kind, 'contract', 'keyless_legacy_url must be a hard contract failure, not a flake');

    const unavailable = classifyCorsRelayFailure({ status: 503, body: 'Service Unavailable', url: current });
    assert.equal(unavailable.kind, 'unavailable', 'relay 503 must classify as unavailable for scheduled defer');

    const serverSide = classifyCorsRelayFailure({
        status: 403,
        body: JSON.stringify({ error: 'Server-side requests are not allowed on your plan. Upgrade at https://corsproxy.io/pricing/' }),
        url: current
    });
    assert.equal(
        serverSide.kind,
        'origin_policy',
        'Node/server corsproxy.io probes must not be treated as a URL-contract break'
    );
}

function runCorsRelayProviderSourceRegression() {
    return readFile(resolve(process.cwd(), 'assets/modules/core/data/sync/builtinProviders.js'), 'utf8').then(
        (source) => {
            assert.match(
                source,
                /https:\/\/corsproxy\.io\/\?url=\$\{encodeURIComponent/,
                'builtinProviders.js must keep the corsproxy.io ?url= template'
            );
            assert.equal(
                /corsproxy\.io\/\?\$\{encodeURIComponent/.test(source),
                false,
                'builtinProviders.js must not rebuild the legacy corsproxy.io ?<encoded-url> form'
            );
        }
    );
}

/**
 * Timeout AbortController aborts must not look like user cancel, and must allow the next
 * built-in/CORS candidate to run (same class of bug that broke scheduled CI defer).
 */
async function runSyncFetchTimeoutAbortClassificationRegression() {
    const dm = new DataManager();
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;

    globalThis.fetch = async (_url, options = {}) => {
        fetchCalls += 1;
        const call = fetchCalls;
        return new Promise((resolve, reject) => {
            const signal = options.signal;
            if (signal?.aborted) {
                const err = new Error('This operation was aborted');
                err.name = 'AbortError';
                reject(err);
                return;
            }
            const onAbort = () => {
                const err = new Error('This operation was aborted');
                err.name = 'AbortError';
                reject(err);
            };
            signal?.addEventListener('abort', onAbort, { once: true });

            // First candidate hangs until client timeout; second responds successfully.
            if (call === 1) return;

            setTimeout(() => {
                signal?.removeEventListener('abort', onAbort);
                resolve({
                    ok: true,
                    text: async () =>
                        JSON.stringify({
                            draw_no: 1215,
                            date: '2026-05-10',
                            numbers: [1, 2, 3, 4, 5, 6],
                            bonus: 7
                        })
                });
            }, 5);
        });
    };

    try {
        await assert.rejects(
            () => dm.fetchWithTimeout('https://example.test/hang', {}, 30),
            (error) => {
                assert.equal(error?.name, 'TimeoutError', 'fetchWithTimeout must remap timer aborts to TimeoutError');
                assert.equal(error?.code, 'SYNC_FETCH_TIMEOUT', 'fetchWithTimeout timeout must set SYNC_FETCH_TIMEOUT');
                assert.equal(dm.isAbortError(error), false, 'timeout errors must not be treated as cancel');
                return true;
            }
        );

        const external = new AbortController();
        const pending = dm.fetchWithTimeout('https://example.test/cancel', {}, 5000, external.signal);
        external.abort();
        await assert.rejects(
            () => pending,
            (error) => {
                assert.equal(dm.isAbortError(error), true, 'external abort signal must remain a sync cancel');
                assert.match(String(error?.message || ''), /Sync aborted/, 'external abort must use Sync aborted');
                return true;
            }
        );

        dm.buildCustomSingleFetchUrls = () => [
            { label: 'hang-proxy', url: 'https://proxy.example/hang?draw=1215' }
        ];
        dm.buildBuiltInSingleFetchUrls = () => [
            { label: 'fallback', url: 'https://proxy.example/fallback?draw=1215' }
        ];
        dm.SYNC_FETCH_TIMEOUT_MS = 40;

        fetchCalls = 0;
        const item = await dm.fetchOneDraw(1215, { url: '', source: 'built-in' });
        assert.ok(item, 'fetchOneDraw must continue to the next candidate after a timeout');
        assert.equal(fetchCalls, 2, 'fetchOneDraw must attempt the fallback provider after timeout');
        assert.equal(Number(item.draw_no), 1215, 'fallback candidate payload must normalize to the requested draw');
    } finally {
        globalThis.fetch = originalFetch;
    }
}

async function runSyncFetchHttpErrorContinuesRegression() {
    const dm = new DataManager();
    const originalFetch = globalThis.fetch;
    const logs = [];

    globalThis.fetch = async (url) => {
        if (String(url).includes('forbidden')) {
            return {
                ok: false,
                status: 403,
                text: async () => JSON.stringify({ error: 'keyless_legacy_url' })
            };
        }
        return {
            ok: true,
            status: 200,
            text: async () =>
                JSON.stringify({
                    draw_no: 1215,
                    date: '2026-05-10',
                    numbers: [1, 2, 3, 4, 5, 6],
                    bonus: 7
                })
        };
    };

    try {
        dm.buildCustomSingleFetchUrls = () => [];
        dm.buildBuiltInSingleFetchUrls = () => [
            { label: 'corsproxy.io', url: 'https://corsproxy.io/?forbidden' },
            { label: 'fallback', url: 'https://proxy.example/fallback?draw=1215' }
        ];

        const item = await dm.fetchOneDraw(1215, { url: '', source: 'built-in' }, (message, code, meta) => {
            logs.push({ message, code, meta });
        });
        assert.equal(Number(item?.draw_no), 1215, 'fetchOneDraw must continue to the next candidate after HTTP 403');
        assert.ok(
            logs.some((entry) => entry.code === 'SYNC_FETCH_ONE_HTTP' && Number(entry.meta?.status) === 403),
            'HTTP 403 must be logged instead of failing silently'
        );
    } finally {
        globalThis.fetch = originalFetch;
    }
}

async function runSyncThirdPartyProviderNoticeRegression() {
    const rangeSource = await readFile(
        resolve(process.cwd(), 'assets/modules/core/data/sync/range/fetchSingle.js'),
        'utf8'
    );
    assert.match(
        rangeSource,
        /SYNC_THIRD_PARTY_PROVIDER/,
        'single-draw sync must log when a third-party provider is used'
    );
    assert.match(
        rangeSource,
        /candidate\.label !== '공식 API'/,
        'third-party sync notice must skip the official API label'
    );
    assert.match(
        rangeSource,
        /SYNC_FETCH_ONE_HTTP/,
        'single-draw sync must log non-OK HTTP statuses instead of skipping silently'
    );
}

export {
    runSyncInvalidPayloadRegression,
    runSyncPayloadDrawIntegerGuardRegression,
    runMalformedDrawDateRejectedRegression,
    runBuiltInSyncProviderRegression,
    runCorsRelayContractRegression,
    runCorsRelayProviderSourceRegression,
    runSyncFetchTimeoutAbortClassificationRegression,
    runSyncFetchHttpErrorContinuesRegression,
    runSyncThirdPartyProviderNoticeRegression
};
