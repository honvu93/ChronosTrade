import {
    Prisma,
    PrismaClient,
    TechIndicatorDefinition as TechIndicatorCatalogRow,
} from '@prisma/client';
import { ComposedSignalDefinition } from './ComposedSignalPlugin';
import { ComposedSignalValidationIssue } from './composedSignalValidation';
import {
    ConditionDef,
    FieldSchema,
    TechIndicatorDefinition as RuntimeTechIndicatorDefinition,
} from './blocks/TechIndicatorBlock';
import { TechIndicatorRegistry } from './blocks/TechIndicatorRegistry';

const SYSTEM_ACTOR = 'system:indicator-catalog-sync';
const FIELD_TYPES = new Set(['number', 'string', 'boolean', 'select']);
const SYSTEM_PUBLISHED_RUNTIME_IDS = new Set([
    'DOW_THEORY_STRUCTURE',
    'PD_LEVELS',
    'SESSION_RANGE_STRUCTURE',
    'ATR_REGIME',
    'SMART_TRAIL_SWITCH',
    'CONFIRMATION_TREND',
    'TREND_CATCHER',
]);

export type IndicatorCatalogLifecycleStatus = 'DRAFT' | 'PUBLISHED' | 'RETIRED';
export type IndicatorCatalogBindingStatus =
    | 'MATCHED'
    | 'MISSING_BINDING'
    | 'MISSING_RUNTIME'
    | 'SCHEMA_MISMATCH';

export interface IndicatorCatalogFieldOption {
    value: string;
    label: string;
}

export interface IndicatorCatalogFieldSchema {
    id: string;
    type: 'number' | 'string' | 'boolean' | 'select';
    label: string;
    default?: number | string | boolean;
    min?: number;
    max?: number;
    step?: number;
    options?: IndicatorCatalogFieldOption[];
    required?: boolean;
}

export interface IndicatorCatalogConditionDefinition {
    id: string;
    name: string;
    description: string;
    paramSchema: IndicatorCatalogFieldSchema[];
}

export interface IndicatorCatalogDependencyReference {
    signalDefinitionId: string;
    signalCode: string;
    signalVersion: number;
    signalName: string;
    isActive: boolean;
    blockCount: number;
}

export interface IndicatorCatalogDependencySummary {
    totalSignals: number;
    activeSignals: number;
    inactiveSignals: number;
    references: IndicatorCatalogDependencyReference[];
}

export interface IndicatorCatalogDiagnostics {
    bindingStatus: IndicatorCatalogBindingStatus;
    bindingMessage: string;
    composerAvailable: boolean;
    publishBlockingReasons: string[];
    deleteBlockingReasons: string[];
}

export interface IndicatorCatalogRecord {
    id: string;
    name: string;
    category: string;
    description: string;
    runtimeBindingKey: string | null;
    catalogStatus: IndicatorCatalogLifecycleStatus;
    isActive: boolean;
    hasDraftChanges: boolean;
    paramSchema: IndicatorCatalogFieldSchema[];
    conditions: IndicatorCatalogConditionDefinition[];
    createdAt: string;
    createdBy: string | null;
    updatedAt: string;
    updatedBy: string | null;
    draftUpdatedAt: string | null;
    draftUpdatedBy: string | null;
    publishedAt: string | null;
    publishedBy: string | null;
    retiredAt: string | null;
    retiredBy: string | null;
    diagnostics: IndicatorCatalogDiagnostics;
    dependencies: IndicatorCatalogDependencySummary;
}

export interface IndicatorCatalogWriteInput {
    id: string;
    name: string;
    category: string;
    description: string;
    runtimeBindingKey: string;
    paramSchema: unknown;
    conditions: unknown;
}

export interface IndicatorCatalogUpdateInput {
    name?: string;
    category?: string;
    description?: string;
    runtimeBindingKey?: string;
    paramSchema?: unknown;
    conditions?: unknown;
}

export class IndicatorCatalogServiceError extends Error {
    constructor(
        public readonly statusCode: number,
        public readonly code: string,
        message: string,
        public readonly reasons: string[] = [],
    ) {
        super(message);
        this.name = 'IndicatorCatalogServiceError';
    }
}

interface CatalogContentSnapshot {
    name: string;
    category: string;
    description: string;
    runtimeBindingKey: string | null;
    paramSchema: IndicatorCatalogFieldSchema[];
    conditions: IndicatorCatalogConditionDefinition[];
}

interface NormalizedCatalogPayload extends CatalogContentSnapshot {
    id: string;
    runtimeBindingKey: string;
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeCatalogIdentifier(value: unknown, field: string, issues: string[]): string {
    const normalized = typeof value === 'string'
        ? value.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '')
        : '';

    if (!normalized) {
        issues.push(`${field} is required.`);
    }

    return normalized;
}

function normalizeSchemaIdentifier(value: unknown, field: string, issues: string[]): string {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized) {
        issues.push(`${field} is required.`);
        return '';
    }

    if (!/^[A-Za-z0-9_]+$/.test(normalized)) {
        issues.push(`${field} must use letters, numbers, or underscores only.`);
    }

    return normalized;
}

