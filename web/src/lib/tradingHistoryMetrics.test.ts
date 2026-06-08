import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { buildTradingHistoryMetricsView } from "./tradingHistoryMetrics.js";

describe("buildTradingHistoryMetricsView", () => {
    it("summarizes win rate, pnl, and volume from the mirrored deals in view", () => {
        const summary = buildTradingHistoryMetricsView({
            hasActiveFilter: true,
            rangeSummary: "2026-03-01 to 2026-03-10 UTC",
            deals: [
                {
                    id: "deal-1",
                    brokerDealId: "1",
                    brokerOrderId: null,
                    brokerPositionId: null,
                    symbol: "XAUUSD",
                    side: "LONG",
                    volume: 0.2,
                    price: 2900,
                    commission: 0,
                    swap: 0,
                    fee: 0,
                    realizedPnl: 120,
                    executedAt: "2026-03-01T00:00:00.000Z",
                    comment: null,
                },
                {
                    id: "deal-2",
                    brokerDealId: "2",
                    brokerOrderId: null,
                    brokerPositionId: null,
                    symbol: "XAUUSD",
                    side: "SHORT",
                    volume: 0.1,
                    price: 2895,
                    commission: 0,
                    swap: 0,
                    fee: 0,
                    realizedPnl: -35,
                    executedAt: "2026-03-02T00:00:00.000Z",
                    comment: null,
                },
                {
                    id: "deal-3",
                    brokerDealId: "3",
                    brokerOrderId: null,
                    brokerPositionId: null,
                    symbol: "XAUUSD",
                    side: "LONG",
                    volume: 0.3,
                    price: 2910,
                    commission: 0,
                    swap: 0,
                    fee: 0,
                    realizedPnl: 0,
                    executedAt: "2026-03-03T00:00:00.000Z",
                    comment: null,
                },
            ],
        });

        assert.equal(summary.rangeLabel, "2026-03-01 to 2026-03-10 UTC");
        assert.equal(summary.shownDeals, 3);
        assert.equal(summary.wins, 1);
        assert.equal(summary.losses, 1);
        assert.equal(summary.flat, 1);
        assert.equal(summary.winRate, 50);
        assert.equal(summary.netPnl, 85);
        assert.equal(summary.totalVolume, 0.6);
        assert.equal(summary.pnlAccent, "up");
    });

    it("uses the default snapshot label and a neutral win rate when no decisive deals exist", () => {
        const summary = buildTradingHistoryMetricsView({
            hasActiveFilter: false,
            rangeSummary: null,
            deals: [
                {
                    id: "deal-1",
                    brokerDealId: "1",
                    brokerOrderId: null,
                    brokerPositionId: null,
                    symbol: "BTCUSD",
                    side: "LONG",
                    volume: 0.05,
                    price: 80000,
                    commission: 0,
                    swap: 0,
                    fee: 0,
                    realizedPnl: 0,
                    executedAt: "2026-03-01T00:00:00.000Z",
                    comment: null,
                },
            ],
        });

        assert.equal(summary.rangeLabel, "Default bounded snapshot");
        assert.equal(summary.winRate, null);
        assert.equal(summary.pnlAccent, "neutral");
        assert.match(summary.sourceLabel, /default bounded mirrored-history snapshot/i);
    });
});
