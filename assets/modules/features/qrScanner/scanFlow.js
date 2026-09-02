import { UIManager } from '../../core/UIManager.js';

export const qrScannerScanFlowMethods = {
    async onScanSuccess(decodedText) {
        if (this.isHandlingSuccess) return;
        this.isHandlingSuccess = true;

        // Official paper QR: http(s)://m.dhlottery.co.kr/?v=... or /qr.do?method=winQr&v=...
        // Parse logic here
        // Parse logic here
        // console.log(`Scan result: ${decodedText}`);

        try {
            const scannedGames = this.parseLottoQr(decodedText);
            if (scannedGames && scannedGames.length > 0) {
                await this.stop();
                UIManager.toast('큐알 스캔 성공!', 'success');

                // Pass to CheckModule
                // Switch to check tab
                await this.app.route('check');

                // We need a way to pass these numbers to CheckModule.
                // Option 1: Call a method on CheckModule
                if (this.app.check) {
                    this.app.check.setScannedNumbers(scannedGames);
                }
            } else {
                // Valid QR but not Lotto? or parse failed
                UIManager.toast('유효한 로또 큐알 코드가 아닙니다.', 'warning');
            }
        } catch (e) {
            console.error(e);
            UIManager.toast('큐알 코드 해석 실패', 'error');
        } finally {
            this.isHandlingSuccess = false;
        }
    }
};