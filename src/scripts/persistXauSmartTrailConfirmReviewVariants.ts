import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { Prisma, PrismaClient } from '@prisma/client';
import { ComposedBlockConfig, ComposedSignalDefinition } from '../services/signals/ComposedSignalPlugin';
import { SignalBacktestExecutionService } from '../services/signals/SignalBacktestExecutionService';
import { SignalBacktestRunService } from '../services/signals/SignalBacktestRunService';
import { BacktestRiskSummary, BacktestRiskSummaryService } from '../services/signals/BacktestRiskSummaryService';
import { createDefaultBlockRegistry } from '../services/signals/blocks/createDefaultBlockRegistry';
import { validateComposedSignalDefinition } from '../services/signals/composedSignalValidation';
import { getTier1ComposedSignalSeeds } from '../services/signals/tier1ComposedSignals';
import { ExecutionConfigInput } from '../services/signals/types';

dotenv.config();

const SYSTEM_ACTOR = 'codex:xau-smart-trail-review';
const BATCH_TAG = 'xau-smart-trail-review-2026-03-15';
const REVIEW_SYMBOL = 'XAUUSD';
const REVIEW_DATE_RANGE = {
    from: '2019-01-01T00:00:00.000Z',
    to: '2026-03-14T23:59:59.999Z',
};
const DEFAULT_OUT = '.artifacts/xau-smart-trail-confirm-review/xau-smart-trail-confirm-review.json';

const BASE_EXECUTION_CONFIG: ExecutionConfigInput = {
    entryFeeBps: 4,
    exitFeeBps: 4,
    entrySlippageBps: 2,
    exitSlippageBps: 2,
    orderTiming: 'NEXT_BAR_OPEN',
    stopLoss: { mode: 'SIGNAL_PRICE' },
    takeProfit: { mode: 'SIGNAL_PRICE' },
    positionSizing: { mode: 'RISK_BASED' },
};

type VariantKey =
    | 'm15_long_base'
    | 'm15_short_base'
    | 'm15_long_seq'
    | 'm15_short_seq'
    | 'm5_long_seq'
    | 'm5_short_seq';

type ReviewVariant = {
    key: VariantKey;
    code: string;
    label: string;
    description: string;
    baseSeedCode: 'SYS_XAU_SMART_TRAIL_CONFIRM_LONG' | 'SYS_XAU_SMART_TRAIL_CONFIRM_SHORT';
    timeframe: 'M5' | 'M15';
    matchMode?: 'ALL' | 'ANY' | 'SEQUENCE';
    windowBars?: number;
    blockOrder?: string[];
    smartTrail?: { atrPeriod: number; multiplier: number; conditionId?: string };
    confirmation?: { fastPeriod: number; slowPeriod: number; adxPeriod: number; adxThreshold: number; conditionId?: string };
    trendCatcher?: { fastPeriod: number; slowPeriod: number; rsiPeriod: number; rsiThreshold: number; conditionId?: string };
    stopLoss?: { value: number; lookback: number; atrBufferMultiplier: number; atrPeriod: number };
    takeProfitR?: number;
    exitProfileCode?: 'HARD_SIGNAL_TP' | 'BE_1R_TP_2R';
    executionConfig?: Partial<ExecutionConfigInput>;
    riskPercent?: number;
};

type RunSummary = {
    trades: number;
    netPnl: number;
    netR: number;
    winRate: number;
    maxDd: number;
    profitFactor: number | null;
};

type PersistedReviewRun = {
    signalDefinitionId: string;
    signalCode: string;
    signalVersion: number;
    signalName: string;
    backtestRunId: string;
    detailPath: string;
    notes: string;
    summary: RunSummary;
    riskSummary: BacktestRiskSummary;
};

type OutputFile = {
    generatedAt: string;
    group: string;
    groupLabel: string;
    batchTag: string;
    symbol: string;
    dateRange: typeof REVIEW_DATE_RANGE;
    createdRuns: PersistedReviewRun[];
};

