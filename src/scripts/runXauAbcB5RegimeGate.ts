import {
    DEFAULT_OUT_DIR,
    VariantSpec,
    addBullishMarketRegime,
    addPriceAboveEma,
    runVariantGroup,
} from './xauAbcOptimizationShared';

const VARIANTS: VariantSpec[] = [
    {
        id: 'b5_regime_bull_hard',
        label: 'B5 - Bullish regime gate + HARD_SIGNAL_TP',
        changeSummary: 'Add a same-timeframe bullish market regime gate as a proxy for the higher-timeframe bias filter.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            addBullishMarketRegime(definition);
        },
    },
    {
        id: 'b5_ema_hold_hard',
        label: 'B5 - EMA trend hold + HARD_SIGNAL_TP',
        changeSummary: 'Add an EMA price-above filter as a fast trend proxy on the M5 continuation lane.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            addPriceAboveEma(definition);
        },
    },
    {
        id: 'b5_regime_ema_combo_hard',
        label: 'B5 - Bullish regime + EMA hold + HARD_SIGNAL_TP',
        changeSummary: 'Stack the market regime and EMA-hold proxies to approximate a stricter MTF-style bias gate on M5.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            addBullishMarketRegime(definition);
            addPriceAboveEma(definition);
        },
    },
];

runVariantGroup({
    group: 'b5_regime_gate',
    groupLabel: 'B5 - M5 regime gate proxies',
    variants: VARIANTS,
    defaultOutPath: `${DEFAULT_OUT_DIR}/b5_regime_gate.json`,
    notes: [
        'B5 uses same-timeframe regime proxies because the current composed-signal engine evaluates all blocks on one timeframe.',
    ],
}).catch((error) => {
    console.error(error);
    process.exit(1);
});
