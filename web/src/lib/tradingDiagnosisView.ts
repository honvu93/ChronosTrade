import {
    TradingDiagnosisCategoryAssessment,
    TradingDiagnosisEvidence,
    TradingDiagnosisSnapshot,
} from "@/types/trading";

type Tone = "danger" | "accent" | "success" | "neutral";

export interface TradingDiagnosisEvidenceView {
    id: string;
    title: string;
    detail: string;
    severityLabel: string;
    tone: Tone;
    sourceLabel: string;
    sectionLabel: string;
    linkedRecordLabel: string;
    targetId: string | null;
    targetLabel: string | null;
    href: string | null;
    hrefLabel: string | null;
}

export interface TradingDiagnosisCategoryView {
    category: TradingDiagnosisCategoryAssessment["category"];
    label: string;
    confidenceLabel: string;
    scoreLabel: string;
    tone: Tone;
    summary: string;
    evidenceCountLabel: string;
    evidence: TradingDiagnosisEvidenceView[];
}

export interface TradingDiagnosisHistoryView {
    id: string;
    outcomeLabel: string;
    outcomeTone: Tone;
    categoryLabel: string;
    decidedAtLabel: string;
    summary: string;
    investigationLabel: string | null;
    scoreLabel: string | null;
    confidenceLabel: string | null;
    tradeRecordId: string | null;
    linkedFacts: Array<{
        label: string;
        value: string;
    }>;
    evidence: TradingDiagnosisEvidenceView[];
}

export interface TradingDiagnosisViewModel {
    title: string;
    signalKey: string;
    primaryLabel: string;
    primaryTone: Tone;
    candidates: TradingDiagnosisCategoryView[];
    history: TradingDiagnosisHistoryView[];
}

const evidenceTone = (severity: TradingDiagnosisEvidence["severity"]): Tone =>
    severity === "critical"
        ? "danger"
        : severity === "warning"
            ? "accent"
            : "neutral";

const evidenceSeverityLabel = (severity: TradingDiagnosisEvidence["severity"]) =>
    severity === "critical"
        ? "Critical"
        : severity === "warning"
            ? "Warning"
            : "Info";

const confidenceLabel = (confidence: TradingDiagnosisCategoryAssessment["confidence"]) =>
    confidence === "high"
        ? "High confidence"
        : confidence === "medium"
            ? "Medium confidence"
            : "Low confidence";

const sourceLabels: Record<TradingDiagnosisEvidence["source"], string> = {
    "failure-classification": "Failure Classification",
    discrepancy: "Discrepancy Review",
    eligibility: "Validation Gate",
    "account-readiness": "Broker Readiness",
};

const sectionLabels: Record<TradingDiagnosisEvidence["sectionKey"], string> = {
    differences: "Differences",
    backtest: "Backtest",
    live: "Live Context",
    timeline: "Timeline",
    account: "Account",
    history: "History",
};

const sectionTargets: Record<TradingDiagnosisEvidence["sectionKey"], { id: string; label: string }> = {
    differences: {
        id: "trading-discrepancy-differences",
        label: "Jump to differences",
    },
    backtest: {
        id: "trading-discrepancy-backtest",
        label: "Jump to backtest evidence",
    },
    live: {
        id: "trading-discrepancy-live",
        label: "Jump to live context",
    },
    timeline: {
        id: "trading-discrepancy-live",
        label: "Jump to live timeline",
    },
    account: {
        id: "trading-investigation-evidence",
        label: "Jump to diagnosis evidence",
    },
    history: {
        id: "trading-investigation-history",
        label: "Jump to outcome history",
    },
};

const outcomeTone = (outcome: TradingDiagnosisSnapshot["history"][number]["outcome"]): Tone =>
    outcome === "resolved"
        ? "success"
        : outcome === "mitigated"
            ? "accent"
            : "danger";

const outcomeLabel = (outcome: TradingDiagnosisSnapshot["history"][number]["outcome"]) =>
    outcome === "resolved"
        ? "Resolved"
        : outcome === "mitigated"
            ? "Mitigated"
            : "Escalated";

const investigationKindLabel = (kind: TradingDiagnosisSnapshot["investigationKind"]) =>
    kind === "reported-issue"
        ? "Reported Issue"
        : kind === "mixed-context"
            ? "Mixed Context"
            : "Alert Investigation";

