import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { SignalBacktestExecutionService } from '../services/signals/SignalBacktestExecutionService';
import { SignalBacktestRunService } from '../services/signals/SignalBacktestRunService';
import { createDefaultBlockRegistry } from '../services/signals/blocks/createDefaultBlockRegistry';
import { ExecutionConfigInput } from '../services/signals/types';
import { upsertTier1ComposedSignals } from '../services/signals/tier1ComposedSignals';

dotenv.config();

const EXEC_CONFIG: ExecutionConfigInput = {
    entryFeeBps: 4, exitFeeBps: 4, entrySlippageBps: 2, exitSlippageBps: 2,
    orderTiming: 'NEXT_BAR_OPEN',
    stopLoss: { mode: 'SIGNAL_PRICE' },
    takeProfit: { mode: 'SIGNAL_PRICE' },
    positionSizing: { mode: 'RISK_BASED' },
};

interface RunSpec {
    signalCode: string;
    signalVersion: number;
    timeframe: string;
    notes: string;
}

const WINNERS: RunSpec[] = [
    {
        signalCode: 'SYS_4TF_PD_LEVEL_BREAK_LONG_H4',
        signalVersion: 1,
        timeframe: '4h',
        notes: '[go-live-candidate] PD Level Break H4 optimized — full range baseline',
    },
    {
        signalCode: 'SYS_4TF_PD_LEVEL_BREAK_LONG',
        signalVersion: 2,
        timeframe: '4h',
        notes: '[go-live-candidate] PD Level Break 4H v2 — full range baseline',
    },
    {
        signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG',
        signalVersion: 1,
        timeframe: '2h',
        notes: '[go-live-candidate] Asian Break 2H — full range baseline',
    },
];

async function main() {
    const prisma = new PrismaClient();
    const registry = createDefaultBlockRegistry();
    const backtests = new SignalBacktestRunService(prisma);
    const exec = new SignalBacktestExecutionService(prisma);

    try {
        await upsertTier1ComposedSignals(prisma, registry);

        console.log('=== Full-Range Go-Live Candidate Backtests ===\n');

        for (const spec of WINNERS) {
            console.log(`── ${spec.signalCode} v${spec.signalVersion} (${spec.timeframe}) ──`);

            const { backtestRunId } = await backtests.createGeneratedBacktest({
                signalCode: spec.signalCode,
                signalVersion: spec.signalVersion,
                symbol: 'XAUUSD',
                timeframe: spec.timeframe,
                dateRange: {
                    from: '2019-01-01T00:00:00.000Z',
                    to: '2026-03-14T23:59:59.999Z',
                },
                executionConfig: EXEC_CONFIG,
                initialEquity: 10000,
                riskPercent: 1.5,
                notes: spec.notes,
                parameters: { goLiveCandidate: true },
            });

            console.log(`  Created backtest run: ${backtestRunId}`);
            console.log('  Executing...');

            await exec.executeRun(backtestRunId);

            const rows = await prisma.backtestTradeResult.findMany({
                where: { backtestRunId },
                select: { pnlUsd: true, win: true, isOpen: true },
            });

            const closed = rows.filter(r => !r.isOpen);
            const wins = closed.filter(r => r.win).length;
            const netPnl = closed.reduce((s, r) => s + Number(r.pnlUsd), 0);
            const wr = closed.length > 0 ? Math.round((wins / closed.length) * 10000) / 100 : 0;

            console.log(`  Run ID:  ${backtestRunId}`);
            console.log(`  Trades:  ${closed.length}`);
            console.log(`  Win Rate: ${wr}%`);
            console.log(`  Net PnL: $${Math.round(netPnl * 100) / 100}`);
            console.log('');
        }

        console.log('=== Done ===');
    } finally {
        await prisma.$disconnect();
    }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
