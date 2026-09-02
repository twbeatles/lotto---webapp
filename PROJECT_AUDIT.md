# Project Audit

감사 일자: 2026-07-29  
대상: `lotto-pension-pro-webapp` (로또·연금복권 프로)  
방법: `README.md` / `Claude.md` 검토 → CodeGraph MCP(`codegraph_explore`) 구조·호출 관계 분석 → 보조 확인(정적 데이터 기준, `node scripts/smoke/smoke.mjs`, `check:data-freshness`)

> **후속 반영 (2026-07-29):** 본 문서 1–2단계 권장 수정이 코드에 반영되었습니다  
> (데이터 동기화, 문서 레거시 슬러그, 쿼리 프록시 fail-closed, 브라우저 공식 API 스킵,  
> generator 무데이터 가드, CORS 실패 UX, 크로스탭 dirty 경고, 관련 smoke 보강).  
> 아래 High-Risk 목록은 **감사 당시 스냅샷**입니다. 현재 게이트는 재검증 통과 상태를 기준으로 하세요.  
> 확장 스코프: `PROJECT_AUDIT_SCOPES.md`.

---

## 1. Executive Summary

전체 위험도 (감사 당시): **Medium–High** — 후속 수정 후 게이트·데이터 freshness 항목은 완화됨.

### 핵심 결론

| 영역 | 평가 |
|------|------|
| 아키텍처·영속화 | 양호. dirty flush, cross-tab rehydrate, import 한도/정규화가 체계적 |
| 동기화 신뢰성 | **구조적 취약**. 브라우저 CORS 때문에 공개 CORS 중계·선택 프록시에 의존 |
| 보안(XSS/CSV/페이로드) | 양호. `escapeHtml`/`safeHtml`, CSV formula 보호, draw 정규화, innerHTML allowlist |
| 현재 CI/로컬 게이트 | **실패 확인**. smoke 회귀·데이터 freshness 모두 깨짐 |
| Critical 데이터 파괴 버그 | 코드 근거상 **즉시 확정된 Critical 손상 경로는 없음** (덮어쓰기 전 백업·정규화 존재) |

### 지금 가장 중요한 3가지

1. **`npm run build` / smoke 실패**: `Claude.md` Spec Kit 구간에 레거시 슬러그 `lotto---webapp`이 남아 smoke 회귀가 중단됨.
2. **정적 데이터 신선도 실패**: 로또 정적 최신 `1232` vs 추정 최신 `1234` (2회차 지연, 허용 1). `check:data-freshness` 실패.
3. **브라우저 실시간 동기화의 외부 의존**: 커스텀 Worker 미설정 시 `corsproxy.io` / `CodeTabs` 경유. 가용성·신뢰성·지연이 사용자 환경에 좌우됨.

앱 코어(생성/추천/백업/워커 타임아웃/부분 데이터 게이트)는 smoke·정규화 회귀로 잘 방어되어 있으나, **릴리스 게이트와 데이터 freshness가 현재 깨져 있어 “기능은 있지만 배포 가능 상태가 아님”**에 가깝습니다.

---

## 2. Project Understanding

### 2.1 목적

- 동행복권 **로또 6/45**·**연금복권720+** 통계 기반 번호 생성·추천·저장·당첨 확인·백업/복원 PWA
- no-build 정적 SPA, GitHub Pages 배포
- 사용자 데이터: **localStorage** (+ sessionStorage 임시 결과)
- 당첨 통계: 번들 JSON + 런타임 동기화/캐시

### 2.2 문서 기준 데이터 베이스라인 (Claude.md)

현재 운영 베이스라인은 `claude.md` Current Data Baseline을 따른다. 바로 아래 표는 그 현재 값이다. 이어서 나오는 “감사 시점 파일 검증”은 **2026-07-29 감사 스냅샷**이며 당시 수치를 보존한다.

