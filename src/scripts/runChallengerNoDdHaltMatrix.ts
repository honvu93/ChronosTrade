import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { SignalBacktestExecutionService } from '../services/signals/SignalBacktestExecutionService';
import { SignalBacktestRunService } from '../services/signals/SignalBacktestRunService';
import { ExecutionConfigInput, TradeGuardConfigInput } from '../services/signals/types';
import { SignalRegistry } from '../services/signals/SignalRegistry';
import { ComposedSignalDefinition, ComposedSignalPlugin } from '../services/signals/ComposedSignalPlugin';
import { createDefaultBlockRegistry } from '../services/signals/blocks/createDefaultBlockRegistry';
import {
    BASE_EXECUTION_CONFIG,
    computeMetrics,
    DiagnosticMetrics,
    FULL_RANGE_FROM,
    FULL_RANGE_TO,
    INITIAL_EQUITY,
    writeArtifactPair,
    XAU_SYMBOL,
} from './xauPriorityBacktestShared';

dotenv.config();

const BATCH_TAG = 'challenger-no-dd-halt-2026-03-26';
const ARTIFACT_DIR = path.resolve('.artifacts', 'dd-protection');
const RISK_PERCENT = 2;

const S3_STOP_LOSS = {
    type: 'BELOW_STRUCTURE' as const,
    value: 0.0018,
    lookback: 72,
    atrBufferMultiplier: 0.2,
    atrPeriod: 14,
};

const S3_TAKE_PROFIT = { type: 'R_MULTIPLE' as const, value: 2.5 };
const HARD_EXIT = { profileCode: 'HARD_SIGNAL_TP' as const };

const S3_BASE_BLOCKS: any[] = [
    {
        id: 'pwh_breakout',
        indicatorId: 'PD_LEVELS',
        conditionId: 'closes_above_previous_week_high',
        indicatorParams: {},
        conditionParams: {},
    },
    {
        id: 'asian_high_breakout',
        indicatorId: 'SESSION_RANGE_STRUCTURE',
        conditionId: 'closes_above_asian_high',
        indicatorParams: { asianStartHour: 0, asianEndHour: 7 },
        conditionParams: {},
    },
    {
        id: 'regime_bullish',
        indicatorId: 'MARKET_REGIME',
        conditionId: 'regime_trending_bullish',
        indicatorParams: { adxPeriod: 14, atrPeriod: 14, emaFilterPeriod: 200 },
        conditionParams: { adxThreshold: 22 },
    },
    {
        id: 'trend_catcher_bull',
        indicatorId: 'TREND_CATCHER',
        conditionId: 'trend_catcher_bullish',
        indicatorParams: { fastPeriod: 10, slowPeriod: 20, rsiPeriod: 14 },
        conditionParams: { rsiThreshold: 50 },
    },
];

interface StrategyDef {
    label: string;
    shortCode: string;
    timeframe: string;
    baselineRunId: string;
    buildDefinition: () => ComposedSignalDefinition;
}

interface ProfileDef {
    label: string;
    shortCode: string;
    guards: TradeGuardConfigInput;
}

interface MatrixRow {
    strategy: string;
    profile: string;
    runId: string;
    metrics: DiagnosticMetrics;
    baseline: DiagnosticMetrics;
    pnlPreservedPct: number;
    ddReductionPct: number;
}

