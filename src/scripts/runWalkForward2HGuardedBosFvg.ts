/**
 * Walk-Forward 2H Guarded BOS+FVG Sweep
 *
 * Phase A: Test BOS+FVG LONG v2 on 2H with 3 guard profiles (TIGHT, MODERATE, LOOSE)
 * Phase B: Test best guard with 3 exit profiles + exit maxBars variants
 *
 * Target: push pass rate from 9/13 → 10/13+ folds
 *
 * Current baseline (unguarded): 9/13 pass, +$45,490 OOS PnL
 * Fail folds: 3 (2021H2), 4 (2022H1), 9 (2024H2), 10 (2025H1)
 *
 * NON-COMPOUND 1.5% risk.
 * Config: 12mo train, 6mo test, 6mo step over 2019-01-01 to 2026-03-14
 * Gate:   PF>=1.30, DD<=15%, pass ratio>=0.75
 *
 * Usage:
 *   npx ts-node src/scripts/runWalkForward2HGuardedBosFvg.ts
 *   npx ts-node src/scripts/runWalkForward2HGuardedBosFvg.ts --phase=A   # guards only
 *   npx ts-node src/scripts/runWalkForward2HGuardedBosFvg.ts --phase=B   # exit sweep only
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

// ─── Guard Profiles (adapted for 2H — wider spacing, longer cooldowns) ──────

const TIGHT_GUARDS: TradeGuardConfigInput = {
    lossStreakCooldown: { afterLosses: 3, cooldownMinutes: 480 },
    dayLossCap: { maxLosses: 2, maxNetR: 2 },
    equityCurveFilter: { emaTrades: 15, action: 'BLOCK' },
    maxDrawdownHalt: { maxDrawdownPct: 8 },
    minTradeSpacing: { minSpacingMinutes: 240 },
};

const MODERATE_GUARDS: TradeGuardConfigInput = {
    lossStreakCooldown: { afterLosses: 3, cooldownMinutes: 360 },
    dayLossCap: { maxLosses: 3, maxNetR: 3 },
    equityCurveFilter: { emaTrades: 20, action: 'HALF_RISK' },
    maxDrawdownHalt: { maxDrawdownPct: 12 },
    minTradeSpacing: { minSpacingMinutes: 120 },
};

const LOOSE_GUARDS: TradeGuardConfigInput = {
    lossStreakCooldown: { afterLosses: 4, cooldownMinutes: 360 },
    dayLossCap: { maxLosses: 4, maxNetR: 4 },
    equityCurveFilter: { emaTrades: 25, action: 'HALF_RISK' },
    maxDrawdownHalt: { maxDrawdownPct: 15 },
    minTradeSpacing: { minSpacingMinutes: 60 },
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

// ─── Phase A: Guard Profile Candidates ──────────────────────────────────────

const GUARD_PROFILES: Array<{ label: string; guards: TradeGuardConfigInput }> = [
    { label: 'TIGHT', guards: TIGHT_GUARDS },
    { label: 'MODERATE', guards: MODERATE_GUARDS },
    { label: 'LOOSE', guards: LOOSE_GUARDS },
];

function buildPhaseACandidates(): WfCandidate[] {
    return GUARD_PROFILES.map(profile => ({
        signalCode: 'SYS_4TF_BOS_FVG_LONG',
        signalVersion: 2,
        symbol: 'XAUUSD',
        timeframe: '2h',
        label: `BOS+FVG 2H + ${profile.label}`,
        execConfig: makeExecConfig(profile.guards),
        initialEquity: 10000,
        riskPercent: 1.5,
    }));
}

// ─── Phase B: Exit Profile Candidates (uses best guard from Phase A) ────────
// Exit profiles suitable for 2H (from master plan):
//   - BE_1R_TRAIL_2R_3R (current default)
//   - PARTIAL_1R_BE_R3
//   - PARTIAL_1R_BE_SWING_TRAIL

// NOTE: exitManagement.maxBarsInTrade in signal definition is DEAD CONFIG —
// ComposedSignalPlugin only reads maxBarsInTrade from parameters, not from definition.
// The baseline (9/13 pass) runs WITHOUT maxBarsInTrade limit.
// Setting maxBarsInTrade=4 on 2H = force close after 8 hours = massive regression.
// Phase B v2: test exit profiles WITHOUT maxBars, plus a few with longer maxBars.
const EXIT_PROFILES = [
    { code: 'BE_1R_TRAIL_2R_3R', maxBars: [null] },           // baseline profile, no maxBars
    { code: 'PARTIAL_1R_BE_R3', maxBars: [null] },            // partial at 1R, target 3R
    { code: 'PARTIAL_1R_BE_SWING_TRAIL', maxBars: [null] },   // swing trail
    { code: 'BE_1R_TP_2R', maxBars: [null] },                 // simpler: BE at 1R, TP at 2R
    { code: 'FIXED_2R', maxBars: [null] },                    // hard TP at 2R, no trail
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

// ─── Helpers ────────────────────────────────────────────────────────────────

function parsePhase(): 'A' | 'B' | 'ALL' {
    const arg = process.argv.find(a => a.startsWith('--phase='));
    if (!arg) return 'ALL';
    const val = arg.split('=')[1]?.toUpperCase();
    if (val === 'A' || val === 'B') return val;
    return 'ALL';
}

interface EnrichedResult extends WalkForwardResult {
    guardProfile: string;
    candidateLabel: string;
    exitProfile?: string;
    exitMaxBars?: number;
}

function printLeaderboard(title: string, results: EnrichedResult[]) {
    const sorted = [...results].sort((a, b) => {
        if (a.overallPass !== b.overallPass) return a.overallPass ? -1 : 1;
        if (b.passCount !== a.passCount) return b.passCount - a.passCount;
        return b.compositeOOS.totalNetPnl - a.compositeOOS.totalNetPnl;
    });

    console.log('\n' + '═'.repeat(130));
    console.log(`  ${title}`);
    console.log('═'.repeat(130));
    console.log('  # │ Candidate                                     │ Pass  │ OOS Trades │ OOS PnL    │ Avg PF │ Avg WR │ Verdict');
    console.log('  ──┼─────────────────────────────────────────────────┼───────┼────────────┼────────────┼────────┼────────┼────────');

    for (let i = 0; i < sorted.length; i++) {
        const r = sorted[i];
        const verdict = r.overallPass ? '✅ GO-LIVE' : '❌ FAIL';
        const pnlStr = r.compositeOOS.totalNetPnl >= 0
            ? `+$${r.compositeOOS.totalNetPnl.toFixed(0)}`.padStart(10)
            : `-$${Math.abs(r.compositeOOS.totalNetPnl).toFixed(0)}`.padStart(10);
        const pf = r.compositeOOS.avgPF >= 999 ? '  ∞' : r.compositeOOS.avgPF.toFixed(2);

        console.log(
            `  ${String(i + 1).padStart(1)} │ ${r.candidateLabel.padEnd(47)} │ ${`${r.passCount}/${r.totalFolds}`.padStart(5)} │ ${String(r.compositeOOS.totalTrades).padStart(10)} │ ${pnlStr} │ ${String(pf).padStart(6)} │ ${r.compositeOOS.avgWR.toFixed(1).padStart(5)}% │ ${verdict}`,
        );
    }
    console.log();
    return sorted;
}

async function runCandidates(
    engine: WalkForwardEngine,
    candidates: WfCandidate[],
    enrichFn: (result: WalkForwardResult, idx: number) => EnrichedResult,
): Promise<EnrichedResult[]> {
    const results: EnrichedResult[] = [];

    for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[i];
        console.log(`\n${'#'.repeat(80)}`);
        console.log(`  [${i + 1}/${candidates.length}] ${candidate.label}`);
        console.log('#'.repeat(80));

        try {
            const result = await engine.run(candidate, RUN_CONFIG, GATE);
            results.push(enrichFn(result, i));
        } catch (err: any) {
            console.error(`  ERROR running ${candidate.label}: ${err.message}`);
            results.push(enrichFn({
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
            }, i));
        }
    }

    return results;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
    const phase = parsePhase();
    const prisma = new PrismaClient();
    const registry = createDefaultBlockRegistry();
    const backtests = new SignalBacktestRunService(prisma);
    const exec = new SignalBacktestExecutionService(prisma);

    try {
        await upsertTier1ComposedSignals(prisma, registry);
        const engine = new WalkForwardEngine(prisma, backtests, exec);

        const artifactDir = path.join(process.cwd(), '.artifacts', 'walk-forward');
        if (!fs.existsSync(artifactDir)) fs.mkdirSync(artifactDir, { recursive: true });

        const dateStr = new Date().toISOString().slice(0, 10);
        let phaseAResults: EnrichedResult[] = [];
        let phaseBResults: EnrichedResult[] = [];

        // ─── Phase A: Guard Profiles ────────────────────────────────────

        if (phase === 'A' || phase === 'ALL') {
            console.log('\n' + '█'.repeat(80));
            console.log('  PHASE A: GUARD PROFILE SWEEP — BOS+FVG LONG v2 on 2H');
            console.log('  Baseline (unguarded): 9/13 pass, +$45,490 OOS PnL');
            console.log('  Target: ≥10/13 pass rate');
            console.log('█'.repeat(80));

            const candidates = buildPhaseACandidates();
            phaseAResults = await runCandidates(engine, candidates, (result, idx) => ({
                ...result,
                guardProfile: GUARD_PROFILES[idx].label,
                candidateLabel: candidates[idx].label,
            }));

            printLeaderboard('PHASE A LEADERBOARD — Guard Profiles (BOS+FVG 2H)', phaseAResults);

            // Compare with baseline
            console.log('  BASELINE COMPARISON:');
            console.log('  Unguarded baseline: 9/13 pass, +$45,490 PnL');
            for (const r of phaseAResults) {
                const delta = r.passCount - 9;
                const pnlDelta = r.compositeOOS.totalNetPnl - 45490;
                const sign = delta >= 0 ? '+' : '';
                const pnlSign = pnlDelta >= 0 ? '+' : '';
                console.log(`  ${r.guardProfile.padEnd(10)}: ${r.passCount}/13 (${sign}${delta} folds) | PnL: $${r.compositeOOS.totalNetPnl.toFixed(0)} (${pnlSign}$${pnlDelta.toFixed(0)})`);
            }
            console.log();

            // Save Phase A
            const filenameA = `2h-bos-fvg-guarded-phaseA-${dateStr}.json`;
            fs.writeFileSync(path.join(artifactDir, filenameA), JSON.stringify({
                phase: 'A',
                sweep: 'BOS+FVG 2H Guard Sweep',
                date: dateStr,
                baseline: { passCount: 9, totalFolds: 13, oosNetPnl: 45490 },
                config: RUN_CONFIG,
                gate: GATE,
                guardProfiles: GUARD_PROFILES.map(g => ({ label: g.label, config: g.guards })),
                results: phaseAResults,
            }, null, 2));
            console.log(`  Saved: .artifacts/walk-forward/${filenameA}`);
        }

        // ─── Phase B: Exit Profile Sweep ────────────────────────────────

        if (phase === 'B' || phase === 'ALL') {
            // Pick best guard from Phase A (or load from file if running Phase B only)
            let bestGuardLabel = 'MODERATE';
            let bestGuard = MODERATE_GUARDS;

            if (phaseAResults.length > 0) {
                const sorted = [...phaseAResults].sort((a, b) => {
                    if (b.passCount !== a.passCount) return b.passCount - a.passCount;
                    return b.compositeOOS.totalNetPnl - a.compositeOOS.totalNetPnl;
                });
                bestGuardLabel = sorted[0].guardProfile;
                bestGuard = GUARD_PROFILES.find(g => g.label === bestGuardLabel)!.guards;
                console.log(`\n  Phase B using best guard from Phase A: ${bestGuardLabel} (${sorted[0].passCount}/${sorted[0].totalFolds} pass)`);
            } else if (phase === 'B') {
                // Try to load Phase A results
                const existingFiles = fs.readdirSync(artifactDir).filter(f => f.startsWith('2h-bos-fvg-guarded-phaseA-'));
                if (existingFiles.length > 0) {
                    const latest = existingFiles.sort().pop()!;
                    const data = JSON.parse(fs.readFileSync(path.join(artifactDir, latest), 'utf-8'));
                    const sorted = [...data.results].sort((a: any, b: any) => {
                        if (b.passCount !== a.passCount) return b.passCount - a.passCount;
                        return b.compositeOOS.totalNetPnl - a.compositeOOS.totalNetPnl;
                    });
                    bestGuardLabel = sorted[0].guardProfile;
                    bestGuard = GUARD_PROFILES.find(g => g.label === bestGuardLabel)!.guards;
                    console.log(`\n  Phase B loaded Phase A results from ${latest}: best guard = ${bestGuardLabel}`);
                } else {
                    console.log('\n  Phase B: no Phase A results found, using MODERATE as default');
                }
            }

            console.log('\n' + '█'.repeat(80));
            console.log(`  PHASE B: EXIT PROFILE SWEEP — BOS+FVG 2H + ${bestGuardLabel} guards`);
            console.log('  Testing exit profiles: BE_1R_TRAIL_2R_3R, PARTIAL_1R_BE_R3, PARTIAL_1R_BE_SWING_TRAIL');
            console.log('█'.repeat(80));

            // Build exit candidates — each exit profile × maxBars variant
            // Uses extraParameters to override exitStrategy and maxBarsInTrade
            // (ComposedSignalPlugin reads parameters.exitStrategy and parameters.maxBarsInTrade)
            const exitCandidates: WfCandidate[] = [];
            const exitMeta: Array<{ exitProfile: string; maxBars: number }> = [];

            for (const exitProfile of EXIT_PROFILES) {
                for (const maxBars of exitProfile.maxBars) {
                    const mbLabel = maxBars === null ? 'noLimit' : `mb${maxBars}`;
                    const extra: Record<string, unknown> = { exitStrategy: exitProfile.code };
                    if (maxBars !== null) extra.maxBarsInTrade = maxBars;

                    exitCandidates.push({
                        signalCode: 'SYS_4TF_BOS_FVG_LONG',
                        signalVersion: 2,
                        symbol: 'XAUUSD',
                        timeframe: '2h',
                        label: `BOS+FVG 2H + ${bestGuardLabel} + ${exitProfile.code}/${mbLabel}`,
                        execConfig: makeExecConfig(bestGuard),
                        initialEquity: 10000,
                        riskPercent: 1.5,
                        extraParameters: extra,
                    });
                    exitMeta.push({ exitProfile: exitProfile.code, maxBars: maxBars as unknown as number });
                }
            }

            phaseBResults = await runCandidates(engine, exitCandidates, (result, idx) => ({
                ...result,
                guardProfile: bestGuardLabel,
                candidateLabel: exitCandidates[idx].label,
                exitProfile: exitMeta[idx].exitProfile,
                exitMaxBars: exitMeta[idx].maxBars,
            }));

            printLeaderboard(`PHASE B LEADERBOARD — Exit Profiles (BOS+FVG 2H + ${bestGuardLabel})`, phaseBResults);

            // Save Phase B
            const filenameB = `2h-bos-fvg-guarded-phaseB-${dateStr}.json`;
            fs.writeFileSync(path.join(artifactDir, filenameB), JSON.stringify({
                phase: 'B',
                sweep: 'BOS+FVG 2H Exit Sweep',
                date: dateStr,
                bestGuardProfile: bestGuardLabel,
                config: RUN_CONFIG,
                gate: GATE,
                exitProfiles: EXIT_PROFILES,
                results: phaseBResults,
            }, null, 2));
            console.log(`  Saved: .artifacts/walk-forward/${filenameB}`);
        }

        // ─── Final Summary ──────────────────────────────────────────────

        const allResults = [...phaseAResults, ...phaseBResults];
        if (allResults.length > 0) {
            const best = [...allResults].sort((a, b) => {
                if (b.passCount !== a.passCount) return b.passCount - a.passCount;
                return b.compositeOOS.totalNetPnl - a.compositeOOS.totalNetPnl;
            })[0];

            console.log('\n' + '═'.repeat(80));
            console.log('  FINAL RECOMMENDATION');
            console.log('═'.repeat(80));
            console.log(`  Best: ${best.candidateLabel}`);
            console.log(`  Pass: ${best.passCount}/${best.totalFolds} folds`);
            console.log(`  OOS PnL: $${best.compositeOOS.totalNetPnl.toFixed(0)}`);
            console.log(`  OOS PF: ${best.compositeOOS.avgPF.toFixed(2)}, WR: ${best.compositeOOS.avgWR.toFixed(1)}%`);
            console.log(`  Verdict: ${best.overallPass ? '✅ PASS GATE — ready for portfolio assembly' : '❌ FAIL GATE — needs further optimization or gate relaxation'}`);

            if (best.passCount >= 10) {
                console.log('\n  >>> TARGET MET: ≥10/13 folds pass. Proceed to Priority 2 or Portfolio Assembly.');
            } else if (best.passCount === 9) {
                console.log('\n  >>> 9/13 = 69%. Consider: relax gate to 65% (9/13=69%) or continue optimization.');
            } else {
                console.log('\n  >>> Below 9/13. Guards may be reducing edge. Consider unguarded as best option.');
            }
            console.log();
        }

    } finally {
        await prisma.$disconnect();
    }
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
