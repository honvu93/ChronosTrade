"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, RefreshCcw } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PublicReportTradeRow {
    entryTime: string;
    exitTime: string | null;
    symbol: string;
    side: string;
    session: string;
    entryPrice: number;
    stopLoss: number;
    exitPrice: number | null;
    pnlPct: number | null;
    rMultiple: number;
    durationMs: number | null;
    result: string;
}

interface PublicReportOverview {
    winRate: number;
    profitFactor: number;
    expectancy: number;
    netR: number;
    totalTrades: number;
    closedTrades: number;
    wins: number;
    losses: number;
    maxConsecutiveLoss: number;
    maxDrawdownPct: number;
}

interface PublicReportTradeSummary {
    totalTrades: number;
    closedTrades: number;
    openTrades: number;
    wins: number;
    losses: number;
    breakEven: number;
    winRate: number;
    netR: number;
    avgWinR: number;
    avgLossR: number;
}

interface PublicReportPagination {
    page: number;
    pageSize: number;
    totalRows: number;
    totalPages: number;
}

interface PublicReportSnapshot {
    overview: PublicReportOverview | null;
    trades: {
        summary: PublicReportTradeSummary | null;
        rows: PublicReportTradeRow[];
        pagination: PublicReportPagination;
    };
    evaluatedAt: string;
}

type StatusFilter = "ALL" | "ACTIVE" | "CLOSED";
type SideFilter = "ALL" | "LONG" | "SHORT";
type OutcomeFilter = "ALL" | "WIN" | "LOSS" | "BE";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ENDPOINT = "/api/public/reports";
const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const PAGE_SIZE = 50;

const STATUS_FILTERS: StatusFilter[] = ["ALL", "ACTIVE", "CLOSED"];
const SIDE_FILTERS: SideFilter[] = ["ALL", "LONG", "SHORT"];
const OUTCOME_FILTERS: OutcomeFilter[] = ["ALL", "WIN", "LOSS", "BE"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(iso: string) {
    const d = new Date(iso);
    const month = d.toLocaleString("en-US", { month: "short" });
    const day = d.getDate().toString().padStart(2, "0");
    const hours = d.getHours().toString().padStart(2, "0");
    const minutes = d.getMinutes().toString().padStart(2, "0");
    return `${month} ${day} ${hours}:${minutes}`;
}

function formatPrice(value: number | null, digits = 2) {
    if (value === null) return "-";
    return value.toLocaleString(undefined, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    });
}

function formatSigned(value: number, suffix = "") {
    return `${value >= 0 ? "+" : ""}${value.toFixed(2)}${suffix}`;
}

