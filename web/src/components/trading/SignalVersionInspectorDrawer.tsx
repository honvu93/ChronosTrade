"use client";

import { BookOpen, FileJson, GitBranch, Layers, Loader2, Server, X } from "lucide-react";
import { SignalVersionOriginContext, SignalVersionSnapshot } from "@/types/trading";
import { buildSignalVersionContextView } from "@/lib/signalVersionContextView";

const toneStyles = {
    success: "border-price-up/30 bg-price-up/10 text-price-up",
    caution: "border-accent/30 bg-accent/10 text-accent",
    danger: "border-price-down/30 bg-price-down/10 text-price-down",
    neutral: "border-border-muted bg-bg-tertiary text-text-secondary",
} as const;

export default function SignalVersionInspectorDrawer({
    isOpen,
    snapshot,
    isLoading,
    error,
    originContext,
    onClose,
}: {
    isOpen: boolean;
    snapshot: SignalVersionSnapshot | null;
    isLoading: boolean;
    error: string | null;
    originContext: SignalVersionOriginContext | null;
    onClose: () => void;
}) {
    if (!isOpen) {
        return null;
    }

    const view = snapshot ? buildSignalVersionContextView(snapshot) : null;

    return (
        <div
            role="dialog"
            aria-labelledby="signal-version-inspector-title"
            aria-describedby="signal-version-inspector-description"
            aria-modal="false"
            className="fixed inset-y-0 right-0 z-[90] flex w-full max-w-[520px] flex-col border-l border-border-muted bg-bg-secondary shadow-[0_0_60px_rgba(0,0,0,0.45)]"
        >
            <div className="flex items-start justify-between gap-3 border-b border-border-muted bg-bg-primary px-5 py-4">
                <div className="min-w-0">
                    {originContext ? (
                        <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-accent">
                            {originContext.label}
                            {originContext.detail ? (
                                <span className="ml-2 normal-case text-text-muted">- {originContext.detail}</span>
                            ) : null}
                        </div>
                    ) : (
                        <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-accent">
                            Signal Inspector
                        </div>
                    )}
                    <h2
                        id="signal-version-inspector-title"
                        className="mt-2 truncate text-lg font-black text-text-primary"
                    >
                        {view ? view.header.title : "Loading..."}
                    </h2>
                    {view ? (
                        <div className="mt-1 font-mono text-xs text-text-muted">{view.header.codeLabel}</div>
                    ) : null}
                    <p
                        id="signal-version-inspector-description"
                        className="mt-2 text-sm text-text-secondary"
                    >
                        Inspect the exact signal definition, run or live runtime context tied to the current
                        investigation without leaving the trading operations workspace.
                    </p>
                </div>
                <button
                    onClick={onClose}
                    aria-label="Close signal version inspector"
                    className="rounded-full border border-border-muted bg-bg-secondary p-2 text-text-muted transition-colors hover:text-text-primary"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
                {isLoading ? (
                    <div className="flex items-center gap-2 text-sm text-text-secondary">
                        <Loader2 className="h-4 w-4 animate-spin text-accent" />
                        Loading signal version context...
                    </div>
                ) : null}

                {error ? (
                    <div className="rounded-2xl border border-price-down/20 bg-price-down/10 px-4 py-3 text-sm text-price-down">
                        {error}
                    </div>
                ) : null}

                {view ? (
                    <>
                        <section className="rounded-2xl border border-border-muted bg-bg-primary/70 p-4">
                            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-text-muted">
                                <BookOpen className="h-4 w-4" />
                                Signal Definition
                            </div>
                            <div className="mt-3 space-y-2 text-sm text-text-secondary">
                                <div>
                                    Category: <span className="font-semibold text-text-primary">{view.header.category}</span>
                                </div>
                                {view.header.composedLabel ? (
                                    <div>
                                        Type: <span className="font-semibold text-accent">{view.header.composedLabel}</span>
                                    </div>
                                ) : null}
                                <div>
                                    Created: <span className="font-semibold text-text-primary">{view.header.createdAt}</span>
                                </div>
                                <div>
                                    Author: <span className="font-semibold text-text-primary">{view.header.createdBy}</span>
                                </div>
                            </div>
                            {view.header.description !== "No description provided." ? (
                                <p className="mt-3 text-sm text-text-secondary">{view.header.description}</p>
                            ) : null}
                        </section>

                        <section className="rounded-2xl border border-border-muted bg-bg-primary/70 p-4">
                            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-text-muted">
                                <Layers className="h-4 w-4" />
                                Investigation Record
                            </div>
                            <div className="mt-3 space-y-2 text-sm text-text-secondary">
                                <div>
                                    Source: <span className="font-semibold text-text-primary">{view.origin.kindLabel}</span>
                                </div>
                                <div>
                                    Record: <span className="font-semibold text-text-primary">{view.origin.recordLabel}</span>
                                </div>
                                {view.origin.recordId ? (
                                    <div className="font-mono text-xs text-text-muted">ID: {view.origin.recordId}</div>
                                ) : null}
                                <div className="flex items-center gap-2">
                                    Status:
                                    <span
                                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-black uppercase tracking-[0.14em] ${toneStyles[view.origin.statusTone]}`}
                                    >
                                        {view.origin.statusLabel}
                                    </span>
                                </div>
                                {view.origin.context ? (
                                    <div>
                                        Market Context: <span className="font-semibold text-text-primary">{view.origin.context}</span>
                                    </div>
                                ) : null}
                            </div>
                        </section>

                        {view.origin.hasAccountContext ? (
                            <section className="rounded-2xl border border-border-muted bg-bg-primary/70 p-4">
                                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-text-muted">
                                    <Server className="h-4 w-4" />
                                    Associated Account
                                </div>
                                <div className="mt-3 space-y-2 text-sm text-text-secondary">
                                    <div>
                                        Runtime Account: <span className="font-semibold text-text-primary">{view.origin.accountLabel || "Configured MT5 account"}</span>
                                    </div>
                                    <div>
                                        Readiness: <span className="font-semibold text-text-primary">{view.origin.accountStateLabel}</span>
                                    </div>
                                </div>
                            </section>
                        ) : null}

                        <section className="rounded-2xl border border-border-muted bg-bg-primary/70 p-4">
                            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-text-muted">
                                <GitBranch className="h-4 w-4" />
                                Linked Backtest
                            </div>
                            {view.backtest.hasLinkedRun ? (
                                <div className="mt-3 space-y-2 text-sm text-text-secondary">
                                    <div>
                                        Run: <span className="font-semibold text-text-primary">{view.backtest.runName}</span>
                                    </div>
                                    {view.backtest.context ? (
                                        <div>
                                            Context: <span className="font-semibold text-text-primary">{view.backtest.context}</span>
                                        </div>
                                    ) : null}
                                    <div className="flex items-center gap-2">
                                        Status:
                                        <span
                                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-black uppercase tracking-[0.14em] ${toneStyles[view.backtest.statusTone]}`}
                                        >
                                            {view.backtest.statusLabel}
                                        </span>
                                    </div>
                                    <div className="font-mono text-xs text-text-muted">ID: {view.backtest.runId}</div>
                                </div>
                            ) : (
                                <p className="mt-3 text-sm text-text-secondary">
                                    No backtest run is linked to this signal version yet.
                                </p>
                            )}
                        </section>

                        {view.hasParams ? (
                            <section className="rounded-2xl border border-border-muted bg-bg-primary/70 p-4">
                                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-text-muted">
                                    <FileJson className="h-4 w-4" />
                                    Parameter Schema
                                </div>
                                <div className="mt-3 space-y-2">
                                    {view.paramFields.map((field) => (
                                        <div
                                            key={field.key}
                                            className="rounded-xl border border-border-muted bg-bg-secondary/70 px-3 py-2"
                                        >
                                            <div className="flex items-center gap-2">
                                                <span className="font-mono text-xs font-bold text-text-primary">
                                                    {field.key}
                                                </span>
                                                <span className="rounded border border-border-muted bg-bg-tertiary px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
                                                    {field.typeLabel}
                                                </span>
                                            </div>
                                            {field.description ? (
                                                <p className="mt-1 text-xs text-text-secondary">{field.description}</p>
                                            ) : null}
                                        </div>
                                    ))}
                                </div>
                            </section>
                        ) : null}

                        {view.hasParameterValues ? (
                            <section className="rounded-2xl border border-border-muted bg-bg-primary/70 p-4">
                                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-text-muted">
                                    <FileJson className="h-4 w-4" />
                                    Parameter Values
                                </div>
                                <details className="mt-3">
                                    <summary className="cursor-pointer text-sm font-bold text-text-primary">
                                        Show parameter values JSON
                                    </summary>
                                    <pre className="mt-3 overflow-x-auto rounded-xl border border-border-muted bg-bg-secondary/70 p-3 text-xs text-text-secondary">
                                        {view.parameterValuesJson}
                                    </pre>
                                </details>
                            </section>
                        ) : null}

                        {view.hasExecutionConfig ? (
                            <section className="rounded-2xl border border-border-muted bg-bg-primary/70 p-4">
                                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-text-muted">
                                    <FileJson className="h-4 w-4" />
                                    Execution Configuration
                                </div>
                                <details className="mt-3">
                                    <summary className="cursor-pointer text-sm font-bold text-text-primary">
                                        Show execution config JSON
                                    </summary>
                                    <pre className="mt-3 overflow-x-auto rounded-xl border border-border-muted bg-bg-secondary/70 p-3 text-xs text-text-secondary">
                                        {view.executionConfigJson}
                                    </pre>
                                </details>
                            </section>
                        ) : null}

                        {view.hasComposedBlocks ? (
                            <section className="rounded-2xl border border-border-muted bg-bg-primary/70 p-4">
                                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-text-muted">
                                    <Layers className="h-4 w-4" />
                                    Composed Signal Blocks
                                </div>
                                <details className="mt-3">
                                    <summary className="cursor-pointer text-sm font-bold text-text-primary">
                                        Show composed blocks JSON
                                    </summary>
                                    <pre className="mt-3 overflow-x-auto rounded-xl border border-border-muted bg-bg-secondary/70 p-3 text-xs text-text-secondary">
                                        {view.composedBlocksJson}
                                    </pre>
                                </details>
                            </section>
                        ) : null}

                        <div className="rounded-2xl border border-border-muted bg-bg-tertiary/50 px-4 py-3 text-xs text-text-secondary">
                            This drawer preserves your current investigation thread. Close it to continue from the
                            same incident record or eligibility snapshot.
                        </div>
                    </>
                ) : null}
            </div>
        </div>
    );
}
