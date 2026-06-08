import { PrismaClient } from '@prisma/client';
import { SignalBacktestExecutionService } from '../SignalBacktestExecutionService';
import { SignalBacktestRunService } from '../SignalBacktestRunService';
import { ExecutionConfigInput } from '../types';
import { generateWalkForwardFolds, formatFoldInfo } from './trainValSplit';
import {
    WalkForwardFold,
    WalkForwardGate,
    WfFoldMetrics,
    WalkForwardFoldResult,
    WalkForwardResult,
} from './optimizationTypes';
import { normalizeMarketSymbol, getMarketSymbolAliases } from '../../../utils/symbols';
import { normalizeTimeframe, getTimeframeAliases } from '../../../utils/timeframes';

export interface WfCandidate {
    signalCode: string;
    signalVersion: number;
    symbol: string;
    timeframe: string;
    label: string;
    execConfig: ExecutionConfigInput;
    initialEquity: number;
    riskPercent: number;
    /** Extra parameters merged into backtest parameters (e.g. exitStrategy, maxBarsInTrade overrides) */
    extraParameters?: Record<string, unknown>;
}

export interface WfRunConfig {
    dataFrom: Date;
    dataTo: Date;
    trainMonths: number;
    testMonths: number;
    stepMonths: number;
}

const DEFAULT_GATE: WalkForwardGate = {
    minTestPF: 1.30,
    maxTestDD: 15,
    maxWrDeltaPP: null,
    minFoldsPassRatio: 0.75,
};

export class WalkForwardEngine {
    constructor(
        private prisma: PrismaClient,
        private backtests: SignalBacktestRunService,
        private execService: SignalBacktestExecutionService,
    ) {}

    async run(
        candidate: WfCandidate,
        config: WfRunConfig,
        gate: WalkForwardGate = DEFAULT_GATE,
    ): Promise<WalkForwardResult> {
        const startMs = Date.now();

        const folds = generateWalkForwardFolds(
            config.dataFrom, config.dataTo,
            config.trainMonths, config.testMonths, config.stepMonths,
        );

        if (folds.length === 0) {
            throw new Error('No walk-forward folds could be generated — data range too short');
        }

        const resolvedMinFoldsPass = gate.minFoldsPass ?? Math.ceil(folds.length * (gate.minFoldsPassRatio ?? 0.75));
        const wrDeltaGateLabel = gate.maxWrDeltaPP == null
            ? 'WR Δ=OFF'
            : `WR Δ<=${gate.maxWrDeltaPP}pp`;

        console.log(`\n${'═'.repeat(80)}`);
        console.log(`  WALK-FORWARD VALIDATION: ${candidate.label} (${candidate.timeframe})`);
        console.log('═'.repeat(80));
        console.log(`  Folds: ${folds.length} | Train: ${config.trainMonths}mo | Test: ${config.testMonths}mo | Step: ${config.stepMonths}mo`);
        console.log(`  Gate: PF>=${gate.minTestPF} | DD<=${gate.maxTestDD}% | ${wrDeltaGateLabel} | Pass>=${resolvedMinFoldsPass}/${folds.length}`);
        console.log(`  Risk: ${candidate.riskPercent}% | Compound: ${candidate.execConfig.compoundEquity ? 'ON' : 'OFF'} | Equity: $${candidate.initialEquity}`);
        console.log();

        // Pre-flight: verify data availability
        await this.verifyDataAvailability(candidate, folds);
        console.log();

        const results: WalkForwardFoldResult[] = [];

        for (const fold of folds) {
            console.log(formatFoldInfo(fold));

            const trainMetrics = await this.executeAndMeasure(
                candidate, fold.trainFrom, fold.trainTo,
                `wf-train-f${fold.foldIndex}`,
            );

            const testMetrics = await this.executeAndMeasure(
                candidate, fold.testFrom, fold.testTo,
                `wf-test-f${fold.foldIndex}`,
            );

            const wrDelta = trainMetrics.winRate - testMetrics.winRate;
            const { pass, failReasons } = this.checkGate(testMetrics, wrDelta, gate);

            results.push({ fold, trainMetrics, testMetrics, wrDelta, pass, failReasons });

            const icon = pass ? '✅' : '❌';
            console.log(`  Train: trades=${trainMetrics.trades} PF=${this.fmtPF(trainMetrics.profitFactor)} WR=${trainMetrics.winRate.toFixed(1)}% DD=${trainMetrics.equityDD.toFixed(1)}%`);
            console.log(`  Test:  trades=${testMetrics.trades} PF=${this.fmtPF(testMetrics.profitFactor)} WR=${testMetrics.winRate.toFixed(1)}% DD=${testMetrics.equityDD.toFixed(1)}%`);
            console.log(`  ${icon} ${pass ? 'PASS' : `FAIL: ${failReasons.join(', ')}`}`);
            console.log();
        }

        const passCount = results.filter(r => r.pass).length;
        const overallPass = passCount >= resolvedMinFoldsPass;
        const compositeOOS = this.computeCompositeOOS(results);
        const durationSec = (Date.now() - startMs) / 1000;

        console.log('═'.repeat(80));
        console.log('  WALK-FORWARD SUMMARY');
        console.log('═'.repeat(80));
        console.log(`  Pass: ${passCount}/${results.length} (need ${resolvedMinFoldsPass})`);
        console.log(`  Overall: ${overallPass ? '✅ PASS' : '❌ FAIL'}`);
        console.log(`  Composite OOS: trades=${compositeOOS.totalTrades} PnL=$${compositeOOS.totalNetPnl.toFixed(2)} avgWR=${compositeOOS.avgWR.toFixed(1)}% avgPF=${compositeOOS.avgPF.toFixed(2)}`);
        console.log(`  Duration: ${durationSec.toFixed(1)}s`);
        console.log();

        // Per-fold summary table
        console.log('  Fold │ Period          │ Test Trades │  PF   │  WR%  │  DD%  │ WRΔ  │ Result');
        console.log('  ─────┼─────────────────┼─────────────┼───────┼───────┼───────┼──────┼───────');
        for (const r of results) {
            const fmt = (d: Date) => d.toISOString().slice(0, 7);
            const period = `${fmt(r.fold.testFrom)}-${fmt(r.fold.testTo)}`;
            const icon = r.pass ? '✅' : '❌';
            console.log(
                `  ${String(r.fold.foldIndex + 1).padStart(4)} │ ${period.padEnd(15)} │ ${String(r.testMetrics.trades).padStart(11)} │ ${this.fmtPF(r.testMetrics.profitFactor).padStart(5)} │ ${r.testMetrics.winRate.toFixed(1).padStart(5)} │ ${r.testMetrics.equityDD.toFixed(1).padStart(5)} │ ${r.wrDelta.toFixed(1).padStart(4)}pp│ ${icon}`,
            );
        }
        console.log();

        return {
            signalCode: candidate.signalCode,
            timeframe: candidate.timeframe,
            config: { trainMonths: config.trainMonths, testMonths: config.testMonths, stepMonths: config.stepMonths },
            gate: { ...gate, resolvedMinFoldsPass },
            folds: results,
            passCount,
            failCount: results.length - passCount,
            totalFolds: results.length,
            overallPass,
            compositeOOS,
            durationSec,
        };
    }

