import { ExecutionConfigInput } from '../services/signals/types';
import {
    MetalHarnessConfig,
    MetalVariantSpec,
    applyM5Base,
    runMetalVariantGroup,
    setAtrMultiplier,
    setSignalAreaGuard,
    setStopLookback,
    setTakeProfitMultiple,
} from './metalOptimizationHarness';

// Smart Trail Confirmation has only been tested at M15. This runner explores M5.
// Base seed: SYS_XAU_SMART_TRAIL_CONFIRM_LONG
// Blocks: SMART_TRAIL_SWITCH (bullish_switch) + CONFIRMATION_TREND (uptrend) + TREND_CATCHER (bearish pullback filter)

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
    baseSignalCode: 'SYS_XAU_SMART_TRAIL_CONFIRM_LONG',
    defaultOutDir: '.artifacts/xau-new-logics-2026-03-16',
    codePrefix: 'XAUL5',
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
        id: 'l5_m5_tp25_hard',
        label: 'L5 — M5 Smart Trail confirm, TP 2.5R, hard exit',
        changeSummary: 'Base M5 Smart Trail run. Smart Trail bullish flip + confirmation uptrend + pullback filter. 2.5R hard exit, lookback 72.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setTakeProfitMultiple(definition, 2.5);
        },
    },
    {
        id: 'l5_m5_tp20_hard',
        label: 'L5 — M5 Smart Trail confirm, TP 2.0R, hard exit',
        changeSummary: 'Conservative 2.0R target on M5 Smart Trail. Tests if tighter target raises WR enough.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setTakeProfitMultiple(definition, 2.0);
        },
    },
    {
        id: 'l5_m5_tp25_swing',
        label: 'L5 — M5 Smart Trail confirm, swing trail exit',
        changeSummary: 'Swing trail on M5 Smart Trail flips. Tests if trend continuation after a flip deserves a runner.',
        exitProfile: 'PARTIAL_1R_BE_SWING_TRAIL',
        mutate(definition) {
            applyM5Base(definition, 72, 24);
        },
    },
    {
        id: 'l5_m5_tp25_be2r',
        label: 'L5 — M5 Smart Trail confirm, BE at 1R + TP 2R',
        changeSummary: 'Break-even protection at 1R then target 2R. Defensive variant for Smart Trail M5.',
        exitProfile: 'BE_1R_TP_2R',
        mutate(definition) {
            applyM5Base(definition, 72, 24);
        },
    },
    {
        id: 'l5_m5_lb96_tp25',
        label: 'L5 — M5 Smart Trail confirm, lookback 96, TP 2.5R',
        changeSummary: 'Widen stop lookback to 96 bars on M5. Structural stop farther away — reduces noise stop-outs.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            applyM5Base(definition, 96, 24);
            setTakeProfitMultiple(definition, 2.5);
        },
    },
    {
        id: 'l5_m5_atr115_tp25',
        label: 'L5 — M5 Smart Trail confirm, ATR gate 1.15x (passthrough), TP 2.5R',
        changeSummary: 'No ATR block in Smart Trail base — add area cap only. ATR not part of this signal family.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setTakeProfitMultiple(definition, 2.5);
            setSignalAreaGuard(definition, { maxSignalsPerArea: 5, resetBars: 8, priceDistanceR: 0.75 });
        },
    },
    {
        id: 'l5_m5_tp25_cap3',
        label: 'L5 — M5 Smart Trail confirm, area cap 3, TP 2.5R',
        changeSummary: 'Tighter area cap (3 per zone). Smart Trail flips can cluster on trending days — cap limits repeat entries.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setTakeProfitMultiple(definition, 2.5);
            setSignalAreaGuard(definition, { maxSignalsPerArea: 3, resetBars: 8, priceDistanceR: 0.75 });
        },
    },
    {
        id: 'l5_m5_tp25_guarded',
        label: 'L5 — M5 Smart Trail confirm, TP 2.5R, trade guards',
        changeSummary: 'Apply full loss-streak and session/day guards on base M5 Smart Trail.',
        exitProfile: 'HARD_SIGNAL_TP',
        riskPercent: 1,
        executionConfigOverride: GUARDED_EXECUTION_CONFIG,
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setTakeProfitMultiple(definition, 2.5);
        },
    },
    {
        id: 'l5_m5_lb96_cap5_tp25_guarded',
        label: 'L5 — M5 Smart Trail, lookback 96 + cap 5 + guards, TP 2.5R',
        changeSummary: 'Combined quality stack: wider stop, area cap, and trade guards. Tests the full protected M5 Smart Trail lane.',
        exitProfile: 'HARD_SIGNAL_TP',
        riskPercent: 1,
        executionConfigOverride: GUARDED_EXECUTION_CONFIG,
        mutate(definition) {
            applyM5Base(definition, 96, 24);
            setTakeProfitMultiple(definition, 2.5);
            setSignalAreaGuard(definition, { maxSignalsPerArea: 5, resetBars: 8, priceDistanceR: 0.75 });
        },
    },
    {
        id: 'l5_m15_tp25_hard',
        label: 'L5 — M15 Smart Trail confirm, TP 2.5R, hard exit',
        changeSummary: 'M15 baseline (existing timeframe for Smart Trail). Included for direct comparison with M5 variants.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            setStopLookback(definition, 24);
            setTakeProfitMultiple(definition, 2.5);
        },
    },
    {
        id: 'l5_m15_tp25_swing',
        label: 'L5 — M15 Smart Trail confirm, swing trail exit',
        changeSummary: 'M15 swing trail — direct comparison reference from existing Smart Trail M15 research.',
        exitProfile: 'PARTIAL_1R_BE_SWING_TRAIL',
        mutate(definition) {
            setStopLookback(definition, 24);
        },
    },
];

