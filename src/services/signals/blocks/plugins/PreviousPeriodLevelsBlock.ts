import { CandleBar, SignalRuntimeServices } from '../../types';
import {
    BlockEvaluateResult,
    BlockTraceValue,
    ConditionDef,
    FieldSchema,
    TechIndicatorBlock,
    TechIndicatorDefinition,
} from '../TechIndicatorBlock';

interface PreviousPeriodLevelsState {
    touchesPreviousDayHighAt: boolean[];
    touchesPreviousDayLowAt: boolean[];
    closesAbovePreviousDayHighAt: boolean[];
    closesBelowPreviousDayLowAt: boolean[];
    closesAbovePreviousDayMidpointAt: boolean[];
    closesBelowPreviousDayMidpointAt: boolean[];
    bullishReclaimPreviousDayLowAt: boolean[];
    bearishReclaimPreviousDayHighAt: boolean[];
    bullishSweepReclaimPreviousDayLowAt: boolean[];
    bearishSweepReclaimPreviousDayHighAt: boolean[];
    touchesPreviousWeekHighAt: boolean[];
    touchesPreviousWeekLowAt: boolean[];
    closesAbovePreviousWeekHighAt: boolean[];
    closesBelowPreviousWeekLowAt: boolean[];
    previousDayHighByBar: Array<number | null>;
    previousDayLowByBar: Array<number | null>;
    previousDayMidpointByBar: Array<number | null>;
    previousWeekHighByBar: Array<number | null>;
    previousWeekLowByBar: Array<number | null>;
    previousWeekMidpointByBar: Array<number | null>;
    previousDayKeyByBar: Array<string | null>;
    previousWeekKeyByBar: Array<string | null>;
}

