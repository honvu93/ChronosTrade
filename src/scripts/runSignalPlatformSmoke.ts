import { PrismaClient } from '@prisma/client';
import { SignalPlatformService } from '../services/signals/SignalPlatformService';

const prisma = new PrismaClient();

async function main() {
    const platform = new SignalPlatformService(prisma);
    const output = await platform.runPreview({
        signalCode: 'SONG_TRAP',
        signalVersion: 1,
        symbol: 'XAUUSD',
        timeframe: '1h',
        from: new Date('2025-07-01T00:00:00.000Z'),
        to: new Date('2026-03-01T23:59:59.999Z'),
        parameters: {
            rsiLength: 14,
            emaLength: 9,
            wmaLength: 45,
            trapLevel: 80,
            pullbackLevel: 60,
            invalidateLevel: 40,
            trendTf: '4h',
        },
        executionConfig: {
            entryFeeBps: 6,
            exitFeeBps: 6,
            entrySlippageBps: 3,
            exitSlippageBps: 3,
            orderTiming: 'NEXT_BAR_OPEN',
            stopLoss: {
                mode: 'ACCOUNT_PERCENT',
                value: 1,
            },
            takeProfit: {
                mode: 'R_MULTIPLE',
                value: 1.5,
            },
            positionSizing: {
                mode: 'ACCOUNT_PERCENT',
                value: 10,
            },
        },
    });

    console.log(JSON.stringify({
        registry: platform.getRegistryDefinitions(),
        barsProcessed: output.barsProcessed,
        signals: output.signals.length,
        events: output.events.length,
        traces: output.traces.length,
        results: output.results.length,
    }, null, 2));
}

main()
    .then(async () => {
        await prisma.$disconnect();
    })
    .catch(async (error) => {
        console.error(error);
        await prisma.$disconnect();
        process.exit(1);
    });
