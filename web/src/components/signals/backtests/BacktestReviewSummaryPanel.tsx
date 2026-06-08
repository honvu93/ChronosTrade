"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, BarChart3, CandlestickChart, ShieldAlert, ToggleLeft, ToggleRight } from "lucide-react";
import { BacktestTradeSummary } from "@/types/backtests";
import { EngineOverview } from "@/types/engine";
import { GeneratedBacktestDetail } from "@/types/signals";
import { buildBacktestValidationView } from "@/lib/backtestValidationView";
import { BacktestDataQualityViewModel } from "@/lib/backtestDataQualityView";
import BacktestConfidenceChangeCard from "@/components/signals/backtests/BacktestConfidenceChangeCard";
import { buildBacktestConfidenceChangeView } from "@/lib/backtestConfidenceChangeView";
import MetricCard from "@/components/ui/MetricCard";
import StateBanner from "@/components/ui/StateBanner";

const formatSigned = (value: number, suffix = "") => `${value >= 0 ? "+" : ""}${value.toFixed(2)}${suffix}`;
const formatNumber = (value: number | null | undefined, digits = 2) => (
    typeof value === "number"
        ? value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })
        : "n/a"
);
const formatPercent = (value: number | null | undefined, digits = 2) => (
    typeof value === "number" ? `${value.toFixed(digits)}%` : "n/a"
);
const formatDateInput = (value: string | null | undefined) => (value ? value.slice(0, 10) : "n/a");

function ContextLine({
    label,
    value,
}: {
    label: string;
    value: string;
}) {
    return (
        <div className="rounded-2xl border border-border-muted bg-bg-tertiary/35 px-4 py-3">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-text-muted">{label}</div>
            <div className="mt-2 text-sm font-bold text-text-primary">{value}</div>
        </div>
    );
}

const toneStyles = {
    positive: {
        badge: "border-price-up/25 bg-price-up/10 text-price-up",
        panel: "border-price-up/15 bg-[linear-gradient(180deg,rgba(12,18,26,0.96),rgba(6,10,16,0.98))]",
    },
    neutral: {
        badge: "border-accent/25 bg-accent/10 text-accent",
        panel: "border-border-muted bg-[linear-gradient(180deg,rgba(12,18,26,0.96),rgba(6,10,16,0.98))]",
    },
    caution: {
        badge: "border-amber-400/25 bg-amber-400/10 text-amber-300",
        panel: "border-amber-400/20 bg-[linear-gradient(180deg,rgba(24,18,8,0.96),rgba(9,10,16,0.98))]",
    },
    blocked: {
        badge: "border-price-down/25 bg-price-down/10 text-price-down",
        panel: "border-price-down/20 bg-[linear-gradient(180deg,rgba(28,10,12,0.96),rgba(9,10,16,0.98))]",
    },
    progress: {
        badge: "border-blue-400/25 bg-blue-400/10 text-blue-300",
        panel: "border-blue-400/20 bg-[linear-gradient(180deg,rgba(10,16,26,0.96),rgba(6,10,16,0.98))]",
    },
} as const;

const dataQualityStyles = {
    caution: "border-amber-400/25 bg-amber-400/10 text-amber-100",
    blocked: "border-price-down/25 bg-price-down/10 text-rose-100",
} as const;

