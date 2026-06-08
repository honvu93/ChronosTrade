import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
    BullMqTradingAutoExecutionJobPublisher,
    resolveTradingAutoExecutionWorkerConcurrency,
} from './tradingAutoExecutionQueue';

describe('BullMqTradingAutoExecutionJobPublisher', () => {
    it('applies retry and retention settings to queued intents', async () => {
        const addCalls: Array<Record<string, unknown>> = [];
        const publisher = new BullMqTradingAutoExecutionJobPublisher(
            process.env,
            {
                add: async (_name: string, _payload: unknown, options: Record<string, unknown>) => {
                    addCalls.push(options);
                    return {} as any;
                },
                close: async () => undefined,
            } as any,
        );

        await publisher.enqueue({ tradeIntentId: 'intent-1' });

        assert.equal(addCalls.length, 1);
        assert.deepEqual(addCalls[0], {
            jobId: 'intent-1',
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 2000,
            },
            removeOnComplete: 1000,
            removeOnFail: 5000,
        });
    });
});

describe('resolveTradingAutoExecutionWorkerConcurrency', () => {
    it('defaults to 10 when the env value is missing or invalid', () => {
        assert.equal(resolveTradingAutoExecutionWorkerConcurrency({}), 10);
        assert.equal(resolveTradingAutoExecutionWorkerConcurrency({ WORKER_CONCURRENCY: '0' }), 10);
        assert.equal(resolveTradingAutoExecutionWorkerConcurrency({ WORKER_CONCURRENCY: 'nan' }), 10);
    });

    it('uses a positive integer from WORKER_CONCURRENCY', () => {
        assert.equal(resolveTradingAutoExecutionWorkerConcurrency({ WORKER_CONCURRENCY: '24' }), 24);
    });
});
