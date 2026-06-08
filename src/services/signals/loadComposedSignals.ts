import { PrismaClient } from '@prisma/client';
import { ComposedSignalDefinition, ComposedSignalPlugin } from './ComposedSignalPlugin';
import { TechIndicatorRegistry } from './blocks/TechIndicatorRegistry';
import { SignalRegistry } from './SignalRegistry';
import { IndicatorCatalogService } from './IndicatorCatalogService';

/**
 * Loads all user-composed signal definitions from the database and registers
 * them into the given SignalRegistry as ComposedSignalPlugin instances.
 *
 * Call this once at server startup, after creating both registries.
 *
 * @example
 *   await loadComposedSignals(SignalRegistry.getInstance(), prisma, blockRegistry);
 */
export async function loadComposedSignals(
    signalRegistry: SignalRegistry,
    prisma: PrismaClient,
    blockRegistry: TechIndicatorRegistry,
    indicatorCatalogService?: IndicatorCatalogService,
): Promise<void> {
    if (indicatorCatalogService) {
        await indicatorCatalogService.syncRuntimeAliases();
    }

    const rows = await prisma.signalDefinition.findMany({
        where: { isComposed: true, isActive: true },
    });

    let loaded = 0;
    for (const row of rows) {
        if (!row.composedBlocks) {
            console.warn(`[loadComposedSignals] Signal "${row.code}@${row.version}" has no composedBlocks — skipping`);
            continue;
        }

        try {
            const composedDef = row.composedBlocks as unknown as ComposedSignalDefinition;

            // Validate that all referenced blocks exist
            const missingBlocks = composedDef.blocks
                .map(b => b.indicatorId)
                .filter(id => !blockRegistry.has(id));

            if (missingBlocks.length > 0) {
                console.warn(
                    `[loadComposedSignals] Signal "${row.code}@${row.version}" references unknown blocks: ${missingBlocks.join(', ')} — skipping`,
                );
                continue;
            }

            const plugin = new ComposedSignalPlugin(
                composedDef,
                blockRegistry,
                row.code,
                row.version,
                row.name,
            );

            signalRegistry.register(plugin);
            loaded++;
        } catch (err) {
            console.error(`[loadComposedSignals] Failed to load "${row.code}@${row.version}":`, err);
        }
    }

    if (rows.length > 0) {
        console.log(`[loadComposedSignals] Loaded ${loaded}/${rows.length} composed signals`);
    }
}
