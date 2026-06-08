import dotenv from 'dotenv';
import { createHash } from 'crypto';
import {
    BacktestRunStatus,
    Prisma,
    PrismaClient,
    SignalSourceType,
} from '@prisma/client';
import {
    ComposedExitStrategyCode,
    ComposedSignalDefinition,
} from '../services/signals/ComposedSignalPlugin';
import { SignalBacktestExecutionService } from '../services/signals/SignalBacktestExecutionService';
import { SignalBacktestRunService } from '../services/signals/SignalBacktestRunService';
import { createDefaultBlockRegistry } from '../services/signals/blocks/createDefaultBlockRegistry';
import { validateComposedSignalDefinition } from '../services/signals/composedSignalValidation';
import { ExecutionConfigInput } from '../services/signals/types';

dotenv.config();

const SYSTEM_ACTOR = 'codex:rerun-non-trail-trailing';
const BATCH_TAG = 'rerun-non-trail-with-trailing-2026-03-26';
const TARGET_PROFILE: ComposedExitStrategyCode = 'BE_1R_TRAIL_2R_3R';
const TRAILING_PROFILES = new Set<ComposedExitStrategyCode>([
    'BE_1R_TRAIL_2R_3R',
    'PARTIAL_1R_BE_SWING_TRAIL',
    'BE_1R_PARTIAL_2R_TRAIL',
]);

type ScriptArgs = {
    dryRun: boolean;
    shard: number;
    shards: number;
};

function parseArgs(argv: string[]): ScriptArgs {
    let dryRun = false;
    let shard = 0;
    let shards = 1;

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--dry-run') {
            dryRun = true;
            continue;
        }
        if (arg === '--shard') {
            shard = Number(argv[index + 1]);
            index += 1;
            continue;
        }
        if (arg === '--shards') {
            shards = Number(argv[index + 1]);
            index += 1;
        }
    }

    if (!Number.isInteger(shards) || shards <= 0) {
        throw new Error(`Invalid --shards value: ${shards}`);
    }

    if (!Number.isInteger(shard) || shard < 0 || shard >= shards) {
        throw new Error(`Invalid --shard value: ${shard}. Expected 0 <= shard < ${shards}.`);
    }

    return { dryRun, shard, shards };
}

const SCRIPT_ARGS = parseArgs(process.argv.slice(2));
const DRY_RUN = SCRIPT_ARGS.dryRun;

type SourceRun = {
    id: string;
    signalCode: string;
    signalVersion: number;
    symbol: string;
    timeframe: string;
    startedAt: Date;
    finishedAt: Date | null;
    initialEquity: Prisma.Decimal;
    riskPercent: Prisma.Decimal;
    parametersJson: Prisma.JsonValue | null;
    executionConfigJson: Prisma.JsonValue | null;
    notes: string | null;
};

type SourceDefinition = {
    id: string;
    code: string;
    version: number;
    name: string;
    category: string | null;
    description: string | null;
    parameterSchema: Prisma.JsonValue;
    indicatorSchema: Prisma.JsonValue | null;
    eventSchema: Prisma.JsonValue | null;
    composedBlocks: Prisma.JsonValue | null;
    isComposed: boolean;
};

type RunSummary = {
    trades: number;
    netPnl: number;
    netR: number;
    winRate: number;
    maxDd: number;
    profitFactor: number | null;
};

type Candidate = {
    run: SourceRun;
    definition: SourceDefinition;
    sourceProfile: ComposedExitStrategyCode | 'UNKNOWN';
};

type CreatedRun = {
    sourceRunId: string;
    sourceSignalCode: string;
    sourceSignalVersion: number;
    sourceProfile: string;
    trailingSignalCode: string;
    trailingSignalVersion: number;
    trailingSignalDefinitionId: string;
    backtestRunId: string;
    symbol: string;
    timeframe: string;
    startedAt: string;
    finishedAt: string;
    initialEquity: number;
    riskPercent: number;
    summary: RunSummary;
};

const jsonClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const isRecord = (value: unknown): value is Record<string, unknown> => (
    !!value && typeof value === 'object' && !Array.isArray(value)
);

const normalizeCode = (value: string): string => value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

const trimToLength = (value: string, maxLength: number): string => (
    value.length <= maxLength ? value : value.slice(0, maxLength)
);

const buildTrailingSignalCode = (sourceCode: string, sourceVersion: number): string => {
    const normalizedSource = normalizeCode(sourceCode);
    const suffix = `_TR_BE1R_T23R_V${sourceVersion}`;
    const raw = `${normalizedSource}${suffix}`;

    if (raw.length <= 60) {
        return raw;
    }

    const digest = createHash('sha1').update(raw).digest('hex').slice(0, 8).toUpperCase();
    const prefixLength = 60 - suffix.length - 1 - digest.length;
    return `${normalizedSource.slice(0, Math.max(8, prefixLength))}_${digest}${suffix}`;
};

