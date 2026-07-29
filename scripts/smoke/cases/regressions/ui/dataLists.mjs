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

function runDataListPaginationRegression() {
    const ctx = {
        dataListPageSize: 20,

        dataListState: {
            ticket: { query: '', page: 3 }
        },

        getDataListState: LottoApp.prototype.getDataListState
    };

    const items = Array.from({ length: 55 }, (_, idx) => idx + 1);

    const page = LottoApp.prototype.paginateItems.call(ctx, 'ticket', items);

    assert.equal(page.page, 3, 'existing page must be preserved when in range');

    assert.equal(page.items.length, 15, 'last page must render only remaining items');

    assert.equal(page.items[0], 41, 'last page must start from the correct offset');

    LottoApp.prototype.setDataListQuery.call(ctx, 'ticket', '1210');

    assert.equal(ctx.dataListState.ticket.page, 1, 'changing search query must reset the page to 1');
}

function runDataListDomRegression() {
    const previousDocument = globalThis.document;

    const favSearch = createField();

    const historySearch = createField();

    const ticketSearch = createField();

    const campaignSearch = createField();

    const favList = createField();

    const historyList = createField();

    const ticketList = createField();

    const campaignList = createField();

    const favPagination = createField();

    const historyPagination = createField();

    const ticketPagination = createField();

    const campaignPagination = createField();

    const ticketFilter = createField({ value: 'all' });

    const localUpdatesSummary = createField();

    const localUpdatesMeta = createField();

    const clearLocalUpdatesBtn = createField();

    globalThis.document = createDocumentStub({
        '#favSearch': favSearch,

        '#historySearch': historySearch,

        '#ticketSearch': ticketSearch,

        '#campaignSearch': campaignSearch,

        '#favList': favList,

        '#historyList': historyList,

        '#ticketList': ticketList,

        '#campaignList': campaignList,

        '#favPagination': favPagination,

        '#historyPagination': historyPagination,

        '#ticketPagination': ticketPagination,

        '#campaignPagination': campaignPagination,

        '#ticketFilter': ticketFilter,

        '#localUpdatesSummary': localUpdatesSummary,

        '#localUpdatesMeta': localUpdatesMeta,

        '#clearLocalUpdatesBtn': clearLocalUpdatesBtn
    });

    try {
        const ctx = {
            data: {
                state: {
                    favorites: Array.from({ length: 25 }, (_, idx) => ({
                        numbers: [1, 2, 3, 4, 5, idx + 6],

                        date: `2026-03-${String((idx % 25) + 1).padStart(2, '0')}T00:00:00.000Z`
                    })),

                    history: [{ numbers: [6, 7, 8, 9, 10, 11], date: '2026-02-01T00:00:00.000Z' }],

                    ticketBook: [
                        {
                            id: 'ticket<&"\'',

                            numbers: [1, 2, 3, 4, 5, 6],

                            targetDrawNo: 1210,

                            checked: null,

                            quantity: 2
                        }
                    ],

                    campaigns: [
                        {
                            id: 'campaign_1',

                            name: '테스트 캠페인',

                            startDrawNo: 1210,

                            weeks: 4,

                            setsPerWeek: 3
                        }
                    ]
                },

                getTicketQuantity(ticket) {
                    return Number(ticket?.quantity || 1);
                },

                getTotalTicketCount(tickets = []) {
                    return (tickets || []).reduce((sum, ticket) => sum + Number(ticket?.quantity || 1), 0);
                },

                getLocalUpdates() {
                    return [{ draw_no: 1211 }];
                }
            },

            dateFormatter: new Intl.DateTimeFormat('ko-KR'),

            dataListPageSize: 20,

            dataListState: {
                fav: { query: '2026-03-10', page: 1 },

                history: { query: '', page: 1 },

                ticket: { query: '', page: 1 },

                campaign: { query: '', page: 1 }
            },

            renderSettingsPanel() {},

            escapeHtml: LottoApp.prototype.escapeHtml,

            getDataListState: LottoApp.prototype.getDataListState,

            matchesSearch: LottoApp.prototype.matchesSearch,

            paginateItems: LottoApp.prototype.paginateItems,

            renderPagination: LottoApp.prototype.renderPagination,

            getTicketStatusMeta: LottoApp.prototype.getTicketStatusMeta,

            formatDate: LottoApp.prototype.formatDate
        };

        LottoApp.prototype.renderDataLists.call(ctx);

        assert.equal(favSearch.value, '2026-03-10', 'favorite search input must reflect list state');

        assert.match(favList.innerHTML, /data-raw-index="/, 'favorite rows must keep raw index for delegated actions');

        assert.ok(!favList.innerHTML.includes('2026. 3. 11.'), 'favorite search must filter out unmatched rows');

        assert.match(favPagination.innerHTML, /총 1개/, 'favorite pagination summary must render');

        assert.match(favPagination.innerHTML, /1 \/ 1/, 'favorite pagination page text must render');

        assert.match(
            ticketList.innerHTML,

            /data-id="ticket&lt;&amp;&quot;&#39;"/,

            'ticket data-id must be HTML-escaped'
        );

        assert.match(ticketList.innerHTML, /x2/, 'ticket list must render grouped quantity badge');

        assert.match(
            ticketPagination.innerHTML,

            /총 2개 티켓/,

            'ticket pagination summary must use physical ticket count'
        );

        assert.match(
            localUpdatesSummary.textContent,

            /1개/,

            'local updates summary must reflect stored local update count'
        );

        assert.match(localUpdatesMeta.textContent, /1211회/, 'local updates meta must show latest local draw number');

        assert.equal(
            clearLocalUpdatesBtn.disabled,

            false,

            'local updates clear button must be enabled when updates exist'
        );
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    }
}

function runCheckTargetCardAttributeEscapingRegression() {
    const previousDocument = globalThis.document;

    const listEl = createField();

    const metaEl = createField();

    const ticketFilterRow = createField({ hidden: false });

    globalThis.document = createDocumentStub({
        '#checkTargetCards': listEl,

        '#checkSelectionMeta': metaEl,

        '#checkTicketStatusRow': ticketFilterRow
    });

    try {
        const ctx = {
            source: 'tickets',

            ticketStatusFilter: 'all',

            searchQuery: '',

            selectedItemKey: '',

            dateFormatter: new Intl.DateTimeFormat('ko-KR'),

            data: {
                state: {
                    ticketBook: [
                        {
                            id: 'ticket" autofocus onfocus="alert(1)',

                            numbers: [1, 2, 3, 4, 5, 6],

                            targetDrawNo: 1221,

                            checked: null,

                            quantity: 1
                        }
                    ]
                },

                getTicketQuantity(ticket) {
                    return Number(ticket?.quantity || 1);
                }
            },

            getList: CheckModule.prototype.getList,

            getTicketStatusLabel: CheckModule.prototype.getTicketStatusLabel,

            getTicketStatusCode: CheckModule.prototype.getTicketStatusCode,

            getItemQuantity: CheckModule.prototype.getItemQuantity,

            formatDate: CheckModule.prototype.formatDate,

            buildItemKey: CheckModule.prototype.buildItemKey,

            matchesQuery: CheckModule.prototype.matchesQuery,

            getVisibleItems: CheckModule.prototype.getVisibleItems,

            ensureSelection: CheckModule.prototype.ensureSelection
        };

        CheckModule.prototype.renderList.call(ctx);

        assert.doesNotMatch(
            listEl.innerHTML,

            /data-item-key="ticket" autofocus/,

            'check target card must not allow injected attributes through data-item-key'
        );

        assert.match(
            listEl.innerHTML,

            /data-item-key="ticket&quot; autofocus onfocus=&quot;alert\(1\)"/,

            'check target card must HTML-escape data-item-key values'
        );
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    }
}

async function runLiveRegionAccessibilityRegression() {
    const indexSource = await readFile(resolve(process.cwd(), 'index.html'), 'utf8');

    ['genResultList', 'aiOutput', 'checkResultArea', 'syncLog'].forEach((id) => {
        const pattern = new RegExp(`id="${id}"[\\s\\S]*?aria-live="polite"[\\s\\S]*?aria-busy="false"`);

        assert.match(indexSource, pattern, `${id} must expose live and busy attributes`);
    });

    assert.match(
        indexSource,
        /id="pension720Output"[\s\S]*?aria-live="polite"/,
        'pension720 output must expose a polite live region'
    );
    assert.match(
        indexSource,
        /id="dataStatusSummary"[\s\S]*?aria-live="polite"/,
        'data status summary must expose a polite live region'
    );
    assert.match(
        indexSource,
        /id="toast-live-region"[\s\S]*?aria-live="polite"/,
        'toast live region must remain for screen readers'
    );
    assert.match(indexSource, /role="dialog"[\s\S]*?aria-modal="true"/, 'settings dialog must declare modal semantics');

    const modalSource = await readFile(resolve(process.cwd(), 'assets/modules/core/ui/modal.js'), 'utf8');
    assert.match(modalSource, /_trapFocus/, 'modal helper must trap Tab focus');
    assert.match(modalSource, /Escape/, 'modal helper must handle Escape to close');
    assert.match(modalSource, /previousFocus/, 'modal helper must restore previous focus on close');
}

export {
    runDataListPaginationRegression,
    runDataListDomRegression,
    runCheckTargetCardAttributeEscapingRegression,
    runLiveRegionAccessibilityRegression
};
