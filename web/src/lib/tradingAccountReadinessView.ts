import {
    AccountReadinessCheckItem,
    AccountReadinessSnapshot,
    AccountReadinessState,
} from "@/types/trading";

export interface AccountReadinessCardView {
    state: AccountReadinessState;
    stateLabel: string;
    stateTone: "success" | "caution" | "danger" | "neutral";
    headline: string;
    summary: string;
    accountLabel: string;
    accountModeLabel: string;
    mt5LoginLabel: string;
    mt5ServerLabel: string;
    bridgePortLabel: string;
    checks: AccountReadinessCheckItem[];
    passedCount: number;
    totalCount: number;
    blockingReasons: string[];
    hasBlockingReasons: boolean;
    canProceedToActivation: boolean;
}

const stateLabels: Record<AccountReadinessState, string> = {
    ready: "Ready",
    "execution-blocked": "Execution Blocked",
    "credentials-missing": "Not Configured",
    "credentials-partial": "Incomplete",
    "bridge-unreachable": "Bridge Unreachable",
    unchecked: "Unchecked",
};

const stateTones: Record<AccountReadinessState, AccountReadinessCardView["stateTone"]> = {
    ready: "success",
    "execution-blocked": "danger",
    "credentials-missing": "danger",
    "credentials-partial": "caution",
    "bridge-unreachable": "caution",
    unchecked: "neutral",
};

const stateHeadlines: Record<AccountReadinessState, string> = {
    ready: "MT5 account is configured and reachable.",
    "execution-blocked": "MT5 credentials are valid, but the execution terminal is blocking trading.",
    "credentials-missing": "No MT5 account is connected for this user.",
    "credentials-partial": "The saved MT5 account is incomplete.",
    "bridge-unreachable": "MT5 credentials are saved but the bridge is unreachable.",
    unchecked: "Account readiness has not been checked yet.",
};

const stateSummaries: Record<AccountReadinessState, string> = {
    ready: "All required credentials and infrastructure are in place. This user account is ready for trading-read connectivity.",
    "execution-blocked": "The bridge is reachable, but terminal-side settings such as AutoTrading or external API permissions are blocking order execution.",
    "credentials-missing": "Connect an MT5 login, password, and server for this user before any trading-read review can rely on broker context.",
    "credentials-partial": "Some saved MT5 fields or infrastructure settings are missing. Review the checks below and resolve all blocking items.",
    "bridge-unreachable": "The MT5 bridge service is not responding. Ensure the mt5-service process is running and the bridge port is correct.",
    unchecked: "Refresh to evaluate account readiness against current configuration.",
};

export function buildAccountReadinessCardView(
    snapshot: AccountReadinessSnapshot | null,
): AccountReadinessCardView {
    if (!snapshot) {
        return {
            state: "unchecked",
            stateLabel: stateLabels.unchecked,
            stateTone: stateTones.unchecked,
            headline: stateHeadlines.unchecked,
            summary: stateSummaries.unchecked,
            accountLabel: "No account",
            accountModeLabel: "-",
            mt5LoginLabel: "-",
            mt5ServerLabel: "-",
            bridgePortLabel: "-",
            checks: [],
            passedCount: 0,
            totalCount: 0,
            blockingReasons: [],
            hasBlockingReasons: false,
            canProceedToActivation: false,
        };
    }

    const passedCount = snapshot.checks.filter((c) => c.passed).length;
    const accountLabel = snapshot.accountLabel ?? "No account";
    const accountModeLabel = snapshot.accountMode === "PAPER"
        ? "Paper / MT5 Demo"
        : snapshot.accountMode === "LIVE"
            ? "Live"
            : "-";

    return {
        state: snapshot.state,
        stateLabel: stateLabels[snapshot.state],
        stateTone: stateTones[snapshot.state],
        headline: snapshot.accountLabel
            ? `${snapshot.accountLabel}: ${stateHeadlines[snapshot.state]}`
            : stateHeadlines[snapshot.state],
        summary: snapshot.accountLabel
            ? `${stateSummaries[snapshot.state]} Current account: ${snapshot.accountLabel}${snapshot.accountMode ? ` (${accountModeLabel})` : ""}.`
            : stateSummaries[snapshot.state],
        accountLabel,
        accountModeLabel,
        mt5LoginLabel: snapshot.mt5Login ?? "-",
        mt5ServerLabel: snapshot.mt5Server ?? "-",
        bridgePortLabel: snapshot.bridgePort ?? "-",
        checks: snapshot.checks,
        passedCount,
        totalCount: snapshot.checks.length,
        blockingReasons: snapshot.blockingReasons,
        hasBlockingReasons: snapshot.blockingReasons.length > 0,
        canProceedToActivation: snapshot.state === "ready",
    };
}
