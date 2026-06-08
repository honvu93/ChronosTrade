import { CandleBar, SignalRuntimeServices } from '../../types';
import {
    BlockEvaluateResult,
    ConditionDef,
    FieldSchema,
    TechIndicatorBlock,
    TechIndicatorDefinition,
} from '../TechIndicatorBlock';

// â”€â”€â”€ Params & State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface EmaCrossParams {
    fastPeriod: number;
    slowPeriod: number;
}

interface EmaCrossState {
    /** Fast EMA values aligned to allBars indices. null where not yet calculable. */
    fastEmaValues: (number | null)[];
    /** Slow EMA values aligned to allBars indices. null where not yet calculable. */
    slowEmaValues: (number | null)[];
}

// â”€â”€â”€ Schema â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const paramSchema: FieldSchema[] = [
    {
        id: 'fastPeriod',
        type: 'number',
        label: 'Fast EMA Period',
        default: 9,
        min: 2,
        max: 200,
        step: 1,
    },
    {
        id: 'slowPeriod',
        type: 'number',
        label: 'Slow EMA Period',
        default: 21,
        min: 2,
        max: 500,
        step: 1,
    },
];

const conditions: ConditionDef[] = [
    {
        id: 'price_above_ema',
        name: 'Price above fast EMA',
        description: 'Close is above the fast EMA (fastPeriod), confirming bullish direction.',
        paramSchema: [],
    },
    {
        id: 'price_below_ema',
        name: 'Price below fast EMA',
        description: 'Close is below the fast EMA (fastPeriod), confirming bearish direction.',
        paramSchema: [],
    },
    {
        id: 'fast_crosses_above',
        name: 'Golden Cross (Fast crosses above Slow)',
        description: 'Fast EMA crosses above Slow EMA, signaling a potential bullish trend transition.',
        paramSchema: [],
    },
    {
        id: 'fast_crosses_below',
        name: 'Death Cross (Fast crosses below Slow)',
        description: 'Fast EMA crosses below Slow EMA, signaling a potential bearish trend transition.',
        paramSchema: [],
    },
];

// â”€â”€â”€ Definition â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const definition: TechIndicatorDefinition = {
    id: 'EMA_CROSS',
    name: 'EMA Crossover',
    category: 'trend',
    description:
        'Tracks the crossover between fast and slow EMA lines. Golden Cross and Death Cross are common trend-transition signals.',
    paramSchema,
    conditions,
};

// â”€â”€â”€ Block Implementation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const emaCrossBlock: TechIndicatorBlock<EmaCrossParams, EmaCrossState> = {
    definition,

    initialize(bars: CandleBar[], params: EmaCrossParams, services: SignalRuntimeServices): EmaCrossState {
        const fastPeriod = Math.max(2, params.fastPeriod ?? 9);
        const slowPeriod = Math.max(fastPeriod + 1, params.slowPeriod ?? 21);

        const closeSeries = bars.map(b => ({ time: b.time, value: b.close }));

        const rawFast = services.indicatorSeries.calculateEMA(closeSeries, fastPeriod);
        const rawSlow = services.indicatorSeries.calculateEMA(closeSeries, slowPeriod);

        const alignedFast = services.indicatorSeries.alignPointsToBars(bars, rawFast);
        const alignedSlow = services.indicatorSeries.alignPointsToBars(bars, rawSlow);

        return {
            fastEmaValues: alignedFast.map(p => p.value),
            slowEmaValues: alignedSlow.map(p => p.value),
        };
    },

    evaluate(
        bar: CandleBar,
        _prevBar: CandleBar | null,
        _allBars: CandleBar[],
        index: number,
        state: EmaCrossState,
        _params: EmaCrossParams,
        conditionId: string,
        _conditionParams: Record<string, unknown>,
        _services: SignalRuntimeServices,
    ): BlockEvaluateResult<EmaCrossState> {
        const fastCurrent = state.fastEmaValues[index] ?? null;
        const slowCurrent = state.slowEmaValues[index] ?? null;
        const fastPrev = index > 0 ? (state.fastEmaValues[index - 1] ?? null) : null;
        const slowPrev = index > 0 ? (state.slowEmaValues[index - 1] ?? null) : null;

        const values: Record<string, number | null> = {
            fastEma: fastCurrent,
            slowEma: slowCurrent,
            prevFastEma: fastPrev,
            prevSlowEma: slowPrev,
        };

        if (fastCurrent === null) {
            return { state, isActive: false, values };
        }

        let isActive = false;

        switch (conditionId) {
            case 'price_above_ema':
                isActive = bar.close > fastCurrent;
                break;

            case 'price_below_ema':
                isActive = bar.close < fastCurrent;
                break;

            case 'fast_crosses_above':
                if (fastPrev !== null && slowPrev !== null && slowCurrent !== null) {
                    isActive = fastPrev <= slowPrev && fastCurrent > slowCurrent;
                }
                break;

            case 'fast_crosses_below':
                if (fastPrev !== null && slowPrev !== null && slowCurrent !== null) {
                    isActive = fastPrev >= slowPrev && fastCurrent < slowCurrent;
                }
                break;

            default:
                break;
        }

        return { state, isActive, values };
    },
};
