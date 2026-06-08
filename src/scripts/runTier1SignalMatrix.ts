import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { SignalPlatformService } from '../services/signals/SignalPlatformService';
import { getTier1ComposedSignalSeeds } from '../services/signals/tier1ComposedSignals';
import { createDefaultBlockRegistry } from '../services/signals/blocks/createDefaultBlockRegistry';
import { validateComposedSignalDefinition } from '../services/signals/composedSignalValidation';
import { ComposedSignalDefinition, ComposedSignalPlugin } from '../services/signals/ComposedSignalPlugin';
import { SignalRegistry } from '../services/signals/SignalRegistry';
import { ExecutionConfigInput, SignalRunOutput } from '../services/signals/types';
import { normalizeMarketSymbol } from '../utils/symbols';
import { normalizeTimeframe } from '../utils/timeframes';

dotenv.config();

const DEFAULT_SYMBOLS = ['BTCUSD', 'XAUUSD', 'XAGUSD'] as const;
const DEFAULT_TIMEFRAMES = ['15m', '30m', '1h', '3h', '4h'] as const;
const DEFAULT_FROM = '2019-01-01T00:00:00.000Z';
const DEFAULT_TO = '2026-03-14T23:59:59.999Z';
const DEFAULT_TOP = 20;
const DEFAULT_MAX_CONCURRENCY = 2;
const BREAK_EVEN_EPSILON = 0.0001;
const DEFAULT_OUTPUT_DIR = path.resolve(process.cwd(), 'artifacts', 'signal-matrix');

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

export interface CliOptions {
    symbols: string[];
    timeframes: string[];
    from: Date;
    to: Date;
    initialEquity: number;
    riskPercent: number;
    maxConcurrency: number;
    top: number;
    full: boolean;
    writeFiles: boolean;
    outputDir: string;
    executionConfig: ExecutionConfigInput;
}

type ResolvedDefinition = {
    code: string;
    version: number;
    name: string;
    source: 'db' | 'seed';
};

type ResolutionWarning = {
    key: string;
    message: string;
};

export interface MatrixMetrics {
    signalCount: number;
    resultCount: number;
    closedTrades: number;
    openTrades: number;
    wins: number;
    losses: number;
    breakEven: number;
    winRate: number;
    profitFactor: number;
    expectancy: number;
    netR: number;
    netUsd: number;
    avgWinR: number;
    avgLossR: number;
    maxDrawdownPct: number;
}

export interface MatrixRow extends MatrixMetrics {
    signalCode: string;
    signalVersion: number;
    signalName: string;
    definitionSource: 'db' | 'seed';
    symbol: string;
    timeframe: string;
    status: 'SUCCEEDED' | 'NO_DATA' | 'FAILED';
    barsProcessed: number;
    events: number;
    traces: number;
    durationMs: number;
    error?: string;
}

type MatrixReport = {
    generatedAt: string;
    options: {
        symbols: string[];
        timeframes: string[];
        from: string;
        to: string;
        initialEquity: number;
        riskPercent: number;
        maxConcurrency: number;
        executionConfig: ExecutionConfigInput;
    };
    warnings: ResolutionWarning[];
    summary: {
        totalRuns: number;
        succeeded: number;
        noData: number;
        failed: number;
    };
    bestBySignal: MatrixRow[];
    topRows: MatrixRow[];
    rows: MatrixRow[];
};

const round = (value: number, digits = 2) => Number(value.toFixed(digits));

const average = (values: number[]) => {
    if (values.length === 0) {
        return 0;
    }

    return values.reduce((sum, value) => sum + value, 0) / values.length;
};

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

const parseCsv = (raw: string) => raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

