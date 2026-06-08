import { PrismaClient } from '@prisma/client';
import { IndicatorInstanceService } from './IndicatorInstanceService';
import { IndicatorStateService } from './IndicatorStateService';
import { SignalRegistry } from './SignalRegistry';
import { CandleQueryService } from './CandleQueryService';
import {
    SignalRuntimeServices,
    SignalInitializationContext,
    CandleBar,
    RuntimeLogicTraceDraft,
} from './types';
import { IndicatorSeriesService } from './IndicatorSeriesService';
import { ExecutionModelService } from './ExecutionModelService';
import { IndicatorLogger } from './IndicatorLogger';
import IORedis from 'ioredis';
import {
    createTradingWebhookDeliveryService,
    TradingWebhookDeliveryService,
} from '../trading/TradingWebhookDeliveryService';
import { PersistedLiveSignalEvent, TradingTradeIntentService } from '../trading/TradingTradeIntentService';
import { ExternalActionEventService } from '../trading/externalAction/ExternalActionEventService';

export class IndicatorLiveRunner {
    private runtimeServices: SignalRuntimeServices;
    private logger: IndicatorLogger;
    private processingInstances: Set<string> = new Set();

    constructor(
        private prisma: PrismaClient,
        private instances: IndicatorInstanceService,
        private states: IndicatorStateService,
        private registry: SignalRegistry,
        private candleQuery: CandleQueryService,
        private indicatorSeries: IndicatorSeriesService,
        private executionModel: ExecutionModelService,
        private redisPub: IORedis,
        private webhookDeliveryService: Pick<TradingWebhookDeliveryService, 'deliverConfiguredOutputs'> = createTradingWebhookDeliveryService(prisma),
        private tradeIntentService: Pick<TradingTradeIntentService, 'captureAutoExecuteEntryIntents'> | null = null,
        private externalActionEventService: Pick<ExternalActionEventService, 'captureActionableEvents'> | null = null,
    ) {
        this.logger = new IndicatorLogger(this.redisPub);
        this.runtimeServices = {
            indicatorSeries: {
                calculateSMAFromCandles: this.indicatorSeries.calculateSMAFromCandles.bind(this.indicatorSeries),
                calculateSMA: this.indicatorSeries.calculateSMA.bind(this.indicatorSeries),
                calculateRSIFromCandles: this.indicatorSeries.calculateRSIFromCandles.bind(this.indicatorSeries),
                calculateRSI: this.indicatorSeries.calculateRSI.bind(this.indicatorSeries),
                calculateEMAFromCandles: this.indicatorSeries.calculateEMAFromCandles.bind(this.indicatorSeries),
                calculateEMA: this.indicatorSeries.calculateEMA.bind(this.indicatorSeries),
                calculateWMA: this.indicatorSeries.calculateWMA.bind(this.indicatorSeries),
                getPointAtOrBefore: this.indicatorSeries.getPointAtOrBefore.bind(this.indicatorSeries),
                alignPointsToBars: this.indicatorSeries.alignPointsToBars.bind(this.indicatorSeries),
                calculateATR: this.indicatorSeries.calculateATR.bind(this.indicatorSeries),
                calculateADX: this.indicatorSeries.calculateADX.bind(this.indicatorSeries),
            },
            executionModel: {
                resolveConfig: this.executionModel.resolveConfig.bind(this.executionModel),
                getEntryFill: this.executionModel.getEntryFill.bind(this.executionModel),
                getExitFill: this.executionModel.getExitFill.bind(this.executionModel),
                resolvePositionSizing: this.executionModel.resolvePositionSizing.bind(this.executionModel),
                resolveStopLoss: this.executionModel.resolveStopLoss.bind(this.executionModel),
                resolveTakeProfit: this.executionModel.resolveTakeProfit.bind(this.executionModel),
                calculateNetPnl: this.executionModel.calculateNetPnl.bind(this.executionModel),
                calculateNetR: this.executionModel.calculateNetR.bind(this.executionModel),
            },
        };
    }

