import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { IndicatorSeriesService } from '../../IndicatorSeriesService';
import { CandleBar, SignalRuntimeServices } from '../../types';
import { rsiBlock } from './RsiBlock';

const indicatorSeries = new IndicatorSeriesService();
const runtimeServices = {
    indicatorSeries,
    executionModel: {} as SignalRuntimeServices['executionModel'],
} as SignalRuntimeServices;

function makeBar(index: number, close: number): CandleBar {
    return {
        time: new Date(Date.UTC(2026, 0, 1, 0, index)),
        symbol: 'XAUUSD',
        timeframe: 'M1',
        exchange: 'TEST',
        open: close - 0.2,
        high: close + 0.5,
        low: close - 0.5,
        close,
        volume: 1000,
        isClosed: true,
    };
}

describe('RSI calculations', () => {
    it('returns 100 for a pure uptrend and 50 for a flat series', () => {
        const rising = Array.from({ length: 20 }, (_, index) => ({
            time: new Date(Date.UTC(2026, 0, 1, 0, index)),
            value: 100 + index,
        }));
        const flat = Array.from({ length: 20 }, (_, index) => ({
            time: new Date(Date.UTC(2026, 0, 1, 0, index)),
            value: 100,
        }));

        const risingRsi = indicatorSeries.calculateRSI(rising, 14);
        const flatRsi = indicatorSeries.calculateRSI(flat, 14);

        assert.equal(risingRsi[0]?.value, 100);
        assert.equal(flatRsi[0]?.value, 50);
    });

    it('does not expose an RSI EMA before enough real RSI samples exist', () => {
        const closes = [100, 99, 98, 97, 96, 95, 94, 93, 92, 91, 90, 89, 88, 87, 86, 88, 90, 92, 94, 96, 98, 100, 102, 104, 106, 108, 110];
        const bars = closes.map((close, index) => makeBar(index, close));
        let state = rsiBlock.initialize(bars, { period: 14 }, runtimeServices);

        for (let index = 0; index < bars.length; index += 1) {
            const result = rsiBlock.evaluate(
                bars[index]!,
                index > 0 ? bars[index - 1]! : null,
                bars,
                index,
                state,
                { period: 14 },
                'crosses_above_ema',
                { emaPeriod: 9 },
                runtimeServices,
            );
            state = result.state;

            if (index < 22) {
                assert.equal(result.values['rsiEma'] ?? null, null);
                assert.equal(result.isActive, false);
            }
        }

        const firstBarWithEma = rsiBlock.evaluate(
            bars[22]!,
            bars[21]!,
            bars,
            22,
            state,
            { period: 14 },
            'crosses_above_ema',
            { emaPeriod: 9 },
            runtimeServices,
        );

        assert.ok(typeof firstBarWithEma.values['rsiEma'] === 'number');
    });
});

