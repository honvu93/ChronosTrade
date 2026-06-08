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

const BATCH_TAG = 'opt9-multi-tf-2026-03-20';
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

// ─── Timeframe-specific params ──────────────────────────────────────────────
// windowBars ≈ 2-3h of signal matching window
// SL lookback ≈ 6-20h of structure (scales with TF)

interface TfConfig {
    tf: string;
    windowBars: number;
    slLookback: number;
    slBuffer: number;      // BELOW_STRUCTURE buffer
    atrBuffer: number;     // ATR buffer multiplier
    burstWindow: number;   // burst detection window (minutes)
    spacing: number;       // min spacing (minutes)
}

const TIMEFRAMES: TfConfig[] = [
    { tf: 'M15', windowBars: 8,  slLookback: 24, slBuffer: 0.0018, atrBuffer: 0.20, burstWindow: 120,  spacing: 60   },
    { tf: 'M30', windowBars: 4,  slLookback: 18, slBuffer: 0.0020, atrBuffer: 0.25, burstWindow: 180,  spacing: 90   },
    { tf: 'H1',  windowBars: 3,  slLookback: 20, slBuffer: 0.0025, atrBuffer: 0.30, burstWindow: 360,  spacing: 180  },
    { tf: 'H4',  windowBars: 2,  slLookback: 12, slBuffer: 0.0030, atrBuffer: 0.40, burstWindow: 960,  spacing: 480  },
    { tf: 'D1',  windowBars: 2,  slLookback: 10, slBuffer: 0.0035, atrBuffer: 0.50, burstWindow: 4320, spacing: 1440 },
];

// ─── 3 TP/SL variants ──────────────────────────────────────────────────────

interface TpSlVariant {
    id: string;
    label: string;
    tpMultiple: number;
    slLookbackScale: number;  // multiplier on base lookback
}

const TP_SL_VARIANTS: TpSlVariant[] = [
    {
        id: 'TIGHT',
        label: 'Tight TP 1.5R / Wide SL (1.3x lookback)',
        tpMultiple: 1.5,
        slLookbackScale: 1.3,  // wider SL → fewer stop-outs, lower reward
    },
    {
        id: 'BALANCED',
        label: 'Balanced TP 2.5R / Standard SL (1.0x)',
        tpMultiple: 2.5,
        slLookbackScale: 1.0,
    },
    {
        id: 'WIDE',
        label: 'Wide TP 3.5R / Tight SL (0.7x lookback)',
        tpMultiple: 3.5,
        slLookbackScale: 0.7,  // tighter SL → more stop-outs, higher reward when hit
    },
];

// ─── 3 guard profiles (from burst winners) ──────────────────────────────────

interface GuardProfile {
    id: string;
    label: string;
    compoundEquity: boolean;
    buildGuards(tf: TfConfig): TradeGuardConfigInput;
}

const MODERATE_BASE: TradeGuardConfigInput = {
    sessionLossCap: { maxLosses: 3, maxNetR: 3.0 },
    dayLossCap: { maxLosses: 3, maxNetR: 4.0 },
    lossStreakCooldown: { afterLosses: 5, cooldownMinutes: 720 },
    lossStreakThrottle: {
        steps: [
            { afterLosses: 3, riskPercent: 1.5 },
            { afterLosses: 5, riskPercent: 1.0 },
        ],
    },
};

