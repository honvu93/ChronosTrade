import {
    BacktestRun,
    BacktestRunStatus,
    ExitRule,
    PositionSide,
    Prisma,
    PrismaClient,
    Signal,
    SignalSourceType,
    Strategy,
    TradingSession,
} from '@prisma/client';
import { normalizeSymbol } from '../utils/symbols';

type ResultRecord = Prisma.BacktestTradeResultGetPayload<{
    include: {
        signal: {
            include: {
                strategy: true,
            },
        },
        exitRule: true,
        backtestRun: {
            include: {
                strategy: true,
            },
        },
    },
}>;

type SignalRecord = Prisma.SignalGetPayload<{
    include: {
        strategy: true,
        results: {
            include: {
                exitRule: true,
                backtestRun: {
                    include: {
                        strategy: true,
                    },
                },
            },
        },
    },
}>;

type BacktestLeaderboardRunRecord = Prisma.BacktestRunGetPayload<{
    select: {
        id: true,
        name: true,
        signalCode: true,
        signalVersion: true,
        symbol: true,
        timeframe: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        createdAt: true,
        notes: true,
        _count: {
            select: {
                signals: true,
            },
        },
    },
}>;

type BacktestLeaderboardResultAggregate = {
    backtestRunId: string;
    win: boolean;
    isOpen: boolean;
    _count: {
        _all: number;
    };
    _sum: {
        rMultiple: Prisma.Decimal | null;
        pnlUsd: Prisma.Decimal | null;
    };
    _min: {
        maxDrawdownPct: Prisma.Decimal | null;
    };
};

export interface EngineFilters {
    backtestRunId?: string;
    backtestRunIds?: string[];
    signalId?: string;
    symbol?: string;
    timeframe?: string;
    strategyId?: string;
    side?: PositionSide | 'ALL';
    session?: TradingSession;
    exitRuleId?: string;
    from?: Date;
    to?: Date;
}

export type TradeHistoryStatus = 'ALL' | 'ACTIVE' | 'CLOSED';
export type TradeHistoryOutcome = 'ALL' | 'WIN' | 'LOSS' | 'BE';
export type TradeHistorySortField = 'entryTime' | 'exitTime' | 'pnlUsd' | 'rMultiple' | 'durationMs';
export type TradeHistorySortOrder = 'asc' | 'desc';

export interface TradeHistoryOptions {
    status?: TradeHistoryStatus;
    outcome?: TradeHistoryOutcome;
    page?: number;
    pageSize?: number;
    sort?: TradeHistorySortField;
    order?: TradeHistorySortOrder;
}

export type BacktestLeaderboardMode = 'ALL_RUNS' | 'BEST_PER_SIGNAL';
export type BacktestLeaderboardSortField =
    | 'rank'
    | 'createdAt'
    | 'closedTrades'
    | 'winRate'
    | 'netR'
    | 'profitFactor'
    | 'expectancy'
    | 'maxDrawdownPct';
export type BacktestLeaderboardSortOrder = 'asc' | 'desc';
export type BacktestLeaderboardCautionState = 'constructive' | 'weaker' | 'suspicious';

export interface BacktestLeaderboardFilters {
    signalCode?: string;
    symbol?: string;
    timeframe?: string;
    status?: BacktestRunStatus | 'ALL';
    from?: Date;
    to?: Date;
    minClosedTrades?: number;
}

export interface BacktestLeaderboardOptions {
    mode?: BacktestLeaderboardMode;
    page?: number;
    pageSize?: number;
    sort?: BacktestLeaderboardSortField;
    order?: BacktestLeaderboardSortOrder;
}

export interface BacktestLeaderboardRow {
    rank: number;
    runId: string;
    runName: string;
    signalCode: string | null;
    signalVersion: number | null;
    signalKey: string;
    signalLabel: string;
    symbol: string;
    timeframe: string;
    status: BacktestRunStatus;
    startedAt: Date;
    finishedAt: Date | null;
    createdAt: Date;
    signalCount: number;
    totalTrades: number;
    closedTrades: number;
    openTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    profitFactor: number;
    expectancy: number;
    netR: number;
    netUsd: number;
    maxDrawdownPct: number;
    cautionState: BacktestLeaderboardCautionState;
    cautionFlags: string[];
}

export interface BacktestLeaderboardSummary {
    totalRows: number;
    totalSignals: number;
    constructiveRows: number;
    weakerRows: number;
    suspiciousRows: number;
}

export interface BacktestLeaderboardResponse {
    rows: BacktestLeaderboardRow[];
    pagination: {
        page: number;
        pageSize: number;
        totalRows: number;
        totalPages: number;
    };
    summary: BacktestLeaderboardSummary;
    mode: BacktestLeaderboardMode;
    sort: BacktestLeaderboardSortField;
    order: BacktestLeaderboardSortOrder;
}

interface BacktestLeaderboardAggregateStats {
    totalTrades: number;
    closedTrades: number;
    openTrades: number;
    wins: number;
    losses: number;
    netR: number;
    netUsd: number;
    grossProfit: number;
    grossLoss: number;
    maxDrawdownPct: number;
}

const BREAK_EVEN_EPSILON = 0.0001;
const DEFAULT_BACKTEST_LEADERBOARD_PAGE_SIZE = 20;

const toNumber = (value: Prisma.Decimal | number | string | null | undefined): number => {
    if (value === null || value === undefined) return 0;
    return Number(value);
};

const round = (value: number, digits = 2): number => Number(value.toFixed(digits));

