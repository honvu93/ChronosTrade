import { SignalLiveEligibilityItem, SignalEligibilityState } from '../SignalLiveEligibilityService';

export type ExternalDeploymentStatus =
    | 'DRAFT'
    | 'ACTIVE'
    | 'PAUSED'
    | 'AUTO_PAUSED'
    | 'ARCHIVED';

export type ExternalActionEventStatus =
    | 'READY'
    | 'SENT'
    | 'FAILED'
    | 'CANCELED';

export type ExternalActionDeliveryStatus =
    | 'PENDING'
    | 'SENT'
    | 'FAILED';

export type ExternalActionReplayStatus =
    | 'QUEUED'
    | 'PROCESSING'
    | 'COMPLETED'
    | 'FAILED';

export type ExternalActionReplayKind =
    | 'MANUAL_RETRY'
    | 'AUTOMATIC_RETRY'
    | 'BACKFILL_REPLAY';

export type ExternalActionability =
    | 'ACTIONABLE'
    | 'CANCELED'
    | 'EXPIRED'
    | 'SUPERSEDED'
    | 'ADVISORY';

export type ExternalActionType = 'OPEN_MARKET';
export type ExternalActionEventType = 'ENTRY';
export type ExternalEntryType = 'MARKET';
export type ExternalChannelKind = 'TELEGRAM';

export interface ExternalActionActor {
    id: string;
    role: 'ADMIN' | 'USER';
}

export interface ExternalActionAccessScope {
    ownerUserId?: string | null;
}

export interface ActionableSignalEventContractV1 {
    contractKind: 'actionable-signal-event';
    contractVersion: 1;
    eventId: string;
    emittedAt: string;
    actionability: ExternalActionability;
    actionType: ExternalActionType;
    source: {
        signalCode: string;
        signalVersion: number;
        indicatorInstanceId: string;
        sourceBacktestRunId: string | null;
        externalDeploymentId: string;
        eligibilityState: SignalEligibilityState | 'unknown';
    };
    market: {
        symbol: string;
        timeframe: string;
        side: 'LONG' | 'SHORT';
        candleTime: string;
        referencePrice: number | null;
    };
    execution: {
        entryPrice: number | null;
        entryType: ExternalEntryType;
        stopLoss: number | null;
        takeProfit1: number | null;
        takeProfit2: number | null;
        suggestedVolume: number | null;
    };
    trace: {
        internalSignalEventId: string;
        signalKey: string;
    };
}

