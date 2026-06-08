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
 * Strategy 4: SMC Fair Value Gap + Fibonacci 61.8% Confluence (XAU LONG)
 *
 * Composed signal that requires ALL of the following within a 12-bar window:
 *   1. SMC: bullish_fvg        — Bullish Fair Value Gap present
 *   2. FIBONACCI: price_touch_618 — Price touches the 61.8% retracement level
 *   3. RSI: value_below        — RSI below 45 (not overbought, room to run)
 *   4. ATR_REGIME: atr_low     — Low volatility regime (calm before the move)
 *
 * Thesis: When price retraces to the 61.8% Fibonacci level inside a bullish FVG
 * during a low-volatility regime, and RSI confirms the pullback is not exhausted,
 * there is a high-probability long setup for a mean-reversion / continuation move.
 */

const BATCH_TAG = 'new-s4-smc-fib-confluence-2026-03-20';
const SIGNAL_CODE = 'NEW_S4_SMC_FIB_CONFLUENCE_LONG';
const SYMBOL = 'XAUUSD';
const TIMEFRAME = 'M5';
const FROM = '2019-01-01T00:00:00.000Z';
const TO = '2026-03-14T23:59:59.999Z';
const INITIAL_EQUITY = 10_000;
const RISK_PERCENT = 2;

// ─── Composed Signal Definition ──────────────────────────────────────────────

const SIGNAL_DEFINITION: ComposedSignalDefinition & { symbol?: string; timeframe?: string } = {
    symbol: SYMBOL,
    timeframe: TIMEFRAME,
    matchMode: 'ALL',
    windowBars: 12,
    side: 'LONG',
    blocks: [
        {
            id: 'smc_bullish_fvg',
            indicatorId: 'SMC',
            conditionId: 'bullish_fvg',
            indicatorParams: { swingStrength: 3, lookback: 50 },
            conditionParams: {},
        },
        {
            id: 'fib_touch_618',
            indicatorId: 'FIBONACCI',
            conditionId: 'price_touch_618',
            indicatorParams: { swingStrength: 3, lookback: 60, tolerance: 0.4 },
            conditionParams: {},
        },
        {
            id: 'rsi_below_45',
            indicatorId: 'RSI',
            conditionId: 'value_below',
            indicatorParams: { period: 14 },
            conditionParams: { threshold: 45 },
        },
        {
            id: 'atr_low_regime',
            indicatorId: 'ATR_REGIME',
            conditionId: 'atr_low',
            indicatorParams: { atrPeriod: 14, basePeriod: 50 },
            conditionParams: { multiplier: 0.9 },
        },
    ],
    stopLoss: {
        type: 'BELOW_STRUCTURE',
        value: 0.0015,
        lookback: 72,
        atrBufferMultiplier: 0.3,
        atrPeriod: 14,
    },
    takeProfit: {
        type: 'R_MULTIPLE',
        value: 2.0,
    },
    exitManagement: { profileCode: 'HARD_SIGNAL_TP' as any },
};

// ─── Execution Config ────────────────────────────────────────────────────────

const TRADE_GUARDS: TradeGuardConfigInput = {
    minTradeSpacing: { minSpacingMinutes: 30 },
    equityCurveFilter: { emaTrades: 20, action: 'HALF_RISK' },
};

