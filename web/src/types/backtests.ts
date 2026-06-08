export type BacktestTradeStatusFilter = "ALL" | "ACTIVE" | "CLOSED";
export type BacktestTradeOutcomeFilter = "ALL" | "WIN" | "LOSS" | "BE";
export type BacktestTradeResultLabel = "ACTIVE" | "WIN" | "LOSS" | "BE";

export interface BacktestTradeSummary {
    totalTrades: number;
    closedTrades: number;
    openTrades: number;
    wins: number;
    losses: number;
    breakEven: number;
    winRate: number;
    netR: number;
    avgWinR: number;
    avgLossR: number;
}

export interface BacktestTradeRow {
    rowId: string;
    signalId: string;
    backtestRunId: string;
    exitRuleId: string;
    exitRuleCode: string;
    exitRuleName: string;
    symbol: string;
    timeframe: string;
    side: "LONG" | "SHORT";
    session: "ASIAN" | "LONDON" | "NY";
    entryTime: string;
    exitTime: string | null;
    entryPrice: number;
    stopLoss: number;
    exitPrice: number | null;
    pnlPct: number | null;
    rMultiple: number;
    pnlUsd: number;
    durationMs: number | null;
    result: BacktestTradeResultLabel;
    notes: string | null;
}

export interface BacktestTradeHistoryResponse {
    summary: BacktestTradeSummary;
    rows: BacktestTradeRow[];
    pagination: {
        page: number;
        pageSize: number;
        totalRows: number;
        totalPages: number;
    };
}

export interface BacktestSignalEvent {
    id: string;
    signalId: string | null;
    backtestRunId: string | null;
    eventType: string;
    candleTime: string;
    price: number | null;
    label: string | null;
    metaJson: Record<string, unknown> | null;
    createdAt: string;
}

export interface BacktestSignalTrace {
    id: string;
    signalId: string | null;
    signalEventId: string | null;
    backtestRunId: string | null;
    eventType: string;
    candleTime: string;
    stateBefore: string | null;
    stateAfter: string | null;
    ruleId: string | null;
    indicatorJson: Record<string, unknown> | null;
    thresholdJson: Record<string, unknown> | null;
    priceJson: Record<string, unknown> | null;
    notes: string | null;
    createdAt: string;
}

export interface BacktestTradeReplayLinePoint {
    time: string;
    value: number;
}

export interface BacktestTradeReplayMarker {
    id: string;
    time: string;
    price: number | null;
    label: string;
    tone: "neutral" | "entry" | "success" | "danger" | "accent" | "warning";
    shape: "arrowUp" | "arrowDown" | "circle" | "square";
    position: "aboveBar" | "belowBar" | "inBar";
    source: "event" | "swing" | "trade";
}

export interface BacktestTradeReplayLevel {
    id: string;
    label: string;
    price: number;
    tone: "entry" | "danger" | "success" | "neutral" | "warning";
    lineStyle: "solid" | "dashed" | "dotted";
}

export interface BacktestTradeReplaySessionRange {
    label: "ASIAN" | "LONDON" | "NY";
    start: string;
    end: string;
}

export interface BacktestTradeReplayTimelineItem {
    id: string;
    kind: "event" | "trace";
    eventType: string;
    candleTime: string;
    label: string;
    price: number | null;
    detail: string | null;
}

export interface BacktestTradeStageEntry {
    stageNumber: 1 | 2 | 3;
    stageName: "At Risk" | "Protected" | "Trailing";
    startedAt: string;
    startedAtEventType: string;
    endedAt: string | null;
    riskStatus: "at-risk" | "protected" | "locked-profit";
    stopLossPrice: number;
    currentR: number;
    nextAction: string;
}

export interface BacktestTradeStageAnalysis {
    stages: BacktestTradeStageEntry[];
    currentStage: number;
    currentStageName: string;
    currentRiskStatus: "at-risk" | "protected" | "locked-profit";
    currentStopLoss: number;
    currentR: number;
    nextAction: string;
}

