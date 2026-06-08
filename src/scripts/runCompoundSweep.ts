import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { SignalBacktestExecutionService } from '../services/signals/SignalBacktestExecutionService';
import { SignalBacktestRunService } from '../services/signals/SignalBacktestRunService';
import { createDefaultBlockRegistry } from '../services/signals/blocks/createDefaultBlockRegistry';
import { ExecutionConfigInput } from '../services/signals/types';
import { upsertTier1ComposedSignals } from '../services/signals/tier1ComposedSignals';

dotenv.config();

interface Candidate { signalCode: string; timeframe: string; label: string; }

const GROUPS: Record<string, Candidate[]> = {
    'session-burst': [
        { signalCode: 'SYS_T1_SESSION_BURST_LONG', timeframe: '1h', label: 'SessionBurst-1H' },
    ],
    'pd-level': [
        { signalCode: 'SYS_4TF_PD_LEVEL_BREAK_LONG', timeframe: '4h', label: 'PDLevel-4H' },
        { signalCode: 'SYS_4TF_PD_LEVEL_BREAK_LONG', timeframe: '1h', label: 'PDLevel-1H' },
    ],
    'bos-fvg': [
        { signalCode: 'SYS_4TF_BOS_FVG_LONG', timeframe: '2h', label: 'BOSFVG-2H' },
    ],
    'asian-break': [
        { signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG', timeframe: '2h', label: 'AsianBreak-2H' },
    ],
    'ob-fib': [
        { signalCode: 'SYS_T1_OB_FIB_LONG', timeframe: '1h', label: 'OBFib-1H' },
        { signalCode: 'SYS_T1_OB_FIB_LONG', timeframe: '4h', label: 'OBFib-4H' },
    ],
};

const RISK_LEVELS = [3, 4, 5];

function buildExecConfig(compound: boolean): ExecutionConfigInput {
    return {
        entryFeeBps: 4, exitFeeBps: 4, entrySlippageBps: 2, exitSlippageBps: 2,
        orderTiming: 'NEXT_BAR_OPEN',
        stopLoss: { mode: 'SIGNAL_PRICE' },
        takeProfit: { mode: 'SIGNAL_PRICE' },
        positionSizing: { mode: 'RISK_BASED' },
        compoundEquity: compound,
    };
}

function computeEquityDD(trades: Array<{ pnlUsd: number }>, initialEquity: number) {
    let equity = initialEquity, peak = equity, maxDd = 0;
    for (const t of trades) {
        equity += t.pnlUsd;
        if (equity > peak) peak = equity;
        const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
        if (dd > maxDd) maxDd = dd;
    }
    return { maxDd: Math.round(maxDd * 100) / 100, finalEquity: Math.round(equity * 100) / 100 };
}

async function main() {
    const group = process.argv[2] || 'session-burst';
    const candidates = GROUPS[group];
    if (!candidates) {
        console.error(`Unknown group: ${group}. Available: ${Object.keys(GROUPS).join(', ')}`);
        process.exit(1);
    }

    const totalRuns = candidates.length * RISK_LEVELS.length;
    console.log(`[CompoundSweep] group=${group} | ${candidates.length} candidates x ${RISK_LEVELS.length} risk levels = ${totalRuns} runs (all COMPOUND ON)\n`);

    const prisma = new PrismaClient();
    const registry = createDefaultBlockRegistry();
    const backtests = new SignalBacktestRunService(prisma);
    const exec = new SignalBacktestExecutionService(prisma);

    try {
        await upsertTier1ComposedSignals(prisma, registry);

        type Row = { label: string; risk: number; trades: number; netPnl: number; finalEquity: number; winRate: number; profitFactor: number | null; maxDd: number; };
        const results: Row[] = [];

        let idx = 0;
        for (const c of candidates) {
            for (const risk of RISK_LEVELS) {
                idx++;
                console.log(`[${idx}/${totalRuns}] ${c.label} | risk=${risk}% | compound=ON`);
                try {
                    const { backtestRunId } = await backtests.createGeneratedBacktest({
                        signalCode: c.signalCode, signalVersion: 1,
                        symbol: 'XAUUSD', timeframe: c.timeframe,
                        dateRange: { from: '2019-01-01T00:00:00.000Z', to: '2026-03-14T23:59:59.999Z' },
                        executionConfig: buildExecConfig(true),
                        initialEquity: 10000, riskPercent: risk,
                        notes: `[compound-sweep] ${c.label} risk=${risk}%`,
                        parameters: { compoundSweep: true, riskPercent: risk, group },
                    });

                    await exec.executeRun(backtestRunId);

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
                    const { maxDd, finalEquity } = computeEquityDD(closed.map(r => ({ pnlUsd: Number(r.pnlUsd) })), 10000);

                    results.push({ label: c.label, risk, trades: closed.length, netPnl: Math.round(netPnl), finalEquity, winRate: wr, profitFactor: pf, maxDd });
                    console.log(`  => trades=${closed.length} | PF=${pf} | WR=${wr}% | PnL=$${Math.round(netPnl)} | finalEq=$${finalEquity} | DD=${maxDd}%`);
                } catch (err: unknown) {
                    console.error(`  => FAILED: ${err instanceof Error ? err.message : String(err)}`);
                }
            }
        }

        console.log('\n[CompoundSweep] LEADERBOARD (sorted by Final Equity)\n');
        const sorted = [...results].filter(r => r.trades > 0).sort((a, b) => b.finalEquity - a.finalEquity);
        for (const r of sorted) {
            const ddFlag = r.maxDd < 30 ? 'OK' : 'HIGH';
            console.log(`  ${r.label.padEnd(18)} | risk=${r.risk}% | PF=${String(r.profitFactor).padEnd(5)} | WR=${String(r.winRate).padEnd(6)}% | trades=${String(r.trades).padEnd(5)} | PnL=$${String(r.netPnl).padEnd(10)} | FinalEq=$${String(r.finalEquity).padEnd(12)} | DD=${r.maxDd}% [${ddFlag}]`);
        }
    } finally {
        await prisma.$disconnect();
    }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
