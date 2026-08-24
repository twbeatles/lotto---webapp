/* global window */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const MIME_TYPES = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ttf': 'font/ttf',
    '.txt': 'text/plain; charset=utf-8',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2'
};

function getContentType(filePath) {
    return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

async function createStaticServer() {
    const server = http.createServer(async (req, res) => {
        try {
            const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
            const relativePath = decodeURIComponent(requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname);
            const safePath = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, '');
            const resolvedPath = path.resolve(repoRoot, `.${safePath}`);
            if (!resolvedPath.startsWith(repoRoot)) {
                res.writeHead(403);
                res.end('Forbidden');
                return;
            }

            const data = await fs.readFile(resolvedPath);
            res.writeHead(200, {
                'Content-Type': getContentType(resolvedPath),
                'Cache-Control': 'no-cache'
            });
            res.end(data);
        } catch (_e) {
            res.writeHead(404);
            res.end('Not found');
        }
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    return {
        origin: `http://127.0.0.1:${address.port}`,
        async close() {
            await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
        }
    };
}

async function launchBrowser() {
    const launchCandidates =
        process.platform === 'win32' ? [{ channel: 'msedge' }, { channel: 'chrome' }, {}] : [{ channel: 'chrome' }, {}];
    const errors = [];

    for (const candidate of launchCandidates) {
        try {
            return await chromium.launch({
                ...candidate,
                headless: true
            });
        } catch (error) {
            errors.push(`${candidate.channel || 'bundled'}: ${error.message}`);
        }
    }

    throw new Error(`Playwright browser launch failed. Tried: ${errors.join(' | ')}`);
}

async function runCanary(page, { requireOfficial = false } = {}) {
    return page.evaluate(
        async (options) => {
            const data = window.app?.data;
            if (!data?.state?.winningStats?.length) {
                throw new Error('app winning stats were not loaded');
            }

            const latestDrawNo = Number(data.state.winningStats[0]?.draw_no || 0);
            const lottoLogs = [];
            const lottoItem = await data.fetchOneDraw(
                latestDrawNo,
                { url: '', source: 'built-in' },
                (message, code, meta = null) => {
                    lottoLogs.push({ message, code, meta });
                }
            );

            const pensionOk = await data.fetchPension720Stats({ remote: true, preserveExistingOnFailure: true });
            const pensionHealth = data.mergePension720DataHealth(
                data.pension720DataHealth || data.getDefaultPension720DataHealth()
            );
            const pensionLatest = data.state.pension720Stats?.[0] || null;
            const allowedSources = options.requireOfficial
                ? ['official', 'official_cache', 'custom_proxy', 'third_party']
                : ['official', 'official_cache', 'custom_proxy', 'third_party', 'static'];

            const pensionRemote = typeof data.fetchPension720OfficialRemote === 'function';

            return {
                latestDrawNo,
                lottoItem,
                lottoLogs,
                pensionOk,
                pensionHealth,
                pensionLatest,
                pensionRemote,
                pensionSyncMeta: data.mergePension720SyncMeta?.(
                    data.state.syncMeta?.pension720 || data.getDefaultPension720SyncMeta?.()
                ),
                allowedSources
            };
        },
        { requireOfficial }
    );
}

async function main() {
    const requireOfficial = process.argv.includes('--require-official');
    const server = await createStaticServer();
    const browser = await launchBrowser();

    try {
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto(server.origin, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => Boolean(window.app?.data?.state?.winningStats?.length), null, {
            timeout: 20000
        });

        const result = await runCanary(page, { requireOfficial });
        if (Number(result.lottoItem?.draw_no || 0) !== result.latestDrawNo) {
            console.error(
                JSON.stringify(
                    {
                        ok: false,
                        reason: 'lotto fetch mismatch',
                        latestDrawNo: result.latestDrawNo,
                        lottoItem: result.lottoItem,
                        lottoLogs: result.lottoLogs
                    },
                    null,
                    2
                )
            );
        }
        assert.equal(
            Number(result.lottoItem?.draw_no || 0),
            result.latestDrawNo,
            'browser live canary must fetch the loaded latest Lotto draw'
        );
        assert.equal(result.pensionOk, true, 'browser live canary must hydrate Pension720 data');
        assert.equal(result.pensionHealth.availability, 'full', 'Pension720 browser source must be usable');
        assert.ok(
            result.allowedSources.includes(result.pensionHealth.source),
            `Pension720 source must be ${result.allowedSources.join('/')} in browser runtime`
        );
        assert.equal(result.pensionRemote, true, 'browser canary must expose pension720 official remote fetch API');
        if (result.pensionSyncMeta?.lastSuccessDrawNo) {
            assert.ok(
                result.pensionSyncMeta.lastSuccessDrawNo >= Number(result.pensionLatest?.draw_no || 0),
                'pension720 sync meta must track the latest reflected draw'
            );
        }
        if (!result.allowedSources.includes(result.pensionHealth.source)) {
            assert.match(
                result.pensionHealth.message || '',
                /기본 포함|캐시|공식|CORS|중계|연결/,
                'browser runtime fallback must expose a data-source message'
            );
        }

        console.log(
            JSON.stringify(
                {
                    ok: true,
                    origin: server.origin,
                    requireOfficial,
                    lotto: {
                        drawNo: result.lottoItem.draw_no,
                        date: result.lottoItem.date,
                        warnings: result.lottoLogs.filter((entry) => entry.code === 'SYNC_FETCH_ONE_INVALID_PAYLOAD')
                    },
                    pension720: {
                        source: result.pensionHealth.source,
                        availability: result.pensionHealth.availability,
                        latestDrawNo: result.pensionLatest?.draw_no || 0,
                        message: result.pensionHealth.message,
                        syncMeta: result.pensionSyncMeta
                    }
                },
                null,
                2
            )
        );
        await context.close();
    } finally {
        await browser.close();
        await server.close();
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
