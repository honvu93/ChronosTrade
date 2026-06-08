import { CandleBar, SignalRuntimeServices } from '../../types';
import {
    BlockEvaluateResult,
    BlockTraceValue,
    ConditionDef,
    FieldSchema,
    TechIndicatorBlock,
    TechIndicatorDefinition,
} from '../TechIndicatorBlock';

interface VolmanPriceActionParams {
    buildupBars: number;
    lookbackBars: number;
    atrPeriod: number;
    compressionFactor: number;
    boundaryTolerance: number;
    breakoutBuffer: number;
}

interface VolmanPriceActionState {
    buildupHighByBar: Array<number | null>;
    buildupLowByBar: Array<number | null>;
    referenceHighByBar: Array<number | null>;
    referenceLowByBar: Array<number | null>;
    buildupRangeByBar: Array<number | null>;
    rangeUnitByBar: Array<number | null>;
    bullishPressureByBar: boolean[];
    bearishPressureByBar: boolean[];
    bullishBreakoutByBar: boolean[];
    bearishBreakoutByBar: boolean[];
    bullishFalseBreakByBar: boolean[];
    bearishFalseBreakByBar: boolean[];
}

const paramSchema: FieldSchema[] = [
    { id: 'buildupBars', type: 'number', label: 'Buildup Bars', default: 4, min: 3, max: 12, step: 1 },
    { id: 'lookbackBars', type: 'number', label: 'Barrier Lookback Bars', default: 20, min: 5, max: 80, step: 1 },
    { id: 'atrPeriod', type: 'number', label: 'ATR Period', default: 14, min: 2, max: 100, step: 1 },
    {
        id: 'compressionFactor',
        type: 'number',
        label: 'Compression Factor',
        default: 1.4,
        min: 0.5,
        max: 5,
        step: 0.05,
    },
    {
        id: 'boundaryTolerance',
        type: 'number',
        label: 'Barrier Tolerance ATR',
        default: 0.25,
        min: 0,
        max: 3,
        step: 0.05,
    },
    {
        id: 'breakoutBuffer',
        type: 'number',
        label: 'Breakout Buffer ATR',
        default: 0.1,
        min: 0,
        max: 3,
        step: 0.05,
    },
];

const conditions: ConditionDef[] = [
    {
        id: 'bullish_pressure_buildup',
        name: 'Bullish pressure buildup',
        description: 'Tight rising lows press into a nearby resistance barrier in classic Volman style.',
        paramSchema: [],
    },
    {
        id: 'bearish_pressure_buildup',
        name: 'Bearish pressure buildup',
        description: 'Tight falling highs press into a nearby support barrier in classic Volman style.',
        paramSchema: [],
    },
    {
        id: 'bullish_buildup_breakout',
        name: 'Bullish buildup breakout',
        description: 'Price closes through a Volman buildup ceiling with bullish breakout intent.',
        paramSchema: [],
    },
    {
        id: 'bearish_buildup_breakout',
        name: 'Bearish buildup breakout',
        description: 'Price closes through a Volman buildup floor with bearish breakout intent.',
        paramSchema: [],
    },
    {
        id: 'bullish_false_break_reversal',
        name: 'Bullish false break reversal',
        description: 'Price sweeps below a bearish buildup floor and reclaims it in a Volman-style trap.',
        paramSchema: [],
    },
    {
        id: 'bearish_false_break_reversal',
        name: 'Bearish false break reversal',
        description: 'Price sweeps above a bullish buildup ceiling and rejects it in a Volman-style trap.',
        paramSchema: [],
    },
];

const definition: TechIndicatorDefinition = {
    id: 'VOLMAN_PRICE_ACTION',
    name: 'Volman Price Action',
    category: 'structure',
    description: 'Detects Volman-style buildup pressure, breakout, and false-break price action from candle structure.',
    paramSchema,
    conditions,
};

function getWindowHigh(window: CandleBar[]): number | null {
    if (window.length === 0) {
        return null;
    }

    return window.reduce((highest, bar) => Math.max(highest, bar.high), window[0]!.high);
}

function getWindowLow(window: CandleBar[]): number | null {
    if (window.length === 0) {
        return null;
    }

    return window.reduce((lowest, bar) => Math.min(lowest, bar.low), window[0]!.low);
}

function getAverageBarRange(window: CandleBar[]): number | null {
    if (window.length === 0) {
        return null;
    }

    const total = window.reduce((sum, bar) => sum + (bar.high - bar.low), 0);
    return total / window.length;
}

function getCloseLocation(close: number, low: number, high: number): number {
    const span = high - low;
    if (span <= 0) {
        return 0.5;
    }

    return (close - low) / span;
}

