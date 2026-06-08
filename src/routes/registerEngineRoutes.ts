import express from 'express';
import {
    BacktestRunStatus,
    ExitReason,
    PositionSide,
    PrismaClient,
    SignalSourceType,
    TradingSession,
} from '@prisma/client';
import {
    EngineAnalyticsService,
    BacktestLeaderboardMode,
    BacktestLeaderboardSortField,
    BacktestLeaderboardSortOrder,
    EngineFilters,
    TradeHistoryOutcome,
    TradeHistorySortField,
    TradeHistorySortOrder,
    TradeHistoryStatus,
} from '../services/EngineAnalyticsService';
import { normalizeSymbol } from '../utils/symbols';

type RouteGuard = express.RequestHandler[];

const parsePositionSide = (value: unknown): PositionSide | 'ALL' | undefined => {
    if (typeof value !== 'string' || value.trim() === '') return undefined;
    const normalized = value.toUpperCase();
    if (normalized === 'ALL') return 'ALL';
    if (normalized === 'LONG' || normalized === 'SHORT') return normalized as PositionSide;
    return undefined;
};

const parseSession = (value: unknown): TradingSession | undefined => {
    if (typeof value !== 'string' || value.trim() === '') return undefined;
    const normalized = value.toUpperCase();
    if (normalized === 'ASIAN' || normalized === 'LONDON' || normalized === 'NY') {
        return normalized as TradingSession;
    }
    return undefined;
};

const parseExitReason = (value: unknown): ExitReason => {
    if (typeof value !== 'string' || value.trim() === '') return ExitReason.MANUAL;
    const normalized = value.toUpperCase();
    const allowed = Object.values(ExitReason);
    return allowed.includes(normalized as ExitReason) ? normalized as ExitReason : ExitReason.MANUAL;
};

const parseDate = (value: unknown): Date | undefined => {
    if (typeof value !== 'string' || value.trim() === '') return undefined;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return undefined;
    return parsed;
};

const parseBoolean = (value: unknown): boolean => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value !== 'string') return false;
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'y';
};

const parseNumber = (value: unknown, fallback = 0): number => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
};

const parseTradeHistoryStatus = (value: unknown): TradeHistoryStatus | undefined => {
    if (typeof value !== 'string' || value.trim() === '') return undefined;
    const normalized = value.toUpperCase();
    if (normalized === 'ALL' || normalized === 'ACTIVE' || normalized === 'CLOSED') {
        return normalized as TradeHistoryStatus;
    }
    return undefined;
};

const parseTradeHistoryOutcome = (value: unknown): TradeHistoryOutcome | undefined => {
    if (typeof value !== 'string' || value.trim() === '') return undefined;
    const normalized = value.toUpperCase();
    if (normalized === 'ALL' || normalized === 'WIN' || normalized === 'LOSS' || normalized === 'BE') {
        return normalized as TradeHistoryOutcome;
    }
    return undefined;
};

const parsePositiveInteger = (value: unknown): number | undefined => {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
    return parsed;
};

const parseNonNegativeInteger = (value: unknown): number | undefined => {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) return undefined;
    return parsed;
};

const parseTradeHistorySort = (value: unknown): TradeHistorySortField | undefined => {
    if (typeof value !== 'string' || value.trim() === '') return undefined;
    if (value === 'entryTime' || value === 'exitTime' || value === 'pnlUsd' || value === 'rMultiple' || value === 'durationMs') {
        return value;
    }
    return undefined;
};

const parseTradeHistoryOrder = (value: unknown): TradeHistorySortOrder | undefined => {
    if (typeof value !== 'string' || value.trim() === '') return undefined;
    const normalized = value.toLowerCase();
    if (normalized === 'asc' || normalized === 'desc') {
        return normalized as TradeHistorySortOrder;
    }
    return undefined;
};

const buildFilters = (req: express.Request): EngineFilters => ({
    backtestRunId: typeof req.query.backtestRunId === 'string' ? req.query.backtestRunId : undefined,
    signalId: typeof req.query.signalId === 'string' ? req.query.signalId : undefined,
    symbol: typeof req.query.symbol === 'string' ? normalizeSymbol(req.query.symbol) : undefined,
    timeframe: typeof req.query.timeframe === 'string' ? req.query.timeframe : undefined,
    strategyId: typeof req.query.strategyId === 'string' ? req.query.strategyId : undefined,
    side: parsePositionSide(req.query.side),
    session: parseSession(req.query.session),
    exitRuleId: typeof req.query.exitRuleId === 'string' ? req.query.exitRuleId : undefined,
    from: parseDate(req.query.from),
    to: parseDate(req.query.to),
});

