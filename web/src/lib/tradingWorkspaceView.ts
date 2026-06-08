import {
    TradingAutomationSnapshot,
    TradingExecutionCommandView,
    TradingFeatureFlagSnapshot,
    TradingWorkspaceSummary,
} from "@/types/trading";

export interface TradingWorkspaceLaneView {
    enabled: boolean;
    label: string;
    message: string;
}

export interface TradingWorkspaceViewModel {
    syncLabel: string;
    syncTone: "success" | "caution" | "danger" | "neutral";
    summaryLine: string;
    staleWarning: string | null;
    writeLane: TradingWorkspaceLaneView;
    automationLane: TradingWorkspaceLaneView;
    latestCommandLabel: string;
}

export function shouldBootstrapTradingMirrorSync({
    summary,
    syncRunsCount,
}: {
    summary: TradingWorkspaceSummary;
    syncRunsCount: number;
}): boolean {
    return Boolean(
        summary.syncHealth.canForceSync
        && summary.syncHealth.lastSuccessfulSyncAt === null
        && summary.syncHealth.lastSyncAttemptAt === null
        && syncRunsCount === 0,
    );
}

export function buildTradingWorkspaceView({
    summary,
    featureFlags,
    automation,
    commands,
}: {
    summary: TradingWorkspaceSummary;
    featureFlags: TradingFeatureFlagSnapshot | null;
    automation: TradingAutomationSnapshot | null;
    commands: TradingExecutionCommandView[];
}): TradingWorkspaceViewModel {
    const accountModeLabel = summary.accountMode === "PAPER" ? "Paper" : "Live";
    const brokerActionLabel = summary.accountMode === "PAPER" ? "Paper broker actions" : "Manual broker actions";
    const automationLabel = summary.accountMode === "PAPER" ? "Paper automation controls" : "Automation controls";
    const syncTone = summary.syncHealth.state === "healthy"
        ? "success"
        : summary.syncHealth.state === "stale"
            ? "caution"
            : summary.syncHealth.state === "failed"
                ? "danger"
                : "neutral";

    const writeEnabled = Boolean(
        featureFlags?.capabilities.write.enabled
        && summary.syncHealth.canTrade,
    );
    const automationEnabled = Boolean(
        featureFlags?.capabilities.automation.enabled
        && summary.syncHealth.canTrade,
    );

    const latestCommand = commands[0] ?? null;
    const staleWarning = summary.syncHealth.state === "stale" || summary.syncHealth.state === "failed"
        ? summary.syncHealth.message
        : summary.syncHealth.state === "disconnected"
            ? "Historical mirror data remains visible, but broker truth cannot be refreshed until connectivity recovers."
            : null;

    return {
        syncLabel: summary.syncHealth.label,
        syncTone,
        summaryLine: `${accountModeLabel} account | ${summary.mt5Server ?? "Server n/a"} | ${summary.openPositionCount} open positions | ${summary.pendingOrderCount} pending orders`,
        staleWarning,
        writeLane: writeEnabled
            ? {
                enabled: true,
                label: `${brokerActionLabel} enabled`,
                message: summary.accountMode === "PAPER"
                    ? "Open, close, modify, cancel, and force-sync controls can route through the approved command boundary against the paper/demo MT5 account."
                    : "Open, close, modify, cancel, and force-sync controls can route through the approved command boundary.",
            }
            : {
                enabled: false,
                label: `${brokerActionLabel} blocked`,
                message: !featureFlags?.capabilities.write.enabled
                    ? "FEATURE_TRADING_WRITE is off, so write controls stay visible but disabled."
                    : summary.syncHealth.message,
            },
        automationLane: automationEnabled
            ? {
                enabled: true,
                label: `${automationLabel} enabled`,
                message: automation?.autoExecuteLocked
                    ? `Bindings and approval controls are available for this ${summary.accountMode === "PAPER" ? "paper" : "live"} account, but auto-execute remains locked behind guardrails.`
                    : summary.accountMode === "PAPER"
                        ? "Bindings, approval controls, and paper auto-execute are available for this demo account through the dedicated auto-execution worker."
                        : "Bindings and approval controls are available for this account.",
            }
            : {
                enabled: false,
                label: `${automationLabel} blocked`,
                message: !featureFlags?.capabilities.automation.enabled
                    ? "FEATURE_TRADING_AUTO is off, so automation stays inspectable but not mutable."
                    : summary.syncHealth.message,
            },
        latestCommandLabel: latestCommand
            ? `${latestCommand.commandType} | ${latestCommand.status}`
            : "No command activity recorded yet.",
    };
}
