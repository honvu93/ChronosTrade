import express from 'express';
import { PrismaClient } from '@prisma/client';
import {
    TradingAccountActor,
    TradingAccountModeValue,
    TradingAccountService,
    TradingAccountServiceError,
} from '../services/trading/TradingAccountService';
import { requireTradingCapability } from '../middleware/featureFlag';
import { buildTradingFeatureFlagSnapshot, TradingFeatureFlagSnapshot } from '../services/trading/tradingFeatureFlags';

type TradingAccountListQuery = {
    userId?: unknown;
};

type TradingAccountBody = {
    ownerUserId?: unknown;
    label?: unknown;
    accountMode?: unknown;
    mt5Login?: unknown;
    mt5Password?: unknown;
    mt5Server?: unknown;
};

function parseAccountMode(value: unknown): TradingAccountModeValue | null | undefined {
    if (value === undefined) {
        return undefined;
    }

    if (value === null) {
        return null;
    }

    if (typeof value !== 'string') {
        throw new TradingAccountServiceError(
            400,
            'TRADING_ACCOUNT_INVALID',
            'accountMode must be either LIVE or PAPER.',
        );
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }

    const normalized = trimmed.toUpperCase();
    if (normalized === 'LIVE' || normalized === 'PAPER') {
        return normalized;
    }

    throw new TradingAccountServiceError(
        400,
        'TRADING_ACCOUNT_INVALID',
        'accountMode must be either LIVE or PAPER.',
    );
}

function readActor(res: express.Response): TradingAccountActor {
    const locals = (res.locals ?? {}) as {
        authorizedUser?: {
            id: string;
            role: 'ADMIN' | 'USER';
        };
    };

    const actor = locals.authorizedUser;
    if (!actor) {
        throw new TradingAccountServiceError(
            401,
            'TRADING_ACCOUNT_FORBIDDEN',
            'Authentication is required before MT5 account management can continue.',
            'trading.auth',
        );
    }

    return actor;
}

function createErrorResponse(res: express.Response, error: unknown) {
    if (error instanceof TradingAccountServiceError) {
        return res.status(error.statusCode).json({
            success: false,
            error: {
                code: error.code,
                message: error.message,
                domain: error.domain,
            },
        });
    }

    console.error('[TradingAccountRoutes] Unexpected error:', error);
    return res.status(500).json({
        success: false,
        error: {
            code: 'TRADING_ACCOUNT_FAILED',
            message: 'Failed to manage the MT5 account.',
            domain: 'trading.account-management',
        },
    });
}

function readScopedOwnerUserId(query: TradingAccountListQuery): string | null {
    return typeof query.userId === 'string' ? query.userId.trim() || null : null;
}

export function createListTradingAccountsRouteHandler(
    tradingAccountService: Pick<TradingAccountService, 'listAccounts'>,
): express.RequestHandler {
    return async (req, res) => {
        const query = (req.query ?? {}) as TradingAccountListQuery;
        try {
            const result = await tradingAccountService.listAccounts(readActor(res), {
                ownerUserId: readScopedOwnerUserId(query),
            });
            res.json({
                success: true,
                data: result,
            });
        } catch (error) {
            createErrorResponse(res, error);
        }
    };
}

export function createCreateTradingAccountRouteHandler(
    tradingAccountService: Pick<TradingAccountService, 'createAccount'>,
): express.RequestHandler {
    return async (req, res) => {
        const body = (req.body ?? {}) as TradingAccountBody;
        try {
            const accountMode = parseAccountMode(body.accountMode);
            const account = await tradingAccountService.createAccount(readActor(res), {
                ownerUserId: typeof body.ownerUserId === 'string' ? body.ownerUserId.trim() || null : null,
                label: typeof body.label === 'string' ? body.label : '',
                ...(accountMode !== undefined ? { accountMode } : {}),
                mt5Login: typeof body.mt5Login === 'string' ? body.mt5Login : '',
                mt5Password: typeof body.mt5Password === 'string' ? body.mt5Password : '',
                mt5Server: typeof body.mt5Server === 'string' ? body.mt5Server : '',
            });
            res.status(201).json({
                success: true,
                data: {
                    account,
                },
            });
        } catch (error) {
            createErrorResponse(res, error);
        }
    };
}

