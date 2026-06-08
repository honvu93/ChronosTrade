import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
    createGetExportContractsRouteHandler,
    createGetExportContractByKindRouteHandler,
    createGetExportRecordsRouteHandler,
    registerTradingExportRoutes,
} from './registerTradingExportRoutes';

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

describe('createGetExportContractsRouteHandler', () => {
    it('returns all contract definitions with evaluatedAt', async () => {
        const contracts = [
            { kind: 'signal-event', version: 1, label: 'Signal Event', description: 'Test.', fields: [] },
        ];
        const handler = createGetExportContractsRouteHandler({
            listContracts: () => contracts as never,
        });
        const res = makeResponse();

        await handler({} as never, res as never, (() => {}) as never);

        assert.equal(res.statusCode, 200);
        const body = res.body as { success: boolean; data: { contracts: unknown[]; evaluatedAt: string } };
        assert.equal(body.success, true);
        assert.equal(body.data.contracts.length, 1);
        assert.equal(typeof body.data.evaluatedAt, 'string');
    });
});

describe('createGetExportContractByKindRouteHandler', () => {
    it('rejects an invalid contract kind', async () => {
        const handler = createGetExportContractByKindRouteHandler({
            getContract: () => null,
        });
        const res = makeResponse();

        await handler(
            { params: { kind: 'invalid-kind' } } as never,
            res as never,
            (() => {}) as never,
        );

        assert.equal(res.statusCode, 400);
        assert.deepEqual(res.body, {
            success: false,
            error: {
                code: 'INVALID_CONTRACT_KIND',
                message: 'A valid output contract kind is required.',
                domain: 'trading.export',
            },
        });
    });

    it('returns 404 when getContract returns null', async () => {
        const handler = createGetExportContractByKindRouteHandler({
            getContract: () => null,
        });
        const res = makeResponse();

        await handler(
            { params: { kind: 'signal-event' } } as never,
            res as never,
            (() => {}) as never,
        );

        assert.equal(res.statusCode, 404);
        assert.deepEqual(res.body, {
            success: false,
            error: {
                code: 'CONTRACT_NOT_FOUND',
                message: "Output contract 'signal-event' was not found.",
                domain: 'trading.export',
            },
        });
    });

    it('returns the contract definition for a valid kind', async () => {
        const contract = {
            kind: 'signal-event' as const,
            version: 1,
            label: 'Signal Event',
            description: 'Test.',
            fields: [{ name: 'signalCode', type: 'string', required: true, description: 'Code.' }],
        };
        const handler = createGetExportContractByKindRouteHandler({
            getContract: () => contract,
        });
        const res = makeResponse();

        await handler(
            { params: { kind: 'signal-event' } } as never,
            res as never,
            (() => {}) as never,
        );

        assert.equal(res.statusCode, 200);
        const body = res.body as { success: boolean; data: typeof contract };
        assert.equal(body.success, true);
        assert.equal(body.data.kind, 'signal-event');
        assert.equal(body.data.fields.length, 1);
    });
});

