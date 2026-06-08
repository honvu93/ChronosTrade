"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, Database, Loader2, Radio, RefreshCcw, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { loadAdminMonitoringSnapshot } from "@/lib/adminMonitoringApi";
import {
    MONITORING_POLL_INTERVAL_MS,
    shouldPollAdminMonitoring,
} from "@/lib/adminMonitoringPolling";
import {
    MonitoringCandleDistributionItem,
    MonitoringFreshnessStatus,
    MonitoringHealthCheck,
    MonitoringHealthStatus,
    MonitoringSnapshot,
} from "@/types/adminMonitoring";
import { useAuthSession } from "@/hooks/useAuthSession";

const healthToneClasses: Record<MonitoringHealthStatus, string> = {
    healthy: "border-price-up/30 bg-price-up/10 text-price-up",
    degraded: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    failed: "border-price-down/30 bg-price-down/10 text-price-down",
};

const freshnessToneClasses: Record<MonitoringFreshnessStatus, string> = {
    fresh: "border-price-up/30 bg-price-up/10 text-price-up",
    stale: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    missing: "border-price-down/30 bg-price-down/10 text-price-down",
};

function formatDateTime(value: string | null) {
    if (!value) {
        return "No sync recorded";
    }

    return new Date(value).toLocaleString();
}

function formatCompactNumber(value: number) {
    return new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: 1,
    }).format(value);
}

function StatCard({
    label,
    value,
    helper,
}: {
    label: string;
    value: string;
    helper: string;
}) {
    return (
        <div className="rounded-[24px] border border-border-muted bg-bg-tertiary/72 px-4 py-4 shadow-[0_14px_42px_rgba(4,10,22,0.16)]">
            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-text-muted">{label}</div>
            <div className="mt-3 text-2xl font-black text-text-primary">{value}</div>
            <div className="mt-2 text-xs text-text-secondary">{helper}</div>
        </div>
    );
}

function HealthCard({ item }: { item: MonitoringHealthCheck }) {
    return (
        <div className="rounded-[24px] border border-border-muted bg-bg-tertiary/60 p-4">
            <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-black text-text-primary">{item.label}</div>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.16em] ${healthToneClasses[item.status]}`}>
                    {item.status}
                </span>
            </div>
            <div className="mt-3 text-sm leading-6 text-text-secondary">{item.detail}</div>
            <div className="mt-3 text-xs text-text-muted">
                Checked {formatDateTime(item.checkedAt)}{item.latencyMs !== null ? ` • ${item.latencyMs} ms` : ""}
            </div>
        </div>
    );
}

