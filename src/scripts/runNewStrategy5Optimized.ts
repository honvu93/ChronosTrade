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
 * Strategy 5 Optimized — 3 variants to increase trade frequency
 *
 * Baseline: 240 trades (all Oct 2024+), WR 42.9%, Net R +66R, PF 1.67
 *
 * Variant 1 (S5_3BLOCK): Drop SESSION_RANGE, widen window to 36, lower ATR mult to 1.3
 * Variant 2 (S5_STATE): Use bullish_state (continuous) instead of bullish_switch (flip)
 * Variant 3 (S5_M15):   Same 4 blocks on M15 timeframe
 */

const BATCH_TAG = 'new-s5-optimized-2026-03-20';
const SYMBOL = 'XAUUSD';
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

const STOP_LOSS = {
    type: 'BELOW_STRUCTURE' as const,
    value: 0.0018,
    lookback: 72,
    atrBufferMultiplier: 0.2,
    atrPeriod: 14,
};

const TAKE_PROFIT = { type: 'R_MULTIPLE' as const, value: 2.5 };
const EXIT_MANAGEMENT = { profileCode: 'HARD_SIGNAL_TP' as const };

// ─── Variant definitions ─────────────────────────────────────────────────────

interface VariantConfig {
    signalCode: string;
    label: string;
    timeframe: string;
    definition: ComposedSignalDefinition;
    parameters: Record<string, any>;
}

