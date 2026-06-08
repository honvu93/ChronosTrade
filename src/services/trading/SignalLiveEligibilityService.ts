import { PrismaClient } from '@prisma/client';

export type SignalEligibilityState =
    | 'live-eligible'
    | 'validated'
    | 'blocked'
    | 'draft'
    | 'no-backtest';

export interface SignalBlockingReason {
    code: string;
    label: string;
}

export type SignalConfidenceTier = 'HIGH' | 'VALIDATED' | 'LIMITED';

export interface SignalEligibilityMetrics {
    closedTrades: number;
    openTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    netR: number;
    profitFactor: number;
    maxDrawdownPct: number;
    // Enhancements (2.3)
    avgWinR: number | null;
    avgLossR: number | null;
    estimatedTradesPerDay: number | null;
    confidenceTier: SignalConfidenceTier | null;
}

export interface SignalLiveEligibilityItem {
    signalCode: string;
    signalVersion: number;
    signalName: string;
    backtestRunId: string | null;
    backtestRunName: string | null;
    backtestRunStatus: string | null;
    eligibilityState: SignalEligibilityState;
    blockingReasons: SignalBlockingReason[];
    metrics: SignalEligibilityMetrics | null;
    evaluatedAt: string;
}

const STRONG_SAMPLE_THRESHOLD = 10;
const MIN_VALIDATED_SAMPLE = 5;
const MIN_PROFIT_FACTOR_LIVE = 1.5;
const MIN_PROFIT_FACTOR_VALID = 1.0;
const MAX_DRAWDOWN_LIVE_PCT = -8;
const BLOCKED_DRAWDOWN_PCT = -15;

const round = (value: number, digits = 4) => parseFloat(value.toFixed(digits));

type TradeResultRow = {
    isOpen: boolean;
    win: boolean;
    rMultiple: unknown;
    maxDrawdownPct: unknown;
};

export function computeMetrics(
    results: TradeResultRow[],
    options: { tradingDays?: number } = {},
): SignalEligibilityMetrics {
    const closed = results.filter((result) => !result.isOpen);
    const open = results.filter((result) => result.isOpen);
    const wins = closed.filter((result) => result.win);
    const losses = closed.filter((result) => !result.win);

    const netR = round(closed.reduce((sum, result) => sum + Number(result.rMultiple), 0));
    const winNetR = wins.reduce((sum, result) => sum + Math.max(0, Number(result.rMultiple)), 0);
    const lossNetR = losses.reduce((sum, result) => sum + Math.abs(Number(result.rMultiple)), 0);
    const profitFactor = lossNetR === 0
        ? (winNetR > 0 ? 99 : 0)
        : round(winNetR / lossNetR);

    const maxDrawdownPct = results.length > 0
        ? round(Math.min(...results.map((result) => Number(result.maxDrawdownPct))))
        : 0;

    const winRate = closed.length > 0 ? round(wins.length / closed.length) : 0;

    const avgWinR = wins.length > 0
        ? round(winNetR / wins.length, 2)
        : null;
    const avgLossR = losses.length > 0
        ? round(lossNetR / losses.length, 2)
        : null;

    const estimatedTradesPerDay = options.tradingDays && options.tradingDays > 0 && closed.length > 0
        ? round(closed.length / options.tradingDays, 3)
        : null;

    const confidenceTier: SignalConfidenceTier | null = closed.length === 0
        ? null
        : closed.length >= 50
            ? 'HIGH'
            : closed.length >= 10
                ? 'VALIDATED'
                : 'LIMITED';

    return {
        closedTrades: closed.length,
        openTrades: open.length,
        wins: wins.length,
        losses: losses.length,
        winRate,
        netR,
        profitFactor,
        maxDrawdownPct,
        avgWinR,
        avgLossR,
        estimatedTradesPerDay,
        confidenceTier,
    };
}

