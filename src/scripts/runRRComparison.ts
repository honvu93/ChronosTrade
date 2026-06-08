import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { SignalBacktestExecutionService } from '../services/signals/SignalBacktestExecutionService';
import { SignalBacktestRunService } from '../services/signals/SignalBacktestRunService';
import { createDefaultBlockRegistry } from '../services/signals/blocks/createDefaultBlockRegistry';
import { ExecutionConfigInput } from '../services/signals/types';
import { upsertTier1ComposedSignals } from '../services/signals/tier1ComposedSignals';

dotenv.config();

// ─── Config ──────────────────────────────────────────────────────────────────

const DATE_FROM = '2019-01-01T00:00:00.000Z';
const DATE_TO = '2026-03-14T23:59:59.999Z';
const INITIAL_EQUITY = 10000;
const RISK_PERCENT = 1.5;

const BASE_EXEC: ExecutionConfigInput = {
    entryFeeBps: 4, exitFeeBps: 4, entrySlippageBps: 2, exitSlippageBps: 2,
    orderTiming: 'NEXT_BAR_OPEN',
    stopLoss: { mode: 'SIGNAL_PRICE' },
    takeProfit: { mode: 'SIGNAL_PRICE' },
    positionSizing: { mode: 'RISK_BASED' },
};

interface StrategySpec {
    signalCode: string;
    signalVersion: number;
    timeframe: string;
    shortLabel: string;
}

const STRATEGIES: StrategySpec[] = [
    {
        signalCode: 'SYS_4TF_PD_LEVEL_BREAK_LONG',
        signalVersion: 2,
        timeframe: '4h',
        shortLabel: 'PD Level Break v2',
    },
    {
        signalCode: 'SYS_4TF_PD_LEVEL_BREAK_LONG_H4',
        signalVersion: 1,
        timeframe: '4h',
        shortLabel: 'PD Level Break H4-opt',
    },
    {
        signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG',
        signalVersion: 1,
        timeframe: '2h',
        shortLabel: 'Asian Break',
    },
];

interface RRVariant {
    label: string;
    rrTag: string;
    /** Exit strategy code passed via parameters.exitStrategy */
    exitStrategy: string;
}