const VARIANTS: ReviewVariant[] = [
    {
        key: 'm15_long_base',
        code: 'XAU_STC_M15_LONG_BASE_REVIEW',
        label: 'M15 Long Base',
        description: 'Baseline Smart Trail Confirmation long seed using original ALL matching and NEXT_BAR_OPEN execution.',
        baseSeedCode: 'SYS_XAU_SMART_TRAIL_CONFIRM_LONG',
        timeframe: 'M15',
        riskPercent: 2,
    },
    {
        key: 'm15_short_base',
        code: 'XAU_STC_M15_SHORT_BASE_REVIEW',
        label: 'M15 Short Base',
        description: 'Baseline Smart Trail Confirmation short seed using original ALL matching and NEXT_BAR_OPEN execution.',
        baseSeedCode: 'SYS_XAU_SMART_TRAIL_CONFIRM_SHORT',
        timeframe: 'M15',
        riskPercent: 2,
    },
    {
        key: 'm15_long_seq',
        code: 'XAU_STC_M15_LONG_SEQ_REVIEW',
        label: 'M15 Long Sequence Pullback',
        description: 'Sequence-based long entry: uptrend confirmed first, bearish pullback detected next, then Smart Trail flips bullish on the entry bar.',
        baseSeedCode: 'SYS_XAU_SMART_TRAIL_CONFIRM_LONG',
        timeframe: 'M15',
        matchMode: 'SEQUENCE',
        windowBars: 6,
        blockOrder: ['CONFIRMATION_TREND', 'TREND_CATCHER', 'SMART_TRAIL_SWITCH'],
        smartTrail: { atrPeriod: 10, multiplier: 2.5, conditionId: 'bullish_switch' },
        confirmation: { fastPeriod: 34, slowPeriod: 144, adxPeriod: 14, adxThreshold: 18, conditionId: 'confirmation_uptrend' },
        trendCatcher: { fastPeriod: 8, slowPeriod: 21, rsiPeriod: 14, rsiThreshold: 48, conditionId: 'trend_catcher_bearish' },
        stopLoss: { value: 0.0018, lookback: 32, atrBufferMultiplier: 0.2, atrPeriod: 14 },
        takeProfitR: 2.5,
        exitProfileCode: 'HARD_SIGNAL_TP',
        executionConfig: { orderTiming: 'SIGNAL_BAR_CLOSE' },
        riskPercent: 2,
    },
    {
        key: 'm15_short_seq',
        code: 'XAU_STC_M15_SHORT_SEQ_REVIEW',
        label: 'M15 Short Sequence Pullback',
        description: 'Sequence-based short entry: downtrend confirmed first, bullish rebound detected next, then Smart Trail flips bearish on the entry bar.',
        baseSeedCode: 'SYS_XAU_SMART_TRAIL_CONFIRM_SHORT',
        timeframe: 'M15',
        matchMode: 'SEQUENCE',
        windowBars: 6,
        blockOrder: ['CONFIRMATION_TREND', 'TREND_CATCHER', 'SMART_TRAIL_SWITCH'],
        smartTrail: { atrPeriod: 10, multiplier: 2.5, conditionId: 'bearish_switch' },
        confirmation: { fastPeriod: 34, slowPeriod: 144, adxPeriod: 14, adxThreshold: 18, conditionId: 'confirmation_downtrend' },
        trendCatcher: { fastPeriod: 8, slowPeriod: 21, rsiPeriod: 14, rsiThreshold: 52, conditionId: 'trend_catcher_bullish' },
        stopLoss: { value: 0.0018, lookback: 32, atrBufferMultiplier: 0.2, atrPeriod: 14 },
        takeProfitR: 2.5,
        exitProfileCode: 'HARD_SIGNAL_TP',
        executionConfig: { orderTiming: 'SIGNAL_BAR_CLOSE' },
        riskPercent: 2,
    },
    {
        key: 'm5_long_seq',
        code: 'XAU_STC_M5_LONG_SEQ_REVIEW',
        label: 'M5 Long Sequence Pullback',
        description: 'Faster M5 long sequence with tighter trail settings and SIGNAL_BAR_CLOSE execution for micro pullback continuation.',
        baseSeedCode: 'SYS_XAU_SMART_TRAIL_CONFIRM_LONG',
        timeframe: 'M5',
        matchMode: 'SEQUENCE',
        windowBars: 12,
        blockOrder: ['CONFIRMATION_TREND', 'TREND_CATCHER', 'SMART_TRAIL_SWITCH'],
        smartTrail: { atrPeriod: 7, multiplier: 2.2, conditionId: 'bullish_switch' },
        confirmation: { fastPeriod: 21, slowPeriod: 89, adxPeriod: 14, adxThreshold: 16, conditionId: 'confirmation_uptrend' },
        trendCatcher: { fastPeriod: 5, slowPeriod: 13, rsiPeriod: 14, rsiThreshold: 47, conditionId: 'trend_catcher_bearish' },
        stopLoss: { value: 0.0014, lookback: 48, atrBufferMultiplier: 0.15, atrPeriod: 14 },
        takeProfitR: 2.2,
        exitProfileCode: 'HARD_SIGNAL_TP',
        executionConfig: { orderTiming: 'SIGNAL_BAR_CLOSE' },
        riskPercent: 1,
    },
    {
        key: 'm5_short_seq',
        code: 'XAU_STC_M5_SHORT_SEQ_REVIEW',
        label: 'M5 Short Sequence Pullback',
        description: 'Faster M5 short sequence with tighter trail settings and SIGNAL_BAR_CLOSE execution for micro rebound continuation.',
        baseSeedCode: 'SYS_XAU_SMART_TRAIL_CONFIRM_SHORT',
        timeframe: 'M5',
        matchMode: 'SEQUENCE',
        windowBars: 12,
        blockOrder: ['CONFIRMATION_TREND', 'TREND_CATCHER', 'SMART_TRAIL_SWITCH'],
        smartTrail: { atrPeriod: 7, multiplier: 2.2, conditionId: 'bearish_switch' },
        confirmation: { fastPeriod: 21, slowPeriod: 89, adxPeriod: 14, adxThreshold: 16, conditionId: 'confirmation_downtrend' },
        trendCatcher: { fastPeriod: 5, slowPeriod: 13, rsiPeriod: 14, rsiThreshold: 53, conditionId: 'trend_catcher_bullish' },
        stopLoss: { value: 0.0014, lookback: 48, atrBufferMultiplier: 0.15, atrPeriod: 14 },
        takeProfitR: 2.2,
        exitProfileCode: 'HARD_SIGNAL_TP',
        executionConfig: { orderTiming: 'SIGNAL_BAR_CLOSE' },
        riskPercent: 1,
    },
];

