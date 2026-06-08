import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { DateTime } from "luxon";
import {
    getIndicatorHeartbeatThresholdMs,
    isIndicatorHeartbeatStale,
} from "./indicatorHeartbeat.js";

describe("indicatorHeartbeat", () => {
    it("keeps short timeframes on the existing 15 minute floor", () => {
        assert.equal(getIndicatorHeartbeatThresholdMs("1m"), 15 * 60_000);
    });

    it("uses a wider threshold for higher timeframes", () => {
        assert.equal(getIndicatorHeartbeatThresholdMs("1h"), 2 * 60 * 60_000);
        assert.equal(getIndicatorHeartbeatThresholdMs("H4"), 8 * 60 * 60_000);
    });

    it("marks a heartbeat stale only after the timeframe-aware threshold", () => {
        const now = DateTime.fromISO("2026-03-14T12:00:00.000Z");
        assert.equal(isIndicatorHeartbeatStale("2026-03-14T11:00:00.000Z", "1h", now), false);
        assert.equal(isIndicatorHeartbeatStale("2026-03-14T09:30:00.000Z", "1h", now), true);
    });
});
