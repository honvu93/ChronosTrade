/**
 * Walk-Forward Validation -- 1H Guarded Strategy Sweep
 *
 * Tests 2 high-PnL 1H strategies with 3 guard profiles (TIGHT, MODERATE, LOOSE)
 * to find configurations that control drawdown while preserving edge.
 *
 * Key insight: guards + compound is toxic, so all tests use NON-COMPOUND 1.5% risk.
 *
 * Config: 12mo train, 6mo test, 6mo step over 2019-01-01 to 2026-03-14
 * Gate:   PF>=1.30, DD<=15%, WR delta<=8pp, pass ratio>=0.75
 *
 * Candidates (6 total = 2 strategies x 3 guard profiles):
 *   1. SYS_T1_SESSION_BURST_LONG  + TIGHT / MODERATE / LOOSE
 *   2. SYS_4TF_PD_LEVEL_BREAK_LONG v2 + TIGHT / MODERATE / LOOSE
 *
 * Usage:
 *   npx ts-node src/scripts/runWalkForward1HGuarded.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { SignalBacktestExecutionService } from '../services/signals/SignalBacktestExecutionService';
import { SignalBacktestRunService } from '../services/signals/SignalBacktestRunService';
import { createDefaultBlockRegistry } from '../services/signals/blocks/createDefaultBlockRegistry';
import { upsertTier1ComposedSignals } from '../services/signals/tier1ComposedSignals';
import { ExecutionConfigInput, TradeGuardConfigInput } from '../services/signals/types';
import { WalkForwardEngine, WfCandidate, WfRunConfig } from '../services/signals/optimization/WalkForwardEngine';
import { WalkForwardGate, WalkForwardResult } from '../services/signals/optimization/optimizationTypes';

dotenv.config();

// -- Guard Profiles -----------------------------------------------------------

const TIGHT_GUARDS: TradeGuardConfigInput = {
    lossStreakCooldown: { afterLosses: 3, cooldownMinutes: 360 },
    dayLossCap: { maxLosses: 2, maxNetR: 2 },
    equityCurveFilter: { emaTrades: 15, action: 'BLOCK' },
    maxDrawdownHalt: { maxDrawdownPct: 8 },
    minTradeSpacing: { minSpacingMinutes: 240 },
    entryBurstCooldown: { maxEntriesInWindow: 2, windowMinutes: 480, cooldownMinutes: 720 },
};

const MODERATE_GUARDS: TradeGuardConfigInput = {
    lossStreakCooldown: { afterLosses: 3, cooldownMinutes: 240 },
    dayLossCap: { maxLosses: 3, maxNetR: 3 },
    equityCurveFilter: { emaTrades: 20, action: 'HALF_RISK' },
    maxDrawdownHalt: { maxDrawdownPct: 10 },
    minTradeSpacing: { minSpacingMinutes: 120 },
};

const LOOSE_GUARDS: TradeGuardConfigInput = {
    lossStreakCooldown: { afterLosses: 4, cooldownMinutes: 360 },
    dayLossCap: { maxLosses: 4, maxNetR: 4 },
    equityCurveFilter: { emaTrades: 25, action: 'HALF_RISK' },
    maxDrawdownHalt: { maxDrawdownPct: 12 },
    minTradeSpacing: { minSpacingMinutes: 60 },
};

// -- Execution Config ---------------------------------------------------------

function makeExecConfig(guards: TradeGuardConfigInput): ExecutionConfigInput {
    return {
        entryFeeBps: 4,
        exitFeeBps: 4,
        entrySlippageBps: 2,
        exitSlippageBps: 2,
        orderTiming: 'NEXT_BAR_OPEN',
        stopLoss: { mode: 'SIGNAL_PRICE' },
        takeProfit: { mode: 'SIGNAL_PRICE' },
        positionSizing: { mode: 'RISK_BASED' },
        tradeGuards: guards,
    };
}

// -- Candidates ---------------------------------------------------------------

const GUARD_PROFILES: Array<{ label: string; guards: TradeGuardConfigInput }> = [
    { label: 'TIGHT',    guards: TIGHT_GUARDS },
    { label: 'MODERATE', guards: MODERATE_GUARDS },
    { label: 'LOOSE',    guards: LOOSE_GUARDS },
];

const STRATEGIES: Array<{ signalCode: string; signalVersion: number; shortName: string }> = [
    { signalCode: 'SYS_T1_SESSION_BURST_LONG',   signalVersion: 1, shortName: 'Session Burst' },
    { signalCode: 'SYS_4TF_PD_LEVEL_BREAK_LONG', signalVersion: 2, shortName: 'PD Level Break v2' },
];

const CANDIDATES: WfCandidate[] = [];
for (const strat of STRATEGIES) {
    for (const profile of GUARD_PROFILES) {
        CANDIDATES.push({
            signalCode: strat.signalCode,
            signalVersion: strat.signalVersion,
            symbol: 'XAUUSD',
            timeframe: '1h',
            label: `${strat.shortName} H1 + ${profile.label}`,
            execConfig: makeExecConfig(profile.guards),
            initialEquity: 10000,
            riskPercent: 1.5,
        });
    }
}

// -- Walk-Forward Config ------------------------------------------------------

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

// -- Main ---------------------------------------------------------------------

async function main() {
    const prisma = new PrismaClient();
    const registry = createDefaultBlockRegistry();
    const backtests = new SignalBacktestRunService(prisma);
    const exec = new SignalBacktestExecutionService(prisma);

    try {
        await upsertTier1ComposedSignals(prisma, registry);

        const engine = new WalkForwardEngine(prisma, backtests, exec);
        const allResults: WalkForwardResult[] = [];

        console.log('\n' + '='.repeat(80));
        console.log('  1H GUARDED WALK-FORWARD SWEEP -- 6 Candidates');
        console.log('  2 strategies x 3 guard profiles (TIGHT / MODERATE / LOOSE)');
        console.log('  NON-COMPOUND 1.5% risk (guards + compound = toxic)');
        console.log('  Gate: PF>=1.30 | DD<=15% | WR delta<=8pp | pass ratio>=75%');
        console.log('='.repeat(80) + '\n');

        for (let i = 0; i < CANDIDATES.length; i++) {
            const candidate = CANDIDATES[i];
            console.log(`\n${'#'.repeat(80)}`);
            console.log(`  [${i + 1}/${CANDIDATES.length}] ${candidate.label} (${candidate.signalCode})`);
            console.log('#'.repeat(80));

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

        // -- Save Results ---------------------------------------------------------
        const artifactDir = path.join(process.cwd(), '.artifacts', 'walk-forward');
        if (!fs.existsSync(artifactDir)) fs.mkdirSync(artifactDir, { recursive: true });

        const filename = '1h-guarded-sweep-2026-03-26.json';
        const filepath = path.join(artifactDir, filename);

        // Attach guard profile label to each result for easier parsing
        const enrichedResults = allResults.map((r, idx) => ({
            ...r,
            guardProfile: GUARD_PROFILES[idx % GUARD_PROFILES.length].label,
            candidateLabel: CANDIDATES[idx].label,
        }));

        fs.writeFileSync(filepath, JSON.stringify(enrichedResults, null, 2));
        console.log(`\n  Saved: .artifacts/walk-forward/${filename}`);

        // -- Leaderboard ----------------------------------------------------------
        const sorted = [...enrichedResults].sort((a, b) => {
            // Pass status first, then pass count, then composite PnL
            if (a.overallPass !== b.overallPass) return a.overallPass ? -1 : 1;
            if (b.passCount !== a.passCount) return b.passCount - a.passCount;
            return b.compositeOOS.totalNetPnl - a.compositeOOS.totalNetPnl;
        });

        console.log('\n' + '='.repeat(120));
        console.log('  FINAL LEADERBOARD -- 1H GUARDED Walk-Forward');
        console.log('='.repeat(120));
        console.log('  Rank | Candidate                                    | Guard    | Pass  | Folds | OOS Trades | OOS PnL    | Avg PF | Avg WR | Verdict');
        console.log('  -----+----------------------------------------------+----------+-------+-------+------------+------------+--------+--------+--------');

        for (let i = 0; i < sorted.length; i++) {
            const r = sorted[i];
            const verdict = r.overallPass ? 'GO-LIVE' : 'FAIL';
            const icon = r.overallPass ? '>>>' : '   ';
            const pnlStr = r.compositeOOS.totalNetPnl >= 0
                ? `+$${r.compositeOOS.totalNetPnl.toFixed(0)}`.padStart(10)
                : `-$${Math.abs(r.compositeOOS.totalNetPnl).toFixed(0)}`.padStart(10);

            console.log(
                `  ${icon}${String(i + 1).padStart(1)} | ${r.candidateLabel.padEnd(44)} | ${r.guardProfile.padEnd(8)} | ${String(r.passCount).padStart(2)}/${String(r.totalFolds).padStart(2)}  | ${String(r.totalFolds).padStart(5)} | ${String(r.compositeOOS.totalTrades).padStart(10)} | ${pnlStr} | ${r.compositeOOS.avgPF.toFixed(2).padStart(6)} | ${r.compositeOOS.avgWR.toFixed(1).padStart(5)}% | ${verdict}`,
            );
        }

        console.log();

        // -- Summary --------------------------------------------------------------
        const goLive = sorted.filter(r => r.overallPass);
        if (goLive.length > 0) {
            console.log(`  GO-LIVE CANDIDATES (${goLive.length}):`);
            for (const r of goLive) {
                console.log(`    - ${r.candidateLabel}: ${r.passCount}/${r.totalFolds} folds, OOS PnL $${r.compositeOOS.totalNetPnl.toFixed(2)}, avg PF ${r.compositeOOS.avgPF.toFixed(2)}`);
            }
        } else {
            console.log('  NO GO-LIVE CANDIDATES -- all guarded 1H strategies failed walk-forward gate');
        }

        // Close misses
        const borderline = sorted.filter(r => !r.overallPass && r.passCount > 0);
        if (borderline.length > 0) {
            console.log(`\n  BORDERLINE (partial pass, ${borderline.length}):`);
            for (const r of borderline) {
                console.log(`    - ${r.candidateLabel}: ${r.passCount}/${r.totalFolds} folds, OOS PnL $${r.compositeOOS.totalNetPnl.toFixed(2)}`);
            }
        }

        // Guard profile comparison
        console.log('\n' + '-'.repeat(80));
        console.log('  GUARD PROFILE COMPARISON');
        console.log('-'.repeat(80));
        for (const strat of STRATEGIES) {
            console.log(`\n  ${strat.shortName} (${strat.signalCode}):`);
            for (const profile of GUARD_PROFILES) {
                const match = enrichedResults.find(
                    r => r.signalCode === strat.signalCode && r.guardProfile === profile.label,
                );
                if (match) {
                    const status = match.overallPass ? 'PASS' : 'FAIL';
                    console.log(
                        `    ${profile.label.padEnd(10)} => ${status} (${match.passCount}/${match.totalFolds} folds) | ` +
                        `trades=${match.compositeOOS.totalTrades} | PnL=$${match.compositeOOS.totalNetPnl.toFixed(0)} | ` +
                        `PF=${match.compositeOOS.avgPF.toFixed(2)} | WR=${match.compositeOOS.avgWR.toFixed(1)}%`,
                    );
                }
            }
        }

        console.log('\n');

    } finally {
        await prisma.$disconnect();
    }
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
