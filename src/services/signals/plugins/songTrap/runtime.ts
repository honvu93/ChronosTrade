import { ExitReason, PositionSide, SignalEventType, TradingSession } from '@prisma/client';
import {
    CandleBar,
    RuntimeLogicTraceDraft,
    RuntimeResultDraft,
    RuntimeSignalDraft,
    RuntimeSignalEventDraft,
    SignalBarContext,
    SignalInitializationContext,
    SignalPlugin,
} from '../../types';
import { songTrapDefinition } from './definition';

interface SongTrapParams {
    rsiLength?: number;
    emaLength?: number;
    wmaLength?: number;
    trapLevel?: number;
    pullbackLevel?: number;
    invalidateLevel?: number;
    trendTf?: string;
    strategyCode?: string;
    breakEvenTriggerPct?: number;
    trail1TriggerPct?: number;
    trail1ClosePct?: number;
    trail2TriggerPct?: number;
    trail2ClosePct?: number;
    trail3TriggerPct?: number;
    trail3ClosePct?: number;
    closeRemainingOnRangeEnd?: boolean;
}

interface TrailStageConfig {
    level: number;
    triggerPct: number;
    closePct: number;
}

interface SongTrapConfig {
    rsiLength: number;
    emaLength: number;
    wmaLength: number;
    trapLevel: number;
    pullbackLevel: number;
    invalidateLevel: number;
    trendTf: string;
    strategyCode: string;
    breakEvenTriggerPct: number;
    trailStages: TrailStageConfig[];
    closeRemainingOnRangeEnd: boolean;
}

type SongTrapPhase =
    | 'IDLE'
    | 'AWAIT_PULLBACK'
    | 'AWAIT_X1'
    | 'AWAIT_ENTRY'
    | 'ENTRY_ACTIVE'
    | 'ENTRY_CONFIRMED';

interface SongTrapSnapshot {
    time: Date;
    close: number;
    high: number;
    low: number;
    rsi: number | null;
    rsiEma: number | null;
    rsiWma: number | null;
    trendRsi: number | null;
}

interface SongTrapCycle {
    cycleNumber: number;
    externalKey: string;
    phase: SongTrapPhase;
    trapTime: Date;
    trapPrice: number;
    trapRsi: number;
    lowestLow: number;
    hasPullbackBelow60: boolean;
    hasResetBelowEmaAndWma: boolean;
    x1Time?: Date | null;
    x1Price?: number | null;
    hasRecycledBelowWmaAfterX1: boolean;
    entryTime?: Date | null;
    entryPrice?: number | null;
    entryConfirmedTime?: Date | null;
}

interface SongTrapState {
    snapshots: SongTrapSnapshot[];
    cycleCounter: number;
    activeCycle: SongTrapCycle | null;
}

const round = (value: number | null | undefined, digits = 6) => (
    value === null || value === undefined ? null : Number(value.toFixed(digits))
);

const normalizeConfig = (params: SongTrapParams): SongTrapConfig => ({
    rsiLength: params.rsiLength ?? 14,
    emaLength: params.emaLength ?? 9,
    wmaLength: params.wmaLength ?? 45,
    trapLevel: params.trapLevel ?? 80,
    pullbackLevel: params.pullbackLevel ?? 60,
    invalidateLevel: params.invalidateLevel ?? 40,
    trendTf: params.trendTf || '4h',
    strategyCode: (params.strategyCode || 'TRAP').trim().toUpperCase(),
    breakEvenTriggerPct: params.breakEvenTriggerPct ?? 2,
    trailStages: [
        { level: 1, triggerPct: params.trail1TriggerPct ?? 3, closePct: params.trail1ClosePct ?? 25 },
        { level: 2, triggerPct: params.trail2TriggerPct ?? 6, closePct: params.trail2ClosePct ?? 35 },
        { level: 3, triggerPct: params.trail3TriggerPct ?? 10, closePct: params.trail3ClosePct ?? 40 },
    ]
        .filter((stage) => stage.triggerPct > 0 && stage.closePct > 0)
        .sort((left, right) => left.triggerPct - right.triggerPct),
    closeRemainingOnRangeEnd: params.closeRemainingOnRangeEnd === true,
});

const crossesUp = (
    previousLeft: number | null,
    previousRight: number | null,
    currentLeft: number | null,
    currentRight: number | null,
) => (
    previousLeft !== null
    && previousRight !== null
    && currentLeft !== null
    && currentRight !== null
    && previousLeft <= previousRight
    && currentLeft > currentRight
);

const crossesDown = (
    previousLeft: number | null,
    previousRight: number | null,
    currentLeft: number | null,
    currentRight: number | null,
) => (
    previousLeft !== null
    && previousRight !== null
    && currentLeft !== null
    && currentRight !== null
    && previousLeft >= previousRight
    && currentLeft < currentRight
);

