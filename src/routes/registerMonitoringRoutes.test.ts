import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { createGetAdminMonitoringRouteHandler, registerMonitoringRoutes } from './registerMonitoringRoutes';

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

function makeAppRecorder() {
    const getRoutes: Array<{ path: string; handlers: Function[] }> = [];
    const app = {
        get(path: string, ...handlers: Function[]) {
            getRoutes.push({ path, handlers });
            return app;
        },
    };

    return {
        app: app as never,
        getRoutes,
    };
}

describe('createGetAdminMonitoringRouteHandler', () => {
    it('returns the monitoring snapshot envelope', async () => {
        const handler = createGetAdminMonitoringRouteHandler({
            getSnapshot: async () => ({
                cached: false,
                generatedAt: '2026-03-13T10:00:00.000Z',
                cacheTtlMs: 60000,
                health: [],
                candleDistribution: [],
                activeSymbolFreshness: [],
                alerts: [],
                tableCounts: {
                    candles: 1,
                    signals: 2,
                    tradeResults: 3,
                },
            }),
        });
        const res = makeResponse();

        await handler({} as never, res as never, (() => {}) as never);

        assert.equal(res.statusCode, 200);
        assert.deepEqual(res.body, {
            success: true,
            data: {
                cached: false,
                generatedAt: '2026-03-13T10:00:00.000Z',
                cacheTtlMs: 60000,
                health: [],
                candleDistribution: [],
                activeSymbolFreshness: [],
                alerts: [],
                tableCounts: {
                    candles: 1,
                    signals: 2,
                    tradeResults: 3,
                },
            },
        });
    });
});

describe('registerMonitoringRoutes', () => {
    it('registers the admin monitoring endpoint', () => {
        const { app, getRoutes } = makeAppRecorder();
        registerMonitoringRoutes(app, {} as never);

        assert.equal(getRoutes.some((route) => route.path === '/api/admin/monitoring'), true);
    });
});
