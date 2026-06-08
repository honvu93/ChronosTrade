import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { PositionSide, SignalEventType } from '@prisma/client';
import { ComposedSignalPlugin } from './ComposedSignalPlugin';
import { createDefaultBlockRegistry } from './blocks/createDefaultBlockRegistry';
import { ExecutionModelService } from './ExecutionModelService';
import { CandleBar, RuntimeSignalDraft } from './types';

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
    exchange: 'TEST',
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

const finalizeExitProfile = (profileCode: 'PARTIAL_1R_BE_SWING_TRAIL' | 'XAU_NY_CLOSE', baseBars: CandleBar[]) => {
    const plugin = new ComposedSignalPlugin({
        matchMode: 'ALL',
        windowBars: 1,
        side: 'LONG',
        blocks: [],
        stopLoss: { type: 'FIXED_PERCENT', value: 0.01 },
        takeProfit: { type: 'R_MULTIPLE', value: 4 },
        exitManagement: { profileCode },
    }, createDefaultBlockRegistry(), `TEST_${profileCode}`, 1, `TEST_${profileCode}`);

    return plugin.finalize({
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
                strategyCode: `TEST_${profileCode}`,
                entryTime: new Date('2026-03-01T00:00:00.000Z'),
                entryPrice: 100,
                stopLoss: 95,
                takeProfit1: 120,
                externalKey: `signal-${profileCode}`,
                definitionCode: `TEST_${profileCode}`,
                definitionVersion: 1,
                notes: 'test',
            }],
            events: [],
            traces: [],
            results: [],
        },
    });
};

