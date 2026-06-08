import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { SignalBacktestExecutionService } from '../services/signals/SignalBacktestExecutionService';
import { SignalBacktestRunService } from '../services/signals/SignalBacktestRunService';
import { ExecutionConfigInput } from '../services/signals/types';
import { SignalRegistry } from '../services/signals/SignalRegistry';
import { ComposedSignalPlugin, ComposedSignalDefinition } from '../services/signals/ComposedSignalPlugin';
import { createDefaultBlockRegistry } from '../services/signals/blocks/createDefaultBlockRegistry';
import { getTier1ComposedSignalSeeds } from '../services/signals/tier1ComposedSignals';
import {
    applyM5Base,
    setAtrMultiplier,
    setStopLookback,
    setTakeProfitMultiple,
} from './xauAbcOptimizationShared';

dotenv.config();

// ─── Constants ────────────────────────────────────────────────────────────────

const BATCH_TAG = 'opt-6-regime-filter-v2-2026-03-19';
const BASE_SIGNAL_CODE = 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG';
const SYMBOL = 'XAUUSD';
const TIMEFRAME = 'M5';
const FROM = '2019-01-01T00:00:00.000Z';
const TO = '2026-03-14T23:59:59.999Z';
const RISK_PERCENT = 2;
const EXIT_PROFILE = 'HARD_SIGNAL_TP';

const DEFAULT_EXECUTION_CONFIG: ExecutionConfigInput = {
    entryFeeBps: 4,
    exitFeeBps: 4,
    entrySlippageBps: 2,
    exitSlippageBps: 2,
    orderTiming: 'NEXT_BAR_OPEN',
    stopLoss: { mode: 'SIGNAL_PRICE' },
    takeProfit: { mode: 'SIGNAL_PRICE' },
    positionSizing: { mode: 'RISK_BASED' },
};

// ─── Baseline variant definitions ────────────────────────────────────────────

interface BaselineSpec {
    id: string;
    mutate: (def: ComposedSignalDefinition) => void;
    params: Record<string, any>;
}

const BASELINES: BaselineSpec[] = [
    {
        id: 'B1_ATR135',
        params: { atrMultiplier: 1.35 },
        mutate: (def) => {
            setAtrMultiplier(def, 1.35);
        },
    },
    {
        id: 'B4_TP25',
        params: { tpMultiple: 2.5, stopLookback: 72 },
        mutate: (def) => {
            setTakeProfitMultiple(def, 2.5);
            setStopLookback(def, 72);
        },
    },
];

// ─── Regime filter definitions ──────────────────────────────────────────────
//
// NOTE: The base signal already has an ATR_REGIME block with atr_expansion
// condition (multiplier=1.2 or 1.35 for B1). Adding another ATR_REGIME block
// with a LOWER threshold (e.g., atr_normal >= 0.8x) is completely redundant.
// Therefore, we use DIFFERENT indicator blocks for regime filtering.

/**
 * Filter A: Market Regime Trending Bullish (ADX + EMA direction)
 * - Uses MARKET_REGIME block with regime_trending_bullish condition
 * - Requires: ADX > 20 AND price > EMA(200)
 * - This is a DIFFERENT block from the existing ATR_REGIME (atr_expansion)
 * - Filters entries in ranging/bearish markets by requiring directional trend
 * - ADX threshold lowered to 20 (from default 25) for broader applicability
 */
function addFilterA(definition: ComposedSignalDefinition): void {
    definition.blocks.push({
        id: 'opt6_regime_trending_bull',
        indicatorId: 'MARKET_REGIME',
        conditionId: 'regime_trending_bullish',
        indicatorParams: { adxPeriod: 14, atrPeriod: 14, emaFilterPeriod: 200 },
        conditionParams: { adxThreshold: 20 },
    });
}

/**
 * Filter B: Trend Confirmation Only (EMA alignment + ADX)
 * - Uses CONFIRMATION_TREND block with confirmation_uptrend condition
 * - Requires: price > EMA(200), EMA(50) > EMA(200), ADX >= 20
 * - For LONG-only Asian Break, this ensures we only trade when higher TF trend is bullish
 * - Filters counter-trend entries in bear markets (e.g., 2022)
 * - More structural than Filter A: requires BOTH fast/slow EMA alignment + ADX
 */
function addFilterB(definition: ComposedSignalDefinition): void {
    definition.blocks.push({
        id: 'opt6_confirmation_uptrend',
        indicatorId: 'CONFIRMATION_TREND',
        conditionId: 'confirmation_uptrend',
        indicatorParams: { fastPeriod: 50, slowPeriod: 200, adxPeriod: 14 },
        conditionParams: { adxThreshold: 20 },
    });
}

/**
 * Filter C: Market Regime + Trend Confirmation Combined
 * - Combines Filter A (MARKET_REGIME trending bullish) AND Filter B (CONFIRMATION_TREND uptrend)
 * - Strictest filter: needs directional regime AND structural trend alignment
 * - Expected to filter most entries but keep highest quality ones
 */
