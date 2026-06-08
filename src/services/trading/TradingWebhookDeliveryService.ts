import crypto from 'crypto';
import net from 'net';
import {
    Prisma,
    PrismaClient,
    TradingWebhookDeliveryStatus,
} from '@prisma/client';
import {
    isValidContractKind,
    TradingOutputContractKind,
    TradingOutputContractService,
    TradingOutputEnvelope,
} from './TradingOutputContractService';
import { ExportRecordsQuery, ExportRecordsResult, TradingExportService } from './TradingExportService';

const DEFAULT_DELIVERY_LIMIT = 100;
const MAX_DELIVERY_LIMIT = 500;
const ALL_CONTRACT_KINDS: TradingOutputContractKind[] = [
    'signal-event',
    'execution-event',
    'trade-outcome',
    'investigation-outcome',
];

type FetchResponseLike = {
    ok: boolean;
    status: number;
    text(): Promise<string>;
};

export type TradingWebhookFetchLike = (
    url: string,
    init: {
        method: 'POST';
        headers: Record<string, string>;
        body: string;
        signal: AbortSignal;
    },
) => Promise<FetchResponseLike>;

export interface TradingWebhookEndpointInput {
    name: string;
    url: string;
    contractKinds?: TradingOutputContractKind[];
    bearerToken?: string | null;
    signingSecret: string;
    isActive?: boolean;
}

export interface TradingWebhookEndpointSummary {
    id: string;
    name: string;
    url: string;
    contractKinds: TradingOutputContractKind[];
    hasBearerToken: boolean;
    hasSigningSecret: boolean;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
    lastDeliveryAt: string | null;
    lastDeliveryStatus: 'pending' | 'succeeded' | 'failed' | null;
}

export interface TradingWebhookDeliveryListQuery {
    endpointId: string | null;
    limit: number;
}

export interface TradingWebhookDispatchInput {
    endpointId: string;
    backtestRunId: string | null;
    indicatorInstanceId: string | null;
    contractKind: TradingOutputContractKind | null;
    limit: number;
}

type TradingWebhookExportQuery = Omit<TradingWebhookDispatchInput, 'endpointId'>;

export interface TradingWebhookConfiguredDispatchInput {
    backtestRunId: string | null;
    indicatorInstanceId: string | null;
    deliveries: Array<{
        contractKind: TradingOutputContractKind;
        limit: number;
    }>;
}

export interface TradingWebhookDeliverySummary {
    id: string;
    endpointId: string;
    endpointName: string;
    endpointUrl: string;
    status: 'pending' | 'succeeded' | 'failed';
    httpStatus: number | null;
    errorMessage: string | null;
    responseBodyText: string | null;
    recordCount: number;
    attemptedAt: string;
    deliveredAt: string | null;
    query: ExportRecordsQuery | null;
    recordRefs: TradingWebhookRecordReference[];
}

export interface TradingWebhookDispatchResult {
    endpoint: TradingWebhookEndpointSummary;
    delivery: TradingWebhookDeliverySummary;
    records: TradingOutputEnvelope[];
}

export interface TradingWebhookRecordReference {
    contractKind: TradingOutputContractKind;
    recordId: string;
    signalKey: string;
    backtestRunId: string | null;
    indicatorInstanceId: string | null;
    tradeRecordId: string | null;
}

export class TradingWebhookDeliveryError extends Error {
    constructor(
        public readonly code:
            | 'ENCRYPTION_KEY_REQUIRED'
            | 'INVALID_ENDPOINT_URL'
            | 'INVALID_ENDPOINT_INPUT'
            | 'WEBHOOK_ALLOWLIST_REQUIRED'
            | 'ENDPOINT_HOST_NOT_ALLOWED'
            | 'ENDPOINT_HOST_PRIVATE'
            | 'INVALID_DELIVERY_CONTEXT'
            | 'ENDPOINT_NOT_FOUND'
            | 'ENDPOINT_INACTIVE'
            | 'NO_RECORDS_TO_DELIVER',
        message: string,
    ) {
        super(message);
        this.name = 'TradingWebhookDeliveryError';
    }
}

