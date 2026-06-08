import {
    ExecutionCommandStatus,
    ExecutionCommandType,
    Prisma,
    PrismaClient,
} from '@prisma/client';
import {
    BullMqTradingReconciliationJobPublisher,
    TradingReconciliationJobPublisher,
} from '../../queues/tradingReconciliationQueue';
import { TradingAccountAccessScope, TradingAccountActor, TradingAccountService } from './TradingAccountService';
import { MT5BridgeClient, MT5BridgeClientError } from './MT5BridgeClient';
import { createTradingExecutionLogger, TradingExecutionLogger } from './tradingExecutionLogger';
import { TradingWorkspaceService } from './TradingWorkspaceService';

export interface TradingExecutionCommandInput {
    commandType: ExecutionCommandType;
    tradeIntentId?: string | null;
    symbol?: string | null;
    side?: 'LONG' | 'SHORT' | null;
    volume?: number | null;
    price?: number | null;
    stopLoss?: number | null;
    takeProfit?: number | null;
    brokerPositionId?: string | null;
    brokerOrderId?: string | null;
    orderType?: 'MARKET' | 'BUY_LIMIT' | 'SELL_LIMIT' | 'BUY_STOP' | 'SELL_STOP' | null;
    comment?: string | null;
    idempotencyKey?: string | null;
}

export interface TradingExecutionEventView {
    id: string;
    eventType: string;
    occurredAt: string;
    statusBefore: string | null;
    statusAfter: string | null;
    message: string | null;
    payloadJson: Prisma.JsonValue | null;
}

export interface TradingExecutionCommandView {
    id: string;
    accountId: string;
    commandType: string;
    status: string;
    idempotencyKey: string;
    symbol: string | null;
    side: string | null;
    volume: number | null;
    price: number | null;
    stopLoss: number | null;
    takeProfit: number | null;
    brokerPositionId: string | null;
    brokerOrderId: string | null;
    brokerReference: string | null;
    requestedAt: string;
    dispatchedAt: string | null;
    completedAt: string | null;
    reconciledAt: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    events: TradingExecutionEventView[];
}

export interface TradingExecutionCommandOptions {
    skipReconciliation?: boolean;
    retryFailedCommand?: boolean;
}

export class TradingExecutionServiceError extends Error {
    constructor(
        public readonly statusCode: number,
        public readonly code:
            | 'TRADING_COMMAND_INVALID'
            | 'TRADING_COMMAND_NOT_ALLOWED'
            | 'TRADING_COMMAND_FAILED',
        message: string,
        public readonly domain = 'trading.execution',
    ) {
        super(message);
        this.name = 'TradingExecutionServiceError';
    }
}

const MAX_COMMAND_HISTORY_LIMIT = 100;
const RETRYABLE_COMMAND_ERROR_CODES = new Set(['BRIDGE_UNREACHABLE', 'BRIDGE_TRANSPORT_FAILURE']);
const PENDING_ORDER_SIDE_BY_TYPE = {
    BUY_LIMIT: 'LONG',
    SELL_LIMIT: 'SHORT',
    BUY_STOP: 'LONG',
    SELL_STOP: 'SHORT',
} as const;

function derivePendingOrderSide(
    orderType: TradingExecutionCommandInput['orderType'],
): TradingExecutionCommandInput['side'] {
    if (!orderType || !(orderType in PENDING_ORDER_SIDE_BY_TYPE)) {
        return null;
    }

    return PENDING_ORDER_SIDE_BY_TYPE[orderType as keyof typeof PENDING_ORDER_SIDE_BY_TYPE];
}

type TradingExecutionCommandRow = Prisma.TradingExecutionCommandGetPayload<{
    include: {
        events: true;
    };
}>;

