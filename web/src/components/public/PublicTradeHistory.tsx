"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, LogIn } from "lucide-react";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Types — Backtest Performance (from /api/public/reports)
// ---------------------------------------------------------------------------

interface OverviewMetrics {
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

interface YearlyR { year: number; netR: number; trades: number }
interface SessionR { session: string; netR: number; winRate: number; trades: number }
interface MonthlyR { year: number; month: number; netR: number }
interface InstrumentR { symbol: string; netR: number; winRate: number; trades: number }
interface EquityPoint { time: string; cumulativeR: number }

interface Analytics {
    yearlyR: YearlyR[];
    sessionR: SessionR[];
    monthlyR: MonthlyR[];
    instrumentR: InstrumentR[];
    equityCurve: EquityPoint[];
}

interface BacktestTradeRow {
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

interface BacktestTradeSummary {
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

interface Pagination { page: number; pageSize: number; totalRows: number; totalPages: number }

interface ReportsData {
    overview: OverviewMetrics | null;
    analytics: Analytics | null;
    trades: { summary: BacktestTradeSummary | null; rows: BacktestTradeRow[]; pagination: Pagination };
    evaluatedAt: string;
}

// ---------------------------------------------------------------------------
// Types — Recent Signals (from /api/public/trade-history)
// ---------------------------------------------------------------------------

interface LiveTradeRecord {
    entryTime: string;
    exitTime: string | null;
    symbol: string;
    side: string;
    entryPrice: number;
    stopLoss: number;
    exitPrice: number | null;
    rMultiple: number;
    pnlUsd: number;
    result: string;
}

interface LiveTradeSummary {
    totalRecords: number;
    wins: number;
    losses: number;
    breakEven: number;
    activeTrades: number;
}

interface LiveTradeSnapshot {
    summary: LiveTradeSummary;
    records: LiveTradeRecord[];
    evaluatedAt: string;
}

type StatusFilter = "ALL" | "ACTIVE" | "CLOSED";
type SideFilter = "ALL" | "LONG" | "SHORT";
type OutcomeFilter = "ALL" | "WIN" | "LOSS" | "BE";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPORTS_ENDPOINT = "/api/public/reports";
const TRADE_HISTORY_ENDPOINT = "/api/public/trade-history";
const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const PAGE_SIZE = 50;

const SESSION_COLORS: Record<string, string> = {
    ASIAN: "#00b8d9",
    NY: "#f0b90b",
    LONDON: "#a855f7",
};

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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

function formatPrice(value: number | null) {
    if (value === null) return "-";
    return value.toFixed(2);
}

function formatSignedPct(value: number | null) {
    if (value === null) return "-";
    return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatSignedR(value: number | null) {
    if (value === null) return "-";
    return `${value >= 0 ? "+" : ""}${value.toFixed(2)}R`;
}

function formatDuration(ms: number | null) {
    if (ms === null || ms <= 0) return "-";
    const totalMinutes = Math.floor(ms / 60_000);
    const totalHours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (totalHours >= 24) {
        const days = Math.floor(totalHours / 24);
        const hours = totalHours % 24;
        return `${days}d ${hours}h`;
    }
    if (totalHours > 0) return `${totalHours}h ${minutes}m`;
    return `${minutes}m`;
}

function computeDurationFromTimes(entryTime: string, exitTime: string | null) {
    if (!exitTime) return "-";
    const ms = new Date(exitTime).getTime() - new Date(entryTime).getTime();
    return formatDuration(ms > 0 ? ms : null);
}

function computePnlPct(record: LiveTradeRecord) {
    if (record.exitPrice === null || record.entryPrice === 0) return null;
    const diff = record.side === "LONG"
        ? record.exitPrice - record.entryPrice
        : record.entryPrice - record.exitPrice;
    return (diff / record.entryPrice) * 100;
}

function pnlColor(r: number) {
    if (r > 0) return "text-price-up";
    if (r < 0) return "text-price-down";
    return "text-text-muted";
}

function rCellColor(netR: number): string {
    if (netR >= 15) return "bg-[#22c55e] text-white";
    if (netR >= 8) return "bg-[#22c55e]/70 text-white";
    if (netR >= 3) return "bg-[#22c55e]/40 text-white";
    if (netR > 0) return "bg-[#22c55e]/20 text-[#22c55e]";
    if (netR === 0) return "bg-transparent text-text-muted";
    if (netR >= -3) return "bg-[#ef4444]/20 text-[#ef4444]";
    if (netR >= -8) return "bg-[#ef4444]/40 text-white";
    return "bg-[#ef4444]/70 text-white";
}

function formatCompact(value: number) {
    if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
    return `$${value.toFixed(0)}`;
}

function simulateCompounding(equityCurve: EquityPoint[], riskPct: number, startCapital = 10_000) {
    let capital = startCapital;
    const points: number[] = [capital];
    // We need the R increments, not cumulative
    for (let i = 0; i < equityCurve.length; i++) {
        const r = i === 0 ? equityCurve[i].cumulativeR : equityCurve[i].cumulativeR - equityCurve[i - 1].cumulativeR;
        capital += capital * (riskPct / 100) * r;
        if (capital < 0) capital = 0;
        points.push(capital);
    }
    return { final: capital, points };
}

// ---------------------------------------------------------------------------
// Shared UI components
// ---------------------------------------------------------------------------

function SideBadge({ side }: { side: string }) {
    const isLong = side === "LONG";
    return (
        <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded border ${isLong ? "bg-price-up/10 text-price-up border-price-up/20" : "bg-price-down/10 text-price-down border-price-down/20"}`}>
            {side}
        </span>
    );
}

function ResultBadge({ result }: { result: string }) {
    const styles: Record<string, string> = {
        WIN: "border-price-up/20 bg-price-up/10 text-price-up",
        LOSS: "border-price-down/20 bg-price-down/10 text-price-down",
        BE: "border-border-muted bg-bg-tertiary text-text-muted",
        ACTIVE: "border-accent/20 bg-accent/10 text-accent",
    };
    return (
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded border ${styles[result] ?? styles.BE}`}>
            {result === "ACTIVE" ? <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent animate-pulse" /> : null}
            {result}
        </span>
    );
}

function FilterGroup<T extends string>({ options, value, onChange, activeColor }: { options: T[]; value: T; onChange: (v: T) => void; activeColor: string }) {
    return (
        <div className="flex gap-0.5 rounded-md bg-bg-secondary p-0.5">
            {options.map((opt) => (
                <button key={opt} type="button" onClick={() => onChange(opt)}
                    className={`px-2 py-1 rounded text-[10px] sm:text-xs font-medium transition-colors ${value === opt ? "text-white" : "text-text-muted hover:text-text-primary"}`}
                    style={value === opt ? { backgroundColor: activeColor } : undefined}
                >{opt}</button>
            ))}
        </div>
    );
}

// ===========================================================================
// EQUITY CURVE (canvas line chart)
// ===========================================================================

function EquityCurveChart({ data }: { data: EquityPoint[] }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || data.length < 2) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);

