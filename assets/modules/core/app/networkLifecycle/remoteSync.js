import { CONFIG } from '../../../utils/config.js';
import { UIManager } from '../../UIManager.js';

export const appNetworkLifecycleRemoteSyncMethods = {
    handleRemotePersistenceSync({ keys = [] } = {}) {
        const normalizedKeys = (Array.isArray(keys) ? keys : []).map((key) => String(key || '').trim()).filter(Boolean);
        if (!normalizedKeys.length) return;

        normalizedKeys.forEach((key) => this._remoteStateSyncKeys.add(key));
        if (this._remoteStateSyncTimer) return;

        this._remoteStateSyncTimer = setTimeout(() => {
            const pendingKeys = [...this._remoteStateSyncKeys];
            this._remoteStateSyncKeys.clear();
            this._remoteStateSyncTimer = null;
            void this._rehydrateAfterRemotePersistenceSync(pendingKeys);
        }, 80);
    },

    _syncLoadedModulesFromState() {
        this.generator?.applySavedStrategyPrefs?.();
        this.generator?.presetController?.render?.();
        this.ai?.applySavedStrategyPrefs?.();
        this.ai?.presetController?.render?.();
        this.ai?.renderModelGuide?.();
        this.backtest?.applySavedStrategyPrefs?.();
        this.backtest?.presetController?.render?.();
        this.pension720?.render?.();
    },

    async _rehydrateAfterRemotePersistenceSync(_keys = []) {
        const keySet = new Set(
            (Array.isArray(_keys) ? _keys : []).map((key) => String(key || '').trim()).filter(Boolean)
        );
        const hadPendingLocal = Boolean(this.data.hasPendingLocalPersistence?.());
        if (hadPendingLocal) {
            const flushed = this.data.flushPendingLocalPersistence?.();
            if (flushed === false) {
                console.warn('[persistence] 원격 저장소 동기화를 보류했습니다. 로컬 저장 실패 상태가 남아 있습니다.');
                UIManager.toast(
                    '다른 탭 변경을 반영하지 못했습니다. 로컬 저장 실패 상태를 확인한 뒤 백업을 권장합니다.',
                    'warning',
                    4000
                );
                return;
            }
        }
        this.data.runWithBroadcastSuppressed?.(() => this.data.load());
        if (keySet.has(CONFIG.KEYS.LOCAL_UPDATES)) {
            await this.data.fetchWinningStats?.({ notifyTicketSettle: false });
        }
        if (hadPendingLocal) {
            UIManager.toast(
                '다른 탭 변경과 로컬 미저장 변경이 겹쳤습니다. 로컬을 저장한 뒤 저장소를 다시 불러왔습니다. 일부 항목이 덮어써졌을 수 있습니다.',
                'warning',
                4500
            );
        } else {
            UIManager.toast('다른 탭에서 저장한 데이터를 반영했습니다.', 'info', 2500);
        }
        this.applyTheme();
        this.renderSettingsPanel?.();
        this.updateLatestWin?.();
        this.bindTargetDrawInputs?.();
        this._syncLoadedModulesFromState?.();
        await this.refreshCurrentRoute?.();
        if (this.currentRoute === 'data') {
            this.renderDataLists?.();
        }
    }
};