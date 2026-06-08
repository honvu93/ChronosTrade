import { BacktestTradeResult, Prisma, PrismaClient, SignalEventType, SignalSourceType } from '@prisma/client';
import { CandleQueryService } from './CandleQueryService';
import { IndicatorSeriesService } from './IndicatorSeriesService';
import { CandleBar } from './types';
import { detectSwings } from './blocks/utils/swingDetection';
import { normalizeTimeframe } from '../../utils/timeframes';

type ReplayResultRecord = Prisma.BacktestTradeResultGetPayload<{
    include: {
        signal: {
            include: {
                strategy: true,
            },
        },
        exitRule: true,
        backtestRun: true,
    },
}>;

type ReplayEventRecord = Prisma.SignalEventGetPayload<{}>;
type ReplayTraceRecord = Prisma.SignalLogicTraceGetPayload<{}>;

type ReplayLinePoint = {
    time: string;
    value: number;
};

type ReplayMarker = {
    id: string;
    time: string;
    price: number | null;
    label: string;
    tone: 'neutral' | 'entry' | 'success' | 'danger' | 'accent' | 'warning';
    shape: 'arrowUp' | 'arrowDown' | 'circle' | 'square';
    position: 'aboveBar' | 'belowBar' | 'inBar';
    source: 'event' | 'swing' | 'trade';
};

type ReplayLevel = {
    id: string;
    label: string;
    price: number;
    tone: 'entry' | 'danger' | 'success' | 'neutral' | 'warning';
    lineStyle: 'solid' | 'dashed' | 'dotted';
};

type ReplaySessionRange = {
    label: 'ASIAN' | 'LONDON' | 'NY';
    start: string;
    end: string;
};

type ReplayTimelineItem = {
    id: string;
    kind: 'event' | 'trace';
    eventType: string;
    candleTime: string;
    label: string;
    price: number | null;
    detail: string | null;
};

type ReplayStageEntry = {
    stageNumber: 1 | 2 | 3;
    stageName: 'At Risk' | 'Protected' | 'Trailing';
    startedAt: string;
    startedAtEventType: string;
    endedAt: string | null;
    riskStatus: 'at-risk' | 'protected' | 'locked-profit';
    stopLossPrice: number;
    currentR: number;
    nextAction: string;
};

type ReplayStageAnalysis = {
    stages: ReplayStageEntry[];
    currentStage: number;
    currentStageName: string;
    currentRiskStatus: 'at-risk' | 'protected' | 'locked-profit';
    currentStopLoss: number;
    currentR: number;
    nextAction: string;
};

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
        side: 'LONG' | 'SHORT';
        session: 'ASIAN' | 'LONDON' | 'NY';
        exitRuleCode: string;
        exitRuleName: string;
        result: 'ACTIVE' | 'WIN' | 'LOSS' | 'BE';
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
        levels: ReplayLevel[];
        markers: ReplayMarker[];
        trailLine: ReplayLinePoint[];
        sessionRanges: ReplaySessionRange[];
    };
    indicatorPane: {
        available: boolean;
        title: string;
        reason: string | null;
        rsi: ReplayLinePoint[];
        ema9: ReplayLinePoint[];
        wma45: ReplayLinePoint[];
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
        markers: ReplayMarker[];
    };
    timeline: ReplayTimelineItem[];
    stageAnalysis: ReplayStageAnalysis | null;
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
    decisionLog: unknown[] | null;
}

const KNOWN_TIMEFRAMES = new Set([
    '1m', '5m', '15m', '30m', '1h', '2h', '3h', '4h', '12h', '1d', '3d', '1w', '1M',
]);

const SESSION_CONFIG = [
    { label: 'ASIAN' as const, startHour: 0, endHour: 8 },
    { label: 'LONDON' as const, startHour: 8, endHour: 13 },
    { label: 'NY' as const, startHour: 13, endHour: 22 },
];

const TRAIL_EVENT_TYPES = new Set<SignalEventType>([
    SignalEventType.MOVE_SL_BE,
    SignalEventType.TRAIL_START,
    SignalEventType.TRAIL_UPDATE,
]);

const toNumber = (value: Prisma.Decimal | number | string | null | undefined) => {
    if (value === null || value === undefined) return 0;
    return Number(value);
};

const round = (value: number, digits = 4) => Number(value.toFixed(digits));

const isKnownTimeframe = (value: string) => KNOWN_TIMEFRAMES.has(normalizeTimeframe(value));

