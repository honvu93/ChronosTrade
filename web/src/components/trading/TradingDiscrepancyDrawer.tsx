"use client";

import { useEffect } from "react";
import Link from "next/link";
import {
    Activity,
    ArrowUpRight,
    FileJson,
    GitCompareArrows,
    Layers3,
    Loader2,
    Radar,
    X,
} from "lucide-react";
import { buildTradingDiscrepancyView } from "@/lib/tradingDiscrepancyView";
import {
    SignalVersionOriginContext,
    TradingDiagnosisRequestParams,
    TradingDiscrepancySnapshot,
} from "@/types/trading";
import { useTradeHistoryAuditRecordDetail } from "@/hooks/useTradeHistoryAuditRecordDetail";
import TradingIncidentInvestigationRail from "@/components/trading/TradingIncidentInvestigationRail";
import TradingExecutionRecordRail from "@/components/trading/TradingExecutionRecordRail";
import FactCard from "@/components/ui/FactCard";

type Tone = "danger" | "success" | "accent" | "neutral";

const toneStyles: Record<Tone, string> = {
    danger: "border-price-down/20 bg-price-down/8 text-price-down",
    success: "border-price-up/20 bg-price-up/8 text-price-up",
    accent: "border-accent/20 bg-accent/8 text-accent",
    neutral: "border-border-muted bg-bg-tertiary text-text-secondary",
};

