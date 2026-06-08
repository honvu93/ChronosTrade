import {
    ExecutionCommandStatus,
    Prisma,
    PrismaClient,
    TradingSyncStatus,
} from '@prisma/client';
import {
    evaluateFullStoredAccountReadiness,
    StoredAccountCredentialSource,
} from './TradingAccountReadinessService';
import {
    TradingAccountActor,
    TradingAccountAccessScope,
    TradingAccountBrokerContext,
    TradingAccountService,
} from './TradingAccountService';
import {
    MT5BridgeClient,
    MT5BridgeDealPayload,
    MT5BridgeOrderPayload,
    MT5BridgePositionPayload,
    MT5BridgeSummaryPayload,
} from './MT5BridgeClient';

export type TradingWorkspaceSyncState = 'healthy' | 'stale' | 'disconnected' | 'failed';

export interface TradingWorkspaceSyncHealth {
    state: TradingWorkspaceSyncState;
    label: string;
    message: string;
    reasonCode?: string | null;
    lastSuccessfulSyncAt: string | null;
    lastSyncAttemptAt: string | null;
    staleAfterSeconds: number;
    canForceSync: boolean;
    canTrade: boolean;
}

export interface TradingWorkspaceSummary {
    accountId: string;
    accountLabel: string;
    brokerKind: 'MT5';
    accountMode: 'LIVE' | 'PAPER';
    accountStatus: string;
    mt5Login: string | null;
    mt5Server: string | null;
    baseCurrency: string | null;
    leverage: number | null;
    balance: number;
    equity: number;
    margin: number;
    freeMargin: number;
    marginLevel: number | null;
    unrealizedPnl: number;
    realizedPnlDay: number;
    openPositionCount: number;
    pendingOrderCount: number;
    totalDealCount: number;
    syncHealth: TradingWorkspaceSyncHealth;
    evaluatedAt: string;
}

export interface TradingWorkspacePosition {
    id: string;
    brokerPositionId: string;
    brokerOrderId: string | null;
    symbol: string;
    side: 'LONG' | 'SHORT';
    volume: number;
    openPrice: number;
    stopLoss: number | null;
    takeProfit: number | null;
    currentPrice: number | null;
    swap: number;
    commission: number;
    unrealizedPnl: number;
    openedAt: string;
    closedAt: string | null;
    status: string;
    lastSyncedAt: string;
}

export interface TradingWorkspaceOrder {
    id: string;
    brokerOrderId: string;
    relatedPositionBrokerId: string | null;
    symbol: string;
    side: 'LONG' | 'SHORT';
    orderType: string;
    requestedVolume: number;
    filledVolume: number;
    price: number | null;
    stopLoss: number | null;
    takeProfit: number | null;
    status: string;
    placedAt: string;
    expiresAt: string | null;
    lastSyncedAt: string;
}

export interface TradingWorkspaceDeal {
    id: string;
    brokerDealId: string;
    brokerOrderId: string | null;
    brokerPositionId: string | null;
    symbol: string;
    side: 'LONG' | 'SHORT';
    volume: number;
    price: number;
    commission: number;
    swap: number;
    fee: number;
    realizedPnl: number;
    executedAt: string;
    comment: string | null;
}

export interface TradingWorkspaceDealQuery {
    limit?: number;
    from?: Date;
    to?: Date;
}

export interface TradingWorkspaceSyncRun {
    id: string;
    syncKind: string;
    status: string;
    requestedByUserId: string | null;
    startedAt: string;
    finishedAt: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    summaryJson: Prisma.JsonValue | null;
}

export interface TradingWorkspaceSnapshot {
    summary: TradingWorkspaceSummary;
    positions: TradingWorkspacePosition[];
    orders: TradingWorkspaceOrder[];
    deals: TradingWorkspaceDeal[];
    syncRuns: TradingWorkspaceSyncRun[];
}

export class TradingWorkspaceServiceError extends Error {
    constructor(
        public readonly statusCode: number,
        public readonly code:
            | 'TRADING_ACCOUNT_NOT_READY'
            | 'TRADING_ACCOUNT_CREDENTIALS_MISSING'
            | 'TRADING_SYNC_FAILED',
        message: string,
        public readonly domain = 'trading.workspace',
    ) {
        super(message);
        this.name = 'TradingWorkspaceServiceError';
    }
}

