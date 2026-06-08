import { PrismaClient } from '@prisma/client';

export class SignalDefinitionService {
    constructor(private prisma: PrismaClient) { }

    public async listDefinitions() {
        const definitions = await this.prisma.signalDefinition.findMany({
            where: { isActive: true },
            orderBy: [
                { code: 'asc' },
                { version: 'desc' },
            ],
        });

        return definitions.map((definition) => ({
            id: definition.id,
            code: definition.code,
            version: definition.version,
            name: definition.name,
            category: definition.category,
            description: definition.description,
            parameterSchema: definition.parameterSchema,
            indicatorSchema: definition.indicatorSchema,
            eventSchema: definition.eventSchema,
            isComposed: definition.isComposed,
            composedBlocks: definition.composedBlocks,
            isActive: definition.isActive,
            createdAt: definition.createdAt,
            updatedAt: definition.updatedAt,
        }));
    }

    public async getDefinition(code: string, version: number) {
        return this.prisma.signalDefinition.findUnique({
            where: {
                code_version: {
                    code: code.toUpperCase(),
                    version,
                },
            },
        });
    }
}
