import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { createDefaultBlockRegistry } from '../services/signals/blocks/createDefaultBlockRegistry';
import { IndicatorCatalogService } from '../services/signals/IndicatorCatalogService';
import { upsertTier1ComposedSignals } from '../services/signals/tier1ComposedSignals';

dotenv.config();

const prisma = new PrismaClient();

async function main() {
    const blockRegistry = createDefaultBlockRegistry();
    const indicatorCatalogService = new IndicatorCatalogService(prisma, blockRegistry);

    await prisma.$connect();
    await indicatorCatalogService.syncCatalogFromRuntime();

    const result = await upsertTier1ComposedSignals(prisma, blockRegistry);

    console.log('[Tier1Signals] Seed complete');
    console.log(JSON.stringify(result, null, 2));
}

main()
    .then(async () => {
        await prisma.$disconnect();
    })
    .catch(async (error) => {
        console.error('[Tier1Signals] Seed failed:', error);
        await prisma.$disconnect();
        process.exit(1);
    });
