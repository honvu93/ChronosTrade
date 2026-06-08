import { PrismaClient } from '@prisma/client';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CorrelationTrade {
    entryTime: Date;
    exitTime: Date;
    rMultiple: number;
    session: string;
}

export interface RunTrades {
    runId: string;
    signalCode: string | null;
    trades: CorrelationTrade[];
}

export interface PairwiseCorrelation {
    runIdA: string;
    runIdB: string;
    tradeOverlapPct: number;
    equityCurveCorrelation: number;
    concurrentDrawdownPct: number;
    avgCorrelation: number;
}

export interface CorrelationCluster {
    id: number;
    runIds: string[];
    representative: { runId: string; signalCode: string | null; profitFactor: number };
}

export interface CorrelationReport {
    symbol: string;
    timeframe: string;
    runCount: number;
    matrix: PairwiseCorrelation[];
    clusters: CorrelationCluster[];
    diversityScore: number;
}

// ─── Service ─────────────────────────────────────────────────────────────────

const toNumber = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

export class CorrelationService {
    constructor(private readonly prisma: PrismaClient) {}

    /**
     * Load closed trades for all backtest runs matching symbol + timeframe.
     */
    async loadRunTrades(symbol: string, timeframe: string): Promise<RunTrades[]> {
        const runs = await this.prisma.backtestRun.findMany({
            where: { symbol, timeframe, status: 'COMPLETED' },
            select: { id: true, signalCode: true },
            orderBy: { createdAt: 'desc' },
        });

        const result: RunTrades[] = [];

        for (const run of runs) {
            const dbResults = await this.prisma.backtestTradeResult.findMany({
                where: { backtestRunId: run.id, isOpen: false },
                select: {
                    rMultiple: true,
                    exitTime: true,
                    session: true,
                    signal: { select: { entryTime: true } },
                },
                orderBy: { signal: { entryTime: 'asc' } },
            });

            const trades: CorrelationTrade[] = dbResults
                .filter((r) => r.exitTime !== null)
                .map((r) => ({
                    entryTime: r.signal.entryTime,
                    exitTime: r.exitTime!,
                    rMultiple: toNumber(r.rMultiple),
                    session: r.session,
                }));

            if (trades.length >= 10) {
                result.push({ runId: run.id, signalCode: run.signalCode, trades });
            }
        }

        return result;
    }

    /**
     * Compute full NxN correlation matrix + clustering.
     */
    computeCorrelationReport(
        runTradesArray: RunTrades[],
        symbol: string,
        timeframe: string,
        clusterThreshold = 0.7,
    ): CorrelationReport {
        const matrix: PairwiseCorrelation[] = [];

        for (let i = 0; i < runTradesArray.length; i++) {
            for (let j = i + 1; j < runTradesArray.length; j++) {
                const pair = this.computePairwise(runTradesArray[i], runTradesArray[j]);
                matrix.push(pair);
            }
        }

        const clusters = this.clusterRuns(runTradesArray, matrix, clusterThreshold);
        const diversityScore = this.computeDiversityScore(matrix);

        return {
            symbol,
            timeframe,
            runCount: runTradesArray.length,
            matrix,
            clusters,
            diversityScore,
        };
    }

    // ─── Pairwise Computation ────────────────────────────────────────────────

    private computePairwise(a: RunTrades, b: RunTrades): PairwiseCorrelation {
        const tradeOverlapPct = this.computeTradeOverlap(a.trades, b.trades);
        const equityCurveCorrelation = this.computeEquityCurveCorrelation(a.trades, b.trades);
        const concurrentDrawdownPct = this.computeConcurrentDrawdown(a.trades, b.trades);

        const avgCorrelation = (tradeOverlapPct + equityCurveCorrelation + concurrentDrawdownPct) / 3;

        return {
            runIdA: a.runId,
            runIdB: b.runId,
            tradeOverlapPct,
            equityCurveCorrelation,
            concurrentDrawdownPct,
            avgCorrelation,
        };
    }

