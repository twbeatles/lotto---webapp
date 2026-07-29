/* eslint-disable no-unused-vars */
import {
    assert,
    compareLottoOfficialFreshness,
    createDocumentStub,
    createField,
    DataManager,
    estimateLatestDrawKST,
    fetchOfficialDraw,
    isRetriableOfficialFetchError,
    LottoApp,
    readFile,
    resolve
} from '../support.mjs';
import proxyWorker, {
    estimateLatestDrawKST as estimateLatestProxyDrawKST,
    getMaxAllowedDrawNo,
    isAllowedDhlotteryProxyPath,
    isAllowedProxyDrawNo,
    MAX_FUTURE_DRAW_SLACK,
    resolveCorsHeaders
} from '../../../../../proxy/worker.js';

async function runStaticDataFreshnessBudgetRegression() {
    const raw = await readFile(resolve(process.cwd(), 'data/winning_stats.json'), 'utf8');

    const items = JSON.parse(raw);

    const maxDrawNo = Math.max(...items.map((item) => Number(item?.draw_no || 0)).filter(Number.isFinite));

    const estimatedLatestDrawNo = estimateLatestDrawKST();

    const staleBudgetDraws = 2;

    assert.ok(
        estimatedLatestDrawNo - maxDrawNo <= staleBudgetDraws,

        `static winning data must be within ${staleBudgetDraws} draws of estimated latest draw`
    );
}

function runEstimateLatestDrawKstBoundaryRegression() {
    assert.equal(
        estimateLatestDrawKST(new Date(Date.UTC(2026, 4, 23, 21, 4, 0))),

        1224,

        'Saturday 21:04 KST must still report the previous Lotto draw during publish grace'
    );

    assert.equal(
        estimateLatestDrawKST(new Date(Date.UTC(2026, 4, 23, 21, 5, 0))),

        1225,

        'Saturday 21:05 KST must advance to the new Lotto draw after publish grace'
    );

    assert.equal(
        estimateLatestDrawKST(new Date(Date.UTC(2026, 4, 24, 0, 0, 0))),

        1225,

        'Sunday 00:00 KST must keep the newly published Lotto draw'
    );
}

function runLottoOfficialFreshnessComparisonRegression() {
    const localLatest = {
        draw_no: 10,

        date: '2026-05-16',

        numbers: [1, 2, 3, 4, 5, 6],

        bonus: 7,

        prize_amount: 1000,

        winners_count: 1,

        total_sales: 9000
    };

    const matching = compareLottoOfficialFreshness([localLatest], [{ ...localLatest }], {
        estimatedLatestDrawNo: 10
    });

    assert.equal(matching.ok, true, 'matching official latest draw fields must pass');

    const correctedOfficial = compareLottoOfficialFreshness(
        [localLatest],

        [
            {
                ...localLatest,

                numbers: [2, 3, 4, 5, 6, 8],

                bonus: 9
            }
        ],

        { estimatedLatestDrawNo: 10 }
    );

    assert.equal(correctedOfficial.ok, false, 'official row field mismatches must fail');

    assert.ok(
        correctedOfficial.issues.some((issue) => issue.includes('numbers mismatch')),

        'official mismatch report must identify number drift'
    );

    const estimatedBehind = compareLottoOfficialFreshness([localLatest], [{ ...localLatest }], {
        estimatedLatestDrawNo: 11
    });

    assert.equal(estimatedBehind.ok, false, 'estimated latest draw drift must still fail');

    assert.ok(
        estimatedBehind.issues.some((issue) => issue.includes('estimated latest draw 11')),

        'estimated drift report must identify the estimated latest draw'
    );
}

async function runLottoOfficialFetchRetryRegression() {
    let attempts = 0;

    const draw = {
        draw_no: 10,

        date: '2026-05-16',

        numbers: [1, 2, 3, 4, 5, 6],

        bonus: 7,

        prize_amount: 1000,

        winners_count: 1,

        total_sales: 9000
    };

    const result = await fetchOfficialDraw(10, {
        retries: 1,

        retryDelayMs: 0,

        dmFactory: () => ({
            async fetchOneDraw(_drawNo, _proxyConfig, log) {
                attempts += 1;

                log('attempt', 'TEST_ATTEMPT', { attempts });

                if (attempts === 1) throw new TypeError('socket closed');

                return draw;
            }
        })
    });

    assert.equal(attempts, 2, 'official Lotto fetch must retry transient failures');

    assert.equal(result.item.draw_no, 10, 'official Lotto retry must return the fetched draw');

    assert.equal(result.attempts, 2, 'official Lotto fetch must expose retry attempts');

    await assert.rejects(
        () =>
            fetchOfficialDraw(11, {
                retries: 1,

                retryDelayMs: 0,

                dmFactory: () => ({
                    async fetchOneDraw() {
                        return null;
                    }
                })
            }),

        /after 2 attempt/,

        'official Lotto fetch must fail when all retry attempts return no draw'
    );
}

