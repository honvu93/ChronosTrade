import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { buildTradingDiagnosisEndpoint } from "./tradingDiagnosisRequest.js";

describe("buildTradingDiagnosisEndpoint", () => {
    it("builds the base diagnosis endpoint when no exact context is supplied", () => {
        assert.equal(
            buildTradingDiagnosisEndpoint({
                code: "songTrap",
                version: 3,
            }),
            "/api/trading/operations/diagnosis/songTrap/3",
        );
    });

    it("encodes the exact investigation context for reported issues", () => {
        assert.equal(
            buildTradingDiagnosisEndpoint({
                code: "songTrap",
                version: 3,
                backtestRunId: "run-1",
                indicatorInstanceId: "inst-1",
                tradeRecordId: "trade-1",
            }),
            "/api/trading/operations/diagnosis/songTrap/3?backtestRunId=run-1&indicatorInstanceId=inst-1&tradeRecordId=trade-1",
        );
    });
});
