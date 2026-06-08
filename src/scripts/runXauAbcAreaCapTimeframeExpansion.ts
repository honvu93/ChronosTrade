import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { ComposedSignalDefinition, ComposedSignalPlugin } from '../services/signals/ComposedSignalPlugin';
import { SignalRegistry } from '../services/signals/SignalRegistry';
import { SignalBacktestRunner } from '../services/signals/SignalBacktestRunner';
import { CandleQueryService } from '../services/signals/CandleQueryService';
import { IndicatorSeriesService } from '../services/signals/IndicatorSeriesService';
import { ExecutionModelService } from '../services/signals/ExecutionModelService';
import { createDefaultBlockRegistry } from '../services/signals/blocks/createDefaultBlockRegistry';
import { BacktestRiskSummary, BacktestRiskSummaryService } from '../services/signals/BacktestRiskSummaryService';
import { getTier1ComposedSignalSeeds } from '../services/signals/tier1ComposedSignals';
import {
    BASE_SIGNAL_CODE,
    DEFAULT_EXECUTION_CONFIG,
    DEFAULT_OUT_DIR,
    FROM,
    INITIAL_EQUITY,
    RISK_PERCENT,
    SYMBOL,
    TO,
    setAtrBufferMultiplier,
    setAtrMultiplier,
    setSignalAreaGuard,
    setStopLookback,
    setTakeProfitMultiple,
} from './xauAbcOptimizationShared';

dotenv.config();

type TimeframeKey = 'M15' | 'M30' | 'H1';

type Summary = {
    trades: number;
    netPnl: number;
    netR: number;
    winRate: number;
    maxDd: number;
    profitFactor: number | null;
};

type VariantResult = {
    variantId: string;
    variantLabel: string;
    timeframe: TimeframeKey;
    exitProfile: string;
    changeSummary: string;
    summary: Summary;
    riskSummary: BacktestRiskSummary;
};

type OutputFile = {
    generatedAt: string;
    group: string;
    groupLabel: string;
    symbol: string;
    from: string;
    to: string;
    initialEquity: number;
    riskPercent: number;
    executionConfig: typeof DEFAULT_EXECUTION_CONFIG;
    baseSignalCode: string;
    notes: string[];
    results: VariantResult[];
};

type VariantSpec = {
    id: string;
    label: string;
    timeframe: TimeframeKey;
    changeSummary: string;
    mutate(definition: ComposedSignalDefinition): void;
};

const riskSummaryService = new BacktestRiskSummaryService();

const TIMEFRAME_TUNING: Record<TimeframeKey, {
    windowBars: number;
    stopLookback: number;
    takeProfitR: number;
    atrBufferMultiplier: number;
    atrMultiplier: number;
    areaCap: number;
    areaResetBars: number;
    areaPriceDistanceR: number;
}> = {
    M15: {
        windowBars: 8,
        stopLookback: 30,
        takeProfitR: 2.5,
        atrBufferMultiplier: 0.22,
        atrMultiplier: 1.15,
        areaCap: 5,
        areaResetBars: 3,
        areaPriceDistanceR: 0.75,
    },
    M30: {
        windowBars: 4,
        stopLookback: 18,
        takeProfitR: 3,
        atrBufferMultiplier: 0.25,
        atrMultiplier: 1.15,
        areaCap: 4,
        areaResetBars: 2,
        areaPriceDistanceR: 1,
    },
    H1: {
        windowBars: 2,
        stopLookback: 10,
        takeProfitR: 3.5,
        atrBufferMultiplier: 0.3,
        atrMultiplier: 1.15,
        areaCap: 3,
        areaResetBars: 2,
        areaPriceDistanceR: 1.25,
    },
};