export function parseArgs(argv: string[]): CliOptions {
    let symbols: string[] = [...DEFAULT_SYMBOLS];
    let timeframes: string[] = [...DEFAULT_TIMEFRAMES];
    let from = new Date(DEFAULT_FROM);
    let to = new Date(DEFAULT_TO);
    let initialEquity = 10_000;
    let riskPercent = 2;
    let maxConcurrency = DEFAULT_MAX_CONCURRENCY;
    let top = DEFAULT_TOP;
    let full = false;
    let writeFiles = true;
    let outputDir = DEFAULT_OUTPUT_DIR;
    let feeBps: number | null = null;
    let slippageBps: number | null = null;
    const executionConfig: ExecutionConfigInput = { ...DEFAULT_EXECUTION_CONFIG };

    for (const arg of argv) {
        if (arg === '--full') {
            full = true;
            continue;
        }

        if (arg === '--no-write') {
            writeFiles = false;
            continue;
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
            maxConcurrency = Math.max(1, Math.min(8, Math.trunc(parsePositiveNumberArg('maxConcurrency', arg.slice('--maxConcurrency='.length)))));
            continue;
        }

        if (arg.startsWith('--top=')) {
            top = Math.max(1, Math.trunc(parsePositiveNumberArg('top', arg.slice('--top='.length))));
            continue;
        }

        if (arg.startsWith('--outputDir=')) {
            outputDir = path.resolve(arg.slice('--outputDir='.length).trim());
            continue;
        }

        if (arg.startsWith('--feeBps=')) {
            feeBps = parseNumberArg('feeBps', arg.slice('--feeBps='.length));
            continue;
        }

        if (arg.startsWith('--slippageBps=')) {
            slippageBps = parseNumberArg('slippageBps', arg.slice('--slippageBps='.length));
            continue;
        }

        if (arg.startsWith('--entryFeeBps=')) {
            executionConfig.entryFeeBps = parseNumberArg('entryFeeBps', arg.slice('--entryFeeBps='.length));
            continue;
        }

        if (arg.startsWith('--exitFeeBps=')) {
            executionConfig.exitFeeBps = parseNumberArg('exitFeeBps', arg.slice('--exitFeeBps='.length));
            continue;
        }

        if (arg.startsWith('--entrySlippageBps=')) {
            executionConfig.entrySlippageBps = parseNumberArg('entrySlippageBps', arg.slice('--entrySlippageBps='.length));
            continue;
        }

        if (arg.startsWith('--exitSlippageBps=')) {
            executionConfig.exitSlippageBps = parseNumberArg('exitSlippageBps', arg.slice('--exitSlippageBps='.length));
            continue;
        }

        if (arg.startsWith('--orderTiming=')) {
            executionConfig.orderTiming = arg.slice('--orderTiming='.length).trim().toUpperCase() as ExecutionConfigInput['orderTiming'];
            continue;
        }

        if (arg === '--help' || arg === '-h') {
            printUsage();
            process.exit(0);
        }

        throw new Error(`Unknown argument: ${arg}`);
    }

    if (feeBps !== null) {
        executionConfig.entryFeeBps = feeBps;
        executionConfig.exitFeeBps = feeBps;
    }
    if (slippageBps !== null) {
        executionConfig.entrySlippageBps = slippageBps;
        executionConfig.exitSlippageBps = slippageBps;
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
        top,
        full,
        writeFiles,
        outputDir,
        executionConfig,
    };
}

