import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { buildTradingDiagnosisView } from "./tradingDiagnosisView.js";
import type { TradingDiagnosisSnapshot } from "../types/trading.js";

function makeSnapshot(): TradingDiagnosisSnapshot {
    return {
        signalCode: "songTrap",
        signalVersion: 3,
        signalName: "Song Trap",
        investigationKind: "reported-issue",
        primaryCategory: "broker-execution",
        categories: [{
            category: "broker-execution",
            label: "Broker Execution",
            score: 140,
            confidence: "high",
            severity: "critical",
            summary: "Broker rejection is the strongest linked cause.",
            evidence: [{
                id: "account:bridge-unreachable",
                source: "account-readiness",
                severity: "critical",
                title: "Broker execution readiness is degraded.",
                detail: "Bridge is not reachable on port 5000.",
                linkedRecordLabel: "Deployment inst-1",
                linkedRecordId: "inst-1",
                sectionKey: "account",
                href: null,
            }, {
                id: "eligibility:excessive_drawdown",
                source: "eligibility",
                severity: "warning",
                title: "Validation gate: excessive_drawdown",
                detail: "Maximum drawdown is -18.0%, exceeding the hard stop.",
                linkedRecordLabel: "Backtest run-1",
                linkedRecordId: "run-1",
                sectionKey: "backtest",
                href: "/reports?backtestRunId=run-1&signalId=signal-1",
            }],
        }, {
            category: "signal-logic",
            label: "Signal Logic",
            score: 45,
            confidence: "low",
            severity: "warning",
            summary: "A smaller set of logic evidence exists.",
            evidence: [],
        }, {
            category: "risk-settings",
            label: "Risk Settings",
            score: 0,
            confidence: "low",
            severity: "info",
            summary: "No linked investigation evidence currently points to Risk Settings.",
            evidence: [],
        }, {
            category: "data-quality",
            label: "Data Quality",
            score: 0,
            confidence: "low",
            severity: "info",
            summary: "No linked investigation evidence currently points to Data Quality.",
            evidence: [],
        }],
        linkedRecords: {
            signalKey: "songTrap@v3",
            backtestRunId: "run-1",
            tradeRecordId: "trade-1",
            signalId: "signal-1",
            primaryIndicatorInstanceId: "inst-1",
            reportPath: "/reports?backtestRunId=run-1&signalId=signal-1",
        },
        latestOutcome: {
            id: "diag-1",
            signalCode: "songTrap",
            signalVersion: 3,
            rootCauseCategory: "broker-execution",
            outcome: "escalated",
            backtestRunId: "run-1",
            indicatorInstanceId: "inst-1",
            tradeRecordId: "trade-1",
            summary: "Escalated after repeated broker rejection evidence.",
            decidedAt: "2026-03-11T09:00:00.000Z",
            decisionContext: {
                selectedCategory: "broker-execution",
                selectedOutcome: "escalated",
                investigationKind: "reported-issue",
                linkedRecords: {
                    signalKey: "songTrap@v3",
                    backtestRunId: "run-1",
                    tradeRecordId: "trade-1",
                    signalId: "signal-1",
                    primaryIndicatorInstanceId: "inst-1",
                    reportPath: "/reports?backtestRunId=run-1&signalId=signal-1",
                },
                score: 140,
                confidence: "high",
                evidence: [{
                    id: "account:bridge-unreachable",
                    source: "account-readiness",
                    severity: "critical",
                    title: "Broker execution readiness is degraded.",
                    detail: "Bridge is not reachable on port 5000.",
                    linkedRecordLabel: "Deployment inst-1",
                    linkedRecordId: "inst-1",
                    sectionKey: "account",
                    href: null,
                }],
            },
        },
        history: [{
            id: "diag-1",
            signalCode: "songTrap",
            signalVersion: 3,
            rootCauseCategory: "broker-execution",
            outcome: "escalated",
            backtestRunId: "run-1",
            indicatorInstanceId: "inst-1",
            tradeRecordId: "trade-1",
            summary: "Escalated after repeated broker rejection evidence.",
            decidedAt: "2026-03-11T09:00:00.000Z",
            decisionContext: {
                selectedCategory: "broker-execution",
                selectedOutcome: "escalated",
                investigationKind: "reported-issue",
                linkedRecords: {
                    signalKey: "songTrap@v3",
                    backtestRunId: "run-1",
                    tradeRecordId: "trade-1",
                    signalId: "signal-1",
                    primaryIndicatorInstanceId: "inst-1",
                    reportPath: "/reports?backtestRunId=run-1&signalId=signal-1",
                },
                score: 140,
                confidence: "high",
                evidence: [{
                    id: "account:bridge-unreachable",
                    source: "account-readiness",
                    severity: "critical",
                    title: "Broker execution readiness is degraded.",
                    detail: "Bridge is not reachable on port 5000.",
                    linkedRecordLabel: "Deployment inst-1",
                    linkedRecordId: "inst-1",
                    sectionKey: "account",
                    href: null,
                }],
            },
        }],
        evaluatedAt: "2026-03-11T09:00:00.000Z",
    };
}

