export const BUILTIN_CORS_PROVIDERS = [
    {
        label: '공식 API',
        buildUrl(targetUrl) {
            return targetUrl;
        },
        /**
         * Browser pages cannot call dhlottery.co.kr directly (CORS).
         * Keep the direct candidate for Node/scripts and custom runtimes that opt in.
         */
        browserDirect: false
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

export function isBrowserDocumentRuntime() {
    return (
        typeof window !== 'undefined' &&
        typeof document !== 'undefined' &&
        typeof window.document !== 'undefined'
    );
}

/**
 * @param {string} targetUrl
 * @param {{ includeDirectOfficial?: boolean }} [options]
 *   includeDirectOfficial:
 *     - true  → always include the official (non-CORS) URL
 *     - false → never include it
 *     - omit  → include only outside browser document runtimes
 */
export function buildBuiltinCorsFetchUrls(targetUrl, options = {}) {
    const url = String(targetUrl || '').trim();
    if (!url) return [];

    const includeDirectOfficial =
        typeof options.includeDirectOfficial === 'boolean'
            ? options.includeDirectOfficial
            : !isBrowserDocumentRuntime();

    return BUILTIN_CORS_PROVIDERS.filter((provider) => {
        if (provider.browserDirect === false && !includeDirectOfficial) return false;
        return true;
    }).map((provider) => ({
        label: provider.label,
        url: provider.buildUrl(url)
    }));
}
