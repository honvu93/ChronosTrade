import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { TradingAuditService } from './TradingAuditService';

function makeTradeRow(overrides: Partial<{
    id: string;
    backtestRunId: string;
    signalId: string;
    exitRuleId: string;
    isOpen: boolean;
    rMultiple: number;
    pnlUsd: number;
    exitTime: Date | null;
    exitReason: string;
    createdAt: Date;
    session: string;
    notes: string | null;
    exitPrice: number | null;
    signal: {
        id: string;
        symbol: string;
        timeframe: string;
        side: string;
        entryTime: Date;
        entryPrice: number;
        stopLoss: number;
        notes: string | null;
    };
    exitRule: {
        id: string;
        code: string;
        name: string;
    };
    backtestRun: {
        id: string;
        name: string;
        status: string;
        signalCode: string | null;
        signalVersion: number | null;
    };
}> = {}) {
    return {
        id: 'result-1',
        backtestRunId: 'run-1',
        signalId: 'signal-1',
        exitRuleId: 'exit-1',
        isOpen: false,
        rMultiple: 1.25,
        pnlUsd: 320,
        exitTime: new Date('2026-03-10T09:30:00Z'),
        exitReason: 'TAKE_PROFIT_1',
        createdAt: new Date('2026-03-10T09:35:00Z'),
        session: 'LONDON',
        notes: 'Exited cleanly.',
        exitPrice: 3245.5,
        signal: {
            id: 'signal-1',
            symbol: 'XAUUSD',
            timeframe: 'H1',
            side: 'LONG',
            entryTime: new Date('2026-03-10T08:00:00Z'),
            entryPrice: 3233.1,
            stopLoss: 3224.5,
            notes: 'Signal note.',
        },
        exitRule: {
            id: 'exit-1',
            code: 'TP1',
            name: 'Take Profit 1',
        },
        backtestRun: {
            id: 'run-1',
            name: 'Song Trap XAUUSD H1',
            status: 'COMPLETED',
            signalCode: 'songTrap',
            signalVersion: 3,
        },
        ...overrides,
    };
}

function makeEvent(overrides: Partial<{
    id: string;
    signalId: string | null;
    backtestRunId: string | null;
    eventType: string;
    candleTime: Date;
    price: number | null;
    label: string | null;
    metaJson: unknown | null;
    createdAt: Date;
}> = {}) {
    return {
        id: 'event-1',
        signalId: 'signal-1',
        backtestRunId: 'run-1',
        eventType: 'ENTRY_CONFIRMED',
        candleTime: new Date('2026-03-10T08:05:00Z'),
        price: 3234.2,
        label: 'Broker confirm',
        metaJson: { decision: 'place-order' },
        createdAt: new Date('2026-03-10T08:05:10Z'),
        ...overrides,
    };
}

function makeTrace(overrides: Partial<{
    id: string;
    signalId: string | null;
    signalEventId: string | null;
    backtestRunId: string | null;
    eventType: string;
    candleTime: Date;
    stateBefore: string | null;
    stateAfter: string | null;
    ruleId: string | null;
    indicatorJson: unknown | null;
    thresholdJson: unknown | null;
    priceJson: unknown | null;
    notes: string | null;
    createdAt: Date;
}> = {}) {
    return {
        id: 'trace-1',
        signalId: 'signal-1',
        signalEventId: 'event-1',
        backtestRunId: 'run-1',
        eventType: 'ENTRY_CONFIRMED',
        candleTime: new Date('2026-03-10T08:05:00Z'),
        stateBefore: 'WAITING',
        stateAfter: 'ENTERED',
        ruleId: 'entry-rule',
        indicatorJson: { fastEma: 12, slowEma: 21 },
        thresholdJson: { threshold: 1.4 },
        priceJson: { close: 3234.2 },
        notes: 'Rule matched.',
        createdAt: new Date('2026-03-10T08:05:01Z'),
        ...overrides,
    };
}

