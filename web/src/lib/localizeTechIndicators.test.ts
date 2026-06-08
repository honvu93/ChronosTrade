import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { localizeTechIndicatorDefinitions } from "./localizeTechIndicators.js";
import type { TechIndicatorDefinition } from "@/types/signals.js";

const indicatorDefinitions: TechIndicatorDefinition[] = [
    {
        id: "RSI",
        name: "Relative Strength Index",
        category: "momentum",
        description: "English fallback description",
        paramSchema: [
            { id: "period", type: "number", label: "Period", default: 14 },
        ],
        conditions: [
            {
                id: "value_above",
                name: "Above",
                description: "English condition",
                paramSchema: [
                    { id: "threshold", type: "number", label: "Threshold", default: 70 },
                ],
            },
        ],
    },
    {
        id: "CUSTOM",
        name: "Custom Indicator",
        category: "utility",
        description: "Custom description",
        paramSchema: [],
        conditions: [
            {
                id: "custom_condition",
                name: "Custom condition",
                description: "Custom condition description",
                paramSchema: [],
            },
        ],
    },
    {
        id: "ATR_REGIME",
        name: "ATR Volatility Regime",
        category: "volatility",
        description: "ATR fallback description",
        paramSchema: [
            { id: "atrPeriod", type: "number", label: "ATR Period", default: 14 },
        ],
        conditions: [
            {
                id: "atr_expansion",
                name: "ATR Expansion",
                description: "ATR expansion fallback",
                paramSchema: [
                    { id: "multiplier", type: "number", label: "Multiplier", default: 1.2 },
                ],
            },
        ],
    },
];

describe("localizeTechIndicatorDefinitions", () => {
    it("localizes known indicator metadata while preserving stable ids", () => {
        const localized = localizeTechIndicatorDefinitions(indicatorDefinitions, "vi");

        assert.equal(localized[0]?.id, "RSI");
        assert.notEqual(localized[0]?.name, indicatorDefinitions[0]?.name);
        assert.notEqual(localized[0]?.description, indicatorDefinitions[0]?.description);
        assert.notEqual(localized[0]?.paramSchema[0]?.label, indicatorDefinitions[0]?.paramSchema[0]?.label);
        assert.notEqual(localized[0]?.conditions[0]?.name, indicatorDefinitions[0]?.conditions[0]?.name);
        assert.notEqual(localized[0]?.conditions[0]?.description, indicatorDefinitions[0]?.conditions[0]?.description);
    });

    it("localizes newly added ATR regime metadata", () => {
        const localized = localizeTechIndicatorDefinitions(indicatorDefinitions, "vi");

        assert.notEqual(localized[2]?.name, indicatorDefinitions[2]?.name);
        assert.notEqual(localized[2]?.description, indicatorDefinitions[2]?.description);
        assert.notEqual(localized[2]?.paramSchema[0]?.label, indicatorDefinitions[2]?.paramSchema[0]?.label);
        assert.notEqual(localized[2]?.conditions[0]?.name, indicatorDefinitions[2]?.conditions[0]?.name);
    });

    it("falls back to the original metadata for unknown indicators", () => {
        const localized = localizeTechIndicatorDefinitions(indicatorDefinitions, "vi");

        assert.deepEqual(localized[1], indicatorDefinitions[1]);
    });
});
