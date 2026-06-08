import { DEFAULT_OUT_DIR, VariantSpec, runVariantGroup, setAtrMultiplier } from './xauAbcOptimizationShared';

const VARIANTS: VariantSpec[] = [
    {
        id: 'b1_atr125_hard',
        label: 'B1 - ATR 1.25 + HARD_SIGNAL_TP',
        changeSummary: 'Run the M5 continuation lane with ATR expansion multiplier raised from 1.20 to 1.25.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            setAtrMultiplier(definition, 1.25);
        },
    },
    {
        id: 'b1_atr130_hard',
        label: 'B1 - ATR 1.30 + HARD_SIGNAL_TP',
        changeSummary: 'Run the M5 continuation lane with ATR expansion multiplier raised from 1.20 to 1.30.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            setAtrMultiplier(definition, 1.3);
        },
    },
    {
        id: 'b1_atr135_hard',
        label: 'B1 - ATR 1.35 + HARD_SIGNAL_TP',
        changeSummary: 'Run the M5 continuation lane with ATR expansion multiplier raised from 1.20 to 1.35.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            setAtrMultiplier(definition, 1.35);
        },
    },
];

runVariantGroup({
    group: 'b1_atr_sweep',
    groupLabel: 'B1 - M5 ATR multiplier sweep',
    variants: VARIANTS,
    defaultOutPath: `${DEFAULT_OUT_DIR}/b1_atr_sweep.json`,
}).catch((error) => {
    console.error(error);
    process.exit(1);
});
