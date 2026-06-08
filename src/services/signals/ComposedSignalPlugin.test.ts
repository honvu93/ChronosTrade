import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { PositionSide } from '@prisma/client';
import { ComposedSignalPlugin } from './ComposedSignalPlugin';
import { createDefaultBlockRegistry } from './blocks/createDefaultBlockRegistry';
import { TechIndicatorRegistry } from './blocks/TechIndicatorRegistry';
import { TechIndicatorBlock, FieldSchema } from './blocks/TechIndicatorBlock';
import { ExecutionModelService } from './ExecutionModelService';
import { CandleBar } from './types';

const executionModel = new ExecutionModelService();

const makeBar = (
    time: string,
    open: number,
    high: number,
    low: number,
    close: number,
): CandleBar => ({
    time: new Date(time),
    symbol: 'XAUUSD',
    timeframe: '1h',
    exchange: 'MT5',
    open,
    high,
    low,
    close,
    volume: 1,
    quoteVolume: null,
    trades: null,
    takerBuyVolume: null,
    isClosed: true,
});

describe('ComposedSignalPlugin trailing exits', () => {
    it('moves the stop after 2R and exits with TRAILING_STOP on reversal', () => {
        const plugin = new ComposedSignalPlugin({
            matchMode: 'ALL',
            windowBars: 1,
            side: 'LONG',
            blocks: [],
            stopLoss: { type: 'FIXED_PERCENT', value: 0.01 },
            takeProfit: { type: 'R_MULTIPLE', value: 4 },
            exitManagement: { profileCode: 'BE_1R_TRAIL_2R_3R' },
        }, createDefaultBlockRegistry(), 'TEST_TRAIL', 1, 'TEST_TRAIL');

        const baseBars = [
            makeBar('2026-03-01T00:00:00.000Z', 100, 100, 99, 100),
            makeBar('2026-03-01T01:00:00.000Z', 100, 106, 100, 105),
            makeBar('2026-03-01T02:00:00.000Z', 105, 111, 104, 110),
            makeBar('2026-03-01T03:00:00.000Z', 110, 110.5, 104, 105),
        ];

        const finalized = plugin.finalize({
            symbol: 'XAUUSD',
            timeframe: '1h',
            baseBars,
            barsByTimeframe: { '1h': baseBars },
            parameters: {},
            initialEquity: 10_000,
            riskPercent: 2,
            executionConfig: executionModel.resolveConfig({
                orderTiming: 'SIGNAL_BAR_CLOSE',
                entryFeeBps: 0,
                exitFeeBps: 0,
                entrySlippageBps: 0,
                exitSlippageBps: 0,
                stopLoss: { mode: 'SIGNAL_PRICE' },
                takeProfit: { mode: 'SIGNAL_PRICE' },
                positionSizing: { mode: 'RISK_BASED' },
            }),
            services: {
                indicatorSeries: {} as never,
                executionModel: {
                    resolveConfig: executionModel.resolveConfig.bind(executionModel),
                    getEntryFill: executionModel.getEntryFill.bind(executionModel),
                    getExitFill: executionModel.getExitFill.bind(executionModel),
                    resolvePositionSizing: executionModel.resolvePositionSizing.bind(executionModel),
                    resolveStopLoss: executionModel.resolveStopLoss.bind(executionModel),
                    resolveTakeProfit: executionModel.resolveTakeProfit.bind(executionModel),
                    calculateNetPnl: executionModel.calculateNetPnl.bind(executionModel),
                    calculateNetR: executionModel.calculateNetR.bind(executionModel),
                },
            },
            finalState: {
                blockStates: {},
                conditionWindow: {},
                signalArea: null,
            },
            output: {
                barsProcessed: baseBars.length,
                signals: [{
                    symbol: 'XAUUSD',
                    timeframe: '1h',
                    side: PositionSide.LONG,
                    strategyCode: 'TEST_TRAIL',
                    entryTime: new Date('2026-03-01T00:00:00.000Z'),
                    entryPrice: 100,
                    stopLoss: 95,
                    takeProfit1: 120,
                    externalKey: 'trail-signal-1',
                    definitionCode: 'TEST_TRAIL',
                    definitionVersion: 1,
                    notes: 'test',
                }],
                events: [],
                traces: [],
                results: [],
            },
        });

        assert.ok(finalized);
        assert.equal(finalized?.results?.length, 1);
        assert.equal(finalized?.results?.[0]?.exitReason, 'TRAILING_STOP');
        assert.ok((finalized?.results?.[0]?.rMultiple ?? 0) > 0.9);
        assert.ok(finalized?.events?.some((event) => event.eventType === 'TRAIL_START'));
        assert.ok(finalized?.traces?.some((trace) => trace.ruleId === 'trailing_stop_hit'));

        // Decision log verification (Story 9.1)
        const decisionLog = finalized?.results?.[0]?.decisionLog;
        assert.ok(decisionLog, 'decisionLog must be present on trade result');
        assert.ok(decisionLog.length > 0, 'decisionLog must have entries');
    });

    it('still honors signal take profit when the exit profile also has trailing stages', () => {
        const plugin = new ComposedSignalPlugin({
            matchMode: 'ALL',
            windowBars: 1,
            side: 'LONG',
            blocks: [],
            stopLoss: { type: 'FIXED_PERCENT', value: 0.01 },
            takeProfit: { type: 'R_MULTIPLE', value: 4 },
            exitManagement: { profileCode: 'BE_1R_TRAIL_2R_3R' },
        }, createDefaultBlockRegistry(), 'TEST_TRAIL_SIGNAL_TP', 1, 'TEST_TRAIL_SIGNAL_TP');

        const baseBars = [
            makeBar('2026-03-01T00:00:00.000Z', 100, 100, 99, 100),
            makeBar('2026-03-01T01:00:00.000Z', 100, 108.5, 100, 107),
            makeBar('2026-03-01T02:00:00.000Z', 107, 107.5, 106, 106.5),
        ];
        const symbol = baseBars[0].symbol;

        const finalized = plugin.finalize({
            symbol,
            timeframe: '1h',
            baseBars,
            barsByTimeframe: { '1h': baseBars },
            parameters: {},
            initialEquity: 10_000,
            riskPercent: 2,
            executionConfig: executionModel.resolveConfig({
                orderTiming: 'SIGNAL_BAR_CLOSE',
                entryFeeBps: 0,
                exitFeeBps: 0,
                entrySlippageBps: 0,
                exitSlippageBps: 0,
                stopLoss: { mode: 'SIGNAL_PRICE' },
                takeProfit: { mode: 'SIGNAL_PRICE' },
                positionSizing: { mode: 'RISK_BASED' },
            }),
            services: {
                indicatorSeries: {} as never,
                executionModel: {
                    resolveConfig: executionModel.resolveConfig.bind(executionModel),
                    getEntryFill: executionModel.getEntryFill.bind(executionModel),
                    getExitFill: executionModel.getExitFill.bind(executionModel),
                    resolvePositionSizing: executionModel.resolvePositionSizing.bind(executionModel),
                    resolveStopLoss: executionModel.resolveStopLoss.bind(executionModel),
                    resolveTakeProfit: executionModel.resolveTakeProfit.bind(executionModel),
                    calculateNetPnl: executionModel.calculateNetPnl.bind(executionModel),
                    calculateNetR: executionModel.calculateNetR.bind(executionModel),
                },
            },
            finalState: {
                blockStates: {},
                conditionWindow: {},
                signalArea: null,
            },
            output: {
                barsProcessed: baseBars.length,
                signals: [{
                    symbol,
                    timeframe: '1h',
                    side: PositionSide.LONG,
                    strategyCode: 'TEST_TRAIL_SIGNAL_TP',
                    entryTime: new Date('2026-03-01T00:00:00.000Z'),
                    entryPrice: 100,
                    stopLoss: 95,
                    takeProfit1: 108,
                    externalKey: 'trail-signal-tp-1',
                    definitionCode: 'TEST_TRAIL_SIGNAL_TP',
                    definitionVersion: 1,
                    notes: 'test',
                }],
                events: [],
                traces: [],
                results: [],
            },
        });

        assert.ok(finalized);
        assert.equal(finalized?.results?.length, 1);
        assert.equal(finalized?.results?.[0]?.exitReason, 'TAKE_PROFIT_1');
        assert.equal(finalized?.results?.[0]?.exitPrice, 108);
        assert.ok(finalized?.events?.some((event) => event.eventType === 'TP1_HIT'));
        assert.ok(finalized?.events?.some((event) => event.eventType === 'MOVE_SL_BE'));
    });

    it('caps repeated entries inside the same signal area and resets after price dislocation', () => {
        const plugin = new ComposedSignalPlugin({
            matchMode: 'ALL',
            windowBars: 1,
            side: 'LONG',
            blocks: [],
            stopLoss: { type: 'FIXED_PERCENT', value: 0.01 },
            takeProfit: { type: 'R_MULTIPLE', value: 2 },
            entryManagement: {
                signalAreaGuard: {
                    maxSignalsPerArea: 3,
                    resetBars: 12,
                    priceDistanceR: 1,
                },
            },
            exitManagement: { profileCode: 'HARD_SIGNAL_TP' },
        }, createDefaultBlockRegistry(), 'TEST_AREA_CAP', 1, 'TEST_AREA_CAP');

        const baseBars = [
            makeBar('2026-03-01T00:00:00.000Z', 100, 100.4, 99.7, 100),
            makeBar('2026-03-01T01:00:00.000Z', 100, 100.5, 99.8, 100.2),
            makeBar('2026-03-01T02:00:00.000Z', 100.2, 100.3, 99.7, 99.9),
            makeBar('2026-03-01T03:00:00.000Z', 99.9, 100.4, 99.8, 100.1),
            makeBar('2026-03-01T04:00:00.000Z', 100.1, 100.3, 99.9, 100.05),
            makeBar('2026-03-01T05:00:00.000Z', 105.5, 106.4, 105.1, 106),
        ];

        const resolvedExecutionConfig = executionModel.resolveConfig({
            orderTiming: 'SIGNAL_BAR_CLOSE',
            entryFeeBps: 0,
            exitFeeBps: 0,
            entrySlippageBps: 0,
            exitSlippageBps: 0,
            stopLoss: { mode: 'SIGNAL_PRICE' },
            takeProfit: { mode: 'SIGNAL_PRICE' },
            positionSizing: { mode: 'RISK_BASED' },
        });

        let state = plugin.initialize({
            symbol: 'XAUUSD',
            timeframe: '1h',
            baseBars,
            barsByTimeframe: { '1h': baseBars },
            parameters: {},
            initialEquity: 10_000,
            riskPercent: 2,
            executionConfig: resolvedExecutionConfig,
            services: {
                indicatorSeries: {} as never,
                executionModel: {
                    resolveConfig: executionModel.resolveConfig.bind(executionModel),
                    getEntryFill: executionModel.getEntryFill.bind(executionModel),
                    getExitFill: executionModel.getExitFill.bind(executionModel),
                    resolvePositionSizing: executionModel.resolvePositionSizing.bind(executionModel),
                    resolveStopLoss: executionModel.resolveStopLoss.bind(executionModel),
                    resolveTakeProfit: executionModel.resolveTakeProfit.bind(executionModel),
                    calculateNetPnl: executionModel.calculateNetPnl.bind(executionModel),
                    calculateNetR: executionModel.calculateNetR.bind(executionModel),
                },
            },
        });

        const emittedSignals = [];
        for (let index = 0; index < baseBars.length; index += 1) {
            const step = plugin.onBar({
                symbol: 'XAUUSD',
                timeframe: '1h',
                baseBars,
                barsByTimeframe: { '1h': baseBars },
                parameters: {},
                initialEquity: 10_000,
                riskPercent: 2,
                executionConfig: resolvedExecutionConfig,
                services: {
                    indicatorSeries: {} as never,
                    executionModel: {
                        resolveConfig: executionModel.resolveConfig.bind(executionModel),
                        getEntryFill: executionModel.getEntryFill.bind(executionModel),
                        getExitFill: executionModel.getExitFill.bind(executionModel),
                        resolvePositionSizing: executionModel.resolvePositionSizing.bind(executionModel),
                        resolveStopLoss: executionModel.resolveStopLoss.bind(executionModel),
                        resolveTakeProfit: executionModel.resolveTakeProfit.bind(executionModel),
                        calculateNetPnl: executionModel.calculateNetPnl.bind(executionModel),
                        calculateNetR: executionModel.calculateNetR.bind(executionModel),
                    },
                },
                index,
                bar: baseBars[index],
                state,
            });

            assert.ok(step);
            state = step?.state ?? state;
            if (step?.signal) {
                emittedSignals.push(step.signal);
            }
        }

        assert.equal(emittedSignals.length, 4);
        assert.match(emittedSignals[0].notes ?? '', /area:1\/3/);
        assert.match(emittedSignals[2].notes ?? '', /area:3\/3/);
        assert.match(emittedSignals[3].notes ?? '', /area:1\/3/);
        assert.equal(state.signalArea?.emittedSignals, 1);
        assert.equal(state.signalArea?.startedAtIndex, 5);
    });

    it('emits a higher-timeframe match only once per source bar snapshot', () => {
        const registry = new TechIndicatorRegistry();
        registry.register({
            definition: {
                id: 'FAKE_HTF_EVENT',
                name: 'Fake HTF Event',
                category: 'utility',
                description: 'Triggers only on the second H1 bar.',
                paramSchema: [],
                conditions: [{ id: 'event', name: 'Event', description: 'Test event', paramSchema: [] }],
            },
            initialize: () => ({}),
            evaluate: (_bar, _prevBar, _allBars, sourceIndex, blockState) => ({
                state: blockState,
                isActive: sourceIndex === 1,
                values: { sourceIndex },
            }),
        });

        const plugin = new ComposedSignalPlugin({
            matchMode: 'ALL',
            windowBars: 1,
            side: 'LONG',
            blocks: [{
                id: 'htf_event',
                indicatorId: 'FAKE_HTF_EVENT',
                conditionId: 'event',
                indicatorParams: {},
                conditionParams: {},
                timeframe: 'H1',
            }],
            stopLoss: { type: 'FIXED_PERCENT', value: 0.01 },
            takeProfit: { type: 'R_MULTIPLE', value: 2 },
        }, registry, 'TEST_MTF_DEDUPE', 1, 'TEST_MTF_DEDUPE');

        const baseBars = Array.from({ length: 24 }, (_, index) => makeBar(
            `2026-03-01T${index < 12 ? '00' : '01'}:${String((index % 12) * 5).padStart(2, '0')}:00.000Z`,
            100 + index * 0.1,
            100.4 + index * 0.1,
            99.7 + index * 0.1,
            100 + index * 0.1,
        ));
        const h1Bars = [
            makeBar('2026-03-01T00:00:00.000Z', 100, 101, 99, 100),
            makeBar('2026-03-01T01:00:00.000Z', 100, 111, 99, 110),
        ];
        const resolvedExecutionConfig = executionModel.resolveConfig({
            orderTiming: 'SIGNAL_BAR_CLOSE',
            entryFeeBps: 0,
            exitFeeBps: 0,
            entrySlippageBps: 0,
            exitSlippageBps: 0,
            stopLoss: { mode: 'SIGNAL_PRICE' },
            takeProfit: { mode: 'SIGNAL_PRICE' },
            positionSizing: { mode: 'RISK_BASED' },
        });
        const services = {
            indicatorSeries: {} as never,
            executionModel: {
                resolveConfig: executionModel.resolveConfig.bind(executionModel),
                getEntryFill: executionModel.getEntryFill.bind(executionModel),
                getExitFill: executionModel.getExitFill.bind(executionModel),
                resolvePositionSizing: executionModel.resolvePositionSizing.bind(executionModel),
                resolveStopLoss: executionModel.resolveStopLoss.bind(executionModel),
                resolveTakeProfit: executionModel.resolveTakeProfit.bind(executionModel),
                calculateNetPnl: executionModel.calculateNetPnl.bind(executionModel),
                calculateNetR: executionModel.calculateNetR.bind(executionModel),
            },
        };

        let state = plugin.initialize({
            symbol: 'XAUUSD',
            timeframe: 'M5',
            baseBars,
            barsByTimeframe: { M5: baseBars, H1: h1Bars },
            parameters: {},
            initialEquity: 10_000,
            riskPercent: 2,
            executionConfig: resolvedExecutionConfig,
            services,
        });

        const emittedSignals = [];
        for (let index = 0; index < baseBars.length; index += 1) {
            const step = plugin.onBar({
                symbol: 'XAUUSD',
                timeframe: 'M5',
                baseBars,
                barsByTimeframe: { M5: baseBars, H1: h1Bars },
                parameters: {},
                initialEquity: 10_000,
                riskPercent: 2,
                executionConfig: resolvedExecutionConfig,
                services,
                index,
                bar: baseBars[index]!,
                state,
            });

            assert.ok(step);
            state = step?.state ?? state;

            if (step?.signal) {
                emittedSignals.push(step.signal);
            }
        }

        assert.equal(emittedSignals.length, 1);
        assert.equal(emittedSignals[0]?.entryTime.toISOString(), '2026-03-01T01:00:00.000Z');
    });

    it('includes multi-TF alignment data in block evaluation traces', () => {
        const registry = new TechIndicatorRegistry();
        registry.register({
            definition: {
                id: 'FAKE_HTF_ALIGN',
                name: 'Fake HTF Align',
                category: 'utility',
                description: 'Always active — used to verify alignment data in traces.',
                paramSchema: [],
                conditions: [{ id: 'always', name: 'Always', description: 'Always active', paramSchema: [] }],
            },
            initialize: () => ({}),
            evaluate: (_bar, _prevBar, _allBars, _sourceIndex, blockState) => ({
                state: blockState,
                isActive: true,
                values: { test: 1 },
            }),
        });

        const plugin = new ComposedSignalPlugin({
            matchMode: 'ALL',
            windowBars: 1,
            side: 'LONG',
            blocks: [{
                id: 'htf_block',
                indicatorId: 'FAKE_HTF_ALIGN',
                conditionId: 'always',
                indicatorParams: {},
                conditionParams: { myParam: 42 },
                timeframe: 'H1',
            }],
            stopLoss: { type: 'FIXED_PERCENT', value: 0.01 },
            takeProfit: { type: 'R_MULTIPLE', value: 2 },
        }, registry, 'TEST_ALIGN', 1, 'TEST_ALIGN');

        const baseBars = [
            makeBar('2026-03-01T00:05:00.000Z', 100, 101, 99, 100),
            makeBar('2026-03-01T00:10:00.000Z', 100, 101, 99, 100),
        ];
        const h1Bars = [
            makeBar('2026-03-01T00:00:00.000Z', 100, 101, 99, 100),
        ];

        let state = plugin.initialize({
            symbol: 'XAUUSD',
            timeframe: 'M5',
            baseBars,
            barsByTimeframe: { M5: baseBars, H1: h1Bars },
            parameters: {},
            initialEquity: 10_000,
            riskPercent: 2,
            executionConfig: executionModel.resolveConfig({
                orderTiming: 'SIGNAL_BAR_CLOSE',
                entryFeeBps: 0, exitFeeBps: 0, entrySlippageBps: 0, exitSlippageBps: 0,
                stopLoss: { mode: 'SIGNAL_PRICE' },
                takeProfit: { mode: 'SIGNAL_PRICE' },
                positionSizing: { mode: 'RISK_BASED' },
            }),
            services: {
                indicatorSeries: {} as never,
                executionModel: {
                    resolveConfig: executionModel.resolveConfig.bind(executionModel),
                    getEntryFill: executionModel.getEntryFill.bind(executionModel),
                    getExitFill: executionModel.getExitFill.bind(executionModel),
                    resolvePositionSizing: executionModel.resolvePositionSizing.bind(executionModel),
                    resolveStopLoss: executionModel.resolveStopLoss.bind(executionModel),
                    resolveTakeProfit: executionModel.resolveTakeProfit.bind(executionModel),
                    calculateNetPnl: executionModel.calculateNetPnl.bind(executionModel),
                    calculateNetR: executionModel.calculateNetR.bind(executionModel),
                },
            },
        });

        const step = plugin.onBar({
            symbol: 'XAUUSD',
            timeframe: 'M5',
            baseBars,
            barsByTimeframe: { M5: baseBars, H1: h1Bars },
            parameters: {},
            initialEquity: 10_000,
            riskPercent: 2,
            executionConfig: executionModel.resolveConfig({
                orderTiming: 'SIGNAL_BAR_CLOSE',
                entryFeeBps: 0, exitFeeBps: 0, entrySlippageBps: 0, exitSlippageBps: 0,
                stopLoss: { mode: 'SIGNAL_PRICE' },
                takeProfit: { mode: 'SIGNAL_PRICE' },
                positionSizing: { mode: 'RISK_BASED' },
            }),
            services: {
                indicatorSeries: {} as never,
                executionModel: {
                    resolveConfig: executionModel.resolveConfig.bind(executionModel),
                    getEntryFill: executionModel.getEntryFill.bind(executionModel),
                    getExitFill: executionModel.getExitFill.bind(executionModel),
                    resolvePositionSizing: executionModel.resolvePositionSizing.bind(executionModel),
                    resolveStopLoss: executionModel.resolveStopLoss.bind(executionModel),
                    resolveTakeProfit: executionModel.resolveTakeProfit.bind(executionModel),
                    calculateNetPnl: executionModel.calculateNetPnl.bind(executionModel),
                    calculateNetR: executionModel.calculateNetR.bind(executionModel),
                },
            },
            index: 0,
            bar: baseBars[0]!,
            state,
        });

        assert.ok(step);
        const trace = step?.traces?.find((t) => t.ruleId === 'htf_block:always');
        assert.ok(trace, 'trace for HTF block must exist');
        const threshold = trace!.thresholdJson as Record<string, unknown>;
        assert.ok(threshold.alignment, 'alignment data must be present for HTF block');
        const alignment = threshold.alignment as Record<string, unknown>;
        assert.equal(alignment.timeframe, 'H1');
        assert.equal(alignment.barTime, '2026-03-01T00:00:00.000Z');
        assert.equal(alignment.barIndex, 0);
        assert.equal(alignment.gapMs, 5 * 60 * 1000); // M5 bar at :05 - H1 bar at :00 = 5min
    });
});

