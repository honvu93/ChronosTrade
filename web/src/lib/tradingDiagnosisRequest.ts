import type { TradingDiagnosisRequestParams } from "../types/trading";

export function buildTradingDiagnosisEndpoint(params: TradingDiagnosisRequestParams): string {
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
    const base = `/api/trading/operations/diagnosis/${encodeURIComponent(params.code)}/${params.version}`;
    return query ? `${base}?${query}` : base;
}
