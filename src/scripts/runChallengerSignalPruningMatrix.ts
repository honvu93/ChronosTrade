import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { SignalBacktestExecutionService } from '../services/signals/SignalBacktestExecutionService';
import { SignalBacktestRunService } from '../services/signals/SignalBacktestRunService';
import { ComposedSignalDefinition, ComposedSignalPlugin } from '../services/signals/ComposedSignalPlugin';
import { SignalRegistry } from '../services/signals/SignalRegistry';
import { createDefaultBlockRegistry } from '../services/signals/blocks/createDefaultBlockRegistry';
import { ExecutionConfigInput, TradeGuardConfigInput } from '../services/signals/types';
import {
    BASE_EXECUTION_CONFIG,
    computeMetrics,
    DiagnosticMetrics,
    FULL_RANGE_FROM,
    FULL_RANGE_TO,
    INITIAL_EQUITY,
    resolvePriorityArtifactDir,
    writeArtifactPair,
    XAU_SYMBOL,
} from './xauPriorityBacktestShared';

dotenv.config();

const BATCH_TAG = 'challenger-signal-pruning-2026-03-27';
const ARTIFACT_DIR = path.join(resolvePriorityArtifactDir(), 'signal-pruning');
const RISK_PERCENT = 2;

const S3_STOP_LOSS = {
    type: 'BELOW_STRUCTURE' as const,
    value: 0.0018,
    lookback: 72,
    atrBufferMultiplier: 0.2,
    atrPeriod: 14,
};

const S5_STOP_LOSS = {
    type: 'BELOW_STRUCTURE' as const,
    value: 0.0018,
    lookback: 72,
    atrBufferMultiplier: 0.2,
    atrPeriod: 14,
};

const TAKE_PROFIT = { type: 'R_MULTIPLE' as const, value: 2.5 };
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

const CONFIRMATION_TREND_BLOCK = {
    id: 'confirmation_uptrend',
    indicatorId: 'CONFIRMATION_TREND',
    conditionId: 'confirmation_uptrend',
    indicatorParams: { fastPeriod: 50, slowPeriod: 200, adxPeriod: 14 },
    conditionParams: { adxThreshold: 20 },
};

const SESSION_NY_ONLY_BLOCK = {
    id: 'session_ny_only',
    indicatorId: 'SESSION_FILTER',
    conditionId: 'in_session',
    indicatorParams: { startHour: 13, endHour: 21 },
    conditionParams: {},
};

const S3_MODERATE_GUARDS: TradeGuardConfigInput = {
    minTradeSpacing: { minSpacingMinutes: 30 },
    equityCurveFilter: { emaTrades: 20, action: 'HALF_RISK' },
    sessionLossCap: { maxLosses: 3, maxNetR: 3 },
    dayLossCap: { maxLosses: 4, maxNetR: 4 },
    lossStreakCooldown: { afterLosses: 5, cooldownMinutes: 720 },
    lossStreakThrottle: {
        steps: [
            { afterLosses: 3, riskPercent: 1.5 },
            { afterLosses: 5, riskPercent: 1.0 },
        ],
    },
};

const S5_BASE_GUARDS: TradeGuardConfigInput = {
    minTradeSpacing: { minSpacingMinutes: 30 },
    equityCurveFilter: { emaTrades: 20, action: 'HALF_RISK' },
};

interface BaselineDef {
    label: string;
    runId: string;
}

interface VariantDef {
    label: string;
    shortCode: string;
    family: 'S3' | 'S5';
    timeframe: string;
    baselineRunId: string;
    guards: TradeGuardConfigInput;
    definition: ComposedSignalDefinition;
    notes: string;
}

interface MatrixRow {
    family: 'S3' | 'S5';
    variant: string;
    runId: string;
    baseline: DiagnosticMetrics;
    metrics: DiagnosticMetrics;
    pnlPreservedPct: number;
    ddReductionPct: number;
}

const BASELINES: BaselineDef[] = [
    { label: 'S3_FULL_STACK', runId: 'cmn7omrnq1z9ptk7gtvr2rer6' },
    { label: 'S5_STATE', runId: 'cmn7ojtmm07uztk7hevcixoax' },
];

