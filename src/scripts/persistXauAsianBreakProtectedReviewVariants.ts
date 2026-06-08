import dotenv from 'dotenv';
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

const SYSTEM_ACTOR = 'codex:xau-abc-protected-review';
const BATCH_TAG = 'xau-abc-protected-review-2026-03-14';
const REVIEW_SYMBOL = 'XAUUSD';
const REVIEW_DATE_RANGE = {
    from: '2019-01-01T00:00:00.000Z',
    to: '2026-03-14T23:59:59.999Z',
};

const BASE_EXECUTION_CONFIG: ExecutionConfigInput = {
    entryFeeBps: 4,
    exitFeeBps: 4,
    entrySlippageBps: 2,
    exitSlippageBps: 2,
    orderTiming: 'NEXT_BAR_OPEN',
    stopLoss: { mode: 'SIGNAL_PRICE' },
    takeProfit: { mode: 'SIGNAL_PRICE' },
    positionSizing: { mode: 'RISK_BASED' },
    tradeGuards: {
        lossStreakThrottle: {
            steps: [
                { afterLosses: 2, riskPercent: 0.5 },
                { afterLosses: 4, riskPercent: 0.25 },
            ],
        },
        sessionLossCap: {
            maxLosses: 2,
            maxNetR: 2,
        },
        dayLossCap: {
            maxNetR: 3,
        },
    },
};

type TimeframeKey = 'M5' | 'M15';

type ReviewVariant = {
    code: string;
    label: string;
    description: string;
    timeframe: TimeframeKey;
    atrMultiplier: number;
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
    executionConfig: ExecutionConfigInput;
    createdRuns: PersistedReviewRun[];
};

const TIMEFRAME_TUNING: Record<TimeframeKey, { windowBars: number; stopLookback: number }> = {
    M5: { windowBars: 24, stopLookback: 72 },
    M15: { windowBars: 8, stopLookback: 24 },
};

const jsonClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const riskSummaryService = new BacktestRiskSummaryService();

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
    tradeGuards: {
        ...base.tradeGuards,
        ...override?.tradeGuards,
        lossStreakThrottle: {
            ...base.tradeGuards?.lossStreakThrottle,
            ...override?.tradeGuards?.lossStreakThrottle,
        },
        sessionLossCap: {
            ...base.tradeGuards?.sessionLossCap,
            ...override?.tradeGuards?.sessionLossCap,
        },
        dayLossCap: {
            ...base.tradeGuards?.dayLossCap,
            ...override?.tradeGuards?.dayLossCap,
        },
    },
});

const findBlock = (
    definition: ComposedSignalDefinition,
    indicatorId: string,
): ComposedBlockConfig => {
    const block = definition.blocks.find((entry) => entry.indicatorId === indicatorId);
    if (!block) {
        throw new Error(`Unable to find block ${indicatorId}.`);
    }
    return block;
};

const applyTimeframe = (definition: ComposedSignalDefinition, timeframe: TimeframeKey) => {
    const tuning = TIMEFRAME_TUNING[timeframe];
    (definition as ComposedSignalDefinition & { timeframe?: string }).timeframe = timeframe;
    definition.windowBars = tuning.windowBars;
    definition.exitManagement = { profileCode: 'HARD_SIGNAL_TP' };
    if (definition.stopLoss && typeof definition.stopLoss === 'object' && 'lookback' in definition.stopLoss) {
        definition.stopLoss.lookback = tuning.stopLookback;
    }
};

const applyVariant = (definition: ComposedSignalDefinition, variant: ReviewVariant) => {
    applyTimeframe(definition, variant.timeframe);
    findBlock(definition, 'ATR_REGIME').conditionParams = { multiplier: variant.atrMultiplier };
};

const formatVariantName = (label: string, version: number) => (
    `XAU Review - Protected Asian Break - ${label} v${version}`
);

const buildRunNotes = (variant: ReviewVariant, version: number) => (
    `[${BATCH_TAG}] ${variant.code}@${version} | ${variant.label} | ${variant.description}`
);

