export const appNetworkLifecycleProbeMethods = {
    getNetworkProbeTargets() {
        const targets = [];
        const seen = new Set();
        const push = (label, url) => {
            const nextUrl = String(url || '').trim();
            if (!nextUrl || seen.has(nextUrl)) return;
            seen.add(nextUrl);
            targets.push({ label, url: nextUrl });
        };

        try {
            const sameOriginProbe = new URL('online-check.txt', window.location.href);
            sameOriginProbe.searchParams.set('__online_check', String(Date.now()));
            push('same-origin probe', sameOriginProbe.toString());
        } catch (_e) {
            // ignore location/url edge cases
        }

        const proxyConfig = this.data?.resolveProxyConfig?.();
        if (proxyConfig?.url) {
            try {
                const proxyUrl = new URL(proxyConfig.url);
                proxyUrl.searchParams.set('_network_probe', String(Date.now()));
                push(proxyConfig.source || '고급 연결 주소', proxyUrl.toString());
            } catch (_e) {
                // ignore malformed runtime value
            }
        }

        push('공식 로또 웹', 'https://www.dhlottery.co.kr/');
        return targets;
    },

    async probeNetworkReachability({ force = false, retries = 1 } = {}) {
        if (this._networkProbePromise && !force) return this._networkProbePromise;

        const task = (async () => {
            const targets = this.getNetworkProbeTargets();
            if (!targets.length || typeof fetch !== 'function') {
                return typeof navigator === 'undefined' || navigator.onLine !== false;
            }

            for (let attempt = 0; attempt < Math.max(1, Number(retries) || 1); attempt++) {
                for (const target of targets) {
                    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
                    const timer = controller
                        ? setTimeout(() => controller.abort(), this.NETWORK_PROBE_TIMEOUT_MS)
                        : null;
                    try {
                        const response = await fetch(target.url, {
                            method: 'GET',
                            mode: target.label === 'same-origin probe' ? 'same-origin' : 'no-cors',
                            cache: 'no-store',
                            signal: controller?.signal
                        });
                        if (response) return true;
                    } catch (_e) {
                        // try next candidate
                    } finally {
                        if (timer) clearTimeout(timer);
                    }
                }

                if (attempt + 1 < retries) {
                    await new Promise((resolve) => setTimeout(resolve, this.OFFLINE_CONFIRM_RETRY_MS));
                }
            }

            return false;
        })().finally(() => {
            this._networkProbePromise = null;
        });

        this._networkProbePromise = task;
        return task;
    },

    async isProbablyOffline({ forceProbe = false } = {}) {
        if (typeof navigator === 'undefined') return false;
        if (navigator.onLine !== false) return false;
        const reachable = await this.probeNetworkReachability({
            force: forceProbe,
            retries: forceProbe ? 2 : 1
        });
        return !reachable;
    }
};