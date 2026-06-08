import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { TradingDiscrepancyService } from './TradingDiscrepancyService';

function makeBacktestRun(overrides: Partial<{
    id: string;
    name: string;
    status: string;
    signalCode: string | null;
    signalVersion: number | null;
    symbol: string;
    timeframe: string;
    parametersJson: Record<string, unknown> | null;
    executionConfigJson: Record<string, unknown> | null;
    createdAt: Date;
}> = {}) {
    return {
        id: 'run-1',
        name: 'Song Trap Validation',
        status: 'COMPLETED',
        signalCode: 'songTrap',
        signalVersion: 3,
        symbol: 'XAUUSD',
        timeframe: 'H1',
        parametersJson: { lookback: 20, threshold: 1.4 },
        executionConfigJson: { orderTiming: 'CLOSE', slippageTicks: 2 },
        createdAt: new Date('2026-03-09T00:00:00Z'),
        ...overrides,
    };
}

function makeIndicatorInstance(overrides: Partial<{
    id: string;
    name: string;
    status: string;
    signalCode: string;
    signalVersion: number;
    symbol: string;
    timeframe: string;
    sourceBacktestRunId: string | null;
    startedAt: Date | null;
    updatedAt: Date;
    lastProcessedCandleTime: Date | null;
    lastEmittedEventTime: Date | null;
    errorMessage: string | null;
    parameterJson: Record<string, unknown>;
    executionConfigJson: Record<string, unknown> | null;
}> = {}) {
    return {
        id: 'inst-1',
        name: 'Song Trap Live',
        status: 'FAILED',
        signalCode: 'songTrap',
        signalVersion: 3,
        symbol: 'XAUUSD',
        timeframe: 'H1',
        sourceBacktestRunId: 'run-1',
        startedAt: new Date('2026-03-10T00:00:00Z'),
        updatedAt: new Date('2026-03-10T10:05:00Z'),
        lastProcessedCandleTime: new Date('2026-03-10T10:00:00Z'),
        lastEmittedEventTime: new Date('2026-03-10T09:59:00Z'),
        errorMessage: 'Broker rejected the trailing stop update.',
        parameterJson: { lookback: 24, threshold: 1.4 },
        executionConfigJson: { orderTiming: 'OPEN', slippageTicks: 2 },
        ...overrides,
    };
}

function makeEvent(overrides: Partial<{
    id: string;
    signalId: string | null;
    indicatorInstanceId: string | null;
    backtestRunId: string | null;
    eventType: string;
    candleTime: Date;
    price: number | null;
    label: string | null;
    metaJson: unknown | null;
    createdAt: Date;
}> = {}) {
    return {
        id: 'event-live-stop',
        signalId: null,
        indicatorInstanceId: 'inst-1',
        backtestRunId: null,
        eventType: 'STOP_HIT',
        candleTime: new Date('2026-03-10T09:59:00Z'),
        price: 3218.4,
        label: 'Stop loss executed',
        metaJson: { orderId: 'mt5-42' },
        createdAt: new Date('2026-03-10T09:59:01Z'),
        ...overrides,
    };
}

function makeTrace(overrides: Partial<{
    id: string;
    signalId: string | null;
    indicatorInstanceId: string | null;
    signalEventId: string | null;
    backtestRunId: string | null;
    eventType: string;
    candleTime: Date;
    stateBefore: string | null;
    stateAfter: string | null;
    ruleId: string | null;
    indicatorJson: unknown | null;
    thresholdJson: unknown | null;
    priceJson: unknown | null;
    notes: string | null;
    createdAt: Date;
}> = {}) {
    return {
        id: 'trace-live-decision',
        signalId: null,
        indicatorInstanceId: 'inst-1',
        signalEventId: 'event-live-stop',
        backtestRunId: null,
        eventType: 'TRAP',
        candleTime: new Date('2026-03-10T09:58:00Z'),
        stateBefore: 'ENTERED',
        stateAfter: 'STOP_PENDING',
        ruleId: 'risk-stop',
        indicatorJson: { fastEma: 12, slowEma: 21 },
        thresholdJson: { threshold: 1.4 },
        priceJson: { close: 3218.4 },
        notes: 'Momentum reversed before target.',
        createdAt: new Date('2026-03-10T09:58:01Z'),
        ...overrides,
    };
}

