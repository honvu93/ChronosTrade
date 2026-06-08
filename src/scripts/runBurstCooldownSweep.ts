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
 * Burst Cooldown Sweep — Test 3 burst cooldown levels × 4 strategies = 12 runs
 *
 * The strict entryBurstCooldown (max=3/60min) blocks 68-82% of trades on M5.
 * This sweep tests relaxed levels to find the sweet spot.
 *
 * Level A (Moderate): maxEntriesInWindow=5, windowMinutes=120, cooldownMinutes=720
 * Level B (Light):    maxEntriesInWindow=8, windowMinutes=180, cooldownMinutes=480
 * Level C (Disabled): entryBurstCooldown=null (baseline comparison)
 *
 * ALL 12 runs execute CONCURRENTLY via Promise.all.
 */

const BATCH_TAG = 'burst-cooldown-sweep-2026-03-20';
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

// ─── Shared Base Guards (same for all 3 levels) ──────────────────────────────

const BASE_GUARDS: Omit<TradeGuardConfigInput, 'entryBurstCooldown'> = {
    lossStreakCooldown: { afterLosses: 3, cooldownMinutes: 720 },
    dayLossCap: { maxLosses: 3, maxNetR: 5 },
    sessionLossCap: { maxLosses: 3, maxNetR: 3 },
    lossStreakThrottle: {
        steps: [
            { afterLosses: 2, riskPercent: 1.5 },
            { afterLosses: 3, riskPercent: 1.0 },
            { afterLosses: 5, riskPercent: 0.5 },
        ],
    },
    equityCurveFilter: { emaTrades: 20, action: 'HALF_RISK' },
    minTradeSpacing: { minSpacingMinutes: 30 },
    maxDrawdownHalt: { maxDrawdownPct: null as any },
};

// ─── Burst Cooldown Levels ───────────────────────────────────────────────────

interface BurstLevel {
    code: 'A' | 'B' | 'C';
    label: string;
    burstConfig: TradeGuardConfigInput['entryBurstCooldown'] | null;
}

const BURST_LEVELS: BurstLevel[] = [
    {
        code: 'A',
        label: 'Moderate (5/120min, cd=720)',
        burstConfig: { maxEntriesInWindow: 5, windowMinutes: 120, cooldownMinutes: 720 },
    },
    {
        code: 'B',
        label: 'Light (8/180min, cd=480)',
        burstConfig: { maxEntriesInWindow: 8, windowMinutes: 180, cooldownMinutes: 480 },
    },
    {
        code: 'C',
        label: 'Disabled (no burst)',
        burstConfig: null,
    },
];

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

// ─── Run Single Combination ──────────────────────────────────────────────────

interface RunResult {
    name: string;
    strategy: string;
    burstLevel: string;
    status: string;
    runId?: string;
    trades?: number;
}

