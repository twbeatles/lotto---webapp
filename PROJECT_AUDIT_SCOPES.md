# Project Audit — Extended Scopes

감사 일자: 2026-07-29  
대상: `lotto-pension-pro-webapp`  
선행 문서: `PROJECT_AUDIT.md` (기능 구현 중심)  
방법: `README.md` / `Claude.md` 기준 → CodeGraph MCP 구조 분석 → 보조 파일·워크플로 확인  
범위: **기능 구현 외** 영역 (성능, 접근성, PWA, 인프라 보안, 아키텍처, CI/운영, 프라이버시, 의존성, UX)

> **후속 반영 (2026-07-29):** 1–2단계 권장 수정이 코드에 반영됨  
> (캐시 헬스 한국어, Worker path allowlist, SW dirty flush, proxy README,  
> 모바일 분석 `fast` 기본, CSP meta, `CORS_ALLOWED_ORIGINS`, a11y 회귀 확장,  
> `check:asset-versions`).  
> 3단계(precache 분리, IndexedDB, Spec Kit, 자체 프록시 기본 배포)는 미착수.  
> 아래 이슈 목록은 **감사 당시 스냅샷**이며, 기능 이슈는 `PROJECT_AUDIT.md`를 참고한다.

---

## 1. Executive Summary

전체 위험도 (본 스코프 합산): **Medium**

| 스코프 | 위험도 | 한줄 요약 |
|--------|--------|-----------|
| 성능 | Medium | 추천/백테스트 CPU 비용 큼. 워커 오프로딩은 양호 |
| 접근성(a11y) | Medium | live region·모달 포커스 트랩은 있으나 전역 키보드/스크린리더 커버리지 불균일 |
| PWA / SW | Medium–Low | network-first·precache health 양호. 모듈 수 많은 shell 캐시 부담 |
| 프록시 인프라 보안 | Medium | 도메인 제한·미래 회차 캡 있음. `CORS *`·rate limit 부재 |
| 아키텍처 유지보수 | Medium | 모듈 분해 잘 됨. 파일 수 많음(≈292), facade 의존 |
| CI / 운영 | Medium–Low | 게이트 탄탄. data-freshness auto-commit 권한 넓음 |
| 프라이버시 | Low–Medium | 로컬 전용. 서드파티 CORS 경유 시 URL 노출 |
| 의존성 | Low | 런타임 벤더 로컬화. devDeps 위주 |
| UX / 카피 | Low–Medium | 제품 카피 회귀 있음. 캐시 헬스 영문 잔존 |

**Critical 확정 이슈는 본 스코프에서 없음.**  
가장 우선할 항목: (1) 모바일에서의 추천/백테스트 비용 가시화, (2) 프록시 rate limit·Origin 정책, (3) a11y 키보드 경로 보강, (4) SW precache 규모 관리.

---

## 2. Scope Understanding

### 2.1 제품 런타임 특성 (문서·CodeGraph)

- no-build 정적 SPA + PWA (`sw.js` `CACHE_VERSION=v31`)
- 무거운 연산: `StrategyWorkerClient` / `backtest.worker.js`
- 상태: localStorage 다키 분할 + sessionStorage 임시 결과
- 선택 인프라: Cloudflare Worker (`proxy/worker.js`)
- 검증: smoke ≈ 130+ 회귀, Playwright 브라우저 스위트, CI `ci:verify`

### 2.2 규모 스냅샷 (감사 시점)

| 지표 | 값 |
|------|-----|
| `assets/modules` JS 파일 | ≈ 292 |
| `scripts` 스크립트 | ≈ 62 |
| smoke 케이스 트리 | ≈ 45 파일 |
| SW appShell precache | 문서/생성기 기준 300+ 항목 수준 (manifest 생성) |

### 2.3 스코프 간 관계

```text
CI freshness ──► 정적 JSON ──► SW data network-first ──► 앱 데이터 건강도
사용자 설정 ──► 커스텀 프록시 ──► Worker(CORS*) ──► 동행복권 upstream
UI 상호작용 ──► Worker 연산 ──► localStorage 저장 ──► 크로스탭 / 쿼터
```

