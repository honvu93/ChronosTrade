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
import {
    BASE_SIGNAL_CODE,
    DEFAULT_EXECUTION_CONFIG,
    DEFAULT_OUT_DIR,
    FROM,
    INITIAL_EQUITY,
    RISK_PERCENT,
    SYMBOL,
    TO,
    applyM5Base,
    setAtrBufferMultiplier,
    setAtrMultiplier,
    setSignalAreaGuard,
    setStopLookback,
    setTakeProfitMultiple,
} from './xauAbcOptimizationShared';
import { getTier1ComposedSignalSeeds } from '../services/signals/tier1ComposedSignals';

dotenv.config();

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
    changeSummary: string;
    exitProfile: string;
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
    results: VariantResult[];
    notes: string[];
};

type VariantSpec = {
    id: string;
    label: string;
    changeSummary: string;
    mutate(definition: ComposedSignalDefinition): void;
};

const riskSummaryService = new BacktestRiskSummaryService();

const applyBaseAreaCap = (definition: ComposedSignalDefinition) => {
    applyM5Base(definition);
    setSignalAreaGuard(definition, {
        maxSignalsPerArea: 5,
        resetBars: 8,
        priceDistanceR: 0.75,
    });
    setAtrMultiplier(definition, 1.15);
};

const VARIANTS: VariantSpec[] = [
    {
        id: 'cap5_geom_b8_r075_atr115_tp25_hard',
        label: 'Cap 5 + reset 8 + 0.75R + ATR 1.15 + TP 2.5R',
        changeSummary: 'Keep the best area-cap geometry and raise the target from 2.0R to 2.5R to recover more trend payoff.',
        mutate(definition) {
            applyBaseAreaCap(definition);
            setTakeProfitMultiple(definition, 2.5);
        },
    },
    {
        id: 'cap5_geom_b8_r075_atr115_lookback96_hard',
        label: 'Cap 5 + reset 8 + 0.75R + ATR 1.15 + lookback 96',
        changeSummary: 'Keep the best area-cap geometry and loosen the structure stop lookback from 72 bars to 96 bars.',
        mutate(definition) {
            applyBaseAreaCap(definition);
            setStopLookback(definition, 96);
        },
    },
    {
        id: 'cap5_geom_b8_r075_atr115_buffer015_hard',
        label: 'Cap 5 + reset 8 + 0.75R + ATR 1.15 + buffer 0.15',
        changeSummary: 'Keep the best area-cap geometry and reduce the ATR stop buffer from 0.20 to 0.15.',
        mutate(definition) {
            applyBaseAreaCap(definition);
            setAtrBufferMultiplier(definition, 0.15);
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
    let outPath = `${DEFAULT_OUT_DIR}/m5_area_cap_round2.json`;

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
        console.log('Running XAU ABC M5 area-cap round 2...');

        for (const variant of VARIANTS) {
            const definition = JSON.parse(JSON.stringify(baseSeed.composedBlocks)) as ComposedSignalDefinition;
            variant.mutate(definition);
            definition.exitManagement = { profileCode: 'HARD_SIGNAL_TP' };

            const tmpCode = `XAB_R2_${variant.id}`.slice(0, 60).toUpperCase();
            registry.register(new ComposedSignalPlugin(definition, blockRegistry, tmpCode, 1, tmpCode));

            try {
                const output = await runner.run({
                    signalCode: tmpCode,
                    signalVersion: 1,
                    symbol: SYMBOL,
                    timeframe: 'M5',
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
                    changeSummary: variant.changeSummary,
                    exitProfile: 'HARD_SIGNAL_TP',
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
        group: 'm5_area_cap_round2',
        groupLabel: 'M5 area-cap round 2: alpha recovery',
        symbol: SYMBOL,
        from: FROM.toISOString(),
        to: TO.toISOString(),
        initialEquity: INITIAL_EQUITY,
        riskPercent: RISK_PERCENT,
        executionConfig: DEFAULT_EXECUTION_CONFIG,
        baseSignalCode: BASE_SIGNAL_CODE,
        results,
        notes: [
            'Base branch is cap5_geom_b8_r075_atr115_hard from the prior area-cap round.',
            'This round tests alpha recovery through reward/stop geometry, not by relaxing the area cap itself.',
        ],
    };

    const resolved = path.resolve(args.outPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, JSON.stringify(outputFile, null, 2));
    console.log(`Saved JSON output to ${resolved}`);
    console.table(results.map((row) => ({
        Variant: row.variantId,
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
