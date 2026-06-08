import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { TradingWebhookDeliveryStatus } from '@prisma/client';
import { TradingWebhookDeliveryService } from './TradingWebhookDeliveryService';
import { TradingOutputEnvelope } from './TradingOutputContractService';

type EndpointRow = {
    id: string;
    name: string;
    url: string;
    contractKindsJson: unknown;
    bearerTokenCiphertext: string | null;
    signingSecretCiphertext: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
};

type DeliveryRow = {
    id: string;
    endpointId: string;
    status: TradingWebhookDeliveryStatus;
    httpStatus: number | null;
    errorMessage: string | null;
    responseBodyText: string | null;
    recordCount: number;
    queryJson: unknown;
    payloadJson: unknown;
    recordRefsJson: unknown;
    attemptedAt: Date;
    deliveredAt: Date | null;
    createdAt: Date;
};

function makeEnvelope(
    contractKind: TradingOutputEnvelope['contractKind'],
    recordId: string,
    emittedAt: string,
    payload: Record<string, unknown>,
): TradingOutputEnvelope {
    return {
        contractKind,
        contractVersion: 1,
        recordId,
        signalKey: 'songTrap@v3',
        emittedAt,
        payload,
    };
}

function makePrismaMock() {
    const endpoints: EndpointRow[] = [];
    const deliveries: DeliveryRow[] = [];
    let endpointSequence = 1;
    let deliverySequence = 1;

    const listEndpointDeliveries = (endpointId: string) => deliveries
        .filter((delivery) => delivery.endpointId === endpointId)
        .sort((left, right) => right.attemptedAt.getTime() - left.attemptedAt.getTime() || right.id.localeCompare(left.id));

    return {
        endpoints,
        deliveries,
        prisma: {
            tradingWebhookEndpoint: {
                findMany: async (args?: { where?: { isActive?: boolean } }) => endpoints
                    .filter((endpoint) => args?.where?.isActive === undefined || endpoint.isActive === args.where.isActive)
                    .map((endpoint) => ({
                        ...endpoint,
                        deliveries: listEndpointDeliveries(endpoint.id).slice(0, 1),
                    })),
                create: async (args: { data: Omit<EndpointRow, 'id' | 'createdAt' | 'updatedAt'> }) => {
                    const now = new Date(`2026-03-11T08:00:0${endpointSequence}.000Z`);
                    const endpoint: EndpointRow = {
                        id: `endpoint-${endpointSequence++}`,
                        createdAt: now,
                        updatedAt: now,
                        ...args.data,
                    };
                    endpoints.push(endpoint);
                    return {
                        ...endpoint,
                        deliveries: [],
                    };
                },
                findUnique: async (args: { where: { id: string } }) => {
                    const endpoint = endpoints.find((item) => item.id === args.where.id);
                    if (!endpoint) {
                        return null;
                    }

                    return {
                        ...endpoint,
                        deliveries: listEndpointDeliveries(endpoint.id).slice(0, 1),
                    };
                },
            },
            tradingWebhookDelivery: {
                findMany: async (args?: { where?: { endpointId?: string } | undefined; take?: number }) => {
                    const filtered = args?.where?.endpointId
                        ? deliveries.filter((delivery) => delivery.endpointId === args.where?.endpointId)
                        : deliveries.slice();

                    return filtered
                        .sort((left, right) => right.attemptedAt.getTime() - left.attemptedAt.getTime() || right.id.localeCompare(left.id))
                        .slice(0, args?.take ?? filtered.length)
                        .map((delivery) => ({
                            ...delivery,
                            endpoint: {
                                id: delivery.endpointId,
                                name: endpoints.find((endpoint) => endpoint.id === delivery.endpointId)?.name ?? 'unknown',
                                url: endpoints.find((endpoint) => endpoint.id === delivery.endpointId)?.url ?? 'https://unknown',
                            },
                        }));
                },
                create: async (args: { data: Omit<DeliveryRow, 'id' | 'httpStatus' | 'errorMessage' | 'responseBodyText' | 'payloadJson' | 'attemptedAt' | 'deliveredAt' | 'createdAt'> }) => {
                    const now = new Date(`2026-03-11T09:00:0${deliverySequence}.000Z`);
                    const delivery: DeliveryRow = {
                        id: `delivery-${deliverySequence++}`,
                        httpStatus: null,
                        errorMessage: null,
                        responseBodyText: null,
                        payloadJson: null,
                        attemptedAt: now,
                        deliveredAt: null,
                        createdAt: now,
                        ...args.data,
                    };
                    deliveries.push(delivery);
                    return {
                        ...delivery,
                        endpoint: {
                            id: delivery.endpointId,
                            name: endpoints.find((endpoint) => endpoint.id === delivery.endpointId)?.name ?? 'unknown',
                            url: endpoints.find((endpoint) => endpoint.id === delivery.endpointId)?.url ?? 'https://unknown',
                        },
                    };
                },
                update: async (args: { where: { id: string }; data: Partial<DeliveryRow> }) => {
                    const delivery = deliveries.find((item) => item.id === args.where.id);
                    if (!delivery) {
                        throw new Error(`Delivery ${args.where.id} not found`);
                    }

                    Object.assign(delivery, args.data);
                    return {
                        ...delivery,
                        endpoint: {
                            id: delivery.endpointId,
                            name: endpoints.find((endpoint) => endpoint.id === delivery.endpointId)?.name ?? 'unknown',
                            url: endpoints.find((endpoint) => endpoint.id === delivery.endpointId)?.url ?? 'https://unknown',
                        },
                    };
                },
            },
        } as never,
    };
}