function normalizeCategory(value: unknown, issues: string[]): string {
    const normalized = typeof value === 'string'
        ? value.trim().toLowerCase().replace(/[^a-z0-9_ -]+/g, '').replace(/[ -]+/g, '_')
        : '';

    if (!normalized) {
        issues.push('category is required.');
    }

    return normalized;
}

function normalizeRequiredText(value: unknown, field: string, issues: string[]): string {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized) {
        issues.push(`${field} is required.`);
    }
    return normalized;
}

function normalizeOptionalBoolean(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined;
}

function normalizeOptionalNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeFieldOptions(
    options: unknown,
    fieldPath: string,
    issues: string[],
): IndicatorCatalogFieldOption[] | undefined {
    if (!Array.isArray(options)) {
        return undefined;
    }

    const normalized = options
        .map((option, index) => {
            if (typeof option === 'string') {
                const value = option.trim();
                return value ? { value, label: value } : null;
            }

            if (!isObject(option)) {
                issues.push(`${fieldPath}.options[${index}] must be a string or { value, label } object.`);
                return null;
            }

            const value = typeof option.value === 'string' ? option.value.trim() : '';
            const label = typeof option.label === 'string' ? option.label.trim() : value;
            if (!value) {
                issues.push(`${fieldPath}.options[${index}].value is required.`);
                return null;
            }

            return { value, label: label || value };
        })
        .filter((option): option is IndicatorCatalogFieldOption => option !== null);

    return normalized.length > 0 ? normalized : undefined;
}

function normalizeFieldSchema(
    fields: unknown,
    fieldPath: string,
    issues: string[],
): IndicatorCatalogFieldSchema[] {
    if (!Array.isArray(fields)) {
        issues.push(`${fieldPath} must be an array.`);
        return [];
    }

    const seenIds = new Set<string>();
    return fields
        .map((field, index) => {
            if (!isObject(field)) {
                issues.push(`${fieldPath}[${index}] must be an object.`);
                return null;
            }

            const id = normalizeSchemaIdentifier(field.id, `${fieldPath}[${index}].id`, issues);
            const label = normalizeRequiredText(field.label, `${fieldPath}[${index}].label`, issues);
            const type = typeof field.type === 'string' ? field.type.trim().toLowerCase() : '';
            if (!FIELD_TYPES.has(type)) {
                issues.push(`${fieldPath}[${index}].type must be one of number, string, boolean, or select.`);
            }

            if (id) {
                if (seenIds.has(id)) {
                    issues.push(`${fieldPath} contains duplicate field id "${id}".`);
                }
                seenIds.add(id);
            }

            const options = normalizeFieldOptions(field.options, `${fieldPath}[${index}]`, issues);
            if (type === 'select' && (!options || options.length === 0)) {
                issues.push(`${fieldPath}[${index}].options must include at least 1 option for select fields.`);
            }

            return {
                id,
                type: (FIELD_TYPES.has(type) ? type : 'string') as IndicatorCatalogFieldSchema['type'],
                label,
                ...(field.default !== undefined ? { default: field.default as number | string | boolean } : {}),
                ...(normalizeOptionalNumber(field.min) !== undefined ? { min: normalizeOptionalNumber(field.min) } : {}),
                ...(normalizeOptionalNumber(field.max) !== undefined ? { max: normalizeOptionalNumber(field.max) } : {}),
                ...(normalizeOptionalNumber(field.step) !== undefined ? { step: normalizeOptionalNumber(field.step) } : {}),
                ...(options ? { options } : {}),
                ...(normalizeOptionalBoolean(field.required) !== undefined ? { required: normalizeOptionalBoolean(field.required) } : {}),
            };
        })
        .filter((field): field is IndicatorCatalogFieldSchema => field !== null);
}

function normalizeConditionDefinitions(
    conditions: unknown,
    fieldPath: string,
    issues: string[],
): IndicatorCatalogConditionDefinition[] {
    if (!Array.isArray(conditions)) {
        issues.push(`${fieldPath} must be an array.`);
        return [];
    }

    const seenIds = new Set<string>();
    return conditions
        .map((condition, index) => {
            if (!isObject(condition)) {
                issues.push(`${fieldPath}[${index}] must be an object.`);
                return null;
            }

            const id = normalizeSchemaIdentifier(condition.id, `${fieldPath}[${index}].id`, issues);
            const name = normalizeRequiredText(condition.name, `${fieldPath}[${index}].name`, issues);
            const description = normalizeRequiredText(condition.description, `${fieldPath}[${index}].description`, issues);

            if (id) {
                if (seenIds.has(id)) {
                    issues.push(`${fieldPath} contains duplicate condition id "${id}".`);
                }
                seenIds.add(id);
            }

            return {
                id,
                name,
                description,
                paramSchema: normalizeFieldSchema(condition.paramSchema ?? [], `${fieldPath}[${index}].paramSchema`, issues),
            };
        })
        .filter((condition): condition is IndicatorCatalogConditionDefinition => condition !== null);
}