const STRATEGIES: StrategyDef[] = [
    {
        label: 'S3_MODERATE_GUARDS',
        shortCode: 'S3_MOD',
        timeframe: 'M5',
        baselineRunId: 'cmn7oj61o0000tk7gqeu9bry3',
        buildDefinition: () => ({
            matchMode: 'ALL',
            windowBars: 12,
            side: 'LONG',
            blocks: [...S3_BASE_BLOCKS],
            stopLoss: S3_STOP_LOSS,
            takeProfit: S3_TAKE_PROFIT,
            exitManagement: HARD_EXIT,
        }),
    },
    {
        label: 'S3_NY_ASIAN_ONLY',
        shortCode: 'S3_NYASN',
        timeframe: 'M5',
        baselineRunId: 'cmn7okn630wj4tk7geno206us',
        buildDefinition: () => ({
            matchMode: 'ALL',
            windowBars: 12,
            side: 'LONG',
            blocks: [
                ...S3_BASE_BLOCKS,
                {
                    id: 'session_ny_asian',
                    indicatorId: 'SESSION_FILTER',
                    conditionId: 'in_session',
                    indicatorParams: { startHour: 13, endHour: 7 },
                    conditionParams: {},
                },
            ],
            stopLoss: S3_STOP_LOSS,
            takeProfit: S3_TAKE_PROFIT,
            exitManagement: HARD_EXIT,
        }),
    },
    {
        label: 'S3_FULL_STACK',
        shortCode: 'S3_FULL',
        timeframe: 'M5',
        baselineRunId: 'cmn7omrnq1z9ptk7gtvr2rer6',
        buildDefinition: () => ({
            matchMode: 'ALL',
            windowBars: 12,
            side: 'LONG',
            blocks: [
                ...S3_BASE_BLOCKS,
                {
                    id: 'session_ny_asian',
                    indicatorId: 'SESSION_FILTER',
                    conditionId: 'in_session',
                    indicatorParams: { startHour: 13, endHour: 7 },
                    conditionParams: {},
                },
                {
                    id: 'confirmation_uptrend',
                    indicatorId: 'CONFIRMATION_TREND',
                    conditionId: 'confirmation_uptrend',
                    indicatorParams: { fastPeriod: 50, slowPeriod: 200, adxPeriod: 14 },
                    conditionParams: { adxThreshold: 20 },
                },
            ],
            stopLoss: S3_STOP_LOSS,
            takeProfit: S3_TAKE_PROFIT,
            exitManagement: HARD_EXIT,
        }),
    },
    {
        label: 'S5_STATE',
        shortCode: 'S5_ST',
        timeframe: 'M5',
        baselineRunId: 'cmn7ojtmm07uztk7hevcixoax',
        buildDefinition: () => ({
            matchMode: 'ALL',
            windowBars: 24,
            side: 'LONG',
            blocks: [
                {
                    id: 'smart_trail_bullish_state',
                    indicatorId: 'SMART_TRAIL_SWITCH',
                    conditionId: 'bullish_state',
                    indicatorParams: { atrPeriod: 14, multiplier: 2.5 },
                    conditionParams: {},
                },
                {
                    id: 'dow_theory_primary_uptrend',
                    indicatorId: 'DOW_THEORY_STRUCTURE',
                    conditionId: 'primary_uptrend_confirmed',
                    indicatorParams: { swingStrength: 3 },
                    conditionParams: {},
                },
                {
                    id: 'atr_regime_expansion',
                    indicatorId: 'ATR_REGIME',
                    conditionId: 'atr_expansion',
                    indicatorParams: { atrPeriod: 14, basePeriod: 50 },
                    conditionParams: { multiplier: 1.3 },
                },
                {
                    id: 'session_closes_above_asian_high',
                    indicatorId: 'SESSION_RANGE_STRUCTURE',
                    conditionId: 'closes_above_asian_high',
                    indicatorParams: { asianStartHour: 0, asianEndHour: 7 },
                    conditionParams: {},
                },
            ],
            stopLoss: S3_STOP_LOSS,
            takeProfit: S3_TAKE_PROFIT,
            exitManagement: HARD_EXIT,
        }),
    },
];

const PROFILES: ProfileDef[] = [
    {
        label: 'L2_NO_HALT',
        shortCode: 'L2NH',
        guards: {
            dayLossCap: { maxLosses: 2, maxNetR: 3 },
            sessionLossCap: { maxLosses: 2, maxNetR: 3 },
            lossStreakCooldown: { afterLosses: 3, cooldownMinutes: 1440 },
            lossStreakThrottle: {
                steps: [
                    { afterLosses: 2, riskPercent: 1.0 },
                    { afterLosses: 4, riskPercent: 0.5 },
                ],
            },
            equityCurveFilter: { emaTrades: 10, action: 'HALF_RISK' },
            minTradeSpacing: { minSpacingMinutes: 45 },
        },
    },
    {
        label: 'L3_NO_HALT',
        shortCode: 'L3NH',
        guards: {
            dayLossCap: { maxLosses: 2, maxNetR: 2 },
            sessionLossCap: { maxLosses: 1, maxNetR: 2 },
            lossStreakCooldown: { afterLosses: 3, cooldownMinutes: 2880 },
            lossStreakThrottle: {
                steps: [
                    { afterLosses: 2, riskPercent: 0.5 },
                ],
            },
            equityCurveFilter: { emaTrades: 10, action: 'HALF_RISK' },
            minTradeSpacing: { minSpacingMinutes: 60 },
        },
    },
];

