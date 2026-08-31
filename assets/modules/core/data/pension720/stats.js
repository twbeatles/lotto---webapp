import { CONFIG } from '../../../utils/config.js';
import { resolveRemoteDataSourceFromFetch, REMOTE_DATA_SOURCE } from '../dataSource.js';
import { normalizePension720Draw } from './normalize.js';
import {
    buildPension720RemoteFetchCandidates,
    extractPension720ListFromPayload,
    parsePension720RemotePayload,
    PENSION720_OFFICIAL_LIST_URL
} from './remoteFetch.js';

function extractOfficialList(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.data?.result)) return payload.data.result;
    if (Array.isArray(payload?.result)) return payload.result;
    return [];
}

export const dataPension720StatsMethods = {
    normalizePension720DrawItem(raw) {
        return normalizePension720Draw(raw);
    },

    normalizePension720Stats(items = []) {
        const map = new Map();
        (Array.isArray(items) ? items : []).forEach((item) => {
            const normalized = this.normalizePension720DrawItem(item);
            if (!normalized) return;
            map.set(normalized.draw_no, normalized);
        });
        return Array.from(map.values()).sort((a, b) => b.draw_no - a.draw_no);
    },

    readPension720StatsCache() {
        if (typeof localStorage === 'undefined') return [];
        try {
            const raw = this.safeJsonParse(
                localStorage.getItem(CONFIG.KEYS.PENSION720_STATS_CACHE) || '{}',
                {},
                CONFIG.KEYS.PENSION720_STATS_CACHE
            );
            if (Number(raw?.version || 0) !== 1) return [];
            return this.normalizePension720Stats(raw.items || []);
        } catch (_e) {
            return [];
        }
    },

    writePension720StatsCache(items = []) {
        if (typeof localStorage === 'undefined') return false;
        const normalized = this.normalizePension720Stats(items);
        if (!normalized.length) return false;
        return this._safeSetItem(
            CONFIG.KEYS.PENSION720_STATS_CACHE,
            JSON.stringify({
                version: 1,
                updatedAt: new Date().toISOString(),
                items: normalized
            })
        );
    },

    clearPension720StatsCache() {
        if (typeof localStorage === 'undefined') return false;
        try {
            const hadCache = Boolean(localStorage.getItem(CONFIG.KEYS.PENSION720_STATS_CACHE));
            localStorage.removeItem(CONFIG.KEYS.PENSION720_STATS_CACHE);
            return hadCache;
        } catch (_e) {
            return false;
        }
    },

    async fetchPension720OfficialRemote(options = {}) {
        const proxyConfig = typeof this.resolveProxyConfig === 'function' ? this.resolveProxyConfig() : null;
        const candidates = buildPension720RemoteFetchCandidates(proxyConfig);
        const log = typeof options.log === 'function' ? options.log : () => {};
        let lastError = null;

        for (const candidate of candidates) {
            try {
                const res = await this.fetchWithTimeout(candidate.url, {}, 7000);
                if (!res.ok) continue;
                const payload = parsePension720RemotePayload(await res.text());
                if (!payload) continue;
                const list = extractPension720ListFromPayload(payload);
                const remoteItems = this.normalizePension720Stats(list);
                if (!remoteItems.length) continue;
                if (candidate.label && candidate.label !== '공식 API') {
                    log(`[pension720] ${candidate.label} 경유로 공식 목록을 수집했습니다.`);
                }
                return {
                    items: remoteItems,
                    source: resolveRemoteDataSourceFromFetch({
                        providerLabel: candidate.label,
                        proxyConfig
                    }),
                    providerLabel: candidate.label
                };
            } catch (error) {
                lastError = error;
            }
        }

        if (lastError) {
            throw lastError;
        }
        return null;
    },

    async fetchPension720Stats(options = {}) {
        const useRemote = options.remote !== false;
        const preserveExisting = options.preserveExistingOnFailure !== false;
        const previous = Array.isArray(this.state.pension720Stats) ? this.state.pension720Stats : [];
        let bestItems = [];
        let source = 'none';
        let errorMessage = '';
        let remoteAttempted = false;
        let remoteProviderLabel = '';

        try {
            const res = await this.fetchWithTimeout('data/pension720_stats.json', { cache: 'default' }, 5000);
            if (!res.ok) throw new Error(`static HTTP ${res.status}`);
            bestItems = this.normalizePension720Stats(await res.json());
            if (bestItems.length) source = 'static';
        } catch (error) {
            errorMessage = String(error?.message || '');
            console.warn('연금복권 정적 데이터 조회 실패', error);
        }

        const cachedItems = this.readPension720StatsCache();
        if (cachedItems.length && (!bestItems.length || cachedItems[0].draw_no > bestItems[0].draw_no)) {
            bestItems = cachedItems;
            source = 'official_cache';
        }

        if (useRemote) {
            remoteAttempted = true;
            try {
                const remoteResult = await this.fetchPension720OfficialRemote({
                    log: (message) => console.info(message)
                });
                if (remoteResult?.items?.length) {
                    remoteProviderLabel = remoteResult.providerLabel || '';
                    if (!bestItems.length || remoteResult.items[0].draw_no >= bestItems[0].draw_no) {
                        bestItems = remoteResult.items;
                        source = remoteResult.source;
                    }
                    if (!cachedItems.length || remoteResult.items[0].draw_no >= cachedItems[0].draw_no) {
                        this.writePension720StatsCache(remoteResult.items);
                    }
                }
            } catch (error) {
                errorMessage = String(error?.message || errorMessage || '');
                console.warn('연금복권 공식 데이터 조회 실패', error);
            }
        }

        if (!bestItems.length && preserveExisting && previous.length) {
            bestItems = previous;
            source = this.pension720DataHealth?.source || 'static';
            errorMessage = errorMessage || '새로고침 실패로 이전 데이터를 유지합니다.';
        }

        const message = (() => {
            if (!bestItems.length) {
                return errorMessage || '연금복권 데이터를 구성하지 못했습니다.';
            }
            if (source === 'official') return '동행복권 공식 연금복권 데이터를 사용 중입니다.';
            if (source === 'custom_proxy') {
                return remoteProviderLabel
                    ? `고급 연결 주소(${remoteProviderLabel})로 연금복권 공식 데이터를 사용 중입니다.`
                    : '고급 연결 주소로 연금복권 공식 데이터를 사용 중입니다.';
            }
            if (source === 'third_party') {
                return remoteProviderLabel
                    ? `${remoteProviderLabel} 경유로 연금복권 공식 데이터를 사용 중입니다.`
                    : '공개 CORS 중계 경로로 연금복권 공식 데이터를 사용 중입니다.';
            }
            if (source === 'official_cache') return '동행복권 공식 연금복권 캐시 데이터를 사용 중입니다.';
            if (remoteAttempted && source === 'static') {
                return '브라우저에서 공식 실시간 갱신에 실패해 기본 포함 연금복권 데이터를 사용 중입니다.';
            }
            return '기본 포함 연금복권 데이터를 사용 중입니다.';
        })();

        this.state.pension720Stats = bestItems;
        this.setPension720DataHealth({
            availability: bestItems.length ? 'full' : 'none',
            source: bestItems.length ? source : REMOTE_DATA_SOURCE.NONE,
            latestDrawNo: bestItems[0]?.draw_no || 0,
            message,
            updatedAt: new Date().toISOString()
        });

        if (bestItems.length) {
            this.markPension720SyncSuccess({
                drawNo: bestItems[0]?.draw_no || 0,
                source,
                providerLabel: remoteProviderLabel
            });
        } else if (remoteAttempted && errorMessage) {
            this.markPension720SyncFailure(errorMessage);
        }

        return bestItems.length > 0;
    }
};

export { extractOfficialList, PENSION720_OFFICIAL_LIST_URL };