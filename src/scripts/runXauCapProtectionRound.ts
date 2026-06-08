import {
    applyM5Base,
    setAtrMultiplier,
    setSignalAreaGuard,
    setStopLookback,
    BASE_SIGNAL_CODE,
} from './xauAbcOptimizationShared';
import {
    runMetalVariantGroup,
    MetalHarnessConfig,
    MetalVariantSpec,
} from './metalOptimizationHarness';
import { ExecutionConfigInput } from '../services/signals/types';

const FROM = new Date('2019-01-01T00:00:00.000Z');
const TO = new Date('2026-03-14T23:59:59.999Z');
const SYMBOL = 'XAUUSD';
const INITIAL_EQUITY = 10_000;
const OUT_DIR = '.artifacts/xau-cap-protection-round';
const DEFAULT_OUT_PATH = `${OUT_DIR}/all.json`;

const DEFAULT_EXEC: ExecutionConfigInput = {
    entryFeeBps: 4,
    exitFeeBps: 4,
    entrySlippageBps: 2,
    exitSlippageBps: 2,
    orderTiming: 'NEXT_BAR_OPEN',
    stopLoss: { mode: 'SIGNAL_PRICE' },
    takeProfit: { mode: 'SIGNAL_PRICE' },
    positionSizing: { mode: 'RISK_BASED' },
};

const GUARDS_CP1: ExecutionConfigInput['tradeGuards'] = {
    lossStreakThrottle: {
        steps: [
            { afterLosses: 3, riskPercent: 1.0 },
            { afterLosses: 5, riskPercent: 0.5 },
        ],
    },
    sessionLossCap: { maxLosses: 2, maxNetR: 2 },
    dayLossCap: { maxNetR: 3 },
};

const GUARDS_CP3: ExecutionConfigInput['tradeGuards'] = {
    lossStreakThrottle: {
        steps: [
            { afterLosses: 2, riskPercent: 0.75 },
            { afterLosses: 4, riskPercent: 0.35 },
        ],
    },
    sessionLossCap: { maxLosses: 3, maxNetR: 3 },
    dayLossCap: { maxNetR: 3 },
};

function applyLb96Geometry(definition: Parameters<MetalVariantSpec['mutate']>[0]) {
    applyM5Base(definition);
    setSignalAreaGuard(definition, { maxSignalsPerArea: 5, resetBars: 8, priceDistanceR: 0.75 });
    setAtrMultiplier(definition, 1.15);
    setStopLookback(definition, 96);
    definition.exitManagement = { profileCode: 'HARD_SIGNAL_TP' };
}

const VARIANTS: MetalVariantSpec[] = [
    {
        id: 'cp0_lb96_base',
        label: 'CP0 — LB96 baseline (no guards)',
        changeSummary: 'Reference baseline: M5, area cap 5, reset 8, 0.75R, ATR 1.15, stop lookback 96, HARD_SIGNAL_TP, risk 2%. No trade guards.',
        exitProfile: 'HARD_SIGNAL_TP',
        riskPercent: 2,
        mutate(definition) {
            applyLb96Geometry(definition);
        },
    },
    {
        id: 'cp1_daily_cap',
        label: 'CP1 — daily loss cap (guards v1)',
        changeSummary: 'LB96 geometry + loss-streak throttle (3→1%, 5→0.5%), session loss cap (2 losses / 2R), day loss cap (3R). Risk 2%.',
        exitProfile: 'HARD_SIGNAL_TP',
        riskPercent: 2,
        executionConfigOverride: { tradeGuards: GUARDS_CP1 },
        mutate(definition) {
            applyLb96Geometry(definition);
        },
    },
    {
        id: 'cp2_risk15_cap',
        label: 'CP2 — lower risk 1.5% + guards v1',
        changeSummary: 'Same as CP1 but risk reduced to 1.5%. Smaller position size may cut equity DD further.',
        exitProfile: 'HARD_SIGNAL_TP',
        riskPercent: 1.5,
        executionConfigOverride: { tradeGuards: GUARDS_CP1 },
        mutate(definition) {
            applyLb96Geometry(definition);
        },
    },
    {
        id: 'cp3_session3',
        label: 'CP3 — tighter streak throttle + session cap 3',
        changeSummary: 'LB96 geometry + tighter streak throttle (2→0.75%, 4→0.35%), session loss cap (3 losses / 3R), day loss cap (3R). Risk 2%.',
        exitProfile: 'HARD_SIGNAL_TP',
        riskPercent: 2,
        executionConfigOverride: { tradeGuards: GUARDS_CP3 },
        mutate(definition) {
            applyLb96Geometry(definition);
        },
    },
    {
        id: 'cp4_area2_guard',
        label: 'CP4 — tighter area cap 2 + guards v1',
        changeSummary: 'Guards v1 + area cap tightened to maxSignalsPerArea=2. Should reduce overtrading near congestion zones.',
        exitProfile: 'HARD_SIGNAL_TP',
        riskPercent: 2,
        executionConfigOverride: { tradeGuards: GUARDS_CP1 },
        mutate(definition) {
            applyM5Base(definition);
            setSignalAreaGuard(definition, { maxSignalsPerArea: 2, resetBars: 8, priceDistanceR: 0.75 });
            setAtrMultiplier(definition, 1.15);
            setStopLookback(definition, 96);
            definition.exitManagement = { profileCode: 'HARD_SIGNAL_TP' };
        },
    },
];

const HARNESS: MetalHarnessConfig = {
    symbol: SYMBOL,
    from: FROM,
    to: TO,
    initialEquity: INITIAL_EQUITY,
    riskPercent: 2,
    baseSignalCode: BASE_SIGNAL_CODE,
    defaultOutDir: OUT_DIR,
    codePrefix: 'XCPR',
    defaultExecutionConfig: DEFAULT_EXEC,
};

runMetalVariantGroup({
    harness: HARNESS,
    group: 'xau_cap_protection_round',
    groupLabel: 'XAU M5 CAP5 LB96 — Capital Protection Round',
    variants: VARIANTS,
    defaultOutPath: DEFAULT_OUT_PATH,
    notes: [
        'Candidate: XAU_ABC_M5_CAP5_LB96_REVIEW@1 (NetPnL ~79,523 | WR 50.95% | Equity DD 32.84%)',
        'Goal: keep Net PnL > 60k while reducing equity curve DD to ≤ 20%.',
        'CP0 is the reference baseline (no guards).',
        'CP1/CP2/CP3/CP4 add progressive capital-protection layers.',
    ],
}).catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
