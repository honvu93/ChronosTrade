import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { TradingRootCauseService } from './TradingRootCauseService';

function makeDiscrepancySnapshot(): any {
    return {
        investigationKind: 'reported-issue',
        signalCode: 'songTrap',
        signalVersion: 3,
        signalName: 'Song Trap',
        linkedRecords: {
            signalKey: 'songTrap@v3',
            backtestRunId: 'run-1',
            tradeRecordId: 'trade-1',
            signalId: 'signal-1',
            primaryIndicatorInstanceId: 'inst-1',
            deploymentRecordIds: ['inst-1'],
            commandRecordIds: [],
            reportPath: '/reports?backtestRunId=run-1&signalId=signal-1',
        },
        backtest: {
            runId: 'run-1',
            runName: 'Song Trap Validation',
            runStatus: 'COMPLETED',
            symbol: 'XAUUSD',
            timeframe: 'H1',
            parametersJson: { lookback: 20 },
            executionConfigJson: { orderTiming: 'CLOSE', riskPercent: 1 },
            reportSummary: {
                signalCount: 2,
                totalTrades: 6,
                closedTrades: 6,
                openTrades: 0,
                wins: 4,
                losses: 2,
                winRate: 66.7,
                profitFactor: 1.8,
                expectancy: 0.4,
                netR: 2.4,
                netUsd: 480,
                maxConsecutiveLoss: 1,
                maxDrawdownPct: -6.1,
            },
            signalReview: null,
            tradeIssue: {
                recordId: 'trade-1',
                rowId: 'signal-1:exit-1',
                signalId: 'signal-1',
                exitRuleCode: 'TP1',
                exitRuleName: 'Take Profit 1',
                result: 'WIN',
                exitReason: 'TAKE_PROFIT_1',
                rMultiple: 1.4,
                pnlUsd: 320,
                entryTime: '2026-03-10T08:00:00.000Z',
                exitTime: '2026-03-10T09:00:00.000Z',
                auditCommandRecords: 1,
                auditDecisionRecords: 2,
                auditLatestAt: '2026-03-10T09:00:00.000Z',
            },
        },
        live: {
            primaryIndicatorInstanceId: 'inst-1',
            deployments: [{
                indicatorInstanceId: 'inst-1',
                name: 'Song Trap Live',
                status: 'FAILED',
                symbol: 'XAUUSD',
                timeframe: 'H1',
                matchedBy: 'source-run',
                sourceBacktestRunId: 'run-1',
                startedAt: '2026-03-10T07:00:00.000Z',
                updatedAt: '2026-03-10T10:00:00.000Z',
                lastProcessedCandleTime: '2026-03-10T09:55:00.000Z',
                lastEmittedEventTime: '2026-03-10T09:59:00.000Z',
                errorMessage: 'Broker rejected the trailing stop update.',
                parameterJson: { lookback: 20 },
                executionConfigJson: { orderTiming: 'OPEN', riskPercent: 2 },
                commandRecordCount: 0,
                decisionRecordCount: 2,
                latestRecordId: 'event-1',
                latestEventType: 'STOP_HIT',
                latestOccurredAt: '2026-03-10T09:59:00.000Z',
                latestLabel: 'Stop loss executed',
            }],
            timelineSummary: {
                totalItems: 2,
                commandEvents: 0,
                decisionEvents: 2,
                firstOccurredAt: '2026-03-10T09:30:00.000Z',
                lastOccurredAt: '2026-03-10T09:59:00.000Z',
            },
            recentTimeline: [],
        },
        discrepancies: [],
        evaluatedAt: '2026-03-11T08:00:00.000Z',
    };
}

function makeFailureSnapshot(): any {
    return {
        domains: {
            ingestion: { severity: 'ok' as const, items: [] },
            signal: { severity: 'ok' as const, items: [] },
            alert: { severity: 'ok' as const, items: [] },
            trading: { severity: 'ok' as const, items: [] },
        },
        totalCritical: 0,
        totalWarning: 0,
        evaluatedAt: '2026-03-11T08:00:00.000Z',
    };
}