export default function TradingDiscrepancyDrawer({
    isOpen,
    snapshot,
    isLoading,
    error,
    originContext,
    requestParams,
    onClose,
}: {
    isOpen: boolean;
    snapshot: TradingDiscrepancySnapshot | null;
    isLoading: boolean;
    error: string | null;
    originContext: SignalVersionOriginContext | null;
    requestParams: TradingDiagnosisRequestParams | null;
    onClose: () => void;
}) {
    const {
        status: executionRecordStatus,
        detail: executionRecordDetail,
        error: executionRecordError,
        activeRecordId: activeExecutionRecordId,
        inspect: inspectExecutionRecordRaw,
        clear: clearExecutionRecord,
    } = useTradeHistoryAuditRecordDetail();

    const inspectExecutionRecord = async (recordId: string) => {
        await inspectExecutionRecordRaw(recordId);
        requestAnimationFrame(() => {
            document.getElementById("trading-discrepancy-execution-records")?.scrollIntoView({
                behavior: "smooth",
                block: "start",
            });
        });
    };

    useEffect(() => {
        if (
            !isOpen
            || !requestParams?.tradeRecordId
            || (activeExecutionRecordId && requestParams.tradeRecordId !== activeExecutionRecordId)
        ) {
            clearExecutionRecord();
        }
    }, [activeExecutionRecordId, clearExecutionRecord, isOpen, requestParams?.tradeRecordId]);

    if (!isOpen) return null;

    const view = snapshot ? buildTradingDiscrepancyView(snapshot) : null;

    return (
        <div
            role="dialog"
            aria-labelledby="trading-discrepancy-title"
            aria-modal="false"
            className="fixed inset-y-0 right-0 z-[95] flex w-full max-w-[560px] flex-col border-l border-border-muted bg-bg-secondary shadow-[0_0_60px_rgba(0,0,0,0.45)]"
        >
            <div className="flex items-start justify-between gap-3 border-b border-border-muted bg-bg-primary px-5 py-4">
                <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-accent">
                        Discrepancy Investigation
                    </div>
                    <h2 id="trading-discrepancy-title" className="mt-2 text-lg font-black text-text-primary">
                        {view?.header.title ?? "Backtest vs Live Investigation"}
                    </h2>
                    <div className="mt-1 text-xs text-text-muted">
                        {view?.header.signalKey ?? "Loading signal linkage"}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-text-secondary">
                        <span className="rounded-full border border-border-muted bg-bg-secondary px-2.5 py-1 font-black uppercase tracking-[0.16em]">
                            {view?.header.investigationLabel ?? "Investigation"}
                        </span>
                        {originContext ? (
                            <span className="rounded-full border border-border-muted bg-bg-secondary px-2.5 py-1 font-bold">
                                {originContext.label}
                            </span>
                        ) : null}
                    </div>
                    {originContext?.detail ? (
                        <div className="mt-2 text-xs text-text-muted">{originContext.detail}</div>
                    ) : null}
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    className="rounded-full border border-border-muted bg-bg-secondary p-2 text-text-muted transition-colors hover:text-text-primary"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
                {isLoading && !view ? (
                    <div className="flex items-center gap-2 rounded-2xl border border-border-muted bg-bg-primary/70 px-4 py-3 text-sm text-text-secondary">
                        <Loader2 className="h-4 w-4 animate-spin text-accent" />
                        Loading discrepancy context...
                    </div>
                ) : null}

                {error && !view ? (
                    <div className="rounded-2xl border border-price-down/20 bg-price-down/10 px-4 py-3 text-sm text-price-down">
                        {error}
                    </div>
                ) : null}

                {view ? (
                    <>
                        <section
                            id="trading-discrepancy-differences"
                            className="rounded-2xl border border-border-muted bg-bg-primary/70 p-4"
                        >
                            <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-text-muted">
                                    <Layers3 className="h-4 w-4" />
                                    Linked Records
                                </div>
                                {view.reportLink.href ? (
                                    <Link
                                        href={view.reportLink.href}
                                        className="inline-flex items-center gap-1 rounded-full border border-border-muted bg-bg-secondary px-3 py-1.5 text-xs font-bold text-text-primary transition-colors hover:border-accent hover:text-accent"
                                    >
                                        {view.reportLink.label}
                                        <ArrowUpRight className="h-3.5 w-3.5" />
                                    </Link>
                                ) : null}
                            </div>
                            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                {view.linkedRecordFacts.map((fact) => (
                                    <FactCard key={fact.label} label={fact.label} value={fact.value} tone={fact.tone} />
                                ))}
                            </div>
                        </section>

                        <TradingIncidentInvestigationRail
                            key={requestParams
                                ? `${requestParams.code}:${requestParams.version}:${requestParams.backtestRunId ?? ""}:${requestParams.indicatorInstanceId ?? ""}:${requestParams.tradeRecordId ?? ""}`
                                : "investigation-empty"}
                            isOpen={isOpen}
                            requestParams={requestParams}
                            onInspectTradeRecord={(recordId) => { void inspectExecutionRecord(recordId); }}
                        />

                        <TradingExecutionRecordRail
                            recordId={requestParams?.tradeRecordId ?? snapshot?.linkedRecords.tradeRecordId ?? null}
                            detail={executionRecordDetail}
                            isLoading={executionRecordStatus === "loading"}
                            error={executionRecordError}
                            onInspect={(recordId) => { void inspectExecutionRecord(recordId); }}
                        />

                        <section
                            id="trading-discrepancy-backtest"
                            className="rounded-2xl border border-border-muted bg-bg-primary/70 p-4"
                        >
                            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-text-muted">
                                <GitCompareArrows className="h-4 w-4" />
                                Key Differences
                            </div>
                            {view.differenceCards.length === 0 ? (
                                <div className="mt-4 rounded-2xl border border-price-up/20 bg-price-up/8 px-4 py-3 text-sm text-price-up">
                                    No major discrepancy markers were detected from the linked records.
                                </div>
                            ) : (
                                <div className="mt-4 space-y-3">
                                    {view.differenceCards.map((difference) => (
                                        <article key={difference.code} className="rounded-2xl border border-border-muted bg-bg-secondary/70 p-4">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${toneStyles[difference.severityTone]}`}>
                                                    {difference.severityLabel}
                                                </span>
                                                <div className="text-sm font-black text-text-primary">{difference.title}</div>
                                            </div>
                                            <div className="mt-2 text-xs leading-5 text-text-secondary">{difference.detail}</div>
                                            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                                <FactCard label="Backtest" value={difference.backtestValue ?? "n/a"} />
                                                <FactCard label="Live" value={difference.liveValue ?? "n/a"} />
                                            </div>
                                        </article>
                                    ))}
                                </div>
                            )}
                        </section>

                        <section
                            id="trading-discrepancy-live"
                            className="rounded-2xl border border-border-muted bg-bg-primary/70 p-4"
                        >
                            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-text-muted">
                                <Activity className="h-4 w-4" />
                                Backtest Evidence
                            </div>
                            <div className="mt-2 text-sm font-black text-text-primary">{view.backtest.title}</div>
                            <div className="mt-1 text-xs text-text-secondary">{view.backtest.summaryLine}</div>
                            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                <FactCard label="Trade Issue" value={view.backtest.tradeIssueLabel} />
                                {view.backtest.reportSummaryFacts.map((fact) => (
                                    <FactCard key={fact.label} label={fact.label} value={fact.value} tone={fact.tone} />
                                ))}
                            </div>
                            {view.backtest.signalReviewFacts.length > 0 ? (
                                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                    {view.backtest.signalReviewFacts.map((fact) => (
                                        <FactCard key={fact.label} label={fact.label} value={fact.value} tone={fact.tone} />
                                    ))}
                                </div>
                            ) : null}
                        </section>

                        <section className="rounded-2xl border border-border-muted bg-bg-primary/70 p-4">
                            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-text-muted">
                                <Radar className="h-4 w-4" />
                                Live Execution Context
                            </div>
                            <div className="mt-2 text-sm font-black text-text-primary">{view.live.primaryDeploymentLabel}</div>
                            <div className="mt-1 text-xs text-text-secondary">{view.live.summaryLine}</div>
                            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                <FactCard label="Timeline" value={view.live.timelineLabel} />
                                {view.live.deploymentFacts.map((fact) => (
                                    <FactCard key={fact.label} label={fact.label} value={fact.value} tone={fact.tone} />
                                ))}
                            </div>
                            {view.live.recentTimeline.length > 0 ? (
                                <div className="mt-4 space-y-3">
                                    {view.live.recentTimeline.map((item) => (
                                        <article key={item.id} className="rounded-2xl border border-border-muted bg-bg-secondary/70 p-4">
                                            <div className="flex items-start justify-between gap-3">
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${toneStyles[item.kindTone]}`}>
                                                            {item.kindLabel}
                                                        </span>
                                                        <div className="text-sm font-black text-text-primary">{item.title}</div>
                                                    </div>
                                                    <div className="mt-2 text-xs text-text-secondary">{item.detail}</div>
                                                </div>
                                                <div className="text-[11px] text-text-muted">{item.occurredAtLabel}</div>
                                            </div>
                                        </article>
                                    ))}
                                </div>
                            ) : null}
                        </section>

                        <section className="rounded-2xl border border-border-muted bg-bg-primary/70 p-4">
                            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-text-muted">
                                <FileJson className="h-4 w-4" />
                                Config Snapshots
                            </div>
                            <div className="mt-3 grid gap-3">
                                <details className="rounded-xl border border-border-muted bg-bg-secondary/70 p-3">
                                    <summary className="cursor-pointer text-xs font-bold uppercase tracking-[0.14em] text-text-muted">
                                        Backtest Parameters
                                    </summary>
                                    <pre className="mt-3 overflow-x-auto rounded-xl border border-border-muted bg-bg-primary/70 p-3 text-xs text-text-secondary">
                                        {view.backtest.parameterJson}
                                    </pre>
                                </details>
                                <details className="rounded-xl border border-border-muted bg-bg-secondary/70 p-3">
                                    <summary className="cursor-pointer text-xs font-bold uppercase tracking-[0.14em] text-text-muted">
                                        Backtest Execution Config
                                    </summary>
                                    <pre className="mt-3 overflow-x-auto rounded-xl border border-border-muted bg-bg-primary/70 p-3 text-xs text-text-secondary">
                                        {view.backtest.executionConfigJson}
                                    </pre>
                                </details>
                                <details className="rounded-xl border border-border-muted bg-bg-secondary/70 p-3">
                                    <summary className="cursor-pointer text-xs font-bold uppercase tracking-[0.14em] text-text-muted">
                                        Live Parameters
                                    </summary>
                                    <pre className="mt-3 overflow-x-auto rounded-xl border border-border-muted bg-bg-primary/70 p-3 text-xs text-text-secondary">
                                        {view.live.parameterJson}
                                    </pre>
                                </details>
                                <details className="rounded-xl border border-border-muted bg-bg-secondary/70 p-3">
                                    <summary className="cursor-pointer text-xs font-bold uppercase tracking-[0.14em] text-text-muted">
                                        Live Execution Config
                                    </summary>
                                    <pre className="mt-3 overflow-x-auto rounded-xl border border-border-muted bg-bg-primary/70 p-3 text-xs text-text-secondary">
                                        {view.live.executionConfigJson}
                                    </pre>
                                </details>
                            </div>
                        </section>
                    </>
                ) : null}
            </div>
        </div>
    );
}