function makeTradeDetail(overrides: Partial<{
    recordId: string;
    signalId: string;
    backtestRunId: string;
    exitRuleCode: string;
    exitRuleName: string;
    result: 'WIN' | 'LOSS' | 'ACTIVE' | 'BE';
    exitReason: string;
    rMultiple: number;
    pnlUsd: number;
    entryTime: string;
    exitTime: string | null;
    commandEventCount: number;
    decisionEventCount: number;
    latestAuditAt: string | null;
    symbol: string;
    timeframe: string;
}> = {}) {
    const values = {
        recordId: 'trade-1',
        signalId: 'signal-1',
        backtestRunId: 'run-1',
        exitRuleCode: 'TP1',
        exitRuleName: 'Take Profit 1',
        result: 'WIN' as const,
        exitReason: 'TAKE_PROFIT_1',
        rMultiple: 1.75,
        pnlUsd: 420,
        entryTime: '2026-03-09T08:00:00.000Z',
        exitTime: '2026-03-09T10:00:00.000Z',
        commandEventCount: 3,
        decisionEventCount: 2,
        latestAuditAt: '2026-03-09T10:00:00.000Z',
        symbol: 'XAUUSD',
        timeframe: 'H1',
        ...overrides,
    };

    return {
        record: {
            recordId: values.recordId,
            rowId: `${values.signalId}:exit-tp1`,
            signalId: values.signalId,
            backtestRunId: values.backtestRunId,
            exitRuleId: 'exit-tp1',
            exitRuleCode: values.exitRuleCode,
            exitRuleName: values.exitRuleName,
            runName: 'Song Trap Validation',
            runStatus: 'COMPLETED',
            signalCode: 'songTrap',
            signalVersion: 3,
            symbol: values.symbol,
            timeframe: values.timeframe,
            side: 'LONG',
            session: 'LONDON',
            entryTime: values.entryTime,
            exitTime: values.exitTime,
            entryPrice: 3230,
            stopLoss: 3220,
            exitPrice: 3248,
            rMultiple: values.rMultiple,
            pnlUsd: values.pnlUsd,
            result: values.result,
            exitReason: values.exitReason,
            notes: 'Validation trade detail.',
            commandEventCount: values.commandEventCount,
            decisionEventCount: values.decisionEventCount,
            auditCoverage: 'full' as const,
            latestAuditAt: values.latestAuditAt,
        },
        traceability: {
            historyRecordId: values.recordId,
            rowId: `${values.signalId}:exit-tp1`,
            signalId: values.signalId,
            backtestRunId: values.backtestRunId,
            runName: 'Song Trap Validation',
            signalKey: 'songTrap@v3',
            exitRuleCode: values.exitRuleCode,
            summaryLabel: `${values.symbol} ${values.timeframe} LONG`,
            scopeLabel: 'Scoped record thread',
            scopeDetail: 'Scoped to the selected historical outcome.',
        },
        timelineSummary: {
            totalItems: values.commandEventCount + values.decisionEventCount,
            commandEvents: values.commandEventCount,
            decisionEvents: values.decisionEventCount,
            firstOccurredAt: '2026-03-09T08:00:00.000Z',
            lastOccurredAt: values.latestAuditAt,
        },
        timeline: [],
        evaluatedAt: '2026-03-11T08:00:00.000Z',
    };
}

