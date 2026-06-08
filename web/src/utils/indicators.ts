import { CandlestickData } from 'lightweight-charts';

export function calculateSMA(data: CandlestickData[], period: number) {
    const sma = [];
    for (let i = 0; i < data.length; i++) {
        if (i < period - 1) {
            sma.push({ time: data[i].time, value: undefined });
            continue;
        }
        let sum = 0;
        for (let j = 0; j < period; j++) {
            sum += data[i - j].close;
        }
        sma.push({ time: data[i].time, value: sum / period });
    }
    return sma.filter(d => d.value !== undefined) as { time: any, value: number }[];
}

export function calculateEMA(data: CandlestickData[], period: number) {
    const ema = [];
    const k = 2 / (period + 1);
    let prevEma: number | null = null;

    for (let i = 0; i < data.length; i++) {
        if (i < period - 1) {
            ema.push({ time: data[i].time, value: undefined });
            continue;
        }

        if (prevEma === null) {
            let sum = 0;
            for (let j = 0; j < period; j++) {
                sum += data[i - j].close;
            }
            prevEma = sum / period;
        } else {
            prevEma = (data[i].close - prevEma) * k + prevEma;
        }

        ema.push({ time: data[i].time, value: prevEma });
    }
    return ema.filter(d => d.value !== undefined) as { time: any, value: number }[];
}

export function calculateRSI(data: any[], period: number = 14) {
    if (data.length <= period) return [];

    const results = [];
    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
        const change = data[i].close - data[i - 1].close;
        if (change > 0) gains += change;
        else losses -= change;
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = period + 1; i < data.length; i++) {
        const change = data[i].close - data[i - 1].close;
        let currentGain = change > 0 ? change : 0;
        let currentLoss = change < 0 ? -change : 0;

        avgGain = (avgGain * (period - 1) + currentGain) / period;
        avgLoss = (avgLoss * (period - 1) + currentLoss) / period;

        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        const rsi = 100 - 100 / (1 + rs);

        results.push({ time: data[i].time, value: rsi });
    }

    return results;
}
