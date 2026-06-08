import dotenv from 'dotenv';

import { createExternalActionDeliveryWorker } from '../services/trading/externalAction/ExternalActionDeliveryQueue';
import { ExternalActionDeliveryProcessor } from '../services/trading/externalAction/ExternalActionDeliveryProcessor';
import { PostgresExternalActionStore } from '../services/trading/externalAction/ExternalSignalStore';
import { TelegramExternalActionDeliveryService } from '../services/trading/externalAction/TelegramExternalActionDeliveryService';
import { createWorkerLogger } from '../utils/workerLogger';

dotenv.config();

const log = createWorkerLogger('ExternalActionDeliveryWorker');

async function main() {
    log.info('worker_starting', 'Worker process starting.');

    const store = new PostgresExternalActionStore(process.env);
    await store.ensureReady();
    const processor = new ExternalActionDeliveryProcessor(
        store,
        new TelegramExternalActionDeliveryService(process.env),
    );
    const worker = createExternalActionDeliveryWorker(
        async (payload, context) => {
            await processor.process(payload, context);
        },
        process.env,
    );

    worker.on('completed', (job) => {
        log.info('job_completed', 'External action delivered.', job.id);
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
        } catch (closeError) {
            log.error('worker_shutdown_error', closeError instanceof Error ? closeError.message : String(closeError));
        }

        clearTimeout(forceExit);
        process.exit(0);
    };

    process.on('SIGINT', () => { void shutdown(); });
    process.on('SIGTERM', () => { void shutdown(); });
}

main().catch((error) => {
    log.error('worker_fatal', error instanceof Error ? error.message : String(error));
    process.exit(1);
});
