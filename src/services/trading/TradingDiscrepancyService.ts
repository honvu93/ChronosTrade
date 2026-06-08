import { Prisma, PrismaClient, SignalEventType } from '@prisma/client';
import { EngineAnalyticsService } from '../EngineAnalyticsService';
import {
    TradeHistoryAuditDetailSnapshot,
    TradeHistoryAuditResult,
    TradeHistoryAuditTimelineItem,
    TradeHistoryAuditTimelineKind,
    TradeHistoryAuditTimelineSummary,
    TradingAuditService,
} from './TradingAuditService';

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

const backtestRunSelect = Prisma.validator<Prisma.BacktestRunSelect>()({
    id: true,
    name: true,
    status: true,
    signalCode: true,
    signalVersion: true,
    symbol: true,
    timeframe: true,
    parametersJson: true,
    executionConfigJson: true,
    createdAt: true,
});

const indicatorInstanceSelect = Prisma.validator<Prisma.IndicatorInstanceSelect>()({
    id: true,
    name: true,
    status: true,
    signalCode: true,
    signalVersion: true,
    symbol: true,
    timeframe: true,
    sourceBacktestRunId: true,
    startedAt: true,
    updatedAt: true,
    lastProcessedCandleTime: true,
    lastEmittedEventTime: true,
    errorMessage: true,
    parameterJson: true,
    executionConfigJson: true,
});

const signalEventSelect = Prisma.validator<Prisma.SignalEventSelect>()({
    id: true,
    indicatorInstanceId: true,
    eventType: true,
    candleTime: true,
    price: true,
    label: true,
    metaJson: true,
    createdAt: true,
});

const signalTraceSelect = Prisma.validator<Prisma.SignalLogicTraceSelect>()({
    id: true,
    indicatorInstanceId: true,
    signalEventId: true,
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
});

type BacktestRunRecord = Prisma.BacktestRunGetPayload<{ select: typeof backtestRunSelect }>;
type IndicatorInstanceRecord = Prisma.IndicatorInstanceGetPayload<{ select: typeof indicatorInstanceSelect }>;
type SignalEventRecord = Prisma.SignalEventGetPayload<{ select: typeof signalEventSelect }>;
type SignalTraceRecord = Prisma.SignalLogicTraceGetPayload<{ select: typeof signalTraceSelect }>;

type InvestigationKind = 'alert-driven' | 'reported-issue' | 'mixed-context';
type DiscrepancySeverity = 'critical' | 'warning' | 'info';
type MatchReason = 'exact' | 'source-run' | 'market-context' | 'signal-version';

interface TradingDiscrepancyOverviewResult {
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

interface TradingDiscrepancySignalReviewRow {
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
    latestExitTime: Date | null;
}

interface TradingDiscrepancyAnalytics {
    getOverview: (filters: { backtestRunId: string }) => Promise<TradingDiscrepancyOverviewResult | null>;
    getSignalReview: (filters: { backtestRunId: string; signalId: string }) => Promise<TradingDiscrepancySignalReviewRow[]>;
}

export interface TradingDiscrepancyLookupInput {
    code: string;
    version: number;
    backtestRunId?: string | null;
    indicatorInstanceId?: string | null;
    tradeRecordId?: string | null;
}

export interface TradingDiscrepancyInsight {
    code: string;
    severity: DiscrepancySeverity;
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
    matchedBy: MatchReason;
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
    investigationKind: InvestigationKind;
    signalCode: string;
    signalVersion: number;
    signalName: string | null;
    linkedRecords: TradingDiscrepancyLinkedRecords;
    backtest: TradingDiscrepancyBacktestContext | null;
    live: TradingDiscrepancyLiveContext;
    discrepancies: TradingDiscrepancyInsight[];
    evaluatedAt: string;
}

interface DeploymentTimelineContext {
    instance: IndicatorInstanceRecord;
    matchedBy: MatchReason;
    timeline: TradeHistoryAuditTimelineItem[];
    summary: TradeHistoryAuditTimelineSummary;
}

const toIso = (value: Date | null | undefined): string | null => value ? value.toISOString() : null;

const toNumber = (value: Prisma.Decimal | number | string | null | undefined): number => {
    if (value === null || value === undefined) return 0;
    return Number(value);
};

const round = (value: number, digits = 2): number => Number(value.toFixed(digits));
const stringifyCompact = (value: unknown): string => value === null || value === undefined ? 'n/a' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const formatSigned = (value: number, suffix = '') => `${value >= 0 ? '+' : ''}${value.toFixed(2)}${suffix}`;

const formatKeyValueSummary = (value: Record<string, unknown> | null, keys: string[]) => {
    if (!value || keys.length === 0) {
        return null;
    }

    return keys.map((key) => `${key}=${stringifyCompact(value[key])}`).join(', ');
};

const scoreMatchReason = (reason: MatchReason) => {
    switch (reason) {
        case 'exact':
            return 0;
        case 'source-run':
            return 1;
        case 'market-context':
            return 2;
        case 'signal-version':
        default:
            return 3;
    }
};

const mapExitReasonToEventType = (exitReason: string): SignalEventType | null => {
    switch (exitReason) {
        case 'TAKE_PROFIT_1':
            return SignalEventType.TP1_HIT;
        case 'TAKE_PROFIT_2':
            return SignalEventType.TP2_HIT;
        case 'STOP_LOSS':
            return SignalEventType.STOP_HIT;
        case 'EXPIRATION':
            return SignalEventType.EXPIRATION;
        default:
            return null;
    }
};

const findLatestCommandTimelineItem = (timeline: TradeHistoryAuditTimelineItem[]) =>
    [...timeline].reverse().find((item) => item.kind === 'command') ?? null;

export class TradingDiscrepancyService {
    constructor(
        private prisma: PrismaClient,
        private analytics: TradingDiscrepancyAnalytics = new EngineAnalyticsService(prisma) as TradingDiscrepancyAnalytics,
        private auditHistory: Pick<TradingAuditService, 'getHistoryDetail'> = new TradingAuditService(prisma),
    ) {}

