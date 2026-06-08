import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { createDefaultBlockRegistry } from './blocks/createDefaultBlockRegistry';
import { validateComposedSignalDefinition } from './composedSignalValidation';
import { getTier1ComposedSignalSeeds } from './tier1ComposedSignals';

describe('tier1ComposedSignals', () => {
    it('keeps all Tier 1 seeds valid against the current indicator registry', () => {
        const registry = createDefaultBlockRegistry();
        const seeds = getTier1ComposedSignalSeeds();
        const seenKeys = new Set<string>();

        assert.equal(seeds.length, 29);

        for (const seed of seeds) {
            const key = `${seed.code}@${seed.version}`;
            assert.equal(seenKeys.has(key), false, `Duplicate seed key: ${key}`);
            seenKeys.add(key);

            assert.ok(seed.name.startsWith('Tier 1 - ') || seed.name.startsWith('NEW-'), `Expected Tier 1 or NEW- prefix for ${key}`);
            assert.ok(seed.composedBlocks.symbol, `Expected default symbol for ${key}`);
            assert.ok(seed.composedBlocks.timeframe, `Expected default timeframe for ${key}`);

            const issues = validateComposedSignalDefinition(seed.composedBlocks, registry);
            assert.deepEqual(issues, [], `Unexpected validation issues for ${key}`);
        }
    });
});
