import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const UPDATES = [
    {
        id: 'cmn700f2t0000tk70i4p33em0',
        label: 'PD Level Break H4-opt',
        exitStrategy: 'HARD_SIGNAL_TP',
    },
    {
        id: 'cmn6ztqzs0000tkqh57ovtwtw',
        label: 'PD Level Break v2',
        exitStrategy: 'PARTIAL_1R_BE_R3',
    },
    {
        id: 'cmn70wrgx0000tky7gn4k7lp9',
        label: 'Asian Break 2H',
        exitStrategy: 'BE_1R_TRAIL_2R_3R',
    },
];

async function main() {
    const prisma = new PrismaClient();

    try {
        for (const update of UPDATES) {
            const instance = await prisma.indicatorInstance.findUnique({
                where: { id: update.id },
            });

            if (!instance) {
                console.error(`Instance not found: ${update.id} (${update.label})`);
                continue;
            }

            const currentParams = (instance.parameterJson ?? {}) as Record<string, unknown>;
            console.log(`\n--- ${update.label} (${update.id}) ---`);
            console.log(`  Name:   ${instance.name}`);
            console.log(`  Signal: ${instance.signalCode} v${instance.signalVersion}`);
            console.log(`  Status: ${instance.status}`);
            console.log(`  BEFORE parameterJson:`, JSON.stringify(currentParams, null, 2));

            const updatedParams = {
                ...currentParams,
                exitStrategy: update.exitStrategy,
            };

            await prisma.indicatorInstance.update({
                where: { id: update.id },
                data: { parameterJson: updatedParams },
            });

            // Re-read to confirm
            const after = await prisma.indicatorInstance.findUnique({
                where: { id: update.id },
            });
            console.log(`  AFTER  parameterJson:`, JSON.stringify(after!.parameterJson, null, 2));
            console.log(`  -> exitStrategy set to: ${update.exitStrategy}`);
        }

        console.log('\nAll updates complete.');
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
