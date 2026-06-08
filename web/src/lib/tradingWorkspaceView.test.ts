import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
    buildTradingWorkspaceView,
    shouldBootstrapTradingMirrorSync,
} from "./tradingWorkspaceView.js";
import type {
    TradingAutomationSnapshot,
    TradingExecutionCommandView,
    TradingFeatureFlagSnapshot,
    TradingWorkspaceSummary,
} from "../types/trading.js";

function makeSummary(overrides: Partial<TradingWorkspaceSummary> = {}): TradingWorkspaceSummary {
    return {
        accountId: "acct-1",
        accountLabel: "Pilot MT5",
        brokerKind: "MT5",
        accountMode: "PAPER",
        accountStatus: "ACTIVE",
        mt5Login: "10001",
        mt5Server: "Demo",
        baseCurrency: "USD",
        leverage: 500,
        balance: 10000,
        equity: 10120,
        margin: 420,
        freeMargin: 9700,
        marginLevel: 2400,
        unrealizedPnl: 120,
        realizedPnlDay: 80,
        openPositionCount: 2,
        pendingOrderCount: 1,
        totalDealCount: 8,
        syncHealth: {
            state: "healthy",
            label: "Healthy",
            message: "Mirror state is current enough for monitoring and broker interaction.",
            lastSuccessfulSyncAt: "2026-03-11T10:00:00.000Z",
            lastSyncAttemptAt: "2026-03-11T10:00:00.000Z",
            staleAfterSeconds: 300,
            canForceSync: true,
            canTrade: true,
        },
        evaluatedAt: "2026-03-11T10:00:00.000Z",
        ...overrides,
    };
}

function makeFlags({
    read = true,
    write = false,
    automation = false,
}: {
    read?: boolean;
    write?: boolean;
    automation?: boolean;
} = {}): TradingFeatureFlagSnapshot {
    return {
        evaluatedAt: "2026-03-11T10:00:00.000Z",
        flags: {
            trading_read_enabled: read,
            trading_write_enabled: write,
            trading_automation_enabled: automation,
        },
        capabilities: {
            read: {
                tier: "read",
                flagKey: "trading_read_enabled",
                requested: read,
                enabled: read,
                blockedBy: read ? [] : ["trading_read_enabled"],
                title: read ? "Read enabled" : "Read blocked",
                reason: "",
            },
            write: {
                tier: "write",
                flagKey: "trading_write_enabled",
                requested: write,
                enabled: read && write,
                blockedBy: read && write ? [] : ["trading_write_enabled"],
                title: write ? "Write enabled" : "Write blocked",
                reason: "",
            },
            automation: {
                tier: "automation",
                flagKey: "trading_automation_enabled",
                requested: automation,
                enabled: read && write && automation,
                blockedBy: read && write && automation ? [] : ["trading_automation_enabled"],
                title: automation ? "Automation enabled" : "Automation blocked",
                reason: "",
            },
        },
        highestEnabledTier: read && write && automation
            ? "automation"
            : read && write
                ? "write"
                : read
                    ? "read"
                    : "none",
    };
}

function makeAutomation(overrides: Partial<TradingAutomationSnapshot> = {}): TradingAutomationSnapshot {
    return {
        autoExecuteLocked: true,
        pendingApprovalCount: 1,
        bindings: [],
        availableIndicators: [],
        ...overrides,
    };
}

function makeCommands(): TradingExecutionCommandView[] {
    return [{
        id: "cmd-1",
        accountId: "acct-1",
        commandType: "OPEN_MARKET",
        status: "RECONCILED",
        idempotencyKey: "open-1",
        symbol: "XAUUSD",
        side: "LONG",
        volume: 0.2,
        price: 3230,
        stopLoss: 3220,
        takeProfit: 3242,
        brokerPositionId: "9001",
        brokerOrderId: "9000",
        brokerReference: "deal-1",
        requestedAt: "2026-03-11T10:00:00.000Z",
        dispatchedAt: "2026-03-11T10:00:02.000Z",
        completedAt: "2026-03-11T10:00:03.000Z",
        reconciledAt: "2026-03-11T10:00:04.000Z",
        errorCode: null,
        errorMessage: null,
        events: [],
    }];
}

