import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import {
    CorrelationService,
    CorrelationReport,
    PairwiseCorrelation,
} from '../services/signals/optimization/CorrelationService';

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
        symbol: get('--symbol') ?? 'XAUUSD',
        timeframe: get('--timeframe') ?? 'M5',
        threshold: parseFloat(get('--threshold') ?? '0.7'),
        topN: parseInt(get('--top-n') ?? '10', 10),
        save: has('--save'),
    };
}

// ─── Output Formatting ──────────────────────────────────────────────────────

function printReport(report: CorrelationReport, topN: number) {
    const { symbol, timeframe, runCount, matrix, clusters, diversityScore } = report;

    console.log('');
    console.log(`═══ CORRELATION ANALYSIS: ${symbol} @ ${timeframe} ═══`);
    console.log(`  Runs analyzed: ${runCount}`);
    console.log(`  Pairwise comparisons: ${matrix.length}`);
    console.log(`  Clusters found: ${clusters.length}`);
    console.log(`  Diversity score: ${diversityScore} (1.0 = fully diverse, 0.0 = identical)`);
    console.log('');

    // ── Clusters ──
    console.log('── Clusters ──────────────────────────────────────────');
    for (const cluster of clusters) {
        const rep = cluster.representative;
        console.log(`  Cluster ${cluster.id}: ${cluster.runIds.length} run(s)`);
        console.log(`    Representative: ${rep.signalCode ?? rep.runId.slice(0, 8)} (PF=${rep.profitFactor.toFixed(2)})`);
        if (cluster.runIds.length > 1) {
            console.log(`    Members: ${cluster.runIds.map((id) => id.slice(0, 8)).join(', ')}`);
        }
    }
    console.log('');

    // ── Top correlated pairs ──
    const sorted = [...matrix].sort((a, b) => b.avgCorrelation - a.avgCorrelation);
    const topPairs = sorted.slice(0, topN);

    console.log(`── Top ${topN} Most Correlated Pairs ─────────────────`);
    console.log('  %-8s  %-8s  Overlap  EqCorr  DDCorr  Avg', 'Run A', 'Run B');
    for (const p of topPairs) {
        console.log(
            `  ${p.runIdA.slice(0, 8)}  ${p.runIdB.slice(0, 8)}  ${pct(p.tradeOverlapPct)}  ${pct(p.equityCurveCorrelation)}  ${pct(p.concurrentDrawdownPct)}  ${pct(p.avgCorrelation)}`,
        );
    }
    console.log('');

    // ── Least correlated pairs ──
    const leastPairs = sorted.slice(-Math.min(topN, sorted.length)).reverse();
    console.log(`── Top ${topN} Least Correlated Pairs ─────────────────`);
    console.log('  %-8s  %-8s  Overlap  EqCorr  DDCorr  Avg', 'Run A', 'Run B');
    for (const p of leastPairs) {
        console.log(
            `  ${p.runIdA.slice(0, 8)}  ${p.runIdB.slice(0, 8)}  ${pct(p.tradeOverlapPct)}  ${pct(p.equityCurveCorrelation)}  ${pct(p.concurrentDrawdownPct)}  ${pct(p.avgCorrelation)}`,
        );
    }
    console.log('');

    // ── Summary ──
    const avgOverlap = avg(matrix.map((m) => m.tradeOverlapPct));
    const avgEqCorr = avg(matrix.map((m) => m.equityCurveCorrelation));
    const avgDdCorr = avg(matrix.map((m) => m.concurrentDrawdownPct));
    const avgAll = avg(matrix.map((m) => m.avgCorrelation));

    console.log('── Averages Across All Pairs ────────────────────────');
    console.log(`  Trade Overlap:      ${pct(avgOverlap)}`);
    console.log(`  Equity Curve Corr:  ${pct(avgEqCorr)}`);
    console.log(`  Drawdown Overlap:   ${pct(avgDdCorr)}`);
    console.log(`  Combined Avg:       ${pct(avgAll)}`);
    console.log('');

    // ── Verdict ──
    console.log('── Verdict ─────────────────────────────────────────');
    if (clusters.length >= 5) {
        console.log(`  ✓ ${clusters.length} distinct clusters — sufficient diversity for portfolio`);
    } else if (clusters.length >= 3) {
        console.log(`  ⚠ ${clusters.length} clusters — may need new strategies (Phase 4) to reach 5`);
    } else {
        console.log(`  ✗ Only ${clusters.length} cluster(s) — most strategies are correlated. Phase 4 (new strategies) is critical.`);
    }
    console.log('═══════════════════════════════════════════════════');
    console.log('');
}

function pct(v: number): string {
    return `${(v * 100).toFixed(1)}%`.padStart(6);
}

function avg(values: number[]): number {
    return values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
    const opts = parseArgs();
    console.log(`\nCorrelation Analysis: ${opts.symbol} @ ${opts.timeframe} (threshold=${opts.threshold})`);

    const prisma = new PrismaClient();

    try {
        const service = new CorrelationService(prisma);

        console.log('Loading trades from DB...');
        const runTrades = await service.loadRunTrades(opts.symbol, opts.timeframe);
        console.log(`  Found ${runTrades.length} runs with ≥10 closed trades`);

        if (runTrades.length < 2) {
            console.log('  Not enough runs for correlation analysis (need ≥2). Exiting.');
            return;
        }

        console.log('Computing correlation matrix...');
        const report = service.computeCorrelationReport(
            runTrades,
            opts.symbol,
            opts.timeframe,
            opts.threshold,
        );

        printReport(report, opts.topN);

        if (opts.save) {
            const artifactDir = path.resolve('.artifacts/correlation');
            fs.mkdirSync(artifactDir, { recursive: true });

            const filename = `${opts.symbol}_${opts.timeframe}_${new Date().toISOString().slice(0, 10)}.json`;
            const filepath = path.join(artifactDir, filename);

            const serializable = {
                ...report,
                matrix: report.matrix.map((p) => ({
                    ...p,
                    runIdA: p.runIdA,
                    runIdB: p.runIdB,
                })),
            };
            fs.writeFileSync(filepath, JSON.stringify(serializable, null, 2));
            console.log(`Saved report: ${filepath}`);
        }
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
