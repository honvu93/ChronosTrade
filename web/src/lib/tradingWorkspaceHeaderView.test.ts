import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { buildTradingWorkspaceHeaderView } from "./tradingWorkspaceHeaderView.js";

describe("buildTradingWorkspaceHeaderView", () => {
    it("keeps account identity, sync label, and current tab context in the header shell", () => {
        const view = buildTradingWorkspaceHeaderView({
            landingLabel: "Trading",
            marketSymbol: "XAUUSD",
            timeframe: "H1",
            accountLabel: "Primary MT5",
            accountMode: "PAPER",
            syncLabel: "Healthy",
            activeTab: "history",
        });

        assert.deepEqual(view.badges, [
            "Trading",
            "Focus XAUUSD / H1",
            "Account Primary MT5",
            "Paper / Demo",
            "Tab History",
            "Healthy",
        ]);
    });
});
