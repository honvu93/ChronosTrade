import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { SignalEventType } from '@prisma/client';
import { SignalBacktestTradeReplayService } from './SignalBacktestTradeReplayService';
import { CandleBar } from './types';

const createCandles = ({
    start,
    count,
    timeframeMs,
    seed,
}: {
    start: string;
    count: number;
    timeframeMs: number;
    seed: number;
}): CandleBar[] => (
    Array.from({ length: count }, (_, index) => {
        const drift = seed + index * 0.8;
        const time = new Date(new Date(start).getTime() + index * timeframeMs);
        const open = drift;
        const close = drift + Math.sin(index / 3) * 1.2;
        const high = Math.max(open, close) + 1.5;
        const low = Math.min(open, close) - 1.5;

        return {
            time,
            symbol: 'XAUUSD',
            timeframe: timeframeMs === 15 * 60_000 ? '15m' : '4h',
            exchange: 'SIM',
            open,
            high,
            low,
            close,
            volume: 100 + index,
            quoteVolume: null,
            trades: null,
            takerBuyVolume: null,
            isClosed: true,
        };
    })
);

describe('SignalBacktestTradeReplayService', () => {
    it('assembles a replay payload with deterministic R ladders, partials, and HTF context', async () => {
        const candles15m = createCandles({
            start: '2026-03-04T00:00:00.000Z',
            count: 96,
            timeframeMs: 15 * 60_000,
            seed: 100,
        });
        const candles4h = createCandles({
            start: '2026-03-03T00:00:00.000Z',
            count: 16,
            timeframeMs: 4 * 60 * 60_000,
            seed: 103,
        });

        const prisma = {
            backtestTradeResult: {
                findFirst: async () => ({
                    backtestRunId: 'run-1',
                    signalId: 'signal-1',
                    exitRuleId: 'exit-1',
                    exitPrice: 112.5,
                    exitTime: new Date('2026-03-04T15:00:00.000Z'),
                    isOpen: false,
                    notes: 'RSI Exit | qty:0.02 | sl:95 | tp:110',
                    rMultiple: 2.5,
                    signal: {
                        id: 'signal-1',
                        symbol: 'XAUUSD',
                        timeframe: '15m',
                        side: 'LONG',
                        session: 'LONDON',
                        entryTime: new Date('2026-03-04T06:00:00.000Z'),
                        entryPrice: 100,
                        stopLoss: 95,
                        executionConfigJson: null,
                        strategy: {
                            code: 'songTrap',
                            name: 'Song Trap',
                        },
                    },
                    exitRule: {
                        code: 'RSI_EXIT',
                        name: 'RSI Exit',
                    },
                    backtestRun: {
                        id: 'run-1',
                        name: 'Replay Run',
                        signalCode: 'songTrap',
                        signalVersion: 3,
                        parametersJson: {
                            trendTf: '4h',
                        },
                        executionConfigJson: {
                            positionSizing: {
                                mode: 'FIXED_QUANTITY',
                                value: 0.25,
                            },
                        },
                    },
                }),
            },
            signalEvent: {
                findMany: async () => ([
                    {
                        id: 'event-entry',
                        eventType: SignalEventType.ENTRY,
                        candleTime: new Date('2026-03-04T06:00:00.000Z'),
                        price: 100,
                        label: 'ENTRY',
                        metaJson: null,
                        createdAt: new Date('2026-03-04T06:00:01.000Z'),
                    },
                    {
                        id: 'event-tp1',
                        eventType: SignalEventType.TP1_HIT,
                        candleTime: new Date('2026-03-04T09:00:00.000Z'),
                        price: 110,
                        label: 'TP1',
                        metaJson: {
                            closeFraction: 0.25,
                        },
                        createdAt: new Date('2026-03-04T09:00:01.000Z'),
                    },
                    {
                        id: 'event-trail',
                        eventType: SignalEventType.TRAIL_UPDATE,
                        candleTime: new Date('2026-03-04T11:00:00.000Z'),
                        price: null,
                        label: 'Trail',
                        metaJson: {
                            stopPrice: 101,
                        },
                        createdAt: new Date('2026-03-04T11:00:01.000Z'),
                    },
                ]),
            },
            signalLogicTrace: {
                findMany: async () => ([
                    {
                        id: 'trace-tp1',
                        eventType: SignalEventType.TP1_HIT,
                        candleTime: new Date('2026-03-04T09:00:00.000Z'),
                        ruleId: 'tp1',
                        notes: 'Partial realized',
                        indicatorJson: null,
                        thresholdJson: null,
                        priceJson: {
                            targetPrice: 110,
                            closeFraction: 0.25,
                        },
                        createdAt: new Date('2026-03-04T09:00:02.000Z'),
                    },
                    {
                        id: 'trace-trail',
                        eventType: SignalEventType.TRAIL_UPDATE,
                        candleTime: new Date('2026-03-04T13:00:00.000Z'),
                        ruleId: 'trail',
                        notes: 'Trail advanced',
                        indicatorJson: {
                            trendTf: '4h',
                        },
                        thresholdJson: null,
                        priceJson: {
                            stopPrice: 104,
                        },
                        createdAt: new Date('2026-03-04T13:00:01.000Z'),
                    },
                ]),
            },
        } as never;

        const candleRequests: Array<{ timeframe: string; from: Date; to: Date }> = [];
        const candleQuery = {
            getCandles: async ({ timeframe, from, to }: { timeframe: string; from: Date; to: Date }) => {
                candleRequests.push({ timeframe, from, to });
                return timeframe === '4h' ? candles4h : candles15m;
            },
        };

        const service = new SignalBacktestTradeReplayService(prisma, candleQuery as never);
        const replay = await service.getTradeReplay('run-1', 'signal-1:exit-1');

        assert.equal(replay.summary.totalR, 2.5);
        assert.equal(replay.summary.partialR, 0.5);
        assert.equal(replay.summary.remainingR, 2);
        assert.equal(replay.summary.signalCode, 'songTrap');
        assert.equal(replay.summary.signalVersion, 3);
        assert.equal(replay.summary.strategyCode, 'songTrap');
        assert.equal(replay.summary.configuredSize, 0.25);
        assert.equal(replay.summary.quality, null);
        assert.equal(replay.summary.riskDistance, 5);
        assert.ok((replay.summary.barsHeld ?? 0) > 0);
        assert.equal(replay.window.paddingBars, 12);

        const r1 = replay.pricePane.levels.find((level) => level.id === 'r-1');
        const r2 = replay.pricePane.levels.find((level) => level.id === 'r-2');
        assert.equal(r1?.price, 105);
        assert.equal(r2?.price, 110);

        assert.equal(replay.structurePane.available, true);
        assert.equal(replay.structurePane.timeframe, '4h');
        assert.match(replay.structurePane.title, /4H/i);
        assert.deepEqual(
            replay.pricePane.trailLine.map((point) => point.value),
            [101, 104],
        );
        assert.ok(replay.timeline.some((item) => item.eventType === SignalEventType.TP1_HIT));

        const baseRequest = candleRequests.find((request) => request.timeframe === '15m');
        const structureRequest = candleRequests.find((request) => request.timeframe === '4h');
        assert.ok(baseRequest);
        assert.ok(structureRequest);
        assert.ok(structureRequest!.from.getTime() < baseRequest!.from.getTime());
        assert.ok(structureRequest!.to.getTime() > baseRequest!.to.getTime());
    });

    it('returns neutral unavailable fields when partials, HTF context, and exact size cannot be proven', async () => {
        const candles15m = createCandles({
            start: '2026-03-05T00:00:00.000Z',
            count: 72,
            timeframeMs: 15 * 60_000,
            seed: 210,
        });

        const prisma = {
            backtestTradeResult: {
                findFirst: async () => ({
                    backtestRunId: 'run-2',
                    signalId: 'signal-2',
                    exitRuleId: 'exit-stop',
                    exitPrice: 205,
                    exitTime: new Date('2026-03-05T09:00:00.000Z'),
                    isOpen: false,
                    notes: 'Stop Loss',
                    rMultiple: -1,
                    signal: {
                        id: 'signal-2',
                        symbol: 'XAUUSD',
                        timeframe: '15m',
                        side: 'SHORT',
                        session: 'NY',
                        entryTime: new Date('2026-03-05T04:00:00.000Z'),
                        entryPrice: 200,
                        stopLoss: 205,
                        executionConfigJson: {
                            positionSizing: {
                                mode: 'RISK_BASED',
                                value: null,
                            },
                        },
                        strategy: {
                            code: 'songTrap',
                            name: 'Song Trap',
                        },
                    },
                    exitRule: {
                        code: 'STOP',
                        name: 'Stop Loss',
                    },
                    backtestRun: {
                        id: 'run-2',
                        name: 'No HTF Run',
                        signalCode: 'songTrap',
                        signalVersion: 3,
                        parametersJson: {},
                        executionConfigJson: {
                            positionSizing: {
                                mode: 'RISK_BASED',
                                value: null,
                            },
                        },
                    },
                }),
            },
            signalEvent: {
                findMany: async () => ([]),
            },
            signalLogicTrace: {
                findMany: async () => ([]),
            },
        } as never;

        const candleQuery = {
            getCandles: async () => candles15m,
        };

        const service = new SignalBacktestTradeReplayService(prisma, candleQuery as never);
        const replay = await service.getTradeReplay('run-2', 'signal-2:exit-stop');

        assert.equal(replay.summary.partialR, null);
        assert.equal(replay.summary.remainingR, null);
        assert.equal(replay.summary.configuredSize, null);
        assert.equal(replay.summary.quality, null);
        assert.equal(replay.structurePane.available, false);
        assert.match(replay.structurePane.reason ?? '', /higher-timeframe context/i);

        const r1 = replay.pricePane.levels.find((level) => level.id === 'r-1');
        const r3 = replay.pricePane.levels.find((level) => level.id === 'r-3');
        assert.equal(r1?.price, 195);
        assert.equal(r3?.price, 185);
    });
});
