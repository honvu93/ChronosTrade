import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    await prisma.signalDefinition.upsert({
        where: {
            code_version: {
                code: 'SONG_TRAP',
                version: 1,
            },
        },
        update: {
            name: 'Song Trap',
            category: 'momentum-trap',
            description: 'Version 1 definition for the Song Trap generated signal workflow.',
            parameterSchema: {
                fields: [
                    { id: 'trendTf', type: 'select', label: 'Trend Timeframe', default: '4h', options: ['4h', '1d'] },
                    { id: 'rsiLength', type: 'number', label: 'RSI Length', default: 14 },
                    { id: 'emaLength', type: 'number', label: 'RSI EMA Length', default: 9 },
                    { id: 'wmaLength', type: 'number', label: 'RSI WMA Length', default: 45 },
                    { id: 'trapLevel', type: 'number', label: 'Trap Level', default: 80 },
                    { id: 'pullbackLevel', type: 'number', label: 'Pullback Level', default: 60 },
                    { id: 'invalidateLevel', type: 'number', label: 'Invalidation Level', default: 40 },
                    { id: 'breakEvenTriggerPct', type: 'number', label: 'Break-even Trigger %', default: 2 },
                    { id: 'trail1TriggerPct', type: 'number', label: 'Trail 1 Trigger %', default: 3 },
                    { id: 'trail1ClosePct', type: 'number', label: 'Trail 1 Close %', default: 25 },
                    { id: 'trail2TriggerPct', type: 'number', label: 'Trail 2 Trigger %', default: 6 },
                    { id: 'trail2ClosePct', type: 'number', label: 'Trail 2 Close %', default: 35 },
                    { id: 'trail3TriggerPct', type: 'number', label: 'Trail 3 Trigger %', default: 10 },
                    { id: 'trail3ClosePct', type: 'number', label: 'Trail 3 Close %', default: 40 },
                    { id: 'closeRemainingOnRangeEnd', type: 'boolean', label: 'Force Close On Range End', default: true },
                ],
            },
            indicatorSchema: {
                series: ['RSI_14', 'RSI_EMA_9', 'RSI_WMA_45', 'RSI_14_4H'],
            },
            eventSchema: {
                events: ['TRAP', 'X1', 'ENTRY', 'ENTRY_CONFIRMED', 'FAIL', 'COMPLETE_Y', 'MOVE_SL_BE', 'TRAIL_START', 'TRAIL_UPDATE', 'STOP_HIT', 'EXPIRATION'],
            },
            isActive: true,
        },
        create: {
            code: 'SONG_TRAP',
            version: 1,
            name: 'Song Trap',
            category: 'momentum-trap',
            description: 'Version 1 definition for the Song Trap generated signal workflow.',
            parameterSchema: {
                fields: [
                    { id: 'trendTf', type: 'select', label: 'Trend Timeframe', default: '4h', options: ['4h', '1d'] },
                    { id: 'rsiLength', type: 'number', label: 'RSI Length', default: 14 },
                    { id: 'emaLength', type: 'number', label: 'RSI EMA Length', default: 9 },
                    { id: 'wmaLength', type: 'number', label: 'RSI WMA Length', default: 45 },
                    { id: 'trapLevel', type: 'number', label: 'Trap Level', default: 80 },
                    { id: 'pullbackLevel', type: 'number', label: 'Pullback Level', default: 60 },
                    { id: 'invalidateLevel', type: 'number', label: 'Invalidation Level', default: 40 },
                    { id: 'breakEvenTriggerPct', type: 'number', label: 'Break-even Trigger %', default: 2 },
                    { id: 'trail1TriggerPct', type: 'number', label: 'Trail 1 Trigger %', default: 3 },
                    { id: 'trail1ClosePct', type: 'number', label: 'Trail 1 Close %', default: 25 },
                    { id: 'trail2TriggerPct', type: 'number', label: 'Trail 2 Trigger %', default: 6 },
                    { id: 'trail2ClosePct', type: 'number', label: 'Trail 2 Close %', default: 35 },
                    { id: 'trail3TriggerPct', type: 'number', label: 'Trail 3 Trigger %', default: 10 },
                    { id: 'trail3ClosePct', type: 'number', label: 'Trail 3 Close %', default: 40 },
                    { id: 'closeRemainingOnRangeEnd', type: 'boolean', label: 'Force Close On Range End', default: true },
                ],
            },
            indicatorSchema: {
                series: ['RSI_14', 'RSI_EMA_9', 'RSI_WMA_45', 'RSI_14_4H'],
            },
            eventSchema: {
                events: ['TRAP', 'X1', 'ENTRY', 'ENTRY_CONFIRMED', 'FAIL', 'COMPLETE_Y', 'MOVE_SL_BE', 'TRAIL_START', 'TRAIL_UPDATE', 'STOP_HIT', 'EXPIRATION'],
            },
            isActive: true,
        },
    });
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
