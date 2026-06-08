import { ExecutionConfigInput } from '../services/signals/types';
import {
    MetalHarnessConfig,
    MetalVariantSpec,
    addBullishMarketRegime,
    addConfirmationUptrend,
    addTrendCatcherBearish,
    applyM5Base,
    reorderBlocks,
    runMetalVariantGroup,
    setAtrMultiplier,
    setMatchMode,
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
        sessionLossCap: {
            maxLosses: 2,
            maxNetR: 2,
        },
        dayLossCap: {
            maxNetR: 3,
        },
    },
};

const LIGHT_GUARDED_EXECUTION_CONFIG: Partial<ExecutionConfigInput> = {
    tradeGuards: {
        lossStreakThrottle: {
            steps: [
                { afterLosses: 3, riskPercent: 0.5 },
            ],
        },
        sessionLossCap: {
            maxLosses: 3,
            maxNetR: 3,
        },
        dayLossCap: {
            maxNetR: 3,
        },
    },
};

const XAU_M5_HARNESS: MetalHarnessConfig = {
    symbol: 'XAUUSD',
    from: XAU_FROM,
    to: XAU_TO,
    initialEquity: 10_000,
    riskPercent: 2,
    baseSignalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG',
    defaultOutDir: '.artifacts/xau-m5-roadmap',
    codePrefix: 'XAURM5',
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
        id: 'guarded_capped_safety',
        label: 'Guarded capped safety lane',
        changeSummary: 'Cap M5 continuation to 5 entries per area, widen stop lookback to 96, and enable trade guards to reduce equity pain.',
        exitProfile: 'HARD_SIGNAL_TP',
        riskPercent: 1,
        executionConfigOverride: GUARDED_EXECUTION_CONFIG,
        mutate(definition) {
            applyM5Base(definition);
            setSignalAreaGuard(definition, {
                maxSignalsPerArea: 5,
                resetBars: 8,
                priceDistanceR: 0.75,
            });
            setAtrMultiplier(definition, 1.15);
            setStopLookback(definition, 96);
        },
    },
    {
        id: 'breakout_freshness_sequence',
        label: 'Breakout freshness sequence',
        changeSummary: 'Reinterpret ABC on M5 as a sequence and execute at signal-bar close to prefer fresh breakout continuation instead of repeated cluster re-entry.',
        exitProfile: 'HARD_SIGNAL_TP',
        executionConfigOverride: {
            orderTiming: 'SIGNAL_BAR_CLOSE',
        },
        mutate(definition) {
            applyM5Base(definition, 60, 6);
            setMatchMode(definition, 'SEQUENCE', 6);
            reorderBlocks(definition, [
                'SESSION_RANGE_STRUCTURE',
                'RSI',
                'ATR_REGIME',
                'SESSION_FILTER',
            ]);
        },
    },
    {
        id: 'breakout_freshness_sequence_area_guard',
        label: 'Breakout freshness sequence + signalAreaGuard',
        changeSummary: 'Keep the breakout freshness sequence, then add area-based entry suppression to reduce repeated entries inside the same breakout cluster.',
        exitProfile: 'HARD_SIGNAL_TP',
        executionConfigOverride: {
            orderTiming: 'SIGNAL_BAR_CLOSE',
        },
        mutate(definition) {
            applyM5Base(definition, 60, 6);
            setMatchMode(definition, 'SEQUENCE', 6);
            reorderBlocks(definition, [
                'SESSION_RANGE_STRUCTURE',
                'RSI',
                'ATR_REGIME',
                'SESSION_FILTER',
            ]);
            setSignalAreaGuard(definition, {
                maxSignalsPerArea: 5,
                resetBars: 8,
                priceDistanceR: 0.75,
            });
        },
    },
    {
        id: 'breakout_freshness_sequence_trade_guards',
        label: 'Breakout freshness sequence + tradeGuards',
        changeSummary: 'Keep the breakout freshness sequence unchanged at the signal layer, but add loss-streak and session/day guardrails to improve the account path.',
        exitProfile: 'HARD_SIGNAL_TP',
        executionConfigOverride: {
            orderTiming: 'SIGNAL_BAR_CLOSE',
            ...GUARDED_EXECUTION_CONFIG,
        },
        mutate(definition) {
            applyM5Base(definition, 60, 6);
            setMatchMode(definition, 'SEQUENCE', 6);
            reorderBlocks(definition, [
                'SESSION_RANGE_STRUCTURE',
                'RSI',
                'ATR_REGIME',
                'SESSION_FILTER',
            ]);
        },
    },
    {
        id: 'breakout_freshness_sequence_area_guard_trade_guards',
        label: 'Breakout freshness sequence + signalAreaGuard + tradeGuards',
        changeSummary: 'Combine cluster suppression with execution guardrails so the freshness lane can cut repeated area re-entry while also throttling loss streaks and session/day damage.',
        exitProfile: 'HARD_SIGNAL_TP',
        executionConfigOverride: {
            orderTiming: 'SIGNAL_BAR_CLOSE',
            ...GUARDED_EXECUTION_CONFIG,
        },
        mutate(definition) {
            applyM5Base(definition, 60, 6);
            setMatchMode(definition, 'SEQUENCE', 6);
            reorderBlocks(definition, [
                'SESSION_RANGE_STRUCTURE',
                'RSI',
                'ATR_REGIME',
                'SESSION_FILTER',
            ]);
            setSignalAreaGuard(definition, {
                maxSignalsPerArea: 5,
                resetBars: 8,
                priceDistanceR: 0.75,
            });
        },
    },
    {
        id: 'breakout_freshness_sequence_area_guard_light_trade_guards',
        label: 'Breakout freshness sequence + signalAreaGuard + light tradeGuards',
        changeSummary: 'Keep cluster suppression, then use a lighter loss-streak and session throttle so the freshness lane can protect the path without crushing too much alpha.',
        exitProfile: 'HARD_SIGNAL_TP',
        executionConfigOverride: {
            orderTiming: 'SIGNAL_BAR_CLOSE',
            ...LIGHT_GUARDED_EXECUTION_CONFIG,
        },
        mutate(definition) {
            applyM5Base(definition, 60, 6);
            setMatchMode(definition, 'SEQUENCE', 6);
            reorderBlocks(definition, [
                'SESSION_RANGE_STRUCTURE',
                'RSI',
                'ATR_REGIME',
                'SESSION_FILTER',
            ]);
            setSignalAreaGuard(definition, {
                maxSignalsPerArea: 5,
                resetBars: 8,
                priceDistanceR: 0.75,
            });
        },
    },
    {
        id: 'hybrid_abc_stc_confirm',
        label: 'Hybrid ABC + STC long confirmation',
        changeSummary: 'Keep the ABC continuation core on M5, but reinterpret the branch as an ordered sequence: trend confirmation, bearish pullback, breakout reclaim, then momentum/volatility confirmation at signal-bar close.',
        exitProfile: 'HARD_SIGNAL_TP',
        executionConfigOverride: {
            orderTiming: 'SIGNAL_BAR_CLOSE',
        },
        mutate(definition) {
            applyM5Base(definition, 96, 10);
            setMatchMode(definition, 'SEQUENCE', 10);
            setSignalAreaGuard(definition, {
                maxSignalsPerArea: 5,
                resetBars: 8,
                priceDistanceR: 0.75,
            });
            setAtrMultiplier(definition, 1.15);
            addConfirmationUptrend(definition, {
                fastPeriod: 21,
                slowPeriod: 89,
                adxPeriod: 14,
                adxThreshold: 16,
            });
            addTrendCatcherBearish(definition, {
                fastPeriod: 5,
                slowPeriod: 13,
                rsiPeriod: 14,
                rsiThreshold: 47,
            });
            reorderBlocks(definition, [
                'CONFIRMATION_TREND',
                'TREND_CATCHER',
                'SESSION_RANGE_STRUCTURE',
                'RSI',
                'ATR_REGIME',
                'SESSION_FILTER',
            ]);
        },
    },
    {
        id: 'regime_alpha_tp25',
        label: 'Regime-switched alpha geometry',
        changeSummary: 'Approximate the expansion-day alpha lane by stacking a bullish regime filter on the capped M5 continuation lane and restoring the 2.5R target.',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            applyM5Base(definition);
            setSignalAreaGuard(definition, {
                maxSignalsPerArea: 5,
                resetBars: 8,
                priceDistanceR: 0.75,
            });
            setAtrMultiplier(definition, 1.15);
            setTakeProfitMultiple(definition, 2.5);
            addBullishMarketRegime(definition);
        },
    },
    {
        id: 'regime_safety_be_router_ready',
        label: 'Regime-switched safety geometry',
        changeSummary: 'Approximate the quieter-day safety lane with wider stop lookback, break-even management, and guard-aware execution so it can act as the router fallback branch later.',
        exitProfile: 'BE_1R_TP_2R',
        riskPercent: 1,
        executionConfigOverride: GUARDED_EXECUTION_CONFIG,
        mutate(definition) {
            applyM5Base(definition, 96, 24);
            setSignalAreaGuard(definition, {
                maxSignalsPerArea: 5,
                resetBars: 8,
                priceDistanceR: 0.75,
            });
            setAtrMultiplier(definition, 1.15);
            addBullishMarketRegime(definition);
        },
    },
];

