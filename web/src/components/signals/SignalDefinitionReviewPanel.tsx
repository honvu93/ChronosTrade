"use client";

import { FilePenLine, Layers3, Play, Target, X } from "lucide-react";
import {
    ComposedSignal,
    TechIndicatorDefinition,
} from "@/types/signals";
import {
    buildCompositionSummary,
    buildReviewedConditions,
} from "@/lib/composedSignalReview";
import {
    describeEntryWindow,
    describeExitManagementPlan,
    describeStopLossPlan,
    describeTakeProfitPlan,
} from "@/lib/composedSignalConfig";
import {
    getComposedSignalLifecycleMessage,
    getComposedSignalLifecycleState,
} from "@/lib/composedSignalLifecycle";
import { getSignalReuseConnections } from "@/lib/composedSignalReuse";
import MetricCard from "@/components/ui/MetricCard";
import { useAppLocale } from "@/hooks/useAppLocale";

export default function SignalDefinitionReviewPanel({
    signal,
    indicators,
    signals,
    isOpen,
    onClose,
    onInspect,
    onEdit,
    onRunBacktest,
    onReuse,
    onRetire,
    retiringId,
}: {
    signal: ComposedSignal | null;
    indicators: TechIndicatorDefinition[];
    signals: ComposedSignal[];
    isOpen: boolean;
    onClose: () => void;
    onInspect: (signal: ComposedSignal) => void;
    onEdit: (signal: ComposedSignal) => void;
    onRunBacktest: (signal: ComposedSignal) => void;
    onReuse: (signal: ComposedSignal) => void;
    onRetire: (signal: ComposedSignal) => void | Promise<void>;
    retiringId: string | null;
}) {
    const { copy } = useAppLocale();

    if (!isOpen || !signal) {
        return null;
    }

    const renderContextValue = (value: string | undefined) => value && value.trim().length > 0 ? value : copy.signalReview.inheritedFromRuntime;

    const summary = buildCompositionSummary(signal.composedBlocks);
    const reviewedConditions = buildReviewedConditions(signal.composedBlocks.blocks, indicators);
    const exitProfileCode = signal.composedBlocks.exitManagement?.profileCode ?? "HARD_SIGNAL_TP";
    const lifecycleState = getComposedSignalLifecycleState(signal);
    const isRetired = lifecycleState === "RETIRED";
    const lifecycleMessage = getComposedSignalLifecycleMessage(lifecycleState);
    const reuseConnections = getSignalReuseConnections(signal, signals);

    return (
        <div className="fixed inset-y-0 right-0 z-[90] flex w-full max-w-[480px] flex-col border-l border-border-muted bg-bg-secondary shadow-[0_0_60px_rgba(0,0,0,0.45)]">
            <div className="flex items-start justify-between gap-3 border-b border-border-muted bg-bg-primary px-5 py-4">
                <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-accent">{copy.signalReview.signalReview}</div>
                    <h2 className="mt-2 text-lg font-black text-text-primary">{signal.name}</h2>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                        <span>{signal.code} v{signal.version}</span>
                        <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.18em] ${isRetired
                                ? "border-price-down/30 bg-price-down/10 text-price-down"
                                : "border-price-up/30 bg-price-up/10 text-price-up"
                                }`}
                        >
                            {lifecycleState}
                        </span>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {!isRetired ? (
                        <button
                            onClick={() => onRunBacktest(signal)}
                            className="inline-flex items-center gap-2 rounded-full bg-accent px-3 py-2 text-xs font-black text-bg-secondary transition hover:brightness-105"
                        >
                            <Play className="h-3.5 w-3.5" />
                            {copy.signalReview.runBacktest}
                        </button>
                    ) : null}
                    <button
                        onClick={() => onReuse(signal)}
                        className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-2 text-xs font-bold text-accent transition-colors hover:bg-accent/20"
                    >
                        <Layers3 className="h-3.5 w-3.5" />
                        {copy.signalReview.reuseAsNew}
                    </button>
                    {isRetired ? (
                        <div className="rounded-full border border-price-down/20 bg-price-down/10 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-price-down">
                            {copy.signalReview.retiredSnapshot}
                        </div>
                    ) : (
                        <>
                            <button
                                onClick={() => onEdit(signal)}
                                className="inline-flex items-center gap-2 rounded-full border border-border-muted bg-bg-secondary px-3 py-2 text-xs font-bold text-text-primary transition-colors hover:border-accent/30"
                            >
                                <FilePenLine className="h-3.5 w-3.5" />
                                {copy.signalReview.reopen}
                            </button>
                            <button
                                onClick={() => onRetire(signal)}
                                disabled={retiringId === signal.id}
                                aria-label={copy.signalReview.retireSignalAria}
                                className="rounded-full border border-price-down/20 bg-price-down/10 px-3 py-2 text-xs font-bold text-price-down transition-colors hover:bg-price-down/20 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {retiringId === signal.id ? copy.signalReview.retiring : copy.signalReview.retire}
                            </button>
                        </>
                    )}
                    <button
                        onClick={onClose}
                        aria-label={copy.signalReview.closeSignalReview}
                        className="rounded-full border border-border-muted bg-bg-secondary p-2 text-text-muted transition-colors hover:text-text-primary"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
                <section className={`rounded-2xl border p-4 ${isRetired
                    ? "border-price-down/20 bg-price-down/10"
                    : "border-price-up/20 bg-price-up/10"
                    }`}>
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">{copy.signalReview.lifecycle}</div>
                    <div className={`mt-2 text-sm font-black ${isRetired ? "text-price-down" : "text-price-up"}`}>{lifecycleState}</div>
                    <p className="mt-2 text-sm leading-6 text-text-secondary">
                        {lifecycleMessage}
                    </p>
                </section>

                {(reuseConnections.parent || reuseConnections.refinements.length > 0) ? (
                    <section className="rounded-2xl border border-border-muted bg-bg-primary/70 p-4">
                        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-text-muted">
                            <Layers3 className="h-4 w-4" />
                            {copy.signalReview.lineage}
                        </div>

                        {reuseConnections.parent ? (
                            <article className="mt-4 rounded-2xl border border-border-muted bg-bg-secondary/70 p-4">
                                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent">{copy.signalReview.derivedFrom}</div>
                                <div className="mt-2 flex items-start justify-between gap-3">
                                    <div>
                                        <div className="text-sm font-bold text-text-primary">{reuseConnections.parent.name}</div>
                                        <div className="mt-1 text-xs text-text-muted">
                                            {reuseConnections.parent.code} v{reuseConnections.parent.version}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {reuseConnections.parent.lifecycleState ? (
                                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.16em] ${reuseConnections.parent.lifecycleState === "RETIRED"
                                                ? "border-price-down/30 bg-price-down/10 text-price-down"
                                                : "border-price-up/30 bg-price-up/10 text-price-up"
                                                }`}>
                                                {reuseConnections.parent.lifecycleState}
                                            </span>
                                        ) : null}
                                        {reuseConnections.parent.signal ? (
                                            <button
                                                onClick={() => onInspect(reuseConnections.parent?.signal as ComposedSignal)}
                                                className="rounded-full border border-border-muted bg-bg-primary px-3 py-1.5 text-[11px] font-bold text-text-primary"
                                            >
                                                {copy.signalReview.inspectOriginal}
                                            </button>
                                        ) : null}
                                    </div>
                                </div>
                            </article>
                        ) : null}

                        {reuseConnections.refinements.length > 0 ? (
                            <article className="mt-4 rounded-2xl border border-border-muted bg-bg-secondary/70 p-4">
                                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent">{copy.signalReview.refinements}</div>
                                <div className="mt-3 space-y-3">
                                    {reuseConnections.refinements.map((refinement) => (
                                        <div key={refinement.id} className="flex items-start justify-between gap-3 rounded-2xl border border-border-muted bg-bg-primary/70 px-3 py-3">
                                            <div>
                                                <div className="text-sm font-bold text-text-primary">{refinement.name}</div>
                                                <div className="mt-1 text-xs text-text-muted">
                                                    {refinement.code} v{refinement.version}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.16em] ${refinement.lifecycleState === "RETIRED"
                                                    ? "border-price-down/30 bg-price-down/10 text-price-down"
                                                    : "border-price-up/30 bg-price-up/10 text-price-up"
                                                    }`}>
                                                    {refinement.lifecycleState}
                                                </span>
                                                {refinement.signal ? (
                                                    <button
                                                        onClick={() => onInspect(refinement.signal as ComposedSignal)}
                                                        className="rounded-full border border-border-muted bg-bg-secondary px-3 py-1.5 text-[11px] font-bold text-text-primary"
                                                    >
                                                        {copy.signalReview.inspect}
                                                    </button>
                                                ) : null}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </article>
                        ) : null}
                    </section>
                ) : null}

                <section className="rounded-2xl border border-border-muted bg-bg-primary/70 p-4">
                    <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-text-muted">
                        <Layers3 className="h-4 w-4" />
                        {copy.signalReview.ruleStructure}
                    </div>
                    <h3 className="mt-3 text-base font-black text-text-primary">{summary.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-text-secondary">{summary.description}</p>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <MetricCard size="compact" label={copy.signalReview.signalContext} value={`${renderContextValue(signal.composedBlocks.symbol)} | ${renderContextValue(signal.composedBlocks.timeframe)}`} />
                        <MetricCard size="compact" label={copy.signalReview.direction} value={signal.composedBlocks.side} />
                        <MetricCard size="compact" label={copy.signalReview.conditions} value={`${signal.composedBlocks.blocks.length}`} />
                        <MetricCard size="compact" label={copy.signalReview.connector} value={summary.connectorLabel} />
                    </div>
                    {signal.description ? (
                        <div className="mt-4 rounded-2xl border border-border-muted bg-bg-secondary/70 px-3 py-3 text-sm text-text-secondary">
                            {signal.description}
                        </div>
                    ) : null}
                </section>

                <section className="rounded-2xl border border-border-muted bg-bg-primary/70 p-4">
                    <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-text-muted">
                        <Target className="h-4 w-4" />
                        {copy.signalReview.tradePlan}
                    </div>
                    <div className="mt-4 space-y-3">
                        <article className="rounded-2xl border border-border-muted bg-bg-secondary/70 p-4">
                            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent">{copy.signalReview.entry}</div>
                            <div className="mt-2 text-sm font-bold text-text-primary">{signal.composedBlocks.side} bias</div>
                            <p className="mt-2 text-sm leading-6 text-text-secondary">
                                {describeEntryWindow(signal.composedBlocks)}
                            </p>
                        </article>

                        <article className="rounded-2xl border border-border-muted bg-bg-secondary/70 p-4">
                            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent">{copy.signalReview.protection}</div>
                            <div className="mt-2 text-sm font-bold text-text-primary">{describeStopLossPlan(signal.composedBlocks.stopLoss)}</div>
                        </article>

                        <article className="rounded-2xl border border-border-muted bg-bg-secondary/70 p-4">
                            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent">{copy.signalReview.exit}</div>
                            <div className="mt-2 text-sm font-bold text-text-primary">{describeTakeProfitPlan(signal.composedBlocks.takeProfit)}</div>
                            <p className="mt-2 text-sm leading-6 text-text-secondary">
                                {describeExitManagementPlan(exitProfileCode)}
                            </p>
                        </article>
                    </div>
                </section>

                <section className="rounded-2xl border border-border-muted bg-bg-primary/70 p-4">
                    <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-text-muted">
                        <Target className="h-4 w-4" />
                        {copy.signalReview.conditionFlow}
                    </div>
                    <div className="mt-4 space-y-3">
                        {reviewedConditions.map((condition, index) => (
                            <div key={condition.id}>
                                {index > 0 ? (
                                    <div className="mb-3 flex items-center justify-center gap-2">
                                        <div className="h-px flex-1 bg-border-muted/60" />
                                        <span className="rounded-full border border-accent/20 bg-accent/10 px-2 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-accent">
                                            {summary.connectorLabel}
                                        </span>
                                        <div className="h-px flex-1 bg-border-muted/60" />
                                    </div>
                                ) : null}

                                <article className="rounded-2xl border border-border-muted bg-bg-secondary/70 p-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent">{condition.stepLabel}</div>
                                            <h4 className="mt-2 text-sm font-black text-text-primary">{condition.conditionLabel}</h4>
                                            <div className="mt-1 text-xs font-semibold text-text-muted">{condition.indicatorLabel}</div>
                                        </div>
                                        <span className="rounded-full border border-border-muted bg-bg-primary px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-text-muted">
                                            #{index + 1}
                                        </span>
                                    </div>
                                    <p className="mt-3 text-sm leading-6 text-text-secondary">{condition.description}</p>
                                    {condition.detailItems.length > 0 ? (
                                        <div className="mt-4 flex flex-wrap gap-2">
                                            {condition.detailItems.map((item) => (
                                                <span
                                                    key={`${condition.id}-${item}`}
                                                    className="rounded-full border border-border-muted bg-bg-primary px-3 py-1 text-xs font-medium text-text-secondary"
                                                >
                                                    {item}
                                                </span>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="mt-4 text-xs text-text-muted">
                                            {copy.signalReview.catalogDefaults}
                                        </div>
                                    )}
                                </article>
                            </div>
                        ))}
                    </div>
                </section>
            </div>
        </div>
    );
}
