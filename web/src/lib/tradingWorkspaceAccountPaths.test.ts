import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { buildScopedTradingWorkspaceAccountPath } from "./tradingWorkspaceAccountPaths";

describe("buildScopedTradingWorkspaceAccountPath", () => {
    it("appends the suffix before the scoped userId query parameter", () => {
        const result = buildScopedTradingWorkspaceAccountPath("acct-1", "/workspace", "user-1");
        assert.equal(result, "/api/trading/accounts/acct-1/workspace?userId=user-1");
    });

    it("returns the plain account path when no owner scope is supplied", () => {
        const result = buildScopedTradingWorkspaceAccountPath("acct-1", "/commands");
        assert.equal(result, "/api/trading/accounts/acct-1/commands");
    });
});