| 데이터 | 파일 | 문서 기준 |
|--------|------|-----------|
| 로또 6/45 | `data/winning_stats.json` | latest `1239`, rows `1238`, missing `[146]` |
| 연금복권720+ | `data/pension720_stats.json` | latest `330` (`2026-08-27`, `4조 125905` / bonus `493800`) |
| SW | `sw.js` | `CACHE_VERSION = v32` |
| Strategy worker | config | `STRATEGY_WORKER_ASSET_VERSION = v23` |

감사 시점 파일 검증 (2026-07-29):

- 로또: rows `1231`, max draw `1232` (오름차순 저장, 당시 문서와 일치)
- 연금: rows `323`, latest draw `323` (당시 문서와 일치)
- 스케줄 추정(KST): 로또 **1234**, 연금 **325** → 당시 정적 데이터가 추정 대비 **2회차 지연**

### 2.3 아키텍처 (CodeGraph 기반)

| 계층 | 경로 | 역할 |
|------|------|------|
| 엔트리 | `index.html` → `assets/modules/index.js` | PWA 등록, 앱 부트 |
| 앱 코어 | `assets/modules/core/lottoApp/*` + `LottoApp.js` | init, 라우팅, auto-sync, 모듈 lazy load |
| 상태/영속화 | `DataManager` + `data/persistence/*` | load/save, dirty, cross-tab, proxy |
| 동기화 | `data/sync/orchestrator/*`, `range/*`, `builtinProviders.js` | 정적 JSON + API/프록시/CORS 중계 |
| 연금복권 | `data/pension720/*`, `Pension720Engine`, `features/pension720/*` | 통계·추천·저장·CSV |
| 연산 오프로드 | `StrategyWorkerClient` → `strategy.worker.js` | GENERATE/RECOMMEND |
| 백테스트 | `backtest.worker.js` | 시뮬레이션 워커 |
| 데이터 I/O | `features/dataio/*` | 백업 v5, merge/overwrite, 파괴 전 백업 |
| 프록시(선택) | `proxy/worker.js` | Cloudflare Worker CORS 우회 |
| 검증 | `scripts/smoke/*`, freshness/official 체크 | 회귀·신선도 게이트 |

### 2.4 주요 실행 흐름

```text
index.js
  → LottoApp.init()
      → initCrossTabSync → data.load()
      → ensureQueryProxyAcknowledged()   # ?proxyUrl= 확인 대화상자
      → route('gen')
      → fetchWinningStats()              # static JSON + localUpdates merge
      → fetchPension720Stats({ remote }) # static → cache → remote candidates
      → queueAutoSync(bootstrap/idle)
  → feature modules (Generator/Ai/Pension720/DataIO/...)
      → StrategyWorkerClient.post (serial _dispatchChain)
      → data.save / markDirty / flush on pagehide
```

동기화 내부:

```text
fetchLatestFromAPI
  → resolveProxyConfig (query > legacy > saved custom > empty)
  → fetchRangeChunkedFromProxy 및/또는 fetchMissingDraws
  → buildBuiltInSingleFetchUrls = 공식 API + corsproxy + CodeTabs
  → normalizeDrawItem 로 형태·보너스 중복 검증 후 setLocalUpdates
```

### 2.5 강점으로 확인된 방어

- **동기화 단일 비행**: `syncInFlightPromise` + `runId` + AbortController
- **워커**: 타임아웃/terminate, cache-empty 1회 재시도, postMessage 동기 실패 시 pending 정리, 요청 직렬화(`_dispatchChain`)
- **import**: 32MB 한도, 티켓 수 한도, `_importInFlight`, overwrite 전 백업, payload version 1–5
- **draw 정규화**: 6개 번호/중복/보너스 겹침/날짜 달력 검증
- **XSS/CSV**: escape 헬퍼, formula prefix 보호, innerHTML allowlist + smoke 감사
- **전략 파라미터**: `normalizeRequest`에서 `simulationCount` 1000–20000 clamp
- **data health gate**: stats/ai/backtest 는 full 데이터 필요

---