function makeEligibilityItem(overrides: Partial<any> = {}) {
    return {
        signalCode: 'songTrap',
        signalVersion: 3,
        signalName: 'Song Trap',
        backtestRunId: 'run-1',
        backtestRunName: 'Song Trap Validation',
        backtestRunStatus: 'COMPLETED',
        eligibilityState: 'validated',
        blockingReasons: [],
        metrics: {
            closedTrades: 6,
            openTrades: 0,
            wins: 4,
            losses: 2,
            winRate: 0.667,
            netR: 2.4,
            profitFactor: 1.8,
            maxDrawdownPct: -6.1,
        },
        evaluatedAt: '2026-03-11T08:00:00.000Z',
        ...overrides,
    };
}

function buildService({
    discrepancySnapshot = makeDiscrepancySnapshot(),
    failureSnapshot = makeFailureSnapshot(),
    eligibilityItems = [makeEligibilityItem()],
    history = [] as any[],
    createRecord,
    env = {
        MT5_LOGIN: '123456',
        MT5_PASSWORD: 'secret',
        MT5_SERVER: 'Demo',
        MT5_BRIDGE_PORT: '5000',
        ENCRYPTION_KEY: '12345678901234567890123456789012',
    },
    webhookDeliveryService = {
        deliverConfiguredOutputs: async () => [],
    },
}: Partial<{
    discrepancySnapshot: any;
    failureSnapshot: any;
    eligibilityItems: any[];
    history: any[];
    createRecord: (args: { data: Record<string, unknown> }) => Promise<any>;
    env: Record<string, string | undefined>;
    webhookDeliveryService: {
        deliverConfiguredOutputs: (args: Record<string, unknown>) => Promise<unknown>;
    };
}> = {}) {
    const createCalls: Array<Record<string, unknown>> = [];
    const prisma = {
        tradingInvestigationOutcomeRecord: {
            findMany: async () => history,
            create: async (args: { data: Record<string, unknown> }) => {
                createCalls.push(args.data);
                if (createRecord) {
                    return createRecord(args);
                }

                return {
                    id: 'diag-1',
                    signalCode: 'songTrap',
                    signalVersion: 3,
                    rootCause: 'BROKER_EXECUTION',
                    outcome: 'ESCALATED',
                    backtestRunId: 'run-1',
                    indicatorInstanceId: 'inst-1',
                    tradeRecordId: 'trade-1',
                    summary: 'Escalated after broker rejection evidence.',
                    evidenceJson: {
                        selectedCategory: 'broker-execution',
                        selectedOutcome: 'escalated',
                        investigationKind: 'reported-issue',
                        linkedRecords: {
                            signalKey: 'songTrap@v3',
                            backtestRunId: 'run-1',
                            tradeRecordId: 'trade-1',
                            signalId: 'signal-1',
                            primaryIndicatorInstanceId: 'inst-1',
                            reportPath: '/reports?backtestRunId=run-1&signalId=signal-1',
                        },
                        score: 140,
                        confidence: 'high',
                        evidence: [],
                    },
                    createdAt: new Date('2026-03-11T09:00:00.000Z'),
                };
            },
        },
    } as unknown as PrismaClient;

    const service = new TradingRootCauseService(
        prisma,
        {
            getSnapshot: async () => discrepancySnapshot,
        },
        {
            classify: async () => failureSnapshot,
        },
        {
            listEligibility: async () => eligibilityItems,
        },
        env,
        webhookDeliveryService as never,
    );

    return { service, createCalls };
}

