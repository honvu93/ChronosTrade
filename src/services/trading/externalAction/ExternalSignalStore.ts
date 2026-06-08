import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

import {
    CreateExternalActionDeliveryAttemptInput,
    CreateExternalActionEventInput,
    CreateExternalActionReplayJobInput,
    CreateExternalDeploymentInput,
    ExternalActionDeliveryRecord,
    ExternalActionDeliveryStatus,
    ExternalActionError,
    ExternalActionEventRecord,
    ExternalActionEventStatus,
    ExternalActionEventWithDeployment,
    ExternalActionReplayJobRecord,
    ExternalActionStore,
    ExternalDeploymentRecord,
    ListExternalActionDeliveriesInput,
    ListExternalActionEventsInput,
    ListExternalDeploymentsInput,
} from './types';

type Queryable = Pick<PrismaClient, '$queryRawUnsafe' | '$executeRawUnsafe'>;

const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 500;

function normalizeLimit(value: number | undefined) {
    if (!value || !Number.isInteger(value) || value <= 0) {
        return DEFAULT_LIST_LIMIT;
    }

    return Math.min(value, MAX_LIST_LIMIT);
}

function normalizeNullableString(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}

function toIsoString(value: unknown): string | null {
    if (value instanceof Date) {
        return value.toISOString();
    }

    if (typeof value === 'string') {
        return new Date(value).toISOString();
    }

    return null;
}

function toNumber(value: unknown): number | null {
    if (value === null || value === undefined) {
        return null;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }

    return value as Record<string, unknown>;
}

function mapDeployment(row: Record<string, unknown>): ExternalDeploymentRecord {
    return {
        id: String(row.id),
        ownerUserId: String(row.owner_user_id),
        indicatorInstanceId: String(row.indicator_instance_id),
        signalCode: String(row.signal_code),
        signalVersion: Number(row.signal_version),
        sourceBacktestRunId: normalizeNullableString(row.source_backtest_run_id),
        status: String(row.status) as ExternalDeploymentRecord['status'],
        statusReason: normalizeNullableString(row.status_reason),
        eligibilityStateSnapshot: normalizeNullableString(row.eligibility_state_snapshot),
        telegramBotLabel: normalizeNullableString(row.telegram_bot_label),
        telegramBotTokenCiphertext: String(row.telegram_bot_token_ciphertext),
        telegramChatId: String(row.telegram_chat_id),
        telegramChatLabel: normalizeNullableString(row.telegram_chat_label),
        messageTemplateKind: String(row.message_template_kind),
        createdByUserId: normalizeNullableString(row.created_by_user_id),
        enabledByUserId: normalizeNullableString(row.enabled_by_user_id),
        pausedByUserId: normalizeNullableString(row.paused_by_user_id),
        archivedByUserId: normalizeNullableString(row.archived_by_user_id),
        enabledAt: toIsoString(row.enabled_at),
        pausedAt: toIsoString(row.paused_at),
        archivedAt: toIsoString(row.archived_at),
        lastEligibilityCheckAt: toIsoString(row.last_eligibility_check_at),
        createdAt: toIsoString(row.created_at) ?? new Date(0).toISOString(),
        updatedAt: toIsoString(row.updated_at) ?? new Date(0).toISOString(),
    };
}

function mapEvent(row: Record<string, unknown>): ExternalActionEventRecord {
    return {
        id: String(row.id),
        externalDeploymentId: String(row.external_deployment_id),
        internalSignalEventId: String(row.internal_signal_event_id),
        idempotencyKey: String(row.idempotency_key),
        contractKind: 'actionable-signal-event',
        contractVersion: 1,
        eventType: 'ENTRY',
        actionability: String(row.actionability) as ExternalActionEventRecord['actionability'],
        actionType: String(row.action_type) as ExternalActionEventRecord['actionType'],
        signalCode: String(row.signal_code),
        signalVersion: Number(row.signal_version),
        indicatorInstanceId: String(row.indicator_instance_id),
        sourceBacktestRunId: normalizeNullableString(row.source_backtest_run_id),
        symbol: String(row.symbol),
        timeframe: String(row.timeframe),
        side: String(row.side) as ExternalActionEventRecord['side'],
        candleTime: toIsoString(row.candle_time) ?? new Date(0).toISOString(),
        referencePrice: toNumber(row.reference_price),
        entryPrice: toNumber(row.entry_price),
        entryType: String(row.entry_type) as ExternalActionEventRecord['entryType'],
        stopLoss: toNumber(row.stop_loss),
        takeProfit1: toNumber(row.take_profit_1),
        takeProfit2: toNumber(row.take_profit_2),
        suggestedVolume: toNumber(row.suggested_volume),
        payload: parseJsonRecord(row.payload_json) as unknown as ExternalActionEventRecord['payload'],
        status: String(row.status) as ExternalActionEventStatus,
        statusReason: normalizeNullableString(row.status_reason),
        emittedAt: toIsoString(row.emitted_at) ?? new Date(0).toISOString(),
        expiresAt: toIsoString(row.expires_at),
        supersedesEventId: normalizeNullableString(row.supersedes_event_id),
        createdAt: toIsoString(row.created_at) ?? new Date(0).toISOString(),
        updatedAt: toIsoString(row.updated_at) ?? new Date(0).toISOString(),
    };
}

