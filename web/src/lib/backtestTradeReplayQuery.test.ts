import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
    buildBacktestTradeReplaySearchParams,
    parseBacktestTradeReplayMode,
} from "./backtestTradeReplayQuery.js";

describe("backtestTradeReplayQuery", () => {
    it("parses only the supported expanded replay mode", () => {
        assert.equal(parseBacktestTradeReplayMode("expanded"), "expanded");
        assert.equal(parseBacktestTradeReplayMode("drawer"), "drawer");
        assert.equal(parseBacktestTradeReplayMode(null), "drawer");
    });

    it("preserves selected trade and existing filters when toggling replay mode", () => {
        const current = new URLSearchParams("selected=signal-1%3Aexit-1&from=2026-03-01&compare=run-2,run-3");

        const expanded = buildBacktestTradeReplaySearchParams(current, "expanded");
        assert.equal(expanded.get("selected"), "signal-1:exit-1");
        assert.equal(expanded.get("from"), "2026-03-01");
        assert.equal(expanded.get("compare"), "run-2,run-3");
        assert.equal(expanded.get("replay"), "expanded");

        const collapsed = buildBacktestTradeReplaySearchParams(expanded, "drawer");
        assert.equal(collapsed.get("selected"), "signal-1:exit-1");
        assert.equal(collapsed.get("replay"), null);
    });
});