const parseBacktestLeaderboardStatus = (value: unknown): BacktestRunStatus | 'ALL' | undefined => {
    if (typeof value !== 'string' || value.trim() === '') return undefined;
    const normalized = value.toUpperCase();
    if (normalized === 'ALL') return 'ALL';
    if (Object.values(BacktestRunStatus).includes(normalized as BacktestRunStatus)) {
        return normalized as BacktestRunStatus;
    }
    return undefined;
};

const parseBacktestLeaderboardMode = (value: unknown): BacktestLeaderboardMode | undefined => {
    if (typeof value !== 'string' || value.trim() === '') return undefined;
    const normalized = value.toUpperCase();
    if (normalized === 'ALL_RUNS' || normalized === 'BEST_PER_SIGNAL') {
        return normalized as BacktestLeaderboardMode;
    }
    return undefined;
};

const parseBacktestLeaderboardSort = (value: unknown): BacktestLeaderboardSortField | undefined => {
    if (typeof value !== 'string' || value.trim() === '') return undefined;
    if (
        value === 'rank'
        || value === 'createdAt'
        || value === 'closedTrades'
        || value === 'winRate'
        || value === 'netR'
        || value === 'profitFactor'
        || value === 'expectancy'
        || value === 'maxDrawdownPct'
    ) {
        return value;
    }
    return undefined;
};

const parseBacktestLeaderboardOrder = (value: unknown): BacktestLeaderboardSortOrder | undefined => {
    if (typeof value !== 'string' || value.trim() === '') return undefined;
    const normalized = value.toLowerCase();
    if (normalized === 'asc' || normalized === 'desc') {
        return normalized as BacktestLeaderboardSortOrder;
    }
    return undefined;
};

const respondInternalError = (
    res: express.Response,
    scope: string,
    message: string,
    error: unknown,
) => {
    console.error(`[EngineRoutes:${scope}]`, error);
    return res.status(500).json({ error: message });
};

export function createGetBacktestLeaderboardRouteHandler(
    analytics: Pick<EngineAnalyticsService, 'getGeneratedBacktestLeaderboard'>,
): express.RequestHandler {
    return async (req, res) => {
        const mode = parseBacktestLeaderboardMode(req.query.mode);
        if (req.query.mode !== undefined && mode === undefined) {
            return res.status(400).json({ error: 'mode must be ALL_RUNS or BEST_PER_SIGNAL' });
        }

        const status = parseBacktestLeaderboardStatus(req.query.status);
        if (req.query.status !== undefined && status === undefined) {
            return res.status(400).json({ error: 'status must be ALL or a valid backtest run status' });
        }

        const sort = parseBacktestLeaderboardSort(req.query.sort);
        if (req.query.sort !== undefined && sort === undefined) {
            return res.status(400).json({ error: 'sort must be one of rank, createdAt, closedTrades, winRate, netR, profitFactor, expectancy, or maxDrawdownPct' });
        }

        const order = parseBacktestLeaderboardOrder(req.query.order);
        if (req.query.order !== undefined && order === undefined) {
            return res.status(400).json({ error: 'order must be asc or desc' });
        }

        const page = req.query.page === undefined ? undefined : parsePositiveInteger(req.query.page);
        if (req.query.page !== undefined && page === undefined) {
            return res.status(400).json({ error: 'page must be a positive integer' });
        }

        const pageSize = req.query.pageSize === undefined ? undefined : parsePositiveInteger(req.query.pageSize);
        if (req.query.pageSize !== undefined && pageSize === undefined) {
            return res.status(400).json({ error: 'pageSize must be a positive integer' });
        }

        const minClosedTrades = req.query.minClosedTrades === undefined ? undefined : parseNonNegativeInteger(req.query.minClosedTrades);
        if (req.query.minClosedTrades !== undefined && minClosedTrades === undefined) {
            return res.status(400).json({ error: 'minClosedTrades must be a non-negative integer' });
        }

        try {
            const result = await analytics.getGeneratedBacktestLeaderboard(
                {
                    signalCode: typeof req.query.signalCode === 'string' ? req.query.signalCode.trim() || undefined : undefined,
                    symbol: typeof req.query.symbol === 'string' ? normalizeSymbol(req.query.symbol) : undefined,
                    timeframe: typeof req.query.timeframe === 'string' ? req.query.timeframe.trim() || undefined : undefined,
                    status,
                    from: parseDate(req.query.from),
                    to: parseDate(req.query.to),
                    minClosedTrades,
                },
                {
                    mode,
                    page,
                    pageSize,
                    sort,
                    order,
                },
            );

            return res.json({ data: result });
        } catch (error) {
            return respondInternalError(res, 'backtest-leaderboard', 'Failed to load generated backtest leaderboard.', error);
        }
    };
}

