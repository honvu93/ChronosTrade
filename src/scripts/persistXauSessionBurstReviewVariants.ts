import dotenv from 'dotenv';
import { Prisma, PrismaClient } from '@prisma/client';
import { ComposedBlockConfig, ComposedSignalDefinition } from '../services/signals/ComposedSignalPlugin';
import { SignalBacktestExecutionService } from '../services/signals/SignalBacktestExecutionService';
import { SignalBacktestRunService } from '../services/signals/SignalBacktestRunService';
import { createDefaultBlockRegistry } from '../services/signals/blocks/createDefaultBlockRegistry';
import { validateComposedSignalDefinition } from '../services/signals/composedSignalValidation';
import { getTier1ComposedSignalSeeds } from '../services/signals/tier1ComposedSignals';
import { ExecutionConfigInput } from '../services/signals/types';

dotenv.config();

const SYSTEM_ACTOR = 'codex:xau-sb1h-review';
const BATCH_TAG = 'xau-sb1h-review-2026-03-14';
const REVIEW_SYMBOL = 'XAUUSD';
const REVIEW_TIMEFRAME = '1h';
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
};

type ReviewVariant = {
    code: string;
    label: string;
    description: string;
    mutateDefinition?: (definition: ComposedSignalDefinition) => void;
    executionConfigOverride?: Partial<ExecutionConfigInput>;
    parameters?: Record<string, unknown>;
};

type RunSummary = {
    trades: number;
    netPnl: number;
    netR: number;
    winRate: number;
    maxDd: number;
    profitFactor: number | null;
};

const jsonClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

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

const findBlock = (
    definition: ComposedSignalDefinition,
    indicatorId: string,
    conditionId?: string,
): ComposedBlockConfig => {
    const block = definition.blocks.find((entry) => (
        entry.indicatorId === indicatorId
        && (conditionId ? entry.conditionId === conditionId : true)
    ));

    if (!block) {
        throw new Error(`Unable to find block ${indicatorId}${conditionId ? `:${conditionId}` : ''}.`);
    }

    return block;
};

const formatVariantName = (label: string, version: number) => (
    `XAU Review - Session Burst 1h - ${label} v${version}`
);

