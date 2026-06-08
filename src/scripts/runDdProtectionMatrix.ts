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
 * DD Protection Matrix — 6 strategies × 3 protection levels = 18 runs
 *
 * Goal: Find the best drawdown protection overlay for each top strategy
 * to address "nếu bắt đầu bot trading mà vào ngay chuỗi thua thì sẽ rất tệ"
 *
 * Strategies:
 *   1. S3_MODERATE_GUARDS  (Net R 1,486, Max DD -332R)
 *   2. S3_NY_ASIAN_ONLY    (Net R 1,232, Max DD -191R)
 *   3. Champion_B          (Net R 1,144, Max DD -189R)
 *   4. SPACING_30          (Net R 1,032, Max DD -161R)
 *   5. S5_STATE            (Net R 911,   Max DD -272R)
 *   6. B1_ATR135           (Net R 623,   Max DD -154R)
 *
 * Protection Levels:
 *   L1 — Soft  (minimize R loss)
 *   L2 — Medium (balance R vs DD)
 *   L3 — Hard  (safety first)
 */

const BATCH_TAG = 'dd-protection-matrix-2026-03-20';
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

// ─── DD Protection Level Definitions ────────────────────────────────────────

interface ProtectionLevel {
    id: 'L1' | 'L2' | 'L3';
    label: string;
    guards: TradeGuardConfigInput;
}

const PROTECTION_LEVELS: ProtectionLevel[] = [
    {
        id: 'L1',
        label: 'Soft Protection (minimize R loss)',
        guards: {
            dayLossCap: { maxLosses: 3, maxNetR: 5 },
            lossStreakCooldown: { afterLosses: 4, cooldownMinutes: 1440 },
            lossStreakThrottle: {
                steps: [
                    { afterLosses: 3, riskPercent: 1.0 },
                    { afterLosses: 5, riskPercent: 0.5 },
                ],
            },
            equityCurveFilter: { emaTrades: 15, action: 'HALF_RISK' },
            minTradeSpacing: { minSpacingMinutes: 30 },
        },
    },
    {
        id: 'L2',
        label: 'Medium Protection (balance R vs DD)',
        guards: {
            dayLossCap: { maxLosses: 2, maxNetR: 3 },
            sessionLossCap: { maxLosses: 2, maxNetR: 3 },
            lossStreakCooldown: { afterLosses: 3, cooldownMinutes: 1440 },
            lossStreakThrottle: {
                steps: [
                    { afterLosses: 2, riskPercent: 1.0 },
                    { afterLosses: 4, riskPercent: 0.5 },
                ],
            },
            equityCurveFilter: { emaTrades: 10, action: 'HALF_RISK' },
            maxDrawdownHalt: { maxDrawdownPct: 15 },
            minTradeSpacing: { minSpacingMinutes: 45 },
        },
    },
    {
        id: 'L3',
        label: 'Hard Protection (safety first)',
        guards: {
            dayLossCap: { maxLosses: 2, maxNetR: 2 },
            sessionLossCap: { maxLosses: 1, maxNetR: 2 },
            lossStreakCooldown: { afterLosses: 3, cooldownMinutes: 2880 },
            lossStreakThrottle: {
                steps: [
                    { afterLosses: 2, riskPercent: 0.5 },
                ],
            },
            equityCurveFilter: { emaTrades: 10, action: 'HALF_RISK' },
            maxDrawdownHalt: { maxDrawdownPct: 8 },
            minTradeSpacing: { minSpacingMinutes: 60 },
        },
    },
];

// ─── Strategy Definitions ───────────────────────────────────────────────────

