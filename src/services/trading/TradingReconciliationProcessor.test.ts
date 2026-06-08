import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { TradingReconciliationProcessor } from './TradingReconciliationProcessor';

function makePrisma(ownerUserId: string | null = 'user-1') {
    return {
        tradingAccount: {
            findUnique: async () => (
                ownerUserId ? { ownerUserId } : null
            ),
        },
    } as unknown as PrismaClient;
}

describe('TradingReconciliationProcessor', () => {
    it('calls getBrokerContext and forceSync with the requestedByUserId when provided', async () => {
        const calls: string[] = [];
        const processor = new TradingReconciliationProcessor(
            makePrisma(),
            { getBrokerContext: async (actor) => { calls.push(`getBrokerContext:${actor.id}`); return {} as any; } },
            { forceSync: async (actor) => { calls.push(`forceSync:${actor.id}`); return {} as any; } },
        );

        await processor.process({ accountId: 'acct-1', requestedByUserId: 'admin-1' });

        assert.deepEqual(calls, ['getBrokerContext:admin-1', 'forceSync:admin-1']);
    });

    it('resolves ownerUserId from DB when requestedByUserId is null', async () => {
        const calls: string[] = [];
        const processor = new TradingReconciliationProcessor(
            makePrisma('user-from-db'),
            { getBrokerContext: async (actor) => { calls.push(`getBrokerContext:${actor.id}`); return {} as any; } },
            { forceSync: async (actor) => { calls.push(`forceSync:${actor.id}`); return {} as any; } },
        );

        await processor.process({ accountId: 'acct-1', requestedByUserId: null });

        assert.deepEqual(calls, ['getBrokerContext:user-from-db', 'forceSync:user-from-db']);
    });

    it('throws when account is not found and requestedByUserId is null', async () => {
        const processor = new TradingReconciliationProcessor(
            makePrisma(null),
            { getBrokerContext: async () => ({}) as any },
            { forceSync: async () => ({}) as any },
        );

        await assert.rejects(
            () => processor.process({ accountId: 'missing-acct', requestedByUserId: null }),
            /not found/,
        );
    });

    it('propagates bridge failure from getBrokerContext without silent swallow', async () => {
        const processor = new TradingReconciliationProcessor(
            makePrisma(),
            {
                getBrokerContext: async () => {
                    throw new Error('BRIDGE_UNREACHABLE: MT5 bridge is down.');
                },
            },
            { forceSync: async () => ({}) as any },
        );

        await assert.rejects(
            () => processor.process({ accountId: 'acct-1', requestedByUserId: 'user-1' }),
            /BRIDGE_UNREACHABLE/,
        );
    });
});