const GUARD_PROFILES: GuardProfile[] = [
    {
        id: 'BURST_FIXED',
        label: 'Burst + Fixed Equity',
        compoundEquity: false,
        buildGuards: (tf) => ({
            ...MODERATE_BASE,
            minTradeSpacing: { minSpacingMinutes: tf.spacing },
            entryBurstCooldown: { maxEntriesInWindow: 3, windowMinutes: tf.burstWindow, cooldownMinutes: 720 },
        }),
    },
    {
        id: 'BURST_COMPOUND',
        label: 'Burst + Compound Equity',
        compoundEquity: true,
        buildGuards: (tf) => ({
            ...MODERATE_BASE,
            minTradeSpacing: { minSpacingMinutes: tf.spacing },
            entryBurstCooldown: { maxEntriesInWindow: 3, windowMinutes: tf.burstWindow, cooldownMinutes: 720 },
        }),
    },
    {
        id: 'BURST_BALANCED',
        label: 'Burst + Compound Balanced',
        compoundEquity: true,
        buildGuards: (tf) => ({
            ...MODERATE_BASE,
            equityCurveFilter: { emaTrades: 15, action: 'HALF_RISK' as const },
            maxDrawdownHalt: { maxDrawdownPct: 15 },
            minTradeSpacing: { minSpacingMinutes: Math.max(tf.spacing / 2, 15) },
            entryBurstCooldown: { maxEntriesInWindow: 3, windowMinutes: tf.burstWindow, cooldownMinutes: 720 },
        }),
    },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

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

type StopLossObj = { type: string; value: number; lookback: number; atrBufferMultiplier: number; atrPeriod: number };

function buildDefinition(
    baseDef: ComposedSignalDefinition,
    tf: TfConfig,
    tpSl: TpSlVariant,
): ComposedSignalDefinition {
    const def = jsonClone(baseDef);
    // Timeframe params
    (def as any).timeframe = tf.tf;
    def.windowBars = tf.windowBars;
    // SL
    const sl = def.stopLoss as StopLossObj;
    sl.lookback = Math.round(tf.slLookback * tpSl.slLookbackScale);
    sl.value = tf.slBuffer;
    sl.atrBufferMultiplier = tf.atrBuffer;
    sl.atrPeriod = 14;
    // TP
    def.takeProfit = { type: 'R_MULTIPLE', value: tpSl.tpMultiple };
    // Exit + Trend
    def.exitManagement = { profileCode: 'HARD_SIGNAL_TP' as any };
    addTrendFilterB(def);
    return def;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
    const prisma = new PrismaClient();
    const backtests = new SignalBacktestRunService(prisma);
    const execution = new SignalBacktestExecutionService(prisma);
    const registry = SignalRegistry.getInstance();
    const blockRegistry = createDefaultBlockRegistry();

    const baseSeed = getTier1ComposedSignalSeeds().find((s) => s.code === BASE_SIGNAL_CODE);
    if (!baseSeed) throw new Error(`Base signal ${BASE_SIGNAL_CODE} not found`);

    // Filter by --tf argument if provided (for parallel execution)
    const tfArg = process.argv.find((a) => a.startsWith('--tf='))?.split('=')[1];
    const selectedTfs = tfArg
        ? TIMEFRAMES.filter((t) => t.tf === tfArg)
        : TIMEFRAMES;
    if (tfArg && selectedTfs.length === 0) {
        throw new Error(`Unknown timeframe: ${tfArg}. Available: ${TIMEFRAMES.map((t) => t.tf).join(', ')}`);
    }

    type RunSpec = { tf: TfConfig; tpSl: TpSlVariant; guard: GuardProfile };
    const runs: RunSpec[] = [];
    for (const tf of selectedTfs) {
        for (const tpSl of TP_SL_VARIANTS) {
            for (const guard of GUARD_PROFILES) {
                runs.push({ tf, tpSl, guard });
            }
        }
    }

    console.log(`\n${'='.repeat(70)}`);
    console.log(`OPT-9 Multi-Timeframe Expansion`);
    console.log(`${TIMEFRAMES.length} TFs × ${TP_SL_VARIANTS.length} TP/SL × ${GUARD_PROFILES.length} Guards = ${runs.length} runs`);
    console.log(`Batch: ${BATCH_TAG}`);
    console.log(`${'='.repeat(70)}\n`);

    console.log('TP/SL Variants:');
    for (const v of TP_SL_VARIANTS) {
        console.log(`  ${v.id}: ${v.label}`);
    }
    console.log();

    const results: Array<{ tf: string; tpSl: string; guard: string; status: string; runId?: string; trades?: number }> = [];

    for (let i = 0; i < runs.length; i++) {
        const { tf, tpSl, guard } = runs[i];
        const label = `${tf.tf}_${tpSl.id}_${guard.id}`;
        console.log(`[${i + 1}/${runs.length}] ${label}`);

        const def = buildDefinition(baseSeed.composedBlocks as ComposedSignalDefinition, tf, tpSl);
        const tmpCode = `XAB_MTF_${label}`.toUpperCase().slice(0, 60);
        registry.register(new ComposedSignalPlugin(def, blockRegistry, tmpCode, 1, label));

        try {
            const execConfig: ExecutionConfigInput = {
                ...BASE_EXEC,
                tradeGuards: guard.buildGuards(tf),
                compoundEquity: guard.compoundEquity,
            };

            const created = await backtests.createGeneratedBacktest({
                signalCode: tmpCode,
                signalVersion: 1,
                symbol: SYMBOL,
                timeframe: tf.tf,
                dateRange: { from: FROM, to: TO },
                parameters: {
                    tpMultiple: tpSl.tpMultiple,
                    slLookback: Math.round(tf.slLookback * tpSl.slLookbackScale),
                    slBuffer: tf.slBuffer,
                    atrBuffer: tf.atrBuffer,
                    windowBars: tf.windowBars,
                    regimeFilter: 'FILTER_B_TREND',
                    guardProfile: guard.id,
                    compoundEquity: guard.compoundEquity,
                    tpSlVariant: tpSl.id,
                    burstWindow: tf.burstWindow,
                    spacing: tf.spacing,
                },
                executionConfig: execConfig,
                initialEquity: INITIAL_EQUITY,
                riskPercent: RISK_PERCENT,
                notes: `[${BATCH_TAG}] ${tf.tf} | TP=${tpSl.tpMultiple}R SL×${tpSl.slLookbackScale} | ${guard.label}`,
            });

            const result = await execution.executeRun(created.backtestRunId);
            console.log(`  => trades=${result.counts.persistedResults} | runId=${created.backtestRunId}`);
            results.push({ tf: tf.tf, tpSl: tpSl.id, guard: guard.id, status: 'OK', runId: created.backtestRunId, trades: result.counts.persistedResults });
        } catch (error: any) {
            console.error(`  => FAILED: ${error.message}`);
            results.push({ tf: tf.tf, tpSl: tpSl.id, guard: guard.id, status: `FAIL: ${error.message.slice(0, 60)}` });
        } finally {
            registry.unregister(tmpCode, 1);
        }
    }

    await prisma.$disconnect();

    console.log(`\n${'='.repeat(70)}`);
    console.log('OPT-9 Multi-Timeframe Results');
    console.log(`${'='.repeat(70)}\n`);

    // Summary table grouped by timeframe
    for (const tf of TIMEFRAMES) {
        console.log(`\n─── ${tf.tf} ───`);
        const tfRows = results.filter((r) => r.tf === tf.tf);
        console.table(tfRows.map((r) => ({
            TP_SL: r.tpSl,
            Guard: r.guard,
            Trades: r.trades ?? '-',
            Status: r.status,
            RunID: r.runId?.slice(0, 20) ?? '-',
        })));
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
