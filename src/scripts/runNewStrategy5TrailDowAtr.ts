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
 * NEW Strategy 5: Smart Trail Switch + Dow Theory + ATR Breakout (XAU LONG)
 *
 * Composed signal combining:
 *   1. SMART_TRAIL_SWITCH — bullish_switch (ATR 14, multiplier 2.5)
 *   2. DOW_THEORY_STRUCTURE — primary_uptrend_confirmed (swingStrength 3)
 *   3. ATR_REGIME — atr_expansion (ATR 14, base 50, multiplier 1.4)
 *   4. SESSION_RANGE_STRUCTURE — closes_above_asian_high (asian 00:00–07:00 UTC)
 *
 * Entry: LONG, matchMode ALL, windowBars 24
 * Stop: BELOW_STRUCTURE, lookback 72, ATR buffer 0.2, ATR period 14
 * TP: R_MULTIPLE 2.5
 * Exit: HARD_SIGNAL_TP
 * Guards: minTradeSpacing 30min, equityCurveFilter EMA(20) HALF_RISK
 *
 * Period: 2019-01-01 to 2026-03-14, XAUUSD M5, $10K equity, 2% risk
 */

const BATCH_TAG = 'new-s5-trail-dow-atr-2026-03-20';
const SIGNAL_CODE = 'NEW_S5_TRAIL_DOW_ATR_LONG';
const SYMBOL = 'XAUUSD';
const TIMEFRAME = 'M5';
const FROM = '2019-01-01T00:00:00.000Z';
const TO = '2026-03-14T23:59:59.999Z';
const INITIAL_EQUITY = 10_000;
const RISK_PERCENT = 2;

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

const TRADE_GUARDS: TradeGuardConfigInput = {
    minTradeSpacing: { minSpacingMinutes: 30 },
    equityCurveFilter: { emaTrades: 20, action: 'HALF_RISK' },
};

function buildSignalDefinition(): ComposedSignalDefinition {
    return {
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
                conditionParams: { multiplier: 1.4 },
            },
            {
                id: 'session_closes_above_asian_high',
                indicatorId: 'SESSION_RANGE_STRUCTURE',
                conditionId: 'closes_above_asian_high',
                indicatorParams: { asianStartHour: 0, asianEndHour: 7 },
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
        takeProfit: { type: 'R_MULTIPLE', value: 2.5 },
        exitManagement: { profileCode: 'HARD_SIGNAL_TP' },
    };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    const prisma = new PrismaClient();
    const backtests = new SignalBacktestRunService(prisma);
    const execution = new SignalBacktestExecutionService(prisma);
    const registry = SignalRegistry.getInstance();
    const blockRegistry = createDefaultBlockRegistry();

    const definition = buildSignalDefinition();

    console.log(`\n${'='.repeat(70)}`);
    console.log(`NEW Strategy 5: Smart Trail Switch + Dow Theory + ATR Breakout`);
    console.log(`Batch: ${BATCH_TAG}`);
    console.log(`Signal: ${SIGNAL_CODE}`);
    console.log(`Period: ${FROM} -> ${TO}`);
    console.log(`Symbol: ${SYMBOL} | Timeframe: ${TIMEFRAME}`);
    console.log(`Equity: $${INITIAL_EQUITY.toLocaleString()} | Risk: ${RISK_PERCENT}%`);
    console.log(`Blocks: SMART_TRAIL_SWITCH(bullish_switch) + DOW_THEORY(primary_uptrend) + ATR_REGIME(expansion) + SESSION_RANGE(asian_high)`);
    console.log(`Stop: BELOW_STRUCTURE lookback=72, atrBuffer=0.2`);
    console.log(`TP: R_MULTIPLE 2.5 | Exit: HARD_SIGNAL_TP`);
    console.log(`Guards: minTradeSpacing=30min, equityCurveFilter=EMA(20) HALF_RISK`);
    console.log(`${'='.repeat(70)}\n`);

    // Register temporary signal
    registry.register(
        new ComposedSignalPlugin(
            definition,
            blockRegistry,
            SIGNAL_CODE,
            1,
            'NEW Strategy 5: Smart Trail Switch + Dow Theory + ATR Breakout (XAU LONG)',
        ),
    );

    try {
        const executionConfig: ExecutionConfigInput = {
            ...BASE_EXECUTION_CONFIG,
            tradeGuards: TRADE_GUARDS,
            eventSchema: { profileCode: 'HARD_SIGNAL_TP' },
        } as any;

        // Create run in DB
        const created = await backtests.createGeneratedBacktest({
            signalCode: SIGNAL_CODE,
            signalVersion: 1,
            symbol: SYMBOL,
            timeframe: TIMEFRAME,
            dateRange: { from: FROM, to: TO },
            parameters: {
                smartTrail: { atrPeriod: 14, multiplier: 2.5 },
                dowTheory: { swingStrength: 3 },
                atrRegime: { atrPeriod: 14, basePeriod: 50, multiplier: 1.4 },
                sessionRange: { asianStartHour: 0, asianEndHour: 7 },
                stopLoss: { lookback: 72, atrBufferMultiplier: 0.2 },
                takeProfit: { rMultiple: 2.5 },
                exitProfile: 'HARD_SIGNAL_TP',
                guards: { minTradeSpacing: 30, equityCurveFilter: 'EMA(20) HALF_RISK' },
            },
            executionConfig,
            initialEquity: INITIAL_EQUITY,
            riskPercent: RISK_PERCENT,
            notes: `[${BATCH_TAG}] ${SIGNAL_CODE}: Smart Trail Switch + Dow Theory Structure + ATR Expansion + Asian High Breakout`,
        });

        console.log(`Created backtest run: ${created.backtestRunId}`);

        // Execute
        const result = await execution.executeRun(created.backtestRunId);
        console.log(`\n${'='.repeat(70)}`);
        console.log(`RESULT: runId=${created.backtestRunId}`);
        console.log(`  Status: ${result.status}`);
        console.log(`  Trades: ${result.counts.persistedResults}`);
        console.log(`${'='.repeat(70)}\n`);
    } catch (error: any) {
        console.error(`FAILED: ${error.message}`);
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
