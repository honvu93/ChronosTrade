"use client";

import Link from "next/link";
import { ArrowRight, GitCompareArrows, Layers3, Loader2 } from "lucide-react";
import { EngineOverview } from "@/types/engine";
import { GeneratedBacktestDetail, GeneratedBacktestRun } from "@/types/signals";
import { buildBacktestRunComparisonEntries } from "@/lib/backtestRunComparison";

const evidenceTone = {
    baseline: "border-accent/25 bg-accent/10 text-accent",
    constructive: "border-price-up/25 bg-price-up/10 text-price-up",
    weaker: "border-amber-400/25 bg-amber-400/10 text-amber-300",
    suspicious: "border-price-down/25 bg-price-down/10 text-price-down",
} as const;

const metricTone = {
    positive: "text-price-up",
    negative: "text-price-down",
    neutral: "text-text-primary",
} as const;

export default function BacktestRunComparisonPanel({
    currentRun,
    currentOverview,
    availableRuns,
    selectedRunIds,
    comparedRuns,
    isLoading,
    error,
    onToggleRun,
    onClear,
}: {
    currentRun: GeneratedBacktestDetail | null;
    currentOverview: EngineOverview | null;
    availableRuns: GeneratedBacktestRun[];
    selectedRunIds: string[];
    comparedRuns: Array<{
        run: GeneratedBacktestDetail;
        overview: EngineOverview | null;
    }>;
    isLoading: boolean;
    error: string | null;
    onToggleRun: (runId: string) => void;
    onClear: () => void;
}) {
    const comparisonEntries = buildBacktestRunComparisonEntries({
        baselineRun: currentRun,
        baselineOverview: currentOverview,
        comparedRuns,
    });

    return (
        <section id="run-comparison" className="rounded-3xl border border-border-muted bg-bg-primary/90 p-4 shadow-[0_24px_70px_rgba(0,0,0,0.28)]">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div>
                    <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.26em] text-accent">
                        <GitCompareArrows className="h-4 w-4" />
                        Run Comparison
                    </div>
                    <h2 className="mt-2 text-xl font-black text-text-primary">Compare runs within one validation workflow</h2>
                    <p className="mt-1 max-w-3xl text-sm text-text-secondary">
                        Select peer runs for the same signal to inspect robustness across windows, conditions, and configuration differences without leaving the current backtest review.
                    </p>
                </div>

                {selectedRunIds.length > 0 ? (
                    <button
                        type="button"
                        onClick={onClear}
                        className="inline-flex items-center gap-2 rounded-full border border-border-muted bg-bg-tertiary px-4 py-2 text-sm font-bold text-text-primary"
                    >
                        Clear Compare
                    </button>
                ) : null}
            </div>

            <div className="mt-4 rounded-2xl border border-border-muted bg-bg-tertiary/35 p-4">
                <div className="flex items-center gap-2 text-sm font-bold text-text-primary">
                    <Layers3 className="h-4 w-4 text-accent" />
                    Compare Runs
                </div>

                {availableRuns.length === 0 ? (
                    <div className="mt-3 text-sm text-text-secondary">
                        No additional runs for this signal are available yet. Run more backtests to unlock comparison.
                    </div>
                ) : (
                    <div className="mt-3 grid gap-3 xl:grid-cols-2">
                        {availableRuns.map((run) => {
                            const selected = selectedRunIds.includes(run.id);

                            return (
                                <div key={run.id} className={`rounded-2xl border px-4 py-3 ${selected ? "border-accent/40 bg-accent/8" : "border-border-muted bg-bg-secondary/40"}`}>
                                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                        <div>
                                            <div className="text-sm font-bold text-text-primary">{run.name}</div>
                                            <div className="mt-1 text-xs text-text-muted">
                                                {run.signalCode}@{run.signalVersion} | {run.symbol} | {run.timeframe}
                                            </div>
                                            <div className="mt-1 text-xs text-text-muted">Run ID: {run.id}</div>
                                        </div>

                                        <button
                                            type="button"
                                            onClick={() => onToggleRun(run.id)}
                                            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold ${selected ? "bg-accent text-bg-secondary" : "border border-border-muted bg-bg-tertiary text-text-primary"}`}
                                        >
                                            {selected ? "Comparing" : "Compare Run"}
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {error ? (
                <div className="mt-4 rounded-2xl border border-price-down/20 bg-price-down/10 px-4 py-3 text-sm text-price-down">
                    {error}
                </div>
            ) : null}

            {isLoading ? (
                <div className="mt-4 grid min-h-[180px] place-items-center rounded-2xl border border-border-muted bg-bg-tertiary/35">
                    <Loader2 className="h-8 w-8 animate-spin text-accent" />
                </div>
            ) : comparisonEntries.length <= 1 ? (
                <div className="mt-4 rounded-2xl border border-dashed border-border-muted bg-bg-secondary/30 px-4 py-6 text-sm text-text-secondary">
                    Select one or more peer runs to compare them against the current baseline across multiple evidence signals, not just one headline number.
                </div>
            ) : (
                <div className="mt-4 grid gap-4 xl:grid-cols-2">
                    {comparisonEntries.map((entry, index) => (
                        <article key={entry.runId} className="rounded-2xl border border-border-muted bg-bg-secondary/35 p-4">
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                <div>
                                    <div className="text-lg font-black text-text-primary">{entry.runName}</div>
                                    <div className="mt-1 text-sm text-text-secondary">{entry.signalLabel}</div>
                                    <div className="mt-1 text-xs text-text-muted">{entry.contextLabel}</div>
                                    <div className="mt-1 text-xs text-text-muted">Run ID: {entry.runId}</div>
                                </div>

                                <div className="flex items-center gap-2">
                                    <span className={`inline-flex w-fit items-center rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${evidenceTone[entry.evidenceState]}`}>
                                        {entry.evidenceLabel}
                                    </span>
                                    {entry.exitProfileCode && (
                                        <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/5 px-2 py-0.5 text-[10px] font-bold text-amber-400">
                                            {entry.exitProfileCode}
                                        </span>
                                    )}
                                    <span className="text-[10px] font-mono text-text-muted">
                                        Score: {(entry.compositeScore * 100).toFixed(0)}
                                    </span>
                                </div>
                            </div>

                            <div className="mt-4 grid gap-3 md:grid-cols-2">
                                <div className="rounded-2xl border border-border-muted bg-bg-primary/60 px-4 py-3 text-sm text-text-secondary">
                                    <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-text-muted">Execution</div>
                                    <div className="mt-2 text-sm font-medium text-text-primary">{entry.executionSummary}</div>
                                </div>
                                <div className="rounded-2xl border border-border-muted bg-bg-primary/60 px-4 py-3 text-sm text-text-secondary">
                                    <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-text-muted">Parameters</div>
                                    <div className="mt-2 text-sm font-medium text-text-primary">{entry.parameterSummary}</div>
                                </div>
                            </div>

                            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
                                {entry.metrics.map((metric) => (
                                    <div key={`${entry.runId}-${metric.label}`} className="rounded-2xl border border-border-muted bg-bg-primary/60 px-4 py-3">
                                        <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-text-muted">{metric.label}</div>
                                        <div className={`mt-2 text-lg font-black ${metricTone[metric.tone]}`}>{metric.value}</div>
                                        {metric.delta ? <div className="mt-1 text-xs text-text-secondary">{metric.delta}</div> : null}
                                    </div>
                                ))}
                            </div>

                            <div className="mt-4 rounded-2xl border border-border-muted bg-bg-primary/60 px-4 py-3">
                                <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-text-muted">Comparison Notes</div>
                                {entry.warnings.length > 0 ? (
                                    <ul className="mt-2 space-y-2 text-sm text-text-secondary">
                                        {entry.warnings.map((item) => (
                                            <li key={`${entry.runId}-${item}`}>{item}</li>
                                        ))}
                                    </ul>
                                ) : (
                                    <div className="mt-2 text-sm text-text-secondary">
                                        {index === 0 ? "Current baseline run for comparison." : "No major warning factors surfaced in this compared run."}
                                    </div>
                                )}
                            </div>

                            <div className="mt-4 flex flex-wrap gap-2">
                                <Link
                                    href={`/signals/backtests/${entry.runId}`}
                                    className="inline-flex items-center gap-2 rounded-full border border-border-muted bg-bg-tertiary px-4 py-2 text-sm font-bold text-text-primary"
                                >
                                    Open Run
                                    <ArrowRight className="h-4 w-4" />
                                </Link>
                                <Link
                                    href={`/reports?backtestRunId=${entry.runId}`}
                                    className="inline-flex items-center gap-2 rounded-full border border-border-muted bg-bg-tertiary px-4 py-2 text-sm font-bold text-text-primary"
                                >
                                    Open Reports
                                    <ArrowRight className="h-4 w-4" />
                                </Link>
                            </div>
                        </article>
                    ))}
                </div>
            )}
        </section>
    );
}
