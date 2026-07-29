import {
    assert,
    CONFIG,
    createDocumentStub,
    createField,
    DataIOModule,
    DataManager,
    estimateLatestDrawKST,
    LottoApp,
    readFile,
    resolve,
    StrategyWorkerClient,
    UIManager
} from './support.mjs';

function makeMemoryStorage(seed = {}) {
    const store = new Map(Object.entries(seed));
    return {
        getItem(key) {
            return store.has(key) ? store.get(key) : null;
        },
        setItem(key, value) {
            store.set(key, String(value));
        },
        removeItem(key) {
            store.delete(key);
        },
        _store: store
    };
}

function runStorageDirtyRetainedOnFailureRegression() {
    const previousStorage = globalThis.localStorage;
    const previousToast = UIManager.toast;
    const previousConsoleError = console.error;
    const error = new Error('quota full');
    error.name = 'QuotaExceededError';

    globalThis.localStorage = {
        getItem() {
            return null;
        },
        setItem() {
            throw error;
        }
    };
    UIManager.toast = () => {};
    console.error = () => {};

    try {
        const dm = new DataManager();
        dm.state.favorites = [{ numbers: [1, 2, 3, 4, 5, 6], date: '2026-05-17T00:00:00.000Z' }];
        dm.markDirty('fav');
        dm.save(true);

        assert.equal(dm._dirtyKeys.fav, true, 'failed localStorage write must keep the dirty flag');
        assert.equal(dm.getStorageWriteFailures().length, 1, 'failed localStorage write must be tracked');
        assert.equal(dm.getStorageSummary().status, 'danger', 'storage summary must surface write failures');
    } finally {
        console.error = previousConsoleError;
        UIManager.toast = previousToast;
        if (previousStorage === undefined) delete globalThis.localStorage;
        else globalThis.localStorage = previousStorage;
    }
}

function runLocalUpdatesDirtyRetryRegression() {
    const previousStorage = globalThis.localStorage;
    const previousToast = UIManager.toast;
    const previousConsoleError = console.error;
    const previousConsoleWarn = console.warn;
    let failLocalUpdates = true;
    const store = new Map();
    const quotaError = new Error('quota full');
    quotaError.name = 'QuotaExceededError';

    globalThis.localStorage = {
        getItem(key) {
            return store.has(key) ? store.get(key) : null;
        },
        setItem(key, value) {
            if (key === CONFIG.KEYS.LOCAL_UPDATES && failLocalUpdates) {
                throw quotaError;
            }
            store.set(key, String(value));
        }
    };
    UIManager.toast = () => {};
    console.error = () => {};
    console.warn = () => {};

    try {
        const dm = new DataManager();
        const update = {
            draw_no: 1210,
            date: '2026-03-07',
            numbers: [1, 2, 3, 4, 5, 6],
            bonus: 7
        };
        dm.setLocalUpdates([update], { warningMode: 'silent' });

        assert.equal(dm._dirtyKeys.localUpdates, true, 'failed localUpdates write must keep the dirty flag');
        assert.equal(
            store.has(CONFIG.KEYS.LOCAL_UPDATES),
            false,
            'failed localUpdates write must not appear persisted'
        );

        failLocalUpdates = false;
        dm.save(true);

        assert.equal(dm._dirtyKeys.localUpdates, false, 'next save must clear localUpdates after retry success');
        assert.equal(
            JSON.parse(store.get(CONFIG.KEYS.LOCAL_UPDATES))[0]?.draw_no,
            1210,
            'next save must retry and persist localUpdates'
        );

        store.set(CONFIG.KEYS.LOCAL_UPDATES, '{bad json');
        const loaded = new DataManager();
        loaded.load();
        assert.deepEqual(loaded.localUpdatesCache, [], 'malformed localUpdates JSON must recover to an empty list');
    } finally {
        console.warn = previousConsoleWarn;
        console.error = previousConsoleError;
        UIManager.toast = previousToast;
        if (previousStorage === undefined) delete globalThis.localStorage;
        else globalThis.localStorage = previousStorage;
    }
}

