import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { createDefaultBlockRegistry } from './createDefaultBlockRegistry';

const ASCII_ONLY = /^[\x00-\x7F]*$/;

describe('createDefaultBlockRegistry', () => {
    it('uses ASCII English display copy for built-in indicator metadata', () => {
        const definitions = createDefaultBlockRegistry().listDefinitions();

        assert.ok(definitions.length > 0, 'expected built-in indicator definitions to be registered');

        for (const definition of definitions) {
            assert.match(
                definition.name,
                ASCII_ONLY,
                `indicator ${definition.id} name should stay ASCII/English for web rendering`,
            );
            assert.match(
                definition.description,
                ASCII_ONLY,
                `indicator ${definition.id} description should stay ASCII/English for web rendering`,
            );

            for (const field of definition.paramSchema) {
                assert.match(
                    field.label,
                    ASCII_ONLY,
                    `indicator ${definition.id} param label ${field.id} should stay ASCII/English`,
                );
            }

            for (const condition of definition.conditions) {
                assert.match(
                    condition.name,
                    ASCII_ONLY,
                    `indicator ${definition.id} condition ${condition.id} name should stay ASCII/English`,
                );
                assert.match(
                    condition.description,
                    ASCII_ONLY,
                    `indicator ${definition.id} condition ${condition.id} description should stay ASCII/English`,
                );

                for (const field of condition.paramSchema) {
                    assert.match(
                        field.label,
                        ASCII_ONLY,
                        `indicator ${definition.id} condition ${condition.id} param ${field.id} label should stay ASCII/English`,
                    );
                }
            }
        }
    });

    it('registers the Dow Theory Structure block in the built-in registry', () => {
        const definition = createDefaultBlockRegistry()
            .listDefinitions()
            .find((item) => item.id === 'DOW_THEORY_STRUCTURE');

        assert.ok(definition);
        assert.equal(definition?.name, 'Dow Theory Structure (Single-Asset MVP)');
        assert.deepEqual(
            definition?.conditions.map((condition) => condition.id),
            [
                'primary_uptrend_confirmed',
                'primary_downtrend_confirmed',
                'bullish_reversal_warning',
                'bearish_reversal_warning',
                'bullish_reversal_confirmed',
                'bearish_reversal_confirmed',
            ],
        );
    });

    it('registers the Previous Period Levels block in the built-in registry', () => {
        const definition = createDefaultBlockRegistry()
            .listDefinitions()
            .find((item) => item.id === 'PD_LEVELS');

        assert.ok(definition);
        assert.equal(definition?.name, 'Previous Period Levels');
        assert.deepEqual(
            definition?.conditions.map((condition) => condition.id),
            [
                'touches_previous_day_high',
                'touches_previous_day_low',
                'closes_above_previous_day_high',
                'closes_below_previous_day_low',
                'closes_above_previous_day_midpoint',
                'closes_below_previous_day_midpoint',
                'bullish_reclaim_previous_day_low',
                'bearish_reclaim_previous_day_high',
                'bullish_sweep_reclaim_previous_day_low',
                'bearish_sweep_reclaim_previous_day_high',
                'touches_previous_week_high',
                'touches_previous_week_low',
                'closes_above_previous_week_high',
                'closes_below_previous_week_low',
            ],
        );
    });

    it('registers the ATR regime and session range blocks in the built-in registry', () => {
        const definitions = createDefaultBlockRegistry().listDefinitions();

        assert.ok(definitions.find((item) => item.id === 'ATR_REGIME'));
        assert.ok(definitions.find((item) => item.id === 'SESSION_RANGE_STRUCTURE'));
        assert.ok(definitions.find((item) => item.id === 'SMART_TRAIL_SWITCH'));
        assert.ok(definitions.find((item) => item.id === 'CONFIRMATION_TREND'));
        assert.ok(definitions.find((item) => item.id === 'TREND_CATCHER'));
        assert.ok(definitions.find((item) => item.id === 'VOLMAN_PRICE_ACTION'));
    });

    it('registers the Volman Price Action block with buildup and trap conditions', () => {
        const definition = createDefaultBlockRegistry()
            .listDefinitions()
            .find((item) => item.id === 'VOLMAN_PRICE_ACTION');

        assert.ok(definition);
        assert.equal(definition?.name, 'Volman Price Action');
        assert.deepEqual(
            definition?.conditions.map((condition) => condition.id),
            [
                'bullish_pressure_buildup',
                'bearish_pressure_buildup',
                'bullish_buildup_breakout',
                'bearish_buildup_breakout',
                'bullish_false_break_reversal',
                'bearish_false_break_reversal',
            ],
        );
    });
});
