import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { SignalBacktestExecutionService } from '../services/signals/SignalBacktestExecutionService';
import { SignalBacktestRunService } from '../services/signals/SignalBacktestRunService';
import { ExecutionConfigInput, TradeGuardConfigInput } from '../services/signals/types';
import { SignalRegistry } from '../services/signals/SignalRegistry';
import { ComposedSignalDefinition, ComposedSignalPlugin } from '../services/signals/ComposedSignalPlugin';
import { createDefaultBlockRegistry } from '../services/signals/blocks/createDefaultBlockRegistry';
import { getTier1ComposedSignalSeeds } from '../services/signals/tier1ComposedSignals';
import { applyM5Base, setTakeProfitMultiple, setStopLookback } from './xauAbcOptimizationShared';

dotenv.config();

const BATCH_TAG = 'opt9-burst-guard-2026-03-20';
const BASE_SIGNAL_CODE = 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG';
const SYMBOL = 'XAUUSD';
const TIMEFRAME = 'M5';
const FROM = '2019-01-01T00:00:00.000Z';
const TO = '2026-03-14T23:59:59.999Z';
const INITIAL_EQUITY = 10_000;
const RISK_PERCENT = 2;

const BASE_EXECUTION_CONFIG: ExecutionConfigInput = {
    entryFeeBps: 4, exitFeeBps: 4, entrySlippageBps: 2, exitSlippageBps: 2,
    orderTiming: 'NEXT_BAR_OPEN',
    stopLoss: { mode: 'SIGNAL_PRICE' },
    takeProfit: { mode: 'SIGNAL_PRICE' },
    positionSizing: { mode: 'RISK_BASED' },
};

// DayCap3 + Burst Guard: 3 entries in 60min → cooldown 12h or until 1 exits
const MODERATE_GUARDS_BURST: TradeGuardConfigInput = {
    sessionLossCap: { maxLosses: 3, maxNetR: 3.0 },
    dayLossCap: { maxLosses: 3, maxNetR: 4.0 },
    lossStreakCooldown: { afterLosses: 5, cooldownMinutes: 720 },
    lossStreakThrottle: {
        steps: [
            { afterLosses: 3, riskPercent: 1.5 },
            { afterLosses: 5, riskPercent: 1.0 },
        ],
    },
    entryBurstCooldown: { maxEntriesInWindow: 3, windowMinutes: 60, cooldownMinutes: 720 },
};

function addTrendFilterB(def: ComposedSignalDefinition): void {
    def.blocks.push({
        id: 'opt7_confirmation_uptrend',
        indicatorId: 'CONFIRMATION_TREND',
        conditionId: 'confirmation_uptrend',
        indicatorParams: { fastPeriod: 50, slowPeriod: 200, adxPeriod: 14 },
        conditionParams: { adxThreshold: 20 },
    });
}

interface Variant {
    id: string;
    label: string;
    guards: TradeGuardConfigInput;
    compoundEquity: boolean;
}

const VARIANTS: Variant[] = [
    {
        id: 'OPT9_BURST_SPACING_30_FIXED',
        label: 'Burst + DayCap3 + Spacing 30min (Fixed)',
        compoundEquity: false,
        guards: { ...MODERATE_GUARDS_BURST, minTradeSpacing: { minSpacingMinutes: 30 } },
    },
    {
        id: 'OPT9_BURST_COMPOUND_SPACING_30',
        label: 'Burst + DayCap3 + Compound + Spacing 30min',
        compoundEquity: true,
        guards: { ...MODERATE_GUARDS_BURST, minTradeSpacing: { minSpacingMinutes: 30 } },
    },
    {
        id: 'OPT9_BURST_COMPOUND_BALANCED',
        label: 'Burst + DayCap3 + Compound Balanced',
        compoundEquity: true,
        guards: {
            ...MODERATE_GUARDS_BURST,
            equityCurveFilter: { emaTrades: 15, action: 'HALF_RISK' },
            maxDrawdownHalt: { maxDrawdownPct: 15 },
            minTradeSpacing: { minSpacingMinutes: 15 },
        },
    },
];

const jsonClone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

async function main() {
    const prisma = new PrismaClient();
    const backtests = new SignalBacktestRunService(prisma);
    const execution = new SignalBacktestExecutionService(prisma);
    const registry = SignalRegistry.getInstance();
    const blockRegistry = createDefaultBlockRegistry();

    const baseSeed = getTier1ComposedSignalSeeds().find((s) => s.code === BASE_SIGNAL_CODE);
    if (!baseSeed) throw new Error(`Base signal ${BASE_SIGNAL_CODE} not found`);

    console.log(`\n${'='.repeat(70)}`);
    console.log(`OPT-9 Burst Guard: 3 entries in 60min → 12h cooldown or until 1 exits`);
    console.log(`Batch: ${BATCH_TAG}`);
    console.log(`${'='.repeat(70)}\n`);

    const results: Array<{ id: string; status: string; runId?: string; trades?: number }> = [];

    for (let i = 0; i < VARIANTS.length; i++) {
        const v = VARIANTS[i];
        console.log(`\n[${i + 1}/${VARIANTS.length}] ${v.id}`);
        console.log(`  ${v.label} | compound=${v.compoundEquity}`);

        const def = jsonClone(baseSeed.composedBlocks) as ComposedSignalDefinition;
        applyM5Base(def);
        setTakeProfitMultiple(def, 2.5);
        setStopLookback(def, 72);
        addTrendFilterB(def);
        def.exitManagement = { profileCode: 'HARD_SIGNAL_TP' as any };

        const tmpCode = `XAB_${v.id}`.toUpperCase().slice(0, 60);
        registry.register(new ComposedSignalPlugin(def, blockRegistry, tmpCode, 1, v.label));

        try {
            const execConfig: ExecutionConfigInput = {
                ...BASE_EXECUTION_CONFIG,
                tradeGuards: v.guards,
                compoundEquity: v.compoundEquity,
            };

            const created = await backtests.createGeneratedBacktest({
                signalCode: tmpCode,
                signalVersion: 1,
                symbol: SYMBOL,
                timeframe: TIMEFRAME,
                dateRange: { from: FROM, to: TO },
                parameters: {
                    tpMultiple: 2.5, stopLookback: 72, regimeFilter: 'FILTER_B_TREND',
                    guardProfile: 'MODERATE_DAYCAP3_BURST',
                    compoundEquity: v.compoundEquity,
                    entryBurstCooldown: { maxEntriesInWindow: 3, windowMinutes: 60, cooldownMinutes: 720 },
                },
                executionConfig: execConfig,
                initialEquity: INITIAL_EQUITY,
                riskPercent: RISK_PERCENT,
                notes: `[${BATCH_TAG}] ${v.label}`,
            });

            const result = await execution.executeRun(created.backtestRunId);
            console.log(`  => DONE: runId=${created.backtestRunId} | trades=${result.counts.persistedResults}`);
            results.push({ id: v.id, status: 'DONE', runId: created.backtestRunId, trades: result.counts.persistedResults });
        } catch (error: any) {
            console.error(`  => FAILED: ${error.message}`);
            results.push({ id: v.id, status: `FAILED: ${error.message}` });
        } finally {
            registry.unregister(tmpCode, 1);
        }
    }

    await prisma.$disconnect();

    console.log(`\n${'='.repeat(70)}`);
    console.log('OPT-9 Burst Guard Results');
    console.table(results);
    console.log(`${'='.repeat(70)}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
