import express from 'express';
import http from 'http';
import cors from 'cors';
import {
    extractBearerToken,
    hydrateAuthorizedUser,
    hydrateAuthorizedUserUnlessIngestion,
    requireAdminAccess,
    requireAppAuthentication,
    requireAppAuthenticationOrIngestion,
    requireModuleAccess,
} from './middleware/auth';
import { SocketService } from './services/SocketService';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { getCorsOptions } from './utils/corsConfig';

import { PrismaClient } from '@prisma/client';
import IORedis from 'ioredis';
import path from 'path';
import { registerEngineRoutes } from './routes/registerEngineRoutes';
import { registerSignalRoutes } from './routes/registerSignalRoutes';
import { registerIndicatorRoutes } from './routes/registerIndicatorRoutes';
import { registerTradingAccountRoutes } from './routes/registerTradingAccountRoutes';
import { registerTradingWorkspaceRoutes } from './routes/registerTradingWorkspaceRoutes';
import { registerTradingOperationsRoutes } from './routes/registerTradingOperationsRoutes';
import { registerTradingIntegrationRoutes } from './routes/registerTradingIntegrationRoutes';
import { registerAuthRoutes } from './routes/registerAuthRoutes';
import { registerMonitoringRoutes } from './routes/registerMonitoringRoutes';
import { MonitoringService } from './services/admin/MonitoringService';
import { registerPublicRoutes } from './routes/registerPublicRoutes';
import { loadComposedSignals } from './services/signals/loadComposedSignals';
import { IndicatorCatalogService } from './services/signals/IndicatorCatalogService';
import { createDefaultBlockRegistry } from './services/signals/blocks/createDefaultBlockRegistry';
import { upsertTier1ComposedSignals } from './services/signals/tier1ComposedSignals';
import { songTrapRuntime } from './services/signals/plugins/songTrap/runtime';
import {
    dedupeMarketSymbolRowsByTime,
    getMarketSymbolAliases,
    normalizeMarketSymbol,
} from './utils/symbols';
import {
    getTimeframeAliases,
    normalizeTimeframe,
} from './utils/timeframes';
import { IndicatorLiveRunner } from './services/signals/IndicatorLiveRunner';
import { IndicatorInstanceService } from './services/signals/IndicatorInstanceService';
import { IndicatorStateService } from './services/signals/IndicatorStateService';
import { SignalRegistry } from './services/signals/SignalRegistry';
import { CandleQueryService } from './services/signals/CandleQueryService';
import { IndicatorSeriesService } from './services/signals/IndicatorSeriesService';
import { ExecutionModelService } from './services/signals/ExecutionModelService';
import { AlertEngine } from './services/signals/AlertEngine';
import { SyncAlertService } from './services/admin/SyncAlertService';
import { AlertDispatchService } from './services/admin/AlertDispatchService';
import { IndicatorAlertService } from './services/signals/IndicatorAlertService';
import { BullMqTradingAutoExecutionJobPublisher } from './queues/tradingAutoExecutionQueue';
import { BullMqBacktestExecutionJobPublisher } from './queues/backtestExecutionQueue';
import { TradingTradeIntentService } from './services/trading/TradingTradeIntentService';
import { SignalLiveEligibilityService } from './services/trading/SignalLiveEligibilityService';
import { BullMqExternalActionDeliveryJobPublisher } from './services/trading/externalAction/ExternalActionDeliveryQueue';
import { ExternalActionEventService } from './services/trading/externalAction/ExternalActionEventService';
import { ExternalActionReplayService } from './services/trading/externalAction/ExternalActionReplayService';
import { PostgresExternalActionStore } from './services/trading/externalAction/ExternalSignalStore';
import {
    BATCH_INGEST_JSON_BODY_LIMIT,
    DEFAULT_JSON_BODY_LIMIT,
    getJsonBodyLimitForPath,
    SINGLE_INGEST_JSON_BODY_LIMIT,
} from './utils/requestBodyLimits';
import {
    describeTrustProxySetting,
    resolveTrustProxySetting,
} from './utils/trustProxy';

