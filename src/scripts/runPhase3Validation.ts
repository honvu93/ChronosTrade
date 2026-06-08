import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { SignalBacktestExecutionService } from '../services/signals/SignalBacktestExecutionService';
import { SignalBacktestRunService } from '../services/signals/SignalBacktestRunService';
import { createDefaultBlockRegistry } from '../services/signals/blocks/createDefaultBlockRegistry';
import { ExecutionConfigInput, TradeGuardConfigInput } from '../services/signals/types';
import { upsertTier1ComposedSignals } from '../services/signals/tier1ComposedSignals';

dotenv.config();

const TIGHT_GUARDS: TradeGuardConfigInput = {
    lossStreakCooldown: { afterLosses: 3, cooldownMinutes: 360 },
    dayLossCap: { maxLosses: 2, maxNetR: 2 },
    equityCurveFilter: { emaTrades: 15, action: 'BLOCK' },
    maxDrawdownHalt: { maxDrawdownPct: 8 },
    minTradeSpacing: { minSpacingMinutes: 240 },
    entryBurstCooldown: { maxEntriesInWindow: 2, windowMinutes: 480, cooldownMinutes: 720 },
};

const LOOSE_GUARDS: TradeGuardConfigInput = {
    lossStreakCooldown: { afterLosses: 4, cooldownMinutes: 360 },
    dayLossCap: { maxLosses: 4, maxNetR: 4 },
    equityCurveFilter: { emaTrades: 25, action: 'HALF_RISK' },
    maxDrawdownHalt: { maxDrawdownPct: 12 },
    minTradeSpacing: { minSpacingMinutes: 60 },
};

const NO_GUARDS: ExecutionConfigInput = {
    entryFeeBps: 4, exitFeeBps: 4, entrySlippageBps: 2, exitSlippageBps: 2,
    orderTiming: 'NEXT_BAR_OPEN',
    stopLoss: { mode: 'SIGNAL_PRICE' },
    takeProfit: { mode: 'SIGNAL_PRICE' },
    positionSizing: { mode: 'RISK_BASED' },
};

function withGuards(guards: TradeGuardConfigInput): ExecutionConfigInput {
    return { ...NO_GUARDS, tradeGuards: guards };
}

function computeEquityDD(trades: Array<{ pnlUsd: number }>, initialEquity: number) {
    let equity = initialEquity, peak = equity, maxDd = 0;
    for (const t of trades) {
        equity += t.pnlUsd;
        if (equity > peak) peak = equity;
        const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
        if (dd > maxDd) maxDd = dd;
    }
    return Math.round(maxDd * 10000) / 10000;
}

function computeMaxConsecLosses(trades: Array<{ win: boolean }>) {
    let max = 0, cur = 0;
    for (const t of trades) { if (!t.win) { cur++; if (cur > max) max = cur; } else cur = 0; }
    return max;
}

interface RunSpec {
    signalCode: string;
    timeframe: string;
    label: string;
    execConfig: ExecutionConfigInput;
    from: string;
    to: string;
    tag: string;
}

async function executeAndMeasure(prisma: PrismaClient, backtests: SignalBacktestRunService, execService: SignalBacktestExecutionService, spec: RunSpec) {
    const { backtestRunId } = await backtests.createGeneratedBacktest({
        signalCode: spec.signalCode, signalVersion: 1,
        symbol: 'XAUUSD', timeframe: spec.timeframe,
        dateRange: { from: spec.from, to: spec.to },
        executionConfig: spec.execConfig,
        initialEquity: 10000, riskPercent: 1.5,
        notes: `[phase3] ${spec.tag} ${spec.label}`,
        parameters: { phase3: spec.tag },
    });

    await execService.executeRun(backtestRunId);

    const rows = await prisma.backtestTradeResult.findMany({
        where: { backtestRunId },
        select: { pnlUsd: true, win: true, isOpen: true, exitTime: true },
        orderBy: { exitTime: 'asc' },
    });

    const closed = rows.filter(r => !r.isOpen);
    const wins = closed.filter(r => r.win).length;
    const netPnl = closed.reduce((s, r) => s + Number(r.pnlUsd), 0);
    const grossW = closed.filter(r => r.win).reduce((s, r) => s + Number(r.pnlUsd), 0);
    const grossL = Math.abs(closed.filter(r => !r.win).reduce((s, r) => s + Number(r.pnlUsd), 0));
    const pf = grossL > 0 ? Math.round((grossW / grossL) * 100) / 100 : null;
    const wr = closed.length > 0 ? Math.round((wins / closed.length) * 10000) / 100 : 0;
    const eqDD = computeEquityDD(closed.map(r => ({ pnlUsd: Number(r.pnlUsd) })), 10000);
    const streak = computeMaxConsecLosses(closed.map(r => ({ win: r.win })));

    return { runId: backtestRunId, trades: closed.length, netPnl: Math.round(netPnl * 100) / 100, winRate: wr, profitFactor: pf, equityDD: eqDD, maxConsecLosses: streak };
}