function normalizeOptionalString(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}

function requireNonEmptyString(
    value: unknown,
    fieldName: string,
    errorCode: TradingWebhookDeliveryError['code'] = 'INVALID_ENDPOINT_INPUT',
): string {
    const normalized = normalizeOptionalString(value);
    if (!normalized) {
        throw new TradingWebhookDeliveryError(errorCode, `${fieldName} is required.`);
    }

    return normalized;
}

function normalizeContractKinds(contractKinds: unknown): TradingOutputContractKind[] {
    if (!Array.isArray(contractKinds) || contractKinds.length === 0) {
        return [...ALL_CONTRACT_KINDS];
    }

    const normalized: TradingOutputContractKind[] = [];
    for (const item of contractKinds) {
        if (!isValidContractKind(item) || normalized.includes(item)) {
            continue;
        }
        normalized.push(item);
    }

    return normalized.length > 0 ? normalized : [...ALL_CONTRACT_KINDS];
}

function normalizeAllowedHosts(env: NodeJS.ProcessEnv): string[] {
    const raw = env.TRADING_WEBHOOK_ALLOWED_HOSTS?.trim() ?? '';
    return raw
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => entry.length > 0);
}

function isPrivateIpv4(hostname: string): boolean {
    const [a, b] = hostname.split('.').map((part) => Number(part));
    if (![a, b].every((part) => Number.isInteger(part))) {
        return false;
    }

    return a === 10
        || a === 127
        || (a === 169 && b === 254)
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168);
}

function isBlockedIpLiteral(hostname: string): boolean {
    const ipVersion = net.isIP(hostname);
    if (ipVersion === 4) {
        return isPrivateIpv4(hostname);
    }

    if (ipVersion === 6) {
        const normalized = hostname.toLowerCase();
        return normalized === '::1'
            || normalized.startsWith('fc')
            || normalized.startsWith('fd')
            || normalized.startsWith('fe80:');
    }

    return false;
}

function hostMatchesAllowedRule(hostname: string, rule: string): boolean {
    if (rule.startsWith('*.')) {
        const suffix = rule.slice(2);
        return hostname === suffix || hostname.endsWith(`.${suffix}`);
    }

    return hostname === rule;
}

function assertEndpointUrlAllowed(url: URL, env: NodeJS.ProcessEnv) {
    const hostname = url.hostname.trim().toLowerCase();
    if (!hostname) {
        throw new TradingWebhookDeliveryError(
            'INVALID_ENDPOINT_URL',
            'Webhook endpoint URL must include a hostname.',
        );
    }

    if (hostname === 'localhost' || hostname.endsWith('.localhost') || isBlockedIpLiteral(hostname)) {
        throw new TradingWebhookDeliveryError(
            'ENDPOINT_HOST_PRIVATE',
            'Webhook endpoint host must not point to localhost or a private network address.',
        );
    }

    const allowedHosts = normalizeAllowedHosts(env);
    if (allowedHosts.length === 0) {
        throw new TradingWebhookDeliveryError(
            'WEBHOOK_ALLOWLIST_REQUIRED',
            'Set TRADING_WEBHOOK_ALLOWED_HOSTS before registering outbound trading webhooks.',
        );
    }

    if (!allowedHosts.some((rule) => hostMatchesAllowedRule(hostname, rule))) {
        throw new TradingWebhookDeliveryError(
            'ENDPOINT_HOST_NOT_ALLOWED',
            `Webhook endpoint host '${hostname}' is not present in TRADING_WEBHOOK_ALLOWED_HOSTS.`,
        );
    }
}

function validateEndpointUrlWithEnv(value: string, env: NodeJS.ProcessEnv): string {
    try {
        const parsed = new URL(value);
        if (parsed.protocol !== 'https:') {
            throw new Error('Unsupported protocol');
        }
        if (parsed.username || parsed.password) {
            throw new Error('Embedded credentials are not allowed');
        }
        assertEndpointUrlAllowed(parsed, env);

        return parsed.toString();
    } catch (error) {
        if (error instanceof TradingWebhookDeliveryError) {
            throw error;
        }
        throw new TradingWebhookDeliveryError(
            'INVALID_ENDPOINT_URL',
            'Webhook endpoint URL must be a valid https URL.',
        );
    }
}

