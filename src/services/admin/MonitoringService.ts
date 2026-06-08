import { BacktestRunStatus, PrismaClient, TradeIntentStatus } from '@prisma/client';
import { MT5BridgeClient } from '../trading/MT5BridgeClient';
import { getMarketSymbolAliases } from '../../utils/symbols';
import { getTimeframeAliases } from '../../utils/timeframes';

const CACHE_TTL_MS = 60_000;
const RECENT_FAILURE_LIMIT = 8;
const MT5_STALE_AFTER_MS = 10 * 60 * 1000;

export type MonitoringHealthStatus = 'healthy' | 'degraded' | 'failed';
export type MonitoringFreshnessStatus = 'fresh' | 'stale' | 'missing';

export interface MonitoringHealthCheck {
    key: 'api' | 'database' | 'mt5Sync';
    label: string;
    status: MonitoringHealthStatus;
    detail: string;
    checkedAt: string;
    latencyMs: number | null;
}

export interface MonitoringCandleDistributionItem {
    timeframe: string;
    count: number;
}

export interface MonitoringSymbolFreshnessItem {
    symbol: string;
    timeframe: string;
    indicatorCount: number;
    lastSync: string | null;
    freshnessMinutes: number | null;
    status: MonitoringFreshnessStatus;
}

export interface MonitoringAlertItem {
    id: string;
    source: 'backtest' | 'trade-intent';
    title: string;
    detail: string;
    status: string;
    symbol: string | null;
    timeframe: string | null;
    occurredAt: string;
}

export interface MonitoringTableCounts {
    candles: number;
    signals: number;
    tradeResults: number;
}

export interface MonitoringSnapshot {
    cached: boolean;
    generatedAt: string;
    cacheTtlMs: number;
    health: MonitoringHealthCheck[];
    candleDistribution: MonitoringCandleDistributionItem[];
    activeSymbolFreshness: MonitoringSymbolFreshnessItem[];
    alerts: MonitoringAlertItem[];
    tableCounts: MonitoringTableCounts;
}

interface CacheEntry {
    expiresAt: number;
    value: MonitoringSnapshot;
}

export class MonitoringService {
    private cache: CacheEntry | null = null;

    constructor(
        private readonly prisma: PrismaClient,
        private readonly mt5BridgeClient = new MT5BridgeClient(),
        private readonly now = () => new Date(),
    ) {}

    async healthProbe(): Promise<{
        db: 'ok' | 'failed';
        bridge: 'ok' | 'unreachable';
    }> {
        const checkedAt = this.now().toISOString();
        const [dbCheck, bridgeHealthy] = await Promise.all([
            this.checkDatabaseHealth(checkedAt),
            this.mt5BridgeClient.health().catch(() => false),
        ]);
        return {
            db: dbCheck.status === 'healthy' ? 'ok' : 'failed',
            bridge: bridgeHealthy ? 'ok' : 'unreachable',
        };
    }

    async getSnapshot(): Promise<MonitoringSnapshot> {
        const currentTime = this.now().getTime();
        if (this.cache && this.cache.expiresAt > currentTime) {
            return {
                ...this.cache.value,
                cached: true,
            };
        }

        const fresh = await this.buildSnapshot();
        this.cache = {
            expiresAt: currentTime + CACHE_TTL_MS,
            value: fresh,
        };

        return fresh;
    }

    private async buildSnapshot(): Promise<MonitoringSnapshot> {
        const generatedAtDate = this.now();
        const generatedAt = generatedAtDate.toISOString();

        const [databaseHealth, mt5Health, candleDistribution, activeSymbolFreshness, alerts, tableCounts] = await Promise.all([
            this.checkDatabaseHealth(generatedAt),
            this.checkMt5SyncHealth(generatedAt, generatedAtDate),
            this.loadCandleDistribution(),
            this.loadActiveSymbolFreshness(generatedAtDate),
            this.loadRecentAlerts(),
            this.loadTableCounts(),
        ]);

        return {
            cached: false,
            generatedAt,
            cacheTtlMs: CACHE_TTL_MS,
            health: [
                {
                    key: 'api',
                    label: 'API',
                    status: 'healthy',
                    detail: 'Admin monitoring endpoint is responding.',
                    checkedAt: generatedAt,
                    latencyMs: 0,
                },
                databaseHealth,
                mt5Health,
            ],
            candleDistribution,
            activeSymbolFreshness,
            alerts,
            tableCounts,
        };
    }

