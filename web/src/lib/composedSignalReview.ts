import {
    ComposedBlockConfig,
    ComposedMatchMode,
    ComposedSignalBlocks,
    TechIndicatorConditionDef,
    TechIndicatorDefinition,
    TechIndicatorFieldSchema,
} from "@/types/signals";

export interface CompositionSummary {
    title: string;
    description: string;
    connectorLabel: string;
}

export interface ReviewedCondition {
    id: string;
    stepLabel: string;
    indicatorLabel: string;
    conditionLabel: string;
    description: string;
    detailItems: string[];
}

const MODE_COPY: Record<ComposedMatchMode, Omit<CompositionSummary, "description">> = {
    ALL: {
        title: "All conditions confirm together",
        connectorLabel: "AND",
    },
    ANY: {
        title: "Any condition can trigger the signal",
        connectorLabel: "OR",
    },
    SEQUENCE: {
        title: "Conditions must trigger in order",
        connectorLabel: "THEN",
    },
};

const pluralize = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

const formatLabelFromId = (value: string) => value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");

const formatPrimitiveValue = (value: unknown): string => {
    if (typeof value === "boolean") {
        return value ? "On" : "Off";
    }

    if (typeof value === "number") {
        return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
    }

    if (typeof value === "string") {
        return value;
    }

    return JSON.stringify(value);
};

const buildSchemaDetailItems = (
    schema: TechIndicatorFieldSchema[],
    values: Record<string, unknown>,
): string[] => {
    const remaining = new Set(Object.keys(values));
    const detailItems: string[] = [];

    for (const field of schema) {
        const value = values[field.id];
        if (value === undefined) {
            continue;
        }

        remaining.delete(field.id);
        detailItems.push(`${field.label}: ${formatPrimitiveValue(value)}`);
    }

    for (const key of remaining) {
        const value = values[key];
        if (value === undefined) {
            continue;
        }

        detailItems.push(`${formatLabelFromId(key)}: ${formatPrimitiveValue(value)}`);
    }

    return detailItems;
};

const resolveIndicator = (
    indicators: TechIndicatorDefinition[],
    block: ComposedBlockConfig,
): TechIndicatorDefinition | undefined => indicators.find((indicator) => indicator.id === block.indicatorId);

const resolveCondition = (
    indicator: TechIndicatorDefinition | undefined,
    block: ComposedBlockConfig,
): TechIndicatorConditionDef | undefined => indicator?.conditions.find((condition) => condition.id === block.conditionId);

export const buildCompositionSummary = (definition: Pick<ComposedSignalBlocks, "blocks" | "matchMode" | "windowBars">): CompositionSummary => {
    const base = MODE_COPY[definition.matchMode];
    const conditionCount = definition.blocks.length;

    if (definition.matchMode === "ANY") {
        return {
            ...base,
            description: `${base.title}. ${pluralize(conditionCount, "condition")} are available, and the first one to match can fire the signal.`,
        };
    }

    if (definition.matchMode === "SEQUENCE") {
        return {
            ...base,
            description: `${pluralize(conditionCount, "condition")} must match in the listed order within ${pluralize(definition.windowBars, "bar")}.`,
        };
    }

    return {
        ...base,
        description: `${pluralize(conditionCount, "condition")} must all match within ${pluralize(definition.windowBars, "bar")} before the signal is valid.`,
    };
};

export const buildReviewedConditions = (
    blocks: ComposedBlockConfig[],
    indicators: TechIndicatorDefinition[],
): ReviewedCondition[] => blocks.map((block, index) => {
    const indicator = resolveIndicator(indicators, block);
    const condition = resolveCondition(indicator, block);
    const indicatorLabel = indicator ? `${indicator.name} (${indicator.id})` : block.indicatorId;
    const conditionLabel = condition?.name ?? formatLabelFromId(block.conditionId);
    const description = condition?.description ?? "Condition details are unavailable in the catalog.";
    const detailItems = [
        ...(block.timeframe ? [`Timeframe override: ${block.timeframe}`] : []),
        ...buildSchemaDetailItems(indicator?.paramSchema ?? [], block.indicatorParams),
        ...buildSchemaDetailItems(condition?.paramSchema ?? [], block.conditionParams),
    ];

    return {
        id: block.id,
        stepLabel: `Condition ${index + 1}`,
        indicatorLabel,
        conditionLabel,
        description,
        detailItems,
    };
});
