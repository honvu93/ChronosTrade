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
import { BacktestRiskSummary, BacktestRiskSummaryService } from '../services/signals/BacktestRiskSummaryService';

dotenv.config();

type Summary = {
    trades: number;
    netPnl: number;
    netR: number;
    winRate: number;
    maxDd: number;
    profitFactor: number | null;
};

type VariantResult = {
    variantId: string;
    variantLabel: string;
    changeSummary: string;
    baseSignalCode: string;
    baseSignalName: string;
    timeframe: string;
    exitProfile: string;
    summary: Summary;
    riskSummary: BacktestRiskSummary;
};

type OutputFile = {
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
    results: VariantResult[];
};

type VariantSpec = {
    id: string;
    label: string;
    changeSummary: string;
    mutate(definition: ComposedSignalDefinition): void;
};

const FROM = new Date('2019-01-01T00:00:00.000Z');
const TO = new Date('2026-03-14T23:59:59.999Z');
const SYMBOL = 'XAUUSD';
const INITIAL_EQUITY = 10_000;
const RISK_PERCENT = 1;
const DEFAULT_EXECUTION_CONFIG: ExecutionConfigInput = {
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

const BASE_SIGNAL_CODE = 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG';
const riskSummaryService = new BacktestRiskSummaryService();

const jsonClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const summarize = (results: Array<{ isOpen: boolean; pnlUsd: number; rMultiple: number; win: boolean; maxDrawdownPct: number }>) => {
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
};

function getBlock(definition: ComposedSignalDefinition, indicatorId: string) {
    const block = definition.blocks.find((entry) => entry.indicatorId === indicatorId);
    if (!block) {
        throw new Error(`Missing indicator block ${indicatorId} in ${BASE_SIGNAL_CODE}.`);
    }
    return block;
}

const VARIANTS: VariantSpec[] = [
    {
        id: 'guard_base_hard',
        label: 'Protected Base ATR 1.20 + HARD_SIGNAL_TP',
        changeSummary: 'Base Asian Break Continuation with 1% risk, loss-streak throttle, and session/day kill switches.',
        mutate(definition) {
            definition.exitManagement = { profileCode: 'HARD_SIGNAL_TP' };
        },
    },
    {
        id: 'guard_atr130_hard',
        label: 'Protected ATR 1.30 + HARD_SIGNAL_TP',
        changeSummary: 'Keep the capital-protection stack and tighten ATR expansion from 1.20 to 1.30.',
        mutate(definition) {
            definition.exitManagement = { profileCode: 'HARD_SIGNAL_TP' };
            getBlock(definition, 'ATR_REGIME').conditionParams = { multiplier: 1.3 };
        },
    },
    {
        id: 'guard_atr135_hard',
        label: 'Protected ATR 1.35 + HARD_SIGNAL_TP',
        changeSummary: 'Keep the capital-protection stack and tighten ATR expansion from 1.20 to 1.35.',
        mutate(definition) {
            definition.exitManagement = { profileCode: 'HARD_SIGNAL_TP' };
            getBlock(definition, 'ATR_REGIME').conditionParams = { multiplier: 1.35 };
        },
    },
    {
        id: 'guard_atr140_hard',
        label: 'Protected ATR 1.40 + HARD_SIGNAL_TP',
        changeSummary: 'Keep the capital-protection stack and tighten ATR expansion from 1.20 to 1.40.',
        mutate(definition) {
            definition.exitManagement = { profileCode: 'HARD_SIGNAL_TP' };
            getBlock(definition, 'ATR_REGIME').conditionParams = { multiplier: 1.4 };
        },
    },
];

const GROUPS = {
    guard_base_hard: {
        label: 'Protected base Asian Break Continuation',
        variants: ['guard_base_hard'],
    },
    guard_atr130_hard: {
        label: 'Protected ATR 1.30',
        variants: ['guard_atr130_hard'],
    },
    guard_atr135_hard: {
        label: 'Protected ATR 1.35',
        variants: ['guard_atr135_hard'],
    },
    guard_atr140_hard: {
        label: 'Protected ATR 1.40',
        variants: ['guard_atr140_hard'],
    },
    all: {
        label: 'All protected Asian Break Continuation variants',
        variants: VARIANTS.map((variant) => variant.id),
    },
} satisfies Record<string, { label: string; variants: string[] }>;

function printUsage() {
    console.log([
        'Usage:',
        '  node -r ts-node/register src/scripts/runXauAsianBreakCapitalProtectionMatrix.ts --list-groups',
        '  node -r ts-node/register src/scripts/runXauAsianBreakCapitalProtectionMatrix.ts --group guard_base_hard --out .artifacts/xau-abc-protected/guard_base_hard.json',
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

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.listGroups) {
        console.log('Available protected Asian Break groups:');
        for (const [groupKey, group] of Object.entries(GROUPS)) {
            console.log(`- ${groupKey}: ${group.label}`);
            console.log(`  variants: ${group.variants.join(', ')}`);
        }
        return;
    }

    const selectedGroup = GROUPS[args.group];
    const baseSeed = getTier1ComposedSignalSeeds().find((seed) => seed.code === BASE_SIGNAL_CODE);
    if (!baseSeed) {
        throw new Error(`Base seed ${BASE_SIGNAL_CODE} was not found.`);
    }

    const prisma = new PrismaClient();
    const registry = SignalRegistry.getInstance();
    const runner = new SignalBacktestRunner(
        new CandleQueryService(prisma),
        new IndicatorSeriesService(),
        new ExecutionModelService(),
        registry,
    );
    const blockRegistry = createDefaultBlockRegistry();
    const variantsById = new Map(VARIANTS.map((variant) => [variant.id, variant]));
    const results: VariantResult[] = [];

    try {
        console.log(`Running protected Asian Break group "${args.group}" (${selectedGroup.label})`);
        console.log(`Range: ${FROM.toISOString()} -> ${TO.toISOString()}`);

        for (const variantId of selectedGroup.variants) {
            const variant = variantsById.get(variantId);
            if (!variant) {
                throw new Error(`Missing variant definition ${variantId}.`);
            }

            const definition = jsonClone(baseSeed.composedBlocks) as ComposedSignalDefinition;
            variant.mutate(definition);

            const timeframe = String((baseSeed.composedBlocks as { timeframe?: string }).timeframe ?? 'M15');
            const tmpCode = `ABCP_${variant.id}`.slice(0, 60).toUpperCase();
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
                    exitProfile: 'HARD_SIGNAL_TP',
                    summary,
                    riskSummary: riskSummaryService.summarize({
                        initialEquity: INITIAL_EQUITY,
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

    const outputFile: OutputFile = {
        generatedAt: new Date().toISOString(),
        group: args.group,
        groupLabel: selectedGroup.label,
        symbol: SYMBOL,
        from: FROM.toISOString(),
        to: TO.toISOString(),
        initialEquity: INITIAL_EQUITY,
        riskPercent: RISK_PERCENT,
        executionConfig: DEFAULT_EXECUTION_CONFIG,
        baseSignalCode: baseSeed.code,
        baseSignalName: baseSeed.name,
        results,
    };

    if (args.outPath) {
        const resolvedPath = path.resolve(args.outPath);
        fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
        fs.writeFileSync(resolvedPath, JSON.stringify(outputFile, null, 2));
        console.log(`Saved JSON output to ${resolvedPath}`);
    } else {
        console.log(JSON.stringify(outputFile, null, 2));
    }

    console.table(results.map((row) => ({
        Variant: row.variantId,
        Exit: row.exitProfile,
        NetPnL: row.summary.netPnl,
        WR: `${row.summary.winRate}%`,
        DD: `${row.summary.maxDd}%`,
        Trades: row.summary.trades,
        PF: row.summary.profitFactor,
    })));
}

main().catch((error) => {
    console.error(error);
    printUsage();
    process.exit(1);
});