const isTrendUp = (snapshot: SongTrapSnapshot, config: SongTrapConfig) => (
    snapshot.rsi !== null
    && snapshot.rsiWma !== null
    && snapshot.trendRsi !== null
    && snapshot.rsi > snapshot.rsiWma
    && snapshot.trendRsi > config.invalidateLevel
);

const resolveSession = (time: Date): TradingSession => {
    const hour = time.getUTCHours();
    if (hour < 8) return TradingSession.ASIAN;
    if (hour < 13) return TradingSession.LONDON;
    return TradingSession.NY;
};

const buildCycleKey = (bar: CandleBar, cycleNumber: number) => (
    `${bar.symbol}:${bar.timeframe}:${bar.time.toISOString()}:SONG_TRAP:${cycleNumber}`
);

const buildMetaJson = (
    snapshot: SongTrapSnapshot,
    config: SongTrapConfig,
    cycle: SongTrapCycle,
    extra?: Record<string, unknown>,
) => ({
    cycleNumber: cycle.cycleNumber,
    phase: cycle.phase,
    trapTime: cycle.trapTime.toISOString(),
    trapPrice: round(cycle.trapPrice, 4),
    lowestLow: round(cycle.lowestLow, 4),
    indicators: {
        rsi14: round(snapshot.rsi),
        rsiEma9: round(snapshot.rsiEma),
        rsiWma45: round(snapshot.rsiWma),
        trendRsi: round(snapshot.trendRsi),
    },
    thresholds: {
        trapLevel: config.trapLevel,
        pullbackLevel: config.pullbackLevel,
        invalidateLevel: config.invalidateLevel,
    },
    ...extra,
});

const buildTrace = (
    eventType: SignalEventType,
    cycle: SongTrapCycle,
    snapshot: SongTrapSnapshot,
    config: SongTrapConfig,
    input: {
        stateBefore: string;
        stateAfter: string;
        ruleId: string;
        notes: string;
        extra?: Record<string, unknown>;
    },
): RuntimeLogicTraceDraft => ({
    signalExternalKey: cycle.externalKey,
    eventType,
    candleTime: snapshot.time,
    stateBefore: input.stateBefore,
    stateAfter: input.stateAfter,
    ruleId: input.ruleId,
    indicatorJson: {
        rsi14: round(snapshot.rsi),
        rsiEma9: round(snapshot.rsiEma),
        rsiWma45: round(snapshot.rsiWma),
        trendRsi: round(snapshot.trendRsi),
    },
    thresholdJson: {
        trapLevel: config.trapLevel,
        pullbackLevel: config.pullbackLevel,
        invalidateLevel: config.invalidateLevel,
    },
    priceJson: {
        close: round(snapshot.close, 4),
        high: round(snapshot.high, 4),
        low: round(snapshot.low, 4),
        trapPrice: round(cycle.trapPrice, 4),
        lowestLow: round(cycle.lowestLow, 4),
    },
    notes: input.extra ? `${input.notes} ${JSON.stringify(input.extra)}` : input.notes,
});

const buildEvent = (
    eventType: SignalEventType,
    cycle: SongTrapCycle,
    snapshot: SongTrapSnapshot,
    config: SongTrapConfig,
    input: {
        label: string;
        price?: number | null;
        stateBefore: string;
        stateAfter: string;
        ruleId: string;
        notes: string;
        extra?: Record<string, unknown>;
    },
): {
    event: RuntimeSignalEventDraft;
    trace: RuntimeLogicTraceDraft;
} => ({
    event: {
        signalExternalKey: cycle.externalKey,
        eventType,
        candleTime: snapshot.time,
        price: input.price ?? snapshot.close,
        label: input.label,
        metaJson: buildMetaJson(snapshot, config, cycle, input.extra),
    },
    trace: buildTrace(eventType, cycle, snapshot, config, input),
});

const encodePercent = (value: number) => value.toFixed(2).replace('.', 'P');

const hashString = (value: string) => {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0).toString(36).toUpperCase();
};

const buildExecutionLabel = (input: {
    stopLossMode: string;
    stopLossValue: number | null;
    takeProfitMode: string;
    takeProfitValue: number | null;
    positionSizingMode: string;
    positionSizingValue: number | null;
    breakEvenTriggerPct: number;
    trailStages: TrailStageConfig[];
}) => {
    const formatMode = (mode: string, value: number | null) => {
        if (mode === 'SIGNAL_PRICE') return 'SIG';
        if (mode === 'FIXED_AMOUNT') return `FIX(${value})`;
        if (mode === 'ACCOUNT_PERCENT') return `%(${value})`;
        if (mode === 'R_MULTIPLE') return `R(${value})`;
        if (mode === 'FIXED_QUANTITY') return `Q(${value})`;
        if (mode === 'RISK_BASED') return 'AUTO';
        return `${mode}:${value ?? ''}`;
    };

    const trailLabel = input.trailStages
        .map((stage) => `T${stage.level}:${stage.triggerPct}/${stage.closePct}`)
        .join(' ');

    return [
        `SongTrap`,
        `SL:${formatMode(input.stopLossMode, input.stopLossValue)}`,
        `TP:${formatMode(input.takeProfitMode, input.takeProfitValue)}`,
        `VOL:${formatMode(input.positionSizingMode, input.positionSizingValue)}`,
        `BE:${input.breakEvenTriggerPct}`,
        trailLabel,
    ].join(' ').slice(0, 80);
};