export function createUpdateTradingAccountRouteHandler(
    tradingAccountService: Pick<TradingAccountService, 'updateAccount'>,
): express.RequestHandler {
    return async (req, res) => {
        const body = (req.body ?? {}) as TradingAccountBody;
        const query = (req.query ?? {}) as TradingAccountListQuery;
        try {
            const accountMode = parseAccountMode(body.accountMode);
            const account = await tradingAccountService.updateAccount(
                readActor(res),
                String(req.params.id ?? ''),
                {
                    ...(body.label !== undefined ? { label: typeof body.label === 'string' ? body.label : '' } : {}),
                    ...(accountMode !== undefined ? { accountMode } : {}),
                    ...(body.mt5Login !== undefined ? { mt5Login: typeof body.mt5Login === 'string' ? body.mt5Login : '' } : {}),
                    ...(body.mt5Password !== undefined ? { mt5Password: body.mt5Password === null ? null : typeof body.mt5Password === 'string' ? body.mt5Password : '' } : {}),
                    ...(body.mt5Server !== undefined ? { mt5Server: typeof body.mt5Server === 'string' ? body.mt5Server : '' } : {}),
                },
                {
                    ownerUserId: readScopedOwnerUserId(query),
                },
            );
            res.json({
                success: true,
                data: {
                    account,
                },
            });
        } catch (error) {
            createErrorResponse(res, error);
        }
    };
}

export function createDeleteTradingAccountRouteHandler(
    tradingAccountService: Pick<TradingAccountService, 'deleteAccount'>,
): express.RequestHandler {
    return async (req, res) => {
        const query = (req.query ?? {}) as TradingAccountListQuery;
        try {
            const result = await tradingAccountService.deleteAccount(
                readActor(res),
                String(req.params.id ?? ''),
                {
                    ownerUserId: readScopedOwnerUserId(query),
                },
            );
            res.json({
                success: true,
                data: {
                    deletedId: result.id,
                    activeAccountId: result.activeAccountId,
                },
            });
        } catch (error) {
            createErrorResponse(res, error);
        }
    };
}

export function createSelectTradingAccountRouteHandler(
    tradingAccountService: Pick<TradingAccountService, 'selectActiveAccount'>,
): express.RequestHandler {
    return async (req, res) => {
        const query = (req.query ?? {}) as TradingAccountListQuery;
        try {
            const result = await tradingAccountService.selectActiveAccount(
                readActor(res),
                String(req.params.id ?? ''),
                {
                    ownerUserId: readScopedOwnerUserId(query),
                },
            );
            res.json({
                success: true,
                data: result,
            });
        } catch (error) {
            createErrorResponse(res, error);
        }
    };
}

export function registerTradingAccountRoutes(app: express.Application, prisma: PrismaClient) {
    const tradingAccountService = new TradingAccountService(prisma);

    app.get(
        '/api/trading/accounts',
        createListTradingAccountsRouteHandler(tradingAccountService),
    );

    app.post(
        '/api/trading/accounts',
        createCreateTradingAccountRouteHandler(tradingAccountService),
    );

    app.post(
        '/api/trading/accounts/:id/select',
        createSelectTradingAccountRouteHandler(tradingAccountService),
    );

    app.patch(
        '/api/trading/accounts/:id',
        createUpdateTradingAccountRouteHandler(tradingAccountService),
    );

    app.delete(
        '/api/trading/accounts/:id',
        createDeleteTradingAccountRouteHandler(tradingAccountService),
    );

    // ── Command & Automation preflight ─────────────────────────

    app.post('/api/trading/commands/preflight', requireTradingCapability('write'), async (req, res) => {
        const snapshot = (res.locals as { tradingFeatureFlags?: TradingFeatureFlagSnapshot }).tradingFeatureFlags
            ?? buildTradingFeatureFlagSnapshot();

        res.json({
            success: true,
            data: {
                tier: 'write',
                title: 'Write tier enabled',
                message: 'Runtime gating allows manual command preparation. Execution submission remains out of scope until Story 4.8.',
                nextAction: 'manual-command-lane',
                evaluatedAt: snapshot.evaluatedAt,
            },
        });
    });

    app.post('/api/trading/automation/preflight', requireTradingCapability('automation'), async (req, res) => {
        const snapshot = (res.locals as { tradingFeatureFlags?: TradingFeatureFlagSnapshot }).tradingFeatureFlags
            ?? buildTradingFeatureFlagSnapshot();

        res.json({
            success: true,
            data: {
                tier: 'automation',
                title: 'Automation tier enabled',
                message: 'Runtime gating allows automation controls to appear. Paper/demo AUTO_EXECUTE bindings can now queue supported ENTRY intents to the dedicated worker, while live accounts and exit-management automation remain blocked.',
                nextAction: 'automation-control-lane',
                evaluatedAt: snapshot.evaluatedAt,
            },
        });
    });
}
