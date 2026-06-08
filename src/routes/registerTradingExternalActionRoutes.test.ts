import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { registerTradingExternalActionRoutes } from './registerTradingExternalActionRoutes';

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

function makeResponse() {
    return {
        locals: {
            authorizedUser: {
                id: 'user-1',
                role: 'USER',
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

describe('registerTradingExternalActionRoutes', () => {
    it('registers deployment, event, delivery, and replay routes', () => {
        const previousRead = process.env.FEATURE_TRADING_READ;
        const previousWrite = process.env.FEATURE_TRADING_WRITE;

        process.env.FEATURE_TRADING_READ = 'true';
        process.env.FEATURE_TRADING_WRITE = 'true';

        try {
            const { app, getRoutes, postRoutes } = makeAppRecorder();
            registerTradingExternalActionRoutes(app, {} as never, {
                deploymentService: {
                    createDeploymentForActor: async () => { throw new Error('unused'); },
                    listDeploymentsForActor: async () => [],
                    enableDeploymentForActor: async () => { throw new Error('unused'); },
                    pauseDeploymentForActor: async () => { throw new Error('unused'); },
                    archiveDeploymentForActor: async () => { throw new Error('unused'); },
                },
                store: {
                    listActionableEvents: async () => [],
                    listDeliveries: async () => [],
                } as never,
                replayService: {
                    replayEvent: async () => ({
                        id: 'replay-1',
                        externalActionEventId: 'event-1',
                        replayKind: 'MANUAL_RETRY',
                        status: 'QUEUED',
                        queuedAt: '2026-03-13T10:00:00.000Z',
                        startedAt: null,
                        finishedAt: null,
                        errorMessage: null,
                        createdByUserId: 'user-1',
                        createdAt: '2026-03-13T10:00:00.000Z',
                    }),
                },
            });

            assert.ok(getRoutes.find((route) => route.path === '/api/trading/external-actions/deployments'));
            assert.ok(postRoutes.find((route) => route.path === '/api/trading/external-actions/deployments'));
            assert.ok(postRoutes.find((route) => route.path === '/api/trading/external-actions/deployments/:id/enable'));
            assert.ok(postRoutes.find((route) => route.path === '/api/trading/external-actions/deployments/:id/pause'));
            assert.ok(postRoutes.find((route) => route.path === '/api/trading/external-actions/deployments/:id/archive'));
            assert.ok(getRoutes.find((route) => route.path === '/api/trading/external-actions/events'));
            assert.ok(getRoutes.find((route) => route.path === '/api/trading/external-actions/deliveries'));
            assert.ok(postRoutes.find((route) => route.path === '/api/trading/external-actions/events/:id/replay'));
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
        }
    });

    it('returns masked deployment details from the injected service', async () => {
        const previousRead = process.env.FEATURE_TRADING_READ;
        process.env.FEATURE_TRADING_READ = 'true';

        try {
            const { app, getRoutes } = makeAppRecorder();
            const listCalls: unknown[] = [];
            registerTradingExternalActionRoutes(app, {} as never, {
                deploymentService: {
                    createDeploymentForActor: async () => { throw new Error('unused'); },
                    listDeploymentsForActor: async (...args: unknown[]) => {
                        listCalls.push(args);
                        return [{
                        id: 'dep-1',
                        ownerUserId: 'user-1',
                        indicatorInstanceId: 'inst-1',
                        signalCode: 'songTrap',
                        signalVersion: 3,
                        sourceBacktestRunId: 'run-1',
                        status: 'ACTIVE',
                        statusReason: null,
                        eligibilityStateSnapshot: 'live-eligible',
                        telegramBotLabel: 'ops-bot',
                        telegramBotTokenCiphertext: 'ciphertext',
                        telegramChatId: '-1001',
                        telegramChatLabel: 'VIP',
                        messageTemplateKind: 'DEFAULT_V1',
                        createdByUserId: 'user-1',
                        enabledByUserId: 'user-1',
                        pausedByUserId: null,
                        archivedByUserId: null,
                        enabledAt: '2026-03-13T10:00:00.000Z',
                        pausedAt: null,
                        archivedAt: null,
                        lastEligibilityCheckAt: '2026-03-13T10:00:00.000Z',
                        createdAt: '2026-03-13T09:00:00.000Z',
                        updatedAt: '2026-03-13T10:00:00.000Z',
                    }];
                    },
                    enableDeploymentForActor: async () => { throw new Error('unused'); },
                    pauseDeploymentForActor: async () => { throw new Error('unused'); },
                    archiveDeploymentForActor: async () => { throw new Error('unused'); },
                },
                store: {
                    listActionableEvents: async () => [],
                    listDeliveries: async () => [],
                } as never,
                replayService: {
                    replayEvent: async () => ({
                        id: 'replay-1',
                        externalActionEventId: 'event-1',
                        replayKind: 'MANUAL_RETRY',
                        status: 'QUEUED',
                        queuedAt: '2026-03-13T10:00:00.000Z',
                        startedAt: null,
                        finishedAt: null,
                        errorMessage: null,
                        createdByUserId: 'user-1',
                        createdAt: '2026-03-13T10:00:00.000Z',
                    }),
                },
            });

            const route = getRoutes.find((entry) => entry.path === '/api/trading/external-actions/deployments');
            assert.ok(route);

            const res = makeResponse();
            await route.handlers[2]({ query: {} } as never, res as never, (() => {}) as never);

            assert.equal(res.statusCode, 200);
            assert.equal((res.body as { data: { deployments: Array<{ hasTelegramBotToken: boolean }> } }).data.deployments[0].hasTelegramBotToken, true);
            const [actor, filters, scope] = listCalls[0] as [
                { id: string; role: string },
                { indicatorInstanceId: string | null; status: string | null; limit: number },
                { ownerUserId: string | null },
            ];
            assert.deepEqual(actor, { id: 'user-1', role: 'USER' });
            assert.deepEqual(filters, {
                indicatorInstanceId: null,
                status: null,
                limit: 100,
            });
            assert.deepEqual(scope, { ownerUserId: null });
        } finally {
            if (previousRead === undefined) {
                delete process.env.FEATURE_TRADING_READ;
            } else {
                process.env.FEATURE_TRADING_READ = previousRead;
            }
        }
    });

    it('blocks non-admin users from querying another owner scope', async () => {
        const previousRead = process.env.FEATURE_TRADING_READ;
        process.env.FEATURE_TRADING_READ = 'true';

        try {
            const { app, getRoutes } = makeAppRecorder();
            registerTradingExternalActionRoutes(app, {} as never, {
                deploymentService: {
                    createDeploymentForActor: async () => { throw new Error('unused'); },
                    listDeploymentsForActor: async () => [],
                    enableDeploymentForActor: async () => { throw new Error('unused'); },
                    pauseDeploymentForActor: async () => { throw new Error('unused'); },
                    archiveDeploymentForActor: async () => { throw new Error('unused'); },
                },
                store: {
                    listActionableEvents: async () => [],
                    listDeliveries: async () => [],
                } as never,
                replayService: {
                    replayEvent: async () => { throw new Error('unused'); },
                },
            });

            const route = getRoutes.find((entry) => entry.path === '/api/trading/external-actions/events');
            assert.ok(route);

            const res = makeResponse();
            await route.handlers[2]({ query: { userId: 'user-2' } } as never, res as never, (() => {}) as never);

            assert.equal(res.statusCode, 403);
            assert.match(JSON.stringify(res.body), /only access deployments owned by the current user/i);
        } finally {
            if (previousRead === undefined) {
                delete process.env.FEATURE_TRADING_READ;
            } else {
                process.env.FEATURE_TRADING_READ = previousRead;
            }
        }
    });
});