async function runDestructiveBackupAbortRegression() {
    const previousDocument = globalThis.document;
    const previousToast = UIManager.toast;
    const previousConfirm = UIManager.confirm;
    const importMode = createField({ value: 'overwrite' });
    const importApplyTheme = createField({ checked: true });
    const importApplyProxy = createField({ checked: true });
    const importApplyStrategyPrefs = createField({ checked: true });
    const importApplyAlerts = createField({ checked: true });
    const toasts = [];

    UIManager.toast = (message, type = 'info') => {
        toasts.push(`${type}:${message}`);
    };
    globalThis.document = createDocumentStub({
        '#importMode': importMode,
        '#importApplyTheme': importApplyTheme,
        '#importApplyProxy': importApplyProxy,
        '#importApplyStrategyPrefs': importApplyStrategyPrefs,
        '#importApplyAlerts': importApplyAlerts
    });

    try {
        const data = new DataManager();
        data.state.favorites = [{ numbers: [1, 2, 3, 4, 5, 6], date: '2026-05-17T00:00:00.000Z' }];
        data.save = () => {
            throw new Error('save must not run after backup failure');
        };
        data.setLocalUpdates = () => ({ items: [], droppedFuture: 0 });
        data.getLocalUpdates = () => [];

        const ctx = Object.create(DataIOModule.prototype);
        ctx.data = data;
        ctx.app = { applyTheme() {}, renderSettingsPanel() {} };
        ctx.syncProxyInput = () => {};
        ctx.refreshPresetSelectors = () => {};
        ctx.runPostImportRefresh = async () => {};
        ctx.confirmPreparedImport = async () => true;
        ctx.exportAll = () => ({ downloaded: false, filename: '' });

        await DataIOModule.prototype.importAll.call(ctx, {
            currentTarget: {
                files: [
                    {
                        size: 1,
                        async text() {
                            return JSON.stringify({
                                version: 4,
                                favorites: [],
                                history: [],
                                ticketBook: [],
                                campaigns: [],
                                pension720Tickets: [],
                                alertPrefs: {},
                                settings: {},
                                localUpdates: [],
                                strategyPresets: []
                            });
                        }
                    }
                ],
                value: 'overwrite.json'
            }
        });

        assert.equal(data.state.favorites.length, 1, 'overwrite import must abort before replacing data');
        assert.ok(
            toasts.some((item) => item.startsWith('error:')),
            'backup failure must show an error toast'
        );

        const cancelData = new DataManager();
        cancelData.state.favorites = [{ numbers: [1, 2, 3, 4, 5, 6], date: '2026-05-17T00:00:00.000Z' }];
        cancelData.save = () => {
            throw new Error('save must not run after backup confirmation cancel');
        };
        cancelData.setLocalUpdates = () => ({ items: [], droppedFuture: 0 });
        cancelData.getLocalUpdates = () => [];

        const cancelCtx = Object.create(DataIOModule.prototype);
        cancelCtx.data = cancelData;
        cancelCtx.app = { applyTheme() {}, renderSettingsPanel() {} };
        cancelCtx.syncProxyInput = () => {};
        cancelCtx.refreshPresetSelectors = () => {};
        cancelCtx.runPostImportRefresh = async () => {};
        cancelCtx.confirmPreparedImport = async () => true;
        cancelCtx.exportAll = () => ({ downloaded: true, filename: 'before-overwrite.json' });
        UIManager.confirm = async () => false;

        await DataIOModule.prototype.importAll.call(cancelCtx, {
            currentTarget: {
                files: [
                    {
                        size: 1,
                        async text() {
                            return JSON.stringify({
                                version: 4,
                                favorites: [],
                                history: [],
                                ticketBook: [],
                                campaigns: [],
                                pension720Tickets: [],
                                alertPrefs: {},
                                settings: {},
                                localUpdates: [],
                                strategyPresets: []
                            });
                        }
                    }
                ],
                value: 'overwrite.json'
            }
        });

        assert.equal(
            cancelData.state.favorites.length,
            1,
            'overwrite import must abort when backup confirm is canceled'
        );
        assert.ok(
            toasts.some((item) => item.includes('백업 확인이 취소')),
            'backup confirmation cancel must show an abort toast'
        );

        const [dataIoSupportSource, dataIoBackupSource, dataIoBackupDestructiveSource, dataIoBackupExportAllSource] =
            await Promise.all([
                readFile(resolve(process.cwd(), 'assets/modules/features/dataio/support.js'), 'utf8'),
                readFile(resolve(process.cwd(), 'assets/modules/features/dataio/backupExport.js'), 'utf8'),
                readFile(resolve(process.cwd(), 'assets/modules/features/dataio/backupExport/destructive.js'), 'utf8'),
                readFile(resolve(process.cwd(), 'assets/modules/features/dataio/backupExport/exportAll.js'), 'utf8')
            ]);
        const dataIoSource = [
            dataIoSupportSource,
            dataIoBackupSource,
            dataIoBackupDestructiveSource,
            dataIoBackupExportAllSource
        ].join('\n');
        assert.match(
            dataIoSource,
            /preferFilePicker:\s*true/,
            'destructive backup helper must prefer a browser file picker when available'
        );
        assert.match(
            dataIoSource,
            /showSaveFilePicker/,
            'destructive backup helper must support a write-complete file picker path'
        );
        assert.match(
            dataIoSource,
            /다운로드가 차단되었거나 실패했으면 중단/,
            'download fallback confirmation must warn about blocked or failed downloads'
        );

        const cleanupSource = await readFile(
            resolve(process.cwd(), 'assets/modules/core/app/dataLists/events/bindDataEvents.js'),
            'utf8'
        );
        assert.match(
            cleanupSource,
            /ensureBackupBeforeDestructive/,
            'backup-and-cleanup must also abort through the destructive backup helper'
        );
    } finally {
        UIManager.toast = previousToast;
        UIManager.confirm = previousConfirm;
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    }
}

