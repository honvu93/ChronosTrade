import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { BullMqTradingReconciliationJobPublisher } from './tradingReconciliationQueue';

describe('BullMqTradingReconciliationJobPublisher', () => {
    it('applies retry and exponential backoff settings to queued reconciliation jobs', async () => {
        const addCalls: Array<Record<string, unknown>> = [];
        const publisher = new BullMqTradingReconciliationJobPublisher(
            process.env,
            {
                add: async (_name: string, _payload: unknown, options: Record<string, unknown>) => {
                    addCalls.push(options);
                    return {} as any;
                },
                close: async () => undefined,
            } as any,
        );

        await publisher.enqueue({
            accountId: 'acct-1',
            requestedByUserId: 'user-1',
            sourceCommandId: 'cmd-1',
        });

        assert.equal(addCalls.length, 1);
        assert.equal(addCalls[0].attempts, 5, 'should attempt 5 times to survive transient bridge failures');
        assert.deepEqual(addCalls[0].backoff, {
            type: 'exponential',
            delay: 3000,
        }, 'should use exponential backoff with 3s base delay');
    });

    it('deduplicates reconciliation jobs for the same account via jobId', async () => {
        const addCalls: Array<Record<string, unknown>> = [];
        const publisher = new BullMqTradingReconciliationJobPublisher(
            process.env,
            {
                add: async (_name: string, _payload: unknown, options: Record<string, unknown>) => {
                    addCalls.push(options);
                    return {} as any;
                },
                close: async () => undefined,
            } as any,
        );

        await publisher.enqueue({ accountId: 'acct-42', requestedByUserId: null, sourceCommandId: 'cmd-1' });

        assert.equal(addCalls[0].jobId, 'reconcile:acct-42', 'jobId should deduplicate concurrent reconciliation requests for the same account');
    });
});
