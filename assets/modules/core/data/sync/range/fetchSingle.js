export const dataSyncRangeSingleFetchMethods = {
    async fetchOneDraw(drawNo, proxyConfig, log = () => {}, signal = null) {
        const candidates = [
            ...this.buildCustomSingleFetchUrls(drawNo, proxyConfig),
            ...this.buildBuiltInSingleFetchUrls(drawNo)
        ].filter((candidate, index, list) => {
            return candidate?.url && list.findIndex((item) => item.url === candidate.url) === index;
        });

        for (const candidate of candidates) {
            if (signal?.aborted) throw this.createAbortError('Sync aborted');
            try {
                const res = await this.fetchWithTimeout(candidate.url, {}, this.SYNC_FETCH_TIMEOUT_MS, signal);
                if (!res.ok) {
                    this.logSync('SYNC_FETCH_ONE_HTTP', `HTTP ${res.status} single draw fetch ${drawNo}`, {
                        fetchUrl: candidate.url,
                        source: candidate.label,
                        status: res.status
                    });
                    log(`${drawNo}회차 HTTP ${res.status} (${candidate.label})`, 'SYNC_FETCH_ONE_HTTP', {
                        source: candidate.label,
                        status: res.status
                    });
                    continue;
                }
                const payload = this.parseSyncPayload(await res.text());
                const item = this.extractSingleDrawFromPayload(payload);
                if (item) {
                    if (candidate.label && candidate.label !== '공식 API') {
                        log(
                            `[fetch] ${drawNo}회차: ${candidate.label} 경유로 수집했습니다. 개인 프록시 배포를 권장합니다.`,
                            'SYNC_THIRD_PARTY_PROVIDER'
                        );
                    }
                    return item;
                }
                if (payload) {
                    const shape = this.describePayloadShape(payload);
                    const warningMessage = `${drawNo}회차 응답 구조가 예상 형식과 다릅니다. (${candidate.label})`;
                    this.logSync('SYNC_FETCH_ONE_INVALID_PAYLOAD', `Invalid single draw payload ${drawNo}`, {
                        fetchUrl: candidate.url,
                        source: candidate.label,
                        ...shape
                    });
                    log(warningMessage, 'SYNC_FETCH_ONE_INVALID_PAYLOAD', {
                        source: candidate.label,
                        ...shape
                    });
                }
            } catch (e) {
                if (this.isAbortError(e)) throw e;
                this.logSync('SYNC_FETCH_ONE_FAIL', `Failed single draw fetch ${drawNo}`, {
                    fetchUrl: candidate.url,
                    source: candidate.label,
                    message: e.message
                });
                log(`${drawNo}회차 요청 실패 (${candidate.label})`, 'SYNC_FETCH_ONE_FAIL', {
                    source: candidate.label,
                    message: e.message
                });
            }
        }
        return null;
    }
};