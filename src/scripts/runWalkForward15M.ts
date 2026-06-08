/**
 * Walk-Forward Validation: 15M LONG Strategies (Reduced Risk 0.5%)
 *
 * Re-tests 15M strategies that were dropped due to DD >200% at 1.5% risk.
 * Uses 0.5% risk to determine if lower risk controls the DD explosion.
 *
 * Candidates (all XAUUSD, 15m, 0.5% risk, non-compound):
 *   1. SYS_XAU_PDL_SWEEP_RECLAIM_LONG v1
 *   2. SYS_XAU_ASIAN_SWEEP_REVERSAL_LONG v1
 *   3. SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG v1
 *   4. SYS_XAU_ASIAN_HIGH_RETEST_LONG v1
 *   5. SYS_XAU_NY_SESSION_BOS_LONG v1
 *   6. SYS_XAU_PDH_BREAK_LONG v1
 *   7. SYS_4TF_CHOCH_BOS_LONG v1
 *   8. SYS_4TF_LONDON_BURST_LONG v1
 *
 * Usage:
 *   npx ts-node src/scripts/runWalkForward15M.ts
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

// --- Execution Config ---

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

// --- All 8 candidates: 15M LONG, 0.5% risk, non-compound ---

const CANDIDATES: WfCandidate[] = [
    {
        signalCode: 'SYS_XAU_PDL_SWEEP_RECLAIM_LONG',
        signalVersion: 1,
        symbol: 'XAUUSD',
        timeframe: '15m',
        label: 'PDL Sweep Reclaim 15M (0.5%)',
        execConfig: { ...BASE_EXEC },
        initialEquity: 10000,
        riskPercent: 0.5,
    },
    {
        signalCode: 'SYS_XAU_ASIAN_SWEEP_REVERSAL_LONG',
        signalVersion: 1,
        symbol: 'XAUUSD',
        timeframe: '15m',
        label: 'Asian Sweep Reversal 15M (0.5%)',
        execConfig: { ...BASE_EXEC },
        initialEquity: 10000,
        riskPercent: 0.5,
    },
    {
        signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG',
        signalVersion: 1,
        symbol: 'XAUUSD',
        timeframe: '15m',
        label: 'Asian Break Continuation 15M (0.5%)',
        execConfig: { ...BASE_EXEC },
        initialEquity: 10000,
        riskPercent: 0.5,
    },
    {
        signalCode: 'SYS_XAU_ASIAN_HIGH_RETEST_LONG',
        signalVersion: 1,
        symbol: 'XAUUSD',
        timeframe: '15m',
        label: 'Asian High Retest 15M (0.5%)',
        execConfig: { ...BASE_EXEC },
        initialEquity: 10000,
        riskPercent: 0.5,
    },
    {
        signalCode: 'SYS_XAU_NY_SESSION_BOS_LONG',
        signalVersion: 1,
        symbol: 'XAUUSD',
        timeframe: '15m',
        label: 'NY Session BOS 15M (0.5%)',
        execConfig: { ...BASE_EXEC },
        initialEquity: 10000,
        riskPercent: 0.5,
    },
    {
        signalCode: 'SYS_XAU_PDH_BREAK_LONG',
        signalVersion: 1,
        symbol: 'XAUUSD',
        timeframe: '15m',
        label: 'PDH Break 15M (0.5%)',
        execConfig: { ...BASE_EXEC },
        initialEquity: 10000,
        riskPercent: 0.5,
    },
    {
        signalCode: 'SYS_4TF_CHOCH_BOS_LONG',
        signalVersion: 1,
        symbol: 'XAUUSD',
        timeframe: '15m',
        label: 'CHoCH BOS 15M (0.5%)',
        execConfig: { ...BASE_EXEC },
        initialEquity: 10000,
        riskPercent: 0.5,
    },
    {
        signalCode: 'SYS_4TF_LONDON_BURST_LONG',
        signalVersion: 1,
        symbol: 'XAUUSD',
        timeframe: '15m',
        label: 'London Burst 15M (0.5%)',
        execConfig: { ...BASE_EXEC },
        initialEquity: 10000,
        riskPercent: 0.5,
    },
];

// --- Walk-Forward Config ---

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

// --- Main ---

interface LeaderboardEntry {
    label: string;
    signalCode: string;
    overallPass: boolean;
    passCount: number;
    totalFolds: number;
    avgPF: number;
    avgWR: number;
    totalTrades: number;
    totalPnl: number;
    durationSec: number;
    error?: string;
}

async function main() {
    const prisma = new PrismaClient();
    const registry = createDefaultBlockRegistry();
    const backtests = new SignalBacktestRunService(prisma);
    const exec = new SignalBacktestExecutionService(prisma);

    const leaderboard: LeaderboardEntry[] = [];
    const allResults: Record<string, WalkForwardResult> = {};
    const startMs = Date.now();

    try {
        await upsertTier1ComposedSignals(prisma, registry);

        const engine = new WalkForwardEngine(prisma, backtests, exec);

        for (let i = 0; i < CANDIDATES.length; i++) {
            const candidate = CANDIDATES[i];
            console.log(`\n${'#'.repeat(80)}`);
            console.log(`  [${i + 1}/${CANDIDATES.length}] ${candidate.label}`);
            console.log(`${'#'.repeat(80)}\n`);

            try {
                const result = await engine.run(candidate, RUN_CONFIG, GATE);
                allResults[candidate.signalCode] = result;

                leaderboard.push({
                    label: candidate.label,
                    signalCode: candidate.signalCode,
                    overallPass: result.overallPass,
                    passCount: result.passCount,
                    totalFolds: result.totalFolds,
                    avgPF: result.compositeOOS.avgPF,
                    avgWR: result.compositeOOS.avgWR,
                    totalTrades: result.compositeOOS.totalTrades,
                    totalPnl: result.compositeOOS.totalNetPnl,
                    durationSec: result.durationSec,
                });
            } catch (err: any) {
                console.error(`  ERROR running ${candidate.label}: ${err.message}`);
                leaderboard.push({
                    label: candidate.label,
                    signalCode: candidate.signalCode,
                    overallPass: false,
                    passCount: 0,
                    totalFolds: 0,
                    avgPF: 0,
                    avgWR: 0,
                    totalTrades: 0,
                    totalPnl: 0,
                    durationSec: 0,
                    error: err.message,
                });
            }
        }

        // --- Save results ---
        const artifactDir = path.join(process.cwd(), '.artifacts', 'walk-forward');
        if (!fs.existsSync(artifactDir)) fs.mkdirSync(artifactDir, { recursive: true });

        const dateStr = new Date().toISOString().slice(0, 10);
        const filename = `15m-sweep-${dateStr}.json`;
        const filepath = path.join(artifactDir, filename);

        fs.writeFileSync(filepath, JSON.stringify({
            meta: {
                description: '15M LONG walk-forward validation at 0.5% risk',
                riskPercent: 0.5,
                gate: GATE,
                runConfig: RUN_CONFIG,
                ranAt: new Date().toISOString(),
                totalDurationSec: (Date.now() - startMs) / 1000,
            },
            leaderboard,
            results: allResults,
        }, null, 2));

        console.log(`\n  Saved: .artifacts/walk-forward/${filename}`);

        // --- Final Leaderboard ---
        const totalDuration = (Date.now() - startMs) / 1000;

        console.log(`\n${'='.repeat(100)}`);
        console.log('  15M WALK-FORWARD LEADERBOARD (0.5% risk, non-compound)');
        console.log('='.repeat(100));

        // Sort: passed first, then by avgPF desc
        const sorted = [...leaderboard].sort((a, b) => {
            if (a.overallPass !== b.overallPass) return a.overallPass ? -1 : 1;
            return b.avgPF - a.avgPF;
        });

        console.log('  # | Strategy                                  | Pass | Folds  |  PF  |  WR%  | Trades | PnL ($)    | Time');
        console.log('  --+---------------------------------------------+------+--------+------+-------+--------+------------+------');

        for (let i = 0; i < sorted.length; i++) {
            const e = sorted[i];
            if (e.error) {
                console.log(`  ${String(i + 1).padStart(2)} | ${e.label.padEnd(43)} | ERR  | ${e.error.slice(0, 50)}`);
                continue;
            }
            const icon = e.overallPass ? 'PASS' : 'FAIL';
            const folds = `${e.passCount}/${e.totalFolds}`;
            console.log(
                `  ${String(i + 1).padStart(2)} | ${e.label.padEnd(43)} | ${icon} | ${folds.padStart(6)} | ${e.avgPF.toFixed(2).padStart(4)} | ${e.avgWR.toFixed(1).padStart(5)} | ${String(e.totalTrades).padStart(6)} | ${e.totalPnl.toFixed(2).padStart(10)} | ${e.durationSec.toFixed(0).padStart(4)}s`,
            );
        }

        const passedCount = sorted.filter(e => e.overallPass).length;

        console.log();
        console.log(`  Total: ${passedCount}/${sorted.length} passed | Duration: ${totalDuration.toFixed(0)}s`);

        if (passedCount === 0) {
            console.log('\n  CONCLUSION: All 15M strategies FAIL walk-forward at 0.5% risk.');
            console.log('  15M timeframe is CONFIRMED DEAD for XAU LONG strategies.');
        } else {
            console.log(`\n  CONCLUSION: ${passedCount} strategy(ies) passed! 15M may be viable at reduced risk.`);
        }

        console.log('='.repeat(100));

        process.exit(passedCount > 0 ? 0 : 1);
    } finally {
        await prisma.$disconnect();
    }
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
