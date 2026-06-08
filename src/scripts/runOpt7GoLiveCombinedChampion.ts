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
    setAtrMultiplier,
    setStopLookback,
    setTakeProfitMultiple,
} from './xauAbcOptimizationShared';

dotenv.config();

/**
 * OPT-7: Go-Live Combined Champion Backtests
 *
 * Combines the winners from OPT-1 through OPT-6:
 *   - OPT-1: London filter KEPT (intrinsic to strategy)
 *   - OPT-2: Moderate trade guard profile
 *   - OPT-3: Exit profile (HARD_SIGNAL_TP for max profit, PARTIAL_1R_BE_R3 for balanced WR)
 *   - OPT-5: SHORT side REJECTED
 *   - OPT-6: Filter B (Trend Confirmation) applied
 *
 * Champions:
 *   A: B1_ATR135 + Moderate Guards + Trend Filter B + HARD_SIGNAL_TP (Max Profit)
 *   B: B4_TP25   + Moderate Guards + Trend Filter B + HARD_SIGNAL_TP (Max Profit)
 *   C: B1_ATR135 + Moderate Guards + Trend Filter B + PARTIAL_1R_BE_R3 (Balanced WR)
 *   D: B4_TP25   + Moderate Guards + Trend Filter B + PARTIAL_1R_BE_R3 (Balanced WR)
 *
 * Period: 2019-01-01 -> 2026-03-14, equity $10K, risk 2%
 */

const BATCH_TAG = 'opt7-go-live-champion-2026-03-19';
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

// ─── OPT-2 Winner: Moderate Trade Guards ──────────────────────────────────────

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

// ─── OPT-6 Winner: Filter B (Trend Confirmation) ─────────────────────────────

function addTrendFilterB(definition: ComposedSignalDefinition): void {
    definition.blocks.push({
        id: 'opt7_confirmation_uptrend',
        indicatorId: 'CONFIRMATION_TREND',
        conditionId: 'confirmation_uptrend',
        indicatorParams: { fastPeriod: 50, slowPeriod: 200, adxPeriod: 14 },
        conditionParams: { adxThreshold: 20 },
    });
}

// ─── Champion Definitions ─────────────────────────────────────────────────────

interface ChampionSpec {
    id: string;
    label: string;
    exitProfile: string;
    mutate: (def: ComposedSignalDefinition) => void;
    params: Record<string, any>;
}