## 3. High-Risk Issues

### H1. Smoke 회귀가 문서 레거시 슬러그로 실패

* 위치: `Claude.md` (Spec Kit 안내 블록, 프로젝트 이름 `lotto---webapp`) / `scripts/smoke/cases/regressions/ui/latestWin.mjs` (`runRecommendationCopyRegression`)
* 문제: 활성 문서에 금지된 레거시 패턴 `lotto---webapp`이 포함되어 smoke가 AssertionError로 중단됨.
* 영향: `npm run build` / `ci:verify` / 로컬 회귀 전체가 실패. 기능 코드와 무관하게 **배포 게이트 차단**.
* 근거:
  - 감사 시 `node scripts/smoke/smoke.mjs` 실행 →  
    `legacy app/package names must not remain in active docs or metadata`  
    (검사 대상에 `claudeSource` 포함, 패턴에 `lotto---webapp` 포함)
  - `Claude.md` Spec Kit 섹션: `**프로젝트**: \`lotto---webapp\``
* 권장 수정 방향:
  - 문서에는 `lotto-pension-pro-webapp`만 사용하거나, Spec Kit 안내를 smoke 검사 제외 파일로 분리
  - 폴더명 `lotto---webapp`과 제품 슬러그 불일치를 문서/회귀 정책에 명시
* 우선순위: **High** (현재 재현되는 게이트 실패)

---

### H2. 정적 로또 데이터가 신선도 허용치를 초과

* 위치: `data/winning_stats.json` / `scripts/check_static_data_freshness.mjs` / Claude.md baseline
* 문제: 정적 최신 회차 `1232`, KST 추정 최신 `1234` → **2회차 지연**. 일반 freshness 허용은 1.
* 영향:
  - `npm run build`의 `check:data-freshness` 실패
  - 오프라인·동기화 실패 사용자는 최신 회차 없이 생성/확인/추천
  - 자동 sync가 성공하면 런타임 localUpdates로 보완 가능하나, **번들 자체는 stale**
* 근거:
  - `node scripts/check_static_data_freshness.mjs` →  
    `static winning data is 2 draw(s) behind ... Allowed budget is 1.`
  - `estimateLatestDrawKST()` = 1234, 파일 max draw = 1232
* 권장 수정 방향:
  - `npm run sync:lotto` (+ 필요 시 `sync:pension720`) 후 `sync:sw-manifest` / `sync:docs-data-baseline`
  - CI `ci:data:refresh` 스케줄·defer 조건이 누적 delay를 만들지 않는지 점검
* 우선순위: **High**

---

### H3. 브라우저 실시간 동기화가 서드파티 CORS 중계에 의존

* 위치:
  - `assets/modules/core/data/sync/builtinProviders.js` (`BUILTIN_CORS_PROVIDERS`)
  - `assets/modules/core/data/sync/providers.js` (`buildBuiltInSingleFetchUrls`)
  - `assets/modules/core/data/pension720/remoteFetch.js` (`buildPension720RemoteFetchCandidates`)
* 문제: 공식 동행복권 API는 브라우저 CORS로 직접 호출 불가. 커스텀 `/proxy/latest` 미설정 시 `corsproxy.io`, `CodeTabs`를 순차 시도.
* 영향:
  - 중계 장애/차단/속도 저하 시 “기본 자동 동기화” 실패
  - 중계 응답 변조 시 **유효 형태**의 잘못된 당첨 번호가 통과할 수 있음 (`normalizeDrawItem`은 형태만 검증, 출처 진위성은 검증 불가)
  - 개인정보·신뢰성 측면에서 README도 자체 Worker를 권장
* 근거:
  - `BUILTIN_CORS_PROVIDERS`에 공식 → corsproxy.io → CodeTabs 순서
  - 연금복권도 `buildBuiltinCorsFetchUrls(PENSION720_OFFICIAL_LIST_URL)` 사용 (이전 대비 개선, 동일 의존 구조)
