import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { createWorkerLogger, WorkerLogEntry } from './workerLogger';

function captureOutput(fn: () => void): { stdout: string[]; stderr: string[] } {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const origLog = console.log;
    const origError = console.error;
    console.log = (msg: unknown) => { stdout.push(String(msg)); };
    console.error = (msg: unknown) => { stderr.push(String(msg)); };
    try {
        fn();
    } finally {
        console.log = origLog;
        console.error = origError;
    }
    return { stdout, stderr };
}

describe('createWorkerLogger', () => {
    it('emits valid JSON with required fields on info', () => {
        const logger = createWorkerLogger('TestWorker');
        const { stdout } = captureOutput(() => logger.info('job_started', 'Processing intent-1', 'intent-1'));
        assert.equal(stdout.length, 1);
        const entry = JSON.parse(stdout[0]) as WorkerLogEntry;
        assert.equal(entry.level, 'info');
        assert.equal(entry.worker, 'TestWorker');
        assert.equal(entry.jobId, 'intent-1');
        assert.equal(entry.event, 'job_started');
        assert.equal(entry.message, 'Processing intent-1');
        assert.ok(entry.timestamp, 'timestamp should be present');
        assert.doesNotThrow(() => new Date(entry.timestamp), 'timestamp should be a valid ISO string');
    });

    it('writes error level to stderr', () => {
        const logger = createWorkerLogger('TestWorker');
        const { stdout, stderr } = captureOutput(() => logger.error('job_failed', 'Bridge down', 'intent-2'));
        assert.equal(stdout.length, 0, 'error should not go to stdout');
        assert.equal(stderr.length, 1);
        const entry = JSON.parse(stderr[0]) as WorkerLogEntry;
        assert.equal(entry.level, 'error');
        assert.equal(entry.jobId, 'intent-2');
    });

    it('allows null jobId for infrastructure-level events', () => {
        const logger = createWorkerLogger('TestWorker');
        const { stdout } = captureOutput(() => logger.info('worker_started', 'Worker is up'));
        const entry = JSON.parse(stdout[0]) as WorkerLogEntry;
        assert.equal(entry.jobId, null);
    });

    it('embeds worker name from factory arg', () => {
        const logger = createWorkerLogger('ReconciliationWorker');
        const { stdout } = captureOutput(() => logger.warn('retry_scheduled', 'Attempt 2/5'));
        const entry = JSON.parse(stdout[0]) as WorkerLogEntry;
        assert.equal(entry.worker, 'ReconciliationWorker');
        assert.equal(entry.level, 'warn');
    });
});
