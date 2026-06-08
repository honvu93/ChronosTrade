import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { ComposedBlockConfig, ComposedSignalDefinition, ComposedSignalPlugin } from '../services/signals/ComposedSignalPlugin';
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

type BaselineConfig = {
    key: string;
    label: string;
    seedCode: string;
    timeframe: string;
};

type ExperimentConfig = {
    key: string;
    label: string;
    targetR: number;
    useTrailing: boolean;
    dowMode: 'NONE' | 'PRIMARY_UPTREND' | 'BULLISH_REVERSAL';
};

type ExperimentResult = {
    baselineKey: string;
    baselineLabel: string;
    experimentKey: string;
    experimentLabel: string;
    summary: Summary;
    delta: {
        trades: number;
        netPnl: number;
        netR: number;
        winRate: number;
        maxDd: number;
        profitFactor: number | null;
    };
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

const BASELINES: BaselineConfig[] = [
    {
        key: 'SESSION_BURST_1H',
        label: 'Session Burst Long 1h',
        seedCode: 'SYS_T1_SESSION_BURST_LONG',
        timeframe: '1h',
    },
    {
        key: 'OB_FIB_3H',
        label: 'OB + Fib Long 3h',
        seedCode: 'SYS_T1_OB_FIB_LONG',
        timeframe: '3h',
    },
];

const EXPERIMENTS: ExperimentConfig[] = [
    { key: 'RR4', label: 'R:R 1:4', targetR: 4, useTrailing: false, dowMode: 'NONE' },
    { key: 'RR5', label: 'R:R 1:5', targetR: 5, useTrailing: false, dowMode: 'NONE' },
    { key: 'RR4_TRAIL', label: 'R:R 1:4 + trailing', targetR: 4, useTrailing: true, dowMode: 'NONE' },
    { key: 'RR5_TRAIL', label: 'R:R 1:5 + trailing', targetR: 5, useTrailing: true, dowMode: 'NONE' },
    { key: 'RR4_DOW_UP', label: 'R:R 1:4 + Dow uptrend', targetR: 4, useTrailing: false, dowMode: 'PRIMARY_UPTREND' },
    { key: 'RR5_DOW_UP', label: 'R:R 1:5 + Dow uptrend', targetR: 5, useTrailing: false, dowMode: 'PRIMARY_UPTREND' },
    { key: 'RR4_TRAIL_DOW_UP', label: 'R:R 1:4 + trailing + Dow uptrend', targetR: 4, useTrailing: true, dowMode: 'PRIMARY_UPTREND' },
    { key: 'RR5_TRAIL_DOW_UP', label: 'R:R 1:5 + trailing + Dow uptrend', targetR: 5, useTrailing: true, dowMode: 'PRIMARY_UPTREND' },
    { key: 'RR4_DOW_REV', label: 'R:R 1:4 + Dow bullish reversal', targetR: 4, useTrailing: false, dowMode: 'BULLISH_REVERSAL' },
    { key: 'RR5_DOW_REV', label: 'R:R 1:5 + Dow bullish reversal', targetR: 5, useTrailing: false, dowMode: 'BULLISH_REVERSAL' },
];

const jsonClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const summarize = (results: Array<{
    isOpen: boolean;
    pnlUsd: number;
    rMultiple: number;
    win: boolean;
    maxDrawdownPct: number;
}>) => {
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

const buildDelta = (baseline: Summary, candidate: Summary) => ({
    trades: Number((candidate.trades - baseline.trades).toFixed(2)),
    netPnl: Number((candidate.netPnl - baseline.netPnl).toFixed(2)),
    netR: Number((candidate.netR - baseline.netR).toFixed(2)),
    winRate: Number((candidate.winRate - baseline.winRate).toFixed(2)),
    maxDd: Number((candidate.maxDd - baseline.maxDd).toFixed(2)),
    profitFactor: baseline.profitFactor === null || candidate.profitFactor === null
        ? null
        : Number((candidate.profitFactor - baseline.profitFactor).toFixed(2)),
});

const addDowBlock = (
    definition: ComposedSignalDefinition,
    mode: ExperimentConfig['dowMode'],
) => {
    if (mode === 'NONE') {
        return;
    }

    const conditionId = mode === 'PRIMARY_UPTREND'
        ? 'primary_uptrend_confirmed'
        : 'bullish_reversal_confirmed';

    definition.blocks.push({
        id: `dow_${conditionId.toLowerCase()}`,
        indicatorId: 'DOW_THEORY_STRUCTURE',
        conditionId,
        indicatorParams: { swingStrength: 3 },
        conditionParams: {},
    });
};

const mutateDefinitionForExperiment = (
    baseDefinition: ComposedSignalDefinition,
    experiment: ExperimentConfig,
) => {
    const definition = jsonClone(baseDefinition);
    definition.takeProfit = {
        ...definition.takeProfit,
        type: 'R_MULTIPLE',
        value: experiment.targetR,
    };
    definition.exitManagement = {
        profileCode: experiment.useTrailing ? 'BE_1R_TRAIL_2R_3R' : 'HARD_SIGNAL_TP',
    };
    addDowBlock(definition, experiment.dowMode);
    return definition;
};

async function main() {
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

    try {
        const baselineSummaries = new Map<string, Summary>();
        const results: ExperimentResult[] = [];

        for (const baseline of BASELINES) {
            const seed = seeds.get(baseline.seedCode);
            if (!seed) {
                throw new Error(`Missing seed ${baseline.seedCode}`);
            }

            const baselineCode = `TMP_${baseline.key}_BASE_${Date.now()}`;
            const baselineDefinition = jsonClone(seed.composedBlocks);
            registry.register(new ComposedSignalPlugin(
                baselineDefinition,
                blockRegistry,
                baselineCode,
                1,
                baselineCode,
            ));

            try {
                const output = await runner.run({
                    signalCode: baselineCode,
                    signalVersion: 1,
                    symbol: SYMBOL,
                    timeframe: baseline.timeframe,
                    from: FROM,
                    to: TO,
                    parameters: {},
                    initialEquity: INITIAL_EQUITY,
                    riskPercent: RISK_PERCENT,
                    executionConfig: DEFAULT_EXECUTION_CONFIG,
                });
                baselineSummaries.set(baseline.key, summarize(output.results));
            } finally {
                registry.unregister(baselineCode, 1);
            }

            const baselineSummary = baselineSummaries.get(baseline.key)!;

            for (const experiment of EXPERIMENTS) {
                const definition = mutateDefinitionForExperiment(seed.composedBlocks, experiment);
                const tmpCode = `TMP_${baseline.key}_${experiment.key}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`.slice(0, 60);

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
                        timeframe: baseline.timeframe,
                        from: FROM,
                        to: TO,
                        parameters: {},
                        initialEquity: INITIAL_EQUITY,
                        riskPercent: RISK_PERCENT,
                        executionConfig: DEFAULT_EXECUTION_CONFIG,
                    });
                    const summary = summarize(output.results);

                    results.push({
                        baselineKey: baseline.key,
                        baselineLabel: baseline.label,
                        experimentKey: experiment.key,
                        experimentLabel: experiment.label,
                        summary,
                        delta: buildDelta(baselineSummary, summary),
                    });
                } finally {
                    registry.unregister(tmpCode, 1);
                }
            }
        }

        console.log(JSON.stringify({
            scope: {
                symbol: SYMBOL,
                from: FROM.toISOString(),
                to: TO.toISOString(),
            },
            baselines: Object.fromEntries(baselineSummaries.entries()),
            experiments: results,
        }, null, 2));
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exit(1);
});