const GROUPS = {
    guarded_safety: {
        label: 'Guarded capped safety lane',
        variants: ['guarded_capped_safety'],
    },
    freshness_sequence: {
        label: 'Breakout freshness sequence',
        variants: ['breakout_freshness_sequence'],
    },
    freshness_sequence_area_guard: {
        label: 'Breakout freshness sequence + signalAreaGuard',
        variants: ['breakout_freshness_sequence_area_guard'],
    },
    freshness_sequence_trade_guards: {
        label: 'Breakout freshness sequence + tradeGuards',
        variants: ['breakout_freshness_sequence_trade_guards'],
    },
    freshness_sequence_area_guard_trade_guards: {
        label: 'Breakout freshness sequence + signalAreaGuard + tradeGuards',
        variants: ['breakout_freshness_sequence_area_guard_trade_guards'],
    },
    freshness_sequence_area_guard_light_trade_guards: {
        label: 'Breakout freshness sequence + signalAreaGuard + light tradeGuards',
        variants: ['breakout_freshness_sequence_area_guard_light_trade_guards'],
    },
    hybrid_confirm: {
        label: 'Hybrid ABC + STC long confirmation',
        variants: ['hybrid_abc_stc_confirm'],
    },
    regime_switch: {
        label: 'Regime-switched geometry pair',
        variants: ['regime_alpha_tp25', 'regime_safety_be_router_ready'],
    },
    all: {
        label: 'All XAU M5 roadmap preview variants',
        variants: VARIANTS.map((variant) => variant.id),
    },
} satisfies Record<string, { label: string; variants: string[] }>;

