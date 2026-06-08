import express from 'express';
import { PrismaClient } from '@prisma/client';
import { buildTradingFeatureFlagSnapshot } from '../services/trading/tradingFeatureFlags';
import { requireAuthenticatedRequest } from '../middleware/auth';
import { requireTradingCapability } from '../middleware/featureFlag';
import { SignalLiveEligibilityService } from '../services/trading/SignalLiveEligibilityService';
import { SignalVersionService } from '../services/trading/SignalVersionService';
import { FailureClassificationService } from '../services/trading/FailureClassificationService';
import { TradingAccountService, TradingAccountServiceError } from '../services/trading/TradingAccountService';
import {
    TradingDiagnosisService,
    RecordTradingInvestigationOutcomeInput,
    TradingInvestigationOutcome,
    TradingRootCauseCategory,
} from '../services/trading/TradingDiagnosisService';
import { TradingChecklistService } from '../services/trading/TradingChecklistService';

type SignalVersionQuery = {
    backtestRunId?: unknown;
    indicatorInstanceId?: unknown;
};

type TradeHistoryQuery = {
    limit?: unknown;
};

type AccountReadinessQuery = {
    accountId?: unknown;
    userId?: unknown;
};

type TradingAccessQuery = {
    accountId?: unknown;
    userId?: unknown;
};

type TradingDiscrepancyQuery = {
    backtestRunId?: unknown;
    indicatorInstanceId?: unknown;
    tradeRecordId?: unknown;
};

type TradingDiagnosisOutcomeBody = {
    backtestRunId?: unknown;
    indicatorInstanceId?: unknown;
    tradeRecordId?: unknown;
    rootCauseCategory?: unknown;
    outcome?: unknown;
    summary?: unknown;
};

const ROOT_CAUSE_CATEGORIES = new Set<TradingRootCauseCategory>([
    'data-quality',
    'signal-logic',
    'risk-settings',
    'broker-execution',
]);

const INVESTIGATION_OUTCOMES = new Set<TradingInvestigationOutcome>([
    'resolved',
    'mitigated',
    'escalated',
]);

const parsePositiveInteger = (value: unknown): number | null | undefined => {
    if (value === undefined || value === null || value === '') {
        return undefined;
    }

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        return null;
    }

    return parsed;
};

const parseVersionParam = (value: unknown): number | null => {
    const normalized = String(value ?? '').trim();
    if (!/^\d+$/.test(normalized)) {
        return null;
    }

    const parsed = Number(normalized);
    return Number.isSafeInteger(parsed) ? parsed : null;
};

const readScopedOwnerUserId = (value: unknown): string | null => {
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
};

export function createGetSignalVersionRouteHandler(
    signalVersionService: Pick<SignalVersionService, 'getSnapshot'>,
): express.RequestHandler {
    return async (req, res) => {
        const code = String(req.params.code ?? '').trim();
        const version = parseVersionParam(req.params.version);
        const query = (req.query ?? {}) as SignalVersionQuery;
        const locals = (res.locals ?? {}) as { authorizedUser?: { id: string } };
        const backtestRunId = typeof query.backtestRunId === 'string'
            ? query.backtestRunId.trim()
            : '';
        const indicatorInstanceId = typeof query.indicatorInstanceId === 'string'
            ? query.indicatorInstanceId.trim()
            : '';

        if (!code || version === null) {
            res.status(400).json({
                success: false,
                error: {
                    code: 'INVALID_PARAMS',
                    message: 'Signal code and a numeric version are required.',
                    domain: 'trading.signal-version',
                },
            });
            return;
        }

        if (backtestRunId && indicatorInstanceId) {
            res.status(400).json({
                success: false,
                error: {
                    code: 'INVALID_CONTEXT',
                    message: 'Choose either a backtest run or an indicator instance, not both.',
                    domain: 'trading.signal-version',
                },
            });
            return;
        }

        try {
            const snapshot = await signalVersionService.getSnapshot({
                code,
                version,
                backtestRunId: backtestRunId || null,
                indicatorInstanceId: indicatorInstanceId || null,
                ...(locals.authorizedUser?.id ? { actorUserId: locals.authorizedUser.id } : {}),
            });

            if (!snapshot) {
                res.status(404).json({
                    success: false,
                    error: {
                        code: 'SIGNAL_VERSION_NOT_FOUND',
                        message: `Signal ${code}@v${version} was not found for the supplied context.`,
                        domain: 'trading.signal-version',
                    },
                });
                return;
            }

            res.json({ success: true, data: snapshot });
        } catch {
            res.status(500).json({
                success: false,
                error: {
                    code: 'SIGNAL_VERSION_FETCH_FAILED',
                    message: 'Failed to fetch signal version context.',
                    domain: 'trading.signal-version',
                },
            });
        }
    };
}

