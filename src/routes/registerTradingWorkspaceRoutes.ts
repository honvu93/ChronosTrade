import express from 'express';
import {
    ExecutionCommandType,
    PrismaClient,
    TradingAutomationBindingStatus,
    TradingAutomationMode,
} from '@prisma/client';
import { requireTradingCapability, requireTradingCapabilityForAccount } from '../middleware/featureFlag';
import { TradingAccountActor, TradingAccountServiceError } from '../services/trading/TradingAccountService';
import {
    TradingAutomationBindingService,
    TradingAutomationBindingServiceError,
} from '../services/trading/TradingAutomationBindingService';
import { TradingTradeIntentService, TradingTradeIntentView } from '../services/trading/TradingTradeIntentService';
import {
    TradingExecutionCommandInput,
    TradingExecutionService,
    TradingExecutionServiceError,
} from '../services/trading/TradingExecutionService';
import {
    TradingWorkspaceService,
    TradingWorkspaceServiceError,
} from '../services/trading/TradingWorkspaceService';
import { createTradingExecutionLogger } from '../services/trading/tradingExecutionLogger';
import { PaperSetupService, PaperSetupServiceError } from '../services/trading/PaperSetupService';
import { PaperPerformanceService, PaperPerformanceServiceError } from '../services/trading/PaperPerformanceService';

type LimitQuery = {
    limit?: unknown;
    from?: unknown;
    to?: unknown;
    userId?: unknown;
};

type TradingCommandBody = {
    commandType?: unknown;
    symbol?: unknown;
    side?: unknown;
    volume?: unknown;
    price?: unknown;
    stopLoss?: unknown;
    takeProfit?: unknown;
    brokerPositionId?: unknown;
    brokerOrderId?: unknown;
    orderType?: unknown;
    comment?: unknown;
    idempotencyKey?: unknown;
};

type TradingAutomationBindingBody = {
    indicatorInstanceId?: unknown;
    name?: unknown;
    mode?: unknown;
    filtersJson?: unknown;
    riskConfigJson?: unknown;
    guardrailsJson?: unknown;
    approvalRequired?: unknown;
    killSwitchActive?: unknown;
    status?: unknown;
    statusReason?: unknown;
};

const EXECUTION_COMMAND_TYPES = new Set<ExecutionCommandType>([
    'OPEN_MARKET',
    'CLOSE_POSITION',
    'PARTIAL_CLOSE',
    'PLACE_PENDING',
    'MODIFY_POSITION',
    'CANCEL_ORDER',
    'FORCE_SYNC',
]);

const AUTOMATION_MODES = new Set<TradingAutomationMode>([
    'OBSERVE',
    'MANUAL_APPROVAL',
    'AUTO_EXECUTE',
]);

const AUTOMATION_STATUSES = new Set<TradingAutomationBindingStatus>([
    'PENDING_APPROVAL',
    'ACTIVE',
    'PAUSED',
    'ARCHIVED',
]);

const ORDER_TYPES = new Set<NonNullable<TradingExecutionCommandInput['orderType']>>([
    'MARKET',
    'BUY_LIMIT',
    'SELL_LIMIT',
    'BUY_STOP',
    'SELL_STOP',
]);

const tradingExecutionLogger = createTradingExecutionLogger();

function readActor(res: express.Response): TradingAccountActor {
    const locals = (res.locals ?? {}) as {
        authorizedUser?: {
            id: string;
            role: 'ADMIN' | 'USER';
        };
    };

    if (!locals.authorizedUser) {
        throw new TradingAccountServiceError(
            401,
            'TRADING_ACCOUNT_FORBIDDEN',
            'Authentication is required before trading workspace access can continue.',
            'trading.auth',
        );
    }

    return locals.authorizedUser;
}

function parsePositiveInteger(value: unknown): number | null | undefined {
    if (value === undefined || value === null || value === '') {
        return undefined;
    }

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        return null;
    }

    return parsed;
}

