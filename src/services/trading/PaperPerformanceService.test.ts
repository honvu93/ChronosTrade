import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { PaperPerformanceService } from './PaperPerformanceService';

function makePrisma({
    accountMode = 'PAPER' as 'PAPER' | 'LIVE',
    intents = [] as any[],
    deals = [] as any[],
} = {}) {
    return {
        tradingAccount: {
            findUnique: async () => ({ id: 'acct-1', ownerUserId: 'user-1', accountMode }),
        },
        tradingTradeIntent: {
            findMany: async () => intents,
        },
        tradingDeal: {
            findMany: async () => deals,
        },
    } as unknown as PrismaClient;
}

const ACTOR = { id: 'user-1', role: 'USER' as const };

describe('PaperPerformanceService', () => {
    it('returns empty performance data when no intents or deals exist', async () => {
        const service = new PaperPerformanceService(makePrisma());
        const result = await service.getPerformance(ACTOR, 'acct-1', {});

        assert.equal(result.totalExecutedIntents, 0);
        assert.equal(result.totalRejectedIntents, 0);
        assert.equal(result.totalRealizedPnl, 0);
        assert.deepEqual(result.equityCurve, []);
        assert.deepEqual(result.signalBreakdown, []);
        assert.deepEqual(result.recentIntents, []);
    });

    it('counts intents by status correctly', async () => {
        const intents = [
            { id: 'i1', status: 'EXECUTED', symbol: 'XAUUSD', side: 'LONG', volume: '0.01', createdAt: new Date(), statusReason: null, binding: { id: 'b1', name: 'Signal A' } },
            { id: 'i2', status: 'EXECUTED', symbol: 'XAUUSD', side: 'LONG', volume: '0.01', createdAt: new Date(), statusReason: null, binding: { id: 'b1', name: 'Signal A' } },
            { id: 'i3', status: 'REJECTED', symbol: 'XAUUSD', side: 'LONG', volume: null, createdAt: new Date(), statusReason: 'Guardrail blocked', binding: { id: 'b1', name: 'Signal A' } },
        ];
        const service = new PaperPerformanceService(makePrisma({ intents }));
        const result = await service.getPerformance(ACTOR, 'acct-1', {});

        assert.equal(result.totalExecutedIntents, 2);
        assert.equal(result.totalRejectedIntents, 1);
        assert.equal(result.totalFailedIntents, 0);
    });

    it('groups intents by signal in breakdown', async () => {
        const intents = [
            { id: 'i1', status: 'EXECUTED', symbol: 'XAUUSD', side: 'LONG', volume: '0.01', createdAt: new Date(), statusReason: null, binding: { id: 'b1', name: 'Signal A' } },
            { id: 'i2', status: 'EXECUTED', symbol: 'XAUUSD', side: 'LONG', volume: '0.01', createdAt: new Date(), statusReason: null, binding: { id: 'b2', name: 'Signal B' } },
            { id: 'i3', status: 'REJECTED', symbol: 'XAUUSD', side: null, volume: null, createdAt: new Date(), statusReason: null, binding: { id: 'b1', name: 'Signal A' } },
        ];
        const service = new PaperPerformanceService(makePrisma({ intents }));
        const result = await service.getPerformance(ACTOR, 'acct-1', {});

        assert.equal(result.signalBreakdown.length, 2);
        const signalA = result.signalBreakdown.find((s) => s.bindingName === 'Signal A');
        assert.ok(signalA);
        assert.equal(signalA!.executedCount, 1);
        assert.equal(signalA!.rejectedCount, 1);
    });

    it('computes cumulative equity curve from deals', async () => {
        const deals = [
            { id: 'd1', executedAt: new Date('2026-04-01'), realizedPnl: '50', symbol: 'XAUUSD', side: 'LONG' },
            { id: 'd2', executedAt: new Date('2026-04-01'), realizedPnl: '-20', symbol: 'XAUUSD', side: 'SHORT' },
            { id: 'd3', executedAt: new Date('2026-04-02'), realizedPnl: '80', symbol: 'XAUUSD', side: 'LONG' },
        ];
        const service = new PaperPerformanceService(makePrisma({ deals }));
        const result = await service.getPerformance(ACTOR, 'acct-1', {});

        assert.equal(result.totalRealizedPnl, 110); // 50 - 20 + 80
        assert.equal(result.equityCurve.length, 2); // 2 distinct days
        assert.equal(result.equityCurve[0].cumulativePnl, 30); // day 1: 50 - 20
        assert.equal(result.equityCurve[1].cumulativePnl, 110); // day 1 + day 2
    });

    it('throws 404 when account not found', async () => {
        const service = new PaperPerformanceService(
            { tradingAccount: { findUnique: async () => null }, tradingTradeIntent: { findMany: async () => [] }, tradingDeal: { findMany: async () => [] } } as unknown as PrismaClient,
        );
        await assert.rejects(
            () => service.getPerformance(ACTOR, 'missing', {}),
            /not found/i,
        );
    });
});