async function runSingleCombination(
    strategy: StrategyDef,
    burstLevel: BurstLevel,
    runIndex: number,
    totalRuns: number,
    prisma: PrismaClient,
    backtests: SignalBacktestRunService,
    execution: SignalBacktestExecutionService,
    blockRegistry: ReturnType<typeof createDefaultBlockRegistry>,
): Promise<RunResult> {
    const registry = SignalRegistry.getInstance();
    const runName = `BURST_${burstLevel.code}_${strategy.shortName}`;
    const tmpCode = `BURST_${burstLevel.code}_${strategy.shortName}`.toUpperCase().slice(0, 60);

    console.log(`\n[${runIndex + 1}/${totalRuns}] ${runName} — Starting...`);
    console.log(`  Strategy: ${strategy.shortName} | Burst: ${burstLevel.label}`);

    const definition = strategy.buildDefinition();

    registry.register(
        new ComposedSignalPlugin(
            definition,
            blockRegistry,
            tmpCode,
            1,
            `Burst Sweep ${burstLevel.code}: ${strategy.shortName}`,
        ),
    );

    try {
        // Build guards for this burst level
        const guards: TradeGuardConfigInput = {
            ...BASE_GUARDS,
        };
        if (burstLevel.burstConfig) {
            guards.entryBurstCooldown = burstLevel.burstConfig;
        }
        // For level C (null), simply omit entryBurstCooldown

        const executionConfig: ExecutionConfigInput = {
            ...BASE_EXECUTION_CONFIG,
            tradeGuards: guards,
            eventSchema: { profileCode: 'HARD_SIGNAL_TP' },
        } as any;

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
                burstLevelCode: burstLevel.code,
                burstLevelLabel: burstLevel.label,
                burstConfig: burstLevel.burstConfig,
                guards,
            },
            executionConfig,
            initialEquity: INITIAL_EQUITY,
            riskPercent: RISK_PERCENT,
            notes: `[${BATCH_TAG}] ${runName} | Burst: ${burstLevel.label} | Original: Net R ${strategy.originalNetR}, Max DD ${strategy.originalMaxDD}R`,
        });

        const result = await execution.executeRun(created.backtestRunId);
        console.log(`  => DONE [${runIndex + 1}/${totalRuns}] ${runName}: runId=${created.backtestRunId}, trades=${result.counts.persistedResults}`);

        return {
            name: runName,
            strategy: strategy.shortName,
            burstLevel: burstLevel.code,
            status: 'DONE',
            runId: created.backtestRunId,
            trades: result.counts.persistedResults,
        };
    } catch (error: any) {
        console.error(`  => FAILED [${runIndex + 1}/${totalRuns}] ${runName}: ${error.message}`);
        return {
            name: runName,
            strategy: strategy.shortName,
            burstLevel: burstLevel.code,
            status: `FAILED: ${error.message}`,
        };
    } finally {
        registry.unregister(tmpCode, 1);
    }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
    const prisma = new PrismaClient();
    const backtests = new SignalBacktestRunService(prisma);
    const execution = new SignalBacktestExecutionService(prisma);
    const blockRegistry = createDefaultBlockRegistry();

    const strategies = buildStrategies();

    // Build all 12 combinations: 3 burst levels × 4 strategies
    const allCombinations: { strategy: StrategyDef; burstLevel: BurstLevel }[] = [];
    for (const level of BURST_LEVELS) {
        for (const strategy of strategies) {
            allCombinations.push({ strategy, burstLevel: level });
        }
    }

    const totalRuns = allCombinations.length;

    console.log(`\n${'='.repeat(80)}`);
    console.log(`Burst Cooldown Sweep — ${totalRuns} Runs (ALL CONCURRENT via Promise.all)`);
    console.log(`Batch: ${BATCH_TAG}`);
    console.log(`Period: ${FROM} -> ${TO}`);
    console.log(`Symbol: ${SYMBOL} | Timeframe: ${TIMEFRAME}`);
    console.log(`Equity: $${INITIAL_EQUITY.toLocaleString()} | Risk: ${RISK_PERCENT}%`);
    console.log(`\nBurst Levels:`);
    for (const level of BURST_LEVELS) {
        console.log(`  ${level.code}: ${level.label}`);
    }
    console.log(`\nStrategies: ${strategies.map((s) => s.shortName).join(', ')}`);
    console.log(`\nBase Guards (shared across all levels):`);
    console.log(`  lossStreakCooldown: afterLosses=3, cooldownMinutes=720`);
    console.log(`  dayLossCap: maxLosses=3, maxNetR=5`);
    console.log(`  sessionLossCap: maxLosses=3, maxNetR=3`);
    console.log(`  lossStreakThrottle: [2->1.5%, 3->1.0%, 5->0.5%]`);
    console.log(`  equityCurveFilter: emaTrades=20, HALF_RISK`);
    console.log(`  minTradeSpacing: 30min`);
    console.log(`  maxDrawdownHalt: DISABLED`);
    console.log(`${'='.repeat(80)}\n`);

    // Run ALL 12 concurrently
    const results = await Promise.all(
        allCombinations.map((combo, idx) =>
            runSingleCombination(
                combo.strategy,
                combo.burstLevel,
                idx,
                totalRuns,
                prisma,
                backtests,
                execution,
                blockRegistry,
            ),
        ),
    );

    await prisma.$disconnect();

    const succeeded = results.filter((r) => r.status === 'DONE').length;
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Burst Cooldown Sweep Complete — ${succeeded}/${totalRuns} succeeded`);
    console.log(`${'='.repeat(80)}`);
    console.table(results);
    console.log(`\nBatch tag: ${BATCH_TAG}`);
    console.log(`Run IDs: ${results.filter((r) => r.runId).map((r) => `${r.name}=${r.runId}`).join(', ')}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
