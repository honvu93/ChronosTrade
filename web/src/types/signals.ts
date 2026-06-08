export interface SignalDefinitionField {
    id: string;
    type: string;
    label: string;
    default?: unknown;
    options?: Array<string | number>;
    min?: number;
    max?: number;
    step?: number;
}

export interface BlockParamSchemaGroup {
    blockId: string;
    indicatorId: string;
    indicatorName: string;
    paramSchema: SignalDefinitionField[];
}

export interface SignalDefinition {
    id: string;
    code: string;
    version: number;
    name: string;
    category: string | null;
    description: string | null;
    parameterSchema: {
        fields?: SignalDefinitionField[];
    } | null;
    indicatorSchema: Record<string, unknown> | null;
    eventSchema: Record<string, unknown> | null;
    isComposed?: boolean;
    composedBlocks?: ComposedSignalBlocks | null;
    blockParamSchemas?: BlockParamSchemaGroup[];
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface TradeGuardLossStreakThrottleStep {
    afterLosses: number;
    riskPercent: number;
}

export interface TradeGuardConfig {
    lossStreakThrottle?: { steps?: TradeGuardLossStreakThrottleStep[] };
    lossStreakCooldown?: { afterLosses?: number; cooldownMinutes?: number };
    sessionLossCap?: { maxLosses?: number; maxNetR?: number };
    dayLossCap?: { maxLosses?: number; maxNetR?: number };
    equityCurveFilter?: { emaTrades?: number; action?: 'BLOCK' | 'HALF_RISK' };
    maxDrawdownHalt?: { maxDrawdownPct?: number };
    minTradeSpacing?: { minSpacingMinutes?: number };
}

export interface ExecutionConfigView {
    entryFeeBps: number;
    exitFeeBps: number;
    entrySlippageBps: number;
    exitSlippageBps: number;
    orderTiming: "SIGNAL_BAR_CLOSE" | "NEXT_BAR_OPEN" | "LIMIT_TOUCH";
    stopLoss: {
        mode: "SIGNAL_PRICE" | "FIXED_AMOUNT" | "ACCOUNT_PERCENT";
        value: number | null;
    };
    takeProfit: {
        mode: "SIGNAL_PRICE" | "FIXED_AMOUNT" | "ACCOUNT_PERCENT" | "R_MULTIPLE";
        value: number | null;
    };
    positionSizing: {
        mode: "RISK_BASED" | "FIXED_QUANTITY" | "ACCOUNT_PERCENT";
        value: number | null;
    };
    tradeGuards?: TradeGuardConfig;
}

export interface GeneratedBacktestRun {
    id: string;
    name: string;
    sourceType: string;
    status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELED";
    signalCode: string;
    signalVersion: number;
    symbol: string;
    timeframe: string;
    startedAt: string;
    finishedAt: string | null;
    initialEquity: number;
    riskPercent: number;
    parametersJson: Record<string, unknown> | null;
    executionConfigJson: ExecutionConfigView | null;
    notes: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface GeneratedBacktestDetail extends GeneratedBacktestRun {
    errorMessage: string | null;
    counts: {
        signals: number;
        events: number;
        traces: number;
        results: number;
    };
    guardMetrics?: {
        blockedEntryCount: number;
    };
}

export interface SignalPreviewOutput {
    signalCode: string;
    signalVersion: number;
    symbol: string;
    timeframe: string;
    dateRange: {
        from: string;
        to: string;
    };
    counts: {
        barsProcessed: number;
        signals: number;
        events: number;
        traces: number;
        results: number;
    };
    signals: Array<{
        symbol: string;
        timeframe: string;
        side: "LONG" | "SHORT";
        session?: "ASIAN" | "LONDON" | "NY" | null;
        entryTime: string;
        entryPrice: number;
        stopLoss: number;
        takeProfit1?: number | null;
        takeProfit2?: number | null;
        notes?: string | null;
        externalKey?: string | null;
    }>;
    events: Array<{
        signalExternalKey: string;
        eventType: string;
        candleTime: string;
        price?: number | null;
        label?: string | null;
        metaJson?: Record<string, unknown> | null;
    }>;
    traces: Array<{
        signalExternalKey: string;
        eventType: string;
        candleTime: string;
        stateBefore?: string | null;
        stateAfter?: string | null;
        ruleId?: string | null;
        notes?: string | null;
        indicatorJson?: Record<string, unknown> | null;
        thresholdJson?: Record<string, unknown> | null;
        priceJson?: Record<string, unknown> | null;
    }>;
    results: Array<{
        signalExternalKey: string;
        exitRuleCode?: string | null;
        exitRuleName?: string | null;
        exitRuleConfigJson?: Record<string, unknown> | null;
        resultSide: "LONG" | "SHORT";
        session: "ASIAN" | "LONDON" | "NY";
        win: boolean;
        isOpen: boolean;
        rMultiple: number;
        pnlUsd: number;
        maxDrawdownPct: number;
        exitReason: string;
        exitTime?: string | null;
        exitPrice?: number | null;
        notes?: string | null;
    }>;
}

export type IndicatorStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "FAILED" | "ARCHIVED";

export type AlertType = "PRICE" | "INDICATOR" | "VOLATILITY";

export interface IndicatorAlert {
    id: string;
    instanceId: string;
    type: AlertType;
    conditionJson: Record<string, unknown>;
    isActive: boolean;
    lastTriggeredAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface TriggeredAlert {
    alertId: string;
    instanceId: string;
    instanceName: string;
    symbol: string;
    message: string;
    timestamp: string;
}

export interface IndicatorInstance {
    id: string;
    name: string;
    status: IndicatorStatus;
    sourceBacktestRunId: string | null;
    signalCode: string;
    signalVersion: number;
    symbol: string;
    timeframe: string;
    parameterJson: Record<string, unknown>;
    executionConfigJson: Record<string, unknown> | null;
    lastProcessedCandleTime: string | null;
    lastEmittedEventTime: string | null;
    stateJson: Record<string, unknown> | null;
    stateVersion: number;
    errorMessage: string | null;
    startedAt: string | null;
    stoppedAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface IndicatorEvent {
    id: string;
    indicatorInstanceId?: string;
    backtestRunId?: string;
    eventType: string;
    candleTime: string;
    price: number | null;
    label: string | null;
    metaJson: Record<string, unknown> | null;
    createdAt: string;
}

// ─── Tech Indicator / Composed Signal types ──────────────────────────────────

export interface TechIndicatorFieldSchema {
    id: string;
    type: 'number' | 'select' | 'boolean' | 'string';
    label: string;
    default?: number | string | boolean;
    min?: number;
    max?: number;
    step?: number;
    options?: Array<{
        value: string;
        label: string;
    }>;
    required?: boolean;
}

export interface TechIndicatorConditionDef {
    id: string;
    name: string;
    description: string;
    paramSchema: TechIndicatorFieldSchema[];
}

export interface TechIndicatorDefinition {
    id: string;
    name: string;
    category: string;
    description: string;
    paramSchema: TechIndicatorFieldSchema[];
    conditions: TechIndicatorConditionDef[];
}

export type IndicatorCatalogLifecycleStatus = 'DRAFT' | 'PUBLISHED' | 'RETIRED';
export type IndicatorCatalogBindingStatus = 'MATCHED' | 'MISSING_BINDING' | 'MISSING_RUNTIME' | 'SCHEMA_MISMATCH';

export interface IndicatorCatalogDependencyReference {
    signalDefinitionId: string;
    signalCode: string;
    signalVersion: number;
    signalName: string;
    isActive: boolean;
    blockCount: number;
}

export interface IndicatorCatalogDependencySummary {
    totalSignals: number;
    activeSignals: number;
    inactiveSignals: number;
    references: IndicatorCatalogDependencyReference[];
}

export interface IndicatorCatalogDiagnostics {
    bindingStatus: IndicatorCatalogBindingStatus;
    bindingMessage: string;
    composerAvailable: boolean;
    publishBlockingReasons: string[];
    deleteBlockingReasons: string[];
}

export interface IndicatorCatalogRecord extends TechIndicatorDefinition {
    runtimeBindingKey: string | null;
    catalogStatus: IndicatorCatalogLifecycleStatus;
    isActive: boolean;
    hasDraftChanges: boolean;
    createdAt: string;
    createdBy: string | null;
    updatedAt: string;
    updatedBy: string | null;
    draftUpdatedAt: string | null;
    draftUpdatedBy: string | null;
    publishedAt: string | null;
    publishedBy: string | null;
    retiredAt: string | null;
    retiredBy: string | null;
    diagnostics: IndicatorCatalogDiagnostics;
    dependencies: IndicatorCatalogDependencySummary;
}

export interface IndicatorCatalogWriteInput {
    id: string;
    name: string;
    category: string;
    description: string;
    runtimeBindingKey: string;
    paramSchema: TechIndicatorFieldSchema[];
    conditions: TechIndicatorConditionDef[];
}

export interface ComposedBlockConfig {
    id: string;              // unique uuid within the signal
    indicatorId: string;     // e.g. 'RSI'
    conditionId: string;     // e.g. 'crosses_above'
    indicatorParams: Record<string, unknown>;
    conditionParams: Record<string, unknown>;
    timeframe?: string;      // optional multi-TF
}

export type ComposedMatchMode = 'ALL' | 'ANY' | 'SEQUENCE';
export type ComposedSide = 'LONG' | 'SHORT';
export type ComposedSlType = 'FIXED_PERCENT' | 'BELOW_STRUCTURE';
export type ComposedTpType = 'FIXED_PERCENT' | 'R_MULTIPLE';
export type ComposedSignalLineageRelationship = 'REFINEMENT';
export type ComposedExitManagementProfileCode =
    | 'HARD_SIGNAL_TP'
    | 'FIXED_2R'
    | 'BE_1R_TP_2R'
    | 'PARTIAL_1R_BE_R3'
    | 'BE_1R_TRAIL_2R_3R'
    | 'BE_1R_PARTIAL_2R_TRAIL'
    | 'PARTIAL_1R_BE_SWING_TRAIL'
    | 'XAU_NY_CLOSE'
    | 'TIME_24';

export interface ComposedSignalLineage {
    relationship: ComposedSignalLineageRelationship;
    parentSignalId: string;
    parentCode: string;
    parentVersion: number;
    parentName: string;
}

export interface ComposedSignalBlocks {
    matchMode: ComposedMatchMode;
    windowBars: number;
    side: ComposedSide;
    blocks: ComposedBlockConfig[];
    stopLoss: {
        type: ComposedSlType;
        value: number;
        lookback?: number;
        atrBufferMultiplier?: number;
        atrPeriod?: number;
    };
    takeProfit: { type: ComposedTpType; value: number };
    exitManagement?: {
        profileCode: ComposedExitManagementProfileCode;
    };
    lineage?: ComposedSignalLineage;
    symbol?: string;
    timeframe?: string;
}

export interface ComposedSignal {
    id: string;
    code: string;
    version: number;
    name: string;
    description: string | null;
    category: string | null;
    composedBlocks: ComposedSignalBlocks;
    isActive: boolean;
    createdBy: string | null;
    createdAt: string;
    updatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────

export interface IndicatorLogicTrace {
    id: string;
    indicatorInstanceId?: string;
    signalEventId?: string;
    backtestRunId?: string;
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

export interface ExecuteGeneratedBacktestResponse {
    created: {
        backtestRunId: string;
        signalCode: string;
        signalVersion: number;
        status: string;
    };
    execution: {
        backtestRunId: string;
        status: "COMPLETED" | "FAILED";
        counts: {
            previewSignals: number;
            previewEvents: number;
            previewTraces: number;
            persistedSignals: number;
            persistedEvents: number;
            persistedTraces: number;
            persistedResults: number;
            droppedEvents: number;
            droppedTraces: number;
        };
    } | null;
}
