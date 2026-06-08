import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
    buildDomainStatusView,
    buildFailureClassificationView,
} from "./failureClassificationView.js";
import type { DomainStatus, FailureClassificationSnapshot } from "../types/trading.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(id: string, severity: "critical" | "warning" = "critical") {
    return {
        id,
        domain: "ingestion" as const,
        severity,
        title: `Test title ${id}`,
        detail: "Test detail.",
        detectedAt: "2026-03-01T10:00:00.000Z",
    };
}

function makeSnapshot(
    overrides: Partial<FailureClassificationSnapshot> = {},
): FailureClassificationSnapshot {
    const emptyDomain: DomainStatus = { severity: "ok", items: [] };
    return {
        domains: {
            ingestion: emptyDomain,
            signal:    emptyDomain,
            alert:     emptyDomain,
            trading:   emptyDomain,
        },
        totalCritical: 0,
        totalWarning: 0,
        evaluatedAt: "2026-03-11T08:00:00.000Z",
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// buildDomainStatusView
// ---------------------------------------------------------------------------

describe("buildDomainStatusView", () => {
    it("returns ok tone and empty items for a clean domain", () => {
        const view = buildDomainStatusView("ingestion", { severity: "ok", items: [] });
        assert.equal(view.domain, "ingestion");
        assert.equal(view.domainLabel, "Data Ingestion");
        assert.equal(view.severity, "ok");
        assert.equal(view.tone, "success");
        assert.equal(view.hasItems, false);
        assert.equal(view.itemCount, 0);
    });

    it("returns danger tone for critical severity", () => {
        const view = buildDomainStatusView("signal", {
            severity: "critical",
            items: [makeItem("s1", "critical")],
        });
        assert.equal(view.tone, "danger");
        assert.equal(view.severityLabel, "Critical");
    });

    it("returns caution tone for warning severity", () => {
        const view = buildDomainStatusView("alert", {
            severity: "warning",
            items: [makeItem("a1", "warning")],
        });
        assert.equal(view.tone, "caution");
        assert.equal(view.severityLabel, "Warning");
    });

    it("maps item severity to correct tone and label", () => {
        const critical = makeItem("c1", "critical");
        const warning = makeItem("w1", "warning");
        const view = buildDomainStatusView("trading", {
            severity: "critical",
            items: [critical, warning],
        });
        assert.equal(view.items[0].severityTone, "danger");
        assert.equal(view.items[0].severityLabel, "CRITICAL");
        assert.equal(view.items[1].severityTone, "caution");
        assert.equal(view.items[1].severityLabel, "WARNING");
    });

    it("marks an item inspectable when signal context is present", () => {
        const view = buildDomainStatusView("signal", {
            severity: "warning",
            items: [{
                ...makeItem("inspectable", "warning"),
                signalCode: "songTrap",
                signalVersion: 2,
                backtestRunId: "run-1",
            }],
        });
        assert.equal(view.items[0].isInspectable, true);
        assert.equal(view.items[0].canInvestigate, true);
        assert.equal(view.items[0].signalCode, "songTrap");
        assert.equal(view.items[0].backtestRunId, "run-1");
    });

    it("does not mark live-only failures as discrepancy-investigatable without backtest linkage", () => {
        const view = buildDomainStatusView("trading", {
            severity: "critical",
            items: [{
                ...makeItem("live-only"),
                signalCode: "songTrap",
                signalVersion: 2,
                indicatorInstanceId: "inst-live",
            }],
        });

        assert.equal(view.items[0].isInspectable, true);
        assert.equal(view.items[0].canInvestigate, false);
    });

    it("assigns correct labels for all four domains", () => {
        const domains = ["ingestion", "signal", "alert", "trading"] as const;
        const expectedLabels = [
            "Data Ingestion",
            "Signal Execution",
            "Alert Evaluation",
            "Live Trading",
        ];
        domains.forEach((d, i) => {
            const view = buildDomainStatusView(d, { severity: "ok", items: [] });
            assert.equal(view.domainLabel, expectedLabels[i]);
        });
    });
});

// ---------------------------------------------------------------------------
// buildFailureClassificationView
// ---------------------------------------------------------------------------

describe("buildFailureClassificationView", () => {
    it("returns all-clear state when no failures", () => {
        const view = buildFailureClassificationView(makeSnapshot());
        assert.equal(view.allClear, true);
        assert.equal(view.hasAnyFailure, false);
        assert.equal(view.summaryTone, "success");
        assert.ok(view.headline.includes("healthy"));
        assert.equal(view.totalCritical, 0);
        assert.equal(view.totalWarning, 0);
    });

    it("uses danger tone and correct headline when critical failures exist", () => {
        const snapshot = makeSnapshot({
            totalCritical: 2,
            totalWarning: 1,
            domains: {
                ingestion: { severity: "critical", items: [makeItem("i1", "critical"), makeItem("i2", "critical")] },
                signal:    { severity: "warning",  items: [makeItem("s1", "warning")] },
                alert:     { severity: "ok",       items: [] },
                trading:   { severity: "ok",       items: [] },
            },
        });
        const view = buildFailureClassificationView(snapshot);
        assert.equal(view.summaryTone, "danger");
        assert.ok(view.headline.includes("2 critical"));
        assert.equal(view.hasAnyFailure, true);
        assert.equal(view.allClear, false);
    });

    it("uses caution tone when only warnings (no critical)", () => {
        const snapshot = makeSnapshot({
            totalCritical: 0,
            totalWarning: 3,
            domains: {
                ingestion: { severity: "warning", items: [makeItem("i1", "warning")] },
                signal:    { severity: "ok",      items: [] },
                alert:     { severity: "warning", items: [makeItem("a1", "warning"), makeItem("a2", "warning")] },
                trading:   { severity: "ok",      items: [] },
            },
        });
        const view = buildFailureClassificationView(snapshot);
        assert.equal(view.summaryTone, "caution");
        assert.ok(view.headline.includes("3 warning"));
        assert.equal(view.totalWarning, 3);
    });

    it("returns exactly four domain views in fixed order", () => {
        const view = buildFailureClassificationView(makeSnapshot());
        assert.equal(view.domains.length, 4);
        assert.equal(view.domains[0].domain, "ingestion");
        assert.equal(view.domains[1].domain, "signal");
        assert.equal(view.domains[2].domain, "alert");
        assert.equal(view.domains[3].domain, "trading");
    });

    it("domains are separate — one domain critical does not affect another", () => {
        const snapshot = makeSnapshot({
            totalCritical: 1,
            domains: {
                ingestion: { severity: "critical", items: [makeItem("i1", "critical")] },
                signal:    { severity: "ok",       items: [] },
                alert:     { severity: "ok",       items: [] },
                trading:   { severity: "ok",       items: [] },
            },
        });
        const view = buildFailureClassificationView(snapshot);
        assert.equal(view.domains[0].tone, "danger");
        assert.equal(view.domains[1].tone, "success");
        assert.equal(view.domains[2].tone, "success");
        assert.equal(view.domains[3].tone, "success");
    });
});