// ─── MODES ───────────────────────────────────────────────────────────────────

type Mode = 'oos' | '2h-noguard' | 'correlation';

async function runOOS(prisma: PrismaClient, backtests: SignalBacktestRunService, exec: SignalBacktestExecutionService) {
    console.log('\n═══ OOS VALIDATION: fit 2019-2022, test 2023-2026 ═══\n');

    const candidates = [
        { signalCode: 'SYS_4TF_PD_LEVEL_BREAK_LONG', timeframe: '4h', label: 'PD-Level-4H', guards: LOOSE_GUARDS },
        { signalCode: 'SYS_T1_SESSION_BURST_LONG', timeframe: '1h', label: 'Session-Burst-1H', guards: TIGHT_GUARDS },
    ];

    for (const c of candidates) {
        console.log(`── ${c.label} ──`);

        const fit = await executeAndMeasure(prisma, backtests, exec, {
            ...c, execConfig: withGuards(c.guards),
            from: '2019-01-01T00:00:00.000Z', to: '2022-12-31T23:59:59.999Z',
            tag: 'oos-fit',
        });
        console.log(`  FIT  (2019-2022): trades=${fit.trades} | PF=${fit.profitFactor} | WR=${fit.winRate}% | PnL=$${fit.netPnl} | DD=${fit.equityDD.toFixed(2)}%`);

        const test = await executeAndMeasure(prisma, backtests, exec, {
            ...c, execConfig: withGuards(c.guards),
            from: '2023-01-01T00:00:00.000Z', to: '2026-03-14T23:59:59.999Z',
            tag: 'oos-test',
        });
        console.log(`  TEST (2023-2026): trades=${test.trades} | PF=${test.profitFactor} | WR=${test.winRate}% | PnL=$${test.netPnl} | DD=${test.equityDD.toFixed(2)}%`);

        const wrDelta = fit.winRate - test.winRate;
        const pnlPositive = test.netPnl > 0;
        const ddOk = test.equityDD <= fit.equityDD * 1.2; // allow 20% more DD
        const pass = wrDelta <= 10 && pnlPositive && ddOk;
        console.log(`  OOS: WR delta=${wrDelta.toFixed(2)}pp | PnL positive=${pnlPositive} | DD ok=${ddOk} | PASS=${pass ? 'YES' : 'NO'}\n`);
    }
}