const applyTimeframeVariant = (
    definition: ComposedSignalDefinition,
    timeframe: TimeframeKey,
    mode: 'balanced' | 'extended',
) => {
    const tuning = TIMEFRAME_TUNING[timeframe];
    const takeProfitR = mode === 'extended' ? tuning.takeProfitR + 0.5 : tuning.takeProfitR;
    const stopLookback = mode === 'extended'
        ? Math.round(tuning.stopLookback * 1.25)
        : tuning.stopLookback;
    const atrBufferMultiplier = mode === 'extended'
        ? Number((tuning.atrBufferMultiplier + 0.05).toFixed(2))
        : tuning.atrBufferMultiplier;
    const atrMultiplier = mode === 'extended'
        ? Number((tuning.atrMultiplier + 0.05).toFixed(2))
        : tuning.atrMultiplier;
    const areaCap = mode === 'extended'
        ? Math.max(3, tuning.areaCap - 1)
        : tuning.areaCap;
    const areaPriceDistanceR = mode === 'extended'
        ? Number((tuning.areaPriceDistanceR + 0.25).toFixed(2))
        : tuning.areaPriceDistanceR;

    (definition as ComposedSignalDefinition & { timeframe?: string }).timeframe = timeframe;
    definition.windowBars = tuning.windowBars;
    setStopLookback(definition, stopLookback);
    setTakeProfitMultiple(definition, takeProfitR);
    setAtrBufferMultiplier(definition, atrBufferMultiplier);
    setAtrMultiplier(definition, atrMultiplier);
    setSignalAreaGuard(definition, {
        maxSignalsPerArea: areaCap,
        resetBars: tuning.areaResetBars,
        priceDistanceR: areaPriceDistanceR,
    });
};

const VARIANTS: VariantSpec[] = [
    {
        id: 'm15_balanced',
        label: 'M15 balanced area-cap continuation',
        timeframe: 'M15',
        changeSummary: 'M15 tuned with 2.5R target, 30-bar stop lookback, ATR buffer 0.22, ATR gate 1.15, and a 5-entry area cap.',
        mutate(definition) {
            applyTimeframeVariant(definition, 'M15', 'balanced');
        },
    },
    {
        id: 'm15_extended',
        label: 'M15 extended area-cap continuation',
        timeframe: 'M15',
        changeSummary: 'M15 tuned with higher reward and looser stop geometry to match wider per-bar movement on 15m candles.',
        mutate(definition) {
            applyTimeframeVariant(definition, 'M15', 'extended');
        },
    },
    {
        id: 'm30_balanced',
        label: 'M30 balanced area-cap continuation',
        timeframe: 'M30',
        changeSummary: 'M30 tuned with 3R target, 18-bar stop lookback, ATR buffer 0.25, and a 4-entry area cap.',
        mutate(definition) {
            applyTimeframeVariant(definition, 'M30', 'balanced');
        },
    },
    {
        id: 'm30_extended',
        label: 'M30 extended area-cap continuation',
        timeframe: 'M30',
        changeSummary: 'M30 tuned with wider stop and higher reward to reflect larger 30m swing amplitude.',
        mutate(definition) {
            applyTimeframeVariant(definition, 'M30', 'extended');
        },
    },
    {
        id: 'h1_balanced',
        label: 'H1 balanced area-cap continuation',
        timeframe: 'H1',
        changeSummary: 'H1 tuned with 3.5R target, 10-bar stop lookback, ATR buffer 0.30, and a 3-entry area cap.',
        mutate(definition) {
            applyTimeframeVariant(definition, 'H1', 'balanced');
        },
    },
    {
        id: 'h1_extended',
        label: 'H1 extended area-cap continuation',
        timeframe: 'H1',
        changeSummary: 'H1 tuned with wider stop and 4R target because 1h continuation bars require more breathing room.',
        mutate(definition) {
            applyTimeframeVariant(definition, 'H1', 'extended');
        },
    },
];

const summarize = (results: Array<{ isOpen: boolean; pnlUsd: number; rMultiple: number; win: boolean; maxDrawdownPct: number }>) => {
    const closed = results.filter((row) => !row.isOpen);
    const netPnl = closed.reduce((sum, row) => sum + Number(row.pnlUsd), 0);
    const netR = closed.reduce((sum, row) => sum + Number(row.rMultiple), 0);
    const wins = closed.filter((row) => row.win).length;
    const maxDd = closed.length ? Math.min(...closed.map((row) => Number(row.maxDrawdownPct))) : 0;
    const grossWin = closed.filter((row) => Number(row.pnlUsd) > 0).reduce((sum, row) => sum + Number(row.pnlUsd), 0);
    const grossLoss = Math.abs(closed.filter((row) => Number(row.pnlUsd) < 0).reduce((sum, row) => sum + Number(row.pnlUsd), 0));

    return {
        trades: closed.length,
        netPnl: Number(netPnl.toFixed(2)),
        netR: Number(netR.toFixed(2)),
        winRate: closed.length ? Number(((wins / closed.length) * 100).toFixed(2)) : 0,
        maxDd: Number(maxDd.toFixed(2)),
        profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : null,
    } satisfies Summary;
};

