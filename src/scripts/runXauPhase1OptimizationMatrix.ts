import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { ComposedSignalPlugin } from '../services/signals/ComposedSignalPlugin';
import { SignalRegistry } from '../services/signals/SignalRegistry';
import { SignalBacktestRunner } from '../services/signals/SignalBacktestRunner';
import { CandleQueryService } from '../services/signals/CandleQueryService';
import { IndicatorSeriesService } from '../services/signals/IndicatorSeriesService';
import { ExecutionModelService } from '../services/signals/ExecutionModelService';
import { createDefaultBlockRegistry } from '../services/signals/blocks/createDefaultBlockRegistry';
import { getTier1ComposedSignalSeeds } from '../services/signals/tier1ComposedSignals';
import { ExecutionConfigInput } from '../services/signals/types';

dotenv.config();

type Summary = {
    trades: number;
    netPnl: number;
    netR: number;
    winRate: number;
    maxDd: number;
    profitFactor: number | null;
};

type ExperimentResult = {
    seedCode: string;
    seedName: string;
    timeframe: string;
    exitProfile: string;
    summary: Summary;
};

type MatrixOutputFile = {
    generatedAt: string;
    group: string;
    groupLabel: string;
    symbol: string;
    from: string;
    to: string;
    initialEquity: number;
    riskPercent: number;
    executionConfig: ExecutionConfigInput;
    candidates: string[];
    results: ExperimentResult[];
};

const FROM = new Date('2019-01-01T00:00:00.000Z');
const TO = new Date('2026-03-14T23:59:59.999Z');
const SYMBOL = 'XAUUSD';
const INITIAL_EQUITY = 10_000;
const RISK_PERCENT = 2;
const DEFAULT_EXECUTION_CONFIG: ExecutionConfigInput = {
    entryFeeBps: 4,
    exitFeeBps: 4,
    entrySlippageBps: 2,
    exitSlippageBps: 2,
    orderTiming: 'NEXT_BAR_OPEN',
    stopLoss: { mode: 'SIGNAL_PRICE' },
    takeProfit: { mode: 'SIGNAL_PRICE' },
    positionSizing: { mode: 'RISK_BASED' },
};

const EXIT_PROFILES = [
    'HARD_SIGNAL_TP',
    'BE_1R_TP_2R',
    'PARTIAL_1R_BE_SWING_TRAIL',
    'XAU_NY_CLOSE',
] as const;

const GROUPS = {
    pdl_reclaim: {
        label: 'PDL Sweep Reclaim Long',
        candidates: ['SYS_XAU_PDL_SWEEP_RECLAIM_LONG'],
    },
    pdh_reclaim: {
        label: 'PDH Sweep Reclaim Short',
        candidates: ['SYS_XAU_PDH_SWEEP_RECLAIM_SHORT'],
    },
    asian_reversal: {
        label: 'Asian Sweep Reversal Long',
        candidates: ['SYS_XAU_ASIAN_SWEEP_REVERSAL_LONG'],
    },
    asian_breakout: {
        label: 'Asian Break Continuation Long',
        candidates: ['SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG'],
    },
    reclaims: {
        label: 'Both Previous-Day Reclaim Recipes',
        candidates: ['SYS_XAU_PDL_SWEEP_RECLAIM_LONG', 'SYS_XAU_PDH_SWEEP_RECLAIM_SHORT'],
    },
    sessions: {
        label: 'Both Asian Session Recipes',
        candidates: ['SYS_XAU_ASIAN_SWEEP_REVERSAL_LONG', 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG'],
    },
    all: {
        label: 'All XAU Phase 1 Recipes',
        candidates: [
            'SYS_XAU_PDL_SWEEP_RECLAIM_LONG',
            'SYS_XAU_PDH_SWEEP_RECLAIM_SHORT',
            'SYS_XAU_ASIAN_SWEEP_REVERSAL_LONG',
            'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG',
        ],
    },
} satisfies Record<string, { label: string; candidates: string[] }>;

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

function printUsage() {
    console.log([
        'Usage:',
        '  node -r ts-node/register src/scripts/runXauPhase1OptimizationMatrix.ts --list-groups',
        '  node -r ts-node/register src/scripts/runXauPhase1OptimizationMatrix.ts --group pdl_reclaim --out .artifacts/xau-phase1/pdl_reclaim.json',
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
        console.log('Available XAU phase-1 matrix groups:');
        for (const [groupKey, group] of Object.entries(GROUPS)) {
            console.log(`- ${groupKey}: ${group.label}`);
            console.log(`  candidates: ${group.candidates.join(', ')}`);
        }
        return;
    }

    const selectedGroup = GROUPS[args.group];
    const prisma = new PrismaClient();
    const registry = SignalRegistry.getInstance();
    const runner = new SignalBacktestRunner(
        new CandleQueryService(prisma),
        new IndicatorSeriesService(),
        new ExecutionModelService(),
        registry,
    );
    const blockRegistry = createDefaultBlockRegistry();
    const seeds = new Map(getTier1ComposedSignalSeeds().map((seed) => [seed.code, seed]));
    const results: ExperimentResult[] = [];

    try {
        console.log(`Running XAU Phase 1 group "${args.group}" (${selectedGroup.label})`);
        console.log(`Range: ${FROM.toISOString()} -> ${TO.toISOString()}`);

        for (const seedCode of selectedGroup.candidates) {
            const seed = seeds.get(seedCode);
            if (!seed) {
                console.warn(`Skipping missing seed: ${seedCode}`);
                continue;
            }

            const timeframe = String(seed.composedBlocks.timeframe ?? 'M15');
            for (const exitProfile of EXIT_PROFILES) {
                const definition = jsonClone(seed.composedBlocks);
                definition.exitManagement = { profileCode: exitProfile };

                if (exitProfile === 'XAU_NY_CLOSE') {
                    definition.takeProfit = { type: 'R_MULTIPLE', value: 2 };
                }

                const tmpCode = `MAT_${args.group}_${seedCode}_${exitProfile}`.slice(0, 60);
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
                        seedCode,
                        seedName: seed.name,
                        timeframe,
                        exitProfile,
                        summary,
                    });
                    console.log(`[DONE] ${seedCode} + ${exitProfile}: PnL=${summary.netPnl}, WR=${summary.winRate}%`);
                } finally {
                    registry.unregister(tmpCode, 1);
                }
            }
        }
    } finally {
        await prisma.$disconnect();
    }

    const outputFile: MatrixOutputFile = {
        generatedAt: new Date().toISOString(),
        group: args.group,
        groupLabel: selectedGroup.label,
        symbol: SYMBOL,
        from: FROM.toISOString(),
        to: TO.toISOString(),
        initialEquity: INITIAL_EQUITY,
        riskPercent: RISK_PERCENT,
        executionConfig: DEFAULT_EXECUTION_CONFIG,
        candidates: [...selectedGroup.candidates],
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
        Signal: row.seedCode.replace('SYS_XAU_', ''),
        Exit: row.exitProfile,
        TF: row.timeframe,
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
