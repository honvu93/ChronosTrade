import { EntryVariant, GuardVariant, ExitVariant } from './optimizationTypes';

// ─── Range Helper ────────────────────────────────────────────────────────────

interface ParamRange {
    min: number;
    max: number;
    step: number;
}

function rangeValues(r: ParamRange): number[] {
    const values: number[] = [];
    for (let v = r.min; v <= r.max + r.step * 0.01; v += r.step) {
        values.push(Number(v.toFixed(4)));
    }
    return values;
}

function autoStep(min: number, max: number, steps = 3): ParamRange {
    return { min, max, step: Number(((max - min) / steps).toFixed(4)) };
}

// ─── L1 Entry Param Ranges ───────────────────────────────────────────────────

interface EntryParamRanges {
    rsiPeriod?: ParamRange;
    rsiThreshold?: ParamRange;
    slAtrPeriod?: ParamRange;
    slAtrBufferMultiplier?: ParamRange;
    emaFilterPeriod?: ParamRange;
    windowBars?: ParamRange;
    smcLookback?: ParamRange;
    fibLookback?: ParamRange;
    sweepSessionFilter?: boolean; // true = sweep present/absent
}

const L1_ENTRY_RANGES: Record<string, EntryParamRanges> = {
    M5: {
        rsiPeriod: autoStep(7, 14),
        rsiThreshold: autoStep(25, 40, 3),
        slAtrPeriod: autoStep(7, 14),
        slAtrBufferMultiplier: autoStep(1.0, 2.0, 4),
        emaFilterPeriod: autoStep(50, 200, 3),
        windowBars: autoStep(2, 6, 4),
        smcLookback: autoStep(20, 60, 4),
        fibLookback: autoStep(30, 80, 4),
        sweepSessionFilter: true,
    },
    M15: {
        rsiPeriod: autoStep(9, 18),
        rsiThreshold: autoStep(25, 42, 3),
        slAtrPeriod: autoStep(10, 18),
        slAtrBufferMultiplier: autoStep(1.0, 2.2, 4),
        emaFilterPeriod: autoStep(50, 200, 3),
        windowBars: autoStep(2, 5, 3),
        smcLookback: autoStep(15, 50, 4),
        fibLookback: autoStep(20, 60, 4),
        sweepSessionFilter: true,
    },
    M30: {
        rsiPeriod: autoStep(10, 21),
        rsiThreshold: autoStep(28, 45, 3),
        slAtrPeriod: autoStep(10, 21),
        slAtrBufferMultiplier: autoStep(1.1, 2.5, 4),
        emaFilterPeriod: autoStep(50, 200, 3),
        windowBars: autoStep(2, 4, 2),
        smcLookback: autoStep(12, 40, 4),
        fibLookback: autoStep(15, 50, 4),
        sweepSessionFilter: true,
    },
    H1: {
        rsiPeriod: autoStep(12, 24),
        rsiThreshold: autoStep(30, 45, 3),
        slAtrPeriod: autoStep(12, 21),
        slAtrBufferMultiplier: autoStep(1.2, 2.8, 4),
        emaFilterPeriod: autoStep(50, 200, 3),
        windowBars: autoStep(1, 4, 3),
        smcLookback: autoStep(10, 30, 4),
        fibLookback: autoStep(12, 40, 4),
        sweepSessionFilter: false,
    },
    H4: {
        rsiPeriod: autoStep(14, 28),
        rsiThreshold: autoStep(30, 45, 3),
        slAtrPeriod: autoStep(14, 24),
        slAtrBufferMultiplier: autoStep(1.3, 3.0, 4),
        emaFilterPeriod: autoStep(50, 200, 3),
        windowBars: autoStep(1, 3, 2),
        smcLookback: autoStep(8, 24, 4),
        fibLookback: autoStep(8, 24, 4),
        sweepSessionFilter: false,
    },
    D1: {
        rsiPeriod: autoStep(14, 28),
        rsiThreshold: autoStep(30, 45, 3),
        slAtrPeriod: autoStep(14, 28),
        slAtrBufferMultiplier: autoStep(1.5, 3.5, 4),
        emaFilterPeriod: autoStep(50, 200, 3),
        windowBars: autoStep(1, 3, 2),
        smcLookback: autoStep(5, 15, 2),
        fibLookback: autoStep(5, 15, 2),
        sweepSessionFilter: false,
    },
};

// ─── L2 Guard Ranges ─────────────────────────────────────────────────────────

interface GuardProfile {
    label: string;
    guards: Record<string, unknown>;
}