const toNumber = (value: Prisma.Decimal | number | string | null | undefined): number | null => {
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

export class TradingExecutionService {
    constructor(
        private readonly prisma: PrismaClient,
        private readonly tradingAccountService: Pick<TradingAccountService, 'getBrokerContext'> = new TradingAccountService(prisma),
        private readonly workspaceService: Pick<TradingWorkspaceService, 'getSummary' | 'forceSync'> = new TradingWorkspaceService(prisma),
        private readonly bridgeClient: MT5BridgeClient = new MT5BridgeClient(),
        private readonly reconciliationPublisher: TradingReconciliationJobPublisher | null = new BullMqTradingReconciliationJobPublisher(),
        private readonly logger: TradingExecutionLogger = createTradingExecutionLogger(),
    ) { }

    async listCommands(
        actor: TradingAccountActor,
        accountId: string,
        { limit = 20 }: { limit?: number } = {},
        scope: TradingAccountAccessScope = {},
    ): Promise<TradingExecutionCommandView[]> {
        await this.tradingAccountService.getBrokerContext(actor, accountId, scope);
        const normalizedLimit = Math.min(Math.max(limit, 1), MAX_COMMAND_HISTORY_LIMIT);
        const rows = await this.prisma.tradingExecutionCommand.findMany({
            where: { accountId },
            include: {
                events: {
                    orderBy: { occurredAt: 'asc' },
                },
            },
            orderBy: { requestedAt: 'desc' },
            take: normalizedLimit,
        });

        return rows.map((row) => this.serializeCommand(row));
    }

    async createCommand(
        actor: TradingAccountActor,
        accountId: string,
        input: TradingExecutionCommandInput,
        options: TradingExecutionCommandOptions = {},
        scope: TradingAccountAccessScope = {},
    ): Promise<TradingExecutionCommandView> {
        const account = await this.tradingAccountService.getBrokerContext(actor, accountId, scope);
        const normalizedInput = this.normalizeInput(input);
        const idempotencyKey = normalizedInput.idempotencyKey?.trim() || `${normalizedInput.commandType}:${accountId}:${Date.now()}`;
        const { skipReconciliation = false, retryFailedCommand = false } = options;

        this.logger.log('info', {
            event: 'command_submission_requested',
            message: 'Trading command submission entered the execution service.',
            actorUserId: actor.id,
            requestedByUserId: actor.id,
            ownerUserId: account.ownerUserId,
            ownerScopeUserId: scope.ownerUserId ?? null,
            accountId,
            accountMode: account.accountMode,
            commandType: normalizedInput.commandType,
            tradeIntentId: normalizedInput.tradeIntentId?.trim() || null,
            symbol: normalizedInput.symbol?.trim() || null,
            side: normalizedInput.side ?? null,
            volume: normalizedInput.volume ?? null,
            price: normalizedInput.price ?? null,
            brokerPositionId: normalizedInput.brokerPositionId?.trim() || null,
            brokerOrderId: normalizedInput.brokerOrderId?.trim() || null,
            idempotencyKey,
            metadata: {
                skipReconciliation,
                retryFailedCommand,
            },
        });

        const existing = await this.prisma.tradingExecutionCommand.findUnique({
            where: { idempotencyKey },
            include: {
                events: {
                    orderBy: { occurredAt: 'asc' },
                },
            },
        });
        if (existing) {
            this.logger.log('info', {
                event: 'command_submission_reused_existing',
                message: 'An existing trading command matched the idempotency key.',
                actorUserId: actor.id,
                requestedByUserId: actor.id,
                ownerUserId: account.ownerUserId,
                ownerScopeUserId: scope.ownerUserId ?? null,
                accountId,
                accountMode: account.accountMode,
                commandId: existing.id,
                commandType: existing.commandType,
                tradeIntentId: existing.tradeIntentId ?? null,
                symbol: existing.symbol ?? null,
                side: existing.side ?? null,
                volume: toNumber(existing.volume),
                price: toNumber(existing.price),
                brokerPositionId: existing.brokerPositionId ?? null,
                brokerOrderId: existing.brokerOrderId ?? null,
                brokerReference: existing.brokerReference ?? null,
                idempotencyKey,
                status: existing.status,
                errorCode: existing.errorCode ?? null,
                errorMessage: existing.errorMessage ?? null,
            });
            if (
                retryFailedCommand
                && existing.status === 'FAILED'
                && RETRYABLE_COMMAND_ERROR_CODES.has(existing.errorCode ?? '')
            ) {
                await this.recordEvent(existing.id, {
                    eventType: 'RETRY_REQUESTED',
                    statusBefore: existing.status,
                    statusAfter: existing.status,
                    message: 'Retrying the command after a transient bridge failure.',
                    payloadJson: null,
                });
                this.logger.log('warn', {
                    event: 'command_submission_retry_requested',
                    message: 'Retrying an existing trading command after a transient bridge failure.',
                    actorUserId: actor.id,
                    requestedByUserId: actor.id,
                    ownerUserId: account.ownerUserId,
                    ownerScopeUserId: scope.ownerUserId ?? null,
                    accountId,
                    accountMode: account.accountMode,
                    commandId: existing.id,
                    commandType: existing.commandType,
                    tradeIntentId: existing.tradeIntentId ?? null,
                    symbol: existing.symbol ?? null,
                    side: existing.side ?? null,
                    volume: toNumber(existing.volume),
                    price: toNumber(existing.price),
                    brokerPositionId: existing.brokerPositionId ?? null,
                    brokerOrderId: existing.brokerOrderId ?? null,
                    brokerReference: existing.brokerReference ?? null,
                    idempotencyKey,
                    status: existing.status,
                    errorCode: existing.errorCode ?? null,
                    errorMessage: existing.errorMessage ?? null,
                });
                return this.executeCommand(
                    actor,
                    account,
                    accountId,
                    normalizedInput,
                    existing.id,
                    { skipReconciliation, scope },
                );
            }

            return this.serializeCommand(existing);
        }

        const command = await this.prisma.tradingExecutionCommand.create({
            data: {
                accountId,
                tradeIntentId: normalizedInput.tradeIntentId?.trim() || null,
                requestedByUserId: actor.id,
                commandType: normalizedInput.commandType,
                status: 'PENDING',
                idempotencyKey,
                symbol: normalizedInput.symbol?.trim() || null,
                side: normalizedInput.side ?? null,
                volume: normalizedInput.volume === null || normalizedInput.volume === undefined ? null : new Prisma.Decimal(normalizedInput.volume),
                price: normalizedInput.price === null || normalizedInput.price === undefined ? null : new Prisma.Decimal(normalizedInput.price),
                stopLoss: normalizedInput.stopLoss === null || normalizedInput.stopLoss === undefined ? null : new Prisma.Decimal(normalizedInput.stopLoss),
                takeProfit: normalizedInput.takeProfit === null || normalizedInput.takeProfit === undefined ? null : new Prisma.Decimal(normalizedInput.takeProfit),
                brokerPositionId: normalizedInput.brokerPositionId?.trim() || null,
                brokerOrderId: normalizedInput.brokerOrderId?.trim() || null,
                payloadJson: {
                    orderType: normalizedInput.orderType ?? null,
                    comment: normalizedInput.comment ?? null,
                },
            },
            include: {
                events: true,
            },
        });

        await this.recordEvent(command.id, {
            eventType: 'REQUESTED',
            statusBefore: null,
            statusAfter: 'PENDING',
            message: 'Command accepted into the approved boundary.',
            payloadJson: command.payloadJson ?? null,
        });
        this.logger.log('info', {
            event: 'command_submission_persisted',
            message: 'Trading command request has been persisted and is ready for execution.',
            actorUserId: actor.id,
            requestedByUserId: actor.id,
            ownerUserId: account.ownerUserId,
            ownerScopeUserId: scope.ownerUserId ?? null,
            accountId,
            accountMode: account.accountMode,
            commandId: command.id,
            commandType: command.commandType,
            tradeIntentId: command.tradeIntentId ?? null,
            symbol: command.symbol ?? null,
            side: command.side ?? null,
            volume: toNumber(command.volume),
            price: toNumber(command.price),
            brokerPositionId: command.brokerPositionId ?? null,
            brokerOrderId: command.brokerOrderId ?? null,
            idempotencyKey,
            status: command.status,
        });

        return this.executeCommand(
            actor,
            account,
            accountId,
            normalizedInput,
            command.id,
            { skipReconciliation, scope },
        );
    }

    private async executeCommand(
        actor: TradingAccountActor,
        account: Awaited<ReturnType<TradingAccountService['getBrokerContext']>>,
        accountId: string,
        input: TradingExecutionCommandInput,
        commandId: string,
        { skipReconciliation, scope }: { skipReconciliation: boolean; scope: TradingAccountAccessScope },
    ): Promise<TradingExecutionCommandView> {
        const validationError = this.validateInput(input);
        if (validationError) {
            await this.transitionCommand(commandId, {
                status: 'REJECTED',
                eventType: 'VALIDATION_REJECTED',
                message: validationError,
                errorCode: 'VALIDATION_REJECTED',
                errorMessage: validationError,
            });
            this.logger.log('warn', {
                event: 'command_validation_rejected',
                message: validationError,
                actorUserId: actor.id,
                requestedByUserId: actor.id,
                ownerUserId: account.ownerUserId,
                ownerScopeUserId: scope.ownerUserId ?? null,
                accountId,
                accountMode: account.accountMode,
                commandId,
                commandType: input.commandType,
                tradeIntentId: input.tradeIntentId?.trim() || null,
                symbol: input.symbol?.trim() || null,
                side: input.side ?? null,
                volume: input.volume ?? null,
                price: input.price ?? null,
                brokerPositionId: input.brokerPositionId?.trim() || null,
                brokerOrderId: input.brokerOrderId?.trim() || null,
                errorCode: 'VALIDATION_REJECTED',
                errorMessage: validationError,
            });
            return this.loadCommand(commandId);
        }

        if (input.commandType !== 'FORCE_SYNC') {
            const summary = await this.workspaceService.getSummary(actor, accountId, scope);
            if (!summary.syncHealth.canTrade || !account.credential) {
                const message = !account.credential
                    ? 'This account is missing an MT5 credential and cannot submit broker actions.'
                    : summary.syncHealth.message;
                const reasonCode = !account.credential
                    ? 'CREDENTIAL_MISSING'
                    : summary.syncHealth.reasonCode ?? 'PRECONDITION_BLOCKED';
                await this.transitionCommand(commandId, {
                    status: 'REJECTED',
                    eventType: 'PRECONDITION_BLOCKED',
                    message,
                    errorCode: reasonCode,
                    errorMessage: message,
                    payloadJson: {
                        reasonCode,
                        syncHealth: summary.syncHealth,
                    },
                });
                this.logger.log('warn', {
                    event: 'command_precondition_blocked',
                    message,
                    actorUserId: actor.id,
                    requestedByUserId: actor.id,
                    ownerUserId: account.ownerUserId,
                    ownerScopeUserId: scope.ownerUserId ?? null,
                    accountId,
                    accountMode: account.accountMode,
                    commandId,
                    commandType: input.commandType,
                    tradeIntentId: input.tradeIntentId?.trim() || null,
                    symbol: input.symbol?.trim() || null,
                    side: input.side ?? null,
                    volume: input.volume ?? null,
                    price: input.price ?? null,
                    brokerPositionId: input.brokerPositionId?.trim() || null,
                    brokerOrderId: input.brokerOrderId?.trim() || null,
                    errorCode: reasonCode,
                    errorMessage: message,
                    metadata: {
                        syncMessage: summary.syncHealth.message,
                        canTrade: summary.syncHealth.canTrade,
                        hasCredential: Boolean(account.credential),
                        reasonCode,
                    },
                });
                return this.loadCommand(commandId);
            }
        }

        await this.transitionCommand(commandId, {
            status: 'VALIDATED',
            eventType: 'VALIDATED',
            message: 'Command payload and account preconditions passed validation.',
            errorCode: null,
            errorMessage: null,
        });
        this.logger.log('info', {
            event: 'command_validated',
            message: 'Trading command payload and account preconditions passed validation.',
            actorUserId: actor.id,
            requestedByUserId: actor.id,
            ownerUserId: account.ownerUserId,
            ownerScopeUserId: scope.ownerUserId ?? null,
            accountId,
            accountMode: account.accountMode,
            commandId,
            commandType: input.commandType,
            tradeIntentId: input.tradeIntentId?.trim() || null,
            symbol: input.symbol?.trim() || null,
            side: input.side ?? null,
            volume: input.volume ?? null,
            price: input.price ?? null,
            brokerPositionId: input.brokerPositionId?.trim() || null,
            brokerOrderId: input.brokerOrderId?.trim() || null,
            status: 'VALIDATED',
        });

        if (input.commandType === 'FORCE_SYNC') {
            await this.transitionCommand(commandId, {
                status: 'DISPATCHED',
                eventType: 'DISPATCHED',
                message: 'Dispatching force-sync through the mirror orchestration lane.',
                errorCode: null,
                errorMessage: null,
            });
            this.logger.log('info', {
                event: 'command_force_sync_dispatched',
                message: 'Trading force-sync command has been dispatched.',
                actorUserId: actor.id,
                requestedByUserId: actor.id,
                ownerUserId: account.ownerUserId,
                ownerScopeUserId: scope.ownerUserId ?? null,
                accountId,
                accountMode: account.accountMode,
                commandId,
                commandType: input.commandType,
                status: 'DISPATCHED',
            });
            try {
                await this.workspaceService.forceSync(actor, accountId, scope);
                await this.transitionCommand(commandId, {
                    status: 'RECONCILED',
                    eventType: 'RECONCILED',
                    message: 'Mirror force-sync completed and broker state has been reconciled.',
                    completed: true,
                    reconciled: true,
                    errorCode: null,
                    errorMessage: null,
                });
                this.logger.log('info', {
                    event: 'command_force_sync_reconciled',
                    message: 'Trading force-sync command completed and reconciled successfully.',
                    actorUserId: actor.id,
                    requestedByUserId: actor.id,
                    ownerUserId: account.ownerUserId,
                    ownerScopeUserId: scope.ownerUserId ?? null,
                    accountId,
                    accountMode: account.accountMode,
                    commandId,
                    commandType: input.commandType,
                    status: 'RECONCILED',
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Force-sync failed.';
                await this.transitionCommand(commandId, {
                    status: 'FAILED',
                    eventType: 'DISPATCH_FAILED',
                    message,
                    errorCode: 'FORCE_SYNC_FAILED',
                    errorMessage: message,
                });
                this.logger.log('error', {
                    event: 'command_force_sync_failed',
                    message,
                    actorUserId: actor.id,
                    requestedByUserId: actor.id,
                    ownerUserId: account.ownerUserId,
                    ownerScopeUserId: scope.ownerUserId ?? null,
                    accountId,
                    accountMode: account.accountMode,
                    commandId,
                    commandType: input.commandType,
                    status: 'FAILED',
                    errorCode: 'FORCE_SYNC_FAILED',
                    errorMessage: message,
                });
            }

            return this.loadCommand(commandId);
        }

        if (!account.credential) {
            await this.transitionCommand(commandId, {
                status: 'REJECTED',
                eventType: 'PRECONDITION_BLOCKED',
                message: 'This account is missing an MT5 credential and cannot submit broker actions.',
                errorCode: 'CREDENTIAL_MISSING',
                errorMessage: 'This account is missing an MT5 credential and cannot submit broker actions.',
            });
            return this.loadCommand(commandId);
        }

        await this.transitionCommand(commandId, {
            status: 'DISPATCHED',
            eventType: 'DISPATCHED',
            message: 'Command dispatched to the MT5 bridge.',
            dispatched: true,
            errorCode: null,
            errorMessage: null,
        });
        this.logger.log('info', {
            event: 'command_bridge_dispatched',
            message: 'Trading command has been dispatched to the MT5 bridge.',
            actorUserId: actor.id,
            requestedByUserId: actor.id,
            ownerUserId: account.ownerUserId,
            ownerScopeUserId: scope.ownerUserId ?? null,
            accountId,
            accountMode: account.accountMode,
            commandId,
            commandType: input.commandType,
            tradeIntentId: input.tradeIntentId?.trim() || null,
            symbol: input.symbol?.trim() || null,
            side: input.side ?? null,
            volume: input.volume ?? null,
            price: input.price ?? null,
            brokerPositionId: input.brokerPositionId?.trim() || null,
            brokerOrderId: input.brokerOrderId?.trim() || null,
            status: 'DISPATCHED',
        });

        try {
            const result = await this.dispatchToBridge(account.credential, input);
            if (!result.accepted) {
                const rejectionCode = result.failure?.code ?? 'BROKER_REJECTED';
                const isTransportFailure = result.failure?.category === 'transport'
                    || rejectionCode === 'BRIDGE_TRANSPORT_FAILURE';
                const rejectionStatus = isTransportFailure ? 'FAILED' : 'REJECTED';
                const rejectionEventType = isTransportFailure ? 'DISPATCH_FAILED' : 'BROKER_REJECTED';
                await this.transitionCommand(commandId, {
                    status: rejectionStatus,
                    eventType: rejectionEventType,
                    message: result.message,
                    errorCode: rejectionCode,
                    errorMessage: result.message,
                    brokerReference: result.brokerReference,
                    brokerPositionId: result.brokerPositionId,
                    brokerOrderId: result.brokerOrderId,
                    payloadJson: result.payload,
                });
                this.logger.log(isTransportFailure ? 'error' : 'warn', {
                    event: isTransportFailure ? 'command_dispatch_failed' : 'command_broker_rejected',
                    message: result.message,
                    actorUserId: actor.id,
                    requestedByUserId: actor.id,
                    ownerUserId: account.ownerUserId,
                    ownerScopeUserId: scope.ownerUserId ?? null,
                    accountId,
                    accountMode: account.accountMode,
                    commandId,
                    commandType: input.commandType,
                    tradeIntentId: input.tradeIntentId?.trim() || null,
                    symbol: input.symbol?.trim() || null,
                    side: input.side ?? null,
                    volume: input.volume ?? null,
                    price: input.price ?? null,
                    brokerPositionId: result.brokerPositionId,
                    brokerOrderId: result.brokerOrderId,
                    brokerReference: result.brokerReference,
                    status: rejectionStatus,
                    errorCode: rejectionCode,
                    errorMessage: result.message,
                    metadata: result.payload ?? undefined,
                });
                return this.loadCommand(commandId);
            }

            await this.transitionCommand(commandId, {
                status: 'COMPLETED',
                eventType: 'BROKER_COMPLETED',
                message: result.message,
                completed: true,
                brokerReference: result.brokerReference,
                brokerPositionId: result.brokerPositionId,
                brokerOrderId: result.brokerOrderId,
                payloadJson: result.payload,
                errorCode: null,
                errorMessage: null,
            });
            this.logger.log('info', {
                event: 'command_broker_completed',
                message: result.message,
                actorUserId: actor.id,
                requestedByUserId: actor.id,
                ownerUserId: account.ownerUserId,
                ownerScopeUserId: scope.ownerUserId ?? null,
                accountId,
                accountMode: account.accountMode,
                commandId,
                commandType: input.commandType,
                tradeIntentId: input.tradeIntentId?.trim() || null,
                symbol: input.symbol?.trim() || null,
                side: input.side ?? null,
                volume: input.volume ?? null,
                price: input.price ?? null,
                brokerPositionId: result.brokerPositionId,
                brokerOrderId: result.brokerOrderId,
                brokerReference: result.brokerReference,
                status: 'COMPLETED',
                metadata: result.payload ?? undefined,
            });

            if (!skipReconciliation) {
                try {
                    await this.workspaceService.forceSync(actor, accountId, scope);
                    await this.transitionCommand(commandId, {
                        status: 'RECONCILED',
                        eventType: 'RECONCILED',
                        message: 'Mirror state refreshed after broker completion.',
                        reconciled: true,
                        errorCode: null,
                        errorMessage: null,
                    });
                    this.logger.log('info', {
                        event: 'command_reconciled_inline',
                        message: 'Trading command completed and the mirror state was reconciled inline.',
                        actorUserId: actor.id,
                        requestedByUserId: actor.id,
                        ownerUserId: account.ownerUserId,
                        ownerScopeUserId: scope.ownerUserId ?? null,
                        accountId,
                        accountMode: account.accountMode,
                        commandId,
                        commandType: input.commandType,
                        tradeIntentId: input.tradeIntentId?.trim() || null,
                        symbol: input.symbol?.trim() || null,
                        side: input.side ?? null,
                        volume: input.volume ?? null,
                        price: input.price ?? null,
                        brokerPositionId: result.brokerPositionId,
                        brokerOrderId: result.brokerOrderId,
                        brokerReference: result.brokerReference,
                        status: 'RECONCILED',
                    });
                } catch (reconcileError) {
                    const message = reconcileError instanceof Error
                        ? reconcileError.message
                        : 'Broker accepted the command, but reconciliation is still pending.';
                    await this.recordEvent(commandId, {
                        eventType: 'RECONCILE_PENDING',
                        statusBefore: 'COMPLETED',
                        statusAfter: 'COMPLETED',
                        message,
                        payloadJson: null,
                    });
                    this.logger.log('warn', {
                        event: 'command_reconciliation_pending',
                        message,
                        actorUserId: actor.id,
                        requestedByUserId: actor.id,
                        ownerUserId: account.ownerUserId,
                        ownerScopeUserId: scope.ownerUserId ?? null,
                        accountId,
                        accountMode: account.accountMode,
                        commandId,
                        commandType: input.commandType,
                        tradeIntentId: input.tradeIntentId?.trim() || null,
                        symbol: input.symbol?.trim() || null,
                        side: input.side ?? null,
                        volume: input.volume ?? null,
                        price: input.price ?? null,
                        brokerPositionId: result.brokerPositionId,
                        brokerOrderId: result.brokerOrderId,
                        brokerReference: result.brokerReference,
                        status: 'COMPLETED',
                    });
                }
            } else {
                await this.deferReconciliation({
                    accountId,
                    actor,
                    account,
                    input,
                    commandId,
                });
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Bridge dispatch failed.';
            const errorCode = error instanceof MT5BridgeClientError ? error.code : 'DISPATCH_FAILED';
            const status = error instanceof MT5BridgeClientError && error.code === 'BRIDGE_UNREACHABLE'
                ? 'FAILED'
                : 'REJECTED';
            await this.transitionCommand(commandId, {
                status,
                eventType: 'DISPATCH_FAILED',
                message,
                errorCode,
                errorMessage: message,
            });
            this.logger.log(status === 'FAILED' ? 'error' : 'warn', {
                event: 'command_dispatch_failed',
                message,
                actorUserId: actor.id,
                requestedByUserId: actor.id,
                ownerUserId: account.ownerUserId,
                ownerScopeUserId: scope.ownerUserId ?? null,
                accountId,
                accountMode: account.accountMode,
                commandId,
                commandType: input.commandType,
                tradeIntentId: input.tradeIntentId?.trim() || null,
                symbol: input.symbol?.trim() || null,
                side: input.side ?? null,
                volume: input.volume ?? null,
                price: input.price ?? null,
                brokerPositionId: input.brokerPositionId?.trim() || null,
                brokerOrderId: input.brokerOrderId?.trim() || null,
                status,
                errorCode,
                errorMessage: message,
            });
        }

        return this.loadCommand(commandId);
    }

    private validateInput(input: TradingExecutionCommandInput): string | null {
        const positiveVolume = input.volume !== null && input.volume !== undefined && input.volume > 0;
        switch (input.commandType) {
            case 'OPEN_MARKET':
                if (!input.symbol?.trim() || !input.side || !positiveVolume) {
                    return 'Open market requires symbol, side, and a positive volume.';
                }
                return null;
            case 'PLACE_PENDING':
                if (!input.symbol?.trim() || !positiveVolume || input.price === null || input.price === undefined || !input.orderType) {
                    return 'Place pending requires symbol, volume, price, and orderType.';
                }
                if (derivePendingOrderSide(input.orderType) === null) {
                    return `Place pending does not support orderType ${input.orderType}.`;
                }
                if (input.side !== derivePendingOrderSide(input.orderType)) {
                    return `Place pending side must match orderType ${input.orderType}.`;
                }
                return null;
            case 'CLOSE_POSITION':
                if (!input.brokerPositionId?.trim()) {
                    return 'Close position requires a brokerPositionId.';
                }
                return null;
            case 'PARTIAL_CLOSE':
                if (!input.brokerPositionId?.trim() || !positiveVolume) {
                    return 'Partial close requires a brokerPositionId and a positive volume.';
                }
                return null;
            case 'MODIFY_POSITION':
                if (!input.brokerPositionId?.trim() || (input.stopLoss === null || input.stopLoss === undefined) && (input.takeProfit === null || input.takeProfit === undefined)) {
                    return 'Modify position requires a brokerPositionId and at least one of stopLoss or takeProfit.';
                }
                return null;
            case 'CANCEL_ORDER':
                if (!input.brokerOrderId?.trim()) {
                    return 'Cancel order requires a brokerOrderId.';
                }
                return null;
            case 'FORCE_SYNC':
                return null;
            default:
                return 'Unsupported command type.';
        }
    }

    private async dispatchToBridge(
        credential: NonNullable<Awaited<ReturnType<TradingAccountService['getBrokerContext']>>['credential']>,
        input: TradingExecutionCommandInput,
    ) {
        const payload: Record<string, unknown> = {
            symbol: input.symbol ?? null,
            side: input.side ?? null,
            volume: input.volume ?? null,
            price: input.price ?? null,
            stopLoss: input.stopLoss ?? null,
            takeProfit: input.takeProfit ?? null,
            brokerPositionId: input.brokerPositionId ?? null,
            brokerOrderId: input.brokerOrderId ?? null,
            orderType: input.orderType ?? null,
            comment: input.comment ?? null,
        };

        switch (input.commandType) {
            case 'OPEN_MARKET':
                return this.bridgeClient.openMarket(credential, payload);
            case 'PLACE_PENDING':
                return this.bridgeClient.placePending(credential, payload);
            case 'CLOSE_POSITION':
                return this.bridgeClient.closePosition(credential, payload);
            case 'PARTIAL_CLOSE':
                return this.bridgeClient.partialClose(credential, payload);
            case 'MODIFY_POSITION':
                return this.bridgeClient.modifyPosition(credential, payload);
            case 'CANCEL_ORDER':
                return this.bridgeClient.cancelOrder(credential, payload);
            default:
                throw new TradingExecutionServiceError(400, 'TRADING_COMMAND_INVALID', 'Unsupported command type.');
        }
    }

    private normalizeInput(input: TradingExecutionCommandInput): TradingExecutionCommandInput {
        if (input.commandType !== 'PLACE_PENDING' || !input.orderType) {
            return input;
        }

        return {
            ...input,
            side: input.side ?? derivePendingOrderSide(input.orderType),
        };
    }

    private async transitionCommand(
        commandId: string,
        {
            status,
            eventType,
            message,
            errorCode,
            errorMessage,
            payloadJson,
            dispatched = false,
            completed = false,
            reconciled = false,
            brokerReference,
            brokerPositionId,
            brokerOrderId,
        }: {
            status: ExecutionCommandStatus;
            eventType: string;
            message: string;
            errorCode?: string | null;
            errorMessage?: string | null;
            payloadJson?: unknown;
            dispatched?: boolean;
            completed?: boolean;
            reconciled?: boolean;
            brokerReference?: string | null;
            brokerPositionId?: string | null;
            brokerOrderId?: string | null;
        },
    ) {
        const current = await this.prisma.tradingExecutionCommand.findUnique({
            where: { id: commandId },
            select: { status: true },
        });

        const updateData: Record<string, unknown> = { status };
        if (errorCode !== undefined) updateData.errorCode = errorCode;
        if (errorMessage !== undefined) updateData.errorMessage = errorMessage;
        if (brokerReference !== undefined) updateData.brokerReference = brokerReference;
        if (brokerPositionId !== undefined) updateData.brokerPositionId = brokerPositionId;
        if (brokerOrderId !== undefined) updateData.brokerOrderId = brokerOrderId;
        if (dispatched) updateData.dispatchedAt = new Date();
        if (completed) updateData.completedAt = new Date();
        if (reconciled) updateData.reconciledAt = new Date();

        await this.prisma.tradingExecutionCommand.update({
            where: { id: commandId },
            data: updateData,
        });

        await this.recordEvent(commandId, {
            eventType,
            statusBefore: current?.status ?? null,
            statusAfter: status,
            message,
            payloadJson: payloadJson ?? null,
        });
    }

    private async deferReconciliation(
        {
            accountId,
            actor,
            account,
            input,
            commandId,
        }: {
            accountId: string;
            actor: TradingAccountActor;
            account: Awaited<ReturnType<TradingAccountService['getBrokerContext']>>;
            input: TradingExecutionCommandInput;
            commandId: string;
        },
    ) {
        if (!this.reconciliationPublisher) {
            await this.recordEvent(commandId, {
                eventType: 'RECONCILE_PENDING',
                statusBefore: 'COMPLETED',
                statusAfter: 'COMPLETED',
                message: 'Broker accepted the command, but no reconciliation publisher is configured.',
                payloadJson: null,
            });
            this.logger.log('warn', {
                event: 'command_reconciliation_deferred_missing_publisher',
                message: 'Broker accepted the command, but no reconciliation publisher is configured.',
                actorUserId: actor.id,
                requestedByUserId: actor.id,
                ownerUserId: account.ownerUserId,
                accountId,
                accountMode: account.accountMode,
                commandId,
                commandType: input.commandType,
                tradeIntentId: input.tradeIntentId?.trim() || null,
                symbol: input.symbol?.trim() || null,
                side: input.side ?? null,
                volume: input.volume ?? null,
                price: input.price ?? null,
                status: 'COMPLETED',
            });
            return;
        }

        try {
            await this.reconciliationPublisher.enqueue({
                accountId,
                requestedByUserId: actor.id,
                sourceCommandId: commandId,
            });
            await this.recordEvent(commandId, {
                eventType: 'RECONCILE_DEFERRED',
                statusBefore: 'COMPLETED',
                statusAfter: 'COMPLETED',
                message: 'Broker accepted the command. Deferred reconciliation has been enqueued.',
                payloadJson: {
                    accountId,
                    sourceCommandId: commandId,
                },
            });
            this.logger.log('info', {
                event: 'command_reconciliation_deferred',
                message: 'Deferred reconciliation has been enqueued for the completed trading command.',
                actorUserId: actor.id,
                requestedByUserId: actor.id,
                ownerUserId: account.ownerUserId,
                accountId,
                accountMode: account.accountMode,
                commandId,
                commandType: input.commandType,
                tradeIntentId: input.tradeIntentId?.trim() || null,
                symbol: input.symbol?.trim() || null,
                side: input.side ?? null,
                volume: input.volume ?? null,
                price: input.price ?? null,
                status: 'COMPLETED',
            });
        } catch (error) {
            const message = error instanceof Error
                ? `Broker accepted the command, but the deferred reconciliation job could not be enqueued: ${error.message}`
                : 'Broker accepted the command, but the deferred reconciliation job could not be enqueued.';
            await this.recordEvent(commandId, {
                eventType: 'RECONCILE_PENDING',
                statusBefore: 'COMPLETED',
                statusAfter: 'COMPLETED',
                message,
                payloadJson: null,
            });
            this.logger.log('warn', {
                event: 'command_reconciliation_enqueue_failed',
                message,
                actorUserId: actor.id,
                requestedByUserId: actor.id,
                ownerUserId: account.ownerUserId,
                accountId,
                accountMode: account.accountMode,
                commandId,
                commandType: input.commandType,
                tradeIntentId: input.tradeIntentId?.trim() || null,
                symbol: input.symbol?.trim() || null,
                side: input.side ?? null,
                volume: input.volume ?? null,
                price: input.price ?? null,
                status: 'COMPLETED',
            });
        }
    }

    private async recordEvent(
        commandId: string,
        {
            eventType,
            statusBefore,
            statusAfter,
            message,
            payloadJson,
        }: {
            eventType: string;
            statusBefore: ExecutionCommandStatus | null;
            statusAfter: ExecutionCommandStatus | null;
            message: string;
            payloadJson: Prisma.JsonValue | null;
        },
    ) {
        await this.prisma.tradingExecutionEvent.create({
            data: {
                commandId,
                eventType,
                statusBefore: statusBefore ?? undefined,
                statusAfter: statusAfter ?? undefined,
                message,
                payloadJson: toInputJson(payloadJson),
            },
        });
    }

    private async loadCommand(commandId: string): Promise<TradingExecutionCommandView> {
        const row = await this.prisma.tradingExecutionCommand.findUniqueOrThrow({
            where: { id: commandId },
            include: {
                events: {
                    orderBy: { occurredAt: 'asc' },
                },
            },
        });

        return this.serializeCommand(row);
    }

    private serializeCommand(
        row: TradingExecutionCommandRow,
    ): TradingExecutionCommandView {
        return {
            id: row.id,
            accountId: row.accountId,
            commandType: row.commandType,
            status: row.status,
            idempotencyKey: row.idempotencyKey,
            symbol: row.symbol ?? null,
            side: row.side ?? null,
            volume: toNumber(row.volume),
            price: toNumber(row.price),
            stopLoss: toNumber(row.stopLoss),
            takeProfit: toNumber(row.takeProfit),
            brokerPositionId: row.brokerPositionId ?? null,
            brokerOrderId: row.brokerOrderId ?? null,
            brokerReference: row.brokerReference ?? null,
            requestedAt: row.requestedAt.toISOString(),
            dispatchedAt: row.dispatchedAt?.toISOString() ?? null,
            completedAt: row.completedAt?.toISOString() ?? null,
            reconciledAt: row.reconciledAt?.toISOString() ?? null,
            errorCode: row.errorCode ?? null,
            errorMessage: row.errorMessage ?? null,
            events: row.events.map((event) => ({
                id: event.id,
                eventType: event.eventType,
                occurredAt: event.occurredAt.toISOString(),
                statusBefore: event.statusBefore ?? null,
                statusAfter: event.statusAfter ?? null,
                message: event.message ?? null,
                payloadJson: event.payloadJson ?? null,
            })),
        };
    }
}
