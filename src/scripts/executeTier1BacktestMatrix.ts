import dotenv from 'dotenv';
import { BacktestRunStatus, PrismaClient } from '@prisma/client';
import { SignalBacktestExecutionService } from '../services/signals/SignalBacktestExecutionService';
import { SignalBacktestRunService } from '../services/signals/SignalBacktestRunService';
import { createDefaultBlockRegistry } from '../services/signals/blocks/createDefaultBlockRegistry';
import { getTier1ComposedSignalSeeds, upsertTier1ComposedSignals } from '../services/signals/tier1ComposedSignals';
import { ExecutionConfigInput } from '../services/signals/types';
import { normalizeMarketSymbol } from '../utils/symbols';
import { normalizeTimeframe } from '../utils/timeframes';

dotenv.config();

const DEFAULT_SYMBOLS = ['BTCUSD', 'XAUUSD', 'XAGUSD'] as const;
const DEFAULT_TIMEFRAMES = ['15m', '30m', '1h', '3h', '4h'] as const;
const DEFAULT_FROM = '2019-01-01T00:00:00.000Z';
const DEFAULT_TO = '2026-03-14T23:59:59.999Z';
const DEFAULT_BATCH_TAG = 'tier1-matrix-2019-2026-03-14';
const DEFAULT_MAX_CONCURRENCY = 1;

const DEFAULT_EXECUTION_CONFIG: ExecutionConfigInput = {
    entryFeeBps: 4,
    exitFeeBps: 4,
    entrySlippageBps: 2,
    exitSlippageBps: 2,
    orderTiming: 'NEXT_BAR_OPEN',
    stopLoss: { mode: 'SIGNAL_PRICE' },
    takeProfit: { mode: 'SIGNAL_PRICE' },
    positionSizing: { mode: 'RISK_BASED' },
};

type MatrixDefinition = {
    code: string;
    version: number;
    name: string;
};

type MatrixTask = {
    definition: MatrixDefinition;
    symbol: string;
    timeframe: string;
};

type ExistingRun = {
    id: string;
    status: BacktestRunStatus;
    name: string;
    signalCode: string | null;
    signalVersion: number | null;
    symbol: string;
    timeframe: string;
    startedAt: Date;
    finishedAt: Date | null;
};

type TaskOutcome =
    | {
        state: 'SKIPPED_COMPLETED';
        task: MatrixTask;
        runId: string;
        status: BacktestRunStatus;
    }
    | {
        state: 'EXECUTED';
        task: MatrixTask;
        runId: string;
        status: 'COMPLETED' | 'FAILED';
        counts: {
            signals: number;
            events: number;
            traces: number;
            results: number;
        };
    }
    | {
        state: 'FAILED';
        task: MatrixTask;
        error: string;
        runId?: string;
    };

type CliOptions = {
    symbols: string[];
    timeframes: string[];
    from: Date;
    to: Date;
    initialEquity: number;
    riskPercent: number;
    maxConcurrency: number;
    batchTag: string;
    executionConfig: ExecutionConfigInput;
};

const parseCsv = (raw: string) => raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

const parseNumberArg = (label: string, raw: string) => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
        throw new Error(`Invalid ${label}: ${raw}`);
    }
    return parsed;
};

const parsePositiveNumberArg = (label: string, raw: string) => {
    const parsed = parseNumberArg(label, raw);
    if (parsed <= 0) {
        throw new Error(`${label} must be greater than 0.`);
    }
    return parsed;
};

const parseDateArg = (label: string, raw: string, boundary: 'start' | 'end') => {
    const trimmed = raw.trim();
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
        ? `${trimmed}${boundary === 'start' ? 'T00:00:00.000Z' : 'T23:59:59.999Z'}`
        : trimmed;
    const parsed = new Date(normalized);

    if (Number.isNaN(parsed.getTime())) {
        throw new Error(`Invalid ${label}: ${raw}`);
    }

    return parsed;
};

const formatTaskKey = (task: MatrixTask, from: Date, to: Date) => (
    `${task.definition.code}@${task.definition.version}|${task.symbol}|${task.timeframe}|${from.toISOString()}|${to.toISOString()}`
);

const buildNotes = (task: MatrixTask, batchTag: string, from: Date, to: Date) => (
    `[tier1-matrix:${batchTag}] ${task.definition.code}@${task.definition.version} ${task.symbol} ${task.timeframe} ${from.toISOString()}..${to.toISOString()}`
);

const printUsage = () => {
    console.log('Usage: node -r ts-node/register src/scripts/executeTier1BacktestMatrix.ts [options]');
    console.log('');
    console.log('Options:');
    console.log('  --symbols=BTCUSD,XAUUSD,XAGUSD');
    console.log('  --timeframes=15m,30m,1h,3h,4h');
    console.log('  --from=2019-01-01');
    console.log('  --to=2026-03-14');
    console.log('  --initialEquity=10000');
    console.log('  --riskPercent=2');
    console.log('  --maxConcurrency=1');
    console.log('  --batchTag=tier1-matrix-2019-2026-03-14');
};

