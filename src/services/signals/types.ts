import { PositionSide, SignalEventType, TradingSession } from '@prisma/client';

export const ORDER_TIMING_VALUES = ['SIGNAL_BAR_CLOSE', 'NEXT_BAR_OPEN', 'LIMIT_TOUCH'] as const;
export const STOP_LOSS_MODE_VALUES = ['SIGNAL_PRICE', 'FIXED_AMOUNT', 'ACCOUNT_PERCENT'] as const;
export const TAKE_PROFIT_MODE_VALUES = ['SIGNAL_PRICE', 'FIXED_AMOUNT', 'ACCOUNT_PERCENT', 'R_MULTIPLE'] as const;
export const POSITION_SIZING_MODE_VALUES = ['RISK_BASED', 'FIXED_QUANTITY', 'ACCOUNT_PERCENT'] as const;

export type OrderTiming = typeof ORDER_TIMING_VALUES[number];
export type StopLossMode = typeof STOP_LOSS_MODE_VALUES[number];
export type TakeProfitMode = typeof TAKE_PROFIT_MODE_VALUES[number];
export type PositionSizingMode = typeof POSITION_SIZING_MODE_VALUES[number];

export interface DateRangeInput {
    from: string;
    to: string;
}

export interface StopLossConfigInput {
    mode?: StopLossMode;
    value?: number;
}

export interface TakeProfitConfigInput {
    mode?: TakeProfitMode;
    value?: number;
}

export interface PositionSizingConfigInput {
    mode?: PositionSizingMode;
    value?: number;
    /** Max position quantity (e.g. 100 for 1 lot XAU = 100 oz). Caps compound growth. */
    maxQuantity?: number;
}

export interface LossStreakThrottleStepInput {
    afterLosses: number;
    riskPercent: number;
}

export interface LossStreakThrottleConfigInput {
    steps?: LossStreakThrottleStepInput[];
}

export interface LossStreakCooldownConfigInput {
    afterLosses?: number;
    cooldownMinutes?: number;
}

export interface LossCapConfigInput {
    maxLosses?: number;
    maxNetR?: number;
}

export interface EquityCurveFilterConfigInput {
    /** Number of closed trades used for equity EMA. e.g. 10 = EMA(10 trades) */
    emaTrades?: number;
    /** What to do when equity < EMA: 'BLOCK' skips the trade, 'HALF_RISK' halves position size */
    action?: 'BLOCK' | 'HALF_RISK';
}

export interface MaxDrawdownHaltConfigInput {
    /** Maximum drawdown % from equity peak before halting all entries. e.g. 10 = halt at -10% from peak */
    maxDrawdownPct?: number;
}

export interface MinTradeSpacingConfigInput {
    /** Minimum minutes between the last trade exit and the next entry */
    minSpacingMinutes?: number;
}

export interface EntryBurstCooldownConfigInput {
    /** Max entries within the time window before triggering cooldown. e.g. 3 */
    maxEntriesInWindow?: number;
    /** Time window in minutes to detect burst. e.g. 60 */
    windowMinutes?: number;
    /** Cooldown minutes after burst detected. Unblocks early if any burst trade exits. e.g. 720 (12h) */
    cooldownMinutes?: number;
}

export interface TradeGuardConfigInput {
    lossStreakThrottle?: LossStreakThrottleConfigInput;
    lossStreakCooldown?: LossStreakCooldownConfigInput;
    sessionLossCap?: LossCapConfigInput;
    dayLossCap?: LossCapConfigInput;
    equityCurveFilter?: EquityCurveFilterConfigInput;
    maxDrawdownHalt?: MaxDrawdownHaltConfigInput;
    minTradeSpacing?: MinTradeSpacingConfigInput;
    entryBurstCooldown?: EntryBurstCooldownConfigInput;
}

export interface ExecutionConfigInput {
    entryFeeBps?: number;
    exitFeeBps?: number;
    entrySlippageBps?: number;
    exitSlippageBps?: number;
    orderTiming?: OrderTiming;
    stopLoss?: StopLossConfigInput;
    takeProfit?: TakeProfitConfigInput;
    positionSizing?: PositionSizingConfigInput;
    tradeGuards?: TradeGuardConfigInput;
    /** When true, position sizing uses current running equity instead of initial equity */
    compoundEquity?: boolean;
}

export interface CreateSignalBacktestInput {
    signalCode: string;
    signalVersion: number;
    symbol: string;
    timeframe: string;
    dateRange: DateRangeInput;
    parameters: Record<string, unknown>;
    executionConfig?: ExecutionConfigInput;
    initialEquity?: number;
    riskPercent?: number;
    notes?: string;
}