const VARIANTS: ReviewVariant[] = [
    {
        code: 'XAU_ABC_M5_ATR12_GUARD_REVIEW',
        label: 'M5 ATR 1.2 Guard',
        description: 'Protected M5 Asian Break Continuation benchmark focused on peak Net PnL.',
        timeframe: 'M5',
        atrMultiplier: 1.2,
    },
    {
        code: 'XAU_ABC_M5_ATR14_GUARD_REVIEW',
        label: 'M5 ATR 1.4 Guard',
        description: 'Protected M5 Asian Break Continuation quality benchmark with stronger ATR filtering.',
        timeframe: 'M5',
        atrMultiplier: 1.4,
    },
    {
        code: 'XAU_ABC_M15_ATR14_GUARD_REVIEW',
        label: 'M15 ATR 1.4 Guard',
        description: 'Protected M15 Asian Break Continuation deployment candidate with stronger ATR filtering.',
        timeframe: 'M15',
        atrMultiplier: 1.4,
    },
];

const GROUPS = {
    m5_atr12: {
        label: 'Persist protected M5 ATR 1.2 review candidate',
        codes: ['XAU_ABC_M5_ATR12_GUARD_REVIEW'],
    },
    m5_atr14: {
        label: 'Persist protected M5 ATR 1.4 review candidate',
        codes: ['XAU_ABC_M5_ATR14_GUARD_REVIEW'],
    },
    m15_atr14: {
        label: 'Persist protected M15 ATR 1.4 review candidate',
        codes: ['XAU_ABC_M15_ATR14_GUARD_REVIEW'],
    },
    all: {
        label: 'Persist all protected review candidates',
        codes: VARIANTS.map((variant) => variant.code),
    },
} satisfies Record<string, { label: string; codes: string[] }>;

function printUsage() {
    console.log([
        'Usage:',
        '  node -r ts-node/register src/scripts/persistXauAsianBreakProtectedReviewVariants.ts --list-groups',
        '  node -r ts-node/register src/scripts/persistXauAsianBreakProtectedReviewVariants.ts --group m5_atr12 --out .artifacts/xau-abc-protected-review/m5_atr12.json',
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
        outPath: string | null;
    } = {
        listGroups: false,
        group: 'all',
        outPath: null,
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
            name: formatVariantName(variant.label, version),
            category: 'xau_abc_protected_review',
            description: variant.description,
            parameterSchema: {} as Prisma.InputJsonValue,
            indicatorSchema: {
                blocks: indicatorIds,
                batchTag: BATCH_TAG,
                reviewSymbol: REVIEW_SYMBOL,
                timeframe: variant.timeframe,
                atrMultiplier: variant.atrMultiplier,
            } as Prisma.InputJsonValue,
            eventSchema: {
                profileCode: definition.exitManagement?.profileCode ?? 'HARD_SIGNAL_TP',
                batchTag: BATCH_TAG,
                reviewVariant: variant.code,
                timeframe: variant.timeframe,
                atrMultiplier: variant.atrMultiplier,
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
    if (args.listGroups) {
        console.log('Available protected review persist groups:');
        for (const [groupKey, group] of Object.entries(GROUPS)) {
            console.log(`- ${groupKey}: ${group.label}`);
            console.log(`  candidates: ${group.codes.join(', ')}`);
        }
        return;
    }

    const prisma = new PrismaClient();
    const backtestRuns = new SignalBacktestRunService(prisma);
    const execution = new SignalBacktestExecutionService(prisma, {
        deliverConfiguredOutputs: async () => [],
    });

    try {
        const baseSeed = getTier1ComposedSignalSeeds().find((seed) => seed.code === 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG');
        if (!baseSeed) {
            throw new Error('Unable to locate SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG seed definition.');
        }
        const selectedGroup = GROUPS[args.group];
        const variants = VARIANTS.filter((variant) => selectedGroup.codes.includes(variant.code));

        const createdRuns: PersistedReviewRun[] = [];

        for (const variant of variants) {
            const version = await getNextVersion(prisma, variant.code);
            const composedDefinition = jsonClone(baseSeed.composedBlocks);
            applyVariant(composedDefinition, variant);

            const createdDefinition = await createReviewDefinition(
                prisma,
                variant,
                version,
                composedDefinition,
            );

            const executionConfig = mergeExecutionConfig(BASE_EXECUTION_CONFIG);
            const createdBacktest = await backtestRuns.createGeneratedBacktest({
                signalCode: createdDefinition.code,
                signalVersion: createdDefinition.version,
                symbol: REVIEW_SYMBOL,
                timeframe: variant.timeframe,
                dateRange: REVIEW_DATE_RANGE,
                parameters: {},
                executionConfig,
                initialEquity: 10_000,
                riskPercent: 1,
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
            groupLabel: selectedGroup.label,
            batchTag: BATCH_TAG,
            symbol: REVIEW_SYMBOL,
            dateRange: REVIEW_DATE_RANGE,
            executionConfig: BASE_EXECUTION_CONFIG,
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
