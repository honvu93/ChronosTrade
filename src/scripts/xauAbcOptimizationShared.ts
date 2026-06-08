import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { ComposedSignalDefinition, ComposedSignalPlugin } from '../services/signals/ComposedSignalPlugin';
import { SignalRegistry } from '../services/signals/SignalRegistry';
import { SignalBacktestRunner } from '../services/signals/SignalBacktestRunner';
import { CandleQueryService } from '../services/signals/CandleQueryService';
import { IndicatorSeriesService } from '../services/signals/IndicatorSeriesService';
import { ExecutionModelService } from '../services/signals/ExecutionModelService';
import { createDefaultBlockRegistry } from '../services/signals/blocks/createDefaultBlockRegistry';
import { getTier1ComposedSignalSeeds } from '../services/signals/tier1ComposedSignals';
import { ExecutionConfigInput } from '../services/signals/types';

dotenv.config();

export type Summary = {
    trades: number;
    netPnl: number;
    netR: number;
    winRate: number;
    maxDd: number;
    profitFactor: number | null;
};

export type VariantResult = {
    variantId: string;
    variantLabel: string;
    changeSummary: string;
    baseSignalCode: string;
    baseSignalName: string;
    timeframe: string;
    exitProfile: string;
    summary: Summary;
};

export type OutputFile = {
    generatedAt: string;
    group: string;
    groupLabel: string;
    symbol: string;
    from: string;
    to: string;
    initialEquity: number;
    riskPercent: number;
    executionConfig: ExecutionConfigInput;
    baseSignalCode: string;
    baseSignalName: string;
    notes?: string[];
    results: VariantResult[];
};

export type ExitProfile =
    | 'HARD_SIGNAL_TP'
    | 'PARTIAL_1R_BE_SWING_TRAIL'
    | 'BE_1R_TP_2R'
    | 'BE_1R_TRAIL_2R_3R'
    | 'TIME_24';

export type VariantSpec = {
    id: string;
    label: string;
    changeSummary: string;
    exitProfile: ExitProfile;
    mutate(definition: ComposedSignalDefinition): void;
};

export const FROM = new Date('2019-01-01T00:00:00.000Z');
export const TO = new Date('2026-03-14T23:59:59.999Z');
export const SYMBOL = 'XAUUSD';
export const INITIAL_EQUITY = 10_000;
export const RISK_PERCENT = 2;
export const BASE_SIGNAL_CODE = 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG';
export const DEFAULT_OUT_DIR = '.artifacts/xau-abc-m5-optimization';
export const DEFAULT_EXECUTION_CONFIG: ExecutionConfigInput = {
    entryFeeBps: 4,
    exitFeeBps: 4,
    entrySlippageBps: 2,
    exitSlippageBps: 2,
    orderTiming: 'NEXT_BAR_OPEN',
    stopLoss: { mode: 'SIGNAL_PRICE' },
    takeProfit: { mode: 'SIGNAL_PRICE' },
    positionSizing: { mode: 'RISK_BASED' },
};

export const M5_BASELINES: Record<'HARD_SIGNAL_TP' | 'PARTIAL_1R_BE_SWING_TRAIL', Summary> = {
    HARD_SIGNAL_TP: {
        trades: 2455,
        netPnl: 214665.77,
        netR: 955.79,
        winRate: 52.18,
        maxDd: -3.82,
        profitFactor: 1.81,
    },
    PARTIAL_1R_BE_SWING_TRAIL: {
        trades: 2455,
        netPnl: 79149.3,
        netR: 349.08,
        winRate: 62.97,
        maxDd: -3.82,
        profitFactor: 1.39,
    },
};

const M5_WINDOW_BARS = 24;
const M5_STOP_LOOKBACK = 72;

const jsonClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

type StopLossWithLookback = NonNullable<ComposedSignalDefinition['stopLoss']> & {
    lookback: number;
    value?: number;
    atrBufferMultiplier?: number;
    atrPeriod?: number;
};

function getBaseSeed() {
    const baseSeed = getTier1ComposedSignalSeeds().find((seed) => seed.code === BASE_SIGNAL_CODE);
    if (!baseSeed) {
        throw new Error(`Base seed ${BASE_SIGNAL_CODE} was not found.`);
    }
    return baseSeed;
}