    public async getSnapshot(input: TradingDiscrepancyLookupInput): Promise<TradingDiscrepancySnapshot | null> {
        const signalDefinition = await this.prisma.signalDefinition.findUnique({
            where: { code_version: { code: input.code, version: input.version } },
            select: {
                code: true,
                version: true,
                name: true,
            },
        });

        const tradeDetail = input.tradeRecordId ? await this.loadTradeIssue(input) : null;
        if (input.tradeRecordId && !tradeDetail) {
            return null;
        }

        const exactIndicator = input.indicatorInstanceId
            ? await this.prisma.indicatorInstance.findFirst({
                where: {
                    id: input.indicatorInstanceId,
                    signalCode: input.code,
                    signalVersion: input.version,
                },
                select: indicatorInstanceSelect,
            })
            : null;

        if (input.indicatorInstanceId && !exactIndicator) {
            return null;
        }

        const requestedBacktestRunId = tradeDetail?.record.backtestRunId
            ?? input.backtestRunId
            ?? exactIndicator?.sourceBacktestRunId
            ?? null;

        const backtestRun = requestedBacktestRunId
            ? await this.prisma.backtestRun.findFirst({
                where: {
                    id: requestedBacktestRunId,
                    signalCode: input.code,
                    signalVersion: input.version,
                },
                select: backtestRunSelect,
            })
            : await this.findPreferredBacktestRun(input.code, input.version);

        if (requestedBacktestRunId && !backtestRun) {
            return null;
        }

        const reportSummary = backtestRun ? await this.loadReportSummary(backtestRun.id) : null;
        const signalReview = backtestRun && tradeDetail?.record.signalId
            ? await this.loadSignalReview(backtestRun.id, tradeDetail.record.signalId)
            : null;

        const deployments = await this.loadDeploymentContexts({
            code: input.code,
            version: input.version,
            backtestRun,
            tradeDetail,
            exactIndicator,
        });

        if (!backtestRun && deployments.length === 0) {
            return null;
        }

        const primaryDeployment = deployments[0] ?? null;
        const reportPath = backtestRun ? this.buildReportPath(backtestRun.id, tradeDetail?.record.signalId ?? null) : null;
        const recentTimeline = primaryDeployment ? primaryDeployment.timeline.slice(-8) : [];

        return {
            investigationKind: this.classifyInvestigationKind(input),
            signalCode: input.code,
            signalVersion: input.version,
            signalName: signalDefinition?.name ?? null,
            linkedRecords: {
                signalKey: `${input.code}@v${input.version}`,
                backtestRunId: backtestRun?.id ?? null,
                tradeRecordId: tradeDetail?.record.recordId ?? null,
                signalId: tradeDetail?.record.signalId ?? null,
                primaryIndicatorInstanceId: primaryDeployment?.instance.id ?? null,
                deploymentRecordIds: deployments.map((deployment) => deployment.instance.id),
                commandRecordIds: recentTimeline.filter((item) => item.kind === 'command').map((item) => item.id),
                reportPath,
            },
            backtest: backtestRun ? {
                runId: backtestRun.id,
                runName: backtestRun.name,
                runStatus: backtestRun.status,
                symbol: backtestRun.symbol,
                timeframe: backtestRun.timeframe,
                parametersJson: (backtestRun.parametersJson ?? null) as Record<string, unknown> | null,
                executionConfigJson: (backtestRun.executionConfigJson ?? null) as Record<string, unknown> | null,
                reportSummary,
                signalReview,
                tradeIssue: tradeDetail ? this.serializeTradeIssue(tradeDetail) : null,
            } : null,
            live: {
                primaryIndicatorInstanceId: primaryDeployment?.instance.id ?? null,
                deployments: deployments.map((deployment) => this.serializeDeployment(deployment)),
                timelineSummary: primaryDeployment?.summary ?? null,
                recentTimeline,
            },
            discrepancies: this.buildDiscrepancies({
                backtestRun,
                reportSummary,
                tradeDetail,
                primaryDeployment,
            }),
            evaluatedAt: new Date().toISOString(),
        };
    }

