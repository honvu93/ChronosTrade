import { CandleBar, SignalRuntimeServices } from '../../types';
import {
    BlockEvaluateResult,
    ConditionDef,
    FieldSchema,
    TechIndicatorBlock,
    TechIndicatorDefinition,
} from '../TechIndicatorBlock';

interface ConfirmationTrendParams {
    fastPeriod: number;
    slowPeriod: number;
    adxPeriod: number;
}

interface ConfirmationTrendState {
    fastEmaValues: (number | null)[];
    slowEmaValues: (number | null)[];
    adxValues: (number | null)[];
}

const paramSchema: FieldSchema[] = [
    { id: 'fastPeriod', type: 'number', label: 'Fast EMA Period', default: 50, min: 2, max: 300, step: 1 },
    { id: 'slowPeriod', type: 'number', label: 'Slow EMA Period', default: 200, min: 5, max: 500, step: 1 },
    { id: 'adxPeriod', type: 'number', label: 'ADX Period', default: 14, min: 2, max: 100, step: 1 },
];

const conditions: ConditionDef[] = [
    {
        id: 'confirmation_uptrend',
        name: 'Confirmation Uptrend',
        description: 'Price is above the slow EMA, fast EMA is above slow EMA, and ADX confirms trend strength.',
        paramSchema: [
            { id: 'adxThreshold', type: 'number', label: 'ADX Threshold', default: 20, min: 5, max: 60, step: 0.5 },
        ],
    },
    {
        id: 'confirmation_downtrend',
        name: 'Confirmation Downtrend',
        description: 'Price is below the slow EMA, fast EMA is below slow EMA, and ADX confirms trend strength.',
        paramSchema: [
            { id: 'adxThreshold', type: 'number', label: 'ADX Threshold', default: 20, min: 5, max: 60, step: 0.5 },
        ],
    },
];

const definition: TechIndicatorDefinition = {
    id: 'CONFIRMATION_TREND',
    name: 'Confirmation Trend',
    category: 'trend',
    description: 'Higher-timeframe style trend confirmation using EMA alignment plus ADX strength.',
    paramSchema,
    conditions,
};

export const confirmationTrendBlock: TechIndicatorBlock<ConfirmationTrendParams, ConfirmationTrendState> = {
    definition,

    initialize(bars: CandleBar[], params: ConfirmationTrendParams, services: SignalRuntimeServices): ConfirmationTrendState {
        const fastPeriod = Math.max(2, Number(params.fastPeriod ?? 50));
        const slowPeriod = Math.max(fastPeriod + 1, Number(params.slowPeriod ?? 200));
        const adxPeriod = Math.max(2, Number(params.adxPeriod ?? 14));

        const fastEma = services.indicatorSeries.alignPointsToBars(
            bars,
            services.indicatorSeries.calculateEMAFromCandles(bars, fastPeriod),
        ).map((point) => point.value);
        const slowEma = services.indicatorSeries.alignPointsToBars(
            bars,
            services.indicatorSeries.calculateEMAFromCandles(bars, slowPeriod),
        ).map((point) => point.value);
        const adx = services.indicatorSeries.alignPointsToBars(
            bars,
            services.indicatorSeries.calculateADX(bars, adxPeriod),
        ).map((point) => point.value);

        return {
            fastEmaValues: fastEma,
            slowEmaValues: slowEma,
            adxValues: adx,
        };
    },

    evaluate(
        bar: CandleBar,
        _prevBar: CandleBar | null,
        _allBars: CandleBar[],
        index: number,
        state: ConfirmationTrendState,
        _params: ConfirmationTrendParams,
        conditionId: string,
        conditionParams: Record<string, unknown>,
    ): BlockEvaluateResult<ConfirmationTrendState> {
        const fastEma = state.fastEmaValues[index];
        const slowEma = state.slowEmaValues[index];
        const adx = state.adxValues[index];
        const values: Record<string, number | null> = { fastEma, slowEma, adx };

        if (fastEma === null || slowEma === null || adx === null) {
            return { state, isActive: false, values };
        }

        const adxThreshold = Number(conditionParams['adxThreshold'] ?? 20);
        let isActive = false;

        switch (conditionId) {
            case 'confirmation_uptrend':
                isActive = bar.close > slowEma && fastEma > slowEma && adx >= adxThreshold;
                break;
            case 'confirmation_downtrend':
                isActive = bar.close < slowEma && fastEma < slowEma && adx >= adxThreshold;
                break;
            default:
                break;
        }

        return { state, isActive, values };
    },
};
