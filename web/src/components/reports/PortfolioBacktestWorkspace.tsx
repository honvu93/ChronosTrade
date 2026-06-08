"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
    ArrowDownRight,
    ArrowUpRight,
    ChevronDown,
    ChevronUp,
    Copy,
    Flame,
    Link2,
    Loader2,
    Shield,
    Snowflake,
    Target,
    TrendingUp,
    Trophy,
} from "lucide-react";
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    ReferenceLine,
} from "recharts";
import { BacktestTradeRow, BacktestTradeHistoryResponse } from "@/types/backtests";
import { EngineRun } from "@/types/engine";
import {
    aggregatePortfolioBacktest,
    PortfolioAggregation,
    PortfolioEquityPoint,
    PortfolioSymbolCard,
} from "@/lib/portfolioBacktestAggregation";

// ─── Fetch Helpers ───────────────────────────────────────────────────────────

const fetchJson = async <T,>(url: string): Promise<T> => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed: ${url}`);
    return res.json();
};

async function fetchAllTrades(apiUrl: string, runId: string): Promise<BacktestTradeRow[]> {
    const all: BacktestTradeRow[] = [];
    let page = 1;
    let hasMore = true;
    while (hasMore) {
        const envelope = await fetchJson<{ data: BacktestTradeHistoryResponse }>(
            `${apiUrl}/api/engine/trades?backtestRunId=${encodeURIComponent(runId)}&pageSize=2000&page=${page}&status=ALL`,
        );
        const res = envelope.data;
        all.push(...res.rows);
        hasMore = page < res.pagination.totalPages;
        page++;
    }
    return all;
}

// ─── Format Helpers ──────────────────────────────────────────────────────────

const formatSigned = (v: number, suffix = "") => `${v >= 0 ? "+" : ""}${v.toFixed(1)}${suffix}`;

const CATEGORY_COLORS: Record<string, string> = {
    METALS: "#f59e0b",
    CRYPTO: "#3b82f6",
    FOREX: "#10b981",
    ENERGY: "#ef4444",
};

type SymbolSortKey = "netR" | "winRate" | "profitFactor" | "totalTrades";

// ─── Health Grade ───────────────────────────────────────────────────────────

function getPortfolioGrade(agg: PortfolioAggregation): { label: string; color: string; bg: string } {
    const score =
        (agg.winRate >= 55 ? 2 : agg.winRate >= 50 ? 1 : 0) +
        (agg.profitFactor >= 1.5 ? 2 : agg.profitFactor >= 1.2 ? 1 : 0) +
        (agg.maxDrawdownPct <= 10 ? 2 : agg.maxDrawdownPct <= 20 ? 1 : 0) +
        (agg.expectancy >= 0.3 ? 2 : agg.expectancy >= 0.1 ? 1 : 0);

    if (score >= 7) return { label: "Excellent", color: "#22c55e", bg: "rgba(34,197,94,0.12)" };
    if (score >= 5) return { label: "Good", color: "#3b82f6", bg: "rgba(59,130,246,0.12)" };
    if (score >= 3) return { label: "Fair", color: "#f59e0b", bg: "rgba(245,158,11,0.12)" };
    return { label: "Needs Work", color: "#ef4444", bg: "rgba(239,68,68,0.12)" };
}

// ─── KPI Card ───────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color, icon }: {
    label: string;
    value: string;
    sub?: string;
    color?: string;
    icon?: React.ReactNode;
}) {
    return (
        <div className="rounded-2xl border border-border-muted bg-bg-primary/70 p-3 sm:p-4">
            <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-text-muted">{label}</span>
                {icon && <span className="hidden text-text-muted opacity-50 sm:block">{icon}</span>}
            </div>
            <div className={`mt-1 text-lg font-black sm:mt-1.5 sm:text-2xl ${color ?? "text-text-primary"}`}>{value}</div>
            {sub && <div className="mt-0.5 text-[10px] text-text-muted sm:text-[11px]">{sub}</div>}
        </div>
    );
}

// ─── Equity Curve (Recharts) ─────────────────────────────────────────────────

type CurveMode = "balance" | "r";

interface ChartDataPoint {
    index: number;
    value: number;
    date: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CurveTooltip({ active, payload, mode }: { active?: boolean; payload?: any; mode: CurveMode }) {
    if (!active || !payload?.[0]) return null;
    const p = payload[0].payload as ChartDataPoint;
    const v = p.value;
    const formatted = mode === "balance"
        ? `$${v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
        : `${v >= 0 ? "+" : ""}${v.toFixed(1)}R`;
    const color = mode === "r" ? (v >= 0 ? "#22c55e" : "#ef4444") : "#22c55e";

    return (
        <div className="rounded-lg border border-border-muted bg-bg-primary/95 px-3 py-2 shadow-xl backdrop-blur-sm">
            <div className="text-[10px] text-text-muted">{p.date}</div>
            <div className="mt-0.5 text-sm font-black" style={{ color }}>{formatted}</div>
            <div className="text-[10px] text-text-muted">Trade #{p.index}</div>
        </div>
    );
}

