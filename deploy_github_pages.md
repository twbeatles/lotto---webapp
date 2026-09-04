# GitHub Pages 배포/운영 안내

`로또·연금복권 프로`는 루트 정적 파일을 그대로 GitHub Pages에 배포하는 no-build SPA입니다.

- 저장소: `https://github.com/twbeatles/lotto-pension-pro-webapp`
- 배포 URL: `https://twbeatles.github.io/lotto-pension-pro-webapp/`
- 패키지명: `lotto-pension-pro-webapp`
- 배포 대상: `index.html`, `assets/`, `data/`, `manifest.json`, `sw.js`, `.nojekyll`, `THIRD_PARTY_NOTICES.md`

## 배포 전 확인

```bash
npm install
npm run sync:lotto
npm run sync:sw-manifest
npm run lint
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
npm run test:browser
npm run test:sync-live:browser
npm run test:sync-live:browser:official
git diff --check
```

`npm run build`는 별도 번들을 만들지 않고 `lint -> check:data-freshness -> check:pension720 -> check:pension720:freshness -> smoke`를 실행합니다. `npm run build:release`는 strict Lotto freshness와 `check:lotto:official`을 추가로 요구하며, 최신 회차 차이나 공식값 mismatch가 있으면 실패합니다. 공식 source 브라우저 canary까지 한 번에 확인하려면 `npm run build:release:browser`를 사용합니다.

Lotto official freshness와 Pension720+ freshness 검증은 공식 endpoint를 조회하므로 네트워크 또는 공식 endpoint 장애 시 실패할 수 있습니다.

`npm run test:browser`의 happy path에는 Pension720+ 추천, 개별 저장, 확장 조 저장, 캠페인 생성, target-aware 확인, CSV 다운로드 검증이 포함됩니다.

## 배포 브랜치에 포함하지 않을 로컬 산출물

- 브라우저 캡처/시각 검증 결과: `output/`
- Playwright HTML report: `playwright-report/`
- Playwright test output: `test-results/`, `.playwright/`
- benchmark/report output: `bench-results/`, `perf-results/`, `reports/`
- 브라우저에서 내려받은 백업/CSV 파일
- 로컬 dev-server 로그, trace, HAR, video 파일
- 로컬 CodeGraph 인덱스: `.codegraph/`

위 항목은 `.gitignore`에서 제외합니다.

`.github/workflows/data-freshness.yml`은 운영 workflow이므로 배포 브랜치에 포함합니다. `.github/workflows/browser-official.yml`도 official source canary 운영 workflow로 포함합니다.

## 데이터 운영

- Lotto 6/45:
    - 정적 데이터: `data/winning_stats.json`
    - 최신 회차: `1239`
    - row 수: `1238`
    - 허용 누락 회차: `[146]`
    - 동기화: `npm run sync:lotto`
    - 개발 검증: `npm run check:data-freshness`
    - 릴리스 검증: `npm run check:data-freshness:strict`
    - 공식 필드 검증: `npm run check:lotto:official`
- Pension720+:
    - 정적 데이터: `data/pension720_stats.json`
    - 최신 회차: `331`
    - 최신 날짜: `2026-09-03`
    - 최신 1등: `3조 439582`
    - 최신 보너스: `043537`
    - 동기화: `npm run sync:pension720`
    - 검증: `npm run check:pension720`
    - 공식 최신성 검증: `npm run check:pension720:freshness`

앱 실행 중에는 Lotto 6/45와 Pension720+ 데이터를 각각 런타임 동기화합니다. 실패 시 포함된 정적 데이터, 기존 메모리 데이터, 로컬 업데이트 또는 official cache 기반 상태를 유지합니다. Lotto static JSON 조회가 일시 실패해도 기존 in-memory 당첨 통계와 로컬 보정 데이터를 병합해 local-only partial 상태로 축소하지 않습니다.

## 백업/내보내기 파일명

- 전체 백업: `lotto_pension_pro_backup_v5_<timestamp>.json`
- 가져오기 overwrite 전 자동 백업: `lotto_pension_pro_before_replace_<timestamp>.json`
- 데이터 정리 전 자동 백업: `lotto_pension_pro_before_cleanup_<timestamp>.json`
- Pension720+ 저장 번호 CSV: `lotto_pension_pro_pension720_tickets_<timestamp>.csv`
- 시뮬레이션 전략 비교 CSV: `시뮬레이션_전략비교_<timestamp>.csv`

전체 백업/가져오기 파일 크기 한도는 32MB입니다. overwrite import와 cleanup은 지원 브라우저에서 File System Access API로 백업 파일 쓰기 완료를 먼저 시도하고, 미지원 브라우저에서는 백업 다운로드 후 사용자가 파일 저장을 확인해야 계속 진행합니다.
Pension720+ 저장 번호 CSV와 시뮬레이션 CSV는 spreadsheet formula로 실행될 수 있는 `=`, `+`, `-`, `@` prefix를 escape합니다.

