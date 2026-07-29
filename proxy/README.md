# 로또 데이터 연결 주소(고급) / 프록시 안내

이 저장소에는 브라우저 요청을 공식 로또 API로 전달하고 CORS 헤더를 보완하는
Cloudflare Worker 예시가 포함되어 있습니다.

웹앱의 `데이터 연결 주소(고급)` 입력은 설정 가능한 `/proxy/latest` 주소를 읽기 때문에,
앱 코드를 바꾸지 않고도 기본 자동 동기화와 고급 연결 주소 모드를 전환할 수 있습니다.

참고:

- 메인 웹앱 런타임 자산(font/icon/QR/캡처 라이브러리)은 현재 `assets/vendor/` same-origin 경로로 로컬화되어 있습니다.
- 따라서 프록시는 최신 회차 동기화 강화를 위한 선택 기능이며, UI 런타임은 프록시/CDN 의존 없이 동작합니다.
- Lotto 6/45 고급 연결 주소(`/proxy/latest`)와 함께 Pension720+ 목록(`/proxy/pension720/list`)도 제공합니다.
- 앱은 `/proxy/latest`만 설정해도 연금복권 갱신용 `/proxy/pension720/list` URL을 같은 Worker에서 자동 유도합니다.
- CI/정적 스냅샷 갱신은 `scripts/fetch_pension720_stats.mjs`가 동행복권 `selectPstPt720WnList.do`를 직접 확인합니다.

## 배포 (Cloudflare Workers)

1. Wrangler를 설치합니다.
2. 특정 공식 주소를 노출하려면 `LOTTO_PROXY_URL` 비밀값을 설정합니다.
3. (권장) `CORS_ALLOWED_ORIGINS` 환경 변수에 앱 오리진을 콤마로 넣어 Origin을 제한합니다.
4. (권장) Cloudflare 대시보드에서 **Rate limiting** / WAF 규칙을 Worker 경로에 추가합니다.
5. `worker.js`를 배포합니다.

```bash
wrangler deploy proxy/worker.js
```

### 보안·남용 방지 (권장)

| 항목 | 권장 |
|------|------|
| CORS | 기본은 `*`(호환). 운영 시 `CORS_ALLOWED_ORIGINS=https://twbeatles.github.io` 처럼 앱 오리진만 허용 |
| Rate limit | Cloudflare Rate limiting으로 `/proxy/*` 분당 요청 상한 설정 |
| `?url=` 패스스루 | `www.dhlottery.co.kr` 호스트만 허용, 경로는 `/lt645/`, `/pt720/` 접두만 허용 |
| 미래 회차 | 예상 최신 `+1` 초과 요청은 upstream 호출 없이 `400` |

`wrangler.toml` 예시:

```toml
name = "lotto-proxy"
main = "proxy/worker.js"
compatibility_date = "2024-01-01"

[vars]
CORS_ALLOWED_ORIGINS = "https://twbeatles.github.io"
```

## 조회 예시

- 최신 회차: `https://<your-worker>.workers.dev/proxy/latest`
- 특정 회차 단건 테스트: `https://<your-worker>.workers.dev/proxy/latest?draw_no=1180`
- 구간 조회: `https://<your-worker>.workers.dev/proxy/range?from=1175&to=1180`
- 연금복권720+ 목록: `https://<your-worker>.workers.dev/proxy/pension720/list`

`/proxy/latest` 응답 형식:

- 기본값: `hybrid` (기존 형식 + 정규화 형식 동시 제공)
- `?format=legacy`: 기존 형식 (`data.list[0]`)
- `?format=normalized`: 정규화 형식 (`data: [{ draw_no, numbers, ... }]`)
- 앱은 `draw_no`/`ltEpsd`를 정수 `>= 1`로만 수락하므로 프록시 응답도 소수/문자열 소수/0/음수 회차를 반환하지 않아야 합니다.
- `draw_no`를 생략하면 Worker가 KST 기준 예상 최신 회차를 조회합니다.
- `draw_no`가 예상 최신 회차 `+1`을 넘으면 upstream 호출 없이 `400`과 `maxDrawNo`를 반환합니다.