const REFERENCE_RUNS: BaselineDef[] = [
    { label: 'S3_NY_ONLY_ref', runId: 'cmn7ols9i1kt8tk7gzn0278qp' },
    { label: 'S5_3BLOCK_ref', runId: 'cmn7oj6200000tk7hzl1k0p1x' },
];

function buildExecutionConfig(guards: TradeGuardConfigInput): ExecutionConfigInput {
    return {
        ...BASE_EXECUTION_CONFIG,
        tradeGuards: guards,
        eventSchema: { profileCode: 'HARD_SIGNAL_TP' },
    } as ExecutionConfigInput;
}

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

function buildVariants(): VariantDef[] {
    return [
        {
            label: 'S3_NY_CONFIRM',
            shortCode: 'S3NYC',
            family: 'S3',
            timeframe: 'M5',
            baselineRunId: 'cmn7omrnq1z9ptk7gtvr2rer6',
            guards: S3_MODERATE_GUARDS,
            definition: {
                matchMode: 'ALL',
                windowBars: 12,
                side: 'LONG',
                blocks: [...S3_BASE_BLOCKS, SESSION_NY_ONLY_BLOCK, CONFIRMATION_TREND_BLOCK],
                stopLoss: S3_STOP_LOSS,
                takeProfit: TAKE_PROFIT,
                exitManagement: HARD_EXIT,
            },
            notes: 'S3 full stack but restrict session to NY only.',
        },
        {
            label: 'S3_FULL_W6',
            shortCode: 'S3W6',
            family: 'S3',
            timeframe: 'M5',
            baselineRunId: 'cmn7omrnq1z9ptk7gtvr2rer6',
            guards: S3_MODERATE_GUARDS,
            definition: {
                matchMode: 'ALL',
                windowBars: 6,
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
                    CONFIRMATION_TREND_BLOCK,
                ],
                stopLoss: S3_STOP_LOSS,
                takeProfit: TAKE_PROFIT,
                exitManagement: HARD_EXIT,
            },
            notes: 'S3 full stack with a shorter freshness window.',
        },
        {
            label: 'S3_NY_CONFIRM_W6',
            shortCode: 'S3NYW6',
            family: 'S3',
            timeframe: 'M5',
            baselineRunId: 'cmn7omrnq1z9ptk7gtvr2rer6',
            guards: S3_MODERATE_GUARDS,
            definition: {
                matchMode: 'ALL',
                windowBars: 6,
                side: 'LONG',
                blocks: [...S3_BASE_BLOCKS, SESSION_NY_ONLY_BLOCK, CONFIRMATION_TREND_BLOCK],
                stopLoss: S3_STOP_LOSS,
                takeProfit: TAKE_PROFIT,
                exitManagement: HARD_EXIT,
            },
            notes: 'S3 combines NY-only pruning with a shorter window.',
        },
        {
            label: 'S5_SWITCH_4BLOCK',
            shortCode: 'S5SW',
            family: 'S5',
            timeframe: 'M5',
            baselineRunId: 'cmn7ojtmm07uztk7hevcixoax',
            guards: S5_BASE_GUARDS,
            definition: {
                matchMode: 'ALL',
                windowBars: 24,
                side: 'LONG',
                blocks: [
                    {
                        id: 'smart_trail_bullish_switch',
                        indicatorId: 'SMART_TRAIL_SWITCH',
                        conditionId: 'bullish_switch',
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
                stopLoss: S5_STOP_LOSS,
                takeProfit: TAKE_PROFIT,
                exitManagement: HARD_EXIT,
            },
            notes: 'Replace bullish_state with bullish_switch while keeping the 4-block M5 setup.',
        },
        {
            label: 'S5_STATE_W12',
            shortCode: 'S5W12',
            family: 'S5',
            timeframe: 'M5',
            baselineRunId: 'cmn7ojtmm07uztk7hevcixoax',
            guards: S5_BASE_GUARDS,
            definition: {
                matchMode: 'ALL',
                windowBars: 12,
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
                stopLoss: S5_STOP_LOSS,
                takeProfit: TAKE_PROFIT,
                exitManagement: HARD_EXIT,
            },
            notes: 'Shorter 12-bar coincidence window to remove stale state alignments.',
        },
        {
            label: 'S5_STATE_CONFIRM',
            shortCode: 'S5CF',
            family: 'S5',
            timeframe: 'M5',
            baselineRunId: 'cmn7ojtmm07uztk7hevcixoax',
            guards: S5_BASE_GUARDS,
            definition: {
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
                    CONFIRMATION_TREND_BLOCK,
                ],
                stopLoss: S5_STOP_LOSS,
                takeProfit: TAKE_PROFIT,
                exitManagement: HARD_EXIT,
            },
            notes: 'Add the best historical quality filter without changing the state semantics.',
        },
        {
            label: 'S5_SWITCH_CONFIRM_W12',
            shortCode: 'S5SC12',
            family: 'S5',
            timeframe: 'M5',
            baselineRunId: 'cmn7ojtmm07uztk7hevcixoax',
            guards: S5_BASE_GUARDS,
            definition: {
                matchMode: 'ALL',
                windowBars: 12,
                side: 'LONG',
                blocks: [
                    {
                        id: 'smart_trail_bullish_switch',
                        indicatorId: 'SMART_TRAIL_SWITCH',
                        conditionId: 'bullish_switch',
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
                    CONFIRMATION_TREND_BLOCK,
                ],
                stopLoss: S5_STOP_LOSS,
                takeProfit: TAKE_PROFIT,
                exitManagement: HARD_EXIT,
            },
            notes: 'Stack event-based trigger, shorter window, and confirmation trend.',
        },
    ];
}

async function runVariant(
    prisma: PrismaClient,
    backtests: SignalBacktestRunService,
    execution: SignalBacktestExecutionService,
    blockRegistry: ReturnType<typeof createDefaultBlockRegistry>,
    variant: VariantDef,
    baseline: DiagnosticMetrics,
): Promise<MatrixRow> {
    const registry = SignalRegistry.getInstance();
    const signalCode = `${variant.shortCode}_${Math.random().toString(36).slice(2, 10)}`.slice(0, 60);

    registry.register(
        new ComposedSignalPlugin(
            variant.definition,
            blockRegistry,
            signalCode,
            1,
            variant.label,
        ),
    );

    try {
        const created = await backtests.createGeneratedBacktest({
            signalCode,
            signalVersion: 1,
            symbol: XAU_SYMBOL,
            timeframe: variant.timeframe,
            dateRange: { from: FULL_RANGE_FROM, to: FULL_RANGE_TO },
            executionConfig: buildExecutionConfig(variant.guards),
            initialEquity: INITIAL_EQUITY,
            riskPercent: RISK_PERCENT,
            notes: `[${BATCH_TAG}] ${variant.label} | ${variant.notes}`,
            parameters: {
                batchTag: BATCH_TAG,
                family: variant.family,
                baselineRunId: variant.baselineRunId,
                notes: variant.notes,
            },
        });

        const result = await execution.executeRun(created.backtestRunId);
        const metrics = await loadMetricsForRun(prisma, created.backtestRunId);

        console.log(
            `[DONE] ${variant.label} | runId=${created.backtestRunId} | trades=${result.counts.persistedResults} | PF=${metrics.profitFactor ?? 'N/A'} | DD=${metrics.equityDD}%`,
        );

        return {
            family: variant.family,
            variant: variant.label,
            runId: created.backtestRunId,
            baseline,
            metrics,
            pnlPreservedPct: baseline.netPnl === 0 ? 0 : toPct((metrics.netPnl / baseline.netPnl) * 100),
            ddReductionPct: baseline.equityDD === 0 ? 0 : toPct(((baseline.equityDD - metrics.equityDD) / baseline.equityDD) * 100),
        };
    } finally {
        registry.unregister(signalCode, 1);
    }
}

function renderMetricsRow(label: string, metrics: DiagnosticMetrics): string {
    return `| ${label} | ${metrics.trades} | ${metrics.winRate}% | ${metrics.profitFactor ?? 'N/A'} | $${metrics.netPnl} | ${metrics.equityDD}% | ${metrics.maxConsecutiveLosses} |`;
}

function renderMarkdown(
    generatedAt: string,
    fileStem: string,
    baselines: Array<{ label: string; metrics: DiagnosticMetrics }>,
    references: Array<{ label: string; metrics: DiagnosticMetrics }>,
    rows: MatrixRow[],
): string {
    const baselineTable = baselines.map((row) => renderMetricsRow(row.label, row.metrics)).join('\n');
    const referenceTable = references.map((row) => renderMetricsRow(row.label, row.metrics)).join('\n');
    const variantTable = rows
        .map((row) => `| ${row.family} | ${row.variant} | ${row.metrics.trades} | ${row.metrics.winRate}% | ${row.metrics.profitFactor ?? 'N/A'} | $${row.metrics.netPnl} | ${row.metrics.equityDD}% | ${row.metrics.maxConsecutiveLosses} | ${row.pnlPreservedPct}% | ${row.ddReductionPct}% | ${row.runId} |`)
        .join('\n');

    const bestDd = [...rows].sort((left, right) => right.ddReductionPct - left.ddReductionPct)[0];
    const bestBalance = [...rows]
        .filter((row) => row.metrics.profitFactor !== null)
        .sort((left, right) => (right.ddReductionPct + right.pnlPreservedPct) - (left.ddReductionPct + left.pnlPreservedPct))[0];

    return [
        '# Challenger Signal Pruning Matrix',
        '',
        `- Generated: ${generatedAt}`,
        `- Batch: \`${BATCH_TAG}\``,
        `- JSON artifact: \`${fileStem}.json\``,
        '- Goal: reduce losing clusters by pruning entry logic, not by stacking more guard pressure.',
        '',
        '## Active Baselines',
        '',
        '| Label | Trades | WR | PF | Net PnL | DD | Max CL |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
        baselineTable,
        '',
        '## Previously Tested References',
        '',
        '| Label | Trades | WR | PF | Net PnL | DD | Max CL |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
        referenceTable,
        '',
        '## New Signal-Pruning Variants',
        '',
        '| Family | Variant | Trades | WR | PF | Net PnL | DD | Max CL | PnL Preserved | DD Reduction | Run ID |',
        '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
        variantTable,
        '',
        '## Quick Findings',
        '',
        `- Best DD reduction: \`${bestDd.variant}\` | DD ${bestDd.baseline.equityDD}% -> ${bestDd.metrics.equityDD}% (${bestDd.ddReductionPct}%).`,
        `- Best balance: \`${bestBalance.variant}\` | keep ${bestBalance.pnlPreservedPct}% PnL | cut DD ${bestBalance.ddReductionPct}% | PF ${bestBalance.metrics.profitFactor ?? 'N/A'}.`,
    ].join('\n');
}

async function main() {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

    const prisma = new PrismaClient();
    const backtests = new SignalBacktestRunService(prisma);
    const execution = new SignalBacktestExecutionService(prisma);
    const blockRegistry = createDefaultBlockRegistry();

    try {
        const baselineRows = await Promise.all(
            BASELINES.map(async (baseline) => ({
                label: baseline.label,
                metrics: await loadMetricsForRun(prisma, baseline.runId),
            })),
        );
        const referenceRows = await Promise.all(
            REFERENCE_RUNS.map(async (reference) => ({
                label: reference.label,
                metrics: await loadMetricsForRun(prisma, reference.runId),
            })),
        );

        const baselineMap = new Map(baselineRows.map((row) => [row.label, row.metrics]));
        const variants = buildVariants();

        console.log(`\n${'='.repeat(88)}`);
        console.log(`Challenger Signal Pruning Matrix — ${variants.length} variants`);
        console.log(`Batch: ${BATCH_TAG}`);
        console.log(`Range: ${FULL_RANGE_FROM} -> ${FULL_RANGE_TO}`);
        console.log(`Symbol: ${XAU_SYMBOL} | Risk: ${RISK_PERCENT}% | Equity: $${INITIAL_EQUITY.toLocaleString()}`);
        console.log(`${'='.repeat(88)}\n`);

        const rows = await Promise.all(
            variants.map((variant) =>
                runVariant(
                    prisma,
                    backtests,
                    execution,
                    blockRegistry,
                    variant,
                    baselineMap.get(variant.family === 'S3' ? 'S3_FULL_STACK' : 'S5_STATE')!,
                ),
            ),
        );

        const generatedAt = new Date().toISOString();
        const fileStem = `challenger-signal-pruning-${generatedAt.slice(0, 10)}`;
        const payload = {
            generatedAt,
            batchTag: BATCH_TAG,
            baselines: baselineRows,
            references: referenceRows,
            rows,
        };
        const markdown = renderMarkdown(generatedAt, fileStem, baselineRows, referenceRows, rows);
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
