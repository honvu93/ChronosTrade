import { PrismaClient } from '@prisma/client';
import { SignalPlatformService } from '../services/signals/SignalPlatformService';

const prisma = new PrismaClient();

async function main() {
    const platform = new SignalPlatformService(prisma);
    const output = await platform.runPreviewBatch({
        matrix: {
            assets: [
                {
                    assetKey: 'BTC_MAIN',
                    symbol: 'BTCUSD',
                    timeframe: '1h',
                    dateRange: {
                        from: '2025-07-01T00:00:00.000Z',
                        to: '2026-03-01T23:59:59.999Z',
                    },
                },
                {
                    assetKey: 'XAU_MAIN',
                    symbol: 'XAUUSD',
                    timeframe: '1h',
                    dateRange: {
                        from: '2025-07-01T00:00:00.000Z',
                        to: '2026-03-01T23:59:59.999Z',
                    },
                },
            ],
            definitions: [
                {
                    definitionKey: 'SONG_TRAP_V1',
                    signalCode: 'SONG_TRAP',
                    signalVersion: 1,
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
                },
            ],
        },
        maxConcurrency: 2,
    });

    console.log(JSON.stringify(output, null, 2));
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
