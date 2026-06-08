import express from 'express';
import {
    buildTradingFeatureFlagSnapshot,
    TradingCapabilityTier,
    TradingFeatureFlagSnapshot,
} from '../services/trading/tradingFeatureFlags';
import { PrismaClient } from '@prisma/client';
import { TradingAccountService, TradingAccountServiceError } from '../services/trading/TradingAccountService';
import { createTradingExecutionLogger } from '../services/trading/tradingExecutionLogger';

const tierDomains: Record<TradingCapabilityTier, string> = {
    read: 'trading.sync',
    write: 'trading.execution',
    automation: 'trading.automation',
};

const tradingExecutionLogger = createTradingExecutionLogger();

export const requireTradingCapability = (
    tier: TradingCapabilityTier,
): express.RequestHandler => (req, res, next) => {
    const snapshot = buildTradingFeatureFlagSnapshot();
    const capability = snapshot.capabilities[tier];

    if (capability.enabled) {
        (res.locals as { tradingFeatureFlags?: TradingFeatureFlagSnapshot }).tradingFeatureFlags = snapshot;
        return next();
    }

    if (tier === 'write') {
        const locals = (res.locals ?? {}) as {
            authorizedUser?: {
                id: string;
            };
        };
        tradingExecutionLogger.log('warn', {
            event: 'command_capability_blocked',
            message: capability.reason,
            actorUserId: locals.authorizedUser?.id ?? null,
            requestedByUserId: locals.authorizedUser?.id ?? null,
            accountId: typeof req.params?.id === 'string' ? req.params.id.trim() || null : null,
            route: req.originalUrl ?? req.url ?? null,
            errorCode: 'TRADING_FEATURE_DISABLED',
            errorMessage: capability.reason,
            metadata: {
                tier,
                blockedBy: capability.blockedBy,
                flags: snapshot.flags,
            },
        });
    }

    return res.status(403).json({
        success: false,
        error: {
            code: 'TRADING_FEATURE_DISABLED',
            message: capability.reason,
            domain: tierDomains[tier],
            meta: {
                tier,
                blockedBy: capability.blockedBy,
                flags: snapshot.flags,
                evaluatedAt: snapshot.evaluatedAt,
            },
        },
    });
};

export const requireTradingCapabilityForAccount = (
    prisma: PrismaClient,
    tier: TradingCapabilityTier,
): express.RequestHandler => async (req, res, next) => {
    try {
        const locals = (res.locals ?? {}) as {
            authorizedUser?: {
                id: string;
                role: 'ADMIN' | 'USER';
            };
        };
        const actor = locals.authorizedUser;
        const accountId = String(req.params.id ?? '').trim();
        const scopedOwnerUserId = typeof req.query?.userId === 'string'
            ? req.query.userId.trim() || null
            : null;
        const tradingAccountService = new TradingAccountService(prisma);
        const account = actor && accountId
            ? await tradingAccountService.getBrokerContext(actor, accountId, {
                ownerUserId: scopedOwnerUserId,
            })
            : null;
        const snapshot = buildTradingFeatureFlagSnapshot(undefined, undefined, {
            accountMode: account?.accountMode ?? null,
        });
        const capability = snapshot.capabilities[tier];

        if (capability.enabled) {
            (res.locals as { tradingFeatureFlags?: TradingFeatureFlagSnapshot }).tradingFeatureFlags = snapshot;
            return next();
        }

        if (tier === 'write') {
            tradingExecutionLogger.log('warn', {
                event: 'command_capability_blocked',
                message: capability.reason,
                actorUserId: actor?.id ?? null,
                requestedByUserId: actor?.id ?? null,
                ownerUserId: account?.ownerUserId ?? null,
                ownerScopeUserId: scopedOwnerUserId,
                accountId: accountId || null,
                accountMode: account?.accountMode ?? null,
                route: req.originalUrl ?? req.url ?? null,
                errorCode: 'TRADING_FEATURE_DISABLED',
                errorMessage: capability.reason,
                metadata: {
                    tier,
                    blockedBy: capability.blockedBy,
                    flags: snapshot.flags,
                },
            });
        }

        return res.status(403).json({
            success: false,
            error: {
                code: 'TRADING_FEATURE_DISABLED',
                message: capability.reason,
                domain: tierDomains[tier],
                meta: {
                    tier,
                    blockedBy: capability.blockedBy,
                    flags: snapshot.flags,
                    evaluatedAt: snapshot.evaluatedAt,
                    accountMode: account?.accountMode ?? null,
                },
            },
        });
    } catch (error) {
        if (tier === 'write') {
            tradingExecutionLogger.log('error', {
                event: 'command_capability_check_failed',
                message: error instanceof Error
                    ? error.message
                    : 'Trading capability checks failed before the account-scoped request could proceed.',
                actorUserId: ((res.locals ?? {}) as { authorizedUser?: { id: string } }).authorizedUser?.id ?? null,
                requestedByUserId: ((res.locals ?? {}) as { authorizedUser?: { id: string } }).authorizedUser?.id ?? null,
                ownerScopeUserId: typeof req.query?.userId === 'string' ? req.query.userId.trim() || null : null,
                accountId: typeof req.params?.id === 'string' ? req.params.id.trim() || null : null,
                route: req.originalUrl ?? req.url ?? null,
                errorCode: error instanceof TradingAccountServiceError
                    ? error.code
                    : 'TRADING_FEATURE_CHECK_FAILED',
                errorMessage: error instanceof Error
                    ? error.message
                    : 'Trading capability checks failed before the account-scoped request could proceed.',
            });
        }
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

        return res.status(500).json({
            success: false,
            error: {
                code: 'TRADING_FEATURE_CHECK_FAILED',
                message: 'Trading capability checks failed before the account-scoped request could proceed.',
                domain: tierDomains[tier],
            },
        });
    }
};