---

## 3. High-Risk Issues (스코프별)

각 항목 형식: 위치 / 문제 / 영향 / 근거 / 권장 / 우선순위

---

### 3.1 성능 (Performance)

#### P1. 추천 몬테카를로·후보 풀 비용이 모바일에서 높을 수 있음

* 위치: `assets/modules/core/strategy/generation/simulation.js` (`simulateWeights`, `recommendFromSimulation`)
* 문제: `simulationCount` 최대 20000(엔진 clamp). 이후 후보 풀 `max(setCount*40, 140)` 및 `maxAttempts = max(500, pool*14)` 루프.
* 영향: 저사양 기기에서 워커 타임아웃 → 메인 스레드 폴백 시 UI 버벅임 가능.
* 근거: CodeGraph 소스; `strategy/request.js` clamp 1000–20000; worker timeout cap 40–60s.
* 권장: 모바일 기본 프리셋을 `fast` 쪽으로 유도; 폴백 시 시뮬레이션 횟수 강제 하향; 진행률 표시 강화.
* 우선순위: **High** (체감 성능)

#### P2. 백테스트 구간·다전략 비교의 연산 폭주

* 위치: `assets/backtest.worker.js` (`runBacktest`)
* 문제: `MAX_BACKTEST_SPAN=300` × 전략 수 × 회차당 티켓 생성. 워커이지만 배터리/발열·장시간 점유.
* 영향: 모바일에서 탭 백그라운드 시 중단/불완전 결과 **추정**.
* 근거: span 가드·progress 메시지는 존재; 기기별 성능 테스트는 smoke 범위 밖.
* 권장: 기본 span 축소, compare 모드 시 경고, `navigator.hardwareConcurrency` 기반 안내.
* 우선순위: **Medium**

#### P3. localStorage 직렬화 빈도·용량

* 위치: `data/persistence/loadSave/save.js`, `STORAGE_WARNING_BYTES=350000` / `DANGER=900000`
* 문제: dirty 키별 JSON.stringify. 티켓·연금 목록 증가 시 메인 스레드 간헐 지연·쿼터 위험.
* 영향: 저장 지연, QuotaExceeded, dirty 잔류(기능 감사 H와 연계).
* 근거: 경고 임계·write failure 추적 존재; IndexedDB 미사용.
* 권장: 대용량 키 압축/청크, 또는 IndexedDB 이전 검토; 저장 전 `requestIdleCallback` 유지.
* 우선순위: **Medium**

#### P4. SW precache 앱셸 규모

* 위치: `sw.js` + `assets/sw-precache-manifest.js` (appShell 다수 모듈)
* 문제: 거의 모든 모듈을 precache하면 설치/업데이트 시간·저장 공간 증가.
* 영향: 저용량 기기 PWA 설치 실패/느림 **추정**.
* 근거: safePrecache는 실패 허용; manifest parity 회귀 존재; appShellCount 300+ 수준.
* 권장: critical shell vs lazy module 분리; 경로별 stale-while-revalidate 확대.
* 우선순위: **Medium**

---

### 3.2 접근성 (Accessibility)

#### A1. 모달 포커스 트랩은 있으나 설정 모달에 Escape 외 진입 경로 불균일

* 위치: `assets/modules/core/ui/modal.js` (Escape/Tab trap, focus restore); `app/settings/modal.js`
* 문제: `openModal`/`_trapFocus` 구현 양호. 설정 모달은 backdrop·닫기 버튼·Escape 지원. 다만 일부 UI(업데이트 토스트 등)는 모달 스택 밖.
* 영향: 스크린 리더/키보드 사용자가 일시 UI에 갇히거나 맥락 상실 가능 **부분**.
* 근거: CodeGraph `ui/modal.js`; PWA update toast는 `document.body`에 동적 삽입 (`bootstrap/pwa.js`).
* 권장: 업데이트 토스트에 포커스 이동·`role="alertdialog"` 검토; 설정 모달 열릴 때 inert background.
* 우선순위: **Medium**

