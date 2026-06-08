
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function deepCasingCheck() {
    const allSymbols = await prisma.$queryRaw`SELECT symbol, timeframe, count(*)::int as count FROM price_candles WHERE symbol ILIKE 'BTCUSD%' GROUP BY symbol, timeframe ORDER BY symbol, timeframe`;
    console.log('Deep Casing Check:');
    console.table(allSymbols);
    await prisma.$disconnect();
}

deepCasingCheck();
