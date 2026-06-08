import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { buildBacktestLeaderboardRowView } from "./backtestLeaderboardView.js";
import type { BacktestLeaderboardRow } from "@/types/engine.js";

function makeRow(overrides: Partial<BacktestLeaderboardRow> = {}): BacktestLeaderboardRow {
    return {
        rank: 1,
        runId: "run-1",
        runName: "Song Trap Validation",
        signalCode: "songTrap",
        signalVersion: 3,
        signalKey: "songTrap@3",
        signalLabel: "songTrap@3",
        symbol: "XAUUSD",
        timeframe: "1h",
        status: "COMPLETED",
        startedAt: "2026-03-01T00:00:00.000Z",
        finishedAt: "2026-03-10T23:59:59.999Z",
        createdAt: "2026-03-11T00:00:00.000Z",
        signalCount: 5,
        totalTrades: 8,
        closedTrades: 8,
        openTrades: 0,
        wins: 6,
        losses: 2,
        winRate: 75,
        profitFactor: 2.4,
        expectancy: 0.8,
        netR: 6.4,
        netUsd: 1280,
        maxDrawdownPct: -4.5,
        notes: null,
        cautionState: "constructive",
        cautionFlags: [],
        ...overrides,
    };
}

describe("buildBacktestLeaderboardRowView", () => {
    it("builds report and comparison links while preserving leaderboard query context", () => {
        const view = buildBacktestLeaderboardRowView(makeRow(), {
            reportBasePath: "/reports",
            reportSearchParams: new URLSearchParams("lbSignal=songTrap&lbSort=netR&backtestRunId=baseline-run"),
            selectedRunId: "baseline-run",
        });

        assert.equal(view.signalIdentity, "songTrap@3");
        assert.equal(view.windowLabel, "2026-03-01 to 2026-03-10");
        assert.equal(view.reportHref, "/reports?lbSignal=songTrap&lbSort=netR&backtestRunId=run-1");
        assert.equal(view.detailHref, "/signals/backtests/run-1");
        assert.equal(view.compareHref, "/signals/backtests/baseline-run?compare=run-1");
    });

    it("maps weaker or suspicious rows to explicit tones and disables compare on the selected row", () => {
        const view = buildBacktestLeaderboardRowView(
            makeRow({
                runId: "run-2",
                status: "FAILED",
                cautionState: "suspicious",
                cautionFlags: ["Run status is failed."],
            }),
            {
                reportBasePath: "/reports",
                reportSearchParams: new URLSearchParams("lbStatus=FAILED"),
                selectedRunId: "run-2",
            },
        );

        assert.equal(view.cautionLabel, "Suspicious");
        assert.match(view.cautionTone, /price-down/i);
        assert.match(view.statusTone, /price-down/i);
        assert.equal(view.compareHref, null);
    });
});
