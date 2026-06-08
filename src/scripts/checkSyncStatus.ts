import { PrismaClient } from '@prisma/client';
import { getMarketSymbolAliases, normalizeMarketSymbol } from '../utils/symbols';

async function main() {
    const prisma = new PrismaClient();
    try {
        const symbols = ['XAUUSD', 'XAGUSD', 'BTCUSD'];
        const timeframes = ['1m', '5m', '15m', '1h'];

        console.log(`Current Time (Local): ${new Date().toLocaleString()}`);
        console.log(`Current Time (UTC):   ${new Date().toISOString()}`);
        console.log('----------------------------------------------------');

        for (const symbol of symbols) {
            const canonicalSymbol = normalizeMarketSymbol(symbol);
            for (const tf of timeframes) {
                const latest = await prisma.candle.findFirst({
                    where: {
                        symbol: { in: getMarketSymbolAliases(symbol) },
                        timeframe: tf,
                    },
                    orderBy: { time: 'desc' }
                });

                if (latest) {
                    const lagMinutes = Math.floor((Date.now() - latest.time.getTime()) / 60000);
                    const gmt7 = new Date(latest.time.getTime() + 7 * 3600 * 1000);
                    const gmt7Str = gmt7.toISOString().replace('Z', '').split('.')[0].replace('T', ' ');
                    console.log(`${canonicalSymbol.padEnd(8)} | ${tf.padEnd(3)} | UTC: ${latest.time.toISOString()} | GMT+7: ${gmt7Str} | Lag: ${lagMinutes} min`);
                } else {
                    console.log(`${canonicalSymbol.padEnd(8)} | ${tf.padEnd(3)} | No data found`);
                }
            }
            console.log('----------------------------------------------------');
        }

    } catch (err) {
        console.error(err);
    } finally {
        await prisma.$disconnect();
    }
}

main();
