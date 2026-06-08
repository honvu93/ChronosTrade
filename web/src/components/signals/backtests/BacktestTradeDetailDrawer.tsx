"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { Activity, BarChart3, Clock3, ExternalLink, FileJson, Maximize2, Minimize2, Shield, ShieldCheck, TrendingUp, X } from "lucide-react";
import { DecisionTraceTimeline } from "./DecisionTraceTimeline";
import { BacktestTradeDrawerContext } from "@/lib/backtestTradeDetailContext";
import {
    BacktestTradeReplayResponse,
    BacktestTradeReplayTimelineItem,
    BacktestTradeRow,
    BacktestTradeStageAnalysis,
} from "@/types/backtests";

const BacktestTradeReplayChart = dynamic<{ replay: BacktestTradeReplayResponse; isExpanded: boolean }>(
    () => import("./BacktestTradeReplayChart").then((mod) => mod.default),
    {
        ssr: false,
        loading: () => (
            <div className="rounded-[26px] border border-border-muted bg-bg-secondary/70 px-4 py-6 text-sm text-text-secondary">
                Loading replay canvas...
            </div>
        ),
    },
);

const formatDateTime = (value: string | null) => (value ? new Date(value).toLocaleString() : "n/a");
const formatPrice = (value: number | null, digits = 2) => (value === null ? "n/a" : value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: digits }));
const formatSigned = (value: number, suffix = "") => `${value >= 0 ? "+" : ""}${value.toFixed(2)}${suffix}`;
const formatOptional = (value: number | null, digits = 2, suffix = "") => (
    value === null
        ? "n/a"
        : `${value >= 0 && suffix ? "+" : ""}${value.toFixed(digits)}${suffix}`
);
const formatDuration = (value: number | null) => {
    if (value === null) return "Open";
    const totalMinutes = Math.max(Math.round(value / 60000), 0);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;

    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
};

const formatVolume = (value: number | null | undefined) => (
    value === null || value === undefined ? "n/a" : value.toFixed(4)
);

