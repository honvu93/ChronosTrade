import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { CandleBar, SignalRuntimeServices } from '../../types';
import { previousPeriodLevelsBlock } from './PreviousPeriodLevelsBlock';

const runtimeServices = {
    indicatorSeries: {},
    executionModel: {},
} as SignalRuntimeServices;

function makeBar(
    time: string,
    values: { open: number; high: number; low: number; close: number },
): CandleBar {
    return {
        time: new Date(time),
        symbol: 'XAUUSD',
        timeframe: '1h',
        exchange: 'TEST',
        open: values.open,
        high: values.high,
        low: values.low,
        close: values.close,
        volume: 1000,
        isClosed: true,
    };
}

function evaluateCondition(
    bars: CandleBar[],
    conditionId: string,
    targetIndex = bars.length - 1,
) {
    const state = previousPeriodLevelsBlock.initialize(bars, {}, runtimeServices);

    return previousPeriodLevelsBlock.evaluate(
        bars[targetIndex]!,
        targetIndex > 0 ? bars[targetIndex - 1]! : null,
        bars,
        targetIndex,
        state,
        {},
        conditionId,
        {},
        runtimeServices,
    );
}

describe('previousPeriodLevelsBlock', () => {
    it('maps previous day levels and flags a touch of the previous day high', () => {
        const bars = [
            makeBar('2026-03-09T09:00:00.000Z', { open: 100, high: 103, low: 99, close: 102 }),
            makeBar('2026-03-09T18:00:00.000Z', { open: 102, high: 104, low: 100, close: 103 }),
            makeBar('2026-03-10T08:00:00.000Z', { open: 103, high: 104.2, low: 101, close: 103.8 }),
        ];

        const result = evaluateCondition(bars, 'touches_previous_day_high');

        assert.equal(result.isActive, true);
        assert.equal(result.values['previousDayHigh'], 104);
        assert.equal(result.values['previousDayLow'], 99);
        assert.equal(result.values['previousDayMidpoint'], 101.5);
        assert.equal(result.values['previousDayKey'], '2026-03-09');
        assert.equal(result.values['previousWeekHigh'], null);
    });

    it('detects a bullish reclaim and sweep-reclaim of the previous day low', () => {
        const bars = [
            makeBar('2026-03-09T09:00:00.000Z', { open: 100, high: 103, low: 99, close: 102 }),
            makeBar('2026-03-09T18:00:00.000Z', { open: 102, high: 104, low: 100, close: 103 }),
            makeBar('2026-03-10T01:00:00.000Z', { open: 100, high: 100.4, low: 98.8, close: 98.9 }),
            makeBar('2026-03-10T02:00:00.000Z', { open: 98.9, high: 100.6, low: 98.6, close: 100.2 }),
        ];

        const reclaim = evaluateCondition(bars, 'bullish_reclaim_previous_day_low');
        const sweepReclaim = evaluateCondition(bars, 'bullish_sweep_reclaim_previous_day_low');

        assert.equal(reclaim.isActive, true);
        assert.equal(sweepReclaim.isActive, true);
        assert.equal(reclaim.values['previousDayLow'], 99);
    });

    it('detects a bearish reclaim and sweep-reclaim of the previous day high', () => {
        const bars = [
            makeBar('2026-03-09T09:00:00.000Z', { open: 100, high: 103, low: 99, close: 102 }),
            makeBar('2026-03-09T18:00:00.000Z', { open: 102, high: 104, low: 100, close: 103 }),
            makeBar('2026-03-10T01:00:00.000Z', { open: 104.1, high: 104.7, low: 103.8, close: 104.3 }),
            makeBar('2026-03-10T02:00:00.000Z', { open: 104.3, high: 104.9, low: 102.7, close: 103.6 }),
        ];

        const reclaim = evaluateCondition(bars, 'bearish_reclaim_previous_day_high');
        const sweepReclaim = evaluateCondition(bars, 'bearish_sweep_reclaim_previous_day_high');

        assert.equal(reclaim.isActive, true);
        assert.equal(sweepReclaim.isActive, true);
        assert.equal(reclaim.values['previousDayHigh'], 104);
    });

    it('uses the prior data-bearing Friday as the previous day and previous week source on Monday', () => {
        const bars = [
            makeBar('2026-03-06T18:00:00.000Z', { open: 106, high: 110, low: 100, close: 108 }),
            makeBar('2026-03-06T20:00:00.000Z', { open: 108, high: 109, low: 101, close: 107 }),
            makeBar('2026-03-09T01:00:00.000Z', { open: 107, high: 111, low: 105, close: 110.5 }),
        ];

        const result = evaluateCondition(bars, 'closes_above_previous_week_high');

        assert.equal(result.isActive, true);
        assert.equal(result.values['previousDayHigh'], 110);
        assert.equal(result.values['previousDayLow'], 100);
        assert.equal(result.values['previousWeekHigh'], 110);
        assert.equal(result.values['previousWeekLow'], 100);
        assert.equal(result.values['previousWeekKey'], '2026-03-02');
    });

    it('returns null levels on the first available period with no completed history', () => {
        const bars = [
            makeBar('2026-03-09T09:00:00.000Z', { open: 100, high: 103, low: 99, close: 102 }),
            makeBar('2026-03-09T18:00:00.000Z', { open: 102, high: 104, low: 100, close: 103 }),
        ];

        const result = evaluateCondition(bars, 'touches_previous_day_high', 0);

        assert.equal(result.isActive, false);
        assert.equal(result.values['previousDayHigh'], null);
        assert.equal(result.values['previousWeekHigh'], null);
        assert.equal(result.values['previousDayKey'], null);
    });
});
