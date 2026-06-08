"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Circle, X, ChevronRight } from "lucide-react";
import { useAppLocale } from "@/hooks/useAppLocale";
import { TranslationCatalog } from "@/lib/translations";

// ─── API ─────────────────────────────────────────────────────────────────────

interface ChecklistData {
    mt5Connected: boolean;
    hasCompletedBacktest: boolean;
    hasLiveEligibleSignal: boolean;
    hasPaperTradingActive: boolean;
}

async function fetchChecklist(): Promise<ChecklistData> {
    const response = await fetch("/api/trading/checklist", { credentials: "include" });
    const payload = await response.json().catch(() => null) as { success: boolean; data?: ChecklistData } | null;
    if (!response.ok || !payload?.success || !payload.data) {
        throw new Error("checklist-load-failed");
    }
    return payload.data;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const DISMISS_KEY = "trading-checklist-dismissed";

interface ChecklistItem {
    key: keyof ChecklistData;
    labelKey: keyof TranslationCatalog["gettingStarted"];
    ctaLabelKey: keyof TranslationCatalog["gettingStarted"];
    ctaHref: string;
}

const ITEMS: ChecklistItem[] = [
    {
        key: "mt5Connected",
        labelKey: "mt5Connected",
        ctaLabelKey: "connect",
        ctaHref: "/trading?tab=accounts",
    },
    {
        key: "hasCompletedBacktest",
        labelKey: "backtestCompleted",
        ctaLabelKey: "runBacktests",
        ctaHref: "/trading?tab=eligibility",
    },
    {
        key: "hasLiveEligibleSignal",
        labelKey: "liveEligibleSignal",
        ctaLabelKey: "viewSignals",
        ctaHref: "/trading?tab=eligibility",
    },
    {
        key: "hasPaperTradingActive",
        labelKey: "paperTradingActive",
        ctaLabelKey: "setUp",
        ctaHref: "/trading?tab=eligibility",
    },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function GettingStartedChecklist({ enabled }: { enabled: boolean }) {
    const [data, setData] = useState<ChecklistData | null>(null);
    const [dismissed, setDismissed] = useState(() => {
        if (typeof window === "undefined") return false;
        return localStorage.getItem(DISMISS_KEY) === "true";
    });
    const { copy } = useAppLocale();

    const load = useCallback(async () => {
        if (!enabled || dismissed) return;
        try {
            const result = await fetchChecklist();
            setData(result);
        } catch {
            // Silently fail — checklist is non-critical
        }
    }, [enabled, dismissed]);

    useEffect(() => {
        void load();
    }, [load]);

    const handleDismiss = () => {
        localStorage.setItem(DISMISS_KEY, "true");
        setDismissed(true);
    };

    if (!enabled || dismissed || !data) return null;

    // Auto-hide when all complete
    const allComplete = ITEMS.every((item) => data[item.key]);
    if (allComplete) return null;

    // Find first incomplete item for the primary CTA
    const firstIncomplete = ITEMS.find((item) => !data[item.key]);
    const completedCount = ITEMS.filter((item) => data[item.key]).length;

    return (
        <div
            role="banner"
            aria-label={copy.gettingStarted.ariaLabel}
            className="mb-4 rounded-2xl border border-accent/20 bg-accent/8 px-4 py-3"
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    {/* Header row */}
                    <div className="flex items-center gap-2">
                        <span className="text-[11px] font-black uppercase tracking-[0.14em] text-accent">
                            {copy.gettingStarted.getStarted}
                        </span>
                        <span className="text-[11px] text-text-muted">
                            {completedCount}/{ITEMS.length} {copy.gettingStarted.complete}
                        </span>
                    </div>

                    {/* Progress dots + labels */}
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                        {ITEMS.map((item) => {
                            const done = data[item.key];
                            return (
                                <div key={item.key} className="flex items-center gap-1.5">
                                    {done ? (
                                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-price-up" aria-hidden="true" />
                                    ) : (
                                        <Circle className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden="true" />
                                    )}
                                    <span className={`text-[11px] font-bold ${done ? "text-price-up" : "text-text-secondary"}`}>
                                        {copy.gettingStarted[item.labelKey]}
                                    </span>
                                </div>
                            );
                        })}
                    </div>

                    {/* Primary CTA for first incomplete item */}
                    {firstIncomplete ? (
                        <div className="mt-2.5">
                            <a
                                href={firstIncomplete.ctaHref}
                                className="inline-flex items-center gap-1 text-[11px] font-bold text-accent underline-offset-2 hover:underline"
                            >
                                {copy.gettingStarted[firstIncomplete.ctaLabelKey]}: {copy.gettingStarted[firstIncomplete.labelKey]}
                                <ChevronRight className="h-3 w-3" aria-hidden="true" />
                            </a>
                        </div>
                    ) : null}
                </div>

                {/* Dismiss button */}
                <button
                    type="button"
                    onClick={handleDismiss}
                    className="shrink-0 rounded-full p-1 text-text-muted transition-colors hover:bg-bg-tertiary hover:text-text-primary"
                    aria-label={copy.gettingStarted.dismiss}
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            </div>
        </div>
    );
}
