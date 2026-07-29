import { CONFIG } from '../../../utils/config.js';
import { $ } from '../../../utils/utils.js';
import { UIManager } from '../../../core/UIManager.js';
import { StrategyEngine } from '../../../core/StrategyEngine.js';
import { createRuntimeRng, withRuntimeSeed } from '../../../core/strategy/runtimeEntropy.js';
import { endMark, startMark } from '../../../utils/perf.js';
import { UI_STRINGS } from '../../../utils/strings.js';
import { deriveCampaignRuntimeRequest } from './helpers.js';

export const generatorActionCampaignMethods = {
    async generateCampaign() {
        if (this.isGenerating || this.isGeneratingCampaign) return false;
        startMark('generator.campaign');
        let inserted = 0;
        let totalCreated = 0;
        let weeks = 0;
        let setsPerWeek = 0;
        let requestedTotal = 0;
        let fallbackRuns = 0;
        if (!Number.isFinite(this.campaignToken)) this.campaignToken = 0;
        const localToken = ++this.campaignToken;
        const uiStrings = this.uiStrings || UI_STRINGS.generator;
        this.isGeneratingCampaign = true;
        this.syncBusyButtons?.();

        try {
            if (!Array.isArray(this.data.state.winningStats) || !this.data.state.winningStats.length) {
                UIManager.toast(uiStrings.dataUnavailable || '당첨 데이터가 없습니다. 데이터 파일을 확인해주세요.', 'error', 3000);
                return false;
            }

            const startDraw = Math.max(
                1,
                Math.floor(
                    this.readNumberInput('campStartDraw', (this.app.data.state.winningStats?.[0]?.draw_no || 0) + 1)
                )
            );
            weeks = Math.max(1, Math.floor(this.readNumberInput('campWeeks', 4)));
            setsPerWeek = Math.max(1, Math.floor(this.readNumberInput('campSetsPerWeek', 3)));
            requestedTotal = weeks * setsPerWeek;
            const fixed = this.parseInput($('#fixedNums').value);
            const exclude = this.parseInput($('#excludeNums').value);
            const request = this.getStrategyRequestFromUI();

            if (fixed.length > CONFIG.LIMITS.MAX_FIXED) {
                UIManager.toast(`고정수는 최대 ${CONFIG.LIMITS.MAX_FIXED}개입니다.`, 'error');
                return;
            }
            if (weeks > CONFIG.LIMITS.MAX_CAMPAIGN_WEEKS) {
                UIManager.toast(`캠페인 주차 수는 최대 ${CONFIG.LIMITS.MAX_CAMPAIGN_WEEKS}주입니다.`, 'warning');
                return;
            }
            if (setsPerWeek > CONFIG.LIMITS.MAX_CAMPAIGN_SETS_PER_WEEK) {
                UIManager.toast(
                    `주당 세트 수는 최대 ${CONFIG.LIMITS.MAX_CAMPAIGN_SETS_PER_WEEK}세트입니다.`,
                    'warning'
                );
                return;
            }
            if (requestedTotal > CONFIG.LIMITS.MAX_CAMPAIGN_TOTAL_TICKETS) {
                UIManager.toast(
                    `캠페인 총 티켓 수는 최대 ${CONFIG.LIMITS.MAX_CAMPAIGN_TOTAL_TICKETS}개입니다.`,
                    'warning'
                );
                return;
            }

            this.engine = new StrategyEngine(this.data.state.winningStats);

            const tickets = [];
            const campaignId = this.data.createId('campaign');
            for (let i = 0; i < weeks; i++) {
                const targetDrawNo = startDraw + i;
                const runtimeRequest = deriveCampaignRuntimeRequest(request, i);
                let sets = [];
                let fallback = false;
                const workerPayload = withRuntimeSeed({
                    statsData: this.data.state.winningStats,
                    count: setsPerWeek,
                    request: runtimeRequest,
                    fixed,
                    exclude,
                    maxAttempts: Math.max(240, setsPerWeek * 120)
                });
                startMark('generator.worker');
                try {
                    const result = await this.workerClient.generate(workerPayload);
                    sets = Array.isArray(result?.sets) ? result.sets : [];
                } catch (err) {
                    fallback = true;
                    fallbackRuns++;
                    if (this.isWorkerTimeoutError(err)) {
                        UIManager.toast(uiStrings.workerFallbackCampaign, 'warning');
                    }
                    console.warn('캠페인 생성 워커 실패, 메인 스레드로 대체합니다.', err);
                    const runtimeRng = createRuntimeRng(runtimeRequest, workerPayload.runtimeSeed);
                    sets = this.engine.generateMultipleSets(setsPerWeek, runtimeRequest, {
                        fixed,
                        exclude,
                        maxAttempts: Math.max(240, setsPerWeek * 120),
                        ...(runtimeRng ? { rng: runtimeRng } : {})
                    });
                } finally {
                    endMark('generator.worker', {
                        count: sets.length,
                        requested: setsPerWeek,
                        fallback,
                        campaign: true
                    });
                }

                sets.forEach((numbers) => {
                    tickets.push({
                        id: this.data.createId('ticket'),
                        numbers,
                        targetDrawNo,
                        source: 'generator',
                        campaignId,
                        strategyRequest: runtimeRequest,
                        memo: `캠페인 ${startDraw}-${startDraw + weeks - 1}`,
                        createdAt: new Date().toISOString(),
                        checked: null
                    });
                    totalCreated++;
                });
            }

            if (localToken !== this.campaignToken) return false;
            const bulkResult = this.data.addTicketsBulk(tickets, { silent: true });
            inserted = bulkResult.addedQuantity;
            let campaign = null;
            if (bulkResult.insertedRows > 0) {
                campaign = this.data.addCampaign({
                    id: campaignId,
                    name: `${startDraw}회 시작 ${weeks}주`,
                    startDrawNo: startDraw,
                    weeks,
                    setsPerWeek,
                    strategyRequest: request
                });
            }
            this.data.save();

            if (totalCreated < requestedTotal) {
                UIManager.toast(`필터 조건으로 ${totalCreated}/${requestedTotal}개만 생성되었습니다.`, 'warning', 3500);
            }
            if (inserted > 0) {
                UIManager.toast(
                    `캠페인 생성 완료: 티켓 ${inserted}개 반영${bulkResult.insertedRows !== inserted ? ` (${bulkResult.insertedRows}개 조합)` : ''}`,
                    'success'
                );
            } else if (totalCreated > 0) {
                UIManager.toast('생성된 티켓이 모두 중복되어 캠페인을 저장하지 않았습니다.', 'warning', 3500);
            } else {
                UIManager.toast('생성된 티켓이 없어 캠페인을 저장하지 않았습니다.', 'warning', 3500);
            }
            if (campaign && this.app.renderDataLists) this.app.renderDataLists();
        } finally {
            if (localToken === this.campaignToken) {
                this.isGeneratingCampaign = false;
                this.syncBusyButtons?.();
            }
            endMark('generator.campaign', { inserted, totalCreated, requestedTotal, weeks, setsPerWeek, fallbackRuns });
        }
    }
};