    private async loadTradeIssue(input: TradingDiscrepancyLookupInput): Promise<TradeHistoryAuditDetailSnapshot | null> {
        const detail = await this.auditHistory.getHistoryDetail(input.tradeRecordId ?? '');
        if (!detail) {
            return null;
        }

        if (detail.record.signalCode !== input.code || detail.record.signalVersion !== input.version) {
            return null;
        }

        return detail;
    }

    private async findPreferredBacktestRun(code: string, version: number): Promise<BacktestRunRecord | null> {
        const completed = await this.prisma.backtestRun.findFirst({
            where: { signalCode: code, signalVersion: version, status: 'COMPLETED' },
            select: backtestRunSelect,
            orderBy: { createdAt: 'desc' },
        });

        return completed ?? await this.prisma.backtestRun.findFirst({
            where: { signalCode: code, signalVersion: version },
            select: backtestRunSelect,
            orderBy: { createdAt: 'desc' },
        });
    }

    private async loadReportSummary(backtestRunId: string): Promise<TradingDiscrepancyReportSummary | null> {
        const overview = await this.analytics.getOverview({ backtestRunId });
        if (!overview) {
            return null;
        }

        return {
            signalCount: overview.metrics.signalCount,
            totalTrades: overview.metrics.totalTrades,
            closedTrades: overview.metrics.closedTrades,
            openTrades: overview.metrics.openTrades,
            wins: overview.metrics.wins,
            losses: overview.metrics.losses,
            winRate: overview.metrics.winRate,
            profitFactor: overview.metrics.profitFactor,
            expectancy: overview.metrics.expectancy,
            netR: overview.metrics.netR,
            netUsd: overview.metrics.netUsd,
            maxConsecutiveLoss: overview.metrics.maxConsecutiveLoss,
            maxDrawdownPct: overview.metrics.maxDrawdownPct,
        };
    }

    private async loadSignalReview(backtestRunId: string, signalId: string): Promise<TradingDiscrepancySignalReview | null> {
        const rows = await this.analytics.getSignalReview({ backtestRunId, signalId });
        const row = rows[0];
        if (!row) {
            return null;
        }

        return {
            signalId: row.signalId,
            symbol: row.symbol,
            timeframe: row.timeframe,
            side: row.side,
            session: row.session,
            strategyCode: row.strategyCode,
            strategyName: row.strategyName,
            resultCount: row.resultCount,
            wins: row.wins,
            losses: row.losses,
            openResults: row.openResults,
            netR: row.netR,
            avgR: row.avgR,
            bestExitRuleCode: row.bestExitRuleCode ?? null,
            bestExitRuleName: row.bestExitRuleName ?? null,
            latestExitTime: toIso(row.latestExitTime),
        };
    }

