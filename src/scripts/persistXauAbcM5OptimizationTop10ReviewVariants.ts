import dotenv from 'dotenv';
import { Prisma, PrismaClient } from '@prisma/client';
import { SignalBacktestExecutionService } from '../services/signals/SignalBacktestExecutionService';
import { SignalBacktestRunService } from '../services/signals/SignalBacktestRunService';
import { BacktestRiskSummary, BacktestRiskSummaryService } from '../services/signals/BacktestRiskSummaryService';
import { ComposedSignalDefinition } from '../services/signals/ComposedSignalPlugin';
import { createDefaultBlockRegistry } from '../services/signals/blocks/createDefaultBlockRegistry';
import { validateComposedSignalDefinition } from '../services/signals/composedSignalValidation';
import { getTier1ComposedSignalSeeds } from '../services/signals/tier1ComposedSignals';
import { ExecutionConfigInput } from '../services/signals/types';
import {
    BASE_SIGNAL_CODE,
    DEFAULT_EXECUTION_CONFIG,
    FROM,
    SYMBOL,
    TO,
    addPriceAboveEma,
    applyM5Base,
    setAtrBufferMultiplier,
    setAtrMultiplier,
    setRsiThreshold,
    setStopLookback,
    setTakeProfitMultiple,
} from './xauAbcOptimizationShared';

dotenv.config();

const SYSTEM_ACTOR = 'codex:xau-abc-m5-top10-review';
const BATCH_TAG = 'xau-abc-m5-top10-review-2026-03-15';
const REVIEW_DATE_RANGE = {
    from: FROM.toISOString(),
    to: TO.toISOString(),
};

type RunSummary = {
    trades: number;
    netPnl: number;
    netR: number;
    winRate: number;
    maxDd: number;
    profitFactor: number | null;
};

type ReviewVariant = {
    id: string;
    code: string;
    label: string;
    description: string;
    refLane: 'M5 hard';
    expectedNetPnl: number;
    mutate(definition: ComposedSignalDefinition): void;
};

type PersistedReviewRun = {
    signalDefinitionId: string;
    signalCode: string;
    signalVersion: number;
    signalName: string;
    backtestRunId: string;
    detailPath: string;
    notes: string;
    variantId: string;
    summary: RunSummary;
    riskSummary: BacktestRiskSummary;
};

type OutputFile = {
    generatedAt: string;
    batchTag: string;
    symbol: string;
    dateRange: typeof REVIEW_DATE_RANGE;
    executionConfig: ExecutionConfigInput;
    selectedRanking: 'top_10_by_net_pnl';
    createdRuns: PersistedReviewRun[];
};

const jsonClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const riskSummaryService = new BacktestRiskSummaryService();

