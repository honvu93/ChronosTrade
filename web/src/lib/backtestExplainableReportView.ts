import { BacktestSignalEvent, BacktestSignalTrace } from "@/types/backtests";
import {
    EngineOverview,
    ExitComparisonRow,
    SessionBreakdownRow,
    SignalReviewRow,
    StrategyBreakdownRow,
} from "@/types/engine";
import { GeneratedBacktestDetail } from "@/types/signals";

export interface BacktestExplainableReportFact {
    label: string;
    value: string;
}

export interface BacktestExplainableReportViewModel {
    heading: string;
    summary: string;
    marketSnapshot: BacktestExplainableReportFact[];
    indicatorState: BacktestExplainableReportFact[];
    matchedRules: string[];
    resultingActionLabel: string;
    resultingActionDetail: string;
    traceNotes: string[];
}

export interface BacktestValidationArtifact {
    schemaVersion: 1;
    artifactType: "backtest-validation-report";
    exportedAt: string;
    linkage: {
        backtestRunId: string | null;
        runName: string | null;
        signalCode: string | null;
        signalVersion: number | null;
        signalId: string | null;
        signalLabel: string | null;
    };
    filters: {
        side: "ALL" | "LONG" | "SHORT";
        strategyId: string;
        session: "ALL" | "ASIAN" | "LONDON" | "NY";
        fromDate: string;
        toDate: string;
    };
    overview: EngineOverview | null;
    run: GeneratedBacktestDetail | null;
    selectedSignal: SignalReviewRow | null;
    explainableReport: BacktestExplainableReportViewModel;
    signals: SignalReviewRow[];
    events: BacktestSignalEvent[];
    traces: BacktestSignalTrace[];
    breakdowns: {
        byStrategy: StrategyBreakdownRow[];
        bySession: SessionBreakdownRow[];
        exitComparison: ExitComparisonRow[];
    };
}

const toTitleCase = (value: string) => value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());

const formatNumber = (value: number) => {
    if (Number.isInteger(value)) {
        return value.toString();
    }

    const digits = Math.abs(value) >= 100 ? 2 : 4;
    return value.toFixed(digits).replace(/\.?0+$/, "");
};

const formatValue = (value: unknown): string => {
    if (typeof value === "number") {
        return formatNumber(value);
    }

    if (typeof value === "boolean") {
        return value ? "true" : "false";
    }

    if (typeof value === "string") {
        return value;
    }

    if (value === null || value === undefined) {
        return "n/a";
    }

    return JSON.stringify(value);
};

const formatPrice = (value: number | null) => (typeof value === "number" ? formatNumber(value) : "n/a");
const formatDateTime = (value: string | null) => (value ? new Date(value).toLocaleString() : "n/a");
const formatSigned = (value: number, suffix = "") => `${value >= 0 ? "+" : ""}${formatNumber(value)}${suffix}`;

const sortEvents = (left: BacktestSignalEvent, right: BacktestSignalEvent) => {
    const leftTime = new Date(left.candleTime).getTime();
    const rightTime = new Date(right.candleTime).getTime();
    if (leftTime !== rightTime) {
        return leftTime - rightTime;
    }

    return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
};

const sortTraces = (left: BacktestSignalTrace, right: BacktestSignalTrace) => {
    const leftTime = new Date(left.candleTime).getTime();
    const rightTime = new Date(right.candleTime).getTime();
    if (leftTime !== rightTime) {
        return leftTime - rightTime;
    }

    return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
};

const extractFacts = (
    prefix: string,
    value: Record<string, unknown> | null | undefined,
    limit: number,
): BacktestExplainableReportFact[] => {
    if (!value) {
        return [];
    }

    return Object.entries(value)
        .slice(0, limit)
        .map(([key, entryValue]) => ({
            label: prefix ? `${prefix}: ${toTitleCase(key)}` : toTitleCase(key),
            value: formatValue(entryValue),
        }));
};

