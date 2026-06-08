import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
    createCreateTradingDiagnosisOutcomeRouteHandler,
    createGetTradingDiagnosisRouteHandler,
    createGetTradingDiscrepancyRouteHandler,
    createGetSignalVersionRouteHandler,
    createGetTradeHistoryDetailRouteHandler,
    createGetTradeHistoryRouteHandler,
    createGetTradingChecklistRouteHandler,
    registerTradingOperationsRoutes,
} from './registerTradingOperationsRoutes';

function makeSnapshot() {
    return {
        signalCode: 'songTrap',
        signalVersion: 1,
        signalName: 'Song Trap',
        category: 'Breakout',
        description: 'Test signal.',
        parameterSchema: { fields: [] },
        indicatorSchema: null,
        eventSchema: null,
        composedBlocks: null,
        isComposed: false,
        createdBy: 'HVV',
        createdAt: '2026-01-10T00:00:00.000Z',
        originKind: 'backtest-run' as const,
        originRecordId: 'run-1',
        originRecordLabel: 'Incident Run',
        originStatus: 'FAILED',
        originSymbol: 'XAUUSD',
        originTimeframe: 'H1',
        parameterValuesJson: { lookback: 20 },
        linkedBacktestRunId: 'run-1',
        linkedBacktestName: 'Incident Run',
        linkedBacktestStatus: 'FAILED',
        linkedBacktestSymbol: 'XAUUSD',
        linkedBacktestTimeframe: 'H1',
        executionConfigJson: { orderTiming: 'CLOSE' },
        accountContext: null,
    };
}

function makeResponse() {
    return {
        statusCode: 200,
        body: null as unknown,
        status(code: number) {
            this.statusCode = code;
            return this;
        },
        json(payload: unknown) {
            this.body = payload;
            return this;
        },
    };
}

function makeTradeHistorySnapshot() {
    return {
        summary: {
            totalRecords: 1,
            activeTrades: 0,
            wins: 1,
            losses: 0,
            breakEven: 0,
            recordsWithAudit: 1,
            recordsMissingAudit: 0,
            commandEvents: 2,
            decisionEvents: 3,
        },
        records: [{
            recordId: 'result-1',
            rowId: 'signal-1:exit-1',
            signalId: 'signal-1',
            backtestRunId: 'run-1',
            exitRuleId: 'exit-1',
            exitRuleCode: 'TP1',
            exitRuleName: 'Take Profit 1',
            runName: 'Song Trap Run',
            runStatus: 'COMPLETED',
            signalCode: 'songTrap',
            signalVersion: 3,
            symbol: 'XAUUSD',
            timeframe: 'H1',
            side: 'LONG',
            session: 'LONDON',
            entryTime: '2026-03-10T08:00:00.000Z',
            exitTime: '2026-03-10T09:00:00.000Z',
            entryPrice: 3230,
            stopLoss: 3220,
            exitPrice: 3242,
            rMultiple: 1.25,
            pnlUsd: 320,
            result: 'WIN' as const,
            exitReason: 'TAKE_PROFIT_1',
            notes: null,
            commandEventCount: 2,
            decisionEventCount: 3,
            auditCoverage: 'full' as const,
            latestAuditAt: '2026-03-10T09:00:00.000Z',
        }],
        evaluatedAt: '2026-03-11T08:00:00.000Z',
    };
}

