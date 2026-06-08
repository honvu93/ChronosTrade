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

const BATCH_TAG = 's5-confirm-refine-2026-03-27';
const ARTIFACT_DIR = path.join(resolvePriorityArtifactDir(), 'signal-pruning');
const RISK_PERCENT = 2;

const BASE_GUARDS: TradeGuardConfigInput = {
    minTradeSpacing: { minSpacingMinutes: 30 },
    equityCurveFilter: { emaTrades: 20, action: 'HALF_RISK' },
};

const STOP_LOSS = {
    type: 'BELOW_STRUCTURE' as const,
    value: 0.0018,
    lookback: 72,
    atrBufferMultiplier: 0.2,
    atrPeriod: 14,
};

const TAKE_PROFIT = { type: 'R_MULTIPLE' as const, value: 2.5 };
const HARD_EXIT = { profileCode: 'HARD_SIGNAL_TP' as const };

const SESSION_RANGE_BLOCK = {
    id: 'session_closes_above_asian_high',
    indicatorId: 'SESSION_RANGE_STRUCTURE',
    conditionId: 'closes_above_asian_high',
    indicatorParams: { asianStartHour: 0, asianEndHour: 7 },
    conditionParams: {},
};

const DOW_BLOCK = {
    id: 'dow_theory_primary_uptrend',
    indicatorId: 'DOW_THEORY_STRUCTURE',
    conditionId: 'primary_uptrend_confirmed',
    indicatorParams: { swingStrength: 3 },
    conditionParams: {},
};

const ATR_BLOCK = {
    id: 'atr_regime_expansion',
    indicatorId: 'ATR_REGIME',
    conditionId: 'atr_expansion',
    indicatorParams: { atrPeriod: 14, basePeriod: 50 },
    conditionParams: { multiplier: 1.3 },
};

const CONFIRMATION_BLOCK = {
    id: 'confirmation_uptrend',
    indicatorId: 'CONFIRMATION_TREND',
    conditionId: 'confirmation_uptrend',
    indicatorParams: { fastPeriod: 50, slowPeriod: 200, adxPeriod: 14 },
    conditionParams: { adxThreshold: 20 },
};

const NY_ONLY_BLOCK = {
    id: 'session_ny_only',
    indicatorId: 'SESSION_FILTER',
    conditionId: 'in_session',
    indicatorParams: { startHour: 13, endHour: 21 },
    conditionParams: {},
};

interface VariantDef {
    label: string;
    shortCode: string;
    definition: ComposedSignalDefinition;
    notes: string;
}

interface Row {
    variant: string;
    runId: string;
    metrics: DiagnosticMetrics;
    pnlVsBasePct: number;
    ddReductionVsBasePct: number;
}

const BASELINE_RUN_ID = 'cmn7ojtmm07uztk7hevcixoax';
const REFERENCE_RUNS = [
    { label: 'S5_STATE_CONFIRM_ref', runId: 'cmn86zvoh0004tkxul1g2q1t1' },
    { label: 'S5_SWITCH_CONFIRM_W12_ref', runId: 'cmn86zvog0002tkxu6nxe463d' },
];

function buildExecutionConfig(): ExecutionConfigInput {
    return {
        ...BASE_EXECUTION_CONFIG,
        tradeGuards: BASE_GUARDS,
        eventSchema: { profileCode: 'HARD_SIGNAL_TP' },
    } as ExecutionConfigInput;
}

