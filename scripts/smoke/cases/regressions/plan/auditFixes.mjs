const auditFixesPlan = [
    {
        name: 'runPension720RemoteFetchCandidateRegression',
        label: 'pension720 remote fetch candidate regression'
    },
    {
        name: 'runPension720OfficialRemoteSimpleCorsRegression',
        label: 'pension720 official remote simple CORS regression',
        awaited: true
    },
    {
        name: 'runQueryProxyAckRegression',
        label: 'query proxy acknowledgement regression'
    },
    {
        name: 'runQueryProxyConfirmFailClosedRegression',
        label: 'query proxy confirm fail-closed regression',
        awaited: true
    },
    {
        name: 'runImportInFlightGuardRegression',
        label: 'import in-flight guard regression',
        awaited: true
    },
    {
        name: 'runStrategyWorkerQueueRegression',
        label: 'strategy worker queue regression',
        awaited: true
    },
    {
        name: 'runProxyWorkerPension720ListRouteRegression',
        label: 'proxy worker pension720 list route regression',
        awaited: true
    },
    {
        name: 'runDataSourceAbstractionRegression',
        label: 'data source abstraction regression'
    },
    {
        name: 'runOfficialApiFieldAliasRegression',
        label: 'official api field alias regression'
    },
    {
        name: 'runThirdPartyProxyShapeRegression',
        label: 'third-party proxy shape regression'
    },
    {
        name: 'runPension720SyncMetaRegression',
        label: 'pension720 sync meta regression'
    },
    {
        name: 'runSharedLottoPayloadExtractionRegression',
        label: 'shared lotto payload extraction regression'
    },
    {
        name: 'runMaliciousProxyTamperedDrawRegression',
        label: 'malicious proxy tampered draw regression'
    },
    {
        name: 'runLocalStoragePartialFailureUiRegression',
        label: 'localStorage partial failure ui regression',
        awaited: true
    }
];

export { auditFixesPlan };