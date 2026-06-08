import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { SignalBacktestExecutionService } from '../services/signals/SignalBacktestExecutionService';
import { SignalBacktestRunService } from '../services/signals/SignalBacktestRunService';
import { createDefaultBlockRegistry } from '../services/signals/blocks/createDefaultBlockRegistry';
import { ExecutionConfigInput, TradeGuardConfigInput } from '../services/signals/types';
import { upsertTier1ComposedSignals } from '../services/signals/tier1ComposedSignals';

dotenv.config();

/**
 * Re-run all GO-LIVE winner backtests with:
 *   - compoundEquity: true
 *   - maxQuantity: 100 (= 1 lot XAU = 100 oz)
 *
 * This gives a realistic equity curve capped at 1 lot max position,
 * preventing unrealistic exponential growth.
 *
 * Usage:
 *   npx ts-node src/scripts/runCompoundCapped1Lot.ts
 */

const BATCH_TAG = 'compound-1lot-cap';
const SYMBOL = 'XAUUSD';
const FROM = '2019-01-01T00:00:00.000Z';
const TO = '2026-03-26T23:59:59.999Z';
const INITIAL_EQUITY = 10_000;
const MAX_QUANTITY = 100; // 1 lot XAU = 100 oz

// ─── Guard profiles ──────────────────────────────────────────────────────────

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
    maxDrawdownHalt: { maxDrawdownPct: 20 },
};

// ─── Candidates: all GO-LIVE strategies ──────────────────────────────────────

interface Candidate {
    signalCode: string;
    signalVersion: number;
    timeframe: string;
    label: string;
    riskPercent: number;
}

const CANDIDATES: Candidate[] = [
    { signalCode: 'SYS_4TF_PD_LEVEL_BREAK_LONG', signalVersion: 2, timeframe: '4h', label: 'PDLevel-4H-v2', riskPercent: 2 },
    { signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG', signalVersion: 1, timeframe: '2h', label: 'AsianBreak-2H-v1', riskPercent: 2 },
    { signalCode: 'SYS_4TF_PD_LEVEL_BREAK_LONG_H4', signalVersion: 1, timeframe: '4h', label: 'PDLevel-H4-Opt-v1', riskPercent: 2 },
];

function buildExecConfig(riskPct: number): ExecutionConfigInput {
    return {
        entryFeeBps: 4,
        exitFeeBps: 4,
        entrySlippageBps: 2,
        exitSlippageBps: 2,
        orderTiming: 'NEXT_BAR_OPEN',
        stopLoss: { mode: 'SIGNAL_PRICE' },
        takeProfit: { mode: 'SIGNAL_PRICE' },
        positionSizing: { mode: 'RISK_BASED', maxQuantity: MAX_QUANTITY },
        compoundEquity: true,
        tradeGuards: MODERATE_GUARDS,
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
    const filter = process.argv[2];
    const toRun = filter ? CANDIDATES.filter((c) => c.label === filter) : CANDIDATES;
    console.log(`\n[Compound 1-Lot Cap] ${toRun.length} GO-LIVE candidates | compound=ON | maxQty=${MAX_QUANTITY} (1 lot)\n`);

    const prisma = new PrismaClient();
    const registry = createDefaultBlockRegistry();
    const backtests = new SignalBacktestRunService(prisma);
    const exec = new SignalBacktestExecutionService(prisma);

    try {
        await upsertTier1ComposedSignals(prisma, registry);

        type Row = {
            label: string;
            trades: number;
            netR: number;
            netPnl: number;
            finalEquity: number;
            winRate: number;
            profitFactor: number | null;
            maxDd: number;
        };
        const results: Row[] = [];

        for (let i = 0; i < toRun.length; i++) {
            const c = toRun[i];
            console.log(`[${i + 1}/${toRun.length}] ${c.label} | risk=${c.riskPercent}% | compound=ON | maxQty=${MAX_QUANTITY}`);

            try {
                const { backtestRunId } = await backtests.createGeneratedBacktest({
                    signalCode: c.signalCode,
                    signalVersion: c.signalVersion,
                    symbol: SYMBOL,
                    timeframe: c.timeframe,
                    dateRange: { from: FROM, to: TO },
                    executionConfig: buildExecConfig(c.riskPercent),
                    initialEquity: INITIAL_EQUITY,
                    riskPercent: c.riskPercent,
                    notes: `[${BATCH_TAG}] ${c.label} | compound + 1-lot cap (${MAX_QUANTITY} oz) | risk ${c.riskPercent}% | guards=MODERATE`,
                    parameters: { compoundCapped: true, maxQuantity: MAX_QUANTITY, group: c.label },
                });

                await exec.executeRun(backtestRunId);

                const rows = await prisma.backtestTradeResult.findMany({
                    where: { backtestRunId },
                    select: { pnlUsd: true, rMultiple: true, win: true, isOpen: true },
                    orderBy: { exitTime: 'asc' },
                });

                const closed = rows.filter((r) => !r.isOpen);
                const wins = closed.filter((r) => r.win).length;
                const netPnl = closed.reduce((s, r) => s + Number(r.pnlUsd), 0);
                const netR = closed.reduce((s, r) => s + Number(r.rMultiple), 0);
                const grossW = closed.filter((r) => r.win).reduce((s, r) => s + Number(r.pnlUsd), 0);
                const grossL = Math.abs(closed.filter((r) => !r.win).reduce((s, r) => s + Number(r.pnlUsd), 0));
                const pf = grossL > 0 ? Math.round((grossW / grossL) * 100) / 100 : null;
                const wr = closed.length > 0 ? Math.round((wins / closed.length) * 10000) / 100 : 0;
                const { maxDd, finalEquity } = computeEquityDD(
                    closed.map((r) => ({ pnlUsd: Number(r.pnlUsd) })),
                    INITIAL_EQUITY,
                );

                results.push({ label: c.label, trades: closed.length, netR: Math.round(netR * 100) / 100, netPnl: Math.round(netPnl), finalEquity, winRate: wr, profitFactor: pf, maxDd });
                console.log(`  => trades=${closed.length} | netR=${netR.toFixed(1)}R | PF=${pf} | WR=${wr}% | Final=$${finalEquity.toLocaleString()} | DD=${maxDd}%\n`);
            } catch (err: unknown) {
                console.error(`  => FAILED: ${err instanceof Error ? err.message : String(err)}\n`);
            }
        }

        // Leaderboard
        console.log('\n═══════════════════════════════════════════════════════════════════');
        console.log(' COMPOUND + 1-LOT CAP LEADERBOARD');
        console.log('═══════════════════════════════════════════════════════════════════\n');

        const sorted = [...results].filter((r) => r.trades > 0).sort((a, b) => b.finalEquity - a.finalEquity);
        for (const r of sorted) {
            const ddFlag = r.maxDd < 20 ? 'SAFE' : r.maxDd < 30 ? 'OK' : r.maxDd < 50 ? 'MED' : 'HIGH';
            console.log(
                `  ${r.label.padEnd(22)} | trades=${String(r.trades).padEnd(5)} | R=${String(r.netR).padEnd(8)} | PF=${String(r.profitFactor).padEnd(5)} | WR=${String(r.winRate).padEnd(6)}% | Final=$${String(r.finalEquity).padEnd(14)} | DD=${r.maxDd}% [${ddFlag}]`,
            );
        }

        console.log('\n[Done]');
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