function makeResponseContext({
    signalDefinition = {
        code: 'songTrap',
        version: 3,
        name: 'Song Trap',
    },
    backtestRun = makeBacktestRun(),
    backtestRuns,
    indicatorInstances = [makeIndicatorInstance()],
    events = [makeEvent(), makeEvent({
        id: 'event-other',
        indicatorInstanceId: 'inst-2',
        eventType: 'ENTRY_CONFIRMED',
        candleTime: new Date('2026-03-10T08:00:00Z'),
        createdAt: new Date('2026-03-10T08:00:01Z'),
    })],
    traces = [makeTrace()],
}: Partial<{
    signalDefinition: { code: string; version: number; name: string } | null;
    backtestRun: ReturnType<typeof makeBacktestRun> | null;
    backtestRuns: Array<ReturnType<typeof makeBacktestRun>>;
    indicatorInstances: Array<ReturnType<typeof makeIndicatorInstance>>;
    events: Array<ReturnType<typeof makeEvent>>;
    traces: Array<ReturnType<typeof makeTrace>>;
}> = {}) {
    const availableBacktestRuns = backtestRuns ?? (backtestRun ? [backtestRun] : []);

    return {
        signalDefinition: {
            findUnique: async () => signalDefinition,
        },
        backtestRun: {
            findFirst: async (args: { where?: { id?: string; signalCode?: string; signalVersion?: number; status?: string } }) => {
                const matches = availableBacktestRuns.filter((candidate) => {
                    if (args.where?.id && args.where.id !== candidate.id) {
                        return false;
                    }
                    if (args.where?.status && args.where.status !== candidate.status) {
                        return false;
                    }
                    if (args.where?.signalCode && args.where.signalCode !== candidate.signalCode) {
                        return false;
                    }
                    if (args.where?.signalVersion !== undefined && args.where.signalVersion !== candidate.signalVersion) {
                        return false;
                    }
                    return true;
                });

                if (matches.length === 0) {
                    return null;
                }

                return [...matches].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];
            },
        },
        indicatorInstance: {
            findFirst: async (args: { where: { id: string; signalCode: string; signalVersion: number } }) =>
                indicatorInstances.find((instance) =>
                    instance.id === args.where.id
                    && instance.signalCode === args.where.signalCode
                    && instance.signalVersion === args.where.signalVersion,
                ) ?? null,
            findMany: async () => indicatorInstances,
        },
        signalEvent: {
            findMany: async () => events,
        },
        signalLogicTrace: {
            findMany: async () => traces,
        },
    } as unknown as import('@prisma/client').PrismaClient;
}

