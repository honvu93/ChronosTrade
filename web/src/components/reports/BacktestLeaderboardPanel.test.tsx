import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BacktestLeaderboardResultsTable } from "./BacktestLeaderboardPanel.js";
import { defaultBacktestLeaderboardQueryState } from "@/lib/backtestLeaderboardQuery.js";
import type { BacktestLeaderboardResponse } from "@/types/engine.js";

const leaderboardResponse: BacktestLeaderboardResponse = {
    rows: [
        {
            rank: 21,
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
        },
    ],
    pagination: {
        page: 2,
        pageSize: 20,
        totalRows: 71,
        totalPages: 4,
    },
    summary: {
        totalRows: 71,
        totalSignals: 19,
        constructiveRows: 11,
        weakerRows: 40,
        suspiciousRows: 20,
    },
    mode: "BEST_PER_SIGNAL",
    sort: "rank",
    order: "desc",
};

describe("BacktestLeaderboardResultsTable", () => {
    it("renders loading and error states without needing the hooked panel shell", () => {
        const markup = renderToStaticMarkup(
            <BacktestLeaderboardResultsTable
                leaderboard={null}
                isLoading
                loadError="Leaderboard endpoint unavailable"
                queryState={defaultBacktestLeaderboardQueryState}
                currentParams={new URLSearchParams()}
                pathname="/reports"
                selectedRunId=""
                onReplaceSearch={() => undefined}
                deletingRunId={null}
                activatingRunId={null}
                onDeleteRun={() => undefined}
                onActivateRun={() => undefined}
            />,
        );

        assert.match(markup, /Building generated backtest ranking/i);
        assert.match(markup, /Leaderboard endpoint unavailable/i);
    });

    it("renders row actions and pagination from the leaderboard response", () => {
        const markup = renderToStaticMarkup(
            <BacktestLeaderboardResultsTable
                leaderboard={leaderboardResponse}
                isLoading={false}
                loadError={null}
                queryState={defaultBacktestLeaderboardQueryState}
                currentParams={new URLSearchParams("lbSignal=songTrap")}
                pathname="/reports"
                selectedRunId="baseline-run"
                onReplaceSearch={() => undefined}
                deletingRunId={null}
                activatingRunId={null}
                onDeleteRun={() => undefined}
                onActivateRun={() => undefined}
            />,
        );

        assert.match(markup, /Visible ranking/i);
        assert.match(markup, /Showing 21-40 of 71 rows/i);
        assert.match(markup, /Page 2 \/ 4/i);
        assert.match(markup, /href=\"\/reports\?lbSignal=songTrap&amp;backtestRunId=run-1\"/i);
        assert.match(markup, /href=\"\/signals\/backtests\/baseline-run\?compare=run-1\"/i);
        assert.match(markup, /Constructive/i);
        assert.match(markup, /Delete/i);
        assert.match(markup, /Activate/i);
    });
});
