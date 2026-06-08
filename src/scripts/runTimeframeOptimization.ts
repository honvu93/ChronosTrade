import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { TimeframeOptimizationEngine } from '../services/signals/optimization/TimeframeOptimizationEngine';
import { generateEntryVariants, generateGuardVariants, generateExitVariants, countVariants } from '../services/signals/optimization/TimeframeSearchConfig';
import { OptimizationRequest } from '../services/signals/optimization/optimizationTypes';
import { getTier1ComposedSignalSeeds } from '../services/signals/tier1ComposedSignals';
import { setRsiThreshold, setAtrBufferMultiplier, setStopLookback, getBlock } from './metalOptimizationHarness';

dotenv.config();

// ─── CLI Args ────────────────────────────────────────────────────────────────

function parseArgs() {
    const args = process.argv.slice(2);
    const get = (flag: string) => {
        const idx = args.indexOf(flag);
        return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
    };
    const has = (flag: string) => args.includes(flag);

    return {
        signal: get('--signal'),
        timeframe: get('--timeframe'),
        layer: (get('--layer') ?? 'all') as 'entry' | 'guards' | 'exit' | 'all',
        persist: has('--persist'),
        split: parseInt(get('--split') ?? '70', 10),
        from: get('--from'),
        to: get('--to'),
        topN: parseInt(get('--top-n') ?? '5', 10),
        minTrades: get('--min-trades') ? parseInt(get('--min-trades')!, 10) : undefined,
        variantFrom: get('--variant-from') ? parseInt(get('--variant-from')!, 10) : undefined,
        variantTo: get('--variant-to') ? parseInt(get('--variant-to')!, 10) : undefined,
        dryRun: has('--dry-run'),
    };
}

// ─── Mutation Helpers Adapter ────────────────────────────────────────────────
// These adapt the metalOptimizationHarness functions to the interface expected
// by TimeframeSearchConfig.generateEntryVariants()

