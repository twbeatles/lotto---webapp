/**
 * Guardrails for cache-busting constants.
 * - Always: SW CACHE_VERSION and strategy worker asset version must be present and wired.
 * - When git base is available: changing strategy.worker.js / sw.js without version bump fails.
 */
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const baseRef = process.env.ASSET_VERSION_BASE || process.env.GITHUB_BASE_REF || '';

function readSync(relativePath) {
    return readFile(resolve(ROOT, relativePath), 'utf8');
}

function extractConst(source, name) {
    const match = source.match(new RegExp(`(?:const|export const)\\s+${name}\\s*=\\s*['"]([^'"]+)['"]`));
    return match?.[1] || '';
}

function gitDiffNames(base) {
    try {
        const out = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], {
            cwd: ROOT,
            encoding: 'utf8'
        });
        return out
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
    } catch {
        return null;
    }
}

function gitDiffContains(base, file, pattern) {
    try {
        const out = execFileSync('git', ['diff', `${base}...HEAD`, '--', file], {
            cwd: ROOT,
            encoding: 'utf8'
        });
        return pattern.test(out);
    } catch {
        return false;
    }
}

const swSource = await readSync('sw.js');
const workerClientConfig = await readSync('assets/modules/core/strategyWorkerClient/config.js');
const workerClient = await readSync('assets/modules/core/strategyWorkerClient/client.js');

const cacheVersion = extractConst(swSource, 'CACHE_VERSION');
const strategyWorkerVersion = extractConst(workerClientConfig, 'STRATEGY_WORKER_ASSET_VERSION');

if (!cacheVersion) {
    throw new Error('sw.js must define CACHE_VERSION');
}
if (!strategyWorkerVersion) {
    throw new Error('strategyWorkerClient/config.js must define STRATEGY_WORKER_ASSET_VERSION');
}
if (!swSource.includes(`lotto-pension-pro-app-shell-\${CACHE_VERSION}`) && !swSource.includes(cacheVersion)) {
    throw new Error('sw.js cache names must incorporate CACHE_VERSION');
}
if (!workerClient.includes('STRATEGY_WORKER_ASSET_VERSION')) {
    throw new Error('StrategyWorkerClient must reference STRATEGY_WORKER_ASSET_VERSION for cache busting');
}

const issues = [];
const base = baseRef
    ? baseRef.startsWith('origin/')
        ? baseRef
        : `origin/${baseRef}`
    : '';

if (base) {
    const changed = gitDiffNames(base);
    if (Array.isArray(changed)) {
        if (changed.includes('assets/strategy.worker.js') || changed.includes('assets\\strategy.worker.js')) {
            if (!gitDiffContains(base, 'assets/modules/core/strategyWorkerClient/config.js', /STRATEGY_WORKER_ASSET_VERSION/)) {
                issues.push(
                    'assets/strategy.worker.js changed but STRATEGY_WORKER_ASSET_VERSION was not bumped in strategyWorkerClient/config.js'
                );
            }
        }
        if (changed.includes('sw.js')) {
            // Only require bump when non-comment behavioral regions change is hard; require CACHE_VERSION appears in diff if fetch/install handlers change.
            const swDiff = (() => {
                try {
                    return execFileSync('git', ['diff', `${base}...HEAD`, '--', 'sw.js'], {
                        cwd: ROOT,
                        encoding: 'utf8'
                    });
                } catch {
                    return '';
                }
            })();
            const significant =
                /\b(fetch|install|activate|networkFirst|staleWhileRevalidate|safePrecache)\b/.test(swDiff) &&
                !/CACHE_VERSION/.test(swDiff);
            if (significant) {
                issues.push('sw.js behavior changed without CACHE_VERSION appearing in the diff; bump CACHE_VERSION');
            }
        }
    }
}

if (issues.length) {
    console.error(JSON.stringify({ ok: false, cacheVersion, strategyWorkerVersion, issues }, null, 2));
    process.exitCode = 1;
} else {
    console.log(
        JSON.stringify(
            {
                ok: true,
                cacheVersion,
                strategyWorkerVersion,
                baseChecked: Boolean(base)
            },
            null,
            2
        )
    );
}
