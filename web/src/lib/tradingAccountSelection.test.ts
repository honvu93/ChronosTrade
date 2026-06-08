import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
    resolveActiveTradingAccount,
    resolveTradingSetupSelectedAccountId,
} from "./tradingAccountSelection.js";
import type { TradingAccountSummary } from "../types/trading.js";

function makeAccount(overrides: Partial<TradingAccountSummary> = {}): TradingAccountSummary {
    return {
        id: "acct-1",
        ownerUserId: "user-1",
        ownerEmail: "pilot@example.com",
        ownerUsername: "pilot",
        ownerDisplayName: "Pilot User",
        label: "Primary MT5",
        brokerKind: "MT5",
        accountMode: "PAPER",
        status: "ACTIVE",
        baseCurrency: "USD",
        leverage: 500,
        lastSeenAt: null,
        lastSuccessfulSyncAt: null,
        mt5Login: "10001",
        mt5Server: "Demo-A",
        hasStoredCredential: true,
        isActive: false,
        createdAt: "2026-03-11T10:00:00.000Z",
        updatedAt: "2026-03-11T10:00:00.000Z",
        ...overrides,
    };
}

describe("resolveActiveTradingAccount", () => {
    it("prefers the explicitly persisted active account id", () => {
        const accounts = [
            makeAccount({ id: "acct-1", label: "Primary" }),
            makeAccount({ id: "acct-2", label: "Secondary", isActive: true }),
        ];

        const active = resolveActiveTradingAccount(accounts, "acct-1");

        assert.equal(active?.id, "acct-1");
        assert.equal(active?.label, "Primary");
    });

    it("falls back to the active flag when the persisted id is missing", () => {
        const accounts = [
            makeAccount({ id: "acct-1", label: "Primary" }),
            makeAccount({ id: "acct-2", label: "Secondary", isActive: true }),
        ];

        const active = resolveActiveTradingAccount(accounts, null);

        assert.equal(active?.id, "acct-2");
    });

    it("falls back to the first saved account when neither persisted id nor active flag resolves", () => {
        const accounts = [
            makeAccount({ id: "acct-1", label: "Primary" }),
            makeAccount({ id: "acct-2", label: "Secondary" }),
        ];

        const active = resolveActiveTradingAccount(accounts, "missing");

        assert.equal(active?.id, "acct-1");
    });
});

describe("resolveTradingSetupSelectedAccountId", () => {
    it("keeps the currently selected saved account when it still exists", () => {
        const accounts = [
            makeAccount({ id: "acct-1", label: "Primary", isActive: true }),
            makeAccount({ id: "acct-2", label: "Secondary" }),
        ];

        const selected = resolveTradingSetupSelectedAccountId({
            accounts,
            activeAccountId: "acct-1",
            selectedAccountId: "acct-2",
            isCreatingNew: false,
        });

        assert.equal(selected, "acct-2");
    });

    it("falls back to the active account when the selected account was deleted", () => {
        const accounts = [
            makeAccount({ id: "acct-1", label: "Primary", isActive: true }),
            makeAccount({ id: "acct-2", label: "Secondary" }),
        ];

        const selected = resolveTradingSetupSelectedAccountId({
            accounts,
            activeAccountId: "acct-1",
            selectedAccountId: "acct-3",
            isCreatingNew: false,
        });

        assert.equal(selected, "acct-1");
    });

    it("returns null while the operator is creating a new account", () => {
        const accounts = [
            makeAccount({ id: "acct-1", label: "Primary", isActive: true }),
        ];

        const selected = resolveTradingSetupSelectedAccountId({
            accounts,
            activeAccountId: "acct-1",
            selectedAccountId: "acct-1",
            isCreatingNew: true,
        });

        assert.equal(selected, null);
    });
});
