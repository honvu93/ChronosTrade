import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { TimeframeOptimizationEngine } from '../services/signals/optimization/TimeframeOptimizationEngine';
import { generateEntryVariants, generateGuardVariants, generateExitVariants, countVariants } from '../services/signals/optimization/TimeframeSearchConfig';
import { OptimizationRequest, OptimizationResult } from '../services/signals/optimization/optimizationTypes';
import { getTier1ComposedSignalSeeds } from '../services/signals/tier1ComposedSignals';
import { ComposedSignalDefinition } from '../services/signals/ComposedSignalPlugin';

dotenv.config();

// ─── Config ─────────────────────────────────────────────────────────────────

// Phase 3 batch: 6 strategy families on H1/H4 (M15/M30 excluded — structure strategies underperform on low TFs)
const SIGNALS = [
    'SYS_T1_OB_FIB_LONG',                    // OB + Fibonacci Golden Zone — WR=64% evidence
    'SYS_T1_SESSION_BURST_LONG',              // Session Burst — champion PF=1.86
    'SYS_4TF_CHOCH_BOS_LONG',                // CHoCH + BOS Structure Reversal
    'SYS_XAU_ASIAN_SWEEP_REVERSAL_LONG',     // Asian Session Sweep Reversal
    'SYS_XAU_PDL_SWEEP_RECLAIM_LONG',        // Previous Day Low Sweep Reclaim
    'SYS_4TF_LONDON_BURST_LONG',             // London Open Momentum Burst
] as const;
const TIMEFRAMES = ['H1', 'H4'] as const;

/**
 * Timeframe-specific adaptations for base signal definitions.
 * These set reasonable starting points; the L1 sweep optimizes
 * windowBars, SL ATR buffer, and SMC lookback from here.
 */
const TF_ADAPTATIONS: Record<string, {
    windowBars: number;
    stopLookback: number;
    stopValue: number;
    smcLookback: number;
}> = {
    M5:  { windowBars: 6,  stopLookback: 48, stopValue: 0.0010, smcLookback: 100 },
    M15: { windowBars: 5,  stopLookback: 36, stopValue: 0.0012, smcLookback: 80 },
    M30: { windowBars: 4,  stopLookback: 24, stopValue: 0.0015, smcLookback: 60 },
    H1:  { windowBars: 4,  stopLookback: 16, stopValue: 0.0018, smcLookback: 60 },
    H4:  { windowBars: 3,  stopLookback: 12, stopValue: 0.0025, smcLookback: 40 },
    D1:  { windowBars: 2,  stopLookback: 8,  stopValue: 0.0035, smcLookback: 20 },
};

// ─── CLI Args ───────────────────────────────────────────────────────────────

function parseArgs() {
    const args = process.argv.slice(2);
    const get = (flag: string) => {
        const idx = args.indexOf(flag);
        return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
    };
    const has = (flag: string) => args.includes(flag);

    return {
        signal: get('--signal'),          // optional: run only one signal
        timeframe: get('--timeframe'),    // optional: run only one TF
        layer: (get('--layer') ?? 'all') as 'entry' | 'guards' | 'exit' | 'all',
        split: parseInt(get('--split') ?? '70', 10),
        from: get('--from'),
        to: get('--to'),
        topN: parseInt(get('--top-n') ?? '5', 10),
        minTrades: get('--min-trades') ? parseInt(get('--min-trades')!, 10) : undefined,
        dryRun: has('--dry-run'),
    };
}

// ─── Mutation Helpers ───────────────────────────────────────────────────────