describe('ComposedSignalPlugin block parameter overrides', () => {
    it('passes overridden indicator params to block initialize and evaluate', () => {
        // Create a spy block that records the params it receives
        const receivedInitParams: Record<string, unknown>[] = [];
        const receivedEvalParams: Record<string, unknown>[] = [];

        const spyBlock: TechIndicatorBlock = {
            definition: {
                id: 'SPY_BLOCK',
                name: 'Spy Block',
                category: 'momentum',
                description: 'Test spy',
                paramSchema: [
                    { id: 'period', type: 'number', label: 'Period', default: 14, min: 2, max: 100, step: 1 },
                ],
                conditions: [
                    { id: 'always', name: 'Always', description: 'Always active', paramSchema: [] },
                ],
            },
            initialize: (bars, indicatorParams) => {
                receivedInitParams.push({ ...indicatorParams });
                return {};
            },
            evaluate: (bar, prevBar, allBars, index, state, indicatorParams) => {
                receivedEvalParams.push({ ...indicatorParams });
                return { state: {}, isActive: true, values: {} };
            },
        };

        const registry = new TechIndicatorRegistry();
        registry.register(spyBlock);

        const plugin = new ComposedSignalPlugin({
            matchMode: 'ALL',
            windowBars: 1,
            side: 'LONG',
            blocks: [
                {
                    id: 'block-1',
                    indicatorId: 'SPY_BLOCK',
                    conditionId: 'always',
                    indicatorParams: { period: 14 },
                    conditionParams: {},
                },
            ],
            stopLoss: { type: 'FIXED_PERCENT', value: 0.01 },
            takeProfit: { type: 'R_MULTIPLE', value: 2 },
        }, registry, 'TEST_OVERRIDE', 1, 'Test Override');

        const bars = [
            makeBar('2026-03-01T00:00:00.000Z', 100, 101, 99, 100),
            makeBar('2026-03-01T01:00:00.000Z', 100, 102, 99, 101),
        ];

        const resolvedConfig = executionModel.resolveConfig({});

        // Run with blockParamOverrides
        const state = plugin.initialize({
            symbol: 'XAUUSD',
            timeframe: '1h',
            baseBars: bars,
            barsByTimeframe: { '1h': bars },
            parameters: {
                blockParamOverrides: {
                    'block-1': { period: 21 },
                },
            },
            initialEquity: 10_000,
            riskPercent: 1,
            executionConfig: resolvedConfig,
            services: {
                indicatorSeries: {} as never,
                executionModel: {
                    resolveConfig: executionModel.resolveConfig.bind(executionModel),
                    getEntryFill: executionModel.getEntryFill.bind(executionModel),
                    getExitFill: executionModel.getExitFill.bind(executionModel),
                    resolvePositionSizing: executionModel.resolvePositionSizing.bind(executionModel),
                    resolveStopLoss: executionModel.resolveStopLoss.bind(executionModel),
                    resolveTakeProfit: executionModel.resolveTakeProfit.bind(executionModel),
                    calculateNetPnl: executionModel.calculateNetPnl.bind(executionModel),
                    calculateNetR: executionModel.calculateNetR.bind(executionModel),
                },
            },
        });

        // Initialize should receive overridden period=21
        assert.equal(receivedInitParams.length, 1);
        assert.equal(receivedInitParams[0].period, 21);

        // Run onBar to verify evaluate also receives overrides
        plugin.onBar({
            symbol: 'XAUUSD',
            timeframe: '1h',
            baseBars: bars,
            barsByTimeframe: { '1h': bars },
            parameters: {
                blockParamOverrides: {
                    'block-1': { period: 21 },
                },
            },
            initialEquity: 10_000,
            riskPercent: 1,
            executionConfig: resolvedConfig,
            services: {
                indicatorSeries: {} as never,
                executionModel: {
                    resolveConfig: executionModel.resolveConfig.bind(executionModel),
                    getEntryFill: executionModel.getEntryFill.bind(executionModel),
                    getExitFill: executionModel.getExitFill.bind(executionModel),
                    resolvePositionSizing: executionModel.resolvePositionSizing.bind(executionModel),
                    resolveStopLoss: executionModel.resolveStopLoss.bind(executionModel),
                    resolveTakeProfit: executionModel.resolveTakeProfit.bind(executionModel),
                    calculateNetPnl: executionModel.calculateNetPnl.bind(executionModel),
                    calculateNetR: executionModel.calculateNetR.bind(executionModel),
                },
            },
            index: 1,
            bar: bars[1],
            state,
        });

        assert.equal(receivedEvalParams.length, 1);
        assert.equal(receivedEvalParams[0].period, 21);
    });

    it('uses original indicatorParams when no overrides are provided', () => {
        const receivedParams: Record<string, unknown>[] = [];

        const spyBlock: TechIndicatorBlock = {
            definition: {
                id: 'SPY_BLOCK2',
                name: 'Spy Block 2',
                category: 'momentum',
                description: 'Test spy 2',
                paramSchema: [],
                conditions: [
                    { id: 'always', name: 'Always', description: 'Always active', paramSchema: [] },
                ],
            },
            initialize: (bars, indicatorParams) => {
                receivedParams.push({ ...indicatorParams });
                return {};
            },
            evaluate: () => ({ state: {}, isActive: false, values: {} }),
        };

        const registry = new TechIndicatorRegistry();
        registry.register(spyBlock);

        const plugin = new ComposedSignalPlugin({
            matchMode: 'ALL',
            windowBars: 1,
            side: 'LONG',
            blocks: [
                {
                    id: 'block-1',
                    indicatorId: 'SPY_BLOCK2',
                    conditionId: 'always',
                    indicatorParams: { period: 14 },
                    conditionParams: {},
                },
            ],
            stopLoss: { type: 'FIXED_PERCENT', value: 0.01 },
            takeProfit: { type: 'R_MULTIPLE', value: 2 },
        }, registry, 'TEST_NO_OVERRIDE', 1, 'Test No Override');

        const bars = [makeBar('2026-03-01T00:00:00.000Z', 100, 101, 99, 100)];
        const resolvedConfig = executionModel.resolveConfig({});

        plugin.initialize({
            symbol: 'XAUUSD',
            timeframe: '1h',
            baseBars: bars,
            barsByTimeframe: { '1h': bars },
            parameters: {},
            initialEquity: 10_000,
            riskPercent: 1,
            executionConfig: resolvedConfig,
            services: {
                indicatorSeries: {} as never,
                executionModel: {
                    resolveConfig: executionModel.resolveConfig.bind(executionModel),
                    getEntryFill: executionModel.getEntryFill.bind(executionModel),
                    getExitFill: executionModel.getExitFill.bind(executionModel),
                    resolvePositionSizing: executionModel.resolvePositionSizing.bind(executionModel),
                    resolveStopLoss: executionModel.resolveStopLoss.bind(executionModel),
                    resolveTakeProfit: executionModel.resolveTakeProfit.bind(executionModel),
                    calculateNetPnl: executionModel.calculateNetPnl.bind(executionModel),
                    calculateNetR: executionModel.calculateNetR.bind(executionModel),
                },
            },
        });

        assert.equal(receivedParams.length, 1);
        assert.equal(receivedParams[0].period, 14);
    });
});