const buildTrailingSignalName = (sourceName: string): string => (
    trimToLength(`${sourceName} [Trail ${TARGET_PROFILE}]`, 120)
);

const buildTrailingSignalDescription = (
    sourceDefinition: SourceDefinition,
    sourceProfile: string,
): string => trimToLength(
    `Trailing clone of ${sourceDefinition.code}@${sourceDefinition.version} from ${sourceProfile} to ${TARGET_PROFILE}. ${sourceDefinition.description ?? ''}`.trim(),
    5000,
);

const buildRunNotes = (candidate: Candidate): string => [
    `[${BATCH_TAG}]`,
    `sourceRun=${candidate.run.id}`,
    `sourceSignal=${candidate.run.signalCode}@${candidate.run.signalVersion}`,
    `sourceProfile=${candidate.sourceProfile}`,
    `trailProfile=${TARGET_PROFILE}`,
    candidate.run.notes ? `sourceNotes=${candidate.run.notes}` : null,
].filter((value): value is string => Boolean(value)).join(' | ');

const extractSourceRunIdFromNotes = (notes: string | null): string | null => {
    if (!notes) {
        return null;
    }

    const match = notes.match(/sourceRun=([a-z0-9]+)/i);
    return match?.[1] ?? null;
};

const resolveSourceProfile = (definition: SourceDefinition): ComposedExitStrategyCode | 'UNKNOWN' => {
    if (!isRecord(definition.composedBlocks)) {
        return 'UNKNOWN';
    }

    const exitManagement = definition.composedBlocks.exitManagement;
    if (!isRecord(exitManagement) || typeof exitManagement.profileCode !== 'string') {
        return 'HARD_SIGNAL_TP';
    }

    return exitManagement.profileCode as ComposedExitStrategyCode;
};

const mergeJsonObject = (
    base: Prisma.JsonValue | null | undefined,
    extra: Record<string, unknown>,
): Prisma.InputJsonValue => ({
    ...(isRecord(base) ? jsonClone(base) : {}),
    ...extra,
}) as Prisma.InputJsonValue;

async function summarizeRun(prisma: PrismaClient, backtestRunId: string): Promise<RunSummary> {
    const rows = await prisma.backtestTradeResult.findMany({
        where: {
            backtestRunId,
            isOpen: false,
        },
        select: {
            pnlUsd: true,
            rMultiple: true,
            win: true,
            maxDrawdownPct: true,
        },
    });

    const netPnl = rows.reduce((sum, row) => sum + Number(row.pnlUsd), 0);
    const netR = rows.reduce((sum, row) => sum + Number(row.rMultiple), 0);
    const wins = rows.filter((row) => row.win).length;
    const maxDd = rows.length ? Math.min(...rows.map((row) => Number(row.maxDrawdownPct))) : 0;
    const grossWin = rows
        .filter((row) => Number(row.pnlUsd) > 0)
        .reduce((sum, row) => sum + Number(row.pnlUsd), 0);
    const grossLoss = Math.abs(rows
        .filter((row) => Number(row.pnlUsd) < 0)
        .reduce((sum, row) => sum + Number(row.pnlUsd), 0));

    return {
        trades: rows.length,
        netPnl: Number(netPnl.toFixed(2)),
        netR: Number(netR.toFixed(2)),
        winRate: rows.length ? Number(((wins / rows.length) * 100).toFixed(2)) : 0,
        maxDd: Number(maxDd.toFixed(2)),
        profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : null,
    };
}

