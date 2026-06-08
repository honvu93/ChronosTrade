import {
    TradeHistoryAuditTimelineItem,
    TradingDiscrepancyInsight,
    TradingDiscrepancySnapshot,
} from "@/types/trading";

type Tone = "danger" | "success" | "accent" | "neutral";

export interface TradingDiscrepancyFactView {
    label: string;
    value: string;
    tone?: Tone;
}

export interface TradingDiscrepancyHeaderView {
    title: string;
    signalKey: string;
    investigationLabel: string;
    subtitle: string;
}

export interface TradingDiscrepancyLinkView {
    href: string | null;
    label: string;
}

export interface TradingDiscrepancyDifferenceCardView {
    code: string;
    title: string;
    detail: string;
    severityLabel: string;
    severityTone: Tone;
    backtestValue: string | null;
    liveValue: string | null;
}

export interface TradingDiscrepancyBacktestView {
    title: string;
    summaryLine: string;
    tradeIssueLabel: string;
    reportSummaryFacts: TradingDiscrepancyFactView[];
    signalReviewFacts: TradingDiscrepancyFactView[];
    parameterJson: string;
    executionConfigJson: string;
}

export interface TradingDiscrepancyTimelineItemView {
    id: string;
    kindLabel: string;
    kindTone: Tone;
    title: string;
    detail: string;
    occurredAtLabel: string;
}

export interface TradingDiscrepancyLiveView {
    primaryDeploymentLabel: string;
    summaryLine: string;
    timelineLabel: string;
    deploymentFacts: TradingDiscrepancyFactView[];
    recentTimeline: TradingDiscrepancyTimelineItemView[];
    parameterJson: string;
    executionConfigJson: string;
}

export interface TradingDiscrepancyViewModel {
    header: TradingDiscrepancyHeaderView;
    reportLink: TradingDiscrepancyLinkView;
    linkedRecordFacts: TradingDiscrepancyFactView[];
    differenceCards: TradingDiscrepancyDifferenceCardView[];
    backtest: TradingDiscrepancyBacktestView;
    live: TradingDiscrepancyLiveView;
}

const stringifyJson = (value: Record<string, unknown> | null) => value ? JSON.stringify(value, null, 2) : "n/a";

const formatDateTime = (value: string | null) => value ? new Date(value).toLocaleString() : "n/a";
const formatSigned = (value: number, suffix = "") => `${value >= 0 ? "+" : ""}${value.toFixed(2)}${suffix}`;

const toTitleCase = (value: string) => value
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());

const severityTone = (severity: TradingDiscrepancyInsight["severity"]): Tone => {
    if (severity === "critical") return "danger";
    if (severity === "warning") return "accent";
    return "neutral";
};

const severityLabel = (severity: TradingDiscrepancyInsight["severity"]) =>
    severity === "critical" ? "Critical" : severity === "warning" ? "Warning" : "Info";

const investigationLabel = (kind: TradingDiscrepancySnapshot["investigationKind"]) => {
    if (kind === "reported-issue") return "Reported Issue";
    if (kind === "mixed-context") return "Mixed Context";
    return "Alert Investigation";
};

function buildTimelineLabel(commandEvents: number, decisionEvents: number) {
    return `${commandEvents} command${commandEvents === 1 ? "" : "s"} | ${decisionEvents} decision${decisionEvents === 1 ? "" : "s"}`;
}

function buildTimelineItemDetail(item: TradeHistoryAuditTimelineItem) {
    if (item.kind === "command") {
        return [item.label ?? toTitleCase(item.eventType), item.price !== null ? `@ ${item.price}` : null]
            .filter((part): part is string => Boolean(part))
            .join(" | ");
    }

    return [item.stateBefore ? `State ${item.stateBefore}` : null, item.stateAfter ? `to ${item.stateAfter}` : null, item.ruleId ? `Rule ${item.ruleId}` : null]
        .filter((part): part is string => Boolean(part))
        .join(" | ");
}

