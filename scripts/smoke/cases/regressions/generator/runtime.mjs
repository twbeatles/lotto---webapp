/* eslint-disable no-unused-vars */
import {
    assert,
    buildSmokeRequest,
    CONFIG,
    createDocumentStub,
    createField,
    DataManager,
    GeneratorModule,
    LottoApp,
    normalizeBackupPayload,
    UIManager
} from '../support.mjs';

async function runGeneratorStrategySelectionRegression() {
    const previousDocument = globalThis.document;
    const setCount = createField({ value: '2' });
    const fixedNums = createField({ value: '' });
    const excludeNums = createField({ value: '' });
    const limitConsecutive = createField({ checked: false });
    const genResultList = createField();
    const campStartDraw = createField({ value: '1210' });
    const campWeeks = createField({ value: '2' });
    const campSetsPerWeek = createField({ value: '1' });

    globalThis.document = createDocumentStub({
        '#setCount': setCount,
        '#fixedNums': fixedNums,
        '#excludeNums': excludeNums,
        '#limitConsecutive': limitConsecutive,
        '#genResultList': genResultList,
        '#campStartDraw': campStartDraw,
        '#campWeeks': campWeeks,
        '#campSetsPerWeek': campSetsPerWeek
    });

    try {
        const data = new DataManager();
        data.save = () => {};
        data.state.winningStats = [
            {
                draw_no: 1209,
                date: '2026-04-12',
                numbers: [1, 2, 3, 4, 5, 6],
                bonus: 7
            }
        ];

        const workerRequests = [];
        const ctx = {
            data,
            app: { data, renderDataLists() {} },
            isGenerating: false,
            isGeneratingCampaign: false,
            generationToken: 0,
            campaignToken: 0,
            uiStrings: { workerFallback: '', workerFallbackCampaign: '' },
            syncBusyButtons() {},
            parseInput() {
                return [];
            },
            getStrategyRequestFromUI() {
                return {
                    strategyId: 'consensus_portfolio',
                    params: { simulationCount: 1200, lookbackWindow: 20, seed: 20260414 },
                    filters: {}
                };
            },
            syncStrategyFromLegacyToggles() {
                throw new Error('generate must not rewrite strategy selection from legacy toggles');
            },
            workerClient: {
                async generate(payload) {
                    workerRequests.push(payload.request.strategyId);
                    return { sets: [[1, 2, 3, 4, 5, 6]] };
                }
            },
            renderResultItem() {},
            readNumberInput(id, fallback = null) {
                const map = {
                    campStartDraw: 1210,
                    campWeeks: 2,
                    campSetsPerWeek: 1
                };
                return map[id] ?? fallback;
            },
            isWorkerTimeoutError() {
                return false;
            }
        };

        await GeneratorModule.prototype.generate.call(ctx);
        assert.equal(workerRequests[0], 'consensus_portfolio', 'generate must execute the currently selected strategy');
        assert.equal(
            data.state.generated[0]?.strategyRequest?.strategyId,
            'consensus_portfolio',
            'generated entries must preserve the selected strategy request'
        );

        await GeneratorModule.prototype.generateCampaign.call(ctx);
        assert.deepEqual(
            workerRequests.slice(1),
            ['consensus_portfolio', 'consensus_portfolio'],
            'campaign generation must keep the selected strategy for every generated week'
        );
        assert.deepEqual(
            data.state.ticketBook.map((ticket) => ticket.strategyRequest?.params?.seed).sort((a, b) => a - b),
            [20260414, 20260415],
            'campaign tickets must preserve the per-week runtime strategy request'
        );
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    }
}

