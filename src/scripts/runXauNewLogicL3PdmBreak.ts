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

const STREAK_COOLDOWN_5_360: Partial<ExecutionConfigInput> = {
    tradeGuards: {
        lossStreakCooldown: {
            afterLosses: 5,
            cooldownMinutes: 360,
        },
    },
};

const STREAK_COOLDOWN_5_720: Partial<ExecutionConfigInput> = {
    tradeGuards: {
        lossStreakCooldown: {
            afterLosses: 5,
            cooldownMinutes: 720,
        },
    },
};

const STREAK_COOLDOWN_3_720: Partial<ExecutionConfigInput> = {
    tradeGuards: {
        lossStreakCooldown: {
            afterLosses: 3,
            cooldownMinutes: 720,
        },
    },
};

const STREAK_COOLDOWN_3_1440: Partial<ExecutionConfigInput> = {
    tradeGuards: {
        lossStreakCooldown: {
            afterLosses: 3,
            cooldownMinutes: 1440,
        },
    },
};

const STREAK_COOLDOWN_2_1440_SESSION1: Partial<ExecutionConfigInput> = {
    tradeGuards: {
        lossStreakCooldown: {
            afterLosses: 2,
            cooldownMinutes: 1440,
        },
        sessionLossCap: { maxLosses: 1 },
    },
};

const STREAK_COOLDOWN_2_2880_SESSION1: Partial<ExecutionConfigInput> = {
    tradeGuards: {
        lossStreakCooldown: {
            afterLosses: 2,
            cooldownMinutes: 2880,
        },
        sessionLossCap: { maxLosses: 1 },
    },
};

