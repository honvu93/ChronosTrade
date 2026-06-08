import express from 'express';
import {
    BacktestRunStatus,
    OptimizationJobStatus,
    PrismaClient,
    SignalEventType,
} from '@prisma/client';
import { SignalDefinitionService } from '../services/signals/SignalDefinitionService';
import { SignalBacktestRunService } from '../services/signals/SignalBacktestRunService';
import { SignalBacktestTradeReplayService } from '../services/signals/SignalBacktestTradeReplayService';
import { SignalTraceService } from '../services/signals/SignalTraceService';
import { SignalOptimizationService } from '../services/signals/SignalOptimizationService';
import { SignalPlatformService } from '../services/signals/SignalPlatformService';
import { SignalBacktestExecutionService } from '../services/signals/SignalBacktestExecutionService';
import { BacktestExecutionJobPublisher } from '../queues/backtestExecutionQueue';
import { normalizeSymbol } from '../utils/symbols';
import { createDefaultBlockRegistry } from '../services/signals/blocks/createDefaultBlockRegistry';
import { resolveBlockParamSchemas } from '../services/signals/resolveBlockParamSchemas';
import { computeCandleCoverage } from '../services/signals/CandleCoverageService';
import { normalizeTimeframe, getTimeframeMinutes } from '../utils/timeframes';

type RouteGuard = express.RequestHandler[];

const parseDate = (value: unknown): Date | undefined => {
    if (typeof value !== 'string' || value.trim() === '') return undefined;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return undefined;
    return parsed;
};

const getRouteParam = (value: string | string[] | undefined) => Array.isArray(value)
    ? value[0] ?? ''
    : value ?? '';

const parseNumber = (value: unknown): number | undefined => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
};

const parseBacktestRunStatus = (value: unknown): BacktestRunStatus | undefined => {
    if (typeof value !== 'string' || value.trim() === '') return undefined;
    return Object.values(BacktestRunStatus).includes(value.toUpperCase() as BacktestRunStatus)
        ? value.toUpperCase() as BacktestRunStatus
        : undefined;
};

const parseOptimizationJobStatus = (value: unknown): OptimizationJobStatus | undefined => {
    if (typeof value !== 'string' || value.trim() === '') return undefined;
    return Object.values(OptimizationJobStatus).includes(value.toUpperCase() as OptimizationJobStatus)
        ? value.toUpperCase() as OptimizationJobStatus
        : undefined;
};

const parseSignalEventType = (value: unknown): SignalEventType | undefined => {
    if (typeof value !== 'string' || value.trim() === '') return undefined;
    return Object.values(SignalEventType).includes(value.toUpperCase() as SignalEventType)
        ? value.toUpperCase() as SignalEventType
        : undefined;
};

const toIsoString = (value: Date | null | undefined) => (value ? value.toISOString() : null);

const respondInternalError = (
    res: express.Response,
    scope: string,
    message: string,
    error: unknown,
) => {
    console.error(`[SignalRoutes:${scope}]`, error);
    return res.status(500).json({ error: message });
};

const serializePreviewOutput = (output: {
    barsProcessed: number;
    signals: Array<{
        symbol: string;
        timeframe: string;
        side: string;
        strategyId?: string | null;
        session?: string | null;
        entryTime: Date;
        entryPrice: number;
        stopLoss: number;
        takeProfit1?: number | null;
        takeProfit2?: number | null;
        invalidationPrice?: number | null;
        notes?: string | null;
        externalKey?: string | null;
        definitionCode?: string | null;
        definitionVersion?: number | null;
        executionConfigJson?: Record<string, unknown> | null;
    }>;
    events: Array<{
        signalExternalKey: string;
        eventType: string;
        candleTime: Date;
        price?: number | null;
        label?: string | null;
        metaJson?: Record<string, unknown> | null;
    }>;
    traces: Array<{
        signalExternalKey: string;
        eventType: string;
        candleTime: Date;
        stateBefore?: string | null;
        stateAfter?: string | null;
        ruleId?: string | null;
        indicatorJson?: Record<string, unknown> | null;
        thresholdJson?: Record<string, unknown> | null;
        priceJson?: Record<string, unknown> | null;
        notes?: string | null;
    }>;
    results: Array<{
        signalExternalKey: string;
        exitRuleId?: string | null;
        exitRuleCode?: string | null;
        exitRuleName?: string | null;
        exitRuleConfigJson?: Record<string, unknown> | null;
        resultSide: string;
        session: string;
        win: boolean;
        isOpen: boolean;
        rMultiple: number;
        pnlUsd: number;
        maxDrawdownPct: number;
        exitReason: string;
        exitTime?: Date | null;
        exitPrice?: number | null;
        notes?: string | null;
    }>;
}) => ({
    counts: {
        barsProcessed: output.barsProcessed,
        signals: output.signals.length,
        events: output.events.length,
        traces: output.traces.length,
        results: output.results.length,
    },
    signals: output.signals.map((signal) => ({
        ...signal,
        entryTime: signal.entryTime.toISOString(),
    })),
    events: output.events.map((event) => ({
        ...event,
        candleTime: event.candleTime.toISOString(),
    })),
    traces: output.traces.map((trace) => ({
        ...trace,
        candleTime: trace.candleTime.toISOString(),
    })),
    results: output.results.map((result) => ({
        ...result,
        exitTime: toIsoString(result.exitTime),
    })),
});

