"use client";

import Link from "next/link";
import { startTransition, useEffect, useMemo, useState, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Activity, ArrowRightLeft, BarChart3, ChevronLeft, ChevronRight, Loader2, Search, ShieldAlert, ShieldCheck, Trash2, TriangleAlert } from "lucide-react";
import {
    type BacktestLeaderboardResponse,
    type BacktestLeaderboardRow,
    type BacktestLeaderboardSortField,
    type BacktestLeaderboardStatusFilter,
} from "@/types/engine";
import { type IndicatorInstance } from "@/types/signals";
import StateBanner from "@/components/ui/StateBanner";
import {
    buildBacktestLeaderboardApiParams,
    buildBacktestLeaderboardQuery,
    defaultBacktestLeaderboardQueryState,
    parseBacktestLeaderboardQuery,
    type BacktestLeaderboardQueryState,
} from "@/lib/backtestLeaderboardQuery";
import { buildBacktestLeaderboardRowView } from "@/lib/backtestLeaderboardView";

const formatSigned = (value: number, suffix = "") => `${value >= 0 ? "+" : ""}${value.toFixed(2)}${suffix}`;
const formatShortDate = (value: string | null) => (value ? value.slice(0, 10) : "Open");
const formatSortValue = (value: number, suffix = "", digits = 2) => `${value.toFixed(digits)}${suffix}`;

const sortableColumns: Array<{ field: BacktestLeaderboardSortField; label: string }> = [
    { field: "rank", label: "Rank" },
    { field: "createdAt", label: "Created" },
    { field: "closedTrades", label: "Closed" },
    { field: "winRate", label: "Win %" },
    { field: "netR", label: "Net R" },
    { field: "profitFactor", label: "PF" },
    { field: "expectancy", label: "Expect" },
    { field: "maxDrawdownPct", label: "Max DD" },
];

const statusOptions: BacktestLeaderboardStatusFilter[] = ["ALL", "PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELED"];
const pageSizeOptions = [10, 20, 50, 100];

const summaryToneMap = {
    constructive: {
        icon: ShieldCheck,
        className: "border-price-up/20 bg-price-up/10 text-price-up",
    },
    weaker: {
        icon: TriangleAlert,
        className: "border-accent/20 bg-accent/10 text-accent",
    },
    suspicious: {
        icon: ShieldAlert,
        className: "border-price-down/20 bg-price-down/10 text-price-down",
    },
} as const;

interface LeaderboardFilterDraft {
    signalCode: string;
    symbol: string;
    timeframe: string;
    status: BacktestLeaderboardStatusFilter;
    minClosedTrades: string;
    fromDate: string;
    toDate: string;
}

const toFilterDraft = (state: BacktestLeaderboardQueryState): LeaderboardFilterDraft => ({
    signalCode: state.signalCode,
    symbol: state.symbol,
    timeframe: state.timeframe,
    status: state.status,
    minClosedTrades: state.minClosedTrades,
    fromDate: state.fromDate,
    toDate: state.toDate,
});

const defaultFilterDraft = toFilterDraft(defaultBacktestLeaderboardQueryState);
const canDeleteLeaderboardRun = (status: BacktestLeaderboardRow["status"]) => status !== "PENDING" && status !== "RUNNING";
const canActivateLeaderboardRun = (status: BacktestLeaderboardRow["status"]) => status === "COMPLETED";

const getSortLabel = (row: BacktestLeaderboardRow, field: BacktestLeaderboardSortField) => {
    switch (field) {
        case "createdAt":
            return formatShortDate(row.createdAt);
        case "closedTrades":
            return String(row.closedTrades);
        case "winRate":
            return formatSortValue(row.winRate, "%");
        case "netR":
            return formatSigned(row.netR, "R");
        case "profitFactor":
            return formatSortValue(row.profitFactor);
        case "expectancy":
            return formatSigned(row.expectancy, "R");
        case "maxDrawdownPct":
            return formatSortValue(row.maxDrawdownPct, "%");
        case "rank":
        default:
            return `#${row.rank}`;
    }
};

