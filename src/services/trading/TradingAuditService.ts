import { Prisma, PrismaClient, SignalEventType } from '@prisma/client';

const BREAK_EVEN_EPSILON = 0.0001;
const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 50;

type TradeRecord = Prisma.BacktestTradeResultGetPayload<{
    include: {
        signal: true;
        exitRule: true;
        backtestRun: true;
    };
}>;

type SignalEventRecord = Prisma.SignalEventGetPayload<{
    select: {
        id: true;
        signalId: true;
        backtestRunId: true;
        eventType: true;
        candleTime: true;
        price: true;
        label: true;
        metaJson: true;
        createdAt: true;
    };
}>;

type SignalTraceRecord = Prisma.SignalLogicTraceGetPayload<{
    select: {
        id: true;
        signalId: true;
        signalEventId: true;
        backtestRunId: true;
        eventType: true;
        candleTime: true;
        stateBefore: true;
        stateAfter: true;
        ruleId: true;
        indicatorJson: true;
        thresholdJson: true;
        priceJson: true;
        notes: true;
        createdAt: true;
    };
}>;

export type TradeHistoryAuditResult = 'ACTIVE' | 'WIN' | 'LOSS' | 'BE';
export type TradeHistoryAuditCoverage = 'full' | 'partial' | 'missing';
export type TradeHistoryAuditTimelineKind = 'command' | 'decision';

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
    source: 'event' | 'trace';
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

interface AuditCounts {
    commandEvents: number;
    decisionEvents: number;
    latestAuditAt: string | null;
}

interface SummarySignalEventRecord {
    signalId: string | null;
    backtestRunId: string | null;
    eventType: SignalEventType;
    candleTime: Date;
    createdAt: Date;
}

interface SummarySignalTraceRecord {
    signalId: string | null;
    backtestRunId: string | null;
    eventType: SignalEventType;
    candleTime: Date;
    createdAt: Date;
}

const toNumber = (value: Prisma.Decimal | number | string | null | undefined): number => {
    if (value === null || value === undefined) return 0;
    return Number(value);
};

const round = (value: number, digits = 2): number => Number(value.toFixed(digits));
const toPairKey = (backtestRunId: string, signalId: string) => `${backtestRunId}:${signalId}`;
const toIso = (value: Date | null | undefined): string | null => value ? value.toISOString() : null;
const COMMAND_EVENT_TYPES = new Set<SignalEventType>([
    SignalEventType.ENTRY_CONFIRMED,
    SignalEventType.MOVE_SL_BE,
    SignalEventType.TRAIL_START,
    SignalEventType.TRAIL_UPDATE,
    SignalEventType.TP1_HIT,
    SignalEventType.TP2_HIT,
    SignalEventType.STOP_HIT,
    SignalEventType.EXPIRATION,
]);

const isFinitePositiveInteger = (value: unknown): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value > 0;

const normalizeLimit = (limit?: number) => {
    if (!isFinitePositiveInteger(limit)) {
        return DEFAULT_LIMIT;
    }

    return Math.min(limit, MAX_LIMIT);
};

export class TradingAuditService {
    constructor(private prisma: PrismaClient) {}

    public async listHistory({ limit }: { limit?: number } = {}): Promise<TradeHistoryAuditSnapshot> {
        const rows = await this.prisma.backtestTradeResult.findMany({
            include: {
                signal: true,
                exitRule: true,
                backtestRun: true,
            },
            orderBy: { createdAt: 'desc' },
            take: normalizeLimit(limit),
        });

        const { eventGroups, traceGroups } = await this.loadAuditGroups(rows);
        const records = rows
            .map((row) => this.serializeRecord(row, this.buildScopedAuditCounts(
                row,
                eventGroups.get(toPairKey(row.backtestRunId, row.signalId)) ?? [],
                traceGroups.get(toPairKey(row.backtestRunId, row.signalId)) ?? [],
            )))
            .sort((left, right) => this.sortRecords(right) - this.sortRecords(left));

        return {
            summary: this.buildSummary(records),
            records,
            evaluatedAt: new Date().toISOString(),
        };
    }

