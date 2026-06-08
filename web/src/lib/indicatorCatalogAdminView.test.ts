import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
    buildIndicatorCatalogPrimaryWarning,
    resolveIndicatorCatalogActions,
    summarizeIndicatorCatalog,
    toComposerCatalog,
} from "./indicatorCatalogAdminView.js";
import type { IndicatorCatalogRecord } from "@/types/signals";

const makeRecord = (overrides: Partial<IndicatorCatalogRecord> = {}): IndicatorCatalogRecord => ({
    id: "RSI_ALIAS",
    name: "RSI Alias",
    category: "momentum",
    description: "Alias for RSI runtime block.",
    runtimeBindingKey: "RSI",
    catalogStatus: "DRAFT",
    isActive: false,
    hasDraftChanges: false,
    paramSchema: [],
    conditions: [],
    createdAt: "2026-03-13T01:00:00.000Z",
    createdBy: "admin-1",
    updatedAt: "2026-03-13T01:10:00.000Z",
    updatedBy: "admin-1",
    draftUpdatedAt: null,
    draftUpdatedBy: null,
    publishedAt: null,
    publishedBy: null,
    retiredAt: null,
    retiredBy: null,
    diagnostics: {
        bindingStatus: "MATCHED",
        bindingMessage: "Runtime binding RSI is aligned.",
        composerAvailable: false,
        publishBlockingReasons: [],
        deleteBlockingReasons: [],
    },
    dependencies: {
        totalSignals: 0,
        activeSignals: 0,
        inactiveSignals: 0,
        references: [],
    },
    ...overrides,
});

describe("summarizeIndicatorCatalog", () => {
    it("counts published, draft, retired, and broken items separately", () => {
        const summary = summarizeIndicatorCatalog([
            makeRecord(),
            makeRecord({ id: "EMA", catalogStatus: "PUBLISHED", isActive: true, diagnostics: { ...makeRecord().diagnostics, composerAvailable: true } }),
            makeRecord({ id: "SESSION", catalogStatus: "RETIRED" }),
            makeRecord({ id: "BROKEN", diagnostics: { ...makeRecord().diagnostics, bindingStatus: "SCHEMA_MISMATCH", publishBlockingReasons: ["schema mismatch"] } }),
        ]);

        assert.deepEqual(summary, {
            total: 4,
            published: 1,
            drafts: 2,
            retired: 1,
            brokenBindings: 1,
        });
    });
});

describe("resolveIndicatorCatalogActions", () => {
    it("blocks publish and delete when diagnostics report blockers", () => {
        const actions = resolveIndicatorCatalogActions(makeRecord({
            diagnostics: {
                ...makeRecord().diagnostics,
                publishBlockingReasons: ["missing runtime"],
                deleteBlockingReasons: ["used by signals"],
            },
        }));

        assert.deepEqual(actions, {
            canPublish: false,
            canRetire: true,
            canDelete: false,
        });
    });

    it("keeps publish disabled on already-live rows until draft changes exist", () => {
        const actions = resolveIndicatorCatalogActions(makeRecord({
            catalogStatus: "PUBLISHED",
            isActive: true,
            publishedAt: "2026-03-13T01:15:00.000Z",
            publishedBy: "admin-1",
            diagnostics: {
                ...makeRecord().diagnostics,
                composerAvailable: true,
                deleteBlockingReasons: ["published rows stay auditable"],
            },
        }));

        assert.deepEqual(actions, {
            canPublish: false,
            canRetire: true,
            canDelete: false,
        });
    });
});

describe("buildIndicatorCatalogPrimaryWarning", () => {
    it("prioritizes publish blockers before lifecycle copy", () => {
        const warning = buildIndicatorCatalogPrimaryWarning(makeRecord({
            catalogStatus: "RETIRED",
            diagnostics: {
                ...makeRecord().diagnostics,
                publishBlockingReasons: ["runtime block is missing"],
            },
        }));

        assert.equal(warning, "runtime block is missing");
    });

    it("explains when a published row has pending draft changes", () => {
        const warning = buildIndicatorCatalogPrimaryWarning(makeRecord({
            catalogStatus: "PUBLISHED",
            isActive: true,
            hasDraftChanges: true,
        }));

        assert.match(warning ?? "", /still uses the last published version/i);
    });
});

describe("toComposerCatalog", () => {
    it("only exposes composer-available rows", () => {
        const visible = toComposerCatalog([
            makeRecord({
                id: "VISIBLE",
                catalogStatus: "PUBLISHED",
                isActive: true,
                diagnostics: {
                    ...makeRecord().diagnostics,
                    composerAvailable: true,
                },
            }),
            makeRecord({
                id: "DRAFT_ONLY",
                diagnostics: {
                    ...makeRecord().diagnostics,
                    composerAvailable: false,
                },
            }),
        ]);

        assert.deepEqual(visible.map((item) => item.id), ["VISIBLE"]);
    });
});
