import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
    createCreateTradingAutomationBindingRouteHandler,
    createCreateTradingExecutionCommandRouteHandler,
    createForceSyncTradingAccountRouteHandler,
    createGetTradingAccountSummaryRouteHandler,
    createGetTradingDealsRouteHandler,
    createListTradingAutoExecutionIntentsRouteHandler,
    createGetTradingWorkspaceRouteHandler,
    createPaperSetupRouteHandler,
    registerTradingWorkspaceRoutes,
} from './registerTradingWorkspaceRoutes';
import { PaperSetupServiceError } from '../services/trading/PaperSetupService';

function makeSummary() {
    return {
        accountId: 'acct-1',
        accountLabel: 'Pilot MT5',
        brokerKind: 'MT5' as const,
        accountMode: 'PAPER' as const,
        accountStatus: 'ACTIVE',
        mt5Login: '10001',
        mt5Server: 'Demo',
        baseCurrency: 'USD',
        leverage: 500,
        balance: 10000,
        equity: 10120,
        margin: 420,
        freeMargin: 9700,
        marginLevel: 2400,
        unrealizedPnl: 120,
        realizedPnlDay: 80,
        openPositionCount: 2,
        pendingOrderCount: 1,
        totalDealCount: 8,
        syncHealth: {
            state: 'healthy' as const,
            label: 'Healthy',
            message: 'Mirror state is current enough for monitoring and broker interaction.',
            lastSuccessfulSyncAt: '2026-03-11T10:00:00.000Z',
            lastSyncAttemptAt: '2026-03-11T10:00:00.000Z',
            staleAfterSeconds: 300,
            canForceSync: true,
            canTrade: true,
        },
        evaluatedAt: '2026-03-11T10:00:00.000Z',
    };
}

function makeWorkspace() {
    return {
        summary: makeSummary(),
        positions: [],
        orders: [],
        deals: [],
        syncRuns: [],
    };
}