`/proxy/range` 응답 형식:

- 기본값: 정규화 배열 (`data: []`)
- `?format=legacy`: 기존 형식 배열 (`data.list`)
- `?format=hybrid`: 정규화 + 기존 형식 동시 제공
- 최대 구간 폭: `40` (예: `from=1200&to=1240` 허용, `to=1241` 거부)
- `to`가 예상 최신 회차 `+1`을 넘으면 upstream 호출 없이 `400`과 `maxDrawNo`를 반환합니다.

앱에서 사용하는 방법:

- 주소 파라미터: `?proxyUrl=...` 또는 `?proxy=...`
- 이전 저장 키: `lotto_webapp_settings_v1.proxyLatestUrl`
- 2버전 설정 키: `lotto_pro_settings_v2.customProxy`
- 해석 우선순위: `query` > `v1` > `v2`
- 고급 데이터 연결 주소가 없으면 앱은 기본 자동 동기화 fallback을 사용합니다.
- 브라우저에서는 동행복권 공식 API를 직접 호출하지 않습니다(CORS). 기본 자동 동기화는 `corsproxy.io`·`CodeTabs` 등 공개 CORS 중계를 경유할 수 있으며, 가용성이 외부 서비스에 좌우됩니다.
- 안정적인 동기화를 위해 자체 Worker 배포 후 `설정 > 데이터 연결 주소(고급)`에 `/proxy/latest` URL을 저장하는 것을 **권장**합니다.
- URL 쿼리 `?proxyUrl=` / `?proxy=` 는 사용자 확인 대화상자 없이는 적용되지 않습니다(확인 UI 불가 시 무시).
- 고급 데이터 연결 주소가 있어도 공식 지원 형식(`/proxy/latest`)일 때만 우선 사용하고, 내장 fallback보다 먼저 시도합니다.
- 비지원 연결 주소 형식은 설정 경고를 표시한 뒤 기본 자동 동기화로 내려갑니다.
- 앱 UI 경로:
    - 사이드바, 모바일 헤더, 또는 모바일 `더보기`의 `설정` 진입
    - 설정 모달의 `데이터 연결 주소(고급)` 입력란

권장 설정 예시:

- 앱 설정 입력란: `https://<your-worker>.workers.dev/proxy/latest`
- 주소창 직접 테스트: `?proxyUrl=https%3A%2F%2F<your-worker>.workers.dev%2Fproxy%2Flatest`

메모:

- `?proxyUrl=` 값은 URL 인코딩한 전체 주소를 넣는 편이 안전합니다.
- 앱의 공식 지원 커스텀 프록시 형식은 절대 URL + `/proxy/latest` 엔드포인트입니다.
- `?url=`, `{url}`, `{draw_no}`, 일반 prefix 형식은 런타임에서 지원하지 않으며 기본 자동 동기화로 내려갑니다.
- `/proxy/latest` 가 JSON은 반환하지만 지원하지 않는 shape를 주면 앱은 `SYNC_FETCH_ONE_INVALID_PAYLOAD` 로그를 남기고 설정 모달에 최근 응답 구조 경고를 표시합니다.
- 공개 fallback 경로는 가용성/요금제/속도에 따라 변동될 수 있으므로, 안정적인 운영에는 고급 데이터 연결 주소 사용을 권장합니다.

## 로컬 점검

프록시 워커 코드는 저장소 루트 ESLint 설정에 포함됩니다.

```bash
npm install
npm run lint
```

## 참고

- 프록시는 선택 기능입니다.
- 프록시가 없어도 앱은 `data/winning_stats.json` + 로컬 업데이트 기반으로 계속 동작하며, 기본 자동 동기화를 시도합니다.
