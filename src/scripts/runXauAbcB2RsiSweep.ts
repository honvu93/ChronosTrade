import {
    DEFAULT_OUT_DIR,
    VariantSpec,
    runVariantGroup,
    setAtrMultiplier,
    setRsiThreshold,
} from './xauAbcOptimizationShared';

const VARIANTS: VariantSpec[] = [
    {
        id: 'b2_rsi56_hard',
        label: 'B2 - RSI 56 + HARD_SIGNAL_TP',
        changeSummary: 'Run the M5 continuation lane with RSI threshold raised from 55 to 56.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            setRsiThreshold(definition, 56);
        },
    },
    {
        id: 'b2_rsi58_hard',
        label: 'B2 - RSI 58 + HARD_SIGNAL_TP',
        changeSummary: 'Run the M5 continuation lane with RSI threshold raised from 55 to 58.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            setRsiThreshold(definition, 58);
        },
    },
    {
        id: 'b2_rsi56_atr130_hard',
        label: 'B2 - RSI 56 + ATR 1.30 + HARD_SIGNAL_TP',
        changeSummary: 'Combine the lighter RSI filter with ATR 1.30 on the M5 continuation lane.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            setRsiThreshold(definition, 56);
            setAtrMultiplier(definition, 1.3);
        },
    },
    {
        id: 'b2_rsi58_atr130_hard',
        label: 'B2 - RSI 58 + ATR 1.30 + HARD_SIGNAL_TP',
        changeSummary: 'Combine the stronger RSI filter with ATR 1.30 on the M5 continuation lane.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            setRsiThreshold(definition, 58);
            setAtrMultiplier(definition, 1.3);
        },
    },
];

runVariantGroup({
    group: 'b2_rsi_sweep',
    groupLabel: 'B2 - M5 RSI and ATR gate sweep',
    variants: VARIANTS,
    defaultOutPath: `${DEFAULT_OUT_DIR}/b2_rsi_sweep.json`,
}).catch((error) => {
    console.error(error);
    process.exit(1);
});