interface StrategyDef {
    shortName: string;
    originalRunId: string;
    originalNetR: number;
    originalMaxDD: number;
    buildDefinition: () => ComposedSignalDefinition;
    /** Base guards that the original run had (merged with protection level) */
    existingGuards: TradeGuardConfigInput;
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
        existingGuards: {
            minTradeSpacing: { minSpacingMinutes: 30 },
            equityCurveFilter: { emaTrades: 20, action: 'HALF_RISK' },
            sessionLossCap: { maxLosses: 3, maxNetR: 3 },
            dayLossCap: { maxLosses: 4, maxNetR: 4 },
            lossStreakCooldown: { afterLosses: 5, cooldownMinutes: 720 },
            lossStreakThrottle: {
                steps: [
                    { afterLosses: 3, riskPercent: 1.5 },
                    { afterLosses: 5, riskPercent: 1.0 },
                ],
            },
        },
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
        existingGuards: {
            minTradeSpacing: { minSpacingMinutes: 30 },
            equityCurveFilter: { emaTrades: 20, action: 'HALF_RISK' },
            sessionLossCap: { maxLosses: 3, maxNetR: 3 },
            dayLossCap: { maxLosses: 4, maxNetR: 4 },
            lossStreakCooldown: { afterLosses: 5, cooldownMinutes: 720 },
            lossStreakThrottle: {
                steps: [
                    { afterLosses: 3, riskPercent: 1.5 },
                    { afterLosses: 5, riskPercent: 1.0 },
                ],
            },
        },
    };

    // ── Strategy 3: Champion_B ──────────────────────────────────────────────
    // Base: SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG + applyM5Base + TP 2.5 + stopLookback 72 + Trend Filter B
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
        existingGuards: {
            sessionLossCap: { maxLosses: 3, maxNetR: 3 },
            dayLossCap: { maxLosses: 4, maxNetR: 4 },
            lossStreakCooldown: { afterLosses: 5, cooldownMinutes: 720 },
            lossStreakThrottle: {
                steps: [
                    { afterLosses: 3, riskPercent: 1.5 },
                    { afterLosses: 5, riskPercent: 1.0 },
                ],
            },
        },
    };

    // ── Strategy 4: SPACING_30 ──────────────────────────────────────────────
    // Same as Champion_B + minTradeSpacing 30
    const spacing30: StrategyDef = {
        shortName: 'SPC30',
        originalRunId: 'cmmxdguq936o1tkcwt4bqk5su',
        originalNetR: 1032,
        originalMaxDD: -161,
        buildDefinition: () => {
            // Same signal definition as Champion_B
            return championB.buildDefinition();
        },
        existingGuards: {
            sessionLossCap: { maxLosses: 3, maxNetR: 3 },
            dayLossCap: { maxLosses: 4, maxNetR: 4 },
            lossStreakCooldown: { afterLosses: 5, cooldownMinutes: 720 },
            lossStreakThrottle: {
                steps: [
                    { afterLosses: 3, riskPercent: 1.5 },
                    { afterLosses: 5, riskPercent: 1.0 },
                ],
            },
            minTradeSpacing: { minSpacingMinutes: 30 },
        },
    };

    // ── Strategy 5: S5_STATE ────────────────────────────────────────────────
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
        existingGuards: {
            minTradeSpacing: { minSpacingMinutes: 30 },
            equityCurveFilter: { emaTrades: 20, action: 'HALF_RISK' },
        },
    };

    // ── Strategy 6: B1_ATR135 ───────────────────────────────────────────────
    // Base: SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG + applyM5Base + ATR mult 1.35 + HARD_SIGNAL_TP
    const b1Atr135: StrategyDef = {
        shortName: 'B1_ATR',
        originalRunId: 'cmmsy6wey70oltktyj8tuni5i',
        originalNetR: 623,
        originalMaxDD: -154,
        buildDefinition: () => {
            const seeds = getTier1ComposedSignalSeeds();
            const baseSeed = seeds.find((s) => s.code === 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG');
            if (!baseSeed) throw new Error('Base seed SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG not found');
            const definition = jsonClone(baseSeed.composedBlocks) as ComposedSignalDefinition;
            applyM5Base(definition);
            setAtrMultiplier(definition, 1.35);
            definition.exitManagement = { profileCode: 'HARD_SIGNAL_TP' as any };
            return definition;
        },
        existingGuards: {},
    };

    return [s3ModerateGuards, s3NyAsian, championB, spacing30, s5State, b1Atr135];
}

// ─── Guard Merge Logic ──────────────────────────────────────────────────────

/**
 * Merge existing guards with protection level guards.
 * Protection level guards take precedence (override existing).
 * For lossStreakThrottle, protection level steps replace existing steps entirely.
 */
