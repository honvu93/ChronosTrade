"use client";

import Link from "next/link";
import { ArrowRight, BrainCircuit, ShieldAlert } from "lucide-react";
import { BacktestConfidenceChangeViewModel } from "@/lib/backtestConfidenceChangeView";

const toneStyles = {
    "positive-shift": "border-price-up/25 bg-price-up/10 text-price-up",
    neutral: "border-accent/25 bg-accent/10 text-accent",
    "negative-shift": "border-price-down/25 bg-price-down/10 text-price-down",
} as const;

const readinessStyles = {
    draft: "border-border-muted bg-bg-secondary/70 text-text-primary",
    validated: "border-accent/25 bg-accent/10 text-accent",
    blocked: "border-price-down/25 bg-price-down/10 text-price-down",
    "live-eligible": "border-price-up/25 bg-price-up/10 text-price-up",
} as const;

export default function BacktestConfidenceChangeCard({
    runId,
    view,
    onInspectComparison,
}: {
    runId: string;
    view: BacktestConfidenceChangeViewModel;
    onInspectComparison: () => void;
}) {
    const action = (() => {
        if (view.nextActionKind === "compare-runs") {
            return (
                <button
                    type="button"
                    onClick={onInspectComparison}
                    className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-black text-bg-secondary"
                >
                    {view.nextActionLabel}
                    <ArrowRight className="h-4 w-4" />
                </button>
            );
        }

        if (view.nextActionKind === "open-reports") {
            return (
                <Link
                    href={`/reports?backtestRunId=${runId}`}
                    className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-black text-bg-secondary"
                >
                    {view.nextActionLabel}
                    <ArrowRight className="h-4 w-4" />
                </Link>
            );
        }

        return (
            <Link
                href="/signals"
                className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-black text-bg-secondary"
            >
                {view.nextActionLabel}
                <ArrowRight className="h-4 w-4" />
            </Link>
        );
    })();

    return (
        <div className="mt-4 rounded-2xl border border-border-muted bg-bg-secondary/45 px-4 py-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.22em] text-text-muted">
                        <BrainCircuit className="h-4 w-4" />
                        Confidence Change
                    </div>
                    <h3 className="mt-2 text-lg font-black text-text-primary">{view.confidenceLabel}</h3>
                </div>
                <div className="flex flex-wrap gap-2">
                    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${toneStyles[view.confidenceState]}`}>
                        {view.confidenceLabel}
                    </span>
                    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${readinessStyles[view.promotionState]}`}>
                        {view.promotionLabel}
                    </span>
                </div>
            </div>

            <p className="mt-3 text-sm text-text-secondary">{view.narrative}</p>

            <div className="mt-4 rounded-2xl border border-border-muted bg-bg-primary/60 px-4 py-3 text-sm text-text-secondary">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.22em] text-text-muted">
                    <ShieldAlert className="h-4 w-4" />
                    Permission To Proceed
                </div>
                <div className="mt-2 font-semibold text-text-primary">{view.permissionSummary}</div>
                <div className="mt-1">{view.nextActionDescription}</div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
                {action}
            </div>
        </div>
    );
}
