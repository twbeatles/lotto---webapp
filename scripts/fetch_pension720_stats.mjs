import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { estimateLatestPension720DrawKST } from '../assets/modules/utils/utils.js';

const SOURCE_URL = 'https://www.dhlottery.co.kr/pt720/selectPstPt720WnList.do';
const DEFAULT_OUTPUT_PATH = resolve('data/pension720_stats.json');
const __filename = fileURLToPath(import.meta.url);
const OFFICIAL_FETCH_RETRIES = 2;
const OFFICIAL_FETCH_RETRY_DELAY_MS = 750;
const OFFICIAL_FETCH_TIMEOUT_MS = 15000;
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

function isAbortOrTimeoutErrorName(name) {
    return name === 'AbortError' || name === 'TimeoutError';
}

function isAbortOrTimeoutError(item) {
    if (!item || typeof item !== 'object') return false;
    if (isAbortOrTimeoutErrorName(item.name)) return true;
    const message = String(item.message || '');
    // AbortSignal.timeout / AbortController aborts surface as AbortError or TimeoutError.
    return /operation was aborted|aborted due to timeout|the operation was aborted/i.test(message);
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

function normalizeDate(rawValue = '') {
    const raw = String(rawValue ?? '').trim();
    const normalized = /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw;
    const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return '';

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
    return normalized;
}

function normalizeSixDigits(rawValue = '') {
    const text = String(rawValue ?? '').trim();
    if (!/^\d{6}$/.test(text)) return null;
    return {
        number: text,
        digits: text.split('').map(Number)
    };
}

function normalizePension720Item(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const drawNo = Number(raw.draw_no ?? raw.psltEpsd);
    if (!Number.isInteger(drawNo) || drawNo < 1) return null;

    const group = Number(raw.group ?? raw.wnBndNo);
    if (!Number.isInteger(group) || group < 1 || group > 5) return null;

    const primary = normalizeSixDigits(raw.number ?? raw.wnRnkVl);
    const bonus = normalizeSixDigits(raw.bonus_number ?? raw.bnsRnkVl);
    const date = normalizeDate(raw.date ?? raw.psltRflYmd);
    if (!primary || !bonus || !date) return null;

    return {
        draw_no: drawNo,
        date,
        group,
        digits: primary.digits,
        number: primary.number,
        bonus_digits: bonus.digits,
        bonus_number: bonus.number
    };
}

function extractList(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.data?.result)) return payload.data.result;
    if (Array.isArray(payload?.result)) return payload.result;
    return [];
}

function normalizePayload(payload) {
    const map = new Map();
    extractList(payload).forEach((item) => {
        const normalized = normalizePension720Item(item);
        if (!normalized) return;
        map.set(normalized.draw_no, normalized);
    });
    return Array.from(map.values()).sort((a, b) => b.draw_no - a.draw_no);
}

function isRetriableOfficialFetchError(error) {
    return collectErrorChain(error).some((item) => {
        const status = Number(item?.status || 0);
        if (status === 429 || status >= 500) return true;

        // AbortSignal.timeout and connect/read aborts must be deferrable in scheduled CI.
        if (isAbortOrTimeoutError(item)) return true;

        return RETRIABLE_FETCH_CODES.has(item?.code) || item instanceof TypeError;
    });
}

async function fetchOfficialPayload({
    fetchImpl = fetch,
    retries = OFFICIAL_FETCH_RETRIES,
    retryDelayMs = OFFICIAL_FETCH_RETRY_DELAY_MS,
    timeoutMs = OFFICIAL_FETCH_TIMEOUT_MS
} = {}) {
    let lastError = null;
    const maxRetries = Math.max(0, Math.floor(Number(retries || 0)));

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        try {
            const signal =
                typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
                    ? AbortSignal.timeout(timeoutMs)
                    : undefined;
            const response = await fetchImpl(SOURCE_URL, {
                headers: {
                    Accept: 'application/json',
                    'User-Agent': 'Mozilla/5.0 lotto-pension-pro-webapp data sync'
                },
                signal
            });
            if (!response.ok) {
                const error = new Error(`HTTP ${response.status}`);
                error.status = response.status;
                throw error;
            }
            return response.json();
        } catch (error) {
            lastError = error;
            if (attempt >= maxRetries || !isRetriableOfficialFetchError(error)) break;
            await sleep(retryDelayMs * (attempt + 1));
        }
    }

    throw new Error(
        `official pension720 fetch failed after ${maxRetries + 1} attempt(s): ${lastError?.message || lastError}`,
        { cause: lastError }
    );
}

