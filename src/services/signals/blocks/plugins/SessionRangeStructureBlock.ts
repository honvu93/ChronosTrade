import { CandleBar, SignalRuntimeServices } from '../../types';
import {
    BlockEvaluateResult,
    BlockTraceValue,
    ConditionDef,
    FieldSchema,
    TechIndicatorBlock,
    TechIndicatorDefinition,
} from '../TechIndicatorBlock';

interface SessionRangeStructureState {
    asianHighByBar: Array<number | null>;
    asianLowByBar: Array<number | null>;
    isWithinAsianSessionByBar: boolean[];
    isPostAsianSessionByBar: boolean[];
    touchesAsianHighAt: boolean[];
    touchesAsianLowAt: boolean[];
    closesAboveAsianHighAt: boolean[];
    closesBelowAsianLowAt: boolean[];
    bullishSweepAsianLowAt: boolean[];
    bearishSweepAsianHighAt: boolean[];
    bullishReclaimAsianLowAt: boolean[];
    bearishReclaimAsianHighAt: boolean[];
}

interface SessionRangeParams {
    /** Start hour (0-23) in UTC */
    asianStartHour: number;
    /** End hour (0-23) in UTC */
    asianEndHour: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const paramSchema: FieldSchema[] = [
    {
        id: 'asianStartHour',
        type: 'number',
        label: 'Asian Start Hour (UTC)',
        default: 0,
        min: 0,
        max: 23,
        step: 1,
    },
    {
        id: 'asianEndHour',
        type: 'number',
        label: 'Asian End Hour (UTC)',
        default: 7,
        min: 0,
        max: 23,
        step: 1,
    },
];

const conditions: ConditionDef[] = [
    {
        id: 'touches_asian_high',
        name: 'Price touches Asian high',
        description: 'Current bar (post-Asian) overlaps the Asian session high.',
        paramSchema: [],
    },
    {
        id: 'touches_asian_low',
        name: 'Price touches Asian low',
        description: 'Current bar (post-Asian) overlaps the Asian session low.',
        paramSchema: [],
    },
    {
        id: 'closes_above_asian_high',
        name: 'Close above Asian high',
        description: 'Current close finishes above the Asian session high.',
        paramSchema: [],
    },
    {
        id: 'closes_below_asian_low',
        name: 'Close below Asian low',
        description: 'Current close finishes below the Asian session low.',
        paramSchema: [],
    },
    {
        id: 'bullish_sweep_asian_low',
        name: 'Bullish sweep of Asian low',
        description: 'Current bar sweeps below Asian low and closes back above it.',
        paramSchema: [],
    },
    {
        id: 'bearish_sweep_asian_high',
        name: 'Bearish sweep of Asian high',
        description: 'Current bar sweeps above Asian high and closes back below it.',
        paramSchema: [],
    },
    {
        id: 'bullish_reclaim_asian_low',
        name: 'Bullish reclaim of Asian low',
        description: 'Previous close was below Asian low and current close reclaims back above it.',
        paramSchema: [],
    },
    {
        id: 'bearish_reclaim_asian_high',
        name: 'Bearish reclaim of Asian high',
        description: 'Previous close was above Asian high and current close reclaims back below it.',
        paramSchema: [],
    },
];

const definition: TechIndicatorDefinition = {
    id: 'SESSION_RANGE_STRUCTURE',
    name: 'Session Range Structure',
    category: 'structure',
    description: 'Tracks Asian session range and provides signals for London/NY breakouts and sweeps.',
    paramSchema,
    conditions,
};

function getUtcDayStartMs(time: Date): number {
    return Date.UTC(time.getUTCFullYear(), time.getUTCMonth(), time.getUTCDate());
}

function isWithinSessionWindow(hour: number, startHour: number, endHour: number): boolean {
    if (startHour <= endHour) {
        return hour >= startHour && hour < endHour;
    }

    return hour >= startHour || hour < endHour;
}

function isPostSessionWindow(hour: number, startHour: number, endHour: number): boolean {
    if (startHour <= endHour) {
        return hour >= endHour;
    }

    return hour >= endHour && hour < startHour;
}

function getSessionAnchorStartMs(time: Date, startHour: number, endHour: number): number {
    const dayStartMs = getUtcDayStartMs(time);

    if (startHour <= endHour) {
        return dayStartMs;
    }

    return time.getUTCHours() >= startHour ? dayStartMs : dayStartMs - DAY_MS;
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

export const sessionRangeStructureBlock: TechIndicatorBlock<SessionRangeParams, SessionRangeStructureState> = {
    definition,

    initialize(
        bars: CandleBar[],
        params: SessionRangeParams,
        _services: SignalRuntimeServices,
    ): SessionRangeStructureState {
        const startHour = params.asianStartHour ?? 0;
        const endHour = params.asianEndHour ?? 7;

        const asianHighByBar = new Array<number | null>(bars.length).fill(null);
        const asianLowByBar = new Array<number | null>(bars.length).fill(null);
        const isWithinAsianSessionByBar = new Array<boolean>(bars.length).fill(false);
        const isPostAsianSessionByBar = new Array<boolean>(bars.length).fill(false);

        const sessionRanges = new Map<number, { high: number; low: number; established: boolean }>();
        const state: SessionRangeStructureState = {
            asianHighByBar,
            asianLowByBar,
            isWithinAsianSessionByBar,
            isPostAsianSessionByBar,
            touchesAsianHighAt: new Array(bars.length).fill(false),
            touchesAsianLowAt: new Array(bars.length).fill(false),
            closesAboveAsianHighAt: new Array(bars.length).fill(false),
            closesBelowAsianLowAt: new Array(bars.length).fill(false),
            bullishSweepAsianLowAt: new Array(bars.length).fill(false),
            bearishSweepAsianHighAt: new Array(bars.length).fill(false),
            bullishReclaimAsianLowAt: new Array(bars.length).fill(false),
            bearishReclaimAsianHighAt: new Array(bars.length).fill(false),
        };

        for (let i = 0; i < bars.length; i++) {
            const bar = bars[i]!;
            const hour = bar.time.getUTCHours();
            const sessionAnchorMs = getSessionAnchorStartMs(bar.time, startHour, endHour);
            const isInAsian = isWithinSessionWindow(hour, startHour, endHour);
            let range = sessionRanges.get(sessionAnchorMs);
            if (isInAsian) {
                range = range ?? { high: -Infinity, low: Infinity, established: false };
                range.high = Math.max(range.high, bar.high);
                range.low = Math.min(range.low, bar.low);
                range.established = true;
                sessionRanges.set(sessionAnchorMs, range);
            }

            const isPostAsian = range?.established && isPostSessionWindow(hour, startHour, endHour);

            state.isWithinAsianSessionByBar[i] = isInAsian;
            state.isPostAsianSessionByBar[i] = isPostAsian ?? false;

            if (range?.established && (isInAsian || isPostAsian)) {
                state.asianHighByBar[i] = range.high;
                state.asianLowByBar[i] = range.low;

                if (isPostAsian) {
                    const high = range.high;
                    const low = range.low;
                    const prevBar = i > 0 ? bars[i - 1]! : null;

                    state.touchesAsianHighAt[i] = touchesLevel(bar, high);
                    state.touchesAsianLowAt[i] = touchesLevel(bar, low);
                    state.closesAboveAsianHighAt[i] = closesAboveLevel(bar, high);
                    state.closesBelowAsianLowAt[i] = closesBelowLevel(bar, low);

                    state.bullishSweepAsianLowAt[i] = bar.low < low && bar.close > low;
                    state.bearishSweepAsianHighAt[i] = bar.high > high && bar.close < high;

                    if (prevBar) {
                        state.bullishReclaimAsianLowAt[i] = prevBar.close < low && bar.close > low;
                        state.bearishReclaimAsianHighAt[i] = prevBar.close > high && bar.close < high;
                    }
                }
            }
        }

        return state;
    },

    evaluate(
        _bar: CandleBar,
        _prevBar: CandleBar | null,
        _allBars: CandleBar[],
        index: number,
        state: SessionRangeStructureState,
        _params: SessionRangeParams,
        conditionId: string,
        _conditionParams: Record<string, unknown>,
        _services: SignalRuntimeServices,
    ): BlockEvaluateResult<SessionRangeStructureState> {
        const values: Record<string, BlockTraceValue> = {
            asianHigh: state.asianHighByBar[index] ?? null,
            asianLow: state.asianLowByBar[index] ?? null,
            isPostAsian: state.isPostAsianSessionByBar[index],
        };

        let isActive = false;
        switch (conditionId) {
            case 'touches_asian_high': isActive = state.touchesAsianHighAt[index]; break;
            case 'touches_asian_low': isActive = state.touchesAsianLowAt[index]; break;
            case 'closes_above_asian_high': isActive = state.closesAboveAsianHighAt[index]; break;
            case 'closes_below_asian_low': isActive = state.closesBelowAsianLowAt[index]; break;
            case 'bullish_sweep_asian_low': isActive = state.bullishSweepAsianLowAt[index]; break;
            case 'bearish_sweep_asian_high': isActive = state.bearishSweepAsianHighAt[index]; break;
            case 'bullish_reclaim_asian_low': isActive = state.bullishReclaimAsianLowAt[index]; break;
            case 'bearish_reclaim_asian_high': isActive = state.bearishReclaimAsianHighAt[index]; break;
        }

        return {
            state,
            isActive,
            values,
        };
    },
};