function normalizeRuntimeFieldSchema(field: FieldSchema): IndicatorCatalogFieldSchema {
    return {
        id: field.id.trim(),
        type: field.type,
        label: field.label,
        ...(field.default !== undefined ? { default: field.default as number | string | boolean } : {}),
        ...(typeof field.min === 'number' ? { min: field.min } : {}),
        ...(typeof field.max === 'number' ? { max: field.max } : {}),
        ...(typeof field.step === 'number' ? { step: field.step } : {}),
        ...(Array.isArray(field.options) ? {
            options: field.options.map((option) => ({
                value: option.value,
                label: option.label,
            })),
        } : {}),
        ...(typeof field.required === 'boolean' ? { required: field.required } : {}),
    };
}

function normalizeRuntimeCondition(condition: ConditionDef): IndicatorCatalogConditionDefinition {
    return {
        id: condition.id.trim(),
        name: condition.name,
        description: condition.description,
        paramSchema: condition.paramSchema.map(normalizeRuntimeFieldSchema),
    };
}

function normalizeRuntimeDefinition(definition: RuntimeTechIndicatorDefinition): NormalizedCatalogPayload {
    return {
        id: definition.id.trim().toUpperCase(),
        name: definition.name.trim(),
        category: definition.category.trim().toLowerCase(),
        description: definition.description.trim(),
        runtimeBindingKey: definition.id.trim().toUpperCase(),
        paramSchema: definition.paramSchema.map(normalizeRuntimeFieldSchema),
        conditions: definition.conditions.map(normalizeRuntimeCondition),
    };
}

function parseFieldSchemaFromRow(value: Prisma.JsonValue | null | undefined): IndicatorCatalogFieldSchema[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const parsed: IndicatorCatalogFieldSchema[] = [];
    for (const entry of value) {
        if (!isObject(entry)) {
            continue;
        }

        const options = Array.isArray(entry.options)
            ? entry.options
                .flatMap((option) => {
                    if (!isObject(option)) {
                        return [];
                    }

                    const value = typeof option.value === 'string' ? option.value : '';
                    const label = typeof option.label === 'string' ? option.label : value;
                    return value ? [{ value, label }] : [];
                })
            : undefined;

        const field: IndicatorCatalogFieldSchema = {
            id: typeof entry.id === 'string' ? entry.id : '',
            type: (typeof entry.type === 'string' ? entry.type : 'string') as IndicatorCatalogFieldSchema['type'],
            label: typeof entry.label === 'string' ? entry.label : '',
            ...(entry.default !== undefined ? { default: entry.default as number | string | boolean } : {}),
            ...(typeof entry.min === 'number' ? { min: entry.min } : {}),
            ...(typeof entry.max === 'number' ? { max: entry.max } : {}),
            ...(typeof entry.step === 'number' ? { step: entry.step } : {}),
            ...(options && options.length > 0 ? { options } : {}),
            ...(typeof entry.required === 'boolean' ? { required: entry.required } : {}),
        };

        if (field.id.length > 0 && field.label.length > 0) {
            parsed.push(field);
        }
    }

    return parsed;
}

function parseConditionsFromRow(value: Prisma.JsonValue | null | undefined): IndicatorCatalogConditionDefinition[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const parsed: IndicatorCatalogConditionDefinition[] = [];
    for (const entry of value) {
        if (!isObject(entry)) {
            continue;
        }

        const condition: IndicatorCatalogConditionDefinition = {
            id: typeof entry.id === 'string' ? entry.id : '',
            name: typeof entry.name === 'string' ? entry.name : '',
            description: typeof entry.description === 'string' ? entry.description : '',
            paramSchema: parseFieldSchemaFromRow(Array.isArray(entry.paramSchema) ? entry.paramSchema as Prisma.JsonValue : []),
        };

        if (condition.id.length > 0 && condition.name.length > 0) {
            parsed.push(condition);
        }
    }

    return parsed;
}

function buildFieldStructureSignature(fields: IndicatorCatalogFieldSchema[]) {
    return JSON.stringify(fields.map((field) => ({
        id: field.id,
        type: field.type,
        default: field.default ?? null,
        min: field.min ?? null,
        max: field.max ?? null,
        step: field.step ?? null,
        options: (field.options ?? []).map((option) => option.value),
        required: field.required ?? null,
    })));
}

function buildConditionStructureSignature(conditions: IndicatorCatalogConditionDefinition[]) {
    return JSON.stringify(conditions.map((condition) => ({
        id: condition.id,
        paramSchema: JSON.parse(buildFieldStructureSignature(condition.paramSchema)),
    })));
}

function buildSnapshotSignature(snapshot: CatalogContentSnapshot) {
    return JSON.stringify({
        name: snapshot.name,
        category: snapshot.category,
        description: snapshot.description,
        runtimeBindingKey: snapshot.runtimeBindingKey,
        paramSchema: JSON.parse(buildFieldStructureSignature(snapshot.paramSchema)),
        conditions: JSON.parse(buildConditionStructureSignature(snapshot.conditions)),
    });
}

function countIndicatorReferences(composedBlocks: unknown, indicatorId: string): number {
    if (!isObject(composedBlocks) || !Array.isArray(composedBlocks.blocks)) {
        return 0;
    }

    return composedBlocks.blocks.filter((block) => (
        isObject(block)
        && typeof block.indicatorId === 'string'
        && block.indicatorId.trim().toUpperCase() === indicatorId
    )).length;
}