    public async runTick(instanceId: string) {
        if (this.processingInstances.has(instanceId)) {
            return;
        }

        const startTime = Date.now();
        const instance = await this.instances.getInstance(instanceId);
        if (!instance || instance.status !== 'ACTIVE') return;

        this.processingInstances.add(instanceId);

        try {
            await this.logger.debug(instanceId, `Starting evaluation tick for ${instance.symbol}:${instance.timeframe}`);

            const plugin = this.registry.get(instance.signalCode, instance.signalVersion);
            if (!plugin) {
                await this.logger.error(instanceId, `Plugin ${instance.signalCode}@${instance.signalVersion} not found`);
                return;
            }

            const lastProcessed = instance.lastProcessedCandleTime || instance.startedAt || new Date(0);

            const newBarsRaw = await this.candleQuery.getCandles({
                symbol: instance.symbol,
                timeframe: instance.timeframe,
                from: lastProcessed,
                to: new Date(),
            });

            // Filter out already processed candles (since query uses gte)
            const newBars = newBarsRaw.filter(b => b.time.getTime() > lastProcessed.getTime());

            if (newBars.length === 0) {
                await this.logger.debug(instanceId, 'No new candles since last tick');
                return;
            }

            await this.logger.info(instanceId, `Processing ${newBars.length} new candles`);

            const tfMinutes = this.parseTimeframeToMinutes(instance.timeframe);
            const historyMillis = 200 * tfMinutes * 60 * 1000;

            const historyWindow = await this.candleQuery.getCandles({
                symbol: instance.symbol,
                timeframe: instance.timeframe,
                from: new Date(lastProcessed.getTime() - historyMillis),
                to: lastProcessed,
                limit: 200,
            });

            const allBars = [...historyWindow, ...newBars];
            const baseOffset = historyWindow.length;

            const initContext: SignalInitializationContext<any> = {
                symbol: instance.symbol,
                timeframe: instance.timeframe,
                baseBars: allBars,
                barsByTimeframe: { [instance.timeframe]: allBars },
                parameters: instance.parameterJson,
                initialEquity: 10000,
                riskPercent: 1,
                executionConfig: this.executionModel.resolveConfig(instance.executionConfigJson as any),
                services: this.runtimeServices,
            };

            let currentState = instance.stateJson || await plugin.initialize(initContext);

            for (let i = 0; i < newBars.length; i++) {
                const bar = newBars[i];
                const globalIndex = baseOffset + i;

                const step = await plugin.onBar({
                    ...initContext,
                    index: globalIndex,
                    bar,
                    state: currentState,
                });

                if (step) {
                    currentState = step.state;
                    const deliveries: Array<{
                        contractKind: 'signal-event' | 'execution-event';
                        limit: number;
                    }> = [];
                    let persistedEvents: PersistedLiveSignalEvent[] = [];

                    if (step.events?.length) {
                        await this.logger.info(instanceId, `Generated ${step.events.length} new events`, { candle: bar.time });

                        // Assign cycleNumber to deduplicate events within a tick.
                        // Events of the same (instanceId, candleTime, eventType) get sequential
                        // cycleNumbers so TRAIL_UPDATE can fire multiple times on the same candle.
                        const cycleCounters = new Map<string, number>();
                        const eventsWithCycle = step.events.map(e => {
                            const key = `${e.eventType}:${new Date(e.candleTime).toISOString()}`;
                            const cycle = cycleCounters.get(key) ?? 0;
                            cycleCounters.set(key, cycle + 1);
                            return { ...e, cycleNumber: cycle };
                        });

                        const savedEventsRaw: Awaited<ReturnType<typeof this.prisma.signalEvent.create>>[] = [];
                        for (const e of eventsWithCycle) {
                            try {
                                const saved = await this.prisma.signalEvent.create({
                                    data: {
                                        indicatorInstanceId: instance.id,
                                        eventType: e.eventType,
                                        candleTime: e.candleTime,
                                        cycleNumber: e.cycleNumber,
                                        price: e.price,
                                        label: e.label,
                                        metaJson: {
                                            ...(e.metaJson as any),
                                            tp1: (e.metaJson as any)?.tp1 || (currentState as any)?.tp1,
                                            tp2: (e.metaJson as any)?.tp2 || (currentState as any)?.tp2,
                                            sl: (e.metaJson as any)?.sl || (currentState as any)?.sl,
                                            entryPrice: (e.metaJson as any)?.entryPrice || e.price,
                                        } as any,
                                    },
                                });
                                savedEventsRaw.push(saved);
                            } catch (createError: unknown) {
                                // P2002 = unique constraint violation → duplicate event from a crash/restart
                                const code = (createError as Record<string, unknown>)?.code;
                                if (code === 'P2002') {
                                    await this.logger.debug(instanceId, `Duplicate signal event skipped (idempotency): ${e.eventType} at ${e.candleTime}`);
                                } else {
                                    throw createError;
                                }
                            }
                        }
                        const savedEvents = savedEventsRaw;
                        persistedEvents = savedEvents.map((savedEvent, index) => ({
                            draftEvent: step.events![index],
                            savedEvent: {
                                id: savedEvent.id,
                                eventType: savedEvent.eventType,
                                candleTime: savedEvent.candleTime,
                                price: savedEvent.price,
                                label: savedEvent.label ?? null,
                                metaJson: savedEvent.metaJson ?? null,
                            },
                        }));

                        // Publish to Redis for real-time broadcast
                        for (const saved of savedEvents) {
                            await this.redisPub.publish('indicator:events', JSON.stringify({
                                instanceId: instance.id,
                                symbol: instance.symbol,
                                timeframe: instance.timeframe,
                                event: saved
                            }));
                        }

                        if (this.tradeIntentService) {
                            try {
                                await this.tradeIntentService.captureAutoExecuteEntryIntents({
                                    indicatorInstanceId: instance.id,
                                    runtimeSignal: step.signal ?? null,
                                    persistedEvents,
                                });
                            } catch (intentError) {
                                const msg = intentError instanceof Error ? intentError.message : String(intentError);
                                await this.logger.error(instanceId, `Intent capture failed: ${msg}`);
                                await this.redisPub.publish('system:alerts', JSON.stringify({
                                    source: 'indicator-live-runner',
                                    event: 'intent_capture_failed',
                                    instanceId,
                                    message: msg,
                                    timestamp: new Date().toISOString(),
                                })).catch(() => undefined);
                            }
                        }

                        if (this.externalActionEventService) {
                            try {
                                await this.externalActionEventService.captureActionableEvents({
                                    indicatorInstanceId: instance.id,
                                    runtimeSignal: step.signal ?? null,
                                    persistedEvents,
                                });
                            } catch (actionError) {
                                const msg = actionError instanceof Error ? actionError.message : String(actionError);
                                await this.logger.error(instanceId, `External actionable event capture failed: ${msg}`);
                            }
                        }

                        deliveries.push({
                            contractKind: 'signal-event',
                            limit: step.events.length,
                        });
                    }

                    if (step.traces?.length) {
                        const traceEventCandidates = this.buildTraceEventCandidates(persistedEvents);
                        await this.prisma.signalLogicTrace.createMany({
                            data: step.traces.map(t => ({
                                indicatorInstanceId: instance.id,
                                signalEventId: this.takeLinkedSignalEventId(traceEventCandidates, t) ?? undefined,
                                eventType: t.eventType,
                                candleTime: t.candleTime,
                                stateBefore: t.stateBefore,
                                stateAfter: t.stateAfter,
                                ruleId: t.ruleId,
                                indicatorJson: t.indicatorJson as any,
                                thresholdJson: t.thresholdJson as any,
                                priceJson: t.priceJson as any,
                                notes: t.notes,
                            })),
                        });

                        deliveries.push({
                            contractKind: 'execution-event',
                            limit: step.traces.length,
                        });
                    }

                    if (deliveries.length > 0) {
                        await this.dispatchWebhookOutputs(instance.id, deliveries);
                    }
                }
            }

            const endTime = Date.now();
            const processingTime = endTime - startTime;
            const lastCandle = newBars[newBars.length - 1];
            const lag = Date.now() - new Date(lastCandle.time).getTime();

            await this.logger.info(instanceId, `Tick completed in ${processingTime}ms. Current lag: ${lag}ms`, { lag, processingTime });

            await this.states.saveCheckpoint(instance.id, currentState, lastCandle.time);

            // Clear any previous error if successful
            if (instance.errorMessage) {
                await this.prisma.indicatorInstance.update({
                    where: { id: instanceId },
                    data: { errorMessage: null }
                });
            }
        } catch (error: any) {
            const msg = error.message || 'Unknown runner error';
            await this.logger.error(instanceId, `Runner fatal error: ${msg}`);

            await this.prisma.indicatorInstance.update({
                where: { id: instanceId },
                data: { errorMessage: msg }
            });
        } finally {
            this.processingInstances.delete(instanceId);
        }
    }