// --- Ingestion helpers (module-level, no side effects) ---

function isValidCandle(c: any): boolean {
    if (!c || !c.time || isNaN(Date.parse(c.time))) return false;
    const { open, high, low, close } = c;
    if ([open, high, low, close].some((v: any) => typeof v !== 'number' || isNaN(v))) return false;
    if (Math.max(open, close) > high || Math.min(open, close) < low) return false;
    if (high < low) return false;
    if (typeof c.volume === 'number' && c.volume < 0) return false;
    return true;
}

const getRouteParam = (value: string | string[] | undefined) => Array.isArray(value)
    ? value[0] ?? ''
    : value ?? '';

const MAX_OHLCV_QUERY_LIMIT = 5_000;
const DEFAULT_OHLCV_QUERY_LIMIT = 500;
const MAX_INGEST_BATCHES = 25;
const MAX_INGEST_CANDLES_PER_BATCH = 5_000;
const MAX_INGEST_CANDLES_PER_REQUEST = 5_000;

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

// --- ApiServer ---

export class ApiServer {
    private app: express.Express;
    private server: http.Server;
    private socketService: SocketService;
    private prisma: PrismaClient;
    private pub: IORedis;
    private autoExecutionPublisher: BullMqTradingAutoExecutionJobPublisher;
    private backtestPublisher: BullMqBacktestExecutionJobPublisher;
    private externalActionStore: PostgresExternalActionStore | null;
    private externalActionPublisher: BullMqExternalActionDeliveryJobPublisher | null;
    private alertEngine: AlertEngine;
    private indicatorRunner: IndicatorLiveRunner;

