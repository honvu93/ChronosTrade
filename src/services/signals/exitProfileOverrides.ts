export interface ExitProfileShape {
    code: string;
    name: string;
    description: string;
    targetR: number | null;
    breakEvenAtR: number | null;
    partialAtR: number | null;
    partialCloseFraction: number;
    trailStages: Array<{ triggerR: number; stopToR: number }>;
    maxBarsInTrade: number | null;
    trailByStructureLookback?: number | null;
    exitAtNyClose?: boolean | null;
}

export interface ExitProfileOverrides {
    breakEvenAtR?: number;
    partialAtR?: number;
    partialCloseFraction?: number;
    maxBarsInTrade?: number;
    trailStages?: Array<{ triggerR: number; stopToR: number }>;
}

/**
 * Applies user-provided overrides to a base exit profile.
 * Only numeric fields with valid finite numbers are applied.
 */
export function applyExitProfileOverrides<T extends ExitProfileShape>(
    profile: T,
    overrides: ExitProfileOverrides,
): T {
    const result = { ...profile };

    if (typeof overrides.breakEvenAtR === 'number' && Number.isFinite(overrides.breakEvenAtR)) {
        result.breakEvenAtR = overrides.breakEvenAtR;
    }
    if (typeof overrides.partialAtR === 'number' && Number.isFinite(overrides.partialAtR)) {
        result.partialAtR = overrides.partialAtR;
    }
    if (typeof overrides.partialCloseFraction === 'number' && Number.isFinite(overrides.partialCloseFraction)) {
        result.partialCloseFraction = overrides.partialCloseFraction;
    }
    if (typeof overrides.maxBarsInTrade === 'number' && Number.isFinite(overrides.maxBarsInTrade)) {
        result.maxBarsInTrade = overrides.maxBarsInTrade;
    }
    if (Array.isArray(overrides.trailStages)) {
        result.trailStages = overrides.trailStages.filter(
            (s) => typeof s.triggerR === 'number' && typeof s.stopToR === 'number',
        );
    }

    return result;
}
