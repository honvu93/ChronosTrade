import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
    buildTradeHistoryAuditDetailView,
    buildTradeHistoryAuditListView,
} from "./tradeHistoryAuditView.js";
import type {
    TradeHistoryAuditDetailSnapshot,
    TradeHistoryAuditSnapshot,
} from "../types/trading.js";

function makeSnapshot(): TradeHistoryAuditSnapshot {
    return {
        summary: {
            totalRecords: 1,
            activeTrades: 0,
            wins: 1,
            losses: 0,
            breakEven: 0,
            recordsWithAudit: 1,
            recordsMissingAudit: 0,
            commandEvents: 2,
            decisionEvents: 3,
        },
        records: [{
            recordId: "result-1",
            rowId: "signal-1:exit-1",
            signalId: "signal-1",
            backtestRunId: "run-1",
            exitRuleId: "exit-1",
            exitRuleCode: "TP1",
            exitRuleName: "Take Profit 1",
            runName: "Song Trap Run",
            runStatus: "COMPLETED",
            signalCode: "songTrap",
            signalVersion: 3,
            symbol: "XAUUSD",
            timeframe: "H1",
            side: "LONG",
            session: "LONDON",
            entryTime: "2026-03-10T08:00:00.000Z",
            exitTime: "2026-03-10T09:00:00.000Z",
            entryPrice: 3230,
            stopLoss: 3220,
            exitPrice: 3242,
            rMultiple: 1.25,
            pnlUsd: 320,
            result: "WIN",
            exitReason: "TAKE_PROFIT_1",
            notes: "Strong continuation.",
            commandEventCount: 2,
            decisionEventCount: 3,
            auditCoverage: "full",
            latestAuditAt: "2026-03-10T09:00:00.000Z",
        }],
        evaluatedAt: "2026-03-11T08:00:00.000Z",
    };
}

function makeDetail(): TradeHistoryAuditDetailSnapshot {
    const snapshot = makeSnapshot();
    return {
        record: snapshot.records[0],
        traceability: {
            historyRecordId: "result-1",
            rowId: "signal-1:exit-1",
            signalId: "signal-1",
            backtestRunId: "run-1",
            runName: "Song Trap Run",
            signalKey: "songTrap@v3",
            exitRuleCode: "TP1",
            summaryLabel: "XAUUSD H1 LONG",
            scopeLabel: "Scoped record thread",
            scopeDetail: "This history shows the shared signal thread through the selected TP1 outcome.",
        },
        timelineSummary: {
            totalItems: 2,
            commandEvents: 1,
            decisionEvents: 1,
            firstOccurredAt: "2026-03-10T08:00:00.000Z",
            lastOccurredAt: "2026-03-10T09:00:00.000Z",
        },
        timeline: [
            {
                id: "trace-1",
                kind: "decision",
                source: "trace",
                eventType: "ENTRY_CONFIRMED",
                occurredAt: "2026-03-10T08:00:00.000Z",
                createdAt: "2026-03-10T08:00:01.000Z",
                label: null,
                price: null,
                signalEventId: "event-1",
                stateBefore: "WAITING",
                stateAfter: "ENTERED",
                ruleId: "entry-rule",
                notes: "Rule matched.",
                metaJson: null,
                indicatorJson: { fastEma: 12 },
                thresholdJson: { threshold: 1.4 },
                priceJson: { close: 3231 },
            },
            {
                id: "event-1",
                kind: "decision",
                source: "event",
                eventType: "TRAP",
                occurredAt: "2026-03-10T08:00:00.000Z",
                createdAt: "2026-03-10T08:00:10.000Z",
                label: "Trap seeded",
                price: 3231,
                signalEventId: "event-1",
                stateBefore: null,
                stateAfter: null,
                ruleId: null,
                notes: null,
                metaJson: { rsi: 82 },
                indicatorJson: null,
                thresholdJson: null,
                priceJson: null,
            },
        ],
        evaluatedAt: "2026-03-11T08:00:00.000Z",
    };
}

describe("buildTradeHistoryAuditListView", () => {
    it("summarizes record metrics and preserves signal linkage", () => {
        const view = buildTradeHistoryAuditListView(makeSnapshot());

        assert.equal(view.hasRecords, true);
        assert.ok(view.headline.includes("1 recent trade record"));
        assert.equal(view.records[0].resultLabel, "WIN");
        assert.equal(view.records[0].auditLabel, "Audit Linked");
        assert.equal(view.records[0].signalLabel, "songTrap@v3");
        assert.equal(view.records[0].timelineSummary, "2 commands | 3 decisions");
        assert.ok(view.records[0].notes?.includes("Take Profit 1"));
    });
});

describe("buildTradeHistoryAuditDetailView", () => {
    it("keeps traceability facts and distinguishes command vs decision items", () => {
        const view = buildTradeHistoryAuditDetailView(makeDetail());

        assert.equal(view.title, "XAUUSD H1 LONG");
        assert.equal(view.traceabilityFacts[0].value, "result-1");
        assert.equal(view.traceabilityFacts[2].value, "songTrap@v3");
        assert.equal(view.traceabilityFacts[5].label, "Scoped record thread");
        assert.equal(view.timelineItems[0].kindLabel, "Decision");
        assert.equal(view.timelineItems[0].sourceLabel, "Logic Trace");
        assert.equal(view.timelineItems[1].kindLabel, "Decision");
        assert.equal(view.timelineItems[1].sourceLabel, "Event Record");
        assert.ok(view.timelineItems[0].detail.includes("WAITING"));
        assert.equal(view.timelineItems[1].title, "Trap");
        assert.equal(view.timelineItems[1].rawSections[0].label, "Meta JSON");
    });
});
