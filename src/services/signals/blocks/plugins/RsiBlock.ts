import { CandleBar, SignalRuntimeServices } from '../../types';
import {
    BlockEvaluateResult,
    ConditionDef,
    FieldSchema,
    TechIndicatorBlock,
    TechIndicatorDefinition,
} from '../TechIndicatorBlock';
import { detectSwings } from '../utils/swingDetection';

// â”€â”€â”€ Params & State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface RsiParams {
    period: number;
}

interface RsiState {
    /** RSI values aligned to allBars indices. null where not yet calculable. */
    rsiValues: (number | null)[];
    /** Cache for RSI EMAs: keyed by emaPeriod */
    rsiEmaCache: Record<number, (number | null)[]>;
    /** Precomputed swing low indices for divergence detection */
    swingLowIndices: number[];
    /** Precomputed swing high indices for divergence detection */
    swingHighIndices: number[];
}

// â”€â”€â”€ Schema â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const paramSchema: FieldSchema[] = [
    {
        id: 'period',
        type: 'number',
        label: 'RSI Period',
        default: 14,
        min: 2,
        max: 100,
        step: 1,
    },
];

const conditions: ConditionDef[] = [
    {
        id: 'value_above',
        name: 'Value above threshold',
        description: 'RSI is above the configured threshold.',
        paramSchema: [
            { id: 'threshold', type: 'number', label: 'Threshold', default: 70, min: 0, max: 100, step: 0.5 },
        ],
    },
    {
        id: 'value_below',
        name: 'Value below threshold',
        description: 'RSI is below the configured threshold.',
        paramSchema: [
            { id: 'threshold', type: 'number', label: 'Threshold', default: 30, min: 0, max: 100, step: 0.5 },
        ],
    },
    {
        id: 'crosses_above',
        name: 'Crosses above threshold',
        description: 'RSI crosses above the threshold from below (previous bar < threshold, current bar > threshold).',
        paramSchema: [
            { id: 'threshold', type: 'number', label: 'Threshold', default: 50, min: 0, max: 100, step: 0.5 },
        ],
    },
    {
        id: 'crosses_below',
        name: 'Crosses below threshold',
        description: 'RSI crosses below the threshold from above (previous bar > threshold, current bar < threshold).',
        paramSchema: [
            { id: 'threshold', type: 'number', label: 'Threshold', default: 50, min: 0, max: 100, step: 0.5 },
        ],
    },
    {
        id: 'divergence_bullish',
        name: 'Bullish divergence',
        description: 'Two consecutive swing lows where price makes a lower low but RSI makes a higher low, suggesting bullish reversal.',
        paramSchema: [
            { id: 'lookback', type: 'number', label: 'Lookback (bars)', default: 20, min: 5, max: 100, step: 1 },
        ],
    },
    {
        id: 'divergence_bearish',
        name: 'Bearish divergence',
        description: 'Two consecutive swing highs where price makes a higher high but RSI makes a lower high, suggesting bearish reversal.',
        paramSchema: [
            { id: 'lookback', type: 'number', label: 'Lookback (bars)', default: 20, min: 5, max: 100, step: 1 },
        ],
    },
    {
        id: 'crosses_above_ema',
        name: 'Crosses above RSI EMA',
        description: 'RSI crosses above its own EMA line (default period 9).',
        paramSchema: [
            { id: 'emaPeriod', type: 'number', label: 'EMA Period', default: 9, min: 2, max: 50, step: 1 },
        ],
    },
];

// â”€â”€â”€ Definition â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const definition: TechIndicatorDefinition = {
    id: 'RSI',
    name: 'Relative Strength Index (RSI)',
    category: 'momentum',
    description:
        'Measures the speed and magnitude of price changes. Commonly used to identify overbought (>70) and oversold (<30) zones.',
    paramSchema,
    conditions,
};