export interface CreateOptimizationJobInput {
    signalCode: string;
    signalVersion: number;
    symbol: string;
    timeframe: string;
    dateRange: DateRangeInput;
    parameterSpace: Record<string, unknown>;
    executionConfig?: ExecutionConfigInput;
    rankingConfig?: Record<string, unknown>;
}

export interface CandleBar {
    time: Date;
    symbol: string;
    timeframe: string;
    exchange: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    quoteVolume?: number | null;
    trades?: number | null;
    takerBuyVolume?: number | null;
    isClosed: boolean;
}

export interface NumericPoint {
    time: Date;
    value: number;
}

export interface AlignedPoint {
    time: Date;
    value: number | null;
}

export interface ExecutionConfigResolved {
    entryFeeBps: number;
    exitFeeBps: number;
    entrySlippageBps: number;
    exitSlippageBps: number;
    orderTiming: OrderTiming;
    stopLoss: {
        mode: StopLossMode;
        value: number | null;
    };
    takeProfit: {
        mode: TakeProfitMode;
        value: number | null;
    };
    positionSizing: {
        mode: PositionSizingMode;
        value: number | null;
        maxQuantity: number | null;
    };
    tradeGuards: {
        lossStreakThrottle: {
            steps: Array<{
                afterLosses: number;
                riskPercent: number;
            }>;
        };
        lossStreakCooldown: {
            afterLosses: number | null;
            cooldownMinutes: number | null;
        };
        sessionLossCap: {
            maxLosses: number | null;
            maxNetR: number | null;
        };
        dayLossCap: {
            maxLosses: number | null;
            maxNetR: number | null;
        };
        equityCurveFilter: {
            emaTrades: number | null;
            action: 'BLOCK' | 'HALF_RISK' | null;
        };
        maxDrawdownHalt: {
            maxDrawdownPct: number | null;
        };
        minTradeSpacing: {
            minSpacingMinutes: number | null;
        };
        entryBurstCooldown: {
            maxEntriesInWindow: number | null;
            windowMinutes: number | null;
            cooldownMinutes: number | null;
        };
    };
    compoundEquity: boolean;
}

export interface EntryFillRequest {
    side: PositionSide;
    rawPrice: number;
    config: ExecutionConfigResolved;
}

export interface ExitFillRequest {
    side: PositionSide;
    rawPrice: number;
    config: ExecutionConfigResolved;
}

export interface FillResult {
    adjustedPrice: number;
    feeFraction: number;
}

export interface PositionSizingRequest {
    side: PositionSide;
    entryPrice: number;
    stopLossPrice: number;
    initialEquity: number;
    riskAmountUsd: number;
    config: ExecutionConfigResolved;
}

export interface PositionSizingResult {
    quantity: number;
    notionalUsd: number;
    accountUsageUsd: number;
    accountUsagePct: number;
}

export interface StopLossResolutionRequest {
    side: PositionSide;
    entryPrice: number;
    signalStopLossPrice: number;
    initialEquity: number;
    positionQuantity?: number | null;
    config: ExecutionConfigResolved;
}

export interface StopLossResolutionResult {
    stopLossPrice: number;
    configuredRiskAmountUsd: number | null;
}

export interface TakeProfitResolutionRequest {
    side: PositionSide;
    entryPrice: number;
    stopLossPrice: number;
    signalTakeProfitPrice?: number | null;
    initialEquity: number;
    positionQuantity?: number | null;
    config: ExecutionConfigResolved;
}

export interface TakeProfitResolutionResult {
    takeProfitPrice: number | null;
    configuredTargetAmountUsd: number | null;
}

export interface TradePnlRequest {
    side: PositionSide;
    entryPrice: number;
    exitPrice: number;
    quantity: number;
    config: ExecutionConfigResolved;
}

export interface TradePnlResult {
    grossPnlUsd: number;
    feeUsd: number;
    netPnlUsd: number;
    entryFillPrice: number;
    exitFillPrice: number;
}

export interface RMultipleRequest {
    side: PositionSide;
    entryPrice: number;
    exitPrice: number;
    stopLoss: number;
    quantity?: number;
    riskAmountUsd?: number | null;
    config: ExecutionConfigResolved;
}

export interface RMultipleResult {
    grossR: number;
    feeR: number;
    netR: number;
    grossPnlUsd: number;
    feeUsd: number;
    netPnlUsd: number;
    riskAmountUsd: number;
}

export interface CandleQueryInput {
    symbol: string;
    timeframe: string;
    from: Date;
    to: Date;
    limit?: number;
}

export interface SignalPluginDefinition {
    code: string;
    version: number;
    name: string;
}