function summarize(results: Array<{ isOpen: boolean; pnlUsd: number; rMultiple: number; win: boolean; maxDrawdownPct: number }>) {
    const closed = results.filter((row) => !row.isOpen);
    const netPnl = closed.reduce((sum, row) => sum + Number(row.pnlUsd), 0);
    const netR = closed.reduce((sum, row) => sum + Number(row.rMultiple), 0);
    const wins = closed.filter((row) => row.win).length;
    const maxDd = closed.length ? Math.min(...closed.map((row) => Number(row.maxDrawdownPct))) : 0;
    const grossWin = closed
        .filter((row) => Number(row.pnlUsd) > 0)
        .reduce((sum, row) => sum + Number(row.pnlUsd), 0);
    const grossLoss = Math.abs(closed
        .filter((row) => Number(row.pnlUsd) < 0)
        .reduce((sum, row) => sum + Number(row.pnlUsd), 0));

    return {
        trades: closed.length,
        netPnl: Number(netPnl.toFixed(2)),
        netR: Number(netR.toFixed(2)),
        winRate: closed.length ? Number(((wins / closed.length) * 100).toFixed(2)) : 0,
        maxDd: Number(maxDd.toFixed(2)),
        profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : null,
    } satisfies Summary;
}

function parseArgs(argv: string[], defaultOutPath: string) {
    let outPath = defaultOutPath;

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--out') {
            const value = argv[index + 1];
            if (!value) {
                throw new Error('--out requires a filepath.');
            }
            outPath = value;
            index += 1;
            continue;
        }

        throw new Error(`Unknown argument "${arg}".`);
    }

    return { outPath };
}

export function applyM5Base(definition: ComposedSignalDefinition) {
    (definition as ComposedSignalDefinition & { timeframe?: string }).timeframe = 'M5';
    definition.windowBars = M5_WINDOW_BARS;
    if (definition.stopLoss && typeof definition.stopLoss === 'object' && 'lookback' in definition.stopLoss) {
        (definition.stopLoss as StopLossWithLookback).lookback = M5_STOP_LOOKBACK;
    }
}

export function getBlock(definition: ComposedSignalDefinition, indicatorId: string) {
    const block = definition.blocks.find((entry) => entry.indicatorId === indicatorId);
    if (!block) {
        throw new Error(`Missing indicator block ${indicatorId} in ${BASE_SIGNAL_CODE}.`);
    }
    return block;
}

export function setLondonSession(definition: ComposedSignalDefinition, startHour: number, endHour: number) {
    getBlock(definition, 'SESSION_FILTER').indicatorParams = { startHour, endHour };
}

export function setRsiThreshold(definition: ComposedSignalDefinition, threshold: number) {
    getBlock(definition, 'RSI').conditionParams = { threshold };
}

export function setAtrMultiplier(definition: ComposedSignalDefinition, multiplier: number) {
    getBlock(definition, 'ATR_REGIME').conditionParams = { multiplier };
}

export function setStopLookback(definition: ComposedSignalDefinition, lookback: number) {
    if (!definition.stopLoss || typeof definition.stopLoss !== 'object' || !('lookback' in definition.stopLoss)) {
        throw new Error('Stop loss lookback is not available on the base signal.');
    }
    (definition.stopLoss as StopLossWithLookback).lookback = lookback;
}

export function setAtrBufferMultiplier(definition: ComposedSignalDefinition, atrBufferMultiplier: number) {
    if (!definition.stopLoss || typeof definition.stopLoss !== 'object' || !('lookback' in definition.stopLoss)) {
        throw new Error('ATR buffer is not available on the base signal.');
    }
    const stopLoss = definition.stopLoss as StopLossWithLookback;
    stopLoss.atrBufferMultiplier = atrBufferMultiplier;
    stopLoss.atrPeriod = stopLoss.atrPeriod ?? 14;
}

export function setTakeProfitMultiple(definition: ComposedSignalDefinition, multiple: number) {
    if (!definition.takeProfit || typeof definition.takeProfit !== 'object') {
        throw new Error('Take profit is not configured on the base signal.');
    }
    definition.takeProfit = {
        type: 'R_MULTIPLE',
        value: multiple,
    };
}

export function addPriceAboveEma(definition: ComposedSignalDefinition) {
    definition.blocks.push({
        id: 'ema_hold_m5',
        indicatorId: 'EMA_CROSS',
        conditionId: 'price_above_ema',
        indicatorParams: { fastPeriod: 21, slowPeriod: 55 },
        conditionParams: {},
    });
}