async function runPension720OfficialCacheRegression() {
    const previousStorage = globalThis.localStorage;
    const previousFetch = globalThis.fetch;
    const cached = [
        {
            draw_no: 4,
            date: '2026-05-21',
            group: 1,
            number: '123456',
            bonus_number: '654321'
        }
    ];
    const staticRows = [
        {
            draw_no: 3,
            date: '2026-05-14',
            group: 2,
            number: '537530',
            bonus_number: '358127'
        }
    ];
    globalThis.localStorage = makeMemoryStorage({
        [CONFIG.KEYS.PENSION720_STATS_CACHE]: JSON.stringify({
            version: 1,
            updatedAt: '2026-05-21T00:00:00.000Z',
            items: cached
        })
    });
    globalThis.fetch = async () => ({
        ok: true,
        async json() {
            return staticRows;
        }
    });

    try {
        const dm = new DataManager();
        const ok = await dm.fetchPension720Stats({ remote: false });
        assert.equal(ok, true, 'pension720 fetch must succeed from static plus official cache');
        assert.equal(dm.state.pension720Stats[0]?.draw_no, 4, 'official cache must win when newer than static');
        assert.equal(dm.pension720DataHealth.source, 'official_cache', 'health source must expose official cache');

        const sameDrawCache = [
            {
                draw_no: 5,
                date: '2026-05-28',
                group: 1,
                number: '111111',
                bonus_number: '222222'
            }
        ];
        const sameDrawStatic = [
            {
                draw_no: 5,
                date: '2026-05-28',
                group: 3,
                number: '333333',
                bonus_number: '444444'
            }
        ];
        globalThis.localStorage = makeMemoryStorage({
            [CONFIG.KEYS.PENSION720_STATS_CACHE]: JSON.stringify({
                version: 1,
                updatedAt: '2026-05-27T00:00:00.000Z',
                items: sameDrawCache
            })
        });
        globalThis.fetch = async () => ({
            ok: true,
            async json() {
                return sameDrawStatic;
            }
        });

        const correctedDm = new DataManager();
        const correctedOk = await correctedDm.fetchPension720Stats({ remote: false });
        assert.equal(correctedOk, true, 'same-draw static correction must load successfully');
        assert.equal(
            correctedDm.state.pension720Stats[0]?.number,
            '333333',
            'same-draw static data must beat an older official cache copy'
        );
        assert.equal(correctedDm.pension720DataHealth.source, 'static', 'same-draw cache must not shadow static data');
        assert.equal(
            correctedDm.clearPension720StatsCache(),
            true,
            'official cache clear must remove the stored cache'
        );
        assert.equal(
            globalThis.localStorage.getItem(CONFIG.KEYS.PENSION720_STATS_CACHE),
            null,
            'official cache clear must delete the storage key'
        );
    } finally {
        if (previousStorage === undefined) delete globalThis.localStorage;
        else globalThis.localStorage = previousStorage;
        if (previousFetch === undefined) delete globalThis.fetch;
        else globalThis.fetch = previousFetch;
    }
}

