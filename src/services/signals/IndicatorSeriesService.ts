import { AlignedPoint, CandleBar, NumericPoint } from './types';

const round = (value: number, digits = 8) => Number(value.toFixed(digits));

const computeRsiValue = (avgGain: number, avgLoss: number) => {
    if (avgLoss === 0) {
        if (avgGain === 0) {
            return 50;
        }
        return 100;
    }

    if (avgGain === 0) {
        return 0;
    }

    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
};

export class IndicatorSeriesService {
    public calculateSMAFromCandles(bars: CandleBar[], period: number): NumericPoint[] {
        return this.calculateSMA(this.toCloseSeries(bars), period);
    }

    public calculateSMA(points: NumericPoint[], period: number): NumericPoint[] {
        const sma: NumericPoint[] = [];
        if (points.length < period) return sma;

        for (let i = period - 1; i < points.length; i += 1) {
            let sum = 0;
            for (let j = 0; j < period; j += 1) {
                sum += points[i - j].value;
            }
            sma.push({
                time: points[i].time,
                value: round(sum / period),
            });
        }

        return sma;
    }

    public calculateRSIFromCandles(bars: CandleBar[], period = 14): NumericPoint[] {
        return this.calculateRSI(this.toCloseSeries(bars), period);
    }

    public calculateRSI(points: NumericPoint[], period = 14): NumericPoint[] {
        const rsi: NumericPoint[] = [];
        if (points.length <= period) return rsi;

        let gains = 0;
        let losses = 0;

        for (let i = 1; i <= period; i += 1) {
            const diff = points[i].value - points[i - 1].value;
            if (diff >= 0) gains += diff;
            else losses -= diff;
        }

        let avgGain = gains / period;
        let avgLoss = losses / period;

        rsi.push({
            time: points[period].time,
            value: round(computeRsiValue(avgGain, avgLoss)),
        });

        for (let i = period + 1; i < points.length; i += 1) {
            const diff = points[i].value - points[i - 1].value;
            const gain = diff >= 0 ? diff : 0;
            const loss = diff < 0 ? -diff : 0;

            avgGain = (avgGain * (period - 1) + gain) / period;
            avgLoss = (avgLoss * (period - 1) + loss) / period;

            rsi.push({
                time: points[i].time,
                value: round(computeRsiValue(avgGain, avgLoss)),
            });
        }

        return rsi;
    }

    public calculateEMAFromCandles(bars: CandleBar[], period: number): NumericPoint[] {
        return this.calculateEMA(this.toCloseSeries(bars), period);
    }

    public calculateEMA(points: NumericPoint[], period: number): NumericPoint[] {
        const ema: NumericPoint[] = [];
        if (points.length < period) return ema;

        let sum = 0;
        for (let i = 0; i < period; i += 1) {
            sum += points[i].value;
        }

        let previous = sum / period;
        ema.push({ time: points[period - 1].time, value: round(previous) });
        const k = 2 / (period + 1);

        for (let i = period; i < points.length; i += 1) {
            previous = (points[i].value - previous) * k + previous;
            ema.push({
                time: points[i].time,
                value: round(previous),
            });
        }

        return ema;
    }

    public calculateWMAFromCandles(bars: CandleBar[], period: number): NumericPoint[] {
        return this.calculateWMA(this.toCloseSeries(bars), period);
    }

    public calculateWMA(points: NumericPoint[], period: number): NumericPoint[] {
        const wma: NumericPoint[] = [];
        if (points.length < period) return wma;

        const weightSum = (period * (period + 1)) / 2;

        for (let i = period - 1; i < points.length; i += 1) {
            let sum = 0;
            for (let j = 0; j < period; j += 1) {
                sum += points[i - j].value * (period - j);
            }

            wma.push({
                time: points[i].time,
                value: round(sum / weightSum),
            });
        }

        return wma;
    }