function resolveEncryptionKey(env: NodeJS.ProcessEnv): Buffer {
    const rawKey = env.ENCRYPTION_KEY?.trim() ?? '';
    if (rawKey.length < 32) {
        throw new TradingWebhookDeliveryError(
            'ENCRYPTION_KEY_REQUIRED',
            'ENCRYPTION_KEY must be configured with at least 32 characters for webhook secret storage.',
        );
    }

    return crypto.createHash('sha256').update(rawKey, 'utf8').digest();
}

function encryptSecret(value: string, env: NodeJS.ProcessEnv): string {
    const key = resolveEncryptionKey(env);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptSecret(value: string, env: NodeJS.ProcessEnv): string {
    const key = resolveEncryptionKey(env);
    const [ivHex, authTagHex, encryptedHex] = value.split(':');

    if (!ivHex || !authTagHex || !encryptedHex) {
        throw new TradingWebhookDeliveryError(
            'ENCRYPTION_KEY_REQUIRED',
            'Stored webhook secret is malformed and cannot be decrypted.',
        );
    }

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(encryptedHex, 'hex')),
        decipher.final(),
    ]);
    return decrypted.toString('utf8');
}

function createSignature(body: string, signingSecret: string): string {
    return crypto.createHmac('sha256', signingSecret).update(body, 'utf8').digest('hex');
}

function parseDeliveryStatus(status: TradingWebhookDeliveryStatus): 'pending' | 'succeeded' | 'failed' {
    switch (status) {
        case TradingWebhookDeliveryStatus.PENDING:
            return 'pending';
        case TradingWebhookDeliveryStatus.SUCCEEDED:
            return 'succeeded';
        case TradingWebhookDeliveryStatus.FAILED:
        default:
            return 'failed';
    }
}

function extractRecordReference(record: TradingOutputEnvelope): TradingWebhookRecordReference {
    const payload = record.payload as Record<string, unknown>;
    return {
        contractKind: record.contractKind,
        recordId: record.recordId,
        signalKey: record.signalKey,
        backtestRunId: typeof payload.backtestRunId === 'string' ? payload.backtestRunId : null,
        indicatorInstanceId: typeof payload.indicatorInstanceId === 'string' ? payload.indicatorInstanceId : null,
        tradeRecordId: typeof payload.tradeRecordId === 'string' ? payload.tradeRecordId : null,
    };
}

function getRecordOccurredAt(record: TradingOutputEnvelope): string {
    const payload = record.payload as Record<string, unknown>;

    if (typeof payload.occurredAt === 'string') {
        return payload.occurredAt;
    }

    if (typeof payload.exitTime === 'string') {
        return payload.exitTime;
    }

    if (typeof payload.entryTime === 'string') {
        return payload.entryTime;
    }

    if (typeof payload.decidedAt === 'string') {
        return payload.decidedAt;
    }

    return record.emittedAt;
}

function compareRecordsDesc(left: TradingOutputEnvelope, right: TradingOutputEnvelope): number {
    const timestampDiff = new Date(getRecordOccurredAt(right)).getTime() - new Date(getRecordOccurredAt(left)).getTime();
    if (timestampDiff !== 0) {
        return timestampDiff;
    }

    const kindDiff = left.contractKind.localeCompare(right.contractKind);
    if (kindDiff !== 0) {
        return kindDiff;
    }

    return left.recordId.localeCompare(right.recordId);
}

function normalizeLimit(limit: number): number {
    return Math.min(Math.max(limit || DEFAULT_DELIVERY_LIMIT, 1), MAX_DELIVERY_LIMIT);
}

function toJsonValue<T>(value: T): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function hasConflictingContext(query: {
    backtestRunId: string | null;
    indicatorInstanceId: string | null;
}) {
    return Boolean(query.backtestRunId && query.indicatorInstanceId);
}

