import { extractPension720ListFromPayload } from '../assets/modules/core/data/pension720/remoteFetch.js';
import { extractSingleDrawFromPayload } from '../assets/modules/core/data/sync/lottoPayloadCore.js';
import { estimateLatestDrawKST } from '../assets/modules/utils/utils.js';

const DEFAULT_OFFICIAL_API_URL = 'https://www.dhlottery.co.kr/lt645/selectPstLt645Info.do?srchLtEpsd=';
const PENSION720_OFFICIAL_LIST_URL = 'https://www.dhlottery.co.kr/pt720/selectPstPt720WnList.do';
const MAX_RANGE = 40;
const RANGE_CONCURRENCY = 4;
const FETCH_TIMEOUT_MS = 4000;
const FETCH_RETRY_COUNT = 1;
const TTL_NEAR_LATEST_SECONDS = 60;
const TTL_HISTORICAL_SECONDS = 6 * 60 * 60;
const TTL_HISTORICAL_RANGE_SECONDS = 12 * 60 * 60;
export const MAX_FUTURE_DRAW_SLACK = 1;

/** Official lottery path prefixes allowed for `?url=` passthrough. */
export const ALLOWED_DHLOTTERY_PATH_PREFIXES = ['/lt645/', '/pt720/'];

const DEFAULT_CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
};

/** Request-scoped CORS headers (set at the start of each fetch). */
let activeCors = { ...DEFAULT_CORS };

/**
 * Resolve CORS headers from optional Worker env `CORS_ALLOWED_ORIGINS`
 * (comma-separated origin list). Empty / missing keeps `*` for backward compatibility.
 */
export function resolveCorsHeaders(request, env = {}) {
    const configured = String(env?.CORS_ALLOWED_ORIGINS || env?.ALLOWED_ORIGINS || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    const base = {
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    };
    if (!configured.length || configured.includes('*')) {
        return { ...base, 'Access-Control-Allow-Origin': '*' };
    }
    const origin = request?.headers?.get?.('Origin') || '';
    if (origin && configured.includes(origin)) {
        return { ...base, 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
    }
    if (!origin) {
        return { ...base, 'Access-Control-Allow-Origin': configured[0], Vary: 'Origin' };
    }
    // Disallowed browser origin: omit ACAO so the browser blocks the response body.
    return { ...base, Vary: 'Origin' };
}

export function isAllowedDhlotteryProxyPath(pathname = '') {
    const path = String(pathname || '');
    return ALLOWED_DHLOTTERY_PATH_PREFIXES.some((prefix) => path.startsWith(prefix) || path.includes(prefix));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const toJsonResponse = (body, init = {}) => {
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    return new Response(payload, {
        ...init,
        headers: {
            'content-type': 'application/json; charset=utf-8',
            ...activeCors,
            ...(init.headers || {})
        }
    });
};

const withCacheMeta = (response, ttlSeconds, cacheState) => {
    const headers = new Headers(response.headers);
    Object.entries(activeCors).forEach(([key, value]) => headers.set(key, value));
    if (Number.isFinite(ttlSeconds) && ttlSeconds > 0) {
        headers.set('Cache-Control', `public, max-age=${ttlSeconds}`);
    }
    if (cacheState) headers.set('X-Lotto-Cache', cacheState);
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
    });
};

const cacheKeyFromRequest = (request) => new Request(request.url, { method: 'GET' });

async function respondWithEdgeCache(request, ttlSeconds, producer) {
    const cache = caches.default;
    const cacheKey = cacheKeyFromRequest(request);
    const cached = await cache.match(cacheKey);
    if (cached) return withCacheMeta(cached, ttlSeconds, 'HIT');

    const fresh = await producer();
    if (!fresh.ok) return withCacheMeta(fresh, 0, 'BYPASS');

    const cacheReady = withCacheMeta(fresh.clone(), ttlSeconds, 'MISS');
    await cache.put(cacheKey, cacheReady.clone());
    return withCacheMeta(fresh, ttlSeconds, 'MISS');
}

async function fetchWithTimeout(url, init = {}, timeoutMs = FETCH_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, {
            ...init,
            signal: controller.signal
        });
    } finally {
        clearTimeout(timer);
    }
}

async function fetchWithRetry(url, init = {}, retries = FETCH_RETRY_COUNT) {
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await fetchWithTimeout(url, init, FETCH_TIMEOUT_MS);
            if (!res.ok && res.status >= 500 && attempt < retries) {
                await sleep(120 * (attempt + 1));
                continue;
            }
            return res;
        } catch (err) {
            lastError = err;
            if (attempt < retries) {
                await sleep(120 * (attempt + 1));
                continue;
            }
        }
    }
    throw lastError || new Error('upstream fetch failed');
}

