export const normalizeSymbol = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) return trimmed;

    // MT5 contract symbols end in 'c' (BTCUSDc).
    // Accept both correct casing (BTCUSDc) and uppercased-by-mistake (BTCUSDC).
    // Normalize to: UPPERCASE_PREFIX + lowercase 'c'.
    if (/^[A-Z0-9]+[Cc]$/i.test(trimmed) && /^[A-Z0-9]+$/i.test(trimmed.slice(0, -1))) {
        return trimmed.slice(0, -1).toUpperCase() + 'c';
    }

    return trimmed.toUpperCase();
};

const MARKET_SYMBOL_ALIAS_CONFIG: Record<string, readonly string[]> = {
    BTCUSD: ['BTCUSD', 'BTCUSDc'],
    XAUUSD: ['XAUUSD', 'XAUUSDc'],
    XAGUSD: ['XAGUSD', 'XAGUSDc'],
};

const MARKET_SYMBOL_CANONICAL_BY_ALIAS = new Map<string, string>(
    Object.entries(MARKET_SYMBOL_ALIAS_CONFIG).flatMap(([canonical, aliases]) => (
        aliases.map((alias) => [normalizeSymbol(alias), canonical] as const)
    )),
);

export const normalizeMarketSymbol = (value: string): string => {
    const normalized = normalizeSymbol(value);
    return MARKET_SYMBOL_CANONICAL_BY_ALIAS.get(normalized) ?? normalized;
};

export const getMarketSymbolAliases = (value: string): string[] => {
    const canonical = normalizeMarketSymbol(value);
    const aliases = MARKET_SYMBOL_ALIAS_CONFIG[canonical];

    if (!aliases) {
        return [canonical];
    }

    return Array.from(new Set(aliases.map((alias) => normalizeSymbol(alias))));
};

export const dedupeMarketSymbolRowsByTime = <T extends { symbol: string; time: Date | string | number }>(
    rows: T[],
    symbol: string,
    {
        newestFirst = false,
        preferredTimeframeAliases = [],
    }: {
        newestFirst?: boolean;
        preferredTimeframeAliases?: string[];
    } = {},
): T[] => {
    const canonical = normalizeMarketSymbol(symbol);
    const timeframePriority = new Map(
        preferredTimeframeAliases.map((timeframe, index) => [timeframe, index] as const),
    );

    const sorted = [...rows].sort((left, right) => {
        const leftTime = new Date(left.time).getTime();
        const rightTime = new Date(right.time).getTime();

        if (leftTime !== rightTime) {
            return newestFirst ? rightTime - leftTime : leftTime - rightTime;
        }

        const leftPriority = normalizeSymbol(left.symbol) === canonical ? 0 : 1;
        const rightPriority = normalizeSymbol(right.symbol) === canonical ? 0 : 1;
        if (leftPriority !== rightPriority) {
            return leftPriority - rightPriority;
        }

        const leftTimeframe = 'timeframe' in left ? String((left as { timeframe?: unknown }).timeframe ?? '') : '';
        const rightTimeframe = 'timeframe' in right ? String((right as { timeframe?: unknown }).timeframe ?? '') : '';
        const leftTimeframePriority = timeframePriority.get(leftTimeframe) ?? preferredTimeframeAliases.length;
        const rightTimeframePriority = timeframePriority.get(rightTimeframe) ?? preferredTimeframeAliases.length;

        return leftTimeframePriority - rightTimeframePriority;
    });

    const seen = new Set<number>();
    const deduped: T[] = [];

    for (const row of sorted) {
        const key = new Date(row.time).getTime();
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        deduped.push(row);
    }

    return deduped;
};
