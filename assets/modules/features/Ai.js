import { $ } from '../utils/utils.js';
import { StrategyEngine } from '../core/StrategyEngine.js';
import { StrategyWorkerClient } from '../core/StrategyWorkerClient.js';
import { StrategyPresetController } from '../utils/strategyPresets.js';
import {
    applyAnalysisPresetToFields,
    preferConstrainedClientAnalysisDefaults,
    syncAnalysisPresetSelect
} from '../utils/analysisPresets.js';
import { aiFormMethods } from './ai/form.js';
import { aiRenderingMethods } from './ai/rendering.js';

export class AiModule {
    constructor(app) {
        this.app = app;
        this.engine = new StrategyEngine(this.app.data.state.winningStats);
        this.workerClient = this.app.strategyWorker || new StrategyWorkerClient();
        this.lastRequest = null;
        this.lastExplain = [];
        this.lastRuntimeSeed = null;
        this.runToken = 0;
        this.isRecommending = false;
        this.outputDelegationBound = false;

        const btn = $('#aiPredictBtn');
        if (btn) btn.addEventListener('click', () => this.run());

        $('#aiShowExperimental')?.addEventListener('change', () => {
            this.populateStrategySelect();
            this.renderModelGuide();
        });
        $('#aiModelSelect')?.addEventListener('change', () => this.renderModelGuide());
        $('#aiAnalysisPreset')?.addEventListener('change', (e) => {
            if (e.currentTarget.value === 'custom') return;
            applyAnalysisPresetToFields('ai', e.currentTarget.value);
        });
        ['#aiSimulationCount', '#aiLookbackWindow'].forEach((selector) => {
            $(selector)?.addEventListener('input', () => syncAnalysisPresetSelect('ai'));
        });

        this.populateStrategySelect();
        this.applySavedStrategyPrefs();
        preferConstrainedClientAnalysisDefaults('ai');
        this.presetController = new StrategyPresetController({
            data: this.app.data,
            scope: 'ai',
            selectId: 'aiPresetSelect',
            loadBtnId: 'aiPresetLoadBtn',
            saveBtnId: 'aiPresetSaveBtn',
            deleteBtnId: 'aiPresetDeleteBtn',
            getRequest: () => this.buildStrategyRequest(),
            applyRequest: (request) => this.applyStrategyRequest(request)
        });
        this.renderModelGuide();
        this.bindOutputDelegation();

        if (this.app.data.state.aiResults && this.app.data.state.aiResults.length > 0) {
            this.renderResults(this.app.data.state.aiResults);
        }
    }
}

Object.assign(AiModule.prototype, aiFormMethods, aiRenderingMethods);
