import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { ComposedSignalPlugin } from '../services/signals/ComposedSignalPlugin';
import { SignalBacktestExecutionService } from '../services/signals/SignalBacktestExecutionService';
import { SignalPlatformService } from '../services/signals/SignalPlatformService';
import { SignalRegistry } from '../services/signals/SignalRegistry';
import { createDefaultBlockRegistry } from '../services/signals/blocks/createDefaultBlockRegistry';
import {
    BobVolmanVariantId,
    BobVolmanStrategySpec,
    createBobVolmanComposedSignalPayload,
    getBobVolmanStrategySpec,
    listBobVolmanStrategySpecs,
} from './bobVolmanBacktestShared';

dotenv.config();

interface CliOptions {
    variant: BobVolmanVariantId;
    symbol: string | null;
    timeframe: string | null;
    from: string | null;
    to: string | null;
    initialEquity: number | null;
    riskPercent: number | null;
    persist: boolean;
    outPath: string | null;
    listVariants: boolean;
    help: boolean;
}

function printHelp() {
    console.log([
        'Bob Volman backtest runner',
        '',
        'Usage:',
        '  node -r ts-node/register src/scripts/runBobVolmanBacktest.ts --variant breakout_long',
        '',
        'Options:',
        '  --variant <id>           breakout_long | breakout_short | false_break_long | false_break_short',
        '  --symbol <symbol>        Override symbol (default preset uses XAUUSD)',
        '  --timeframe <tf>         Override timeframe (default preset uses M5)',
        '  --from <iso>             Override start timestamp',
        '  --to <iso>               Override end timestamp',
        '  --initial-equity <n>     Override initial equity',
        '  --risk <pct>             Override risk percent per trade',
        '  --persist                Create and execute a generated backtest run in DB',
        '  --out <path>             Write JSON output to a file',
        '  --list-variants          Show available Bob Volman presets',
        '  --help                   Show this message',
        '',
        'Safety:',
        '  Default mode is preview-only and does not write new backtest rows.',
    ].join('\n'));
}

function parseNumber(value: string | undefined, flag: string): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        throw new Error(`${flag} requires a numeric value.`);
    }
    return parsed;
}

function parseArgs(argv: string[]): CliOptions {
    const result: CliOptions = {
        variant: 'breakout_long',
        symbol: null,
        timeframe: null,
        from: null,
        to: null,
        initialEquity: null,
        riskPercent: null,
        persist: false,
        outPath: null,
        listVariants: false,
        help: false,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];

        switch (arg) {
            case '--variant': {
                const value = argv[index + 1] as BobVolmanVariantId | undefined;
                if (!value) {
                    throw new Error('--variant requires a value.');
                }
                result.variant = value;
                index += 1;
                break;
            }
            case '--symbol':
                result.symbol = argv[index + 1] ?? null;
                if (!result.symbol) {
                    throw new Error('--symbol requires a value.');
                }
                index += 1;
                break;
            case '--timeframe':
                result.timeframe = argv[index + 1] ?? null;
                if (!result.timeframe) {
                    throw new Error('--timeframe requires a value.');
                }
                index += 1;
                break;
            case '--from':
                result.from = argv[index + 1] ?? null;
                if (!result.from) {
                    throw new Error('--from requires an ISO timestamp.');
                }
                index += 1;
                break;
            case '--to':
                result.to = argv[index + 1] ?? null;
                if (!result.to) {
                    throw new Error('--to requires an ISO timestamp.');
                }
                index += 1;
                break;
            case '--initial-equity':
                result.initialEquity = parseNumber(argv[index + 1], '--initial-equity');
                index += 1;
                break;
            case '--risk':
                result.riskPercent = parseNumber(argv[index + 1], '--risk');
                index += 1;
                break;
            case '--persist':
                result.persist = true;
                break;
            case '--out':
                result.outPath = argv[index + 1] ?? null;
                if (!result.outPath) {
                    throw new Error('--out requires a filepath.');
                }
                index += 1;
                break;
            case '--list-variants':
                result.listVariants = true;
                break;
            case '--help':
                result.help = true;
                break;
            default:
                throw new Error(`Unknown argument "${arg}".`);
        }
    }

    return result;
}

function round(value: number, digits = 4): number {
    return Number(value.toFixed(digits));
}

