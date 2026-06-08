/**
 * Walk-Forward Validation Runner
 *
 * Validates strategy robustness using rolling train/test windows.
 * Default: 12mo train, 6mo test, step 6mo → ~12 folds over 2019-2026.
 *
 * Usage:
 *   npx ts-node src/scripts/runWalkForwardValidation.ts <candidate> [--compound] [--risk <pct>]
 *
 * Candidates:
 *   pd-level-4h          PD Level Break LONG 4H (Tier 1 go-live candidate)
 *   bos-fvg-2h           BOS+FVG LONG 2H (Tier 2)
 *   asian-break-2h       Asian Break Continuation LONG 2H (Tier 2)
 *   ob-fib-h1            OB+Fib LONG H1 (Phase 3 winner)
 *   bos-fvg-adx-2h       BOS+FVG+ADX LONG 2H (ADX regime filter variant)
 *
 * Options:
 *   --compound           Enable compound equity mode
 *   --risk <pct>         Risk percent per trade (default: 1.5, or 3.0 with --compound)
 *   --max-wr-delta <pp>  Override WR delta gate in percentage points; omit to keep it disabled
 *
 * Examples:
 *   npx ts-node src/scripts/runWalkForwardValidation.ts pd-level-4h
 *   npx ts-node src/scripts/runWalkForwardValidation.ts pd-level-4h --compound
 *   npx ts-node src/scripts/runWalkForwardValidation.ts pd-level-4h --compound --risk 3
 *   npx ts-node src/scripts/runWalkForwardValidation.ts bos-fvg-adx-2h --max-wr-delta 8
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
import { WalkForwardGate } from '../services/signals/optimization/optimizationTypes';

dotenv.config();

// ─── Execution Config Presets ────────────────────────────────────────────────

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

// ─── Candidate Definitions ───────────────────────────────────────────────────

function buildCandidate(
    key: string,
    compound: boolean,
    riskOverride?: number,
): WfCandidate | null {
    const risk = riskOverride ?? (compound ? 3.0 : 1.5);
    const execConfig: ExecutionConfigInput = compound
        ? { ...BASE_EXEC, compoundEquity: true }
        : { ...BASE_EXEC };

    const defs: Record<string, Omit<WfCandidate, 'execConfig' | 'initialEquity' | 'riskPercent'>> = {
        'pd-level-4h': {
            signalCode: 'SYS_4TF_PD_LEVEL_BREAK_LONG',
            signalVersion: 1,
            symbol: 'XAUUSD',
            timeframe: '4h',
            label: `PD Level Break 4H${compound ? ' (compound)' : ''}`,
        },
        'bos-fvg-2h': {
            signalCode: 'SYS_4TF_BOS_FVG_LONG',
            signalVersion: 1,
            symbol: 'XAUUSD',
            timeframe: '2h',
            label: `BOS+FVG 2H${compound ? ' (compound)' : ''}`,
        },
        'asian-break-2h': {
            signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG',
            signalVersion: 1,
            symbol: 'XAUUSD',
            timeframe: '2h',
            label: `Asian Break 2H${compound ? ' (compound)' : ''}`,
        },
        'ob-fib-h1': {
            signalCode: 'SYS_T1_OB_FIB_LONG',
            signalVersion: 1,
            symbol: 'XAUUSD',
            timeframe: '1h',
            label: `OB+Fib H1${compound ? ' (compound)' : ''}`,
        },
        'bos-fvg-adx-2h': {
            signalCode: 'SYS_4TF_BOS_FVG_ADX_LONG',
            signalVersion: 1,
            symbol: 'XAUUSD',
            timeframe: '2h',
            label: `BOS+FVG+ADX 2H${compound ? ' (compound)' : ''}`,
        },
    };

    const def = defs[key];
    if (!def) return null;

    return { ...def, execConfig, initialEquity: 10000, riskPercent: risk };
}

// ─── Config ──────────────────────────────────────────────────────────────────

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

// ─── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(): { candidateKey: string; compound: boolean; risk?: number; maxWrDelta?: number | null } {
    const args = process.argv.slice(2);
    const candidateKey = args.find(a => !a.startsWith('--')) || 'pd-level-4h';
    const compound = args.includes('--compound');
    const riskIdx = args.indexOf('--risk');
    const risk = riskIdx >= 0 && args[riskIdx + 1] ? parseFloat(args[riskIdx + 1]) : undefined;
    const wrIdx = args.indexOf('--max-wr-delta');
    const maxWrDelta = wrIdx >= 0 && args[wrIdx + 1] ? parseFloat(args[wrIdx + 1]) : null;
    return { candidateKey, compound, risk, maxWrDelta };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
    const { candidateKey, compound, risk, maxWrDelta } = parseArgs();

    const candidate = buildCandidate(candidateKey, compound, risk);
    if (!candidate) {
        console.error(`Unknown candidate: ${candidateKey}`);
        console.error(`Available: pd-level-4h, bos-fvg-2h, asian-break-2h, ob-fib-h1, bos-fvg-adx-2h`);
        process.exit(1);
    }

    const prisma = new PrismaClient();
    const registry = createDefaultBlockRegistry();
    const backtests = new SignalBacktestRunService(prisma);
    const exec = new SignalBacktestExecutionService(prisma);

    try {
        await upsertTier1ComposedSignals(prisma, registry);

        const gate: WalkForwardGate = {
            ...GATE,
            maxWrDeltaPP: maxWrDelta,
        };

        const engine = new WalkForwardEngine(prisma, backtests, exec);
        const result = await engine.run(candidate, RUN_CONFIG, gate);

        // Save results
        const artifactDir = path.join(process.cwd(), '.artifacts', 'walk-forward');
        if (!fs.existsSync(artifactDir)) fs.mkdirSync(artifactDir, { recursive: true });

        const suffix = compound ? '-compound' : '';
        const filename = `${candidateKey}${suffix}-${new Date().toISOString().slice(0, 10)}.json`;
        const filepath = path.join(artifactDir, filename);

        fs.writeFileSync(filepath, JSON.stringify(result, null, 2));
        console.log(`  Saved: .artifacts/walk-forward/${filename}`);

        // Exit code: 0 if pass, 1 if fail
        process.exit(result.overallPass ? 0 : 1);
    } finally {
        await prisma.$disconnect();
    }
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
