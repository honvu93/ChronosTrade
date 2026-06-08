import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { ComposedSignalDefinition, ComposedSignalPlugin } from '../services/signals/ComposedSignalPlugin';
import { SignalRegistry } from '../services/signals/SignalRegistry';
import { SignalBacktestRunner } from '../services/signals/SignalBacktestRunner';
import { CandleQueryService } from '../services/signals/CandleQueryService';
import { IndicatorSeriesService } from '../services/signals/IndicatorSeriesService';
import { ExecutionModelService } from '../services/signals/ExecutionModelService';
import { createDefaultBlockRegistry } from '../services/signals/blocks/createDefaultBlockRegistry';
import { getTier1ComposedSignalSeeds } from '../services/signals/tier1ComposedSignals';
import { BacktestRiskSummaryService } from '../services/signals/BacktestRiskSummaryService';
import { ExecutionConfigInput, TradeGuardConfigInput } from '../services/signals/types';
import { EngineAnalyticsService } from '../services/EngineAnalyticsService';
import {
    applyM5Base,
    setRsiThreshold,
    setAtrMultiplier,
    setStopLookback,
    setAtrBufferMultiplier,
    setTakeProfitMultiple,
    addPriceAboveEma,
    setSignalAreaGuard,
    addBullishMarketRegime,
} from './xauAbcOptimizationShared';

dotenv.config();

// ─── Constants ──────────────────────────────────────────────────────────────

const FROM = new Date('2019-01-01T00:00:00.000Z');
const TO = new Date('2026-03-14T23:59:59.999Z');
const SYMBOL = 'XAUUSD';
const INITIAL_EQUITY = 10_000;
const RISK_PERCENT = 2;
const TOP_N = 3;

const BASE_EXECUTION_CONFIG: ExecutionConfigInput = {
    entryFeeBps: 4,
    exitFeeBps: 4,
    entrySlippageBps: 2,
    exitSlippageBps: 2,
    orderTiming: 'NEXT_BAR_OPEN',
    stopLoss: { mode: 'SIGNAL_PRICE' },
    takeProfit: { mode: 'SIGNAL_PRICE' },
    positionSizing: { mode: 'RISK_BASED' },
};

// ─── Guard Profiles ─────────────────────────────────────────────────────────

interface GuardProfile {
    id: string;
    label: string;
    guards: TradeGuardConfigInput;
    compoundEquity: boolean;
}

const MODERATE_GUARDS: TradeGuardConfigInput = {
    sessionLossCap: { maxLosses: 3, maxNetR: 3.0 },
    dayLossCap: { maxLosses: 4, maxNetR: 4.0 },
    lossStreakCooldown: { afterLosses: 5, cooldownMinutes: 720 },
    lossStreakThrottle: {
        steps: [
            { afterLosses: 3, riskPercent: 1.5 },
            { afterLosses: 5, riskPercent: 1.0 },
        ],
    },
};

