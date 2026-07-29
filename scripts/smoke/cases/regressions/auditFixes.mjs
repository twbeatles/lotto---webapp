import { assert, DataManager, DataIOModule, readFile, resolve, StrategyWorkerClient, UIManager } from './support.mjs';
import {
    getRemoteDataSourceLabel,
    resolveRemoteDataSourceFromFetch,
    REMOTE_DATA_SOURCE
} from '../../../../assets/modules/core/data/dataSource.js';
import {
    buildPension720RemoteFetchCandidates,
    derivePension720ListProxyUrl,
    extractPension720ListFromPayload,
    parsePension720RemotePayload
} from '../../../../assets/modules/core/data/pension720/remoteFetch.js';
import { extractSingleDrawFromPayload } from '../../../../assets/modules/core/data/sync/lottoPayloadCore.js';

function runPension720RemoteFetchCandidateRegression() {
    assert.equal(
        derivePension720ListProxyUrl('https://worker.example/proxy/latest?draw_no=10'),
        'https://worker.example/proxy/pension720/list',
        'lotto proxy latest must derive pension720 list endpoint'
    );
    assert.equal(
        derivePension720ListProxyUrl('https://worker.example/proxy/pension720/list'),
        'https://worker.example/proxy/pension720/list',
        'existing pension720 list proxy must be preserved'
    );

    const candidates = buildPension720RemoteFetchCandidates({
        url: 'https://worker.example/proxy/latest',
        source: 'saved settings (v2)'
    });
    assert.ok(
        candidates[0]?.url?.includes('/proxy/pension720/list'),
        'custom proxy must be the first pension720 remote candidate'
    );
    assert.ok(
        candidates.some((item) => item.url.includes('corsproxy.io')),
        'builtin cors fallback must remain available for pension720'
    );

    const payload = parsePension720RemotePayload(
        JSON.stringify({ data: { result: [{ psltEpsd: 10, wnBndNo: 2, wnRnkVl: '123456', bnsRnkVl: '654321', psltRflYmd: '20260601' }] } })
    );
    const list = extractPension720ListFromPayload(payload);
    assert.equal(list.length, 1, 'remote pension720 payload parser must extract official list');
}

function runQueryProxyAckRegression() {
    const dm = new DataManager();
    dm._queryProxyRejected = 'https://worker.example/proxy/latest';
    const queryProxy = dm.buildProxyConfig('URL 쿼리(proxyUrl)', 'https://worker.example/proxy/latest');
    assert.equal(dm._isQueryProxySuppressed(queryProxy), true, 'rejected query proxy must be suppressed');
    assert.equal(
        dm.resolveProxyConfig().source,
        '미설정',
        'suppressed query proxy must fall through to default config'
    );
}

async function runQueryProxyConfirmFailClosedRegression() {
    const previousConfirm = UIManager.confirm;
    const previousToast = UIManager.toast;
    const previousSession = globalThis.sessionStorage;
    const store = new Map();
    globalThis.sessionStorage = {
        getItem(key) {
            return store.has(key) ? store.get(key) : null;
        },
        setItem(key, value) {
            store.set(String(key), String(value));
        },
        removeItem(key) {
            store.delete(String(key));
        }
    };
    const toasts = [];

    UIManager.confirm = undefined;
    UIManager.toast = (message) => {
        toasts.push(String(message || ''));
    };

    try {
        const dm = new DataManager();
        dm.getQueryProxyUrl = () =>
            dm.buildProxyConfig('URL 쿼리(proxyUrl)', 'https://worker.example/proxy/latest');

        assert.equal(typeof UIManager.confirm, 'undefined', 'test setup must clear UIManager.confirm');
        const acknowledged = await dm.ensureQueryProxyAcknowledged();
        assert.equal(acknowledged, false, 'query proxy must be rejected when confirm UI is unavailable');
        assert.equal(
            dm._isQueryProxySuppressed(dm.getQueryProxyUrl()),
            true,
            'fail-closed path must suppress the query proxy for the session'
        );
        assert.ok(
            toasts.some((message) => message.includes('URL 프록시')),
            'fail-closed path must surface a toast explaining the rejection'
        );
    } finally {
        UIManager.confirm = previousConfirm;
        UIManager.toast = previousToast;
        if (previousSession === undefined) delete globalThis.sessionStorage;
        else globalThis.sessionStorage = previousSession;
    }
}

