import express from 'express';
import rateLimit from 'express-rate-limit';
import { PositionSide, PrismaClient } from '@prisma/client';
import { TradingAuditService } from '../services/trading/TradingAuditService';
import {
    EngineAnalyticsService,
    TradeHistoryOutcome,
    TradeHistoryStatus,
} from '../services/EngineAnalyticsService';

const PUBLIC_TRADE_HISTORY_LIMIT = 10;
const PUBLIC_CACHE_MAX_AGE_SECONDS = 300; // 5 minutes

interface PublicTradeRecord {
    entryTime: string;
    exitTime: string | null;
    symbol: string;
    side: string;
    entryPrice: number;
    stopLoss: number;
    exitPrice: number | null;
    rMultiple: number;
    pnlUsd: number;
    result: string;
}

interface PublicTradeHistorySummary {
    totalRecords: number;
    wins: number;
    losses: number;
    breakEven: number;
    activeTrades: number;
}

interface PublicTradeHistorySnapshot {
    summary: PublicTradeHistorySummary;
    records: PublicTradeRecord[];
    evaluatedAt: string;
}

const parsePublicSide = (value: unknown): PositionSide | 'ALL' | undefined => {
    if (typeof value !== 'string' || value.trim() === '') return undefined;
    const normalized = value.toUpperCase();
    if (normalized === 'ALL') return 'ALL';
    if (normalized === 'LONG' || normalized === 'SHORT') return normalized as PositionSide;
    return undefined;
};

const parsePublicStatus = (value: unknown): TradeHistoryStatus | undefined => {
    if (typeof value !== 'string' || value.trim() === '') return undefined;
    const normalized = value.toUpperCase();
    if (normalized === 'ALL' || normalized === 'ACTIVE' || normalized === 'CLOSED') return normalized as TradeHistoryStatus;
    return undefined;
};

const parsePublicOutcome = (value: unknown): TradeHistoryOutcome | undefined => {
    if (typeof value !== 'string' || value.trim() === '') return undefined;
    const normalized = value.toUpperCase();
    if (normalized === 'ALL' || normalized === 'WIN' || normalized === 'LOSS' || normalized === 'BE') return normalized as TradeHistoryOutcome;
    return undefined;
};

const parsePublicPositiveInt = (value: unknown): number | undefined => {
    if (typeof value !== 'string') return undefined;
    const parsed = parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed < 1) return undefined;
    return parsed;
};

