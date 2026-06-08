const TIMEFRAME_ALIASES: Record<string, readonly string[]> = {
    '1m': ['1m', 'M1', 'm1'],
    '5m': ['5m', 'M5', 'm5'],
    '15m': ['15m', 'M15', 'm15'],
    '30m': ['30m', 'm30', 'M30'],
    '1h': ['1h', 'H1', 'h1'],
    '2h': ['2h', 'h2', 'H2'],
    '3h': ['3h', 'h3', 'H3'],
    '4h': ['4h', 'H4', 'h4'],
    '12h': ['12h', 'h12', 'H12'],
    '1d': ['1d', 'D1', 'd1'],
    '3d': ['3d', 'd3', 'D3'],
    '1w': ['1w', 'W1', 'w1'],
    '1M': ['1M', 'MN1', 'mn1'],
};

const TIMEFRAME_CANONICAL_BY_ALIAS = new Map<string, string>(
    Object.entries(TIMEFRAME_ALIASES).flatMap(([canonical, aliases]) => (
        aliases.map((alias) => [alias, canonical] as const)
    )),
);

export const normalizeTimeframe = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) {
        return trimmed;
    }

    return TIMEFRAME_CANONICAL_BY_ALIAS.get(trimmed) ?? trimmed;
};

export const getTimeframeAliases = (value: string): string[] => {
    const canonical = normalizeTimeframe(value);
    const aliases = TIMEFRAME_ALIASES[canonical];

    if (!aliases) {
        return [canonical];
    }

    return [...aliases];
};

const TIMEFRAME_MINUTES: Record<string, number> = {
    '1m': 1, '5m': 5, '15m': 15, '30m': 30,
    '1h': 60, '2h': 120, '3h': 180, '4h': 240,
    '12h': 720, '1d': 1440, '3d': 4320, '1w': 10080,
};

export const getTimeframeMinutes = (value: string): number | null => {
    const canonical = normalizeTimeframe(value);
    return TIMEFRAME_MINUTES[canonical] ?? null;
};
