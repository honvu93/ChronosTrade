import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { BacktestRunStatus, SignalSourceType } from '@prisma/client';
import { EngineAnalyticsService } from './EngineAnalyticsService';

type MockRun = {
    id: string;
    sourceType: SignalSourceType;
    status: BacktestRunStatus;
    signalCode: string | null;
    signalVersion: number | null;
    name: string;
    symbol: string;
    timeframe: string;
    startedAt: Date;
    finishedAt: Date | null;
    createdAt: Date;
    signals: Array<{ id: string }>;
    results: Array<{
        signalId: string;
        win: boolean;
        isOpen: boolean;
        rMultiple: number;
        pnlUsd: number;
        maxDrawdownPct: number;
    }>;
};

type MockRunWhere = Record<string, unknown>;

const makeRun = (overrides: Partial<MockRun> & Pick<MockRun, 'id' | 'signalCode' | 'signalVersion' | 'name'>): MockRun => ({
    id: overrides.id,
    sourceType: overrides.sourceType ?? SignalSourceType.GENERATED,
    status: overrides.status ?? BacktestRunStatus.COMPLETED,
    signalCode: overrides.signalCode,
    signalVersion: overrides.signalVersion,
    name: overrides.name,
    symbol: overrides.symbol ?? 'XAUUSD',
    timeframe: overrides.timeframe ?? '1h',
    startedAt: overrides.startedAt ?? new Date('2026-03-01T00:00:00.000Z'),
    finishedAt: overrides.finishedAt ?? new Date('2026-03-10T23:59:59.999Z'),
    createdAt: overrides.createdAt ?? new Date('2026-03-11T00:00:00.000Z'),
    signals: overrides.signals ?? [{ id: `${overrides.id}-signal-1` }],
    results: overrides.results ?? [],
});

const matchesDateFilter = (value: Date | null, filter: unknown) => {
    if (!filter || typeof filter !== 'object' || !value) {
        return filter === null ? value === null : true;
    }

    const typedFilter = filter as { gte?: Date; lte?: Date };
    if (typedFilter.gte && value.getTime() < typedFilter.gte.getTime()) {
        return false;
    }
    if (typedFilter.lte && value.getTime() > typedFilter.lte.getTime()) {
        return false;
    }

    return true;
};

const matchesBacktestRunWhere = (run: MockRun, where: MockRunWhere) => {
    if (where.sourceType && run.sourceType !== where.sourceType) {
        return false;
    }

    if (where.symbol && run.symbol !== where.symbol) {
        return false;
    }

    if (where.timeframe && run.timeframe !== where.timeframe) {
        return false;
    }

    if (where.status && run.status !== where.status) {
        return false;
    }

    if (where.signalCode && typeof where.signalCode === 'object') {
        const filter = where.signalCode as { contains?: string };
        const normalizedNeedle = (filter.contains ?? '').toUpperCase();
        const normalizedHaystack = (run.signalCode ?? '').toUpperCase();
        if (!normalizedHaystack.includes(normalizedNeedle)) {
            return false;
        }
    }

    if ('finishedAt' in where) {
        const finishedAtFilter = where.finishedAt;
        if (finishedAtFilter === null) {
            if (run.finishedAt !== null) {
                return false;
            }
        } else if (!matchesDateFilter(run.finishedAt, finishedAtFilter)) {
            return false;
        }
    }

    if ('startedAt' in where && !matchesDateFilter(run.startedAt, where.startedAt)) {
        return false;
    }

    if (Array.isArray(where.AND) && !where.AND.every((entry) => matchesBacktestRunWhere(run, entry as MockRunWhere))) {
        return false;
    }

    if (Array.isArray(where.OR) && !where.OR.some((entry) => matchesBacktestRunWhere(run, entry as MockRunWhere))) {
        return false;
    }

    return true;
};

