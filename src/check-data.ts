import { PrismaClient } from '@prisma/client';
import { getMarketSymbolAliases, normalizeMarketSymbol } from './utils/symbols';

const prisma = new PrismaClient();

async function main() {
    const symbols = ['BTCUSD', 'XAUUSD', 'XAGUSD'];
    console.log('--- Data Summary ---');

    for (const symbol of symbols) {
        const canonicalSymbol = normalizeMarketSymbol(symbol);
        const result = await prisma.candle.groupBy({
            by: ['timeframe'],
            where: { symbol: { in: getMarketSymbolAliases(symbol) } },
            _count: true,
            _min: { time: true },
            _max: { time: true },
        });

        console.log(`\nSymbol: ${canonicalSymbol}`);
        result.forEach(r => {
            console.log(`  Timeframe: ${r.timeframe}`);
            console.log(`    Count: ${r._count}`);
            console.log(`    Range: ${r._min.time?.toISOString()} -> ${r._max.time?.toISOString()}`);
        });
    }
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
