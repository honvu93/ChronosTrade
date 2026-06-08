"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
    ArrowRight,
    Layers3,
    Loader2,
    Minus,
    Play,
    Plus,
    RefreshCw,
} from "lucide-react";
import {
    GeneratedBacktestDetail,
    SignalDefinition,
} from "@/types/signals";
import { EngineOverview } from "@/types/engine";
import { useBacktestProgress } from "@/hooks/useBacktestProgress";
import {
    buildSignalDefinitionKey,
} from "@/lib/generatedBacktestContext";
import {
    getInheritedGeneratedBacktestContext,
} from "@/lib/generatedBacktestWorkspaceState";
import {
    buildGeneratedBacktestSymbolOptions,
    buildGeneratedBacktestTimeframeOptions,
} from "@/lib/generatedBacktestFormOptions";
import SectionCard from "@/components/ui/SectionCard";
import StateBanner from "@/components/ui/StateBanner";

interface BatchVariant {
    id: string;
    label: string;
    overrides: string; // JSON string of execution config overrides
}

interface BatchRunEntry {
    backtestRunId: string;
    label: string;
    status: string;
}

interface BatchState {
    batchId: string;
    batchLabel: string;
    runs: BatchRunEntry[];
}

interface BatchComparisonMetrics {
    signalCount: number;
    totalTrades: number;
    closedTrades: number;
    winRate: number;
    profitFactor: number;
    expectancy: number;
    netR: number;
    netUsd: number;
    maxDrawdownPct: number;
}