function makeTradeHistoryDetail() {
    return {
        record: makeTradeHistorySnapshot().records[0],
        traceability: {
            historyRecordId: 'result-1',
            rowId: 'signal-1:exit-1',
            signalId: 'signal-1',
            backtestRunId: 'run-1',
            runName: 'Song Trap Run',
            signalKey: 'songTrap@v3',
            exitRuleCode: 'TP1',
            summaryLabel: 'XAUUSD H1 LONG',
            scopeLabel: 'Scoped record thread',
            scopeDetail: 'This history shows the shared signal thread through the selected TP1 outcome.',
        },
        timelineSummary: {
            totalItems: 2,
            commandEvents: 1,
            decisionEvents: 1,
            firstOccurredAt: '2026-03-10T08:00:00.000Z',
            lastOccurredAt: '2026-03-10T09:00:00.000Z',
        },
        timeline: [{
            id: 'trace-1',
            kind: 'decision' as const,
            source: 'trace' as const,
            eventType: 'ENTRY_CONFIRMED',
            occurredAt: '2026-03-10T08:00:00.000Z',
            createdAt: '2026-03-10T08:00:01.000Z',
            label: null,
            price: null,
            signalEventId: 'event-1',
            stateBefore: 'WAITING',
            stateAfter: 'ENTERED',
            ruleId: 'entry-rule',
            notes: 'Rule matched.',
            metaJson: null,
            indicatorJson: { fastEma: 12 },
            thresholdJson: { threshold: 1.4 },
            priceJson: { close: 3231 },
        }],
        evaluatedAt: '2026-03-11T08:00:00.000Z',
    };
}

