import { SignalPlugin } from './types';

const toKey = (code: string, version: number) => `${code.toUpperCase()}@${version}`;

export class SignalRegistry {
    private static instance: SignalRegistry;
    private readonly plugins = new Map<string, SignalPlugin<any, any>>();

    public static getInstance(): SignalRegistry {
        if (!SignalRegistry.instance) {
            SignalRegistry.instance = new SignalRegistry();
        }
        return SignalRegistry.instance;
    }

    public register<TParams, TState>(plugin: SignalPlugin<TParams, TState>) {
        this.plugins.set(toKey(plugin.definition.code, plugin.definition.version), plugin);
    }

    public unregister(code: string, version: number) {
        this.plugins.delete(toKey(code, version));
    }

    public get<TParams = Record<string, unknown>, TState = unknown>(code: string, version: number): SignalPlugin<TParams, TState> | null {
        return (this.plugins.get(toKey(code, version)) as SignalPlugin<TParams, TState> | undefined) ?? null;
    }

    public list() {
        return Array.from(this.plugins.values()).map((plugin) => ({
            code: plugin.definition.code,
            version: plugin.definition.version,
            name: plugin.definition.name,
        }));
    }
}