function validateRows(rows) {
    if (!Array.isArray(rows) || !rows.length) {
        throw new Error('pension720_stats.json must contain at least one draw row');
    }
    rows.forEach((row, index) => {
        const normalized = normalizePension720Item(row);
        if (!normalized) throw new Error(`invalid pension720 row at index ${index}`);
        if (normalized.number !== row.number || normalized.bonus_number !== row.bonus_number) {
            throw new Error(`pension720 row at index ${index} must preserve six-digit strings`);
        }
    });
}

function buildLatestSummary(rows) {
    const normalized = normalizePayload(rows);
    validateRows(normalized);
    const latest = normalized[0];
    return {
        rows: normalized,
        count: normalized.length,
        latestDrawNo: latest.draw_no,
        latestDate: latest.date,
        latestNumber: `${latest.group}조 ${latest.number}`,
        latestGroup: latest.group,
        latestPrimary: latest.number,
        latestBonus: latest.bonus_number
    };
}

function buildStaticSummary(rows) {
    const summary = buildLatestSummary(rows);
    return {
        count: summary.count,
        latestDrawNo: summary.latestDrawNo,
        latestDate: summary.latestDate,
        latestNumber: summary.latestNumber,
        latestBonus: summary.latestBonus
    };
}

function buildDeferredOfficialResult({ outputPath, rows, error, checkedOnline }) {
    return {
        ok: true,
        deferred: true,
        deferredReason: `official pension720 source unavailable: ${formatOfficialUnavailableReason(error)}`,
        outputPath,
        sourceUrl: SOURCE_URL,
        static: buildStaticSummary(rows),
        official: null,
        issues: [],
        checkedOnline
    };
}

function comparePension720Freshness(staticRows, officialRows, options = {}) {
    const estimatedLatestDrawNo = Math.max(
        0,
        Math.floor(Number(options.estimatedLatestDrawNo || estimateLatestPension720DrawKST()))
    );
    const local = buildLatestSummary(staticRows);
    const official = buildLatestSummary(officialRows);
    const issues = [];

    if (estimatedLatestDrawNo > local.latestDrawNo) {
        issues.push(`static data is behind estimated latest draw ${estimatedLatestDrawNo}`);
    }
    if (estimatedLatestDrawNo > official.latestDrawNo) {
        issues.push(
            `official latest draw ${official.latestDrawNo} is behind estimated latest draw ${estimatedLatestDrawNo}`
        );
    }
    if (official.latestDrawNo > local.latestDrawNo) {
        issues.push(`static data is behind official latest draw ${official.latestDrawNo}`);
    }
    if (official.latestDrawNo < local.latestDrawNo) {
        issues.push(`official latest draw ${official.latestDrawNo} is behind static data ${local.latestDrawNo}`);
    }

    if (official.latestDrawNo === local.latestDrawNo) {
        const latestLocal = local.rows[0];
        const latestOfficial = official.rows[0];
        const fields = ['date', 'group', 'number', 'bonus_number'];
        fields.forEach((field) => {
            if (latestLocal[field] !== latestOfficial[field]) {
                issues.push(
                    `latest draw ${field} mismatch: static=${latestLocal[field]} official=${latestOfficial[field]}`
                );
            }
        });
    }

    return {
        ok: issues.length === 0,
        static: {
            count: local.count,
            latestDrawNo: local.latestDrawNo,
            latestDate: local.latestDate,
            latestNumber: local.latestNumber,
            latestBonus: local.latestBonus
        },
        official: {
            count: official.count,
            latestDrawNo: official.latestDrawNo,
            latestDate: official.latestDate,
            latestNumber: official.latestNumber,
            latestBonus: official.latestBonus
        },
        estimatedLatestDrawNo,
        issues
    };
}

function renderNumberArray(items = []) {
    return `[${items.map((item) => Number(item)).join(', ')}]`;
}

function renderPension720Rows(rows = []) {
    const blocks = rows.map((row) =>
        [
            '  {',
            `    "draw_no": ${row.draw_no},`,
            `    "date": ${JSON.stringify(row.date)},`,
            `    "group": ${row.group},`,
            `    "digits": ${renderNumberArray(row.digits)},`,
            `    "number": ${JSON.stringify(row.number)},`,
            `    "bonus_digits": ${renderNumberArray(row.bonus_digits)},`,
            `    "bonus_number": ${JSON.stringify(row.bonus_number)}`,
            '  }'
        ].join('\n')
    );
    return `[\n${blocks.join(',\n')}\n]\n`;
}

async function readExistingRows(outputPath) {
    const raw = await readFile(outputPath, 'utf8');
    return JSON.parse(raw);
}

