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
    candidateId: string;
    candidateLabel: string;
    changeSummary: string;
    timeframe: string;
    atrMultiplier: number;
    stressId: string;
    stressLabel: string;
    entryFeeBps: number;
    exitFeeBps: number;
    entrySlippageBps: number;
    exitSlippageBps: number;
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

type CandidateSpec = {
    id: string;
    label: string;
    atrMultiplier: number;
};

type StressSpec = {
    id: 'baseline' | 'stress_1' | 'stress_2' | 'stress_3';
    label: string;
    entryFeeBps: number;
    exitFeeBps: number;
    entrySlippageBps: number;
    exitSlippageBps: number;
};

const FROM = new Date('2019-01-01T00:00:00.000Z');
const TO = new Date('2026-03-14T23:59:59.999Z');
const SYMBOL = 'XAUUSD';
const INITIAL_EQUITY = 10_000;
const RISK_PERCENT = 1;
const BASE_SIGNAL_CODE = 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG';
const riskSummaryService = new BacktestRiskSummaryService();

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

const M5_TUNING = { windowBars: 24, stopLookback: 72 };

const CANDIDATES: CandidateSpec[] = [
    {
        id: 'm5_atr12_guard',
        label: 'M5 ATR 1.2 Guard',
        atrMultiplier: 1.2,
    },
    {
        id: 'm5_atr14_guard',
        label: 'M5 ATR 1.4 Guard',
        atrMultiplier: 1.4,
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

const GROUPS = {
    m5_atr12: {
        label: 'M5 ATR 1.2 Guard stress ladder',
        candidateIds: ['m5_atr12_guard'],
    },
    m5_atr14: {
        label: 'M5 ATR 1.4 Guard stress ladder',
        candidateIds: ['m5_atr14_guard'],
    },
    all: {
        label: 'All M5 protected candidates stress ladder',
        candidateIds: CANDIDATES.map((candidate) => candidate.id),
    },
} satisfies Record<string, { label: string; candidateIds: string[] }>;

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

function applyCandidate(definition: ComposedSignalDefinition, candidate: CandidateSpec) {
    (definition as ComposedSignalDefinition & { timeframe?: string }).timeframe = 'M5';
    definition.windowBars = M5_TUNING.windowBars;
    definition.exitManagement = { profileCode: 'HARD_SIGNAL_TP' };
    if (definition.stopLoss && typeof definition.stopLoss === 'object' && 'lookback' in definition.stopLoss) {
        definition.stopLoss.lookback = M5_TUNING.stopLookback;
    }
    getBlock(definition, 'ATR_REGIME').conditionParams = { multiplier: candidate.atrMultiplier };
}

function withStressConfig(stress: StressSpec): ExecutionConfigInput {
    return {
        ...BASE_EXECUTION_CONFIG,
        entryFeeBps: stress.entryFeeBps,
        exitFeeBps: stress.exitFeeBps,
        entrySlippageBps: stress.entrySlippageBps,
        exitSlippageBps: stress.exitSlippageBps,
    };
}

function printUsage() {
    console.log([
        'Usage:',
        '  node -r ts-node/register src/scripts/runXauAsianBreakM5StressMatrix.ts --list-groups',
        '  node -r ts-node/register src/scripts/runXauAsianBreakM5StressMatrix.ts --group m5_atr12 --out .artifacts/xau-abc-m5-stress/m5_atr12.json',
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
        console.log('Available M5 stress groups:');
        for (const [groupKey, group] of Object.entries(GROUPS)) {
            console.log(`- ${groupKey}: ${group.label}`);
            console.log(`  candidates: ${group.candidateIds.join(', ')}`);
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
    const candidatesById = new Map(CANDIDATES.map((candidate) => [candidate.id, candidate]));
    const results: VariantResult[] = [];

    try {
        console.log(`Running M5 stress group "${args.group}" (${selectedGroup.label})`);
        console.log(`Range: ${FROM.toISOString()} -> ${TO.toISOString()}`);

        for (const candidateId of selectedGroup.candidateIds) {
            const candidate = candidatesById.get(candidateId);
            if (!candidate) {
                throw new Error(`Missing candidate definition ${candidateId}.`);
            }

            for (const stress of STRESS_CASES) {
                const definition = jsonClone(baseSeed.composedBlocks) as ComposedSignalDefinition;
                applyCandidate(definition, candidate);
                const timeframe = String((definition as { timeframe?: string }).timeframe ?? 'M5');
                const tmpCode = `ABM5S_${candidate.id}_${stress.id}`.slice(0, 60).toUpperCase();

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
                        executionConfig: withStressConfig(stress),
                    });

                    results.push({
                        variantId: `${candidate.id}_${stress.id}`,
                        variantLabel: `${candidate.label} - ${stress.label}`,
                        candidateId: candidate.id,
                        candidateLabel: candidate.label,
                        changeSummary: `${candidate.label} under ${stress.label}.`,
                        timeframe,
                        atrMultiplier: candidate.atrMultiplier,
                        stressId: stress.id,
                        stressLabel: stress.label,
                        entryFeeBps: stress.entryFeeBps,
                        exitFeeBps: stress.exitFeeBps,
                        entrySlippageBps: stress.entrySlippageBps,
                        exitSlippageBps: stress.exitSlippageBps,
                        summary: summarize(output.results as Array<{
                            isOpen: boolean;
                            pnlUsd: number;
                            rMultiple: number;
                            win: boolean;
                            maxDrawdownPct: number;
                        }>),
                        riskSummary: riskSummaryService.summarize({
                            initialEquity: INITIAL_EQUITY,
                            results: output.results,
                            signals: output.signals,
                            events: output.events,
                            traces: output.traces,
                        }),
                    });

                    const latest = results[results.length - 1]!;
                    console.log(`[DONE] ${candidate.id} ${stress.id}: PnL=${latest.summary.netPnl}, WR=${latest.summary.winRate}%`);
                } finally {
                    registry.unregister(tmpCode, 1);
                }
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
        executionConfig: BASE_EXECUTION_CONFIG,
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
}

main().catch((error) => {
    console.error(error);
    printUsage();
    process.exit(1);
});
