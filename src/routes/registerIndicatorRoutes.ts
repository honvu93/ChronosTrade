import { Express } from 'express';
import { PrismaClient } from '@prisma/client';
import { IndicatorInstanceService } from '../services/signals/IndicatorInstanceService';
import { IndicatorPromotionService } from '../services/signals/IndicatorPromotionService';
import { IndicatorAlertService } from '../services/signals/IndicatorAlertService';
import { ComposedSignalService } from '../services/signals/ComposedSignalService';
import {
    IndicatorCatalogService,
    IndicatorCatalogServiceError,
} from '../services/signals/IndicatorCatalogService';
import { SignalRegistry } from '../services/signals/SignalRegistry';
import { createDefaultBlockRegistry } from '../services/signals/blocks/createDefaultBlockRegistry';
import { ComposedSignalValidationError } from '../services/signals/composedSignalValidation';
import { TechIndicatorRegistry } from '../services/signals/blocks/TechIndicatorRegistry';

type RouteGuard = import('express').RequestHandler[];
type RouteServices = {
    blockRegistry?: TechIndicatorRegistry;
    indicatorCatalogService?: IndicatorCatalogService;
    composedSignalService?: ComposedSignalService;
};

const getRouteParam = (value: string | string[] | undefined) => Array.isArray(value)
    ? value[0] ?? ''
    : value ?? '';

const MAX_EVENT_PAGE_SIZE = 500;

const parseBoundedPositiveInteger = (
    value: unknown,
    {
        defaultValue,
        max,
    }: {
        defaultValue: number;
        max: number;
    },
) => {
    if (value === undefined || value === null || value === '') {
        return defaultValue;
    }

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        return null;
    }

    return Math.min(parsed, max);
};

const parseNonNegativeInteger = (value: unknown, defaultValue = 0) => {
    if (value === undefined || value === null || value === '') {
        return defaultValue;
    }

    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
};

const respondInternalError = (
    res: import('express').Response,
    scope: string,
    message: string,
    error: unknown,
) => {
    console.error(`[IndicatorRoutes:${scope}]`, error);
    return res.status(500).json({ error: message });
};

const readActorUserId = (res: import('express').Response) => {
    const locals = (res.locals ?? {}) as { authorizedUser?: { id?: string } };
    return locals.authorizedUser?.id ?? 'system:unknown-actor';
};

const respondCatalogError = (
    res: import('express').Response,
    scope: string,
    error: unknown,
) => {
    if (error instanceof IndicatorCatalogServiceError) {
        return res.status(error.statusCode).json({
            error: error.message,
            code: error.code,
            reasons: error.reasons,
        });
    }

    return respondInternalError(res, scope, 'Failed to process the indicator catalog request.', error);
};

