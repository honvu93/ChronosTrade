export type TradingFeatureFlagKey =
    | "trading_read_enabled"
    | "trading_write_enabled"
    | "trading_automation_enabled";

export type TradingCapabilityTier = "read" | "write" | "automation";
export type TradingAccountMode = "LIVE" | "PAPER";

export interface TradingFeatureFlags {
    trading_read_enabled: boolean;
    trading_write_enabled: boolean;
    trading_automation_enabled: boolean;
}

export interface TradingCapabilitySnapshot {
    tier: TradingCapabilityTier;
    flagKey: TradingFeatureFlagKey;
    requested: boolean;
    enabled: boolean;
    blockedBy: TradingFeatureFlagKey[];
    title: string;
    reason: string;
}

export interface TradingFeatureFlagSnapshot {
    evaluatedAt: string;
    flags: TradingFeatureFlags;
    capabilities: Record<TradingCapabilityTier, TradingCapabilitySnapshot>;
    highestEnabledTier: TradingCapabilityTier | "none";
}

export interface TradingFeatureFlagEnvelope {
    success: true;
    data: TradingFeatureFlagSnapshot;
}

export interface TradingPreflightSuccessEnvelope {
    success: true;
    data: {
        tier: Exclude<TradingCapabilityTier, "read">;
        title: string;
        message: string;
        nextAction: string;
        evaluatedAt: string;
    };
}

export interface TradingErrorEnvelope {
    success: false;
    error: {
        code: string;
        message: string;
        domain: string;
        meta?: Record<string, unknown>;
    };
}

export type SignalEligibilityState =
    | "live-eligible"
    | "validated"
    | "blocked"
    | "draft"
    | "no-backtest";

export interface SignalBlockingReason {
    code: string;
    label: string;
}

export type SignalConfidenceTier = "HIGH" | "VALIDATED" | "LIMITED";

export interface SignalEligibilityMetrics {
    closedTrades: number;
    openTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    netR: number;
    profitFactor: number;
    maxDrawdownPct: number;
    avgWinR: number | null;
    avgLossR: number | null;
    estimatedTradesPerDay: number | null;
    confidenceTier: SignalConfidenceTier | null;
}

export interface SignalLiveEligibilityItem {
    signalCode: string;
    signalVersion: number;
    signalName: string;
    backtestRunId: string | null;
    backtestRunName: string | null;
    backtestRunStatus: string | null;
    eligibilityState: SignalEligibilityState;
    blockingReasons: SignalBlockingReason[];
    metrics: SignalEligibilityMetrics | null;
    evaluatedAt: string;
}

export interface SignalEligibilityListEnvelope {
    success: true;
    data: {
        items: SignalLiveEligibilityItem[];
        evaluatedAt: string;
    };
}

export type TradingExternalDeploymentStatus =
    | "DRAFT"
    | "ACTIVE"
    | "PAUSED"
    | "AUTO_PAUSED"
    | "ARCHIVED";

export type TradingExternalActionEventStatus =
    | "READY"
    | "SENT"
    | "FAILED"
    | "CANCELED";

export type TradingExternalActionDeliveryStatus =
    | "PENDING"
    | "SENT"
    | "FAILED";

export type TradingExternalActionReplayStatus =
    | "QUEUED"
    | "PROCESSING"
    | "COMPLETED"
    | "FAILED";

export type TradingExternalActionability =
    | "ACTIONABLE"
    | "CANCELED"
    | "EXPIRED"
    | "SUPERSEDED"
    | "ADVISORY";

export type TradingExternalActionType = "OPEN_MARKET";
export type TradingExternalActionEventType = "ENTRY";

export interface TradingExternalActionableSignalEventContract {
    contractKind: "actionable-signal-event";
    contractVersion: 1;
    eventId: string;
    emittedAt: string;
    actionability: TradingExternalActionability;
    actionType: TradingExternalActionType;
    source: {
        signalCode: string;
        signalVersion: number;
        indicatorInstanceId: string;
        sourceBacktestRunId: string | null;
        externalDeploymentId: string;
        eligibilityState: SignalEligibilityState | "unknown";
    };
    market: {
        symbol: string;
        timeframe: string;
        side: "LONG" | "SHORT";
        candleTime: string;
        referencePrice: number | null;
    };
    execution: {
        entryPrice: number | null;
        entryType: "MARKET";
        stopLoss: number | null;
        takeProfit1: number | null;
        takeProfit2: number | null;
        suggestedVolume: number | null;
    };
    trace: {
        internalSignalEventId: string;
        signalKey: string;
    };
}

