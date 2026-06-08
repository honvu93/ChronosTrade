import { PrismaClient } from '@prisma/client';
import { getMarketSymbolAliases, normalizeMarketSymbol } from '../utils/symbols';

async function main() {
    const prisma = new PrismaClient();
    try {
        const symbol = 'XAUUSD';
        const candles = await prisma.candle.findMany({
            where: {
                symbol: { in: getMarketSymbolAliases(symbol) },
                timeframe: '1h'
            },
            orderBy: { time: 'desc' },
            take: 5
        });
        console.log(`Latest 5 ${normalizeMarketSymbol(symbol)} 1h candles:`);
        candles.forEach(c => console.log(`${c.time.toISOString()} - Close: ${c.close}`));

    } catch (err) {
        console.error(err);
    } finally {
        await prisma.$disconnect();
    }
}

main();