export const buildBacktestExplainableReportView = ({
    runDetail,
    signal,
    events,
    traces,
}: {
    runDetail: GeneratedBacktestDetail | null;
    signal: SignalReviewRow | null;
    events: BacktestSignalEvent[];
    traces: BacktestSignalTrace[];
}): BacktestExplainableReportViewModel => {
    if (!signal) {
        return {
            heading: "Explainable report pending",
            summary: "Select a reviewed signal to inspect decision context, trace evidence, and exportable validation details.",
            marketSnapshot: [],
            indicatorState: [],
            matchedRules: [],
            resultingActionLabel: "No signal selected",
            resultingActionDetail: "Run-level analytics are available, but explainable evidence starts after a signal is selected.",
            traceNotes: [],
        };
    }

    if (!runDetail) {
        const takeProfitSummary = [
            signal.takeProfit1 !== null ? `TP1 ${formatPrice(signal.takeProfit1)}` : null,
            signal.takeProfit2 !== null ? `TP2 ${formatPrice(signal.takeProfit2)}` : null,
        ].filter(Boolean).join(" / ");

        return {
            heading: `${signal.strategyCode} decision context`,
            summary: `This report still stays tied to ${signal.symbol} ${signal.timeframe} and signal ${signal.signalId}, but explainable event and trace detail is only available for generated validation runs. The signal snapshot and outcome linkage remain exportable.`,
            marketSnapshot: [
                { label: "Signal", value: `${signal.symbol} ${signal.timeframe} / ${signal.side}` },
                { label: "Session", value: signal.session },
                { label: "Entry", value: `${formatDateTime(signal.entryTime)} @ ${formatPrice(signal.entryPrice)}` },
                { label: "Protection", value: [`SL ${formatPrice(signal.stopLoss)}`, takeProfitSummary].filter(Boolean).join(" / ") || "No TP snapshot" },
                { label: "Run", value: signal.backtestRunName ?? signal.backtestRunId ?? "Imported review context" },
                { label: "Evidence", value: `${signal.resultCount} result(s) / ${formatSigned(signal.netR, "R")} net / ${signal.wins}W/${signal.losses}L` },
            ],
            indicatorState: [],
            matchedRules: [],
            resultingActionLabel: signal.bestExitRuleName ? `Best exit: ${signal.bestExitRuleName}` : "Result review only",
            resultingActionDetail: "Signal-level performance can still be reviewed and exported, but generated trace context is not available for this run.",
            traceNotes: signal.notes ? [signal.notes] : [],
        };
    }

    const orderedEvents = [...events].sort(sortEvents);
    const orderedTraces = [...traces].sort(sortTraces);
    const latestEvent = orderedEvents.at(-1) ?? null;
    const latestTrace = orderedTraces.at(-1) ?? null;
    const matchedRules = Array.from(
        new Set(
            orderedTraces
                .map((trace) => trace.ruleId?.trim())
                .filter((ruleId): ruleId is string => Boolean(ruleId)),
        ),
    );
    const traceNotes = Array.from(
        new Set(
            [
                ...orderedEvents.map((event) => event.label?.trim() ?? ""),
                ...orderedTraces.map((trace) => trace.notes?.trim() ?? ""),
            ].filter((item) => item.length > 0),
        ),
    ).slice(0, 5);
    const indicatorState = [
        ...extractFacts("Indicator", latestTrace?.indicatorJson, 4),
        ...extractFacts("Threshold", latestTrace?.thresholdJson, 2),
        ...extractFacts("Price", latestTrace?.priceJson, 2),
    ];
    const fallbackIndicatorState = indicatorState.length === 0
        ? extractFacts("Snapshot", latestEvent?.metaJson, 6)
        : indicatorState;
    const latestActionLabel = latestEvent?.label?.trim()
        || latestEvent?.eventType
        || (signal.bestExitRuleName ? `Best exit: ${signal.bestExitRuleName}` : "Result review");
    const latestActionDetail = latestEvent
        ? `${toTitleCase(latestEvent.eventType)} at ${formatDateTime(latestEvent.candleTime)}${typeof latestEvent.price === "number" ? ` near ${formatPrice(latestEvent.price)}` : ""}.`
        : `${signal.resultCount} result${signal.resultCount === 1 ? "" : "s"} recorded with ${formatSigned(signal.netR, "R")} net evidence.`;
    const takeProfitSummary = [
        signal.takeProfit1 !== null ? `TP1 ${formatPrice(signal.takeProfit1)}` : null,
        signal.takeProfit2 !== null ? `TP2 ${formatPrice(signal.takeProfit2)}` : null,
    ].filter(Boolean).join(" / ");

    return {
        heading: `${signal.strategyCode} decision context`,
        summary: `${signal.side} ${signal.session} setup on ${signal.symbol} ${signal.timeframe} entered ${formatDateTime(signal.entryTime)}. Latest explainable action is ${toTitleCase(latestEvent?.eventType ?? "reviewed")} with ${matchedRules.length} matched rule${matchedRules.length === 1 ? "" : "s"} and ${orderedTraces.length} captured trace step${orderedTraces.length === 1 ? "" : "s"}.`,
        marketSnapshot: [
            { label: "Signal", value: `${signal.symbol} ${signal.timeframe} / ${signal.side}` },
            { label: "Session", value: signal.session },
            { label: "Entry", value: `${formatDateTime(signal.entryTime)} @ ${formatPrice(signal.entryPrice)}` },
            { label: "Protection", value: [`SL ${formatPrice(signal.stopLoss)}`, takeProfitSummary].filter(Boolean).join(" / ") || "No TP snapshot" },
            { label: "Run", value: `${runDetail.signalCode}@${runDetail.signalVersion} / ${runDetail.name}` },
            { label: "Evidence", value: `${signal.resultCount} result(s) / ${formatSigned(signal.netR, "R")} net / ${signal.wins}W/${signal.losses}L` },
        ],
        indicatorState: fallbackIndicatorState,
        matchedRules,
        resultingActionLabel: latestActionLabel,
        resultingActionDetail: latestActionDetail,
        traceNotes,
    };
};

