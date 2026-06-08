import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { TradingExportService } from './TradingExportService';
import { TradingOutputContractService } from './TradingOutputContractService';

function makeMockPrisma(overrides: {
    signalEvents?: unknown[];
    signalLogicTraces?: unknown[];
    backtestTradeResults?: unknown[];
    investigationOutcomes?: unknown[];
    indicatorInstances?: Record<string, { sourceBacktestRunId: string | null } | null>;
} = {}) {
    const filterByWhere = <T extends Record<string, unknown>>(
        items: T[],
        where: Record<string, unknown> | undefined,
    ) => {
        if (!where) {
            return items;
        }

        return items.filter((item) => Object.entries(where).every(([key, value]) => item[key] === value));
    };

    return {
        signalEvent: {
            findMany: async (args?: { where?: Record<string, unknown> }) =>
                filterByWhere((overrides.signalEvents ?? []) as Record<string, unknown>[], args?.where),
        },
        signalLogicTrace: {
            findMany: async (args?: { where?: Record<string, unknown> }) =>
                filterByWhere((overrides.signalLogicTraces ?? []) as Record<string, unknown>[], args?.where),
        },
        backtestTradeResult: {
            findMany: async (args?: { where?: Record<string, unknown> }) =>
                filterByWhere((overrides.backtestTradeResults ?? []) as Record<string, unknown>[], args?.where),
        },
        tradingInvestigationOutcomeRecord: {
            findMany: async (args?: { where?: Record<string, unknown> }) =>
                filterByWhere((overrides.investigationOutcomes ?? []) as Record<string, unknown>[], args?.where),
        },
        indicatorInstance: {
            findUnique: async (args: { where: { id: string } }) =>
                overrides.indicatorInstances?.[args.where.id] ?? null,
        },
    } as never;
}

function makeSignalEvent(id: string, opts: Partial<{
    backtestRunId: string | null;
    indicatorInstanceId: string | null;
    definitionCode: string;
    definitionVersion: number;
    candleTime: string;
    signal: Record<string, unknown> | null;
    indicatorInstance: Record<string, unknown> | null;
}> = {}) {
    return {
        id,
        eventType: 'ENTRY_CONFIRMED',
        candleTime: new Date(opts.candleTime ?? '2026-03-11T08:00:00Z'),
        createdAt: new Date(opts.candleTime ?? '2026-03-11T08:00:00Z'),
        backtestRunId: opts.backtestRunId ?? 'run-1',
        indicatorInstanceId: opts.indicatorInstanceId ?? null,
        signal: opts.signal === undefined ? {
            id: 'sig-1',
            definitionCode: opts.definitionCode ?? 'songTrap',
            definitionVersion: opts.definitionVersion ?? 3,
            symbol: 'XAUUSD',
            timeframe: 'H1',
            side: 'LONG',
            session: 'LONDON',
        } : opts.signal,
        indicatorInstance: opts.indicatorInstance ?? null,
    };
}

function makeLogicTrace(id: string, opts: Partial<{
    eventType: string;
    candleTime: string;
    backtestRunId: string | null;
    indicatorInstanceId: string | null;
    signal: Record<string, unknown> | null;
    indicatorInstance: Record<string, unknown> | null;
}> = {}) {
    return {
        id,
        eventType: opts.eventType ?? 'ENTRY_CONFIRMED',
        candleTime: new Date(opts.candleTime ?? '2026-03-11T08:00:00Z'),
        createdAt: new Date(opts.candleTime ?? '2026-03-11T08:00:00Z'),
        notes: 'Rule matched',
        stateBefore: 'WAITING',
        stateAfter: 'ENTERED',
        backtestRunId: opts.backtestRunId ?? 'run-1',
        indicatorInstanceId: opts.indicatorInstanceId ?? null,
        signal: opts.signal === undefined ? {
            definitionCode: 'songTrap',
            definitionVersion: 3,
        } : opts.signal,
        indicatorInstance: opts.indicatorInstance ?? null,
    };
}