function buildPrismaMock({
    rows,
    detailRow = null,
    events = [],
    traces = [],
}: {
    rows: ReturnType<typeof makeTradeRow>[];
    detailRow?: ReturnType<typeof makeTradeRow> | null;
    events?: ReturnType<typeof makeEvent>[];
    traces?: ReturnType<typeof makeTrace>[];
}) {
    return {
        backtestTradeResult: {
            findMany: async () => rows,
            findUnique: async ({ where }: { where: { id: string } }) =>
                detailRow && where.id === detailRow.id ? detailRow : null,
        },
        signalEvent: {
            findMany: async () => events,
        },
        signalLogicTrace: {
            findMany: async () => traces,
        },
    } as unknown as import('@prisma/client').PrismaClient;
}

describe('TradingAuditService.listHistory', () => {
    it('returns recent records with audit coverage counts and summary totals', async () => {
        const row = makeTradeRow();
        const prisma = buildPrismaMock({
            rows: [row],
            events: [makeEvent()],
            traces: [makeTrace({ eventType: 'TRAP' })],
        });
        const service = new TradingAuditService(prisma);

        const snapshot = await service.listHistory({ limit: 20 });

        assert.equal(snapshot.summary.totalRecords, 1);
        assert.equal(snapshot.summary.recordsWithAudit, 1);
        assert.equal(snapshot.summary.commandEvents, 1);
        assert.equal(snapshot.summary.decisionEvents, 1);
        assert.equal(snapshot.records[0].recordId, 'result-1');
        assert.equal(snapshot.records[0].result, 'WIN');
        assert.equal(snapshot.records[0].auditCoverage, 'full');
        assert.equal(snapshot.records[0].commandEventCount, 1);
        assert.equal(snapshot.records[0].decisionEventCount, 1);
        assert.equal(snapshot.records[0].signalCode, 'songTrap');
        assert.equal(snapshot.records[0].signalVersion, 3);
    });

    it('marks records without audit rows as missing coverage', async () => {
        const row = makeTradeRow({
            id: 'result-2',
            isOpen: true,
            rMultiple: 0,
            pnlUsd: 0,
            exitTime: null,
        });
        const prisma = buildPrismaMock({
            rows: [row],
            events: [],
            traces: [],
        });
        const service = new TradingAuditService(prisma);

        const snapshot = await service.listHistory();

        assert.equal(snapshot.summary.activeTrades, 1);
        assert.equal(snapshot.summary.recordsMissingAudit, 1);
        assert.equal(snapshot.records[0].result, 'ACTIVE');
        assert.equal(snapshot.records[0].auditCoverage, 'missing');
    });

    it('scopes shared signal audit rows to each record outcome instead of reusing the full stream', async () => {
        const earlyExit = makeTradeRow({
            id: 'result-early',
            exitRuleId: 'exit-tp1',
            exitReason: 'TAKE_PROFIT_1',
            exitTime: new Date('2026-03-10T09:00:00Z'),
            exitRule: {
                id: 'exit-tp1',
                code: 'TP1',
                name: 'Take Profit 1',
            },
        });
        const lateExit = makeTradeRow({
            id: 'result-late',
            exitRuleId: 'exit-tp2',
            exitReason: 'TAKE_PROFIT_2',
            exitTime: new Date('2026-03-10T10:00:00Z'),
            exitRule: {
                id: 'exit-tp2',
                code: 'TP2',
                name: 'Take Profit 2',
            },
        });
        const prisma = buildPrismaMock({
            rows: [lateExit, earlyExit],
            events: [
                makeEvent({
                    id: 'event-trap',
                    eventType: 'TRAP',
                    candleTime: new Date('2026-03-10T07:45:00Z'),
                }),
                makeEvent({
                    id: 'event-entry-confirmed',
                    eventType: 'ENTRY_CONFIRMED',
                    candleTime: new Date('2026-03-10T08:05:00Z'),
                }),
                makeEvent({
                    id: 'event-tp1',
                    eventType: 'TP1_HIT',
                    candleTime: new Date('2026-03-10T09:00:00Z'),
                }),
                makeEvent({
                    id: 'event-tp2',
                    eventType: 'TP2_HIT',
                    candleTime: new Date('2026-03-10T10:00:00Z'),
                }),
            ],
            traces: [],
        });
        const service = new TradingAuditService(prisma);

        const snapshot = await service.listHistory({ limit: 20 });
        const earlyRecord = snapshot.records.find((record) => record.recordId === 'result-early');
        const lateRecord = snapshot.records.find((record) => record.recordId === 'result-late');

        assert.ok(earlyRecord);
        assert.ok(lateRecord);
        assert.equal(earlyRecord.commandEventCount, 2);
        assert.equal(earlyRecord.decisionEventCount, 1);
        assert.equal(earlyRecord.latestAuditAt, '2026-03-10T09:00:00.000Z');
        assert.equal(lateRecord.commandEventCount, 3);
        assert.equal(lateRecord.decisionEventCount, 1);
        assert.equal(lateRecord.latestAuditAt, '2026-03-10T10:00:00.000Z');
    });
});

