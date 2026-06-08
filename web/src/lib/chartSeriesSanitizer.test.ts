import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { sanitizeChartSeries } from "./chartSeriesSanitizer.js";

describe("sanitizeChartSeries", () => {
    it("sorts points by time and removes duplicate timestamps by keeping the latest point", () => {
        const sanitized = sanitizeChartSeries([
            { time: 30, value: "c" },
            { time: 10, value: "a" },
            { time: 20, value: "b-old" },
            { time: 20, value: "b-new" },
        ]);

        assert.deepEqual(sanitized, [
            { time: 10, value: "a" },
            { time: 20, value: "b-new" },
            { time: 30, value: "c" },
        ]);
    });
});