const buildRunNotes = (variant: ReviewVariant, version: number) => (
    `[${BATCH_TAG}] ${variant.code}@${version} | ${variant.label} | ${variant.description}`
);

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
            category: 'xau_session_burst_review',
            description: variant.description,
            parameterSchema: {} as Prisma.InputJsonValue,
            indicatorSchema: {
                blocks: indicatorIds,
                batchTag: BATCH_TAG,
                reviewSymbol: REVIEW_SYMBOL,
                reviewTimeframe: REVIEW_TIMEFRAME,
            } as Prisma.InputJsonValue,
            eventSchema: {
                profileCode: definition.exitManagement?.profileCode ?? 'HARD_SIGNAL_TP',
                batchTag: BATCH_TAG,
                reviewVariant: variant.code,
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

async function main() {
    const prisma = new PrismaClient();
    const backtestRuns = new SignalBacktestRunService(prisma);
    const execution = new SignalBacktestExecutionService(prisma, {
        deliverConfiguredOutputs: async () => [],
    });

    try {
        const baseSeed = getTier1ComposedSignalSeeds().find((seed) => seed.code === 'SYS_T1_SESSION_BURST_LONG');

        if (!baseSeed) {
            throw new Error('Unable to locate SYS_T1_SESSION_BURST_LONG seed definition.');
        }

        const variants: ReviewVariant[] = [
            {
                code: 'XAU_SB1H_BASE_REVIEW',
                label: 'Baseline Clone',
                description: 'Clone of SYS_T1_SESSION_BURST_LONG@1 for the 2026-03-14 XAU review batch.',
            },
            {
                code: 'XAU_SB1H_NS_REVIEW',
                label: 'Narrow Session',
                description: 'Session window reduced to 13:00-18:00 UTC to remove weaker hours.',
                mutateDefinition: (definition) => {
                    findBlock(definition, 'SESSION_FILTER', 'in_session').indicatorParams = {
                        startHour: 13,
                        endHour: 18,
                    };
                },
            },
            {
                code: 'XAU_SB1H_NS_RSI58_REVIEW',
                label: 'Narrow Session + RSI 58',
                description: 'Session narrowed to 13:00-18:00 UTC and RSI continuation threshold raised to 58.',
                mutateDefinition: (definition) => {
                    findBlock(definition, 'SESSION_FILTER', 'in_session').indicatorParams = {
                        startHour: 13,
                        endHour: 18,
                    };
                    findBlock(definition, 'RSI').conditionParams.threshold = 58;
                },
            },
            {
                code: 'XAU_SB1H_TRENDHARD_REVIEW',
                label: 'Trend Hardening',
                description: 'Stricter regime gate with ADX 30, EMA 250, BOS lookback 80, and RSI threshold 58.',
                mutateDefinition: (definition) => {
                    findBlock(definition, 'MARKET_REGIME').conditionParams.adxThreshold = 30;
                    findBlock(definition, 'MARKET_REGIME').indicatorParams.emaFilterPeriod = 250;
                    findBlock(definition, 'SMC').indicatorParams.lookback = 80;
                    findBlock(definition, 'RSI').conditionParams.threshold = 58;
                },
            },
            {
                code: 'XAU_SB1H_ENTRYCLOSE_REVIEW',
                label: 'Signal Bar Close Entry',
                description: 'Keeps the base logic but executes entries on signal-bar close instead of next-bar open.',
                executionConfigOverride: {
                    orderTiming: 'SIGNAL_BAR_CLOSE',
                },
            },
            {
                code: 'XAU_SB1H_HARD15_REVIEW',
                label: 'Hard 1.5R Exit',
                description: 'Switches to a hard 1.5R take-profit profile to test faster profit capture.',
                mutateDefinition: (definition) => {
                    definition.takeProfit.value = 1.5;
                    definition.exitManagement = {
                        profileCode: 'HARD_SIGNAL_TP',
                    };
                },
            },
        ];

        const createdRuns = [];

        for (const variant of variants) {
            const version = await getNextVersion(prisma, variant.code);
            const composedDefinition = jsonClone(baseSeed.composedBlocks);
            variant.mutateDefinition?.(composedDefinition);

            const createdDefinition = await createReviewDefinition(
                prisma,
                variant,
                version,
                composedDefinition,
            );

            const createdBacktest = await backtestRuns.createGeneratedBacktest({
                signalCode: createdDefinition.code,
                signalVersion: createdDefinition.version,
                symbol: REVIEW_SYMBOL,
                timeframe: REVIEW_TIMEFRAME,
                dateRange: REVIEW_DATE_RANGE,
                parameters: variant.parameters ?? {},
                executionConfig: mergeExecutionConfig(
                    BASE_EXECUTION_CONFIG,
                    variant.executionConfigOverride,
                ),
                initialEquity: 10_000,
                riskPercent: 2,
                notes: buildRunNotes(variant, createdDefinition.version),
            });

            await execution.executeRun(createdBacktest.backtestRunId);

            const summary = await summarizeRun(prisma, createdBacktest.backtestRunId);

            createdRuns.push({
                signalDefinitionId: createdDefinition.id,
                signalCode: createdDefinition.code,
                signalVersion: createdDefinition.version,
                signalName: createdDefinition.name,
                backtestRunId: createdBacktest.backtestRunId,
                detailPath: `/signals/backtests/${createdBacktest.backtestRunId}`,
                notes: buildRunNotes(variant, createdDefinition.version),
                summary,
            });
        }

        console.log(JSON.stringify({
            batchTag: BATCH_TAG,
            createdRuns,
        }, null, 2));
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exit(1);
});
