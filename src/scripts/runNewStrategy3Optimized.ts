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
 * Strategy 3 Optimized: PWH Breakout — 4 Variants
 *
 * Base: PWH Breakout + Asian Range Confirmation (XAU LONG)
 * Previous result: 3,071 trades, WR 46.6%, Net R +1,353R, PF 1.74, Max CL 235
 *
 * Variants:
 *   1. S3_MODERATE_GUARDS — Full Moderate trade guard profile
 *   2. S3_NY_ASIAN_ONLY — Filter out London, only trade NY+Asian
 *   3. S3_NY_ONLY — Only trade NY session (strongest edge)
 *   4. S3_FULL_STACK — NY+Asian + full guards + trend filter
 */

const BATCH_TAG = 'new-s3-optimized-2026-03-20';
const SYMBOL = 'XAUUSD';
const TIMEFRAME = 'M5';
const FROM = '2019-01-01T00:00:00.000Z';
const TO = '2026-03-14T23:59:59.999Z';
const INITIAL_EQUITY = 10_000;
const RISK_PERCENT = 2;

// ─── Base 4 blocks (shared across all variants) ──────────────────────────────

const BASE_BLOCKS: any[] = [
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

// ─── Shared SL / TP / Exit ───────────────────────────────────────────────────

const STOP_LOSS = {
    type: 'BELOW_STRUCTURE' as const,
    value: 0.0018,
    lookback: 72,
    atrBufferMultiplier: 0.2,
    atrPeriod: 14,
};

const TAKE_PROFIT = {
    type: 'R_MULTIPLE' as const,
    value: 2.5,
};

const EXIT_MANAGEMENT = {
    profileCode: 'HARD_SIGNAL_TP' as any,
};

// ─── Trade Guards: Moderate profile ──────────────────────────────────────────

const MODERATE_GUARDS: TradeGuardConfigInput = {
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

// ─── Variant Definitions ─────────────────────────────────────────────────────

interface VariantDef {
    label: string;
    signalCode: string;
    blocks: any[];
    guards: TradeGuardConfigInput;
    notes: string;
}

const VARIANTS: VariantDef[] = [
    // Variant 1: S3_MODERATE_GUARDS
    {
        label: 'S3_MODERATE_GUARDS',
        signalCode: 'S3_OPT_MODERATE_GUARDS',
        blocks: [...BASE_BLOCKS],
        guards: { ...MODERATE_GUARDS },
        notes: `[${BATCH_TAG}] S3_MODERATE_GUARDS | Base 4 blocks + full Moderate guard profile (sessionLossCap 3/3, dayLossCap 4/4, streakCooldown 5/720min, streakThrottle 3->1.5%/5->1.0%, spacing 30min, ECF EMA20 HALF_RISK)`,
    },

    // Variant 2: S3_NY_ASIAN_ONLY — filter out London (hours 13–7 UTC = NY+Asian)
    {
        label: 'S3_NY_ASIAN_ONLY',
        signalCode: 'S3_OPT_NY_ASIAN_ONLY',
        blocks: [
            ...BASE_BLOCKS,
            {
                id: 'session_ny_asian',
                indicatorId: 'SESSION_FILTER',
                conditionId: 'in_session',
                indicatorParams: { startHour: 13, endHour: 7 },
                conditionParams: {},
            },
        ],
        guards: { ...MODERATE_GUARDS },
        notes: `[${BATCH_TAG}] S3_NY_ASIAN_ONLY | Base 4 blocks + SESSION_FILTER(13-7 UTC, NY+Asian only) + Moderate guards`,
    },

    // Variant 3: S3_NY_ONLY — only NY session (13–21 UTC)
    {
        label: 'S3_NY_ONLY',
        signalCode: 'S3_OPT_NY_ONLY',
        blocks: [
            ...BASE_BLOCKS,
            {
                id: 'session_ny',
                indicatorId: 'SESSION_FILTER',
                conditionId: 'in_session',
                indicatorParams: { startHour: 13, endHour: 21 },
                conditionParams: {},
            },
        ],
        guards: { ...MODERATE_GUARDS },
        notes: `[${BATCH_TAG}] S3_NY_ONLY | Base 4 blocks + SESSION_FILTER(13-21 UTC, NY only) + Moderate guards`,
    },

    // Variant 4: S3_FULL_STACK — NY+Asian + all guards + CONFIRMATION_TREND filter
    {
        label: 'S3_FULL_STACK',
        signalCode: 'S3_OPT_FULL_STACK',
        blocks: [
            ...BASE_BLOCKS,
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
        guards: { ...MODERATE_GUARDS },
        notes: `[${BATCH_TAG}] S3_FULL_STACK | Base 4 blocks + SESSION_FILTER(13-7 UTC) + CONFIRMATION_TREND(50/200,ADX>20) + Moderate guards`,
    },
];

// ─── Execution Config Builder ────────────────────────────────────────────────

function buildExecConfig(guards: TradeGuardConfigInput): ExecutionConfigInput {
    return {
        entryFeeBps: 4,
        exitFeeBps: 4,
        entrySlippageBps: 2,
        exitSlippageBps: 2,
        orderTiming: 'NEXT_BAR_OPEN',
        stopLoss: { mode: 'SIGNAL_PRICE' },
        takeProfit: { mode: 'SIGNAL_PRICE' },
        positionSizing: { mode: 'RISK_BASED' },
        tradeGuards: guards,
    };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
    const prisma = new PrismaClient();
    const backtests = new SignalBacktestRunService(prisma);
    const execution = new SignalBacktestExecutionService(prisma);
    const registry = SignalRegistry.getInstance();
    const blockRegistry = createDefaultBlockRegistry();

    console.log(`\n${'='.repeat(70)}`);
    console.log(`Strategy 3 Optimized: PWH Breakout — 4 Variants`);
    console.log(`Batch: ${BATCH_TAG}`);
    console.log(`Period: ${FROM} -> ${TO}`);
    console.log(`Symbol: ${SYMBOL} | Timeframe: ${TIMEFRAME}`);
    console.log(`Equity: $${INITIAL_EQUITY.toLocaleString()} | Risk: ${RISK_PERCENT}%`);
    console.log(`Variants: ${VARIANTS.map((v) => v.label).join(', ')}`);
    console.log(`${'='.repeat(70)}\n`);

    const results: Array<{ label: string; signalCode: string; runId: string; status: string; trades: number }> = [];

    for (const variant of VARIANTS) {
        console.log(`\n${'─'.repeat(70)}`);
        console.log(`▶ Running: ${variant.label} (${variant.signalCode})`);
        console.log(`${'─'.repeat(70)}`);

        const composedDefinition: ComposedSignalDefinition = {
            matchMode: 'ALL',
            windowBars: 12,
            side: 'LONG',
            blocks: variant.blocks,
            stopLoss: STOP_LOSS,
            takeProfit: TAKE_PROFIT,
            exitManagement: EXIT_MANAGEMENT,
        };

        // Register signal
        registry.register(
            new ComposedSignalPlugin(
                composedDefinition,
                blockRegistry,
                variant.signalCode,
                1,
                `Strategy 3 Optimized: ${variant.label}`,
            ),
        );

        try {
            const execConfig = buildExecConfig(variant.guards);

            const created = await backtests.createGeneratedBacktest({
                signalCode: variant.signalCode,
                signalVersion: 1,
                symbol: SYMBOL,
                timeframe: TIMEFRAME,
                dateRange: { from: FROM, to: TO },
                parameters: {
                    matchMode: 'ALL',
                    windowBars: 12,
                    blocks: variant.blocks.map((b) => `${b.indicatorId}:${b.conditionId}`),
                    stopLookback: 72,
                    atrBufferMultiplier: 0.2,
                    tpMultiple: 2.5,
                    exitProfile: 'HARD_SIGNAL_TP',
                    variant: variant.label,
                    guards: {
                        sessionLossCap: '3/3',
                        dayLossCap: '4/4',
                        lossStreakCooldown: '5/720min',
                        lossStreakThrottle: '3->1.5%, 5->1.0%',
                        minTradeSpacing: 30,
                        equityCurveFilter: 'EMA(20) HALF_RISK',
                    },
                },
                executionConfig: {
                    ...execConfig,
                    eventSchema: { profileCode: 'HARD_SIGNAL_TP' },
                } as any,
                initialEquity: INITIAL_EQUITY,
                riskPercent: RISK_PERCENT,
                notes: variant.notes,
            });

            console.log(`  Created backtest run: ${created.backtestRunId}`);
            console.log(`  Executing...`);

            const result = await execution.executeRun(created.backtestRunId);

            console.log(`  ✓ Status: ${result.status}, Trades: ${result.counts.persistedResults}`);
            results.push({
                label: variant.label,
                signalCode: variant.signalCode,
                runId: created.backtestRunId,
                status: result.status,
                trades: result.counts.persistedResults,
            });
        } catch (error: any) {
            console.error(`  ✗ FAILED: ${error.message}`);
            console.error(`    ${error.stack?.split('\n')[1]?.trim() ?? ''}`);
            results.push({
                label: variant.label,
                signalCode: variant.signalCode,
                runId: 'FAILED',
                status: 'ERROR',
                trades: 0,
            });
        } finally {
            registry.unregister(variant.signalCode, 1);
        }
    }

    // Summary
    console.log(`\n${'='.repeat(70)}`);
    console.log(`SUMMARY — Strategy 3 Optimized`);
    console.log(`${'='.repeat(70)}`);
    for (const r of results) {
        console.log(`  ${r.label.padEnd(25)} | ${r.status.padEnd(10)} | Trades: ${String(r.trades).padStart(5)} | RunID: ${r.runId}`);
    }
    console.log(`${'='.repeat(70)}\n`);

    await prisma.$disconnect();
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
