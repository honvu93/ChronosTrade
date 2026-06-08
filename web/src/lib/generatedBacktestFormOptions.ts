import { AVAILABLE_TIMEFRAMES } from "../components/layout/workspaceContext";

const normalizeSymbol = (value: string | null | undefined) => value?.trim() ?? "";
const symbolKey = (value: string) => value.toUpperCase();
const normalizeTimeframe = (value: string | null | undefined) => value?.trim() ?? "";

export const buildGeneratedBacktestSymbolOptions = ({
    availableSymbols,
    currentSymbol,
    inheritedSymbol,
}: {
    availableSymbols: string[];
    currentSymbol: string | null;
    inheritedSymbol: string | null;
}) => {
    const deduped = new Map<string, string>();

    [normalizeSymbol(inheritedSymbol), normalizeSymbol(currentSymbol), ...availableSymbols.map(normalizeSymbol)]
        .filter(Boolean)
        .forEach((symbol) => {
            const key = symbolKey(symbol);
            if (!deduped.has(key)) {
                deduped.set(key, symbol);
            }
        });

    return [...deduped.values()];
};

export const buildGeneratedBacktestTimeframeOptions = ({
    currentTimeframe,
    inheritedTimeframe,
}: {
    currentTimeframe: string | null;
    inheritedTimeframe: string | null;
}) => {
    const deduped = new Set<string>();

    [normalizeTimeframe(inheritedTimeframe), normalizeTimeframe(currentTimeframe), ...AVAILABLE_TIMEFRAMES]
        .filter(Boolean)
        .forEach((timeframe) => {
            deduped.add(timeframe);
        });

    return [...deduped];
};