    private async loadDeploymentContexts({
        code,
        version,
        backtestRun,
        tradeDetail,
        exactIndicator,
    }: {
        code: string;
        version: number;
        backtestRun: BacktestRunRecord | null;
        tradeDetail: TradeHistoryAuditDetailSnapshot | null;
        exactIndicator: IndicatorInstanceRecord | null;
    }): Promise<DeploymentTimelineContext[]> {
        const instances = await this.prisma.indicatorInstance.findMany({
            where: {
                signalCode: code,
                signalVersion: version,
            },
            select: indicatorInstanceSelect,
            orderBy: { updatedAt: 'desc' },
            take: 8,
        });

        const deduped = new Map<string, IndicatorInstanceRecord>();
        for (const instance of exactIndicator ? [exactIndicator, ...instances] : instances) {
            deduped.set(instance.id, instance);
        }

        const marketSymbol = tradeDetail?.record.symbol ?? backtestRun?.symbol ?? null;
        const marketTimeframe = tradeDetail?.record.timeframe ?? backtestRun?.timeframe ?? null;
        const ordered = Array.from(deduped.values())
            .map((instance) => ({
                instance,
                matchedBy: this.matchDeployment({
                    instance,
                    exactIndicatorId: exactIndicator?.id ?? null,
                    backtestRunId: backtestRun?.id ?? null,
                    marketSymbol,
                    marketTimeframe,
                }),
            }))
            .sort((left, right) => {
                const score = scoreMatchReason(left.matchedBy) - scoreMatchReason(right.matchedBy);
                if (score !== 0) {
                    return score;
                }

                return right.instance.updatedAt.getTime() - left.instance.updatedAt.getTime();
            });

        if (ordered.length === 0) {
            return [];
        }

        const instanceIds = ordered.map((item) => item.instance.id);
        const [events, traces] = await Promise.all([
            this.prisma.signalEvent.findMany({
                where: {
                    indicatorInstanceId: { in: instanceIds },
                },
                select: signalEventSelect,
            }),
            this.prisma.signalLogicTrace.findMany({
                where: {
                    indicatorInstanceId: { in: instanceIds },
                },
                select: signalTraceSelect,
            }),
        ]);

        const eventsByInstance = new Map<string, SignalEventRecord[]>();
        const tracesByInstance = new Map<string, SignalTraceRecord[]>();

        for (const event of events) {
            if (!event.indicatorInstanceId) continue;
            const list = eventsByInstance.get(event.indicatorInstanceId) ?? [];
            list.push(event);
            eventsByInstance.set(event.indicatorInstanceId, list);
        }

        for (const trace of traces) {
            if (!trace.indicatorInstanceId) continue;
            const list = tracesByInstance.get(trace.indicatorInstanceId) ?? [];
            list.push(trace);
            tracesByInstance.set(trace.indicatorInstanceId, list);
        }

        return ordered.map(({ instance, matchedBy }) => {
            const timeline = this.buildTimeline(
                eventsByInstance.get(instance.id) ?? [],
                tracesByInstance.get(instance.id) ?? [],
            );

            return {
                instance,
                matchedBy,
                timeline,
                summary: this.buildTimelineSummary(timeline),
            };
        });
    }

    private matchDeployment({
        instance,
        exactIndicatorId,
        backtestRunId,
        marketSymbol,
        marketTimeframe,
    }: {
        instance: IndicatorInstanceRecord;
        exactIndicatorId: string | null;
        backtestRunId: string | null;
        marketSymbol: string | null;
        marketTimeframe: string | null;
    }): MatchReason {
        if (exactIndicatorId && instance.id === exactIndicatorId) {
            return 'exact';
        }

        if (backtestRunId && instance.sourceBacktestRunId === backtestRunId) {
            return 'source-run';
        }

        if (marketSymbol && marketTimeframe && instance.symbol === marketSymbol && instance.timeframe === marketTimeframe) {
            return 'market-context';
        }

        return 'signal-version';
    }