    private async checkDatabaseHealth(checkedAt: string): Promise<MonitoringHealthCheck> {
        const startedAt = Date.now();
        try {
            await this.prisma.$queryRawUnsafe('SELECT 1');
            return {
                key: 'database',
                label: 'Database',
                status: 'healthy',
                detail: 'Primary database responded to a lightweight probe.',
                checkedAt,
                latencyMs: Date.now() - startedAt,
            };
        } catch (error) {
            return {
                key: 'database',
                label: 'Database',
                status: 'failed',
                detail: error instanceof Error ? error.message : 'Database health probe failed.',
                checkedAt,
                latencyMs: Date.now() - startedAt,
            };
        }
    }

    private async checkMt5SyncHealth(
        checkedAt: string,
        referenceTime: Date,
    ): Promise<MonitoringHealthCheck> {
        const startedAt = Date.now();
        try {
            const [bridgeHealthy, activeAccounts, latestSyncRun] = await Promise.all([
                this.mt5BridgeClient.health(),
                this.prisma.tradingAccount.findMany({
                    where: {
                        status: 'ACTIVE',
                    },
                    select: {
                        id: true,
                        label: true,
                        lastSuccessfulSyncAt: true,
                    },
                    orderBy: {
                        updatedAt: 'desc',
                    },
                }),
                this.prisma.tradingSyncRun.findFirst({
                    orderBy: {
                        startedAt: 'desc',
                    },
                    select: {
                        accountId: true,
                        status: true,
                        errorMessage: true,
                        account: {
                            select: {
                                label: true,
                            },
                        },
                    },
                }),
            ]);

            if (!bridgeHealthy) {
                return {
                    key: 'mt5Sync',
                    label: 'MT5 Sync',
                    status: 'failed',
                    detail: 'MT5 bridge is unreachable. Realtime sync cannot complete while the bridge is offline.',
                    checkedAt,
                    latencyMs: Date.now() - startedAt,
                };
            }

            if (activeAccounts.length === 0) {
                return {
                    key: 'mt5Sync',
                    label: 'MT5 Sync',
                    status: 'degraded',
                    detail: 'Bridge is healthy, but no active MT5 accounts are connected right now.',
                    checkedAt,
                    latencyMs: Date.now() - startedAt,
                };
            }

            const staleAccounts = activeAccounts.filter((account) => (
                !account.lastSuccessfulSyncAt
                || (referenceTime.getTime() - account.lastSuccessfulSyncAt.getTime()) > MT5_STALE_AFTER_MS
            ));

            if (staleAccounts.length > 0) {
                return {
                    key: 'mt5Sync',
                    label: 'MT5 Sync',
                    status: 'degraded',
                    detail: `${staleAccounts.length} active MT5 account(s) have stale or missing sync timestamps.`,
                    checkedAt,
                    latencyMs: Date.now() - startedAt,
                };
            }

            const activeAccountIds = new Set(activeAccounts.map((account) => account.id));
            if (
                latestSyncRun
                && activeAccountIds.has(latestSyncRun.accountId)
                && (latestSyncRun.status === 'FAILED' || latestSyncRun.status === 'PARTIAL')
            ) {
                return {
                    key: 'mt5Sync',
                    label: 'MT5 Sync',
                    status: 'degraded',
                    detail: latestSyncRun.errorMessage
                        ? `Latest sync for ${latestSyncRun.account.label} reported ${latestSyncRun.status.toLowerCase()}: ${latestSyncRun.errorMessage}`
                        : `Latest sync for ${latestSyncRun.account.label} reported ${latestSyncRun.status.toLowerCase()}.`,
                    checkedAt,
                    latencyMs: Date.now() - startedAt,
                };
            }

            return {
                key: 'mt5Sync',
                label: 'MT5 Sync',
                status: 'healthy',
                detail: `${activeAccounts.length} active MT5 account(s) are syncing within the freshness guardrail.`,
                checkedAt,
                latencyMs: Date.now() - startedAt,
            };
        } catch (error) {
            return {
                key: 'mt5Sync',
                label: 'MT5 Sync',
                status: 'failed',
                detail: error instanceof Error ? error.message : 'MT5 sync health check failed.',
                checkedAt,
                latencyMs: Date.now() - startedAt,
            };
        }
    }

    private async loadCandleDistribution(): Promise<MonitoringCandleDistributionItem[]> {
        const rows = await this.prisma.candle.groupBy({
            by: ['timeframe'],
            _count: {
                _all: true,
            },
            orderBy: {
                timeframe: 'asc',
            },
        });

        return rows.map((row) => ({
            timeframe: row.timeframe,
            count: row._count._all,
        }));
    }

