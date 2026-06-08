import express from 'express';
import { PrismaClient } from '@prisma/client';

import { requireAuthenticatedRequest } from '../middleware/auth';
import { requireTradingCapability } from '../middleware/featureFlag';
import { ExternalActionDeploymentService } from '../services/trading/externalAction/ExternalActionDeploymentService';
import { BullMqExternalActionDeliveryJobPublisher } from '../services/trading/externalAction/ExternalActionDeliveryQueue';
import { PostgresExternalActionStore } from '../services/trading/externalAction/ExternalSignalStore';
import { ExternalActionReplayService } from '../services/trading/externalAction/ExternalActionReplayService';
import {
    ExternalActionActor,
    ExternalActionError,
    ExternalActionStore,
    resolveExternalActionOwnerUserId,
    toExternalDeploymentView,
} from '../services/trading/externalAction/types';

function parseOptionalString(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}

function parsePositiveInteger(value: unknown, fallback: number) {
    if (value === undefined || value === null || value === '') {
        return fallback;
    }

    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function mapExternalActionError(error: unknown) {
    if (error instanceof ExternalActionError) {
        return {
            status: error.statusCode,
            body: {
                success: false,
                error: {
                    code: error.code,
                    message: error.message,
                    domain: 'trading.external-action',
                },
            },
        };
    }

    return {
        status: 500,
        body: {
            success: false,
            error: {
                code: 'EXTERNAL_ACTION_FAILED',
                message: 'Failed to process the external action request.',
                domain: 'trading.external-action',
            },
        },
    };
}

function readScopedOwnerUserId(query: { userId?: unknown }) {
    if (typeof query.userId !== 'string') {
        return null;
    }

    const normalized = query.userId.trim();
    return normalized.length > 0 ? normalized : null;
}

function readActor(res: express.Response): ExternalActionActor {
    const locals = (res.locals ?? {}) as { authorizedUser?: { id?: string; role?: 'ADMIN' | 'USER' } };
    if (!locals.authorizedUser?.id || !locals.authorizedUser?.role) {
        throw new ExternalActionError(
            'EXTERNAL_ACTION_FORBIDDEN',
            401,
            'Authentication is required before the external action lane can be used.',
        );
    }

    return {
        id: locals.authorizedUser.id,
        role: locals.authorizedUser.role,
    };
}

export function registerTradingExternalActionRoutes(
    app: express.Application,
    prisma: PrismaClient,
    services?: {
        deploymentService?: Pick<ExternalActionDeploymentService, 'createDeploymentForActor' | 'listDeploymentsForActor' | 'enableDeploymentForActor' | 'pauseDeploymentForActor' | 'archiveDeploymentForActor'>;
        store?: ExternalActionStore;
        replayService?: Pick<ExternalActionReplayService, 'replayEvent'>;
    },
) {
    const store = services?.store ?? new PostgresExternalActionStore(process.env);
    const deploymentService = services?.deploymentService ?? new ExternalActionDeploymentService(prisma, store, process.env);
    const replayService = services?.replayService ?? new ExternalActionReplayService(
        store,
        new BullMqExternalActionDeliveryJobPublisher(process.env),
    );

    app.get(
        '/api/trading/external-actions/deployments',
        requireAuthenticatedRequest,
        requireTradingCapability('read'),
        async (req, res) => {
            const limit = parsePositiveInteger(req.query.limit, 100);
            if (limit === null) {
                res.status(400).json({
                    success: false,
                    error: {
                        code: 'INVALID_PARAMS',
                        message: 'limit must be a positive integer when supplied.',
                        domain: 'trading.external-action',
                    },
                });
                return;
            }

            try {
                const actor = readActor(res);
                const deployments = await deploymentService.listDeploymentsForActor(actor, {
                    indicatorInstanceId: parseOptionalString(req.query.indicatorInstanceId),
                    status: parseOptionalString(req.query.status) as never,
                    limit,
                }, {
                    ownerUserId: readScopedOwnerUserId(req.query as { userId?: unknown }),
                });
                res.json({
                    success: true,
                    data: {
                        deployments: deployments.map(toExternalDeploymentView),
                        evaluatedAt: new Date().toISOString(),
                    },
                });
            } catch (error) {
                const mapped = mapExternalActionError(error);
                res.status(mapped.status).json(mapped.body);
            }
        },
    );

    app.post(
        '/api/trading/external-actions/deployments',
        requireAuthenticatedRequest,
        requireTradingCapability('write'),
        async (req, res) => {
            try {
                const actor = readActor(res);
                const deployment = await deploymentService.createDeploymentForActor({
                    indicatorInstanceId: parseOptionalString(req.body?.indicatorInstanceId) ?? '',
                    telegramBotToken: parseOptionalString(req.body?.telegramBotToken) ?? '',
                    telegramBotLabel: parseOptionalString(req.body?.telegramBotLabel),
                    telegramChatId: parseOptionalString(req.body?.telegramChatId) ?? '',
                    telegramChatLabel: parseOptionalString(req.body?.telegramChatLabel),
                    messageTemplateKind: parseOptionalString(req.body?.messageTemplateKind),
                }, actor, {
                    ownerUserId: readScopedOwnerUserId(req.query as { userId?: unknown }),
                });
                res.status(201).json({
                    success: true,
                    data: toExternalDeploymentView(deployment),
                });
            } catch (error) {
                const mapped = mapExternalActionError(error);
                res.status(mapped.status).json(mapped.body);
            }
        },
    );

    app.post(
        '/api/trading/external-actions/deployments/:id/enable',
        requireAuthenticatedRequest,
        requireTradingCapability('write'),
        async (req, res) => {
            try {
                const actor = readActor(res);
                const deployment = await deploymentService.enableDeploymentForActor(
                    String(req.params.id ?? ''),
                    actor,
                    {
                        ownerUserId: readScopedOwnerUserId(req.query as { userId?: unknown }),
                    },
                );
                res.json({
                    success: true,
                    data: toExternalDeploymentView(deployment),
                });
            } catch (error) {
                const mapped = mapExternalActionError(error);
                res.status(mapped.status).json(mapped.body);
            }
        },
    );

    app.post(
        '/api/trading/external-actions/deployments/:id/pause',
        requireAuthenticatedRequest,
        requireTradingCapability('write'),
        async (req, res) => {
            try {
                const actor = readActor(res);
                const deployment = await deploymentService.pauseDeploymentForActor(
                    String(req.params.id ?? ''),
                    actor,
                    parseOptionalString(req.body?.reason),
                    {
                        ownerUserId: readScopedOwnerUserId(req.query as { userId?: unknown }),
                    },
                );
                res.json({
                    success: true,
                    data: toExternalDeploymentView(deployment),
                });
            } catch (error) {
                const mapped = mapExternalActionError(error);
                res.status(mapped.status).json(mapped.body);
            }
        },
    );

    app.post(
        '/api/trading/external-actions/deployments/:id/archive',
        requireAuthenticatedRequest,
        requireTradingCapability('write'),
        async (req, res) => {
            try {
                const actor = readActor(res);
                const deployment = await deploymentService.archiveDeploymentForActor(
                    String(req.params.id ?? ''),
                    actor,
                    parseOptionalString(req.body?.reason),
                    {
                        ownerUserId: readScopedOwnerUserId(req.query as { userId?: unknown }),
                    },
                );
                res.json({
                    success: true,
                    data: toExternalDeploymentView(deployment),
                });
            } catch (error) {
                const mapped = mapExternalActionError(error);
                res.status(mapped.status).json(mapped.body);
            }
        },
    );

    app.get(
        '/api/trading/external-actions/events',
        requireAuthenticatedRequest,
        requireTradingCapability('read'),
        async (req, res) => {
            const limit = parsePositiveInteger(req.query.limit, 100);
            if (limit === null) {
                res.status(400).json({
                    success: false,
                    error: {
                        code: 'INVALID_PARAMS',
                        message: 'limit must be a positive integer when supplied.',
                        domain: 'trading.external-action',
                    },
                });
                return;
            }

            try {
                const actor = readActor(res);
                const events = await store.listActionableEvents({
                    ownerUserId: resolveExternalActionOwnerUserId(
                        actor,
                        readScopedOwnerUserId(req.query as { userId?: unknown }),
                        true,
                    ),
                    externalDeploymentId: parseOptionalString(req.query.externalDeploymentId),
                    indicatorInstanceId: parseOptionalString(req.query.indicatorInstanceId),
                    status: parseOptionalString(req.query.status) as never,
                    limit,
                });
                res.json({
                    success: true,
                    data: {
                        events,
                        evaluatedAt: new Date().toISOString(),
                    },
                });
            } catch (error) {
                const mapped = mapExternalActionError(error);
                res.status(mapped.status).json(mapped.body);
            }
        },
    );

    app.get(
        '/api/trading/external-actions/deliveries',
        requireAuthenticatedRequest,
        requireTradingCapability('read'),
        async (req, res) => {
            const limit = parsePositiveInteger(req.query.limit, 100);
            if (limit === null) {
                res.status(400).json({
                    success: false,
                    error: {
                        code: 'INVALID_PARAMS',
                        message: 'limit must be a positive integer when supplied.',
                        domain: 'trading.external-action',
                    },
                });
                return;
            }

            try {
                const actor = readActor(res);
                const deliveries = await store.listDeliveries({
                    ownerUserId: resolveExternalActionOwnerUserId(
                        actor,
                        readScopedOwnerUserId(req.query as { userId?: unknown }),
                        true,
                    ),
                    externalActionEventId: parseOptionalString(req.query.externalActionEventId),
                    externalDeploymentId: parseOptionalString(req.query.externalDeploymentId),
                    limit,
                });
                res.json({
                    success: true,
                    data: {
                        deliveries,
                        evaluatedAt: new Date().toISOString(),
                    },
                });
            } catch (error) {
                const mapped = mapExternalActionError(error);
                res.status(mapped.status).json(mapped.body);
            }
        },
    );

    app.get(
        '/api/trading/external-actions/health',
        requireAuthenticatedRequest,
        requireTradingCapability('read'),
        async (_req, res) => {
            try {
                const summary = await store.getIntegrationHealthSummary();
                res.json({ success: true, data: summary });
            } catch (error) {
                const mapped = mapExternalActionError(error);
                res.status(mapped.status).json(mapped.body);
            }
        },
    );

    app.post(
        '/api/trading/external-actions/events/:id/replay',
        requireAuthenticatedRequest,
        requireTradingCapability('write'),
        async (req, res) => {
            try {
                const actor = readActor(res);
                const replayJob = await replayService.replayEvent(
                    String(req.params.id ?? ''),
                    actor,
                    {
                        ownerUserId: readScopedOwnerUserId(req.query as { userId?: unknown }),
                    },
                );
                res.status(202).json({
                    success: true,
                    data: replayJob,
                });
            } catch (error) {
                const mapped = mapExternalActionError(error);
                res.status(mapped.status).json(mapped.body);
            }
        },
    );
}
