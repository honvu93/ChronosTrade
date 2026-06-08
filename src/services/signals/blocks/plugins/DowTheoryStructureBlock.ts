import { CandleBar, SignalRuntimeServices } from '../../types';
import {
    BlockEvaluateResult,
    BlockTraceValue,
    ConditionDef,
    FieldSchema,
    TechIndicatorBlock,
    TechIndicatorDefinition,
} from '../TechIndicatorBlock';
import { detectSwings } from '../utils/swingDetection';

interface DowTheoryStructureParams {
    swingStrength: number;
}

type TrendState = 'NEUTRAL' | 'UPTREND' | 'DOWNTREND';
type WarningState = 'NONE' | 'BULLISH' | 'BEARISH';

interface ConfirmedSwing {
    index: number;
    confirmIndex: number;
    price: number;
    type: 'HIGH' | 'LOW';
}

interface SwingReference {
    index: number;
    price: number;
}

interface DowTheoryStructureState {
    primaryUptrendConfirmedAt: boolean[];
    primaryDowntrendConfirmedAt: boolean[];
    bullishReversalWarningAt: boolean[];
    bearishReversalWarningAt: boolean[];
    bullishReversalConfirmedAt: boolean[];
    bearishReversalConfirmedAt: boolean[];
    trendStateByBar: TrendState[];
    warningStateByBar: WarningState[];
    lastConfirmedSwingHighByBar: Array<number | null>;
    lastConfirmedSwingLowByBar: Array<number | null>;
    lastReactionHighByBar: Array<number | null>;
    lastReactionLowByBar: Array<number | null>;
}

const CONFIRMATION_BASIS = 'close';

const paramSchema: FieldSchema[] = [
    {
        id: 'swingStrength',
        type: 'number',
        label: 'Swing Strength',
        default: 3,
        min: 1,
        max: 10,
        step: 1,
    },
];

const conditions: ConditionDef[] = [
    {
        id: 'primary_uptrend_confirmed',
        name: 'Primary uptrend confirmed',
        description: 'Confirmed swing highs and lows remain in an advancing primary uptrend.',
        paramSchema: [],
    },
    {
        id: 'primary_downtrend_confirmed',
        name: 'Primary downtrend confirmed',
        description: 'Confirmed swing highs and lows remain in a declining primary downtrend.',
        paramSchema: [],
    },
    {
        id: 'bullish_reversal_warning',
        name: 'Bullish reversal warning',
        description: 'A downtrend shows higher-low non-confirmation, but no close has confirmed the reversal yet.',
        paramSchema: [],
    },
    {
        id: 'bearish_reversal_warning',
        name: 'Bearish reversal warning',
        description: 'An uptrend shows lower-high non-confirmation, but no close has confirmed the reversal yet.',
        paramSchema: [],
    },
    {
        id: 'bullish_reversal_confirmed',
        name: 'Bullish reversal confirmed',
        description: 'Price closes above the active reaction high, confirming an upside reversal.',
        paramSchema: [],
    },
    {
        id: 'bearish_reversal_confirmed',
        name: 'Bearish reversal confirmed',
        description: 'Price closes below the active reaction low, confirming a downside reversal.',
        paramSchema: [],
    },
];

const definition: TechIndicatorDefinition = {
    id: 'DOW_THEORY_STRUCTURE',
    name: 'Dow Theory Structure (Single-Asset MVP)',
    category: 'structure',
    description:
        'Tracks single-asset Dow Theory structure using confirmed swing highs/lows, reaction levels, warnings, and close-based reversal confirmation.',
    paramSchema,
    conditions,
};

function buildConfirmedSwings(bars: CandleBar[], strength: number): ConfirmedSwing[] {
    const { highs, lows } = detectSwings(bars, strength);
    const confirmedSwings = [
        ...highs.map<ConfirmedSwing>((index) => ({
            index,
            confirmIndex: index + strength,
            price: bars[index].high,
            type: 'HIGH',
        })),
        ...lows.map<ConfirmedSwing>((index) => ({
            index,
            confirmIndex: index + strength,
            price: bars[index].low,
            type: 'LOW',
        })),
    ].filter((swing) => swing.confirmIndex < bars.length);

    return confirmedSwings.sort((left, right) => (
        left.confirmIndex - right.confirmIndex
        || left.index - right.index
        || left.type.localeCompare(right.type)
    ));
}