function toJson<T>(value: T): Prisma.InputJsonValue {
    return value as unknown as Prisma.InputJsonValue;
}

function buildBindingMessage(status: IndicatorCatalogBindingStatus, runtimeBindingKey: string | null): string {
    switch (status) {
        case 'MATCHED':
            return `Runtime binding ${runtimeBindingKey ?? 'n/a'} is aligned with the catalog schema.`;
        case 'MISSING_BINDING':
            return 'Runtime binding key is missing.';
        case 'MISSING_RUNTIME':
            return `Runtime block "${runtimeBindingKey ?? 'n/a'}" is not registered in the server catalog.`;
        case 'SCHEMA_MISMATCH':
            return `Catalog schema no longer matches runtime block "${runtimeBindingKey ?? 'n/a'}".`;
        default:
            return 'Runtime binding status is unknown.';
    }
}

function buildLiveSnapshot(row: TechIndicatorCatalogRow): CatalogContentSnapshot {
    return {
        name: row.name,
        category: row.category,
        description: row.description ?? '',
        runtimeBindingKey: row.runtimeBindingKey,
        paramSchema: parseFieldSchemaFromRow(row.paramSchema),
        conditions: parseConditionsFromRow(row.conditions),
    };
}

function hasDraftChanges(row: TechIndicatorCatalogRow): boolean {
    return row.draftName !== null
        || row.draftCategory !== null
        || row.draftDescription !== null
        || row.draftRuntimeBindingKey !== null
        || row.draftParamSchema !== null
        || row.draftConditions !== null;
}

function buildWorkingSnapshot(row: TechIndicatorCatalogRow): CatalogContentSnapshot {
    if (!hasDraftChanges(row)) {
        return buildLiveSnapshot(row);
    }

    return {
        name: row.draftName ?? row.name,
        category: row.draftCategory ?? row.category,
        description: row.draftDescription ?? row.description ?? '',
        runtimeBindingKey: row.draftRuntimeBindingKey ?? row.runtimeBindingKey,
        paramSchema: parseFieldSchemaFromRow(row.draftParamSchema ?? row.paramSchema),
        conditions: parseConditionsFromRow(row.draftConditions ?? row.conditions),
    };
}

function draftOverlayMatchesLive(row: TechIndicatorCatalogRow, snapshot: CatalogContentSnapshot): boolean {
    return buildSnapshotSignature(buildLiveSnapshot(row)) === buildSnapshotSignature(snapshot);
}

function clearDraftOverlay() {
    return {
        draftName: null,
        draftCategory: null,
        draftDescription: null,
        draftRuntimeBindingKey: null,
        draftParamSchema: Prisma.DbNull,
        draftConditions: Prisma.DbNull,
        draftUpdatedAt: null,
        draftUpdatedBy: null,
    };
}

function isGovernanceManagedRow(
    row: Pick<TechIndicatorCatalogRow, 'createdBy' | 'updatedBy' | 'publishedAt' | 'publishedBy' | 'retiredAt' | 'retiredBy'>,
): boolean {
    return Boolean(
        row.createdBy
        || row.updatedBy
        || row.publishedAt
        || row.publishedBy
        || row.retiredAt
        || row.retiredBy,
    );
}

function shouldSystemPublishRuntimeDefinition(definitionId: string): boolean {
    return SYSTEM_PUBLISHED_RUNTIME_IDS.has(definitionId.trim().toUpperCase());
}

function isSystemManagedCatalogRow(
    row: Pick<TechIndicatorCatalogRow, 'createdBy' | 'updatedBy'>,
): boolean {
    return row.createdBy === SYSTEM_ACTOR && row.updatedBy === SYSTEM_ACTOR;
}

function shouldRefreshSystemManagedRuntimeRow(
    row: TechIndicatorCatalogRow,
    definition: NormalizedCatalogPayload,
): boolean {
    return shouldSystemPublishRuntimeDefinition(definition.id)
        && isSystemManagedCatalogRow(row)
        && !hasDraftChanges(row)
        && buildSnapshotSignature(buildLiveSnapshot(row)) !== buildSnapshotSignature(definition);
}

export class IndicatorCatalogService {
    constructor(
        private readonly prisma: PrismaClient,
        private readonly blockRegistry: TechIndicatorRegistry,
    ) {}

    private normalizeWriteInput(
        input: IndicatorCatalogWriteInput | (IndicatorCatalogUpdateInput & { id: string }),
    ): NormalizedCatalogPayload {
        const issues: string[] = [];
        const normalized = {
            id: normalizeCatalogIdentifier(input.id, 'id', issues),
            name: normalizeRequiredText(input.name, 'name', issues),
            category: normalizeCategory(input.category, issues),
            description: normalizeRequiredText(input.description, 'description', issues),
            runtimeBindingKey: normalizeCatalogIdentifier(input.runtimeBindingKey, 'runtimeBindingKey', issues),
            paramSchema: normalizeFieldSchema(input.paramSchema, 'paramSchema', issues),
            conditions: normalizeConditionDefinitions(input.conditions, 'conditions', issues),
        };

        if (normalized.conditions.length === 0) {
            issues.push('conditions must include at least 1 condition.');
        }

        if (issues.length > 0) {
            throw new IndicatorCatalogServiceError(
                400,
                'INDICATOR_CATALOG_INVALID',
                'Indicator catalog draft validation failed.',
                issues,
            );
        }

        return normalized;
    }

