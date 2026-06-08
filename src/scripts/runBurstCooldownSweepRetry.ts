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
 * Retry for the 3 failed runs from burst cooldown sweep:
 *   BURST_B_CHAMP_B, BURST_C_S3_MOD, BURST_C_S3_NYASN
 * Run sequentially to avoid shared memory pressure.
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

const S3_S5_STOP_LOSS = {
    type: 'BELOW_STRUCTURE' as const,
    value: 0.0018,
    lookback: 72,
    atrBufferMultiplier: 0.2,
    atrPeriod: 14,
};
const S3_S5_TAKE_PROFIT = { type: 'R_MULTIPLE' as const, value: 2.5 };
const S3_S5_EXIT_MANAGEMENT = { profileCode: 'HARD_SIGNAL_TP' as any };

const S3_BASE_BLOCKS: any[] = [
    { id: 'pwh_breakout', indicatorId: 'PD_LEVELS', conditionId: 'closes_above_previous_week_high', indicatorParams: {}, conditionParams: {} },
    { id: 'asian_high_breakout', indicatorId: 'SESSION_RANGE_STRUCTURE', conditionId: 'closes_above_asian_high', indicatorParams: { asianStartHour: 0, asianEndHour: 7 }, conditionParams: {} },
    { id: 'regime_bullish', indicatorId: 'MARKET_REGIME', conditionId: 'regime_trending_bullish', indicatorParams: { adxPeriod: 14, atrPeriod: 14, emaFilterPeriod: 200 }, conditionParams: { adxThreshold: 22 } },
    { id: 'trend_catcher_bull', indicatorId: 'TREND_CATCHER', conditionId: 'trend_catcher_bullish', indicatorParams: { fastPeriod: 10, slowPeriod: 20, rsiPeriod: 14 }, conditionParams: { rsiThreshold: 50 } },
];

const jsonClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

interface RetryRun {
    name: string;
    shortName: string;
    burstCode: string;
    burstLabel: string;
    burstConfig: TradeGuardConfigInput['entryBurstCooldown'] | null;
    buildDefinition: () => ComposedSignalDefinition;
    originalRunId: string;
    originalNetR: number;
    originalMaxDD: number;
}

function getRetryRuns(): RetryRun[] {
    const seeds = getTier1ComposedSignalSeeds();
    const baseSeed = seeds.find((s) => s.code === 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG');

    return [
        // BURST_B_CHAMP_B
        {
            name: 'BURST_B_CHAMP_B',
            shortName: 'CHAMP_B',
            burstCode: 'B',
            burstLabel: 'Light (8/180min, cd=480)',
            burstConfig: { maxEntriesInWindow: 8, windowMinutes: 180, cooldownMinutes: 480 },
            originalRunId: 'cmmxcnw4m09wvtklwtladtv1d',
            originalNetR: 1144,
            originalMaxDD: -189,
            buildDefinition: () => {
                if (!baseSeed) throw new Error('Base seed not found');
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
        },
        // BURST_C_S3_MOD
        {
            name: 'BURST_C_S3_MOD',
            shortName: 'S3_MOD',
            burstCode: 'C',
            burstLabel: 'Disabled (no burst)',
            burstConfig: null,
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
        },
        // BURST_C_S3_NYASN
        {
            name: 'BURST_C_S3_NYASN',
            shortName: 'S3_NYASN',
            burstCode: 'C',
            burstLabel: 'Disabled (no burst)',
            burstConfig: null,
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
        },
    ];
}

async function main() {
    const prisma = new PrismaClient();
    const backtests = new SignalBacktestRunService(prisma);
    const execution = new SignalBacktestExecutionService(prisma);
    const blockRegistry = createDefaultBlockRegistry();
    const registry = SignalRegistry.getInstance();

    const retryRuns = getRetryRuns();

    console.log(`\nRetrying ${retryRuns.length} failed burst cooldown runs SEQUENTIALLY...\n`);

    const results: any[] = [];

    for (let i = 0; i < retryRuns.length; i++) {
        const run = retryRuns[i];
        const tmpCode = run.name.toUpperCase().slice(0, 60);

        console.log(`\n[${i + 1}/${retryRuns.length}] ${run.name} — Starting...`);

        const definition = run.buildDefinition();
        registry.register(
            new ComposedSignalPlugin(definition, blockRegistry, tmpCode, 1, `Burst Sweep Retry: ${run.name}`),
        );

        try {
            const guards: TradeGuardConfigInput = { ...BASE_GUARDS };
            if (run.burstConfig) {
                guards.entryBurstCooldown = run.burstConfig;
            }

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
                    originalRunId: run.originalRunId,
                    originalNetR: run.originalNetR,
                    originalMaxDD: run.originalMaxDD,
                    strategyShortName: run.shortName,
                    burstLevelCode: run.burstCode,
                    burstLevelLabel: run.burstLabel,
                    burstConfig: run.burstConfig,
                    guards,
                    retry: true,
                },
                executionConfig,
                initialEquity: INITIAL_EQUITY,
                riskPercent: RISK_PERCENT,
                notes: `[${BATCH_TAG}] ${run.name} (RETRY) | Burst: ${run.burstLabel} | Original: Net R ${run.originalNetR}, Max DD ${run.originalMaxDD}R`,
            });

            const result = await execution.executeRun(created.backtestRunId);
            console.log(`  => DONE ${run.name}: runId=${created.backtestRunId}, trades=${result.counts.persistedResults}`);
            results.push({ name: run.name, status: 'DONE', runId: created.backtestRunId, trades: result.counts.persistedResults });
        } catch (error: any) {
            console.error(`  => FAILED ${run.name}: ${error.message}`);
            results.push({ name: run.name, status: `FAILED: ${error.message}` });
        } finally {
            registry.unregister(tmpCode, 1);
        }
    }

    await prisma.$disconnect();
    console.log('\n--- Retry Results ---');
    console.table(results);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