function mapDelivery(row: Record<string, unknown>): ExternalActionDeliveryRecord {
    return {
        id: String(row.id),
        externalActionEventId: String(row.external_action_event_id),
        externalDeploymentId: String(row.external_deployment_id),
        channelKind: 'TELEGRAM',
        attemptNumber: Number(row.attempt_number),
        status: String(row.status) as ExternalActionDeliveryStatus,
        providerMessageId: normalizeNullableString(row.provider_message_id),
        providerChatId: normalizeNullableString(row.provider_chat_id),
        requestFingerprint: normalizeNullableString(row.request_fingerprint),
        requestJson: parseJsonRecord(row.request_json),
        responseJson: parseJsonRecord(row.response_json),
        errorCode: normalizeNullableString(row.error_code),
        errorMessage: normalizeNullableString(row.error_message),
        attemptedAt: toIsoString(row.attempted_at) ?? new Date(0).toISOString(),
        deliveredAt: toIsoString(row.delivered_at),
        createdAt: toIsoString(row.created_at) ?? new Date(0).toISOString(),
    };
}

function mapReplayJob(row: Record<string, unknown>): ExternalActionReplayJobRecord {
    return {
        id: String(row.id),
        externalActionEventId: String(row.external_action_event_id),
        replayKind: String(row.replay_kind) as ExternalActionReplayJobRecord['replayKind'],
        status: String(row.status) as ExternalActionReplayJobRecord['status'],
        queuedAt: toIsoString(row.queued_at) ?? new Date(0).toISOString(),
        startedAt: toIsoString(row.started_at),
        finishedAt: toIsoString(row.finished_at),
        errorMessage: normalizeNullableString(row.error_message),
        createdByUserId: normalizeNullableString(row.created_by_user_id),
        createdAt: toIsoString(row.created_at) ?? new Date(0).toISOString(),
    };
}

function buildExternalSignalDbClient(env: NodeJS.ProcessEnv) {
    const url = env.EXTERNAL_SIGNAL_DB_URL?.trim();
    if (!url) {
        return null;
    }

    return new PrismaClient({
        datasources: {
            db: {
                url,
            },
        },
    });
}

export class PostgresExternalActionStore implements ExternalActionStore {
    private readonly client: Queryable | null;
    private schemaReady: Promise<void> | null = null;

    constructor(
        env: NodeJS.ProcessEnv = process.env,
        client?: Queryable | null,
    ) {
        this.client = client === undefined ? buildExternalSignalDbClient(env) : client;
    }

    private requireClient(): Queryable {
        if (!this.client) {
            throw new ExternalActionError(
                'EXTERNAL_SIGNAL_DB_NOT_CONFIGURED',
                503,
                'EXTERNAL_SIGNAL_DB_URL must be configured before the external action lane can be used.',
            );
        }

        return this.client;
    }

    public isConfigured() {
        return this.client !== null;
    }

    public async ensureReady() {
        await this.ensureSchema();
    }

    private async ensureSchema() {
        if (!this.schemaReady) {
            this.schemaReady = this.validateSchema();
        }

        await this.schemaReady;
    }

