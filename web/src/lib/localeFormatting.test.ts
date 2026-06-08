import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
    formatCompactNumberForLocale,
    formatDateTimeForLocale,
    formatNumberForLocale,
    formatPercentForLocale,
} from "./localeFormatting.js";

describe("localeFormatting", () => {
    it("formats numbers according to the selected locale", () => {
        assert.equal(formatNumberForLocale(12345.67, "en"), "12,345.67");
        assert.equal(formatNumberForLocale(12345.67, "vi"), "12.345,67");
    });

    it("formats percents and compact numbers according to locale conventions", () => {
        assert.equal(formatPercentForLocale(12.5, "en"), "12.5%");
        assert.equal(formatPercentForLocale(12.5, "vi"), "12,5%");
        assert.equal(formatCompactNumberForLocale(1_250_000, "en"), "1.3M");
        assert.match(formatCompactNumberForLocale(1_250_000, "vi"), /1,3.*Tr/i);
    });

    it("formats dates and falls back cleanly for null or invalid values", () => {
        const english = formatDateTimeForLocale("2026-03-14T01:02:03.000Z", "en", {
            timeZone: "UTC",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        });
        const vietnamese = formatDateTimeForLocale("2026-03-14T01:02:03.000Z", "vi", {
            timeZone: "UTC",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        });

        assert.notEqual(english, vietnamese);
        assert.equal(formatDateTimeForLocale(null, "en"), "n/a");
        assert.equal(formatDateTimeForLocale("nope", "en"), "n/a");
    });
});
