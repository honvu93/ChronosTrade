import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
    buildGeneratedBacktestSymbolOptions,
    buildGeneratedBacktestTimeframeOptions,
} from "./generatedBacktestFormOptions.js";

describe("buildGeneratedBacktestSymbolOptions", () => {
    it("keeps inherited and current symbols even when the API list is empty", () => {
        assert.deepEqual(
            buildGeneratedBacktestSymbolOptions({
                availableSymbols: [],
                currentSymbol: "xauusd",
                inheritedSymbol: "BTCUSD",
            }),
            ["BTCUSD", "xauusd"],
        );
    });

    it("deduplicates and normalizes API symbols", () => {
        assert.deepEqual(
            buildGeneratedBacktestSymbolOptions({
                availableSymbols: ["btcusdc", "XAUUSD", "btcusdc", "EURUSD"],
                currentSymbol: "XAUUSD",
                inheritedSymbol: null,
            }),
            ["XAUUSD", "btcusdc", "EURUSD"],
        );
    });
});

describe("buildGeneratedBacktestTimeframeOptions", () => {
    it("starts with inherited and current timeframe before the shared defaults", () => {
        assert.deepEqual(
            buildGeneratedBacktestTimeframeOptions({
                currentTimeframe: "1h",
                inheritedTimeframe: "4h",
            }).slice(0, 4),
            ["4h", "1h", "1m", "5m"],
        );
    });

    it("preserves non-standard current timeframe values", () => {
        assert.equal(
            buildGeneratedBacktestTimeframeOptions({
                currentTimeframe: "2h",
                inheritedTimeframe: null,
            })[0],
            "2h",
        );
    });
});