#### A2. live region 커버리지는 핵심 출력에만 적용

* 위치: `index.html` (`genResultList`, `aiOutput`, `checkResultArea`, toast-live-region 등)
* 문제: smoke `runLiveRegionAccessibilityRegression`이 일부 id만 검사. 연금 출력·데이터 목록 페이지네이션 등 추가 영역 일관성 **추정 부족**.
* 영향: 동적 결과 변경이 SR에 안 읽힐 수 있음.
* 근거: index aria-live 다수 존재; 회귀 allowlist 형태.
* 권장: live region 체크리스트를 페이지 단위로 확장; busy 토글 패턴 통일.
* 우선순위: **Medium**

#### A3. 당첨 확인 리스트는 키보드 이동이 있으나 전역 네비 패턴 부재

* 위치: `features/check/list/selection.js` (`moveSelection`, `focusSelectedCard`)
* 문제: check 탭은 방향키 이동 가능. 메인 탭 바·모바일 more sheet의 완전한 roving tabindex 패턴은 제한적 **추정**.
* 영향: 키보드만으로 전 기능 순회 난이도.
* 권장: nav에 `aria-current`, 화살표 순환 문서화/테스트.
* 우선순위: **Low–Medium**

#### A4. 캐시 헬스 UI 카피 영문 혼재

* 위치: `assets/modules/core/app/pwaInstall/cacheHealth.js` (`renderPwaCacheHealth`)
* 문제: 사용자 대면 문구가 영어 (`precache failed...`). 앱 전역은 한국어.
* 영향: 비영어 사용자 이해도 저하; 제품 카피 계약과 어긋남.
* 근거: CodeGraph 소스 라인 36–45 영문 문자열.
* 권장: 한국어 UI_STRINGS로 이전.
* 우선순위: **Low** (UX/a11y 겸)

---

### 3.3 PWA / Service Worker

#### W1. JS/CSS network-first는 올바르나 오프라인 첫 진입 품질은 precache 성공에 좌우

* 위치: `sw.js` fetch 분기 (data network-first, navigate network-first, code network-first, 기타 SWR)
* 문제: precache 일부 실패 시 install은 성공·경고만. 오프라인에서 실패 자산 404 가능.
* 영향: “오프라인 사용 가능” FAQ와 체감 불일치 가능.
* 근거: `safePrecache` failures 기록; `__cache-health.json`; README 오프라인 문구.
* 권장: 필수 shell 실패 시 사용자 배너 강화(이미 일부 존재); 실패 URL 한국어 노출.
* 우선순위: **Medium**

#### W2. 멀티탭 SW 업데이트 시 강제 reload

* 위치: `assets/modules/bootstrap/pwa.js` (`SW_ACTIVATED` BroadcastChannel → `location.reload`)
* 문제: 다른 탭 활성화 시 즉시 reload. 작성 중 폼 손실 가능.
* 영향: 생성/추천 중 업데이트 적용 시 작업 유실 **추정**.
* 근거: channel message handler reload.
* 권장: dirty 상태면 reload 지연·확인; `save(true)` 후 reload.
* 우선순위: **Medium**

#### W3. `clients.claim()` 즉시 제어권 이양

* 위치: `sw.js` activate
* 문제: claim 후 진행 중 fetch가 새 SW로 전환. 보통 의도적이나 레이스 가능.
* 영향: 드물게 혼합 버전 자산 **추정**.
* 권장: 현재 skipWaiting 사용자 승인 모델 유지; claim 전후 버전 로그.
* 우선순위: **Low**

---

### 3.4 프록시·인프라 보안

#### S1. Worker CORS `Access-Control-Allow-Origin: *`

* 위치: `proxy/worker.js` `CORS` 상수
* 문제: 모든 오리진에서 Worker 호출 가능. 공개 로또 데이터라 민감도는 낮지만, 배포 Worker가 오남용(스크래핑 중계·쿼터 소진)될 수 있음.
* 영향: 비용·upstream 부담; 악성 사이트에서 사용자 브라우저를 경유하지 않고도 Worker 남용.
* 근거: CORS 헤더 `*`; rate limit 코드 없음.
* 권장: 허용 Origin allowlist(Pages 도메인), Cloudflare rate limiting, 선택적 API 키.
* 우선순위: **High** (인프라 남용)

