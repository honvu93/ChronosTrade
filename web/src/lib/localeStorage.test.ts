import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { AUTH_TOKEN_STORAGE_KEYS, getStoredAuthToken } from "./authTokenStorage.js";
import {
    APP_LOCALE_STORAGE_KEY,
    clearStoredAppLocale,
    persistStoredAppLocale,
    readStoredAppLocale,
} from "./localeStorage.js";
import {
    persistStoredTradingWorkspaceAccountId,
    readStoredTradingWorkspaceAccountId,
} from "./tradingWorkspaceAccountSelectionStorage.js";

describe("localeStorage", () => {
    it("persists and restores the locale using the shared browser key", () => {
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

        persistStoredAppLocale("vi", localStorage);

        assert.equal(readStoredAppLocale(localStorage), "vi");
        assert.match(storage.get(APP_LOCALE_STORAGE_KEY) ?? "", /"locale":"vi"/);
    });

    it("falls back to english for missing, invalid, or legacy locale payloads", () => {
        assert.equal(readStoredAppLocale({ getItem: () => null }), "en");
        assert.equal(readStoredAppLocale({ getItem: () => "jp" }), "en");
        assert.equal(readStoredAppLocale({ getItem: () => "{\"state\":{\"locale\":\"vi\"}}" }), "vi");
    });

    it("clears only the locale key and leaves auth and trading storage untouched", () => {
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

        persistStoredAppLocale("vi", localStorage);
        persistStoredTradingWorkspaceAccountId("user-1", "acct-live", localStorage);
        storage.set(AUTH_TOKEN_STORAGE_KEYS[0], "token-1");

        clearStoredAppLocale(localStorage);

        assert.equal(readStoredAppLocale(localStorage), "en");
        assert.equal(readStoredTradingWorkspaceAccountId("user-1", localStorage), "acct-live");
        assert.equal(
            getStoredAuthToken({
                [AUTH_TOKEN_STORAGE_KEYS[0]]: storage.get(AUTH_TOKEN_STORAGE_KEYS[0]) ?? null,
            }),
            "token-1",
        );
    });
});
