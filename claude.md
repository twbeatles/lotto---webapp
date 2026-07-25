# Claude Handoff

## Purpose

Current handoff note for agents working on `lotto-pension-pro-webapp`.

- Product name: `로또·연금복권 프로`
- Package/repository slug: `lotto-pension-pro-webapp`
- App type: no-build static SPA
- Primary entry flow: `index.html` -> `assets/modules/index.js` -> `assets/modules/core/LottoApp.js`
- Service worker cache version: `v31`

## Current Data Baseline

- Lotto 6/45 static data:
    - Source: `data/winning_stats.json`
    - Latest draw: `1234`
    - Rows: `1233`
    - Allowed missing draw: `[146]`
- Pension720+ static data:
    - Source: `data/pension720_stats.json`
    - Latest draw: `325`
    - Latest date: `2026-07-23`
    - Latest primary: `3조 011391`
    - Latest bonus: `438906`
- Both data files are included in the generated service-worker precache manifest.

## Runtime Shape

- Core app state and persistence live under `assets/modules/core/`.
- Feature modules live under `assets/modules/features/`.
- Lotto 6/45 recommendation logic remains under the existing strategy stack.
- Pension720+ logic is split across:
    - `assets/modules/core/Pension720StrategyCatalog.js`
    - `assets/modules/core/Pension720Engine.js` facade -> `assets/modules/core/pension720Engine/`
    - `assets/modules/core/data/pension720.js` facade -> `assets/modules/core/data/pension720/`
    - `assets/modules/features/Pension720.js` facade -> `assets/modules/features/pension720/`
- Data import/export UI keeps `assets/modules/features/DataIO.js`, `dataio/support.js`, and `dataio/importExport.js` as public composition points; detailed backup, preview, normalizer, status, and import flow logic lives under `assets/modules/features/dataio/`.
- Smoke regressions keep the `scripts/smoke/cases/regressions.mjs` barrel and `regressions/manifest.mjs` public plan; large regression groups are split under `regressions/{data,generator,sync,ui,plan}/`.
- Storage keys under `CONFIG.KEYS` intentionally keep existing `lotto_pro_*` names for user data compatibility.
- Pension720+ official cache uses `lotto_pro_pension720_stats_cache_v1`.
- Generated/AI/Pension720 temporary results use `lotto_pro_temp_results_state` in sessionStorage only.
- Backup schema is v5 and includes `pension720Tickets` plus `pension720Campaigns`; default export prefix is `lotto_pension_pro_backup_v5`.
- v4 Pension720+ backups remain import-compatible and keep saved tickets.
- Overwrite imports create a silent pre-replace backup with prefix `lotto_pension_pro_before_replace`; data cleanup uses `lotto_pension_pro_before_cleanup`.
- Destructive overwrite/cleanup flows prefer File System Access API backup writes and fall back to download-plus-confirm when the browser does not support it.
- Pension720+ recommendation supports dedicated strategies, presets, group/digit filters, saved tickets, separate campaigns, copy, CSV export, and target-draw-aware checking with latest-draw reference fallback.
- Pension720+ CSV exports use `lotto_pension_pro_pension720_tickets_<timestamp>.csv`.
- CSV exports protect spreadsheet formula prefixes (`=`, `+`, `-`, `@`) in user-visible cells.
- Strategy worker asset query version is `v23`; bump `STRATEGY_WORKER_ASSET_VERSION` whenever worker execution behavior changes.

## Product/Copy Contract

- Use `로또·연금복권 프로` for app title, manifest name, Open Graph title, and current docs.
- Use `lotto-pension-pro-webapp` for package name, repository slug, and Pages URL.
- Keep feature tabs concise:
    - `번호 생성`
    - `당첨 통계`
    - `번호 추천`
    - `연금복권`
    - `시뮬레이션`
    - `당첨 확인`
    - `데이터 관리`
- Avoid reviving legacy user-facing names such as older AI-prediction wording.
- Dated one-off review/audit files may be absent or deleted in the worktree. Do not restore them unless explicitly requested; fold durable conclusions into this handoff, `README.md`, `gemini.md`, or deployment docs.

## Current Implementation Status