    public async getHistoryDetail(recordId: string): Promise<TradeHistoryAuditDetailSnapshot | null> {
        const row = await this.prisma.backtestTradeResult.findUnique({
            where: { id: recordId },
            include: {
                signal: true,
                exitRule: true,
                backtestRun: true,
            },
        });

        if (!row) {
            return null;
        }

        const [events, traces] = await Promise.all([
            this.prisma.signalEvent.findMany({
                where: {
                    backtestRunId: row.backtestRunId,
                    signalId: row.signalId,
                },
                select: {
                    id: true,
                    signalId: true,
                    backtestRunId: true,
                    eventType: true,
                    candleTime: true,
                    price: true,
                    label: true,
                    metaJson: true,
                    createdAt: true,
                },
                orderBy: [
                    { candleTime: 'asc' },
                    { createdAt: 'asc' },
                ],
            }),
            this.prisma.signalLogicTrace.findMany({
                where: {
                    backtestRunId: row.backtestRunId,
                    signalId: row.signalId,
                },
                select: {
                    id: true,
                    signalId: true,
                    signalEventId: true,
                    backtestRunId: true,
                    eventType: true,
                    candleTime: true,
                    stateBefore: true,
                    stateAfter: true,
                    ruleId: true,
                    indicatorJson: true,
                    thresholdJson: true,
                    priceJson: true,
                    notes: true,
                    createdAt: true,
                },
                orderBy: [
                    { candleTime: 'asc' },
                    { createdAt: 'asc' },
                ],
            }),
        ]);

        const scopedEvents = this.filterTimelineRowsForRecord(row, events);
        const scopedTraces = this.filterTimelineRowsForRecord(row, traces);
        const auditCounts = this.buildAuditCounts(scopedEvents, scopedTraces);
        const record = this.serializeRecord(row, auditCounts);
        const timeline = this.buildTimeline(scopedEvents, scopedTraces);

        return {
            record,
            traceability: {
                historyRecordId: row.id,
                rowId: `${row.signalId}:${row.exitRuleId}`,
                signalId: row.signalId,
                backtestRunId: row.backtestRunId,
                runName: row.backtestRun.name,
                signalKey: this.buildSignalKey(row),
                exitRuleCode: row.exitRule.code,
                summaryLabel: `${row.signal.symbol} ${row.signal.timeframe} ${row.signal.side}`,
                scopeLabel: 'Scoped record thread',
                scopeDetail: this.buildScopeDetail(row),
            },
            timelineSummary: {
                totalItems: timeline.length,
                commandEvents: auditCounts.commandEvents,
                decisionEvents: auditCounts.decisionEvents,
                firstOccurredAt: timeline[0]?.occurredAt ?? null,
                lastOccurredAt: timeline.at(-1)?.occurredAt ?? null,
            },
            timeline,
            evaluatedAt: new Date().toISOString(),
        };
    }

    private async loadAuditGroups(rows: TradeRecord[]) {
        const pairFilters = Array.from(
            new Map(
                rows.map((row) => [
                    toPairKey(row.backtestRunId, row.signalId),
                    { backtestRunId: row.backtestRunId, signalId: row.signalId },
                ]),
            ).values(),
        );

        if (pairFilters.length === 0) {
            return {
                eventGroups: new Map<string, SummarySignalEventRecord[]>(),
                traceGroups: new Map<string, SummarySignalTraceRecord[]>(),
            };
        }

        const [events, traces] = await Promise.all([
            this.prisma.signalEvent.findMany({
                where: { OR: pairFilters },
                select: {
                    signalId: true,
                    backtestRunId: true,
                    eventType: true,
                    candleTime: true,
                    createdAt: true,
                },
            }),
            this.prisma.signalLogicTrace.findMany({
                where: { OR: pairFilters },
                select: {
                    signalId: true,
                    backtestRunId: true,
                    eventType: true,
                    candleTime: true,
                    createdAt: true,
                },
            }),
        ]);

        return {
            eventGroups: this.groupEvents(events),
            traceGroups: this.groupTraces(traces),
        };
    }

    private groupEvents(events: SummarySignalEventRecord[]) {
        const grouped = new Map<string, SummarySignalEventRecord[]>();

        for (const event of events) {
            if (!event.backtestRunId || !event.signalId) continue;
            const key = toPairKey(event.backtestRunId, event.signalId);
            const list = grouped.get(key) ?? [];
            list.push(event);
            grouped.set(key, list);
        }

        return grouped;
    }

    private groupTraces(traces: SummarySignalTraceRecord[]) {
        const grouped = new Map<string, SummarySignalTraceRecord[]>();

        for (const trace of traces) {
            if (!trace.backtestRunId || !trace.signalId) continue;
            const key = toPairKey(trace.backtestRunId, trace.signalId);
            const list = grouped.get(key) ?? [];
            list.push(trace);
            grouped.set(key, list);
        }

        return grouped;
    }