export function BacktestLeaderboardResultsTable({
    leaderboard,
    isLoading,
    loadError,
    queryState,
    currentParams,
    pathname,
    selectedRunId,
    onReplaceSearch,
    deletingRunId,
    activatingRunId,
    onDeleteRun,
    onActivateRun,
}: {
    leaderboard: BacktestLeaderboardResponse | null;
    isLoading: boolean;
    loadError: string | null;
    queryState: BacktestLeaderboardQueryState;
    currentParams: URLSearchParams;
    pathname: string;
    selectedRunId: string;
    onReplaceSearch: (updates: Partial<BacktestLeaderboardQueryState>) => void;
    deletingRunId: string | null;
    activatingRunId: string | null;
    onDeleteRun: (row: BacktestLeaderboardRow) => void;
    onActivateRun: (row: BacktestLeaderboardRow) => void;
}) {
    const rows = leaderboard?.rows ?? [];
    const pagination = leaderboard?.pagination;
    const summary = leaderboard?.summary;

    return (
        <>
            {summary ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-2xl border border-border-muted bg-bg-tertiary/40 px-4 py-3">
                        <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-text-muted">Visible ranking</div>
                        <div className="mt-2 text-lg font-black text-text-primary">{summary.totalRows}</div>
                        <div className="text-sm text-text-secondary">{summary.totalSignals} unique signals in scope</div>
                    </div>
                    <div className={`rounded-2xl border px-4 py-3 ${summaryToneMap.constructive.className}`}>
                        <summaryToneMap.constructive.icon className="h-4 w-4" />
                        <div className="text-[10px] font-bold uppercase tracking-[0.22em]">Constructive</div>
                        <div className="mt-2 text-lg font-black">{summary.constructiveRows}</div>
                        <div className="text-sm text-current/80">Healthy sample and outcome profile</div>
                    </div>
                    <div className={`rounded-2xl border px-4 py-3 ${summaryToneMap.weaker.className}`}>
                        <summaryToneMap.weaker.icon className="h-4 w-4" />
                        <div className="text-[10px] font-bold uppercase tracking-[0.22em]">Weaker evidence</div>
                        <div className="mt-2 text-lg font-black">{summary.weakerRows}</div>
                        <div className="text-sm text-current/80">Needs more trades or cleaner finish</div>
                    </div>
                    <div className={`rounded-2xl border px-4 py-3 ${summaryToneMap.suspicious.className}`}>
                        <summaryToneMap.suspicious.icon className="h-4 w-4" />
                        <div className="text-[10px] font-bold uppercase tracking-[0.22em]">Suspicious</div>
                        <div className="mt-2 text-lg font-black">{summary.suspiciousRows}</div>
                        <div className="text-sm text-current/80">Failed, underwater, or high drawdown runs</div>
                    </div>
                </div>
            ) : null}

            {loadError ? (
                <StateBanner
                    tone="danger"
                    size="compact"
                    className="mt-4"
                    message={loadError}
                />
            ) : null}

            <div className="mt-4 overflow-x-auto rounded-2xl border border-border-muted">
                <table className="min-w-[1220px] text-left text-sm">
                    <thead className="bg-bg-tertiary/80 text-xs uppercase tracking-[0.18em] text-text-muted">
                        <tr>
                            {sortableColumns.map((column) => {
                                const isActive = queryState.sort === column.field;
                                const nextOrder = isActive && queryState.order === "desc" ? "asc" : "desc";

                                return (
                                    <th key={column.field} className="px-4 py-3">
                                        <button
                                            type="button"
                                            onClick={() => onReplaceSearch({ sort: column.field, order: nextOrder, page: 1 })}
                                            className={`inline-flex items-center gap-1 font-bold ${isActive ? "text-text-primary" : "text-text-muted"}`}
                                        >
                                            {column.label}
                                            <span className="text-[10px]">{isActive ? (queryState.order === "desc" ? "v" : "^") : "<>"}</span>
                                        </button>
                                    </th>
                                );
                            })}
                            <th className="px-4 py-3">Signal</th>
                            <th className="px-4 py-3">Market</th>
                            <th className="px-4 py-3">Window</th>
                            <th className="px-4 py-3">Status / evidence</th>
                            <th className="px-4 py-3">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading ? (
                            <tr>
                                <td colSpan={sortableColumns.length + 6} className="px-4 py-12">
                                    <div className="flex items-center justify-center gap-3 text-sm text-text-secondary">
                                        <Loader2 className="h-5 w-5 animate-spin text-accent" />
                                        Building generated backtest ranking...
                                    </div>
                                </td>
                            </tr>
                        ) : rows.length === 0 ? (
                            <tr>
                                <td colSpan={sortableColumns.length + 6} className="px-4 py-10">
                                    <div className="rounded-2xl border border-dashed border-border-muted bg-bg-tertiary/35 px-4 py-6 text-sm text-text-secondary">
                                        No generated backtest rows matched the current leaderboard filters.
                                    </div>
                                </td>
                            </tr>
                        ) : rows.map((row) => {
                            const view = buildBacktestLeaderboardRowView(row, {
                                reportBasePath: pathname,
                                reportSearchParams: currentParams,
                                selectedRunId,
                            });
                            const primaryFlag = row.cautionFlags[0] ?? "No caution flags";
                            const isDeleting = deletingRunId === row.runId;
                            const isActivating = activatingRunId === row.runId;

                            return (
                                <tr
                                    key={row.runId}
                                    className={`border-t border-border-muted/70 align-top transition hover:bg-bg-tertiary/25 ${row.runId === selectedRunId ? "bg-accent/8" : ""}`}
                                >
                                    <td className="px-4 py-3 font-black text-text-primary">#{row.rank}</td>
                                    <td className="px-4 py-3 text-text-secondary">{formatShortDate(row.createdAt)}</td>
                                    <td className="px-4 py-3 text-text-secondary">
                                        <div>{row.closedTrades}</div>
                                        <div className="text-xs text-text-muted">
                                            {row.totalTrades} total{row.openTrades > 0 ? ` / ${row.openTrades} open` : ""}
                                        </div>
                                    </td>
                                    <td className={`px-4 py-3 font-semibold ${row.winRate >= 50 ? "text-price-up" : "text-price-down"}`}>{row.winRate.toFixed(1)}%</td>
                                    <td className={`px-4 py-3 font-semibold ${row.netR >= 0 ? "text-price-up" : "text-price-down"}`}>{formatSigned(row.netR, "R")}</td>
                                    <td className="px-4 py-3 text-text-primary">{row.profitFactor.toFixed(2)}</td>
                                    <td className={`px-4 py-3 font-semibold ${row.expectancy >= 0 ? "text-price-up" : "text-price-down"}`}>{formatSigned(row.expectancy, "R")}</td>
                                    <td className="px-4 py-3 font-semibold text-price-down">{row.maxDrawdownPct.toFixed(1)}%</td>
                                    <td className="px-4 py-3">
                                        <div className="font-bold text-text-primary">{view.signalIdentity}</div>
                                        <div className="text-xs text-text-muted">{row.runName}</div>
                                        {row.notes && (
                                            <div className="mt-0.5 max-w-[220px] truncate text-[10px] text-text-secondary" title={row.notes}>
                                                {row.notes.includes("GO-LIVE")
                                                    ? <span className="rounded-full bg-price-up/15 px-1.5 py-0.5 font-black uppercase tracking-wider text-price-up">GO-LIVE</span>
                                                    : row.notes}
                                            </div>
                                        )}
                                        <div className="mt-1 text-xs text-text-muted">Lead metric: {getSortLabel(row, queryState.sort)}</div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="font-semibold text-text-primary">{row.symbol}</div>
                                        <div className="text-xs text-text-muted">{row.timeframe} / {row.signalCount} signals</div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="font-medium text-text-primary">{view.windowLabel}</div>
                                        <div className="text-xs text-text-muted">Created {formatShortDate(row.createdAt)}</div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex flex-wrap gap-2">
                                            <span className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${view.statusTone}`}>
                                                {row.status}
                                            </span>
                                            <span
                                                title={row.cautionFlags.join(" | ")}
                                                className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${view.cautionTone}`}
                                            >
                                                {view.cautionLabel}
                                            </span>
                                        </div>
                                        <div className="mt-2 max-w-[240px] text-xs text-text-secondary">{primaryFlag}</div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex flex-col gap-2">
                                            <Link
                                                href={view.reportHref}
                                                className="inline-flex items-center justify-center rounded-full bg-accent px-3 py-1.5 text-xs font-black text-bg-secondary"
                                            >
                                                Open report
                                            </Link>
                                            <div className="flex flex-wrap gap-2">
                                                <Link
                                                    href={view.detailHref}
                                                    className="inline-flex items-center justify-center rounded-full border border-border-muted bg-bg-tertiary px-3 py-1.5 text-xs font-bold text-text-primary"
                                                >
                                                    Detail
                                                </Link>
                                                {view.compareHref ? (
                                                    <Link
                                                        href={view.compareHref}
                                                        className="inline-flex items-center gap-1 rounded-full border border-border-muted bg-bg-tertiary px-3 py-1.5 text-xs font-bold text-text-primary"
                                                    >
                                                        <ArrowRightLeft className="h-3.5 w-3.5" />
                                                        Compare
                                                    </Link>
                                                ) : (
                                                    <span className="inline-flex items-center rounded-full border border-border-muted/70 bg-bg-tertiary/40 px-3 py-1.5 text-xs font-bold text-text-muted">
                                                        Compare
                                                    </span>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => onDeleteRun(row)}
                                                    disabled={isDeleting || isActivating || !canDeleteLeaderboardRun(row.status)}
                                                    title={canDeleteLeaderboardRun(row.status) ? "Delete generated run" : "Only completed, failed, or canceled runs can be deleted"}
                                                    className="inline-flex items-center justify-center gap-1 rounded-full border border-border-muted bg-bg-tertiary px-3 py-1.5 text-xs font-bold text-text-muted transition-colors hover:border-price-down/35 hover:text-price-down disabled:cursor-not-allowed disabled:opacity-50"
                                                >
                                                    {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                                                    Delete
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => onActivateRun(row)}
                                                    disabled={isDeleting || isActivating || !canActivateLeaderboardRun(row.status)}
                                                    title={canActivateLeaderboardRun(row.status) ? "Promote this run into an active indicator instance" : "Only completed runs can be activated as indicators"}
                                                    className="inline-flex items-center justify-center gap-1 rounded-full border border-border-muted bg-bg-tertiary px-3 py-1.5 text-xs font-bold text-text-primary transition-colors hover:border-accent/35 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                                                >
                                                    {isActivating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}
                                                    Activate
                                                </button>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {pagination ? (
                <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="text-sm text-text-secondary">
                        {pagination.totalRows === 0
                            ? "No ranked rows"
                            : `Showing ${(pagination.page - 1) * pagination.pageSize + 1}-${Math.min(pagination.page * pagination.pageSize, pagination.totalRows)} of ${pagination.totalRows} rows`}
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => onReplaceSearch({ page: Math.max(queryState.page - 1, 1) })}
                            disabled={pagination.page <= 1}
                            className="inline-flex items-center gap-1 rounded-full border border-border-muted bg-bg-tertiary px-3 py-1.5 text-sm font-bold text-text-primary disabled:opacity-50"
                        >
                            <ChevronLeft className="h-4 w-4" />
                            Prev
                        </button>
                        <div className="rounded-full border border-border-muted bg-bg-tertiary px-3 py-1.5 text-sm font-bold text-text-primary">
                            Page {pagination.totalPages === 0 ? 0 : pagination.page} / {pagination.totalPages}
                        </div>
                        <button
                            type="button"
                            onClick={() => onReplaceSearch({ page: queryState.page + 1 })}
                            disabled={pagination.totalPages === 0 || pagination.page >= pagination.totalPages}
                            className="inline-flex items-center gap-1 rounded-full border border-border-muted bg-bg-tertiary px-3 py-1.5 text-sm font-bold text-text-primary disabled:opacity-50"
                        >
                            Next
                            <ChevronRight className="h-4 w-4" />
                        </button>
                    </div>
                </div>
            ) : null}
        </>
    );
}

export default function BacktestLeaderboardPanel({
    apiUrl,
    selectedRunId,
}: {
    apiUrl: string;
    selectedRunId: string;
}) {
    const pathname = usePathname();
    const router = useRouter();
    const searchParams = useSearchParams();
    const searchParamString = searchParams.toString();
    const currentParams = useMemo(() => new URLSearchParams(searchParamString), [searchParamString]);
    const queryState = useMemo(() => parseBacktestLeaderboardQuery(currentParams), [currentParams]);
    const leaderboardApiQuery = useMemo(
        () => buildBacktestLeaderboardApiParams(queryState).toString(),
        [queryState],
    );
    const [draft, setDraft] = useState<LeaderboardFilterDraft>(() => toFilterDraft(queryState));
    const [leaderboard, setLeaderboard] = useState<BacktestLeaderboardResponse | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [deletingRunId, setDeletingRunId] = useState<string | null>(null);
    const [activatingRunId, setActivatingRunId] = useState<string | null>(null);
    const [refreshNonce, setRefreshNonce] = useState(0);
    const [actionNotice, setActionNotice] = useState<{
        tone: "success" | "danger";
        message: string;
        indicatorInstance: IndicatorInstance | null;
    } | null>(null);

    useEffect(() => {
        setDraft(toFilterDraft(queryState));
    }, [
        queryState.fromDate,
        queryState.minClosedTrades,
        queryState.signalCode,
        queryState.status,
        queryState.symbol,
        queryState.timeframe,
        queryState.toDate,
    ]);

    useEffect(() => {
        let active = true;
        setIsLoading(true);
        setLoadError(null);

        fetch(`${apiUrl}/api/engine/backtest-leaderboard?${leaderboardApiQuery}`)
            .then(async (response) => {
                if (!response.ok) {
                    throw new Error("Failed to load generated backtest leaderboard.");
                }
                return response.json() as Promise<{ data: BacktestLeaderboardResponse }>;
            })
            .then((result) => {
                if (!active) return;
                setLeaderboard(result.data);
            })
            .catch((error) => {
                if (!active) return;
                setLoadError(error instanceof Error ? error.message : "Failed to load generated backtest leaderboard.");
                setLeaderboard(null);
            })
            .finally(() => {
                if (!active) return;
                setIsLoading(false);
            });

        return () => {
            active = false;
        };
    }, [apiUrl, leaderboardApiQuery, refreshNonce]);

    const replaceRouteParams = (updates: Record<string, string | null>) => {
        const next = new URLSearchParams(Array.from(currentParams.entries()));
        Object.entries(updates).forEach(([key, value]) => {
            if (!value) {
                next.delete(key);
                return;
            }
            next.set(key, value);
        });

        const query = next.toString();
        startTransition(() => {
            router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
        });
    };

    const replaceSearch = (updates: Partial<BacktestLeaderboardQueryState>) => {
        const next = buildBacktestLeaderboardQuery(queryState, updates, currentParams);
        const query = next.toString();
        startTransition(() => {
            router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
        });
    };

    const handleDeleteRun = async (row: BacktestLeaderboardRow) => {
        if (!canDeleteLeaderboardRun(row.status)) {
            setActionNotice({
                tone: "danger",
                message: "Only completed, failed, or canceled runs can be deleted.",
                indicatorInstance: null,
            });
            return;
        }

        const confirmed = window.confirm(`Delete generated run "${row.runName}"? This removes the saved generated run history from the leaderboard.`);
        if (!confirmed) {
            return;
        }

        setDeletingRunId(row.runId);
        setActionNotice(null);

        try {
            const response = await fetch(`${apiUrl}/api/signals/backtests/${row.runId}`, {
                method: "DELETE",
            });
            const result = await response.json().catch(() => null) as { data?: { id: string; name: string }; error?: string } | null;
            if (!response.ok) {
                throw new Error(result?.error || "Failed to delete generated run.");
            }

            if (row.runId === selectedRunId) {
                replaceRouteParams({
                    backtestRunId: null,
                    run: null,
                    signalId: null,
                    signal: null,
                });
            }

            setActionNotice({
                tone: "success",
                message: `Deleted generated run ${result?.data?.name || row.runName}.`,
                indicatorInstance: null,
            });
            setRefreshNonce((current) => current + 1);
        } catch (error) {
            setActionNotice({
                tone: "danger",
                message: error instanceof Error ? error.message : "Failed to delete generated run.",
                indicatorInstance: null,
            });
        } finally {
            setDeletingRunId(null);
        }
    };

    const handleActivateRun = async (row: BacktestLeaderboardRow) => {
        if (!canActivateLeaderboardRun(row.status)) {
            setActionNotice({
                tone: "danger",
                message: "Only completed runs can be activated as indicators.",
                indicatorInstance: null,
            });
            return;
        }

        setActivatingRunId(row.runId);
        setActionNotice(null);

        try {
            const response = await fetch(`${apiUrl}/api/indicators/instances/promote`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    backtestRunId: row.runId,
                }),
            });
            const result = await response.json().catch(() => null) as IndicatorInstance | { error?: string } | null;
            if (!response.ok) {
                throw new Error((result && "error" in result && typeof result.error === "string" ? result.error : null) || "Failed to activate indicator.");
            }
            const instance = result as IndicatorInstance;

            setActionNotice({
                tone: "success",
                message: `${instance.name || row.runName} is now active as an indicator instance.`,
                indicatorInstance: instance,
            });
        } catch (error) {
            setActionNotice({
                tone: "danger",
                message: error instanceof Error ? error.message : "Failed to activate indicator.",
                indicatorInstance: null,
            });
        } finally {
            setActivatingRunId(null);
        }
    };

    const handleApplyFilters = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        replaceSearch({
            ...draft,
            page: 1,
        });
    };

    const handleResetFilters = () => {
        setDraft(defaultFilterDraft);
        replaceSearch({
            ...defaultFilterDraft,
            page: 1,
        });
    };

    return (
        <section className="rounded-3xl border border-border-muted bg-bg-primary/90 p-4 shadow-[0_24px_70px_rgba(0,0,0,0.28)]">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div>
                    <div className="flex items-center gap-2 text-sm font-bold text-text-primary">
                        <BarChart3 className="h-4 w-4 text-accent" />
                        Generated Backtest Leaderboard
                    </div>
                    <p className="mt-1 max-w-3xl text-sm text-text-secondary">
                        Shortlist signals from one ranked surface. Ranking is guidance only, and cautious rows stay demoted even when one headline metric looks strong.
                    </p>
                </div>

                <div className="flex flex-wrap gap-2">
                    <button
                        onClick={() => replaceSearch({ mode: "BEST_PER_SIGNAL", page: 1 })}
                        className={`rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${queryState.mode === "BEST_PER_SIGNAL" ? "bg-accent text-bg-secondary" : "border border-border-muted bg-bg-tertiary text-text-primary"}`}
                    >
                        Best per signal
                    </button>
                    <button
                        onClick={() => replaceSearch({ mode: "ALL_RUNS", page: 1 })}
                        className={`rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${queryState.mode === "ALL_RUNS" ? "bg-accent text-bg-secondary" : "border border-border-muted bg-bg-tertiary text-text-primary"}`}
                    >
                        All runs
                    </button>
                </div>
            </div>

            <form onSubmit={handleApplyFilters} className="mt-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-7">
                <label className="flex flex-col gap-1 text-xs text-text-muted">
                    Signal
                    <input
                        value={draft.signalCode}
                        onChange={(event) => setDraft((current) => ({ ...current, signalCode: event.target.value }))}
                        placeholder="songTrap"
                        className="rounded-xl border border-border-muted bg-bg-tertiary px-3 py-2 text-sm font-medium text-text-primary outline-none focus:border-accent/50"
                    />
                </label>
                <label className="flex flex-col gap-1 text-xs text-text-muted">
                    Symbol
                    <input
                        value={draft.symbol}
                        onChange={(event) => setDraft((current) => ({ ...current, symbol: event.target.value.toUpperCase() }))}
                        placeholder="XAUUSD"
                        className="rounded-xl border border-border-muted bg-bg-tertiary px-3 py-2 text-sm font-medium text-text-primary outline-none focus:border-accent/50"
                    />
                </label>
                <label className="flex flex-col gap-1 text-xs text-text-muted">
                    Timeframe
                    <input
                        value={draft.timeframe}
                        onChange={(event) => setDraft((current) => ({ ...current, timeframe: event.target.value }))}
                        placeholder="1h"
                        className="rounded-xl border border-border-muted bg-bg-tertiary px-3 py-2 text-sm font-medium text-text-primary outline-none focus:border-accent/50"
                    />
                </label>
                <label className="flex flex-col gap-1 text-xs text-text-muted">
                    Status
                    <select
                        value={draft.status}
                        onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value as BacktestLeaderboardStatusFilter }))}
                        className="rounded-xl border border-border-muted bg-bg-tertiary px-3 py-2 text-sm font-medium text-text-primary outline-none focus:border-accent/50"
                    >
                        {statusOptions.map((status) => (
                            <option key={status} value={status}>
                                {status === "ALL" ? "All statuses" : status}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-text-muted">
                    Min closed
                    <input
                        type="number"
                        min="0"
                        value={draft.minClosedTrades}
                        onChange={(event) => setDraft((current) => ({ ...current, minClosedTrades: event.target.value }))}
                        className="rounded-xl border border-border-muted bg-bg-tertiary px-3 py-2 text-sm font-medium text-text-primary outline-none focus:border-accent/50"
                    />
                </label>
                <label className="flex flex-col gap-1 text-xs text-text-muted">
                    From (UTC)
                    <input
                        type="date"
                        value={draft.fromDate}
                        max={draft.toDate || undefined}
                        onChange={(event) => setDraft((current) => ({ ...current, fromDate: event.target.value }))}
                        className="rounded-xl border border-border-muted bg-bg-tertiary px-3 py-2 text-sm font-medium text-text-primary outline-none focus:border-accent/50"
                    />
                </label>
                <label className="flex flex-col gap-1 text-xs text-text-muted">
                    To (UTC)
                    <input
                        type="date"
                        value={draft.toDate}
                        min={draft.fromDate || undefined}
                        onChange={(event) => setDraft((current) => ({ ...current, toDate: event.target.value }))}
                        className="rounded-xl border border-border-muted bg-bg-tertiary px-3 py-2 text-sm font-medium text-text-primary outline-none focus:border-accent/50"
                    />
                </label>

                <div className="flex flex-wrap items-end gap-2 xl:col-span-7">
                    <button
                        type="submit"
                        className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-black text-bg-secondary"
                    >
                        <Search className="h-4 w-4" />
                        Apply filters
                    </button>
                    <button
                        type="button"
                        onClick={handleResetFilters}
                        className="rounded-full border border-border-muted bg-bg-tertiary px-4 py-2 text-sm font-bold text-text-primary"
                    >
                        Reset
                    </button>
                    <label className="ml-auto flex items-center gap-2 text-xs text-text-muted">
                        Page size
                        <select
                            value={queryState.pageSize}
                            onChange={(event) => replaceSearch({ pageSize: Number(event.target.value), page: 1 })}
                            className="rounded-xl border border-border-muted bg-bg-tertiary px-3 py-2 text-sm font-medium text-text-primary outline-none focus:border-accent/50"
                        >
                            {pageSizeOptions.map((size) => (
                                <option key={size} value={size}>
                                    {size}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
            </form>

            {actionNotice ? (
                <StateBanner
                    tone={actionNotice.tone}
                    size="compact"
                    className="mt-4"
                    message={actionNotice.message}
                    action={actionNotice.tone === "success" && actionNotice.indicatorInstance ? (
                        <div className="flex flex-wrap gap-2">
                            <Link
                                href={`/indicators/${actionNotice.indicatorInstance.id}/chart`}
                                className="inline-flex items-center gap-2 rounded-full bg-accent px-3 py-1.5 text-xs font-black text-bg-secondary"
                            >
                                Open Analyzer
                            </Link>
                            <Link
                                href="/indicators"
                                className="inline-flex items-center gap-2 rounded-full border border-border-muted bg-bg-tertiary px-3 py-1.5 text-xs font-bold text-text-primary"
                            >
                                Indicator Dashboard
                            </Link>
                        </div>
                    ) : undefined}
                />
            ) : null}

            <BacktestLeaderboardResultsTable
                leaderboard={leaderboard}
                isLoading={isLoading}
                loadError={loadError}
                queryState={queryState}
                currentParams={currentParams}
                pathname={pathname}
                selectedRunId={selectedRunId}
                onReplaceSearch={replaceSearch}
                deletingRunId={deletingRunId}
                activatingRunId={activatingRunId}
                onDeleteRun={handleDeleteRun}
                onActivateRun={handleActivateRun}
            />
        </section>
    );
}
