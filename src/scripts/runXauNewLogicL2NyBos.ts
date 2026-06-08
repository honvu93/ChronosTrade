import { ExecutionConfigInput } from '../services/signals/types';
import {
    MetalHarnessConfig,
    MetalVariantSpec,
    applyM5Base,
    runMetalVariantGroup,
    setAtrMultiplier,
    setLondonSession,
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
    baseSignalCode: 'SYS_XAU_NY_SESSION_BOS_LONG',
    defaultOutDir: '.artifacts/xau-new-logics-2026-03-16',
    codePrefix: 'XAUL2',
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
        id: 'l2_m5_tp20_hard',
        label: 'L2 — M5 NY BOS, TP 2.0R, hard exit',
        changeSummary: 'Base M5 run. Bullish BOS during NY session (13–17 UTC), ATR expansion, RSI >= 55. 2.0R hard exit.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setTakeProfitMultiple(definition, 2.0);
        },
    },
    {
        id: 'l2_m5_tp25_hard',
        label: 'L2 — M5 NY BOS, TP 2.5R, hard exit',
        changeSummary: 'Extend target to 2.5R. Tests whether NY momentum legs carry farther.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setTakeProfitMultiple(definition, 2.5);
        },
    },
    {
        id: 'l2_m5_tp20_swing',
        label: 'L2 — M5 NY BOS, swing trail exit',
        changeSummary: 'Swing trail: partial 50% at 1R, trail remainder. Tests if NY BOS entries sustain momentum for runners.',
        exitProfile: 'PARTIAL_1R_BE_SWING_TRAIL',
        mutate(definition) {
            applyM5Base(definition, 72, 24);
        },
    },
    {
        id: 'l2_m5_tp25_cap5',
        label: 'L2 — M5 NY BOS, TP 2.5R, area cap 5',
        changeSummary: 'Area cap 5 per zone to prevent repeated BOS entries at the same level during trending NY sessions.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setTakeProfitMultiple(definition, 2.5);
            setSignalAreaGuard(definition, { maxSignalsPerArea: 5, resetBars: 8, priceDistanceR: 0.75 });
        },
    },
    {
        id: 'l2_m5_atr130_tp25',
        label: 'L2 — M5 NY BOS, ATR 1.30, TP 2.5R',
        changeSummary: 'Stricter ATR filter (1.30x) to select only high-volatility NY BOS entries.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setAtrMultiplier(definition, 1.3);
            setTakeProfitMultiple(definition, 2.5);
        },
    },
    {
        id: 'l2_m5_extended_window',
        label: 'L2 — M5 NY extended window 13–19 UTC',
        changeSummary: 'Extend NY window to 13:00–19:00 UTC to capture late NY and overlap with Asian open. Tests if broader window improves volume without hurting quality.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setLondonSession(definition, 13, 19);
            setTakeProfitMultiple(definition, 2.5);
        },
    },
    {
        id: 'l2_m5_tp20_guarded',
        label: 'L2 — M5 NY BOS, TP 2.0R, trade guards',
        changeSummary: 'Apply loss-streak throttle and session/day caps. Tests protected NY BOS variant.',
        exitProfile: 'HARD_SIGNAL_TP',
        riskPercent: 1,
        executionConfigOverride: GUARDED_EXECUTION_CONFIG,
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setTakeProfitMultiple(definition, 2.0);
        },
    },
    {
        id: 'l2_m15_tp20_hard',
        label: 'L2 — M15 NY BOS, TP 2.0R, hard exit',
        changeSummary: 'M15 baseline. Fewer entries, higher-conviction NY BOS signals only.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            setStopLookback(definition, 24);
            setTakeProfitMultiple(definition, 2.0);
        },
    },
    {
        id: 'l2_m15_tp25_hard',
        label: 'L2 — M15 NY BOS, TP 2.5R, hard exit',
        changeSummary: 'M15 with 2.5R. Higher quality bar geometry for a wider target.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            setStopLookback(definition, 24);
            setTakeProfitMultiple(definition, 2.5);
        },
    },
];

const GROUPS = {
    m5_base: {
        label: 'M5 base sweep (TP 2.0R and 2.5R)',
        variants: ['l2_m5_tp20_hard', 'l2_m5_tp25_hard'],
    },
    m5_full: {
        label: 'Full M5 variant set',
        variants: ['l2_m5_tp20_hard', 'l2_m5_tp25_hard', 'l2_m5_tp20_swing', 'l2_m5_tp25_cap5', 'l2_m5_atr130_tp25', 'l2_m5_extended_window', 'l2_m5_tp20_guarded'],
    },
    m15: {
        label: 'M15 variants',
        variants: ['l2_m15_tp20_hard', 'l2_m15_tp25_hard'],
    },
    all: {
        label: 'All L2 NY Session BOS variants',
        variants: VARIANTS.map((v) => v.id),
    },
} satisfies Record<string, { label: string; variants: string[] }>;

function printUsage() {
    console.log([
        'Usage:',
        '  npx ts-node src/scripts/runXauNewLogicL2NyBos.ts --list-groups',
        '  npx ts-node src/scripts/runXauNewLogicL2NyBos.ts --group all',
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
        defaultOutPath: `${HARNESS.defaultOutDir}/l2_ny_bos_${args.group}.json`,
        notes: [
            'Logic L2: NY Session BOS — bullish break of structure during NY session (13–17 UTC).',
            'Session-orthogonal to London ABC system. Base signal: SYS_XAU_NY_SESSION_BOS_LONG. Proposed 2026-03-16.',
        ],
    });
}

main().catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : err);
    printUsage();
    process.exit(1);
});