function EquityCurveChart({ data, mode }: { data: PortfolioEquityPoint[]; mode: CurveMode }) {
    const chartData = useMemo<ChartDataPoint[]>(() =>
        data.map((p, i) => ({
            index: i,
            value: p.value,
            date: new Date(p.time * 1000).toLocaleDateString("en-GB", {
                day: "2-digit", month: "short", year: "2-digit",
            }),
        })),
    [data]);

    const hasNegative = mode === "r" && chartData.some((d) => d.value < 0);
    const gradientId = mode === "balance" ? "gradBalance" : "gradR";

    const formatY = (v: number) => {
        if (mode !== "balance") return `${v.toFixed(0)}R`;
        const abs = Math.abs(v);
        if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
        if (abs >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
        return `$${v.toFixed(0)}`;
    };

    const tickInterval = Math.max(1, Math.floor(chartData.length / 8));
    const ticks = chartData
        .filter((_, i) => i % tickInterval === 0 || i === chartData.length - 1)
        .map((d) => d.index);

    if (chartData.length === 0) return null;

    return (
        <div className="h-[240px] w-full rounded-2xl border border-border-muted bg-bg-primary/60 pt-2 pr-2 sm:h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                    <defs>
                        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#22c55e" stopOpacity={0.35} />
                            <stop offset="100%" stopColor="#22c55e" stopOpacity={0.02} />
                        </linearGradient>
                        {hasNegative && (
                            <linearGradient id="gradRNeg" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#ef4444" stopOpacity={0.02} />
                                <stop offset="100%" stopColor="#ef4444" stopOpacity={0.3} />
                            </linearGradient>
                        )}
                    </defs>
                    <CartesianGrid
                        strokeDasharray="3 6"
                        stroke="rgba(255,255,255,0.04)"
                        vertical={false}
                    />
                    <XAxis
                        dataKey="index"
                        ticks={ticks}
                        tickFormatter={(idx: number) => chartData[idx]?.date ?? ""}
                        tick={{ fontSize: 10, fill: "#6b7280" }}
                        axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
                        tickLine={false}
                    />
                    <YAxis
                        tickFormatter={formatY}
                        tick={{ fontSize: 10, fill: "#6b7280" }}
                        axisLine={false}
                        tickLine={false}
                        width={52}
                    />
                    <Tooltip
                        content={(props) => <CurveTooltip {...props} mode={mode} />}
                        cursor={{ stroke: "rgba(255,255,255,0.15)", strokeDasharray: "4 4" }}
                    />
                    {hasNegative && (
                        <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 4" />
                    )}
                    <Area
                        type="monotone"
                        dataKey="value"
                        stroke="#22c55e"
                        strokeWidth={2}
                        fill={`url(#${gradientId})`}
                        dot={false}
                        activeDot={{ r: 3, fill: "#22c55e", stroke: "#0a0a0a", strokeWidth: 2 }}
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
}

// ─── Symbol Card ─────────────────────────────────────────────────────────────

function SymbolCard({ card, rank }: { card: PortfolioSymbolCard; rank?: number }) {
    const rColor = card.netR >= 0 ? "text-price-up" : "text-price-down";
    const wrColor = card.winRate >= 55 ? "text-price-up" : card.winRate >= 50 ? "text-text-primary" : "text-price-down";
    const catColor = CATEGORY_COLORS[card.category] ?? "#6b7280";
    const winPct = card.totalTrades > 0 ? (card.wins / card.totalTrades) * 100 : 0;

    return (
        <div className="rounded-2xl border border-border-muted bg-bg-primary/70 p-3 transition-colors hover:border-border-muted/80 sm:p-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    {rank !== undefined && (
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-bg-tertiary text-[10px] font-black text-text-muted">
                            {rank}
                        </span>
                    )}
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: card.color }} />
                    <span className="text-sm font-black text-text-primary">{card.symbol}</span>
                </div>
                <span
                    className="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.18em]"
                    style={{ backgroundColor: `${catColor}20`, color: catColor }}
                >
                    {card.category}
                </span>
            </div>

            {/* Total R */}
            <div className={`mt-3 text-2xl font-black ${rColor}`}>
                {formatSigned(card.netR)}<span className="text-sm opacity-70">R</span>
            </div>

            {/* Win/Loss bar */}
            <div className="mt-2">
                <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-bg-tertiary">
                    <div
                        className="rounded-full transition-all"
                        style={{ width: `${winPct}%`, backgroundColor: "#22c55e" }}
                    />
                </div>
                <div className="mt-1 flex justify-between text-[10px] text-text-muted">
                    <span>{card.wins}W / {card.losses}L</span>
                    <span>{card.totalTrades} trades</span>
                </div>
            </div>

            {/* Stats grid */}
            <div className="mt-3 grid grid-cols-2 gap-y-2 text-xs">
                <div>
                    <span className="text-text-muted">Win Rate</span>
                    <div className={`font-bold ${wrColor}`}>{card.winRate}%</div>
                </div>
                <div>
                    <span className="text-text-muted">Profit Factor</span>
                    <div className="font-bold text-text-primary">{card.profitFactor}</div>
                </div>
                <div>
                    <span className="text-text-muted">Avg R</span>
                    <div className={`font-bold ${card.avgR >= 0 ? "text-price-up" : "text-price-down"}`}>
                        {card.avgR >= 0 ? "+" : ""}{card.avgR}
                    </div>
                </div>
                <div>
                    <span className="text-text-muted">Signals</span>
                    <div className="font-bold text-text-primary">{card.signalCount}</div>
                </div>
            </div>
        </div>
    );
}

