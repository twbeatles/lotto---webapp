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

    assert.ok(
        urls.some((item) => item.label === 'corsproxy.io'),
        'built-in sync must keep corsproxy.io as a fallback provider'
    );

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
    assert.ok(
        browserSafe.some((item) => item.label === 'corsproxy.io'),
        'browser-safe built-in list must keep corsproxy.io'
    );

    assert.equal(dm.isAbortError(dm.createAbortError()), true, 'explicit sync abort errors must still be recognized');

    assert.equal(
        dm.isAbortError({ name: 'TypeError', message: 'net::ERR_ABORTED' }),
        false,
        'generic provider failures must not be misclassified as user aborts'
    );
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
}

export {
    runSyncInvalidPayloadRegression,
    runSyncPayloadDrawIntegerGuardRegression,
    runMalformedDrawDateRejectedRegression,
    runBuiltInSyncProviderRegression,
    runSyncThirdPartyProviderNoticeRegression
};
