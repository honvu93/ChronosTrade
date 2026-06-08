import {
    DomainFailureItem,
    DomainStatus,
    FailureClassificationSnapshot,
    FailureDomain,
    FailureSeverity,
} from "@/types/trading";

// ---------------------------------------------------------------------------
// Domain meta
// ---------------------------------------------------------------------------

const DOMAIN_LABELS: Record<FailureDomain, string> = {
    ingestion: "Data Ingestion",
    signal:    "Signal Execution",
    alert:     "Alert Evaluation",
    trading:   "Live Trading",
};

const DOMAIN_DESCRIPTIONS: Record<FailureDomain, string> = {
    ingestion: "Price candle feed freshness across all symbols and timeframes.",
    signal:    "Signal indicator instances linked to backtest runs.",
    alert:     "Backtest-run failures that affect alert re-evaluation.",
    trading:   "Live signal indicator instances running outside a backtest context.",
};

// ---------------------------------------------------------------------------
// Per-item view
// ---------------------------------------------------------------------------

export interface FailureItemView {
    id: string;
    domain: FailureDomain;
    severity: FailureSeverity;
    severityLabel: string;
    severityTone: "danger" | "caution";
    title: string;
    detail: string;
    detectedAt: string;
    signalCode: string | null;
    signalVersion: number | null;
    backtestRunId: string | null;
    indicatorInstanceId: string | null;
    symbol: string | null;
    timeframe: string | null;
    isInspectable: boolean;
    canInvestigate: boolean;
}

export interface DomainStatusView {
    domain: FailureDomain;
    domainLabel: string;
    domainDescription: string;
    severity: FailureSeverity;
    severityLabel: string;
    tone: "danger" | "caution" | "success";
    items: FailureItemView[];
    itemCount: number;
    hasItems: boolean;
}

export interface FailureClassificationViewModel {
    headline: string;
    summaryTone: "danger" | "caution" | "success";
    totalCritical: number;
    totalWarning: number;
    hasAnyFailure: boolean;
    allClear: boolean;
    domains: DomainStatusView[];
    evaluatedAt: string;
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const severityTone = (s: FailureSeverity): "danger" | "caution" | "success" =>
    s === "critical" ? "danger" : s === "warning" ? "caution" : "success";

const severityLabel = (s: FailureSeverity): string =>
    s === "critical" ? "Critical" : s === "warning" ? "Warning" : "OK";

const itemSeverityLabel = (s: FailureSeverity): string =>
    s === "critical" ? "CRITICAL" : "WARNING";

const itemSeverityTone = (s: FailureSeverity): "danger" | "caution" =>
    s === "critical" ? "danger" : "caution";

function formatDetectedAt(iso: string): string {
    try {
        return new Date(iso).toLocaleString();
    } catch {
        return iso;
    }
}

export function buildDomainStatusView(
    domain: FailureDomain,
    status: DomainStatus,
): DomainStatusView {
    const items: FailureItemView[] = status.items.map((item: DomainFailureItem) => ({
        id: item.id,
        domain: item.domain,
        severity: item.severity,
        severityLabel: itemSeverityLabel(item.severity),
        severityTone: itemSeverityTone(item.severity),
        title: item.title,
        detail: item.detail,
        detectedAt: formatDetectedAt(item.detectedAt),
        signalCode: item.signalCode ?? null,
        signalVersion: item.signalVersion ?? null,
        backtestRunId: item.backtestRunId ?? null,
        indicatorInstanceId: item.indicatorInstanceId ?? null,
        symbol: item.symbol ?? null,
        timeframe: item.timeframe ?? null,
        isInspectable: Boolean(item.signalCode && item.signalVersion !== null && item.signalVersion !== undefined),
        canInvestigate: Boolean(
            item.signalCode
            && item.signalVersion !== null
            && item.signalVersion !== undefined
            && item.backtestRunId,
        ),
    }));

    return {
        domain,
        domainLabel: DOMAIN_LABELS[domain],
        domainDescription: DOMAIN_DESCRIPTIONS[domain],
        severity: status.severity,
        severityLabel: severityLabel(status.severity),
        tone: severityTone(status.severity),
        items,
        itemCount: items.length,
        hasItems: items.length > 0,
    };
}

export function buildFailureClassificationView(
    snapshot: FailureClassificationSnapshot,
): FailureClassificationViewModel {
    const DOMAINS: FailureDomain[] = ["ingestion", "signal", "alert", "trading"];

    const domains = DOMAINS.map((d) =>
        buildDomainStatusView(d, snapshot.domains[d]),
    );

    const hasAnyFailure = snapshot.totalCritical > 0 || snapshot.totalWarning > 0;

    let headline: string;
    let summaryTone: FailureClassificationViewModel["summaryTone"];

    if (snapshot.totalCritical > 0) {
        summaryTone = "danger";
        headline = `${snapshot.totalCritical} critical failure${snapshot.totalCritical === 1 ? "" : "s"} detected across domains.`;
    } else if (snapshot.totalWarning > 0) {
        summaryTone = "caution";
        headline = `${snapshot.totalWarning} warning${snapshot.totalWarning === 1 ? "" : "s"} detected - no critical failures.`;
    } else {
        summaryTone = "success";
        headline = "All domains healthy - no failures detected.";
    }

    return {
        headline,
        summaryTone,
        totalCritical: snapshot.totalCritical,
        totalWarning: snapshot.totalWarning,
        hasAnyFailure,
        allClear: !hasAnyFailure,
        domains,
        evaluatedAt: snapshot.evaluatedAt,
    };
}