function parseUtcTimestamp(value: unknown): Date | null | undefined {
    if (value === undefined || value === null || value === '') {
        return undefined;
    }

    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.trim();
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(normalized)) {
        return null;
    }

    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseNullableNumber(value: unknown): number | null | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (value === null || value === '') {
        return null;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function readScopedOwnerUserId(query: { userId?: unknown }): string | null {
    if (typeof query.userId !== 'string') {
        return null;
    }

    const normalized = query.userId.trim();
    return normalized.length > 0 ? normalized : null;
}

function createErrorResponse(res: express.Response, error: unknown) {
    if (
        error instanceof TradingAccountServiceError
        || error instanceof TradingWorkspaceServiceError
        || error instanceof TradingExecutionServiceError
        || error instanceof TradingAutomationBindingServiceError
        || error instanceof PaperSetupServiceError
        || error instanceof PaperPerformanceServiceError
    ) {
        return res.status(error.statusCode).json({
            success: false,
            error: {
                code: error.code,
                message: error.message,
                domain: error.domain,
            },
        });
    }

    console.error('[TradingWorkspaceRoutes] Unexpected error:', error);
    return res.status(500).json({
        success: false,
        error: {
            code: 'TRADING_WORKSPACE_FAILED',
            message: 'Trading workspace request failed.',
            domain: 'trading.workspace',
        },
    });
}

export function createGetTradingWorkspaceRouteHandler(
    tradingWorkspaceService: Pick<TradingWorkspaceService, 'getWorkspace'>,
): express.RequestHandler {
    return async (req, res) => {
        try {
            const query = (req.query ?? {}) as LimitQuery;
            const snapshot = await tradingWorkspaceService.getWorkspace(readActor(res), String(req.params.id ?? ''), {
                ownerUserId: readScopedOwnerUserId(query),
            });
            res.json({ success: true, data: snapshot });
        } catch (error) {
            createErrorResponse(res, error);
        }
    };
}

export function createGetTradingAccountSummaryRouteHandler(
    tradingWorkspaceService: Pick<TradingWorkspaceService, 'getSummary'>,
): express.RequestHandler {
    return async (req, res) => {
        try {
            const query = (req.query ?? {}) as LimitQuery;
            const summary = await tradingWorkspaceService.getSummary(readActor(res), String(req.params.id ?? ''), {
                ownerUserId: readScopedOwnerUserId(query),
            });
            res.json({ success: true, data: summary });
        } catch (error) {
            createErrorResponse(res, error);
        }
    };
}

export function createGetTradingPositionsRouteHandler(
    tradingWorkspaceService: Pick<TradingWorkspaceService, 'listPositions'>,
): express.RequestHandler {
    return async (req, res) => {
        try {
            const query = (req.query ?? {}) as LimitQuery;
            const positions = await tradingWorkspaceService.listPositions(readActor(res), String(req.params.id ?? ''), {
                ownerUserId: readScopedOwnerUserId(query),
            });
            res.json({ success: true, data: { items: positions } });
        } catch (error) {
            createErrorResponse(res, error);
        }
    };
}

export function createGetTradingOrdersRouteHandler(
    tradingWorkspaceService: Pick<TradingWorkspaceService, 'listOrders'>,
): express.RequestHandler {
    return async (req, res) => {
        try {
            const query = (req.query ?? {}) as LimitQuery;
            const orders = await tradingWorkspaceService.listOrders(readActor(res), String(req.params.id ?? ''), {
                ownerUserId: readScopedOwnerUserId(query),
            });
            res.json({ success: true, data: { items: orders } });
        } catch (error) {
            createErrorResponse(res, error);
        }
    };
}

export function createGetTradingDealsRouteHandler(
    tradingWorkspaceService: Pick<TradingWorkspaceService, 'listDeals'>,
): express.RequestHandler {
    return async (req, res) => {
        const query = (req.query ?? {}) as LimitQuery;
        const limit = parsePositiveInteger(query.limit);
        const from = parseUtcTimestamp(query.from);
        const to = parseUtcTimestamp(query.to);
        if (limit === null || from === null || to === null) {
            res.status(400).json({
                success: false,
                error: {
                    code: 'INVALID_PARAMS',
                    message: 'limit must be a positive integer and from/to must be UTC ISO timestamps when supplied.',
                    domain: 'trading.workspace',
                },
            });
            return;
        }

        if (from && to && from.getTime() > to.getTime()) {
            res.status(400).json({
                success: false,
                error: {
                    code: 'INVALID_PARAMS',
                    message: 'from must be less than or equal to to.',
                    domain: 'trading.workspace',
                },
            });
            return;
        }

        try {
            const ownerUserId = readScopedOwnerUserId(query);
            const deals = await tradingWorkspaceService.listDeals(readActor(res), String(req.params.id ?? ''), {
                limit,
                from,
                to,
            }, {
                ownerUserId,
            });
            res.json({ success: true, data: { items: deals } });
        } catch (error) {
            createErrorResponse(res, error);
        }
    };
}

export function createGetTradingSyncRunsRouteHandler(
    tradingWorkspaceService: Pick<TradingWorkspaceService, 'listSyncRuns'>,
): express.RequestHandler {
    return async (req, res) => {
        const query = (req.query ?? {}) as LimitQuery;
        const limit = parsePositiveInteger(query.limit);
        if (limit === null) {
            res.status(400).json({
                success: false,
                error: {
                    code: 'INVALID_PARAMS',
                    message: 'limit must be a positive integer when supplied.',
                    domain: 'trading.workspace',
                },
            });
            return;
        }

        try {
            const ownerUserId = readScopedOwnerUserId(query);
            const syncRuns = await tradingWorkspaceService.listSyncRuns(readActor(res), String(req.params.id ?? ''), {
                limit,
            }, {
                ownerUserId,
            });
            res.json({ success: true, data: { items: syncRuns } });
        } catch (error) {
            createErrorResponse(res, error);
        }
    };
}

export function createForceSyncTradingAccountRouteHandler(
    tradingWorkspaceService: Pick<TradingWorkspaceService, 'forceSync'>,
): express.RequestHandler {
    return async (req, res) => {
        try {
            const query = (req.query ?? {}) as LimitQuery;
            const snapshot = await tradingWorkspaceService.forceSync(readActor(res), String(req.params.id ?? ''), {
                ownerUserId: readScopedOwnerUserId(query),
            });
            res.status(202).json({ success: true, data: snapshot });
        } catch (error) {
            createErrorResponse(res, error);
        }
    };
}

export function createListTradingExecutionCommandsRouteHandler(
    tradingExecutionService: Pick<TradingExecutionService, 'listCommands'>,
): express.RequestHandler {
    return async (req, res) => {
        const query = (req.query ?? {}) as LimitQuery;
        const limit = parsePositiveInteger(query.limit);
        if (limit === null) {
            res.status(400).json({
                success: false,
                error: {
                    code: 'INVALID_PARAMS',
                    message: 'limit must be a positive integer when supplied.',
                    domain: 'trading.execution',
                },
            });
            return;
        }

        try {
            const ownerUserId = readScopedOwnerUserId(query);
            const items = await tradingExecutionService.listCommands(readActor(res), String(req.params.id ?? ''), {
                limit,
            }, {
                ownerUserId,
            });
            res.json({ success: true, data: { items } });
        } catch (error) {
            createErrorResponse(res, error);
        }
    };
}

export function createCreateTradingExecutionCommandRouteHandler(
    tradingExecutionService: Pick<TradingExecutionService, 'createCommand'>,
): express.RequestHandler {
    return async (req, res) => {
        const body = (req.body ?? {}) as TradingCommandBody;
        const actor = readActor(res);
        const query = (req.query ?? {}) as LimitQuery;
        const ownerUserId = readScopedOwnerUserId(query);
        const commandType = typeof body.commandType === 'string' ? body.commandType.trim() : '';
        const routePayload = {
            commandType: commandType || null,
            symbol: typeof body.symbol === 'string' ? body.symbol.trim() || null : null,
            side: body.side === 'LONG' || body.side === 'SHORT' ? body.side : null,
            volume: parseNullableNumber(body.volume) ?? null,
            price: parseNullableNumber(body.price) ?? null,
            stopLoss: parseNullableNumber(body.stopLoss) ?? null,
            takeProfit: parseNullableNumber(body.takeProfit) ?? null,
            brokerPositionId: typeof body.brokerPositionId === 'string' ? body.brokerPositionId.trim() || null : null,
            brokerOrderId: typeof body.brokerOrderId === 'string' ? body.brokerOrderId.trim() || null : null,
            orderType: typeof body.orderType === 'string' ? body.orderType.trim() || null : null,
            hasComment: typeof body.comment === 'string' ? body.comment.trim().length > 0 : false,
            idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() || null : null,
        };

        tradingExecutionLogger.log('info', {
            event: 'command_route_received',
            message: 'Trading command request received by the workspace route.',
            actorUserId: actor.id,
            requestedByUserId: actor.id,
            ownerScopeUserId: ownerUserId,
            accountId: String(req.params.id ?? '').trim() || null,
            route: req.originalUrl ?? req.url ?? null,
            requestBody: routePayload,
        });

        if (!EXECUTION_COMMAND_TYPES.has(commandType as ExecutionCommandType)) {
            tradingExecutionLogger.log('warn', {
                event: 'command_route_invalid_body',
                message: 'A supported commandType is required.',
                actorUserId: actor.id,
                requestedByUserId: actor.id,
                ownerScopeUserId: ownerUserId,
                accountId: String(req.params.id ?? '').trim() || null,
                route: req.originalUrl ?? req.url ?? null,
                requestBody: routePayload,
                errorCode: 'INVALID_BODY',
                errorMessage: 'A supported commandType is required.',
            });
            res.status(400).json({
                success: false,
                error: {
                    code: 'INVALID_BODY',
                    message: 'A supported commandType is required.',
                    domain: 'trading.execution',
                },
            });
            return;
        }

        const payload: TradingExecutionCommandInput = {
            commandType: commandType as ExecutionCommandType,
            symbol: typeof body.symbol === 'string' ? body.symbol.trim() || null : null,
            side: body.side === 'LONG' || body.side === 'SHORT' ? body.side : null,
            volume: parseNullableNumber(body.volume),
            price: parseNullableNumber(body.price),
            stopLoss: parseNullableNumber(body.stopLoss),
            takeProfit: parseNullableNumber(body.takeProfit),
            brokerPositionId: typeof body.brokerPositionId === 'string' ? body.brokerPositionId.trim() || null : null,
            brokerOrderId: typeof body.brokerOrderId === 'string' ? body.brokerOrderId.trim() || null : null,
            orderType: typeof body.orderType === 'string' && ORDER_TYPES.has(body.orderType as NonNullable<TradingExecutionCommandInput['orderType']>)
                ? body.orderType as NonNullable<TradingExecutionCommandInput['orderType']>
                : null,
            comment: typeof body.comment === 'string' ? body.comment.trim() || null : null,
            idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() || null : null,
        };

        try {
            const command = await tradingExecutionService.createCommand(
                actor,
                String(req.params.id ?? ''),
                payload,
                undefined,
                {
                    ownerUserId,
                },
            );
            tradingExecutionLogger.log('info', {
                event: 'command_route_succeeded',
                message: 'Trading command request completed route handling successfully.',
                actorUserId: actor.id,
                requestedByUserId: actor.id,
                ownerScopeUserId: ownerUserId,
                accountId: command.accountId,
                commandId: command.id,
                commandType: command.commandType,
                tradeIntentId: null,
                symbol: command.symbol,
                side: command.side,
                volume: command.volume,
                price: command.price,
                brokerPositionId: command.brokerPositionId,
                brokerOrderId: command.brokerOrderId,
                brokerReference: command.brokerReference,
                idempotencyKey: command.idempotencyKey,
                status: command.status,
                route: req.originalUrl ?? req.url ?? null,
            });
            res.status(201).json({ success: true, data: command });
        } catch (error) {
            tradingExecutionLogger.log('error', {
                event: 'command_route_failed',
                message: error instanceof Error ? error.message : 'Trading command route failed.',
                actorUserId: actor.id,
                requestedByUserId: actor.id,
                ownerScopeUserId: ownerUserId,
                accountId: String(req.params.id ?? '').trim() || null,
                route: req.originalUrl ?? req.url ?? null,
                requestBody: routePayload,
                errorCode: error instanceof TradingExecutionServiceError ? error.code : 'TRADING_WORKSPACE_FAILED',
                errorMessage: error instanceof Error ? error.message : 'Trading command route failed.',
            });
            createErrorResponse(res, error);
        }
    };
}

export function createListTradingAutomationBindingsRouteHandler(
    tradingAutomationBindingService: Pick<TradingAutomationBindingService, 'listBindings'>,
): express.RequestHandler {
    return async (req, res) => {
        try {
            const query = (req.query ?? {}) as LimitQuery;
            const snapshot = await tradingAutomationBindingService.listBindings(readActor(res), String(req.params.id ?? ''), {
                ownerUserId: readScopedOwnerUserId(query),
            });
            res.json({ success: true, data: snapshot });
        } catch (error) {
            createErrorResponse(res, error);
        }
    };
}

export function createListTradingAutoExecutionIntentsRouteHandler(
    tradingTradeIntentService: Pick<TradingTradeIntentService, 'listIntents'>,
): express.RequestHandler {
    return async (req, res) => {
        const query = (req.query ?? {}) as LimitQuery;
        const limit = parsePositiveInteger(query.limit);
        if (limit === null) {
            res.status(400).json({
                success: false,
                error: {
                    code: 'INVALID_PARAMS',
                    message: 'limit must be a positive integer when supplied.',
                    domain: 'trading.automation',
                },
            });
            return;
        }

        try {
            const ownerUserId = readScopedOwnerUserId(query);
            const items: TradingTradeIntentView[] = await tradingTradeIntentService.listIntents(
                readActor(res),
                String(req.params.id ?? ''),
                { limit },
                { ownerUserId },
            );
            res.json({ success: true, data: { items } });
        } catch (error) {
            createErrorResponse(res, error);
        }
    };
}

export function createCreateTradingAutomationBindingRouteHandler(
    tradingAutomationBindingService: Pick<TradingAutomationBindingService, 'createBinding'>,
): express.RequestHandler {
    return async (req, res) => {
        const body = (req.body ?? {}) as TradingAutomationBindingBody;
        const mode = typeof body.mode === 'string' ? body.mode.trim() : '';
        if (
            typeof body.indicatorInstanceId !== 'string'
            || typeof body.name !== 'string'
            || !AUTOMATION_MODES.has(mode as TradingAutomationMode)
        ) {
            res.status(400).json({
                success: false,
                error: {
                    code: 'INVALID_BODY',
                    message: 'indicatorInstanceId, name, and a supported mode are required.',
                    domain: 'trading.automation',
                },
            });
            return;
        }

        try {
            const query = (req.query ?? {}) as LimitQuery;
            const binding = await tradingAutomationBindingService.createBinding(
                readActor(res),
                String(req.params.id ?? ''),
                {
                    indicatorInstanceId: body.indicatorInstanceId.trim(),
                    name: body.name,
                    mode: mode as TradingAutomationMode,
                    filtersJson: body.filtersJson as never,
                    riskConfigJson: body.riskConfigJson as never,
                    guardrailsJson: body.guardrailsJson as never,
                    approvalRequired: typeof body.approvalRequired === 'boolean' ? body.approvalRequired : undefined,
                    killSwitchActive: typeof body.killSwitchActive === 'boolean' ? body.killSwitchActive : undefined,
                },
                {
                    ownerUserId: readScopedOwnerUserId(query),
                },
            );
            res.status(201).json({ success: true, data: binding });
        } catch (error) {
            createErrorResponse(res, error);
        }
    };
}

export function createUpdateTradingAutomationBindingRouteHandler(
    tradingAutomationBindingService: Pick<TradingAutomationBindingService, 'updateBindingStatus'>,
): express.RequestHandler {
    return async (req, res) => {
        const body = (req.body ?? {}) as TradingAutomationBindingBody;
        const status = typeof body.status === 'string' ? body.status.trim() : '';
        if (!AUTOMATION_STATUSES.has(status as TradingAutomationBindingStatus)) {
            res.status(400).json({
                success: false,
                error: {
                    code: 'INVALID_BODY',
                    message: 'A supported automation status is required.',
                    domain: 'trading.automation',
                },
            });
            return;
        }

        try {
            const query = (req.query ?? {}) as LimitQuery;
            const binding = await tradingAutomationBindingService.updateBindingStatus(
                readActor(res),
                String(req.params.id ?? ''),
                String(req.params.bindingId ?? ''),
                {
                    status: status as TradingAutomationBindingStatus,
                    killSwitchActive: typeof body.killSwitchActive === 'boolean' ? body.killSwitchActive : undefined,
                    statusReason: typeof body.statusReason === 'string' ? body.statusReason.trim() || null : null,
                },
                {
                    ownerUserId: readScopedOwnerUserId(query),
                },
            );
            res.json({ success: true, data: binding });
        } catch (error) {
            createErrorResponse(res, error);
        }
    };
}

type PaperSetupBody = {
    signalCode?: unknown;
    signalVersion?: unknown;
    riskPercent?: unknown;
    symbol?: unknown;
    timeframe?: unknown;
};

export function createGetPaperPerformanceRouteHandler(
    paperPerformanceService: Pick<PaperPerformanceService, 'getPerformance'>,
): express.RequestHandler {
    return async (req, res) => {
        const query = (req.query ?? {}) as { from?: unknown; to?: unknown };
        const from = typeof query.from === 'string' ? new Date(query.from) : undefined;
        const to = typeof query.to === 'string' ? new Date(query.to) : undefined;
        try {
            const data = await paperPerformanceService.getPerformance(
                readActor(res),
                String(req.params.id ?? ''),
                { from: from && !isNaN(from.getTime()) ? from : undefined, to: to && !isNaN(to.getTime()) ? to : undefined },
            );
            res.json({ success: true, data });
        } catch (error) {
            createErrorResponse(res, error);
        }
    };
}

export function createPaperSetupRouteHandler(
    paperSetupService: Pick<PaperSetupService, 'setup'>,
): express.RequestHandler {
    return async (req, res) => {
        const body = (req.body ?? {}) as PaperSetupBody;
        const signalCode = typeof body.signalCode === 'string' ? body.signalCode.trim() : '';
        const signalVersion = typeof body.signalVersion === 'number' ? body.signalVersion : NaN;
        const riskPercent = typeof body.riskPercent === 'number' ? body.riskPercent : NaN;

        if (!signalCode || !Number.isInteger(signalVersion) || signalVersion < 1) {
            res.status(400).json({
                success: false,
                error: {
                    code: 'INVALID_BODY',
                    message: 'signalCode (string) and signalVersion (positive integer) are required.',
                    domain: 'trading.paper-setup',
                },
            });
            return;
        }

        if (!Number.isFinite(riskPercent) || riskPercent <= 0 || riskPercent > 100) {
            res.status(400).json({
                success: false,
                error: {
                    code: 'INVALID_BODY',
                    message: 'riskPercent must be a positive number.',
                    domain: 'trading.paper-setup',
                },
            });
            return;
        }

        const symbol = typeof body.symbol === 'string' && body.symbol.trim() ? body.symbol.trim().toUpperCase() : 'XAUUSD';
        const timeframe = typeof body.timeframe === 'string' && body.timeframe.trim() ? body.timeframe.trim().toUpperCase() : 'H1';

        try {
            const result = await paperSetupService.setup(
                readActor(res),
                String(req.params.id ?? ''),
                { signalCode, signalVersion, riskPercent, symbol, timeframe },
            );
            res.status(201).json({ success: true, data: result });
        } catch (error) {
            createErrorResponse(res, error);
        }
    };
}

export function registerTradingWorkspaceRoutes(app: express.Application, prisma: PrismaClient) {
    const tradingWorkspaceService = new TradingWorkspaceService(prisma);
    const tradingExecutionService = new TradingExecutionService(prisma);
    const tradingAutomationBindingService = new TradingAutomationBindingService(prisma);
    const tradingTradeIntentService = new TradingTradeIntentService(prisma);
    const paperSetupService = new PaperSetupService(prisma);
    const paperPerformanceService = new PaperPerformanceService(prisma);

    app.get(
        '/api/trading/accounts/:id/workspace',
        requireTradingCapability('read'),
        createGetTradingWorkspaceRouteHandler(tradingWorkspaceService),
    );

    app.get(
        '/api/trading/accounts/:id/summary',
        requireTradingCapability('read'),
        createGetTradingAccountSummaryRouteHandler(tradingWorkspaceService),
    );

    app.get(
        '/api/trading/accounts/:id/positions',
        requireTradingCapability('read'),
        createGetTradingPositionsRouteHandler(tradingWorkspaceService),
    );

    app.get(
        '/api/trading/accounts/:id/orders',
        requireTradingCapability('read'),
        createGetTradingOrdersRouteHandler(tradingWorkspaceService),
    );

    app.get(
        '/api/trading/accounts/:id/deals',
        requireTradingCapability('read'),
        createGetTradingDealsRouteHandler(tradingWorkspaceService),
    );

    app.get(
        '/api/trading/accounts/:id/sync-runs',
        requireTradingCapability('read'),
        createGetTradingSyncRunsRouteHandler(tradingWorkspaceService),
    );

    app.post(
        '/api/trading/accounts/:id/sync',
        requireTradingCapability('read'),
        createForceSyncTradingAccountRouteHandler(tradingWorkspaceService),
    );

    app.get(
        '/api/trading/accounts/:id/commands',
        requireTradingCapability('read'),
        createListTradingExecutionCommandsRouteHandler(tradingExecutionService),
    );

    app.post(
        '/api/trading/accounts/:id/commands',
        requireTradingCapabilityForAccount(prisma, 'write'),
        express.json(),
        createCreateTradingExecutionCommandRouteHandler(tradingExecutionService),
    );

    app.get(
        '/api/trading/accounts/:id/automation/bindings',
        requireTradingCapability('read'),
        createListTradingAutomationBindingsRouteHandler(tradingAutomationBindingService),
    );

    app.get(
        '/api/trading/accounts/:id/automation/intents',
        requireTradingCapability('read'),
        createListTradingAutoExecutionIntentsRouteHandler(tradingTradeIntentService),
    );

    app.post(
        '/api/trading/accounts/:id/automation/bindings',
        requireTradingCapabilityForAccount(prisma, 'automation'),
        express.json(),
        createCreateTradingAutomationBindingRouteHandler(tradingAutomationBindingService),
    );

    app.patch(
        '/api/trading/accounts/:id/automation/bindings/:bindingId',
        requireTradingCapabilityForAccount(prisma, 'automation'),
        express.json(),
        createUpdateTradingAutomationBindingRouteHandler(tradingAutomationBindingService),
    );

    app.post(
        '/api/trading/accounts/:id/paper-setup',
        requireTradingCapabilityForAccount(prisma, 'automation'),
        express.json(),
        createPaperSetupRouteHandler(paperSetupService),
    );

    app.get(
        '/api/trading/accounts/:id/paper-performance',
        requireTradingCapability('read'),
        createGetPaperPerformanceRouteHandler(paperPerformanceService),
    );
}