    private async validateSchema() {
        const client = this.requireClient();
        const checks = [
            `SELECT id, owner_user_id, indicator_instance_id, signal_code, signal_version, source_backtest_run_id, status, status_reason, eligibility_state_snapshot, telegram_bot_label, telegram_bot_token_ciphertext, telegram_chat_id, telegram_chat_label, message_template_kind, created_by_user_id, enabled_by_user_id, paused_by_user_id, archived_by_user_id, enabled_at, paused_at, archived_at, last_eligibility_check_at, created_at, updated_at FROM external_deployments LIMIT 0`,
            `SELECT id, external_deployment_id, internal_signal_event_id, idempotency_key, contract_kind, contract_version, event_type, actionability, action_type, signal_code, signal_version, indicator_instance_id, source_backtest_run_id, symbol, timeframe, side, candle_time, reference_price, entry_price, entry_type, stop_loss, take_profit_1, take_profit_2, suggested_volume, payload_json, status, status_reason, emitted_at, expires_at, supersedes_event_id, created_at, updated_at FROM external_action_events LIMIT 0`,
            `SELECT id, external_action_event_id, external_deployment_id, channel_kind, attempt_number, status, provider_message_id, provider_chat_id, request_fingerprint, request_json, response_json, error_code, error_message, attempted_at, delivered_at, created_at FROM external_action_deliveries LIMIT 0`,
            `SELECT id, external_action_event_id, replay_kind, status, queued_at, started_at, finished_at, error_message, created_by_user_id, created_at FROM external_action_replay_jobs LIMIT 0`,
        ];

        try {
            for (const statement of checks) {
                await client.$queryRawUnsafe(statement);
            }
        } catch {
            throw new ExternalActionError(
                'EXTERNAL_SIGNAL_DB_SCHEMA_MISMATCH',
                503,
                'The external signal database is missing required tables or columns. Apply prisma/external-signal/migrations/20260313190000_init_external_action_lane/migration.sql before enabling the external action lane.',
            );
        }
    }

    async createDeployment(input: CreateExternalDeploymentInput): Promise<ExternalDeploymentRecord> {
        await this.ensureSchema();
        const client = this.requireClient();
        const id = crypto.randomUUID();
        const rows = await client.$queryRawUnsafe<Record<string, unknown>[]>(`
            INSERT INTO external_deployments (
                id,
                owner_user_id,
                indicator_instance_id,
                signal_code,
                signal_version,
                source_backtest_run_id,
                status,
                status_reason,
                eligibility_state_snapshot,
                telegram_bot_label,
                telegram_bot_token_ciphertext,
                telegram_chat_id,
                telegram_chat_label,
                message_template_kind,
                created_by_user_id,
                created_at,
                updated_at
            )
            VALUES (
                $1, $2, $3, $4, $5, $6, 'DRAFT', NULL, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW()
            )
            RETURNING *
        `, id, input.ownerUserId, input.indicatorInstanceId, input.signalCode, input.signalVersion, input.sourceBacktestRunId, input.eligibilityStateSnapshot, input.telegramBotLabel, input.telegramBotTokenCiphertext, input.telegramChatId, input.telegramChatLabel, input.messageTemplateKind, input.createdByUserId);

        return mapDeployment(rows[0]);
    }

    async getDeployment(id: string): Promise<ExternalDeploymentRecord | null> {
        await this.ensureSchema();
        const rows = await this.requireClient().$queryRawUnsafe<Record<string, unknown>[]>(`
            SELECT *
            FROM external_deployments
            WHERE id = $1
            LIMIT 1
        `, id);

        return rows[0] ? mapDeployment(rows[0]) : null;
    }

    async listDeployments(input: ListExternalDeploymentsInput): Promise<ExternalDeploymentRecord[]> {
        await this.ensureSchema();
        const clauses: string[] = [];
        const values: unknown[] = [];

        if (input.indicatorInstanceId) {
            values.push(input.indicatorInstanceId);
            clauses.push(`indicator_instance_id = $${values.length}`);
        }
        if (input.ownerUserId) {
            values.push(input.ownerUserId);
            clauses.push(`owner_user_id = $${values.length}`);
        }
        if (input.status) {
            values.push(input.status);
            clauses.push(`status = $${values.length}`);
        }
        values.push(normalizeLimit(input.limit));

        const rows = await this.requireClient().$queryRawUnsafe<Record<string, unknown>[]>(`
            SELECT *
            FROM external_deployments
            ${clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''}
            ORDER BY created_at DESC, id DESC
            LIMIT $${values.length}
        `, ...values);

        return rows.map(mapDeployment);
    }

    async findActiveDeploymentsByIndicatorInstance(indicatorInstanceId: string): Promise<ExternalDeploymentRecord[]> {
        return this.listDeployments({
            indicatorInstanceId,
            status: 'ACTIVE',
            limit: MAX_LIST_LIMIT,
        });
    }

