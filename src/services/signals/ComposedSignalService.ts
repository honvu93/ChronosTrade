import { PrismaClient } from '@prisma/client';
import { ComposedSignalDefinition, ComposedSignalPlugin } from './ComposedSignalPlugin';
import { TechIndicatorRegistry } from './blocks/TechIndicatorRegistry';
import { SignalRegistry } from './SignalRegistry';
import { IndicatorCatalogService } from './IndicatorCatalogService';
import {
    ComposedSignalValidationError,
    validateComposedSignalDefinition,
} from './composedSignalValidation';

export interface CreateComposedSignalInput {
    name: string;
    description?: string;
    category?: string;
    composedBlocks: ComposedSignalDefinition;
    createdBy?: string;
}

export interface UpdateComposedSignalInput {
    name?: string;
    description?: string;
    composedBlocks?: ComposedSignalDefinition;
}

export class ComposedSignalService {
    constructor(
        private readonly prisma: PrismaClient,
        private readonly signalRegistry: SignalRegistry,
        private readonly blockRegistry: TechIndicatorRegistry,
        private readonly indicatorCatalogService?: IndicatorCatalogService,
    ) {}

    async list() {
        const rows = await this.prisma.signalDefinition.findMany({
            where: { isComposed: true },
            orderBy: [
                { isActive: 'desc' },
                { updatedAt: 'desc' },
            ],
            select: {
                id: true,
                code: true,
                version: true,
                name: true,
                category: true,
                description: true,
                composedBlocks: true,
                isActive: true,
                createdBy: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        return rows;
    }

    async getById(id: string) {
        const row = await this.prisma.signalDefinition.findFirst({
            where: { id, isComposed: true },
        });

        return row ?? null;
    }

    async create(input: CreateComposedSignalInput): Promise<{ id: string; code: string; version: number }> {
        if (this.indicatorCatalogService) {
            const catalogIssues = await this.indicatorCatalogService.validateComposedSignalBlocks(input.composedBlocks);
            if (catalogIssues.length > 0) {
                throw new ComposedSignalValidationError(catalogIssues);
            }
        }

        const issues = validateComposedSignalDefinition(input.composedBlocks, this.blockRegistry);
        if (issues.length > 0) {
            throw new ComposedSignalValidationError(issues);
        }

        const baseCode = input.name
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '_')
            .replace(/_+/g, '_')
            .slice(0, 50);

        const existing = await this.prisma.signalDefinition.findMany({
            where: { code: baseCode },
            select: { version: true },
            orderBy: { version: 'desc' },
            take: 1,
        });
        const version = existing.length > 0 ? existing[0].version + 1 : 1;

        const row = await this.prisma.signalDefinition.create({
            data: {
                code: baseCode,
                version,
                name: input.name,
                description: input.description,
                category: input.category,
                parameterSchema: {},
                composedBlocks: input.composedBlocks as any,
                isComposed: true,
                createdBy: input.createdBy,
                isActive: true,
            },
        });

        const plugin = new ComposedSignalPlugin(
            input.composedBlocks,
            this.blockRegistry,
            row.code,
            row.version,
            row.name,
        );
        this.signalRegistry.register(plugin);

        return { id: row.id, code: row.code, version: row.version };
    }

    async update(id: string, input: UpdateComposedSignalInput) {
        const existing = await this.prisma.signalDefinition.findFirst({
            where: { id, isComposed: true },
        });
        if (!existing) {
            throw new Error('Composed signal not found');
        }
        if (!existing.isActive) {
            throw new Error('Retired composed signals are read-only. Reuse them instead of updating in place.');
        }

        if (input.composedBlocks) {
            if (this.indicatorCatalogService) {
                const catalogIssues = await this.indicatorCatalogService.validateComposedSignalBlocks(input.composedBlocks);
                if (catalogIssues.length > 0) {
                    throw new ComposedSignalValidationError(catalogIssues);
                }
            }

            const issues = validateComposedSignalDefinition(input.composedBlocks, this.blockRegistry);
            if (issues.length > 0) {
                throw new ComposedSignalValidationError(issues);
            }
        }

        const updated = await this.prisma.signalDefinition.update({
            where: { id },
            data: {
                ...(input.name ? { name: input.name } : {}),
                ...(input.description !== undefined ? { description: input.description } : {}),
                ...(input.composedBlocks ? { composedBlocks: input.composedBlocks as any } : {}),
            },
        });

        const blocksToUse = (input.composedBlocks ?? existing.composedBlocks) as unknown as ComposedSignalDefinition;
        const plugin = new ComposedSignalPlugin(
            blocksToUse,
            this.blockRegistry,
            updated.code,
            updated.version,
            updated.name,
        );
        this.signalRegistry.register(plugin);

        return updated;
    }

    async retire(id: string) {
        const existing = await this.prisma.signalDefinition.findFirst({
            where: { id, isComposed: true },
        });
        if (!existing) {
            throw new Error('Composed signal not found');
        }
        if (!existing.isActive) {
            return existing;
        }

        const retired = await this.prisma.signalDefinition.update({
            where: { id },
            data: { isActive: false },
        });
        this.signalRegistry.unregister(existing.code, existing.version);

        return retired;
    }

    async listIndicatorBlocks() {
        if (this.indicatorCatalogService) {
            return this.indicatorCatalogService.listPublicCatalog();
        }

        return this.blockRegistry.listDefinitions();
    }
}
