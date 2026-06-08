import { PrismaClient, SignalEventType } from '@prisma/client';
import {
    TradingOutputContractKind,
    TradingOutputContractService,
    TradingOutputEnvelope,
} from './TradingOutputContractService';

export interface ExportRecordsQuery {
    backtestRunId: string | null;
    indicatorInstanceId: string | null;
    contractKind: TradingOutputContractKind | null;
    limit: number;
}

export interface ExportRecordsResult {
    records: TradingOutputEnvelope[];
    total: number;
    query: {
        backtestRunId: string | null;
        indicatorInstanceId: string | null;
        contractKind: TradingOutputContractKind | null;
        limit: number;
    };
    exportedAt: string;
}

type ExportRecord = {
    occurredAt: string;
    envelope: TradingOutputEnvelope;
};

type ExportResolutionContext = {
    backtestRunId: string | null;
    indicatorInstanceId: string | null;
    tradeOutcomeBacktestRunId: string | null;
};

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;
const COMMAND_EVENT_TYPES = new Set<string>([
    SignalEventType.ENTRY_CONFIRMED,
    SignalEventType.MOVE_SL_BE,
    SignalEventType.TRAIL_START,
    SignalEventType.TRAIL_UPDATE,
    SignalEventType.TP1_HIT,
    SignalEventType.TP2_HIT,
    SignalEventType.STOP_HIT,
    SignalEventType.EXPIRATION,
]);

function buildSignalKey(code: string | null, version: number | null): string {
    if (!code) return 'unknown@v0';
    return `${code}@v${version ?? 0}`;
}

function classifyExecutionEventKind(eventType: string): 'command' | 'decision' {
    return COMMAND_EVENT_TYPES.has(eventType) ? 'command' : 'decision';
}

function getEnvelopeOccurredAt(envelope: TradingOutputEnvelope): string {
    const payload = envelope.payload as Record<string, unknown>;

    switch (envelope.contractKind) {
        case 'signal-event':
        case 'execution-event':
            return typeof payload.occurredAt === 'string' ? payload.occurredAt : envelope.emittedAt;
        case 'trade-outcome':
            return typeof payload.exitTime === 'string'
                ? payload.exitTime
                : typeof payload.entryTime === 'string'
                    ? payload.entryTime
                    : envelope.emittedAt;
        case 'investigation-outcome':
            return typeof payload.decidedAt === 'string' ? payload.decidedAt : envelope.emittedAt;
        default:
            return envelope.emittedAt;
    }
}

function compareExportRecordsDesc(left: ExportRecord, right: ExportRecord): number {
    const timeDiff = new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime();
    if (timeDiff !== 0) {
        return timeDiff;
    }

    const kindDiff = left.envelope.contractKind.localeCompare(right.envelope.contractKind);
    if (kindDiff !== 0) {
        return kindDiff;
    }

    return left.envelope.recordId.localeCompare(right.envelope.recordId);
}

export class TradingExportService {
    constructor(
        private readonly prisma: PrismaClient,
        private readonly contractService: TradingOutputContractService,
    ) {}

    async exportRecords(query: ExportRecordsQuery): Promise<ExportRecordsResult> {
        const limit = Math.min(Math.max(query.limit || DEFAULT_LIMIT, 1), MAX_LIMIT);
        const context = await this.resolveContext(query);
        const kinds = query.contractKind
            ? [query.contractKind]
            : (['signal-event', 'execution-event', 'trade-outcome', 'investigation-outcome'] as TradingOutputContractKind[]);

        const recordGroups = await Promise.all(
            kinds.map((kind) => this.fetchRecordsByKind(kind, context, limit)),
        );
        const combinedRecords = recordGroups
            .flat()
            .sort(compareExportRecordsDesc);

        return {
            records: combinedRecords.slice(0, limit).map((item) => item.envelope),
            total: combinedRecords.length,
            query: {
                backtestRunId: query.backtestRunId,
                indicatorInstanceId: query.indicatorInstanceId,
                contractKind: query.contractKind,
                limit,
            },
            exportedAt: new Date().toISOString(),
        };
    }

    private async resolveContext(query: ExportRecordsQuery): Promise<ExportResolutionContext> {
        if (query.backtestRunId) {
            return {
                backtestRunId: query.backtestRunId,
                indicatorInstanceId: query.indicatorInstanceId,
                tradeOutcomeBacktestRunId: query.backtestRunId,
            };
        }

        if (!query.indicatorInstanceId) {
            return {
                backtestRunId: null,
                indicatorInstanceId: null,
                tradeOutcomeBacktestRunId: null,
            };
        }

        const indicatorInstance = await this.prisma.indicatorInstance.findUnique({
            where: { id: query.indicatorInstanceId },
            select: { sourceBacktestRunId: true },
        });

        return {
            backtestRunId: null,
            indicatorInstanceId: query.indicatorInstanceId,
            tradeOutcomeBacktestRunId: indicatorInstance?.sourceBacktestRunId ?? null,
        };
    }