        const w = rect.width;
        const h = rect.height;
        const values = data.map((d) => d.cumulativeR);
        const min = Math.min(...values, 0);
        const max = Math.max(...values);
        const range = max - min || 1;
        const pad = 4;

        ctx.clearRect(0, 0, w, h);

        // Fill area
        ctx.beginPath();
        ctx.moveTo(pad, h - pad);
        for (let i = 0; i < values.length; i++) {
            const x = pad + (i / (values.length - 1)) * (w - 2 * pad);
            const y = h - pad - ((values[i] - min) / range) * (h - 2 * pad);
            ctx.lineTo(x, y);
        }
        ctx.lineTo(w - pad, h - pad);
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, "rgba(34, 197, 94, 0.25)");
        grad.addColorStop(1, "rgba(34, 197, 94, 0)");
        ctx.fillStyle = grad;
        ctx.fill();

        // Line
        ctx.beginPath();
        for (let i = 0; i < values.length; i++) {
            const x = pad + (i / (values.length - 1)) * (w - 2 * pad);
            const y = h - pad - ((values[i] - min) / range) * (h - 2 * pad);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = "#22c55e";
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }, [data]);

    if (data.length < 2) return null;

    return (
        <div className="rounded-xl border border-border-muted bg-bg-card overflow-hidden">
            <div className="flex items-center justify-between px-4 pt-3 pb-1">
                <span className="text-[10px] uppercase tracking-[0.15em] text-text-muted">Equity Curve</span>
            </div>
            <div className="px-3 pb-3" style={{ height: 200 }}>
                <canvas ref={canvasRef} className="w-full h-full" />
            </div>
        </div>
    );
}