    public alignPointsToBars(bars: CandleBar[], points: NumericPoint[]): AlignedPoint[] {
        return bars.map((bar) => ({
            time: bar.time,
            value: this.getPointAtOrBefore(points, bar.time)?.value ?? null,
        }));
    }

    public getPointAtOrBefore(points: NumericPoint[], time: Date): NumericPoint | null {
        let latest: NumericPoint | null = null;
        const target = time.getTime();

        for (const point of points) {
            if (point.time.getTime() <= target) {
                latest = point;
                continue;
            }
            break;
        }

        return latest;
    }

    public calculateATR(bars: CandleBar[], period = 14): NumericPoint[] {
        const tr: NumericPoint[] = [];
        if (bars.length < 2) return tr;

        for (let i = 1; i < bars.length; i += 1) {
            const trValue = Math.max(
                bars[i].high - bars[i].low,
                Math.abs(bars[i].high - bars[i - 1].close),
                Math.abs(bars[i].low - bars[i - 1].close),
            );

            tr.push({
                time: bars[i].time,
                value: trValue,
            });
        }

        const atr: NumericPoint[] = [];
        if (tr.length < period) return atr;

        let sum = 0;
        for (let i = 0; i < period; i += 1) {
            sum += tr[i].value;
        }

        let previous = sum / period;
        atr.push({ time: tr[period - 1].time, value: round(previous) });

        for (let i = period; i < tr.length; i += 1) {
            previous = (previous * (period - 1) + tr[i].value) / period;
            atr.push({
                time: tr[i].time,
                value: round(previous),
            });
        }

        return atr;
    }

    public calculateADX(bars: CandleBar[], period = 14): NumericPoint[] {
        const adx: NumericPoint[] = [];
        if (bars.length <= period * 2) return adx;

        const plusDM: number[] = [];
        const minusDM: number[] = [];
        const tr: number[] = [];

        for (let i = 1; i < bars.length; i += 1) {
            const upMove = bars[i].high - bars[i - 1].high;
            const downMove = bars[i - 1].low - bars[i].low;

            plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
            minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);

            tr.push(Math.max(
                bars[i].high - bars[i].low,
                Math.abs(bars[i].high - bars[i - 1].close),
                Math.abs(bars[i].low - bars[i - 1].close),
            ));
        }

        // Wilder's Smoothing
        const smooth = (series: number[], p: number) => {
            const res: number[] = [];
            let sum = 0;
            for (let i = 0; i < p; i += 1) sum += series[i];
            let prev = sum / p;
            res.push(prev);

            for (let i = p; i < series.length; i += 1) {
                prev = (prev * (p - 1) + series[i]) / p;
                res.push(prev);
            }
            return res;
        };

        const str = smooth(tr, period);
        const sdmPlus = smooth(plusDM, period);
        const sdmMinus = smooth(minusDM, period);

        const dx: number[] = [];
        for (let i = 0; i < str.length; i += 1) {
            const diPlus = (sdmPlus[i] / (str[i] || 1)) * 100;
            const diMinus = (sdmMinus[i] / (str[i] || 1)) * 100;
            const diff = Math.abs(diPlus - diMinus);
            const sum = diPlus + diMinus;
            dx.push((diff / (sum || 1)) * 100);
        }

        const adxValues = smooth(dx, period);

        for (let i = 0; i < adxValues.length; i += 1) {
            // Index alignment: 
            // plusDM/minusDM/tr start from bar index 1
            // smooth starts from index period - 1 relative to DM/TR
            // so index i of adxValues corresponds to bar period * 2 - 1 + i
            const barIdx = period * 2 - 1 + i;
            if (barIdx < bars.length) {
                adx.push({
                    time: bars[barIdx].time,
                    value: round(adxValues[i]),
                });
            }
        }

        return adx;
    }

    public toCloseSeries(bars: CandleBar[]): NumericPoint[] {
        return bars.map((bar) => ({
            time: bar.time,
            value: bar.close,
        }));
    }
}
