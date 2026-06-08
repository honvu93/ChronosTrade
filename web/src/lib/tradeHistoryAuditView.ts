import {
    TradeHistoryAuditCoverage,
    TradeHistoryAuditDetailSnapshot,
    TradeHistoryAuditResult,
    TradeHistoryAuditSnapshot,
    TradeHistoryAuditTimelineItem,
} from "@/types/trading";
import { BacktestTradeStageAnalysis, BacktestTradeStageEntry } from "@/types/backtests";
import { Tone } from "@/lib/toneStyles";

export interface TradeHistoryAuditMetricView {
    label: string;
    value: string;
    tone: Tone;
}

export interface TradeHistoryAuditRecordView {
    recordId: string;
    signalCode: string | null;
    signalVersion: number | null;
    backtestRunId: string;
    title: string;
    subtitle: string;
    side: string;
    resultLabel: string;
    resultTone: Tone;
    auditLabel: string;
    auditTone: Tone;
    pnlLabel: string;
    pnlTone: Tone;
    entryLabel: string;
    exitLabel: string;
    timelineSummary: string;
    signalLabel: string;
    notes: string | null;
    isActive: boolean;
    riskDistancePct: string | null;
    riskDistanceLabel: string | null;
}

export interface TradeHistoryAuditListViewModel {
    headline: string;
    summaryLine: string;
    metrics: TradeHistoryAuditMetricView[];
    records: TradeHistoryAuditRecordView[];
    hasRecords: boolean;
}

export interface TradeHistoryAuditFactView {
    label: string;
    value: string;
    tone?: Tone;
}

export interface TradeHistoryAuditTimelineRawView {
    label: string;
    value: string;
}

export interface TradeHistoryAuditTimelineItemView {
    id: string;
    kindLabel: string;
    kindTone: Tone;
    sourceLabel: string;
    title: string;
    detail: string;
    occurredAtLabel: string;
    note: string | null;
    rawSections: TradeHistoryAuditTimelineRawView[];
}

export interface TradeHistoryAuditDetailViewModel {
    title: string;
    subtitle: string;
    resultLabel: string;
    resultTone: Tone;
    auditLabel: string;
    auditTone: Tone;
    traceabilityFacts: TradeHistoryAuditFactView[];
    tradeFacts: TradeHistoryAuditFactView[];
    timelineHeadline: string;
    timelineSummaryLine: string;
    timelineItems: TradeHistoryAuditTimelineItemView[];
}

const toTitleCase = (value: string) => value
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());

const formatDateTime = (value: string | null) => {
    if (!value) return "n/a";
    return new Date(value).toLocaleString();
};

const formatPrice = (value: number | null, digits = 2) =>
    value === null
        ? "n/a"
        : value.toLocaleString(undefined, {
            minimumFractionDigits: 0,
            maximumFractionDigits: digits,
        });

const formatSigned = (value: number, suffix = "") =>
    `${value >= 0 ? "+" : ""}${value.toFixed(2)}${suffix}`;

const resultTone = (result: TradeHistoryAuditResult): Tone => {
    if (result === "WIN") return "success";
    if (result === "LOSS") return "danger";
    if (result === "ACTIVE") return "accent";
    return "neutral";
};

const auditTone = (coverage: TradeHistoryAuditCoverage): Tone => {
    if (coverage === "full") return "success";
    if (coverage === "partial") return "accent";
    return "neutral";
};

const auditLabel = (coverage: TradeHistoryAuditCoverage) => {
    if (coverage === "full") return "Audit Linked";
    if (coverage === "partial") return "Partial Audit";
    return "Audit Missing";
};

const formatSignalKey = (signalCode: string | null, signalVersion: number | null) =>
    signalCode && signalVersion !== null ? `${signalCode}@v${signalVersion}` : "Signal context unavailable";

const buildTimelineSummary = (commandCount: number, decisionCount: number) =>
    `${commandCount} command${commandCount === 1 ? "" : "s"} | ${decisionCount} decision${decisionCount === 1 ? "" : "s"}`;

const stringifyJson = (value: unknown) => JSON.stringify(value, null, 2);

function buildTimelineItemDetail(item: TradeHistoryAuditTimelineItem) {
    if (item.kind === "command") {
        const parts = [
            item.label ? item.label : toTitleCase(item.eventType),
            item.price !== null ? `@ ${formatPrice(item.price, 4)}` : null,
        ].filter((part): part is string => Boolean(part));

        return parts.join(" | ");
    }

    const stateLine = `State ${item.stateBefore || "NULL"} -> ${item.stateAfter || "NULL"}`;
    return item.ruleId ? `${stateLine} | Rule ${item.ruleId}` : stateLine;
}