const GROUPS = {
    base: {
        label: 'Persist current M15 baseline long and short seeds',
        keys: ['m15_long_base', 'm15_short_base'] as VariantKey[],
    },
    long_sequence: {
        label: 'Persist only the positive long-side sequence winners for M15 and M5',
        keys: ['m15_long_seq', 'm5_long_seq'] as VariantKey[],
    },
    sequence: {
        label: 'Persist tuned sequence variants for M15 and M5',
        keys: ['m15_long_seq', 'm15_short_seq', 'm5_long_seq', 'm5_short_seq'] as VariantKey[],
    },
    all: {
        label: 'Persist all Smart Trail review variants',
        keys: VARIANTS.map((variant) => variant.key),
    },
} satisfies Record<string, { label: string; keys: VariantKey[] }>;

const riskSummaryService = new BacktestRiskSummaryService();

const jsonClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function printUsage() {
    console.log([
        'Usage:',
        '  node -r ts-node/register src/scripts/persistXauSmartTrailConfirmReviewVariants.ts --list-groups',
        `  node -r ts-node/register src/scripts/persistXauSmartTrailConfirmReviewVariants.ts --group all --out ${DEFAULT_OUT}`,
        '',
        'Options:',
        '  --list-groups         Show available chunk names',
        '  --group <name>        One of: ' + Object.keys(GROUPS).join(', '),
        '  --out <path>          Where to write the JSON output file',
    ].join('\n'));
}