export interface RuntimeSignalDraft {
    symbol: string;
    timeframe: string;
    side: PositionSide;
    strategyCode?: string | null;
    strategyId?: string | null;
    session?: TradingSession | null;
    entryTime: Date;
    entryPrice: number;
    stopLoss: number;
    takeProfit1?: number | null;
    takeProfit2?: number | null;
    invalidationPrice?: number | null;
    notes?: string | null;
    externalKey?: string | null;
    definitionCode?: string | null;
    definitionVersion?: number | null;
    executionConfigJson?: Record<string, unknown> | null;
}

export interface RuntimeResultDraft {
    signalExternalKey: string;
    exitRuleId?: string | null;
    exitRuleCode?: string | null;
    exitRuleName?: string | null;
    exitRuleConfigJson?: Record<string, unknown> | null;
    resultSide: PositionSide;
    session: TradingSession;
    win: boolean;
    isOpen: boolean;
    rMultiple: number;
    pnlUsd: number;
    maxDrawdownPct: number;
    exitReason: string;
    exitTime?: Date | null;
    exitPrice?: number | null;
    notes?: string | null;
    decisionLog?: DecisionLogItem[] | null;
}

export interface RuntimeSignalEventDraft {
    signalExternalKey: string;
    eventType: SignalEventType;
    candleTime: Date;
    price?: number | null;
    label?: string | null;
    metaJson?: Record<string, unknown> | null;
}

export interface RuntimeLogicTraceDraft {
    signalExternalKey: string;
    eventType: SignalEventType;
    candleTime: Date;
    stateBefore?: string | null;
    stateAfter?: string | null;
    ruleId?: string | null;
    indicatorJson?: Record<string, unknown> | null;
    thresholdJson?: Record<string, unknown> | null;
    priceJson?: Record<string, unknown> | null;
    notes?: string | null;
}

export interface SignalStepResult<TState> {
    state: TState;
    signal?: RuntimeSignalDraft;
    events?: RuntimeSignalEventDraft[];
    traces?: RuntimeLogicTraceDraft[];
    results?: RuntimeResultDraft[];
}

export interface SignalRuntimeServices {
    indicatorSeries: {
        calculateSMAFromCandles(bars: CandleBar[], period: number): NumericPoint[];
        calculateSMA(points: NumericPoint[], period: number): NumericPoint[];
        calculateRSIFromCandles(bars: CandleBar[], period?: number): NumericPoint[];
        calculateRSI(points: NumericPoint[], period?: number): NumericPoint[];
        calculateEMAFromCandles(bars: CandleBar[], period: number): NumericPoint[];
        calculateEMA(points: NumericPoint[], period: number): NumericPoint[];
        calculateWMA(points: NumericPoint[], period: number): NumericPoint[];
        getPointAtOrBefore(points: NumericPoint[], time: Date): NumericPoint | null;
        alignPointsToBars(bars: CandleBar[], points: NumericPoint[]): AlignedPoint[];
        calculateATR(bars: CandleBar[], period?: number): NumericPoint[];
        calculateADX(bars: CandleBar[], period?: number): NumericPoint[];
    };
    executionModel: {
        resolveConfig(input?: ExecutionConfigInput): ExecutionConfigResolved;
        getEntryFill(request: EntryFillRequest): FillResult;
        getExitFill(request: ExitFillRequest): FillResult;
        resolvePositionSizing(request: PositionSizingRequest): PositionSizingResult;
        resolveStopLoss(request: StopLossResolutionRequest): StopLossResolutionResult;
        resolveTakeProfit(request: TakeProfitResolutionRequest): TakeProfitResolutionResult;
        calculateNetPnl(request: TradePnlRequest): TradePnlResult;
        calculateNetR(request: RMultipleRequest): RMultipleResult;
    };
}

export interface SignalInitializationContext<TParams> {
    symbol: string;
    timeframe: string;
    baseBars: CandleBar[];
    barsByTimeframe: Record<string, CandleBar[]>;
    parameters: TParams;
    initialEquity: number;
    riskPercent: number;
    executionConfig: ExecutionConfigResolved;
    services: SignalRuntimeServices;
}

export interface SignalBarContext<TParams, TState> extends SignalInitializationContext<TParams> {
    index: number;
    bar: CandleBar;
    state: TState;
}

export interface SignalPlugin<TParams = Record<string, unknown>, TState = unknown> {
    definition: SignalPluginDefinition;
    getRequiredTimeframes?(params: TParams, baseTimeframe: string): string[];
    initialize(context: SignalInitializationContext<TParams>): Promise<TState> | TState;
    onBar(context: SignalBarContext<TParams, TState>): Promise<SignalStepResult<TState> | null> | SignalStepResult<TState> | null;
    finalize?(
        context: SignalInitializationContext<TParams> & {
            finalState: TState;
            output: SignalRunOutput;
        }
    ): Promise<Partial<SignalRunOutput> | null> | Partial<SignalRunOutput> | null;
}