function buildTimelineRawSections(item: TradeHistoryAuditTimelineItem): TradeHistoryAuditTimelineRawView[] {
    const sections: TradeHistoryAuditTimelineRawView[] = [];

    if (item.metaJson !== null) {
        sections.push({ label: "Meta JSON", value: stringifyJson(item.metaJson) });
    }
    if (item.indicatorJson !== null) {
        sections.push({ label: "Indicator JSON", value: stringifyJson(item.indicatorJson) });
    }
    if (item.thresholdJson !== null) {
        sections.push({ label: "Threshold JSON", value: stringifyJson(item.thresholdJson) });
    }
    if (item.priceJson !== null) {
        sections.push({ label: "Price JSON", value: stringifyJson(item.priceJson) });
    }

    return sections;
}

export function buildTradeHistoryAuditListView(
    snapshot: TradeHistoryAuditSnapshot,
): TradeHistoryAuditListViewModel {
    const { summary } = snapshot;

    return {
        headline: `${summary.totalRecords} recent trade record${summary.totalRecords === 1 ? "" : "s"} ready for review.`,
        summaryLine: `${summary.recordsWithAudit}/${summary.totalRecords} records retain audit linkage inside this workspace.`,
        metrics: [
            {
                label: "Wins / Losses",
                value: `${summary.wins} / ${summary.losses}`,
                tone: summary.wins >= summary.losses ? "success" : "danger",
            },
            {
                label: "Active",
                value: `${summary.activeTrades}`,
                tone: summary.activeTrades > 0 ? "accent" : "neutral",
            },
            {
                label: "Commands",
                value: `${summary.commandEvents}`,
                tone: summary.commandEvents > 0 ? "accent" : "neutral",
            },
            {
                label: "Decisions",
                value: `${summary.decisionEvents}`,
                tone: summary.decisionEvents > 0 ? "success" : "neutral",
            },
        ],
        records: snapshot.records.map((record) => {
            const isActive = record.result === "ACTIVE";
            let riskDistancePct: string | null = null;
            let riskDistanceLabel: string | null = null;
            if (isActive && record.entryPrice && record.stopLoss) {
                const riskAbs = Math.abs(record.entryPrice - record.stopLoss);
                const riskPct = (riskAbs / record.entryPrice) * 100;
                riskDistancePct = `${riskPct.toFixed(2)}%`;
                riskDistanceLabel = `SL ${record.side === "LONG" ? "↓" : "↑"} ${riskDistancePct} from entry`;
            }
            return {
                recordId: record.recordId,
                signalCode: record.signalCode,
                signalVersion: record.signalVersion,
                backtestRunId: record.backtestRunId,
                title: `${record.symbol} ${record.timeframe} ${record.side}`,
                subtitle: `${record.runName} | ${record.exitRuleCode} | ${record.session}`,
                side: record.side,
                resultLabel: record.result,
                resultTone: resultTone(record.result),
                auditLabel: auditLabel(record.auditCoverage),
                auditTone: auditTone(record.auditCoverage),
                pnlLabel: `${formatSigned(record.rMultiple, "R")} | ${formatSigned(record.pnlUsd, " USD")}`,
                pnlTone: record.pnlUsd >= 0 ? "success" : "danger",
                entryLabel: formatDateTime(record.entryTime),
                exitLabel: formatDateTime(record.exitTime),
                timelineSummary: buildTimelineSummary(record.commandEventCount, record.decisionEventCount),
                signalLabel: formatSignalKey(record.signalCode, record.signalVersion),
                notes: record.notes ? `${toTitleCase(record.exitReason)} | ${record.notes}` : toTitleCase(record.exitReason),
                isActive,
                riskDistancePct,
                riskDistanceLabel,
            };
        }),
        hasRecords: snapshot.records.length > 0,
    };
}

export function buildTradeHistoryAuditDetailView(
    detail: TradeHistoryAuditDetailSnapshot,
): TradeHistoryAuditDetailViewModel {
    const { record, traceability, timelineSummary } = detail;

    return {
        title: `${record.symbol} ${record.timeframe} ${record.side}`,
        subtitle: `${traceability.runName} | ${traceability.exitRuleCode} | ${traceability.rowId}`,
        resultLabel: record.result,
        resultTone: resultTone(record.result),
        auditLabel: auditLabel(record.auditCoverage),
        auditTone: auditTone(record.auditCoverage),
        traceabilityFacts: [
            { label: "History Record", value: traceability.historyRecordId },
            { label: "Run", value: traceability.runName },
            { label: "Signal", value: traceability.signalKey ?? "n/a" },
            { label: "Signal ID", value: traceability.signalId },
            { label: "Trade Row", value: traceability.rowId },
            { label: traceability.scopeLabel, value: traceability.scopeDetail },
        ],
        tradeFacts: [
            { label: "Entry", value: `${formatDateTime(record.entryTime)} @ ${formatPrice(record.entryPrice, 4)}` },
            { label: "Exit", value: `${formatDateTime(record.exitTime)} @ ${formatPrice(record.exitPrice, 4)}` },
            { label: "Stop Loss", value: formatPrice(record.stopLoss, 4) },
            { label: "Exit Reason", value: toTitleCase(record.exitReason) },
            { label: "PnL", value: `${formatSigned(record.rMultiple, "R")} | ${formatSigned(record.pnlUsd, " USD")}`, tone: record.pnlUsd >= 0 ? "success" : "danger" },
            { label: "Audit", value: buildTimelineSummary(record.commandEventCount, record.decisionEventCount), tone: auditTone(record.auditCoverage) },
            { label: "Latest Audit", value: formatDateTime(record.latestAuditAt) },
        ],
        timelineHeadline: `${timelineSummary.totalItems} audit timeline item${timelineSummary.totalItems === 1 ? "" : "s"}`,
        timelineSummaryLine: `${timelineSummary.commandEvents} command and ${timelineSummary.decisionEvents} decision events from ${formatDateTime(timelineSummary.firstOccurredAt)} to ${formatDateTime(timelineSummary.lastOccurredAt)}.`,
        timelineItems: detail.timeline.map((item) => ({
            id: item.id,
            kindLabel: item.kind === "command" ? "Command" : "Decision",
            kindTone: item.kind === "command" ? "accent" : "success",
            sourceLabel: item.source === "event" ? "Event Record" : "Logic Trace",
            title: item.kind === "command" && item.label ? item.label : toTitleCase(item.eventType),
            detail: buildTimelineItemDetail(item),
            occurredAtLabel: formatDateTime(item.occurredAt),
            note: item.notes,
            rawSections: buildTimelineRawSections(item),
        })),
    };
}