function getAverageCloseLocation(window: CandleBar[], rangeLow: number, rangeHigh: number): number {
    if (window.length === 0) {
        return 0.5;
    }

    const total = window.reduce((sum, bar) => sum + getCloseLocation(bar.close, rangeLow, rangeHigh), 0);
    return total / window.length;
}

function hasRisingLows(window: CandleBar[], tolerance: number): boolean {
    let hasStrictRise = false;

    for (let index = 1; index < window.length; index += 1) {
        if (window[index]!.low + tolerance < window[index - 1]!.low) {
            return false;
        }

        if (window[index]!.low > window[index - 1]!.low + tolerance * 0.5) {
            hasStrictRise = true;
        }
    }

    return hasStrictRise;
}

function hasFallingHighs(window: CandleBar[], tolerance: number): boolean {
    let hasStrictDrop = false;

    for (let index = 1; index < window.length; index += 1) {
        if (window[index]!.high - tolerance > window[index - 1]!.high) {
            return false;
        }

        if (window[index]!.high < window[index - 1]!.high - tolerance * 0.5) {
            hasStrictDrop = true;
        }
    }

    return hasStrictDrop;
}

export const volmanPriceActionBlock: TechIndicatorBlock<VolmanPriceActionParams, VolmanPriceActionState> = {
    definition,

    initialize(
        bars: CandleBar[],
        indicatorParams: VolmanPriceActionParams,
        services: SignalRuntimeServices,
    ): VolmanPriceActionState {
        const buildupBars = Math.max(3, Number(indicatorParams.buildupBars ?? 4));
        const lookbackBars = Math.max(5, Number(indicatorParams.lookbackBars ?? 20));
        const atrPeriod = Math.max(2, Number(indicatorParams.atrPeriod ?? 14));
        const compressionFactor = Math.max(0.5, Number(indicatorParams.compressionFactor ?? 1.4));
        const boundaryToleranceAtr = Math.max(0, Number(indicatorParams.boundaryTolerance ?? 0.25));
        const breakoutBufferAtr = Math.max(0, Number(indicatorParams.breakoutBuffer ?? 0.1));

        const alignedAtr = services.indicatorSeries.alignPointsToBars(
            bars,
            services.indicatorSeries.calculateATR(bars, atrPeriod),
        ).map((point) => point.value);

        const rangeUnitByBar = bars.map((_, index) => {
            const atrValue = alignedAtr[index];
            if (atrValue !== null) {
                return atrValue;
            }

            return getAverageBarRange(bars.slice(Math.max(0, index - atrPeriod + 1), index + 1));
        });

        const state: VolmanPriceActionState = {
            buildupHighByBar: new Array<number | null>(bars.length).fill(null),
            buildupLowByBar: new Array<number | null>(bars.length).fill(null),
            referenceHighByBar: new Array<number | null>(bars.length).fill(null),
            referenceLowByBar: new Array<number | null>(bars.length).fill(null),
            buildupRangeByBar: new Array<number | null>(bars.length).fill(null),
            rangeUnitByBar,
            bullishPressureByBar: new Array<boolean>(bars.length).fill(false),
            bearishPressureByBar: new Array<boolean>(bars.length).fill(false),
            bullishBreakoutByBar: new Array<boolean>(bars.length).fill(false),
            bearishBreakoutByBar: new Array<boolean>(bars.length).fill(false),
            bullishFalseBreakByBar: new Array<boolean>(bars.length).fill(false),
            bearishFalseBreakByBar: new Array<boolean>(bars.length).fill(false),
        };

        for (let index = buildupBars; index < bars.length; index += 1) {
            const buildupWindow = bars.slice(index - buildupBars, index);
            const referenceWindow = bars.slice(Math.max(0, index - buildupBars - lookbackBars), index - buildupBars);

            if (referenceWindow.length === 0) {
                continue;
            }

            const buildupHigh = getWindowHigh(buildupWindow);
            const buildupLow = getWindowLow(buildupWindow);
            const referenceHigh = getWindowHigh(referenceWindow);
            const referenceLow = getWindowLow(referenceWindow);
            const rangeUnit = rangeUnitByBar[index] ?? getAverageBarRange(buildupWindow);

            if (
                buildupHigh === null
                || buildupLow === null
                || referenceHigh === null
                || referenceLow === null
                || rangeUnit === null
                || rangeUnit <= 0
            ) {
                continue;
            }

            const buildupRange = buildupHigh - buildupLow;
            if (buildupRange <= 0) {
                continue;
            }

            state.buildupHighByBar[index] = buildupHigh;
            state.buildupLowByBar[index] = buildupLow;
            state.referenceHighByBar[index] = referenceHigh;
            state.referenceLowByBar[index] = referenceLow;
            state.buildupRangeByBar[index] = buildupRange;

            const boundaryTolerance = rangeUnit * boundaryToleranceAtr;
            const breakoutTolerance = rangeUnit * breakoutBufferAtr;
            const compressionLimit = rangeUnit * compressionFactor;
            const averageCloseLocation = getAverageCloseLocation(buildupWindow, buildupLow, buildupHigh);
            const lastCloseLocation = getCloseLocation(
                buildupWindow[buildupWindow.length - 1]!.close,
                buildupLow,
                buildupHigh,
            );
            const currentBar = bars[index]!;
            const currentCloseLocation = getCloseLocation(currentBar.close, currentBar.low, currentBar.high);

            const bullishPressure = buildupRange <= compressionLimit
                && buildupHigh >= referenceHigh - boundaryTolerance
                && buildupHigh <= referenceHigh + breakoutTolerance
                && hasRisingLows(buildupWindow, breakoutTolerance)
                && averageCloseLocation >= 0.55
                && lastCloseLocation >= 0.65;

            const bearishPressure = buildupRange <= compressionLimit
                && buildupLow <= referenceLow + boundaryTolerance
                && buildupLow >= referenceLow - breakoutTolerance
                && hasFallingHighs(buildupWindow, breakoutTolerance)
                && averageCloseLocation <= 0.45
                && lastCloseLocation <= 0.35;

            state.bullishPressureByBar[index] = bullishPressure;
            state.bearishPressureByBar[index] = bearishPressure;
            state.bullishBreakoutByBar[index] = bullishPressure
                && currentBar.high > buildupHigh + breakoutTolerance
                && currentBar.close > buildupHigh + breakoutTolerance
                && currentCloseLocation >= 0.55;
            state.bearishBreakoutByBar[index] = bearishPressure
                && currentBar.low < buildupLow - breakoutTolerance
                && currentBar.close < buildupLow - breakoutTolerance
                && currentCloseLocation <= 0.45;
            state.bullishFalseBreakByBar[index] = bearishPressure
                && currentBar.low < buildupLow - breakoutTolerance
                && currentBar.close > buildupLow + breakoutTolerance * 0.25
                && currentCloseLocation >= 0.55;
            state.bearishFalseBreakByBar[index] = bullishPressure
                && currentBar.high > buildupHigh + breakoutTolerance
                && currentBar.close < buildupHigh - breakoutTolerance * 0.25
                && currentCloseLocation <= 0.45;
        }

        return state;
    },

    evaluate(
        _bar: CandleBar,
        _prevBar: CandleBar | null,
        _allBars: CandleBar[],
        index: number,
        state: VolmanPriceActionState,
        _indicatorParams: VolmanPriceActionParams,
        conditionId: string,
        _conditionParams: Record<string, unknown>,
        _services: SignalRuntimeServices,
    ): BlockEvaluateResult<VolmanPriceActionState> {
        const values: Record<string, BlockTraceValue> = {
            buildupHigh: state.buildupHighByBar[index] ?? null,
            buildupLow: state.buildupLowByBar[index] ?? null,
            referenceHigh: state.referenceHighByBar[index] ?? null,
            referenceLow: state.referenceLowByBar[index] ?? null,
            buildupRange: state.buildupRangeByBar[index] ?? null,
            rangeUnit: state.rangeUnitByBar[index] ?? null,
            bullishPressure: state.bullishPressureByBar[index] ?? false,
            bearishPressure: state.bearishPressureByBar[index] ?? false,
            bullishBreakout: state.bullishBreakoutByBar[index] ?? false,
            bearishBreakout: state.bearishBreakoutByBar[index] ?? false,
            bullishFalseBreak: state.bullishFalseBreakByBar[index] ?? false,
            bearishFalseBreak: state.bearishFalseBreakByBar[index] ?? false,
        };

        let isActive = false;
        switch (conditionId) {
            case 'bullish_pressure_buildup':
                isActive = state.bullishPressureByBar[index] ?? false;
                break;
            case 'bearish_pressure_buildup':
                isActive = state.bearishPressureByBar[index] ?? false;
                break;
            case 'bullish_buildup_breakout':
                isActive = state.bullishBreakoutByBar[index] ?? false;
                break;
            case 'bearish_buildup_breakout':
                isActive = state.bearishBreakoutByBar[index] ?? false;
                break;
            case 'bullish_false_break_reversal':
                isActive = state.bullishFalseBreakByBar[index] ?? false;
                break;
            case 'bearish_false_break_reversal':
                isActive = state.bearishFalseBreakByBar[index] ?? false;
                break;
            default:
                break;
        }

        return { state, isActive, values };
    },
};
