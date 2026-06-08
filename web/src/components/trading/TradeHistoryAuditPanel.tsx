"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
    AlertTriangle,
    CheckCircle2,
    ExternalLink,
    Loader2,
    RefreshCcw,
    Search,
} from "lucide-react";
import { useTradeHistoryAudit } from "@/hooks/useTradeHistoryAudit";
import { useTradingDiscrepancy } from "@/hooks/useTradingDiscrepancy";
import { buildTradeHistoryAuditListView, TradeHistoryAuditRecordView } from "@/lib/tradeHistoryAuditView";
import { toneStyles } from "@/lib/toneStyles";
import StateBanner from "@/components/ui/StateBanner";
import TradeHistoryAuditDrawer from "@/components/trading/TradeHistoryAuditDrawer";
import TradingDiscrepancyDrawer from "@/components/trading/TradingDiscrepancyDrawer";
import {
    SignalVersionOriginContext,
    TradingDiagnosisRequestParams,
} from "@/types/trading";

type StatusFilter = "ALL" | "ACTIVE" | "CLOSED";
type SideFilter = "ALL" | "LONG" | "SHORT";
type OutcomeFilter = "ALL" | "WIN" | "LOSS" | "BE";

const statusFilters: Array<{ label: string; value: StatusFilter }> = [
    { label: "ALL", value: "ALL" },
    { label: "ACTIVE", value: "ACTIVE" },
    { label: "CLOSED", value: "CLOSED" },
];

const sideFilters: Array<{ label: string; value: SideFilter }> = [
    { label: "ALL", value: "ALL" },
    { label: "LONG", value: "LONG" },
    { label: "SHORT", value: "SHORT" },
];

const outcomeFilters: Array<{ label: string; value: OutcomeFilter }> = [
    { label: "ALL", value: "ALL" },
    { label: "WIN", value: "WIN" },
    { label: "LOSS", value: "LOSS" },
    { label: "BE", value: "BE" },
];