function makeDiscrepancySnapshot() {
    return {
        investigationKind: 'alert-driven' as const,
        signalCode: 'songTrap',
        signalVersion: 3,
        signalName: 'Song Trap',
        linkedRecords: {
            signalKey: 'songTrap@v3',
            backtestRunId: 'run-1',
            tradeRecordId: null,
            signalId: null,
            primaryIndicatorInstanceId: 'inst-1',
            deploymentRecordIds: ['inst-1'],
            commandRecordIds: ['event-live-stop'],
            reportPath: '/reports?backtestRunId=run-1',
        },
        backtest: {
            runId: 'run-1',
            runName: 'Song Trap Validation',
            runStatus: 'COMPLETED',
            symbol: 'XAUUSD',
            timeframe: 'H1',
            parametersJson: { lookback: 20 },
            executionConfigJson: { orderTiming: 'CLOSE' },
            reportSummary: {
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
            signalReview: null,
            tradeIssue: null,
        },
        live: {
            primaryIndicatorInstanceId: 'inst-1',
            deployments: [],
            timelineSummary: null,
            recentTimeline: [],
        },
        discrepancies: [],
        evaluatedAt: '2026-03-11T08:00:00.000Z',
    };
}

function makeDiagnosisSnapshot() {
    return {
        signalCode: 'songTrap',
        signalVersion: 3,
        signalName: 'Song Trap',
        investigationKind: 'reported-issue' as const,
        primaryCategory: 'broker-execution' as const,
        categories: [{
            category: 'broker-execution' as const,
            label: 'Broker Execution',
            score: 140,
            confidence: 'high' as const,
            severity: 'critical' as const,
            summary: 'Broker rejection is the strongest linked cause.',
            evidence: [{
                id: 'discrepancy:live-status-failed',
                source: 'discrepancy' as const,
                severity: 'critical' as const,
                title: 'Live deployment status diverged from the validated run.',
                detail: 'Broker rejected the trailing stop update.',
                linkedRecordLabel: 'Deployment inst-1',
                linkedRecordId: 'inst-1',
                sectionKey: 'live' as const,
                href: null,
            }],
        }],
        linkedRecords: {
            signalKey: 'songTrap@v3',
            backtestRunId: 'run-1',
            tradeRecordId: 'trade-1',
            signalId: 'signal-1',
            primaryIndicatorInstanceId: 'inst-1',
            reportPath: '/reports?backtestRunId=run-1&signalId=signal-1',
        },
        latestOutcome: null,
        history: [],
        evaluatedAt: '2026-03-11T08:00:00.000Z',
    };
}

function makeDiagnosisOutcomeRecord() {
    return {
        id: 'diag-1',
        signalCode: 'songTrap',
        signalVersion: 3,
        rootCauseCategory: 'broker-execution' as const,
        outcome: 'escalated' as const,
        backtestRunId: 'run-1',
        indicatorInstanceId: 'inst-1',
        tradeRecordId: 'trade-1',
        summary: 'Escalated after repeated broker rejection evidence.',
        decidedAt: '2026-03-11T09:00:00.000Z',
        decisionContext: {
            selectedCategory: 'broker-execution' as const,
            selectedOutcome: 'escalated' as const,
            investigationKind: 'reported-issue' as const,
            linkedRecords: {
                signalKey: 'songTrap@v3',
                backtestRunId: 'run-1',
                tradeRecordId: 'trade-1',
                signalId: 'signal-1',
                primaryIndicatorInstanceId: 'inst-1',
                reportPath: '/reports?backtestRunId=run-1&signalId=signal-1',
            },
            score: 140,
            confidence: 'high' as const,
            evidence: [{
                id: 'discrepancy:live-status-failed',
                source: 'discrepancy' as const,
                severity: 'critical' as const,
                title: 'Live deployment status diverged from the validated run.',
                detail: 'Broker rejected the trailing stop update.',
                linkedRecordLabel: 'Deployment inst-1',
                linkedRecordId: 'inst-1',
                sectionKey: 'live' as const,
                href: null,
            }],
        },
    };
}

function makeAppRecorder() {
    const getRoutes: Array<{ path: string; handlers: Function[] }> = [];
    const postRoutes: Array<{ path: string; handlers: Function[] }> = [];

    const app = {
        get(path: string, ...handlers: Function[]) {
            getRoutes.push({ path, handlers });
            return app;
        },
        post(path: string, ...handlers: Function[]) {
            postRoutes.push({ path, handlers });
            return app;
        },
    };

    return {
        app: app as never,
        getRoutes,
        postRoutes,
    };
}

function createTradingAccessPrismaMock(accountMode: 'LIVE' | 'PAPER') {
    return {
        tradingAccount: {
            findUnique: async () => ({
                id: 'acct-1',
                ownerUserId: 'user-1',
                label: accountMode === 'PAPER' ? 'Paper MT5' : 'Live MT5',
                brokerKind: 'MT5',
                accountMode,
                status: 'ACTIVE',
                baseCurrency: 'USD',
                leverage: 500,
                lastSeenAt: null,
                lastSuccessfulSyncAt: null,
                metadataJson: null,
                createdAt: new Date('2026-03-11T10:00:00.000Z'),
                updatedAt: new Date('2026-03-11T10:00:00.000Z'),
                ownerUser: {
                    id: 'user-1',
                    email: 'pilot@example.com',
                    username: 'pilot',
                    displayName: 'Pilot User',
                },
                credential: null,
            }),
        },
    } as never;
}

describe('createGetSignalVersionRouteHandler', () => {
    it('rejects invalid params', async () => {
        const handler = createGetSignalVersionRouteHandler({
            getSnapshot: async () => makeSnapshot(),
        });
        const res = makeResponse();

        await handler({ params: { code: '', version: 'abc' }, query: {} } as never, res as never, (() => {}) as never);

        assert.equal(res.statusCode, 400);
        assert.deepEqual(res.body, {
            success: false,
            error: {
                code: 'INVALID_PARAMS',
                message: 'Signal code and a numeric version are required.',
                domain: 'trading.signal-version',
            },
        });
    });

    it('rejects partially numeric versions', async () => {
        const handler = createGetSignalVersionRouteHandler({
            getSnapshot: async () => makeSnapshot(),
        });
        const res = makeResponse();

        await handler({
            params: { code: 'songTrap', version: '3abc' },
            query: {},
        } as never, res as never, (() => {}) as never);

        assert.equal(res.statusCode, 400);
        assert.deepEqual(res.body, {
            success: false,
            error: {
                code: 'INVALID_PARAMS',
                message: 'Signal code and a numeric version are required.',
                domain: 'trading.signal-version',
            },
        });
    });

    it('rejects ambiguous exact context', async () => {
        const handler = createGetSignalVersionRouteHandler({
            getSnapshot: async () => makeSnapshot(),
        });
        const res = makeResponse();

        await handler({
            params: { code: 'songTrap', version: '1' },
            query: { backtestRunId: 'run-1', indicatorInstanceId: 'inst-1' },
        } as never, res as never, (() => {}) as never);

        assert.equal(res.statusCode, 400);
        assert.deepEqual(res.body, {
            success: false,
            error: {
                code: 'INVALID_CONTEXT',
                message: 'Choose either a backtest run or an indicator instance, not both.',
                domain: 'trading.signal-version',
            },
        });
    });

    it('passes exact context through to the service', async () => {
        const calls: unknown[] = [];
        const handler = createGetSignalVersionRouteHandler({
            getSnapshot: async (input) => {
                calls.push(input);
                return makeSnapshot();
            },
        });
        const res = makeResponse();

        await handler({
            params: { code: 'songTrap', version: '1' },
            query: { backtestRunId: 'run-42' },
        } as never, res as never, (() => {}) as never);

        assert.equal(res.statusCode, 200);
        assert.deepEqual(calls, [{
            code: 'songTrap',
            version: 1,
            backtestRunId: 'run-42',
            indicatorInstanceId: null,
        }]);
        assert.equal((res.body as { success: boolean }).success, true);
    });

    it('returns not found when the supplied exact context does not resolve', async () => {
        const handler = createGetSignalVersionRouteHandler({
            getSnapshot: async () => null,
        });
        const res = makeResponse();

        await handler({
            params: { code: 'songTrap', version: '1' },
            query: { indicatorInstanceId: 'inst-missing' },
        } as never, res as never, (() => {}) as never);

        assert.equal(res.statusCode, 404);
        assert.deepEqual(res.body, {
            success: false,
            error: {
                code: 'SIGNAL_VERSION_NOT_FOUND',
                message: 'Signal songTrap@v1 was not found for the supplied context.',
                domain: 'trading.signal-version',
            },
        });
    });
});

describe('createGetTradeHistoryRouteHandler', () => {
    it('rejects an invalid limit parameter', async () => {
        const handler = createGetTradeHistoryRouteHandler({
            listHistory: async () => makeTradeHistorySnapshot(),
        });
        const res = makeResponse();

        await handler({
            query: { limit: 'zero' },
        } as never, res as never, (() => {}) as never);

        assert.equal(res.statusCode, 400);
        assert.deepEqual(res.body, {
            success: false,
            error: {
                code: 'INVALID_PARAMS',
                message: 'limit must be a positive integer when supplied.',
                domain: 'trading.history',
            },
        });
    });

    it('passes a valid limit through to the service', async () => {
        const calls: unknown[] = [];
        const handler = createGetTradeHistoryRouteHandler({
            listHistory: async (input) => {
                calls.push(input);
                return makeTradeHistorySnapshot();
            },
        });
        const res = makeResponse();

        await handler({
            query: { limit: '15' },
        } as never, res as never, (() => {}) as never);

        assert.equal(res.statusCode, 200);
        assert.deepEqual(calls, [{ limit: 15 }]);
        assert.equal((res.body as { success: boolean }).success, true);
    });
});

describe('createGetTradeHistoryDetailRouteHandler', () => {
    it('rejects a missing record id', async () => {
        const handler = createGetTradeHistoryDetailRouteHandler({
            getHistoryDetail: async () => makeTradeHistoryDetail(),
        });
        const res = makeResponse();

        await handler({
            params: { recordId: ' ' },
        } as never, res as never, (() => {}) as never);

        assert.equal(res.statusCode, 400);
        assert.deepEqual(res.body, {
            success: false,
            error: {
                code: 'INVALID_PARAMS',
                message: 'A recordId is required.',
                domain: 'trading.history',
            },
        });
    });

    it('returns not found when the record is missing', async () => {
        const handler = createGetTradeHistoryDetailRouteHandler({
            getHistoryDetail: async () => null,
        });
        const res = makeResponse();

        await handler({
            params: { recordId: 'missing-record' },
        } as never, res as never, (() => {}) as never);

        assert.equal(res.statusCode, 404);
        assert.deepEqual(res.body, {
            success: false,
            error: {
                code: 'TRADE_HISTORY_RECORD_NOT_FOUND',
                message: 'Trade history record missing-record was not found.',
                domain: 'trading.history',
            },
        });
    });

    it('returns detail payload when the record exists', async () => {
        const handler = createGetTradeHistoryDetailRouteHandler({
            getHistoryDetail: async () => makeTradeHistoryDetail(),
        });
        const res = makeResponse();

        await handler({
            params: { recordId: 'result-1' },
        } as never, res as never, (() => {}) as never);

        assert.equal(res.statusCode, 200);
        assert.equal((res.body as { success: boolean }).success, true);
        assert.equal((res.body as { data: { traceability: { historyRecordId: string } } }).data.traceability.historyRecordId, 'result-1');
    });
});

describe('createGetTradingDiscrepancyRouteHandler', () => {
    it('rejects invalid params', async () => {
        const handler = createGetTradingDiscrepancyRouteHandler({
            getDiscrepancy: async () => makeDiscrepancySnapshot(),
        });
        const res = makeResponse();

        await handler({
            params: { code: '', version: 'abc' },
            query: {},
        } as never, res as never, (() => {}) as never);

        assert.equal(res.statusCode, 400);
        assert.deepEqual(res.body, {
            success: false,
            error: {
                code: 'INVALID_PARAMS',
                message: 'Signal code and a numeric version are required.',
                domain: 'trading.discrepancy',
            },
        });
    });

    it('rejects partially numeric versions', async () => {
        const handler = createGetTradingDiscrepancyRouteHandler({
            getDiscrepancy: async () => makeDiscrepancySnapshot(),
        });
        const res = makeResponse();

        await handler({
            params: { code: 'songTrap', version: '3abc' },
            query: {},
        } as never, res as never, (() => {}) as never);

        assert.equal(res.statusCode, 400);
        assert.deepEqual(res.body, {
            success: false,
            error: {
                code: 'INVALID_PARAMS',
                message: 'Signal code and a numeric version are required.',
                domain: 'trading.discrepancy',
            },
        });
    });

    it('passes alert and reported-issue context through to the service', async () => {
        const calls: unknown[] = [];
        const handler = createGetTradingDiscrepancyRouteHandler({
            getDiscrepancy: async (input: unknown) => {
                calls.push(input);
                return makeDiscrepancySnapshot();
            },
        });
        const res = makeResponse();

        await handler({
            params: { code: 'songTrap', version: '3' },
            query: { backtestRunId: 'run-1', indicatorInstanceId: 'inst-1', tradeRecordId: 'trade-1' },
        } as never, res as never, (() => {}) as never);

        assert.equal(res.statusCode, 200);
        assert.deepEqual(calls, [{
            code: 'songTrap',
            version: 3,
            backtestRunId: 'run-1',
            indicatorInstanceId: 'inst-1',
            tradeRecordId: 'trade-1',
        }]);
        assert.equal((res.body as { success: boolean }).success, true);
    });

    it('returns not found when the discrepancy context cannot be resolved', async () => {
        const handler = createGetTradingDiscrepancyRouteHandler({
            getDiscrepancy: async () => null,
        });
        const res = makeResponse();

        await handler({
            params: { code: 'songTrap', version: '3' },
            query: { indicatorInstanceId: 'inst-missing' },
        } as never, res as never, (() => {}) as never);

        assert.equal(res.statusCode, 404);
        assert.deepEqual(res.body, {
            success: false,
            error: {
                code: 'DISCREPANCY_CONTEXT_NOT_FOUND',
                message: 'No backtest-versus-live discrepancy context was found for songTrap@v3.',
                domain: 'trading.discrepancy',
            },
        });
    });
});

describe('createGetTradingDiagnosisRouteHandler', () => {
    it('rejects invalid params', async () => {
        const handler = createGetTradingDiagnosisRouteHandler({
            diagnose: async () => makeDiagnosisSnapshot(),
        });
        const res = makeResponse();

        await handler({
            params: { code: '', version: 'abc' },
            query: {},
        } as never, res as never, (() => {}) as never);

        assert.equal(res.statusCode, 400);
        assert.deepEqual(res.body, {
            success: false,
            error: {
                code: 'INVALID_PARAMS',
                message: 'Signal code and a numeric version are required.',
                domain: 'trading.diagnosis',
            },
        });
    });

    it('passes investigation context through to the diagnosis service', async () => {
        const calls: unknown[] = [];
        const handler = createGetTradingDiagnosisRouteHandler({
            diagnose: async (input) => {
                calls.push(input);
                return makeDiagnosisSnapshot();
            },
        });
        const res = makeResponse();

        await handler({
            params: { code: 'songTrap', version: '3' },
            query: { backtestRunId: 'run-1', indicatorInstanceId: 'inst-1', tradeRecordId: 'trade-1' },
        } as never, res as never, (() => {}) as never);

        assert.equal(res.statusCode, 200);
        assert.deepEqual(calls, [{
            code: 'songTrap',
            version: 3,
            backtestRunId: 'run-1',
            indicatorInstanceId: 'inst-1',
            tradeRecordId: 'trade-1',
        }]);
        assert.equal((res.body as { success: boolean }).success, true);
    });

    it('returns not found when diagnosis context cannot be resolved', async () => {
        const handler = createGetTradingDiagnosisRouteHandler({
            diagnose: async () => null,
        });
        const res = makeResponse();

        await handler({
            params: { code: 'songTrap', version: '3' },
            query: { tradeRecordId: 'missing' },
        } as never, res as never, (() => {}) as never);

        assert.equal(res.statusCode, 404);
        assert.deepEqual(res.body, {
            success: false,
            error: {
                code: 'DIAGNOSIS_CONTEXT_NOT_FOUND',
                message: 'No investigation context was found for songTrap@v3.',
                domain: 'trading.diagnosis',
            },
        });
    });
});

describe('createCreateTradingDiagnosisOutcomeRouteHandler', () => {
    it('rejects an invalid body', async () => {
        const handler = createCreateTradingDiagnosisOutcomeRouteHandler({
            recordOutcome: async () => makeDiagnosisOutcomeRecord(),
        });
        const res = makeResponse();

        await handler({
            params: { code: 'songTrap', version: '3' },
            body: { rootCauseCategory: 'unknown', outcome: 'later' },
        } as never, res as never, (() => {}) as never);

        assert.equal(res.statusCode, 400);
        assert.deepEqual(res.body, {
            success: false,
            error: {
                code: 'INVALID_BODY',
                message: 'A valid rootCauseCategory and outcome are required.',
                domain: 'trading.diagnosis',
            },
        });
    });

    it('records an investigation outcome with context', async () => {
        const calls: unknown[] = [];
        const handler = createCreateTradingDiagnosisOutcomeRouteHandler({
            recordOutcome: async (input) => {
                calls.push(input);
                return makeDiagnosisOutcomeRecord();
            },
        });
        const res = makeResponse();

        await handler({
            params: { code: 'songTrap', version: '3' },
            body: {
                backtestRunId: 'run-1',
                indicatorInstanceId: 'inst-1',
                tradeRecordId: 'trade-1',
                rootCauseCategory: 'broker-execution',
                outcome: 'escalated',
                summary: 'Escalated after repeated broker rejection evidence.',
            },
        } as never, res as never, (() => {}) as never);

        assert.equal(res.statusCode, 201);
        assert.deepEqual(calls, [{
            code: 'songTrap',
            version: 3,
            backtestRunId: 'run-1',
            indicatorInstanceId: 'inst-1',
            tradeRecordId: 'trade-1',
            rootCauseCategory: 'broker-execution',
            outcome: 'escalated',
            summary: 'Escalated after repeated broker rejection evidence.',
        }]);
        assert.equal((res.body as { data: { id: string } }).data.id, 'diag-1');
    });
});

describe('registerTradingOperationsRoutes', () => {
    it('guards diagnosis outcome writes behind the write capability tier', async () => {
        const previousRead = process.env.FEATURE_TRADING_READ;
        const previousWrite = process.env.FEATURE_TRADING_WRITE;
        const previousAuto = process.env.FEATURE_TRADING_AUTO;

        process.env.FEATURE_TRADING_READ = 'true';
        process.env.FEATURE_TRADING_WRITE = 'false';
        process.env.FEATURE_TRADING_AUTO = 'false';

        try {
            const { app, postRoutes } = makeAppRecorder();
            registerTradingOperationsRoutes(app, {} as never);

            const route = postRoutes.find((entry) => entry.path === '/api/trading/operations/diagnosis/:code/:version');
            assert.ok(route);
            assert.equal(route.handlers.length, 4);

            const req = {
                headers: {
                    authorization: 'Bearer legacy-session-token',
                },
            };
            const res = {
                locals: {},
                statusCode: 200,
                body: null as unknown,
                status(code: number) {
                    this.statusCode = code;
                    return this;
                },
                json(payload: unknown) {
                    this.body = payload;
                    return this;
                },
            };

            let authNextCalled = false;
            await route.handlers[0](req, res, () => {
                authNextCalled = true;
            });
            assert.equal(authNextCalled, true);

            let capabilityNextCalled = false;
            await route.handlers[1](req, res, () => {
                capabilityNextCalled = true;
            });

            assert.equal(capabilityNextCalled, false);
            assert.equal(res.statusCode, 403);
            assert.deepEqual(res.body, {
                success: false,
                error: {
                    code: 'TRADING_FEATURE_DISABLED',
                    message: 'Trading write capability is disabled at runtime. Manual activation and command submission stop before commitment until FEATURE_TRADING_WRITE is enabled.',
                    domain: 'trading.execution',
                    meta: {
                        tier: 'write',
                        blockedBy: ['trading_write_enabled'],
                        flags: {
                            trading_read_enabled: true,
                            trading_write_enabled: false,
                            trading_automation_enabled: false,
                        },
                        evaluatedAt: (res.body as { error: { meta: { evaluatedAt: string } } }).error.meta.evaluatedAt,
                    },
                },
            });
            assert.equal(
                typeof (res.body as { error: { meta: { evaluatedAt: string } } }).error.meta.evaluatedAt,
                'string',
            );
        } finally {
            if (previousRead === undefined) {
                delete process.env.FEATURE_TRADING_READ;
            } else {
                process.env.FEATURE_TRADING_READ = previousRead;
            }

            if (previousWrite === undefined) {
                delete process.env.FEATURE_TRADING_WRITE;
            } else {
                process.env.FEATURE_TRADING_WRITE = previousWrite;
            }

            if (previousAuto === undefined) {
                delete process.env.FEATURE_TRADING_AUTO;
            } else {
                process.env.FEATURE_TRADING_AUTO = previousAuto;
            }
        }
    });

    it('returns paper-account write and automation capability overrides from the access snapshot', async () => {
        const previousRead = process.env.FEATURE_TRADING_READ;
        const previousWrite = process.env.FEATURE_TRADING_WRITE;
        const previousAuto = process.env.FEATURE_TRADING_AUTO;

        process.env.FEATURE_TRADING_READ = 'true';
        process.env.FEATURE_TRADING_WRITE = 'false';
        process.env.FEATURE_TRADING_AUTO = 'false';

        try {
            const { app, getRoutes } = makeAppRecorder();
            registerTradingOperationsRoutes(app, createTradingAccessPrismaMock('PAPER'));

            const route = getRoutes.find((entry) => entry.path === '/api/trading/operations/access');
            assert.ok(route);

            const res = {
                locals: {
                    authorizedUser: {
                        id: 'user-1',
                        role: 'USER' as const,
                    },
                },
                statusCode: 200,
                body: null as unknown,
                status(code: number) {
                    this.statusCode = code;
                    return this;
                },
                json(payload: unknown) {
                    this.body = payload;
                    return this;
                },
            };

            await route.handlers[0]({
                query: {
                    accountId: 'acct-1',
                },
            } as never, res as never, (() => {}) as never);

            assert.equal(res.statusCode, 200);
            assert.equal((res.body as { data: { capabilities: { write: { enabled: boolean }; automation: { enabled: boolean } } } }).data.capabilities.write.enabled, true);
            assert.equal((res.body as { data: { capabilities: { write: { requested: boolean }; automation: { enabled: boolean } } } }).data.capabilities.write.requested, true);
            assert.equal((res.body as { data: { capabilities: { automation: { enabled: boolean; requested: boolean } } } }).data.capabilities.automation.enabled, true);
            assert.equal((res.body as { data: { capabilities: { automation: { enabled: boolean; requested: boolean } } } }).data.capabilities.automation.requested, true);
        } finally {
            if (previousRead === undefined) {
                delete process.env.FEATURE_TRADING_READ;
            } else {
                process.env.FEATURE_TRADING_READ = previousRead;
            }

            if (previousWrite === undefined) {
                delete process.env.FEATURE_TRADING_WRITE;
            } else {
                process.env.FEATURE_TRADING_WRITE = previousWrite;
            }

            if (previousAuto === undefined) {
                delete process.env.FEATURE_TRADING_AUTO;
            } else {
                process.env.FEATURE_TRADING_AUTO = previousAuto;
            }
        }
    });
});

describe('createGetTradingChecklistRouteHandler', () => {
    function makeChecklistResponse(overrides: Partial<{
        mt5Connected: boolean;
        hasCompletedBacktest: boolean;
        hasLiveEligibleSignal: boolean;
        hasPaperTradingActive: boolean;
    }> = {}) {
        return {
            mt5Connected: true,
            hasCompletedBacktest: true,
            hasLiveEligibleSignal: true,
            hasPaperTradingActive: false,
            ...overrides,
        };
    }

    function makeAuthResponse() {
        return {
            locals: { authorizedUser: { id: 'user-1', role: 'USER' as const } },
            statusCode: 200,
            body: null as unknown,
            status(code: number) { this.statusCode = code; return this; },
            json(payload: unknown) { this.body = payload; return this; },
        };
    }

    it('returns all 4 checklist items with 200', async () => {
        const checklistData = makeChecklistResponse();
        const handler = createGetTradingChecklistRouteHandler({
            getChecklist: async () => checklistData,
        });
        const res = makeAuthResponse();

        await handler({} as never, res as never, (() => {}) as never);

        assert.equal(res.statusCode, 200);
        const body = res.body as { success: boolean; data: typeof checklistData };
        assert.equal(body.success, true);
        assert.equal(body.data.mt5Connected, true);
        assert.equal(body.data.hasPaperTradingActive, false);
    });

    it('returns 401 when no authorized user in locals', async () => {
        const handler = createGetTradingChecklistRouteHandler({
            getChecklist: async () => makeChecklistResponse(),
        });
        const res = {
            locals: {},
            statusCode: 200,
            body: null as unknown,
            status(code: number) { this.statusCode = code; return this; },
            json(payload: unknown) { this.body = payload; return this; },
        };

        await handler({} as never, res as never, (() => {}) as never);

        assert.equal(res.statusCode, 401);
    });
});