export interface TradingExternalDeploymentView {
    id: string;
    ownerUserId: string;
    indicatorInstanceId: string;
    signalCode: string;
    signalVersion: number;
    sourceBacktestRunId: string | null;
    status: TradingExternalDeploymentStatus;
    statusReason: string | null;
    eligibilityStateSnapshot: string | null;
    telegramBotLabel: string | null;
    hasTelegramBotToken: boolean;
    telegramChatId: string;
    telegramChatLabel: string | null;
    messageTemplateKind: string;
    createdByUserId: string | null;
    enabledByUserId: string | null;
    pausedByUserId: string | null;
    archivedByUserId: string | null;
    enabledAt: string | null;
    pausedAt: string | null;
    archivedAt: string | null;
    lastEligibilityCheckAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface TradingExternalActionEventView {
    id: string;
    externalDeploymentId: string;
    internalSignalEventId: string;
    idempotencyKey: string;
    contractKind: "actionable-signal-event";
    contractVersion: 1;
    eventType: TradingExternalActionEventType;
    actionability: TradingExternalActionability;
    actionType: TradingExternalActionType;
    signalCode: string;
    signalVersion: number;
    indicatorInstanceId: string;
    sourceBacktestRunId: string | null;
    symbol: string;
    timeframe: string;
    side: "LONG" | "SHORT";
    candleTime: string;
    referencePrice: number | null;
    entryPrice: number | null;
    entryType: "MARKET";
    stopLoss: number | null;
    takeProfit1: number | null;
    takeProfit2: number | null;
    suggestedVolume: number | null;
    payload: TradingExternalActionableSignalEventContract;
    status: TradingExternalActionEventStatus;
    statusReason: string | null;
    emittedAt: string;
    expiresAt: string | null;
    supersedesEventId: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface TradingExternalActionDeliveryView {
    id: string;
    externalActionEventId: string;
    externalDeploymentId: string;
    channelKind: "TELEGRAM";
    attemptNumber: number;
    status: TradingExternalActionDeliveryStatus;
    providerMessageId: string | null;
    providerChatId: string | null;
    requestFingerprint: string | null;
    requestJson: Record<string, unknown> | null;
    responseJson: Record<string, unknown> | null;
    errorCode: string | null;
    errorMessage: string | null;
    attemptedAt: string;
    deliveredAt: string | null;
    createdAt: string;
}

export interface TradingExternalActionReplayJobView {
    id: string;
    externalActionEventId: string;
    replayKind: "MANUAL_RETRY" | "AUTOMATIC_RETRY" | "BACKFILL_REPLAY";
    status: TradingExternalActionReplayStatus;
    queuedAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    errorMessage: string | null;
    createdByUserId: string | null;
    createdAt: string;
}

export interface TradingExternalDeploymentInput {
    indicatorInstanceId: string;
    telegramBotToken: string;
    telegramBotLabel?: string | null;
    telegramChatId: string;
    telegramChatLabel?: string | null;
    messageTemplateKind?: string | null;
}

export interface TradingExternalDeploymentListEnvelope {
    success: true;
    data: {
        deployments: TradingExternalDeploymentView[];
        evaluatedAt: string;
    };
}

export interface TradingExternalDeploymentEnvelope {
    success: true;
    data: TradingExternalDeploymentView;
}

export interface TradingExternalActionEventListEnvelope {
    success: true;
    data: {
        events: TradingExternalActionEventView[];
        evaluatedAt: string;
    };
}

export interface TradingExternalActionDeliveryListEnvelope {
    success: true;
    data: {
        deliveries: TradingExternalActionDeliveryView[];
        evaluatedAt: string;
    };
}

export interface TradingExternalActionReplayEnvelope {
    success: true;
    data: TradingExternalActionReplayJobView;
}

export type AccountReadinessState =
    | "ready"
    | "execution-blocked"
    | "credentials-missing"
    | "credentials-partial"
    | "bridge-unreachable"
    | "unchecked";

export interface AccountReadinessCheckItem {
    key: string;
    label: string;
    passed: boolean;
    detail: string;
}

export interface AccountReadinessSnapshot {
    state: AccountReadinessState;
    checks: AccountReadinessCheckItem[];
    blockingReasons: string[];
    executionFailureCode: string | null;
    executionReadinessMessage: string | null;
    accountId: string | null;
    accountLabel: string | null;
    accountMode: TradingAccountMode | null;
    hasStoredCredential: boolean;
    mt5Login: string | null;
    mt5Server: string | null;
    bridgePort: string | null;
    evaluatedAt: string;
}

export interface AccountReadinessEnvelope {
    success: true;
    data: AccountReadinessSnapshot;
}

export interface TradingAccountSummary {
    id: string;
    ownerUserId: string;
    ownerEmail: string;
    ownerUsername: string;
    ownerDisplayName: string | null;
    label: string;
    brokerKind: "MT5";
    accountMode: TradingAccountMode;
    status: string;
    baseCurrency: string | null;
    leverage: number | null;
    lastSeenAt: string | null;
    lastSuccessfulSyncAt: string | null;
    mt5Login: string | null;
    mt5Server: string | null;
    hasStoredCredential: boolean;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface TradingAccountMutationInput {
    ownerUserId?: string | null;
    label: string;
    accountMode?: TradingAccountMode | null;
    mt5Login: string;
    mt5Password?: string | null;
    mt5Server: string;
}

export interface TradingAccountListEnvelope {
    success: true;
    data: {
        accounts: TradingAccountSummary[];
        activeAccountId: string | null;
    };
}

export interface TradingAccountMutationEnvelope {
    success: true;
    data: {
        account: TradingAccountSummary;
    };
}

export interface TradingAccountDeleteEnvelope {
    success: true;
    data: {
        deletedId: string;
        activeAccountId: string | null;
    };
}

export interface TradingAccountSelectionEnvelope {
    success: true;
    data: {
        account: TradingAccountSummary;
        activeAccountId: string;
    };
}

export type TradingWorkspaceSyncState = "healthy" | "stale" | "disconnected" | "failed";
export type TradingWorkspaceTab =
    | "overview"
    | "eligibility"
    | "positions"
    | "orders"
    | "history"
    | "automation"
    | "external"
    | "audit";

export interface TradingWorkspaceSyncHealth {
    state: TradingWorkspaceSyncState;
    label: string;
    message: string;
    reasonCode?: string | null;
    lastSuccessfulSyncAt: string | null;
    lastSyncAttemptAt: string | null;
    staleAfterSeconds: number;
    canForceSync: boolean;
    canTrade: boolean;
}

export interface TradingWorkspaceSummary {
    accountId: string;
    accountLabel: string;
    brokerKind: "MT5";
    accountMode: TradingAccountMode;
    accountStatus: string;
    mt5Login: string | null;
    mt5Server: string | null;
    baseCurrency: string | null;
    leverage: number | null;
    balance: number;
    equity: number;
    margin: number;
    freeMargin: number;
    marginLevel: number | null;
    unrealizedPnl: number;
    realizedPnlDay: number;
    openPositionCount: number;
    pendingOrderCount: number;
    totalDealCount: number;
    syncHealth: TradingWorkspaceSyncHealth;
    evaluatedAt: string;
}

export interface TradingWorkspacePosition {
    id: string;
    brokerPositionId: string;
    brokerOrderId: string | null;
    symbol: string;
    side: "LONG" | "SHORT";
    volume: number;
    openPrice: number;
    stopLoss: number | null;
    takeProfit: number | null;
    currentPrice: number | null;
    swap: number;
    commission: number;
    unrealizedPnl: number;
    openedAt: string;
    closedAt: string | null;
    status: string;
    lastSyncedAt: string;
}

export interface TradingWorkspaceOrder {
    id: string;
    brokerOrderId: string;
    relatedPositionBrokerId: string | null;
    symbol: string;
    side: "LONG" | "SHORT";
    orderType: string;
    requestedVolume: number;
    filledVolume: number;
    price: number | null;
    stopLoss: number | null;
    takeProfit: number | null;
    status: string;
    placedAt: string;
    expiresAt: string | null;
    lastSyncedAt: string;
}

export interface TradingWorkspaceDeal {
    id: string;
    brokerDealId: string;
    brokerOrderId: string | null;
    brokerPositionId: string | null;
    symbol: string;
    side: "LONG" | "SHORT";
    volume: number;
    price: number;
    commission: number;
    swap: number;
    fee: number;
    realizedPnl: number;
    executedAt: string;
    comment: string | null;
}

export interface TradingWorkspaceSyncRun {
    id: string;
    syncKind: string;
    status: string;
    requestedByUserId: string | null;
    startedAt: string;
    finishedAt: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    summaryJson: unknown | null;
}

export interface TradingWorkspaceSnapshot {
    summary: TradingWorkspaceSummary;
    positions: TradingWorkspacePosition[];
    orders: TradingWorkspaceOrder[];
    deals: TradingWorkspaceDeal[];
    syncRuns: TradingWorkspaceSyncRun[];
}

export interface TradingWorkspaceEnvelope {
    success: true;
    data: TradingWorkspaceSnapshot;
}

export interface TradingCollectionEnvelope<T> {
    success: true;
    data: {
        items: T[];
    };
}

export interface TradingExecutionEventView {
    id: string;
    eventType: string;
    occurredAt: string;
    statusBefore: string | null;
    statusAfter: string | null;
    message: string | null;
    payloadJson: unknown | null;
}

export interface TradingExecutionCommandView {
    id: string;
    accountId: string;
    commandType: string;
    status: string;
    idempotencyKey: string;
    symbol: string | null;
    side: string | null;
    volume: number | null;
    price: number | null;
    stopLoss: number | null;
    takeProfit: number | null;
    brokerPositionId: string | null;
    brokerOrderId: string | null;
    brokerReference: string | null;
    requestedAt: string;
    dispatchedAt: string | null;
    completedAt: string | null;
    reconciledAt: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    events: TradingExecutionEventView[];
}

export interface TradingExecutionCommandInput {
    commandType:
        | "OPEN_MARKET"
        | "CLOSE_POSITION"
        | "PARTIAL_CLOSE"
        | "PLACE_PENDING"
        | "MODIFY_POSITION"
        | "CANCEL_ORDER"
        | "FORCE_SYNC";
    symbol?: string | null;
    side?: "LONG" | "SHORT" | null;
    volume?: number | null;
    price?: number | null;
    stopLoss?: number | null;
    takeProfit?: number | null;
    brokerPositionId?: string | null;
    brokerOrderId?: string | null;
    orderType?: "MARKET" | "BUY_LIMIT" | "SELL_LIMIT" | "BUY_STOP" | "SELL_STOP" | null;
    comment?: string | null;
    idempotencyKey?: string | null;
}

export interface TradingExecutionCommandEnvelope {
    success: true;
    data: TradingExecutionCommandView;
}

export interface TradingExecutionCommandListEnvelope {
    success: true;
    data: {
        items: TradingExecutionCommandView[];
    };
}

export interface TradingAutomationIndicatorCandidate {
    id: string;
    name: string;
    status: string;
    signalCode: string;
    signalVersion: number;
    symbol: string;
    timeframe: string;
    sourceBacktestRunId: string | null;
    updatedAt: string;
}

export interface TradingAutomationBindingView {
    id: string;
    accountId: string;
    indicatorInstanceId: string;
    indicatorName: string;
    indicatorStatus: string;
    signalCode: string;
    signalVersion: number;
    symbol: string;
    timeframe: string;
    name: string;
    status: string;
    mode: string;
    approvalRequired: boolean;
    killSwitchActive: boolean;
    createdByUserId: string | null;
    approvedByUserId: string | null;
    approvedAt: string | null;
    lastTriggeredAt: string | null;
    statusReason: string | null;
    filtersJson: unknown | null;
    riskConfigJson: unknown | null;
    guardrailsJson: unknown | null;
    createdAt: string;
    updatedAt: string;
}

export interface TradingAutomationBindingInput {
    indicatorInstanceId: string;
    name: string;
    mode: "OBSERVE" | "MANUAL_APPROVAL" | "AUTO_EXECUTE";
    filtersJson?: unknown | null;
    riskConfigJson?: unknown | null;
    guardrailsJson?: unknown | null;
    approvalRequired?: boolean;
    killSwitchActive?: boolean;
}

export interface TradingAutomationBindingStatusInput {
    status: "PENDING_APPROVAL" | "ACTIVE" | "PAUSED" | "ARCHIVED";
    killSwitchActive?: boolean;
    statusReason?: string | null;
}

export interface TradingAutomationSnapshot {
    autoExecuteLocked: boolean;
    pendingApprovalCount: number;
    bindings: TradingAutomationBindingView[];
    availableIndicators: TradingAutomationIndicatorCandidate[];
}

export interface TradingAutomationSnapshotEnvelope {
    success: true;
    data: TradingAutomationSnapshot;
}

export interface TradingAutomationBindingEnvelope {
    success: true;
    data: TradingAutomationBindingView;
}

export interface TradingTradeIntentView {
    id: string;
    accountId: string;
    bindingId: string;
    bindingName: string;
    indicatorInstanceId: string;
    indicatorName: string;
    signalEventId: string;
    executionCommandId: string | null;
    executionCommandStatus: string | null;
    executionCommandError: string | null;
    mode: string;
    status: string;
    statusReason: string | null;
    eventType: string;
    commandType: string;
    symbol: string;
    side: "LONG" | "SHORT" | null;
    volume: number | null;
    entryPrice: number | null;
    stopLoss: number | null;
    takeProfit: number | null;
    candleTime: string;
    createdAt: string;
    updatedAt: string;
    startedAt: string | null;
    completedAt: string | null;
    payloadJson: unknown | null;
}

export interface TradingTradeIntentListEnvelope {
    success: true;
    data: {
        items: TradingTradeIntentView[];
    };
}

// ---------------------------------------------------------------------------
// Failure Classification (Story 5.2)
// ---------------------------------------------------------------------------

export type FailureDomain = "ingestion" | "signal" | "alert" | "trading";
export type FailureSeverity = "critical" | "warning" | "ok";

export interface DomainFailureItem {
    id: string;
    domain: FailureDomain;
    severity: FailureSeverity;
    title: string;
    detail: string;
    detectedAt: string;
    signalCode?: string | null;
    signalVersion?: number | null;
    backtestRunId?: string | null;
    indicatorInstanceId?: string | null;
    symbol?: string | null;
    timeframe?: string | null;
}

export interface DomainStatus {
    severity: FailureSeverity;
    items: DomainFailureItem[];
}

export interface FailureClassificationSnapshot {
    domains: Record<FailureDomain, DomainStatus>;
    totalCritical: number;
    totalWarning: number;
    evaluatedAt: string;
}

export interface FailureClassificationEnvelope {
    success: true;
    data: FailureClassificationSnapshot;
}

// ---------------------------------------------------------------------------
// Signal Version Inspection (Story 5.3)
// ---------------------------------------------------------------------------

export type SignalVersionOriginKind =
    | "signal-definition"
    | "backtest-run"
    | "indicator-instance";

export interface SignalVersionAccountContext {
    readinessState: AccountReadinessState;
    accountId: string | null;
    accountLabel: string | null;
    mt5Login: string | null;
    mt5Server: string | null;
}

export interface SignalVersionRequestParams {
    code: string;
    version: number;
    backtestRunId?: string | null;
    indicatorInstanceId?: string | null;
}

export interface SignalVersionSnapshot {
    signalCode: string;
    signalVersion: number;
    signalName: string;
    category: string | null;
    description: string | null;
    parameterSchema: Record<string, unknown>;
    indicatorSchema: Record<string, unknown> | null;
    eventSchema: Record<string, unknown> | null;
    composedBlocks: Record<string, unknown> | null;
    isComposed: boolean;
    createdBy: string | null;
    createdAt: string;
    originKind: SignalVersionOriginKind;
    originRecordId: string | null;
    originRecordLabel: string | null;
    originStatus: string | null;
    originSymbol: string | null;
    originTimeframe: string | null;
    parameterValuesJson: Record<string, unknown> | null;
    linkedBacktestRunId: string | null;
    linkedBacktestName: string | null;
    linkedBacktestStatus: string | null;
    linkedBacktestSymbol: string | null;
    linkedBacktestTimeframe: string | null;
    executionConfigJson: Record<string, unknown> | null;
    accountContext: SignalVersionAccountContext | null;
}

export interface SignalVersionEnvelope {
    success: true;
    data: SignalVersionSnapshot;
}

/** Carries the context that was active when the inspector was launched,
 *  so the originating investigation thread is not lost. */
export interface SignalVersionOriginContext {
    /** Human-readable label, e.g. "Signal Eligibility Review" */
    label: string;
    /** Optional additional detail shown in the drawer header */
    detail?: string;
}

// ---------------------------------------------------------------------------
// Trade History & Audit Timeline (Story 5.4)
// ---------------------------------------------------------------------------

export type TradeHistoryAuditResult = "ACTIVE" | "WIN" | "LOSS" | "BE";
export type TradeHistoryAuditCoverage = "full" | "partial" | "missing";
export type TradeHistoryAuditTimelineKind = "command" | "decision";

export interface TradeHistoryAuditSummary {
    totalRecords: number;
    activeTrades: number;
    wins: number;
    losses: number;
    breakEven: number;
    recordsWithAudit: number;
    recordsMissingAudit: number;
    commandEvents: number;
    decisionEvents: number;
}

export interface TradeHistoryAuditRecord {
    recordId: string;
    rowId: string;
    signalId: string;
    backtestRunId: string;
    exitRuleId: string;
    exitRuleCode: string;
    exitRuleName: string;
    runName: string;
    runStatus: string;
    signalCode: string | null;
    signalVersion: number | null;
    symbol: string;
    timeframe: string;
    side: string;
    session: string;
    entryTime: string;
    exitTime: string | null;
    entryPrice: number;
    stopLoss: number;
    exitPrice: number | null;
    rMultiple: number;
    pnlUsd: number;
    result: TradeHistoryAuditResult;
    exitReason: string;
    notes: string | null;
    commandEventCount: number;
    decisionEventCount: number;
    auditCoverage: TradeHistoryAuditCoverage;
    latestAuditAt: string | null;
}

export interface TradeHistoryAuditSnapshot {
    summary: TradeHistoryAuditSummary;
    records: TradeHistoryAuditRecord[];
    evaluatedAt: string;
}

export interface TradeHistoryAuditTraceability {
    historyRecordId: string;
    rowId: string;
    signalId: string;
    backtestRunId: string;
    runName: string;
    signalKey: string | null;
    exitRuleCode: string;
    summaryLabel: string;
    scopeLabel: string;
    scopeDetail: string;
}

export interface TradeHistoryAuditTimelineSummary {
    totalItems: number;
    commandEvents: number;
    decisionEvents: number;
    firstOccurredAt: string | null;
    lastOccurredAt: string | null;
}

export interface TradeHistoryAuditTimelineItem {
    id: string;
    kind: TradeHistoryAuditTimelineKind;
    source: "event" | "trace";
    eventType: string;
    occurredAt: string;
    createdAt: string;
    label: string | null;
    price: number | null;
    signalEventId: string | null;
    stateBefore: string | null;
    stateAfter: string | null;
    ruleId: string | null;
    notes: string | null;
    metaJson: unknown | null;
    indicatorJson: unknown | null;
    thresholdJson: unknown | null;
    priceJson: unknown | null;
}

export interface TradeHistoryAuditDetailSnapshot {
    record: TradeHistoryAuditRecord;
    traceability: TradeHistoryAuditTraceability;
    timelineSummary: TradeHistoryAuditTimelineSummary;
    timeline: TradeHistoryAuditTimelineItem[];
    evaluatedAt: string;
}

export interface TradeHistoryAuditEnvelope {
    success: true;
    data: TradeHistoryAuditSnapshot;
}

export interface TradeHistoryAuditDetailEnvelope {
    success: true;
    data: TradeHistoryAuditDetailSnapshot;
}

// ---------------------------------------------------------------------------
// Backtest vs Live Discrepancy Investigation (Story 5.5)
// ---------------------------------------------------------------------------

export type TradingDiscrepancySeverity = "critical" | "warning" | "info";
export type TradingDiscrepancyInvestigationKind =
    | "alert-driven"
    | "reported-issue"
    | "mixed-context";
export type TradingDiscrepancyMatchReason =
    | "exact"
    | "source-run"
    | "market-context"
    | "signal-version";

export interface TradingDiscrepancyRequestParams {
    code: string;
    version: number;
    backtestRunId?: string | null;
    indicatorInstanceId?: string | null;
    tradeRecordId?: string | null;
}

export interface TradingDiscrepancyInsight {
    code: string;
    severity: TradingDiscrepancySeverity;
    title: string;
    detail: string;
    backtestValue: string | null;
    liveValue: string | null;
}

export interface TradingDiscrepancyLinkedRecords {
    signalKey: string;
    backtestRunId: string | null;
    tradeRecordId: string | null;
    signalId: string | null;
    primaryIndicatorInstanceId: string | null;
    deploymentRecordIds: string[];
    commandRecordIds: string[];
    reportPath: string | null;
}

export interface TradingDiscrepancyReportSummary {
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
}

export interface TradingDiscrepancySignalReview {
    signalId: string;
    symbol: string;
    timeframe: string;
    side: string;
    session: string;
    strategyCode: string;
    strategyName: string;
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

export interface TradingDiscrepancyTradeIssue {
    recordId: string;
    rowId: string;
    signalId: string;
    exitRuleCode: string;
    exitRuleName: string;
    result: TradeHistoryAuditResult;
    exitReason: string;
    rMultiple: number;
    pnlUsd: number;
    entryTime: string;
    exitTime: string | null;
    auditCommandRecords: number;
    auditDecisionRecords: number;
    auditLatestAt: string | null;
}

export interface TradingDiscrepancyBacktestContext {
    runId: string;
    runName: string;
    runStatus: string;
    symbol: string;
    timeframe: string;
    parametersJson: Record<string, unknown> | null;
    executionConfigJson: Record<string, unknown> | null;
    reportSummary: TradingDiscrepancyReportSummary | null;
    signalReview: TradingDiscrepancySignalReview | null;
    tradeIssue: TradingDiscrepancyTradeIssue | null;
}

export interface TradingDiscrepancyDeploymentContext {
    indicatorInstanceId: string;
    name: string;
    status: string;
    symbol: string;
    timeframe: string;
    matchedBy: TradingDiscrepancyMatchReason;
    sourceBacktestRunId: string | null;
    startedAt: string | null;
    updatedAt: string;
    lastProcessedCandleTime: string | null;
    lastEmittedEventTime: string | null;
    errorMessage: string | null;
    parameterJson: Record<string, unknown> | null;
    executionConfigJson: Record<string, unknown> | null;
    commandRecordCount: number;
    decisionRecordCount: number;
    latestRecordId: string | null;
    latestEventType: string | null;
    latestOccurredAt: string | null;
    latestLabel: string | null;
}

export interface TradingDiscrepancyLiveContext {
    primaryIndicatorInstanceId: string | null;
    deployments: TradingDiscrepancyDeploymentContext[];
    timelineSummary: TradeHistoryAuditTimelineSummary | null;
    recentTimeline: TradeHistoryAuditTimelineItem[];
}

export interface TradingDiscrepancySnapshot {
    investigationKind: TradingDiscrepancyInvestigationKind;
    signalCode: string;
    signalVersion: number;
    signalName: string | null;
    linkedRecords: TradingDiscrepancyLinkedRecords;
    backtest: TradingDiscrepancyBacktestContext | null;
    live: TradingDiscrepancyLiveContext;
    discrepancies: TradingDiscrepancyInsight[];
    evaluatedAt: string;
}

export interface TradingDiscrepancyEnvelope {
    success: true;
    data: TradingDiscrepancySnapshot;
}

// ---------------------------------------------------------------------------
// Root Cause Diagnosis & Investigation Outcomes (Story 5.6)
// ---------------------------------------------------------------------------

export type TradingRootCauseCategory =
    | "data-quality"
    | "signal-logic"
    | "risk-settings"
    | "broker-execution";

export type TradingInvestigationOutcome = "resolved" | "mitigated" | "escalated";
export type TradingDiagnosisEvidenceSeverity = "critical" | "warning" | "info";
export type TradingDiagnosisConfidence = "high" | "medium" | "low";
export type TradingDiagnosisSectionKey =
    | "differences"
    | "backtest"
    | "live"
    | "timeline"
    | "account"
    | "history";

export interface TradingDiagnosisRequestParams {
    code: string;
    version: number;
    backtestRunId?: string | null;
    indicatorInstanceId?: string | null;
    tradeRecordId?: string | null;
}

export interface TradingDiagnosisEvidence {
    id: string;
    source: "failure-classification" | "discrepancy" | "eligibility" | "account-readiness";
    severity: TradingDiagnosisEvidenceSeverity;
    title: string;
    detail: string;
    linkedRecordLabel: string;
    linkedRecordId: string | null;
    sectionKey: TradingDiagnosisSectionKey;
    href: string | null;
}

export interface TradingDiagnosisCategoryAssessment {
    category: TradingRootCauseCategory;
    label: string;
    score: number;
    confidence: TradingDiagnosisConfidence;
    severity: TradingDiagnosisEvidenceSeverity;
    summary: string;
    evidence: TradingDiagnosisEvidence[];
}

export interface TradingDiagnosisLinkedRecords {
    signalKey: string;
    backtestRunId: string | null;
    tradeRecordId: string | null;
    signalId: string | null;
    primaryIndicatorInstanceId: string | null;
    reportPath: string | null;
}

export interface TradingInvestigationDecisionContext {
    selectedCategory: TradingRootCauseCategory;
    selectedOutcome: TradingInvestigationOutcome;
    investigationKind: TradingDiscrepancyInvestigationKind;
    linkedRecords: TradingDiagnosisLinkedRecords;
    score: number;
    confidence: TradingDiagnosisConfidence;
    evidence: TradingDiagnosisEvidence[];
}

export interface TradingInvestigationOutcomeRecord {
    id: string;
    signalCode: string;
    signalVersion: number;
    rootCauseCategory: TradingRootCauseCategory;
    outcome: TradingInvestigationOutcome;
    backtestRunId: string | null;
    indicatorInstanceId: string | null;
    tradeRecordId: string | null;
    summary: string | null;
    decidedAt: string;
    decisionContext: TradingInvestigationDecisionContext | null;
}

export interface TradingDiagnosisSnapshot {
    signalCode: string;
    signalVersion: number;
    signalName: string | null;
    investigationKind: TradingDiscrepancyInvestigationKind;
    primaryCategory: TradingRootCauseCategory | null;
    categories: TradingDiagnosisCategoryAssessment[];
    linkedRecords: TradingDiagnosisLinkedRecords;
    latestOutcome: TradingInvestigationOutcomeRecord | null;
    history: TradingInvestigationOutcomeRecord[];
    evaluatedAt: string;
}

export interface TradingDiagnosisEnvelope {
    success: true;
    data: TradingDiagnosisSnapshot;
}

// ---------------------------------------------------------------------------
// External Output Contracts (Story 6.1)
// ---------------------------------------------------------------------------

export type TradingOutputContractKind =
    | "signal-event"
    | "execution-event"
    | "trade-outcome"
    | "investigation-outcome";

export interface TradingOutputEnvelope<T = unknown> {
    contractKind: TradingOutputContractKind;
    contractVersion: number;
    recordId: string;
    signalKey: string;
    emittedAt: string;
    payload: T;
}

export interface TradingOutputContractDefinition {
    kind: TradingOutputContractKind;
    version: number;
    label: string;
    description: string;
    fields: TradingOutputContractField[];
}

export interface TradingOutputContractField {
    name: string;
    type: string;
    required: boolean;
    description: string;
}

export interface TradingSignalEventPayload {
    signalCode: string;
    signalVersion: number;
    signalId: string;
    symbol: string;
    timeframe: string;
    side: string;
    session: string;
    eventType: string;
    occurredAt: string;
    backtestRunId: string | null;
    indicatorInstanceId: string | null;
}

export interface TradingExecutionEventPayload {
    signalCode: string;
    signalVersion: number;
    eventType: string;
    kind: TradeHistoryAuditTimelineKind;
    occurredAt: string;
    label: string | null;
    stateBefore: string | null;
    stateAfter: string | null;
    backtestRunId: string | null;
    indicatorInstanceId: string | null;
    tradeRecordId: string | null;
}

export interface TradingTradeOutcomePayload {
    signalCode: string;
    signalVersion: number;
    symbol: string;
    timeframe: string;
    side: string;
    result: TradeHistoryAuditResult;
    exitReason: string;
    rMultiple: number;
    pnlUsd: number;
    entryTime: string;
    exitTime: string | null;
    backtestRunId: string;
    tradeRecordId: string;
}

export interface TradingInvestigationOutcomePayload {
    signalCode: string;
    signalVersion: number;
    rootCauseCategory: TradingRootCauseCategory;
    outcome: TradingInvestigationOutcome;
    summary: string | null;
    decidedAt: string;
    backtestRunId: string | null;
    indicatorInstanceId: string | null;
    tradeRecordId: string | null;
}

export interface TradingOutputContractListEnvelope {
    success: true;
    data: {
        contracts: TradingOutputContractDefinition[];
        evaluatedAt: string;
    };
}

export interface TradingOutputContractDetailEnvelope {
    success: true;
    data: TradingOutputContractDefinition;
}
