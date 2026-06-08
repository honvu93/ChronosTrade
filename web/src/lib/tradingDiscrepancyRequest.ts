import type { TradingDiscrepancyRequestParams } from "../types/trading";

export function buildTradingDiscrepancyEndpoint(params: TradingDiscrepancyRequestParams): string {
    const searchParams = new URLSearchParams();

    if (params.backtestRunId) {
        searchParams.set("backtestRunId", params.backtestRunId);
    }
    if (params.indicatorInstanceId) {
        searchParams.set("indicatorInstanceId", params.indicatorInstanceId);
    }
    if (params.tradeRecordId) {
        searchParams.set("tradeRecordId", params.tradeRecordId);
    }

    const query = searchParams.toString();
    const base = `/api/trading/operations/discrepancies/${encodeURIComponent(params.code)}/${params.version}`;
    return query ? `${base}?${query}` : base;
}
