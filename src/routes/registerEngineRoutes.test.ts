import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
    createGetBacktestLeaderboardRouteHandler,
    createListRunsRouteHandler,
} from './registerEngineRoutes';

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

describe('createGetBacktestLeaderboardRouteHandler', () => {
    it('rejects invalid leaderboard mode', async () => {
        const handler = createGetBacktestLeaderboardRouteHandler({
            getGeneratedBacktestLeaderboard: async () => ({}) as never,
        });
        const res = makeResponse();

        await handler(
            { query: { mode: 'bad-mode' } } as never,
            res as never,
            (() => {}) as never,
        );

        assert.equal(res.statusCode, 400);
        assert.deepEqual(res.body, {
            error: 'mode must be ALL_RUNS or BEST_PER_SIGNAL',
        });
    });

    it('rejects invalid minClosedTrades values', async () => {
        const handler = createGetBacktestLeaderboardRouteHandler({
            getGeneratedBacktestLeaderboard: async () => ({}) as never,
        });
        const res = makeResponse();

        await handler(
            { query: { minClosedTrades: 'abc' } } as never,
            res as never,
            (() => {}) as never,
        );

        assert.equal(res.statusCode, 400);
        assert.deepEqual(res.body, {
            error: 'minClosedTrades must be a non-negative integer',
        });
    });

    it('accepts minClosedTrades=0 so users can clear the sample-size filter', async () => {
        let capturedFilters: unknown = null;
        const handler = createGetBacktestLeaderboardRouteHandler({
            getGeneratedBacktestLeaderboard: async (filters) => {
                capturedFilters = filters;
                return {
                    rows: [],
                    pagination: { page: 1, pageSize: 20, totalRows: 0, totalPages: 0 },
                    summary: { totalRows: 0, totalSignals: 0, constructiveRows: 0, weakerRows: 0, suspiciousRows: 0 },
                    mode: 'ALL_RUNS',
                    sort: 'rank',
                    order: 'desc',
                } as never;
            },
        });
        const res = makeResponse();

        await handler(
            { query: { minClosedTrades: '0' } } as never,
            res as never,
            (() => {}) as never,
        );

        assert.equal(res.statusCode, 200);
        assert.deepEqual(capturedFilters, {
            signalCode: undefined,
            symbol: undefined,
            timeframe: undefined,
            status: undefined,
            from: undefined,
            to: undefined,
            minClosedTrades: 0,
        });
    });

    it('passes parsed query options to the analytics service', async () => {
        let capturedFilters: unknown = null;
        let capturedOptions: unknown = null;
        const handler = createGetBacktestLeaderboardRouteHandler({
            getGeneratedBacktestLeaderboard: async (filters, options) => {
                capturedFilters = filters;
                capturedOptions = options;
                return {
                    rows: [],
                    pagination: { page: 2, pageSize: 25, totalRows: 0, totalPages: 0 },
                    summary: { totalRows: 0, totalSignals: 0, constructiveRows: 0, weakerRows: 0, suspiciousRows: 0 },
                    mode: 'BEST_PER_SIGNAL',
                    sort: 'netR',
                    order: 'asc',
                } as never;
            },
        });
        const res = makeResponse();

        await handler(
            {
                query: {
                    mode: 'BEST_PER_SIGNAL',
                    signalCode: 'song',
                    symbol: 'xauusd',
                    timeframe: '1h',
                    status: 'COMPLETED',
                    from: '2026-03-01T00:00:00.000Z',
                    to: '2026-03-10T23:59:59.999Z',
                    minClosedTrades: '5',
                    page: '2',
                    pageSize: '25',
                    sort: 'netR',
                    order: 'asc',
                },
            } as never,
            res as never,
            (() => {}) as never,
        );

        assert.equal(res.statusCode, 200);
        assert.deepEqual(capturedFilters, {
            signalCode: 'song',
            symbol: 'XAUUSD',
            timeframe: '1h',
            status: 'COMPLETED',
            from: new Date('2026-03-01T00:00:00.000Z'),
            to: new Date('2026-03-10T23:59:59.999Z'),
            minClosedTrades: 5,
        });
        assert.deepEqual(capturedOptions, {
            mode: 'BEST_PER_SIGNAL',
            page: 2,
            pageSize: 25,
            sort: 'netR',
            order: 'asc',
        });
        assert.deepEqual(res.body, {
            data: {
                rows: [],
                pagination: { page: 2, pageSize: 25, totalRows: 0, totalPages: 0 },
                summary: { totalRows: 0, totalSignals: 0, constructiveRows: 0, weakerRows: 0, suspiciousRows: 0 },
                mode: 'BEST_PER_SIGNAL',
                sort: 'netR',
                order: 'asc',
            },
        });
    });
});

describe('createListRunsRouteHandler', () => {
    it('forwards includeId so archived leaderboard runs can still hydrate the report shell', async () => {
        let capturedOptions: unknown = null;
        const handler = createListRunsRouteHandler({
            listRuns: async (options) => {
                capturedOptions = options;
                return [{ id: 'run-archived' }] as never;
            },
        });
        const res = makeResponse();

        await handler(
            { query: { includeId: 'run-archived' } } as never,
            res as never,
            (() => {}) as never,
        );

        assert.equal(res.statusCode, 200);
        assert.deepEqual(capturedOptions, {
            includeId: 'run-archived',
        });
        assert.deepEqual(res.body, {
            data: [{ id: 'run-archived' }],
        });
    });

    it('omits includeId when the caller is just loading the default recent-run catalog', async () => {
        let capturedOptions: unknown = null;
        const handler = createListRunsRouteHandler({
            listRuns: async (options) => {
                capturedOptions = options;
                return [] as never;
            },
        });
        const res = makeResponse();

        await handler(
            { query: {} } as never,
            res as never,
            (() => {}) as never,
        );

        assert.equal(res.statusCode, 200);
        assert.deepEqual(capturedOptions, {
            includeId: undefined,
        });
    });
});