export function evaluateEligibility(
    metrics: SignalEligibilityMetrics,
    runStatus: string,
): { state: SignalEligibilityState; blockingReasons: SignalBlockingReason[] } {
    const blockingReasons: SignalBlockingReason[] = [];

    if (metrics.netR <= 0) {
        blockingReasons.push({
            code: 'net_negative',
            label: 'Net return is negative or zero - this setup is losing money across the backtest window.',
        });
    }
    if (metrics.profitFactor < MIN_PROFIT_FACTOR_VALID) {
        blockingReasons.push({
            code: 'profit_factor_too_low',
            label: `Profit factor is ${metrics.profitFactor.toFixed(2)}, below the minimum 1.0 required for any positive signal evidence.`,
        });
    }
    if (metrics.maxDrawdownPct <= BLOCKED_DRAWDOWN_PCT) {
        blockingReasons.push({
            code: 'excessive_drawdown',
            label: `Maximum drawdown is ${metrics.maxDrawdownPct.toFixed(1)}%, exceeding the ${BLOCKED_DRAWDOWN_PCT}% hard stop.`,
        });
    }

    if (blockingReasons.length > 0) {
        return { state: 'blocked', blockingReasons };
    }

    if (runStatus !== 'COMPLETED') {
        return {
            state: 'draft',
            blockingReasons: [{
                code: 'backtest_incomplete',
                label: 'The most recent backtest run has not completed yet.',
            }],
        };
    }

    if (metrics.closedTrades < MIN_VALIDATED_SAMPLE) {
        return {
            state: 'draft',
            blockingReasons: [{
                code: 'insufficient_trades',
                label: `Only ${metrics.closedTrades} closed trade${metrics.closedTrades === 1 ? '' : 's'} - at least ${MIN_VALIDATED_SAMPLE} are needed for validation.`,
            }],
        };
    }

    const isLiveEligible = (
        metrics.closedTrades >= STRONG_SAMPLE_THRESHOLD
        && metrics.openTrades === 0
        && metrics.netR > 0
        && metrics.profitFactor >= MIN_PROFIT_FACTOR_LIVE
        && metrics.maxDrawdownPct > MAX_DRAWDOWN_LIVE_PCT
    );

    if (isLiveEligible) {
        return { state: 'live-eligible', blockingReasons: [] };
    }

    // Validated but not yet live-eligible - surface sub-threshold gaps
    const subThreshold: SignalBlockingReason[] = [];

    if (metrics.closedTrades < STRONG_SAMPLE_THRESHOLD) {
        subThreshold.push({
            code: 'sample_below_live_threshold',
            label: `${metrics.closedTrades} closed trades - ${STRONG_SAMPLE_THRESHOLD} required for live eligibility.`,
        });
    }
    if (metrics.openTrades > 0) {
        subThreshold.push({
            code: 'open_positions',
            label: `${metrics.openTrades} trade${metrics.openTrades === 1 ? '' : 's'} still open - all positions must close before live eligibility.`,
        });
    }
    if (metrics.profitFactor < MIN_PROFIT_FACTOR_LIVE) {
        subThreshold.push({
            code: 'profit_factor_below_live',
            label: `Profit factor ${metrics.profitFactor.toFixed(2)} is below the 1.5 required for live eligibility.`,
        });
    }
    if (metrics.maxDrawdownPct <= MAX_DRAWDOWN_LIVE_PCT) {
        subThreshold.push({
            code: 'drawdown_below_live',
            label: `Max drawdown of ${metrics.maxDrawdownPct.toFixed(1)}% exceeds the ${MAX_DRAWDOWN_LIVE_PCT}% threshold for live eligibility.`,
        });
    }

    return { state: 'validated', blockingReasons: subThreshold };
}

export class SignalLiveEligibilityService {
    constructor(private prisma: PrismaClient) {}

    public async listEligibility(): Promise<SignalLiveEligibilityItem[]> {
        const definitions = await this.prisma.signalDefinition.findMany({
            where: { isActive: true },
            orderBy: [{ code: 'asc' }, { version: 'desc' }],
        });

        if (definitions.length === 0) return [];

        const defKeys = definitions.map((definition) => ({
            code: definition.code,
            version: definition.version,
        }));
        const allRuns = await this.prisma.backtestRun.findMany({
            where: {
                OR: defKeys.map((key) => ({
                    signalCode: key.code,
                    signalVersion: key.version,
                })),
            },
            orderBy: { createdAt: 'desc' },
        });

        type RunRecord = (typeof allRuns)[number];
        const runsByKey = new Map<string, { completed: RunRecord | null; latest: RunRecord | null }>();
        for (const run of allRuns) {
            const key = `${run.signalCode}::${run.signalVersion}`;
            let entry = runsByKey.get(key);
            if (!entry) {
                entry = { completed: null, latest: null };
                runsByKey.set(key, entry);
            }

            if (!entry.latest) entry.latest = run;
            if (!entry.completed && run.status === 'COMPLETED') entry.completed = run;
        }

        const completedRunIds: string[] = [];
        for (const entry of runsByKey.values()) {
            if (entry.completed) completedRunIds.push(entry.completed.id);
        }

        const allResults = completedRunIds.length > 0
            ? await this.prisma.backtestTradeResult.findMany({
                where: { backtestRunId: { in: completedRunIds } },
                select: {
                    backtestRunId: true,
                    isOpen: true,
                    win: true,
                    rMultiple: true,
                    maxDrawdownPct: true,
                },
            })
            : [];

        const resultsByRunId = new Map<string, typeof allResults>();
        for (const result of allResults) {
            let rows = resultsByRunId.get(result.backtestRunId);
            if (!rows) {
                rows = [];
                resultsByRunId.set(result.backtestRunId, rows);
            }
            rows.push(result);
        }

        const evaluatedAt = new Date().toISOString();

        return definitions.map((definition): SignalLiveEligibilityItem => {
            const key = `${definition.code}::${definition.version}`;
            const entry = runsByKey.get(key);
            const completedRun = entry?.completed ?? null;
            const latestRun = entry?.latest ?? null;

            if (!completedRun) {
                if (latestRun) {
                    return {
                        signalCode: definition.code,
                        signalVersion: definition.version,
                        signalName: definition.name,
                        backtestRunId: latestRun.id,
                        backtestRunName: latestRun.name,
                        backtestRunStatus: latestRun.status,
                        eligibilityState: 'draft',
                        blockingReasons: [{
                            code: 'backtest_incomplete',
                            label: 'The most recent backtest run has not completed yet.',
                        }],
                        metrics: null,
                        evaluatedAt,
                    };
                }

                return {
                    signalCode: definition.code,
                    signalVersion: definition.version,
                    signalName: definition.name,
                    backtestRunId: null,
                    backtestRunName: null,
                    backtestRunStatus: null,
                    eligibilityState: 'no-backtest',
                    blockingReasons: [{
                        code: 'no_backtest',
                        label: 'No backtest has been run for this signal definition yet.',
                    }],
                    metrics: null,
                    evaluatedAt,
                };
            }

            const results = resultsByRunId.get(completedRun.id) ?? [];

            if (results.length === 0) {
                return {
                    signalCode: definition.code,
                    signalVersion: definition.version,
                    signalName: definition.name,
                    backtestRunId: completedRun.id,
                    backtestRunName: completedRun.name,
                    backtestRunStatus: completedRun.status,
                    eligibilityState: 'draft',
                    blockingReasons: [{
                        code: 'no_results',
                        label: 'The completed backtest produced no trade results - the signal may not have triggered in the backtest window.',
                    }],
                    metrics: null,
                    evaluatedAt,
                };
            }

            const tradingDays = completedRun.finishedAt
                ? Math.max(1, (completedRun.finishedAt.getTime() - completedRun.startedAt.getTime()) / (1000 * 60 * 60 * 24))
                : null;
            const metrics = computeMetrics(results, tradingDays ? { tradingDays } : {});
            const { state, blockingReasons } = evaluateEligibility(metrics, completedRun.status);

            return {
                signalCode: definition.code,
                signalVersion: definition.version,
                signalName: definition.name,
                backtestRunId: completedRun.id,
                backtestRunName: completedRun.name,
                backtestRunStatus: completedRun.status,
                eligibilityState: state,
                blockingReasons,
                metrics,
                evaluatedAt,
            };
        });
    }