    constructor() {
        this.app = express();
        this.server = http.createServer(this.app);
        this.socketService = new SocketService(this.server);
        this.prisma = new PrismaClient();
        this.pub = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
            maxRetriesPerRequest: null,
        });
        this.autoExecutionPublisher = new BullMqTradingAutoExecutionJobPublisher(process.env);
        this.backtestPublisher = new BullMqBacktestExecutionJobPublisher(process.env);
        this.externalActionStore = process.env.EXTERNAL_SIGNAL_DB_URL?.trim()
            ? new PostgresExternalActionStore(process.env)
            : null;
        this.externalActionPublisher = process.env.EXTERNAL_SIGNAL_DB_URL?.trim()
            ? new BullMqExternalActionDeliveryJobPublisher(process.env)
            : null;

        this.alertEngine = new AlertEngine(
            this.prisma,
            new IndicatorAlertService(this.prisma),
            this.pub
        );

        this.indicatorRunner = new IndicatorLiveRunner(
            this.prisma,
            new IndicatorInstanceService(this.prisma),
            new IndicatorStateService(this.prisma),
            SignalRegistry.getInstance(),
            new CandleQueryService(this.prisma),
            new IndicatorSeriesService(),
            new ExecutionModelService(),
            this.pub,
            undefined,
            new TradingTradeIntentService(this.prisma, this.autoExecutionPublisher),
            this.externalActionStore && this.externalActionPublisher
                ? new ExternalActionEventService(
                    this.externalActionStore,
                    this.externalActionPublisher,
                    new SignalLiveEligibilityService(this.prisma),
                )
                : null,
        );

        this.setupMiddlewares();
        this.setupRoutes();
        this.setupErrorHandling();
    }

    private setupMiddlewares() {
        const trustProxy = resolveTrustProxySetting(process.env);
        this.app.set('trust proxy', trustProxy);
        console.log(`[API] Express trust proxy: ${describeTrustProxySetting(trustProxy)}`);

        this.app.use(helmet());
        this.app.use(cors(getCorsOptions()));
        const defaultJsonParser = express.json({ limit: DEFAULT_JSON_BODY_LIMIT });
        const singleIngestJsonParser = express.json({ limit: SINGLE_INGEST_JSON_BODY_LIMIT });
        const batchIngestJsonParser = express.json({ limit: BATCH_INGEST_JSON_BODY_LIMIT });

        this.app.use((req, res, next) => {
            const limit = getJsonBodyLimitForPath(req.path);
            if (limit === BATCH_INGEST_JSON_BODY_LIMIT) {
                return batchIngestJsonParser(req, res, next);
            }
            if (limit === SINGLE_INGEST_JSON_BODY_LIMIT) {
                return singleIngestJsonParser(req, res, next);
            }
            return defaultJsonParser(req, res, next);
        });

        // Rate limiting
        const apiLimiter = rateLimit({
            windowMs: 1 * 60 * 1000, // 1 minute
            max: 200,
            standardHeaders: true,
            legacyHeaders: false,
            message: { error: 'Too many requests, please try again later.' }
        });
        this.app.use('/api/', apiLimiter);

        this.app.use(express.static(path.join(__dirname, '../public')));
    }

    private setupErrorHandling() {
        this.app.use((error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
            const candidate = error as { type?: unknown; status?: unknown; expose?: unknown; message?: unknown };
            if (candidate?.type === 'entity.too.large' || candidate?.status === 413) {
                res.status(413).json({
                    success: false,
                    error: {
                        code: 'REQUEST_TOO_LARGE',
                        message: `JSON request body exceeds the ${getJsonBodyLimitForPath(req.path)} limit for this endpoint.`,
                        domain: 'api.request',
                    },
                });
                return;
            }

            next(error);
        });
    }

    /**
     * Bulk upsert candles into DB and publish the last candle to Redis.
     * Internally chunks into batches of 500 to avoid Prisma transaction limits.
     */
    private async upsertCandles(
        symbol: string,
        exchange: string,
        timeframe: string,
        candles: any[]
    ): Promise<number> {
        const symbolUpper = normalizeMarketSymbol(symbol);
        const canonicalTimeframe = normalizeTimeframe(timeframe);
        const exchangeUpper = exchange.toUpperCase();
        const CHUNK = 500;

        for (let i = 0; i < candles.length; i += CHUNK) {
            const chunk = candles.slice(i, i + CHUNK);
            await this.prisma.$transaction(
                chunk.map((c: any) =>
                    this.prisma.candle.upsert({
                        where: {
                            time_symbol_timeframe_exchange: {
                                time: new Date(c.time),
                                symbol: symbolUpper,
                                timeframe: canonicalTimeframe,
                                exchange: exchangeUpper,
                            },
                        },
                        update: {
                            open: c.open,
                            high: c.high,
                            low: c.low,
                            close: c.close,
                            volume: c.volume ?? 0,
                            is_closed: true,
                        },
                        create: {
                            time: new Date(c.time),
                            symbol: symbolUpper,
                            timeframe: canonicalTimeframe,
                            exchange: exchangeUpper,
                            open: c.open,
                            high: c.high,
                            low: c.low,
                            close: c.close,
                            volume: c.volume ?? 0,
                            is_closed: true,
                        },
                    })
                )
            );
        }

        // Publish latest candle to Redis for real-time broadcast
        const last = candles[candles.length - 1];
        const redisChannel = `live:${symbolUpper}:${canonicalTimeframe}`;
        await this.pub.publish(
            redisChannel,
            JSON.stringify({
                s: symbolUpper,
                t: new Date(last.time).getTime(),
                open: last.open,
                high: last.high,
                low: last.low,
                close: last.close,
                volume: last.volume ?? 0,
                is_closed: true,
            })
        );

        // Trigger Indicator Runner for this asset
        this.triggerIndicators(symbolUpper, canonicalTimeframe).catch(err => {
            console.error(`[ApiServer] Error triggering indicators:`, err);
        });

        return candles.length;
    }

    private async triggerIndicators(symbol: string, timeframe: string) {
        try {
            const canonicalTimeframe = normalizeTimeframe(timeframe);
            const activeInstances = await this.prisma.indicatorInstance.findMany({
                where: {
                    symbol: { in: getMarketSymbolAliases(symbol) },
                    timeframe: { in: getTimeframeAliases(canonicalTimeframe) },
                    status: 'ACTIVE',
                },
                orderBy: { createdAt: 'desc' },
            });

            if (activeInstances.length === 0) return;

            for (const instance of activeInstances) {
                await this.indicatorRunner.runTick(instance.id);
            }
        } catch (error) {
            console.error(`[IndicatorRunner] Failed to run for ${symbol}/${normalizeTimeframe(timeframe)}:`, error);
        }
    }

    private setupRoutes() {
        const requireWorkspaceAuth = (): express.RequestHandler[] => [
            requireAppAuthentication,
            hydrateAuthorizedUser(this.prisma),
        ];
        const requireWorkspaceOrIngestionAuth = (): express.RequestHandler[] => [
            requireAppAuthenticationOrIngestion(process.env),
            hydrateAuthorizedUserUnlessIngestion(this.prisma),
        ];
        const requireAdmin = (): express.RequestHandler[] => [
            ...requireWorkspaceAuth(),
            requireAdminAccess(this.prisma),
        ];
        const requireModule = (...modules: Array<'chart' | 'signal' | 'report' | 'trading' | 'engine'>): express.RequestHandler[] => [
            ...requireWorkspaceAuth(),
            requireModuleAccess(this.prisma, modules),
        ];

        this.app.get('/health', async (req, res) => {
            try {
                const [probe, redisPing] = await Promise.all([
                    new MonitoringService(this.prisma).healthProbe(),
                    this.pub.ping().then(() => 'ok' as const).catch(() => 'failed' as const),
                ]);
                const failed = probe.db === 'failed' || redisPing === 'failed';
                const degraded = !failed && probe.bridge === 'unreachable';
                res.status(failed ? 503 : 200).json({
                    status: failed ? 'error' : degraded ? 'degraded' : 'ok',
                    db: probe.db,
                    redis: redisPing,
                    bridge: probe.bridge,
                });
            } catch {
                res.status(503).json({ status: 'error' });
            }
        });
        registerAuthRoutes(this.app, this.prisma, this.pub);
        registerPublicRoutes(this.app, this.prisma);

        // Get available symbols
        this.app.get('/api/symbols', ...requireWorkspaceAuth(), async (req, res) => {
            try {
                const symbols = await this.prisma.candle.groupBy({
                    by: ['symbol'],
                    orderBy: { symbol: 'asc' }
                });
                const normalized = Array.from(new Set(symbols.map((entry) => normalizeMarketSymbol(entry.symbol))));
                res.json(normalized.sort((left, right) => left.localeCompare(right)));
            } catch (error: any) {
                console.error('[API] Symbols fetch failed:', error);
                res.status(500).json({ error: 'Failed to fetch available symbols' });
            }
        });

        // Get OHLCV data
        this.app.get('/api/ohlcv/:symbol', ...requireWorkspaceAuth(), async (req, res) => {
            try {
                const symbol = getRouteParam(req.params.symbol);
                const timeframe = normalizeTimeframe(req.query.timeframe as string || '1m');
                const limit = parseBoundedPositiveInteger(req.query.limit, {
                    defaultValue: DEFAULT_OHLCV_QUERY_LIMIT,
                    max: MAX_OHLCV_QUERY_LIMIT,
                });
                const startTime = req.query.startTime === undefined ? null : Number(req.query.startTime);
                const endTime = req.query.endTime === undefined ? null : Number(req.query.endTime);

                if (limit === null || (startTime !== null && !Number.isFinite(startTime)) || (endTime !== null && !Number.isFinite(endTime))) {
                    return res.status(400).json({
                        error: `limit must be a positive integer up to ${MAX_OHLCV_QUERY_LIMIT}, and startTime/endTime must be numeric timestamps when supplied.`,
                    });
                }

                const canonicalSymbol = normalizeMarketSymbol(symbol);
                const symbolAliases = getMarketSymbolAliases(symbol);
                const timeframeAliases = getTimeframeAliases(timeframe);
                const whereClause: any = {
                    symbol: symbolAliases.length === 1 ? symbolAliases[0] : { in: symbolAliases },
                    timeframe: timeframeAliases.length === 1 ? timeframeAliases[0] : { in: timeframeAliases },
                };
                if (startTime || endTime) {
                    whereClause.time = {
                        ...(startTime ? { gte: new Date(startTime) } : {}),
                        ...(endTime ? { lt: new Date(endTime) } : {}),
                    };
                }

                const data = await this.prisma.candle.findMany({
                    where: whereClause,
                    orderBy: { time: 'desc' },
                    take: limit * symbolAliases.length * timeframeAliases.length,
                });

                const responseRows = dedupeMarketSymbolRowsByTime(data, canonicalSymbol, {
                    newestFirst: true,
                    preferredTimeframeAliases: timeframeAliases,
                })
                    .slice(0, limit)
                    .reverse()
                    .map((row) => ({
                        ...row,
                        symbol: canonicalSymbol,
                        timeframe,
                    }));

                res.json(responseRows);
            } catch (error: any) {
                console.error('[API] OHLCV fetch failed:', error);
                res.status(500).json({ error: 'Failed to fetch price data' });
            }
        });

        // Get Sync Status for a specific symbol
        this.app.get('/api/sync-status/:symbol', ...requireWorkspaceOrIngestionAuth(), async (req, res) => {
            try {
                const symbol = getRouteParam(req.params.symbol);
                const canonicalSymbol = normalizeMarketSymbol(symbol);
                const timeframe = normalizeTimeframe(req.query.timeframe as string || '1m');

                const stats = await this.prisma.candle.aggregate({
                    where: {
                        symbol: { in: getMarketSymbolAliases(symbol) },
                        timeframe: { in: getTimeframeAliases(timeframe) },
                    },
                    _min: { time: true },
                    _max: { time: true },
                    _count: { _all: true }
                });

                res.json({
                    symbol: canonicalSymbol,
                    timeframe,
                    oldest: stats._min?.time || null,
                    latest: stats._max?.time || null,
                    totalCandles: stats._count._all
                });
            } catch (error: any) {
                console.error('[API] Sync status fetch failed:', error);
                res.status(500).json({ error: 'Failed to fetch sync status' });
            }
        });

        // Get Market Summary (Watchlist init data)
        this.app.get('/api/market-summary', ...requireWorkspaceAuth(), async (req, res) => {
            try {
                const symbolsResult = await this.prisma.candle.groupBy({
                    by: ['symbol'],
                    orderBy: { symbol: 'asc' }
                });

                const symbols = Array.from(new Set(symbolsResult.map((entry) => normalizeMarketSymbol(entry.symbol))))
                    .sort((left, right) => left.localeCompare(right));
                const summaries = [];

                for (const symbol of symbols) {
                    const symbolAliases = getMarketSymbolAliases(symbol);
                    const latest1dRows = await this.prisma.candle.findMany({
                        where: { symbol: { in: symbolAliases }, timeframe: '1d' },
                        orderBy: { time: 'desc' },
                        take: symbolAliases.length,
                    });
                    const latest1d = dedupeMarketSymbolRowsByTime(latest1dRows, symbol, { newestFirst: true })[0];

                    if (latest1d) {
                        // Fetch last 20 candles for sparkline
                        const historyRaw = await this.prisma.candle.findMany({
                            where: { symbol: { in: symbolAliases }, timeframe: '1d' },
                            orderBy: { time: 'desc' },
                            take: 20 * symbolAliases.length,
                            select: { time: true, close: true, symbol: true }
                        });
                        const history = dedupeMarketSymbolRowsByTime(historyRaw, symbol, { newestFirst: true }).slice(0, 20);

                        summaries.push({
                            symbol,
                            lastPrice: parseFloat(latest1d.close.toString()),
                            openPrice: parseFloat(latest1d.open.toString()),
                            highPrice: parseFloat(latest1d.high.toString()),
                            lowPrice: parseFloat(latest1d.low.toString()),
                            volume: parseFloat(latest1d.volume.toString()),
                            changePercent: ((parseFloat(latest1d.close.toString()) - parseFloat(latest1d.open.toString())) / parseFloat(latest1d.open.toString())) * 100,
                            sparkline: history.map(h => parseFloat(h.close.toString())).reverse()
                        });
                    }
                }

                res.json(summaries);
            } catch (error: any) {
                console.error('[API] Market summary fetch failed:', error);
                res.status(500).json({ error: 'Failed to fetch market summary' });
            }
        });

        // POST /api/ohlcv/batch — PHẢI đứng TRƯỚC /:symbol để Express không match 'batch' vào param
        // Auth: Authorization: Bearer <INGESTION_TOKEN>
        // Body: { batches: [{ symbol, exchange, timeframe, candles[] }] }
        this.app.post('/api/ohlcv/batch', async (req, res) => {
            try {
                const token = extractBearerToken(req);
                const validToken = process.env.INGESTION_TOKEN;
                if (!validToken || token !== validToken) {
                    return res.status(401).json({ error: 'Unauthorized' });
                }

                const { batches } = req.body;
                if (!Array.isArray(batches) || batches.length === 0) {
                    return res.status(400).json({ error: 'batches must be a non-empty array' });
                }
                if (batches.length > MAX_INGEST_BATCHES) {
                    return res.status(400).json({
                        error: `batches must contain no more than ${MAX_INGEST_BATCHES} items per request.`,
                    });
                }

                const results: { symbol: string; timeframe: string; inserted: number; rejected: number }[] = [];

                for (const batch of batches) {
                    const { symbol, exchange, timeframe, candles } = batch;
                    if (!symbol || !timeframe || !Array.isArray(candles)) continue;
                    const canonicalTimeframe = normalizeTimeframe(String(timeframe));
                    if (candles.length > MAX_INGEST_CANDLES_PER_BATCH) {
                        return res.status(400).json({
                            error: `Each batch can contain at most ${MAX_INGEST_CANDLES_PER_BATCH} candles.`,
                        });
                    }

                    const validCandles = candles.filter(isValidCandle);
                    const rejected = candles.length - validCandles.length;
                    if (rejected > 0) {
                        console.warn(`[batch] Rejected ${rejected} invalid candles for ${symbol}/${timeframe}`);
                    }

                    if (validCandles.length > 0) {
                        await this.upsertCandles(symbol, exchange ?? 'MT5', canonicalTimeframe, validCandles);
                    }

                    results.push({ symbol, timeframe: canonicalTimeframe, inserted: validCandles.length, rejected });
                }

                res.json({ ok: true, results });
            } catch (error: any) {
                console.error('[API] Batch ingestion failed:', error);
                res.status(500).json({ error: 'Internal ingestion failure' });
            }
        });

        // POST /api/ohlcv/:symbol — Ingest candles từ external source (single symbol)
        // Auth: Authorization: Bearer <INGESTION_TOKEN>
        // Body: { exchange: string, timeframe: string, candles: CandleInput[] }
        this.app.post('/api/ohlcv/:symbol', async (req, res) => {
            try {
                const token = extractBearerToken(req);
                const validToken = process.env.INGESTION_TOKEN;
                if (!validToken || token !== validToken) {
                    return res.status(401).json({ error: 'Unauthorized' });
                }

                const { symbol } = req.params;
                const { exchange, timeframe, candles } = req.body;
                const canonicalTimeframe = normalizeTimeframe(String(timeframe ?? ''));

                if (!canonicalTimeframe || !Array.isArray(candles) || candles.length === 0) {
                    return res.status(400).json({ error: 'Missing required fields: timeframe, candles[]' });
                }
                if (candles.length > MAX_INGEST_CANDLES_PER_REQUEST) {
                    return res.status(400).json({
                        error: `candles[] can contain at most ${MAX_INGEST_CANDLES_PER_REQUEST} items per request.`,
                    });
                }

                const validCandles = candles.filter(isValidCandle);
                const rejected = candles.length - validCandles.length;
                if (rejected > 0) {
                    console.warn(`[ohlcv] Rejected ${rejected} invalid candles for ${symbol}/${canonicalTimeframe}`);
                }

                if (validCandles.length === 0) {
                    return res.json({ ok: true, inserted: 0, rejected });
                }

                await this.upsertCandles(symbol, exchange ?? 'MT5', canonicalTimeframe, validCandles);
                res.json({ ok: true, inserted: validCandles.length, rejected });
            } catch (error: any) {
                console.error(`[API] Ingestion failed for ${req.params.symbol}:`, error);
                res.status(500).json({ error: 'Internal ingestion failure' });
            }
        });

        registerEngineRoutes(this.app, this.prisma, requireModule('engine', 'signal', 'report'));
        registerSignalRoutes(this.app, this.prisma, {
            signalOnly: requireModule('signal'),
            signalOrReport: requireModule('signal', 'report'),
        }, this.backtestPublisher);
        registerIndicatorRoutes(this.app as any, this.prisma, {
            signalOnly: requireModule('signal'),
            signalOrEngine: requireModule('signal', 'engine'),
            adminOnly: requireAdmin(),
        });
        registerMonitoringRoutes(this.app, this.prisma, {
            adminOnly: requireAdmin(),
        });
        this.app.use('/api/trading', ...requireModule('trading'));
        registerTradingAccountRoutes(this.app, this.prisma);
        registerTradingWorkspaceRoutes(this.app, this.prisma);
        registerTradingOperationsRoutes(this.app, this.prisma);
        registerTradingIntegrationRoutes(this.app, this.prisma, this.externalActionStore && this.externalActionPublisher
            ? {
                store: this.externalActionStore,
                replayService: new ExternalActionReplayService(
                    this.externalActionStore,
                    this.externalActionPublisher,
                ),
            }
            : undefined);
    }

    public async start(port: number) {
        if (this.externalActionStore?.isConfigured()) {
            await this.externalActionStore.ensureReady();
        }

        // Initialize Signal Registry with built-ins
        const signalRegistry = SignalRegistry.getInstance();
        signalRegistry.register(songTrapRuntime);

        // Load Composed signals from DB
        const blockRegistry = createDefaultBlockRegistry();
        const indicatorCatalogService = new IndicatorCatalogService(this.prisma, blockRegistry);
        await indicatorCatalogService.syncCatalogFromRuntime();
        const tier1SeedResult = await upsertTier1ComposedSignals(this.prisma, blockRegistry);
        console.log(`[Tier1Signals] ensured composed signals: created=${tier1SeedResult.created}, updated=${tier1SeedResult.updated}, skipped=${tier1SeedResult.skipped.length}`);
        if (tier1SeedResult.skipped.length > 0) {
            console.warn(`[Tier1Signals] Skipped non-system managed rows: ${tier1SeedResult.skipped.join(', ')}`);
        }
        await loadComposedSignals(signalRegistry, this.prisma, blockRegistry, indicatorCatalogService);

        // First-boot guidance: if no completed backtests exist, log a hint
        const completedBacktestCount = await this.prisma.backtestRun.count({
            where: { status: 'COMPLETED' },
        });
        if (completedBacktestCount === 0) {
            console.log('[FirstBoot] No completed backtests found. Run the following to generate results and rank signals:');
            console.log('[FirstBoot]   ts-node src/scripts/runAllTier1BatchBacktest.ts');
            console.log('[FirstBoot] Then set up paper trading with:');
            console.log('[FirstBoot]   ts-node src/scripts/setupPaperPortfolio.ts --signals=<CODE> --accountId=<ID>');
        }

        this.socketService.init();
        this.alertEngine.init();
        new SyncAlertService(this.prisma).start();
        new AlertDispatchService(process.env).start(process.env.REDIS_URL || 'redis://localhost:6379');
        this.server.listen(port, () => {
            console.log(`[API] Server running on port ${port}`);
        });
    }
}