async function loadCandidates(prisma: PrismaClient): Promise<{
    candidates: Candidate[];
    skipped: Array<{ runId: string; reason: string }>;
}> {
    const runs = await prisma.backtestRun.findMany({
        where: {
            sourceType: SignalSourceType.GENERATED,
            status: BacktestRunStatus.COMPLETED,
            signalCode: { not: null },
            signalVersion: { not: null },
        },
        select: {
            id: true,
            signalCode: true,
            signalVersion: true,
            symbol: true,
            timeframe: true,
            startedAt: true,
            finishedAt: true,
            initialEquity: true,
            riskPercent: true,
            parametersJson: true,
            executionConfigJson: true,
            notes: true,
        },
        orderBy: [
            { createdAt: 'desc' },
            { id: 'desc' },
        ],
    });

    const sourceRuns = runs.map((run) => ({
        ...run,
        signalCode: run.signalCode!,
        signalVersion: run.signalVersion!,
    }));

    const keySet = new Set(sourceRuns.map((run) => `${run.signalCode}@${run.signalVersion}`));
    const keyPairs = Array.from(keySet).map((value) => {
        const [code, version] = value.split('@');
        return { code, version: Number(version) };
    });

    const definitions = await prisma.signalDefinition.findMany({
        where: {
            OR: keyPairs.map((pair) => ({
                code: pair.code,
                version: pair.version,
            })),
        },
        select: {
            id: true,
            code: true,
            version: true,
            name: true,
            category: true,
            description: true,
            parameterSchema: true,
            indicatorSchema: true,
            eventSchema: true,
            composedBlocks: true,
            isComposed: true,
        },
    });

    const definitionByKey = new Map(definitions.map((definition) => [`${definition.code}@${definition.version}`, definition]));

    const existingTrailingRuns = await prisma.backtestRun.findMany({
        where: {
            sourceType: SignalSourceType.GENERATED,
            notes: { contains: `[${BATCH_TAG}]` },
        },
        select: {
            id: true,
            notes: true,
        },
    });

    const existingCloneSourceRunIds = new Set(
        existingTrailingRuns
            .map((run) => extractSourceRunIdFromNotes(run.notes))
            .filter((value): value is string => Boolean(value)),
    );

    const candidates: Candidate[] = [];
    const skipped: Array<{ runId: string; reason: string }> = [];

    for (const run of sourceRuns) {
        if (existingCloneSourceRunIds.has(run.id)) {
            skipped.push({ runId: run.id, reason: 'already cloned in this batch' });
            continue;
        }

        const definition = definitionByKey.get(`${run.signalCode}@${run.signalVersion}`);
        if (!definition) {
            skipped.push({ runId: run.id, reason: 'signal definition not found' });
            continue;
        }

        if (!definition.isComposed || !isRecord(definition.composedBlocks)) {
            skipped.push({ runId: run.id, reason: 'signal definition is not a composed signal' });
            continue;
        }

        const sourceProfile = resolveSourceProfile(definition);
        if (sourceProfile !== 'UNKNOWN' && TRAILING_PROFILES.has(sourceProfile)) {
            skipped.push({ runId: run.id, reason: `already trailing (${sourceProfile})` });
            continue;
        }

        candidates.push({
            run,
            definition,
            sourceProfile,
        });
    }

    return { candidates, skipped };
}

async function ensureTrailingDefinition(
    prisma: PrismaClient,
    candidate: Candidate,
): Promise<{ id: string; code: string; version: number; name: string }> {
    const derivedCode = buildTrailingSignalCode(candidate.definition.code, candidate.definition.version);
    const existing = await prisma.signalDefinition.findUnique({
        where: {
            code_version: {
                code: derivedCode,
                version: 1,
            },
        },
        select: {
            id: true,
            code: true,
            version: true,
            name: true,
        },
    });

    if (existing) {
        return existing;
    }

    const composedDefinition = jsonClone(candidate.definition.composedBlocks) as unknown as ComposedSignalDefinition;
    composedDefinition.exitManagement = {
        ...(composedDefinition.exitManagement ?? {}),
        profileCode: TARGET_PROFILE,
    };
    composedDefinition.lineage = {
        relationship: 'REFINEMENT',
        parentSignalId: candidate.definition.id,
        parentCode: candidate.definition.code,
        parentVersion: candidate.definition.version,
        parentName: candidate.definition.name,
    };

    const blockRegistry = createDefaultBlockRegistry();
    const issues = validateComposedSignalDefinition(composedDefinition, blockRegistry);
    if (issues.length > 0) {
        throw new Error([
            `Trailing clone validation failed for ${candidate.definition.code}@${candidate.definition.version}:`,
            ...issues.map((issue) => `- ${issue.message}`),
        ].join('\n'));
    }

    try {
        return await prisma.signalDefinition.create({
            data: {
                code: derivedCode,
                version: 1,
                name: buildTrailingSignalName(candidate.definition.name),
                category: candidate.definition.category,
                description: buildTrailingSignalDescription(candidate.definition, candidate.sourceProfile),
                parameterSchema: jsonClone(candidate.definition.parameterSchema) as Prisma.InputJsonValue,
                indicatorSchema: mergeJsonObject(candidate.definition.indicatorSchema, {
                    batchTag: BATCH_TAG,
                    sourceCode: candidate.definition.code,
                    sourceVersion: candidate.definition.version,
                    sourceProfile: candidate.sourceProfile,
                    trailingProfile: TARGET_PROFILE,
                }),
                eventSchema: mergeJsonObject(candidate.definition.eventSchema, {
                    profileCode: TARGET_PROFILE,
                    batchTag: BATCH_TAG,
                    sourceCode: candidate.definition.code,
                    sourceVersion: candidate.definition.version,
                    sourceProfile: candidate.sourceProfile,
                }),
                composedBlocks: composedDefinition as unknown as Prisma.InputJsonValue,
                isComposed: true,
                isActive: true,
                createdBy: SYSTEM_ACTOR,
            },
            select: {
                id: true,
                code: true,
                version: true,
                name: true,
            },
        });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            const resolved = await prisma.signalDefinition.findUnique({
                where: {
                    code_version: {
                        code: derivedCode,
                        version: 1,
                    },
                },
                select: {
                    id: true,
                    code: true,
                    version: true,
                    name: true,
                },
            });

            if (resolved) {
                return resolved;
            }
        }

        throw error;
    }
}

