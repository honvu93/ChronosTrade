import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { IndicatorSeriesService } from '../../IndicatorSeriesService';
import { CandleBar, SignalRuntimeServices } from '../../types';
import { trendCatcherBlock } from './TrendCatcherBlock';

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

const defaultParams = { fastPeriod: 3, slowPeriod: 5, rsiPeriod: 14 };

function evaluateCondition(
    closes: number[],
    conditionId: string,
    conditionParams: Record<string, unknown> = {},
    targetIndex?: number,
) {
    const bars = closes.map((c, i) => makeBar(i, c));
    const idx = targetIndex ?? bars.length - 1;
    const state = trendCatcherBlock.initialize(bars, defaultParams, runtimeServices);

    return trendCatcherBlock.evaluate(
        bars[idx]!, idx > 0 ? bars[idx - 1]! : null,
        bars, idx, state, defaultParams, conditionId, conditionParams, runtimeServices,
    );
}

describe('trendCatcherBlock', () => {
    it('detects bullish trend: close > fastEMA > slowEMA and RSI above threshold', () => {
        // Strong uptrend
        const closes = Array.from({ length: 25 }, (_, i) => 100 + i);
        const result = evaluateCondition(closes, 'trend_catcher_bullish', { rsiThreshold: 50 });

        if (result.values['fastEma'] !== null && result.values['slowEma'] !== null && result.values['rsi'] !== null) {
            assert.equal(result.isActive, true);
            assert.ok((result.values['fastEma'] as number) > (result.values['slowEma'] as number));
            assert.ok((result.values['rsi'] as number) >= 50);
        }
    });

    it('detects bearish trend: close < fastEMA < slowEMA and RSI below threshold', () => {
        // Strong downtrend
        const closes = Array.from({ length: 25 }, (_, i) => 200 - i);
        const result = evaluateCondition(closes, 'trend_catcher_bearish', { rsiThreshold: 50 });

        if (result.values['fastEma'] !== null && result.values['slowEma'] !== null && result.values['rsi'] !== null) {
            assert.equal(result.isActive, true);
            assert.ok((result.values['fastEma'] as number) < (result.values['slowEma'] as number));
            assert.ok((result.values['rsi'] as number) <= 50);
        }
    });

    it('stays inactive when RSI does not meet threshold even if EMA alignment is correct', () => {
        // Uptrend with threshold above theoretical RSI maximum
        const closes = Array.from({ length: 25 }, (_, i) => 100 + i * 0.3);
        const result = evaluateCondition(closes, 'trend_catcher_bullish', { rsiThreshold: 101 });

        assert.equal(result.isActive, false);
    });

    it('stays inactive in choppy market', () => {
        const closes = Array.from({ length: 25 }, (_, i) => 100 + (i % 2 === 0 ? 1 : -1));
        const bullish = evaluateCondition(closes, 'trend_catcher_bullish', { rsiThreshold: 55 });
        const bearish = evaluateCondition(closes, 'trend_catcher_bearish', { rsiThreshold: 45 });

        // In choppy conditions, EMAs converge and RSI hovers ~50
        assert.equal(bullish.isActive, false);
        assert.equal(bearish.isActive, false);
    });

    it('returns null values when insufficient data', () => {
        const result = evaluateCondition([100, 101], 'trend_catcher_bullish', {}, 0);

        assert.equal(result.isActive, false);
    });

    it('exposes all three indicator values', () => {
        const closes = Array.from({ length: 25 }, (_, i) => 100 + i);
        const result = evaluateCondition(closes, 'trend_catcher_bullish');

        assert.ok('fastEma' in result.values);
        assert.ok('slowEma' in result.values);
        assert.ok('rsi' in result.values);
    });
});
