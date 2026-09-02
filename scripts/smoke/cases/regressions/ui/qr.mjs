/* eslint-disable no-unused-vars */
import {
    assert,
    CheckModule,
    createDocumentStub,
    createField,
    DataManager,
    LottoApp,
    QrScannerModule,
    readFile,
    resolve,
    UIManager
} from '../support.mjs';

import { regressionBarrelExportNames } from '../manifest.mjs';

function runQrValidationRegression() {
    const parse = (value) => QrScannerModule.prototype.parseLottoQr.call({}, value);

    const ok = parse('https://m.dhlottery.co.kr/?v=0861q010203040506');

    assert.equal(ok.length, 1, 'valid official QR must be parsed');

    assert.equal(ok[0].targetDrawNo, 861, 'QR parser must preserve draw number');

    assert.deepEqual(ok[0].numbers, [1, 2, 3, 4, 5, 6], 'QR parser must preserve ticket numbers');

    const apexQr = parse('https://dhlottery.co.kr/qr.do?method=winQr&v=1071q010203040506q070809101112');
    assert.equal(apexQr.length, 2, 'apex dhlottery.co.kr /qr.do QR must be accepted');
    assert.equal(apexQr[0].targetDrawNo, 1071, 'qr.do payload must preserve draw number');
    assert.deepEqual(apexQr[1].numbers, [7, 8, 9, 10, 11, 12], 'second q-game must be parsed');

    const mixedTypes = parse(
        'https://m.dhlottery.co.kr/qr.do?method=winQr&v=1157m050712202526q010203040506n070809101112s131415161718101654792'
    );
    assert.equal(mixedTypes.length, 4, 'official m/q/n/s game markers must each yield a game');
    assert.equal(mixedTypes[0].targetDrawNo, 1157, 'draw number before type letter must be preserved');
    assert.deepEqual(mixedTypes[0].numbers, [5, 7, 12, 20, 25, 26], 'leading auto (m) game must not be dropped');
    assert.deepEqual(mixedTypes[1].numbers, [1, 2, 3, 4, 5, 6], 'manual (q) game must be parsed');
    assert.deepEqual(mixedTypes[2].numbers, [7, 8, 9, 10, 11, 12], 'semi-auto (n) game must be parsed');
    assert.deepEqual(
        mixedTypes[3].numbers,
        [13, 14, 15, 16, 17, 18],
        'final (s) game must ignore trailing serial digits'
    );

    assert.throws(
        () => parse('https://evil.example.com/?v=0861q010203040506'),

        /공식 큐알 코드/,

        'non-official host must be rejected'
    );

    assert.throws(
        () => parse('https://evil.dhlottery.co.kr/?v=0861q010203040506'),

        /공식 큐알 코드/,

        'lookalike dhlottery subdomain must be rejected'
    );

    assert.throws(
        () => parse('https://m.dhlottery.co.kr/?v=0861q010101020304'),

        /유효한 게임/,

        'duplicate-number game must be rejected'
    );
}

async function runQrScanReentryGuardRegression() {
    const previousDocument = globalThis.document;

    const calls = [];

    globalThis.document = {
        querySelector() {
            return null;
        },

        querySelectorAll() {
            return [];
        }
    };

    try {
        const ctx = {
            isHandlingSuccess: false,

            parseLottoQr() {
                calls.push('parse');

                return [{ targetDrawNo: 861, numbers: [1, 2, 3, 4, 5, 6] }];
            },

            async stop() {
                calls.push('stop');

                await new Promise((resolvePromise) => setTimeout(resolvePromise, 30));
            },

            app: {
                async route(target) {
                    calls.push(`route:${target}`);
                },

                check: {
                    setScannedNumbers(items) {
                        calls.push(`set:${items.length}`);
                    }
                }
            }
        };

        await Promise.all([
            QrScannerModule.prototype.onScanSuccess.call(ctx, 'qr'),

            QrScannerModule.prototype.onScanSuccess.call(ctx, 'qr')
        ]);

        assert.equal(
            calls.filter((x) => x === 'parse').length,

            1,

            'QR success handler must parse only once while busy'
        );

        assert.equal(calls.filter((x) => x === 'stop').length, 1, 'QR success handler must stop scanner only once');

        assert.equal(calls.filter((x) => x === 'route:check').length, 1, 'QR success handler must route only once');

        assert.equal(
            calls.filter((x) => x === 'set:1').length,

            1,

            'QR success handler must set scanned numbers only once'
        );
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    }
}

async function runQrRouteCleanupRegression() {
    const previousDocument = globalThis.document;

    const genPage = createField();

    genPage.classList = { add() {}, remove() {} };

    globalThis.document = createDocumentStub({
        '#page-gen': genPage
    });

    try {
        const calls = [];

        const ctx = {
            routeToken: 0,

            currentRoute: 'check',

            navItems: [],

            pageItems: [],

            navByTarget: new Map(),

            syncRouteDataNotice() {},

            renderRouteDataGate() {
                return false;
            },

            qr: {
                async stop() {
                    calls.push('qr.stop');
                }
            },

            updateLatestWin() {
                calls.push('updateLatestWin');
            }
        };

        await LottoApp.prototype.route.call(ctx, 'gen');

        assert.deepEqual(
            calls,

            ['qr.stop', 'updateLatestWin'],

            'leaving check route must stop QR scanner before rendering next route'
        );
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    }
}

export { runQrValidationRegression, runQrScanReentryGuardRegression, runQrRouteCleanupRegression };
