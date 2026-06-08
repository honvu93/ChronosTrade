import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { ComposedSignalDefinition, ComposedSignalPlugin } from '../services/signals/ComposedSignalPlugin';
import { SignalRegistry } from '../services/signals/SignalRegistry';
import { SignalBacktestRunner } from '../services/signals/SignalBacktestRunner';
import { CandleQueryService } from '../services/signals/CandleQueryService';
import { IndicatorSeriesService } from '../services/signals/IndicatorSeriesService';
import { ExecutionModelService } from '../services/signals/ExecutionModelService';
import { createDefaultBlockRegistry } from '../services/signals/blocks/createDefaultBlockRegistry';
import { getTier1ComposedSignalSeeds } from '../services/signals/tier1ComposedSignals';
import { ExecutionConfigInput } from '../services/signals/types';
import { BacktestRiskSummary, BacktestRiskSummaryService } from '../services/signals/BacktestRiskSummaryService';
import {
    applyM5Base,
    setSignalAreaGuard,
    setAtrMultiplier,
    setTakeProfitMultiple,
    setStopLookback,
} from './xauAbcOptimizationShared';

dotenv.config();

// ─── Types ───────────────────────────────────────────────────────────────────

type Summary = {
    trades: number;
    netPnl: number;
    netR: number;
    winRate: number;
    maxDd: number;
    profitFactor: number | null;
};

type WindowResult = {
    window: 'fit' | 'test' | 'full';
    from: string;
    to: string;
    summary: Summary;
    riskSummary: BacktestRiskSummary;
};

type CandidateResult = {
    candidateId: string;
    label: string;
    windows: WindowResult[];
    oosVerdict: 'PASS' | 'FAIL' | 'MARGINAL';
    oosNotes: string[];
};

type OutputFile = {
    generatedAt: string;
    symbol: string;
    initialEquity: number;
    riskPercent: number;
    executionConfig: ExecutionConfigInput;
    baseSignalCode: string;
    fitWindow: { from: string; to: string };
    testWindow: { from: string; to: string };
    fullWindow: { from: string; to: string };
    candidates: CandidateResult[];
};

// ─── Constants ────────────────────────────────────────────────────────────────

const SYMBOL = 'XAUUSD';
const INITIAL_EQUITY = 10_000;
const RISK_PERCENT = 2;
const BASE_SIGNAL_CODE = 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG';
const DEFAULT_OUT_DIR = '.artifacts/xau-oos-validation';
const DEFAULT_OUT_PATH = `${DEFAULT_OUT_DIR}/oos_validation.json`;

const FULL_FROM = new Date('2019-01-01T00:00:00.000Z');
const FULL_TO = new Date('2026-03-14T23:59:59.999Z');
const FIT_FROM = new Date('2019-01-01T00:00:00.000Z');
const FIT_TO = new Date('2022-12-31T23:59:59.999Z');
const TEST_FROM = new Date('2023-01-01T00:00:00.000Z');
const TEST_TO = new Date('2026-03-14T23:59:59.999Z');

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

// ─── Candidate definitions ────────────────────────────────────────────────────

type CandidateSpec = {
    id: string;
    label: string;
    mutate(definition: ComposedSignalDefinition): void;
};

