import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
    evaluateAccountReadiness,
    evaluateFullStoredAccountReadiness,
    evaluateStoredAccountReadiness,
} from './TradingAccountReadinessService';
import { DEFAULT_MT5_BRIDGE_PORT } from './mt5BridgeConfig';

const encryptionEnv = {
    ENCRYPTION_KEY: '12345678901234567890123456789012',
};

describe('TradingAccountReadinessService', () => {
    it('uses the canonical default bridge port when MT5_BRIDGE_PORT is missing', () => {
        const snapshot = evaluateAccountReadiness({
            ...encryptionEnv,
            MT5_LOGIN: '10001',
            MT5_PASSWORD: 'secret',
            MT5_SERVER: 'Demo-Server',
        });

        assert.equal(snapshot.state, 'ready');
        assert.equal(snapshot.bridgePort, DEFAULT_MT5_BRIDGE_PORT);
        assert.equal(
            snapshot.checks.find((check) => check.key === 'bridge_port')?.detail,
            `Bridge port: ${DEFAULT_MT5_BRIDGE_PORT} (default)`,
        );
    });

    it('prefers MT5_EXEC_BRIDGE_PORT when it is configured', () => {
        const snapshot = evaluateAccountReadiness({
            ...encryptionEnv,
            MT5_LOGIN: '10001',
            MT5_PASSWORD: 'secret',
            MT5_SERVER: 'Demo-Server',
            MT5_EXEC_BRIDGE_PORT: '8766',
            MT5_BRIDGE_PORT: '8765',
        });

        assert.equal(snapshot.state, 'ready');
        assert.equal(snapshot.bridgePort, '8766');
        assert.equal(
            snapshot.checks.find((check) => check.key === 'bridge_port')?.detail,
            'Execution bridge port: 8766',
        );
    });

    it('keeps the missing-credentials state when no MT5 credentials are configured', () => {
        const snapshot = evaluateAccountReadiness(encryptionEnv);

        assert.equal(snapshot.state, 'credentials-missing');
        assert.equal(snapshot.bridgePort, DEFAULT_MT5_BRIDGE_PORT);
    });

    it('uses the canonical default bridge port for stored-account readiness when env is missing', () => {
        const snapshot = evaluateStoredAccountReadiness({
            accountId: 'acct-1',
            accountLabel: 'Pilot MT5',
            accountMode: 'PAPER',
            mt5Login: '20002',
            mt5Password: 'secret',
            mt5Server: 'Demo-Server',
        }, encryptionEnv);

        assert.equal(snapshot.state, 'ready');
        assert.equal(snapshot.bridgePort, DEFAULT_MT5_BRIDGE_PORT);
        assert.equal(
            snapshot.checks.find((check) => check.key === 'bridge_port')?.detail,
            `Bridge port: ${DEFAULT_MT5_BRIDGE_PORT} (default)`,
        );
    });

    it('marks stored-account readiness as execution-blocked when the MT5 terminal disables external trading', async () => {
        const originalFetch = global.fetch;
        const calls: string[] = [];

        global.fetch = (async (input: string | URL | Request) => {
            const url = String(input);
            calls.push(url);

            if (url.endsWith('/bridge/health')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ success: true }),
                } as Response;
            }

            if (url.endsWith('/bridge/account/readiness')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        ok: true,
                        data: {
                            ready: false,
                            message: 'The MT5 terminal has AutoTrading disabled for external requests.',
                            failureCode: 'TERMINAL_AUTOTRADING_DISABLED',
                            blockers: [
                                {
                                    code: 'TERMINAL_AUTOTRADING_DISABLED',
                                    message: 'The MT5 terminal has AutoTrading disabled for external requests.',
                                },
                            ],
                            terminal: {
                                tradeAllowed: false,
                                tradeApiDisabled: false,
                            },
                            account: {
                                tradeAllowed: true,
                            },
                        },
                    }),
                } as Response;
            }

            throw new Error(`Unexpected fetch url: ${url}`);
        }) as typeof fetch;

        try {
            const snapshot = await evaluateFullStoredAccountReadiness({
                accountId: 'acct-1',
                accountLabel: 'Pilot MT5',
                accountMode: 'PAPER',
                mt5Login: '20002',
                mt5Password: 'secret',
                mt5Server: 'Demo-Server',
            }, encryptionEnv);

            assert.equal(snapshot.state, 'execution-blocked');
            assert.equal(snapshot.executionFailureCode, 'TERMINAL_AUTOTRADING_DISABLED');
            assert.equal(snapshot.executionReadinessMessage, 'The MT5 terminal has AutoTrading disabled for external requests.');
            assert.equal(snapshot.blockingReasons.includes('The MT5 terminal has AutoTrading disabled for external requests.'), true);
            assert.equal(snapshot.checks.some((check) => check.key === 'terminal_trade_allowed' && check.passed === false), true);
            assert.deepEqual(calls, [
                `http://localhost:${DEFAULT_MT5_BRIDGE_PORT}/bridge/health`,
                `http://localhost:${DEFAULT_MT5_BRIDGE_PORT}/bridge/account/readiness`,
            ]);
        } finally {
            global.fetch = originalFetch;
        }
    });

    it('classifies execution-readiness endpoint failures as bridge-unreachable instead of terminal-blocked', async () => {
        const originalFetch = global.fetch;

        global.fetch = (async (input: string | URL | Request) => {
            const url = String(input);

            if (url.endsWith('/bridge/health')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ success: true }),
                } as Response;
            }

            if (url.endsWith('/bridge/account/readiness')) {
                return {
                    ok: false,
                    status: 502,
                    json: async () => ({
                        ok: false,
                        error: {
                            code: 'MT5_BRIDGE_FAILED',
                            message: 'MT5 initialize failed: (-6, \"Terminal: Authorization failed\")',
                        },
                    }),
                } as Response;
            }

            throw new Error(`Unexpected fetch url: ${url}`);
        }) as typeof fetch;

        try {
            const snapshot = await evaluateFullStoredAccountReadiness({
                accountId: 'acct-1',
                accountLabel: 'Pilot MT5',
                accountMode: 'PAPER',
                mt5Login: '20002',
                mt5Password: 'secret',
                mt5Server: 'Demo-Server',
            }, encryptionEnv);

            assert.equal(snapshot.state, 'bridge-unreachable');
            assert.equal(snapshot.executionFailureCode, 'MT5_BRIDGE_FAILED');
            assert.equal(snapshot.executionReadinessMessage, 'MT5 initialize failed: (-6, "Terminal: Authorization failed")');
            assert.equal(
                snapshot.blockingReasons.includes('MT5 initialize failed: (-6, "Terminal: Authorization failed")'),
                true,
            );
        } finally {
            global.fetch = originalFetch;
        }
    });
});