const GROUPS = {
    m5_base: {
        label: 'M5 base TP sweep (2.0R vs 2.5R)',
        variants: ['l5_m5_tp20_hard', 'l5_m5_tp25_hard'],
    },
    m5_exit_sweep: {
        label: 'M5 exit profile sweep',
        variants: ['l5_m5_tp25_hard', 'l5_m5_tp25_swing', 'l5_m5_tp25_be2r'],
    },
    m5_full: {
        label: 'Full M5 variant set',
        variants: ['l5_m5_tp25_hard', 'l5_m5_tp20_hard', 'l5_m5_tp25_swing', 'l5_m5_tp25_be2r', 'l5_m5_lb96_tp25', 'l5_m5_atr115_tp25', 'l5_m5_tp25_cap3', 'l5_m5_tp25_guarded', 'l5_m5_lb96_cap5_tp25_guarded'],
    },
    m15: {
        label: 'M15 reference variants',
        variants: ['l5_m15_tp25_hard', 'l5_m15_tp25_swing'],
    },
    all: {
        label: 'All L5 Smart Trail M5 variants',
        variants: VARIANTS.map((v) => v.id),
    },
} satisfies Record<string, { label: string; variants: string[] }>;

function printUsage() {
    console.log([
        'Usage:',
        '  npx ts-node src/scripts/runXauNewLogicL5SmartTrailM5.ts --list-groups',
        '  npx ts-node src/scripts/runXauNewLogicL5SmartTrailM5.ts --group all',
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
        defaultOutPath: `${HARNESS.defaultOutDir}/l5_smart_trail_m5_${args.group}.json`,
        notes: [
            'Logic L5: Smart Trail Confirmation at M5 — first M5 exploration of the Smart Trail flip signal family.',
            'Base signal: SYS_XAU_SMART_TRAIL_CONFIRM_LONG. M15 reference variants included for comparison. Proposed 2026-03-16.',
        ],
    });
}

main().catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : err);
    printUsage();
    process.exit(1);
});
