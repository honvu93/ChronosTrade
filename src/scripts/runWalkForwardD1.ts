/**
 * Walk-Forward Validation -- D1 (Daily) Strategy Sweep
 *
 * Tests D1-optimized strategies and cross-timeframe candidates on daily bars.
 * D1 will produce very few trades per fold (2-5 per 6-month window), so WR
 * delta gate is logged but not expected to be meaningful.
 *
 * Candidates:
 *   1. SYS_4TF_BOS_FVG_LONG_D1    v1 -- BOS+FVG optimized D1
 *   2. SYS_4TF_PD_LEVEL_BREAK_LONG_D1 v1 -- PD Level Break D1
 *   3. SYS_T1_OB_FIB_LONG          v1 -- OB+Fib (H1 cross-TF on D1)
 *   4. SYS_T1_TREND_PULLBACK_LONG  v1 -- Trend Pullback (cross-TF on D1)
 *
 * Config: 12mo train, 6mo test, 6mo step over 2019-01-01 to 2026-03-14
 * Gate:   PF>=1.30, DD<=15%, WR delta<=8pp (logged), ratio 0.75
 * Risk:   1.5%, non-compound
 *
 * Usage:
 *   npx ts-node src/scripts/runWalkForwardD1.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { SignalBacktestExecutionService } from '../services/signals/SignalBacktestExecutionService';
import { SignalBacktestRunService } from '../services/signals/SignalBacktestRunService';
import { createDefaultBlockRegistry } from '../services/signals/blocks/createDefaultBlockRegistry';
import { upsertTier1ComposedSignals } from '../services/signals/tier1ComposedSignals';
import { ExecutionConfigInput } from '../services/signals/types';
import { WalkForwardEngine, WfCandidate, WfRunConfig } from '../services/signals/optimization/WalkForwardEngine';
import { WalkForwardGate, WalkForwardResult } from '../services/signals/optimization/optimizationTypes';

dotenv.config();

// --- Execution Config --------------------------------------------------------

const BASE_EXEC: ExecutionConfigInput = {
    entryFeeBps: 4,
    exitFeeBps: 4,
    entrySlippageBps: 2,
    exitSlippageBps: 2,
    orderTiming: 'NEXT_BAR_OPEN',
    stopLoss: { mode: 'SIGNAL_PRICE' },
    takeProfit: { mode: 'SIGNAL_PRICE' },
    positionSizing: { mode: 'RISK_BASED' },
};

// --- Candidates --------------------------------------------------------------

const CANDIDATES: WfCandidate[] = [
    // D1-optimized strategies
    {
        signalCode: 'SYS_4TF_BOS_FVG_LONG_D1',
        signalVersion: 1,
        symbol: 'XAUUSD',
        timeframe: '1d',
        label: 'BOS+FVG LONG D1 (PF=1.81, WR=64.7%)',
        execConfig: BASE_EXEC,
        initialEquity: 10000,
        riskPercent: 1.5,
    },
    {
        signalCode: 'SYS_4TF_PD_LEVEL_BREAK_LONG_D1',
        signalVersion: 1,
        symbol: 'XAUUSD',
        timeframe: '1d',
        label: 'PD Level Break LONG D1 (PF=1.75, WR=61.5%)',
        execConfig: BASE_EXEC,
        initialEquity: 10000,
        riskPercent: 1.5,
    },
    // Cross-timeframe candidates tested on D1
    {
        signalCode: 'SYS_T1_OB_FIB_LONG',
        signalVersion: 1,
        symbol: 'XAUUSD',
        timeframe: '1d',
        label: 'OB+Fib LONG (H1 cross-TF on D1)',
        execConfig: BASE_EXEC,
        initialEquity: 10000,
        riskPercent: 1.5,
    },
    {
        signalCode: 'SYS_T1_TREND_PULLBACK_LONG',
        signalVersion: 1,
        symbol: 'XAUUSD',
        timeframe: '1d',
        label: 'Trend Pullback LONG (cross-TF on D1)',
        execConfig: BASE_EXEC,
        initialEquity: 10000,
        riskPercent: 1.5,
    },
];

// --- Walk-Forward Config -----------------------------------------------------

const RUN_CONFIG: WfRunConfig = {
    dataFrom: new Date('2019-01-01T00:00:00.000Z'),
    dataTo: new Date('2026-03-14T23:59:59.999Z'),
    trainMonths: 12,
    testMonths: 6,
    stepMonths: 6,
};

const GATE: WalkForwardGate = {
    minTestPF: 1.30,
    maxTestDD: 15,
    maxWrDeltaPP: 8,
    minFoldsPassRatio: 0.75,
};

// --- Main --------------------------------------------------------------------

async function main() {
    const prisma = new PrismaClient();
    const registry = createDefaultBlockRegistry();
    const backtests = new SignalBacktestRunService(prisma);
    const exec = new SignalBacktestExecutionService(prisma);

    try {
        await upsertTier1ComposedSignals(prisma, registry);

        const engine = new WalkForwardEngine(prisma, backtests, exec);
        const allResults: WalkForwardResult[] = [];

        console.log('\n' + '\u2588'.repeat(80));
        console.log(`  D1 (DAILY) WALK-FORWARD SWEEP -- ${CANDIDATES.length} Candidates`);
        console.log('  Gate: PF>=1.30 | DD<=15% | WR delta<=8pp (logged) | pass ratio>=75%');
        console.log('  Note: D1 produces few trades per fold; WR delta may be noisy');
        console.log('\u2588'.repeat(80) + '\n');

        for (let i = 0; i < CANDIDATES.length; i++) {
            const candidate = CANDIDATES[i];
            console.log(`\n${'▓'.repeat(80)}`);
            console.log(`  [${i + 1}/${CANDIDATES.length}] ${candidate.label} (${candidate.signalCode})`);
            console.log('▓'.repeat(80));

            try {
                const result = await engine.run(candidate, RUN_CONFIG, GATE);
                allResults.push(result);
            } catch (err: any) {
                console.error(`  ERROR running ${candidate.label}: ${err.message}`);
                allResults.push({
                    signalCode: candidate.signalCode,
                    timeframe: candidate.timeframe,
                    config: { trainMonths: RUN_CONFIG.trainMonths, testMonths: RUN_CONFIG.testMonths, stepMonths: RUN_CONFIG.stepMonths },
                    gate: { ...GATE, resolvedMinFoldsPass: 0 },
                    folds: [],
                    passCount: 0,
                    failCount: 0,
                    totalFolds: 0,
                    overallPass: false,
                    compositeOOS: { totalTrades: 0, totalNetPnl: 0, avgWR: 0, avgPF: 0 },
                    durationSec: 0,
                });
            }
        }

        // --- Leaderboard ---------------------------------------------------------

        console.log(`\n${'═'.repeat(100)}`);
        console.log('  D1 WALK-FORWARD LEADERBOARD');
        console.log('═'.repeat(100));
        console.log('  # │ Strategy                                │ Pass │ Folds │ OOS PF │ OOS WR │ OOS Trades │ OOS PnL   │ Result');
        console.log('  ──┼─────────────────────────────────────────┼──────┼───────┼────────┼────────┼────────────┼───────────┼───────');

        // Sort by passCount desc, then avgPF desc
        const sorted = [...allResults].sort((a, b) => {
            if (b.passCount !== a.passCount) return b.passCount - a.passCount;
            return b.compositeOOS.avgPF - a.compositeOOS.avgPF;
        });

        for (let i = 0; i < sorted.length; i++) {
            const r = sorted[i];
            const candidate = CANDIDATES.find(c => c.signalCode === r.signalCode)!;
            const icon = r.overallPass ? '>>>' : '   ';
            const verdict = r.overallPass ? 'GO-LIVE' : 'FAIL';
            const pf = r.compositeOOS.avgPF >= 999 ? '  INF' : r.compositeOOS.avgPF.toFixed(2);
            const pnlStr = r.compositeOOS.totalNetPnl >= 0
                ? `+$${r.compositeOOS.totalNetPnl.toFixed(0)}`.padStart(9)
                : `-$${Math.abs(r.compositeOOS.totalNetPnl).toFixed(0)}`.padStart(9);

            console.log(
                `  ${icon}${String(i + 1).padStart(1)} │ ${candidate.label.substring(0, 39).padEnd(39)} │ ${String(r.passCount).padStart(4)} │ ${`${r.passCount}/${r.totalFolds}`.padStart(5)} │ ${String(pf).padStart(6)} │ ${r.compositeOOS.avgWR.toFixed(1).padStart(6)} │ ${String(r.compositeOOS.totalTrades).padStart(10)} │ ${pnlStr} │ ${verdict}`,
            );
        }
        console.log();

        // --- Summary -------------------------------------------------------------

        const goLive = sorted.filter(r => r.overallPass);
        if (goLive.length > 0) {
            console.log(`  GO-LIVE CANDIDATES (${goLive.length}):`);
            for (const r of goLive) {
                console.log(`    - ${r.signalCode} (${r.timeframe}): ${r.passCount}/${r.totalFolds} folds, OOS PnL $${r.compositeOOS.totalNetPnl.toFixed(2)}`);
            }
        } else {
            console.log('  NO GO-LIVE CANDIDATES -- all strategies failed walk-forward gate');
        }

        // Borderline
        const borderline = sorted.filter(r => !r.overallPass && r.passCount > 0);
        if (borderline.length > 0) {
            console.log(`\n  BORDERLINE (partial pass, ${borderline.length}):`);
            for (const r of borderline) {
                console.log(`    - ${r.signalCode}: ${r.passCount}/${r.totalFolds} folds, OOS PnL $${r.compositeOOS.totalNetPnl.toFixed(2)}`);
            }
        }

        // D1-specific note about low trade counts
        const lowTradeFolds = allResults.flatMap(r => r.folds.filter(f => f.testMetrics.trades <= 3));
        if (lowTradeFolds.length > 0) {
            const totalFolds = allResults.reduce((s, r) => s + r.totalFolds, 0);
            console.log(`\n  NOTE: ${lowTradeFolds.length}/${totalFolds} test folds had <=3 trades -- D1 results are statistically thin`);
        }

        console.log();

        // --- Save Results --------------------------------------------------------

        const artifactDir = path.join(process.cwd(), '.artifacts', 'walk-forward');
        if (!fs.existsSync(artifactDir)) fs.mkdirSync(artifactDir, { recursive: true });

        const filename = 'd1-sweep-2026-03-26.json';
        const filepath = path.join(artifactDir, filename);

        const output = {
            sweep: 'D1 Walk-Forward Sweep',
            date: '2026-03-26',
            config: RUN_CONFIG,
            gate: GATE,
            note: 'D1 produces few trades per fold (2-5 per 6mo). WR delta gate is noisy at this trade count.',
            candidates: CANDIDATES.map(c => ({ signalCode: c.signalCode, signalVersion: c.signalVersion, label: c.label })),
            results: allResults,
            leaderboard: sorted.map((r, i) => ({
                rank: i + 1,
                signalCode: r.signalCode,
                label: CANDIDATES.find(c => c.signalCode === r.signalCode)?.label,
                passCount: r.passCount,
                totalFolds: r.totalFolds,
                overallPass: r.overallPass,
                compositeOOS: r.compositeOOS,
            })),
        };

        fs.writeFileSync(filepath, JSON.stringify(output, null, 2));
        console.log(`  Saved: .artifacts/walk-forward/${filename}`);
        console.log();
    } finally {
        await prisma.$disconnect();
    }
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
