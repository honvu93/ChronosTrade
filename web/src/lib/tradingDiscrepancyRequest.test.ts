import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { buildTradingDiscrepancyEndpoint } from "./tradingDiscrepancyRequest.js";

describe("buildTradingDiscrepancyEndpoint", () => {
    it("builds the base discrepancy endpoint without context filters", () => {
        assert.equal(
            buildTradingDiscrepancyEndpoint({ code: "songTrap", version: 3 }),
            "/api/trading/operations/discrepancies/songTrap/3",
        );
    });

    it("includes backtest and live deployment context together when both are supplied", () => {
        assert.equal(
            buildTradingDiscrepancyEndpoint({
                code: "songTrap",
                version: 3,
                backtestRunId: "run-1",
                indicatorInstanceId: "inst-1",
            }),
            "/api/trading/operations/discrepancies/songTrap/3?backtestRunId=run-1&indicatorInstanceId=inst-1",
        );
    });

    it("encodes trade record context for reported issue investigations", () => {
        assert.equal(
            buildTradingDiscrepancyEndpoint({
                code: "trend/x",
                version: 7,
                tradeRecordId: "trade:55",
            }),
            "/api/trading/operations/discrepancies/trend%2Fx/7?tradeRecordId=trade%3A55",
        );
    });
});
