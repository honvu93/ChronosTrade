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
    setStopLookback,
    setTakeProfitMultiple,
} from './xauAbcOptimizationShared';

dotenv.config();

/**
 * Champion D — Break-Even Variant Sweep
 *
 * Base: OPT7_CHAMPION_D (B4_TP25 + Moderate Guards + Trend Filter B)
 * Goal: Compare 3 different BE-based exit profiles to find the best
 *       balance of win rate, capital preservation, and captured R.
 *
 * Current Champion D exit: PARTIAL_1R_BE_R3
 *   → 50% closed at +1R, SL moves to BE, remaining targets 3R
 *
 * Variants:
 *   V1 — BE_1R_TP_2R          : Full position, BE at 1R, hard close at 2R
 *   V2 — BE_1R_TRAIL_2R_3R    : Full position, BE at 1R, ratchet trail at 2R & 3R
 *   V3 — PARTIAL_1R_BE_SWING_TRAIL : 50% at 1R, BE, swing-structure trail on rest
 *
 * Period: 2019-01-01 → 2026-03-14, equity $10K, risk 2%
 */

const BATCH_TAG = 'champion-d-be-variants-2026-03-21';
const BASE_SIGNAL_CODE = 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG';
const SYMBOL = 'XAUUSD';
const TIMEFRAME = 'M5';
const FROM = '2019-01-01T00:00:00.000Z';
const TO = '2026-03-14T23:59:59.999Z';
const INITIAL_EQUITY = 10_000;
const RISK_PERCENT = 2;

// ─── Inherited from OPT7_CHAMPION_D ──────────────────────────────────────────

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

// ─── Champion D base mutations (B4_TP25 + Trend Filter B) ────────────────────

function applyChampionDBase(definition: ComposedSignalDefinition): void {
    setTakeProfitMultiple(definition, 2.5);
    setStopLookback(definition, 72);
    // Trend Filter B: EMA50 > EMA200 + price > EMA200 + ADX >= 20
    definition.blocks.push({
        id: 'champion_d_confirmation_uptrend',
        indicatorId: 'CONFIRMATION_TREND',
        conditionId: 'confirmation_uptrend',
        indicatorParams: { fastPeriod: 50, slowPeriod: 200, adxPeriod: 14 },
        conditionParams: { adxThreshold: 20 },
    });
}

// ─── Variant Definitions ──────────────────────────────────────────────────────

interface VariantSpec {
    id: string;
    label: string;
    exitProfile: string;
    description: string;
}

const VARIANTS: VariantSpec[] = [
    {
        id: 'CHAMPION_D_BE1R_TP2R',
        label: 'Champion D + BE_1R_TP_2R (conservative: full BE at 1R, close at 2R)',
        exitProfile: 'BE_1R_TP_2R',
        description: 'Full position stays open. At +1R: SL moves to BE. Hard target: 2R. ' +
            'Highest capital protection, sacrifices extended runners vs PARTIAL_1R_BE_R3.',
    },
    {
        id: 'CHAMPION_D_BE1R_TRAIL',
        label: 'Champion D + BE_1R_TRAIL_2R_3R (balanced: full BE at 1R, ratchet trail)',
        exitProfile: 'BE_1R_TRAIL_2R_3R',
        description: 'Full position stays open. At +1R: SL moves to BE. ' +
            'Trail ratchets: at 2R lock 1R, at 3R lock 2R. Captures trend moves without early partial exit.',
    },
    {
        id: 'CHAMPION_D_PARTIAL1R_SWING',
        label: 'Champion D + PARTIAL_1R_BE_SWING_TRAIL (aggressive: 50% at 1R, swing trail rest)',
        exitProfile: 'PARTIAL_1R_BE_SWING_TRAIL',
        description: '50% closed at +1R. SL moves to BE. Remaining 50% trails using swing structure. ' +
            'Best for capturing extended XAU trend moves, highest potential avg R on runners.',
    },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const jsonClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// ─── Main ─────────────────────────────────────────────────────────────────────

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
    console.log(`Champion D — Break-Even Variant Sweep`);
    console.log(`Batch: ${BATCH_TAG}`);
    console.log(`Variants: ${VARIANTS.map((v) => v.id).join(', ')}`);
    console.log(`Period: ${FROM} -> ${TO}`);
    console.log(`Equity: $${INITIAL_EQUITY.toLocaleString()} | Risk: ${RISK_PERCENT}%`);
    console.log(`Base: B4_TP25 (TP=2.5R, SL lookback=72) + Trend Filter B + Moderate Guards`);
    console.log(`Reference: OPT7_CHAMPION_D (PARTIAL_1R_BE_R3) — PF 1.83, WR 64.55%, Net R 580.92`);
    console.log(`${'='.repeat(70)}\n`);
    console.log(`Exit profiles compared:`);
    for (const v of VARIANTS) {
        console.log(`  [${v.id}] ${v.exitProfile}`);
        console.log(`    ${v.description}`);
    }
    console.log('');

    const results: Array<{ id: string; exitProfile: string; status: string; runId?: string }> = [];

    for (let i = 0; i < VARIANTS.length; i++) {
        const variant = VARIANTS[i];
        console.log(`\n[${i + 1}/${VARIANTS.length}] Running: ${variant.id}`);
        console.log(`  Exit: ${variant.exitProfile}`);

        const definition = jsonClone(baseSeed.composedBlocks) as ComposedSignalDefinition;
        applyM5Base(definition);
        applyChampionDBase(definition);
        definition.exitManagement = { profileCode: variant.exitProfile as any };

        const tmpCode = `XAB_${variant.id}`.toUpperCase().slice(0, 60);
        registry.register(
            new ComposedSignalPlugin(
                definition,
                blockRegistry,
                tmpCode,
                1,
                `Champion D BE Variant: ${variant.id}`,
            ),
        );

        try {
            const executionConfig: ExecutionConfigInput = {
                ...BASE_EXECUTION_CONFIG,
                tradeGuards: MODERATE_GUARDS,
                eventSchema: { profileCode: variant.exitProfile },
            } as any;

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
                    exitProfile: variant.exitProfile,
                },
                executionConfig,
                initialEquity: INITIAL_EQUITY,
                riskPercent: RISK_PERCENT,
                notes: `[${BATCH_TAG}] ${variant.label}`,
            });

            const result = await execution.executeRun(created.backtestRunId);
            console.log(
                `  => DONE: runId=${created.backtestRunId}, status=${result.status}, trades=${result.counts.persistedResults}`,
            );
            results.push({ id: variant.id, exitProfile: variant.exitProfile, status: 'DONE', runId: created.backtestRunId });
        } catch (error: any) {
            console.error(`  => FAILED: ${variant.id} | ${error.message}`);
            results.push({ id: variant.id, exitProfile: variant.exitProfile, status: `FAILED: ${error.message}` });
        } finally {
            registry.unregister(tmpCode, 1);
        }
    }

    await prisma.$disconnect();

    console.log(`\n${'='.repeat(70)}`);
    console.log(`Champion D BE Variants Complete`);
    console.table(results);
    console.log(`\nReference (Champion D original):`);
    console.log(`  Exit: PARTIAL_1R_BE_R3 | PF: 1.83 | WR: 64.55% | Net R: 580.92 | Max Consec Loss: 41`);
    console.log(`${'='.repeat(70)}\n`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
