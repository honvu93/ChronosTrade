"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
    Activity,
    ArrowLeft,
    FileJson,
    Flag,
    Loader2,
    ScrollText,
} from "lucide-react";
import { useAuthSession } from "@/hooks/useAuthSession";
import { useTradingFeatureFlags } from "@/hooks/useTradingFeatureFlags";
import {
    buildTradeHistoryAuditDetailView,
    TradeHistoryAuditDetailViewModel,
} from "@/lib/tradeHistoryAuditView";
import { Tone, toneStyles, factTextToneStyles } from "@/lib/toneStyles";
import { buildTradingAuthHeaders, readTradingAuthToken } from "@/lib/tradingApiAuth";
import {
    TradeHistoryAuditDetailEnvelope,
    TradeHistoryAuditDetailSnapshot,
    TradingErrorEnvelope,
} from "@/types/trading";
import StateBanner from "@/components/ui/StateBanner";

function FactCard({ label, value, tone = "neutral" }: { label: string; value: string; tone?: Tone }) {
    return (
        <div className="rounded-2xl border border-border-muted bg-bg-primary/70 p-3">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">{label}</div>
            <div className={`mt-2 text-sm font-bold ${factTextToneStyles[tone]}`}>{value}</div>
        </div>
    );
}

export default function TradeHistoryDetailPage({ recordId }: { recordId: string }) {
    const { isAuthenticated } = useAuthSession();
    const { snapshot: featureFlags } = useTradingFeatureFlags({ enabled: isAuthenticated });
    const readEnabled = Boolean(featureFlags?.capabilities.read.enabled);
    const [detail, setDetail] = useState<TradeHistoryAuditDetailSnapshot | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!readEnabled || !recordId) return;

        let active = true;
        const controller = new AbortController();

        const load = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const authToken = readTradingAuthToken();
                if (!authToken) throw new Error("Authentication required.");

                const response = await fetch(
                    `/api/trading/operations/trade-history/${encodeURIComponent(recordId)}`,
                    { cache: "no-store", headers: buildTradingAuthHeaders(authToken), signal: controller.signal },
                );

                const payload = await response.json().catch(() => null) as
                    | TradeHistoryAuditDetailEnvelope
                    | TradingErrorEnvelope
                    | null;

                if (!response.ok || !payload || payload.success === false) {
                    throw new Error(
                        payload && payload.success === false
                            ? payload.error.message
                            : "Failed to load trade detail.",
                    );
                }

                if (active) {
                    setDetail(payload.data);
                    setIsLoading(false);
                }
            } catch (err) {
                if (!active || controller.signal.aborted) return;
                setError(err instanceof Error ? err.message : "Failed to load trade detail.");
                setIsLoading(false);
            }
        };

        void load();
        return () => { active = false; controller.abort(); };
    }, [readEnabled, recordId]);

    const view: TradeHistoryAuditDetailViewModel | null = detail
        ? buildTradeHistoryAuditDetailView(detail)
        : null;

    return (
        <div className="space-y-5">
            <div className="flex items-center gap-3">
                <Link
                    href="/trading/history"
                    className="inline-flex items-center gap-1.5 rounded-full border border-border-muted bg-bg-tertiary px-3 py-1.5 text-xs font-bold text-text-primary transition-colors hover:border-accent hover:text-accent"
                >
                    <ArrowLeft className="h-3 w-3" />
                    Back to History
                </Link>
                <h1 className="text-sm font-black text-text-primary">
                    {view ? view.title : `Trade ${recordId}`}
                </h1>
                {view ? (
                    <div className="flex gap-2">
                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${toneStyles[view.resultTone]}`}>
                            {view.resultLabel === "ACTIVE" ? (
                                <span className="inline-block h-2 w-2 rounded-full bg-accent animate-pulse-dot" />
                            ) : null}
                            {view.resultLabel}
                        </span>
                        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${toneStyles[view.auditTone]}`}>
                            {view.auditLabel}
                        </span>
                    </div>
                ) : null}
            </div>

            {isLoading ? (
                <div className="flex items-center gap-2 rounded-2xl border border-border-muted bg-bg-primary/90 px-5 py-4 text-sm text-text-secondary">
                    <Loader2 className="h-4 w-4 animate-spin text-accent" />
                    Loading trade detail...
                </div>
            ) : null}

            {error ? (
                <StateBanner
                    tone="caution"
                    title="Failed to load trade"
                    message={error}
                    className="rounded-2xl"
                />
            ) : null}

            {view ? (
                <div className="grid gap-5 xl:grid-cols-2">
                    {/* Trade Facts */}
                    <section className="rounded-3xl border border-border-muted bg-bg-primary/90 p-5">
                        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-text-muted">
                            <Activity className="h-4 w-4" />
                            Trade Facts
                        </div>
                        <div className="mt-4 grid gap-3 grid-cols-2">
                            {view.tradeFacts.map((fact) => (
                                <FactCard key={fact.label} label={fact.label} value={fact.value} tone={fact.tone} />
                            ))}
                        </div>
                    </section>

                    {/* History Context */}
                    <section className="rounded-3xl border border-border-muted bg-bg-primary/90 p-5">
                        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-text-muted">
                            <Flag className="h-4 w-4" />
                            History Context
                        </div>
                        <div className="mt-4 grid gap-3 grid-cols-2">
                            {view.traceabilityFacts.map((fact) => (
                                <FactCard key={fact.label} label={fact.label} value={fact.value} tone={fact.tone} />
                            ))}
                        </div>
                    </section>

                    {/* Audit Timeline — full width */}
                    <section className="rounded-3xl border border-border-muted bg-bg-primary/90 p-5 xl:col-span-2">
                        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-text-muted">
                            <ScrollText className="h-4 w-4" />
                            Audit Timeline
                        </div>
                        <div className="mt-2 text-sm font-bold text-text-primary">{view.timelineHeadline}</div>
                        <div className="mt-1 text-xs text-text-secondary">{view.timelineSummaryLine}</div>

                        {view.timelineItems.length === 0 ? (
                            <div className="mt-4 rounded-2xl border border-border-muted bg-bg-secondary/70 px-4 py-3 text-sm text-text-secondary">
                                No command or decision events are linked to this record.
                            </div>
                        ) : (
                            <div className="mt-4 space-y-3">
                                {view.timelineItems.map((item) => (
                                    <article key={item.id} className="rounded-2xl border border-border-muted bg-bg-secondary/70 p-4">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${toneStyles[item.kindTone]}`}>
                                                        {item.kindLabel}
                                                    </span>
                                                    <span className="rounded-full border border-border-muted bg-bg-primary/70 px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-text-muted">
                                                        {item.sourceLabel}
                                                    </span>
                                                    <span className="text-sm font-black text-text-primary">{item.title}</span>
                                                </div>
                                                <div className="mt-2 text-xs text-text-secondary">{item.detail}</div>
                                            </div>
                                            <div className="text-[11px] text-text-muted">{item.occurredAtLabel}</div>
                                        </div>

                                        {item.note ? (
                                            <div className="mt-3 rounded-xl border border-border-muted bg-bg-primary/70 px-3 py-2 text-xs text-text-secondary">
                                                {item.note}
                                            </div>
                                        ) : null}

                                        {item.rawSections.length > 0 ? (
                                            <div className="mt-3 space-y-2">
                                                {item.rawSections.map((section) => (
                                                    <details key={section.label} className="rounded-xl border border-border-muted bg-bg-primary/70 p-3">
                                                        <summary className="cursor-pointer text-xs font-bold uppercase tracking-[0.14em] text-text-muted">
                                                            {section.label}
                                                        </summary>
                                                        <pre className="mt-3 overflow-x-auto rounded-xl border border-border-muted bg-bg-secondary/70 p-3 text-xs text-text-secondary">
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
                    </section>

                    {/* Raw Record */}
                    <section className="rounded-3xl border border-border-muted bg-bg-primary/90 p-5 xl:col-span-2">
                        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-text-muted">
                            <FileJson className="h-4 w-4" />
                            Raw Record
                        </div>
                        <pre className="mt-4 overflow-x-auto rounded-xl border border-border-muted bg-bg-secondary/70 p-3 text-xs text-text-secondary">
                            {JSON.stringify(detail ?? {}, null, 2)}
                        </pre>
                    </section>
                </div>
            ) : null}
        </div>
    );
}