    public async getEligibilityForSignal(
        signalCode: string,
        signalVersion: number,
    ): Promise<SignalLiveEligibilityItem | null> {
        const definition = await this.prisma.signalDefinition.findUnique({
            where: {
                code_version: {
                    code: signalCode,
                    version: signalVersion,
                },
            },
        });
        if (!definition || !definition.isActive) {
            return null;
        }

        const completedRun = await this.prisma.backtestRun.findFirst({
            where: {
                signalCode,
                signalVersion,
                status: 'COMPLETED',
            },
            orderBy: { createdAt: 'desc' },
        });
        const latestRun = completedRun ?? await this.prisma.backtestRun.findFirst({
            where: {
                signalCode,
                signalVersion,
            },
            orderBy: { createdAt: 'desc' },
        });
        const evaluatedAt = new Date().toISOString();

        if (!completedRun) {
            if (latestRun) {
                return {
                    signalCode: definition.code,
                    signalVersion: definition.version,
                    signalName: definition.name,
                    backtestRunId: latestRun.id,
                    backtestRunName: latestRun.name,
                    backtestRunStatus: latestRun.status,
                    eligibilityState: 'draft',
                    blockingReasons: [{
                        code: 'backtest_incomplete',
                        label: 'The most recent backtest run has not completed yet.',
                    }],
                    metrics: null,
                    evaluatedAt,
                };
            }

            return {
                signalCode: definition.code,
                signalVersion: definition.version,
                signalName: definition.name,
                backtestRunId: null,
                backtestRunName: null,
                backtestRunStatus: null,
                eligibilityState: 'no-backtest',
                blockingReasons: [{
                    code: 'no_backtest',
                    label: 'No backtest has been run for this signal definition yet.',
                }],
                metrics: null,
                evaluatedAt,
            };
        }

        const results = await this.prisma.backtestTradeResult.findMany({
            where: { backtestRunId: completedRun.id },
            select: {
                isOpen: true,
                win: true,
                rMultiple: true,
                maxDrawdownPct: true,
            },
        });

        if (results.length === 0) {
            return {
                signalCode: definition.code,
                signalVersion: definition.version,
                signalName: definition.name,
                backtestRunId: completedRun.id,
                backtestRunName: completedRun.name,
                backtestRunStatus: completedRun.status,
                eligibilityState: 'draft',
                blockingReasons: [{
                    code: 'no_results',
                    label: 'The completed backtest produced no trade results - the signal may not have triggered in the backtest window.',
                }],
                metrics: null,
                evaluatedAt,
            };
        }

        const metrics = computeMetrics(results);
        const { state, blockingReasons } = evaluateEligibility(metrics, completedRun.status);
        return {
            signalCode: definition.code,
            signalVersion: definition.version,
            signalName: definition.name,
            backtestRunId: completedRun.id,
            backtestRunName: completedRun.name,
            backtestRunStatus: completedRun.status,
            eligibilityState: state,
            blockingReasons,
            metrics,
            evaluatedAt,
        };
    }
}
