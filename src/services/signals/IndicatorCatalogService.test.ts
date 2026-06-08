import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { Prisma, PrismaClient } from '@prisma/client';
import { IndicatorCatalogService, IndicatorCatalogServiceError } from './IndicatorCatalogService';
import { TechIndicatorDefinition } from './blocks/TechIndicatorBlock';
import { TechIndicatorRegistry } from './blocks/TechIndicatorRegistry';
import { atrRegimeBlock } from './blocks/plugins/AtrRegimeBlock';
import { dowTheoryStructureBlock } from './blocks/plugins/DowTheoryStructureBlock';
import { previousPeriodLevelsBlock } from './blocks/plugins/PreviousPeriodLevelsBlock';

type CatalogRow = {
    id: string;
    name: string;
    category: string;
    description: string | null;
    draftName: string | null;
    draftCategory: string | null;
    draftDescription: string | null;
    paramSchema: unknown;
    draftParamSchema: unknown;
    conditions: unknown;
    draftConditions: unknown;
    runtimeBindingKey: string | null;
    draftRuntimeBindingKey: string | null;
    catalogStatus: string;
    isActive: boolean;
    createdBy: string | null;
    createdAt: Date;
    updatedAt: Date;
    updatedBy: string | null;
    draftUpdatedAt: Date | null;
    draftUpdatedBy: string | null;
    publishedAt: Date | null;
    publishedBy: string | null;
    retiredAt: Date | null;
    retiredBy: string | null;
};

type SignalDefinitionRow = {
    id: string;
    code: string;
    version: number;
    name: string;
    isActive: boolean;
    composedBlocks: unknown;
};

function projectRow<T extends Record<string, unknown>>(row: T, select?: Record<string, boolean>) {
    if (!select) {
        return { ...row };
    }

    return Object.fromEntries(
        Object.entries(select)
            .filter(([, enabled]) => enabled)
            .map(([key]) => [key, row[key]]),
    );
}

function createPrismaMock(initialCatalogRows: CatalogRow[], initialSignalRows: SignalDefinitionRow[] = []) {
    const catalogRows = initialCatalogRows.map((row) => ({ ...row }));
    const signalRows = initialSignalRows.map((row) => ({ ...row }));
    const calls = {
        create: 0,
        update: 0,
        delete: 0,
    };

    const prismaLike = {
        __calls: calls,
        techIndicatorDefinition: {
            findMany: async (args: {
                where?: {
                    id?: { in?: string[] };
                    catalogStatus?: string;
                    isActive?: boolean;
                };
                select?: Record<string, boolean>;
            } = {}) => {
                const filtered = catalogRows.filter((row) => (
                    (!args.where?.catalogStatus || row.catalogStatus === args.where.catalogStatus)
                    && (args.where?.isActive === undefined || row.isActive === args.where.isActive)
                    && (!args.where?.id?.in || args.where.id.in.includes(row.id))
                ));

                return filtered.map((row) => projectRow(row, args.select));
            },
            findUnique: async (args: { where: { id: string }; select?: Record<string, boolean> }) => {
                const row = catalogRows.find((candidate) => candidate.id === args.where.id) ?? null;
                return row ? projectRow(row, args.select) : null;
            },
            create: async (args: { data: Partial<CatalogRow> & Pick<CatalogRow, 'id' | 'name' | 'category' | 'paramSchema' | 'conditions' | 'catalogStatus' | 'isActive'> }) => {
                calls.create += 1;
                const timestamp = new Date('2026-03-13T02:00:00.000Z');
                const row: CatalogRow = {
                    id: args.data.id,
                    name: args.data.name,
                    category: args.data.category,
                    description: args.data.description ?? null,
                    draftName: null,
                    draftCategory: null,
                    draftDescription: null,
                    paramSchema: args.data.paramSchema,
                    draftParamSchema: null,
                    conditions: args.data.conditions,
                    draftConditions: null,
                    runtimeBindingKey: args.data.runtimeBindingKey ?? null,
                    draftRuntimeBindingKey: null,
                    catalogStatus: args.data.catalogStatus,
                    isActive: args.data.isActive,
                    createdBy: args.data.createdBy ?? null,
                    createdAt: timestamp,
                    updatedAt: timestamp,
                    updatedBy: args.data.updatedBy ?? null,
                    draftUpdatedAt: null,
                    draftUpdatedBy: null,
                    publishedAt: (args.data as Partial<CatalogRow>).publishedAt ?? null,
                    publishedBy: (args.data as Partial<CatalogRow>).publishedBy ?? null,
                    retiredAt: null,
                    retiredBy: null,
                };
                catalogRows.push(row);
                return { ...row };
            },
            update: async (args: { where: { id: string }; data: Partial<CatalogRow> }) => {
                calls.update += 1;
                const row = catalogRows.find((candidate) => candidate.id === args.where.id)!;
                const nextData = {
                    ...args.data,
                    ...(args.data.draftParamSchema === Prisma.DbNull ? { draftParamSchema: null } : {}),
                    ...(args.data.draftConditions === Prisma.DbNull ? { draftConditions: null } : {}),
                };
                Object.assign(row, nextData, {
                    updatedAt: new Date('2026-03-13T03:00:00.000Z'),
                });
                return { ...row };
            },
            delete: async (args: { where: { id: string } }) => {
                calls.delete += 1;
                const index = catalogRows.findIndex((candidate) => candidate.id === args.where.id);
                const [deleted] = catalogRows.splice(index, 1);
                return deleted;
            },
        },
        signalDefinition: {
            findMany: async (args: { select?: Record<string, boolean> } = {}) => (
                signalRows.map((row) => projectRow(row, args.select))
            ),
        },
    };

    return prismaLike as unknown as PrismaClient & { __calls: typeof calls };
}

