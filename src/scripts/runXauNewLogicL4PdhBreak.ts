import { ExecutionConfigInput } from '../services/signals/types';
import {
    MetalHarnessConfig,
    MetalVariantSpec,
    applyM5Base,
    runMetalVariantGroup,
    setAtrMultiplier,
    setLondonSession,
    setRsiThreshold,
    setSignalAreaGuard,
    setStopLookback,
    setTakeProfitMultiple,
} from './metalOptimizationHarness';

const XAU_FROM = new Date('2019-01-01T00:00:00.000Z');
const XAU_TO = new Date('2026-03-14T23:59:59.999Z');

const GUARDED_EXECUTION_CONFIG: Partial<ExecutionConfigInput> = {
    tradeGuards: {
        lossStreakThrottle: {
            steps: [
                { afterLosses: 2, riskPercent: 0.5 },
                { afterLosses: 4, riskPercent: 0.25 },
            ],
        },
        sessionLossCap: { maxLosses: 2, maxNetR: 2 },
        dayLossCap: { maxNetR: 3 },
    },
};

const HARNESS: MetalHarnessConfig = {
    symbol: 'XAUUSD',
    from: XAU_FROM,
    to: XAU_TO,
    initialEquity: 10_000,
    riskPercent: 2,
    baseSignalCode: 'SYS_XAU_PDH_BREAK_LONG',
    defaultOutDir: '.artifacts/xau-new-logics-2026-03-16',
    codePrefix: 'XAUL4',
    defaultExecutionConfig: {
        entryFeeBps: 4,
        exitFeeBps: 4,
        entrySlippageBps: 2,
        exitSlippageBps: 2,
        orderTiming: 'NEXT_BAR_OPEN',
        stopLoss: { mode: 'SIGNAL_PRICE' },
        takeProfit: { mode: 'SIGNAL_PRICE' },
        positionSizing: { mode: 'RISK_BASED' },
    },
};

const VARIANTS: MetalVariantSpec[] = [
    {
        id: 'l4_m5_rsi55_tp25_hard',
        label: 'L4 — M5 PDH break, RSI 55, TP 2.5R, hard exit',
        changeSummary: 'Base M5 run. Close above PDH during London, ATR expansion, RSI >= 55. 2.5R hard exit.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setTakeProfitMultiple(definition, 2.5);
        },
    },
    {
        id: 'l4_m5_rsi58_tp25_hard',
        label: 'L4 — M5 PDH break, RSI 58, TP 2.5R, hard exit',
        changeSummary: 'Raise RSI gate to 58. Stronger momentum confirmation on PDH break bar.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setRsiThreshold(definition, 58);
            setTakeProfitMultiple(definition, 2.5);
        },
    },
    {
        id: 'l4_m5_rsi55_tp20_hard',
        label: 'L4 — M5 PDH break, RSI 55, TP 2.0R, hard exit',
        changeSummary: 'Conservative 2.0R target. Tests if shorter target improves WR on PDH breaks.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setTakeProfitMultiple(definition, 2.0);
        },
    },
    {
        id: 'l4_m5_rsi55_tp25_swing',
        label: 'L4 — M5 PDH break, RSI 55, swing trail exit',
        changeSummary: 'Swing trail on PDH breaks. Tests if institutional-level breakout sustains for a runner.',
        exitProfile: 'PARTIAL_1R_BE_SWING_TRAIL',
        mutate(definition) {
            applyM5Base(definition, 72, 24);
        },
    },
    {
        id: 'l4_m5_rsi55_atr130_tp25',
        label: 'L4 — M5 PDH break, RSI 55, ATR 1.30, TP 2.5R',
        changeSummary: 'Wider ATR gate (1.30x) to reduce false pokes at PDH on low-volatility days.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setAtrMultiplier(definition, 1.3);
            setTakeProfitMultiple(definition, 2.5);
        },
    },
    {
        id: 'l4_m5_rsi58_atr130_tp25',
        label: 'L4 — M5 PDH break, RSI 58, ATR 1.30, TP 2.5R',
        changeSummary: 'Combined RSI 58 + ATR 1.30 quality stack. Highest quality filter — expects lower volume, higher WR.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setRsiThreshold(definition, 58);
            setAtrMultiplier(definition, 1.3);
            setTakeProfitMultiple(definition, 2.5);
        },
    },
    {
        id: 'l4_m5_rsi55_tp25_cap3',
        label: 'L4 — M5 PDH break, RSI 55, TP 2.5R, area cap 3',
        changeSummary: 'Tight area cap (3 per zone) at the PDH level. Prevents repeated re-entries at the same daily high.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setTakeProfitMultiple(definition, 2.5);
            setSignalAreaGuard(definition, { maxSignalsPerArea: 3, resetBars: 8, priceDistanceR: 1.0 });
        },
    },
    {
        id: 'l4_m5_rsi55_lb96_tp25',
        label: 'L4 — M5 PDH break, RSI 55, lookback 96, TP 2.5R',
        changeSummary: 'Wider stop lookback (96 bars) for a deeper structural stop. Reduces stop-outs on volatile PDH pokes.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            applyM5Base(definition, 96, 24);
            setTakeProfitMultiple(definition, 2.5);
        },
    },
    {
        id: 'l4_m5_early_london_rsi55_tp25',
        label: 'L4 — M5 PDH break, early London 07–10, RSI 55, TP 2.5R',
        changeSummary: 'Narrow to early London 07:00–10:00 UTC where institutional PDH breaks are most reliable.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setLondonSession(definition, 7, 10);
            setTakeProfitMultiple(definition, 2.5);
        },
    },
    {
        id: 'l4_m5_rsi55_tp25_guarded',
        label: 'L4 — M5 PDH break, RSI 55, TP 2.5R, trade guards',
        changeSummary: 'Apply loss-streak throttle and session/day caps on best base variant.',
        exitProfile: 'HARD_SIGNAL_TP',
        riskPercent: 1,
        executionConfigOverride: GUARDED_EXECUTION_CONFIG,
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setTakeProfitMultiple(definition, 2.5);
        },
    },
    {
        id: 'l4_m15_rsi55_tp25_hard',
        label: 'L4 — M15 PDH break, RSI 55, TP 2.5R, hard exit',
        changeSummary: 'M15 baseline. Higher-conviction PDH breaks only, stop lookback 24 bars.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            setStopLookback(definition, 24);
            setTakeProfitMultiple(definition, 2.5);
        },
    },
    {
        id: 'l4_m15_rsi58_tp25_hard',
        label: 'L4 — M15 PDH break, RSI 58, TP 2.5R, hard exit',
        changeSummary: 'M15 with stricter RSI 58 gate. Best quality M15 PDH break candidate.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            setStopLookback(definition, 24);
            setRsiThreshold(definition, 58);
            setTakeProfitMultiple(definition, 2.5);
        },
    },
];