const CHAMPIONS: ChampionSpec[] = [
    {
        id: 'OPT7_CHAMPION_A',
        label: 'B1_ATR135 + Moderate Guards + Trend Filter B + HARD_SIGNAL_TP (Max Profit)',
        exitProfile: 'HARD_SIGNAL_TP',
        params: { atrMultiplier: 1.35, regimeFilter: 'FILTER_B_TREND', guardProfile: 'MODERATE' },
        mutate: (def) => {
            setAtrMultiplier(def, 1.35);
            addTrendFilterB(def);
        },
    },
    {
        id: 'OPT7_CHAMPION_B',
        label: 'B4_TP25 + Moderate Guards + Trend Filter B + HARD_SIGNAL_TP (Max Profit)',
        exitProfile: 'HARD_SIGNAL_TP',
        params: { tpMultiple: 2.5, stopLookback: 72, regimeFilter: 'FILTER_B_TREND', guardProfile: 'MODERATE' },
        mutate: (def) => {
            setTakeProfitMultiple(def, 2.5);
            setStopLookback(def, 72);
            addTrendFilterB(def);
        },
    },
    {
        id: 'OPT7_CHAMPION_C',
        label: 'B1_ATR135 + Moderate Guards + Trend Filter B + PARTIAL_1R_BE_R3 (Balanced WR)',
        exitProfile: 'PARTIAL_1R_BE_R3',
        params: { atrMultiplier: 1.35, regimeFilter: 'FILTER_B_TREND', guardProfile: 'MODERATE' },
        mutate: (def) => {
            setAtrMultiplier(def, 1.35);
            addTrendFilterB(def);
        },
    },
    {
        id: 'OPT7_CHAMPION_D',
        label: 'B4_TP25 + Moderate Guards + Trend Filter B + PARTIAL_1R_BE_R3 (Balanced WR)',
        exitProfile: 'PARTIAL_1R_BE_R3',
        params: { tpMultiple: 2.5, stopLookback: 72, regimeFilter: 'FILTER_B_TREND', guardProfile: 'MODERATE' },
        mutate: (def) => {
            setTakeProfitMultiple(def, 2.5);
            setStopLookback(def, 72);
            addTrendFilterB(def);
        },
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
    console.log(`OPT-7: Go-Live Combined Champion Backtests`);
    console.log(`Batch: ${BATCH_TAG}`);
    console.log(`Champions: ${CHAMPIONS.map((c) => c.id).join(', ')}`);
    console.log(`Period: ${FROM} -> ${TO}`);
    console.log(`Equity: $${INITIAL_EQUITY.toLocaleString()} | Risk: ${RISK_PERCENT}%`);
    console.log(`Guards: Moderate (session 3/day 4/cooldown 5@720min/throttle 3@1.5%+5@1.0%)`);
    console.log(`Filter: B (Trend Confirmation: EMA50>EMA200 + price>EMA200 + ADX>=20)`);
    console.log(`${'='.repeat(70)}\n`);

    const results: Array<{ id: string; status: string; runId?: string }> = [];

    for (let i = 0; i < CHAMPIONS.length; i++) {
        const champion = CHAMPIONS[i];
        console.log(`\n[${i + 1}/${CHAMPIONS.length}] Running: ${champion.id}`);
        console.log(`  ${champion.label}`);

        // 1. Clone base definition
        const definition = jsonClone(baseSeed.composedBlocks) as ComposedSignalDefinition;

        // 2. Apply M5 base adjustments
        applyM5Base(definition);

        // 3. Apply champion-specific mutations (ATR/TP + Trend Filter)
        champion.mutate(definition);

        // 4. Set exit management profile
        definition.exitManagement = { profileCode: champion.exitProfile as any };

        // 5. Register temporary signal
        const tmpCode = `XAB_${champion.id}`.toUpperCase().slice(0, 60);
        registry.register(
            new ComposedSignalPlugin(
                definition,
                blockRegistry,
                tmpCode,
                1,
                `OPT-7 Champion: ${champion.id}`,
            ),
        );

        try {
            // 6. Build execution config with Moderate trade guards
            const executionConfig: ExecutionConfigInput = {
                ...BASE_EXECUTION_CONFIG,
                tradeGuards: MODERATE_GUARDS,
                eventSchema: { profileCode: champion.exitProfile },
            } as any;

            // 7. Create run in DB
            const created = await backtests.createGeneratedBacktest({
                signalCode: tmpCode,
                signalVersion: 1,
                symbol: SYMBOL,
                timeframe: TIMEFRAME,
                dateRange: { from: FROM, to: TO },
                parameters: champion.params,
                executionConfig,
                initialEquity: INITIAL_EQUITY,
                riskPercent: RISK_PERCENT,
                notes: `[${BATCH_TAG}] OPT-7 Champion: ${champion.id} | ${champion.label}`,
            });

            // 8. Execute
            const result = await execution.executeRun(created.backtestRunId);
            console.log(
                `  => DONE: runId=${created.backtestRunId}, status=${result.status}, trades=${result.counts.persistedResults}`,
            );
            results.push({ id: champion.id, status: 'DONE', runId: created.backtestRunId });
        } catch (error: any) {
            console.error(`  => FAILED: ${champion.id} | ${error.message}`);
            results.push({ id: champion.id, status: `FAILED: ${error.message}` });
        } finally {
            registry.unregister(tmpCode, 1);
        }
    }

    await prisma.$disconnect();

    console.log(`\n${'='.repeat(70)}`);
    console.log(`OPT-7 Champions Complete`);
    console.table(results);
    console.log(`${'='.repeat(70)}\n`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
