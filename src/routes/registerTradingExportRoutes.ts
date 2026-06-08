import express from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuthenticatedRequest } from '../middleware/auth';
import { requireTradingCapability } from '../middleware/featureFlag';
import {
    isValidContractKind,
    TradingOutputContractService,
} from '../services/trading/TradingOutputContractService';
import { TradingExportService } from '../services/trading/TradingExportService';

type ContractKindParams = {
    kind?: unknown;
};

export function createGetExportContractsRouteHandler(
    service: Pick<TradingOutputContractService, 'listContracts'>,
) {
    return async (
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
    ) => {
        try {
            const contracts = service.listContracts();
            res.json({
                success: true,
                data: {
                    contracts,
                    evaluatedAt: new Date().toISOString(),
                },
            });
        } catch {
            res.status(500).json({
                success: false,
                error: {
                    code: 'CONTRACT_LIST_FAILED',
                    message: 'Failed to list output contract definitions.',
                    domain: 'trading.export',
                },
            });
        }
    };
}

export function createGetExportContractByKindRouteHandler(
    service: Pick<TradingOutputContractService, 'getContract'>,
) {
    return async (
        req: express.Request<ContractKindParams>,
        res: express.Response,
        _next: express.NextFunction,
    ) => {
        const kindParam = req.params.kind;

        if (!isValidContractKind(kindParam)) {
            res.status(400).json({
                success: false,
                error: {
                    code: 'INVALID_CONTRACT_KIND',
                    message: 'A valid output contract kind is required.',
                    domain: 'trading.export',
                },
            });
            return;
        }

        try {
            const contract = service.getContract(kindParam);

            if (!contract) {
                res.status(404).json({
                    success: false,
                    error: {
                        code: 'CONTRACT_NOT_FOUND',
                        message: `Output contract '${kindParam}' was not found.`,
                        domain: 'trading.export',
                    },
                });
                return;
            }

            res.json({
                success: true,
                data: contract,
            });
        } catch {
            res.status(500).json({
                success: false,
                error: {
                    code: 'CONTRACT_FETCH_FAILED',
                    message: 'Failed to load output contract definition.',
                    domain: 'trading.export',
                },
            });
        }
    };
}

type ExportRecordsQuery = {
    backtestRunId?: unknown;
    indicatorInstanceId?: unknown;
    contractKind?: unknown;
    limit?: unknown;
};


export function createGetExportRecordsRouteHandler(
    exportService: Pick<TradingExportService, 'exportRecords'>,
) {
    return async (
        req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
    ) => {
        const query = (req.query ?? {}) as ExportRecordsQuery;

        const backtestRunId = typeof query.backtestRunId === 'string'
            ? query.backtestRunId.trim() || null
            : null;
        const indicatorInstanceId = typeof query.indicatorInstanceId === 'string'
            ? query.indicatorInstanceId.trim() || null
            : null;

        if (backtestRunId && indicatorInstanceId) {
            res.status(400).json({
                success: false,
                error: {
                    code: 'INVALID_CONTEXT',
                    message: 'Choose either a backtest run or an indicator instance, not both.',
                    domain: 'trading.export',
                },
            });
            return;
        }

        if (typeof query.contractKind === 'string' && query.contractKind && !isValidContractKind(query.contractKind)) {
            res.status(400).json({
                success: false,
                error: {
                    code: 'INVALID_CONTRACT_KIND',
                    message: 'A valid output contract kind is required when filtering by kind.',
                    domain: 'trading.export',
                },
            });
            return;
        }

        const contractKind = typeof query.contractKind === 'string' && isValidContractKind(query.contractKind)
            ? query.contractKind
            : null;

        let limit = 200;
        if (query.limit !== undefined && query.limit !== '') {
            const parsed = Number(query.limit);
            if (!Number.isInteger(parsed) || parsed <= 0) {
                res.status(400).json({
                    success: false,
                    error: {
                        code: 'INVALID_PARAMS',
                        message: 'limit must be a positive integer when supplied.',
                        domain: 'trading.export',
                    },
                });
                return;
            }
            limit = parsed;
        }

        try {
            const result = await exportService.exportRecords({
                backtestRunId,
                indicatorInstanceId,
                contractKind,
                limit,
            });

            res.json({
                success: true,
                data: result,
            });
        } catch {
            res.status(500).json({
                success: false,
                error: {
                    code: 'EXPORT_RECORDS_FAILED',
                    message: 'Failed to export trade activity records.',
                    domain: 'trading.export',
                },
            });
        }
    };
}

export function registerTradingExportRoutes(app: express.Application, prisma?: PrismaClient) {
    const contractService = new TradingOutputContractService();

    app.get(
        '/api/trading/exports/contracts',
        requireAuthenticatedRequest,
        requireTradingCapability('read'),
        createGetExportContractsRouteHandler(contractService),
    );

    app.get(
        '/api/trading/exports/contracts/:kind',
        requireAuthenticatedRequest,
        requireTradingCapability('read'),
        createGetExportContractByKindRouteHandler(contractService),
    );

    if (prisma) {
        const exportService = new TradingExportService(prisma, contractService);

        app.get(
            '/api/trading/exports/records',
            requireAuthenticatedRequest,
            requireTradingCapability('read'),
            createGetExportRecordsRouteHandler(exportService),
        );
    }
}