const getTimeframeMs = (timeframe: string) => {
    const normalized = normalizeTimeframe(timeframe);

    switch (normalized) {
        case '1m': return 60_000;
        case '5m': return 5 * 60_000;
        case '15m': return 15 * 60_000;
        case '30m': return 30 * 60_000;
        case '1h': return 60 * 60_000;
        case '2h': return 2 * 60 * 60_000;
        case '3h': return 3 * 60 * 60_000;
        case '4h': return 4 * 60 * 60_000;
        case '12h': return 12 * 60 * 60_000;
        case '1d': return 24 * 60 * 60_000;
        case '3d': return 3 * 24 * 60 * 60_000;
        case '1w': return 7 * 24 * 60 * 60_000;
        case '1M': return 30 * 24 * 60 * 60_000;
        default: return 60 * 60_000;
    }
};

const formatCandle = (bar: CandleBar) => ({
    time: bar.time.toISOString(),
    open: round(bar.open, 4),
    high: round(bar.high, 4),
    low: round(bar.low, 4),
    close: round(bar.close, 4),
    volume: round(bar.volume, 4),
});

const formatLinePoint = (point: { time: Date; value: number }): ReplayLinePoint => ({
    time: point.time.toISOString(),
    value: round(point.value, 4),
});

const toRecord = (value: unknown): Record<string, unknown> | null => (
    value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
);

const getNumericFromRecord = (record: Record<string, unknown> | null, key: string): number | null => {
    if (!record) return null;
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
};

const getTextFromRecord = (record: Record<string, unknown> | null, key: string): string | null => {
    if (!record) return null;
    const value = record[key];
    return typeof value === 'string' && value.trim() !== '' ? value : null;
};

const walkForStructureTimeframe = (value: unknown, baseTimeframe: string): string | null => {
    if (typeof value === 'string' && isKnownTimeframe(value)) {
        const normalized = normalizeTimeframe(value);
        return normalized !== normalizeTimeframe(baseTimeframe) ? normalized : null;
    }

    if (Array.isArray(value)) {
        for (const item of value) {
            const found = walkForStructureTimeframe(item, baseTimeframe);
            if (found) return found;
        }
        return null;
    }

    if (!value || typeof value !== 'object') {
        return null;
    }

    const record = value as Record<string, unknown>;
    for (const key of ['trendTf', 'trendTimeframe', 'higherTimeframe', 'htf', 'structureTf', 'timeframe']) {
        const candidate = walkForStructureTimeframe(record[key], baseTimeframe);
        if (candidate) return candidate;
    }

    for (const nested of Object.values(record)) {
        const found = walkForStructureTimeframe(nested, baseTimeframe);
        if (found) return found;
    }

    return null;
};

const resolveStructureTimeframe = ({
    baseTimeframe,
    runParameters,
    signalExecutionConfig,
    eventRecords,
    traceRecords,
}: {
    baseTimeframe: string;
    runParameters: Prisma.JsonValue | null;
    signalExecutionConfig: Prisma.JsonValue | null;
    eventRecords: ReplayEventRecord[];
    traceRecords: ReplayTraceRecord[];
}) => {
    const candidates: unknown[] = [
        runParameters,
        signalExecutionConfig,
        ...eventRecords.map((event) => event.metaJson),
        ...traceRecords.flatMap((trace) => [trace.indicatorJson, trace.thresholdJson, trace.priceJson]),
    ];

    for (const candidate of candidates) {
        const timeframe = walkForStructureTimeframe(candidate, baseTimeframe);
        if (timeframe) {
            return timeframe;
        }
    }

    return null;
};

const buildSessionRanges = (rangeStart: Date, rangeEnd: Date): ReplaySessionRange[] => {
    const blocks: ReplaySessionRange[] = [];
    const firstDay = Date.UTC(rangeStart.getUTCFullYear(), rangeStart.getUTCMonth(), rangeStart.getUTCDate());
    const lastDay = Date.UTC(rangeEnd.getUTCFullYear(), rangeEnd.getUTCMonth(), rangeEnd.getUTCDate());

    for (let day = firstDay - 24 * 60 * 60 * 1000; day <= lastDay + 24 * 60 * 60 * 1000; day += 24 * 60 * 60 * 1000) {
        for (const session of SESSION_CONFIG) {
            const start = new Date(day + session.startHour * 60 * 60 * 1000);
            const end = new Date(day + session.endHour * 60 * 60 * 1000);
            if (end <= rangeStart || start >= rangeEnd) continue;
            blocks.push({
                label: session.label,
                start: start.toISOString(),
                end: end.toISOString(),
            });
        }
    }

    return blocks;
};