// ===========================================================================
// RISK SIMULATION CARDS
// ===========================================================================

function RiskSimulationCards({ equityCurve }: { equityCurve: EquityPoint[] }) {
    if (equityCurve.length < 2) return null;

    const sim1 = simulateCompounding(equityCurve, 1);
    const sim2 = simulateCompounding(equityCurve, 2);

    return (
        <div className="grid grid-cols-2 gap-2.5">
            <RiskCard label="1% RISK" riskPct={1} finalCapital={sim1.final} points={sim1.points} color="#2962ff" />
            <RiskCard label="2% RISK" riskPct={2} finalCapital={sim2.final} points={sim2.points} color="#a855f7" />
        </div>
    );
}

function RiskCard({ label, finalCapital, points, color }: { label: string; riskPct: number; finalCapital: number; points: number[]; color: string }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || points.length < 2) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);

        const w = rect.width;
        const h = rect.height;
        const min = Math.min(...points);
        const max = Math.max(...points);
        const range = max - min || 1;

        ctx.clearRect(0, 0, w, h);
        ctx.beginPath();
        for (let i = 0; i < points.length; i++) {
            const x = (i / (points.length - 1)) * w;
            const y = h - ((points[i] - min) / range) * h;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }, [points, color]);

    // Milestones
    const milestones = [10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 5_000_000, 10_000_000, 50_000_000, 100_000_000];
    const reached = milestones.filter((m) => finalCapital >= m);
    const displayMilestones = reached.slice(-6); // last 6

    return (
        <div className="rounded-xl border border-border-muted bg-bg-card p-3.5 relative overflow-hidden">
            <div className="absolute top-0 left-3 right-3 h-[2px] rounded-b opacity-60" style={{ backgroundColor: color }} />
            <p className="text-[9px] uppercase tracking-[0.15em] text-text-muted mb-0.5">{label}</p>
            <p className="text-[10px] text-text-muted/70 mb-1">$10K start</p>
            <p className="text-lg sm:text-xl font-bold tabular-nums text-text-primary mb-2">{formatCompact(finalCapital)}</p>
            <div style={{ height: 40 }}>
                <canvas ref={canvasRef} className="w-full h-full" />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5">
                {displayMilestones.map((m) => (
                    <span key={m} className="text-[9px] tabular-nums text-text-muted">{formatCompact(m)}</span>
                ))}
            </div>
        </div>
    );
}

// ===========================================================================
// MONTHLY PERFORMANCE HEATMAP
// ===========================================================================