function normalizeConfiguredDeliveries(
    deliveries: TradingWebhookConfiguredDispatchInput['deliveries'],
) {
    const byKind = new Map<TradingOutputContractKind, number>();

    for (const delivery of deliveries) {
        if (!delivery || !isValidContractKind(delivery.contractKind)) {
            continue;
        }

        const limit = normalizeLimit(delivery.limit);
        const current = byKind.get(delivery.contractKind) ?? 0;
        byKind.set(delivery.contractKind, Math.max(current, limit));
    }

    return Array.from(byKind.entries()).map(([contractKind, limit]) => ({
        contractKind,
        limit,
    }));
}

export function createTradingWebhookDeliveryService(prisma: PrismaClient) {
    const contractService = new TradingOutputContractService();
    const exportService = new TradingExportService(prisma, contractService);
    return new TradingWebhookDeliveryService(prisma, exportService);
}

export class TradingWebhookDeliveryService {
    constructor(
        private readonly prisma: PrismaClient,
        private readonly exportService: Pick<TradingExportService, 'exportRecords'>,
        private readonly fetchImpl: TradingWebhookFetchLike = fetch as TradingWebhookFetchLike,
        private readonly env: NodeJS.ProcessEnv = process.env,
    ) {}

    async listEndpoints(): Promise<TradingWebhookEndpointSummary[]> {
        const endpoints = await this.prisma.tradingWebhookEndpoint.findMany({
            orderBy: [
                { createdAt: 'desc' },
                { id: 'desc' },
            ],
            include: {
                deliveries: {
                    orderBy: [
                        { attemptedAt: 'desc' },
                        { id: 'desc' },
                    ],
                    take: 1,
                },
            },
        });

        return endpoints.map((endpoint: any) => this.mapEndpointSummary(endpoint));
    }

    async createEndpoint(input: TradingWebhookEndpointInput): Promise<TradingWebhookEndpointSummary> {
        const name = requireNonEmptyString(input.name, 'name');
        const url = validateEndpointUrlWithEnv(
            requireNonEmptyString(input.url, 'url', 'INVALID_ENDPOINT_URL'),
            this.env,
        );
        const contractKinds = normalizeContractKinds(input.contractKinds);
        const signingSecret = requireNonEmptyString(input.signingSecret, 'signingSecret');
        const bearerToken = normalizeOptionalString(input.bearerToken);

        const endpoint = await this.prisma.tradingWebhookEndpoint.create({
            data: {
                name,
                url,
                contractKindsJson: contractKinds,
                bearerTokenCiphertext: bearerToken ? encryptSecret(bearerToken, this.env) : null,
                signingSecretCiphertext: encryptSecret(signingSecret, this.env),
                isActive: input.isActive ?? true,
            },
            include: {
                deliveries: {
                    orderBy: [
                        { attemptedAt: 'desc' },
                        { id: 'desc' },
                    ],
                    take: 1,
                },
            },
        });

        return this.mapEndpointSummary(endpoint);
    }

    async listDeliveries(query: TradingWebhookDeliveryListQuery): Promise<TradingWebhookDeliverySummary[]> {
        const deliveries = await this.prisma.tradingWebhookDelivery.findMany({
            where: query.endpointId ? { endpointId: query.endpointId } : undefined,
            orderBy: [
                { attemptedAt: 'desc' },
                { id: 'desc' },
            ],
            take: normalizeLimit(query.limit),
            include: {
                endpoint: {
                    select: {
                        id: true,
                        name: true,
                        url: true,
                    },
                },
            },
        });

        return deliveries.map((delivery: any) => this.mapDeliverySummary(delivery));
    }