    async enableDeployment(id: string, actorUserId: string | null, eligibilityState: string | null) {
        await this.ensureSchema();
        const rows = await this.requireClient().$queryRawUnsafe<Record<string, unknown>[]>(`
            UPDATE external_deployments
            SET
                status = 'ACTIVE',
                status_reason = NULL,
                eligibility_state_snapshot = $2,
                enabled_by_user_id = $3,
                enabled_at = NOW(),
                paused_at = NULL,
                archived_at = NULL,
                last_eligibility_check_at = NOW(),
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
        `, id, eligibilityState, actorUserId);

        return rows[0] ? mapDeployment(rows[0]) : null;
    }

    async pauseDeployment(id: string, actorUserId: string | null, reason: string | null) {
        await this.ensureSchema();
        const rows = await this.requireClient().$queryRawUnsafe<Record<string, unknown>[]>(`
            UPDATE external_deployments
            SET
                status = 'PAUSED',
                status_reason = $2,
                paused_by_user_id = $3,
                paused_at = NOW(),
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
        `, id, reason, actorUserId);

        return rows[0] ? mapDeployment(rows[0]) : null;
    }

    async archiveDeployment(id: string, actorUserId: string | null, reason: string | null) {
        await this.ensureSchema();
        const rows = await this.requireClient().$queryRawUnsafe<Record<string, unknown>[]>(`
            UPDATE external_deployments
            SET
                status = 'ARCHIVED',
                status_reason = $2,
                archived_by_user_id = $3,
                archived_at = NOW(),
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
        `, id, reason, actorUserId);

        return rows[0] ? mapDeployment(rows[0]) : null;
    }

    async autoPauseActiveDeploymentsByIndicatorInstance(
        indicatorInstanceId: string,
        eligibilityState: string | null,
        reason: string,
    ) {
        await this.ensureSchema();
        const result = await this.requireClient().$executeRawUnsafe(`
            UPDATE external_deployments
            SET
                status = 'AUTO_PAUSED',
                status_reason = $2,
                eligibility_state_snapshot = $3,
                paused_at = NOW(),
                last_eligibility_check_at = NOW(),
                updated_at = NOW()
            WHERE indicator_instance_id = $1
              AND status = 'ACTIVE'
        `, indicatorInstanceId, reason, eligibilityState);

        return Number(result);
    }

    async createActionableEvent(input: CreateExternalActionEventInput): Promise<ExternalActionEventRecord | null> {
        await this.ensureSchema();
        const client = this.requireClient();
        const payloadJson = JSON.stringify(input.payload);
        const rows = await client.$queryRawUnsafe<Record<string, unknown>[]>(`
            INSERT INTO external_action_events (
                id,
                external_deployment_id,
                internal_signal_event_id,
                idempotency_key,
                contract_kind,
                contract_version,
                event_type,
                actionability,
                action_type,
                signal_code,
                signal_version,
                indicator_instance_id,
                source_backtest_run_id,
                symbol,
                timeframe,
                side,
                candle_time,
                reference_price,
                entry_price,
                entry_type,
                stop_loss,
                take_profit_1,
                take_profit_2,
                suggested_volume,
                payload_json,
                status,
                status_reason,
                emitted_at,
                expires_at,
                supersedes_event_id,
                created_at,
                updated_at
            )
            VALUES (
                $1, $2, $3, $4, 'actionable-signal-event', 1, 'ENTRY', 'ACTIONABLE', 'OPEN_MARKET', $5, $6, $7, $8,
                $9, $10, $11, $12, $13, $14, 'MARKET', $15, $16, $17, $18, CAST($19 AS JSONB), 'READY', NULL,
                $20, NULL, NULL, NOW(), NOW()
            )
            ON CONFLICT (idempotency_key) DO NOTHING
            RETURNING *
        `, input.eventId, input.externalDeploymentId, input.internalSignalEventId, input.idempotencyKey, input.signalCode, input.signalVersion, input.indicatorInstanceId, input.sourceBacktestRunId, input.symbol, input.timeframe, input.side, input.candleTime, input.referencePrice, input.entryPrice, input.stopLoss, input.takeProfit1, input.takeProfit2, input.suggestedVolume, payloadJson, input.emittedAt);

        return rows[0] ? mapEvent(rows[0]) : null;
    }