// ─── Session Bar ─────────────────────────────────────────────────────────────

function SessionBreakdown({ agg }: { agg: PortfolioAggregation }) {
    const maxAbsR = Math.max(...agg.sessions.map((s) => Math.abs(s.netR)), 1);

    return (
        <div className="space-y-3">
            {agg.sessions.map((s) => {
                const barPct = Math.min((Math.abs(s.netR) / maxAbsR) * 100, 100);
                const isPositive = s.netR >= 0;
                return (
                    <div key={s.session} className="flex items-center gap-2 sm:gap-3">
                        <div className="flex w-16 shrink-0 items-center gap-1.5 sm:w-20 sm:gap-2">
                            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                            <span className="text-[11px] font-bold text-text-primary sm:text-xs">{s.session}</span>
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="flex h-5 items-center overflow-hidden rounded-full bg-bg-tertiary/50">
                                <div
                                    className="h-full rounded-full transition-all"
                                    style={{
                                        width: `${Math.max(barPct, 4)}%`,
                                        backgroundColor: isPositive ? "#22c55e" : "#ef4444",
                                        opacity: 0.7,
                                    }}
                                />
                            </div>
                        </div>
                        <div className="flex w-20 shrink-0 items-center justify-end gap-1.5 text-[11px] sm:w-28 sm:gap-2 sm:text-xs">
                            <span className={`font-black ${isPositive ? "text-price-up" : "text-price-down"}`}>
                                {formatSigned(s.netR)}R
                            </span>
                            <span className="text-text-muted">{s.winRate}%</span>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// ─── Year Breakdown ──────────────────────────────────────────────────────────

function YearBreakdown({ agg }: { agg: PortfolioAggregation }) {
    const maxAbsR = Math.max(...agg.years.map((y) => Math.abs(y.netR)), 1);

    return (
        <div className="space-y-3">
            {agg.years.map((y) => {
                const barPct = Math.min((Math.abs(y.netR) / maxAbsR) * 100, 100);
                const isPositive = y.netR >= 0;
                return (
                    <div key={y.year} className="flex items-center gap-2 sm:gap-3">
                        <span className="w-10 shrink-0 text-[11px] font-bold text-text-primary sm:w-12 sm:text-xs">{y.year}</span>
                        <div className="min-w-0 flex-1">
                            <div className="flex h-5 items-center overflow-hidden rounded-full bg-bg-tertiary/50">
                                <div
                                    className="h-full rounded-full transition-all"
                                    style={{
                                        width: `${Math.max(barPct, 4)}%`,
                                        backgroundColor: isPositive ? "#22c55e" : "#ef4444",
                                        opacity: 0.7,
                                    }}
                                />
                            </div>
                        </div>
                        <span className={`w-14 shrink-0 text-right text-[11px] font-black sm:w-16 sm:text-xs ${isPositive ? "text-price-up" : "text-price-down"}`}>
                            {formatSigned(y.netR)}R
                        </span>
                    </div>
                );
            })}
        </div>
    );
}

// ─── Main Workspace ──────────────────────────────────────────────────────────

export default function PortfolioBacktestWorkspace() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
    const router = useRouter();
    const searchParams = useSearchParams();
    const [runs, setRuns] = useState<EngineRun[]>([]);
    const [selectedRunIds, setSelectedRunIds] = useState<string[]>([]);
    const [allTrades, setAllTrades] = useState<BacktestTradeRow[]>([]);
    const [curveMode, setCurveMode] = useState<CurveMode>("balance");
    const [isLoadingRuns, setIsLoadingRuns] = useState(true);
    const [isLoadingTrades, setIsLoadingTrades] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [runsExpanded, setRunsExpanded] = useState(false);
    const [symbolSort, setSymbolSort] = useState<SymbolSortKey>("netR");
    const [copiedLink, setCopiedLink] = useState(false);

    const urlRuns = searchParams.get("runs");

    // Load run catalog
    useEffect(() => {
        (async () => {
            try {
                const envelope = await fetchJson<{ data: EngineRun[] }>(`${apiUrl}/api/engine/runs`);
                const data = envelope.data;
                setRuns(data);
                const preSelected = urlRuns?.split(",").filter(Boolean) ?? [];
                if (preSelected.length > 0) {
                    setSelectedRunIds(preSelected);
                } else {
                    setSelectedRunIds(data.map((r) => r.id));
                }
            } catch {
                setError("Failed to load backtest runs.");
            } finally {
                setIsLoadingRuns(false);
            }
        })();
    }, [apiUrl, urlRuns]);

    // Load trades for selected runs
    useEffect(() => {
        if (selectedRunIds.length === 0) {
            setAllTrades([]);
            return;
        }

        let active = true;

        (async () => {
            setIsLoadingTrades(true);
            setError(null);
            const collected: BacktestTradeRow[] = [];
            const failedRuns: string[] = [];

            for (const id of selectedRunIds) {
                if (!active) return;
                try {
                    const trades = await fetchAllTrades(apiUrl, id);
                    collected.push(...trades);
                } catch {
                    failedRuns.push(id);
                }
            }

            if (!active) return;

            if (failedRuns.length > 0 && collected.length === 0) {
                setError(`Failed to load trade data for ${failedRuns.length} run(s).`);
            } else if (failedRuns.length > 0) {
                setError(`Loaded ${collected.length} trades. ${failedRuns.length} run(s) failed to load.`);
            }

            setAllTrades(collected);
            setIsLoadingTrades(false);
        })();

        return () => { active = false; };
    }, [apiUrl, selectedRunIds]);

    const portfolioConfig = useMemo(() => {
        const selectedRuns = runs.filter((r) => selectedRunIds.includes(r.id));
        if (selectedRuns.length === 0) return { initialEquity: 10000, riskPercent: 1 };
        return {
            initialEquity: selectedRuns[0].initialEquity || 10000,
            riskPercent: selectedRuns[0].riskPercent || 1,
        };
    }, [runs, selectedRunIds]);

    const aggregation = useMemo<PortfolioAggregation | null>(() => {
        if (allTrades.length === 0) return null;
        return aggregatePortfolioBacktest(allTrades, portfolioConfig.initialEquity, portfolioConfig.riskPercent);
    }, [allTrades, portfolioConfig]);

    const sortedSymbols = useMemo(() => {
        if (!aggregation) return [];
        return [...aggregation.symbols].sort((a, b) => {
            switch (symbolSort) {
                case "winRate": return b.winRate - a.winRate;
                case "profitFactor": return b.profitFactor - a.profitFactor;
                case "totalTrades": return b.totalTrades - a.totalTrades;
                default: return b.netR - a.netR;
            }
        });
    }, [aggregation, symbolSort]);

    const toggleRun = useCallback((id: string) => {
        setSelectedRunIds((prev) =>
            prev.includes(id)
                ? prev.filter((r) => r !== id)
                : [...prev, id],
        );
    }, []);

    const selectAll = useCallback(() => setSelectedRunIds(runs.map((r) => r.id)), [runs]);
    const selectNone = useCallback(() => setSelectedRunIds([]), []);

    const handleCopyLink = useCallback(async () => {
        try {
            const url = new URL(window.location.href);
            url.searchParams.set("runs", selectedRunIds.join(","));
            await navigator.clipboard.writeText(url.toString());
            setCopiedLink(true);
            setTimeout(() => setCopiedLink(false), 2000);
        } catch {
            // Clipboard API unavailable (HTTP context or permission denied)
        }
    }, [selectedRunIds]);

    if (isLoadingRuns) {
        return (
            <div className="command-deck-canvas flex h-full items-center justify-center p-6">
                <div className="flex items-center gap-2 text-sm text-text-secondary">
                    <Loader2 className="h-4 w-4 animate-spin text-accent" />
                    Loading backtest catalog...
                </div>
            </div>
        );
    }

    return (
        <div className="command-deck-canvas h-full space-y-4 overflow-y-auto p-3 sm:space-y-5 sm:p-4 lg:p-6">
            {/* ── Collapsible Run Selector ───────────────────────────────────── */}
            <section className="rounded-3xl border border-border-muted bg-bg-primary/90 p-3 sm:p-4">
                <button
                    type="button"
                    onClick={() => setRunsExpanded((v) => !v)}
                    className="flex w-full items-center justify-between"
                >
                    <div className="flex items-center gap-3">
                        <span className="text-xs font-black uppercase tracking-[0.16em] text-text-muted">
                            Backtest Runs
                        </span>
                        <span className="rounded-full bg-accent/15 px-2.5 py-0.5 text-[11px] font-black text-accent">
                            {selectedRunIds.length}/{runs.length}
                        </span>
                    </div>
                    {runsExpanded
                        ? <ChevronUp className="h-4 w-4 text-text-muted" />
                        : <ChevronDown className="h-4 w-4 text-text-muted" />
                    }
                </button>

                {runsExpanded && (
                    <div className="mt-3">
                        <div className="mb-2 flex gap-2">
                            <button type="button" onClick={selectAll}
                                className="rounded-full border border-border-muted bg-bg-tertiary px-3 py-1 text-[11px] font-bold text-text-primary hover:text-accent">
                                All
                            </button>
                            <button type="button" onClick={selectNone}
                                className="rounded-full border border-border-muted bg-bg-tertiary px-3 py-1 text-[11px] font-bold text-text-primary hover:text-accent">
                                None
                            </button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {runs.map((run) => {
                                const active = selectedRunIds.includes(run.id);
                                return (
                                    <button
                                        key={run.id}
                                        type="button"
                                        onClick={() => toggleRun(run.id)}
                                        className={`rounded-full border px-3 py-1 text-[11px] font-bold transition-colors ${
                                            active
                                                ? "border-accent/40 bg-accent/15 text-accent"
                                                : "border-border-muted bg-bg-tertiary text-text-muted hover:text-text-primary"
                                        }`}
                                    >
                                        {run.name}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}
            </section>

            {isLoadingTrades && (
                <div className="flex items-center gap-2 text-sm text-text-secondary">
                    <Loader2 className="h-4 w-4 animate-spin text-accent" />
                    Loading {selectedRunIds.length} backtest run(s)...
                </div>
            )}

            {error && (
                <div className="rounded-2xl border border-price-down/20 bg-price-down/8 px-4 py-3 text-sm text-price-down">
                    {error}
                </div>
            )}

            {aggregation && (
                <>
                    {/* ── Hero: ROI + Total R + Grade ──────────────────────────── */}
                    <section className="rounded-3xl border border-border-muted bg-bg-primary/90 p-4 sm:p-5">
                        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-4">
                            <div className="min-w-0">
                                <div className="flex items-center gap-3">
                                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-text-muted">
                                        Portfolio Performance
                                    </span>
                                    {(() => {
                                        const grade = getPortfolioGrade(aggregation);
                                        return (
                                            <span
                                                className="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.14em]"
                                                style={{ backgroundColor: grade.bg, color: grade.color }}
                                            >
                                                {grade.label}
                                            </span>
                                        );
                                    })()}
                                </div>

                                <div className="mt-2 flex items-baseline gap-2 sm:gap-4">
                                    <span className={`text-3xl font-black tracking-tight sm:text-5xl ${aggregation.roiPct >= 0 ? "text-price-up" : "text-price-down"}`}>
                                        {aggregation.roiPct >= 0 ? "+" : ""}{aggregation.roiPct}%
                                    </span>
                                    <span className={`text-lg font-black sm:text-2xl ${aggregation.totalR >= 0 ? "text-price-up" : "text-price-down"}`}>
                                        {aggregation.totalR >= 0 ? "+" : ""}{aggregation.totalR}R
                                    </span>
                                </div>

                                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-text-secondary sm:text-sm">
                                    <span>${aggregation.initialEquity.toLocaleString()}</span>
                                    <ArrowUpRight className="h-3.5 w-3.5 text-text-muted" />
                                    <span className={`font-bold ${aggregation.finalBalance >= aggregation.initialEquity ? "text-price-up" : "text-price-down"}`}>
                                        ${aggregation.finalBalance.toLocaleString()}
                                    </span>
                                    <span className="text-text-muted">across {aggregation.totalTrades} trades</span>
                                </div>
                            </div>

                            {/* Quick Actions */}
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={handleCopyLink}
                                    className="flex items-center gap-1.5 rounded-full border border-border-muted bg-bg-tertiary px-3 py-1.5 text-[11px] font-bold text-text-primary transition-colors hover:text-accent"
                                    title="Copy portfolio link"
                                >
                                    {copiedLink ? <Copy className="h-3.5 w-3.5 text-price-up" /> : <Link2 className="h-3.5 w-3.5" />}
                                    {copiedLink ? "Copied" : "Share"}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => router.push("/reports")}
                                    className="flex items-center gap-1.5 rounded-full border border-border-muted bg-bg-tertiary px-3 py-1.5 text-[11px] font-bold text-text-primary transition-colors hover:text-accent"
                                    title="Go to Leaderboard"
                                >
                                    <Trophy className="h-3.5 w-3.5" />
                                    Leaderboard
                                </button>
                            </div>
                        </div>
                    </section>

                    {/* ── KPI Scorecard Grid ───────────────────────────────────── */}
                    <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
                        <KpiCard
                            label="Win Rate"
                            value={`${aggregation.winRate}%`}
                            sub={`${aggregation.totalTrades - Math.round(aggregation.totalTrades * aggregation.winRate / 100)}L`}
                            color={aggregation.winRate >= 55 ? "text-price-up" : aggregation.winRate >= 50 ? "text-text-primary" : "text-price-down"}
                            icon={<Target className="h-4 w-4" />}
                        />
                        <KpiCard
                            label="Profit Factor"
                            value={aggregation.profitFactor >= 999 ? "999+" : String(aggregation.profitFactor)}
                            sub={aggregation.profitFactor >= 1.5 ? "Strong" : aggregation.profitFactor >= 1.0 ? "Marginal" : "Negative"}
                            color={aggregation.profitFactor >= 1.5 ? "text-price-up" : aggregation.profitFactor >= 1.0 ? "text-text-primary" : "text-price-down"}
                            icon={<TrendingUp className="h-4 w-4" />}
                        />
                        <KpiCard
                            label="Max Drawdown"
                            value={`${aggregation.maxDrawdownPct}%`}
                            sub={`${aggregation.maxDrawdownR}R`}
                            color={aggregation.maxDrawdownPct <= 10 ? "text-price-up" : aggregation.maxDrawdownPct <= 20 ? "text-text-primary" : "text-price-down"}
                            icon={<Shield className="h-4 w-4" />}
                        />
                        <KpiCard
                            label="Expectancy"
                            value={`${aggregation.expectancy >= 0 ? "+" : ""}${aggregation.expectancy}R`}
                            sub="per trade"
                            color={aggregation.expectancy >= 0.2 ? "text-price-up" : aggregation.expectancy >= 0 ? "text-text-primary" : "text-price-down"}
                            icon={<Flame className="h-4 w-4" />}
                        />
                        <KpiCard
                            label="Avg Win"
                            value={`+${aggregation.avgWinR}R`}
                            sub={`Loss: -${aggregation.avgLossR}R`}
                            color="text-price-up"
                            icon={<ArrowUpRight className="h-4 w-4" />}
                        />
                        <KpiCard
                            label="Streaks"
                            value={`${aggregation.maxWinStreak}W`}
                            sub={`Max loss: ${aggregation.maxLossStreak}`}
                            color="text-text-primary"
                            icon={<Snowflake className="h-4 w-4" />}
                        />
                    </div>

                    {/* ── Equity Curve ──────────────────────────────────────────── */}
                    <section className="rounded-3xl border border-border-muted bg-bg-primary/90 p-4 sm:p-5">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-text-muted">
                                <TrendingUp className="h-4 w-4" />
                                {curveMode === "balance" ? "Balance Curve" : "Equity Curve (R)"}
                            </div>
                            <div className="flex gap-1 rounded-full border border-border-muted bg-bg-tertiary/50 p-0.5">
                                <button
                                    type="button"
                                    onClick={() => setCurveMode("balance")}
                                    className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] transition-colors sm:px-3 sm:text-[11px] ${
                                        curveMode === "balance" ? "bg-accent/15 text-accent" : "text-text-muted hover:text-text-primary"
                                    }`}
                                >
                                    PnL ($)
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setCurveMode("r")}
                                    className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] transition-colors sm:px-3 sm:text-[11px] ${
                                        curveMode === "r" ? "bg-accent/15 text-accent" : "text-text-muted hover:text-text-primary"
                                    }`}
                                >
                                    R-Multiple
                                </button>
                            </div>
                        </div>
                        <EquityCurveChart
                            data={curveMode === "balance" ? aggregation.equityCurve : aggregation.equityCurveR}
                            mode={curveMode}
                        />
                    </section>

                    {/* ── Session + Year Breakdown (side by side) ──────────────── */}
                    <div className="grid gap-3 sm:gap-4 lg:grid-cols-2">
                        <section className="rounded-3xl border border-border-muted bg-bg-primary/90 p-4 sm:p-5">
                            <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-text-muted sm:mb-4">
                                Performance by Session
                            </div>
                            <SessionBreakdown agg={aggregation} />
                        </section>
                        <section className="rounded-3xl border border-border-muted bg-bg-primary/90 p-4 sm:p-5">
                            <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-text-muted sm:mb-4">
                                Performance by Year
                            </div>
                            <YearBreakdown agg={aggregation} />
                        </section>
                    </div>

                    {/* ── Top & Bottom Performers ──────────────────────────────── */}
                    {aggregation.symbols.length >= 6 && (
                        <div className="grid gap-3 sm:gap-4 lg:grid-cols-2">
                            <section className="rounded-3xl border border-border-muted bg-bg-primary/90 p-4 sm:p-5">
                                <div className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-price-up">
                                    <ArrowUpRight className="h-4 w-4" />
                                    Top Performers
                                </div>
                                <div className="space-y-2">
                                    {aggregation.symbols.slice(0, 3).map((s, i) => (
                                        <div key={s.symbol} className="flex items-center justify-between gap-2 rounded-xl border border-border-muted bg-bg-tertiary/30 px-2.5 py-2 sm:px-3">
                                            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
                                                <span className="text-[10px] font-black text-text-muted">#{i + 1}</span>
                                                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                                                <span className="text-[11px] font-bold text-text-primary sm:text-xs">{s.symbol}</span>
                                            </div>
                                            <div className="flex items-center gap-2 text-[11px] sm:gap-3 sm:text-xs">
                                                <span className={`font-black ${s.netR >= 0 ? "text-price-up" : "text-price-down"}`}>{formatSigned(s.netR)}R</span>
                                                <span className="text-text-muted">{s.winRate}%</span>
                                                <span className="hidden text-text-muted min-[480px]:inline">PF {s.profitFactor}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                            <section className="rounded-3xl border border-border-muted bg-bg-primary/90 p-4 sm:p-5">
                                <div className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-price-down">
                                    <ArrowDownRight className="h-4 w-4" />
                                    Bottom Performers
                                </div>
                                <div className="space-y-2">
                                    {[...aggregation.symbols].reverse().slice(0, 3).map((s, i) => (
                                        <div key={s.symbol} className="flex items-center justify-between gap-2 rounded-xl border border-border-muted bg-bg-tertiary/30 px-2.5 py-2 sm:px-3">
                                            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
                                                <span className="text-[10px] font-black text-text-muted">#{aggregation.symbols.length - i}</span>
                                                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                                                <span className="text-[11px] font-bold text-text-primary sm:text-xs">{s.symbol}</span>
                                            </div>
                                            <div className="flex items-center gap-2 text-[11px] sm:gap-3 sm:text-xs">
                                                <span className={`font-black ${s.netR >= 0 ? "text-price-up" : "text-price-down"}`}>
                                                    {formatSigned(s.netR)}R
                                                </span>
                                                <span className="text-text-muted">{s.winRate}%</span>
                                                <span className="hidden text-text-muted min-[480px]:inline">PF {s.profitFactor}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        </div>
                    )}

                    {/* ── Symbol Cards with Sort ───────────────────────────────── */}
                    <section>
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-text-muted">
                                All Symbols ({aggregation.symbols.length})
                            </div>
                            <div className="flex gap-1 rounded-full border border-border-muted bg-bg-tertiary/50 p-0.5">
                                {([
                                    ["netR", "R"],
                                    ["winRate", "WR%"],
                                    ["profitFactor", "PF"],
                                    ["totalTrades", "Trades"],
                                ] as const).map(([key, label]) => (
                                    <button
                                        key={key}
                                        type="button"
                                        onClick={() => setSymbolSort(key)}
                                        className={`rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] transition-colors sm:px-2.5 ${
                                            symbolSort === key ? "bg-accent/15 text-accent" : "text-text-muted hover:text-text-primary"
                                        }`}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                            {sortedSymbols.map((card, i) => (
                                <SymbolCard key={card.symbol} card={card} rank={i + 1} />
                            ))}
                        </div>
                    </section>
                </>
            )}

            {!isLoadingTrades && !aggregation && selectedRunIds.length > 0 && (
                <div className="rounded-2xl border border-border-muted bg-bg-tertiary/30 px-4 py-3 text-sm text-text-secondary">
                    No closed trades found in the selected runs.
                </div>
            )}
        </div>
    );
}
