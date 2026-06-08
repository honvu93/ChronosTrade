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
import { getTier1ComposedSignalSeeds } from '../services/signals/tier1ComposedSignals';
import { ExecutionConfigInput } from '../services/signals/types';

dotenv.config();

/**
 * OPT-5: SHORT Side Variant — Asian Low Break Continuation
 *
 * Mirrors the top-3 LONG Asian High Break variants as SHORT counterparts:
 *   - XAB_OPT5_B1_ATR135_SHORT:     atrMultiplier=1.35 (mirror B1_ATR135_HARD)
 *   - XAB_OPT5_B4_TP25_SHORT:       tpMultiple=2.5, stopLookback=72 (mirror B4_TP25_HARD)
 *   - XAB_OPT5_B4_LOOKBACK96_SHORT: tpMultiple=2.0, stopLookback=96 (mirror B4_LOOKBACK96_HARD)
 *
 * Plus the base SHORT definition:
 *   - XAB_OPT5_BASE_SHORT:          Base M5 SHORT, no additional parameter changes
 *
 * Base signal: SYS_XAU_ASIAN_BREAK_CONTINUATION_SHORT (side=SHORT, closes_below_asian_low)
 * Period: 2019-01-01 -> 2026-03-14, equity $10K, risk 2%
 */

const FROM = new Date('2019-01-01T00:00:00.000Z');
const TO = new Date('2026-03-14T23:59:59.999Z');
const SYMBOL = 'XAUUSD';
const INITIAL_EQUITY = 10_000;
const RISK_PERCENT = 2;
const BASE_SIGNAL_CODE = 'SYS_XAU_ASIAN_BREAK_CONTINUATION_SHORT';

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

type Summary = {
    trades: number;
    netPnl: number;
    netR: number;
    winRate: number;
    maxDd: number;
    profitFactor: number | null;
};

type ResultRow = {
    variantId: string;
    variantLabel: string;
    changeSummary: string;
    timeframe: string;
    exitProfile: string;
    summary: Summary;
    sessionBreakdown: Record<string, Summary>;
    yearlyBreakdown: Record<string, Summary>;
};

type VariantSpec = {
    id: string;
    label: string;
    changeSummary: string;
    exitProfile: 'HARD_SIGNAL_TP' | 'FIXED_2R';
    mutate(definition: ComposedSignalDefinition): void;
};

type StopLossWithLookback = NonNullable<ComposedSignalDefinition['stopLoss']> & {
    lookback: number;
};

const M5_WINDOW_BARS = 24;
const M5_STOP_LOOKBACK = 72;

const jsonClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function applyM5Base(definition: ComposedSignalDefinition) {
    (definition as ComposedSignalDefinition & { timeframe?: string }).timeframe = 'M5';
    definition.windowBars = M5_WINDOW_BARS;
    if (definition.stopLoss && typeof definition.stopLoss === 'object' && 'lookback' in definition.stopLoss) {
        (definition.stopLoss as StopLossWithLookback).lookback = M5_STOP_LOOKBACK;
    }
}

function getBlock(definition: ComposedSignalDefinition, indicatorId: string) {
    const block = definition.blocks.find((entry) => entry.indicatorId === indicatorId);
    if (!block) {
        throw new Error(`Missing indicator block ${indicatorId} in composed definition.`);
    }
    return block;
}

const VARIANTS: VariantSpec[] = [
    {
        id: 'BASE_SHORT',
        label: 'Base M5 SHORT (no extra mutations)',
        changeSummary: 'Base SHORT M5 definition with default ATR 1.2 expansion.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(_definition) {
            // No additional mutations beyond M5 base
        },
    },
    {
        id: 'B1_ATR135_SHORT',
        label: 'B1 - ATR 1.35 SHORT',
        changeSummary: 'Raise ATR expansion multiplier to 1.35 (mirror B1_ATR135_HARD LONG).',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            getBlock(definition, 'ATR_REGIME').conditionParams = { multiplier: 1.35 };
        },
    },
    {
        id: 'B4_TP25_SHORT',
        label: 'B4 - TP 2.5R SHORT',
        changeSummary: 'Set take profit to 2.5R with 72-bar stop lookback (mirror B4_TP25_HARD LONG).',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            definition.takeProfit = { type: 'R_MULTIPLE', value: 2.5 };
            if (definition.stopLoss && typeof definition.stopLoss === 'object' && 'lookback' in definition.stopLoss) {
                (definition.stopLoss as StopLossWithLookback).lookback = 72;
            }
        },
    },
    {
        id: 'B4_LOOKBACK96_SHORT',
        label: 'B4 - Lookback 96 SHORT',
        changeSummary: 'Set stop lookback to 96 bars with 2.0R TP (mirror B4_LOOKBACK96_HARD LONG).',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            definition.takeProfit = { type: 'R_MULTIPLE', value: 2.0 };
            if (definition.stopLoss && typeof definition.stopLoss === 'object' && 'lookback' in definition.stopLoss) {
                (definition.stopLoss as StopLossWithLookback).lookback = 96;
            }
        },
    },
];

