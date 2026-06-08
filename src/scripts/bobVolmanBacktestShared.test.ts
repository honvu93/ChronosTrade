import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { createDefaultBlockRegistry } from '../services/signals/blocks/createDefaultBlockRegistry';
import { validateComposedSignalDefinition } from '../services/signals/composedSignalValidation';
import {
    createBobVolmanComposedSignalPayload,
    getBobVolmanStrategySpec,
    listBobVolmanStrategySpecs,
} from './bobVolmanBacktestShared';

const EXPECTED_VARIANTS = [
    'breakout_long',
    'breakout_short',
    'false_break_long',
    'false_break_short',
];

describe('bobVolmanBacktestShared', () => {
    it('exposes the expected Bob Volman backtest variants', () => {
        const variants = listBobVolmanStrategySpecs();

        assert.deepEqual(
            variants.map((variant) => variant.id),
            EXPECTED_VARIANTS,
        );
        assert.equal(new Set(variants.map((variant) => variant.signalCode)).size, variants.length);
    });

    it('produces composed definitions that validate against the built-in registry', () => {
        const blockRegistry = createDefaultBlockRegistry();

        for (const variantId of EXPECTED_VARIANTS) {
            const spec = getBobVolmanStrategySpec(variantId as Parameters<typeof getBobVolmanStrategySpec>[0]);
            const issues = validateComposedSignalDefinition(spec.composedDefinition, blockRegistry);
            assert.deepEqual(issues, [], `expected ${variantId} to validate cleanly`);
        }
    });

    it('builds reusable create payloads for composed-signal persistence', () => {
        const payload = createBobVolmanComposedSignalPayload('breakout_long');

        assert.equal(payload.name, 'Bob Volman Breakout Long');
        assert.equal(payload.category, 'bob-volman');
        assert.equal(payload.composedBlocks.side, 'LONG');
        assert.equal(payload.composedBlocks.blocks[0]?.indicatorId, 'SESSION_FILTER');
        assert.equal(payload.composedBlocks.blocks[2]?.indicatorId, 'VOLMAN_PRICE_ACTION');
    });
});