* 권장 수정 방향:
  - 기본 배포에 신뢰 가능한 자체 프록시(또는 Pages 호환 BFF) 기본값 제공
  - 서드파티 경로 실패 시 UI에 “정적 데이터 유지 + 수동 동기화 안내”를 더 명확히
  - 가능하면 응답 서명/해시 비교(공식 대비) 또는 multi-source majority 검증 **추정 개선안**
* 우선순위: **High** (기능 가용성·데이터 무결성 구조 리스크)

---

### H4. 커스텀/쿼리 프록시는 형태만 검증 — 신뢰할 수 없는 프록시는 잘못된 “유효 회차”를 주입 가능

* 위치: `assets/modules/core/data/persistence/proxy.js` (`validateCustomProxyUrl`, `resolveProxyConfig`, `ensureQueryProxyAcknowledged`)
* 문제:
  - 검증은 `http(s)` + path에 `/proxy/latest` 포함 여부 수준
  - `?proxyUrl=` 은 세션 확인 대화상자가 있으나, 확인 시 해당 프록시가 동기화 우선 소스가 됨
  - `UIManager.confirm`이 없으면 쿼리 프록시를 **자동 승인**하는 분기 존재
* 영향: 사용자가 확인한 악성 프록시(또는 탈취된 설정)가 유효 형태의 로또 회차를 주입 → 당첨 확인/정산 왜곡
* 근거:
  - `validateCustomProxyUrl`: protocol + pathname includes `/proxy/latest`
  - `ensureQueryProxyAcknowledged`: `if (typeof UIManager?.confirm !== 'function') return true;`
  - `normalizeDrawItem`은 구조 검증만 수행
* 권장 수정 방향:
  - 허용 호스트 allowlist(옵션) 또는 자체 배포 Worker 도메인 고정 권장 UI
  - confirm 미가용 시 **거부(fail-closed)**
  - 가능하면 정적 최신 대비 급격한 점프/불연속 회차 경고
* 우선순위: **High** (사용자 확인 전제 하의 데이터 무결성 리스크)

---

### H5. 크로스탭 동기화는 last-write-wins — 동시 편집 시 데이터 유실 가능

* 위치:
  - `assets/modules/core/data/persistence/storage/crossTab.js`
  - `assets/modules/core/app/networkLifecycle/remoteSync.js` (`_rehydrateAfterRemotePersistenceSync`)
* 문제: 탭 A/B가 각각 dirty 상태에서 저장하면 최종 localStorage 스냅샷이 이김. merge CRDT/필드 단위 병합 없음. remote rehydrate는 flush 후 전체 `load()`.
* 영향: 두 탭에서 동시에 티켓/즐겨찾기 추가 시 한쪽 변경 유실 **가능**
* 근거:
  - `notifyCrossTabStateChange` → 상대 탭 `handleRemotePersistenceSync` → `flushPendingLocalPersistence` 후 `load()`
  - 키 단위 브로드캐스트이나 값은 통째 교체
* 권장 수정 방향:
  - 충돌 감지(버전/타임스탬프) 후 “다른 탭 변경 덮어씀” 경고
  - 티켓/히스토리는 id 기준 merge 재적용 검토
* 우선순위: **Medium**

---

### H6. 번호 생성 경로는 당첨 데이터 공백 가드가 약함

* 위치: `assets/modules/features/generator/actions/generate.js` (`generate`)
* 문제: AI/당첨 확인은 `winningStats.length` 검사 후 중단. Generator `generate()`는 동일 가드 없이 워커/엔진 실행.
* 영향: 데이터 없음·로드 실패 상태에서 생성 시도 시 의미 없는 결과 또는 내부 오류 가능. (라우트 gate는 stats/ai/bt만 full 요구; gen은 의도적으로 열림)
* 근거:
  - `ai/rendering/run/methods.js`: 데이터 없으면 toast 후 return
  - `generator/actions/generate.js`: `winningStats` 길이 검사 없음 (grep 확인)
  - Claude.md: partial 시 generation은 사용 가능하도록 설계
