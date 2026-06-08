import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { buildSignalVersionContextView } from "./signalVersionContextView.js";
import type { SignalVersionSnapshot } from "../types/trading.js";

const baseSnapshot: SignalVersionSnapshot = {
    signalCode: "songTrap",
    signalVersion: 2,
    signalName: "Song Trap",
    category: "Breakout",
    description: "A momentum breakout signal.",
    parameterSchema: {
        fields: [
            { key: "lookback", type: "number", description: "Lookback period in bars." },
            { key: "threshold", type: "number", description: "Entry threshold." },
        ],
    },
    indicatorSchema: null,
    eventSchema: null,
    composedBlocks: null,
    isComposed: false,
    createdBy: "HVV",
    createdAt: "2026-01-15T10:00:00.000Z",
    originKind: "indicator-instance",
    originRecordId: "inst-123",
    originRecordLabel: "Song Trap Live Runtime",
    originStatus: "FAILED",
    originSymbol: "XAUUSD",
    originTimeframe: "M15",
    parameterValuesJson: { lookback: 9, threshold: 1.5 },
    linkedBacktestRunId: "run-abc-123",
    linkedBacktestName: "Song Trap XAUUSD H1",
    linkedBacktestStatus: "COMPLETED",
    linkedBacktestSymbol: "XAUUSD",
    linkedBacktestTimeframe: "H1",
    executionConfigJson: { orderTiming: "OPEN", stopLoss: { mode: "FIXED", value: 10 } },
    accountContext: {
        readinessState: "ready",
        accountId: "acct-1",
        accountLabel: "Pilot MT5",
        mt5Login: "10001",
        mt5Server: "Demo-Server",
    },
};

describe("buildSignalVersionContextView", () => {
    it("populates header fields correctly", () => {
        const view = buildSignalVersionContextView(baseSnapshot);
        assert.equal(view.header.codeLabel, "songTrap@v2");
        assert.equal(view.header.title, "Song Trap");
        assert.equal(view.header.category, "Breakout");
        assert.equal(view.header.createdBy, "HVV");
        assert.equal(view.header.composedLabel, null);
    });

    it("builds the origin context for exact investigation records", () => {
        const view = buildSignalVersionContextView(baseSnapshot);
        assert.equal(view.origin.kindLabel, "Live Indicator Runtime");
        assert.equal(view.origin.recordId, "inst-123");
        assert.equal(view.origin.recordLabel, "Song Trap Live Runtime");
        assert.equal(view.origin.statusLabel, "FAILED");
        assert.equal(view.origin.statusTone, "danger");
        assert.equal(view.origin.context, "XAUUSD / M15");
    });

    it("surfaces account context when live runtime is linked to an MT5 account", () => {
        const view = buildSignalVersionContextView(baseSnapshot);
        assert.equal(view.origin.hasAccountContext, true);
        assert.equal(view.origin.accountLabel, "10001 @ Demo-Server");
        assert.equal(view.origin.accountStateLabel, "Account Ready");
    });

    it("extracts parameter schema fields and parameter values", () => {
        const view = buildSignalVersionContextView(baseSnapshot);
        assert.equal(view.hasParams, true);
        assert.equal(view.paramFields.length, 2);
        assert.equal(view.paramFields[0].key, "lookback");
        assert.equal(view.hasParameterValues, true);
        assert.ok(view.parameterValuesJson.includes("threshold"));
    });

    it("shows linked backtest when present", () => {
        const view = buildSignalVersionContextView(baseSnapshot);
        assert.equal(view.backtest.hasLinkedRun, true);
        assert.equal(view.backtest.runId, "run-abc-123");
        assert.equal(view.backtest.runName, "Song Trap XAUUSD H1");
        assert.equal(view.backtest.statusLabel, "COMPLETED");
        assert.equal(view.backtest.statusTone, "success");
        assert.equal(view.backtest.context, "XAUUSD / H1");
    });

    it("marks composed signal when isComposed is true", () => {
        const view = buildSignalVersionContextView({
            ...baseSnapshot,
            isComposed: true,
            composedBlocks: { matchMode: "ALL", blocks: [] },
        });
        assert.equal(view.header.composedLabel, "Composed Signal");
        assert.equal(view.hasComposedBlocks, true);
        assert.ok(view.composedBlocksJson.includes("matchMode"));
    });

    it("uses neutral fallbacks for missing optional fields", () => {
        const view = buildSignalVersionContextView({
            ...baseSnapshot,
            category: null,
            description: null,
            createdBy: null,
            originStatus: null,
            originRecordLabel: null,
            originRecordId: null,
            originSymbol: null,
            originTimeframe: null,
            parameterValuesJson: null,
            linkedBacktestRunId: null,
            linkedBacktestName: null,
            linkedBacktestStatus: null,
            linkedBacktestSymbol: null,
            linkedBacktestTimeframe: null,
            executionConfigJson: null,
            accountContext: null,
        });
        assert.equal(view.header.category, "Uncategorized");
        assert.equal(view.header.description, "No description provided.");
        assert.equal(view.header.createdBy, "Unknown");
        assert.equal(view.origin.statusLabel, "N/A");
        assert.equal(view.origin.recordLabel, "Definition context");
        assert.equal(view.origin.context, "");
        assert.equal(view.origin.hasAccountContext, false);
        assert.equal(view.hasParameterValues, false);
        assert.equal(view.backtest.hasLinkedRun, false);
        assert.equal(view.hasExecutionConfig, false);
    });
});
