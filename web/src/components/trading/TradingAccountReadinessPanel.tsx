"use client";

import {
    AlertTriangle,
    CheckCircle2,
    Loader2,
    RefreshCcw,
    Server,
    ShieldAlert,
    XCircle,
} from "lucide-react";
import { buildAccountReadinessCardView } from "@/lib/tradingAccountReadinessView";
import { useTradingAccountReadiness } from "@/hooks/useTradingAccountReadiness";
import { AccountReadinessState } from "@/types/trading";
import StateBanner from "@/components/ui/StateBanner";
import { useAppLocale } from "@/hooks/useAppLocale";

const stateIcons: Record<AccountReadinessState, typeof CheckCircle2> = {
    ready: CheckCircle2,
    "execution-blocked": AlertTriangle,
    "credentials-missing": XCircle,
    "credentials-partial": ShieldAlert,
    "bridge-unreachable": Server,
    unchecked: Server,
};

const stateBadgeStyles: Record<AccountReadinessState, string> = {
    ready: "border-price-up/30 bg-price-up/10 text-price-up",
    "execution-blocked": "border-price-down/30 bg-price-down/10 text-price-down",
    "credentials-missing": "border-price-down/30 bg-price-down/10 text-price-down",
    "credentials-partial": "border-amber-400/30 bg-amber-400/10 text-amber-100",
    "bridge-unreachable": "border-amber-400/30 bg-amber-400/10 text-amber-100",
    unchecked: "border-border-muted bg-bg-tertiary text-text-muted",
};