    private async loadActiveSymbolFreshness(referenceTime: Date): Promise<MonitoringSymbolFreshnessItem[]> {
        const activeSymbols = await this.prisma.indicatorInstance.groupBy({
            by: ['symbol', 'timeframe'],
            where: {
                status: 'ACTIVE',
            },
            _count: {
                _all: true,
            },
            orderBy: [
                { symbol: 'asc' },
                { timeframe: 'asc' },
            ],
        });

        const freshnessRows = await Promise.all(
            activeSymbols.map(async (row) => {
                const aggregate = await this.prisma.candle.aggregate({
                    where: {
                        symbol: {
                            in: getMarketSymbolAliases(row.symbol),
                        },
                        timeframe: {
                            in: getTimeframeAliases(row.timeframe),
                        },
                    },
                    _max: {
                        time: true,
                    },
                });

                const lastSync = aggregate._max.time;
                const freshnessMinutes = lastSync
                    ? Math.round((referenceTime.getTime() - lastSync.getTime()) / 60_000)
                    : null;

                const status: MonitoringFreshnessStatus = !lastSync
                    ? 'missing'
                    : freshnessMinutes !== null && freshnessMinutes > 60
                        ? 'stale'
                        : 'fresh';

                return {
                    symbol: row.symbol,
                    timeframe: row.timeframe,
                    indicatorCount: row._count._all,
                    lastSync: lastSync?.toISOString() ?? null,
                    freshnessMinutes,
                    status,
                };
            }),
        );

        return freshnessRows.sort((left, right) => {
            const leftRank = left.status === 'stale' ? 0 : left.status === 'missing' ? 1 : 2;
            const rightRank = right.status === 'stale' ? 0 : right.status === 'missing' ? 1 : 2;
            if (leftRank !== rightRank) {
                return leftRank - rightRank;
            }

            const leftMinutes = left.freshnessMinutes ?? Number.MAX_SAFE_INTEGER;
            const rightMinutes = right.freshnessMinutes ?? Number.MAX_SAFE_INTEGER;
            return rightMinutes - leftMinutes;
        });
    }

    private async loadRecentAlerts(): Promise<MonitoringAlertItem[]> {
        const [failedBacktests, failedTradeIntents] = await Promise.all([
            this.prisma.backtestRun.findMany({
                where: {
                    status: BacktestRunStatus.FAILED,
                },
                select: {
                    id: true,
                    name: true,
                    errorMessage: true,
                    symbol: true,
                    timeframe: true,
                    updatedAt: true,
                },
                orderBy: {
                    updatedAt: 'desc',
                },
                take: RECENT_FAILURE_LIMIT,
            }),
            this.prisma.tradingTradeIntent.findMany({
                where: {
                    status: {
                        in: [TradeIntentStatus.FAILED, TradeIntentStatus.REJECTED],
                    },
                },
                select: {
                    id: true,
                    status: true,
                    statusReason: true,
                    symbol: true,
                    createdAt: true,
                    updatedAt: true,
                    binding: {
                        select: {
                            name: true,
                        },
                    },
                },
                orderBy: {
                    updatedAt: 'desc',
                },
                take: RECENT_FAILURE_LIMIT,
            }),
        ]);

        return [
            ...failedBacktests.map<MonitoringAlertItem>((row) => ({
                id: row.id,
                source: 'backtest',
                title: row.name,
                detail: row.errorMessage ?? 'Backtest run failed without an explicit engine error message.',
                status: 'FAILED',
                symbol: row.symbol,
                timeframe: row.timeframe,
                occurredAt: row.updatedAt.toISOString(),
            })),
            ...failedTradeIntents.map<MonitoringAlertItem>((row) => ({
                id: row.id,
                source: 'trade-intent',
                title: row.binding.name,
                detail: row.statusReason ?? 'Trade intent failed without an explicit broker/runtime reason.',
                status: row.status,
                symbol: row.symbol,
                timeframe: null,
                occurredAt: row.updatedAt.toISOString(),
            })),
        ]
            .sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime())
            .slice(0, RECENT_FAILURE_LIMIT);
    }

    private async loadTableCounts(): Promise<MonitoringTableCounts> {
        const [candles, signals, tradeResults] = await Promise.all([
            this.prisma.candle.count(),
            this.prisma.signal.count(),
            this.prisma.backtestTradeResult.count(),
        ]);

        return {
            candles,
            signals,
            tradeResults,
        };
    }
}
