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

const BATCH_TAG = 'opt9-daycap3-2026-03-20';
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

// dayLossCap: maxLosses: 3 (was 4) — stop trading after 3 losses in a day
const MODERATE_GUARDS_DAYCAP3: TradeGuardConfigInput = {
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

function addTrendFilterB(definition: ComposedSignalDefinition): void {
    definition.blocks.push({
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
    description: string;
}

const VARIANTS: Variant[] = [
    {
        id: 'OPT9_DC3_SPACING_30_FIXED',
        label: 'DayCap3 + Spacing 30min (Fixed Equity)',
        description: 'OPT-9 Winner #1 with dayLossCap reduced from 4 to 3',
        compoundEquity: false,
        guards: {
            ...MODERATE_GUARDS_DAYCAP3,
            minTradeSpacing: { minSpacingMinutes: 30 },
        },
    },
    {
        id: 'OPT9_DC3_COMPOUND_SPACING_30',
        label: 'DayCap3 + Compound + Spacing 30min',
        description: 'OPT-9 Winner #2 with dayLossCap reduced from 4 to 3',
        compoundEquity: true,
        guards: {
            ...MODERATE_GUARDS_DAYCAP3,
            minTradeSpacing: { minSpacingMinutes: 30 },
        },
    },
    {
        id: 'OPT9_DC3_COMPOUND_BALANCED',
        label: 'DayCap3 + Compound Balanced (Conservative)',
        description: 'OPT-9 Winner #3 with dayLossCap reduced from 4 to 3',
        compoundEquity: true,
        guards: {
            ...MODERATE_GUARDS_DAYCAP3,
            equityCurveFilter: { emaTrades: 15, action: 'HALF_RISK' },
            maxDrawdownHalt: { maxDrawdownPct: 15 },
            minTradeSpacing: { minSpacingMinutes: 15 },
        },
    },
];

const jsonClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

async function main() {
    const prisma = new PrismaClient();
    const backtests = new SignalBacktestRunService(prisma);
    const execution = new SignalBacktestExecutionService(prisma);
    const registry = SignalRegistry.getInstance();
    const blockRegistry = createDefaultBlockRegistry();

    const seeds = getTier1ComposedSignalSeeds();
    const baseSeed = seeds.find((s) => s.code === BASE_SIGNAL_CODE);
    if (!baseSeed) {
        throw new Error(`Base signal code ${BASE_SIGNAL_CODE} not found`);
    }

    console.log(`\n${'='.repeat(70)}`);
    console.log(`OPT-9 DayCap3: Re-test 3 winners with dayLossCap.maxLosses = 3`);
    console.log(`Batch: ${BATCH_TAG}`);
    console.log(`${'='.repeat(70)}\n`);

    const results: Array<{ id: string; status: string; runId?: string; trades?: number }> = [];

    for (let i = 0; i < VARIANTS.length; i++) {
        const variant = VARIANTS[i];
        console.log(`\n[${i + 1}/${VARIANTS.length}] ${variant.id}`);
        console.log(`  ${variant.label}`);
        console.log(`  Compound: ${variant.compoundEquity}`);

        const definition = jsonClone(baseSeed.composedBlocks) as ComposedSignalDefinition;
        applyM5Base(definition);
        setTakeProfitMultiple(definition, 2.5);
        setStopLookback(definition, 72);
        addTrendFilterB(definition);
        definition.exitManagement = { profileCode: 'HARD_SIGNAL_TP' as any };

        const tmpCode = `XAB_${variant.id}`.toUpperCase().slice(0, 60);
        registry.register(
            new ComposedSignalPlugin(definition, blockRegistry, tmpCode, 1, variant.label),
        );

        try {
            const executionConfig: ExecutionConfigInput = {
                ...BASE_EXECUTION_CONFIG,
                tradeGuards: variant.guards,
                compoundEquity: variant.compoundEquity,
            };

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
                    guardProfile: 'MODERATE_DAYCAP3',
                    compoundEquity: variant.compoundEquity,
                    dayLossCapMaxLosses: 3,
                    newGuards: variant.guards,
                },
                executionConfig,
                initialEquity: INITIAL_EQUITY,
                riskPercent: RISK_PERCENT,
                notes: `[${BATCH_TAG}] ${variant.label} | ${variant.description}`,
            });

            const result = await execution.executeRun(created.backtestRunId);
            console.log(
                `  => DONE: runId=${created.backtestRunId} | status=${result.status} | trades=${result.counts.persistedResults}`,
            );
            results.push({ id: variant.id, status: 'DONE', runId: created.backtestRunId, trades: result.counts.persistedResults });
        } catch (error: any) {
            console.error(`  => FAILED: ${error.message}`);
            results.push({ id: variant.id, status: `FAILED: ${error.message}` });
        } finally {
            registry.unregister(tmpCode, 1);
        }
    }

    await prisma.$disconnect();

    console.log(`\n${'='.repeat(70)}`);
    console.log('OPT-9 DayCap3 Results');
    console.table(results);
    console.log(`${'='.repeat(70)}\n`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