function runAutoSyncAvailabilityRegression() {
    const dm = new DataManager();
    const latest = Math.max(1, estimateLatestDrawKST() - 1);
    dm.state.winningStats = [{ draw_no: latest }];
    dm.state.staticLatestDrawNo = latest;
    dm.dataHealth = { availability: 'full', source: 'static', latestDrawNo: latest, message: '' };
    dm.state.syncMeta = dm.mergeSyncMeta({
        lastFailureAt: new Date().toISOString(),
        lastFailureMessage: 'network unavailable',
        lastSuccessAt: ''
    });

    assert.equal(dm.getDataFreshness().canAutoSync, false, 'recent sync failure must block auto-sync optimism');

    dm.state.customProxy = 'https://example.com/proxy/latest';
    assert.equal(dm.getDataFreshness().canAutoSync, true, 'valid custom proxy must restore auto-sync availability');
}

function runTemporaryResultsSessionRegression() {
    const previousSession = globalThis.sessionStorage;
    globalThis.sessionStorage = makeMemoryStorage();

    try {
        const dm = new DataManager();
        dm.state.generated = [{ numbers: [6, 5, 4, 3, 2, 1], source: 'generator' }];
        dm.state.aiResults = [[7, 8, 9, 10, 11, 12]];
        dm.state.pension720Results = [{ group: 2, number: '060727', score: 12.5, expansionGroups: [1, 3] }];
        assert.equal(dm.persistTemporaryResultsToSession(), true, 'temporary results must persist to sessionStorage');

        const restored = new DataManager();
        assert.equal(
            restored.loadTemporaryResultsFromSession(),
            true,
            'temporary results must restore from sessionStorage'
        );
        assert.deepEqual(restored.state.generated[0]?.numbers, [1, 2, 3, 4, 5, 6], 'generated results must normalize');
        assert.deepEqual(restored.state.aiResults[0], [7, 8, 9, 10, 11, 12], 'AI results must restore');
        assert.equal(restored.state.pension720Results[0]?.number, '060727', 'pension720 results must restore');
    } finally {
        if (previousSession === undefined) delete globalThis.sessionStorage;
        else globalThis.sessionStorage = previousSession;
    }
}

async function runRemoteRehydrateFlushesPendingPersistenceRegression() {
    const previousWarn = console.warn;
    const order = [];
    console.warn = () => {};

    try {
        const app = Object.create(LottoApp.prototype);
        app.currentRoute = 'gen';
        app.data = {
            hasPendingLocalPersistence() {
                order.push('hasPending');
                return true;
            },
            flushPendingLocalPersistence() {
                order.push('flush');
                return true;
            },
            runWithBroadcastSuppressed(task) {
                order.push('suppress');
                task();
            },
            load() {
                order.push('load');
            }
        };
        app.applyTheme = () => order.push('theme');
        app.renderSettingsPanel = () => order.push('settings');
        app.updateLatestWin = () => order.push('latest');
        app.bindTargetDrawInputs = () => order.push('target');
        app.refreshCurrentRoute = async () => order.push('route');
        const toastMessages = [];
        const previousToast = UIManager.toast;
        UIManager.toast = (message) => {
            toastMessages.push(String(message || ''));
        };

        await app._rehydrateAfterRemotePersistenceSync([CONFIG.KEYS.SETTINGS]);
        UIManager.toast = previousToast;

        assert.ok(
            toastMessages.some((message) => message.includes('다른 탭 변경과 로컬 미저장 변경이 겹쳤습니다')),
            'remote rehydrate with pending local dirty must warn about possible overwrite'
        );

        assert.deepEqual(
            order.slice(0, 4),
            ['hasPending', 'flush', 'suppress', 'load'],
            'remote rehydrate must flush pending local persistence before load clears dirty flags'
        );

        const blockedOrder = [];
        const blockedApp = Object.create(LottoApp.prototype);
        blockedApp.currentRoute = 'gen';
        blockedApp.data = {
            hasPendingLocalPersistence() {
                return true;
            },
            flushPendingLocalPersistence() {
                blockedOrder.push('flush-failed');
                return false;
            },
            runWithBroadcastSuppressed() {
                blockedOrder.push('load');
            }
        };
        blockedApp.applyTheme = () => blockedOrder.push('theme');
        blockedApp.refreshCurrentRoute = async () => blockedOrder.push('route');

        const blockedToasts = [];
        const previousBlockedToast = UIManager.toast;
        UIManager.toast = (message) => {
            blockedToasts.push(String(message || ''));
        };
        await blockedApp._rehydrateAfterRemotePersistenceSync([CONFIG.KEYS.SETTINGS]);
        UIManager.toast = previousBlockedToast;

        assert.ok(
            blockedToasts.some((message) => message.includes('로컬 저장 실패')),
            'failed flush during remote rehydrate must surface a storage failure warning'
        );

        assert.deepEqual(
            blockedOrder,
            ['flush-failed'],
            'remote rehydrate must not load remote state when local dirty persistence failed to flush'
        );
    } finally {
        console.warn = previousWarn;
    }
}

