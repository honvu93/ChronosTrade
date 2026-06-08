import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { buildSignalVersionEndpoint } from "./signalVersionRequest.js";

describe("buildSignalVersionEndpoint", () => {
    it("builds the base endpoint without exact record context", () => {
        assert.equal(
            buildSignalVersionEndpoint({ code: "songTrap", version: 2 }),
            "/api/trading/operations/signal-versions/songTrap/2",
        );
    });

    it("appends backtest context when a specific run is supplied", () => {
        assert.equal(
            buildSignalVersionEndpoint({
                code: "songTrap",
                version: 2,
                backtestRunId: "run-123",
            }),
            "/api/trading/operations/signal-versions/songTrap/2?backtestRunId=run-123",
        );
    });

    it("encodes signal code and indicator instance context", () => {
        assert.equal(
            buildSignalVersionEndpoint({
                code: "trend/x",
                version: 7,
                indicatorInstanceId: "inst-55",
            }),
            "/api/trading/operations/signal-versions/trend%2Fx/7?indicatorInstanceId=inst-55",
        );
    });
});