export function resolveStageAnalysisFromAudit(
    detail: TradeHistoryAuditDetailSnapshot,
): BacktestTradeStageAnalysis | null {
    const { record, timeline } = detail;
    const entryPrice = record.entryPrice;
    const stopLoss = record.stopLoss;
    if (entryPrice === null || stopLoss === null) return null;

    const riskDistance = Math.abs(entryPrice - stopLoss);
    if (riskDistance === 0) return null;

    const entryEvent = timeline.find((item) =>
        item.eventType === "ENTRY" || item.eventType === "ENTRY_CONFIRMED",
    );
    if (!entryEvent) return null;

    const beEvent = timeline.find((item) => item.eventType === "MOVE_SL_BE");
    const partialEvent = timeline.find((item) => item.eventType === "TP1_HIT");
    const trailEvents = timeline.filter((item) =>
        item.eventType === "TRAIL_START" || item.eventType === "TRAIL_UPDATE",
    );
    const terminalEvent = timeline.find((item) =>
        item.eventType === "STOP_HIT" || item.eventType === "TP2_HIT" || item.eventType === "EXPIRATION",
    );

    const stages: BacktestTradeStageEntry[] = [];
    let currentStop = stopLoss;

    stages.push({
        stageNumber: 1,
        stageName: "At Risk",
        startedAt: entryEvent.occurredAt,
        startedAtEventType: entryEvent.eventType,
        endedAt: beEvent?.occurredAt ?? terminalEvent?.occurredAt ?? null,
        riskStatus: "at-risk",
        stopLossPrice: stopLoss,
        currentR: 0,
        nextAction: "Breakeven at +1R",
    });

    if (beEvent) {
        currentStop = entryPrice;
        stages.push({
            stageNumber: 2,
            stageName: "Protected",
            startedAt: beEvent.occurredAt,
            startedAtEventType: beEvent.eventType,
            endedAt: partialEvent?.occurredAt ?? terminalEvent?.occurredAt ?? null,
            riskStatus: "protected",
            stopLossPrice: entryPrice,
            currentR: 1,
            nextAction: "50% close at +2R",
        });
    }

    if (partialEvent) {
        let latestTrailStop = currentStop;
        let latestTrailR = 0;
        for (const trailEvent of trailEvents) {
            if (trailEvent.price !== null) {
                latestTrailStop = trailEvent.price;
                latestTrailR = Math.abs(trailEvent.price - entryPrice) / riskDistance;
            }
        }
        currentStop = latestTrailStop;

        const nextTrailR = latestTrailR > 0 ? Math.round(latestTrailR) + 1 : 3;
        stages.push({
            stageNumber: 3,
            stageName: "Trailing",
            startedAt: partialEvent.occurredAt,
            startedAtEventType: partialEvent.eventType,
            endedAt: terminalEvent?.occurredAt ?? null,
            riskStatus: latestTrailR > 0 ? "locked-profit" : "protected",
            stopLossPrice: latestTrailStop,
            currentR: 2,
            nextAction: `Trailing — next +${nextTrailR}R`,
        });
    }

    if (stages.length === 0) return null;

    const lastStage = stages[stages.length - 1];
    const isClosed = record.result !== "ACTIVE";
    const totalR = record.rMultiple;

    return {
        stages,
        currentStage: lastStage.stageNumber,
        currentStageName: isClosed
            ? `Stage ${lastStage.stageNumber} — Closed`
            : `Stage ${lastStage.stageNumber} — ${lastStage.stageName}`,
        currentRiskStatus: lastStage.riskStatus,
        currentStopLoss: currentStop,
        currentR: totalR,
        nextAction: isClosed
            ? `Closed at ${totalR >= 0 ? "+" : ""}${totalR.toFixed(2)}R.`
            : lastStage.nextAction,
    };
}
