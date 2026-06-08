import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
    buildBacktestLeaderboardApiParams,
    buildBacktestLeaderboardQuery,
    defaultBacktestLeaderboardQueryState,
    parseBacktestLeaderboardQuery,
} from "./backtestLeaderboardQuery.js";

describe("backtestLeaderboardQuery", () => {
    it("parses leaderboard search params with sane fallbacks", () => {
        const state = parseBacktestLeaderboardQuery(new URLSearchParams({
            lbMode: "ALL_RUNS",
            lbSignal: "songTrap",
            lbSymbol: "xauusd",
            lbTimeframe: "1h",
            lbStatus: "FAILED",
            lbMinClosed: "7",
            lbFrom: "2026-03-01",
            lbTo: "2026-03-20",
            lbPage: "3",
            lbPageSize: "50",
            lbSort: "netR",
            lbOrder: "asc",
        }));

        assert.deepEqual(state, {
            mode: "ALL_RUNS",
            signalCode: "songTrap",
            symbol: "xauusd",
            timeframe: "1h",
            status: "FAILED",
            minClosedTrades: "7",
            fromDate: "2026-03-01",
            toDate: "2026-03-20",
            page: 3,
            pageSize: 50,
            sort: "netR",
            order: "asc",
        });
    });

    it("builds URL params while preserving unrelated report params", () => {
        const next = buildBacktestLeaderboardQuery(
            defaultBacktestLeaderboardQueryState,
            {
                signalCode: "songTrap",
                symbol: "xauusd",
                page: 2,
                sort: "netR",
            },
            new URLSearchParams("backtestRunId=run-1&signalId=signal-9"),
        );

        assert.equal(next.get("backtestRunId"), "run-1");
        assert.equal(next.get("signalId"), "signal-9");
        assert.equal(next.get("lbSignal"), "songTrap");
        assert.equal(next.get("lbSymbol"), "XAUUSD");
        assert.equal(next.get("lbPage"), "2");
        assert.equal(next.get("lbSort"), "netR");
        assert.equal(next.has("lbMode"), false);
    });

    it("builds backend API params from the current leaderboard query state", () => {
        const params = buildBacktestLeaderboardApiParams({
            ...defaultBacktestLeaderboardQueryState,
            signalCode: "songTrap",
            symbol: "xauusd",
            timeframe: "1h",
            status: "COMPLETED",
            fromDate: "2026-03-01",
            toDate: "2026-03-14",
            page: 2,
            sort: "netR",
        });

        assert.equal(params.get("mode"), "BEST_PER_SIGNAL");
        assert.equal(params.get("page"), "2");
        assert.equal(params.get("signalCode"), "songTrap");
        assert.equal(params.get("symbol"), "XAUUSD");
        assert.equal(params.get("timeframe"), "1h");
        assert.equal(params.get("status"), "COMPLETED");
        assert.equal(params.get("from"), "2026-03-01T00:00:00.000Z");
        assert.equal(params.get("to"), "2026-03-14T23:59:59.999Z");
    });
});