const formatRelativeTime = (entryTime: string, eventTime: string) => {
    const diff = new Date(eventTime).getTime() - new Date(entryTime).getTime();
    if (diff < 0) return "+0m";
    const totalMinutes = Math.round(diff / 60000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;

    if (days > 0) return `+${days}d ${hours}h`;
    if (hours > 0) return `+${hours}h ${minutes}m`;
    return `+${minutes}m`;
};

const signalChipLabel = (replay: BacktestTradeReplayResponse["summary"] | undefined, context: BacktestTradeDrawerContext | null) => {
    if (replay?.signalCode && replay.signalVersion !== null) {
        return `${replay.signalCode.toUpperCase()}@${replay.signalVersion}`;
    }

    if (context?.signalLabel) {
        return context.signalLabel.toUpperCase();
    }

    return "SIGNAL";
};

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

const resolveTimelineStage = (eventType: string): number => {
    if (eventType === "ENTRY" || eventType === "ENTRY_CONFIRMED" || eventType === "FAIL") return 1;
    if (eventType === "MOVE_SL_BE") return 2;
    if (eventType === "TP1_HIT" || eventType === "TRAIL_START" || eventType === "TRAIL_UPDATE") return 3;
    if (eventType === "STOP_HIT" || eventType === "TP2_HIT" || eventType === "EXPIRATION") return 0; // terminal
    return 0;
};

const getTimelineEventDescription = (item: BacktestTradeReplayTimelineItem): string => {
    switch (item.eventType) {
        case "ENTRY":
        case "ENTRY_CONFIRMED":
            return `Position opened at ${item.price !== null ? formatPrice(item.price, 1) : "market"}`;
        case "MOVE_SL_BE":
            return `SL moved to breakeven (${item.price !== null ? formatPrice(item.price, 1) : "entry"})`;
        case "TP1_HIT":
            return `50% position closed at ${item.price !== null ? formatPrice(item.price, 1) : "target"}`;
        case "TRAIL_START":
            return `Trailing stop started at ${item.price !== null ? formatPrice(item.price, 1) : "level"}`;
        case "TRAIL_UPDATE":
            return `Trailing stop tightened to ${item.price !== null ? formatPrice(item.price, 1) : "level"}`;
        case "STOP_HIT":
            return `Position closed at ${item.price !== null ? formatPrice(item.price, 1) : "stop"} (${item.label?.toLowerCase().includes("loss") ? "loss" : "profit"})`;
        case "TP2_HIT":
            return `Remaining position closed at ${item.price !== null ? formatPrice(item.price, 1) : "target"}`;
        case "EXPIRATION":
            return `Position expired/closed at ${item.price !== null ? formatPrice(item.price, 1) : "close"}`;
        default:
            return item.detail || item.label;
    }
};

function MetricCard({
    label,
    value,
    caption,
    tone = "text-text-primary",
    compact = false,
}: {
    label: string;
    value: string;
    caption?: string;
    tone?: string;
    compact?: boolean;
}) {
    return (
        <div className={`rounded-[22px] border border-border-muted bg-[#0d1219]/88 ${compact ? "p-3" : "p-4"}`}>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">{label}</div>
            <div className={`mt-2 font-black ${compact ? "text-lg" : "text-[1.9rem]"} leading-none ${tone}`}>{value}</div>
            {caption ? <div className="mt-2 text-xs text-text-secondary">{caption}</div> : null}
        </div>
    );
}

function HeaderBadge({
    label,
    tone,
}: {
    label: string;
    tone: "long" | "short" | "signal" | "neutral" | "success" | "danger";
}) {
    const className = tone === "long"
        ? "bg-price-up/15 text-price-up"
        : tone === "short"
            ? "bg-price-down/15 text-price-down"
            : tone === "signal"
                ? "bg-accent/15 text-accent"
                : tone === "success"
                    ? "bg-price-up/15 text-price-up"
                    : tone === "danger"
                        ? "bg-price-down/15 text-price-down"
                        : "bg-bg-tertiary text-text-primary";

    return (
        <span className={`inline-flex rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] ${className}`}>
            {label}
        </span>
    );
}

function StageIndicator({ analysis }: { analysis: BacktestTradeStageAnalysis }) {
    const stageLabels = ["At Risk", "Protected", "Trailing"] as const;

    return (
        <div className="rounded-[22px] border border-border-muted bg-[#0d1219]/88 p-4">
            <div className="flex items-center gap-3">
                {stageLabels.map((label, index) => {
                    const stageNum = (index + 1) as 1 | 2 | 3;
                    const isActive = analysis.currentStage >= stageNum;
                    const isCurrent = analysis.currentStage === stageNum;
                    const colors = STAGE_COLORS[stageNum];

                    return (
                        <div key={stageNum} className="flex items-center gap-3 flex-1">
                            <div className="flex items-center gap-2 flex-1">
                                <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black ${
                                    isCurrent
                                        ? `${colors.bg} ${colors.text} ring-2 ring-current`
                                        : isActive
                                            ? `${colors.bg} ${colors.text}`
                                            : "bg-bg-tertiary text-text-muted"
                                }`}>
                                    {stageNum}
                                </div>
                                <div className="min-w-0">
                                    <div className={`text-[10px] font-bold uppercase tracking-[0.14em] ${isCurrent ? colors.text : isActive ? "text-text-secondary" : "text-text-muted"}`}>
                                        {label}
                                    </div>
                                </div>
                            </div>
                            {stageNum < 3 && (
                                <div className={`h-px flex-1 ${isActive ? colors.connector : "bg-border-muted"}`} />
                            )}
                        </div>
                    );
                })}
            </div>
            <div className={`mt-3 text-sm font-bold ${STAGE_COLORS[analysis.currentStage as 1 | 2 | 3]?.text ?? "text-text-primary"}`}>
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
        <div className="rounded-[22px] border border-border-muted bg-[#0d1219]/88 p-4">
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                <div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">Current R</div>
                    <div className={`mt-1 text-xl font-black ${analysis.currentR >= 0 ? "text-price-up" : "text-price-down"}`}>
                        {analysis.currentR >= 0 ? "+" : ""}{analysis.currentR.toFixed(1)}R
                    </div>
                </div>
                <div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">Stop Loss</div>
                    <div className="mt-1 text-xl font-black text-text-primary">
                        {formatPrice(analysis.currentStopLoss, 2)}
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
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">Next</div>
                    <div className="mt-1 text-sm font-semibold text-text-secondary leading-snug">
                        {analysis.nextAction}
                    </div>
                </div>
            </div>
        </div>
    );
}

function StageTimeline({
    items,
    entryTime,
    analysis,
}: {
    items: BacktestTradeReplayTimelineItem[];
    entryTime: string;
    analysis: BacktestTradeStageAnalysis | null;
}) {
    // Deduplicate: group events by time+type, prefer 'event' kind
    const deduped = new Map<string, BacktestTradeReplayTimelineItem>();
    for (const item of items) {
        const key = `${item.eventType}:${item.candleTime}`;
        const existing = deduped.get(key);
        if (!existing || (item.kind === "event" && existing.kind === "trace")) {
            deduped.set(key, item);
        }
    }
    const dedupedItems = Array.from(deduped.values());

    if (!dedupedItems.length) {
        return <div className="mt-4 text-sm text-text-secondary">No timeline events were recorded for this trade.</div>;
    }

    // Track stage transitions
    let lastStage = 0;

    return (
        <div className="mt-4 space-y-0">
            {dedupedItems.map((item, index) => {
                const stage = resolveTimelineStage(item.eventType);
                const effectiveStage = stage || lastStage;
                const showStageHeader = stage > 0 && stage !== lastStage;
                if (stage > 0) lastStage = stage;

                const stageColors = STAGE_COLORS[effectiveStage as 1 | 2 | 3] ?? STAGE_COLORS[1];
                const isLast = index === dedupedItems.length - 1;
                const description = getTimelineEventDescription(item);
                const relativeTime = formatRelativeTime(entryTime, item.candleTime);
                const eventDate = new Date(item.candleTime);
                const dateLabel = `${eventDate.toLocaleDateString("en-US", { day: "2-digit", month: "short" })} ${eventDate.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}`;

                return (
                    <div key={item.id}>
                        {showStageHeader && (
                            <div className="flex items-center gap-2 py-2">
                                <div className={`h-px flex-1 ${stageColors.border}`} />
                                <span className={`text-[10px] font-bold uppercase tracking-[0.16em] ${stageColors.text}`}>
                                    Stage {effectiveStage}
                                </span>
                                <div className={`h-px flex-1 ${stageColors.border}`} />
                            </div>
                        )}
                        <div className="flex gap-3">
                            <div className="flex flex-col items-center">
                                <div className={`h-3 w-3 shrink-0 rounded-full ${stageColors.dot} ring-2 ring-[#0d1219]`} />
                                {!isLast && <div className={`w-px flex-1 ${stageColors.border}`} />}
                            </div>
                            <div className="pb-4 min-w-0 flex-1">
                                <div className="flex items-baseline gap-2">
                                    <span className="text-xs font-bold text-text-muted">{relativeTime}</span>
                                    <span className="text-xs text-text-muted">{dateLabel}</span>
                                </div>
                                <div className="mt-1 text-sm text-text-primary">{description}</div>
                                {item.price !== null && (
                                    <div className="mt-0.5 text-xs text-text-muted">@ {formatPrice(item.price, 2)}</div>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })}
            {analysis?.nextAction && !analysis.currentStageName.includes("Closed") && (
                <div className="flex gap-3">
                    <div className="flex flex-col items-center">
                        <div className="h-3 w-3 shrink-0 rounded-full border-2 border-text-muted bg-transparent" />
                    </div>
                    <div className="pb-2 min-w-0 flex-1">
                        <div className="text-xs font-bold text-text-muted italic">Waiting: {analysis.nextAction}</div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default function BacktestTradeDetailDrawer({
    isOpen,
    row,
    context,
    replay,
    isExpanded,
    isLoading,
    error,
    engineHref,
    onExpand,
    onCollapse,
    onClose,
}: {
    isOpen: boolean;
    row: BacktestTradeRow | null;
    context: BacktestTradeDrawerContext | null;
    replay: BacktestTradeReplayResponse | null;
    isExpanded: boolean;
    isLoading: boolean;
    error: string | null;
    engineHref: string;
    onExpand: () => void;
    onCollapse: () => void;
    onClose: () => void;
}) {
    if (!isOpen || !row) return null;

    const safeReplay = replay?.summary.rowId === row.rowId ? replay : null;
    const summary = safeReplay?.summary;
    const stageAnalysis = safeReplay?.stageAnalysis ?? null;
    const resultLabel = summary?.result ?? row.result;
    const widthClass = isExpanded
        ? "max-w-[min(96vw,1320px)]"
        : "max-w-[540px]";
    const signalLabel = signalChipLabel(summary, context);
    const stopCaption = summary?.riskDistance
        ? `Risk ${formatPrice(summary.riskDistance, 2)}`
        : formatDateTime(summary?.entryTime ?? row.entryTime);
    const exitCaption = summary?.exitTime
        ? formatDateTime(summary.exitTime)
        : "Trade still open";

    return (
        <div
            role="dialog"
            aria-labelledby="backtest-trade-detail-title"
            aria-modal="false"
            className={`fixed inset-y-0 right-0 z-[90] flex w-full ${widthClass} flex-col border-l border-border-muted bg-[#0a0f15] shadow-[0_0_70px_rgba(0,0,0,0.48)]`}
        >
            <div className="border-b border-border-muted bg-[#0d1219] px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                        <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-accent">Trade Replay</div>
                        <div className="mt-2 flex flex-wrap items-end gap-2">
                            <h2 id="backtest-trade-detail-title" className="text-[1.85rem] font-black tracking-tight text-text-primary">
                                {summary?.symbol ?? row.symbol}
                            </h2>
                            <span className="pb-1 text-sm font-bold text-text-muted">{summary?.timeframe ?? row.timeframe}</span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                            <HeaderBadge label={summary?.side ?? row.side} tone={(summary?.side ?? row.side) === "LONG" ? "long" : "short"} />
                            <HeaderBadge label={signalLabel} tone="signal" />
                            <HeaderBadge label={resultLabel === "ACTIVE" ? "ACTIVE" : "CLOSED"} tone={resultLabel === "ACTIVE" ? "signal" : "neutral"} />
                            <HeaderBadge
                                label={resultLabel}
                                tone={resultLabel === "WIN" ? "success" : resultLabel === "LOSS" ? "danger" : "neutral"}
                            />
                            <HeaderBadge label={summary?.session ?? row.session} tone="neutral" />
                        </div>
                        <div className="mt-3 text-sm text-text-secondary">
                            {summary?.signalLabel || context?.signalLabel || "Generated signal"} | Entry {formatDateTime(summary?.entryTime ?? row.entryTime)}
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={isExpanded ? onCollapse : onExpand}
                            className="rounded-full border border-border-muted bg-bg-secondary p-2 text-text-muted transition-colors hover:text-text-primary"
                            aria-label={isExpanded ? "Collapse replay canvas" : "Expand replay canvas"}
                        >
                            {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                        </button>
                        <button
                            onClick={onClose}
                            className="rounded-full border border-border-muted bg-bg-secondary p-2 text-text-muted transition-colors hover:text-text-primary"
                            aria-label="Close trade replay"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                </div>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
                <section className="rounded-[30px] border border-border-muted bg-bg-primary/75 p-4">
                    <div className="grid gap-3 xl:grid-cols-4">
                        <MetricCard
                            label="Entry"
                            value={formatPrice(summary?.entryPrice ?? row.entryPrice, 2)}
                            caption={formatDateTime(summary?.entryTime ?? row.entryTime)}
                        />
                        <MetricCard
                            label="Stop Loss"
                            value={formatPrice(summary?.stopLoss ?? row.stopLoss, 2)}
                            caption={stopCaption}
                            tone="text-price-down"
                        />
                        <MetricCard
                            label={resultLabel === "ACTIVE" ? "Current" : "Exit Price"}
                            value={formatPrice(summary?.exitPrice ?? row.exitPrice, 2)}
                            caption={exitCaption}
                        />
                        <MetricCard
                            label="PnL"
                            value={formatSigned(summary?.totalR ?? row.rMultiple, "R")}
                            caption={resultLabel}
                            tone={(summary?.totalR ?? row.rMultiple) >= 0 ? "text-price-up" : "text-price-down"}
                        />
                    </div>
                </section>

                {stageAnalysis && (
                    <section className="space-y-3">
                        <StageIndicator analysis={stageAnalysis} />
                        <LiveStatusPanel analysis={stageAnalysis} />
                    </section>
                )}

                <section className="rounded-[30px] border border-border-muted bg-bg-primary/75 p-4">
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                        <MetricCard label="Partial R" value={formatOptional(summary?.partialR ?? null, 2, "R")} tone="text-price-up" compact />
                        <MetricCard label="Remaining R" value={formatOptional(summary?.remainingR ?? null, 2, "R")} compact />
                        <MetricCard label="Bars Held" value={summary?.barsHeld === null || summary?.barsHeld === undefined ? "n/a" : String(summary.barsHeld)} compact />
                        <MetricCard label="Duration" value={formatDuration(row.durationMs)} compact />
                        <MetricCard label="Volume" value={formatVolume(summary?.configuredSize)} compact />
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-text-secondary">
                        <span>PnL USD: <span className={row.pnlUsd >= 0 ? "font-bold text-price-up" : "font-bold text-price-down"}>{formatSigned(row.pnlUsd)}</span></span>
                        <span>Exit Rule: <span className="font-bold text-text-primary">{summary?.exitRuleName ?? row.exitRuleName}</span></span>
                        <span>Run: <span className="font-bold text-text-primary">{context?.runName ?? summary?.runName ?? "Current backtest"}</span></span>
                    </div>
                </section>

                <section className="rounded-[30px] border border-border-muted bg-bg-primary/75 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-text-muted">Chart</div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <button
                                type="button"
                                onClick={isExpanded ? onCollapse : onExpand}
                                className="rounded-full border border-border-muted bg-bg-secondary px-4 py-2 text-sm font-black text-text-primary"
                            >
                                {isExpanded ? "Collapse Canvas" : "Expand Canvas"}
                            </button>
                            <Link
                                href={engineHref}
                                className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-black text-bg-secondary"
                            >
                                Open In Engine
                                <ExternalLink className="h-4 w-4" />
                            </Link>
                        </div>
                    </div>

                    {isLoading ? (
                        <div className="mt-4 rounded-[26px] border border-border-muted bg-bg-secondary/70 px-4 py-6 text-sm text-text-secondary">
                            Loading chart-rich replay evidence...
                        </div>
                    ) : error ? (
                        <div className="mt-4 rounded-[26px] border border-price-down/20 bg-price-down/10 px-4 py-3 text-sm text-price-down">
                            {error}
                        </div>
                    ) : safeReplay ? (
                        <div className="mt-4">
                            <BacktestTradeReplayChart replay={safeReplay} isExpanded={isExpanded} />
                            {!safeReplay.structurePane.available && safeReplay.structurePane.reason ? (
                                <div className="mt-3 rounded-2xl border border-dashed border-border-muted bg-bg-secondary/35 px-4 py-3 text-sm text-text-secondary">
                                    {safeReplay.structurePane.reason}
                                </div>
                            ) : null}
                        </div>
                    ) : (
                        <div className="mt-4 rounded-[26px] border border-border-muted bg-bg-secondary/70 px-4 py-6 text-sm text-text-secondary">
                            Select a trade to inspect its replay evidence.
                        </div>
                    )}
                </section>

                <section className="rounded-[30px] border border-border-muted bg-bg-primary/75 p-4">
                    <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-text-muted">
                        <Activity className="h-4 w-4" />
                        Trade Timeline
                    </div>
                    {isLoading ? (
                        <div className="mt-4 text-sm text-text-secondary">Loading replay events...</div>
                    ) : safeReplay?.timeline.length ? (
                        <StageTimeline
                            items={safeReplay.timeline}
                            entryTime={summary?.entryTime ?? row.entryTime}
                            analysis={stageAnalysis}
                        />
                    ) : (
                        <div className="mt-4 text-sm text-text-secondary">No timeline events were recorded for this trade.</div>
                    )}
                </section>

                <section className="rounded-[30px] border border-border-muted bg-bg-primary/75 p-4">
                    <div className="grid gap-3 lg:grid-cols-3">
                        <div className="rounded-[22px] border border-border-muted bg-[#0d1219]/88 p-4">
                            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-text-muted">Trade Context</div>
                            <div className="mt-3 space-y-2 text-sm text-text-secondary">
                                <div>Run: <span className="font-semibold text-text-primary">{context?.runName ?? summary?.runName ?? "Current backtest"}</span></div>
                                <div>Signal: <span className="font-semibold text-text-primary">{summary?.signalLabel ?? context?.signalLabel ?? "Generated signal"}</span></div>
                                <div>Signal ID: <span className="font-mono text-text-primary">{context?.signalId ?? summary?.signalId ?? row.signalId}</span></div>
                                <div>Trade Row: <span className="font-mono text-text-primary">{context?.rowId ?? row.rowId}</span></div>
                            </div>
                        </div>

                        <div className="rounded-[22px] border border-border-muted bg-[#0d1219]/88 p-4 lg:col-span-2">
                            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-text-muted">Trade Notes</div>
                            <div className="mt-3 text-sm text-text-secondary">
                                {row.notes?.trim() || "No persisted notes were recorded for this trade row."}
                            </div>
                        </div>
                    </div>
                </section>

                <details className="rounded-[30px] border border-border-muted bg-bg-primary/75 p-4">
                    <summary className="cursor-pointer list-none">
                        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-text-muted">
                            <Clock3 className="h-4 w-4" />
                            Raw Event Evidence
                        </div>
                    </summary>
                    {isLoading ? (
                        <div className="mt-4 text-sm text-text-secondary">Loading raw evidence...</div>
                    ) : (
                        <div className="mt-4 space-y-3">
                            <details>
                                <summary className="cursor-pointer text-sm font-bold text-text-primary">
                                    Event payloads ({safeReplay?.raw.events.length ?? 0})
                                </summary>
                                <pre className="mt-3 overflow-x-auto rounded-xl border border-border-muted bg-bg-secondary/70 p-3 text-xs text-text-secondary">
                                    {JSON.stringify(safeReplay?.raw.events ?? [], null, 2)}
                                </pre>
                            </details>
                            <details>
                                <summary className="cursor-pointer text-sm font-bold text-text-primary">
                                    Trace payloads ({safeReplay?.raw.traces.length ?? 0})
                                </summary>
                                <pre className="mt-3 overflow-x-auto rounded-xl border border-border-muted bg-bg-secondary/70 p-3 text-xs text-text-secondary">
                                    {JSON.stringify(safeReplay?.raw.traces ?? [], null, 2)}
                                </pre>
                            </details>
                        </div>
                    )}
                </details>

                <details className="rounded-[30px] border border-border-muted bg-bg-primary/75 p-4">
                    <summary className="cursor-pointer list-none">
                        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-text-muted">
                            <BarChart3 className="h-4 w-4" />
                            Decision Trace
                        </div>
                    </summary>
                    <div className="mt-4">
                        <DecisionTraceTimeline decisionLog={safeReplay?.decisionLog ?? null} />
                    </div>
                </details>

                {(() => {
                    const tracesWithIndicators = safeReplay?.raw.traces.filter(
                        (t) => t.indicatorJson && Object.keys(t.indicatorJson).length > 0,
                    ) ?? [];
                    if (tracesWithIndicators.length === 0) return null;
                    return (
                        <details className="rounded-[30px] border border-border-muted bg-bg-primary/75 p-4">
                            <summary className="cursor-pointer list-none">
                                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-text-muted">
                                    <Activity className="h-4 w-4" />
                                    Indicator Values ({tracesWithIndicators.length} bars)
                                </div>
                            </summary>
                            <div className="mt-4 overflow-x-auto rounded-xl border border-border-muted">
                                <table className="w-full text-xs">
                                    <thead>
                                        <tr className="border-b border-border-muted text-text-muted">
                                            <th className="px-2 py-1.5 text-left font-medium">Time</th>
                                            <th className="px-2 py-1.5 text-left font-medium">Block</th>
                                            <th className="px-2 py-1.5 text-left font-medium">Condition</th>
                                            <th className="px-2 py-1.5 text-left font-medium">Values</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {tracesWithIndicators.map((trace) => {
                                            const isMet = trace.notes === "CONDITION_MET";
                                            return (
                                                <tr
                                                    key={trace.id}
                                                    className={`border-b border-border-muted/50 ${isMet ? "bg-emerald-500/5" : ""}`}
                                                >
                                                    <td className="px-2 py-1 text-text-secondary tabular-nums whitespace-nowrap">
                                                        {new Date(trace.candleTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                                    </td>
                                                    <td className="px-2 py-1 text-text-primary font-mono">
                                                        {trace.ruleId?.split(":")[0] ?? "-"}
                                                    </td>
                                                    <td className="px-2 py-1">
                                                        <span className={isMet ? "text-emerald-400 font-semibold" : "text-text-muted"}>
                                                            {isMet ? "MET" : "NOT MET"}
                                                        </span>
                                                    </td>
                                                    <td className="px-2 py-1">
                                                        <div className="flex flex-wrap gap-1.5">
                                                            {Object.entries(trace.indicatorJson!).map(([key, value]) => (
                                                                <span
                                                                    key={key}
                                                                    className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-mono ${isMet ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-border-muted bg-bg-tertiary/50 text-text-secondary"}`}
                                                                >
                                                                    {key}={typeof value === "number" ? value.toFixed(4) : String(value)}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </details>
                    );
                })()}

                <details className="rounded-[30px] border border-border-muted bg-bg-primary/75 p-4">
                    <summary className="cursor-pointer list-none">
                        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-text-muted">
                            <FileJson className="h-4 w-4" />
                            Trade Row JSON
                        </div>
                    </summary>
                    <pre className="mt-4 overflow-x-auto rounded-xl border border-border-muted bg-bg-secondary/70 p-3 text-xs text-text-secondary">
                        {JSON.stringify(row, null, 2)}
                    </pre>
                </details>
            </div>
        </div>
    );
}