export function buildTradingDiscrepancyView(snapshot: TradingDiscrepancySnapshot): TradingDiscrepancyViewModel {
    const primaryDeployment = snapshot.live.deployments[0] ?? null;
    const timelineSummary = snapshot.live.timelineSummary;
    const backtest = snapshot.backtest;
    const tradeIssue = backtest?.tradeIssue ?? null;
    const reportSummary = backtest?.reportSummary ?? null;
    const signalReview = backtest?.signalReview ?? null;

    return {
        header: {
            title: snapshot.signalName ?? snapshot.linkedRecords.signalKey,
            signalKey: snapshot.linkedRecords.signalKey,
            investigationLabel: investigationLabel(snapshot.investigationKind),
            subtitle: [
                backtest?.runName ?? "No backtest linked",
                primaryDeployment?.name ?? "No live deployment linked",
            ].join(" | "),
        },
        reportLink: {
            href: snapshot.linkedRecords.reportPath,
            label: snapshot.linkedRecords.reportPath ? "Open Report Context" : "Report Context Unavailable",
        },
        linkedRecordFacts: [
            { label: "Run", value: snapshot.linkedRecords.backtestRunId ?? "n/a" },
            { label: "Trade Record", value: snapshot.linkedRecords.tradeRecordId ?? "n/a" },
            { label: "Signal Row", value: snapshot.linkedRecords.signalId ?? "n/a" },
            { label: "Deployment", value: snapshot.linkedRecords.primaryIndicatorInstanceId ?? "n/a" },
            { label: "Command Records", value: snapshot.linkedRecords.commandRecordIds.join(", ") || "n/a" },
        ],
        differenceCards: snapshot.discrepancies.map((difference) => ({
            code: difference.code,
            title: difference.title,
            detail: difference.detail,
            severityLabel: severityLabel(difference.severity),
            severityTone: severityTone(difference.severity),
            backtestValue: difference.backtestValue,
            liveValue: difference.liveValue,
        })),
        backtest: {
            title: backtest ? `${backtest.runName} | ${backtest.symbol} ${backtest.timeframe}` : "Backtest Context Unavailable",
            summaryLine: reportSummary
                ? `${reportSummary.totalTrades} trades | ${reportSummary.wins}W/${reportSummary.losses}L | ${formatSigned(reportSummary.netR, "R")}`
                : "No report summary linked to this investigation.",
            tradeIssueLabel: tradeIssue
                ? `${tradeIssue.exitRuleCode} | ${tradeIssue.result} | ${formatSigned(tradeIssue.rMultiple, "R")}`
                : "No trade issue row selected",
            reportSummaryFacts: reportSummary ? [
                { label: "Win Rate", value: `${reportSummary.winRate.toFixed(1)}%`, tone: reportSummary.winRate >= 50 ? "success" : "danger" },
                { label: "Profit Factor", value: reportSummary.profitFactor.toFixed(2) },
                { label: "Expectancy", value: formatSigned(reportSummary.expectancy, "R"), tone: reportSummary.expectancy >= 0 ? "success" : "danger" },
                { label: "Max Drawdown", value: `${reportSummary.maxDrawdownPct.toFixed(1)}%`, tone: reportSummary.maxDrawdownPct <= 0 ? "danger" : "neutral" },
            ] : [],
            signalReviewFacts: signalReview ? [
                { label: "Strategy", value: `${signalReview.strategyCode} | ${signalReview.strategyName}` },
                { label: "Result Count", value: `${signalReview.resultCount}` },
                { label: "Best Exit", value: signalReview.bestExitRuleName ?? signalReview.bestExitRuleCode ?? "n/a" },
                { label: "Latest Exit", value: formatDateTime(signalReview.latestExitTime) },
            ] : [],
            parameterJson: stringifyJson(backtest?.parametersJson ?? null),
            executionConfigJson: stringifyJson(backtest?.executionConfigJson ?? null),
        },
        live: {
            primaryDeploymentLabel: primaryDeployment?.name ?? "No deployment linked",
            summaryLine: primaryDeployment
                ? `${primaryDeployment.status} | ${primaryDeployment.symbol} ${primaryDeployment.timeframe} | ${primaryDeployment.matchedBy}`
                : "No live deployment was linked to this signal version.",
            timelineLabel: timelineSummary
                ? buildTimelineLabel(timelineSummary.commandEvents, timelineSummary.decisionEvents)
                : "0 command | 0 decision",
            deploymentFacts: primaryDeployment ? [
                { label: "Status", value: primaryDeployment.status, tone: primaryDeployment.status === "ACTIVE" ? "success" : primaryDeployment.status === "FAILED" ? "danger" : "accent" },
                { label: "Source Run", value: primaryDeployment.sourceBacktestRunId ?? "n/a" },
                { label: "Matched By", value: toTitleCase(primaryDeployment.matchedBy) },
                { label: "Last Event", value: primaryDeployment.latestEventType ?? "n/a" },
                { label: "Updated", value: formatDateTime(primaryDeployment.updatedAt) },
            ] : [],
            recentTimeline: snapshot.live.recentTimeline.map((item) => ({
                id: item.id,
                kindLabel: item.kind === "command" ? "Command" : "Decision",
                kindTone: item.kind === "command" ? "accent" : "success",
                title: item.label ?? toTitleCase(item.eventType),
                detail: buildTimelineItemDetail(item),
                occurredAtLabel: formatDateTime(item.occurredAt),
            })),
            parameterJson: stringifyJson(primaryDeployment?.parameterJson ?? null),
            executionConfigJson: stringifyJson(primaryDeployment?.executionConfigJson ?? null),
        },
    };
}
