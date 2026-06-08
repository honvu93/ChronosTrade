import {
    DEFAULT_OUT_DIR,
    VariantSpec,
    runVariantGroup,
    setAtrMultiplier,
    setRsiThreshold,
    setSignalAreaGuard,
} from './xauAbcOptimizationShared';

const AREA_RESET_BARS = 18;
const AREA_PRICE_DISTANCE_R = 1.25;

const withAreaCap = (definition: Parameters<VariantSpec['mutate']>[0], maxSignalsPerArea: number) => {
    setSignalAreaGuard(definition, {
        maxSignalsPerArea,
        resetBars: AREA_RESET_BARS,
        priceDistanceR: AREA_PRICE_DISTANCE_R,
    });
};

const VARIANTS: VariantSpec[] = [
    {
        id: 'cap3_base_hard',
        label: 'Area cap 3 + HARD_SIGNAL_TP',
        changeSummary: 'Limit each M5 signal area to 3 entries, reset after 18 bars or a 1.25R price dislocation.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            withAreaCap(definition, 3);
        },
    },
    {
        id: 'cap5_base_hard',
        label: 'Area cap 5 + HARD_SIGNAL_TP',
        changeSummary: 'Limit each M5 signal area to 5 entries, reset after 18 bars or a 1.25R price dislocation.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            withAreaCap(definition, 5);
        },
    },
    {
        id: 'cap3_rsi54_hard',
        label: 'Area cap 3 + RSI 54 + HARD_SIGNAL_TP',
        changeSummary: 'Area cap 3 with a lighter RSI 54 threshold to recover trade count from more distinct areas.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            withAreaCap(definition, 3);
            setRsiThreshold(definition, 54);
        },
    },
    {
        id: 'cap5_rsi54_hard',
        label: 'Area cap 5 + RSI 54 + HARD_SIGNAL_TP',
        changeSummary: 'Area cap 5 with a lighter RSI 54 threshold to recover trade count from more distinct areas.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            withAreaCap(definition, 5);
            setRsiThreshold(definition, 54);
        },
    },
    {
        id: 'cap3_rsi56_hard',
        label: 'Area cap 3 + RSI 56 + HARD_SIGNAL_TP',
        changeSummary: 'Area cap 3 with slightly stronger RSI 56 momentum confirmation.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            withAreaCap(definition, 3);
            setRsiThreshold(definition, 56);
        },
    },
    {
        id: 'cap5_rsi56_hard',
        label: 'Area cap 5 + RSI 56 + HARD_SIGNAL_TP',
        changeSummary: 'Area cap 5 with slightly stronger RSI 56 momentum confirmation.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            withAreaCap(definition, 5);
            setRsiThreshold(definition, 56);
        },
    },
    {
        id: 'cap3_atr115_hard',
        label: 'Area cap 3 + ATR 1.15 + HARD_SIGNAL_TP',
        changeSummary: 'Area cap 3 with a lighter ATR expansion gate at 1.15 to find more distinct continuation areas.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            withAreaCap(definition, 3);
            setAtrMultiplier(definition, 1.15);
        },
    },
    {
        id: 'cap5_atr115_hard',
        label: 'Area cap 5 + ATR 1.15 + HARD_SIGNAL_TP',
        changeSummary: 'Area cap 5 with a lighter ATR expansion gate at 1.15 to find more distinct continuation areas.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            withAreaCap(definition, 5);
            setAtrMultiplier(definition, 1.15);
        },
    },
    {
        id: 'cap3_rsi54_atr115_hard',
        label: 'Area cap 3 + RSI 54 + ATR 1.15 + HARD_SIGNAL_TP',
        changeSummary: 'Area cap 3 plus lighter RSI 54 and ATR 1.15 gates to restore trade count after clustering is removed.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            withAreaCap(definition, 3);
            setRsiThreshold(definition, 54);
            setAtrMultiplier(definition, 1.15);
        },
    },
    {
        id: 'cap5_rsi54_atr115_hard',
        label: 'Area cap 5 + RSI 54 + ATR 1.15 + HARD_SIGNAL_TP',
        changeSummary: 'Area cap 5 plus lighter RSI 54 and ATR 1.15 gates to restore trade count after clustering is removed.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            withAreaCap(definition, 5);
            setRsiThreshold(definition, 54);
            setAtrMultiplier(definition, 1.15);
        },
    },
];

runVariantGroup({
    group: 'm5_area_cap_entry_opt',
    groupLabel: 'M5 area-cap and entry-gate optimization',
    variants: VARIANTS,
    defaultOutPath: `${DEFAULT_OUT_DIR}/m5_area_cap_entry_opt.json`,
    notes: [
        'Signal-area cap tries to suppress M5 re-entries in the same breakout zone.',
        `Each area resets after ${AREA_RESET_BARS} bars or a ${AREA_PRICE_DISTANCE_R}R price dislocation.`,
    ],
}).catch((error) => {
    console.error(error);
    process.exit(1);
});