function buildMutationHelpers() {
    const findBlock = (def: any, indicatorId: string) =>
        def.blocks?.find((b: any) => b.indicatorId === indicatorId);

    const findAllBlocks = (def: any, indicatorId: string) =>
        (def.blocks ?? []).filter((b: any) => b.indicatorId === indicatorId);

    return {
        setRsiPeriod: (def: unknown, value: number) => {
            const block = findBlock(def, 'RSI');
            if (block) block.indicatorParams.period = value;
        },
        setRsiThreshold: (def: unknown, value: number) => {
            const block = findBlock(def, 'RSI');
            if (block) block.conditionParams = { ...block.conditionParams, threshold: value };
        },
        setSlAtrPeriod: (def: unknown, value: number) => {
            const d = def as any;
            if (d.stopLoss) d.stopLoss.atrPeriod = value;
        },
        setAtrBufferMultiplier: (def: unknown, value: number) => {
            const d = def as any;
            if (d.stopLoss && typeof d.stopLoss === 'object' && 'lookback' in d.stopLoss) {
                d.stopLoss.atrBufferMultiplier = value;
                d.stopLoss.atrPeriod = d.stopLoss.atrPeriod ?? 14;
            }
        },
        setEmaFilterPeriod: (def: unknown, value: number) => {
            // Target EMA_CROSS block (not MARKET_REGIME)
            const block = findBlock(def, 'EMA_CROSS');
            if (block) block.indicatorParams.slowPeriod = value;
        },
        setWindowBars: (def: unknown, value: number) => {
            (def as any).windowBars = value;
        },
        setSmcLookback: (def: unknown, value: number) => {
            // Set lookback on ALL SMC blocks (BOS + FVG share the same indicator)
            for (const block of findAllBlocks(def, 'SMC')) {
                block.indicatorParams.lookback = value;
            }
        },
        setFibLookback: (def: unknown, value: number) => {
            const block = findBlock(def, 'FIBONACCI');
            if (block) block.indicatorParams.lookback = value;
        },
        addSessionFilter: (def: unknown) => {
            const d = def as any;
            if (!d.blocks) return;
            const hasIt = d.blocks.some((b: any) => b.indicatorId === 'SESSION_FILTER');
            if (!hasIt) {
                d.blocks.push({
                    id: `session_opt_${d.blocks.length}`,
                    indicatorId: 'SESSION_FILTER',
                    conditionId: 'in_session',
                    indicatorParams: { startHour: 7, endHour: 17 },
                    conditionParams: {},
                });
            }
        },
        removeSessionFilter: (def: unknown) => {
            const d = def as any;
            if (!d.blocks) return;
            d.blocks = d.blocks.filter((b: any) => b.indicatorId !== 'SESSION_FILTER');
        },
    };
}

// ─── TF Adaptation ──────────────────────────────────────────────────────────

function adaptDefinitionForTimeframe(
    baseDef: ComposedSignalDefinition,
    timeframe: string,
): ComposedSignalDefinition {
    const def = JSON.parse(JSON.stringify(baseDef)) as ComposedSignalDefinition & { timeframe?: string };
    const adapt = TF_ADAPTATIONS[timeframe];
    if (!adapt) throw new Error(`No TF adaptation for: ${timeframe}`);

    // Set timeframe on definition
    def.timeframe = timeframe;

    // Adjust windowBars
    def.windowBars = adapt.windowBars;

    // Adjust stop loss
    if (def.stopLoss && typeof def.stopLoss === 'object') {
        const sl = def.stopLoss as any;
        if ('lookback' in sl) sl.lookback = adapt.stopLookback;
        if ('value' in sl) sl.value = adapt.stopValue;
    }

    // Adjust SMC lookback on all SMC blocks
    for (const block of def.blocks) {
        if (block.indicatorId === 'SMC') {
            block.indicatorParams = { ...block.indicatorParams, lookback: adapt.smcLookback };
        }
    }

    return def;
}

// ─── Summary Type ───────────────────────────────────────────────────────────

interface RunSummaryRow {
    signal: string;
    timeframe: string;
    winnerId: string;
    winnerLabel: string;
    trades: number;
    netPnl: number;
    netR: number;
    winRate: number;
    profitFactor: number | null;
    maxStreak: number;
    equityDdPct: number;
    durationSec: number;
    entryVariants: number;
    guardVariants: number;
    exitVariants: number;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
    const opts = parseArgs();

    const signalsToRun = opts.signal
        ? SIGNALS.filter((s) => s === opts.signal)
        : [...SIGNALS];
    const timeframesToRun = opts.timeframe
        ? TIMEFRAMES.filter((tf) => tf === opts.timeframe)
        : [...TIMEFRAMES];

    if (signalsToRun.length === 0) {
        console.error(`Signal not found. Available: ${SIGNALS.join(', ')}`);
        process.exit(1);
    }
    if (timeframesToRun.length === 0) {
        console.error(`Timeframe not found. Available: ${TIMEFRAMES.join(', ')}`);
        process.exit(1);
    }

