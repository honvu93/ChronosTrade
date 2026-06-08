import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
    buildTradingWorkspaceHistoryRequest,
    DEFAULT_FILTERED_HISTORY_LIMIT,
    normalizeTradingWorkspaceHistoryQuery,
    resolveTradingWorkspaceHistoryReset,
} from "./tradingWorkspaceHistory.js";

describe("buildTradingWorkspaceHistoryRequest", () => {
    it("returns null when no history filter is active", () => {
        assert.equal(buildTradingWorkspaceHistoryRequest({}), null);
        assert.equal(normalizeTradingWorkspaceHistoryQuery({}), null);
    });

    it("adds the default bounded limit to ranged history queries", () => {
        assert.deepEqual(
            buildTradingWorkspaceHistoryRequest({
                from: "2026-03-01T00:00:00.000Z",
                to: "2026-03-05T23:59:59.999Z",
            }),
            {
                from: "2026-03-01T00:00:00.000Z",
                to: "2026-03-05T23:59:59.999Z",
                limit: DEFAULT_FILTERED_HISTORY_LIMIT,
            },
        );
    });

    it("keeps an explicit caller limit when one is supplied", () => {
        assert.deepEqual(
            buildTradingWorkspaceHistoryRequest({
                from: "2026-03-01T00:00:00.000Z",
                limit: 25,
            }),
            {
                from: "2026-03-01T00:00:00.000Z",
                limit: 25,
            },
        );
    });
});

describe("resolveTradingWorkspaceHistoryReset", () => {
    it("restores the current workspace snapshot when filters are cleared in-place", () => {
        const deals = [{ id: "deal-1" }] as never[];
        assert.deepEqual(resolveTradingWorkspaceHistoryReset(deals), deals);
    });

    it("clears history outright when the active account changes", () => {
        const deals = [{ id: "deal-1" }] as never[];
        assert.deepEqual(
            resolveTradingWorkspaceHistoryReset(deals, { clear: true }),
            [],
        );
    });
});