export function registerSignalRoutes(
    app: express.Application,
    prisma: PrismaClient,
    guards: {
        signalOnly?: RouteGuard;
        signalOrReport?: RouteGuard;
    } = {},
    backtestPublisher?: BacktestExecutionJobPublisher,
) {
    const definitions = new SignalDefinitionService(prisma);
    const backtests = new SignalBacktestRunService(prisma);
    const tradeReplay = new SignalBacktestTradeReplayService(prisma);
    const traces = new SignalTraceService(prisma);
    const optimization = new SignalOptimizationService(prisma);
    const platform = new SignalPlatformService(prisma);
    const execution = new SignalBacktestExecutionService(prisma);
    const signalOnly = guards.signalOnly ?? [];
    const signalOrReport = guards.signalOrReport ?? signalOnly;

    const blockRegistry = createDefaultBlockRegistry();

    app.get('/api/signals/definitions', ...signalOnly, async (req, res) => {
        try {
            const defs = await definitions.listDefinitions();
            const enriched = defs.map((def) => ({
                ...def,
                blockParamSchemas: def.isComposed
                    ? resolveBlockParamSchemas(
                          def.composedBlocks as { blocks: Array<{ id: string; indicatorId: string; indicatorParams: Record<string, unknown> }> } | null,
                          blockRegistry,
                      )
                    : [],
            }));
            res.json({ data: enriched });
        } catch (error) {
            respondInternalError(res, 'definitions-list', 'Failed to load signal definitions.', error);
        }
    });

    app.post('/api/signals/preview', ...signalOnly, async (req, res) => {
        try {
            const { signalCode, signalVersion, symbol, timeframe, dateRange, parameters, executionConfig, initialEquity, riskPercent } = req.body ?? {};

            if (!signalCode || signalVersion === undefined || !symbol || !timeframe || !dateRange?.from || !dateRange?.to || !parameters || typeof parameters !== 'object') {
                return res.status(400).json({ error: 'Missing required fields for signal preview' });
            }

            const from = new Date(String(dateRange.from));
            const to = new Date(String(dateRange.to));
            if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
                return res.status(400).json({ error: 'Invalid dateRange' });
            }

            const output = await platform.runPreview({
                signalCode: String(signalCode),
                signalVersion: Number(signalVersion),
                symbol: String(symbol),
                timeframe: String(timeframe),
                from,
                to,
                parameters,
                initialEquity: parseNumber(initialEquity),
                riskPercent: parseNumber(riskPercent),
                executionConfig: executionConfig || undefined,
            });

            res.json({
                data: {
                    signalCode: String(signalCode).trim().toUpperCase(),
                    signalVersion: Number(signalVersion),
                    symbol: normalizeSymbol(String(symbol)),
                    timeframe: String(timeframe),
                    dateRange: {
                        from: from.toISOString(),
                        to: to.toISOString(),
                    },
                    ...serializePreviewOutput(output),
                },
            });
        } catch (error) {
            console.warn('[SignalRoutes:preview] Rejected preview request:', error);
            res.status(400).json({ error: 'Failed to generate the signal preview.' });
        }
    });

    app.post('/api/signals/preview-batch', ...signalOnly, async (req, res) => {
        try {
            const result = await platform.runPreviewBatch({
                requests: Array.isArray(req.body?.requests) ? req.body.requests : undefined,
                matrix: req.body?.matrix ? {
                    assets: Array.isArray(req.body.matrix.assets) ? req.body.matrix.assets : [],
                    definitions: Array.isArray(req.body.matrix.definitions) ? req.body.matrix.definitions : [],
                } : undefined,
                maxConcurrency: parseNumber(req.body?.maxConcurrency),
            });

            res.json({ data: result });
        } catch (error) {
            console.warn('[SignalRoutes:preview-batch] Rejected preview batch request:', error);
            res.status(400).json({ error: 'Failed to generate the signal preview batch.' });
        }
    });

    app.post('/api/signals/backtests/coverage-check', ...signalOnly, async (req, res) => {
        try {
            const { symbol, timeframe, from, to } = req.body ?? {};
            if (!symbol || !timeframe || !from || !to) {
                return res.status(400).json({ error: 'Missing required fields: symbol, timeframe, from, to' });
            }
            const tfMinutes = getTimeframeMinutes(timeframe);
            if (!tfMinutes) {
                return res.status(400).json({ error: `Unsupported timeframe: ${timeframe}` });
            }
            const fromDate = new Date(from);
            const toDate = new Date(to);
            const barCount = await prisma.candle.count({
                where: {
                    symbol: normalizeSymbol(symbol),
                    timeframe: normalizeTimeframe(timeframe),
                    time: { gte: fromDate, lte: toDate },
                },
            });
            const coverage = computeCandleCoverage({
                from: fromDate,
                to: toDate,
                timeframeMinutes: tfMinutes,
                actualBarCount: barCount,
                symbol: normalizeSymbol(symbol),
                timeframe: normalizeTimeframe(timeframe),
            });
            res.json({ data: coverage });
        } catch (error) {
            respondInternalError(res, 'coverage-check', 'Failed to check candle coverage.', error);
        }
    });

    app.post('/api/signals/backtests', ...signalOnly, async (req, res) => {
        try {
            const { signalCode, signalVersion, symbol, timeframe, dateRange, parameters, executionConfig, initialEquity, riskPercent, notes, executeNow } = req.body ?? {};
            const asyncMode = req.body?.async === true;

            if (!signalCode || signalVersion === undefined || !symbol || !timeframe || !dateRange?.from || !dateRange?.to || !parameters || typeof parameters !== 'object') {
                return res.status(400).json({ error: 'Missing required fields for signal backtest creation' });
            }

            const backtestInput = {
                signalCode: String(signalCode),
                signalVersion: Number(signalVersion),
                symbol: String(symbol),
                timeframe: String(timeframe),
                dateRange: {
                    from: String(dateRange.from),
                    to: String(dateRange.to),
                },
                parameters,
                executionConfig: executionConfig || undefined,
                initialEquity: parseNumber(initialEquity),
                riskPercent: parseNumber(riskPercent),
                notes: typeof notes === 'string' ? notes : undefined,
            };

            if (executeNow === true && asyncMode && backtestPublisher) {
                const created = await backtests.createGeneratedBacktest(backtestInput);
                await backtestPublisher.enqueue({ backtestRunId: created.backtestRunId });
                return res.status(202).json({ data: { created, execution: null, queued: true } });
            }

            const result = await execution.createAndMaybeExecute(backtestInput, executeNow === true);

            res.status(201).json({ data: result });
        } catch (error) {
            console.warn('[SignalRoutes:backtests-create] Rejected backtest creation request:', error);
            res.status(400).json({ error: 'Failed to create the generated backtest run.' });
        }
    });

    app.post('/api/signals/backtests/batch', ...signalOnly, async (req, res) => {
        try {
            const { runs, batchLabel } = req.body ?? {};

            if (!Array.isArray(runs) || runs.length === 0) {
                return res.status(400).json({ error: 'runs must be a non-empty array' });
            }

            if (!backtestPublisher) {
                return res.status(503).json({ error: 'Async backtest execution is not configured' });
            }

            const batchId = crypto.randomUUID();
            const results: Array<{ backtestRunId: string; status: string }> = [];

            for (const run of runs) {
                const { signalCode, signalVersion, symbol, timeframe, dateRange, parameters, executionConfig, initialEquity, riskPercent, notes } = run ?? {};

                if (!signalCode || signalVersion === undefined || !symbol || !timeframe || !dateRange?.from || !dateRange?.to || !parameters || typeof parameters !== 'object') {
                    return res.status(400).json({ error: 'Each run must include all required fields: signalCode, signalVersion, symbol, timeframe, dateRange, parameters' });
                }

                const created = await backtests.createGeneratedBacktest({
                    signalCode: String(signalCode),
                    signalVersion: Number(signalVersion),
                    symbol: String(symbol),
                    timeframe: String(timeframe),
                    dateRange: {
                        from: String(dateRange.from),
                        to: String(dateRange.to),
                    },
                    parameters,
                    executionConfig: executionConfig || undefined,
                    initialEquity: parseNumber(initialEquity),
                    riskPercent: parseNumber(riskPercent),
                    notes: typeof notes === 'string' ? notes : undefined,
                });

                await backtestPublisher.enqueue({ backtestRunId: created.backtestRunId, batchId });
                results.push({ backtestRunId: created.backtestRunId, status: 'QUEUED' });
            }

            res.status(202).json({
                data: {
                    batchId,
                    batchLabel: batchLabel ?? null,
                    runs: results,
                },
            });
        } catch (error) {
            console.warn('[SignalRoutes:backtests-batch] Rejected batch backtest request:', error);
            res.status(400).json({ error: 'Failed to create the batch backtest runs.' });
        }
    });

    app.get('/api/signals/backtests/queue-status', ...signalOnly, async (req, res) => {
        try {
            if (!backtestPublisher?.getQueueStatus) {
                return res.json({ data: { waiting: 0, active: 0, concurrency: 5, available: false } });
            }
            const status = await backtestPublisher.getQueueStatus();
            res.json({ data: { ...status, available: true } });
        } catch (error) {
            respondInternalError(res, 'queue-status', 'Failed to fetch backtest queue status.', error);
        }
    });

    app.post('/api/signals/backtests/:id/execute', ...signalOnly, async (req, res) => {
        try {
            const runId = getRouteParam(req.params.id);
            res.json({
                data: await execution.executeRun(runId),
            });
        } catch (error: any) {
            const status = error.message?.includes('not found') ? 404 : 400;
            res.status(status).json({
                error: status === 404
                    ? 'Generated backtest run not found.'
                    : 'Failed to execute the generated backtest run.',
            });
        }
    });

    app.get('/api/signals/backtests', ...signalOrReport, async (req, res) => {
        try {
            res.json({
                data: await backtests.listGeneratedBacktests({
                    signalCode: typeof req.query.signalCode === 'string' ? req.query.signalCode : undefined,
                    signalVersion: parseNumber(req.query.signalVersion),
                    symbol: typeof req.query.symbol === 'string' ? req.query.symbol : undefined,
                    timeframe: typeof req.query.timeframe === 'string' ? req.query.timeframe : undefined,
                    status: parseBacktestRunStatus(req.query.status),
                    notes: typeof req.query.notes === 'string' ? req.query.notes : undefined,
                }),
            });
        } catch (error) {
            respondInternalError(res, 'backtests-list', 'Failed to load generated backtests.', error);
        }
    });

    app.get('/api/signals/backtests/:id', ...signalOrReport, async (req, res) => {
        try {
            const run = await backtests.getGeneratedBacktest(getRouteParam(req.params.id));
            if (!run) {
                return res.status(404).json({ error: 'Generated backtest run not found' });
            }

            res.json({ data: run });
        } catch (error) {
            respondInternalError(res, 'backtests-get', 'Failed to load the generated backtest run.', error);
        }
    });

    app.delete('/api/signals/backtests/:id', ...signalOnly, async (req, res) => {
        try {
            res.json({
                data: await backtests.deleteGeneratedBacktest(getRouteParam(req.params.id)),
            });
        } catch (error: any) {
            if (error.message?.includes('not found')) {
                return res.status(404).json({ error: 'Generated backtest run not found.' });
            }
            if (error.message?.includes('still active')) {
                return res.status(409).json({ error: 'Only completed, failed, or canceled generated runs can be deleted.' });
            }
            if (error.message?.includes('linked to indicator')) {
                return res.status(409).json({ error: 'This generated run is still linked to an active indicator and cannot be deleted.' });
            }
            respondInternalError(res, 'backtests-delete', 'Failed to delete the generated backtest run.', error);
        }
    });

    app.get('/api/signals/backtests/:id/events', ...signalOrReport, async (req, res) => {
        try {
            const runId = getRouteParam(req.params.id);
            res.json({
                data: await backtests.listRunEvents(runId, {
                    signalId: typeof req.query.signalId === 'string' ? req.query.signalId : undefined,
                    eventType: parseSignalEventType(req.query.eventType),
                    from: parseDate(req.query.from),
                    to: parseDate(req.query.to),
                }),
            });
        } catch (error: any) {
            const status = error.message?.includes('not found') ? 404 : 500;
            if (status === 404) {
                return res.status(404).json({ error: 'Generated backtest run not found.' });
            }
            respondInternalError(res, 'backtests-events', 'Failed to load backtest events.', error);
        }
    });

    app.get('/api/signals/backtests/:id/trace', ...signalOrReport, async (req, res) => {
        try {
            const runId = getRouteParam(req.params.id);
            res.json({
                data: await traces.listRunTraces(runId, {
                    signalId: typeof req.query.signalId === 'string' ? req.query.signalId : undefined,
                    signalEventId: typeof req.query.signalEventId === 'string' ? req.query.signalEventId : undefined,
                    eventType: parseSignalEventType(req.query.eventType),
                }),
            });
        } catch (error: any) {
            const status = error.message?.includes('not found') ? 404 : 500;
            if (status === 404) {
                return res.status(404).json({ error: 'Generated backtest run not found.' });
            }
            respondInternalError(res, 'backtests-trace', 'Failed to load backtest traces.', error);
        }
    });

    app.get('/api/signals/backtests/:id/trades/:rowId/replay', ...signalOrReport, async (req, res) => {
        try {
            const runId = getRouteParam(req.params.id);
            const rowId = getRouteParam(req.params.rowId);
            res.json({
                data: await tradeReplay.getTradeReplay(runId, rowId),
            });
        } catch (error: any) {
            const status = error.message?.includes('not found') ? 404 : error.message?.includes('rowId') ? 400 : 500;
            if (status === 404) {
                return res.status(404).json({ error: 'Generated backtest trade replay not found.' });
            }
            if (status === 400) {
                return res.status(400).json({ error: 'Trade replay rowId must use signalId:exitRuleId format.' });
            }
            respondInternalError(res, 'backtests-trade-replay', 'Failed to load backtest trade replay.', error);
        }
    });

    app.post('/api/signals/optimization-jobs', ...signalOnly, async (req, res) => {
        try {
            const { signalCode, signalVersion, symbol, timeframe, dateRange, parameterSpace, executionConfig, rankingConfig } = req.body ?? {};

            if (!signalCode || signalVersion === undefined || !symbol || !timeframe || !dateRange?.from || !dateRange?.to || !parameterSpace || typeof parameterSpace !== 'object') {
                return res.status(400).json({ error: 'Missing required fields for optimization job creation' });
            }

            const created = await optimization.createJob({
                signalCode: String(signalCode),
                signalVersion: Number(signalVersion),
                symbol: String(symbol),
                timeframe: String(timeframe),
                dateRange: {
                    from: String(dateRange.from),
                    to: String(dateRange.to),
                },
                parameterSpace,
                executionConfig: executionConfig || undefined,
                rankingConfig: rankingConfig || undefined,
            });

            res.status(201).json({ data: created });
        } catch (error) {
            console.warn('[SignalRoutes:optimization-create] Rejected optimization job request:', error);
            res.status(400).json({ error: 'Failed to create the optimization job.' });
        }
    });

    app.get('/api/signals/optimization-jobs', ...signalOnly, async (req, res) => {
        try {
            res.json({
                data: await optimization.listJobs({
                    signalCode: typeof req.query.signalCode === 'string' ? req.query.signalCode : undefined,
                    signalVersion: parseNumber(req.query.signalVersion),
                    status: parseOptimizationJobStatus(req.query.status),
                }),
            });
        } catch (error) {
            respondInternalError(res, 'optimization-list', 'Failed to load optimization jobs.', error);
        }
    });

    app.get('/api/signals/optimization-jobs/:id', ...signalOnly, async (req, res) => {
        try {
            const job = await optimization.getJob(getRouteParam(req.params.id));
            if (!job) {
                return res.status(404).json({ error: 'Optimization job not found' });
            }

            res.json({ data: job });
        } catch (error) {
            respondInternalError(res, 'optimization-get', 'Failed to load the optimization job.', error);
        }
    });
}