const CANDIDATES: CandidateSpec[] = [
    {
        id: 'cap5_tp25',
        label: 'XAU_ABC_M5_CAP5_TP25 (capped alpha lane): TP 2.5R, area cap 5, ATR 1.15',
        mutate(definition) {
            applyM5Base(definition);
            setSignalAreaGuard(definition, { maxSignalsPerArea: 5, resetBars: 8, priceDistanceR: 0.75 });
            setAtrMultiplier(definition, 1.15);
            setTakeProfitMultiple(definition, 2.5);
            definition.exitManagement = { profileCode: 'HARD_SIGNAL_TP' };
        },
    },
    {
        id: 'cap5_lb96',
        label: 'XAU_ABC_M5_CAP5_LB96 (capped safety lane): lookback 96, area cap 5, ATR 1.15',
        mutate(definition) {
            applyM5Base(definition);
            setSignalAreaGuard(definition, { maxSignalsPerArea: 5, resetBars: 8, priceDistanceR: 0.75 });
            setAtrMultiplier(definition, 1.15);
            setStopLookback(definition, 96);
            definition.exitManagement = { profileCode: 'HARD_SIGNAL_TP' };
        },
    },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const jsonClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function summarize(results: Array<{ isOpen: boolean; pnlUsd: number; rMultiple: number; win: boolean; maxDrawdownPct: number }>): Summary {
    const closed = results.filter((row) => !row.isOpen);
    const netPnl = closed.reduce((sum, row) => sum + Number(row.pnlUsd), 0);
    const netR = closed.reduce((sum, row) => sum + Number(row.rMultiple), 0);
    const wins = closed.filter((row) => row.win).length;
    const maxDd = closed.length ? Math.min(...closed.map((row) => Number(row.maxDrawdownPct))) : 0;
    const grossWin = closed
        .filter((row) => Number(row.pnlUsd) > 0)
        .reduce((sum, row) => sum + Number(row.pnlUsd), 0);
    const grossLoss = Math.abs(
        closed
            .filter((row) => Number(row.pnlUsd) < 0)
            .reduce((sum, row) => sum + Number(row.pnlUsd), 0),
    );

    return {
        trades: closed.length,
        netPnl: Number(netPnl.toFixed(2)),
        netR: Number(netR.toFixed(2)),
        winRate: closed.length ? Number(((wins / closed.length) * 100).toFixed(2)) : 0,
        maxDd: Number(maxDd.toFixed(2)),
        profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : null,
    };
}

function computeOosVerdict(fitWindow: WindowResult, testWindow: WindowResult): { verdict: 'PASS' | 'FAIL' | 'MARGINAL'; notes: string[] } {
    const notes: string[] = [];
    const wrDrop = testWindow.summary.winRate - fitWindow.summary.winRate;
    const testNetPnlPositive = testWindow.summary.netPnl > 0;
    const testDdWithinFit = testWindow.riskSummary.equityCurveMaxDdPct <= fitWindow.riskSummary.equityCurveMaxDdPct;

    notes.push(`WR drop fit→test: ${wrDrop.toFixed(2)}pp (fit=${fitWindow.summary.winRate}%, test=${testWindow.summary.winRate}%)`);
    notes.push(`Test Net PnL: $${testWindow.summary.netPnl} (${testNetPnlPositive ? 'positive' : 'negative'})`);
    notes.push(`Equity DD — fit: ${fitWindow.riskSummary.equityCurveMaxDdPct.toFixed(2)}%, test: ${testWindow.riskSummary.equityCurveMaxDdPct.toFixed(2)}% (${testDdWithinFit ? 'within fit' : 'EXCEEDED fit'})`);

    // PASS: WR drop <= 10pp AND test PnL > 0 AND test DD <= fit DD
    const isPass = wrDrop >= -10 && testNetPnlPositive && testDdWithinFit;
    // FAIL: WR drop worse than -15pp OR test PnL <= 0 OR DD badly exceeded
    const isFail = wrDrop < -15 || !testNetPnlPositive || (!testDdWithinFit && testWindow.riskSummary.equityCurveMaxDdPct < fitWindow.riskSummary.equityCurveMaxDdPct - 3);
    // MARGINAL: between -10pp and -15pp WR drop but still positive PnL
    const isMarginal = !isPass && !isFail;

    if (isPass) {
        notes.push('Verdict: PASS — WR drop within tolerance, positive PnL, and DD within fit window.');
    } else if (isMarginal) {
        notes.push('Verdict: MARGINAL — borderline WR decay, positive PnL but some degradation detected.');
    } else {
        notes.push('Verdict: FAIL — significant degradation on one or more key metrics.');
    }

    return {
        verdict: isPass ? 'PASS' : isFail ? 'FAIL' : 'MARGINAL',
        notes,
    };
}

function parseArgs(argv: string[]) {
    let outPath = DEFAULT_OUT_PATH;

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--out') {
            const value = argv[index + 1];
            if (!value) {
                throw new Error('--out requires a filepath.');
            }
            outPath = value;
            index += 1;
            continue;
        }
        throw new Error(`Unknown argument "${arg}".`);
    }

    return { outPath };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    const args = parseArgs(process.argv.slice(2));

    const baseSeed = getTier1ComposedSignalSeeds().find((seed) => seed.code === BASE_SIGNAL_CODE);
    if (!baseSeed) {
        throw new Error(`Base seed ${BASE_SIGNAL_CODE} was not found.`);
    }

    const prisma = new PrismaClient();
    const registry = SignalRegistry.getInstance();
    const runner = new SignalBacktestRunner(
        new CandleQueryService(prisma),
        new IndicatorSeriesService(),
        new ExecutionModelService(),
        registry,
    );
    const blockRegistry = createDefaultBlockRegistry();
    const riskSummaryService = new BacktestRiskSummaryService();

    const windows: Array<{ window: 'fit' | 'test' | 'full'; from: Date; to: Date }> = [
        { window: 'full', from: FULL_FROM, to: FULL_TO },
        { window: 'fit', from: FIT_FROM, to: FIT_TO },
        { window: 'test', from: TEST_FROM, to: TEST_TO },
    ];

    const candidateResults: CandidateResult[] = [];

    try {
        console.log(`XAU OOS Validation — base signal: ${BASE_SIGNAL_CODE}`);
        console.log(`Fit window : ${FIT_FROM.toISOString()} → ${FIT_TO.toISOString()}`);
        console.log(`Test window: ${TEST_FROM.toISOString()} → ${TEST_TO.toISOString()}`);
        console.log(`Full window: ${FULL_FROM.toISOString()} → ${FULL_TO.toISOString()}`);
        console.log(`Candidates : ${CANDIDATES.map((c) => c.id).join(', ')}`);
        console.log('');

        for (const candidate of CANDIDATES) {
            console.log(`--- Candidate: ${candidate.id} ---`);
            const windowResults: WindowResult[] = [];

            for (const win of windows) {
                const definition = jsonClone(baseSeed.composedBlocks) as ComposedSignalDefinition;
                candidate.mutate(definition);

                const timeframe = String((definition as { timeframe?: string }).timeframe ?? 'M5');
                const tmpCode = `XAUOOS_${candidate.id}_${win.window}`.toUpperCase().slice(0, 60);

                registry.register(new ComposedSignalPlugin(
                    definition,
                    blockRegistry,
                    tmpCode,
                    1,
                    tmpCode,
                ));

                try {
                    console.log(`  Running ${win.window} window (${win.from.toISOString().slice(0, 10)} → ${win.to.toISOString().slice(0, 10)})...`);
                    const output = await runner.run({
                        signalCode: tmpCode,
                        signalVersion: 1,
                        symbol: SYMBOL,
                        timeframe,
                        from: win.from,
                        to: win.to,
                        parameters: {},
                        initialEquity: INITIAL_EQUITY,
                        riskPercent: RISK_PERCENT,
                        executionConfig: DEFAULT_EXECUTION_CONFIG,
                    });

                    const summary = summarize(output.results as Array<{
                        isOpen: boolean;
                        pnlUsd: number;
                        rMultiple: number;
                        win: boolean;
                        maxDrawdownPct: number;
                    }>);

                    const riskSummary = riskSummaryService.summarize({
                        initialEquity: INITIAL_EQUITY,
                        results: output.results,
                        signals: output.signals,
                        events: output.events,
                        traces: output.traces,
                    });

                    windowResults.push({
                        window: win.window,
                        from: win.from.toISOString(),
                        to: win.to.toISOString(),
                        summary,
                        riskSummary,
                    });

                    console.log(`  [DONE] ${win.window}: PnL=$${summary.netPnl}, WR=${summary.winRate}%, DD=${riskSummary.equityCurveMaxDdPct.toFixed(2)}%, trades=${summary.trades}`);
                } finally {
                    registry.unregister(tmpCode, 1);
                }
            }

            const fitResult = windowResults.find((w) => w.window === 'fit');
            const testResult = windowResults.find((w) => w.window === 'test');

            if (!fitResult || !testResult) {
                throw new Error(`Missing fit or test window result for candidate ${candidate.id}`);
            }

            const { verdict, notes } = computeOosVerdict(fitResult, testResult);

            candidateResults.push({
                candidateId: candidate.id,
                label: candidate.label,
                windows: windowResults,
                oosVerdict: verdict,
                oosNotes: notes,
            });

            console.log(`  OOS Verdict: ${verdict}`);
            for (const note of notes) {
                console.log(`    ${note}`);
            }
            console.log('');
        }
    } finally {
        await prisma.$disconnect();
    }

    const outputFile: OutputFile = {
        generatedAt: new Date().toISOString(),
        symbol: SYMBOL,
        initialEquity: INITIAL_EQUITY,
        riskPercent: RISK_PERCENT,
        executionConfig: DEFAULT_EXECUTION_CONFIG,
        baseSignalCode: BASE_SIGNAL_CODE,
        fitWindow: { from: FIT_FROM.toISOString(), to: FIT_TO.toISOString() },
        testWindow: { from: TEST_FROM.toISOString(), to: TEST_TO.toISOString() },
        fullWindow: { from: FULL_FROM.toISOString(), to: FULL_TO.toISOString() },
        candidates: candidateResults,
    };

    const resolvedPath = path.resolve(args.outPath);
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    fs.writeFileSync(resolvedPath, JSON.stringify(outputFile, null, 2));
    console.log(`Saved JSON output to ${resolvedPath}`);

    // Print summary table
    console.log('\n=== OOS Validation Summary ===');
    for (const candidate of candidateResults) {
        console.log(`\nCandidate: ${candidate.candidateId} — ${candidate.oosVerdict}`);
        const rows = candidate.windows.map((w) => ({
            Window: w.window,
            From: w.from.slice(0, 10),
            To: w.to.slice(0, 10),
            Trades: w.summary.trades,
            'WR%': `${w.summary.winRate}%`,
            'Net PnL': `$${w.summary.netPnl}`,
            'NetR': w.summary.netR,
            'PF': w.summary.profitFactor,
            'MaxDd%': `${w.summary.maxDd}%`,
            'EqDdPct%': `${w.riskSummary.equityCurveMaxDdPct.toFixed(2)}%`,
        }));
        console.table(rows);
        console.log('Notes:');
        for (const note of candidate.oosNotes) {
            console.log(`  - ${note}`);
        }
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
