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
    baseSignalCode: 'SYS_XAU_ASIAN_HIGH_RETEST_LONG',
    defaultOutDir: '.artifacts/xau-new-logics-2026-03-16',
    codePrefix: 'XAUL1',
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
        id: 'l1_m5_tp20_hard',
        label: 'L1 — M5 Asian high retest, TP 2.0R, hard exit',
        changeSummary: 'Base M5 run. Asian high retest (touches_asian_high) during London, ATR expansion, EMA hold. 2.0R hard exit.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setTakeProfitMultiple(definition, 2.0);
        },
    },
    {
        id: 'l1_m5_tp25_hard',
        label: 'L1 — M5 Asian high retest, TP 2.5R, hard exit',
        changeSummary: 'Extend target to 2.5R on M5 retest. Tests if retest entries carry farther than 2.0R.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setTakeProfitMultiple(definition, 2.5);
        },
    },
    {
        id: 'l1_m5_tp20_swing',
        label: 'L1 — M5 Asian high retest, swing trail exit',
        changeSummary: 'Swing trail on M5 retest entries. Partial 50% at 1R, trail remainder.',
        exitProfile: 'PARTIAL_1R_BE_SWING_TRAIL',
        mutate(definition) {
            applyM5Base(definition, 72, 24);
        },
    },
    {
        id: 'l1_m5_tp25_cap5',
        label: 'L1 — M5 Asian high retest, TP 2.5R, area cap 5',
        changeSummary: 'Add area cap (5 per zone) to suppress cluster retest entries at the same level on ranging days.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setTakeProfitMultiple(definition, 2.5);
            setSignalAreaGuard(definition, { maxSignalsPerArea: 5, resetBars: 8, priceDistanceR: 0.75 });
        },
    },
    {
        id: 'l1_m5_atr130_tp25_hard',
        label: 'L1 — M5 Asian high retest, ATR 1.30, TP 2.5R',
        changeSummary: 'Widen ATR multiplier from 1.20 to 1.30. Stricter volatility gate to filter low-quality retest bars.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setAtrMultiplier(definition, 1.3);
            setTakeProfitMultiple(definition, 2.5);
        },
    },
    {
        id: 'l1_m5_tp25_guarded',
        label: 'L1 — M5 Asian high retest, TP 2.5R, trade guards',
        changeSummary: 'Apply loss-streak throttle and session/day caps on top of 2.5R hard exit.',
        exitProfile: 'HARD_SIGNAL_TP',
        executionConfigOverride: GUARDED_EXECUTION_CONFIG,
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setTakeProfitMultiple(definition, 2.5);
        },
    },
    {
        id: 'l1_m15_tp25_hard',
        label: 'L1 — M15 Asian high retest, TP 2.5R, hard exit',
        changeSummary: 'M15 baseline. Retest bar is coarser, fewer entries, stop lookback 24 bars.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            setStopLookback(definition, 24);
            setTakeProfitMultiple(definition, 2.5);
        },
    },
    {
        id: 'l1_m15_tp20_swing',
        label: 'L1 — M15 Asian high retest, swing trail exit',
        changeSummary: 'M15 swing trail. Tests quality of M15 retest entries with partial profit management.',
        exitProfile: 'PARTIAL_1R_BE_SWING_TRAIL',
        mutate(definition) {
            setStopLookback(definition, 24);
        },
    },
    {
        id: 'l1_m5_early_london_tp25',
        label: 'L1 — M5 Asian high retest, early London 07–10, TP 2.5R',
        changeSummary: 'Narrow session to early London 07:00–10:00 UTC where retest probability is highest.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            applyM5Base(definition, 72, 24);
            setLondonSession(definition, 7, 10);
            setTakeProfitMultiple(definition, 2.5);
        },
    },
];

const GROUPS = {
    m5_base: {
        label: 'M5 base sweep (TP 2.0R and 2.5R)',
        variants: ['l1_m5_tp20_hard', 'l1_m5_tp25_hard'],
    },
    m5_full: {
        label: 'Full M5 variant set',
        variants: ['l1_m5_tp20_hard', 'l1_m5_tp25_hard', 'l1_m5_tp20_swing', 'l1_m5_tp25_cap5', 'l1_m5_atr130_tp25_hard', 'l1_m5_tp25_guarded', 'l1_m5_early_london_tp25'],
    },
    m15: {
        label: 'M15 variants',
        variants: ['l1_m15_tp25_hard', 'l1_m15_tp20_swing'],
    },
    all: {
        label: 'All L1 Asian High Retest variants',
        variants: VARIANTS.map((v) => v.id),
    },
} satisfies Record<string, { label: string; variants: string[] }>;

function printUsage() {
    console.log([
        'Usage:',
        '  npx ts-node src/scripts/runXauNewLogicL1AsianRetest.ts --list-groups',
        '  npx ts-node src/scripts/runXauNewLogicL1AsianRetest.ts --group all',
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
        defaultOutPath: `${HARNESS.defaultOutDir}/l1_asian_retest_${args.group}.json`,
        notes: [
            'Logic L1: Asian High Retest — enters when price touches the Asian high during London session.',
            'Base signal: SYS_XAU_ASIAN_HIGH_RETEST_LONG. Proposed 2026-03-16.',
        ],
    });
}

main().catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : err);
    printUsage();
    process.exit(1);
});
