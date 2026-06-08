/**
 * Walk-Forward 4H Guarded PD Level Break Sweep
 *
 * Tests PD Level Break LONG v2 on 4H with 3 guard profiles.
 * Based on Priority 1 findings: guards unlikely to improve pass rate (structural issue).
 * Running as quick validation before portfolio assembly.
 *
 * Baseline (unguarded): 8/13 pass, +$17,040 OOS PnL
 * Fail folds: 0-3 (2020-2021), 12 (2026Q1)
 * 8 consecutive pass folds 4-11 (2022H1→2026H1)
 *
 * Usage:
 *   npx ts-node src/scripts/runWalkForward4HGuardedPdLevel.ts
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

// ─── Guard Profiles (adapted for 4H — wider spacing) ───────────────────────

const TIGHT_GUARDS: TradeGuardConfigInput = {
    lossStreakCooldown: { afterLosses: 3, cooldownMinutes: 720 },
    dayLossCap: { maxLosses: 2, maxNetR: 2 },
    equityCurveFilter: { emaTrades: 12, action: 'BLOCK' },
    maxDrawdownHalt: { maxDrawdownPct: 8 },
    minTradeSpacing: { minSpacingMinutes: 480 },
};

const MODERATE_GUARDS: TradeGuardConfigInput = {
    lossStreakCooldown: { afterLosses: 3, cooldownMinutes: 480 },
    dayLossCap: { maxLosses: 3, maxNetR: 3 },
    equityCurveFilter: { emaTrades: 15, action: 'HALF_RISK' },
    maxDrawdownHalt: { maxDrawdownPct: 12 },
    minTradeSpacing: { minSpacingMinutes: 240 },
};

const LOOSE_GUARDS: TradeGuardConfigInput = {
    lossStreakCooldown: { afterLosses: 4, cooldownMinutes: 480 },
    dayLossCap: { maxLosses: 4, maxNetR: 4 },
    equityCurveFilter: { emaTrades: 20, action: 'HALF_RISK' },
    maxDrawdownHalt: { maxDrawdownPct: 15 },
    minTradeSpacing: { minSpacingMinutes: 120 },
};

// ─── Execution Config ───────────────────────────────────────────────────────

function makeExecConfig(guards?: TradeGuardConfigInput): ExecutionConfigInput {
    return {
        entryFeeBps: 4,
        exitFeeBps: 4,
        entrySlippageBps: 2,
        exitSlippageBps: 2,
        orderTiming: 'NEXT_BAR_OPEN',
        stopLoss: { mode: 'SIGNAL_PRICE' },
        takeProfit: { mode: 'SIGNAL_PRICE' },
        positionSizing: { mode: 'RISK_BASED' },
        ...(guards ? { tradeGuards: guards } : {}),
    };
}

// ─── Candidates ─────────────────────────────────────────────────────────────

const GUARD_PROFILES: Array<{ label: string; guards: TradeGuardConfigInput }> = [
    { label: 'TIGHT', guards: TIGHT_GUARDS },
    { label: 'MODERATE', guards: MODERATE_GUARDS },
    { label: 'LOOSE', guards: LOOSE_GUARDS },
];

const CANDIDATES: WfCandidate[] = GUARD_PROFILES.map(profile => ({
    signalCode: 'SYS_4TF_PD_LEVEL_BREAK_LONG',
    signalVersion: 2,
    symbol: 'XAUUSD',
    timeframe: '4h',
    label: `PD Level Break 4H + ${profile.label}`,
    execConfig: makeExecConfig(profile.guards),
    initialEquity: 10000,
    riskPercent: 1.5,
}));

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
        const allResults: Array<WalkForwardResult & { guardProfile: string; candidateLabel: string }> = [];

        console.log('\n' + '█'.repeat(80));
        console.log('  PD LEVEL BREAK 4H — GUARD PROFILE SWEEP');
        console.log('  Baseline (unguarded): 8/13 pass, +$17,040 OOS PnL');
        console.log('  Fail folds: 0-3 (2020-2021 ranging), 12 (2026Q1 short window)');
        console.log('█'.repeat(80));

        for (let i = 0; i < CANDIDATES.length; i++) {
            const candidate = CANDIDATES[i];
            console.log(`\n${'#'.repeat(80)}`);
            console.log(`  [${i + 1}/${CANDIDATES.length}] ${candidate.label}`);
            console.log('#'.repeat(80));

            try {
                const result = await engine.run(candidate, RUN_CONFIG, GATE);
                allResults.push({
                    ...result,
                    guardProfile: GUARD_PROFILES[i].label,
                    candidateLabel: candidate.label,
                });
            } catch (err: any) {
                console.error(`  ERROR: ${err.message}`);
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
                    guardProfile: GUARD_PROFILES[i].label,
                    candidateLabel: candidate.label,
                });
            }
        }

        // ─── Leaderboard ────────────────────────────────────────────────

        const sorted = [...allResults].sort((a, b) => {
            if (b.passCount !== a.passCount) return b.passCount - a.passCount;
            return b.compositeOOS.totalNetPnl - a.compositeOOS.totalNetPnl;
        });

        console.log('\n' + '═'.repeat(120));
        console.log('  PD LEVEL BREAK 4H — GUARD SWEEP LEADERBOARD');
        console.log('═'.repeat(120));

        for (const r of sorted) {
            const verdict = r.overallPass ? '✅ GO-LIVE' : '❌ FAIL';
            console.log(`  ${r.guardProfile.padEnd(10)} | ${r.passCount}/${r.totalFolds} pass | PnL: $${r.compositeOOS.totalNetPnl.toFixed(0).padStart(8)} | PF: ${r.compositeOOS.avgPF.toFixed(2)} | WR: ${r.compositeOOS.avgWR.toFixed(1)}% | ${verdict}`);
        }

        console.log('\n  BASELINE COMPARISON:');
        console.log('  Unguarded: 8/13 pass, +$17,040 PnL');
        for (const r of allResults) {
            const delta = r.passCount - 8;
            const pnlDelta = r.compositeOOS.totalNetPnl - 17040;
            const sign = delta >= 0 ? '+' : '';
            console.log(`  ${r.guardProfile.padEnd(10)}: ${r.passCount}/13 (${sign}${delta} folds) | PnL: $${r.compositeOOS.totalNetPnl.toFixed(0)} (${pnlDelta >= 0 ? '+' : ''}$${pnlDelta.toFixed(0)})`);
        }

        // ─── Complementary Analysis with BOS+FVG 2H ────────────────────

        console.log('\n' + '-'.repeat(80));
        console.log('  PORTFOLIO COMPLEMENTARY ANALYSIS');
        console.log('-'.repeat(80));
        console.log('  BOS+FVG 2H fails: fold 3, 4, 9, 10');
        console.log('  PD Level 4H fails: fold 0, 1, 2, 3, 12');
        console.log('  Overlap (both fail): fold 3 only');
        console.log('  Combined coverage: 12/13 folds have ≥1 strategy passing');
        console.log('  → Strong portfolio candidate');
        console.log();

        // ─── Save ───────────────────────────────────────────────────────

        const artifactDir = path.join(process.cwd(), '.artifacts', 'walk-forward');
        if (!fs.existsSync(artifactDir)) fs.mkdirSync(artifactDir, { recursive: true });

        const dateStr = new Date().toISOString().slice(0, 10);
        const filename = `4h-pd-level-guarded-${dateStr}.json`;
        fs.writeFileSync(path.join(artifactDir, filename), JSON.stringify({
            sweep: 'PD Level Break 4H Guard Sweep',
            date: dateStr,
            baseline: { passCount: 8, totalFolds: 13, oosNetPnl: 17040 },
            config: RUN_CONFIG,
            gate: GATE,
            guardProfiles: GUARD_PROFILES.map(g => ({ label: g.label, config: g.guards })),
            results: allResults,
        }, null, 2));
        console.log(`  Saved: .artifacts/walk-forward/${filename}\n`);

    } finally {
        await prisma.$disconnect();
    }
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
