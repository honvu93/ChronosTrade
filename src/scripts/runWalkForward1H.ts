/**
 * Walk-Forward Validation — 1H LONG Strategy Sweep
 *
 * Runs walk-forward validation on ALL promising 1H LONG candidates
 * to identify go-live candidates.
 *
 * Config: 12mo train, 6mo test, 6mo step over 2019-01-01 to 2026-03-14
 * Gate:   PF>=1.30, DD<=15%, WR delta OFF, ratio 0.75
 *
 * Usage:
 *   npx ts-node src/scripts/runWalkForward1H.ts
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

// ─── Execution Config ───────────────────────────────────────────────────────

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

// ─── Candidates ─────────────────────────────────────────────────────────────

const CANDIDATES: WfCandidate[] = [
    {
        signalCode: 'SYS_T1_OB_FIB_LONG',
        signalVersion: 1,
        symbol: 'XAUUSD',
        timeframe: '1h',
        label: 'OB+Fib H1 (already OOS PASS)',
        execConfig: BASE_EXEC,
        initialEquity: 10000,
        riskPercent: 1.5,
    },
    {
        signalCode: 'SYS_T1_BULLISH_OB_RECLAIM',
        signalVersion: 1,
        symbol: 'XAUUSD',
        timeframe: '1h',
        label: 'Bullish OB Reclaim H1',
        execConfig: BASE_EXEC,
        initialEquity: 10000,
        riskPercent: 1.5,
    },
    {
        signalCode: 'SYS_T1_TREND_PULLBACK_LONG',
        signalVersion: 1,
        symbol: 'XAUUSD',
        timeframe: '1h',
        label: 'Trend Pullback H1',
        execConfig: BASE_EXEC,
        initialEquity: 10000,
        riskPercent: 1.5,
    },
    {
        signalCode: 'SYS_T1_SESSION_BURST_LONG',
        signalVersion: 1,
        symbol: 'XAUUSD',
        timeframe: '1h',
        label: 'Session Burst H1',
        execConfig: BASE_EXEC,
        initialEquity: 10000,
        riskPercent: 1.5,
    },
    {
        signalCode: 'SYS_4TF_PD_LEVEL_BREAK_LONG',
        signalVersion: 2,
        symbol: 'XAUUSD',
        timeframe: '1h',
        label: 'PD Level Break H1 v2',
        execConfig: BASE_EXEC,
        initialEquity: 10000,
        riskPercent: 1.5,
    },
    {
        signalCode: 'SYS_4TF_BOS_FVG_LONG_H1',
        signalVersion: 1,
        symbol: 'XAUUSD',
        timeframe: '1h',
        label: 'BOS+FVG H1',
        execConfig: BASE_EXEC,
        initialEquity: 10000,
        riskPercent: 1.5,
    },
    {
        signalCode: 'SYS_4TF_RSI_DIVERGENCE_LONG',
        signalVersion: 1,
        symbol: 'XAUUSD',
        timeframe: '1h',
        label: 'RSI Divergence H1',
        execConfig: BASE_EXEC,
        initialEquity: 10000,
        riskPercent: 1.5,
    },
];

// ─── Walk-Forward Config ────────────────────────────────────────────────────

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
    maxWrDeltaPP: null,
    minFoldsPassRatio: 0.75,
};

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
    const prisma = new PrismaClient();
    const registry = createDefaultBlockRegistry();
    const backtests = new SignalBacktestRunService(prisma);
    const exec = new SignalBacktestExecutionService(prisma);

    try {
        await upsertTier1ComposedSignals(prisma, registry);

        const engine = new WalkForwardEngine(prisma, backtests, exec);
        const allResults: WalkForwardResult[] = [];

        console.log('\n' + '█'.repeat(80));
        console.log('  1H LONG WALK-FORWARD SWEEP — 7 Candidates');
        console.log('  Gate: PF>=1.30 | DD<=15% | WR delta=OFF | pass ratio>=75%');
        console.log('█'.repeat(80) + '\n');

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

        // ─── Save Results ─────────────────────────────────────────────────
        const artifactDir = path.join(process.cwd(), '.artifacts', 'walk-forward');
        if (!fs.existsSync(artifactDir)) fs.mkdirSync(artifactDir, { recursive: true });

        const dateStr = new Date().toISOString().slice(0, 10);
        const filename = `1h-sweep-${dateStr}.json`;
        const filepath = path.join(artifactDir, filename);

        fs.writeFileSync(filepath, JSON.stringify(allResults, null, 2));
        console.log(`\n  Saved: .artifacts/walk-forward/${filename}`);

        // ─── Leaderboard ──────────────────────────────────────────────────
        const sorted = [...allResults].sort((a, b) => {
            // Sort by pass count descending, then composite PnL descending
            if (b.passCount !== a.passCount) return b.passCount - a.passCount;
            return b.compositeOOS.totalNetPnl - a.compositeOOS.totalNetPnl;
        });

        console.log('\n' + '█'.repeat(100));
        console.log('  FINAL LEADERBOARD — 1H LONG Walk-Forward');
        console.log('█'.repeat(100));
        console.log('  Rank │ Signal                                 │ Pass  │ Folds │ OOS Trades │ OOS PnL    │ Avg PF │ Avg WR │ Verdict');
        console.log('  ─────┼────────────────────────────────────────┼───────┼───────┼────────────┼────────────┼────────┼────────┼────────');

        for (let i = 0; i < sorted.length; i++) {
            const r = sorted[i];
            const verdict = r.overallPass ? 'GO-LIVE' : 'FAIL';
            const icon = r.overallPass ? '>>>' : '   ';
            const pnlStr = r.compositeOOS.totalNetPnl >= 0
                ? `+$${r.compositeOOS.totalNetPnl.toFixed(0)}`.padStart(10)
                : `-$${Math.abs(r.compositeOOS.totalNetPnl).toFixed(0)}`.padStart(10);

            console.log(
                `  ${icon}${String(i + 1).padStart(1)} │ ${r.signalCode.padEnd(38)} │ ${String(r.passCount).padStart(2)}/${String(r.totalFolds).padStart(2)} │ ${String(r.totalFolds).padStart(5)} │ ${String(r.compositeOOS.totalTrades).padStart(10)} │ ${pnlStr} │ ${r.compositeOOS.avgPF.toFixed(2).padStart(6)} │ ${r.compositeOOS.avgWR.toFixed(1).padStart(5)}% │ ${verdict}`,
            );
        }

        console.log();

        // Summary
        const goLive = sorted.filter(r => r.overallPass);
        if (goLive.length > 0) {
            console.log(`  GO-LIVE CANDIDATES (${goLive.length}):`);
            for (const r of goLive) {
                console.log(`    - ${r.signalCode} (${r.timeframe}): ${r.passCount}/${r.totalFolds} folds, OOS PnL $${r.compositeOOS.totalNetPnl.toFixed(2)}`);
            }
        } else {
            console.log('  NO GO-LIVE CANDIDATES — all strategies failed walk-forward gate');
        }

        // Also show partial-pass strategies that are still below the fold-pass threshold.
        const borderline = sorted.filter(r => !r.overallPass && r.passCount > 0);
        if (borderline.length > 0) {
            console.log(`\n  BORDERLINE (partial pass, ${borderline.length}):`);
            for (const r of borderline) {
                console.log(`    - ${r.signalCode}: ${r.passCount}/${r.totalFolds} folds, OOS PnL $${r.compositeOOS.totalNetPnl.toFixed(2)}`);
            }
        }

        console.log();

    } finally {
        await prisma.$disconnect();
    }
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