const finalizeWithSignals = (input: {
    baseBars: CandleBar[];
    signals: Array<{
        externalKey: string;
        entryTime: string;
        entryPrice: number;
        stopLoss: number;
        takeProfit1: number;
    }>;
    riskPercent?: number;
    tradeGuards?: {
        lossStreakThrottle?: {
            steps?: Array<{
                afterLosses: number;
                riskPercent: number;
            }>;
        };
        lossStreakCooldown?: {
            afterLosses?: number;
            cooldownMinutes?: number;
        };
        sessionLossCap?: {
            maxLosses?: number;
            maxNetR?: number;
        };
        dayLossCap?: {
            maxLosses?: number;
            maxNetR?: number;
        };
    };
}) => {
    const plugin = new ComposedSignalPlugin({
        matchMode: 'ALL',
        windowBars: 1,
        side: 'LONG',
        blocks: [],
        stopLoss: { type: 'FIXED_PERCENT', value: 0.01 },
        takeProfit: { type: 'R_MULTIPLE', value: 2 },
        exitManagement: { profileCode: 'HARD_SIGNAL_TP' },
    }, createDefaultBlockRegistry(), 'TEST_GUARDS', 1, 'TEST_GUARDS');

    const output: {
        barsProcessed: number;
        signals: RuntimeSignalDraft[];
        events: any[];
        traces: any[];
        results: any[];
    } = {
        barsProcessed: input.baseBars.length,
        signals: input.signals.map((signal) => ({
            symbol: 'XAUUSD',
            timeframe: '1h',
            side: PositionSide.LONG,
            strategyCode: 'TEST_GUARDS',
            entryTime: new Date(signal.entryTime),
            entryPrice: signal.entryPrice,
            stopLoss: signal.stopLoss,
            takeProfit1: signal.takeProfit1,
            externalKey: signal.externalKey,
            definitionCode: 'TEST_GUARDS',
            definitionVersion: 1,
            notes: 'test',
            executionConfigJson: null,
        })),
        events: [] as any[],
        traces: [] as any[],
        results: [] as any[],
    };

    const finalized = plugin.finalize({
        symbol: 'XAUUSD',
        timeframe: '1h',
        baseBars: input.baseBars,
        barsByTimeframe: { '1h': input.baseBars },
        parameters: {},
        initialEquity: 10_000,
        riskPercent: input.riskPercent ?? 1,
        executionConfig: executionModel.resolveConfig({
            orderTiming: 'SIGNAL_BAR_CLOSE',
            entryFeeBps: 0,
            exitFeeBps: 0,
            entrySlippageBps: 0,
            exitSlippageBps: 0,
            stopLoss: { mode: 'SIGNAL_PRICE' },
            takeProfit: { mode: 'SIGNAL_PRICE' },
            positionSizing: { mode: 'RISK_BASED' },
            tradeGuards: input.tradeGuards,
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
        output,
    });

    return {
        output,
        finalized,
    };
};

describe('ComposedSignalPlugin exit management', () => {
    it('does not arm swing trailing before 1R is reached', () => {
        const finalized = finalizeExitProfile('PARTIAL_1R_BE_SWING_TRAIL', [
            makeBar('2026-03-01T00:00:00.000Z', 100, 101, 99, 100),
            makeBar('2026-03-01T01:00:00.000Z', 100, 103, 99.5, 102),
            makeBar('2026-03-01T02:00:00.000Z', 102, 103, 94, 95),
        ]);

        assert.ok(finalized);
        assert.ok(finalized.results);
        assert.ok(finalized.events);
        assert.ok(finalized.traces);

        assert.equal(finalized.results[0]?.exitReason, 'STOP_LOSS');
        assert.equal(finalized.results[0]?.exitPrice, 95);
        assert.equal(finalized.events.some((event) => event.label === 'SWING TRAIL'), false);
        assert.equal(finalized.traces.some((trace) => trace.ruleId?.startsWith('swing_trailing_stop_')), false);
    });

    it('classifies and traces swing trailing exits after break-even is armed', () => {
        const baseBars = [
            makeBar('2026-03-01T00:00:00.000Z', 100, 101, 99, 100),
            makeBar('2026-03-01T01:00:00.000Z', 100, 106, 101, 105),
            makeBar('2026-03-01T02:00:00.000Z', 105, 106.5, 101, 105.5),
            makeBar('2026-03-01T03:00:00.000Z', 105.5, 106.5, 101, 105.5),
            makeBar('2026-03-01T04:00:00.000Z', 105.5, 106.5, 101, 105.5),
            makeBar('2026-03-01T05:00:00.000Z', 105.5, 106.5, 101, 105.5),
            makeBar('2026-03-01T06:00:00.000Z', 105.5, 106.5, 101, 105.5),
            makeBar('2026-03-01T07:00:00.000Z', 105.5, 106.5, 101, 105.5),
            makeBar('2026-03-01T08:00:00.000Z', 105.5, 106.5, 101, 105.5),
            makeBar('2026-03-01T09:00:00.000Z', 105.5, 106.5, 101, 105.5),
            makeBar('2026-03-01T10:00:00.000Z', 105.5, 106.5, 101, 105.5),
            makeBar('2026-03-01T11:00:00.000Z', 105.5, 106.5, 101, 105.5),
            makeBar('2026-03-01T12:00:00.000Z', 105.5, 106.5, 101, 105.5),
            makeBar('2026-03-01T13:00:00.000Z', 105.5, 106.5, 101, 105.5),
            makeBar('2026-03-01T14:00:00.000Z', 105.5, 106, 100.5, 101),
        ];
        const finalized = finalizeExitProfile('PARTIAL_1R_BE_SWING_TRAIL', baseBars);

        assert.ok(finalized);
        assert.ok(finalized.results);
        assert.ok(finalized.events);
        assert.ok(finalized.traces);

        assert.equal(finalized.results[0]?.exitReason, 'TRAILING_STOP');
        assert.equal(finalized.events.some((event) => event.label === 'SWING TRAIL'), true);
        assert.equal(finalized.traces.some((trace) => trace.ruleId === 'swing_trailing_stop_12'), true);
        assert.equal(finalized.traces.some((trace) => trace.ruleId === 'trailing_stop_hit'), true);
        assert.equal(finalized.results[0]?.exitRuleConfigJson?.['trailByStructureLookback'], 12);
    });

    it('persists profile-specific metadata for NY close exits', () => {
        const finalized = finalizeExitProfile('XAU_NY_CLOSE', [
            makeBar('2026-03-01T00:00:00.000Z', 100, 101, 99, 100),
            makeBar('2026-03-01T21:00:00.000Z', 100, 101, 99.5, 100.2),
        ]);

        assert.ok(finalized);
        assert.ok(finalized.results);
        assert.ok(finalized.events);

        assert.equal(finalized.events.some((event) => event.eventType === SignalEventType.EXPIRATION), true);
        assert.equal(finalized.results[0]?.exitRuleConfigJson?.['exitAtNyClose'], true);
    });

    it('throttles risk after a losing streak without counting break-even as a loss', () => {
        const { finalized, output } = finalizeWithSignals({
            riskPercent: 1,
            tradeGuards: {
                lossStreakThrottle: {
                    steps: [
                        { afterLosses: 2, riskPercent: 0.5 },
                    ],
                },
            },
            baseBars: [
                makeBar('2026-03-01T08:00:00.000Z', 100, 101, 99, 100),
                makeBar('2026-03-01T09:00:00.000Z', 100, 101, 94, 95),
                makeBar('2026-03-01T10:00:00.000Z', 100, 101, 99, 100),
                makeBar('2026-03-01T11:00:00.000Z', 100, 101, 94, 95),
                makeBar('2026-03-01T12:00:00.000Z', 100, 101, 99, 100),
                makeBar('2026-03-01T13:00:00.000Z', 100, 111, 99, 110),
            ],
            signals: [
                { externalKey: 'loss-1', entryTime: '2026-03-01T08:00:00.000Z', entryPrice: 100, stopLoss: 95, takeProfit1: 110 },
                { externalKey: 'loss-2', entryTime: '2026-03-01T10:00:00.000Z', entryPrice: 100, stopLoss: 95, takeProfit1: 110 },
                { externalKey: 'win-3', entryTime: '2026-03-01T12:00:00.000Z', entryPrice: 100, stopLoss: 95, takeProfit1: 110 },
            ],
        });

        assert.ok(finalized);
        assert.equal(finalized.results?.length, 3);
        assert.equal(output.signals[2]?.executionConfigJson?.['resolvedRiskPercent'], 0.5);
        assert.equal(finalized.events?.some((event) => event.label === 'RISK 0.5%'), true);
        assert.match(String(finalized.results?.[2]?.notes), /risk:0.5%/);
    });

    it('blocks new entries after hitting the session loss cap', () => {
        const { finalized, output } = finalizeWithSignals({
            riskPercent: 1,
            tradeGuards: {
                sessionLossCap: {
                    maxLosses: 2,
                },
            },
            baseBars: [
                makeBar('2026-03-01T08:00:00.000Z', 100, 101, 99, 100),
                makeBar('2026-03-01T09:00:00.000Z', 100, 101, 94, 95),
                makeBar('2026-03-01T10:00:00.000Z', 100, 101, 99, 100),
                makeBar('2026-03-01T11:00:00.000Z', 100, 101, 94, 95),
                makeBar('2026-03-01T12:00:00.000Z', 100, 111, 99, 110),
            ],
            signals: [
                { externalKey: 'loss-1', entryTime: '2026-03-01T08:00:00.000Z', entryPrice: 100, stopLoss: 95, takeProfit1: 110 },
                { externalKey: 'loss-2', entryTime: '2026-03-01T10:00:00.000Z', entryPrice: 100, stopLoss: 95, takeProfit1: 110 },
                { externalKey: 'blocked-3', entryTime: '2026-03-01T12:00:00.000Z', entryPrice: 100, stopLoss: 95, takeProfit1: 110 },
            ],
        });

        assert.ok(finalized);
        assert.equal(finalized.results?.length, 2);
        assert.equal(finalized.events?.some((event) => event.eventType === SignalEventType.FAIL && event.label === 'RISK BLOCK'), true);
        assert.equal(finalized.traces?.some((trace) => trace.ruleId === 'entry_blocked_by_trade_guard'), true);
        const blockedReasons = ((output.signals[2]?.executionConfigJson as any)?.tradeGuards?.blockedReasons ?? null);
        assert.equal(Array.isArray(blockedReasons), true);
        assert.match(String(output.signals[2]?.notes), /blocked:session_max_losses/);
    });

    it('blocks later entries on the same day after hitting the day net-R cap', () => {
        const { finalized, output } = finalizeWithSignals({
            riskPercent: 1,
            tradeGuards: {
                dayLossCap: {
                    maxNetR: 2,
                },
            },
            baseBars: [
                makeBar('2026-03-01T08:00:00.000Z', 100, 101, 99, 100),
                makeBar('2026-03-01T09:00:00.000Z', 100, 101, 94, 95),
                makeBar('2026-03-01T10:00:00.000Z', 100, 101, 99, 100),
                makeBar('2026-03-01T11:00:00.000Z', 100, 101, 94, 95),
                makeBar('2026-03-01T14:00:00.000Z', 100, 111, 99, 110),
            ],
            signals: [
                { externalKey: 'loss-1', entryTime: '2026-03-01T08:00:00.000Z', entryPrice: 100, stopLoss: 95, takeProfit1: 110 },
                { externalKey: 'loss-2', entryTime: '2026-03-01T10:00:00.000Z', entryPrice: 100, stopLoss: 95, takeProfit1: 110 },
                { externalKey: 'blocked-ny', entryTime: '2026-03-01T14:00:00.000Z', entryPrice: 100, stopLoss: 95, takeProfit1: 110 },
            ],
        });

        assert.ok(finalized);
        assert.equal(finalized.results?.length, 2);
        assert.match(String(output.signals[2]?.notes), /blocked:day_max_net_r/);
    });

    it('blocks entries during a post-streak cooldown and resets the streak after the cooldown expires', () => {
        const { finalized, output } = finalizeWithSignals({
            riskPercent: 1,
            tradeGuards: {
                lossStreakCooldown: {
                    afterLosses: 2,
                    cooldownMinutes: 180,
                },
            },
            baseBars: [
                makeBar('2026-03-01T08:00:00.000Z', 100, 101, 99, 100),
                makeBar('2026-03-01T09:00:00.000Z', 100, 101, 94, 95),
                makeBar('2026-03-01T10:00:00.000Z', 100, 101, 99, 100),
                makeBar('2026-03-01T11:00:00.000Z', 100, 101, 94, 95),
                makeBar('2026-03-01T12:00:00.000Z', 100, 101, 99, 100),
                makeBar('2026-03-01T13:00:00.000Z', 100, 101, 99, 100),
                makeBar('2026-03-01T15:00:00.000Z', 100, 101, 99, 100),
                makeBar('2026-03-01T16:00:00.000Z', 100, 111, 99, 110),
            ],
            signals: [
                { externalKey: 'loss-1', entryTime: '2026-03-01T08:00:00.000Z', entryPrice: 100, stopLoss: 95, takeProfit1: 110 },
                { externalKey: 'loss-2', entryTime: '2026-03-01T10:00:00.000Z', entryPrice: 100, stopLoss: 95, takeProfit1: 110 },
                { externalKey: 'blocked-3', entryTime: '2026-03-01T12:00:00.000Z', entryPrice: 100, stopLoss: 95, takeProfit1: 110 },
                { externalKey: 'win-4', entryTime: '2026-03-01T15:00:00.000Z', entryPrice: 100, stopLoss: 95, takeProfit1: 110 },
            ],
        });

        assert.ok(finalized);
        assert.equal(finalized.results?.length, 3);
        assert.match(String(output.signals[2]?.notes), /blocked:loss_streak_cooldown/);
        assert.equal(finalized.traces?.some((trace) => trace.ruleId === 'entry_blocked_by_trade_guard'), true);
        assert.equal((output.signals[3]?.executionConfigJson as any)?.tradeGuards?.consecutiveLosses, 0);
        assert.equal((output.signals[3]?.executionConfigJson as any)?.tradeGuards?.rawConsecutiveLosses, 2);
        assert.equal((output.signals[3]?.executionConfigJson as any)?.resolvedRiskPercent, 1);
    });
});