export function summarizeRunOutput(output: SignalRunOutput): MatrixMetrics {
    const closedTrades = output.results.filter((result) => !result.isOpen);
    const openTrades = output.results.filter((result) => result.isOpen);
    const wins = closedTrades.filter((result) => Number(result.rMultiple) > BREAK_EVEN_EPSILON);
    const losses = closedTrades.filter((result) => Number(result.rMultiple) < -BREAK_EVEN_EPSILON);
    const breakEven = closedTrades.filter((result) => Math.abs(Number(result.rMultiple)) <= BREAK_EVEN_EPSILON);
    const netR = closedTrades.reduce((sum, result) => sum + Number(result.rMultiple), 0);
    const netUsd = closedTrades.reduce((sum, result) => sum + Number(result.pnlUsd), 0);
    const grossProfit = wins.reduce((sum, result) => sum + Math.max(Number(result.rMultiple), 0), 0);
    const grossLoss = losses.reduce((sum, result) => sum + Math.abs(Math.min(Number(result.rMultiple), 0)), 0);

    return {
        signalCount: output.signals.length,
        resultCount: output.results.length,
        closedTrades: closedTrades.length,
        openTrades: openTrades.length,
        wins: wins.length,
        losses: losses.length,
        breakEven: breakEven.length,
        winRate: round(closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0, 2),
        profitFactor: round(grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? grossProfit : 0, 2),
        expectancy: round(closedTrades.length > 0 ? netR / closedTrades.length : 0, 3),
        netR: round(netR, 2),
        netUsd: round(netUsd, 2),
        avgWinR: round(average(wins.map((result) => Number(result.rMultiple))), 2),
        avgLossR: round(average(losses.map((result) => Number(result.rMultiple))), 2),
        maxDrawdownPct: round(
            closedTrades.reduce((worst, result) => Math.min(worst, Number(result.maxDrawdownPct)), 0),
            2,
        ),
    };
}

