import { ComposedSignalDefinition } from '../services/signals/ComposedSignalPlugin';
import { ExecutionConfigInput } from '../services/signals/types';

export type BobVolmanVariantId =
    | 'breakout_long'
    | 'breakout_short'
    | 'false_break_long'
    | 'false_break_short';

export interface BobVolmanStrategySpec {
    id: BobVolmanVariantId;
    signalCode: string;
    signalVersion: number;
    name: string;
    description: string;
    thesis: string;
    defaults: {
        symbol: string;
        timeframe: string;
        from: string;
        to: string;
        initialEquity: number;
        riskPercent: number;
    };
    composedDefinition: ComposedSignalDefinition;
    executionConfig: ExecutionConfigInput;
}

const DEFAULTS = {
    symbol: 'XAUUSD',
    timeframe: 'M5',
    from: '2024-01-01T00:00:00.000Z',
    to: '2026-03-21T23:59:59.999Z',
    initialEquity: 10_000,
    riskPercent: 1,
} as const;

const DEFAULT_VOLMAN_PARAMS = {
    buildupBars: 4,
    lookbackBars: 20,
    atrPeriod: 14,
    compressionFactor: 1.4,
    boundaryTolerance: 0.25,
    breakoutBuffer: 0.1,
} as const;

const DEFAULT_SESSION_PARAMS = {
    startHour: 7,
    endHour: 16,
} as const;

const DEFAULT_TREND_PARAMS = {
    fastPeriod: 50,
    slowPeriod: 200,
    adxPeriod: 14,
} as const;

const DEFAULT_BREAKOUT_EXECUTION: ExecutionConfigInput = {
    entryFeeBps: 4,
    exitFeeBps: 4,
    entrySlippageBps: 2,
    exitSlippageBps: 2,
    orderTiming: 'NEXT_BAR_OPEN',
    stopLoss: { mode: 'SIGNAL_PRICE' },
    takeProfit: { mode: 'SIGNAL_PRICE' },
    positionSizing: { mode: 'RISK_BASED' },
    tradeGuards: {
        minTradeSpacing: { minSpacingMinutes: 20 },
        equityCurveFilter: { emaTrades: 20, action: 'HALF_RISK' },
    },
};

const DEFAULT_FALSE_BREAK_EXECUTION: ExecutionConfigInput = {
    entryFeeBps: 4,
    exitFeeBps: 4,
    entrySlippageBps: 2,
    exitSlippageBps: 2,
    orderTiming: 'NEXT_BAR_OPEN',
    stopLoss: { mode: 'SIGNAL_PRICE' },
    takeProfit: { mode: 'SIGNAL_PRICE' },
    positionSizing: { mode: 'RISK_BASED' },
    tradeGuards: {
        minTradeSpacing: { minSpacingMinutes: 15 },
        equityCurveFilter: { emaTrades: 20, action: 'HALF_RISK' },
    },
};

function jsonClone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