const classifyTradeResult = (result: BacktestTradeResult): 'ACTIVE' | 'WIN' | 'LOSS' | 'BE' => {
    if (result.isOpen) return 'ACTIVE';
    const rMultiple = toNumber(result.rMultiple);
    if (Math.abs(rMultiple) < 0.0001) return 'BE';
    return rMultiple > 0 ? 'WIN' : 'LOSS';
};

const getMarkerTone = (eventType: string): ReplayMarker['tone'] => {
    if (eventType === SignalEventType.TP1_HIT || eventType === SignalEventType.TP2_HIT) return 'success';
    if (eventType === SignalEventType.STOP_HIT || eventType === SignalEventType.FAIL) return 'danger';
    if (TRAIL_EVENT_TYPES.has(eventType as SignalEventType)) return 'warning';
    if (eventType === SignalEventType.ENTRY || eventType === SignalEventType.ENTRY_CONFIRMED) return 'entry';
    return 'accent';
};

const getMarkerShape = (eventType: string, side: 'LONG' | 'SHORT'): ReplayMarker['shape'] => {
    if (eventType === SignalEventType.ENTRY || eventType === SignalEventType.ENTRY_CONFIRMED) {
        return side === 'LONG' ? 'arrowUp' : 'arrowDown';
    }
    if (TRAIL_EVENT_TYPES.has(eventType as SignalEventType)) {
        return 'square';
    }
    return 'circle';
};

export class SignalBacktestTradeReplayService {
    constructor(
        private prisma: PrismaClient,
        private candleQuery = new CandleQueryService(prisma),
        private indicatorSeries = new IndicatorSeriesService(),
    ) {}