    async updateActionableEventStatus(eventId: string, status: ExternalActionEventStatus, reason: string | null) {
        await this.ensureSchema();
        await this.requireClient().$executeRawUnsafe(`
            UPDATE external_action_events
            SET
                status = $2,
                status_reason = $3,
                updated_at = NOW()
            WHERE id = $1
        `, eventId, status, reason);
    }

    async getActionableEventWithDeployment(eventId: string): Promise<ExternalActionEventWithDeployment | null> {
        await this.ensureSchema();
        const rows = await this.requireClient().$queryRawUnsafe<Record<string, unknown>[]>(`
            SELECT
                e.*,
                d.id AS deployment_id,
                d.owner_user_id AS deployment_owner_user_id,
                d.indicator_instance_id AS deployment_indicator_instance_id,
                d.signal_code AS deployment_signal_code,
                d.signal_version AS deployment_signal_version,
                d.source_backtest_run_id AS deployment_source_backtest_run_id,
                d.status AS deployment_status,
                d.status_reason AS deployment_status_reason,
                d.eligibility_state_snapshot AS deployment_eligibility_state_snapshot,
                d.telegram_bot_label AS deployment_telegram_bot_label,
                d.telegram_bot_token_ciphertext AS deployment_telegram_bot_token_ciphertext,
                d.telegram_chat_id AS deployment_telegram_chat_id,
                d.telegram_chat_label AS deployment_telegram_chat_label,
                d.message_template_kind AS deployment_message_template_kind,
                d.created_by_user_id AS deployment_created_by_user_id,
                d.enabled_by_user_id AS deployment_enabled_by_user_id,
                d.paused_by_user_id AS deployment_paused_by_user_id,
                d.archived_by_user_id AS deployment_archived_by_user_id,
                d.enabled_at AS deployment_enabled_at,
                d.paused_at AS deployment_paused_at,
                d.archived_at AS deployment_archived_at,
                d.last_eligibility_check_at AS deployment_last_eligibility_check_at,
                d.created_at AS deployment_created_at,
                d.updated_at AS deployment_updated_at
            FROM external_action_events e
            INNER JOIN external_deployments d ON d.id = e.external_deployment_id
            WHERE e.id = $1
            LIMIT 1
        `, eventId);

        const row = rows[0];
        if (!row) {
            return null;
        }

        const event = mapEvent(row);
        const deployment = mapDeployment({
            id: row.deployment_id,
            owner_user_id: row.deployment_owner_user_id,
            indicator_instance_id: row.deployment_indicator_instance_id,
            signal_code: row.deployment_signal_code,
            signal_version: row.deployment_signal_version,
            source_backtest_run_id: row.deployment_source_backtest_run_id,
            status: row.deployment_status,
            status_reason: row.deployment_status_reason,
            eligibility_state_snapshot: row.deployment_eligibility_state_snapshot,
            telegram_bot_label: row.deployment_telegram_bot_label,
            telegram_bot_token_ciphertext: row.deployment_telegram_bot_token_ciphertext,
            telegram_chat_id: row.deployment_telegram_chat_id,
            telegram_chat_label: row.deployment_telegram_chat_label,
            message_template_kind: row.deployment_message_template_kind,
            created_by_user_id: row.deployment_created_by_user_id,
            enabled_by_user_id: row.deployment_enabled_by_user_id,
            paused_by_user_id: row.deployment_paused_by_user_id,
            archived_by_user_id: row.deployment_archived_by_user_id,
            enabled_at: row.deployment_enabled_at,
            paused_at: row.deployment_paused_at,
            archived_at: row.deployment_archived_at,
            last_eligibility_check_at: row.deployment_last_eligibility_check_at,
            created_at: row.deployment_created_at,
            updated_at: row.deployment_updated_at,
        });

        return {
            ...event,
            deployment,
        };
    }

    async listActionableEvents(input: ListExternalActionEventsInput): Promise<ExternalActionEventRecord[]> {
        await this.ensureSchema();
        const clauses: string[] = [];
        const values: unknown[] = [];

        if (input.ownerUserId) {
            values.push(input.ownerUserId);
            clauses.push(`d.owner_user_id = $${values.length}`);
        }
        if (input.externalDeploymentId) {
            values.push(input.externalDeploymentId);
            clauses.push(`e.external_deployment_id = $${values.length}`);
        }
        if (input.indicatorInstanceId) {
            values.push(input.indicatorInstanceId);
            clauses.push(`e.indicator_instance_id = $${values.length}`);
        }
        if (input.status) {
            values.push(input.status);
            clauses.push(`e.status = $${values.length}`);
        }
        values.push(normalizeLimit(input.limit));

        const rows = await this.requireClient().$queryRawUnsafe<Record<string, unknown>[]>(`
            SELECT e.*
            FROM external_action_events e
            INNER JOIN external_deployments d ON d.id = e.external_deployment_id
            ${clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''}
            ORDER BY e.emitted_at DESC, e.id DESC
            LIMIT $${values.length}
        `, ...values);

        return rows.map(mapEvent);
    }