export function registerPublicRoutes(app: express.Application, prisma: PrismaClient) {
    const tradingAuditService = new TradingAuditService(prisma);
    const engineAnalytics = new EngineAnalyticsService(prisma);

    const publicLimiter = rateLimit({
        windowMs: 1 * 60 * 1000,
        max: 30,
        standardHeaders: true,
        legacyHeaders: false,
        message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later.', domain: 'public' } },
    });

    app.get('/api/public/trade-history', publicLimiter, async (_req, res) => {
        try {
            // Use same GO-LIVE run selection as /api/public/reports
            const goLiveRuns = await prisma.backtestRun.findMany({
                where: {
                    status: 'COMPLETED',
                    notes: { contains: '[★ GO-LIVE]' },
                },
                select: { id: true },
                orderBy: { createdAt: 'desc' },
            });

            let backtestRunIds: string[];

            if (goLiveRuns.length > 0) {
                backtestRunIds = goLiveRuns.map((r) => r.id);
            } else {
                const latestRun = await prisma.backtestRun.findFirst({
                    where: { status: 'COMPLETED' },
                    orderBy: { createdAt: 'desc' },
                    select: { id: true },
                });
                backtestRunIds = latestRun ? [latestRun.id] : [];
            }

            if (backtestRunIds.length === 0) {
                return res.json({
                    success: true,
                    data: {
                        summary: { totalRecords: 0, wins: 0, losses: 0, breakEven: 0, activeTrades: 0 },
                        records: [],
                        evaluatedAt: new Date().toISOString(),
                    },
                });
            }

            const rows = await prisma.backtestTradeResult.findMany({
                where: {
                    backtestRunId: { in: backtestRunIds },
                    isOpen: false,
                },
                include: { signal: true },
                orderBy: { exitTime: 'desc' },
                take: PUBLIC_TRADE_HISTORY_LIMIT,
            });

            const records: PublicTradeRecord[] = rows.map((row) => {
                const entryPrice = Number(row.signal.entryPrice);
                const stopLoss = Number(row.signal.stopLoss);
                const exitPrice = row.exitPrice ? Number(row.exitPrice) : null;
                const rMultiple = Number(row.rMultiple);
                const pnlUsd = Number(row.pnlUsd);
                const result = row.win ? 'WIN' : (Math.abs(rMultiple) < 0.05 ? 'BE' : 'LOSS');

                return {
                    entryTime: row.signal.entryTime.toISOString(),
                    exitTime: row.exitTime?.toISOString() ?? null,
                    symbol: row.signal.symbol,
                    side: row.signal.side,
                    entryPrice,
                    stopLoss,
                    exitPrice,
                    rMultiple: Math.round(rMultiple * 100) / 100,
                    pnlUsd: Math.round(pnlUsd * 100) / 100,
                    result,
                };
            });

            const closedRows = rows.filter((r) => !r.isOpen);
            const wins = closedRows.filter((r) => r.win).length;
            const losses = closedRows.filter((r) => !r.win && Math.abs(Number(r.rMultiple)) >= 0.05).length;
            const breakEven = closedRows.length - wins - losses;

            const data: PublicTradeHistorySnapshot = {
                summary: {
                    totalRecords: closedRows.length,
                    wins,
                    losses,
                    breakEven,
                    activeTrades: 0,
                },
                records,
                evaluatedAt: new Date().toISOString(),
            };

            res.set('Cache-Control', `public, max-age=${PUBLIC_CACHE_MAX_AGE_SECONDS}`);
            res.json({ success: true, data });
        } catch {
            res.status(500).json({
                success: false,
                error: {
                    code: 'PUBLIC_TRADE_HISTORY_FAILED',
                    message: 'Failed to fetch public trade history.',
                    domain: 'public.history',
                },
            });
        }
    });

    app.get('/api/public/reports', publicLimiter, async (req, res) => {
        try {
            // Prefer go-live tagged backtests; fall back to latest completed run
            const goLiveRuns = await prisma.backtestRun.findMany({
                where: {
                    status: 'COMPLETED',
                    notes: { contains: '[★ GO-LIVE]' },
                },
                select: { id: true },
                orderBy: { createdAt: 'desc' },
            });

            let backtestFilter: { backtestRunId?: string; backtestRunIds?: string[] } = {};

            if (goLiveRuns.length > 0) {
                backtestFilter = { backtestRunIds: goLiveRuns.map((r) => r.id) };
            } else {
                const latestRun = await prisma.backtestRun.findFirst({
                    where: { status: 'COMPLETED' },
                    orderBy: { createdAt: 'desc' },
                    select: { id: true },
                });

                if (!latestRun) {
                    return res.json({
                        success: true,
                        data: {
                            overview: null,
                            trades: { summary: null, rows: [], pagination: { page: 1, pageSize: 50, totalRows: 0, totalPages: 0 } },
                            evaluatedAt: new Date().toISOString(),
                        },
                    });
                }

                backtestFilter = { backtestRunId: latestRun.id };
            }

            const filters = {
                ...backtestFilter,
                side: parsePublicSide(req.query.side),
            };

            const [overview, trades, analytics] = await Promise.all([
                engineAnalytics.getOverview(filters),
                engineAnalytics.getTradeHistory(filters, {
                    status: parsePublicStatus(req.query.status),
                    outcome: parsePublicOutcome(req.query.outcome),
                    page: parsePublicPositiveInt(req.query.page),
                    pageSize: parsePublicPositiveInt(req.query.pageSize),
                    sort: 'entryTime',
                    order: 'desc',
                }),
                engineAnalytics.getPublicAnalytics(filters),
            ]);

            const publicRows = trades.rows.map((row) => ({
                entryTime: row.entryTime,
                exitTime: row.exitTime,
                symbol: row.symbol,
                side: row.side,
                session: row.session,
                entryPrice: row.entryPrice,
                stopLoss: row.stopLoss,
                exitPrice: row.exitPrice,
                pnlPct: row.pnlPct,
                rMultiple: row.rMultiple,
                durationMs: row.durationMs,
                result: row.result,
            }));

            res.set('Cache-Control', `public, max-age=${PUBLIC_CACHE_MAX_AGE_SECONDS}`);
            res.json({
                success: true,
                data: {
                    overview: {
                        winRate: overview.metrics.winRate,
                        profitFactor: overview.metrics.profitFactor,
                        expectancy: overview.metrics.expectancy,
                        netR: overview.metrics.netR,
                        totalTrades: overview.metrics.totalTrades,
                        closedTrades: overview.metrics.closedTrades,
                        wins: overview.metrics.wins,
                        losses: overview.metrics.losses,
                        maxConsecutiveLoss: overview.metrics.maxConsecutiveLoss,
                        maxDrawdownPct: overview.metrics.maxDrawdownPct,
                    },
                    analytics,
                    trades: {
                        summary: trades.summary,
                        rows: publicRows,
                        pagination: trades.pagination,
                    },
                    evaluatedAt: new Date().toISOString(),
                },
            });
        } catch {
            res.status(500).json({
                success: false,
                error: {
                    code: 'PUBLIC_REPORTS_FAILED',
                    message: 'Failed to fetch public reports.',
                    domain: 'public.reports',
                },
            });
        }
    });
}
