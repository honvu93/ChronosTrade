"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, CheckCircle2, Loader2, ShieldAlert } from "lucide-react";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { useTradingDiagnosis } from "@/hooks/useTradingDiagnosis";
import { buildTradingDiagnosisView } from "@/lib/tradingDiagnosisView";
import {
    TradingDiagnosisRequestParams,
    TradingInvestigationOutcome,
    TradingRootCauseCategory,
} from "@/types/trading";
import StateBanner from "@/components/ui/StateBanner";

type Tone = "danger" | "accent" | "success" | "neutral";

const toneStyles: Record<Tone, string> = {
    danger: "border-price-down/20 bg-price-down/8 text-price-down",
    accent: "border-accent/20 bg-accent/8 text-accent",
    success: "border-price-up/20 bg-price-up/8 text-price-up",
    neutral: "border-border-muted bg-bg-tertiary text-text-secondary",
};

const cardStyles: Record<Tone, string> = {
    danger: "border-price-down/30 bg-price-down/8",
    accent: "border-accent/30 bg-accent/8",
    success: "border-price-up/30 bg-price-up/8",
    neutral: "border-border-muted bg-bg-primary/70",
};

const outcomeButtonStyles: Record<TradingInvestigationOutcome, string> = {
    resolved: "border-price-up/30 bg-price-up/10 text-price-up",
    mitigated: "border-accent/30 bg-accent/10 text-accent",
    escalated: "border-price-down/30 bg-price-down/10 text-price-down",
};

const outcomeLabels: Record<TradingInvestigationOutcome, string> = {
    resolved: "Mark Resolved",
    mitigated: "Mark Mitigated",
    escalated: "Escalate",
};

