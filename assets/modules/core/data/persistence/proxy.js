import { CONFIG } from '../../../utils/config.js';
import { UIManager } from '../../UIManager.js';

export const dataPersistenceProxyMethods = {
    _queryProxyRejected: '',
    getCustomProxyInput() {
        return (this.state.customProxy || '').trim();
    },

    validateCustomProxyUrl(rawUrl = '') {
        const input = String(rawUrl || '').trim();
        if (!input) {
            return {
                input: '',
                normalizedUrl: '',
                valid: false,
                empty: true,
                reason: ''
            };
        }

        try {
            const parsed = new URL(input);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                return {
                    input,
                    normalizedUrl: '',
                    valid: false,
                    empty: false,
                    reason: 'http(s) 주소만 지원합니다.'
                };
            }
            if (!parsed.pathname.includes('/proxy/latest')) {
                return {
                    input,
                    normalizedUrl: '',
                    valid: false,
                    empty: false,
                    reason: '공식 지원 형식은 /proxy/latest 엔드포인트입니다.'
                };
            }
            return {
                input,
                normalizedUrl: parsed.toString(),
                valid: true,
                empty: false,
                reason: ''
            };
        } catch (_e) {
            return {
                input,
                normalizedUrl: '',
                valid: false,
                empty: false,
                reason: '절대 URL 형식으로 입력해주세요.'
            };
        }
    },

    buildProxyConfig(source, rawUrl) {
        const validation = this.validateCustomProxyUrl(rawUrl);
        if (validation.empty) return null;
        return {
            source,
            input: validation.input,
            url: validation.valid ? validation.normalizedUrl : '',
            invalid: !validation.valid,
            invalidReason: validation.reason
        };
    },

    readLegacyProxyUrl() {
        if (typeof localStorage === 'undefined') return '';
        const direct = (localStorage.getItem(CONFIG.KEYS.LEGACY_PROXY) || '').trim();
        if (direct) return direct;

        const legacySettingsRaw = localStorage.getItem(CONFIG.KEYS.LEGACY_SETTINGS);
        if (!legacySettingsRaw) return '';
        try {
            const legacySettings = JSON.parse(legacySettingsRaw);
            return (legacySettings?.proxyLatestUrl || '').trim();
        } catch (_e) {
            return '';
        }
    },

    getQueryProxyUrl() {
        try {
            const params = new URLSearchParams(window.location.search);
            const proxyUrl = (params.get('proxyUrl') || '').trim();
            if (proxyUrl) return this.buildProxyConfig('URL 쿼리(proxyUrl)', proxyUrl);
            const proxy = (params.get('proxy') || '').trim();
            if (proxy) return this.buildProxyConfig('URL 쿼리(proxy)', proxy);
        } catch (_e) {
            return null;
        }
        return null;
    },

    _getQueryProxyFingerprint(queryProxy) {
        return String(queryProxy?.input || queryProxy?.url || '').trim();
    },

    _isQueryProxySuppressed(queryProxy) {
        const fingerprint = this._getQueryProxyFingerprint(queryProxy);
        return Boolean(fingerprint && fingerprint === this._queryProxyRejected);
    },

    async ensureQueryProxyAcknowledged() {
        const queryProxy = this.getQueryProxyUrl();
        // buildProxyConfig exposes { url, invalid } (not `valid`)
        if (!queryProxy?.url || queryProxy.invalid) return true;
        if (this._isQueryProxySuppressed(queryProxy)) return false;

        const fingerprint = this._getQueryProxyFingerprint(queryProxy);
        try {
            if (sessionStorage.getItem(CONFIG.KEYS.SESSION_QUERY_PROXY_ACK) === fingerprint) {
                return true;
            }
        } catch (_e) {
            // sessionStorage unavailable
        }

        // Fail closed: never auto-accept a query proxy without an explicit user confirm.
        if (typeof UIManager?.confirm !== 'function') {
            this._queryProxyRejected = fingerprint;
            if (typeof UIManager?.toast === 'function') {
                UIManager.toast(
                    '확인 대화상자를 사용할 수 없어 URL 프록시를 무시합니다. 설정에서 신뢰할 수 있는 주소를 저장하세요.',
                    'warning',
                    4000
                );
            }
            return false;
        }

        const confirmed = await UIManager.confirm({
            title: 'URL 데이터 연결 주소 확인',
            message: [
                '이 페이지 주소에 데이터 연결 프록시가 포함되어 있습니다.',
                '',
                fingerprint,
                '',
                '신뢰할 수 있는 주소인지 확인한 뒤 사용해 주세요. 취소하면 이번 세션에서는 URL 프록시를 무시하고 저장된 설정·기본 자동 동기화를 사용합니다.'
            ].join('\n'),
            confirmText: '이 주소 사용',
            cancelText: '무시'
        });

        if (!confirmed) {
            this._queryProxyRejected = fingerprint;
            UIManager.toast('URL 프록시를 무시하고 기본 동기화 경로를 사용합니다.', 'info', 3500);
            return false;
        }

        try {
            sessionStorage.setItem(CONFIG.KEYS.SESSION_QUERY_PROXY_ACK, fingerprint);
        } catch (_e) {
            // ignore session write failures
        }
        return true;
    },

    resolveProxyConfig() {
        const queryProxy = this.getQueryProxyUrl();
        if (queryProxy && !this._isQueryProxySuppressed(queryProxy)) return queryProxy;

        const legacyProxy = this.readLegacyProxyUrl();
        if (legacyProxy) return this.buildProxyConfig('legacy settings (v1)', legacyProxy);

        const v2Proxy = (this.state.customProxy || '').trim();
        if (v2Proxy) return this.buildProxyConfig('saved settings (v2)', v2Proxy);

        return {
            source: '미설정',
            input: '',
            url: '',
            invalid: false,
            invalidReason: ''
        };
    }
};
