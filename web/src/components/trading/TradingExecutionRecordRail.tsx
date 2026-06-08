"use client";

import {
    Activity,
    Loader2,
    ScrollText,
    Search,
} from "lucide-react";
import { buildTradeHistoryAuditDetailView } from "@/lib/tradeHistoryAuditView";
import { TradeHistoryAuditDetailSnapshot } from "@/types/trading";
import StateBanner from "@/components/ui/StateBanner";
import FactCard from "@/components/ui/FactCard";

type Tone = "danger" | "success" | "accent" | "neutral";

const toneStyles: Record<Tone, string> = {
    danger: "border-price-down/20 bg-price-down/8 text-price-down",
    success: "border-price-up/20 bg-price-up/8 text-price-up",
    accent: "border-accent/20 bg-accent/8 text-accent",
    neutral: "border-border-muted bg-bg-tertiary text-text-secondary",
};

export default function TradingExecutionRecordRail({
    recordId,
    detail,
    isLoading,
    error,
    onInspect,
}: {
    recordId: string | null;
    detail: TradeHistoryAuditDetailSnapshot | null;
    isLoading: boolean;
    error: string | null;
    onInspect: (recordId: string) => void;
}) {
    const view = detail ? buildTradeHistoryAuditDetailView(detail) : null;

    return (
        <section
            id="trading-discrepancy-execution-records"
            className="rounded-2xl border border-border-muted bg-bg-primary/70 p-4"
        >
            <div className="flex items-start justify-between gap-3">
                <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-text-muted">
                        Execution Record
                    </div>
                    <div className="mt-2 text-sm font-black text-text-primary">
                        Inspect the linked execution and decision timeline without leaving this investigation.
                    </div>
                    <div className="mt-1 text-xs text-text-secondary">
                        The discrepancy context stays visible while the scoped trade thread loads below.
                    </div>
                </div>
                {recordId ? (
                    <button
                        type="button"
                        onClick={() => { onInspect(recordId); }}
                        disabled={isLoading}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border-muted bg-bg-secondary px-3 py-1.5 text-xs font-bold text-text-primary transition-colors hover:border-accent hover:text-accent disabled:cursor-wait disabled:opacity-70"
                    >
                        {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                        {view ? "Refresh record" : "Inspect record"}
                    </button>
                ) : null}
            </div>

            {!recordId ? (
                <StateBanner
                    tone="neutral"
                    title="No linked trade record"
                    message="This investigation does not currently point to a scoped trade history record."
                    className="mt-4 rounded-2xl"
                />
            ) : null}

            {isLoading && !view ? (
                <div className="mt-4 flex items-center gap-2 rounded-2xl border border-border-muted bg-bg-secondary/70 px-4 py-3 text-sm text-text-secondary">
                    <Loader2 className="h-4 w-4 animate-spin text-accent" />
                    Loading execution record detail...
                </div>
            ) : null}

            {error && !view ? (
                <StateBanner
                    tone="caution"
                    title="Execution record unavailable"
                    message={error}
                    className="mt-4 rounded-2xl"
                />
            ) : null}

            {view ? (
                <>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {view.traceabilityFacts.map((fact) => (
                            <FactCard
                                key={fact.label}
                                label={fact.label}
                                value={fact.value}
                                tone={fact.tone}
                            />
                        ))}
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {view.tradeFacts.map((fact) => (
                            <FactCard
                                key={fact.label}
                                label={fact.label}
                                value={fact.value}
                                tone={fact.tone}
                            />
                        ))}
                    </div>

                    <div className="mt-4 rounded-2xl border border-border-muted bg-bg-secondary/70 p-4">
                        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-text-muted">
                            <Activity className="h-4 w-4" />
                            Scoped Summary
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.16em] ${toneStyles[view.resultTone]}`}>
                                {view.resultLabel}
                            </span>
                            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.16em] ${toneStyles[view.auditTone]}`}>
                                {view.auditLabel}
                            </span>
                        </div>
                        <div className="mt-3 text-sm font-black text-text-primary">{view.title}</div>
                        <div className="mt-1 text-xs text-text-secondary">{view.subtitle}</div>
                    </div>

                    <div className="mt-4 rounded-2xl border border-border-muted bg-bg-secondary/70 p-4">
                        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-text-muted">
                            <ScrollText className="h-4 w-4" />
                            Decision Timeline
                        </div>
                        <div className="mt-2 text-sm font-black text-text-primary">{view.timelineHeadline}</div>
                        <div className="mt-1 text-xs text-text-secondary">{view.timelineSummaryLine}</div>

                        {view.timelineItems.length === 0 ? (
                            <div className="mt-4 rounded-2xl border border-border-muted bg-bg-primary/70 px-4 py-3 text-sm text-text-secondary">
                                No command or decision items are linked to this execution record.
                            </div>
                        ) : (
                            <div className="mt-4 space-y-3">
                                {view.timelineItems.map((item) => (
                                    <article key={item.id} className="rounded-2xl border border-border-muted bg-bg-primary/70 p-4">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.16em] ${toneStyles[item.kindTone]}`}>
                                                {item.kindLabel}
                                            </span>
                                            <span className="rounded-full border border-border-muted bg-bg-secondary px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-text-muted">
                                                {item.sourceLabel}
                                            </span>
                                            <span className="text-sm font-black text-text-primary">{item.title}</span>
                                        </div>
                                        <div className="mt-2 text-xs text-text-secondary">{item.occurredAtLabel}</div>
                                        <div className="mt-2 text-xs leading-5 text-text-secondary">{item.detail}</div>
                                        {item.note ? (
                                            <div className="mt-3 rounded-xl border border-border-muted bg-bg-secondary px-3 py-2 text-xs text-text-secondary">
                                                {item.note}
                                            </div>
                                        ) : null}
                                        {item.rawSections.length > 0 ? (
                                            <div className="mt-3 space-y-2">
                                                {item.rawSections.map((section) => (
                                                    <details key={section.label} className="rounded-xl border border-border-muted bg-bg-secondary p-3">
                                                        <summary className="cursor-pointer text-xs font-bold uppercase tracking-[0.14em] text-text-muted">
                                                            {section.label}
                                                        </summary>
                                                        <pre className="mt-3 overflow-x-auto rounded-xl border border-border-muted bg-bg-primary/70 p-3 text-xs text-text-secondary">
                                                            {section.value}
                                                        </pre>
                                                    </details>
                                                ))}
                                            </div>
                                        ) : null}
                                    </article>
                                ))}
                            </div>
                        )}
                    </div>
                </>
            ) : null}
        </section>
    );
}