async function runStrategyWorkerPostMessageCleanupRegression() {
    const client = new StrategyWorkerClient();
    const postError = new Error('DataCloneError');
    postError.name = 'DataCloneError';
    client.worker = {
        postMessage() {
            throw postError;
        }
    };

    await assert.rejects(
        () => client.postOnce('GENERATE', { bad: true }, 1000),
        /DataCloneError/,
        'postOnce must reject when worker.postMessage throws synchronously'
    );
    assert.equal(client.pending.size, 0, 'postOnce must clean pending entries after synchronous postMessage failure');
}

async function runBackupUnavailableFallbackResultRegression() {
    const previousDocument = globalThis.document;

    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = undefined;

    try {
        const ctx = Object.create(DataIOModule.prototype);
        ctx.data = new DataManager();
        const result = await DataIOModule.prototype.exportAll.call(ctx, {
            prefix: 'fallback_probe'
        });

        assert.equal(result.downloaded, false, 'unavailable backup environment must not claim download success');
        assert.equal(result.saved, false, 'unavailable backup environment must not claim file-picker save success');
        assert.equal(result.method, 'unavailable', 'unavailable backup environment must expose fallback method');
        assert.match(result.filename, /^fallback_probe_/, 'unavailable backup result must still expose a filename');
        assert.ok(result.payload?.version >= 5, 'unavailable backup result must still expose the backup payload');
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    }
}

async function runLottoAppInitSequenceRegression() {
    const source = await readFile(resolve(process.cwd(), 'assets/modules/core/lottoApp/init.js'), 'utf8');
    const initBlock = source.match(/async init\(\) \{[\s\S]*?\n {4}\}/)?.[0] || '';

    assert.match(initBlock, /this\.data\.initCrossTabSync/, 'init must wire cross-tab sync before persistence load');
    assert.match(
        initBlock,
        /initCrossTabSync[\s\S]*this\.data\.load\(\)/,
        'init must load persisted state after cross-tab sync wiring'
    );
    assert.match(initBlock, /await this\.route\('gen'\)/, 'init must route to generator before background fetches');
    assert.match(initBlock, /fetchWinningStats/, 'init must fetch lotto winning stats during bootstrap');
    assert.match(initBlock, /fetchPension720Stats/, 'init must fetch pension720 stats during bootstrap');
    assert.match(initBlock, /queueAutoSync/, 'init must queue auto-sync when bootstrap recovery is needed');
}

async function runDataManagerLoadNormalizationRegression() {
    const previousStorage = globalThis.localStorage;
    const storage = makeMemoryStorage({
        [CONFIG.KEYS.FAV]: JSON.stringify([{ numbers: [1, 2, 3, 4, 5, 6], date: '2026-01-01T00:00:00.000Z' }]),
        [CONFIG.KEYS.HIST]: '"not-an-array"',
        [CONFIG.KEYS.SETTINGS]: JSON.stringify({ theme: 'light', customProxy: 'ftp://blocked.example/latest' }),
        [CONFIG.KEYS.TICKET_BOOK]: JSON.stringify([
            {
                numbers: [7, 8, 9, 10, 11, 12],
                targetDrawNo: 1229,
                source: 'generator',
                createdAt: '2026-01-02T00:00:00.000Z'
            }
        ])
    });
    globalThis.localStorage = storage;

    try {
        const dm = new DataManager();
        dm.load();

        assert.equal(dm.state.favorites.length, 1, 'load must keep valid favorites');
        assert.deepEqual(dm.state.history, [], 'load must normalize invalid history payloads to an empty array');
        assert.equal(dm.state.theme, 'light', 'load must restore theme from settings');
        assert.equal(dm.state.ticketBook.length, 1, 'load must normalize ticket book entries');
        assert.equal(
            dm.state.customProxy,
            'ftp://blocked.example/latest',
            'load must restore persisted proxy text for later validation'
        );
        assert.equal(
            dm.validateCustomProxyUrl(dm.state.customProxy).valid,
            false,
            'loaded proxy text must still be rejected by validateCustomProxyUrl'
        );
    } finally {
        if (previousStorage === undefined) delete globalThis.localStorage;
        else globalThis.localStorage = previousStorage;
    }
}