const buildExitRuleCode = (config: SongTrapConfig, executionConfig: SignalInitializationContext<SongTrapParams>['executionConfig']) => {
    const signature = JSON.stringify({
        stopLoss: executionConfig.stopLoss,
        takeProfit: executionConfig.takeProfit,
        positionSizing: executionConfig.positionSizing,
        breakEvenTriggerPct: config.breakEvenTriggerPct,
        trailStages: config.trailStages,
        closeRemainingOnRangeEnd: config.closeRemainingOnRangeEnd,
    });

    return `ST_MGMT_${hashString(signature)}`;
};

const buildExitRuleName = (config: SongTrapConfig, executionConfig: SignalInitializationContext<SongTrapParams>['executionConfig']) => (
    buildExecutionLabel({
        stopLossMode: executionConfig.stopLoss.mode,
        stopLossValue: executionConfig.stopLoss.value,
        takeProfitMode: executionConfig.takeProfit.mode,
        takeProfitValue: executionConfig.takeProfit.value,
        positionSizingMode: executionConfig.positionSizing.mode,
        positionSizingValue: executionConfig.positionSizing.value,
        breakEvenTriggerPct: config.breakEvenTriggerPct,
        trailStages: config.trailStages,
    })
);

const toPctPrice = (entryPrice: number, pct: number) => entryPrice * (1 + pct / 100);

const roundMoney = (value: number, digits = 2) => Number(value.toFixed(digits));

const roundMetric = (value: number, digits = 6) => Number(value.toFixed(digits));

const buildManagementTrace = (input: {
    signalExternalKey: string;
    eventType: SignalEventType;
    candleTime: Date;
    snapshot: SongTrapSnapshot;
    config: SongTrapConfig;
    stateBefore: string;
    stateAfter: string;
    ruleId: string;
    notes: string;
    extra?: Record<string, unknown>;
}): RuntimeLogicTraceDraft => ({
    signalExternalKey: input.signalExternalKey,
    eventType: input.eventType,
    candleTime: input.candleTime,
    stateBefore: input.stateBefore,
    stateAfter: input.stateAfter,
    ruleId: input.ruleId,
    indicatorJson: {
        rsi14: round(input.snapshot.rsi),
        rsiEma9: round(input.snapshot.rsiEma),
        rsiWma45: round(input.snapshot.rsiWma),
        trendRsi: round(input.snapshot.trendRsi),
    },
    thresholdJson: {
        trapLevel: input.config.trapLevel,
        pullbackLevel: input.config.pullbackLevel,
        invalidateLevel: input.config.invalidateLevel,
        breakEvenTriggerPct: input.config.breakEvenTriggerPct,
        trailStages: input.config.trailStages,
    },
    priceJson: {
        close: round(input.snapshot.close, 4),
        high: round(input.snapshot.high, 4),
        low: round(input.snapshot.low, 4),
        ...input.extra,
    },
    notes: input.notes,
});

const buildManagementEvent = (input: {
    signalExternalKey: string;
    eventType: SignalEventType;
    candleTime: Date;
    snapshot: SongTrapSnapshot;
    config: SongTrapConfig;
    label: string;
    price: number;
    stateBefore: string;
    stateAfter: string;
    ruleId: string;
    notes: string;
    extra?: Record<string, unknown>;
}): { event: RuntimeSignalEventDraft; trace: RuntimeLogicTraceDraft } => ({
    event: {
        signalExternalKey: input.signalExternalKey,
        eventType: input.eventType,
        candleTime: input.candleTime,
        price: round(input.price, 4),
        label: input.label,
        metaJson: {
            label: input.label,
            ...input.extra,
        },
    },
    trace: buildManagementTrace(input),
});

