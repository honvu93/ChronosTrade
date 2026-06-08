import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { SignalBacktestExecutionService } from '../services/signals/SignalBacktestExecutionService';
import { SignalBacktestRunService } from '../services/signals/SignalBacktestRunService';
import { ExecutionConfigInput, TradeGuardConfigInput } from '../services/signals/types';
import { SignalRegistry } from '../services/signals/SignalRegistry';
import { ComposedSignalDefinition, ComposedSignalPlugin } from '../services/signals/ComposedSignalPlugin';
import { createDefaultBlockRegistry } from '../services/signals/blocks/createDefaultBlockRegistry';
import { getTier1ComposedSignalSeeds } from '../services/signals/tier1ComposedSignals';

dotenv.config();

const BATCH_TAG = 'opt9-tp-sweep-2026-03-20';
const BASE_SIGNAL_CODE = 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG';
const SYMBOL = 'XAUUSD';
const FROM = '2019-01-01T00:00:00.000Z';
const TO = '2026-03-14T23:59:59.999Z';
const INITIAL_EQUITY = 10_000;
const RISK_PERCENT = 2;

const BASE_EXEC: ExecutionConfigInput = {
    entryFeeBps: 4, exitFeeBps: 4, entrySlippageBps: 2, exitSlippageBps: 2,
    orderTiming: 'NEXT_BAR_OPEN',
    stopLoss: { mode: 'SIGNAL_PRICE' },
    takeProfit: { mode: 'SIGNAL_PRICE' },
    positionSizing: { mode: 'RISK_BASED' },
};

const BURST_GUARDS_M15: TradeGuardConfigInput = {
    sessionLossCap: { maxLosses: 3, maxNetR: 3.0 },
    dayLossCap: { maxLosses: 3, maxNetR: 4.0 },
    lossStreakCooldown: { afterLosses: 5, cooldownMinutes: 720 },
    lossStreakThrottle: { steps: [{ afterLosses: 3, riskPercent: 1.5 }, { afterLosses: 5, riskPercent: 1.0 }] },
    minTradeSpacing: { minSpacingMinutes: 60 },
    entryBurstCooldown: { maxEntriesInWindow: 3, windowMinutes: 120, cooldownMinutes: 720 },
};

const BURST_GUARDS_M30: TradeGuardConfigInput = {
    sessionLossCap: { maxLosses: 3, maxNetR: 3.0 },
    dayLossCap: { maxLosses: 3, maxNetR: 4.0 },
    lossStreakCooldown: { afterLosses: 5, cooldownMinutes: 720 },
    lossStreakThrottle: { steps: [{ afterLosses: 3, riskPercent: 1.5 }, { afterLosses: 5, riskPercent: 1.0 }] },
    minTradeSpacing: { minSpacingMinutes: 90 },
    entryBurstCooldown: { maxEntriesInWindow: 3, windowMinutes: 180, cooldownMinutes: 720 },
};

interface TfSpec {
    tf: string;
    windowBars: number;
    slLookback: number;
    slBuffer: number;
    atrBuffer: number;
    guards: TradeGuardConfigInput;
}

const TF_SPECS: Record<string, TfSpec> = {
    M15: { tf: 'M15', windowBars: 8, slLookback: 24, slBuffer: 0.0018, atrBuffer: 0.20, guards: BURST_GUARDS_M15 },
    M30: { tf: 'M30', windowBars: 4, slLookback: 18, slBuffer: 0.0020, atrBuffer: 0.25, guards: BURST_GUARDS_M30 },
};

// ─── Sweep variants ─────────────────────────────────────────────────────────
// Group A: TP R-multiple sweep with HARD_SIGNAL_TP
// Group B: Exit profile comparison (built-in TP management)

interface Variant {
    id: string;
    label: string;
    tpMultiple: number;
    exitProfile: string;
}

const VARIANTS: Variant[] = [
    // Group A: Fine-grained TP sweep
    { id: 'TP_1R0', label: 'TP 1.0R Hard', tpMultiple: 1.0, exitProfile: 'HARD_SIGNAL_TP' },
    { id: 'TP_1R2', label: 'TP 1.2R Hard', tpMultiple: 1.2, exitProfile: 'HARD_SIGNAL_TP' },
    { id: 'TP_1R5', label: 'TP 1.5R Hard', tpMultiple: 1.5, exitProfile: 'HARD_SIGNAL_TP' },
    { id: 'TP_1R8', label: 'TP 1.8R Hard', tpMultiple: 1.8, exitProfile: 'HARD_SIGNAL_TP' },
    { id: 'TP_2R0', label: 'TP 2.0R Hard', tpMultiple: 2.0, exitProfile: 'HARD_SIGNAL_TP' },

    // Group B: Smart exit profiles (TP defined by exit profile, signal TP as fallback)
    { id: 'BE1R_TP2R', label: 'BE @1R → TP 2R', tpMultiple: 2.0, exitProfile: 'BE_1R_TP_2R' },
    { id: 'PARTIAL_TRAIL', label: '50% @1R → BE → Swing Trail', tpMultiple: 3.0, exitProfile: 'PARTIAL_1R_BE_SWING_TRAIL' },
    { id: 'FIXED_2R', label: 'Fixed 2R (no BE)', tpMultiple: 2.0, exitProfile: 'FIXED_2R' },
    { id: 'TIME_24', label: 'Time Stop 24 bars + TP 1.5R', tpMultiple: 1.5, exitProfile: 'TIME_24' },
];