function buildVariants(): VariantConfig[] {
    return [
        // ── Variant 1: S5_3BLOCK — drop session range, widen window, lower ATR mult
        {
            signalCode: 'S5_3BLOCK',
            label: 'S5 3-Block (no session range, windowBars=36, ATR mult=1.3)',
            timeframe: 'M5',
            definition: {
                matchMode: 'ALL',
                windowBars: 36,
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
                        conditionParams: { multiplier: 1.3 },
                    },
                ],
                stopLoss: STOP_LOSS,
                takeProfit: TAKE_PROFIT,
                exitManagement: EXIT_MANAGEMENT,
            },
            parameters: {
                variant: 'S5_3BLOCK',
                smartTrail: { atrPeriod: 14, multiplier: 2.5, condition: 'bullish_switch' },
                dowTheory: { swingStrength: 3 },
                atrRegime: { atrPeriod: 14, basePeriod: 50, multiplier: 1.3 },
                sessionRange: 'REMOVED',
                windowBars: 36,
                stopLoss: { lookback: 72, atrBufferMultiplier: 0.2 },
                takeProfit: { rMultiple: 2.5 },
                exitProfile: 'HARD_SIGNAL_TP',
                guards: { minTradeSpacing: 30, equityCurveFilter: 'EMA(20) HALF_RISK' },
            },
        },

        // ── Variant 2: S5_STATE — bullish_state instead of bullish_switch
        {
            signalCode: 'S5_STATE',
            label: 'S5 State (bullish_state continuous, 4 blocks, windowBars=24)',
            timeframe: 'M5',
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
                        conditionParams: { multiplier: 1.3 },
                    },
                    {
                        id: 'session_closes_above_asian_high',
                        indicatorId: 'SESSION_RANGE_STRUCTURE',
                        conditionId: 'closes_above_asian_high',
                        indicatorParams: { asianStartHour: 0, asianEndHour: 7 },
                        conditionParams: {},
                    },
                ],
                stopLoss: STOP_LOSS,
                takeProfit: TAKE_PROFIT,
                exitManagement: EXIT_MANAGEMENT,
            },
            parameters: {
                variant: 'S5_STATE',
                smartTrail: { atrPeriod: 14, multiplier: 2.5, condition: 'bullish_state' },
                dowTheory: { swingStrength: 3 },
                atrRegime: { atrPeriod: 14, basePeriod: 50, multiplier: 1.3 },
                sessionRange: { asianStartHour: 0, asianEndHour: 7 },
                windowBars: 24,
                stopLoss: { lookback: 72, atrBufferMultiplier: 0.2 },
                takeProfit: { rMultiple: 2.5 },
                exitProfile: 'HARD_SIGNAL_TP',
                guards: { minTradeSpacing: 30, equityCurveFilter: 'EMA(20) HALF_RISK' },
            },
        },

        // ── Variant 3: S5_M15 — original 4 blocks on M15
        {
            signalCode: 'S5_M15',
            label: 'S5 M15 (original 4 blocks on M15 timeframe)',
            timeframe: 'M15',
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
                stopLoss: STOP_LOSS,
                takeProfit: TAKE_PROFIT,
                exitManagement: EXIT_MANAGEMENT,
            },
            parameters: {
                variant: 'S5_M15',
                smartTrail: { atrPeriod: 14, multiplier: 2.5, condition: 'bullish_switch' },
                dowTheory: { swingStrength: 3 },
                atrRegime: { atrPeriod: 14, basePeriod: 50, multiplier: 1.4 },
                sessionRange: { asianStartHour: 0, asianEndHour: 7 },
                windowBars: 24,
                timeframe: 'M15',
                stopLoss: { lookback: 72, atrBufferMultiplier: 0.2 },
                takeProfit: { rMultiple: 2.5 },
                exitProfile: 'HARD_SIGNAL_TP',
                guards: { minTradeSpacing: 30, equityCurveFilter: 'EMA(20) HALF_RISK' },
            },
        },
    ];
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    const prisma = new PrismaClient();
    const backtests = new SignalBacktestRunService(prisma);
    const execution = new SignalBacktestExecutionService(prisma);
    const registry = SignalRegistry.getInstance();
    const blockRegistry = createDefaultBlockRegistry();

    const variants = buildVariants();

    console.log(`\n${'='.repeat(70)}`);
    console.log(`Strategy 5 Optimized — ${variants.length} variants`);
    console.log(`Batch: ${BATCH_TAG}`);
    console.log(`Period: ${FROM} -> ${TO}`);
    console.log(`Symbol: ${SYMBOL} | Equity: $${INITIAL_EQUITY.toLocaleString()} | Risk: ${RISK_PERCENT}%`);
    console.log(`${'='.repeat(70)}\n`);

    for (const variant of variants) {
        const signalCode = variant.signalCode;
        const signalVersion = 1;

        console.log(`\n${'─'.repeat(70)}`);
        console.log(`Variant: ${variant.label}`);
        console.log(`Signal: ${signalCode} | Timeframe: ${variant.timeframe}`);
        console.log(`${'─'.repeat(70)}`);

        // Register signal — use short name for DB VarChar(120) constraint
        registry.register(
            new ComposedSignalPlugin(
                variant.definition,
                blockRegistry,
                signalCode,
                signalVersion,
                signalCode,
            ),
        );

        try {
            const executionConfig: ExecutionConfigInput = {
                ...BASE_EXECUTION_CONFIG,
                tradeGuards: TRADE_GUARDS,
                eventSchema: { profileCode: 'HARD_SIGNAL_TP' },
            } as any;

            const created = await backtests.createGeneratedBacktest({
                signalCode,
                signalVersion,
                symbol: SYMBOL,
                timeframe: variant.timeframe,
                dateRange: { from: FROM, to: TO },
                parameters: variant.parameters,
                executionConfig,
                initialEquity: INITIAL_EQUITY,
                riskPercent: RISK_PERCENT,
                notes: `[${BATCH_TAG}] ${signalCode}: ${variant.label}`,
            });

            console.log(`  Created backtest run: ${created.backtestRunId}`);

            const result = await execution.executeRun(created.backtestRunId);
            console.log(`  Status: ${result.status}`);
            console.log(`  Trades: ${result.counts.persistedResults}`);
        } catch (error: any) {
            console.error(`  FAILED: ${error.message}`);
            console.error(error.stack);
        } finally {
            registry.unregister(signalCode, signalVersion);
        }
    }

    console.log(`\n${'='.repeat(70)}`);
    console.log(`All variants complete. Query results with batch tag: ${BATCH_TAG}`);
    console.log(`${'='.repeat(70)}\n`);

    await prisma.$disconnect();
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