function buildMutationHelpers() {
    return {
        setRsiPeriod: (def: unknown, value: number) => {
            try { getBlock(def as any, 'RSI').indicatorParams.period = value; } catch { /* block not present */ }
        },
        setRsiThreshold: (def: unknown, value: number) => {
            setRsiThreshold(def as any, value);
        },
        setSlAtrPeriod: (def: unknown, value: number) => {
            const d = def as any;
            if (d.stopLoss) d.stopLoss.atrPeriod = value;
        },
        setAtrBufferMultiplier: (def: unknown, value: number) => {
            setAtrBufferMultiplier(def as any, value);
        },
        setEmaFilterPeriod: (def: unknown, value: number) => {
            try { getBlock(def as any, 'MARKET_REGIME').indicatorParams.emaFilterPeriod = value; } catch { /* block not present */ }
        },
        setWindowBars: (def: unknown, value: number) => {
            (def as any).windowBars = value;
        },
        setSmcLookback: (def: unknown, value: number) => {
            try { getBlock(def as any, 'SMC').indicatorParams.lookback = value; } catch { /* block not present */ }
        },
        setFibLookback: (def: unknown, value: number) => {
            try { getBlock(def as any, 'FIBONACCI').indicatorParams.lookback = value; } catch { /* block not present */ }
        },
        addSessionFilter: (def: unknown) => {
            const d = def as any;
            if (!d.blocks) return;
            const hasIt = d.blocks.some((b: any) => b.indicatorId === 'SESSION_FILTER');
            if (!hasIt) {
                d.blocks.push({ indicatorId: 'SESSION_FILTER', conditionId: 'in_session', indicatorParams: {}, conditionParams: {} });
            }
        },
        removeSessionFilter: (def: unknown) => {
            const d = def as any;
            if (!d.blocks) return;
            d.blocks = d.blocks.filter((b: any) => b.indicatorId !== 'SESSION_FILTER');
        },
    };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
    const opts = parseArgs();

    if (!opts.signal) {
        console.error('Error: --signal is required');
        console.log('\nUsage:');
        console.log('  npx ts-node src/scripts/runTimeframeOptimization.ts --signal XAU_SMC_LONG --timeframe M5 --layer all');
        console.log('\nOptions:');
        console.log('  --signal <code>      Signal definition code (required)');
        console.log('  --timeframe <tf>     M5, M15, M30, H1, H4, D1 (required)');
        console.log('  --layer <layer>      entry, guards, exit, all (default: all)');
        console.log('  --persist            Save winner to DB');
        console.log('  --split <pct>        Train set percentage (default: 70)');
        console.log('  --from <date>        Date range start (YYYY-MM-DD)');
        console.log('  --to <date>          Date range end (YYYY-MM-DD)');
        console.log('  --top-n <n>          Show top N results (default: 5)');
        console.log('  --dry-run            Count variants only');
        process.exit(1);
    }
    if (!opts.timeframe) {
        console.error('Error: --timeframe is required');
        process.exit(1);
    }

    // Detect present blocks from signal seed
    const seeds = getTier1ComposedSignalSeeds();
    const seed = seeds.find((s) => s.code === opts.signal);
    if (!seed) {
        console.error(`Signal seed not found: ${opts.signal}`);
        console.log('Available seeds:', seeds.map((s) => s.code).join(', '));
        process.exit(1);
    }

    const presentBlocks = new Set(
        (seed.composedBlocks.blocks ?? []).map((b: any) => b.indicatorId as string),
    );

    console.log(`\n═══ TIMEFRAME OPTIMIZATION: ${opts.signal} @ ${opts.timeframe} ═══`);
    console.log(`  Blocks present: ${[...presentBlocks].join(', ')}`);

    // Dry run — count only
    if (opts.dryRun) {
        const counts = countVariants(opts.timeframe, presentBlocks);
        console.log(`\n  Dry run — variant counts:`);
        console.log(`    L1 Entry:  ${counts.entry}`);
        console.log(`    L2 Guards: ${counts.guards}`);
        console.log(`    L3 Exit:   ${counts.exit}`);
        console.log(`    Total:     ${counts.total}`);
        console.log(`\n═══════════════════════════════════════════════`);
        return;
    }

    const prisma = new PrismaClient();

    try {
        const engine = new TimeframeOptimizationEngine(prisma);
        const mutationHelpers = buildMutationHelpers();

        // Generate variants based on layer
        const variants: {
            entry?: ReturnType<typeof generateEntryVariants>;
            guards?: ReturnType<typeof generateGuardVariants>;
            exit?: ReturnType<typeof generateExitVariants>;
        } = {};

        if (opts.layer === 'entry' || opts.layer === 'all') {
            let allEntry = generateEntryVariants(opts.timeframe, presentBlocks, mutationHelpers);
            if (opts.variantFrom !== undefined || opts.variantTo !== undefined) {
                const vFrom = opts.variantFrom ?? 0;
                const vTo = opts.variantTo ?? allEntry.length;
                console.log(`  Slicing entry variants: [${vFrom}..${vTo}) of ${allEntry.length}`);
                allEntry = allEntry.slice(vFrom, vTo);
            }
            variants.entry = allEntry;
            console.log(`  Entry variants: ${variants.entry.length}`);
        }
        if (opts.layer === 'guards' || opts.layer === 'all') {
            let allGuards = generateGuardVariants(opts.timeframe);
            if (opts.variantFrom !== undefined || opts.variantTo !== undefined) {
                const vFrom = opts.variantFrom ?? 0;
                const vTo = opts.variantTo ?? allGuards.length;
                allGuards = allGuards.slice(vFrom, vTo);
            }
            variants.guards = allGuards;
            console.log(`  Guard variants: ${variants.guards.length}`);
        }
        if (opts.layer === 'exit' || opts.layer === 'all') {
            let allExit = generateExitVariants(opts.timeframe);
            if (opts.variantFrom !== undefined || opts.variantTo !== undefined) {
                const vFrom = opts.variantFrom ?? 0;
                const vTo = opts.variantTo ?? allExit.length;
                allExit = allExit.slice(vFrom, vTo);
            }
            variants.exit = allExit;
            console.log(`  Exit variants: ${variants.exit.length}`);
        }

        const request: OptimizationRequest = {
            signalCode: opts.signal,
            signalVersion: 1,
            symbol: seed.composedBlocks.symbol ?? 'XAUUSD',
            timeframe: opts.timeframe,
            layer: opts.layer,
            trainValSplit: opts.split,
            topN: opts.topN,
            minTrades: opts.minTrades,
            persist: opts.persist,
            dryRun: false,
            ...(opts.from && opts.to ? { dateRange: { from: new Date(opts.from), to: new Date(opts.to) } } : {}),
        };

        const result = await engine.run(request, variants);

        // Print final summary
        const durationSec = (result.durationMs / 1000).toFixed(1);
        console.log(`\n═══ COMPLETE (${durationSec}s) ═══════════════════════`);

        // Save artifact
        const artifactDir = path.resolve('.artifacts/tf-optimization', opts.signal);
        fs.mkdirSync(artifactDir, { recursive: true });
        const rangeSuffix = (opts.variantFrom !== undefined || opts.variantTo !== undefined)
            ? `_v${opts.variantFrom ?? 0}-${opts.variantTo ?? 'end'}`
            : '';
        const filename = `${opts.timeframe}_${opts.layer}${rangeSuffix}_${new Date().toISOString().slice(0, 10)}.json`;
        const filepath = path.join(artifactDir, filename);
        fs.writeFileSync(filepath, JSON.stringify(result, null, 2));
        console.log(`  Artifact saved: ${filepath}`);

        if (opts.persist && result.finalWinner.variantId !== 'NONE') {
            console.log('  TODO: Persist winner to DB');
        }

    } finally {
        await prisma.$disconnect();
    }
}

main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
