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
 * Correct Rules Matrix — Re-run top 4 strategies with the CORRECT guard config
 *
 * Previous L1 runs had WRONG lossStreakCooldown: {afterLosses: 4, cooldownMinutes: 1440}
 * Correct rule: "3 lenh thua lien tiep trong ngay -> dung 12h"
 *   => lossStreakCooldown: { afterLosses: 3, cooldownMinutes: 720 }
 *
 * Also activates entryBurstCooldown (never tested before).
 *
 * Runs ALL 4 strategies CONCURRENTLY via Promise.all.
 */

const BATCH_TAG = 'correct-rules-matrix-2026-03-20';
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

// ─── CORRECT Guard Config ────────────────────────────────────────────────────

const CORRECT_GUARDS: TradeGuardConfigInput = {
    // Rule: 3 thua lien tiep -> dung 12h
    lossStreakCooldown: { afterLosses: 3, cooldownMinutes: 720 },
    // Day cap: max 3 losses per day
    dayLossCap: { maxLosses: 3, maxNetR: 5 },
    // Session cap
    sessionLossCap: { maxLosses: 3, maxNetR: 3 },
    // Risk throttle after losses
    lossStreakThrottle: {
        steps: [
            { afterLosses: 2, riskPercent: 1.5 },
            { afterLosses: 3, riskPercent: 1.0 },
            { afterLosses: 5, riskPercent: 0.5 },
        ],
    },
    // Equity curve filter
    equityCurveFilter: { emaTrades: 20, action: 'HALF_RISK' },
    // Min spacing
    minTradeSpacing: { minSpacingMinutes: 30 },
    // Entry burst cooldown (NEW - never tested before)
    entryBurstCooldown: { maxEntriesInWindow: 3, windowMinutes: 60, cooldownMinutes: 720 },
    // No DD halt (proven to cause death spiral) — pass null via cast to disable
    maxDrawdownHalt: { maxDrawdownPct: null as any },
};

// ─── Shared SL / TP / Exit for S3 and S5 strategies ──────────────────────────

const S3_S5_STOP_LOSS = {
    type: 'BELOW_STRUCTURE' as const,
    value: 0.0018,
    lookback: 72,
    atrBufferMultiplier: 0.2,
    atrPeriod: 14,
};

const S3_S5_TAKE_PROFIT = { type: 'R_MULTIPLE' as const, value: 2.5 };
const S3_S5_EXIT_MANAGEMENT = { profileCode: 'HARD_SIGNAL_TP' as any };

// ─── S3 Base Blocks ─────────────────────────────────────────────────────────

const S3_BASE_BLOCKS: any[] = [
    {
        id: 'pwh_breakout',
        indicatorId: 'PD_LEVELS',
        conditionId: 'closes_above_previous_week_high',
        indicatorParams: {},
        conditionParams: {},
    },
    {
        id: 'asian_high_breakout',
        indicatorId: 'SESSION_RANGE_STRUCTURE',
        conditionId: 'closes_above_asian_high',
        indicatorParams: { asianStartHour: 0, asianEndHour: 7 },
        conditionParams: {},
    },
    {
        id: 'regime_bullish',
        indicatorId: 'MARKET_REGIME',
        conditionId: 'regime_trending_bullish',
        indicatorParams: { adxPeriod: 14, atrPeriod: 14, emaFilterPeriod: 200 },
        conditionParams: { adxThreshold: 22 },
    },
    {
        id: 'trend_catcher_bull',
        indicatorId: 'TREND_CATCHER',
        conditionId: 'trend_catcher_bullish',
        indicatorParams: { fastPeriod: 10, slowPeriod: 20, rsiPeriod: 14 },
        conditionParams: { rsiThreshold: 50 },
    },
];

// ─── Strategy Definitions ───────────────────────────────────────────────────

interface StrategyDef {
    shortName: string;
    originalRunId: string;
    originalNetR: number;
    originalMaxDD: number;
    buildDefinition: () => ComposedSignalDefinition;
}

const jsonClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function buildStrategies(): StrategyDef[] {
    // ── Strategy 1: S3_MODERATE_GUARDS ──────────────────────────────────────
    const s3ModerateGuards: StrategyDef = {
        shortName: 'S3_MOD',
        originalRunId: 'cmmygse000000tkjotg25enkn',
        originalNetR: 1486,
        originalMaxDD: -332,
        buildDefinition: () => ({
            matchMode: 'ALL',
            windowBars: 12,
            side: 'LONG',
            blocks: [...S3_BASE_BLOCKS],
            stopLoss: S3_S5_STOP_LOSS,
            takeProfit: S3_S5_TAKE_PROFIT,
            exitManagement: S3_S5_EXIT_MANAGEMENT,
        }),
    };

    // ── Strategy 2: S3_NY_ASIAN_ONLY ────────────────────────────────────────
    const s3NyAsian: StrategyDef = {
        shortName: 'S3_NYASN',
        originalRunId: 'cmmygv2qa0wj1tkjord59dnfg',
        originalNetR: 1232,
        originalMaxDD: -191,
        buildDefinition: () => ({
            matchMode: 'ALL',
            windowBars: 12,
            side: 'LONG',
            blocks: [
                ...S3_BASE_BLOCKS,
                {
                    id: 'session_ny_asian',
                    indicatorId: 'SESSION_FILTER',
                    conditionId: 'in_session',
                    indicatorParams: { startHour: 13, endHour: 7 },
                    conditionParams: {},
                },
            ],
            stopLoss: S3_S5_STOP_LOSS,
            takeProfit: S3_S5_TAKE_PROFIT,
            exitManagement: S3_S5_EXIT_MANAGEMENT,
        }),
    };

    // ── Strategy 3: Champion_B ──────────────────────────────────────────────
    const championB: StrategyDef = {
        shortName: 'CHAMP_B',
        originalRunId: 'cmmxcnw4m09wvtklwtladtv1d',
        originalNetR: 1144,
        originalMaxDD: -189,
        buildDefinition: () => {
            const seeds = getTier1ComposedSignalSeeds();
            const baseSeed = seeds.find((s) => s.code === 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG');
            if (!baseSeed) throw new Error('Base seed SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG not found');
            const definition = jsonClone(baseSeed.composedBlocks) as ComposedSignalDefinition;
            applyM5Base(definition);
            setTakeProfitMultiple(definition, 2.5);
            setStopLookback(definition, 72);
            // Add Trend Filter B
            definition.blocks.push({
                id: 'opt7_confirmation_uptrend',
                indicatorId: 'CONFIRMATION_TREND',
                conditionId: 'confirmation_uptrend',
                indicatorParams: { fastPeriod: 50, slowPeriod: 200, adxPeriod: 14 },
                conditionParams: { adxThreshold: 20 },
            });
            definition.exitManagement = { profileCode: 'HARD_SIGNAL_TP' as any };
            return definition;
        },
    };

    // ── Strategy 4: S5_STATE ────────────────────────────────────────────────
    const s5State: StrategyDef = {
        shortName: 'S5_ST',
        originalRunId: 'cmmygwjx407ultkwpdhncxymv',
        originalNetR: 911,
        originalMaxDD: -272,
        buildDefinition: () => ({
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
            stopLoss: S3_S5_STOP_LOSS,
            takeProfit: S3_S5_TAKE_PROFIT,
            exitManagement: S3_S5_EXIT_MANAGEMENT,
        }),
    };

    return [s3ModerateGuards, s3NyAsian, championB, s5State];
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function runSingleStrategy(
    strategy: StrategyDef,
    idx: number,
    prisma: PrismaClient,
    backtests: SignalBacktestRunService,
    execution: SignalBacktestExecutionService,
    blockRegistry: ReturnType<typeof createDefaultBlockRegistry>,
): Promise<{
    name: string;
    strategy: string;
    status: string;
    runId?: string;
    trades?: number;
}> {
    const registry = SignalRegistry.getInstance();
    const runName = `RULES_FIXED_${strategy.shortName}`;
    const tmpCode = runName.toUpperCase().slice(0, 60);

    console.log(`\n[${idx + 1}/4] ${runName} — Starting...`);
    console.log(`  Strategy: ${strategy.shortName} (original: Net R ${strategy.originalNetR}, Max DD ${strategy.originalMaxDD}R)`);
    console.log(`  Guards: lossStreakCooldown afterLosses=3 cooldown=720min, entryBurstCooldown max=3/60min cooldown=720min`);

    // 1. Build the signal definition
    const definition = strategy.buildDefinition();

    // 2. Register temporary signal
    registry.register(
        new ComposedSignalPlugin(
            definition,
            blockRegistry,
            tmpCode,
            1,
            `Correct Rules: ${strategy.shortName}`,
        ),
    );

    try {
        // 3. Build execution config with CORRECT guards
        const executionConfig: ExecutionConfigInput = {
            ...BASE_EXECUTION_CONFIG,
            tradeGuards: CORRECT_GUARDS,
            eventSchema: { profileCode: 'HARD_SIGNAL_TP' },
        } as any;

        // 4. Create run in DB
        const created = await backtests.createGeneratedBacktest({
            signalCode: tmpCode,
            signalVersion: 1,
            symbol: SYMBOL,
            timeframe: TIMEFRAME,
            dateRange: { from: FROM, to: TO },
            parameters: {
                batchTag: BATCH_TAG,
                originalRunId: strategy.originalRunId,
                originalNetR: strategy.originalNetR,
                originalMaxDD: strategy.originalMaxDD,
                strategyShortName: strategy.shortName,
                correctGuards: CORRECT_GUARDS,
            },
            executionConfig,
            initialEquity: INITIAL_EQUITY,
            riskPercent: RISK_PERCENT,
            notes: `[${BATCH_TAG}] Correct rules for ${strategy.shortName} | lossStreakCooldown afterLosses=3 cooldown=720min + entryBurstCooldown | Original: Net R ${strategy.originalNetR}, Max DD ${strategy.originalMaxDD}R`,
        });

        // 5. Execute
        const result = await execution.executeRun(created.backtestRunId);
        console.log(`  => DONE [${idx + 1}/4] ${runName}: runId=${created.backtestRunId}, trades=${result.counts.persistedResults}`);

        return {
            name: runName,
            strategy: strategy.shortName,
            status: 'DONE',
            runId: created.backtestRunId,
            trades: result.counts.persistedResults,
        };
    } catch (error: any) {
        console.error(`  => FAILED [${idx + 1}/4] ${runName}: ${error.message}`);
        return {
            name: runName,
            strategy: strategy.shortName,
            status: `FAILED: ${error.message}`,
        };
    } finally {
        registry.unregister(tmpCode, 1);
    }
}

async function main() {
    const prisma = new PrismaClient();
    const backtests = new SignalBacktestRunService(prisma);
    const execution = new SignalBacktestExecutionService(prisma);
    const blockRegistry = createDefaultBlockRegistry();

    const strategies = buildStrategies();

    console.log(`\n${'='.repeat(80)}`);
    console.log(`Correct Rules Matrix — 4 Strategies (CONCURRENT via Promise.all)`);
    console.log(`Batch: ${BATCH_TAG}`);
    console.log(`Period: ${FROM} -> ${TO}`);
    console.log(`Symbol: ${SYMBOL} | Timeframe: ${TIMEFRAME}`);
    console.log(`Equity: $${INITIAL_EQUITY.toLocaleString()} | Risk: ${RISK_PERCENT}%`);
    console.log(`\nCORRECT Guards:`);
    console.log(`  lossStreakCooldown: afterLosses=3, cooldownMinutes=720 (12h)`);
    console.log(`  dayLossCap: maxLosses=3, maxNetR=5`);
    console.log(`  sessionLossCap: maxLosses=3, maxNetR=3`);
    console.log(`  lossStreakThrottle: [2->1.5%, 3->1.0%, 5->0.5%]`);
    console.log(`  equityCurveFilter: emaTrades=20, HALF_RISK`);
    console.log(`  minTradeSpacing: 30min`);
    console.log(`  entryBurstCooldown: max=3 in 60min -> 720min cooldown (NEW!)`);
    console.log(`  maxDrawdownHalt: DISABLED (null)`);
    console.log(`${'='.repeat(80)}\n`);

    // Run ALL 4 strategies CONCURRENTLY
    const results = await Promise.all(
        strategies.map((strategy, idx) =>
            runSingleStrategy(strategy, idx, prisma, backtests, execution, blockRegistry),
        ),
    );

    await prisma.$disconnect();

    const succeeded = results.filter((r) => r.status === 'DONE').length;
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Correct Rules Matrix Complete — ${succeeded}/4 succeeded`);
    console.log(`${'='.repeat(80)}`);
    console.table(results);
    console.log(`\nBatch tag: ${BATCH_TAG}`);
    console.log(`Run IDs: ${results.filter((r) => r.runId).map((r) => r.runId).join(', ')}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