const STALE_AFTER_SECONDS = 300;
const DEFAULT_DEAL_LIMIT = 50;
const DEFAULT_FILTERED_DEAL_LIMIT = 500;
const MAX_DEAL_LIMIT = 500;
const MAX_SYNC_RUN_LIMIT = 100;
const toNumber = (value: Prisma.Decimal | number | string | null | undefined): number => {
    if (value === null || value === undefined) {
        return 0;
    }

    return Number(value);
};

const toNullableNumber = (value: Prisma.Decimal | number | string | null | undefined): number | null => {
    if (value === null || value === undefined) {
        return null;
    }

    return Number(value);
};

const toInputJson = (value: unknown): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined => {
    if (value === undefined) {
        return undefined;
    }

    if (value === null) {
        return Prisma.JsonNull;
    }

    return value as Prisma.InputJsonValue;
};

function deriveSyncHealth({
    readiness,
    account,
    latestRun,
}: {
    readiness: Awaited<ReturnType<typeof evaluateFullStoredAccountReadiness>>;
    account: TradingAccountBrokerContext;
    latestRun: {
        status: TradingSyncStatus;
        startedAt: Date;
        finishedAt: Date | null;
        errorMessage: string | null;
    } | null;
}): TradingWorkspaceSyncHealth {
    const lastSuccessfulSyncAt = account.lastSuccessfulSyncAt;
    const lastSyncAttemptAt = latestRun?.startedAt.toISOString() ?? null;
    const canForceSync = readiness.hasStoredCredential && readiness.state !== 'credentials-partial';
    const isPaper = account.accountMode === 'PAPER';

    if (readiness.state === 'bridge-unreachable' || account.status === 'DISCONNECTED') {
        return {
            state: 'disconnected',
            label: 'Disconnected',
            message: readiness.blockingReasons[0] ?? (isPaper
                ? 'MT5 bridge is not reachable for this paper/demo account.'
                : 'MT5 bridge is not reachable for this account.'),
            reasonCode: readiness.executionFailureCode,
            lastSuccessfulSyncAt,
            lastSyncAttemptAt,
            staleAfterSeconds: STALE_AFTER_SECONDS,
            canForceSync,
            canTrade: false,
        };
    }

    if (readiness.state === 'execution-blocked') {
        return {
            state: 'failed',
            label: 'Terminal blocked',
            message: readiness.executionReadinessMessage
                ?? readiness.blockingReasons[0]
                ?? 'The MT5 execution terminal is blocking trading requests.',
            reasonCode: readiness.executionFailureCode,
            lastSuccessfulSyncAt,
            lastSyncAttemptAt,
            staleAfterSeconds: STALE_AFTER_SECONDS,
            canForceSync,
            canTrade: false,
        };
    }

    if (!lastSuccessfulSyncAt) {
        return {
            state: 'disconnected',
            label: 'No mirror',
            message: isPaper
                ? 'No successful demo account mirror exists yet. Run a sync before trusting paper broker state.'
                : 'No successful account mirror exists yet. Run a sync before trusting broker state.',
            reasonCode: readiness.executionFailureCode,
            lastSuccessfulSyncAt,
            lastSyncAttemptAt,
            staleAfterSeconds: STALE_AFTER_SECONDS,
            canForceSync,
            canTrade: false,
        };
    }

    if (latestRun && (latestRun.status === 'FAILED' || latestRun.status === 'PARTIAL')) {
        return {
            state: 'failed',
            label: latestRun.status === 'PARTIAL' ? 'Partial sync' : 'Sync failed',
            message: latestRun.errorMessage ?? 'The latest sync attempt did not reconcile every broker surface.',
            reasonCode: readiness.executionFailureCode,
            lastSuccessfulSyncAt,
            lastSyncAttemptAt,
            staleAfterSeconds: STALE_AFTER_SECONDS,
            canForceSync,
            canTrade: false,
        };
    }

    const ageMs = Date.now() - new Date(lastSuccessfulSyncAt).getTime();
    if (ageMs > STALE_AFTER_SECONDS * 1000) {
        return {
            state: 'stale',
            label: 'Stale',
            message: isPaper
                ? 'Demo mirror data is older than the freshness threshold. Monitoring remains available, but paper actions stay blocked until refreshed.'
                : 'Mirror data is older than the freshness threshold. Monitoring remains available, but manual actions stay blocked.',
            reasonCode: readiness.executionFailureCode,
            lastSuccessfulSyncAt,
            lastSyncAttemptAt,
            staleAfterSeconds: STALE_AFTER_SECONDS,
            canForceSync,
            canTrade: false,
        };
    }

    return {
        state: 'healthy',
        label: 'Healthy',
        message: isPaper
            ? 'Demo mirror state is current enough for monitoring and paper broker interaction.'
            : 'Mirror state is current enough for monitoring and broker interaction.',
        reasonCode: readiness.executionFailureCode,
        lastSuccessfulSyncAt,
        lastSyncAttemptAt,
        staleAfterSeconds: STALE_AFTER_SECONDS,
        canForceSync,
        canTrade: readiness.state === 'ready',
    };
}