export function createGetTradeHistoryRouteHandler(
    tradingAuditService: Pick<TradingDiagnosisService, 'listHistory'>,
): express.RequestHandler {
    return async (req, res) => {
        const query = (req.query ?? {}) as TradeHistoryQuery;
        const limit = parsePositiveInteger(query.limit);

        if (limit === null) {
            res.status(400).json({
                success: false,
                error: {
                    code: 'INVALID_PARAMS',
                    message: 'limit must be a positive integer when supplied.',
                    domain: 'trading.history',
                },
            });
            return;
        }

        try {
            const snapshot = await tradingAuditService.listHistory({
                limit: limit ?? undefined,
            });
            res.json({ success: true, data: snapshot });
        } catch {
            res.status(500).json({
                success: false,
                error: {
                    code: 'TRADE_HISTORY_FETCH_FAILED',
                    message: 'Failed to fetch trade history and audit timeline summary.',
                    domain: 'trading.history',
                },
            });
        }
    };
}

export function createGetTradeHistoryDetailRouteHandler(
    tradingAuditService: Pick<TradingDiagnosisService, 'getHistoryDetail'>,
): express.RequestHandler {
    return async (req, res) => {
        const recordId = String(req.params.recordId ?? '').trim();

        if (!recordId) {
            res.status(400).json({
                success: false,
                error: {
                    code: 'INVALID_PARAMS',
                    message: 'A recordId is required.',
                    domain: 'trading.history',
                },
            });
            return;
        }

        try {
            const detail = await tradingAuditService.getHistoryDetail(recordId);

            if (!detail) {
                res.status(404).json({
                    success: false,
                    error: {
                        code: 'TRADE_HISTORY_RECORD_NOT_FOUND',
                        message: `Trade history record ${recordId} was not found.`,
                        domain: 'trading.history',
                    },
                });
                return;
            }

            res.json({ success: true, data: detail });
        } catch {
            res.status(500).json({
                success: false,
                error: {
                    code: 'TRADE_HISTORY_DETAIL_FAILED',
                    message: 'Failed to fetch trade history detail.',
                    domain: 'trading.history',
                },
            });
        }
    };
}

export function createGetTradingDiscrepancyRouteHandler(
    tradingDiscrepancyService: Pick<TradingDiagnosisService, 'getDiscrepancy'>,
): express.RequestHandler {
    return async (req, res) => {
        const code = String(req.params.code ?? '').trim();
        const version = parseVersionParam(req.params.version);
        const query = (req.query ?? {}) as TradingDiscrepancyQuery;
        const locals = (res.locals ?? {}) as { authorizedUser?: { id: string } };
        const backtestRunId = typeof query.backtestRunId === 'string'
            ? query.backtestRunId.trim()
            : '';
        const indicatorInstanceId = typeof query.indicatorInstanceId === 'string'
            ? query.indicatorInstanceId.trim()
            : '';
        const tradeRecordId = typeof query.tradeRecordId === 'string'
            ? query.tradeRecordId.trim()
            : '';

        if (!code || version === null) {
            res.status(400).json({
                success: false,
                error: {
                    code: 'INVALID_PARAMS',
                    message: 'Signal code and a numeric version are required.',
                    domain: 'trading.discrepancy',
                },
            });
            return;
        }

        try {
            const snapshot = await tradingDiscrepancyService.getDiscrepancy({
                code,
                version,
                backtestRunId: backtestRunId || null,
                indicatorInstanceId: indicatorInstanceId || null,
                tradeRecordId: tradeRecordId || null,
            });

            if (!snapshot) {
                res.status(404).json({
                    success: false,
                    error: {
                        code: 'DISCREPANCY_CONTEXT_NOT_FOUND',
                        message: `No backtest-versus-live discrepancy context was found for ${code}@v${version}.`,
                        domain: 'trading.discrepancy',
                    },
                });
                return;
            }

            res.json({ success: true, data: snapshot });
        } catch {
            res.status(500).json({
                success: false,
                error: {
                    code: 'DISCREPANCY_FETCH_FAILED',
                    message: 'Failed to fetch backtest-versus-live discrepancy context.',
                    domain: 'trading.discrepancy',
                },
            });
        }
    };
}

