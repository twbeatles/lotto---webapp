export const qrScannerParserMethods = {
    parseLottoQr(url) {
        // Official paper tickets encode:
        //   https://m.dhlottery.co.kr/?v={draw}q{game}q...
        //   https://dhlottery.co.kr/qr.do?method=winQr&v={draw}{type}{game}...
        // Type letters: q=수동, m=자동, n=반자동, s=마지막 게임(+일련번호).

        if (!url || typeof url !== 'string') throw new Error('잘못된 주소입니다.');
        const allowedHosts = new Set(['m.dhlottery.co.kr', 'www.dhlottery.co.kr', 'dhlottery.co.kr']);
        let host;
        try {
            host = new URL(url).hostname.toLowerCase();
        } catch (e) {
            const hostMatch = String(url).match(/^(?:https?:\/\/)?([^/?#]+)/i);
            host = hostMatch?.[1]?.toLowerCase() || '';
        }

        if (!host || !allowedHosts.has(host)) {
            throw new Error('로또 6/45 공식 큐알 코드가 아닙니다.');
        }

        let vParam = '';
        try {
            const urlObj = new URL(url);
            vParam = urlObj.searchParams.get('v');
        } catch (e) {
            const match = url.match(/[?&]v=([^&]+)/);
            if (match) vParam = match[1];
        }

        if (!vParam) throw new Error('큐알 코드에 로또 데이터(v 파라미터)가 없습니다.');

        const payload = String(vParam).trim();
        const drawMatch = payload.match(/^(\d+)(?=[a-z])/i);
        if (!drawMatch) throw new Error('데이터 형식이 올바르지 않습니다.');
        const drawNo = Number.parseInt(drawMatch[1], 10);
        if (!Number.isInteger(drawNo) || drawNo < 1) {
            throw new Error('큐알 코드에 유효한 회차 정보가 없습니다.');
        }

        const gameChunks = payload.slice(drawMatch[1].length).split(/[a-z]+/i);
        const games = [];
        for (const gameStr of gameChunks) {
            const numsStr = String(gameStr || '').trim().slice(0, 12);
            if (!/^\d{12}$/.test(numsStr)) continue;

            const nums = [];
            for (let j = 0; j < 12; j += 2) {
                const n = Number.parseInt(numsStr.slice(j, j + 2), 10);
                if (Number.isInteger(n) && n >= 1 && n <= 45) nums.push(n);
            }

            if (nums.length === 6 && new Set(nums).size === 6) {
                nums.sort((a, b) => a - b);
                games.push({
                    targetDrawNo: drawNo,
                    numbers: nums
                });
            }
        }

        if (games.length === 0) throw new Error('큐알 코드에서 유효한 게임을 찾을 수 없습니다.');
        return games;
    }
};