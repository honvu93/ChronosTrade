import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBlockParamSchemas } from './resolveBlockParamSchemas';
import { TechIndicatorRegistry } from './blocks/TechIndicatorRegistry';
import { FieldSchema, TechIndicatorBlock } from './blocks/TechIndicatorBlock';

const createMockBlock = (id: string, paramSchema: FieldSchema[]): TechIndicatorBlock => ({
    definition: {
        id,
        name: `${id} Indicator`,
        category: 'momentum',
        description: `Mock ${id} indicator`,
        paramSchema,
        conditions: [
            { id: 'crosses_above', name: 'Crosses Above', description: 'Test condition', paramSchema: [] },
        ],
    },
    initialize: () => ({}),
    evaluate: () => ({ state: {}, isActive: false, values: {} }),
});

describe('resolveBlockParamSchemas', () => {
    it('returns per-block param schemas from registry for composed blocks', () => {
        const registry = new TechIndicatorRegistry();
        registry.register(createMockBlock('RSI', [
            { id: 'period', type: 'number', label: 'Period', default: 14, min: 2, max: 100, step: 1 },
            { id: 'overbought', type: 'number', label: 'Overbought', default: 70, min: 50, max: 100, step: 1 },
        ]));
        registry.register(createMockBlock('EMA_CROSS', [
            { id: 'fastPeriod', type: 'number', label: 'Fast Period', default: 9, min: 2, max: 200, step: 1 },
            { id: 'slowPeriod', type: 'number', label: 'Slow Period', default: 21, min: 2, max: 200, step: 1 },
        ]));

        const composedBlocks = {
            matchMode: 'ALL' as const,
            windowBars: 5,
            side: 'LONG' as const,
            blocks: [
                { id: 'block-1', indicatorId: 'RSI', conditionId: 'crosses_above', indicatorParams: { period: 14 }, conditionParams: {} },
                { id: 'block-2', indicatorId: 'EMA_CROSS', conditionId: 'crosses_above', indicatorParams: { fastPeriod: 9, slowPeriod: 21 }, conditionParams: {} },
            ],
            stopLoss: { type: 'FIXED_PERCENT' as const, value: 1 },
            takeProfit: { type: 'R_MULTIPLE' as const, value: 2 },
        };

        const result = resolveBlockParamSchemas(composedBlocks, registry);

        assert.equal(result.length, 2);

        assert.equal(result[0].blockId, 'block-1');
        assert.equal(result[0].indicatorId, 'RSI');
        assert.equal(result[0].indicatorName, 'RSI Indicator');
        assert.equal(result[0].paramSchema.length, 2);
        assert.equal(result[0].paramSchema[0].id, 'period');
        assert.equal(result[0].paramSchema[0].min, 2);
        assert.equal(result[0].paramSchema[0].max, 100);

        assert.equal(result[1].blockId, 'block-2');
        assert.equal(result[1].indicatorId, 'EMA_CROSS');
        assert.equal(result[1].paramSchema.length, 2);
    });

    it('returns empty array when composedBlocks is null/undefined', () => {
        const registry = new TechIndicatorRegistry();

        assert.deepEqual(resolveBlockParamSchemas(null, registry), []);
        assert.deepEqual(resolveBlockParamSchemas(undefined, registry), []);
    });

    it('skips blocks whose indicator is not in registry', () => {
        const registry = new TechIndicatorRegistry();
        registry.register(createMockBlock('RSI', [
            { id: 'period', type: 'number', label: 'Period', default: 14, min: 2, max: 100, step: 1 },
        ]));

        const composedBlocks = {
            matchMode: 'ALL' as const,
            windowBars: 5,
            side: 'LONG' as const,
            blocks: [
                { id: 'block-1', indicatorId: 'RSI', conditionId: 'crosses_above', indicatorParams: { period: 14 }, conditionParams: {} },
                { id: 'block-2', indicatorId: 'UNKNOWN_INDICATOR', conditionId: 'test', indicatorParams: {}, conditionParams: {} },
            ],
            stopLoss: { type: 'FIXED_PERCENT' as const, value: 1 },
            takeProfit: { type: 'R_MULTIPLE' as const, value: 2 },
        };

        const result = resolveBlockParamSchemas(composedBlocks, registry);

        assert.equal(result.length, 1);
        assert.equal(result[0].blockId, 'block-1');
    });

    it('merges current indicatorParams as defaults into paramSchema', () => {
        const registry = new TechIndicatorRegistry();
        registry.register(createMockBlock('RSI', [
            { id: 'period', type: 'number', label: 'Period', default: 14, min: 2, max: 100, step: 1 },
        ]));

        const composedBlocks = {
            matchMode: 'ALL' as const,
            windowBars: 5,
            side: 'LONG' as const,
            blocks: [
                { id: 'block-1', indicatorId: 'RSI', conditionId: 'crosses_above', indicatorParams: { period: 21 }, conditionParams: {} },
            ],
            stopLoss: { type: 'FIXED_PERCENT' as const, value: 1 },
            takeProfit: { type: 'R_MULTIPLE' as const, value: 2 },
        };

        const result = resolveBlockParamSchemas(composedBlocks, registry);

        // The default should reflect the current indicatorParams (21), not the schema default (14)
        assert.equal(result[0].paramSchema[0].default, 21);
    });
});
