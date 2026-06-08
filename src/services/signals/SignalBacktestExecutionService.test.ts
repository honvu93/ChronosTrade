import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { SignalBacktestExecutionService } from './SignalBacktestExecutionService';

describe('SignalBacktestExecutionService', () => {
    it('auto-dispatches exported webhook outputs after a successful generated run', async () => {
        const deliveryCalls: unknown[] = [];
        const tx = {
            signalLogicTrace: { deleteMany: async () => undefined, createMany: async () => undefined },
            signalEvent: { deleteMany: async () => undefined, createMany: async () => undefined },
            backtestTradeResult: { deleteMany: async () => undefined, createMany: async () => undefined },
            signal: {
                deleteMany: async () => undefined,
                create: async () => ({ id: 'signal-1' }),
            },
            backtestRun: { update: async () => undefined },
        };
        const prisma = {
            backtestRun: {
                findFirst: async () => ({
                    id: 'run-1',
                    sourceType: 'GENERATED',
                    signalCode: 'songTrap',
                    signalVersion: 3,
                    startedAt: new Date('2026-03-01T00:00:00.000Z'),
                    finishedAt: new Date('2026-03-02T00:00:00.000Z'),
                    parametersJson: { lookback: 20 },
                    executionConfigJson: { orderTiming: 'CLOSE' },
                    symbol: 'XAUUSD',
                    timeframe: 'H1',
                    initialEquity: 10000,
                    riskPercent: 1,
                }),
                update: async () => undefined,
            },
            $transaction: async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx),
        } as never;

        const service = new SignalBacktestExecutionService(prisma, {
            deliverConfiguredOutputs: async (args) => {
                deliveryCalls.push(args);
                return [];
            },
        });

        (service as any).platform = {
            runPreview: async () => ({
                signals: [{
                    externalKey: 'sig-ext-1',
                    definitionCode: 'songTrap',
                    definitionVersion: 3,
                    symbol: 'XAUUSD',
                    timeframe: 'H1',
                    side: 'LONG',
                    session: 'LONDON',
                    entryTime: new Date('2026-03-01T08:00:00.000Z'),
                    entryPrice: 2000,
                    stopLoss: 1990,
                    takeProfit1: 2010,
                    takeProfit2: 2020,
                    invalidationPrice: null,
                    notes: 'Preview signal',
                }],
                events: [{
                    signalExternalKey: 'sig-ext-1',
                    eventType: 'ENTRY_CONFIRMED',
                    candleTime: new Date('2026-03-01T08:00:00.000Z'),
                    price: 2000,
                    label: 'Entry confirmed',
                    metaJson: null,
                }],
                traces: [{
                    signalExternalKey: 'sig-ext-1',
                    eventType: 'ENTRY_CONFIRMED',
                    candleTime: new Date('2026-03-01T08:00:00.000Z'),
                    stateBefore: 'WAITING',
                    stateAfter: 'ENTERED',
                    ruleId: 'rule-1',
                    indicatorJson: null,
                    thresholdJson: null,
                    priceJson: null,
                    notes: 'Trace',
                }],
                results: [{
                    signalExternalKey: 'sig-ext-1',
                    exitRuleCode: 'TP1',
                    resultSide: 'LONG',
                    session: 'LONDON',
                    win: true,
                    isOpen: false,
                    rMultiple: 1.2,
                    pnlUsd: 120,
                    maxDrawdownPct: -2.3,
                    exitReason: 'TAKE_PROFIT_1',
                    exitTime: new Date('2026-03-01T09:00:00.000Z'),
                    exitPrice: 2010,
                    notes: 'Result',
                }],
            }),
        };
        (service as any).annotationSerializer = {
            toCreateManyInput: () => ([{ signalId: 'signal-1' }]),
        };
        (service as any).traceSerializer = {
            toCreateManyInput: () => ([{ signalId: 'signal-1' }]),
        };
        (service as any).resolveStrategyIds = async () => new Map([['SONGTRAP', 'strategy-1']]);
        (service as any).resolveExitRuleIds = async () => new Map([['TP1', 'exit-rule-1']]);

        const result = await service.executeRun('run-1');

        assert.equal(result.status, 'COMPLETED');
        assert.equal(deliveryCalls.length, 1);
        assert.deepEqual(deliveryCalls[0], {
            backtestRunId: 'run-1',
            indicatorInstanceId: null,
            deliveries: [
                { contractKind: 'signal-event', limit: 1 },
                { contractKind: 'execution-event', limit: 1 },
                { contractKind: 'trade-outcome', limit: 1 },
            ],
        });
    });
});
