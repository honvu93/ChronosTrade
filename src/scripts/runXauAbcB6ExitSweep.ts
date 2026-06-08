import { DEFAULT_OUT_DIR, VariantSpec, runVariantGroup } from './xauAbcOptimizationShared';

const VARIANTS: VariantSpec[] = [
    {
        id: 'b6_be1r_tp2r',
        label: 'B6 - BE 1R / TP 2R',
        changeSummary: 'Run the M5 continuation lane with break-even at 1R and a fixed 2R target.',
        exitProfile: 'BE_1R_TP_2R',
        mutate() {},
    },
    {
        id: 'b6_be1r_trail_2r_3r',
        label: 'B6 - BE 1R / Trail at 2R and 3R',
        changeSummary: 'Run the M5 continuation lane with staged stop ratcheting after 1R, 2R, and 3R milestones.',
        exitProfile: 'BE_1R_TRAIL_2R_3R',
        mutate() {},
    },
    {
        id: 'b6_time24',
        label: 'B6 - Time Stop 24 Bars',
        changeSummary: 'Run the M5 continuation lane with the TIME_24 profile to force-close stalled trades after 24 bars.',
        exitProfile: 'TIME_24',
        mutate() {},
    },
    {
        id: 'b6_swing',
        label: 'B6 - Partial 1R / BE / Swing Trail',
        changeSummary: 'Re-run the M5 quality exit as an in-batch reference for the expanded exit sweep.',
        exitProfile: 'PARTIAL_1R_BE_SWING_TRAIL',
        mutate() {},
    },
];

runVariantGroup({
    group: 'b6_exit_sweep',
    groupLabel: 'B6 - M5 exit profile sweep',
    variants: VARIANTS,
    defaultOutPath: `${DEFAULT_OUT_DIR}/b6_exit_sweep.json`,
}).catch((error) => {
    console.error(error);
    process.exit(1);
});