function parseArgs(argv: string[]) {
    let outPath = `${DEFAULT_OUT_DIR}/area_cap_timeframe_expansion.json`;

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--out') {
            const value = argv[index + 1];
            if (!value) {
                throw new Error('--out requires a filepath.');
            }
            outPath = value;
            index += 1;
            continue;
        }
        throw new Error(`Unknown argument "${arg}".`);
    }

    return { outPath };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const baseSeed = getTier1ComposedSignalSeeds().find((seed) => seed.code === BASE_SIGNAL_CODE);
    if (!baseSeed) {
        throw new Error(`Base seed ${BASE_SIGNAL_CODE} was not found.`);
    }

    const prisma = new PrismaClient();
    const registry = SignalRegistry.getInstance();
    const runner = new SignalBacktestRunner(
        new CandleQueryService(prisma),
        new IndicatorSeriesService(),
        new ExecutionModelService(),
        registry,
    );
    const blockRegistry = createDefaultBlockRegistry();
    const results: VariantResult[] = [];

    try {
        console.log('Running XAU ABC area-cap timeframe expansion...');
        for (const variant of VARIANTS) {
            const definition = JSON.parse(JSON.stringify(baseSeed.composedBlocks)) as ComposedSignalDefinition;
            variant.mutate(definition);
            definition.exitManagement = { profileCode: 'HARD_SIGNAL_TP' };
            const timeframe = (definition as ComposedSignalDefinition & { timeframe?: string }).timeframe ?? variant.timeframe;
            const tmpCode = `XAB_TF_${variant.id}`.slice(0, 60).toUpperCase();
            registry.register(new ComposedSignalPlugin(definition, blockRegistry, tmpCode, 1, tmpCode));

            try {
                const output = await runner.run({
                    signalCode: tmpCode,
                    signalVersion: 1,
                    symbol: SYMBOL,
                    timeframe,
                    from: FROM,
                    to: TO,
                    parameters: {},
                    initialEquity: INITIAL_EQUITY,
                    riskPercent: RISK_PERCENT,
                    executionConfig: DEFAULT_EXECUTION_CONFIG,
                });

                results.push({
                    variantId: variant.id,
                    variantLabel: variant.label,
                    timeframe: variant.timeframe,
                    exitProfile: 'HARD_SIGNAL_TP',
                    changeSummary: variant.changeSummary,
                    summary: summarize(output.results as Array<{
                        isOpen: boolean;
                        pnlUsd: number;
                        rMultiple: number;
                        win: boolean;
                        maxDrawdownPct: number;
                    }>),
                    riskSummary: riskSummaryService.summarize({
                        initialEquity: INITIAL_EQUITY,
                        results: output.results,
                        signals: output.signals,
                        events: output.events,
                        traces: output.traces,
                    }),
                });
            } finally {
                registry.unregister(tmpCode, 1);
            }
        }
    } finally {
        await prisma.$disconnect();
    }

    const outputFile: OutputFile = {
        generatedAt: new Date().toISOString(),
        group: 'area_cap_timeframe_expansion',
        groupLabel: 'Area-cap continuation on larger timeframes',
        symbol: SYMBOL,
        from: FROM.toISOString(),
        to: TO.toISOString(),
        initialEquity: INITIAL_EQUITY,
        riskPercent: RISK_PERCENT,
        executionConfig: DEFAULT_EXECUTION_CONFIG,
        baseSignalCode: BASE_SIGNAL_CODE,
        notes: [
            'Each larger timeframe uses custom stop and target geometry rather than reusing the M5 configuration.',
            'Higher timeframes receive wider stop lookbacks and larger R targets to account for larger per-bar movement.',
        ],
        results,
    };

    const resolved = path.resolve(args.outPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, JSON.stringify(outputFile, null, 2));
    console.log(`Saved JSON output to ${resolved}`);
    console.table(results.map((row) => ({
        Variant: row.variantId,
        TF: row.timeframe,
        NetPnL: row.summary.netPnl,
        WR: `${row.summary.winRate}%`,
        PF: row.summary.profitFactor,
        Trades: row.summary.trades,
        MaxL: row.riskSummary.maxConsecutiveLosses,
        EqDD: `${row.riskSummary.equityCurveMaxDdPct}%`,
    })));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
