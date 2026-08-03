import {
    assert,
    buildBackupPayload,
    DataManager,
    normalizeBackupPayload,
    Pension720Module,
    Pension720Engine,
    readFile,
    resolve,
    UIManager
} from './support.mjs';
import { buildPrecacheManifest } from '../../../generate_sw_manifest.mjs';
import {
    comparePension720Freshness,
    fetchOfficialPayload,
    isRetriableOfficialFetchError
} from '../../../fetch_pension720_stats.mjs';

function makeSamplePensionStats() {
    return [
        {
            draw_no: 3,
            date: '2026-05-14',
            group: 2,
            digits: [5, 3, 7, 5, 3, 0],
            number: '537530',
            bonus_digits: [3, 5, 8, 1, 2, 7],
            bonus_number: '358127'
        },
        {
            draw_no: 2,
            date: '2026-05-07',
            group: 2,
            digits: [0, 6, 0, 7, 2, 7],
            number: '060727',
            bonus_digits: [2, 9, 3, 1, 6, 0],
            bonus_number: '293160'
        },
        {
            draw_no: 1,
            date: '2026-04-30',
            group: 5,
            digits: [7, 2, 6, 4, 9, 3],
            number: '726493',
            bonus_digits: [8, 8, 2, 0, 3, 3],
            bonus_number: '882033'
        }
    ];
}

function runPension720NormalizationRegression() {
    const dm = new DataManager();
    const normalized = dm.normalizePension720DrawItem({
        psltEpsd: 314,
        psltRflYmd: '20260507',
        wnBndNo: '2',
        wnRnkVl: '060727',
        bnsRnkVl: '293160'
    });

    assert.equal(normalized.draw_no, 314, 'pension720 draw number must normalize');
    assert.equal(normalized.date, '2026-05-07', 'pension720 yyyymmdd date must normalize');
    assert.equal(normalized.group, 2, 'pension720 group must normalize');
    assert.equal(normalized.number, '060727', 'pension720 primary number must preserve leading zero');
    assert.deepEqual(normalized.digits, [0, 6, 0, 7, 2, 7], 'pension720 digits must include zeroes');
    assert.equal(
        dm.normalizePension720DrawItem({ ...normalized, group: 6 }),
        null,
        'invalid pension720 group rejected'
    );
}

function runPension720RecommendationRegression() {
    const engine = new Pension720Engine(makeSamplePensionStats());
    const first = engine.recommend({ setCount: 3, profile: 'basic', seed: 720 });
    const second = engine.recommend({ setCount: 3, profile: 'basic', seed: 720 });

    assert.equal(first.length, 3, 'pension720 recommendation must return requested count');
    assert.deepEqual(first, second, 'pension720 seeded recommendation must be reproducible');
    first.forEach((item) => {
        assert.match(item.number, /^\d{6}$/, 'pension720 recommendation must be a six-digit string');
        assert.ok(item.group >= 1 && item.group <= 5, 'pension720 recommendation group must be in range');
        assert.ok(Array.isArray(item.expansionGroups), 'pension720 recommendation must expose expansion groups');
    });
}

function runPension720AdvancedRecommendationRegression() {
    const engine = new Pension720Engine(makeSamplePensionStats());
    const request = {
        strategyId: 'trailing_match',
        params: {
            seed: 720,
            lookbackWindow: 3,
            candidatePoolSize: 80
        },
        filters: {
            groups: [2],
            fixedDigits: [0, null, null, null, null, null],
            excludedDigitsByPosition: [[], [9], [], [], [], []],
            digitSumRange: [5, 40],
            uniqueDigitMin: 2,
            maxSameDigit: 3
        }
    };
    const first = engine.recommend({ setCount: 2, request });
    const second = engine.recommend({ setCount: 2, request });
    const bonusFlow = engine.recommend({
        setCount: 1,
        request: {
            ...request,
            strategyId: 'bonus_flow',
            filters: { groups: [2] }
        }
    });

    assert.equal(first.length, 2, 'advanced pension720 recommendation must return requested count');
    assert.deepEqual(first, second, 'advanced pension720 recommendation must be seeded');
    first.forEach((item) => {
        assert.equal(item.group, 2, 'pension720 group filter must be applied');
        assert.match(item.number, /^0/, 'pension720 fixed digit filter must be applied');
        assert.notEqual(item.digits[1], 9, 'pension720 excluded digit filter must be applied');
        assert.equal(item.strategyId, 'trailing_match', 'pension720 recommendation must expose strategy id');
    });
    assert.equal(bonusFlow[0]?.strategyId, 'bonus_flow', 'bonus-flow strategy must be selectable');
    assert.ok(Array.isArray(bonusFlow[0]?.reasons), 'bonus-flow strategy must expose reasons');
}