async function runGeneratorSetCountClampRegression() {
    const previousDocument = globalThis.document;
    const previousConsoleWarn = console.warn;
    const setCount = createField({ value: '9999' });
    const fixedNums = createField({ value: '' });
    const excludeNums = createField({ value: '' });
    const limitConsecutive = createField({ checked: false });
    const genResultList = createField();

    globalThis.document = createDocumentStub({
        '#setCount': setCount,
        '#fixedNums': fixedNums,
        '#excludeNums': excludeNums,
        '#limitConsecutive': limitConsecutive,
        '#genResultList': genResultList,
        '#toast-container': null
    });

    const makeContext = (workerClient) => {
        const data = new DataManager();
        data.save = () => {};
        data.state.winningStats = [
            {
                draw_no: 1209,
                date: '2026-04-12',
                numbers: [1, 2, 3, 4, 5, 6],
                bonus: 7
            }
        ];
        return {
            data,
            app: { data },
            workerClient,
            isGenerating: false,
            isGeneratingCampaign: false,
            generationToken: 0,
            uiStrings: { workerFallback: '' },
            syncBusyButtons() {},
            parseInput() {
                return [];
            },
            getStrategyRequestFromUI() {
                return {
                    strategyId: 'random_baseline',
                    params: { simulationCount: 1000, lookbackWindow: 20, seed: 20260519 },
                    filters: {}
                };
            },
            renderResultItem() {},
            isWorkerTimeoutError() {
                return false;
            }
        };
    };

    try {
        let workerCount = 0;
        const workerCtx = makeContext({
            async generate(payload) {
                workerCount = payload.count;
                return {
                    sets: Array.from({ length: payload.count }, (_, index) => [1, 2, 3, 4, 5, 6 + (index % 40)])
                };
            }
        });

        await GeneratorModule.prototype.generate.call(workerCtx);
        assert.equal(workerCount, CONFIG.LIMITS.MAX_SET, 'generator worker payload must clamp setCount to MAX_SET');
        assert.equal(setCount.value, String(CONFIG.LIMITS.MAX_SET), 'generator input must reflect the clamped count');
        assert.equal(
            workerCtx.data.state.generated.length,
            CONFIG.LIMITS.MAX_SET,
            'generator worker result must not exceed MAX_SET'
        );

        setCount.value = '9999';
        console.warn = () => {};
        const fallbackCtx = makeContext({
            async generate() {
                throw new Error('force fallback');
            }
        });

        await GeneratorModule.prototype.generate.call(fallbackCtx);
        assert.ok(
            fallbackCtx.data.state.generated.length <= CONFIG.LIMITS.MAX_SET,
            'generator fallback result must not exceed MAX_SET'
        );
    } finally {
        console.warn = previousConsoleWarn;
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    }
}

async function runGeneratorDataUnavailableGuardRegression() {
    const previousDocument = globalThis.document;
    const previousToast = UIManager.toast;
    const toasts = [];
    UIManager.toast = (message) => {
        toasts.push(String(message || ''));
    };

    globalThis.document = createDocumentStub({
        '#setCount': createField({ value: '5' }),
        '#fixedNums': createField({ value: '' }),
        '#excludeNums': createField({ value: '' }),
        '#limitConsecutive': createField({ checked: false }),
        '#genResultList': createField(),
        '#toast-container': null
    });

    try {
        const data = new DataManager();
        data.save = () => {};
        data.state.winningStats = [];

        let workerCalled = false;
        const ctx = {
            data,
            app: { data },
            workerClient: {
                async generate() {
                    workerCalled = true;
                    return { sets: [[1, 2, 3, 4, 5, 6]] };
                }
            },
            isGenerating: false,
            isGeneratingCampaign: false,
            generationToken: 0,
            uiStrings: {
                dataUnavailable: '당첨 데이터가 없습니다. 데이터 관리에서 동기화하거나 데이터 파일을 확인해주세요.'
            },
            syncBusyButtons() {},
            parseInput() {
                return [];
            },
            getStrategyRequestFromUI() {
                return { strategyId: 'random_baseline', params: {}, filters: {} };
            },
            renderResultItem() {},
            isWorkerTimeoutError() {
                return false;
            }
        };

        const result = await GeneratorModule.prototype.generate.call(ctx);
        assert.equal(result, false, 'generator must abort when winning stats are unavailable');
        assert.equal(workerCalled, false, 'generator must not call the worker without data');
        assert.ok(
            toasts.some((message) => message.includes('당첨 데이터가 없습니다')),
            'generator must toast when data is unavailable'
        );
    } finally {
        UIManager.toast = previousToast;
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    }
}

export {
    runGeneratorStrategySelectionRegression,
    runGeneratorSetCountClampRegression,
    runGeneratorDataUnavailableGuardRegression
};
