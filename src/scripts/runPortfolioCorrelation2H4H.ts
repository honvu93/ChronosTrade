/**
 * Portfolio Correlation Analysis — BOS+FVG 2H + PD Level Break 4H
 *
 * Tests whether the top 2 candidates can run together in a portfolio:
 * 1. Pearson correlation of daily PnL (target: |r| < 0.40)
 * 2. Combined equity DD (target: < 15%)
 * 3. Concurrent drawdown overlap analysis
 * 4. Trade overlap (same-day entries)
 *
 * Also tests BOS+FVG+ADX 2H as alternative/addition.
 *
 * Usage:
 *   npx ts-node src/scripts/runPortfolioCorrelation2H4H.ts
 */
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

const EXEC_CONFIG: ExecutionConfigInput = {
    entryFeeBps: 4, exitFeeBps: 4, entrySlippageBps: 2, exitSlippageBps: 2,
    orderTiming: 'NEXT_BAR_OPEN',
    stopLoss: { mode: 'SIGNAL_PRICE' },
    takeProfit: { mode: 'SIGNAL_PRICE' },
    positionSizing: { mode: 'RISK_BASED' },
};

const FROM = '2019-01-01T00:00:00.000Z';
const TO   = '2026-03-14T23:59:59.999Z';
const INITIAL_EQUITY = 10000;
const RISK_PCT = 1.5;

interface StrategySpec {
    signalCode: string;
    signalVersion: number;
    timeframe: string;
    label: string;
    shortName: string;
}