#### S2. `?url=` 패스스루는 호스트 제한 있으나 경로 제한은 약함

* 위치: `proxy/worker.js` fetch 핸들러 `url` 쿼리
* 문제: `hostname === 'www.dhlottery.co.kr'`만 검사. 같은 호스트의 임의 경로 프록시 가능.
* 영향: 의도된 로또 API 외 페이지 스크래핑 중계 **가능**. SSRF는 외부망 제한으로 완화.
* 근거: 호스트 체크 후 `fetchWithRetry(targetUrl)`.
* 권장: path allowlist (`/lt645/`, `/pt720/` 등); 메서드 GET only 명시.
* 우선순위: **Medium**

#### S3. 앱에 Content-Security-Policy 부재

* 위치: `index.html` (CSP 메타/헤더 없음; font `crossorigin`만)
* 문제: XSS 방어는 escape/allowlist에 의존. CSP 없으면 인라인/실수 도입 시 완화층 부족.
* 영향: 향후 XSS 시 피해 확대.
* 근거: grep CSP 결과 거의 없음.
* 권장: GitHub Pages 가능한 범위에서 CSP(또는 meta) 단계적 도입; `script-src 'self'`.
* 우선순위: **Medium**

#### S4. 시스템 알림 권한 UX

* 위치: `data/analytics/notifications.js`
* 문제: 권한 요청 타이밍·거부 후 재유도 정책은 기능상 존재하나 OS/브라우저별 차이는 테스트 범위 밖.
* 영향: 알림 미동작 시 사용자 혼란 **추정**.
* 권장: 권한 denied 상태 설정 UI 명시.
* 우선순위: **Low**

---

### 3.5 아키텍처·유지보수성

#### M1. 모듈 파일 수 대비 진입 facade 의존

* 위치: `DataManager.js`, `LottoApp` 조합, feature facade (`Pension720.js`, `DataIO.js` 등)
* 문제: Object.assign 믹스인 패턴이 많아 “한 클래스에 메서드 수백” 형태. IDE/리뷰 부담, 순환 의존 위험.
* 영향: 변경 시 영향 범위 파악 비용↑. CodeGraph 없으면 어려움.
* 근거: ≈292 모듈 파일; mixin assign 패턴 반복.
* 권장: 경계별 명시적 서비스 객체; public API 문서화; barrel 과다 사용 자제.
* 우선순위: **Medium** (생산성)

#### M2. 전략/워커 버전 수동 범프 규약

* 위치: `STRATEGY_WORKER_ASSET_VERSION = 'v23'`, `CACHE_VERSION = 'v31'`
* 문제: 행동 변경 시 수동 bump. 누락 시 구 워커/캐시 잔존.
* 영향: “고쳤는데 안 바뀜” 배포 이슈.
* 근거: Claude.md 규약; smoke manifest parity는 SW 쪽.
* 권장: CI에서 worker 파일 해시 변경 시 버전 상수 변경 강제 체크.
* 우선순위: **Medium**

#### M3. Spec Kit 미활성

* 위치: `.specify/` 존재, `specs/` 기능 명세 없음 (Claude.md)
* 문제: 대형 변경의 계약 문서 부재.
* 영향: 에이전트/기여자 간 범위 불일치.
* 권장: 동기화·영속화·PWA 등 핵심 도메인 spec 1–2개부터.
* 우선순위: **Low–Medium**

---

### 3.6 CI / 운영

#### C1. data-freshness 워크플로가 `contents: write` + main push

* 위치: `.github/workflows/data-freshness.yml`
* 문제: 스케줄/수동으로 main에 데이터 커밋. 정상 의도이나 토큰 유출·워크플로 변조 시 영향 큼.
* 영향: 공급망/브랜치 보호 정책에 민감.
* 근거: `permissions: contents: write`, `git push` to main.
* 권장: branch protection과 봇 계정 제한 확인; 커밋 범위 path 최소화(이미 제한적).
* 우선순위: **Medium**

