import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { CandleBar, SignalRuntimeServices } from '../../types';
import { sessionRangeStructureBlock } from './SessionRangeStructureBlock';

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
    params = { asianStartHour: 0, asianEndHour: 7 },
) {
    const state = sessionRangeStructureBlock.initialize(bars, params, runtimeServices);

    return sessionRangeStructureBlock.evaluate(
        bars[targetIndex]!,
        targetIndex > 0 ? bars[targetIndex - 1]! : null,
        bars,
        targetIndex,
        state,
        params,
        conditionId,
        {},
        runtimeServices,
    );
}

describe('sessionRangeStructureBlock', () => {
    it('calculates Asian range and detects a breakout', () => {
        const bars = [
            // Asian Session (00:00 - 07:00)
            makeBar('2026-03-09T00:00:00.000Z', { open: 100, high: 102, low: 99, close: 101 }),
            makeBar('2026-03-09T03:00:00.000Z', { open: 101, high: 105, low: 100, close: 104 }),
            makeBar('2026-03-09T06:00:00.000Z', { open: 104, high: 104.5, low: 103, close: 103.5 }),
            // London Session (starts at 07:00)
            makeBar('2026-03-09T08:00:00.000Z', { open: 103.5, high: 106, low: 103, close: 105.5 }), 
        ];

        const result = evaluateCondition(bars, 'closes_above_asian_high');

        assert.equal(result.isActive, true);
        assert.equal(result.values['asianHigh'], 105);
        assert.equal(result.values['asianLow'], 99);
        assert.equal(result.values['isPostAsian'], true);
    });

    it('detects a bullish sweep of the Asian low', () => {
        const bars = [
            // Asian Session: High 105, Low 99
            makeBar('2026-03-09T00:00:00.000Z', { open: 100, high: 105, low: 99, close: 101 }),
            // Sweep bar
            makeBar('2026-03-09T08:00:00.000Z', { open: 101, high: 102, low: 98.5, close: 99.5 }),
        ];

        const sweep = evaluateCondition(bars, 'bullish_sweep_asian_low');
        assert.equal(sweep.isActive, true);
        assert.equal(sweep.values['asianLow'], 99);
    });

    it('detects a bearish reclaim of the Asian high', () => {
        const bars = [
            // Asian Session: High 105, Low 99
            makeBar('2026-03-09T00:00:00.000Z', { open: 100, high: 105, low: 99, close: 101 }),
            // London breakout
            makeBar('2026-03-09T08:00:00.000Z', { open: 104, high: 106, low: 104, close: 105.5 }),
            // London reclaim
            makeBar('2026-03-09T09:00:00.000Z', { open: 105.5, high: 105.7, low: 104.2, close: 104.5 }),
        ];

        const result = evaluateCondition(bars, 'bearish_reclaim_asian_high');
        assert.equal(result.isActive, true);
        assert.equal(result.values['asianHigh'], 105);
    });

    it('does not trigger conditions during Asian session', () => {
        const bars = [
            makeBar('2026-03-09T00:00:00.000Z', { open: 100, high: 105, low: 99, close: 101 }),
        ];

        const result = evaluateCondition(bars, 'closes_above_asian_high', 0);
        assert.equal(result.isActive, false);
        assert.equal(result.values['isPostAsian'], false);
    });

    it('does not leak future Asian range highs into earlier in-session bars', () => {
        const bars = [
            makeBar('2026-03-09T00:00:00.000Z', { open: 100, high: 102, low: 99, close: 101 }),
            makeBar('2026-03-09T03:00:00.000Z', { open: 101, high: 105, low: 100, close: 104 }),
        ];

        const result = evaluateCondition(bars, 'closes_above_asian_high', 0);

        assert.equal(result.values['asianHigh'], 102);
        assert.equal(result.values['asianLow'], 99);
        assert.equal(result.values['isPostAsian'], false);
    });

    it('builds and reuses an overnight session range when the window crosses midnight', () => {
        const bars = [
            makeBar('2026-03-09T22:00:00.000Z', { open: 100, high: 103, low: 99, close: 102 }),
            makeBar('2026-03-09T23:00:00.000Z', { open: 102, high: 104, low: 100, close: 103 }),
            makeBar('2026-03-10T00:00:00.000Z', { open: 103, high: 105, low: 101, close: 104 }),
            makeBar('2026-03-10T06:00:00.000Z', { open: 104, high: 106, low: 102, close: 105 }),
            makeBar('2026-03-10T08:00:00.000Z', { open: 105, high: 106.4, low: 104.5, close: 106.2 }),
        ];

        const result = evaluateCondition(
            bars,
            'closes_above_asian_high',
            bars.length - 1,
            { asianStartHour: 22, asianEndHour: 7 },
        );

        assert.equal(result.isActive, true);
        assert.equal(result.values['asianHigh'], 106);
        assert.equal(result.values['asianLow'], 99);
        assert.equal(result.values['isPostAsian'], true);
    });
});