    private async fetchRecordsByKind(
        kind: TradingOutputContractKind,
        context: ExportResolutionContext,
        limit: number,
    ): Promise<ExportRecord[]> {
        switch (kind) {
            case 'signal-event':
                return this.fetchSignalEvents(context, limit);
            case 'execution-event':
                return this.fetchExecutionEvents(context, limit);
            case 'trade-outcome':
                return this.fetchTradeOutcomes(context, limit);
            case 'investigation-outcome':
                return this.fetchInvestigationOutcomes(context, limit);
            default:
                return [];
        }
    }

    private async fetchSignalEvents(
        context: ExportResolutionContext,
        limit: number,
    ): Promise<ExportRecord[]> {
        const where: Record<string, unknown> = {};
        if (context.backtestRunId) where.backtestRunId = context.backtestRunId;
        if (context.indicatorInstanceId) where.indicatorInstanceId = context.indicatorInstanceId;

        const events = await this.prisma.signalEvent.findMany({
            where,
            include: {
                signal: {
                    select: {
                        id: true,
                        definitionCode: true,
                        definitionVersion: true,
                        symbol: true,
                        timeframe: true,
                        side: true,
                        session: true,
                    },
                },
                indicatorInstance: {
                    select: {
                        id: true,
                        signalCode: true,
                        signalVersion: true,
                        symbol: true,
                        timeframe: true,
                    },
                },
            },
            orderBy: [
                { candleTime: 'desc' },
                { createdAt: 'desc' },
            ],
            take: limit,
        });

        const envelopes: ExportRecord[] = [];
        for (const event of events) {
            const signal = event.signal;
            const indicatorInstance = event.indicatorInstance;
            if (!signal && !indicatorInstance) continue;

            const signalCode = signal?.definitionCode ?? indicatorInstance?.signalCode ?? 'unknown';
            const signalVersion = signal?.definitionVersion ?? indicatorInstance?.signalVersion ?? 0;
            const signalKey = buildSignalKey(signalCode, signalVersion);

            try {
                const envelope = this.contractService.shapeSignalEventEnvelope(event.id, signalKey, {
                    signalCode,
                    signalVersion,
                    signalId: signal?.id ?? `indicator-instance:${indicatorInstance?.id ?? 'unknown'}`,
                    symbol: signal?.symbol ?? indicatorInstance?.symbol ?? 'UNKNOWN',
                    timeframe: signal?.timeframe ?? indicatorInstance?.timeframe ?? 'UNKNOWN',
                    side: signal?.side ?? 'UNKNOWN',
                    session: signal?.session ?? 'UNKNOWN',
                    eventType: event.eventType,
                    occurredAt: event.candleTime.toISOString(),
                    backtestRunId: event.backtestRunId ?? null,
                    indicatorInstanceId: event.indicatorInstanceId ?? null,
                });

                envelopes.push({
                    occurredAt: getEnvelopeOccurredAt(envelope),
                    envelope,
                });
            } catch {
                // Skip records that fail sanitization
            }
        }

        return envelopes;
    }

    private async fetchExecutionEvents(
        context: ExportResolutionContext,
        limit: number,
    ): Promise<ExportRecord[]> {
        const where: Record<string, unknown> = {};
        if (context.backtestRunId) where.backtestRunId = context.backtestRunId;
        if (context.indicatorInstanceId) where.indicatorInstanceId = context.indicatorInstanceId;

        const traces = await this.prisma.signalLogicTrace.findMany({
            where,
            include: {
                signal: {
                    select: {
                        definitionCode: true,
                        definitionVersion: true,
                    },
                },
                indicatorInstance: {
                    select: {
                        signalCode: true,
                        signalVersion: true,
                    },
                },
            },
            orderBy: [
                { candleTime: 'desc' },
                { createdAt: 'desc' },
            ],
            take: limit,
        });

        const envelopes: ExportRecord[] = [];
        for (const trace of traces) {
            const code = trace.signal?.definitionCode ?? trace.indicatorInstance?.signalCode ?? 'unknown';
            const version = trace.signal?.definitionVersion ?? trace.indicatorInstance?.signalVersion ?? 0;
            const signalKey = buildSignalKey(code, version);

            try {
                const envelope = this.contractService.shapeExecutionEventEnvelope(trace.id, signalKey, {
                    signalCode: code,
                    signalVersion: version,
                    eventType: trace.eventType,
                    kind: classifyExecutionEventKind(trace.eventType),
                    occurredAt: trace.candleTime.toISOString(),
                    label: trace.notes ?? null,
                    stateBefore: trace.stateBefore ?? null,
                    stateAfter: trace.stateAfter ?? null,
                    backtestRunId: trace.backtestRunId ?? null,
                    indicatorInstanceId: trace.indicatorInstanceId ?? null,
                    tradeRecordId: null,
                });

                envelopes.push({
                    occurredAt: getEnvelopeOccurredAt(envelope),
                    envelope,
                });
            } catch {
                // Skip records that fail sanitization
            }
        }

        return envelopes;
    }