function asStoredCredential(account: TradingAccountBrokerContext): StoredAccountCredentialSource | null {
    if (!account.credential) {
        return null;
    }

    return {
        accountId: account.id,
        accountLabel: account.label,
        accountMode: account.accountMode,
        mt5Login: account.credential.mt5Login,
        mt5Password: account.credential.mt5Password,
        mt5Server: account.credential.mt5Server,
    };
}

export class TradingWorkspaceService {
    constructor(
        private readonly prisma: PrismaClient,
        private readonly tradingAccountService: Pick<TradingAccountService, 'getBrokerContext'> = new TradingAccountService(prisma),
        private readonly bridgeClient: MT5BridgeClient = new MT5BridgeClient(),
        private readonly env: NodeJS.ProcessEnv = process.env,
    ) {}

    async getWorkspace(
        actor: TradingAccountActor,
        accountId: string,
        scope: TradingAccountAccessScope = {},
    ): Promise<TradingWorkspaceSnapshot> {
        const [summary, positions, orders, deals, syncRuns] = await Promise.all([
            this.getSummary(actor, accountId, scope),
            this.listPositions(actor, accountId, scope),
            this.listOrders(actor, accountId, scope),
            this.listDeals(actor, accountId, undefined, scope),
            this.listSyncRuns(actor, accountId, undefined, scope),
        ]);

        return {
            summary,
            positions,
            orders,
            deals,
            syncRuns,
        };
    }

    async getSummary(
        actor: TradingAccountActor,
        accountId: string,
        scope: TradingAccountAccessScope = {},
    ): Promise<TradingWorkspaceSummary> {
        const account = await this.tradingAccountService.getBrokerContext(actor, accountId, scope);
        const [latestSnapshot, latestRun, openPositionCount, pendingOrderCount, totalDealCount] = await Promise.all([
            this.prisma.tradingAccountSnapshot.findFirst({
                where: { accountId },
                orderBy: { capturedAt: 'desc' },
            }),
            this.prisma.tradingSyncRun.findFirst({
                where: { accountId },
                orderBy: { startedAt: 'desc' },
            }),
            this.prisma.tradingPosition.count({
                where: { accountId, status: 'OPEN' },
            }),
            this.prisma.tradingOrder.count({
                where: {
                    accountId,
                    status: {
                        in: ['PENDING', 'PLACED', 'PARTIALLY_FILLED'],
                    },
                },
            }),
            this.prisma.tradingDeal.count({
                where: { accountId },
            }),
        ]);

        const readiness = await evaluateFullStoredAccountReadiness(asStoredCredential(account), this.env);
        const syncHealth = deriveSyncHealth({
            readiness,
            account,
            latestRun,
        });

        return {
            accountId: account.id,
            accountLabel: account.label,
            brokerKind: account.brokerKind,
            accountMode: account.accountMode,
            accountStatus: account.status,
            mt5Login: account.credential?.mt5Login ?? null,
            mt5Server: account.credential?.mt5Server ?? null,
            baseCurrency: account.baseCurrency ?? null,
            leverage: account.leverage ?? null,
            balance: toNumber(latestSnapshot?.balance),
            equity: toNumber(latestSnapshot?.equity),
            margin: toNumber(latestSnapshot?.margin),
            freeMargin: toNumber(latestSnapshot?.freeMargin),
            marginLevel: toNullableNumber(latestSnapshot?.marginLevel),
            unrealizedPnl: toNumber(latestSnapshot?.unrealizedPnl),
            realizedPnlDay: toNumber(latestSnapshot?.realizedPnlDay),
            openPositionCount,
            pendingOrderCount,
            totalDealCount,
            syncHealth,
            evaluatedAt: new Date().toISOString(),
        };
    }

