export const UI_STRINGS = {
    common: {
        close: '닫기',
        cancel: '취소',
        confirm: '확인',
        delete: '삭제',
        save: '저장',
        install: '설치',
        openSettings: '설정 열기',
        noData: '표시할 데이터가 없습니다.'
    },
    dialog: {
        confirmTitle: '작업을 확인해주세요.',
        promptTitle: '입력이 필요합니다.',
        defaultConfirmMessage: '이 작업을 진행할까요?',
        defaultPromptMessage: '계속하려면 값을 입력해주세요.'
    },
    generator: {
        generating: '번호 생성 중...',
        generatingCampaign: '캠페인 생성 중...',
        workerFallback: '워커 응답이 지연되어 메인 스레드로 전환합니다.',
        workerFallbackCampaign: '캠페인 생성 워커가 지연되어 메인 스레드로 전환합니다.',
        dataUnavailable: '당첨 데이터가 없습니다. 데이터 관리에서 동기화하거나 데이터 파일을 확인해주세요.'
    },
    ai: {
        workerFallback: '워커 응답이 지연되어 메인 스레드 번호 추천으로 전환합니다.',
        workerTimeoutAuto: '자동 비교 전략 계산이 지연되었습니다. 분석 강도를 낮춰 다시 시도하세요.',
        uniformFallback: '채택 샘플이 부족해 균등 가중치로 추천했습니다.'
    },
    backtest: {
        stopped: '시뮬레이션을 중지했습니다.',
        payoutFast: '고정 상금 모드로 1~5등 상금을 계산합니다.',
        payoutHybrid: '하이브리드 모드로 1등은 실제 당첨금, 2~5등은 고정값으로 계산합니다.',
        started: '백그라운드에서 시뮬레이션을 시작했습니다.',
        emptyExport: '내보낼 비교 결과가 없습니다.',
        exported: '비교 CSV 파일을 내보냈습니다.'
    },
    dataio: {
        backupExported: '백업 파일(v5)을 내보냈습니다.',
        importUnsupported: '지원되지 않는 백업 형식입니다.',
        importInvalid: '백업 파일을 읽지 못했습니다.',
        mergeComplete({ added = 0, duplicate = 0, skipped = 0, applied = [], cleaned = 0, futureDropped = 0 } = {}) {
            const cleanupSuffix = cleaned > 0 ? `, 정리 ${cleaned}개 캠페인` : '';
            const futureSuffix = futureDropped > 0 ? `, 미래 회차 제외 ${futureDropped}건` : '';
            const suffix = applied.length ? `, 적용: ${applied.join('/')}` : '';
            return `합치기 가져오기를 완료했습니다. 추가 ${added}건, 중복 ${duplicate}건, 건너뜀 ${skipped}건${cleanupSuffix}${futureSuffix}${suffix}`;
        },
        overwriteComplete({ added = 0, skipped = 0, applied = [], cleaned = 0, futureDropped = 0 } = {}) {
            const skippedSuffix = skipped > 0 ? `, 건너뜀 ${skipped}건` : '';
            const cleanupSuffix = cleaned > 0 ? `, 정리 ${cleaned}개 캠페인` : '';
            const futureSuffix = futureDropped > 0 ? `, 미래 회차 제외 ${futureDropped}건` : '';
            const suffix = applied.length ? `, 적용: ${applied.join('/')}` : '';
            return `바꾸기 가져오기를 완료했습니다. 반영 ${added}건${skippedSuffix}${cleanupSuffix}${futureSuffix}${suffix}`;
        }
    },
    sync: {
        alreadyRunning: '이미 동기화가 진행 중입니다.',
        cancelled: '동기화를 취소했습니다.',
        upToDate: '이미 최신 상태입니다.',
        updatedCount(count = 0, futureDropped = 0) {
            const futureSuffix = futureDropped > 0 ? ` 미래 회차 로컬 업데이트 ${futureDropped}개 제외.` : '';
            return `${count}개 회차 업데이트를 반영했습니다.${futureSuffix}`;
        },
        latestUnavailable: '최신 회차를 확인하지 못했습니다.',
        latestUnavailableThirdParty:
            '최신 회차를 확인하지 못했습니다. 공개 CORS 중계(corsproxy.io 등)가 불안정할 수 있습니다. 설정에서 자체 데이터 연결 주소(Worker)를 권장합니다.',
        genericError: '동기화 중 오류가 발생했습니다.',
        genericErrorThirdParty:
            '동기화 중 오류가 발생했습니다. 기본 자동 동기화는 공개 CORS 중계에 의존합니다. 자체 Worker 연결 또는 잠시 후 재시도를 권장합니다.',
        logUpToDate: '이미 최신 상태입니다.',
        logRange(fromNo, toNo) {
            return `동기화 대상 범위: ${fromNo}~${toNo}회`;
        },
        logSource(source = '') {
            return `동기화 소스: ${source || '기본 자동 동기화'}`;
        },
        logFallbackLimit(count = 0, limit = 0) {
            return `fallback 대상이 ${count}개라 최근 ${limit}개만 다시 요청합니다.`;
        },
        logApplied(count = 0) {
            return `${count}개 회차 업데이트를 반영했습니다.`;
        },
        logNoNew: '새 회차 데이터가 없습니다.',
        logCancelled: '사용자 요청으로 동기화를 취소했습니다.',
        logError(message = '') {
            return `동기화 오류: ${message}`;
        },
        logThirdPartyHint:
            '참고: 기본 자동 동기화는 공개 CORS 중계를 경유할 수 있습니다. 안정적으로 쓰려면 자체 Worker를 설정하세요.'
    },
    moreMenu: {
        title: '더보기',
        subtitle: '추가 기능과 설정을 여기서 빠르게 엽니다.',
        simulation: '시뮬레이션',
        settings: '설정',
        install: '앱 설치',
        unavailableInstall: '이 환경에서는 설치 프롬프트를 바로 표시할 수 없습니다.'
    },
    pwa: {
        cachePending: '서비스 워커 활성화 후 캐시 상태를 확인합니다.',
        cacheOk(version = '') {
            return version ? `기본 캐시 준비 완료 (${version})` : '기본 캐시 준비 완료';
        },
        cacheWarning(count = 0) {
            return `캐시 실패 ${count}건. 앱 업데이트를 확인한 뒤 다시 살펴보세요.`;
        },
        cacheNotReady: '아직 캐시 상태를 읽을 수 없습니다. 설치 직후에는 정상일 수 있습니다.',
        badgePending: '확인 전',
        badgeOk: '정상',
        badgeWarning(count = 0) {
            return `주의 ${count}`;
        },
        badgeNotReady: '준비 중',
        updateFlushHint: '저장 중인 데이터를 반영한 뒤 업데이트를 적용합니다.',
        updateReloadOtherTab: '다른 탭에서 앱이 갱신되어 화면을 새로고침합니다.'
    },
    check: {
        emptySelection: '비교할 항목을 선택하세요.',
        selectionHint: '목록에서 항목을 선택하고 확인 버튼을 누르세요.',
        scannedEmpty: '스캔에서 유효한 번호를 찾지 못했습니다.',
        scannedAdded(count = 0) {
            return `${count}개 게임을 스캔했습니다.`;
        },
        sourceLabels: {
            favorites: '즐겨찾기',
            history: '히스토리',
            tickets: '내 번호',
            scanned: '스캔 결과'
        },
        ticketStatus: {
            all: '전체',
            pending: '예정',
            win: '당첨',
            lose: '미당첨'
        }
    },
    presets: {
        promptTitle: '프리셋 이름을 입력하세요.',
        promptMessage: '현재 전략 설정을 저장할 이름을 입력해주세요.',
        overwriteTitle(name = '') {
            return `'${name}' 프리셋을 덮어쓸까요?`;
        },
        deleteTitle(name = '') {
            return `'${name}' 프리셋을 삭제할까요?`;
        }
    }
};
