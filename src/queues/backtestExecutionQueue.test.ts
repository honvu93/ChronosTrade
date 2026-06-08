import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBacktestExecutionWorkerConcurrency } from './backtestExecutionQueue';

describe('resolveBacktestExecutionWorkerConcurrency', () => {
    it('returns default of 5 when env is not set', () => {
        assert.equal(resolveBacktestExecutionWorkerConcurrency({}), 5);
    });

    it('returns parsed integer from env', () => {
        assert.equal(resolveBacktestExecutionWorkerConcurrency({ BACKTEST_WORKER_CONCURRENCY: '10' } as any), 10);
    });

    it('returns default for invalid env value', () => {
        assert.equal(resolveBacktestExecutionWorkerConcurrency({ BACKTEST_WORKER_CONCURRENCY: 'abc' } as any), 5);
    });

    it('returns default for zero', () => {
        assert.equal(resolveBacktestExecutionWorkerConcurrency({ BACKTEST_WORKER_CONCURRENCY: '0' } as any), 5);
    });

    it('returns default for negative', () => {
        assert.equal(resolveBacktestExecutionWorkerConcurrency({ BACKTEST_WORKER_CONCURRENCY: '-3' } as any), 5);
    });
});
