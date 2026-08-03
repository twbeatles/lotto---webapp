import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

import { estimateLatestDrawKST } from '../assets/modules/utils/utils.js';

const execFileAsync = promisify(execFile);
const DATA_PATH = resolve('data/winning_stats.json');
const LOTTO_OFFICIAL_SCHEDULED_ARGS = ['--defer-estimated-missing', '--defer-official-unavailable'];

function latestDrawNo(rows = []) {
    return rows.reduce((max, row) => {
        const drawNo = Math.floor(Number(row?.draw_no || 0));
        return Number.isFinite(drawNo) ? Math.max(max, drawNo) : max;
    }, 0);
}

async function readLatestStaticDrawNo() {
    const rows = JSON.parse(await readFile(DATA_PATH, 'utf8'));
    if (!Array.isArray(rows) || !rows.length) {
        throw new Error('winning_stats.json must contain at least one draw row');
    }
    return latestDrawNo(rows);
}

async function runNodeScript(scriptPath, args = [], options = {}) {
    const command = process.execPath;
    const commandArgs = [scriptPath, ...args];
    try {
        const result = await execFileAsync(command, commandArgs, {
            cwd: process.cwd(),
            maxBuffer: 1024 * 1024 * 16
        });
        if (result.stdout) process.stdout.write(result.stdout);
        if (result.stderr) process.stderr.write(result.stderr);
        return { ok: true, result };
    } catch (error) {
        if (error.stdout) process.stdout.write(error.stdout);
        if (error.stderr) process.stderr.write(error.stderr);
        if (!options.allowFailure) throw error;
        return { ok: false, error };
    }
}

async function setGithubOutput(name, value) {
    if (!process.env.GITHUB_OUTPUT) return;
    const { appendFile } = await import('node:fs/promises');
    await appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`, 'utf8');
}

function parseJsonOutput(stdout = '') {
    const text = String(stdout || '').trim();
    if (!text) return null;

    try {
        return JSON.parse(text);
    } catch {
        const lines = text.split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
            if (!lines[index].startsWith('{')) continue;

            try {
                return JSON.parse(lines.slice(index).join('\n'));
            } catch {
                // Keep scanning; earlier log lines can contain object-like diagnostics.
            }
        }
    }

    return null;
}

async function main() {
    const estimatedLatestDrawNo = estimateLatestDrawKST();
    const latestBefore = await readLatestStaticDrawNo();
    let deferred = false;
    let deferredReason = '';
    let lottoOfficialDeferred = false;
    let lottoOfficialDeferredReason = '';

    const pension720Refresh = await runNodeScript('scripts/fetch_pension720_stats.mjs', [
        '--defer-official-unavailable',
        '--defer-estimated-missing'
    ]);
    const pension720Summary = parseJsonOutput(pension720Refresh.result.stdout);
    const pension720Deferred = Boolean(pension720Summary?.deferred);
    const pension720DeferredReason = pension720Summary?.deferredReason || '';

    if (estimatedLatestDrawNo > latestBefore) {
        const lottoSync = await runNodeScript(
            'scripts/sync_lotto_stats.mjs',
            ['--target', String(estimatedLatestDrawNo)],
            { allowFailure: true }
        );
        if (!lottoSync.ok) {
            const scheduledCheck = await runNodeScript(
                'scripts/check_lotto_official_freshness.mjs',
                LOTTO_OFFICIAL_SCHEDULED_ARGS,
                { allowFailure: true }
            );
            if (!scheduledCheck.ok) {
                throw lottoSync.error;
            }
            const lottoOfficialSummary = parseJsonOutput(scheduledCheck.result.stdout);
            lottoOfficialDeferred = Boolean(lottoOfficialSummary?.deferred);
            lottoOfficialDeferredReason = lottoOfficialSummary?.deferredReason || '';
            deferred = true;
            deferredReason =
                lottoOfficialDeferredReason ||
                `estimated Lotto draw ${estimatedLatestDrawNo} is not published by the official endpoint yet`;
        }
    } else {
        // Static snapshot already matches estimated latest. Still run the scheduled official
        // check so field-level drift is caught when the source is up; AbortError/timeouts defer.
        const scheduledCheck = await runNodeScript(
            'scripts/check_lotto_official_freshness.mjs',
            LOTTO_OFFICIAL_SCHEDULED_ARGS,
            { allowFailure: true }
        );
        if (!scheduledCheck.ok) {
            throw scheduledCheck.error;
        }
        const lottoOfficialSummary = parseJsonOutput(scheduledCheck.result.stdout);
        lottoOfficialDeferred = Boolean(lottoOfficialSummary?.deferred);
        lottoOfficialDeferredReason = lottoOfficialSummary?.deferredReason || '';
    }

    // Official-source flakiness (timeout/AbortError) must not block SW/docs baseline refresh when
    // static data is already at the estimated latest draw. Only estimated-missing defers those steps.
    if (!deferred) {
        await runNodeScript('scripts/generate_sw_manifest.mjs');
        await runNodeScript('scripts/update_docs_data_baseline.mjs');
    }

    const latestAfter = await readLatestStaticDrawNo();
    const summary = {
        ok: true,
        deferred,
        deferredReason,
        lottoOfficialDeferred,
        lottoOfficialDeferredReason,
        pension720Deferred,
        pension720DeferredReason,
        estimatedLatestDrawNo,
        latestBefore,
        latestAfter
    };

    await setGithubOutput('deferred', deferred ? 'true' : 'false');
    await setGithubOutput('lotto_official_deferred', lottoOfficialDeferred ? 'true' : 'false');
    await setGithubOutput('pension720_deferred', pension720Deferred ? 'true' : 'false');
    console.log(JSON.stringify(summary, null, 2));
}

main().catch(async (error) => {
    await setGithubOutput('deferred', 'false');
    await setGithubOutput('lotto_official_deferred', 'false');
    await setGithubOutput('pension720_deferred', 'false');
    console.error(error);
    process.exitCode = 1;
});
