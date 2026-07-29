export const ANALYSIS_PRESETS = {
    fast: {
        label: '빠름',
        simulationCount: 2000,
        lookbackWindow: 12
    },
    basic: {
        label: '기본',
        simulationCount: 5000,
        lookbackWindow: 20
    },
    precise: {
        label: '정밀',
        simulationCount: 12000,
        lookbackWindow: 40
    }
};

/** Coarse pointer / narrow viewport clients prefer lighter analysis defaults. */
export function isConstrainedClient() {
    if (typeof window === 'undefined') return false;
    try {
        if (typeof navigator !== 'undefined' && Number(navigator.hardwareConcurrency) > 0 && navigator.hardwareConcurrency <= 4) {
            if (window.matchMedia?.('(max-width: 900px)')?.matches) return true;
        }
        if (window.matchMedia?.('(pointer: coarse)')?.matches) return true;
        if (window.matchMedia?.('(max-width: 768px)')?.matches) return true;
    } catch (_e) {
        return false;
    }
    return false;
}

export function getDefaultAnalysisPresetId() {
    return isConstrainedClient() ? 'fast' : 'basic';
}

export function getAnalysisPreset(id = 'basic') {
    return ANALYSIS_PRESETS[id] || ANALYSIS_PRESETS.basic;
}

/**
 * On phones / coarse pointers, switch stock "basic" defaults to "fast" unless the user already customized.
 * @returns {string|null} applied preset id, or null when unchanged
 */
export function preferConstrainedClientAnalysisDefaults(prefix) {
    if (typeof document === 'undefined' || !isConstrainedClient()) return null;
    const simulation = Number(document.getElementById(`${prefix}SimulationCount`)?.value || 0);
    const lookback = Number(document.getElementById(`${prefix}LookbackWindow`)?.value || 0);
    const basic = ANALYSIS_PRESETS.basic;
    const atStockBasic = simulation === basic.simulationCount && lookback === basic.lookbackWindow;
    if (!atStockBasic) return null;
    applyAnalysisPresetToFields(prefix, 'fast');
    return 'fast';
}

export function applyAnalysisPresetToFields(prefix, presetId = 'basic') {
    const preset = getAnalysisPreset(presetId);
    const simulation = document.getElementById(`${prefix}SimulationCount`);
    const lookback = document.getElementById(`${prefix}LookbackWindow`);
    const select = document.getElementById(`${prefix}AnalysisPreset`);

    if (simulation) simulation.value = String(preset.simulationCount);
    if (lookback) lookback.value = String(preset.lookbackWindow);
    if (select) select.value = ANALYSIS_PRESETS[presetId] ? presetId : 'basic';
    return preset;
}

export function inferAnalysisPresetFromFields(prefix) {
    const simulation = Number(document.getElementById(`${prefix}SimulationCount`)?.value || 0);
    const lookback = Number(document.getElementById(`${prefix}LookbackWindow`)?.value || 0);
    const matched = Object.entries(ANALYSIS_PRESETS).find(([, preset]) => {
        return preset.simulationCount === simulation && preset.lookbackWindow === lookback;
    });
    return matched?.[0] || 'custom';
}

export function syncAnalysisPresetSelect(prefix) {
    const select = document.getElementById(`${prefix}AnalysisPreset`);
    if (!select) return 'custom';
    const presetId = inferAnalysisPresetFromFields(prefix);
    select.value = presetId === 'custom' ? 'custom' : presetId;
    return presetId;
}