export const songTrapRuntime: SignalPlugin<SongTrapParams, SongTrapState> = {
    definition: songTrapDefinition,
    getRequiredTimeframes(params, baseTimeframe) {
        return Array.from(new Set([baseTimeframe, params.trendTf || '4h']));
    },
    initialize(context: SignalInitializationContext<SongTrapParams>) {
        const config = normalizeConfig(context.parameters);
        const indicatorService = context.services.indicatorSeries;
        const rawRsi = indicatorService.calculateRSIFromCandles(context.baseBars, config.rsiLength);
        const rawRsiEma = indicatorService.calculateEMA(rawRsi, config.emaLength);
        const rawRsiWma = indicatorService.calculateWMA(rawRsi, config.wmaLength);
        const trendBars = context.barsByTimeframe[config.trendTf] || [];
        const trendRsi = indicatorService.calculateRSIFromCandles(trendBars, config.rsiLength);

        const alignedRsi = indicatorService.alignPointsToBars(context.baseBars, rawRsi);
        const alignedRsiEma = indicatorService.alignPointsToBars(context.baseBars, rawRsiEma);
        const alignedRsiWma = indicatorService.alignPointsToBars(context.baseBars, rawRsiWma);
        const alignedTrendRsi = indicatorService.alignPointsToBars(context.baseBars, trendRsi);

        return {
            snapshots: context.baseBars.map((bar, index) => ({
                time: bar.time,
                close: bar.close,
                high: bar.high,
                low: bar.low,
                rsi: alignedRsi[index]?.value ?? null,
                rsiEma: alignedRsiEma[index]?.value ?? null,
                rsiWma: alignedRsiWma[index]?.value ?? null,
                trendRsi: alignedTrendRsi[index]?.value ?? null,
            })),
            cycleCounter: 0,
            activeCycle: null,
        };
    },
    onBar(context: SignalBarContext<SongTrapParams, SongTrapState>) {
        const config = normalizeConfig(context.parameters);
        const snapshot = context.state.snapshots[context.index];
        const previous = context.index > 0 ? context.state.snapshots[context.index - 1] : null;

        if (!snapshot || !previous) {
            return { state: context.state };
        }

        if (
            snapshot.rsi === null
            || snapshot.rsiEma === null
            || snapshot.rsiWma === null
            || snapshot.trendRsi === null
            || previous.rsi === null
            || previous.rsiWma === null
        ) {
            return { state: context.state };
        }

        const state: SongTrapState = {
            ...context.state,
            activeCycle: context.state.activeCycle ? { ...context.state.activeCycle } : null,
        };

        const events: RuntimeSignalEventDraft[] = [];
        const traces: RuntimeLogicTraceDraft[] = [];
        let signal: RuntimeSignalDraft | undefined;

        if (!state.activeCycle) {
            if (isTrendUp(snapshot, config) && previous.rsi < config.trapLevel && snapshot.rsi >= config.trapLevel) {
                const cycleNumber = state.cycleCounter + 1;
                const cycle: SongTrapCycle = {
                    cycleNumber,
                    externalKey: buildCycleKey(context.bar, cycleNumber),
                    phase: 'AWAIT_PULLBACK',
                    trapTime: snapshot.time,
                    trapPrice: snapshot.close,
                    trapRsi: snapshot.rsi,
                    lowestLow: snapshot.low,
                    hasPullbackBelow60: false,
                    hasResetBelowEmaAndWma: false,
                    hasRecycledBelowWmaAfterX1: false,
                };

                state.cycleCounter = cycleNumber;
                state.activeCycle = cycle;

                const trap = buildEvent(SignalEventType.TRAP, cycle, snapshot, config, {
                    label: 'TRAP',
                    price: snapshot.close,
                    stateBefore: 'IDLE',
                    stateAfter: 'AWAIT_PULLBACK',
                    ruleId: 'trap_rsi_cross_80_in_uptrend',
                    notes: 'RSI14 crossed the trap threshold while the higher-timeframe trend filter remained bullish.',
                });
                events.push(trap.event);
                traces.push(trap.trace);
            }

            return {
                state,
                ...(events.length ? { events } : {}),
                ...(traces.length ? { traces } : {}),
            };
        }

        const cycle = state.activeCycle;
        cycle.lowestLow = Math.min(cycle.lowestLow, snapshot.low);

        if (!cycle.entryTime && snapshot.rsi < config.invalidateLevel) {
            const fail = buildEvent(SignalEventType.FAIL, cycle, snapshot, config, {
                label: 'FAIL',
                price: snapshot.close,
                stateBefore: cycle.phase,
                stateAfter: 'FAILED',
                ruleId: 'trap_invalidated_rsi_below_40',
                notes: 'The trap was invalidated because RSI14 closed below the invalidation threshold before entry.',
                extra: { reason: 'RSI_BELOW_INVALIDATE' },
            });
            state.activeCycle = null;
            events.push(fail.event);
            traces.push(fail.trace);

            return {
                state,
                events,
                traces,
            };
        }

        if (!cycle.hasPullbackBelow60 && snapshot.rsi < config.pullbackLevel && snapshot.rsi > config.invalidateLevel) {
            cycle.hasPullbackBelow60 = true;
            cycle.phase = 'AWAIT_X1';
        }

        if (
            cycle.hasPullbackBelow60
            && !cycle.hasResetBelowEmaAndWma
            && snapshot.rsi < snapshot.rsiEma
            && snapshot.rsi < snapshot.rsiWma
        ) {
            cycle.hasResetBelowEmaAndWma = true;
            cycle.phase = 'AWAIT_X1';
        }

        if (
            cycle.hasPullbackBelow60
            && cycle.hasResetBelowEmaAndWma
            && !cycle.x1Time
            && crossesUp(previous.rsi, previous.rsiWma, snapshot.rsi, snapshot.rsiWma)
        ) {
            cycle.x1Time = snapshot.time;
            cycle.x1Price = snapshot.close;
            cycle.phase = 'AWAIT_ENTRY';

            const x1 = buildEvent(SignalEventType.X1, cycle, snapshot, config, {
                label: 'X1',
                price: snapshot.close,
                stateBefore: 'AWAIT_X1',
                stateAfter: 'AWAIT_ENTRY',
                ruleId: 'first_reclaim_above_rsi_wma_45',
                notes: 'First reclaim of RSI WMA45 after the trap pullback and reset below both RSI EMA9 and RSI WMA45.',
            });
            events.push(x1.event);
            traces.push(x1.trace);
        }

        if (cycle.x1Time && !cycle.hasRecycledBelowWmaAfterX1 && snapshot.rsi < snapshot.rsiWma) {
            cycle.hasRecycledBelowWmaAfterX1 = true;
            cycle.phase = 'AWAIT_ENTRY';
        }

        if (
            cycle.x1Time
            && cycle.hasRecycledBelowWmaAfterX1
            && !cycle.entryTime
            && isTrendUp(snapshot, config)
            && crossesUp(previous.rsi, previous.rsiWma, snapshot.rsi, snapshot.rsiWma)
        ) {
            cycle.entryTime = snapshot.time;
            cycle.entryPrice = snapshot.close;
            cycle.phase = 'ENTRY_ACTIVE';

            signal = {
                symbol: context.symbol,
                timeframe: context.timeframe,
                side: PositionSide.LONG,
                strategyCode: config.strategyCode,
                session: resolveSession(snapshot.time),
                entryTime: snapshot.time,
                entryPrice: snapshot.close,
                stopLoss: cycle.lowestLow,
                takeProfit1: cycle.trapPrice,
                invalidationPrice: cycle.lowestLow,
                notes: `Song Trap cycle ${cycle.cycleNumber}`,
                externalKey: cycle.externalKey,
                definitionCode: songTrapDefinition.code,
                definitionVersion: songTrapDefinition.version,
                executionConfigJson: context.executionConfig as unknown as Record<string, unknown>,
            };

            const entry = buildEvent(SignalEventType.ENTRY, cycle, snapshot, config, {
                label: 'ENTRY',
                price: snapshot.close,
                stateBefore: 'AWAIT_ENTRY',
                stateAfter: 'ENTRY_ACTIVE',
                ruleId: 'second_reclaim_above_rsi_wma_45',
                notes: 'Second reclaim of RSI WMA45 after the X1 recycle below the moving average.',
            });
            events.push(entry.event);
            traces.push(entry.trace);
        }

        if (cycle.entryTime && !cycle.entryConfirmedTime && snapshot.rsi > snapshot.rsiEma) {
            cycle.entryConfirmedTime = snapshot.time;
            cycle.phase = 'ENTRY_CONFIRMED';

            const confirmed = buildEvent(SignalEventType.ENTRY_CONFIRMED, cycle, snapshot, config, {
                label: 'CONF',
                price: snapshot.close,
                stateBefore: 'ENTRY_ACTIVE',
                stateAfter: 'ENTRY_CONFIRMED',
                ruleId: 'rsi_close_above_ema9_after_entry',
                notes: 'The entry was confirmed after RSI14 closed back above RSI EMA9 following the second reclaim.',
            });
            events.push(confirmed.event);
            traces.push(confirmed.trace);
        }

        if (cycle.entryTime && snapshot.high >= cycle.trapPrice) {
            const completed = buildEvent(SignalEventType.COMPLETE_Y, cycle, snapshot, config, {
                label: 'Y',
                price: cycle.trapPrice,
                stateBefore: cycle.phase,
                stateAfter: 'COMPLETED',
                ruleId: 'price_returned_to_trap_origin',
                notes: 'Trap completion was marked because price returned to the original trap price.',
            });
            state.activeCycle = null;
            events.push(completed.event);
            traces.push(completed.trace);

            return {
                state,
                ...(signal ? { signal } : {}),
                ...(events.length ? { events } : {}),
                ...(traces.length ? { traces } : {}),
            };
        }

        if (
            cycle.entryConfirmedTime
            && crossesDown(previous.rsi, previous.rsiWma, snapshot.rsi, snapshot.rsiWma)
        ) {
            const fail = buildEvent(SignalEventType.FAIL, cycle, snapshot, config, {
                label: 'X3',
                price: snapshot.close,
                stateBefore: 'ENTRY_CONFIRMED',
                stateAfter: 'FAILED',
                ruleId: 'post_confirmation_cross_below_rsi_wma_45',
                notes: 'The trap failed after confirmation because RSI14 crossed back below RSI WMA45 before completing the return to trap.',
                extra: { reason: 'POST_CONFIRM_WMA_BREAK' },
            });
            state.activeCycle = null;
            events.push(fail.event);
            traces.push(fail.trace);

            return {
                state,
                ...(signal ? { signal } : {}),
                events,
                traces,
            };
        }

        return {
            state,
            ...(signal ? { signal } : {}),
            ...(events.length ? { events } : {}),
            ...(traces.length ? { traces } : {}),
        };
    },
    finalize(context) {
        const config = normalizeConfig(context.parameters);
        const additionalEvents: RuntimeSignalEventDraft[] = [];
        const additionalTraces: RuntimeLogicTraceDraft[] = [];
        const results: RuntimeResultDraft[] = [];
        const exitRuleCode = buildExitRuleCode(config, context.executionConfig);
        const exitRuleName = buildExitRuleName(config, context.executionConfig);
        const legacyRiskUsd = (context.initialEquity * context.riskPercent) / 100;

        for (const signal of context.output.signals) {
            if (signal.side !== PositionSide.LONG || !signal.externalKey) {
                continue;
            }

            const detectionIndex = context.baseBars.findIndex((bar) => bar.time.getTime() === signal.entryTime.getTime());
            if (detectionIndex < 0) {
                continue;
            }

            const entryIndex = context.executionConfig.orderTiming === 'NEXT_BAR_OPEN'
                ? detectionIndex + 1
                : detectionIndex;
            if (entryIndex < 0 || entryIndex >= context.baseBars.length) {
                continue;
            }

            const entryBar = context.baseBars[entryIndex];
            const entryRawPrice = context.executionConfig.orderTiming === 'NEXT_BAR_OPEN'
                ? entryBar.open
                : signal.entryPrice;
            const preResolvedSizing = context.executionConfig.positionSizing.mode === 'RISK_BASED'
                ? null
                : context.services.executionModel.resolvePositionSizing({
                    side: PositionSide.LONG,
                    entryPrice: entryRawPrice,
                    stopLossPrice: signal.stopLoss,
                    initialEquity: context.initialEquity,
                    riskAmountUsd: legacyRiskUsd,
                    config: context.executionConfig,
                });
            const resolvedStopLoss = context.services.executionModel.resolveStopLoss({
                side: PositionSide.LONG,
                entryPrice: entryRawPrice,
                signalStopLossPrice: signal.stopLoss,
                initialEquity: context.initialEquity,
                positionQuantity: preResolvedSizing?.quantity ?? null,
                config: context.executionConfig,
            });
            const positionSizing = preResolvedSizing || context.services.executionModel.resolvePositionSizing({
                side: PositionSide.LONG,
                entryPrice: entryRawPrice,
                stopLossPrice: resolvedStopLoss.stopLossPrice,
                initialEquity: context.initialEquity,
                riskAmountUsd: resolvedStopLoss.configuredRiskAmountUsd ?? legacyRiskUsd,
                config: context.executionConfig,
            });
            const takeProfitResolution = context.services.executionModel.resolveTakeProfit({
                side: PositionSide.LONG,
                entryPrice: entryRawPrice,
                stopLossPrice: resolvedStopLoss.stopLossPrice,
                signalTakeProfitPrice: signal.takeProfit1 ?? null,
                initialEquity: context.initialEquity,
                positionQuantity: positionSizing.quantity,
                config: context.executionConfig,
            });
            const totalRiskAmountUsd = Math.max(
                resolvedStopLoss.configuredRiskAmountUsd
                    ?? Math.abs(context.services.executionModel.calculateNetPnl({
                        side: PositionSide.LONG,
                        entryPrice: entryRawPrice,
                        exitPrice: resolvedStopLoss.stopLossPrice,
                        quantity: positionSizing.quantity,
                        config: context.executionConfig,
                    }).netPnlUsd),
                0.01,
            );
            const stopLoss = resolvedStopLoss.stopLossPrice;
            const takeProfitPrice = takeProfitResolution.takeProfitPrice;
            const beTriggerPrice = toPctPrice(entryRawPrice, config.breakEvenTriggerPct);

            let activeStop = stopLoss;
            let beArmed = false;
            let remainingFraction = 1;
            let weightedExitPrice = 0;
            let realizedNetR = 0;
            let realizedPnlUsd = 0;
            let maxDrawdownPct = 0;
            let exitTime: Date | null = null;
            let finalExitReason: ExitReason = ExitReason.EXPIRATION;
            let lastState = 'ENTRY_ACTIVE';
            const hitTrailLevels = new Set<number>();
            const notes: string[] = [
                exitRuleName,
                `qty:${roundMetric(positionSizing.quantity, 6)}`,
                `sl:${round(stopLoss, 4)}`,
                ...(takeProfitPrice ? [`tp:${round(takeProfitPrice, 4)}`] : []),
            ];

            const realizeExit = (exitPrice: number, closeFraction: number) => {
                const metrics = context.services.executionModel.calculateNetR({
                    side: PositionSide.LONG,
                    entryPrice: entryRawPrice,
                    exitPrice,
                    stopLoss,
                    quantity: positionSizing.quantity * closeFraction,
                    riskAmountUsd: totalRiskAmountUsd,
                    config: context.executionConfig,
                });

                realizedNetR += metrics.netR;
                realizedPnlUsd += metrics.netPnlUsd;
                weightedExitPrice += exitPrice * closeFraction;
            };

            for (let index = entryIndex; index < context.baseBars.length && remainingFraction > 0; index += 1) {
                const bar = context.baseBars[index];
                const snapshot = context.finalState.snapshots[index];
                if (!snapshot) {
                    continue;
                }

                maxDrawdownPct = Math.min(
                    maxDrawdownPct,
                    ((bar.low - entryRawPrice) / entryRawPrice) * 100,
                );

                if (!beArmed && config.breakEvenTriggerPct > 0 && bar.high >= beTriggerPrice) {
                    beArmed = true;
                    activeStop = entryRawPrice;
                    lastState = 'BE_ARMED';

                    const beEvent = buildManagementEvent({
                        signalExternalKey: signal.externalKey,
                        eventType: SignalEventType.MOVE_SL_BE,
                        candleTime: bar.time,
                        snapshot,
                        config,
                        label: 'BE',
                        price: activeStop,
                        stateBefore: 'ENTRY_ACTIVE',
                        stateAfter: 'BE_ARMED',
                        ruleId: 'move_stop_to_breakeven',
                        notes: `Break-even was armed after price moved ${config.breakEvenTriggerPct}% in favor from entry.`,
                        extra: {
                            triggerPct: config.breakEvenTriggerPct,
                            triggerPrice: round(beTriggerPrice, 4),
                            stopPrice: round(activeStop, 4),
                        },
                    });
                    additionalEvents.push(beEvent.event);
                    additionalTraces.push(beEvent.trace);
                }

                for (const stage of config.trailStages) {
                    if (hitTrailLevels.has(stage.level) || remainingFraction <= 0) {
                        continue;
                    }

                    const stagePrice = toPctPrice(entryRawPrice, stage.triggerPct);
                    if (bar.high < stagePrice) {
                        continue;
                    }

                    hitTrailLevels.add(stage.level);
                    const closeFraction = Math.min(remainingFraction, stage.closePct / 100);
                    if (closeFraction <= 0) {
                        continue;
                    }

                    realizeExit(stagePrice, closeFraction);
                    remainingFraction -= closeFraction;
                    exitTime = bar.time;
                    finalExitReason = ExitReason.TRAILING_STOP;
                    lastState = `TRAIL_LEVEL_${stage.level}`;
                    notes.push(`T${stage.level}:${stage.triggerPct}%/${stage.closePct}%`);

                    const trailEvent = buildManagementEvent({
                        signalExternalKey: signal.externalKey,
                        eventType: stage.level === 1 ? SignalEventType.TRAIL_START : SignalEventType.TRAIL_UPDATE,
                        candleTime: bar.time,
                        snapshot,
                        config,
                        label: `T${stage.level}`,
                        price: stagePrice,
                        stateBefore: stage.level === 1 ? (beArmed ? 'BE_ARMED' : 'ENTRY_ACTIVE') : `TRAIL_LEVEL_${stage.level - 1}`,
                        stateAfter: `TRAIL_LEVEL_${stage.level}`,
                        ruleId: `trail_partial_level_${stage.level}`,
                        notes: `Trail level ${stage.level} closed ${stage.closePct}% after a ${stage.triggerPct}% move from entry.`,
                        extra: {
                            triggerPct: stage.triggerPct,
                            closePct: stage.closePct,
                            stagePrice: round(stagePrice, 4),
                            remainingFraction: roundMetric(remainingFraction),
                        },
                    });
                    additionalEvents.push(trailEvent.event);
                    additionalTraces.push(trailEvent.trace);
                }

                if (remainingFraction <= 0) {
                    break;
                }

                if (takeProfitPrice !== null && bar.high >= takeProfitPrice) {
                    const closeFraction = remainingFraction;
                    realizeExit(takeProfitPrice, closeFraction);
                    remainingFraction = 0;
                    exitTime = bar.time;
                    finalExitReason = ExitReason.TAKE_PROFIT_1;

                    const takeProfitEvent = buildManagementEvent({
                        signalExternalKey: signal.externalKey,
                        eventType: SignalEventType.TP1_HIT,
                        candleTime: bar.time,
                        snapshot,
                        config,
                        label: 'TP1',
                        price: takeProfitPrice,
                        stateBefore: lastState,
                        stateAfter: 'TP1_EXIT',
                        ruleId: 'take_profit_profile_hit',
                        notes: 'The remaining position was closed at the configured take-profit level.',
                        extra: {
                            takeProfitPrice: round(takeProfitPrice, 4),
                            remainingFraction: 0,
                            takeProfitMode: context.executionConfig.takeProfit.mode,
                            takeProfitValue: context.executionConfig.takeProfit.value,
                        },
                    });
                    additionalEvents.push(takeProfitEvent.event);
                    additionalTraces.push(takeProfitEvent.trace);
                }

                if (remainingFraction <= 0) {
                    break;
                }

                if (bar.low <= activeStop) {
                    const closeFraction = remainingFraction;
                    realizeExit(activeStop, closeFraction);
                    remainingFraction = 0;
                    exitTime = bar.time;
                    finalExitReason = beArmed && activeStop >= entryRawPrice
                        ? ExitReason.BREAK_EVEN
                        : ExitReason.STOP_LOSS;

                    const stopEvent = buildManagementEvent({
                        signalExternalKey: signal.externalKey,
                        eventType: SignalEventType.STOP_HIT,
                        candleTime: bar.time,
                        snapshot,
                        config,
                        label: finalExitReason === ExitReason.BREAK_EVEN ? 'BE EXIT' : 'STOP',
                        price: activeStop,
                        stateBefore: lastState,
                        stateAfter: finalExitReason === ExitReason.BREAK_EVEN ? 'BREAK_EVEN_EXIT' : 'STOP_EXIT',
                        ruleId: finalExitReason === ExitReason.BREAK_EVEN ? 'breakeven_stop_hit' : 'initial_stop_hit',
                        notes: finalExitReason === ExitReason.BREAK_EVEN
                            ? 'The remaining position was stopped out at break-even.'
                            : 'The remaining position was stopped out at the active stop.',
                        extra: {
                            stopPrice: round(activeStop, 4),
                            remainingFraction: 0,
                        },
                    });
                    additionalEvents.push(stopEvent.event);
                    additionalTraces.push(stopEvent.trace);
                }
            }

            if (remainingFraction > 0 && config.closeRemainingOnRangeEnd) {
                const lastBar = context.baseBars[context.baseBars.length - 1];
                const snapshot = context.finalState.snapshots[context.finalState.snapshots.length - 1];

                if (lastBar && snapshot) {
                    const closeFraction = remainingFraction;
                    realizeExit(lastBar.close, closeFraction);
                    remainingFraction = 0;
                    exitTime = lastBar.time;
                    finalExitReason = ExitReason.EXPIRATION;

                    const expirationEvent = buildManagementEvent({
                        signalExternalKey: signal.externalKey,
                        eventType: SignalEventType.EXPIRATION,
                        candleTime: lastBar.time,
                        snapshot,
                        config,
                        label: 'EXP',
                        price: lastBar.close,
                        stateBefore: lastState,
                        stateAfter: 'EXPIRATION_EXIT',
                        ruleId: 'range_end_force_close',
                        notes: 'The remaining position was force-closed at the end of the backtest range.',
                        extra: {
                            exitPrice: round(lastBar.close, 4),
                            remainingFraction: 0,
                        },
                    });
                    additionalEvents.push(expirationEvent.event);
                    additionalTraces.push(expirationEvent.trace);
                }
            }

            if (!exitTime) {
                continue;
            }

            results.push({
                signalExternalKey: signal.externalKey,
                exitRuleCode,
                exitRuleName,
                exitRuleConfigJson: {
                    stopLoss: context.executionConfig.stopLoss,
                    takeProfit: context.executionConfig.takeProfit,
                    positionSizing: context.executionConfig.positionSizing,
                    breakEvenTriggerPct: config.breakEvenTriggerPct,
                    trailStages: config.trailStages,
                    closeRemainingOnRangeEnd: config.closeRemainingOnRangeEnd,
                    derived: {
                        quantity: roundMetric(positionSizing.quantity, 8),
                        notionalUsd: roundMetric(positionSizing.notionalUsd, 4),
                        accountUsagePct: roundMetric(positionSizing.accountUsagePct, 4),
                        stopLossPrice: round(stopLoss, 4),
                        takeProfitPrice: takeProfitPrice === null ? null : round(takeProfitPrice, 4),
                        riskAmountUsd: roundMetric(totalRiskAmountUsd, 4),
                    },
                },
                resultSide: PositionSide.LONG,
                session: signal.session || resolveSession(exitTime),
                win: realizedNetR > 0,
                isOpen: false,
                rMultiple: roundMetric(realizedNetR),
                pnlUsd: roundMoney(realizedPnlUsd),
                maxDrawdownPct: roundMetric(maxDrawdownPct, 4),
                exitReason: finalExitReason,
                exitTime,
                exitPrice: round(weightedExitPrice, 4),
                notes: notes.join(' | '),
            });
        }

        return {
            events: additionalEvents,
            traces: additionalTraces,
            results,
        };
    },
};