function addFilterC(definition: ComposedSignalDefinition): void {
    addFilterA(definition);
    addFilterB(definition);
}

type FilterId = 'FILTER_A_REGIME' | 'FILTER_B_TREND' | 'FILTER_C_COMBINED';

interface FilterSpec {
    id: FilterId;
    label: string;
    apply: (def: ComposedSignalDefinition) => void;
}

const FILTERS: FilterSpec[] = [
    {
        id: 'FILTER_A_REGIME',
        label: 'Market Regime Trending Bullish (ADX>20 + price>EMA200)',
        apply: addFilterA,
    },
    {
        id: 'FILTER_B_TREND',
        label: 'Trend Confirmation (EMA50>EMA200 + price>EMA200 + ADX>=20)',
        apply: addFilterB,
    },
    {
        id: 'FILTER_C_COMBINED',
        label: 'Market Regime + Trend Combined (strictest)',
        apply: addFilterC,
    },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const jsonClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
    const prisma = new PrismaClient();
    const backtests = new SignalBacktestRunService(prisma);
    const execution = new SignalBacktestExecutionService(prisma);
    const registry = SignalRegistry.getInstance();
    const blockRegistry = createDefaultBlockRegistry();

    const seeds = getTier1ComposedSignalSeeds();
    const baseSeed = seeds.find((s) => s.code === BASE_SIGNAL_CODE);
    if (!baseSeed) {
        throw new Error(`Base signal code ${BASE_SIGNAL_CODE} not found in seeds`);
    }

    const total = BASELINES.length * FILTERS.length;
    let completed = 0;
    let failed = 0;

    console.log(`\n${'='.repeat(70)}`);
    console.log(`OPT-6: Regime Filter Matrix`);
    console.log(`Batch: ${BATCH_TAG}`);
    console.log(`Baselines: ${BASELINES.map((b) => b.id).join(', ')}`);
    console.log(`Filters: ${FILTERS.map((f) => f.id).join(', ')}`);
    console.log(`Total runs: ${total}`);
    console.log(`Period: ${FROM} -> ${TO}`);
    console.log(`Equity: $10,000 | Risk: ${RISK_PERCENT}% | Exit: ${EXIT_PROFILE}`);
    console.log(`${'='.repeat(70)}\n`);

    for (const baseline of BASELINES) {
        for (const filter of FILTERS) {
            const variantId = `OPT6_${baseline.id}_${filter.id}`;
            const tmpCode = `XAB_${variantId}`.toUpperCase().slice(0, 60);
            completed++;

            console.log(`\n[${completed}/${total}] Running: ${variantId}`);
            console.log(`  Baseline: ${baseline.id} | Filter: ${filter.label}`);

            // 1. Clone base definition
            const definition = jsonClone(baseSeed.composedBlocks) as ComposedSignalDefinition;

            // 2. Apply M5 base adjustments
            applyM5Base(definition);

            // 3. Apply baseline-specific mutations
            baseline.mutate(definition);

            // 4. Apply regime filter
            filter.apply(definition);

            // 5. Set exit management
            definition.exitManagement = { profileCode: EXIT_PROFILE as any };

            // 6. Register temporary signal
            registry.register(
                new ComposedSignalPlugin(
                    definition,
                    blockRegistry,
                    tmpCode,
                    1,
                    `OPT-6 ${baseline.id} ${filter.id}`,
                ),
            );

            try {
                // 7. Create backtest run in DB
                const created = await backtests.createGeneratedBacktest({
                    signalCode: tmpCode,
                    signalVersion: 1,
                    symbol: SYMBOL,
                    timeframe: TIMEFRAME,
                    dateRange: { from: FROM, to: TO },
                    parameters: {
                        ...baseline.params,
                        regimeFilter: filter.id,
                    },
                    executionConfig: {
                        ...DEFAULT_EXECUTION_CONFIG,
                        eventSchema: { profileCode: EXIT_PROFILE },
                    } as any,
                    initialEquity: 10000,
                    riskPercent: RISK_PERCENT,
                    notes: `[${BATCH_TAG}] OPT-6 variant: ${variantId} (Base: ${BASE_SIGNAL_CODE}, Filter: ${filter.id})`,
                });

                // 8. Execute
                const result = await execution.executeRun(created.backtestRunId);
                console.log(
                    `  => DONE: runId=${created.backtestRunId}, status=${result.status}, trades=${result.counts.persistedResults}`,
                );
            } catch (error: any) {
                failed++;
                console.error(`  => FAILED: ${variantId} | ${error.message}`);
            } finally {
                registry.unregister(tmpCode, 1);
            }
        }
    }

    await prisma.$disconnect();

    console.log(`\n${'='.repeat(70)}`);
    console.log(`OPT-6 Matrix complete. ${completed - failed}/${total} succeeded, ${failed} failed.`);
    console.log(`${'='.repeat(70)}\n`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