describe('TradingAuditService.getHistoryDetail', () => {
    it('returns traceability and a merged timeline with distinguishable kinds', async () => {
        const row = makeTradeRow();
        const prisma = buildPrismaMock({
            rows: [],
            detailRow: row,
            events: [
                makeEvent({
                    id: 'event-command',
                    eventType: 'ENTRY_CONFIRMED',
                    candleTime: new Date('2026-03-10T08:05:00Z'),
                    createdAt: new Date('2026-03-10T08:05:10Z'),
                }),
            ],
            traces: [
                makeTrace({
                    id: 'trace-decision',
                    eventType: 'TRAP',
                    candleTime: new Date('2026-03-10T07:45:00Z'),
                    createdAt: new Date('2026-03-10T07:45:00Z'),
                }),
            ],
        });
        const service = new TradingAuditService(prisma);

        const detail = await service.getHistoryDetail('result-1');

        assert.ok(detail !== null);
        assert.equal(detail.traceability.historyRecordId, 'result-1');
        assert.equal(detail.traceability.signalKey, 'songTrap@v3');
        assert.equal(detail.timelineSummary.totalItems, 2);
        assert.equal(detail.timeline[0].kind, 'decision');
        assert.equal(detail.timeline[1].kind, 'command');
        assert.equal(detail.timeline[0].eventType, 'TRAP');
        assert.equal(detail.timeline[1].eventType, 'ENTRY_CONFIRMED');
    });

    it('classifies signal events by semantic kind instead of mapping every event row to command', async () => {
        const row = makeTradeRow({
            exitTime: new Date('2026-03-10T09:00:00Z'),
            exitReason: 'STOP_LOSS',
        });
        const prisma = buildPrismaMock({
            rows: [],
            detailRow: row,
            events: [
                makeEvent({
                    id: 'event-decision',
                    eventType: 'TRAP',
                    candleTime: new Date('2026-03-10T07:45:00Z'),
                }),
                makeEvent({
                    id: 'event-command',
                    eventType: 'ENTRY_CONFIRMED',
                    candleTime: new Date('2026-03-10T08:05:00Z'),
                }),
            ],
            traces: [],
        });
        const service = new TradingAuditService(prisma);

        const detail = await service.getHistoryDetail('result-1');

        assert.ok(detail !== null);
        assert.equal(detail.timeline[0].eventType, 'TRAP');
        assert.equal(detail.timeline[0].kind, 'decision');
        assert.equal(detail.timeline[0].source, 'event');
        assert.equal(detail.timeline[1].eventType, 'ENTRY_CONFIRMED');
        assert.equal(detail.timeline[1].kind, 'command');
    });

    it('returns null when the requested record does not exist', async () => {
        const prisma = buildPrismaMock({
            rows: [],
            detailRow: null,
        });
        const service = new TradingAuditService(prisma);

        const detail = await service.getHistoryDetail('missing-record');

        assert.equal(detail, null);
    });
});
