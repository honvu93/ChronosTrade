import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { canAccessPath } from "./authAccess.js";
import type { AuthSessionSnapshot } from "@/types/auth.js";

const makeSession = (modules: AuthSessionSnapshot["user"]["modules"]): AuthSessionSnapshot => ({
    user: {
        id: "user-1",
        email: "user@example.com",
        username: "user",
        displayName: "User",
        role: "USER",
        isActive: true,
        modules,
    },
    firstAllowedPath: modules.includes("chart") ? "/" : "/signals",
    accessTokenExpiresAt: "2026-03-14T00:00:00.000Z",
});

describe("authAccess indicator routing", () => {
    it("allows signal users onto indicators routes", () => {
        assert.equal(canAccessPath(makeSession(["signal"]), "/indicators"), true);
        assert.equal(canAccessPath(makeSession(["signal"]), "/indicators/inst-1/chart"), true);
    });

    it("keeps chart-only users off indicators routes", () => {
        assert.equal(canAccessPath(makeSession(["chart"]), "/indicators"), false);
    });
});