    async listPositions(
        actor: TradingAccountActor,
        accountId: string,
        scope: TradingAccountAccessScope = {},
    ): Promise<TradingWorkspacePosition[]> {
        await this.tradingAccountService.getBrokerContext(actor, accountId, scope);
        const rows = await this.prisma.tradingPosition.findMany({
            where: { accountId },
            orderBy: [
                { status: 'asc' },
                { openedAt: 'desc' },
            ],
        });

        return rows.map((row) => ({
            id: row.id,
            brokerPositionId: row.brokerPositionId,
            brokerOrderId: row.brokerOrderId,
            symbol: row.symbol,
            side: row.side,
            volume: toNumber(row.volume),
            openPrice: toNumber(row.openPrice),
            stopLoss: toNullableNumber(row.stopLoss),
            takeProfit: toNullableNumber(row.takeProfit),
            currentPrice: toNullableNumber(row.currentPrice),
            swap: toNumber(row.swap),
            commission: toNumber(row.commission),
            unrealizedPnl: toNumber(row.unrealizedPnl),
            openedAt: row.openedAt.toISOString(),
            closedAt: row.closedAt?.toISOString() ?? null,
            status: row.status,
            lastSyncedAt: row.lastSyncedAt.toISOString(),
        }));
    }

    async listOrders(
        actor: TradingAccountActor,
        accountId: string,
        scope: TradingAccountAccessScope = {},
    ): Promise<TradingWorkspaceOrder[]> {
        await this.tradingAccountService.getBrokerContext(actor, accountId, scope);
        const rows = await this.prisma.tradingOrder.findMany({
            where: { accountId },
            orderBy: [
                { placedAt: 'desc' },
                { updatedAt: 'desc' },
            ],
        });

        return rows.map((row) => ({
            id: row.id,
            brokerOrderId: row.brokerOrderId,
            relatedPositionBrokerId: row.relatedPositionBrokerId,
            symbol: row.symbol,
            side: row.side,
            orderType: row.orderType,
            requestedVolume: toNumber(row.requestedVolume),
            filledVolume: toNumber(row.filledVolume),
            price: toNullableNumber(row.price),
            stopLoss: toNullableNumber(row.stopLoss),
            takeProfit: toNullableNumber(row.takeProfit),
            status: row.status,
            placedAt: row.placedAt.toISOString(),
            expiresAt: row.expiresAt?.toISOString() ?? null,
            lastSyncedAt: row.lastSyncedAt.toISOString(),
        }));
    }

    async listDeals(
        actor: TradingAccountActor,
        accountId: string,
        query: TradingWorkspaceDealQuery = {},
        scope: TradingAccountAccessScope = {},
    ): Promise<TradingWorkspaceDeal[]> {
        await this.tradingAccountService.getBrokerContext(actor, accountId, scope);
        const hasExplicitRange = Boolean(query.from || query.to);
        const requestedLimit = query.limit ?? (hasExplicitRange ? DEFAULT_FILTERED_DEAL_LIMIT : DEFAULT_DEAL_LIMIT);
        const take = Math.min(Math.max(requestedLimit, 1), MAX_DEAL_LIMIT);
        const rows = await this.prisma.tradingDeal.findMany({
            where: {
                accountId,
                ...(query.from || query.to
                    ? {
                        executedAt: {
                            ...(query.from ? { gte: query.from } : {}),
                            ...(query.to ? { lte: query.to } : {}),
                        },
                    }
                    : {}),
            },
            orderBy: { executedAt: 'desc' },
            ...(take ? { take } : {}),
        });

        return rows.map((row) => ({
            id: row.id,
            brokerDealId: row.brokerDealId,
            brokerOrderId: row.brokerOrderId,
            brokerPositionId: row.brokerPositionId,
            symbol: row.symbol,
            side: row.side,
            volume: toNumber(row.volume),
            price: toNumber(row.price),
            commission: toNumber(row.commission),
            swap: toNumber(row.swap),
            fee: toNumber(row.fee),
            realizedPnl: toNumber(row.realizedPnl),
            executedAt: row.executedAt.toISOString(),
            comment: row.comment ?? null,
        }));
    }

