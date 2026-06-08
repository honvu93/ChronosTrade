import {
    MetalVariantSpec,
    applyM5Base,
    reorderBlocks,
    runMetalVariantGroup,
    setAtrMultiplier,
    setLondonSession,
    setMatchMode,
    setRsiThreshold,
    setSignalAreaGuard,
    setStopLookback,
} from './metalOptimizationHarness';
import { XAG_DEFAULT_OUT_DIR, XAG_M5_HARNESS } from './xagM5OptimizationShared';
import { ExecutionConfigInput } from '../services/signals/types';

const GUARDED_EXECUTION: Partial<ExecutionConfigInput> = {
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

const VARIANTS: MetalVariantSpec[] = [
    {
        id: 'xag_abc_clone_base',
        label: 'XAG ABC clone baseline',
        changeSummary: 'Clone the XAU Asian Break Continuation lane onto XAG M5 and recalibrate the first pass with ATR 1.15 and RSI 56.',
        baseSignalCode: 'SYS_XAG_ASIAN_BREAK_CONTINUATION_LONG',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            applyM5Base(definition);
            setAtrMultiplier(definition, 1.15);
            setRsiThreshold(definition, 56);
        },
    },
    {
        id: 'xag_abc_capped_safety',
        label: 'XAG capped safety lane',
        changeSummary: 'Build the anti-overtrade XAG continuation lane with a 5-entry area cap, lookback 96, and guard-aware execution.',
        baseSignalCode: 'SYS_XAG_ASIAN_BREAK_CONTINUATION_LONG',
        exitProfile: 'HARD_SIGNAL_TP',
        riskPercent: 1,
        executionConfigOverride: GUARDED_EXECUTION,
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
        id: 'xag_pdl_reclaim_long',
        label: 'XAG PDL reclaim long',
        changeSummary: 'Test whether silver responds better than gold to daily-low sweep reclaim behavior on M5.',
        baseSignalCode: 'SYS_XAG_PDL_SWEEP_RECLAIM_LONG',
        exitProfile: 'BE_1R_TP_2R',
        executionConfigOverride: {
            orderTiming: 'SIGNAL_BAR_CLOSE',
        },
        mutate(definition) {
            applyM5Base(definition, 48, 8);
            setAtrMultiplier(definition, 1.15);
        },
    },
    {
        id: 'xag_pdh_reclaim_short',
        label: 'XAG PDH reclaim short',
        changeSummary: 'Test the XAG short-side reclaim lane separately instead of assuming long-side symmetry.',
        baseSignalCode: 'SYS_XAG_PDH_SWEEP_RECLAIM_SHORT',
        exitProfile: 'BE_1R_TP_2R',
        executionConfigOverride: {
            orderTiming: 'SIGNAL_BAR_CLOSE',
        },
        mutate(definition) {
            applyM5Base(definition, 48, 8);
            setAtrMultiplier(definition, 1.15);
        },
    },
    {
        id: 'xag_asian_sweep_reversal',
        label: 'XAG Asian sweep reversal',
        changeSummary: 'Run the exploratory XAG reversal lane on M5 with a narrower London window and signal-bar-close execution.',
        baseSignalCode: 'SYS_XAG_ASIAN_SWEEP_REVERSAL_LONG',
        exitProfile: 'PARTIAL_1R_BE_SWING_TRAIL',
        executionConfigOverride: {
            orderTiming: 'SIGNAL_BAR_CLOSE',
        },
        mutate(definition) {
            applyM5Base(definition, 48, 10);
            setLondonSession(definition, 7, 10);
        },
    },
    {
        id: 'xag_stc_long_sequence',
        label: 'XAG Smart Trail long sequence',
        changeSummary: 'Clone the STC long branch onto XAG M5, then reinterpret it as a pullback sequence with signal-bar-close execution.',
        baseSignalCode: 'SYS_XAG_SMART_TRAIL_CONFIRM_LONG',
        exitProfile: 'HARD_SIGNAL_TP',
        executionConfigOverride: {
            orderTiming: 'SIGNAL_BAR_CLOSE',
        },
        mutate(definition) {
            applyM5Base(definition, 48, 12);
            setMatchMode(definition, 'SEQUENCE', 12);
            reorderBlocks(definition, [
                'CONFIRMATION_TREND',
                'TREND_CATCHER',
                'SMART_TRAIL_SWITCH',
            ]);
            getBlockForStc(definition, 'SMART_TRAIL_SWITCH').indicatorParams = {
                atrPeriod: 7,
                multiplier: 2.2,
            };
            getBlockForStc(definition, 'CONFIRMATION_TREND').indicatorParams = {
                fastPeriod: 21,
                slowPeriod: 89,
                adxPeriod: 14,
            };
            getBlockForStc(definition, 'CONFIRMATION_TREND').conditionParams = {
                adxThreshold: 16,
            };
            getBlockForStc(definition, 'TREND_CATCHER').indicatorParams = {
                fastPeriod: 5,
                slowPeriod: 13,
                rsiPeriod: 14,
            };
            getBlockForStc(definition, 'TREND_CATCHER').conditionParams = {
                rsiThreshold: 47,
            };
        },
    },
];

const GROUPS = {
    abc_clone: {
        label: 'XAG ABC clone baseline',
        variants: ['xag_abc_clone_base'],
    },
    capped_safety: {
        label: 'XAG capped safety lane',
        variants: ['xag_abc_capped_safety'],
    },
    reclaim: {
        label: 'XAG reclaim pair',
        variants: ['xag_pdl_reclaim_long', 'xag_pdh_reclaim_short'],
    },
    asian_sweep: {
        label: 'XAG Asian sweep reversal',
        variants: ['xag_asian_sweep_reversal'],
    },
    stc_sequence: {
        label: 'XAG Smart Trail long sequence',
        variants: ['xag_stc_long_sequence'],
    },
    all: {
        label: 'All XAG M5 bootstrap preview variants',
        variants: VARIANTS.map((variant) => variant.id),
    },
} satisfies Record<string, { label: string; variants: string[] }>;

function getBlockForStc(definition: Parameters<MetalVariantSpec['mutate']>[0], indicatorId: string) {
    const block = definition.blocks.find((entry) => entry.indicatorId === indicatorId);
    if (!block) {
        throw new Error(`Missing STC block ${indicatorId}.`);
    }
    return block;
}

function printUsage() {
    console.log([
        'Usage:',
        '  node -r ts-node/register src/scripts/runXagM5BootstrapPreview.ts --list-groups',
        `  node -r ts-node/register src/scripts/runXagM5BootstrapPreview.ts --group all --out ${XAG_DEFAULT_OUT_DIR}/all.json`,
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
        console.log('Available XAG M5 bootstrap groups:');
        for (const [groupKey, group] of Object.entries(GROUPS)) {
            console.log(`- ${groupKey}: ${group.label}`);
            console.log(`  variants: ${group.variants.join(', ')}`);
        }
        return;
    }

    const selectedGroup = GROUPS[args.group];
    const variants = VARIANTS.filter((variant) => selectedGroup.variants.includes(variant.id));

    await runMetalVariantGroup({
        harness: XAG_M5_HARNESS,
        group: args.group,
        groupLabel: selectedGroup.label,
        variants,
        defaultOutPath: `${XAG_DEFAULT_OUT_DIR}/${args.group}.json`,
        notes: [
            'Bootstrap preview batch for the first dedicated XAG M5 research wave.',
            'Interpret positive expectancy here as screening evidence only; only shortlisted variants should be persisted into DB later.',
        ],
    });
}

main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    printUsage();
    process.exit(1);
});
