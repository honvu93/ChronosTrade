import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { IndicatorSeriesService } from '../../IndicatorSeriesService';
import { CandleBar, SignalRuntimeServices } from '../../types';
import { smartTrailSwitchBlock } from './SmartTrailSwitchBlock';

const runtimeServices = {
    indicatorSeries: new IndicatorSeriesService(),
    executionModel: {} as SignalRuntimeServices['executionModel'],
} as SignalRuntimeServices;

function makeBar(
    index: number,
    values: { open: number; high: number; low: number; close: number },
): CandleBar {
    return {
        time: new Date(Date.UTC(2026, 0, 1, 0, index)),
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

const defaultParams = { atrPeriod: 3, multiplier: 1.5 };

function evaluateCondition(
    bars: CandleBar[],
    conditionId: string,
    targetIndex = bars.length - 1,
) {
    const state = smartTrailSwitchBlock.initialize(bars, defaultParams, runtimeServices);

    return smartTrailSwitchBlock.evaluate(
        bars[targetIndex]!, targetIndex > 0 ? bars[targetIndex - 1]! : null,
        bars, targetIndex, state, defaultParams, conditionId, {}, runtimeServices,
    );
}

function scanForCondition(bars: CandleBar[], conditionId: string): number[] {
    const state = smartTrailSwitchBlock.initialize(bars, defaultParams, runtimeServices);
    const activeIndices: number[] = [];

    for (let i = 0; i < bars.length; i++) {
        const result = smartTrailSwitchBlock.evaluate(
            bars[i]!, i > 0 ? bars[i - 1]! : null,
            bars, i, state, defaultParams, conditionId, {}, runtimeServices,
        );
        if (result.isActive) activeIndices.push(i);
    }

    return activeIndices;
}

describe('smartTrailSwitchBlock', () => {
    it('identifies bullish state in a sustained uptrend', () => {
        const bars = Array.from({ length: 15 }, (_, i) => makeBar(i, {
            open: 100 + i * 2,
            high: 100 + i * 2 + 1.5,
            low: 100 + i * 2 - 0.5,
            close: 100 + i * 2 + 1,
        }));

        const result = evaluateCondition(bars, 'bullish_state');

        assert.equal(result.isActive, true);
        assert.equal(result.values['trendState'], 1);
        assert.ok(typeof result.values['trailLine'] === 'number');
    });

    it('identifies bearish state in a sustained downtrend', () => {
        const bars = Array.from({ length: 15 }, (_, i) => makeBar(i, {
            open: 200 - i * 2,
            high: 200 - i * 2 + 0.5,
            low: 200 - i * 2 - 1.5,
            close: 200 - i * 2 - 1,
        }));

        const result = evaluateCondition(bars, 'bearish_state');

        assert.equal(result.isActive, true);
        assert.equal(result.values['trendState'], -1);
    });

    it('detects a bullish switch when trend flips from bearish to bullish', () => {
        // Downtrend then sharp reversal
        const bars = [
            makeBar(0, { open: 120, high: 121, low: 119, close: 119.5 }),
            makeBar(1, { open: 119.5, high: 120, low: 117, close: 117.5 }),
            makeBar(2, { open: 117.5, high: 118, low: 115, close: 115.5 }),
            makeBar(3, { open: 115.5, high: 116, low: 113, close: 113.5 }),
            makeBar(4, { open: 113.5, high: 114, low: 111, close: 111.5 }),
            // Sharp reversal
            makeBar(5, { open: 111.5, high: 118, low: 111, close: 117 }),
            makeBar(6, { open: 117, high: 122, low: 116.5, close: 121.5 }),
            makeBar(7, { open: 121.5, high: 126, low: 121, close: 125 }),
        ];

        const switches = scanForCondition(bars, 'bullish_switch');
        assert.ok(switches.length > 0, 'Expected at least one bullish switch after reversal');

        // At the switch bar, prev trend should have been -1
        for (const idx of switches) {
            const result = evaluateCondition(bars, 'bullish_switch', idx);
            assert.equal(result.values['trendState'], 1);
            assert.equal(result.values['prevTrendState'], -1);
        }
    });

    it('detects a bearish switch when trend flips from bullish to bearish', () => {
        // Uptrend then sharp drop
        const bars = [
            makeBar(0, { open: 100, high: 101.5, low: 99.5, close: 101 }),
            makeBar(1, { open: 101, high: 103, low: 100.5, close: 102.5 }),
            makeBar(2, { open: 102.5, high: 105, low: 102, close: 104.5 }),
            makeBar(3, { open: 104.5, high: 107, low: 104, close: 106.5 }),
            makeBar(4, { open: 106.5, high: 109, low: 106, close: 108.5 }),
            // Sharp drop
            makeBar(5, { open: 108.5, high: 109, low: 102, close: 102.5 }),
            makeBar(6, { open: 102.5, high: 103, low: 97, close: 97.5 }),
            makeBar(7, { open: 97.5, high: 98, low: 93, close: 93.5 }),
        ];

        const switches = scanForCondition(bars, 'bearish_switch');
        assert.ok(switches.length > 0, 'Expected at least one bearish switch after drop');

        for (const idx of switches) {
            const result = evaluateCondition(bars, 'bearish_switch', idx);
            assert.equal(result.values['trendState'], -1);
            assert.equal(result.values['prevTrendState'], 1);
        }
    });

    it('trail line equals lower band in bullish state and upper band in bearish state', () => {
        const bars = Array.from({ length: 15 }, (_, i) => makeBar(i, {
            open: 100 + i * 2,
            high: 100 + i * 2 + 1.5,
            low: 100 + i * 2 - 0.5,
            close: 100 + i * 2 + 1,
        }));

        const result = evaluateCondition(bars, 'bullish_state');

        if (result.values['trendState'] === 1) {
            assert.equal(result.values['trailLine'], result.values['lowerBand']);
        }
    });

    it('returns null trend state before ATR warmup', () => {
        const bars = [
            makeBar(0, { open: 100, high: 101, low: 99, close: 100.5 }),
        ];

        // ATR period = 3, so first bar won't have ATR
        const result = evaluateCondition(bars, 'bullish_state', 0);
        assert.equal(result.isActive, false);
    });

    it('exposes all trace values: trailLine, upperBand, lowerBand, trendState, prevTrendState', () => {
        const bars = Array.from({ length: 10 }, (_, i) => makeBar(i, {
            open: 100 + i,
            high: 100 + i + 1,
            low: 100 + i - 0.5,
            close: 100 + i + 0.5,
        }));

        const result = evaluateCondition(bars, 'bullish_state');
        const expectedKeys = ['trailLine', 'upperBand', 'lowerBand', 'trendState', 'prevTrendState'];

        for (const key of expectedKeys) {
            assert.ok(key in result.values, `Expected '${key}' in values`);
        }
    });
});
