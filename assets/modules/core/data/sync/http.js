import { measureAsync } from '../../../utils/perf.js';

export const dataSyncHttpMethods = {
    async fetchWithTimeout(url, options = {}, timeoutMs = this.SYNC_FETCH_TIMEOUT_MS, externalSignal = null) {
        return measureAsync(
            'sync.fetch',
            async () => {
                const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
                let timedOut = false;
                const timer = controller
                    ? setTimeout(() => {
                          timedOut = true;
                          try {
                              controller.abort();
                          } catch {
                              // ignore double-abort races
                          }
                      }, timeoutMs)
                    : null;
                let onExternalAbort = null;

                try {
                    if (controller && externalSignal) {
                        if (externalSignal.aborted) throw this.createAbortError('Sync aborted');
                        onExternalAbort = () => {
                            try {
                                controller.abort();
                            } catch {
                                // ignore double-abort races
                            }
                        };
                        externalSignal.addEventListener('abort', onExternalAbort, { once: true });
                    }
                    const nextOptions = controller ? { ...options, signal: controller.signal } : options;
                    return await fetch(url, nextOptions);
                } catch (error) {
                    // Shared sync run cancelled by the user or a newer sync start.
                    if (externalSignal?.aborted) {
                        throw this.createAbortError('Sync aborted');
                    }
                    // Timeout aborts must remain retriable provider failures. Treating them as
                    // AbortError makes fetchOneDraw skip remaining candidates and the UI toast
                    // "동기화가 취소되었습니다" instead of trying the next CORS relay.
                    if (timedOut) {
                        throw this.createTimeoutError(timeoutMs);
                    }
                    throw error;
                } finally {
                    if (timer) clearTimeout(timer);
                    if (externalSignal && onExternalAbort) {
                        externalSignal.removeEventListener('abort', onExternalAbort);
                    }
                }
            },
            {
                timeoutMs,
                url: String(url).slice(0, 120)
            }
        );
    }
};