const HARNESS: MetalHarnessConfig = {
    symbol: 'XAUUSD',
    from: XAU_FROM,
    to: XAU_TO,
    initialEquity: 10_000,
    riskPercent: 2,
    baseSignalCode: 'SYS_XAU_PDM_BREAK_LONG',
    defaultOutDir: '.artifacts/xau-new-logics-2026-03-16',
    codePrefix: 'XAUL3',
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
        id: 'l3_m5_tp20_hard',
        label: 'L3 — M5 PDM break, TP 2.0R, hard exit',
        changeSummary: 'Base M5 run. Close above prior day midpoint during London, ATR expansion, RSI >= 55. 2.0R hard exit.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setTakeProfitMultiple(definition, 2.0);
        },
    },
    {
        id: 'l3_m5_tp25_hard',
        label: 'L3 — M5 PDM break, TP 2.5R, hard exit',
        changeSummary: 'Extend target to 2.5R on M5 PDM break.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setTakeProfitMultiple(definition, 2.5);
        },
    },
    {
        id: 'l3_m5_tp20_swing',
        label: 'L3 — M5 PDM break, swing trail exit',
        changeSummary: 'Swing trail on M5 PDM break. Tests if midpoint breaks sustain momentum for a runner.',
        exitProfile: 'PARTIAL_1R_BE_SWING_TRAIL',
        mutate(definition) {
            applyM5Base(definition, 72, 24);
        },
    },
    {
        id: 'l3_m5_rsi50_tp25',
        label: 'L3 — M5 PDM break, RSI 50 gate, TP 2.5R',
        changeSummary: 'Lower RSI gate from 55 to 50. Wider filter — tests if volume gain from relaxed RSI helps total R.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setRsiThreshold(definition, 50);
            setTakeProfitMultiple(definition, 2.5);
        },
    },
    {
        id: 'l3_m5_rsi58_tp25',
        label: 'L3 — M5 PDM break, RSI 58 gate, TP 2.5R',
        changeSummary: 'Raise RSI gate from 55 to 58. Stricter momentum filter — tests quality improvement vs volume loss.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setRsiThreshold(definition, 58);
            setTakeProfitMultiple(definition, 2.5);
        },
    },
    {
        id: 'l3_m5_atr130_tp25',
        label: 'L3 — M5 PDM break, ATR 1.30, TP 2.5R',
        changeSummary: 'Widen ATR threshold to 1.30x. Selects only higher-volatility midpoint break bars.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setAtrMultiplier(definition, 1.3);
            setTakeProfitMultiple(definition, 2.5);
        },
    },
    {
        id: 'l3_m5_tp25_cap5',
        label: 'L3 — M5 PDM break, TP 2.5R, area cap 5',
        changeSummary: 'Area cap 5 per zone to prevent repeated PDM break entries on flat days that hover near the midpoint.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setTakeProfitMultiple(definition, 2.5);
            setSignalAreaGuard(definition, { maxSignalsPerArea: 5, resetBars: 8, priceDistanceR: 0.75 });
        },
    },
    {
        id: 'l3_m5_early_london_tp25',
        label: 'L3 — M5 PDM break, early London 07–10 UTC',
        changeSummary: 'Narrow session window to 07:00–10:00 UTC. Tests if earliest London PDM breaks carry better R.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setLondonSession(definition, 7, 10);
            setTakeProfitMultiple(definition, 2.5);
        },
    },
    {
        id: 'l3_m5_tp25_guarded',
        label: 'L3 — M5 PDM break, TP 2.5R, trade guards',
        changeSummary: 'Apply full loss-streak and session/day guards on the base PDM break lane.',
        exitProfile: 'HARD_SIGNAL_TP',
        riskPercent: 1,
        executionConfigOverride: GUARDED_EXECUTION_CONFIG,
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setTakeProfitMultiple(definition, 2.5);
        },
    },
    {
        id: 'l3_m5_tp25_ls5_cd360',
        label: 'L3 — M5 PDM break, TP 2.5R, cooldown after 5 losses',
        changeSummary: 'Pause new entries for 6 hours after 5 consecutive losses, then reset the streak count to avoid compact loss clusters.',
        exitProfile: 'HARD_SIGNAL_TP',
        executionConfigOverride: STREAK_COOLDOWN_5_360,
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setTakeProfitMultiple(definition, 2.5);
        },
    },
    {
        id: 'l3_m5_tp25_ls5_cd720_cap2',
        label: 'L3 — M5 PDM break, TP 2.5R, cooldown after 5 losses + area cap 2',
        changeSummary: 'Combine a 12-hour loss-streak cooldown with a tighter 2-entry area cap to suppress repeated PDM retests inside the same local cluster.',
        exitProfile: 'HARD_SIGNAL_TP',
        executionConfigOverride: STREAK_COOLDOWN_5_720,
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setTakeProfitMultiple(definition, 2.5);
            setSignalAreaGuard(definition, { maxSignalsPerArea: 2, resetBars: 16, priceDistanceR: 1.0 });
        },
    },
    {
        id: 'l3_m5_rsi58_tp25_ls5_cd720_cap2',
        label: 'L3 — M5 PDM break, RSI 58, TP 2.5R, cooldown after 5 losses + area cap 2',
        changeSummary: 'Use the stricter RSI 58 quality filter, then add the 12-hour post-streak cooldown and 2-entry area cap to target tighter loss clustering.',
        exitProfile: 'HARD_SIGNAL_TP',
        executionConfigOverride: STREAK_COOLDOWN_5_720,
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setRsiThreshold(definition, 58);
            setTakeProfitMultiple(definition, 2.5);
            setSignalAreaGuard(definition, { maxSignalsPerArea: 2, resetBars: 16, priceDistanceR: 1.0 });
        },
    },
    {
        id: 'l3_m5_atr130_tp25_ls5_cd720_cap2',
        label: 'L3 — M5 PDM break, ATR 1.30, TP 2.5R, cooldown after 5 losses + area cap 2',
        changeSummary: 'Keep only higher-volatility breaks with ATR 1.30, then add the 12-hour cooldown and 2-entry area cap to cut compact losing sequences further.',
        exitProfile: 'HARD_SIGNAL_TP',
        executionConfigOverride: STREAK_COOLDOWN_5_720,
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setAtrMultiplier(definition, 1.3);
            setTakeProfitMultiple(definition, 2.5);
            setSignalAreaGuard(definition, { maxSignalsPerArea: 2, resetBars: 16, priceDistanceR: 1.0 });
        },
    },
    {
        id: 'l3_m5_tp25_ls3_cd720_cap2',
        label: 'L3 — M5 PDM break, TP 2.5R, cooldown after 3 losses + area cap 2',
        changeSummary: 'Escalate the anti-cluster policy: after 3 consecutive losses, pause for 12 hours and keep the tighter 2-entry area cap.',
        exitProfile: 'HARD_SIGNAL_TP',
        executionConfigOverride: STREAK_COOLDOWN_3_720,
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setTakeProfitMultiple(definition, 2.5);
            setSignalAreaGuard(definition, { maxSignalsPerArea: 2, resetBars: 16, priceDistanceR: 1.0 });
        },
    },
    {
        id: 'l3_m5_rsi58_tp25_ls3_cd720_cap2',
        label: 'L3 — M5 PDM break, RSI 58, TP 2.5R, cooldown after 3 losses + area cap 2',
        changeSummary: 'Pair the RSI 58 quality gate with the stricter 3-loss, 12-hour cooldown and 2-entry area cap.',
        exitProfile: 'HARD_SIGNAL_TP',
        executionConfigOverride: STREAK_COOLDOWN_3_720,
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setRsiThreshold(definition, 58);
            setTakeProfitMultiple(definition, 2.5);
            setSignalAreaGuard(definition, { maxSignalsPerArea: 2, resetBars: 16, priceDistanceR: 1.0 });
        },
    },
    {
        id: 'l3_m5_tp25_ls3_cd1440_cap2',
        label: 'L3 — M5 PDM break, TP 2.5R, cooldown after 3 losses + 24h pause + area cap 2',
        changeSummary: 'Same anti-cluster shape as the 3-loss variant, but extend the pause to 24 hours to force a full regime reset before re-entry.',
        exitProfile: 'HARD_SIGNAL_TP',
        executionConfigOverride: STREAK_COOLDOWN_3_1440,
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setTakeProfitMultiple(definition, 2.5);
            setSignalAreaGuard(definition, { maxSignalsPerArea: 2, resetBars: 16, priceDistanceR: 1.0 });
        },
    },
    {
        id: 'l3_m5_tp25_ls2_cd1440_cap1',
        label: 'L3 — M5 PDM break, TP 2.5R, cooldown after 2 losses + 24h pause + area cap 1',
        changeSummary: 'Extreme protection lane: after 2 consecutive losses, pause for 24 hours and allow only 1 entry per local area.',
        exitProfile: 'HARD_SIGNAL_TP',
        executionConfigOverride: STREAK_COOLDOWN_2_1440_SESSION1,
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setTakeProfitMultiple(definition, 2.5);
            setSignalAreaGuard(definition, { maxSignalsPerArea: 1, resetBars: 24, priceDistanceR: 1.0 });
        },
    },
    {
        id: 'l3_m5_rsi58_tp25_ls2_cd1440_cap1',
        label: 'L3 — M5 PDM break, RSI 58, TP 2.5R, cooldown after 2 losses + 24h pause + area cap 1',
        changeSummary: 'Extreme protection with the RSI 58 quality gate layered on top of the 2-loss, 24-hour pause and 1-entry area cap.',
        exitProfile: 'HARD_SIGNAL_TP',
        executionConfigOverride: STREAK_COOLDOWN_2_1440_SESSION1,
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setRsiThreshold(definition, 58);
            setTakeProfitMultiple(definition, 2.5);
            setSignalAreaGuard(definition, { maxSignalsPerArea: 1, resetBars: 24, priceDistanceR: 1.0 });
        },
    },
    {
        id: 'l3_m5_rsi58_tp25_ls2_cd2880_cap1',
        label: 'L3 — M5 PDM break, RSI 58, TP 2.5R, cooldown after 2 losses + 48h pause + area cap 1',
        changeSummary: 'Most defensive lane in this sweep: RSI 58 plus a 48-hour pause after 2 losses and only 1 entry per area.',
        exitProfile: 'HARD_SIGNAL_TP',
        executionConfigOverride: STREAK_COOLDOWN_2_2880_SESSION1,
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setRsiThreshold(definition, 58);
            setTakeProfitMultiple(definition, 2.5);
            setSignalAreaGuard(definition, { maxSignalsPerArea: 1, resetBars: 24, priceDistanceR: 1.0 });
        },
    },
    {
        id: 'l3_m15_tp25_hard',
        label: 'L3 — M15 PDM break, TP 2.5R, hard exit',
        changeSummary: 'M15 baseline. Fewer entries, stop lookback 24 bars.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            setStopLookback(definition, 24);
            setTakeProfitMultiple(definition, 2.5);
        },
    },
    {
        id: 'l3_m15_tp20_swing',
        label: 'L3 — M15 PDM break, swing trail exit',
        changeSummary: 'M15 swing trail on PDM break entries.',
        exitProfile: 'PARTIAL_1R_BE_SWING_TRAIL',
        mutate(definition) {
            setStopLookback(definition, 24);
        },
    },
];