function runPension720TicketDedupeRegression() {
    const dm = new DataManager();
    dm.save = () => {};

    const first = dm.addPension720Ticket({ group: 2, number: '060727', source: 'recommendation' });
    const second = dm.addPension720Ticket({ group: 2, number: '060727', source: 'recommendation' });
    const sameNumberNextDraw = dm.addPension720Ticket({
        group: 2,
        number: '060727',
        targetDrawNo: 316,
        source: 'campaign'
    });
    const bulk = dm.addPension720TicketsBulk([
        { group: 1, number: '060727', source: 'recommendation' },
        { group: 2, number: '060727', source: 'recommendation' },
        { group: 3, number: '060727', source: 'recommendation' }
    ]);

    assert.equal(first.inserted, true, 'first pension720 save must insert');
    assert.equal(second.duplicate, true, 'duplicate pension720 save must be reported');
    assert.equal(sameNumberNextDraw.inserted, true, 'target draw must participate in pension720 dedupe');
    assert.equal(bulk.inserted, 2, 'pension720 expansion save must dedupe existing group/number');
    assert.equal(bulk.duplicate, 1, 'pension720 expansion save must report existing duplicate group/number');
    assert.equal(bulk.truncated, 0, 'pension720 expansion save must not report truncation under cap');
    assert.equal(dm.state.pension720Tickets.length, 4, 'pension720 tickets must keep unique target/group/number rows');
}

function runPension720TicketCapRegression() {
    const dm = new DataManager();
    dm.save = () => {};
    dm.state.pension720Tickets = Array.from({ length: 1000 }, (_, index) => ({
        id: `old_${index}`,
        group: (index % 5) + 1,
        number: String(index).padStart(6, '0'),
        source: 'recommendation',
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString()
    }));

    const result = dm.addPension720TicketsBulk([
        { group: 5, number: '999999', source: 'recommendation', createdAt: '2026-05-15T00:00:00.000Z' },
        { group: 1, number: '000000', source: 'recommendation', createdAt: '2026-05-15T00:00:01.000Z' }
    ]);

    assert.equal(result.inserted, 1, 'pension720 bulk save must count accepted new keys at cap');
    assert.equal(result.duplicate, 1, 'pension720 bulk save must report existing duplicate keys at cap');
    assert.equal(result.truncated, 1, 'pension720 bulk save must report cap truncation');
    assert.equal(dm.state.pension720Tickets.length, 1000, 'pension720 bulk save must keep max ticket cap');
    assert.ok(
        dm.state.pension720Tickets.some((ticket) => ticket.number === '999999'),
        'accepted new pension720 ticket must be retained'
    );
}

function runPension720CampaignRegression() {
    const dm = new DataManager();
    dm.save = () => {};

    const campaign = dm.addPension720Campaign({
        id: 'p720_campaign_test',
        name: '테스트 캠페인',
        startDrawNo: 316,
        weeks: 2,
        setsPerDraw: 1
    });
    const bulk = dm.addPension720TicketsBulk([
        { group: 2, number: '060727', targetDrawNo: 316, campaignId: campaign.id, source: 'campaign' },
        { group: 2, number: '060727', targetDrawNo: 317, campaignId: campaign.id, source: 'campaign' },
        { group: 2, number: '060727', targetDrawNo: 317, campaignId: campaign.id, source: 'campaign' }
    ]);

    assert.ok(campaign, 'pension720 campaign must normalize and save');
    assert.equal(bulk.inserted, 2, 'pension720 campaign tickets must keep per-draw rows');
    assert.equal(bulk.duplicate, 1, 'pension720 campaign ticket duplicate must be counted');
    assert.equal(
        dm.countPension720TicketsByCampaignId(campaign.id),
        2,
        'pension720 campaign count must use linked tickets'
    );

    const removed = dm.removePension720Campaign(campaign.id, { cascadeTickets: true });
    assert.equal(removed.removedCampaign, true, 'pension720 campaign delete must remove campaign');
    assert.equal(removed.removedTickets, 2, 'pension720 campaign delete must cascade linked tickets');
    assert.equal(dm.state.pension720Tickets.length, 0, 'pension720 campaign delete must clear linked tickets');
}