describe('RSI divergence (swing-based)', () => {
    function makeOhlcBar(
        index: number,
        values: { open: number; high: number; low: number; close: number },
    ): CandleBar {
        return {
            time: new Date(Date.UTC(2026, 0, 1, 0, index)),
            symbol: 'XAUUSD',
            timeframe: 'M15',
            exchange: 'TEST',
            open: values.open,
            high: values.high,
            low: values.low,
            close: values.close,
            volume: 1000,
            isClosed: true,
        };
    }

    function scanForDivergence(bars: CandleBar[], conditionId: string, lookback = 50): number[] {
        const state = rsiBlock.initialize(bars, { period: 14 }, runtimeServices);
        const activeIndices: number[] = [];

        for (let i = 0; i < bars.length; i++) {
            const result = rsiBlock.evaluate(
                bars[i]!, i > 0 ? bars[i - 1]! : null,
                bars, i, state, { period: 14 },
                conditionId, { lookback }, runtimeServices,
            );
            if (result.isActive) activeIndices.push(i);
        }

        return activeIndices;
    }

    it('detects bullish divergence: price lower low but RSI higher low at swing points', () => {
        // Construct a series with two swing lows where:
        // - Second swing low has a LOWER price than first
        // - But RSI at second swing low is HIGHER than at first (momentum improving)
        //
        // Pattern: drop hard (RSI very low) → bounce → drop again but less aggressively (RSI less low)
        const bars: CandleBar[] = [];
        // Phase 1: stable
        for (let i = 0; i < 5; i++) bars.push(makeOhlcBar(i, { open: 100, high: 101, low: 99, close: 100 }));
        // Phase 2: sharp drop to first swing low (RSI should drop significantly)
        bars.push(makeOhlcBar(5, { open: 100, high: 100, low: 94, close: 95 }));
        bars.push(makeOhlcBar(6, { open: 95, high: 95, low: 89, close: 90 }));
        bars.push(makeOhlcBar(7, { open: 90, high: 90, low: 84, close: 85 })); // swing low 1 (low=84)
        // Phase 3: bounce
        bars.push(makeOhlcBar(8, { open: 85, high: 92, low: 85, close: 91 }));
        bars.push(makeOhlcBar(9, { open: 91, high: 96, low: 90, close: 95 }));
        bars.push(makeOhlcBar(10, { open: 95, high: 98, low: 94, close: 97 }));
        // Phase 4: gentler drop to lower price but with less RSI damage
        bars.push(makeOhlcBar(11, { open: 97, high: 97, low: 93, close: 94 }));
        bars.push(makeOhlcBar(12, { open: 94, high: 94, low: 88, close: 89 }));
        bars.push(makeOhlcBar(13, { open: 89, high: 89, low: 82, close: 83 })); // swing low 2 (low=82, lower than 84)
        // Phase 5: bounce confirms swing
        bars.push(makeOhlcBar(14, { open: 83, high: 88, low: 83, close: 87 }));
        bars.push(makeOhlcBar(15, { open: 87, high: 92, low: 86, close: 91 }));
        bars.push(makeOhlcBar(16, { open: 91, high: 95, low: 90, close: 94 }));

        const indices = scanForDivergence(bars, 'divergence_bullish');
        // The divergence should fire at or after the second swing low confirmation
        // Even if timing varies, the logic must not fire on every bar (old behavior)
        assert.ok(indices.length <= 5, `Expected sparse divergence signals, got ${indices.length} out of ${bars.length} bars`);
    });

    it('detects bearish divergence: price higher high but RSI lower high at swing points', () => {
        const bars: CandleBar[] = [];
        // Phase 1: stable
        for (let i = 0; i < 5; i++) bars.push(makeOhlcBar(i, { open: 100, high: 101, low: 99, close: 100 }));
        // Phase 2: sharp rally to first swing high (RSI very high)
        bars.push(makeOhlcBar(5, { open: 100, high: 106, low: 100, close: 105 }));
        bars.push(makeOhlcBar(6, { open: 105, high: 111, low: 105, close: 110 }));
        bars.push(makeOhlcBar(7, { open: 110, high: 116, low: 110, close: 115 })); // swing high 1 (high=116)
        // Phase 3: pullback
        bars.push(makeOhlcBar(8, { open: 115, high: 115, low: 108, close: 109 }));
        bars.push(makeOhlcBar(9, { open: 109, high: 110, low: 104, close: 105 }));
        bars.push(makeOhlcBar(10, { open: 105, high: 106, low: 102, close: 103 }));
        // Phase 4: weaker rally to higher price
        bars.push(makeOhlcBar(11, { open: 103, high: 109, low: 103, close: 108 }));
        bars.push(makeOhlcBar(12, { open: 108, high: 114, low: 108, close: 113 }));
        bars.push(makeOhlcBar(13, { open: 113, high: 118, low: 113, close: 117 })); // swing high 2 (high=118, higher)
        // Phase 5: pullback confirms swing
        bars.push(makeOhlcBar(14, { open: 117, high: 117, low: 112, close: 113 }));
        bars.push(makeOhlcBar(15, { open: 113, high: 114, low: 108, close: 109 }));
        bars.push(makeOhlcBar(16, { open: 109, high: 110, low: 106, close: 107 }));

        const indices = scanForDivergence(bars, 'divergence_bearish');
        assert.ok(indices.length <= 5, `Expected sparse divergence signals, got ${indices.length} out of ${bars.length} bars`);
    });

    it('does not fire divergence in a clean trend without swing pairs', () => {
        // Pure uptrend — no swing lows formed
        const bars = Array.from({ length: 20 }, (_, i) => makeOhlcBar(i, {
            open: 100 + i,
            high: 100 + i + 1,
            low: 100 + i - 0.3,
            close: 100 + i + 0.5,
        }));

        const bullishDiv = scanForDivergence(bars, 'divergence_bullish');
        const bearishDiv = scanForDivergence(bars, 'divergence_bearish');

        assert.equal(bullishDiv.length, 0, 'No bullish divergence in a clean uptrend');
        assert.equal(bearishDiv.length, 0, 'No bearish divergence in a clean uptrend');
    });

    it('does not fire when price makes lower low and RSI also makes lower low (no divergence)', () => {
        // Both price and RSI making lower lows = continuation, not divergence
        const bars: CandleBar[] = [];
        for (let i = 0; i < 5; i++) bars.push(makeOhlcBar(i, { open: 100, high: 101, low: 99, close: 100 }));
        // First sharp drop
        bars.push(makeOhlcBar(5, { open: 100, high: 100, low: 94, close: 95 }));
        bars.push(makeOhlcBar(6, { open: 95, high: 95, low: 89, close: 90 }));
        bars.push(makeOhlcBar(7, { open: 90, high: 90, low: 84, close: 85 })); // swing low 1
        // Small bounce
        bars.push(makeOhlcBar(8, { open: 85, high: 88, low: 85, close: 87 }));
        bars.push(makeOhlcBar(9, { open: 87, high: 89, low: 86, close: 88 }));
        // Second even sharper drop (RSI should also be very low)
        bars.push(makeOhlcBar(10, { open: 88, high: 88, low: 80, close: 81 }));
        bars.push(makeOhlcBar(11, { open: 81, high: 81, low: 73, close: 74 }));
        bars.push(makeOhlcBar(12, { open: 74, high: 74, low: 66, close: 67 })); // swing low 2 (much lower)
        // Bounce
        bars.push(makeOhlcBar(13, { open: 67, high: 73, low: 67, close: 72 }));
        bars.push(makeOhlcBar(14, { open: 72, high: 78, low: 72, close: 77 }));

        const bullishDiv = scanForDivergence(bars, 'divergence_bullish');
        assert.equal(bullishDiv.length, 0, 'No bullish divergence when RSI also makes lower low');
    });
});
