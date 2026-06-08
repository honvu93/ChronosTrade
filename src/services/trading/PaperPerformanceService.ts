import { PrismaClient } from '@prisma/client';
import { TradingAccountActor } from './TradingAccountService';

export class PaperPerformanceServiceError extends Error {
    constructor(
        public readonly statusCode: number,
        public readonly code: string,
        message: string,
        public readonly domain = 'trading.paper-performance',
    ) {
        super(message);
        this.name = 'PaperPerformanceServiceError';
    }
}

export interface EquityCurvePoint {
    date: string;          // YYYY-MM-DD
    cumulativePnl: number;
}

export interface SignalBreakdownItem {
    bindingId: string;
    bindingName: string;
    executedCount: number;
    rejectedCount: number;
    failedCount: number;
}

export interface RecentIntentItem {
    id: string;
    createdAt: string;
    symbol: string;
    side: string | null;
    volume: number | null;
    status: string;
    statusReason: string | null;
    bindingName: string;
}

export interface PaperPerformanceResult {
    totalExecutedIntents: number;
    totalRejectedIntents: number;
    totalFailedIntents: number;
    totalRealizedPnl: number;
    equityCurve: EquityCurvePoint[];
    signalBreakdown: SignalBreakdownItem[];
    recentIntents: RecentIntentItem[];
    from: string | null;
    to: string | null;
}

export class PaperPerformanceService {
    constructor(private readonly prisma: PrismaClient) {}

    async getPerformance(
        actor: TradingAccountActor,
        accountId: string,
        options: { from?: Date; to?: Date },
    ): Promise<PaperPerformanceResult> {
        const account = await this.prisma.tradingAccount.findUnique({
            where: { id: accountId },
            select: { id: true, ownerUserId: true, accountMode: true },
        });

        if (!account || account.ownerUserId !== actor.id) {
            throw new PaperPerformanceServiceError(404, 'ACCOUNT_NOT_FOUND', 'Trading account not found.');
        }

        const dateFilter = options.from || options.to ? {
            createdAt: {
                ...(options.from ? { gte: options.from } : {}),
                ...(options.to ? { lte: options.to } : {}),
            },
        } : {};

        const dealDateFilter = options.from || options.to ? {
            executedAt: {
                ...(options.from ? { gte: options.from } : {}),
                ...(options.to ? { lte: options.to } : {}),
            },
        } : {};

        const [intents, deals] = await Promise.all([
            this.prisma.tradingTradeIntent.findMany({
                where: { accountId, ...dateFilter },
                select: {
                    id: true,
                    status: true,
                    symbol: true,
                    side: true,
                    volume: true,
                    createdAt: true,
                    statusReason: true,
                    binding: { select: { id: true, name: true } },
                },
                orderBy: { createdAt: 'desc' },
                take: 200,
            }),
            this.prisma.tradingDeal.findMany({
                where: { accountId, ...dealDateFilter },
                select: { id: true, executedAt: true, realizedPnl: true, symbol: true, side: true },
                orderBy: { executedAt: 'asc' },
            }),
        ]);

        // KPI counts
        const totalExecutedIntents = intents.filter((i) => i.status === 'EXECUTED').length;
        const totalRejectedIntents = intents.filter((i) => i.status === 'REJECTED').length;
        const totalFailedIntents = intents.filter((i) => i.status === 'FAILED').length;

        // Per-signal breakdown
        const bindingMap = new Map<string, SignalBreakdownItem>();
        for (const intent of intents) {
            const key = intent.binding.id;
            if (!bindingMap.has(key)) {
                bindingMap.set(key, {
                    bindingId: intent.binding.id,
                    bindingName: intent.binding.name,
                    executedCount: 0,
                    rejectedCount: 0,
                    failedCount: 0,
                });
            }
            const item = bindingMap.get(key)!;
            if (intent.status === 'EXECUTED') item.executedCount++;
            else if (intent.status === 'REJECTED') item.rejectedCount++;
            else if (intent.status === 'FAILED') item.failedCount++;
        }
        const signalBreakdown = Array.from(bindingMap.values())
            .sort((a, b) => b.executedCount - a.executedCount);

        // Equity curve from deals (group by day, accumulate)
        const dailyPnl = new Map<string, number>();
        let totalRealizedPnl = 0;
        for (const deal of deals) {
            const pnl = Number(deal.realizedPnl);
            totalRealizedPnl += pnl;
            const day = deal.executedAt.toISOString().slice(0, 10);
            dailyPnl.set(day, (dailyPnl.get(day) ?? 0) + pnl);
        }
        let cumulative = 0;
        const equityCurve: EquityCurvePoint[] = Array.from(dailyPnl.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, pnl]) => {
                cumulative += pnl;
                return { date, cumulativePnl: Math.round(cumulative * 100) / 100 };
            });

        // Recent intents feed (first 20, already sorted desc)
        const recentIntents: RecentIntentItem[] = intents.slice(0, 20).map((i) => ({
            id: i.id,
            createdAt: i.createdAt.toISOString(),
            symbol: i.symbol,
            side: i.side,
            volume: i.volume ? Number(i.volume) : null,
            status: i.status,
            statusReason: i.statusReason,
            bindingName: i.binding.name,
        }));

        return {
            totalExecutedIntents,
            totalRejectedIntents,
            totalFailedIntents,
            totalRealizedPnl: Math.round(totalRealizedPnl * 100) / 100,
            equityCurve,
            signalBreakdown,
            recentIntents,
            from: options.from?.toISOString() ?? null,
            to: options.to?.toISOString() ?? null,
        };
    }
}
