import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import BacktestTradeDetailDrawer from "./BacktestTradeDetailDrawer.js";
import type { BacktestTradeReplayResponse, BacktestTradeRow } from "@/types/backtests.js";

const row: BacktestTradeRow = {
    rowId: "signal-1:exit-1",
    signalId: "signal-1",
    backtestRunId: "run-1",
    exitRuleId: "exit-1",
    exitRuleCode: "RSI_EXIT",
    exitRuleName: "RSI Exit",
    symbol: "XAUUSD",
    timeframe: "15m",
    side: "SHORT",
    session: "LONDON",
    entryTime: "2026-03-04T06:00:00.000Z",
    exitTime: "2026-03-04T15:00:00.000Z",
    entryPrice: 5043.33,
    stopLoss: 5103.86,
    exitPrice: 4747.37,
    pnlPct: -2.1,
    rMultiple: 3.44,
    pnlUsd: 688,
    durationMs: 147 * 15 * 60 * 1000,
    result: "WIN",
    notes: "Replay candidate",
};

const replay: BacktestTradeReplayResponse = {
    summary: {
        rowId: row.rowId,
        runId: "run-1",
        runName: "Replay Run",
        signalCode: "songTrap",
        signalVersion: 3,
        signalId: row.signalId,
        signalLabel: "songTrap@3 / songTrap",
        strategyCode: "songTrap",
        strategyName: "Song Trap",
        symbol: row.symbol,
        timeframe: row.timeframe,
        side: row.side,
        session: row.session,
        exitRuleCode: row.exitRuleCode,
        exitRuleName: row.exitRuleName,
        result: "WIN",
        entryTime: row.entryTime,
        exitTime: row.exitTime,
        entryPrice: row.entryPrice,
        stopLoss: row.stopLoss,
        exitPrice: row.exitPrice,
        riskDistance: 60.53,
        totalR: 3.44,
        partialR: null,
        remainingR: null,
        barsHeld: 147,
        configuredSize: 0.02,
        quality: null,
    },
    window: {
        focusStart: row.entryTime,
        focusEnd: row.exitTime!,
        rangeStart: "2026-03-04T03:00:00.000Z",
        rangeEnd: "2026-03-04T18:00:00.000Z",
        paddingBars: 12,
    },
    pricePane: {
        candles: [
            {
                time: "2026-03-04T06:00:00.000Z",
                open: 5040,
                high: 5050,
                low: 5038,
                close: 5043,
                volume: 10,
            },
        ],
        levels: [],
        markers: [],
        trailLine: [],
        sessionRanges: [],
    },
    indicatorPane: {
        available: true,
        title: "CTF RSI / EMA / WMA",
        reason: null,
        rsi: [],
        ema9: [],
        wma45: [],
    },
    structurePane: {
        available: false,
        title: "HTF Price + Swings",
        timeframe: null,
        reason: "No explicit higher-timeframe context was available for this signal.",
        candles: [],
        markers: [],
    },
    timeline: [
        {
            id: "event-1",
            kind: "event",
            eventType: "TP1_HIT",
            candleTime: "2026-03-04T09:00:00.000Z",
            label: "TP1",
            price: 4982.8,
            detail: null,
        },
    ],
    stageAnalysis: null,
    raw: {
        events: [],
        traces: [],
    },
    decisionLog: null,
};

describe("BacktestTradeDetailDrawer", () => {
    it("renders expanded replay evidence with neutral n/a fields and HTF fallback copy", () => {
        const markup = renderToStaticMarkup(
            <BacktestTradeDetailDrawer
                isOpen
                row={row}
                context={{
                    runId: "run-1",
                    runName: "Replay Run",
                    signalLabel: "songTrap@3",
                    signalId: "signal-1",
                    rowId: row.rowId,
                }}
                replay={replay}
                isExpanded
                isLoading={false}
                error={null}
                engineHref="/engine?run=run-1"
                onExpand={() => undefined}
                onCollapse={() => undefined}
                onClose={() => undefined}
            />,
        );

        assert.match(markup, /Collapse Canvas/i);
        assert.match(markup, /Volume/i);
        assert.match(markup, /0\.0200/i);
        assert.match(markup, /No explicit higher-timeframe context was available for this signal/i);
        assert.match(markup, /Loading replay canvas/i);
        assert.match(markup, /Trade Timeline/i);
    });

    it("ignores replay payloads that belong to a different selected row and keeps bars-held neutral", () => {
        const staleReplay: BacktestTradeReplayResponse = {
            ...replay,
            summary: {
                ...replay.summary,
                rowId: "signal-2:exit-9",
                entryPrice: 1111.11,
                barsHeld: 9,
            },
        };

        const markup = renderToStaticMarkup(
            <BacktestTradeDetailDrawer
                isOpen
                row={row}
                context={null}
                replay={staleReplay}
                isExpanded={false}
                isLoading={false}
                error={null}
                engineHref="/engine?run=run-1"
                onExpand={() => undefined}
                onCollapse={() => undefined}
                onClose={() => undefined}
            />,
        );

        assert.doesNotMatch(markup, /1,111\.11/);
        assert.match(markup, /5,043\.33/);
        assert.match(markup, /Bars Held/);
        assert.match(markup, />n\/a</i);
        assert.match(markup, /Select a trade to inspect its replay evidence/i);
    });
});
