const SW_UPDATE_CHANNEL = 'lotto-sw-update';

function flushAppPersistenceBestEffort() {
    try {
        const data = typeof window !== 'undefined' ? window.app?.data : null;
        if (data?.flushPendingLocalPersistence) {
            data.flushPendingLocalPersistence();
            return;
        }
        if (data?.save) {
            data.save(true);
        }
    } catch (error) {
        console.warn('[pwa] pending persistence flush failed before update', error);
    }
}

function hasPendingAppPersistence() {
    try {
        return Boolean(window.app?.data?.hasPendingLocalPersistence?.());
    } catch (_e) {
        return false;
    }
}

export function registerPwaLifecycle() {
    const pwaState = {
        updateReady: false,
        checking: false
    };
    let registration = null;
    let waitingWorker = null;
    let reloadOnControllerChange = false;
    let updateToast = null;

    const getState = () => ({ ...pwaState });
    const dispatchState = () => {
        window.dispatchEvent(
            new CustomEvent('lotto:pwa-update-state', {
                detail: getState()
            })
        );
    };
    const setState = (next = {}) => {
        const changed = Object.entries(next).some(([key, value]) => pwaState[key] !== value);
        Object.assign(pwaState, next);
        if (changed) dispatchState();
    };
    const setUpdateReady = (worker) => {
        if (!worker) return;
        waitingWorker = worker;
        setState({ updateReady: true });
        showUpdateToast(worker);
    };

    window.lottoPwaUpdate = {
        async check() {
            if (!registration) return { updateReady: pwaState.updateReady };
            setState({ checking: true });
            try {
                await registration.update();
                if (registration.waiting) {
                    setUpdateReady(registration.waiting);
                }
            } catch (err) {
                console.warn('앱 업데이트 확인 실패:', err);
            } finally {
                setState({ checking: false });
            }
            return { updateReady: pwaState.updateReady };
        },
        apply() {
            const worker = waitingWorker || registration?.waiting;
            if (!worker) return false;
            if (hasPendingAppPersistence()) {
                flushAppPersistenceBestEffort();
            }
            reloadOnControllerChange = true;
            worker.postMessage({ action: 'skipWaiting' });
            return true;
        },
        getState
    };

    dispatchState();

    if (!('serviceWorker' in navigator)) return;

    let updateChannel = null;
    const channelClientId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    try {
        if (typeof BroadcastChannel !== 'undefined') {
            updateChannel = new BroadcastChannel(SW_UPDATE_CHANNEL);
            updateChannel.addEventListener('message', (e) => {
                if (e.data?.type === 'SW_ACTIVATED' && e.data?.senderId !== channelClientId) {
                    if (hasPendingAppPersistence()) {
                        flushAppPersistenceBestEffort();
                    }
                    window.location.reload();
                }
            });
        }
    } catch (_e) {
        updateChannel = null;
    }

    const showUpdateToast = (worker) => {
        if (!worker || updateToast) return;

        const toast = document.createElement('div');
        toast.className = 'update-toast';
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');
        toast.innerHTML = `
            <span>새 앱 버전이 준비되었습니다. 지금 적용하면 화면이 한 번 새로고침됩니다.</span>
            <button id="reloadBtn" type="button">업데이트</button>
            <button id="dismissBtn" type="button">닫기</button>
        `;
        document.body.appendChild(toast);
        updateToast = toast;

        const reloadBtn = toast.querySelector('#reloadBtn');
        const dismissBtn = toast.querySelector('#dismissBtn');
        if (reloadBtn) {
            reloadBtn.onclick = () => {
                window.lottoPwaUpdate.apply();
            };
        }
        if (dismissBtn) {
            dismissBtn.onclick = () => {
                updateToast?.remove();
                updateToast = null;
            };
        }
        worker.addEventListener('statechange', () => {
            if (worker.state === 'activating' || worker.state === 'activated' || worker.state === 'redundant') {
                updateToast?.remove();
                updateToast = null;
                if (worker.state === 'activated' || worker.state === 'redundant') {
                    setState({ updateReady: false });
                }
            }
        });
    };

    const registerSW = () => {
        navigator.serviceWorker
            .register('sw.js', { updateViaCache: 'none' })
            .then((reg) => {
                registration = reg;
                console.log('서비스워커 등록 완료:', reg.scope);
                if (reg.waiting && navigator.serviceWorker.controller) {
                    setUpdateReady(reg.waiting);
                }
                window.lottoPwaUpdate.check().catch(() => {});

                reg.addEventListener('updatefound', () => {
                    const newWorker = reg.installing;
                    if (!newWorker) return;
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            setUpdateReady(newWorker);
                        }
                    });
                });
            })
            .catch((err) => console.log('서비스워커 등록 실패:', err));
    };

    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing || !reloadOnControllerChange) return;
        refreshing = true;
        flushAppPersistenceBestEffort();
        try {
            updateChannel?.postMessage({ type: 'SW_ACTIVATED', senderId: channelClientId });
        } catch (_e) {
            // BroadcastChannel delivery is best-effort.
        }
        window.location.reload();
    });

    window.addEventListener('load', () => {
        if ('requestIdleCallback' in window) {
            window.requestIdleCallback(registerSW, { timeout: 1200 });
        } else {
            setTimeout(registerSW, 250);
        }
    });
}
