import { CandleBar, SignalRuntimeServices } from '../../types';
import {
    BlockEvaluateResult,
    ConditionDef,
    FieldSchema,
    TechIndicatorBlock,
    TechIndicatorDefinition,
} from '../TechIndicatorBlock';

interface SmartTrailSwitchParams {
    atrPeriod: number;
    multiplier: number;
}

interface SmartTrailSwitchState {
    trailLineValues: (number | null)[];
    upperBandValues: (number | null)[];
    lowerBandValues: (number | null)[];
    trendStateValues: (number | null)[];
}

const paramSchema: FieldSchema[] = [
    { id: 'atrPeriod', type: 'number', label: 'ATR Period', default: 10, min: 2, max: 100, step: 1 },
    { id: 'multiplier', type: 'number', label: 'ATR Multiplier', default: 3, min: 0.5, max: 10, step: 0.1 },
];

const conditions: ConditionDef[] = [
    {
        id: 'bullish_switch',
        name: 'Bullish Smart Trail Switch',
        description: 'The trail flips from bearish to bullish on the current bar.',
        paramSchema: [],
    },
    {
        id: 'bearish_switch',
        name: 'Bearish Smart Trail Switch',
        description: 'The trail flips from bullish to bearish on the current bar.',
        paramSchema: [],
    },
    {
        id: 'bullish_state',
        name: 'Bullish Smart Trail State',
        description: 'The trail is currently in bullish mode.',
        paramSchema: [],
    },
    {
        id: 'bearish_state',
        name: 'Bearish Smart Trail State',
        description: 'The trail is currently in bearish mode.',
        paramSchema: [],
    },
];

const definition: TechIndicatorDefinition = {
    id: 'SMART_TRAIL_SWITCH',
    name: 'Smart Trail Switch',
    category: 'trend',
    description: 'ATR-based trail that flips bias when price closes through the adaptive trend line.',
    paramSchema,
    conditions,
};

export const smartTrailSwitchBlock: TechIndicatorBlock<SmartTrailSwitchParams, SmartTrailSwitchState> = {
    definition,

    initialize(bars: CandleBar[], params: SmartTrailSwitchParams, services: SignalRuntimeServices): SmartTrailSwitchState {
        const atrPeriod = Math.max(2, Number(params.atrPeriod ?? 10));
        const multiplier = Math.max(0.1, Number(params.multiplier ?? 3));
        const atrRaw = services.indicatorSeries.calculateATR(bars, atrPeriod);
        const atrAligned = services.indicatorSeries.alignPointsToBars(bars, atrRaw).map((point) => point.value);

        const trailLineValues = new Array<number | null>(bars.length).fill(null);
        const upperBandValues = new Array<number | null>(bars.length).fill(null);
        const lowerBandValues = new Array<number | null>(bars.length).fill(null);
        const trendStateValues = new Array<number | null>(bars.length).fill(null);

        let previousUpper: number | null = null;
        let previousLower: number | null = null;
        let previousTrend: number | null = null;

        for (let index = 0; index < bars.length; index += 1) {
            const atr = atrAligned[index];
            if (atr === null) {
                continue;
            }

            const hl2 = (bars[index].high + bars[index].low) / 2;
            const basicUpper = hl2 + atr * multiplier;
            const basicLower = hl2 - atr * multiplier;
            const prevClose = index > 0 ? bars[index - 1].close : bars[index].close;

            const currentUpper: number = previousUpper === null || prevClose > previousUpper
                ? basicUpper
                : Math.min(basicUpper, previousUpper);
            const currentLower: number = previousLower === null || prevClose < previousLower
                ? basicLower
                : Math.max(basicLower, previousLower);

            const currentTrend: number = previousTrend === null
                ? (bars[index].close >= hl2 ? 1 : -1)
                : previousTrend === 1
                    ? (bars[index].close < currentLower ? -1 : 1)
                    : (bars[index].close > currentUpper ? 1 : -1);

            upperBandValues[index] = Number(currentUpper.toFixed(8));
            lowerBandValues[index] = Number(currentLower.toFixed(8));
            trendStateValues[index] = currentTrend;
            trailLineValues[index] = Number((currentTrend === 1 ? currentLower : currentUpper).toFixed(8));

            previousUpper = currentUpper;
            previousLower = currentLower;
            previousTrend = currentTrend;
        }

        return {
            trailLineValues,
            upperBandValues,
            lowerBandValues,
            trendStateValues,
        };
    },

    evaluate(
        _bar: CandleBar,
        _prevBar: CandleBar | null,
        _allBars: CandleBar[],
        index: number,
        state: SmartTrailSwitchState,
        _params: SmartTrailSwitchParams,
        conditionId: string,
    ): BlockEvaluateResult<SmartTrailSwitchState> {
        const trend = state.trendStateValues[index];
        const previousTrend = index > 0 ? state.trendStateValues[index - 1] : null;
        const values: Record<string, number | null> = {
            trailLine: state.trailLineValues[index],
            upperBand: state.upperBandValues[index],
            lowerBand: state.lowerBandValues[index],
            trendState: trend,
            prevTrendState: previousTrend,
        };

        if (trend === null) {
            return { state, isActive: false, values };
        }

        let isActive = false;
        switch (conditionId) {
            case 'bullish_switch':
                isActive = trend === 1 && previousTrend === -1;
                break;
            case 'bearish_switch':
                isActive = trend === -1 && previousTrend === 1;
                break;
            case 'bullish_state':
                isActive = trend === 1;
                break;
            case 'bearish_state':
                isActive = trend === -1;
                break;
            default:
                break;
        }

        return { state, isActive, values };
    },
};
