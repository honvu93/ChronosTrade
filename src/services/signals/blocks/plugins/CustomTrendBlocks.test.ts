import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { CandleBar, SignalRuntimeServices } from '../../types';
import { IndicatorSeriesService } from '../../IndicatorSeriesService';
import { smartTrailSwitchBlock } from './SmartTrailSwitchBlock';
import { confirmationTrendBlock } from './ConfirmationTrendBlock';
import { trendCatcherBlock } from './TrendCatcherBlock';

const runtimeServices = {
    indicatorSeries: new IndicatorSeriesService(),
    executionModel: {} as SignalRuntimeServices['executionModel'],
} as SignalRuntimeServices;

function makeBar(index: number, close: number, range = 1.5): CandleBar {
    return {
        time: new Date(Date.UTC(2026, 0, 1, 0, index)),
        symbol: 'XAUUSD',
        timeframe: 'M15',
        exchange: 'TEST',
        open: close - 0.4,
        high: close + range,
        low: close - range,
        close,
        volume: 1000,
        isClosed: true,
    };
}

function buildSeries(start: number, deltas: number[]): CandleBar[] {
    const closes: number[] = [start];
    for (const delta of deltas) {
        closes.push(Number((closes[closes.length - 1]! + delta).toFixed(4)));
    }
    return closes.map((close, index) => makeBar(index, close));
}

function findActiveIndex(
    bars: CandleBar[],
    evaluateAt: (index: number) => boolean,
): number {
    for (let index = 0; index < bars.length; index += 1) {
        if (evaluateAt(index)) {
            return index;
        }
    }
    return -1;
}

describe('custom XAU trend blocks', () => {
    it('detects bullish and bearish smart trail switches', () => {
        const bullishBars = buildSeries(100, [
            -1.5, -1.2, -1.1, -1.4, -1.2, -1.1, -0.9, -0.8,
            1.7, 1.9, 2.1, 2.2, 1.6, 1.4, 1.2, 1.1, 0.9, 0.8,
        ]);
        const bearishBars = buildSeries(100, [
            1.4, 1.1, 1.2, 1.4, 1.1, 0.9, 0.8, 0.7,
            -1.8, -1.9, -2.1, -2.2, -1.6, -1.3, -1.1, -0.9, -0.8, -0.7,
        ]);

        const bullishState = smartTrailSwitchBlock.initialize(
            bullishBars,
            { atrPeriod: 3, multiplier: 1.5 },
            runtimeServices,
        );
        const bearishState = smartTrailSwitchBlock.initialize(
            bearishBars,
            { atrPeriod: 3, multiplier: 1.5 },
            runtimeServices,
        );

        const bullishIndex = findActiveIndex(bullishBars, (index) => smartTrailSwitchBlock.evaluate(
            bullishBars[index]!,
            index > 0 ? bullishBars[index - 1]! : null,
            bullishBars,
            index,
            bullishState,
            { atrPeriod: 3, multiplier: 1.5 },
            'bullish_switch',
            {},
            runtimeServices,
        ).isActive);

        const bearishIndex = findActiveIndex(bearishBars, (index) => smartTrailSwitchBlock.evaluate(
            bearishBars[index]!,
            index > 0 ? bearishBars[index - 1]! : null,
            bearishBars,
            index,
            bearishState,
            { atrPeriod: 3, multiplier: 1.5 },
            'bearish_switch',
            {},
            runtimeServices,
        ).isActive);

        assert.ok(bullishIndex >= 0, 'expected at least one bullish smart trail switch');
        assert.ok(bearishIndex >= 0, 'expected at least one bearish smart trail switch');
    });

    it('confirms uptrend and downtrend using EMA alignment plus ADX', () => {
        const bullishBars = buildSeries(100, new Array(60).fill(0).map(() => 0.9));
        const bearishBars = buildSeries(160, new Array(60).fill(0).map(() => -0.9));

        const bullishState = confirmationTrendBlock.initialize(
            bullishBars,
            { fastPeriod: 5, slowPeriod: 12, adxPeriod: 5 },
            runtimeServices,
        );
        const bearishState = confirmationTrendBlock.initialize(
            bearishBars,
            { fastPeriod: 5, slowPeriod: 12, adxPeriod: 5 },
            runtimeServices,
        );

        const bullishResult = confirmationTrendBlock.evaluate(
            bullishBars[bullishBars.length - 1]!,
            bullishBars[bullishBars.length - 2]!,
            bullishBars,
            bullishBars.length - 1,
            bullishState,
            { fastPeriod: 5, slowPeriod: 12, adxPeriod: 5 },
            'confirmation_uptrend',
            { adxThreshold: 10 },
            runtimeServices,
        );
        const bearishResult = confirmationTrendBlock.evaluate(
            bearishBars[bearishBars.length - 1]!,
            bearishBars[bearishBars.length - 2]!,
            bearishBars,
            bearishBars.length - 1,
            bearishState,
            { fastPeriod: 5, slowPeriod: 12, adxPeriod: 5 },
            'confirmation_downtrend',
            { adxThreshold: 10 },
            runtimeServices,
        );

        assert.equal(bullishResult.isActive, true);
        assert.equal(bearishResult.isActive, true);
    });

    it('marks bullish and bearish trend catcher states', () => {
        const bullishBars = buildSeries(100, new Array(30).fill(0).map(() => 1.2));
        const bearishBars = buildSeries(160, new Array(30).fill(0).map(() => -1.2));

        const bullishState = trendCatcherBlock.initialize(
            bullishBars,
            { fastPeriod: 3, slowPeriod: 6, rsiPeriod: 5 },
            runtimeServices,
        );
        const bearishState = trendCatcherBlock.initialize(
            bearishBars,
            { fastPeriod: 3, slowPeriod: 6, rsiPeriod: 5 },
            runtimeServices,
        );

        const bullishResult = trendCatcherBlock.evaluate(
            bullishBars[bullishBars.length - 1]!,
            bullishBars[bullishBars.length - 2]!,
            bullishBars,
            bullishBars.length - 1,
            bullishState,
            { fastPeriod: 3, slowPeriod: 6, rsiPeriod: 5 },
            'trend_catcher_bullish',
            { rsiThreshold: 54 },
            runtimeServices,
        );
        const bearishResult = trendCatcherBlock.evaluate(
            bearishBars[bearishBars.length - 1]!,
            bearishBars[bearishBars.length - 2]!,
            bearishBars,
            bearishBars.length - 1,
            bearishState,
            { fastPeriod: 3, slowPeriod: 6, rsiPeriod: 5 },
            'trend_catcher_bearish',
            { rsiThreshold: 45 },
            runtimeServices,
        );

        assert.equal(bullishResult.isActive, true);
        assert.equal(bearishResult.isActive, true);
    });
});
