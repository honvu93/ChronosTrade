
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkAllGaps() {
    const symbol = 'BTCUSD';
    const tfConfig = [
        { name: '1d', ms: 24 * 60 * 60 * 1000 },
        { name: '4h', ms: 4 * 60 * 60 * 1000 },
        { name: '1h', ms: 60 * 60 * 1000 },
        { name: '15m', ms: 15 * 60 * 1000 },
        { name: '5m', ms: 5 * 60 * 1000 },
        { name: '1m', ms: 60 * 1000 },
    ];

    console.log(`=== Gap Analysis for ${symbol} ===`);

    for (const tf of tfConfig) {
        console.log(`\nChecking Timeframe: ${tf.name}...`);
        const candles = await prisma.candle.findMany({
            where: {
                symbol: symbol,
                timeframe: tf.name,
                time: {
                    gte: new Date('2026-02-01'),
                }
            },
            orderBy: {
                time: 'asc'
            }
        });

        if (candles.length === 0) {
            console.log(`  [X] No data found for ${tf.name} since 2026-02-01`);
            continue;
        }

        let gapCount = 0;
        let gaps: string[] = [];

        for (let i = 1; i < candles.length; i++) {
            const diff = candles[i].time.getTime() - candles[i - 1].time.getTime();
            if (diff > tf.ms) {
                gapCount++;
                gaps.push(`${candles[i - 1].time.toISOString()} -> ${candles[i].time.toISOString()} (${diff / 3600000}h)`);
            }
        }

        if (gapCount === 0) {
            console.log(`  [OK] No gaps found (Found ${candles.length} candles)`);
        } else {
            console.log(`  [!] Found ${gapCount} GAPS:`);
            gaps.slice(0, 5).forEach(g => console.log(`      - ${g}`));
            if (gaps.length > 5) console.log(`      ... and ${gaps.length - 5} more`);
        }
    }

    await prisma.$disconnect();
}

checkAllGaps();
