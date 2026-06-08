import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
    buildUtcDayRangeSummary,
    isUtcDayRangeInvalid,
    toUtcRangeEnd,
    toUtcRangeStart,
} from "./utcDateRange.js";

describe("utcDateRange", () => {
    it("builds UTC day boundaries for mirrored history filters", () => {
        assert.equal(toUtcRangeStart("2026-03-01"), "2026-03-01T00:00:00.000Z");
        assert.equal(toUtcRangeEnd("2026-03-01"), "2026-03-01T23:59:59.999Z");
    });

    it("detects invalid reversed day ranges", () => {
        assert.equal(isUtcDayRangeInvalid("2026-03-05", "2026-03-01"), true);
        assert.equal(isUtcDayRangeInvalid("2026-03-01", "2026-03-05"), false);
    });

    it("summarizes the active UTC date range for the operator", () => {
        assert.equal(buildUtcDayRangeSummary("2026-03-01", "2026-03-05"), "UTC 2026-03-01 to 2026-03-05");
        assert.equal(buildUtcDayRangeSummary("", ""), null);
    });
});
