"use client";

import { useEffect, useMemo, useState } from "react";
import {
    AlertTriangle,
    Clock3,
    Loader2,
    RefreshCcw,
    RotateCcw,
    Send,
    TerminalSquare,
} from "lucide-react";
import SectionCard from "@/components/ui/SectionCard";
import StateBanner from "@/components/ui/StateBanner";
import {
    TradingExternalActionDeliveryStatus,
    TradingExternalActionDeliveryView,
    TradingExternalActionEventStatus,
    TradingExternalActionEventView,
    TradingExternalDeploymentView,
} from "@/types/trading";

type NoticeTone = "success" | "danger" | "neutral";

const eventStatusBadgeClasses: Record<TradingExternalActionEventStatus, string> = {
    READY: "border-accent/30 bg-accent/10 text-accent",
    SENT: "border-price-up/30 bg-price-up/10 text-price-up",
    FAILED: "border-price-down/30 bg-price-down/10 text-price-down",
    CANCELED: "border-border-muted bg-bg-secondary text-text-muted",
};

const deliveryStatusBadgeClasses: Record<TradingExternalActionDeliveryStatus, string> = {
    PENDING: "border-accent/30 bg-accent/10 text-accent",
    SENT: "border-price-up/30 bg-price-up/10 text-price-up",
    FAILED: "border-price-down/30 bg-price-down/10 text-price-down",
};

function formatDateTime(value: string | null) {
    return value ? new Date(value).toLocaleString() : "n/a";
}

function JsonBlock({ value }: { value: unknown }) {
    return (
        <pre className="overflow-x-auto rounded-2xl border border-border-muted bg-bg-secondary/70 p-3 text-[11px] leading-5 text-text-secondary">
            {JSON.stringify(value, null, 2)}
        </pre>
    );
}

