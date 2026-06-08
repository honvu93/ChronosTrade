/**
 * runAllTier1BatchBacktest.ts
 *
 * Queries existing completed backtest results for all tier-1 signals,
 * computes per-signal metrics, and ranks them by a composite score:
 *   composite = freq_norm × 0.4 + pf_norm × 0.35 + dd_norm × 0.25
 *
 * Where:
 *   freq_norm  = tradesPerDay / max(tradesPerDay) across all results
 *   pf_norm    = min(profitFactor, 10) / 10
 *   dd_norm    = 1 - (|maxDrawdownPct| / 100)
 *
 * Live-eligible threshold: PF >= 1.5, drawdown >= -8%, closed trades >= 10
 *
 * Usage:
 *   ts-node src/scripts/runAllTier1BatchBacktest.ts
 *   ts-node src/scripts/runAllTier1BatchBacktest.ts --target-trades-per-day=5
 *   ts-node src/scripts/runAllTier1BatchBacktest.ts --min-pf=1.5 --max-dd=8
 */

import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { getTier1ComposedSignalSeeds } from '../services/signals/tier1ComposedSignals';

dotenv.config();

const MIN_PF_LIVE = 1.5;
const MAX_DD_LIVE_PCT = 8.0; // absolute value — drawdown worse than -8% is blocked
const MIN_TRADES_LIVE = 10;

interface CliOptions {
    targetTradesPerDay: number;
    minPf: number;
    maxDd: number;
}

function parseArgs(argv: string[]): CliOptions {
    let targetTradesPerDay = 5;
    let minPf = MIN_PF_LIVE;
    let maxDd = MAX_DD_LIVE_PCT;

    for (const arg of argv) {
        if (arg === '--help' || arg === '-h') {
            console.log('Usage: ts-node src/scripts/runAllTier1BatchBacktest.ts [options]');
            console.log('  --target-trades-per-day=5   Combined target for portfolio (default: 5)');
            console.log('  --min-pf=1.5                Min profit factor for live eligibility (default: 1.5)');
            console.log('  --max-dd=8                  Max drawdown % for live eligibility (default: 8)');
            process.exit(0);
        }
        if (arg.startsWith('--target-trades-per-day=')) {
            targetTradesPerDay = Math.max(1, Number(arg.split('=')[1]) || 5);
        } else if (arg.startsWith('--min-pf=')) {
            minPf = Math.max(0, Number(arg.split('=')[1]) || MIN_PF_LIVE);
        } else if (arg.startsWith('--max-dd=')) {
            maxDd = Math.max(0, Number(arg.split('=')[1]) || MAX_DD_LIVE_PCT);
        }
    }

    return { targetTradesPerDay, minPf, maxDd };
}

interface BacktestMetrics {
    signalCode: string;
    signalVersion: number;
    symbol: string;
    timeframe: string;
    backtestRunId: string;
    dateRange: string;
    closedTrades: number;
    wins: number;
    winRate: number;
    profitFactor: number;
    netR: number;
    maxDrawdownPct: number; // negative value e.g. -5.2
    tradingDays: number;
    tradesPerDay: number;
    compositeScore: number;
    liveEligible: boolean;
}

