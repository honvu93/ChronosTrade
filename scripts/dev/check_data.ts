import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const targetSymbols = ['BTCUSDT', 'BTC/USDT', 'XAUUSD', 'XAU/USD', 'XAGUSD', 'XAG/USD', 'BTC', 'XAU', 'XAG'];

    console.log("\n--- Candlestick Data in DB ---");
    const candleGroups = await prisma.candle.groupBy({
        by: ['symbol', 'timeframe'],
        _count: { _all: true },
        _min: { time: true },
        _max: { time: true },
    });

    const filteredCandles = candleGroups.filter(g =>
        targetSymbols.some(s => g.symbol.includes(s) || s.includes(g.symbol))
    );

    if (filteredCandles.length > 0) {
        filteredCandles.forEach(c => {
            console.log(`- ${c.symbol} (${c.timeframe}): ${c._count._all} candles | From: ${c._min.time?.toISOString()} | To: ${c._max.time?.toISOString()}`);
        });
    } else {
        console.log("No candle data found for BTC, XAU, or XAG.");
    }

    console.log("\n--- Signals in DB ---");
    const signalGroups = await prisma.signal.groupBy({
        by: ['symbol', 'timeframe'],
        _count: { _all: true }
    });

    const filteredSignals = signalGroups.filter(g =>
        targetSymbols.some(s => g.symbol.includes(s) || s.includes(g.symbol))
    );

    if (filteredSignals.length > 0) {
        filteredSignals.forEach(s => {
            console.log(`- ${s.symbol} (${s.timeframe}): ${s._count._all} signals`);
        });
    } else {
        console.log("No signals found for BTC, XAU, or XAG.");
    }

    console.log("\n--- Backtest Runs in DB ---");
    const backtestGroups = await prisma.backtestRun.groupBy({
        by: ['symbol', 'timeframe', 'status'],
        _count: { _all: true }
    });

    const filteredBacktests = backtestGroups.filter(g =>
        targetSymbols.some(s => g.symbol.includes(s) || s.includes(g.symbol))
    );

    if (filteredBacktests.length > 0) {
        filteredBacktests.forEach(b => {
            console.log(`- ${b.symbol} (${b.timeframe}): ${b._count._all} runs (Status: ${b.status})`);
        });
    } else {
        console.log("No backtest runs found for BTC, XAU, or XAG.");
    }
}

main()
    .catch(e => {
        console.error("Error:", e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