describe('TradingDiscrepancyService', () => {
    it('builds an alert-driven discrepancy snapshot with report, deployment, and diff insight linkage', async () => {
        const analyticsCalls: unknown[] = [];
        const analytics = {
            getOverview: async (filters: unknown) => {
                analyticsCalls.push(filters);
                return {
                    context: { id: 'run-1' },
                    metrics: {
                        signalCount: 5,
                        totalTrades: 8,
                        closedTrades: 8,
                        openTrades: 0,
                        wins: 6,
                        losses: 2,
                        winRate: 75,
                        profitFactor: 2.4,
                        expectancy: 0.8,
                        netR: 6.4,
                        netUsd: 1280,
                        maxConsecutiveLoss: 1,
                        maxDrawdownPct: -4.5,
                    },
                };
            },
            getSignalReview: async () => [],
        };
        const audit = {
            getHistoryDetail: async () => null,
        };
        const service = new TradingDiscrepancyService(
            makeResponseContext(),
            analytics,
            audit,
        );

        const snapshot = await service.getSnapshot({
            code: 'songTrap',
            version: 3,
            backtestRunId: 'run-1',
            indicatorInstanceId: 'inst-1',
        });

        assert.ok(snapshot);
        assert.equal(snapshot.investigationKind, 'alert-driven');
        assert.deepEqual(analyticsCalls, [{ backtestRunId: 'run-1' }]);
        assert.equal(snapshot.linkedRecords.signalKey, 'songTrap@v3');
        assert.equal(snapshot.linkedRecords.backtestRunId, 'run-1');
        assert.equal(snapshot.linkedRecords.primaryIndicatorInstanceId, 'inst-1');
        assert.equal(snapshot.linkedRecords.reportPath, '/reports?backtestRunId=run-1');
        assert.deepEqual(snapshot.linkedRecords.commandRecordIds, ['event-live-stop']);
        assert.equal(snapshot.backtest?.reportSummary?.totalTrades, 8);
        assert.equal(snapshot.live.primaryIndicatorInstanceId, 'inst-1');
        assert.equal(snapshot.live.deployments[0].matchedBy, 'exact');
        assert.equal(snapshot.live.deployments[0].commandRecordCount, 1);
        assert.equal(snapshot.live.deployments[0].decisionRecordCount, 1);
        assert.ok(snapshot.discrepancies.some((item) => item.code === 'parameter-drift'));
        assert.ok(snapshot.discrepancies.some((item) => item.code === 'execution-config-drift'));
        assert.ok(snapshot.discrepancies.some((item) => item.code === 'live-status-failed'));
    });

    it('builds a reported-issue discrepancy snapshot from trade history and makes outcome drift legible', async () => {
        const analytics = {
            getOverview: async () => ({
                context: { id: 'run-1' },
                metrics: {
                    signalCount: 5,
                    totalTrades: 8,
                    closedTrades: 8,
                    openTrades: 0,
                    wins: 6,
                    losses: 2,
                    winRate: 75,
                    profitFactor: 2.4,
                    expectancy: 0.8,
                    netR: 6.4,
                    netUsd: 1280,
                    maxConsecutiveLoss: 1,
                    maxDrawdownPct: -4.5,
                },
            }),
            getSignalReview: async (filters: { backtestRunId: string; signalId: string }) => [{
                signalId: filters.signalId,
                backtestRunId: filters.backtestRunId,
                backtestRunName: 'Song Trap Validation',
                symbol: 'XAUUSD',
                timeframe: 'H1',
                side: 'LONG',
                session: 'LONDON',
                strategyId: 'strat-1',
                strategyCode: 'SONG',
                strategyName: 'Song Trap',
                entryTime: new Date('2026-03-09T08:00:00Z'),
                entryPrice: 3230,
                stopLoss: 3220,
                takeProfit1: 3248,
                takeProfit2: null,
                notes: 'Review row.',
                resultCount: 2,
                wins: 1,
                losses: 1,
                openResults: 0,
                netR: 0.5,
                avgR: 0.25,
                bestExitRuleCode: 'TP1',
                bestExitRuleName: 'Take Profit 1',
                latestExitTime: new Date('2026-03-09T10:00:00Z'),
            }],
        };
        const audit = {
            getHistoryDetail: async (recordId: string) =>
                recordId === 'trade-1'
                    ? makeTradeDetail()
                    : null,
        };
        const service = new TradingDiscrepancyService(
            makeResponseContext({
                indicatorInstances: [
                    makeIndicatorInstance(),
                    makeIndicatorInstance({
                        id: 'inst-2',
                        name: 'Song Trap Secondary',
                        status: 'ACTIVE',
                        sourceBacktestRunId: null,
                        symbol: 'BTCUSD',
                        timeframe: 'M15',
                        updatedAt: new Date('2026-03-10T11:00:00Z'),
                        lastEmittedEventTime: null,
                        errorMessage: null,
                    }),
                ],
                events: [makeEvent()],
                traces: [makeTrace()],
            }),
            analytics,
            audit,
        );

        const snapshot = await service.getSnapshot({
            code: 'songTrap',
            version: 3,
            tradeRecordId: 'trade-1',
        });

        assert.ok(snapshot);
        assert.equal(snapshot.investigationKind, 'reported-issue');
        assert.equal(snapshot.linkedRecords.tradeRecordId, 'trade-1');
        assert.equal(snapshot.linkedRecords.signalId, 'signal-1');
        assert.equal(snapshot.linkedRecords.reportPath, '/reports?backtestRunId=run-1&signalId=signal-1');
        assert.equal(snapshot.backtest?.tradeIssue?.recordId, 'trade-1');
        assert.equal(snapshot.backtest?.signalReview?.bestExitRuleCode, 'TP1');
        assert.equal(snapshot.live.primaryIndicatorInstanceId, 'inst-1');
        assert.equal(snapshot.live.deployments[0].matchedBy, 'source-run');
        assert.ok(snapshot.discrepancies.some((item) => item.code === 'outcome-drift'));
        assert.ok(snapshot.discrepancies.some((item) => item.code === 'live-status-failed'));
    });

    it('uses the latest command record for outcome comparison even when a later decision trace exists', async () => {
        const service = new TradingDiscrepancyService(
            makeResponseContext({
                events: [makeEvent({
                    eventType: 'STOP_HIT',
                    candleTime: new Date('2026-03-10T09:59:00Z'),
                    createdAt: new Date('2026-03-10T09:59:01Z'),
                })],
                traces: [makeTrace({
                    id: 'trace-after-command',
                    eventType: 'TRAP',
                    candleTime: new Date('2026-03-10T10:00:00Z'),
                    createdAt: new Date('2026-03-10T10:00:01Z'),
                })],
            }),
            {
                getOverview: async () => ({
                    metrics: {
                        signalCount: 1,
                        totalTrades: 1,
                        closedTrades: 1,
                        openTrades: 0,
                        wins: 0,
                        losses: 1,
                        winRate: 0,
                        profitFactor: 0,
                        expectancy: -1,
                        netR: -1,
                        netUsd: -200,
                        maxConsecutiveLoss: 1,
                        maxDrawdownPct: -2,
                    },
                }),
                getSignalReview: async () => [],
            },
            {
                getHistoryDetail: async () => makeTradeDetail({
                    exitReason: 'STOP_LOSS',
                    result: 'LOSS',
                    rMultiple: -1,
                    pnlUsd: -200,
                }),
            },
        );

        const snapshot = await service.getSnapshot({
            code: 'songTrap',
            version: 3,
            tradeRecordId: 'trade-1',
        });

        assert.ok(snapshot);
        assert.equal(snapshot.discrepancies.some((item) => item.code === 'outcome-drift'), false);
    });

    it('prefers the newest completed backtest run when no exact run is supplied', async () => {
        const service = new TradingDiscrepancyService(
            makeResponseContext({
                backtestRuns: [
                    makeBacktestRun({
                        id: 'run-older',
                        name: 'Older validation',
                        createdAt: new Date('2026-03-01T00:00:00Z'),
                    }),
                    makeBacktestRun({
                        id: 'run-newer',
                        name: 'Newer validation',
                        createdAt: new Date('2026-03-10T00:00:00Z'),
                    }),
                ],
            }),
            {
                getOverview: async ({ backtestRunId }) => ({
                    metrics: {
                        signalCount: 1,
                        totalTrades: backtestRunId === 'run-newer' ? 4 : 1,
                        closedTrades: 4,
                        openTrades: 0,
                        wins: 3,
                        losses: 1,
                        winRate: 75,
                        profitFactor: 2,
                        expectancy: 0.5,
                        netR: 2,
                        netUsd: 400,
                        maxConsecutiveLoss: 1,
                        maxDrawdownPct: -2,
                    },
                }),
                getSignalReview: async () => [],
            },
            {
                getHistoryDetail: async () => null,
            },
        );

        const snapshot = await service.getSnapshot({
            code: 'songTrap',
            version: 3,
        });

        assert.ok(snapshot);
        assert.equal(snapshot.backtest?.runId, 'run-newer');
        assert.equal(snapshot.linkedRecords.reportPath, '/reports?backtestRunId=run-newer');
    });

    it('returns null when an exact live deployment context is requested but missing', async () => {
        const service = new TradingDiscrepancyService(
            makeResponseContext({
                indicatorInstances: [],
            }),
            {
                getOverview: async () => null,
                getSignalReview: async () => [],
            },
            {
                getHistoryDetail: async () => null,
            },
        );

        const snapshot = await service.getSnapshot({
            code: 'songTrap',
            version: 3,
            indicatorInstanceId: 'missing-instance',
        });

        assert.equal(snapshot, null);
    });
});
