import type { SignalVersionRequestParams } from "../types/trading";

export function buildSignalVersionEndpoint(params: SignalVersionRequestParams): string {
    const searchParams = new URLSearchParams();
    if (params.backtestRunId) {
        searchParams.set("backtestRunId", params.backtestRunId);
    }
    if (params.indicatorInstanceId) {
        searchParams.set("indicatorInstanceId", params.indicatorInstanceId);
    }

    const query = searchParams.toString();
    const base = `/api/trading/operations/signal-versions/${encodeURIComponent(params.code)}/${params.version}`;
    return query ? `${base}?${query}` : base;
}
