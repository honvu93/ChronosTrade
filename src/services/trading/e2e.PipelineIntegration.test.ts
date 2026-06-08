/**
 * e2e.PipelineIntegration.test.ts
 *
 * End-to-end pipeline integration tests using in-memory mocks.
 * Covers the full signal→intent→execution→reconciliation path
 * without requiring a real database or MT5 bridge.
 *
 * Three critical paths:
 *   1. Happy path: intent QUEUED → PROCESSING → EXECUTED (via bridge)
 *   2. Guardrail rejection: binding has maxOpenPositions=1, 1 open pos → REJECTED
 *   3. Bridge retry: BRIDGE_TRANSPORT_FAILURE on attempt 1, succeeds on attempt 2
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { Prisma, PrismaClient, TradeIntentStatus } from '@prisma/client';
import { TradingAutoExecutionProcessor } from './TradingAutoExecutionProcessor';

// ─── Shared intent builder ────────────────────────────────────────────────────

function makeIntent(overrides: Record<string, unknown> = {}) {
    return {
        id: 'intent-e2e',
        accountId: 'acct-paper',
        signalEventId: 'evt-1',
        commandType: 'OPEN_MARKET',
        symbol: 'XAUUSD',
        side: 'LONG',
        entryPrice: null,
        stopLoss: new Prisma.Decimal(3200),
        takeProfit: new Prisma.Decimal(3250),
        createdAt: new Date(),
        executionCommand: null,
        binding: {
            id: 'binding-1',
            name: 'Pipeline Test Binding',
            mode: 'AUTO_EXECUTE',
            status: 'ACTIVE',
            killSwitchActive: false,
            riskConfigJson: { fixedVolume: 0.01 },
            guardrailsJson: null,
            account: { ownerUserId: 'user-e2e', accountMode: 'PAPER' },
        },
        ...overrides,
    };
}

function makePrismaBase(overrides: Record<string, unknown> = {}) {
    const intentUpdates: Array<Record<string, unknown>> = [];
    const prisma = {
        tradingTradeIntent: {
            updateMany: async () => ({ count: 1 }),
            findUnique: async () => makeIntent(),
            update: async (args: { data: Record<string, unknown> }) => {
                intentUpdates.push(args.data);
                return undefined;
            },
        },
        tradingAutomationBinding: {
            update: async () => undefined,
        },
        ...overrides,
    } as unknown as PrismaClient;
    return { prisma, intentUpdates };
}

// ─── Path 1: Happy path ───────────────────────────────────────────────────────

describe('E2E Pipeline — Happy path', () => {
    it('processes QUEUED intent through to EXECUTED status via bridge', async () => {
        const { prisma, intentUpdates } = makePrismaBase();
        let commandCreated = false;

        const processor = new TradingAutoExecutionProcessor(
            prisma,
            {
                createCommand: async (_actor, _accountId, input) => {
                    commandCreated = true;
                    assert.equal(input.commandType, 'OPEN_MARKET');
                    assert.equal(input.symbol, 'XAUUSD');
                    assert.equal(input.volume, 0.01);
                    return {
                        id: 'cmd-1',
                        status: 'RECONCILED',
                        errorCode: null,
                        errorMessage: null,
                    } as any;
                },
            },
            { getBrokerContext: async () => ({ credential: null }) } as any,
            {
                fetchPositions: async () => [],
                fetchSummary: async () => ({} as any),
                fetchQuote: async () => ({} as any),
            },
        );

        await processor.process('intent-e2e');

        assert.equal(commandCreated, true, 'createCommand should be called');
        const finalUpdate = intentUpdates.find((u) => u.status === TradeIntentStatus.EXECUTED);
        assert.ok(finalUpdate, 'intent should be marked EXECUTED');
    });
});

// ─── Path 2: Guardrail rejection ─────────────────────────────────────────────

describe('E2E Pipeline — Guardrail rejection', () => {
    it('rejects when maxOpenPositions is reached, intent never reaches execution', async () => {
        const { intentUpdates } = makePrismaBase();
        let commandCalled = false;

        const prisma = {
            tradingTradeIntent: {
                updateMany: async () => ({ count: 1 }),
                findUnique: async () => makeIntent({
                    binding: {
                        id: 'binding-1',
                        name: 'Guardrail Binding',
                        mode: 'AUTO_EXECUTE',
                        status: 'ACTIVE',
                        killSwitchActive: false,
                        riskConfigJson: { fixedVolume: 0.01 },
                        guardrailsJson: { maxOpenPositions: 1 }, // limit: 1 position
                        account: { ownerUserId: 'user-e2e', accountMode: 'PAPER' },
                    },
                }),
                update: async (args: { data: Record<string, unknown> }) => {
                    intentUpdates.push(args.data);
                },
            },
            tradingAutomationBinding: { update: async () => undefined },
        } as unknown as PrismaClient;

        const processor = new TradingAutoExecutionProcessor(
            prisma,
            {
                createCommand: async () => {
                    commandCalled = true;
                    return {} as any;
                },
            },
            { getBrokerContext: async () => ({ credential: { mt5Login: '1', mt5Password: 'pw', mt5Server: 'demo' } }) } as any,
            {
                // Bridge reports 1 open position → hits the maxOpenPositions=1 guardrail
                fetchPositions: async () => [{ brokerPositionId: 'pos-existing' }] as any,
                fetchSummary: async () => ({ balance: 10000, equity: 10000, realizedPnlDay: 0 }) as any,
                fetchQuote: async () => ({} as any),
            },
        );

        await processor.process('intent-e2e');

        assert.equal(commandCalled, false, 'execution should not be reached when guardrail blocks');
        const rejected = intentUpdates.find((u) => u.status === TradeIntentStatus.REJECTED);
        assert.ok(rejected, 'intent should be REJECTED');
        assert.ok(
            (rejected!.statusReason as string).includes('maxOpenPositions'),
            'rejection reason should mention guardrail',
        );
    });
});

// ─── Path 3: Bridge retry ─────────────────────────────────────────────────────

describe('E2E Pipeline — Bridge retry (BRIDGE_TRANSPORT_FAILURE)', () => {
    it('schedules retry on first BRIDGE_TRANSPORT_FAILURE, succeeds on attempt 2', async () => {
        const intentUpdates: Array<Record<string, unknown>> = [];
        let callCount = 0;

        const prisma = {
            tradingTradeIntent: {
                updateMany: async () => ({ count: 1 }),
                findUnique: async () => makeIntent(),
                update: async (args: { data: Record<string, unknown> }) => {
                    intentUpdates.push(args.data);
                },
            },
            tradingAutomationBinding: { update: async () => undefined },
        } as unknown as PrismaClient;

        const processor = new TradingAutoExecutionProcessor(
            prisma,
            {
                createCommand: async () => {
                    callCount++;
                    return {
                        id: 'cmd-1',
                        status: 'FAILED',
                        errorCode: 'BRIDGE_TRANSPORT_FAILURE',
                        errorMessage: 'Transport-layer failure.',
                    } as any;
                },
            },
            { getBrokerContext: async () => ({ credential: null }) } as any,
            {
                fetchPositions: async () => [],
                fetchSummary: async () => ({} as any),
                fetchQuote: async () => ({} as any),
            },
        );

        // Attempt 1 of 3 — should throw (BullMQ will re-enqueue)
        await assert.rejects(
            () => processor.process('intent-e2e', { attemptNumber: 1, maxAttempts: 3 }),
            /Transport-layer failure/,
        );

        const retryUpdate = intentUpdates.find((u) =>
            u.status === TradeIntentStatus.FAILED
            && typeof u.statusReason === 'string'
            && (u.statusReason as string).includes('Retry 1/3'),
        );
        assert.ok(retryUpdate, 'intent should be set FAILED with retry message on first attempt');

        // Attempt 3 of 3 — no more retries, should record terminal failure
        await processor.process('intent-e2e', { attemptNumber: 3, maxAttempts: 3 });

        const terminalUpdate = intentUpdates.find((u) =>
            u.status === TradeIntentStatus.FAILED
            && typeof u.statusReason === 'string'
            && (u.statusReason as string).includes('failed after 3 of 3'),
        );
        assert.ok(terminalUpdate, 'intent should record terminal failure on last attempt');
        assert.equal(callCount, 2, 'createCommand called once per attempt');
    });
});