export default function BacktestReviewSummaryPanel({
    runId,
    runDetail,
    tradeSummary,
    overview,
    dataQuality,
    onInspectTrades,
    onInspectComparison,
    show1to1R: externalShow1to1R,
    onToggle1to1R,
}: {
    runId: string;
    runDetail: GeneratedBacktestDetail | null;
    tradeSummary: BacktestTradeSummary | null;
    overview: EngineOverview | null;
    dataQuality: BacktestDataQualityViewModel;
    onInspectTrades: () => void;
    onInspectComparison: () => void;
    show1to1R?: boolean;
    onToggle1to1R?: () => void;
}) {
    const validation = buildBacktestValidationView({ runDetail, tradeSummary, overview });
    const confidenceChange = buildBacktestConfidenceChangeView({
        runDetail,
        tradeSummary,
        overview,
        validation,
        dataQuality,
    });
    const hasDataQualityRisk = dataQuality.state === "caution" || dataQuality.state === "blocked";
    const effectiveTone = hasDataQualityRisk && validation.tone === "positive"
        ? "caution"
        : validation.tone;
    const effectiveStateLabel = hasDataQualityRisk && validation.tone === "positive"
        ? "Needs Caution"
        : validation.stateLabel;
    const styles = toneStyles[effectiveTone];
    const watchouts = Array.from(
        new Set([
            ...dataQuality.warnings,
            ...validation.warningFactors,
        ]),
    );
    const [localShow1to1R, setLocalShow1to1R] = useState(false);
    const show1to1R = externalShow1to1R ?? localShow1to1R;

    const totalTrades = tradeSummary?.totalTrades ?? overview?.metrics.totalTrades ?? runDetail?.counts.results ?? 0;
    const wins = tradeSummary?.wins ?? overview?.metrics.wins ?? 0;
    const losses = tradeSummary?.losses ?? overview?.metrics.losses ?? 0;
    const closedTrades = tradeSummary?.closedTrades ?? overview?.metrics.closedTrades ?? (wins + losses);

    // Actual metrics
    const actualWinRate = overview?.metrics.winRate ?? tradeSummary?.winRate ?? 0;
    const actualNetR = overview?.metrics.netR ?? tradeSummary?.netR ?? 0;
    const actualNetUsd = overview?.metrics.netUsd;
    const actualExpectancy = overview?.metrics.expectancy;
    const actualProfitFactor = overview?.metrics.profitFactor;
    const actualMaxDrawdownPct = overview?.metrics.maxDrawdownPct;
    const signalCount = overview?.metrics.signalCount ?? runDetail?.counts.signals ?? 0;

    // 1:1 R metrics — every win = +1R, every loss = -1R
    const netR_1to1 = wins - losses;
    const expectancy_1to1 = closedTrades > 0 ? netR_1to1 / closedTrades : 0;
    const profitFactor_1to1 = losses > 0 ? wins / losses : null;
    // Estimate USD: avgRiskUsd = actualNetUsd / actualNetR (if both available)
    const avgRiskUsd = (typeof actualNetUsd === "number" && actualNetR !== 0)
        ? Math.abs(actualNetUsd / actualNetR)
        : null;
    const netUsd_1to1 = avgRiskUsd !== null ? netR_1to1 * avgRiskUsd : null;

    // Select which metrics to show
    const winRate = actualWinRate;
    const netR = show1to1R ? netR_1to1 : actualNetR;
    const netUsd = show1to1R ? netUsd_1to1 : actualNetUsd;
    const expectancy = show1to1R ? expectancy_1to1 : actualExpectancy;
    const profitFactor = show1to1R ? profitFactor_1to1 : actualProfitFactor;
    const maxDrawdownPct = actualMaxDrawdownPct;
    const summaryAction = validation.recommendedAction === "review-trades"
        ? (
            <button
                type="button"
                onClick={onInspectTrades}
                className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-black text-bg-secondary"
            >
                {validation.recommendedActionLabel}
                <ArrowRight className="h-4 w-4" />
            </button>
        )
        : (
            <Link
                href="/signals"
                className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-black text-bg-secondary"
            >
                {validation.recommendedActionLabel}
                <ArrowRight className="h-4 w-4" />
            </Link>
        );

    return (
        <section className="grid gap-4 xl:grid-cols-[1.2fr_0.9fr]">
            <div className="rounded-3xl border border-border-muted bg-bg-primary/90 p-5 shadow-[0_24px_70px_rgba(0,0,0,0.28)]">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.26em] text-accent">
                            <CandlestickChart className="h-4 w-4" />
                            Summary Review
                        </div>
                        <h2 className="mt-2 text-2xl font-black tracking-tight text-text-primary">
                            {runDetail?.name || "Generated run summary"}
                        </h2>
                        <p className="mt-1 text-sm text-text-secondary">
                            One review surface for run context, aggregate performance, and the next safe validation step.
                        </p>
                    </div>
                    <span className={`inline-flex w-fit items-center rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${styles.badge}`}>
                        {effectiveStateLabel}
                    </span>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <ContextLine
                        label="Signal Context"
                        value={runDetail ? `${runDetail.signalCode}@${runDetail.signalVersion}` : "Loading"}
                    />
                    <ContextLine
                        label="Market Context"
                        value={runDetail ? `${runDetail.symbol} | ${runDetail.timeframe}` : "Loading"}
                    />
                    <ContextLine
                        label="Run Window"
                        value={runDetail ? `${formatDateInput(runDetail.startedAt)} to ${formatDateInput(runDetail.finishedAt)}` : "Loading"}
                    />
                    <ContextLine
                        label="Run ID"
                        value={runDetail?.id || runId}
                    />
                </div>

                <div className="mt-4 flex items-center justify-between">
                    <button
                        type="button"
                        onClick={onToggle1to1R ?? (() => setLocalShow1to1R(!localShow1to1R))}
                        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] transition-colors ${
                            show1to1R
                                ? "border-accent/40 bg-accent/15 text-accent"
                                : "border-border-muted bg-bg-tertiary/40 text-text-muted hover:text-text-secondary"
                        }`}
                    >
                        {show1to1R ? <ToggleRight className="h-3.5 w-3.5" /> : <ToggleLeft className="h-3.5 w-3.5" />}
                        {show1to1R ? "1:1 R Mode ON" : "1:1 R Mode"}
                    </button>
                    {show1to1R && (
                        <span className="text-[10px] font-medium text-accent/70">
                            Win=+1R, Loss=-1R — baseline signal quality
                        </span>
                    )}
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <MetricCard label="Signals" value={String(signalCount)} hint="Generated signals tied to this run" />
                    <MetricCard label="Trades" value={String(totalTrades)} hint={`${wins}W / ${losses}L / ${closedTrades} closed`} />
                    <MetricCard label="Win Rate" value={formatPercent(winRate)} accent="text-price-up" />
                    <MetricCard label={show1to1R ? "Net R (1:1)" : "Net R"} value={formatSigned(netR, "R")} accent={netR >= 0 ? "text-price-up" : "text-price-down"} />
                    <MetricCard label={show1to1R ? "Net USD (est.)" : "Net USD"} value={typeof netUsd === "number" ? formatSigned(netUsd, "") : "n/a"} accent={typeof netUsd === "number" && netUsd >= 0 ? "text-price-up" : "text-price-down"} />
                    <MetricCard label={show1to1R ? "Expectancy (1:1)" : "Expectancy"} value={typeof expectancy === "number" ? formatSigned(expectancy, "R") : "n/a"} />
                    <MetricCard label={show1to1R ? "PF (1:1)" : "Profit Factor"} value={formatNumber(profitFactor)} />
                    <MetricCard label="Max DD" value={typeof maxDrawdownPct === "number" ? `${maxDrawdownPct.toFixed(2)}%` : "n/a"} accent={typeof maxDrawdownPct === "number" && maxDrawdownPct <= -10 ? "text-amber-300" : "text-text-primary"} />
                </div>
            </div>

            <aside className={`rounded-3xl border p-5 shadow-[0_24px_70px_rgba(0,0,0,0.28)] ${styles.panel}`}>
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.26em] text-accent">
                    <ShieldAlert className="h-4 w-4" />
                    Validation View
                </div>
                <h2 className="mt-3 text-xl font-black text-text-primary">{validation.heading}</h2>
                <p className="mt-2 text-sm text-text-secondary">{validation.summary}</p>

                {dataQuality.state === "caution" || dataQuality.state === "blocked" ? (
                    <StateBanner
                        tone={dataQuality.state === "blocked" ? "danger" : "caution"}
                        className={`mt-4 ${dataQualityStyles[dataQuality.state]}`}
                        title="Data Quality Warning"
                        message={(
                            <>
                                <div className="text-base font-bold text-current">{dataQuality.heading}</div>
                                <div className="mt-1 text-sm text-current">{dataQuality.summary}</div>
                            </>
                        )}
                    />
                ) : null}

                <BacktestConfidenceChangeCard
                    runId={runId}
                    view={confidenceChange}
                    onInspectComparison={onInspectComparison}
                />

                <div className="mt-4 rounded-2xl border border-border-muted bg-bg-secondary/65 px-4 py-3 text-sm text-text-secondary">
                    <div className="font-bold text-text-primary">Next safe action</div>
                    <div className="mt-1">{validation.recommendedActionDescription}</div>
                </div>

                <div className="mt-4 rounded-2xl border border-border-muted bg-bg-secondary/45 px-4 py-3 text-sm text-amber-100/90">
                    {validation.researchNote}
                </div>

                <div className="mt-4 space-y-4">
                    <div>
                        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-text-muted">
                            <BarChart3 className="h-4 w-4" />
                            Evidence Drivers
                        </div>
                        <ul className="mt-3 space-y-2 text-sm text-text-secondary">
                            {validation.evidenceDrivers.map((item) => (
                                <li key={item} className="rounded-2xl border border-border-muted bg-bg-secondary/40 px-3 py-2">
                                    {item}
                                </li>
                            ))}
                        </ul>
                    </div>

                    <div>
                        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-text-muted">
                            <ShieldAlert className="h-4 w-4" />
                            Watchouts
                        </div>
                        {watchouts.length > 0 ? (
                            <ul className="mt-3 space-y-2 text-sm text-text-secondary">
                                {watchouts.map((item) => (
                                    <li key={item} className="rounded-2xl border border-border-muted bg-bg-secondary/40 px-3 py-2">
                                        {item}
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <div className="mt-3 rounded-2xl border border-border-muted bg-bg-secondary/40 px-3 py-2 text-sm text-text-secondary">
                                No immediate aggregate warning flags surfaced here, but the trade ledger still comes next.
                            </div>
                        )}
                    </div>
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                    {summaryAction}
                    <Link
                        href={`/reports?backtestRunId=${runId}`}
                        className="inline-flex items-center gap-2 rounded-full border border-border-muted bg-bg-secondary/70 px-4 py-2 text-sm font-bold text-text-primary"
                    >
                        Open Reports
                        <ArrowRight className="h-4 w-4" />
                    </Link>
                    <Link
                        href={`/engine?run=${runId}`}
                        className="inline-flex items-center gap-2 rounded-full border border-border-muted bg-bg-secondary/70 px-4 py-2 text-sm font-bold text-text-primary"
                    >
                        Open In Engine
                        <ArrowRight className="h-4 w-4" />
                    </Link>
                </div>
            </aside>
        </section>
    );
}
