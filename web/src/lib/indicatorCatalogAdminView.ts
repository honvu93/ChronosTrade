import {
    IndicatorCatalogRecord,
    TechIndicatorDefinition,
} from "@/types/signals";

export const summarizeIndicatorCatalog = (items: IndicatorCatalogRecord[]) => ({
    total: items.length,
    published: items.filter((item) => item.catalogStatus === "PUBLISHED").length,
    drafts: items.filter((item) => item.catalogStatus === "DRAFT").length,
    retired: items.filter((item) => item.catalogStatus === "RETIRED").length,
    brokenBindings: items.filter((item) => item.diagnostics.bindingStatus !== "MATCHED").length,
});

export const buildIndicatorCatalogPrimaryWarning = (item: IndicatorCatalogRecord) => {
    if (item.diagnostics.publishBlockingReasons.length > 0) {
        return item.diagnostics.publishBlockingReasons[0];
    }

    if (item.hasDraftChanges && item.catalogStatus === "PUBLISHED") {
        return "Draft changes are pending publish. Signal Composer still uses the last published version.";
    }

    if (item.catalogStatus === "RETIRED") {
        return "Retired indicators stay inspectable but are hidden from Signal Composer.";
    }

    if (item.dependencies.totalSignals > 0) {
        return `${item.dependencies.totalSignals} composed signal(s) still reference this indicator.`;
    }

    return null;
};

export const resolveIndicatorCatalogActions = (item: IndicatorCatalogRecord) => ({
    canPublish: item.diagnostics.publishBlockingReasons.length === 0
        && (item.hasDraftChanges || item.catalogStatus !== "PUBLISHED"),
    canRetire: item.catalogStatus !== "RETIRED",
    canDelete: item.diagnostics.deleteBlockingReasons.length === 0,
});

export const toComposerCatalog = (items: IndicatorCatalogRecord[]): TechIndicatorDefinition[] => (
    items
        .filter((item) => item.diagnostics.composerAvailable)
        .map((item) => ({
            id: item.id,
            name: item.name,
            category: item.category,
            description: item.description,
            paramSchema: item.paramSchema,
            conditions: item.conditions,
        }))
);
