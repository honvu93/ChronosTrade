import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { IndicatorSeriesService } from '../../IndicatorSeriesService';
import { CandleBar, SignalRuntimeServices } from '../../types';
import { volmanPriceActionBlock } from './VolmanPriceActionBlock';

const runtimeServices = {
    indicatorSeries: new IndicatorSeriesService(),
    executionModel: {} as SignalRuntimeServices['executionModel'],
} as SignalRuntimeServices;

const defaultParams = {
    buildupBars: 4,
    lookbackBars: 5,
    atrPeriod: 5,
    compressionFactor: 1.4,
    boundaryTolerance: 0.25,
    breakoutBuffer: 0.1,
};

function makeBar(
    index: number,
    open: number,
    high: number,
    low: number,
    close: number,
): CandleBar {
    return {
        time: new Date(Date.UTC(2026, 2, 22, 0, index * 5)),
        symbol: 'XAUUSD',
        timeframe: 'M5',
        exchange: 'TEST',
        open,
        high,
        low,
        close,
        volume: 1000,
        isClosed: true,
    };
}

function evaluateAt(
    bars: CandleBar[],
    conditionId: string,
    index = bars.length - 1,
) {
    const state = volmanPriceActionBlock.initialize(bars, defaultParams, runtimeServices);

    return volmanPriceActionBlock.evaluate(
        bars[index]!,
        index > 0 ? bars[index - 1]! : null,
        bars,
        index,
        state,
        defaultParams,
        conditionId,
        {},
        runtimeServices,
    );
}

describe('volmanPriceActionBlock', () => {
    it('detects bullish buildup pressure and the breakout trigger', () => {
        const bars = [
            makeBar(0, 100.0, 101.0, 99.0, 100.4),
            makeBar(1, 100.4, 102.0, 100.0, 101.5),
            makeBar(2, 101.5, 103.5, 101.0, 103.0),
            makeBar(3, 103.0, 105.0, 102.4, 104.4),
            makeBar(4, 104.4, 107.0, 103.9, 106.2),
            makeBar(5, 106.2, 109.9, 105.8, 108.7),
            makeBar(6, 108.6, 109.4, 107.8, 109.0),
            makeBar(7, 109.0, 109.6, 108.2, 109.2),
            makeBar(8, 109.2, 109.8, 108.6, 109.5),
            makeBar(9, 109.5, 109.9, 109.0, 109.8),
            makeBar(10, 109.9, 111.5, 109.4, 111.2),
        ];

        const buildup = evaluateAt(bars, 'bullish_pressure_buildup');
        const breakout = evaluateAt(bars, 'bullish_buildup_breakout');

        assert.equal(buildup.isActive, true);
        assert.equal(breakout.isActive, true);
        assert.equal(breakout.values['bullishPressure'], true);
        assert.equal(breakout.values['bearishPressure'], false);
        assert.equal(breakout.values['buildupHigh'], 109.9);
    });

    it('detects bearish buildup pressure and the downside breakout trigger', () => {
        const bars = [
            makeBar(0, 121.0, 121.6, 119.5, 120.3),
            makeBar(1, 120.3, 120.8, 118.0, 118.8),
            makeBar(2, 118.8, 119.2, 116.1, 116.9),
            makeBar(3, 116.9, 117.3, 114.4, 115.0),
            makeBar(4, 115.0, 115.4, 112.2, 113.2),
            makeBar(5, 113.2, 113.6, 110.2, 111.0),
            makeBar(6, 111.0, 112.0, 110.3, 110.8),
            makeBar(7, 110.8, 111.6, 110.15, 110.45),
            makeBar(8, 110.45, 111.2, 110.1, 110.15),
            makeBar(9, 110.15, 110.8, 110.0, 110.02),
            makeBar(10, 110.0, 110.3, 107.9, 108.1),
        ];

        const buildup = evaluateAt(bars, 'bearish_pressure_buildup');
        const breakout = evaluateAt(bars, 'bearish_buildup_breakout');

        assert.equal(buildup.isActive, true);
        assert.equal(breakout.isActive, true);
        assert.equal(breakout.values['bearishPressure'], true);
        assert.equal(breakout.values['bullishPressure'], false);
        assert.equal(breakout.values['buildupLow'], 110);
    });

    it('detects a bullish false break reversal after bearish pressure', () => {
        const bars = [
            makeBar(0, 120.0, 120.8, 118.8, 119.6),
            makeBar(1, 119.6, 120.0, 117.6, 118.2),
            makeBar(2, 118.2, 118.6, 115.8, 116.7),
            makeBar(3, 116.7, 117.1, 113.9, 114.9),
            makeBar(4, 114.9, 115.2, 111.5, 112.8),
            makeBar(5, 112.8, 113.1, 110.3, 111.1),
            makeBar(6, 111.1, 111.8, 110.35, 110.9),
            makeBar(7, 110.9, 111.5, 110.3, 110.7),
            makeBar(8, 110.7, 111.2, 110.25, 110.5),
            makeBar(9, 110.5, 110.9, 110.2, 110.3),
            makeBar(10, 110.3, 111.3, 109.0, 110.9),
        ];

        const reversal = evaluateAt(bars, 'bullish_false_break_reversal');
        const downsideBreakout = evaluateAt(bars, 'bearish_buildup_breakout');

        assert.equal(reversal.isActive, true);
        assert.equal(reversal.values['bearishPressure'], true);
        assert.equal(reversal.values['bullishFalseBreak'], true);
        assert.equal(downsideBreakout.isActive, false);
    });

    it('stays inactive when price is choppy instead of compressing at a barrier', () => {
        const bars = [
            makeBar(0, 100.0, 101.8, 98.7, 101.0),
            makeBar(1, 101.0, 103.1, 99.2, 100.1),
            makeBar(2, 100.1, 102.9, 98.8, 101.7),
            makeBar(3, 101.7, 104.0, 99.5, 100.0),
            makeBar(4, 100.0, 103.3, 98.6, 102.1),
            makeBar(5, 102.1, 104.2, 99.4, 100.3),
            makeBar(6, 100.3, 103.7, 98.5, 102.0),
            makeBar(7, 102.0, 104.4, 99.1, 100.2),
            makeBar(8, 100.2, 103.5, 98.8, 101.8),
            makeBar(9, 101.8, 104.1, 99.2, 100.1),
            makeBar(10, 100.1, 103.6, 98.7, 101.7),
        ];

        const bullish = evaluateAt(bars, 'bullish_pressure_buildup');
        const bearish = evaluateAt(bars, 'bearish_pressure_buildup');

        assert.equal(bullish.isActive, false);
        assert.equal(bearish.isActive, false);
    });
});