function toSwingReference(swing: ConfirmedSwing | null): SwingReference | null {
    if (!swing) {
        return null;
    }

    return {
        index: swing.index,
        price: swing.price,
    };
}

function getTraceValues(state: DowTheoryStructureState, index: number): Record<string, BlockTraceValue> {
    return {
        trendState: state.trendStateByBar[index] ?? 'NEUTRAL',
        warningState: state.warningStateByBar[index] ?? 'NONE',
        lastConfirmedSwingHigh: state.lastConfirmedSwingHighByBar[index] ?? null,
        lastConfirmedSwingLow: state.lastConfirmedSwingLowByBar[index] ?? null,
        lastReactionHigh: state.lastReactionHighByBar[index] ?? null,
        lastReactionLow: state.lastReactionLowByBar[index] ?? null,
        confirmationBasis: CONFIRMATION_BASIS,
    };
}

export const dowTheoryStructureBlock: TechIndicatorBlock<DowTheoryStructureParams, DowTheoryStructureState> = {
    definition,

    initialize(
        bars: CandleBar[],
        params: DowTheoryStructureParams,
        _services: SignalRuntimeServices,
    ): DowTheoryStructureState {
        const strength = Math.max(1, params.swingStrength ?? 3);
        const swings = buildConfirmedSwings(bars, strength);
        const n = bars.length;

        const state: DowTheoryStructureState = {
            primaryUptrendConfirmedAt: new Array(n).fill(false),
            primaryDowntrendConfirmedAt: new Array(n).fill(false),
            bullishReversalWarningAt: new Array(n).fill(false),
            bearishReversalWarningAt: new Array(n).fill(false),
            bullishReversalConfirmedAt: new Array(n).fill(false),
            bearishReversalConfirmedAt: new Array(n).fill(false),
            trendStateByBar: new Array(n).fill('NEUTRAL'),
            warningStateByBar: new Array(n).fill('NONE'),
            lastConfirmedSwingHighByBar: new Array(n).fill(null),
            lastConfirmedSwingLowByBar: new Array(n).fill(null),
            lastReactionHighByBar: new Array(n).fill(null),
            lastReactionLowByBar: new Array(n).fill(null),
        };

        let trendState: TrendState = 'NEUTRAL';
        let warningState: WarningState = 'NONE';
        let swingCursor = 0;

        let previousHigh: ConfirmedSwing | null = null;
        let lastHigh: ConfirmedSwing | null = null;
        let previousLow: ConfirmedSwing | null = null;
        let lastLow: ConfirmedSwing | null = null;

        let uptrendReactionLow: SwingReference | null = null;
        let downtrendReactionHigh: SwingReference | null = null;
        let pendingBearishReactionLow: SwingReference | null = null;
        let pendingBullishReactionHigh: SwingReference | null = null;

        for (let i = 0; i < n; i++) {
            while (swingCursor < swings.length && swings[swingCursor]?.confirmIndex === i) {
                const swing = swings[swingCursor]!;

                if (swing.type === 'HIGH') {
                    previousHigh = lastHigh;
                    lastHigh = swing;

                    if (trendState === 'UPTREND' && previousHigh) {
                        if (swing.price < previousHigh.price) {
                            warningState = 'BEARISH';
                            pendingBearishReactionLow = toSwingReference(lastLow);
                        } else if (swing.price > previousHigh.price) {
                            uptrendReactionLow = toSwingReference(lastLow);
                            warningState = 'NONE';
                            pendingBearishReactionLow = null;
                        }
                    }

                    if (trendState === 'DOWNTREND' && previousHigh && swing.price < previousHigh.price) {
                        downtrendReactionHigh = toSwingReference(lastHigh);
                        warningState = 'NONE';
                        pendingBullishReactionHigh = null;
                    }
                } else {
                    previousLow = lastLow;
                    lastLow = swing;

                    if (trendState === 'DOWNTREND' && previousLow) {
                        if (swing.price > previousLow.price) {
                            warningState = 'BULLISH';
                            pendingBullishReactionHigh = toSwingReference(lastHigh);
                        } else if (swing.price < previousLow.price) {
                            downtrendReactionHigh = toSwingReference(lastHigh);
                            warningState = 'NONE';
                            pendingBullishReactionHigh = null;
                        }
                    }

                    if (trendState === 'UPTREND' && previousLow && swing.price > previousLow.price) {
                        uptrendReactionLow = toSwingReference(lastLow);
                    }
                }

                swingCursor += 1;
            }

            if (trendState === 'NEUTRAL' && previousHigh && lastHigh && previousLow && lastLow) {
                const higherHigh = lastHigh.price > previousHigh.price;
                const lowerHigh = lastHigh.price < previousHigh.price;
                const higherLow = lastLow.price > previousLow.price;
                const lowerLow = lastLow.price < previousLow.price;

                if (higherHigh && higherLow) {
                    trendState = 'UPTREND';
                    warningState = 'NONE';
                    uptrendReactionLow = toSwingReference(lastLow);
                    pendingBearishReactionLow = null;
                    pendingBullishReactionHigh = null;
                } else if (lowerHigh && lowerLow) {
                    trendState = 'DOWNTREND';
                    warningState = 'NONE';
                    downtrendReactionHigh = toSwingReference(lastHigh);
                    pendingBearishReactionLow = null;
                    pendingBullishReactionHigh = null;
                }
            }

            if (trendState === 'UPTREND') {
                const reactionLow = pendingBearishReactionLow ?? uptrendReactionLow;
                if (reactionLow && bars[i].close < reactionLow.price) {
                    state.bearishReversalConfirmedAt[i] = true;
                    trendState = 'DOWNTREND';
                    warningState = 'NONE';
                    downtrendReactionHigh = toSwingReference(lastHigh);
                    pendingBearishReactionLow = null;
                    pendingBullishReactionHigh = null;
                }
            } else if (trendState === 'DOWNTREND') {
                const reactionHigh = pendingBullishReactionHigh ?? downtrendReactionHigh;
                if (reactionHigh && bars[i].close > reactionHigh.price) {
                    state.bullishReversalConfirmedAt[i] = true;
                    trendState = 'UPTREND';
                    warningState = 'NONE';
                    uptrendReactionLow = toSwingReference(lastLow);
                    pendingBearishReactionLow = null;
                    pendingBullishReactionHigh = null;
                }
            }

            state.primaryUptrendConfirmedAt[i] = trendState === 'UPTREND';
            state.primaryDowntrendConfirmedAt[i] = trendState === 'DOWNTREND';
            state.bullishReversalWarningAt[i] = warningState === 'BULLISH';
            state.bearishReversalWarningAt[i] = warningState === 'BEARISH';
            state.trendStateByBar[i] = trendState;
            state.warningStateByBar[i] = warningState;
            state.lastConfirmedSwingHighByBar[i] = lastHigh?.price ?? null;
            state.lastConfirmedSwingLowByBar[i] = lastLow?.price ?? null;
            state.lastReactionHighByBar[i] = (pendingBullishReactionHigh ?? downtrendReactionHigh)?.price ?? null;
            state.lastReactionLowByBar[i] = (pendingBearishReactionLow ?? uptrendReactionLow)?.price ?? null;
        }

        return state;
    },

    evaluate(
        _bar: CandleBar,
        _prevBar: CandleBar | null,
        _allBars: CandleBar[],
        index: number,
        state: DowTheoryStructureState,
        _params: DowTheoryStructureParams,
        conditionId: string,
        _conditionParams: Record<string, unknown>,
        _services: SignalRuntimeServices,
    ): BlockEvaluateResult<DowTheoryStructureState> {
        const values = getTraceValues(state, index);

        let isActive = false;
        switch (conditionId) {
            case 'primary_uptrend_confirmed':
                isActive = state.primaryUptrendConfirmedAt[index] ?? false;
                break;
            case 'primary_downtrend_confirmed':
                isActive = state.primaryDowntrendConfirmedAt[index] ?? false;
                break;
            case 'bullish_reversal_warning':
                isActive = state.bullishReversalWarningAt[index] ?? false;
                break;
            case 'bearish_reversal_warning':
                isActive = state.bearishReversalWarningAt[index] ?? false;
                break;
            case 'bullish_reversal_confirmed':
                isActive = state.bullishReversalConfirmedAt[index] ?? false;
                break;
            case 'bearish_reversal_confirmed':
                isActive = state.bearishReversalConfirmedAt[index] ?? false;
                break;
            default:
                isActive = false;
                break;
        }

        return {
            state,
            isActive,
            values,
        };
    },
};