// â”€â”€â”€ Block Implementation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const rsiBlock: TechIndicatorBlock<RsiParams, RsiState> = {
    definition,

    initialize(bars: CandleBar[], params: RsiParams, services: SignalRuntimeServices): RsiState {
        const period = Math.max(2, params.period ?? 14);
        const raw = services.indicatorSeries.calculateRSIFromCandles(bars, period);
        const aligned = services.indicatorSeries.alignPointsToBars(bars, raw);
        const swings = detectSwings(bars, 2);
        return {
            rsiValues: aligned.map(p => p.value),
            rsiEmaCache: {},
            swingLowIndices: swings.lows,
            swingHighIndices: swings.highs,
        };
    },

    evaluate(
        bar: CandleBar,
        _prevBar: CandleBar | null,
        allBars: CandleBar[],
        index: number,
        state: RsiState,
        _params: RsiParams,
        conditionId: string,
        conditionParams: Record<string, unknown>,
        services: SignalRuntimeServices,
    ): BlockEvaluateResult<RsiState> {
        const current = state.rsiValues[index] ?? null;
        const prev = index > 0 ? (state.rsiValues[index - 1] ?? null) : null;
        const values: Record<string, number | null> = { rsi: current, prevRsi: prev };
        let nextState = state;

        // Not enough data yet
        if (current === null) {
            return { state, isActive: false, values };
        }

        let isActive = false;

        switch (conditionId) {
            case 'value_above': {
                const threshold = Number(conditionParams['threshold'] ?? 70);
                isActive = current > threshold;
                break;
            }
            case 'value_below': {
                const threshold = Number(conditionParams['threshold'] ?? 30);
                isActive = current < threshold;
                break;
            }
            case 'crosses_above': {
                const threshold = Number(conditionParams['threshold'] ?? 50);
                isActive = prev !== null && prev <= threshold && current > threshold;
                break;
            }
            case 'crosses_below': {
                const threshold = Number(conditionParams['threshold'] ?? 50);
                isActive = prev !== null && prev >= threshold && current < threshold;
                break;
            }
            case 'divergence_bullish': {
                // Bullish divergence: two consecutive swing lows where price makes a
                // lower low but RSI makes a higher low. The second swing low must be
                // within `lookback` bars of the current bar.
                const lookback = Math.max(2, Number(conditionParams['lookback'] ?? 20));
                const swingLows = state.swingLowIndices;

                // Find the two most recent swing lows within lookback range
                let recentIdx = -1;
                for (let k = swingLows.length - 1; k >= 0; k--) {
                    if (swingLows[k]! <= index && index - swingLows[k]! <= lookback) {
                        recentIdx = k;
                        break;
                    }
                }

                if (recentIdx >= 1) {
                    const sl2 = swingLows[recentIdx]!;   // more recent swing low
                    const sl1 = swingLows[recentIdx - 1]!; // older swing low
                    const rsi1 = state.rsiValues[sl1];
                    const rsi2 = state.rsiValues[sl2];

                    if (rsi1 !== null && rsi2 !== null) {
                        // Price: lower low, RSI: higher low
                        isActive = allBars[sl2]!.low < allBars[sl1]!.low && rsi2 > rsi1;
                    }
                }
                break;
            }
            case 'divergence_bearish': {
                // Bearish divergence: two consecutive swing highs where price makes a
                // higher high but RSI makes a lower high. The second swing high must be
                // within `lookback` bars of the current bar.
                const lookback = Math.max(2, Number(conditionParams['lookback'] ?? 20));
                const swingHighs = state.swingHighIndices;

                let recentIdx = -1;
                for (let k = swingHighs.length - 1; k >= 0; k--) {
                    if (swingHighs[k]! <= index && index - swingHighs[k]! <= lookback) {
                        recentIdx = k;
                        break;
                    }
                }

                if (recentIdx >= 1) {
                    const sh2 = swingHighs[recentIdx]!;   // more recent swing high
                    const sh1 = swingHighs[recentIdx - 1]!; // older swing high
                    const rsi1 = state.rsiValues[sh1];
                    const rsi2 = state.rsiValues[sh2];

                    if (rsi1 !== null && rsi2 !== null) {
                        // Price: higher high, RSI: lower high
                        isActive = allBars[sh2]!.high > allBars[sh1]!.high && rsi2 < rsi1;
                    }
                }
                break;
            }
            case 'crosses_above_ema': {
                const emaPeriod = Math.max(2, Number(conditionParams['emaPeriod'] ?? 9));

                if (!nextState.rsiEmaCache[emaPeriod]) {
                    const rsiSeries = state.rsiValues.flatMap((value, seriesIndex) => (
                        value === null ? [] : [{ time: allBars[seriesIndex].time, value }]
                    ));
                    const rsiEmaRaw = services.indicatorSeries.calculateEMA(rsiSeries, emaPeriod);
                    const rsiEmaPoints = services.indicatorSeries.alignPointsToBars(allBars, rsiEmaRaw);
                    nextState = {
                        ...state,
                        rsiEmaCache: {
                            ...state.rsiEmaCache,
                            [emaPeriod]: rsiEmaPoints.map(p => p.value),
                        },
                    };
                }

                const rsiEmaValues = nextState.rsiEmaCache[emaPeriod];
                const currentEma = rsiEmaValues[index] ?? null;
                const prevEma = index > 0 ? (rsiEmaValues[index - 1] ?? null) : null;

                if (currentEma !== null) {
                    values['rsiEma'] = currentEma;
                }
                if (currentEma !== null && prevEma !== null && prev !== null) {
                    isActive = prev <= prevEma && current > currentEma;
                }
                break;
            }
            default:
                break;
        }

        return { state: nextState, isActive, values };
    },
};