describe('TradingWebhookDeliveryService', () => {
    const env = {
        ENCRYPTION_KEY: '12345678901234567890123456789012',
        TRADING_WEBHOOK_ALLOWED_HOSTS: 'example.com,*.example.com',
    } as NodeJS.ProcessEnv;

    it('creates endpoints with encrypted secrets and default contract kinds', async () => {
        const prismaState = makePrismaMock();
        const service = new TradingWebhookDeliveryService(
            prismaState.prisma,
            { exportRecords: async () => ({ records: [], total: 0, query: { backtestRunId: null, indicatorInstanceId: null, contractKind: null, limit: 100 }, exportedAt: '' }) },
            (async () => ({ ok: true, status: 200, text: async () => 'ok' })) as never,
            env,
        );

        const endpoint = await service.createEndpoint({
            name: 'Ops sink',
            url: 'https://example.com/webhook',
            signingSecret: 'super-secret',
            bearerToken: 'bearer-token',
        });

        assert.equal(endpoint.name, 'Ops sink');
        assert.deepEqual(endpoint.contractKinds, [
            'signal-event',
            'execution-event',
            'trade-outcome',
            'investigation-outcome',
        ]);
        assert.equal(endpoint.hasBearerToken, true);
        assert.equal(endpoint.hasSigningSecret, true);
        assert.notEqual(prismaState.endpoints[0].signingSecretCiphertext, 'super-secret');
        assert.notEqual(prismaState.endpoints[0].bearerTokenCiphertext, 'bearer-token');
    });

    it('rejects non-https webhook endpoints', async () => {
        const prismaState = makePrismaMock();
        const service = new TradingWebhookDeliveryService(
            prismaState.prisma,
            { exportRecords: async () => ({ records: [], total: 0, query: { backtestRunId: null, indicatorInstanceId: null, contractKind: null, limit: 100 }, exportedAt: '' }) },
            (async () => ({ ok: true, status: 200, text: async () => 'ok' })) as never,
            env,
        );

        await assert.rejects(
            () => service.createEndpoint({
                name: 'Insecure sink',
                url: 'http://example.com/webhook',
                signingSecret: 'super-secret',
            }),
            /valid https URL/,
        );
    });

    it('rejects webhook endpoints that are outside the configured allowlist', async () => {
        const prismaState = makePrismaMock();
        const service = new TradingWebhookDeliveryService(
            prismaState.prisma,
            { exportRecords: async () => ({ records: [], total: 0, query: { backtestRunId: null, indicatorInstanceId: null, contractKind: null, limit: 100 }, exportedAt: '' }) },
            (async () => ({ ok: true, status: 200, text: async () => 'ok' })) as never,
            env,
        );

        await assert.rejects(
            () => service.createEndpoint({
                name: 'Unknown sink',
                url: 'https://attacker.invalid/webhook',
                signingSecret: 'super-secret',
            }),
            /TRADING_WEBHOOK_ALLOWED_HOSTS/,
        );
    });

    it('rejects localhost webhook endpoints even if a caller attempts to configure them', async () => {
        const prismaState = makePrismaMock();
        const service = new TradingWebhookDeliveryService(
            prismaState.prisma,
            { exportRecords: async () => ({ records: [], total: 0, query: { backtestRunId: null, indicatorInstanceId: null, contractKind: null, limit: 100 }, exportedAt: '' }) },
            (async () => ({ ok: true, status: 200, text: async () => 'ok' })) as never,
            {
                ...env,
                TRADING_WEBHOOK_ALLOWED_HOSTS: 'localhost',
            },
        );

        await assert.rejects(
            () => service.createEndpoint({
                name: 'Loopback sink',
                url: 'https://localhost/webhook',
                signingSecret: 'super-secret',
            }),
            /private network address/,
        );
    });

    it('delivers records with signed payloads and persists traceability refs', async () => {
        const prismaState = makePrismaMock();
        const sentRequests: Array<{ url: string; init: { headers: Record<string, string>; body: string } }> = [];
        const sourceRecords = [
            makeEnvelope('signal-event', 'evt-1', '2026-03-11T08:00:00.000Z', {
                occurredAt: '2026-03-11T08:00:00.000Z',
                backtestRunId: 'run-1',
                indicatorInstanceId: null,
                tradeRecordId: null,
            }),
            makeEnvelope('trade-outcome', 'trade-1', '2026-03-11T09:00:00.000Z', {
                exitTime: '2026-03-11T09:00:00.000Z',
                backtestRunId: 'run-1',
                tradeRecordId: 'trade-1',
            }),
        ];
        const exportRecords = async (query: { contractKind: TradingOutputEnvelope['contractKind'] | null; limit: number }) => {
            const filteredRecords = query.contractKind
                ? sourceRecords.filter((record) => record.contractKind === query.contractKind)
                : sourceRecords;

            return {
                records: filteredRecords,
                total: filteredRecords.length,
                query: {
                    backtestRunId: 'run-1',
                    indicatorInstanceId: null,
                    contractKind: query.contractKind,
                    limit: query.limit,
                },
                exportedAt: '2026-03-11T09:00:00.000Z',
            };
        };
        const service = new TradingWebhookDeliveryService(
            prismaState.prisma,
            { exportRecords },
            async (url, init) => {
                sentRequests.push({
                    url,
                    init: {
                        headers: init.headers,
                        body: init.body,
                    },
                });
                return {
                    ok: true,
                    status: 202,
                    text: async () => 'accepted',
                };
            },
            env,
        );

        const endpoint = await service.createEndpoint({
            name: 'Ops sink',
            url: 'https://example.com/webhook',
            signingSecret: 'super-secret',
            bearerToken: 'bearer-token',
            contractKinds: ['signal-event', 'trade-outcome'],
        });

        const result = await service.deliverToEndpoint({
            endpointId: endpoint.id,
            backtestRunId: 'run-1',
            indicatorInstanceId: null,
            contractKind: null,
            limit: 100,
        });

        assert.equal(sentRequests.length, 1);
        assert.equal(sentRequests[0].url, 'https://example.com/webhook');
        assert.equal(sentRequests[0].init.headers.authorization, 'Bearer bearer-token');
        assert.ok(sentRequests[0].init.headers['x-tvgit-delivery-signature'].startsWith('sha256='));

        const payload = JSON.parse(sentRequests[0].init.body) as { deliveryId: string; records: TradingOutputEnvelope[] };
        assert.equal(payload.deliveryId, result.delivery.id);
        assert.equal(payload.records.length, 2);
        assert.deepEqual(
            result.delivery.recordRefs.map((ref) => ref.recordId),
            ['trade-1', 'evt-1'],
        );
        assert.equal(result.delivery.status, 'succeeded');
        assert.equal(result.delivery.httpStatus, 202);
        assert.equal(prismaState.deliveries[0].status, TradingWebhookDeliveryStatus.SUCCEEDED);
    });

    it('records failed downstream deliveries without dropping source linkage', async () => {
        const prismaState = makePrismaMock();
        const exportRecords = async () => ({
            records: [
                makeEnvelope('execution-event', 'trace-1', '2026-03-11T08:15:00.000Z', {
                    occurredAt: '2026-03-11T08:15:00.000Z',
                    backtestRunId: 'run-2',
                    indicatorInstanceId: 'inst-2',
                    tradeRecordId: null,
                }),
            ],
                    total: 1,
                    query: {
                        backtestRunId: null,
                        indicatorInstanceId: 'inst-2',
                        contractKind: 'execution-event' as const,
                        limit: 25,
                    },
            exportedAt: '2026-03-11T08:15:00.000Z',
        });
        const service = new TradingWebhookDeliveryService(
            prismaState.prisma,
            { exportRecords },
            async () => {
                throw new Error('timeout');
            },
            env,
        );

        const endpoint = await service.createEndpoint({
            name: 'Ops sink',
            url: 'https://example.com/webhook',
            signingSecret: 'super-secret',
            contractKinds: ['execution-event'],
        });

        const result = await service.deliverToEndpoint({
            endpointId: endpoint.id,
            backtestRunId: null,
            indicatorInstanceId: 'inst-2',
            contractKind: 'execution-event',
            limit: 25,
        });

        assert.equal(result.delivery.status, 'failed');
        assert.equal(result.delivery.errorMessage, 'timeout');
        assert.equal(result.delivery.recordRefs[0].recordId, 'trace-1');
        assert.equal(prismaState.deliveries[0].status, TradingWebhookDeliveryStatus.FAILED);
        assert.equal(prismaState.deliveries[0].errorMessage, 'timeout');
    });

    it('auto-dispatches only matching active endpoint kinds', async () => {
        const prismaState = makePrismaMock();
        const sentUrls: string[] = [];
        const exportRecords = async (query: { contractKind: TradingOutputEnvelope['contractKind'] | null; limit: number }) => ({
            records: query.contractKind === 'signal-event'
                ? [makeEnvelope('signal-event', 'evt-1', '2026-03-11T08:00:00.000Z', {
                    occurredAt: '2026-03-11T08:00:00.000Z',
                    backtestRunId: null,
                    indicatorInstanceId: 'inst-1',
                })]
                : [],
            total: query.contractKind === 'signal-event' ? 1 : 0,
            query: {
                backtestRunId: null,
                indicatorInstanceId: 'inst-1',
                contractKind: query.contractKind,
                limit: query.limit,
            },
            exportedAt: '2026-03-11T08:00:00.000Z',
        });
        const service = new TradingWebhookDeliveryService(
            prismaState.prisma,
            { exportRecords },
            async (url) => {
                sentUrls.push(url);
                return {
                    ok: true,
                    status: 202,
                    text: async () => 'accepted',
                };
            },
            env,
        );

        await service.createEndpoint({
            name: 'Signal sink',
            url: 'https://signal.example.com/webhook',
            signingSecret: 'super-secret',
            contractKinds: ['signal-event'],
        });
        await service.createEndpoint({
            name: 'Trade sink',
            url: 'https://trade.example.com/webhook',
            signingSecret: 'super-secret',
            contractKinds: ['trade-outcome'],
        });
        await service.createEndpoint({
            name: 'Inactive sink',
            url: 'https://inactive.example.com/webhook',
            signingSecret: 'super-secret',
            contractKinds: ['signal-event'],
            isActive: false,
        });

        const results = await service.deliverConfiguredOutputs({
            backtestRunId: null,
            indicatorInstanceId: 'inst-1',
            deliveries: [{
                contractKind: 'signal-event',
                limit: 1,
            }],
        });

        assert.equal(results.length, 1);
        assert.deepEqual(sentUrls, ['https://signal.example.com/webhook']);
    });

    it('surfaces the latest delivery state in endpoint summaries', async () => {
        const prismaState = makePrismaMock();
        const service = new TradingWebhookDeliveryService(
            prismaState.prisma,
            {
                exportRecords: async () => ({
                    records: [
                        makeEnvelope('signal-event', 'evt-1', '2026-03-11T08:00:00.000Z', {
                            occurredAt: '2026-03-11T08:00:00.000Z',
                            backtestRunId: 'run-1',
                        }),
                    ],
                    total: 1,
                    query: {
                        backtestRunId: 'run-1',
                        indicatorInstanceId: null,
                        contractKind: 'signal-event',
                        limit: 10,
                    },
                    exportedAt: '2026-03-11T08:00:00.000Z',
                }),
            },
            async () => ({
                ok: false,
                status: 500,
                text: async () => 'boom',
            }),
            env,
        );

        const endpoint = await service.createEndpoint({
            name: 'Ops sink',
            url: 'https://example.com/webhook',
            signingSecret: 'super-secret',
            contractKinds: ['signal-event'],
        });

        await service.deliverToEndpoint({
            endpointId: endpoint.id,
            backtestRunId: 'run-1',
            indicatorInstanceId: null,
            contractKind: 'signal-event',
            limit: 10,
        });

        const endpoints = await service.listEndpoints();

        assert.equal(endpoints.length, 1);
        assert.equal(endpoints[0].lastDeliveryStatus, 'failed');
        assert.ok(endpoints[0].lastDeliveryAt);
    });
});
