import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
    collectTranslationLeafValues,
    flattenTranslationEntries,
    getTranslationCatalog,
    interpolateCopy,
} from "./translations.js";

const PROTECTED_TRANSLATION_PATHS = [
    "common.language",
    "common.signOut",
    "workspace.sharedShell",
    "login.authenticatedLogin",
    "login.title",
    "watchlist.title",
    "indicatorCatalog.title",
    "compositionCanvas.emptyPrompt",
] as const;

function readValueAtPath(value: Record<string, unknown>, path: string): string {
    const resolved = path
        .split(".")
        .reduce<unknown>((current, key) => (current && typeof current === "object"
            ? (current as Record<string, unknown>)[key]
            : undefined), value);

    if (typeof resolved !== "string") {
        throw new Error(`Expected ${path} to resolve to a string`);
    }

    return resolved;
}

describe("translations", () => {
    it("keeps english and vietnamese catalogs structurally identical", () => {
        assert.deepEqual(
            flattenTranslationEntries(getTranslationCatalog("en")),
            flattenTranslationEntries(getTranslationCatalog("vi")),
        );
    });

    it("fails protected surfaces if vietnamese copy silently falls back to english", () => {
        const english = getTranslationCatalog("en") as unknown as Record<string, unknown>;
        const vietnamese = getTranslationCatalog("vi") as unknown as Record<string, unknown>;

        for (const path of PROTECTED_TRANSLATION_PATHS) {
            assert.notEqual(readValueAtPath(vietnamese, path), readValueAtPath(english, path), path);
        }
    });

    it("never ships blank translation leaves", () => {
        for (const leaf of collectTranslationLeafValues(getTranslationCatalog("en"))) {
            assert.ok(leaf.trim().length > 0);
        }

        for (const leaf of collectTranslationLeafValues(getTranslationCatalog("vi"))) {
            assert.ok(leaf.trim().length > 0);
        }
    });

    it("falls back safely to english when a bad locale is requested", () => {
        const english = getTranslationCatalog("en");
        const invalid = getTranslationCatalog("jp" as never);

        assert.deepEqual(invalid, english);
    });

    it("interpolates placeholders in translated copy", () => {
        assert.equal(
            interpolateCopy(getTranslationCatalog("en").topNav.noSymbolsFound, { search: "XAU" }),
            "No symbols found matching \"XAU\"",
        );
    });
});