export function createListRunsRouteHandler(
    analytics: Pick<EngineAnalyticsService, 'listRuns'>,
): express.RequestHandler {
    return async (req, res) => {
        try {
            return res.json({
                data: await analytics.listRuns({
                    includeId: typeof req.query.includeId === 'string' ? req.query.includeId : undefined,
                }),
            });
        } catch (error) {
            return respondInternalError(res, 'runs', 'Failed to load engine runs.', error);
        }
    };
}

export function registerEngineRoutes(
    app: express.Application,
    prisma: PrismaClient,
    guards: RouteGuard = [],
) {
    const analytics = new EngineAnalyticsService(prisma);

    app.get('/api/engine/strategies', ...guards, async (req, res) => {
        try {
            res.json({ data: await analytics.listStrategies() });
        } catch (error) {
            respondInternalError(res, 'strategies', 'Failed to load strategies.', error);
        }
    });

    app.get('/api/engine/exit-rules', ...guards, async (req, res) => {
        try {
            res.json({ data: await analytics.listExitRules() });
        } catch (error) {
            respondInternalError(res, 'exit-rules', 'Failed to load exit rules.', error);
        }
    });

    app.get('/api/engine/runs', ...guards, createListRunsRouteHandler(analytics));

    app.get('/api/engine/overview', ...guards, async (req, res) => {
        try {
            res.json({ data: await analytics.getOverview(buildFilters(req)) });
        } catch (error) {
            respondInternalError(res, 'overview', 'Failed to load engine overview.', error);
        }
    });

    app.get(
        '/api/engine/backtest-leaderboard',
        ...guards,
        createGetBacktestLeaderboardRouteHandler(analytics),
    );

    app.get('/api/engine/by-strategy', ...guards, async (req, res) => {
        try {
            res.json({ data: await analytics.getStrategyBreakdown(buildFilters(req)) });
        } catch (error) {
            respondInternalError(res, 'by-strategy', 'Failed to load the strategy breakdown.', error);
        }
    });

    app.get('/api/engine/sessions', ...guards, async (req, res) => {
        try {
            res.json({ data: await analytics.getSessionBreakdown(buildFilters(req)) });
        } catch (error) {
            respondInternalError(res, 'sessions', 'Failed to load the session breakdown.', error);
        }
    });

    app.get('/api/engine/exit-comparison', ...guards, async (req, res) => {
        try {
            res.json({ data: await analytics.getExitComparison(buildFilters(req)) });
        } catch (error) {
            respondInternalError(res, 'exit-comparison', 'Failed to load the exit comparison.', error);
        }
    });

    app.get('/api/engine/annotations', ...guards, async (req, res) => {
        try {
            res.json({ data: await analytics.getAnnotations(buildFilters(req)) });
        } catch (error) {
            respondInternalError(res, 'annotations', 'Failed to load engine annotations.', error);
        }
    });

    app.get('/api/engine/trades', ...guards, async (req, res) => {
        try {
            const filters = buildFilters(req);
            if (!filters.backtestRunId) {
                return res.status(400).json({ error: 'backtestRunId is required' });
            }

            res.json({
                data: await analytics.getTradeHistory(filters, {
                    status: parseTradeHistoryStatus(req.query.status),
                    outcome: parseTradeHistoryOutcome(req.query.outcome),
                    page: parsePositiveInteger(req.query.page),
                    pageSize: parsePositiveInteger(req.query.pageSize),
                    sort: parseTradeHistorySort(req.query.sort),
                    order: parseTradeHistoryOrder(req.query.order),
                }),
            });
        } catch (error: any) {
            respondInternalError(res, 'trades', 'Failed to load engine trade history.', error);
        }
    });

    app.get('/api/engine/equity-curve', ...guards, async (req, res) => {
        try {
            const backtestRunId = typeof req.query.backtestRunId === 'string' ? req.query.backtestRunId : null;
            if (!backtestRunId) {
                return res.status(400).json({ error: 'backtestRunId is required' });
            }

            const run = await prisma.backtestRun.findUnique({
                where: { id: backtestRunId },
                select: { initialEquity: true },
            });
            if (!run) {
                return res.status(404).json({ error: 'Run not found' });
            }

            const trades = await prisma.backtestTradeResult.findMany({
                where: { backtestRunId, isOpen: false },
                select: {
                    pnlUsd: true,
                    rMultiple: true,
                    win: true,
                    exitTime: true,
                    session: true,
                },
                orderBy: { exitTime: 'asc' },
            });

            const initialEquity = Number(run.initialEquity);
            let equity = initialEquity;
            let peak = equity;
            let maxDd = 0;
            let maxDdPct = 0;
            let bestYear = { year: 0, pnl: -Infinity };
            let worstYear = { year: 0, pnl: Infinity };
            const yearlyPnl: Record<number, number> = {};

            const points = trades.map((t) => {
                const pnl = Number(t.pnlUsd);
                const r = Number(t.rMultiple);
                equity += pnl;
                if (equity > peak) peak = equity;
                const dd = peak - equity;
                const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
                if (dd > maxDd) maxDd = dd;
                if (ddPct > maxDdPct) maxDdPct = ddPct;

                const year = t.exitTime ? t.exitTime.getUTCFullYear() : 0;
                if (year > 0) {
                    yearlyPnl[year] = (yearlyPnl[year] ?? 0) + pnl;
                }

                return {
                    time: t.exitTime?.toISOString() ?? null,
                    equity: Math.round(equity * 100) / 100,
                    pnlUsd: Math.round(pnl * 100) / 100,
                    rMultiple: Math.round(r * 10000) / 10000,
                    r1to1: t.win ? 1 : -1,
                    drawdown: Math.round(ddPct * 100) / 100,
                    session: t.session,
                    win: t.win,
                };
            });

            // Compute 1:1R equity curve
            let equity1to1 = initialEquity;
            const totalRMultiple = trades.reduce((s, t) => s + Number(t.rMultiple), 0);
            const avgRiskUsd = trades.length > 0 && Math.abs(totalRMultiple) > 0.001
                ? Math.abs((equity - initialEquity) / totalRMultiple)
                : initialEquity * 0.015; // fallback to 1.5% risk
            const points1to1 = trades.map((t) => {
                const r1 = t.win ? 1 : -1;
                equity1to1 += r1 * avgRiskUsd;
                return { equity: Math.round(equity1to1 * 100) / 100 };
            });

            // Yearly breakdown
            for (const [y, pnl] of Object.entries(yearlyPnl)) {
                const year = Number(y);
                if (pnl > bestYear.pnl) bestYear = { year, pnl };
                if (pnl < worstYear.pnl) worstYear = { year, pnl };
            }

            const totalWeeks = trades.length > 1 && trades[0].exitTime && trades[trades.length - 1].exitTime
                ? (trades[trades.length - 1].exitTime!.getTime() - trades[0].exitTime!.getTime()) / (7 * 24 * 3600 * 1000)
                : 1;
            const tradesPerWeek = Math.round((trades.length / Math.max(totalWeeks, 1)) * 100) / 100;

            const yearlyWins: Record<number, number> = {};
            const yearlyTradeCount: Record<number, number> = {};
            for (const t of trades) {
                const y = t.exitTime ? t.exitTime.getUTCFullYear() : 0;
                if (y > 0) {
                    yearlyTradeCount[y] = (yearlyTradeCount[y] ?? 0) + 1;
                    if (t.win) yearlyWins[y] = (yearlyWins[y] ?? 0) + 1;
                }
            }

            const yearlyBreakdown = Object.entries(yearlyPnl)
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([yearStr, pnl]) => {
                    const y = Number(yearStr);
                    const count = yearlyTradeCount[y] ?? 0;
                    const wins = yearlyWins[y] ?? 0;
                    return {
                        year: y,
                        trades: count,
                        wins,
                        winRate: count > 0 ? Math.round((wins / count) * 10000) / 100 : 0,
                        pnlUsd: Math.round(pnl * 100) / 100,
                    };
                });

            // Downsample points if too many (keep first, last, and evenly spaced)
            const MAX_POINTS = 500;
            const downsample = <T,>(arr: T[]): T[] => {
                if (arr.length <= MAX_POINTS) return arr;
                const step = (arr.length - 1) / (MAX_POINTS - 1);
                const result: T[] = [];
                for (let i = 0; i < MAX_POINTS; i++) {
                    result.push(arr[Math.round(i * step)]);
                }
                return result;
            };

            res.json({
                data: {
                    initialEquity,
                    finalEquity: Math.round(equity * 100) / 100,
                    totalReturn: Math.round(((equity - initialEquity) / initialEquity) * 10000) / 100,
                    maxDrawdownPct: Math.round(maxDdPct * 100) / 100,
                    maxDrawdownUsd: Math.round(maxDd * 100) / 100,
                    tradesPerWeek,
                    bestYear,
                    worstYear: worstYear.pnl === Infinity ? null : worstYear,
                    yearlyBreakdown,
                    points: downsample(points),
                    points1to1: downsample(points1to1),
                },
            });
        } catch (error: any) {
            respondInternalError(res, 'equity-curve', 'Failed to compute equity curve.', error);
        }
    });

    app.get('/api/engine/signals-review', ...guards, async (req, res) => {
        try {
            res.json({ data: await analytics.getSignalReview(buildFilters(req)) });
        } catch (error) {
            respondInternalError(res, 'signals-review', 'Failed to load signal review analytics.', error);
        }
    });

    app.post('/api/engine/import-bundle', ...guards, async (req, res) => {
        try {
            const signals = Array.isArray(req.body?.signals) ? req.body.signals : [];
            const results = Array.isArray(req.body?.results) ? req.body.results : [];
            const existingBacktestRunId = typeof req.body?.existingBacktestRunId === 'string'
                ? req.body.existingBacktestRunId
                : null;
            const backtestRun = req.body?.backtestRun ?? null;

            if (signals.length === 0) {
                return res.status(400).json({ error: 'signals array is required' });
            }

            const strategyCodes = new Set<string>();
            const exitRuleCodes = new Set<string>();

            for (const signal of signals) {
                const code = String(signal.strategyCode || '').trim().toUpperCase();
                if (code) strategyCodes.add(code);
            }

            if (backtestRun?.strategyCode) {
                strategyCodes.add(String(backtestRun.strategyCode).trim().toUpperCase());
            }

            for (const result of results) {
                const code = String(result.exitRuleCode || '').trim().toUpperCase();
                if (code) exitRuleCodes.add(code);
            }

            const [strategyRows, exitRuleRows] = await Promise.all([
                prisma.strategy.findMany({
                    where: { code: { in: Array.from(strategyCodes) } },
                }),
                prisma.exitRule.findMany({
                    where: { code: { in: Array.from(exitRuleCodes) } },
                }),
            ]);

            const strategyByCode = new Map(strategyRows.map((row) => [row.code.toUpperCase(), row]));
            const exitRuleByCode = new Map(exitRuleRows.map((row) => [row.code.toUpperCase(), row]));

            const missingStrategies = Array.from(strategyCodes).filter((code) => !strategyByCode.has(code));
            if (missingStrategies.length > 0) {
                return res.status(400).json({ error: `Unknown strategyCode values: ${missingStrategies.join(', ')}` });
            }

            const missingExitRules = Array.from(exitRuleCodes).filter((code) => !exitRuleByCode.has(code));
            if (missingExitRules.length > 0) {
                return res.status(400).json({ error: `Unknown exitRuleCode values: ${missingExitRules.join(', ')}` });
            }

            if (!existingBacktestRunId && !backtestRun) {
                return res.status(400).json({ error: 'existingBacktestRunId or backtestRun is required' });
            }

            const importSummary = await prisma.$transaction(async (tx) => {
                let resolvedRunId = existingBacktestRunId;

                if (backtestRun) {
                    const strategyCode = typeof backtestRun.strategyCode === 'string'
                        ? backtestRun.strategyCode.trim().toUpperCase()
                        : '';
                    const createdRun = await tx.backtestRun.create({
                        data: {
                            name: String(backtestRun.name),
                            symbol: normalizeSymbol(String(backtestRun.symbol)),
                            timeframe: String(backtestRun.timeframe),
                            strategyId: strategyCode ? strategyByCode.get(strategyCode)?.id ?? null : null,
                            side: parsePositionSide(backtestRun.side) === 'ALL'
                                ? null
                                : parsePositionSide(backtestRun.side) as PositionSide | undefined,
                            initialEquity: parseNumber(backtestRun.initialEquity),
                            riskPercent: parseNumber(backtestRun.riskPercent),
                            notes: backtestRun.notes ? String(backtestRun.notes) : null,
                            startedAt: backtestRun.startedAt ? new Date(backtestRun.startedAt) : undefined,
                            finishedAt: backtestRun.finishedAt ? new Date(backtestRun.finishedAt) : undefined,
                        },
                    });
                    resolvedRunId = createdRun.id;
                }

                if (!resolvedRunId) {
                    throw new Error('Unable to resolve backtest run');
                }

                const signalIdByKey = new Map<string, string>();
                let importedSignals = 0;
                let importedResults = 0;

                for (const [index, signal] of signals.entries()) {
                    const strategyCode = String(signal.strategyCode).trim().toUpperCase();
                    const signalKey = String(signal.signalKey || signal.clientKey || `signal-${index + 1}`);
                    const createdSignal = await tx.signal.create({
                        data: {
                            backtestRunId: resolvedRunId,
                            sourceType: SignalSourceType.IMPORTED,
                            externalKey: signalKey,
                            symbol: normalizeSymbol(String(signal.symbol)),
                            timeframe: String(signal.timeframe),
                            side: parsePositionSide(signal.side) as PositionSide,
                            strategyId: strategyByCode.get(strategyCode)!.id,
                            session: parseSession(signal.session) as TradingSession,
                            entryTime: new Date(signal.entryTime),
                            entryPrice: parseNumber(signal.entryPrice),
                            stopLoss: parseNumber(signal.stopLoss),
                            takeProfit1: signal.takeProfit1 === null || signal.takeProfit1 === undefined || signal.takeProfit1 === ''
                                ? null
                                : parseNumber(signal.takeProfit1),
                            takeProfit2: signal.takeProfit2 === null || signal.takeProfit2 === undefined || signal.takeProfit2 === ''
                                ? null
                                : parseNumber(signal.takeProfit2),
                            invalidationPrice: signal.invalidationPrice === null || signal.invalidationPrice === undefined || signal.invalidationPrice === ''
                                ? null
                                : parseNumber(signal.invalidationPrice),
                            notes: signal.notes ? String(signal.notes) : null,
                        },
                    });

                    signalIdByKey.set(signalKey, createdSignal.id);
                    importedSignals += 1;
                }

                for (const result of results) {
                    const exitRuleCode = String(result.exitRuleCode).trim().toUpperCase();
                    const resolvedSignalId = typeof result.signalId === 'string' && result.signalId.trim() !== ''
                        ? result.signalId
                        : signalIdByKey.get(String(result.signalKey || result.clientKey || ''));

                    if (!resolvedSignalId) {
                        throw new Error(`Unable to resolve signal for result with exitRuleCode ${exitRuleCode}`);
                    }

                    await tx.backtestTradeResult.create({
                        data: {
                            backtestRunId: resolvedRunId,
                            signalId: resolvedSignalId,
                            exitRuleId: exitRuleByCode.get(exitRuleCode)!.id,
                            resultSide: parsePositionSide(result.resultSide || result.side) as PositionSide,
                            session: parseSession(result.session) as TradingSession,
                            win: parseBoolean(result.win),
                            isOpen: parseBoolean(result.isOpen),
                            rMultiple: parseNumber(result.rMultiple),
                            pnlUsd: parseNumber(result.pnlUsd),
                            maxDrawdownPct: parseNumber(result.maxDrawdownPct),
                            exitReason: parseExitReason(result.exitReason),
                            exitTime: result.exitTime ? new Date(result.exitTime) : null,
                            exitPrice: result.exitPrice === null || result.exitPrice === undefined || result.exitPrice === ''
                                ? null
                                : parseNumber(result.exitPrice),
                            notes: result.notes ? String(result.notes) : null,
                        },
                    });
                    importedResults += 1;
                }

                return {
                    backtestRunId: resolvedRunId,
                    importedSignals,
                    importedResults,
                    createdBacktestRun: Boolean(backtestRun),
                };
            });

            res.status(201).json({ data: importSummary });
        } catch (error: any) {
            respondInternalError(res, 'import-bundle', 'Failed to import the engine bundle.', error);
        }
    });
}