    private buildTimeline(events: SignalEventRecord[], traces: SignalTraceRecord[]): TradeHistoryAuditTimelineItem[] {
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

    private buildTimelineSummary(timeline: TradeHistoryAuditTimelineItem[]): TradeHistoryAuditTimelineSummary {
        const commandEvents = timeline.filter((item) => item.kind === 'command').length;
        const decisionEvents = timeline.length - commandEvents;

        return {
            totalItems: timeline.length,
            commandEvents,
            decisionEvents,
            firstOccurredAt: timeline[0]?.occurredAt ?? null,
            lastOccurredAt: timeline.at(-1)?.occurredAt ?? null,
        };
    }

    private classifyTimelineKind(eventType: SignalEventType | string): TradeHistoryAuditTimelineKind {
        return COMMAND_EVENT_TYPES.has(eventType as SignalEventType) ? 'command' : 'decision';
    }

    private serializeTradeIssue(detail: TradeHistoryAuditDetailSnapshot): TradingDiscrepancyTradeIssue {
        return {
            recordId: detail.record.recordId,
            rowId: detail.record.rowId,
            signalId: detail.record.signalId,
            exitRuleCode: detail.record.exitRuleCode,
            exitRuleName: detail.record.exitRuleName,
            result: detail.record.result,
            exitReason: detail.record.exitReason,
            rMultiple: detail.record.rMultiple,
            pnlUsd: detail.record.pnlUsd,
            entryTime: detail.record.entryTime,
            exitTime: detail.record.exitTime,
            auditCommandRecords: detail.timelineSummary.commandEvents,
            auditDecisionRecords: detail.timelineSummary.decisionEvents,
            auditLatestAt: detail.timelineSummary.lastOccurredAt,
        };
    }

    private serializeDeployment(context: DeploymentTimelineContext): TradingDiscrepancyDeploymentContext {
        const latest = context.timeline.at(-1) ?? null;

        return {
            indicatorInstanceId: context.instance.id,
            name: context.instance.name,
            status: context.instance.status,
            symbol: context.instance.symbol,
            timeframe: context.instance.timeframe,
            matchedBy: context.matchedBy,
            sourceBacktestRunId: context.instance.sourceBacktestRunId ?? null,
            startedAt: toIso(context.instance.startedAt),
            updatedAt: context.instance.updatedAt.toISOString(),
            lastProcessedCandleTime: toIso(context.instance.lastProcessedCandleTime),
            lastEmittedEventTime: toIso(context.instance.lastEmittedEventTime),
            errorMessage: context.instance.errorMessage ?? null,
            parameterJson: context.instance.parameterJson as Record<string, unknown>,
            executionConfigJson: (context.instance.executionConfigJson ?? null) as Record<string, unknown> | null,
            commandRecordCount: context.summary.commandEvents,
            decisionRecordCount: context.summary.decisionEvents,
            latestRecordId: latest?.id ?? null,
            latestEventType: latest?.eventType ?? null,
            latestOccurredAt: latest?.occurredAt ?? null,
            latestLabel: latest?.label ?? null,
        };
    }

    private buildDiscrepancies({
        backtestRun,
        reportSummary,
        tradeDetail,
        primaryDeployment,
    }: {
        backtestRun: BacktestRunRecord | null;
        reportSummary: TradingDiscrepancyReportSummary | null;
        tradeDetail: TradeHistoryAuditDetailSnapshot | null;
        primaryDeployment: DeploymentTimelineContext | null;
    }): TradingDiscrepancyInsight[] {
        const discrepancies: TradingDiscrepancyInsight[] = [];

        if (backtestRun && !primaryDeployment) {
            discrepancies.push({
                code: 'missing-live-deployment',
                severity: 'warning',
                title: 'No live deployment is linked to the investigated validation context.',
                detail: 'The platform found validation evidence, but no current live deployment for the same signal version.',
                backtestValue: backtestRun.name,
                liveValue: 'No deployment linked',
            });
            return discrepancies;
        }

        if (!backtestRun || !primaryDeployment) {
            return discrepancies;
        }

        const backtestParams = (backtestRun.parametersJson ?? null) as Record<string, unknown> | null;
        const liveParams = primaryDeployment.instance.parameterJson as Record<string, unknown>;
        const parameterDiffKeys = this.diffJsonKeys(backtestParams, liveParams);
        if (parameterDiffKeys.length > 0) {
            discrepancies.push({
                code: 'parameter-drift',
                severity: 'warning',
                title: 'Live parameters drifted from the validation run.',
                detail: `Changed keys: ${parameterDiffKeys.join(', ')}.`,
                backtestValue: formatKeyValueSummary(backtestParams, parameterDiffKeys),
                liveValue: formatKeyValueSummary(liveParams, parameterDiffKeys),
            });
        }

        const backtestConfig = (backtestRun.executionConfigJson ?? null) as Record<string, unknown> | null;
        const liveConfig = (primaryDeployment.instance.executionConfigJson ?? null) as Record<string, unknown> | null;
        const executionDiffKeys = this.diffJsonKeys(backtestConfig, liveConfig);
        if (executionDiffKeys.length > 0) {
            discrepancies.push({
                code: 'execution-config-drift',
                severity: 'warning',
                title: 'Live execution configuration drifted from the validation run.',
                detail: `Changed keys: ${executionDiffKeys.join(', ')}.`,
                backtestValue: formatKeyValueSummary(backtestConfig, executionDiffKeys),
                liveValue: formatKeyValueSummary(liveConfig, executionDiffKeys),
            });
        }

        if (primaryDeployment.instance.symbol !== backtestRun.symbol || primaryDeployment.instance.timeframe !== backtestRun.timeframe) {
            discrepancies.push({
                code: 'market-context-drift',
                severity: 'warning',
                title: 'Live deployment is running in a different market context.',
                detail: 'The live deployment symbol/timeframe no longer matches the linked validation run.',
                backtestValue: `${backtestRun.symbol} / ${backtestRun.timeframe}`,
                liveValue: `${primaryDeployment.instance.symbol} / ${primaryDeployment.instance.timeframe}`,
            });
        }

        if (!primaryDeployment.instance.sourceBacktestRunId) {
            discrepancies.push({
                code: 'missing-source-link',
                severity: 'warning',
                title: 'Live deployment is missing a direct source-backtest link.',
                detail: 'Traceability remains possible through signal version and market context, but the explicit source run is missing.',
                backtestValue: backtestRun.id,
                liveValue: 'No sourceBacktestRunId',
            });
        }

        if (primaryDeployment.instance.status !== 'ACTIVE') {
            discrepancies.push({
                code: 'live-status-failed',
                severity: primaryDeployment.instance.status === 'FAILED' ? 'critical' : 'warning',
                title: 'Live deployment status diverged from the validated run.',
                detail: primaryDeployment.instance.errorMessage
                    ? primaryDeployment.instance.errorMessage
                    : `Live deployment is currently ${primaryDeployment.instance.status}.`,
                backtestValue: backtestRun.status,
                liveValue: primaryDeployment.instance.status,
            });
        }

        if (reportSummary && reportSummary.totalTrades > 0 && primaryDeployment.summary.commandEvents === 0) {
            discrepancies.push({
                code: 'activity-gap',
                severity: 'warning',
                title: 'Validation produced trades, but the live deployment has no command records yet.',
                detail: 'This may indicate a market-condition gap, stalled runtime, or missing event linkage.',
                backtestValue: `${reportSummary.totalTrades} validation trades`,
                liveValue: '0 command records',
            });
        }

        if (tradeDetail) {
            const expectedTerminal = mapExitReasonToEventType(tradeDetail.record.exitReason);
            const latestCommand = findLatestCommandTimelineItem(primaryDeployment.timeline);
            const latestEventType = latestCommand?.eventType ?? null;
            if (expectedTerminal && latestEventType && latestEventType !== expectedTerminal) {
                discrepancies.push({
                    code: 'outcome-drift',
                    severity: 'critical',
                    title: 'Historical outcome differs from the latest live execution outcome.',
                    detail: 'The investigated trade closed differently in validation than the latest linked live command record.',
                    backtestValue: `${tradeDetail.record.exitRuleCode} | ${formatSigned(tradeDetail.record.rMultiple, 'R')}`,
                    liveValue: `${latestEventType} | ${primaryDeployment.instance.status}`,
                });
            }
        }

        return discrepancies;
    }

    private diffJsonKeys(left: Record<string, unknown> | null, right: Record<string, unknown> | null): string[] {
        const keys = new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})]);
        return Array.from(keys).filter((key) =>
            JSON.stringify(left?.[key] ?? null) !== JSON.stringify(right?.[key] ?? null),
        );
    }

    private buildReportPath(backtestRunId: string, signalId: string | null) {
        const params = new URLSearchParams();
        params.set('backtestRunId', backtestRunId);
        if (signalId) {
            params.set('signalId', signalId);
        }

        return `/reports?${params.toString()}`;
    }

    private classifyInvestigationKind(input: TradingDiscrepancyLookupInput): InvestigationKind {
        if (input.tradeRecordId && (input.backtestRunId || input.indicatorInstanceId)) {
            return 'mixed-context';
        }

        if (input.tradeRecordId) {
            return 'reported-issue';
        }

        return 'alert-driven';
    }
}
