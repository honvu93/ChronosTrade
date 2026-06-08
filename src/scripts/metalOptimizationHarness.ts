import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { ComposedBlockConfig, ComposedSignalDefinition, ComposedSignalPlugin, MatchMode } from '../services/signals/ComposedSignalPlugin';
import { SignalRegistry } from '../services/signals/SignalRegistry';
import { SignalBacktestRunner } from '../services/signals/SignalBacktestRunner';
import { CandleQueryService } from '../services/signals/CandleQueryService';
import { IndicatorSeriesService } from '../services/signals/IndicatorSeriesService';
import { ExecutionModelService } from '../services/signals/ExecutionModelService';
import { createDefaultBlockRegistry } from '../services/signals/blocks/createDefaultBlockRegistry';
import { getTier1ComposedSignalSeeds } from '../services/signals/tier1ComposedSignals';
import { BacktestRiskSummary, BacktestRiskSummaryService } from '../services/signals/BacktestRiskSummaryService';
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

export type MetalVariantResult = {
    variantId: string;
    variantLabel: string;
    changeSummary: string;
    baseSignalCode: string;
    baseSignalName: string;
    timeframe: string;
    exitProfile: string;
    riskPercent: number;
    executionConfig: ExecutionConfigInput;
    summary: Summary;
    riskSummary: BacktestRiskSummary;
};

export type MetalOutputFile = {
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
    results: MetalVariantResult[];
};

export type ExitProfile =
    | 'HARD_SIGNAL_TP'
    | 'PARTIAL_1R_BE_SWING_TRAIL'
    | 'BE_1R_TP_2R'
    | 'BE_1R_TRAIL_2R_3R'
    | 'TIME_24';

export type MetalHarnessConfig = {
    symbol: string;
    from: Date;
    to: Date;
    initialEquity: number;
    riskPercent: number;
    baseSignalCode: string;
    defaultOutDir: string;
    codePrefix: string;
    defaultExecutionConfig: ExecutionConfigInput;
};

export type MetalVariantSpec = {
    id: string;
    label: string;
    changeSummary: string;
    baseSignalCode?: string;
    exitProfile?: ExitProfile;
    riskPercent?: number;
    executionConfigOverride?: Partial<ExecutionConfigInput>;
    mutate(definition: ComposedSignalDefinition): void;
};

type StopLossWithLookback = NonNullable<ComposedSignalDefinition['stopLoss']> & {
    lookback: number;
    value?: number;
    atrBufferMultiplier?: number;
    atrPeriod?: number;
};

const jsonClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function summarize(results: Array<{ isOpen: boolean; pnlUsd: number; rMultiple: number; win: boolean; maxDrawdownPct: number }>) {
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

export function parseOutArg(argv: string[], defaultOutPath: string) {
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

        if (arg === '--group') {
            const value = argv[index + 1];
            if (!value) {
                throw new Error('--group requires a value.');
            }
            index += 1;
            continue;
        }

        if (arg === '--list-groups') {
            continue;
        }

        throw new Error(`Unknown argument "${arg}".`);
    }

    return { outPath };
}

function mergeExecutionConfig(
    base: ExecutionConfigInput,
    override?: Partial<ExecutionConfigInput>,
): ExecutionConfigInput {
    if (!override) {
        return base;
    }

    return {
        ...base,
        ...override,
        stopLoss: {
            ...base.stopLoss,
            ...override.stopLoss,
        },
        takeProfit: {
            ...base.takeProfit,
            ...override.takeProfit,
        },
        positionSizing: {
            ...base.positionSizing,
            ...override.positionSizing,
        },
        tradeGuards: {
            ...base.tradeGuards,
            ...override.tradeGuards,
            lossStreakThrottle: {
                ...base.tradeGuards?.lossStreakThrottle,
                ...override.tradeGuards?.lossStreakThrottle,
                steps: override.tradeGuards?.lossStreakThrottle?.steps
                    ?? base.tradeGuards?.lossStreakThrottle?.steps,
            },
            lossStreakCooldown: {
                ...base.tradeGuards?.lossStreakCooldown,
                ...override.tradeGuards?.lossStreakCooldown,
            },
            sessionLossCap: {
                ...base.tradeGuards?.sessionLossCap,
                ...override.tradeGuards?.sessionLossCap,
            },
            dayLossCap: {
                ...base.tradeGuards?.dayLossCap,
                ...override.tradeGuards?.dayLossCap,
            },
        },
    };
}