export function setSignalAreaGuard(
    definition: ComposedSignalDefinition,
    config: {
        maxSignalsPerArea: number;
        resetBars?: number;
        priceDistanceR?: number;
    },
) {
    definition.entryManagement = {
        ...definition.entryManagement,
        signalAreaGuard: {
            maxSignalsPerArea: config.maxSignalsPerArea,
            resetBars: config.resetBars,
            priceDistanceR: config.priceDistanceR,
        },
    };
}

export function addBullishMarketRegime(definition: ComposedSignalDefinition) {
    definition.blocks.push({
        id: 'regime_bull_m5',
        indicatorId: 'MARKET_REGIME',
        conditionId: 'regime_trending_bullish',
        indicatorParams: { adxPeriod: 14, atrPeriod: 14, emaFilterPeriod: 200 },
        conditionParams: { adxThreshold: 25 },
    });
}

export async function runVariantGroup(config: {
    group: string;
    groupLabel: string;
    variants: VariantSpec[];
    defaultOutPath: string;
    notes?: string[];
}) {
    const args = parseArgs(process.argv.slice(2), config.defaultOutPath);
    const baseSeed = getBaseSeed();
    const prisma = new PrismaClient();
    const registry = SignalRegistry.getInstance();
    const runner = new SignalBacktestRunner(
        new CandleQueryService(prisma),
        new IndicatorSeriesService(),
        new ExecutionModelService(),
        registry,
    );
    const blockRegistry = createDefaultBlockRegistry();
    const results: VariantResult[] = [];

    try {
        console.log(`Running XAU ABC optimization group "${config.group}" (${config.groupLabel})`);
        console.log(`Range: ${FROM.toISOString()} -> ${TO.toISOString()}`);

        for (const variant of config.variants) {
            const definition = jsonClone(baseSeed.composedBlocks) as ComposedSignalDefinition;
            applyM5Base(definition);
            variant.mutate(definition);
            definition.exitManagement = { profileCode: variant.exitProfile };

            const timeframe = String((definition as { timeframe?: string }).timeframe ?? 'M5');
            const tmpCode = `XAB_${config.group}_${variant.id}`.slice(0, 60).toUpperCase();
            registry.register(new ComposedSignalPlugin(
                definition,
                blockRegistry,
                tmpCode,
                1,
                tmpCode,
            ));

            try {
                const output = await runner.run({
                    signalCode: tmpCode,
                    signalVersion: 1,
                    symbol: SYMBOL,
                    timeframe,
                    from: FROM,
                    to: TO,
                    parameters: {},
                    initialEquity: INITIAL_EQUITY,
                    riskPercent: RISK_PERCENT,
                    executionConfig: DEFAULT_EXECUTION_CONFIG,
                });

                const summary = summarize(output.results as Array<{
                    isOpen: boolean;
                    pnlUsd: number;
                    rMultiple: number;
                    win: boolean;
                    maxDrawdownPct: number;
                }>);

                results.push({
                    variantId: variant.id,
                    variantLabel: variant.label,
                    changeSummary: variant.changeSummary,
                    baseSignalCode: baseSeed.code,
                    baseSignalName: baseSeed.name,
                    timeframe,
                    exitProfile: variant.exitProfile,
                    summary,
                });

                console.log(`[DONE] ${variant.id}: PnL=${summary.netPnl}, WR=${summary.winRate}%`);
            } finally {
                registry.unregister(tmpCode, 1);
            }
        }
    } finally {
        await prisma.$disconnect();
    }

    const outputFile: OutputFile = {
        generatedAt: new Date().toISOString(),
        group: config.group,
        groupLabel: config.groupLabel,
        symbol: SYMBOL,
        from: FROM.toISOString(),
        to: TO.toISOString(),
        initialEquity: INITIAL_EQUITY,
        riskPercent: RISK_PERCENT,
        executionConfig: DEFAULT_EXECUTION_CONFIG,
        baseSignalCode: baseSeed.code,
        baseSignalName: baseSeed.name,
        notes: config.notes,
        results,
    };

    const resolvedPath = path.resolve(args.outPath);
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    fs.writeFileSync(resolvedPath, JSON.stringify(outputFile, null, 2));
    console.log(`Saved JSON output to ${resolvedPath}`);
    console.table(results.map((row) => ({
        Variant: row.variantId,
        Exit: row.exitProfile,
        NetPnL: row.summary.netPnl,
        NetR: row.summary.netR,
        WR: `${row.summary.winRate}%`,
        DD: `${row.summary.maxDd}%`,
        Trades: row.summary.trades,
        PF: row.summary.profitFactor,
    })));
}