    const seeds = getTier1ComposedSignalSeeds();
    const mutationHelpers = buildMutationHelpers();

    console.log(`\n${'═'.repeat(70)}`);
    console.log(`  Phase 3 — 6 Strategy Families × H1/H4 Optimization`);
    console.log(`  Signals:    ${signalsToRun.join(', ')}`);
    console.log(`  Timeframes: ${timeframesToRun.join(', ')}`);
    console.log(`  Layer:      ${opts.layer}`);
    console.log(`  Split:      ${opts.split}% train`);
    console.log(`${'═'.repeat(70)}\n`);

    // Dry run — count only
    if (opts.dryRun) {
        console.log('DRY RUN — variant counts per (signal, timeframe):\n');
        let grandTotal = 0;
        for (const signalCode of signalsToRun) {
            const seed = seeds.find((s) => s.code === signalCode);
            if (!seed) continue;
            const presentBlocks = new Set(
                (seed.composedBlocks.blocks ?? []).map((b: any) => b.indicatorId as string),
            );
            for (const tf of timeframesToRun) {
                const counts = countVariants(tf, presentBlocks);
                console.log(`  ${signalCode} @ ${tf.padEnd(3)} → entry=${counts.entry}  guards=${counts.guards}  exit=${counts.exit}  total=${counts.total}`);
                grandTotal += counts.total;
            }
        }
        console.log(`\n  Grand total: ${grandTotal} backtests`);
        return;
    }

    const prisma = new PrismaClient();
    const summaryRows: RunSummaryRow[] = [];
    const allResults: Array<{ signal: string; timeframe: string; result: OptimizationResult }> = [];

