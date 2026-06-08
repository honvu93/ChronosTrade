import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const prisma = new PrismaClient();

async function main() {
    const targetSymbols = ['BTCUSDT', 'BTC/USDT', 'XAUUSD', 'XAU/USD', 'XAGUSD', 'XAG/USD', 'BTC', 'XAU', 'XAG', 'BTCUSD'];

    const candleGroups = await prisma.candle.groupBy({
        by: ['symbol', 'timeframe'],
        _count: { _all: true },
        _min: { time: true },
        _max: { time: true },
    });

    const filteredCandles = candleGroups.filter(g =>
        targetSymbols.some(s => g.symbol.includes(s) || s.includes(g.symbol))
    );

    const signalGroups = await prisma.signal.groupBy({
        by: ['symbol', 'timeframe'],
        _count: { _all: true }
    });

    const filteredSignals = signalGroups.filter(g =>
        targetSymbols.some(s => g.symbol.includes(s) || s.includes(g.symbol))
    );

    const backtestGroups = await prisma.backtestRun.groupBy({
        by: ['symbol', 'timeframe', 'status'],
        _count: { _all: true }
    });

    const filteredBacktests = backtestGroups.filter(g =>
        targetSymbols.some(s => g.symbol.includes(s) || s.includes(g.symbol))
    );

    const result = {
        candles: filteredCandles,
        signals: filteredSignals,
        backtests: filteredBacktests
    };

    fs.writeFileSync('result.json', JSON.stringify(result, null, 2));
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