const formatDateTime = (value: string) => {
    try {
        return new Date(value).toLocaleString();
    } catch {
        return value;
    }
};

export function buildTradingDiagnosisView(snapshot: TradingDiagnosisSnapshot): TradingDiagnosisViewModel {
    return {
        title: snapshot.signalName ?? snapshot.linkedRecords.signalKey,
        signalKey: snapshot.linkedRecords.signalKey,
        primaryLabel: snapshot.primaryCategory
            ? snapshot.categories.find((candidate) => candidate.category === snapshot.primaryCategory)?.label ?? "Diagnosis"
            : "Diagnosis pending",
        primaryTone: snapshot.primaryCategory
            ? evidenceTone(snapshot.categories.find((candidate) => candidate.category === snapshot.primaryCategory)?.severity ?? "info")
            : "neutral",
        candidates: snapshot.categories.map((candidate) => ({
            category: candidate.category,
            label: candidate.label,
            confidenceLabel: confidenceLabel(candidate.confidence),
            scoreLabel: `${candidate.score} evidence score`,
            tone: evidenceTone(candidate.severity),
            summary: candidate.summary,
            evidenceCountLabel: `${candidate.evidence.length} linked evidence item${candidate.evidence.length === 1 ? "" : "s"}`,
            evidence: candidate.evidence.map((evidence) => ({
                id: evidence.id,
                title: evidence.title,
                detail: evidence.detail,
                severityLabel: evidenceSeverityLabel(evidence.severity),
                tone: evidenceTone(evidence.severity),
                sourceLabel: sourceLabels[evidence.source],
                sectionLabel: sectionLabels[evidence.sectionKey],
                linkedRecordLabel: evidence.linkedRecordLabel,
                targetId: sectionTargets[evidence.sectionKey].id,
                targetLabel: sectionTargets[evidence.sectionKey].label,
                href: evidence.href,
                hrefLabel: evidence.href ? "Open supporting report" : null,
            })),
        })),
        history: snapshot.history.map((item) => ({
            id: item.id,
            outcomeLabel: outcomeLabel(item.outcome),
            outcomeTone: outcomeTone(item.outcome),
            categoryLabel: snapshot.categories.find((candidate) => candidate.category === item.rootCauseCategory)?.label ?? item.rootCauseCategory,
            decidedAtLabel: formatDateTime(item.decidedAt),
            summary: item.summary ?? "No operator summary recorded.",
            tradeRecordId: item.decisionContext?.linkedRecords.tradeRecordId ?? item.tradeRecordId ?? null,
            investigationLabel: item.decisionContext ? investigationKindLabel(item.decisionContext.investigationKind) : null,
            scoreLabel: item.decisionContext ? `${item.decisionContext.score} evidence score` : null,
            confidenceLabel: item.decisionContext ? confidenceLabel(item.decisionContext.confidence) : null,
            linkedFacts: item.decisionContext ? [
                { label: "Signal", value: item.decisionContext.linkedRecords.signalKey },
                { label: "Backtest", value: item.decisionContext.linkedRecords.backtestRunId ?? "n/a" },
                { label: "Trade Record", value: item.decisionContext.linkedRecords.tradeRecordId ?? "n/a" },
                { label: "Deployment", value: item.decisionContext.linkedRecords.primaryIndicatorInstanceId ?? "n/a" },
            ] : [],
            evidence: item.decisionContext
                ? item.decisionContext.evidence.map((evidence) => ({
                    id: evidence.id,
                    title: evidence.title,
                    detail: evidence.detail,
                    severityLabel: evidenceSeverityLabel(evidence.severity),
                    tone: evidenceTone(evidence.severity),
                    sourceLabel: sourceLabels[evidence.source],
                    sectionLabel: sectionLabels[evidence.sectionKey],
                    linkedRecordLabel: evidence.linkedRecordLabel,
                    targetId: sectionTargets[evidence.sectionKey].id,
                    targetLabel: sectionTargets[evidence.sectionKey].label,
                    href: evidence.href,
                    hrefLabel: evidence.href ? "Open supporting report" : null,
                }))
                : [],
        })),
    };
}