    async listSyncRuns(
        actor: TradingAccountActor,
        accountId: string,
        { limit = 12 }: { limit?: number } = {},
        scope: TradingAccountAccessScope = {},
    ): Promise<TradingWorkspaceSyncRun[]> {
        await this.tradingAccountService.getBrokerContext(actor, accountId, scope);
        const normalizedLimit = Math.min(Math.max(limit, 1), MAX_SYNC_RUN_LIMIT);
        const rows = await this.prisma.tradingSyncRun.findMany({
            where: { accountId },
            orderBy: { startedAt: 'desc' },
            take: normalizedLimit,
        });

        return rows.map((row) => ({
            id: row.id,
            syncKind: row.syncKind,
            status: row.status,
            requestedByUserId: row.requestedByUserId ?? null,
            startedAt: row.startedAt.toISOString(),
            finishedAt: row.finishedAt?.toISOString() ?? null,
            errorCode: row.errorCode ?? null,
            errorMessage: row.errorMessage ?? null,
            summaryJson: row.summaryJson ?? null,
        }));
    }

    async forceSync(
        actor: TradingAccountActor,
        accountId: string,
        scope: TradingAccountAccessScope = {},
    ): Promise<TradingWorkspaceSnapshot> {
        const account = await this.tradingAccountService.getBrokerContext(actor, accountId, scope);
        if (!account.credential) {
            throw new TradingWorkspaceServiceError(
                409,
                'TRADING_ACCOUNT_CREDENTIALS_MISSING',
                'The MT5 credential is missing for this account.',
            );
        }

        const syncRun = await this.prisma.tradingSyncRun.create({
            data: {
                accountId,
                syncKind: 'FULL',
                status: 'RUNNING',
                requestedByUserId: actor.id,
            },
        });

        try {
            const summary = await this.bridgeClient.fetchSummary(account.credential);
            const [positionsResult, ordersResult, dealsResult] = await Promise.allSettled([
                this.bridgeClient.fetchPositions(account.credential),
                this.bridgeClient.fetchOrders(account.credential),
                this.bridgeClient.fetchDeals(account.credential, { limit: 200 }),
            ]);

            const syncStatus: TradingSyncStatus = [
                positionsResult,
                ordersResult,
                dealsResult,
            ].some((result) => result.status === 'rejected')
                ? 'PARTIAL'
                : 'SUCCEEDED';

            await this.persistSummary(accountId, summary, syncStatus);

            if (positionsResult.status === 'fulfilled') {
                await this.persistPositions(accountId, positionsResult.value);
            }

            if (ordersResult.status === 'fulfilled') {
                await this.persistOrders(accountId, ordersResult.value);
            }

            if (dealsResult.status === 'fulfilled') {
                await this.persistDeals(accountId, dealsResult.value);
            }

            const errorMessage = [positionsResult, ordersResult, dealsResult]
                .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
                .map((result) => result.reason instanceof Error ? result.reason.message : 'Unknown bridge failure')
                .join(' | ') || null;

            await this.prisma.tradingSyncRun.update({
                where: { id: syncRun.id },
                data: {
                    status: syncStatus,
                    finishedAt: new Date(),
                    errorMessage,
                    summaryJson: {
                        positions: positionsResult.status === 'fulfilled' ? positionsResult.value.length : null,
                        orders: ordersResult.status === 'fulfilled' ? ordersResult.value.length : null,
                        deals: dealsResult.status === 'fulfilled' ? dealsResult.value.length : null,
                    },
                },
            });

            return this.getWorkspace(actor, accountId, scope);
        } catch (error) {
            await this.prisma.tradingSyncRun.update({
                where: { id: syncRun.id },
                data: {
                    status: 'FAILED',
                    finishedAt: new Date(),
                    errorMessage: error instanceof Error ? error.message : 'Bridge sync failed.',
                },
            });
            await this.prisma.tradingAccount.update({
                where: { id: accountId },
                data: {
                    status: 'ERROR',
                },
            });

            throw new TradingWorkspaceServiceError(
                502,
                'TRADING_SYNC_FAILED',
                error instanceof Error ? error.message : 'Failed to sync the MT5 account mirror.',
            );
        }
    }

