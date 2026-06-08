import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { registerIndicatorRoutes } from './registerIndicatorRoutes';
import { IndicatorCatalogServiceError } from '../services/signals/IndicatorCatalogService';

function makeAppRecorder() {
    const getRoutes: Array<{ path: string; handlers: Function[] }> = [];
    const postRoutes: Array<{ path: string; handlers: Function[] }> = [];
    const patchRoutes: Array<{ path: string; handlers: Function[] }> = [];
    const deleteRoutes: Array<{ path: string; handlers: Function[] }> = [];

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
        delete(path: string, ...handlers: Function[]) {
            deleteRoutes.push({ path, handlers });
            return app;
        },
    };

    return {
        app: app as never,
        getRoutes,
        postRoutes,
        patchRoutes,
        deleteRoutes,
    };
}

function createResponseRecorder() {
    let statusCode = 200;
    let payload: unknown = null;

    const res = {
        locals: {} as Record<string, unknown>,
        status(code: number) {
            statusCode = code;
            return res;
        },
        json(value: unknown) {
            payload = value;
            return res;
        },
    };

    return {
        res,
        getStatus: () => statusCode,
        getPayload: () => payload,
    };
}

function findRoute(
    routes: Array<{ path: string; handlers: Function[] }>,
    path: string,
) {
    const route = routes.find((candidate) => candidate.path === path);
    assert.ok(route, `Route ${path} was not registered.`);
    return route;
}

describe('registerIndicatorRoutes', () => {
    it('applies admin guards to the indicator catalog governance endpoints', () => {
        const recorder = makeAppRecorder();
        const signalGuard = () => undefined;
        const engineGuard = () => undefined;
        const adminGuard = () => undefined;

        registerIndicatorRoutes(recorder.app, {} as never, {
            signalOnly: [signalGuard as never],
            signalOrEngine: [engineGuard as never],
            adminOnly: [adminGuard as never],
        });

        const adminGetPaths = recorder.getRoutes
            .filter((route) => route.path.startsWith('/api/admin/indicator-catalog'))
            .map((route) => route.path);

        assert.deepEqual(adminGetPaths, [
            '/api/admin/indicator-catalog',
            '/api/admin/indicator-catalog/:id',
            '/api/admin/indicator-catalog/:id/dependencies',
        ]);
        assert.equal(findRoute(recorder.getRoutes, '/api/admin/indicator-catalog').handlers[0], adminGuard);
        assert.equal(findRoute(recorder.postRoutes, '/api/admin/indicator-catalog').handlers[0], adminGuard);
        assert.equal(findRoute(recorder.patchRoutes, '/api/admin/indicator-catalog/:id').handlers[0], adminGuard);
        assert.equal(findRoute(recorder.deleteRoutes, '/api/admin/indicator-catalog/:id').handlers[0], adminGuard);
        assert.equal(findRoute(recorder.getRoutes, '/api/tech-indicators').handlers[0], engineGuard);
    });

    it('returns admin catalog payloads from the injected governance service', async () => {
        const recorder = makeAppRecorder();
        const indicatorCatalogService = {
            listAdminCatalog: async () => [{ id: 'RSI', catalogStatus: 'PUBLISHED' }],
        };

        registerIndicatorRoutes(recorder.app, {} as never, {}, {
            indicatorCatalogService: indicatorCatalogService as never,
            composedSignalService: { listIndicatorBlocks: async () => [] } as never,
        });

        const route = findRoute(recorder.getRoutes, '/api/admin/indicator-catalog');
        const response = createResponseRecorder();

        await route.handlers[route.handlers.length - 1]({}, response.res);

        assert.equal(response.getStatus(), 200);
        assert.deepEqual(response.getPayload(), [{ id: 'RSI', catalogStatus: 'PUBLISHED' }]);
    });

    it('passes the authenticated actor id into create draft requests', async () => {
        const recorder = makeAppRecorder();
        let capturedActor = '';
        let capturedBody: unknown = null;
        const indicatorCatalogService = {
            createDraft: async (actorUserId: string, body: unknown) => {
                capturedActor = actorUserId;
                capturedBody = body;
                return { id: 'RSI_ALIAS' };
            },
        };

        registerIndicatorRoutes(recorder.app, {} as never, {}, {
            indicatorCatalogService: indicatorCatalogService as never,
            composedSignalService: { listIndicatorBlocks: async () => [] } as never,
        });

        const route = findRoute(recorder.postRoutes, '/api/admin/indicator-catalog');
        const response = createResponseRecorder();
        response.res.locals = { authorizedUser: { id: 'admin-42' } };
        const body = { id: 'RSI_ALIAS', name: 'RSI Alias' };

        await route.handlers[route.handlers.length - 1]({ body }, response.res);

        assert.equal(response.getStatus(), 201);
        assert.equal(capturedActor, 'admin-42');
        assert.deepEqual(capturedBody, body);
        assert.deepEqual(response.getPayload(), { id: 'RSI_ALIAS' });
    });

    it('serializes catalog service errors with code and reasons', async () => {
        const recorder = makeAppRecorder();
        const indicatorCatalogService = {
            publish: async () => {
                throw new IndicatorCatalogServiceError(
                    409,
                    'INDICATOR_CATALOG_PUBLISH_BLOCKED',
                    'Indicator catalog item "RSI" cannot be published.',
                    ['Catalog schema does not match the bound runtime block.'],
                );
            },
        };

        registerIndicatorRoutes(recorder.app, {} as never, {}, {
            indicatorCatalogService: indicatorCatalogService as never,
            composedSignalService: { listIndicatorBlocks: async () => [] } as never,
        });

        const route = findRoute(recorder.postRoutes, '/api/admin/indicator-catalog/:id/publish');
        const response = createResponseRecorder();

        await route.handlers[route.handlers.length - 1]({ params: { id: 'RSI' } }, response.res);

        assert.equal(response.getStatus(), 409);
        assert.deepEqual(response.getPayload(), {
            error: 'Indicator catalog item "RSI" cannot be published.',
            code: 'INDICATOR_CATALOG_PUBLISH_BLOCKED',
            reasons: ['Catalog schema does not match the bound runtime block.'],
        });
    });

    it('returns public tech-indicator payloads from the composed signal service', async () => {
        const recorder = makeAppRecorder();
        const composedSignalService = {
            listIndicatorBlocks: async () => [{ id: 'RSI', name: 'Relative Strength Index' }],
        };

        registerIndicatorRoutes(recorder.app, {} as never, {}, {
            indicatorCatalogService: { listAdminCatalog: async () => [] } as never,
            composedSignalService: composedSignalService as never,
        });

        const route = findRoute(recorder.getRoutes, '/api/tech-indicators');
        const response = createResponseRecorder();

        await route.handlers[route.handlers.length - 1]({}, response.res);

        assert.equal(response.getStatus(), 200);
        assert.deepEqual(response.getPayload(), [{ id: 'RSI', name: 'Relative Strength Index' }]);
    });
});
