import { CandlestickData, LineData } from 'lightweight-charts';

export function calculateSMA(data: CandlestickData[], period: number): LineData[] {
    const sma: LineData[] = [];
    for (let i = period - 1; i < data.length; i++) {
        let sum = 0;
        for (let j = 0; j < period; j++) {
            sum += data[i - j].close;
        }
        sma.push({
            time: data[i].time,
            value: sum / period,
        });
    }
    return sma;
}

export function calculateRSI(data: CandlestickData[], period: number = 14): LineData[] {
    const rsi: LineData[] = [];
    if (data.length <= period) return rsi;

    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
        const diff = data[i].close - data[i - 1].close;
        if (diff >= 0) gains += diff;
        else losses -= diff;
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    const firstRSI = 100 - 100 / (1 + avgGain / (avgLoss || 1));
    rsi.push({ time: data[period].time, value: firstRSI });

    for (let i = period + 1; i < data.length; i++) {
        const diff = data[i].close - data[i - 1].close;
        let gain = diff >= 0 ? diff : 0;
        let loss = diff < 0 ? -diff : 0;

        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;

        const rs = avgGain / (avgLoss || 1);
        rsi.push({ time: data[i].time, value: 100 - 100 / (1 + rs) });
    }

    return rsi;
}
export function calculateEMA(data: (CandlestickData | LineData)[], period: number): LineData[] {
    const ema: LineData[] = [];
    if (data.length < period) return ema;

    // First EMA value is SMA
    let sum = 0;
    for (let i = 0; i < period; i++) {
        const val = (data[i] as CandlestickData).close !== undefined
            ? (data[i] as CandlestickData).close
            : (data[i] as LineData).value;
        sum += val;
    }
    let prevEMA = sum / period;
    ema.push({ time: data[period - 1].time, value: prevEMA });

    const k = 2 / (period + 1);

    for (let i = period; i < data.length; i++) {
        const currentPrice = (data[i] as CandlestickData).close !== undefined
            ? (data[i] as CandlestickData).close
            : (data[i] as LineData).value;
        const currentEMA = (currentPrice - prevEMA) * k + prevEMA;
        ema.push({ time: data[i].time, value: currentEMA });
        prevEMA = currentEMA;
    }

    return ema;
}

export function calculateWMA(data: (CandlestickData | LineData)[], period: number): LineData[] {
    const wma: LineData[] = [];
    if (data.length < period) return wma;

    const weightSum = (period * (period + 1)) / 2;

    for (let i = period - 1; i < data.length; i++) {
        let sum = 0;
        for (let j = 0; j < period; j++) {
            const val = (data[i - j] as CandlestickData).close !== undefined
                ? (data[i - j] as CandlestickData).close
                : (data[i - j] as LineData).value;
            sum += val * (period - j);
        }
        wma.push({
            time: data[i].time,
            value: sum / weightSum,
        });
    }
    return wma;
}