const jsonClone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function addTrendFilterB(def: ComposedSignalDefinition): void {
    def.blocks.push({
        id: 'opt7_confirmation_uptrend',
        indicatorId: 'CONFIRMATION_TREND',
        conditionId: 'confirmation_uptrend',
        indicatorParams: { fastPeriod: 50, slowPeriod: 200, adxPeriod: 14 },
        conditionParams: { adxThreshold: 20 },
    });
}

type SLObj = { type: string; value: number; lookback: number; atrBufferMultiplier: number; atrPeriod: number };

async function main() {
    const tfArg = process.argv.find((a) => a.startsWith('--tf='))?.split('=')[1];
    if (!tfArg || !TF_SPECS[tfArg]) {
        throw new Error(`Usage: --tf=M15 or --tf=M30`);
    }
    const spec = TF_SPECS[tfArg];

    const prisma = new PrismaClient();
    const backtests = new SignalBacktestRunService(prisma);
    const execution = new SignalBacktestExecutionService(prisma);
    const registry = SignalRegistry.getInstance();
    const blockRegistry = createDefaultBlockRegistry();

    const baseSeed = getTier1ComposedSignalSeeds().find((s) => s.code === BASE_SIGNAL_CODE);
    if (!baseSeed) throw new Error(`Base signal ${BASE_SIGNAL_CODE} not found`);

    console.log(`\n${'='.repeat(60)}`);
    console.log(`TP Sweep: ${spec.tf} | ${VARIANTS.length} variants`);
    console.log(`${'='.repeat(60)}\n`);

    for (let i = 0; i < VARIANTS.length; i++) {
        const v = VARIANTS[i];
        console.log(`[${i + 1}/${VARIANTS.length}] ${spec.tf}_${v.id}: ${v.label}`);

        const def = jsonClone(baseSeed.composedBlocks) as ComposedSignalDefinition;
        (def as any).timeframe = spec.tf;
        def.windowBars = spec.windowBars;
        const sl = def.stopLoss as SLObj;
        sl.lookback = spec.slLookback;
        sl.value = spec.slBuffer;
        sl.atrBufferMultiplier = spec.atrBuffer;
        sl.atrPeriod = 14;
        def.takeProfit = { type: 'R_MULTIPLE', value: v.tpMultiple };
        def.exitManagement = { profileCode: v.exitProfile as any };
        addTrendFilterB(def);

        const tmpCode = `XAB_TPS_${spec.tf}_${v.id}`.toUpperCase().slice(0, 60);
        registry.register(new ComposedSignalPlugin(def, blockRegistry, tmpCode, 1, v.label));

        try {
            const created = await backtests.createGeneratedBacktest({
                signalCode: tmpCode,
                signalVersion: 1,
                symbol: SYMBOL,
                timeframe: spec.tf,
                dateRange: { from: FROM, to: TO },
                parameters: {
                    tpMultiple: v.tpMultiple,
                    exitProfile: v.exitProfile,
                    slLookback: spec.slLookback,
                    regimeFilter: 'FILTER_B_TREND',
                    guardProfile: 'BURST_FIXED',
                    tpSweepVariant: v.id,
                },
                executionConfig: { ...BASE_EXEC, tradeGuards: spec.guards },
                initialEquity: INITIAL_EQUITY,
                riskPercent: RISK_PERCENT,
                notes: `[${BATCH_TAG}] ${spec.tf} | ${v.label}`,
            });

            const result = await execution.executeRun(created.backtestRunId);
            console.log(`  => trades=${result.counts.persistedResults} | runId=${created.backtestRunId}`);
        } catch (error: any) {
            console.error(`  => FAILED: ${error.message.slice(0, 80)}`);
        } finally {
            registry.unregister(tmpCode, 1);
        }
    }

    await prisma.$disconnect();
    console.log(`\n${spec.tf} TP Sweep Complete.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