const VARIANTS: ReviewVariant[] = [
    {
        id: 'b4_tp25_hard',
        code: 'XAU_ABC_M5_B4_TP25_HARD_REVIEW',
        label: 'M5 TP 2.5R Hard',
        description: 'Top-10 Net PnL M5 optimization candidate that raises the target from 2.0R to 2.5R.',
        refLane: 'M5 hard',
        expectedNetPnl: 293710.31,
        mutate(definition) {
            applyM5Base(definition);
            setTakeProfitMultiple(definition, 2.5);
            definition.exitManagement = { profileCode: 'HARD_SIGNAL_TP' };
        },
    },
    {
        id: 'b4_lookback96_hard',
        code: 'XAU_ABC_M5_B4_LOOKBACK96_HARD_REVIEW',
        label: 'M5 Stop Lookback 96 Hard',
        description: 'Top-10 Net PnL M5 optimization candidate with a looser 96-bar structure stop.',
        refLane: 'M5 hard',
        expectedNetPnl: 244156.97,
        mutate(definition) {
            applyM5Base(definition);
            setStopLookback(definition, 96);
            definition.exitManagement = { profileCode: 'HARD_SIGNAL_TP' };
        },
    },
    {
        id: 'b4_buffer015_hard',
        code: 'XAU_ABC_M5_B4_BUFFER015_HARD_REVIEW',
        label: 'M5 ATR Buffer 0.15 Hard',
        description: 'Top-10 Net PnL M5 optimization candidate with tighter ATR stop buffer 0.15.',
        refLane: 'M5 hard',
        expectedNetPnl: 215424.62,
        mutate(definition) {
            applyM5Base(definition);
            setAtrBufferMultiplier(definition, 0.15);
            definition.exitManagement = { profileCode: 'HARD_SIGNAL_TP' };
        },
    },
    {
        id: 'b4_buffer030_hard',
        code: 'XAU_ABC_M5_B4_BUFFER030_HARD_REVIEW',
        label: 'M5 ATR Buffer 0.30 Hard',
        description: 'Top-10 Net PnL M5 optimization candidate with wider ATR stop buffer 0.30.',
        refLane: 'M5 hard',
        expectedNetPnl: 214925.62,
        mutate(definition) {
            applyM5Base(definition);
            setAtrBufferMultiplier(definition, 0.3);
            definition.exitManagement = { profileCode: 'HARD_SIGNAL_TP' };
        },
    },
    {
        id: 'b5_ema_hold_hard',
        code: 'XAU_ABC_M5_B5_EMA_HOLD_HARD_REVIEW',
        label: 'M5 EMA Hold Hard',
        description: 'Top-10 Net PnL M5 optimization candidate that adds the EMA price-above filter.',
        refLane: 'M5 hard',
        expectedNetPnl: 214665.77,
        mutate(definition) {
            applyM5Base(definition);
            addPriceAboveEma(definition);
            definition.exitManagement = { profileCode: 'HARD_SIGNAL_TP' };
        },
    },
    {
        id: 'b2_rsi56_hard',
        code: 'XAU_ABC_M5_B2_RSI56_HARD_REVIEW',
        label: 'M5 RSI 56 Hard',
        description: 'Top-10 Net PnL M5 optimization candidate with RSI threshold raised to 56.',
        refLane: 'M5 hard',
        expectedNetPnl: 210983.37,
        mutate(definition) {
            applyM5Base(definition);
            setRsiThreshold(definition, 56);
            definition.exitManagement = { profileCode: 'HARD_SIGNAL_TP' };
        },
    },
    {
        id: 'b4_lookback60_hard',
        code: 'XAU_ABC_M5_B4_LOOKBACK60_HARD_REVIEW',
        label: 'M5 Stop Lookback 60 Hard',
        description: 'Top-10 Net PnL M5 optimization candidate with a tighter 60-bar structure stop.',
        refLane: 'M5 hard',
        expectedNetPnl: 203382.68,
        mutate(definition) {
            applyM5Base(definition);
            setStopLookback(definition, 60);
            definition.exitManagement = { profileCode: 'HARD_SIGNAL_TP' };
        },
    },
    {
        id: 'b2_rsi58_hard',
        code: 'XAU_ABC_M5_B2_RSI58_HARD_REVIEW',
        label: 'M5 RSI 58 Hard',
        description: 'Top-10 Net PnL M5 optimization candidate with RSI threshold raised to 58.',
        refLane: 'M5 hard',
        expectedNetPnl: 202588.42,
        mutate(definition) {
            applyM5Base(definition);
            setRsiThreshold(definition, 58);
            definition.exitManagement = { profileCode: 'HARD_SIGNAL_TP' };
        },
    },
    {
        id: 'b4_lookback48_hard',
        code: 'XAU_ABC_M5_B4_LOOKBACK48_HARD_REVIEW',
        label: 'M5 Stop Lookback 48 Hard',
        description: 'Top-10 Net PnL M5 optimization candidate with a tighter 48-bar structure stop.',
        refLane: 'M5 hard',
        expectedNetPnl: 195306.81,
        mutate(definition) {
            applyM5Base(definition);
            setStopLookback(definition, 48);
            definition.exitManagement = { profileCode: 'HARD_SIGNAL_TP' };
        },
    },
    {
        id: 'b1_atr125_hard',
        code: 'XAU_ABC_M5_B1_ATR125_HARD_REVIEW',
        label: 'M5 ATR 1.25 Hard',
        description: 'Top-10 Net PnL M5 optimization candidate with ATR expansion multiplier 1.25.',
        refLane: 'M5 hard',
        expectedNetPnl: 183631.18,
        mutate(definition) {
            applyM5Base(definition);
            setAtrMultiplier(definition, 1.25);
            definition.exitManagement = { profileCode: 'HARD_SIGNAL_TP' };
        },
    },
];

function printUsage() {
    console.log([
        'Usage:',
        '  node -r ts-node/register src/scripts/persistXauAbcM5OptimizationTop10ReviewVariants.ts --out .artifacts/xau-abc-m5-optimization/xau-abc-m5-top10-review.json',
        '',
        'Options:',
        '  --out <path>   Where to write the JSON output file',
    ].join('\n'));
}