    private async fetchTradeOutcomes(
        context: ExportResolutionContext,
        limit: number,
    ): Promise<ExportRecord[]> {
        if (context.indicatorInstanceId && !context.tradeOutcomeBacktestRunId) {
            return [];
        }

        const where: Record<string, unknown> = {};
        if (context.tradeOutcomeBacktestRunId) {
            where.backtestRunId = context.tradeOutcomeBacktestRunId;
        }

        const results = await this.prisma.backtestTradeResult.findMany({
            where,
            include: {
                signal: {
                    select: {
                        definitionCode: true,
                        definitionVersion: true,
                        symbol: true,
                        timeframe: true,
                        side: true,
                        entryTime: true,
                    },
                },
                exitRule: {
                    select: { code: true },
                },
            },
            orderBy: [
                { exitTime: 'desc' },
                { createdAt: 'desc' },
            ],
            take: limit,
        });

        const envelopes: ExportRecord[] = [];
        for (const result of results) {
            const signal = result.signal;
            const code = signal?.definitionCode ?? 'unknown';
            const version = signal?.definitionVersion ?? 0;
            const signalKey = buildSignalKey(code, version);

            const outcomeResult = result.isOpen
                ? 'ACTIVE'
                : result.win
                    ? 'WIN'
                    : parseFloat(result.pnlUsd.toString()) === 0
                        ? 'BE'
                        : 'LOSS';

            try {
                const envelope = this.contractService.shapeTradeOutcomeEnvelope(result.id, signalKey, {
                    signalCode: code,
                    signalVersion: version,
                    symbol: signal?.symbol ?? 'UNKNOWN',
                    timeframe: signal?.timeframe ?? 'UNKNOWN',
                    side: result.resultSide,
                    result: outcomeResult,
                    exitReason: result.exitReason,
                    rMultiple: parseFloat(result.rMultiple.toString()),
                    pnlUsd: parseFloat(result.pnlUsd.toString()),
                    entryTime: signal?.entryTime?.toISOString() ?? new Date(0).toISOString(),
                    exitTime: result.exitTime?.toISOString() ?? null,
                    backtestRunId: result.backtestRunId,
                    tradeRecordId: result.id,
                });

                envelopes.push({
                    occurredAt: getEnvelopeOccurredAt(envelope),
                    envelope,
                });
            } catch {
                // Skip records that fail sanitization
            }
        }

        return envelopes;
    }

    private async fetchInvestigationOutcomes(
        context: ExportResolutionContext,
        limit: number,
    ): Promise<ExportRecord[]> {
        const where: Record<string, unknown> = {};
        if (context.backtestRunId) where.backtestRunId = context.backtestRunId;
        if (context.indicatorInstanceId) where.indicatorInstanceId = context.indicatorInstanceId;

        const outcomes = await this.prisma.tradingInvestigationOutcomeRecord.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: limit,
        });

        const rootCauseMap: Record<string, 'data-quality' | 'signal-logic' | 'risk-settings' | 'broker-execution'> = {
            DATA_QUALITY: 'data-quality',
            SIGNAL_LOGIC: 'signal-logic',
            RISK_SETTINGS: 'risk-settings',
            BROKER_EXECUTION: 'broker-execution',
        };

        const outcomeMap: Record<string, 'resolved' | 'mitigated' | 'escalated'> = {
            RESOLVED: 'resolved',
            MITIGATED: 'mitigated',
            ESCALATED: 'escalated',
        };

        const envelopes: ExportRecord[] = [];
        for (const outcome of outcomes) {
            const signalKey = buildSignalKey(outcome.signalCode, outcome.signalVersion);
            const rootCauseCategory = rootCauseMap[outcome.rootCause];
            const normalizedOutcome = outcomeMap[outcome.outcome];

            if (!rootCauseCategory || !normalizedOutcome) {
                continue;
            }

            try {
                const envelope = this.contractService.shapeInvestigationOutcomeEnvelope(outcome.id, signalKey, {
                    signalCode: outcome.signalCode,
                    signalVersion: outcome.signalVersion,
                    rootCauseCategory,
                    outcome: normalizedOutcome,
                    summary: outcome.summary ?? null,
                    decidedAt: outcome.createdAt.toISOString(),
                    backtestRunId: outcome.backtestRunId ?? null,
                    indicatorInstanceId: outcome.indicatorInstanceId ?? null,
                    tradeRecordId: outcome.tradeRecordId ?? null,
                });

                envelopes.push({
                    occurredAt: getEnvelopeOccurredAt(envelope),
                    envelope,
                });
            } catch {
                // Skip records that fail sanitization
            }
        }

        return envelopes;
    }
}