const RR_VARIANTS: RRVariant[] = [
    {
        label: '1:1 (TP=1R)',
        rrTag: 'R:R 1:1',
        exitStrategy: 'FIXED_1R',
    },
    {
        label: '1:2 (TP=2R)',
        rrTag: 'R:R 1:2',
        exitStrategy: 'FIXED_2R',
    },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function computeEquityDD(trades: Array<{ pnlUsd: number }>, initialEquity: number) {
    let equity = initialEquity, peak = equity, maxDd = 0;
    for (const t of trades) {
        equity += t.pnlUsd;
        if (equity > peak) peak = equity;
        const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
        if (dd > maxDd) maxDd = dd;
    }
    return Math.round(maxDd * 10000) / 10000;
}

function computeMaxConsecLosses(trades: Array<{ win: boolean }>) {
    let max = 0, cur = 0;
    for (const t of trades) { if (!t.win) { cur++; if (cur > max) max = cur; } else cur = 0; }
    return max;
}

interface TradeRow {
    pnlUsd: number;
    rMultiple: number;
    win: boolean;
    isOpen: boolean;
    exitTime: Date | null;
}

interface Metrics {
    runId: string;
    trades: number;
    winRate: number;
    profitFactor: number | null;
    netPnl: number;
    equityDD: number;
    avgR: number;
    expectancy: number;
    tradesPerYear: number;
    maxConsecLosses: number;
}

function computeMetrics(runId: string, rows: TradeRow[]): Metrics {
    const closed = rows.filter(r => !r.isOpen);
    const wins = closed.filter(r => r.win).length;
    const netPnl = closed.reduce((s, r) => s + r.pnlUsd, 0);
    const grossW = closed.filter(r => r.win).reduce((s, r) => s + r.pnlUsd, 0);
    const grossL = Math.abs(closed.filter(r => !r.win).reduce((s, r) => s + r.pnlUsd, 0));
    const pf = grossL > 0 ? Math.round((grossW / grossL) * 100) / 100 : null;
    const wr = closed.length > 0 ? Math.round((wins / closed.length) * 10000) / 100 : 0;
    const eqDD = computeEquityDD(closed.map(r => ({ pnlUsd: r.pnlUsd })), INITIAL_EQUITY);
    const streak = computeMaxConsecLosses(closed.map(r => ({ win: r.win })));
    const avgR = closed.length > 0 ? Math.round(closed.reduce((s, r) => s + r.rMultiple, 0) / closed.length * 10000) / 10000 : 0;
    const expectancy = closed.length > 0 ? Math.round(netPnl / closed.length * 100) / 100 : 0;

    // trades per year: date range 2019-01-01 to 2026-03-14 = ~7.2 years
    const years = 7.2;
    const tradesPerYear = closed.length > 0 ? Math.round(closed.length / years * 10) / 10 : 0;

    return { runId, trades: closed.length, winRate: wr, profitFactor: pf, netPnl: Math.round(netPnl * 100) / 100, equityDD: eqDD, avgR, expectancy, tradesPerYear, maxConsecLosses: streak };
}

async function loadTradesForRun(prisma: PrismaClient, backtestRunId: string): Promise<TradeRow[]> {
    const rows = await prisma.backtestTradeResult.findMany({
        where: { backtestRunId },
        select: { pnlUsd: true, rMultiple: true, win: true, isOpen: true, exitTime: true },
        orderBy: { exitTime: 'asc' },
    });
    return rows.map(r => ({
        pnlUsd: Number(r.pnlUsd),
        rMultiple: Number(r.rMultiple),
        win: r.win,
        isOpen: r.isOpen,
        exitTime: r.exitTime,
    }));
}

// ─── Main ────────────────────────────────────────────────────────────────────

interface ResultRow {
    strategy: string;
    timeframe: string;
    rrConfig: string;
    metrics: Metrics;
}

async function main() {
    const prisma = new PrismaClient();
    const registry = createDefaultBlockRegistry();
    const backtests = new SignalBacktestRunService(prisma);
    const exec = new SignalBacktestExecutionService(prisma);

    try {
        await upsertTier1ComposedSignals(prisma, registry);

        const results: ResultRow[] = [];

        console.log('\n' + '='.repeat(90));
        console.log('  R:R COMPARISON — Fixed Take Profit vs Signal-Based');
        console.log('='.repeat(90) + '\n');

        // ─── Step 1: Run R:R variant backtests ──────────────────────────

        for (const strat of STRATEGIES) {
            for (const variant of RR_VARIANTS) {
                const tag = `[rr-test] ${strat.shortLabel} — ${variant.rrTag}`;
                console.log(`Running: ${tag} ...`);

                const { backtestRunId } = await backtests.createGeneratedBacktest({
                    signalCode: strat.signalCode,
                    signalVersion: strat.signalVersion,
                    symbol: 'XAUUSD',
                    timeframe: strat.timeframe,
                    dateRange: { from: DATE_FROM, to: DATE_TO },
                    executionConfig: BASE_EXEC,
                    initialEquity: INITIAL_EQUITY,
                    riskPercent: RISK_PERCENT,
                    notes: tag,
                    parameters: {
                        rrTest: true,
                        rrRatio: variant.rrTag,
                        exitStrategy: variant.exitStrategy,
                    },
                });

                await exec.executeRun(backtestRunId);
                const trades = await loadTradesForRun(prisma, backtestRunId);
                const metrics = computeMetrics(backtestRunId, trades);

                results.push({
                    strategy: strat.shortLabel,
                    timeframe: strat.timeframe.toUpperCase(),
                    rrConfig: variant.label,
                    metrics,
                });

                console.log(`  Done: ${metrics.trades} trades | WR ${metrics.winRate}% | PF ${metrics.profitFactor} | PnL $${metrics.netPnl}\n`);
            }
        }

        // ─── Step 2: Load baseline runs ─────────────────────────────────

        console.log('Loading baseline [go-live-candidate] runs...\n');

        for (const strat of STRATEGIES) {
            const baselineRun = await prisma.backtestRun.findFirst({
                where: {
                    signalCode: strat.signalCode,
                    signalVersion: strat.signalVersion,
                    timeframe: strat.timeframe,
                    status: 'COMPLETED',
                    symbol: { contains: 'XAU' },
                    notes: { contains: '[go-live-candidate]' },
                },
                orderBy: { createdAt: 'desc' },
                select: { id: true, notes: true },
            });

            if (!baselineRun) {
                console.log(`  WARNING: No baseline found for ${strat.shortLabel}`);
                continue;
            }

            console.log(`  Baseline for ${strat.shortLabel}: ${baselineRun.id}`);
            const trades = await loadTradesForRun(prisma, baselineRun.id);
            const metrics = computeMetrics(baselineRun.id, trades);

            results.unshift({
                strategy: strat.shortLabel,
                timeframe: strat.timeframe.toUpperCase(),
                rrConfig: 'Baseline',
                metrics,
            });
        }

        // Sort results: group by strategy, baseline first
        results.sort((a, b) => {
            const stratOrder = STRATEGIES.findIndex(s => s.shortLabel === a.strategy) -
                               STRATEGIES.findIndex(s => s.shortLabel === b.strategy);
            if (stratOrder !== 0) return stratOrder;
            if (a.rrConfig === 'Baseline') return -1;
            if (b.rrConfig === 'Baseline') return 1;
            return a.rrConfig.localeCompare(b.rrConfig);
        });

        // ─── Step 3: Print comparison table ─────────────────────────────

        console.log('\n' + '='.repeat(140));
        console.log('  COMPARISON TABLE');
        console.log('='.repeat(140));

        const hdr = [
            'Strategy'.padEnd(22),
            'TF',
            'R:R Config'.padEnd(16),
            'Trades'.padStart(6),
            'WR'.padStart(7),
            'PF'.padStart(6),
            'Net PnL'.padStart(12),
            'DD'.padStart(7),
            'Avg R'.padStart(8),
            'Expect'.padStart(8),
            'Tr/Yr'.padStart(6),
            'MaxL'.padStart(5),
        ];
        console.log(hdr.join(' | '));
        console.log('-'.repeat(140));

        for (const r of results) {
            const m = r.metrics;
            const row = [
                r.strategy.padEnd(22),
                r.timeframe.padEnd(2),
                r.rrConfig.padEnd(16),
                String(m.trades).padStart(6),
                `${m.winRate}%`.padStart(7),
                (m.profitFactor?.toFixed(2) ?? 'N/A').padStart(6),
                `$${m.netPnl.toLocaleString()}`.padStart(12),
                `${m.equityDD.toFixed(1)}%`.padStart(7),
                m.avgR.toFixed(2).padStart(8),
                `$${m.expectancy}`.padStart(8),
                String(m.tradesPerYear).padStart(6),
                String(m.maxConsecLosses).padStart(5),
            ];
            console.log(row.join(' | '));

            // Print separator between strategy groups
            const idx = results.indexOf(r);
            if (idx < results.length - 1 && results[idx + 1].strategy !== r.strategy) {
                console.log('-'.repeat(140));
            }
        }

        console.log('='.repeat(140));

        // ─── Step 4: Key insights ───────────────────────────────────────

        console.log('\n── Key Insights ──\n');

        for (const strat of STRATEGIES) {
            const stratResults = results.filter(r => r.strategy === strat.shortLabel);
            const baseline = stratResults.find(r => r.rrConfig === 'Baseline');
            const rr1 = stratResults.find(r => r.rrConfig.includes('1:1'));
            const rr2 = stratResults.find(r => r.rrConfig.includes('1:2'));

            if (baseline && rr1 && rr2) {
                const pnlDelta1 = baseline.metrics.netPnl !== 0 ? Math.round((rr1.metrics.netPnl / baseline.metrics.netPnl - 1) * 100) : 0;
                const pnlDelta2 = baseline.metrics.netPnl !== 0 ? Math.round((rr2.metrics.netPnl / baseline.metrics.netPnl - 1) * 100) : 0;

                console.log(`${strat.shortLabel}:`);
                console.log(`  Baseline PnL: $${baseline.metrics.netPnl} | 1:1 PnL: $${rr1.metrics.netPnl} (${pnlDelta1 >= 0 ? '+' : ''}${pnlDelta1}%) | 1:2 PnL: $${rr2.metrics.netPnl} (${pnlDelta2 >= 0 ? '+' : ''}${pnlDelta2}%)`);
                console.log(`  1:1 WR: ${rr1.metrics.winRate}% vs Baseline ${baseline.metrics.winRate}% | 1:2 WR: ${rr2.metrics.winRate}% vs Baseline ${baseline.metrics.winRate}%`);
                console.log(`  1:1 DD: ${rr1.metrics.equityDD.toFixed(1)}% vs Baseline ${baseline.metrics.equityDD.toFixed(1)}% | 1:2 DD: ${rr2.metrics.equityDD.toFixed(1)}% vs Baseline ${baseline.metrics.equityDD.toFixed(1)}%`);
                console.log('');
            }
        }

        // ─── Step 5: Save JSON ──────────────────────────────────────────

        const outputDir = path.join(process.cwd(), '.artifacts', 'walk-forward');
        fs.mkdirSync(outputDir, { recursive: true });

        const outputFile = path.join(outputDir, 'rr-comparison-2026-03-26.json');

        const output = {
            generatedAt: new Date().toISOString(),
            dateRange: { from: DATE_FROM, to: DATE_TO },
            initialEquity: INITIAL_EQUITY,
            riskPercent: RISK_PERCENT,
            results: results.map(r => ({
                strategy: r.strategy,
                timeframe: r.timeframe,
                rrConfig: r.rrConfig,
                ...r.metrics,
            })),
        };

        fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
        console.log(`Results saved to ${outputFile}\n`);

    } finally {
        await prisma.$disconnect();
    }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