const applyBacktestRunWhere = (runs: MockRun[], where: MockRunWhere) => runs.filter((run) => matchesBacktestRunWhere(run, where));

const serializeRunRecord = (run: MockRun) => ({
    id: run.id,
    name: run.name,
    signalCode: run.signalCode,
    signalVersion: run.signalVersion,
    symbol: run.symbol,
    timeframe: run.timeframe,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    createdAt: run.createdAt,
    _count: {
        signals: run.signals.length,
    },
});

const buildGroupByRows = (runs: MockRun[], runIds: string[]) => {
    const grouped = new Map<string, {
        backtestRunId: string;
        win: boolean;
        isOpen: boolean;
        count: number;
        netR: number;
        netUsd: number;
        maxDrawdownPct: number;
    }>();

    for (const run of runs.filter((item) => runIds.includes(item.id))) {
        for (const result of run.results) {
            const key = `${run.id}:${result.isOpen}:${result.win}`;
            const current = grouped.get(key) ?? {
                backtestRunId: run.id,
                win: result.win,
                isOpen: result.isOpen,
                count: 0,
                netR: 0,
                netUsd: 0,
                maxDrawdownPct: 0,
            };

            current.count += 1;
            current.netR += result.rMultiple;
            current.netUsd += result.pnlUsd;
            current.maxDrawdownPct = Math.min(current.maxDrawdownPct, result.maxDrawdownPct);
            grouped.set(key, current);
        }
    }

    return Array.from(grouped.values()).map((group) => ({
        backtestRunId: group.backtestRunId,
        win: group.win,
        isOpen: group.isOpen,
        _count: {
            _all: group.count,
        },
        _sum: {
            rMultiple: group.netR,
            pnlUsd: group.netUsd,
        },
        _min: {
            maxDrawdownPct: group.maxDrawdownPct,
        },
    }));
};

describe('EngineAnalyticsService.listRuns', () => {
    it('includes an explicitly requested run even when it falls outside the default 50-row catalog', async () => {
        const catalogRuns = Array.from({ length: 50 }, (_, index) => makeRun({
            id: `run-${index + 1}`,
            signalCode: 'songTrap',
            signalVersion: 1,
            name: `Run ${index + 1}`,
            createdAt: new Date(`2026-03-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z`),
        }));
        const requestedRun = makeRun({
            id: 'run-archived',
            signalCode: 'meanFlip',
            signalVersion: 2,
            name: 'Archived Requested Run',
            createdAt: new Date('2026-03-31T00:00:00.000Z'),
        });
        let findUniqueCalls = 0;

        const prisma = {
            backtestRun: {
                findMany: async () => catalogRuns as never,
                findUnique: async ({ where }: { where: { id: string } }) => {
                    findUniqueCalls += 1;
                    return where.id === requestedRun.id ? requestedRun as never : null;
                },
            },
        } as never;

        const service = new EngineAnalyticsService(prisma);
        const result = await service.listRuns({ includeId: requestedRun.id });

        assert.equal(findUniqueCalls, 1);
        assert.equal(result[0].id, requestedRun.id);
        assert.equal(result.some((run) => run.id === requestedRun.id), true);
        assert.equal(result.length, 51);
    });
});

