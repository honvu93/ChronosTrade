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
}

const STRATEGIES: StrategySpec[] = [
    { signalCode: 'SYS_4TF_PD_LEVEL_BREAK_LONG', signalVersion: 2, timeframe: '4h', label: 'PD Level 4H' },
    { signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG', signalVersion: 1, timeframe: '2h', label: 'Asian Break 2H' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Backtest Runner ──────────────────────────────────────────────────────────

async function runStrategy(
    prisma: PrismaClient,
    backtests: SignalBacktestRunService,
    exec: SignalBacktestExecutionService,
    spec: StrategySpec,
) {
    console.log(`  Running ${spec.label} (${spec.signalCode} v${spec.signalVersion}, ${spec.timeframe})...`);

    const { backtestRunId } = await backtests.createGeneratedBacktest({
        signalCode: spec.signalCode,
        signalVersion: spec.signalVersion,
        symbol: 'XAUUSD',
        timeframe: spec.timeframe,
        dateRange: { from: FROM, to: TO },
        executionConfig: EXEC_CONFIG,
        initialEquity: INITIAL_EQUITY,
        riskPercent: RISK_PCT,
        notes: `[portfolio-corr] ${spec.label}`,
        parameters: { portfolioCorrelation: true },
    });

    await exec.executeRun(backtestRunId);

    const rows = await prisma.backtestTradeResult.findMany({
        where: { backtestRunId, isOpen: false },
        select: { pnlUsd: true, win: true, exitTime: true },
        orderBy: { exitTime: 'asc' },
    });

    const trades = rows.length;
    const netPnl = rows.reduce((s, r) => s + Number(r.pnlUsd), 0);
    const grossW = rows.filter(r => r.win).reduce((s, r) => s + Number(r.pnlUsd), 0);
    const grossL = Math.abs(rows.filter(r => !r.win).reduce((s, r) => s + Number(r.pnlUsd), 0));
    const pf = grossL > 0 ? Math.round((grossW / grossL) * 100) / 100 : null;

    // Build daily PnL map
    const dailyPnl = new Map<string, number>();
    for (const r of rows) {
        if (!r.exitTime) continue;
        const day = r.exitTime.toISOString().slice(0, 10);
        dailyPnl.set(day, (dailyPnl.get(day) ?? 0) + Number(r.pnlUsd));
    }

    // Compute per-trade DD (for individual strategy DD)
    const tradeDd = computeEquityDD(rows.map(r => Number(r.pnlUsd)), INITIAL_EQUITY);

    console.log(`    Done: ${trades} trades, PnL=$${Math.round(netPnl * 100) / 100}, PF=${pf}, DD=${tradeDd.toFixed(2)}%`);

    return {
        runId: backtestRunId,
        label: spec.label,
        trades,
        netPnl: Math.round(netPnl * 100) / 100,
        profitFactor: pf,
        equityDD: tradeDd,
        dailyPnl,
    };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    const prisma = new PrismaClient();
    const registry = createDefaultBlockRegistry();
    const backtests = new SignalBacktestRunService(prisma);
    const exec = new SignalBacktestExecutionService(prisma);

    try {
        await upsertTier1ComposedSignals(prisma, registry);

        console.log('\n===============================================================');
        console.log('  PORTFOLIO CORRELATION ANALYSIS');
        console.log('  PD Level Break 4H  vs  Asian Break 2H');
        console.log(`  Period: ${FROM.slice(0, 10)} to ${TO.slice(0, 10)}`);
        console.log(`  Equity: $${INITIAL_EQUITY}, Risk: ${RISK_PCT}%, No guards`);
        console.log('===============================================================\n');

        // 1. Run both strategies
        const results = [];
        for (const spec of STRATEGIES) {
            const result = await runStrategy(prisma, backtests, exec, spec);
            results.push(result);
        }

        const [pdResult, abResult] = results;

        // 2. Merge daily PnL series
        const allDays = new Set([...pdResult.dailyPnl.keys(), ...abResult.dailyPnl.keys()]);
        const sortedDays = [...allDays].sort();
        const pdArr: number[] = [];
        const abArr: number[] = [];
        for (const day of sortedDays) {
            pdArr.push(pdResult.dailyPnl.get(day) ?? 0);
            abArr.push(abResult.dailyPnl.get(day) ?? 0);
        }

        // 3. Pearson correlation
        const r = pearsonCorrelation(pdArr, abArr);
        const rRound = Math.round(r * 10000) / 10000;
        const corrLabel = Math.abs(rRound) < 0.40 ? 'LOW' : 'HIGH';

        // 4. Combined portfolio DD
        const combinedDailyPnls = sortedDays.map(day =>
            (pdResult.dailyPnl.get(day) ?? 0) + (abResult.dailyPnl.get(day) ?? 0)
        );
        const combinedDD = computeEquityDD(combinedDailyPnls, INITIAL_EQUITY);
        const combinedPnl = Math.round((pdResult.netPnl + abResult.netPnl) * 100) / 100;
        const ddPass = combinedDD < 15;

        // 5. Build combined equity curve
        const equityCurve: Array<{ date: string; pdEquity: number; abEquity: number; combinedEquity: number }> = [];
        let pdEq = INITIAL_EQUITY, abEq = INITIAL_EQUITY, combEq = INITIAL_EQUITY;
        for (let i = 0; i < sortedDays.length; i++) {
            pdEq += pdArr[i];
            abEq += abArr[i];
            combEq += combinedDailyPnls[i];
            equityCurve.push({
                date: sortedDays[i],
                pdEquity: Math.round(pdEq * 100) / 100,
                abEquity: Math.round(abEq * 100) / 100,
                combinedEquity: Math.round(combEq * 100) / 100,
            });
        }

        // 6. Print report
        console.log('\n===============================================================');
        console.log('  RESULTS');
        console.log('===============================================================\n');
        console.log(`  ${pdResult.label}: trades=${pdResult.trades}, PnL=$${pdResult.netPnl}, DD=${pdResult.equityDD.toFixed(1)}%`);
        console.log(`  ${abResult.label}: trades=${abResult.trades}, PnL=$${abResult.netPnl}, DD=${abResult.equityDD.toFixed(1)}%`);
        console.log(`  Pearson r: ${rRound.toFixed(4)} (${corrLabel})`);
        console.log(`  Combined PnL: $${combinedPnl}`);
        console.log(`  Combined DD: ${combinedDD.toFixed(1)}% (${ddPass ? 'PASS' : 'FAIL'} < 15%)`);
        console.log(`  Daily PnL days: ${sortedDays.length}`);
        console.log('');

        if (Math.abs(rRound) < 0.40 && ddPass) {
            console.log('  VERDICT: Safe to deploy together.');
        } else {
            const issues = [];
            if (Math.abs(rRound) >= 0.40) issues.push(`Pearson r=${rRound.toFixed(4)} >= 0.40`);
            if (!ddPass) issues.push(`Combined DD=${combinedDD.toFixed(1)}% >= 15%`);
            console.log(`  VERDICT: NOT safe to deploy together. Issues: ${issues.join('; ')}`);
        }
        console.log('');

        // 7. Save artifact
        const artifactDir = path.resolve('.artifacts/walk-forward');
        fs.mkdirSync(artifactDir, { recursive: true });

        const artifact = {
            generatedAt: new Date().toISOString(),
            period: { from: FROM.slice(0, 10), to: TO.slice(0, 10) },
            initialEquity: INITIAL_EQUITY,
            riskPercent: RISK_PCT,
            strategies: [
                {
                    label: pdResult.label,
                    signalCode: STRATEGIES[0].signalCode,
                    signalVersion: STRATEGIES[0].signalVersion,
                    timeframe: STRATEGIES[0].timeframe,
                    runId: pdResult.runId,
                    trades: pdResult.trades,
                    netPnl: pdResult.netPnl,
                    profitFactor: pdResult.profitFactor,
                    equityDD: pdResult.equityDD,
                },
                {
                    label: abResult.label,
                    signalCode: STRATEGIES[1].signalCode,
                    signalVersion: STRATEGIES[1].signalVersion,
                    timeframe: STRATEGIES[1].timeframe,
                    runId: abResult.runId,
                    trades: abResult.trades,
                    netPnl: abResult.netPnl,
                    profitFactor: abResult.profitFactor,
                    equityDD: abResult.equityDD,
                },
            ],
            correlation: {
                pearsonR: rRound,
                label: corrLabel,
                dailyPnlDays: sortedDays.length,
            },
            combined: {
                totalPnl: combinedPnl,
                maxDrawdownPct: Math.round(combinedDD * 10000) / 10000,
                ddPassUnder15: ddPass,
            },
            verdict: (Math.abs(rRound) < 0.40 && ddPass) ? 'SAFE' : 'UNSAFE',
            equityCurve,
        };

        const filepath = path.join(artifactDir, 'portfolio-correlation-2026-03-26.json');
        fs.writeFileSync(filepath, JSON.stringify(artifact, null, 2));
        console.log(`  Saved: ${filepath}\n`);

    } finally {
        await prisma.$disconnect();
    }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
