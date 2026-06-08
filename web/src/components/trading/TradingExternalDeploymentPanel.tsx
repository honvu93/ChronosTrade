"use client";

import { FormEvent, useMemo, useState } from "react";
import {
    Archive,
    Loader2,
    PauseCircle,
    PlayCircle,
    RadioTower,
    RefreshCcw,
    Send,
} from "lucide-react";
import SectionCard from "@/components/ui/SectionCard";
import StateBanner from "@/components/ui/StateBanner";
import {
    TradingAutomationIndicatorCandidate,
    TradingExternalDeploymentInput,
    TradingExternalDeploymentStatus,
    TradingExternalDeploymentView,
} from "@/types/trading";

type NoticeTone = "success" | "danger" | "neutral";

const statusBadgeClasses: Record<TradingExternalDeploymentStatus, string> = {
    DRAFT: "border-border-muted bg-bg-tertiary text-text-secondary",
    ACTIVE: "border-price-up/30 bg-price-up/10 text-price-up",
    PAUSED: "border-accent/30 bg-accent/10 text-accent",
    AUTO_PAUSED: "border-amber-400/30 bg-amber-400/10 text-amber-100",
    ARCHIVED: "border-border-muted bg-bg-secondary text-text-muted",
};

const defaultTemplateKind = "DEFAULT_V1";

function formatDateTime(value: string | null) {
    return value ? new Date(value).toLocaleString() : "n/a";
}

function buildCandidateLabel(candidate: TradingAutomationIndicatorCandidate) {
    return `${candidate.name} | ${candidate.signalCode}@${candidate.signalVersion} | ${candidate.symbol} / ${candidate.timeframe}`;
}