function printUsage() {
    console.log([
        'Usage:',
        '  node -r ts-node/register src/scripts/runXauM5RoadmapPreview.ts --list-groups',
        '  node -r ts-node/register src/scripts/runXauM5RoadmapPreview.ts --group all --out .artifacts/xau-m5-roadmap/all.json',
        '',
        'Options:',
        `  --group <name>   One of: ${Object.keys(GROUPS).join(', ')}`,
        '  --list-groups    Show available groups',
        '  --out <path>     Where to write the JSON output file',
    ].join('\n'));
}

function parseArgs(argv: string[]) {
    const result: {
        listGroups: boolean;
        group: keyof typeof GROUPS;
    } = {
        listGroups: false,
        group: 'all',
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--list-groups') {
            result.listGroups = true;
            continue;
        }
        if (arg === '--group') {
            const value = argv[index + 1];
            if (!value || !(value in GROUPS)) {
                throw new Error(`Unknown --group value "${value ?? ''}".`);
            }
            result.group = value as keyof typeof GROUPS;
            index += 1;
            continue;
        }
        if (arg === '--out') {
            index += 1;
            continue;
        }
        throw new Error(`Unknown argument "${arg}".`);
    }

    return result;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.listGroups) {
        console.log('Available XAU M5 roadmap groups:');
        for (const [groupKey, group] of Object.entries(GROUPS)) {
            console.log(`- ${groupKey}: ${group.label}`);
            console.log(`  variants: ${group.variants.join(', ')}`);
        }
        return;
    }

    const selectedGroup = GROUPS[args.group];
    const variants = VARIANTS.filter((variant) => selectedGroup.variants.includes(variant.id));

    await runMetalVariantGroup({
        harness: XAU_M5_HARNESS,
        group: args.group,
        groupLabel: selectedGroup.label,
        variants,
        defaultOutPath: `${XAU_M5_HARNESS.defaultOutDir}/${args.group}.json`,
        notes: [
            'Roadmap preview for the next XAU M5 wave.',
            'The alpha-safety router itself is not implemented in runtime yet; the regime alpha/safety pair is the preview foundation for that later step.',
        ],
    });
}

main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    printUsage();
    process.exit(1);
});
