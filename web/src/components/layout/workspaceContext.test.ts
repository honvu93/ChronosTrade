import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { getTranslationCatalog } from "@/lib/translations.js";
import {
    AVAILABLE_TIMEFRAMES,
    getChartWorkspaceContext,
    getTimeframeLabel,
} from "./workspaceContext.js";

describe("workspaceContext timeframe catalog", () => {
    it("includes the extended chart timeframe options in canonical order", () => {
        assert.deepEqual(
            AVAILABLE_TIMEFRAMES,
            ["1m", "5m", "15m", "30m", "1h", "2h", "3h", "4h", "12h", "1d", "1w", "1M"],
        );
    });

    it("returns readable labels for the extended timeframes", () => {
        const copy = getTranslationCatalog("vi");

        assert.equal(getTimeframeLabel("2h"), "2 Hours");
        assert.equal(getTimeframeLabel("3h"), "3 Hours");
        assert.equal(getTimeframeLabel("12h"), "12 Hours");
        assert.equal(getTimeframeLabel("1M"), "1 Month");
        assert.equal(getTimeframeLabel("1M", "vi"), copy.workspace.timeframeLabels["1M"]);
    });
});

describe("getChartWorkspaceContext", () => {
    it("uses the extended timeframe label in the context summary", () => {
        assert.equal(
            getChartWorkspaceContext({ symbol: "BTCUSD", timeframe: "1M" }).contextLabel,
            "BTCUSD / 1 Month",
        );
    });

    it("keeps the same market context while translating labels", () => {
        const copy = getTranslationCatalog("vi");
        const context = getChartWorkspaceContext({ symbol: "BTCUSD", timeframe: "1M" }, "vi");

        assert.equal(context.symbol, "BTCUSD");
        assert.equal(context.timeframe, "1M");
        assert.equal(context.workspaceLabel, copy.workspace.chartWorkspace);
        assert.equal(context.contextLabel, `BTCUSD / ${copy.workspace.timeframeLabels["1M"]}`);
    });
});
