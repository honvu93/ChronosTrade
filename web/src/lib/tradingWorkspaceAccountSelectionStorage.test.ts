import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
    clearStoredTradingWorkspaceAccountId,
    persistStoredTradingWorkspaceAccountId,
    readStoredTradingWorkspaceAccountId,
} from "./tradingWorkspaceAccountSelectionStorage.js";

describe("tradingWorkspaceAccountSelectionStorage", () => {
    it("stores and restores the selected account per user", () => {
        const storage = new Map<string, string>();
        const localStorage = {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => {
                storage.set(key, value);
            },
            removeItem: (key: string) => {
                storage.delete(key);
            },
        };

        persistStoredTradingWorkspaceAccountId("user-1", "acct-paper", localStorage);
        persistStoredTradingWorkspaceAccountId("user-2", "acct-live", localStorage);

        assert.equal(readStoredTradingWorkspaceAccountId("user-1", localStorage), "acct-paper");
        assert.equal(readStoredTradingWorkspaceAccountId("user-2", localStorage), "acct-live");
    });

    it("returns null for missing or blank stored values", () => {
        const storage = {
            getItem: (key: string) => key === "trading.workspace.selectedAccount:user-1" ? "   " : null,
        };

        assert.equal(readStoredTradingWorkspaceAccountId("user-1", storage), null);
        assert.equal(readStoredTradingWorkspaceAccountId(null, storage), null);
    });

    it("clears the stored selected account", () => {
        const storage = new Map<string, string>([
            ["trading.workspace.selectedAccount:user-1", "acct-paper"],
        ]);
        const localStorage = {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => {
                storage.set(key, value);
            },
            removeItem: (key: string) => {
                storage.delete(key);
            },
        };

        clearStoredTradingWorkspaceAccountId("user-1", localStorage);

        assert.equal(readStoredTradingWorkspaceAccountId("user-1", localStorage), null);
    });
});