async function run2hNoGuard(prisma: PrismaClient, backtests: SignalBacktestRunService, exec: SignalBacktestExecutionService) {
    console.log('\n═══ 2H STRATEGIES WITHOUT GUARDS ═══\n');

    const candidates = [
        { signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG', timeframe: '2h', label: 'Asian-Break-2H' },
        { signalCode: 'SYS_4TF_BOS_FVG_LONG', timeframe: '2h', label: 'BOS-FVG-2H' },
    ];

    for (const c of candidates) {
        const r = await executeAndMeasure(prisma, backtests, exec, {
            ...c, execConfig: NO_GUARDS,
            from: '2019-01-01T00:00:00.000Z', to: '2026-03-14T23:59:59.999Z',
            tag: '2h-noguard',
        });
        const ddFlag = r.equityDD < 20 ? 'ACCEPTABLE' : 'TOO HIGH';
        console.log(`  ${c.label}: trades=${r.trades} | PF=${r.profitFactor} | WR=${r.winRate}% | PnL=$${r.netPnl} | DD=${r.equityDD.toFixed(2)}% [${ddFlag}] | streak=${r.maxConsecLosses}`);
    }
}

async function runCorrelation(prisma: PrismaClient, backtests: SignalBacktestRunService, exec: SignalBacktestExecutionService) {
    console.log('\n═══ CORRELATION: PD Level 4H vs Session Burst 1H ═══\n');

    // Run both with their optimal guards on full period
    const pdResult = await executeAndMeasure(prisma, backtests, exec, {
        signalCode: 'SYS_4TF_PD_LEVEL_BREAK_LONG', timeframe: '4h', label: 'PD-Level-4H',
        execConfig: withGuards(LOOSE_GUARDS),
        from: '2019-01-01T00:00:00.000Z', to: '2026-03-14T23:59:59.999Z',
        tag: 'corr-pd4h',
    });

    const sbResult = await executeAndMeasure(prisma, backtests, exec, {
        signalCode: 'SYS_T1_SESSION_BURST_LONG', timeframe: '1h', label: 'Session-Burst-1H',
        execConfig: withGuards(TIGHT_GUARDS),
        from: '2019-01-01T00:00:00.000Z', to: '2026-03-14T23:59:59.999Z',
        tag: 'corr-sb1h',
    });

    // Load daily PnL for both runs and compute Pearson correlation
    const loadDailyPnl = async (runId: string) => {
        const trades = await prisma.backtestTradeResult.findMany({
            where: { backtestRunId: runId, isOpen: false },
            select: { pnlUsd: true, exitTime: true },
            orderBy: { exitTime: 'asc' },
        });
        const daily = new Map<string, number>();
        for (const t of trades) {
            if (!t.exitTime) continue;
            const day = t.exitTime.toISOString().slice(0, 10);
            daily.set(day, (daily.get(day) ?? 0) + Number(t.pnlUsd));
        }
        return daily;
    };

    const pdDaily = await loadDailyPnl(pdResult.runId);
    const sbDaily = await loadDailyPnl(sbResult.runId);

    // Merge days
    const allDays = new Set([...pdDaily.keys(), ...sbDaily.keys()]);
    const pdArr: number[] = [];
    const sbArr: number[] = [];
    for (const day of [...allDays].sort()) {
        pdArr.push(pdDaily.get(day) ?? 0);
        sbArr.push(sbDaily.get(day) ?? 0);
    }

    // Pearson correlation
    const n = pdArr.length;
    const meanA = pdArr.reduce((s, v) => s + v, 0) / n;
    const meanB = sbArr.reduce((s, v) => s + v, 0) / n;
    let cov = 0, varA = 0, varB = 0;
    for (let i = 0; i < n; i++) {
        const dA = pdArr[i] - meanA, dB = sbArr[i] - meanB;
        cov += dA * dB; varA += dA * dA; varB += dB * dB;
    }
    const r = (varA > 0 && varB > 0) ? cov / Math.sqrt(varA * varB) : 0;
    const rRound = Math.round(r * 10000) / 10000;

    console.log(`  PD Level 4H:     trades=${pdResult.trades} | PnL=$${pdResult.netPnl} | DD=${pdResult.equityDD.toFixed(2)}%`);
    console.log(`  Session Burst 1H: trades=${sbResult.trades} | PnL=$${sbResult.netPnl} | DD=${sbResult.equityDD.toFixed(2)}%`);
    console.log(`  Daily PnL days:   ${n}`);
    console.log(`  Pearson r:        ${rRound}`);
    console.log(`  Correlation:      ${Math.abs(rRound) < 0.40 ? 'LOW — OK to combine' : 'HIGH — risky to combine'}`);

    // Combined portfolio DD
    let equity = 10000, peak = equity, maxDd = 0;
    for (const day of [...allDays].sort()) {
        const combined = (pdDaily.get(day) ?? 0) + (sbDaily.get(day) ?? 0);
        equity += combined;
        if (equity > peak) peak = equity;
        const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
        if (dd > maxDd) maxDd = dd;
    }
    const combinedPnl = Math.round((pdResult.netPnl + sbResult.netPnl) * 100) / 100;
    console.log(`\n  COMBINED PORTFOLIO:`);
    console.log(`    Total PnL:    $${combinedPnl}`);
    console.log(`    Combined DD:  ${maxDd.toFixed(2)}%`);
    console.log(`    DD < 15%:     ${maxDd < 15 ? 'PASS' : 'FAIL'}`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
    const mode = (process.argv[2] || 'oos') as Mode;
    const prisma = new PrismaClient();
    const registry = createDefaultBlockRegistry();
    const backtests = new SignalBacktestRunService(prisma);
    const exec = new SignalBacktestExecutionService(prisma);

    try {
        await upsertTier1ComposedSignals(prisma, registry);

        if (mode === 'oos') await runOOS(prisma, backtests, exec);
        else if (mode === '2h-noguard') await run2hNoGuard(prisma, backtests, exec);
        else if (mode === 'correlation') await runCorrelation(prisma, backtests, exec);
        else { console.error(`Unknown mode: ${mode}. Use: oos | 2h-noguard | correlation`); process.exit(1); }
    } finally {
        await prisma.$disconnect();
    }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