export const buildBacktestValidationArtifact = ({
    runDetail,
    overview,
    selectedSignal,
    signalRows,
    events,
    traces,
    byStrategy,
    bySession,
    exitComparison,
    explainableReport,
    filters,
    exportedAt = new Date().toISOString(),
}: {
    runDetail: GeneratedBacktestDetail | null;
    overview: EngineOverview | null;
    selectedSignal: SignalReviewRow | null;
    signalRows: SignalReviewRow[];
    events: BacktestSignalEvent[];
    traces: BacktestSignalTrace[];
    byStrategy: StrategyBreakdownRow[];
    bySession: SessionBreakdownRow[];
    exitComparison: ExitComparisonRow[];
    explainableReport: BacktestExplainableReportViewModel;
    filters: {
        side: "ALL" | "LONG" | "SHORT";
        strategyId: string;
        session: "ALL" | "ASIAN" | "LONDON" | "NY";
        fromDate: string;
        toDate: string;
    };
    exportedAt?: string;
}): BacktestValidationArtifact => ({
    schemaVersion: 1,
    artifactType: "backtest-validation-report",
    exportedAt,
    linkage: {
        backtestRunId: runDetail?.id ?? overview?.context?.id ?? null,
        runName: runDetail?.name ?? overview?.context?.name ?? null,
        signalCode: runDetail?.signalCode ?? null,
        signalVersion: runDetail?.signalVersion ?? null,
        signalId: selectedSignal?.signalId ?? null,
        signalLabel: selectedSignal
            ? `${selectedSignal.strategyCode} ${selectedSignal.symbol} ${selectedSignal.timeframe} ${selectedSignal.side}`
            : null,
    },
    filters,
    overview,
    run: runDetail,
    selectedSignal,
    explainableReport,
    signals: signalRows,
    events,
    traces,
    breakdowns: {
        byStrategy,
        bySession,
        exitComparison,
    },
});
