export interface EngineStrategy {
    id: string;
    code: string;
    name: string;
    description: string | null;
    isActive: boolean;
}

export interface EngineExitRule {
    id: string;
    code: string;
    name: string;
    description: string | null;
    isActive: boolean;
}

export interface EngineRun {
    id: string;
    name: string;
    symbol: string;
    timeframe: string;
    side: "LONG" | "SHORT" | null;
    strategyId: string | null;
    strategyName: string | null;
    strategyCode: string | null;
    initialEquity: number;
    riskPercent: number;
    startedAt: string;
    finishedAt: string | null;
    createdAt: string;
}

export interface EngineOverview {
    context: EngineRun | null;
    metrics: {
        signalCount: number;
        totalTrades: number;
        closedTrades: number;
        openTrades: number;
        wins: number;
        losses: number;
        winRate: number;
        profitFactor: number;
        expectancy: number;
        netR: number;
        netUsd: number;
        maxConsecutiveLoss: number;
        maxDrawdownPct: number;
    };
}

export interface EquityCurvePoint {
    time: string | null;
    equity: number;
    pnlUsd: number;
    rMultiple: number;
    r1to1: number;
    drawdown: number;
    session: "ASIAN" | "LONDON" | "NY";
    win: boolean;
}

export interface EquityCurveYearBreakdown {
    year: number;
    trades: number;
    wins: number;
    winRate: number;
    pnlUsd: number;
}

export interface EquityCurveData {
    initialEquity: number;
    finalEquity: number;
    totalReturn: number;
    maxDrawdownPct: number;
    maxDrawdownUsd: number;
    tradesPerWeek: number;
    bestYear: { year: number; pnl: number } | null;
    worstYear: { year: number; pnl: number } | null;
    yearlyBreakdown: EquityCurveYearBreakdown[];
    points: EquityCurvePoint[];
    points1to1: Array<{ equity: number }>;
}

export type BacktestLeaderboardMode = "ALL_RUNS" | "BEST_PER_SIGNAL";
export type BacktestLeaderboardSortField =
    | "rank"
    | "createdAt"
    | "closedTrades"
    | "winRate"
    | "netR"
    | "profitFactor"
    | "expectancy"
    | "maxDrawdownPct";
export type BacktestLeaderboardSortOrder = "asc" | "desc";
export type BacktestLeaderboardStatusFilter = "ALL" | "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELED";
export type BacktestLeaderboardCautionState = "constructive" | "weaker" | "suspicious";

export interface BacktestLeaderboardRow {
    rank: number;
    runId: string;
    runName: string;
    signalCode: string | null;
    signalVersion: number | null;
    signalKey: string;
    signalLabel: string;
    symbol: string;
    timeframe: string;
    status: Exclude<BacktestLeaderboardStatusFilter, "ALL">;
    startedAt: string;
    finishedAt: string | null;
    createdAt: string;
    signalCount: number;
    totalTrades: number;
    closedTrades: number;
    openTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    profitFactor: number;
    expectancy: number;
    netR: number;
    netUsd: number;
    maxDrawdownPct: number;
    notes: string | null;
    cautionState: BacktestLeaderboardCautionState;
    cautionFlags: string[];
}

export interface BacktestLeaderboardSummary {
    totalRows: number;
    totalSignals: number;
    constructiveRows: number;
    weakerRows: number;
    suspiciousRows: number;
}

export interface BacktestLeaderboardResponse {
    rows: BacktestLeaderboardRow[];
    pagination: {
        page: number;
        pageSize: number;
        totalRows: number;
        totalPages: number;
    };
    summary: BacktestLeaderboardSummary;
    mode: BacktestLeaderboardMode;
    sort: BacktestLeaderboardSortField;
    order: BacktestLeaderboardSortOrder;
}

export interface StrategyBreakdownRow {
    strategyId: string;
    strategyCode: string;
    strategyName: string;
    trades: number;
    wins: number;
    losses: number;
    openTrades: number;
    winRate: number;
    netR: number;
}

export interface SessionBreakdownRow {
    session: string;
    trades: number;
    wins: number;
    losses: number;
    openTrades: number;
    winRate: number;
    netR: number;
}

export interface ExitComparisonRow {
    exitRuleId: string;
    exitRuleCode: string;
    exitRuleName: string;
    trades: number;
    wins: number;
    losses: number;
    openTrades: number;
    winRate: number;
    netR: number;
    netUsd: number;
    maxDrawdownPct: number;
    profitFactor: number;
    expectancy: number;
    avgWinR: number;
    avgLossR: number;
}

export interface EngineAnnotation {
    signalId: string;
    backtestRunId: string;
    exitRuleCode: string;
    exitRuleName: string;
    strategyCode: string;
    strategyName: string;
    symbol: string;
    timeframe: string;
    side: "LONG" | "SHORT";
    session: "ASIAN" | "LONDON" | "NY";
    entryTime: string;
    entryPrice: number;
    stopLoss: number;
    takeProfit1: number | null;
    takeProfit2: number | null;
    exitTime: string | null;
    exitPrice: number | null;
    win: boolean;
    isOpen: boolean;
    rMultiple: number;
    pnlUsd: number;
    label: string;
}

export interface SignalReviewRow {
    signalId: string;
    backtestRunId: string | null;
    backtestRunName: string | null;
    symbol: string;
    timeframe: string;
    side: "LONG" | "SHORT";
    session: "ASIAN" | "LONDON" | "NY";
    strategyId: string;
    strategyCode: string;
    strategyName: string;
    entryTime: string;
    entryPrice: number;
    stopLoss: number;
    takeProfit1: number | null;
    takeProfit2: number | null;
    notes: string | null;
    resultCount: number;
    wins: number;
    losses: number;
    openResults: number;
    netR: number;
    avgR: number;
    bestExitRuleCode: string | null;
    bestExitRuleName: string | null;
    latestExitTime: string | null;
}