const GROUPS = {
    m5_base: {
        label: 'M5 base RSI sweep (RSI 55 vs 58)',
        variants: ['l4_m5_rsi55_tp25_hard', 'l4_m5_rsi58_tp25_hard'],
    },
    m5_full: {
        label: 'Full M5 variant set',
        variants: ['l4_m5_rsi55_tp25_hard', 'l4_m5_rsi58_tp25_hard', 'l4_m5_rsi55_tp20_hard', 'l4_m5_rsi55_tp25_swing', 'l4_m5_rsi55_atr130_tp25', 'l4_m5_rsi58_atr130_tp25', 'l4_m5_rsi55_tp25_cap3', 'l4_m5_rsi55_lb96_tp25', 'l4_m5_early_london_rsi55_tp25', 'l4_m5_rsi55_tp25_guarded'],
    },
    m15: {
        label: 'M15 variants',
        variants: ['l4_m15_rsi55_tp25_hard', 'l4_m15_rsi58_tp25_hard'],
    },
    all: {
        label: 'All L4 PDH Break variants',
        variants: VARIANTS.map((v) => v.id),
    },
} satisfies Record<string, { label: string; variants: string[] }>;

function printUsage() {
    console.log([
        'Usage:',
        '  npx ts-node src/scripts/runXauNewLogicL4PdhBreak.ts --list-groups',
        '  npx ts-node src/scripts/runXauNewLogicL4PdhBreak.ts --group all',
        '',
        `Available groups: ${Object.keys(GROUPS).join(', ')}`,
    ].join('\n'));
}

function parseArgs(argv: string[]) {
    const result: { listGroups: boolean; group: keyof typeof GROUPS } = {
        listGroups: false,
        group: 'all',
    };
    for (let i = 0; i < argv.length; i += 1) {
        if (argv[i] === '--list-groups') { result.listGroups = true; continue; }
        if (argv[i] === '--group') {
            const val = argv[i + 1];
            if (!val || !(val in GROUPS)) throw new Error(`Unknown --group "${val ?? ''}".`);
            result.group = val as keyof typeof GROUPS;
            i += 1; continue;
        }
        if (argv[i] === '--out') { i += 1; continue; }
        throw new Error(`Unknown argument "${argv[i]}".`);
    }
    return result;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.listGroups) {
        for (const [k, g] of Object.entries(GROUPS)) {
            console.log(`- ${k}: ${g.label} (${g.variants.join(', ')})`);
        }
        return;
    }
    const selectedGroup = GROUPS[args.group];
    const variants = VARIANTS.filter((v) => selectedGroup.variants.includes(v.id));
    await runMetalVariantGroup({
        harness: HARNESS,
        group: args.group,
        groupLabel: selectedGroup.label,
        variants,
        defaultOutPath: `${HARNESS.defaultOutDir}/l4_pdh_break_${args.group}.json`,
        notes: [
            'Logic L4: Prior Day High Break — closes above PDH during London, RSI >= 55, ATR expansion.',
            'Priority 1 new logic. Base signal: SYS_XAU_PDH_BREAK_LONG. Proposed 2026-03-16.',
        ],
    });
}

main().catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : err);
    printUsage();
    process.exit(1);
});