    public async getTradeReplay(backtestRunId: string, rowId: string): Promise<BacktestTradeReplayResponse> {
        const [signalId, exitRuleId] = rowId.split(':');
        if (!signalId || !exitRuleId) {
            throw new Error('Trade replay rowId must use signalId:exitRuleId format');
        }

        const result = await this.prisma.backtestTradeResult.findFirst({
            where: {
                backtestRunId,
                signalId,
                exitRuleId,
                backtestRun: {
                    sourceType: SignalSourceType.GENERATED,
                },
            },
            include: {
                signal: {
                    include: {
                        strategy: true,
                    },
                },
                exitRule: true,
                backtestRun: true,
            },
        }) as ReplayResultRecord | null;

        if (!result) {
            throw new Error('Generated backtest trade replay not found');
        }

        const [events, traces] = await Promise.all([
            this.prisma.signalEvent.findMany({
                where: {
                    backtestRunId,
                    signalId,
                },
                orderBy: [
                    { candleTime: 'asc' },
                    { createdAt: 'asc' },
                ],
            }) as Promise<ReplayEventRecord[]>,
            this.prisma.signalLogicTrace.findMany({
                where: {
                    backtestRunId,
                    signalId,
                },
                orderBy: [
                    { candleTime: 'asc' },
                    { createdAt: 'asc' },
                ],
            }) as Promise<ReplayTraceRecord[]>,
        ]);

        const focusStart = new Date(result.signal.entryTime);
        const focusEnd = result.exitTime
            ? new Date(result.exitTime)
            : new Date(events.at(-1)?.candleTime ?? traces.at(-1)?.candleTime ?? result.signal.entryTime);
        const timeframeMs = getTimeframeMs(result.signal.timeframe);
        const paddingBars = result.isOpen ? 24 : 12;
        const rangeStart = new Date(focusStart.getTime() - paddingBars * timeframeMs);
        const rangeEnd = new Date(focusEnd.getTime() + paddingBars * timeframeMs);

        const candles = await this.candleQuery.getCandles({
            symbol: result.signal.symbol,
            timeframe: result.signal.timeframe,
            from: rangeStart,
            to: rangeEnd,
        });

        const rsi = this.indicatorSeries.calculateRSIFromCandles(candles, 14);
        const ema9 = this.indicatorSeries.calculateEMA(rsi, 9);
        const wma45 = this.indicatorSeries.calculateWMA(rsi, 45);

        const structureTimeframe = resolveStructureTimeframe({
            baseTimeframe: result.signal.timeframe,
            runParameters: result.backtestRun.parametersJson,
            signalExecutionConfig: result.signal.executionConfigJson,
            eventRecords: events,
            traceRecords: traces,
        });
        const structureTimeframeMs = structureTimeframe ? getTimeframeMs(structureTimeframe) : null;
        const structurePaddingBars = structureTimeframeMs ? Math.max(paddingBars, 8) : null;
        const structureRangeStart = structureTimeframeMs && structurePaddingBars
            ? new Date(focusStart.getTime() - structurePaddingBars * structureTimeframeMs)
            : null;
        const structureRangeEnd = structureTimeframeMs && structurePaddingBars
            ? new Date(focusEnd.getTime() + structurePaddingBars * structureTimeframeMs)
            : null;
        const structureCandles = structureTimeframe
            ? await this.candleQuery.getCandles({
                symbol: result.signal.symbol,
                timeframe: structureTimeframe,
                from: structureRangeStart ?? rangeStart,
                to: structureRangeEnd ?? rangeEnd,
            })
            : [];

        const baseSwings = detectSwings(candles, 2);
        const structureSwings = structureCandles.length > 5 ? detectSwings(structureCandles, 2) : { highs: [], lows: [] };
        const levels = this.buildLevels(result);
        const tradeMarkers = this.buildTradeMarkers(result, events, traces);
        const swingMarkers = this.buildSwingMarkers(candles, baseSwings, 'base');
        const structureMarkers = this.buildSwingMarkers(structureCandles, structureSwings, 'structure');
        const trailLine = this.buildTrailLine(events, traces);

        const partialR = this.resolvePartialDetails(events, traces, result);
        const totalR = round(toNumber(result.rMultiple), 2);
        const remainingR = partialR === null ? null : round(totalR - partialR, 2);
        const configuredSize = this.resolveConfiguredSize({
            signalExecutionConfigJson: result.signal.executionConfigJson,
            runExecutionConfigJson: result.backtestRun.executionConfigJson,
        });
        const entryPrice = round(toNumber(result.signal.entryPrice), 4);
        const stopLoss = round(toNumber(result.signal.stopLoss), 4);
        const exitPrice = result.exitPrice ? round(toNumber(result.exitPrice), 4) : null;
        const riskDistance = round(Math.abs(entryPrice - stopLoss), 4);
        const barsHeld = this.calculateBarsHeld(candles, focusStart, focusEnd);

        return {
            summary: {
                rowId,
                runId: result.backtestRunId,
                runName: result.backtestRun.name,
                signalCode: result.backtestRun.signalCode,
                signalVersion: result.backtestRun.signalVersion,
                signalId: result.signalId,
                signalLabel: [
                    result.backtestRun.signalCode ? `${result.backtestRun.signalCode}@${result.backtestRun.signalVersion ?? '?'}` : null,
                    result.signal.strategy.code,
                ].filter(Boolean).join(' / ') || result.signal.strategy.name,
                strategyCode: result.signal.strategy.code,
                strategyName: result.signal.strategy.name,
                symbol: result.signal.symbol,
                timeframe: result.signal.timeframe,
                side: result.signal.side,
                session: result.signal.session,
                exitRuleCode: result.exitRule.code,
                exitRuleName: result.exitRule.name,
                result: classifyTradeResult(result),
                entryTime: result.signal.entryTime.toISOString(),
                exitTime: result.exitTime?.toISOString() ?? null,
                entryPrice,
                stopLoss,
                exitPrice,
                riskDistance,
                totalR,
                partialR,
                remainingR,
                barsHeld,
                configuredSize,
                quality: null,
            },
            window: {
                focusStart: focusStart.toISOString(),
                focusEnd: focusEnd.toISOString(),
                rangeStart: rangeStart.toISOString(),
                rangeEnd: rangeEnd.toISOString(),
                paddingBars,
            },
            pricePane: {
                candles: candles.map(formatCandle),
                levels,
                markers: [...tradeMarkers, ...swingMarkers],
                trailLine,
                sessionRanges: buildSessionRanges(rangeStart, rangeEnd),
            },
            indicatorPane: {
                available: rsi.length > 0,
                title: 'CTF RSI / EMA / WMA',
                reason: rsi.length > 0 ? null : 'Not enough candles were available to derive RSI context for this trade.',
                rsi: rsi.map(formatLinePoint),
                ema9: ema9.map(formatLinePoint),
                wma45: wma45.map(formatLinePoint),
            },
            structurePane: {
                available: Boolean(structureTimeframe && structureCandles.length > 0),
                title: structureTimeframe ? `HTF Price + Swings (${structureTimeframe.toUpperCase()})` : 'HTF Price + Swings',
                timeframe: structureTimeframe,
                reason: structureTimeframe
                    ? (structureCandles.length > 0 ? null : `No stored candles were available for ${structureTimeframe.toUpperCase()} during this replay window.`)
                    : 'No explicit higher-timeframe context was available for this signal.',
                candles: structureCandles.map(formatCandle),
                markers: structureMarkers,
            },
            timeline: this.buildTimeline(events, traces),
            stageAnalysis: this.resolveStageAnalysis({
                events,
                entryPrice,
                stopLoss,
                exitPrice,
                riskDistance,
                totalR,
                side: result.signal.side,
                result: classifyTradeResult(result),
            }),
            raw: {
                events: events.map((event) => ({
                    id: event.id,
                    eventType: event.eventType,
                    candleTime: event.candleTime.toISOString(),
                    price: event.price ? round(toNumber(event.price), 4) : null,
                    label: event.label,
                    metaJson: toRecord(event.metaJson),
                })),
                traces: traces.map((trace) => ({
                    id: trace.id,
                    eventType: trace.eventType,
                    candleTime: trace.candleTime.toISOString(),
                    ruleId: trace.ruleId,
                    notes: trace.notes,
                    indicatorJson: toRecord(trace.indicatorJson),
                    priceJson: toRecord(trace.priceJson),
                })),
            },
            decisionLog: Array.isArray(result.decisionLogJson) ? result.decisionLogJson : null,
        };
    }