function summarize(results: Array<{ isOpen: boolean; pnlUsd: number; rMultiple: number; win: boolean; maxDrawdownPct: number }>) {
    const closed = results.filter((row) => !row.isOpen);
    const netPnl = closed.reduce((sum, row) => sum + Number(row.pnlUsd), 0);
    const netR = closed.reduce((sum, row) => sum + Number(row.rMultiple), 0);
    const wins = closed.filter((row) => row.win).length;
    const maxDd = closed.length ? Math.min(...closed.map((row) => Number(row.maxDrawdownPct))) : 0;
    const grossWin = closed
        .filter((row) => Number(row.pnlUsd) > 0)
        .reduce((sum, row) => sum + Number(row.pnlUsd), 0);
    const grossLoss = Math.abs(closed
        .filter((row) => Number(row.pnlUsd) < 0)
        .reduce((sum, row) => sum + Number(row.pnlUsd), 0));

    return {
        trades: closed.length,
        netPnl: Number(netPnl.toFixed(2)),
        netR: Number(netR.toFixed(2)),
        winRate: closed.length ? Number(((wins / closed.length) * 100).toFixed(2)) : 0,
        maxDd: Number(maxDd.toFixed(2)),
        profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : null,
    } satisfies Summary;
}

function resolveSession(time: Date): string {
    const hour = time.getUTCHours();
    if (hour < 8) return 'ASIAN';
    if (hour < 13) return 'LONDON';
    return 'NY';
}

function sessionBreakdown(
    results: Array<{ isOpen: boolean; pnlUsd: number; rMultiple: number; win: boolean; maxDrawdownPct: number; entryTime: Date }>,
): Record<string, Summary> {
    const buckets: Record<string, typeof results> = {};
    for (const row of results) {
        const session = resolveSession(row.entryTime);
        (buckets[session] ??= []).push(row);
    }

    const out: Record<string, Summary> = {};
    for (const [session, rows] of Object.entries(buckets)) {
        out[session] = summarize(rows);
    }
    return out;
}

function yearlyBreakdown(
    results: Array<{ isOpen: boolean; pnlUsd: number; rMultiple: number; win: boolean; maxDrawdownPct: number; entryTime: Date }>,
): Record<string, Summary> {
    const buckets: Record<string, typeof results> = {};
    for (const row of results) {
        const year = String(row.entryTime.getUTCFullYear());
        (buckets[year] ??= []).push(row);
    }

    const out: Record<string, Summary> = {};
    for (const year of Object.keys(buckets).sort()) {
        out[year] = summarize(buckets[year]);
    }
    return out;
}

