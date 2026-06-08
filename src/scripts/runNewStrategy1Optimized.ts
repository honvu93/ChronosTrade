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
 * Strategy 1 OPTIMIZED: Elliott Wave + RSI Divergence — 3 Relaxed Variants
 *
 * The original S1 produced only 11 trades over 6+ years (too few to be useful).
 * These 3 variants systematically loosen constraints to increase trade frequency
 * while preserving the core thesis (Elliott motive completion + RSI divergence).
 *
 * Variant A — S1_RELAXED_3BLOCK: Drop session filter, widen window to 48,
 *   more sensitive pivots (pivotLength 2), wider RSI lookback (8), lower ATR
 *   threshold (1.2). 3 blocks, ALL match.
 *
 * Variant B — S1_RELAXED_M15: Same 4 blocks as original but on M15 timeframe.
 *   Higher TF means each bar covers more price action → more condition matches
 *   per window. windowBars 24 stays the same (but now 6h worth of M15 bars).
 *
 * Variant C — S1_RELAXED_2BLOCK: Most relaxed — only Elliott + RSI divergence,
 *   no ATR/session filters, windowBars 48. Maximum signal frequency.
 *
 * All variants share: equity $10K, risk 2%, HARD_SIGNAL_TP exit,
 *   SL BELOW_STRUCTURE lookback 72, TP R_MULTIPLE 2.0,
 *   guards (spacing 30min, ECF HALF_RISK EMA 20).
 *
 * Period: 2019-01-01 to 2026-03-14, XAUUSD.
 */

const BATCH_TAG = 'new-s1-optimized-2026-03-20';
const SYMBOL = 'XAUUSD';
const FROM = '2019-01-01T00:00:00.000Z';
const TO = '2026-03-14T23:59:59.999Z';
const INITIAL_EQUITY = 10_000;
const RISK_PERCENT = 2;

// ─── Shared stop/TP/exit ────────────────────────────────────────────────────

const SHARED_SL = {
    type: 'BELOW_STRUCTURE' as const,
    value: 0.0018,
    lookback: 72,
    atrBufferMultiplier: 0.2,
    atrPeriod: 14,
};

const SHARED_TP = {
    type: 'R_MULTIPLE' as const,
    value: 2.0,
};

const SHARED_EXIT = {
    profileCode: 'HARD_SIGNAL_TP' as any,
};

// ─── Variant Definitions ────────────────────────────────────────────────────

interface VariantConfig {
    code: string;
    label: string;
    timeframe: string;
    definition: ComposedSignalDefinition;
    notes: string;
    parameters: Record<string, any>;
}