    async createDeliveryAttempt(input: CreateExternalActionDeliveryAttemptInput): Promise<ExternalActionDeliveryRecord> {
        await this.ensureSchema();
        const client = this.requireClient();
        const id = crypto.randomUUID();
        const rows = await client.$queryRawUnsafe<Record<string, unknown>[]>(`
            WITH next_attempt AS (
                SELECT COALESCE(MAX(attempt_number), 0) + 1 AS attempt_number
                FROM external_action_deliveries
                WHERE external_action_event_id = $2
            )
            INSERT INTO external_action_deliveries (
                id,
                external_action_event_id,
                external_deployment_id,
                channel_kind,
                attempt_number,
                status,
                attempted_at,
                created_at
            )
            SELECT
                $1,
                $2,
                $3,
                $4,
                next_attempt.attempt_number,
                'PENDING',
                NOW(),
                NOW()
            FROM next_attempt
            RETURNING *
        `, id, input.externalActionEventId, input.externalDeploymentId, input.channelKind);

        return mapDelivery(rows[0]);
    }

    async completeDeliveryAttempt(input: {
        deliveryId: string;
        status: 'SENT' | 'FAILED';
        providerMessageId?: string | null;
        providerChatId?: string | null;
        requestFingerprint?: string | null;
        requestJson?: Record<string, unknown> | null;
        responseJson?: Record<string, unknown> | null;
        errorCode?: string | null;
        errorMessage?: string | null;
    }): Promise<ExternalActionDeliveryRecord | null> {
        await this.ensureSchema();
        const rows = await this.requireClient().$queryRawUnsafe<Record<string, unknown>[]>(`
            UPDATE external_action_deliveries
            SET
                status = $2,
                provider_message_id = $3,
                provider_chat_id = $4,
                request_fingerprint = $5,
                request_json = CASE WHEN $6::text IS NULL THEN NULL ELSE CAST($6 AS JSONB) END,
                response_json = CASE WHEN $7::text IS NULL THEN NULL ELSE CAST($7 AS JSONB) END,
                error_code = $8,
                error_message = $9,
                delivered_at = CASE WHEN $2 = 'SENT' THEN NOW() ELSE delivered_at END
            WHERE id = $1
            RETURNING *
        `, input.deliveryId, input.status, input.providerMessageId ?? null, input.providerChatId ?? null, input.requestFingerprint ?? null, input.requestJson ? JSON.stringify(input.requestJson) : null, input.responseJson ? JSON.stringify(input.responseJson) : null, input.errorCode ?? null, input.errorMessage ?? null);

        return rows[0] ? mapDelivery(rows[0]) : null;
    }

    async listDeliveries(input: ListExternalActionDeliveriesInput): Promise<ExternalActionDeliveryRecord[]> {
        await this.ensureSchema();
        const clauses: string[] = [];
        const values: unknown[] = [];

        if (input.ownerUserId) {
            values.push(input.ownerUserId);
            clauses.push(`d.owner_user_id = $${values.length}`);
        }
        if (input.externalActionEventId) {
            values.push(input.externalActionEventId);
            clauses.push(`a.external_action_event_id = $${values.length}`);
        }
        if (input.externalDeploymentId) {
            values.push(input.externalDeploymentId);
            clauses.push(`a.external_deployment_id = $${values.length}`);
        }
        values.push(normalizeLimit(input.limit));

        const rows = await this.requireClient().$queryRawUnsafe<Record<string, unknown>[]>(`
            SELECT a.*
            FROM external_action_deliveries a
            INNER JOIN external_deployments d ON d.id = a.external_deployment_id
            ${clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''}
            ORDER BY a.attempted_at DESC, a.id DESC
            LIMIT $${values.length}
        `, ...values);

        return rows.map(mapDelivery);
    }