    /**
     * Metric 1: Trade Overlap %
     * % of trades in A that have a matching trade in B within ±10 minutes.
     */
    private computeTradeOverlap(tradesA: CorrelationTrade[], tradesB: CorrelationTrade[]): number {
        if (tradesA.length === 0 || tradesB.length === 0) return 0;

        const TOLERANCE_MS = 10 * 60 * 1000; // ±10 minutes
        const bTimes = tradesB.map((t) => t.entryTime.getTime());

        let matchCount = 0;
        for (const trade of tradesA) {
            const aTime = trade.entryTime.getTime();
            const found = bTimes.some((bTime) => Math.abs(aTime - bTime) <= TOLERANCE_MS);
            if (found) matchCount++;
        }

        // Symmetric: average of both directions
        let matchCountReverse = 0;
        const aTimes = tradesA.map((t) => t.entryTime.getTime());
        for (const trade of tradesB) {
            const bTime = trade.entryTime.getTime();
            const found = aTimes.some((aTime) => Math.abs(bTime - aTime) <= TOLERANCE_MS);
            if (found) matchCountReverse++;
        }

        const overlapA = matchCount / tradesA.length;
        const overlapB = matchCountReverse / tradesB.length;
        return (overlapA + overlapB) / 2;
    }

    /**
     * Metric 2: Equity Curve Correlation
     * Pearson correlation between daily R returns (not cumulative levels).
     */
    private computeEquityCurveCorrelation(
        tradesA: CorrelationTrade[],
        tradesB: CorrelationTrade[],
    ): number {
        const dailyA = this.buildDailyReturns(tradesA);
        const dailyB = this.buildDailyReturns(tradesB);

        // Union of all days
        const allDays = new Set([...dailyA.keys(), ...dailyB.keys()]);
        if (allDays.size < 5) return 0;

        const xVals: number[] = [];
        const yVals: number[] = [];
        for (const day of allDays) {
            xVals.push(dailyA.get(day) ?? 0);
            yVals.push(dailyB.get(day) ?? 0);
        }

        return pearsonCorrelation(xVals, yVals);
    }

    /**
     * Build map of day → total R return for that day.
     */
    private buildDailyReturns(trades: CorrelationTrade[]): Map<string, number> {
        const daily = new Map<string, number>();
        for (const t of trades) {
            const day = t.exitTime.toISOString().slice(0, 10);
            daily.set(day, (daily.get(day) ?? 0) + t.rMultiple);
        }
        return daily;
    }

    /**
     * Metric 3: Concurrent Drawdown %
     * Measures how much drawdown periods overlap between two strategies.
     */
    private computeConcurrentDrawdown(
        tradesA: CorrelationTrade[],
        tradesB: CorrelationTrade[],
    ): number {
        const ddPeriodsA = this.findDrawdownPeriods(tradesA);
        const ddPeriodsB = this.findDrawdownPeriods(tradesB);

        if (ddPeriodsA.length === 0 && ddPeriodsB.length === 0) return 0;
        if (ddPeriodsA.length === 0 || ddPeriodsB.length === 0) return 0;

        let overlapping = 0;
        for (const periodA of ddPeriodsA) {
            for (const periodB of ddPeriodsB) {
                if (this.periodsOverlap50(periodA, periodB)) {
                    overlapping++;
                    break; // count each period max once
                }
            }
        }
        for (const periodB of ddPeriodsB) {
            for (const periodA of ddPeriodsA) {
                if (this.periodsOverlap50(periodB, periodA)) {
                    overlapping++;
                    break;
                }
            }
        }

        const totalPeriods = ddPeriodsA.length + ddPeriodsB.length;
        return totalPeriods > 0 ? overlapping / totalPeriods : 0;
    }

    /**
     * Find contiguous drawdown periods (days where cumR is declining from local peak).
     */
    private findDrawdownPeriods(trades: CorrelationTrade[]): Array<{ from: string; to: string }> {
        const daily = this.buildDailyReturns(trades);
        const sortedDays = [...daily.keys()].sort();
        if (sortedDays.length === 0) return [];

        const periods: Array<{ from: string; to: string }> = [];
        let cumR = 0;
        let peak = 0;
        let ddStart: string | null = null;

        for (const day of sortedDays) {
            cumR += daily.get(day) ?? 0;
            if (cumR > peak) {
                // New peak — close any active drawdown period
                if (ddStart !== null) {
                    periods.push({ from: ddStart, to: day });
                    ddStart = null;
                }
                peak = cumR;
            } else if (cumR < peak) {
                // In drawdown
                if (ddStart === null) ddStart = day;
            }
        }
        // Close trailing drawdown
        if (ddStart !== null) {
            periods.push({ from: ddStart, to: sortedDays[sortedDays.length - 1] });
        }

        return periods;
    }

