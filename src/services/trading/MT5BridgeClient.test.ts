import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { MT5BridgeClient } from './MT5BridgeClient';
import { createServer, Server, IncomingMessage, ServerResponse } from 'node:http';

/**
 * Helpers: spin up tiny HTTP servers on specific ports to verify routing.
 */
function createFakeServer(port: number, tag: string): Promise<Server> {
    return new Promise((resolve) => {
        const server = createServer((_req: IncomingMessage, res: ServerResponse) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, data: { __tag: tag } }));
        });
        server.listen(port, '127.0.0.1', () => resolve(server));
    });
}

function closeServer(server: Server): Promise<void> {
    return new Promise((resolve) => server.close(() => resolve()));
}

describe('MT5BridgeClient port routing', () => {
    const READ_PORT = 18765;
    const EXEC_PORT = 18766;
    let readServer: Server;
    let execServer: Server;

    beforeEach(async () => {
        readServer = await createFakeServer(READ_PORT, 'read');
        execServer = await createFakeServer(EXEC_PORT, 'exec');
    });

    afterEach(async () => {
        await closeServer(readServer);
        await closeServer(execServer);
    });

    const creds = { mt5Login: 'test', mt5Password: 'test', mt5Server: 'test' };

    const env = {
        MT5_BRIDGE_PORT: String(READ_PORT),
        MT5_EXEC_BRIDGE_PORT: String(EXEC_PORT),
    };

    it('routes fetchSummary to the read port', async () => {
        const client = new MT5BridgeClient(env as unknown as NodeJS.ProcessEnv);
        const result = await client.fetchSummary(creds) as unknown as { __tag: string };
        assert.equal(result.__tag, 'read');
    });

    it('routes fetchPositions to the read port', async () => {
        const client = new MT5BridgeClient(env as unknown as NodeJS.ProcessEnv);
        const result = await client.fetchPositions(creds) as unknown as { __tag: string };
        assert.equal(result.__tag, 'read');
    });

    it('routes fetchOrders to the read port', async () => {
        const client = new MT5BridgeClient(env as unknown as NodeJS.ProcessEnv);
        const result = await client.fetchOrders(creds) as unknown as { __tag: string };
        assert.equal(result.__tag, 'read');
    });

    it('routes fetchQuote to the read port', async () => {
        const client = new MT5BridgeClient(env as unknown as NodeJS.ProcessEnv);
        const result = await client.fetchQuote(creds, 'XAUUSD') as unknown as { __tag: string };
        assert.equal(result.__tag, 'read');
    });

    it('routes fetchDeals to the read port', async () => {
        const client = new MT5BridgeClient(env as unknown as NodeJS.ProcessEnv);
        const result = await client.fetchDeals(creds) as unknown as { __tag: string };
        assert.equal(result.__tag, 'read');
    });

    it('routes fetchExecutionReadiness to the read port', async () => {
        const client = new MT5BridgeClient(env as unknown as NodeJS.ProcessEnv);
        const result = await client.fetchExecutionReadiness(creds) as unknown as { __tag: string };
        assert.equal(result.__tag, 'read');
    });

    it('routes openMarket to the exec port', async () => {
        const client = new MT5BridgeClient(env as unknown as NodeJS.ProcessEnv);
        const result = await client.openMarket(creds, { symbol: 'XAUUSD' }) as unknown as { __tag: string };
        assert.equal(result.__tag, 'exec');
    });

    it('routes placePending to the exec port', async () => {
        const client = new MT5BridgeClient(env as unknown as NodeJS.ProcessEnv);
        const result = await client.placePending(creds, { symbol: 'XAUUSD' }) as unknown as { __tag: string };
        assert.equal(result.__tag, 'exec');
    });

    it('routes closePosition to the exec port', async () => {
        const client = new MT5BridgeClient(env as unknown as NodeJS.ProcessEnv);
        const result = await client.closePosition(creds, { ticket: '123' }) as unknown as { __tag: string };
        assert.equal(result.__tag, 'exec');
    });

    it('routes partialClose to the exec port', async () => {
        const client = new MT5BridgeClient(env as unknown as NodeJS.ProcessEnv);
        const result = await client.partialClose(creds, { ticket: '123' }) as unknown as { __tag: string };
        assert.equal(result.__tag, 'exec');
    });

    it('routes modifyPosition to the exec port', async () => {
        const client = new MT5BridgeClient(env as unknown as NodeJS.ProcessEnv);
        const result = await client.modifyPosition(creds, { ticket: '123' }) as unknown as { __tag: string };
        assert.equal(result.__tag, 'exec');
    });

    it('routes cancelOrder to the exec port', async () => {
        const client = new MT5BridgeClient(env as unknown as NodeJS.ProcessEnv);
        const result = await client.cancelOrder(creds, { ticket: '123' }) as unknown as { __tag: string };
        assert.equal(result.__tag, 'exec');
    });

    it('health check uses the read port', async () => {
        const client = new MT5BridgeClient(env as unknown as NodeJS.ProcessEnv);
        const result = await client.health();
        assert.equal(result, true);
    });
});

describe('MT5BridgeClient port defaults', () => {
    it('defaults read port to 8765 and exec port to 8766 when env not set', () => {
        const client = new MT5BridgeClient({} as NodeJS.ProcessEnv);
        // Access internal URLs to verify defaults — we test via the config module
        const { resolveMT5ReadPort, resolveMT5ExecPort } = require('./mt5BridgeConfig');
        const readResult = resolveMT5ReadPort({});
        const execResult = resolveMT5ExecPort({});
        assert.equal(readResult.port, '8765');
        assert.equal(execResult.port, '8766');
    });
});
