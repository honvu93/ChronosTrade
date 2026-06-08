import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { SignalBacktestExecutionService } from '../services/signals/SignalBacktestExecutionService';
import { SignalBacktestRunService } from '../services/signals/SignalBacktestRunService';
import { ExecutionConfigInput, TradeGuardConfigInput } from '../services/signals/types';
import { SignalRegistry } from '../services/signals/SignalRegistry';
import { ComposedSignalDefinition, ComposedSignalPlugin } from '../services/signals/ComposedSignalPlugin';
import { createDefaultBlockRegistry } from '../services/signals/blocks/createDefaultBlockRegistry';

dotenv.config();

/**
 * Strategy 2 Optimization: Dow Theory Reversal + Fibonacci 61.8% Bounce (XAU LONG)
 *
 * Original result: 967 trades, WR 44.9%, Net R +130R, PF 1.19
 * Problem: London session dragging (PF 0.73, -39R). NY is best (PF 1.72, +121R).
 *
 * Variants:
 *   S2_NO_LONDON  — Exclude London (trade Asian 00-07 + NY 13-21 UTC)
 *   S2_NY_ONLY    — Only trade NY session (13-21 UTC)
 *   S2_HIGHER_TP  — Keep all sessions, increase TP to 2.5R
 */

const BATCH_TAG = 'new-s2-optimized-2026-03-20';
const SYMBOL = 'XAUUSD';
const TIMEFRAME = 'M5';
const FROM = '2019-01-01T00:00:00.000Z';
const TO = '2026-03-14T23:59:59.999Z';
const INITIAL_EQUITY = 10_000;
const RISK_PERCENT = 2;

// ─── Base blocks (shared across all variants) ───────────────────────────────

const BASE_BLOCKS = [
    {
        id: 'dow_bullish_reversal',
        indicatorId: 'DOW_THEORY_STRUCTURE',
        conditionId: 'bullish_reversal_confirmed',
        indicatorParams: { swingStrength: 3 },
        conditionParams: {},
    },
    {
        id: 'fib_bounce_618',
        indicatorId: 'FIBONACCI',
        conditionId: 'bounce_from_618',
        indicatorParams: { swingStrength: 3, lookback: 50, tolerance: 0.3 },
        conditionParams: {},
    },
    {
        id: 'smart_trail_bullish',
        indicatorId: 'SMART_TRAIL_SWITCH',
        conditionId: 'bullish_state',
        indicatorParams: { atrPeriod: 10, multiplier: 2.5 },
        conditionParams: {},
    },
    {
        id: 'confirmation_uptrend',
        indicatorId: 'CONFIRMATION_TREND',
        conditionId: 'confirmation_uptrend',
        indicatorParams: { fastPeriod: 50, slowPeriod: 200, adxPeriod: 14 },
        conditionParams: { adxThreshold: 15 },
    },
];

// ─── Variant Definitions ────────────────────────────────────────────────────

interface VariantConfig {
    code: string;
    label: string;
    definition: ComposedSignalDefinition;
}

const variants: VariantConfig[] = [
    // Variant 1: No London — Asian (00-07) + NY (13-21)
    {
        code: 'S2_NO_LONDON',
        label: 'No London (Asian 00-07 + NY 13-21)',
        definition: {
            matchMode: 'ALL',
            windowBars: 24,
            side: 'LONG',
            blocks: [
                ...BASE_BLOCKS,
                {
                    id: 'session_no_london',
                    indicatorId: 'SESSION_FILTER',
                    conditionId: 'in_session',
                    indicatorParams: { startHour: 13, endHour: 7 },
                    conditionParams: {},
                },
            ],
            stopLoss: {
                type: 'BELOW_STRUCTURE',
                value: 0.0018,
                lookback: 72,
                atrBufferMultiplier: 0.2,
                atrPeriod: 14,
            },
            takeProfit: {
                type: 'R_MULTIPLE',
                value: 2.0,
            },
            exitManagement: {
                profileCode: 'HARD_SIGNAL_TP' as any,
            },
        },
    },
    // Variant 2: NY Only (13-21 UTC)
    {
        code: 'S2_NY_ONLY',
        label: 'NY Only (13-21 UTC)',
        definition: {
            matchMode: 'ALL',
            windowBars: 24,
            side: 'LONG',
            blocks: [
                ...BASE_BLOCKS,
                {
                    id: 'session_ny_only',
                    indicatorId: 'SESSION_FILTER',
                    conditionId: 'in_session',
                    indicatorParams: { startHour: 13, endHour: 21 },
                    conditionParams: {},
                },
            ],
            stopLoss: {
                type: 'BELOW_STRUCTURE',
                value: 0.0018,
                lookback: 72,
                atrBufferMultiplier: 0.2,
                atrPeriod: 14,
            },
            takeProfit: {
                type: 'R_MULTIPLE',
                value: 2.0,
            },
            exitManagement: {
                profileCode: 'HARD_SIGNAL_TP' as any,
            },
        },
    },
    // Variant 3: Higher TP (2.5R) — all sessions
    {
        code: 'S2_HIGHER_TP',
        label: 'Higher TP 2.5R (all sessions)',
        definition: {
            matchMode: 'ALL',
            windowBars: 24,
            side: 'LONG',
            blocks: [...BASE_BLOCKS],
            stopLoss: {
                type: 'BELOW_STRUCTURE',
                value: 0.0018,
                lookback: 72,
                atrBufferMultiplier: 0.2,
                atrPeriod: 14,
            },
            takeProfit: {
                type: 'R_MULTIPLE',
                value: 2.5,
            },
            exitManagement: {
                profileCode: 'HARD_SIGNAL_TP' as any,
            },
        },
    },
];