export default function TradingExternalDeploymentPanel({
    enabled,
    writeEnabled,
    status,
    deployments,
    indicatorCandidates,
    error,
    refreshing,
    mutating,
    selectedDeploymentId,
    onSelectDeployment,
    onRefresh,
    onCreate,
    onEnable,
    onPause,
    onArchive,
}: {
    enabled: boolean;
    writeEnabled: boolean;
    status: "idle" | "loading" | "ready" | "error";
    deployments: TradingExternalDeploymentView[];
    indicatorCandidates?: TradingAutomationIndicatorCandidate[];
    error: string | null;
    refreshing: boolean;
    mutating: boolean;
    selectedDeploymentId?: string | null;
    onSelectDeployment?: (deploymentId: string | null) => void;
    onRefresh: () => Promise<void>;
    onCreate: (input: TradingExternalDeploymentInput) => Promise<TradingExternalDeploymentView>;
    onEnable: (deploymentId: string) => Promise<TradingExternalDeploymentView>;
    onPause: (deploymentId: string, reason?: string | null) => Promise<TradingExternalDeploymentView>;
    onArchive: (deploymentId: string, reason?: string | null) => Promise<TradingExternalDeploymentView>;
}) {
    const [form, setForm] = useState<TradingExternalDeploymentInput>({
        indicatorInstanceId: "",
        telegramBotToken: "",
        telegramBotLabel: "",
        telegramChatId: "",
        telegramChatLabel: "",
        messageTemplateKind: defaultTemplateKind,
    });
    const [notice, setNotice] = useState<{ tone: NoticeTone; message: string } | null>(null);

    const candidateOptions = useMemo(
        () => indicatorCandidates ?? [],
        [indicatorCandidates],
    );

    const sortedDeployments = useMemo(
        () => [...deployments].sort((left, right) => (
            new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
        )),
        [deployments],
    );

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setNotice(null);

        if (!form.indicatorInstanceId.trim()) {
            setNotice({ tone: "danger", message: "Indicator instance id is required before an external deployment can be created." });
            return;
        }
        if (!form.telegramBotToken.trim()) {
            setNotice({ tone: "danger", message: "Telegram bot token is required." });
            return;
        }
        if (!form.telegramChatId.trim()) {
            setNotice({ tone: "danger", message: "Telegram chat id is required." });
            return;
        }

        try {
            const deployment = await onCreate({
                indicatorInstanceId: form.indicatorInstanceId.trim(),
                telegramBotToken: form.telegramBotToken.trim(),
                telegramBotLabel: form.telegramBotLabel?.trim() || null,
                telegramChatId: form.telegramChatId.trim(),
                telegramChatLabel: form.telegramChatLabel?.trim() || null,
                messageTemplateKind: form.messageTemplateKind?.trim() || defaultTemplateKind,
            });
            setForm((current) => ({
                ...current,
                telegramBotToken: "",
            }));
            onSelectDeployment?.(deployment.id);
            setNotice({
                tone: "success",
                message: `External deployment ${deployment.signalCode}@${deployment.signalVersion} was created. Enable it when you are ready to publish Telegram output.`,
            });
        } catch (createError) {
            setNotice({
                tone: "danger",
                message: createError instanceof Error ? createError.message : "Failed to create the external deployment.",
            });
        }
    };

    const runAction = async (
        action: () => Promise<TradingExternalDeploymentView>,
        successMessage: (deployment: TradingExternalDeploymentView) => string,
    ) => {
        setNotice(null);
        try {
            const deployment = await action();
            onSelectDeployment?.(deployment.id);
            setNotice({ tone: "success", message: successMessage(deployment) });
        } catch (actionError) {
            setNotice({
                tone: "danger",
                message: actionError instanceof Error ? actionError.message : "External deployment action failed.",
            });
        }
    };

    if (!enabled) {
        return (
            <StateBanner
                tone="neutral"
                title="Read tier required"
                message="Enable FEATURE_TRADING_READ for deployments."
                className="rounded-3xl"
            />
        );
    }

    return (
        <SectionCard
            title="External Deployments"
            description="Telegram signal deployments"
            icon={<Send className="h-5 w-5" />}
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
                    title="External deployment fetch failed"
                    message={`${error}. ${deployments.length > 0 ? "Showing last snapshot." : "Actions blocked until resolved."}`}
                    className="rounded-2xl"
                />
            ) : null}

            {notice ? (
                <StateBanner
                    tone={notice.tone === "danger" ? "danger" : notice.tone === "success" ? "success" : "neutral"}
                    message={notice.message}
                    size="compact"
                    className="rounded-2xl"
                />
            ) : null}

            {!writeEnabled ? (
                <StateBanner
                    tone="neutral"
                    title="Write tier required for deployment changes"
                    message="Read-only. Enable write tier to modify."
                    className="rounded-2xl"
                />
            ) : null}

            <div className="grid gap-5 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
                <form
                    onSubmit={(event) => { void handleSubmit(event); }}
                    className="space-y-4 rounded-3xl border border-border-muted bg-bg-tertiary/20 p-4"
                >
                    <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-text-muted">
                        <RadioTower className="h-4 w-4" />
                        Create Deployment
                    </div>

                    {candidateOptions.length > 0 ? (
                        <label className="block">
                            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">Quick Pick Indicator</div>
                            <select
                                value={candidateOptions.some((item) => item.id === form.indicatorInstanceId) ? form.indicatorInstanceId : ""}
                                onChange={(event) => setForm((current) => ({ ...current, indicatorInstanceId: event.target.value }))}
                                className="mt-2 h-11 w-full rounded-2xl border border-border-muted bg-bg-secondary px-3 text-sm text-text-primary"
                                disabled={!writeEnabled || mutating}
                            >
                                <option value="">Select from current indicator instances</option>
                                {candidateOptions.map((candidate) => (
                                    <option key={candidate.id} value={candidate.id}>
                                        {buildCandidateLabel(candidate)}
                                    </option>
                                ))}
                            </select>
                        </label>
                    ) : null}

                    <label className="block">
                        <div className="text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">Indicator Instance Id</div>
                        <input
                            value={form.indicatorInstanceId}
                            onChange={(event) => setForm((current) => ({ ...current, indicatorInstanceId: event.target.value }))}
                            placeholder="Paste an indicator instance id"
                            className="mt-2 h-11 w-full rounded-2xl border border-border-muted bg-bg-secondary px-3 text-sm text-text-primary"
                            disabled={!writeEnabled || mutating}
                        />
                    </label>

                    <div className="grid gap-4 lg:grid-cols-2">
                        <label className="block">
                            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">Telegram Bot Label</div>
                            <input
                                value={form.telegramBotLabel ?? ""}
                                onChange={(event) => setForm((current) => ({ ...current, telegramBotLabel: event.target.value }))}
                                placeholder="Alpha broadcast bot"
                                className="mt-2 h-11 w-full rounded-2xl border border-border-muted bg-bg-secondary px-3 text-sm text-text-primary"
                                disabled={!writeEnabled || mutating}
                            />
                        </label>
                        <label className="block">
                            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">Telegram Chat Label</div>
                            <input
                                value={form.telegramChatLabel ?? ""}
                                onChange={(event) => setForm((current) => ({ ...current, telegramChatLabel: event.target.value }))}
                                placeholder="VIP channel"
                                className="mt-2 h-11 w-full rounded-2xl border border-border-muted bg-bg-secondary px-3 text-sm text-text-primary"
                                disabled={!writeEnabled || mutating}
                            />
                        </label>
                    </div>

                    <label className="block">
                        <div className="text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">Telegram Bot Token</div>
                        <input
                            type="password"
                            value={form.telegramBotToken}
                            onChange={(event) => setForm((current) => ({ ...current, telegramBotToken: event.target.value }))}
                            placeholder="Bot token is encrypted server-side"
                            className="mt-2 h-11 w-full rounded-2xl border border-border-muted bg-bg-secondary px-3 text-sm text-text-primary"
                            disabled={!writeEnabled || mutating}
                        />
                    </label>

                    <div className="grid gap-4 lg:grid-cols-2">
                        <label className="block">
                            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">Telegram Chat Id</div>
                            <input
                                value={form.telegramChatId}
                                onChange={(event) => setForm((current) => ({ ...current, telegramChatId: event.target.value }))}
                                placeholder="-1001234567890"
                                className="mt-2 h-11 w-full rounded-2xl border border-border-muted bg-bg-secondary px-3 text-sm text-text-primary"
                                disabled={!writeEnabled || mutating}
                            />
                        </label>
                        <label className="block">
                            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">Message Template</div>
                            <input
                                value={form.messageTemplateKind ?? defaultTemplateKind}
                                onChange={(event) => setForm((current) => ({ ...current, messageTemplateKind: event.target.value }))}
                                className="mt-2 h-11 w-full rounded-2xl border border-border-muted bg-bg-secondary px-3 text-sm text-text-primary"
                                disabled={!writeEnabled || mutating}
                            />
                        </label>
                    </div>

                    <div className="rounded-2xl border border-border-muted bg-bg-secondary/70 px-4 py-3 text-xs leading-5 text-text-secondary">
                        Telegram bot tokens are only used to create or rotate deployment credentials. The API stores an encrypted server-side copy and the UI only shows whether a token exists for each deployment. Eligibility is shown for research context only and does not block signal-only Telegram publishing.
                    </div>

                    <button
                        type="submit"
                        disabled={!writeEnabled || mutating}
                        className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-black text-bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {mutating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        Create External Deployment
                    </button>
                </form>

                <div className="space-y-3 rounded-3xl border border-border-muted bg-bg-tertiary/20 p-4">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <div className="text-xs font-black uppercase tracking-[0.16em] text-text-muted">Deployment Inventory</div>
                            <div className="mt-1 text-sm text-text-secondary">
                                One deployment owns one Telegram bot and one audience target in v1. This lane publishes signal messages only.
                            </div>
                        </div>
                        <div className="rounded-full border border-border-muted bg-bg-secondary px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-text-secondary">
                            {deployments.length} deployment{deployments.length === 1 ? "" : "s"}
                        </div>
                    </div>

                    {status === "loading" && deployments.length === 0 ? (
                        <div className="grid min-h-[180px] place-items-center rounded-2xl border border-border-muted bg-bg-secondary/60">
                            <Loader2 className="h-6 w-6 animate-spin text-accent" />
                        </div>
                    ) : null}

                    {sortedDeployments.map((deployment) => {
                        const canEnable = deployment.status !== "ACTIVE" && deployment.status !== "ARCHIVED";
                        const canPause = deployment.status === "ACTIVE" || deployment.status === "AUTO_PAUSED";
                        const isSelected = selectedDeploymentId === deployment.id;

                        return (
                            <article
                                key={deployment.id}
                                className={`rounded-2xl border p-4 transition ${isSelected ? "border-accent/30 bg-accent/5" : "border-border-muted bg-bg-secondary/60"}`}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <button
                                        type="button"
                                        onClick={() => onSelectDeployment?.(deployment.id)}
                                        className="min-w-0 text-left"
                                    >
                                        <div className="truncate text-sm font-black text-text-primary">
                                            {deployment.signalCode}@{deployment.signalVersion}
                                        </div>
                                        <div className="mt-1 text-xs text-text-secondary">
                                            Indicator {deployment.indicatorInstanceId}
                                        </div>
                                    </button>
                                    <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] ${statusBadgeClasses[deployment.status]}`}>
                                        {deployment.status}
                                    </span>
                                </div>

                                <div className="mt-3 grid gap-2 text-xs text-text-secondary sm:grid-cols-2">
                                    <div>Bot: <span className="font-black text-text-primary">{deployment.telegramBotLabel ?? "Unnamed bot"}</span></div>
                                    <div>Chat: <span className="font-black text-text-primary">{deployment.telegramChatLabel ?? deployment.telegramChatId}</span></div>
                                    <div>Eligibility snapshot: <span className="font-black text-text-primary">{deployment.eligibilityStateSnapshot ?? "n/a"}</span></div>
                                    <div>Token stored: <span className="font-black text-text-primary">{deployment.hasTelegramBotToken ? "Yes" : "No"}</span></div>
                                    <div>Enabled at: <span className="font-black text-text-primary">{formatDateTime(deployment.enabledAt)}</span></div>
                                    <div>Updated: <span className="font-black text-text-primary">{formatDateTime(deployment.updatedAt)}</span></div>
                                </div>

                                {deployment.statusReason ? (
                                    <div className="mt-3 rounded-xl border border-border-muted bg-bg-tertiary/35 px-3 py-2 text-xs text-text-secondary">
                                        {deployment.statusReason}
                                    </div>
                                ) : null}

                                <div className="mt-3 flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        onClick={() => onSelectDeployment?.(deployment.id)}
                                        className="rounded-full border border-border-muted bg-bg-tertiary px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-text-primary"
                                    >
                                        Inspect Audit
                                    </button>
                                    <button
                                        type="button"
                                        disabled={!writeEnabled || !canEnable || mutating}
                                        onClick={() => {
                                            void runAction(
                                                () => onEnable(deployment.id),
                                                (nextDeployment) => `Deployment ${nextDeployment.signalCode}@${nextDeployment.signalVersion} is active and ready to publish new Telegram ENTRY signals.`,
                                            );
                                        }}
                                        className="inline-flex items-center gap-1.5 rounded-full border border-border-muted bg-bg-tertiary px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        <PlayCircle className="h-3.5 w-3.5" />
                                        Enable
                                    </button>
                                    <button
                                        type="button"
                                        disabled={!writeEnabled || !canPause || mutating}
                                        onClick={() => {
                                            void runAction(
                                                () => onPause(deployment.id, "Paused from the external deployment panel."),
                                                (nextDeployment) => `Deployment ${nextDeployment.signalCode}@${nextDeployment.signalVersion} is paused and no new Telegram deliveries will be queued.`,
                                            );
                                        }}
                                        className="inline-flex items-center gap-1.5 rounded-full border border-border-muted bg-bg-tertiary px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        <PauseCircle className="h-3.5 w-3.5" />
                                        Pause
                                    </button>
                                    <button
                                        type="button"
                                        disabled={!writeEnabled || deployment.status === "ARCHIVED" || mutating}
                                        onClick={() => {
                                            void runAction(
                                                () => onArchive(deployment.id, "Archived from the external deployment panel."),
                                                (nextDeployment) => `Deployment ${nextDeployment.signalCode}@${nextDeployment.signalVersion} is archived and removed from active publishing lanes.`,
                                            );
                                        }}
                                        className="inline-flex items-center gap-1.5 rounded-full border border-border-muted bg-bg-tertiary px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        <Archive className="h-3.5 w-3.5" />
                                        Archive
                                    </button>
                                </div>
                            </article>
                        );
                    })}

                    {status !== "loading" && deployments.length === 0 ? (
                        <StateBanner
                            tone="neutral"
                            title="No external deployments yet"
                            message="Create a deployment when an indicator is ready."
                            className="rounded-2xl"
                        />
                    ) : null}
                </div>
            </div>
        </SectionCard>
    );
}