#### C2. PR CI는 `ci:verify` — official freshness/strict는 release 쪽

* 위치: `.github/workflows/ci.yml` → `npm run ci:verify`
* 문제: PR만으로는 strict official 비교가 약할 수 있음(설계 의도일 수 있음).
* 영향: stale 데이터가 PR 머지 후 scheduled job에 의존.
* 근거: package.json scripts 분리; data-freshness 별도 workflow.
* 권장: 문서화 유지; PR에 non-blocking freshness 리포트 옵션.
* 우선순위: **Low**

#### C3. Playwright 브라우저 테스트는 로컬/별도 워크플로 의존

* 위치: `test:happy`, `browser-official.yml`
* 문제: 기본 CI verify에 전체 브라우저 스위트가 없을 수 있음.
* 영향: UI 회귀가 smoke 소스 검사에 치우침.
* 권장: 주 1회 browser 스위트 필수화(이미 official canary 존재 시 유지).
* 우선순위: **Low–Medium**

---

### 3.7 프라이버시

#### V1. 서드파티 CORS 중계에 요청 URL 노출

* 위치: `builtinProviders.js` (corsproxy.io, CodeTabs)
* 문제: 공식 API URL이 중계 서버 로그에 남을 수 있음. 개인 식별 데이터는 없으나 사용 패턴 노출.
* 영향: 프라이버시·신뢰 이슈. README도 자체 Worker 권장.
* 권장: 기본 경로를 자체 Worker로; 중계는 명시적 opt-in.
* 우선순위: **Medium** (정책)

#### V2. 로컬 전용 — 계정/서버 동기화 없음

* 위치: README FAQ, localStorage 키
* 문제 아님: 설계상 장점. 기기 분실·브라우저 삭제 시 복구는 백업 파일에 의존.
* 권장: 백업 리마인더(주기 toast) **제품 개선 추정**.
* 우선순위: **Low**

---

### 3.8 의존성·공급망

#### D1. 런타임 벤더 로컬화는 양호

* 위치: `assets/vendor/` (qrcode, html2canvas, html5-qrcode, fonts)
* 강점: CDN 런타임 의존 최소화, offline 회귀 존재.
* 잔여 리스크: 벤더 업데이트/CVE 추적 프로세스 비문서화 **추정**.
* 권장: THIRD_PARTY_NOTICES + 주기 업데이트 체크리스트.
* 우선순위: **Low**

#### D2. npm devDependencies (eslint, playwright 등)

* 위치: `package.json`
* 문제: 빌드/테스트 전용. 프로덕션 번들 없음(no-build).
* 권장: `npm audit` 주기 실행.
* 우선순위: **Low**

---

## 4. Potential Gaps (추정 포함)

| 스코프 | 갭 | 구분 |
|--------|-----|------|
| 성능 | Lighthouse/CI 예산 없음 | 추정 부재 |
| a11y | axe/pa11y 자동화 없음 | 추정 |
| i18n | 한국어 고정, 다국어 계획 없음 | 제품 범위 |
| 모니터링 | 클라이언트 오류 수집(Sentry 등) 없음 | 추정 부재 |
| 다크/라이트 | 테마 존재, 대비 수치 검증 미확인 | 추정 |
| 프린트/공유 | QR·이미지 저장 외 공유 시트 제한 | 추정 |
| E2E flaky | Playwright 타임존(KST) 의존 테스트 | 운영 주의 |
| 문서 | `PROJECT_AUDIT.md` 기능 이슈 vs 본 문서 스코프 분리 필요 | 프로세스 |

---

## 5. Recommended Fix Plan (스코프)

### 1단계 — 빠른 개선
1. 캐시 헬스·PWA 관련 사용자 문구 한국어화 (A4)
2. Worker path allowlist 강화 (S2)
3. SW 업데이트 전 dirty flush / 확인 (W2)
4. 프록시 Cloudflare rate limit 가이드를 `proxy/README.md`에 추가 (S1)

