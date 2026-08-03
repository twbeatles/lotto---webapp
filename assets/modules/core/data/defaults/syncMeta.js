import { $ } from '../../../utils/utils.js';

export const dataDefaultsSyncMetaMethods = {
    getDefaultPension720SyncMeta() {
        return {
            currentSource: '',
            lastSuccessAt: '',
            lastSuccessDrawNo: 0,
            lastFailureAt: '',
            lastFailureMessage: ''
        };
    },

    mergePension720SyncMeta(raw) {
        const defaults = this.getDefaultPension720SyncMeta();
        const input = raw && typeof raw === 'object' ? raw : {};
        return {
            currentSource:
                typeof input.currentSource === 'string'
                    ? input.currentSource.slice(0, 80)
                    : defaults.currentSource,
            lastSuccessAt: typeof input.lastSuccessAt === 'string' ? input.lastSuccessAt : defaults.lastSuccessAt,
            lastSuccessDrawNo: Math.max(0, Math.floor(Number(input.lastSuccessDrawNo || 0))),
            lastFailureAt: typeof input.lastFailureAt === 'string' ? input.lastFailureAt : defaults.lastFailureAt,
            lastFailureMessage:
                typeof input.lastFailureMessage === 'string'
                    ? input.lastFailureMessage.slice(0, 240)
                    : defaults.lastFailureMessage
        };
    },

    getDefaultSyncMeta() {
        return {
            mode: 'automatic_fallback',
            currentSource: '기본 자동 동기화',
            lastSuccessAt: '',
            lastSuccessDrawNo: 0,
            lastFailureAt: '',
            lastFailureMessage: '',
            lastWarningAt: '',
            lastWarningMessage: '',
            pension720: this.getDefaultPension720SyncMeta()
        };
    },

    mergeSyncMeta(raw) {
        const defaults = this.getDefaultSyncMeta();
        const input = raw && typeof raw === 'object' ? raw : {};
        const lastSuccessDrawNo = Math.max(0, Math.floor(Number(input.lastSuccessDrawNo || 0)));
        return {
            mode: typeof input.mode === 'string' && input.mode.trim() ? input.mode.trim() : defaults.mode,
            currentSource:
                typeof input.currentSource === 'string' && input.currentSource.trim()
                    ? input.currentSource.trim()
                    : defaults.currentSource,
            lastSuccessAt: typeof input.lastSuccessAt === 'string' ? input.lastSuccessAt : defaults.lastSuccessAt,
            lastSuccessDrawNo,
            lastFailureAt: typeof input.lastFailureAt === 'string' ? input.lastFailureAt : defaults.lastFailureAt,
            lastFailureMessage:
                typeof input.lastFailureMessage === 'string'
                    ? input.lastFailureMessage.slice(0, 240)
                    : defaults.lastFailureMessage,
            lastWarningAt: typeof input.lastWarningAt === 'string' ? input.lastWarningAt : defaults.lastWarningAt,
            lastWarningMessage:
                typeof input.lastWarningMessage === 'string'
                    ? input.lastWarningMessage.slice(0, 240)
                    : defaults.lastWarningMessage,
            pension720: this.mergePension720SyncMeta(input.pension720)
        };
    },

    getSyncMode(proxyConfig = this.resolveProxyConfig()) {
        return proxyConfig?.url ? 'custom_proxy' : 'automatic_fallback';
    },

    getSyncModeLabel(mode = this.state.syncMeta?.mode) {
        if (mode === 'local_restore') return '로컬 복원';
        if (mode === 'local_restore_failed') return '로컬 복원 실패';
        if (mode === 'custom_proxy' || mode === 'proxy_opt_in') return '고급 연결 주소';
        if (mode === 'automatic_fallback') return '기본 자동 동기화';
        return '기본 포함 데이터 전용';
    },

    getSyncSourceLabel(proxyConfig = this.resolveProxyConfig()) {
        if (proxyConfig?.url) return proxyConfig.source || '고급 연결 주소';
        return '기본 자동 동기화';
    },

    setSyncControlsState({ running = false, cancelable = false } = {}) {
        if (typeof document === 'undefined') return;

        const syncBtn = $('#syncDataBtn');
        const refreshBtn = $('#refreshDataBtn');
        const cancelBtn = $('#cancelSyncBtn');

        if (syncBtn) syncBtn.disabled = running;
        if (refreshBtn) refreshBtn.disabled = running;
        if (cancelBtn) {
            cancelBtn.disabled = !running || !cancelable;
            cancelBtn.style.display = running ? 'inline-flex' : 'none';
        }
    },

    createAbortError(message = 'Sync aborted') {
        const err = new Error(message);
        err.name = 'AbortError';
        return err;
    },

    createTimeoutError(timeoutMs = this.SYNC_FETCH_TIMEOUT_MS || 4500) {
        const ms = Math.max(0, Math.floor(Number(timeoutMs) || 0));
        const err = new Error(`Request timed out after ${ms}ms`);
        err.name = 'TimeoutError';
        err.code = 'SYNC_FETCH_TIMEOUT';
        return err;
    },

    isActiveSyncRun(runId) {
        if (!runId) return true;
        return runId === this._activeSyncRunId;
    },

    ensureActiveSyncRun(runId) {
        if (!this.isActiveSyncRun(runId)) {
            throw this.createAbortError('Sync aborted');
        }
        return true;
    },

    abortSyncInFlight({ force = false } = {}) {
        if (!this.syncAbortController) return false;
        if (!force && !this.syncCancelable) return false;
        if (this.syncAbortController.signal.aborted) return false;
        this.syncAbortController.abort();
        return true;
    },

    isTimeoutError(err) {
        if (!err) return false;
        if (err.name === 'TimeoutError' || err.code === 'SYNC_FETCH_TIMEOUT') return true;
        return /timed out after|request timed out/i.test(String(err.message || ''));
    },

    isAbortError(err) {
        if (!err) return false;
        // Client-side request timeouts must not look like user cancel (toast/short-circuit).
        if (this.isTimeoutError(err)) return false;
        if (String(err.message || '') === 'Sync aborted') return true;
        if (err.name === 'AbortError') {
            const message = String(err.message || '');
            if (/timed out|timeout/i.test(message)) return false;
            return true;
        }
        return false;
    },

    cancelActiveSync() {
        return this.abortSyncInFlight({ force: false });
    }
};