    public async syncCatalogFromRuntime(): Promise<void> {
        const runtimeDefinitions = this.blockRegistry.listDefinitions().map(normalizeRuntimeDefinition);
        if (runtimeDefinitions.length === 0) {
            return;
        }

        const existing = await this.prisma.techIndicatorDefinition.findMany();
        const existingMap = new Map(existing.map((row) => [row.id.toUpperCase(), row]));
        const governanceBootstrapped = existing.some(isGovernanceManagedRow);
        const now = new Date();

        for (const definition of runtimeDefinitions) {
            const row = existingMap.get(definition.id);
            if (!row) {
                const publishByDefault = !governanceBootstrapped || shouldSystemPublishRuntimeDefinition(definition.id);
                await this.prisma.techIndicatorDefinition.create({
                    data: {
                        id: definition.id,
                        name: definition.name,
                        category: definition.category,
                        description: definition.description,
                        paramSchema: toJson(definition.paramSchema),
                        conditions: toJson(definition.conditions),
                        runtimeBindingKey: definition.runtimeBindingKey,
                        catalogStatus: publishByDefault ? 'PUBLISHED' : 'DRAFT',
                        isActive: publishByDefault,
                        createdBy: SYSTEM_ACTOR,
                        updatedBy: SYSTEM_ACTOR,
                        publishedAt: publishByDefault ? now : null,
                        publishedBy: publishByDefault ? SYSTEM_ACTOR : null,
                    },
                });
                continue;
            }

            const shouldAutoPublishExistingDraft = (
                shouldSystemPublishRuntimeDefinition(definition.id)
                && row.catalogStatus === 'DRAFT'
                && row.isActive === false
                && !row.publishedAt
                && !row.publishedBy
                && isSystemManagedCatalogRow(row)
                && !hasDraftChanges(row)
            );
            const shouldRefreshExistingLiveRow = shouldRefreshSystemManagedRuntimeRow(row, definition);
            const runtimeSyncData = (
                shouldRefreshExistingLiveRow || shouldAutoPublishExistingDraft
            ) ? {
                name: definition.name,
                category: definition.category,
                description: definition.description,
                runtimeBindingKey: definition.runtimeBindingKey,
                paramSchema: toJson(definition.paramSchema),
                conditions: toJson(definition.conditions),
            } : (!row.runtimeBindingKey ? {
                runtimeBindingKey: definition.runtimeBindingKey,
            } : null);

            if (runtimeSyncData || shouldAutoPublishExistingDraft) {
                await this.prisma.techIndicatorDefinition.update({
                    where: { id: definition.id },
                    data: {
                        ...(runtimeSyncData ?? {}),
                        ...(shouldAutoPublishExistingDraft ? {
                            catalogStatus: 'PUBLISHED',
                            isActive: true,
                            publishedAt: now,
                            publishedBy: SYSTEM_ACTOR,
                        } : {}),
                        updatedBy: SYSTEM_ACTOR,
                    },
                });
            }
        }
    }

    public async syncRuntimeAliases(): Promise<void> {
        this.blockRegistry.clearAliases();

        const rows = await this.prisma.techIndicatorDefinition.findMany({
            select: {
                id: true,
                runtimeBindingKey: true,
            },
        });

        for (const row of rows) {
            if (!row.runtimeBindingKey) {
                continue;
            }

            if (this.blockRegistry.has(row.runtimeBindingKey)) {
                this.blockRegistry.registerAlias(row.id, row.runtimeBindingKey);
            }
        }
    }

    private resolveBindingStatus(snapshot: CatalogContentSnapshot): IndicatorCatalogBindingStatus {
        const runtimeBindingKey = snapshot.runtimeBindingKey?.trim() ?? null;
        if (!runtimeBindingKey) {
            return 'MISSING_BINDING';
        }

        const runtimeBlock = this.blockRegistry.get(runtimeBindingKey);
        if (!runtimeBlock) {
            return 'MISSING_RUNTIME';
        }

        if (
            buildFieldStructureSignature(snapshot.paramSchema) !== buildFieldStructureSignature(
                runtimeBlock.definition.paramSchema.map(normalizeRuntimeFieldSchema),
            )
            || buildConditionStructureSignature(snapshot.conditions) !== buildConditionStructureSignature(
                runtimeBlock.definition.conditions.map(normalizeRuntimeCondition),
            )
        ) {
            return 'SCHEMA_MISMATCH';
        }

        return 'MATCHED';
    }

