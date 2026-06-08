"use client";

import { useState } from "react";
import {
    AlertTriangle,
    CheckCircle2,
    Loader2,
    RefreshCcw,
    Search,
    XCircle,
} from "lucide-react";
import { useFailureClassification } from "@/hooks/useFailureClassification";
import { useTradingDiscrepancy } from "@/hooks/useTradingDiscrepancy";
import { useSignalVersionContext } from "@/hooks/useSignalVersionContext";
import {
    buildFailureClassificationView,
    DomainStatusView,
    FailureItemView,
} from "@/lib/failureClassificationView";
import {
    FailureSeverity,
    SignalVersionOriginContext,
    TradingDiagnosisRequestParams,
} from "@/types/trading";
import StateBanner from "@/components/ui/StateBanner";
import SignalVersionInspectorDrawer from "@/components/trading/SignalVersionInspectorDrawer";
import TradingDiscrepancyDrawer from "@/components/trading/TradingDiscrepancyDrawer";

const domainToneStyles: Record<DomainStatusView["tone"], string> = {
    danger: "border-price-down/30 bg-price-down/8",
    caution: "border-accent/30 bg-accent/8",
    success: "border-border-muted bg-bg-tertiary/40",
};

const domainBadgeStyles: Record<DomainStatusView["tone"], string> = {
    danger: "border-price-down/30 bg-price-down/10 text-price-down",
    caution: "border-accent/30 bg-accent/10 text-accent",
    success: "border-price-up/30 bg-price-up/10 text-price-up",
};

const itemSeverityStyles: Record<FailureSeverity, string> = {
    critical: "border-price-down/20 bg-price-down/8 text-price-down/90",
    warning: "border-accent/20 bg-accent/8 text-accent/90",
    ok: "border-border-muted bg-bg-tertiary text-text-secondary",
};

function buildOriginContext(item: FailureItemView): SignalVersionOriginContext {
    const detailParts = [
        item.title,
        item.symbol && item.timeframe ? `${item.symbol} / ${item.timeframe}` : null,
        item.detectedAt,
    ].filter((part): part is string => Boolean(part));

    return {
        label: "Incident Investigation",
        detail: detailParts.join(" | "),
    };
}

function FailureItem({
    item,
    onInspect,
    onInvestigate,
}: {
    item: FailureItemView;
    onInspect: (item: FailureItemView) => void;
    onInvestigate: (item: FailureItemView) => void;
}) {
    return (
        <div className={`rounded-xl border px-3 py-2.5 text-sm ${itemSeverityStyles[item.severity]}`}>
            <div className="flex items-center justify-between gap-2">
                <span className="font-bold">{item.title}</span>
                <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.16em] ${itemSeverityStyles[item.severity]}`}
                >
                    {item.severityLabel}
                </span>
            </div>
            <p className="mt-1 text-xs leading-5 opacity-90">{item.detail}</p>
            <div className="mt-2 flex items-center justify-between gap-3">
                <p className="text-[11px] opacity-60">Detected: {item.detectedAt}</p>
                <div className="flex flex-wrap justify-end gap-2">
                    {item.canInvestigate ? (
                        <button
                            type="button"
                            onClick={() => { onInvestigate(item); }}
                            className="inline-flex items-center gap-1 rounded-full border border-current/20 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em]"
                        >
                            <Search className="h-3 w-3" />
                            Investigate
                        </button>
                    ) : null}
                    {item.isInspectable ? (
                        <button
                            type="button"
                            onClick={() => { onInspect(item); }}
                            className="inline-flex items-center gap-1 rounded-full border border-current/20 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em]"
                        >
                            <Search className="h-3 w-3" />
                            Inspect Version
                        </button>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

function DomainCard({
    domain,
    onInspect,
    onInvestigate,
}: {
    domain: DomainStatusView;
    onInspect: (item: FailureItemView) => void;
    onInvestigate: (item: FailureItemView) => void;
}) {
    const DomainIcon =
        domain.tone === "danger" ? XCircle :
        domain.tone === "caution" ? AlertTriangle :
        CheckCircle2;

    return (
        <article className={`rounded-2xl border p-4 ${domainToneStyles[domain.tone]}`}>
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <div className="truncate text-sm font-black text-text-primary">{domain.domainLabel}</div>
                    <p className="mt-0.5 text-xs text-text-secondary">{domain.domainDescription}</p>
                </div>
                <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${domainBadgeStyles[domain.tone]}`}>
                    <DomainIcon className="h-3 w-3" />
                    {domain.severityLabel}
                </span>
            </div>

            {domain.hasItems ? (
                <div className="mt-3 space-y-2">
                    {domain.items.map((item) => (
                        <FailureItem
                            key={item.id}
                            item={item}
                            onInspect={onInspect}
                            onInvestigate={onInvestigate}
                        />
                    ))}
                </div>
            ) : null}
        </article>
    );
}