function buildVariants(): VariantDef[] {
    return [
        {
            label: 'S5_STATE_CONFIRM_W12',
            shortCode: 'S5CF12',
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
                    DOW_BLOCK,
                    ATR_BLOCK,
                    SESSION_RANGE_BLOCK,
                    CONFIRMATION_BLOCK,
                ],
                stopLoss: STOP_LOSS,
                takeProfit: TAKE_PROFIT,
                exitManagement: HARD_EXIT,
            },
            notes: 'Keep state+confirm but shorten the coincidence window to 12 bars.',
        },
        {
            label: 'S5_STATE_CONFIRM_NY',
            shortCode: 'S5CFNY',
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
                    DOW_BLOCK,
                    ATR_BLOCK,
                    SESSION_RANGE_BLOCK,
                    CONFIRMATION_BLOCK,
                    NY_ONLY_BLOCK,
                ],
                stopLoss: STOP_LOSS,
                takeProfit: TAKE_PROFIT,
                exitManagement: HARD_EXIT,
            },
            notes: 'Add NY-only pruning on top of the best balance variant.',
        },
        {
            label: 'S5_SWITCH_CONFIRM',
            shortCode: 'S5SWCF',
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
                    DOW_BLOCK,
                    ATR_BLOCK,
                    SESSION_RANGE_BLOCK,
                    CONFIRMATION_BLOCK,
                ],
                stopLoss: STOP_LOSS,
                takeProfit: TAKE_PROFIT,
                exitManagement: HARD_EXIT,
            },
            notes: 'Isolate switch semantics without the extra W12 pruning.',
        },
        {
            label: 'S5_SWITCH_CONFIRM_NY',
            shortCode: 'S5SWNY',
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
                    DOW_BLOCK,
                    ATR_BLOCK,
                    SESSION_RANGE_BLOCK,
                    CONFIRMATION_BLOCK,
                    NY_ONLY_BLOCK,
                ],
                stopLoss: STOP_LOSS,
                takeProfit: TAKE_PROFIT,
                exitManagement: HARD_EXIT,
            },
            notes: 'Switch semantics plus confirmation and NY-only session pruning.',
        },
    ];
}

async function loadMetricsForRun(prisma: PrismaClient, runId: string): Promise<DiagnosticMetrics> {
    const rows = await prisma.backtestTradeResult.findMany({
        where: { backtestRunId: runId },
        select: { pnlUsd: true, rMultiple: true, win: true, isOpen: true },
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

function pct(value: number): number {
    return Math.round(value * 100) / 100;
}

async function runVariant(
    prisma: PrismaClient,
    backtests: SignalBacktestRunService,
    execution: SignalBacktestExecutionService,
    blockRegistry: ReturnType<typeof createDefaultBlockRegistry>,
    variant: VariantDef,
    baseline: DiagnosticMetrics,
): Promise<Row> {
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
            timeframe: 'M5',
            dateRange: { from: FULL_RANGE_FROM, to: FULL_RANGE_TO },
            executionConfig: buildExecutionConfig(),
            initialEquity: INITIAL_EQUITY,
            riskPercent: RISK_PERCENT,
            notes: `[${BATCH_TAG}] ${variant.label} | ${variant.notes}`,
            parameters: { batchTag: BATCH_TAG, baselineRunId: BASELINE_RUN_ID, notes: variant.notes },
        });

        const result = await execution.executeRun(created.backtestRunId);
        const metrics = await loadMetricsForRun(prisma, created.backtestRunId);

        console.log(`[DONE] ${variant.label} | runId=${created.backtestRunId} | trades=${result.counts.persistedResults} | PF=${metrics.profitFactor ?? 'N/A'} | DD=${metrics.equityDD}%`);

        return {
            variant: variant.label,
            runId: created.backtestRunId,
            metrics,
            pnlVsBasePct: baseline.netPnl === 0 ? 0 : pct((metrics.netPnl / baseline.netPnl) * 100),
            ddReductionVsBasePct: baseline.equityDD === 0 ? 0 : pct(((baseline.equityDD - metrics.equityDD) / baseline.equityDD) * 100),
        };
    } finally {
        registry.unregister(signalCode, 1);
    }
}

function renderRow(label: string, metrics: DiagnosticMetrics): string {
    return `| ${label} | ${metrics.trades} | ${metrics.winRate}% | ${metrics.profitFactor ?? 'N/A'} | $${metrics.netPnl} | ${metrics.equityDD}% | ${metrics.maxConsecutiveLosses} |`;
}

