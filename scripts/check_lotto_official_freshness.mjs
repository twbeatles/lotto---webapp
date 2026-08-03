import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DataManager } from '../assets/modules/core/DataManager.js';
import { estimateLatestDrawKST } from '../assets/modules/utils/utils.js';

const DEFAULT_DATA_PATH = resolve('data/winning_stats.json');
const __filename = fileURLToPath(import.meta.url);
const OFFICIAL_FETCH_RETRIES = 2;
const OFFICIAL_FETCH_RETRY_DELAY_MS = 750;
const RETRIABLE_FETCH_CODES = new Set([
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT',
    'ETIMEDOUT',
    'ECONNRESET',
    'ECONNREFUSED',
    'EAI_AGAIN'
]);

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function collectErrorChain(error) {
    const chain = [];
    const seen = new Set();
    let current = error;

    while (current && typeof current === 'object' && !seen.has(current)) {
        chain.push(current);
        seen.add(current);
        current = current.cause;
    }

    return chain;
}

function formatOfficialUnavailableReason(error) {
    const chain = collectErrorChain(error);
    const code = chain.find((item) => RETRIABLE_FETCH_CODES.has(item?.code))?.code;
    const abortName = chain.find((item) => isAbortOrTimeoutErrorName(item?.name))?.name;
    const message = error?.message || String(error);
    if (code) return `${message} (${code})`;
    if (abortName) return `${message} (${abortName})`;
    return message;
}

function isAbortOrTimeoutErrorName(name) {
    return name === 'AbortError' || name === 'TimeoutError';
}

function isAbortOrTimeoutError(item) {
    if (!item || typeof item !== 'object') return false;
    if (isAbortOrTimeoutErrorName(item.name)) return true;
    const message = String(item.message || '');
    // fetchWithTimeout aborts via AbortController; undici surfaces "This operation was aborted".
    return /operation was aborted|aborted due to timeout|the operation was aborted/i.test(message);
}

function isRetriableOfficialFetchLog(entry) {
    if (entry?.code !== 'SYNC_FETCH_ONE_FAIL') return false;
    const message = String(entry?.meta?.message || entry?.message || '');
    return /fetch failed|timeout|network|socket|ECONN|ETIMEDOUT|EAI_AGAIN|UND_ERR|aborted|AbortError|TimeoutError/i.test(
        message
    );
}

function normalizeRows(rows = []) {
    const dm = new DataManager();
    const normalized = (Array.isArray(rows) ? rows : []).map((row) => dm.normalizeDrawItem(row)).filter(Boolean);
    if (!normalized.length) throw new Error('winning_stats.json must contain at least one valid draw row');
    return normalized.sort((a, b) => Number(b.draw_no) - Number(a.draw_no));
}

function summarizeRows(rows = []) {
    const normalized = normalizeRows(rows);
    const latest = normalized[0];
    return {
        rows: normalized,
        count: normalized.length,
        latestDrawNo: latest.draw_no,
        latestDate: latest.date,
        latestNumbers: latest.numbers,
        latestBonus: latest.bonus
    };
}

function sameNumberList(left = [], right = []) {
    return (
        Array.isArray(left) &&
        Array.isArray(right) &&
        left.length === right.length &&
        left.every((value, index) => Number(value) === Number(right[index]))
    );
}

function compareLatestDrawFields(localLatest, officialLatest) {
    const issues = [];
    if (localLatest.date !== officialLatest.date) {
        issues.push(`latest draw date mismatch: static=${localLatest.date} official=${officialLatest.date}`);
    }
    if (!sameNumberList(localLatest.numbers, officialLatest.numbers)) {
        issues.push(
            `latest draw numbers mismatch: static=${localLatest.numbers.join(',')} official=${officialLatest.numbers.join(',')}`
        );
    }
    if (Number(localLatest.bonus) !== Number(officialLatest.bonus)) {
        issues.push(`latest draw bonus mismatch: static=${localLatest.bonus} official=${officialLatest.bonus}`);
    }

    ['prize_amount', 'winners_count', 'total_sales'].forEach((field) => {
        if (Number(localLatest[field] || 0) !== Number(officialLatest[field] || 0)) {
            issues.push(
                `latest draw ${field} mismatch: static=${localLatest[field]} official=${officialLatest[field]}`
            );
        }
    });

    return issues;
}

function compareLottoOfficialFreshness(staticRows, officialRows, options = {}) {
    const estimatedLatestDrawNo = Math.max(
        0,
        Math.floor(Number(options.estimatedLatestDrawNo || estimateLatestDrawKST()))
    );
    const local = summarizeRows(staticRows);
    const official = summarizeRows(officialRows);
    const issues = [];

    if (estimatedLatestDrawNo > local.latestDrawNo) {
        issues.push(`static data is behind estimated latest draw ${estimatedLatestDrawNo}`);
    }
    if (official.latestDrawNo > local.latestDrawNo) {
        issues.push(`static data is behind official draw ${official.latestDrawNo}`);
    }
    if (official.latestDrawNo < local.latestDrawNo) {
        issues.push(`official draw ${official.latestDrawNo} is behind static latest draw ${local.latestDrawNo}`);
    }

    if (official.latestDrawNo === local.latestDrawNo) {
        issues.push(...compareLatestDrawFields(local.rows[0], official.rows[0]));
    }

    return {
        ok: issues.length === 0,
        static: {
            count: local.count,
            latestDrawNo: local.latestDrawNo,
            latestDate: local.latestDate,
            latestNumbers: local.latestNumbers,
            latestBonus: local.latestBonus
        },
        official: {
            count: official.count,
            latestDrawNo: official.latestDrawNo,
            latestDate: official.latestDate,
            latestNumbers: official.latestNumbers,
            latestBonus: official.latestBonus
        },
        estimatedLatestDrawNo,
        issues
    };
}