const fetchJson = async <T,>(url: string): Promise<T> => {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to load ${url}`);
    }
    return response.json();
};

const formatDateInput = (value: Date) => value.toISOString().slice(0, 10);
const toUtcRangeStart = (value: string) => `${value}T00:00:00.000Z`;
const toUtcRangeEnd = (value: string) => `${value}T23:59:59.999Z`;
const formatNumber = (value: number, digits = 2) => value.toLocaleString(undefined, { maximumFractionDigits: digits });
const formatSigned = (value: number, suffix = "") => `${value >= 0 ? "+" : ""}${value.toFixed(2)}${suffix}`;

const parseNumeric = (value: string) => {
    if (value.trim() === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const getDefaultRange = () => {
    const to = new Date();
    const from = new Date(to.getTime() - 180 * 24 * 60 * 1000 * 60);
    return {
        from: formatDateInput(from),
        to: formatDateInput(to),
    };
};

const createDefaultVariant = (): BatchVariant => ({
    id: crypto.randomUUID(),
    label: "",
    overrides: "{}",
});

export default function BatchBacktestComparison() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
    const defaultRange = useMemo(() => getDefaultRange(), []);
    const { progressMap, getProgress } = useBacktestProgress();

    // Reference data
    const [definitions, setDefinitions] = useState<SignalDefinition[]>([]);
    const [availableSymbols, setAvailableSymbols] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    // Batch form state
    const [selectedDefinitionKey, setSelectedDefinitionKey] = useState("");
    const [form, setForm] = useState({
        symbol: "BTCUSD",
        timeframe: "1h",
        fromDate: defaultRange.from,
        toDate: defaultRange.to,
        initialEquity: "10000",
        riskPercent: "2",
    });
    const [batchLabel, setBatchLabel] = useState("Batch Comparison");
    const [variants, setVariants] = useState<BatchVariant[]>([
        { ...createDefaultVariant(), label: "Baseline" },
        { ...createDefaultVariant(), label: "Variant A" },
    ]);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Batch results
    const [activeBatch, setActiveBatch] = useState<BatchState | null>(null);
    const [comparisonData, setComparisonData] = useState<Map<string, { detail: GeneratedBacktestDetail; overview: EngineOverview | null }>>(new Map());
    const [isComparisonLoading, setIsComparisonLoading] = useState(false);

    // Load definitions and symbols
    useEffect(() => {
        let active = true;

        Promise.all([
            fetchJson<{ data: SignalDefinition[] }>(`${apiUrl}/api/signals/definitions`),
            fetchJson<string[]>(`${apiUrl}/api/symbols`).catch(() => []),
        ])
            .then(([defsResult, symbols]) => {
                if (!active) return;
                setDefinitions(defsResult.data);
                setAvailableSymbols(Array.isArray(symbols) ? symbols : []);
                if (defsResult.data.length > 0) {
                    setSelectedDefinitionKey(buildSignalDefinitionKey(defsResult.data[0]));
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

        return () => { active = false; };
    }, [apiUrl]);

    const selectedDefinition = useMemo(
        () => definitions.find((d) => buildSignalDefinitionKey(d) === selectedDefinitionKey) ?? null,
        [definitions, selectedDefinitionKey],
    );

    const inheritedContext = useMemo(
        () => getInheritedGeneratedBacktestContext(selectedDefinition),
        [selectedDefinition],
    );

    const symbolOptions = useMemo(() => buildGeneratedBacktestSymbolOptions({
        availableSymbols,
        currentSymbol: form.symbol,
        inheritedSymbol: inheritedContext.symbol,
    }), [availableSymbols, form.symbol, inheritedContext.symbol]);

    const timeframeOptions = useMemo(() => buildGeneratedBacktestTimeframeOptions({
        currentTimeframe: form.timeframe,
        inheritedTimeframe: inheritedContext.timeframe,
    }), [form.timeframe, inheritedContext.timeframe]);

    // Build default parameters for the signal definition
    const defaultParameters = useMemo(() => {
        const params: Record<string, unknown> = {};
        (selectedDefinition?.parameterSchema?.fields || []).forEach((field) => {
            if (field.type === "boolean") {
                params[field.id] = Boolean(field.default);
            } else if (field.default !== null && field.default !== undefined) {
                params[field.id] = field.type === "number" ? Number(field.default) : field.default;
            }
        });
        return params;
    }, [selectedDefinition]);

    const handleAddVariant = useCallback(() => {
        setVariants((prev) => [...prev, { ...createDefaultVariant(), label: `Variant ${String.fromCharCode(65 + prev.length - 1)}` }]);
    }, []);

    const handleRemoveVariant = useCallback((id: string) => {
        setVariants((prev) => prev.filter((v) => v.id !== id));
    }, []);

    const handleUpdateVariant = useCallback((id: string, patch: Partial<BatchVariant>) => {
        setVariants((prev) => prev.map((v) => v.id === id ? { ...v, ...patch } : v));
    }, []);

    const handleSubmitBatch = async () => {
        if (!selectedDefinition) {
            setError("Please select a signal definition.");
            return;
        }

        if (variants.length < 1) {
            setError("Add at least one variant to run a batch.");
            return;
        }

        const initialEquity = parseNumeric(form.initialEquity);
        const riskPercent = parseNumeric(form.riskPercent);

        if (!initialEquity || !riskPercent) {
            setError("Initial equity and risk percent are required.");
            return;
        }

        setIsSubmitting(true);
        setError(null);
        setSuccess(null);
        setComparisonData(new Map());

        try {
            const runs = variants.map((variant) => {
                let overrides: Record<string, unknown> = {};
                try {
                    overrides = JSON.parse(variant.overrides || "{}");
                } catch {
                    // Invalid JSON, use empty overrides
                }

                return {
                    signalCode: selectedDefinition.code,
                    signalVersion: selectedDefinition.version,
                    symbol: form.symbol.trim(),
                    timeframe: form.timeframe.trim(),
                    dateRange: {
                        from: toUtcRangeStart(form.fromDate),
                        to: toUtcRangeEnd(form.toDate),
                    },
                    parameters: defaultParameters,
                    initialEquity,
                    riskPercent,
                    executionConfig: overrides,
                    notes: variant.label || undefined,
                };
            });

            const response = await fetch(`${apiUrl}/api/signals/backtests/batch`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ runs, batchLabel }),
            });
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || "Failed to submit batch");
            }

            const batchData = result.data as { batchId: string; batchLabel: string | null; runs: Array<{ backtestRunId: string; status: string }> };

            setActiveBatch({
                batchId: batchData.batchId,
                batchLabel: batchData.batchLabel || batchLabel,
                runs: batchData.runs.map((r, i) => ({
                    backtestRunId: r.backtestRunId,
                    label: variants[i]?.label || `Run ${i + 1}`,
                    status: r.status,
                })),
            });

            setSuccess(`Batch submitted with ${batchData.runs.length} runs. Monitoring progress...`);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to submit batch");
        } finally {
            setIsSubmitting(false);
        }
    };

    // Compute live batch run statuses
    const batchRunStatuses = useMemo(() => {
        if (!activeBatch) return [];
        return activeBatch.runs.map((entry) => {
            const liveProgress = getProgress(entry.backtestRunId);
            return {
                ...entry,
                liveStatus: liveProgress?.status ?? entry.status,
                progress: liveProgress,
            };
        });
    }, [activeBatch, getProgress]);

    const allBatchComplete = useMemo(
        () => batchRunStatuses.length > 0 && batchRunStatuses.every((r) => r.liveStatus === "COMPLETED" || r.liveStatus === "FAILED"),
        [batchRunStatuses],
    );

    // Auto-fetch comparison data when all batch runs complete
    useEffect(() => {
        if (!allBatchComplete || !activeBatch || isComparisonLoading) return;
        if (comparisonData.size > 0) return; // Already loaded

        setIsComparisonLoading(true);

        const completedRunIds = batchRunStatuses
            .filter((r) => r.liveStatus === "COMPLETED")
            .map((r) => r.backtestRunId);

        Promise.all(
            completedRunIds.map(async (runId) => {
                const [detail, overview] = await Promise.all([
                    fetchJson<{ data: GeneratedBacktestDetail }>(`${apiUrl}/api/signals/backtests/${runId}`).then((r) => r.data),
                    fetchJson<{ data: EngineOverview }>(`${apiUrl}/api/engine/overview?backtestRunId=${runId}`).then((r) => r.data).catch(() => null),
                ]);
                return { runId, detail, overview };
            }),
        )
            .then((results) => {
                const next = new Map<string, { detail: GeneratedBacktestDetail; overview: EngineOverview | null }>();
                for (const r of results) {
                    next.set(r.runId, { detail: r.detail, overview: r.overview });
                }
                setComparisonData(next);
            })
            .catch((err) => {
                setError(err instanceof Error ? err.message : "Failed to load comparison data");
            })
            .finally(() => {
                setIsComparisonLoading(false);
            });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [allBatchComplete, activeBatch]);

    const handleRefreshComparison = useCallback(async () => {
        if (!activeBatch) return;
        setIsComparisonLoading(true);
        setError(null);

        const completedRunIds = batchRunStatuses
            .filter((r) => r.liveStatus === "COMPLETED")
            .map((r) => r.backtestRunId);

        try {
            const results = await Promise.all(
                completedRunIds.map(async (runId) => {
                    const [detail, overview] = await Promise.all([
                        fetchJson<{ data: GeneratedBacktestDetail }>(`${apiUrl}/api/signals/backtests/${runId}`).then((r) => r.data),
                        fetchJson<{ data: EngineOverview }>(`${apiUrl}/api/engine/overview?backtestRunId=${runId}`).then((r) => r.data).catch(() => null),
                    ]);
                    return { runId, detail, overview };
                }),
            );
            const next = new Map<string, { detail: GeneratedBacktestDetail; overview: EngineOverview | null }>();
            for (const r of results) {
                next.set(r.runId, { detail: r.detail, overview: r.overview });
            }
            setComparisonData(next);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to refresh comparison");
        } finally {
            setIsComparisonLoading(false);
        }
    }, [activeBatch, apiUrl, batchRunStatuses]);

    const getMetrics = useCallback((runId: string): BatchComparisonMetrics | null => {
        const entry = comparisonData.get(runId);
        if (!entry) return null;

        const overview = entry.overview;
        const detail = entry.detail;

        return {
            signalCount: overview?.metrics.signalCount ?? detail.counts.signals,
            totalTrades: overview?.metrics.totalTrades ?? detail.counts.results,
            closedTrades: overview?.metrics.closedTrades ?? detail.counts.results,
            winRate: overview?.metrics.winRate ?? 0,
            profitFactor: overview?.metrics.profitFactor ?? 0,
            expectancy: overview?.metrics.expectancy ?? 0,
            netR: overview?.metrics.netR ?? 0,
            netUsd: overview?.metrics.netUsd ?? 0,
            maxDrawdownPct: overview?.metrics.maxDrawdownPct ?? 0,
        };
    }, [comparisonData]);

    if (isLoading) {
        return (
            <div className="grid h-full place-items-center rounded-[28px] border border-border-muted bg-bg-primary/90">
                <Loader2 className="h-8 w-8 animate-spin text-accent" />
            </div>
        );
    }

    return (
        <div className="grid gap-6">
            <SectionCard
                title="Batch Backtest Comparison"
                description="Compare backtest variants"
                icon={<Layers3 className="h-5 w-5" />}
            >
                <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
                    {/* Left: Batch form */}
                    <div className="grid gap-4">
                        <div className="rounded-2xl border border-border-muted bg-bg-tertiary/45 p-4">
                            <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-text-muted">Base Configuration</div>
                            <div className="mt-4 grid gap-3 md:grid-cols-2">
                                <label className="flex flex-col gap-1 text-xs text-text-muted md:col-span-2">
                                    Signal Definition
                                    <select
                                        value={selectedDefinitionKey}
                                        onChange={(e) => setSelectedDefinitionKey(e.target.value)}
                                        className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm font-medium text-text-primary outline-none focus:border-accent/50"
                                    >
                                        <option value="">Select a signal definition</option>
                                        {definitions.map((d) => (
                                            <option key={d.id} value={buildSignalDefinitionKey(d)}>
                                                {d.name} / {d.code}@{d.version}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <label className="flex flex-col gap-1 text-xs text-text-muted">
                                    Symbol
                                    <select
                                        value={form.symbol}
                                        onChange={(e) => setForm((c) => ({ ...c, symbol: e.target.value }))}
                                        className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50"
                                    >
                                        <option value="">Select a symbol</option>
                                        {symbolOptions.map((s) => (
                                            <option key={s} value={s}>{s}</option>
                                        ))}
                                    </select>
                                </label>
                                <label className="flex flex-col gap-1 text-xs text-text-muted">
                                    Timeframe
                                    <select
                                        value={form.timeframe}
                                        onChange={(e) => setForm((c) => ({ ...c, timeframe: e.target.value }))}
                                        className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50"
                                    >
                                        <option value="">Select a timeframe</option>
                                        {timeframeOptions.map((t) => (
                                            <option key={t} value={t}>{t}</option>
                                        ))}
                                    </select>
                                </label>
                                <label className="flex flex-col gap-1 text-xs text-text-muted">
                                    From (UTC)
                                    <input
                                        type="date"
                                        value={form.fromDate}
                                        onChange={(e) => setForm((c) => ({ ...c, fromDate: e.target.value }))}
                                        className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50"
                                    />
                                </label>
                                <label className="flex flex-col gap-1 text-xs text-text-muted">
                                    To (UTC)
                                    <input
                                        type="date"
                                        value={form.toDate}
                                        onChange={(e) => setForm((c) => ({ ...c, toDate: e.target.value }))}
                                        className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50"
                                    />
                                </label>
                                <label className="flex flex-col gap-1 text-xs text-text-muted">
                                    Initial Equity
                                    <input
                                        type="number"
                                        step="any"
                                        value={form.initialEquity}
                                        onChange={(e) => setForm((c) => ({ ...c, initialEquity: e.target.value }))}
                                        className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50"
                                    />
                                </label>
                                <label className="flex flex-col gap-1 text-xs text-text-muted">
                                    Risk Percent
                                    <input
                                        type="number"
                                        step="any"
                                        value={form.riskPercent}
                                        onChange={(e) => setForm((c) => ({ ...c, riskPercent: e.target.value }))}
                                        className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50"
                                    />
                                </label>
                                <label className="flex flex-col gap-1 text-xs text-text-muted md:col-span-2">
                                    Batch Label
                                    <input
                                        type="text"
                                        value={batchLabel}
                                        onChange={(e) => setBatchLabel(e.target.value)}
                                        className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50"
                                    />
                                </label>
                            </div>
                        </div>

                        <div className="rounded-2xl border border-border-muted bg-bg-tertiary/45 p-4">
                            <div className="flex items-center justify-between">
                                <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-text-muted">Variants ({variants.length})</div>
                                <button
                                    type="button"
                                    onClick={handleAddVariant}
                                    disabled={variants.length >= 10}
                                    className="inline-flex items-center gap-1 rounded-lg border border-border-muted bg-bg-tertiary px-3 py-1.5 text-xs font-bold text-text-primary disabled:opacity-50"
                                >
                                    <Plus className="h-3 w-3" />
                                    Add Variant
                                </button>
                            </div>
                            <div className="mt-3 grid gap-3">
                                {variants.map((variant, index) => (
                                    <div key={variant.id} className="rounded-2xl border border-border-muted bg-bg-primary/70 p-4">
                                        <div className="flex items-center justify-between gap-3">
                                            <label className="flex flex-1 flex-col gap-1 text-xs text-text-muted">
                                                Label
                                                <input
                                                    type="text"
                                                    value={variant.label}
                                                    onChange={(e) => handleUpdateVariant(variant.id, { label: e.target.value })}
                                                    placeholder={`Variant ${index + 1}`}
                                                    className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50"
                                                />
                                            </label>
                                            <button
                                                type="button"
                                                onClick={() => handleRemoveVariant(variant.id)}
                                                disabled={variants.length <= 1}
                                                className="mt-4 rounded-lg border border-price-down/25 bg-price-down/10 p-1.5 text-price-down disabled:opacity-30"
                                                title="Remove variant"
                                            >
                                                <Minus className="h-3 w-3" />
                                            </button>
                                        </div>
                                        <label className="mt-2 flex flex-col gap-1 text-xs text-text-muted">
                                            Execution Config Overrides (JSON)
                                            <textarea
                                                value={variant.overrides}
                                                onChange={(e) => handleUpdateVariant(variant.id, { overrides: e.target.value })}
                                                rows={3}
                                                placeholder='{"orderTiming":"SIGNAL_BAR_CLOSE","tradeGuards":{"lossStreakThrottle":{"steps":[{"afterLosses":3,"riskPercent":1}]}}}'
                                                className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 font-mono text-xs text-text-primary outline-none focus:border-accent/50"
                                            />
                                        </label>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {error ? <StateBanner tone="danger" size="compact" message={error} /> : null}
                        {success ? <StateBanner tone="success" size="compact" message={success} /> : null}

                        <button
                            onClick={handleSubmitBatch}
                            disabled={isSubmitting || !selectedDefinition}
                            className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-black text-bg-secondary transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                            Run Batch
                        </button>
                    </div>

                    {/* Right: Batch progress + results */}
                    <div className="grid gap-4">
                        {activeBatch ? (
                            <div className="rounded-2xl border border-border-muted bg-bg-tertiary/45 p-4">
                                <div className="flex items-center justify-between">
                                    <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-text-muted">
                                        Batch Progress
                                    </div>
                                    <div className="text-xs text-text-muted font-mono">{activeBatch.batchId.slice(0, 8)}</div>
                                </div>
                                <div className="mt-2 flex items-center gap-3 text-xs">
                                    <span className="font-bold text-price-up">
                                        {batchRunStatuses.filter((r) => r.liveStatus === "COMPLETED").length}/{batchRunStatuses.length} completed
                                    </span>
                                    {batchRunStatuses.filter((r) => r.liveStatus === "RUNNING").length > 0 && (
                                        <span className="text-accent">
                                            {batchRunStatuses.filter((r) => r.liveStatus === "RUNNING").length} running
                                        </span>
                                    )}
                                    {batchRunStatuses.filter((r) => r.liveStatus === "PENDING" || r.liveStatus === "QUEUED").length > 0 && (
                                        <span className="text-text-muted">
                                            {batchRunStatuses.filter((r) => r.liveStatus === "PENDING" || r.liveStatus === "QUEUED").length} queued
                                        </span>
                                    )}
                                    {batchRunStatuses.filter((r) => r.liveStatus === "FAILED").length > 0 && (
                                        <span className="text-price-down">
                                            {batchRunStatuses.filter((r) => r.liveStatus === "FAILED").length} failed
                                        </span>
                                    )}
                                </div>
                                <div className="mt-3 grid gap-2">
                                    {batchRunStatuses.map((entry) => (
                                        <div
                                            key={entry.backtestRunId}
                                            className="flex items-center justify-between rounded-xl border border-border-muted bg-bg-primary/70 px-4 py-3"
                                        >
                                            <div>
                                                <div className="text-sm font-bold text-text-primary">{entry.label}</div>
                                                <div className="mt-0.5 text-xs text-text-muted font-mono">{entry.backtestRunId.slice(0, 12)}...</div>
                                            </div>
                                            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${
                                                entry.liveStatus === "COMPLETED"
                                                    ? "bg-price-up/15 text-price-up"
                                                    : entry.liveStatus === "FAILED"
                                                        ? "bg-price-down/15 text-price-down"
                                                        : "bg-accent/15 text-accent"
                                            }`}>
                                                {(entry.liveStatus === "RUNNING" || entry.liveStatus === "PENDING" || entry.liveStatus === "QUEUED") ? (
                                                    <Loader2 className="h-3 w-3 animate-spin" />
                                                ) : null}
                                                {entry.liveStatus}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                                {allBatchComplete && (
                                    <div className="mt-3 rounded-xl border border-price-up/20 bg-price-up/10 px-3 py-2 text-xs font-bold text-price-up">
                                        All batch runs have finished.
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="rounded-2xl border border-dashed border-border-muted bg-bg-primary/50 p-4 text-sm text-text-secondary">
                                Submit a batch to see progress here. Each variant runs asynchronously and results are compared once all complete.
                            </div>
                        )}

                        {/* Comparison results */}
                        {allBatchComplete && comparisonData.size > 0 ? (
                            <div className="rounded-2xl border border-border-muted bg-bg-tertiary/45 p-4">
                                <div className="flex items-center justify-between">
                                    <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-accent">Comparison Results</div>
                                    <button
                                        onClick={handleRefreshComparison}
                                        disabled={isComparisonLoading}
                                        className="inline-flex items-center gap-1.5 rounded-full border border-border-muted bg-bg-tertiary px-3 py-1.5 text-xs font-bold text-text-primary"
                                    >
                                        <RefreshCw className={`h-3 w-3 ${isComparisonLoading ? "animate-spin" : ""}`} />
                                        Refresh
                                    </button>
                                </div>

                                {/* Batch summary */}
                                {(() => {
                                    const completedCount = batchRunStatuses.filter((r) => r.liveStatus === "COMPLETED").length;
                                    const failedCount = batchRunStatuses.filter((r) => r.liveStatus === "FAILED").length;
                                    const allMetrics = batchRunStatuses
                                        .filter((r) => r.liveStatus === "COMPLETED")
                                        .map((r) => ({ label: r.label, metrics: getMetrics(r.backtestRunId) }))
                                        .filter((m): m is { label: string; metrics: BatchComparisonMetrics } => m.metrics !== null);
                                    const bestByNetR = allMetrics.length > 0
                                        ? allMetrics.reduce((best, curr) => curr.metrics.netR > best.metrics.netR ? curr : best)
                                        : null;
                                    return (
                                        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                                            <span className="text-text-muted">{completedCount} completed{failedCount > 0 ? `, ${failedCount} failed` : ""}</span>
                                            {bestByNetR && (
                                                <span className="inline-flex items-center gap-1 rounded-full border border-price-up/30 bg-price-up/10 px-2 py-0.5 text-[10px] font-bold text-price-up">
                                                    Best: {bestByNetR.label} ({bestByNetR.metrics.netR.toFixed(1)}R)
                                                </span>
                                            )}
                                        </div>
                                    );
                                })()}

                                {/* Comparison table */}
                                <div className="mt-4 overflow-hidden rounded-2xl border border-border-muted">
                                    <div className="grid grid-cols-[1.5fr_0.7fr_0.7fr_0.7fr_0.7fr_0.7fr_0.7fr] gap-2 bg-bg-tertiary/60 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-text-muted">
                                        <div>Variant</div>
                                        <div>Trades</div>
                                        <div>Win Rate</div>
                                        <div>Net R</div>
                                        <div>PF</div>
                                        <div>Expect.</div>
                                        <div>Max DD</div>
                                    </div>
                                    <div className="divide-y divide-border-muted bg-bg-primary/70">
                                        {batchRunStatuses.map((entry) => {
                                            const metrics = getMetrics(entry.backtestRunId);
                                            if (entry.liveStatus === "FAILED") {
                                                return (
                                                    <div key={entry.backtestRunId} className="grid grid-cols-[1.5fr_1fr] gap-2 px-3 py-3 text-sm">
                                                        <div className="font-bold text-text-primary">{entry.label}</div>
                                                        <div className="text-price-down text-xs font-bold">FAILED</div>
                                                    </div>
                                                );
                                            }
                                            if (!metrics) return null;
                                            return (
                                                <div
                                                    key={entry.backtestRunId}
                                                    className="grid grid-cols-[1.5fr_0.7fr_0.7fr_0.7fr_0.7fr_0.7fr_0.7fr] gap-2 px-3 py-3 text-sm"
                                                >
                                                    <div>
                                                        <div className="font-bold text-text-primary">{entry.label}</div>
                                                        <div className="mt-0.5 text-[10px] text-text-muted font-mono">{entry.backtestRunId.slice(0, 12)}...</div>
                                                    </div>
                                                    <div className="text-text-primary font-medium">{metrics.totalTrades}</div>
                                                    <div className={metrics.winRate >= 50 ? "text-price-up font-medium" : "text-price-down font-medium"}>{metrics.winRate.toFixed(1)}%</div>
                                                    <div className={metrics.netR >= 0 ? "text-price-up font-medium" : "text-price-down font-medium"}>{formatSigned(metrics.netR, "R")}</div>
                                                    <div className={metrics.profitFactor >= 1 ? "text-price-up font-medium" : "text-price-down font-medium"}>{metrics.profitFactor.toFixed(2)}</div>
                                                    <div className={metrics.expectancy >= 0 ? "text-price-up font-medium" : "text-price-down font-medium"}>{metrics.expectancy.toFixed(2)}R</div>
                                                    <div className={metrics.maxDrawdownPct > -10 ? "text-text-primary font-medium" : "text-price-down font-medium"}>{metrics.maxDrawdownPct.toFixed(1)}%</div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Links for each run */}
                                <div className="mt-4 grid gap-2">
                                    {batchRunStatuses.filter((r) => r.liveStatus === "COMPLETED").map((entry) => (
                                        <div key={entry.backtestRunId} className="flex items-center justify-between rounded-xl border border-border-muted bg-bg-primary/60 px-3 py-2">
                                            <span className="text-sm font-bold text-text-primary">{entry.label}</span>
                                            <div className="flex gap-2">
                                                <Link
                                                    href={`/signals/backtests/${entry.backtestRunId}`}
                                                    className="inline-flex items-center gap-1.5 rounded-full border border-border-muted bg-bg-tertiary px-3 py-1.5 text-xs font-bold text-text-primary"
                                                >
                                                    Trade History
                                                    <ArrowRight className="h-3 w-3" />
                                                </Link>
                                                <Link
                                                    href={`/engine?run=${entry.backtestRunId}`}
                                                    className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-black text-bg-secondary"
                                                >
                                                    Engine
                                                    <ArrowRight className="h-3 w-3" />
                                                </Link>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : isComparisonLoading ? (
                            <div className="grid min-h-[120px] place-items-center rounded-2xl border border-border-muted bg-bg-tertiary/35">
                                <Loader2 className="h-6 w-6 animate-spin text-accent" />
                            </div>
                        ) : null}
                    </div>
                </div>
            </SectionCard>
        </div>
    );
}