const EXECUTION_CONFIG: ExecutionConfigInput = {
    entryFeeBps: 4,
    exitFeeBps: 4,
    entrySlippageBps: 2,
    exitSlippageBps: 2,
    orderTiming: 'NEXT_BAR_OPEN',
    stopLoss: { mode: 'SIGNAL_PRICE' },
    takeProfit: { mode: 'SIGNAL_PRICE' },
    positionSizing: { mode: 'RISK_BASED' },
    tradeGuards: TRADE_GUARDS,
    eventSchema: { profileCode: 'HARD_SIGNAL_TP' },
} as any;

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
    const prisma = new PrismaClient();
    const backtests = new SignalBacktestRunService(prisma);
    const execution = new SignalBacktestExecutionService(prisma);
    const registry = SignalRegistry.getInstance();
    const blockRegistry = createDefaultBlockRegistry();

    console.log(`\n${'='.repeat(70)}`);
    console.log(`Strategy 4: SMC Fair Value Gap + Fibonacci 61.8% Confluence`);
    console.log(`Batch: ${BATCH_TAG}`);
    console.log(`Signal: ${SIGNAL_CODE}`);
    console.log(`Period: ${FROM} -> ${TO}`);
    console.log(`Symbol: ${SYMBOL} | Timeframe: ${TIMEFRAME}`);
    console.log(`Equity: $${INITIAL_EQUITY.toLocaleString()} | Risk: ${RISK_PERCENT}%`);
    console.log(`Blocks: SMC(bullish_fvg) + FIB(price_touch_618) + RSI(value_below<45) + ATR_REGIME(atr_low<0.9x)`);
    console.log(`Stop: BELOW_STRUCTURE lookback=72, ATR buffer 0.3x`);
    console.log(`TP: R_MULTIPLE 2.0R | Exit: HARD_SIGNAL_TP`);
    console.log(`Guards: minTradeSpacing 30min, equityCurveFilter EMA(20) HALF_RISK`);
    console.log(`${'='.repeat(70)}\n`);

    // 1. Register the composed signal in memory
    registry.register(
        new ComposedSignalPlugin(
            SIGNAL_DEFINITION,
            blockRegistry,
            SIGNAL_CODE,
            1,
            'Strategy 4: SMC FVG + Fibonacci 61.8% Confluence — XAU LONG',
        ),
    );

    try {
        // 2. Create backtest run in DB
        const created = await backtests.createGeneratedBacktest({
            signalCode: SIGNAL_CODE,
            signalVersion: 1,
            symbol: SYMBOL,
            timeframe: TIMEFRAME,
            dateRange: { from: FROM, to: TO },
            parameters: {
                strategy: 'S4_SMC_FIB_CONFLUENCE',
                matchMode: 'ALL',
                windowBars: 12,
                blocks: {
                    smc: { conditionId: 'bullish_fvg', swingStrength: 3, lookback: 50 },
                    fibonacci: { conditionId: 'price_touch_618', swingStrength: 3, lookback: 60, tolerance: 0.4 },
                    rsi: { conditionId: 'value_below', period: 14, threshold: 45 },
                    atrRegime: { conditionId: 'atr_low', atrPeriod: 14, basePeriod: 50, multiplier: 0.9 },
                },
                stopLoss: { type: 'BELOW_STRUCTURE', lookback: 72, atrBufferMultiplier: 0.3, atrPeriod: 14 },
                takeProfit: { type: 'R_MULTIPLE', value: 2.0 },
                exitProfile: 'HARD_SIGNAL_TP',
                tradeGuards: {
                    minTradeSpacing: 30,
                    equityCurveFilter: 'EMA(20)_HALF_RISK',
                },
            },
            executionConfig: EXECUTION_CONFIG,
            initialEquity: INITIAL_EQUITY,
            riskPercent: RISK_PERCENT,
            notes: `[${BATCH_TAG}] ${SIGNAL_CODE} — SMC bullish FVG + Fibonacci 61.8% touch + RSI<45 + ATR low regime. BELOW_STRUCTURE SL(72), 2.0R TP, HARD_SIGNAL_TP exit. Guards: spacing 30min, ECF EMA(20) HALF_RISK.`,
        });

        console.log(`Created backtest run: ${created.backtestRunId}`);
        console.log(`Signal code: ${created.signalCode}`);

        // 3. Execute the backtest
        console.log(`\nExecuting backtest...`);
        const result = await execution.executeRun(created.backtestRunId);

        console.log(`\n${'='.repeat(70)}`);
        console.log(`BACKTEST COMPLETE`);
        console.log(`  Run ID:     ${created.backtestRunId}`);
        console.log(`  Status:     ${result.status}`);
        console.log(`  Trades:     ${result.counts.persistedResults}`);
        console.log(`  Signals:    ${result.counts.persistedSignals}`);
        console.log(`${'='.repeat(70)}\n`);
    } catch (error: any) {
        console.error(`\nFAILED: ${error.message}`);
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
