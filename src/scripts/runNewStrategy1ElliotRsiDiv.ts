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
 * NEW Strategy 1: Elliott Wave + RSI Divergence Reversal (XAU LONG)
 *
 * Thesis: Enter long when a bullish Elliott motive wave completes AND RSI
 * shows bullish divergence (price lower low, RSI higher low), during the
 * London session with ATR expansion confirming volatility participation.
 *
 * Blocks (matchMode: ALL, windowBars: 24):
 *   1. ELLIOTT_WAVE: motive_bullish (pivotLength: 3)
 *   2. RSI: divergence_bullish (period: 14, lookback: 5)
 *   3. ATR_REGIME: atr_expansion (atrPeriod: 14, basePeriod: 50, multiplier: 1.3)
 *   4. SESSION_FILTER: in_session (startHour: 7, endHour: 13)
 *
 * Side: LONG
 * Stop Loss: BELOW_STRUCTURE, lookback 72, atrBufferMultiplier 0.2, atrPeriod 14
 * Take Profit: R_MULTIPLE, value 2.0
 * Exit: HARD_SIGNAL_TP
 * Guards: minTradeSpacing 30min, equityCurveFilter EMA(20) HALF_RISK
 *
 * Period: 2019-01-01 to 2026-03-14, XAUUSD, M5, equity $10K, risk 2%
 */

const BATCH_TAG = 'new-s1-elliott-rsi-div-2026-03-20';
const SIGNAL_CODE = 'NEW_S1_ELLIOTT_RSI_DIV_LONG';
const SYMBOL = 'XAUUSD';
const TIMEFRAME = 'M5';
const FROM = '2019-01-01T00:00:00.000Z';
const TO = '2026-03-14T23:59:59.999Z';
const INITIAL_EQUITY = 10_000;
const RISK_PERCENT = 2;

// ─── Signal Definition ──────────────────────────────────────────────────────

const SIGNAL_DEFINITION: ComposedSignalDefinition = {
    matchMode: 'ALL',
    windowBars: 24,
    side: 'LONG',
    blocks: [
        {
            id: 'elliott_motive_bullish',
            indicatorId: 'ELLIOTT_WAVE',
            conditionId: 'motive_bullish',
            indicatorParams: { pivotLength: 3 },
            conditionParams: {},
        },
        {
            id: 'rsi_divergence_bullish',
            indicatorId: 'RSI',
            conditionId: 'divergence_bullish',
            indicatorParams: { period: 14 },
            conditionParams: { lookback: 5 },
        },
        {
            id: 'atr_expansion',
            indicatorId: 'ATR_REGIME',
            conditionId: 'atr_expansion',
            indicatorParams: { atrPeriod: 14, basePeriod: 50 },
            conditionParams: { multiplier: 1.3 },
        },
        {
            id: 'session_london',
            indicatorId: 'SESSION_FILTER',
            conditionId: 'in_session',
            indicatorParams: { startHour: 7, endHour: 13 },
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
};

// ─── Execution Config ───────────────────────────────────────────────────────

const BASE_EXECUTION_CONFIG: ExecutionConfigInput = {
    entryFeeBps: 4,
    exitFeeBps: 4,
    entrySlippageBps: 2,
    exitSlippageBps: 2,
    orderTiming: 'NEXT_BAR_OPEN',
    stopLoss: { mode: 'SIGNAL_PRICE' },
    takeProfit: { mode: 'SIGNAL_PRICE' },
    positionSizing: { mode: 'RISK_BASED' },
};

// ─── Trade Guards ───────────────────────────────────────────────────────────

const TRADE_GUARDS: TradeGuardConfigInput = {
    minTradeSpacing: { minSpacingMinutes: 30 },
    equityCurveFilter: { emaTrades: 20, action: 'HALF_RISK' },
};

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
    const prisma = new PrismaClient();
    const backtests = new SignalBacktestRunService(prisma);
    const execution = new SignalBacktestExecutionService(prisma);
    const registry = SignalRegistry.getInstance();
    const blockRegistry = createDefaultBlockRegistry();

    console.log(`\n${'='.repeat(70)}`);
    console.log(`NEW Strategy 1: Elliott Wave + RSI Divergence Reversal (XAU LONG)`);
    console.log(`Batch: ${BATCH_TAG}`);
    console.log(`Signal: ${SIGNAL_CODE}`);
    console.log(`Symbol: ${SYMBOL} | Timeframe: ${TIMEFRAME}`);
    console.log(`Period: ${FROM} -> ${TO}`);
    console.log(`Equity: $${INITIAL_EQUITY.toLocaleString()} | Risk: ${RISK_PERCENT}%`);
    console.log(`Blocks: ELLIOTT_WAVE(motive_bullish) + RSI(divergence_bullish) + ATR_REGIME(expansion) + SESSION_FILTER(London)`);
    console.log(`Guards: minTradeSpacing 30min + equityCurveFilter EMA(20) HALF_RISK`);
    console.log(`${'='.repeat(70)}\n`);

    // 1. Register signal
    registry.register(
        new ComposedSignalPlugin(
            SIGNAL_DEFINITION,
            blockRegistry,
            SIGNAL_CODE,
            1,
            'Strategy 1: Elliott Wave + RSI Divergence Reversal (XAU LONG)',
        ),
    );

    try {
        // 2. Build execution config with trade guards
        const executionConfig: ExecutionConfigInput = {
            ...BASE_EXECUTION_CONFIG,
            tradeGuards: TRADE_GUARDS,
            eventSchema: { profileCode: 'HARD_SIGNAL_TP' },
        } as any;

        // 3. Create run in DB
        const created = await backtests.createGeneratedBacktest({
            signalCode: SIGNAL_CODE,
            signalVersion: 1,
            symbol: SYMBOL,
            timeframe: TIMEFRAME,
            dateRange: { from: FROM, to: TO },
            parameters: {
                strategy: 'NEW_S1_ELLIOTT_RSI_DIV',
                elliottPivotLength: 3,
                rsiPeriod: 14,
                rsiDivLookback: 5,
                atrMultiplier: 1.3,
                sessionStart: 7,
                sessionEnd: 13,
                stopLookback: 72,
                tpMultiple: 2.0,
                exitProfile: 'HARD_SIGNAL_TP',
                guards: 'minSpacing30_ecfHalf20',
            },
            executionConfig,
            initialEquity: INITIAL_EQUITY,
            riskPercent: RISK_PERCENT,
            notes: `[${BATCH_TAG}] Strategy 1: Elliott Wave motive_bullish + RSI divergence_bullish + ATR expansion + London session | SL: below structure 72 bars | TP: 2R | Exit: HARD_SIGNAL_TP | Guards: minSpacing 30min + ECF EMA(20) HALF_RISK`,
        });

        console.log(`Created backtest run: ${created.backtestRunId}`);

        // 4. Execute
        const result = await execution.executeRun(created.backtestRunId);
        console.log(`\n${'='.repeat(70)}`);
        console.log(`DONE: runId=${created.backtestRunId}`);
        console.log(`Status: ${result.status}`);
        console.log(`Trades: ${result.counts.persistedResults}`);
        console.log(`${'='.repeat(70)}\n`);
    } catch (error: any) {
        console.error(`\nFAILED: ${error.message}`);
        console.error(error.stack);
    } finally {
        registry.unregister(SIGNAL_CODE, 1);
    }

    await prisma.$disconnect();
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