function parseArgs(argv: string[]) {
    const result: { outPath: string | null } = { outPath: null };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--out') {
            const value = argv[index + 1];
            if (!value) {
                throw new Error('--out requires a filepath.');
            }
            result.outPath = value;
            index += 1;
            continue;
        }
        throw new Error(`Unknown argument "${arg}".`);
    }

    return result;
}

async function getNextVersion(prisma: PrismaClient, code: string): Promise<number> {
    const latest = await prisma.signalDefinition.findFirst({
        where: { code },
        select: { version: true },
        orderBy: { version: 'desc' },
    });

    return (latest?.version ?? 0) + 1;
}

async function createReviewDefinition(
    prisma: PrismaClient,
    variant: ReviewVariant,
    version: number,
    definition: ComposedSignalDefinition,
) {
    const blockRegistry = createDefaultBlockRegistry();
    const issues = validateComposedSignalDefinition(definition, blockRegistry);
    if (issues.length > 0) {
        throw new Error([
            `Variant ${variant.code}@${version} failed validation:`,
            ...issues.map((issue) => `- ${issue.message}`),
        ].join('\n'));
    }

    const indicatorIds = Array.from(new Set(definition.blocks.map((block) => block.indicatorId)));

    return prisma.signalDefinition.create({
        data: {
            code: variant.code,
            version,
            name: `XAU Review - M5 Optimization - ${variant.label} v${version}`,
            category: 'xau_abc_m5_optimization_review',
            description: variant.description,
            parameterSchema: {} as Prisma.InputJsonValue,
            indicatorSchema: {
                blocks: indicatorIds,
                batchTag: BATCH_TAG,
                reviewSymbol: SYMBOL,
                timeframe: 'M5',
                variantId: variant.id,
                ranking: 'top_10_by_net_pnl',
                expectedNetPnl: variant.expectedNetPnl,
                refLane: variant.refLane,
            } as Prisma.InputJsonValue,
            eventSchema: {
                profileCode: definition.exitManagement?.profileCode ?? 'HARD_SIGNAL_TP',
                batchTag: BATCH_TAG,
                reviewVariant: variant.id,
                ranking: 'top_10_by_net_pnl',
            } as Prisma.InputJsonValue,
            composedBlocks: definition as unknown as Prisma.InputJsonValue,
            isComposed: true,
            isActive: true,
            createdBy: SYSTEM_ACTOR,
        },
        select: {
            id: true,
            code: true,
            version: true,
            name: true,
        },
    });
}

async function summarizeRun(prisma: PrismaClient, backtestRunId: string): Promise<RunSummary> {
    const rows = await prisma.backtestTradeResult.findMany({
        where: {
            backtestRunId,
            isOpen: false,
        },
        select: {
            pnlUsd: true,
            rMultiple: true,
            win: true,
            maxDrawdownPct: true,
        },
    });

    const netPnl = rows.reduce((sum, row) => sum + Number(row.pnlUsd), 0);
    const netR = rows.reduce((sum, row) => sum + Number(row.rMultiple), 0);
    const wins = rows.filter((row) => row.win).length;
    const maxDd = rows.length ? Math.min(...rows.map((row) => Number(row.maxDrawdownPct))) : 0;
    const grossWin = rows
        .filter((row) => Number(row.pnlUsd) > 0)
        .reduce((sum, row) => sum + Number(row.pnlUsd), 0);
    const grossLoss = Math.abs(rows
        .filter((row) => Number(row.pnlUsd) < 0)
        .reduce((sum, row) => sum + Number(row.pnlUsd), 0));

    return {
        trades: rows.length,
        netPnl: Number(netPnl.toFixed(2)),
        netR: Number(netR.toFixed(2)),
        winRate: rows.length ? Number(((wins / rows.length) * 100).toFixed(2)) : 0,
        maxDd: Number(maxDd.toFixed(2)),
        profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : null,
    };
}

