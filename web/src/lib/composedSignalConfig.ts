import {
    ComposedExitManagementProfileCode,
    ComposedMatchMode,
    ComposedSide,
    ComposedSignalBlocks,
    ComposedSlType,
    ComposedTpType,
} from "@/types/signals";

export type ComposerValidationSection = "entry" | "protection" | "exit";

export interface ComposerValidationIssue {
    field: string;
    section: ComposerValidationSection;
    message: string;
}

export interface ComposerValidationInput {
    name: string;
    symbol: string;
    timeframe: string;
    matchMode: ComposedMatchMode;
    windowBars: number;
    side: ComposedSide;
    stopLossType: ComposedSlType;
    stopLossValue: number;
    stopLossLookback: number;
    takeProfitType: ComposedTpType;
    takeProfitValue: number;
    exitManagementProfile: ComposedExitManagementProfileCode;
    blockCount: number;
}

interface ExitProfileOption {
    value: ComposedExitManagementProfileCode;
    label: string;
    description: string;
}

const VALID_TIMEFRAMES = new Set(["M1", "M5", "M15", "M30", "H1", "H4", "D1"]);

export const EXIT_PROFILE_OPTIONS: ExitProfileOption[] = [
    {
        value: "HARD_SIGNAL_TP",
        label: "Signal target only",
        description: "Hold until the configured stop loss or the signal-defined target is reached.",
    },
    {
        value: "FIXED_2R",
        label: "Fixed 2R target",
        description: "Override the exit with a fixed 2R target while keeping the configured stop loss.",
    },
    {
        value: "BE_1R_TP_2R",
        label: "Break-even at 1R → TP 2R",
        description: "Move the stop to break-even after 1R, then close the trade at 2R.",
    },
    {
        value: "PARTIAL_1R_BE_R3",
        label: "50% at 1R → BE → TP 3R",
        description: "Take 50% off at 1R, move the stop to break-even, then target 3R on the remainder.",
    },
    {
        value: "BE_1R_TRAIL_2R_3R",
        label: "BE at 1R → Trail at 2R, 3R",
        description: "Move stop to break-even at 1R, then ratchet stop to 1R at 2R and 2R at 3R.",
    },
    {
        value: "BE_1R_PARTIAL_2R_TRAIL",
        label: "3-Stage: BE → Partial → Trail",
        description: "Move SL to break-even at 1R, take 50% at 2R, then trail the remainder with progressive stops.",
    },
    {
        value: "PARTIAL_1R_BE_SWING_TRAIL",
        label: "50% at 1R → BE → Swing Trail",
        description: "Take 50% at 1R, move stop to break-even, then trail behind 12-bar structure highs/lows.",
    },
    {
        value: "XAU_NY_CLOSE",
        label: "TP 2R / NY Session Close",
        description: "Target 2R with BE at 1R, but force-close at 21:00 UTC (NY session end) to avoid swap risks.",
    },
    {
        value: "TIME_24",
        label: "Time stop after 24 bars",
        description: "Hold until stop, target, or a forced close after 24 bars in trade.",
    },
];

const isFiniteNumber = (value: number) => Number.isFinite(value);

const formatPercent = (fraction: number) => `${trimNumber(fraction * 100)}%`;

const trimNumber = (value: number) => {
    const rounded = Number(value.toFixed(4));
    return Number.isInteger(rounded) ? String(rounded) : rounded.toString();
};

export const normalizeDisplayPercent = (fraction: number | undefined, fallback: number) => {
    if (typeof fraction !== "number" || !Number.isFinite(fraction)) {
        return fallback;
    }

    return Number((fraction * 100).toFixed(4));
};

export const toStoredPercentFraction = (percentValue: number) => Number((percentValue / 100).toFixed(6));

export const getExitProfileOption = (profileCode: ComposedExitManagementProfileCode) => (
    EXIT_PROFILE_OPTIONS.find((option) => option.value === profileCode)
);

export const describeStopLossPlan = (stopLoss: ComposedSignalBlocks["stopLoss"]) => {
    if (stopLoss.type === "FIXED_PERCENT") {
        return `Fixed stop ${formatPercent(stopLoss.value)} away from entry.`;
    }

    const lookback = stopLoss.lookback ?? 20;
    return `Structure break with ${formatPercent(stopLoss.value)} protective buffer and ${trimNumber(lookback)}-bar lookback.`;
};