    private buildTraceEventCandidates(persistedEvents: PersistedLiveSignalEvent[]) {
        return persistedEvents.map((persistedEvent) => ({
            signalEventId: persistedEvent.savedEvent.id,
            keys: this.getTraceLookupKeys(persistedEvent.draftEvent),
        }));
    }

    private takeLinkedSignalEventId(
        candidates: Array<{ signalEventId: string; keys: string[] }>,
        trace: RuntimeLogicTraceDraft,
    ) {
        const lookupKeys = new Set(this.getTraceLookupKeys(trace));
        const matchIndex = candidates.findIndex((candidate) => candidate.keys.some((key) => lookupKeys.has(key)));
        if (matchIndex < 0) {
            return null;
        }

        return candidates.splice(matchIndex, 1)[0]?.signalEventId ?? null;
    }

    private getTraceLookupKeys(record: {
        signalExternalKey?: string | null;
        eventType: string;
        candleTime: Date;
    }) {
        const candleTime = record.candleTime.toISOString();
        const keys = [`event:${record.eventType}:${candleTime}`];

        if (record.signalExternalKey && record.signalExternalKey.trim().length > 0) {
            keys.unshift(`signal:${record.signalExternalKey}:${record.eventType}:${candleTime}`);
        }

        return keys;
    }

    private async dispatchWebhookOutputs(
        indicatorInstanceId: string,
        deliveries: Array<{
            contractKind: 'signal-event' | 'execution-event';
            limit: number;
        }>,
    ) {
        try {
            await this.webhookDeliveryService.deliverConfiguredOutputs({
                backtestRunId: null,
                indicatorInstanceId,
                deliveries,
            });
        } catch {
            await this.logger.debug(indicatorInstanceId, 'Webhook delivery failed without blocking runtime progress');
        }
    }

    private parseTimeframeToMinutes(timeframe: string): number {
        const match = timeframe.match(/^(\d+)([mhd])$/i);
        if (!match) {
            // Handle common MT5 style names if they leak here
            if (timeframe.startsWith('H')) return parseInt(timeframe.substring(1)) * 60;
            if (timeframe.startsWith('D')) return 1440;
            if (timeframe.startsWith('M')) return parseInt(timeframe.substring(1));
            return 1;
        }
        const val = parseInt(match[1]);
        const unit = match[2].toLowerCase();
        if (unit === 'm') return val;
        if (unit === 'h') return val * 60;
        if (unit === 'd') return val * 1440;
        return 1;
    }
}