- Lotto static data can be refreshed with `npm run sync:lotto`.
- Normal freshness check allows one missing draw; strict release freshness requires zero missing draws.
- localStorage write failures keep dirty state and are surfaced in storage health.
- Cross-tab storage rehydrate flushes pending dirty local state before `data.load()` and defers the remote load if the flush still fails.
- `save(true)` immediate flush is used for pagehide/visibility hidden, cross-tab dirty flush (`flushPendingLocalPersistence`), and pre-async recommendation/generation starts so in-flight UI work is not lost before long worker calls.
- Destructive import overwrite and cleanup trigger a backup download and continue only after explicit user confirmation.
- Service worker precache failures are recorded in `__cache-health.json`; install is allowed and the app shows a warning state.
- Service worker data JSON fetches are network-first with data-cache fallback on network failures or error statuses so data-only deploys prefer the newest static snapshot.
- Data freshness CI can refresh Lotto/Pension720 snapshots, regenerate the service-worker manifest, sync maintained document baselines, and auto-commit to `main`.
- Scheduled Lotto official checks may defer when the estimated latest draw is not published by the official endpoint yet.
- Pension720+ official data is cached when it is newer than static data, same-draw static corrections beat older cache copies, and `official_cache` is shown as a distinct source with a settings cache-clear action.
- Backup import accepts up to 32MB so app-created max-size backups remain reimportable.
- Lotto static JSON failures preserve existing in-memory winning stats, and local updates are merged into that preserved dataset instead of downgrading to local-only partial rows.
- Strategy worker cache-empty errors reset the stats fingerprint and retry once with full stats data.
- Strategy worker requests clean `pending` timers if `worker.postMessage()` fails synchronously.
- Auto-sync availability is computed from recent failure state, last success time, and available sync path instead of being hard-coded.
- DOM selector contract and focused implementation regressions live in the smoke suite.

## Sync and Data Health

- Lotto 6/45:
    - Bundled static JSON is loaded first.
    - Runtime sync can use the official API, supported custom `/proxy/latest`, and built-in fallback providers.
    - The Cloudflare Worker proxy uses the same KST draw schedule helper as the app and rejects public single/range requests beyond estimated latest draw `+1`.
    - `npm run check:data-freshness` fails if static data is more than one draw behind the estimated latest draw.
    - `npm run check:data-freshness:strict` fails if static data is not at the estimated latest draw.
    - `npm run check:lotto:official` compares the checked-in latest Lotto draw fields with the official endpoint and is part of `npm run build:release`.
- Pension720+:
    - `scripts/fetch_pension720_stats.mjs` fetches official `selectPstPt720WnList.do`.
    - `npm run sync:pension720` refreshes `data/pension720_stats.json`.
    - `npm run check:pension720` validates the checked-in snapshot.
    - `npm run check:pension720:freshness` compares checked-in data with the official endpoint and is part of `npm run build`.
- Data health can be `full`, `partial`, or `none`; partial data gates stats/recommendation/backtest routes but keeps generation/check/data flows usable.

## Verification

Run these before considering a change complete:

```bash
npm run lint
npm run check:utf8-korean
npm run check:innerhtml-escape
npm run check:data-freshness
npm run check:data-freshness:strict
npm run check:lotto:official
npm run check:pension720
npm run check:pension720:freshness
npm run check:docs-data-baseline
node scripts/smoke/smoke.mjs
npm run build
npm run build:release
npm run build:release:browser
```

Useful browser checks:

```bash
npm run test:browser
npm run test:happy
npm run test:offline
npm run test:pwa-mobile
npm run test:sync-live
npm run test:sync-live:browser
npm run test:sync-live:browser:official
```

`npm run test:happy` includes the Pension720+ browser path: recommendation, individual save, expansion save, campaign creation, target-aware check, and CSV download validation.

Operational scripts:

```bash
npm run sync:sw-manifest
npm run sync:docs-data-baseline
npm run sync:lotto
npm run sync:pension720
npm run ci:data:check
npm run ci:data:refresh
npm run bench:ai
npm run bench:ai:full
```

## Deployment Notes

- GitHub Pages URL target: `https://twbeatles.github.io/lotto-pension-pro-webapp/`
- Repository rename itself is an external GitHub operation; docs assume it has been or will be completed.
- After changing app shell, manifest, service worker, data files, styles, or modules, rerun `npm run sync:sw-manifest`.
- If installable app metadata or app-shell behavior changes and installed clients need a forced refresh, bump `CACHE_VERSION` in `sw.js`.
- Release baseline is `npm run build:release`.
- Browser release checks should include happy path, offline, PWA mobile validation, and `npm run test:sync-live:browser:official` when official source availability matters.
- `.github/workflows/data-freshness.yml` runs scheduled/manual freshness checks, refreshes stale data/docs, and auto-commits to `main` after the release gate passes.
- `.github/workflows/browser-official.yml` runs the official-source browser canary manually and weekly.
- `.gitignore` was rechecked on 2026-06-12 against `.codegraph/`, app backups, Pension720+/simulation CSV exports, Playwright outputs, report/perf folders, trace/HAR/video files, dependency/temp/build folders, and `.codegraph/` is ignored at the repo root.
- Use `git diff --check` before publishing. CRLF warnings from Git are not the same as whitespace errors.

## Session Handoff Template

```md
### Session Handoff

- Goal:
- Changed surfaces:
- Data/storage impact:
- PWA/cache impact:
- Verification completed:
- Remaining risks:
```
