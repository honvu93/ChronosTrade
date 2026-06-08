import { TradingCapabilityTier, TradingFeatureFlagKey, TradingFeatureFlagSnapshot } from "@/types/trading";

export type TradingIntent = TradingCapabilityTier;

export interface TradingCapabilityCardView {
    tier: TradingCapabilityTier;
    title: string;
    stateLabel: string;
    enabled: boolean;
    requested: boolean;
    reason: string;
    blockedByLabels: string[];
    actionLabel: string;
}

export interface TradingAccessViewModel {
    headline: string;
    summary: string;
    highestTierLabel: string;
    readLaneTitle: string;
    readLaneSummary: string;
    killSwitches: Array<{
        key: TradingFeatureFlagKey;
        label: string;
        enabled: boolean;
    }>;
    capabilities: TradingCapabilityCardView[];
}

const tierLabels: Record<TradingCapabilityTier, string> = {
    read: "Read",
    write: "Write",
    automation: "Automation",
};

const flagLabels: Record<TradingFeatureFlagKey, string> = {
    trading_read_enabled: "FEATURE_TRADING_READ",
    trading_write_enabled: "FEATURE_TRADING_WRITE",
    trading_automation_enabled: "FEATURE_TRADING_AUTO",
};

const actionLabels: Record<TradingCapabilityTier, string> = {
    read: "Review live readiness",
    write: "Check manual write lane",
    automation: "Check automation lane",
};

const highestTierLabels: Record<TradingCapabilityTier | "none", string> = {
    none: "No trading tier",
    read: "Read tier",
    write: "Write tier",
    automation: "Automation tier",
};

export const buildTradingAccessView = ({
    symbol,
    timeframe,
    snapshot,
}: {
    symbol: string;
    timeframe: string;
    snapshot: TradingFeatureFlagSnapshot | null;
}): TradingAccessViewModel => {
    if (!snapshot) {
        return {
            headline: "Trading runtime guard is loading.",
            summary: `Fetching runtime feature flags for ${symbol} ${timeframe} before exposing any live-trading lane.`,
            highestTierLabel: highestTierLabels.none,
            readLaneTitle: "Read lane pending",
            readLaneSummary: "Wait for runtime trading flags before opening readiness, write, or automation paths.",
            killSwitches: [
                { key: "trading_read_enabled", label: flagLabels.trading_read_enabled, enabled: false },
                { key: "trading_write_enabled", label: flagLabels.trading_write_enabled, enabled: false },
                { key: "trading_automation_enabled", label: flagLabels.trading_automation_enabled, enabled: false },
            ],
            capabilities: (["read", "write", "automation"] as TradingCapabilityTier[]).map((tier) => ({
                tier,
                title: tierLabels[tier],
                stateLabel: "Pending",
                enabled: false,
                requested: false,
                reason: "Runtime flags are still loading.",
                blockedByLabels: [],
                actionLabel: actionLabels[tier],
            })),
        };
    }

    const readEnabled = snapshot.capabilities.read.enabled;

    return {
        headline: readEnabled
            ? "Trading route is visible with runtime guardrails."
            : "Trading route remains visible, but live-trading read access is blocked.",
        summary: readEnabled
            ? `Current context ${symbol} ${timeframe}. Runtime gating opens trading surfaces only up to ${highestTierLabels[snapshot.highestEnabledTier].toLowerCase()}, so later write and automation lanes stay honest.`
            : `Current context ${symbol} ${timeframe}. FEATURE_TRADING_READ is off, so readiness, command, and automation flows stop before live escalation.`,
        highestTierLabel: highestTierLabels[snapshot.highestEnabledTier],
        readLaneTitle: readEnabled ? "Read lane available" : "Read lane blocked",
        readLaneSummary: readEnabled
            ? "You can inspect readiness and control-plane context without exposing write-capable actions."
            : snapshot.capabilities.read.reason,
        killSwitches: [
            {
                key: "trading_read_enabled",
                label: flagLabels.trading_read_enabled,
                enabled: snapshot.flags.trading_read_enabled,
            },
            {
                key: "trading_write_enabled",
                label: flagLabels.trading_write_enabled,
                enabled: snapshot.flags.trading_write_enabled,
            },
            {
                key: "trading_automation_enabled",
                label: flagLabels.trading_automation_enabled,
                enabled: snapshot.flags.trading_automation_enabled,
            },
        ],
        capabilities: (["read", "write", "automation"] as TradingCapabilityTier[]).map((tier) => {
            const capability = snapshot.capabilities[tier];

            return {
                tier,
                title: tierLabels[tier],
                stateLabel: capability.enabled ? "Enabled" : "Blocked",
                enabled: capability.enabled,
                requested: capability.requested,
                reason: capability.reason,
                blockedByLabels: capability.blockedBy.map((key) => flagLabels[key]),
                actionLabel: actionLabels[tier],
            };
        }),
    };
};

export const buildTradingIntentFallback = (
    snapshot: TradingFeatureFlagSnapshot | null,
    intent: TradingIntent,
): {
    title: string;
    message: string;
} => {
    if (!snapshot) {
        return {
            title: `${tierLabels[intent]} tier unavailable`,
            message: "Runtime flags are still loading. Refresh trading access before retrying.",
        };
    }

    const capability = snapshot.capabilities[intent];
    if (capability.enabled) {
        return {
            title: `${tierLabels[intent]} tier enabled`,
            message: intent === "read"
                ? "Read-only trading visibility is available. Later Epic 4 stories will attach readiness and activation details onto this lane."
                : capability.reason,
        };
    }

    return {
        title: `${tierLabels[intent]} tier blocked`,
        message: capability.reason,
    };
};