const STRATEGIES: StrategySpec[] = [
    { signalCode: 'SYS_4TF_BOS_FVG_LONG', signalVersion: 2, timeframe: '2h', label: 'BOS+FVG LONG 2H v2', shortName: 'BOS_FVG_2H' },
    { signalCode: 'SYS_4TF_PD_LEVEL_BREAK_LONG', signalVersion: 2, timeframe: '4h', label: 'PD Level Break 4H v2', shortName: 'PD_LEVEL_4H' },
    { signalCode: 'SYS_4TF_BOS_FVG_ADX_LONG', signalVersion: 1, timeframe: '2h', label: 'BOS+FVG+ADX 2H', shortName: 'BOS_FVG_ADX_2H' },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function computeEquityDD(dailyPnls: number[], initialEquity: number) {
    let equity = initialEquity, peak = equity, maxDd = 0;
    for (const pnl of dailyPnls) {
        equity += pnl;
        if (equity > peak) peak = equity;
        const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
        if (dd > maxDd) maxDd = dd;
    }
    return Math.round(maxDd * 10000) / 10000;
}

function pearsonCorrelation(a: number[], b: number[]): number {
    const n = a.length;
    if (n === 0) return 0;
    const meanA = a.reduce((s, v) => s + v, 0) / n;
    const meanB = b.reduce((s, v) => s + v, 0) / n;
    let cov = 0, varA = 0, varB = 0;
    for (let i = 0; i < n; i++) {
        const dA = a[i] - meanA, dB = b[i] - meanB;
        cov += dA * dB;
        varA += dA * dA;
        varB += dB * dB;
    }
    return (varA > 0 && varB > 0) ? cov / Math.sqrt(varA * varB) : 0;
}

interface StrategyResult {
    spec: StrategySpec;
    runId: string;
    trades: number;
    netPnl: number;
    profitFactor: number | null;
    winRate: number;
    equityDD: number;
    dailyPnl: Map<string, number>;
    tradeEntryDays: Set<string>;
}

async function runStrategy(
    prisma: PrismaClient,
    backtests: SignalBacktestRunService,
    exec: SignalBacktestExecutionService,
    spec: StrategySpec,
): Promise<StrategyResult> {
    console.log(`  Running ${spec.label}...`);

    const { backtestRunId } = await backtests.createGeneratedBacktest({
        signalCode: spec.signalCode,
        signalVersion: spec.signalVersion,
        symbol: 'XAUUSD',
        timeframe: spec.timeframe,
        dateRange: { from: FROM, to: TO },
        executionConfig: EXEC_CONFIG,
        initialEquity: INITIAL_EQUITY,
        riskPercent: RISK_PCT,
        notes: `[portfolio-corr-2h4h] ${spec.label}`,
        parameters: { portfolioCorrelation: true },
    });

    await exec.executeRun(backtestRunId);

    const rows = await prisma.backtestTradeResult.findMany({
        where: { backtestRunId, isOpen: false },
        select: { pnlUsd: true, win: true, exitTime: true },
        orderBy: { exitTime: 'asc' },
    });

    const trades = rows.length;
    const wins = rows.filter(r => r.win).length;
    const netPnl = rows.reduce((s, r) => s + Number(r.pnlUsd), 0);
    const grossW = rows.filter(r => r.win).reduce((s, r) => s + Number(r.pnlUsd), 0);
    const grossL = Math.abs(rows.filter(r => !r.win).reduce((s, r) => s + Number(r.pnlUsd), 0));
    const pf = grossL > 0 ? Math.round((grossW / grossL) * 100) / 100 : null;
    const wr = trades > 0 ? Math.round((wins / trades) * 10000) / 10000 : 0;

    const dailyPnl = new Map<string, number>();
    const tradeEntryDays = new Set<string>();
    for (const r of rows) {
        if (r.exitTime) {
            const day = r.exitTime.toISOString().slice(0, 10);
            dailyPnl.set(day, (dailyPnl.get(day) ?? 0) + Number(r.pnlUsd));
            tradeEntryDays.add(day);
        }
    }

    const tradeDd = computeEquityDD(rows.map(r => Number(r.pnlUsd)), INITIAL_EQUITY);
    console.log(`    ${trades} trades | PnL=$${Math.round(netPnl)} | PF=${pf} | WR=${(wr * 100).toFixed(1)}% | DD=${tradeDd.toFixed(1)}%`);

    return { spec, runId: backtestRunId, trades, netPnl: Math.round(netPnl * 100) / 100, profitFactor: pf, winRate: wr, equityDD: tradeDd, dailyPnl, tradeEntryDays };
}

function analyzePair(
    a: StrategyResult,
    b: StrategyResult,
    allDays: string[],
): { pearsonR: number; combinedDD: number; combinedPnl: number; tradeOverlapPct: number; concurrentDDDays: number } {
    const aArr = allDays.map(d => a.dailyPnl.get(d) ?? 0);
    const bArr = allDays.map(d => b.dailyPnl.get(d) ?? 0);
    const r = pearsonCorrelation(aArr, bArr);
    const combinedDaily = allDays.map(d => (a.dailyPnl.get(d) ?? 0) + (b.dailyPnl.get(d) ?? 0));
    const combinedDD = computeEquityDD(combinedDaily, INITIAL_EQUITY);
    const combinedPnl = Math.round((a.netPnl + b.netPnl) * 100) / 100;

    // Trade overlap: days where both strategies enter
    const overlapDays = [...a.tradeEntryDays].filter(d => b.tradeEntryDays.has(d));
    const totalUniqueDays = new Set([...a.tradeEntryDays, ...b.tradeEntryDays]).size;
    const tradeOverlapPct = totalUniqueDays > 0 ? (overlapDays.length / totalUniqueDays) * 100 : 0;

    // Concurrent drawdown: days where both strategies have negative running PnL
    let aEq = 0, bEq = 0, aPeak = 0, bPeak = 0, concurrentDDDays = 0;
    for (let i = 0; i < allDays.length; i++) {
        aEq += aArr[i]; if (aEq > aPeak) aPeak = aEq;
        bEq += bArr[i]; if (bEq > bPeak) bPeak = bEq;
        const aInDD = aPeak - aEq > INITIAL_EQUITY * 0.02;  // >2% from peak
        const bInDD = bPeak - bEq > INITIAL_EQUITY * 0.02;
        if (aInDD && bInDD) concurrentDDDays++;
    }

    return { pearsonR: Math.round(r * 10000) / 10000, combinedDD, combinedPnl, tradeOverlapPct: Math.round(tradeOverlapPct * 100) / 100, concurrentDDDays };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
    const prisma = new PrismaClient();
    const registry = createDefaultBlockRegistry();
    const backtests = new SignalBacktestRunService(prisma);
    const exec = new SignalBacktestExecutionService(prisma);

    try {
        await upsertTier1ComposedSignals(prisma, registry);

        console.log('\n' + '█'.repeat(80));
        console.log('  PORTFOLIO CORRELATION ANALYSIS');
        console.log('  BOS+FVG 2H  ×  PD Level Break 4H  ×  BOS+FVG+ADX 2H');
        console.log(`  Period: ${FROM.slice(0, 10)} → ${TO.slice(0, 10)}`);
        console.log(`  Equity: $${INITIAL_EQUITY}, Risk: ${RISK_PCT}%`);
        console.log('█'.repeat(80) + '\n');

        // 1. Run all strategies
        const results: StrategyResult[] = [];
        for (const spec of STRATEGIES) {
            results.push(await runStrategy(prisma, backtests, exec, spec));
        }

        // 2. Collect all unique days
        const allDaysSet = new Set<string>();
        for (const r of results) {
            for (const d of r.dailyPnl.keys()) allDaysSet.add(d);
        }
        const allDays = [...allDaysSet].sort();

        // 3. Pairwise analysis
        const pairs: Array<{ a: string; b: string; analysis: ReturnType<typeof analyzePair> }> = [];
        for (let i = 0; i < results.length; i++) {
            for (let j = i + 1; j < results.length; j++) {
                pairs.push({
                    a: results[i].spec.shortName,
                    b: results[j].spec.shortName,
                    analysis: analyzePair(results[i], results[j], allDays),
                });
            }
        }

        // 4. Triple portfolio (all 3)
        const tripleDaily = allDays.map(d =>
            results.reduce((s, r) => s + (r.dailyPnl.get(d) ?? 0), 0)
        );
        const tripleDD = computeEquityDD(tripleDaily, INITIAL_EQUITY);
        const triplePnl = results.reduce((s, r) => s + r.netPnl, 0);

        // 5. Print report
        console.log('\n' + '═'.repeat(100));
        console.log('  INDIVIDUAL STRATEGY METRICS');
        console.log('═'.repeat(100));
        console.log('  Strategy                │ Trades │   PnL    │  PF  │   WR   │  DD%  ');
        console.log('  ────────────────────────┼────────┼──────────┼──────┼────────┼───────');
        for (const r of results) {
            console.log(`  ${r.spec.label.padEnd(22)} │ ${String(r.trades).padStart(6)} │ $${r.netPnl.toFixed(0).padStart(7)} │ ${String(r.profitFactor ?? 'N/A').padStart(4)} │ ${(r.winRate * 100).toFixed(1).padStart(5)}% │ ${r.equityDD.toFixed(1).padStart(5)}%`);
        }

        console.log('\n' + '═'.repeat(100));
        console.log('  PAIRWISE CORRELATION');
        console.log('═'.repeat(100));
        console.log('  Pair                               │ Pearson r │ Corr   │ Combined DD │ Combined PnL │ Trade Overlap │ Concurrent DD Days │ Verdict');
        console.log('  ───────────────────────────────────┼───────────┼────────┼─────────────┼──────────────┼───────────────┼────────────────────┼────────');

        for (const p of pairs) {
            const a = p.analysis;
            const corrLabel = Math.abs(a.pearsonR) < 0.20 ? 'VERY LOW' : Math.abs(a.pearsonR) < 0.40 ? 'LOW' : Math.abs(a.pearsonR) < 0.60 ? 'MODERATE' : 'HIGH';
            const ddPass = a.combinedDD < 15;
            const corrPass = Math.abs(a.pearsonR) < 0.40;
            const verdict = corrPass && ddPass ? '✅ SAFE' : '❌ RISK';
            console.log(
                `  ${(p.a + ' × ' + p.b).padEnd(35)} │ ${a.pearsonR.toFixed(4).padStart(9)} │ ${corrLabel.padEnd(6)} │ ${a.combinedDD.toFixed(1).padStart(10)}% │ $${a.combinedPnl.toFixed(0).padStart(11)} │ ${a.tradeOverlapPct.toFixed(1).padStart(12)}% │ ${String(a.concurrentDDDays).padStart(18)} │ ${verdict}`
            );
        }

        console.log('\n' + '═'.repeat(100));
        console.log('  TRIPLE PORTFOLIO (ALL 3)');
        console.log('═'.repeat(100));
        console.log(`  Combined PnL: $${Math.round(triplePnl)}`);
        console.log(`  Combined DD: ${tripleDD.toFixed(1)}% (${tripleDD < 15 ? 'PASS' : 'FAIL'} < 15%)`);
        console.log(`  Total trades: ${results.reduce((s, r) => s + r.trades, 0)}`);

        // 6. Final recommendation
        console.log('\n' + '═'.repeat(100));
        console.log('  RECOMMENDATION');
        console.log('═'.repeat(100));

        const bestPair = pairs.reduce((best, p) =>
            Math.abs(p.analysis.pearsonR) < Math.abs(best.analysis.pearsonR) ? p : best
        );

        console.log(`  Best pair: ${bestPair.a} × ${bestPair.b} (r=${bestPair.analysis.pearsonR.toFixed(4)})`);
        console.log(`  Combined DD: ${bestPair.analysis.combinedDD.toFixed(1)}%`);
        console.log(`  Combined PnL: $${bestPair.analysis.combinedPnl.toFixed(0)}`);

        const safePortfolio = Math.abs(bestPair.analysis.pearsonR) < 0.40 && bestPair.analysis.combinedDD < 15;
        if (safePortfolio) {
            console.log('  >>> PORTFOLIO APPROVED: low correlation + acceptable DD');
        } else {
            console.log('  >>> PORTFOLIO NEEDS REVIEW: check correlation or DD thresholds');
        }
        console.log();

        // 7. Save
        const artifactDir = path.resolve('.artifacts/walk-forward');
        fs.mkdirSync(artifactDir, { recursive: true });
        const dateStr = new Date().toISOString().slice(0, 10);
        const filename = `portfolio-correlation-2h4h-${dateStr}.json`;

        const artifact = {
            generatedAt: new Date().toISOString(),
            period: { from: FROM.slice(0, 10), to: TO.slice(0, 10) },
            initialEquity: INITIAL_EQUITY,
            riskPercent: RISK_PCT,
            strategies: results.map(r => ({
                ...r.spec,
                runId: r.runId,
                trades: r.trades,
                netPnl: r.netPnl,
                profitFactor: r.profitFactor,
                winRate: r.winRate,
                equityDD: r.equityDD,
            })),
            pairwiseCorrelation: pairs.map(p => ({ pair: `${p.a} × ${p.b}`, ...p.analysis })),
            triplePortfolio: { combinedPnl: Math.round(triplePnl), combinedDD: tripleDD, totalTrades: results.reduce((s, r) => s + r.trades, 0) },
            recommendation: safePortfolio ? 'APPROVED' : 'REVIEW_NEEDED',
        };

        fs.writeFileSync(path.join(artifactDir, filename), JSON.stringify(artifact, null, 2));
        console.log(`  Saved: .artifacts/walk-forward/${filename}\n`);

    } finally {
        await prisma.$disconnect();
    }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
