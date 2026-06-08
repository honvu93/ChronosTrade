import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
    classifyFreshness,
    getTimeframeMs,
} from "./freshnessUtils.js";

describe("getTimeframeMs", () => {
    it("returns the expected duration for extended chart timeframes", () => {
        assert.equal(getTimeframeMs("2h"), 2 * 60 * 60_000);
        assert.equal(getTimeframeMs("3h"), 3 * 60 * 60_000);
        assert.equal(getTimeframeMs("12h"), 12 * 60 * 60_000);
        assert.equal(getTimeframeMs("1M"), 30 * 24 * 60 * 60_000);
    });
});

describe("classifyFreshness", () => {
    it("does not treat monthly candles as one-minute data", () => {
        const now = new Date("2026-03-13T00:00:00.000Z");
        const latestMonthly = new Date("2026-03-01T00:00:00.000Z").toISOString();

        assert.equal(classifyFreshness(latestMonthly, "1M", now), "fresh");
    });

    it("classifies extended intraday candles using their actual cadence", () => {
        const now = new Date("2026-03-13T12:00:00.000Z");
        const latestThreeHour = new Date("2026-03-13T07:00:00.000Z").toISOString();

        assert.equal(classifyFreshness(latestThreeHour, "3h", now), "fresh");
    });
});
