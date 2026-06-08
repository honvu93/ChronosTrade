import dotenv from 'dotenv';
import { Prisma, PrismaClient } from '@prisma/client';
import { ComposedSignalDefinition } from '../services/signals/ComposedSignalPlugin';
import { SignalBacktestExecutionService } from '../services/signals/SignalBacktestExecutionService';
import { SignalBacktestRunService } from '../services/signals/SignalBacktestRunService';
import { createDefaultBlockRegistry } from '../services/signals/blocks/createDefaultBlockRegistry';
import { validateComposedSignalDefinition } from '../services/signals/composedSignalValidation';
import { ExecutionConfigInput } from '../services/signals/types';
import {
    applyM5Base,
    getBaseSeed,
    setRsiThreshold,
    setTakeProfitMultiple,
} from './metalOptimizationHarness';

dotenv.config();

const SYSTEM_ACTOR = 'codex:xau-new-logics-persist';
const BATCH_TAG = 'xau-new-logics-2026-03-16';
const REVIEW_SYMBOL = 'XAUUSD';
const REVIEW_TIMEFRAME = 'M5';
const REVIEW_DATE_RANGE = {
    from: '2019-01-01T00:00:00.000Z',
    to: '2026-03-14T23:59:59.999Z',
};
const DEFAULT_OUT_PATH = '.artifacts/xau-new-logics-2026-03-16/persisted_m5_base_runs.json';

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

type LogicKey = 'l1' | 'l2' | 'l3' | 'l4' | 'l5';

type PersistVariant = {
    logic: LogicKey;
    code: string;
    label: string;
    description: string;
    plannedSignalCode: string;
    sourceConfigFile: string;
    seedSignalCode: string;
    mutate(definition: ComposedSignalDefinition): void;
};

type RunSummary = {
    trades: number;
    netPnl: number;
    netR: number;
    winRate: number;
    maxDd: number;
    profitFactor: number | null;
};

type PersistedRun = {
    logic: LogicKey;
    plannedSignalCode: string;
    seedSignalCode: string;
    sourceConfigFile: string;
    signalDefinitionId: string;
    signalCode: string;
    signalVersion: number;
    signalName: string;
    backtestRunId: string;
    detailPath: string;
    notes: string;
    summary: RunSummary;
};

const VARIANTS: PersistVariant[] = [
    {
        logic: 'l1',
        code: 'XAU_NEW_L1_M5_TP20_HARD',
        label: 'L1 M5 TP 2.0R hard',
        description: 'London pullback retest base lane with 2.0R target.',
        plannedSignalCode: 'SYS_XAU_LONDON_PULLBACK_RETEST_LONG',
        sourceConfigFile: 'logic1_london_pullback_retest.json',
        seedSignalCode: 'SYS_XAU_ASIAN_HIGH_RETEST_LONG',
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setTakeProfitMultiple(definition, 2.0);
        },
    },
    {
        logic: 'l1',
        code: 'XAU_NEW_L1_M5_TP25_HARD',
        label: 'L1 M5 TP 2.5R hard',
        description: 'London pullback retest base lane with 2.5R target.',
        plannedSignalCode: 'SYS_XAU_LONDON_PULLBACK_RETEST_LONG',
        sourceConfigFile: 'logic1_london_pullback_retest.json',
        seedSignalCode: 'SYS_XAU_ASIAN_HIGH_RETEST_LONG',
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setTakeProfitMultiple(definition, 2.5);
        },
    },
    {
        logic: 'l2',
        code: 'XAU_NEW_L2_M5_TP20_HARD',
        label: 'L2 M5 TP 2.0R hard',
        description: 'NY opening-range breakout base lane with 2.0R target.',
        plannedSignalCode: 'SYS_XAU_NY_ORB_LONG',
        sourceConfigFile: 'logic2_ny_orb.json',
        seedSignalCode: 'SYS_XAU_NY_SESSION_BOS_LONG',
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setTakeProfitMultiple(definition, 2.0);
        },
    },
    {
        logic: 'l2',
        code: 'XAU_NEW_L2_M5_TP25_HARD',
        label: 'L2 M5 TP 2.5R hard',
        description: 'NY opening-range breakout base lane with 2.5R target.',
        plannedSignalCode: 'SYS_XAU_NY_ORB_LONG',
        sourceConfigFile: 'logic2_ny_orb.json',
        seedSignalCode: 'SYS_XAU_NY_SESSION_BOS_LONG',
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setTakeProfitMultiple(definition, 2.5);
        },
    },
    {
        logic: 'l3',
        code: 'XAU_NEW_L3_M5_TP20_HARD',
        label: 'L3 M5 TP 2.0R hard',
        description: 'Pre-London accumulation breakout base lane with 2.0R target.',
        plannedSignalCode: 'SYS_XAU_PRE_LONDON_ACCUM_LONG',
        sourceConfigFile: 'logic3_pre_london_accum.json',
        seedSignalCode: 'SYS_XAU_PDM_BREAK_LONG',
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setTakeProfitMultiple(definition, 2.0);
        },
    },
    {
        logic: 'l3',
        code: 'XAU_NEW_L3_M5_TP25_HARD',
        label: 'L3 M5 TP 2.5R hard',
        description: 'Pre-London accumulation breakout base lane with 2.5R target.',
        plannedSignalCode: 'SYS_XAU_PRE_LONDON_ACCUM_LONG',
        sourceConfigFile: 'logic3_pre_london_accum.json',
        seedSignalCode: 'SYS_XAU_PDM_BREAK_LONG',
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setTakeProfitMultiple(definition, 2.5);
        },
    },
    {
        logic: 'l4',
        code: 'XAU_NEW_L4_M5_RSI55_TP25_HARD',
        label: 'L4 M5 RSI 55 TP 2.5R hard',
        description: 'PDH break base lane with RSI 55 and 2.5R target.',
        plannedSignalCode: 'SYS_XAU_PDH_RSI_BREAK_LONG',
        sourceConfigFile: 'logic4_pdh_rsi_break.json',
        seedSignalCode: 'SYS_XAU_PDH_BREAK_LONG',
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setTakeProfitMultiple(definition, 2.5);
        },
    },
    {
        logic: 'l4',
        code: 'XAU_NEW_L4_M5_RSI58_TP25_HARD',
        label: 'L4 M5 RSI 58 TP 2.5R hard',
        description: 'PDH break quality lane with RSI 58 and 2.5R target.',
        plannedSignalCode: 'SYS_XAU_PDH_RSI_BREAK_LONG',
        sourceConfigFile: 'logic4_pdh_rsi_break.json',
        seedSignalCode: 'SYS_XAU_PDH_BREAK_LONG',
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setRsiThreshold(definition, 58);
            setTakeProfitMultiple(definition, 2.5);
        },
    },
    {
        logic: 'l5',
        code: 'XAU_NEW_L5_M5_TP20_HARD',
        label: 'L5 M5 TP 2.0R hard',
        description: 'Asian range midpoint scout lane with 2.0R target.',
        plannedSignalCode: 'SYS_XAU_ASIAN_MID_SCOUT_LONG',
        sourceConfigFile: 'logic5_asian_mid_scout.json',
        seedSignalCode: 'SYS_XAU_SMART_TRAIL_CONFIRM_LONG',
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setTakeProfitMultiple(definition, 2.0);
        },
    },
    {
        logic: 'l5',
        code: 'XAU_NEW_L5_M5_TP25_HARD',
        label: 'L5 M5 TP 2.5R hard',
        description: 'Asian range midpoint scout lane with 2.5R target.',
        plannedSignalCode: 'SYS_XAU_ASIAN_MID_SCOUT_LONG',
        sourceConfigFile: 'logic5_asian_mid_scout.json',
        seedSignalCode: 'SYS_XAU_SMART_TRAIL_CONFIRM_LONG',
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setTakeProfitMultiple(definition, 2.5);
        },
    },
];

const jsonClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function printPersistXauNewLogicBaseBacktestsUsage() {
    console.log([
        'Usage:',
        '  npx ts-node src/scripts/persistXauNewLogicBaseBacktests.ts',
        '  npx ts-node src/scripts/persistXauNewLogicBaseBacktests.ts --logic l4',
        '  npx ts-node src/scripts/persistXauNewLogicBaseBacktests.ts --logic l1,l4,l5 --out .artifacts/xau-new-logics-2026-03-16/custom.json',
        '',
        'Options:',
        '  --list-logics        Show available logic keys',
        '  --logic <keys>       Comma-separated subset: l1,l2,l3,l4,l5 or all',
        '  --out <path>         JSON manifest output path',
    ].join('\n'));
}

export function parsePersistXauNewLogicBaseBacktestsArgs(argv: string[]) {
    const result: {
        listLogics: boolean;
        selectedLogics: LogicKey[];
        outPath: string;
    } = {
        listLogics: false,
        selectedLogics: ['l1', 'l2', 'l3', 'l4', 'l5'],
        outPath: DEFAULT_OUT_PATH,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];

        if (arg === '--list-logics') {
            result.listLogics = true;
            continue;
        }

        if (arg === '--logic') {
            const value = argv[index + 1];
            if (!value) {
                throw new Error('--logic requires a value.');
            }

            if (value === 'all') {
                result.selectedLogics = ['l1', 'l2', 'l3', 'l4', 'l5'];
            } else {
                const parts = value.split(',').map((entry) => entry.trim()).filter(Boolean);
                const invalid = parts.filter((entry) => !['l1', 'l2', 'l3', 'l4', 'l5'].includes(entry));
                if (invalid.length) {
                    throw new Error(`Unknown logic keys: ${invalid.join(', ')}`);
                }
                result.selectedLogics = parts as LogicKey[];
            }

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

export const XAU_NEW_LOGIC_BASE_BACKTEST_LOGICS: LogicKey[] = ['l1', 'l2', 'l3', 'l4', 'l5'];

async function getNextVersion(prisma: PrismaClient, code: string) {
    const latest = await prisma.signalDefinition.findFirst({
        where: { code },
        select: { version: true },
        orderBy: { version: 'desc' },
    });

    return (latest?.version ?? 0) + 1;
}

async function createDefinition(
    prisma: PrismaClient,
    variant: PersistVariant,
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
            name: `XAU New Logic ${variant.label} v${version}`,
            category: 'xau_new_logic_review',
            description: variant.description,
            parameterSchema: {} as Prisma.InputJsonValue,
            indicatorSchema: {
                blocks: indicatorIds,
                batchTag: BATCH_TAG,
                reviewSymbol: REVIEW_SYMBOL,
                reviewTimeframe: REVIEW_TIMEFRAME,
                sourceConfigFile: variant.sourceConfigFile,
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

function buildRunNotes(variant: PersistVariant, version: number) {
    return [
        `[${BATCH_TAG}] ${variant.code}@${version}`,
        `logic=${variant.logic}`,
        `planned=${variant.plannedSignalCode}`,
        `config=${variant.sourceConfigFile}`,
        `seed=${variant.seedSignalCode}`,
        `tf=${REVIEW_TIMEFRAME}`,
    ].join(' | ');
}

export async function runPersistXauNewLogicBaseBacktests(argv: string[] = process.argv.slice(2)) {
    const args = parsePersistXauNewLogicBaseBacktestsArgs(argv);

    if (args.listLogics) {
        console.log('- l1: London Pullback Retest');
        console.log('- l2: NY Opening Range Breakout');
        console.log('- l3: Pre-London Accumulation Breakout');
        console.log('- l4: PDH Break with RSI Gate');
        console.log('- l5: Asian Range Midpoint Scout');
        return;
    }

    const variants = VARIANTS.filter((variant) => args.selectedLogics.includes(variant.logic));
    if (variants.length === 0) {
        throw new Error('No variants selected.');
    }

    const prisma = new PrismaClient();
    const backtestRuns = new SignalBacktestRunService(prisma);
    const execution = new SignalBacktestExecutionService(prisma, {
        deliverConfiguredOutputs: async () => [],
    });

    try {
        const createdRuns: PersistedRun[] = [];

        for (const variant of variants) {
            console.log(`Persisting ${variant.code} from ${variant.sourceConfigFile}`);
            const version = await getNextVersion(prisma, variant.code);
            const baseSeed = getBaseSeed(variant.seedSignalCode);
            const composedDefinition = jsonClone(baseSeed.composedBlocks) as ComposedSignalDefinition;
            variant.mutate(composedDefinition);

            const createdDefinition = await createDefinition(
                prisma,
                variant,
                version,
                composedDefinition,
            );

            const notes = buildRunNotes(variant, createdDefinition.version);
            const createdBacktest = await backtestRuns.createGeneratedBacktest({
                signalCode: createdDefinition.code,
                signalVersion: createdDefinition.version,
                symbol: REVIEW_SYMBOL,
                timeframe: REVIEW_TIMEFRAME,
                dateRange: REVIEW_DATE_RANGE,
                parameters: {},
                executionConfig: BASE_EXECUTION_CONFIG,
                initialEquity: 10_000,
                riskPercent: 2,
                notes,
            });

            await execution.executeRun(createdBacktest.backtestRunId);
            const summary = await summarizeRun(prisma, createdBacktest.backtestRunId);

            createdRuns.push({
                logic: variant.logic,
                plannedSignalCode: variant.plannedSignalCode,
                seedSignalCode: variant.seedSignalCode,
                sourceConfigFile: variant.sourceConfigFile,
                signalDefinitionId: createdDefinition.id,
                signalCode: createdDefinition.code,
                signalVersion: createdDefinition.version,
                signalName: createdDefinition.name,
                backtestRunId: createdBacktest.backtestRunId,
                detailPath: `/signals/backtests/${createdBacktest.backtestRunId}`,
                notes,
                summary,
            });
        }

        const fs = await import('fs');
        const path = await import('path');
        const resolvedPath = path.resolve(args.outPath);
        fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
        fs.writeFileSync(resolvedPath, JSON.stringify({
            generatedAt: new Date().toISOString(),
            batchTag: BATCH_TAG,
            symbol: REVIEW_SYMBOL,
            timeframe: REVIEW_TIMEFRAME,
            dateRange: REVIEW_DATE_RANGE,
            selectedLogics: args.selectedLogics,
            createdRuns,
        }, null, 2));

        console.log(`Saved JSON output to ${resolvedPath}`);
        console.table(createdRuns.map((run) => ({
            Logic: run.logic.toUpperCase(),
            Planned: run.plannedSignalCode,
            Seed: run.seedSignalCode,
            Signal: `${run.signalCode}@${run.signalVersion}`,
            RunId: run.backtestRunId,
            Trades: run.summary.trades,
            NetPnL: run.summary.netPnl,
            WR: `${run.summary.winRate}%`,
            PF: run.summary.profitFactor,
        })));
    } finally {
        await prisma.$disconnect();
    }
}

if (require.main === module) {
    runPersistXauNewLogicBaseBacktests().catch((error) => {
        console.error(error instanceof Error ? error.stack ?? error.message : error);
        printPersistXauNewLogicBaseBacktestsUsage();
        process.exit(1);
    });
}
