import { ConnectionOptions, Queue, Worker } from 'bullmq';

export const BACKTEST_EXECUTION_QUEUE_NAME = 'backtest-execution';
export const BACKTEST_EXECUTION_JOB_NAME = 'execute-backtest-run';

export interface BacktestExecutionJobPayload {
    backtestRunId: string;
    batchId?: string;
}

export interface BacktestExecutionAttemptContext {
    attemptNumber: number;
    maxAttempts: number;
}

export interface BacktestQueueStatus {
    waiting: number;
    active: number;
    concurrency: number;
}

export interface BacktestExecutionJobPublisher {
    enqueue(input: BacktestExecutionJobPayload): Promise<void>;
    getQueueStatus?(): Promise<BacktestQueueStatus>;
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

export function resolveBacktestExecutionWorkerConcurrency(
    env: NodeJS.ProcessEnv = process.env,
) {
    return parsePositiveInteger(env.BACKTEST_WORKER_CONCURRENCY, 5);
}

export function createBacktestExecutionConnectionOptions(
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

export function createBacktestExecutionQueue(
    env: NodeJS.ProcessEnv = process.env,
) {
    return new Queue<BacktestExecutionJobPayload>(BACKTEST_EXECUTION_QUEUE_NAME, {
        connection: createBacktestExecutionConnectionOptions(env),
        prefix: resolveQueuePrefix(env),
    });
}

export function createBacktestExecutionWorker(
    processor: (
        payload: BacktestExecutionJobPayload,
        context: BacktestExecutionAttemptContext,
    ) => Promise<void>,
    env: NodeJS.ProcessEnv = process.env,
) {
    return new Worker<BacktestExecutionJobPayload>(
        BACKTEST_EXECUTION_QUEUE_NAME,
        async (job) => processor(job.data, {
            attemptNumber: job.attemptsMade + 1,
            maxAttempts: parsePositiveInteger(
                typeof job.opts.attempts === 'number' ? String(job.opts.attempts) : undefined,
                1,
            ),
        }),
        {
            connection: createBacktestExecutionConnectionOptions(env),
            prefix: resolveQueuePrefix(env),
            concurrency: resolveBacktestExecutionWorkerConcurrency(env),
        },
    );
}

export class BullMqBacktestExecutionJobPublisher implements BacktestExecutionJobPublisher {
    private readonly queue: Queue<BacktestExecutionJobPayload>;

    constructor(
        private readonly env: NodeJS.ProcessEnv = process.env,
        queue?: Queue<BacktestExecutionJobPayload>,
    ) {
        this.queue = queue ?? createBacktestExecutionQueue(env);
    }

    async getQueueStatus(): Promise<BacktestQueueStatus> {
        const [waiting, active] = await Promise.all([
            this.queue.getWaitingCount(),
            this.queue.getActiveCount(),
        ]);
        return {
            waiting,
            active,
            concurrency: resolveBacktestExecutionWorkerConcurrency(this.env),
        };
    }

    async enqueue(input: BacktestExecutionJobPayload): Promise<void> {
        await this.queue.add(
            BACKTEST_EXECUTION_JOB_NAME,
            input,
            {
                jobId: input.backtestRunId,
                attempts: 1,
                removeOnComplete: 100,
                removeOnFail: 50,
            },
        );
    }

    async close(): Promise<void> {
        await this.queue.close();
    }
}