* 권장 수정 방향:
  - 완전 무데이터(`none`)일 때는 생성 차단 + 동기화 유도
  - partial일 때는 경고 토스트(이미 stale 경고 패턴 있으면 재사용)
* 우선순위: **Medium**

---

### H7. 공식 API 후보를 브라우저에서 먼저 시도해 지연·노이즈 증가

* 위치: `builtinProviders.js` — 첫 후보 label `'공식 API'`가 원 URL 그대로
* 문제: 브라우저에서는 CORS로 거의 항상 실패하는 요청을 매 회차/목록 fetch 전에 수행
* 영향: 동기화 지연, 콘솔 오류, 중계 시도 전 타임아웃 소모
* 근거: `buildBuiltinCorsFetchUrls`가 제공자 배열 순서대로 반환; `fetchPension720OfficialRemote` / lotto single fetch가 순차 시도
* 권장 수정 방향:
  - 브라우저 환경에서는 공식 직행 스킵, 중계/커스텀 프록시만 시도
  - 또는 환경 플래그로 분리
* 우선순위: **Medium** (기능 오류라기보다 안정성/UX)

---

### H8. 연금복권 정적 데이터도 추정 대비 지연 (운영 리스크)

* 위치: `data/pension720_stats.json` / `scripts/fetch_pension720_stats.mjs`
* 문제: 정적 latest `323`, 추정 `325` (감사 시점)
* 영향: 원격/캐시 실패 시 연금 탭이 2회차 늦은 스냅샷 사용. `check:pension720:freshness`는 온라인 비교 시 실패 가능
* 근거: 파일 max draw 323, `estimateLatestPension720DrawKST()` 325
* 권장 수정 방향: H2와 함께 `npm run sync:pension720` 및 CI refresh 점검
* 우선순위: **Medium**

---

### L1. 전략 프리셋 import 시 request 내용 정규화가 느슨함 (실행 시 clamp로 완화)

* 위치: `assets/modules/utils/backup/normalizers.js` (`normalizePreset`)
* 문제: import 시 `request`를 `toObject`만 하고 strategy 스키마로 clamp하지 않음. 실행 경로 `StrategyEngine.normalizeRequest`에서 clamp됨.
* 영향: 저장/표시 단계의 비정상 값 잔존 가능. 실제 연산 DoS 위험은 clamp로 **완화됨**.
* 근거: `normalizePreset` vs `strategy/request.js` clamp 차이; `MAX_STRATEGY_REQUEST_BYTES`는 티켓 스냅샷 clone 경로에서 사용
* 권장 수정 방향: import 시점에 `normalizeRequest`/`normalizeStrategyRequestSnapshot` 적용
* 우선순위: **Low**

---

### L2. 파괴적 백업의 “다운로드 확인”은 사용자 확인에 의존

* 위치: `assets/modules/features/dataio/backupExport/destructive.js`
* 문제: File System Access 실패 시 download + confirm. 사용자가 다운로드 실패를 모르고 확인하면 덮어쓰기 진행 가능.
* 영향: 실수 시 복구 포인트 없는 overwrite
* 근거: `downloaded` 후 confirm 텍스트가 “다운로드 목록 확인” 요청; 실제 파일 존재 검증 없음
* 권장 수정 방향: 가능하면 file picker 강제, 또는 두 단계 confirm
* 우선순위: **Low** (의도된 UX 트레이드오프에 가까움)

---

## 4. Potential Functional Gaps

아래는 **확정 버그가 아닌** 보완 후보입니다. 불확실하면 **추정**으로 표시합니다.