export const describeTakeProfitPlan = (takeProfit: ComposedSignalBlocks["takeProfit"]) => {
    if (takeProfit.type === "R_MULTIPLE") {
        return `Take profit at ${trimNumber(takeProfit.value)}R from entry risk.`;
    }

    return `Take profit ${formatPercent(takeProfit.value)} away from entry.`;
};

export const describeExitManagementPlan = (profileCode: ComposedExitManagementProfileCode) => (
    getExitProfileOption(profileCode)?.description ?? "Exit management profile is unavailable."
);

export const describeEntryWindow = (definition: Pick<ComposedSignalBlocks, "matchMode" | "windowBars" | "side" | "blocks">) => {
    const conditionCount = definition.blocks.length;
    const modeLabel = definition.matchMode === "ALL"
        ? "All conditions confirm together"
        : definition.matchMode === "ANY"
            ? "Any listed condition can trigger"
            : "Conditions must trigger in order";

    return `${definition.side} setup. ${modeLabel} across ${trimNumber(definition.windowBars)} bar${definition.windowBars === 1 ? "" : "s"} and ${trimNumber(conditionCount)} condition${conditionCount === 1 ? "" : "s"}.`;
};

export const validateComposerConfiguration = (input: ComposerValidationInput): ComposerValidationIssue[] => {
    const issues: ComposerValidationIssue[] = [];

    if (!input.name.trim()) {
        issues.push({
            field: "name",
            section: "entry",
            message: "Signal name is required before you can continue.",
        });
    }

    if (!input.symbol.trim()) {
        issues.push({
            field: "symbol",
            section: "entry",
            message: "Choose the market symbol this signal belongs to.",
        });
    }

    if (!VALID_TIMEFRAMES.has(input.timeframe)) {
        issues.push({
            field: "timeframe",
            section: "entry",
            message: "Select a supported timeframe for this signal.",
        });
    }

    if (!["ALL", "ANY", "SEQUENCE"].includes(input.matchMode)) {
        issues.push({
            field: "matchMode",
            section: "entry",
            message: "Pick how your entry conditions should combine.",
        });
    }

    if (!isFiniteNumber(input.windowBars) || input.windowBars < 1 || !Number.isInteger(input.windowBars)) {
        issues.push({
            field: "windowBars",
            section: "entry",
            message: "Entry confirmation window must be a whole number of 1 bar or more.",
        });
    }

    if (!["LONG", "SHORT"].includes(input.side)) {
        issues.push({
            field: "side",
            section: "entry",
            message: "Choose whether the signal trades long or short.",
        });
    }

    if (input.blockCount < 1) {
        issues.push({
            field: "blocks",
            section: "entry",
            message: "Add at least 1 condition in the composition canvas before saving.",
        });
    }

    if (!["FIXED_PERCENT", "BELOW_STRUCTURE"].includes(input.stopLossType)) {
        issues.push({
            field: "stopLossType",
            section: "protection",
            message: "Pick how the stop loss should protect the trade.",
        });
    }

    if (!isFiniteNumber(input.stopLossValue) || input.stopLossValue <= 0) {
        issues.push({
            field: "stopLossValue",
            section: "protection",
            message: input.stopLossType === "BELOW_STRUCTURE"
                ? "Protective buffer must be greater than 0%."
                : "Stop-loss distance must be greater than 0%.",
        });
    }

    if (input.stopLossType === "BELOW_STRUCTURE" && (!isFiniteNumber(input.stopLossLookback) || input.stopLossLookback < 1 || !Number.isInteger(input.stopLossLookback))) {
        issues.push({
            field: "stopLossLookback",
            section: "protection",
            message: "Structure-based stops need a whole-number lookback of at least 1 bar.",
        });
    }

    if (!["FIXED_PERCENT", "R_MULTIPLE"].includes(input.takeProfitType)) {
        issues.push({
            field: "takeProfitType",
            section: "exit",
            message: "Pick how profit targets should be measured.",
        });
    }

    if (!isFiniteNumber(input.takeProfitValue) || input.takeProfitValue <= 0) {
        issues.push({
            field: "takeProfitValue",
            section: "exit",
            message: input.takeProfitType === "R_MULTIPLE"
                ? "Profit target must be greater than 0R."
                : "Profit target distance must be greater than 0%.",
        });
    }

    if (!getExitProfileOption(input.exitManagementProfile)) {
        issues.push({
            field: "exitManagementProfile",
            section: "exit",
            message: "Choose how the position should be managed after entry.",
        });
    }

    return issues;
};