    private buildAuditCounts(
        events: Array<{ eventType: SignalEventType | string; candleTime: Date }>,
        traces: Array<{ eventType: SignalEventType | string; candleTime: Date }>,
    ): AuditCounts {
        const latestEventTime = events.reduce<Date | null>((latest, event) => {
            if (!latest || event.candleTime > latest) {
                return event.candleTime;
            }
            return latest;
        }, null);
        const latestTraceTime = traces.reduce<Date | null>((latest, trace) => {
            if (!latest || trace.candleTime > latest) {
                return trace.candleTime;
            }
            return latest;
        }, null);

        const latestAuditAt = latestEventTime && latestTraceTime
            ? (latestEventTime > latestTraceTime ? latestEventTime : latestTraceTime)
            : latestEventTime ?? latestTraceTime;

        return {
            commandEvents: this.countTimelineKind(events) + this.countTimelineKind(traces),
            decisionEvents: (events.length + traces.length)
                - (this.countTimelineKind(events) + this.countTimelineKind(traces)),
            latestAuditAt: toIso(latestAuditAt),
        };
    }

    private buildSummary(records: TradeHistoryAuditRecord[]): TradeHistoryAuditSummary {
        return records.reduce<TradeHistoryAuditSummary>((summary, record) => {
            summary.totalRecords += 1;
            if (record.result === 'ACTIVE') summary.activeTrades += 1;
            if (record.result === 'WIN') summary.wins += 1;
            if (record.result === 'LOSS') summary.losses += 1;
            if (record.result === 'BE') summary.breakEven += 1;
            if (record.auditCoverage === 'missing') summary.recordsMissingAudit += 1;
            else summary.recordsWithAudit += 1;
            summary.commandEvents += record.commandEventCount;
            summary.decisionEvents += record.decisionEventCount;
            return summary;
        }, {
            totalRecords: 0,
            activeTrades: 0,
            wins: 0,
            losses: 0,
            breakEven: 0,
            recordsWithAudit: 0,
            recordsMissingAudit: 0,
            commandEvents: 0,
            decisionEvents: 0,
        });
    }

    private serializeRecord(row: TradeRecord, auditCounts: AuditCounts): TradeHistoryAuditRecord {
        return {
            recordId: row.id,
            rowId: `${row.signalId}:${row.exitRuleId}`,
            signalId: row.signalId,
            backtestRunId: row.backtestRunId,
            exitRuleId: row.exitRuleId,
            exitRuleCode: row.exitRule.code,
            exitRuleName: row.exitRule.name,
            runName: row.backtestRun.name,
            runStatus: row.backtestRun.status,
            signalCode: row.backtestRun.signalCode ?? null,
            signalVersion: row.backtestRun.signalVersion ?? null,
            symbol: row.signal.symbol,
            timeframe: row.signal.timeframe,
            side: row.signal.side,
            session: row.session,
            entryTime: row.signal.entryTime.toISOString(),
            exitTime: toIso(row.exitTime),
            entryPrice: round(toNumber(row.signal.entryPrice), 4),
            stopLoss: round(toNumber(row.signal.stopLoss), 4),
            exitPrice: row.exitPrice ? round(toNumber(row.exitPrice), 4) : null,
            rMultiple: round(toNumber(row.rMultiple), 2),
            pnlUsd: round(toNumber(row.pnlUsd), 2),
            result: this.classifyResult(row),
            exitReason: row.exitReason,
            notes: row.notes ?? row.signal.notes ?? null,
            commandEventCount: auditCounts.commandEvents,
            decisionEventCount: auditCounts.decisionEvents,
            auditCoverage: this.classifyAuditCoverage(auditCounts),
            latestAuditAt: auditCounts.latestAuditAt,
        };
    }

