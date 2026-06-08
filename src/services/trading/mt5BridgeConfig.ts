export interface MT5BridgePortEnvSource {
    MT5_EXEC_BRIDGE_PORT?: string;
    MT5_BRIDGE_PORT?: string;
}

export interface ResolvedMT5BridgePort {
    port: string;
    source: 'exec-env' | 'legacy-env' | 'default';
}

export const DEFAULT_MT5_BRIDGE_PORT = '8765';
export const DEFAULT_MT5_EXEC_BRIDGE_PORT = '8766';

/**
 * @deprecated Use resolveMT5ReadPort / resolveMT5ExecPort instead.
 * Kept for backward compatibility.
 */
export function resolveMT5BridgePort(env: MT5BridgePortEnvSource): ResolvedMT5BridgePort {
    const execConfiguredPort = env.MT5_EXEC_BRIDGE_PORT?.trim();
    if (execConfiguredPort) {
        return {
            port: execConfiguredPort,
            source: 'exec-env',
        };
    }

    const configuredPort = env.MT5_BRIDGE_PORT?.trim();
    if (configuredPort) {
        return {
            port: configuredPort,
            source: 'legacy-env',
        };
    }

    return {
        port: DEFAULT_MT5_BRIDGE_PORT,
        source: 'default',
    };
}

/** Resolve port for read/market-data operations (default 8765). */
export function resolveMT5ReadPort(env: MT5BridgePortEnvSource): ResolvedMT5BridgePort {
    const configuredPort = env.MT5_BRIDGE_PORT?.trim();
    if (configuredPort) {
        return { port: configuredPort, source: 'legacy-env' };
    }
    return { port: DEFAULT_MT5_BRIDGE_PORT, source: 'default' };
}

/** Resolve port for trade execution/write operations (default 8766). */
export function resolveMT5ExecPort(env: MT5BridgePortEnvSource): ResolvedMT5BridgePort {
    const execConfiguredPort = env.MT5_EXEC_BRIDGE_PORT?.trim();
    if (execConfiguredPort) {
        return { port: execConfiguredPort, source: 'exec-env' };
    }
    return { port: DEFAULT_MT5_EXEC_BRIDGE_PORT, source: 'default' };
}
