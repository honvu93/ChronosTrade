"use client";

import {
    Activity,
    FileJson,
    Flag,
    Loader2,
    ScrollText,
    Shield,
    ShieldCheck,
    TrendingUp,
    X,
} from "lucide-react";
import { buildTradeHistoryAuditDetailView, resolveStageAnalysisFromAudit } from "@/lib/tradeHistoryAuditView";
import { Tone, toneStyles, factTextToneStyles } from "@/lib/toneStyles";
import { TradeHistoryAuditDetailSnapshot } from "@/types/trading";
import { BacktestTradeStageAnalysis } from "@/types/backtests";

const STAGE_COLORS = {
    1: { bg: "bg-price-down/12", text: "text-price-down", border: "border-price-down/30", dot: "bg-price-down", connector: "bg-price-down/40" },
    2: { bg: "bg-accent/12", text: "text-accent", border: "border-accent/30", dot: "bg-accent", connector: "bg-accent/40" },
    3: { bg: "bg-price-up/12", text: "text-price-up", border: "border-price-up/30", dot: "bg-price-up", connector: "bg-price-up/40" },
} as const;

const RISK_STATUS_CONFIG = {
    "at-risk": { label: "At Risk", tone: "text-price-down", bg: "bg-price-down/12" },
    "protected": { label: "Protected", tone: "text-accent", bg: "bg-accent/12" },
    "locked-profit": { label: "Locked Profit", tone: "text-price-up", bg: "bg-price-up/12" },
} as const;

function FactCard({
    label,
    value,
    tone = "neutral",
}: {
    label: string;
    value: string;
    tone?: Tone;
}) {
    return (
        <div className="rounded-2xl border border-border-muted bg-bg-primary/70 p-3">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">{label}</div>
            <div className={`mt-2 text-sm font-bold ${factTextToneStyles[tone]}`}>
                {value}
            </div>
        </div>
    );
}

