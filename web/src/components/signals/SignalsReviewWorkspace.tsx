"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Download, Loader2, Search, Sigma } from "lucide-react";
import { EngineRun, EngineStrategy, SignalReviewRow } from "@/types/engine";

const fetchJson = async <T,>(url: string): Promise<T> => {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to load ${url}`);
    }
    return response.json();
};

const formatSigned = (value: number, suffix = "") => `${value >= 0 ? "+" : ""}${value.toFixed(2)}${suffix}`;
const formatDateInput = (value: string | null) => (value ? value.slice(0, 10) : "");
const toUtcRangeStart = (value: string) => `${value}T00:00:00.000Z`;
const toUtcRangeEnd = (value: string) => `${value}T23:59:59.999Z`;

const csvEscape = (value: unknown) => {
    const text = value === null || value === undefined ? "" : String(value);
    if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
        return `"${text.replace(/"/g, "\"\"")}"`;
    }
    return text;
};

const downloadCsv = <T extends object>(filename: string, rows: T[]) => {
    if (rows.length === 0) return;

    const headers = Object.keys(rows[0] as object);
    const lines = [
        headers.join(","),
        ...rows.map((row) => headers.map((header) => csvEscape((row as Record<string, unknown>)[header])).join(",")),
    ];

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

export default function SignalsReviewWorkspace() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
    const [runs, setRuns] = useState<EngineRun[]>([]);
    const [strategies, setStrategies] = useState<EngineStrategy[]>([]);
    const [selectedRunId, setSelectedRunId] = useState("ALL");
    const [selectedStrategyId, setSelectedStrategyId] = useState("ALL");
    const [selectedSession, setSelectedSession] = useState<"ALL" | "ASIAN" | "LONDON" | "NY">("ALL");
    const [selectedSide, setSelectedSide] = useState<"ALL" | "LONG" | "SHORT">("ALL");
    const [symbol, setSymbol] = useState("");
    const [timeframe, setTimeframe] = useState("");
    const [fromDate, setFromDate] = useState("");
    const [toDate, setToDate] = useState("");
    const [rows, setRows] = useState<SignalReviewRow[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const beginReviewReload = () => {
        setError(null);
        setIsLoading(true);
    };

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
                    const firstRun = runsResult.data[0];
                    setSelectedRunId(firstRun.id);
                    setFromDate(formatDateInput(firstRun.startedAt));
                    setToDate(formatDateInput(firstRun.finishedAt || firstRun.createdAt));
                } else {
                    setSelectedRunId("ALL");
                    setIsLoading(false);
                }
            })
            .catch((fetchError) => {
                if (!active) return;
                setError(fetchError.message);
                setIsLoading(false);
            });

        return () => {
            active = false;
        };
    }, [apiUrl]);

    useEffect(() => {
        let active = true;
        const params = new URLSearchParams();

        if (selectedRunId !== "ALL") {
            params.set("backtestRunId", selectedRunId);
        }
        if (selectedStrategyId !== "ALL") {
            params.set("strategyId", selectedStrategyId);
        }
        if (selectedSession !== "ALL") {
            params.set("session", selectedSession);
        }
        if (selectedSide !== "ALL") {
            params.set("side", selectedSide);
        }
        if (symbol.trim()) {
            params.set("symbol", symbol.trim().toUpperCase());
        }
        if (timeframe.trim()) {
            params.set("timeframe", timeframe.trim());
        }
        if (fromDate) {
            params.set("from", toUtcRangeStart(fromDate));
        }
        if (toDate) {
            params.set("to", toUtcRangeEnd(toDate));
        }

        fetchJson<{ data: SignalReviewRow[] }>(`${apiUrl}/api/engine/signals-review?${params}`)
            .then((result) => {
                if (!active) return;
                setRows(result.data);
                setError(null);
            })
            .catch((fetchError) => {
                if (!active) return;
                setError(fetchError.message);
            })
            .finally(() => {
                if (!active) return;
                setIsLoading(false);
            });

        return () => {
            active = false;
        };
    }, [apiUrl, fromDate, selectedRunId, selectedSession, selectedSide, selectedStrategyId, symbol, timeframe, toDate]);

    const reviewSummary = useMemo(() => {
        const withResults = rows.filter((row) => row.resultCount > 0).length;
        const openSignals = rows.filter((row) => row.openResults > 0).length;
        const netR = rows.reduce((sum, row) => sum + row.netR, 0);
        return {
            totalSignals: rows.length,
            withResults,
            openSignals,
            netR,
        };
    }, [rows]);

    const exportRows = useMemo(() => rows.map((row) => ({
        signalId: row.signalId,
        backtestRunName: row.backtestRunName ?? "",
        symbol: row.symbol,
        timeframe: row.timeframe,
        side: row.side,
        session: row.session,
        strategyCode: row.strategyCode,
        entryTime: row.entryTime,
        entryPrice: row.entryPrice,
        stopLoss: row.stopLoss,
        takeProfit1: row.takeProfit1 ?? "",
        takeProfit2: row.takeProfit2 ?? "",
        resultCount: row.resultCount,
        wins: row.wins,
        losses: row.losses,
        openResults: row.openResults,
        netR: row.netR,
        avgR: row.avgR,
        bestExitRuleCode: row.bestExitRuleCode ?? "",
        latestExitTime: row.latestExitTime ?? "",
    })), [rows]);

    return (
        <section className="rounded-[28px] border border-border-muted bg-bg-primary/90 p-5 shadow-[0_24px_70px_rgba(0,0,0,0.3)]">
            <div className="flex flex-col gap-4">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-accent">
                            <Search className="h-4 w-4" />
                            Signals Review
                        </div>
                        <h2 className="mt-2 text-2xl font-black tracking-tight text-text-primary">Review imported signals as first-class records</h2>
                        <p className="mt-1 text-sm text-text-secondary">
                            Filter imported signals by run, strategy, session, side, symbol, timeframe, and date window, then deep-link straight into the Engine workspace.
                        </p>
                    </div>
                    <button
                        onClick={() => downloadCsv("signals-review.csv", exportRows)}
                        disabled={rows.length === 0}
                        className="inline-flex items-center gap-2 rounded-full border border-border-muted bg-bg-tertiary px-4 py-2 text-sm font-bold text-text-primary disabled:opacity-50"
                    >
                        <Download className="h-4 w-4" />
                        Export CSV
                    </button>
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
                    <label className="flex min-w-[240px] flex-col gap-1 text-xs text-text-muted">
                        Backtest run
                        <select
                            value={selectedRunId}
                            onChange={(event) => {
                                const nextValue = event.target.value;
                                const nextRun = runs.find((run) => run.id === nextValue);
                                beginReviewReload();
                                setSelectedRunId(nextValue);
                                setFromDate(nextRun ? formatDateInput(nextRun.startedAt) : "");
                                setToDate(nextRun ? formatDateInput(nextRun.finishedAt || nextRun.createdAt) : "");
                            }}
                            className="rounded-xl border border-border-muted bg-bg-tertiary px-3 py-2 text-sm font-medium text-text-primary outline-none focus:border-accent/50"
                        >
                            <option value="ALL">All runs</option>
                            {runs.map((run) => (
                                <option key={run.id} value={run.id}>
                                    {run.name} / {run.symbol} / {run.timeframe}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label className="flex min-w-[220px] flex-col gap-1 text-xs text-text-muted">
                        Strategy
                        <select
                            value={selectedStrategyId}
                            onChange={(event) => {
                                beginReviewReload();
                                setSelectedStrategyId(event.target.value);
                            }}
                            className="rounded-xl border border-border-muted bg-bg-tertiary px-3 py-2 text-sm font-medium text-text-primary outline-none focus:border-accent/50"
                        >
                            <option value="ALL">All strategies</option>
                            {strategies.map((strategy) => (
                                <option key={strategy.id} value={strategy.id}>
                                    {strategy.code}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label className="flex min-w-[160px] flex-col gap-1 text-xs text-text-muted">
                        Session
                        <select
                            value={selectedSession}
                            onChange={(event) => {
                                beginReviewReload();
                                setSelectedSession(event.target.value as "ALL" | "ASIAN" | "LONDON" | "NY");
                            }}
                            className="rounded-xl border border-border-muted bg-bg-tertiary px-3 py-2 text-sm font-medium text-text-primary outline-none focus:border-accent/50"
                        >
                            <option value="ALL">All sessions</option>
                            <option value="ASIAN">ASIAN</option>
                            <option value="LONDON">LONDON</option>
                            <option value="NY">NY</option>
                        </select>
                    </label>

                    <label className="flex min-w-[140px] flex-col gap-1 text-xs text-text-muted">
                        Symbol
                        <input
                            value={symbol}
                            onChange={(event) => {
                                beginReviewReload();
                                setSymbol(event.target.value.toUpperCase());
                            }}
                            placeholder="BTCUSD"
                            className="rounded-xl border border-border-muted bg-bg-tertiary px-3 py-2 text-sm font-medium text-text-primary outline-none focus:border-accent/50"
                        />
                    </label>

                    <label className="flex min-w-[120px] flex-col gap-1 text-xs text-text-muted">
                        Timeframe
                        <input
                            value={timeframe}
                            onChange={(event) => {
                                beginReviewReload();
                                setTimeframe(event.target.value);
                            }}
                            placeholder="1h"
                            className="rounded-xl border border-border-muted bg-bg-tertiary px-3 py-2 text-sm font-medium text-text-primary outline-none focus:border-accent/50"
                        />
                    </label>

                    <label className="flex min-w-[160px] flex-col gap-1 text-xs text-text-muted">
                        From (UTC)
                        <input
                            type="date"
                            value={fromDate}
                            max={toDate || undefined}
                            onChange={(event) => {
                                beginReviewReload();
                                setFromDate(event.target.value);
                            }}
                            className="rounded-xl border border-border-muted bg-bg-tertiary px-3 py-2 text-sm font-medium text-text-primary outline-none focus:border-accent/50"
                        />
                    </label>

                    <label className="flex min-w-[160px] flex-col gap-1 text-xs text-text-muted">
                        To (UTC)
                        <input
                            type="date"
                            value={toDate}
                            min={fromDate || undefined}
                            onChange={(event) => {
                                beginReviewReload();
                                setToDate(event.target.value);
                            }}
                            className="rounded-xl border border-border-muted bg-bg-tertiary px-3 py-2 text-sm font-medium text-text-primary outline-none focus:border-accent/50"
                        />
                    </label>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    {(["ALL", "LONG", "SHORT"] as const).map((item) => (
                        <button
                            key={item}
                            onClick={() => {
                                beginReviewReload();
                                setSelectedSide(item);
                            }}
                            className={`rounded-full px-3 py-1.5 text-xs font-bold ${selectedSide === item ? "bg-accent text-bg-secondary" : "border border-border-muted text-text-secondary"}`}
                        >
                            {item}
                        </button>
                    ))}
                </div>

                {error ? (
                    <div className="rounded-2xl border border-price-down/20 bg-price-down/10 px-4 py-3 text-sm text-price-down">
                        {error}
                    </div>
                ) : null}

                {isLoading ? (
                    <div className="flex min-h-[240px] items-center justify-center rounded-2xl border border-border-muted bg-bg-tertiary/35">
                        <Loader2 className="h-8 w-8 animate-spin text-accent" />
                    </div>
                ) : rows.length === 0 ? (
                    <div className="grid min-h-[240px] place-items-center rounded-2xl border border-border-muted bg-bg-tertiary/35">
                        <div className="text-center">
                            <Sigma className="mx-auto h-8 w-8 text-accent" />
                            <h3 className="mt-3 text-lg font-bold text-text-primary">No signals found</h3>
                            <p className="mt-1 text-sm text-text-secondary">Adjust the filters or import more signal bundles to review them here.</p>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                            <div className="rounded-2xl border border-border-muted bg-bg-tertiary/45 px-4 py-3">
                                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-text-muted">Signals</div>
                                <div className="mt-2 text-2xl font-black text-text-primary">{reviewSummary.totalSignals}</div>
                            </div>
                            <div className="rounded-2xl border border-border-muted bg-bg-tertiary/45 px-4 py-3">
                                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-text-muted">With Results</div>
                                <div className="mt-2 text-2xl font-black text-text-primary">{reviewSummary.withResults}</div>
                            </div>
                            <div className="rounded-2xl border border-border-muted bg-bg-tertiary/45 px-4 py-3">
                                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-text-muted">Open Signals</div>
                                <div className="mt-2 text-2xl font-black text-text-primary">{reviewSummary.openSignals}</div>
                            </div>
                            <div className="rounded-2xl border border-border-muted bg-bg-tertiary/45 px-4 py-3">
                                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-text-muted">Net R</div>
                                <div className={`mt-2 text-2xl font-black ${reviewSummary.netR >= 0 ? "text-price-up" : "text-price-down"}`}>{formatSigned(reviewSummary.netR, "R")}</div>
                            </div>
                        </div>

                        <div className="overflow-x-auto rounded-2xl border border-border-muted">
                            <table className="min-w-full text-left text-sm">
                                <thead className="bg-bg-tertiary/80 text-xs uppercase tracking-[0.18em] text-text-muted">
                                    <tr>
                                        <th className="px-4 py-3">Signal</th>
                                        <th className="px-4 py-3">Strategy</th>
                                        <th className="px-4 py-3">Session</th>
                                        <th className="px-4 py-3">Entry</th>
                                        <th className="px-4 py-3">Results</th>
                                        <th className="px-4 py-3">Net R</th>
                                        <th className="px-4 py-3">Best Exit</th>
                                        <th className="px-4 py-3">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((row) => {
                                        const engineParams = new URLSearchParams({
                                            symbol: row.symbol,
                                            tf: row.timeframe,
                                            ...(row.backtestRunId ? { run: row.backtestRunId } : {}),
                                            strategyId: row.strategyId,
                                            session: row.session,
                                            side: row.side,
                                            ...(fromDate ? { from: toUtcRangeStart(fromDate) } : {}),
                                            ...(toDate ? { to: toUtcRangeEnd(toDate) } : {}),
                                        }).toString();
                                        const historyParams = new URLSearchParams({
                                            ...(fromDate ? { from: fromDate } : {}),
                                            ...(toDate ? { to: toDate } : {}),
                                            side: row.side,
                                            symbol: row.symbol,
                                        }).toString();

                                        return (
                                            <tr key={row.signalId} className="border-t border-border-muted/70">
                                                <td className="px-4 py-3">
                                                    <div className="font-bold text-text-primary">{row.symbol} / {row.timeframe}</div>
                                                    <div className="text-xs text-text-muted">{row.side} / {formatDateInput(row.entryTime)}</div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="font-semibold text-text-primary">{row.strategyCode}</div>
                                                    <div className="text-xs text-text-muted">{row.backtestRunName ?? "No linked run"}</div>
                                                </td>
                                                <td className="px-4 py-3 text-text-secondary">{row.session}</td>
                                                <td className="px-4 py-3 text-text-secondary">
                                                    {row.entryPrice.toFixed(2)}
                                                    <div className="text-xs text-text-muted">SL {row.stopLoss.toFixed(2)}</div>
                                                </td>
                                                <td className="px-4 py-3 text-text-secondary">
                                                    {row.wins}W / {row.losses}L
                                                    {row.openResults ? ` / ${row.openResults} open` : ""}
                                                    <div className="text-xs text-text-muted">{row.resultCount} result rows</div>
                                                </td>
                                                <td className={`px-4 py-3 font-semibold ${row.netR >= 0 ? "text-price-up" : "text-price-down"}`}>{formatSigned(row.netR, "R")}</td>
                                                <td className="px-4 py-3 text-text-secondary">
                                                    {row.bestExitRuleCode ?? "N/A"}
                                                    <div className="text-xs text-text-muted">{row.bestExitRuleName ?? "No closed result"}</div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="flex flex-wrap gap-2">
                                                        {row.backtestRunId ? (
                                                            <Link
                                                                href={`/signals/backtests/${row.backtestRunId}?${historyParams}`}
                                                                className="inline-flex items-center gap-2 rounded-full border border-border-muted bg-bg-tertiary px-3 py-1.5 text-xs font-bold text-text-primary"
                                                            >
                                                                History
                                                                <ArrowRight className="h-3.5 w-3.5" />
                                                            </Link>
                                                        ) : null}
                                                        <Link
                                                            href={`/engine?${engineParams}`}
                                                            className="inline-flex items-center gap-2 rounded-full border border-border-muted bg-bg-tertiary px-3 py-1.5 text-xs font-bold text-text-primary"
                                                        >
                                                            Engine
                                                            <ArrowRight className="h-3.5 w-3.5" />
                                                        </Link>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
            </div>
        </section>
    );
}