describe("buildTradingWorkspaceView", () => {
    it("keeps monitoring available while write stays explicitly blocked in read-only mode", () => {
        const view = buildTradingWorkspaceView({
            summary: makeSummary(),
            featureFlags: makeFlags({ read: true, write: false, automation: false }),
            automation: makeAutomation(),
            commands: makeCommands(),
        });

        assert.equal(view.writeLane.enabled, false);
        assert.ok(view.writeLane.message.includes("FEATURE_TRADING_WRITE"));
        assert.equal(view.automationLane.enabled, false);
        assert.ok(view.latestCommandLabel.includes("OPEN_MARKET"));
    });

    it("opens the manual command lane only when write is enabled and mirror health is tradable", () => {
        const view = buildTradingWorkspaceView({
            summary: makeSummary(),
            featureFlags: makeFlags({ read: true, write: true, automation: false }),
            automation: makeAutomation(),
            commands: makeCommands(),
        });

        assert.equal(view.writeLane.enabled, true);
        assert.ok(view.writeLane.label.includes("Paper"));
        assert.ok(view.writeLane.message.includes("paper/demo"));
        assert.equal(view.automationLane.enabled, false);
    });

    it("shows automation controls with auto-execute still locked behind guardrails", () => {
        const view = buildTradingWorkspaceView({
            summary: makeSummary(),
            featureFlags: makeFlags({ read: true, write: true, automation: true }),
            automation: makeAutomation({ autoExecuteLocked: true }),
            commands: makeCommands(),
        });

        assert.equal(view.automationLane.enabled, true);
        assert.ok(view.automationLane.message.includes("auto-execute remains locked"));
    });

    it("shows paper auto-execute as available when the account snapshot unlocks it", () => {
        const view = buildTradingWorkspaceView({
            summary: makeSummary(),
            featureFlags: makeFlags({ read: true, write: true, automation: true }),
            automation: makeAutomation({ autoExecuteLocked: false }),
            commands: makeCommands(),
        });

        assert.equal(view.automationLane.enabled, true);
        assert.ok(view.automationLane.message.includes("auto-execution worker"));
    });

    it("forces write and automation lanes back to blocked when sync health is stale", () => {
        const view = buildTradingWorkspaceView({
            summary: makeSummary({
                syncHealth: {
                    state: "stale",
                    label: "Stale",
                    message: "Mirror data is older than the freshness threshold.",
                    lastSuccessfulSyncAt: "2026-03-11T08:00:00.000Z",
                    lastSyncAttemptAt: "2026-03-11T08:05:00.000Z",
                    staleAfterSeconds: 300,
                    canForceSync: true,
                    canTrade: false,
                },
            }),
            featureFlags: makeFlags({ read: true, write: true, automation: true }),
            automation: makeAutomation(),
            commands: makeCommands(),
        });

        assert.equal(view.syncTone, "caution");
        assert.equal(view.writeLane.enabled, false);
        assert.equal(view.automationLane.enabled, false);
        assert.ok(view.staleWarning?.includes("freshness threshold"));
    });
});

describe("shouldBootstrapTradingMirrorSync", () => {
    it("returns true when a connected account has never completed its first mirror sync", () => {
        const shouldBootstrap = shouldBootstrapTradingMirrorSync({
            summary: makeSummary({
                syncHealth: {
                    state: "disconnected",
                    label: "No mirror",
                    message: "No successful account mirror exists yet. Run a sync before trusting broker state.",
                    lastSuccessfulSyncAt: null,
                    lastSyncAttemptAt: null,
                    staleAfterSeconds: 300,
                    canForceSync: true,
                    canTrade: false,
                },
            }),
            syncRunsCount: 0,
        });

        assert.equal(shouldBootstrap, true);
    });

    it("returns false after the first mirror sync has already succeeded", () => {
        const shouldBootstrap = shouldBootstrapTradingMirrorSync({
            summary: makeSummary(),
            syncRunsCount: 1,
        });

        assert.equal(shouldBootstrap, false);
    });

    it("returns false when a first sync was already attempted and recorded", () => {
        const shouldBootstrap = shouldBootstrapTradingMirrorSync({
            summary: makeSummary({
                syncHealth: {
                    state: "failed",
                    label: "Sync failed",
                    message: "The latest sync attempt did not reconcile every broker surface.",
                    lastSuccessfulSyncAt: null,
                    lastSyncAttemptAt: "2026-03-11T10:05:00.000Z",
                    staleAfterSeconds: 300,
                    canForceSync: true,
                    canTrade: false,
                },
            }),
            syncRunsCount: 1,
        });

        assert.equal(shouldBootstrap, false);
    });
});
