import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { MONITORING_POLL_INTERVAL_MS, shouldPollAdminMonitoring } from "./adminMonitoringPolling";

describe("shouldPollAdminMonitoring", () => {
    it("polls only while an admin keeps the tab visible and focused", () => {
        assert.equal(shouldPollAdminMonitoring({
            visible: true,
            focused: true,
            isAdmin: true,
        }), true);
        assert.equal(shouldPollAdminMonitoring({
            visible: false,
            focused: true,
            isAdmin: true,
        }), false);
        assert.equal(shouldPollAdminMonitoring({
            visible: true,
            focused: false,
            isAdmin: true,
        }), false);
        assert.equal(shouldPollAdminMonitoring({
            visible: true,
            focused: true,
            isAdmin: false,
        }), false);
    });

    it("keeps the monitoring cadence at 30 seconds while active", () => {
        assert.equal(MONITORING_POLL_INTERVAL_MS, 30000);
    });
});
