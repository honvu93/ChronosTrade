import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import IORedis from 'ioredis';
import {
    createBacktestExecutionWorker,
} from '../queues/backtestExecutionQueue';
import { SignalBacktestExecutionService } from '../services/signals/SignalBacktestExecutionService';
import { createWorkerLogger } from '../utils/workerLogger';

dotenv.config();

const log = createWorkerLogger('BacktestExecutionWorker');

async function main() {
    log.info('worker_starting', 'Worker process starting.');

    const prisma = new PrismaClient();
    await prisma.$connect();

    const pub = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
        maxRetriesPerRequest: null,
    });

    const execution = new SignalBacktestExecutionService(prisma);

    const worker = createBacktestExecutionWorker(
        async ({ backtestRunId, batchId }) => {
            const progressChannel = `backtest:progress:${backtestRunId}`;

            await pub.publish(progressChannel, JSON.stringify({
                status: 'RUNNING',
                backtestRunId,
                batchId: batchId ?? null,
            }));

            try {
                const result = await execution.executeRun(backtestRunId);

                await pub.publish(progressChannel, JSON.stringify({
                    status: 'COMPLETED',
                    backtestRunId,
                    batchId: batchId ?? null,
                    counts: result.counts,
                }));
            } catch (error) {
                await pub.publish(progressChannel, JSON.stringify({
                    status: 'FAILED',
                    backtestRunId,
                    batchId: batchId ?? null,
                    error: error instanceof Error ? error.message : String(error),
                }));
                throw error;
            }
        },
        process.env,
    );

    worker.on('completed', (job) => {
        log.info('job_completed', 'Backtest run completed.', job.id);
    });

    worker.on('failed', (job, error) => {
        log.error('job_failed', error instanceof Error ? error.message : String(error), job?.id ?? null);
    });

    worker.on('error', (err) => {
        log.error('worker_error', err instanceof Error ? err.message : String(err));
    });

    const SHUTDOWN_TIMEOUT_MS = 30_000;

    const shutdown = async () => {
        log.info('worker_stopping', 'Graceful shutdown initiated.');

        const forceExit = setTimeout(() => {
            log.error('worker_shutdown_timeout', 'Graceful shutdown timed out after 30s, forcing exit.');
            process.exit(1);
        }, SHUTDOWN_TIMEOUT_MS);
        forceExit.unref();

        try {
            await worker.close();
            await pub.quit();
            await prisma.$disconnect();
        } catch (closeError) {
            log.error('worker_shutdown_error', closeError instanceof Error ? closeError.message : String(closeError));
        }
        clearTimeout(forceExit);
        process.exit(0);
    };

    process.on('SIGINT', () => { void shutdown(); });
    process.on('SIGTERM', () => { void shutdown(); });
}

main().catch(async (error) => {
    log.error('worker_fatal', error instanceof Error ? error.message : String(error));
    process.exit(1);
});