const GUARD_PROFILES: GuardProfile[] = [
    // ─── Fixed equity baselines ──────────────────────────────────────────
    {
        id: 'BASELINE',
        label: 'No guards (fixed equity)',
        guards: {},
        compoundEquity: false,
    },
    {
        id: 'SPACING_30',
        label: 'Moderate + Spacing 30 min (fixed equity)',
        guards: { ...MODERATE_GUARDS, minTradeSpacing: { minSpacingMinutes: 30 } },
        compoundEquity: false,
    },
    // ─── Compound equity variants ────────────────────────────────────────
    {
        id: 'COMPOUND_BASELINE',
        label: 'No guards (compound equity)',
        guards: {},
        compoundEquity: true,
    },
    {
        id: 'COMPOUND_MODERATE',
        label: 'Moderate guards (compound equity)',
        guards: MODERATE_GUARDS,
        compoundEquity: true,
    },
    {
        id: 'COMPOUND_ECF_BLOCK_10',
        label: 'Compound + Moderate + ECF BLOCK EMA(10)',
        guards: { ...MODERATE_GUARDS, equityCurveFilter: { emaTrades: 10, action: 'BLOCK' } },
        compoundEquity: true,
    },
    {
        id: 'COMPOUND_ECF_HALF_10',
        label: 'Compound + Moderate + ECF HALF_RISK EMA(10)',
        guards: { ...MODERATE_GUARDS, equityCurveFilter: { emaTrades: 10, action: 'HALF_RISK' } },
        compoundEquity: true,
    },
    {
        id: 'COMPOUND_DD_HALT_10',
        label: 'Compound + Moderate + DD Halt 10%',
        guards: { ...MODERATE_GUARDS, maxDrawdownHalt: { maxDrawdownPct: 10 } },
        compoundEquity: true,
    },
    {
        id: 'COMPOUND_SPACING_30',
        label: 'Compound + Moderate + Spacing 30 min',
        guards: { ...MODERATE_GUARDS, minTradeSpacing: { minSpacingMinutes: 30 } },
        compoundEquity: true,
    },
    {
        id: 'COMPOUND_FULL',
        label: 'Compound + Moderate + ECF BLOCK(10) + DD 10% + Spacing 30min',
        guards: {
            ...MODERATE_GUARDS,
            equityCurveFilter: { emaTrades: 10, action: 'BLOCK' },
            maxDrawdownHalt: { maxDrawdownPct: 10 },
            minTradeSpacing: { minSpacingMinutes: 30 },
        },
        compoundEquity: true,
    },
    {
        id: 'COMPOUND_BALANCED',
        label: 'Compound + Moderate + ECF HALF(15) + DD 15% + Spacing 15min',
        guards: {
            ...MODERATE_GUARDS,
            equityCurveFilter: { emaTrades: 15, action: 'HALF_RISK' },
            maxDrawdownHalt: { maxDrawdownPct: 15 },
            minTradeSpacing: { minSpacingMinutes: 15 },
        },
        compoundEquity: true,
    },
];

// ─── Types ──────────────────────────────────────────────────────────────────

type Top5Entry = {
    rank: number;
    runId: string;
    runName: string;
    signalCode: string | null;
    timeframe: string;
    closedTrades: number;
    winRate: number;
    profitFactor: number;
    netR: number;
    netUsd: number;
    maxDrawdownPct: number;
    parametersJson: Record<string, unknown>;
};

type RunResult = {
    signalLabel: string;
    guardProfile: string;
    trades: number;
    netPnl: number;
    netR: number;
    winRate: number;
    maxDd: number;
    profitFactor: number | null;
    maxConsecutiveLosses: number;
    ecfBlockCount: number;
    ddHaltBlockCount: number;
    spacingBlockCount: number;
    blockedEntryCount: number;
};

// ─── Helpers ────────────────────────────────────────────────────────────────

const jsonClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const round = (value: number, digits = 2) => Number(value.toFixed(digits));

function summarize(results: Array<{ isOpen: boolean; pnlUsd: number; rMultiple: number; win: boolean; maxDrawdownPct: number }>) {
    const closed = results.filter((row) => !row.isOpen);
    const netPnl = closed.reduce((sum, row) => sum + Number(row.pnlUsd), 0);
    const netR = closed.reduce((sum, row) => sum + Number(row.rMultiple), 0);
    const wins = closed.filter((row) => row.win).length;
    const maxDd = closed.length ? Math.min(...closed.map((row) => Number(row.maxDrawdownPct))) : 0;
    const grossWin = closed.filter((row) => Number(row.pnlUsd) > 0).reduce((sum, row) => sum + Number(row.pnlUsd), 0);
    const grossLoss = Math.abs(closed.filter((row) => Number(row.pnlUsd) < 0).reduce((sum, row) => sum + Number(row.pnlUsd), 0));

    return {
        trades: closed.length,
        netPnl: round(netPnl),
        netR: round(netR),
        winRate: closed.length ? round((wins / closed.length) * 100) : 0,
        maxDd: round(maxDd),
        profitFactor: grossLoss > 0 ? round(grossWin / grossLoss) : null,
    };
}