    async createReplayJob(input: CreateExternalActionReplayJobInput): Promise<ExternalActionReplayJobRecord> {
        await this.ensureSchema();
        const client = this.requireClient();
        const id = crypto.randomUUID();
        const rows = await client.$queryRawUnsafe<Record<string, unknown>[]>(`
            INSERT INTO external_action_replay_jobs (
                id,
                external_action_event_id,
                replay_kind,
                status,
                queued_at,
                created_by_user_id,
                created_at
            )
            VALUES (
                $1, $2, $3, 'QUEUED', NOW(), $4, NOW()
            )
            RETURNING *
        `, id, input.externalActionEventId, input.replayKind, input.createdByUserId);

        return mapReplayJob(rows[0]);
    }

    async markReplayJobStarted(id: string) {
        await this.ensureSchema();
        await this.requireClient().$executeRawUnsafe(`
            UPDATE external_action_replay_jobs
            SET
                status = 'PROCESSING',
                started_at = NOW(),
                error_message = NULL
            WHERE id = $1
        `, id);
    }

    async markReplayJobCompleted(id: string) {
        await this.ensureSchema();
        await this.requireClient().$executeRawUnsafe(`
            UPDATE external_action_replay_jobs
            SET
                status = 'COMPLETED',
                finished_at = NOW(),
                error_message = NULL
            WHERE id = $1
        `, id);
    }

    async markReplayJobFailed(id: string, errorMessage: string) {
        await this.ensureSchema();
        await this.requireClient().$executeRawUnsafe(`
            UPDATE external_action_replay_jobs
            SET
                status = 'FAILED',
                finished_at = NOW(),
                error_message = $2
            WHERE id = $1
        `, id, errorMessage);
    }

    async getIntegrationHealthSummary(): Promise<{
        deployments: { total: number; active: number; paused: number; archived: number };
        events: { total: number; sent: number; failed: number; pending: number };
        deliveries: { total: number; sent: number; failed: number };
        recentFailures: Array<{ eventId: string; errorCode: string | null; errorMessage: string | null; createdAt: string }>;
    }> {
        await this.ensureSchema();
        const client = this.requireClient();

        const [deploymentStats, eventStats, deliveryStats, recentFailures] = await Promise.all([
            client.$queryRawUnsafe<Array<{ status: string; count: string }>>(`
                SELECT status, COUNT(*)::text AS count FROM external_deployments GROUP BY status
            `),
            client.$queryRawUnsafe<Array<{ status: string; count: string }>>(`
                SELECT status, COUNT(*)::text AS count FROM external_action_events GROUP BY status
            `),
            client.$queryRawUnsafe<Array<{ status: string; count: string }>>(`
                SELECT status, COUNT(*)::text AS count FROM external_action_deliveries GROUP BY status
            `),
            client.$queryRawUnsafe<Array<{ id: string; error_code: string | null; error_message: string | null; created_at: Date }>>(`
                SELECT id, error_code, error_message, created_at
                FROM external_action_deliveries
                WHERE status = 'FAILED'
                ORDER BY created_at DESC
                LIMIT 10
            `),
        ]);

        const depMap = Object.fromEntries(deploymentStats.map((r) => [r.status, Number(r.count)]));
        const evtMap = Object.fromEntries(eventStats.map((r) => [r.status, Number(r.count)]));
        const delMap = Object.fromEntries(deliveryStats.map((r) => [r.status, Number(r.count)]));

        return {
            deployments: {
                total: Object.values(depMap).reduce((s, n) => s + n, 0),
                active: depMap['ACTIVE'] ?? 0,
                paused: (depMap['PAUSED'] ?? 0) + (depMap['AUTO_PAUSED'] ?? 0),
                archived: depMap['ARCHIVED'] ?? 0,
            },
            events: {
                total: Object.values(evtMap).reduce((s, n) => s + n, 0),
                sent: evtMap['SENT'] ?? 0,
                failed: evtMap['FAILED'] ?? 0,
                pending: evtMap['READY'] ?? 0,
            },
            deliveries: {
                total: Object.values(delMap).reduce((s, n) => s + n, 0),
                sent: delMap['SENT'] ?? 0,
                failed: delMap['FAILED'] ?? 0,
            },
            recentFailures: recentFailures.map((r) => ({
                eventId: r.id,
                errorCode: r.error_code,
                errorMessage: r.error_message,
                createdAt: r.created_at.toISOString(),
            })),
        };
    }
}
