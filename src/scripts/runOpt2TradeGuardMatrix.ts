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
 * OPT-2: Trade Guard Activation Matrix
 *
 * Tests 3 trade guard profiles (Conservative/Moderate/Aggressive)
 * against top-3 baseline variants to reduce max consecutive losses.
 *
 * Base variants:
 *   - B1_ATR135_HARD:     atrMultiplier=1.35
 *   - B4_TP25_HARD:       tpMultiple=2.5, stopLookback=72
 *   - B4_LOOKBACK96_HARD: tpMultiple=2.0, stopLookback=96
 *
 * Guard profiles:
 *   - Conservative: session 2/day 3/cooldown 4@1440min/throttle 2@1.5%+3@1.0%
 *   - Moderate:     session 3/day 4/cooldown 5@720min/throttle 3@1.5%+5@1.0%
 *   - Aggressive:   session 4/day 5/cooldown 6@480min/throttle 4@1.5%
 *
 * Total: 3 variants x 3 profiles = 9 runs
 * Period: 2019-01-01 -> 2026-03-14, equity $10K, risk 2%
 */

const BATCH_TAG = 'opt2-trade-guard-2026-03-19';

const FROM = '2019-01-01T00:00:00.000Z';
const TO = '2026-03-14T23:59:59.999Z';
const SYMBOL = 'XAUUSD';
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

const BASE_VARIANTS = [
    {
        name: 'B1_ATR135_HARD',
        params: { atrMultiplier: 1.35 },
        exitProfile: 'HARD_SIGNAL_TP',
    },
    {
        name: 'B4_TP25_HARD',
        params: { tpMultiple: 2.5, stopLookback: 72 },
        exitProfile: 'HARD_SIGNAL_TP',
    },
    {
        name: 'B4_LOOKBACK96_HARD',
        params: { tpMultiple: 2.0, stopLookback: 96 },
        exitProfile: 'HARD_SIGNAL_TP',
    },
];

const GUARD_PROFILES: Array<{ name: string; guards: TradeGuardConfigInput }> = [
    {
        name: 'CONSERVATIVE',
        guards: {
            sessionLossCap: { maxLosses: 2, maxNetR: 2.0 },
            dayLossCap: { maxLosses: 3, maxNetR: 3.0 },
            lossStreakCooldown: { afterLosses: 4, cooldownMinutes: 1440 },
            lossStreakThrottle: {
                steps: [
                    { afterLosses: 2, riskPercent: 1.5 },
                    { afterLosses: 3, riskPercent: 1.0 },
                ],
            },
        },
    },
    {
        name: 'MODERATE',
        guards: {
            sessionLossCap: { maxLosses: 3, maxNetR: 3.0 },
            dayLossCap: { maxLosses: 4, maxNetR: 4.0 },
            lossStreakCooldown: { afterLosses: 5, cooldownMinutes: 720 },
            lossStreakThrottle: {
                steps: [
                    { afterLosses: 3, riskPercent: 1.5 },
                    { afterLosses: 5, riskPercent: 1.0 },
                ],
            },
        },
    },
    {
        name: 'AGGRESSIVE',
        guards: {
            sessionLossCap: { maxLosses: 4, maxNetR: 4.0 },
            dayLossCap: { maxLosses: 5, maxNetR: 5.0 },
            lossStreakCooldown: { afterLosses: 6, cooldownMinutes: 480 },
            lossStreakThrottle: {
                steps: [
                    { afterLosses: 4, riskPercent: 1.5 },
                ],
            },
        },
    },
];

interface Opt2VariantConfig {
    id: string;
    signalCode: string;
    timeframe: string;
    riskPercent: number;
    exitProfile: string;
    params: Record<string, any>;
    tradeGuards: TradeGuardConfigInput;
}

const jsonClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

