"use client";

import { useState } from "react";
import {
    AlertTriangle,
    CheckCircle2,
    Clock,
    Database,
    Loader2,
    RefreshCcw,
    Search,
    XCircle,
    PlayCircle,
} from "lucide-react";
import StartPaperTradingWizard from "@/components/trading/StartPaperTradingWizard";
import {
    buildSignalEligibilityCardView,
    buildSignalEligibilityListView,
    SignalEligibilityCardView,
} from "@/lib/signalLiveEligibilityView";
import { useSignalLiveEligibility } from "@/hooks/useSignalLiveEligibility";
import { useSignalVersionContext } from "@/hooks/useSignalVersionContext";
import { SignalEligibilityState, SignalVersionOriginContext } from "@/types/trading";
import StateBanner from "@/components/ui/StateBanner";
import SignalVersionInspectorDrawer from "@/components/trading/SignalVersionInspectorDrawer";

const stateIcons: Record<SignalEligibilityState, typeof CheckCircle2> = {
    "live-eligible": CheckCircle2,
    validated: Clock,
    blocked: XCircle,
    draft: Clock,
    "no-backtest": Database,
};

const stateBadgeStyles: Record<SignalEligibilityState, string> = {
    "live-eligible": "border-price-up/30 bg-price-up/10 text-price-up",
    validated: "border-accent/30 bg-accent/10 text-accent",
    blocked: "border-price-down/30 bg-price-down/10 text-price-down",
    draft: "border-border-muted bg-bg-tertiary text-text-secondary",
    "no-backtest": "border-border-muted bg-bg-tertiary text-text-muted",
};

function EligibilityCard({
    card,
    onInspect,
    onStartPaperTrading,
}: {
    card: SignalEligibilityCardView;
    onInspect: (card: SignalEligibilityCardView) => void;
    onStartPaperTrading: (card: SignalEligibilityCardView) => void;
}) {
    const Icon = stateIcons[card.eligibilityState];

    return (
        <article className="rounded-2xl border border-border-muted bg-bg-primary/90 p-4">
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <div className="truncate text-sm font-black text-text-primary">{card.signalName}</div>
                    <div className="mt-0.5 text-[11px] font-bold uppercase tracking-[0.14em] text-text-muted">
                        {card.codeLabel}
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                    {card.frequencyLabel ? (
                        <span className="inline-flex items-center rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] font-bold text-accent">
                            {card.frequencyLabel}
                        </span>
                    ) : null}
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${stateBadgeStyles[card.eligibilityState]}`}>
                        <Icon className="h-3 w-3" />
                        {card.stateLabel}
                    </span>
                </div>
            </div>

            {card.metricsAvailable ? (
                <div className="mt-3 space-y-2">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <div className="rounded-xl border border-border-muted bg-bg-tertiary/60 p-2.5">
                            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-text-muted">Trades</div>
                            <div className="mt-1 text-sm font-black text-text-primary">{card.closedTradesLabel}</div>
                        </div>
                        <div className="rounded-xl border border-border-muted bg-bg-tertiary/60 p-2.5">
                            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-text-muted">Net R</div>
                            <div className={`mt-1 text-sm font-black ${card.netRLabel.startsWith("+") ? "text-price-up" : "text-price-down"}`}>
                                {card.netRLabel}
                            </div>
                        </div>
                        <div className="rounded-xl border border-border-muted bg-bg-tertiary/60 p-2.5">
                            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-text-muted">PF</div>
                            <div className="mt-1 text-sm font-black text-text-primary">{card.profitFactorLabel}</div>
                        </div>
                        <div className="rounded-xl border border-border-muted bg-bg-tertiary/60 p-2.5">
                            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-text-muted">Max DD</div>
                            <div className="mt-1 text-sm font-black text-text-primary">{card.maxDrawdownLabel}</div>
                        </div>
                    </div>
                    {/* New badges row */}
                    <div className="flex flex-wrap items-center gap-2">
                        {card.confidenceTier ? (
                            <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.14em] ${
                                card.confidenceTier === "HIGH"
                                    ? "border-price-up/30 bg-price-up/10 text-price-up"
                                    : card.confidenceTier === "VALIDATED"
                                        ? "border-accent/30 bg-accent/10 text-accent"
                                        : "border-border-muted bg-bg-tertiary text-text-muted"
                            }`}>
                                {card.confidenceTier === "HIGH" ? "High confidence" : card.confidenceTier === "VALIDATED" ? "Validated" : "Limited data"}
                            </span>
                        ) : null}
                        {card.rrRatioLabel ? (
                            <span className="rounded-full border border-border-muted bg-bg-tertiary px-2.5 py-0.5 text-[10px] font-bold text-text-secondary">
                                R:R {card.rrRatioLabel}
                            </span>
                        ) : null}
                    </div>
                </div>
            ) : null}

            {card.hasBlockingReasons ? (
                <div className="mt-3 space-y-1.5">
                    {card.blockingReasons.map((reason) => (
                        <div
                            key={reason.code}
                            className={`rounded-xl border px-3 py-2 text-[11px] leading-5 ${
                                card.eligibilityState === "blocked"
                                    ? "border-price-down/20 bg-price-down/8 text-price-down/90"
                                    : "border-border-muted bg-bg-tertiary/50 text-text-secondary"
                            }`}
                        >
                            {reason.label}
                        </div>
                    ))}
                </div>
            ) : null}

            {card.canProceedToActivation ? (
                <div className="mt-3 rounded-xl border border-price-up/20 bg-price-up/8 px-3 py-2 text-[11px] leading-5 text-price-up/90">
                    This signal meets all live-eligibility thresholds. Live activation review is
                    available in the next step - account credential and connection readiness must be
                    confirmed before the activation sequence can open.
                </div>
            ) : null}

            <div className="mt-3 flex items-center justify-between gap-2">
                {card.canProceedToActivation ? (
                    <button
                        type="button"
                        onClick={() => { onStartPaperTrading(card); }}
                        className="inline-flex items-center gap-1.5 rounded-full border border-price-up/40 bg-price-up/10 px-3 py-1.5 text-xs font-bold text-price-up transition-colors hover:bg-price-up/20"
                    >
                        <PlayCircle className="h-3 w-3" />
                        Start Paper Trading
                    </button>
                ) : <div />}
                <button
                    type="button"
                    onClick={() => { onInspect(card); }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border-muted bg-bg-tertiary px-3 py-1.5 text-xs font-bold text-text-primary transition-colors hover:border-accent hover:text-accent"
                >
                    <Search className="h-3 w-3" />
                    Inspect Version
                </button>
            </div>
        </article>
    );
}