function makeResponse() {
    return {
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
}

function makeAppRecorder() {
    const getRoutes: Array<{ path: string; handlers: Function[] }> = [];
    const postRoutes: Array<{ path: string; handlers: Function[] }> = [];
    const patchRoutes: Array<{ path: string; handlers: Function[] }> = [];

    const app = {
        get(path: string, ...handlers: Function[]) {
            getRoutes.push({ path, handlers });
            return app;
        },
        post(path: string, ...handlers: Function[]) {
            postRoutes.push({ path, handlers });
            return app;
        },
        patch(path: string, ...handlers: Function[]) {
            patchRoutes.push({ path, handlers });
            return app;
        },
    };

    return {
        app: app as never,
        getRoutes,
        postRoutes,
        patchRoutes,
    };
}

function captureConsoleMethod<T extends 'info' | 'warn' | 'error'>(
    method: T,
) {
    const original = console[method];
    const lines: string[] = [];
    console[method] = ((value?: unknown, ...rest: unknown[]) => {
        lines.push([value, ...rest].map((item) => String(item)).join(' '));
    }) as typeof console[T];
    return {
        lines,
        restore() {
            console[method] = original;
        },
    };
}

function createAccountScopePrismaMock(accountMode: 'LIVE' | 'PAPER') {
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

describe('createGetTradingWorkspaceRouteHandler', () => {
    it('returns the aggregated workspace snapshot', async () => {
        const calls: unknown[] = [];
        const handler = createGetTradingWorkspaceRouteHandler({
            getWorkspace: async (actor, accountId, scope) => {
                calls.push({ actor, accountId, scope });
                return makeWorkspace();
            },
        });
        const res = makeResponse();

        await handler({
            params: { id: 'acct-1' },
            query: { userId: 'user-2' },
        } as never, res as never, (() => {}) as never);

        assert.equal(res.statusCode, 200);
        assert.equal((res.body as { success: boolean }).success, true);
        assert.equal((res.body as { data: { summary: { accountId: string } } }).data.summary.accountId, 'acct-1');
        assert.deepEqual(calls[0], {
            actor: { id: 'user-1', role: 'USER' },
            accountId: 'acct-1',
            scope: { ownerUserId: 'user-2' },
        });
    });
});

describe('createGetTradingAccountSummaryRouteHandler', () => {
    it('returns the account summary payload', async () => {
        const handler = createGetTradingAccountSummaryRouteHandler({
            getSummary: async () => makeSummary(),
        });
        const res = makeResponse();

        await handler({
            params: { id: 'acct-1' },
        } as never, res as never, (() => {}) as never);

        assert.equal(res.statusCode, 200);
        assert.equal((res.body as { data: { accountLabel: string } }).data.accountLabel, 'Pilot MT5');
    });
});

describe('createForceSyncTradingAccountRouteHandler', () => {
    it('returns the refreshed workspace payload with accepted status', async () => {
        const handler = createForceSyncTradingAccountRouteHandler({
            forceSync: async () => makeWorkspace(),
        });
        const res = makeResponse();

        await handler({
            params: { id: 'acct-1' },
        } as never, res as never, (() => {}) as never);

        assert.equal(res.statusCode, 202);
        assert.equal((res.body as { data: { summary: { accountStatus: string } } }).data.summary.accountStatus, 'ACTIVE');
    });
});

describe('createGetTradingDealsRouteHandler', () => {
    it('passes validated limit and UTC date-range params through to the workspace service', async () => {
        const calls: unknown[] = [];
        const handler = createGetTradingDealsRouteHandler({
            listDeals: async (actor, accountId, query, scope) => {
                calls.push({ actor, accountId, query, scope });
                return [];
            },
        });
        const res = makeResponse();

        await handler({
            params: { id: 'acct-1' },
            query: {
                limit: '25',
                from: '2026-03-01T00:00:00.000Z',
                to: '2026-03-05T23:59:59.999Z',
                userId: 'user-2',
            },
        } as never, res as never, (() => {}) as never);

        assert.equal(res.statusCode, 200);
        assert.equal(calls.length, 1);
        assert.deepEqual(calls[0], {
            actor: { id: 'user-1', role: 'USER' },
            accountId: 'acct-1',
            query: {
                limit: 25,
                from: new Date('2026-03-01T00:00:00.000Z'),
                to: new Date('2026-03-05T23:59:59.999Z'),
            },
            scope: {
                ownerUserId: 'user-2',
            },
        });
    });

    it('rejects invalid date ranges before hitting the workspace service', async () => {
        const handler = createGetTradingDealsRouteHandler({
            listDeals: async () => {
                throw new Error('should not run');
            },
        });
        const res = makeResponse();

        await handler({
            params: { id: 'acct-1' },
            query: {
                from: '2026-03-06T00:00:00.000Z',
                to: '2026-03-05T23:59:59.999Z',
            },
        } as never, res as never, (() => {}) as never);

        assert.equal(res.statusCode, 400);
        assert.deepEqual(res.body, {
            success: false,
            error: {
                code: 'INVALID_PARAMS',
                message: 'from must be less than or equal to to.',
                domain: 'trading.workspace',
            },
        });
    });
});

describe('createCreateTradingExecutionCommandRouteHandler', () => {
    it('rejects invalid command types', async () => {
        const handler = createCreateTradingExecutionCommandRouteHandler({
            createCommand: async () => {
                throw new Error('should not run');
            },
        });
        const res = makeResponse();
        const warnCapture = captureConsoleMethod('warn');

        try {
            await handler({
                params: { id: 'acct-1' },
                body: { commandType: 'NOPE' },
            } as never, res as never, (() => {}) as never);
        } finally {
            warnCapture.restore();
        }

        assert.equal(res.statusCode, 400);
        assert.deepEqual(res.body, {
            success: false,
            error: {
                code: 'INVALID_BODY',
                message: 'A supported commandType is required.',
                domain: 'trading.execution',
            },
        });
        assert.equal(warnCapture.lines.some((line) => line.includes('"event":"command_route_invalid_body"')), true);
    });
});

describe('createCreateTradingAutomationBindingRouteHandler', () => {
    it('creates a binding payload', async () => {
        const handler = createCreateTradingAutomationBindingRouteHandler({
            createBinding: async (_actor, _accountId, input) => ({
                id: 'binding-1',
                accountId: 'acct-1',
                indicatorInstanceId: input.indicatorInstanceId,
                indicatorName: 'Live Song Trap',
                indicatorStatus: 'ACTIVE',
                signalCode: 'songTrap',
                signalVersion: 3,
                symbol: 'XAUUSD',
                timeframe: 'H1',
                name: input.name,
                status: 'PENDING_APPROVAL',
                mode: input.mode,
                approvalRequired: true,
                killSwitchActive: false,
                createdByUserId: 'user-1',
                approvedByUserId: null,
                approvedAt: null,
                lastTriggeredAt: null,
                statusReason: null,
                filtersJson: null,
                riskConfigJson: null,
                guardrailsJson: null,
                createdAt: '2026-03-11T10:00:00.000Z',
                updatedAt: '2026-03-11T10:00:00.000Z',
            }),
        });
        const res = makeResponse();

        await handler({
            params: { id: 'acct-1' },
            body: {
                indicatorInstanceId: 'inst-1',
                name: 'London Trap',
                mode: 'MANUAL_APPROVAL',
            },
        } as never, res as never, (() => {}) as never);

        assert.equal(res.statusCode, 201);
        assert.equal((res.body as { data: { status: string } }).data.status, 'PENDING_APPROVAL');
        assert.equal((res.body as { data: { name: string } }).data.name, 'London Trap');
    });
});

describe('createListTradingAutoExecutionIntentsRouteHandler scope', () => {
    it('forwards explicit owner scope alongside limit', async () => {
        const calls: unknown[] = [];
        const handler = createListTradingAutoExecutionIntentsRouteHandler({
            listIntents: async (actor, accountId, query, scope) => {
                calls.push({ actor, accountId, query, scope });
                return [];
            },
        });
        const res = makeResponse();

        await handler({
            params: { id: 'acct-1' },
            query: { limit: '10', userId: 'user-2' },
        } as never, res as never, (() => {}) as never);

        assert.equal(res.statusCode, 200);
        assert.deepEqual(calls[0], {
            actor: { id: 'user-1', role: 'USER' },
            accountId: 'acct-1',
            query: { limit: 10 },
            scope: { ownerUserId: 'user-2' },
        });
    });
});

describe('createListTradingAutoExecutionIntentsRouteHandler', () => {
    it('returns recent paper automation intents', async () => {
        const handler = createListTradingAutoExecutionIntentsRouteHandler({
            listIntents: async () => [{
                id: 'intent-1',
                accountId: 'acct-1',
                bindingId: 'binding-1',
                bindingName: 'Paper Auto',
                indicatorInstanceId: 'inst-1',
                indicatorName: 'Live Song Trap',
                signalEventId: 'evt-1',
                executionCommandId: 'cmd-1',
                executionCommandStatus: 'RECONCILED',
                executionCommandError: null,
                mode: 'AUTO_EXECUTE',
                status: 'EXECUTED',
                statusReason: 'Paper auto-execution completed through the approved command boundary.',
                eventType: 'ENTRY',
                commandType: 'OPEN_MARKET',
                symbol: 'XAUUSD',
                side: 'LONG',
                volume: 0.1,
                entryPrice: 3230,
                stopLoss: 3220,
                takeProfit: 3240,
                candleTime: '2026-03-11T10:00:00.000Z',
                createdAt: '2026-03-11T10:00:00.000Z',
                updatedAt: '2026-03-11T10:00:05.000Z',
                startedAt: '2026-03-11T10:00:01.000Z',
                completedAt: '2026-03-11T10:00:05.000Z',
                payloadJson: null,
            }],
        });
        const res = makeResponse();

        await handler({
            params: { id: 'acct-1' },
        } as never, res as never, (() => {}) as never);

        assert.equal(res.statusCode, 200);
        assert.equal((res.body as { data: { items: Array<{ id: string }> } }).data.items[0].id, 'intent-1');
    });
});

describe('createPaperSetupRouteHandler', () => {
    it('returns 201 with instanceId and bindingId on success', async () => {
        const handler = createPaperSetupRouteHandler({
            setup: async () => ({
                instanceId: 'instance-1',
                bindingId: 'binding-1',
                accountId: 'acct-1',
                signalCode: 'SIG_TEST',
                signalVersion: 1,
                signalName: 'Test Signal',
            }),
        });
        const res = makeResponse();

        await handler({
            params: { id: 'acct-1' },
            body: { signalCode: 'SIG_TEST', signalVersion: 1, riskPercent: 0.5, symbol: 'XAUUSD', timeframe: 'H1' },
        } as never, res as never, (() => {}) as never);

        assert.equal(res.statusCode, 201);
        const body = res.body as { success: boolean; data: { instanceId: string; bindingId: string } };
        assert.equal(body.success, true);
        assert.equal(body.data.instanceId, 'instance-1');
        assert.equal(body.data.bindingId, 'binding-1');
    });

    it('returns 400 when signalCode is missing from the body', async () => {
        const handler = createPaperSetupRouteHandler({
            setup: async () => { throw new Error('should not be called'); },
        });
        const res = makeResponse();

        await handler({
            params: { id: 'acct-1' },
            body: { signalVersion: 1, riskPercent: 0.5 },
        } as never, res as never, (() => {}) as never);

        assert.equal(res.statusCode, 400);
        assert.equal((res.body as { error: { code: string } }).error.code, 'INVALID_BODY');
    });

    it('returns 400 when riskPercent is not a positive number', async () => {
        const handler = createPaperSetupRouteHandler({
            setup: async () => { throw new Error('should not be called'); },
        });
        const res = makeResponse();

        await handler({
            params: { id: 'acct-1' },
            body: { signalCode: 'SIG_TEST', signalVersion: 1, riskPercent: -1 },
        } as never, res as never, (() => {}) as never);

        assert.equal(res.statusCode, 400);
    });

    it('forwards PaperSetupServiceError status code and code to the response', async () => {
        const handler = createPaperSetupRouteHandler({
            setup: async () => {
                throw new PaperSetupServiceError(409, 'ACCOUNT_NOT_PAPER', 'Account is LIVE.', 'trading.paper-setup');
            },
        });
        const res = makeResponse();

        await handler({
            params: { id: 'acct-1' },
            body: { signalCode: 'SIG_TEST', signalVersion: 1, riskPercent: 0.5, symbol: 'XAUUSD', timeframe: 'H1' },
        } as never, res as never, (() => {}) as never);

        assert.equal(res.statusCode, 409);
        assert.equal((res.body as { error: { code: string } }).error.code, 'ACCOUNT_NOT_PAPER');
    });
});

describe('registerTradingWorkspaceRoutes', () => {
    it('registers mirror, command, and automation endpoints', () => {
        const { app, getRoutes, postRoutes, patchRoutes } = makeAppRecorder();
        registerTradingWorkspaceRoutes(app, {} as never);

        assert.equal(getRoutes.some((route) => route.path === '/api/trading/accounts/:id/workspace'), true);
        assert.equal(getRoutes.some((route) => route.path === '/api/trading/accounts/:id/summary'), true);
        assert.equal(getRoutes.some((route) => route.path === '/api/trading/accounts/:id/commands'), true);
        assert.equal(getRoutes.some((route) => route.path === '/api/trading/accounts/:id/automation/intents'), true);
        assert.equal(postRoutes.some((route) => route.path === '/api/trading/accounts/:id/sync'), true);
        assert.equal(postRoutes.some((route) => route.path === '/api/trading/accounts/:id/commands'), true);
        assert.equal(postRoutes.some((route) => route.path === '/api/trading/accounts/:id/automation/bindings'), true);
        assert.equal(patchRoutes.some((route) => route.path === '/api/trading/accounts/:id/automation/bindings/:bindingId'), true);
    });

    it('allows paper accounts through the write capability gate even when live write flags are off', async () => {
        const previousRead = process.env.FEATURE_TRADING_READ;
        const previousWrite = process.env.FEATURE_TRADING_WRITE;
        const previousAuto = process.env.FEATURE_TRADING_AUTO;

        process.env.FEATURE_TRADING_READ = 'true';
        process.env.FEATURE_TRADING_WRITE = 'false';
        process.env.FEATURE_TRADING_AUTO = 'false';

        try {
            const { app, postRoutes } = makeAppRecorder();
            registerTradingWorkspaceRoutes(app, createAccountScopePrismaMock('PAPER'));
            const route = postRoutes.find((entry) => entry.path === '/api/trading/accounts/:id/commands');
            assert.ok(route);

            const res = makeResponse();
            let nextCalled = false;

            await route.handlers[0]({
                params: { id: 'acct-1' },
            } as never, res as never, () => {
                nextCalled = true;
            });

            assert.equal(nextCalled, true);
            assert.equal(res.statusCode, 200);
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

    it('keeps live accounts blocked behind the runtime write flag when the flag is off', async () => {
        const previousRead = process.env.FEATURE_TRADING_READ;
        const previousWrite = process.env.FEATURE_TRADING_WRITE;
        const previousAuto = process.env.FEATURE_TRADING_AUTO;
        const warnCapture = captureConsoleMethod('warn');

        process.env.FEATURE_TRADING_READ = 'true';
        process.env.FEATURE_TRADING_WRITE = 'false';
        process.env.FEATURE_TRADING_AUTO = 'false';

        try {
            const { app, postRoutes } = makeAppRecorder();
            registerTradingWorkspaceRoutes(app, createAccountScopePrismaMock('LIVE'));
            const route = postRoutes.find((entry) => entry.path === '/api/trading/accounts/:id/commands');
            assert.ok(route);

            const res = makeResponse();
            let nextCalled = false;

            await route.handlers[0]({
                params: { id: 'acct-1' },
            } as never, res as never, () => {
                nextCalled = true;
            });

            assert.equal(nextCalled, false);
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
                        accountMode: 'LIVE',
                    },
                },
            });
            assert.equal(
                typeof (res.body as { error: { meta: { evaluatedAt: string } } }).error.meta.evaluatedAt,
                'string',
            );
            assert.equal(warnCapture.lines.some((line) => line.includes('"event":"command_capability_blocked"')), true);
        } finally {
            warnCapture.restore();
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