function makeTradeResult(
    id: string,
    opts: Partial<{
        backtestRunId: string;
        win: boolean;
        isOpen: boolean;
        pnlUsd: number;
        exitTime: string | null;
        createdAt: string;
    }> = {},
) {
    return {
        id,
        backtestRunId: opts.backtestRunId ?? 'run-1',
        resultSide: 'LONG',
        win: opts.win ?? true,
        isOpen: opts.isOpen ?? false,
        rMultiple: { toString: () => '1.4' },
        pnlUsd: { toString: () => String(opts.pnlUsd ?? 320) },
        exitReason: 'TAKE_PROFIT_1',
        exitTime: opts.exitTime === null ? null : new Date(opts.exitTime ?? '2026-03-11T09:00:00Z'),
        createdAt: new Date(opts.createdAt ?? '2026-03-11T09:00:00Z'),
        signal: {
            definitionCode: 'songTrap',
            definitionVersion: 3,
            symbol: 'XAUUSD',
            timeframe: 'H1',
            side: 'LONG',
            entryTime: new Date('2026-03-11T08:00:00Z'),
        },
        exitRule: { code: 'TP1' },
    };
}

function makeInvestigationOutcome(id: string, opts: Partial<{
    backtestRunId: string | null;
    indicatorInstanceId: string | null;
    createdAt: string;
}> = {}) {
    return {
        id,
        signalCode: 'songTrap',
        signalVersion: 3,
        rootCause: 'BROKER_EXECUTION',
        outcome: 'ESCALATED',
        summary: 'Broker rejected stop update.',
        backtestRunId: opts.backtestRunId ?? 'run-1',
        indicatorInstanceId: opts.indicatorInstanceId ?? null,
        tradeRecordId: 'trade-1',
        createdAt: new Date(opts.createdAt ?? '2026-03-11T09:00:00Z'),
    };
}