describe("buildTradingDiagnosisView", () => {
    it("builds the primary diagnosis summary and evidence labels", () => {
        const view = buildTradingDiagnosisView(makeSnapshot());

        assert.equal(view.title, "Song Trap");
        assert.equal(view.signalKey, "songTrap@v3");
        assert.equal(view.primaryLabel, "Broker Execution");
        assert.equal(view.primaryTone, "danger");
        assert.equal(view.candidates[0].confidenceLabel, "High confidence");
        assert.equal(view.candidates[0].evidence[0].sourceLabel, "Broker Readiness");
        assert.equal(view.candidates[0].evidence[0].sectionLabel, "Account");
        assert.equal(view.candidates[0].evidence[0].targetId, "trading-investigation-evidence");
        assert.equal(view.candidates[0].evidence[1].targetId, "trading-discrepancy-backtest");
        assert.equal(view.candidates[0].evidence[1].href, "/reports?backtestRunId=run-1&signalId=signal-1");
        assert.equal(view.candidates[0].evidence[1].hrefLabel, "Open supporting report");
    });

    it("formats investigation outcome history for operator review", () => {
        const view = buildTradingDiagnosisView(makeSnapshot());

        assert.equal(view.history.length, 1);
        assert.equal(view.history[0].outcomeLabel, "Escalated");
        assert.equal(view.history[0].outcomeTone, "danger");
        assert.equal(view.history[0].categoryLabel, "Broker Execution");
        assert.equal(view.history[0].investigationLabel, "Reported Issue");
        assert.equal(view.history[0].scoreLabel, "140 evidence score");
        assert.equal(view.history[0].confidenceLabel, "High confidence");
        assert.equal(view.history[0].linkedFacts[2].value, "trade-1");
        assert.equal(view.history[0].evidence[0].targetId, "trading-investigation-evidence");
    });

    it("exposes tradeRecordId from decision context for direct lookup", () => {
        const view = buildTradingDiagnosisView(makeSnapshot());

        assert.equal(view.history[0].tradeRecordId, "trade-1");
    });

    it("falls back to outcome record tradeRecordId when decision context is missing", () => {
        const snapshot = makeSnapshot();
        snapshot.history[0].decisionContext = null;

        const view = buildTradingDiagnosisView(snapshot);

        assert.equal(view.history[0].tradeRecordId, "trade-1");
        assert.equal(view.history[0].linkedFacts.length, 0);
        assert.equal(view.history[0].evidence.length, 0);
    });

    it("returns null tradeRecordId when neither context nor record has one", () => {
        const snapshot = makeSnapshot();
        snapshot.history[0].decisionContext = null;
        snapshot.history[0].tradeRecordId = null;

        const view = buildTradingDiagnosisView(snapshot);

        assert.equal(view.history[0].tradeRecordId, null);
    });
});