async function summarizeRisk(prisma: PrismaClient, backtestRunId: string): Promise<BacktestRiskSummary> {
    const run = await prisma.backtestRun.findUnique({
        where: { id: backtestRunId },
        select: { initialEquity: true },
    });
    if (!run) {
        throw new Error(`Run ${backtestRunId} not found for risk summary.`);
    }

    const [signals, events, traces, results] = await Promise.all([
        prisma.signal.findMany({
            where: { backtestRunId },
            select: {
                externalKey: true,
                executionConfigJson: true,
            },
        }),
        prisma.signalEvent.findMany({
            where: { backtestRunId },
            select: {
                label: true,
                signal: {
                    select: {
                        externalKey: true,
                    },
                },
            },
        }),
        prisma.signalLogicTrace.findMany({
            where: { backtestRunId },
            select: {
                ruleId: true,
                signal: {
                    select: {
                        externalKey: true,
                    },
                },
            },
        }),
        prisma.backtestTradeResult.findMany({
            where: { backtestRunId, isOpen: false },
            select: {
                rMultiple: true,
                pnlUsd: true,
                isOpen: true,
                exitTime: true,
                signal: {
                    select: {
                        externalKey: true,
                    },
                },
            },
        }),
    ]);

    return riskSummaryService.summarize({
        initialEquity: Number(run.initialEquity),
        signals: signals.map((signal) => ({
            externalKey: signal.externalKey,
            executionConfigJson: signal.executionConfigJson && typeof signal.executionConfigJson === 'object'
                ? signal.executionConfigJson as Record<string, unknown>
                : null,
        })),
        events: events
            .filter((event): event is typeof event & { signal: { externalKey: string | null } } => Boolean(event.signal))
            .map((event) => ({
                signalExternalKey: event.signal.externalKey ?? '',
                label: event.label,
            })),
        traces: traces
            .filter((trace): trace is typeof trace & { signal: { externalKey: string | null } } => Boolean(trace.signal))
            .map((trace) => ({
                signalExternalKey: trace.signal.externalKey ?? '',
                ruleId: trace.ruleId,
            })),
        results: results.map((result) => ({
            signalExternalKey: result.signal.externalKey ?? '',
            rMultiple: Number(result.rMultiple),
            pnlUsd: Number(result.pnlUsd),
            isOpen: result.isOpen,
            exitTime: result.exitTime,
        })),
    });
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const prisma = new PrismaClient();
    const backtestRuns = new SignalBacktestRunService(prisma);
    const execution = new SignalBacktestExecutionService(prisma, {
        deliverConfiguredOutputs: async () => [],
    });

    try {
        const baseSeed = getTier1ComposedSignalSeeds().find((seed) => seed.code === BASE_SIGNAL_CODE);
        if (!baseSeed) {
            throw new Error(`Unable to locate ${BASE_SIGNAL_CODE} seed definition.`);
        }

        const createdRuns: PersistedReviewRun[] = [];

        for (const variant of VARIANTS) {
            const version = await getNextVersion(prisma, variant.code);
            const composedDefinition = jsonClone(baseSeed.composedBlocks);
            variant.mutate(composedDefinition);

            const createdDefinition = await createReviewDefinition(
                prisma,
                variant,
                version,
                composedDefinition,
            );

            const createdBacktest = await backtestRuns.createGeneratedBacktest({
                signalCode: createdDefinition.code,
                signalVersion: createdDefinition.version,
                symbol: SYMBOL,
                timeframe: 'M5',
                dateRange: REVIEW_DATE_RANGE,
                parameters: {},
                executionConfig: DEFAULT_EXECUTION_CONFIG,
                initialEquity: 10_000,
                riskPercent: 2,
                notes: `[${BATCH_TAG}] ${variant.id} | ${variant.label} | expectedNetPnl=${variant.expectedNetPnl}`,
            });

            await execution.executeRun(createdBacktest.backtestRunId);

            createdRuns.push({
                signalDefinitionId: createdDefinition.id,
                signalCode: createdDefinition.code,
                signalVersion: createdDefinition.version,
                signalName: createdDefinition.name,
                backtestRunId: createdBacktest.backtestRunId,
                detailPath: `/signals/backtests/${createdBacktest.backtestRunId}`,
                notes: `[${BATCH_TAG}] ${variant.id} | ${variant.label} | expectedNetPnl=${variant.expectedNetPnl}`,
                variantId: variant.id,
                summary: await summarizeRun(prisma, createdBacktest.backtestRunId),
                riskSummary: await summarizeRisk(prisma, createdBacktest.backtestRunId),
            });
        }

        const outputFile: OutputFile = {
            generatedAt: new Date().toISOString(),
            batchTag: BATCH_TAG,
            symbol: SYMBOL,
            dateRange: REVIEW_DATE_RANGE,
            executionConfig: DEFAULT_EXECUTION_CONFIG,
            selectedRanking: 'top_10_by_net_pnl',
            createdRuns,
        };

        if (args.outPath) {
            const fs = await import('fs');
            const path = await import('path');
            const resolvedPath = path.resolve(args.outPath);
            fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
            fs.writeFileSync(resolvedPath, JSON.stringify(outputFile, null, 2));
            console.log(`Saved JSON output to ${resolvedPath}`);
        } else {
            console.log(JSON.stringify(outputFile, null, 2));
        }
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    printUsage();
    process.exit(1);
});