    /**
     * Check if two periods overlap by ≥50% of the shorter period's duration.
     */
    private periodsOverlap50(
        a: { from: string; to: string },
        b: { from: string; to: string },
    ): boolean {
        const aFrom = new Date(a.from).getTime();
        const aTo = new Date(a.to).getTime();
        const bFrom = new Date(b.from).getTime();
        const bTo = new Date(b.to).getTime();

        const overlapStart = Math.max(aFrom, bFrom);
        const overlapEnd = Math.min(aTo, bTo);
        const overlap = Math.max(0, overlapEnd - overlapStart);

        const shorterDuration = Math.min(aTo - aFrom, bTo - bFrom);
        if (shorterDuration <= 0) return false;

        return overlap / shorterDuration >= 0.5;
    }

    // ─── Clustering ──────────────────────────────────────────────────────────

    /**
     * Union-Find clustering: group runs with avgCorrelation > threshold.
     */
    private clusterRuns(
        runTradesArray: RunTrades[],
        matrix: PairwiseCorrelation[],
        threshold: number,
    ): CorrelationCluster[] {
        const n = runTradesArray.length;
        const parent = Array.from({ length: n }, (_, i) => i);

        const find = (x: number): number => {
            while (parent[x] !== x) {
                parent[x] = parent[parent[x]];
                x = parent[x];
            }
            return x;
        };
        const union = (a: number, b: number) => {
            parent[find(a)] = find(b);
        };

        const idxMap = new Map(runTradesArray.map((r, i) => [r.runId, i]));

        for (const pair of matrix) {
            if (pair.avgCorrelation >= threshold) {
                const iA = idxMap.get(pair.runIdA)!;
                const iB = idxMap.get(pair.runIdB)!;
                union(iA, iB);
            }
        }

        // Group by root
        const groups = new Map<number, number[]>();
        for (let i = 0; i < n; i++) {
            const root = find(i);
            const list = groups.get(root) ?? [];
            list.push(i);
            groups.set(root, list);
        }

        const clusters: CorrelationCluster[] = [];
        let clusterId = 0;

        for (const members of groups.values()) {
            const runIds = members.map((i) => runTradesArray[i].runId);

            // Representative: highest PF
            let bestIdx = members[0];
            let bestPF = 0;
            for (const idx of members) {
                const pf = this.computeProfitFactor(runTradesArray[idx].trades);
                if (pf > bestPF) {
                    bestPF = pf;
                    bestIdx = idx;
                }
            }

            clusters.push({
                id: clusterId++,
                runIds,
                representative: {
                    runId: runTradesArray[bestIdx].runId,
                    signalCode: runTradesArray[bestIdx].signalCode,
                    profitFactor: bestPF,
                },
            });
        }

        return clusters.sort((a, b) => b.representative.profitFactor - a.representative.profitFactor);
    }

    private computeProfitFactor(trades: CorrelationTrade[]): number {
        let grossWin = 0;
        let grossLoss = 0;
        for (const t of trades) {
            if (t.rMultiple > 0) grossWin += t.rMultiple;
            else if (t.rMultiple < 0) grossLoss += Math.abs(t.rMultiple);
        }
        return grossLoss === 0 ? (grossWin > 0 ? 999 : 0) : grossWin / grossLoss;
    }

    private computeDiversityScore(matrix: PairwiseCorrelation[]): number {
        if (matrix.length === 0) return 1;
        const avg = matrix.reduce((sum, p) => sum + p.avgCorrelation, 0) / matrix.length;
        return Number((1 - avg).toFixed(3));
    }
}

// ─── Math Helpers ────────────────────────────────────────────────────────────

function pearsonCorrelation(x: number[], y: number[]): number {
    const n = x.length;
    if (n < 3) return 0;

    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
    for (let i = 0; i < n; i++) {
        sumX += x[i];
        sumY += y[i];
        sumXY += x[i] * y[i];
        sumX2 += x[i] * x[i];
        sumY2 += y[i] * y[i];
    }

    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

    if (denominator === 0) return 0;
    return Math.max(-1, Math.min(1, numerator / denominator));
}
