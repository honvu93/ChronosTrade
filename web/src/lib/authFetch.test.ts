import { strict as assert } from "node:assert";
import { afterEach, describe, it } from "node:test";
import { createAuthFetch } from "./authFetch.js";
import { useAuthStore } from "../store/useAuthStore.js";

const originalWindow = globalThis.window;

function setMockWindow() {
    Object.defineProperty(globalThis, "window", {
        value: {
            location: {
                origin: "http://localhost:5001",
            },
        },
        configurable: true,
    });
}

function restoreWindow() {
    if (originalWindow === undefined) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete (globalThis as { window?: Window }).window;
        return;
    }

    Object.defineProperty(globalThis, "window", {
        value: originalWindow,
        configurable: true,
    });
}

afterEach(() => {
    restoreWindow();
    useAuthStore.setState({
        status: "loading",
        accessToken: null,
        session: null,
        error: null,
    });
});

describe("createAuthFetch", () => {
    it("refreshes the session and retries once when an API request returns 401", async () => {
        setMockWindow();
        const calls: string[] = [];
        const authFetch = createAuthFetch(async (input) => {
            const request = input instanceof Request ? input : new Request(input);
            const pathname = new URL(request.url).pathname;
            calls.push(pathname);

            if (pathname === "/api/trading/accounts" && calls.filter((value) => value === pathname).length === 1) {
                return new Response(JSON.stringify({
                    success: false,
                    error: {
                        code: "TRADING_AUTH_INVALID",
                        message: "JWT expired",
                        domain: "trading.auth",
                    },
                }), {
                    status: 401,
                    headers: { "Content-Type": "application/json" },
                });
            }

            if (pathname === "/api/auth/refresh") {
                return new Response(JSON.stringify({
                    success: true,
                    data: {
                        session: {
                            accessTokenExpiresAt: "2026-03-12T00:00:00.000Z",
                        },
                    },
                }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                });
            }

            return new Response(JSON.stringify({
                success: true,
                data: {
                    accounts: [],
                    activeAccountId: null,
                },
            }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        });

        const response = await authFetch("http://localhost:5001/api/trading/accounts");
        const payload = await response.json() as { success: boolean };

        assert.equal(response.status, 200);
        assert.equal(payload.success, true);
        assert.deepEqual(calls, [
            "/api/trading/accounts",
            "/api/auth/refresh",
            "/api/trading/accounts",
        ]);
        assert.equal(useAuthStore.getState().status, "authenticated");
    });

    it("returns a friendly auth error and marks the session anonymous when refresh fails", async () => {
        setMockWindow();
        useAuthStore.getState().setAuthenticated({
            accessTokenExpiresAt: "2026-03-11T23:59:59.000Z",
        } as never);

        const authFetch = createAuthFetch(async (input) => {
            const request = input instanceof Request ? input : new Request(input);
            const pathname = new URL(request.url).pathname;

            if (pathname === "/api/auth/refresh") {
                return new Response(JSON.stringify({
                    success: false,
                    error: {
                        code: "AUTH_REFRESH_INVALID",
                        message: "The refresh token is missing or expired. Sign in again to continue.",
                        domain: "auth.session",
                    },
                }), {
                    status: 401,
                    headers: { "Content-Type": "application/json" },
                });
            }

            return new Response(JSON.stringify({
                success: false,
                error: {
                    code: "TRADING_AUTH_INVALID",
                    message: "JWT expired",
                    domain: "trading.auth",
                },
            }), {
                status: 401,
                headers: { "Content-Type": "application/json" },
            });
        });

        const response = await authFetch("http://localhost:5001/api/trading/accounts", {
            method: "POST",
            body: JSON.stringify({ label: "Demo" }),
            headers: {
                "Content-Type": "application/json",
            },
        });
        const payload = await response.json() as {
            success: false;
            error: { message: string };
        };

        assert.equal(response.status, 401);
        assert.equal(payload.error.message, "Session expired. Sign in again to continue.");
        assert.equal(useAuthStore.getState().status, "anonymous");
        assert.equal(useAuthStore.getState().error, "Session expired. Sign in again to continue.");
    });
});