    private buildLevels(result: ReplayResultRecord): ReplayLevel[] {
        const entry = round(toNumber(result.signal.entryPrice), 4);
        const stopLoss = round(toNumber(result.signal.stopLoss), 4);
        const riskDistance = Math.abs(entry - stopLoss);
        const rewardDirection = result.signal.side === 'LONG' ? 1 : -1;

        const levels: ReplayLevel[] = [
            { id: 'entry', label: 'Entry', price: entry, tone: 'entry', lineStyle: 'solid' },
            { id: 'stop-loss', label: 'SL', price: stopLoss, tone: 'danger', lineStyle: 'solid' },
        ];

        for (const multiple of [1, 2, 3]) {
            levels.push({
                id: `r-${multiple}`,
                label: `+${multiple}R`,
                price: round(entry + rewardDirection * riskDistance * multiple, 4),
                tone: 'success',
                lineStyle: 'dashed',
            });
        }

        if (result.exitPrice) {
            levels.push({
                id: 'exit',
                label: 'Exit',
                price: round(toNumber(result.exitPrice), 4),
                tone: 'neutral',
                lineStyle: 'dotted',
            });
        }

        return levels;
    }

    private buildTradeMarkers(
        result: ReplayResultRecord,
        events: ReplayEventRecord[],
        traces: ReplayTraceRecord[],
    ): ReplayMarker[] {
        const markers: ReplayMarker[] = [{
            id: 'trade-entry',
            time: result.signal.entryTime.toISOString(),
            price: round(toNumber(result.signal.entryPrice), 4),
            label: 'Entry',
            tone: 'entry',
            shape: result.signal.side === 'LONG' ? 'arrowUp' : 'arrowDown',
            position: result.signal.side === 'LONG' ? 'belowBar' : 'aboveBar',
            source: 'trade',
        }];

        if (result.exitTime && result.exitPrice) {
            markers.push({
                id: 'trade-exit',
                time: result.exitTime.toISOString(),
                price: round(toNumber(result.exitPrice), 4),
                label: result.exitRule.code,
                tone: classifyTradeResult(result) === 'WIN' ? 'success' : classifyTradeResult(result) === 'LOSS' ? 'danger' : 'neutral',
                shape: 'circle',
                position: result.signal.side === 'LONG' ? 'aboveBar' : 'belowBar',
                source: 'trade',
            });
        }

        for (const event of events) {
            markers.push({
                id: event.id,
                time: event.candleTime.toISOString(),
                price: event.price ? round(toNumber(event.price), 4) : null,
                label: event.label || event.eventType,
                tone: getMarkerTone(event.eventType),
                shape: getMarkerShape(event.eventType, result.signal.side),
                position: result.signal.side === 'LONG' ? 'belowBar' : 'aboveBar',
                source: 'event',
            });
        }

        for (const trace of traces) {
            if (!TRAIL_EVENT_TYPES.has(trace.eventType)) {
                continue;
            }

            const priceJson = toRecord(trace.priceJson);
            const stopPrice = getNumericFromRecord(priceJson, 'stopPrice');
            markers.push({
                id: `trace-${trace.id}`,
                time: trace.candleTime.toISOString(),
                price: stopPrice,
                label: trace.eventType === SignalEventType.MOVE_SL_BE ? 'BE' : 'TRAIL',
                tone: 'warning',
                shape: 'square',
                position: result.signal.side === 'LONG' ? 'aboveBar' : 'belowBar',
                source: 'event',
            });
        }

        return markers;
    }