const GROUPS = {
    m5_base: {
        label: 'M5 base sweep (TP 2.0R and 2.5R)',
        variants: ['l3_m5_tp20_hard', 'l3_m5_tp25_hard'],
    },
    m5_rsi_sweep: {
        label: 'M5 RSI gate sweep',
        variants: ['l3_m5_rsi50_tp25', 'l3_m5_tp25_hard', 'l3_m5_rsi58_tp25'],
    },
    m5_full: {
        label: 'Full M5 variant set',
        variants: ['l3_m5_tp20_hard', 'l3_m5_tp25_hard', 'l3_m5_tp20_swing', 'l3_m5_rsi50_tp25', 'l3_m5_rsi58_tp25', 'l3_m5_atr130_tp25', 'l3_m5_tp25_cap5', 'l3_m5_early_london_tp25', 'l3_m5_tp25_guarded', 'l3_m5_tp25_ls5_cd360', 'l3_m5_tp25_ls5_cd720_cap2', 'l3_m5_rsi58_tp25_ls5_cd720_cap2', 'l3_m5_atr130_tp25_ls5_cd720_cap2'],
    },
    m5_streak_control: {
        label: 'M5 loss-streak control sweep',
        variants: ['l3_m5_tp25_hard', 'l3_m5_tp25_guarded', 'l3_m5_tp25_ls5_cd360', 'l3_m5_tp25_ls5_cd720_cap2', 'l3_m5_rsi58_tp25_ls5_cd720_cap2', 'l3_m5_atr130_tp25_ls5_cd720_cap2'],
    },
    m5_streak_hard_cap: {
        label: 'M5 hard cap streak sweep',
        variants: ['l3_m5_tp25_ls3_cd720_cap2', 'l3_m5_rsi58_tp25_ls3_cd720_cap2', 'l3_m5_tp25_ls3_cd1440_cap2'],
    },
    m5_streak_extreme: {
        label: 'M5 extreme streak suppression sweep',
        variants: ['l3_m5_tp25_ls2_cd1440_cap1', 'l3_m5_rsi58_tp25_ls2_cd1440_cap1', 'l3_m5_rsi58_tp25_ls2_cd2880_cap1'],
    },
    m15: {
        label: 'M15 variants',
        variants: ['l3_m15_tp25_hard', 'l3_m15_tp20_swing'],
    },
    all: {
        label: 'All L3 PDM Break variants',
        variants: VARIANTS.map((v) => v.id),
    },
} satisfies Record<string, { label: string; variants: string[] }>;

function printUsage() {
    console.log([
        'Usage:',
        '  npx ts-node src/scripts/runXauNewLogicL3PdmBreak.ts --list-groups',
        '  npx ts-node src/scripts/runXauNewLogicL3PdmBreak.ts --group all',
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
        defaultOutPath: `${HARNESS.defaultOutDir}/l3_pdm_break_${args.group}.json`,
        notes: [
            'Logic L3: Prior Day Midpoint Break — closes above PDM during London session.',
            'Higher-frequency early entry vs PDH break. Base signal: SYS_XAU_PDM_BREAK_LONG. Proposed 2026-03-16.',
        ],
    });
}

main().catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : err);
    printUsage();
    process.exit(1);
});
