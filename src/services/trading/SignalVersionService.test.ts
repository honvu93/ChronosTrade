import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { SignalVersionService } from './SignalVersionService';

type FindUniqueArgs = { where: { code_version: { code: string; version: number } } };
type FindFirstArgs = { where: Record<string, unknown>; orderBy?: unknown };

function makeDef(overrides: Partial<{
    code: string;
    version: number;
    name: string;
    category: string | null;
    description: string | null;
    parameterSchema: unknown;
    indicatorSchema: unknown | null;
    eventSchema: unknown | null;
    composedBlocks: unknown | null;
    isComposed: boolean;
    createdBy: string | null;
    createdAt: Date;
    isActive: boolean;
}> = {}) {
    return {
        id: 'def-1',
        code: 'songTrap',
        version: 1,
        name: 'Song Trap',
        category: 'Breakout',
        description: 'Test signal.',
        parameterSchema: { fields: [{ key: 'lookback', type: 'number', description: 'bars' }] },
        indicatorSchema: null,
        eventSchema: null,
        composedBlocks: null,
        isComposed: false,
        createdBy: 'HVV',
        createdAt: new Date('2026-01-10T00:00:00Z'),
        updatedAt: new Date(),
        isActive: true,
        ...overrides,
    };
}

function makeRun(overrides: Partial<{
    id: string;
    name: string;
    status: string;
    symbol: string;
    timeframe: string;
    parametersJson: unknown | null;
    executionConfigJson: unknown | null;
    createdAt: Date;
}> = {}) {
    return {
        id: 'run-1',
        name: 'Song Trap XAUUSD H1',
        status: 'COMPLETED',
        symbol: 'XAUUSD',
        timeframe: 'H1',
        parametersJson: { lookback: 20 },
        executionConfigJson: { orderTiming: 'OPEN' },
        createdAt: new Date('2026-02-01T00:00:00Z'),
        ...overrides,
    };
}

function makeIndicatorInstance(overrides: Partial<{
    id: string;
    name: string;
    status: string;
    sourceBacktestRunId: string | null;
    signalCode: string;
    signalVersion: number;
    symbol: string;
    timeframe: string;
    parameterJson: unknown;
    executionConfigJson: unknown | null;
}> = {}) {
    return {
        id: 'inst-1',
        name: 'Song Trap Live Runtime',
        status: 'FAILED',
        sourceBacktestRunId: null,
        signalCode: 'songTrap',
        signalVersion: 1,
        symbol: 'XAUUSD',
        timeframe: 'M15',
        parameterJson: { lookback: 9, threshold: 1.5 },
        executionConfigJson: { orderTiming: 'LIVE' },
        ...overrides,
    };
}

function buildPrismaMock({
    def,
    completedRun,
    latestRun,
    runsById = {},
    indicatorInstance = null,
}: {
    def: ReturnType<typeof makeDef> | null;
    completedRun?: ReturnType<typeof makeRun> | null;
    latestRun?: ReturnType<typeof makeRun> | null;
    runsById?: Record<string, ReturnType<typeof makeRun>>;
    indicatorInstance?: ReturnType<typeof makeIndicatorInstance> | null;
}) {
    return {
        signalDefinition: {
            findUnique: async (_args: FindUniqueArgs) => def,
        },
        backtestRun: {
            findFirst: async (args: FindFirstArgs) => {
                const where = args.where as Record<string, unknown>;
                if (typeof where.id === 'string') {
                    return runsById[where.id] ?? null;
                }
                if (where.status === 'COMPLETED') {
                    return completedRun ?? null;
                }
                return latestRun ?? null;
            },
        },
        indicatorInstance: {
            findFirst: async (args: FindFirstArgs) => {
                const where = args.where as Record<string, unknown>;
                if (!indicatorInstance) {
                    return null;
                }
                if (
                    where.id === indicatorInstance.id
                    && where.signalCode === indicatorInstance.signalCode
                    && where.signalVersion === indicatorInstance.signalVersion
                ) {
                    return indicatorInstance;
                }
                return null;
            },
        },
    } as unknown as import('@prisma/client').PrismaClient;
}

const env = {
    MT5_LOGIN: '10001',
    MT5_PASSWORD: 'secret',
    MT5_SERVER: 'Demo-Server',
    MT5_BRIDGE_PORT: '8765',
    ENCRYPTION_KEY: '12345678901234567890123456789012',
};

