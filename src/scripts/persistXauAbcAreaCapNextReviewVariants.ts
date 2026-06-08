import dotenv from 'dotenv';
import { Prisma, PrismaClient } from '@prisma/client';
import { ComposedSignalDefinition } from '../services/signals/ComposedSignalPlugin';
import { SignalBacktestExecutionService } from '../services/signals/SignalBacktestExecutionService';
import { SignalBacktestRunService } from '../services/signals/SignalBacktestRunService';
import { BacktestRiskSummary, BacktestRiskSummaryService } from '../services/signals/BacktestRiskSummaryService';
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
    applyM5Base,
    setAtrBufferMultiplier,
    setAtrMultiplier,
    setSignalAreaGuard,
    setStopLookback,
    setTakeProfitMultiple,
} from './xauAbcOptimizationShared';

dotenv.config();

const SYSTEM_ACTOR = 'codex:xau-abc-area-cap-next-review';
const BATCH_TAG = 'xau-abc-area-cap-next-review-2026-03-15';
const REVIEW_DATE_RANGE = {
    from: FROM.toISOString(),
    to: TO.toISOString(),
};

const PROTECTED_EXECUTION_CONFIG: ExecutionConfigInput = {
    ...DEFAULT_EXECUTION_CONFIG,
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
    family: 'm5_capped' | 'tf_protected';
    timeframe: 'M5' | 'M15' | 'M30' | 'H1';
    riskPercent: number;
    executionConfig: ExecutionConfigInput;
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
    family: ReviewVariant['family'];
    timeframe: ReviewVariant['timeframe'];
    riskPercent: number;
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

const jsonClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const riskSummaryService = new BacktestRiskSummaryService();

const setProtectedTimeframeGeometry = (
    definition: ComposedSignalDefinition,
    config: {
        timeframe: 'M15' | 'M30' | 'H1';
        windowBars: number;
        stopLookback: number;
        takeProfitR: number;
        atrBufferMultiplier: number;
        atrMultiplier: number;
        areaCap: number;
        areaResetBars: number;
        areaPriceDistanceR: number;
    },
) => {
    (definition as ComposedSignalDefinition & { timeframe?: string }).timeframe = config.timeframe;
    definition.windowBars = config.windowBars;
    setStopLookback(definition, config.stopLookback);
    setTakeProfitMultiple(definition, config.takeProfitR);
    setAtrBufferMultiplier(definition, config.atrBufferMultiplier);
    setAtrMultiplier(definition, config.atrMultiplier);
    setSignalAreaGuard(definition, {
        maxSignalsPerArea: config.areaCap,
        resetBars: config.areaResetBars,
        priceDistanceR: config.areaPriceDistanceR,
    });
};

const VARIANTS: ReviewVariant[] = [
    {
        id: 'm5_cap_tp25',
        code: 'XAU_ABC_M5_CAP5_TP25_REVIEW',
        label: 'M5 capped alpha lane TP 2.5R',
        description: 'Best capped M5 alpha recovery branch: area cap 5, reset 8, 0.75R spacing, ATR 1.15, take profit 2.5R.',
        family: 'm5_capped',
        timeframe: 'M5',
        riskPercent: 2,
        executionConfig: DEFAULT_EXECUTION_CONFIG,
        mutate(definition) {
            applyM5Base(definition);
            setSignalAreaGuard(definition, {
                maxSignalsPerArea: 5,
                resetBars: 8,
                priceDistanceR: 0.75,
            });
            setAtrMultiplier(definition, 1.15);
            setTakeProfitMultiple(definition, 2.5);
            definition.exitManagement = { profileCode: 'HARD_SIGNAL_TP' };
        },
    },
    {
        id: 'm5_cap_lookback96',
        code: 'XAU_ABC_M5_CAP5_LB96_REVIEW',
        label: 'M5 capped safety lane lookback 96',
        description: 'Best capped M5 safety-preserving branch: area cap 5, reset 8, 0.75R spacing, ATR 1.15, stop lookback 96.',
        family: 'm5_capped',
        timeframe: 'M5',
        riskPercent: 2,
        executionConfig: DEFAULT_EXECUTION_CONFIG,
        mutate(definition) {
            applyM5Base(definition);
            setSignalAreaGuard(definition, {
                maxSignalsPerArea: 5,
                resetBars: 8,
                priceDistanceR: 0.75,
            });
            setAtrMultiplier(definition, 1.15);
            setStopLookback(definition, 96);
            definition.exitManagement = { profileCode: 'HARD_SIGNAL_TP' };
        },
    },
    {
        id: 'm15_balanced_guard',
        code: 'XAU_ABC_M15_BAL_GUARD_REVIEW',
        label: 'M15 balanced protected lane',
        description: 'M15 area-cap expansion with balanced stop/target geometry and capital protection.',
        family: 'tf_protected',
        timeframe: 'M15',
        riskPercent: 1,
        executionConfig: PROTECTED_EXECUTION_CONFIG,
        mutate(definition) {
            setProtectedTimeframeGeometry(definition, {
                timeframe: 'M15',
                windowBars: 8,
                stopLookback: 30,
                takeProfitR: 2.5,
                atrBufferMultiplier: 0.22,
                atrMultiplier: 1.15,
                areaCap: 5,
                areaResetBars: 3,
                areaPriceDistanceR: 0.75,
            });
            definition.exitManagement = { profileCode: 'HARD_SIGNAL_TP' };
        },
    },
    {
        id: 'm15_extended_guard',
        code: 'XAU_ABC_M15_EXT_GUARD_REVIEW',
        label: 'M15 extended protected lane',
        description: 'M15 area-cap expansion with extended stop/target geometry and capital protection.',
        family: 'tf_protected',
        timeframe: 'M15',
        riskPercent: 1,
        executionConfig: PROTECTED_EXECUTION_CONFIG,
        mutate(definition) {
            setProtectedTimeframeGeometry(definition, {
                timeframe: 'M15',
                windowBars: 8,
                stopLookback: 38,
                takeProfitR: 3,
                atrBufferMultiplier: 0.27,
                atrMultiplier: 1.2,
                areaCap: 4,
                areaResetBars: 3,
                areaPriceDistanceR: 1,
            });
            definition.exitManagement = { profileCode: 'HARD_SIGNAL_TP' };
        },
    },
    {
        id: 'm30_balanced_guard',
        code: 'XAU_ABC_M30_BAL_GUARD_REVIEW',
        label: 'M30 balanced protected lane',
        description: 'M30 area-cap expansion with balanced stop/target geometry and capital protection.',
        family: 'tf_protected',
        timeframe: 'M30',
        riskPercent: 1,
        executionConfig: PROTECTED_EXECUTION_CONFIG,
        mutate(definition) {
            setProtectedTimeframeGeometry(definition, {
                timeframe: 'M30',
                windowBars: 4,
                stopLookback: 18,
                takeProfitR: 3,
                atrBufferMultiplier: 0.25,
                atrMultiplier: 1.15,
                areaCap: 4,
                areaResetBars: 2,
                areaPriceDistanceR: 1,
            });
            definition.exitManagement = { profileCode: 'HARD_SIGNAL_TP' };
        },
    },
    {
        id: 'm30_extended_guard',
        code: 'XAU_ABC_M30_EXT_GUARD_REVIEW',
        label: 'M30 extended protected lane',
        description: 'M30 area-cap expansion with extended stop/target geometry and capital protection.',
        family: 'tf_protected',
        timeframe: 'M30',
        riskPercent: 1,
        executionConfig: PROTECTED_EXECUTION_CONFIG,
        mutate(definition) {
            setProtectedTimeframeGeometry(definition, {
                timeframe: 'M30',
                windowBars: 4,
                stopLookback: 23,
                takeProfitR: 3.5,
                atrBufferMultiplier: 0.3,
                atrMultiplier: 1.2,
                areaCap: 3,
                areaResetBars: 2,
                areaPriceDistanceR: 1.25,
            });
            definition.exitManagement = { profileCode: 'HARD_SIGNAL_TP' };
        },
    },
    {
        id: 'h1_balanced_guard',
        code: 'XAU_ABC_H1_BAL_GUARD_REVIEW',
        label: 'H1 balanced protected lane',
        description: 'H1 area-cap expansion with balanced stop/target geometry and capital protection.',
        family: 'tf_protected',
        timeframe: 'H1',
        riskPercent: 1,
        executionConfig: PROTECTED_EXECUTION_CONFIG,
        mutate(definition) {
            setProtectedTimeframeGeometry(definition, {
                timeframe: 'H1',
                windowBars: 2,
                stopLookback: 10,
                takeProfitR: 3.5,
                atrBufferMultiplier: 0.3,
                atrMultiplier: 1.15,
                areaCap: 3,
                areaResetBars: 2,
                areaPriceDistanceR: 1.25,
            });
            definition.exitManagement = { profileCode: 'HARD_SIGNAL_TP' };
        },
    },
    {
        id: 'h1_extended_guard',
        code: 'XAU_ABC_H1_EXT_GUARD_REVIEW',
        label: 'H1 extended protected lane',
        description: 'H1 area-cap expansion with extended stop/target geometry and capital protection.',
        family: 'tf_protected',
        timeframe: 'H1',
        riskPercent: 1,
        executionConfig: PROTECTED_EXECUTION_CONFIG,
        mutate(definition) {
            setProtectedTimeframeGeometry(definition, {
                timeframe: 'H1',
                windowBars: 2,
                stopLookback: 13,
                takeProfitR: 4,
                atrBufferMultiplier: 0.35,
                atrMultiplier: 1.2,
                areaCap: 3,
                areaResetBars: 2,
                areaPriceDistanceR: 1.5,
            });
            definition.exitManagement = { profileCode: 'HARD_SIGNAL_TP' };
        },
    },
];

const GROUPS = {
    m5_capped: {
        label: 'Persist capped M5 follow-up review runs',
        variantIds: VARIANTS.filter((variant) => variant.family === 'm5_capped').map((variant) => variant.id),
    },
    tf_protected: {
        label: 'Persist protected higher-timeframe review runs',
        variantIds: VARIANTS.filter((variant) => variant.family === 'tf_protected').map((variant) => variant.id),
    },
    all: {
        label: 'Persist all next-step XAU area-cap review runs',
        variantIds: VARIANTS.map((variant) => variant.id),
    },
} satisfies Record<string, { label: string; variantIds: string[] }>;

function printUsage() {
    console.log([
        'Usage:',
        '  node -r ts-node/register src/scripts/persistXauAbcAreaCapNextReviewVariants.ts --list-groups',
        '  node -r ts-node/register src/scripts/persistXauAbcAreaCapNextReviewVariants.ts --group all --out .artifacts/xau-abc-next-review/xau-abc-next-review.json',
        '',
        'Options:',
        `  --group <name>   One of: ${Object.keys(GROUPS).join(', ')}`,
        '  --list-groups    Show available groups',
        '  --out <path>     Where to write the JSON output file',
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
            name: `XAU Review - ${variant.label} v${version}`,
            category: 'xau_abc_area_cap_next_review',
            description: variant.description,
            parameterSchema: {} as Prisma.InputJsonValue,
            indicatorSchema: {
                blocks: indicatorIds,
                batchTag: BATCH_TAG,
                reviewSymbol: SYMBOL,
                timeframe: variant.timeframe,
                family: variant.family,
                variantId: variant.id,
                riskPercent: variant.riskPercent,
            } as Prisma.InputJsonValue,
            eventSchema: {
                profileCode: definition.exitManagement?.profileCode ?? 'HARD_SIGNAL_TP',
                batchTag: BATCH_TAG,
                reviewVariant: variant.id,
                timeframe: variant.timeframe,
                family: variant.family,
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

function buildNotes(variant: ReviewVariant, version: number) {
    return `[${BATCH_TAG}] ${variant.code}@${version} | ${variant.id} | family=${variant.family} | timeframe=${variant.timeframe} | risk=${variant.riskPercent}%`;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.listGroups) {
        console.log('Available area-cap review persist groups:');
        for (const [groupKey, group] of Object.entries(GROUPS)) {
            console.log(`- ${groupKey}: ${group.label}`);
            console.log(`  variants: ${group.variantIds.join(', ')}`);
        }
        return;
    }

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

        const selectedGroup = GROUPS[args.group];
        const selectedVariants = VARIANTS.filter((variant) => selectedGroup.variantIds.includes(variant.id));
        const createdRuns: PersistedReviewRun[] = [];

        for (const variant of selectedVariants) {
            const version = await getNextVersion(prisma, variant.code);
            const composedDefinition = jsonClone(baseSeed.composedBlocks);
            variant.mutate(composedDefinition);

            const createdDefinition = await createReviewDefinition(prisma, variant, version, composedDefinition);
            const notes = buildNotes(variant, createdDefinition.version);

            const createdBacktest = await backtestRuns.createGeneratedBacktest({
                signalCode: createdDefinition.code,
                signalVersion: createdDefinition.version,
                symbol: SYMBOL,
                timeframe: variant.timeframe,
                dateRange: REVIEW_DATE_RANGE,
                parameters: {},
                executionConfig: variant.executionConfig,
                initialEquity: 10_000,
                riskPercent: variant.riskPercent,
                notes,
            });

            await execution.executeRun(createdBacktest.backtestRunId);

            createdRuns.push({
                signalDefinitionId: createdDefinition.id,
                signalCode: createdDefinition.code,
                signalVersion: createdDefinition.version,
                signalName: createdDefinition.name,
                backtestRunId: createdBacktest.backtestRunId,
                detailPath: `/signals/backtests/${createdBacktest.backtestRunId}`,
                notes,
                variantId: variant.id,
                family: variant.family,
                timeframe: variant.timeframe,
                riskPercent: variant.riskPercent,
                summary: await summarizeRun(prisma, createdBacktest.backtestRunId),
                riskSummary: await summarizeRisk(prisma, createdBacktest.backtestRunId),
            });
        }

        const outputFile: OutputFile = {
            generatedAt: new Date().toISOString(),
            group: args.group,
            groupLabel: selectedGroup.label,
            batchTag: BATCH_TAG,
            symbol: SYMBOL,
            dateRange: REVIEW_DATE_RANGE,
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
