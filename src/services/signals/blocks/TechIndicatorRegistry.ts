import { TechIndicatorBlock, TechIndicatorDefinition } from './TechIndicatorBlock';

export class TechIndicatorRegistry {
    private readonly blocks = new Map<string, TechIndicatorBlock<any, any>>();
    private readonly aliases = new Map<string, string>();

    public register<TParams, TState>(block: TechIndicatorBlock<TParams, TState>): this {
        const key = block.definition.id.toUpperCase();
        this.blocks.set(key, block);
        return this;
    }

    public registerAlias(aliasId: string, runtimeId: string): void {
        this.aliases.set(aliasId.toUpperCase(), runtimeId.toUpperCase());
    }

    public clearAliases(): void {
        this.aliases.clear();
    }

    public get<TParams = Record<string, unknown>, TState = unknown>(
        id: string,
    ): TechIndicatorBlock<TParams, TState> | null {
        const key = id.toUpperCase();
        const runtimeKey = this.aliases.get(key) ?? key;
        return (this.blocks.get(runtimeKey) as TechIndicatorBlock<TParams, TState> | undefined) ?? null;
    }

    public list(): TechIndicatorBlock<any, any>[] {
        return Array.from(this.blocks.values());
    }

    public listDefinitions(): TechIndicatorDefinition[] {
        return this.list().map(b => b.definition);
    }

    public has(id: string): boolean {
        return this.get(id) !== null;
    }
}
