import { StrategyEngine } from '../core/StrategyEngine.js';
import { StrategyWorkerClient } from '../core/StrategyWorkerClient.js';
import { StrategyPresetController } from '../utils/strategyPresets.js';
import { preferConstrainedClientAnalysisDefaults } from '../utils/analysisPresets.js';
import { UI_STRINGS } from '../utils/strings.js';
import { generatorFormMethods } from './generator/form.js';
import { generatorActionMethods } from './generator/actions.js';

export class GeneratorModule {
    constructor(app) {
        this.app = app;
        this.data = app.data;
        this.engine = new StrategyEngine(this.data.state.winningStats);
        this.workerClient = this.app.strategyWorker || new StrategyWorkerClient();
        this.boundDelegation = false;
        this.isGenerating = false;
        this.isGeneratingCampaign = false;
        this.lastRuntimeSeed = null;
        this.generationToken = 0;
        this.campaignToken = 0;
        this.generateBtnOriginalHtml = '';
        this.campaignBtnOriginalHtml = '';
        this.uiStrings = UI_STRINGS.generator;
        this.bindEvents();
        this.populateStrategySelect();
        this.applySavedStrategyPrefs();
        preferConstrainedClientAnalysisDefaults('gen');
        this.presetController = new StrategyPresetController({
            data: this.data,
            scope: 'generator',
            selectId: 'genPresetSelect',
            loadBtnId: 'genPresetLoadBtn',
            saveBtnId: 'genPresetSaveBtn',
            deleteBtnId: 'genPresetDeleteBtn',
            getRequest: () => this.getStrategyRequestFromUI(),
            applyRequest: (request) => this.applyStrategyRequest(request)
        });
        this.resetCampaignOptions(false);
        this.renderStoredGeneratedEntries?.();
    }
}

Object.assign(GeneratorModule.prototype, generatorFormMethods, generatorActionMethods);