    private async persistSummary(
        accountId: string,
        summary: MT5BridgeSummaryPayload,
        syncStatus: TradingSyncStatus,
    ) {
        const now = new Date();
        await this.prisma.$transaction([
            this.prisma.tradingAccount.update({
                where: { id: accountId },
                data: {
                    status: syncStatus === 'SUCCEEDED' ? 'ACTIVE' : 'ERROR',
                    baseCurrency: summary.currency ?? null,
                    leverage: summary.leverage ?? null,
                    lastSeenAt: summary.brokerTime ? new Date(summary.brokerTime) : now,
                    lastSuccessfulSyncAt: now,
                    metadataJson: toInputJson(summary.rawBrokerJson),
                },
            }),
            this.prisma.tradingAccountSnapshot.create({
                data: {
                    accountId,
                    capturedAt: now,
                    balance: new Prisma.Decimal(summary.balance),
                    equity: new Prisma.Decimal(summary.equity),
                    margin: new Prisma.Decimal(summary.margin),
                    freeMargin: new Prisma.Decimal(summary.freeMargin),
                    marginLevel: summary.marginLevel === null ? null : new Prisma.Decimal(summary.marginLevel),
                    unrealizedPnl: new Prisma.Decimal(summary.unrealizedPnl),
                    realizedPnlDay: new Prisma.Decimal(summary.realizedPnlDay),
                    metadataJson: toInputJson(summary.rawBrokerJson),
                },
            }),
        ]);
    }

    private async persistPositions(accountId: string, positions: MT5BridgePositionPayload[]) {
        const now = new Date();
        const seenIds = positions.map((position) => position.brokerPositionId);

        if (seenIds.length > 0) {
            await this.prisma.tradingPosition.updateMany({
                where: {
                    accountId,
                    status: 'OPEN',
                    brokerPositionId: {
                        notIn: seenIds,
                    },
                },
                data: {
                    status: 'CLOSED',
                    closedAt: now,
                    lastSyncedAt: now,
                },
            });
        } else {
            await this.prisma.tradingPosition.updateMany({
                where: {
                    accountId,
                    status: 'OPEN',
                },
                data: {
                    status: 'CLOSED',
                    closedAt: now,
                    lastSyncedAt: now,
                },
            });
        }

        await this.prisma.$transaction(
            positions.map((position) =>
                this.prisma.tradingPosition.upsert({
                    where: {
                        accountId_brokerPositionId: {
                            accountId,
                            brokerPositionId: position.brokerPositionId,
                        },
                    },
                    update: {
                        brokerOrderId: position.brokerOrderId,
                        symbol: position.symbol,
                        side: position.side,
                        volume: new Prisma.Decimal(position.volume),
                        openPrice: new Prisma.Decimal(position.openPrice),
                        stopLoss: position.stopLoss === null ? null : new Prisma.Decimal(position.stopLoss),
                        takeProfit: position.takeProfit === null ? null : new Prisma.Decimal(position.takeProfit),
                        currentPrice: position.currentPrice === null ? null : new Prisma.Decimal(position.currentPrice),
                        swap: new Prisma.Decimal(position.swap),
                        commission: new Prisma.Decimal(position.commission),
                        unrealizedPnl: new Prisma.Decimal(position.unrealizedPnl),
                        openedAt: new Date(position.openedAt),
                        status: 'OPEN',
                        lastSyncedAt: now,
                        rawBrokerJson: toInputJson(position.rawBrokerJson),
                    },
                    create: {
                        accountId,
                        brokerPositionId: position.brokerPositionId,
                        brokerOrderId: position.brokerOrderId,
                        symbol: position.symbol,
                        side: position.side,
                        volume: new Prisma.Decimal(position.volume),
                        openPrice: new Prisma.Decimal(position.openPrice),
                        stopLoss: position.stopLoss === null ? null : new Prisma.Decimal(position.stopLoss),
                        takeProfit: position.takeProfit === null ? null : new Prisma.Decimal(position.takeProfit),
                        currentPrice: position.currentPrice === null ? null : new Prisma.Decimal(position.currentPrice),
                        swap: new Prisma.Decimal(position.swap),
                        commission: new Prisma.Decimal(position.commission),
                        unrealizedPnl: new Prisma.Decimal(position.unrealizedPnl),
                        openedAt: new Date(position.openedAt),
                        status: 'OPEN',
                        lastSyncedAt: now,
                        rawBrokerJson: toInputJson(position.rawBrokerJson),
                    },
                }),
            ),
        );
    }

