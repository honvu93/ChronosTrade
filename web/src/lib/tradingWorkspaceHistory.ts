import { TradingWorkspaceDeal } from "@/types/trading";

export interface TradingWorkspaceHistoryQuery {
    limit?: number;
    from?: string | null;
    to?: string | null;
}

export const DEFAULT_FILTERED_HISTORY_LIMIT = 500;

export function normalizeTradingWorkspaceHistoryQuery(
    query: TradingWorkspaceHistoryQuery,
): TradingWorkspaceHistoryQuery | null {
    const normalized = {
        ...(query.limit ? { limit: query.limit } : {}),
        ...(query.from ? { from: query.from } : {}),
        ...(query.to ? { to: query.to } : {}),
    };

    return Object.keys(normalized).length > 0 ? normalized : null;
}

export function buildTradingWorkspaceHistoryRequest(
    query: TradingWorkspaceHistoryQuery,
): TradingWorkspaceHistoryQuery | null {
    const normalized = normalizeTradingWorkspaceHistoryQuery(query);
    if (!normalized) {
        return null;
    }

    if ((normalized.from || normalized.to) && !normalized.limit) {
        return {
            ...normalized,
            limit: DEFAULT_FILTERED_HISTORY_LIMIT,
        };
    }

    return normalized;
}

export function resolveTradingWorkspaceHistoryReset(
    workspaceDeals: TradingWorkspaceDeal[] | null | undefined,
    { clear = false }: { clear?: boolean } = {},
): TradingWorkspaceDeal[] {
    if (clear) {
        return [];
    }

    return workspaceDeals ?? [];
}
