import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { IndicatorLiveRunner } from './IndicatorLiveRunner';

describe('IndicatorLiveRunner', () => {
    it('auto-dispatches live signal and execution outputs after persisting a tick', async () => {
        const deliveryCalls: unknown[] = [];
        const traceCreateManyCalls: Array<{ data: Array<Record<string, unknown>> }> = [];
        let candleQueryCalls = 0;
        const prisma = {
            signalEvent: {
                create: async (args: { data: Record<string, unknown> }) => ({
                    id: 'evt-1',
                    createdAt: new Date('2026-03-11T08:00:00.000Z'),
                    ...args.data,
                }),
            },
            signalLogicTrace: {
                createMany: async (args: { data: Array<Record<string, unknown>> }) => {
                    traceCreateManyCalls.push(args);
                    return undefined;
                },
            },
            indicatorInstance: {
                update: async () => undefined,
            },
            $transaction: async (operations: Array<Promise<unknown>>) => Promise.all(operations),
        } as never;
        const instances = {
            getInstance: async () => ({
                id: 'inst-1',
                status: 'ACTIVE',
                symbol: 'XAUUSD',
                timeframe: 'H1',
                signalCode: 'songTrap',
                signalVersion: 3,
                parameterJson: {},
                executionConfigJson: {},
                stateJson: null,
                errorMessage: null,
                startedAt: new Date('2026-03-11T07:00:00.000Z'),
                lastProcessedCandleTime: null,
            }),
        };
        const states = {
            saveCheckpoint: async () => undefined,
        };
        const registry = {
            get: () => ({
                initialize: async () => ({}),
                onBar: async () => ({
                    state: { step: 'updated' },
                    events: [{
                        signalExternalKey: 'signal-1',
                        eventType: 'ENTRY_CONFIRMED',
                        candleTime: new Date('2026-03-11T08:00:00.000Z'),
                        price: 2000,
                        label: 'Entry confirmed',
                        metaJson: null,
                    }],
                    traces: [{
                        signalExternalKey: 'signal-1',
                        eventType: 'ENTRY_CONFIRMED',
                        candleTime: new Date('2026-03-11T08:00:00.000Z'),
                        stateBefore: 'WAITING',
                        stateAfter: 'ENTERED',
                        ruleId: 'rule-1',
                        indicatorJson: null,
                        thresholdJson: null,
                        priceJson: null,
                        notes: 'Trace',
                    }],
                }),
            }),
        };
        const candleQuery = {
            getCandles: async () => {
                candleQueryCalls += 1;
                if (candleQueryCalls === 1) {
                    return [{
                        time: new Date('2026-03-11T08:00:00.000Z'),
                        open: 1995,
                        high: 2005,
                        low: 1990,
                        close: 2000,
                        volume: 10,
                    }];
                }

                return [];
            },
        };
        const indicatorSeries = {
            calculateSMAFromCandles() { return []; },
            calculateSMA() { return []; },
            calculateRSIFromCandles() { return []; },
            calculateRSI() { return []; },
            calculateEMAFromCandles() { return []; },
            calculateEMA() { return []; },
            calculateWMA() { return []; },
            getPointAtOrBefore() { return null; },
            alignPointsToBars() { return []; },
            calculateATR() { return []; },
            calculateADX() { return []; },
        };
        const executionModel = {
            resolveConfig() { return {}; },
            getEntryFill() { return null; },
            getExitFill() { return null; },
            resolvePositionSizing() { return null; },
            resolveStopLoss() { return null; },
            resolveTakeProfit() { return null; },
            calculateNetPnl() { return 0; },
            calculateNetR() { return 0; },
        };
        const redisPub = {
            publish: async () => 1,
        };

        const runner = new IndicatorLiveRunner(
            prisma,
            instances as never,
            states as never,
            registry as never,
            candleQuery as never,
            indicatorSeries as never,
            executionModel as never,
            redisPub as never,
            {
                deliverConfiguredOutputs: async (args) => {
                    deliveryCalls.push(args);
                    return [];
                },
            },
        );

        await runner.runTick('inst-1');

        assert.equal(deliveryCalls.length, 1);
        assert.deepEqual(deliveryCalls[0], {
            backtestRunId: null,
            indicatorInstanceId: 'inst-1',
            deliveries: [
                { contractKind: 'signal-event', limit: 1 },
                { contractKind: 'execution-event', limit: 1 },
            ],
        });
        assert.equal(traceCreateManyCalls.length, 1);
        assert.equal(traceCreateManyCalls[0].data[0]?.signalEventId, 'evt-1');
    });

    it('captures paper auto-execution intents after persisting live ENTRY events', async () => {
        const tradeIntentCalls: unknown[] = [];
        let candleQueryCalls = 0;
        const prisma = {
            signalEvent: {
                create: async (args: { data: Record<string, unknown> }) => ({
                    id: 'evt-1',
                    createdAt: new Date('2026-03-11T08:00:00.000Z'),
                    ...args.data,
                }),
            },
            signalLogicTrace: {
                createMany: async () => undefined,
            },
            indicatorInstance: {
                update: async () => undefined,
            },
            $transaction: async (operations: Array<Promise<unknown>>) => Promise.all(operations),
        } as never;
        const instances = {
            getInstance: async () => ({
                id: 'inst-1',
                status: 'ACTIVE',
                symbol: 'XAUUSD',
                timeframe: 'H1',
                signalCode: 'songTrap',
                signalVersion: 3,
                parameterJson: {},
                executionConfigJson: {},
                stateJson: null,
                errorMessage: null,
                startedAt: new Date('2026-03-11T07:00:00.000Z'),
                lastProcessedCandleTime: null,
            }),
        };
        const states = {
            saveCheckpoint: async () => undefined,
        };
        const registry = {
            get: () => ({
                initialize: async () => ({}),
                onBar: async () => ({
                    state: { step: 'updated' },
                    signal: {
                        symbol: 'XAUUSD',
                        timeframe: 'H1',
                        side: 'LONG',
                        entryTime: new Date('2026-03-11T08:00:00.000Z'),
                        entryPrice: 2000,
                        stopLoss: 1990,
                        takeProfit1: 2015,
                        externalKey: 'signal-1',
                    },
                    events: [{
                        signalExternalKey: 'signal-1',
                        eventType: 'ENTRY',
                        candleTime: new Date('2026-03-11T08:00:00.000Z'),
                        price: 2000,
                        label: 'ENTRY',
                        metaJson: null,
                    }],
                }),
            }),
        };
        const candleQuery = {
            getCandles: async () => {
                candleQueryCalls += 1;
                if (candleQueryCalls === 1) {
                    return [{
                        time: new Date('2026-03-11T08:00:00.000Z'),
                        open: 1995,
                        high: 2005,
                        low: 1990,
                        close: 2000,
                        volume: 10,
                    }];
                }

                return [];
            },
        };
        const indicatorSeries = {
            calculateSMAFromCandles() { return []; },
            calculateSMA() { return []; },
            calculateRSIFromCandles() { return []; },
            calculateRSI() { return []; },
            calculateEMAFromCandles() { return []; },
            calculateEMA() { return []; },
            calculateWMA() { return []; },
            getPointAtOrBefore() { return null; },
            alignPointsToBars() { return []; },
            calculateATR() { return []; },
            calculateADX() { return []; },
        };
        const executionModel = {
            resolveConfig() { return {}; },
            getEntryFill() { return null; },
            getExitFill() { return null; },
            resolvePositionSizing() { return null; },
            resolveStopLoss() { return null; },
            resolveTakeProfit() { return null; },
            calculateNetPnl() { return 0; },
            calculateNetR() { return 0; },
        };
        const redisPub = {
            publish: async () => 1,
        };

        const runner = new IndicatorLiveRunner(
            prisma,
            instances as never,
            states as never,
            registry as never,
            candleQuery as never,
            indicatorSeries as never,
            executionModel as never,
            redisPub as never,
            {
                deliverConfiguredOutputs: async () => [],
            },
            {
                captureAutoExecuteEntryIntents: async (args) => {
                    tradeIntentCalls.push(args);
                    return 1;
                },
            },
        );

        await runner.runTick('inst-1');

        assert.equal(tradeIntentCalls.length, 1);
        assert.deepEqual(tradeIntentCalls[0], {
            indicatorInstanceId: 'inst-1',
            runtimeSignal: {
                symbol: 'XAUUSD',
                timeframe: 'H1',
                side: 'LONG',
                entryTime: new Date('2026-03-11T08:00:00.000Z'),
                entryPrice: 2000,
                stopLoss: 1990,
                takeProfit1: 2015,
                externalKey: 'signal-1',
            },
            persistedEvents: [{
                draftEvent: {
                    signalExternalKey: 'signal-1',
                    eventType: 'ENTRY',
                    candleTime: new Date('2026-03-11T08:00:00.000Z'),
                    price: 2000,
                    label: 'ENTRY',
                    metaJson: null,
                },
                savedEvent: {
                    id: 'evt-1',
                    eventType: 'ENTRY',
                    candleTime: new Date('2026-03-11T08:00:00.000Z'),
                    price: 2000,
                    label: 'ENTRY',
                    metaJson: {
                        tp1: undefined,
                        tp2: undefined,
                        sl: undefined,
                        entryPrice: 2000,
                    },
                },
            }],
        });
    });

    it('captures external actionable events after persisting live ENTRY events', async () => {
        const externalActionCalls: unknown[] = [];
        let candleQueryCalls = 0;
        const prisma = {
            signalEvent: {
                create: async (args: { data: Record<string, unknown> }) => ({
                    id: 'evt-1',
                    createdAt: new Date('2026-03-11T08:00:00.000Z'),
                    ...args.data,
                }),
            },
            signalLogicTrace: {
                createMany: async () => undefined,
            },
            indicatorInstance: {
                update: async () => undefined,
            },
            $transaction: async (operations: Array<Promise<unknown>>) => Promise.all(operations),
        } as never;
        const instances = {
            getInstance: async () => ({
                id: 'inst-1',
                status: 'ACTIVE',
                symbol: 'XAUUSD',
                timeframe: 'H1',
                signalCode: 'songTrap',
                signalVersion: 3,
                parameterJson: {},
                executionConfigJson: {},
                stateJson: null,
                errorMessage: null,
                startedAt: new Date('2026-03-11T07:00:00.000Z'),
                lastProcessedCandleTime: null,
            }),
        };
        const states = {
            saveCheckpoint: async () => undefined,
        };
        const registry = {
            get: () => ({
                initialize: async () => ({}),
                onBar: async () => ({
                    state: { step: 'updated' },
                    signal: {
                        symbol: 'XAUUSD',
                        timeframe: 'H1',
                        side: 'LONG',
                        entryTime: new Date('2026-03-11T08:00:00.000Z'),
                        entryPrice: 2000,
                        stopLoss: 1990,
                        takeProfit1: 2015,
                        takeProfit2: 2025,
                        externalKey: 'signal-1',
                    },
                    events: [{
                        signalExternalKey: 'signal-1',
                        eventType: 'ENTRY',
                        candleTime: new Date('2026-03-11T08:00:00.000Z'),
                        price: 2000,
                        label: 'ENTRY',
                        metaJson: null,
                    }],
                }),
            }),
        };
        const candleQuery = {
            getCandles: async () => {
                candleQueryCalls += 1;
                if (candleQueryCalls === 1) {
                    return [{
                        time: new Date('2026-03-11T08:00:00.000Z'),
                        open: 1995,
                        high: 2005,
                        low: 1990,
                        close: 2000,
                        volume: 10,
                    }];
                }

                return [];
            },
        };
        const indicatorSeries = {
            calculateSMAFromCandles() { return []; },
            calculateSMA() { return []; },
            calculateRSIFromCandles() { return []; },
            calculateRSI() { return []; },
            calculateEMAFromCandles() { return []; },
            calculateEMA() { return []; },
            calculateWMA() { return []; },
            getPointAtOrBefore() { return null; },
            alignPointsToBars() { return []; },
            calculateATR() { return []; },
            calculateADX() { return []; },
        };
        const executionModel = {
            resolveConfig() { return {}; },
            getEntryFill() { return null; },
            getExitFill() { return null; },
            resolvePositionSizing() { return null; },
            resolveStopLoss() { return null; },
            resolveTakeProfit() { return null; },
            calculateNetPnl() { return 0; },
            calculateNetR() { return 0; },
        };
        const redisPub = {
            publish: async () => 1,
        };

        const runner = new IndicatorLiveRunner(
            prisma,
            instances as never,
            states as never,
            registry as never,
            candleQuery as never,
            indicatorSeries as never,
            executionModel as never,
            redisPub as never,
            {
                deliverConfiguredOutputs: async () => [],
            },
            null,
            {
                captureActionableEvents: async (args) => {
                    externalActionCalls.push(args);
                    return 1;
                },
            },
        );

        await runner.runTick('inst-1');

        assert.equal(externalActionCalls.length, 1);
        assert.equal((externalActionCalls[0] as { indicatorInstanceId: string }).indicatorInstanceId, 'inst-1');
        assert.equal((externalActionCalls[0] as { persistedEvents: Array<{ savedEvent: { id: string } }> }).persistedEvents[0].savedEvent.id, 'evt-1');
    });
});
