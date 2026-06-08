import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { IndicatorSeriesService } from '../../IndicatorSeriesService';
import { CandleBar, SignalRuntimeServices } from '../../types';
import { emaCrossBlock } from './EmaCrossBlock';

const runtimeServices = {
    indicatorSeries: new IndicatorSeriesService(),
    executionModel: {} as SignalRuntimeServices['executionModel'],
} as SignalRuntimeServices;

function makeBar(index: number, close: number): CandleBar {
    return {
        time: new Date(Date.UTC(2026, 0, 1, 0, index)),
        symbol: 'XAUUSD',
        timeframe: 'M15',
        exchange: 'TEST',
        open: close - 0.2,
        high: close + 0.5,
        low: close - 0.5,
        close,
        volume: 1000,
        isClosed: true,
    };
}

const defaultParams = { fastPeriod: 3, slowPeriod: 5 };

function evaluateCondition(
    closes: number[],
    conditionId: string,
    targetIndex = closes.length - 1,
) {
    const bars = closes.map((c, i) => makeBar(i, c));
    const state = emaCrossBlock.initialize(bars, defaultParams, runtimeServices);

    return emaCrossBlock.evaluate(
        bars[targetIndex]!,
        targetIndex > 0 ? bars[targetIndex - 1]! : null,
        bars,
        targetIndex,
        state,
        defaultParams,
        conditionId,
        {},
        runtimeServices,
    );
}

describe('emaCrossBlock', () => {
    it('detects price above fast EMA in a rising series', () => {
        const closes = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110];
        const result = evaluateCondition(closes, 'price_above_ema');

        assert.equal(result.isActive, true);
        assert.ok(typeof result.values['fastEma'] === 'number');
        assert.ok(typeof result.values['slowEma'] === 'number');
    });

    it('detects price below fast EMA in a falling series', () => {
        const closes = [110, 109, 108, 107, 106, 105, 104, 103, 102, 101, 100];
        const result = evaluateCondition(closes, 'price_below_ema');

        assert.equal(result.isActive, true);
    });

    it('detects golden cross when fast EMA crosses above slow EMA', () => {
        // Start falling then sharply rise — fast EMA overtakes slow EMA
        const closes = [110, 108, 106, 104, 102, 100, 98, 100, 103, 107, 112, 118, 125];
        const bars = closes.map((c, i) => makeBar(i, c));
        const state = emaCrossBlock.initialize(bars, defaultParams, runtimeServices);

        let crossFound = false;
        for (let i = 1; i < bars.length; i++) {
            const result = emaCrossBlock.evaluate(
                bars[i]!, bars[i - 1]!, bars, i, state,
                defaultParams, 'fast_crosses_above', {}, runtimeServices,
            );
            if (result.isActive) {
                crossFound = true;
                // At cross point, fast should be above slow
                assert.ok((result.values['fastEma'] as number) > (result.values['slowEma'] as number));
                // Previous bar: fast should have been <= slow
                assert.ok((result.values['prevFastEma'] as number) <= (result.values['prevSlowEma'] as number));
                break;
            }
        }
        assert.equal(crossFound, true, 'Expected a golden cross to be detected');
    });

    it('detects death cross when fast EMA crosses below slow EMA', () => {
        // Start rising then sharply fall — fast EMA drops below slow EMA
        const closes = [90, 92, 94, 96, 98, 100, 102, 100, 97, 93, 88, 82, 75];
        const bars = closes.map((c, i) => makeBar(i, c));
        const state = emaCrossBlock.initialize(bars, defaultParams, runtimeServices);

        let crossFound = false;
        for (let i = 1; i < bars.length; i++) {
            const result = emaCrossBlock.evaluate(
                bars[i]!, bars[i - 1]!, bars, i, state,
                defaultParams, 'fast_crosses_below', {}, runtimeServices,
            );
            if (result.isActive) {
                crossFound = true;
                assert.ok((result.values['fastEma'] as number) < (result.values['slowEma'] as number));
                assert.ok((result.values['prevFastEma'] as number) >= (result.values['prevSlowEma'] as number));
                break;
            }
        }
        assert.equal(crossFound, true, 'Expected a death cross to be detected');
    });

    it('returns false for all conditions when not enough data', () => {
        const closes = [100, 101];
        for (const conditionId of ['price_above_ema', 'price_below_ema', 'fast_crosses_above', 'fast_crosses_below']) {
            const result = evaluateCondition(closes, conditionId, 0);
            assert.equal(result.isActive, false);
        }
    });

    it('enforces slow period is greater than fast period', () => {
        const closes = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110];
        const bars = closes.map((c, i) => makeBar(i, c));

        // Pass slowPeriod = 2 (less than fastPeriod = 3), should be clamped to fastPeriod + 1 = 4
        const state = emaCrossBlock.initialize(bars, { fastPeriod: 3, slowPeriod: 2 }, runtimeServices);

        // Slow EMA should still compute (no crash)
        const result = emaCrossBlock.evaluate(
            bars[10]!, bars[9]!, bars, 10, state,
            { fastPeriod: 3, slowPeriod: 2 },
            'price_above_ema', {}, runtimeServices,
        );

        assert.ok(typeof result.values['slowEma'] === 'number');
    });
});