function buildGuardProfiles(timeframe: string): GuardProfile[] {
    const isLowTf = ['M5', 'M15', 'M30'].includes(timeframe);
    const isHighTf = ['H4', 'D1'].includes(timeframe);

    const profiles: GuardProfile[] = [];

    // Predefined guard intensity levels
    const tightness = [
        { label: 'TIGHT', dayMaxLosses: 2, dayMaxNetR: 2, streakAfter: 3, ecfTrades: 15, ddPct: 8 },
        { label: 'MODERATE', dayMaxLosses: 3, dayMaxNetR: 3, streakAfter: 4, ecfTrades: 20, ddPct: 12 },
        { label: 'LOOSE', dayMaxLosses: 4, dayMaxNetR: 4, streakAfter: 5, ecfTrades: 25, ddPct: 15 },
    ];

    // Cooldown minutes scale with timeframe
    const cooldownScale: Record<string, number> = {
        M5: 120, M15: 240, M30: 480, H1: 720, H4: 1440, D1: 4320,
    };
    const baseCooldown = cooldownScale[timeframe] ?? 240;

    // ECF actions to sweep
    const ecfActions = ['BLOCK', 'HALF_RISK'] as const;

    for (const t of tightness) {
        for (const ecfAction of ecfActions) {
            const guards: Record<string, unknown> = {
                lossStreakCooldown: { afterLosses: t.streakAfter, cooldownMinutes: baseCooldown },
                equityCurveFilter: { emaTrades: t.ecfTrades, action: ecfAction },
                maxDrawdownHalt: { maxDrawdownPct: t.ddPct },
            };

            // Session/day caps only for lower TFs
            if (!isHighTf) {
                guards.dayLossCap = { maxLosses: t.dayMaxLosses, maxNetR: t.dayMaxNetR };
            }
            if (isLowTf) {
                guards.sessionLossCap = { maxLosses: Math.max(1, t.dayMaxLosses - 1), maxNetR: t.dayMaxNetR - 1 };
                guards.entryBurstCooldown = {
                    maxEntriesInWindow: 3,
                    windowMinutes: baseCooldown / 2,
                    cooldownMinutes: baseCooldown,
                };
            }

            profiles.push({
                label: `${t.label}_ECF_${ecfAction}`,
                guards,
            });
        }
    }

    return profiles;
}

// ─── L3 Exit Ranges ──────────────────────────────────────────────────────────

interface ExitConfig {
    profiles: string[];
    maxBarsRange: ParamRange;
}

const L3_EXIT_CONFIG: Record<string, ExitConfig> = {
    M5: {
        profiles: ['FIXED_2R', 'BE_1R_TP_2R', 'XAU_NY_CLOSE', 'TIME_24'],
        maxBarsRange: autoStep(12, 72, 5),
    },
    M15: {
        profiles: ['FIXED_2R', 'BE_1R_TP_2R', 'PARTIAL_1R_BE_R3', 'XAU_NY_CLOSE'],
        maxBarsRange: autoStep(8, 48, 5),
    },
    M30: {
        profiles: ['BE_1R_TP_2R', 'PARTIAL_1R_BE_R3', 'BE_1R_TRAIL_2R_3R'],
        maxBarsRange: autoStep(6, 36, 5),
    },
    H1: {
        profiles: ['PARTIAL_1R_BE_R3', 'BE_1R_TRAIL_2R_3R', 'PARTIAL_1R_BE_SWING_TRAIL'],
        maxBarsRange: autoStep(6, 48, 6),
    },
    H4: {
        profiles: ['BE_1R_TRAIL_2R_3R', 'PARTIAL_1R_BE_SWING_TRAIL'],
        maxBarsRange: autoStep(4, 20, 4),
    },
    D1: {
        profiles: ['PARTIAL_1R_BE_SWING_TRAIL'],
        maxBarsRange: autoStep(3, 15, 4),
    },
};

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate L1 entry variants for a given timeframe.
 * Only generates variants for blocks that exist in the signal definition.
 * `presentBlocks` = Set of indicatorId values found in def.blocks
 */