export default function TradingIncidentInvestigationRail({
    isOpen,
    requestParams,
    onInspectTradeRecord,
}: {
    isOpen: boolean;
    requestParams: TradingDiagnosisRequestParams | null;
    onInspectTradeRecord?: (recordId: string) => void;
}) {
    const {
        status,
        snapshot,
        error,
        saveStatus,
        saveError,
        load,
        recordOutcome,
        clear,
    } = useTradingDiagnosis();
    const canWrite = useFeatureFlag("trading_write_enabled");
    const [manualCategory, setManualCategory] = useState<TradingRootCauseCategory | null>(null);
    const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
    const [prevSnapshot, setPrevSnapshot] = useState(snapshot);
    const summaryRef = useRef("");

    useEffect(() => {
        if (!isOpen || !requestParams) {
            clear();
            return;
        }

        void load(requestParams);
    }, [clear, isOpen, load, requestParams]);

    if (snapshot !== prevSnapshot) {
        setPrevSnapshot(snapshot);
        if (!snapshot?.history.length) {
            if (selectedHistoryId !== null) setSelectedHistoryId(null);
        } else if (!selectedHistoryId || !snapshot.history.some((item) => item.id === selectedHistoryId)) {
            setSelectedHistoryId(snapshot.history[0].id);
        }
    }

    if (!requestParams) {
        return null;
    }

    const view = snapshot ? buildTradingDiagnosisView(snapshot) : null;
    const selectedCategory = snapshot?.categories.some((candidate) => candidate.category === manualCategory)
        ? manualCategory
        : snapshot?.primaryCategory ?? snapshot?.categories[0]?.category ?? null;
    const selectedCandidate = snapshot?.categories.find((candidate) => candidate.category === selectedCategory) ?? null;
    const selectedHistory = view?.history.find((item) => item.id === selectedHistoryId) ?? null;

    const handleRecordOutcome = async (outcome: TradingInvestigationOutcome) => {
        if (!selectedCategory || !selectedCandidate) {
            return;
        }

        await recordOutcome({
            rootCauseCategory: selectedCategory,
            outcome,
            summary: summaryRef.current.trim() || selectedCandidate.summary,
        });
    };

    const scrollToTarget = (targetId: string) => {
        const element = document.getElementById(targetId);
        if (!element) {
            return;
        }

        element.scrollIntoView({
            behavior: "smooth",
            block: "start",
        });
    };

    return (
        <section id="trading-investigation-rail" className="rounded-2xl border border-border-muted bg-bg-primary/70 p-4">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-text-muted">
                        <ShieldAlert className="h-4 w-4" />
                        Incident Investigation
                    </div>
                    <div className="mt-2 text-sm font-black text-text-primary">
                        Likely root-cause diagnosis
                    </div>
                    <div className="mt-1 text-xs text-text-secondary">
                        Keep the investigation in this rail, link evidence before acting, and record whether the issue was resolved, mitigated, or escalated.
                    </div>
                </div>
                {view ? (
                    <span className={`rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] ${toneStyles[view.primaryTone]}`}>
                        {view.primaryLabel}
                    </span>
                ) : null}
            </div>

            {status === "loading" && !snapshot ? (
                <div className="mt-4 flex items-center gap-2 rounded-2xl border border-border-muted bg-bg-secondary/70 px-4 py-3 text-sm text-text-secondary">
                    <Loader2 className="h-4 w-4 animate-spin text-accent" />
                    Diagnosing root cause from linked evidence...
                </div>
            ) : null}

            {error && !snapshot ? (
                <StateBanner
                    tone="caution"
                    title="Diagnosis unavailable"
                    icon={<AlertTriangle className="h-4 w-4" />}
                    message={error}
                    className="mt-4 rounded-2xl"
                />
            ) : null}

            {view ? (
                <>
                    <div className="mt-4 rounded-2xl border border-border-muted bg-bg-secondary/70 px-4 py-3">
                        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-text-muted">
                            Investigation Thread
                        </div>
                        <div className="mt-2 text-sm font-black text-text-primary">{view.title}</div>
                        <div className="mt-1 text-xs text-text-secondary">{view.signalKey}</div>
                    </div>

                    <div id="trading-investigation-evidence" className="mt-4 grid gap-3">
                        {view.candidates.map((candidate) => (
                            <article
                                key={candidate.category}
                                role="button"
                                tabIndex={0}
                                onClick={() => { setManualCategory(candidate.category); }}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter" || event.key === " ") {
                                        event.preventDefault();
                                        setManualCategory(candidate.category);
                                    }
                                }}
                                className={`rounded-2xl border p-4 text-left transition ${selectedCategory === candidate.category
                                        ? "border-accent/50 bg-accent/10"
                                        : cardStyles[candidate.tone]
                                    }`}
                            >
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.16em] ${toneStyles[candidate.tone]}`}>
                                        {candidate.label}
                                    </span>
                                    <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-text-muted">
                                        {candidate.confidenceLabel}
                                    </span>
                                    <span className="text-[11px] text-text-muted">{candidate.scoreLabel}</span>
                                </div>
                                <div className="mt-3 text-sm leading-6 text-text-primary">{candidate.summary}</div>
                                <div className="mt-3 text-[11px] font-bold uppercase tracking-[0.14em] text-text-muted">
                                    {candidate.evidenceCountLabel}
                                </div>
                                {candidate.evidence.length > 0 ? (
                                    <div className="mt-3 space-y-2">
                                        {candidate.evidence.map((evidence) => (
                                            <div key={evidence.id} className="rounded-xl border border-border-muted bg-bg-primary/70 px-3 py-2.5">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.14em] ${toneStyles[evidence.tone]}`}>
                                                        {evidence.severityLabel}
                                                    </span>
                                                    <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-text-muted">
                                                        {evidence.sourceLabel}
                                                    </span>
                                                    <span className="text-[10px] text-text-muted">
                                                        {evidence.sectionLabel}
                                                    </span>
                                                </div>
                                                <div className="mt-2 text-xs font-bold text-text-primary">{evidence.title}</div>
                                                <div className="mt-1 text-xs leading-5 text-text-secondary">{evidence.detail}</div>
                                                <div className="mt-2 text-[11px] text-text-muted">{evidence.linkedRecordLabel}</div>
                                                {evidence.targetId || evidence.href ? (
                                                    <div className="mt-2 flex flex-wrap gap-2">
                                                        {evidence.targetId && evidence.targetLabel ? (
                                                            <button
                                                                type="button"
                                                                onClick={(event) => {
                                                                    event.preventDefault();
                                                                    event.stopPropagation();
                                                                    const targetId = evidence.targetId;
                                                                    if (!targetId) {
                                                                        return;
                                                                    }

                                                                    scrollToTarget(targetId);
                                                                }}
                                                                className="inline-flex items-center gap-1 rounded-full border border-border-muted bg-bg-secondary px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-text-primary transition-colors hover:border-accent hover:text-accent"
                                                            >
                                                                {evidence.targetLabel}
                                                            </button>
                                                        ) : null}
                                                        {evidence.href && evidence.hrefLabel ? (
                                                            <Link
                                                                href={evidence.href}
                                                                onClick={(event) => { event.stopPropagation(); }}
                                                                className="inline-flex items-center gap-1 rounded-full border border-border-muted bg-bg-secondary px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-text-primary transition-colors hover:border-accent hover:text-accent"
                                                            >
                                                                {evidence.hrefLabel}
                                                                <ArrowUpRight className="h-3 w-3" />
                                                            </Link>
                                                        ) : null}
                                                    </div>
                                                ) : null}
                                            </div>
                                        ))}
                                    </div>
                                ) : null}
                            </article>
                        ))}
                    </div>

                    <div id="trading-investigation-outcome" className="mt-5 rounded-2xl border border-border-muted bg-bg-secondary/70 p-4">
                        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-text-muted">
                            Investigation Outcome
                        </div>
                        <div className="mt-2 text-sm font-black text-text-primary">
                            {selectedCandidate
                                ? `Record the current decision for ${selectedCandidate.label}.`
                                : "Select a diagnosis lane before recording an outcome."}
                        </div>
                        <textarea
                            defaultValue=""
                            onChange={(event) => { summaryRef.current = event.target.value; }}
                            placeholder={selectedCandidate?.summary ?? "Add an operator note for the audit trail."}
                            disabled={!canWrite}
                            className="mt-3 min-h-[88px] w-full rounded-2xl border border-border-muted bg-bg-primary/70 px-4 py-3 text-sm text-text-primary outline-none transition focus:border-accent/40"
                        />
                        {!canWrite ? (
                            <StateBanner
                                tone="neutral"
                                title="Write tier required"
                                icon={<ShieldAlert className="h-4 w-4" />}
                                message="Write tier needed to record outcomes."
                                className="mt-3 rounded-2xl"
                            />
                        ) : null}
                        <div className="mt-3 flex flex-wrap gap-2">
                            {(["resolved", "mitigated", "escalated"] as const).map((outcome) => (
                                <button
                                    key={outcome}
                                    type="button"
                                    onClick={() => { void handleRecordOutcome(outcome); }}
                                    disabled={!selectedCandidate || saveStatus === "saving" || !canWrite}
                                    className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-60 ${outcomeButtonStyles[outcome]}`}
                                >
                                    {saveStatus === "saving" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                                    {outcomeLabels[outcome]}
                                </button>
                            ))}
                        </div>

                        {saveError ? (
                            <StateBanner
                                tone="danger"
                                title="Outcome record failed"
                                icon={<AlertTriangle className="h-4 w-4" />}
                                message={saveError}
                                className="mt-3 rounded-2xl"
                            />
                        ) : null}

                        {saveStatus === "success" && snapshot?.latestOutcome ? (
                            <StateBanner
                                tone={snapshot.latestOutcome.outcome === "resolved"
                                    ? "success"
                                    : snapshot.latestOutcome.outcome === "mitigated"
                                        ? "caution"
                                        : "danger"}
                                title="Outcome recorded"
                                icon={<CheckCircle2 className="h-4 w-4" />}
                                message={`${snapshot.latestOutcome.outcome.toUpperCase()} | ${snapshot.latestOutcome.summary ?? "Operator note recorded."}`}
                                className="mt-3 rounded-2xl"
                            />
                        ) : null}
                    </div>

                    <div id="trading-investigation-history" className="mt-5 rounded-2xl border border-border-muted bg-bg-secondary/70 p-4">
                        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-text-muted">
                            Outcome History
                        </div>
                        {view.history.length === 0 ? (
                            <div className="mt-3 text-sm text-text-secondary">
                                No investigation outcome has been recorded for this thread yet.
                            </div>
                        ) : (
                            <div className="mt-3 space-y-3">
                                {view.history.map((item) => (
                                    <article
                                        key={item.id}
                                        className={`rounded-xl border px-3 py-3 ${selectedHistoryId === item.id
                                                ? "border-accent/40 bg-accent/8"
                                                : "border-border-muted bg-bg-primary/70"
                                            }`}
                                    >
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.16em] ${toneStyles[item.outcomeTone]}`}>
                                                {item.outcomeLabel}
                                            </span>
                                            <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-text-muted">
                                                {item.categoryLabel}
                                            </span>
                                            <span className="text-[11px] text-text-muted">{item.decidedAtLabel}</span>
                                        </div>
                                        <div className="mt-2 text-xs leading-5 text-text-secondary">{item.summary}</div>
                                        <div className="mt-3 flex flex-wrap gap-2">
                                            <button
                                                type="button"
                                                onClick={() => { setSelectedHistoryId(item.id); }}
                                                className="inline-flex items-center gap-1 rounded-full border border-border-muted bg-bg-secondary px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-text-primary transition-colors hover:border-accent hover:text-accent"
                                            >
                                                Inspect decision record
                                            </button>
                                            {item.tradeRecordId && onInspectTradeRecord ? (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        if (!item.tradeRecordId) {
                                                            return;
                                                        }

                                                        onInspectTradeRecord(item.tradeRecordId);
                                                    }}
                                                    className="inline-flex items-center gap-1 rounded-full border border-border-muted bg-bg-secondary px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-text-primary transition-colors hover:border-accent hover:text-accent"
                                                >
                                                    Inspect execution record
                                                </button>
                                            ) : null}
                                        </div>
                                    </article>
                                ))}
                            </div>
                        )}

                        {selectedHistory ? (
                            <div className="mt-4 rounded-2xl border border-border-muted bg-bg-primary/70 p-4">
                                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-text-muted">
                                    Decision Record Detail
                                </div>
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.16em] ${toneStyles[selectedHistory.outcomeTone]}`}>
                                        {selectedHistory.outcomeLabel}
                                    </span>
                                    <span className="rounded-full border border-border-muted bg-bg-secondary px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-text-primary">
                                        {selectedHistory.categoryLabel}
                                    </span>
                                    {selectedHistory.confidenceLabel ? (
                                        <span className="rounded-full border border-border-muted bg-bg-secondary px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-text-muted">
                                            {selectedHistory.confidenceLabel}
                                        </span>
                                    ) : null}
                                </div>
                                <div className="mt-3 text-sm font-black text-text-primary">
                                    {selectedHistory.investigationLabel ?? "Recorded operator decision"}
                                </div>
                                <div className="mt-1 text-xs text-text-secondary">{selectedHistory.summary}</div>

                                {selectedHistory.scoreLabel ? (
                                    <div className="mt-3 text-[11px] font-bold uppercase tracking-[0.14em] text-text-muted">
                                        {selectedHistory.scoreLabel}
                                    </div>
                                ) : null}

                                {selectedHistory.linkedFacts.length > 0 ? (
                                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                        {selectedHistory.linkedFacts.map((fact) => (
                                            <div key={fact.label} className="rounded-xl border border-border-muted bg-bg-secondary/70 px-3 py-3">
                                                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-text-muted">
                                                    {fact.label}
                                                </div>
                                                <div className="mt-2 text-sm font-bold text-text-primary">{fact.value}</div>
                                            </div>
                                        ))}
                                    </div>
                                ) : null}

                                {selectedHistory.evidence.length > 0 ? (
                                    <div className="mt-4 space-y-3">
                                        {selectedHistory.evidence.map((evidence) => (
                                            <article key={evidence.id} className="rounded-xl border border-border-muted bg-bg-secondary/70 px-3 py-3">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.14em] ${toneStyles[evidence.tone]}`}>
                                                        {evidence.severityLabel}
                                                    </span>
                                                    <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-text-muted">
                                                        {evidence.sourceLabel}
                                                    </span>
                                                    <span className="text-[10px] text-text-muted">
                                                        {evidence.sectionLabel}
                                                    </span>
                                                </div>
                                                <div className="mt-2 text-xs font-bold text-text-primary">{evidence.title}</div>
                                                <div className="mt-1 text-xs leading-5 text-text-secondary">{evidence.detail}</div>
                                                <div className="mt-2 text-[11px] text-text-muted">{evidence.linkedRecordLabel}</div>
                                                <div className="mt-2 flex flex-wrap gap-2">
                                                    {evidence.targetId && evidence.targetLabel ? (
                                                        <button
                                                            type="button"
                                                            onClick={() => { if (evidence.targetId) scrollToTarget(evidence.targetId); }}
                                                            className="inline-flex items-center gap-1 rounded-full border border-border-muted bg-bg-primary px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-text-primary transition-colors hover:border-accent hover:text-accent"
                                                        >
                                                            {evidence.targetLabel}
                                                        </button>
                                                    ) : null}
                                                    {evidence.href && evidence.hrefLabel ? (
                                                        <Link
                                                            href={evidence.href}
                                                            className="inline-flex items-center gap-1 rounded-full border border-border-muted bg-bg-primary px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-text-primary transition-colors hover:border-accent hover:text-accent"
                                                        >
                                                            {evidence.hrefLabel}
                                                            <ArrowUpRight className="h-3 w-3" />
                                                        </Link>
                                                    ) : null}
                                                </div>
                                            </article>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="mt-4 rounded-xl border border-border-muted bg-bg-secondary/70 px-3 py-3 text-xs text-text-secondary">
                                        No persisted evidence snapshot was captured for this decision record.
                                    </div>
                                )}
                            </div>
                        ) : null}
                    </div>
                </>
            ) : null}
        </section>
    );
}
