import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { BacktestRunStatus, PrismaClient } from '@prisma/client';
import { SignalBacktestExecutionService } from '../services/signals/SignalBacktestExecutionService';
import { SignalBacktestRunService } from '../services/signals/SignalBacktestRunService';
import { createDefaultBlockRegistry } from '../services/signals/blocks/createDefaultBlockRegistry';
import { BacktestRiskSummary, BacktestRiskSummaryService } from '../services/signals/BacktestRiskSummaryService';
import { ExecutionConfigInput } from '../services/signals/types';
import { getTier1ComposedSignalSeeds, upsertTier1ComposedSignals } from '../services/signals/tier1ComposedSignals';
import { normalizeMarketSymbol } from '../utils/symbols';
import { normalizeTimeframe } from '../utils/timeframes';

dotenv.config();

const DEFAULT_FROM = '2019-01-01T00:00:00.000Z';
const DEFAULT_TO = '2022-12-31T23:59:59.999Z';
const DEFAULT_SYMBOL = 'XAUUSD';
const DEFAULT_PRESET = 'xau-phase1';
const DEFAULT_OUT_DIR = '.artifacts/batch-backtests';
const DEFAULT_MAX_CONCURRENCY = 1;
const DEFAULT_EXECUTION_CONFIG: ExecutionConfigInput = {
    entryFeeBps: 4,
    exitFeeBps: 4,
    entrySlippageBps: 2,
    exitSlippageBps: 2,
    orderTiming: 'NEXT_BAR_OPEN',
    stopLoss: { mode: 'SIGNAL_PRICE' },
    takeProfit: { mode: 'SIGNAL_PRICE' },
    positionSizing: { mode: 'RISK_BASED' },
};

type PresetId = 'xau-phase1' | 'xau-phase1b' | '4tf-15m' | '4tf-1h' | '4tf-2h' | '4tf-4h' | '4tf-volman';

type BatchRunPreset = {
    signalCode: string;
    timeframe: string;
    strategyFamily: string;
    notes: string;
    parameters?: Record<string, unknown>;
};

type ResolvedRun = BatchRunPreset & {
    signalVersion: number;
    symbol: string;
    timeframe: string;
};

type CliOptions = {
    preset: PresetId;
    symbol: string;
    from: Date;
    to: Date;
    initialEquity: number;
    riskPercent: number;
    batchTag: string;
    outPath: string;
    maxConcurrency: number;
    shardCount: number;
    shardIndex: number;
    queueOnly: boolean;
};

type RunOutcome = {
    preset: BatchRunPreset;
    signalVersion: number;
    runId?: string;
    state: 'SKIPPED_COMPLETED' | 'EXECUTED' | 'FAILED' | 'QUEUED';
    status?: BacktestRunStatus | 'QUEUED';
    error?: string;
    counts?: {
        signals: number;
        events: number;
        traces: number;
        results: number;
    };
};

type BatchLeaderboardRow = {
    runId: string;
    signalCode: string;
    timeframe: string;
    status: BacktestRunStatus;
    strategyFamily: string;
    totalTrades: number;
    closedTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    profitFactor: number | null;
    netR: number;
    netUsd: number;
    maxDrawdownPct: number | null;
    equityCurveMaxDdUsd: number;
    equityCurveMaxDdPct: number;
    maxConsecutiveLosses: number;
    maxConsecutiveLosingDays: number;
    guardActivationCount: number;
    blockedEntryCount: number;
    avgRPerTrade: number;
    medianRPerTrade: number;
};