function toPct(value: number): number {
    return Math.round(value * 100) / 100;
}

async function loadMetricsForRun(prisma: PrismaClient, runId: string): Promise<DiagnosticMetrics> {
    const rows = await prisma.backtestTradeResult.findMany({
        where: { backtestRunId: runId },
        select: {
            pnlUsd: true,
            rMultiple: true,
            win: true,
            isOpen: true,
        },
        orderBy: { exitTime: 'asc' },
    });

    return {
        runId,
        ...computeMetrics(rows.map((row) => ({
            pnlUsd: Number(row.pnlUsd),
            rMultiple: Number(row.rMultiple),
            win: row.win,
            isOpen: row.isOpen,
        }))),
    };
}

function buildExecutionConfig(guards: TradeGuardConfigInput): ExecutionConfigInput {
    return {
        ...BASE_EXECUTION_CONFIG,
        tradeGuards: guards,
        eventSchema: { profileCode: 'HARD_SIGNAL_TP' },
    } as ExecutionConfigInput;
}

async function runSingleCombination(
    prisma: PrismaClient,
    backtests: SignalBacktestRunService,
    execution: SignalBacktestExecutionService,
    blockRegistry: ReturnType<typeof createDefaultBlockRegistry>,
    strategy: StrategyDef,
    profile: ProfileDef,
    baseline: DiagnosticMetrics,
): Promise<MatrixRow> {
    const registry = SignalRegistry.getInstance();
    const signalCode = `${strategy.shortCode}_${profile.shortCode}_${Date.now()}`.slice(0, 60);

    registry.register(
        new ComposedSignalPlugin(
            strategy.buildDefinition(),
            blockRegistry,
            signalCode,
            1,
            `${strategy.label} ${profile.label}`,
        ),
    );

    try {
        const created = await backtests.createGeneratedBacktest({
            signalCode,
            signalVersion: 1,
            symbol: XAU_SYMBOL,
            timeframe: strategy.timeframe,
            dateRange: { from: FULL_RANGE_FROM, to: FULL_RANGE_TO },
            executionConfig: buildExecutionConfig(profile.guards),
            initialEquity: INITIAL_EQUITY,
            riskPercent: RISK_PERCENT,
            notes: `[${BATCH_TAG}] ${strategy.label} + ${profile.label}`,
            parameters: {
                batchTag: BATCH_TAG,
                baselineRunId: strategy.baselineRunId,
                strategy: strategy.label,
                profile: profile.label,
                guards: profile.guards,
            },
        });

        const result = await execution.executeRun(created.backtestRunId);
        const metrics = await loadMetricsForRun(prisma, created.backtestRunId);

        console.log(
            `[DONE] ${strategy.label} + ${profile.label} | runId=${created.backtestRunId} | trades=${result.counts.persistedResults} | PF=${metrics.profitFactor ?? 'N/A'} | DD=${metrics.equityDD}%`,
        );

        return {
            strategy: strategy.label,
            profile: profile.label,
            runId: created.backtestRunId,
            metrics,
            baseline,
            pnlPreservedPct: baseline.netPnl === 0 ? 0 : toPct((metrics.netPnl / baseline.netPnl) * 100),
            ddReductionPct: baseline.equityDD === 0 ? 0 : toPct(((baseline.equityDD - metrics.equityDD) / baseline.equityDD) * 100),
        };
    } finally {
        registry.unregister(signalCode, 1);
    }
}

