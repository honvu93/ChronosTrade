import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// We'll test the module-level function indirectly through ComposedSignalPlugin
// since resolveComposedExitProfile is not exported. Instead, test the override
// behavior through a standalone helper we'll extract.

import { applyExitProfileOverrides } from './exitProfileOverrides';

describe('applyExitProfileOverrides', () => {
    const baseProfile = {
        code: 'PARTIAL_1R_BE_R3' as const,
        name: '50% at 1R / BE / TP 3R',
        description: 'Take 50% at 1R, move stop to break-even, target 3R on the remainder.',
        targetR: 3,
        breakEvenAtR: 1,
        partialAtR: 1,
        partialCloseFraction: 0.5,
        trailStages: [] as Array<{ triggerR: number; stopToR: number }>,
        maxBarsInTrade: null as number | null,
    };

    it('returns profile unchanged when no overrides provided', () => {
        const result = applyExitProfileOverrides(baseProfile, {});
        assert.deepEqual(result, baseProfile);
    });

    it('overrides breakEvenAtR', () => {
        const result = applyExitProfileOverrides(baseProfile, { breakEvenAtR: 0.8 });
        assert.equal(result.breakEvenAtR, 0.8);
        assert.equal(result.partialAtR, 1); // unchanged
    });

    it('overrides partialAtR and partialCloseFraction', () => {
        const result = applyExitProfileOverrides(baseProfile, {
            partialAtR: 1.5,
            partialCloseFraction: 0.3,
        });
        assert.equal(result.partialAtR, 1.5);
        assert.equal(result.partialCloseFraction, 0.3);
    });

    it('overrides maxBarsInTrade', () => {
        const result = applyExitProfileOverrides(baseProfile, { maxBarsInTrade: 48 });
        assert.equal(result.maxBarsInTrade, 48);
    });

    it('overrides trailStages', () => {
        const result = applyExitProfileOverrides(baseProfile, {
            trailStages: [{ triggerR: 1.5, stopToR: 0.5 }],
        });
        assert.equal(result.trailStages.length, 1);
        assert.equal(result.trailStages[0].triggerR, 1.5);
    });

    it('ignores invalid override types', () => {
        const result = applyExitProfileOverrides(baseProfile, {
            breakEvenAtR: 'invalid' as unknown as number,
            maxBarsInTrade: 'bad' as unknown as number,
        });
        assert.equal(result.breakEvenAtR, 1); // unchanged
        assert.equal(result.maxBarsInTrade, null); // unchanged
    });
});