export default function FailureClassificationPanel({ enabled }: { enabled: boolean }) {
    const { status, snapshot, error, refresh } = useFailureClassification({ enabled });
    const { status: versionStatus, snapshot: versionSnapshot, error: versionError, load: loadVersion } = useSignalVersionContext();
    const { status: discrepancyStatus, snapshot: discrepancySnapshot, error: discrepancyError, load: loadDiscrepancy, clear: clearDiscrepancy } = useTradingDiscrepancy();
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [discrepancyDrawerOpen, setDiscrepancyDrawerOpen] = useState(false);
    const [versionOriginContext, setVersionOriginContext] = useState<SignalVersionOriginContext | null>(null);
    const [discrepancyOriginContext, setDiscrepancyOriginContext] = useState<SignalVersionOriginContext | null>(null);
    const [investigationParams, setInvestigationParams] = useState<TradingDiagnosisRequestParams | null>(null);

    if (!enabled) {
        return (
            <StateBanner
                tone="neutral"
                title="Read tier required"
                message="Enable FEATURE_TRADING_READ to inspect domain failure classification."
                className="rounded-2xl"
            />
        );
    }

    const view = snapshot ? buildFailureClassificationView(snapshot) : null;

    const handleInspect = (item: FailureItemView) => {
        if (!item.signalCode || item.signalVersion === null) {
            return;
        }

        setVersionOriginContext(buildOriginContext(item));
        setDrawerOpen(true);
        void loadVersion({
            code: item.signalCode,
            version: item.signalVersion,
            backtestRunId: item.backtestRunId,
            indicatorInstanceId: item.indicatorInstanceId,
        });
    };

    const handleInvestigate = (item: FailureItemView) => {
        if (!item.signalCode || item.signalVersion === null || !item.canInvestigate) {
            return;
        }

        setDiscrepancyOriginContext({
            label: "Alert Investigation",
            detail: [
                item.title,
                item.symbol && item.timeframe ? `${item.symbol} / ${item.timeframe}` : null,
                item.detectedAt,
            ].filter((part): part is string => Boolean(part)).join(" | "),
        });
        setInvestigationParams({
            code: item.signalCode,
            version: item.signalVersion,
            backtestRunId: item.backtestRunId,
            indicatorInstanceId: item.indicatorInstanceId,
        });
        setDiscrepancyDrawerOpen(true);
        void loadDiscrepancy({
            code: item.signalCode,
            version: item.signalVersion,
            backtestRunId: item.backtestRunId,
            indicatorInstanceId: item.indicatorInstanceId,
        });
    };

    return (
        <>
            <section className="rounded-3xl border border-border-muted bg-bg-primary/90 p-5">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <div className="text-sm font-black text-text-primary">Domain Failure Classification</div>
                        <p className="mt-1 text-sm text-text-secondary">
                            Failures are classified by domain so you can inspect incident records without flattening
                            signal, alert, and live-runtime issues into one ambiguous state.
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
                        Evaluating domain failures...
                    </div>
                ) : null}

                {error ? (
                    <StateBanner
                        tone="caution"
                        title="Classification fetch failed"
                        icon={<AlertTriangle className="h-4 w-4" />}
                        message={`${error}. ${snapshot ? "Showing the last known snapshot." : "Domain failure status unavailable until the request succeeds."}`}
                        className="mt-4 rounded-2xl"
                    />
                ) : null}

                {view ? (
                    <>
                        {view.hasAnyFailure ? (
                            <div className={`mt-4 rounded-2xl border px-4 py-3 ${
                                view.summaryTone === "danger"
                                    ? "border-price-down/30 bg-price-down/10 text-price-down"
                                    : "border-accent/30 bg-accent/10 text-accent"
                            }`}>
                                <div className="flex items-center gap-2">
                                    <AlertTriangle className="h-4 w-4 shrink-0" />
                                    <span className="text-sm font-black">{view.headline}</span>
                                </div>
                                <div className="mt-1 flex flex-wrap gap-3 text-xs font-bold opacity-80">
                                    {view.totalCritical > 0 ? <span>{view.totalCritical} critical</span> : null}
                                    {view.totalWarning > 0 ? <span>{view.totalWarning} warning</span> : null}
                                </div>
                            </div>
                        ) : (
                            <div className="mt-4 flex items-center gap-2 rounded-2xl border border-price-up/20 bg-price-up/8 px-4 py-3 text-sm font-bold text-price-up">
                                <CheckCircle2 className="h-4 w-4 shrink-0" />
                                {view.headline}
                            </div>
                        )}

                        <div className="mt-4 grid gap-3 lg:grid-cols-2">
                            {view.domains.map((domain) => (
                                <DomainCard
                                    key={domain.domain}
                                    domain={domain}
                                    onInspect={handleInspect}
                                    onInvestigate={handleInvestigate}
                                />
                            ))}
                        </div>
                    </>
                ) : null}
            </section>

            <SignalVersionInspectorDrawer
                isOpen={drawerOpen}
                snapshot={versionSnapshot}
                isLoading={versionStatus === "loading"}
                error={versionError}
                originContext={versionOriginContext}
                onClose={() => {
                    setDrawerOpen(false);
                    setVersionOriginContext(null);
                }}
            />

            <TradingDiscrepancyDrawer
                isOpen={discrepancyDrawerOpen}
                snapshot={discrepancySnapshot}
                isLoading={discrepancyStatus === "loading"}
                error={discrepancyError}
                originContext={discrepancyOriginContext}
                requestParams={investigationParams}
                onClose={() => {
                    setDiscrepancyDrawerOpen(false);
                    setDiscrepancyOriginContext(null);
                    setInvestigationParams(null);
                    clearDiscrepancy();
                }}
            />
        </>
    );
}
