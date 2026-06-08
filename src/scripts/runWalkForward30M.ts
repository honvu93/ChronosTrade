/**
 * Walk-Forward Validation: 30M Timeframe Sweep
 *
 * Tests native 30M strategies AND key 15M strategies on 30M to see if
 * the intermediate timeframe reduces the DD explosion seen on 15M.
 *
 * Candidates:
 *   1. SYS_T1_SESSION_BURST_LONG          — Native 30M signal
 *   2. SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG — 15M strategy on 30M
 *   3. SYS_XAU_ASIAN_SWEEP_REVERSAL_LONG  — 15M strategy on 30M
 *   4. SYS_XAU_PDL_SWEEP_RECLAIM_LONG     — 15M strategy on 30M
 *   5. SYS_4TF_LONDON_BURST_LONG          — 15M strategy on 30M
 *   6. SYS_4TF_CHOCH_BOS_LONG             — 15M strategy on 30M
 *
 * Usage:
 *   npx ts-node src/scripts/runWalkForward30M.ts
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

// ─── All 6 Candidates ──────────────────────────────────────────────────────

const CANDIDATES: WfCandidate[] = [
    {
        signalCode: 'SYS_T1_SESSION_BURST_LONG',
        signalVersion: 1,
        symbol: 'XAUUSD',
        timeframe: '30m',
        label: 'Session Burst 30M (native)',
        execConfig: { ...BASE_EXEC },
        initialEquity: 10000,
        riskPercent: 1.0,
    },
    {
        signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG',
        signalVersion: 1,
        symbol: 'XAUUSD',
        timeframe: '30m',
        label: 'Asian Break Continuation 30M (from 15M)',
        execConfig: { ...BASE_EXEC },
        initialEquity: 10000,
        riskPercent: 1.0,
    },
    {
        signalCode: 'SYS_XAU_ASIAN_SWEEP_REVERSAL_LONG',
        signalVersion: 1,
        symbol: 'XAUUSD',
        timeframe: '30m',
        label: 'Asian Sweep Reversal 30M (from 15M)',
        execConfig: { ...BASE_EXEC },
        initialEquity: 10000,
        riskPercent: 1.0,
    },
    {
        signalCode: 'SYS_XAU_PDL_SWEEP_RECLAIM_LONG',
        signalVersion: 1,
        symbol: 'XAUUSD',
        timeframe: '30m',
        label: 'PDL Sweep Reclaim 30M (from 15M)',
        execConfig: { ...BASE_EXEC },
        initialEquity: 10000,
        riskPercent: 1.0,
    },
    {
        signalCode: 'SYS_4TF_LONDON_BURST_LONG',
        signalVersion: 1,
        symbol: 'XAUUSD',
        timeframe: '30m',
        label: 'London Burst 30M (from 15M)',
        execConfig: { ...BASE_EXEC },
        initialEquity: 10000,
        riskPercent: 1.0,
    },
    {
        signalCode: 'SYS_4TF_CHOCH_BOS_LONG',
        signalVersion: 1,
        symbol: 'XAUUSD',
        timeframe: '30m',
        label: 'CHoCH+BOS 30M (from 15M)',
        execConfig: { ...BASE_EXEC },
        initialEquity: 10000,
        riskPercent: 1.0,
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
    maxWrDeltaPP: 8,
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
            console.log(`\n${'#'.repeat(80)}`);
            console.log(`# CANDIDATE: ${candidate.label}`);
            console.log(`${'#'.repeat(80)}`);

            try {
                const result = await engine.run(candidate, RUN_CONFIG, GATE);
                allResults.push(result);
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`  SKIPPED: ${candidate.label} — ${msg}`);
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

        // ─── Save Results ────────────────────────────────────────────────────
        const artifactDir = path.join(process.cwd(), '.artifacts', 'walk-forward');
        if (!fs.existsSync(artifactDir)) fs.mkdirSync(artifactDir, { recursive: true });

        const dateStr = new Date().toISOString().slice(0, 10);
        const filename = `30m-sweep-${dateStr}.json`;
        const filepath = path.join(artifactDir, filename);

        fs.writeFileSync(filepath, JSON.stringify(allResults, null, 2));
        console.log(`\nSaved: .artifacts/walk-forward/${filename}`);

        // ─── Final Leaderboard ───────────────────────────────────────────────
        console.log(`\n${'═'.repeat(100)}`);
        console.log('  30M WALK-FORWARD LEADERBOARD');
        console.log('═'.repeat(100));
        console.log('  # │ Signal                                     │ Pass  │ Folds │ OOS Trades │ OOS PnL   │ Avg PF │ Avg WR │ Result');
        console.log('  ──┼────────────────────────────────────────────┼───────┼───────┼────────────┼───────────┼────────┼────────┼───────');

        const sorted = [...allResults].sort((a, b) => {
            if (a.overallPass !== b.overallPass) return a.overallPass ? -1 : 1;
            return b.compositeOOS.avgPF - a.compositeOOS.avgPF;
        });

        sorted.forEach((r, i) => {
            const icon = r.overallPass ? 'PASS' : 'FAIL';
            const label = CANDIDATES.find(c => c.signalCode === r.signalCode)?.label ?? r.signalCode;
            const truncLabel = label.length > 42 ? label.slice(0, 42) : label;
            console.log(
                `  ${String(i + 1).padStart(1)} │ ${truncLabel.padEnd(42)} │ ${String(r.passCount).padStart(2)}/${String(r.totalFolds).padStart(2)} │ ${String(r.totalFolds).padStart(5)} │ ${String(r.compositeOOS.totalTrades).padStart(10)} │ $${r.compositeOOS.totalNetPnl.toFixed(0).padStart(8)} │ ${r.compositeOOS.avgPF.toFixed(2).padStart(6)} │ ${r.compositeOOS.avgWR.toFixed(1).padStart(5)}% │ ${icon}`,
            );
        });

        console.log('═'.repeat(100));

        // Count passes
        const passCount = allResults.filter(r => r.overallPass).length;
        console.log(`\n  ${passCount}/${allResults.length} candidates passed walk-forward validation on 30M timeframe.`);
        console.log();

    } finally {
        await prisma.$disconnect();
    }
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