const escapeCsv = (value: unknown) => {
    const stringValue = String(value ?? '');
    return /[",\n]/.test(stringValue)
        ? `"${stringValue.replace(/"/g, '""')}"`
        : stringValue;
};

const sortRows = (rows: MatrixRow[]) => [...rows].sort((left, right) => {
    const leftStatusWeight = left.status === 'SUCCEEDED' ? 0 : left.status === 'NO_DATA' ? 1 : 2;
    const rightStatusWeight = right.status === 'SUCCEEDED' ? 0 : right.status === 'NO_DATA' ? 1 : 2;

    if (leftStatusWeight !== rightStatusWeight) {
        return leftStatusWeight - rightStatusWeight;
    }
    if (left.netR !== right.netR) {
        return right.netR - left.netR;
    }
    if (left.maxDrawdownPct !== right.maxDrawdownPct) {
        return right.maxDrawdownPct - left.maxDrawdownPct;
    }
    if (left.winRate !== right.winRate) {
        return right.winRate - left.winRate;
    }
    if (left.closedTrades !== right.closedTrades) {
        return right.closedTrades - left.closedTrades;
    }
    return left.signalCode.localeCompare(right.signalCode)
        || left.symbol.localeCompare(right.symbol)
        || left.timeframe.localeCompare(right.timeframe);
});

const buildCsv = (rows: MatrixRow[]) => {
    const headers = [
        'signalCode',
        'signalVersion',
        'signalName',
        'definitionSource',
        'symbol',
        'timeframe',
        'status',
        'barsProcessed',
        'signalCount',
        'events',
        'traces',
        'resultCount',
        'closedTrades',
        'openTrades',
        'wins',
        'losses',
        'breakEven',
        'winRate',
        'profitFactor',
        'expectancy',
        'netR',
        'netUsd',
        'avgWinR',
        'avgLossR',
        'maxDrawdownPct',
        'durationMs',
        'error',
    ];

    const lines = [
        headers.join(','),
        ...rows.map((row) => headers.map((header) => escapeCsv((row as unknown as Record<string, unknown>)[header])).join(',')),
    ];

    return lines.join('\n');
};

const buildMarkdown = (report: MatrixReport) => {
    const lines: string[] = [];

    lines.push('# Tier 1 Signal Matrix');
    lines.push('');
    lines.push(`Generated at: ${report.generatedAt}`);
    lines.push(`Window: ${report.options.from} -> ${report.options.to}`);
    lines.push(`Symbols: ${report.options.symbols.join(', ')}`);
    lines.push(`Timeframes: ${report.options.timeframes.join(', ')}`);
    lines.push(`Execution: fee ${report.options.executionConfig.entryFeeBps}/${report.options.executionConfig.exitFeeBps} bps, slippage ${report.options.executionConfig.entrySlippageBps}/${report.options.executionConfig.exitSlippageBps} bps, order ${report.options.executionConfig.orderTiming}`);
    lines.push(`Risk: initialEquity ${report.options.initialEquity}, riskPercent ${report.options.riskPercent}`);
    lines.push('');
    lines.push(`Summary: total=${report.summary.totalRuns}, succeeded=${report.summary.succeeded}, noData=${report.summary.noData}, failed=${report.summary.failed}`);
    lines.push('');

    if (report.warnings.length > 0) {
        lines.push('## Warnings');
        lines.push('');
        for (const warning of report.warnings) {
            lines.push(`- ${warning.key}: ${warning.message}`);
        }
        lines.push('');
    }

    lines.push('## Best Per Signal');
    lines.push('');
    lines.push('| Signal | Symbol | TF | Trades | Winrate | Net R | PF | Max DD | Source |');
    lines.push('| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |');
    for (const row of report.bestBySignal) {
        lines.push(`| ${row.signalCode} | ${row.symbol} | ${row.timeframe} | ${row.closedTrades} | ${row.winRate}% | ${row.netR} | ${row.profitFactor} | ${row.maxDrawdownPct}% | ${row.definitionSource} |`);
    }
    lines.push('');
    lines.push('## Top Rows');
    lines.push('');
    lines.push('| Signal | Symbol | TF | Trades | Winrate | Net R | Net USD | PF | Expectancy | Max DD |');
    lines.push('| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const row of report.topRows) {
        lines.push(`| ${row.signalCode} | ${row.symbol} | ${row.timeframe} | ${row.closedTrades} | ${row.winRate}% | ${row.netR} | ${row.netUsd} | ${row.profitFactor} | ${row.expectancy} | ${row.maxDrawdownPct}% |`);
    }

    return lines.join('\n');
};

const toConsoleRows = (rows: MatrixRow[]) => rows.map((row, index) => ({
    rank: index + 1,
    signal: row.signalCode,
    symbol: row.symbol,
    tf: row.timeframe,
    status: row.status,
    trades: row.closedTrades,
    winRate: `${row.winRate}%`,
    netR: row.netR,
    netUsd: row.netUsd,
    pf: row.profitFactor,
    expR: row.expectancy,
    maxDD: `${row.maxDrawdownPct}%`,
    src: row.definitionSource,
}));

const printUsage = () => {
    console.log('Usage: run-tier1-matrix.cmd [options]');
    console.log('');
    console.log('Options:');
    console.log('  --symbols=BTCUSD,XAUUSD,XAGUSD');
    console.log('  --timeframes=15m,30m,1h,3h,4h');
    console.log('  --from=2019-01-01');
    console.log('  --to=2026-03-14');
    console.log('  --initialEquity=10000');
    console.log('  --riskPercent=2');
    console.log('  --feeBps=4');
    console.log('  --slippageBps=2');
    console.log('  --entryFeeBps=4 --exitFeeBps=4');
    console.log('  --entrySlippageBps=2 --exitSlippageBps=2');
    console.log('  --orderTiming=NEXT_BAR_OPEN');
    console.log('  --maxConcurrency=2');
    console.log('  --top=20');
    console.log('  --full');
    console.log('  --no-write');
    console.log('  --outputDir=artifacts\\signal-matrix');
};

async function resolveTier1Definitions(prisma: PrismaClient) {
    const registry = SignalRegistry.getInstance();
    const blockRegistry = createDefaultBlockRegistry();
    const seeds = getTier1ComposedSignalSeeds();
    const warnings: ResolutionWarning[] = [];
    const dbRows = await prisma.signalDefinition.findMany({
        where: {
            OR: seeds.map((seed) => ({
                code: seed.code,
                version: seed.version,
            })),
        },
        select: {
            code: true,
            version: true,
            name: true,
            isActive: true,
            isComposed: true,
            composedBlocks: true,
        },
    });

    const dbByKey = new Map(
        dbRows.map((row) => [`${row.code.toUpperCase()}@${row.version}`, row]),
    );

    const resolved: ResolvedDefinition[] = [];

    for (const seed of seeds) {
        const key = `${seed.code.toUpperCase()}@${seed.version}`;
        const dbRow = dbByKey.get(key);
        let definitionName = seed.name;
        let definitionSource: 'db' | 'seed' = 'seed';
        let composedDefinition = seed.composedBlocks as unknown as ComposedSignalDefinition;

        if (dbRow) {
            const candidate = dbRow.composedBlocks as unknown as ComposedSignalDefinition | null;
            const issues = dbRow.isActive && dbRow.isComposed && candidate
                ? validateComposedSignalDefinition(candidate, blockRegistry)
                : [{ message: 'DB definition is inactive, not composed, or missing blocks.' }];

            if (issues.length === 0) {
                definitionName = dbRow.name;
                definitionSource = 'db';
                composedDefinition = candidate!;
            } else {
                warnings.push({
                    key,
                    message: `DB definition was ignored and local seed was used instead. ${issues[0].message}`,
                });
            }
        }

        registry.register(new ComposedSignalPlugin(
            composedDefinition,
            blockRegistry,
            seed.code,
            seed.version,
            definitionName,
        ));

        resolved.push({
            code: seed.code,
            version: seed.version,
            name: definitionName,
            source: definitionSource,
        });
    }

    return { resolved, warnings };
}

function buildReport(
    rows: MatrixRow[],
    warnings: ResolutionWarning[],
    options: CliOptions,
): MatrixReport {
    const sorted = sortRows(rows);
    const bestBySignal = getTier1ComposedSignalSeeds()
        .map((seed) => sorted.find((row) => row.signalCode === seed.code))
        .filter((row): row is MatrixRow => Boolean(row));

    return {
        generatedAt: new Date().toISOString(),
        options: {
            symbols: options.symbols,
            timeframes: options.timeframes,
            from: options.from.toISOString(),
            to: options.to.toISOString(),
            initialEquity: options.initialEquity,
            riskPercent: options.riskPercent,
            maxConcurrency: options.maxConcurrency,
            executionConfig: options.executionConfig,
        },
        warnings,
        summary: {
            totalRuns: rows.length,
            succeeded: rows.filter((row) => row.status === 'SUCCEEDED').length,
            noData: rows.filter((row) => row.status === 'NO_DATA').length,
            failed: rows.filter((row) => row.status === 'FAILED').length,
        },
        bestBySignal,
        topRows: sorted.slice(0, options.top),
        rows: sorted,
    };
}

const buildTimestampToken = (date: Date) => {
    const iso = date.toISOString();
    return iso
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}Z$/, 'Z')
        .replace('T', '-');
};