function runPension720BackupV5Regression() {
    const payload = buildBackupPayload({
        theme: 'dark',
        pension720Tickets: [
            { id: 'p720_a', group: 2, number: '060727', targetDrawNo: 316, campaignId: 'p720_camp_a' },
            { id: 'p720_b', group: 2, number: '060727', targetDrawNo: 316, campaignId: 'p720_camp_a' },
            { id: 'p720_c', group: 2, number: '060727', targetDrawNo: 317, campaignId: 'p720_camp_a' }
        ],
        pension720Campaigns: [
            {
                id: 'p720_camp_a',
                name: '연금 캠페인',
                startDrawNo: 316,
                weeks: 2,
                setsPerDraw: 1
            }
        ]
    });
    const normalizedV5 = normalizeBackupPayload(payload);
    const normalizedV4 = normalizeBackupPayload({ ...payload, version: 4, pension720Campaigns: undefined });
    const normalizedV3 = normalizeBackupPayload({ ...payload, version: 3, pension720Tickets: undefined });

    assert.equal(payload.version, 5, 'pension720 backup must use v5');
    assert.equal(normalizedV5.pension720Tickets.length, 2, 'pension720 backup must dedupe target-aware tickets');
    assert.equal(normalizedV5.pension720Campaigns.length, 1, 'pension720 backup must include campaigns');
    assert.equal(normalizedV5.pension720Tickets[0].number.length, 6, 'pension720 backup must preserve six digits');
    assert.equal(normalizedV4.pension720Campaigns.length, 0, 'backup v4 must remain compatible without campaigns');
    assert.equal(normalizedV4.pension720Tickets.length, 2, 'backup v4 must preserve pension720 tickets');
    assert.deepEqual(normalizedV3.pension720Tickets, [], 'backup v3 must remain compatible without pension720 data');
}

async function runPension720StaticDataRegression() {
    const raw = await readFile(resolve(process.cwd(), 'data/pension720_stats.json'), 'utf8');
    const rows = JSON.parse(raw);
    const dm = new DataManager();
    const normalized = dm.normalizePension720Stats(rows);

    assert.ok(normalized.length >= 300, 'pension720 static data must include historical draws');
    assert.ok(
        normalized[0].draw_no >= 316,
        'pension720 static data minimum fixture regression must not regress below the 2026-05-21 snapshot; run check:pension720:freshness for online freshness'
    );
    assert.equal(normalized.find((row) => row.draw_no === 314)?.number, '060727', 'static data must preserve zeroes');
}

function runPension720FreshnessComparisonRegression() {
    const rows = makeSamplePensionStats();
    const options = { estimatedLatestDrawNo: rows[0].draw_no };
    const ok = comparePension720Freshness(rows, rows, options);
    const stale = comparePension720Freshness(rows.slice(1), rows, options);
    const mismatch = comparePension720Freshness(rows, [{ ...rows[0], number: '111111' }, ...rows.slice(1)], options);

    assert.equal(ok.ok, true, 'pension720 online freshness comparison must pass matching snapshots');
    assert.equal(stale.ok, false, 'pension720 online freshness comparison must fail stale static data');
    assert.equal(mismatch.ok, false, 'pension720 online freshness comparison must fail latest draw mismatches');
    assert.equal(
        comparePension720Freshness(rows, rows, { estimatedLatestDrawNo: rows[0].draw_no + 1 }).ok,
        false,
        'pension720 online freshness comparison must fail when official data is behind estimated draw schedule'
    );
}

async function runPension720OfficialFetchRetryRegression() {
    let calls = 0;
    const expectedPayload = makeSamplePensionStats();
    const result = await fetchOfficialPayload({
        retryDelayMs: 0,
        fetchImpl: async () => {
            calls += 1;
            if (calls < 3) {
                const error = new TypeError('fetch failed');
                error.cause = { code: 'UND_ERR_CONNECT_TIMEOUT' };
                throw error;
            }
            return new Response(JSON.stringify(expectedPayload), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            });
        }
    });

    assert.equal(calls, 3, 'pension720 official fetch must retry transient connection timeouts');
    assert.deepEqual(result, expectedPayload, 'pension720 official fetch must return the eventual successful payload');
}