export function generateEntryVariants(
    timeframe: string,
    presentBlocks: Set<string>,
    mutationHelpers: {
        setRsiPeriod: (def: unknown, value: number) => void;
        setRsiThreshold: (def: unknown, value: number) => void;
        setSlAtrPeriod: (def: unknown, value: number) => void;
        setAtrBufferMultiplier: (def: unknown, value: number) => void;
        setEmaFilterPeriod: (def: unknown, value: number) => void;
        setWindowBars: (def: unknown, value: number) => void;
        setSmcLookback: (def: unknown, value: number) => void;
        setFibLookback: (def: unknown, value: number) => void;
        addSessionFilter: (def: unknown) => void;
        removeSessionFilter: (def: unknown) => void;
    },
): EntryVariant[] {
    const ranges = L1_ENTRY_RANGES[timeframe];
    if (!ranges) throw new Error(`No entry ranges for timeframe: ${timeframe}`);

    const variants: EntryVariant[] = [];

    // Build per-param sweep lists
    const sweeps: Array<{ id: string; label: string; mutate: (def: unknown) => void }[]> = [];

    if (presentBlocks.has('RSI') && ranges.rsiPeriod) {
        const paramSweep = rangeValues(ranges.rsiPeriod).map((v) => ({
            id: `rsiP${v}`,
            label: `RSI(${v})`,
            mutate: (def: unknown) => mutationHelpers.setRsiPeriod(def, v),
        }));
        sweeps.push(paramSweep);
    }
    if (presentBlocks.has('RSI') && ranges.rsiThreshold) {
        const paramSweep = rangeValues(ranges.rsiThreshold).map((v) => ({
            id: `rsiT${v}`,
            label: `RSI_T(${v})`,
            mutate: (def: unknown) => mutationHelpers.setRsiThreshold(def, v),
        }));
        sweeps.push(paramSweep);
    }
    if (ranges.slAtrBufferMultiplier) {
        const paramSweep = rangeValues(ranges.slAtrBufferMultiplier).map((v) => ({
            id: `slBuf${v}`,
            label: `SL×${v}`,
            mutate: (def: unknown) => mutationHelpers.setAtrBufferMultiplier(def, v),
        }));
        sweeps.push(paramSweep);
    }
    if (ranges.windowBars) {
        const paramSweep = rangeValues(ranges.windowBars).map((v) => ({
            id: `w${v}`,
            label: `W${v}`,
            mutate: (def: unknown) => mutationHelpers.setWindowBars(def, v),
        }));
        sweeps.push(paramSweep);
    }

    if (presentBlocks.has('SMC') && ranges.smcLookback) {
        const paramSweep = rangeValues(ranges.smcLookback).map((v) => ({
            id: `smcLb${v}`,
            label: `SMC(${v})`,
            mutate: (def: unknown) => mutationHelpers.setSmcLookback(def, v),
        }));
        sweeps.push(paramSweep);
    }

    // Generate cartesian product of all sweep dimensions
    if (sweeps.length === 0) return [];

    const cartesian = cartesianProduct(sweeps);
    for (const combo of cartesian) {
        const id = combo.map((c) => c.id).join('_');
        const label = combo.map((c) => c.label).join('/');
        variants.push({
            id,
            label,
            mutate: (def: unknown) => {
                for (const c of combo) c.mutate(def);
            },
        });
    }

    // Session filter toggle (doubles variants for M5-M30)
    if (ranges.sweepSessionFilter) {
        const withSession = variants.map((v) => ({
            id: `${v.id}_SF`,
            label: `${v.label}/SF`,
            mutate: (def: unknown) => {
                v.mutate(def);
                mutationHelpers.addSessionFilter(def);
            },
        }));
        const withoutSession = variants.map((v) => ({
            id: `${v.id}_noSF`,
            label: `${v.label}/noSF`,
            mutate: (def: unknown) => {
                v.mutate(def);
                mutationHelpers.removeSessionFilter(def);
            },
        }));
        return [...withSession, ...withoutSession];
    }

    return variants;
}

/**
 * Generate L2 guard variants for a given timeframe.
 */
export function generateGuardVariants(timeframe: string): GuardVariant[] {
    const profiles = buildGuardProfiles(timeframe);
    return profiles.map((p) => ({
        id: p.label,
        label: p.label,
        guards: p.guards,
    }));
}

/**
 * Generate L3 exit variants for a given timeframe.
 */
export function generateExitVariants(timeframe: string): ExitVariant[] {
    const config = L3_EXIT_CONFIG[timeframe];
    if (!config) throw new Error(`No exit config for timeframe: ${timeframe}`);

    const variants: ExitVariant[] = [];
    const maxBarsValues = rangeValues(config.maxBarsRange);

    for (const profileCode of config.profiles) {
        for (const maxBars of maxBarsValues) {
            variants.push({
                id: `${profileCode}_mb${maxBars}`,
                label: `${profileCode}/maxBars=${maxBars}`,
                profileCode,
                maxBarsInTrade: Math.round(maxBars),
            });
        }
    }

    return variants;
}

/**
 * Count total variants for dry-run reporting.
 */
export function countVariants(
    timeframe: string,
    presentBlocks: Set<string>,
): { entry: number; guards: number; exit: number; total: number } {
    // Approximate entry count from ranges
    const ranges = L1_ENTRY_RANGES[timeframe];
    if (!ranges) return { entry: 0, guards: 0, exit: 0, total: 0 };

    let entryDimensions = 1;
    if (presentBlocks.has('RSI') && ranges.rsiPeriod) entryDimensions *= rangeValues(ranges.rsiPeriod).length;
    if (presentBlocks.has('RSI') && ranges.rsiThreshold) entryDimensions *= rangeValues(ranges.rsiThreshold).length;
    if (ranges.slAtrBufferMultiplier) entryDimensions *= rangeValues(ranges.slAtrBufferMultiplier).length;
    if (ranges.windowBars) entryDimensions *= rangeValues(ranges.windowBars).length;
    if (presentBlocks.has('SMC') && ranges.smcLookback) entryDimensions *= rangeValues(ranges.smcLookback).length;
    if (ranges.sweepSessionFilter) entryDimensions *= 2;

    const guards = generateGuardVariants(timeframe).length;
    const exit = generateExitVariants(timeframe).length;

    return {
        entry: entryDimensions,
        guards,
        exit,
        total: entryDimensions + guards + exit,
    };
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function cartesianProduct<T>(arrays: T[][]): T[][] {
    if (arrays.length === 0) return [[]];
    const [first, ...rest] = arrays;
    const restProduct = cartesianProduct(rest);
    const result: T[][] = [];
    for (const item of first) {
        for (const combo of restProduct) {
            result.push([item, ...combo]);
        }
    }
    return result;
}
