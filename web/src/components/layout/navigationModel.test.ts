import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { getTranslationCatalog } from "@/lib/translations.js";
import {
    buildPrimaryNavigation,
    resolveWorkspaceContextForLocale,
} from "./navigationModel.js";
import type { AuthSessionUser } from "@/types/auth.js";

const adminUser: AuthSessionUser = {
    id: "admin-1",
    email: "admin@example.com",
    username: "admin",
    displayName: "Admin",
    role: "ADMIN",
    isActive: true,
    modules: ["chart", "signal", "report", "trading", "engine"],
};

const traderUser: AuthSessionUser = {
    ...adminUser,
    id: "user-1",
    role: "USER",
    modules: ["chart", "signal", "engine"],
};

const signalOnlyUser: AuthSessionUser = {
    ...adminUser,
    id: "user-2",
    role: "USER",
    modules: ["chart", "signal"],
};

describe("navigationModel localization", () => {
    it("builds localized primary navigation without changing module order or hrefs", () => {
        const copy = getTranslationCatalog("vi");

        assert.deepEqual(
            buildPrimaryNavigation(traderUser, "vi").map((item) => item.href),
            ["/", "/signals", "/engine", "/indicators"],
        );
        assert.deepEqual(
            buildPrimaryNavigation(traderUser, "vi").map((item) => item.label),
            [copy.navigation.chart, copy.navigation.signals, copy.navigation.engine, copy.navigation.indicators],
        );
    });

    it("keeps the admin lane visible for administrators", () => {
        const nav = buildPrimaryNavigation(adminUser, "en");

        assert.equal(nav.at(-1)?.href, "/admin/monitoring");
        assert.equal(nav.at(-1)?.label, "Admin");
    });

    it("keeps the indicators lane visible for signal-only users", () => {
        assert.deepEqual(
            buildPrimaryNavigation(signalOnlyUser, "en").map((item) => item.href),
            ["/", "/signals", "/indicators"],
        );
    });

    it("resolves localized workspace context per route", () => {
        const englishContext = resolveWorkspaceContextForLocale("/signals/composer", "en");
        const vietnameseContext = resolveWorkspaceContextForLocale("/signals/composer", "vi");
        const vietnameseCopy = getTranslationCatalog("vi").workspace.routeContext.signalsComposer;

        assert.equal(englishContext.title, "Strategy Composition Deck");
        assert.equal(vietnameseContext.moduleLabel, vietnameseCopy.moduleLabel);
        assert.equal(vietnameseContext.description, vietnameseCopy.description);
    });
});
