import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { SignalBacktestExecutionService } from '../services/signals/SignalBacktestExecutionService';
import { SignalBacktestRunService } from '../services/signals/SignalBacktestRunService';
import { createDefaultBlockRegistry } from '../services/signals/blocks/createDefaultBlockRegistry';
import { ExecutionConfigInput, TradeGuardConfigInput } from '../services/signals/types';
import { upsertTier1ComposedSignals } from '../services/signals/tier1ComposedSignals';

dotenv.config();

const GUARD_PROFILES: Record<string, TradeGuardConfigInput> = {
    TIGHT: {
        lossStreakCooldown: { afterLosses: 3, cooldownMinutes: 360 },
        dayLossCap: { maxLosses: 2, maxNetR: 2 },
        equityCurveFilter: { emaTrades: 15, action: 'BLOCK' },
        maxDrawdownHalt: { maxDrawdownPct: 8 },
        minTradeSpacing: { minSpacingMinutes: 240 },
        entryBurstCooldown: { maxEntriesInWindow: 2, windowMinutes: 480, cooldownMinutes: 720 },
    },
    MODERATE: {
        lossStreakCooldown: { afterLosses: 3, cooldownMinutes: 240 },
        dayLossCap: { maxLosses: 3, maxNetR: 3 },
        equityCurveFilter: { emaTrades: 20, action: 'HALF_RISK' },
        maxDrawdownHalt: { maxDrawdownPct: 10 },
        minTradeSpacing: { minSpacingMinutes: 120 },
        entryBurstCooldown: { maxEntriesInWindow: 3, windowMinutes: 480, cooldownMinutes: 480 },
    },
    LOOSE: {
        lossStreakCooldown: { afterLosses: 4, cooldownMinutes: 360 },
        dayLossCap: { maxLosses: 4, maxNetR: 4 },
        equityCurveFilter: { emaTrades: 25, action: 'HALF_RISK' },
        maxDrawdownHalt: { maxDrawdownPct: 12 },
        minTradeSpacing: { minSpacingMinutes: 60 },
    },
};

interface Candidate { signalCode: string; timeframe: string; label: string; }

