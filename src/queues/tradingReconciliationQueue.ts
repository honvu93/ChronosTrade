import { ConnectionOptions, Queue, Worker } from 'bullmq';

export const TRADING_RECONCILIATION_QUEUE_NAME = 'trading-reconciliation';
export const TRADING_RECONCILIATION_JOB_NAME = 'reconcile-trading-account';

const DEFAULT_RECONCILIATION_DELAY_MS = 5_000;

export interface TradingReconciliationJobPayload {
    accountId: string;
    requestedByUserId: string | null;
    sourceCommandId: string;
}

export interface TradingReconciliationJobPublisher {
    enqueue(input: TradingReconciliationJobPayload): Promise<void>;
    close?(): Promise<void>;
}

function resolveQueuePrefix(env: NodeJS.ProcessEnv = process.env) {
    const prefix = env.QUEUE_PREFIX?.trim();
    return prefix ? prefix : 'tvgit';
}

function parseRedisUrl(env: NodeJS.ProcessEnv = process.env) {
    return new URL(env.REDIS_URL || 'redis://localhost:6379');
}

function parsePositiveInteger(
    value: string | undefined,
    fallback: number,
) {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function createTradingReconciliationConnectionOptions(
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

export function createTradingReconciliationQueue(
    env: NodeJS.ProcessEnv = process.env,
) {
    return new Queue<TradingReconciliationJobPayload>(TRADING_RECONCILIATION_QUEUE_NAME, {
        connection: createTradingReconciliationConnectionOptions(env),
        prefix: resolveQueuePrefix(env),
    });
}

export function createTradingReconciliationWorker(
    processor: (payload: TradingReconciliationJobPayload) => Promise<void>,
    env: NodeJS.ProcessEnv = process.env,
) {
    return new Worker<TradingReconciliationJobPayload>(
        TRADING_RECONCILIATION_QUEUE_NAME,
        async (job) => processor(job.data),
        {
            connection: createTradingReconciliationConnectionOptions(env),
            prefix: resolveQueuePrefix(env),
            concurrency: parsePositiveInteger(env.TRADING_RECONCILIATION_WORKER_CONCURRENCY, 3),
        },
    );
}

export class BullMqTradingReconciliationJobPublisher implements TradingReconciliationJobPublisher {
    private readonly queue: Queue<TradingReconciliationJobPayload>;

    constructor(
        private readonly env: NodeJS.ProcessEnv = process.env,
        queue?: Queue<TradingReconciliationJobPayload>,
    ) {
        this.queue = queue ?? createTradingReconciliationQueue(env);
    }

    async enqueue(input: TradingReconciliationJobPayload): Promise<void> {
        const delayMs = parsePositiveInteger(
            this.env.TRADING_RECONCILIATION_DELAY_MS,
            DEFAULT_RECONCILIATION_DELAY_MS,
        );

        await this.queue.add(
            TRADING_RECONCILIATION_JOB_NAME,
            input,
            {
                jobId: `reconcile:${input.accountId}`,
                delay: delayMs,
                attempts: 5,
                backoff: {
                    type: 'exponential',
                    delay: 3000,
                },
                removeOnComplete: 1000,
                removeOnFail: 5000,
            },
        );
    }

    async close(): Promise<void> {
        await this.queue.close();
    }
}