function renderMarkdown(
    baselines: Array<{ strategy: string; metrics: DiagnosticMetrics }>,
    rows: MatrixRow[],
    generatedAt: string,
    fileStem: string,
): string {
    const baselineLines = baselines
        .map(({ strategy, metrics }) => `| ${strategy} | ${metrics.trades} | ${metrics.winRate}% | ${metrics.profitFactor ?? 'N/A'} | $${metrics.netPnl} | ${metrics.equityDD}% | ${metrics.maxConsecutiveLosses} |`)
        .join('\n');

    const matrixLines = rows
        .map((row) => `| ${row.strategy} | ${row.profile} | ${row.metrics.trades} | ${row.metrics.winRate}% | ${row.metrics.profitFactor ?? 'N/A'} | $${row.metrics.netPnl} | ${row.metrics.equityDD}% | ${row.metrics.maxConsecutiveLosses} | ${row.pnlPreservedPct}% | ${row.ddReductionPct}% | ${row.runId} |`)
        .join('\n');

    const bestBalance = [...rows]
        .filter((row) => row.metrics.profitFactor !== null)
        .sort((left, right) => (right.ddReductionPct + right.pnlPreservedPct) - (left.ddReductionPct + left.pnlPreservedPct))[0];
    const bestDdCut = [...rows].sort((left, right) => right.ddReductionPct - left.ddReductionPct)[0];
    const bestPnlKeep = [...rows].sort((left, right) => right.pnlPreservedPct - left.pnlPreservedPct)[0];

    return [
        '# Challenger No-DD-Halt Matrix',
        '',
        `- Generated: ${generatedAt}`,
        `- Batch: \`${BATCH_TAG}\``,
        `- JSON artifact: \`${fileStem}.json\``,
        `- Purpose: test whether the old L2/L3 protection ladders become usable once \`maxDrawdownHalt\` is removed.`,
        '',
        '## Baseline Challenger Runs',
        '',
        '| Strategy | Trades | WR | PF | Net PnL | DD | Max CL |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
        baselineLines,
        '',
        '## Follow-Up Matrix',
        '',
        '| Strategy | Profile | Trades | WR | PF | Net PnL | DD | Max CL | PnL Preserved | DD Reduction | Run ID |',
        '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
        matrixLines,
        '',
        '## Quick Findings',
        '',
        `- Best balance: \`${bestBalance.strategy} + ${bestBalance.profile}\` | keep ${bestBalance.pnlPreservedPct}% PnL | cut DD ${bestBalance.ddReductionPct}% | PF ${bestBalance.metrics.profitFactor ?? 'N/A'}.`,
        `- Best DD reduction: \`${bestDdCut.strategy} + ${bestDdCut.profile}\` | DD ${bestDdCut.baseline.equityDD}% -> ${bestDdCut.metrics.equityDD}% (${bestDdCut.ddReductionPct}%).`,
        `- Best PnL retention: \`${bestPnlKeep.strategy} + ${bestPnlKeep.profile}\` | keep ${bestPnlKeep.pnlPreservedPct}% of challenger baseline PnL.`,
    ].join('\n');
}

async function main() {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

    const prisma = new PrismaClient();
    const backtests = new SignalBacktestRunService(prisma);
    const execution = new SignalBacktestExecutionService(prisma);
    const blockRegistry = createDefaultBlockRegistry();

    try {
        console.log(`\n${'='.repeat(88)}`);
        console.log(`Challenger No-DD-Halt Matrix — ${STRATEGIES.length} strategies × ${PROFILES.length} profiles`);
        console.log(`Batch: ${BATCH_TAG}`);
        console.log(`Range: ${FULL_RANGE_FROM} -> ${FULL_RANGE_TO}`);
        console.log(`Symbol: ${XAU_SYMBOL} | Risk: ${RISK_PERCENT}% | Equity: $${INITIAL_EQUITY.toLocaleString()}`);
        console.log(`${'='.repeat(88)}\n`);

        const baselineEntries = await Promise.all(
            STRATEGIES.map(async (strategy) => ({
                strategy: strategy.label,
                metrics: await loadMetricsForRun(prisma, strategy.baselineRunId),
            })),
        );

        const baselineMap = new Map(baselineEntries.map((entry) => [entry.strategy, entry.metrics]));

        const rows = await Promise.all(
            STRATEGIES.flatMap((strategy) =>
                PROFILES.map((profile) =>
                    runSingleCombination(
                        prisma,
                        backtests,
                        execution,
                        blockRegistry,
                        strategy,
                        profile,
                        baselineMap.get(strategy.label)!,
                    ),
                ),
            ),
        );

        const generatedAt = new Date().toISOString();
        const fileStem = `challenger-no-dd-halt-${generatedAt.slice(0, 10)}`;
        const payload = {
            generatedAt,
            batchTag: BATCH_TAG,
            baselines: baselineEntries,
            rows,
        };
        const markdown = renderMarkdown(baselineEntries, rows, generatedAt, fileStem);
        const { jsonPath, markdownPath } = writeArtifactPair(ARTIFACT_DIR, fileStem, payload, markdown);

        console.log(`\nSaved JSON: ${jsonPath}`);
        console.log(`Saved Markdown: ${markdownPath}`);
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