const fetchOfficialRaw = async (drawNo) => {
    const url = `${DEFAULT_OFFICIAL_API_URL}${drawNo}`;
    try {
        const res = await fetchWithRetry(url, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0',
                Referer: 'https://www.dhlottery.co.kr/lt645/intro',
                Accept: 'application/json, text/javascript, */*; q=0.01',
                'X-Requested-With': 'XMLHttpRequest'
            }
        });

        const text = await res.text();
        return { ok: res.ok, text };
    } catch (err) {
        return { ok: false, text: '' };
    }
};

const toLegacyDataRow = (row) => {
    const date = String(row?.date || '').replaceAll('-', '');
    const nums = Array.isArray(row?.numbers) ? row.numbers : [];
    return {
        ltEpsd: Number(row?.draw_no || 0),
        ltRflYmd: date,
        tm1WnNo: Number(nums[0] || 0),
        tm2WnNo: Number(nums[1] || 0),
        tm3WnNo: Number(nums[2] || 0),
        tm4WnNo: Number(nums[3] || 0),
        tm5WnNo: Number(nums[4] || 0),
        tm6WnNo: Number(nums[5] || 0),
        bnsWnNo: Number(row?.bonus || 0),
        rnk1WnAmt: Number(row?.prize_amount || 0),
        rnk1WnNope: Number(row?.winners_count || 0),
        rlvtEpsdSumNtslAmt: Number(row?.total_sales || 0)
    };
};

const fetchPension720OfficialList = async () => {
    try {
        const res = await fetchWithRetry(PENSION720_OFFICIAL_LIST_URL, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0',
                Referer: 'https://www.dhlottery.co.kr/',
                Accept: 'application/json, text/javascript, */*; q=0.01',
                'X-Requested-With': 'XMLHttpRequest'
            }
        });
        const text = await res.text();
        if (!res.ok) return null;
        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch (_e) {
            return null;
        }
        const list = extractPension720ListFromPayload(parsed);
        return list.length ? list : null;
    } catch (_e) {
        return null;
    }
};

const getOneDraw = async (drawNo) => {
    const { ok, text } = await fetchOfficialRaw(drawNo);
    if (!ok) return null;
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (e) {
        return null;
    }
    return extractSingleDrawFromPayload(parsed);
};

async function getRange(from, to) {
    const drawNos = [];
    for (let drawNo = from; drawNo <= to; drawNo++) drawNos.push(drawNo);

    const rows = new Array(drawNos.length).fill(null);
    let cursor = 0;
    const worker = async () => {
        while (true) {
            const index = cursor++;
            if (index >= drawNos.length) return;
            rows[index] = await getOneDraw(drawNos[index]);
        }
    };

    const workers = Array.from({ length: Math.max(1, Math.min(RANGE_CONCURRENCY, drawNos.length)) }, () => worker());
    await Promise.all(workers);

    const data = [];
    const missing = [];
    rows.forEach((row, idx) => {
        if (row) data.push(row);
        else missing.push(drawNos[idx]);
    });

    return { from, to, count: data.length, missing, data };
}

const isNearLatestDraw = (drawNo) => {
    const latestEstimate = estimateLatestDrawKST();
    return Number(drawNo) >= Math.max(latestEstimate - 1, 1);
};

export const getMaxAllowedDrawNo = (nowKstUtc = undefined) =>
    estimateLatestDrawKST(nowKstUtc) + MAX_FUTURE_DRAW_SLACK;

export const isAllowedProxyDrawNo = (drawNo, nowKstUtc = undefined) =>
    Number.isInteger(drawNo) && drawNo >= 1 && drawNo <= getMaxAllowedDrawNo(nowKstUtc);

const futureDrawResponse = (drawNo, maxDrawNo) =>
    toJsonResponse(
        { error: 'draw_no too far in future', drawNo, maxDrawNo },
        {
            status: 400,
            headers: { 'X-Lotto-Cache': 'BYPASS' }
        }
    );

const resolveLatestTtl = (drawNo) => (isNearLatestDraw(drawNo) ? TTL_NEAR_LATEST_SECONDS : TTL_HISTORICAL_SECONDS);
const resolveRangeTtl = (to) => (isNearLatestDraw(to) ? TTL_NEAR_LATEST_SECONDS : TTL_HISTORICAL_RANGE_SECONDS);

export { estimateLatestDrawKST };

