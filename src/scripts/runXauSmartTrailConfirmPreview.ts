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

dotenv.config();

type Summary = {
    trades: number;
    netPnl: number;
    netR: number;
    winRate: number;
    maxDd: number;
    profitFactor: number | null;
};

type PreviewRow = {
    variantId: string;
    signalCode: string;
    side: 'LONG' | 'SHORT';
    timeframe: string;
    summary: Summary;
};

type OutputFile = {
    generatedAt: string;
    symbol: string;
    from: string;
    to: string;
    initialEquity: number;
    riskPercent: number;
    executionConfig: ExecutionConfigInput;
    notes: string[];
    results: PreviewRow[];
};

const FROM = new Date('2019-01-01T00:00:00.000Z');
const TO = new Date('2026-03-14T23:59:59.999Z');
const SYMBOL = 'XAUUSD';
const INITIAL_EQUITY = 10_000;
const RISK_PERCENT = 2;
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

function parseArgs(argv: string[]) {
    let outPath = '.artifacts/xau-smart-trail-confirm/xau-smart-trail-confirm-preview.json';

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

function summarize(results: Array<{ isOpen: boolean; pnlUsd: number; rMultiple: number; win: boolean; maxDrawdownPct: number }>): Summary {
    const closed = results.filter((row) => !row.isOpen);
    const netPnl = closed.reduce((sum, row) => sum + Number(row.pnlUsd), 0);
    const netR = closed.reduce((sum, row) => sum + Number(row.rMultiple), 0);
    const wins = closed.filter((row) => row.win).length;
    const maxDd = closed.length ? Math.min(...closed.map((row) => Number(row.maxDrawdownPct))) : 0;
    const grossWin = closed.filter((row) => Number(row.pnlUsd) > 0).reduce((sum, row) => sum + Number(row.pnlUsd), 0);
    const grossLoss = Math.abs(closed.filter((row) => Number(row.pnlUsd) < 0).reduce((sum, row) => sum + Number(row.pnlUsd), 0));

    return {
        trades: closed.length,
        netPnl: Number(netPnl.toFixed(2)),
        netR: Number(netR.toFixed(2)),
        winRate: closed.length ? Number(((wins / closed.length) * 100).toFixed(2)) : 0,
        maxDd: Number(maxDd.toFixed(2)),
        profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : null,
    };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const seeds = getTier1ComposedSignalSeeds();
    const variants = [
        { variantId: 'smart_trail_confirm_long', signalCode: 'SYS_XAU_SMART_TRAIL_CONFIRM_LONG', side: 'LONG' as const },
        { variantId: 'smart_trail_confirm_short', signalCode: 'SYS_XAU_SMART_TRAIL_CONFIRM_SHORT', side: 'SHORT' as const },
    ];

    const prisma = new PrismaClient();
    const registry = SignalRegistry.getInstance();
    const runner = new SignalBacktestRunner(
        new CandleQueryService(prisma),
        new IndicatorSeriesService(),
        new ExecutionModelService(),
        registry,
    );
    const blockRegistry = createDefaultBlockRegistry();
    const results: PreviewRow[] = [];

    try {
        for (const variant of variants) {
            const seed = seeds.find((entry) => entry.code === variant.signalCode);
            if (!seed) {
                throw new Error(`Missing seed ${variant.signalCode}.`);
            }

            const definition = JSON.parse(JSON.stringify(seed.composedBlocks)) as ComposedSignalDefinition;
            const timeframe = String((definition as { timeframe?: string }).timeframe ?? 'M15');
            const tmpCode = `STC_${variant.signalCode}`.slice(0, 60);
            registry.register(new ComposedSignalPlugin(definition, blockRegistry, tmpCode, 1, tmpCode));

            try {
                const output = await runner.run({
                    signalCode: tmpCode,
                    signalVersion: 1,
                    symbol: SYMBOL,
                    timeframe,
                    from: FROM,
                    to: TO,
                    parameters: {},
                    initialEquity: INITIAL_EQUITY,
                    riskPercent: RISK_PERCENT,
                    executionConfig: DEFAULT_EXECUTION_CONFIG,
                });

                results.push({
                    variantId: variant.variantId,
                    signalCode: variant.signalCode,
                    side: variant.side,
                    timeframe,
                    summary: summarize(output.results as Array<{
                        isOpen: boolean;
                        pnlUsd: number;
                        rMultiple: number;
                        win: boolean;
                        maxDrawdownPct: number;
                    }>),
                });
            } finally {
                registry.unregister(tmpCode, 1);
            }
        }
    } finally {
        await prisma.$disconnect();
    }

    const outputFile: OutputFile = {
        generatedAt: new Date().toISOString(),
        symbol: SYMBOL,
        from: FROM.toISOString(),
        to: TO.toISOString(),
        initialEquity: INITIAL_EQUITY,
        riskPercent: RISK_PERCENT,
        executionConfig: DEFAULT_EXECUTION_CONFIG,
        notes: [
            'Smart Trail Switch is implemented as an ATR-based adaptive trail flip.',
            'Confirmation Trend is implemented as EMA alignment plus ADX strength.',
            'Trend Catcher is implemented as short-horizon EMA and RSI state for pullback detection.',
        ],
        results,
    };

    const resolved = path.resolve(args.outPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, JSON.stringify(outputFile, null, 2));
    console.log(`Saved JSON output to ${resolved}`);
    console.table(results.map((row) => ({
        Variant: row.variantId,
        Side: row.side,
        TF: row.timeframe,
        NetPnL: row.summary.netPnl,
        WR: `${row.summary.winRate}%`,
        PF: row.summary.profitFactor,
        Trades: row.summary.trades,
    })));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