    async deliverConfiguredOutputs(input: TradingWebhookConfiguredDispatchInput): Promise<TradingWebhookDispatchResult[]> {
        if (hasConflictingContext(input)) {
            throw new TradingWebhookDeliveryError(
                'INVALID_DELIVERY_CONTEXT',
                'Choose either a backtest run or an indicator instance, not both.',
            );
        }

        const deliveries = normalizeConfiguredDeliveries(input.deliveries);
        if (deliveries.length === 0) {
            return [];
        }

        const activeEndpoints = await this.prisma.tradingWebhookEndpoint.findMany({
            where: { isActive: true },
            include: {
                deliveries: {
                    orderBy: [
                        { attemptedAt: 'desc' },
                        { id: 'desc' },
                    ],
                    take: 1,
                },
            },
        });

        const results: TradingWebhookDispatchResult[] = [];
        for (const endpoint of activeEndpoints as any[]) {
            const endpointKinds = normalizeContractKinds(endpoint.contractKindsJson);

            for (const delivery of deliveries) {
                if (!endpointKinds.includes(delivery.contractKind)) {
                    continue;
                }

                try {
                    results.push(await this.deliverToEndpoint({
                        endpointId: endpoint.id,
                        backtestRunId: input.backtestRunId,
                        indicatorInstanceId: input.indicatorInstanceId,
                        contractKind: delivery.contractKind,
                        limit: delivery.limit,
                    }));
                } catch (error) {
                    if (
                        error instanceof TradingWebhookDeliveryError
                        && (
                            error.code === 'NO_RECORDS_TO_DELIVER'
                            || error.code === 'ENDPOINT_INACTIVE'
                            || error.code === 'ENDPOINT_NOT_FOUND'
                        )
                    ) {
                        continue;
                    }
                }
            }
        }

        return results;
    }