| 항목 | 설명 | 구분 |
|------|------|------|
| 기기 간 동기화 | README도 “미지원, 파일 백업” 명시. 사용자 요청 많으면 cloud export 옵션 | 제품 범위 / 추정 수요 |
| 연금 partial health | 연금은 availability가 사실상 full/none. 목록 일부만 성공한 경우 세분 상태 부재 **추정** | 추정 |
| 생성 결과 워커 vs 메인 폴백 재현성 | 워커 실패 시 메인 스레드 폴백; seed가 있으면 재현 의도. 타임아웃 경계에서 사용자 혼동 가능 | 추정 |
| 백테스트 장시간 실행 UX | span 300·다전략 비교 시 모바일에서 체감 지연. 취소/우선순위 큐 보강 여지 | 추정 |
| Spec Kit 기능 명세 | `.specify/`만 있고 `specs/` 활성 기능 없음. 신규 기능 추적용 명세 부재 | 문서/프로세스 |
| 저장소 폴더명 vs 제품 슬러그 | 워크스페이스 `lotto---webapp` vs package `lotto-pension-pro-webapp` — 문서/스모크 혼선 원인 | 운영 |
| 오프라인 “전체 기능” 기대 | PWA 오프라인은 저장 데이터+정적 스냅샷 중심. 실시간 최신 회차는 불가 | 문서와 대체로 일치 |
| 다국어/접근성 | 한국어 고정. a11y는 일부 aria 사용, 전체 감사 범위 밖 | 추정 |
| 공식 결과 수동 입력 | localUpdates는 sync로 쌓임. 사용자 수동 회차 입력 UI는 제한적일 수 있음 **추정** | 추정 |

---

## 5. Recommended Fix Plan

### 1단계 — 즉시 (게이트·데이터)

1. **Smoke 통과**: `Claude.md` 등 활성 문서에서 `lotto---webapp` / 레거시 브랜드 문자열 제거 또는 정책 조정 후 `node scripts/smoke/smoke.mjs`
2. **데이터 갱신**: `npm run sync:lotto`, `npm run sync:pension720`, `npm run sync:sw-manifest`, `npm run sync:docs-data-baseline`
3. **신선도 재확인**: `npm run check:data-freshness` (+ release 시 strict/official)
4. **프록시 confirm fail-closed**: `UIManager.confirm` 부재 시 쿼리 프록시 거부

### 2단계 — 안정성

1. 브라우저에서 공식 API 직행 스킵 → CORS 중계/커스텀 프록시만
2. Generator: `dataHealth.availability === 'none'` 시 생성 차단
3. 동기화 실패 UX: 서드파티 중계 실패를 사용자 언어로 구분 표시
4. 크로스탭: 원격 rehydrate 시 dirty 충돌 경고
5. 기본 제공 가능한 프록시 배포 문서/원클릭 강화 (`proxy/README.md` 연계)

### 3단계 — 구조

1. 자체 프록시를 기본 경로로 두고 서드파티 CORS를 opt-in 또는 최후 수단으로
2. 회차 데이터 다중 소스 교차 검증(동일 draw 불일치 시 폐기)
3. 티켓/캠페인 필드 단위 merge 또는 버전 벡터
4. Spec Kit으로 동기화/영속화 계약 명세화 (`specs/`)
5. 저장소 디렉터리명과 제품 슬러그 정렬(외부 rename 포함)

---

## 6. Test Recommendations

### 6.1 지금 깨진 게이트 (필수)

| 테스트 | 목적 |
|--------|------|
| `node scripts/smoke/smoke.mjs` | 레거시 브랜드·DOM·정규화 회귀 전체 |
| `npm run check:data-freshness` | 정적 로또 ≤1회차 지연 |
| `npm run check:pension720:freshness` | 연금 정적 vs 공식 |
| `npm run check:docs-data-baseline` | Claude/README baseline 동기화 |

### 6.2 추가·보강 권장 테스트

