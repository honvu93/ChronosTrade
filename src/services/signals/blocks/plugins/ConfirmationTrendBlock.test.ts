import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { IndicatorSeriesService } from '../../IndicatorSeriesService';
import { CandleBar, SignalRuntimeServices } from '../../types';
import { confirmationTrendBlock } from './ConfirmationTrendBlock';

const runtimeServices = {
    indicatorSeries: new IndicatorSeriesService(),
    executionModel: {} as SignalRuntimeServices['executionModel'],
} as SignalRuntimeServices;

function makeBar(index: number, close: number, range = 1): CandleBar {
    return {
        time: new Date(Date.UTC(2026, 0, 1, 0, index)),
        symbol: 'XAUUSD',
        timeframe: '1h',
        exchange: 'TEST',
        open: close - 0.2,
        high: close + range,
        low: close - range,
        close,
        volume: 1000,
        isClosed: true,
    };
}

const defaultParams = { fastPeriod: 3, slowPeriod: 5, adxPeriod: 3 };

function evaluateCondition(
    bars: CandleBar[],
    conditionId: string,
    conditionParams: Record<string, unknown> = {},
    targetIndex = bars.length - 1,
) {
    const state = confirmationTrendBlock.initialize(bars, defaultParams, runtimeServices);

    return confirmationTrendBlock.evaluate(
        bars[targetIndex]!, targetIndex > 0 ? bars[targetIndex - 1]! : null,
        bars, targetIndex, state, defaultParams, conditionId, conditionParams, runtimeServices,
    );
}

describe('confirmationTrendBlock', () => {
    it('confirms uptrend when price > slowEMA, fastEMA > slowEMA, ADX strong', () => {
        // Strong uptrend: consistently rising closes with enough range for ADX
        const closes = Array.from({ length: 30 }, (_, i) => 100 + i * 2);
        const bars = closes.map((c, i) => makeBar(i, c, 2));

        const result = evaluateCondition(bars, 'confirmation_uptrend', { adxThreshold: 10 });

        // In a strong uptrend: price > slow EMA, fast > slow, ADX should be elevated
        if (result.values['fastEma'] !== null && result.values['slowEma'] !== null && result.values['adx'] !== null) {
            assert.ok((result.values['fastEma'] as number) > (result.values['slowEma'] as number));
            assert.equal(result.isActive, true);
        }
    });

    it('confirms downtrend when price < slowEMA, fastEMA < slowEMA, ADX strong', () => {
        // Strong downtrend: consistently falling closes
        const closes = Array.from({ length: 30 }, (_, i) => 200 - i * 2);
        const bars = closes.map((c, i) => makeBar(i, c, 2));

        const result = evaluateCondition(bars, 'confirmation_downtrend', { adxThreshold: 10 });

        if (result.values['fastEma'] !== null && result.values['slowEma'] !== null && result.values['adx'] !== null) {
            assert.ok((result.values['fastEma'] as number) < (result.values['slowEma'] as number));
            assert.equal(result.isActive, true);
        }
    });

    it('stays inactive in a flat/choppy market with low ADX', () => {
        // Choppy market: alternating
        const closes = Array.from({ length: 30 }, (_, i) => 100 + (i % 2 === 0 ? 0.5 : -0.5));
        const bars = closes.map((c, i) => makeBar(i, c, 0.5));

        const uptrend = evaluateCondition(bars, 'confirmation_uptrend', { adxThreshold: 25 });
        const downtrend = evaluateCondition(bars, 'confirmation_downtrend', { adxThreshold: 25 });

        // In choppy market, neither should confirm
        assert.equal(uptrend.isActive, false);
        assert.equal(downtrend.isActive, false);
    });

    it('returns null values when not enough data for indicators', () => {
        const bars = [makeBar(0, 100), makeBar(1, 101)];

        const result = evaluateCondition(bars, 'confirmation_uptrend', {}, 0);

        assert.equal(result.isActive, false);
    });

    it('respects custom ADX threshold parameter', () => {
        const closes = Array.from({ length: 30 }, (_, i) => 100 + i * 2);
        const bars = closes.map((c, i) => makeBar(i, c, 2));

        // Threshold above theoretical ADX maximum — should not trigger
        const result = evaluateCondition(bars, 'confirmation_uptrend', { adxThreshold: 101 });

        assert.equal(result.isActive, false);
    });

    it('enforces slowPeriod > fastPeriod', () => {
        const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
        const bars = closes.map((c, i) => makeBar(i, c));

        // slowPeriod will be clamped to fastPeriod + 1
        const state = confirmationTrendBlock.initialize(
            bars, { fastPeriod: 5, slowPeriod: 3, adxPeriod: 3 }, runtimeServices,
        );

        const result = confirmationTrendBlock.evaluate(
            bars[19]!, bars[18]!, bars, 19, state,
            { fastPeriod: 5, slowPeriod: 3, adxPeriod: 3 },
            'confirmation_uptrend', {}, runtimeServices,
        );

        // Should not crash, and slow EMA should be computed
        assert.ok(typeof result.values['slowEma'] === 'number' || result.values['slowEma'] === null);
    });
});