const CANDIDATES: Record<string, Candidate[]> = {
    'top3-4h': [
        { signalCode: 'SYS_4TF_PD_LEVEL_BREAK_LONG', timeframe: '4h', label: 'PD-Level-Break-4H' },
    ],
    'top3-2h': [
        { signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG', timeframe: '2h', label: 'Asian-Break-2H' },
        { signalCode: 'SYS_4TF_BOS_FVG_LONG', timeframe: '2h', label: 'BOS-FVG-2H' },
    ],
    'top3-1h': [
        { signalCode: 'SYS_T1_SESSION_BURST_LONG', timeframe: '1h', label: 'Session-Burst-1H' },
        { signalCode: 'SYS_4TF_PD_LEVEL_BREAK_LONG', timeframe: '1h', label: 'PD-Level-Break-1H' },
        { signalCode: 'SYS_T1_OB_FIB_LONG', timeframe: '2h', label: 'OB-Fib-2H' },
    ],
};

function buildExecConfig(guards: TradeGuardConfigInput): ExecutionConfigInput {
    return {
        entryFeeBps: 4, exitFeeBps: 4, entrySlippageBps: 2, exitSlippageBps: 2,
        orderTiming: 'NEXT_BAR_OPEN',
        stopLoss: { mode: 'SIGNAL_PRICE' },
        takeProfit: { mode: 'SIGNAL_PRICE' },
        positionSizing: { mode: 'RISK_BASED' },
        tradeGuards: guards,
    };
}

function computeEquityDD(trades: Array<{ pnlUsd: number }>, initialEquity: number) {
    let equity = initialEquity;
    let peak = equity;
    let maxDd = 0;
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
    for (const t of trades) {
        if (!t.win) { cur++; if (cur > max) max = cur; } else { cur = 0; }
    }
    return max;
}

async function main() {
    const candidateGroup = process.argv[2] || 'top3-4h';
    const candidates = CANDIDATES[candidateGroup];
    if (!candidates) {
        console.error(`Unknown group: ${candidateGroup}. Available: ${Object.keys(CANDIDATES).join(', ')}`);
        process.exit(1);
    }

    const guardProfiles = Object.keys(GUARD_PROFILES);
    const totalRuns = candidates.length * guardProfiles.length;
    console.log(`[GuardOpt] group=${candidateGroup} | ${candidates.length} candidates x ${guardProfiles.length} profiles = ${totalRuns} runs`);

    const prisma = new PrismaClient();
    const registry = createDefaultBlockRegistry();
    const backtests = new SignalBacktestRunService(prisma);
    const execService = new SignalBacktestExecutionService(prisma);

    try {
        await upsertTier1ComposedSignals(prisma, registry);

        type Row = { candidate: string; profile: string; runId: string; trades: number; netPnl: number; winRate: number; profitFactor: number | null; equityDD: number; maxConsecLosses: number; blockedEntries: number; };
        const results: Row[] = [];

        let idx = 0;
        for (const c of candidates) {
            for (const pName of guardProfiles) {
                idx++;
                console.log(`[${idx}/${totalRuns}] ${c.signalCode} ${c.timeframe} | guard=${pName}`);
                try {
                    const { backtestRunId } = await backtests.createGeneratedBacktest({
                        signalCode: c.signalCode, signalVersion: 1,
                        symbol: 'XAUUSD', timeframe: c.timeframe,
                        dateRange: { from: '2019-01-01T00:00:00.000Z', to: '2026-03-14T23:59:59.999Z' },
                        executionConfig: buildExecConfig(GUARD_PROFILES[pName]),
                        initialEquity: 10000, riskPercent: 1.5,
                        notes: `[guard-opt] ${c.label} ${pName}`,
                        parameters: { guardProfile: pName, group: candidateGroup },
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

                    // Count blocked entries from signal events
                    const blocked = await prisma.signalEvent.count({
                        where: { signal: { backtestRunId }, label: { in: ['GUARD_BLOCK', 'ENTRY_BLOCKED'] } },
                    });

                    results.push({ candidate: c.label, profile: pName, runId: backtestRunId, trades: closed.length, netPnl: Math.round(netPnl * 100) / 100, winRate: wr, profitFactor: pf, equityDD: eqDD, maxConsecLosses: streak, blockedEntries: blocked });
                    console.log(`  => trades=${closed.length} | PF=${pf} | WR=${wr}% | eqDD=${eqDD.toFixed(2)}% | streak=${streak} | blocked=${blocked}`);
                } catch (err: unknown) {
                    console.error(`  => FAILED: ${err instanceof Error ? err.message : String(err)}`);
                }
            }
        }

        console.log('\n[GuardOpt] LEADERBOARD\n');
        const sorted = [...results].filter(r => r.trades > 0).sort((a, b) => {
            const ap = a.equityDD < 15 ? 1 : 0, bp = b.equityDD < 15 ? 1 : 0;
            if (ap !== bp) return bp - ap;
            return (b.profitFactor ?? 0) - (a.profitFactor ?? 0);
        });
        for (const r of sorted) {
            const f = r.equityDD < 15 ? 'DD-PASS' : 'DD-FAIL';
            console.log(`  ${r.candidate.padEnd(22)} | ${r.profile.padEnd(10)} | PF=${String(r.profitFactor).padEnd(5)} | WR=${String(r.winRate).padEnd(6)}% | trades=${String(r.trades).padEnd(4)} | PnL=$${String(r.netPnl).padEnd(10)} | eqDD=${r.equityDD.toFixed(2).padEnd(6)}% [${f}] | streak=${r.maxConsecLosses}`);
        }
    } finally {
        await prisma.$disconnect();
    }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