async function runImportAllGuardSurfaceRegression() {
    const [importFlowSource, importPayloadSource] = await Promise.all([
        readFile(resolve(process.cwd(), 'assets/modules/features/dataio/importFlow.js'), 'utf8'),
        readFile(resolve(process.cwd(), 'assets/modules/features/dataio/importPayload.js'), 'utf8')
    ]);

    assert.match(importFlowSource, /async importAll\(/, 'import flow must expose importAll entrypoint');
    assert.match(importFlowSource, /normalizeImportPayload/, 'importAll must normalize imported payloads before apply');
    assert.match(importPayloadSource, /normalizeImportProxy/, 'import payload must normalize custom proxy URLs');
    assert.match(importPayloadSource, /validateCustomProxyUrl/, 'import payload must validate custom proxy URLs');
}

async function runDomSelectorContractRegression() {
    const indexSource = await readFile(resolve(process.cwd(), 'index.html'), 'utf8');
    const navTargets = [...indexSource.matchAll(/data-target="([^"]+)"/g)].map((match) => match[1]);
    navTargets.forEach((target) => {
        assert.match(indexSource, new RegExp(`id="page-${target}"`), `nav target ${target} must have a page section`);
    });

    [
        'genResultList',
        'aiOutput',
        'pension720Output',
        'dataStatusSummary',
        'settingsSyncStateBadge',
        'pwaCacheBadge',
        'pwaCacheNote'
    ].forEach((id) => {
        assert.match(indexSource, new RegExp(`id="${id}"`), `${id} must remain present in index.html`);
    });
}

async function runPwaCacheHealthRegression() {
    const [swSource, pwaCacheHealthSource, pwaUpdateControlsSource, indexSource] = await Promise.all([
        readFile(resolve(process.cwd(), 'sw.js'), 'utf8'),
        readFile(resolve(process.cwd(), 'assets/modules/core/app/pwaInstall/cacheHealth.js'), 'utf8'),
        readFile(resolve(process.cwd(), 'assets/modules/core/app/pwaInstall/updateControls.js'), 'utf8'),
        readFile(resolve(process.cwd(), 'index.html'), 'utf8')
    ]);
    const pwaSource = [pwaCacheHealthSource, pwaUpdateControlsSource].join('\n');

    assert.match(swSource, /CACHE_HEALTH_PATH_SUFFIX = '\/__cache-health\.json'/, 'SW must expose cache health path');
    assert.match(swSource, /failures\.push/, 'SW precache must collect failed assets');
    assert.match(swSource, /lastPrecacheHealth/, 'SW must retain the last precache health payload');
    assert.match(pwaSource, /_refreshPwaCacheHealth/, 'settings code must fetch cache health');
    assert.match(indexSource, /id="pwaCacheBadge"/, 'settings modal must render cache health badge');
    assert.match(pwaCacheHealthSource, /기본 캐시 준비 완료|cacheOk/, 'cache health UI copy must be Korean-facing');
    assert.doesNotMatch(
        pwaCacheHealthSource,
        /precache completed|Cache health will be checked/,
        'cache health UI must not keep English-only status strings'
    );

    const pwaBootstrap = await readFile(resolve(process.cwd(), 'assets/modules/bootstrap/pwa.js'), 'utf8');
    assert.match(
        pwaBootstrap,
        /flushPendingLocalPersistence|flushAppPersistenceBestEffort/,
        'PWA update apply path must flush pending persistence before reload'
    );
    assert.match(pwaBootstrap, /hasPendingAppPersistence|hasPendingLocalPersistence/, 'PWA update path must inspect dirty state');
}

export {
    runAutoSyncAvailabilityRegression,
    runDataManagerLoadNormalizationRegression,
    runDestructiveBackupAbortRegression,
    runDomSelectorContractRegression,
    runImportAllGuardSurfaceRegression,
    runLottoAppInitSequenceRegression,
    runLocalUpdatesDirtyRetryRegression,
    runPension720OfficialCacheRegression,
    runPwaCacheHealthRegression,
    runBackupUnavailableFallbackResultRegression,
    runRemoteRehydrateFlushesPendingPersistenceRegression,
    runStorageDirtyRetainedOnFailureRegression,
    runStrategyWorkerPostMessageCleanupRegression,
    runTemporaryResultsSessionRegression
};
