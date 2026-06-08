import {
    DEFAULT_OUT_DIR,
    VariantSpec,
    runVariantGroup,
    setAtrMultiplier,
    setSignalAreaGuard,
} from './xauAbcOptimizationShared';

const buildAreaGuardVariant = (
    id: string,
    label: string,
    changeSummary: string,
    maxSignalsPerArea: number,
    resetBars: number,
    priceDistanceR: number,
    atrMultiplier?: number,
): VariantSpec => ({
    id,
    label,
    changeSummary,
    exitProfile: 'HARD_SIGNAL_TP',
    mutate(definition) {
        setSignalAreaGuard(definition, {
            maxSignalsPerArea,
            resetBars,
            priceDistanceR,
        });
        if (atrMultiplier !== undefined) {
            setAtrMultiplier(definition, atrMultiplier);
        }
    },
});

const VARIANTS: VariantSpec[] = [
    buildAreaGuardVariant(
        'cap5_geom_b8_r075_hard',
        'Area cap 5 + reset 8 + 0.75R',
        'Limit each area to 5 entries, but reset after 8 bars or a tighter 0.75R price dislocation.',
        5,
        8,
        0.75,
    ),
    buildAreaGuardVariant(
        'cap5_geom_b12_r075_hard',
        'Area cap 5 + reset 12 + 0.75R',
        'Limit each area to 5 entries, reset after 12 bars or a tighter 0.75R price dislocation.',
        5,
        12,
        0.75,
    ),
    buildAreaGuardVariant(
        'cap5_geom_b12_r100_hard',
        'Area cap 5 + reset 12 + 1.00R',
        'Limit each area to 5 entries, reset after 12 bars or a 1.00R price dislocation.',
        5,
        12,
        1,
    ),
    buildAreaGuardVariant(
        'cap5_geom_b8_r075_atr115_hard',
        'Area cap 5 + reset 8 + 0.75R + ATR 1.15',
        'Use the tighter area geometry plus ATR 1.15 to recover more distinct continuation areas.',
        5,
        8,
        0.75,
        1.15,
    ),
    buildAreaGuardVariant(
        'cap5_geom_b12_r075_atr115_hard',
        'Area cap 5 + reset 12 + 0.75R + ATR 1.15',
        'Use the tighter area geometry plus ATR 1.15 to recover more distinct continuation areas.',
        5,
        12,
        0.75,
        1.15,
    ),
    buildAreaGuardVariant(
        'cap5_geom_b12_r100_atr115_hard',
        'Area cap 5 + reset 12 + 1.00R + ATR 1.15',
        'Use the medium area geometry plus ATR 1.15 to recover more distinct continuation areas.',
        5,
        12,
        1,
        1.15,
    ),
];

runVariantGroup({
    group: 'm5_area_cap_geometry_opt',
    groupLabel: 'M5 area-cap geometry optimization',
    variants: VARIANTS,
    defaultOutPath: `${DEFAULT_OUT_DIR}/m5_area_cap_geometry_opt.json`,
    notes: [
        'This batch focuses on redefining what counts as one signal area before changing the entry stack further.',
        'Goal: keep the 3-5 entries-per-area principle without collapsing trade count as hard as the first cap batch.',
    ],
}).catch((error) => {
    console.error(error);
    process.exit(1);
});