const average = (values: number[]): number => {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const clampPageSize = (value: number | undefined, fallback = DEFAULT_BACKTEST_LEADERBOARD_PAGE_SIZE) => {
    if (!value || !Number.isFinite(value)) return fallback;
    return Math.min(Math.max(Math.trunc(value), 1), 100);
};

const getBacktestLeaderboardStatusWeight = (status: BacktestRunStatus) => {
    switch (status) {
        case BacktestRunStatus.COMPLETED:
            return 0;
        case BacktestRunStatus.RUNNING:
            return 1;
        case BacktestRunStatus.PENDING:
            return 2;
        case BacktestRunStatus.CANCELED:
            return 3;
        case BacktestRunStatus.FAILED:
        default:
            return 4;
    }
};

const getBacktestLeaderboardCautionWeight = (state: BacktestLeaderboardCautionState) => {
    switch (state) {
        case 'constructive':
            return 0;
        case 'weaker':
            return 1;
        case 'suspicious':
        default:
            return 2;
    }
};

const compareDatesDesc = (left: Date, right: Date) => right.getTime() - left.getTime();

const resolveLeaderboardCaution = (row: Omit<BacktestLeaderboardRow, 'rank' | 'cautionState' | 'cautionFlags'>) => {
    const flags: string[] = [];

    if (row.status !== BacktestRunStatus.COMPLETED) {
        flags.push(`Run status is ${row.status.toLowerCase()}.`);
    }
    if (row.closedTrades < 5) {
        flags.push(`Only ${row.closedTrades} closed trades were recorded.`);
    }
    if (row.openTrades > 0) {
        flags.push(`${row.openTrades} trade${row.openTrades === 1 ? '' : 's'} remained open.`);
    }
    if (row.netR < 0) {
        flags.push(`Net R is ${row.netR.toFixed(2)}R.`);
    }
    if (row.profitFactor > 0 && row.profitFactor < 1) {
        flags.push(`Profit factor is ${row.profitFactor.toFixed(2)}.`);
    }
    if (row.maxDrawdownPct <= -15) {
        flags.push(`Max drawdown reached ${row.maxDrawdownPct.toFixed(2)}%.`);
    }

    if (
        row.status !== BacktestRunStatus.COMPLETED
        || row.netR < 0
        || row.profitFactor < 1
        || row.maxDrawdownPct <= -15
    ) {
        return {
            cautionState: 'suspicious' as const,
            cautionFlags: flags,
        };
    }

    if (row.closedTrades < 5 || row.profitFactor < 1.2 || row.openTrades > 0) {
        return {
            cautionState: 'weaker' as const,
            cautionFlags: flags,
        };
    }

    return {
        cautionState: 'constructive' as const,
        cautionFlags: flags,
    };
};

const compareBacktestLeaderboardRank = (left: BacktestLeaderboardRow, right: BacktestLeaderboardRow) => {
    const statusWeightDiff = getBacktestLeaderboardStatusWeight(left.status) - getBacktestLeaderboardStatusWeight(right.status);
    if (statusWeightDiff !== 0) {
        return statusWeightDiff;
    }

    const cautionWeightDiff = getBacktestLeaderboardCautionWeight(left.cautionState) - getBacktestLeaderboardCautionWeight(right.cautionState);
    if (cautionWeightDiff !== 0) {
        return cautionWeightDiff;
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

    return compareDatesDesc(left.createdAt, right.createdAt);
};

const sortResults = (results: ResultRecord[]): ResultRecord[] => {
    return [...results].sort((a, b) => {
        const aTime = new Date(a.exitTime || a.signal.entryTime).getTime();
        const bTime = new Date(b.exitTime || b.signal.entryTime).getTime();
        return aTime - bTime;
    });
};

export class EngineAnalyticsService {
    constructor(private prisma: PrismaClient) { }

    public async listStrategies() {
        const strategies = await this.prisma.strategy.findMany({
            where: { isActive: true },
            orderBy: { name: 'asc' },
        });

        return strategies.map((strategy) => ({
            id: strategy.id,
            code: strategy.code,
            name: strategy.name,
            description: strategy.description,
            isActive: strategy.isActive,
        }));
    }

    public async listExitRules() {
        const exitRules = await this.prisma.exitRule.findMany({
            where: { isActive: true },
            orderBy: { name: 'asc' },
        });

        return exitRules.map((rule) => ({
            id: rule.id,
            code: rule.code,
            name: rule.name,
            description: rule.description,
            isActive: rule.isActive,
        }));
    }

    public async listRuns(options: { includeId?: string } = {}) {
        const includeId = options.includeId?.trim();
        const runs = await this.prisma.backtestRun.findMany({
            include: {
                strategy: true,
            },
            orderBy: { createdAt: 'desc' },
            take: 50,
        });

        const requestedRun = includeId && !runs.some((run) => run.id === includeId)
            ? await this.prisma.backtestRun.findUnique({
                where: { id: includeId },
                include: {
                    strategy: true,
                },
            })
            : null;

        const catalog = requestedRun
            ? [...runs, requestedRun].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
            : runs;

        return catalog.map((run) => ({
            id: run.id,
            name: run.name,
            symbol: run.symbol,
            timeframe: run.timeframe,
            side: run.side,
            strategyId: run.strategyId,
            strategyName: run.strategy?.name ?? null,
            strategyCode: run.strategy?.code ?? null,
            initialEquity: round(toNumber(run.initialEquity), 2),
            riskPercent: round(toNumber(run.riskPercent), 4),
            startedAt: run.startedAt,
            finishedAt: run.finishedAt,
            createdAt: run.createdAt,
        }));
    }

    public async getOverview(filters: EngineFilters) {
        const results = await this.loadResults(filters);
        const contextRun = await this.resolveContextRun(filters.backtestRunId, results);
        const ordered = sortResults(results);
        const closedTrades = ordered.filter((result) => !result.isOpen);
        const openTrades = ordered.filter((result) => result.isOpen);
        const wins = closedTrades.filter((result) => result.win);
        const losses = closedTrades.filter((result) => !result.win);

        const netR = closedTrades.reduce((sum, result) => sum + toNumber(result.rMultiple), 0);
        const netUsd = closedTrades.reduce((sum, result) => sum + toNumber(result.pnlUsd), 0);
        const grossProfit = wins.reduce((sum, result) => sum + Math.max(toNumber(result.rMultiple), 0), 0);
        const grossLoss = losses.reduce((sum, result) => sum + Math.abs(Math.min(toNumber(result.rMultiple), 0)), 0);
        const winRate = closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0;
        const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? grossProfit : 0;
        const expectancy = closedTrades.length > 0 ? netR / closedTrades.length : 0;
        const signalCount = new Set(ordered.map((result) => result.signalId)).size;
        const maxConsecutiveLoss = this.getMaxConsecutiveLoss(closedTrades);
        const maxDrawdownPct = closedTrades.reduce((worst, result) => Math.min(worst, toNumber(result.maxDrawdownPct)), 0);

        return {
            context: contextRun ? this.serializeRun(contextRun) : null,
            metrics: {
                signalCount,
                totalTrades: ordered.length,
                closedTrades: closedTrades.length,
                openTrades: openTrades.length,
                wins: wins.length,
                losses: losses.length,
                winRate: round(winRate, 2),
                profitFactor: round(profitFactor, 2),
                expectancy: round(expectancy, 3),
                netR: round(netR, 2),
                netUsd: round(netUsd, 2),
                maxConsecutiveLoss,
                maxDrawdownPct: round(maxDrawdownPct, 2),
            },
        };
    }

    public async getPublicAnalytics(filters: EngineFilters) {
        const results = await this.loadResults(filters);
        const ordered = sortResults(results);
        const closed = ordered.filter((r) => !r.isOpen);

        // --- Yearly R ---
        const yearMap = new Map<number, { netR: number; trades: number }>();
        for (const r of closed) {
            const year = new Date(r.signal.entryTime).getFullYear();
            const entry = yearMap.get(year) ?? { netR: 0, trades: 0 };
            entry.netR += toNumber(r.rMultiple);
            entry.trades += 1;
            yearMap.set(year, entry);
        }
        const yearlyR = Array.from(yearMap.entries())
            .sort(([a], [b]) => a - b)
            .map(([year, v]) => ({ year, netR: round(v.netR, 1), trades: v.trades }));

        // --- Session R ---
        const sessionMap = new Map<string, { netR: number; wins: number; total: number }>();
        for (const r of closed) {
            const s = r.session ?? 'UNKNOWN';
            const entry = sessionMap.get(s) ?? { netR: 0, wins: 0, total: 0 };
            entry.netR += toNumber(r.rMultiple);
            entry.total += 1;
            if (r.win) entry.wins += 1;
            sessionMap.set(s, entry);
        }
        const sessionR = Array.from(sessionMap.entries())
            .map(([session, v]) => ({
                session,
                netR: round(v.netR, 1),
                winRate: round(v.total > 0 ? (v.wins / v.total) * 100 : 0, 0),
                trades: v.total,
            }))
            .sort((a, b) => b.netR - a.netR);

        // --- Monthly R ---
        const monthMap = new Map<string, number>();
        for (const r of closed) {
            const d = new Date(r.signal.entryTime);
            const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
            monthMap.set(key, (monthMap.get(key) ?? 0) + toNumber(r.rMultiple));
        }
        const monthlyR = Array.from(monthMap.entries())
            .map(([key, netR]) => {
                const [year, month] = key.split('-').map(Number);
                return { year, month, netR: round(netR, 1) };
            })
            .sort((a, b) => a.year - b.year || a.month - b.month);

        // --- Instrument R ---
        const instrMap = new Map<string, { netR: number; wins: number; total: number }>();
        for (const r of closed) {
            const sym = r.signal.symbol;
            const entry = instrMap.get(sym) ?? { netR: 0, wins: 0, total: 0 };
            entry.netR += toNumber(r.rMultiple);
            entry.total += 1;
            if (r.win) entry.wins += 1;
            instrMap.set(sym, entry);
        }
        const instrumentR = Array.from(instrMap.entries())
            .map(([symbol, v]) => ({
                symbol,
                netR: round(v.netR, 1),
                winRate: round(v.total > 0 ? (v.wins / v.total) * 100 : 0, 0),
                trades: v.total,
            }))
            .sort((a, b) => b.netR - a.netR);

        // --- Equity Curve (cumulative R over time, sampled for size) ---
        let cumulativeR = 0;
        const rawCurve = closed.map((r) => {
            cumulativeR += toNumber(r.rMultiple);
            return {
                time: (r.exitTime ?? r.signal.entryTime).toISOString(),
                cumulativeR: round(cumulativeR, 2),
            };
        });
        // Downsample to max 500 points for JSON size
        const step = Math.max(1, Math.floor(rawCurve.length / 500));
        const equityCurve = rawCurve.filter((_, i) => i % step === 0 || i === rawCurve.length - 1);

        return { yearlyR, sessionR, monthlyR, instrumentR, equityCurve };
    }

    public async getStrategyBreakdown(filters: EngineFilters) {
        const results = await this.loadResults(filters);
        const grouped = new Map<string, ResultRecord[]>();

        for (const result of results) {
            const key = result.signal.strategyId;
            const list = grouped.get(key) || [];
            list.push(result);
            grouped.set(key, list);
        }

        return Array.from(grouped.entries())
            .map(([strategyId, groupedResults]) => {
                const sample = groupedResults[0];
                const closed = groupedResults.filter((result) => !result.isOpen);
                const wins = closed.filter((result) => result.win);
                const losses = closed.filter((result) => !result.win);
                const netR = closed.reduce((sum, result) => sum + toNumber(result.rMultiple), 0);

                return {
                    strategyId,
                    strategyCode: sample.signal.strategy.code,
                    strategyName: sample.signal.strategy.name,
                    trades: groupedResults.length,
                    wins: wins.length,
                    losses: losses.length,
                    openTrades: groupedResults.filter((result) => result.isOpen).length,
                    winRate: round(closed.length > 0 ? (wins.length / closed.length) * 100 : 0, 2),
                    netR: round(netR, 2),
                };
            })
            .sort((left, right) => right.netR - left.netR);
    }

    public async getSessionBreakdown(filters: EngineFilters) {
        const results = await this.loadResults(filters);
        const grouped = new Map<TradingSession, ResultRecord[]>();

        for (const result of results) {
            const key = result.session;
            const list = grouped.get(key) || [];
            list.push(result);
            grouped.set(key, list);
        }

        return Array.from(grouped.entries())
            .map(([session, groupedResults]) => {
                const closed = groupedResults.filter((result) => !result.isOpen);
                const wins = closed.filter((result) => result.win);
                const losses = closed.filter((result) => !result.win);
                const netR = closed.reduce((sum, result) => sum + toNumber(result.rMultiple), 0);

                return {
                    session,
                    trades: groupedResults.length,
                    wins: wins.length,
                    losses: losses.length,
                    openTrades: groupedResults.filter((result) => result.isOpen).length,
                    winRate: round(closed.length > 0 ? (wins.length / closed.length) * 100 : 0, 2),
                    netR: round(netR, 2),
                };
            })
            .sort((left, right) => right.netR - left.netR);
    }

    public async getExitComparison(filters: EngineFilters) {
        const results = await this.loadResults(filters);
        const grouped = new Map<string, ResultRecord[]>();

        for (const result of results) {
            const key = result.exitRuleId;
            const list = grouped.get(key) || [];
            list.push(result);
            grouped.set(key, list);
        }

        return Array.from(grouped.entries())
            .map(([exitRuleId, groupedResults]) => {
                const sample = groupedResults[0];
                const closed = groupedResults.filter((result) => !result.isOpen);
                const wins = closed.filter((result) => result.win);
                const losses = closed.filter((result) => !result.win);
                const netR = closed.reduce((sum, result) => sum + toNumber(result.rMultiple), 0);
                const netUsd = closed.reduce((sum, result) => sum + toNumber(result.pnlUsd), 0);
                const grossProfit = wins.reduce((sum, result) => sum + Math.max(toNumber(result.rMultiple), 0), 0);
                const grossLoss = losses.reduce((sum, result) => sum + Math.abs(Math.min(toNumber(result.rMultiple), 0)), 0);
                const avgWin = average(wins.map((result) => toNumber(result.rMultiple)));
                const avgLoss = average(losses.map((result) => toNumber(result.rMultiple)));
                const maxDrawdownPct = closed.reduce((worst, result) => Math.min(worst, toNumber(result.maxDrawdownPct)), 0);

                return {
                    exitRuleId,
                    exitRuleCode: sample.exitRule.code,
                    exitRuleName: sample.exitRule.name,
                    trades: groupedResults.length,
                    wins: wins.length,
                    losses: losses.length,
                    openTrades: groupedResults.filter((result) => result.isOpen).length,
                    winRate: round(closed.length > 0 ? (wins.length / closed.length) * 100 : 0, 2),
                    netR: round(netR, 2),
                    netUsd: round(netUsd, 2),
                    maxDrawdownPct: round(maxDrawdownPct, 2),
                    profitFactor: round(grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? grossProfit : 0, 2),
                    expectancy: round(closed.length > 0 ? netR / closed.length : 0, 3),
                    avgWinR: round(avgWin, 2),
                    avgLossR: round(avgLoss, 2),
                };
            })
            .sort((left, right) => right.netR - left.netR);
    }

    public async getGeneratedBacktestLeaderboard(
        filters: BacktestLeaderboardFilters,
        options: BacktestLeaderboardOptions = {},
    ): Promise<BacktestLeaderboardResponse> {
        const where = this.buildBacktestLeaderboardRunWhere(filters);
        const runs = await this.prisma.backtestRun.findMany({
            where,
            select: {
                id: true,
                name: true,
                signalCode: true,
                signalVersion: true,
                symbol: true,
                timeframe: true,
                status: true,
                startedAt: true,
                finishedAt: true,
                createdAt: true,
                notes: true,
                _count: {
                    select: {
                        signals: true,
                    },
                },
            },
            orderBy: {
                createdAt: 'desc',
            },
        });

        const minClosedTrades = Math.max(filters.minClosedTrades ?? 0, 0);
        const mode = options.mode ?? 'ALL_RUNS';
        const sort = options.sort ?? 'rank';
        const order = options.order ?? 'desc';
        const runIds = runs.map((run) => run.id);
        const resultGroups = runIds.length === 0
            ? []
            : await this.prisma.backtestTradeResult.groupBy({
                by: ['backtestRunId', 'win', 'isOpen'],
                where: {
                    backtestRunId: {
                        in: runIds,
                    },
                },
                _count: {
                    _all: true,
                },
                _sum: {
                    rMultiple: true,
                    pnlUsd: true,
                },
                _min: {
                    maxDrawdownPct: true,
                },
            });
        const aggregatesByRun = this.buildBacktestLeaderboardAggregates(resultGroups);

        const allRows = runs
            .map((run) => this.serializeGeneratedBacktestLeaderboardRow(run, aggregatesByRun.get(run.id)))
            .filter((row) => row.closedTrades >= minClosedTrades);

        const sourceRows = mode === 'BEST_PER_SIGNAL'
            ? this.selectBestLeaderboardRowPerSignal(allRows)
            : allRows;

        const sortedRows = this.sortGeneratedBacktestLeaderboardRows(sourceRows, sort, order);
        const pageSize = clampPageSize(options.pageSize);
        const totalRows = sortedRows.length;
        const totalPages = totalRows === 0 ? 0 : Math.ceil(totalRows / pageSize);
        const page = totalPages === 0
            ? 1
            : Math.min(Math.max(options.page ?? 1, 1), totalPages);
        const start = (page - 1) * pageSize;
        const paginatedRows = sortedRows.slice(start, start + pageSize).map((row, index) => ({
            ...row,
            rank: start + index + 1,
        }));

        return {
            rows: paginatedRows,
            pagination: {
                page,
                pageSize,
                totalRows,
                totalPages,
            },
            summary: {
                totalRows,
                totalSignals: new Set(sortedRows.map((row) => row.signalKey)).size,
                constructiveRows: sortedRows.filter((row) => row.cautionState === 'constructive').length,
                weakerRows: sortedRows.filter((row) => row.cautionState === 'weaker').length,
                suspiciousRows: sortedRows.filter((row) => row.cautionState === 'suspicious').length,
            },
            mode,
            sort,
            order,
        };
    }

    public async getAnnotations(filters: EngineFilters) {
        const results = await this.loadResults(filters);

        return sortResults(results).map((result) => ({
            signalId: result.signalId,
            backtestRunId: result.backtestRunId,
            exitRuleCode: result.exitRule.code,
            exitRuleName: result.exitRule.name,
            strategyCode: result.signal.strategy.code,
            strategyName: result.signal.strategy.name,
            symbol: result.signal.symbol,
            timeframe: result.signal.timeframe,
            side: result.signal.side,
            session: result.signal.session,
            entryTime: result.signal.entryTime,
            entryPrice: round(toNumber(result.signal.entryPrice), 4),
            stopLoss: round(toNumber(result.signal.stopLoss), 4),
            takeProfit1: result.signal.takeProfit1 ? round(toNumber(result.signal.takeProfit1), 4) : null,
            takeProfit2: result.signal.takeProfit2 ? round(toNumber(result.signal.takeProfit2), 4) : null,
            exitTime: result.exitTime,
            exitPrice: result.exitPrice ? round(toNumber(result.exitPrice), 4) : null,
            win: result.win,
            isOpen: result.isOpen,
            rMultiple: round(toNumber(result.rMultiple), 2),
            pnlUsd: round(toNumber(result.pnlUsd), 2),
            label: `${toNumber(result.rMultiple) >= 0 ? '+' : ''}${round(toNumber(result.rMultiple), 2)}R`,
        }));
    }

    public async getSignalReview(filters: EngineFilters) {
        const signalWhere: Prisma.SignalWhereInput = {};

        if (filters.symbol) {
            signalWhere.symbol = normalizeSymbol(filters.symbol);
        }
        if (filters.signalId) {
            signalWhere.id = filters.signalId;
        }
        if (filters.timeframe) {
            signalWhere.timeframe = filters.timeframe;
        }
        if (filters.strategyId) {
            signalWhere.strategyId = filters.strategyId;
        }
        if (filters.side && filters.side !== 'ALL') {
            signalWhere.side = filters.side;
        }
        if (filters.session) {
            signalWhere.session = filters.session;
        }
        if (filters.from || filters.to) {
            signalWhere.entryTime = {
                ...(filters.from ? { gte: filters.from } : {}),
                ...(filters.to ? { lte: filters.to } : {}),
            };
        }
        if (filters.backtestRunId) {
            signalWhere.results = {
                some: {
                    backtestRunId: filters.backtestRunId,
                },
            };
        }

        const signals = await this.prisma.signal.findMany({
            where: signalWhere,
            include: {
                strategy: true,
                results: {
                    where: {
                        ...(filters.backtestRunId ? { backtestRunId: filters.backtestRunId } : {}),
                    },
                    include: {
                        exitRule: true,
                        backtestRun: {
                            include: {
                                strategy: true,
                            },
                        },
                    },
                    orderBy: [
                        { exitTime: 'desc' },
                        { createdAt: 'desc' },
                    ],
                },
            },
            orderBy: {
                entryTime: 'desc',
            },
            take: 500,
        });

        return signals.map((signal) => this.serializeSignalReview(signal));
    }

    public async getTradeHistory(filters: EngineFilters, options: TradeHistoryOptions = {}) {
        const results = await this.loadResults(filters);
        const filtered = results.filter((result) => this.matchesTradeHistoryFilters(result, options));
        const sorted = this.sortTradeHistoryResults(filtered, options.sort || 'entryTime', options.order || 'desc');
        const pageSize = Math.min(Math.max(options.pageSize || 50, 1), 200);
        const page = Math.max(options.page || 1, 1);
        const totalRows = sorted.length;
        const totalPages = totalRows === 0 ? 0 : Math.ceil(totalRows / pageSize);
        const safePage = totalPages === 0 ? 1 : Math.min(page, totalPages);
        const start = (safePage - 1) * pageSize;
        const rows = sorted.slice(start, start + pageSize).map((result) => this.serializeTradeRow(result));
        const closedTrades = filtered.filter((result) => !result.isOpen);
        const wins = closedTrades.filter((result) => this.classifyTradeResult(result) === 'WIN');
        const losses = closedTrades.filter((result) => this.classifyTradeResult(result) === 'LOSS');
        const breakEven = closedTrades.filter((result) => this.classifyTradeResult(result) === 'BE');
        const netR = closedTrades.reduce((sum, result) => sum + toNumber(result.rMultiple), 0);

        return {
            summary: {
                totalTrades: filtered.length,
                closedTrades: closedTrades.length,
                openTrades: filtered.filter((result) => result.isOpen).length,
                wins: wins.length,
                losses: losses.length,
                breakEven: breakEven.length,
                winRate: round(closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0, 2),
                netR: round(netR, 2),
                avgWinR: round(average(wins.map((result) => toNumber(result.rMultiple))), 2),
                avgLossR: round(average(losses.map((result) => toNumber(result.rMultiple))), 2),
            },
            rows,
            pagination: {
                page: safePage,
                pageSize,
                totalRows,
                totalPages,
            },
        };
    }

    private async loadResults(filters: EngineFilters) {
        const where: Prisma.BacktestTradeResultWhereInput = {};
        const signalWhere: Prisma.SignalWhereInput = {};

        if (filters.backtestRunIds?.length) {
            where.backtestRunId = { in: filters.backtestRunIds };
        } else if (filters.backtestRunId) {
            where.backtestRunId = filters.backtestRunId;
        }
        if (filters.symbol) {
            signalWhere.symbol = normalizeSymbol(filters.symbol);
        }
        if (filters.timeframe) {
            signalWhere.timeframe = filters.timeframe;
        }
        if (filters.strategyId) {
            signalWhere.strategyId = filters.strategyId;
        }
        if (filters.from || filters.to) {
            signalWhere.entryTime = {
                ...(filters.from ? { gte: filters.from } : {}),
                ...(filters.to ? { lte: filters.to } : {}),
            };
        }
        if (filters.side && filters.side !== 'ALL') {
            signalWhere.side = filters.side;
        }
        if (filters.session) {
            where.session = filters.session;
        }
        if (filters.exitRuleId) {
            where.exitRuleId = filters.exitRuleId;
        }

        if (Object.keys(signalWhere).length > 0) {
            where.signal = signalWhere;
        }

        return this.prisma.backtestTradeResult.findMany({
            where,
            include: {
                signal: {
                    include: {
                        strategy: true,
                    },
                },
                exitRule: true,
                backtestRun: {
                    include: {
                        strategy: true,
                    },
                },
            },
        });
    }

    private async resolveContextRun(backtestRunId: string | undefined, results: ResultRecord[]) {
        if (backtestRunId) {
            return this.prisma.backtestRun.findUnique({
                where: { id: backtestRunId },
                include: {
                    strategy: true,
                },
            });
        }

        if (results.length > 0) {
            return results[0].backtestRun;
        }

        return this.prisma.backtestRun.findFirst({
            include: {
                strategy: true,
            },
            orderBy: { createdAt: 'desc' },
        });
    }

    private serializeSignalReview(signal: SignalRecord) {
        const closedResults = signal.results.filter((result) => !result.isOpen);
        const wins = closedResults.filter((result) => result.win);
        const losses = closedResults.filter((result) => !result.win);
        const openResults = signal.results.filter((result) => result.isOpen);
        const netR = closedResults.reduce((sum, result) => sum + toNumber(result.rMultiple), 0);
        const avgR = closedResults.length > 0 ? netR / closedResults.length : 0;
        const bestResult = [...closedResults].sort((left, right) => toNumber(right.rMultiple) - toNumber(left.rMultiple))[0];
        const latestResult = [...signal.results].sort((left, right) => {
            const leftTime = new Date(left.exitTime || left.createdAt).getTime();
            const rightTime = new Date(right.exitTime || right.createdAt).getTime();
            return rightTime - leftTime;
        })[0];

        return {
            signalId: signal.id,
            backtestRunId: latestResult?.backtestRunId ?? null,
            backtestRunName: latestResult?.backtestRun.name ?? null,
            symbol: signal.symbol,
            timeframe: signal.timeframe,
            side: signal.side,
            session: signal.session,
            strategyId: signal.strategyId,
            strategyCode: signal.strategy.code,
            strategyName: signal.strategy.name,
            entryTime: signal.entryTime,
            entryPrice: round(toNumber(signal.entryPrice), 4),
            stopLoss: round(toNumber(signal.stopLoss), 4),
            takeProfit1: signal.takeProfit1 ? round(toNumber(signal.takeProfit1), 4) : null,
            takeProfit2: signal.takeProfit2 ? round(toNumber(signal.takeProfit2), 4) : null,
            notes: signal.notes,
            resultCount: signal.results.length,
            wins: wins.length,
            losses: losses.length,
            openResults: openResults.length,
            netR: round(netR, 2),
            avgR: round(avgR, 2),
            bestExitRuleCode: bestResult?.exitRule.code ?? null,
            bestExitRuleName: bestResult?.exitRule.name ?? null,
            latestExitTime: latestResult?.exitTime ?? null,
        };
    }

    private serializeRun(run: BacktestRun & { strategy?: Strategy | null }) {
        return {
            id: run.id,
            name: run.name,
            symbol: run.symbol,
            timeframe: run.timeframe,
            side: run.side,
            strategyId: run.strategyId,
            strategyName: run.strategy?.name ?? null,
            strategyCode: run.strategy?.code ?? null,
            initialEquity: round(toNumber(run.initialEquity), 2),
            riskPercent: round(toNumber(run.riskPercent), 4),
            startedAt: run.startedAt,
            finishedAt: run.finishedAt,
            createdAt: run.createdAt,
        };
    }

    private serializeGeneratedBacktestLeaderboardRow(
        run: BacktestLeaderboardRunRecord,
        aggregate?: BacktestLeaderboardAggregateStats,
    ): BacktestLeaderboardRow {
        const stats = aggregate ?? {
            totalTrades: 0,
            closedTrades: 0,
            openTrades: 0,
            wins: 0,
            losses: 0,
            netR: 0,
            netUsd: 0,
            grossProfit: 0,
            grossLoss: 0,
            maxDrawdownPct: 0,
        };
        const signalLabel = run.signalCode
            ? `${run.signalCode}@${run.signalVersion ?? '?'}`
            : run.name;
        const baseRow = {
            rank: 0,
            runId: run.id,
            runName: run.name,
            signalCode: run.signalCode ?? null,
            signalVersion: run.signalVersion ?? null,
            signalKey: run.signalCode ? `${run.signalCode}@${run.signalVersion ?? '?'}` : run.id,
            signalLabel,
            symbol: run.symbol,
            timeframe: run.timeframe,
            status: run.status,
            startedAt: run.startedAt,
            finishedAt: run.finishedAt,
            createdAt: run.createdAt,
            signalCount: run._count.signals,
            totalTrades: stats.totalTrades,
            closedTrades: stats.closedTrades,
            openTrades: stats.openTrades,
            wins: stats.wins,
            losses: stats.losses,
            winRate: round(stats.closedTrades > 0 ? (stats.wins / stats.closedTrades) * 100 : 0, 2),
            profitFactor: round(
                stats.grossLoss > 0
                    ? stats.grossProfit / stats.grossLoss
                    : stats.grossProfit > 0 ? stats.grossProfit : 0,
                2,
            ),
            expectancy: round(stats.closedTrades > 0 ? stats.netR / stats.closedTrades : 0, 3),
            netR: round(stats.netR, 2),
            netUsd: round(stats.netUsd, 2),
            maxDrawdownPct: round(stats.maxDrawdownPct, 2),
            notes: run.notes ? String(run.notes) : null,
        };
        const caution = resolveLeaderboardCaution(baseRow);

        return {
            ...baseRow,
            ...caution,
        };
    }

    private buildBacktestLeaderboardRunWhere(filters: BacktestLeaderboardFilters): Prisma.BacktestRunWhereInput {
        const startedAt: Prisma.DateTimeFilter = {};
        if (filters.from) {
            startedAt.gte = filters.from;
        }

        const andFilters: Prisma.BacktestRunWhereInput[] = [];
        if (filters.to) {
            andFilters.push({
                OR: [
                    {
                        finishedAt: {
                            lte: filters.to,
                        },
                    },
                    {
                        AND: [
                            { finishedAt: null },
                            {
                                startedAt: {
                                    lte: filters.to,
                                },
                            },
                        ],
                    },
                ],
            });
        }

        return {
            sourceType: SignalSourceType.GENERATED,
            ...(filters.signalCode
                ? {
                    signalCode: {
                        contains: filters.signalCode.trim(),
                        mode: 'insensitive',
                    },
                }
                : {}),
            ...(filters.symbol ? { symbol: normalizeSymbol(filters.symbol) } : {}),
            ...(filters.timeframe ? { timeframe: filters.timeframe } : {}),
            ...(filters.status && filters.status !== 'ALL' ? { status: filters.status } : {}),
            ...(Object.keys(startedAt).length > 0 ? { startedAt } : {}),
            ...(andFilters.length > 0 ? { AND: andFilters } : {}),
        };
    }

    private buildBacktestLeaderboardAggregates(groups: BacktestLeaderboardResultAggregate[]) {
        const aggregates = new Map<string, BacktestLeaderboardAggregateStats>();

        for (const group of groups) {
            const current = aggregates.get(group.backtestRunId) ?? {
                totalTrades: 0,
                closedTrades: 0,
                openTrades: 0,
                wins: 0,
                losses: 0,
                netR: 0,
                netUsd: 0,
                grossProfit: 0,
                grossLoss: 0,
                maxDrawdownPct: 0,
            };
            const count = group._count._all;

            current.totalTrades += count;

            if (group.isOpen) {
                current.openTrades += count;
                aggregates.set(group.backtestRunId, current);
                continue;
            }

            current.closedTrades += count;
            current.netR += toNumber(group._sum.rMultiple);
            current.netUsd += toNumber(group._sum.pnlUsd);
            current.maxDrawdownPct = Math.min(current.maxDrawdownPct, toNumber(group._min.maxDrawdownPct));

            if (group.win) {
                current.wins += count;
                current.grossProfit += Math.max(toNumber(group._sum.rMultiple), 0);
            } else {
                current.losses += count;
                current.grossLoss += Math.abs(Math.min(toNumber(group._sum.rMultiple), 0));
            }

            aggregates.set(group.backtestRunId, current);
        }

        return aggregates;
    }

    private selectBestLeaderboardRowPerSignal(rows: BacktestLeaderboardRow[]) {
        const bestBySignal = new Map<string, BacktestLeaderboardRow>();

        for (const row of rows) {
            const current = bestBySignal.get(row.signalKey);
            if (!current || compareBacktestLeaderboardRank(row, current) < 0) {
                bestBySignal.set(row.signalKey, row);
            }
        }

        return Array.from(bestBySignal.values());
    }

    private sortGeneratedBacktestLeaderboardRows(
        rows: BacktestLeaderboardRow[],
        sort: BacktestLeaderboardSortField,
        order: BacktestLeaderboardSortOrder,
    ) {
        const direction = order === 'asc' ? 1 : -1;

        return [...rows].sort((left, right) => {
            let comparison = 0;

            switch (sort) {
                case 'createdAt':
                    comparison = left.createdAt.getTime() - right.createdAt.getTime();
                    break;
                case 'closedTrades':
                    comparison = left.closedTrades - right.closedTrades;
                    break;
                case 'winRate':
                    comparison = left.winRate - right.winRate;
                    break;
                case 'netR':
                    comparison = left.netR - right.netR;
                    break;
                case 'profitFactor':
                    comparison = left.profitFactor - right.profitFactor;
                    break;
                case 'expectancy':
                    comparison = left.expectancy - right.expectancy;
                    break;
                case 'maxDrawdownPct':
                    comparison = left.maxDrawdownPct - right.maxDrawdownPct;
                    break;
                case 'rank':
                default:
                    comparison = compareBacktestLeaderboardRank(left, right) * -1;
                    break;
            }

            if (comparison !== 0) {
                return comparison * direction;
            }

            return compareBacktestLeaderboardRank(left, right);
        });
    }

    private serializeTradeRow(result: ResultRecord) {
        return {
            rowId: `${result.signalId}:${result.exitRuleId}`,
            signalId: result.signalId,
            backtestRunId: result.backtestRunId,
            exitRuleId: result.exitRuleId,
            exitRuleCode: result.exitRule.code,
            exitRuleName: result.exitRule.name,
            symbol: result.signal.symbol,
            timeframe: result.signal.timeframe,
            side: result.signal.side,
            session: result.signal.session,
            entryTime: result.signal.entryTime,
            exitTime: result.exitTime,
            entryPrice: round(toNumber(result.signal.entryPrice), 4),
            stopLoss: round(toNumber(result.signal.stopLoss), 4),
            exitPrice: result.exitPrice ? round(toNumber(result.exitPrice), 4) : null,
            pnlPct: this.calculatePnlPct(result),
            rMultiple: round(toNumber(result.rMultiple), 2),
            pnlUsd: round(toNumber(result.pnlUsd), 2),
            durationMs: this.getTradeDurationMs(result),
            result: this.classifyTradeResult(result),
            notes: result.notes ?? result.signal.notes ?? null,
        };
    }

    private calculatePnlPct(result: ResultRecord) {
        if (!result.exitPrice) {
            return null;
        }

        const entry = toNumber(result.signal.entryPrice);
        const exit = toNumber(result.exitPrice);
        if (entry === 0) {
            return null;
        }

        const raw = result.signal.side === 'LONG'
            ? ((exit - entry) / entry) * 100
            : ((entry - exit) / entry) * 100;

        return round(raw, 2);
    }

    private getTradeDurationMs(result: ResultRecord) {
        if (!result.exitTime) {
            return null;
        }

        return Math.max(new Date(result.exitTime).getTime() - new Date(result.signal.entryTime).getTime(), 0);
    }

    private classifyTradeResult(result: ResultRecord): 'ACTIVE' | 'WIN' | 'LOSS' | 'BE' {
        if (result.isOpen) {
            return 'ACTIVE';
        }

        const rMultiple = toNumber(result.rMultiple);
        if (Math.abs(rMultiple) < BREAK_EVEN_EPSILON) {
            return 'BE';
        }

        return rMultiple > 0 ? 'WIN' : 'LOSS';
    }

    private matchesTradeHistoryFilters(result: ResultRecord, options: TradeHistoryOptions) {
        const status = options.status || 'ALL';
        const outcome = options.outcome || 'ALL';
        const classification = this.classifyTradeResult(result);

        if (status === 'ACTIVE' && classification !== 'ACTIVE') {
            return false;
        }
        if (status === 'CLOSED' && classification === 'ACTIVE') {
            return false;
        }

        if (outcome !== 'ALL') {
            if (classification === 'ACTIVE') {
                return false;
            }
            if (classification !== outcome) {
                return false;
            }
        }

        return true;
    }

    private sortTradeHistoryResults(results: ResultRecord[], field: TradeHistorySortField, order: TradeHistorySortOrder) {
        const direction = order === 'asc' ? 1 : -1;

        return [...results].sort((left, right) => {
            const leftValue = this.getTradeSortValue(left, field);
            const rightValue = this.getTradeSortValue(right, field);

            if (leftValue < rightValue) return -1 * direction;
            if (leftValue > rightValue) return 1 * direction;

            const leftFallback = new Date(left.signal.entryTime).getTime();
            const rightFallback = new Date(right.signal.entryTime).getTime();
            return (leftFallback - rightFallback) * direction;
        });
    }

    private getTradeSortValue(result: ResultRecord, field: TradeHistorySortField) {
        switch (field) {
            case 'exitTime':
                return result.exitTime ? new Date(result.exitTime).getTime() : -1;
            case 'pnlUsd':
                return toNumber(result.pnlUsd);
            case 'rMultiple':
                return toNumber(result.rMultiple);
            case 'durationMs':
                return this.getTradeDurationMs(result) ?? -1;
            case 'entryTime':
            default:
                return new Date(result.signal.entryTime).getTime();
        }
    }

    private getMaxConsecutiveLoss(results: ResultRecord[]) {
        let current = 0;
        let max = 0;

        for (const result of results) {
            if (result.win) {
                current = 0;
                continue;
            }

            current += 1;
            if (current > max) {
                max = current;
            }
        }

        return max;
    }
}