function summarizePreview(results: Awaited<ReturnType<SignalPlatformService['runPreview']>>['results']) {
    const closedTrades = results.filter((result) => !result.isOpen);
    const wins = closedTrades.filter((result) => result.win).length;
    const losses = closedTrades.length - wins;
    const netR = closedTrades.reduce((sum, result) => sum + result.rMultiple, 0);
    const pnlUsd = closedTrades.reduce((sum, result) => sum + result.pnlUsd, 0);
    const maxDrawdownPct = closedTrades.reduce(
        (peak, result) => Math.max(peak, result.maxDrawdownPct),
        0,
    );

    return {
        trades: results.length,
        closedTrades: closedTrades.length,
        openTrades: results.length - closedTrades.length,
        wins,
        losses,
        winRatePct: closedTrades.length > 0 ? round((wins / closedTrades.length) * 100, 2) : 0,
        netR: round(netR),
        avgR: closedTrades.length > 0 ? round(netR / closedTrades.length) : 0,
        pnlUsd: round(pnlUsd, 2),
        avgPnlUsd: closedTrades.length > 0 ? round(pnlUsd / closedTrades.length, 2) : 0,
        maxDrawdownPct: round(maxDrawdownPct, 2),
    };
}

function buildPersistedParameters(spec: BobVolmanStrategySpec) {
    return {
        theory: 'Bob Volman',
        preset: spec.id,
        thesis: spec.thesis,
        side: spec.composedDefinition.side,
        matchMode: spec.composedDefinition.matchMode,
        windowBars: spec.composedDefinition.windowBars,
        blocks: spec.composedDefinition.blocks.map((block) => ({
            id: block.id,
            indicatorId: block.indicatorId,
            conditionId: block.conditionId,
        })),
    };
}

function registerStrategy(spec: BobVolmanStrategySpec) {
    const registry = SignalRegistry.getInstance();
    registry.register(
        new ComposedSignalPlugin(
            spec.composedDefinition,
            createDefaultBlockRegistry(),
            spec.signalCode,
            spec.signalVersion,
            spec.name,
        ),
    );
}

async function writeOutput(outPath: string | null, payload: unknown) {
    const serialized = JSON.stringify(payload, null, 2);
    if (!outPath) {
        console.log(serialized);
        return;
    }

    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, `${serialized}\n`, 'utf8');
    console.log(`Wrote output to ${outPath}`);
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    if (args.help) {
        printHelp();
        return;
    }

    if (args.listVariants) {
        await writeOutput(args.outPath, listBobVolmanStrategySpecs().map((variant) => ({
            id: variant.id,
            name: variant.name,
            signalCode: variant.signalCode,
            description: variant.description,
            thesis: variant.thesis,
            defaults: variant.defaults,
        })));
        return;
    }

    const spec = getBobVolmanStrategySpec(args.variant);
    registerStrategy(spec);

    const symbol = args.symbol ?? spec.defaults.symbol;
    const timeframe = args.timeframe ?? spec.defaults.timeframe;
    const from = new Date(args.from ?? spec.defaults.from);
    const to = new Date(args.to ?? spec.defaults.to);
    const initialEquity = args.initialEquity ?? spec.defaults.initialEquity;
    const riskPercent = args.riskPercent ?? spec.defaults.riskPercent;

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        throw new Error('Invalid --from/--to value. Use an ISO timestamp.');
    }

    const prisma = new PrismaClient();

    try {
        if (args.persist) {
            const execution = new SignalBacktestExecutionService(prisma);
            const persisted = await execution.createAndMaybeExecute({
                signalCode: spec.signalCode,
                signalVersion: spec.signalVersion,
                symbol,
                timeframe,
                dateRange: {
                    from: from.toISOString(),
                    to: to.toISOString(),
                },
                parameters: buildPersistedParameters(spec),
                executionConfig: spec.executionConfig,
                initialEquity,
                riskPercent,
            }, true);

            await writeOutput(args.outPath, {
                mode: 'persisted_backtest',
                variant: spec.id,
                signalCode: spec.signalCode,
                signalVersion: spec.signalVersion,
                symbol,
                timeframe,
                from: from.toISOString(),
                to: to.toISOString(),
                initialEquity,
                riskPercent,
                composedSignalPayload: createBobVolmanComposedSignalPayload(spec.id),
                created: persisted.created,
                execution: persisted.execution,
            });
            return;
        }

        const platform = new SignalPlatformService(prisma);
        const preview = await platform.runPreview({
            signalCode: spec.signalCode,
            signalVersion: spec.signalVersion,
            symbol,
            timeframe,
            from,
            to,
            parameters: buildPersistedParameters(spec),
            executionConfig: spec.executionConfig,
            initialEquity,
            riskPercent,
        });

        await writeOutput(args.outPath, {
            mode: 'preview',
            variant: spec.id,
            signalCode: spec.signalCode,
            signalVersion: spec.signalVersion,
            name: spec.name,
            description: spec.description,
            thesis: spec.thesis,
            symbol,
            timeframe,
            from: from.toISOString(),
            to: to.toISOString(),
            initialEquity,
            riskPercent,
            counts: {
                barsProcessed: preview.barsProcessed,
                signals: preview.signals.length,
                events: preview.events.length,
                traces: preview.traces.length,
                results: preview.results.length,
            },
            performance: summarizePreview(preview.results),
            composedSignalPayload: createBobVolmanComposedSignalPayload(spec.id),
        });
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