const VARIANTS: Record<BobVolmanVariantId, BobVolmanStrategySpec> = {
    breakout_long: {
        id: 'breakout_long',
        signalCode: 'VOLMAN_BREAKOUT_LONG',
        signalVersion: 1,
        name: 'Bob Volman Breakout Long',
        description: 'Volman-style bullish buildup breakout with active-session and trend confirmation.',
        thesis: 'Buy a tight buildup pressing into resistance when the active-session trend confirms and price breaks cleanly.',
        defaults: DEFAULTS,
        composedDefinition: {
            matchMode: 'ALL',
            windowBars: 3,
            side: 'LONG',
            blocks: [
                {
                    id: 'london_window',
                    indicatorId: 'SESSION_FILTER',
                    conditionId: 'in_session',
                    indicatorParams: DEFAULT_SESSION_PARAMS,
                    conditionParams: {},
                },
                {
                    id: 'trend_up',
                    indicatorId: 'CONFIRMATION_TREND',
                    conditionId: 'confirmation_uptrend',
                    indicatorParams: DEFAULT_TREND_PARAMS,
                    conditionParams: { adxThreshold: 18 },
                },
                {
                    id: 'volman_buildup',
                    indicatorId: 'VOLMAN_PRICE_ACTION',
                    conditionId: 'bullish_pressure_buildup',
                    indicatorParams: DEFAULT_VOLMAN_PARAMS,
                    conditionParams: {},
                },
                {
                    id: 'volman_breakout',
                    indicatorId: 'VOLMAN_PRICE_ACTION',
                    conditionId: 'bullish_buildup_breakout',
                    indicatorParams: DEFAULT_VOLMAN_PARAMS,
                    conditionParams: {},
                },
            ],
            entryManagement: {
                signalAreaGuard: {
                    maxSignalsPerArea: 1,
                    resetBars: 8,
                    priceDistanceR: 1,
                },
            },
            stopLoss: {
                type: 'BELOW_STRUCTURE',
                value: 0.0012,
                lookback: 12,
                atrBufferMultiplier: 0.15,
                atrPeriod: 14,
            },
            takeProfit: {
                type: 'R_MULTIPLE',
                value: 2,
            },
            exitManagement: {
                profileCode: 'BE_1R_TP_2R',
            },
        },
        executionConfig: DEFAULT_BREAKOUT_EXECUTION,
    },
    breakout_short: {
        id: 'breakout_short',
        signalCode: 'VOLMAN_BREAKOUT_SHORT',
        signalVersion: 1,
        name: 'Bob Volman Breakout Short',
        description: 'Volman-style bearish buildup breakout with active-session and trend confirmation.',
        thesis: 'Sell a tight buildup pressing into support when the active-session trend confirms and price breaks cleanly.',
        defaults: DEFAULTS,
        composedDefinition: {
            matchMode: 'ALL',
            windowBars: 3,
            side: 'SHORT',
            blocks: [
                {
                    id: 'london_window',
                    indicatorId: 'SESSION_FILTER',
                    conditionId: 'in_session',
                    indicatorParams: DEFAULT_SESSION_PARAMS,
                    conditionParams: {},
                },
                {
                    id: 'trend_down',
                    indicatorId: 'CONFIRMATION_TREND',
                    conditionId: 'confirmation_downtrend',
                    indicatorParams: DEFAULT_TREND_PARAMS,
                    conditionParams: { adxThreshold: 18 },
                },
                {
                    id: 'volman_buildup',
                    indicatorId: 'VOLMAN_PRICE_ACTION',
                    conditionId: 'bearish_pressure_buildup',
                    indicatorParams: DEFAULT_VOLMAN_PARAMS,
                    conditionParams: {},
                },
                {
                    id: 'volman_breakout',
                    indicatorId: 'VOLMAN_PRICE_ACTION',
                    conditionId: 'bearish_buildup_breakout',
                    indicatorParams: DEFAULT_VOLMAN_PARAMS,
                    conditionParams: {},
                },
            ],
            entryManagement: {
                signalAreaGuard: {
                    maxSignalsPerArea: 1,
                    resetBars: 8,
                    priceDistanceR: 1,
                },
            },
            stopLoss: {
                type: 'BELOW_STRUCTURE',
                value: 0.0012,
                lookback: 12,
                atrBufferMultiplier: 0.15,
                atrPeriod: 14,
            },
            takeProfit: {
                type: 'R_MULTIPLE',
                value: 2,
            },
            exitManagement: {
                profileCode: 'BE_1R_TP_2R',
            },
        },
        executionConfig: DEFAULT_BREAKOUT_EXECUTION,
    },
    false_break_long: {
        id: 'false_break_long',
        signalCode: 'VOLMAN_FALSE_BREAK_LONG',
        signalVersion: 1,
        name: 'Bob Volman False Break Long',
        description: 'Volman-style bullish false-break reclaim during the active session with trend confirmation.',
        thesis: 'Buy when a downside trap sweeps the buildup floor, reclaims it, and the broader session trend still points up.',
        defaults: DEFAULTS,
        composedDefinition: {
            matchMode: 'ALL',
            windowBars: 2,
            side: 'LONG',
            blocks: [
                {
                    id: 'london_window',
                    indicatorId: 'SESSION_FILTER',
                    conditionId: 'in_session',
                    indicatorParams: DEFAULT_SESSION_PARAMS,
                    conditionParams: {},
                },
                {
                    id: 'trend_up',
                    indicatorId: 'CONFIRMATION_TREND',
                    conditionId: 'confirmation_uptrend',
                    indicatorParams: DEFAULT_TREND_PARAMS,
                    conditionParams: { adxThreshold: 16 },
                },
                {
                    id: 'volman_false_break',
                    indicatorId: 'VOLMAN_PRICE_ACTION',
                    conditionId: 'bullish_false_break_reversal',
                    indicatorParams: DEFAULT_VOLMAN_PARAMS,
                    conditionParams: {},
                },
            ],
            entryManagement: {
                signalAreaGuard: {
                    maxSignalsPerArea: 1,
                    resetBars: 6,
                    priceDistanceR: 0.8,
                },
            },
            stopLoss: {
                type: 'BELOW_STRUCTURE',
                value: 0.001,
                lookback: 10,
                atrBufferMultiplier: 0.1,
                atrPeriod: 14,
            },
            takeProfit: {
                type: 'R_MULTIPLE',
                value: 1.8,
            },
            exitManagement: {
                profileCode: 'BE_1R_TP_2R',
            },
        },
        executionConfig: DEFAULT_FALSE_BREAK_EXECUTION,
    },
    false_break_short: {
        id: 'false_break_short',
        signalCode: 'VOLMAN_FALSE_BREAK_SHORT',
        signalVersion: 1,
        name: 'Bob Volman False Break Short',
        description: 'Volman-style bearish false-break rejection during the active session with trend confirmation.',
        thesis: 'Sell when an upside trap sweeps the buildup ceiling, rejects it, and the broader session trend still points down.',
        defaults: DEFAULTS,
        composedDefinition: {
            matchMode: 'ALL',
            windowBars: 2,
            side: 'SHORT',
            blocks: [
                {
                    id: 'london_window',
                    indicatorId: 'SESSION_FILTER',
                    conditionId: 'in_session',
                    indicatorParams: DEFAULT_SESSION_PARAMS,
                    conditionParams: {},
                },
                {
                    id: 'trend_down',
                    indicatorId: 'CONFIRMATION_TREND',
                    conditionId: 'confirmation_downtrend',
                    indicatorParams: DEFAULT_TREND_PARAMS,
                    conditionParams: { adxThreshold: 16 },
                },
                {
                    id: 'volman_false_break',
                    indicatorId: 'VOLMAN_PRICE_ACTION',
                    conditionId: 'bearish_false_break_reversal',
                    indicatorParams: DEFAULT_VOLMAN_PARAMS,
                    conditionParams: {},
                },
            ],
            entryManagement: {
                signalAreaGuard: {
                    maxSignalsPerArea: 1,
                    resetBars: 6,
                    priceDistanceR: 0.8,
                },
            },
            stopLoss: {
                type: 'BELOW_STRUCTURE',
                value: 0.001,
                lookback: 10,
                atrBufferMultiplier: 0.1,
                atrPeriod: 14,
            },
            takeProfit: {
                type: 'R_MULTIPLE',
                value: 1.8,
            },
            exitManagement: {
                profileCode: 'BE_1R_TP_2R',
            },
        },
        executionConfig: DEFAULT_FALSE_BREAK_EXECUTION,
    },
};

export function listBobVolmanStrategySpecs(): BobVolmanStrategySpec[] {
    return Object.values(VARIANTS).map((spec) => jsonClone(spec));
}

export function getBobVolmanStrategySpec(id: BobVolmanVariantId): BobVolmanStrategySpec {
    const spec = VARIANTS[id];
    if (!spec) {
        throw new Error(`Unknown Bob Volman variant "${id}".`);
    }
    return jsonClone(spec);
}

export function createBobVolmanComposedSignalPayload(id: BobVolmanVariantId) {
    const spec = getBobVolmanStrategySpec(id);
    return {
        name: spec.name,
        description: spec.description,
        category: 'bob-volman',
        composedBlocks: spec.composedDefinition,
    };
}
