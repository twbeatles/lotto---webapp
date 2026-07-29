import { UI_STRINGS } from '../../../utils/strings.js';

export const appPwaInstallCacheHealthMethods = {
    async _refreshPwaCacheHealth() {
        if (typeof fetch !== 'function') return null;
        try {
            const response = await fetch('./__cache-health.json', { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const payload = await response.json();
            this._pwaCacheHealth = {
                available: true,
                ok: payload?.ok !== false,
                cacheVersion: String(payload?.cacheVersion || ''),
                checkedAt: String(payload?.checkedAt || ''),
                failures: Array.isArray(payload?.failures) ? payload.failures : []
            };
        } catch (error) {
            this._pwaCacheHealth = {
                available: false,
                ok: false,
                cacheVersion: '',
                checkedAt: '',
                failures: [],
                message: String(error?.message || error || '')
            };
        }
        this.renderPwaCacheHealth?.();
        return this._pwaCacheHealth;
    },

    renderPwaCacheHealth() {
        const badge = document.getElementById('pwaCacheBadge');
        const note = document.getElementById('pwaCacheNote');
        if (!badge && !note) return;

        const copy = UI_STRINGS.pwa || {};
        const health = this._pwaCacheHealth;
        let state = { label: copy.badgePending || '확인 전', code: 'prompt' };
        let message = copy.cachePending || '서비스 워커 활성화 후 캐시 상태를 확인합니다.';
        if (health?.available) {
            const count = health.failures?.length || 0;
            state = count
                ? { label: copy.badgeWarning?.(count) || `주의 ${count}`, code: 'warning' }
                : { label: copy.badgeOk || '정상', code: 'success' };
            message = count
                ? copy.cacheWarning?.(count) || `캐시 실패 ${count}건. 앱 업데이트를 확인한 뒤 다시 살펴보세요.`
                : copy.cacheOk?.(health.cacheVersion) ||
                  (health.cacheVersion ? `기본 캐시 준비 완료 (${health.cacheVersion})` : '기본 캐시 준비 완료');
        } else if (health) {
            state = { label: copy.badgeNotReady || '준비 중', code: 'prompt' };
            message = copy.cacheNotReady || '아직 캐시 상태를 읽을 수 없습니다. 설치 직후에는 정상일 수 있습니다.';
        }

        if (badge) {
            badge.textContent = state.label;
            badge.className = `badge ${this.getStatusBadgeClass?.(state.code)}`;
        }
        if (note) note.textContent = message;
    }
};