function round(value: number, decimals = 2): number {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const prisma = new PrismaClient();

    try {
        const seeds = getTier1ComposedSignalSeeds();
        const signalCodes = seeds.map((s) => s.code);

        console.log(`[BatchRank] Querying backtest results for ${signalCodes.length} tier-1 signals...`);

        // Find the latest completed BacktestRun per (signalCode, symbol, timeframe)
        const runs = await prisma.backtestRun.findMany({
            where: {
                signalCode: { in: signalCodes },
                status: 'COMPLETED',
            },
            select: {
                id: true,
                signalCode: true,
                signalVersion: true,
                symbol: true,
                timeframe: true,
                startedAt: true,
                finishedAt: true,
                createdAt: true,
                results: {
                    select: {
                        win: true,
                        isOpen: true,
                        rMultiple: true,
                        maxDrawdownPct: true,
                    },
                },
            },
            orderBy: {
                createdAt: 'desc',
            },
        });

        // Deduplicate: keep the most recent run per (signalCode, symbol, timeframe)
        const latestByKey = new Map<string, typeof runs[number]>();
        for (const run of runs) {
            const key = `${run.signalCode}|${run.symbol}|${run.timeframe}`;
            if (!latestByKey.has(key)) {
                latestByKey.set(key, run);
            }
        }

        const metrics: BacktestMetrics[] = [];

        for (const run of latestByKey.values()) {
            const closed = run.results.filter((r) => !r.isOpen);
            if (closed.length === 0) continue;

            const wins = closed.filter((r) => r.win).length;
            const winRate = round(wins / closed.length * 100);
            const winNetR = closed.filter((r) => r.win).reduce((sum, r) => sum + Number(r.rMultiple), 0);
            const lossNetR = closed.filter((r) => !r.win).reduce((sum, r) => sum + Math.abs(Number(r.rMultiple)), 0);
            const profitFactor = lossNetR === 0
                ? (winNetR > 0 ? 99 : 0)
                : round(winNetR / lossNetR);
            const netR = round(closed.reduce((sum, r) => sum + Number(r.rMultiple), 0));
            const maxDrawdownPct = run.results.length > 0
                ? round(Math.min(...run.results.map((r) => Number(r.maxDrawdownPct))))
                : 0;

            const startMs = run.startedAt.getTime();
            const endMs = run.finishedAt ? run.finishedAt.getTime() : run.createdAt.getTime();
            const tradingDays = Math.max(1, round((endMs - startMs) / (1000 * 60 * 60 * 24), 1));
            const tradesPerDay = round(closed.length / tradingDays, 3);

            const liveEligible = profitFactor >= options.minPf
                && Math.abs(maxDrawdownPct) <= options.maxDd
                && closed.length >= MIN_TRADES_LIVE;

            const dateRange = `${run.startedAt.toISOString().slice(0, 10)}..${run.finishedAt?.toISOString().slice(0, 10) ?? '?'}`;

            metrics.push({
                signalCode: run.signalCode ?? '',
                signalVersion: run.signalVersion ?? 0,
                symbol: run.symbol,
                timeframe: run.timeframe,
                backtestRunId: run.id,
                dateRange,
                closedTrades: closed.length,
                wins,
                winRate,
                profitFactor,
                netR,
                maxDrawdownPct,
                tradingDays,
                tradesPerDay,
                compositeScore: 0, // computed after normalization
                liveEligible,
            });
        }

        if (metrics.length === 0) {
            console.log('[BatchRank] No completed backtest results found for tier-1 signals.');
            console.log('Run executeTier1BacktestMatrix.ts first to generate results.');
            return;
        }

        // Normalize and compute composite score
        const maxTradesPerDay = Math.max(...metrics.map((m) => m.tradesPerDay), 0.001);
        for (const m of metrics) {
            const freqNorm = m.tradesPerDay / maxTradesPerDay;
            const pfNorm = Math.min(m.profitFactor, 10) / 10;
            const ddNorm = 1 - (Math.abs(m.maxDrawdownPct) / 100);
            m.compositeScore = round(freqNorm * 0.4 + pfNorm * 0.35 + ddNorm * 0.25, 4);
        }

        // Sort: live-eligible first, then by composite score descending
        metrics.sort((a, b) => {
            if (a.liveEligible !== b.liveEligible) return a.liveEligible ? -1 : 1;
            return b.compositeScore - a.compositeScore;
        });

        // Output table
        const ELIGIBLE_LABEL = 'LIVE';
        const col = (s: string | number, width: number) => String(s).padStart(width);
        const colL = (s: string | number, width: number) => String(s).padEnd(width);

        console.log('');
        console.log('═'.repeat(130));
        console.log(
            colL('SIGNAL', 40) +
            colL('SYMBOL', 8) +
            col('TF', 5) +
            col('TRADES', 7) +
            col('WIN%', 6) +
            col('PF', 6) +
            col('NetR', 7) +
            col('DD%', 7) +
            col('TPD', 6) +
            col('SCORE', 7) +
            col('STATUS', 8),
        );
        console.log('─'.repeat(130));

        let eligibleCount = 0;
        let combinedTradesPerDay = 0;

        for (const m of metrics) {
            const eligibleStr = m.liveEligible ? ELIGIBLE_LABEL : '    -';
            if (m.liveEligible) {
                eligibleCount += 1;
                combinedTradesPerDay += m.tradesPerDay;
            }

            console.log(
                colL(`${m.signalCode}@v${m.signalVersion}`, 40) +
                colL(m.symbol, 8) +
                col(m.timeframe, 5) +
                col(m.closedTrades, 7) +
                col(`${m.winRate}%`, 6) +
                col(m.profitFactor, 6) +
                col(m.netR, 7) +
                col(`${m.maxDrawdownPct}%`, 7) +
                col(m.tradesPerDay, 6) +
                col(m.compositeScore, 7) +
                col(eligibleStr, 8),
            );
        }

        console.log('═'.repeat(130));

        // Summary
        const noDataSignals = signalCodes.filter(
            (code) => !metrics.some((m) => m.signalCode === code),
        );

        console.log('');
        console.log('[BatchRank] Summary');
        console.log(`  Total signals with data : ${metrics.length}`);
        console.log(`  Live-eligible signals   : ${eligibleCount} (PF >= ${options.minPf}, DD <= -${options.maxDd}%, trades >= ${MIN_TRADES_LIVE})`);
        console.log(`  Combined trades/day     : ${round(combinedTradesPerDay)} (target: ${options.targetTradesPerDay})`);
        if (noDataSignals.length > 0) {
            console.log(`  Missing data (${noDataSignals.length}): ${noDataSignals.join(', ')}`);
            console.log('  → Run executeTier1BacktestMatrix.ts to generate missing results.');
        }

        // Portfolio recommendation
        console.log('');
        console.log('[BatchRank] Portfolio to reach target');
        const eligible = metrics.filter((m) => m.liveEligible);

        if (eligible.length === 0) {
            console.log('  No live-eligible signals found.');
        } else {
            let cumTrades = 0;
            const selected: BacktestMetrics[] = [];
            for (const m of eligible) {
                selected.push(m);
                cumTrades += m.tradesPerDay;
                if (cumTrades >= options.targetTradesPerDay) break;
            }

            console.log(`  Signals needed to reach ${options.targetTradesPerDay} trades/day: ${selected.length}`);
            for (const m of selected) {
                console.log(`    ${m.signalCode}@v${m.signalVersion} ${m.symbol} ${m.timeframe} — ${m.tradesPerDay} tpd, PF ${m.profitFactor}, DD ${m.maxDrawdownPct}%`);
            }
            console.log(`  Combined: ${round(cumTrades)} trades/day`);
            console.log('');
            console.log('  Next: run setupPaperPortfolio.ts with the signal codes above.');
        }
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exit(1);
});
