
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function listAllSymbols() {
    const results = await prisma.candle.groupBy({
        by: ['symbol'],
        _count: {
            _all: true
        }
    });

    console.log('All Symbols in Database:');
    console.table(results.map(r => ({
        Symbol: r.symbol,
        Count: r._count._all
    })));

    await prisma.$disconnect();
}

listAllSymbols();
