import { FieldSchema } from './blocks/TechIndicatorBlock';
import { TechIndicatorRegistry } from './blocks/TechIndicatorRegistry';

export interface BlockParamSchemaGroup {
    blockId: string;
    indicatorId: string;
    indicatorName: string;
    paramSchema: FieldSchema[];
}

interface ComposedBlockEntry {
    id: string;
    indicatorId: string;
    indicatorParams: Record<string, unknown>;
}

interface ComposedBlocksDef {
    blocks: ComposedBlockEntry[];
}

/**
 * Resolves per-block FieldSchema[] from the TechIndicatorRegistry for each
 * block in a composed signal definition.
 *
 * For each block, the current indicatorParams values are merged as defaults
 * into the schema so the frontend shows the values the signal was saved with.
 */
export function resolveBlockParamSchemas(
    composedBlocks: ComposedBlocksDef | null | undefined,
    registry: TechIndicatorRegistry,
): BlockParamSchemaGroup[] {
    if (!composedBlocks?.blocks) return [];

    const result: BlockParamSchemaGroup[] = [];

    for (const block of composedBlocks.blocks) {
        const indicator = registry.get(block.indicatorId);
        if (!indicator) continue;

        const paramSchema = indicator.definition.paramSchema.map((field) => ({
            ...field,
            default: block.indicatorParams[field.id] ?? field.default,
        }));

        result.push({
            blockId: block.id,
            indicatorId: indicator.definition.id,
            indicatorName: indicator.definition.name,
            paramSchema,
        });
    }

    return result;
}
