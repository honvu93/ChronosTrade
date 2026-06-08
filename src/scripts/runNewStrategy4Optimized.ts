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
 * Strategy 4 OPTIMIZED: 3 fundamentally different variants
 *
 * Original S4 was breakeven/losing: PF 1.00, Net R -87R, 3649 trades, WR 41.5%.
 * Only NY session was marginally positive (+144R).
 *
 * These variants take completely different approaches:
 *
 * V1 — S4_FVG_EXPANSION: Trade FVG zones during volatility breakouts (ATR expansion)
 *       instead of low-vol accumulation. RSI crosses_above(50) for momentum confirmation.
 *
 * V2 — S4_FVG_OB_CONFLUENCE: Pure SMC confluence — FVG + Order Block overlap.
 *       Uses 2 SMC block instances. MARKET_REGIME trending bullish filter.
 *
 * V3 — S4_NY_SESSION_FVG: Focus on NY session only (13-21 UTC) where original was positive.
 *       Simpler setup: FVG + RSI crosses_above + ATR expansion.
 */

const BATCH_TAG = 'new-s4-optimized-2026-03-20';
const SYMBOL = 'XAUUSD';
const TIMEFRAME = 'M5';
const FROM = '2019-01-01T00:00:00.000Z';
const TO = '2026-03-14T23:59:59.999Z';
const INITIAL_EQUITY = 10_000;
const RISK_PERCENT = 2;

// ─── Shared execution config ────────────────────────────────────────────────

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

const SHARED_STOP_LOSS = {
    type: 'BELOW_STRUCTURE' as const,
    value: 0.0015,
    lookback: 72,
    atrBufferMultiplier: 0.3,
    atrPeriod: 14,
};

const SHARED_TAKE_PROFIT = {
    type: 'R_MULTIPLE' as const,
    value: 2.0,
};

// ─── Variant Definitions ────────────────────────────────────────────────────

interface VariantConfig {
    signalCode: string;
    name: string;
    description: string;
    definition: ComposedSignalDefinition & { symbol?: string; timeframe?: string };
    paramSummary: Record<string, unknown>;
}

