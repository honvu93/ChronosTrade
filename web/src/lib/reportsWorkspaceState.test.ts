import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
    buildReportsWorkspaceViewState,
    resolveReportsWorkspaceActiveRunId,
    resolveReportsWorkspaceCatalogRun,
} from "./reportsWorkspaceState.js";
import type { EngineRun } from "@/types/engine.js";

const runCatalog: EngineRun[] = [
    {
        id: "run-1",
        name: "Run 1",
        symbol: "XAUUSD",
        timeframe: "1h",
        side: null,
        strategyId: null,
        strategyName: null,
        strategyCode: null,
        initialEquity: 10000,
        riskPercent: 1,
        startedAt: "2026-03-01T00:00:00.000Z",
        finishedAt: "2026-03-10T00:00:00.000Z",
        createdAt: "2026-03-11T00:00:00.000Z",
    },
    {
        id: "run-2",
        name: "Run 2",
        symbol: "BTCUSD",
        timeframe: "4h",
        side: null,
        strategyId: null,
        strategyName: null,
        strategyCode: null,
        initialEquity: 10000,
        riskPercent: 1,
        startedAt: "2026-03-05T00:00:00.000Z",
        finishedAt: "2026-03-14T00:00:00.000Z",
        createdAt: "2026-03-15T00:00:00.000Z",
    },
];

describe("reportsWorkspaceState", () => {
    it("keeps the requested run id active even before the catalog contains that run", () => {
        assert.equal(resolveReportsWorkspaceActiveRunId({
            runs: [],
            requestedRunId: "run-archived",
            selectedRunId: "",
        }), "run-archived");
    });

    it("resolves the requested catalog run when it is present in the fetched list", () => {
        const run = resolveReportsWorkspaceCatalogRun({
            runs: runCatalog,
            requestedRunId: "run-2",
            selectedRunId: "",
        });

        assert.equal(run?.id, "run-2");
    });

    it("does not fall back to an unrelated recent run while a requested run is still hydrating", () => {
        const run = resolveReportsWorkspaceCatalogRun({
            runs: runCatalog,
            requestedRunId: "run-archived",
            selectedRunId: "run-1",
        });

        assert.equal(run, null);
    });

    it("keeps the leaderboard shell available when the run catalog fails", () => {
        const state = buildReportsWorkspaceViewState({
            catalogError: "Failed to load run catalog",
            isCatalogLoading: false,
            activeRunId: "",
        });

        assert.equal(state.showCatalogErrorBanner, true);
        assert.equal(state.showReportSelectionEmpty, false);
    });
});