function parseArgs(argv: string[]): CliOptions {
    let symbols: string[] = [...DEFAULT_SYMBOLS];
    let timeframes: string[] = [...DEFAULT_TIMEFRAMES];
    let from = new Date(DEFAULT_FROM);
    let to = new Date(DEFAULT_TO);
    let initialEquity = 10_000;
    let riskPercent = 2;
    let maxConcurrency = DEFAULT_MAX_CONCURRENCY;
    let batchTag = DEFAULT_BATCH_TAG;

    for (const arg of argv) {
        if (arg === '--help' || arg === '-h') {
            printUsage();
            process.exit(0);
        }

        if (arg.startsWith('--symbols=')) {
            const next = parseCsv(arg.slice('--symbols='.length)).map((value) => normalizeMarketSymbol(value));
            if (next.length === 0) {
                throw new Error('Expected at least one symbol in --symbols.');
            }
            symbols = Array.from(new Set(next));
            continue;
        }

        if (arg.startsWith('--timeframes=')) {
            const next = parseCsv(arg.slice('--timeframes='.length)).map((value) => normalizeTimeframe(value));
            if (next.length === 0) {
                throw new Error('Expected at least one timeframe in --timeframes.');
            }
            timeframes = Array.from(new Set(next));
            continue;
        }

        if (arg.startsWith('--from=')) {
            from = parseDateArg('from', arg.slice('--from='.length), 'start');
            continue;
        }

        if (arg.startsWith('--to=')) {
            to = parseDateArg('to', arg.slice('--to='.length), 'end');
            continue;
        }

        if (arg.startsWith('--initialEquity=')) {
            initialEquity = parsePositiveNumberArg('initialEquity', arg.slice('--initialEquity='.length));
            continue;
        }

        if (arg.startsWith('--riskPercent=')) {
            riskPercent = parsePositiveNumberArg('riskPercent', arg.slice('--riskPercent='.length));
            continue;
        }

        if (arg.startsWith('--maxConcurrency=')) {
            maxConcurrency = Math.max(1, Math.min(4, Math.trunc(parsePositiveNumberArg('maxConcurrency', arg.slice('--maxConcurrency='.length)))));
            continue;
        }

        if (arg.startsWith('--batchTag=')) {
            batchTag = arg.slice('--batchTag='.length).trim();
            if (!batchTag) {
                throw new Error('batchTag cannot be empty.');
            }
            continue;
        }

        throw new Error(`Unknown argument: ${arg}`);
    }

    if (from >= to) {
        throw new Error('--from must be earlier than --to.');
    }

    return {
        symbols,
        timeframes,
        from,
        to,
        initialEquity,
        riskPercent,
        maxConcurrency,
        batchTag,
        executionConfig: DEFAULT_EXECUTION_CONFIG,
    };
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const prisma = new PrismaClient();

    try {
        const blockRegistry = createDefaultBlockRegistry();
        const seedResult = await upsertTier1ComposedSignals(prisma, blockRegistry);
        console.log(`[Tier1Matrix] ensured signals: created=${seedResult.created}, updated=${seedResult.updated}, skipped=${seedResult.skipped.length}`);

        const definitions: MatrixDefinition[] = getTier1ComposedSignalSeeds().map((seed) => ({
            code: seed.code,
            version: seed.version,
            name: seed.name,
        }));
        const tasks: MatrixTask[] = definitions.flatMap((definition) => options.symbols.flatMap((symbol) => options.timeframes.map((timeframe) => ({
            definition,
            symbol,
            timeframe,
        }))));
        const existingRuns = await prisma.backtestRun.findMany({
            where: {
                sourceType: 'GENERATED',
                signalCode: { in: definitions.map((definition) => definition.code) },
                symbol: { in: options.symbols },
                timeframe: { in: options.timeframes },
                startedAt: options.from,
                finishedAt: options.to,
                notes: { contains: `[tier1-matrix:${options.batchTag}]` },
            },
            select: {
                id: true,
                status: true,
                name: true,
                signalCode: true,
                signalVersion: true,
                symbol: true,
                timeframe: true,
                startedAt: true,
                finishedAt: true,
            },
            orderBy: { createdAt: 'desc' },
        });
        const existingByKey = new Map<string, ExistingRun>();

        for (const run of existingRuns) {
            const key = `${run.signalCode}@${run.signalVersion}|${run.symbol}|${run.timeframe}|${run.startedAt.toISOString()}|${run.finishedAt?.toISOString()}`;
            if (!existingByKey.has(key)) {
                existingByKey.set(key, run);
            }
        }

        const execution = new SignalBacktestExecutionService(prisma, {
            deliverConfiguredOutputs: async () => [],
        });
        const backtests = new SignalBacktestRunService(prisma);
        const outcomes: TaskOutcome[] = new Array(tasks.length);
        let cursor = 0;
        let completed = 0;

        const worker = async () => {
            while (cursor < tasks.length) {
                const index = cursor;
                cursor += 1;
                const task = tasks[index];
                const taskKey = formatTaskKey(task, options.from, options.to);
                const existing = existingByKey.get(taskKey);

                if (existing?.status === BacktestRunStatus.COMPLETED) {
                    outcomes[index] = {
                        state: 'SKIPPED_COMPLETED',
                        task,
                        runId: existing.id,
                        status: existing.status,
                    };
                } else if (existing?.status === BacktestRunStatus.RUNNING) {
                    outcomes[index] = {
                        state: 'FAILED',
                        task,
                        runId: existing.id,
                        error: `Existing run ${existing.id} is already RUNNING for this batch tag.`,
                    };
                } else {
                    try {
                        if (existing) {
                            const result = await execution.executeRun(existing.id);
                            outcomes[index] = {
                                state: 'EXECUTED',
                                task,
                                runId: result.backtestRunId,
                                status: result.status,
                                counts: {
                                    signals: result.counts.persistedSignals,
                                    events: result.counts.persistedEvents,
                                    traces: result.counts.persistedTraces,
                                    results: result.counts.persistedResults,
                                },
                            };
                        } else {
                            const created = await backtests.createGeneratedBacktest({
                                signalCode: task.definition.code,
                                signalVersion: task.definition.version,
                                symbol: task.symbol,
                                timeframe: task.timeframe,
                                dateRange: {
                                    from: options.from.toISOString(),
                                    to: options.to.toISOString(),
                                },
                                parameters: {},
                                executionConfig: options.executionConfig,
                                initialEquity: options.initialEquity,
                                riskPercent: options.riskPercent,
                                notes: buildNotes(task, options.batchTag, options.from, options.to),
                            });
                            const result = await execution.executeRun(created.backtestRunId);
                            outcomes[index] = {
                                state: 'EXECUTED',
                                task,
                                runId: created.backtestRunId,
                                status: result.status,
                                counts: {
                                    signals: result.counts.persistedSignals,
                                    events: result.counts.persistedEvents,
                                    traces: result.counts.persistedTraces,
                                    results: result.counts.persistedResults,
                                },
                            };
                        }
                    } catch (error) {
                        outcomes[index] = {
                            state: 'FAILED',
                            task,
                            runId: existing?.id,
                            error: error instanceof Error ? error.message : String(error),
                        };
                    }
                }

                completed += 1;
                const outcome = outcomes[index];
                if (outcome.state === 'FAILED') {
                    console.log(`[${completed}/${tasks.length}] ${task.definition.code} ${task.symbol} ${task.timeframe} => FAILED | ${outcome.error}`);
                } else if (outcome.state === 'SKIPPED_COMPLETED') {
                    console.log(`[${completed}/${tasks.length}] ${task.definition.code} ${task.symbol} ${task.timeframe} => SKIPPED_COMPLETED | run=${outcome.runId}`);
                } else {
                    console.log(
                        `[${completed}/${tasks.length}] ${task.definition.code} ${task.symbol} ${task.timeframe} ` +
                        `=> ${outcome.status} | run=${outcome.runId} | signals=${outcome.counts.signals} | results=${outcome.counts.results}`,
                    );
                }
            }
        };

        await Promise.all(Array.from(
            { length: Math.min(options.maxConcurrency, tasks.length) },
            () => worker(),
        ));

        const skipped = outcomes.filter((outcome) => outcome.state === 'SKIPPED_COMPLETED');
        const executed = outcomes.filter((outcome) => outcome.state === 'EXECUTED');
        const failed = outcomes.filter((outcome) => outcome.state === 'FAILED');

        console.log('');
        console.log('[Tier1Matrix] batch complete');
        console.log(`  batchTag: ${options.batchTag}`);
        console.log(`  window : ${options.from.toISOString()} -> ${options.to.toISOString()}`);
        console.log(`  total  : ${outcomes.length}`);
        console.log(`  skipped: ${skipped.length}`);
        console.log(`  done   : ${executed.length}`);
        console.log(`  failed : ${failed.length}`);

        if (failed.length > 0) {
            console.log('');
            console.log('[Tier1Matrix] failures');
            for (const outcome of failed) {
                console.log(`  - ${outcome.task.definition.code} ${outcome.task.symbol} ${outcome.task.timeframe}: ${outcome.error}`);
            }
            process.exitCode = 1;
        }
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exit(1);
});
