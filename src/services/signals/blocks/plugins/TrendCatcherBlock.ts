import { CandleBar, SignalRuntimeServices } from '../../types';
import {
    BlockEvaluateResult,
    ConditionDef,
    FieldSchema,
    TechIndicatorBlock,
    TechIndicatorDefinition,
} from '../TechIndicatorBlock';

interface TrendCatcherParams {
    fastPeriod: number;
    slowPeriod: number;
    rsiPeriod: number;
}

interface TrendCatcherState {
    fastEmaValues: (number | null)[];
    slowEmaValues: (number | null)[];
    rsiValues: (number | null)[];
}

const paramSchema: FieldSchema[] = [
    { id: 'fastPeriod', type: 'number', label: 'Fast EMA Period', default: 10, min: 2, max: 100, step: 1 },
    { id: 'slowPeriod', type: 'number', label: 'Slow EMA Period', default: 20, min: 3, max: 200, step: 1 },
    { id: 'rsiPeriod', type: 'number', label: 'RSI Period', default: 14, min: 2, max: 100, step: 1 },
];

const conditions: ConditionDef[] = [
    {
        id: 'trend_catcher_bullish',
        name: 'Trend Catcher Bullish',
        description: 'Short-term trend catcher is bullish: price and momentum are aligned upward.',
        paramSchema: [
            { id: 'rsiThreshold', type: 'number', label: 'RSI Threshold', default: 55, min: 0, max: 100, step: 0.5 },
        ],
    },
    {
        id: 'trend_catcher_bearish',
        name: 'Trend Catcher Bearish',
        description: 'Short-term trend catcher is bearish: price and momentum are aligned downward.',
        paramSchema: [
            { id: 'rsiThreshold', type: 'number', label: 'RSI Threshold', default: 45, min: 0, max: 100, step: 0.5 },
        ],
    },
];

const definition: TechIndicatorDefinition = {
    id: 'TREND_CATCHER',
    name: 'Trend Catcher',
    category: 'trend',
    description: 'Short-horizon EMA and RSI state used to detect pullbacks or countertrend pockets inside a larger move.',
    paramSchema,
    conditions,
};

export const trendCatcherBlock: TechIndicatorBlock<TrendCatcherParams, TrendCatcherState> = {
    definition,

    initialize(bars: CandleBar[], params: TrendCatcherParams, services: SignalRuntimeServices): TrendCatcherState {
        const fastPeriod = Math.max(2, Number(params.fastPeriod ?? 10));
        const slowPeriod = Math.max(fastPeriod + 1, Number(params.slowPeriod ?? 20));
        const rsiPeriod = Math.max(2, Number(params.rsiPeriod ?? 14));

        return {
            fastEmaValues: services.indicatorSeries.alignPointsToBars(
                bars,
                services.indicatorSeries.calculateEMAFromCandles(bars, fastPeriod),
            ).map((point) => point.value),
            slowEmaValues: services.indicatorSeries.alignPointsToBars(
                bars,
                services.indicatorSeries.calculateEMAFromCandles(bars, slowPeriod),
            ).map((point) => point.value),
            rsiValues: services.indicatorSeries.alignPointsToBars(
                bars,
                services.indicatorSeries.calculateRSIFromCandles(bars, rsiPeriod),
            ).map((point) => point.value),
        };
    },

    evaluate(
        bar: CandleBar,
        _prevBar: CandleBar | null,
        _allBars: CandleBar[],
        index: number,
        state: TrendCatcherState,
        _params: TrendCatcherParams,
        conditionId: string,
        conditionParams: Record<string, unknown>,
    ): BlockEvaluateResult<TrendCatcherState> {
        const fastEma = state.fastEmaValues[index];
        const slowEma = state.slowEmaValues[index];
        const rsi = state.rsiValues[index];
        const values: Record<string, number | null> = { fastEma, slowEma, rsi };

        if (fastEma === null || slowEma === null || rsi === null) {
            return { state, isActive: false, values };
        }

        let isActive = false;
        switch (conditionId) {
            case 'trend_catcher_bullish': {
                const threshold = Number(conditionParams['rsiThreshold'] ?? 55);
                isActive = bar.close > fastEma && fastEma > slowEma && rsi >= threshold;
                break;
            }
            case 'trend_catcher_bearish': {
                const threshold = Number(conditionParams['rsiThreshold'] ?? 45);
                isActive = bar.close < fastEma && fastEma < slowEma && rsi <= threshold;
                break;
            }
            default:
                break;
        }

        return { state, isActive, values };
    },
};