async function readStaticRows(dataPath = DEFAULT_DATA_PATH) {
    const raw = await readFile(dataPath, 'utf8');
    return JSON.parse(raw);
}

function isRetriableOfficialFetchError(error) {
    return collectErrorChain(error).some((item) => {
        if (Array.isArray(item?.logs) && item.logs.some(isRetriableOfficialFetchLog)) return true;

        const status = Number(item?.status || 0);
        if (status === 429 || status >= 500) return true;

        // Timeout aborts from fetchWithTimeout / AbortSignal.timeout must defer scheduled CI,
        // not fail the Data Freshness job while static snapshots remain valid.
        if (isAbortOrTimeoutError(item)) return true;

        return RETRIABLE_FETCH_CODES.has(item?.code) || item instanceof TypeError;
    });
}

async function fetchOfficialDraw(drawNo, options = {}) {
    const retries = Math.max(0, Math.floor(Number(options.retries ?? OFFICIAL_FETCH_RETRIES)));
    const retryDelayMs = Math.max(0, Math.floor(Number(options.retryDelayMs ?? OFFICIAL_FETCH_RETRY_DELAY_MS)));
    const dmFactory = typeof options.dmFactory === 'function' ? options.dmFactory : () => new DataManager();
    let lastError = null;
    const logs = [];

    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            const dm = dmFactory();
            const originalLogSync = typeof dm.logSync === 'function' ? dm.logSync.bind(dm) : null;
            dm.logSync = (code, message, meta = null) => {
                if (code === 'SYNC_FETCH_ONE_FAIL') {
                    logs.push({ attempt: attempt + 1, message, code, meta });
                }
                originalLogSync?.(code, message, meta);
            };
            const item = await dm.fetchOneDraw(
                drawNo,
                { url: '', source: 'built-in' },
                (message, code, meta = null) => {
                    logs.push({ attempt: attempt + 1, message, code, meta });
                }
            );
            if (item) {
                return {
                    item,
                    logs,
                    attempts: attempt + 1
                };
            }
            lastError = new Error(`official lotto draw ${drawNo} returned no usable payload`);
            lastError.logs = logs.slice();
        } catch (error) {
            lastError = error;
            if (lastError && typeof lastError === 'object') {
                lastError.logs = logs.slice();
            }
            if (!isRetriableOfficialFetchError(error)) break;
        }

        if (attempt < retries) {
            await sleep(retryDelayMs * (attempt + 1));
        }
    }

    const error = new Error(
        `official lotto draw ${drawNo} could not be fetched after ${retries + 1} attempt(s): ${
            lastError?.message || lastError
        }`,
        { cause: lastError }
    );
    error.logs = logs.slice();
    throw error;
}

async function main() {
    const dataPath = DEFAULT_DATA_PATH;
    const deferEstimatedMissing = process.argv.includes('--defer-estimated-missing');
    const deferOfficialUnavailable = process.argv.includes('--defer-official-unavailable');
    const staticRows = await readStaticRows(dataPath);
    const staticSummary = summarizeRows(staticRows);
    const latestStatic = staticSummary.rows[0];
    const estimatedLatestDrawNo = estimateLatestDrawKST();
    const targetDrawNo = Math.max(latestStatic.draw_no, estimatedLatestDrawNo);
    let result;
    let logs = [];
    let attempts = 0;
    let deferred = false;
    let deferredReason = '';

    try {
        const fetched = await fetchOfficialDraw(targetDrawNo);
        logs = fetched.logs;
        attempts = fetched.attempts;
        result = compareLottoOfficialFreshness(staticRows, [fetched.item], { estimatedLatestDrawNo });
    } catch (error) {
        if (deferOfficialUnavailable && isRetriableOfficialFetchError(error)) {
            deferred = true;
            deferredReason = `official Lotto source unavailable: ${formatOfficialUnavailableReason(error)}`;
            result = {
                ok: true,
                static: {
                    count: staticSummary.count,
                    latestDrawNo: staticSummary.latestDrawNo,
                    latestDate: staticSummary.latestDate,
                    latestNumbers: staticSummary.latestNumbers,
                    latestBonus: staticSummary.latestBonus
                },
                official: null,
                estimatedLatestDrawNo,
                issues: []
            };
        } else if (deferEstimatedMissing && targetDrawNo > latestStatic.draw_no) {
            deferred = true;
            deferredReason = `estimated latest draw ${targetDrawNo} is not available from the official endpoint yet`;
            result = {
                ok: true,
                static: {
                    count: staticSummary.count,
                    latestDrawNo: staticSummary.latestDrawNo,
                    latestDate: staticSummary.latestDate,
                    latestNumbers: staticSummary.latestNumbers,
                    latestBonus: staticSummary.latestBonus
                },
                official: null,
                estimatedLatestDrawNo,
                issues: []
            };
        } else {
            throw error;
        }
    }

    console.log(
        JSON.stringify(
            {
                ok: result.ok,
                deferred,
                deferredReason,
                dataPath,
                targetDrawNo,
                static: result.static,
                official: result.official,
                estimatedLatestDrawNo: result.estimatedLatestDrawNo,
                issues: result.issues,
                attempts,
                warnings: logs.filter((entry) => entry.code === 'SYNC_FETCH_ONE_INVALID_PAYLOAD'),
                checkedOnline: true
            },
            null,
            2
        )
    );

    if (!result.ok) {
        throw new Error(`lotto official freshness check failed: ${result.issues.join('; ')}`);
    }
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
    main().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}

export {
    compareLottoOfficialFreshness,
    fetchOfficialDraw,
    isRetriableOfficialFetchError,
    normalizeRows,
    readStaticRows,
    summarizeRows
};