const VARIANTS: VariantConfig[] = [
    // ── Variant A: 3 blocks, no session, wider window, relaxed params ──
    {
        code: 'NEW_S1_OPT_A_3BLOCK',
        label: 'S1_RELAXED_3BLOCK',
        timeframe: 'M5',
        definition: {
            matchMode: 'ALL',
            windowBars: 48,
            side: 'LONG',
            blocks: [
                {
                    id: 'elliott_motive_bullish',
                    indicatorId: 'ELLIOTT_WAVE',
                    conditionId: 'motive_bullish',
                    indicatorParams: { pivotLength: 2 },
                    conditionParams: {},
                },
                {
                    id: 'rsi_divergence_bullish',
                    indicatorId: 'RSI',
                    conditionId: 'divergence_bullish',
                    indicatorParams: { period: 14 },
                    conditionParams: { lookback: 8 },
                },
                {
                    id: 'atr_expansion',
                    indicatorId: 'ATR_REGIME',
                    conditionId: 'atr_expansion',
                    indicatorParams: { atrPeriod: 14, basePeriod: 50 },
                    conditionParams: { multiplier: 1.2 },
                },
            ],
            stopLoss: SHARED_SL,
            takeProfit: SHARED_TP,
            exitManagement: SHARED_EXIT,
        },
        notes: `[${BATCH_TAG}] Variant A: 3 blocks (no session filter), pivotLen 2, RSI lookback 8, ATR mult 1.2, windowBars 48 | SL: below structure 72 | TP: 2R | Exit: HARD_SIGNAL_TP | Guards: minSpacing 30min + ECF EMA(20) HALF_RISK`,
        parameters: {
            strategy: 'NEW_S1_OPT_A_3BLOCK',
            variant: 'A_RELAXED_3BLOCK',
            elliottPivotLength: 2,
            rsiPeriod: 14,
            rsiDivLookback: 8,
            atrMultiplier: 1.2,
            windowBars: 48,
            blocksCount: 3,
            noSessionFilter: true,
            stopLookback: 72,
            tpMultiple: 2.0,
            exitProfile: 'HARD_SIGNAL_TP',
            guards: 'minSpacing30_ecfHalf20',
        },
    },
    // ── Variant B: Original 4 blocks on M15 ──
    {
        code: 'NEW_S1_OPT_B_M15',
        label: 'S1_RELAXED_M15',
        timeframe: 'M15',
        definition: {
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
            stopLoss: SHARED_SL,
            takeProfit: SHARED_TP,
            exitManagement: SHARED_EXIT,
        },
        notes: `[${BATCH_TAG}] Variant B: Original 4 blocks on M15 timeframe (24 bars = 6h window) | SL: below structure 72 | TP: 2R | Exit: HARD_SIGNAL_TP | Guards: minSpacing 30min + ECF EMA(20) HALF_RISK`,
        parameters: {
            strategy: 'NEW_S1_OPT_B_M15',
            variant: 'B_RELAXED_M15',
            elliottPivotLength: 3,
            rsiPeriod: 14,
            rsiDivLookback: 5,
            atrMultiplier: 1.3,
            sessionStart: 7,
            sessionEnd: 13,
            windowBars: 24,
            timeframe: 'M15',
            blocksCount: 4,
            stopLookback: 72,
            tpMultiple: 2.0,
            exitProfile: 'HARD_SIGNAL_TP',
            guards: 'minSpacing30_ecfHalf20',
        },
    },
    // ── Variant C: Only 2 blocks (Elliott + RSI), no ATR/session, wide window ──
    {
        code: 'NEW_S1_OPT_C_2BLOCK',
        label: 'S1_RELAXED_2BLOCK',
        timeframe: 'M5',
        definition: {
            matchMode: 'ALL',
            windowBars: 48,
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
            ],
            stopLoss: SHARED_SL,
            takeProfit: SHARED_TP,
            exitManagement: SHARED_EXIT,
        },
        notes: `[${BATCH_TAG}] Variant C: 2 blocks only (Elliott + RSI div), no ATR/session filters, windowBars 48 | SL: below structure 72 | TP: 2R | Exit: HARD_SIGNAL_TP | Guards: minSpacing 30min + ECF EMA(20) HALF_RISK`,
        parameters: {
            strategy: 'NEW_S1_OPT_C_2BLOCK',
            variant: 'C_RELAXED_2BLOCK',
            elliottPivotLength: 3,
            rsiPeriod: 14,
            rsiDivLookback: 5,
            windowBars: 48,
            blocksCount: 2,
            noSessionFilter: true,
            noAtrFilter: true,
            stopLookback: 72,
            tpMultiple: 2.0,
            exitProfile: 'HARD_SIGNAL_TP',
            guards: 'minSpacing30_ecfHalf20',
        },
    },
];

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
    console.log(`STRATEGY 1 OPTIMIZED: Elliott Wave + RSI Divergence — 3 Variants`);
    console.log(`Batch: ${BATCH_TAG}`);
    console.log(`Symbol: ${SYMBOL} | Period: ${FROM} -> ${TO}`);
    console.log(`Equity: $${INITIAL_EQUITY.toLocaleString()} | Risk: ${RISK_PERCENT}%`);
    console.log(`${'='.repeat(70)}\n`);

    const results: Array<{ code: string; label: string; runId: string; trades: number; status: string }> = [];

    for (const variant of VARIANTS) {
        console.log(`\n${'─'.repeat(70)}`);
        console.log(`Running Variant: ${variant.label} (${variant.code})`);
        console.log(`Timeframe: ${variant.timeframe} | Blocks: ${variant.definition.blocks.length} | Window: ${variant.definition.windowBars} bars`);
        console.log(`${'─'.repeat(70)}\n`);

        // 1. Register signal
        registry.register(
            new ComposedSignalPlugin(
                variant.definition,
                blockRegistry,
                variant.code,
                1,
                `Strategy 1 Optimized: ${variant.label}`,
            ),
        );

        try {
            // 2. Build execution config
            const executionConfig: ExecutionConfigInput = {
                ...BASE_EXECUTION_CONFIG,
                tradeGuards: TRADE_GUARDS,
                eventSchema: { profileCode: 'HARD_SIGNAL_TP' },
            } as any;

            // 3. Create run
            const created = await backtests.createGeneratedBacktest({
                signalCode: variant.code,
                signalVersion: 1,
                symbol: SYMBOL,
                timeframe: variant.timeframe,
                dateRange: { from: FROM, to: TO },
                parameters: variant.parameters,
                executionConfig,
                initialEquity: INITIAL_EQUITY,
                riskPercent: RISK_PERCENT,
                notes: variant.notes,
            });

            console.log(`  Created backtest run: ${created.backtestRunId}`);

            // 4. Execute
            const result = await execution.executeRun(created.backtestRunId);
            console.log(`  Status: ${result.status}`);
            console.log(`  Trades: ${result.counts.persistedResults}`);

            results.push({
                code: variant.code,
                label: variant.label,
                runId: created.backtestRunId,
                trades: result.counts.persistedResults,
                status: result.status,
            });
        } catch (error: any) {
            console.error(`  FAILED: ${error.message}`);
            console.error(error.stack);
            results.push({
                code: variant.code,
                label: variant.label,
                runId: 'FAILED',
                trades: 0,
                status: `ERROR: ${error.message}`,
            });
        } finally {
            registry.unregister(variant.code, 1);
        }
    }

    // ── Summary ──
    console.log(`\n${'='.repeat(70)}`);
    console.log(`SUMMARY — All Variants`);
    console.log(`${'='.repeat(70)}`);
    for (const r of results) {
        console.log(`  ${r.label.padEnd(25)} | runId: ${r.runId} | trades: ${r.trades} | ${r.status}`);
    }
    console.log(`${'='.repeat(70)}\n`);

    await prisma.$disconnect();
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
