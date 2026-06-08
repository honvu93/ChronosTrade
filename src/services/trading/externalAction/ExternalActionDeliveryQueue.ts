import { ConnectionOptions, Queue, Worker } from 'bullmq';

export const EXTERNAL_ACTION_DELIVERY_QUEUE_NAME = 'external-action-delivery';
export const EXTERNAL_ACTION_DELIVERY_JOB_NAME = 'deliver-external-action-event';

export interface ExternalActionDeliveryJobPayload {
    externalActionEventId: string;
    replayJobId?: string | null;
}

export interface ExternalActionDeliveryAttemptContext {
    attemptNumber: number;
    maxAttempts: number;
}

export interface ExternalActionDeliveryJobPublisher {
    enqueue(input: ExternalActionDeliveryJobPayload): Promise<void>;
    close?(): Promise<void>;
}

function resolveQueuePrefix(env: NodeJS.ProcessEnv = process.env) {
    const prefix = env.QUEUE_PREFIX?.trim();
    return prefix ? prefix : 'tvgit';
}

function parseRedisUrl(env: NodeJS.ProcessEnv = process.env) {
    return new URL(env.REDIS_URL || 'redis://localhost:6379');
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveExternalActionDeliveryWorkerConcurrency(
    env: NodeJS.ProcessEnv = process.env,
) {
    return parsePositiveInteger(env.EXTERNAL_ACTION_WORKER_CONCURRENCY, 5);
}

export function createExternalActionDeliveryConnectionOptions(
    env: NodeJS.ProcessEnv = process.env,
): ConnectionOptions {
    const redisUrl = parseRedisUrl(env);

    return {
        host: redisUrl.hostname,
        port: Number(redisUrl.port || '6379'),
        username: redisUrl.username || undefined,
        password: redisUrl.password || undefined,
        maxRetriesPerRequest: null,
    };
}

export function createExternalActionDeliveryQueue(
    env: NodeJS.ProcessEnv = process.env,
) {
    return new Queue<ExternalActionDeliveryJobPayload>(EXTERNAL_ACTION_DELIVERY_QUEUE_NAME, {
        connection: createExternalActionDeliveryConnectionOptions(env),
        prefix: resolveQueuePrefix(env),
    });
}

export function createExternalActionDeliveryWorker(
    processor: (
        payload: ExternalActionDeliveryJobPayload,
        context: ExternalActionDeliveryAttemptContext,
    ) => Promise<void>,
    env: NodeJS.ProcessEnv = process.env,
) {
    return new Worker<ExternalActionDeliveryJobPayload>(
        EXTERNAL_ACTION_DELIVERY_QUEUE_NAME,
        async (job) => processor(job.data, {
            attemptNumber: job.attemptsMade + 1,
            maxAttempts: parsePositiveInteger(
                typeof job.opts.attempts === 'number' ? String(job.opts.attempts) : undefined,
                1,
            ),
        }),
        {
            connection: createExternalActionDeliveryConnectionOptions(env),
            prefix: resolveQueuePrefix(env),
            concurrency: resolveExternalActionDeliveryWorkerConcurrency(env),
        },
    );
}

export class BullMqExternalActionDeliveryJobPublisher implements ExternalActionDeliveryJobPublisher {
    private readonly queue: Queue<ExternalActionDeliveryJobPayload>;

    constructor(
        private readonly env: NodeJS.ProcessEnv = process.env,
        queue?: Queue<ExternalActionDeliveryJobPayload>,
    ) {
        this.queue = queue ?? createExternalActionDeliveryQueue(env);
    }

    async enqueue(input: ExternalActionDeliveryJobPayload): Promise<void> {
        await this.queue.add(
            EXTERNAL_ACTION_DELIVERY_JOB_NAME,
            input,
            {
                jobId: input.replayJobId ?? input.externalActionEventId,
                attempts: 3,
                backoff: {
                    type: 'exponential',
                    delay: 2_000,
                },
                removeOnComplete: 1_000,
                removeOnFail: 5_000,
            },
        );
    }

    async close(): Promise<void> {
        await this.queue.close();
    }
}
