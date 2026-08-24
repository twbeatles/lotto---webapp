import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildBuiltinCorsFetchUrls } from '../assets/modules/core/data/sync/builtinProviders.js';
import { extractSingleDrawFromPayload, parseSyncPayload } from '../assets/modules/core/data/sync/lottoPayloadCore.js';
import {
    classifyCorsRelayFailure,
    inspectCorsproxyCandidate
} from './lib/corsRelayContract.mjs';

const DATA_PATH = resolve('data/winning_stats.json');
const PROVIDER_SOURCE_PATH = resolve('assets/modules/core/data/sync/builtinProviders.js');
const OFFICIAL_DRAW_API_URL = 'https://www.dhlottery.co.kr/lt645/selectPstLt645Info.do?srchLtEpsd=';
const LIVE_RETRIES = 2;
const LIVE_RETRY_DELAY_MS = 750;
const LIVE_TIMEOUT_MS = 12000;
const DEV_ORIGIN = 'http://127.0.0.1';

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function latestDrawNo(rows = []) {
    return rows.reduce((max, row) => {
        const drawNo = Math.floor(Number(row?.draw_no || 0));
        return Number.isFinite(drawNo) ? Math.max(max, drawNo) : max;
    }, 0);
}

async function setGithubOutput(name, value) {
    if (!process.env.GITHUB_OUTPUT) return;
    await appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`, 'utf8');
}

async function inspectBuiltInSource() {
    const source = await readFile(PROVIDER_SOURCE_PATH, 'utf8');
    if (!source.includes('https://corsproxy.io/?url=')) {
        throw new Error(
            'assets/modules/core/data/sync/builtinProviders.js must keep the corsproxy.io ?url= API'
        );
    }
    if (/corsproxy\.io\/\?\$\{encodeURIComponent/.test(source)) {
        throw new Error(
            'assets/modules/core/data/sync/builtinProviders.js must not rebuild the legacy corsproxy.io ?<encoded-url> form'
        );
    }
}

function inspectBuiltUrls(drawNo) {
    const targetUrl = `${OFFICIAL_DRAW_API_URL}${drawNo}`;
    const browserSafe = buildBuiltinCorsFetchUrls(targetUrl, { includeDirectOfficial: false });
    const corsproxy = browserSafe.find((item) => item.label === 'corsproxy.io');
    const inspected = inspectCorsproxyCandidate(corsproxy);
    if (!inspected.ok) {
        const error = new Error(inspected.message);
        error.kind = inspected.kind;
        throw error;
    }
    return { drawNo, targetUrl, corsproxy, browserSafe };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = LIVE_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

async function probeCorsproxyLive(corsproxyUrl) {
    let lastFailure = null;
    for (let attempt = 0; attempt <= LIVE_RETRIES; attempt += 1) {
        try {
            const response = await fetchWithTimeout(corsproxyUrl, {
                headers: {
                    Accept: 'application/json,*/*',
                    Origin: DEV_ORIGIN,
                    Referer: `${DEV_ORIGIN}/`,
                    'User-Agent': 'Mozilla/5.0 lotto-pension-pro-webapp cors-relay-contract'
                }
            });
            const body = await response.text();
            if (!response.ok) {
                lastFailure = classifyCorsRelayFailure({
                    status: response.status,
                    body,
                    url: corsproxyUrl
                });
                lastFailure.status = response.status;
                lastFailure.bodyPreview = body.slice(0, 240);
                if (lastFailure.kind === 'contract' || attempt >= LIVE_RETRIES) break;
                await sleep(LIVE_RETRY_DELAY_MS * (attempt + 1));
                continue;
            }
            const item = extractSingleDrawFromPayload(parseSyncPayload(body));
            if (!item?.draw_no) {
                lastFailure = {
                    kind: 'http',
                    message: 'corsproxy.io returned HTTP 200 but no usable Lotto draw payload',
                    status: response.status
                };
                if (attempt >= LIVE_RETRIES) break;
                await sleep(LIVE_RETRY_DELAY_MS * (attempt + 1));
                continue;
            }
            return { ok: true, item, attempts: attempt + 1 };
        } catch (error) {
            lastFailure = classifyCorsRelayFailure({
                status: 0,
                body: error?.message || String(error),
                url: corsproxyUrl
            });
            lastFailure.message = `${lastFailure.message}: ${error?.message || error}`;
            if (lastFailure.kind === 'contract' || attempt >= LIVE_RETRIES) break;
            await sleep(LIVE_RETRY_DELAY_MS * (attempt + 1));
        }
    }
    return { ok: false, failure: lastFailure, attempts: LIVE_RETRIES + 1 };
}

async function main() {
    const deferUnavailable = process.argv.includes('--defer-unavailable');
    const requireLive = process.argv.includes('--require-live');
    const rows = JSON.parse(await readFile(DATA_PATH, 'utf8'));
    const drawNo = latestDrawNo(rows);
    if (!drawNo) throw new Error('winning_stats.json must contain at least one draw row');

    await inspectBuiltInSource();
    const built = inspectBuiltUrls(drawNo);
    const live = await probeCorsproxyLive(built.corsproxy.url);

    const summary = {
        ok: true,
        drawNo,
        corsproxyUrl: built.corsproxy.url,
        live: live.ok
            ? { ok: true, fetchedDrawNo: live.item.draw_no, date: live.item.date, attempts: live.attempts }
            : { ok: false, ...live.failure, attempts: live.attempts },
        deferred: false
    };

    if (live.ok) {
        console.log(JSON.stringify(summary, null, 2));
        await setGithubOutput('deferred', 'false');
        return;
    }

    if (live.failure?.kind === 'contract') {
        summary.ok = false;
        console.error(JSON.stringify(summary, null, 2));
        throw new Error(live.failure.message);
    }

    if (requireLive) {
        summary.ok = false;
        console.error(JSON.stringify(summary, null, 2));
        throw new Error(live.failure?.message || 'corsproxy.io live probe failed');
    }

    if (deferUnavailable && live.failure?.kind === 'unavailable') {
        summary.deferred = true;
        summary.deferredReason = live.failure?.message || 'corsproxy.io live probe failed';
        console.warn(`CORS relay contract deferred: ${summary.deferredReason}`);
        console.log(JSON.stringify(summary, null, 2));
        await setGithubOutput('deferred', 'true');
        return;
    }

    console.warn(
        `CORS relay live probe did not succeed (${live.failure?.message || 'unknown'}); browser canary remains the gate`
    );
    console.log(JSON.stringify(summary, null, 2));
    await setGithubOutput('deferred', 'false');
}

main().catch(async (error) => {
    await setGithubOutput('deferred', 'false');
    console.error(error);
    process.exitCode = 1;
});