describe('EngineAnalyticsService.getGeneratedBacktestLeaderboard', () => {
    it('ranks generated runs cautiously and excludes imported runs', async () => {
        const runs: MockRun[] = [
            makeRun({
                id: 'run-a-strong',
                signalCode: 'songTrap',
                signalVersion: 1,
                name: 'Song Trap Strong',
                results: [
                    { signalId: 'a1', win: true, isOpen: false, rMultiple: 2, pnlUsd: 400, maxDrawdownPct: -3 },
                    { signalId: 'a1', win: true, isOpen: false, rMultiple: 1.5, pnlUsd: 300, maxDrawdownPct: -4 },
                    { signalId: 'a2', win: false, isOpen: false, rMultiple: -1, pnlUsd: -200, maxDrawdownPct: -4.5 },
                    { signalId: 'a2', win: true, isOpen: false, rMultiple: 2.5, pnlUsd: 500, maxDrawdownPct: -2.5 },
                    { signalId: 'a2', win: true, isOpen: false, rMultiple: 1, pnlUsd: 200, maxDrawdownPct: -2.1 },
                ],
                signals: [{ id: 'a1' }, { id: 'a2' }],
            }),
            makeRun({
                id: 'run-a-small',
                signalCode: 'songTrap',
                signalVersion: 1,
                name: 'Song Trap Small Sample',
                createdAt: new Date('2026-03-12T00:00:00.000Z'),
                results: [
                    { signalId: 'a3', win: true, isOpen: false, rMultiple: 4, pnlUsd: 800, maxDrawdownPct: -2 },
                    { signalId: 'a3', win: true, isOpen: false, rMultiple: 1.5, pnlUsd: 300, maxDrawdownPct: -2.2 },
                    { signalId: 'a3', win: false, isOpen: false, rMultiple: -0.5, pnlUsd: -100, maxDrawdownPct: -2.3 },
                ],
            }),
            makeRun({
                id: 'run-b-strong',
                signalCode: 'meanFlip',
                signalVersion: 2,
                name: 'Mean Flip Strong',
                symbol: 'BTCUSD',
                timeframe: '4h',
                createdAt: new Date('2026-03-13T00:00:00.000Z'),
                results: [
                    { signalId: 'b1', win: true, isOpen: false, rMultiple: 2.5, pnlUsd: 250, maxDrawdownPct: -5 },
                    { signalId: 'b1', win: true, isOpen: false, rMultiple: 1.5, pnlUsd: 150, maxDrawdownPct: -5.5 },
                    { signalId: 'b2', win: true, isOpen: false, rMultiple: 2, pnlUsd: 200, maxDrawdownPct: -4 },
                    { signalId: 'b2', win: false, isOpen: false, rMultiple: -1, pnlUsd: -100, maxDrawdownPct: -6 },
                    { signalId: 'b3', win: true, isOpen: false, rMultiple: 1, pnlUsd: 100, maxDrawdownPct: -3.5 },
                ],
                signals: [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }],
            }),
            makeRun({
                id: 'run-c-failed',
                signalCode: 'breakFade',
                signalVersion: 4,
                name: 'Break Fade Failed',
                status: BacktestRunStatus.FAILED,
                results: [],
            }),
            makeRun({
                id: 'run-imported',
                signalCode: 'legacyImport',
                signalVersion: 1,
                name: 'Imported Bundle',
                sourceType: SignalSourceType.IMPORTED,
                results: [
                    { signalId: 'imp-1', win: true, isOpen: false, rMultiple: 6, pnlUsd: 600, maxDrawdownPct: -1 },
                ],
            }),
        ];

        let capturedWhere: unknown = null;
        let capturedGroupByRunIds: string[] = [];
        const prisma = {
            backtestRun: {
                findMany: async ({ where }: { where: MockRunWhere }) => {
                    capturedWhere = where;
                    return applyBacktestRunWhere(runs, where).map(serializeRunRecord) as never;
                },
            },
            backtestTradeResult: {
                groupBy: async ({ where }: { where: { backtestRunId: { in: string[] } } }) => {
                    capturedGroupByRunIds = where.backtestRunId.in;
                    return buildGroupByRows(runs, where.backtestRunId.in) as never;
                },
            },
        } as never;

        const service = new EngineAnalyticsService(prisma);
        const result = await service.getGeneratedBacktestLeaderboard({}, {});

        assert.equal((capturedWhere as { sourceType: string }).sourceType, SignalSourceType.GENERATED);
        assert.deepEqual([...capturedGroupByRunIds].sort(), ['run-a-small', 'run-a-strong', 'run-b-strong', 'run-c-failed']);
        assert.deepEqual(result.rows.map((row) => row.runId), [
            'run-a-strong',
            'run-b-strong',
            'run-a-small',
            'run-c-failed',
        ]);
        assert.equal(result.rows[0].cautionState, 'constructive');
        assert.equal(result.rows[2].cautionState, 'weaker');
        assert.equal(result.rows[3].cautionState, 'suspicious');
        assert.match(result.rows[2].cautionFlags[0], /closed trades/i);
        assert.equal(result.summary.totalRows, 4);
        assert.equal(result.summary.totalSignals, 3);
        assert.equal(result.summary.constructiveRows, 2);
        assert.equal(result.summary.weakerRows, 1);
        assert.equal(result.summary.suspiciousRows, 1);
    });

    it('keeps only the strongest ranked run when mode is BEST_PER_SIGNAL', async () => {
        const runs: MockRun[] = [
            makeRun({
                id: 'run-a-constructive',
                signalCode: 'songTrap',
                signalVersion: 1,
                name: 'Song Trap Constructive',
                results: [
                    { signalId: 'a1', win: true, isOpen: false, rMultiple: 2, pnlUsd: 200, maxDrawdownPct: -4 },
                    { signalId: 'a1', win: true, isOpen: false, rMultiple: 1.5, pnlUsd: 150, maxDrawdownPct: -4.5 },
                    { signalId: 'a2', win: false, isOpen: false, rMultiple: -1, pnlUsd: -100, maxDrawdownPct: -5 },
                    { signalId: 'a2', win: true, isOpen: false, rMultiple: 1.2, pnlUsd: 120, maxDrawdownPct: -3.5 },
                    { signalId: 'a2', win: true, isOpen: false, rMultiple: 1.1, pnlUsd: 110, maxDrawdownPct: -3.1 },
                ],
            }),
            makeRun({
                id: 'run-a-weaker',
                signalCode: 'songTrap',
                signalVersion: 1,
                name: 'Song Trap Weaker',
                results: [
                    { signalId: 'a3', win: true, isOpen: false, rMultiple: 5, pnlUsd: 500, maxDrawdownPct: -2 },
                    { signalId: 'a3', win: true, isOpen: false, rMultiple: 2, pnlUsd: 200, maxDrawdownPct: -2.2 },
                    { signalId: 'a3', win: false, isOpen: false, rMultiple: -0.25, pnlUsd: -25, maxDrawdownPct: -2.4 },
                ],
            }),
            makeRun({
                id: 'run-b-best',
                signalCode: 'meanFlip',
                signalVersion: 2,
                name: 'Mean Flip Best',
                results: [
                    { signalId: 'b1', win: true, isOpen: false, rMultiple: 2.5, pnlUsd: 250, maxDrawdownPct: -5 },
                    { signalId: 'b1', win: true, isOpen: false, rMultiple: 1.5, pnlUsd: 150, maxDrawdownPct: -5.5 },
                    { signalId: 'b2', win: true, isOpen: false, rMultiple: 2, pnlUsd: 200, maxDrawdownPct: -4 },
                    { signalId: 'b2', win: false, isOpen: false, rMultiple: -1, pnlUsd: -100, maxDrawdownPct: -6 },
                    { signalId: 'b3', win: true, isOpen: false, rMultiple: 1, pnlUsd: 100, maxDrawdownPct: -3.5 },
                ],
            }),
        ];

        const prisma = {
            backtestRun: {
                findMany: async ({ where }: { where: MockRunWhere }) => applyBacktestRunWhere(runs, where).map(serializeRunRecord) as never,
            },
            backtestTradeResult: {
                groupBy: async ({ where }: { where: { backtestRunId: { in: string[] } } }) => buildGroupByRows(runs, where.backtestRunId.in) as never,
            },
        } as never;

        const service = new EngineAnalyticsService(prisma);
        const result = await service.getGeneratedBacktestLeaderboard({}, { mode: 'BEST_PER_SIGNAL' });

        assert.deepEqual(result.rows.map((row) => row.runId), ['run-b-best', 'run-a-constructive']);
        assert.equal(result.summary.totalRows, 2);
    });

    it('applies filter combinations, explicit sorts, and date bounds server-side', async () => {
        const runs: MockRun[] = [
            makeRun({
                id: 'run-song-old',
                signalCode: 'songTrap',
                signalVersion: 1,
                name: 'Song Trap Old',
                startedAt: new Date('2026-03-01T00:00:00.000Z'),
                finishedAt: new Date('2026-03-10T23:59:59.999Z'),
                createdAt: new Date('2026-03-11T00:00:00.000Z'),
                results: [
                    { signalId: 's1', win: true, isOpen: false, rMultiple: 1, pnlUsd: 100, maxDrawdownPct: -4 },
                    { signalId: 's2', win: false, isOpen: false, rMultiple: -1, pnlUsd: -100, maxDrawdownPct: -6 },
                ],
            }),
            makeRun({
                id: 'run-song-new',
                signalCode: 'songTrap',
                signalVersion: 1,
                name: 'Song Trap New',
                startedAt: new Date('2026-03-05T00:00:00.000Z'),
                finishedAt: new Date('2026-03-14T23:59:59.999Z'),
                createdAt: new Date('2026-03-15T00:00:00.000Z'),
                results: [
                    { signalId: 's3', win: true, isOpen: false, rMultiple: 3, pnlUsd: 300, maxDrawdownPct: -2 },
                    { signalId: 's4', win: true, isOpen: false, rMultiple: 2, pnlUsd: 200, maxDrawdownPct: -2.5 },
                    { signalId: 's5', win: false, isOpen: false, rMultiple: -1, pnlUsd: -100, maxDrawdownPct: -3 },
                    { signalId: 's6', win: true, isOpen: false, rMultiple: 1.5, pnlUsd: 150, maxDrawdownPct: -2.2 },
                ],
            }),
            makeRun({
                id: 'run-other',
                signalCode: 'meanFlip',
                signalVersion: 2,
                name: 'Mean Flip',
                symbol: 'BTCUSD',
                timeframe: '4h',
                results: [
                    { signalId: 'm1', win: true, isOpen: false, rMultiple: 4, pnlUsd: 400, maxDrawdownPct: -3 },
                    { signalId: 'm2', win: true, isOpen: false, rMultiple: 1, pnlUsd: 100, maxDrawdownPct: -3.2 },
                    { signalId: 'm3', win: false, isOpen: false, rMultiple: -1, pnlUsd: -100, maxDrawdownPct: -4 },
                    { signalId: 'm4', win: true, isOpen: false, rMultiple: 0.5, pnlUsd: 50, maxDrawdownPct: -2.5 },
                ],
            }),
        ];

        const prisma = {
            backtestRun: {
                findMany: async ({ where }: { where: MockRunWhere }) => applyBacktestRunWhere(runs, where).map(serializeRunRecord) as never,
            },
            backtestTradeResult: {
                groupBy: async ({ where }: { where: { backtestRunId: { in: string[] } } }) => buildGroupByRows(runs, where.backtestRunId.in) as never,
            },
        } as never;

        const service = new EngineAnalyticsService(prisma);
        const result = await service.getGeneratedBacktestLeaderboard(
            {
                signalCode: 'song',
                timeframe: '1h',
                from: new Date('2026-03-03T00:00:00.000Z'),
                to: new Date('2026-03-20T00:00:00.000Z'),
                minClosedTrades: 4,
            },
            {
                sort: 'profitFactor',
                order: 'desc',
            },
        );

        assert.deepEqual(result.rows.map((row) => row.runId), ['run-song-new']);
        assert.equal(result.rows[0].profitFactor, 6.5);
        assert.equal(result.pagination.totalRows, 1);
    });
});