### 2단계 — 안정성·품질
1. 모바일 기본 분석 강도 하향 + 타임아웃 시 자동 완화 (P1)
2. CSP 단계 도입 (S3)
3. Worker CORS Origin allowlist 옵션 (S1)
4. a11y live region·키보드 회귀 확장 (A2, A3)
5. worker/CACHE 버전 변경 CI 강제 (M2)

### 3단계 — 구조
1. precache critical-only 전략 (P4)
2. 대용량 상태 IndexedDB 검토 (P3)
3. 핵심 도메인 Spec Kit 명세 (M3)
4. 자체 프록시 기본 배포 경로 (V1 + 기능 감사 H3 연계)

---

## 6. Test Recommendations

| 스코프 | 추가 테스트 |
|--------|-------------|
| 성능 | `bench:ai` 결과를 CI artifact로 보존; 모바일 뷰포트 타임아웃 회귀 |
| a11y | Playwright + axe-core 스모크 1회; Escape/Tab 모달 회귀 |
| PWA | 오프라인 navigate + 일부 precache 실패 시 배너; 멀티탭 SW_ACTIVATED dirty 보호 |
| 프록시 | `?url=` 비허용 path 403; Origin 제한(도입 시); 미래 회차 400(기존 유지) |
| CI | workflow path filter; data-freshness dry-run |
| 프라이버시 | 기본 동기화 경로가 중계 URL을 쓰는지 설정 패널 문구 스냅샷 |
| 카피 | cache health 한국어 회귀 |

기존 유지: SW network-first, live-region 일부, manifest parity, proxy future-cap.

---

## 7. Strengths (본 스코프에서 잘 된 점)

- 모달 **포커스 트랩·Escape·이전 포커스 복원** 구현 (`ui/modal.js`)
- SW **data network-first + error-status fallback**, precache 실패 관용 + health JSON
- 업데이트 **사용자 승인 후 skipWaiting** (강제 자동 갱신 아님)
- 프록시 **미래 회차 상한·range 폭 제한·dhlottery 호스트 제한**
- 런타임 자산 **same-origin 벤더 로컬화**
- CI 분리: PR verify / 데이터 freshness / official canary
- smoke에 a11y·PWA·SW 회귀가 **일부라도** 존재

---

## 8. Docs vs Implementation (본 스코프)

| 문서 | 구현 | 판정 |
|------|------|------|
| 오프라인 기본 기능 사용 가능 | precache 성공 전제, 일부 실패 허용 | 대체로 OK, 조건 명시 권장 |
| 자체 Worker 권장 | 코드·README 일치 | OK |
| PWA 설치 가능 | manifest + SW | OK (smoke) |
| 캐시 헬스 사용자 안내 | UI 영문 잔존 | **부분 불일치** |
| 데이터 CI auto-commit | workflow 존재 | OK |

---

## 9. Relation to PROJECT_AUDIT.md

| 문서 | 초점 |
|------|------|
| `PROJECT_AUDIT.md` | 기능 버그, 동기화, import, race, 입력 검증, 데이터 freshness 게이트 |
| `PROJECT_AUDIT_SCOPES.md` (본 문서) | 성능, a11y, PWA, 인프라 보안, 아키텍처, CI, 프라이버시, 의존성, UX |

기능 감사 1–2단계 수정(데이터 동기화, fail-closed 프록시, browser CORS 스킵 등)은 **본 스코프의 V1/S 계열 리스크를 일부 완화**하지만, Worker CORS *·precache 규모·a11y 자동화는 별도 작업이다.

---

## 10. Session Handoff

- Goal: 기능 외 다스코프 감사 리포트
- Changed surfaces: `PROJECT_AUDIT_SCOPES.md` only
- Verification: CodeGraph 탐색, workflow/SW/proxy/modal 소스 확인, 모듈 수 카운트
- Not done: 코드 수정, Lighthouse/axe 실측, 프로덕션 Worker 설정 확인(배포 환경 비접근)

---

*End of extended-scope audit.*