function CandleDistributionChart({ items }: { items: MonitoringCandleDistributionItem[] }) {
    const maxCount = Math.max(...items.map((item) => item.count), 1);

    return (
        <div className="grid gap-3">
            {items.length === 0 ? (
                <div className="rounded-[22px] border border-dashed border-border-muted px-4 py-6 text-sm text-text-secondary">
                    No candle distribution data is available yet.
                </div>
            ) : items.map((item) => {
                const widthPercent = Math.max(8, Math.round((item.count / maxCount) * 100));
                return (
                    <div key={item.timeframe} className="grid gap-2">
                        <div className="flex items-center justify-between gap-3 text-xs font-black uppercase tracking-[0.16em] text-text-muted">
                            <span>{item.timeframe}</span>
                            <span>{item.count.toLocaleString("en-US")}</span>
                        </div>
                        <div className="h-3 rounded-full bg-bg-secondary/80">
                            <div
                                className="h-3 rounded-full bg-[linear-gradient(90deg,rgba(77,140,255,0.32),rgba(84,214,176,0.86))]"
                                style={{ width: `${widthPercent}%` }}
                            />
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function MonitoringWorkspaceBody({
    snapshot,
    isPollingActive,
    isFetching,
    refetch,
}: {
    snapshot: MonitoringSnapshot;
    isPollingActive: boolean;
    isFetching: boolean;
    refetch: () => void;
}) {
    const staleFreshness = snapshot.activeSymbolFreshness.filter((item) => item.status !== "fresh").length;
    const totalAlerts = snapshot.alerts.length;

    return (
        <div className="mx-auto flex max-w-7xl flex-col gap-4 sm:gap-6">
            <section className="rounded-[32px] border border-border-muted bg-bg-primary/94 p-5 shadow-[0_28px_90px_rgba(0,0,0,0.28)] sm:p-6">
                <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                    <div className="max-w-3xl">
                        <div className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.24em] text-accent">
                            <Radio className="h-3.5 w-3.5" />
                            Realtime monitoring
                        </div>
                        <h1 className="mt-4 text-2xl font-black tracking-tight sm:text-3xl">
                            Watch platform health, candle growth, and failure lanes without drilling into raw tables.
                        </h1>
                        <p className="mt-3 max-w-2xl text-sm leading-6 text-text-secondary sm:text-[15px]">
                            The backend caches aggregate queries for 60 seconds, while this page only polls when the admin tab is visible and focused.
                            That keeps monitoring responsive without turning the dashboard into another background workload.
                        </p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 xl:w-[32rem]">
                        <StatCard label="Candle rows" value={formatCompactNumber(snapshot.tableCounts.candles)} helper="Total persisted candle records." />
                        <StatCard label="Signals" value={formatCompactNumber(snapshot.tableCounts.signals)} helper="Signal rows available for review/backtest." />
                        <StatCard label="Trade results" value={formatCompactNumber(snapshot.tableCounts.tradeResults)} helper="Backtest trade outcomes stored so far." />
                        <StatCard label="Active alerts" value={String(totalAlerts)} helper={`${staleFreshness} symbol lane(s) need freshness attention.`} />
                    </div>
                </div>

                <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                        <span className={`rounded-full border px-3 py-1 font-black uppercase tracking-[0.16em] ${isPollingActive ? "border-price-up/30 bg-price-up/10 text-price-up" : "border-amber-500/30 bg-amber-500/10 text-amber-300"}`}>
                            {isPollingActive ? "Polling active" : "Polling paused"}
                        </span>
                        <span>Snapshot {snapshot.cached ? "served from cache" : "refreshed"} at {formatDateTime(snapshot.generatedAt)}</span>
                    </div>

                    <button
                        type="button"
                        onClick={() => refetch()}
                        className="inline-flex items-center gap-2 rounded-full border border-border-muted bg-bg-tertiary px-4 py-2 text-sm font-black text-text-primary transition hover:border-accent/18"
                    >
                        <RefreshCcw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
                        Refresh now
                    </button>
                </div>
            </section>

            <section className="grid gap-5 xl:grid-cols-[minmax(0,0.52fr)_minmax(0,0.48fr)]">
                <div className="rounded-[28px] border border-border-muted bg-bg-primary/92 p-5 shadow-[0_20px_64px_rgba(4,10,22,0.16)] sm:p-6">
                    <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-text-muted">
                        <Activity className="h-4 w-4" />
                        Health status
                    </div>
                    <div className="mt-4 grid gap-4 md:grid-cols-3">
                        {snapshot.health.map((item) => (
                            <HealthCard key={item.key} item={item} />
                        ))}
                    </div>
                </div>

                <div className="rounded-[28px] border border-border-muted bg-bg-primary/92 p-5 shadow-[0_20px_64px_rgba(4,10,22,0.16)] sm:p-6">
                    <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-text-muted">
                        <Database className="h-4 w-4" />
                        Candle distribution by timeframe
                    </div>
                    <div className="mt-4">
                        <CandleDistributionChart items={snapshot.candleDistribution} />
                    </div>
                </div>
            </section>

            <section className="grid gap-5 xl:grid-cols-[minmax(0,0.48fr)_minmax(0,0.52fr)]">
                <div className="rounded-[28px] border border-border-muted bg-bg-primary/92 p-5 shadow-[0_20px_64px_rgba(4,10,22,0.16)] sm:p-6">
                    <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-text-muted">
                        <Radio className="h-4 w-4" />
                        Active symbol freshness
                    </div>
                    <div className="mt-4 space-y-3">
                        {snapshot.activeSymbolFreshness.length === 0 ? (
                            <div className="rounded-[22px] border border-dashed border-border-muted px-4 py-6 text-sm text-text-secondary">
                                No active indicator symbols are available for freshness tracking yet.
                            </div>
                        ) : snapshot.activeSymbolFreshness.map((item) => (
                            <div key={`${item.symbol}:${item.timeframe}`} className="rounded-[22px] border border-border-muted bg-bg-tertiary/58 px-4 py-4">
                                <div className="flex flex-wrap items-center gap-2">
                                    <div className="text-sm font-black text-text-primary">{item.symbol}</div>
                                    <div className="rounded-full border border-border-muted px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.16em] text-text-secondary">
                                        {item.timeframe}
                                    </div>
                                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.16em] ${freshnessToneClasses[item.status]}`}>
                                        {item.status}
                                    </span>
                                </div>
                                <div className="mt-2 text-sm text-text-secondary">
                                    Last sync {formatDateTime(item.lastSync)}
                                </div>
                                <div className="mt-1 text-xs text-text-muted">
                                    {item.freshnessMinutes === null ? "Freshness unavailable" : `${item.freshnessMinutes} minute(s) behind latest ingest`} • {item.indicatorCount} active indicator(s)
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="rounded-[28px] border border-border-muted bg-bg-primary/92 p-5 shadow-[0_20px_64px_rgba(4,10,22,0.16)] sm:p-6">
                    <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-text-muted">
                        <AlertTriangle className="h-4 w-4" />
                        Recent backtest and trading failures
                    </div>
                    <div className="mt-4 space-y-3">
                        {snapshot.alerts.length === 0 ? (
                            <div className="rounded-[22px] border border-dashed border-border-muted px-4 py-6 text-sm text-text-secondary">
                                No recent failures were detected across backtests or trading trade intents.
                            </div>
                        ) : snapshot.alerts.map((item) => (
                            <div key={`${item.source}:${item.id}`} className="rounded-[22px] border border-border-muted bg-bg-tertiary/58 px-4 py-4">
                                <div className="flex flex-wrap items-center gap-2">
                                    <div className="text-sm font-black text-text-primary">{item.title}</div>
                                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.16em] ${item.source === "backtest" ? "border-amber-500/30 bg-amber-500/10 text-amber-300" : "border-price-down/30 bg-price-down/10 text-price-down"}`}>
                                        {item.source === "backtest" ? "Backtest" : "Trade intent"}
                                    </span>
                                    <span className="rounded-full border border-border-muted px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.16em] text-text-secondary">
                                        {item.status}
                                    </span>
                                </div>
                                <div className="mt-2 text-sm leading-6 text-text-secondary">{item.detail}</div>
                                <div className="mt-2 text-xs text-text-muted">
                                    {formatDateTime(item.occurredAt)}
                                    {item.symbol ? ` • ${item.symbol}` : ""}
                                    {item.timeframe ? ` • ${item.timeframe}` : ""}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>
        </div>
    );
}

export default function AdminMonitoringWorkspace() {
    const { isAdmin } = useAuthSession();
    const [activityState, setActivityState] = useState({
        visible: true,
        focused: true,
    });

    useEffect(() => {
        const update = () => {
            setActivityState({
                visible: typeof document === "undefined" ? true : document.visibilityState === "visible",
                focused: typeof document === "undefined" ? true : document.hasFocus(),
            });
        };

        update();
        document.addEventListener("visibilitychange", update);
        window.addEventListener("focus", update);
        window.addEventListener("blur", update);

        return () => {
            document.removeEventListener("visibilitychange", update);
            window.removeEventListener("focus", update);
            window.removeEventListener("blur", update);
        };
    }, []);

    const isPollingActive = shouldPollAdminMonitoring({
        ...activityState,
        isAdmin: Boolean(isAdmin),
    });

    const query = useQuery({
        queryKey: ["admin-monitoring"],
        queryFn: loadAdminMonitoringSnapshot,
        enabled: Boolean(isAdmin),
        staleTime: MONITORING_POLL_INTERVAL_MS,
        refetchInterval: isPollingActive ? MONITORING_POLL_INTERVAL_MS : false,
        refetchIntervalInBackground: false,
    });

    return (
        <div className="command-deck-canvas h-full overflow-y-auto px-3 py-4 text-text-primary sm:px-4 sm:py-5 lg:px-6 lg:py-6">
            {query.isLoading ? (
                <div className="mx-auto flex max-w-7xl items-center justify-center rounded-[32px] border border-border-muted bg-bg-primary/94 px-6 py-16 text-text-secondary shadow-[0_28px_90px_rgba(0,0,0,0.28)]">
                    <Loader2 className="h-5 w-5 animate-spin" />
                </div>
            ) : query.isError ? (
                <div className="mx-auto max-w-7xl rounded-[28px] border border-price-down/30 bg-price-down/10 p-5 text-sm text-price-down">
                    <div className="flex items-center gap-2 font-black">
                        <ShieldAlert className="h-4 w-4" />
                        {(query.error as Error).message}
                    </div>
                </div>
            ) : query.data ? (
                <MonitoringWorkspaceBody
                    snapshot={query.data}
                    isPollingActive={isPollingActive}
                    isFetching={query.isFetching}
                    refetch={() => {
                        void query.refetch();
                    }}
                />
            ) : null}
        </div>
    );
}