describe('TradingRootCauseService', () => {
    it('classifies data quality as the primary cause when ingestion is stale and activity is missing', async () => {
        const discrepancySnapshot = makeDiscrepancySnapshot();
        discrepancySnapshot.discrepancies = [{
            code: 'activity-gap',
            severity: 'warning',
            title: 'Validation produced trades, but the live deployment has no command records yet.',
            detail: 'This may indicate a market-condition gap, stalled runtime, or missing event linkage.',
            backtestValue: '6 validation trades',
            liveValue: '0 command records',
        }];
        discrepancySnapshot.live.deployments[0].lastProcessedCandleTime = '2026-03-09T08:00:00.000Z';

        const failureSnapshot = makeFailureSnapshot();
        failureSnapshot.domains.ingestion = {
            severity: 'critical',
            items: [{
                id: 'ingestion-xauusd-h1',
                domain: 'ingestion',
                severity: 'critical',
                title: 'XAUUSD H1 - data feed stopped',
                detail: 'Last candle received 28h ago. Ingestion appears dead.',
                detectedAt: '2026-03-09T08:00:00.000Z',
                symbol: 'XAUUSD',
                timeframe: 'H1',
            }],
        };

        const { service } = buildService({
            discrepancySnapshot,
            failureSnapshot,
        });

        const snapshot = await service.diagnose({
            code: 'songTrap',
            version: 3,
            tradeRecordId: 'trade-1',
        });

        assert.ok(snapshot);
        assert.equal(snapshot.primaryCategory, 'data-quality');
        const dataQuality = snapshot.categories.find((category) => category.category === 'data-quality');
        assert.ok(dataQuality);
        assert.equal(dataQuality.confidence, 'high');
        assert.ok(dataQuality.evidence.some((item) => item.id === 'failure:ingestion-xauusd-h1'));
        assert.ok(dataQuality.evidence.some((item) => item.id === 'discrepancy:activity-gap'));
    });

    it('classifies risk settings when config drift and drawdown evidence align', async () => {
        const discrepancySnapshot = makeDiscrepancySnapshot();
        discrepancySnapshot.discrepancies = [{
            code: 'execution-config-drift',
            severity: 'warning',
            title: 'Live execution configuration drifted from the validation run.',
            detail: 'Changed keys: orderTiming, riskPercent.',
            backtestValue: 'orderTiming=CLOSE, riskPercent=1',
            liveValue: 'orderTiming=OPEN, riskPercent=2',
        }];

        const { service } = buildService({
            discrepancySnapshot,
            eligibilityItems: [
                makeEligibilityItem({
                    eligibilityState: 'blocked',
                    blockingReasons: [{
                        code: 'excessive_drawdown',
                        label: 'Maximum drawdown is -18.0%, exceeding the hard stop.',
                    }],
                    metrics: {
                        closedTrades: 6,
                        openTrades: 0,
                        wins: 3,
                        losses: 3,
                        winRate: 0.5,
                        netR: 0.4,
                        profitFactor: 1.1,
                        maxDrawdownPct: -18,
                    },
                }),
            ],
        });

        const snapshot = await service.diagnose({
            code: 'songTrap',
            version: 3,
            tradeRecordId: 'trade-1',
        });

        assert.ok(snapshot);
        assert.equal(snapshot.primaryCategory, 'risk-settings');
        const risk = snapshot.categories.find((category) => category.category === 'risk-settings');
        assert.ok(risk);
        assert.equal(risk.severity, 'critical');
        assert.ok(risk.evidence.some((item) => item.id === 'discrepancy:execution-config-drift'));
        assert.ok(risk.evidence.some((item) => item.id === 'eligibility:excessive_drawdown'));
    });

    it('records an escalated broker-execution outcome with the selected evidence snapshot', async () => {
        const discrepancySnapshot = makeDiscrepancySnapshot();
        discrepancySnapshot.discrepancies = [{
            code: 'live-status-failed',
            severity: 'critical',
            title: 'Live deployment status diverged from the validated run.',
            detail: 'Broker rejected the trailing stop update.',
            backtestValue: 'COMPLETED',
            liveValue: 'FAILED',
        }];

        const { service, createCalls } = buildService({
            discrepancySnapshot,
            history: [{
                id: 'diag-older',
                signalCode: 'songTrap',
                signalVersion: 3,
                rootCause: 'BROKER_EXECUTION',
                outcome: 'MITIGATED',
                backtestRunId: 'run-1',
                indicatorInstanceId: 'inst-1',
                tradeRecordId: 'trade-1',
                summary: 'Previous mitigation.',
                createdAt: new Date('2026-03-11T08:30:00.000Z'),
            }],
        });

        const record = await service.recordOutcome({
            code: 'songTrap',
            version: 3,
            tradeRecordId: 'trade-1',
            rootCauseCategory: 'broker-execution',
            outcome: 'escalated',
            summary: 'Escalated after broker rejection evidence.',
        });

        assert.ok(record);
        assert.equal(record.rootCauseCategory, 'broker-execution');
        assert.equal(record.outcome, 'escalated');
        assert.equal(createCalls.length, 1);
        assert.equal(createCalls[0].rootCause, 'BROKER_EXECUTION');
        assert.equal(createCalls[0].outcome, 'ESCALATED');
        assert.equal(createCalls[0].tradeRecordId, 'trade-1');
        assert.ok(typeof createCalls[0].evidenceJson === 'object');
    });

    it('auto-dispatches investigation outcomes after recording', async () => {
        const deliveryCalls: Array<Record<string, unknown>> = [];
        const { service } = buildService({
            webhookDeliveryService: {
                deliverConfiguredOutputs: async (args) => {
                    deliveryCalls.push(args);
                    return [];
                },
            },
        });

        await service.recordOutcome({
            code: 'songTrap',
            version: 3,
            tradeRecordId: 'trade-1',
            rootCauseCategory: 'broker-execution',
            outcome: 'escalated',
            summary: 'Escalated after broker rejection evidence.',
        });

        assert.equal(deliveryCalls.length, 1);
        assert.deepEqual(deliveryCalls[0], {
            backtestRunId: 'run-1',
            indicatorInstanceId: 'inst-1',
            deliveries: [{
                contractKind: 'investigation-outcome',
                limit: 1,
            }],
        });
    });

    it('hydrates persisted decision context from stored evidence JSON', async () => {
        const { service } = buildService({
            history: [{
                id: 'diag-older',
                signalCode: 'songTrap',
                signalVersion: 3,
                rootCause: 'BROKER_EXECUTION',
                outcome: 'MITIGATED',
                backtestRunId: 'run-1',
                indicatorInstanceId: 'inst-1',
                tradeRecordId: 'trade-1',
                summary: 'Previous mitigation.',
                evidenceJson: {
                    selectedCategory: 'broker-execution',
                    selectedOutcome: 'mitigated',
                    investigationKind: 'reported-issue',
                    linkedRecords: {
                        signalKey: 'songTrap@v3',
                        backtestRunId: 'run-1',
                        tradeRecordId: 'trade-1',
                        signalId: 'signal-1',
                        primaryIndicatorInstanceId: 'inst-1',
                        reportPath: '/reports?backtestRunId=run-1&signalId=signal-1',
                    },
                    score: 90,
                    confidence: 'medium',
                    evidence: [{
                        id: 'discrepancy:live-status-failed',
                        source: 'discrepancy',
                        severity: 'critical',
                        title: 'Live deployment status diverged from the validated run.',
                        detail: 'Broker rejected the trailing stop update.',
                        linkedRecordLabel: 'Deployment inst-1',
                        linkedRecordId: 'inst-1',
                        sectionKey: 'live',
                        href: null,
                    }],
                },
                createdAt: new Date('2026-03-11T08:30:00.000Z'),
            }],
        });

        const snapshot = await service.diagnose({
            code: 'songTrap',
            version: 3,
            tradeRecordId: 'trade-1',
        });

        assert.ok(snapshot);
        assert.equal(snapshot.history.length, 1);
        assert.equal(snapshot.history[0].decisionContext?.selectedCategory, 'broker-execution');
        assert.equal(snapshot.history[0].decisionContext?.selectedOutcome, 'mitigated');
        assert.equal(snapshot.history[0].decisionContext?.confidence, 'medium');
        assert.equal(snapshot.history[0].decisionContext?.evidence[0].id, 'discrepancy:live-status-failed');
    });
});
