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
 * Strategy 2: Dow Theory Reversal + Fibonacci 61.8% Bounce (XAU LONG)
 *
 * Concept: Enter long when Dow Theory confirms a bullish reversal (close above
 * reaction high after a downtrend higher-low), price bounces off the 61.8% Fib
 * retracement, Smart Trail is in bullish state, and Confirmation Trend is up.
 *
 * Blocks (ALL within 24 bars):
 *   1. DOW_THEORY_STRUCTURE: bullish_reversal_confirmed (swingStrength 3)
 *   2. FIBONACCI: bounce_from_618 (swingStrength 3, lookback 50, tolerance 0.3)
 *   3. SMART_TRAIL_SWITCH: bullish_state (atrPeriod 10, multiplier 2.5)
 *   4. CONFIRMATION_TREND: confirmation_uptrend (fast 50, slow 200, adxThreshold 15)
 *
 * Stop: BELOW_STRUCTURE, lookback 72, ATR buffer 0.2, ATR period 14
 * TP: R_MULTIPLE 2.0
 * Exit: HARD_SIGNAL_TP
 * Guards: minTradeSpacing 30min, equityCurveFilter EMA(20) HALF_RISK
 *
 * Period: 2019-01-01 to 2026-03-14, XAUUSD, M5, $10K equity, 2% risk
 */

const BATCH_TAG = 'new-s2-dow-fib-reversal-2026-03-20';
const SIGNAL_CODE = 'NEW_S2_DOW_FIB_REVERSAL_LONG';
const SYMBOL = 'XAUUSD';
const TIMEFRAME = 'M5';
const FROM = '2019-01-01T00:00:00.000Z';
const TO = '2026-03-14T23:59:59.999Z';
const INITIAL_EQUITY = 10_000;
const RISK_PERCENT = 2;

// ─── Composed Signal Definition ──────────────────────────────────────────────

const SIGNAL_DEFINITION: ComposedSignalDefinition = {
    matchMode: 'ALL',
    windowBars: 24,
    side: 'LONG',
    blocks: [
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
};

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

// ─── Trade Guards ────────────────────────────────────────────────────────────

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
    console.log(`Strategy 2: Dow Theory Reversal + Fibonacci 61.8% Bounce (XAU LONG)`);
    console.log(`Batch: ${BATCH_TAG}`);
    console.log(`Signal: ${SIGNAL_CODE}`);
    console.log(`Period: ${FROM} -> ${TO}`);
    console.log(`Symbol: ${SYMBOL} | Timeframe: ${TIMEFRAME}`);
    console.log(`Equity: $${INITIAL_EQUITY.toLocaleString()} | Risk: ${RISK_PERCENT}%`);
    console.log(`Blocks: DOW_THEORY bullish_reversal + FIBONACCI bounce_618 + SMART_TRAIL bullish + CONFIRMATION uptrend`);
    console.log(`Match: ALL within 24 bars`);
    console.log(`Stop: BELOW_STRUCTURE(72) + ATR buffer 0.2x`);
    console.log(`TP: R_MULTIPLE 2.0 | Exit: HARD_SIGNAL_TP`);
    console.log(`Guards: minTradeSpacing 30min, equityCurveFilter EMA(20) HALF_RISK`);
    console.log(`${'='.repeat(70)}\n`);

    // 1. Register composed signal
    registry.register(
        new ComposedSignalPlugin(
            SIGNAL_DEFINITION,
            blockRegistry,
            SIGNAL_CODE,
            1,
            `Strategy 2: Dow Theory Reversal + Fib 61.8% Bounce LONG`,
        ),
    );

    try {
        // 2. Build execution config with trade guards
        const executionConfig: ExecutionConfigInput = {
            ...EXECUTION_CONFIG,
            tradeGuards: TRADE_GUARDS,
            eventSchema: { profileCode: 'HARD_SIGNAL_TP' },
        } as any;

        // 3. Create backtest run in DB
        const created = await backtests.createGeneratedBacktest({
            signalCode: SIGNAL_CODE,
            signalVersion: 1,
            symbol: SYMBOL,
            timeframe: TIMEFRAME,
            dateRange: { from: FROM, to: TO },
            parameters: {
                strategy: 'NEW_S2_DOW_FIB_REVERSAL',
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
                tpMultiple: 2.0,
                exitProfile: 'HARD_SIGNAL_TP',
                minTradeSpacingMin: 30,
                equityCurveFilterEmaTrades: 20,
                equityCurveFilterAction: 'HALF_RISK',
            },
            executionConfig,
            initialEquity: INITIAL_EQUITY,
            riskPercent: RISK_PERCENT,
            notes: `[${BATCH_TAG}] Strategy 2: Dow Theory Reversal + Fibonacci 61.8% Bounce | XAU LONG | M5`,
        });

        console.log(`Backtest run created: ${created.backtestRunId}`);

        // 4. Execute the backtest
        console.log(`Executing backtest...`);
        const result = await execution.executeRun(created.backtestRunId);

        console.log(`\n${'='.repeat(70)}`);
        console.log(`RESULT: status=${result.status}, trades=${result.counts.persistedResults}`);
        console.log(`Run ID: ${created.backtestRunId}`);
        console.log(`${'='.repeat(70)}\n`);
    } catch (error: any) {
        console.error(`FAILED: ${error.message}`);
        console.error(error.stack);
    } finally {
        registry.unregister(SIGNAL_CODE, 1);
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