// ─── Execution Config ────────────────────────────────────────────────────────

const EXECUTION_CONFIG: ExecutionConfigInput = {
    entryFeeBps: 4,
    exitFeeBps: 4,
    entrySlippageBps: 2,
    exitSlippageBps: 2,
    orderTiming: 'NEXT_BAR_OPEN',
    stopLoss: { mode: 'SIGNAL_PRICE' },
    takeProfit: { mode: 'SIGNAL_PRICE' },
    positionSizing: { mode: 'RISK_BASED' },
};

const TRADE_GUARDS: TradeGuardConfigInput = {
    minTradeSpacing: { minSpacingMinutes: 30 },
    equityCurveFilter: { emaTrades: 20, action: 'HALF_RISK' },
};

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
    const prisma = new PrismaClient();
    const backtests = new SignalBacktestRunService(prisma);
    const execution = new SignalBacktestExecutionService(prisma);
    const registry = SignalRegistry.getInstance();
    const blockRegistry = createDefaultBlockRegistry();

    console.log(`\n${'='.repeat(70)}`);
    console.log(`Strategy 2 OPTIMIZATION: Dow Theory + Fibonacci Reversal`);
    console.log(`Batch: ${BATCH_TAG}`);
    console.log(`Running ${variants.length} variants...`);
    console.log(`Period: ${FROM} -> ${TO}`);
    console.log(`Symbol: ${SYMBOL} | Timeframe: ${TIMEFRAME}`);
    console.log(`Equity: $${INITIAL_EQUITY.toLocaleString()} | Risk: ${RISK_PERCENT}%`);
    console.log(`${'='.repeat(70)}\n`);

    const results: { code: string; label: string; runId: string; status: string; trades: number }[] = [];

    for (const variant of variants) {
        const signalCode = `NEW_${variant.code}_LONG`;
        console.log(`\n${'─'.repeat(70)}`);
        console.log(`Variant: ${variant.code} — ${variant.label}`);
        console.log(`Signal: ${signalCode}`);
        console.log(`${'─'.repeat(70)}`);

        // Register signal
        registry.register(
            new ComposedSignalPlugin(
                variant.definition,
                blockRegistry,
                signalCode,
                1,
                `Strategy 2 Opt: ${variant.label}`,
            ),
        );

        try {
            const executionConfig: ExecutionConfigInput = {
                ...EXECUTION_CONFIG,
                tradeGuards: TRADE_GUARDS,
                eventSchema: { profileCode: 'HARD_SIGNAL_TP' },
            } as any;

            const created = await backtests.createGeneratedBacktest({
                signalCode,
                signalVersion: 1,
                symbol: SYMBOL,
                timeframe: TIMEFRAME,
                dateRange: { from: FROM, to: TO },
                parameters: {
                    strategy: variant.code,
                    variant: variant.label,
                    dowSwingStrength: 3,
                    fibSwingStrength: 3,
                    fibLookback: 50,
                    fibTolerance: 0.3,
                    smartTrailAtrPeriod: 10,
                    smartTrailMultiplier: 2.5,
                    confirmFastPeriod: 50,
                    confirmSlowPeriod: 200,
                    confirmAdxThreshold: 15,
                    stopLookback: 72,
                    atrBufferMultiplier: 0.2,
                    tpMultiple: variant.definition.takeProfit.value,
                    exitProfile: 'HARD_SIGNAL_TP',
                    minTradeSpacingMin: 30,
                    equityCurveFilterEmaTrades: 20,
                    equityCurveFilterAction: 'HALF_RISK',
                },
                executionConfig,
                initialEquity: INITIAL_EQUITY,
                riskPercent: RISK_PERCENT,
                notes: `[${BATCH_TAG}] ${variant.code}: ${variant.label} | XAU LONG | M5`,
            });

            console.log(`  Backtest run created: ${created.backtestRunId}`);
            console.log(`  Executing...`);

            const result = await execution.executeRun(created.backtestRunId);

            console.log(`  DONE: status=${result.status}, trades=${result.counts.persistedResults}`);
            results.push({
                code: variant.code,
                label: variant.label,
                runId: created.backtestRunId,
                status: result.status,
                trades: result.counts.persistedResults,
            });
        } catch (error: any) {
            console.error(`  FAILED: ${error.message}`);
            console.error(error.stack);
            results.push({
                code: variant.code,
                label: variant.label,
                runId: 'FAILED',
                status: 'ERROR',
                trades: 0,
            });
        } finally {
            registry.unregister(signalCode, 1);
        }
    }

    console.log(`\n${'='.repeat(70)}`);
    console.log(`ALL VARIANTS COMPLETE`);
    console.log(`${'='.repeat(70)}`);
    for (const r of results) {
        console.log(`  ${r.code}: ${r.status} | trades=${r.trades} | runId=${r.runId}`);
    }
    console.log(`${'='.repeat(70)}\n`);

    await prisma.$disconnect();
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