function buildRunParameters(run: SourceRun): Record<string, unknown> {
    const parameters = isRecord(run.parametersJson)
        ? jsonClone(run.parametersJson)
        : {};

    parameters.exitStrategy = TARGET_PROFILE;

    return parameters;
}

function buildExecutionConfig(run: SourceRun): ExecutionConfigInput | undefined {
    if (!isRecord(run.executionConfigJson)) {
        return undefined;
    }

    return jsonClone(run.executionConfigJson) as ExecutionConfigInput;
}

async function main() {
    const prisma = new PrismaClient();
    const backtests = new SignalBacktestRunService(prisma);
    const execution = new SignalBacktestExecutionService(prisma, {
        deliverConfiguredOutputs: async () => [],
    });

    try {
        const { candidates, skipped } = await loadCandidates(prisma);
        const shardCandidates = candidates.filter((_, index) => index % SCRIPT_ARGS.shards === SCRIPT_ARGS.shard);

        console.log(
            `[${BATCH_TAG}] totalCandidates=${candidates.length} shardCandidates=${shardCandidates.length} skipped=${skipped.length} dryRun=${DRY_RUN} shard=${SCRIPT_ARGS.shard}/${SCRIPT_ARGS.shards}`,
        );

        const createdRuns: CreatedRun[] = [];

        for (const [index, candidate] of shardCandidates.entries()) {
            const label = `${index + 1}/${shardCandidates.length} ${candidate.run.id} ${candidate.run.signalCode}@${candidate.run.signalVersion}`;
            console.log(`→ ${label} | ${candidate.sourceProfile} -> ${TARGET_PROFILE}`);

            if (DRY_RUN) {
                continue;
            }

            const trailingDefinition = await ensureTrailingDefinition(prisma, candidate);

            const createdBacktest = await backtests.createGeneratedBacktest({
                signalCode: trailingDefinition.code,
                signalVersion: trailingDefinition.version,
                symbol: candidate.run.symbol,
                timeframe: candidate.run.timeframe,
                dateRange: {
                    from: candidate.run.startedAt.toISOString(),
                    to: (candidate.run.finishedAt ?? new Date()).toISOString(),
                },
                parameters: buildRunParameters(candidate.run),
                executionConfig: buildExecutionConfig(candidate.run),
                initialEquity: Number(candidate.run.initialEquity),
                riskPercent: Number(candidate.run.riskPercent),
                notes: buildRunNotes(candidate),
            });

            await execution.executeRun(createdBacktest.backtestRunId);
            const summary = await summarizeRun(prisma, createdBacktest.backtestRunId);

            createdRuns.push({
                sourceRunId: candidate.run.id,
                sourceSignalCode: candidate.run.signalCode,
                sourceSignalVersion: candidate.run.signalVersion,
                sourceProfile: candidate.sourceProfile,
                trailingSignalCode: trailingDefinition.code,
                trailingSignalVersion: trailingDefinition.version,
                trailingSignalDefinitionId: trailingDefinition.id,
                backtestRunId: createdBacktest.backtestRunId,
                symbol: candidate.run.symbol,
                timeframe: candidate.run.timeframe,
                startedAt: candidate.run.startedAt.toISOString(),
                finishedAt: (candidate.run.finishedAt ?? new Date()).toISOString(),
                initialEquity: Number(candidate.run.initialEquity),
                riskPercent: Number(candidate.run.riskPercent),
                summary,
            });

            console.log(
                `  done run=${createdBacktest.backtestRunId} trades=${summary.trades} winRate=${summary.winRate}% netPnl=${summary.netPnl}`,
            );
        }

        console.log(JSON.stringify({
            batchTag: BATCH_TAG,
            targetProfile: TARGET_PROFILE,
            dryRun: DRY_RUN,
            shard: SCRIPT_ARGS.shard,
            shards: SCRIPT_ARGS.shards,
            candidateCount: candidates.length,
            shardCandidateCount: shardCandidates.length,
            skipped,
            createdRuns,
        }, null, 2));
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exit(1);
});
