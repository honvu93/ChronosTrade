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
    setRsiThreshold, 
    setAtrMultiplier, 
    setStopLookback, 
    setAtrBufferMultiplier, 
    setTakeProfitMultiple,
    addPriceAboveEma,
    setSignalAreaGuard,
    addBullishMarketRegime
} from './xauAbcOptimizationShared';

dotenv.config();

export const BATCH_TAG = 'top-20-optimization-2026-03-16';

export const DEFAULT_EXECUTION_CONFIG: ExecutionConfigInput = {
    entryFeeBps: 4,
    exitFeeBps: 4,
    entrySlippageBps: 2,
    exitSlippageBps: 2,
    orderTiming: 'NEXT_BAR_OPEN',
    stopLoss: { mode: 'SIGNAL_PRICE' },
    takeProfit: { mode: 'SIGNAL_PRICE' },
    positionSizing: { mode: 'RISK_BASED' },
};

export interface VariantConfig {
    id: string;
    signalCode: string;
    timeframe: string;
    riskPercent: number;
    exitProfile: string;
    params: Record<string, any>;
}

const jsonClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export async function runBacktestVariant(variant: VariantConfig) {
    const prisma = new PrismaClient();
    const backtests = new SignalBacktestRunService(prisma);
    const execution = new SignalBacktestExecutionService(prisma);
    const registry = SignalRegistry.getInstance();
    const blockRegistry = createDefaultBlockRegistry();

    const from = '2019-01-01T00:00:00.000Z';
    const to = '2026-03-14T23:59:59.999Z';
    const symbol = 'XAUUSD';

    console.log(`Starting individual backtest for variant: ${variant.id}`);

    // 1. Resolve base definition
    const seeds = getTier1ComposedSignalSeeds();
    const baseSeed = seeds.find(s => s.code === variant.signalCode);
    if (!baseSeed) {
        throw new Error(`Base signal code ${variant.signalCode} not found in seeds`);
    }

    // 2. Clone and mutate
    const definition = jsonClone(baseSeed.composedBlocks) as ComposedSignalDefinition;
    if (variant.timeframe === 'M5') {
        applyM5Base(definition);
    }
    
    // Apply specific parameters from variant config
    if (variant.params.rsiThreshold !== undefined) setRsiThreshold(definition, variant.params.rsiThreshold);
    if (variant.params.atrMultiplier !== undefined) setAtrMultiplier(definition, variant.params.atrMultiplier);
    if (variant.params.stopLookback !== undefined) setStopLookback(definition, variant.params.stopLookback);
    if (variant.params.atrBufferMultiplier !== undefined) setAtrBufferMultiplier(definition, variant.params.atrBufferMultiplier);
    if (variant.params.tpMultiple !== undefined) setTakeProfitMultiple(definition, variant.params.tpMultiple);
    if (variant.params.useEmaFilter) addPriceAboveEma(definition);
    if (variant.params.useMarketRegime) addBullishMarketRegime(definition);
    if (variant.params.maxSignalsPerArea !== undefined) {
        setSignalAreaGuard(definition, { 
            maxSignalsPerArea: variant.params.maxSignalsPerArea,
            priceDistanceR: variant.params.priceDistanceR
        });
    }

    definition.exitManagement = { profileCode: variant.exitProfile as any };

    // 3. Register temporary signal
    const tmpCode = `XAB_VAR_${variant.id}`.toUpperCase().slice(0, 60);
    registry.register(new ComposedSignalPlugin(
        definition,
        blockRegistry,
        tmpCode,
        1,
        `Variant: ${variant.id}`
    ));

    try {
        // 4. Create run in DB pointing to temp code
        const created = await backtests.createGeneratedBacktest({
            signalCode: tmpCode,
            signalVersion: 1,
            symbol,
            timeframe: variant.timeframe,
            dateRange: { from, to },
            parameters: variant.params,
            executionConfig: {
                ...DEFAULT_EXECUTION_CONFIG,
                eventSchema: { profileCode: variant.exitProfile }
            } as any,
            initialEquity: 10000,
            riskPercent: variant.riskPercent,
            notes: `[${BATCH_TAG}] Variant: ${variant.id} (Base: ${variant.signalCode})`
        });

        // 5. Execute
        const result = await execution.executeRun(created.backtestRunId);
        console.log(`  => DONE: runId=${created.backtestRunId}, status=${result.status}, results=${result.counts.persistedResults}`);
    } catch (error: any) {
        throw error;
    } finally {
        registry.unregister(tmpCode, 1);
        await prisma.$disconnect();
    }
}