export function createGetTradingDiagnosisRouteHandler(
    tradingRootCauseService: Pick<TradingDiagnosisService, 'diagnose'>,
): express.RequestHandler {
    return async (req, res) => {
        const code = String(req.params.code ?? '').trim();
        const version = parseVersionParam(req.params.version);
        const query = (req.query ?? {}) as TradingDiscrepancyQuery;
        const locals = (res.locals ?? {}) as { authorizedUser?: { id: string } };
        const backtestRunId = typeof query.backtestRunId === 'string'
            ? query.backtestRunId.trim()
            : '';
        const indicatorInstanceId = typeof query.indicatorInstanceId === 'string'
            ? query.indicatorInstanceId.trim()
            : '';
        const tradeRecordId = typeof query.tradeRecordId === 'string'
            ? query.tradeRecordId.trim()
            : '';

        if (!code || version === null) {
            res.status(400).json({
                success: false,
                error: {
                    code: 'INVALID_PARAMS',
                    message: 'Signal code and a numeric version are required.',
                    domain: 'trading.diagnosis',
                },
            });
            return;
        }

        try {
            const snapshot = await tradingRootCauseService.diagnose({
                code,
                version,
                backtestRunId: backtestRunId || null,
                indicatorInstanceId: indicatorInstanceId || null,
                tradeRecordId: tradeRecordId || null,
                ...(locals.authorizedUser?.id ? { actorUserId: locals.authorizedUser.id } : {}),
            });

            if (!snapshot) {
                res.status(404).json({
                    success: false,
                    error: {
                        code: 'DIAGNOSIS_CONTEXT_NOT_FOUND',
                        message: `No investigation context was found for ${code}@v${version}.`,
                        domain: 'trading.diagnosis',
                    },
                });
                return;
            }

            res.json({ success: true, data: snapshot });
        } catch {
            res.status(500).json({
                success: false,
                error: {
                    code: 'DIAGNOSIS_FETCH_FAILED',
                    message: 'Failed to diagnose the likely root cause for this investigation.',
                    domain: 'trading.diagnosis',
                },
            });
        }
    };
}

