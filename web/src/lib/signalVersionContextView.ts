import { SignalVersionSnapshot } from "@/types/trading";

export interface SignalVersionHeaderView {
    codeLabel: string;
    title: string;
    category: string;
    description: string;
    composedLabel: string | null;
    createdAt: string;
    createdBy: string;
}

export interface SignalVersionOriginView {
    kindLabel: string;
    recordId: string;
    recordLabel: string;
    statusLabel: string;
    statusTone: "success" | "caution" | "danger" | "neutral";
    context: string;
    hasAccountContext: boolean;
    accountLabel: string;
    accountStateLabel: string;
}

export interface SignalVersionBacktestView {
    hasLinkedRun: boolean;
    runId: string;
    runName: string;
    statusLabel: string;
    statusTone: "success" | "caution" | "danger" | "neutral";
    context: string;
}

export interface SignalVersionParamField {
    key: string;
    typeLabel: string;
    description: string;
}

export interface SignalVersionContextView {
    header: SignalVersionHeaderView;
    origin: SignalVersionOriginView;
    backtest: SignalVersionBacktestView;
    paramFields: SignalVersionParamField[];
    hasParams: boolean;
    hasParameterValues: boolean;
    parameterValuesJson: string;
    hasExecutionConfig: boolean;
    executionConfigJson: string;
    hasComposedBlocks: boolean;
    composedBlocksJson: string;
}

const statusToneMap: Record<string, SignalVersionBacktestView["statusTone"]> = {
    COMPLETED: "success",
    RUNNING: "caution",
    FAILED: "danger",
    PAUSED: "caution",
    PENDING: "neutral",
    ACTIVE: "success",
};

const originKindLabels = {
    "signal-definition": "Signal Definition",
    "backtest-run": "Backtest Run",
    "indicator-instance": "Live Indicator Runtime",
} as const;

const accountStateLabels = {
    ready: "Account Ready",
    "credentials-missing": "Credentials Missing",
    "credentials-partial": "Credentials Partial",
    "bridge-unreachable": "Bridge Unreachable",
    "execution-blocked": "Execution Blocked",
    unchecked: "Unchecked",
} as const;

function formatDate(iso: string): string {
    try {
        return new Date(iso).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
        });
    } catch {
        return iso;
    }
}

function stringifyJson(value: Record<string, unknown> | null): string {
    return value ? JSON.stringify(value, null, 2) : "";
}

function formatSymbolTimeframe(symbol: string | null, timeframe: string | null): string {
    if (!symbol || !timeframe) {
        return "";
    }
    return `${symbol} / ${timeframe}`;
}

function extractParamFields(schema: Record<string, unknown>): SignalVersionParamField[] {
    const fields = schema["fields"];
    if (!Array.isArray(fields)) {
        return [];
    }

    return fields
        .filter((field): field is Record<string, unknown> => typeof field === "object" && field !== null)
        .map((field) => ({
            key: String(field["key"] ?? field["name"] ?? ""),
            typeLabel: String(field["type"] ?? "any"),
            description: String(field["description"] ?? field["label"] ?? ""),
        }))
        .filter((field) => field.key !== "");
}

export function buildSignalVersionContextView(snapshot: SignalVersionSnapshot): SignalVersionContextView {
    const paramFields = extractParamFields(snapshot.parameterSchema);

    const originStatus = snapshot.originStatus ?? "";
    const originContext = formatSymbolTimeframe(snapshot.originSymbol, snapshot.originTimeframe);
    const backtestContext = formatSymbolTimeframe(
        snapshot.linkedBacktestSymbol,
        snapshot.linkedBacktestTimeframe,
    );

    return {
        header: {
            codeLabel: `${snapshot.signalCode}@v${snapshot.signalVersion}`,
            title: snapshot.signalName,
            category: snapshot.category ?? "Uncategorized",
            description: snapshot.description ?? "No description provided.",
            composedLabel: snapshot.isComposed ? "Composed Signal" : null,
            createdAt: formatDate(snapshot.createdAt),
            createdBy: snapshot.createdBy ?? "Unknown",
        },
        origin: {
            kindLabel: originKindLabels[snapshot.originKind],
            recordId: snapshot.originRecordId ?? "",
            recordLabel: snapshot.originRecordLabel ?? "Definition context",
            statusLabel: originStatus || "N/A",
            statusTone: statusToneMap[originStatus] ?? "neutral",
            context: originContext,
            hasAccountContext: snapshot.accountContext !== null,
            accountLabel: snapshot.accountContext
                ? [snapshot.accountContext.mt5Login, snapshot.accountContext.mt5Server]
                    .filter((part): part is string => Boolean(part))
                    .join(" @ ")
                : "",
            accountStateLabel: snapshot.accountContext
                ? accountStateLabels[snapshot.accountContext.readinessState]
                : "",
        },
        backtest: {
            hasLinkedRun: snapshot.linkedBacktestRunId !== null,
            runId: snapshot.linkedBacktestRunId ?? "",
            runName: snapshot.linkedBacktestName ?? "No linked backtest",
            statusLabel: snapshot.linkedBacktestStatus ?? "N/A",
            statusTone: statusToneMap[snapshot.linkedBacktestStatus ?? ""] ?? "neutral",
            context: backtestContext,
        },
        paramFields,
        hasParams: paramFields.length > 0,
        hasParameterValues: snapshot.parameterValuesJson !== null,
        parameterValuesJson: stringifyJson(snapshot.parameterValuesJson),
        hasExecutionConfig: snapshot.executionConfigJson !== null,
        executionConfigJson: stringifyJson(snapshot.executionConfigJson),
        hasComposedBlocks: snapshot.composedBlocks !== null,
        composedBlocksJson: stringifyJson(snapshot.composedBlocks),
    };
}
