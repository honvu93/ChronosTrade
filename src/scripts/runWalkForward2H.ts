/**
 * Walk-Forward 2H Sweep
 *
 * Tests remaining 2H candidates and structural challengers on 2H timeframe.
 * Runs all candidates sequentially, saves combined results.
 *
 * Usage:
 *   npx ts-node src/scripts/runWalkForward2H.ts
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
        timeframe: '2h',
        label: 'OB+Fib LONG (H1→2H)',
        execConfig: BASE_EXEC,
        initialEquity: 10000,
        riskPercent: 1.5,
    },
    {
        signalCode: 'SYS_4TF_BOS_FVG_LONG',
        signalVersion: 2,
        symbol: 'XAUUSD',
        timeframe: '2h',
        label: 'BOS+FVG LONG 2H',
        execConfig: BASE_EXEC,
        initialEquity: 10000,
        riskPercent: 1.5,
    },
    {
        signalCode: 'SYS_4TF_BOS_FVG_ADX_LONG',
        signalVersion: 1,
        symbol: 'XAUUSD',
        timeframe: '2h',
        label: 'BOS+FVG+ADX LONG 2H',
        execConfig: BASE_EXEC,
        initialEquity: 10000,
        riskPercent: 1.5,
    },
    {
        signalCode: 'SYS_T1_SESSION_BURST_LONG',
        signalVersion: 1,
        symbol: 'XAUUSD',
        timeframe: '2h',
        label: 'Session Burst LONG 2H',
        execConfig: BASE_EXEC,
        initialEquity: 10000,
        riskPercent: 1.5,
    },
    {
        signalCode: 'SYS_T1_TREND_PULLBACK_LONG',
        signalVersion: 1,
        symbol: 'XAUUSD',
        timeframe: '2h',
        label: 'Trend Pullback LONG 2H',
        execConfig: BASE_EXEC,
        initialEquity: 10000,
        riskPercent: 1.5,
    },
    {
        signalCode: 'SYS_T1_BULLISH_OB_RECLAIM',
        signalVersion: 1,
        symbol: 'XAUUSD',
        timeframe: '2h',
        label: 'Bullish OB Reclaim 2H',
        execConfig: BASE_EXEC,
        initialEquity: 10000,
        riskPercent: 1.5,
    },
    {
        signalCode: 'SYS_4TF_PD_LEVEL_BREAK_LONG',
        signalVersion: 2,
        symbol: 'XAUUSD',
        timeframe: '2h',
        label: 'PD Level Break LONG (4H→2H)',
        execConfig: BASE_EXEC,
        initialEquity: 10000,
        riskPercent: 1.5,
    },
    {
        signalCode: 'SYS_4TF_CHOCH_BOS_LONG',
        signalVersion: 1,
        symbol: 'XAUUSD',
        timeframe: '2h',
        label: 'CHoCH+BOS LONG 2H',
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

        for (const candidate of CANDIDATES) {
            console.log(`\n${'▓'.repeat(80)}`);
            console.log(`  Starting: ${candidate.label}`);
            console.log(`${'▓'.repeat(80)}\n`);

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

        // ─── Leaderboard ────────────────────────────────────────────────────

        console.log(`\n${'═'.repeat(100)}`);
        console.log('  2H WALK-FORWARD LEADERBOARD');
        console.log('═'.repeat(100));
        console.log('  # │ Strategy                         │ Pass │ Folds │ OOS PF │ OOS WR │ OOS Trades │ OOS PnL   │ Result');
        console.log('  ──┼──────────────────────────────────┼──────┼───────┼────────┼────────┼────────────┼───────────┼───────');

        // Sort by passCount desc, then avgPF desc
        const sorted = [...allResults].sort((a, b) => {
            if (b.passCount !== a.passCount) return b.passCount - a.passCount;
            return b.compositeOOS.avgPF - a.compositeOOS.avgPF;
        });

        for (let i = 0; i < sorted.length; i++) {
            const r = sorted[i];
            const candidate = CANDIDATES.find(c => c.signalCode === r.signalCode)!;
            const icon = r.overallPass ? '✅' : '❌';
            const pf = r.compositeOOS.avgPF >= 999 ? '  ∞' : r.compositeOOS.avgPF.toFixed(2);
            console.log(
                `  ${String(i + 1).padStart(1)} │ ${candidate.label.padEnd(32)} │ ${String(r.passCount).padStart(4)} │ ${`${r.passCount}/${r.totalFolds}`.padStart(5)} │ ${String(pf).padStart(6)} │ ${r.compositeOOS.avgWR.toFixed(1).padStart(6)} │ ${String(r.compositeOOS.totalTrades).padStart(10)} │ $${r.compositeOOS.totalNetPnl.toFixed(0).padStart(8)} │ ${icon}`,
            );
        }
        console.log();

        // ─── Comparison with baseline ───────────────────────────────────────

        console.log('  Baseline: Asian Break 2H → 9/13 pass (69%), below 75% gate');
        console.log();

        // ─── Save Results ───────────────────────────────────────────────────

        const artifactDir = path.join(process.cwd(), '.artifacts', 'walk-forward');
        if (!fs.existsSync(artifactDir)) fs.mkdirSync(artifactDir, { recursive: true });

        const dateStr = new Date().toISOString().slice(0, 10);
        const filename = `2h-sweep-${dateStr}.json`;
        const filepath = path.join(artifactDir, filename);

        const output = {
            sweep: '2H Walk-Forward Sweep',
            date: dateStr,
            config: RUN_CONFIG,
            gate: GATE,
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