export interface SignalRunRequest<TParams = Record<string, unknown>> {
    signalCode: string;
    signalVersion: number;
    symbol: string;
    timeframe: string;
    from: Date;
    to: Date;
    parameters: TParams;
    initialEquity?: number;
    riskPercent?: number;
    executionConfig?: ExecutionConfigInput;
}

export interface SignalRunOutput {
    barsProcessed: number;
    signals: RuntimeSignalDraft[];
    events: RuntimeSignalEventDraft[];
    traces: RuntimeLogicTraceDraft[];
    results: RuntimeResultDraft[];
}

export interface SignalPreviewRequestInput<TParams = Record<string, unknown>> {
    requestKey?: string;
    signalCode: string;
    signalVersion: number;
    symbol: string;
    timeframe: string;
    dateRange: DateRangeInput;
    parameters: TParams;
    initialEquity?: number;
    riskPercent?: number;
    executionConfig?: ExecutionConfigInput;
}

export interface SignalBatchAssetInput {
    assetKey?: string;
    symbol: string;
    timeframe: string;
    dateRange: DateRangeInput;
}

export interface SignalBatchDefinitionInput<TParams = Record<string, unknown>> {
    definitionKey?: string;
    signalCode: string;
    signalVersion: number;
    parameters: TParams;
    initialEquity?: number;
    riskPercent?: number;
    executionConfig?: ExecutionConfigInput;
    dateRange?: DateRangeInput;
}

export interface SignalBatchPreviewInput<TParams = Record<string, unknown>> {
    requests?: SignalPreviewRequestInput<TParams>[];
    matrix?: {
        assets: SignalBatchAssetInput[];
        definitions: SignalBatchDefinitionInput<TParams>[];
    };
    maxConcurrency?: number;
}

export interface SignalBatchPreviewTask<TParams = Record<string, unknown>> extends SignalRunRequest<TParams> {
    requestKey: string;
}

export interface SignalBatchPreviewItem {
    requestKey: string;
    signalCode: string;
    signalVersion: number;
    symbol: string;
    timeframe: string;
    from: string;
    to: string;
    status: 'SUCCEEDED' | 'FAILED';
    durationMs: number;
    counts: {
        barsProcessed: number;
        signals: number;
        events: number;
        traces: number;
        results: number;
    };
    error?: string;
}

export interface SignalBatchPreviewOutput {
    total: number;
    succeeded: number;
    failed: number;
    maxConcurrency: number;
    items: SignalBatchPreviewItem[];
}

// --- Decision Log Types (Story 9.1: Per-bar backtest transparency) ---

export type DecisionConditionResult = 'PASS' | 'TRIGGERED' | 'SKIPPED';
export type DecisionAction = 'HOLD' | 'MOVE_SL' | 'PARTIAL_CLOSE' | 'CLOSE';

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

export interface MultiTfAlignment {
    blockId: string;
    timeframe: string;
    alignedBarTime: string;
    gapMs: number;
}

export interface DecisionLogEntry {
    barIndex: number;
    timestamp: Date;
    ohlcv: { open: number; high: number; low: number; close: number; volume: number };
    conditions: DecisionConditionEntry[];
    action: DecisionAction;
    stateSnapshot: DecisionStateSnapshot;
    multiTfAlignments?: MultiTfAlignment[];
}

export interface CompressedDecisionLogEntry {
    barIndex: number;
    action: 'HOLD';
}

export type DecisionLogItem = DecisionLogEntry | CompressedDecisionLogEntry;

export function isFullDecisionLogEntry(entry: DecisionLogItem): entry is DecisionLogEntry {
    return 'conditions' in entry;
}

export function compressDecisionLog(entries: DecisionLogEntry[]): DecisionLogItem[] {
    if (entries.length === 0) return [];

    const result: DecisionLogItem[] = [];

    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const isFirst = i === 0;
        const isStateChange = entry.action !== 'HOLD';
        const hasSnapshotChange =
            i > 0 &&
            (entry.stateSnapshot.activeStop !== entries[i - 1].stateSnapshot.activeStop ||
                entry.stateSnapshot.remainingFraction !== entries[i - 1].stateSnapshot.remainingFraction ||
                entry.stateSnapshot.movedToBreakeven !== entries[i - 1].stateSnapshot.movedToBreakeven ||
                entry.stateSnapshot.partialTaken !== entries[i - 1].stateSnapshot.partialTaken);

        if (isFirst || isStateChange || hasSnapshotChange) {
            result.push(entry);
        } else {
            result.push({ barIndex: entry.barIndex, action: 'HOLD' as const });
        }
    }

    return result;
}

export interface ExecuteSignalBacktestResult {
    backtestRunId: string;
    status: 'COMPLETED' | 'FAILED';
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
}
