import {
    BacktestLeaderboardMode,
    BacktestLeaderboardSortField,
    BacktestLeaderboardSortOrder,
    BacktestLeaderboardStatusFilter,
} from "@/types/engine";

const allowedModes = new Set<BacktestLeaderboardMode>(["ALL_RUNS", "BEST_PER_SIGNAL"]);
const allowedStatuses = new Set<BacktestLeaderboardStatusFilter>(["ALL", "PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELED"]);
const allowedSorts = new Set<BacktestLeaderboardSortField>([
    "rank",
    "createdAt",
    "closedTrades",
    "winRate",
    "netR",
    "profitFactor",
    "expectancy",
    "maxDrawdownPct",
]);
const allowedOrders = new Set<BacktestLeaderboardSortOrder>(["asc", "desc"]);

export interface BacktestLeaderboardQueryState {
    mode: BacktestLeaderboardMode;
    signalCode: string;
    symbol: string;
    timeframe: string;
    status: BacktestLeaderboardStatusFilter;
    minClosedTrades: string;
    fromDate: string;
    toDate: string;
    page: number;
    pageSize: number;
    sort: BacktestLeaderboardSortField;
    order: BacktestLeaderboardSortOrder;
}

export const defaultBacktestLeaderboardQueryState: BacktestLeaderboardQueryState = {
    mode: "BEST_PER_SIGNAL",
    signalCode: "",
    symbol: "",
    timeframe: "",
    status: "ALL",
    minClosedTrades: "5",
    fromDate: "",
    toDate: "",
    page: 1,
    pageSize: 20,
    sort: "rank",
    order: "desc",
};

const parsePositiveInteger = (value: string | null, fallback: number) => {
    if (!value) return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
    return parsed;
};

export const parseBacktestLeaderboardQuery = (params: URLSearchParams): BacktestLeaderboardQueryState => {
    const modeParam = params.get("lbMode");
    const statusParam = params.get("lbStatus");
    const sortParam = params.get("lbSort");
    const orderParam = params.get("lbOrder");

    return {
        mode: modeParam && allowedModes.has(modeParam as BacktestLeaderboardMode)
            ? modeParam as BacktestLeaderboardMode
            : defaultBacktestLeaderboardQueryState.mode,
        signalCode: params.get("lbSignal") ?? defaultBacktestLeaderboardQueryState.signalCode,
        symbol: params.get("lbSymbol") ?? defaultBacktestLeaderboardQueryState.symbol,
        timeframe: params.get("lbTimeframe") ?? defaultBacktestLeaderboardQueryState.timeframe,
        status: statusParam && allowedStatuses.has(statusParam as BacktestLeaderboardStatusFilter)
            ? statusParam as BacktestLeaderboardStatusFilter
            : defaultBacktestLeaderboardQueryState.status,
        minClosedTrades: params.get("lbMinClosed") ?? defaultBacktestLeaderboardQueryState.minClosedTrades,
        fromDate: params.get("lbFrom") ?? defaultBacktestLeaderboardQueryState.fromDate,
        toDate: params.get("lbTo") ?? defaultBacktestLeaderboardQueryState.toDate,
        page: parsePositiveInteger(params.get("lbPage"), defaultBacktestLeaderboardQueryState.page),
        pageSize: parsePositiveInteger(params.get("lbPageSize"), defaultBacktestLeaderboardQueryState.pageSize),
        sort: sortParam && allowedSorts.has(sortParam as BacktestLeaderboardSortField)
            ? sortParam as BacktestLeaderboardSortField
            : defaultBacktestLeaderboardQueryState.sort,
        order: orderParam && allowedOrders.has(orderParam as BacktestLeaderboardSortOrder)
            ? orderParam as BacktestLeaderboardSortOrder
            : defaultBacktestLeaderboardQueryState.order,
    };
};

export const buildBacktestLeaderboardQuery = (
    current: BacktestLeaderboardQueryState,
    updates: Partial<BacktestLeaderboardQueryState>,
    baseParams: URLSearchParams,
) => {
    const merged: BacktestLeaderboardQueryState = {
        ...current,
        ...updates,
    };
    const next = new URLSearchParams(baseParams);

    const write = (key: string, value: string, fallback: string) => {
        if (!value || value === fallback) {
            next.delete(key);
            return;
        }
        next.set(key, value);
    };

    write("lbMode", merged.mode, defaultBacktestLeaderboardQueryState.mode);
    write("lbSignal", merged.signalCode.trim(), defaultBacktestLeaderboardQueryState.signalCode);
    write("lbSymbol", merged.symbol.trim().toUpperCase(), defaultBacktestLeaderboardQueryState.symbol);
    write("lbTimeframe", merged.timeframe.trim(), defaultBacktestLeaderboardQueryState.timeframe);
    write("lbStatus", merged.status, defaultBacktestLeaderboardQueryState.status);
    write("lbMinClosed", merged.minClosedTrades.trim(), defaultBacktestLeaderboardQueryState.minClosedTrades);
    write("lbFrom", merged.fromDate, defaultBacktestLeaderboardQueryState.fromDate);
    write("lbTo", merged.toDate, defaultBacktestLeaderboardQueryState.toDate);
    write("lbSort", merged.sort, defaultBacktestLeaderboardQueryState.sort);
    write("lbOrder", merged.order, defaultBacktestLeaderboardQueryState.order);

    if (merged.page <= 1) {
        next.delete("lbPage");
    } else {
        next.set("lbPage", String(merged.page));
    }

    if (merged.pageSize === defaultBacktestLeaderboardQueryState.pageSize) {
        next.delete("lbPageSize");
    } else {
        next.set("lbPageSize", String(merged.pageSize));
    }

    return next;
};

export const buildBacktestLeaderboardApiParams = (state: BacktestLeaderboardQueryState) => {
    const params = new URLSearchParams({
        mode: state.mode,
        page: String(state.page),
        pageSize: String(state.pageSize),
        sort: state.sort,
        order: state.order,
    });

    if (state.signalCode.trim()) {
        params.set("signalCode", state.signalCode.trim());
    }
    if (state.symbol.trim()) {
        params.set("symbol", state.symbol.trim().toUpperCase());
    }
    if (state.timeframe.trim()) {
        params.set("timeframe", state.timeframe.trim());
    }
    if (state.status !== "ALL") {
        params.set("status", state.status);
    }
    if (state.minClosedTrades.trim()) {
        params.set("minClosedTrades", state.minClosedTrades.trim());
    }
    if (state.fromDate) {
        params.set("from", `${state.fromDate}T00:00:00.000Z`);
    }
    if (state.toDate) {
        params.set("to", `${state.toDate}T23:59:59.999Z`);
    }

    return params;
};