async function main() {
    const checkOnly = process.argv.includes('--check');
    const checkOnline = process.argv.includes('--check-online');
    const deferOfficialUnavailable = process.argv.includes('--defer-official-unavailable');
    const deferEstimatedMissing = process.argv.includes('--defer-estimated-missing');
    const outputFlagIndex = process.argv.indexOf('--out');
    const outputPath =
        outputFlagIndex >= 0 && process.argv[outputFlagIndex + 1]
            ? resolve(process.argv[outputFlagIndex + 1])
            : DEFAULT_OUTPUT_PATH;
    const estimatedLatestDrawNo = estimateLatestPension720DrawKST();

    if (checkOnline) {
        const staticRows = await readExistingRows(outputPath);
        let officialPayload;
        try {
            officialPayload = await fetchOfficialPayload();
        } catch (error) {
            if (!deferOfficialUnavailable || !isRetriableOfficialFetchError(error)) {
                throw error;
            }

            const deferredResult = buildDeferredOfficialResult({
                outputPath,
                rows: staticRows,
                error,
                checkedOnline: true
            });
            console.warn(`pension720 official freshness deferred: ${deferredResult.deferredReason}`);
            console.log(JSON.stringify(deferredResult, null, 2));
            return;
        }

        const result = comparePension720Freshness(staticRows, officialPayload, { estimatedLatestDrawNo });
        const shouldDeferEstimatedMissing =
            deferEstimatedMissing &&
            result.official.latestDrawNo < estimatedLatestDrawNo &&
            result.official.latestDrawNo <= result.static.latestDrawNo;
        console.log(
            JSON.stringify(
                {
                    ok: result.ok || shouldDeferEstimatedMissing,
                    deferred: shouldDeferEstimatedMissing,
                    deferredReason: shouldDeferEstimatedMissing
                        ? `estimated Pension720+ draw ${estimatedLatestDrawNo} is not available from the official endpoint yet`
                        : '',
                    outputPath,
                    sourceUrl: SOURCE_URL,
                    static: result.static,
                    official: result.official,
                    estimatedLatestDrawNo: result.estimatedLatestDrawNo,
                    issues: result.issues,
                    checkedOnline: true
                },
                null,
                2
            )
        );
        if (shouldDeferEstimatedMissing) return;
        if (!result.ok) {
            throw new Error(`pension720 freshness check failed: ${result.issues.join('; ')}`);
        }
        return;
    }

    let deferred = false;
    let deferredReason = '';
    let rows;

    if (checkOnly) {
        rows = await readExistingRows(outputPath);
    } else {
        try {
            const officialRows = normalizePayload(await fetchOfficialPayload());
            const existingRows = await readExistingRows(outputPath);
            const officialSummary = buildStaticSummary(officialRows);
            const staticSummary = buildStaticSummary(existingRows);
            if (
                deferEstimatedMissing &&
                officialSummary.latestDrawNo < estimatedLatestDrawNo &&
                officialSummary.latestDrawNo <= staticSummary.latestDrawNo
            ) {
                rows = existingRows;
                deferred = true;
                deferredReason = `estimated Pension720+ draw ${estimatedLatestDrawNo} is not available from the official endpoint yet`;
                console.warn(`pension720 refresh deferred: ${deferredReason}`);
            } else {
                rows = officialRows;
            }
        } catch (error) {
            if (!deferOfficialUnavailable || !isRetriableOfficialFetchError(error)) {
                throw error;
            }

            rows = await readExistingRows(outputPath);
            deferred = true;
            deferredReason = `official pension720 source unavailable: ${formatOfficialUnavailableReason(error)}`;
            console.warn(`pension720 refresh deferred: ${deferredReason}`);
        }
    }

    validateRows(rows);

    const latest = rows[0];
    console.log(
        JSON.stringify(
            {
                ok: true,
                deferred,
                deferredReason,
                outputPath,
                sourceUrl: SOURCE_URL,
                count: rows.length,
                latestDrawNo: latest.draw_no,
                estimatedLatestDrawNo,
                latestDate: latest.date,
                latestNumber: `${latest.group}조 ${latest.number}`,
                latestBonus: latest.bonus_number,
                checkedOnly: checkOnly
            },
            null,
            2
        )
    );

    if (!checkOnly && !deferred) {
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, renderPension720Rows(rows), 'utf8');
    }
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
    main().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}

export {
    comparePension720Freshness,
    fetchOfficialPayload,
    isRetriableOfficialFetchError,
    normalizePension720Item,
    normalizePayload,
    renderPension720Rows,
    SOURCE_URL
};
