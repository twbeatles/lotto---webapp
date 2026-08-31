export const BUILTIN_CORS_PROVIDERS = [
    {
        label: '공식 API',
        buildUrl(targetUrl) {
            return targetUrl;
        },
        /**
         * dhlottery now reflects Origin on simple GET (ACAOrigin + credentials).
         * Public CORS relays are fallback-only: corsproxy.io requires an API key (401),
         * and CodeTabs is often unavailable. Keep includeDirectOfficial:false for relay-only probes.
         */
        browserDirect: true
    },
    {
        label: 'corsproxy.io',
        buildUrl(targetUrl) {
            // 레거시 `?<encoded-url>` 는 403 keyless_legacy_url. 현재 공개 API는 `?url=`.
            return `https://corsproxy.io/?url=${encodeURIComponent(targetUrl)}`;
        },
        browserDirect: true
    },
    {
        label: 'CodeTabs',
        buildUrl(targetUrl) {
            return `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(targetUrl)}`;
        },
        browserDirect: true
    }
];

/**
 * @param {string} targetUrl
 * @param {{ includeDirectOfficial?: boolean }} [options]
 *   includeDirectOfficial:
 *     - true  → always include the official URL
 *     - false → never include it (relay-only probes/tests)
 *     - omit  → include it in browser and Node; dhlottery reflects Origin on simple GET
 */
export function buildBuiltinCorsFetchUrls(targetUrl, options = {}) {
    const url = String(targetUrl || '').trim();
    if (!url) return [];

    const includeDirectOfficial =
        typeof options.includeDirectOfficial === 'boolean'
            ? options.includeDirectOfficial
            : true;

    return BUILTIN_CORS_PROVIDERS.filter((provider) => {
        if (provider.label === '공식 API' && !includeDirectOfficial) return false;
        if (provider.browserDirect === false && !includeDirectOfficial) return false;
        return true;
    }).map((provider) => ({
        label: provider.label,
        url: provider.buildUrl(url)
    }));
}