export interface ExternalDeploymentRecord {
    id: string;
    ownerUserId: string;
    indicatorInstanceId: string;
    signalCode: string;
    signalVersion: number;
    sourceBacktestRunId: string | null;
    status: ExternalDeploymentStatus;
    statusReason: string | null;
    eligibilityStateSnapshot: string | null;
    telegramBotLabel: string | null;
    telegramBotTokenCiphertext: string;
    telegramChatId: string;
    telegramChatLabel: string | null;
    messageTemplateKind: string;
    createdByUserId: string | null;
    enabledByUserId: string | null;
    pausedByUserId: string | null;
    archivedByUserId: string | null;
    enabledAt: string | null;
    pausedAt: string | null;
    archivedAt: string | null;
    lastEligibilityCheckAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface ExternalDeploymentView {
    id: string;
    ownerUserId: string;
    indicatorInstanceId: string;
    signalCode: string;
    signalVersion: number;
    sourceBacktestRunId: string | null;
    status: ExternalDeploymentStatus;
    statusReason: string | null;
    eligibilityStateSnapshot: string | null;
    telegramBotLabel: string | null;
    hasTelegramBotToken: boolean;
    telegramChatId: string;
    telegramChatLabel: string | null;
    messageTemplateKind: string;
    createdByUserId: string | null;
    enabledByUserId: string | null;
    pausedByUserId: string | null;
    archivedByUserId: string | null;
    enabledAt: string | null;
    pausedAt: string | null;
    archivedAt: string | null;
    lastEligibilityCheckAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface ExternalActionEventRecord {
    id: string;
    externalDeploymentId: string;
    internalSignalEventId: string;
    idempotencyKey: string;
    contractKind: 'actionable-signal-event';
    contractVersion: 1;
    eventType: ExternalActionEventType;
    actionability: ExternalActionability;
    actionType: ExternalActionType;
    signalCode: string;
    signalVersion: number;
    indicatorInstanceId: string;
    sourceBacktestRunId: string | null;
    symbol: string;
    timeframe: string;
    side: 'LONG' | 'SHORT';
    candleTime: string;
    referencePrice: number | null;
    entryPrice: number | null;
    entryType: ExternalEntryType;
    stopLoss: number | null;
    takeProfit1: number | null;
    takeProfit2: number | null;
    suggestedVolume: number | null;
    payload: ActionableSignalEventContractV1;
    status: ExternalActionEventStatus;
    statusReason: string | null;
    emittedAt: string;
    expiresAt: string | null;
    supersedesEventId: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface ExternalActionEventWithDeployment extends ExternalActionEventRecord {
    deployment: ExternalDeploymentRecord;
}

export interface ExternalActionDeliveryRecord {
    id: string;
    externalActionEventId: string;
    externalDeploymentId: string;
    channelKind: ExternalChannelKind;
    attemptNumber: number;
    status: ExternalActionDeliveryStatus;
    providerMessageId: string | null;
    providerChatId: string | null;
    requestFingerprint: string | null;
    requestJson: Record<string, unknown> | null;
    responseJson: Record<string, unknown> | null;
    errorCode: string | null;
    errorMessage: string | null;
    attemptedAt: string;
    deliveredAt: string | null;
    createdAt: string;
}

export interface ExternalActionReplayJobRecord {
    id: string;
    externalActionEventId: string;
    replayKind: ExternalActionReplayKind;
    status: ExternalActionReplayStatus;
    queuedAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    errorMessage: string | null;
    createdByUserId: string | null;
    createdAt: string;
}

export interface CreateExternalDeploymentInput {
    ownerUserId: string;
    indicatorInstanceId: string;
    signalCode: string;
    signalVersion: number;
    sourceBacktestRunId: string | null;
    telegramBotLabel: string | null;
    telegramBotTokenCiphertext: string;
    telegramChatId: string;
    telegramChatLabel: string | null;
    messageTemplateKind: string;
    createdByUserId: string | null;
    eligibilityStateSnapshot: string | null;
}

export interface ListExternalDeploymentsInput {
    ownerUserId?: string | null;
    indicatorInstanceId?: string | null;
    status?: ExternalDeploymentStatus | null;
    limit?: number;
}

export interface CreateExternalActionEventInput {
    eventId: string;
    externalDeploymentId: string;
    internalSignalEventId: string;
    idempotencyKey: string;
    signalCode: string;
    signalVersion: number;
    indicatorInstanceId: string;
    sourceBacktestRunId: string | null;
    symbol: string;
    timeframe: string;
    side: 'LONG' | 'SHORT';
    candleTime: string;
    referencePrice: number | null;
    entryPrice: number | null;
    stopLoss: number | null;
    takeProfit1: number | null;
    takeProfit2: number | null;
    suggestedVolume: number | null;
    payload: ActionableSignalEventContractV1;
    emittedAt: string;
}

export interface ListExternalActionEventsInput {
    ownerUserId?: string | null;
    externalDeploymentId?: string | null;
    indicatorInstanceId?: string | null;
    status?: ExternalActionEventStatus | null;
    limit?: number;
}

export interface CreateExternalActionDeliveryAttemptInput {
    externalActionEventId: string;
    externalDeploymentId: string;
    channelKind: ExternalChannelKind;
}

export interface CompleteExternalActionDeliveryAttemptInput {
    deliveryId: string;
    status: Exclude<ExternalActionDeliveryStatus, 'PENDING'>;
    providerMessageId?: string | null;
    providerChatId?: string | null;
    requestFingerprint?: string | null;
    requestJson?: Record<string, unknown> | null;
    responseJson?: Record<string, unknown> | null;
    errorCode?: string | null;
    errorMessage?: string | null;
}

export interface ListExternalActionDeliveriesInput {
    ownerUserId?: string | null;
    externalActionEventId?: string | null;
    externalDeploymentId?: string | null;
    limit?: number;
}

export interface CreateExternalActionReplayJobInput {
    externalActionEventId: string;
    replayKind: ExternalActionReplayKind;
    createdByUserId: string | null;
}

export interface ExternalActionStore {
    createDeployment(input: CreateExternalDeploymentInput): Promise<ExternalDeploymentRecord>;
    getDeployment(id: string): Promise<ExternalDeploymentRecord | null>;
    listDeployments(input: ListExternalDeploymentsInput): Promise<ExternalDeploymentRecord[]>;
    findActiveDeploymentsByIndicatorInstance(indicatorInstanceId: string): Promise<ExternalDeploymentRecord[]>;
    enableDeployment(id: string, actorUserId: string | null, eligibilityState: string | null): Promise<ExternalDeploymentRecord | null>;
    pauseDeployment(id: string, actorUserId: string | null, reason: string | null): Promise<ExternalDeploymentRecord | null>;
    archiveDeployment(id: string, actorUserId: string | null, reason: string | null): Promise<ExternalDeploymentRecord | null>;
    autoPauseActiveDeploymentsByIndicatorInstance(
        indicatorInstanceId: string,
        eligibilityState: string | null,
        reason: string,
    ): Promise<number>;
    createActionableEvent(input: CreateExternalActionEventInput): Promise<ExternalActionEventRecord | null>;
    updateActionableEventStatus(
        eventId: string,
        status: ExternalActionEventStatus,
        reason: string | null,
    ): Promise<void>;
    getActionableEventWithDeployment(eventId: string): Promise<ExternalActionEventWithDeployment | null>;
    listActionableEvents(input: ListExternalActionEventsInput): Promise<ExternalActionEventRecord[]>;
    createDeliveryAttempt(input: CreateExternalActionDeliveryAttemptInput): Promise<ExternalActionDeliveryRecord>;
    completeDeliveryAttempt(input: CompleteExternalActionDeliveryAttemptInput): Promise<ExternalActionDeliveryRecord | null>;
    listDeliveries(input: ListExternalActionDeliveriesInput): Promise<ExternalActionDeliveryRecord[]>;
    createReplayJob(input: CreateExternalActionReplayJobInput): Promise<ExternalActionReplayJobRecord>;
    markReplayJobStarted(id: string): Promise<void>;
    markReplayJobCompleted(id: string): Promise<void>;
    markReplayJobFailed(id: string, errorMessage: string): Promise<void>;
    getIntegrationHealthSummary(): Promise<{
        deployments: { total: number; active: number; paused: number; archived: number };
        events: { total: number; sent: number; failed: number; pending: number };
        deliveries: { total: number; sent: number; failed: number };
        recentFailures: Array<{ eventId: string; errorCode: string | null; errorMessage: string | null; createdAt: string }>;
    }>;
}

export interface SignalEligibilityLookup {
    getEligibilityForSignal(signalCode: string, signalVersion: number): Promise<SignalLiveEligibilityItem | null>;
}

export class ExternalActionError extends Error {
    constructor(
        public readonly code:
            | 'EXTERNAL_SIGNAL_DB_NOT_CONFIGURED'
            | 'INDICATOR_INSTANCE_NOT_FOUND'
            | 'EXTERNAL_DEPLOYMENT_NOT_FOUND'
            | 'EXTERNAL_ACTION_EVENT_NOT_FOUND'
            | 'EXTERNAL_ACTION_INPUT_INVALID'
            | 'EXTERNAL_DEPLOYMENT_NOT_ELIGIBLE'
            | 'EXTERNAL_DEPLOYMENT_NOT_ACTIVE'
            | 'EXTERNAL_ACTION_TELEGRAM_FAILED'
            | 'EXTERNAL_ACTION_FORBIDDEN'
            | 'EXTERNAL_SIGNAL_DB_SCHEMA_MISMATCH',
        public readonly statusCode: number,
        message: string,
    ) {
        super(message);
        this.name = 'ExternalActionError';
    }
}

export function resolveExternalActionOwnerUserId(
    actor: ExternalActionActor,
    requestedOwnerUserId: string | null,
    defaultToSelf = true,
): string | null {
    if (!requestedOwnerUserId) {
        return actor.role === 'ADMIN' && !defaultToSelf
            ? null
            : actor.id;
    }

    if (actor.role !== 'ADMIN' && requestedOwnerUserId !== actor.id) {
        throw new ExternalActionError(
            'EXTERNAL_ACTION_FORBIDDEN',
            403,
            'This external action lane can only access deployments owned by the current user.',
        );
    }

    return requestedOwnerUserId;
}

export function assertExternalActionOwnerAccess(
    actor: ExternalActionActor,
    ownerUserId: string,
    scope: ExternalActionAccessScope = {},
) {
    const scopedOwnerUserId = resolveExternalActionOwnerUserId(
        actor,
        typeof scope.ownerUserId === 'string' ? scope.ownerUserId.trim() || null : null,
        true,
    );

    if (actor.role !== 'ADMIN' && ownerUserId !== actor.id) {
        throw new ExternalActionError(
            'EXTERNAL_ACTION_FORBIDDEN',
            403,
            'This external deployment can only be managed by its owner.',
        );
    }

    if (
        actor.role === 'ADMIN'
        && ownerUserId !== actor.id
        && scopedOwnerUserId !== ownerUserId
    ) {
        throw new ExternalActionError(
            'EXTERNAL_ACTION_FORBIDDEN',
            403,
            'Admin access to another user\'s external deployment requires an explicit owner scope.',
        );
    }
}

export function toExternalDeploymentView(record: ExternalDeploymentRecord): ExternalDeploymentView {
    return {
        id: record.id,
        ownerUserId: record.ownerUserId,
        indicatorInstanceId: record.indicatorInstanceId,
        signalCode: record.signalCode,
        signalVersion: record.signalVersion,
        sourceBacktestRunId: record.sourceBacktestRunId,
        status: record.status,
        statusReason: record.statusReason,
        eligibilityStateSnapshot: record.eligibilityStateSnapshot,
        telegramBotLabel: record.telegramBotLabel,
        hasTelegramBotToken: Boolean(record.telegramBotTokenCiphertext),
        telegramChatId: record.telegramChatId,
        telegramChatLabel: record.telegramChatLabel,
        messageTemplateKind: record.messageTemplateKind,
        createdByUserId: record.createdByUserId,
        enabledByUserId: record.enabledByUserId,
        pausedByUserId: record.pausedByUserId,
        archivedByUserId: record.archivedByUserId,
        enabledAt: record.enabledAt,
        pausedAt: record.pausedAt,
        archivedAt: record.archivedAt,
        lastEligibilityCheckAt: record.lastEligibilityCheckAt,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
    };
}
