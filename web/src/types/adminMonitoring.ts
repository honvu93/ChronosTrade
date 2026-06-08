export type MonitoringHealthStatus = "healthy" | "degraded" | "failed";
export type MonitoringFreshnessStatus = "fresh" | "stale" | "missing";

export interface MonitoringHealthCheck {
    key: "api" | "database" | "mt5Sync";
    label: string;
    status: MonitoringHealthStatus;
    detail: string;
    checkedAt: string;
    latencyMs: number | null;
}

export interface MonitoringCandleDistributionItem {
    timeframe: string;
    count: number;
}

export interface MonitoringSymbolFreshnessItem {
    symbol: string;
    timeframe: string;
    indicatorCount: number;
    lastSync: string | null;
    freshnessMinutes: number | null;
    status: MonitoringFreshnessStatus;
}

export interface MonitoringAlertItem {
    id: string;
    source: "backtest" | "trade-intent";
    title: string;
    detail: string;
    status: string;
    symbol: string | null;
    timeframe: string | null;
    occurredAt: string;
}

export interface MonitoringTableCounts {
    candles: number;
    signals: number;
    tradeResults: number;
}

export interface MonitoringSnapshot {
    cached: boolean;
    generatedAt: string;
    cacheTtlMs: number;
    health: MonitoringHealthCheck[];
    candleDistribution: MonitoringCandleDistributionItem[];
    activeSymbolFreshness: MonitoringSymbolFreshnessItem[];
    alerts: MonitoringAlertItem[];
    tableCounts: MonitoringTableCounts;
}

export interface AdminMonitoringResponseEnvelope {
    success: true;
    data: MonitoringSnapshot;
}

export interface AdminMonitoringErrorEnvelope {
    success: false;
    error: {
        code: string;
        message: string;
        domain: string;
    };
}