const writeReportFiles = (report: MatrixReport, outputDir: string) => {
    fs.mkdirSync(outputDir, { recursive: true });

    const timestamp = buildTimestampToken(new Date(report.generatedAt));
    const json = JSON.stringify(report, null, 2);
    const csv = buildCsv(report.rows);
    const markdown = buildMarkdown(report);

    const files = [
        { name: `tier1-signal-matrix-${timestamp}.json`, contents: json },
        { name: `tier1-signal-matrix-${timestamp}.csv`, contents: csv },
        { name: `tier1-signal-matrix-${timestamp}.md`, contents: markdown },
        { name: 'tier1-signal-matrix-latest.json', contents: json },
        { name: 'tier1-signal-matrix-latest.csv', contents: csv },
        { name: 'tier1-signal-matrix-latest.md', contents: markdown },
    ];

    for (const file of files) {
        fs.writeFileSync(path.join(outputDir, file.name), file.contents, 'utf8');
    }
}

async function runMatrix(options: CliOptions) {
    const prisma = new PrismaClient();

    try {
        const { resolved, warnings } = await resolveTier1Definitions(prisma);
        const platform = new SignalPlatformService(prisma);
        const tasks = resolved.flatMap((definition) => options.symbols.flatMap((symbol) => options.timeframes.map((timeframe) => ({
            definition,
            symbol,
            timeframe,
        }))));
        const rows: MatrixRow[] = new Array(tasks.length);
        let cursor = 0;
        let completed = 0;

        const worker = async () => {
            while (cursor < tasks.length) {
                const index = cursor;
                cursor += 1;
                const task = tasks[index];
                const startedAt = Date.now();

                try {
                    const output = await platform.runPreview({
                        signalCode: task.definition.code,
                        signalVersion: task.definition.version,
                        symbol: task.symbol,
                        timeframe: task.timeframe,
                        from: options.from,
                        to: options.to,
                        parameters: {},
                        initialEquity: options.initialEquity,
                        riskPercent: options.riskPercent,
                        executionConfig: options.executionConfig,
                    });
                    const metrics = summarizeRunOutput(output);
                    const status = output.barsProcessed === 0 ? 'NO_DATA' : 'SUCCEEDED';

                    rows[index] = {
                        signalCode: task.definition.code,
                        signalVersion: task.definition.version,
                        signalName: task.definition.name,
                        definitionSource: task.definition.source,
                        symbol: task.symbol,
                        timeframe: task.timeframe,
                        status,
                        barsProcessed: output.barsProcessed,
                        events: output.events.length,
                        traces: output.traces.length,
                        durationMs: Date.now() - startedAt,
                        ...metrics,
                    };
                } catch (error) {
                    rows[index] = {
                        signalCode: task.definition.code,
                        signalVersion: task.definition.version,
                        signalName: task.definition.name,
                        definitionSource: task.definition.source,
                        symbol: task.symbol,
                        timeframe: task.timeframe,
                        status: 'FAILED',
                        barsProcessed: 0,
                        events: 0,
                        traces: 0,
                        durationMs: Date.now() - startedAt,
                        error: error instanceof Error ? error.message : String(error),
                        ...summarizeRunOutput({
                            barsProcessed: 0,
                            signals: [],
                            events: [],
                            traces: [],
                            results: [],
                        }),
                    };
                }

                completed += 1;
                const row = rows[index];
                console.log(
                    `[${completed}/${tasks.length}] ${row.signalCode} ${row.symbol} ${row.timeframe} ` +
                    `=> ${row.status} | trades=${row.closedTrades} | winRate=${row.winRate}% | ` +
                    `netR=${row.netR} | maxDD=${row.maxDrawdownPct}%`,
                );
            }
        };

        await Promise.all(Array.from(
            { length: Math.min(options.maxConcurrency, tasks.length) },
            () => worker(),
        ));

        const report = buildReport(rows, warnings, options);
        return report;
    } finally {
        await prisma.$disconnect();
    }
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const report = await runMatrix(options);
    const rowsToDisplay = options.full ? report.rows : report.topRows;

    console.log('');
    console.log('Tier 1 signal matrix complete');
    console.log(`Generated at: ${report.generatedAt}`);
    console.log(`Window: ${report.options.from} -> ${report.options.to}`);
    console.log(`Summary: total=${report.summary.totalRuns}, succeeded=${report.summary.succeeded}, noData=${report.summary.noData}, failed=${report.summary.failed}`);
    console.log('');

    if (report.warnings.length > 0) {
        console.log('Warnings:');
        for (const warning of report.warnings) {
            console.log(`- ${warning.key}: ${warning.message}`);
        }
        console.log('');
    }

    console.log(options.full ? 'Full matrix:' : `Top ${rowsToDisplay.length} rows:`);
    console.table(toConsoleRows(rowsToDisplay));

    console.log('Best per signal:');
    console.table(toConsoleRows(report.bestBySignal));

    if (options.writeFiles) {
        writeReportFiles(report, options.outputDir);
        console.log(`Saved reports to: ${options.outputDir}`);
    } else {
        console.log('File output skipped via --no-write');
    }
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.stack ?? error.message : error);
        process.exit(1);
    });
}