const variants: VariantConfig[] = [
    // ── V1: FVG + Expansion ─────────────────────────────────────────────────
    {
        signalCode: 'NEW_S4_FVG_EXPANSION_LONG',
        name: 'S4v1: FVG + Volatility Expansion',
        description: 'Trade FVG zones during ATR expansion (vol breakout) with RSI momentum confirmation.',
        definition: {
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
                    id: 'rsi_crosses_above_50',
                    indicatorId: 'RSI',
                    conditionId: 'crosses_above',
                    indicatorParams: { period: 14 },
                    conditionParams: { threshold: 50 },
                },
                {
                    id: 'atr_expansion',
                    indicatorId: 'ATR_REGIME',
                    conditionId: 'atr_expansion',
                    indicatorParams: { atrPeriod: 14, basePeriod: 50 },
                    conditionParams: { multiplier: 1.3 },
                },
            ],
            stopLoss: SHARED_STOP_LOSS,
            takeProfit: SHARED_TAKE_PROFIT,
            exitManagement: { profileCode: 'HARD_SIGNAL_TP' as any },
        },
        paramSummary: {
            strategy: 'S4_FVG_EXPANSION',
            matchMode: 'ALL',
            windowBars: 12,
            blocks: {
                smc: { conditionId: 'bullish_fvg', swingStrength: 3, lookback: 50 },
                fibonacci: { conditionId: 'price_touch_618', swingStrength: 3, lookback: 60, tolerance: 0.4 },
                rsi: { conditionId: 'crosses_above', period: 14, threshold: 50 },
                atrRegime: { conditionId: 'atr_expansion', atrPeriod: 14, basePeriod: 50, multiplier: 1.3 },
            },
            stopLoss: { type: 'BELOW_STRUCTURE', lookback: 72, atrBufferMultiplier: 0.3, atrPeriod: 14 },
            takeProfit: { type: 'R_MULTIPLE', value: 2.0 },
            exitProfile: 'HARD_SIGNAL_TP',
            tradeGuards: { minTradeSpacing: 30, equityCurveFilter: 'EMA(20)_HALF_RISK' },
        },
    },

    // ── V2: FVG + Order Block Confluence ────────────────────────────────────
    {
        signalCode: 'NEW_S4_FVG_OB_CONFLUENCE_LONG',
        name: 'S4v2: FVG + Order Block Confluence',
        description: 'Pure SMC confluence: bullish FVG + price in bullish OB. Market regime trending bullish filter.',
        definition: {
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
                    id: 'smc_price_in_ob',
                    indicatorId: 'SMC',
                    conditionId: 'price_in_bullish_ob',
                    indicatorParams: { swingStrength: 3, lookback: 50 },
                    conditionParams: {},
                },
                {
                    id: 'rsi_crosses_above_45',
                    indicatorId: 'RSI',
                    conditionId: 'crosses_above',
                    indicatorParams: { period: 14 },
                    conditionParams: { threshold: 45 },
                },
                {
                    id: 'market_regime_bullish',
                    indicatorId: 'MARKET_REGIME',
                    conditionId: 'regime_trending_bullish',
                    indicatorParams: { adxPeriod: 14, atrPeriod: 14, emaFilterPeriod: 200 },
                    conditionParams: { adxThreshold: 20 },
                },
            ],
            stopLoss: SHARED_STOP_LOSS,
            takeProfit: SHARED_TAKE_PROFIT,
            exitManagement: { profileCode: 'HARD_SIGNAL_TP' as any },
        },
        paramSummary: {
            strategy: 'S4_FVG_OB_CONFLUENCE',
            matchMode: 'ALL',
            windowBars: 12,
            blocks: {
                smc_fvg: { conditionId: 'bullish_fvg', swingStrength: 3, lookback: 50 },
                smc_ob: { conditionId: 'price_in_bullish_ob', swingStrength: 3, lookback: 50 },
                rsi: { conditionId: 'crosses_above', period: 14, threshold: 45 },
                marketRegime: { conditionId: 'regime_trending_bullish', adxThreshold: 20 },
            },
            stopLoss: { type: 'BELOW_STRUCTURE', lookback: 72, atrBufferMultiplier: 0.3, atrPeriod: 14 },
            takeProfit: { type: 'R_MULTIPLE', value: 2.0 },
            exitProfile: 'HARD_SIGNAL_TP',
            tradeGuards: { minTradeSpacing: 30, equityCurveFilter: 'EMA(20)_HALF_RISK' },
        },
    },

    // ── V3: NY Session FVG ──────────────────────────────────────────────────
    {
        signalCode: 'NEW_S4_NY_SESSION_FVG_LONG',
        name: 'S4v3: NY Session FVG Only',
        description: 'Focus on NY session (13-21 UTC) where original was positive. FVG + RSI momentum + ATR expansion.',
        definition: {
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
                    id: 'rsi_crosses_above_50',
                    indicatorId: 'RSI',
                    conditionId: 'crosses_above',
                    indicatorParams: { period: 14 },
                    conditionParams: { threshold: 50 },
                },
                {
                    id: 'atr_expansion',
                    indicatorId: 'ATR_REGIME',
                    conditionId: 'atr_expansion',
                    indicatorParams: { atrPeriod: 14, basePeriod: 50 },
                    conditionParams: { multiplier: 1.2 },
                },
                {
                    id: 'ny_session_only',
                    indicatorId: 'SESSION_FILTER',
                    conditionId: 'in_session',
                    indicatorParams: { startHour: 13, endHour: 21 },
                    conditionParams: {},
                },
            ],
            stopLoss: SHARED_STOP_LOSS,
            takeProfit: SHARED_TAKE_PROFIT,
            exitManagement: { profileCode: 'HARD_SIGNAL_TP' as any },
        },
        paramSummary: {
            strategy: 'S4_NY_SESSION_FVG',
            matchMode: 'ALL',
            windowBars: 12,
            blocks: {
                smc: { conditionId: 'bullish_fvg', swingStrength: 3, lookback: 50 },
                rsi: { conditionId: 'crosses_above', period: 14, threshold: 50 },
                atrRegime: { conditionId: 'atr_expansion', atrPeriod: 14, basePeriod: 50, multiplier: 1.2 },
                sessionFilter: { conditionId: 'in_session', startHour: 13, endHour: 21 },
            },
            stopLoss: { type: 'BELOW_STRUCTURE', lookback: 72, atrBufferMultiplier: 0.3, atrPeriod: 14 },
            takeProfit: { type: 'R_MULTIPLE', value: 2.0 },
            exitProfile: 'HARD_SIGNAL_TP',
            tradeGuards: { minTradeSpacing: 30, equityCurveFilter: 'EMA(20)_HALF_RISK' },
        },
    },
];

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
    const prisma = new PrismaClient();
    const backtests = new SignalBacktestRunService(prisma);
    const execution = new SignalBacktestExecutionService(prisma);
    const registry = SignalRegistry.getInstance();
    const blockRegistry = createDefaultBlockRegistry();

    console.log(`\n${'='.repeat(70)}`);
    console.log(`Strategy 4 OPTIMIZED — 3 Variants`);
    console.log(`Batch: ${BATCH_TAG}`);
    console.log(`Period: ${FROM} -> ${TO}`);
    console.log(`Symbol: ${SYMBOL} | Timeframe: ${TIMEFRAME}`);
    console.log(`Equity: $${INITIAL_EQUITY.toLocaleString()} | Risk: ${RISK_PERCENT}%`);
    console.log(`Base: SL BELOW_STRUCTURE(72), ATR buf 0.3x | TP R_MULTIPLE 2.0R`);
    console.log(`Guards: spacing 30min, ECF EMA(20) HALF_RISK`);
    console.log(`${'='.repeat(70)}\n`);

    const results: Array<{ variant: string; signalCode: string; runId: string; trades: number; status: string }> = [];

    for (const variant of variants) {
        console.log(`\n${'─'.repeat(70)}`);
        console.log(`Running: ${variant.name}`);
        console.log(`Signal:  ${variant.signalCode}`);
        console.log(`Desc:    ${variant.description}`);
        console.log(`${'─'.repeat(70)}`);

        // Register
        registry.register(
            new ComposedSignalPlugin(
                variant.definition,
                blockRegistry,
                variant.signalCode,
                1,
                variant.name,
            ),
        );

        try {
            // Create backtest run
            const created = await backtests.createGeneratedBacktest({
                signalCode: variant.signalCode,
                signalVersion: 1,
                symbol: SYMBOL,
                timeframe: TIMEFRAME,
                dateRange: { from: FROM, to: TO },
                parameters: variant.paramSummary,
                executionConfig: EXECUTION_CONFIG,
                initialEquity: INITIAL_EQUITY,
                riskPercent: RISK_PERCENT,
                notes: `[${BATCH_TAG}] ${variant.signalCode} — ${variant.description}`,
            });

            console.log(`  Created run: ${created.backtestRunId}`);

            // Execute
            console.log(`  Executing...`);
            const result = await execution.executeRun(created.backtestRunId);

            console.log(`  Status:  ${result.status}`);
            console.log(`  Trades:  ${result.counts.persistedResults}`);
            console.log(`  Signals: ${result.counts.persistedSignals}`);

            results.push({
                variant: variant.name,
                signalCode: variant.signalCode,
                runId: created.backtestRunId,
                trades: result.counts.persistedResults,
                status: result.status,
            });
        } catch (error: any) {
            console.error(`  FAILED: ${error.message}`);
            console.error(error.stack);
            results.push({
                variant: variant.name,
                signalCode: variant.signalCode,
                runId: 'FAILED',
                trades: 0,
                status: `ERROR: ${error.message}`,
            });
        } finally {
            registry.unregister(variant.signalCode, 1);
        }
    }

    // Summary
    console.log(`\n\n${'='.repeat(70)}`);
    console.log(`STRATEGY 4 OPTIMIZED — SUMMARY`);
    console.log(`${'='.repeat(70)}`);
    for (const r of results) {
        console.log(`  ${r.variant}`);
        console.log(`    Code:   ${r.signalCode}`);
        console.log(`    Run ID: ${r.runId}`);
        console.log(`    Status: ${r.status}`);
        console.log(`    Trades: ${r.trades}`);
    }
    console.log(`${'='.repeat(70)}\n`);

    await prisma.$disconnect();
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