function renderMarkdown(
    generatedAt: string,
    fileStem: string,
    baseline: DiagnosticMetrics,
    references: Array<{ label: string; metrics: DiagnosticMetrics }>,
    rows: Row[],
): string {
    const referenceTable = references.map((row) => renderRow(row.label, row.metrics)).join('\n');
    const variantTable = rows
        .map((row) => `| ${row.variant} | ${row.metrics.trades} | ${row.metrics.winRate}% | ${row.metrics.profitFactor ?? 'N/A'} | $${row.metrics.netPnl} | ${row.metrics.equityDD}% | ${row.metrics.maxConsecutiveLosses} | ${row.pnlVsBasePct}% | ${row.ddReductionVsBasePct}% | ${row.runId} |`)
        .join('\n');
    const bestBalance = [...rows].sort((a, b) => (b.pnlVsBasePct + b.ddReductionVsBasePct) - (a.pnlVsBasePct + a.ddReductionVsBasePct))[0];
    const bestDd = [...rows].sort((a, b) => b.ddReductionVsBasePct - a.ddReductionVsBasePct)[0];

    return [
        '# S5 Confirm Refinement Matrix',
        '',
        `- Generated: ${generatedAt}`,
        `- Batch: \`${BATCH_TAG}\``,
        `- JSON artifact: \`${fileStem}.json\``,
        '',
        '## Baseline',
        '',
        '| Label | Trades | WR | PF | Net PnL | DD | Max CL |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
        renderRow('S5_STATE baseline', baseline),
        '',
        '## Reference Variants',
        '',
        '| Label | Trades | WR | PF | Net PnL | DD | Max CL |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
        referenceTable,
        '',
        '## Refinement Results',
        '',
        '| Variant | Trades | WR | PF | Net PnL | DD | Max CL | PnL vs Base | DD Reduction vs Base | Run ID |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
        variantTable,
        '',
        '## Quick Findings',
        '',
        `- Best DD reduction: \`${bestDd.variant}\` | DD ${baseline.equityDD}% -> ${bestDd.metrics.equityDD}% (${bestDd.ddReductionVsBasePct}%).`,
        `- Best balance: \`${bestBalance.variant}\` | keep ${bestBalance.pnlVsBasePct}% PnL | cut DD ${bestBalance.ddReductionVsBasePct}% | PF ${bestBalance.metrics.profitFactor ?? 'N/A'}.`,
    ].join('\n');
}

async function main() {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

    const prisma = new PrismaClient();
    const backtests = new SignalBacktestRunService(prisma);
    const execution = new SignalBacktestExecutionService(prisma);
    const blockRegistry = createDefaultBlockRegistry();

    try {
        const baseline = await loadMetricsForRun(prisma, BASELINE_RUN_ID);
        const references = await Promise.all(
            REFERENCE_RUNS.map(async (row) => ({ label: row.label, metrics: await loadMetricsForRun(prisma, row.runId) })),
        );
        const variants = buildVariants();

        console.log(`\n${'='.repeat(88)}`);
        console.log(`S5 Confirm Refinement Matrix — ${variants.length} variants`);
        console.log(`Batch: ${BATCH_TAG}`);
        console.log(`Range: ${FULL_RANGE_FROM} -> ${FULL_RANGE_TO}`);
        console.log(`Symbol: ${XAU_SYMBOL} | Risk: ${RISK_PERCENT}% | Equity: $${INITIAL_EQUITY.toLocaleString()}`);
        console.log(`${'='.repeat(88)}\n`);

        const rows = await Promise.all(
            variants.map((variant) => runVariant(prisma, backtests, execution, blockRegistry, variant, baseline)),
        );

        const generatedAt = new Date().toISOString();
        const fileStem = `s5-confirm-refine-${generatedAt.slice(0, 10)}`;
        const payload = { generatedAt, batchTag: BATCH_TAG, baseline, references, rows };
        const markdown = renderMarkdown(generatedAt, fileStem, baseline, references, rows);
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
