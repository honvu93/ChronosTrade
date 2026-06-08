import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { SignalBacktestExecutionService } from '../services/signals/SignalBacktestExecutionService';
import { SignalBacktestRunService } from '../services/signals/SignalBacktestRunService';
import { ExecutionConfigInput } from '../services/signals/types';
import { SignalRegistry } from '../services/signals/SignalRegistry';
import { ComposedSignalPlugin, ComposedSignalDefinition } from '../services/signals/ComposedSignalPlugin';
import { createDefaultBlockRegistry } from '../services/signals/blocks/createDefaultBlockRegistry';
import { getTier1ComposedSignalSeeds } from '../services/signals/tier1ComposedSignals';
import {
    applyM5Base,
    setAtrMultiplier,
    setStopLookback,
    setTakeProfitMultiple,
} from './xauAbcOptimizationShared';

dotenv.config();

// ─── Constants ────────────────────────────────────────────────────────────────

const BATCH_TAG = 'opt-1-london-filter-2026-03-19';
const BASE_SIGNAL_CODE = 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG';
const SYMBOL = 'XAUUSD';
const TIMEFRAME = 'M5';
const FROM = '2019-01-01T00:00:00.000Z';
const TO = '2026-03-14T23:59:59.999Z';
const RISK_PERCENT = 2;
const EXIT_PROFILE = 'HARD_SIGNAL_TP';

const DEFAULT_EXECUTION_CONFIG: ExecutionConfigInput = {
    entryFeeBps: 4,
    exitFeeBps: 4,
    entrySlippageBps: 2,
    exitSlippageBps: 2,
    orderTiming: 'NEXT_BAR_OPEN',
    stopLoss: { mode: 'SIGNAL_PRICE' },
    takeProfit: { mode: 'SIGNAL_PRICE' },
    positionSizing: { mode: 'RISK_BASED' },
};

// ─── Session filter configs ──────────────────────────────────────────────────

type SessionConfig = 'NO_LONDON' | 'LATE_LONDON';

/**
 * NO_LONDON:   allow only Asian (00:00-06:59) + NY (13:00-20:59)
 *              => startHour=13, endHour=7  (overnight wrap: hour >= 13 || hour < 7)
 *
 * LATE_LONDON: allow Asian (00:00-06:59) + London-NY overlap onwards (12:00-20:59)
 *              => startHour=12, endHour=7  (overnight wrap: hour >= 12 || hour < 7)
 */
const SESSION_PARAMS: Record<SessionConfig, { startHour: number; endHour: number }> = {
    NO_LONDON:   { startHour: 13, endHour: 7 },
    LATE_LONDON: { startHour: 12, endHour: 7 },
};

// ─── Baseline variant definitions ────────────────────────────────────────────

interface BaselineSpec {
    id: string;
    mutate: (def: ComposedSignalDefinition) => void;
    params: Record<string, any>;
}

const BASELINES: BaselineSpec[] = [
    {
        id: 'B1_ATR135',
        params: { atrMultiplier: 1.35 },
        mutate: (def) => {
            setAtrMultiplier(def, 1.35);
        },
    },
    {
        id: 'B4_TP25',
        params: { tpMultiple: 2.5, stopLookback: 72 },
        mutate: (def) => {
            setTakeProfitMultiple(def, 2.5);
            setStopLookback(def, 72);
        },
    },
    {
        id: 'B4_LOOKBACK96',
        params: { tpMultiple: 2.0, stopLookback: 96 },
        mutate: (def) => {
            setTakeProfitMultiple(def, 2.0);
            setStopLookback(def, 96);
        },
    },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const jsonClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function replaceSessionFilter(
    definition: ComposedSignalDefinition,
    startHour: number,
    endHour: number,
): void {
    const block = definition.blocks.find((b) => b.indicatorId === 'SESSION_FILTER');
    if (!block) {
        throw new Error('SESSION_FILTER block not found in composed definition');
    }
    block.indicatorParams = { startHour, endHour };
}

// ─── Main ────────────────────────────────────────────────────────────────────

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

    const sessionConfigs: SessionConfig[] = ['NO_LONDON', 'LATE_LONDON'];

    console.log(`\n${'='.repeat(70)}`);
    console.log(`OPT-1: London Session Filter Matrix`);
    console.log(`Batch: ${BATCH_TAG}`);
    console.log(`Baselines: ${BASELINES.map((b) => b.id).join(', ')}`);
    console.log(`Sessions: ${sessionConfigs.join(', ')}`);
    console.log(`Period: ${FROM} → ${TO}`);
    console.log(`${'='.repeat(70)}\n`);

    const total = BASELINES.length * sessionConfigs.length;
    let completed = 0;
    let failed = 0;

    for (const baseline of BASELINES) {
        for (const sessionCfg of sessionConfigs) {
            const variantId = `OPT1_${baseline.id}_${sessionCfg}`;
            const tmpCode = `XAB_${variantId}`.toUpperCase().slice(0, 60);
            completed++;

            console.log(`\n[${completed}/${total}] Running: ${variantId}`);

            // 1. Clone base definition
            const definition = jsonClone(baseSeed.composedBlocks) as ComposedSignalDefinition;

            // 2. Apply M5 base adjustments
            applyM5Base(definition);

            // 3. Apply baseline-specific mutations
            baseline.mutate(definition);

            // 4. Replace session filter with the opt-1 variant
            const sessionParams = SESSION_PARAMS[sessionCfg];
            replaceSessionFilter(definition, sessionParams.startHour, sessionParams.endHour);

            // 5. Set exit management
            definition.exitManagement = { profileCode: EXIT_PROFILE as any };

            // 6. Register temporary signal
            registry.register(
                new ComposedSignalPlugin(
                    definition,
                    blockRegistry,
                    tmpCode,
                    1,
                    `OPT-1 ${baseline.id} ${sessionCfg}`,
                ),
            );

            try {
                // 7. Create backtest run in DB
                const created = await backtests.createGeneratedBacktest({
                    signalCode: tmpCode,
                    signalVersion: 1,
                    symbol: SYMBOL,
                    timeframe: TIMEFRAME,
                    dateRange: { from: FROM, to: TO },
                    parameters: {
                        ...baseline.params,
                        sessionFilter: sessionCfg,
                        sessionStartHour: sessionParams.startHour,
                        sessionEndHour: sessionParams.endHour,
                    },
                    executionConfig: {
                        ...DEFAULT_EXECUTION_CONFIG,
                        eventSchema: { profileCode: EXIT_PROFILE },
                    } as any,
                    initialEquity: 10000,
                    riskPercent: RISK_PERCENT,
                    notes: `[${BATCH_TAG}] OPT-1 variant: ${variantId} (Base: ${BASE_SIGNAL_CODE}, Session: ${sessionCfg})`,
                });

                // 8. Execute
                const result = await execution.executeRun(created.backtestRunId);
                console.log(
                    `  => DONE: runId=${created.backtestRunId}, status=${result.status}, trades=${result.counts.persistedResults}`,
                );
            } catch (error: any) {
                failed++;
                console.error(`  => FAILED: ${variantId} | ${error.message}`);
            } finally {
                registry.unregister(tmpCode, 1);
            }
        }
    }

    await prisma.$disconnect();

    console.log(`\n${'='.repeat(70)}`);
    console.log(`OPT-1 Matrix complete. ${completed - failed}/${total} succeeded, ${failed} failed.`);
    console.log(`${'='.repeat(70)}\n`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
