import {
    DEFAULT_OUT_DIR,
    VariantSpec,
    runVariantGroup,
    setAtrBufferMultiplier,
    setStopLookback,
    setTakeProfitMultiple,
} from './xauAbcOptimizationShared';

const VARIANTS: VariantSpec[] = [
    {
        id: 'b4_lookback48_hard',
        label: 'B4 - Stop lookback 48 + HARD_SIGNAL_TP',
        changeSummary: 'Tighten the M5 structure stop from 72 bars to 48 bars.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            setStopLookback(definition, 48);
        },
    },
    {
        id: 'b4_lookback60_hard',
        label: 'B4 - Stop lookback 60 + HARD_SIGNAL_TP',
        changeSummary: 'Tighten the M5 structure stop from 72 bars to 60 bars.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            setStopLookback(definition, 60);
        },
    },
    {
        id: 'b4_lookback96_hard',
        label: 'B4 - Stop lookback 96 + HARD_SIGNAL_TP',
        changeSummary: 'Loosen the M5 structure stop from 72 bars to 96 bars.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            setStopLookback(definition, 96);
        },
    },
    {
        id: 'b4_buffer015_hard',
        label: 'B4 - ATR buffer 0.15 + HARD_SIGNAL_TP',
        changeSummary: 'Reduce the M5 ATR stop buffer from 0.20 to 0.15.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            setAtrBufferMultiplier(definition, 0.15);
        },
    },
    {
        id: 'b4_buffer030_hard',
        label: 'B4 - ATR buffer 0.30 + HARD_SIGNAL_TP',
        changeSummary: 'Increase the M5 ATR stop buffer from 0.20 to 0.30.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            setAtrBufferMultiplier(definition, 0.3);
        },
    },
    {
        id: 'b4_tp25_hard',
        label: 'B4 - TP 2.5R + HARD_SIGNAL_TP',
        changeSummary: 'Raise the underlying M5 signal target from 2.0R to 2.5R while keeping hard management.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            setTakeProfitMultiple(definition, 2.5);
        },
    },
];

runVariantGroup({
    group: 'b4_stop_geometry',
    groupLabel: 'B4 - M5 stop and reward geometry sweep',
    variants: VARIANTS,
    defaultOutPath: `${DEFAULT_OUT_DIR}/b4_stop_geometry.json`,
}).catch((error) => {
    console.error(error);
    process.exit(1);
});