interface PeriodAggregate {
    startMs: number;
    key: string;
    high: number;
    low: number;
    midpoint: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const paramSchema: FieldSchema[] = [];

const conditions: ConditionDef[] = [
    {
        id: 'touches_previous_day_high',
        name: 'Price touches previous day high',
        description: 'Current bar overlaps the previous completed UTC day high.',
        paramSchema: [],
    },
    {
        id: 'touches_previous_day_low',
        name: 'Price touches previous day low',
        description: 'Current bar overlaps the previous completed UTC day low.',
        paramSchema: [],
    },
    {
        id: 'closes_above_previous_day_high',
        name: 'Close above previous day high',
        description: 'Current close finishes above the previous completed UTC day high.',
        paramSchema: [],
    },
    {
        id: 'closes_below_previous_day_low',
        name: 'Close below previous day low',
        description: 'Current close finishes below the previous completed UTC day low.',
        paramSchema: [],
    },
    {
        id: 'closes_above_previous_day_midpoint',
        name: 'Close above previous day midpoint',
        description: 'Current close finishes above the midpoint of the previous completed UTC day range.',
        paramSchema: [],
    },
    {
        id: 'closes_below_previous_day_midpoint',
        name: 'Close below previous day midpoint',
        description: 'Current close finishes below the midpoint of the previous completed UTC day range.',
        paramSchema: [],
    },
    {
        id: 'bullish_reclaim_previous_day_low',
        name: 'Bullish reclaim of previous day low',
        description: 'Previous close was below the previous day low and the current close reclaims back above it.',
        paramSchema: [],
    },
    {
        id: 'bearish_reclaim_previous_day_high',
        name: 'Bearish reclaim of previous day high',
        description: 'Previous close was above the previous day high and the current close reclaims back below it.',
        paramSchema: [],
    },
    {
        id: 'bullish_sweep_reclaim_previous_day_low',
        name: 'Bullish sweep and reclaim of previous day low',
        description: 'Current bar sweeps below the previous day low and closes back above it.',
        paramSchema: [],
    },
    {
        id: 'bearish_sweep_reclaim_previous_day_high',
        name: 'Bearish sweep and reclaim of previous day high',
        description: 'Current bar sweeps above the previous day high and closes back below it.',
        paramSchema: [],
    },
    {
        id: 'touches_previous_week_high',
        name: 'Price touches previous week high',
        description: 'Current bar overlaps the previous completed UTC week high.',
        paramSchema: [],
    },
    {
        id: 'touches_previous_week_low',
        name: 'Price touches previous week low',
        description: 'Current bar overlaps the previous completed UTC week low.',
        paramSchema: [],
    },
    {
        id: 'closes_above_previous_week_high',
        name: 'Close above previous week high',
        description: 'Current close finishes above the previous completed UTC week high.',
        paramSchema: [],
    },
    {
        id: 'closes_below_previous_week_low',
        name: 'Close below previous week low',
        description: 'Current close finishes below the previous completed UTC week low.',
        paramSchema: [],
    },
];

const definition: TechIndicatorDefinition = {
    id: 'PD_LEVELS',
    name: 'Previous Period Levels',
    category: 'structure',
    description:
        'Tracks previous UTC day and week highs, lows, and midpoints for breakout, reclaim, and sweep-reclaim logic.',
    paramSchema,
    conditions,
};

function getUtcDayStartMs(time: Date): number {
    return Date.UTC(time.getUTCFullYear(), time.getUTCMonth(), time.getUTCDate());
}

function getUtcWeekStartMs(time: Date): number {
    const dayStartMs = getUtcDayStartMs(time);
    const dayOfWeek = new Date(dayStartMs).getUTCDay();
    const isoDay = dayOfWeek === 0 ? 7 : dayOfWeek;
    return dayStartMs - (isoDay - 1) * DAY_MS;
}

function formatBucketKey(startMs: number): string {
    return new Date(startMs).toISOString().slice(0, 10);
}

function buildPeriodAggregates(
    bars: CandleBar[],
    getBucketStartMs: (time: Date) => number,
): PeriodAggregate[] {
    const aggregates: PeriodAggregate[] = [];

    for (const bar of bars) {
        const startMs = getBucketStartMs(bar.time);
        const lastAggregate = aggregates[aggregates.length - 1];

        if (!lastAggregate || lastAggregate.startMs !== startMs) {
            aggregates.push({
                startMs,
                key: formatBucketKey(startMs),
                high: bar.high,
                low: bar.low,
                midpoint: 0,
            });
            continue;
        }

        lastAggregate.high = Math.max(lastAggregate.high, bar.high);
        lastAggregate.low = Math.min(lastAggregate.low, bar.low);
    }

    for (const aggregate of aggregates) {
        aggregate.midpoint = Number(((aggregate.high + aggregate.low) / 2).toFixed(6));
    }

    return aggregates;
}

function buildPreviousPeriodLookup(
    bars: CandleBar[],
    getBucketStartMs: (time: Date) => number,
): {
    highByBar: Array<number | null>;
    lowByBar: Array<number | null>;
    midpointByBar: Array<number | null>;
    keyByBar: Array<string | null>;
} {
    const aggregates = buildPeriodAggregates(bars, getBucketStartMs);
    const previousByStart = new Map<number, PeriodAggregate | null>();
    let previousAggregate: PeriodAggregate | null = null;

    for (const aggregate of aggregates) {
        previousByStart.set(aggregate.startMs, previousAggregate);
        previousAggregate = aggregate;
    }

    const highByBar = new Array<number | null>(bars.length).fill(null);
    const lowByBar = new Array<number | null>(bars.length).fill(null);
    const midpointByBar = new Array<number | null>(bars.length).fill(null);
    const keyByBar = new Array<string | null>(bars.length).fill(null);

    for (let index = 0; index < bars.length; index += 1) {
        const previous = previousByStart.get(getBucketStartMs(bars[index]!.time)) ?? null;
        if (!previous) {
            continue;
        }

        highByBar[index] = previous.high;
        lowByBar[index] = previous.low;
        midpointByBar[index] = previous.midpoint;
        keyByBar[index] = previous.key;
    }

    return {
        highByBar,
        lowByBar,
        midpointByBar,
        keyByBar,
    };
}

function touchesLevel(bar: CandleBar, level: number | null): boolean {
    return level !== null && bar.low <= level && bar.high >= level;
}

function closesAboveLevel(bar: CandleBar, level: number | null): boolean {
    return level !== null && bar.close > level;
}

function closesBelowLevel(bar: CandleBar, level: number | null): boolean {
    return level !== null && bar.close < level;
}

function bullishReclaim(prevBar: CandleBar | null, bar: CandleBar, level: number | null): boolean {
    return prevBar !== null && level !== null && prevBar.close < level && bar.close > level;
}

function bearishReclaim(prevBar: CandleBar | null, bar: CandleBar, level: number | null): boolean {
    return prevBar !== null && level !== null && prevBar.close > level && bar.close < level;
}

function bullishSweepReclaim(bar: CandleBar, level: number | null): boolean {
    return level !== null && bar.low < level && bar.close > level;
}

function bearishSweepReclaim(bar: CandleBar, level: number | null): boolean {
    return level !== null && bar.high > level && bar.close < level;
}

function getTraceValues(state: PreviousPeriodLevelsState, index: number): Record<string, BlockTraceValue> {
    return {
        previousDayHigh: state.previousDayHighByBar[index] ?? null,
        previousDayLow: state.previousDayLowByBar[index] ?? null,
        previousDayMidpoint: state.previousDayMidpointByBar[index] ?? null,
        previousWeekHigh: state.previousWeekHighByBar[index] ?? null,
        previousWeekLow: state.previousWeekLowByBar[index] ?? null,
        previousWeekMidpoint: state.previousWeekMidpointByBar[index] ?? null,
        previousDayKey: state.previousDayKeyByBar[index] ?? null,
        previousWeekKey: state.previousWeekKeyByBar[index] ?? null,
    };
}

export const previousPeriodLevelsBlock: TechIndicatorBlock<Record<string, never>, PreviousPeriodLevelsState> = {
    definition,

    initialize(
        bars: CandleBar[],
        _params: Record<string, never>,
        _services: SignalRuntimeServices,
    ): PreviousPeriodLevelsState {
        const previousDay = buildPreviousPeriodLookup(bars, getUtcDayStartMs);
        const previousWeek = buildPreviousPeriodLookup(bars, getUtcWeekStartMs);

        const state: PreviousPeriodLevelsState = {
            touchesPreviousDayHighAt: new Array(bars.length).fill(false),
            touchesPreviousDayLowAt: new Array(bars.length).fill(false),
            closesAbovePreviousDayHighAt: new Array(bars.length).fill(false),
            closesBelowPreviousDayLowAt: new Array(bars.length).fill(false),
            closesAbovePreviousDayMidpointAt: new Array(bars.length).fill(false),
            closesBelowPreviousDayMidpointAt: new Array(bars.length).fill(false),
            bullishReclaimPreviousDayLowAt: new Array(bars.length).fill(false),
            bearishReclaimPreviousDayHighAt: new Array(bars.length).fill(false),
            bullishSweepReclaimPreviousDayLowAt: new Array(bars.length).fill(false),
            bearishSweepReclaimPreviousDayHighAt: new Array(bars.length).fill(false),
            touchesPreviousWeekHighAt: new Array(bars.length).fill(false),
            touchesPreviousWeekLowAt: new Array(bars.length).fill(false),
            closesAbovePreviousWeekHighAt: new Array(bars.length).fill(false),
            closesBelowPreviousWeekLowAt: new Array(bars.length).fill(false),
            previousDayHighByBar: previousDay.highByBar,
            previousDayLowByBar: previousDay.lowByBar,
            previousDayMidpointByBar: previousDay.midpointByBar,
            previousWeekHighByBar: previousWeek.highByBar,
            previousWeekLowByBar: previousWeek.lowByBar,
            previousWeekMidpointByBar: previousWeek.midpointByBar,
            previousDayKeyByBar: previousDay.keyByBar,
            previousWeekKeyByBar: previousWeek.keyByBar,
        };

        for (let index = 0; index < bars.length; index += 1) {
            const bar = bars[index]!;
            const prevBar = index > 0 ? bars[index - 1]! : null;
            const previousDayHigh = state.previousDayHighByBar[index];
            const previousDayLow = state.previousDayLowByBar[index];
            const previousDayMidpoint = state.previousDayMidpointByBar[index];
            const previousWeekHigh = state.previousWeekHighByBar[index];
            const previousWeekLow = state.previousWeekLowByBar[index];

            state.touchesPreviousDayHighAt[index] = touchesLevel(bar, previousDayHigh);
            state.touchesPreviousDayLowAt[index] = touchesLevel(bar, previousDayLow);
            state.closesAbovePreviousDayHighAt[index] = closesAboveLevel(bar, previousDayHigh);
            state.closesBelowPreviousDayLowAt[index] = closesBelowLevel(bar, previousDayLow);
            state.closesAbovePreviousDayMidpointAt[index] = closesAboveLevel(bar, previousDayMidpoint);
            state.closesBelowPreviousDayMidpointAt[index] = closesBelowLevel(bar, previousDayMidpoint);
            state.bullishReclaimPreviousDayLowAt[index] = bullishReclaim(prevBar, bar, previousDayLow);
            state.bearishReclaimPreviousDayHighAt[index] = bearishReclaim(prevBar, bar, previousDayHigh);
            state.bullishSweepReclaimPreviousDayLowAt[index] = bullishSweepReclaim(bar, previousDayLow);
            state.bearishSweepReclaimPreviousDayHighAt[index] = bearishSweepReclaim(bar, previousDayHigh);
            state.touchesPreviousWeekHighAt[index] = touchesLevel(bar, previousWeekHigh);
            state.touchesPreviousWeekLowAt[index] = touchesLevel(bar, previousWeekLow);
            state.closesAbovePreviousWeekHighAt[index] = closesAboveLevel(bar, previousWeekHigh);
            state.closesBelowPreviousWeekLowAt[index] = closesBelowLevel(bar, previousWeekLow);
        }

        return state;
    },

    evaluate(
        _bar: CandleBar,
        _prevBar: CandleBar | null,
        _allBars: CandleBar[],
        index: number,
        state: PreviousPeriodLevelsState,
        _params: Record<string, never>,
        conditionId: string,
        _conditionParams: Record<string, unknown>,
        _services: SignalRuntimeServices,
    ): BlockEvaluateResult<PreviousPeriodLevelsState> {
        const values = getTraceValues(state, index);

        let isActive = false;
        switch (conditionId) {
            case 'touches_previous_day_high':
                isActive = state.touchesPreviousDayHighAt[index] ?? false;
                break;
            case 'touches_previous_day_low':
                isActive = state.touchesPreviousDayLowAt[index] ?? false;
                break;
            case 'closes_above_previous_day_high':
                isActive = state.closesAbovePreviousDayHighAt[index] ?? false;
                break;
            case 'closes_below_previous_day_low':
                isActive = state.closesBelowPreviousDayLowAt[index] ?? false;
                break;
            case 'closes_above_previous_day_midpoint':
                isActive = state.closesAbovePreviousDayMidpointAt[index] ?? false;
                break;
            case 'closes_below_previous_day_midpoint':
                isActive = state.closesBelowPreviousDayMidpointAt[index] ?? false;
                break;
            case 'bullish_reclaim_previous_day_low':
                isActive = state.bullishReclaimPreviousDayLowAt[index] ?? false;
                break;
            case 'bearish_reclaim_previous_day_high':
                isActive = state.bearishReclaimPreviousDayHighAt[index] ?? false;
                break;
            case 'bullish_sweep_reclaim_previous_day_low':
                isActive = state.bullishSweepReclaimPreviousDayLowAt[index] ?? false;
                break;
            case 'bearish_sweep_reclaim_previous_day_high':
                isActive = state.bearishSweepReclaimPreviousDayHighAt[index] ?? false;
                break;
            case 'touches_previous_week_high':
                isActive = state.touchesPreviousWeekHighAt[index] ?? false;
                break;
            case 'touches_previous_week_low':
                isActive = state.touchesPreviousWeekLowAt[index] ?? false;
                break;
            case 'closes_above_previous_week_high':
                isActive = state.closesAbovePreviousWeekHighAt[index] ?? false;
                break;
            case 'closes_below_previous_week_low':
                isActive = state.closesBelowPreviousWeekLowAt[index] ?? false;
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
