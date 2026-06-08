import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { SignalBacktestRunService } from './SignalBacktestRunService';

describe('SignalBacktestRunService', () => {
    it('deletes generated backtests and their generated signal records', async () => {
        const calls: string[] = [];
        const tx = {
            indicatorInstance: {
                findFirst: async () => null,
            },
            signalLogicTrace: {
                deleteMany: async ({ where }: { where: { backtestRunId: string } }) => {
                    calls.push(`trace:${where.backtestRunId}`);
                },
            },
            signalEvent: {
                deleteMany: async ({ where }: { where: { backtestRunId: string } }) => {
                    calls.push(`event:${where.backtestRunId}`);
                },
            },
            backtestTradeResult: {
                deleteMany: async ({ where }: { where: { backtestRunId: string } }) => {
                    calls.push(`result:${where.backtestRunId}`);
                },
            },
            signal: {
                deleteMany: async ({ where }: { where: { backtestRunId: string } }) => {
                    calls.push(`signal:${where.backtestRunId}`);
                },
            },
            backtestRun: {
                delete: async ({ where }: { where: { id: string } }) => {
                    calls.push(`run:${where.id}`);
                },
            },
        };
        const prisma = {
            backtestRun: {
                findFirst: async () => ({
                    id: 'run-1',
                    name: 'Test Run',
                    status: 'COMPLETED',
                }),
            },
            $transaction: async (callback: (trx: typeof tx) => Promise<void>) => callback(tx),
        } as never;

        const service = new SignalBacktestRunService(prisma);
        const result = await service.deleteGeneratedBacktest('run-1');

        assert.deepEqual(result, { id: 'run-1', name: 'Test Run' });
        assert.deepEqual(calls, [
            'trace:run-1',
            'event:run-1',
            'result:run-1',
            'signal:run-1',
            'run:run-1',
        ]);
    });

    it('rejects deleting generated backtests that are linked to indicators', async () => {
        const prisma = {
            backtestRun: {
                findFirst: async () => ({
                    id: 'run-1',
                    name: 'Protected Run',
                    status: 'COMPLETED',
                }),
            },
            $transaction: async (callback: (trx: {
                indicatorInstance: {
                    findFirst: () => Promise<{ id: string; name: string }>;
                };
            }) => Promise<void>) => callback({
                indicatorInstance: {
                    findFirst: async () => ({
                        id: 'indicator-1',
                        name: 'Live Indicator',
                    }),
                },
            }),
        } as never;

        const service = new SignalBacktestRunService(prisma);

        await assert.rejects(
            () => service.deleteGeneratedBacktest('run-1'),
            /linked to indicator Live Indicator/,
        );
    });

    it('rejects deleting generated backtests that are still pending or running', async () => {
        const prisma = {
            backtestRun: {
                findFirst: async () => ({
                    id: 'run-1',
                    name: 'Active Run',
                    status: 'RUNNING',
                }),
            },
        } as never;

        const service = new SignalBacktestRunService(prisma);

        await assert.rejects(
            () => service.deleteGeneratedBacktest('run-1'),
            /still active/,
        );
    });
});