function StageIndicator({ analysis }: { analysis: BacktestTradeStageAnalysis }) {
    const stageLabels = ["At Risk", "Protected", "Trailing"] as const;

    return (
        <div className="rounded-2xl border border-border-muted bg-bg-primary/70 p-4">
            <div className="flex items-center gap-3">
                {stageLabels.map((label, index) => {
                    const stageNum = (index + 1) as 1 | 2 | 3;
                    const isActive = analysis.currentStage >= stageNum;
                    const isCurrent = analysis.currentStage === stageNum;
                    const colors = STAGE_COLORS[stageNum];

                    return (
                        <div key={stageNum} className="flex items-center gap-3 flex-1">
                            <div className="flex items-center gap-2 flex-1">
                                <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-black ${
                                    isCurrent
                                        ? `${colors.bg} ${colors.text} ring-2 ring-current`
                                        : isActive
                                            ? `${colors.bg} ${colors.text}`
                                            : "bg-bg-tertiary text-text-muted"
                                }`}>
                                    {stageNum}
                                </div>
                                <span className={`text-[10px] font-bold uppercase tracking-[0.12em] ${isCurrent ? colors.text : isActive ? "text-text-secondary" : "text-text-muted"}`}>
                                    {label}
                                </span>
                            </div>
                            {stageNum < 3 && (
                                <div className={`h-px flex-1 ${isActive ? colors.connector : "bg-border-muted"}`} />
                            )}
                        </div>
                    );
                })}
            </div>
            <div className={`mt-2 text-sm font-bold ${STAGE_COLORS[analysis.currentStage as 1 | 2 | 3]?.text ?? "text-text-primary"}`}>
                {analysis.currentStageName}
            </div>
        </div>
    );
}

function LiveStatusPanel({ analysis }: { analysis: BacktestTradeStageAnalysis }) {
    const riskConfig = RISK_STATUS_CONFIG[analysis.currentRiskStatus];
    const RiskIcon = analysis.currentRiskStatus === "at-risk" ? Shield
        : analysis.currentRiskStatus === "protected" ? ShieldCheck
        : TrendingUp;

    return (
        <div className="rounded-2xl border border-border-muted bg-bg-primary/70 p-4">
            <div className="grid grid-cols-2 gap-3">
                <div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">Current R</div>
                    <div className={`mt-1 text-lg font-black ${analysis.currentR >= 0 ? "text-price-up" : "text-price-down"}`}>
                        {analysis.currentR >= 0 ? "+" : ""}{analysis.currentR.toFixed(1)}R
                    </div>
                </div>
                <div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">Risk</div>
                    <div className="mt-1 flex items-center gap-1.5">
                        <RiskIcon className={`h-4 w-4 ${riskConfig.tone}`} />
                        <span className={`text-sm font-black ${riskConfig.tone}`}>{riskConfig.label}</span>
                    </div>
                </div>
                <div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">Stop Loss</div>
                    <div className="mt-1 text-sm font-black text-text-primary">
                        {analysis.currentStopLoss.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </div>
                </div>
                <div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">Next</div>
                    <div className="mt-1 text-xs font-semibold text-text-secondary leading-snug">
                        {analysis.nextAction}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function TradeHistoryAuditDrawer({
    isOpen,
    detail,
    isLoading,
    error,
    onClose,
}: {
    isOpen: boolean;
    detail: TradeHistoryAuditDetailSnapshot | null;
    isLoading: boolean;
    error: string | null;
    onClose: () => void;
}) {
    if (!isOpen) return null;

    const view = detail ? buildTradeHistoryAuditDetailView(detail) : null;
    const stageAnalysis = detail ? resolveStageAnalysisFromAudit(detail) : null;

    return (
        <div
            role="dialog"
            aria-labelledby="trade-history-audit-title"
            aria-modal="false"
            className="fixed inset-y-0 right-0 z-[90] flex w-full max-w-[520px] flex-col border-l border-border-muted bg-bg-secondary shadow-[0_0_60px_rgba(0,0,0,0.45)]"
        >
            <div className="flex items-start justify-between gap-3 border-b border-border-muted bg-bg-primary px-5 py-4">
                <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-accent">
                        History Detail
                    </div>
                    <h2 id="trade-history-audit-title" className="mt-2 text-lg font-black text-text-primary">
                        {view?.title ?? "Trade history detail"}
                    </h2>
                    <div className="mt-1 text-xs text-text-muted">
                        {view?.subtitle ?? "Loading traceability context"}
                    </div>
                    {view ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${toneStyles[view.resultTone]}`}>
                                {view.resultLabel}
                            </span>
                            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${toneStyles[view.auditTone]}`}>
                                {view.auditLabel}
                            </span>
                        </div>
                    ) : null}
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    className="rounded-full border border-border-muted bg-bg-secondary p-2 text-text-muted transition-colors hover:text-text-primary"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
                {isLoading && !view ? (
                    <div className="flex items-center gap-2 rounded-2xl border border-border-muted bg-bg-primary/70 px-4 py-3 text-sm text-text-secondary">
                        <Loader2 className="h-4 w-4 animate-spin text-accent" />
                        Loading trade history detail...
                    </div>
                ) : null}

                {error && !view ? (
                    <div className="rounded-2xl border border-price-down/20 bg-price-down/10 px-4 py-3 text-sm text-price-down">
                        {error}
                    </div>
                ) : null}

                {view ? (
                    <>
                        {stageAnalysis ? (
                            <section className="space-y-3">
                                <StageIndicator analysis={stageAnalysis} />
                                <LiveStatusPanel analysis={stageAnalysis} />
                            </section>
                        ) : null}

                        <section className="rounded-2xl border border-border-muted bg-bg-primary/70 p-4">
                            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-text-muted">
                                <Flag className="h-4 w-4" />
                                History Context
                            </div>
                            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                {view.traceabilityFacts.map((fact) => (
                                    <FactCard
                                        key={fact.label}
                                        label={fact.label}
                                        value={fact.value}
                                        tone={fact.tone}
                                    />
                                ))}
                            </div>
                        </section>

                        <section className="rounded-2xl border border-border-muted bg-bg-primary/70 p-4">
                            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-text-muted">
                                <Activity className="h-4 w-4" />
                                Trade Facts
                            </div>
                            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                {view.tradeFacts.map((fact) => (
                                    <FactCard
                                        key={fact.label}
                                        label={fact.label}
                                        value={fact.value}
                                        tone={fact.tone}
                                    />
                                ))}
                            </div>
                        </section>

                        <section className="rounded-2xl border border-border-muted bg-bg-primary/70 p-4">
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

                        {error ? (
                            <div className="rounded-2xl border border-price-down/20 bg-price-down/10 px-4 py-3 text-sm text-price-down">
                                {error}
                            </div>
                        ) : null}

                        <section className="rounded-2xl border border-border-muted bg-bg-primary/70 p-4">
                            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-text-muted">
                                <FileJson className="h-4 w-4" />
                                Raw Record
                            </div>
                            <pre className="mt-4 overflow-x-auto rounded-xl border border-border-muted bg-bg-secondary/70 p-3 text-xs text-text-secondary">
                                {JSON.stringify(detail ?? {}, null, 2)}
                            </pre>
                        </section>
                    </>
                ) : null}
            </div>
        </div>
    );
}