function MonthlyHeatmap({ data }: { data: MonthlyR[] }) {
    if (data.length === 0) return null;

    const years = [...new Set(data.map((d) => d.year))].sort();
    const lookup = new Map(data.map((d) => [`${d.year}-${d.month}`, d.netR]));

    // Year totals
    const yearTotals = new Map<number, number>();
    for (const d of data) {
        yearTotals.set(d.year, (yearTotals.get(d.year) ?? 0) + d.netR);
    }

    return (
        <div className="space-y-2">
            <p className="text-[10px] uppercase tracking-[0.15em] text-text-muted px-1">Monthly Performance (RR)</p>
            <div className="overflow-x-auto">
                <table className="w-full text-[10px] tabular-nums">
                    <thead>
                        <tr>
                            <th className="px-1 py-1 text-left text-text-muted font-medium" />
                            {MONTH_LABELS.map((m) => (
                                <th key={m} className="px-1 py-1 text-center text-text-muted font-medium">{m}</th>
                            ))}
                            <th className="px-1 py-1 text-center text-text-muted font-medium">Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        {years.map((year) => (
                            <tr key={year}>
                                <td className="px-1 py-0.5 text-text-muted font-medium">{String(year).slice(2)}</td>
                                {Array.from({ length: 12 }, (_, i) => {
                                    const r = lookup.get(`${year}-${i + 1}`);
                                    if (r === undefined) {
                                        return <td key={i} className="px-0.5 py-0.5"><div className="w-full h-6 rounded-sm" /></td>;
                                    }
                                    return (
                                        <td key={i} className="px-0.5 py-0.5">
                                            <div className={`w-full h-6 rounded-sm flex items-center justify-center font-semibold ${rCellColor(r)}`}>
                                                {r > 0 ? "+" : ""}{r.toFixed(0)}
                                            </div>
                                        </td>
                                    );
                                })}
                                <td className="px-0.5 py-0.5">
                                    <div className={`w-full h-6 rounded-sm flex items-center justify-center font-bold ${rCellColor(yearTotals.get(year) ?? 0)}`}>
                                        {(yearTotals.get(year) ?? 0) > 0 ? "+" : ""}{(yearTotals.get(year) ?? 0).toFixed(0)}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ===========================================================================
// PER-INSTRUMENT CARDS
// ===========================================================================

function InstrumentCards({ data }: { data: InstrumentR[] }) {
    if (data.length === 0) return null;

    return (
        <div className="flex flex-wrap gap-2.5">
            {data.map((inst) => (
                <div key={inst.symbol} className="rounded-xl border border-border-muted bg-bg-card p-3 min-w-[140px] flex-1 max-w-[200px]">
                    <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-[10px] font-bold uppercase text-text-primary">{inst.symbol.replace(/USD.*|c$/i, "")}</span>
                        <span className="text-[9px] text-text-muted">{inst.symbol}</span>
                    </div>
                    <p className={`text-base font-bold tabular-nums ${inst.netR >= 0 ? "text-price-up" : "text-price-down"}`}>
                        {inst.netR >= 0 ? "+" : ""}{inst.netR.toFixed(1)}R
                    </p>
                    <div className="flex items-center gap-3 mt-1 text-[9px] text-text-muted tabular-nums">
                        <span>{inst.trades} trades</span>
                        <span>{inst.winRate}% WR</span>
                    </div>
                </div>
            ))}
        </div>
    );
}

// ===========================================================================
// TRADE GRID (shared by backtest + live sections)
// ===========================================================================

function TradeGrid({ children }: { children: React.ReactNode }) {
    return (
        <div className="rounded-lg border border-border-muted bg-bg-card overflow-hidden">
            <div className="hidden lg:grid lg:grid-cols-11 gap-2 px-4 py-1.5 bg-bg-secondary text-text-muted text-[10px] font-semibold uppercase tracking-wider border-b border-border-muted">
                <div className="col-span-2">Time</div>
                <div>Ticker</div>
                <div>Side</div>
                <div>Entry</div>
                <div>SL</div>
                <div>Close</div>
                <div>PnL %</div>
                <div>PnL R</div>
                <div>Duration</div>
                <div>Result</div>
            </div>
            <div className="max-h-[600px] overflow-y-auto">{children}</div>
        </div>
    );
}

function TradeRowDesktop({ time, symbol, side, entry, sl, close, pnlPct, pnlR, duration, result, color }: {
    time: string; symbol: string; side: string; entry: string; sl: string; close: string;
    pnlPct: string; pnlR: string; duration: string; result: string; color: string;
}) {
    return (
        <div className="hidden lg:grid lg:grid-cols-11 gap-2 items-center">
            <div className="col-span-2 text-xs text-text-muted font-mono truncate">{time}</div>
            <div className="font-mono font-semibold text-xs text-text-primary truncate" title={symbol}>{symbol}</div>
            <div><SideBadge side={side} /></div>
            <div className="font-mono text-xs text-text-primary truncate">{entry}</div>
            <div className="font-mono text-xs text-text-muted/60 truncate">{sl}</div>
            <div className="font-mono text-xs text-text-primary truncate">{close}</div>
            <div className={`text-xs font-mono font-medium truncate ${color}`}>{pnlPct}</div>
            <div className={`font-bold font-mono text-xs truncate ${color}`}>{pnlR}</div>
            <div className="text-xs text-text-muted font-mono truncate">{duration}</div>
            <div><ResultBadge result={result} /></div>
        </div>
    );
}

function TradeRowMobile({ time, symbol, side, entry, close, pnlPct, pnlR, duration, result, color }: {
    time: string; symbol: string; side: string; entry: string; close: string;
    pnlPct: string; pnlR: string; duration: string; result: string; color: string;
}) {
    return (
        <div className="lg:hidden space-y-1.5">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                    <span className="font-mono font-bold text-sm text-text-primary">{symbol}</span>
                    <SideBadge side={side} />
                </div>
                <ResultBadge result={result} />
            </div>
            <div className="flex items-center justify-between text-xs">
                <span className="text-text-muted">{time}</span>
                <div className="flex items-center gap-2 font-mono">
                    <span className="text-text-primary">{entry}</span>
                    <span className="text-text-muted">&rarr;</span>
                    <span className="text-text-primary">{close}</span>
                </div>
            </div>
            <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-3">
                    <span className={`font-bold font-mono ${color}`}>{pnlPct}</span>
                    <span className={`font-bold font-mono ${color}`}>{pnlR}</span>
                </div>
                <span className="text-text-muted font-mono">{duration}</span>
            </div>
        </div>
    );
}

// ===========================================================================
// SECTION 1 — BACKTEST PERFORMANCE
// ===========================================================================

function BacktestPerformanceSection({ data, loading }: { data: ReportsData | null; loading: boolean }) {
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
    const [sideFilter, setSideFilter] = useState<SideFilter>("ALL");
    const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>("ALL");
    const [tickerFilter, setTickerFilter] = useState("");

    const overview = data?.overview;
    const analytics = data?.analytics;

    const filteredRows = useMemo(() => {
        if (!data) return [];
        let rows = data.trades.rows;
        if (statusFilter !== "ALL") rows = rows.filter((r) => statusFilter === "ACTIVE" ? r.result === "ACTIVE" : r.result !== "ACTIVE");
        if (sideFilter !== "ALL") rows = rows.filter((r) => r.side === sideFilter);
        if (outcomeFilter !== "ALL") rows = rows.filter((r) => r.result === outcomeFilter);
        if (tickerFilter.trim()) { const n = tickerFilter.trim().toUpperCase(); rows = rows.filter((r) => r.symbol.toUpperCase().includes(n)); }
        return rows;
    }, [data, statusFilter, sideFilter, outcomeFilter, tickerFilter]);

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="px-1">
                <p className="text-[10px] uppercase tracking-[0.15em] text-text-muted mb-0.5">Backtest Performance</p>

                {overview ? (
                    <>
                        {/* Net R + Trade count */}
                        <div className="flex items-baseline gap-2 mb-1.5">
                            <span className={`text-2xl sm:text-3xl font-bold tabular-nums tracking-tight ${overview.netR >= 0 ? "text-price-up" : "text-price-down"}`}>
                                {overview.netR >= 0 ? "+" : ""}{overview.netR.toFixed(1)}R
                            </span>
                            <span className="text-xs text-text-muted tabular-nums">{overview.totalTrades} trades</span>
                        </div>

                        {/* Year pills + Session pills */}
                        <div className="flex flex-wrap items-center gap-1.5">
                            {analytics?.yearlyR.map((yr) => (
                                <span key={yr.year} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] tabular-nums font-medium ${yr.netR >= 0 ? "border-price-up/20 bg-price-up/5" : "border-price-down/20 bg-price-down/5"}`}>
                                    <span className="text-text-muted">{yr.year}</span>
                                    <span className={yr.netR >= 0 ? "text-price-up" : "text-price-down"}>
                                        {yr.netR >= 0 ? "+" : ""}{yr.netR.toFixed(0)}R
                                    </span>
                                </span>
                            ))}

                            {analytics && analytics.sessionR.length > 0 ? (
                                <span className="hidden sm:inline text-border-muted mx-0.5">|</span>
                            ) : null}

                            {analytics?.sessionR.map((s) => {
                                const color = SESSION_COLORS[s.session] ?? "#9eb0c9";
                                return (
                                    <div key={s.session} className="flex items-center gap-2 rounded-full border border-border-muted px-3 py-1 bg-bg-card whitespace-nowrap">
                                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
                                        <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color }}>{s.session}</span>
                                        <span className={`text-[10px] tabular-nums font-semibold ${s.netR >= 0 ? "text-price-up" : "text-price-down"}`}>
                                            {s.netR >= 0 ? "+" : ""}{s.netR.toFixed(0)}R
                                        </span>
                                        <span className="text-[9px] tabular-nums text-text-muted">{s.winRate}%</span>
                                    </div>
                                );
                            })}
                        </div>
                    </>
                ) : loading ? (
                    <div className="flex items-center gap-2 py-4 text-sm text-text-secondary">
                        <Loader2 className="h-4 w-4 animate-spin text-accent" />
                        Loading backtest data...
                    </div>
                ) : null}
            </div>

            {/* Equity Curve */}
            {analytics?.equityCurve && analytics.equityCurve.length >= 2 ? (
                <EquityCurveChart data={analytics.equityCurve} />
            ) : null}

            {/* Risk Simulation */}
            {analytics?.equityCurve && analytics.equityCurve.length >= 2 ? (
                <RiskSimulationCards equityCurve={analytics.equityCurve} />
            ) : null}

            {/* Monthly Heatmap */}
            {analytics?.monthlyR && analytics.monthlyR.length > 0 ? (
                <MonthlyHeatmap data={analytics.monthlyR} />
            ) : null}

            {/* Per-Instrument Cards */}
            {analytics?.instrumentR && analytics.instrumentR.length > 0 ? (
                <InstrumentCards data={analytics.instrumentR} />
            ) : null}

            {/* Backtest trade filters + grid */}
            {data && data.trades.rows.length > 0 ? (
                <>
                    <div className="flex flex-col sm:flex-row flex-wrap items-start sm:items-center gap-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                            <FilterGroup options={["ALL", "ACTIVE", "CLOSED"] as StatusFilter[]} value={statusFilter} onChange={setStatusFilter} activeColor="#8b5cf6" />
                            <FilterGroup options={["ALL", "LONG", "SHORT"] as SideFilter[]} value={sideFilter} onChange={setSideFilter} activeColor="#3b82f6" />
                            <FilterGroup options={["ALL", "WIN", "LOSS", "BE"] as OutcomeFilter[]} value={outcomeFilter} onChange={setOutcomeFilter} activeColor="#22c55e" />
                        </div>
                        <div className="flex items-center gap-2 w-full sm:w-auto">
                            <input type="text" placeholder="Filter ticker..." value={tickerFilter} onChange={(e) => setTickerFilter(e.target.value)}
                                className="flex-1 sm:flex-none sm:w-32 px-2.5 py-1 bg-bg-secondary border border-border-muted rounded-md text-xs text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent transition-colors" />
                            <span className="text-[10px] tabular-nums text-text-muted">{filteredRows.length} trades</span>
                        </div>
                    </div>

                    {filteredRows.length > 0 ? (
                        <TradeGrid>
                            {filteredRows.map((row, i) => {
                                const color = pnlColor(row.rMultiple);
                                const props = {
                                    time: formatTime(row.entryTime), symbol: row.symbol, side: row.side,
                                    entry: formatPrice(row.entryPrice), sl: formatPrice(row.stopLoss), close: formatPrice(row.exitPrice),
                                    pnlPct: formatSignedPct(row.pnlPct), pnlR: formatSignedR(row.rMultiple),
                                    duration: formatDuration(row.durationMs), result: row.result, color,
                                };
                                return (
                                    <div key={`${row.entryTime}:${row.symbol}:${i}`} className="block px-3 sm:px-4 py-2.5 hover:bg-bg-tertiary/40 border-b border-border-muted/50 transition-colors">
                                        <TradeRowMobile {...props} />
                                        <TradeRowDesktop {...props} />
                                    </div>
                                );
                            })}
                        </TradeGrid>
                    ) : (
                        <div className="rounded-lg border border-border-muted bg-bg-card px-4 py-6 text-center text-sm text-text-muted">
                            No backtest trades match the current filters.
                        </div>
                    )}
                </>
            ) : null}
        </div>
    );
}

// ===========================================================================
// SECTION 2 — RECENT SIGNALS (live / paper trades)
// ===========================================================================

function RecentSignalsSection({ snapshot, loading }: { snapshot: LiveTradeSnapshot | null; loading: boolean }) {
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
    const [sideFilter, setSideFilter] = useState<SideFilter>("ALL");
    const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>("ALL");
    const [tickerFilter, setTickerFilter] = useState("");

    const filteredRecords = useMemo(() => {
        if (!snapshot) return [];
        let records = snapshot.records;
        if (statusFilter !== "ALL") records = records.filter((r) => statusFilter === "ACTIVE" ? r.result === "ACTIVE" : r.result !== "ACTIVE");
        if (sideFilter !== "ALL") records = records.filter((r) => r.side === sideFilter);
        if (outcomeFilter !== "ALL") records = records.filter((r) => r.result === outcomeFilter);
        if (tickerFilter.trim()) { const n = tickerFilter.trim().toUpperCase(); records = records.filter((r) => r.symbol.toUpperCase().includes(n)); }
        return records;
    }, [snapshot, statusFilter, sideFilter, outcomeFilter, tickerFilter]);

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2 px-1">
                <h2 className="text-sm font-semibold text-text-primary">Recent Signals</h2>
                {snapshot ? (
                    <span className="text-[10px] tabular-nums text-text-muted bg-bg-tertiary rounded-full px-2 py-0.5">{filteredRecords.length} trades</span>
                ) : null}
            </div>

            <div className="flex flex-col sm:flex-row flex-wrap items-start sm:items-center gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                    <FilterGroup options={["ALL", "ACTIVE", "CLOSED"] as StatusFilter[]} value={statusFilter} onChange={setStatusFilter} activeColor="#8b5cf6" />
                    <FilterGroup options={["ALL", "LONG", "SHORT"] as SideFilter[]} value={sideFilter} onChange={setSideFilter} activeColor="#3b82f6" />
                    <FilterGroup options={["ALL", "WIN", "LOSS", "BE"] as OutcomeFilter[]} value={outcomeFilter} onChange={setOutcomeFilter} activeColor="#22c55e" />
                </div>
                <input type="text" placeholder="Filter ticker..." value={tickerFilter} onChange={(e) => setTickerFilter(e.target.value)}
                    className="w-full sm:w-32 px-2.5 py-1 bg-bg-secondary border border-border-muted rounded-md text-xs text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent transition-colors" />
            </div>

            {loading && !snapshot ? (
                <div className="flex items-center gap-2 py-6 text-sm text-text-secondary">
                    <Loader2 className="h-4 w-4 animate-spin text-accent" />
                    Loading signals...
                </div>
            ) : null}

            {snapshot && filteredRecords.length > 0 ? (
                <TradeGrid>
                    {filteredRecords.map((record, i) => {
                        const pnlPct = computePnlPct(record);
                        const color = pnlColor(record.rMultiple);
                        const props = {
                            time: formatTime(record.entryTime), symbol: record.symbol, side: record.side,
                            entry: formatPrice(record.entryPrice), sl: formatPrice(record.stopLoss), close: formatPrice(record.exitPrice),
                            pnlPct: pnlPct !== null ? formatSignedPct(pnlPct) : "-", pnlR: formatSignedR(record.rMultiple),
                            duration: computeDurationFromTimes(record.entryTime, record.exitTime), result: record.result, color,
                        };
                        return (
                            <div key={`${record.entryTime}:${record.symbol}:${i}`} className="block px-3 sm:px-4 py-2.5 hover:bg-bg-tertiary/40 border-b border-border-muted/50 transition-colors">
                                <TradeRowMobile {...props} />
                                <TradeRowDesktop {...props} />
                            </div>
                        );
                    })}
                </TradeGrid>
            ) : null}

            {snapshot && filteredRecords.length === 0 && !loading ? (
                <div className="rounded-lg border border-border-muted bg-bg-card px-4 py-6 text-center text-sm text-text-muted">
                    No live signals yet.
                </div>
            ) : null}
        </div>
    );
}

// ===========================================================================
// MAIN PAGE COMPONENT
// ===========================================================================

export default function PublicTradeHistory() {
    const [reportsData, setReportsData] = useState<ReportsData | null>(null);
    const [reportsLoading, setReportsLoading] = useState(true);
    const [reportsError, setReportsError] = useState<string | null>(null);
    const [reportsPage, setReportsPage] = useState(1);

    const [liveSnapshot, setLiveSnapshot] = useState<LiveTradeSnapshot | null>(null);
    const [liveLoading, setLiveLoading] = useState(true);
    const [liveError, setLiveError] = useState<string | null>(null);

    const abortReportsRef = useRef<AbortController | null>(null);
    const abortLiveRef = useRef<AbortController | null>(null);
    const activeRef = useRef(true);

    const fetchReports = useCallback(async () => {
        abortReportsRef.current?.abort();
        const controller = new AbortController();
        abortReportsRef.current = controller;
        setReportsLoading(true);
        setReportsError(null);
        try {
            const params = new URLSearchParams({ page: String(reportsPage), pageSize: String(PAGE_SIZE) });
            const res = await fetch(`${REPORTS_ENDPOINT}?${params}`, { cache: "no-store", signal: controller.signal });
            const payload = await res.json();
            if (!activeRef.current || controller.signal.aborted) return;
            if (!res.ok || !payload?.success) throw new Error(payload?.error?.message ?? "Failed to load backtest data.");
            setReportsData(payload.data);
        } catch (err) {
            if (!activeRef.current || controller.signal.aborted) return;
            setReportsError(err instanceof Error ? err.message : "Failed to load backtest data.");
        } finally {
            if (activeRef.current) setReportsLoading(false);
        }
    }, [reportsPage]);

    const fetchLive = useCallback(async () => {
        abortLiveRef.current?.abort();
        const controller = new AbortController();
        abortLiveRef.current = controller;
        setLiveLoading(true);
        setLiveError(null);
        try {
            const res = await fetch(TRADE_HISTORY_ENDPOINT, { cache: "no-store", signal: controller.signal });
            const payload = await res.json();
            if (!activeRef.current || controller.signal.aborted) return;
            if (!res.ok || !payload?.success) throw new Error(payload?.error?.message ?? "Failed to load signals.");
            setLiveSnapshot(payload.data);
        } catch (err) {
            if (!activeRef.current || controller.signal.aborted) return;
            setLiveError(err instanceof Error ? err.message : "Failed to load signals.");
        } finally {
            if (activeRef.current) setLiveLoading(false);
        }
    }, []);

    useEffect(() => {
        activeRef.current = true;
        void fetchReports();
        void fetchLive();
        const interval = setInterval(() => { void fetchReports(); void fetchLive(); }, REFRESH_INTERVAL_MS);
        return () => { activeRef.current = false; abortReportsRef.current?.abort(); abortLiveRef.current?.abort(); clearInterval(interval); };
    }, [fetchReports, fetchLive]);

    const pagination = reportsData?.trades.pagination;

    return (
        <div className="min-h-screen bg-bg-secondary">
            {/* ========== TOP BAR ========== */}
            <div className="sticky top-0 z-30 border-b border-border-muted bg-bg-secondary/80 backdrop-blur-sm">
                <div className="max-w-[1400px] mx-auto flex items-center justify-between px-4 sm:px-6 py-3">
                    <span className="text-sm font-semibold text-text-primary tracking-tight">TradeHVV</span>
                    <Link href="/login" className="inline-flex items-center gap-1.5 rounded-md bg-accent-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-primary/90 transition-colors">
                        <LogIn className="h-3.5 w-3.5" />
                        Sign in
                    </Link>
                </div>
            </div>

            <div className="max-w-[1400px] mx-auto space-y-4 p-4 sm:p-6">
                {/* ========== BACKTEST PERFORMANCE ========== */}
                <BacktestPerformanceSection data={reportsData} loading={reportsLoading} />

                {reportsError ? (
                    <div className="rounded-lg border border-price-down/20 bg-price-down/8 px-4 py-3 text-sm text-price-down">{reportsError}</div>
                ) : null}

                {pagination && pagination.totalPages > 1 ? (
                    <div className="flex items-center justify-center gap-2">
                        <button type="button" onClick={() => setReportsPage((p) => Math.max(1, p - 1))} disabled={reportsPage <= 1}
                            className="px-3 py-1 rounded text-xs font-medium bg-bg-tertiary text-text-secondary hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Prev</button>
                        <span className="text-xs tabular-nums text-text-muted">{reportsPage} / {pagination.totalPages}</span>
                        <button type="button" onClick={() => setReportsPage((p) => Math.min(pagination.totalPages, p + 1))} disabled={reportsPage >= pagination.totalPages}
                            className="px-3 py-1 rounded text-xs font-medium bg-bg-tertiary text-text-secondary hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Next</button>
                    </div>
                ) : null}

                {/* ========== DIVIDER ========== */}
                <div className="border-t border-border-muted" />

                {/* ========== RECENT SIGNALS ========== */}
                <RecentSignalsSection snapshot={liveSnapshot} loading={liveLoading} />

                {liveError ? (
                    <div className="rounded-lg border border-price-down/20 bg-price-down/8 px-4 py-3 text-sm text-price-down">{liveError}</div>
                ) : null}

                <footer className="pb-4 text-center text-[10px] text-text-muted">Auto-refreshes every hour</footer>
            </div>
        </div>
    );
}