    private async buildDependencyMap(): Promise<Map<string, IndicatorCatalogDependencySummary>> {
        const rows = await this.prisma.signalDefinition.findMany({
            where: { isComposed: true },
            select: {
                id: true,
                code: true,
                version: true,
                name: true,
                isActive: true,
                composedBlocks: true,
            },
            orderBy: [
                { isActive: 'desc' },
                { updatedAt: 'desc' },
            ],
        });

        const byIndicatorId = new Map<string, IndicatorCatalogDependencyReference[]>();
        for (const row of rows) {
            if (!row.composedBlocks) {
                continue;
            }

            const composedBlocks = row.composedBlocks as unknown;
            const referencedIds = new Set<string>();
            if (isObject(composedBlocks) && Array.isArray(composedBlocks.blocks)) {
                for (const block of composedBlocks.blocks) {
                    if (isObject(block) && typeof block.indicatorId === 'string') {
                        referencedIds.add(block.indicatorId.trim().toUpperCase());
                    }
                }
            }

            for (const indicatorId of referencedIds) {
                const blockCount = countIndicatorReferences(composedBlocks, indicatorId);
                const references = byIndicatorId.get(indicatorId) ?? [];
                references.push({
                    signalDefinitionId: row.id,
                    signalCode: row.code,
                    signalVersion: row.version,
                    signalName: row.name,
                    isActive: row.isActive,
                    blockCount,
                });
                byIndicatorId.set(indicatorId, references);
            }
        }

        const summaryMap = new Map<string, IndicatorCatalogDependencySummary>();
        for (const [indicatorId, references] of byIndicatorId.entries()) {
            const activeSignals = references.filter((reference) => reference.isActive).length;
            summaryMap.set(indicatorId, {
                totalSignals: references.length,
                activeSignals,
                inactiveSignals: references.length - activeSignals,
                references,
            });
        }

        return summaryMap;
    }

    private buildDiagnostics(
        row: TechIndicatorCatalogRow,
        dependencies: IndicatorCatalogDependencySummary,
    ): IndicatorCatalogDiagnostics {
        const workingSnapshot = buildWorkingSnapshot(row);
        const liveSnapshot = buildLiveSnapshot(row);
        const bindingStatus = this.resolveBindingStatus(workingSnapshot);
        const publishBlockingReasons: string[] = [];

        if (bindingStatus === 'MISSING_BINDING') {
            publishBlockingReasons.push('Runtime binding key must be set before publish.');
        } else if (bindingStatus === 'MISSING_RUNTIME') {
            publishBlockingReasons.push(`Runtime block "${workingSnapshot.runtimeBindingKey}" is not registered in this deployment.`);
        } else if (bindingStatus === 'SCHEMA_MISMATCH') {
            publishBlockingReasons.push('Catalog schema does not match the bound runtime block.');
        }

        const deleteBlockingReasons: string[] = [];
        if (dependencies.totalSignals > 0) {
            deleteBlockingReasons.push(`Hard delete is blocked because ${dependencies.totalSignals} composed signal(s) still reference this indicator.`);
        }
        if (row.publishedAt) {
            deleteBlockingReasons.push('Hard delete is blocked because this indicator has been published before and must remain auditable.');
        }

        return {
            bindingStatus,
            bindingMessage: buildBindingMessage(bindingStatus, workingSnapshot.runtimeBindingKey),
            composerAvailable: row.catalogStatus === 'PUBLISHED' && row.isActive && this.resolveBindingStatus(liveSnapshot) === 'MATCHED',
            publishBlockingReasons,
            deleteBlockingReasons,
        };
    }

    private mapRowToRecord(
        row: TechIndicatorCatalogRow,
        dependencies: IndicatorCatalogDependencySummary,
    ): IndicatorCatalogRecord {
        const workingSnapshot = buildWorkingSnapshot(row);

        return {
            id: row.id,
            name: workingSnapshot.name,
            category: workingSnapshot.category,
            description: workingSnapshot.description,
            runtimeBindingKey: workingSnapshot.runtimeBindingKey,
            catalogStatus: row.catalogStatus as IndicatorCatalogLifecycleStatus,
            isActive: row.isActive,
            hasDraftChanges: hasDraftChanges(row),
            paramSchema: workingSnapshot.paramSchema,
            conditions: workingSnapshot.conditions,
            createdAt: row.createdAt.toISOString(),
            createdBy: row.createdBy,
            updatedAt: row.updatedAt.toISOString(),
            updatedBy: row.updatedBy,
            draftUpdatedAt: row.draftUpdatedAt?.toISOString() ?? null,
            draftUpdatedBy: row.draftUpdatedBy,
            publishedAt: row.publishedAt?.toISOString() ?? null,
            publishedBy: row.publishedBy,
            retiredAt: row.retiredAt?.toISOString() ?? null,
            retiredBy: row.retiredBy,
            diagnostics: this.buildDiagnostics(row, dependencies),
            dependencies,
        };
    }

    private async getRowOrThrow(id: string): Promise<TechIndicatorCatalogRow> {
        const normalizedId = id.trim().toUpperCase();
        const row = await this.prisma.techIndicatorDefinition.findUnique({
            where: { id: normalizedId },
        });

        if (!row) {
            throw new IndicatorCatalogServiceError(404, 'INDICATOR_CATALOG_NOT_FOUND', `Indicator catalog item "${normalizedId}" was not found.`);
        }

        return row;
    }