function FilterTabGroup<T extends string>({
    options,
    value,
    onChange,
}: {
    options: Array<{ label: string; value: T }>;
    value: T;
    onChange: (value: T) => void;
}) {
    return (
        <div className="flex gap-1 rounded-full border border-border-muted bg-bg-tertiary/50 p-0.5">
            {options.map((option) => (
                <button
                    key={option.value}
                    type="button"
                    onClick={() => onChange(option.value)}
                    className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] transition-colors ${
                        value === option.value
                            ? "bg-accent/15 text-accent"
                            : "text-text-muted hover:text-text-primary"
                    }`}
                >
                    {option.label}
                </button>
            ))}
        </div>
    );
}

function applyFilters(
    records: TradeHistoryAuditRecordView[],
    status: StatusFilter,
    side: SideFilter,
    outcome: OutcomeFilter,
): TradeHistoryAuditRecordView[] {
    return records.filter((record) => {
        if (status === "ACTIVE" && !record.isActive) return false;
        if (status === "CLOSED" && record.isActive) return false;
        if (side !== "ALL" && record.side.toUpperCase() !== side) return false;
        if (outcome !== "ALL" && record.resultLabel !== outcome) return false;
        return true;
    });
}

export default function TradeHistoryAuditPanel({ enabled }: { enabled: boolean }) {
    const pathname = usePathname();
    const router = useRouter();
    const searchParams = useSearchParams();
    const {
        status,
        snapshot,
        error,
        refresh,
        activeRecordId,
        detailStatus,
        detail,
        detailError,
        inspect,
        clearDetail,
    } = useTradeHistoryAudit({ enabled });
    const { status: discrepancyStatus, snapshot: discrepancySnapshot, error: discrepancyError, load: loadDiscrepancy, clear: clearDiscrepancy } = useTradingDiscrepancy();
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [discrepancyDrawerOpen, setDiscrepancyDrawerOpen] = useState(false);
    const [originContext, setOriginContext] = useState<SignalVersionOriginContext | null>(null);
    const [investigationParams, setInvestigationParams] = useState<TradingDiagnosisRequestParams | null>(null);
    const [deepLinked, setDeepLinked] = useState(false);

    // Filter state from URL
    const filterStatus = (searchParams.get("status")?.toUpperCase() as StatusFilter) || "ALL";
    const filterSide = (searchParams.get("side")?.toUpperCase() as SideFilter) || "ALL";
    const filterOutcome = (searchParams.get("outcome")?.toUpperCase() as OutcomeFilter) || "ALL";

    // Deep-link: auto-open drawer when ?recordId= is present
    const urlRecordId = searchParams.get("recordId");

    useEffect(() => {
        if (urlRecordId && status === "ready" && snapshot && !deepLinked) {
            setDeepLinked(true);
            setDrawerOpen(true);
            void inspect(urlRecordId);
        }
    }, [urlRecordId, status, snapshot, deepLinked, inspect]);

    const updateSearchParam = useCallback((key: string, value: string, removeIfDefault = "ALL") => {
        const params = new URLSearchParams(searchParams.toString());
        if (value === removeIfDefault) {
            params.delete(key);
        } else {
            params.set(key, value.toLowerCase());
        }
        const query = params.toString();
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }, [pathname, router, searchParams]);

    const pushRecordIdParam = useCallback((recordId: string) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set("recordId", recordId);
        const query = params.toString();
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }, [pathname, router, searchParams]);

    const clearRecordIdParam = useCallback(() => {
        const params = new URLSearchParams(searchParams.toString());
        params.delete("recordId");
        const query = params.toString();
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }, [pathname, router, searchParams]);

    const view = snapshot ? buildTradeHistoryAuditListView(snapshot) : null;

    const filteredRecords = useMemo(() => {
        if (!view) return [];
        return applyFilters(view.records, filterStatus, filterSide, filterOutcome);
    }, [view, filterStatus, filterSide, filterOutcome]);

    if (!enabled) {
        return (
            <StateBanner
                tone="neutral"
                title="Read tier required"
                message="Enable FEATURE_TRADING_READ to review trade history and audit timelines."
                className="rounded-2xl"
            />
        );
    }

    return (
        <>
            <section className="rounded-3xl border border-border-muted bg-bg-primary/90 p-5">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <div className="text-sm font-black text-text-primary">Trade History & Audit Timeline</div>
                        <p className="mt-1 text-sm text-text-secondary">
                            Review recent trade records and their linked audit activity in one operator-facing surface.
                            Drill into a record without losing the surrounding history list.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => { void refresh(); }}
                        disabled={status === "loading"}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border-muted bg-bg-tertiary px-3 py-1.5 text-xs font-bold text-text-primary disabled:cursor-wait disabled:opacity-60"
                    >
                        <RefreshCcw className="h-3.5 w-3.5" />
                        Refresh
                    </button>
                </div>

                {status === "loading" && !snapshot ? (
                    <div className="mt-4 flex items-center gap-2 text-sm text-text-secondary">
                        <Loader2 className="h-4 w-4 animate-spin text-accent" />
                        Loading trade history and audit coverage...
                    </div>
                ) : null}

                {error ? (
                    <StateBanner
                        tone="caution"
                        title="Trade history fetch failed"
                        icon={<AlertTriangle className="h-4 w-4" />}
                        message={`${error}. ${snapshot ? "Showing the last known history snapshot." : "Trade history remains unavailable until the request succeeds."}`}
                        className="mt-4 rounded-2xl"
                    />
                ) : null}

                {view && view.hasRecords ? (
                    <>
                        <div className="mt-4 flex flex-wrap items-center gap-3">
                            <p className="text-sm font-black text-text-primary">{view.headline}</p>
                            <span className="rounded-full border border-border-muted bg-bg-tertiary px-3 py-1 text-[11px] font-bold text-text-secondary">
                                {view.summaryLine}
                            </span>
                        </div>

                        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                            {view.metrics.map((metric) => (
                                <div
                                    key={metric.label}
                                    className={`rounded-2xl border px-4 py-3 ${toneStyles[metric.tone]}`}
                                >
                                    <div className="text-[10px] font-bold uppercase tracking-[0.16em] opacity-70">
                                        {metric.label}
                                    </div>
                                    <div className="mt-2 text-lg font-black">{metric.value}</div>
                                </div>
                            ))}
                        </div>

                        {/* Filter tabs */}
                        <div className="mt-4 flex flex-wrap items-center gap-2">
                            <FilterTabGroup options={statusFilters} value={filterStatus} onChange={(v) => updateSearchParam("status", v)} />
                            <FilterTabGroup options={sideFilters} value={filterSide} onChange={(v) => updateSearchParam("side", v)} />
                            <FilterTabGroup options={outcomeFilters} value={filterOutcome} onChange={(v) => updateSearchParam("outcome", v)} />
                            {filteredRecords.length !== view.records.length ? (
                                <span className="text-[11px] font-bold text-text-muted">
                                    {filteredRecords.length} / {view.records.length}
                                </span>
                            ) : null}
                        </div>

                        <div className="mt-4 space-y-3">
                            {filteredRecords.map((record) => (
                                <article
                                    key={record.recordId}
                                    className={`rounded-2xl border p-4 ${
                                        activeRecordId === record.recordId
                                            ? "border-accent/40 bg-accent/8"
                                            : "border-border-muted bg-bg-primary/70"
                                    }`}
                                >
                                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <div className="text-sm font-black text-text-primary">{record.title}</div>
                                                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${toneStyles[record.resultTone]}`}>
                                                    {record.isActive ? (
                                                        <span className="inline-block h-2 w-2 rounded-full bg-accent animate-pulse-dot" />
                                                    ) : null}
                                                    {record.resultLabel}
                                                </span>
                                                <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${toneStyles[record.auditTone]}`}>
                                                    {record.auditLabel}
                                                </span>
                                            </div>
                                            <div className="mt-1 text-xs text-text-muted">{record.subtitle}</div>
                                            <div className="mt-2 text-xs font-bold uppercase tracking-[0.16em] text-accent">
                                                {record.signalLabel}
                                            </div>
                                        </div>

                                        <div className="flex flex-wrap justify-end gap-2">
                                            {record.signalCode && record.signalVersion !== null ? (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        const signalCode = record.signalCode;
                                                        const signalVersion = record.signalVersion;
                                                        if (!signalCode || signalVersion === null) {
                                                            return;
                                                        }
                                                        setOriginContext({
                                                            label: "Reported Issue",
                                                            detail: `${record.title} | ${record.subtitle}`,
                                                        });
                                                        setInvestigationParams({
                                                            code: signalCode,
                                                            version: signalVersion,
                                                            backtestRunId: record.backtestRunId,
                                                            tradeRecordId: record.recordId,
                                                        });
                                                        setDiscrepancyDrawerOpen(true);
                                                        void loadDiscrepancy({
                                                            code: signalCode,
                                                            version: signalVersion,
                                                            backtestRunId: record.backtestRunId,
                                                            tradeRecordId: record.recordId,
                                                        });
                                                    }}
                                                    className="inline-flex items-center gap-1.5 rounded-full border border-border-muted bg-bg-tertiary px-3 py-1.5 text-xs font-bold text-text-primary transition-colors hover:border-accent hover:text-accent"
                                                >
                                                    <Search className="h-3 w-3" />
                                                    Investigate
                                                </button>
                                            ) : null}
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setDrawerOpen(true);
                                                    pushRecordIdParam(record.recordId);
                                                    void inspect(record.recordId);
                                                }}
                                                className="inline-flex items-center gap-1.5 rounded-full border border-border-muted bg-bg-tertiary px-3 py-1.5 text-xs font-bold text-text-primary transition-colors hover:border-accent hover:text-accent"
                                            >
                                                <Search className="h-3 w-3" />
                                                Inspect
                                            </button>
                                            <Link
                                                href={`/trading/history/${encodeURIComponent(record.recordId)}`}
                                                className="inline-flex items-center gap-1.5 rounded-full border border-border-muted bg-bg-tertiary px-3 py-1.5 text-xs font-bold text-text-primary transition-colors hover:border-accent hover:text-accent"
                                            >
                                                <ExternalLink className="h-3 w-3" />
                                                Full Page
                                            </Link>
                                        </div>
                                    </div>

                                    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                                        <div className="rounded-xl border border-border-muted bg-bg-tertiary/50 p-3">
                                            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-text-muted">
                                                Entry
                                            </div>
                                            <div className="mt-1 text-sm font-bold text-text-primary">{record.entryLabel}</div>
                                        </div>
                                        <div className="rounded-xl border border-border-muted bg-bg-tertiary/50 p-3">
                                            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-text-muted">
                                                Exit
                                            </div>
                                            <div className="mt-1 text-sm font-bold text-text-primary">{record.exitLabel}</div>
                                        </div>
                                        <div className="rounded-xl border border-border-muted bg-bg-tertiary/50 p-3">
                                            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-text-muted">
                                                PnL
                                            </div>
                                            <div className={`mt-1 text-sm font-bold ${record.pnlTone === "success" ? "text-price-up" : record.pnlTone === "danger" ? "text-price-down" : "text-text-primary"}`}>
                                                {record.pnlLabel}
                                            </div>
                                        </div>
                                        <div className="rounded-xl border border-border-muted bg-bg-tertiary/50 p-3">
                                            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-text-muted">
                                                Timeline
                                            </div>
                                            <div className="mt-1 text-sm font-bold text-text-primary">{record.timelineSummary}</div>
                                        </div>
                                    </div>

                                    {record.isActive && record.riskDistanceLabel ? (
                                        <div className="mt-3 flex items-center gap-2 rounded-xl border border-accent/20 bg-accent/8 px-3 py-2">
                                            <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-accent animate-pulse-dot" />
                                            <span className="text-xs font-bold text-accent">{record.riskDistanceLabel}</span>
                                            <span className="ml-auto text-[11px] font-bold text-accent/70">1R = {record.riskDistancePct}</span>
                                        </div>
                                    ) : null}

                                    {record.notes ? (
                                        <div className="mt-3 rounded-xl border border-border-muted bg-bg-tertiary/50 px-3 py-2 text-xs text-text-secondary">
                                            {record.notes}
                                        </div>
                                    ) : null}
                                </article>
                            ))}

                            {filteredRecords.length === 0 ? (
                                <div className="rounded-2xl border border-border-muted bg-bg-tertiary/30 px-4 py-3 text-sm text-text-secondary">
                                    No records match the current filters.
                                </div>
                            ) : null}
                        </div>
                    </>
                ) : null}

                {status === "ready" && snapshot && snapshot.records.length === 0 ? (
                    <div className="mt-4 flex items-center gap-2 rounded-2xl border border-price-up/20 bg-price-up/8 px-4 py-3 text-sm font-bold text-price-up">
                        <CheckCircle2 className="h-4 w-4 shrink-0" />
                        No trade history records are currently available for operator review.
                    </div>
                ) : null}
            </section>

            <TradeHistoryAuditDrawer
                isOpen={drawerOpen}
                detail={detail}
                isLoading={detailStatus === "loading"}
                error={detailError}
                onClose={() => {
                    setDrawerOpen(false);
                    clearRecordIdParam();
                    clearDetail();
                }}
            />

            <TradingDiscrepancyDrawer
                isOpen={discrepancyDrawerOpen}
                snapshot={discrepancySnapshot}
                isLoading={discrepancyStatus === "loading"}
                error={discrepancyError}
                originContext={originContext}
                requestParams={investigationParams}
                onClose={() => {
                    setDiscrepancyDrawerOpen(false);
                    setOriginContext(null);
                    setInvestigationParams(null);
                    clearDiscrepancy();
                }}
            />
        </>
    );
}