export function getBaseSeed(baseSignalCode: string) {
    const baseSeed = getTier1ComposedSignalSeeds().find((seed) => seed.code === baseSignalCode);
    if (!baseSeed) {
        throw new Error(`Base seed ${baseSignalCode} was not found.`);
    }
    return baseSeed;
}

export function setTimeframe(definition: ComposedSignalDefinition, timeframe: string) {
    (definition as ComposedSignalDefinition & { timeframe?: string }).timeframe = timeframe;
}

export function getBlock(definition: ComposedSignalDefinition, indicatorId: string) {
    const block = definition.blocks.find((entry) => entry.indicatorId === indicatorId);
    if (!block) {
        throw new Error(`Missing indicator block ${indicatorId}.`);
    }
    return block;
}

export function setMatchMode(definition: ComposedSignalDefinition, matchMode: MatchMode, windowBars?: number) {
    definition.matchMode = matchMode;
    if (windowBars !== undefined) {
        definition.windowBars = windowBars;
    }
}

export function reorderBlocks(definition: ComposedSignalDefinition, indicatorIds: string[]) {
    const remaining = [...definition.blocks];
    const ordered: ComposedBlockConfig[] = [];

    for (const indicatorId of indicatorIds) {
        const index = remaining.findIndex((block) => block.indicatorId === indicatorId);
        if (index === -1) {
            throw new Error(`Cannot reorder missing indicator block ${indicatorId}.`);
        }
        ordered.push(remaining[index]!);
        remaining.splice(index, 1);
    }

    definition.blocks = [...ordered, ...remaining];
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
        throw new Error('Stop loss lookback is not available on this signal.');
    }
    (definition.stopLoss as StopLossWithLookback).lookback = lookback;
}

export function setAtrBufferMultiplier(definition: ComposedSignalDefinition, atrBufferMultiplier: number) {
    if (!definition.stopLoss || typeof definition.stopLoss !== 'object' || !('lookback' in definition.stopLoss)) {
        throw new Error('ATR buffer is not available on this signal.');
    }
    const stopLoss = definition.stopLoss as StopLossWithLookback;
    stopLoss.atrBufferMultiplier = atrBufferMultiplier;
    stopLoss.atrPeriod = stopLoss.atrPeriod ?? 14;
}