    async deliverToEndpoint(input: TradingWebhookDispatchInput): Promise<TradingWebhookDispatchResult> {
        if (hasConflictingContext(input)) {
            throw new TradingWebhookDeliveryError(
                'INVALID_DELIVERY_CONTEXT',
                'Choose either a backtest run or an indicator instance, not both.',
            );
        }

        const endpoint = await this.prisma.tradingWebhookEndpoint.findUnique({
            where: { id: input.endpointId },
            include: {
                deliveries: {
                    orderBy: [
                        { attemptedAt: 'desc' },
                        { id: 'desc' },
                    ],
                    take: 1,
                },
            },
        });

        if (!endpoint) {
            throw new TradingWebhookDeliveryError(
                'ENDPOINT_NOT_FOUND',
                `Webhook endpoint ${input.endpointId} was not found.`,
            );
        }

        if (!endpoint.isActive) {
            throw new TradingWebhookDeliveryError(
                'ENDPOINT_INACTIVE',
                `Webhook endpoint ${input.endpointId} is inactive.`,
            );
        }

        validateEndpointUrlWithEnv(endpoint.url, this.env);

        const contractKinds = normalizeContractKinds(endpoint.contractKindsJson);
        const limit = normalizeLimit(input.limit);
        const exportResult = await this.exportRecordsForEndpoint(contractKinds, {
            backtestRunId: input.backtestRunId,
            indicatorInstanceId: input.indicatorInstanceId,
            contractKind: input.contractKind,
            limit,
        });

        if (exportResult.records.length === 0) {
            throw new TradingWebhookDeliveryError(
                'NO_RECORDS_TO_DELIVER',
                'No export records matched the supplied delivery query.',
            );
        }

        const recordRefs = exportResult.records.map((record) => extractRecordReference(record));
        const pendingDelivery = await this.prisma.tradingWebhookDelivery.create({
            data: {
                endpointId: endpoint.id,
                status: TradingWebhookDeliveryStatus.PENDING,
                recordCount: exportResult.records.length,
                queryJson: toJsonValue(exportResult.query),
                recordRefsJson: toJsonValue(recordRefs),
            },
            include: {
                endpoint: {
                    select: {
                        id: true,
                        name: true,
                        url: true,
                    },
                },
            },
        });

        const deliveredAt = new Date().toISOString();
        const payload = {
            deliveryId: pendingDelivery.id,
            endpointId: endpoint.id,
            deliveredAt,
            query: exportResult.query,
            recordCount: exportResult.records.length,
            records: exportResult.records,
        };
        const body = JSON.stringify(payload);
        const signingSecret = decryptSecret(endpoint.signingSecretCiphertext, this.env);
        const bearerToken = endpoint.bearerTokenCiphertext
            ? decryptSecret(endpoint.bearerTokenCiphertext, this.env)
            : null;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        try {
            const response = await this.fetchImpl(endpoint.url, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-tvgit-delivery-id': pendingDelivery.id,
                    'x-tvgit-delivery-signature': `sha256=${createSignature(body, signingSecret)}`,
                    ...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {}),
                },
                body,
                signal: controller.signal,
            });
            clearTimeout(timeout);

            const responseBodyText = await response.text();
            const updatedDelivery = await this.prisma.tradingWebhookDelivery.update({
                where: { id: pendingDelivery.id },
                data: response.ok
                    ? {
                        status: TradingWebhookDeliveryStatus.SUCCEEDED,
                        httpStatus: response.status,
                        responseBodyText,
                        payloadJson: toJsonValue(payload),
                        deliveredAt: new Date(deliveredAt),
                    }
                    : {
                        status: TradingWebhookDeliveryStatus.FAILED,
                        httpStatus: response.status,
                        errorMessage: `Webhook returned HTTP ${response.status}.`,
                        responseBodyText,
                        payloadJson: toJsonValue(payload),
                    },
                include: {
                    endpoint: {
                        select: {
                            id: true,
                            name: true,
                            url: true,
                        },
                    },
                },
            });

            return {
                endpoint: this.mapEndpointSummary({
                    ...endpoint,
                    deliveries: [
                        {
                            attemptedAt: updatedDelivery.attemptedAt,
                            status: updatedDelivery.status,
                            deliveredAt: updatedDelivery.deliveredAt,
                        },
                    ],
                }),
                delivery: this.mapDeliverySummary(updatedDelivery as any),
                records: exportResult.records,
            };
        } catch (error) {
            clearTimeout(timeout);
            const message = error instanceof Error ? error.message : 'Webhook delivery failed.';
            const failedDelivery = await this.prisma.tradingWebhookDelivery.update({
                where: { id: pendingDelivery.id },
                data: {
                    status: TradingWebhookDeliveryStatus.FAILED,
                    errorMessage: message,
                    payloadJson: toJsonValue(payload),
                },
                include: {
                    endpoint: {
                        select: {
                            id: true,
                            name: true,
                            url: true,
                        },
                    },
                },
            });

            return {
                endpoint: this.mapEndpointSummary({
                    ...endpoint,
                    deliveries: [
                        {
                            attemptedAt: failedDelivery.attemptedAt,
                            status: failedDelivery.status,
                            deliveredAt: failedDelivery.deliveredAt,
                        },
                    ],
                }),
                delivery: this.mapDeliverySummary(failedDelivery as any),
                records: exportResult.records,
            };
        }
    }

    private async exportRecordsForEndpoint(
        endpointContractKinds: TradingOutputContractKind[],
        query: TradingWebhookExportQuery,
    ): Promise<ExportRecordsResult> {
        if (query.contractKind) {
            if (!endpointContractKinds.includes(query.contractKind)) {
                return {
                    records: [],
                    total: 0,
                    query: {
                        backtestRunId: query.backtestRunId,
                        indicatorInstanceId: query.indicatorInstanceId,
                        contractKind: query.contractKind,
                        limit: normalizeLimit(query.limit),
                    },
                    exportedAt: new Date().toISOString(),
                };
            }

            return this.exportService.exportRecords({
                backtestRunId: query.backtestRunId,
                indicatorInstanceId: query.indicatorInstanceId,
                contractKind: query.contractKind,
                limit: normalizeLimit(query.limit),
            });
        }

        const recordGroups = await Promise.all(
            endpointContractKinds.map((kind) => this.exportService.exportRecords({
                backtestRunId: query.backtestRunId,
                indicatorInstanceId: query.indicatorInstanceId,
                contractKind: kind,
                limit: normalizeLimit(query.limit),
            })),
        );

        const records = recordGroups
            .flatMap((result) => result.records)
            .sort(compareRecordsDesc)
            .slice(0, normalizeLimit(query.limit));

        return {
            records,
            total: recordGroups.reduce((sum, result) => sum + result.total, 0),
            query: {
                backtestRunId: query.backtestRunId,
                indicatorInstanceId: query.indicatorInstanceId,
                contractKind: null,
                limit: normalizeLimit(query.limit),
            },
            exportedAt: new Date().toISOString(),
        };
    }

    private mapEndpointSummary(endpoint: {
        id: string;
        name: string;
        url: string;
        contractKindsJson: unknown;
        bearerTokenCiphertext: string | null;
        signingSecretCiphertext: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        deliveries?: Array<{
            id?: string;
            attemptedAt: Date;
            status: TradingWebhookDeliveryStatus;
            deliveredAt?: Date | null;
        }>;
    }): TradingWebhookEndpointSummary {
        const latestDelivery = endpoint.deliveries?.[0];
        return {
            id: endpoint.id,
            name: endpoint.name,
            url: endpoint.url,
            contractKinds: normalizeContractKinds(endpoint.contractKindsJson),
            hasBearerToken: Boolean(endpoint.bearerTokenCiphertext),
            hasSigningSecret: Boolean(endpoint.signingSecretCiphertext),
            isActive: endpoint.isActive,
            createdAt: endpoint.createdAt.toISOString(),
            updatedAt: endpoint.updatedAt.toISOString(),
            lastDeliveryAt: latestDelivery?.deliveredAt?.toISOString() ?? latestDelivery?.attemptedAt.toISOString() ?? null,
            lastDeliveryStatus: latestDelivery ? parseDeliveryStatus(latestDelivery.status) : null,
        };
    }

    private mapDeliverySummary(delivery: {
        id: string;
        endpointId: string;
        endpoint: { name: string; url: string };
        status: TradingWebhookDeliveryStatus;
        httpStatus: number | null;
        errorMessage: string | null;
        responseBodyText: string | null;
        recordCount: number;
        attemptedAt: Date;
        deliveredAt: Date | null;
        queryJson: unknown;
        recordRefsJson: unknown;
    }): TradingWebhookDeliverySummary {
        return {
            id: delivery.id,
            endpointId: delivery.endpointId,
            endpointName: delivery.endpoint.name,
            endpointUrl: delivery.endpoint.url,
            status: parseDeliveryStatus(delivery.status),
            httpStatus: delivery.httpStatus,
            errorMessage: delivery.errorMessage,
            responseBodyText: delivery.responseBodyText,
            recordCount: delivery.recordCount,
            attemptedAt: delivery.attemptedAt.toISOString(),
            deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
            query: this.parseExportQuery(delivery.queryJson),
            recordRefs: this.parseRecordRefs(delivery.recordRefsJson),
        };
    }

    private parseExportQuery(value: unknown): ExportRecordsQuery | null {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return null;
        }

        const query = value as Record<string, unknown>;
        const contractKind = isValidContractKind(query.contractKind) ? query.contractKind : null;
        const limit = typeof query.limit === 'number' && Number.isFinite(query.limit)
            ? Number(query.limit)
            : DEFAULT_DELIVERY_LIMIT;

        return {
            backtestRunId: normalizeOptionalString(query.backtestRunId),
            indicatorInstanceId: normalizeOptionalString(query.indicatorInstanceId),
            contractKind,
            limit,
        };
    }

    private parseRecordRefs(value: unknown): TradingWebhookRecordReference[] {
        if (!Array.isArray(value)) {
            return [];
        }

        return value.flatMap((item) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
                return [];
            }

            const ref = item as Record<string, unknown>;
            if (!isValidContractKind(ref.contractKind)) {
                return [];
            }

            const recordId = normalizeOptionalString(ref.recordId);
            const signalKey = normalizeOptionalString(ref.signalKey);
            if (!recordId || !signalKey) {
                return [];
            }

            return [{
                contractKind: ref.contractKind,
                recordId,
                signalKey,
                backtestRunId: normalizeOptionalString(ref.backtestRunId),
                indicatorInstanceId: normalizeOptionalString(ref.indicatorInstanceId),
                tradeRecordId: normalizeOptionalString(ref.tradeRecordId),
            }];
        });
    }
}