export function registerIndicatorRoutes(
    app: Express,
    prisma: PrismaClient,
    guards: {
        signalOnly?: RouteGuard;
        signalOrEngine?: RouteGuard;
        adminOnly?: RouteGuard;
    } = {},
    services: RouteServices = {},
) {
    const instanceService = new IndicatorInstanceService(prisma);
    const promotionService = new IndicatorPromotionService(prisma, instanceService);
    const alertService = new IndicatorAlertService(prisma);
    const blockRegistry = services.blockRegistry ?? createDefaultBlockRegistry();
    const indicatorCatalogService = services.indicatorCatalogService ?? new IndicatorCatalogService(prisma, blockRegistry);
    const composedSignalService = services.composedSignalService ?? new ComposedSignalService(
        prisma,
        SignalRegistry.getInstance(),
        blockRegistry,
        indicatorCatalogService,
    );
    const signalOnly = guards.signalOnly ?? [];
    const signalOrEngine = guards.signalOrEngine ?? signalOnly;
    const adminOnly = guards.adminOnly ?? [];

    // ─── Tech Indicator Catalog ────────────────────────────────────────────
    // Returns all available indicator blocks for the Signal Composer UI.
    // Frontend uses this to populate the left panel of the composer.
    app.get('/api/tech-indicators', ...signalOrEngine, async (_req, res) => {
        try {
            const definitions = await composedSignalService.listIndicatorBlocks();
            res.json(definitions);
        } catch (error) {
            respondInternalError(res, 'tech-indicators', 'Failed to load tech indicator definitions.', error);
        }
    });

    app.get('/api/admin/indicator-catalog', ...adminOnly, async (_req, res) => {
        try {
            res.json(await indicatorCatalogService.listAdminCatalog());
        } catch (error) {
            respondCatalogError(res, 'indicator-catalog-list', error);
        }
    });

    app.get('/api/admin/indicator-catalog/:id', ...adminOnly, async (req, res) => {
        try {
            res.json(await indicatorCatalogService.getAdminCatalogItem(getRouteParam(req.params.id)));
        } catch (error) {
            respondCatalogError(res, 'indicator-catalog-get', error);
        }
    });

    app.get('/api/admin/indicator-catalog/:id/dependencies', ...adminOnly, async (req, res) => {
        try {
            res.json(await indicatorCatalogService.getDependencies(getRouteParam(req.params.id)));
        } catch (error) {
            respondCatalogError(res, 'indicator-catalog-dependencies', error);
        }
    });

    app.post('/api/admin/indicator-catalog', ...adminOnly, async (req, res) => {
        try {
            const created = await indicatorCatalogService.createDraft(readActorUserId(res), req.body);
            res.status(201).json(created);
        } catch (error) {
            respondCatalogError(res, 'indicator-catalog-create', error);
        }
    });

    app.patch('/api/admin/indicator-catalog/:id', ...adminOnly, async (req, res) => {
        try {
            const updated = await indicatorCatalogService.updateDraft(
                readActorUserId(res),
                getRouteParam(req.params.id),
                req.body,
            );
            res.json(updated);
        } catch (error) {
            respondCatalogError(res, 'indicator-catalog-update', error);
        }
    });

    app.post('/api/admin/indicator-catalog/:id/publish', ...adminOnly, async (req, res) => {
        try {
            res.json(await indicatorCatalogService.publish(readActorUserId(res), getRouteParam(req.params.id)));
        } catch (error) {
            respondCatalogError(res, 'indicator-catalog-publish', error);
        }
    });

    app.post('/api/admin/indicator-catalog/:id/retire', ...adminOnly, async (req, res) => {
        try {
            res.json(await indicatorCatalogService.retire(readActorUserId(res), getRouteParam(req.params.id)));
        } catch (error) {
            respondCatalogError(res, 'indicator-catalog-retire', error);
        }
    });

    app.delete('/api/admin/indicator-catalog/:id', ...adminOnly, async (req, res) => {
        try {
            res.json(await indicatorCatalogService.delete(readActorUserId(res), getRouteParam(req.params.id)));
        } catch (error) {
            respondCatalogError(res, 'indicator-catalog-delete', error);
        }
    });

    // ─── Composed Signals CRUD ─────────────────────────────────────────────

    // List all composed signals
    app.get('/api/signals/composed', ...signalOnly, async (_req, res) => {
        try {
            const signals = await composedSignalService.list();
            res.json(signals);
        } catch (error) {
            respondInternalError(res, 'signals-composed-list', 'Failed to load composed signals.', error);
        }
    });

    // Get a single composed signal by id
    app.get('/api/signals/composed/:id', ...signalOnly, async (req, res) => {
        try {
            const signal = await composedSignalService.getById(getRouteParam(req.params.id));
            if (!signal) return res.status(404).json({ error: 'Signal not found' });
            res.json(signal);
        } catch (error) {
            respondInternalError(res, 'signals-composed-get', 'Failed to load the composed signal.', error);
        }
    });

    // Create a new composed signal
    app.post('/api/signals/composed', ...signalOnly, async (req, res) => {
        try {
            const { name, description, category, composedBlocks, createdBy } = req.body;
            if (!name || !composedBlocks) {
                return res.status(400).json({ error: 'Missing required fields: name, composedBlocks' });
            }
            const result = await composedSignalService.create({
                name,
                description,
                category,
                composedBlocks,
                createdBy,
            });
            res.status(201).json(result);
        } catch (error: any) {
            if (error instanceof ComposedSignalValidationError) {
                return res.status(400).json({
                    error: 'Signal definition validation failed.',
                    code: error.code,
                    issues: error.issues,
                });
            }

            respondInternalError(res, 'signals-composed-create', 'Failed to create the composed signal.', error);
        }
    });

    // Update a composed signal
    app.patch('/api/signals/composed/:id', ...signalOnly, async (req, res) => {
        try {
            const updated = await composedSignalService.update(getRouteParam(req.params.id), req.body);
            res.json(updated);
        } catch (error: any) {
            const isNotFound = error.message?.includes('not found');
            const isRetiredConflict = error.message?.includes('Retired composed signals');
            if (error instanceof ComposedSignalValidationError) {
                return res.status(400).json({
                    error: 'Signal definition validation failed.',
                    code: error.code,
                    issues: error.issues,
                });
            }

            if (isNotFound) {
                return res.status(404).json({ error: 'Composed signal not found.' });
            }
            if (isRetiredConflict) {
                return res.status(409).json({ error: 'Retired composed signals cannot be updated.' });
            }
            respondInternalError(res, 'signals-composed-update', 'Failed to update the composed signal.', error);
        }
    });

    // Retire a composed signal without losing traceability
    app.delete('/api/signals/composed/:id', ...signalOnly, async (req, res) => {
        try {
            const retired = await composedSignalService.retire(getRouteParam(req.params.id));
            res.json(retired);
        } catch (error: any) {
            const isNotFound = error.message?.includes('not found');
            if (isNotFound) {
                return res.status(404).json({ error: 'Composed signal not found.' });
            }
            respondInternalError(res, 'signals-composed-retire', 'Failed to retire the composed signal.', error);
        }
    });

    // Get events for an instance
    app.get('/api/indicators/instances/:id/events', ...signalOrEngine, async (req, res) => {
        try {
            const limit = parseBoundedPositiveInteger(req.query.limit, {
                defaultValue: 200,
                max: MAX_EVENT_PAGE_SIZE,
            });
            const offset = parseNonNegativeInteger(req.query.offset, 0);
            if (limit === null || offset === null) {
                return res.status(400).json({
                    error: `limit must be a positive integer up to ${MAX_EVENT_PAGE_SIZE}, and offset must be zero or greater.`,
                });
            }
            const instanceId = getRouteParam(req.params.id);
            const events = await prisma.signalEvent.findMany({
                where: { indicatorInstanceId: instanceId },
                orderBy: { candleTime: 'desc' },
                take: limit,
                skip: offset,
            });
            res.json(events);
        } catch (error) {
            respondInternalError(res, 'indicator-events', 'Failed to load indicator events.', error);
        }
    });

    // Get logic trace for a specific event
    app.get('/api/indicators/instances/:id/events/:eventId/trace', ...signalOrEngine, async (req, res) => {
        try {
            const instanceId = getRouteParam(req.params.id);
            const eventId = getRouteParam(req.params.eventId);
            let trace = await prisma.signalLogicTrace.findFirst({
                where: {
                    signalEventId: eventId,
                    indicatorInstanceId: instanceId,
                },
            });
            if (!trace) {
                const event = await prisma.signalEvent.findFirst({
                    where: {
                        id: eventId,
                        indicatorInstanceId: instanceId,
                    },
                    select: {
                        candleTime: true,
                        eventType: true,
                    },
                });

                if (event) {
                    trace = await prisma.signalLogicTrace.findFirst({
                        where: {
                            indicatorInstanceId: instanceId,
                            eventType: event.eventType,
                            candleTime: event.candleTime,
                        },
                        orderBy: { createdAt: 'desc' },
                    });
                }
            }
            if (!trace) {
                return res.status(404).json({ error: 'Trace not found for this event' });
            }
            res.json(trace);
        } catch (error) {
            respondInternalError(res, 'indicator-trace', 'Failed to load the event trace.', error);
        }
    });

    // List all indicator instances
    app.get('/api/indicators/instances', ...signalOrEngine, async (req, res) => {
        try {
            const symbol = req.query.symbol as string;
            const timeframe = req.query.timeframe as string;
            const status = req.query.status as any;

            const instances = await instanceService.listInstances({ symbol, timeframe, status });
            res.json(instances);
        } catch (error) {
            respondInternalError(res, 'indicator-instance-list', 'Failed to load indicator instances.', error);
        }
    });

    // Get specific instance details
    app.get('/api/indicators/instances/:id', ...signalOrEngine, async (req, res) => {
        try {
            const instance = await instanceService.getInstance(getRouteParam(req.params.id));
            if (!instance) {
                return res.status(404).json({ error: 'Instance not found' });
            }
            res.json(instance);
        } catch (error) {
            respondInternalError(res, 'indicator-instance-get', 'Failed to load the indicator instance.', error);
        }
    });

    // Create from backtest promotion
    app.post('/api/indicators/instances/promote', ...signalOrEngine, async (req, res) => {
        try {
            const { backtestRunId, name } = req.body;
            if (!backtestRunId) {
                return res.status(400).json({ error: 'Missing backtestRunId' });
            }
            const instance = await promotionService.promoteBacktest(backtestRunId, name);
            res.json(instance);
        } catch (error) {
            respondInternalError(res, 'indicator-promote', 'Failed to promote the backtest into an indicator instance.', error);
        }
    });

    // Update status (pause, resume, archive)
    app.post('/api/indicators/instances/:id/status', ...signalOrEngine, async (req, res) => {
        try {
            const { status } = req.body;
            if (!status) {
                return res.status(400).json({ error: 'Missing status' });
            }
            const instance = await instanceService.updateStatus(getRouteParam(req.params.id), status);
            res.json(instance);
        } catch (error) {
            respondInternalError(res, 'indicator-status-update', 'Failed to update the indicator status.', error);
        }
    });

    // Update instance configuration
    app.patch('/api/indicators/instances/:id', ...signalOrEngine, async (req, res) => {
        try {
            const instance = await instanceService.updateInstance(getRouteParam(req.params.id), req.body);
            res.json(instance);
        } catch (error) {
            respondInternalError(res, 'indicator-instance-update', 'Failed to update the indicator instance.', error);
        }
    });

    // Create alert
    app.post('/api/indicators/alerts', ...signalOrEngine, async (req, res) => {
        try {
            const alert = await alertService.createAlert(req.body);
            res.json(alert);
        } catch (error) {
            respondInternalError(res, 'indicator-alert-create', 'Failed to create the indicator alert.', error);
        }
    });

    // List alerts for instance
    app.get('/api/indicators/instances/:id/alerts', ...signalOrEngine, async (req, res) => {
        try {
            const alerts = await alertService.listAlerts(getRouteParam(req.params.id));
            res.json(alerts);
        } catch (error) {
            respondInternalError(res, 'indicator-alert-list', 'Failed to load indicator alerts.', error);
        }
    });

    // Toggle alert
    app.patch('/api/indicators/alerts/:id', ...signalOrEngine, async (req, res) => {
        try {
            const { isActive } = req.body;
            const alert = await alertService.toggleAlert(getRouteParam(req.params.id), isActive);
            res.json(alert);
        } catch (error) {
            respondInternalError(res, 'indicator-alert-toggle', 'Failed to update the indicator alert.', error);
        }
    });

    // Delete alert
    app.delete('/api/indicators/alerts/:id', ...signalOrEngine, async (req, res) => {
        try {
            await alertService.deleteAlert(getRouteParam(req.params.id));
            res.json({ success: true });
        } catch (error) {
            respondInternalError(res, 'indicator-alert-delete', 'Failed to delete the indicator alert.', error);
        }
    });
}
