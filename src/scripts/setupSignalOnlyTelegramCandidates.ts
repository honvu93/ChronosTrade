/**
 * Signal-only Telegram setup for shortlisted XAU timeframe candidates.
 *
 * Creates or reuses indicator instances only. This script never creates
 * trading automation bindings or MT5 execution links.
 *
 * Usage:
 *   npx ts-node src/scripts/setupSignalOnlyTelegramCandidates.ts
 */

import { Prisma, PrismaClient } from '@prisma/client';

import { TradeGuardConfigInput, ExecutionConfigInput } from '../services/signals/types';
import { getTimeframeAliases } from '../utils/timeframes';

const DECISION_DATE = '2026-03-26';
const ACTIVE_INSTANCE_STATUSES = ['ACTIVE', 'DRAFT', 'PAUSED'] as const;

const BASE_EXECUTION_CONFIG: ExecutionConfigInput = {
    entryFeeBps: 4,
    exitFeeBps: 4,
    entrySlippageBps: 2,
    exitSlippageBps: 2,
    orderTiming: 'NEXT_BAR_OPEN',
    stopLoss: { mode: 'SIGNAL_PRICE' },
    takeProfit: { mode: 'SIGNAL_PRICE' },
    positionSizing: { mode: 'RISK_BASED' },
};

const TIGHT_GUARDS: TradeGuardConfigInput = {
    lossStreakCooldown: { afterLosses: 3, cooldownMinutes: 360 },
    dayLossCap: { maxLosses: 2, maxNetR: 2 },
    equityCurveFilter: { emaTrades: 15, action: 'BLOCK' },
    maxDrawdownHalt: { maxDrawdownPct: 8 },
    minTradeSpacing: { minSpacingMinutes: 240 },
    entryBurstCooldown: { maxEntriesInWindow: 2, windowMinutes: 480, cooldownMinutes: 720 },
};

type CandidateSpec = {
    name: string;
    signalCode: string;
    signalVersion: number;
    symbol: string;
    timeframe: string;
    sourceBacktestRunId: string | null;
    executionConfig: ExecutionConfigInput;
    notes: string;
};

