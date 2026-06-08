/**
 * Walk-Forward 4H Sweep
 *
 * Tests the current higher-timeframe XAU long candidates on the canonical
 * walk-forward gate with WR delta disabled.
 *
 * Usage:
 *   npx ts-node src/scripts/runWalkForward4H.ts
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

const CANDIDATES: WfCandidate[] = [
    {
        signalCode: 'SYS_T1_OB_FIB_LONG',
        signalVersion: 1,
        symbol: 'XAUUSD',
        timeframe: '4h',
        label: 'OB+Fib 4H',
        execConfig: { ...BASE_EXEC },
        initialEquity: 10000,
        riskPercent: 1.5,
    },
    {
        signalCode: 'SYS_4TF_CHOCH_BOS_LONG',
        signalVersion: 1,
        symbol: 'XAUUSD',
        timeframe: '4h',
        label: 'CHoCH+BOS 4H',
        execConfig: { ...BASE_EXEC },
        initialEquity: 10000,
        riskPercent: 1.5,
    },
    {
        signalCode: 'SYS_T1_SESSION_BURST_LONG',
        signalVersion: 1,
        symbol: 'XAUUSD',
        timeframe: '4h',
        label: 'Session Burst 4H',
        execConfig: { ...BASE_EXEC },
        initialEquity: 10000,
        riskPercent: 1.5,
    },
    {
        signalCode: 'SYS_4TF_BOS_FVG_LONG',
        signalVersion: 2,
        symbol: 'XAUUSD',
        timeframe: '4h',
        label: 'BOS+FVG 4H v2',
        execConfig: { ...BASE_EXEC },
        initialEquity: 10000,
        riskPercent: 1.5,
    },
    {
        signalCode: 'SYS_4TF_BOS_FVG_ADX_LONG',
        signalVersion: 1,
        symbol: 'XAUUSD',
        timeframe: '4h',
        label: 'BOS+FVG+ADX 4H',
        execConfig: { ...BASE_EXEC },
        initialEquity: 10000,
        riskPercent: 1.5,
    },
    {
        signalCode: 'SYS_4TF_PD_LEVEL_BREAK_LONG',
        signalVersion: 2,
        symbol: 'XAUUSD',
        timeframe: '4h',
        label: 'PD Level Break 4H v2',
        execConfig: { ...BASE_EXEC },
        initialEquity: 10000,
        riskPercent: 1.5,
    },
    {
        signalCode: 'SYS_4TF_PD_LEVEL_BREAK_LONG_H4',
        signalVersion: 1,
        symbol: 'XAUUSD',
        timeframe: '4h',
        label: 'PD Level Break 4H H4-opt',
        execConfig: { ...BASE_EXEC },
        initialEquity: 10000,
        riskPercent: 1.5,
    },
];

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

async function main() {
    const prisma = new PrismaClient();
    const registry = createDefaultBlockRegistry();
    const backtests = new SignalBacktestRunService(prisma);
    const exec = new SignalBacktestExecutionService(prisma);

    try {
        await upsertTier1ComposedSignals(prisma, registry);

        const engine = new WalkForwardEngine(prisma, backtests, exec);
        const allResults: WalkForwardResult[] = [];

        console.log('\n' + '='.repeat(88));
        console.log('  4H LONG WALK-FORWARD SWEEP');
        console.log('  Gate: PF>=1.30 | DD<=15% | WR delta=OFF | pass ratio>=75%');
        console.log('='.repeat(88) + '\n');

        for (let i = 0; i < CANDIDATES.length; i++) {
            const candidate = CANDIDATES[i];
            console.log('\n' + '#'.repeat(88));
            console.log(`  [${i + 1}/${CANDIDATES.length}] ${candidate.label} (${candidate.signalCode}@${candidate.signalVersion})`);
            console.log('#'.repeat(88));

            try {
                const result = await engine.run(candidate, RUN_CONFIG, GATE);
                allResults.push(result);
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                console.error(`  ERROR running ${candidate.label}: ${message}`);
                allResults.push({
                    signalCode: candidate.signalCode,
                    timeframe: candidate.timeframe,
                    config: {
                        trainMonths: RUN_CONFIG.trainMonths,
                        testMonths: RUN_CONFIG.testMonths,
                        stepMonths: RUN_CONFIG.stepMonths,
                    },
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

        const sorted = [...allResults].sort((a, b) => {
            if (b.passCount !== a.passCount) return b.passCount - a.passCount;
            return b.compositeOOS.avgPF - a.compositeOOS.avgPF;
        });

        console.log('\n' + '='.repeat(112));
        console.log('  4H WALK-FORWARD LEADERBOARD');
        console.log('='.repeat(112));
        console.log('  # | Signal                          | Pass | Folds | OOS Trades | OOS PnL    | Avg PF | Avg WR | Verdict');
        console.log('  --+---------------------------------+------+-------+------------+------------+--------+--------+--------');

        for (let i = 0; i < sorted.length; i++) {
            const result = sorted[i];
            const candidate = CANDIDATES.find(entry =>
                entry.signalCode === result.signalCode && entry.timeframe === result.timeframe,
            );
            const label = candidate?.label ?? result.signalCode;
            const verdict = result.overallPass ? 'PASS' : 'FAIL';
            const pnl = result.compositeOOS.totalNetPnl >= 0
                ? `+$${result.compositeOOS.totalNetPnl.toFixed(0)}`
                : `-$${Math.abs(result.compositeOOS.totalNetPnl).toFixed(0)}`;

            console.log(
                `  ${String(i + 1).padStart(2)} | ${label.padEnd(31)} | ${String(result.passCount).padStart(2)}/${String(result.totalFolds).padEnd(2)} | ${String(result.totalFolds).padStart(5)} | ${String(result.compositeOOS.totalTrades).padStart(10)} | ${pnl.padStart(10)} | ${result.compositeOOS.avgPF.toFixed(2).padStart(6)} | ${result.compositeOOS.avgWR.toFixed(1).padStart(5)}% | ${verdict}`,
            );
        }

        const artifactDir = path.join(process.cwd(), '.artifacts', 'walk-forward');
        if (!fs.existsSync(artifactDir)) fs.mkdirSync(artifactDir, { recursive: true });

        const dateStr = new Date().toISOString().slice(0, 10);
        const filename = `4h-sweep-${dateStr}.json`;
        const filepath = path.join(artifactDir, filename);

        fs.writeFileSync(filepath, JSON.stringify({
            sweep: '4H Walk-Forward Sweep',
            date: dateStr,
            config: RUN_CONFIG,
            gate: GATE,
            candidates: CANDIDATES.map(candidate => ({
                signalCode: candidate.signalCode,
                signalVersion: candidate.signalVersion,
                label: candidate.label,
            })),
            results: allResults,
            leaderboard: sorted.map((result, index) => ({
                rank: index + 1,
                signalCode: result.signalCode,
                label: CANDIDATES.find(candidate =>
                    candidate.signalCode === result.signalCode && candidate.timeframe === result.timeframe,
                )?.label ?? result.signalCode,
                passCount: result.passCount,
                totalFolds: result.totalFolds,
                overallPass: result.overallPass,
                compositeOOS: result.compositeOOS,
            })),
        }, null, 2));

        console.log();
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