describe('SignalVersionService.getSnapshot', () => {
    it('returns null when signal definition is not found', async () => {
        const prisma = buildPrismaMock({ def: null });
        const svc = new SignalVersionService(prisma, env);
        const result = await svc.getSnapshot({ code: 'unknown', version: 1 });
        assert.equal(result, null);
    });

    it('falls back to the preferred backtest run when no exact record is supplied', async () => {
        const prisma = buildPrismaMock({
            def: makeDef(),
            completedRun: makeRun({ id: 'completed-run', executionConfigJson: { orderTiming: 'CLOSE' } }),
            latestRun: makeRun({ id: 'latest-run', status: 'RUNNING', executionConfigJson: { orderTiming: 'LIVE' } }),
        });
        const svc = new SignalVersionService(prisma, env);
        const result = await svc.getSnapshot({ code: 'songTrap', version: 1 });

        assert.ok(result !== null);
        assert.equal(result.originKind, 'backtest-run');
        assert.equal(result.originRecordId, 'completed-run');
        assert.equal(result.linkedBacktestRunId, 'completed-run');
        assert.deepEqual(result.executionConfigJson, { orderTiming: 'CLOSE' });
        assert.deepEqual(result.parameterValuesJson, { lookback: 20 });
    });

    it('uses the exact backtest run when backtestRunId is supplied', async () => {
        const exactRun = makeRun({
            id: 'run-exact',
            name: 'Incident Run',
            status: 'FAILED',
            timeframe: 'M30',
            parametersJson: { lookback: 7, threshold: 2 },
            executionConfigJson: { orderTiming: 'CLOSE', stopLoss: { mode: 'ATR' } },
        });
        const prisma = buildPrismaMock({
            def: makeDef(),
            completedRun: makeRun({ id: 'completed-run' }),
            latestRun: makeRun({ id: 'latest-run', status: 'RUNNING' }),
            runsById: { 'run-exact': exactRun },
        });
        const svc = new SignalVersionService(prisma, env);
        const result = await svc.getSnapshot({
            code: 'songTrap',
            version: 1,
            backtestRunId: 'run-exact',
        });

        assert.ok(result !== null);
        assert.equal(result.originKind, 'backtest-run');
        assert.equal(result.originRecordId, 'run-exact');
        assert.equal(result.originStatus, 'FAILED');
        assert.equal(result.originTimeframe, 'M30');
        assert.deepEqual(result.parameterValuesJson, { lookback: 7, threshold: 2 });
        assert.deepEqual(result.executionConfigJson, {
            orderTiming: 'CLOSE',
            stopLoss: { mode: 'ATR' },
        });
    });

    it('returns null when an exact backtest context is requested but not found', async () => {
        const prisma = buildPrismaMock({ def: makeDef() });
        const svc = new SignalVersionService(prisma, env);
        const result = await svc.getSnapshot({
            code: 'songTrap',
            version: 1,
            backtestRunId: 'missing-run',
        });

        assert.equal(result, null);
    });

    it('uses the exact live indicator instance and attaches account context', async () => {
        const prisma = buildPrismaMock({
            def: makeDef(),
            latestRun: makeRun({ id: 'reference-run', name: 'Reference Backtest' }),
            indicatorInstance: makeIndicatorInstance({
                id: 'inst-live',
                sourceBacktestRunId: null,
                parameterJson: { lookback: 9, threshold: 1.5 },
                executionConfigJson: { orderTiming: 'LIVE', stopLoss: { mode: 'FIXED', value: 10 } },
            }),
        });
        const svc = new SignalVersionService(prisma, env);
        const result = await svc.getSnapshot({
            code: 'songTrap',
            version: 1,
            indicatorInstanceId: 'inst-live',
        });

        assert.ok(result !== null);
        assert.equal(result.originKind, 'indicator-instance');
        assert.equal(result.originRecordId, 'inst-live');
        assert.equal(result.linkedBacktestRunId, 'reference-run');
        assert.deepEqual(result.parameterValuesJson, { lookback: 9, threshold: 1.5 });
        assert.deepEqual(result.executionConfigJson, {
            orderTiming: 'LIVE',
            stopLoss: { mode: 'FIXED', value: 10 },
        });
        assert.deepEqual(result.accountContext, {
            readinessState: 'ready',
            accountId: null,
            accountLabel: null,
            mt5Login: '10001',
            mt5Server: 'Demo-Server',
        });
    });

    it('links the source backtest when the indicator instance originated from a run', async () => {
        const sourceRun = makeRun({ id: 'source-run', name: 'Source Backtest', timeframe: 'H4' });
        const prisma = buildPrismaMock({
            def: makeDef(),
            runsById: { 'source-run': sourceRun },
            indicatorInstance: makeIndicatorInstance({
                id: 'inst-derived',
                sourceBacktestRunId: 'source-run',
                status: 'PAUSED',
                executionConfigJson: { orderTiming: 'REPLAY' },
            }),
        });
        const svc = new SignalVersionService(prisma, env);
        const result = await svc.getSnapshot({
            code: 'songTrap',
            version: 1,
            indicatorInstanceId: 'inst-derived',
        });

        assert.ok(result !== null);
        assert.equal(result.linkedBacktestRunId, 'source-run');
        assert.equal(result.linkedBacktestName, 'Source Backtest');
        assert.equal(result.accountContext, null);
        assert.equal(result.originStatus, 'PAUSED');
    });

    it('returns null when an exact indicator context is requested but not found', async () => {
        const prisma = buildPrismaMock({ def: makeDef() });
        const svc = new SignalVersionService(prisma, env);
        const result = await svc.getSnapshot({
            code: 'songTrap',
            version: 1,
            indicatorInstanceId: 'missing-instance',
        });

        assert.equal(result, null);
    });
});