export default function SignalLiveEligibilityPanel({ enabled }: { enabled: boolean }) {
    const { status, items, error, refresh } = useSignalLiveEligibility({ enabled });
    const { status: versionStatus, snapshot, error: versionError, load: loadVersion } = useSignalVersionContext();
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [originContext, setOriginContext] = useState<SignalVersionOriginContext | null>(null);
    const [wizardCard, setWizardCard] = useState<SignalEligibilityCardView | null>(null);

    const view = buildSignalEligibilityListView(items);

    const handleStartPaperTrading = (card: SignalEligibilityCardView) => {
        setWizardCard(card);
    };

    const handleInspect = (card: SignalEligibilityCardView) => {
        const detailParts = [
            card.stateLabel,
            card.backtestRunName ?? null,
            card.backtestRunStatus ? `status ${card.backtestRunStatus}` : null,
        ].filter((value): value is string => Boolean(value));

        setOriginContext({
            label: "Eligibility Investigation",
            detail: detailParts.join(" | "),
        });
        setDrawerOpen(true);
        void loadVersion({
            code: card.signalCode,
            version: card.signalVersion,
            backtestRunId: card.backtestRunId,
        });
    };

    if (!enabled) {
        return (
            <StateBanner
                tone="neutral"
                title="Read tier required"
                message="Enable FEATURE_TRADING_READ for eligibility."
                className="rounded-2xl"
            />
        );
    }

    return (
        <>
        <section className="rounded-3xl border border-border-muted bg-bg-primary/90 p-5">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <div className="text-sm font-black text-text-primary">Signal Live Eligibility</div>
                    <p className="mt-1 text-sm text-text-secondary">
                        Each signal is evaluated against its most recent completed backtest. Blocking
                        reasons appear in plain language so you know exactly what must change before
                        live activation can be considered.
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

            {status === "loading" && items.length === 0 ? (
                <div className="mt-4 flex items-center gap-2 text-sm text-text-secondary">
                    <Loader2 className="h-4 w-4 animate-spin text-accent" />
                    Evaluating signal eligibility…
                </div>
            ) : null}

            {error ? (
                <StateBanner
                    tone="caution"
                    title="Eligibility fetch failed"
                    icon={<AlertTriangle className="h-4 w-4" />}
                    message={`${error}. ${items.length > 0 ? "Showing last snapshot." : "Unavailable until resolved."}`}
                    className="mt-4 rounded-2xl"
                />
            ) : null}

            {status === "ready" && items.length === 0 ? (
                <StateBanner
                    tone="neutral"
                    title="No signal definitions found"
                    message="Create a signal definition to evaluate."
                    className="mt-4 rounded-2xl"
                />
            ) : null}

            {items.length > 0 ? (
                <>
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                        <p className="text-sm font-black text-text-primary">{view.headline}</p>
                        <span className="rounded-full border border-border-muted bg-bg-tertiary px-3 py-1 text-[11px] font-bold text-text-secondary">
                            {view.summaryLine}
                        </span>
                    </div>
                    <div className="mt-4 grid gap-3 lg:grid-cols-2">
                        {view.cards.map((card) => (
                            <EligibilityCard
                                key={`${card.signalCode}-${card.signalVersion}`}
                                card={card}
                                onInspect={handleInspect}
                                onStartPaperTrading={handleStartPaperTrading}
                            />
                        ))}
                    </div>
                </>
            ) : null}
        </section>

        <SignalVersionInspectorDrawer
            isOpen={drawerOpen}
            snapshot={snapshot}
            isLoading={versionStatus === "loading"}
            error={versionError}
            originContext={originContext}
            onClose={() => {
                setDrawerOpen(false);
                setOriginContext(null);
            }}
        />

        {wizardCard ? (
            <StartPaperTradingWizard
                signalCode={wizardCard.signalCode}
                signalVersion={wizardCard.signalVersion}
                signalName={wizardCard.signalName}
                onClose={() => { setWizardCard(null); }}
                onSuccess={() => { void refresh(); }}
            />
        ) : null}
        </>
    );
}