async function runImportInFlightGuardRegression() {
    const previousToast = UIManager.toast;
    const toasts = [];
    UIManager.toast = (message) => {
        toasts.push(String(message || ''));
    };

    const ctx = {
        _importInFlight: true,
        data: { state: {} }
    };

    try {
        await DataIOModule.prototype.importAll.call(ctx, {
            currentTarget: {
                files: [{ size: 10 }],
                value: 'backup.json'
            }
        });
        assert.ok(
            toasts.some((message) => message.includes('다른 가져오기 작업이 진행 중')),
            'importAll must block duplicate imports while in flight'
        );
    } finally {
        UIManager.toast = previousToast;
    }
}

async function runStrategyWorkerQueueRegression() {
    const client = new StrategyWorkerClient();
    const order = [];
    client.ensureWorker = () => ({ postMessage() {} });
    client.postOnce = async (type) => {
        order.push(`start:${type}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push(`end:${type}`);
        return { type };
    };

    const p1 = client.post('GENERATE', { count: 1 });
    const p2 = client.post('RECOMMEND', { request: { params: { simulationCount: 1000 } } });
    await Promise.all([p1, p2]);

    assert.deepEqual(
        order,
        ['start:GENERATE', 'end:GENERATE', 'start:RECOMMEND', 'end:RECOMMEND'],
        'strategy worker requests must execute serially through the dispatch queue'
    );
}

async function runProxyWorkerPension720ListRouteRegression() {
    const source = await readFile(resolve('proxy/worker.js'), 'utf8');
    assert.match(source, /pathname === '\/proxy\/pension720\/list'/, 'proxy worker must expose pension720 list route');
    assert.match(
        source,
        /extractSingleDrawFromPayload/,
        'proxy worker must use shared lotto payload extraction helper'
    );
    assert.match(
        source,
        /extractPension720ListFromPayload/,
        'proxy worker must use shared pension720 list extraction helper'
    );
}

function runSharedLottoPayloadExtractionRegression() {
    const payload = {
        normalized: [
            {
                draw_no: 1229,
                date: '2026-06-20',
                numbers: [1, 2, 3, 4, 5, 6],
                bonus: 7
            }
        ]
    };
    const dm = new DataManager();
    assert.deepEqual(
        dm.extractSingleDrawFromPayload(payload),
        extractSingleDrawFromPayload(payload),
        'client and shared core must extract identical lotto draws'
    );
}

function runMaliciousProxyTamperedDrawRegression() {
    const dm = new DataManager();
    const duplicateMain = dm.extractSingleDrawFromPayload({
        data: {
            list: [
                {
                    ltEpsd: 999,
                    tm1WnNo: 1,
                    tm2WnNo: 1,
                    tm3WnNo: 3,
                    tm4WnNo: 4,
                    tm5WnNo: 5,
                    tm6WnNo: 6,
                    bnsWnNo: 7,
                    ltRflYmd: '20260614'
                }
            ]
        }
    });
    assert.equal(duplicateMain, null, 'tampered proxy payloads with duplicate main numbers must be rejected');

    const bonusOverlap = dm.extractSingleDrawFromPayload({
        data: {
            list: [
                {
                    ltEpsd: 999,
                    tm1WnNo: 1,
                    tm2WnNo: 2,
                    tm3WnNo: 3,
                    tm4WnNo: 4,
                    tm5WnNo: 5,
                    tm6WnNo: 6,
                    bnsWnNo: 3,
                    ltRflYmd: '20260614'
                }
            ]
        }
    });
    assert.equal(bonusOverlap, null, 'tampered proxy payloads with bonus overlap must be rejected');
}

async function runLocalStoragePartialFailureUiRegression() {
    const networkSource = await readFile(resolve('assets/modules/core/app/networkLifecycle/storageFailureBanner.js'), 'utf8');
    const indexSource = await readFile(resolve('index.html'), 'utf8');
    assert.match(networkSource, /storageFailureBanner/, 'storage failure banner wiring must exist');
    assert.match(networkSource, /getStorageWriteFailures/, 'banner must react to tracked storage failures');
    assert.match(networkSource, /hasPendingLocalPersistence/, 'banner must react to pending dirty persistence');
    assert.match(indexSource, /id="storageFailureBanner"/, 'storage failure banner must be present in app shell');

    const dm = new DataManager();
    dm._recordStorageWriteFailure('lotto_pro_fav_v2', new Error('QuotaExceededError'));
    assert.equal(dm.getStorageWriteFailures().length, 1, 'partial storage failures must remain observable');
    dm.markDirty('fav');
    assert.equal(dm.hasPendingLocalPersistence(), true, 'dirty keys must keep pending persistence state');
}

function runDataSourceAbstractionRegression() {
    assert.equal(
        getRemoteDataSourceLabel(REMOTE_DATA_SOURCE.THIRD_PARTY),
        '공개 CORS 중계',
        'remote data source labels must be centralized'
    );
    assert.equal(
        resolveRemoteDataSourceFromFetch({ providerLabel: 'corsproxy.io' }),
        REMOTE_DATA_SOURCE.THIRD_PARTY,
        'third-party provider labels must map to shared source types'
    );
    assert.equal(
        resolveRemoteDataSourceFromFetch({
            providerLabel: 'URL 쿼리(proxyUrl)',
            proxyConfig: { source: 'URL 쿼리(proxyUrl)', url: 'https://worker.example/proxy/latest' }
        }),
        REMOTE_DATA_SOURCE.CUSTOM_PROXY,
        'custom proxy labels must map to shared source types'
    );

    const dm = new DataManager();
    const merged = dm.mergePension720DataHealth({ source: 'third_party', availability: 'full', latestDrawNo: 10 });
    assert.equal(merged.source, REMOTE_DATA_SOURCE.THIRD_PARTY, 'pension720 health must accept shared source types');
}

function runOfficialApiFieldAliasRegression() {
    const dm = new DataManager();
    const lotto = dm.normalizeDrawItem({
        ltEpsd: 1229,
        tm1WnNo: 1,
        tm2WnNo: 2,
        tm3WnNo: 3,
        tm4WnNo: 4,
        tm5WnNo: 5,
        tm6WnNo: 6,
        bnsWnNo: 7,
        ltRflYmd: '20260614'
    });
    assert.equal(lotto?.draw_no, 1229, 'lotto official field aliases must normalize draw_no');

    const pension = dm.normalizePension720DrawItem({
        psltEpsd: 320,
        wnBndNo: 5,
        wnRnkVl: '766487',
        bnsRnkVl: '897760',
        psltRflYmd: '20260618'
    });
    assert.equal(pension?.draw_no, 320, 'pension720 official field aliases must normalize draw_no');
}

function runThirdPartyProxyShapeRegression() {
    const dm = new DataManager();
    const wrapped = dm.parseSyncPayload(
        'Title: corsproxy\nMarkdown Content:\n{"data":{"list":[{"ltEpsd":100,"tm1WnNo":1,"tm2WnNo":2,"tm3WnNo":3,"tm4WnNo":4,"tm5WnNo":5,"tm6WnNo":6,"bnsWnNo":7,"ltRflYmd":"20200101"}]}}'
    );
    const item = dm.extractSingleDrawFromPayload(wrapped);
    assert.equal(item?.draw_no, 100, 'markdown-wrapped third-party payloads must parse single draws');
}

function runPension720SyncMetaRegression() {
    const dm = new DataManager();
    dm.markPension720SyncSuccess({ drawNo: 320, source: REMOTE_DATA_SOURCE.OFFICIAL, providerLabel: '동행복권 공식' });
    const merged = dm.mergePension720SyncMeta(dm.state.syncMeta.pension720);
    assert.equal(merged.lastSuccessDrawNo, 320, 'pension720 sync meta must record last success draw');
    assert.equal(merged.currentSource, '동행복권 공식', 'pension720 sync meta must record current source label');

    dm.markPension720SyncFailure('브라우저 CORS 차단');
    const failed = dm.mergePension720SyncMeta(dm.state.syncMeta.pension720);
    assert.match(failed.lastFailureMessage, /CORS/, 'pension720 sync meta must record failure reason');
}

export {
    runPension720RemoteFetchCandidateRegression,
    runQueryProxyAckRegression,
    runQueryProxyConfirmFailClosedRegression,
    runImportInFlightGuardRegression,
    runStrategyWorkerQueueRegression,
    runProxyWorkerPension720ListRouteRegression,
    runDataSourceAbstractionRegression,
    runOfficialApiFieldAliasRegression,
    runThirdPartyProxyShapeRegression,
    runPension720SyncMetaRegression,
    runSharedLottoPayloadExtractionRegression,
    runMaliciousProxyTamperedDrawRegression,
    runLocalStoragePartialFailureUiRegression
};