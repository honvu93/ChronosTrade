import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { IndicatorSeriesService } from '../../IndicatorSeriesService';
import { CandleBar, SignalRuntimeServices } from '../../types';
import { atrRegimeBlock } from './AtrRegimeBlock';

const runtimeServices = {
    indicatorSeries: new IndicatorSeriesService(),
    executionModel: {},
} as unknown as SignalRuntimeServices;

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

describe('atrRegimeBlock', () => {
    it('does not classify volatility before the ATR baseline has enough non-null samples', () => {
        const bars = [
            makeBar('2026-03-09T00:00:00.000Z', { open: 100, high: 101, low: 99, close: 100.5 }),
            makeBar('2026-03-09T01:00:00.000Z', { open: 100.5, high: 102, low: 100, close: 101.5 }),
            makeBar('2026-03-09T02:00:00.000Z', { open: 101.5, high: 103.5, low: 101, close: 103 }),
            makeBar('2026-03-09T03:00:00.000Z', { open: 103, high: 104, low: 102.5, close: 103.2 }),
        ];

        const state = atrRegimeBlock.initialize(bars, { atrPeriod: 2, basePeriod: 3 }, runtimeServices);
        const result = atrRegimeBlock.evaluate(
            bars[2]!,
            bars[1]!,
            bars,
            2,
            state,
            { atrPeriod: 2, basePeriod: 3 },
            'atr_expansion',
            { multiplier: 0.5 },
            runtimeServices,
        );

        assert.equal(result.isActive, false);
        assert.equal(result.values['atrSma'], null);
        assert.ok(typeof result.values['atr'] === 'number');
    });
});