function mergeGuards(existing: TradeGuardConfigInput, protection: TradeGuardConfigInput): TradeGuardConfigInput {
    return {
        ...existing,
        ...protection,
    };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
    const prisma = new PrismaClient();
    const backtests = new SignalBacktestRunService(prisma);
    const execution = new SignalBacktestExecutionService(prisma);
    const registry = SignalRegistry.getInstance();
    const blockRegistry = createDefaultBlockRegistry();

    const strategies = buildStrategies();

    console.log(`\n${'='.repeat(80)}`);
    console.log(`DD Protection Matrix — 6 Strategies × 3 Protection Levels = 18 Runs`);
    console.log(`Batch: ${BATCH_TAG}`);
    console.log(`Period: ${FROM} -> ${TO}`);
    console.log(`Symbol: ${SYMBOL} | Timeframe: ${TIMEFRAME}`);
    console.log(`Equity: $${INITIAL_EQUITY.toLocaleString()} | Risk: ${RISK_PERCENT}%`);
    console.log(`${'='.repeat(80)}\n`);

    const results: Array<{
        name: string;
        strategy: string;
        level: string;
        status: string;
        runId?: string;
        trades?: number;
    }> = [];

    let runNum = 0;
    const totalRuns = strategies.length * PROTECTION_LEVELS.length;

    for (const strategy of strategies) {
        for (const level of PROTECTION_LEVELS) {
            runNum++;
            const runName = `DD_${level.id}_${strategy.shortName}`;
            console.log(`\n[${runNum}/${totalRuns}] ${runName}`);
            console.log(`  Strategy: ${strategy.shortName} (original: Net R ${strategy.originalNetR}, Max DD ${strategy.originalMaxDD}R)`);
            console.log(`  Protection: ${level.label}`);

            // 1. Build the signal definition
            const definition = strategy.buildDefinition();

            // 2. Merge guards: existing + protection overlay
            const mergedGuards = mergeGuards(strategy.existingGuards, level.guards);
            console.log(`  Guards: ${JSON.stringify(mergedGuards).slice(0, 200)}...`);

            // 3. Register temporary signal
            const tmpCode = `DD_${level.id}_${strategy.shortName}`.toUpperCase().slice(0, 60);
            registry.register(
                new ComposedSignalPlugin(
                    definition,
                    blockRegistry,
                    tmpCode,
                    1,
                    `DD Protection ${level.id}: ${strategy.shortName}`,
                ),
            );

            try {
                // 4. Build execution config
                const executionConfig: ExecutionConfigInput = {
                    ...BASE_EXECUTION_CONFIG,
                    tradeGuards: mergedGuards,
                    eventSchema: { profileCode: 'HARD_SIGNAL_TP' },
                } as any;

                // 5. Create run in DB
                const created = await backtests.createGeneratedBacktest({
                    signalCode: tmpCode,
                    signalVersion: 1,
                    symbol: SYMBOL,
                    timeframe: TIMEFRAME,
                    dateRange: { from: FROM, to: TO },
                    parameters: {
                        ddProtectionLevel: level.id,
                        ddProtectionLabel: level.label,
                        originalRunId: strategy.originalRunId,
                        originalNetR: strategy.originalNetR,
                        originalMaxDD: strategy.originalMaxDD,
                        strategyShortName: strategy.shortName,
                        existingGuards: strategy.existingGuards,
                        protectionGuards: level.guards,
                        mergedGuards,
                    },
                    executionConfig,
                    initialEquity: INITIAL_EQUITY,
                    riskPercent: RISK_PERCENT,
                    notes: `[${BATCH_TAG}] DD Protection ${level.id} (${level.label}) for ${strategy.shortName} | Original: Net R ${strategy.originalNetR}, Max DD ${strategy.originalMaxDD}R`,
                });

                // 6. Execute
                const result = await execution.executeRun(created.backtestRunId);
                console.log(`  => DONE: runId=${created.backtestRunId}, status=${result.status}, trades=${result.counts.persistedResults}`);

                results.push({
                    name: runName,
                    strategy: strategy.shortName,
                    level: level.id,
                    status: 'DONE',
                    runId: created.backtestRunId,
                    trades: result.counts.persistedResults,
                });
            } catch (error: any) {
                console.error(`  => FAILED: ${error.message}`);
                results.push({
                    name: runName,
                    strategy: strategy.shortName,
                    level: level.id,
                    status: `FAILED: ${error.message}`,
                });
            } finally {
                registry.unregister(tmpCode, 1);
            }
        }
    }

    await prisma.$disconnect();

    console.log(`\n${'='.repeat(80)}`);
    console.log(`DD Protection Matrix Complete — ${results.filter((r) => r.status === 'DONE').length}/${totalRuns} succeeded`);
    console.log(`${'='.repeat(80)}`);
    console.table(results);
    console.log(`\nBatch tag: ${BATCH_TAG}`);
    console.log(`Run IDs: ${results.filter((r) => r.runId).map((r) => r.runId).join(', ')}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