function runPension720OfficialFetchWrappedErrorRegression() {
    const timeout = new TypeError('fetch failed');
    timeout.cause = { code: 'UND_ERR_CONNECT_TIMEOUT' };
    const wrapped = new Error('official pension720 fetch failed after 3 attempt(s): fetch failed', {
        cause: timeout
    });

    const abortCause = new Error('This operation was aborted');
    abortCause.name = 'AbortError';
    const wrappedAbort = new Error(
        'official pension720 fetch failed after 3 attempt(s): This operation was aborted',
        { cause: abortCause }
    );

    const timeoutError = new Error('The operation was aborted due to timeout');
    timeoutError.name = 'TimeoutError';
    const wrappedTimeoutError = new Error(
        'official pension720 fetch failed after 3 attempt(s): The operation was aborted due to timeout',
        { cause: timeoutError }
    );

    const malformedJson = new Error('official pension720 fetch failed after 1 attempt(s): bad json', {
        cause: new SyntaxError('Unexpected token')
    });

    assert.equal(
        isRetriableOfficialFetchError(wrapped),
        true,
        'wrapped pension720 timeout must be classified as retriable for CI defer'
    );
    assert.equal(
        isRetriableOfficialFetchError(wrappedAbort),
        true,
        'wrapped pension720 AbortError must be retriable/deferrable for scheduled CI'
    );
    assert.equal(
        isRetriableOfficialFetchError(wrappedTimeoutError),
        true,
        'wrapped pension720 TimeoutError must be retriable/deferrable for scheduled CI'
    );
    assert.equal(
        isRetriableOfficialFetchError(malformedJson),
        false,
        'malformed official payload must not be treated as a deferred network outage'
    );
}

function runPension720LatestCheckRegression() {
    const dm = new DataManager();
    const draw = {
        draw_no: 315,
        date: '2026-05-14',
        group: 2,
        number: '537530',
        bonus_number: '358127'
    };

    const cases = [
        [{ group: 2, number: '537530' }, 1, 'primary', 7],
        [{ group: 5, number: '537530' }, 2, 'primary', 6],
        [{ group: 1, number: '358127' }, 'bonus', 'bonus', 6],
        [{ group: 1, number: '037530' }, 3, 'primary', 5],
        [{ group: 1, number: '007530' }, 4, 'primary', 4],
        [{ group: 1, number: '000530' }, 5, 'primary', 3],
        [{ group: 1, number: '000030' }, 6, 'primary', 2],
        [{ group: 1, number: '000000' }, 7, 'primary', 1],
        [{ group: 1, number: '123456' }, 0, 'none', 0]
    ];

    cases.forEach(([ticket, rank, matchType, trailingMatches]) => {
        const result = dm.evaluatePension720Ticket(ticket, draw);
        assert.equal(result.rank, rank, `pension720 check rank mismatch for ${ticket.number}`);
        assert.equal(result.matchType, matchType, `pension720 check match type mismatch for ${ticket.number}`);
        assert.equal(
            result.trailingMatches,
            trailingMatches,
            `pension720 check trailing matches mismatch for ${ticket.number}`
        );
    });

    dm.state.pension720Stats = [
        draw,
        {
            draw_no: 314,
            date: '2026-05-07',
            group: 1,
            number: '111111',
            bonus_number: '222222'
        }
    ];
    const targetResult = dm.resolvePension720TicketCheck({ group: 1, number: '111111', targetDrawNo: 314 });
    const futureResult = dm.resolvePension720TicketCheck({ group: 1, number: '123456', targetDrawNo: 316 });
    const missingResult = dm.resolvePension720TicketCheck({ group: 1, number: '123456', targetDrawNo: 313 });
    const referenceResult = dm.resolvePension720TicketCheck({ group: 2, number: '537530' });

    assert.equal(targetResult.status, 'target', 'target draw ticket must evaluate against its target draw');
    assert.equal(targetResult.result.rank, 1, 'target draw ticket must use target draw result');
    assert.equal(futureResult.status, 'pending', 'future target draw ticket must be pending');
    assert.equal(futureResult.result, null, 'future target draw ticket must not be evaluated as latest loss');
    assert.equal(missingResult.status, 'missing', 'missing target draw ticket must surface data absence');
    assert.equal(referenceResult.status, 'reference', 'ticket without target draw must use latest reference mode');
    assert.equal(referenceResult.result.rank, 1, 'latest reference ticket must still evaluate against latest draw');
}