export function createCreateTradingDiagnosisOutcomeRouteHandler(
    tradingRootCauseService: Pick<TradingDiagnosisService, 'recordOutcome'>,
): express.RequestHandler {
    return async (req, res) => {
        const code = String(req.params.code ?? '').trim();
        const version = parseVersionParam(req.params.version);
        const body = (req.body ?? {}) as TradingDiagnosisOutcomeBody;
        const locals = (res.locals ?? {}) as { authorizedUser?: { id: string } };
        const backtestRunId = typeof body.backtestRunId === 'string'
            ? body.backtestRunId.trim()
            : '';
        const indicatorInstanceId = typeof body.indicatorInstanceId === 'string'
            ? body.indicatorInstanceId.trim()
            : '';
        const tradeRecordId = typeof body.tradeRecordId === 'string'
            ? body.tradeRecordId.trim()
            : '';
        const rootCauseCategory = typeof body.rootCauseCategory === 'string'
            ? body.rootCauseCategory.trim()
            : null;
        const outcome = typeof body.outcome === 'string'
            ? body.outcome.trim()
            : null;
        const summary = typeof body.summary === 'string'
            ? body.summary.trim()
            : '';

        if (!code || version === null) {
            res.status(400).json({
                success: false,
                error: {
                    code: 'INVALID_PARAMS',
                    message: 'Signal code and a numeric version are required.',
                    domain: 'trading.diagnosis',
                },
            });
            return;
        }

        if (
            !rootCauseCategory
            || !outcome
            || !ROOT_CAUSE_CATEGORIES.has(rootCauseCategory as TradingRootCauseCategory)
            || !INVESTIGATION_OUTCOMES.has(outcome as TradingInvestigationOutcome)
        ) {
            res.status(400).json({
                success: false,
                error: {
                    code: 'INVALID_BODY',
                    message: 'A valid rootCauseCategory and outcome are required.',
                    domain: 'trading.diagnosis',
                },
            });
            return;
        }

        const payload: RecordTradingInvestigationOutcomeInput = {
            code,
            version,
            backtestRunId: backtestRunId || null,
            indicatorInstanceId: indicatorInstanceId || null,
            tradeRecordId: tradeRecordId || null,
            rootCauseCategory: rootCauseCategory as TradingRootCauseCategory,
            outcome: outcome as TradingInvestigationOutcome,
            summary: summary || null,
            ...(locals.authorizedUser?.id ? { actorUserId: locals.authorizedUser.id } : {}),
        };

        try {
            const record = await tradingRootCauseService.recordOutcome(payload);

            if (!record) {
                res.status(404).json({
                    success: false,
                    error: {
                        code: 'DIAGNOSIS_CONTEXT_NOT_FOUND',
                        message: `No investigation context was found for ${code}@v${version}.`,
                        domain: 'trading.diagnosis',
                    },
                });
                return;
            }

            res.status(201).json({
                success: true,
                data: record,
            });
        } catch {
            res.status(500).json({
                success: false,
                error: {
                    code: 'DIAGNOSIS_OUTCOME_WRITE_FAILED',
                    message: 'Failed to record the investigation outcome.',
                    domain: 'trading.diagnosis',
                },
            });
        }
    };
}

export function createGetTradingChecklistRouteHandler(
    checklistService: Pick<TradingChecklistService, 'getChecklist'>,
): express.RequestHandler {
    return async (_req, res) => {
        const locals = (res.locals ?? {}) as { authorizedUser?: { id: string; role: string } };
        if (!locals.authorizedUser) {
            res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required.', domain: 'trading.checklist' } });
            return;
        }
        try {
            const data = await checklistService.getChecklist(locals.authorizedUser.id);
            res.json({ success: true, data });
        } catch (error) {
            console.error('[TradingOperationsRoutes] Checklist error:', error);
            res.status(500).json({ success: false, error: { code: 'CHECKLIST_FAILED', message: 'Unable to load checklist.', domain: 'trading.checklist' } });
        }
    };
}

