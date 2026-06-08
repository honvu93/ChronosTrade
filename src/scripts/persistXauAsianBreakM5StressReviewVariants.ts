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

const SYSTEM_ACTOR = 'codex:xau-abc-m5-stress-review';
const BATCH_TAG = 'xau-abc-m5-stress-review-2026-03-15';
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

type Summary = {
    trades: number;
    netPnl: number;
    netR: number;
    winRate: number;
    maxDd: number;
    profitFactor: number | null;
};

type CandidateSpec = {
    id: 'm5_atr12_guard' | 'm5_atr14_guard';
    label: string;
    atrMultiplier: number;
    description: string;
};

type StressSpec = {
    id: 'baseline' | 'stress_1' | 'stress_2' | 'stress_3';
    label: string;
    entryFeeBps: number;
    exitFeeBps: number;
    entrySlippageBps: number;
    exitSlippageBps: number;
};

type ReviewVariant = {
    code: string;
    label: string;
    description: string;
    candidate: CandidateSpec;
    stress: StressSpec;
};

type PersistedReviewRun = {
    signalDefinitionId: string;
    signalCode: string;
    signalVersion: number;
    signalName: string;
    backtestRunId: string;
    detailPath: string;
    notes: string;
    summary: Summary;
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

const CANDIDATES: CandidateSpec[] = [
    {
        id: 'm5_atr12_guard',
        label: 'M5 ATR 1.2 Guard',
        atrMultiplier: 1.2,
        description: 'Higher PnL stress candidate with wider guard participation and larger operational drawdown.',
    },
    {
        id: 'm5_atr14_guard',
        label: 'M5 ATR 1.4 Guard',
        atrMultiplier: 1.4,
        description: 'Higher quality stress candidate with stronger PF and lower equity drawdown than ATR 1.2.',
    },
];

const STRESS_CASES: StressSpec[] = [
    {
        id: 'baseline',
        label: 'Baseline 4/4 fee 2/2 slip',
        entryFeeBps: 4,
        exitFeeBps: 4,
        entrySlippageBps: 2,
        exitSlippageBps: 2,
    },
    {
        id: 'stress_1',
        label: 'Stress 1 6/6 fee 3/3 slip',
        entryFeeBps: 6,
        exitFeeBps: 6,
        entrySlippageBps: 3,
        exitSlippageBps: 3,
    },
    {
        id: 'stress_2',
        label: 'Stress 2 8/8 fee 4/4 slip',
        entryFeeBps: 8,
        exitFeeBps: 8,
        entrySlippageBps: 4,
        exitSlippageBps: 4,
    },
    {
        id: 'stress_3',
        label: 'Stress 3 10/10 fee 5/5 slip',
        entryFeeBps: 10,
        exitFeeBps: 10,
        entrySlippageBps: 5,
        exitSlippageBps: 5,
    },
];

const TOP_LIMIT = 10;

const VARIANTS: ReviewVariant[] = CANDIDATES.flatMap((candidate) => STRESS_CASES.map((stress) => ({
    code: `XAU_ABC_${candidate.id.toUpperCase()}_${stress.id.toUpperCase()}_REVIEW`,
    label: `${candidate.label} - ${stress.label}`,
    description: `${candidate.description} Stress profile: ${stress.label}.`,
    candidate,
    stress,
})));

const GROUPS = {
    top_rows: {
        label: 'Persist top stress review rows for UI chart inspection',
        variantCodes: VARIANTS.slice(0, TOP_LIMIT).map((variant) => variant.code),
    },
    all: {
        label: 'Persist every row in the M5 stress review matrix',
        variantCodes: VARIANTS.map((variant) => variant.code),
    },
} satisfies Record<string, { label: string; variantCodes: string[] }>;

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

const applyVariant = (definition: ComposedSignalDefinition, variant: ReviewVariant) => {
    (definition as ComposedSignalDefinition & { timeframe?: string }).timeframe = 'M5';
    definition.windowBars = 24;
    definition.exitManagement = { profileCode: 'HARD_SIGNAL_TP' };
    if (definition.stopLoss && typeof definition.stopLoss === 'object' && 'lookback' in definition.stopLoss) {
        definition.stopLoss.lookback = 72;
    }
    findBlock(definition, 'ATR_REGIME').conditionParams = { multiplier: variant.candidate.atrMultiplier };
};

const formatVariantName = (label: string, version: number) => (
    `XAU Review - M5 Stress - ${label} v${version}`
);

const buildRunNotes = (variant: ReviewVariant, version: number) => (
    `[${BATCH_TAG}] ${variant.code}@${version} | ${variant.label} | candidate=${variant.candidate.id} | stress=${variant.stress.id}`
);

function printUsage() {
    console.log([
        'Usage:',
        '  node -r ts-node/register src/scripts/persistXauAsianBreakM5StressReviewVariants.ts --list-groups',
        '  node -r ts-node/register src/scripts/persistXauAsianBreakM5StressReviewVariants.ts --group top_rows --out .artifacts/xau-abc-m5-stress-review/top_rows.json',
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
        group: 'top_rows',
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
            category: 'xau_abc_m5_stress_review',
            description: variant.description,
            parameterSchema: {} as Prisma.InputJsonValue,
            indicatorSchema: {
                blocks: indicatorIds,
                batchTag: BATCH_TAG,
                reviewSymbol: REVIEW_SYMBOL,
                timeframe: 'M5',
                atrMultiplier: variant.candidate.atrMultiplier,
                stressId: variant.stress.id,
            } as Prisma.InputJsonValue,
            eventSchema: {
                profileCode: definition.exitManagement?.profileCode ?? 'HARD_SIGNAL_TP',
                batchTag: BATCH_TAG,
                reviewVariant: variant.code,
                candidateId: variant.candidate.id,
                stressId: variant.stress.id,
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

async function summarizeRun(prisma: PrismaClient, backtestRunId: string): Promise<Summary> {
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

async function findCompletedVariantRun(
    prisma: PrismaClient,
    variant: ReviewVariant,
): Promise<PersistedReviewRun | null> {
    const existingRun = await prisma.backtestRun.findFirst({
        where: {
            signalCode: variant.code,
            status: 'COMPLETED',
            notes: {
                contains: BATCH_TAG,
            },
        },
        select: {
            id: true,
            signalCode: true,
            signalVersion: true,
            notes: true,
        },
        orderBy: {
            createdAt: 'desc',
        },
    });

    if (!existingRun?.signalCode || !existingRun.signalVersion) {
        return null;
    }

    const definition = await prisma.signalDefinition.findFirst({
        where: {
            code: existingRun.signalCode,
            version: existingRun.signalVersion,
        },
        select: {
            id: true,
            name: true,
        },
    });

    return {
        signalDefinitionId: definition?.id ?? '',
        signalCode: existingRun.signalCode,
        signalVersion: existingRun.signalVersion,
        signalName: definition?.name ?? existingRun.signalCode,
        backtestRunId: existingRun.id,
        detailPath: `/signals/backtests/${existingRun.id}`,
        notes: existingRun.notes ?? buildRunNotes(variant, existingRun.signalVersion),
        summary: await summarizeRun(prisma, existingRun.id),
        riskSummary: await summarizeRisk(prisma, existingRun.id),
    };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.listGroups) {
        console.log('Available M5 stress review persist groups:');
        for (const [groupKey, group] of Object.entries(GROUPS)) {
            console.log(`- ${groupKey}: ${group.label}`);
            console.log(`  variants: ${group.variantCodes.join(', ')}`);
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
        const variants = VARIANTS.filter((variant) => selectedGroup.variantCodes.includes(variant.code));

        const createdRuns: PersistedReviewRun[] = [];

        for (const variant of variants) {
            const existingRun = await findCompletedVariantRun(prisma, variant);
            if (existingRun) {
                console.log(`[SKIP] ${variant.code} already has completed run ${existingRun.backtestRunId}`);
                createdRuns.push(existingRun);
                continue;
            }

            console.log(`[START] ${variant.code}`);
            const version = await getNextVersion(prisma, variant.code);
            const composedDefinition = jsonClone(baseSeed.composedBlocks);
            applyVariant(composedDefinition, variant);

            const createdDefinition = await createReviewDefinition(
                prisma,
                variant,
                version,
                composedDefinition,
            );

            const executionConfig = mergeExecutionConfig(BASE_EXECUTION_CONFIG, {
                entryFeeBps: variant.stress.entryFeeBps,
                exitFeeBps: variant.stress.exitFeeBps,
                entrySlippageBps: variant.stress.entrySlippageBps,
                exitSlippageBps: variant.stress.exitSlippageBps,
            });

            const createdBacktest = await backtestRuns.createGeneratedBacktest({
                signalCode: createdDefinition.code,
                signalVersion: createdDefinition.version,
                symbol: REVIEW_SYMBOL,
                timeframe: 'M5',
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
            console.log(`[DONE] ${createdDefinition.code}@${createdDefinition.version} => ${createdBacktest.backtestRunId}`);
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