export default {
    async fetch(request, env = {}) {
        activeCors = resolveCorsHeaders(request, env);
        const url = new URL(request.url);

        if (request.method === 'OPTIONS') {
            const origin = request.headers?.get?.('Origin') || '';
            const configured = String(env?.CORS_ALLOWED_ORIGINS || env?.ALLOWED_ORIGINS || '')
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean);
            if (
                configured.length &&
                !configured.includes('*') &&
                origin &&
                !configured.includes(origin)
            ) {
                return toJsonResponse(
                    { error: 'Origin not allowed' },
                    { status: 403, headers: { 'X-Lotto-Cache': 'BYPASS' } }
                );
            }
            return toJsonResponse('{}', { headers: { ...activeCors, 'X-Lotto-Cache': 'BYPASS' } });
        }

        // Support ?url= parameter (AllOrigins-style passthrough)
        const targetUrlStr = url.searchParams.get('url');
        if (targetUrlStr) {
            try {
                const targetUrl = new URL(targetUrlStr);
                if (targetUrl.hostname !== 'www.dhlottery.co.kr') {
                    return toJsonResponse(
                        { error: 'Forbidden domain' },
                        {
                            status: 403,
                            headers: { 'X-Lotto-Cache': 'BYPASS' }
                        }
                    );
                }
                if (!isAllowedDhlotteryProxyPath(targetUrl.pathname)) {
                    return toJsonResponse(
                        { error: 'Forbidden path', allowedPathPrefixes: ALLOWED_DHLOTTERY_PATH_PREFIXES },
                        {
                            status: 403,
                            headers: { 'X-Lotto-Cache': 'BYPASS' }
                        }
                    );
                }

                const res = await fetchWithRetry(targetUrl.toString(), {
                    headers: {
                        'User-Agent': 'Mozilla/5.0',
                        Referer: 'https://www.dhlottery.co.kr/',
                        'X-Requested-With': 'XMLHttpRequest'
                    }
                });

                const text = await res.text();
                return toJsonResponse(text, { headers: { 'X-Lotto-Cache': 'BYPASS' } });
            } catch (e) {
                return toJsonResponse(
                    { error: 'Invalid URL' },
                    {
                        status: 400,
                        headers: { 'X-Lotto-Cache': 'BYPASS' }
                    }
                );
            }
        }

        if (url.pathname === '/proxy/latest') {
            const drawNoParam = url.searchParams.get('draw_no');
            const drawNo = drawNoParam ? Number(drawNoParam) : estimateLatestDrawKST();
            if (!Number.isInteger(drawNo) || drawNo < 1) {
                return toJsonResponse(
                    { error: 'invalid draw_no' },
                    {
                        status: 400,
                        headers: { 'X-Lotto-Cache': 'BYPASS' }
                    }
                );
            }
            const maxAllowedDrawNo = getMaxAllowedDrawNo();
            if (drawNo > maxAllowedDrawNo) {
                return futureDrawResponse(drawNo, maxAllowedDrawNo);
            }
            const format = String(url.searchParams.get('format') || 'hybrid').toLowerCase();
            const ttlSeconds = resolveLatestTtl(drawNo);

            return respondWithEdgeCache(request, ttlSeconds, async () => {
                const row = await getOneDraw(drawNo);
                if (!row) return toJsonResponse({ error: 'upstream error' }, { status: 502 });
                const legacy = { data: { list: [toLegacyDataRow(row)] } };

                if (format === 'legacy') return toJsonResponse(legacy);
                if (format === 'normalized') return toJsonResponse({ data: [row] });
                return toJsonResponse({
                    ...legacy,
                    normalized: [row],
                    meta: { format: 'hybrid' }
                });
            });
        }

        if (url.pathname === '/proxy/pension720/list') {
            const ttlSeconds = TTL_NEAR_LATEST_SECONDS;
            return respondWithEdgeCache(request, ttlSeconds, async () => {
                const list = await fetchPension720OfficialList();
                if (!list) return toJsonResponse({ error: 'upstream error' }, { status: 502 });
                return toJsonResponse({
                    data: list,
                    count: list.length,
                    meta: { format: 'official_list' }
                });
            });
        }

        if (url.pathname === '/proxy/range') {
            const from = Number(url.searchParams.get('from') || 0);
            const to = Number(url.searchParams.get('to') || 0);
            const format = String(url.searchParams.get('format') || 'normalized').toLowerCase();
            if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < 1 || from > to) {
                return toJsonResponse(
                    { error: 'invalid range' },
                    {
                        status: 400,
                        headers: { 'X-Lotto-Cache': 'BYPASS' }
                    }
                );
            }
            if (to - from > MAX_RANGE) {
                return toJsonResponse(
                    { error: 'range too large', maxRange: MAX_RANGE },
                    {
                        status: 400,
                        headers: { 'X-Lotto-Cache': 'BYPASS' }
                    }
                );
            }
            const maxAllowedDrawNo = getMaxAllowedDrawNo();
            if (to > maxAllowedDrawNo) {
                return futureDrawResponse(to, maxAllowedDrawNo);
            }

            const ttlSeconds = resolveRangeTtl(to);
            return respondWithEdgeCache(request, ttlSeconds, async () => {
                const payload = await getRange(from, to);
                if (format === 'legacy') {
                    return toJsonResponse({
                        from: payload.from,
                        to: payload.to,
                        count: payload.count,
                        missing: payload.missing,
                        data: { list: payload.data.map(toLegacyDataRow) }
                    });
                }
                if (format === 'hybrid') {
                    return toJsonResponse({
                        ...payload,
                        legacy: { data: { list: payload.data.map(toLegacyDataRow) } }
                    });
                }
                return toJsonResponse(payload);
            });
        }

        return toJsonResponse(
            { error: 'Not Found' },
            {
                status: 404,
                headers: { 'X-Lotto-Cache': 'BYPASS' }
            }
        );
    }
};