    private buildSwingMarkers(
        candles: CandleBar[],
        swings: { highs: number[]; lows: number[] },
        source: 'base' | 'structure',
    ): ReplayMarker[] {
        const markers: ReplayMarker[] = [];

        for (const index of swings.highs) {
            const candle = candles[index];
            if (!candle) continue;
            markers.push({
                id: `${source}-swing-high-${index}`,
                time: candle.time.toISOString(),
                price: round(candle.high, 4),
                label: 'SH',
                tone: 'accent',
                shape: 'circle',
                position: 'aboveBar',
                source: 'swing',
            });
        }

        for (const index of swings.lows) {
            const candle = candles[index];
            if (!candle) continue;
            markers.push({
                id: `${source}-swing-low-${index}`,
                time: candle.time.toISOString(),
                price: round(candle.low, 4),
                label: 'SL',
                tone: 'warning',
                shape: 'circle',
                position: 'belowBar',
                source: 'swing',
            });
        }

        return markers;
    }

    private buildTrailLine(events: ReplayEventRecord[], traces: ReplayTraceRecord[]): ReplayLinePoint[] {
        const points = new Map<string, ReplayLinePoint>();

        for (const event of events) {
            if (!TRAIL_EVENT_TYPES.has(event.eventType)) continue;
            const meta = toRecord(event.metaJson);
            const stopPrice = getNumericFromRecord(meta, 'stopPrice');
            if (stopPrice === null) continue;
            points.set(event.candleTime.toISOString(), {
                time: event.candleTime.toISOString(),
                value: round(stopPrice, 4),
            });
        }

        for (const trace of traces) {
            if (!TRAIL_EVENT_TYPES.has(trace.eventType)) continue;
            const priceJson = toRecord(trace.priceJson);
            const stopPrice = getNumericFromRecord(priceJson, 'stopPrice');
            if (stopPrice === null) continue;
            const time = trace.candleTime.toISOString();
            if (!points.has(time)) {
                points.set(time, {
                    time,
                    value: round(stopPrice, 4),
                });
            }
        }

        return Array.from(points.values()).sort((left, right) => (
            new Date(left.time).getTime() - new Date(right.time).getTime()
        ));
    }

    private resolvePartialDetails(
        events: ReplayEventRecord[],
        traces: ReplayTraceRecord[],
        result: ReplayResultRecord,
    ): number | null {
        const partialEvent = events.find((event) => event.eventType === SignalEventType.TP1_HIT);
        const partialTrace = traces.find((trace) => trace.eventType === SignalEventType.TP1_HIT);

        const eventMeta = toRecord(partialEvent?.metaJson);
        const tracePrice = toRecord(partialTrace?.priceJson);
        const closeFraction = getNumericFromRecord(eventMeta, 'closeFraction') ?? getNumericFromRecord(tracePrice, 'closeFraction');
        const targetPrice = getNumericFromRecord(tracePrice, 'targetPrice')
            ?? getNumericFromRecord(eventMeta, 'targetPrice')
            ?? (partialEvent?.price ? toNumber(partialEvent.price) : null);

        if (closeFraction === null || targetPrice === null) {
            return null;
        }

        const entry = toNumber(result.signal.entryPrice);
        const riskDistance = Math.abs(entry - toNumber(result.signal.stopLoss));
        if (riskDistance === 0) {
            return null;
        }

        const grossR = Math.abs(targetPrice - entry) / riskDistance;
        return round(grossR * closeFraction, 2);
    }