    private async persistOrders(accountId: string, orders: MT5BridgeOrderPayload[]) {
        const seenIds = orders.map((order) => order.brokerOrderId);
        const now = new Date();

        if (seenIds.length > 0) {
            await this.prisma.tradingOrder.updateMany({
                where: {
                    accountId,
                    status: { in: ['PENDING', 'PLACED', 'PARTIALLY_FILLED'] },
                    brokerOrderId: { notIn: seenIds },
                },
                data: { status: 'EXPIRED', lastSyncedAt: now },
            });
        } else {
            await this.prisma.tradingOrder.updateMany({
                where: {
                    accountId,
                    status: { in: ['PENDING', 'PLACED', 'PARTIALLY_FILLED'] },
                },
                data: { status: 'EXPIRED', lastSyncedAt: now },
            });
        }
        await this.prisma.$transaction(
            orders.map((order) =>
                this.prisma.tradingOrder.upsert({
                    where: {
                        accountId_brokerOrderId: {
                            accountId,
                            brokerOrderId: order.brokerOrderId,
                        },
                    },
                    update: {
                        relatedPositionBrokerId: order.relatedPositionBrokerId,
                        symbol: order.symbol,
                        side: order.side,
                        orderType: order.orderType,
                        requestedVolume: new Prisma.Decimal(order.requestedVolume),
                        filledVolume: new Prisma.Decimal(order.filledVolume),
                        price: order.price === null ? null : new Prisma.Decimal(order.price),
                        stopLoss: order.stopLoss === null ? null : new Prisma.Decimal(order.stopLoss),
                        takeProfit: order.takeProfit === null ? null : new Prisma.Decimal(order.takeProfit),
                        status: order.status,
                        placedAt: new Date(order.placedAt),
                        expiresAt: order.expiresAt ? new Date(order.expiresAt) : null,
                        lastSyncedAt: now,
                        rawBrokerJson: toInputJson(order.rawBrokerJson),
                    },
                    create: {
                        accountId,
                        brokerOrderId: order.brokerOrderId,
                        relatedPositionBrokerId: order.relatedPositionBrokerId,
                        symbol: order.symbol,
                        side: order.side,
                        orderType: order.orderType,
                        requestedVolume: new Prisma.Decimal(order.requestedVolume),
                        filledVolume: new Prisma.Decimal(order.filledVolume),
                        price: order.price === null ? null : new Prisma.Decimal(order.price),
                        stopLoss: order.stopLoss === null ? null : new Prisma.Decimal(order.stopLoss),
                        takeProfit: order.takeProfit === null ? null : new Prisma.Decimal(order.takeProfit),
                        status: order.status,
                        placedAt: new Date(order.placedAt),
                        expiresAt: order.expiresAt ? new Date(order.expiresAt) : null,
                        lastSyncedAt: now,
                        rawBrokerJson: toInputJson(order.rawBrokerJson),
                    },
                }),
            ),
        );
    }

    private async persistDeals(accountId: string, deals: MT5BridgeDealPayload[]) {
        if (deals.length === 0) return;

        await this.prisma.$transaction(
            deals.map((deal) =>
                this.prisma.tradingDeal.upsert({
                    where: {
                        accountId_brokerDealId: {
                            accountId,
                            brokerDealId: deal.brokerDealId,
                        },
                    },
                    update: {
                        brokerOrderId: deal.brokerOrderId,
                        brokerPositionId: deal.brokerPositionId,
                        symbol: deal.symbol,
                        side: deal.side,
                        volume: new Prisma.Decimal(deal.volume),
                        price: new Prisma.Decimal(deal.price),
                        commission: new Prisma.Decimal(deal.commission),
                        swap: new Prisma.Decimal(deal.swap),
                        fee: new Prisma.Decimal(deal.fee),
                        realizedPnl: new Prisma.Decimal(deal.realizedPnl),
                        executedAt: new Date(deal.executedAt),
                        comment: deal.comment,
                        rawBrokerJson: toInputJson(deal.rawBrokerJson),
                    },
                    create: {
                        accountId,
                        brokerDealId: deal.brokerDealId,
                        brokerOrderId: deal.brokerOrderId,
                        brokerPositionId: deal.brokerPositionId,
                        symbol: deal.symbol,
                        side: deal.side,
                        volume: new Prisma.Decimal(deal.volume),
                        price: new Prisma.Decimal(deal.price),
                        commission: new Prisma.Decimal(deal.commission),
                        swap: new Prisma.Decimal(deal.swap),
                        fee: new Prisma.Decimal(deal.fee),
                        realizedPnl: new Prisma.Decimal(deal.realizedPnl),
                        executedAt: new Date(deal.executedAt),
                        comment: deal.comment,
                        rawBrokerJson: toInputJson(deal.rawBrokerJson),
                    },
                }),
            ),
        );
    }
}
