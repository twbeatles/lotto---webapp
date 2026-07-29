const coreStrategyPlan = [
    {
        name: 'runStrictFilterRegression',
        label: 'strict-filter regression',
        argKey: 'stats180'
    },
    {
        name: 'runGenerateMultipleSetsMaxCountRegression',
        label: 'generateMultipleSets maxCount regression',
        argKey: 'stats180'
    },
    {
        name: 'runWheelFixedNumbersRegression',
        label: 'wheel-fixed regression',
        argKey: 'stats180'
    },
    {
        name: 'runAdaptiveRecommendationDiagnosticsRegression',
        label: 'adaptive recommendation diagnostics regression',
        argKey: 'stats180'
    },
    {
        name: 'runStrategyWorkerFinalTimeoutTerminatesRegression',
        label: 'strategy worker final-timeout termination regression',
        awaited: true
    },
    {
        name: 'runStrategyWorkerStatsCacheEmptyRetryRegression',
        label: 'strategy worker cache-empty retry regression',
        awaited: true
    },
    {
        name: 'runStrategyWorkerStatsFingerprintRegression',
        label: 'strategy worker stats fingerprint regression',
        awaited: true
    },
    {
        name: 'runDrawNormalizationRegression',
        label: 'draw-normalization regression'
    },
    {
        name: 'runFacadeExportParityRegression',
        label: 'facade export parity regression'
    },
    {
        name: 'runCampaignLimitRegression',
        label: 'campaign-limit regression'
    },
    {
        name: 'runCampaignCascadeRegression',
        label: 'campaign-cascade regression'
    },
    {
        name: 'runGeneratorStrategySelectionRegression',
        label: 'generator strategy-selection regression',
        awaited: true
    },
    {
        name: 'runGeneratorSetCountClampRegression',
        label: 'generator set-count clamp regression',
        awaited: true
    },
    {
        name: 'runGeneratorDataUnavailableGuardRegression',
        label: 'generator data-unavailable guard regression',
        awaited: true
    },
    {
        name: 'runCampaignDerivedSeedRegression',
        label: 'campaign derived-seed regression',
        argKey: 'stats180'
    },
    {
        name: 'runNoSeedRuntimeEntropyRegression',
        label: 'no-seed runtime entropy regression',
        argKey: 'stats180'
    },
    {
        name: 'runQrValidationRegression',
        label: 'qr-validation regression'
    }
];

export { coreStrategyPlan };
