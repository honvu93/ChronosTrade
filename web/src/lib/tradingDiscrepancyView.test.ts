import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { buildTradingDiscrepancyView } from "./tradingDiscrepancyView.js";

function makeSnapshot() {
    return {
        investigationKind: "reported-issue" as const,
        signalCode: "songTrap",
        signalVersion: 3,
        signalName: "Song Trap",
        linkedRecords: {
            signalKey: "songTrap@v3",
            backtestRunId: "run-1",
            tradeRecordId: "trade-1",
            signalId: "signal-1",
            primaryIndicatorInstanceId: "inst-1",
            deploymentRecordIds: ["inst-1"],
            commandRecordIds: ["event-live-stop"],
            reportPath: "/reports?backtestRunId=run-1&signalId=signal-1",
        },
        backtest: {
            runId: "run-1",
            runName: "Song Trap Validation",
            runStatus: "COMPLETED",
            symbol: "XAUUSD",
            timeframe: "H1",
            parametersJson: { lookback: 20, threshold: 1.4 },
            executionConfigJson: { orderTiming: "CLOSE" },
            reportSummary: {
                signalCount: 5,
                totalTrades: 8,
                closedTrades: 8,
                openTrades: 0,
                wins: 6,
                losses: 2,
                winRate: 75,
                profitFactor: 2.4,
                expectancy: 0.8,
                netR: 6.4,
                netUsd: 1280,
                maxConsecutiveLoss: 1,
                maxDrawdownPct: -4.5,
            },
            signalReview: {
                signalId: "signal-1",
                symbol: "XAUUSD",
                timeframe: "H1",
                side: "LONG",
                session: "LONDON",
                strategyCode: "SONG",
                strategyName: "Song Trap",
                resultCount: 2,
                wins: 1,
                losses: 1,
                openResults: 0,
                netR: 0.5,
                avgR: 0.25,
                bestExitRuleCode: "TP1",
                bestExitRuleName: "Take Profit 1",
                latestExitTime: "2026-03-09T10:00:00.000Z",
            },
            tradeIssue: {
                recordId: "trade-1",
                rowId: "signal-1:exit-tp1",
                signalId: "signal-1",
                exitRuleCode: "TP1",
                exitRuleName: "Take Profit 1",
                result: "WIN" as const,
                exitReason: "TAKE_PROFIT_1",
                rMultiple: 1.75,
                pnlUsd: 420,
                entryTime: "2026-03-09T08:00:00.000Z",
                exitTime: "2026-03-09T10:00:00.000Z",
                auditCommandRecords: 3,
                auditDecisionRecords: 2,
                auditLatestAt: "2026-03-09T10:00:00.000Z",
            },
        },
        live: {
            primaryIndicatorInstanceId: "inst-1",
            deployments: [{
                indicatorInstanceId: "inst-1",
                name: "Song Trap Live",
                status: "FAILED",
                symbol: "XAUUSD",
                timeframe: "H1",
                matchedBy: "source-run" as const,
                sourceBacktestRunId: "run-1",
                startedAt: "2026-03-10T00:00:00.000Z",
                updatedAt: "2026-03-10T10:05:00.000Z",
                lastProcessedCandleTime: "2026-03-10T10:00:00.000Z",
                lastEmittedEventTime: "2026-03-10T09:59:00.000Z",
                errorMessage: "Broker rejected the trailing stop update.",
                parameterJson: { lookback: 24, threshold: 1.4 },
                executionConfigJson: { orderTiming: "OPEN" },
                commandRecordCount: 1,
                decisionRecordCount: 1,
                latestRecordId: "event-live-stop",
                latestEventType: "STOP_HIT",
                latestOccurredAt: "2026-03-10T09:59:00.000Z",
                latestLabel: "Stop loss executed",
            }],
            timelineSummary: {
                totalItems: 2,
                commandEvents: 1,
                decisionEvents: 1,
                firstOccurredAt: "2026-03-10T09:58:00.000Z",
                lastOccurredAt: "2026-03-10T09:59:00.000Z",
            },
            recentTimeline: [{
                id: "event-live-stop",
                kind: "command" as const,
                source: "event" as const,
                eventType: "STOP_HIT",
                occurredAt: "2026-03-10T09:59:00.000Z",
                createdAt: "2026-03-10T09:59:01.000Z",
                label: "Stop loss executed",
                price: 3218.4,
                signalEventId: "event-live-stop",
                stateBefore: null,
                stateAfter: null,
                ruleId: null,
                notes: null,
                metaJson: { orderId: "mt5-42" },
                indicatorJson: null,
                thresholdJson: null,
                priceJson: null,
            }],
        },
        discrepancies: [{
            code: "outcome-drift",
            severity: "critical" as const,
            title: "Historical TP1 outcome differs from the latest live stop-out.",
            detail: "The investigated trade closed at TP1 in validation, but the current live deployment most recently stopped out.",
            backtestValue: "TP1 | +1.75R",
            liveValue: "STOP_HIT | FAILED",
        }, {
            code: "parameter-drift",
            severity: "warning" as const,
            title: "Live parameters drifted from the validation run.",
            detail: "The lookback parameter no longer matches the linked validation run.",
            backtestValue: "lookback=20",
            liveValue: "lookback=24",
        }],
        evaluatedAt: "2026-03-11T08:00:00.000Z",
    };
}

describe("buildTradingDiscrepancyView", () => {
    it("turns discrepancy data into an operator-facing summary with clear difference cards", () => {
        const view = buildTradingDiscrepancyView(makeSnapshot());

        assert.equal(view.header.title, "Song Trap");
        assert.equal(view.header.signalKey, "songTrap@v3");
        assert.equal(view.header.investigationLabel, "Reported Issue");
        assert.equal(view.reportLink.href, "/reports?backtestRunId=run-1&signalId=signal-1");
        assert.equal(view.backtest.tradeIssueLabel, "TP1 | WIN | +1.75R");
        assert.equal(view.live.primaryDeploymentLabel, "Song Trap Live");
        assert.equal(view.live.timelineLabel, "1 command | 1 decision");
        assert.equal(view.differenceCards.length, 2);
        assert.equal(view.differenceCards[0].severityLabel, "Critical");
        assert.equal(view.differenceCards[1].severityLabel, "Warning");
        assert.equal(view.linkedRecordFacts.find((fact) => fact.label === "Command Records")?.value, "event-live-stop");
    });
});