async function main() {
    const outPath = process.argv.includes('--out')
        ? process.argv[process.argv.indexOf('--out') + 1]
        : '.artifacts/opt-5-short-side/short-matrix-results.json';

    const baseSeed = getTier1ComposedSignalSeeds().find((seed) => seed.code === BASE_SIGNAL_CODE);
    if (!baseSeed) {
        throw new Error(`Base seed ${BASE_SIGNAL_CODE} was not found in tier1ComposedSignalSeeds.`);
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
    const allResults: ResultRow[] = [];

    try {
        console.log('=== OPT-5: SHORT Side Variant - Asian Low Break Continuation ===');
        console.log(`Base signal: ${BASE_SIGNAL_CODE}`);
        console.log(`Range: ${FROM.toISOString()} -> ${TO.toISOString()}`);
        console.log(`Variants: ${VARIANTS.length}`);
        console.log('');

        for (let i = 0; i < VARIANTS.length; i++) {
            const variant = VARIANTS[i];
            console.log(`\n[${i + 1}/${VARIANTS.length}] Running: ${variant.id}`);
            console.log(`  Label: ${variant.label}`);
            console.log(`  Exit profile: ${variant.exitProfile}`);

            const definition = jsonClone(baseSeed.composedBlocks) as ComposedSignalDefinition;
            applyM5Base(definition);
            variant.mutate(definition);
            definition.exitManagement = { profileCode: variant.exitProfile };

            const timeframe = String((definition as { timeframe?: string }).timeframe ?? 'M5');
            const tmpCode = `XAB_OPT5_${variant.id}`.toUpperCase().slice(0, 60);

            registry.register(new ComposedSignalPlugin(
                definition,
                blockRegistry,
                tmpCode,
                1,
                `OPT5 SHORT: ${variant.id}`,
            ));

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

                // Build entryTime map from signals (keyed by externalKey)
                const entryTimeMap = new Map<string, Date>();
                for (const sig of output.signals) {
                    if (sig.externalKey) {
                        entryTimeMap.set(sig.externalKey, sig.entryTime);
                    }
                }

                // Enrich results with entryTime for breakdown analysis
                const enrichedResults = output.results.map((r) => ({
                    isOpen: r.isOpen,
                    pnlUsd: r.pnlUsd,
                    rMultiple: r.rMultiple,
                    win: r.win,
                    maxDrawdownPct: r.maxDrawdownPct,
                    entryTime: entryTimeMap.get(r.signalExternalKey) ?? r.exitTime ?? new Date(0),
                }));

                const summary = summarize(enrichedResults);
                const sessions = sessionBreakdown(enrichedResults);
                const yearly = yearlyBreakdown(enrichedResults);

                allResults.push({
                    variantId: variant.id,
                    variantLabel: variant.label,
                    changeSummary: variant.changeSummary,
                    timeframe,
                    exitProfile: variant.exitProfile,
                    summary,
                    sessionBreakdown: sessions,
                    yearlyBreakdown: yearly,
                });

                console.log(`  => DONE: Trades=${summary.trades}, NetR=${summary.netR}, WR=${summary.winRate}%, PF=${summary.profitFactor}`);
            } finally {
                registry.unregister(tmpCode, 1);
            }
        }
    } finally {
        await prisma.$disconnect();
    }

    // Save results
    const outputFile = {
        generatedAt: new Date().toISOString(),
        group: 'opt5_short_side',
        groupLabel: 'OPT-5: SHORT Side Variant - Asian Low Break Continuation',
        symbol: SYMBOL,
        from: FROM.toISOString(),
        to: TO.toISOString(),
        initialEquity: INITIAL_EQUITY,
        riskPercent: RISK_PERCENT,
        executionConfig: DEFAULT_EXECUTION_CONFIG,
        baseSignalCode: BASE_SIGNAL_CODE,
        baseSignalName: baseSeed.name,
        results: allResults,
    };

    const resolvedPath = path.resolve(outPath);
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    fs.writeFileSync(resolvedPath, JSON.stringify(outputFile, null, 2));
    console.log(`\nSaved JSON output to ${resolvedPath}`);

    // Summary table
    console.log('\n=== OPT-5 SHORT Matrix Results ===');
    console.table(allResults.map((row) => ({
        Variant: row.variantId,
        Exit: row.exitProfile,
        Trades: row.summary.trades,
        NetR: row.summary.netR,
        WR: `${row.summary.winRate}%`,
        PF: row.summary.profitFactor,
        MaxDD: `${row.summary.maxDd}%`,
        NetPnL: row.summary.netPnl,
    })));

    // Session breakdown
    console.log('\n=== Session Breakdown ===');
    for (const row of allResults) {
        console.log(`\n--- ${row.variantId} ---`);
        console.table(Object.entries(row.sessionBreakdown).map(([session, s]) => ({
            Session: session,
            Trades: s.trades,
            NetR: s.netR,
            WR: `${s.winRate}%`,
            PF: s.profitFactor,
        })));
    }

    // Yearly breakdown
    console.log('\n=== Yearly Breakdown ===');
    for (const row of allResults) {
        console.log(`\n--- ${row.variantId} ---`);
        console.table(Object.entries(row.yearlyBreakdown).map(([year, s]) => ({
            Year: year,
            Trades: s.trades,
            NetR: s.netR,
            WR: `${s.winRate}%`,
            PF: s.profitFactor,
        })));
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exit(1);
});
