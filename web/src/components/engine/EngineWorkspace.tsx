"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
    Activity,
    ArrowRight,
    BarChart3,
    CandlestickChart,
    ChevronDown,
    ChevronUp,
    Filter,
    Layers3,
    Loader2,
    Sigma,
    SlidersHorizontal,
    Tags,
    Target,
    TrendingDown,
    TrendingUp,
    X,
} from "lucide-react";
import MultiPaneChart from "@/components/chart/MultiPaneChart";
import { useMarketStore } from "@/store/useMarketStore";
import {
    EngineAnnotation,
    EngineOverview,
    EngineRun,
    EngineStrategy,
    ExitComparisonRow,
    SessionBreakdownRow,
    StrategyBreakdownRow,
} from "@/types/engine";

const sideFilters = [
    { label: "ALL", value: "ALL" },
    { label: "LONG", value: "LONG" },
    { label: "SHORT", value: "SHORT" },
] as const;

const formatSigned = (value: number, suffix = "") => `${value >= 0 ? "+" : ""}${value.toFixed(2)}${suffix}`;
const formatDateInput = (value: string | null) => (value ? value.slice(0, 10) : "");
const toUtcRangeStart = (value: string) => `${value}T00:00:00.000Z`;
const toUtcRangeEnd = (value: string) => `${value}T23:59:59.999Z`;