function runPension720CsvFormulaEscapeRegression() {
    const previousDocument = globalThis.document;
    const previousBlob = globalThis.Blob;
    const previousUrl = globalThis.URL;
    const previousCopyText = UIManager.copyText;
    const previousToast = UIManager.toast;
    let copied = '';

    UIManager.copyText = (value) => {
        copied = String(value || '');
    };
    UIManager.toast = () => {};
    globalThis.document = undefined;
    globalThis.Blob = undefined;
    globalThis.URL = undefined;

    try {
        const data = new DataManager();
        data.state.pension720Tickets = [
            data.normalizePension720Ticket({
                group: 2,
                number: '060727',
                targetDrawNo: 316,
                source: 'recommendation',
                score: 1.5,
                memo: '=1+1',
                createdAt: '2026-05-19T00:00:00.000Z'
            })
        ];

        Pension720Module.prototype.exportSavedTicketsCsv.call({ data });

        assert.match(copied, /memo/, 'pension720 CSV fallback must include header');
        assert.match(copied, /'=1\+1/, 'pension720 CSV must protect spreadsheet formula prefixes');
        assert.doesNotMatch(copied, /,=1\+1,/, 'pension720 CSV must not export raw formula-like memo cells');
    } finally {
        UIManager.copyText = previousCopyText;
        UIManager.toast = previousToast;
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
        if (previousBlob === undefined) delete globalThis.Blob;
        else globalThis.Blob = previousBlob;
        if (previousUrl === undefined) delete globalThis.URL;
        else globalThis.URL = previousUrl;
    }
}

async function runPension720UiContractRegression() {
    const [
        indexSource,
        featureFacadeSource,
        pension720ModuleSource,
        pension720TicketsSource,
        pension720CampaignsSource,
        dataIoSupportSource,
        dataIoBackupSource,
        dataIoBackupConstantsSource
    ] = await Promise.all([
        readFile(resolve(process.cwd(), 'index.html'), 'utf8'),
        readFile(resolve(process.cwd(), 'assets/modules/features/Pension720.js'), 'utf8'),
        readFile(resolve(process.cwd(), 'assets/modules/features/pension720/module.js'), 'utf8'),
        readFile(resolve(process.cwd(), 'assets/modules/features/pension720/tickets.js'), 'utf8'),
        readFile(resolve(process.cwd(), 'assets/modules/features/pension720/campaigns.js'), 'utf8'),
        readFile(resolve(process.cwd(), 'assets/modules/features/dataio/support.js'), 'utf8'),
        readFile(resolve(process.cwd(), 'assets/modules/features/dataio/backupExport.js'), 'utf8'),
        readFile(resolve(process.cwd(), 'assets/modules/features/dataio/backupExport/constants.js'), 'utf8')
    ]);
    const featureSource = [
        featureFacadeSource,
        pension720ModuleSource,
        pension720TicketsSource,
        pension720CampaignsSource
    ].join('\n');
    const dataIoSource = [dataIoSupportSource, dataIoBackupSource, dataIoBackupConstantsSource].join('\n');

    assert.match(indexSource, /pension720CopyAllBtn/, 'pension720 UI must expose copy-all action');
    assert.match(indexSource, /pension720ExportCsvBtn/, 'pension720 UI must expose CSV export action');
    assert.match(indexSource, /pension720CheckLatestBtn/, 'pension720 UI must expose latest-check action');
    assert.match(indexSource, /pension720StrategySelect/, 'pension720 UI must expose strategy select');
    assert.match(indexSource, /pension720PresetSaveBtn/, 'pension720 UI must expose preset save action');
    assert.match(indexSource, /pension720CampaignBtn/, 'pension720 UI must expose campaign generation action');
    assert.match(indexSource, /pension720FixedDigits/, 'pension720 UI must expose fixed-digit filter');
    assert.match(indexSource, /pension720ExcludedDigits/, 'pension720 UI must expose excluded-digit filter');
    assert.match(
        indexSource,
        /대상 회차가 있으면 해당 회차를 우선 확인하고, 없으면 최신 결과를 참고\s+비교합니다/,
        'pension720 check subtitle must explain target-aware checking'
    );
    assert.match(
        indexSource,
        /저장 번호 기준 참고 확인이며 실물\/공식 확인이 필요합니다/,
        'pension720 check disclaimer must stay visible'
    );
    assert.match(featureSource, /UIManager\.confirm/, 'pension720 clear-all must require confirmation');
    assert.match(
        featureSource,
        /lastRecommendationOptions/,
        'pension720 recommendations must remember generation options'
    );
    assert.match(featureSource, /runCampaignRecommendation/, 'pension720 feature must implement campaign generation');
    assert.match(featureSource, /copyText/, 'pension720 saved tickets must use generic text copy');
    assert.match(featureSource, /lotto_pension_pro_pension720_tickets_/, 'pension720 CSV filename must be rebranded');
    assert.match(dataIoSource, /lotto_pension_pro_backup_v5/, 'backup export filename prefix must be v5');
}

async function runPension720BackupFixtureRegression() {
    const raw = await readFile(resolve(process.cwd(), 'scripts/smoke/fixtures/backup_v4_pension720.json'), 'utf8');
    const normalized = JSON.parse(raw);
    const payload = buildBackupPayload(normalized);
    const roundtrip = normalizeBackupPayload(payload);

    assert.equal(normalized.version, 4, 'pension720 backup fixture must be v4');
    assert.equal(roundtrip.pension720Tickets.length, 2, 'pension720 backup fixture must roundtrip saved tickets');
    assert.equal(roundtrip.pension720Tickets[0]?.number, '060727', 'pension720 fixture must preserve leading zeroes');
}

async function runPension720RuntimeSeedSurfaceRegression() {
    const [recommendationsSource, reproductionSource] = await Promise.all([
        readFile(resolve(process.cwd(), 'assets/modules/features/pension720/recommendations.js'), 'utf8'),
        readFile(resolve(process.cwd(), 'assets/modules/utils/reproductionCode.js'), 'utf8')
    ]);

    assert.match(recommendationsSource, /createRuntimeSeed/, 'pension720 recommendation must allocate runtime seeds');
    assert.match(recommendationsSource, /upsertReproductionCodeBar/, 'pension720 results must surface reproduction code');
    assert.match(reproductionSource, /재현 코드/, 'reproduction helper must expose Korean reproduction label');
}

async function runPension720RuntimeSeedDeterminismRegression() {
    const stats = makeSamplePensionStats();
    const engine = new Pension720Engine(stats);
    const request = {
        strategyId: 'mixed_balance',
        params: {
            seed: 424242,
            lookbackWindow: 40,
            candidatePoolSize: 120,
            simulationCount: 5000
        },
        filters: {}
    };
    const first = engine.recommend({ setCount: 3, request });
    const second = engine.recommend({ setCount: 3, request });

    assert.equal(first.length, 3, 'seeded pension720 recommendation must return requested set count');
    assert.deepEqual(
        first.map((item) => `${item.group}|${item.number}`),
        second.map((item) => `${item.group}|${item.number}`),
        'seeded pension720 recommendation must be reproducible'
    );
}

async function runPension720DomEncodingRegression() {
    const { formatTicket, getAnalysisPresetLabelFromRequest, PENSION720_ANALYSIS_PRESETS } = await import(
        '../../../../assets/modules/features/pension720/dom.js'
    );

    assert.equal(formatTicket({ group: 5, number: '123456' }), '5조 123456', 'formatTicket must keep 조 suffix');
    assert.equal(PENSION720_ANALYSIS_PRESETS.fast.label, '빠름', 'fast preset label must stay UTF-8');
    assert.equal(PENSION720_ANALYSIS_PRESETS.basic.label, '기본', 'basic preset label must stay UTF-8');
    assert.equal(PENSION720_ANALYSIS_PRESETS.precise.label, '정밀', 'precise preset label must stay UTF-8');
    assert.equal(
        getAnalysisPresetLabelFromRequest({
            params: { lookbackWindow: 40, candidatePoolSize: 140 }
        }),
        '기본',
        'analysis preset label must resolve from request params'
    );
}

async function runPension720PrecacheRegression() {
    const manifest = await buildPrecacheManifest();
    assert.ok(
        manifest.data.includes('./data/pension720_stats.json'),
        'pension720 static data must be in SW data precache manifest'
    );
}

export {
    runPension720AdvancedRecommendationRegression,
    runPension720BackupV5Regression,
    runPension720BackupFixtureRegression,
    runPension720CampaignRegression,
    runPension720CsvFormulaEscapeRegression,
    runPension720DomEncodingRegression,
    runPension720RuntimeSeedDeterminismRegression,
    runPension720RuntimeSeedSurfaceRegression,
    runPension720FreshnessComparisonRegression,
    runPension720OfficialFetchRetryRegression,
    runPension720OfficialFetchWrappedErrorRegression,
    runPension720LatestCheckRegression,
    runPension720NormalizationRegression,
    runPension720PrecacheRegression,
    runPension720RecommendationRegression,
    runPension720StaticDataRegression,
    runPension720TicketCapRegression,
    runPension720TicketDedupeRegression,
    runPension720UiContractRegression
};