function registerStaticBlock(registry: TechIndicatorRegistry, definition: TechIndicatorDefinition) {
    registry.register({
        definition,
        initialize: () => ({}),
        evaluate: () => ({
            state: {},
            isActive: false,
            values: {},
        }),
    });
}

function createRegistry(options: { includeDowTheory?: boolean; includePreviousPeriodLevels?: boolean; includeAtrRegime?: boolean } = {}) {
    const registry = new TechIndicatorRegistry();
    registerStaticBlock(registry, {
        id: 'RSI',
        name: 'Relative Strength Index',
        category: 'momentum',
        description: 'Momentum oscillator',
        paramSchema: [
            { id: 'period', type: 'number', label: 'Period', default: 14, min: 1, max: 100, step: 1 },
        ],
        conditions: [
            {
                id: 'value_above',
                name: 'Value Above',
                description: 'Checks whether RSI is above a threshold.',
                paramSchema: [
                    { id: 'threshold', type: 'number', label: 'Threshold', default: 70, min: 1, max: 100, step: 1 },
                ],
            },
        ],
    });

    if (options.includeDowTheory) {
        registerStaticBlock(registry, dowTheoryStructureBlock.definition);
    }

    if (options.includePreviousPeriodLevels) {
        registerStaticBlock(registry, previousPeriodLevelsBlock.definition);
    }

    if (options.includeAtrRegime) {
        registerStaticBlock(registry, atrRegimeBlock.definition);
    }

    return registry;
}