    public async listPublicCatalog(): Promise<Array<{
        id: string;
        name: string;
        category: string;
        description: string;
        paramSchema: IndicatorCatalogFieldSchema[];
        conditions: IndicatorCatalogConditionDefinition[];
    }>> {
        const rows = await this.prisma.techIndicatorDefinition.findMany({
            where: {
                catalogStatus: 'PUBLISHED',
                isActive: true,
            },
            orderBy: [
                { category: 'asc' },
                { name: 'asc' },
            ],
        });

        return rows
            .map((row) => ({
                row,
                liveSnapshot: buildLiveSnapshot(row),
            }))
            .filter(({ row, liveSnapshot }) => (
                row.catalogStatus === 'PUBLISHED'
                && row.isActive
                && this.resolveBindingStatus(liveSnapshot) === 'MATCHED'
            ))
            .map(({ row, liveSnapshot }) => ({
                id: row.id,
                name: liveSnapshot.name,
                category: liveSnapshot.category,
                description: liveSnapshot.description,
                paramSchema: liveSnapshot.paramSchema,
                conditions: liveSnapshot.conditions,
            }));
    }

    public async listAdminCatalog(): Promise<IndicatorCatalogRecord[]> {
        await this.syncRuntimeAliases();

        const [rows, dependencyMap] = await Promise.all([
            this.prisma.techIndicatorDefinition.findMany({
                orderBy: [
                    { isActive: 'desc' },
                    { updatedAt: 'desc' },
                    { id: 'asc' },
                ],
            }),
            this.buildDependencyMap(),
        ]);

        return rows.map((row) => this.mapRowToRecord(row, dependencyMap.get(row.id) ?? {
            totalSignals: 0,
            activeSignals: 0,
            inactiveSignals: 0,
            references: [],
        }));
    }

    public async getAdminCatalogItem(id: string): Promise<IndicatorCatalogRecord> {
        await this.syncRuntimeAliases();

        const [row, dependencyMap] = await Promise.all([
            this.getRowOrThrow(id),
            this.buildDependencyMap(),
        ]);

        return this.mapRowToRecord(row, dependencyMap.get(row.id) ?? {
            totalSignals: 0,
            activeSignals: 0,
            inactiveSignals: 0,
            references: [],
        });
    }

    public async getDependencies(id: string): Promise<IndicatorCatalogDependencySummary> {
        const normalizedId = id.trim().toUpperCase();
        const dependencyMap = await this.buildDependencyMap();
        return dependencyMap.get(normalizedId) ?? {
            totalSignals: 0,
            activeSignals: 0,
            inactiveSignals: 0,
            references: [],
        };
    }

    public async createDraft(actorUserId: string, input: IndicatorCatalogWriteInput): Promise<IndicatorCatalogRecord> {
        await this.syncRuntimeAliases();
        const normalized = this.normalizeWriteInput(input);

        const existing = await this.prisma.techIndicatorDefinition.findUnique({
            where: { id: normalized.id },
            select: { id: true },
        });
        if (existing) {
            throw new IndicatorCatalogServiceError(
                409,
                'INDICATOR_CATALOG_DUPLICATE',
                `Indicator catalog item "${normalized.id}" already exists.`,
                ['Indicator ids must be unique.'],
            );
        }

        await this.prisma.techIndicatorDefinition.create({
            data: {
                id: normalized.id,
                name: normalized.name,
                category: normalized.category,
                description: normalized.description,
                runtimeBindingKey: normalized.runtimeBindingKey,
                catalogStatus: 'DRAFT',
                isActive: false,
                paramSchema: toJson(normalized.paramSchema),
                conditions: toJson(normalized.conditions),
                createdBy: actorUserId,
                updatedBy: actorUserId,
            },
        });

        return this.getAdminCatalogItem(normalized.id);
    }

    public async updateDraft(actorUserId: string, id: string, input: IndicatorCatalogUpdateInput): Promise<IndicatorCatalogRecord> {
        await this.syncRuntimeAliases();
        const existing = await this.getRowOrThrow(id);
        const workingSnapshot = buildWorkingSnapshot(existing);
        const normalized = this.normalizeWriteInput({
            id: existing.id,
            name: input.name ?? workingSnapshot.name,
            category: input.category ?? workingSnapshot.category,
            description: input.description ?? workingSnapshot.description,
            runtimeBindingKey: input.runtimeBindingKey ?? (workingSnapshot.runtimeBindingKey ?? existing.id),
            paramSchema: input.paramSchema ?? workingSnapshot.paramSchema,
            conditions: input.conditions ?? workingSnapshot.conditions,
        });

        const preserveLiveRow = existing.catalogStatus !== 'DRAFT' || Boolean(existing.publishedAt);
        if (preserveLiveRow) {
            await this.prisma.techIndicatorDefinition.update({
                where: { id: existing.id },
                data: draftOverlayMatchesLive(existing, normalized)
                    ? {
                        ...clearDraftOverlay(),
                        updatedBy: actorUserId,
                    }
                    : {
                        draftName: normalized.name,
                        draftCategory: normalized.category,
                        draftDescription: normalized.description,
                        draftRuntimeBindingKey: normalized.runtimeBindingKey,
                        draftParamSchema: toJson(normalized.paramSchema),
                        draftConditions: toJson(normalized.conditions),
                        draftUpdatedAt: new Date(),
                        draftUpdatedBy: actorUserId,
                        updatedBy: actorUserId,
                    },
            });
        } else {
            await this.prisma.techIndicatorDefinition.update({
                where: { id: existing.id },
                data: {
                    name: normalized.name,
                    category: normalized.category,
                    description: normalized.description,
                    runtimeBindingKey: normalized.runtimeBindingKey,
                    paramSchema: toJson(normalized.paramSchema),
                    conditions: toJson(normalized.conditions),
                    catalogStatus: 'DRAFT',
                    isActive: false,
                    updatedBy: actorUserId,
                    ...clearDraftOverlay(),
                },
            });
        }

        return this.getAdminCatalogItem(existing.id);
    }