export default function TradingAccountReadinessPanel({
    readEnabled,
    refreshToken = 0,
    accountId = null,
}: {
    readEnabled: boolean;
    refreshToken?: number;
    accountId?: string | null;
}) {
    const { status, snapshot, error, refresh } = useTradingAccountReadiness({
        enabled: true,
        refreshToken,
        accountId,
    });
    const card = buildAccountReadinessCardView(snapshot);
    const Icon = stateIcons[card.state];
    const { copy } = useAppLocale();

    return (
        <section className="rounded-3xl border border-border-muted bg-bg-primary/90 p-5">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <div className="text-sm font-black text-text-primary">{copy.tradingReadiness.title}</div>
                    <p className="mt-1 text-sm text-text-secondary">
                        {copy.tradingReadiness.description}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => { void refresh(); }}
                    disabled={status === "loading"}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border-muted bg-bg-tertiary px-3 py-1.5 text-xs font-bold text-text-primary disabled:cursor-wait disabled:opacity-60"
                >
                    <RefreshCcw className="h-3.5 w-3.5" />
                    {copy.tradingReadiness.refresh}
                </button>
            </div>

            {!readEnabled ? (
                <StateBanner
                    tone="neutral"
                    title={copy.tradingReadiness.tradingReadBlocked}
                    icon={<ShieldAlert className="h-4 w-4" />}
                    message={copy.tradingReadiness.mt5SetupReadNeeded}
                    className="mt-4 rounded-2xl"
                />
            ) : null}

            {status === "loading" && !snapshot ? (
                <div className="mt-4 flex items-center gap-2 text-sm text-text-secondary">
                    <Loader2 className="h-4 w-4 animate-spin text-accent" />
                    {copy.tradingReadiness.evaluatingReadiness}
                </div>
            ) : null}

            {error ? (
                <StateBanner
                    tone="caution"
                    title={copy.tradingReadiness.readinessCheckFailed}
                    icon={<AlertTriangle className="h-4 w-4" />}
                    message={`${error}. ${snapshot ? "Showing last snapshot." : "Unknown until resolved."}`}
                    className="mt-4 rounded-2xl"
                />
            ) : null}

            {snapshot ? (
                <article className="mt-4 rounded-2xl border border-border-muted bg-bg-primary/90 p-4">
                    <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 text-sm font-black text-text-primary">
                                {card.headline}
                                {card.accountModeLabel !== "-" ? (
                                    <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.14em] ${
                                        snapshot?.accountMode === "PAPER"
                                            ? "border-accent/30 bg-accent/10 text-accent"
                                            : "border-price-down/30 bg-price-down/10 text-price-down"
                                    }`}>
                                        {card.accountModeLabel}
                                    </span>
                                ) : null}
                            </div>
                            <p className="mt-1 text-xs text-text-secondary">{card.summary}</p>
                        </div>
                        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${stateBadgeStyles[card.state]}`}>
                            <Icon className="h-3 w-3" />
                            {card.stateLabel}
                        </span>
                    </div>

                    <div className="mt-3 grid gap-2 md:grid-cols-5">
                        <div className="rounded-xl border border-border-muted bg-bg-tertiary/60 p-2.5">
                            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-text-muted">
                                {copy.tradingReadiness.account}
                            </div>
                            <div className="mt-1 text-sm font-black text-text-primary">{card.accountLabel}</div>
                        </div>
                        <div className="rounded-xl border border-border-muted bg-bg-tertiary/60 p-2.5">
                            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-text-muted">
                                {copy.tradingReadiness.mode}
                            </div>
                            <div className="mt-1 text-sm font-black text-text-primary">{card.accountModeLabel}</div>
                        </div>
                        <div className="rounded-xl border border-border-muted bg-bg-tertiary/60 p-2.5">
                            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-text-muted">
                                {copy.tradingReadiness.mt5Login}
                            </div>
                            <div className="mt-1 text-sm font-black text-text-primary">{card.mt5LoginLabel}</div>
                        </div>
                        <div className="rounded-xl border border-border-muted bg-bg-tertiary/60 p-2.5">
                            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-text-muted">
                                {copy.tradingReadiness.mt5Server}
                            </div>
                            <div className="mt-1 text-sm font-black text-text-primary">{card.mt5ServerLabel}</div>
                        </div>
                        <div className="rounded-xl border border-border-muted bg-bg-tertiary/60 p-2.5">
                            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-text-muted">
                                {copy.tradingReadiness.bridgePort}
                            </div>
                            <div className="mt-1 text-sm font-black text-text-primary">{card.bridgePortLabel}</div>
                        </div>
                    </div>

                    <div className="mt-3 space-y-1.5">
                        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-text-muted">
                            {copy.tradingReadiness.readinessChecks} ({card.passedCount}/{card.totalCount})
                        </div>
                        {card.checks.map((check) => (
                            <div
                                key={check.key}
                                className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-[11px] leading-5 ${
                                    check.passed
                                        ? "border-price-up/15 bg-price-up/5 text-price-up/90"
                                        : "border-price-down/20 bg-price-down/8 text-price-down/90"
                                }`}
                            >
                                {check.passed
                                    ? <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />
                                    : <XCircle className="mt-0.5 h-3 w-3 shrink-0" />}
                                <div>
                                    <span className="font-bold">{check.label}:</span>{" "}
                                    {check.detail}
                                </div>
                            </div>
                        ))}
                    </div>

                    {card.hasBlockingReasons ? (
                        <div className="mt-3 space-y-1.5">
                            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-text-muted">
                                {copy.tradingReadiness.blockingReasons}
                            </div>
                            {card.blockingReasons.map((reason, i) => (
                                <div
                                    key={`block-${i}`}
                                    className="rounded-xl border border-price-down/20 bg-price-down/8 px-3 py-2 text-[11px] leading-5 text-price-down/90"
                                >
                                    {reason}
                                </div>
                            ))}
                        </div>
                    ) : null}

                    {card.canProceedToActivation ? (
                        <div className="mt-3 rounded-xl border border-price-up/20 bg-price-up/8 px-3 py-2 text-[11px] leading-5 text-price-up/90">
                            {copy.tradingReadiness.readyToActivate}
                        </div>
                    ) : null}
                </article>
            ) : null}
        </section>
    );
}
