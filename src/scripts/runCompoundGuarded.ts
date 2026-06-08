import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { SignalBacktestExecutionService } from '../services/signals/SignalBacktestExecutionService';
import { SignalBacktestRunService } from '../services/signals/SignalBacktestRunService';
import { createDefaultBlockRegistry } from '../services/signals/blocks/createDefaultBlockRegistry';
import { ExecutionConfigInput, TradeGuardConfigInput } from '../services/signals/types';
import { upsertTier1ComposedSignals } from '../services/signals/tier1ComposedSignals';

dotenv.config();

// Light guards — designed to cap DD without killing trade count
const LIGHT_GUARD: TradeGuardConfigInput = {
    lossStreakCooldown: { afterLosses: 5, cooldownMinutes: 480 },
    dayLossCap: { maxLosses: 3, maxNetR: 3 },
    maxDrawdownHalt: { maxDrawdownPct: 20 },
    equityCurveFilter: { emaTrades: 30, action: 'HALF_RISK' },
};

const MEDIUM_GUARD: TradeGuardConfigInput = {
    lossStreakCooldown: { afterLosses: 4, cooldownMinutes: 360 },
    dayLossCap: { maxLosses: 3, maxNetR: 3 },
    maxDrawdownHalt: { maxDrawdownPct: 15 },
    equityCurveFilter: { emaTrades: 20, action: 'HALF_RISK' },
};

interface Candidate { signalCode: string; timeframe: string; label: string; }

const CANDIDATES: Candidate[] = [
    { signalCode: 'SYS_4TF_PD_LEVEL_BREAK_LONG', timeframe: '4h', label: 'PDLevel-4H' },
    { signalCode: 'SYS_4TF_BOS_FVG_LONG', timeframe: '2h', label: 'BOSFVG-2H' },
    { signalCode: 'SYS_T1_SESSION_BURST_LONG', timeframe: '1h', label: 'SessionBurst-1H' },
    { signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG', timeframe: '2h', label: 'AsianBreak-2H' },
];

const CONFIGS: Array<{ label: string; risk: number; guards: TradeGuardConfigInput }> = [
    { label: 'R3-LIGHT', risk: 3, guards: LIGHT_GUARD },
    { label: 'R3-MEDIUM', risk: 3, guards: MEDIUM_GUARD },
    { label: 'R4-LIGHT', risk: 4, guards: LIGHT_GUARD },
];

function buildExecConfig(guards: TradeGuardConfigInput): ExecutionConfigInput {
    return {
        entryFeeBps: 4, exitFeeBps: 4, entrySlippageBps: 2, exitSlippageBps: 2,
        orderTiming: 'NEXT_BAR_OPEN',
        stopLoss: { mode: 'SIGNAL_PRICE' }, takeProfit: { mode: 'SIGNAL_PRICE' },
        positionSizing: { mode: 'RISK_BASED' },
        compoundEquity: true,
        tradeGuards: guards,
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
    const filter = process.argv[2]; // optional: 'PDLevel-4H' to run single candidate
    const toRun = filter ? CANDIDATES.filter(c => c.label === filter) : CANDIDATES;
    const totalRuns = toRun.length * CONFIGS.length;
    console.log(`[CompoundGuarded] ${toRun.length} candidates x ${CONFIGS.length} configs = ${totalRuns} runs\n`);

    const prisma = new PrismaClient();
    const registry = createDefaultBlockRegistry();
    const backtests = new SignalBacktestRunService(prisma);
    const exec = new SignalBacktestExecutionService(prisma);

    try {
        await upsertTier1ComposedSignals(prisma, registry);

        type Row = { label: string; config: string; trades: number; netPnl: number; finalEquity: number; winRate: number; profitFactor: number | null; maxDd: number; };
        const results: Row[] = [];

        let idx = 0;
        for (const c of toRun) {
            for (const cfg of CONFIGS) {
                idx++;
                console.log(`[${idx}/${totalRuns}] ${c.label} | ${cfg.label} | compound=ON`);
                try {
                    const { backtestRunId } = await backtests.createGeneratedBacktest({
                        signalCode: c.signalCode, signalVersion: 1,
                        symbol: 'XAUUSD', timeframe: c.timeframe,
                        dateRange: { from: '2019-01-01T00:00:00.000Z', to: '2026-03-14T23:59:59.999Z' },
                        executionConfig: buildExecConfig(cfg.guards),
                        initialEquity: 10000, riskPercent: cfg.risk,
                        notes: `[compound-guarded] ${c.label} ${cfg.label}`,
                        parameters: { compoundGuarded: true, config: cfg.label, group: c.label },
                    });
                    await exec.executeRun(backtestRunId);
                    const rows = await prisma.backtestTradeResult.findMany({
                        where: { backtestRunId }, select: { pnlUsd: true, win: true, isOpen: true, exitTime: true },
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
                    results.push({ label: c.label, config: cfg.label, trades: closed.length, netPnl: Math.round(netPnl), finalEquity, winRate: wr, profitFactor: pf, maxDd });
                    console.log(`  => trades=${closed.length} | PF=${pf} | WR=${wr}% | FinalEq=$${finalEquity} | DD=${maxDd}%`);
                } catch (err: unknown) {
                    console.error(`  => FAILED: ${err instanceof Error ? err.message : String(err)}`);
                }
            }
        }

        console.log('\n[CompoundGuarded] LEADERBOARD\n');
        const sorted = [...results].filter(r => r.trades > 0).sort((a, b) => b.finalEquity - a.finalEquity);
        for (const r of sorted) {
            const ddFlag = r.maxDd < 30 ? 'DD-OK' : r.maxDd < 50 ? 'DD-MED' : 'DD-HIGH';
            console.log(`  ${r.label.padEnd(18)} | ${r.config.padEnd(12)} | PF=${String(r.profitFactor).padEnd(5)} | WR=${String(r.winRate).padEnd(6)}% | trades=${String(r.trades).padEnd(5)} | FinalEq=$${String(r.finalEquity).padEnd(14)} | DD=${r.maxDd}% [${ddFlag}]`);
        }
    } finally {
        await prisma.$disconnect();
    }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