async function runOpt2Variant(variant: Opt2VariantConfig): Promise<string> {
    const prisma = new PrismaClient();
    const backtests = new SignalBacktestRunService(prisma);
    const execution = new SignalBacktestExecutionService(prisma);
    const registry = SignalRegistry.getInstance();
    const blockRegistry = createDefaultBlockRegistry();

    console.log(`  Starting backtest for: ${variant.id}`);

    // 1. Resolve base definition
    const seeds = getTier1ComposedSignalSeeds();
    const baseSeed = seeds.find(s => s.code === variant.signalCode);
    if (!baseSeed) {
        throw new Error(`Base signal code ${variant.signalCode} not found in seeds`);
    }

    // 2. Clone and mutate
    const definition = jsonClone(baseSeed.composedBlocks) as ComposedSignalDefinition;
    applyM5Base(definition);

    if (variant.params.atrMultiplier !== undefined) setAtrMultiplier(definition, variant.params.atrMultiplier);
    if (variant.params.stopLookback !== undefined) setStopLookback(definition, variant.params.stopLookback);
    if (variant.params.tpMultiple !== undefined) setTakeProfitMultiple(definition, variant.params.tpMultiple);

    definition.exitManagement = { profileCode: variant.exitProfile as any };

    // 3. Register temporary signal
    const tmpCode = `XAB_VAR_${variant.id}`.toUpperCase().slice(0, 60);
    registry.register(new ComposedSignalPlugin(
        definition,
        blockRegistry,
        tmpCode,
        1,
        `OPT2 Variant: ${variant.id}`,
    ));

    try {
        // 4. Build execution config with trade guards
        const executionConfig: ExecutionConfigInput = {
            ...BASE_EXECUTION_CONFIG,
            tradeGuards: variant.tradeGuards,
            eventSchema: { profileCode: variant.exitProfile },
        } as any;

        // 5. Create run in DB
        const created = await backtests.createGeneratedBacktest({
            signalCode: tmpCode,
            signalVersion: 1,
            symbol: SYMBOL,
            timeframe: variant.timeframe,
            dateRange: { from: FROM, to: TO },
            parameters: variant.params,
            executionConfig,
            initialEquity: INITIAL_EQUITY,
            riskPercent: RISK_PERCENT,
            notes: `[${BATCH_TAG}] OPT2: ${variant.id} (Base: ${variant.signalCode})`,
        });

        // 6. Execute
        const result = await execution.executeRun(created.backtestRunId);
        console.log(`  => DONE: runId=${created.backtestRunId}, status=${result.status}, results=${result.counts.persistedResults}`);
        return created.backtestRunId;
    } catch (error: any) {
        throw error;
    } finally {
        registry.unregister(tmpCode, 1);
        await prisma.$disconnect();
    }
}

function buildMatrix(): Opt2VariantConfig[] {
    const variants: Opt2VariantConfig[] = [];

    for (const base of BASE_VARIANTS) {
        for (const profile of GUARD_PROFILES) {
            const id = `OPT2_${base.name}_${profile.name}`;
            variants.push({
                id,
                signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG',
                timeframe: 'M5',
                riskPercent: RISK_PERCENT,
                exitProfile: base.exitProfile,
                params: { ...base.params },
                tradeGuards: profile.guards,
            });
        }
    }

    return variants;
}

async function main() {
    const variants = buildMatrix();

    console.log('=== OPT-2: Trade Guard Activation Matrix ===');
    console.log(`Total runs: ${variants.length}`);
    console.log(`Variants: ${BASE_VARIANTS.map(v => v.name).join(', ')}`);
    console.log(`Profiles: ${GUARD_PROFILES.map(p => p.name).join(', ')}`);
    console.log(`Period: ${FROM} -> ${TO}`);
    console.log(`Equity: $${INITIAL_EQUITY}, Risk: ${RISK_PERCENT}%`);
    console.log('');

    const results: Array<{ id: string; status: string; runId?: string }> = [];

    for (let i = 0; i < variants.length; i++) {
        const variant = variants[i];
        console.log(`\n[${i + 1}/${variants.length}] Running: ${variant.id}`);
        console.log(`  Base params: ${JSON.stringify(variant.params)}`);
        console.log(`  Guard profile: ${variant.id.split('_').pop()}`);

        try {
            const runId = await runOpt2Variant(variant);
            results.push({ id: variant.id, status: 'DONE', runId });
        } catch (error: any) {
            console.error(`  => FAILED: ${variant.id} | ${error.message}`);
            results.push({ id: variant.id, status: `FAILED: ${error.message}` });
        }
    }

    console.log('\n=== OPT-2 Matrix Complete ===');
    console.table(results);
}

main().catch(console.error);