    try {
        const engine = new TimeframeOptimizationEngine(prisma);

        for (const signalCode of signalsToRun) {
            const seed = seeds.find((s) => s.code === signalCode);
            if (!seed) {
                console.error(`Seed not found: ${signalCode}`);
                continue;
            }

            const presentBlocks = new Set(
                (seed.composedBlocks.blocks ?? []).map((b: any) => b.indicatorId as string),
            );

            for (const tf of timeframesToRun) {
                console.log(`\n${'─'.repeat(70)}`);
                console.log(`  ${signalCode} @ ${tf}`);
                console.log(`  Blocks: ${[...presentBlocks].join(', ')}`);
                console.log(`${'─'.repeat(70)}`);

                // Adapt base definition for this timeframe
                const adaptedDef = adaptDefinitionForTimeframe(seed.composedBlocks as ComposedSignalDefinition, tf);

                // Generate variants
                const variants: {
                    entry?: ReturnType<typeof generateEntryVariants>;
                    guards?: ReturnType<typeof generateGuardVariants>;
                    exit?: ReturnType<typeof generateExitVariants>;
                } = {};

                if (opts.layer === 'entry' || opts.layer === 'all') {
                    variants.entry = generateEntryVariants(tf, presentBlocks, mutationHelpers);
                    console.log(`  L1 Entry variants: ${variants.entry.length}`);
                }
                if (opts.layer === 'guards' || opts.layer === 'all') {
                    variants.guards = generateGuardVariants(tf);
                    console.log(`  L2 Guard variants: ${variants.guards.length}`);
                }
                if (opts.layer === 'exit' || opts.layer === 'all') {
                    variants.exit = generateExitVariants(tf);
                    console.log(`  L3 Exit variants: ${variants.exit.length}`);
                }

                const request: OptimizationRequest = {
                    signalCode: signalCode,
                    signalVersion: 1,
                    symbol: (seed.composedBlocks as any).symbol ?? 'XAUUSD',
                    timeframe: tf,
                    layer: opts.layer,
                    trainValSplit: opts.split,
                    topN: opts.topN,
                    minTrades: opts.minTrades,
                    persist: false,
                    dryRun: false,
                    ...(opts.from && opts.to ? { dateRange: { from: new Date(opts.from), to: new Date(opts.to) } } : {}),
                };

                try {
                    const result = await engine.run(request, variants, adaptedDef);
                    allResults.push({ signal: signalCode, timeframe: tf, result });

                    const winner = result.finalWinner;
                    const durationSec = Number((result.durationMs / 1000).toFixed(1));

                    summaryRows.push({
                        signal: signalCode.replace('SYS_4TF_', ''),
                        timeframe: tf,
                        winnerId: winner.variantId,
                        winnerLabel: winner.variantLabel,
                        trades: winner.trainMetrics.trades,
                        netPnl: Number(winner.trainMetrics.netPnl.toFixed(2)),
                        netR: Number(winner.trainMetrics.netR.toFixed(2)),
                        winRate: Number(winner.trainMetrics.winRate.toFixed(1)),
                        profitFactor: winner.trainMetrics.profitFactor,
                        maxStreak: winner.trainMetrics.maxConsecutiveLosses,
                        equityDdPct: Number(winner.trainMetrics.equityCurveMaxDdPct.toFixed(1)),
                        durationSec,
                        entryVariants: variants.entry?.length ?? 0,
                        guardVariants: variants.guards?.length ?? 0,
                        exitVariants: variants.exit?.length ?? 0,
                    });

                    console.log(`  ✓ Winner: ${winner.variantLabel} | PF=${winner.trainMetrics.profitFactor?.toFixed(2) ?? 'N/A'} | WR=${winner.trainMetrics.winRate.toFixed(1)}% | ${durationSec}s`);
                } catch (err: any) {
                    console.error(`  ✗ FAILED: ${err.message}`);
                    summaryRows.push({
                        signal: signalCode.replace('SYS_4TF_', ''),
                        timeframe: tf,
                        winnerId: 'ERROR',
                        winnerLabel: err.message?.slice(0, 50) ?? 'Unknown error',
                        trades: 0, netPnl: 0, netR: 0, winRate: 0,
                        profitFactor: null, maxStreak: 0, equityDdPct: 0,
                        durationSec: 0, entryVariants: 0, guardVariants: 0, exitVariants: 0,
                    });
                }
            }
        }

        // ─── Save Artifacts ─────────────────────────────────────────────────

        const artifactDir = path.resolve('.artifacts/tf-optimization/Phase3_6Families');
        fs.mkdirSync(artifactDir, { recursive: true });

        // Save per-combination results
        for (const { signal, timeframe, result } of allResults) {
            const shortName = signal.replace('SYS_4TF_', '');
            const filename = `${shortName}_${timeframe}_${opts.layer}_${new Date().toISOString().slice(0, 10)}.json`;
            const filepath = path.join(artifactDir, filename);
            fs.writeFileSync(filepath, JSON.stringify(result, null, 2));
        }

        // Save summary
        const summaryFile = path.join(artifactDir, `summary_${opts.layer}_${new Date().toISOString().slice(0, 10)}.json`);
        fs.writeFileSync(summaryFile, JSON.stringify({ generatedAt: new Date().toISOString(), rows: summaryRows }, null, 2));

        // ─── Print Summary Table ────────────────────────────────────────────

        console.log(`\n${'═'.repeat(100)}`);
        console.log('  OPTIMIZATION RESULTS SUMMARY');
        console.log(`${'═'.repeat(100)}`);
        console.log(
            '  Signal'.padEnd(22) +
            'TF'.padEnd(5) +
            'Trades'.padEnd(8) +
            'PF'.padEnd(8) +
            'WR%'.padEnd(8) +
            'NetR'.padEnd(10) +
            'Streak'.padEnd(8) +
            'EqDD%'.padEnd(8) +
            'Winner',
        );
        console.log(`  ${'─'.repeat(96)}`);

        for (const row of summaryRows) {
            const pfStr = row.profitFactor !== null ? row.profitFactor.toFixed(2) : 'N/A';
            console.log(
                `  ${row.signal.padEnd(20)}` +
                `${row.timeframe.padEnd(5)}` +
                `${String(row.trades).padEnd(8)}` +
                `${pfStr.padEnd(8)}` +
                `${row.winRate.toFixed(1).padEnd(8)}` +
                `${row.netR.toFixed(1).padEnd(10)}` +
                `${String(row.maxStreak).padEnd(8)}` +
                `${row.equityDdPct.toFixed(1).padEnd(8)}` +
                `${row.winnerLabel.slice(0, 35)}`,
            );
        }

        console.log(`\n  Artifacts: ${artifactDir}`);
        console.log(`  Summary:   ${summaryFile}`);

    } finally {
        await prisma.$disconnect();
    }
}

main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
