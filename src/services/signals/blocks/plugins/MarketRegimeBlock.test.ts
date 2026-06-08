import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { IndicatorSeriesService } from '../../IndicatorSeriesService';
import { CandleBar, SignalRuntimeServices } from '../../types';
import { marketRegimeBlock } from './MarketRegimeBlock';

const runtimeServices = {
    indicatorSeries: new IndicatorSeriesService(),
    executionModel: {} as SignalRuntimeServices['executionModel'],
} as SignalRuntimeServices;

function makeBar(index: number, close: number, range: number): CandleBar {
    return {
        time: new Date(Date.UTC(2026, 0, 1, 0, index)),
        symbol: 'XAUUSD',
        timeframe: 'M15',
        exchange: 'TEST',
        open: close - 0.2,
        high: close + range,
        low: close - range,
        close,
        volume: 1000,
        isClosed: true,
    };
}

describe('marketRegimeBlock', () => {
    it('does not classify high volatility before 50 prior ATR samples exist', () => {
        const bars = Array.from({ length: 55 }, (_, index) => makeBar(index, 100 + index * 0.2, 1));
        const state = marketRegimeBlock.initialize(
            bars,
            { adxPeriod: 14, atrPeriod: 14, emaFilterPeriod: 50 },
            runtimeServices,
        );

        const result = marketRegimeBlock.evaluate(
            bars[54]!,
            bars[53]!,
            bars,
            54,
            state,
            { adxPeriod: 14, atrPeriod: 14, emaFilterPeriod: 50 },
            'regime_high_volatility',
            { multiplier: 1 },
            runtimeServices,
        );

        assert.equal(result.values['atrSma'], null);
        assert.equal(result.isActive, false);
    });

    it('uses the prior 50 ATR observations as the volatility baseline', () => {
        const bars = Array.from({ length: 90 }, (_, index) => {
            const range = index === 89 ? 4 : 1 + (index % 5) * 0.1;
            return makeBar(index, 100 + index * 0.15, range);
        });
        const state = marketRegimeBlock.initialize(
            bars,
            { adxPeriod: 14, atrPeriod: 14, emaFilterPeriod: 50 },
            runtimeServices,
        );
        const targetIndex = bars.length - 1;

        const result = marketRegimeBlock.evaluate(
            bars[targetIndex]!,
            bars[targetIndex - 1]!,
            bars,
            targetIndex,
            state,
            { adxPeriod: 14, atrPeriod: 14, emaFilterPeriod: 50 },
            'regime_high_volatility',
            { multiplier: 1 },
            runtimeServices,
        );

        const priorAtrValues = state.atrValues
            .slice(0, targetIndex)
            .filter((value): value is number => value !== null)
            .slice(-50);
        const expectedBaseline = Number((priorAtrValues.reduce((sum, value) => sum + value, 0) / priorAtrValues.length).toFixed(8));

        assert.equal(priorAtrValues.length, 50);
        assert.equal(result.values['atrSma'], expectedBaseline);
    });
});
