import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { SignalBacktestExecutionService } from '../services/signals/SignalBacktestExecutionService';
import { SignalBacktestRunService } from '../services/signals/SignalBacktestRunService';
import { ExecutionConfigInput, TradeGuardConfigInput } from '../services/signals/types';
import { SignalRegistry } from '../services/signals/SignalRegistry';
import { ComposedSignalDefinition, ComposedSignalPlugin } from '../services/signals/ComposedSignalPlugin';
import { createDefaultBlockRegistry } from '../services/signals/blocks/createDefaultBlockRegistry';
import { getTier1ComposedSignalSeeds } from '../services/signals/tier1ComposedSignals';
import {
    applyM5Base,
    setTakeProfitMultiple,
    setStopLookback,
} from './xauAbcOptimizationShared';

dotenv.config();

/**
 * OPT-8: New Trade Guards Matrix
 *
 * Tests 3 new trade guards (equityCurveFilter, maxDrawdownHalt, minTradeSpacing)
 * on Champion B (B4_TP25 + Moderate Guards + Trend Filter B + HARD_SIGNAL_TP)
 * to reduce max consecutive losses from 74 to under 15 while preserving Net R.
 *
 * Champion B baseline: Net R ~1,144, PF 2.21, WR 50.76%, Max Consecutive Losses 74
 *
 * Test Matrix (12 runs):
 *   Group 1 — Equity Curve Filter alone (4 runs)
 *   Group 2 — Max Drawdown Halt alone (3 runs)
 *   Group 3 — Min Trade Spacing alone (2 runs)
 *   Group 4 — Combined (3 runs)
 */

const BATCH_TAG = 'opt8-new-guards-matrix-2026-03-19';
const BASE_SIGNAL_CODE = 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG';
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

// ─── OPT-2 Winner: Moderate Trade Guards (existing baseline) ────────────────

const MODERATE_GUARDS: TradeGuardConfigInput = {
    sessionLossCap: { maxLosses: 3, maxNetR: 3.0 },
    dayLossCap: { maxLosses: 4, maxNetR: 4.0 },
    lossStreakCooldown: { afterLosses: 5, cooldownMinutes: 720 },
    lossStreakThrottle: {
        steps: [
            { afterLosses: 3, riskPercent: 1.5 },
            { afterLosses: 5, riskPercent: 1.0 },
        ],
    },
};

// ─── OPT-6 Winner: Filter B (Trend Confirmation) ───────────────────────────

function addTrendFilterB(definition: ComposedSignalDefinition): void {
    definition.blocks.push({
        id: 'opt7_confirmation_uptrend',
        indicatorId: 'CONFIRMATION_TREND',
        conditionId: 'confirmation_uptrend',
        indicatorParams: { fastPeriod: 50, slowPeriod: 200, adxPeriod: 14 },
        conditionParams: { adxThreshold: 20 },
    });
}

// ─── Guard Variant Definitions ──────────────────────────────────────────────

interface GuardVariant {
    id: string;
    label: string;
    group: string;
    /** New guards to ADD on top of MODERATE_GUARDS */
    newGuards: Partial<TradeGuardConfigInput>;
}