    private buildTimeline(
        events: SignalEventRecord[],
        traces: SignalTraceRecord[],
    ): TradeHistoryAuditTimelineItem[] {
        const timeline = [
            ...events.map<TradeHistoryAuditTimelineItem>((event) => ({
                id: event.id,
                kind: this.classifyTimelineKind(event.eventType),
                source: 'event',
                eventType: event.eventType,
                occurredAt: event.candleTime.toISOString(),
                createdAt: event.createdAt.toISOString(),
                label: event.label ?? null,
                price: event.price ? round(toNumber(event.price), 4) : null,
                signalEventId: event.id,
                stateBefore: null,
                stateAfter: null,
                ruleId: null,
                notes: null,
                metaJson: event.metaJson ?? null,
                indicatorJson: null,
                thresholdJson: null,
                priceJson: null,
            })),
            ...traces.map<TradeHistoryAuditTimelineItem>((trace) => ({
                id: trace.id,
                kind: this.classifyTimelineKind(trace.eventType),
                source: 'trace',
                eventType: trace.eventType,
                occurredAt: trace.candleTime.toISOString(),
                createdAt: trace.createdAt.toISOString(),
                label: null,
                price: null,
                signalEventId: trace.signalEventId ?? null,
                stateBefore: trace.stateBefore ?? null,
                stateAfter: trace.stateAfter ?? null,
                ruleId: trace.ruleId ?? null,
                notes: trace.notes ?? null,
                metaJson: null,
                indicatorJson: trace.indicatorJson ?? null,
                thresholdJson: trace.thresholdJson ?? null,
                priceJson: trace.priceJson ?? null,
            })),
        ];

        return timeline.sort((left, right) => {
            const leftOccurred = new Date(left.occurredAt).getTime();
            const rightOccurred = new Date(right.occurredAt).getTime();
            if (leftOccurred !== rightOccurred) {
                return leftOccurred - rightOccurred;
            }

            const leftCreated = new Date(left.createdAt).getTime();
            const rightCreated = new Date(right.createdAt).getTime();
            if (leftCreated !== rightCreated) {
                return leftCreated - rightCreated;
            }

            if (left.kind === right.kind) {
                return left.id.localeCompare(right.id);
            }

            return left.kind === 'decision' ? -1 : 1;
        });
    }

    private buildSignalKey(row: TradeRecord) {
        if (row.backtestRun.signalCode && row.backtestRun.signalVersion !== null) {
            return `${row.backtestRun.signalCode}@v${row.backtestRun.signalVersion}`;
        }

        return null;
    }

    private buildScopedAuditCounts(
        row: TradeRecord,
        events: SummarySignalEventRecord[],
        traces: SummarySignalTraceRecord[],
    ): AuditCounts {
        const scopedEvents = this.filterTimelineRowsForRecord(row, events);
        const scopedTraces = this.filterTimelineRowsForRecord(row, traces);
        return this.buildAuditCounts(scopedEvents, scopedTraces);
    }

    private filterTimelineRowsForRecord<T extends { candleTime: Date }>(row: TradeRecord, rows: T[]) {
        if (!row.exitTime) {
            return rows;
        }

        const exitTime = row.exitTime;
        return rows.filter((item) => item.candleTime <= exitTime);
    }

    private classifyTimelineKind(eventType: SignalEventType | string): TradeHistoryAuditTimelineKind {
        return COMMAND_EVENT_TYPES.has(eventType as SignalEventType) ? 'command' : 'decision';
    }

    private countTimelineKind(rows: Array<{ eventType: SignalEventType | string }>) {
        return rows.filter((row) => this.classifyTimelineKind(row.eventType) === 'command').length;
    }

    private buildScopeDetail(row: TradeRecord) {
        if (!row.exitTime) {
            return `This history stays scoped to ${row.exitRule.code} while the trade remains active.`;
        }

        const exitTime = row.exitTime;
        return `This history shows the shared signal thread through the selected ${row.exitRule.code} outcome (${row.exitReason}) at ${exitTime.toISOString()}.`;
    }

    private sortRecords(record: TradeHistoryAuditRecord) {
        return new Date(record.exitTime ?? record.entryTime).getTime();
    }

    private classifyResult(row: TradeRecord): TradeHistoryAuditResult {
        if (row.isOpen) {
            return 'ACTIVE';
        }

        const rMultiple = toNumber(row.rMultiple);
        if (Math.abs(rMultiple) < BREAK_EVEN_EPSILON) {
            return 'BE';
        }

        return rMultiple > 0 ? 'WIN' : 'LOSS';
    }

    private classifyAuditCoverage(auditCounts: AuditCounts): TradeHistoryAuditCoverage {
        if (auditCounts.commandEvents > 0 && auditCounts.decisionEvents > 0) {
            return 'full';
        }
        if (auditCounts.commandEvents > 0 || auditCounts.decisionEvents > 0) {
            return 'partial';
        }
        return 'missing';
    }
}
