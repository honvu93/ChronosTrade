import { ConnectionOptions, Queue, Worker } from 'bullmq';

export const TRADING_AUTO_EXECUTION_QUEUE_NAME = 'trading-auto-execution';
export const TRADING_AUTO_EXECUTION_JOB_NAME = 'execute-trade-intent';

export interface TradingAutoExecutionJobPayload {
    tradeIntentId: string;
}

export interface TradingAutoExecutionAttemptContext {
    attemptNumber: number;
    maxAttempts: number;
}

export interface TradingAutoExecutionJobPublisher {
    enqueue(input: TradingAutoExecutionJobPayload): Promise<void>;
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

export function resolveTradingAutoExecutionWorkerConcurrency(
    env: NodeJS.ProcessEnv = process.env,
) {
    return parsePositiveInteger(env.WORKER_CONCURRENCY, 10);
}

export function createTradingAutoExecutionConnectionOptions(
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

export function createTradingAutoExecutionQueue(
    env: NodeJS.ProcessEnv = process.env,
) {
    return new Queue<TradingAutoExecutionJobPayload>(TRADING_AUTO_EXECUTION_QUEUE_NAME, {
        connection: createTradingAutoExecutionConnectionOptions(env),
        prefix: resolveQueuePrefix(env),
    });
}

export function createTradingAutoExecutionWorker(
    processor: (
        payload: TradingAutoExecutionJobPayload,
        context: TradingAutoExecutionAttemptContext,
    ) => Promise<void>,
    env: NodeJS.ProcessEnv = process.env,
) {
    return new Worker<TradingAutoExecutionJobPayload>(
        TRADING_AUTO_EXECUTION_QUEUE_NAME,
        async (job) => processor(job.data, {
            attemptNumber: job.attemptsMade + 1,
            maxAttempts: parsePositiveInteger(
                typeof job.opts.attempts === 'number' ? String(job.opts.attempts) : undefined,
                1,
            ),
        }),
        {
            connection: createTradingAutoExecutionConnectionOptions(env),
            prefix: resolveQueuePrefix(env),
            concurrency: resolveTradingAutoExecutionWorkerConcurrency(env),
        },
    );
}

export class BullMqTradingAutoExecutionJobPublisher implements TradingAutoExecutionJobPublisher {
    private readonly queue: Queue<TradingAutoExecutionJobPayload>;

    constructor(
        private readonly env: NodeJS.ProcessEnv = process.env,
        queue?: Queue<TradingAutoExecutionJobPayload>,
    ) {
        this.queue = queue ?? createTradingAutoExecutionQueue(env);
    }

    async enqueue(input: TradingAutoExecutionJobPayload): Promise<void> {
        await this.queue.add(
            TRADING_AUTO_EXECUTION_JOB_NAME,
            input,
            {
                jobId: input.tradeIntentId,
                attempts: 3,
                backoff: {
                    type: 'exponential',
                    delay: 2000,
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