const fetchJson = async <T,>(url: string): Promise<T> => {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to load ${url}`);
    }
    return response.json();
};

/* ── tiny inline win-rate bar ── */
function WinRateBar({ value, className }: { value: number; className?: string }) {
    return (
        <div className={`flex items-center gap-2 ${className ?? ""}`}>
            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-bg-tertiary">
                <div
                    className={`h-full rounded-full transition-all ${value >= 50 ? "bg-price-up" : "bg-price-down"}`}
                    style={{ width: `${Math.min(value, 100)}%` }}
                />
            </div>
            <span className={`text-xs font-semibold tabular-nums ${value >= 50 ? "text-price-up" : "text-price-down"}`}>
                {value.toFixed(1)}%
            </span>
        </div>
    );
}

export default function EngineWorkspace() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
    const searchParams = useSearchParams();
    const { setSymbol, setTimeframe } = useMarketStore();
    const initialRouteFilters = useRef({
        runId: searchParams.get("run"),
        signalId: searchParams.get("signalId"),
        strategyId: searchParams.get("strategyId"),
        session: searchParams.get("session"),
        side: searchParams.get("side"),
        exitRuleId: searchParams.get("exitRuleId"),
        from: searchParams.get("from"),
        to: searchParams.get("to"),
    });
    const [runs, setRuns] = useState<EngineRun[]>([]);
    const [strategies, setStrategies] = useState<EngineStrategy[]>([]);
    const [selectedRunId, setSelectedRunId] = useState<string>("");
    const [side, setSide] = useState<"ALL" | "LONG" | "SHORT">("ALL");
    const [selectedStrategyId, setSelectedStrategyId] = useState<string>("ALL");
    const [selectedSession, setSelectedSession] = useState<"ALL" | "ASIAN" | "LONDON" | "NY">("ALL");
    const [selectedExitRuleId, setSelectedExitRuleId] = useState<string>("ALL");
    const [selectedSignalId, setSelectedSignalId] = useState<string>("ALL");
    const [fromDate, setFromDate] = useState<string>("");
    const [toDate, setToDate] = useState<string>("");
    const [overview, setOverview] = useState<EngineOverview | null>(null);
    const [byStrategy, setByStrategy] = useState<StrategyBreakdownRow[]>([]);
    const [bySession, setBySession] = useState<SessionBreakdownRow[]>([]);
    const [exitComparison, setExitComparison] = useState<ExitComparisonRow[]>([]);
    const [annotations, setAnnotations] = useState<EngineAnnotation[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

    const exitRuleOptions = useMemo(
        () => [
            { exitRuleId: "ALL", exitRuleName: "All exit rules" },
            ...exitComparison.map((row) => ({ exitRuleId: row.exitRuleId, exitRuleName: row.exitRuleName })),
        ],
        [exitComparison]
    );

    /* ── active filter pills ── */
    const activeFilters = useMemo(() => {
        const pills: Array<{ key: string; label: string; onClear: () => void }> = [];
        if (selectedStrategyId !== "ALL") {
            const strat = strategies.find((s) => s.id === selectedStrategyId);
            pills.push({
                key: "strategy",
                label: `Strategy: ${strat?.code ?? selectedStrategyId.slice(0, 8)}`,
                onClear: () => { setIsLoading(true); setSelectedStrategyId("ALL"); },
            });
        }
        if (selectedSession !== "ALL") {
            pills.push({
                key: "session",
                label: `Session: ${selectedSession}`,
                onClear: () => { setIsLoading(true); setSelectedSession("ALL"); },
            });
        }
        if (side !== "ALL") {
            pills.push({
                key: "side",
                label: `Side: ${side}`,
                onClear: () => { setIsLoading(true); setSide("ALL"); },
            });
        }
        if (selectedSignalId !== "ALL") {
            pills.push({
                key: "signal",
                label: `Signal: ${selectedSignalId.slice(0, 8)}`,
                onClear: () => { setIsLoading(true); setSelectedSignalId("ALL"); },
            });
        }
        return pills;
    }, [selectedStrategyId, selectedSession, side, selectedSignalId, strategies]);

    /* ── best exit rule by Net R ── */
    const bestExitRuleId = useMemo(() => {
        if (exitComparison.length === 0) return null;
        return exitComparison.reduce((best, row) => (row.netR > best.netR ? row : best), exitComparison[0]).exitRuleId;
    }, [exitComparison]);

    useEffect(() => {
        let active = true;

        Promise.all([
            fetchJson<{ data: EngineRun[] }>(`${apiUrl}/api/engine/runs`),
            fetchJson<{ data: EngineStrategy[] }>(`${apiUrl}/api/engine/strategies`),
        ])
            .then(([runsResult, strategyResult]) => {
                if (!active) return;
                setRuns(runsResult.data);
                setStrategies(strategyResult.data);
                if (runsResult.data.length > 0) {
                    const requestedRun = runsResult.data.find((run) => run.id === initialRouteFilters.current.runId);
                    const initialRun = requestedRun || runsResult.data[0];

                    setSelectedRunId(initialRun.id);
                    setSelectedStrategyId(initialRouteFilters.current.strategyId || "ALL");
                    setSelectedSession(
                        initialRouteFilters.current.session === "ASIAN"
                            || initialRouteFilters.current.session === "LONDON"
                            || initialRouteFilters.current.session === "NY"
                            ? initialRouteFilters.current.session
                            : "ALL"
                    );
                    setSide(
                        initialRouteFilters.current.side === "LONG" || initialRouteFilters.current.side === "SHORT"
                            ? initialRouteFilters.current.side
                            : "ALL"
                    );
                    setSelectedExitRuleId(initialRouteFilters.current.exitRuleId || "ALL");
                    setSelectedSignalId(initialRouteFilters.current.signalId || "ALL");
                    setFromDate(initialRouteFilters.current.from ? formatDateInput(initialRouteFilters.current.from) : formatDateInput(initialRun.startedAt));
                    setToDate(initialRouteFilters.current.to ? formatDateInput(initialRouteFilters.current.to) : formatDateInput(initialRun.finishedAt || initialRun.createdAt));

                    // Auto-expand advanced filters if any non-default filter came from URL
                    if (
                        initialRouteFilters.current.strategyId
                        || initialRouteFilters.current.session
                        || (initialRouteFilters.current.side === "LONG" || initialRouteFilters.current.side === "SHORT")
                        || initialRouteFilters.current.signalId
                    ) {
                        setShowAdvancedFilters(true);
                    }
                } else {
                    setIsLoading(false);
                }
            })
            .catch((err) => {
                if (!active) return;
                setError(err.message);
                setIsLoading(false);
            });

        return () => {
            active = false;
        };
    }, [apiUrl]);

    useEffect(() => {
        if (!selectedRunId) return;
        let active = true;

        const params = new URLSearchParams({ backtestRunId: selectedRunId });
        if (selectedSignalId !== "ALL") {
            params.set("signalId", selectedSignalId);
        }
        if (side !== "ALL") {
            params.set("side", side);
        }
        if (selectedStrategyId !== "ALL") {
            params.set("strategyId", selectedStrategyId);
        }
        if (selectedSession !== "ALL") {
            params.set("session", selectedSession);
        }
        if (fromDate) {
            params.set("from", toUtcRangeStart(fromDate));
        }
        if (toDate) {
            params.set("to", toUtcRangeEnd(toDate));
        }

        const annotationParams = new URLSearchParams(params);
        if (selectedExitRuleId !== "ALL") {
            annotationParams.set("exitRuleId", selectedExitRuleId);
        }

        Promise.all([
            fetchJson<{ data: EngineOverview }>(`${apiUrl}/api/engine/overview?${params}`),
            fetchJson<{ data: StrategyBreakdownRow[] }>(`${apiUrl}/api/engine/by-strategy?${params}`),
            fetchJson<{ data: SessionBreakdownRow[] }>(`${apiUrl}/api/engine/sessions?${params}`),
            fetchJson<{ data: ExitComparisonRow[] }>(`${apiUrl}/api/engine/exit-comparison?${params}`),
            fetchJson<{ data: EngineAnnotation[] }>(`${apiUrl}/api/engine/annotations?${annotationParams}`),
        ])
            .then(([overviewResult, strategyResult, sessionResult, exitResult, annotationResult]) => {
                if (!active) return;
                setOverview(overviewResult.data);
                setByStrategy(strategyResult.data);
                setBySession(sessionResult.data);
                setExitComparison(exitResult.data);
                setAnnotations(annotationResult.data);

                if (
                    selectedExitRuleId !== "ALL"
                    && !exitResult.data.some((row) => row.exitRuleId === selectedExitRuleId)
                ) {
                    setSelectedExitRuleId("ALL");
                }

                if (overviewResult.data.context) {
                    setSymbol(overviewResult.data.context.symbol);
                    setTimeframe(overviewResult.data.context.timeframe);
                }
            })
            .catch((err) => {
                if (!active) return;
                setError(err.message);
            })
            .finally(() => {
                if (!active) return;
                setIsLoading(false);
            });

        return () => {
            active = false;
        };
    }, [apiUrl, fromDate, selectedExitRuleId, selectedRunId, selectedSession, selectedSignalId, selectedStrategyId, setSymbol, setTimeframe, side, toDate]);

    const selectedRun = useMemo(() => runs.find((r) => r.id === selectedRunId) ?? null, [runs, selectedRunId]);

    if (error) {
        return (
            <div className="h-full rounded-3xl border border-price-down/20 bg-bg-primary p-8 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-price-down/10 text-price-down">
                    <Activity className="h-6 w-6" />
                </div>
                <h2 className="mt-4 text-xl font-bold">Engine data unavailable</h2>
                <p className="mt-2 text-sm text-text-secondary">{error}</p>
            </div>
        );
    }

    if (!isLoading && runs.length === 0) {
        return (
            <div className="h-full rounded-3xl border border-border-muted bg-bg-primary p-8 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 text-accent">
                    <Sigma className="h-6 w-6" />
                </div>
                <h2 className="mt-4 text-xl font-bold">Engine ready for backtests</h2>
                <p className="mt-2 text-sm text-text-secondary">
                    No `backtest_runs` are available in the database yet. Run `npm run seed:engine` or import signal/result data to get started.
                </p>
            </div>
        );
    }

    const isProfitable = overview ? overview.metrics.netR >= 0 : null;

    return (
        <div className="command-deck-canvas h-full overflow-y-auto">
            <div className="mx-auto flex min-h-full max-w-[1600px] flex-col gap-5 p-4 lg:p-6">

                {/* ═══════════════════════════════════════════
                    SECTION 1 — HERO SUMMARY + RUN SELECTOR
                    User sees P&L health in < 1 second
                ═══════════════════════════════════════════ */}
                <section className="rounded-3xl border border-border-muted bg-bg-primary/90 p-5 shadow-[0_30px_80px_rgba(0,0,0,0.35)]">
                    {/* Row 1: Title + Run selector */}
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
                                <CandlestickChart className="h-5 w-5" />
                            </div>
                            <div>
                                <h1 className="text-lg font-black tracking-tight text-text-primary">Engine Workspace</h1>
                                {selectedRun && (
                                    <p className="text-xs text-text-muted">
                                        {selectedRun.symbol} / {selectedRun.timeframe}
                                        {fromDate && toDate ? ` · ${fromDate} → ${toDate}` : ""}
                                    </p>
                                )}
                            </div>
                        </div>

                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <select
                                value={selectedRunId}
                                onChange={(event) => {
                                    const nextRun = runs.find((run) => run.id === event.target.value);
                                    setIsLoading(true);
                                    setSelectedRunId(event.target.value);
                                    setSelectedSignalId("ALL");
                                    setFromDate(formatDateInput(nextRun?.startedAt || null));
                                    setToDate(formatDateInput(nextRun?.finishedAt || nextRun?.createdAt || null));
                                }}
                                className="min-w-[260px] rounded-xl border border-border-muted bg-bg-tertiary px-3 py-2 text-sm font-medium text-text-primary outline-none focus:border-accent/50"
                            >
                                {runs.map((run) => (
                                    <option key={run.id} value={run.id}>
                                        {run.name} / {run.symbol} / {run.timeframe}
                                    </option>
                                ))}
                            </select>
                            <button
                                onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                                className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition-colors ${
                                    showAdvancedFilters || activeFilters.length > 0
                                        ? "border-accent/30 bg-accent/10 text-accent"
                                        : "border-border-muted bg-bg-tertiary text-text-secondary hover:text-text-primary"
                                }`}
                            >
                                <SlidersHorizontal className="h-3.5 w-3.5" />
                                Filters
                                {activeFilters.length > 0 && (
                                    <span className="ml-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[10px] font-black text-bg-secondary">
                                        {activeFilters.length}
                                    </span>
                                )}
                                {showAdvancedFilters ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            </button>
                        </div>
                    </div>

                    {/* Active filter pills */}
                    {activeFilters.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                            {activeFilters.map((pill) => (
                                <span
                                    key={pill.key}
                                    className="inline-flex items-center gap-1 rounded-full border border-accent/20 bg-accent/10 px-2.5 py-1 text-[11px] font-semibold text-accent"
                                >
                                    {pill.label}
                                    <button onClick={pill.onClear} className="rounded-full p-0.5 hover:bg-accent/20">
                                        <X className="h-2.5 w-2.5" />
                                    </button>
                                </span>
                            ))}
                            {activeFilters.length > 1 && (
                                <button
                                    onClick={() => {
                                        setIsLoading(true);
                                        setSelectedStrategyId("ALL");
                                        setSelectedSession("ALL");
                                        setSide("ALL");
                                        setSelectedSignalId("ALL");
                                    }}
                                    className="rounded-full px-2.5 py-1 text-[11px] font-semibold text-text-muted hover:text-text-primary"
                                >
                                    Clear all
                                </button>
                            )}
                        </div>
                    )}

                    {/* Row 2: Hero P&L summary (visible when data loaded) */}
                    {overview && !isLoading && (
                        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            {/* Hero: Net R */}
                            <div className={`rounded-2xl border p-4 ${isProfitable ? "border-price-up/20 bg-price-up/8" : "border-price-down/20 bg-price-down/8"}`}>
                                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.24em] text-text-muted">
                                    {isProfitable ? <TrendingUp className="h-3.5 w-3.5 text-price-up" /> : <TrendingDown className="h-3.5 w-3.5 text-price-down" />}
                                    Net Result
                                </div>
                                <div className={`mt-1 text-3xl font-black tabular-nums tracking-tight ${isProfitable ? "text-price-up" : "text-price-down"}`}>
                                    {formatSigned(overview.metrics.netR, "R")}
                                </div>
                                <div className="mt-1 text-xs text-text-secondary">
                                    ${overview.metrics.netUsd.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} net P&L
                                </div>
                            </div>

                            {/* Hero: Win Rate */}
                            <div className="rounded-2xl border border-border-muted bg-bg-tertiary/45 p-4">
                                <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-text-muted">Win Rate</div>
                                <div className={`mt-1 text-3xl font-black tabular-nums tracking-tight ${overview.metrics.winRate >= 50 ? "text-price-up" : "text-price-down"}`}>
                                    {overview.metrics.winRate.toFixed(1)}%
                                </div>
                                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-bg-primary">
                                    <div
                                        className={`h-full rounded-full transition-all ${overview.metrics.winRate >= 50 ? "bg-price-up" : "bg-price-down"}`}
                                        style={{ width: `${Math.min(overview.metrics.winRate, 100)}%` }}
                                    />
                                </div>
                                <div className="mt-1.5 text-xs text-text-secondary">
                                    {overview.metrics.wins}W / {overview.metrics.losses}L · {overview.metrics.totalTrades} total
                                </div>
                            </div>

                            {/* Supporting: PF + Expectancy */}
                            <div className="rounded-2xl border border-border-muted bg-bg-tertiary/45 p-4">
                                <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-text-muted">Profit Factor</div>
                                <div className="mt-1 text-2xl font-black tabular-nums tracking-tight text-text-primary">
                                    {overview.metrics.profitFactor.toFixed(2)}
                                </div>
                                <div className="mt-2 border-t border-border-muted pt-2">
                                    <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-text-muted">Expectancy</div>
                                    <div className={`mt-0.5 text-lg font-black tabular-nums ${overview.metrics.expectancy >= 0 ? "text-price-up" : "text-price-down"}`}>
                                        {formatSigned(overview.metrics.expectancy, "R")}
                                    </div>
                                </div>
                            </div>

                            {/* Supporting: Risk metrics */}
                            <div className="rounded-2xl border border-border-muted bg-bg-tertiary/45 p-4">
                                <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-text-muted">Max Drawdown</div>
                                <div className="mt-1 text-2xl font-black tabular-nums tracking-tight text-price-down">
                                    {overview.metrics.maxDrawdownPct.toFixed(1)}%
                                </div>
                                <div className="mt-2 border-t border-border-muted pt-2">
                                    <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-text-muted">Max Consec Loss</div>
                                    <div className="mt-0.5 text-lg font-black tabular-nums text-price-down">
                                        {overview.metrics.maxConsecutiveLoss}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Collapsible advanced filters */}
                    {showAdvancedFilters && (
                        <div className="mt-4 grid gap-3 rounded-2xl border border-border-muted bg-bg-tertiary/30 p-4 md:grid-cols-2 xl:grid-cols-5">
                            <label className="flex flex-col gap-1 text-xs text-text-muted">
                                Strategy
                                <select
                                    value={selectedStrategyId}
                                    onChange={(event) => {
                                        setIsLoading(true);
                                        setSelectedStrategyId(event.target.value);
                                    }}
                                    className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm font-medium text-text-primary outline-none focus:border-accent/50"
                                >
                                    <option value="ALL">All strategies</option>
                                    {strategies.map((strategy) => (
                                        <option key={strategy.id} value={strategy.id}>
                                            {strategy.code} / {strategy.name}
                                        </option>
                                    ))}
                                </select>
                            </label>

                            <label className="flex flex-col gap-1 text-xs text-text-muted">
                                Session
                                <select
                                    value={selectedSession}
                                    onChange={(event) => {
                                        setIsLoading(true);
                                        setSelectedSession(event.target.value as "ALL" | "ASIAN" | "LONDON" | "NY");
                                    }}
                                    className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm font-medium text-text-primary outline-none focus:border-accent/50"
                                >
                                    <option value="ALL">All sessions</option>
                                    <option value="ASIAN">ASIAN</option>
                                    <option value="LONDON">LONDON</option>
                                    <option value="NY">NY</option>
                                </select>
                            </label>

                            <label className="flex flex-col gap-1 text-xs text-text-muted">
                                From (UTC)
                                <input
                                    type="date"
                                    value={fromDate}
                                    max={toDate || undefined}
                                    onChange={(event) => {
                                        setIsLoading(true);
                                        setFromDate(event.target.value);
                                    }}
                                    className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm font-medium text-text-primary outline-none focus:border-accent/50"
                                />
                            </label>

                            <label className="flex flex-col gap-1 text-xs text-text-muted">
                                To (UTC)
                                <input
                                    type="date"
                                    value={toDate}
                                    min={fromDate || undefined}
                                    onChange={(event) => {
                                        setIsLoading(true);
                                        setToDate(event.target.value);
                                    }}
                                    className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm font-medium text-text-primary outline-none focus:border-accent/50"
                                />
                            </label>

                            <div className="flex flex-col gap-1 text-xs text-text-muted">
                                Side
                                <div className="flex rounded-xl border border-border-muted bg-bg-primary p-1">
                                    {sideFilters.map((item) => (
                                        <button
                                            key={item.value}
                                            onClick={() => {
                                                setIsLoading(true);
                                                setSide(item.value);
                                            }}
                                            className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${side === item.value ? "bg-accent text-bg-secondary" : "text-text-secondary hover:text-text-primary"}`}
                                        >
                                            {item.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Quick actions */}
                    {selectedRunId && (
                        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border-muted pt-4">
                            <span className="mr-1 text-[10px] font-bold uppercase tracking-[0.2em] text-text-muted">Quick actions</span>
                            <Link
                                href={`/reports?run=${selectedRunId}`}
                                className="inline-flex items-center gap-1.5 rounded-full border border-border-muted bg-bg-tertiary px-3 py-1.5 text-[11px] font-bold text-text-secondary transition-colors hover:border-accent/30 hover:text-accent"
                            >
                                <BarChart3 className="h-3 w-3" />
                                Reports
                                <ArrowRight className="h-2.5 w-2.5" />
                            </Link>
                            <Link
                                href={`/signals?tab=review&run=${selectedRunId}`}
                                className="inline-flex items-center gap-1.5 rounded-full border border-border-muted bg-bg-tertiary px-3 py-1.5 text-[11px] font-bold text-text-secondary transition-colors hover:border-accent/30 hover:text-accent"
                            >
                                <Target className="h-3 w-3" />
                                Signals Review
                                <ArrowRight className="h-2.5 w-2.5" />
                            </Link>
                            <Link
                                href="/reports?tab=leaderboard"
                                className="inline-flex items-center gap-1.5 rounded-full border border-border-muted bg-bg-tertiary px-3 py-1.5 text-[11px] font-bold text-text-secondary transition-colors hover:border-accent/30 hover:text-accent"
                            >
                                <Layers3 className="h-3 w-3" />
                                Leaderboard
                                <ArrowRight className="h-2.5 w-2.5" />
                            </Link>
                            <Link
                                href="/indicators"
                                className="inline-flex items-center gap-1.5 rounded-full border border-border-muted bg-bg-tertiary px-3 py-1.5 text-[11px] font-bold text-text-secondary transition-colors hover:border-accent/30 hover:text-accent"
                            >
                                <Activity className="h-3 w-3" />
                                Indicator Fleet
                                <ArrowRight className="h-2.5 w-2.5" />
                            </Link>
                        </div>
                    )}
                </section>

                {/* ═══════════════════════════════════════════
                    SECTION 2 — CHART (streamlined)
                    Annotation controls merged into compact header
                ═══════════════════════════════════════════ */}
                <section className="rounded-[28px] border border-border-muted bg-bg-primary/95 shadow-[0_28px_75px_rgba(0,0,0,0.3)]">
                    {/* Compact chart toolbar */}
                    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-2 text-xs text-text-muted">
                            <Tags className="h-3.5 w-3.5 text-accent" />
                            <span className="font-bold uppercase tracking-[0.2em]">Chart</span>
                            <span className="rounded-full bg-bg-tertiary px-2 py-0.5 text-[10px] tabular-nums">
                                {annotations.length} annotations
                            </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            {selectedSignalId !== "ALL" && (
                                <div className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-[11px] text-accent">
                                    <Target className="h-3 w-3" />
                                    Signal focused
                                    <button
                                        onClick={() => {
                                            setIsLoading(true);
                                            setSelectedSignalId("ALL");
                                        }}
                                        className="rounded-full p-0.5 hover:bg-accent/20"
                                    >
                                        <X className="h-2.5 w-2.5" />
                                    </button>
                                </div>
                            )}
                            <select
                                value={selectedExitRuleId}
                                onChange={(event) => setSelectedExitRuleId(event.target.value)}
                                className="min-w-[180px] rounded-lg border border-border-muted bg-bg-tertiary px-2.5 py-1.5 text-xs font-medium text-text-primary outline-none focus:border-accent/50"
                            >
                                {exitRuleOptions.map((row) => (
                                    <option key={row.exitRuleId} value={row.exitRuleId}>
                                        {row.exitRuleName}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="h-[58vh] min-h-[520px] overflow-hidden rounded-b-[24px] border-t border-border-muted bg-bg-primary">
                        <MultiPaneChart
                            annotations={annotations}
                            rangeStart={fromDate ? toUtcRangeStart(fromDate) : null}
                            rangeEnd={toDate ? toUtcRangeEnd(toDate) : null}
                            showSessionShading
                            focusedSignalId={selectedSignalId !== "ALL" ? selectedSignalId : null}
                        />
                    </div>
                </section>

                {/* ═══════════════════════════════════════════
                    SECTION 3 — BREAKDOWNS + EXIT COMPARISON
                ═══════════════════════════════════════════ */}
                {isLoading ? (
                    <div className="flex min-h-[220px] items-center justify-center rounded-3xl border border-border-muted bg-bg-primary/80">
                        <Loader2 className="h-8 w-8 animate-spin text-accent" />
                    </div>
                ) : overview ? (
                    <>
                        {/* Strategy + Session side by side */}
                        <section className="grid gap-4 xl:grid-cols-2">
                            {/* By Strategy */}
                            <div className="rounded-3xl border border-border-muted bg-bg-primary/90 p-4">
                                <div className="mb-4 flex items-center gap-2 text-sm font-bold text-text-primary">
                                    <Layers3 className="h-4 w-4 text-accent" />
                                    By Strategy
                                </div>
                                <div className="overflow-hidden rounded-2xl border border-border-muted">
                                    <table className="w-full text-left text-sm">
                                        <thead className="bg-bg-tertiary/80 text-xs uppercase tracking-[0.2em] text-text-muted">
                                            <tr>
                                                <th className="px-4 py-3">Strategy</th>
                                                <th className="px-4 py-3">Trades</th>
                                                <th className="px-4 py-3">Win Rate</th>
                                                <th className="px-4 py-3 text-right">Net R</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {byStrategy.map((row) => (
                                                <tr
                                                    key={row.strategyId}
                                                    className="cursor-pointer border-t border-border-muted/70 transition-colors hover:bg-bg-tertiary/30"
                                                    onClick={() => {
                                                        if (selectedStrategyId === row.strategyId) {
                                                            setIsLoading(true);
                                                            setSelectedStrategyId("ALL");
                                                        } else {
                                                            setIsLoading(true);
                                                            setSelectedStrategyId(row.strategyId);
                                                            setShowAdvancedFilters(true);
                                                        }
                                                    }}
                                                >
                                                    <td className="px-4 py-3">
                                                        <div className="font-bold text-text-primary">{row.strategyCode}</div>
                                                        <div className="text-xs text-text-muted">{row.strategyName}</div>
                                                    </td>
                                                    <td className="px-4 py-3 tabular-nums text-text-secondary">{row.trades}</td>
                                                    <td className="px-4 py-3">
                                                        <WinRateBar value={row.winRate} />
                                                    </td>
                                                    <td className={`px-4 py-3 text-right font-semibold tabular-nums ${row.netR >= 0 ? "text-price-up" : "text-price-down"}`}>
                                                        {formatSigned(row.netR, "R")}
                                                    </td>
                                                </tr>
                                            ))}
                                            {byStrategy.length === 0 && (
                                                <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-text-muted">No strategy data</td></tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* By Session */}
                            <div className="rounded-3xl border border-border-muted bg-bg-primary/90 p-4">
                                <div className="mb-4 flex items-center gap-2 text-sm font-bold text-text-primary">
                                    <BarChart3 className="h-4 w-4 text-accent" />
                                    By Session
                                </div>
                                <div className="overflow-hidden rounded-2xl border border-border-muted">
                                    <table className="w-full text-left text-sm">
                                        <thead className="bg-bg-tertiary/80 text-xs uppercase tracking-[0.2em] text-text-muted">
                                            <tr>
                                                <th className="px-4 py-3">Session</th>
                                                <th className="px-4 py-3">Trades</th>
                                                <th className="px-4 py-3">Win Rate</th>
                                                <th className="px-4 py-3 text-right">Net R</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {bySession.map((row) => (
                                                <tr
                                                    key={row.session}
                                                    className="cursor-pointer border-t border-border-muted/70 transition-colors hover:bg-bg-tertiary/30"
                                                    onClick={() => {
                                                        const session = row.session as "ASIAN" | "LONDON" | "NY";
                                                        if (selectedSession === session) {
                                                            setIsLoading(true);
                                                            setSelectedSession("ALL");
                                                        } else {
                                                            setIsLoading(true);
                                                            setSelectedSession(session);
                                                            setShowAdvancedFilters(true);
                                                        }
                                                    }}
                                                >
                                                    <td className="px-4 py-3 font-bold text-text-primary">{row.session}</td>
                                                    <td className="px-4 py-3 tabular-nums text-text-secondary">{row.trades}</td>
                                                    <td className="px-4 py-3">
                                                        <WinRateBar value={row.winRate} />
                                                    </td>
                                                    <td className={`px-4 py-3 text-right font-semibold tabular-nums ${row.netR >= 0 ? "text-price-up" : "text-price-down"}`}>
                                                        {formatSigned(row.netR, "R")}
                                                    </td>
                                                </tr>
                                            ))}
                                            {bySession.length === 0 && (
                                                <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-text-muted">No session data</td></tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </section>

                        {/* Exit Strategy Comparison */}
                        <section className="rounded-3xl border border-border-muted bg-bg-primary/90 p-4">
                            <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                                <div className="flex items-center gap-2 text-sm font-bold text-text-primary">
                                    <Filter className="h-4 w-4 text-accent" />
                                    Exit Strategy Comparison
                                    {bestExitRuleId && (
                                        <span className="ml-2 rounded-full bg-price-up/10 px-2 py-0.5 text-[10px] font-bold text-price-up">
                                            Best highlighted
                                        </span>
                                    )}
                                </div>
                                {(side !== "ALL" || overview.context) && (
                                    <div className="flex gap-2">
                                        {side !== "ALL" && (
                                            <span className="rounded-full border border-border-muted bg-bg-tertiary px-2.5 py-1 text-[11px] font-medium text-text-secondary">
                                                Side: {side}
                                            </span>
                                        )}
                                        {overview.context && (
                                            <span className="rounded-full border border-border-muted bg-bg-tertiary px-2.5 py-1 text-[11px] font-medium text-text-secondary">
                                                Equity ${overview.context.initialEquity.toLocaleString()} · Risk {overview.context.riskPercent}%
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>

                            <div className="overflow-x-auto rounded-2xl border border-border-muted">
                                <table className="min-w-full text-left text-sm">
                                    <thead className="bg-bg-tertiary/80 text-xs uppercase tracking-[0.18em] text-text-muted">
                                        <tr>
                                            <th className="px-4 py-3">Exit Strategy</th>
                                            <th className="px-4 py-3">Win Rate</th>
                                            <th className="px-4 py-3">W/L</th>
                                            <th className="px-4 py-3">Net R</th>
                                            <th className="px-4 py-3">Net USD</th>
                                            <th className="px-4 py-3">Max DD</th>
                                            <th className="px-4 py-3">PF</th>
                                            <th className="px-4 py-3">Expect</th>
                                            <th className="px-4 py-3">Avg W</th>
                                            <th className="px-4 py-3">Avg L</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {exitComparison.map((row) => {
                                            const isBest = row.exitRuleId === bestExitRuleId;
                                            return (
                                                <tr
                                                    key={row.exitRuleId}
                                                    className={`border-t transition-colors ${
                                                        isBest
                                                            ? "border-price-up/20 bg-price-up/5"
                                                            : "border-border-muted/70 hover:bg-bg-tertiary/20"
                                                    }`}
                                                >
                                                    <td className="px-4 py-3">
                                                        <div className="flex items-center gap-2">
                                                            {isBest && (
                                                                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-price-up/15 text-[10px] font-black text-price-up">
                                                                    1
                                                                </span>
                                                            )}
                                                            <div>
                                                                <div className="font-bold text-text-primary">{row.exitRuleName}</div>
                                                                <div className="text-xs text-text-muted">{row.exitRuleCode}</div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <WinRateBar value={row.winRate} />
                                                    </td>
                                                    <td className="px-4 py-3 tabular-nums text-text-secondary">
                                                        {row.wins}/{row.losses}{row.openTrades ? ` (${row.openTrades} open)` : ""}
                                                    </td>
                                                    <td className={`px-4 py-3 font-semibold tabular-nums ${row.netR >= 0 ? "text-price-up" : "text-price-down"}`}>
                                                        {formatSigned(row.netR, "R")}
                                                    </td>
                                                    <td className={`px-4 py-3 font-semibold tabular-nums ${row.netUsd >= 0 ? "text-price-up" : "text-price-down"}`}>
                                                        {formatSigned(row.netUsd, "$")}
                                                    </td>
                                                    <td className="px-4 py-3 tabular-nums text-price-down">{row.maxDrawdownPct.toFixed(1)}%</td>
                                                    <td className="px-4 py-3 tabular-nums text-text-primary">{row.profitFactor.toFixed(2)}</td>
                                                    <td className={`px-4 py-3 font-semibold tabular-nums ${row.expectancy >= 0 ? "text-price-up" : "text-price-down"}`}>
                                                        {formatSigned(row.expectancy, "R")}
                                                    </td>
                                                    <td className="px-4 py-3 tabular-nums text-price-up">{formatSigned(row.avgWinR, "R")}</td>
                                                    <td className="px-4 py-3 tabular-nums text-price-down">{formatSigned(row.avgLossR, "R")}</td>
                                                </tr>
                                            );
                                        })}
                                        {exitComparison.length === 0 && (
                                            <tr><td colSpan={10} className="px-4 py-6 text-center text-sm text-text-muted">No exit comparison data</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </section>
                    </>
                ) : null}
            </div>
        </div>
    );
}
