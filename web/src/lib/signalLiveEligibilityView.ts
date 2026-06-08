import {
    SignalBlockingReason,
    SignalEligibilityState,
    SignalLiveEligibilityItem,
} from "@/types/trading";

export interface SignalEligibilityCardView {
    signalCode: string;
    signalVersion: number;
    signalName: string;
    codeLabel: string;
    backtestRunId: string | null;
    backtestRunName: string | null;
    backtestRunStatus: string | null;
    eligibilityState: SignalEligibilityState;
    stateLabel: string;
    stateTone: "success" | "caution" | "danger" | "neutral";
    metricsAvailable: boolean;
    closedTradesLabel: string;
    netRLabel: string;
    profitFactorLabel: string;
    maxDrawdownLabel: string;
    winRateLabel: string;
    // Enhancements (2.3)
    frequencyLabel: string | null;       // e.g. "~0.5/day"
    rrRatioLabel: string | null;          // e.g. "1.5 : 1"
    confidenceTier: "HIGH" | "VALIDATED" | "LIMITED" | null;
    blockingReasons: SignalBlockingReason[];
    hasBlockingReasons: boolean;
    canProceedToActivation: boolean;
}

export interface SignalEligibilityListViewModel {
    totalCount: number;
    liveEligibleCount: number;
    validatedCount: number;
    blockedCount: number;
    draftCount: number;
    noBacktestCount: number;
    headline: string;
    summaryLine: string;
    cards: SignalEligibilityCardView[];
}

const stateLabels: Record<SignalEligibilityState, string> = {
    "live-eligible": "Live-Eligible",
    validated: "Validated",
    blocked: "Blocked",
    draft: "Draft",
    "no-backtest": "No Backtest",
};

const stateTones: Record<SignalEligibilityState, SignalEligibilityCardView["stateTone"]> = {
    "live-eligible": "success",
    validated: "caution",
    blocked: "danger",
    draft: "neutral",
    "no-backtest": "neutral",
};

const formatR = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}R`;
const formatPct = (value: number) => `${value.toFixed(1)}%`;

export const buildSignalEligibilityCardView = (item: SignalLiveEligibilityItem): SignalEligibilityCardView => {
    const m = item.metrics;
    const frequencyLabel = m?.estimatedTradesPerDay != null
        ? `~${m.estimatedTradesPerDay.toFixed(1)}/day`
        : null;

    const rrRatioLabel = m?.avgWinR != null && m?.avgLossR != null && m.avgLossR > 0
        ? `${(m.avgWinR / m.avgLossR).toFixed(1)} : 1`
        : m?.avgWinR != null
            ? `${m.avgWinR.toFixed(1)}R avg win`
            : null;

    return {
        signalCode: item.signalCode,
        signalVersion: item.signalVersion,
        signalName: item.signalName,
        codeLabel: `${item.signalCode}@v${item.signalVersion}`,
        backtestRunId: item.backtestRunId,
        backtestRunName: item.backtestRunName,
        backtestRunStatus: item.backtestRunStatus,
        eligibilityState: item.eligibilityState,
        stateLabel: stateLabels[item.eligibilityState],
        stateTone: stateTones[item.eligibilityState],
        metricsAvailable: m !== null,
        closedTradesLabel: m ? `${m.closedTrades} closed` : "-",
        netRLabel: m ? formatR(m.netR) : "-",
        profitFactorLabel: m ? m.profitFactor.toFixed(2) : "-",
        maxDrawdownLabel: m ? formatPct(m.maxDrawdownPct) : "-",
        winRateLabel: m ? `${(m.winRate * 100).toFixed(1)}%` : "-",
        frequencyLabel,
        rrRatioLabel,
        confidenceTier: m?.confidenceTier ?? null,
        blockingReasons: item.blockingReasons,
        hasBlockingReasons: item.blockingReasons.length > 0,
        canProceedToActivation: item.eligibilityState === "live-eligible",
    };
};

export const buildSignalEligibilityListView = (items: SignalLiveEligibilityItem[]): SignalEligibilityListViewModel => {
    const liveEligibleCount = items.filter((i) => i.eligibilityState === "live-eligible").length;
    const validatedCount = items.filter((i) => i.eligibilityState === "validated").length;
    const blockedCount = items.filter((i) => i.eligibilityState === "blocked").length;
    const draftCount = items.filter((i) => i.eligibilityState === "draft").length;
    const noBacktestCount = items.filter((i) => i.eligibilityState === "no-backtest").length;

    const headline = liveEligibleCount > 0
        ? `${liveEligibleCount} signal${liveEligibleCount === 1 ? "" : "s"} ready for live activation review.`
        : validatedCount > 0
            ? `${validatedCount} signal${validatedCount === 1 ? "" : "s"} validated - not yet live-eligible.`
            : "No signals are live-eligible or validated yet.";

    const parts: string[] = [];
    if (liveEligibleCount > 0) parts.push(`${liveEligibleCount} live-eligible`);
    if (validatedCount > 0) parts.push(`${validatedCount} validated`);
    if (blockedCount > 0) parts.push(`${blockedCount} blocked`);
    if (draftCount > 0) parts.push(`${draftCount} draft`);
    if (noBacktestCount > 0) parts.push(`${noBacktestCount} no backtest`);

    const summaryLine = parts.length > 0 ? parts.join(", ") : "No signal definitions found.";

    return {
        totalCount: items.length,
        liveEligibleCount,
        validatedCount,
        blockedCount,
        draftCount,
        noBacktestCount,
        headline,
        summaryLine,
        cards: items.map(buildSignalEligibilityCardView),
    };
};