    // ─── Gate Check ──────────────────────────────────────────────────────────

    private checkGate(
        test: WfFoldMetrics,
        wrDelta: number,
        gate: WalkForwardGate,
    ): { pass: boolean; failReasons: string[] } {
        const failReasons: string[] = [];

        if (test.trades === 0) {
            return { pass: false, failReasons: ['0 test trades'] };
        }

        const testPF = test.profitFactor ?? 0;
        if (testPF < gate.minTestPF) {
            failReasons.push(`PF ${testPF.toFixed(2)} < ${gate.minTestPF}`);
        }

        if (test.equityDD > gate.maxTestDD) {
            failReasons.push(`DD ${test.equityDD.toFixed(1)}% > ${gate.maxTestDD}%`);
        }

        if (gate.maxWrDeltaPP != null && Math.abs(wrDelta) > gate.maxWrDeltaPP) {
            failReasons.push(`WR Δ ${Math.abs(wrDelta).toFixed(1)}pp > ${gate.maxWrDeltaPP}pp`);
        }

        return { pass: failReasons.length === 0, failReasons };
    }

    // ─── Composite OOS ──────────────────────────────────────────────────────

    private computeCompositeOOS(results: WalkForwardFoldResult[]) {
        const testResults = results.map(r => r.testMetrics);
        const totalTrades = testResults.reduce((s, m) => s + m.trades, 0);
        const totalNetPnl = testResults.reduce((s, m) => s + m.netPnl, 0);

        // Trade-weighted average WR
        const avgWR = totalTrades > 0
            ? testResults.reduce((s, m) => s + m.winRate * m.trades, 0) / totalTrades
            : 0;

        // Average PF across folds with trades
        const validPFs = testResults.filter(m => m.profitFactor != null && m.trades > 0);
        const avgPF = validPFs.length > 0
            ? validPFs.reduce((s, m) => s + (m.profitFactor ?? 0), 0) / validPFs.length
            : 0;

        return { totalTrades, totalNetPnl, avgWR, avgPF };
    }

    // ─── Data Availability Check ─────────────────────────────────────────────