export function registerTradingOperationsRoutes(app: express.Application, prisma: PrismaClient) {
    const eligibilityService = new SignalLiveEligibilityService(prisma);
    const tradingAccountService = new TradingAccountService(prisma);
    const signalVersionService = new SignalVersionService(prisma, process.env, tradingAccountService);
    const failureClassificationService = new FailureClassificationService(prisma);
    const diagnosisService = new TradingDiagnosisService(prisma, process.env, tradingAccountService);

    app.get('/api/trading/operations/access', async (req, res) => {
        try {
            const query = (req.query ?? {}) as TradingAccessQuery;
            const locals = (res.locals ?? {}) as { authorizedUser?: { id: string; role: 'ADMIN' | 'USER' } };
            const accountId = typeof query.accountId === 'string' ? query.accountId.trim() || null : null;
            const ownerUserId = readScopedOwnerUserId(query.userId);
            const account = accountId && locals.authorizedUser
                ? await tradingAccountService.getBrokerContext(locals.authorizedUser, accountId, { ownerUserId })
                : null;

            res.json({
                success: true,
                data: buildTradingFeatureFlagSnapshot(undefined, undefined, {
                    accountMode: account?.accountMode ?? null,
                }),
            });
        } catch (error) {
            if (error instanceof TradingAccountServiceError) {
                res.status(error.statusCode).json({
                    success: false,
                    error: {
                        code: error.code,
                        message: error.message,
                        domain: error.domain,
                    },
                });
                return;
            }

            res.status(500).json({
                success: false,
                error: {
                    code: 'TRADING_ACCESS_FETCH_FAILED',
                    message: 'Failed to evaluate runtime trading capability flags.',
                    domain: 'trading.access',
                },
            });
        }
    });

    app.get(
        '/api/trading/operations/signal-eligibility',
        requireAuthenticatedRequest,
        requireTradingCapability('read'),
        async (req, res) => {
            try {
                const items = await eligibilityService.listEligibility();
                res.json({
                    success: true,
                    data: {
                        items,
                        evaluatedAt: new Date().toISOString(),
                    },
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: {
                        code: 'ELIGIBILITY_FETCH_FAILED',
                        message: 'Failed to evaluate signal live eligibility.',
                        domain: 'trading.eligibility',
                    },
                });
            }
        },
    );

    app.get(
        '/api/trading/operations/account-readiness',
        requireAuthenticatedRequest,
        async (req, res) => {
            try {
                const query = (req.query ?? {}) as AccountReadinessQuery;
                const locals = (res.locals ?? {}) as { authorizedUser?: { id: string; role: 'ADMIN' | 'USER' } };
                const snapshot = await tradingAccountService.getFullReadinessSnapshotForActor(
                    locals.authorizedUser ?? null,
                    {
                        accountId: typeof query.accountId === 'string' ? query.accountId.trim() || null : null,
                        ownerUserId: readScopedOwnerUserId(query.userId),
                    },
                );
                res.json({
                    success: true,
                    data: snapshot,
                });
            } catch (error) {
                if (error instanceof TradingAccountServiceError) {
                    res.status(error.statusCode).json({
                        success: false,
                        error: {
                            code: error.code,
                            message: error.message,
                            domain: error.domain,
                        },
                    });
                    return;
                }

                res.status(500).json({
                    success: false,
                    error: {
                        code: 'ACCOUNT_READINESS_FAILED',
                        message: 'Failed to evaluate trading account readiness.',
                        domain: 'trading.account',
                    },
                });
            }
        },
    );

    app.get(
        '/api/trading/operations/signal-versions/:code/:version',
        requireAuthenticatedRequest,
        requireTradingCapability('read'),
        createGetSignalVersionRouteHandler(signalVersionService),
    );

    app.get(
        '/api/trading/operations/failure-classification',
        requireAuthenticatedRequest,
        requireTradingCapability('read'),
        async (_req, res) => {
            try {
                const snapshot = await failureClassificationService.classify();
                res.json({ success: true, data: snapshot });
            } catch {
                res.status(500).json({
                    success: false,
                    error: {
                        code: 'FAILURE_CLASSIFICATION_FAILED',
                        message: 'Failed to evaluate domain failure classification.',
                        domain: 'trading.failures',
                    },
                });
            }
        },
    );

    app.get(
        '/api/trading/operations/trade-history',
        requireAuthenticatedRequest,
        requireTradingCapability('read'),
        createGetTradeHistoryRouteHandler(diagnosisService),
    );

    app.get(
        '/api/trading/operations/trade-history/:recordId',
        requireAuthenticatedRequest,
        requireTradingCapability('read'),
        createGetTradeHistoryDetailRouteHandler(diagnosisService),
    );

    app.get(
        '/api/trading/operations/discrepancies/:code/:version',
        requireAuthenticatedRequest,
        requireTradingCapability('read'),
        createGetTradingDiscrepancyRouteHandler(diagnosisService),
    );

    app.get(
        '/api/trading/operations/diagnosis/:code/:version',
        requireAuthenticatedRequest,
        requireTradingCapability('read'),
        createGetTradingDiagnosisRouteHandler(diagnosisService),
    );

    app.post(
        '/api/trading/operations/diagnosis/:code/:version',
        requireAuthenticatedRequest,
        requireTradingCapability('write'),
        express.json(),
        createCreateTradingDiagnosisOutcomeRouteHandler(diagnosisService),
    );

    const checklistService = new TradingChecklistService(prisma);
    app.get(
        '/api/trading/checklist',
        requireAuthenticatedRequest,
        requireTradingCapability('read'),
        createGetTradingChecklistRouteHandler(checklistService),
    );
}