const PRESETS: Record<PresetId, { description: string; runs: BatchRunPreset[] }> = {
    'xau-phase1': {
        description: 'Phase 1 XAU baseline: 3 proven strategy families across 15m and 1h, mirrored long/short (12 runs).',
        runs: [
            { signalCode: 'SYS_XAU_ASIAN_SWEEP_REVERSAL_LONG', timeframe: '15m', strategyFamily: '15M-S1', notes: 'Asian Sweep Reversal LONG @15m' },
            { signalCode: 'SYS_XAU_ASIAN_SWEEP_REVERSAL_SHORT', timeframe: '15m', strategyFamily: '15M-S1', notes: 'Asian Sweep Reversal SHORT @15m' },
            { signalCode: 'SYS_XAU_PDL_SWEEP_RECLAIM_LONG', timeframe: '15m', strategyFamily: '15M-S2', notes: 'PDL Sweep Reclaim LONG @15m' },
            { signalCode: 'SYS_XAU_PDH_SWEEP_RECLAIM_SHORT', timeframe: '15m', strategyFamily: '15M-S2', notes: 'PDH Sweep Reclaim SHORT @15m' },
            { signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG', timeframe: '15m', strategyFamily: '15M-S7', notes: 'Asian Break Continuation LONG @15m' },
            { signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_SHORT', timeframe: '15m', strategyFamily: '15M-S7', notes: 'Asian Break Continuation SHORT @15m' },
            { signalCode: 'SYS_XAU_ASIAN_SWEEP_REVERSAL_LONG', timeframe: '1h', strategyFamily: '1H-baseline-A', notes: 'Asian Sweep Reversal LONG @1h' },
            { signalCode: 'SYS_XAU_ASIAN_SWEEP_REVERSAL_SHORT', timeframe: '1h', strategyFamily: '1H-baseline-A', notes: 'Asian Sweep Reversal SHORT @1h' },
            { signalCode: 'SYS_XAU_PDL_SWEEP_RECLAIM_LONG', timeframe: '1h', strategyFamily: '1H-baseline-B', notes: 'PDL Sweep Reclaim LONG @1h' },
            { signalCode: 'SYS_XAU_PDH_SWEEP_RECLAIM_SHORT', timeframe: '1h', strategyFamily: '1H-baseline-B', notes: 'PDH Sweep Reclaim SHORT @1h' },
            { signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG', timeframe: '1h', strategyFamily: '1H-baseline-C', notes: 'Asian Break Continuation LONG @1h' },
            { signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_SHORT', timeframe: '1h', strategyFamily: '1H-baseline-C', notes: 'Asian Break Continuation SHORT @1h' },
        ],
    },
    'xau-phase1b': {
        description: 'Phase 1B XAU salvage lane: focused 1h bullish continuation / breakout follow-up after the failed broad baseline.',
        runs: [
            { signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG', timeframe: '1h', strategyFamily: '1H-P1B-core', notes: 'Core salvage lane: Asian Break Continuation LONG @1h' },
            { signalCode: 'SYS_XAU_PDL_SWEEP_RECLAIM_LONG', timeframe: '1h', strategyFamily: '1H-P1B-control', notes: 'Control lane: PDL Sweep Reclaim LONG @1h' },
            { signalCode: 'SYS_XAU_ASIAN_HIGH_RETEST_LONG', timeframe: '1h', strategyFamily: '1H-P1B-alt1', notes: 'Alternative bullish continuation: Asian High Retest LONG @1h' },
            { signalCode: 'SYS_XAU_PDM_BREAK_LONG', timeframe: '1h', strategyFamily: '1H-P1B-alt2', notes: 'Alternative breakout lane: Prior Day Midpoint Break LONG @1h' },
        ],
    },

    // ─── 4TF Plan presets (5 terminals) ──────────────────────────────────────

    '4tf-15m': {
        description: '4TF Plan: All 15M strategies (S1-S8) — existing + new signals on M15.',
        runs: [
            // S1: Asian Sweep Reversal (existing signals)
            { signalCode: 'SYS_XAU_ASIAN_SWEEP_REVERSAL_LONG', timeframe: '15m', strategyFamily: '15M-S1', notes: 'Asian Sweep Reversal LONG @15m' },
            { signalCode: 'SYS_XAU_ASIAN_SWEEP_REVERSAL_SHORT', timeframe: '15m', strategyFamily: '15M-S1', notes: 'Asian Sweep Reversal SHORT @15m' },
            // S2: PDL/PDH Sweep Reclaim (existing signals)
            { signalCode: 'SYS_XAU_PDL_SWEEP_RECLAIM_LONG', timeframe: '15m', strategyFamily: '15M-S2', notes: 'PDL Sweep Reclaim LONG @15m' },
            { signalCode: 'SYS_XAU_PDH_SWEEP_RECLAIM_SHORT', timeframe: '15m', strategyFamily: '15M-S2', notes: 'PDH Sweep Reclaim SHORT @15m' },
            // S3: London Burst (new signal)
            { signalCode: 'SYS_4TF_LONDON_BURST_LONG', timeframe: '15m', strategyFamily: '15M-S3', notes: 'London Momentum Burst LONG @15m' },
            { signalCode: 'SYS_4TF_LONDON_BURST_SHORT', timeframe: '15m', strategyFamily: '15M-S3', notes: 'London Momentum Burst SHORT @15m' },
            // S4: OB + Fib (existing OB_FIB signal on 15m)
            { signalCode: 'SYS_T1_OB_FIB_LONG', timeframe: '15m', strategyFamily: '15M-S4', notes: 'OB + Fib Confluence LONG @15m' },
            { signalCode: 'SYS_T1_OB_FIB_SHORT', timeframe: '15m', strategyFamily: '15M-S4', notes: 'OB + Fib Confluence SHORT @15m' },
            // S5: Volman Pressure (new signal)
            { signalCode: 'SYS_4TF_VOLMAN_PRESSURE_LONG', timeframe: '15m', strategyFamily: '15M-S5', notes: 'Volman Pressure LONG @15m' },
            { signalCode: 'SYS_4TF_VOLMAN_PRESSURE_SHORT', timeframe: '15m', strategyFamily: '15M-S5', notes: 'Volman Pressure SHORT @15m' },
            // S6: CHoCH + BOS (new signal)
            { signalCode: 'SYS_4TF_CHOCH_BOS_LONG', timeframe: '15m', strategyFamily: '15M-S6', notes: 'CHoCH+BOS Reversal LONG @15m' },
            { signalCode: 'SYS_4TF_CHOCH_BOS_SHORT', timeframe: '15m', strategyFamily: '15M-S6', notes: 'CHoCH+BOS Reversal SHORT @15m' },
            // S7: Asian Break Continuation (existing signal)
            { signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG', timeframe: '15m', strategyFamily: '15M-S7', notes: 'Asian Break Continuation LONG @15m' },
            { signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_SHORT', timeframe: '15m', strategyFamily: '15M-S7', notes: 'Asian Break Continuation SHORT @15m' },
            // S8: OB Reclaim + EMA (existing OB_RECLAIM signal on 15m)
            { signalCode: 'SYS_T1_BULLISH_OB_RECLAIM', timeframe: '15m', strategyFamily: '15M-S8', notes: 'OB Reclaim + EMA LONG @15m' },
            { signalCode: 'SYS_T1_BEARISH_OB_REJECT', timeframe: '15m', strategyFamily: '15M-S8', notes: 'OB Reject + EMA SHORT @15m' },
        ],
    },
    '4tf-1h': {
        description: '4TF Plan: All 1H strategies (S1-S7).',
        runs: [
            // S1: Trend Pullback OB (existing signal)
            { signalCode: 'SYS_T1_TREND_PULLBACK_LONG', timeframe: '1h', strategyFamily: '1H-S1', notes: 'Trend Pullback LONG @1h' },
            { signalCode: 'SYS_T1_TREND_PULLBACK_SHORT', timeframe: '1h', strategyFamily: '1H-S1', notes: 'Trend Pullback SHORT @1h' },
            // S2: Session Burst (existing signal)
            { signalCode: 'SYS_T1_SESSION_BURST_LONG', timeframe: '1h', strategyFamily: '1H-S2', notes: 'Session Burst LONG @1h' },
            { signalCode: 'SYS_T1_SESSION_BURST_SHORT', timeframe: '1h', strategyFamily: '1H-S2', notes: 'Session Burst SHORT @1h' },
            // S3: OB + Fib (existing signal)
            { signalCode: 'SYS_T1_OB_FIB_LONG', timeframe: '1h', strategyFamily: '1H-S3', notes: 'OB + Fib Confluence LONG @1h' },
            { signalCode: 'SYS_T1_OB_FIB_SHORT', timeframe: '1h', strategyFamily: '1H-S3', notes: 'OB + Fib Confluence SHORT @1h' },
            // S4: CHoCH + BOS (new signal on 1h)
            { signalCode: 'SYS_4TF_CHOCH_BOS_LONG', timeframe: '1h', strategyFamily: '1H-S4', notes: 'CHoCH+BOS LONG @1h' },
            { signalCode: 'SYS_4TF_CHOCH_BOS_SHORT', timeframe: '1h', strategyFamily: '1H-S4', notes: 'CHoCH+BOS SHORT @1h' },
            // S5: RSI Divergence (new signal)
            { signalCode: 'SYS_4TF_RSI_DIVERGENCE_LONG', timeframe: '1h', strategyFamily: '1H-S5', notes: 'RSI Divergence LONG @1h' },
            { signalCode: 'SYS_4TF_RSI_DIVERGENCE_SHORT', timeframe: '1h', strategyFamily: '1H-S5', notes: 'RSI Divergence SHORT @1h' },
            // S6: PD Level Break (new signal)
            { signalCode: 'SYS_4TF_PD_LEVEL_BREAK_LONG', timeframe: '1h', strategyFamily: '1H-S6', notes: 'PD Level Break LONG @1h' },
            { signalCode: 'SYS_4TF_PD_LEVEL_BREAK_SHORT', timeframe: '1h', strategyFamily: '1H-S6', notes: 'PD Level Break SHORT @1h' },
            // S7: Volman Breakout (new signal)
            { signalCode: 'SYS_4TF_VOLMAN_BREAKOUT_LONG', timeframe: '1h', strategyFamily: '1H-S7', notes: 'Volman Breakout LONG @1h' },
            { signalCode: 'SYS_4TF_VOLMAN_BREAKOUT_SHORT', timeframe: '1h', strategyFamily: '1H-S7', notes: 'Volman Breakout SHORT @1h' },
        ],
    },
    '4tf-2h': {
        description: '4TF Plan: All 2H strategies (S1-S5).',
        runs: [
            // S1: Macro Trend Pullback OB
            { signalCode: 'SYS_T1_TREND_PULLBACK_LONG', timeframe: '2h', strategyFamily: '2H-S1', notes: 'Macro Trend Pullback LONG @2h' },
            { signalCode: 'SYS_T1_TREND_PULLBACK_SHORT', timeframe: '2h', strategyFamily: '2H-S1', notes: 'Macro Trend Pullback SHORT @2h' },
            // S2: BOS + FVG (new signal)
            { signalCode: 'SYS_4TF_BOS_FVG_LONG', timeframe: '2h', strategyFamily: '2H-S2', notes: 'BOS + FVG LONG @2h' },
            { signalCode: 'SYS_4TF_BOS_FVG_SHORT', timeframe: '2h', strategyFamily: '2H-S2', notes: 'BOS + FVG SHORT @2h' },
            // S3: OB + Fibonacci
            { signalCode: 'SYS_T1_OB_FIB_LONG', timeframe: '2h', strategyFamily: '2H-S3', notes: 'OB + Fib Confluence LONG @2h' },
            { signalCode: 'SYS_T1_OB_FIB_SHORT', timeframe: '2h', strategyFamily: '2H-S3', notes: 'OB + Fib Confluence SHORT @2h' },
            // S4: Asian Range Break
            { signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG', timeframe: '2h', strategyFamily: '2H-S4', notes: 'Asian Break LONG @2h' },
            { signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_SHORT', timeframe: '2h', strategyFamily: '2H-S4', notes: 'Asian Break SHORT @2h' },
            // S5: Volman False Break (new signal)
            { signalCode: 'SYS_4TF_VOLMAN_FALSE_BREAK_LONG', timeframe: '2h', strategyFamily: '2H-S5', notes: 'Volman False Break LONG @2h' },
            { signalCode: 'SYS_4TF_VOLMAN_FALSE_BREAK_SHORT', timeframe: '2h', strategyFamily: '2H-S5', notes: 'Volman False Break SHORT @2h' },
        ],
    },
    '4tf-4h': {
        description: '4TF Plan: All 4H strategies (S1-S5).',
        runs: [
            // S1: OB + Fibonacci Flagship
            { signalCode: 'SYS_T1_OB_FIB_LONG', timeframe: '4h', strategyFamily: '4H-S1', notes: 'OB + Fib Flagship LONG @4h' },
            { signalCode: 'SYS_T1_OB_FIB_SHORT', timeframe: '4h', strategyFamily: '4H-S1', notes: 'OB + Fib Flagship SHORT @4h' },
            // S2: CHoCH → Trend Shift
            { signalCode: 'SYS_4TF_CHOCH_BOS_LONG', timeframe: '4h', strategyFamily: '4H-S2', notes: 'CHoCH Trend Shift LONG @4h' },
            { signalCode: 'SYS_4TF_CHOCH_BOS_SHORT', timeframe: '4h', strategyFamily: '4H-S2', notes: 'CHoCH Trend Shift SHORT @4h' },
            // S3: Session Burst Macro
            { signalCode: 'SYS_T1_SESSION_BURST_LONG', timeframe: '4h', strategyFamily: '4H-S3', notes: 'Session Burst Macro LONG @4h' },
            { signalCode: 'SYS_T1_SESSION_BURST_SHORT', timeframe: '4h', strategyFamily: '4H-S3', notes: 'Session Burst Macro SHORT @4h' },
            // S4: PD Level Break + Structure
            { signalCode: 'SYS_4TF_PD_LEVEL_BREAK_LONG', timeframe: '4h', strategyFamily: '4H-S4', notes: 'PD Level Break LONG @4h' },
            { signalCode: 'SYS_4TF_PD_LEVEL_BREAK_SHORT', timeframe: '4h', strategyFamily: '4H-S4', notes: 'PD Level Break SHORT @4h' },
            // S5: Volman Breakout + Momentum
            { signalCode: 'SYS_4TF_VOLMAN_BREAKOUT_LONG', timeframe: '4h', strategyFamily: '4H-S5', notes: 'Volman Breakout LONG @4h' },
            { signalCode: 'SYS_4TF_VOLMAN_BREAKOUT_SHORT', timeframe: '4h', strategyFamily: '4H-S5', notes: 'Volman Breakout SHORT @4h' },
        ],
    },
    '4tf-volman': {
        description: '4TF Plan Phase 1.5: Volman early validation gate — all Volman strategies on 2020-2022 subset.',
        runs: [
            { signalCode: 'SYS_4TF_VOLMAN_PRESSURE_LONG', timeframe: '15m', strategyFamily: '15M-S5-gate', notes: 'Volman Pressure gate @15m' },
            { signalCode: 'SYS_4TF_VOLMAN_PRESSURE_SHORT', timeframe: '15m', strategyFamily: '15M-S5-gate', notes: 'Volman Pressure gate @15m' },
            { signalCode: 'SYS_4TF_VOLMAN_BREAKOUT_LONG', timeframe: '1h', strategyFamily: '1H-S7-gate', notes: 'Volman Breakout gate @1h' },
            { signalCode: 'SYS_4TF_VOLMAN_BREAKOUT_SHORT', timeframe: '1h', strategyFamily: '1H-S7-gate', notes: 'Volman Breakout gate @1h' },
            { signalCode: 'SYS_4TF_VOLMAN_FALSE_BREAK_LONG', timeframe: '2h', strategyFamily: '2H-S5-gate', notes: 'Volman False Break gate @2h' },
            { signalCode: 'SYS_4TF_VOLMAN_FALSE_BREAK_SHORT', timeframe: '2h', strategyFamily: '2H-S5-gate', notes: 'Volman False Break gate @2h' },
            { signalCode: 'SYS_4TF_VOLMAN_BREAKOUT_LONG', timeframe: '4h', strategyFamily: '4H-S5-gate', notes: 'Volman Breakout gate @4h' },
            { signalCode: 'SYS_4TF_VOLMAN_BREAKOUT_SHORT', timeframe: '4h', strategyFamily: '4H-S5-gate', notes: 'Volman Breakout gate @4h' },
        ],
    },
};

const parseNumberArg = (label: string, raw: string) => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
        throw new Error(`Invalid ${label}: ${raw}`);
    }
    return parsed;
};

const parsePositiveNumberArg = (label: string, raw: string) => {
    const parsed = parseNumberArg(label, raw);
    if (parsed <= 0) {
        throw new Error(`${label} must be greater than 0.`);
    }
    return parsed;
};

const parseDateArg = (label: string, raw: string, boundary: 'start' | 'end') => {
    const trimmed = raw.trim();
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
        ? `${trimmed}${boundary === 'start' ? 'T00:00:00.000Z' : 'T23:59:59.999Z'}`
        : trimmed;
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) {
        throw new Error(`Invalid ${label}: ${raw}`);
    }
    return parsed;
};

const sanitizeFileToken = (value: string) => value.replace(/[^a-zA-Z0-9._-]+/g, '-');

const buildDefaultOutPath = (preset: PresetId, batchTag: string, shardCount = 1, shardIndex = 0) => {
    const shardSuffix = shardCount > 1
        ? `-shard-${shardIndex + 1}-of-${shardCount}`
        : '';
    return path.join(DEFAULT_OUT_DIR, `${sanitizeFileToken(preset)}-${sanitizeFileToken(batchTag)}${shardSuffix}.json`);
};

const buildRunNotes = (options: CliOptions, run: BatchRunPreset) => (
    `[batch:${options.batchTag}] preset=${options.preset} family=${run.strategyFamily} ${run.notes}`
);

const buildTaskKey = (run: ResolvedRun, from: Date, to: Date) => (
    `${run.signalCode}@${run.signalVersion}|${run.symbol}|${run.timeframe}|${from.toISOString()}|${to.toISOString()}`
);

function printUsage() {
    console.log([
        'Usage:',
        '  ts-node src/scripts/runBatchBacktest.ts --preset xau-phase1',
        '  ts-node src/scripts/runBatchBacktest.ts --preset xau-phase1 --shard-count 5 --shard-index 0',
        '',
        'Options:',
        '  --preset <name>          Batch preset to execute (default: xau-phase1)',
        '  --list-presets           Show available presets',
        '  --symbol <symbol>        Market symbol (default: XAUUSD)',
        '  --from <date>            Start date, YYYY-MM-DD or ISO timestamp (default: 2019-01-01)',
        '  --to <date>              End date, YYYY-MM-DD or ISO timestamp (default: 2022-12-31)',
        '  --initialEquity <num>    Initial equity (default: 10000)',
        '  --riskPercent <num>      Risk per trade percent (default: 1)',
        '  --batchTag <tag>         Batch tag used for dedupe and artifact naming',
        '  --out <path>             Artifact output path (default: .artifacts/batch-backtests/<preset>-<batchTag>.json)',
        '  --maxConcurrency <num>   Parallel execution workers inside this process (default: 1)',
        '  --shard-count <num>      Split preset runs into N contiguous shards (default: 1)',
        '  --shard-index <num>      Zero-based shard index to execute (default: 0)',
        '  --queue-only             Create runs but do not execute them now',
    ].join('\n'));
}

function parseArgs(argv: string[]): CliOptions & { listPresets: boolean } {
    let preset: PresetId = DEFAULT_PRESET;
    let symbol = DEFAULT_SYMBOL;
    let from = new Date(DEFAULT_FROM);
    let to = new Date(DEFAULT_TO);
    let initialEquity = 10_000;
    let riskPercent = 1;
    let shardCount = 1;
    let shardIndex = 0;
    let batchTag = `${preset}-${from.toISOString().slice(0, 10)}-${to.toISOString().slice(0, 10)}`;
    let outPath = buildDefaultOutPath(preset, batchTag, shardCount, shardIndex);
    let maxConcurrency = DEFAULT_MAX_CONCURRENCY;
    let queueOnly = false;
    let listPresets = false;

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--list-presets') {
            listPresets = true;
            continue;
        }
        if (arg === '--queue-only') {
            queueOnly = true;
            continue;
        }
        if (arg === '--preset') {
            const value = argv[index + 1] as PresetId | undefined;
            if (!value) throw new Error('--preset requires a value.');
            if (!(value in PRESETS)) throw new Error(`Unknown preset: ${value}`);
            preset = value;
            index += 1;
            continue;
        }
        if (arg === '--symbol') {
            const value = argv[index + 1];
            if (!value) throw new Error('--symbol requires a value.');
            symbol = normalizeMarketSymbol(value);
            index += 1;
            continue;
        }
        if (arg === '--from') {
            const value = argv[index + 1];
            if (!value) throw new Error('--from requires a value.');
            from = parseDateArg('from', value, 'start');
            index += 1;
            continue;
        }
        if (arg === '--to') {
            const value = argv[index + 1];
            if (!value) throw new Error('--to requires a value.');
            to = parseDateArg('to', value, 'end');
            index += 1;
            continue;
        }
        if (arg === '--initialEquity') {
            const value = argv[index + 1];
            if (!value) throw new Error('--initialEquity requires a value.');
            initialEquity = parsePositiveNumberArg('initialEquity', value);
            index += 1;
            continue;
        }
        if (arg === '--riskPercent') {
            const value = argv[index + 1];
            if (!value) throw new Error('--riskPercent requires a value.');
            riskPercent = parsePositiveNumberArg('riskPercent', value);
            index += 1;
            continue;
        }
        if (arg === '--batchTag') {
            const value = argv[index + 1];
            if (!value) throw new Error('--batchTag requires a value.');
            batchTag = value.trim();
            index += 1;
            continue;
        }
        if (arg === '--out') {
            const value = argv[index + 1];
            if (!value) throw new Error('--out requires a value.');
            outPath = value;
            index += 1;
            continue;
        }
        if (arg === '--maxConcurrency') {
            const value = argv[index + 1];
            if (!value) throw new Error('--maxConcurrency requires a value.');
            maxConcurrency = Math.max(1, Math.floor(parsePositiveNumberArg('maxConcurrency', value)));
            index += 1;
            continue;
        }
        if (arg === '--shard-count') {
            const value = argv[index + 1];
            if (!value) throw new Error('--shard-count requires a value.');
            shardCount = Math.max(1, Math.floor(parsePositiveNumberArg('shard-count', value)));
            index += 1;
            continue;
        }
        if (arg === '--shard-index') {
            const value = argv[index + 1];
            if (!value) throw new Error('--shard-index requires a value.');
            shardIndex = Math.floor(parseNumberArg('shard-index', value));
            index += 1;
            continue;
        }
        throw new Error(`Unknown argument: ${arg}`);
    }

    if (from >= to) {
        throw new Error('--from must be earlier than --to.');
    }
    if (shardIndex < 0) {
        throw new Error('--shard-index must be >= 0.');
    }
    if (shardIndex >= shardCount) {
        throw new Error('--shard-index must be smaller than --shard-count.');
    }

    if (!argv.includes('--batchTag')) {
        batchTag = `${preset}-${from.toISOString().slice(0, 10)}-${to.toISOString().slice(0, 10)}`;
    }
    if (!argv.includes('--out')) {
        outPath = buildDefaultOutPath(preset, batchTag, shardCount, shardIndex);
    }

    return {
        preset,
        symbol,
        from,
        to,
        initialEquity,
        riskPercent,
        batchTag,
        outPath,
        maxConcurrency,
        shardCount,
        shardIndex,
        queueOnly,
        listPresets,
    };
}

async function summarizePersistedRisk(prisma: PrismaClient, backtestRunId: string): Promise<BacktestRiskSummary> {
    const riskSummaryService = new BacktestRiskSummaryService();
    const run = await prisma.backtestRun.findUnique({
        where: { id: backtestRunId },
        select: { initialEquity: true },
    });
    if (!run) {
        throw new Error(`Run ${backtestRunId} not found for risk summary.`);
    }

    const [signals, events, traces, results] = await Promise.all([
        prisma.signal.findMany({
            where: { backtestRunId },
            select: { externalKey: true, executionConfigJson: true },
        }),
        prisma.signalEvent.findMany({
            where: { backtestRunId },
            select: {
                label: true,
                metaJson: true,
                signal: { select: { externalKey: true } },
            },
        }),
        prisma.signalLogicTrace.findMany({
            where: { backtestRunId },
            select: {
                ruleId: true,
                signal: { select: { externalKey: true } },
            },
        }),
        prisma.backtestTradeResult.findMany({
            where: { backtestRunId },
            select: {
                rMultiple: true,
                pnlUsd: true,
                isOpen: true,
                exitTime: true,
                signal: { select: { externalKey: true } },
            },
        }),
    ]);

    return riskSummaryService.summarize({
        initialEquity: Number(run.initialEquity),
        signals: signals.map((signal) => ({
            externalKey: signal.externalKey,
            executionConfigJson: signal.executionConfigJson && typeof signal.executionConfigJson === 'object'
                ? signal.executionConfigJson as Record<string, unknown>
                : null,
        })),
        events: events
            .filter((event): event is typeof event & { signal: { externalKey: string | null } } => Boolean(event.signal))
            .map((event) => ({
                signalExternalKey: event.signal.externalKey ?? '',
                label: event.label,
                metaJson: event.metaJson && typeof event.metaJson === 'object'
                    ? event.metaJson as Record<string, unknown>
                    : null,
            })),
        traces: traces
            .filter((trace): trace is typeof trace & { signal: { externalKey: string | null } } => Boolean(trace.signal))
            .map((trace) => ({
                signalExternalKey: trace.signal.externalKey ?? '',
                ruleId: trace.ruleId,
            })),
        results: results.map((result) => ({
            signalExternalKey: result.signal.externalKey ?? '',
            rMultiple: Number(result.rMultiple),
            pnlUsd: Number(result.pnlUsd),
            isOpen: result.isOpen,
            exitTime: result.exitTime,
        })),
    });
}

async function buildLeaderboardRows(prisma: PrismaClient, runIds: string[], statusesByRunId: Map<string, BacktestRunStatus>, runsByRunId: Map<string, ResolvedRun>): Promise<BatchLeaderboardRow[]> {
    if (runIds.length === 0) {
        return [];
    }

    const riskSummaryEntries = await Promise.all(runIds.map(async (runId) => ([
        runId,
        await summarizePersistedRisk(prisma, runId),
    ] as const)));
    const riskSummaryByRunId = new Map<string, BacktestRiskSummary>(riskSummaryEntries);

    const resultGroups = await prisma.backtestTradeResult.groupBy({
        by: ['backtestRunId', 'win', 'isOpen'],
        where: {
            backtestRunId: {
                in: runIds,
            },
        },
        _count: {
            _all: true,
        },
        _sum: {
            rMultiple: true,
            pnlUsd: true,
        },
        _min: {
            maxDrawdownPct: true,
        },
    });

    const aggregates = new Map<string, {
        totalTrades: number;
        closedTrades: number;
        openTrades: number;
        wins: number;
        losses: number;
        grossWinR: number;
        grossLossR: number;
        netR: number;
        netUsd: number;
        maxDrawdownPct: number | null;
    }>();

    for (const group of resultGroups) {
        const current = aggregates.get(group.backtestRunId) ?? {
            totalTrades: 0,
            closedTrades: 0,
            openTrades: 0,
            wins: 0,
            losses: 0,
            grossWinR: 0,
            grossLossR: 0,
            netR: 0,
            netUsd: 0,
            maxDrawdownPct: null,
        };
        const count = group._count._all;
        const sumR = Number(group._sum.rMultiple ?? 0);
        const sumUsd = Number(group._sum.pnlUsd ?? 0);
        const drawdownPct = group._min.maxDrawdownPct === null ? null : Number(group._min.maxDrawdownPct);

        current.totalTrades += count;
        current.netR += sumR;
        current.netUsd += sumUsd;
        if (drawdownPct !== null) {
            current.maxDrawdownPct = current.maxDrawdownPct === null
                ? drawdownPct
                : Math.min(current.maxDrawdownPct, drawdownPct);
        }

        if (group.isOpen) {
            current.openTrades += count;
        } else {
            current.closedTrades += count;
            if (group.win) {
                current.wins += count;
                current.grossWinR += sumR;
            } else {
                current.losses += count;
                current.grossLossR += Math.abs(sumR);
            }
        }

        aggregates.set(group.backtestRunId, current);
    }

    return runIds.map((runId) => {
        const task = runsByRunId.get(runId);
        if (!task) {
            throw new Error(`Missing preset metadata for run ${runId}`);
        }
        const aggregate = aggregates.get(runId) ?? {
            totalTrades: 0,
            closedTrades: 0,
            openTrades: 0,
            wins: 0,
            losses: 0,
            grossWinR: 0,
            grossLossR: 0,
            netR: 0,
            netUsd: 0,
            maxDrawdownPct: null,
        };
        const winRate = aggregate.closedTrades > 0 ? Number(((aggregate.wins / aggregate.closedTrades) * 100).toFixed(2)) : 0;
        const profitFactor = aggregate.grossLossR > 0 ? Number((aggregate.grossWinR / aggregate.grossLossR).toFixed(2)) : null;
        const riskSummary = riskSummaryByRunId.get(runId);
        if (!riskSummary) {
            throw new Error(`Missing risk summary for run ${runId}`);
        }
        return {
            runId,
            signalCode: task.signalCode,
            timeframe: task.timeframe,
            status: statusesByRunId.get(runId) ?? BacktestRunStatus.PENDING,
            strategyFamily: task.strategyFamily,
            totalTrades: aggregate.totalTrades,
            closedTrades: aggregate.closedTrades,
            wins: aggregate.wins,
            losses: aggregate.losses,
            winRate,
            profitFactor,
            netR: Number(aggregate.netR.toFixed(2)),
            netUsd: Number(aggregate.netUsd.toFixed(2)),
            maxDrawdownPct: aggregate.maxDrawdownPct === null ? null : Number(aggregate.maxDrawdownPct.toFixed(2)),
            equityCurveMaxDdUsd: riskSummary.equityCurveMaxDdUsd,
            equityCurveMaxDdPct: riskSummary.equityCurveMaxDdPct,
            maxConsecutiveLosses: riskSummary.maxConsecutiveLosses,
            maxConsecutiveLosingDays: riskSummary.maxConsecutiveLosingDays,
            guardActivationCount: riskSummary.guardActivationCount,
            blockedEntryCount: riskSummary.blockedEntryCount,
            avgRPerTrade: riskSummary.avgRPerTrade,
            medianRPerTrade: riskSummary.medianRPerTrade,
        };
    }).sort((left, right) => {
        const rightPf = right.profitFactor ?? -Infinity;
        const leftPf = left.profitFactor ?? -Infinity;
        if (rightPf !== leftPf) {
            return rightPf - leftPf;
        }
        if (right.winRate !== left.winRate) {
            return right.winRate - left.winRate;
        }
        return right.netUsd - left.netUsd;
    });
}

let runsByRunId = new Map<string, ResolvedRun>();

function printPresetList() {
    console.log('Available presets:');
    for (const [id, preset] of Object.entries(PRESETS)) {
        console.log(`- ${id}: ${preset.description}`);
    }
}

function selectShardRuns(runs: ResolvedRun[], shardCount: number, shardIndex: number): { selectedRuns: ResolvedRun[]; start: number; end: number } {
    if (shardCount <= 1) {
        return { selectedRuns: runs, start: 0, end: runs.length };
    }
    const start = Math.floor((runs.length * shardIndex) / shardCount);
    const end = Math.floor((runs.length * (shardIndex + 1)) / shardCount);
    return {
        selectedRuns: runs.slice(start, end),
        start,
        end,
    };
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.listPresets) {
        printPresetList();
        return;
    }

    const preset = PRESETS[options.preset];
    const prisma = new PrismaClient();

    try {
        const blockRegistry = createDefaultBlockRegistry();
        const seedResult = await upsertTier1ComposedSignals(prisma, blockRegistry);
        console.log(`[BatchBacktest] ensured tier1 signals: created=${seedResult.created}, updated=${seedResult.updated}, skipped=${seedResult.skipped.length}`);

        const seedVersions = new Map(getTier1ComposedSignalSeeds().map((seed) => [seed.code, seed.version] as const));
        const allResolvedRuns: ResolvedRun[] = preset.runs.map((run) => {
            const signalVersion = seedVersions.get(run.signalCode);
            if (!signalVersion) {
                throw new Error(`Preset references unknown signal seed: ${run.signalCode}`);
            }
            return {
                ...run,
                signalVersion,
                symbol: options.symbol,
                timeframe: normalizeTimeframe(run.timeframe),
            };
        });

        const shard = selectShardRuns(allResolvedRuns, options.shardCount, options.shardIndex);
        const resolvedRuns = shard.selectedRuns;
        if (resolvedRuns.length === 0) {
            throw new Error(`Shard ${options.shardIndex}/${options.shardCount} selected zero runs.`);
        }

        const existingRuns = await prisma.backtestRun.findMany({
            where: {
                sourceType: 'GENERATED',
                signalCode: { in: resolvedRuns.map((run) => run.signalCode) },
                symbol: options.symbol,
                timeframe: { in: resolvedRuns.map((run) => run.timeframe) },
                startedAt: options.from,
                finishedAt: options.to,
                notes: { contains: `[batch:${options.batchTag}]` },
            },
            select: {
                id: true,
                signalCode: true,
                signalVersion: true,
                symbol: true,
                timeframe: true,
                status: true,
                startedAt: true,
                finishedAt: true,
            },
            orderBy: { createdAt: 'desc' },
        });
        const existingByKey = new Map<string, { id: string; status: BacktestRunStatus }>();
        for (const run of existingRuns) {
            const key = `${run.signalCode}@${run.signalVersion}|${run.symbol}|${run.timeframe}|${run.startedAt.toISOString()}|${run.finishedAt?.toISOString()}`;
            if (!existingByKey.has(key)) {
                existingByKey.set(key, { id: run.id, status: run.status });
            }
        }

        const execution = new SignalBacktestExecutionService(prisma, {
            deliverConfiguredOutputs: async () => [],
        });
        const backtests = new SignalBacktestRunService(prisma);
        const outcomes: RunOutcome[] = new Array(resolvedRuns.length);
        const statusesByRunId = new Map<string, BacktestRunStatus>();
        const runIds: string[] = [];
        let cursor = 0;
        let completed = 0;

        const worker = async () => {
            while (cursor < resolvedRuns.length) {
                const index = cursor;
                cursor += 1;
                const run = resolvedRuns[index];
                const taskKey = buildTaskKey(run, options.from, options.to);
                const existing = existingByKey.get(taskKey);
                try {
                    if (existing?.status === BacktestRunStatus.COMPLETED) {
                        outcomes[index] = {
                            preset: run,
                            signalVersion: run.signalVersion,
                            runId: existing.id,
                            state: 'SKIPPED_COMPLETED',
                            status: existing.status,
                        };
                        statusesByRunId.set(existing.id, existing.status);
                        runIds.push(existing.id);
                        runsByRunId.set(existing.id, run);
                    } else if (existing?.status === BacktestRunStatus.RUNNING) {
                        outcomes[index] = {
                            preset: run,
                            signalVersion: run.signalVersion,
                            runId: existing.id,
                            state: 'FAILED',
                            status: existing.status,
                            error: `Existing run ${existing.id} is already RUNNING for this batch tag.`,
                        };
                    } else {
                        const createdOrExisting = existing
                            ? { backtestRunId: existing.id }
                            : await backtests.createGeneratedBacktest({
                                signalCode: run.signalCode,
                                signalVersion: run.signalVersion,
                                symbol: run.symbol,
                                timeframe: run.timeframe,
                                dateRange: {
                                    from: options.from.toISOString(),
                                    to: options.to.toISOString(),
                                },
                                parameters: {
                                    preset: options.preset,
                                    strategyFamily: run.strategyFamily,
                                    ...run.parameters,
                                },
                                executionConfig: DEFAULT_EXECUTION_CONFIG,
                                initialEquity: options.initialEquity,
                                riskPercent: options.riskPercent,
                                notes: buildRunNotes(options, run),
                            });
                        const runId = createdOrExisting.backtestRunId;
                        runIds.push(runId);
                        runsByRunId.set(runId, run);

                        if (options.queueOnly) {
                            outcomes[index] = {
                                preset: run,
                                signalVersion: run.signalVersion,
                                runId,
                                state: 'QUEUED',
                                status: 'QUEUED',
                            };
                        } else {
                            const result = await execution.executeRun(runId);
                            outcomes[index] = {
                                preset: run,
                                signalVersion: run.signalVersion,
                                runId,
                                state: 'EXECUTED',
                                status: result.status,
                                counts: {
                                    signals: result.counts.persistedSignals,
                                    events: result.counts.persistedEvents,
                                    traces: result.counts.persistedTraces,
                                    results: result.counts.persistedResults,
                                },
                            };
                            statusesByRunId.set(runId, result.status);
                        }
                    }
                } catch (error) {
                    outcomes[index] = {
                        preset: run,
                        signalVersion: run.signalVersion,
                        state: 'FAILED',
                        error: error instanceof Error ? error.message : String(error),
                    };
                }

                completed += 1;
                const outcome = outcomes[index];
                const label = `${run.signalCode} ${run.timeframe}`;
                if (outcome.state === 'FAILED') {
                    console.log(`[${completed}/${resolvedRuns.length}] ${label} => FAILED | ${outcome.error}`);
                } else if (outcome.state === 'SKIPPED_COMPLETED') {
                    console.log(`[${completed}/${resolvedRuns.length}] ${label} => SKIPPED_COMPLETED | run=${outcome.runId}`);
                } else if (outcome.state === 'QUEUED') {
                    console.log(`[${completed}/${resolvedRuns.length}] ${label} => QUEUED | run=${outcome.runId}`);
                } else {
                    console.log(`[${completed}/${resolvedRuns.length}] ${label} => ${outcome.status} | run=${outcome.runId} | results=${outcome.counts?.results ?? 0}`);
                }
            }
        };

        await Promise.all(Array.from({ length: Math.min(options.maxConcurrency, resolvedRuns.length) }, () => worker()));

        const executedRunIds = Array.from(new Set(outcomes
            .filter((outcome): outcome is RunOutcome & { runId: string } => Boolean(outcome.runId) && outcome.state !== 'FAILED' && outcome.state !== 'QUEUED')
            .map((outcome) => outcome.runId!)));

        if (!options.queueOnly && executedRunIds.length > 0) {
            const freshStatuses = await prisma.backtestRun.findMany({
                where: { id: { in: executedRunIds } },
                select: { id: true, status: true },
            });
            for (const row of freshStatuses) {
                statusesByRunId.set(row.id, row.status);
            }
        }

        const leaderboard = options.queueOnly
            ? []
            : await buildLeaderboardRows(prisma, executedRunIds, statusesByRunId, runsByRunId);

        const artifact = {
            preset: options.preset,
            description: preset.description,
            batchTag: options.batchTag,
            queueOnly: options.queueOnly,
            symbol: options.symbol,
            from: options.from.toISOString(),
            to: options.to.toISOString(),
            initialEquity: options.initialEquity,
            riskPercent: options.riskPercent,
            generatedAt: new Date().toISOString(),
            shard: {
                index: options.shardIndex,
                count: options.shardCount,
                start: shard.start,
                end: shard.end,
                selectedRuns: resolvedRuns.length,
                totalPresetRuns: allResolvedRuns.length,
            },
            outcomes,
            leaderboard,
        };

        fs.mkdirSync(path.dirname(options.outPath), { recursive: true });
        fs.writeFileSync(options.outPath, JSON.stringify(artifact, null, 2));

        console.log('');
        console.log('[BatchBacktest] summary');
        console.log(`  preset     : ${options.preset}`);
        console.log(`  shard      : ${options.shardIndex + 1}/${options.shardCount} (runs ${shard.start + 1}-${shard.end} of ${allResolvedRuns.length})`);
        console.log(`  batchTag   : ${options.batchTag}`);
        console.log(`  symbol     : ${options.symbol}`);
        console.log(`  window     : ${options.from.toISOString()} -> ${options.to.toISOString()}`);
        console.log(`  total runs : ${resolvedRuns.length}`);
        console.log(`  queued     : ${outcomes.filter((outcome) => outcome.state === 'QUEUED').length}`);
        console.log(`  skipped    : ${outcomes.filter((outcome) => outcome.state === 'SKIPPED_COMPLETED').length}`);
        console.log(`  executed   : ${outcomes.filter((outcome) => outcome.state === 'EXECUTED').length}`);
        console.log(`  failed     : ${outcomes.filter((outcome) => outcome.state === 'FAILED').length}`);
        console.log(`  artifact   : ${options.outPath}`);

        if (leaderboard.length > 0) {
            console.log('');
            console.log('[BatchBacktest] top results');
            for (const row of leaderboard.slice(0, 10)) {
                console.log(`  - ${row.signalCode} ${row.timeframe} | family=${row.strategyFamily} | PF=${row.profitFactor ?? 'N/A'} | WR=${row.winRate}% | trades=${row.closedTrades} | netUsd=$${row.netUsd} | eqDD=${row.equityCurveMaxDdPct}% | streak=${row.maxConsecutiveLosses}`);
            }
        }

        if (outcomes.some((outcome) => outcome.state === 'FAILED')) {
            process.exitCode = 1;
        }
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    console.error('');
    printUsage();
    process.exit(1);
});