describe('createGetExportRecordsRouteHandler', () => {
    it('returns export records with success envelope', async () => {
        const mockResult = {
            records: [{ contractKind: 'trade-outcome', recordId: 'r-1', payload: {} }],
            total: 1,
            query: { backtestRunId: null, indicatorInstanceId: null, contractKind: null, limit: 200 },
            exportedAt: '2026-03-11T08:00:00.000Z',
        };
        const handler = createGetExportRecordsRouteHandler({
            exportRecords: async () => mockResult as never,
        });
        const res = makeResponse();

        await handler(
            { query: {} } as never,
            res as never,
            (() => {}) as never,
        );

        assert.equal(res.statusCode, 200);
        const body = res.body as { success: boolean; data: typeof mockResult };
        assert.equal(body.success, true);
        assert.equal(body.data.records.length, 1);
        assert.equal(body.data.total, 1);
    });

    it('rejects invalid contractKind filter with 400', async () => {
        const handler = createGetExportRecordsRouteHandler({
            exportRecords: async () => ({ records: [], total: 0, query: {}, exportedAt: '' }) as never,
        });
        const res = makeResponse();

        await handler(
            { query: { contractKind: 'invalid-kind' } } as never,
            res as never,
            (() => {}) as never,
        );

        assert.equal(res.statusCode, 400);
        const body = res.body as { success: boolean; error: { code: string } };
        assert.equal(body.success, false);
        assert.equal(body.error.code, 'INVALID_CONTRACT_KIND');
    });

    it('rejects invalid limit with 400', async () => {
        const handler = createGetExportRecordsRouteHandler({
            exportRecords: async () => ({ records: [], total: 0, query: {}, exportedAt: '' }) as never,
        });
        const res = makeResponse();

        await handler(
            { query: { limit: 'abc' } } as never,
            res as never,
            (() => {}) as never,
        );

        assert.equal(res.statusCode, 400);
        const body = res.body as { success: boolean; error: { code: string } };
        assert.equal(body.success, false);
        assert.equal(body.error.code, 'INVALID_PARAMS');
    });

    it('passes valid query parameters to exportRecords', async () => {
        let capturedQuery: unknown = null;
        const handler = createGetExportRecordsRouteHandler({
            exportRecords: async (q: unknown) => {
                capturedQuery = q;
                return { records: [], total: 0, query: q, exportedAt: '' } as never;
            },
        });
        const res = makeResponse();

        await handler(
            {
                query: {
                    backtestRunId: 'run-1',
                    contractKind: 'trade-outcome',
                    limit: '50',
                },
            } as never,
            res as never,
            (() => {}) as never,
        );

        assert.equal(res.statusCode, 200);
        const q = capturedQuery as { backtestRunId: string; indicatorInstanceId: string; contractKind: string; limit: number };
        assert.equal(q.backtestRunId, 'run-1');
        assert.equal(q.indicatorInstanceId, null);
        assert.equal(q.contractKind, 'trade-outcome');
        assert.equal(q.limit, 50);
    });

    it('rejects conflicting backtest and indicator contexts', async () => {
        const handler = createGetExportRecordsRouteHandler({
            exportRecords: async () => ({ records: [], total: 0, query: {}, exportedAt: '' }) as never,
        });
        const res = makeResponse();

        await handler(
            {
                query: {
                    backtestRunId: 'run-1',
                    indicatorInstanceId: 'inst-1',
                },
            } as never,
            res as never,
            (() => {}) as never,
        );

        assert.equal(res.statusCode, 400);
        assert.deepEqual(res.body, {
            success: false,
            error: {
                code: 'INVALID_CONTEXT',
                message: 'Choose either a backtest run or an indicator instance, not both.',
                domain: 'trading.export',
            },
        });
    });

    it('returns 500 when exportRecords throws', async () => {
        const handler = createGetExportRecordsRouteHandler({
            exportRecords: async () => { throw new Error('DB down'); },
        });
        const res = makeResponse();

        await handler(
            { query: {} } as never,
            res as never,
            (() => {}) as never,
        );

        assert.equal(res.statusCode, 500);
        const body = res.body as { success: boolean; error: { code: string } };
        assert.equal(body.error.code, 'EXPORT_RECORDS_FAILED');
    });
});

describe('registerTradingExportRoutes', () => {
    it('registers contract routes without prisma', () => {
        const previousRead = process.env.FEATURE_TRADING_READ;
        process.env.FEATURE_TRADING_READ = 'true';

        try {
            const { app, getRoutes } = makeAppRecorder();
            registerTradingExportRoutes(app);

            const contractsRoute = getRoutes.find((r) => r.path === '/api/trading/exports/contracts');
            const contractByKindRoute = getRoutes.find((r) => r.path === '/api/trading/exports/contracts/:kind');

            assert.ok(contractsRoute, 'Missing /api/trading/exports/contracts route');
            assert.ok(contractByKindRoute, 'Missing /api/trading/exports/contracts/:kind route');
            assert.equal(contractsRoute.handlers.length, 3);
            assert.equal(contractByKindRoute.handlers.length, 3);
        } finally {
            if (previousRead === undefined) {
                delete process.env.FEATURE_TRADING_READ;
            } else {
                process.env.FEATURE_TRADING_READ = previousRead;
            }
        }
    });

    it('registers records route when prisma is provided', () => {
        const previousRead = process.env.FEATURE_TRADING_READ;
        process.env.FEATURE_TRADING_READ = 'true';

        try {
            const { app, getRoutes } = makeAppRecorder();
            registerTradingExportRoutes(app, {} as never);

            const recordsRoute = getRoutes.find((r) => r.path === '/api/trading/exports/records');
            assert.ok(recordsRoute, 'Missing /api/trading/exports/records route');
            assert.equal(recordsRoute.handlers.length, 3);
        } finally {
            if (previousRead === undefined) {
                delete process.env.FEATURE_TRADING_READ;
            } else {
                process.env.FEATURE_TRADING_READ = previousRead;
            }
        }
    });
});