function parseArgs(argv: string[]) {
    const result: {
        listGroups: boolean;
        group: keyof typeof GROUPS;
        outPath: string;
    } = {
        listGroups: false,
        group: 'all',
        outPath: DEFAULT_OUT,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--list-groups') {
            result.listGroups = true;
            continue;
        }
        if (arg === '--group') {
            const value = argv[index + 1];
            if (!value || !(value in GROUPS)) {
                throw new Error(`Unknown --group value "${value ?? ''}".`);
            }
            result.group = value as keyof typeof GROUPS;
            index += 1;
            continue;
        }
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

function findBlock(definition: ComposedSignalDefinition, indicatorId: string): ComposedBlockConfig {
    const block = definition.blocks.find((entry) => entry.indicatorId === indicatorId);
    if (!block) {
        throw new Error(`Unable to find block ${indicatorId}.`);
    }
    return block;
}

function reorderBlocks(definition: ComposedSignalDefinition, blockOrder: string[]) {
    const ordered = blockOrder.map((indicatorId) => findBlock(definition, indicatorId));
    definition.blocks = ordered;
}

function applyVariant(definition: ComposedSignalDefinition, variant: ReviewVariant) {
    (definition as ComposedSignalDefinition & { timeframe?: string }).timeframe = variant.timeframe;
    if (variant.matchMode) {
        definition.matchMode = variant.matchMode;
    }
    if (variant.windowBars !== undefined) {
        definition.windowBars = variant.windowBars;
    }
    if (variant.blockOrder) {
        reorderBlocks(definition, variant.blockOrder);
    }
    if (variant.smartTrail) {
        const block = findBlock(definition, 'SMART_TRAIL_SWITCH');
        block.indicatorParams = {
            atrPeriod: variant.smartTrail.atrPeriod,
            multiplier: variant.smartTrail.multiplier,
        };
        if (variant.smartTrail.conditionId) {
            block.conditionId = variant.smartTrail.conditionId;
        }
    }
    if (variant.confirmation) {
        const block = findBlock(definition, 'CONFIRMATION_TREND');
        block.indicatorParams = {
            fastPeriod: variant.confirmation.fastPeriod,
            slowPeriod: variant.confirmation.slowPeriod,
            adxPeriod: variant.confirmation.adxPeriod,
        };
        block.conditionParams = {
            adxThreshold: variant.confirmation.adxThreshold,
        };
        if (variant.confirmation.conditionId) {
            block.conditionId = variant.confirmation.conditionId;
        }
    }
    if (variant.trendCatcher) {
        const block = findBlock(definition, 'TREND_CATCHER');
        block.indicatorParams = {
            fastPeriod: variant.trendCatcher.fastPeriod,
            slowPeriod: variant.trendCatcher.slowPeriod,
            rsiPeriod: variant.trendCatcher.rsiPeriod,
        };
        block.conditionParams = {
            rsiThreshold: variant.trendCatcher.rsiThreshold,
        };
        if (variant.trendCatcher.conditionId) {
            block.conditionId = variant.trendCatcher.conditionId;
        }
    }
    if (variant.stopLoss) {
        definition.stopLoss = {
            type: 'BELOW_STRUCTURE',
            value: variant.stopLoss.value,
            lookback: variant.stopLoss.lookback,
            atrBufferMultiplier: variant.stopLoss.atrBufferMultiplier,
            atrPeriod: variant.stopLoss.atrPeriod,
        };
    }
    if (variant.takeProfitR !== undefined) {
        definition.takeProfit = { type: 'R_MULTIPLE', value: variant.takeProfitR };
    }
    if (variant.exitProfileCode) {
        definition.exitManagement = { profileCode: variant.exitProfileCode };
    }
}

const mergeExecutionConfig = (
    base: ExecutionConfigInput,
    override?: Partial<ExecutionConfigInput>,
): ExecutionConfigInput => ({
    ...base,
    ...override,
    stopLoss: {
        ...base.stopLoss,
        ...override?.stopLoss,
    },
    takeProfit: {
        ...base.takeProfit,
        ...override?.takeProfit,
    },
    positionSizing: {
        ...base.positionSizing,
        ...override?.positionSizing,
    },
});

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
            name: `XAU Review - Smart Trail - ${variant.label} v${version}`,
            category: 'xau_smart_trail_review',
            description: variant.description,
            parameterSchema: {} as Prisma.InputJsonValue,
            indicatorSchema: {
                blocks: indicatorIds,
                batchTag: BATCH_TAG,
                baseSeedCode: variant.baseSeedCode,
                timeframe: variant.timeframe,
                matchMode: definition.matchMode,
                windowBars: definition.windowBars,
            } as Prisma.InputJsonValue,
            eventSchema: {
                profileCode: definition.exitManagement?.profileCode ?? 'HARD_SIGNAL_TP',
                batchTag: BATCH_TAG,
                reviewVariant: variant.code,
                timeframe: variant.timeframe,
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
        where: { backtestRunId, isOpen: false },
        select: { pnlUsd: true, rMultiple: true, win: true, maxDrawdownPct: true },
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
            select: { externalKey: true, executionConfigJson: true },
        }),
        prisma.signalEvent.findMany({
            where: { backtestRunId },
            select: {
                label: true,
                signal: { select: { externalKey: true } },
            },
        }),
        prisma.signalLogicTrace.findMany({
            where: { backtestRunId },
            select: {
                ruleId: true,
                signal: { select: { externalKey: true } },
            },
        }),
        prisma.backtestTradeResult.findMany({
            where: { backtestRunId, isOpen: false },
            select: {
                rMultiple: true,
                pnlUsd: true,
                isOpen: true,
                exitTime: true,
                signal: { select: { externalKey: true } },
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

function buildRunNotes(variant: ReviewVariant, version: number) {
    return `[${BATCH_TAG}] ${variant.code}@${version} | ${variant.label} | ${variant.description}`;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.listGroups) {
        console.log('Available Smart Trail review groups:');
        for (const [groupKey, group] of Object.entries(GROUPS)) {
            console.log(`- ${groupKey}: ${group.label}`);
            console.log(`  candidates: ${group.keys.join(', ')}`);
        }
        return;
    }

    const prisma = new PrismaClient();
    const backtestRuns = new SignalBacktestRunService(prisma);
    const execution = new SignalBacktestExecutionService(prisma, {
        deliverConfiguredOutputs: async () => [],
    });

    try {
        const seeds = getTier1ComposedSignalSeeds();
        const group = GROUPS[args.group];
        const variants = VARIANTS.filter((variant) => group.keys.includes(variant.key));
        const createdRuns: PersistedReviewRun[] = [];

        for (const variant of variants) {
            const seed = seeds.find((entry) => entry.code === variant.baseSeedCode);
            if (!seed) {
                throw new Error(`Unable to locate ${variant.baseSeedCode}.`);
            }

            const version = await getNextVersion(prisma, variant.code);
            const composedDefinition = jsonClone(seed.composedBlocks);
            applyVariant(composedDefinition, variant);

            const createdDefinition = await createReviewDefinition(prisma, variant, version, composedDefinition);
            const executionConfig = mergeExecutionConfig(BASE_EXECUTION_CONFIG, variant.executionConfig);
            const createdBacktest = await backtestRuns.createGeneratedBacktest({
                signalCode: createdDefinition.code,
                signalVersion: createdDefinition.version,
                symbol: REVIEW_SYMBOL,
                timeframe: variant.timeframe,
                dateRange: REVIEW_DATE_RANGE,
                parameters: {},
                executionConfig,
                initialEquity: 10_000,
                riskPercent: variant.riskPercent ?? 2,
                notes: buildRunNotes(variant, createdDefinition.version),
            });

            await execution.executeRun(createdBacktest.backtestRunId);

            createdRuns.push({
                signalDefinitionId: createdDefinition.id,
                signalCode: createdDefinition.code,
                signalVersion: createdDefinition.version,
                signalName: createdDefinition.name,
                backtestRunId: createdBacktest.backtestRunId,
                detailPath: `/signals/backtests/${createdBacktest.backtestRunId}`,
                notes: buildRunNotes(variant, createdDefinition.version),
                summary: await summarizeRun(prisma, createdBacktest.backtestRunId),
                riskSummary: await summarizeRisk(prisma, createdBacktest.backtestRunId),
            });
        }

        const outputFile: OutputFile = {
            generatedAt: new Date().toISOString(),
            group: args.group,
            groupLabel: group.label,
            batchTag: BATCH_TAG,
            symbol: REVIEW_SYMBOL,
            dateRange: REVIEW_DATE_RANGE,
            createdRuns,
        };

        const resolved = path.resolve(args.outPath);
        fs.mkdirSync(path.dirname(resolved), { recursive: true });
        fs.writeFileSync(resolved, JSON.stringify(outputFile, null, 2));
        console.log(`Saved JSON output to ${resolved}`);
        console.table(createdRuns.map((run) => ({
            Variant: `${run.signalCode}@${run.signalVersion}`,
            TF: run.notes.includes('M5') ? 'M5' : 'M15',
            NetPnL: run.summary.netPnl,
            WR: `${run.summary.winRate}%`,
            PF: run.summary.profitFactor,
            Trades: run.summary.trades,
            RunId: run.backtestRunId,
        })));
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    printUsage();
    process.exit(1);
});