describe('TradingExportService', () => {
    const contractService = new TradingOutputContractService();

    describe('exportRecords', () => {
        it('returns empty records when no data exists', async () => {
            const service = new TradingExportService(makeMockPrisma(), contractService);
            const result = await service.exportRecords({
                backtestRunId: null,
                indicatorInstanceId: null,
                contractKind: null,
                limit: 200,
            });

            assert.equal(result.records.length, 0);
            assert.equal(result.total, 0);
            assert.equal(typeof result.exportedAt, 'string');
        });

        it('exports signal-event envelopes from signal events', async () => {
            const prisma = makeMockPrisma({
                signalEvents: [makeSignalEvent('evt-1')],
            });
            const service = new TradingExportService(prisma, contractService);
            const result = await service.exportRecords({
                backtestRunId: null,
                indicatorInstanceId: null,
                contractKind: 'signal-event',
                limit: 10,
            });

            assert.equal(result.records.length, 1);
            assert.equal(result.records[0].contractKind, 'signal-event');
            assert.equal(result.records[0].recordId, 'evt-1');
            assert.equal(result.records[0].signalKey, 'songTrap@v3');
            assert.equal((result.records[0].payload as any).symbol, 'XAUUSD');
            assert.equal((result.records[0].payload as any).side, 'LONG');
            assert.equal((result.records[0].payload as any).backtestRunId, 'run-1');
        });

        it('exports execution-event envelopes from logic traces', async () => {
            const prisma = makeMockPrisma({
                signalLogicTraces: [makeLogicTrace('trace-1')],
            });
            const service = new TradingExportService(prisma, contractService);
            const result = await service.exportRecords({
                backtestRunId: null,
                indicatorInstanceId: null,
                contractKind: 'execution-event',
                limit: 10,
            });

            assert.equal(result.records.length, 1);
            assert.equal(result.records[0].contractKind, 'execution-event');
            assert.equal(result.records[0].recordId, 'trace-1');
            const payload = result.records[0].payload as any;
            assert.equal(payload.stateBefore, 'WAITING');
            assert.equal(payload.stateAfter, 'ENTERED');
            assert.equal(payload.kind, 'command');
        });

        it('classifies non-command trace events as decision', async () => {
            const prisma = makeMockPrisma({
                signalLogicTraces: [makeLogicTrace('trace-decision', { eventType: 'TRAP' })],
            });
            const service = new TradingExportService(prisma, contractService);
            const result = await service.exportRecords({
                backtestRunId: null,
                indicatorInstanceId: null,
                contractKind: 'execution-event',
                limit: 10,
            });

            assert.equal((result.records[0].payload as any).kind, 'decision');
        });

        it('exports trade-outcome envelopes from backtest trade results', async () => {
            const prisma = makeMockPrisma({
                backtestTradeResults: [makeTradeResult('result-1')],
            });
            const service = new TradingExportService(prisma, contractService);
            const result = await service.exportRecords({
                backtestRunId: null,
                indicatorInstanceId: null,
                contractKind: 'trade-outcome',
                limit: 10,
            });

            assert.equal(result.records.length, 1);
            assert.equal(result.records[0].contractKind, 'trade-outcome');
            const payload = result.records[0].payload as any;
            assert.equal(payload.result, 'WIN');
            assert.equal(payload.pnlUsd, 320);
            assert.equal(payload.exitReason, 'TAKE_PROFIT_1');
            assert.equal(payload.tradeRecordId, 'result-1');
            assert.equal(payload.backtestRunId, 'run-1');
        });

        it('maps isOpen trades to ACTIVE result', async () => {
            const prisma = makeMockPrisma({
                backtestTradeResults: [makeTradeResult('result-open', { isOpen: true })],
            });
            const service = new TradingExportService(prisma, contractService);
            const result = await service.exportRecords({
                backtestRunId: null,
                indicatorInstanceId: null,
                contractKind: 'trade-outcome',
                limit: 10,
            });

            assert.equal(result.records.length, 1);
            assert.equal((result.records[0].payload as any).result, 'ACTIVE');
        });

        it('maps losing trades to LOSS result', async () => {
            const prisma = makeMockPrisma({
                backtestTradeResults: [makeTradeResult('result-loss', { win: false, pnlUsd: -150 })],
            });
            const service = new TradingExportService(prisma, contractService);
            const result = await service.exportRecords({
                backtestRunId: null,
                indicatorInstanceId: null,
                contractKind: 'trade-outcome',
                limit: 10,
            });

            assert.equal((result.records[0].payload as any).result, 'LOSS');
        });

        it('maps zero-pnl losing trades to BE result', async () => {
            const prisma = makeMockPrisma({
                backtestTradeResults: [makeTradeResult('result-be', { win: false, pnlUsd: 0 })],
            });
            const service = new TradingExportService(prisma, contractService);
            const result = await service.exportRecords({
                backtestRunId: null,
                indicatorInstanceId: null,
                contractKind: 'trade-outcome',
                limit: 10,
            });

            assert.equal((result.records[0].payload as any).result, 'BE');
        });

        it('exports investigation-outcome envelopes', async () => {
            const prisma = makeMockPrisma({
                investigationOutcomes: [makeInvestigationOutcome('diag-1')],
            });
            const service = new TradingExportService(prisma, contractService);
            const result = await service.exportRecords({
                backtestRunId: null,
                indicatorInstanceId: null,
                contractKind: 'investigation-outcome',
                limit: 10,
            });

            assert.equal(result.records.length, 1);
            assert.equal(result.records[0].contractKind, 'investigation-outcome');
            const payload = result.records[0].payload as any;
            assert.equal(payload.rootCauseCategory, 'broker-execution');
            assert.equal(payload.outcome, 'escalated');
            assert.equal(payload.tradeRecordId, 'trade-1');
        });

        it('exports all contract kinds when no filter is specified', async () => {
            const prisma = makeMockPrisma({
                signalEvents: [makeSignalEvent('evt-1')],
                signalLogicTraces: [makeLogicTrace('trace-1')],
                backtestTradeResults: [makeTradeResult('result-1')],
                investigationOutcomes: [makeInvestigationOutcome('diag-1')],
            });
            const service = new TradingExportService(prisma, contractService);
            const result = await service.exportRecords({
                backtestRunId: null,
                indicatorInstanceId: null,
                contractKind: null,
                limit: 100,
            });

            assert.equal(result.records.length, 4);
            const kinds = result.records.map((r) => r.contractKind);
            assert.ok(kinds.includes('signal-event'));
            assert.ok(kinds.includes('execution-event'));
            assert.ok(kinds.includes('trade-outcome'));
            assert.ok(kinds.includes('investigation-outcome'));
        });

        it('sorts mixed contract exports globally before applying the limit', async () => {
            const prisma = makeMockPrisma({
                signalEvents: [
                    makeSignalEvent('evt-older', { candleTime: '2026-03-11T07:00:00Z' }),
                    makeSignalEvent('evt-newer', { candleTime: '2026-03-11T08:00:00Z' }),
                ],
                backtestTradeResults: [
                    makeTradeResult('trade-latest', { exitTime: '2026-03-11T09:00:00Z', createdAt: '2026-03-11T09:00:00Z' }),
                ],
            });
            const service = new TradingExportService(prisma, contractService);
            const result = await service.exportRecords({
                backtestRunId: null,
                indicatorInstanceId: null,
                contractKind: null,
                limit: 2,
            });

            assert.equal(result.records.length, 2);
            assert.deepEqual(
                result.records.map((record) => record.recordId),
                ['trade-latest', 'evt-newer'],
            );
            assert.equal(result.total, 3);
        });

        it('includes query context in the result', async () => {
            const service = new TradingExportService(makeMockPrisma(), contractService);
            const result = await service.exportRecords({
                backtestRunId: 'run-1',
                indicatorInstanceId: null,
                contractKind: 'trade-outcome',
                limit: 50,
            });

            assert.equal(result.query.backtestRunId, 'run-1');
            assert.equal(result.query.indicatorInstanceId, null);
            assert.equal(result.query.contractKind, 'trade-outcome');
            assert.equal(result.query.limit, 50);
        });

        it('skips signal events without a linked signal record', async () => {
            const eventNoSignal = {
                id: 'evt-orphan',
                eventType: 'ENTRY_CONFIRMED',
                candleTime: new Date('2026-03-11T08:00:00Z'),
                createdAt: new Date('2026-03-11T08:00:00Z'),
                backtestRunId: 'run-1',
                indicatorInstanceId: null,
                signal: null,
                indicatorInstance: null,
            };
            const prisma = makeMockPrisma({
                signalEvents: [eventNoSignal],
            });
            const service = new TradingExportService(prisma, contractService);
            const result = await service.exportRecords({
                backtestRunId: null,
                indicatorInstanceId: null,
                contractKind: 'signal-event',
                limit: 10,
            });

            assert.equal(result.records.length, 0);
        });

        it('exports live signal events using indicator instance fallback context', async () => {
            const prisma = makeMockPrisma({
                signalEvents: [
                    makeSignalEvent('evt-live', {
                        backtestRunId: null,
                        indicatorInstanceId: 'inst-live',
                        signal: null,
                        indicatorInstance: {
                            id: 'inst-live',
                            signalCode: 'songTrap',
                            signalVersion: 3,
                            symbol: 'XAUUSD',
                            timeframe: 'M15',
                        },
                    }),
                ],
            });
            const service = new TradingExportService(prisma, contractService);
            const result = await service.exportRecords({
                backtestRunId: null,
                indicatorInstanceId: 'inst-live',
                contractKind: 'signal-event',
                limit: 10,
            });

            assert.equal(result.records.length, 1);
            const payload = result.records[0].payload as any;
            assert.equal(payload.signalCode, 'songTrap');
            assert.equal(payload.signalVersion, 3);
            assert.equal(payload.signalId, 'indicator-instance:inst-live');
            assert.equal(payload.symbol, 'XAUUSD');
            assert.equal(payload.timeframe, 'M15');
            assert.equal(payload.indicatorInstanceId, 'inst-live');
        });

        it('exports live execution traces using indicator instance fallback context', async () => {
            const prisma = makeMockPrisma({
                signalLogicTraces: [
                    makeLogicTrace('trace-live', {
                        backtestRunId: null,
                        indicatorInstanceId: 'inst-live',
                        signal: null,
                        indicatorInstance: {
                            signalCode: 'songTrap',
                            signalVersion: 3,
                        },
                    }),
                ],
            });
            const service = new TradingExportService(prisma, contractService);
            const result = await service.exportRecords({
                backtestRunId: null,
                indicatorInstanceId: 'inst-live',
                contractKind: 'execution-event',
                limit: 10,
            });

            assert.equal(result.records.length, 1);
            const payload = result.records[0].payload as any;
            assert.equal(payload.signalCode, 'songTrap');
            assert.equal(payload.signalVersion, 3);
            assert.equal(payload.indicatorInstanceId, 'inst-live');
            assert.equal(payload.kind, 'command');
        });

        it('preserves traceability identifiers in every envelope', async () => {
            const prisma = makeMockPrisma({
                signalEvents: [makeSignalEvent('evt-1', { backtestRunId: 'run-99' })],
            });
            const service = new TradingExportService(prisma, contractService);
            const result = await service.exportRecords({
                backtestRunId: 'run-99',
                indicatorInstanceId: null,
                contractKind: 'signal-event',
                limit: 10,
            });

            assert.equal(result.records.length, 1);
            const envelope = result.records[0];
            assert.equal(envelope.contractKind, 'signal-event');
            assert.equal(envelope.contractVersion, 1);
            assert.ok(envelope.recordId);
            assert.ok(envelope.signalKey);
            assert.ok(envelope.emittedAt);
            assert.equal((envelope.payload as any).backtestRunId, 'run-99');
        });

        it('uses indicator source backtest run when filtering trade outcomes by indicatorInstanceId', async () => {
            const prisma = makeMockPrisma({
                indicatorInstances: {
                    'inst-1': { sourceBacktestRunId: 'run-1' },
                },
                backtestTradeResults: [
                    makeTradeResult('result-1', { backtestRunId: 'run-1' }),
                    makeTradeResult('result-2', { backtestRunId: 'run-2' }),
                ],
            });
            const service = new TradingExportService(prisma, contractService);
            const result = await service.exportRecords({
                backtestRunId: null,
                indicatorInstanceId: 'inst-1',
                contractKind: 'trade-outcome',
                limit: 10,
            });

            assert.equal(result.records.length, 1);
            assert.equal(result.records[0].recordId, 'result-1');
            assert.equal((result.records[0].payload as any).backtestRunId, 'run-1');
        });

        it('returns no trade outcomes when indicatorInstanceId has no source backtest run', async () => {
            const prisma = makeMockPrisma({
                indicatorInstances: {
                    'inst-live': { sourceBacktestRunId: null },
                },
                backtestTradeResults: [makeTradeResult('result-1', { backtestRunId: 'run-1' })],
            });
            const service = new TradingExportService(prisma, contractService);
            const result = await service.exportRecords({
                backtestRunId: null,
                indicatorInstanceId: 'inst-live',
                contractKind: 'trade-outcome',
                limit: 10,
            });

            assert.equal(result.records.length, 0);
        });
    });
});