// Decision Log types (Story 9.1/9.2)
export type DecisionConditionResult = "PASS" | "TRIGGERED" | "SKIPPED";
export type DecisionAction = "HOLD" | "MOVE_SL" | "PARTIAL_CLOSE" | "CLOSE";

export interface DecisionConditionEntry {
    name: string;
    result: DecisionConditionResult;
}

export interface DecisionStateSnapshot {
    activeStop: number;
    remainingFraction: number;
    realizedNetR: number;
    movedToBreakeven: boolean;
    partialTaken: boolean;
    maxDrawdownPct: number;
}

export interface DecisionLogMultiTfAlignment {
    blockId: string;
    timeframe: string;
    alignedBarTime: string;
    gapMs: number;
}

export interface DecisionLogFullEntry {
    barIndex: number;
    timestamp: string;
    ohlcv: { open: number; high: number; low: number; close: number; volume: number };
    conditions: DecisionConditionEntry[];
    action: DecisionAction;
    stateSnapshot: DecisionStateSnapshot;
    multiTfAlignments?: DecisionLogMultiTfAlignment[];
}

export interface DecisionLogCompressedEntry {
    barIndex: number;
    action: "HOLD";
}

export type DecisionLogItem = DecisionLogFullEntry | DecisionLogCompressedEntry;

export function isFullDecisionLogEntry(entry: DecisionLogItem): entry is DecisionLogFullEntry {
    return "conditions" in entry;
}

export interface BacktestTradeReplayResponse {
    summary: {
        rowId: string;
        runId: string;
        runName: string;
        signalCode: string | null;
        signalVersion: number | null;
        signalId: string;
        signalLabel: string;
        strategyCode: string | null;
        strategyName: string | null;
        symbol: string;
        timeframe: string;
        side: "LONG" | "SHORT";
        session: "ASIAN" | "LONDON" | "NY";
        exitRuleCode: string;
        exitRuleName: string;
        result: BacktestTradeResultLabel;
        entryTime: string;
        exitTime: string | null;
        entryPrice: number;
        stopLoss: number;
        exitPrice: number | null;
        riskDistance: number;
        totalR: number;
        partialR: number | null;
        remainingR: number | null;
        barsHeld: number | null;
        configuredSize: number | null;
        quality: number | null;
    };
    window: {
        focusStart: string;
        focusEnd: string;
        rangeStart: string;
        rangeEnd: string;
        paddingBars: number;
    };
    pricePane: {
        candles: Array<{
            time: string;
            open: number;
            high: number;
            low: number;
            close: number;
            volume: number;
        }>;
        levels: BacktestTradeReplayLevel[];
        markers: BacktestTradeReplayMarker[];
        trailLine: BacktestTradeReplayLinePoint[];
        sessionRanges: BacktestTradeReplaySessionRange[];
    };
    indicatorPane: {
        available: boolean;
        title: string;
        reason: string | null;
        rsi: BacktestTradeReplayLinePoint[];
        ema9: BacktestTradeReplayLinePoint[];
        wma45: BacktestTradeReplayLinePoint[];
    };
    structurePane: {
        available: boolean;
        title: string;
        timeframe: string | null;
        reason: string | null;
        candles: Array<{
            time: string;
            open: number;
            high: number;
            low: number;
            close: number;
            volume: number;
        }>;
        markers: BacktestTradeReplayMarker[];
    };
    timeline: BacktestTradeReplayTimelineItem[];
    stageAnalysis: BacktestTradeStageAnalysis | null;
    raw: {
        events: Array<{
            id: string;
            eventType: string;
            candleTime: string;
            price: number | null;
            label: string | null;
            metaJson: Record<string, unknown> | null;
        }>;
        traces: Array<{
            id: string;
            eventType: string;
            candleTime: string;
            ruleId: string | null;
            notes: string | null;
            indicatorJson: Record<string, unknown> | null;
            priceJson: Record<string, unknown> | null;
        }>;
    };
    decisionLog: DecisionLogItem[] | null;
}
