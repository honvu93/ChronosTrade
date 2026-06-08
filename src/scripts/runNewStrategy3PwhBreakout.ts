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
 * Strategy 3: Previous Week High Breakout + Asian Range Confirmation (XAU LONG)
 *
 * Thesis: When price closes above the previous week high AND the Asian session
 * high, in a bullish trending regime with short-term trend alignment, it signals
 * strong weekly-level breakout momentum suitable for long continuation.
 *
 * Blocks (matchMode: ALL, windowBars: 12):
 *   1. PD_LEVELS: closes_above_previous_week_high
 *   2. SESSION_RANGE_STRUCTURE: closes_above_asian_high
 *   3. MARKET_REGIME: regime_trending_bullish (ADX > 22, price > EMA200)
 *   4. TREND_CATCHER: trend_catcher_bullish (fast10/slow20, RSI >= 50)
 *
 * StopLoss: BELOW_STRUCTURE, lookback 72, ATR buffer 0.2x
 * TakeProfit: R_MULTIPLE 2.5
 * Exit: HARD_SIGNAL_TP
 * Guards: minTradeSpacing 30min, equityCurveFilter EMA(20) HALF_RISK
 */

const BATCH_TAG = 'new-s3-pwh-breakout-2026-03-20';
const SIGNAL_CODE = 'NEW_S3_PWH_SESSION_BREAKOUT_LONG';
const SYMBOL = 'XAUUSD';
const TIMEFRAME = 'M5';
const FROM = '2019-01-01T00:00:00.000Z';
const TO = '2026-03-14T23:59:59.999Z';
const INITIAL_EQUITY = 10_000;
const RISK_PERCENT = 2;

// ─── Composed Signal Definition ──────────────────────────────────────────────

const composedDefinition: ComposedSignalDefinition = {
    matchMode: 'ALL',
    windowBars: 12,
    side: 'LONG',
    blocks: [
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
        value: 2.5,
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
    tradeGuards: {
        minTradeSpacing: { minSpacingMinutes: 30 },
        equityCurveFilter: { emaTrades: 20, action: 'HALF_RISK' },
    },
};

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
    const prisma = new PrismaClient();
    const backtests = new SignalBacktestRunService(prisma);
    const execution = new SignalBacktestExecutionService(prisma);
    const registry = SignalRegistry.getInstance();
    const blockRegistry = createDefaultBlockRegistry();

    console.log(`\n${'='.repeat(70)}`);
    console.log(`Strategy 3: Previous Week High Breakout + Asian Range Confirmation`);
    console.log(`Signal: ${SIGNAL_CODE}`);
    console.log(`Batch: ${BATCH_TAG}`);
    console.log(`Period: ${FROM} -> ${TO}`);
    console.log(`Symbol: ${SYMBOL} | Timeframe: ${TIMEFRAME}`);
    console.log(`Equity: $${INITIAL_EQUITY.toLocaleString()} | Risk: ${RISK_PERCENT}%`);
    console.log(`${'='.repeat(70)}\n`);

    // Register the composed signal
    registry.register(
        new ComposedSignalPlugin(
            composedDefinition,
            blockRegistry,
            SIGNAL_CODE,
            1,
            'Strategy 3: PWH Breakout + Asian Range Confirmation (XAU LONG)',
        ),
    );

    try {
        // Create backtest run in DB
        const created = await backtests.createGeneratedBacktest({
            signalCode: SIGNAL_CODE,
            signalVersion: 1,
            symbol: SYMBOL,
            timeframe: TIMEFRAME,
            dateRange: { from: FROM, to: TO },
            parameters: {
                matchMode: 'ALL',
                windowBars: 12,
                blocks: composedDefinition.blocks.map((b) => b.indicatorId),
                stopLookback: 72,
                atrBufferMultiplier: 0.2,
                tpMultiple: 2.5,
                exitProfile: 'HARD_SIGNAL_TP',
                adxThreshold: 22,
                rsiThreshold: 50,
                guards: {
                    minTradeSpacing: 30,
                    equityCurveFilter: 'EMA(20) HALF_RISK',
                },
            },
            executionConfig: {
                ...EXECUTION_CONFIG,
                eventSchema: { profileCode: 'HARD_SIGNAL_TP' },
            } as any,
            initialEquity: INITIAL_EQUITY,
            riskPercent: RISK_PERCENT,
            notes: `[${BATCH_TAG}] ${SIGNAL_CODE} | PWH breakout + Asian high confirmation + bullish regime + trend catcher | SL: structure 72bar ATR0.2 | TP: 2.5R | Exit: HARD_SIGNAL_TP | Guards: spacing 30min, ECF EMA(20) HALF_RISK`,
        });

        console.log(`Created backtest run: ${created.backtestRunId}`);
        console.log(`Executing...`);

        // Execute the backtest
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