| 시나리오 | 유형 | 이유 |
|----------|------|------|
| 문서 레거시 슬러그 전용 단위 검사 | smoke | H1 재발 방지 (Spec Kit 블록 포함 여부 정책 명시) |
| 브라우저 환경에서 공식 URL 직행이 후보에서 제외되는지 | unit | H7 |
| `?proxyUrl=` + confirm 취소/승인/confirm 미구현 | unit/integration | H4 |
| 악성 형태 페이로드 vs **유효 형태 위조 회차** | unit | 전자는 이미 있음; 후자는 “수용됨”을 문서화하거나 multi-source 시 폐기 테스트 |
| 탭 2개 동시 `addTicket` 후 최종 개수 | browser | H5 |
| Generator + `winningStats=[]` | unit | H6 |
| 서드파티 CORS 전 실패 시 pension720/lotto가 static 유지 | unit | H3 회귀 |
| 데이터 2회차 지연 상태에서 build 실패 메시지 | script | H2 운영 가시성 |
| import 프리셋에 `simulationCount: 1e9` 후 실행 clamp | unit | L1 |
| overwrite + download confirm 취소 | smoke | 파괴 경로 안전 |

### 6.3 기존 강점 유지 (회귀 삭제 금지)

- Strategy worker: timeout terminate, cache-empty retry, postMessage cleanup
- SW data network-first + error-status fallback
- Pension720 CSV formula escape
- Persistence flush on pagehide/visibility
- Partial winning stats recovery / preserve-existing on static failure
- Query proxy acknowledge (존재 자체는 유지, fail-closed만 강화)

---

## 7. Docs vs Implementation 대조

| 문서 주장 | 구현 상태 | 판정 |
|-----------|-----------|------|
| 엔트리 `index.html` → `index.js` → `LottoApp` | 일치 | OK |
| `CACHE_VERSION` v31, worker asset v23 | `sw.js` / strategyWorker config 일치 | OK |
| 로또 latest 1232 / rows 1231 / missing 146 | 파일 일치, 단 **추정 1234 대비 stale** | 문서 자체 일치, 운영 stale |
| 연금 latest 323 | 파일 일치, 추정 325 대비 stale | 동일 |
| 백업 v5, 32MB import, before_replace 접두 | importFlow / CONFIG 일치 | OK |
| `?proxyUrl=` 세션 1회 확인 | `ensureQueryProxyAcknowledged` 존재 | OK (confirm 미구현 시 예외) |
| 기본 자동 동기화(공개 CORS 중계) | builtinProviders 일치 | OK, 가용성은 외부 의존 |
| 연금도 프록시/중계 경로 | remoteFetch candidates 일치 | OK (과거 “공식만”보다 개선) |
| partial 시 stats/추천/백테스트 게이트, gen/check/data 유지 | dataHealthGate `stats/ai/bt` only | OK |
| Claude.md Spec Kit `lotto---webapp` | smoke 금지 패턴과 **충돌** | **불일치/게이트 실패** |
| README “정기 백업 권장” | localStorage only | OK |

---

## 8. Verification Snapshot (감사 시점)

```text
estimateLatestDrawKST()           = 1234
winning_stats.json max draw       = 1232  (behind 2)  → check:data-freshness FAIL
estimateLatestPension720DrawKST() = 325
pension720_stats.json max draw    = 323  (behind 2)
node scripts/smoke/smoke.mjs      → FAIL (legacy brand in Claude.md Spec Kit block)
CACHE_VERSION                     = v31
STRATEGY_WORKER_ASSET_VERSION     = v23
```

---

## 9. Session Handoff (감사 결과)

- Goal: 기능 구현 관점 프로젝트 감사 리포트 작성
- Changed surfaces: `PROJECT_AUDIT.md` only (코드 변경 없음)
- Data/storage impact: 없음 (관찰만)
- PWA/cache impact: 없음
- Verification completed:
  - README.md / Claude.md 열람
  - CodeGraph MCP 다중 explore (init, persistence, proxy, sync, worker, import, SW, pension720)
  - 정적 데이터·estimate draw 확인
  - smoke / data-freshness 실행 (둘 다 실패 재현)
- Remaining risks: H1–H4 우선 조치 전 `build`/`release` 비권장

---

*End of audit report.*