    private resolveConfiguredSizeFromConfig(executionConfigJson: Prisma.JsonValue | null): number | null {
        const config = toRecord(executionConfigJson);
        const sizing = toRecord(config?.positionSizing);
        const mode = getTextFromRecord(sizing, 'mode');
        const value = getNumericFromRecord(sizing, 'value');

        if (mode === 'FIXED_QUANTITY' && value !== null && value > 0) {
            return round(value, 4);
        }

        return null;
    }

    private resolveConfiguredSize({
        signalExecutionConfigJson,
        runExecutionConfigJson,
    }: {
        signalExecutionConfigJson: Prisma.JsonValue | null;
        runExecutionConfigJson: Prisma.JsonValue | null;
    }): number | null {
        return this.resolveConfiguredSizeFromConfig(signalExecutionConfigJson)
            ?? this.resolveConfiguredSizeFromConfig(runExecutionConfigJson);
    }

    private calculateBarsHeld(candles: CandleBar[], entryTime: Date, exitTime: Date): number | null {
        if (candles.length === 0) {
            return null;
        }

        return candles.filter((bar) => (
            bar.time.getTime() >= entryTime.getTime() && bar.time.getTime() <= exitTime.getTime()
        )).length;
    }

    private buildTimeline(events: ReplayEventRecord[], traces: ReplayTraceRecord[]): ReplayTimelineItem[] {
        const items: ReplayTimelineItem[] = [
            ...events.map((event) => ({
                id: event.id,
                kind: 'event' as const,
                eventType: event.eventType,
                candleTime: event.candleTime.toISOString(),
                label: event.label || event.eventType,
                price: event.price ? round(toNumber(event.price), 4) : null,
                detail: null,
            })),
            ...traces.map((trace) => ({
                id: trace.id,
                kind: 'trace' as const,
                eventType: trace.eventType,
                candleTime: trace.candleTime.toISOString(),
                label: trace.ruleId || trace.eventType,
                price: getNumericFromRecord(toRecord(trace.priceJson), 'stopPrice'),
                detail: trace.notes,
            })),
        ];

        return items.sort((left, right) => (
            new Date(left.candleTime).getTime() - new Date(right.candleTime).getTime()
        ));
    }