export default function TradingExternalActionAuditPanel({
    enabled,
    writeEnabled,
    status,
    deployments,
    events,
    deliveries,
    error,
    refreshing,
    mutating,
    selectedDeploymentId,
    onSelectDeployment,
    onRefresh,
    onReplay,
}: {
    enabled: boolean;
    writeEnabled: boolean;
    status: "idle" | "loading" | "ready" | "error";
    deployments: TradingExternalDeploymentView[];
    events: TradingExternalActionEventView[];
    deliveries: TradingExternalActionDeliveryView[];
    error: string | null;
    refreshing: boolean;
    mutating: boolean;
    selectedDeploymentId?: string | null;
    onSelectDeployment?: (deploymentId: string | null) => void;
    onRefresh: () => Promise<void>;
    onReplay: (eventId: string) => Promise<unknown>;
}) {
    const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
    const [eventStatusFilter, setEventStatusFilter] = useState<TradingExternalActionEventStatus | "ALL">("ALL");
    const [notice, setNotice] = useState<{ tone: NoticeTone; message: string } | null>(null);

    const deploymentIndex = useMemo(
        () => new Map(deployments.map((deployment) => [deployment.id, deployment])),
        [deployments],
    );

    const filteredEvents = useMemo(
        () => events.filter((event) => {
            if (selectedDeploymentId && event.externalDeploymentId !== selectedDeploymentId) {
                return false;
            }
            if (eventStatusFilter !== "ALL" && event.status !== eventStatusFilter) {
                return false;
            }
            return true;
        }),
        [eventStatusFilter, events, selectedDeploymentId],
    );

    useEffect(() => {
        if (selectedEventId && filteredEvents.some((event) => event.id === selectedEventId)) {
            return;
        }

        setSelectedEventId(filteredEvents[0]?.id ?? null);
    }, [filteredEvents, selectedEventId]);

    const selectedEvent = filteredEvents.find((event) => event.id === selectedEventId) ?? null;
    const filteredDeliveries = useMemo(
        () => deliveries.filter((delivery) => {
            if (selectedEvent) {
                return delivery.externalActionEventId === selectedEvent.id;
            }
            if (selectedDeploymentId) {
                return delivery.externalDeploymentId === selectedDeploymentId;
            }
            return true;
        }),
        [deliveries, selectedDeploymentId, selectedEvent],
    );

    const handleReplay = async (eventId: string) => {
        setNotice(null);
        try {
            await onReplay(eventId);
            setNotice({
                tone: "success",
                message: "Manual replay was queued. Delivery history will update as the worker re-processes the event.",
            });
        } catch (replayError) {
            setNotice({
                tone: "danger",
                message: replayError instanceof Error ? replayError.message : "Failed to queue event replay.",
            });
        }
    };

    if (!enabled) {
        return (
            <StateBanner
                tone="neutral"
                title="Read tier required"
                message="Enable FEATURE_TRADING_READ for audit."
                className="rounded-3xl"
            />
        );
    }

    return (
        <SectionCard
            title="External Action Audit"
            description="Delivery audit log"
            icon={<TerminalSquare className="h-5 w-5" />}
            headerAside={(
                <button
                    type="button"
                    onClick={() => { void onRefresh(); }}
                    disabled={refreshing}
                    className="inline-flex items-center gap-2 rounded-full border border-border-muted bg-bg-tertiary px-3 py-1.5 text-xs font-black text-text-primary disabled:cursor-wait disabled:opacity-60"
                >
                    {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
                    Refresh
                </button>
            )}
        >
            {error ? (
                <StateBanner
                    tone="caution"
                    title="External audit fetch failed"
                    icon={<AlertTriangle className="h-4 w-4" />}
                    message={`${error}. ${events.length > 0 || deliveries.length > 0 ? "Showing last snapshot." : "Audit unavailable until resolved."}`}
                    className="rounded-2xl"
                />
            ) : null}

            {/* Integration Health Summary */}
            {status === "ready" && (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <div className="rounded-2xl border border-border-muted bg-bg-primary/70 px-4 py-3">
                        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-text-muted">Deployments</div>
                        <div className="mt-1 text-lg font-black text-text-primary">{deployments.length}</div>
                        <div className="text-[10px] text-text-muted">
                            {deployments.filter((d) => d.status === "ACTIVE").length} active
                        </div>
                    </div>
                    <div className="rounded-2xl border border-border-muted bg-bg-primary/70 px-4 py-3">
                        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-text-muted">Events</div>
                        <div className="mt-1 text-lg font-black text-text-primary">{events.length}</div>
                        <div className="text-[10px] text-text-muted">
                            {events.filter((e) => e.status === "SENT").length} sent
                        </div>
                    </div>
                    <div className="rounded-2xl border border-border-muted bg-bg-primary/70 px-4 py-3">
                        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-text-muted">Deliveries</div>
                        <div className="mt-1 text-lg font-black text-text-primary">{deliveries.length}</div>
                        <div className="text-[10px] text-price-up">
                            {deliveries.filter((d) => d.status === "SENT").length} sent
                        </div>
                    </div>
                    <div className="rounded-2xl border border-border-muted bg-bg-primary/70 px-4 py-3">
                        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-text-muted">Failures</div>
                        <div className={`mt-1 text-lg font-black ${deliveries.filter((d) => d.status === "FAILED").length > 0 ? "text-price-down" : "text-price-up"}`}>
                            {deliveries.filter((d) => d.status === "FAILED").length}
                        </div>
                        <div className="text-[10px] text-text-muted">
                            {events.filter((e) => e.status === "FAILED").length} failed events
                        </div>
                    </div>
                </div>
            )}

            {notice ? (
                <StateBanner
                    tone={notice.tone === "danger" ? "danger" : notice.tone === "success" ? "success" : "neutral"}
                    message={notice.message}
                    size="compact"
                    className="rounded-2xl"
                />
            ) : null}

            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border-muted bg-bg-tertiary/20 px-4 py-3">
                <label className="flex min-w-[240px] flex-col gap-1 text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">
                    Deployment Scope
                    <select
                        value={selectedDeploymentId ?? ""}
                        onChange={(event) => onSelectDeployment?.(event.target.value || null)}
                        className="h-10 rounded-2xl border border-border-muted bg-bg-secondary px-3 text-sm font-medium normal-case tracking-normal text-text-primary"
                    >
                        <option value="">All deployments</option>
                        {deployments.map((deployment) => (
                            <option key={deployment.id} value={deployment.id}>
                                {deployment.signalCode}@{deployment.signalVersion} | {deployment.telegramChatLabel ?? deployment.telegramChatId}
                            </option>
                        ))}
                    </select>
                </label>

                <label className="flex min-w-[220px] flex-col gap-1 text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">
                    Event Status
                    <select
                        value={eventStatusFilter}
                        onChange={(event) => setEventStatusFilter(event.target.value as TradingExternalActionEventStatus | "ALL")}
                        className="h-10 rounded-2xl border border-border-muted bg-bg-secondary px-3 text-sm font-medium normal-case tracking-normal text-text-primary"
                    >
                        <option value="ALL">All statuses</option>
                        <option value="READY">READY</option>
                        <option value="SENT">SENT</option>
                        <option value="FAILED">FAILED</option>
                        <option value="CANCELED">CANCELED</option>
                    </select>
                </label>

                <div className="rounded-full border border-border-muted bg-bg-secondary px-3 py-2 text-xs text-text-secondary">
                    {filteredEvents.length} event{filteredEvents.length === 1 ? "" : "s"} / {filteredDeliveries.length} deliver{filteredDeliveries.length === 1 ? "y" : "ies"}
                </div>
            </div>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,0.96fr)_minmax(0,1.04fr)]">
                <div className="space-y-3 rounded-3xl border border-border-muted bg-bg-tertiary/20 p-4">
                    <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-text-muted">
                        <Send className="h-3.5 w-3.5" />
                        Actionable Events
                    </div>

                    {status === "loading" && events.length === 0 ? (
                        <div className="grid min-h-[180px] place-items-center rounded-2xl border border-border-muted bg-bg-secondary/60">
                            <Loader2 className="h-6 w-6 animate-spin text-accent" />
                        </div>
                    ) : null}

                    {filteredEvents.map((event) => {
                        const deployment = deploymentIndex.get(event.externalDeploymentId);
                        const isSelected = event.id === selectedEvent?.id;
                        const canReplay = writeEnabled && (event.status === "FAILED" || event.status === "CANCELED");

                        return (
                            <article
                                key={event.id}
                                className={`rounded-2xl border p-4 ${isSelected ? "border-accent/30 bg-accent/5" : "border-border-muted bg-bg-secondary/60"}`}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <button
                                        type="button"
                                        onClick={() => setSelectedEventId(event.id)}
                                        className="min-w-0 text-left"
                                    >
                                        <div className="truncate text-sm font-black text-text-primary">
                                            {event.signalCode}@{event.signalVersion} / {event.symbol} / {event.side}
                                        </div>
                                        <div className="mt-1 text-xs text-text-secondary">
                                            {deployment?.telegramChatLabel ?? deployment?.telegramChatId ?? event.externalDeploymentId}
                                        </div>
                                    </button>
                                    <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] ${eventStatusBadgeClasses[event.status]}`}>
                                        {event.status}
                                    </span>
                                </div>

                                <div className="mt-3 grid gap-2 text-xs text-text-secondary sm:grid-cols-2">
                                    <div>Entry: <span className="font-black text-text-primary">{event.entryPrice ?? event.referencePrice ?? "n/a"}</span></div>
                                    <div>SL / TP1 / TP2: <span className="font-black text-text-primary">{event.stopLoss ?? "n/a"} / {event.takeProfit1 ?? "n/a"} / {event.takeProfit2 ?? "n/a"}</span></div>
                                    <div>Candle: <span className="font-black text-text-primary">{formatDateTime(event.candleTime)}</span></div>
                                    <div>Emitted: <span className="font-black text-text-primary">{formatDateTime(event.emittedAt)}</span></div>
                                </div>

                                {event.statusReason ? (
                                    <div className="mt-3 rounded-xl border border-border-muted bg-bg-tertiary/35 px-3 py-2 text-xs text-text-secondary">
                                        {event.statusReason}
                                    </div>
                                ) : null}

                                <div className="mt-3 flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setSelectedEventId(event.id)}
                                        className="rounded-full border border-border-muted bg-bg-tertiary px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-text-primary"
                                    >
                                        Inspect Payload
                                    </button>
                                    <button
                                        type="button"
                                        disabled={!canReplay || mutating}
                                        onClick={() => { void handleReplay(event.id); }}
                                        className="inline-flex items-center gap-1.5 rounded-full border border-border-muted bg-bg-tertiary px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        <RotateCcw className="h-3.5 w-3.5" />
                                        Replay
                                    </button>
                                </div>
                            </article>
                        );
                    })}

                    {status !== "loading" && filteredEvents.length === 0 ? (
                        <StateBanner
                            tone="neutral"
                            title="No external events matched this scope"
                            message="Events appear when a deployment receives output."
                            className="rounded-2xl"
                        />
                    ) : null}
                </div>

                <div className="space-y-5">
                    <div className="space-y-3 rounded-3xl border border-border-muted bg-bg-tertiary/20 p-4">
                        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-text-muted">
                            <Clock3 className="h-3.5 w-3.5" />
                            Delivery Attempts
                        </div>

                        {filteredDeliveries.map((delivery) => (
                            <article
                                key={delivery.id}
                                className="rounded-2xl border border-border-muted bg-bg-secondary/60 p-4"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <div className="text-sm font-black text-text-primary">
                                            Telegram attempt #{delivery.attemptNumber}
                                        </div>
                                        <div className="mt-1 text-xs text-text-secondary">
                                            Event {delivery.externalActionEventId}
                                        </div>
                                    </div>
                                    <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] ${deliveryStatusBadgeClasses[delivery.status]}`}>
                                        {delivery.status}
                                    </span>
                                </div>

                                <div className="mt-3 grid gap-2 text-xs text-text-secondary sm:grid-cols-2">
                                    <div>Attempted: <span className="font-black text-text-primary">{formatDateTime(delivery.attemptedAt)}</span></div>
                                    <div>Delivered: <span className="font-black text-text-primary">{formatDateTime(delivery.deliveredAt)}</span></div>
                                    <div>Provider chat: <span className="font-black text-text-primary">{delivery.providerChatId ?? "n/a"}</span></div>
                                    <div>Provider message: <span className="font-black text-text-primary">{delivery.providerMessageId ?? "n/a"}</span></div>
                                </div>

                                {delivery.errorMessage ? (
                                    <div className="mt-3 rounded-xl border border-price-down/20 bg-price-down/8 px-3 py-2 text-xs text-price-down/90">
                                        {delivery.errorCode ? `${delivery.errorCode}: ` : ""}{delivery.errorMessage}
                                    </div>
                                ) : null}
                            </article>
                        ))}

                        {filteredDeliveries.length === 0 ? (
                            <StateBanner
                                tone="neutral"
                                title="No delivery attempts yet"
                                message={selectedEvent
                                    ? "Not delivered yet or worker pending."
                                    : "Select an event to view delivery attempts."}
                                className="rounded-2xl"
                            />
                        ) : null}
                    </div>

                    {selectedEvent ? (
                        <div className="space-y-3 rounded-3xl border border-border-muted bg-bg-tertiary/20 p-4">
                            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-text-muted">
                                <TerminalSquare className="h-3.5 w-3.5" />
                                Canonical Payload
                            </div>
                            <div className="rounded-2xl border border-border-muted bg-bg-secondary/60 px-4 py-3 text-xs leading-5 text-text-secondary">
                                Internal trace: <span className="font-black text-text-primary">{selectedEvent.internalSignalEventId}</span>
                                {" / "}
                                Idempotency: <span className="font-black text-text-primary">{selectedEvent.idempotencyKey}</span>
                            </div>
                            <JsonBlock value={selectedEvent.payload} />
                        </div>
                    ) : null}
                </div>
            </div>
        </SectionCard>
    );
}