const GUARD_VARIANTS: GuardVariant[] = [
    // ─── Group 1: Equity Curve Filter alone ─────────────────────────────────
    {
        id: 'OPT8_ECF_BLOCK_10',
        label: 'Equity Curve Filter: EMA(10) BLOCK',
        group: 'ECF_ALONE',
        newGuards: {
            equityCurveFilter: { emaTrades: 10, action: 'BLOCK' },
        },
    },
    {
        id: 'OPT8_ECF_BLOCK_20',
        label: 'Equity Curve Filter: EMA(20) BLOCK',
        group: 'ECF_ALONE',
        newGuards: {
            equityCurveFilter: { emaTrades: 20, action: 'BLOCK' },
        },
    },
    {
        id: 'OPT8_ECF_HALF_10',
        label: 'Equity Curve Filter: EMA(10) HALF_RISK',
        group: 'ECF_ALONE',
        newGuards: {
            equityCurveFilter: { emaTrades: 10, action: 'HALF_RISK' },
        },
    },
    {
        id: 'OPT8_ECF_HALF_20',
        label: 'Equity Curve Filter: EMA(20) HALF_RISK',
        group: 'ECF_ALONE',
        newGuards: {
            equityCurveFilter: { emaTrades: 20, action: 'HALF_RISK' },
        },
    },

    // ─── Group 2: Max Drawdown Halt alone ───────────────────────────────────
    {
        id: 'OPT8_DD_HALT_5',
        label: 'Max Drawdown Halt: 5%',
        group: 'DD_HALT_ALONE',
        newGuards: {
            maxDrawdownHalt: { maxDrawdownPct: 5 },
        },
    },
    {
        id: 'OPT8_DD_HALT_10',
        label: 'Max Drawdown Halt: 10%',
        group: 'DD_HALT_ALONE',
        newGuards: {
            maxDrawdownHalt: { maxDrawdownPct: 10 },
        },
    },
    {
        id: 'OPT8_DD_HALT_15',
        label: 'Max Drawdown Halt: 15%',
        group: 'DD_HALT_ALONE',
        newGuards: {
            maxDrawdownHalt: { maxDrawdownPct: 15 },
        },
    },

    // ─── Group 3: Min Trade Spacing alone ───────────────────────────────────
    {
        id: 'OPT8_SPACING_30',
        label: 'Min Trade Spacing: 30 min',
        group: 'SPACING_ALONE',
        newGuards: {
            minTradeSpacing: { minSpacingMinutes: 30 },
        },
    },
    {
        id: 'OPT8_SPACING_60',
        label: 'Min Trade Spacing: 60 min',
        group: 'SPACING_ALONE',
        newGuards: {
            minTradeSpacing: { minSpacingMinutes: 60 },
        },
    },

    // ─── Group 4: Combined ──────────────────────────────────────────────────
    {
        id: 'OPT8_COMBO_CONSERVATIVE',
        label: 'Combined Conservative: ECF BLOCK(10) + DD Halt 10% + Spacing 30min',
        group: 'COMBINED',
        newGuards: {
            equityCurveFilter: { emaTrades: 10, action: 'BLOCK' },
            maxDrawdownHalt: { maxDrawdownPct: 10 },
            minTradeSpacing: { minSpacingMinutes: 30 },
        },
    },
    {
        id: 'OPT8_COMBO_MODERATE',
        label: 'Combined Moderate: ECF BLOCK(20) + DD Halt 15% + Spacing 15min',
        group: 'COMBINED',
        newGuards: {
            equityCurveFilter: { emaTrades: 20, action: 'BLOCK' },
            maxDrawdownHalt: { maxDrawdownPct: 15 },
            minTradeSpacing: { minSpacingMinutes: 15 },
        },
    },
    {
        id: 'OPT8_COMBO_AGGRESSIVE',
        label: 'Combined Aggressive: ECF HALF_RISK(10) + DD Halt 10% + Spacing 60min',
        group: 'COMBINED',
        newGuards: {
            equityCurveFilter: { emaTrades: 10, action: 'HALF_RISK' },
            maxDrawdownHalt: { maxDrawdownPct: 10 },
            minTradeSpacing: { minSpacingMinutes: 60 },
        },
    },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

const jsonClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function buildGuards(variant: GuardVariant): TradeGuardConfigInput {
    return {
        ...MODERATE_GUARDS,
        ...variant.newGuards,
    };
}

// ─── Main ───────────────────────────────────────────────────────────────────

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

    console.log(`\n${'='.repeat(70)}`);
    console.log(`OPT-8: New Trade Guards Matrix`);
    console.log(`Batch: ${BATCH_TAG}`);
    console.log(`Base: Champion B (B4_TP25 + Moderate Guards + Trend Filter B + HARD_SIGNAL_TP)`);
    console.log(`Variants: ${GUARD_VARIANTS.length}`);
    console.log(`Period: ${FROM} -> ${TO}`);
    console.log(`Equity: $${INITIAL_EQUITY.toLocaleString()} | Risk: ${RISK_PERCENT}%`);
    console.log(`Goal: Reduce max consecutive losses from 74 to <15 while preserving Net R`);
    console.log(`${'='.repeat(70)}\n`);

    const results: Array<{ id: string; group: string; status: string; runId?: string }> = [];

    for (let i = 0; i < GUARD_VARIANTS.length; i++) {
        const variant = GUARD_VARIANTS[i];
        console.log(`\n[${i + 1}/${GUARD_VARIANTS.length}] Running: ${variant.id}`);
        console.log(`  ${variant.label}`);
        console.log(`  Group: ${variant.group}`);
        console.log(`  New guards: ${JSON.stringify(variant.newGuards)}`);

        // 1. Clone base definition
        const definition = jsonClone(baseSeed.composedBlocks) as ComposedSignalDefinition;

        // 2. Apply M5 base adjustments
        applyM5Base(definition);

        // 3. Apply Champion B mutations: B4_TP25 = TP multiple 2.5 + stop lookback 72
        setTakeProfitMultiple(definition, 2.5);
        setStopLookback(definition, 72);

        // 4. Add Trend Filter B
        addTrendFilterB(definition);

        // 5. Set exit profile: HARD_SIGNAL_TP
        definition.exitManagement = { profileCode: 'HARD_SIGNAL_TP' as any };

        // 6. Register temporary signal
        const tmpCode = `XAB_${variant.id}`.toUpperCase().slice(0, 60);
        registry.register(
            new ComposedSignalPlugin(
                definition,
                blockRegistry,
                tmpCode,
                1,
                `OPT-8 Guard Variant: ${variant.id}`,
            ),
        );

        try {
            // 7. Build execution config with Moderate guards + new guards
            const guards = buildGuards(variant);
            const executionConfig: ExecutionConfigInput = {
                ...BASE_EXECUTION_CONFIG,
                tradeGuards: guards,
                eventSchema: { profileCode: 'HARD_SIGNAL_TP' },
            } as any;

            // 8. Create run in DB
            const created = await backtests.createGeneratedBacktest({
                signalCode: tmpCode,
                signalVersion: 1,
                symbol: SYMBOL,
                timeframe: TIMEFRAME,
                dateRange: { from: FROM, to: TO },
                parameters: {
                    tpMultiple: 2.5,
                    stopLookback: 72,
                    regimeFilter: 'FILTER_B_TREND',
                    guardProfile: 'MODERATE',
                    newGuards: variant.newGuards,
                    guardGroup: variant.group,
                },
                executionConfig,
                initialEquity: INITIAL_EQUITY,
                riskPercent: RISK_PERCENT,
                notes: `[${BATCH_TAG}] OPT-8 Guard Variant: ${variant.id} | ${variant.label}`,
            });

            // 9. Execute
            const result = await execution.executeRun(created.backtestRunId);
            console.log(
                `  => DONE: runId=${created.backtestRunId}, status=${result.status}, trades=${result.counts.persistedResults}`,
            );
            results.push({ id: variant.id, group: variant.group, status: 'DONE', runId: created.backtestRunId });
        } catch (error: any) {
            console.error(`  => FAILED: ${variant.id} | ${error.message}`);
            results.push({ id: variant.id, group: variant.group, status: `FAILED: ${error.message}` });
        } finally {
            registry.unregister(tmpCode, 1);
        }
    }

    await prisma.$disconnect();

    console.log(`\n${'='.repeat(70)}`);
    console.log(`OPT-8 New Guards Matrix Complete`);
    console.table(results);
    console.log(`${'='.repeat(70)}\n`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