    private resolveStageAnalysis({
        events,
        entryPrice,
        stopLoss,
        exitPrice,
        riskDistance,
        totalR,
        side,
        result,
    }: {
        events: ReplayEventRecord[];
        entryPrice: number;
        stopLoss: number;
        exitPrice: number | null;
        riskDistance: number;
        totalR: number;
        side: 'LONG' | 'SHORT';
        result: 'ACTIVE' | 'WIN' | 'LOSS' | 'BE';
    }): ReplayStageAnalysis | null {
        const entryEvent = events.find((event) =>
            event.eventType === SignalEventType.ENTRY || event.eventType === SignalEventType.ENTRY_CONFIRMED,
        );
        if (!entryEvent || riskDistance === 0) return null;

        const beEvent = events.find((event) => event.eventType === SignalEventType.MOVE_SL_BE);
        const partialEvent = events.find((event) => event.eventType === SignalEventType.TP1_HIT);
        const trailEvents = events.filter((event) =>
            event.eventType === SignalEventType.TRAIL_START || event.eventType === SignalEventType.TRAIL_UPDATE,
        );
        const terminalEvent = events.find((event) =>
            event.eventType === SignalEventType.STOP_HIT
            || event.eventType === SignalEventType.TP2_HIT
            || event.eventType === SignalEventType.EXPIRATION,
        );

        const stages: ReplayStageEntry[] = [];
        let currentStop = stopLoss;

        // Stage 1: At Risk — from entry until BE or terminal
        const stage1End = beEvent?.candleTime ?? terminalEvent?.candleTime ?? null;
        stages.push({
            stageNumber: 1,
            stageName: 'At Risk',
            startedAt: entryEvent.candleTime.toISOString(),
            startedAtEventType: entryEvent.eventType,
            endedAt: stage1End?.toISOString() ?? null,
            riskStatus: 'at-risk',
            stopLossPrice: round(stopLoss, 4),
            currentR: 0,
            nextAction: 'Breakeven at +1R',
        });

        // Stage 2: Protected — from BE until partial or terminal
        if (beEvent) {
            const beMeta = toRecord(beEvent.metaJson);
            const beStop = getNumericFromRecord(beMeta, 'stopPrice') ?? entryPrice;
            currentStop = beStop;

            const stage2End = partialEvent?.candleTime ?? terminalEvent?.candleTime ?? null;
            const beR = riskDistance > 0
                ? round(Math.abs((beEvent.price ? toNumber(beEvent.price) : entryPrice) - entryPrice) / riskDistance, 2)
                : 0;

            stages.push({
                stageNumber: 2,
                stageName: 'Protected',
                startedAt: beEvent.candleTime.toISOString(),
                startedAtEventType: beEvent.eventType,
                endedAt: stage2End?.toISOString() ?? null,
                riskStatus: 'protected',
                stopLossPrice: round(beStop, 4),
                currentR: beR,
                nextAction: '50% close at +2R',
            });
        }

        // Stage 3: Trailing — from partial close onwards
        if (partialEvent) {
            const partialMeta = toRecord(partialEvent.metaJson);
            const partialStop = getNumericFromRecord(partialMeta, 'stopPrice') ?? currentStop;

            // Find latest trail stop price
            let latestTrailStop = partialStop;
            let latestTrailR = 0;
            for (const trailEvent of trailEvents) {
                const trailMeta = toRecord(trailEvent.metaJson);
                const trailStop = getNumericFromRecord(trailMeta, 'stopPrice');
                if (trailStop !== null) {
                    latestTrailStop = trailStop;
                    latestTrailR = riskDistance > 0
                        ? round(Math.abs(trailStop - entryPrice) / riskDistance, 2)
                        : 0;
                }
            }
            currentStop = latestTrailStop;

            const partialR = riskDistance > 0
                ? round(Math.abs((partialEvent.price ? toNumber(partialEvent.price) : entryPrice) - entryPrice) / riskDistance, 2)
                : 0;

            const nextTrailR = latestTrailR > 0 ? latestTrailR + 1 : partialR + 1;
            const nextTrailPrice = side === 'LONG'
                ? round(entryPrice + riskDistance * nextTrailR, 4)
                : round(entryPrice - riskDistance * nextTrailR, 4);

            stages.push({
                stageNumber: 3,
                stageName: 'Trailing',
                startedAt: partialEvent.candleTime.toISOString(),
                startedAtEventType: partialEvent.eventType,
                endedAt: terminalEvent?.candleTime?.toISOString() ?? null,
                riskStatus: latestTrailR > 0 ? 'locked-profit' : 'protected',
                stopLossPrice: round(latestTrailStop, 4),
                currentR: partialR,
                nextAction: `Trailing — next +${round(nextTrailR, 0)}R (${nextTrailPrice})`,
            });
        }

        if (stages.length === 0) return null;

        const lastStage = stages[stages.length - 1];
        const isClosed = result !== 'ACTIVE';
        const riskStatusForClosed = lastStage.riskStatus;

        return {
            stages,
            currentStage: lastStage.stageNumber,
            currentStageName: isClosed ? `Stage ${lastStage.stageNumber} — Closed` : `Stage ${lastStage.stageNumber} — ${lastStage.stageName}`,
            currentRiskStatus: riskStatusForClosed,
            currentStopLoss: round(currentStop, 4),
            currentR: round(totalR, 2),
            nextAction: isClosed
                ? `Closed at ${totalR >= 0 ? '+' : ''}${round(totalR, 2)}R. ${this.describeCloseReason(events, exitPrice, result)}`
                : lastStage.nextAction,
        };
    }

    private describeCloseReason(
        events: ReplayEventRecord[],
        exitPrice: number | null,
        result: 'ACTIVE' | 'WIN' | 'LOSS' | 'BE',
    ): string {
        const stopHit = events.find((event) => event.eventType === SignalEventType.STOP_HIT);
        const tp2Hit = events.find((event) => event.eventType === SignalEventType.TP2_HIT);
        const expiration = events.find((event) => event.eventType === SignalEventType.EXPIRATION);

        if (stopHit) {
            const price = stopHit.price ? round(toNumber(stopHit.price), 2) : exitPrice;
            if (result === 'LOSS') return `SL hit at ${price}.`;
            if (result === 'BE') return `SL near BE at ${price}.`;
            return `Trailing SL hit at ${price}.`;
        }
        if (tp2Hit) {
            return `TP hit at ${exitPrice ?? 'n/a'}.`;
        }
        if (expiration) {
            return `Time/session exit at ${exitPrice ?? 'n/a'}.`;
        }
        return exitPrice ? `Closed at ${exitPrice}.` : '';
    }
}