    private async verifyDataAvailability(candidate: WfCandidate, folds: WalkForwardFold[]) {
        const symbolAliases = getMarketSymbolAliases(candidate.symbol);
        const tfAliases = getTimeframeAliases(candidate.timeframe);
        const firstFold = folds[0];
        const lastFold = folds[folds.length - 1];

        const earliest = await this.prisma.candle.findFirst({
            where: { symbol: { in: symbolAliases }, timeframe: { in: tfAliases }, time: { gte: firstFold.trainFrom } },
            orderBy: { time: 'asc' },
            select: { time: true },
        });

        const latest = await this.prisma.candle.findFirst({
            where: { symbol: { in: symbolAliases }, timeframe: { in: tfAliases }, time: { lte: lastFold.testTo } },
            orderBy: { time: 'desc' },
            select: { time: true },
        });

        if (!earliest || !latest) {
            throw new Error(`No candle data for ${candidate.symbol} ${candidate.timeframe} (aliases: ${symbolAliases.join(',')}/${tfAliases.join(',')})`);
        }

        const fmt = (d: Date) => d.toISOString().slice(0, 10);
        console.log(`  Data available: ${fmt(earliest.time)} → ${fmt(latest.time)}`);

        if (earliest.time > firstFold.trainFrom) {
            console.log(`  ⚠️  Data starts ${fmt(earliest.time)}, after first fold train start ${fmt(firstFold.trainFrom)}`);
        }
        if (latest.time < lastFold.testTo) {
            console.log(`  ⚠️  Data ends ${fmt(latest.time)}, before last fold test end ${fmt(lastFold.testTo)}`);
        }
    }

    // ─── Backtest Execution ──────────────────────────────────────────────────

    private async executeAndMeasure(
        candidate: WfCandidate,
        from: Date,
        to: Date,
        tag: string,
    ): Promise<WfFoldMetrics> {
        const { backtestRunId } = await this.backtests.createGeneratedBacktest({
            signalCode: candidate.signalCode,
            signalVersion: candidate.signalVersion,
            symbol: candidate.symbol,
            timeframe: candidate.timeframe,
            dateRange: { from: from.toISOString(), to: to.toISOString() },
            executionConfig: candidate.execConfig,
            initialEquity: candidate.initialEquity,
            riskPercent: candidate.riskPercent,
            notes: `[walk-forward] ${tag} ${candidate.label}`,
            parameters: { walkForward: tag, ...candidate.extraParameters },
        });

        await this.execService.executeRun(backtestRunId);

        const rows = await this.prisma.backtestTradeResult.findMany({
            where: { backtestRunId },
            select: { pnlUsd: true, win: true, isOpen: true, exitTime: true },
            orderBy: { exitTime: 'asc' },
        });

        const closed = rows.filter(r => !r.isOpen);
        const wins = closed.filter(r => r.win).length;
        const netPnl = closed.reduce((s, r) => s + Number(r.pnlUsd), 0);
        const grossW = closed.filter(r => r.win).reduce((s, r) => s + Number(r.pnlUsd), 0);
        const grossL = Math.abs(closed.filter(r => !r.win).reduce((s, r) => s + Number(r.pnlUsd), 0));
        const pf = grossL > 0 ? Math.round((grossW / grossL) * 100) / 100 : (grossW > 0 ? 999 : null);
        const wr = closed.length > 0 ? Math.round((wins / closed.length) * 10000) / 100 : 0;
        const equityDD = this.computeEquityDD(closed.map(r => ({ pnlUsd: Number(r.pnlUsd) })), candidate.initialEquity);
        const streak = this.computeMaxConsecLosses(closed.map(r => ({ win: r.win })));
        const finalEquity = candidate.initialEquity + netPnl;

        return {
            backtestRunId,
            trades: closed.length,
            netPnl: Math.round(netPnl * 100) / 100,
            winRate: wr,
            profitFactor: pf,
            equityDD,
            maxConsecLosses: streak,
            finalEquity: Math.round(finalEquity * 100) / 100,
        };
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    private computeEquityDD(trades: Array<{ pnlUsd: number }>, initialEquity: number): number {
        let equity = initialEquity, peak = equity, maxDd = 0;
        for (const t of trades) {
            equity += t.pnlUsd;
            if (equity > peak) peak = equity;
            const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
            if (dd > maxDd) maxDd = dd;
        }
        return Math.round(maxDd * 10000) / 10000;
    }

    private computeMaxConsecLosses(trades: Array<{ win: boolean }>): number {
        let max = 0, cur = 0;
        for (const t of trades) {
            if (!t.win) { cur++; if (cur > max) max = cur; } else cur = 0;
        }
        return max;
    }

    private fmtPF(pf: number | null): string {
        if (pf === null) return 'N/A';
        if (pf >= 999) return '∞';
        return pf.toFixed(2);
    }
}