const CANDIDATES: CandidateSpec[] = [
    {
        name: 'Telegram TF M15: NY Session BOS',
        signalCode: 'SYS_XAU_NY_SESSION_BOS_LONG',
        signalVersion: 1,
        symbol: 'XAUUSD',
        timeframe: 'M15',
        sourceBacktestRunId: null,
        executionConfig: BASE_EXECUTION_CONFIG,
        notes: 'CEO shortlist 15M lane. Alert/shadow only for Telegram signal messages.',
    },
    {
        name: 'Telegram TF H1: Session Burst Tight',
        signalCode: 'SYS_T1_SESSION_BURST_LONG',
        signalVersion: 1,
        symbol: 'XAUUSD',
        timeframe: 'H1',
        sourceBacktestRunId: null,
        executionConfig: {
            ...BASE_EXECUTION_CONFIG,
            tradeGuards: TIGHT_GUARDS,
        },
        notes: 'CEO shortlist 1H lane with tight guards. Signal-only Telegram broadcasting.',
    },
    {
        name: 'Telegram TF H2: BOS+FVG ADX',
        signalCode: 'SYS_4TF_BOS_FVG_ADX_LONG',
        signalVersion: 1,
        symbol: 'XAUUSD',
        timeframe: 'H2',
        sourceBacktestRunId: 'cmn7oj8bv064ttk7ewyb2pc01',
        executionConfig: BASE_EXECUTION_CONFIG,
        notes: 'CEO shortlist 2H lane sourced from the BOS+FVG ADX diagnostic backtest.',
    },
    {
        name: 'Telegram TF H4: PD Level Break Canonical v2',
        signalCode: 'SYS_4TF_PD_LEVEL_BREAK_LONG',
        signalVersion: 2,
        symbol: 'XAUUSD',
        timeframe: 'H4',
        sourceBacktestRunId: 'cmn7oj5fa0000tk7dzubw3g48',
        executionConfig: BASE_EXECUTION_CONFIG,
        notes: 'CEO shortlist 4H canonical lane for Telegram signal broadcasting.',
    },
];

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function main() {
    const prisma = new PrismaClient();

    try {
        const now = new Date();
        const results: Array<{ action: 'created' | 'reused'; candidate: CandidateSpec; instanceId: string; timeframe: string; sourceBacktestRunId: string | null }> = [];

        for (const candidate of CANDIDATES) {
            const signalDefinition = await prisma.signalDefinition.findUnique({
                where: {
                    code_version: {
                        code: candidate.signalCode,
                        version: candidate.signalVersion,
                    },
                },
                select: {
                    id: true,
                    name: true,
                },
            });

            if (!signalDefinition) {
                throw new Error(`Signal ${candidate.signalCode} v${candidate.signalVersion} was not found.`);
            }

            let sourceRunParameters: Record<string, unknown> = {};
            if (candidate.sourceBacktestRunId) {
                const sourceRun = await prisma.backtestRun.findUnique({
                    where: { id: candidate.sourceBacktestRunId },
                    select: {
                        id: true,
                        name: true,
                        signalCode: true,
                        signalVersion: true,
                        symbol: true,
                        timeframe: true,
                        parametersJson: true,
                    },
                });

                if (!sourceRun) {
                    throw new Error(
                        `Source backtest run ${candidate.sourceBacktestRunId} was not found for ${candidate.signalCode}@v${candidate.signalVersion}.`,
                    );
                }
                if (
                    sourceRun.signalCode !== candidate.signalCode
                    || sourceRun.signalVersion !== candidate.signalVersion
                ) {
                    throw new Error(
                        `Backtest run ${sourceRun.id} belongs to ${sourceRun.signalCode}@v${sourceRun.signalVersion}, not ${candidate.signalCode}@v${candidate.signalVersion}.`,
                    );
                }
                if (sourceRun.symbol !== candidate.symbol) {
                    throw new Error(
                        `Backtest run ${sourceRun.id} uses symbol ${sourceRun.symbol}, expected ${candidate.symbol}.`,
                    );
                }
                if (!getTimeframeAliases(candidate.timeframe).includes(sourceRun.timeframe)) {
                    throw new Error(
                        `Backtest run ${sourceRun.id} uses timeframe ${sourceRun.timeframe}, expected an alias of ${candidate.timeframe}.`,
                    );
                }

                sourceRunParameters = isRecord(sourceRun.parametersJson)
                    ? sourceRun.parametersJson
                    : {};
            }

            const existing = await prisma.indicatorInstance.findFirst({
                where: {
                    signalCode: candidate.signalCode,
                    signalVersion: candidate.signalVersion,
                    symbol: candidate.symbol,
                    timeframe: { in: getTimeframeAliases(candidate.timeframe) },
                    status: { in: [...ACTIVE_INSTANCE_STATUSES] },
                    tradeBindings: { none: {} },
                },
                orderBy: [
                    { updatedAt: 'desc' },
                    { createdAt: 'desc' },
                ],
                select: {
                    id: true,
                    name: true,
                    timeframe: true,
                    sourceBacktestRunId: true,
                    status: true,
                },
            });

            if (existing) {
                console.log(
                    `[reuse] ${candidate.name} -> ${existing.id} (${existing.status}, timeframe ${existing.timeframe}, source ${existing.sourceBacktestRunId ?? 'none'})`,
                );
                results.push({
                    action: 'reused',
                    candidate,
                    instanceId: existing.id,
                    timeframe: existing.timeframe,
                    sourceBacktestRunId: existing.sourceBacktestRunId ?? null,
                });
                continue;
            }

            const boundExisting = await prisma.indicatorInstance.findFirst({
                where: {
                    signalCode: candidate.signalCode,
                    signalVersion: candidate.signalVersion,
                    symbol: candidate.symbol,
                    timeframe: { in: getTimeframeAliases(candidate.timeframe) },
                    status: { in: [...ACTIVE_INSTANCE_STATUSES] },
                    tradeBindings: { some: {} },
                },
                orderBy: [
                    { updatedAt: 'desc' },
                    { createdAt: 'desc' },
                ],
                select: {
                    id: true,
                    status: true,
                },
            });

            if (boundExisting) {
                console.log(
                    `[skip-bound] ${candidate.name} found bound instance ${boundExisting.id} (${boundExisting.status}); creating a dedicated Telegram-only copy instead.`,
                );
            }

            const instance = await prisma.indicatorInstance.create({
                data: {
                    name: candidate.name,
                    signalCode: candidate.signalCode,
                    signalVersion: candidate.signalVersion,
                    symbol: candidate.symbol,
                    timeframe: candidate.timeframe,
                    parameterJson: {
                        ...sourceRunParameters,
                        _ops: {
                            lane: 'TELEGRAM_SIGNAL_ONLY',
                            autoTrade: false,
                            decisionDate: DECISION_DATE,
                            notes: candidate.notes,
                        },
                    },
                    executionConfigJson: candidate.executionConfig as unknown as Prisma.InputJsonValue,
                    sourceBacktestRunId: candidate.sourceBacktestRunId ?? undefined,
                    status: 'ACTIVE',
                    stateVersion: 1,
                    startedAt: now,
                },
                select: {
                    id: true,
                    timeframe: true,
                    sourceBacktestRunId: true,
                },
            });

            console.log(
                `[create] ${candidate.name} -> ${instance.id} (timeframe ${instance.timeframe}, source ${instance.sourceBacktestRunId ?? 'none'})`,
            );
            results.push({
                action: 'created',
                candidate,
                instanceId: instance.id,
                timeframe: instance.timeframe,
                sourceBacktestRunId: instance.sourceBacktestRunId ?? null,
            });
        }

        const createdCount = results.filter((item) => item.action === 'created').length;
        const reusedCount = results.filter((item) => item.action === 'reused').length;

        console.log('\n-- Signal-only Telegram candidates ready --');
        console.log(`Created: ${createdCount}`);
        console.log(`Reused:  ${reusedCount}`);
        console.log('Bindings: 0 (this script never creates trading automation bindings)');

        for (const result of results) {
            console.log(
                `- ${result.candidate.timeframe.padEnd(3)} | ${result.candidate.signalCode}@v${result.candidate.signalVersion} | ${result.instanceId} | ${result.action}`,
            );
        }
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error('Setup failed:', error instanceof Error ? error.message : error);
    process.exit(1);
});