## 고급 데이터 연결 주소

고급 데이터 연결 주소는 Lotto 6/45 최신 결과 동기화를 보강하는 옵션입니다.

예시:

```text
https://twbeatles.github.io/lotto-pension-pro-webapp/?proxyUrl=https%3A%2F%2F<worker>.workers.dev%2Fproxy%2Flatest
```

우선순위:

1. URL query의 `?proxyUrl=` 또는 `?proxy=`
2. legacy settings key `proxyLatestUrl`
3. `lotto_pro_settings_v2.customProxy`
4. 기본 자동 동기화 fallback

지원 형식:

- 절대 `http(s)` URL
- path에 `/proxy/latest` 포함
- Worker는 앱과 같은 KST 회차 추정 helper를 사용하며, `/proxy/latest`와 `/proxy/range`는 예상 최신 회차 `+1`을 넘는 요청을 `400`과 `maxDrawNo`로 거부합니다.
- `?url=`, `{url}`, `{draw_no}` 형식은 런타임에서 기본 자동 동기화로 내려갑니다.

## PWA와 캐시

- 현재 `sw.js` cache version: `v30`
- 현재 strategy worker asset query version: `v23`
- cache names:
    - `lotto-pension-pro-app-shell-v30`
    - `lotto-pension-pro-data-v30`
- precache manifest는 `scripts/generate_sw_manifest.mjs`가 `assets/sw-precache-manifest.js`로 생성합니다.
- install precache에는 split module 기반 앱 셸과 `data/winning_stats.json`, `data/pension720_stats.json`이 포함됩니다.
- `data/*.json` 요청은 최신성 우선 network-first를 사용하고, 네트워크 실패나 오류 응답 시 data cache로 fallback합니다.
- precache 실패는 `__cache-health.json` marker로 기록합니다. 설치는 계속 허용하고 앱 설정/상태 화면에서 정상/주의 상태와 실패 개수를 표시합니다.
- `online-check.txt` 같은 출처 reachability probe는 service worker cache 대상에서 제외합니다.

배포 후 확인:

1. Pages URL 접속
2. 강력 새로고침
3. DevTools > Application > Manifest에서 앱명 `로또·연금복권 프로` 확인
4. DevTools > Application > Service Workers에서 `v30` 활성화 확인
5. 설정/상태 화면에서 PWA cache health 확인
6. Lotto 6/45 번호 생성, 번호 추천, 당첨 확인, Pension720+ 추천/저장/대상 회차 확인 확인
7. Offline 모드에서 캐시된 lazy route 접근 확인

## 로컬 실행

`file://` 직접 열기 대신 HTTP 서버를 사용합니다.

```bash
python -m http.server 5173
```

접속:

```text
http://localhost:5173/
```

## 브라우저 검증

```bash
npm run test:browser
npm run test:happy
npm run test:offline
npm run test:pwa-mobile
npm run test:sync-live:browser
npm run test:sync-live:browser:official
```

- 시스템 `Chrome`/`Edge` 또는 Playwright Chromium이 필요합니다.
- 브라우저가 없으면 `npx playwright install chromium`을 먼저 실행합니다.
- `npm run test:sync-live`는 Node 기반 opt-in 동기화 검증입니다.
- `npm run test:sync-live:browser`는 실제 브라우저에서 Lotto 단일 회차 fetch와 Pension720+ source/fallback 상태를 확인하는 opt-in live canary입니다.
- `npm run test:sync-live:browser:official`은 Pension720+ source가 `official` 또는 `official_cache`가 아닐 때 실패하는 엄격 canary입니다.
- `.github/workflows/data-freshness.yml`은 scheduled/manual freshness check 후 필요한 데이터와 문서 baseline을 갱신하고 release gate 통과 시 main에 자동 커밋합니다.
- `.github/workflows/browser-official.yml`은 official source browser canary를 별도 workflow에서 검증합니다.

## 문제 해결

- 화면은 열리지만 기능이 멈추면 Console의 module error와 Network의 `assets/modules/**/*.js` 상태를 먼저 확인합니다.
- 앱명이 오래 보이면 service worker와 site data를 지우고 다시 접속합니다.
- 데이터가 오래되었으면 `npm run sync:lotto`, `npm run check:data-freshness`, `npm run check:lotto:official`, `npm run check:pension720`, `npm run check:pension720:freshness` 결과를 확인합니다.
- precache 목록 변경이 반영되지 않으면 `npm run sync:sw-manifest`를 다시 실행하고 `sw.js` cache version을 확인합니다.