function makeCatalogRow(overrides: Partial<CatalogRow> = {}): CatalogRow {
    return {
        id: 'RSI_ALIAS',
        name: 'RSI Alias',
        category: 'momentum',
        description: 'Alias for RSI',
        draftName: null,
        draftCategory: null,
        draftDescription: null,
        paramSchema: [
            { id: 'period', type: 'number', label: 'Period', default: 14, min: 1, max: 100, step: 1 },
        ],
        draftParamSchema: null,
        conditions: [
            {
                id: 'value_above',
                name: 'Value Above',
                description: 'Checks whether RSI is above a threshold.',
                paramSchema: [
                    { id: 'threshold', type: 'number', label: 'Threshold', default: 70, min: 1, max: 100, step: 1 },
                ],
            },
        ],
        draftConditions: null,
        runtimeBindingKey: 'RSI',
        draftRuntimeBindingKey: null,
        catalogStatus: 'PUBLISHED',
        isActive: true,
        createdBy: 'admin-1',
        createdAt: new Date('2026-03-13T01:00:00.000Z'),
        updatedAt: new Date('2026-03-13T01:10:00.000Z'),
        updatedBy: 'admin-1',
        draftUpdatedAt: null,
        draftUpdatedBy: null,
        publishedAt: new Date('2026-03-13T01:15:00.000Z'),
        publishedBy: 'admin-1',
        retiredAt: null,
        retiredBy: null,
        ...overrides,
    };
}

function makeDowTheoryCatalogRow(overrides: Partial<CatalogRow> = {}): CatalogRow {
    return makeCatalogRow({
        id: 'DOW_THEORY_STRUCTURE',
        name: dowTheoryStructureBlock.definition.name,
        category: dowTheoryStructureBlock.definition.category,
        description: dowTheoryStructureBlock.definition.description,
        runtimeBindingKey: 'DOW_THEORY_STRUCTURE',
        paramSchema: dowTheoryStructureBlock.definition.paramSchema,
        conditions: dowTheoryStructureBlock.definition.conditions,
        catalogStatus: 'PUBLISHED',
        isActive: true,
        createdBy: 'system:indicator-catalog-sync',
        updatedBy: 'system:indicator-catalog-sync',
        publishedAt: new Date('2026-03-13T01:15:00.000Z'),
        publishedBy: 'system:indicator-catalog-sync',
        ...overrides,
    });
}

function makePreviousPeriodLevelsCatalogRow(overrides: Partial<CatalogRow> = {}): CatalogRow {
    return makeCatalogRow({
        id: 'PD_LEVELS',
        name: previousPeriodLevelsBlock.definition.name,
        category: previousPeriodLevelsBlock.definition.category,
        description: previousPeriodLevelsBlock.definition.description,
        runtimeBindingKey: 'PD_LEVELS',
        paramSchema: previousPeriodLevelsBlock.definition.paramSchema,
        conditions: previousPeriodLevelsBlock.definition.conditions,
        catalogStatus: 'PUBLISHED',
        isActive: true,
        createdBy: 'system:indicator-catalog-sync',
        updatedBy: 'system:indicator-catalog-sync',
        publishedAt: new Date('2026-03-13T01:15:00.000Z'),
        publishedBy: 'system:indicator-catalog-sync',
        ...overrides,
    });
}

function makeAtrRegimeCatalogRow(overrides: Partial<CatalogRow> = {}): CatalogRow {
    return makeCatalogRow({
        id: 'ATR_REGIME',
        name: atrRegimeBlock.definition.name,
        category: atrRegimeBlock.definition.category,
        description: atrRegimeBlock.definition.description,
        runtimeBindingKey: 'ATR_REGIME',
        paramSchema: atrRegimeBlock.definition.paramSchema,
        conditions: atrRegimeBlock.definition.conditions,
        catalogStatus: 'PUBLISHED',
        isActive: true,
        createdBy: 'system:indicator-catalog-sync',
        updatedBy: 'system:indicator-catalog-sync',
        publishedAt: new Date('2026-03-13T01:15:00.000Z'),
        publishedBy: 'system:indicator-catalog-sync',
        ...overrides,
    });
}

