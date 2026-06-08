import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
    createCreateTradingAccountRouteHandler,
    createDeleteTradingAccountRouteHandler,
    createListTradingAccountsRouteHandler,
    createSelectTradingAccountRouteHandler,
    createUpdateTradingAccountRouteHandler,
    registerTradingAccountRoutes,
} from './registerTradingAccountRoutes';
import type { TradingAccountSummary } from '../services/trading/TradingAccountService';

function makeAccountSummary(overrides: Partial<TradingAccountSummary> = {}): TradingAccountSummary {
    return {
        id: 'acct-1',
        ownerUserId: 'user-1',
        ownerEmail: 'pilot@example.com',
        ownerUsername: 'pilot',
        ownerDisplayName: 'Pilot User',
        label: 'Pilot MT5',
        brokerKind: 'MT5' as const,
        accountMode: 'PAPER',
        status: 'PENDING',
        baseCurrency: null,
        leverage: null,
        lastSeenAt: null,
        lastSuccessfulSyncAt: null,
        mt5Login: '10001',
        mt5Server: 'Demo-Server',
        hasStoredCredential: true,
        isActive: true,
        createdAt: '2026-03-11T09:00:00.000Z',
        updatedAt: '2026-03-11T09:30:00.000Z',
        ...overrides,
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

describe('createListTradingAccountsRouteHandler', () => {
    it('returns accounts plus the active account id', async () => {
        const calls: unknown[] = [];
        const handler = createListTradingAccountsRouteHandler({
            listAccounts: async (actor, query) => {
                calls.push({ actor, query });
                return {
                    accounts: [makeAccountSummary()],
                    activeAccountId: 'acct-1',
                };
            },
        });
        const res = makeResponse();

        await handler({ query: {} } as never, res as never, (() => {}) as never);

        assert.equal(res.statusCode, 200);
        assert.deepEqual(calls, [{
            actor: { id: 'user-1', role: 'USER' },
            query: { ownerUserId: null },
        }]);
        assert.equal((res.body as { data: { accounts: unknown[]; activeAccountId: string } }).data.activeAccountId, 'acct-1');
    });

    it('forwards an explicit owner scope query when present', async () => {
        const calls: unknown[] = [];
        const handler = createListTradingAccountsRouteHandler({
            listAccounts: async (actor, query) => {
                calls.push({ actor, query });
                return {
                    accounts: [makeAccountSummary({ ownerUserId: 'user-2' })],
                    activeAccountId: 'acct-1',
                };
            },
        });
        const res = makeResponse();

        await handler({ query: { userId: 'user-2' } } as never, res as never, (() => {}) as never);

        assert.equal(res.statusCode, 200);
        assert.deepEqual(calls, [{
            actor: { id: 'user-1', role: 'USER' },
            query: { ownerUserId: 'user-2' },
        }]);
    });
});

describe('createCreateTradingAccountRouteHandler', () => {
    it('creates a trading account payload', async () => {
        const calls: unknown[] = [];
        const handler = createCreateTradingAccountRouteHandler({
            createAccount: async (actor, input) => {
                calls.push({ actor, input });
                return makeAccountSummary();
            },
        });
        const res = makeResponse();

        await handler({
            body: {
                label: 'Pilot MT5',
                accountMode: 'PAPER',
                mt5Login: '10001',
                mt5Password: 'secret',
                mt5Server: 'Demo-Server',
            },
        } as never, res as never, (() => {}) as never);

        assert.equal(res.statusCode, 201);
        assert.deepEqual(calls, [{
            actor: { id: 'user-1', role: 'USER' },
            input: {
                ownerUserId: null,
                label: 'Pilot MT5',
                accountMode: 'PAPER',
                mt5Login: '10001',
                mt5Password: 'secret',
                mt5Server: 'Demo-Server',
            },
        }]);
    });

    it('rejects invalid accountMode values before they silently fall back to live', async () => {
        const handler = createCreateTradingAccountRouteHandler({
            createAccount: async () => {
                throw new Error('should not run');
            },
        });
        const res = makeResponse();

        await handler({
            body: {
                label: 'Pilot MT5',
                accountMode: 'sandbox',
                mt5Login: '10001',
                mt5Password: 'secret',
                mt5Server: 'Demo-Server',
            },
        } as never, res as never, (() => {}) as never);

        assert.equal(res.statusCode, 400);
        assert.deepEqual(res.body, {
            success: false,
            error: {
                code: 'TRADING_ACCOUNT_INVALID',
                message: 'accountMode must be either LIVE or PAPER.',
                domain: 'trading.account-management',
            },
        });
    });
});

describe('createSelectTradingAccountRouteHandler', () => {
    it('switches the active account', async () => {
        const calls: unknown[] = [];
        const handler = createSelectTradingAccountRouteHandler({
            selectActiveAccount: async (actor, accountId, scope) => {
                calls.push({ actor, accountId, scope });
                return {
                    account: makeAccountSummary({ id: accountId, isActive: true }),
                    activeAccountId: accountId,
                };
            },
        });
        const res = makeResponse();

        await handler({
            params: { id: 'acct-2' },
        } as never, res as never, (() => {}) as never);

        assert.equal(res.statusCode, 200);
        assert.deepEqual(calls, [{
            actor: { id: 'user-1', role: 'USER' },
            accountId: 'acct-2',
            scope: { ownerUserId: null },
        }]);
        assert.equal((res.body as { data: { activeAccountId: string } }).data.activeAccountId, 'acct-2');
    });
});

describe('createUpdateTradingAccountRouteHandler', () => {
    it('supports password-preserving updates', async () => {
        const calls: unknown[] = [];
        const handler = createUpdateTradingAccountRouteHandler({
            updateAccount: async (actor, accountId, input, scope) => {
                calls.push({ actor, accountId, input, scope });
                return makeAccountSummary();
            },
        });
        const res = makeResponse();

        await handler({
            params: { id: 'acct-1' },
            body: {
                label: 'Pilot MT5 Updated',
                accountMode: 'LIVE',
                mt5Password: null,
            },
        } as never, res as never, (() => {}) as never);

        assert.equal(res.statusCode, 200);
        assert.deepEqual(calls, [{
            actor: { id: 'user-1', role: 'USER' },
            accountId: 'acct-1',
            input: {
                label: 'Pilot MT5 Updated',
                accountMode: 'LIVE',
                mt5Password: null,
            },
            scope: { ownerUserId: null },
        }]);
    });

    it('rejects invalid accountMode values on update', async () => {
        const handler = createUpdateTradingAccountRouteHandler({
            updateAccount: async () => {
                throw new Error('should not run');
            },
        });
        const res = makeResponse();

        await handler({
            params: { id: 'acct-1' },
            body: {
                accountMode: 'sandbox',
            },
        } as never, res as never, (() => {}) as never);

        assert.equal(res.statusCode, 400);
        assert.deepEqual(res.body, {
            success: false,
            error: {
                code: 'TRADING_ACCOUNT_INVALID',
                message: 'accountMode must be either LIVE or PAPER.',
                domain: 'trading.account-management',
            },
        });
    });
});

describe('createDeleteTradingAccountRouteHandler', () => {
    it('deletes the selected account and returns the next active account id', async () => {
        const calls: unknown[] = [];
        const handler = createDeleteTradingAccountRouteHandler({
            deleteAccount: async (actor, accountId, scope) => {
                calls.push({ actor, accountId, scope });
                return { id: accountId, activeAccountId: 'acct-2' };
            },
        });
        const res = makeResponse();

        await handler({
            params: { id: 'acct-1' },
        } as never, res as never, (() => {}) as never);

        assert.equal(res.statusCode, 200);
        assert.deepEqual(calls, [{
            actor: { id: 'user-1', role: 'USER' },
            accountId: 'acct-1',
            scope: { ownerUserId: null },
        }]);
        assert.equal((res.body as { data: { deletedId: string; activeAccountId: string } }).data.activeAccountId, 'acct-2');
    });
});

describe('registerTradingAccountRoutes', () => {
    it('registers list, create, select, update, and delete routes', () => {
        const { app, getRoutes, postRoutes, patchRoutes, deleteRoutes } = makeAppRecorder();
        registerTradingAccountRoutes(app, {} as never);

        assert.equal(getRoutes.some((route) => route.path === '/api/trading/accounts'), true);
        assert.equal(postRoutes.some((route) => route.path === '/api/trading/accounts'), true);
        assert.equal(postRoutes.some((route) => route.path === '/api/trading/accounts/:id/select'), true);
        assert.equal(patchRoutes.some((route) => route.path === '/api/trading/accounts/:id'), true);
        assert.equal(deleteRoutes.some((route) => route.path === '/api/trading/accounts/:id'), true);
    });
});