    public async publish(actorUserId: string, id: string): Promise<IndicatorCatalogRecord> {
        await this.syncRuntimeAliases();
        const existing = await this.getRowOrThrow(id);
        const dependencies = await this.getDependencies(existing.id);
        const diagnostics = this.buildDiagnostics(existing, dependencies);
        if (diagnostics.publishBlockingReasons.length > 0) {
            throw new IndicatorCatalogServiceError(
                409,
                'INDICATOR_CATALOG_PUBLISH_BLOCKED',
                `Indicator catalog item "${existing.id}" cannot be published.`,
                diagnostics.publishBlockingReasons,
            );
        }

        const workingSnapshot = buildWorkingSnapshot(existing);
        await this.prisma.techIndicatorDefinition.update({
            where: { id: existing.id },
            data: {
                name: workingSnapshot.name,
                category: workingSnapshot.category,
                description: workingSnapshot.description,
                runtimeBindingKey: workingSnapshot.runtimeBindingKey,
                paramSchema: toJson(workingSnapshot.paramSchema),
                conditions: toJson(workingSnapshot.conditions),
                ...clearDraftOverlay(),
                catalogStatus: 'PUBLISHED',
                isActive: true,
                updatedBy: actorUserId,
                publishedAt: new Date(),
                publishedBy: actorUserId,
                retiredAt: null,
                retiredBy: null,
            },
        });

        return this.getAdminCatalogItem(existing.id);
    }

    public async retire(actorUserId: string, id: string): Promise<IndicatorCatalogRecord> {
        await this.getRowOrThrow(id);
        await this.prisma.techIndicatorDefinition.update({
            where: { id: id.trim().toUpperCase() },
            data: {
                catalogStatus: 'RETIRED',
                isActive: false,
                updatedBy: actorUserId,
                retiredAt: new Date(),
                retiredBy: actorUserId,
            },
        });

        return this.getAdminCatalogItem(id);
    }

    public async delete(actorUserId: string, id: string): Promise<{ id: string; deletedBy: string }> {
        const existing = await this.getAdminCatalogItem(id);
        if (existing.diagnostics.deleteBlockingReasons.length > 0) {
            throw new IndicatorCatalogServiceError(
                409,
                'INDICATOR_CATALOG_DELETE_BLOCKED',
                `Indicator catalog item "${existing.id}" cannot be hard deleted.`,
                existing.diagnostics.deleteBlockingReasons,
            );
        }

        await this.prisma.techIndicatorDefinition.delete({
            where: { id: existing.id },
        });

        return {
            id: existing.id,
            deletedBy: actorUserId,
        };
    }

    public async validateComposedSignalBlocks(
        definition: ComposedSignalDefinition,
    ): Promise<ComposedSignalValidationIssue[]> {
        await this.syncRuntimeAliases();

        const indicatorIds = Array.from(new Set(
            (definition.blocks ?? []).map((block) => block.indicatorId?.trim().toUpperCase()).filter(Boolean),
        ));
        if (indicatorIds.length === 0) {
            return [];
        }

        const rows = await this.prisma.techIndicatorDefinition.findMany({
            where: {
                id: { in: indicatorIds },
            },
        });
        const rowMap = new Map(rows.map((row) => [row.id.toUpperCase(), row]));

        const issues: ComposedSignalValidationIssue[] = [];
        for (const block of definition.blocks ?? []) {
            const indicatorId = block.indicatorId?.trim().toUpperCase();
            if (!indicatorId) {
                continue;
            }

            const row = rowMap.get(indicatorId);
            if (!row) {
                issues.push({
                    field: 'blocks',
                    section: 'entry',
                    message: `Indicator "${indicatorId}" is not available in the governed catalog.`,
                });
                continue;
            }

            if (row.catalogStatus !== 'PUBLISHED' || !row.isActive) {
                issues.push({
                    field: 'blocks',
                    section: 'entry',
                    message: `Indicator "${indicatorId}" is not published for Signal Composer use.`,
                });
            }

            if (this.resolveBindingStatus(buildLiveSnapshot(row)) !== 'MATCHED') {
                issues.push({
                    field: 'blocks',
                    section: 'entry',
                    message: `Indicator "${indicatorId}" has a broken runtime binding and cannot be used until publish checks pass.`,
                });
            }
        }

        return issues;
    }
}
