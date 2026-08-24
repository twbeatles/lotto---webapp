export const CORSPROXY_CURRENT_PREFIX = 'https://corsproxy.io/?url=';

export function isCorsproxyIoUrl(url = '') {
    return /https:\/\/corsproxy\.io\//i.test(String(url || ''));
}

export function isCurrentCorsproxyUrl(url = '') {
    return /^https:\/\/corsproxy\.io\/\?url=/i.test(String(url || '').trim());
}

export function isLegacyCorsproxyUrl(url = '') {
    const value = String(url || '').trim();
    if (!isCorsproxyIoUrl(value)) return false;
    return !isCurrentCorsproxyUrl(value);
}

export function inspectCorsproxyCandidate(candidate = {}) {
    const url = String(candidate?.url || '').trim();
    if (!url) {
        return {
            ok: false,
            kind: 'contract',
            message: 'corsproxy.io candidate is missing a URL'
        };
    }
    if (isLegacyCorsproxyUrl(url)) {
        return {
            ok: false,
            kind: 'contract',
            message:
                'corsproxy.io candidate still uses the legacy ?<encoded-url> API. Use https://corsproxy.io/?url= or browser sync/CI will get 403 keyless_legacy_url'
        };
    }
    if (!isCurrentCorsproxyUrl(url)) {
        return {
            ok: false,
            kind: 'contract',
            message: `corsproxy.io candidate is not the current ?url= API: ${url}`
        };
    }
    return { ok: true, kind: 'ok', message: '', url };
}

export function classifyCorsRelayFailure({ status = 0, body = '', url = '' } = {}) {
    const text = String(body || '');
    if (
        isLegacyCorsproxyUrl(url) ||
        /keyless_legacy_url/i.test(text) ||
        /Anonymous legacy proxy URLs are no longer supported/i.test(text)
    ) {
        return {
            kind: 'contract',
            message:
                'corsproxy.io rejected the legacy ?<encoded-url> API (keyless_legacy_url). builtinProviders.js must keep https://corsproxy.io/?url='
        };
    }
    if (/Free usage is limited to localhost/i.test(text) || /Server-side requests are not allowed/i.test(text)) {
        return {
            kind: 'origin_policy',
            message:
                'corsproxy.io free tier is browser-Origin only (127.0.0.1 / localhost / github.io); Node/server probes are not the live gate'
        };
    }
    const code = Number(status) || 0;
    if (!code || code === 408 || code === 429 || code >= 500) {
        return {
            kind: 'unavailable',
            message: `CORS relay unavailable (HTTP ${code || 'network'})`
        };
    }
    return {
        kind: 'http',
        message: `CORS relay HTTP ${code}`
    };
}