function applyParams(definition: ComposedSignalDefinition, params: Record<string, unknown>, timeframe: string): void {
    if (timeframe === 'M5') applyM5Base(definition);

    if (params.rsiThreshold !== undefined) setRsiThreshold(definition, Number(params.rsiThreshold));
    if (params.atrMultiplier !== undefined) setAtrMultiplier(definition, Number(params.atrMultiplier));
    if (params.stopLookback !== undefined) setStopLookback(definition, Number(params.stopLookback));
    if (params.atrBufferMultiplier !== undefined) setAtrBufferMultiplier(definition, Number(params.atrBufferMultiplier));
    if (params.tpMultiple !== undefined) setTakeProfitMultiple(definition, Number(params.tpMultiple));
    if (params.useEmaFilter) addPriceAboveEma(definition);
    if (params.useMarketRegime) addBullishMarketRegime(definition);
    if (params.maxSignalsPerArea !== undefined) {
        setSignalAreaGuard(definition, {
            maxSignalsPerArea: Number(params.maxSignalsPerArea),
            priceDistanceR: params.priceDistanceR !== undefined ? Number(params.priceDistanceR) : undefined,
        });
    }
    if (params.regimeFilter === 'FILTER_B_TREND') {
        definition.blocks.push({
            id: 'opt7_confirmation_uptrend',
            indicatorId: 'CONFIRMATION_TREND',
            conditionId: 'confirmation_uptrend',
            indicatorParams: { fastPeriod: 50, slowPeriod: 200, adxPeriod: 14 },
            conditionParams: { adxThreshold: 20 },
        });
    }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
    const prisma = new PrismaClient();
    const analytics = new EngineAnalyticsService(prisma);
    const riskSummaryService = new BacktestRiskSummaryService();

    // ─── Step 1: Query top 5 backtests from DB ──────────────────────────────

    console.log(`\n${'═'.repeat(80)}`);
    console.log(`OPT-9: Top ${TOP_N} Guard Optimization`);
    console.log(`${'═'.repeat(80)}\n`);
    console.log('Step 1: Querying leaderboard for top 5 backtests...\n');

    const leaderboard = await analytics.getGeneratedBacktestLeaderboard(
        {
            status: 'COMPLETED',
            minClosedTrades: 50,
        },
        {
            mode: 'BEST_PER_SIGNAL',
            sort: 'profitFactor',
            order: 'desc',
            page: 1,
            pageSize: TOP_N,
        },
    );

    if (leaderboard.rows.length === 0) {
        console.log('No completed backtests found in DB. Exiting.');
        await prisma.$disconnect();
        return;
    }

    // Fetch full run details for each top entry
    const topRunIds = leaderboard.rows.map((row) => row.runId);
    const topRuns = await prisma.backtestRun.findMany({
        where: { id: { in: topRunIds } },
        select: {
            id: true,
            name: true,
            signalCode: true,
            signalVersion: true,
            timeframe: true,
            parametersJson: true,
            executionConfigJson: true,
            initialEquity: true,
            riskPercent: true,
        },
    });
    const runMap = new Map(topRuns.map((run) => [run.id, run]));

    const top5: Top5Entry[] = leaderboard.rows.map((row) => {
        const run = runMap.get(row.runId);
        return {
            rank: row.rank,
            runId: row.runId,
            runName: row.runName,
            signalCode: row.signalCode,
            timeframe: row.timeframe,
            closedTrades: row.closedTrades,
            winRate: row.winRate,
            profitFactor: row.profitFactor,
            netR: row.netR,
            netUsd: row.netUsd,
            maxDrawdownPct: row.maxDrawdownPct,
            parametersJson: (run?.parametersJson as Record<string, unknown>) ?? {},
        };
    });

    console.log('Top 5 Backtests (by Profit Factor, best per signal):');
    console.table(top5.map((entry) => ({
        '#': entry.rank,
        Signal: entry.signalCode?.slice(0, 40) ?? '?',
        TF: entry.timeframe,
        Trades: entry.closedTrades,
        'WR%': entry.winRate,
        PF: entry.profitFactor,
        NetR: entry.netR,
        'NetPnL$': entry.netUsd,
        'MaxDD%': entry.maxDrawdownPct,
    })));

    // ─── Step 2: For each top entry, re-run with guard profiles ─────────────

    console.log(`\nStep 2: Running ${GUARD_PROFILES.length} guard profiles × ${top5.length} signals = ${GUARD_PROFILES.length * top5.length} backtests...\n`);

    const seeds = getTier1ComposedSignalSeeds();
    const blockRegistry = createDefaultBlockRegistry();
    const registry = SignalRegistry.getInstance();
    const runner = new SignalBacktestRunner(
        new CandleQueryService(prisma),
        new IndicatorSeriesService(),
        new ExecutionModelService(),
        registry,
    );

    const allResults: RunResult[] = [];
    let runCounter = 0;
    const totalRuns = top5.length * GUARD_PROFILES.length;

    for (const entry of top5) {
        // Resolve base signal code: strip XAB_ prefixes to find the base tier-1 seed
        let baseCode = entry.signalCode ?? '';
        const baseSeed = seeds.find((s) => s.code === baseCode)
            ?? seeds.find((s) => baseCode.includes(s.code.replace('SYS_', '')))
            ?? seeds.find((s) => s.code === 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG');

        if (!baseSeed) {
            console.log(`  ⚠ Cannot resolve base seed for ${entry.signalCode}, skipping.`);
            continue;
        }

        const signalLabel = `${entry.signalCode?.slice(0, 30) ?? '?'} (${entry.timeframe})`;

        for (const guardProfile of GUARD_PROFILES) {
            runCounter += 1;
            console.log(`[${runCounter}/${totalRuns}] ${signalLabel} × ${guardProfile.id}`);

            const definition = jsonClone(baseSeed.composedBlocks) as ComposedSignalDefinition;
            applyParams(definition, entry.parametersJson, entry.timeframe);

            // Resolve exit profile from stored params or default
            const exitProfile = (entry.parametersJson.exitProfile as string)
                ?? (entry.parametersJson.profileCode as string)
                ?? 'HARD_SIGNAL_TP';
            definition.exitManagement = { profileCode: exitProfile as any };

            const tmpCode = `OPT9_${entry.rank}_${guardProfile.id}`.toUpperCase().slice(0, 60);
            registry.register(new ComposedSignalPlugin(
                definition,
                blockRegistry,
                tmpCode,
                1,
                `OPT-9: ${signalLabel} × ${guardProfile.id}`,
            ));

            try {
                const executionConfig: ExecutionConfigInput = {
                    ...BASE_EXECUTION_CONFIG,
                    tradeGuards: guardProfile.guards,
                    compoundEquity: guardProfile.compoundEquity,
                };

                const output = await runner.run({
                    signalCode: tmpCode,
                    signalVersion: 1,
                    symbol: SYMBOL,
                    timeframe: entry.timeframe,
                    from: FROM,
                    to: TO,
                    parameters: {},
                    initialEquity: INITIAL_EQUITY,
                    riskPercent: RISK_PERCENT,
                    executionConfig,
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

                allResults.push({
                    signalLabel,
                    guardProfile: guardProfile.id,
                    trades: summary.trades,
                    netPnl: summary.netPnl,
                    netR: summary.netR,
                    winRate: summary.winRate,
                    maxDd: summary.maxDd,
                    profitFactor: summary.profitFactor,
                    maxConsecutiveLosses: riskSummary.maxConsecutiveLosses,
                    ecfBlockCount: riskSummary.equityCurveFilterBlockCount,
                    ddHaltBlockCount: riskSummary.maxDrawdownHaltBlockCount,
                    spacingBlockCount: riskSummary.minTradeSpacingBlockCount,
                    blockedEntryCount: riskSummary.blockedEntryCount,
                });

                console.log(
                    `  => Trades=${summary.trades} | NetR=${summary.netR} | WR=${summary.winRate}% | PF=${summary.profitFactor} | MaxDD=${summary.maxDd}% | ConsecL=${riskSummary.maxConsecutiveLosses} | Blocked=${riskSummary.blockedEntryCount}`,
                );
            } catch (error: any) {
                console.error(`  => FAILED: ${error.message}`);
            } finally {
                registry.unregister(tmpCode, 1);
            }
        }
    }

    await prisma.$disconnect();

    // ─── Step 3: Print comparison ───────────────────────────────────────────

    console.log(`\n${'═'.repeat(80)}`);
    console.log('OPT-9 RESULTS: Guard Optimization Comparison');
    console.log(`${'═'.repeat(80)}\n`);

    // Group results by signal
    const signalLabels = [...new Set(allResults.map((r) => r.signalLabel))];
    for (const label of signalLabels) {
        console.log(`\n─── ${label} ───`);
        const rows = allResults.filter((r) => r.signalLabel === label);
        console.table(rows.map((r) => ({
            Guard: r.guardProfile,
            Trades: r.trades,
            NetR: r.netR,
            'PnL$': r.netPnl,
            'WR%': r.winRate,
            PF: r.profitFactor,
            'MaxDD%': r.maxDd,
            'MaxConsecL': r.maxConsecutiveLosses,
            'Blocked': r.blockedEntryCount,
            'ECF↓': r.ecfBlockCount,
            'DD↓': r.ddHaltBlockCount,
            'Spac↓': r.spacingBlockCount,
        })));

        // Compute improvement vs baseline
        const baseline = rows.find((r) => r.guardProfile === 'BASELINE');
        if (baseline) {
            console.log('  Improvement vs BASELINE:');
            for (const r of rows) {
                if (r.guardProfile === 'BASELINE') continue;
                const tradeReduction = baseline.trades > 0
                    ? round(((baseline.trades - r.trades) / baseline.trades) * 100)
                    : 0;
                const consecImprovement = baseline.maxConsecutiveLosses > 0
                    ? round(((baseline.maxConsecutiveLosses - r.maxConsecutiveLosses) / baseline.maxConsecutiveLosses) * 100)
                    : 0;
                const netRRetention = baseline.netR !== 0
                    ? round((r.netR / baseline.netR) * 100)
                    : 0;
                console.log(
                    `    ${r.guardProfile.padEnd(22)} | NetR retained: ${netRRetention}% | ConsecL: ${baseline.maxConsecutiveLosses}→${r.maxConsecutiveLosses} (${consecImprovement > 0 ? '-' : '+'}${Math.abs(consecImprovement)}%) | Trades: -${tradeReduction}%`,
                );
            }
        }
    }

    // ─── Step 4: Best guard profile recommendation ──────────────────────────

    console.log(`\n${'═'.repeat(80)}`);
    console.log('RECOMMENDATION: Best Guard Profile per Signal');
    console.log(`${'═'.repeat(80)}\n`);

    for (const label of signalLabels) {
        const rows = allResults.filter((r) => r.signalLabel === label && r.guardProfile !== 'BASELINE');
        if (rows.length === 0) continue;

        // Score: maximize (netR retention × consecutive loss reduction)
        const baseline = allResults.find((r) => r.signalLabel === label && r.guardProfile === 'BASELINE');
        if (!baseline) continue;

        const scored = rows.map((r) => {
            const netRRetention = baseline.netR !== 0 ? r.netR / baseline.netR : 0;
            const consecReduction = baseline.maxConsecutiveLosses > 0
                ? 1 - (r.maxConsecutiveLosses / baseline.maxConsecutiveLosses)
                : 0;
            // Composite score: keep as much profit as possible while reducing streaks
            const score = netRRetention * 0.6 + consecReduction * 0.4;
            return { ...r, score: round(score, 4), netRRetention: round(netRRetention * 100), consecReduction: round(consecReduction * 100) };
        }).sort((a, b) => b.score - a.score);

        const best = scored[0];
        console.log(`${label}:`);
        console.log(`  Winner: ${best.guardProfile} (score: ${best.score})`);
        console.log(`  NetR: ${baseline.netR} → ${best.netR} (${best.netRRetention}% retained)`);
        console.log(`  MaxConsecLosses: ${baseline.maxConsecutiveLosses} → ${best.maxConsecutiveLosses} (${best.consecReduction}% reduced)`);
        console.log(`  Trades: ${baseline.trades} → ${best.trades} | Blocked: ${best.blockedEntryCount}`);
        console.log();
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