export function setTakeProfitMultiple(definition: ComposedSignalDefinition, multiple: number) {
    if (!definition.takeProfit || typeof definition.takeProfit !== 'object') {
        throw new Error('Take profit is not configured on this signal.');
    }
    definition.takeProfit = {
        type: 'R_MULTIPLE',
        value: multiple,
    };
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

export function addPriceAboveEma(definition: ComposedSignalDefinition) {
    definition.blocks.push({
        id: `ema_hold_${definition.blocks.length + 1}`,
        indicatorId: 'EMA_CROSS',
        conditionId: 'price_above_ema',
        indicatorParams: { fastPeriod: 21, slowPeriod: 55 },
        conditionParams: {},
    });
}

export function addBullishMarketRegime(definition: ComposedSignalDefinition) {
    definition.blocks.push({
        id: `regime_bull_${definition.blocks.length + 1}`,
        indicatorId: 'MARKET_REGIME',
        conditionId: 'regime_trending_bullish',
        indicatorParams: { adxPeriod: 14, atrPeriod: 14, emaFilterPeriod: 200 },
        conditionParams: { adxThreshold: 25 },
    });
}

export function addConfirmationUptrend(definition: ComposedSignalDefinition, params: {
    fastPeriod: number;
    slowPeriod: number;
    adxPeriod: number;
    adxThreshold: number;
}) {
    definition.blocks.push({
        id: `confirmation_up_${definition.blocks.length + 1}`,
        indicatorId: 'CONFIRMATION_TREND',
        conditionId: 'confirmation_uptrend',
        indicatorParams: {
            fastPeriod: params.fastPeriod,
            slowPeriod: params.slowPeriod,
            adxPeriod: params.adxPeriod,
        },
        conditionParams: {
            adxThreshold: params.adxThreshold,
        },
    });
}

export function addTrendCatcherBearish(definition: ComposedSignalDefinition, params: {
    fastPeriod: number;
    slowPeriod: number;
    rsiPeriod: number;
    rsiThreshold: number;
}) {
    definition.blocks.push({
        id: `trend_catcher_bear_${definition.blocks.length + 1}`,
        indicatorId: 'TREND_CATCHER',
        conditionId: 'trend_catcher_bearish',
        indicatorParams: {
            fastPeriod: params.fastPeriod,
            slowPeriod: params.slowPeriod,
            rsiPeriod: params.rsiPeriod,
        },
        conditionParams: {
            rsiThreshold: params.rsiThreshold,
        },
    });
}

export function applyM5Base(definition: ComposedSignalDefinition, stopLookback = 72, windowBars = 24) {
    setTimeframe(definition, 'M5');
    definition.windowBars = windowBars;
    if (definition.stopLoss && typeof definition.stopLoss === 'object' && 'lookback' in definition.stopLoss) {
        (definition.stopLoss as StopLossWithLookback).lookback = stopLookback;
    }
}

export async function runMetalVariantGroup(config: {
    harness: MetalHarnessConfig;
    group: string;
    groupLabel: string;
    variants: MetalVariantSpec[];
    defaultOutPath: string;
    notes?: string[];
}) {
    const args = parseOutArg(process.argv.slice(2), config.defaultOutPath);
    const defaultBaseSeed = getBaseSeed(config.harness.baseSignalCode);
    const prisma = new PrismaClient();
    const registry = SignalRegistry.getInstance();
    const runner = new SignalBacktestRunner(
        new CandleQueryService(prisma),
        new IndicatorSeriesService(),
        new ExecutionModelService(),
        registry,
    );
    const blockRegistry = createDefaultBlockRegistry();
    const riskSummaryService = new BacktestRiskSummaryService();
    const results: MetalVariantResult[] = [];

    try {
        console.log(`Running metal optimization group "${config.group}" (${config.groupLabel})`);
        console.log(`Range: ${config.harness.from.toISOString()} -> ${config.harness.to.toISOString()}`);

        for (const variant of config.variants) {
            const baseSignalCode = variant.baseSignalCode ?? config.harness.baseSignalCode;
            const baseSeed = baseSignalCode === defaultBaseSeed.code
                ? defaultBaseSeed
                : getBaseSeed(baseSignalCode);
            const definition = jsonClone(baseSeed.composedBlocks) as ComposedSignalDefinition;
            variant.mutate(definition);

            if (variant.exitProfile) {
                definition.exitManagement = { profileCode: variant.exitProfile };
            }

            const timeframe = String((definition as { timeframe?: string }).timeframe ?? 'M15');
            const riskPercent = variant.riskPercent ?? config.harness.riskPercent;
            const executionConfig = mergeExecutionConfig(
                config.harness.defaultExecutionConfig,
                variant.executionConfigOverride,
            );
            const tmpCode = `${config.harness.codePrefix}_${config.group}_${variant.id}`.slice(0, 60).toUpperCase();

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
                    symbol: config.harness.symbol,
                    timeframe,
                    from: config.harness.from,
                    to: config.harness.to,
                    parameters: {},
                    initialEquity: config.harness.initialEquity,
                    riskPercent,
                    executionConfig,
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
                    exitProfile: definition.exitManagement?.profileCode ?? 'HARD_SIGNAL_TP',
                    riskPercent,
                    executionConfig,
                    summary,
                    riskSummary: riskSummaryService.summarize({
                        initialEquity: config.harness.initialEquity,
                        results: output.results,
                        signals: output.signals,
                        events: output.events,
                        traces: output.traces,
                    }),
                });

                console.log(`[DONE] ${variant.id}: PnL=${summary.netPnl}, WR=${summary.winRate}%`);
            } finally {
                registry.unregister(tmpCode, 1);
            }
        }
    } finally {
        await prisma.$disconnect();
    }

    const outputFile: MetalOutputFile = {
        generatedAt: new Date().toISOString(),
        group: config.group,
        groupLabel: config.groupLabel,
        symbol: config.harness.symbol,
        from: config.harness.from.toISOString(),
        to: config.harness.to.toISOString(),
        initialEquity: config.harness.initialEquity,
        riskPercent: config.harness.riskPercent,
        executionConfig: config.harness.defaultExecutionConfig,
        baseSignalCode: config.harness.baseSignalCode,
        baseSignalName: defaultBaseSeed.name,
        notes: config.notes,
        results,
    };

    const resolvedPath = path.resolve(args.outPath);
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    fs.writeFileSync(resolvedPath, JSON.stringify(outputFile, null, 2));
    console.log(`Saved JSON output to ${resolvedPath}`);
    console.table(results.map((row) => ({
        Variant: row.variantId,
        Base: row.baseSignalCode,
        Exit: row.exitProfile,
        Risk: `${row.riskPercent}%`,
        NetPnL: row.summary.netPnl,
        WR: `${row.summary.winRate}%`,
        EqDD: `${row.riskSummary.equityCurveMaxDdPct}%`,
        Trades: row.summary.trades,
        PF: row.summary.profitFactor,
    })));
}
