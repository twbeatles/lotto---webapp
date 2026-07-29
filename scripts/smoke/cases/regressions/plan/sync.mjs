const syncPlan = [
    {
        name: 'runSyncGuardRegression',
        label: 'sync-guard regression',
        awaited: true
    },
    {
        name: 'runRequestNumbersRegression',
        label: 'requestNumbers replace regression',
        awaited: true
    },
    {
        name: 'runRefreshCurrentRouteStaleRegression',
        label: 'refreshCurrentRoute stale regression',
        awaited: true
    },
    {
        name: 'runSyncLatestWinRefreshRegression',
        label: 'sync-latest-win refresh regression',
        awaited: true
    },
    {
        name: 'runWinningStatsLoadClassificationRegression',
        label: 'winning-stats load classification regression',
        awaited: true
    },
    {
        name: 'runUnexpectedStaticHoleClassificationRegression',
        label: 'unexpected static-hole classification regression'
    },
    {
        name: 'runExpectedMissingDrawAllowanceRegression',
        label: 'expected missing-draw allowance regression'
    },
    {
        name: 'runMergedLocalUpdatesGapClassificationRegression',
        label: 'merged local-updates gap classification regression'
    },
    {
        name: 'runPartialWinningStatsRecoveryRegression',
        label: 'partial winning-stats recovery regression',
        awaited: true
    },
    {
        name: 'runLocalRestoreSyncMetaRegression',
        label: 'local-restore sync-meta regression',
        awaited: true
    },
    {
        name: 'runRouteDataGateRegression',
        label: 'route data-gate regression'
    },
    {
        name: 'runSyncInvalidPayloadRegression',
        label: 'sync invalid payload regression',
        awaited: true
    },
    {
        name: 'runSyncPayloadDrawIntegerGuardRegression',
        label: 'sync payload draw integer guard regression'
    },
    {
        name: 'runMalformedDrawDateRejectedRegression',
        label: 'malformed draw date rejection regression'
    },
    {
        name: 'runWinningStatsPreserveExistingOnStaticFailureRegression',
        label: 'winning-stats transient failure preserve regression',
        awaited: true
    },
    {
        name: 'runWinningStatsPreserveExistingWithLocalUpdatesRegression',
        label: 'winning-stats static-failure local-update preserve regression',
        awaited: true
    },
    {
        name: 'runStaticDataFreshnessBudgetRegression',
        label: 'static data freshness budget regression',
        awaited: true
    },
    {
        name: 'runEstimateLatestDrawKstBoundaryRegression',
        label: 'estimate latest draw KST boundary regression'
    },
    {
        name: 'runProxyWorkerDrawScheduleAndFutureCapRegression',
        label: 'proxy worker draw schedule/future-cap regression',
        awaited: true
    },
    {
        name: 'runProxyWorkerUrlPassthroughPathAllowlistRegression',
        label: 'proxy worker url passthrough path allowlist regression',
        awaited: true
    },
    {
        name: 'runProxyWorkerCorsOriginAllowlistRegression',
        label: 'proxy worker cors origin allowlist regression'
    },
    {
        name: 'runLottoOfficialFreshnessComparisonRegression',
        label: 'lotto official freshness comparison regression'
    },
    {
        name: 'runLottoOfficialFetchRetryRegression',
        label: 'lotto official fetch retry regression',
        awaited: true
    },
    {
        name: 'runLottoOfficialFetchWrappedErrorRegression',
        label: 'lotto official fetch wrapped-error regression'
    },
    {
        name: 'runBuiltInSyncProviderRegression',
        label: 'built-in sync provider regression'
    },
    {
        name: 'runSyncThirdPartyProviderNoticeRegression',
        label: 'sync third-party provider notice regression',
        awaited: true
    }
];

export { syncPlan };