function formatDuration(ms: number | null) {
    if (ms === null || ms <= 0) return "-";
    const totalMinutes = Math.floor(ms / 60_000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ResultBadge({ result }: { result: string }) {
    const styles: Record<string, string> = {
        WIN: "border-price-up/30 bg-price-up/12 text-price-up",
        LOSS: "border-price-down/30 bg-price-down/12 text-price-down",
        BE: "border-border-muted bg-bg-tertiary text-text-secondary",
        ACTIVE: "border-accent/30 bg-accent/12 text-accent",
    };

    return (
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.16em] ${styles[result] ?? styles.BE}`}>
            {result === "ACTIVE" ? (
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent animate-pulse-dot" />
            ) : null}
            {result}
        </span>
    );
}

function SideBadge({ side }: { side: string }) {
    const isLong = side === "LONG";
    return (
        <span className={`text-[11px] font-black ${isLong ? "text-price-up" : "text-price-down"}`}>
            {side}
        </span>
    );
}

function MetricCard({
    label,
    value,
    tone = "neutral",
}: {
    label: string;
    value: string | number;
    tone?: "success" | "danger" | "accent" | "neutral";
}) {
    const toneMap: Record<string, string> = {
        success: "border-price-up/20 bg-price-up/8 text-price-up",
        danger: "border-price-down/20 bg-price-down/8 text-price-down",
        accent: "border-accent/20 bg-accent/8 text-accent",
        neutral: "border-border-muted bg-bg-tertiary text-text-secondary",
    };

    return (
        <div className={`rounded-2xl border px-4 py-3 ${toneMap[tone]}`}>
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] opacity-70">
                {label}
            </div>
            <div className="mt-1.5 text-lg font-black">{value}</div>
        </div>
    );
}

function FilterGroup<T extends string>({
    label,
    options,
    value,
    onChange,
}: {
    label: string;
    options: T[];
    value: T;
    onChange: (v: T) => void;
}) {
    return (
        <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-text-muted">
                {label}
            </span>
            <div className="flex flex-wrap gap-0.5 rounded-full border border-border-muted bg-bg-tertiary/50 p-0.5">
                {options.map((opt) => (
                    <button
                        key={opt}
                        type="button"
                        onClick={() => onChange(opt)}
                        className={`rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.14em] transition-colors ${
                            value === opt
                                ? "bg-accent/15 text-accent"
                                : "text-text-muted hover:text-text-primary"
                        }`}
                    >
                        {opt}
                    </button>
                ))}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PublicReports() {
    const [snapshot, setSnapshot] = useState<PublicReportSnapshot | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

    const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
    const [sideFilter, setSideFilter] = useState<SideFilter>("ALL");
    const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>("ALL");
    const [page, setPage] = useState(1);

    const abortRef = useRef<AbortController | null>(null);
    const activeRef = useRef(true);

    const fetchData = useCallback(async (
        currentPage: number,
        status: StatusFilter,
        side: SideFilter,
        outcome: OutcomeFilter,
    ) => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        setLoading(true);
        setError(null);

        try {
            const params = new URLSearchParams();
            if (status !== "ALL") params.set("status", status);
            if (side !== "ALL") params.set("side", side);
            if (outcome !== "ALL") params.set("outcome", outcome);
            params.set("page", String(currentPage));
            params.set("pageSize", String(PAGE_SIZE));

            const url = `${ENDPOINT}?${params.toString()}`;
            const res = await fetch(url, {
                cache: "no-store",
                signal: controller.signal,
            });
            const payload = await res.json();

            if (!activeRef.current || controller.signal.aborted) return;

            if (!res.ok || !payload?.success) {
                throw new Error(payload?.error?.message ?? "Failed to load reports.");
            }

            setSnapshot(payload.data);
            setLastRefresh(new Date());
        } catch (err) {
            if (!activeRef.current || controller.signal.aborted) return;
            setError(err instanceof Error ? err.message : "Failed to load reports.");
        } finally {
            if (activeRef.current) setLoading(false);
        }
    }, []);

    useEffect(() => {
        activeRef.current = true;
        void fetchData(page, statusFilter, sideFilter, outcomeFilter);

        const interval = setInterval(() => {
            void fetchData(page, statusFilter, sideFilter, outcomeFilter);
        }, REFRESH_INTERVAL_MS);

        return () => {
            activeRef.current = false;
            abortRef.current?.abort();
            clearInterval(interval);
        };
    }, [fetchData, page, statusFilter, sideFilter, outcomeFilter]);

    const handleFilterChange = useCallback(
        (setter: (v: any) => void) => (value: string) => {
            setter(value);
            setPage(1);
        },
        [],
    );

    const overview = snapshot?.overview;
    const trades = snapshot?.trades;
    const pagination = trades?.pagination;

    return (
        <div className="command-deck-canvas min-h-screen">
            <div className="mx-auto max-w-[1400px] p-3 sm:p-5 pb-20 md:pb-5">
                {/* Header */}
                <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="text-gradient text-lg font-black tracking-tight sm:text-xl">
                            TradeHVV
                        </h1>
                        <p className="mt-1 text-xs text-text-muted">
                            Performance Reports
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        {lastRefresh ? (
                            <span className="text-[10px] text-text-muted">
                                Updated {lastRefresh.toLocaleTimeString()}
                            </span>
                        ) : null}
                        <button
                            type="button"
                            onClick={() => void fetchData(page, statusFilter, sideFilter, outcomeFilter)}
                            disabled={loading}
                            className="inline-flex items-center gap-1.5 rounded-full border border-border-muted bg-bg-tertiary px-3 py-1.5 text-xs font-bold text-text-primary transition-colors hover:border-accent hover:text-accent disabled:cursor-wait disabled:opacity-60"
                        >
                            <RefreshCcw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
                            Refresh
                        </button>
                    </div>
                </header>

                {/* Overview metrics */}
                {overview ? (
                    <div className="mt-5 grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
                        <MetricCard
                            label="Win Rate"
                            value={`${overview.winRate.toFixed(1)}%`}
                            tone={overview.winRate >= 50 ? "success" : "danger"}
                        />
                        <MetricCard
                            label="Profit Factor"
                            value={overview.profitFactor.toFixed(2)}
                            tone={overview.profitFactor >= 1 ? "success" : "danger"}
                        />
                        <MetricCard
                            label="Expectancy"
                            value={`${formatSigned(overview.expectancy, "R")}`}
                            tone={overview.expectancy >= 0 ? "success" : "danger"}
                        />
                        <MetricCard
                            label="Net R"
                            value={formatSigned(overview.netR, "R")}
                            tone={overview.netR >= 0 ? "success" : "danger"}
                        />
                        <MetricCard
                            label="Trades"
                            value={`${overview.wins}W / ${overview.losses}L`}
                            tone="neutral"
                        />
                        <MetricCard
                            label="Max DD"
                            value={`${overview.maxDrawdownPct.toFixed(1)}%`}
                            tone={overview.maxDrawdownPct > -10 ? "neutral" : "danger"}
                        />
                    </div>
                ) : null}

                {/* Filters */}
                <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
                    <FilterGroup
                        label="Status"
                        options={STATUS_FILTERS}
                        value={statusFilter}
                        onChange={handleFilterChange(setStatusFilter)}
                    />
                    <FilterGroup
                        label="Side"
                        options={SIDE_FILTERS}
                        value={sideFilter}
                        onChange={handleFilterChange(setSideFilter)}
                    />
                    <FilterGroup
                        label="Result"
                        options={OUTCOME_FILTERS}
                        value={outcomeFilter}
                        onChange={handleFilterChange(setOutcomeFilter)}
                    />
                </div>

                {/* Loading state */}
                {loading && !snapshot ? (
                    <div className="mt-8 flex items-center justify-center gap-2 text-sm text-text-secondary">
                        <Loader2 className="h-4 w-4 animate-spin text-accent" />
                        Loading reports...
                    </div>
                ) : null}

                {/* Error state */}
                {error ? (
                    <div className="mt-5 rounded-2xl border border-price-down/20 bg-price-down/8 px-4 py-3 text-sm text-price-down">
                        {error}{snapshot ? " Showing last known data." : ""}
                    </div>
                ) : null}

                {/* Trade table */}
                {trades && trades.rows.length > 0 ? (
                    <div className="mt-4 overflow-x-auto rounded-2xl border border-border-muted bg-bg-primary/90">
                        <table className="w-full min-w-[1000px] text-left">
                            <thead>
                                <tr className="border-b border-border-muted">
                                    {["Time", "Ticker", "Side", "Session", "Entry", "SL", "Close", "PnL %", "PnL R", "Duration", "Result"].map((col) => (
                                        <th
                                            key={col}
                                            className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.16em] text-text-muted"
                                        >
                                            {col}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {trades.rows.map((row, idx) => {
                                    const pnlColor = row.rMultiple >= 0 ? "text-price-up" : "text-price-down";
                                    const rowKey = `${row.entryTime}:${row.symbol}:${row.side}:${idx}`;

                                    return (
                                        <tr
                                            key={rowKey}
                                            className="border-b border-border-muted/50 transition-colors hover:bg-bg-tertiary/30"
                                        >
                                            <td className="whitespace-nowrap px-4 py-3 text-xs text-text-secondary">
                                                {formatTime(row.entryTime)}
                                            </td>
                                            <td className="whitespace-nowrap px-4 py-3 text-xs font-bold text-text-primary">
                                                {row.symbol}
                                            </td>
                                            <td className="whitespace-nowrap px-4 py-3">
                                                <SideBadge side={row.side} />
                                            </td>
                                            <td className="whitespace-nowrap px-4 py-3 text-[11px] text-text-muted">
                                                {row.session}
                                            </td>
                                            <td className="whitespace-nowrap px-4 py-3 text-xs font-mono text-text-primary">
                                                {formatPrice(row.entryPrice, 4)}
                                            </td>
                                            <td className="whitespace-nowrap px-4 py-3 text-xs font-mono text-text-muted">
                                                {formatPrice(row.stopLoss, 4)}
                                            </td>
                                            <td className="whitespace-nowrap px-4 py-3 text-xs font-mono text-text-primary">
                                                {formatPrice(row.exitPrice, 4)}
                                            </td>
                                            <td className={`whitespace-nowrap px-4 py-3 text-xs font-bold font-mono ${pnlColor}`}>
                                                {row.pnlPct !== null ? formatSigned(row.pnlPct, "%") : "-"}
                                            </td>
                                            <td className={`whitespace-nowrap px-4 py-3 text-xs font-bold font-mono ${pnlColor}`}>
                                                {formatSigned(row.rMultiple, "R")}
                                            </td>
                                            <td className="whitespace-nowrap px-4 py-3 text-xs text-text-secondary">
                                                {formatDuration(row.durationMs)}
                                            </td>
                                            <td className="whitespace-nowrap px-4 py-3">
                                                <ResultBadge result={row.result} />
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                ) : null}

                {/* Empty state */}
                {trades && trades.rows.length === 0 && !loading ? (
                    <div className="mt-8 rounded-2xl border border-border-muted bg-bg-primary/90 px-4 py-8 text-center text-sm text-text-muted">
                        No records match the current filters.
                    </div>
                ) : null}

                {/* Pagination */}
                {pagination && pagination.totalPages > 1 ? (
                    <div className="mt-4 flex items-center justify-between">
                        <span className="text-[11px] text-text-muted">
                            {pagination.totalRows} trades &middot; Page {pagination.page} of {pagination.totalPages}
                        </span>
                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                onClick={() => setPage((p) => Math.max(1, p - 1))}
                                disabled={pagination.page <= 1}
                                className="inline-flex items-center justify-center rounded-lg border border-border-muted bg-bg-tertiary p-1.5 text-text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </button>
                            <button
                                type="button"
                                onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                                disabled={pagination.page >= pagination.totalPages}
                                className="inline-flex items-center justify-center rounded-lg border border-border-muted bg-bg-tertiary p-1.5 text-text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                <ChevronRight className="h-4 w-4" />
                            </button>
                        </div>
                    </div>
                ) : null}

                {/* Footer */}
                <footer className="mt-8 pb-6 text-center text-[10px] text-text-muted">
                    Auto-refreshes every hour
                </footer>
            </div>
        </div>
    );
}
