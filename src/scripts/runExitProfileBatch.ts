import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { SignalBacktestExecutionService } from '../services/signals/SignalBacktestExecutionService';
import { SignalBacktestRunService } from '../services/signals/SignalBacktestRunService';
import { createDefaultBlockRegistry } from '../services/signals/blocks/createDefaultBlockRegistry';
import { upsertTier1ComposedSignals } from '../services/signals/tier1ComposedSignals';
import { ExecutionConfigInput } from '../services/signals/types';

dotenv.config();

const BASE_EXEC: ExecutionConfigInput = {
    entryFeeBps: 4, exitFeeBps: 4, entrySlippageBps: 2, exitSlippageBps: 2,
    orderTiming: 'NEXT_BAR_OPEN',
    stopLoss: { mode: 'SIGNAL_PRICE' },
    takeProfit: { mode: 'SIGNAL_PRICE' },
    positionSizing: { mode: 'RISK_BASED' },
};

const STRATEGIES = [
    { code: 'SYS_4TF_PD_LEVEL_BREAK_LONG', version: 2, tf: '4h', label: 'PD-Level-v2-4H' },
    { code: 'SYS_4TF_PD_LEVEL_BREAK_LONG_H4', version: 1, tf: '4h', label: 'PD-Level-H4opt' },
    { code: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG', version: 1, tf: '2h', label: 'Asian-Break-2H' },
];

function computeMetrics(rows: Array<{ pnlUsd: any; win: boolean; isOpen: boolean; rMultiple: any }>) {
    const closed = rows.filter(r => !r.isOpen);
    if (closed.length === 0) return { trades: 0, wr: 0, pf: null, pnl: 0, dd: 0, avgR: 0, streak: 0 };
    const wins = closed.filter(r => r.win).length;
    const pnl = closed.reduce((s, r) => s + Number(r.pnlUsd), 0);
    const grossW = closed.filter(r => r.win).reduce((s, r) => s + Number(r.pnlUsd), 0);
    const grossL = Math.abs(closed.filter(r => !r.win).reduce((s, r) => s + Number(r.pnlUsd), 0));
    const pf = grossL > 0 ? Math.round((grossW / grossL) * 100) / 100 : (grossW > 0 ? 999 : null);
    const avgR = closed.reduce((s, r) => s + Number(r.rMultiple || 0), 0) / closed.length;
    let equity = 10000, peak = 10000, maxDd = 0;
    for (const t of closed) { equity += Number(t.pnlUsd); if (equity > peak) peak = equity; const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0; if (dd > maxDd) maxDd = dd; }
    let streak = 0, maxStreak = 0;
    for (const t of closed) { if (!t.win) { streak++; if (streak > maxStreak) maxStreak = streak; } else streak = 0; }
    return { trades: closed.length, wr: Math.round((wins / closed.length) * 1000) / 10, pf, pnl: Math.round(pnl), dd: Math.round(maxDd * 10) / 10, avgR: Math.round(avgR * 100) / 100, streak: maxStreak };
}

async function main() {
    const profiles = process.argv.slice(2);
    if (profiles.length === 0) { console.error('Usage: npx ts-node src/scripts/runExitProfileBatch.ts PROFILE1 PROFILE2 ...'); process.exit(1); }

    const prisma = new PrismaClient();
    const registry = createDefaultBlockRegistry();
    const backtests = new SignalBacktestRunService(prisma);
    const exec = new SignalBacktestExecutionService(prisma);

    try {
        await upsertTier1ComposedSignals(prisma, registry);
        const results: any[] = [];

        for (const profile of profiles) {
            for (const strat of STRATEGIES) {
                console.log(`Running ${strat.label} × ${profile}...`);
                const { backtestRunId } = await backtests.createGeneratedBacktest({
                    signalCode: strat.code, signalVersion: strat.version,
                    symbol: 'XAUUSD', timeframe: strat.tf,
                    dateRange: { from: '2019-01-01T00:00:00.000Z', to: '2026-03-14T23:59:59.999Z' },
                    executionConfig: BASE_EXEC, initialEquity: 10000, riskPercent: 1.5,
                    notes: `[exit-profile] ${strat.label} — ${profile}`,
                    parameters: { exitStrategy: profile },
                });
                await exec.executeRun(backtestRunId);
                const rows = await prisma.backtestTradeResult.findMany({
                    where: { backtestRunId }, select: { pnlUsd: true, win: true, isOpen: true, rMultiple: true },
                    orderBy: { exitTime: 'asc' },
                });
                const m = computeMetrics(rows);
                results.push({ strategy: strat.label, profile, ...m });
                console.log(`  ${strat.label} × ${profile}: trades=${m.trades} WR=${m.wr}% PF=${m.pf} PnL=$${m.pnl} DD=${m.dd}% avgR=${m.avgR} streak=${m.streak}`);
            }
        }

        console.log('\n═══ RESULTS ═══');
        console.log('Strategy'.padEnd(20) + 'Profile'.padEnd(28) + 'Trades'.padStart(7) + 'WR%'.padStart(7) + 'PF'.padStart(7) + 'PnL'.padStart(10) + 'DD%'.padStart(7) + 'avgR'.padStart(7) + 'Streak'.padStart(7));
        console.log('─'.repeat(100));
        for (const r of results) {
            console.log(r.strategy.padEnd(20) + r.profile.padEnd(28) + String(r.trades).padStart(7) + String(r.wr).padStart(7) + String(r.pf ?? 'N/A').padStart(7) + ('$' + r.pnl).padStart(10) + String(r.dd).padStart(7) + String(r.avgR).padStart(7) + String(r.streak).padStart(7));
        }
    } finally {
        await prisma.$disconnect();
    }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