async function runProxyWorkerDrawScheduleAndFutureCapRegression() {
    const beforePublishGrace = new Date(Date.UTC(2026, 4, 23, 21, 4, 0));
    const afterPublishGrace = new Date(Date.UTC(2026, 4, 23, 21, 5, 0));

    assert.equal(
        estimateLatestProxyDrawKST(beforePublishGrace),
        estimateLatestDrawKST(beforePublishGrace),
        'proxy worker must use the app Lotto draw schedule before publish grace ends'
    );
    assert.equal(
        estimateLatestProxyDrawKST(afterPublishGrace),
        estimateLatestDrawKST(afterPublishGrace),
        'proxy worker must use the app Lotto draw schedule after publish grace ends'
    );
    assert.equal(MAX_FUTURE_DRAW_SLACK, 1, 'proxy worker must allow only one future draw slack');

    const maxAtBoundary = getMaxAllowedDrawNo(afterPublishGrace);
    assert.equal(isAllowedProxyDrawNo(maxAtBoundary, afterPublishGrace), true, 'latest+1 draw must be accepted');
    assert.equal(
        isAllowedProxyDrawNo(maxAtBoundary + 1, afterPublishGrace),
        false,
        'latest+2 draw must be rejected'
    );

    const currentMax = getMaxAllowedDrawNo();
    const single = await proxyWorker.fetch(
        new Request(`https://worker.example/proxy/latest?draw_no=${currentMax + 1}`)
    );
    assert.equal(single.status, 400, 'far-future single draw must be rejected before upstream fetch');
    const singlePayload = await single.json();
    assert.equal(singlePayload.maxDrawNo, currentMax, 'single-draw rejection must report the max allowed draw');

    const range = await proxyWorker.fetch(
        new Request(`https://worker.example/proxy/range?from=${currentMax + 1}&to=${currentMax + 1}`)
    );
    assert.equal(range.status, 400, 'far-future range draw must be rejected before upstream fetch');
    const rangePayload = await range.json();
    assert.equal(rangePayload.maxDrawNo, currentMax, 'range rejection must report the max allowed draw');
}

async function runProxyWorkerUrlPassthroughPathAllowlistRegression() {
    assert.equal(isAllowedDhlotteryProxyPath('/lt645/selectPstLt645Info.do'), true, 'lt645 paths must be allowed');
    assert.equal(isAllowedDhlotteryProxyPath('/pt720/selectPstPt720WnList.do'), true, 'pt720 paths must be allowed');
    assert.equal(isAllowedDhlotteryProxyPath('/other/secret'), false, 'unrelated paths must be rejected');

    const blocked = await proxyWorker.fetch(
        new Request(
            'https://worker.example/?url=' +
                encodeURIComponent('https://www.dhlottery.co.kr/gameResult.do?method=byWin')
        )
    );
    assert.equal(blocked.status, 403, 'non-allowlisted dhlottery paths must return 403');
    const payload = await blocked.json();
    assert.equal(payload.error, 'Forbidden path', 'path rejection payload must name the policy');
}

function runProxyWorkerCorsOriginAllowlistRegression() {
    const open = resolveCorsHeaders(new Request('https://worker.example/proxy/latest'), {});
    assert.equal(open['Access-Control-Allow-Origin'], '*', 'default CORS must remain open for compatibility');

    const allowed = resolveCorsHeaders(
        new Request('https://worker.example/proxy/latest', {
            headers: { Origin: 'https://twbeatles.github.io' }
        }),
        { CORS_ALLOWED_ORIGINS: 'https://twbeatles.github.io,https://example.com' }
    );
    assert.equal(
        allowed['Access-Control-Allow-Origin'],
        'https://twbeatles.github.io',
        'configured allowlist must echo a matching Origin'
    );

    const denied = resolveCorsHeaders(
        new Request('https://worker.example/proxy/latest', {
            headers: { Origin: 'https://evil.example' }
        }),
        { CORS_ALLOWED_ORIGINS: 'https://twbeatles.github.io' }
    );
    assert.equal(
        denied['Access-Control-Allow-Origin'],
        undefined,
        'disallowed Origin must not receive Access-Control-Allow-Origin'
    );
}

function runLottoOfficialFetchWrappedErrorRegression() {
    const timeout = new TypeError('fetch failed');
    timeout.cause = { code: 'UND_ERR_CONNECT_TIMEOUT' };

    const wrapped = new Error('official lotto draw 10 could not be fetched after 3 attempt(s): fetch failed', {
        cause: timeout
    });

    const loggedTimeout = new Error('official lotto draw 10 could not be fetched after 3 attempt(s): no payload');
    loggedTimeout.logs = [
        {
            code: 'SYNC_FETCH_ONE_FAIL',
            meta: { message: 'fetch failed' }
        }
    ];

    const malformedJson = new Error('official lotto draw 10 could not be fetched after 1 attempt(s): bad json', {
        cause: new SyntaxError('Unexpected token')
    });
    malformedJson.logs = [
        {
            code: 'SYNC_FETCH_ONE_INVALID_PAYLOAD',
            meta: { keys: ['foo'] }
        }
    ];

    assert.equal(
        isRetriableOfficialFetchError(wrapped),
        true,
        'wrapped Lotto timeout must be classified as retriable for scheduled CI defer'
    );

    assert.equal(
        isRetriableOfficialFetchError(loggedTimeout),
        true,
        'logged Lotto provider fetch failures must be classified as retriable for scheduled CI defer'
    );

    assert.equal(
        isRetriableOfficialFetchError(malformedJson),
        false,
        'malformed Lotto official payload must not be treated as a deferred network outage'
    );
}

export {
    runStaticDataFreshnessBudgetRegression,
    runEstimateLatestDrawKstBoundaryRegression,
    runProxyWorkerDrawScheduleAndFutureCapRegression,
    runProxyWorkerUrlPassthroughPathAllowlistRegression,
    runProxyWorkerCorsOriginAllowlistRegression,
    runLottoOfficialFreshnessComparisonRegression,
    runLottoOfficialFetchRetryRegression,
    runLottoOfficialFetchWrappedErrorRegression
};