describe('IndicatorCatalogService', () => {
    it('syncs missing runtime definitions as published on first bootstrap and as draft afterward', async () => {
        const bootstrapPrisma = createPrismaMock([]);
        const bootstrapService = new IndicatorCatalogService(bootstrapPrisma, createRegistry());

        await bootstrapService.syncCatalogFromRuntime();
        const bootstrapRows = await bootstrapService.listAdminCatalog();

        assert.equal(bootstrapRows[0]?.catalogStatus, 'PUBLISHED');
        assert.equal(bootstrapRows[0]?.isActive, true);

        const governedPrisma = createPrismaMock([makeCatalogRow()]);
        const governedService = new IndicatorCatalogService(governedPrisma, createRegistry());

        await governedService.syncCatalogFromRuntime();
        const rows = await governedService.listAdminCatalog();
        const seededRuntimeRow = rows.find((row) => row.id === 'RSI');

        assert.equal(seededRuntimeRow?.catalogStatus, 'DRAFT');
        assert.equal(seededRuntimeRow?.isActive, false);
    });

    it('system-publishes the Dow Theory runtime row on governed sync without changing generic runtime defaults', async () => {
        const governedPrisma = createPrismaMock([makeCatalogRow()]);
        const service = new IndicatorCatalogService(governedPrisma, createRegistry({ includeDowTheory: true }));

        await service.syncCatalogFromRuntime();
        const rows = await service.listAdminCatalog();
        const rsiRuntimeRow = rows.find((row) => row.id === 'RSI');
        const dowRuntimeRow = rows.find((row) => row.id === 'DOW_THEORY_STRUCTURE');

        assert.equal(rsiRuntimeRow?.catalogStatus, 'DRAFT');
        assert.equal(rsiRuntimeRow?.isActive, false);
        assert.equal(dowRuntimeRow?.catalogStatus, 'PUBLISHED');
        assert.equal(dowRuntimeRow?.isActive, true);
        assert.equal(dowRuntimeRow?.runtimeBindingKey, 'DOW_THEORY_STRUCTURE');
    });

    it('system-publishes the Previous Period Levels runtime row on governed sync without changing generic runtime defaults', async () => {
        const governedPrisma = createPrismaMock([makeCatalogRow()]);
        const service = new IndicatorCatalogService(governedPrisma, createRegistry({ includePreviousPeriodLevels: true }));

        await service.syncCatalogFromRuntime();
        const rows = await service.listAdminCatalog();
        const rsiRuntimeRow = rows.find((row) => row.id === 'RSI');
        const previousLevelsRow = rows.find((row) => row.id === 'PD_LEVELS');

        assert.equal(rsiRuntimeRow?.catalogStatus, 'DRAFT');
        assert.equal(rsiRuntimeRow?.isActive, false);
        assert.equal(previousLevelsRow?.catalogStatus, 'PUBLISHED');
        assert.equal(previousLevelsRow?.isActive, true);
        assert.equal(previousLevelsRow?.runtimeBindingKey, 'PD_LEVELS');
    });

    it('system-publishes the ATR Regime runtime row on governed sync for composer use', async () => {
        const governedPrisma = createPrismaMock([makeCatalogRow()]);
        const service = new IndicatorCatalogService(governedPrisma, createRegistry({ includeAtrRegime: true }));

        await service.syncCatalogFromRuntime();
        const rows = await service.listAdminCatalog();
        const atrRuntimeRow = rows.find((row) => row.id === 'ATR_REGIME');

        assert.equal(atrRuntimeRow?.catalogStatus, 'PUBLISHED');
        assert.equal(atrRuntimeRow?.isActive, true);
        assert.equal(atrRuntimeRow?.runtimeBindingKey, 'ATR_REGIME');
    });

    it('auto-publishes an existing system-seeded Dow Theory draft row safely', async () => {
        const service = new IndicatorCatalogService(createPrismaMock([
            makeCatalogRow(),
            makeDowTheoryCatalogRow({
                catalogStatus: 'DRAFT',
                isActive: false,
                publishedAt: null,
                publishedBy: null,
            }),
        ]), createRegistry({ includeDowTheory: true }));

        await service.syncCatalogFromRuntime();
        const rows = await service.listAdminCatalog();
        const dowRuntimeRow = rows.find((row) => row.id === 'DOW_THEORY_STRUCTURE');

        assert.equal(dowRuntimeRow?.catalogStatus, 'PUBLISHED');
        assert.equal(dowRuntimeRow?.isActive, true);
        assert.equal(dowRuntimeRow?.publishedBy, 'system:indicator-catalog-sync');
    });

    it('refreshes a stale system-managed Dow Theory row and returns it from the public catalog for composer use', async () => {
        const staleDowRow = makeDowTheoryCatalogRow({
            description: 'Stale schema snapshot',
            conditions: [
                {
                    id: 'legacy_condition',
                    name: 'Legacy Condition',
                    description: 'Old schema that should no longer match runtime.',
                    paramSchema: [],
                },
            ],
        });
        const service = new IndicatorCatalogService(createPrismaMock([
            makeCatalogRow(),
            staleDowRow,
        ]), createRegistry({ includeDowTheory: true }));

        const publicBeforeSync = await service.listPublicCatalog();
        assert.equal(publicBeforeSync.some((item) => item.id === 'DOW_THEORY_STRUCTURE'), false);

        await service.syncCatalogFromRuntime();
        const publicAfterSync = await service.listPublicCatalog();
        const dowRuntimeRow = publicAfterSync.find((item) => item.id === 'DOW_THEORY_STRUCTURE');

        assert.ok(dowRuntimeRow, 'expected refreshed Dow Theory row to be composer-visible');
        assert.equal(dowRuntimeRow?.name, 'Dow Theory Structure (Single-Asset MVP)');
        assert.deepEqual(
            dowRuntimeRow?.conditions.map((condition) => condition.id),
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

    it('refreshes a stale system-managed Previous Period Levels row and returns it from the public catalog for composer use', async () => {
        const stalePreviousLevelsRow = makePreviousPeriodLevelsCatalogRow({
            description: 'Stale schema snapshot',
            conditions: [
                {
                    id: 'legacy_previous_level_condition',
                    name: 'Legacy Previous Level Condition',
                    description: 'Old schema that should no longer match runtime.',
                    paramSchema: [],
                },
            ],
        });
        const service = new IndicatorCatalogService(createPrismaMock([
            makeCatalogRow(),
            stalePreviousLevelsRow,
        ]), createRegistry({ includePreviousPeriodLevels: true }));

        const publicBeforeSync = await service.listPublicCatalog();
        assert.equal(publicBeforeSync.some((item) => item.id === 'PD_LEVELS'), false);

        await service.syncCatalogFromRuntime();
        const publicAfterSync = await service.listPublicCatalog();
        const previousLevelsRow = publicAfterSync.find((item) => item.id === 'PD_LEVELS');

        assert.ok(previousLevelsRow, 'expected refreshed Previous Period Levels row to be composer-visible');
        assert.equal(previousLevelsRow?.name, 'Previous Period Levels');
        assert.deepEqual(
            previousLevelsRow?.conditions.map((condition) => condition.id),
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

    it('refreshes a stale ATR Regime row and returns it from the public catalog for composer use', async () => {
        const staleAtrRow = makeAtrRegimeCatalogRow({
            description: 'Stale ATR schema snapshot',
            conditions: [
                {
                    id: 'legacy_atr_condition',
                    name: 'Legacy ATR Condition',
                    description: 'Old schema that should no longer match runtime.',
                    paramSchema: [],
                },
            ],
        });
        const service = new IndicatorCatalogService(createPrismaMock([
            makeCatalogRow(),
            staleAtrRow,
        ]), createRegistry({ includeAtrRegime: true }));

        const publicBeforeSync = await service.listPublicCatalog();
        assert.equal(publicBeforeSync.some((item) => item.id === 'ATR_REGIME'), false);

        await service.syncCatalogFromRuntime();
        const publicAfterSync = await service.listPublicCatalog();
        const atrRuntimeRow = publicAfterSync.find((item) => item.id === 'ATR_REGIME');

        assert.ok(atrRuntimeRow, 'expected refreshed ATR Regime row to be composer-visible');
        assert.equal(atrRuntimeRow?.name, 'ATR Volatility Regime');
        assert.deepEqual(
            atrRuntimeRow?.conditions.map((condition) => condition.id),
            ['atr_low', 'atr_normal', 'atr_expansion'],
        );
    });

    it('keeps public catalog reads side-effect free and preserves published live data while draft changes are pending', async () => {
        const prisma = createPrismaMock([
            makeCatalogRow({
                draftDescription: 'Pending draft description',
                draftConditions: [
                    {
                        id: 'VALUE_ABOVE',
                        name: 'Value Above',
                        description: 'Broken pending draft casing.',
                        paramSchema: [],
                    },
                ],
                draftUpdatedAt: new Date('2026-03-13T02:00:00.000Z'),
                draftUpdatedBy: 'admin-2',
            }),
        ]);
        const service = new IndicatorCatalogService(prisma, createRegistry());

        const catalog = await service.listPublicCatalog();

        assert.deepEqual(catalog.map((item) => item.description), ['Alias for RSI']);
        assert.equal(prisma.__calls.create, 0);
        assert.equal(prisma.__calls.update, 0);
    });

    it('stores edits on published items as draft overlay and only swaps live catalog fields on publish', async () => {
        const prisma = createPrismaMock([makeCatalogRow()]);
        const service = new IndicatorCatalogService(prisma, createRegistry());

        const updated = await service.updateDraft('admin-2', 'RSI_ALIAS', {
            description: 'Pending published description',
        });
        const publicBeforePublish = await service.listPublicCatalog();
        const published = await service.publish('admin-2', 'RSI_ALIAS');
        const publicAfterPublish = await service.listPublicCatalog();

        assert.equal(updated.catalogStatus, 'PUBLISHED');
        assert.equal(updated.isActive, true);
        assert.equal(updated.hasDraftChanges, true);
        assert.equal(updated.description, 'Pending published description');
        assert.equal(publicBeforePublish[0]?.description, 'Alias for RSI');

        assert.equal(published.hasDraftChanges, false);
        assert.equal(publicAfterPublish[0]?.description, 'Pending published description');
    });

    it('preserves lower-case runtime condition ids during validation even when a draft overlay is invalid', async () => {
        const service = new IndicatorCatalogService(createPrismaMock([
            makeCatalogRow({
                draftConditions: [
                    {
                        id: 'VALUE_ABOVE',
                        name: 'Value Above',
                        description: 'Broken pending draft casing.',
                        paramSchema: [],
                    },
                ],
                draftUpdatedAt: new Date('2026-03-13T02:00:00.000Z'),
                draftUpdatedBy: 'admin-2',
            }),
        ]), createRegistry());

        const issues = await service.validateComposedSignalBlocks({
            matchMode: 'ALL',
            windowBars: 2,
            side: 'LONG',
            blocks: [{
                id: 'block-1',
                indicatorId: 'RSI_ALIAS',
                conditionId: 'value_above',
                indicatorParams: {},
                conditionParams: {},
            }],
            stopLoss: { type: 'FIXED_PERCENT', value: 0.01 },
            takeProfit: { type: 'R_MULTIPLE', value: 2 },
        });

        assert.equal(issues.length, 0);
    });

    it('blocks composed-signal authoring when the Dow Theory catalog row is unpublished', async () => {
        const service = new IndicatorCatalogService(createPrismaMock([
            makeDowTheoryCatalogRow({
                catalogStatus: 'DRAFT',
                isActive: false,
                publishedAt: null,
                publishedBy: null,
            }),
        ]), createRegistry({ includeDowTheory: true }));

        const issues = await service.validateComposedSignalBlocks({
            matchMode: 'ALL',
            windowBars: 2,
            side: 'LONG',
            blocks: [{
                id: 'block-1',
                indicatorId: 'DOW_THEORY_STRUCTURE',
                conditionId: 'primary_uptrend_confirmed',
                indicatorParams: {},
                conditionParams: {},
            }],
            stopLoss: { type: 'FIXED_PERCENT', value: 0.01 },
            takeProfit: { type: 'R_MULTIPLE', value: 2 },
        });

        assert.equal(issues.length, 1);
        assert.match(issues[0]!.message, /not published/i);
    });

    it('blocks composed-signal authoring when the Dow Theory runtime binding is broken', async () => {
        const service = new IndicatorCatalogService(createPrismaMock([
            makeDowTheoryCatalogRow({
                runtimeBindingKey: 'UNKNOWN_DOW_RUNTIME',
            }),
        ]), createRegistry({ includeDowTheory: true }));

        const issues = await service.validateComposedSignalBlocks({
            matchMode: 'ALL',
            windowBars: 2,
            side: 'LONG',
            blocks: [{
                id: 'block-1',
                indicatorId: 'DOW_THEORY_STRUCTURE',
                conditionId: 'primary_uptrend_confirmed',
                indicatorParams: {},
                conditionParams: {},
            }],
            stopLoss: { type: 'FIXED_PERCENT', value: 0.01 },
            takeProfit: { type: 'R_MULTIPLE', value: 2 },
        });

        assert.equal(issues.length, 1);
        assert.match(issues[0]!.message, /broken runtime binding/i);
    });

    it('blocks publish when the runtime binding is missing', async () => {
        const service = new IndicatorCatalogService(createPrismaMock([
            makeCatalogRow({
                id: 'CUSTOM_BLOCK',
                runtimeBindingKey: 'UNKNOWN_BLOCK',
                catalogStatus: 'DRAFT',
                isActive: false,
                publishedAt: null,
                publishedBy: null,
            }),
        ]), createRegistry());

        await assert.rejects(
            () => service.publish('admin-2', 'CUSTOM_BLOCK'),
            (error: unknown) => (
                error instanceof IndicatorCatalogServiceError
                && error.code === 'INDICATOR_CATALOG_PUBLISH_BLOCKED'
                && error.reasons.some((reason) => reason.includes('UNKNOWN_BLOCK'))
            ),
        );
    });

    it('blocks hard delete when composed signals still reference the catalog item', async () => {
        const service = new IndicatorCatalogService(createPrismaMock([
            makeCatalogRow({
                id: 'RSI_DRAFT',
                catalogStatus: 'DRAFT',
                isActive: false,
                publishedAt: null,
                publishedBy: null,
            }),
        ], [{
            id: 'signal-def-1',
            code: 'COMPOSED_A',
            version: 1,
            name: 'Composed A',
            isActive: true,
            composedBlocks: {
                blocks: [
                    { indicatorId: 'RSI_DRAFT', conditionId: 'value_above' },
                ],
            },
        }]), createRegistry());

        await assert.rejects(
            () => service.delete('admin-2', 'RSI_DRAFT'),
            (error: unknown) => (
                error instanceof IndicatorCatalogServiceError
                && error.code === 'INDICATOR_CATALOG_DELETE_BLOCKED'
                && error.reasons.some((reason) => reason.includes('reference'))
            ),
        );
    });

    it('allows hard delete for unused drafts that were never published', async () => {
        const service = new IndicatorCatalogService(createPrismaMock([
            makeCatalogRow({
                id: 'UNUSED_DRAFT',
                catalogStatus: 'DRAFT',
                isActive: false,
                publishedAt: null,
                publishedBy: null,
            }),
        ]), createRegistry());

        const deleted = await service.delete('admin-3', 'UNUSED_DRAFT');

        assert.deepEqual(deleted, {
            id: 'UNUSED_DRAFT',
            deletedBy: 'admin-3',
        });
    });
});
