"use client";

import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
    Activity,
    AlertTriangle,
    Bot,
    Cable,
    Clock3,
    Eye,
    History,
    Loader2,
    PlayCircle,
    RefreshCcw,
    Send,
    ShieldAlert,
    SlidersHorizontal,
    Target,
    TerminalSquare,
    Wallet,
} from "lucide-react";
import { useAuthenticatedEntry } from "@/components/layout/useAuthenticatedEntry";
import { useAuthSession } from "@/hooks/useAuthSession";
import TradingAccountConnectionPanel from "@/components/trading/TradingAccountConnectionPanel";
import TradingAccountReadinessPanel from "@/components/trading/TradingAccountReadinessPanel";
import SignalLiveEligibilityPanel from "@/components/trading/SignalLiveEligibilityPanel";
import GettingStartedChecklist from "@/components/layout/GettingStartedChecklist";
import TradingExternalActionAuditPanel from "@/components/trading/TradingExternalActionAuditPanel";
import TradingExternalDeploymentPanel from "@/components/trading/TradingExternalDeploymentPanel";
import SectionCard from "@/components/ui/SectionCard";
import StateBanner from "@/components/ui/StateBanner";
import { useTradingAccounts } from "@/hooks/useTradingAccounts";
import { useTradingExternalActions } from "@/hooks/useTradingExternalActions";
import { useTradingFeatureFlags } from "@/hooks/useTradingFeatureFlags";
import { useTradingWorkspaceAccount } from "@/hooks/useTradingWorkspaceAccount";
import { resolveTradingSetupSelectedAccountId } from "@/lib/tradingAccountSelection";
import {
    clearStoredTradingWorkspaceAccountId,
    persistStoredTradingWorkspaceAccountId,
    readStoredTradingWorkspaceAccountId,
} from "@/lib/tradingWorkspaceAccountSelectionStorage";
import {
    buildTradingWorkspaceView,
    shouldBootstrapTradingMirrorSync,
} from "@/lib/tradingWorkspaceView";
import { buildTradingWorkspaceHeaderView } from "@/lib/tradingWorkspaceHeaderView";
import { buildTradingHistoryMetricsView } from "@/lib/tradingHistoryMetrics";
import {
    buildUtcDayRangeSummary,
    isUtcDayRangeInvalid,
    toUtcRangeEnd,
    toUtcRangeStart,
} from "@/lib/utcDateRange";
import { useMarketStore } from "@/store/useMarketStore";
import {
    TradingAutomationBindingInput,
    TradingAccountMode,
    TradingAutomationBindingView,
    TradingExecutionCommandInput,
    TradingWorkspaceTab,
} from "@/types/trading";

type FeedbackTone = "success" | "danger" | "neutral";
type DetailSelection =
    | { kind: "position"; id: string }
    | { kind: "order"; id: string }
    | { kind: "deal"; id: string }
    | { kind: "command"; id: string }
    | { kind: "binding"; id: string }
    | { kind: "intent"; id: string }
    | { kind: "sync"; id: string }
    | null;
type TicketMode = "OPEN_MARKET" | "PLACE_PENDING";

type TicketDraft = {
    mode: TicketMode;
    symbol: string;
    side: "LONG" | "SHORT";
    volume: string;
    price: string;
    stopLoss: string;
    takeProfit: string;
    orderType: "BUY_LIMIT" | "SELL_LIMIT" | "BUY_STOP" | "SELL_STOP";
    comment: string;
};

type PositionDraft = {
    positionId: string | null;
    partialVolume: string;
    stopLoss: string;
    takeProfit: string;
};

type BindingDraft = {
    indicatorInstanceId: string;
    name: string;
    mode: TradingAutomationBindingInput["mode"];
    approvalRequired: boolean;
    killSwitchActive: boolean;
    filtersJson: string;
    // Guided risk fields (serialized to riskConfigJson + guardrailsJson on submit)
    riskPercent: number;
    maxOpenPositions: number;
    maxDailyLossPct: number;
    killSwitchDrawdownPct: number;
    showAdvancedJson: boolean;
    riskConfigJson: string;
    guardrailsJson: string;
};

const tabLabels: Array<{
    id: TradingWorkspaceTab;
    label: string;
    icon: typeof Eye;
}> = [
    { id: "overview", label: "Overview", icon: Eye },
    { id: "eligibility", label: "Eligibility", icon: SlidersHorizontal },
    { id: "positions", label: "Positions", icon: Activity },
    { id: "orders", label: "Orders", icon: Target },
    { id: "history", label: "History", icon: History },
    { id: "automation", label: "Automation", icon: Bot },
    { id: "external", label: "External Action", icon: Send },
    { id: "audit", label: "Audit", icon: TerminalSquare },
];

const validTabSet = new Set<TradingWorkspaceTab>(tabLabels.map((tab) => tab.id));

function isTradingWorkspaceTab(value: string | null): value is TradingWorkspaceTab {
    return value !== null && validTabSet.has(value as TradingWorkspaceTab);
}

const syncToneClasses = {
    success: "border-price-up/30 bg-price-up/10 text-price-up",
    caution: "border-amber-400/30 bg-amber-400/10 text-amber-100",
    danger: "border-price-down/30 bg-price-down/10 text-price-down",
    neutral: "border-border-muted bg-bg-tertiary text-text-secondary",
} as const;

function getTradingModeLabel(accountMode: TradingAccountMode) {
    return accountMode === "PAPER" ? "Paper / Demo" : "Live";
}

function getExposureLabel(accountMode: TradingAccountMode) {
    return accountMode === "PAPER" ? "paper exposure" : "live exposure";
}

function getActivityLabel(accountMode: TradingAccountMode) {
    return accountMode === "PAPER" ? "paper-trading activity" : "live trading activity";
}


function formatNumber(value: number | null, digits = 2) {
    if (value === null || Number.isNaN(value)) {
        return "n/a";
    }

    return value.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: digits,
    });
}

function formatCurrency(value: number | null, currency: string | null) {
    if (value === null || Number.isNaN(value)) {
        return "n/a";
    }

    return `${formatNumber(value, 2)} ${currency ?? ""}`.trim();
}

function formatSignedCurrency(value: number, currency: string | null) {
    const sign = value > 0 ? "+" : value < 0 ? "-" : "";
    return `${sign}${formatNumber(Math.abs(value), 2)} ${currency ?? ""}`.trim();
}

function formatPercent(value: number | null, digits = 1) {
    if (value === null || Number.isNaN(value)) {
        return "n/a";
    }

    return `${value.toFixed(digits)}%`;
}

function formatDateTime(value: string | null) {
    return value ? new Date(value).toLocaleString() : "n/a";
}

function parseNumber(value: string) {
    const normalized = value.trim();
    if (!normalized) {
        return null;
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
}

function parseOptionalJson(value: string): { ok: true; data: unknown } | { ok: false; error: string } {
    const normalized = value.trim();
    if (!normalized) {
        return { ok: true, data: null };
    }

    try {
        return { ok: true, data: JSON.parse(normalized) as unknown };
    } catch {
        return { ok: false, error: "Invalid JSON." };
    }
}

function JsonBlock({ value }: { value: unknown }) {
    return (
        <pre className="overflow-x-auto rounded-2xl border border-border-muted bg-bg-secondary/70 p-3 text-[11px] leading-5 text-text-secondary">
            {JSON.stringify(value, null, 2)}
        </pre>
    );
}

function MetricCard({
    label,
    value,
    detail,
    accent = "neutral",
}: {
    label: string;
    value: string;
    detail?: string;
    accent?: "up" | "down" | "neutral";
}) {
    const accentClass = accent === "up"
        ? "text-price-up"
        : accent === "down"
            ? "text-price-down"
            : "text-text-primary";

    return (
        <div className="rounded-2xl border border-border-muted bg-bg-tertiary/45 p-4">
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-text-muted">{label}</div>
            <div className={`mt-2 text-xl font-black tracking-tight ${accentClass}`}>{value}</div>
            {detail ? <div className="mt-1 text-xs text-text-secondary">{detail}</div> : null}
        </div>
    );
}

function TabButton({
    active,
    label,
    icon: Icon,
    onClick,
}: {
    active: boolean;
    label: string;
    icon: typeof Eye;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-black transition-colors ${
                active
                    ? "border-accent/30 bg-accent/10 text-accent"
                    : "border-border-muted bg-bg-tertiary text-text-secondary hover:border-accent/20 hover:text-text-primary"
            }`}
        >
            <Icon className="h-4 w-4" />
            {label}
        </button>
    );
}

function EmptySurface({
    title,
    detail,
}: {
    title: string;
    detail: string;
}) {
    return (
        <div className="rounded-2xl border border-dashed border-border-muted bg-bg-tertiary/20 px-4 py-6 text-sm text-text-secondary">
            <div className="font-black text-text-primary">{title}</div>
            <div className="mt-1 leading-6">{detail}</div>
        </div>
    );
}

function RowActionButton({
    label,
    onClick,
    disabled = false,
}: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className="rounded-full border border-border-muted bg-bg-tertiary px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
            {label}
        </button>
    );
}

export default function TradingWorkspace() {
    const pathname = usePathname();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { landingLabel } = useAuthenticatedEntry();
    const { status: authStatus, isAuthenticated, isAdmin, user } = useAuthSession();
    const { symbol: marketSymbol, timeframe } = useMarketStore();
    const routeTab = searchParams.get("tab");
    const bootstrapSyncAttemptsRef = useRef<Set<string>>(new Set());
    const hydratedSelectionUserIdRef = useRef<string | null>(null);
    const [refreshToken, setRefreshToken] = useState(0);
    const [activeTab, setActiveTab] = useState<TradingWorkspaceTab>(isTradingWorkspaceTab(routeTab) ? routeTab : "overview");
    const [selection, setSelection] = useState<DetailSelection>(null);
    const [feedback, setFeedback] = useState<{ tone: FeedbackTone; message: string } | null>(null);
    const [showConnectionPanels, setShowConnectionPanels] = useState(false);
    const [selectedAccountOwnerUserId, setSelectedAccountOwnerUserId] = useState<string | null>(null);
    const [selectedSetupAccountId, setSelectedSetupAccountId] = useState<string | null>(null);
    const [selectedExternalDeploymentId, setSelectedExternalDeploymentId] = useState<string | null>(null);
    const [fromDate, setFromDate] = useState("");
    const [toDate, setToDate] = useState("");
    const [ticketDraft, setTicketDraft] = useState<TicketDraft>({
        mode: "OPEN_MARKET",
        symbol: marketSymbol,
        side: "LONG",
        volume: "0.10",
        price: "",
        stopLoss: "",
        takeProfit: "",
        orderType: "BUY_LIMIT",
        comment: "",
    });
    const [positionDraft, setPositionDraft] = useState<PositionDraft>({
        positionId: null,
        partialVolume: "",
        stopLoss: "",
        takeProfit: "",
    });
    const [bindingDraft, setBindingDraft] = useState<BindingDraft>({
        indicatorInstanceId: "",
        name: "",
        mode: "MANUAL_APPROVAL",
        approvalRequired: true,
        killSwitchActive: false,
        filtersJson: "",
        riskPercent: 1.0,
        maxOpenPositions: 1,
        maxDailyLossPct: 3.0,
        killSwitchDrawdownPct: 15.0,
        showAdvancedJson: false,
        riskConfigJson: "",
        guardrailsJson: "",
    });

    const {
        status: accountsStatus,
        accounts,
        activeAccount,
        activeAccountId,
        error: accountError,
        refresh: refreshAccounts,
    } = useTradingAccounts({
        enabled: isAuthenticated,
        refreshToken,
        ownerUserId: selectedAccountOwnerUserId,
    });
    const selectedTradingAccountId = useMemo(() => resolveTradingSetupSelectedAccountId({
        accounts,
        activeAccountId,
        selectedAccountId: selectedSetupAccountId,
        isCreatingNew: false,
    }), [accounts, activeAccountId, selectedSetupAccountId]);
    const selectedTradingAccount = useMemo(() => (
        selectedTradingAccountId
            ? accounts.find((item) => item.id === selectedTradingAccountId) ?? null
            : null
    ), [accounts, selectedTradingAccountId]);

    useEffect(() => {
        if (!user?.id) {
            hydratedSelectionUserIdRef.current = null;
            setSelectedAccountOwnerUserId(null);
            setSelectedSetupAccountId(null);
            return;
        }

        if (hydratedSelectionUserIdRef.current === user.id) {
            return;
        }

        hydratedSelectionUserIdRef.current = user.id;
        setSelectedAccountOwnerUserId(user.id);
        setSelectedSetupAccountId(readStoredTradingWorkspaceAccountId(user.id));
    }, [user?.id]);

    useEffect(() => {
        if (!user?.id || isAdmin) {
            return;
        }

        setSelectedAccountOwnerUserId(user.id);
    }, [isAdmin, user?.id]);

    useEffect(() => {
        if (!user?.id) {
            return;
        }

        if (selectedAccountOwnerUserId && selectedAccountOwnerUserId !== user.id) {
            return;
        }

        if (selectedTradingAccountId) {
            persistStoredTradingWorkspaceAccountId(user.id, selectedTradingAccountId);
            return;
        }

        clearStoredTradingWorkspaceAccountId(user.id);
    }, [selectedAccountOwnerUserId, selectedTradingAccountId, user?.id]);
    const {
        status: flagsStatus,
        snapshot: featureFlags,
        error: flagsError,
        refresh: refreshFlags,
    } = useTradingFeatureFlags({
        enabled: isAuthenticated,
        accountId: selectedTradingAccountId,
        ownerUserId: selectedAccountOwnerUserId,
    });
    const readEnabled = Boolean(featureFlags?.capabilities.read.enabled);
    const writeEnabled = Boolean(featureFlags?.capabilities.write.enabled);
    const {
        status: workspaceStatus,
        workspace,
        commands,
        automation,
        intents,
        historyDeals,
        historyError,
        historyLoading,
        error: workspaceError,
        refreshing,
        syncing,
        mutating,
        refresh,
        forceSync,
        loadHistory,
        resetHistory,
        submitCommand,
        createBinding,
        updateBinding,
    } = useTradingWorkspaceAccount({
        accountId: selectedTradingAccountId,
        ownerUserId: selectedAccountOwnerUserId,
        enabled: isAuthenticated && Boolean(selectedTradingAccountId) && readEnabled,
    });
    const {
        status: externalStatus,
        deployments: externalDeployments,
        events: externalEvents,
        deliveries: externalDeliveries,
        error: externalError,
        refreshing: externalRefreshing,
        mutating: externalMutating,
        refresh: refreshExternalActions,
        createDeployment,
        enableDeployment,
        pauseDeployment,
        archiveDeployment,
        replayEvent,
    } = useTradingExternalActions({
        enabled: isAuthenticated && readEnabled,
        ownerUserId: selectedAccountOwnerUserId,
    });

    useEffect(() => {
        setTicketDraft((current) => (
            current.symbol.trim()
                ? current
                : { ...current, symbol: marketSymbol }
        ));
    }, [marketSymbol]);

    useEffect(() => {
        const nextTab = isTradingWorkspaceTab(routeTab) ? routeTab : "overview";
        setActiveTab((current) => current === nextTab ? current : nextTab);
    }, [routeTab]);

    useEffect(() => {
        if (selectedExternalDeploymentId && !externalDeployments.some((deployment) => deployment.id === selectedExternalDeploymentId)) {
            setSelectedExternalDeploymentId(null);
        }
    }, [externalDeployments, selectedExternalDeploymentId]);

    useEffect(() => {
        if (!selectedTradingAccountId) {
            setSelection(null);
            return;
        }

        setSelection(null);
        setFeedback(null);
    }, [selectedTradingAccountId]);

    useEffect(() => {
        setSelectedSetupAccountId((current) => current ?? activeAccountId ?? activeAccount?.id ?? null);
    }, [activeAccount?.id, activeAccountId]);

    const selectedAccountScopeLabel = selectedAccountOwnerUserId && user?.id && selectedAccountOwnerUserId !== user.id
        ? "the selected user"
        : "this signed-in user";

    const workspaceView = workspace
        ? buildTradingWorkspaceView({
            summary: workspace.summary,
            featureFlags,
            automation,
            commands,
        })
        : null;
    const headerView = workspace && workspaceView
        ? buildTradingWorkspaceHeaderView({
            landingLabel,
            marketSymbol,
            timeframe,
            accountLabel: workspace.summary.accountLabel,
            accountMode: workspace.summary.accountMode,
            syncLabel: workspaceView.syncLabel,
            activeTab,
        })
        : null;
    const historyRangeInvalid = isUtcDayRangeInvalid(fromDate, toDate);
    const historyRangeSummary = buildUtcDayRangeSummary(fromDate, toDate);
    const hasActiveHistoryFilter = Boolean(fromDate || toDate);
    const historyMetrics = useMemo(() => buildTradingHistoryMetricsView({
        deals: historyDeals,
        hasActiveFilter: hasActiveHistoryFilter,
        rangeSummary: historyRangeSummary,
    }), [hasActiveHistoryFilter, historyDeals, historyRangeSummary]);

    useEffect(() => {
        if (!selectedTradingAccountId || !workspace || workspaceStatus !== "ready" || !readEnabled || syncing) {
            return;
        }

        if (!shouldBootstrapTradingMirrorSync({
            summary: workspace.summary,
            syncRunsCount: workspace.syncRuns.length,
        })) {
            return;
        }

        if (bootstrapSyncAttemptsRef.current.has(selectedTradingAccountId)) {
            return;
        }

        bootstrapSyncAttemptsRef.current.add(selectedTradingAccountId);
        setFeedback({
            tone: "neutral",
            message: "Initial MT5 mirror sync is running so account history can be loaded into the workspace.",
        });

        void forceSync()
            .then(() => {
                setFeedback({
                    tone: "success",
                    message: "Initial MT5 mirror sync completed and broker history is now mirrored locally.",
                });
            })
            .catch((error) => {
                setFeedback({
                    tone: "danger",
                    message: error instanceof Error
                        ? error.message
                        : "Initial MT5 mirror sync failed.",
                });
            });
    }, [forceSync, readEnabled, selectedTradingAccountId, syncing, workspace, workspaceStatus]);

    useEffect(() => {
        setFromDate("");
        setToDate("");
        resetHistory({ clear: true });
    }, [resetHistory, selectedTradingAccountId]);

    const selectedPosition = selection?.kind === "position"
        ? workspace?.positions.find((item) => item.id === selection.id) ?? null
        : null;
    const selectedOrder = selection?.kind === "order"
        ? workspace?.orders.find((item) => item.id === selection.id) ?? null
        : null;
    const selectedDeal = selection?.kind === "deal"
        ? historyDeals.find((item) => item.id === selection.id)
            ?? workspace?.deals.find((item) => item.id === selection.id)
            ?? null
        : null;
    const selectedCommand = selection?.kind === "command"
        ? commands.find((item) => item.id === selection.id) ?? null
        : null;
    const selectedBinding = selection?.kind === "binding"
        ? automation?.bindings.find((item) => item.id === selection.id) ?? null
        : null;
    const selectedIntent = selection?.kind === "intent"
        ? intents.find((item) => item.id === selection.id) ?? null
        : null;
    const selectedSyncRun = selection?.kind === "sync"
        ? workspace?.syncRuns.find((item) => item.id === selection.id) ?? null
        : null;
    const selectedCommandPayloadEvent = selectedCommand
        ? [...selectedCommand.events].reverse().find((event) => event.payloadJson) ?? null
        : null;

    useEffect(() => {
        if (!selectedPosition) {
            return;
        }

        setPositionDraft({
            positionId: selectedPosition.id,
            partialVolume: String(selectedPosition.volume),
            stopLoss: selectedPosition.stopLoss === null ? "" : String(selectedPosition.stopLoss),
            takeProfit: selectedPosition.takeProfit === null ? "" : String(selectedPosition.takeProfit),
        });
    }, [selectedPosition]);

    useEffect(() => {
        if (!automation) {
            return;
        }

        const nextIndicator = automation.availableIndicators[0]?.id ?? "";
        setBindingDraft((current) => (
            current.indicatorInstanceId || !nextIndicator
                ? current
                : { ...current, indicatorInstanceId: nextIndicator }
        ));
    }, [automation]);

    const refreshAll = async () => {
        await Promise.all([
            refreshAccounts(),
            refreshFlags(),
            selectedTradingAccountId && readEnabled ? refresh() : Promise.resolve(),
            readEnabled ? refreshExternalActions() : Promise.resolve(),
        ]);
    };

    const handleTabChange = useCallback((nextTab: TradingWorkspaceTab) => {
        setActiveTab(nextTab);
        const params = new URLSearchParams(searchParams.toString());
        if (nextTab === "overview") {
            params.delete("tab");
        } else {
            params.set("tab", nextTab);
        }
        const query = params.toString();
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }, [pathname, router, searchParams]);

    const pushFeedback = (tone: FeedbackTone, message: string) => {
        setFeedback({ tone, message });
    };

    const runCommand = async (
        input: TradingExecutionCommandInput,
        successMessage: string,
    ) => {
        try {
            const command = await submitCommand(input);
            handleTabChange("audit");
            setSelection({ kind: "command", id: command.id });
            pushFeedback("success", `${successMessage} Command status: ${command.status}.`);
        } catch (error) {
            pushFeedback("danger", error instanceof Error ? error.message : "Trading command failed.");
        }
    };

    const handleForceSync = async () => {
        try {
            await forceSync();
            pushFeedback("success", "Mirror sync completed and workspace data has been refreshed.");
        } catch (error) {
            pushFeedback("danger", error instanceof Error ? error.message : "Force sync failed.");
        }
    };

    const handleApplyHistoryRange = async () => {
        if (historyRangeInvalid) {
            pushFeedback("danger", "History date range is invalid. The UTC from-date must be earlier than or equal to the to-date.");
            return;
        }

        try {
            await loadHistory({
                ...(fromDate ? { from: toUtcRangeStart(fromDate) } : {}),
                ...(toDate ? { to: toUtcRangeEnd(toDate) } : {}),
            });
            pushFeedback("neutral", hasActiveHistoryFilter
                ? "Mirrored history was refreshed for the selected UTC date range."
                : "Mirrored history returned to the default bounded snapshot.");
        } catch (error) {
            pushFeedback("danger", error instanceof Error ? error.message : "Failed to filter mirrored history.");
        }
    };

    const handleResetHistoryRange = () => {
        setFromDate("");
        setToDate("");
        resetHistory();
        pushFeedback("neutral", "History date filters were cleared and the default mirrored snapshot is back.");
    };

    const handleTicketSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        const volume = parseNumber(ticketDraft.volume);
        const price = parseNumber(ticketDraft.price);
        const stopLoss = parseNumber(ticketDraft.stopLoss);
        const takeProfit = parseNumber(ticketDraft.takeProfit);

        await runCommand(
            ticketDraft.mode === "OPEN_MARKET"
                ? {
                    commandType: "OPEN_MARKET",
                    symbol: ticketDraft.symbol,
                    side: ticketDraft.side,
                    volume,
                    stopLoss,
                    takeProfit,
                    comment: ticketDraft.comment || null,
                }
                : {
                    commandType: "PLACE_PENDING",
                    symbol: ticketDraft.symbol,
                    side: ticketDraft.side,
                    volume,
                    price,
                    stopLoss,
                    takeProfit,
                    orderType: ticketDraft.orderType,
                    comment: ticketDraft.comment || null,
                },
            ticketDraft.mode === "OPEN_MARKET"
                ? "Market command dispatched through the approved boundary."
                : "Pending order command dispatched through the approved boundary.",
        );
    };

    const handleCreateBinding = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        try {
            const filters = parseOptionalJson(bindingDraft.filtersJson);
            if (!filters.ok) { pushFeedback("danger", `Filters JSON: ${filters.error}`); return; }

            // If advanced JSON mode is active, validate and use those directly
            let riskConfigData: unknown = null;
            let guardrailsData: unknown = null;
            if (bindingDraft.showAdvancedJson) {
                const riskConfig = parseOptionalJson(bindingDraft.riskConfigJson);
                if (!riskConfig.ok) { pushFeedback("danger", `Risk Config JSON: ${riskConfig.error}`); return; }
                const guardrails = parseOptionalJson(bindingDraft.guardrailsJson);
                if (!guardrails.ok) { pushFeedback("danger", `Guardrails JSON: ${guardrails.error}`); return; }
                riskConfigData = riskConfig.data;
                guardrailsData = guardrails.data;
            } else {
                // Serialize guided form fields to JSON
                riskConfigData = {
                    riskPercent: bindingDraft.riskPercent,
                    maxOpenPositions: bindingDraft.maxOpenPositions,
                };
                guardrailsData = {
                    maxOpenPositions: bindingDraft.maxOpenPositions,
                    maxDailyLossPct: bindingDraft.maxDailyLossPct,
                    killSwitchDrawdownPct: bindingDraft.killSwitchDrawdownPct,
                };
            }

            await createBinding({
                indicatorInstanceId: bindingDraft.indicatorInstanceId,
                name: bindingDraft.name,
                mode: bindingDraft.mode,
                approvalRequired: bindingDraft.approvalRequired,
                killSwitchActive: bindingDraft.killSwitchActive,
                filtersJson: filters.data,
                riskConfigJson: riskConfigData,
                guardrailsJson: guardrailsData,
            });
            pushFeedback("success", "Automation binding created and queued for approval.");
            setBindingDraft((current) => ({
                ...current,
                name: "",
                filtersJson: "",
                riskPercent: 1.0,
                maxOpenPositions: 1,
                maxDailyLossPct: 3.0,
                killSwitchDrawdownPct: 15.0,
                riskConfigJson: "",
                guardrailsJson: "",
            }));
        } catch (error) {
            pushFeedback("danger", error instanceof Error ? error.message : "Failed to create the automation binding.");
        }
    };

    const handleBindingStatus = async (
        binding: TradingAutomationBindingView,
        status: "PENDING_APPROVAL" | "ACTIVE" | "PAUSED" | "ARCHIVED",
        killSwitchActive = binding.killSwitchActive,
    ) => {
        try {
            await updateBinding(binding.id, {
                status,
                killSwitchActive,
                statusReason: status === "ACTIVE"
                    ? "Activated from MT5 workspace."
                    : status === "PAUSED"
                        ? "Paused from MT5 workspace."
                        : status === "ARCHIVED"
                            ? "Archived from MT5 workspace."
                            : "Re-queued for approval from MT5 workspace.",
            });
            pushFeedback("success", `Binding ${binding.name} updated to ${status}.`);
        } catch (error) {
            pushFeedback("danger", error instanceof Error ? error.message : "Failed to update binding state.");
        }
    };

    const handleOwnerScopeChange = (ownerUserId: string | null) => {
        setSelectedAccountOwnerUserId(ownerUserId ?? user?.id ?? null);
        setSelectedSetupAccountId(null);
        setSelectedExternalDeploymentId(null);
        setSelection(null);
        setFeedback(null);
    };

    const renderConnectionState = (
        <div className="grid gap-5 2xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
            <TradingAccountConnectionPanel
                readEnabled={readEnabled}
                refreshToken={refreshToken}
                ownerUserId={selectedAccountOwnerUserId}
                onOwnerUserIdChange={handleOwnerScopeChange}
                selectedAccountId={selectedSetupAccountId}
                onSelectedAccountChange={setSelectedSetupAccountId}
                onAccountChanged={() => {
                    setRefreshToken((current) => current + 1);
                    void refreshAccounts();
                    void refresh();
                }}
            />
            <TradingAccountReadinessPanel
                readEnabled={readEnabled}
                refreshToken={refreshToken}
                accountId={selectedSetupAccountId}
            />
        </div>
    );

    const renderExternalSignalLane = ({ standalone = false }: { standalone?: boolean } = {}) => (
        <div className="space-y-5">
            {standalone ? (
                <StateBanner
                    tone="neutral"
                    title="Signal Output Lane Is Available Without MT5 Mirror"
                    icon={<Send className="h-4 w-4" />}
                    message="Connect MT5 to unlock mirror surfaces."
                />
            ) : null}

            <SignalLiveEligibilityPanel enabled={readEnabled} />

            <TradingExternalDeploymentPanel
                enabled={readEnabled}
                writeEnabled={writeEnabled}
                status={externalStatus}
                deployments={externalDeployments}
                indicatorCandidates={automation?.availableIndicators ?? []}
                error={externalError}
                refreshing={externalRefreshing}
                mutating={externalMutating}
                selectedDeploymentId={selectedExternalDeploymentId}
                onSelectDeployment={setSelectedExternalDeploymentId}
                onRefresh={refreshExternalActions}
                onCreate={createDeployment}
                onEnable={enableDeployment}
                onPause={pauseDeployment}
                onArchive={archiveDeployment}
            />

            <TradingExternalActionAuditPanel
                enabled={readEnabled}
                writeEnabled={writeEnabled}
                status={externalStatus}
                deployments={externalDeployments}
                events={externalEvents}
                deliveries={externalDeliveries}
                error={externalError}
                refreshing={externalRefreshing}
                mutating={externalMutating}
                selectedDeploymentId={selectedExternalDeploymentId}
                onSelectDeployment={setSelectedExternalDeploymentId}
                onRefresh={refreshExternalActions}
                onReplay={replayEvent}
            />
        </div>
    );

    const renderWorkspaceShell = (
        content: ReactNode,
        maxWidthClassName = "max-w-[1720px]",
    ) => (
        <div className="command-deck-canvas h-full overflow-y-auto">
            <div className={`mx-auto flex min-h-full w-full flex-col gap-5 p-4 pb-8 lg:p-6 ${maxWidthClassName}`}>
                {content}
            </div>
        </div>
    );

    if (authStatus === "loading") {
        return renderWorkspaceShell(
            <section className="space-y-5">
                <StateBanner
                    tone="neutral"
                    title="Validating Session"
                    icon={<Loader2 className="h-4 w-4 animate-spin" />}
                    message="Validating session..."
                />
            </section>,
            "max-w-6xl",
        );
    }

    if (!isAuthenticated) {
        return renderWorkspaceShell(
            <section className="space-y-5">
                <StateBanner
                    tone="neutral"
                    title="Signed-In Session Required"
                    icon={<ShieldAlert className="h-4 w-4" />}
                    message="Login required for trading."
                />
            </section>,
            "max-w-6xl",
        );
    }

    if (flagsStatus === "loading" && !featureFlags) {
        return renderWorkspaceShell(
            <section className="space-y-5">
                <StateBanner
                    tone="neutral"
                    title="Loading Trading Capabilities"
                    icon={<Loader2 className="h-4 w-4 animate-spin" />}
                    message="Checking feature flags..."
                />
                {renderConnectionState}
            </section>,
            "max-w-6xl",
        );
    }

    if (!readEnabled) {
        return renderWorkspaceShell(
            <section className="space-y-5">
                <StateBanner
                    tone="neutral"
                    title="Trading Read Tier Disabled"
                    icon={<ShieldAlert className="h-4 w-4" />}
                    message={
                        flagsError
                            ? `${flagsError}. Connection setup still available.`
                            : featureFlags?.capabilities.read.reason
                                || "Enable FEATURE_TRADING_READ to unlock MT5."
                    }
                />
                {renderConnectionState}
            </section>,
            "max-w-6xl",
        );
    }

    if (accountsStatus === "loading" && !selectedTradingAccount) {
        return renderWorkspaceShell(
            <section className="space-y-5">
                <StateBanner
                    tone="neutral"
                    title="Loading MT5 Account"
                    icon={<Loader2 className="h-4 w-4 animate-spin" />}
                    message="Resolving MT5 account..."
                />
                {renderConnectionState}
                {renderExternalSignalLane({ standalone: true })}
            </section>,
            "max-w-[1720px]",
        );
    }

    if (accountError && !selectedTradingAccount) {
        return renderWorkspaceShell(
            <section className="space-y-5">
                <StateBanner
                    tone="caution"
                    title="MT5 Account Lookup Failed"
                    icon={<AlertTriangle className="h-4 w-4" />}
                    message={accountError}
                />
                {renderConnectionState}
                {renderExternalSignalLane({ standalone: true })}
            </section>,
            "max-w-[1720px]",
        );
    }

    if (!selectedTradingAccount) {
        return renderWorkspaceShell(
            <section className="space-y-5">
                <StateBanner
                    tone="neutral"
                    title="Connect An MT5 Account"
                    icon={<Cable className="h-4 w-4" />}
                    message={`No MT5 account linked to ${selectedAccountScopeLabel}.`}
                />
                {renderConnectionState}
                {renderExternalSignalLane({ standalone: true })}
            </section>,
            "max-w-[1720px]",
        );
    }

    if ((workspaceStatus === "loading" || workspaceStatus === "idle") && !workspace) {
        return renderWorkspaceShell(
            <section className="space-y-5">
                <StateBanner
                    tone="neutral"
                    title="Hydrating MT5 Mirror"
                    icon={<Loader2 className="h-4 w-4 animate-spin" />}
                    message="Loading account data..."
                />
            </section>,
            "max-w-6xl",
        );
    }

    if (!workspace || !workspaceView) {
        return renderWorkspaceShell(
            <section className="space-y-5">
                <StateBanner
                    tone="danger"
                    title="Workspace Unavailable"
                    icon={<AlertTriangle className="h-4 w-4" />}
                    message={workspaceError ?? "The trading workspace could not be loaded."}
                />
            </section>,
            "max-w-6xl",
        );
    }

    const selectedDetail = selectedPosition ?? selectedOrder ?? selectedDeal ?? selectedCommand ?? selectedBinding ?? selectedIntent ?? selectedSyncRun;

    const detailRail = (() => {
        if (selectedPosition) {
            return (
                <SectionCard
                    title={`Position ${selectedPosition.symbol}`}
                    description={`Broker position ${selectedPosition.brokerPositionId} / ${selectedPosition.side}`}
                    variant="compact"
                    icon={<Activity className="h-4 w-4" />}
                >
                    <div className="grid gap-2 text-sm text-text-secondary">
                        <div>Volume: <span className="font-black text-text-primary">{formatNumber(selectedPosition.volume, 2)}</span></div>
                        <div>Open price: <span className="font-black text-text-primary">{formatNumber(selectedPosition.openPrice, 5)}</span></div>
                        <div>Current price: <span className="font-black text-text-primary">{formatNumber(selectedPosition.currentPrice, 5)}</span></div>
                        <div>PnL: <span className={`font-black ${selectedPosition.unrealizedPnl >= 0 ? "text-price-up" : "text-price-down"}`}>{formatNumber(selectedPosition.unrealizedPnl, 2)}</span></div>
                        <div>Synced: <span className="font-black text-text-primary">{formatDateTime(selectedPosition.lastSyncedAt)}</span></div>
                    </div>

                    <div className="space-y-3 rounded-2xl border border-border-muted bg-bg-tertiary/30 p-4">
                        <div className="text-xs font-black uppercase tracking-[0.18em] text-text-muted">Manual Position Actions</div>
                        <button
                            type="button"
                            disabled={!workspaceView.writeLane.enabled || mutating}
                            onClick={() => {
                                void runCommand(
                                    {
                                        commandType: "CLOSE_POSITION",
                                        brokerPositionId: selectedPosition.brokerPositionId,
                                    },
                                    "Close position command dispatched.",
                                );
                            }}
                            className="w-full rounded-full bg-accent px-4 py-2 text-sm font-black text-bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            Close Entire Position
                        </button>

                        <label className="block">
                            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">Partial Close Volume</div>
                            <input
                                value={positionDraft.partialVolume}
                                onChange={(event) => setPositionDraft((current) => ({ ...current, partialVolume: event.target.value }))}
                                className="mt-2 h-10 w-full rounded-2xl border border-border-muted bg-bg-secondary px-3 text-sm"
                                disabled={!workspaceView.writeLane.enabled || mutating}
                            />
                        </label>
                        <button
                            type="button"
                            disabled={!workspaceView.writeLane.enabled || mutating}
                            onClick={() => {
                                void runCommand(
                                    {
                                        commandType: "PARTIAL_CLOSE",
                                        brokerPositionId: selectedPosition.brokerPositionId,
                                        volume: parseNumber(positionDraft.partialVolume),
                                    },
                                    "Partial close command dispatched.",
                                );
                            }}
                            className="w-full rounded-full border border-border-muted bg-bg-secondary px-4 py-2 text-sm font-black text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            Partial Close
                        </button>

                        <div className="grid gap-3 sm:grid-cols-2">
                            <label className="block">
                                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">Stop Loss</div>
                                <input
                                    value={positionDraft.stopLoss}
                                    onChange={(event) => setPositionDraft((current) => ({ ...current, stopLoss: event.target.value }))}
                                    className="mt-2 h-10 w-full rounded-2xl border border-border-muted bg-bg-secondary px-3 text-sm"
                                    disabled={!workspaceView.writeLane.enabled || mutating}
                                />
                            </label>
                            <label className="block">
                                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">Take Profit</div>
                                <input
                                    value={positionDraft.takeProfit}
                                    onChange={(event) => setPositionDraft((current) => ({ ...current, takeProfit: event.target.value }))}
                                    className="mt-2 h-10 w-full rounded-2xl border border-border-muted bg-bg-secondary px-3 text-sm"
                                    disabled={!workspaceView.writeLane.enabled || mutating}
                                />
                            </label>
                        </div>
                        <button
                            type="button"
                            disabled={!workspaceView.writeLane.enabled || mutating}
                            onClick={() => {
                                void runCommand(
                                    {
                                        commandType: "MODIFY_POSITION",
                                        brokerPositionId: selectedPosition.brokerPositionId,
                                        stopLoss: parseNumber(positionDraft.stopLoss),
                                        takeProfit: parseNumber(positionDraft.takeProfit),
                                    },
                                    "Modify position command dispatched.",
                                );
                            }}
                            className="w-full rounded-full border border-border-muted bg-bg-secondary px-4 py-2 text-sm font-black text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            Modify SL / TP
                        </button>
                    </div>

                    {!workspaceView.writeLane.enabled ? (
                        <StateBanner
                            tone="neutral"
                            size="compact"
                            message={workspaceView.writeLane.message}
                        />
                    ) : null}
                </SectionCard>
            );
        }

        if (selectedOrder) {
            return (
                <SectionCard
                    title={`Order ${selectedOrder.symbol}`}
                    description={`Broker order ${selectedOrder.brokerOrderId} / ${selectedOrder.orderType}`}
                    variant="compact"
                    icon={<Target className="h-4 w-4" />}
                >
                    <div className="grid gap-2 text-sm text-text-secondary">
                        <div>Requested volume: <span className="font-black text-text-primary">{formatNumber(selectedOrder.requestedVolume, 2)}</span></div>
                        <div>Filled volume: <span className="font-black text-text-primary">{formatNumber(selectedOrder.filledVolume, 2)}</span></div>
                        <div>Status: <span className="font-black text-text-primary">{selectedOrder.status}</span></div>
                        <div>Placed: <span className="font-black text-text-primary">{formatDateTime(selectedOrder.placedAt)}</span></div>
                    </div>
                    <button
                        type="button"
                        disabled={!workspaceView.writeLane.enabled || mutating}
                        onClick={() => {
                            void runCommand(
                                {
                                    commandType: "CANCEL_ORDER",
                                    brokerOrderId: selectedOrder.brokerOrderId,
                                },
                                "Cancel order command dispatched.",
                            );
                        }}
                        className="w-full rounded-full border border-border-muted bg-bg-secondary px-4 py-2 text-sm font-black text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        Cancel Pending Order
                    </button>
                    {!workspaceView.writeLane.enabled ? (
                        <StateBanner
                            tone="neutral"
                            size="compact"
                            message={workspaceView.writeLane.message}
                        />
                    ) : null}
                </SectionCard>
            );
        }

        if (selectedDeal) {
            return (
                <SectionCard
                    title={`Deal ${selectedDeal.symbol}`}
                    description={`Broker deal ${selectedDeal.brokerDealId}`}
                    variant="compact"
                    icon={<History className="h-4 w-4" />}
                >
                    <div className="grid gap-2 text-sm text-text-secondary">
                        <div>Side: <span className="font-black text-text-primary">{selectedDeal.side}</span></div>
                        <div>Volume: <span className="font-black text-text-primary">{formatNumber(selectedDeal.volume, 2)}</span></div>
                        <div>Price: <span className="font-black text-text-primary">{formatNumber(selectedDeal.price, 5)}</span></div>
                        <div>Realized PnL: <span className={`font-black ${selectedDeal.realizedPnl >= 0 ? "text-price-up" : "text-price-down"}`}>{formatNumber(selectedDeal.realizedPnl, 2)}</span></div>
                        <div>Executed: <span className="font-black text-text-primary">{formatDateTime(selectedDeal.executedAt)}</span></div>
                        {selectedDeal.comment ? <div>Comment: <span className="font-black text-text-primary">{selectedDeal.comment}</span></div> : null}
                    </div>
                </SectionCard>
            );
        }

        if (selectedCommand) {
            return (
                <SectionCard
                    title={selectedCommand.commandType}
                    description={`Status ${selectedCommand.status} / ${selectedCommand.idempotencyKey}`}
                    variant="compact"
                    icon={<TerminalSquare className="h-4 w-4" />}
                >
                    <div className="grid gap-2 text-sm text-text-secondary">
                        <div>Requested: <span className="font-black text-text-primary">{formatDateTime(selectedCommand.requestedAt)}</span></div>
                        <div>Dispatched: <span className="font-black text-text-primary">{formatDateTime(selectedCommand.dispatchedAt)}</span></div>
                        <div>Completed: <span className="font-black text-text-primary">{formatDateTime(selectedCommand.completedAt)}</span></div>
                        <div>Reconciled: <span className="font-black text-text-primary">{formatDateTime(selectedCommand.reconciledAt)}</span></div>
                        {selectedCommand.errorCode ? (
                            <div>Error code: <span className="font-black text-text-primary">{selectedCommand.errorCode}</span></div>
                        ) : null}
                        {selectedCommand.errorMessage ? (
                            <div className="rounded-xl border border-price-down/20 bg-price-down/8 px-3 py-2 text-price-down/90">
                                {selectedCommand.errorMessage}
                            </div>
                        ) : null}
                    </div>
                    {selectedCommandPayloadEvent?.payloadJson ? (
                        <div className="space-y-2">
                            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">Latest Broker Payload</div>
                            <JsonBlock value={selectedCommandPayloadEvent.payloadJson} />
                        </div>
                    ) : null}
                    <div className="space-y-2">
                        <div className="text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">Lifecycle Events</div>
                        {selectedCommand.events.length > 0 ? selectedCommand.events.map((event) => (
                            <div key={event.id} className="rounded-xl border border-border-muted bg-bg-tertiary/30 px-3 py-2">
                                <div className="flex items-center justify-between gap-2 text-[11px]">
                                    <span className="font-black text-text-primary">{event.eventType}</span>
                                    <span className="text-text-muted">{formatDateTime(event.occurredAt)}</span>
                                </div>
                                <div className="mt-1 text-xs text-text-secondary">{event.message ?? "No event message."}</div>
                            </div>
                        )) : (
                            <EmptySurface
                                title="No lifecycle events"
                                detail="Event details appear here as command state transitions are recorded."
                            />
                        )}
                    </div>
                </SectionCard>
            );
        }

        if (selectedBinding) {
            return (
                <SectionCard
                    title={selectedBinding.name}
                    description={`${selectedBinding.signalCode} v${selectedBinding.signalVersion} / ${selectedBinding.mode}`}
                    variant="compact"
                    icon={<Bot className="h-4 w-4" />}
                >
                    <div className="grid gap-2 text-sm text-text-secondary">
                        <div>Indicator: <span className="font-black text-text-primary">{selectedBinding.indicatorName}</span></div>
                        <div>Status: <span className="font-black text-text-primary">{selectedBinding.status}</span></div>
                        <div>Approval required: <span className="font-black text-text-primary">{selectedBinding.approvalRequired ? "Yes" : "No"}</span></div>
                        <div>Kill switch: <span className="font-black text-text-primary">{selectedBinding.killSwitchActive ? "Active" : "Clear"}</span></div>
                        <div>Updated: <span className="font-black text-text-primary">{formatDateTime(selectedBinding.updatedAt)}</span></div>
                    </div>
                    {(selectedBinding.filtersJson ?? selectedBinding.riskConfigJson ?? selectedBinding.guardrailsJson) ? (
                        <div className="space-y-3">
                            {selectedBinding.filtersJson ? (
                                <div>
                                    <div className="mb-1 text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">Filters</div>
                                    <JsonBlock value={selectedBinding.filtersJson} />
                                </div>
                            ) : null}
                            {selectedBinding.riskConfigJson ? (
                                <div>
                                    <div className="mb-1 text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">Risk Profile</div>
                                    <JsonBlock value={selectedBinding.riskConfigJson} />
                                </div>
                            ) : null}
                            {selectedBinding.guardrailsJson ? (
                                <div>
                                    <div className="mb-1 text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">Guardrails</div>
                                    <JsonBlock value={selectedBinding.guardrailsJson} />
                                </div>
                            ) : null}
                        </div>
                    ) : null}
                </SectionCard>
            );
        }

        if (selectedIntent) {
            return (
                <SectionCard
                    title={`${selectedIntent.bindingName} · ${selectedIntent.eventType}`}
                    description={`${selectedIntent.status} / ${selectedIntent.commandType}`}
                    variant="compact"
                    icon={<PlayCircle className="h-4 w-4" />}
                >
                    <div className="grid gap-2 text-sm text-text-secondary">
                        <div>Indicator: <span className="font-black text-text-primary">{selectedIntent.indicatorName}</span></div>
                        <div>Symbol: <span className="font-black text-text-primary">{selectedIntent.symbol}</span></div>
                        <div>Side: <span className="font-black text-text-primary">{selectedIntent.side ?? "n/a"}</span></div>
                        <div>Volume: <span className="font-black text-text-primary">{formatNumber(selectedIntent.volume, 2)}</span></div>
                        <div>Entry: <span className="font-black text-text-primary">{formatNumber(selectedIntent.entryPrice, 5)}</span></div>
                        <div>Stop Loss: <span className="font-black text-text-primary">{formatNumber(selectedIntent.stopLoss, 5)}</span></div>
                        <div>Take Profit: <span className="font-black text-text-primary">{formatNumber(selectedIntent.takeProfit, 5)}</span></div>
                        <div>Queued: <span className="font-black text-text-primary">{formatDateTime(selectedIntent.createdAt)}</span></div>
                        <div>Started: <span className="font-black text-text-primary">{formatDateTime(selectedIntent.startedAt)}</span></div>
                        <div>Completed: <span className="font-black text-text-primary">{formatDateTime(selectedIntent.completedAt)}</span></div>
                        <div>Linked command: <span className="font-black text-text-primary">{selectedIntent.executionCommandStatus ?? "Not created"}</span></div>
                        {selectedIntent.statusReason ? (
                            <div className="rounded-xl border border-border-muted bg-bg-tertiary/30 px-3 py-2 text-text-primary">
                                {selectedIntent.statusReason}
                            </div>
                        ) : null}
                    </div>
                    {selectedIntent.payloadJson ? <JsonBlock value={selectedIntent.payloadJson} /> : null}
                </SectionCard>
            );
        }

        if (selectedSyncRun) {
            return (
                <SectionCard
                    title={`${selectedSyncRun.syncKind} Sync`}
                    description={`Status ${selectedSyncRun.status}`}
                    variant="compact"
                    icon={<RefreshCcw className="h-4 w-4" />}
                >
                    <div className="grid gap-2 text-sm text-text-secondary">
                        <div>Started: <span className="font-black text-text-primary">{formatDateTime(selectedSyncRun.startedAt)}</span></div>
                        <div>Finished: <span className="font-black text-text-primary">{formatDateTime(selectedSyncRun.finishedAt)}</span></div>
                        {selectedSyncRun.errorMessage ? <div>Error: <span className="font-black text-price-down">{selectedSyncRun.errorMessage}</span></div> : null}
                    </div>
                    {selectedSyncRun.summaryJson ? <JsonBlock value={selectedSyncRun.summaryJson} /> : null}
                </SectionCard>
            );
        }

        return (
            <SectionCard
                title="Account Context"
                description="System status overview"
                variant="compact"
                icon={<Wallet className="h-4 w-4" />}
            >
                <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-black uppercase tracking-[0.16em] ${syncToneClasses[workspaceView.syncTone]}`}>
                    <Clock3 className="h-3.5 w-3.5" />
                    {workspaceView.syncLabel}
                </div>
                <div className="space-y-2 text-sm text-text-secondary">
                    <div>Account: <span className="font-black text-text-primary">{workspace.summary.accountLabel}</span></div>
                    <div>Mode: <span className="font-black text-text-primary">{getTradingModeLabel(workspace.summary.accountMode)}</span></div>
                    <div>MT5 Server: <span className="font-black text-text-primary">{workspace.summary.mt5Server ?? "n/a"}</span></div>
                    <div>Latest command: <span className="font-black text-text-primary">{workspaceView.latestCommandLabel}</span></div>
                </div>
                <StateBanner
                    tone={workspaceView.writeLane.enabled ? "success" : "neutral"}
                    size="compact"
                    title={workspaceView.writeLane.label}
                    message={workspaceView.writeLane.message}
                />
                <StateBanner
                    tone={workspaceView.automationLane.enabled ? "success" : "neutral"}
                    size="compact"
                    title={workspaceView.automationLane.label}
                    message={workspaceView.automationLane.message}
                />
            </SectionCard>
        );
    })();

    return renderWorkspaceShell(
        <section className="space-y-5">
            <SectionCard
                title="MT5 Native Trading Workspace"
                description="Broker state terminal"
                icon={<TerminalSquare className="h-5 w-5" />}
                headerAside={(
                    <div className="flex flex-wrap justify-end gap-2">
                        <button
                            type="button"
                            onClick={() => { void refreshAll(); }}
                            disabled={refreshing || flagsStatus === "loading" || accountsStatus === "loading"}
                            className="inline-flex items-center gap-2 rounded-full border border-border-muted bg-bg-tertiary px-4 py-2 text-sm font-black text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                            Refresh Mirror
                        </button>
                        <button
                            type="button"
                            onClick={() => { void handleForceSync(); }}
                            disabled={!workspace.summary.syncHealth.canForceSync || syncing}
                            className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-black text-bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
                            Force Sync
                        </button>
                        <button
                            type="button"
                            onClick={() => setShowConnectionPanels((current) => !current)}
                            className="inline-flex items-center gap-2 rounded-full border border-border-muted bg-bg-tertiary px-4 py-2 text-sm font-black text-text-primary"
                        >
                            <SlidersHorizontal className="h-4 w-4" />
                            {showConnectionPanels ? "Hide Account Setup" : "Account Setup"}
                        </button>
                    </div>
                )}
            >
                <div className="flex flex-wrap items-center gap-3">
                    {headerView?.badges.map((badge) => (
                        <span
                            key={badge}
                            className={`rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] ${
                                badge === workspaceView.syncLabel
                                    ? syncToneClasses[workspaceView.syncTone]
                                    : "border-border-muted bg-bg-tertiary text-text-secondary"
                            }`}
                        >
                            {badge}
                        </span>
                    ))}
                </div>

                <div className="mt-4 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-3">
                            <div className="text-2xl font-black tracking-tight text-text-primary">
                                {workspace.summary.accountLabel}
                            </div>
                            <span className={`rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] ${
                                workspace.summary.accountMode === "PAPER"
                                    ? "border-amber-400/30 bg-amber-400/10 text-amber-100"
                                    : "border-price-down/25 bg-price-down/10 text-price-down"
                            }`}>
                                {getTradingModeLabel(workspace.summary.accountMode)}
                            </span>
                        </div>
                        <div className="mt-1 text-sm text-text-secondary">{workspaceView.summaryLine}</div>
                    </div>
                    <div className="grid min-w-[280px] gap-3 sm:grid-cols-2">
                        <StateBanner
                            tone={workspaceView.writeLane.enabled ? "success" : "neutral"}
                            title={workspaceView.writeLane.label}
                            message={workspaceView.writeLane.message}
                            className="rounded-2xl"
                        />
                        <StateBanner
                            tone={workspaceView.automationLane.enabled ? "success" : "neutral"}
                            title={workspaceView.automationLane.label}
                            message={workspaceView.automationLane.message}
                            className="rounded-2xl"
                        />
                    </div>
                </div>

                {workspaceView.staleWarning ? (
                    <StateBanner
                        tone={workspaceView.syncTone === "danger" ? "danger" : "caution"}
                        icon={<AlertTriangle className="h-4 w-4" />}
                        message={workspaceView.staleWarning}
                        className="mt-4 rounded-2xl"
                    />
                ) : null}

                {feedback ? (
                    <StateBanner
                        tone={feedback.tone}
                        message={feedback.message}
                        className="mt-4 rounded-2xl"
                    />
                ) : null}

                {workspaceError ? (
                    <StateBanner
                        tone="caution"
                        icon={<AlertTriangle className="h-4 w-4" />}
                        message={workspaceError}
                        className="mt-4 rounded-2xl"
                    />
                ) : null}

                {showConnectionPanels ? (
                    <div className="mt-5 grid gap-5 2xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
                        <TradingAccountConnectionPanel
                            readEnabled={readEnabled}
                            refreshToken={refreshToken}
                            ownerUserId={selectedAccountOwnerUserId}
                            onOwnerUserIdChange={handleOwnerScopeChange}
                            selectedAccountId={selectedSetupAccountId}
                            onSelectedAccountChange={setSelectedSetupAccountId}
                            onAccountChanged={() => {
                                setRefreshToken((current) => current + 1);
                                void refreshAccounts();
                                void refresh();
                            }}
                        />
                        <TradingAccountReadinessPanel
                            readEnabled={readEnabled}
                            refreshToken={refreshToken}
                            accountId={selectedSetupAccountId}
                        />
                    </div>
                ) : null}
            </SectionCard>

            <GettingStartedChecklist enabled={readEnabled} />

            <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_360px]">
                <div className="space-y-5">
                    <SectionCard
                        title="Account Overview"
                        description="Account metrics summary"
                        icon={<Wallet className="h-5 w-5" />}
                    >
                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                            <MetricCard
                                label="Balance"
                                value={formatCurrency(workspace.summary.balance, workspace.summary.baseCurrency)}
                                detail="Mirrored broker balance"
                            />
                            <MetricCard
                                label="Equity"
                                value={formatCurrency(workspace.summary.equity, workspace.summary.baseCurrency)}
                                detail="Balance plus floating PnL"
                            />
                            <MetricCard
                                label="Free Margin"
                                value={formatCurrency(workspace.summary.freeMargin, workspace.summary.baseCurrency)}
                                detail={`Margin ${formatCurrency(workspace.summary.margin, workspace.summary.baseCurrency)}`}
                            />
                            <MetricCard
                                label="Floating PnL"
                                value={formatCurrency(workspace.summary.unrealizedPnl, workspace.summary.baseCurrency)}
                                accent={workspace.summary.unrealizedPnl >= 0 ? "up" : "down"}
                                detail={`Margin level ${workspace.summary.marginLevel === null ? "n/a" : `${formatNumber(workspace.summary.marginLevel, 2)}%`}`}
                            />
                            <MetricCard
                                label="Realized Today"
                                value={formatCurrency(workspace.summary.realizedPnlDay, workspace.summary.baseCurrency)}
                                accent={workspace.summary.realizedPnlDay >= 0 ? "up" : "down"}
                                detail={`${workspace.summary.totalDealCount} mirrored deals`}
                            />
                            <MetricCard
                                label="Open Exposure"
                                value={`${workspace.summary.openPositionCount} positions`}
                                detail={`${workspace.summary.pendingOrderCount} pending orders / leverage ${workspace.summary.leverage ?? "n/a"}`}
                            />
                        </div>
                    </SectionCard>

                    <div className="sticky top-3 z-20">
                        <div className="rounded-[28px] border border-border-muted bg-bg-primary/92 p-3 shadow-[0_22px_70px_rgba(4,10,22,0.28)] backdrop-blur-xl">
                            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                                <div className="flex gap-2 overflow-x-auto pb-1">
                                    {tabLabels.map((tab) => (
                                        <TabButton
                                            key={tab.id}
                                            active={activeTab === tab.id}
                                            label={tab.label}
                                            icon={tab.icon}
                                            onClick={() => handleTabChange(tab.id)}
                                        />
                                    ))}
                                </div>

                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="rounded-full border border-border-muted bg-bg-tertiary px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-text-secondary">
                                        Account {workspace.summary.accountLabel}
                                    </span>
                                    <span className={`rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] ${syncToneClasses[workspaceView.syncTone]}`}>
                                        {workspaceView.syncLabel}
                                    </span>
                                    <span className="rounded-full border border-border-muted bg-bg-tertiary px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-text-secondary">
                                        {historyRangeSummary ?? "Default History"}
                                    </span>
                                    {selectedDetail ? (
                                        <span className="rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-accent">
                                            Detail Loaded
                                        </span>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                    </div>

                    {activeTab === "overview" ? (
                        <SectionCard
                            title="Terminal Snapshot"
                            description="Account overview"
                            icon={<Eye className="h-5 w-5" />}
                        >
                            <div className="grid gap-4 lg:grid-cols-3">
                                <div className="rounded-2xl border border-border-muted bg-bg-tertiary/30 p-4">
                                    <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-text-muted">
                                        <Clock3 className="h-3.5 w-3.5" />
                                        Freshness
                                    </div>
                                    <div className="mt-3 space-y-2 text-sm text-text-secondary">
                                        <div>Last successful sync: <span className="font-black text-text-primary">{formatDateTime(workspace.summary.syncHealth.lastSuccessfulSyncAt)}</span></div>
                                        <div>Last sync attempt: <span className="font-black text-text-primary">{formatDateTime(workspace.summary.syncHealth.lastSyncAttemptAt)}</span></div>
                                        <div>Can trade now: <span className="font-black text-text-primary">{workspace.summary.syncHealth.canTrade ? "Yes" : "No"}</span></div>
                                    </div>
                                </div>
                                <div className="rounded-2xl border border-border-muted bg-bg-tertiary/30 p-4">
                                    <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-text-muted">
                                        <Activity className="h-3.5 w-3.5" />
                                        Mirror Counts
                                    </div>
                                    <div className="mt-3 space-y-2 text-sm text-text-secondary">
                                        <div>Open positions: <span className="font-black text-text-primary">{workspace.positions.length}</span></div>
                                        <div>Pending orders: <span className="font-black text-text-primary">{workspace.orders.length}</span></div>
                                        <div>Deals in history: <span className="font-black text-text-primary">{workspace.deals.length}</span></div>
                                    </div>
                                </div>
                                <div className="rounded-2xl border border-border-muted bg-bg-tertiary/30 p-4">
                                    <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-text-muted">
                                        <Bot className="h-3.5 w-3.5" />
                                        Automation Queue
                                    </div>
                                    <div className="mt-3 space-y-2 text-sm text-text-secondary">
                                        <div>Bindings: <span className="font-black text-text-primary">{automation?.bindings.length ?? 0}</span></div>
                                        <div>Pending approvals: <span className="font-black text-text-primary">{automation?.pendingApprovalCount ?? 0}</span></div>
                                        <div>Auto-execute: <span className="font-black text-text-primary">{automation?.autoExecuteLocked ? "Locked" : "Enabled"}</span></div>
                                    </div>
                                </div>
                            </div>

                            <div className="grid gap-4 lg:grid-cols-2">
                                <div className="rounded-2xl border border-border-muted bg-bg-tertiary/20 p-4">
                                    <div className="text-xs font-black uppercase tracking-[0.16em] text-text-muted">Recent Commands</div>
                                    <div className="mt-3 space-y-2">
                                        {commands.slice(0, 4).map((command) => (
                                            <button
                                                key={command.id}
                                                type="button"
                                                onClick={() => {
                                                    handleTabChange("audit");
                                                    setSelection({ kind: "command", id: command.id });
                                                }}
                                                className="flex w-full items-start justify-between gap-3 rounded-2xl border border-border-muted bg-bg-secondary/70 px-3 py-2 text-left"
                                            >
                                                <div>
                                                    <div className="text-sm font-black text-text-primary">{command.commandType}</div>
                                                    <div className="text-xs text-text-secondary">{formatDateTime(command.requestedAt)}</div>
                                                </div>
                                                <span className="text-[11px] font-black uppercase tracking-[0.16em] text-text-secondary">{command.status}</span>
                                            </button>
                                        ))}
                                        {commands.length === 0 ? (
                                            <EmptySurface
                                                title="No command activity yet"
                                                detail="Approved command records will appear here once manual trading or force-sync actions run."
                                            />
                                        ) : null}
                                    </div>
                                </div>

                                <div className="rounded-2xl border border-border-muted bg-bg-tertiary/20 p-4">
                                    <div className="text-xs font-black uppercase tracking-[0.16em] text-text-muted">Latest Deals</div>
                                    <div className="mt-3 space-y-2">
                                        {workspace.deals.slice(0, 4).map((deal) => (
                                            <button
                                                key={deal.id}
                                                type="button"
                                                onClick={() => {
                                                    handleTabChange("history");
                                                    setSelection({ kind: "deal", id: deal.id });
                                                }}
                                                className="flex w-full items-start justify-between gap-3 rounded-2xl border border-border-muted bg-bg-secondary/70 px-3 py-2 text-left"
                                            >
                                                <div>
                                                    <div className="text-sm font-black text-text-primary">{deal.symbol} {deal.side}</div>
                                                    <div className="text-xs text-text-secondary">{formatDateTime(deal.executedAt)}</div>
                                                </div>
                                                <span className={`text-sm font-black ${deal.realizedPnl >= 0 ? "text-price-up" : "text-price-down"}`}>
                                                    {formatNumber(deal.realizedPnl, 2)}
                                                </span>
                                            </button>
                                        ))}
                                        {workspace.deals.length === 0 ? (
                                            <EmptySurface
                                                title="No mirrored deals"
                                                detail="Trade history appears after the bridge sync captures completed broker deals."
                                            />
                                        ) : null}
                                    </div>
                                </div>
                            </div>
                        </SectionCard>
                    ) : null}

                    {activeTab === "eligibility" ? (
                        <SignalLiveEligibilityPanel enabled={readEnabled} />
                    ) : null}

                    {activeTab === "positions" ? (
                        <SectionCard
                            title="Open Positions"
                            description="Open positions"
                            icon={<Activity className="h-5 w-5" />}
                        >
                            {!workspaceView.writeLane.enabled ? (
                                <StateBanner
                                    tone="neutral"
                                    size="compact"
                                    message={workspaceView.writeLane.message}
                                    className="mb-4"
                                />
                            ) : null}
                            {workspace.positions.length > 0 ? (
                                <div className="overflow-x-auto">
                                    <table className="min-w-full text-left text-sm">
                                        <thead className="text-[11px] uppercase tracking-[0.16em] text-text-muted">
                                            <tr>
                                                <th className="px-3 py-2">Symbol</th>
                                                <th className="px-3 py-2">Side</th>
                                                <th className="px-3 py-2">Volume</th>
                                                <th className="px-3 py-2">Open</th>
                                                <th className="px-3 py-2">Current</th>
                                                <th className="px-3 py-2">PnL</th>
                                                <th className="px-3 py-2">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {workspace.positions.map((position) => (
                                                <tr
                                                    key={position.id}
                                                    className={`border-t border-border-muted/60 ${selectedPosition?.id === position.id ? "bg-accent/5" : ""}`}
                                                >
                                                    <td className="px-3 py-3">
                                                        <button
                                                            type="button"
                                                            onClick={() => setSelection({ kind: "position", id: position.id })}
                                                            className="text-left font-black text-text-primary"
                                                        >
                                                            {position.symbol}
                                                        </button>
                                                    </td>
                                                    <td className="px-3 py-3">{position.side}</td>
                                                    <td className="px-3 py-3">{formatNumber(position.volume, 2)}</td>
                                                    <td className="px-3 py-3">{formatNumber(position.openPrice, 5)}</td>
                                                    <td className="px-3 py-3">{formatNumber(position.currentPrice, 5)}</td>
                                                    <td className={`px-3 py-3 font-black ${position.unrealizedPnl >= 0 ? "text-price-up" : "text-price-down"}`}>
                                                        {formatNumber(position.unrealizedPnl, 2)}
                                                    </td>
                                                    <td className="px-3 py-3">
                                                        <div className="flex flex-wrap gap-2">
                                                            <RowActionButton
                                                                label="Inspect"
                                                                onClick={() => setSelection({ kind: "position", id: position.id })}
                                                            />
                                                            <RowActionButton
                                                                label="Close"
                                                                disabled={!workspaceView.writeLane.enabled || mutating}
                                                                onClick={() => {
                                                                    setSelection({ kind: "position", id: position.id });
                                                                    void runCommand(
                                                                        {
                                                                            commandType: "CLOSE_POSITION",
                                                                            brokerPositionId: position.brokerPositionId,
                                                                        },
                                                                        "Close position command dispatched.",
                                                                    );
                                                                }}
                                                            />
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <EmptySurface
                                    title="No open positions"
                                    detail={`Once the account mirror captures ${getExposureLabel(workspace.summary.accountMode)}, positions will appear here with inspection and action controls.`}
                                />
                            )}
                        </SectionCard>
                    ) : null}

                    {activeTab === "orders" ? (
                        <SectionCard
                            title="Orders & Ticket"
                            description="Order entry"
                            icon={<Target className="h-5 w-5" />}
                        >
                            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                                <form className="space-y-4 rounded-3xl border border-border-muted bg-bg-tertiary/20 p-4" onSubmit={(event) => { void handleTicketSubmit(event); }}>
                                    <div className="flex flex-wrap gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setTicketDraft((current) => ({ ...current, mode: "OPEN_MARKET" }))}
                                            className={`rounded-full border px-4 py-2 text-sm font-black ${
                                                ticketDraft.mode === "OPEN_MARKET"
                                                    ? "border-accent/30 bg-accent/10 text-accent"
                                                    : "border-border-muted bg-bg-secondary text-text-secondary"
                                            }`}
                                        >
                                            Open Market
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setTicketDraft((current) => ({ ...current, mode: "PLACE_PENDING" }))}
                                            className={`rounded-full border px-4 py-2 text-sm font-black ${
                                                ticketDraft.mode === "PLACE_PENDING"
                                                    ? "border-accent/30 bg-accent/10 text-accent"
                                                    : "border-border-muted bg-bg-secondary text-text-secondary"
                                            }`}
                                        >
                                            Place Pending
                                        </button>
                                    </div>

                                    {!workspaceView.writeLane.enabled ? (
                                        <StateBanner
                                            tone="neutral"
                                            size="compact"
                                            message={workspaceView.writeLane.message}
                                        />
                                    ) : null}

                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <label className="block">
                                            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">Symbol</div>
                                            <input
                                                value={ticketDraft.symbol}
                                                onChange={(event) => setTicketDraft((current) => ({ ...current, symbol: event.target.value }))}
                                                className="mt-2 h-10 w-full rounded-2xl border border-border-muted bg-bg-secondary px-3 text-sm"
                                                disabled={!workspaceView.writeLane.enabled || mutating}
                                            />
                                        </label>
                                        <label className="block">
                                            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">Side</div>
                                            <select
                                                value={ticketDraft.side}
                                                onChange={(event) => setTicketDraft((current) => ({ ...current, side: event.target.value as "LONG" | "SHORT" }))}
                                                className="mt-2 h-10 w-full rounded-2xl border border-border-muted bg-bg-secondary px-3 text-sm"
                                                disabled={!workspaceView.writeLane.enabled || mutating}
                                            >
                                                <option value="LONG">LONG</option>
                                                <option value="SHORT">SHORT</option>
                                            </select>
                                        </label>
                                        <label className="block">
                                            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">Volume</div>
                                            <input
                                                value={ticketDraft.volume}
                                                onChange={(event) => setTicketDraft((current) => ({ ...current, volume: event.target.value }))}
                                                className="mt-2 h-10 w-full rounded-2xl border border-border-muted bg-bg-secondary px-3 text-sm"
                                                disabled={!workspaceView.writeLane.enabled || mutating}
                                            />
                                        </label>
                                        {ticketDraft.mode === "PLACE_PENDING" ? (
                                            <label className="block">
                                                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">Order Type</div>
                                                <select
                                                    value={ticketDraft.orderType}
                                                    onChange={(event) => setTicketDraft((current) => ({ ...current, orderType: event.target.value as TicketDraft["orderType"] }))}
                                                    className="mt-2 h-10 w-full rounded-2xl border border-border-muted bg-bg-secondary px-3 text-sm"
                                                    disabled={!workspaceView.writeLane.enabled || mutating}
                                                >
                                                    <option value="BUY_LIMIT">BUY_LIMIT</option>
                                                    <option value="SELL_LIMIT">SELL_LIMIT</option>
                                                    <option value="BUY_STOP">BUY_STOP</option>
                                                    <option value="SELL_STOP">SELL_STOP</option>
                                                </select>
                                            </label>
                                        ) : null}
                                        {ticketDraft.mode === "PLACE_PENDING" ? (
                                            <label className="block">
                                                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">Price</div>
                                                <input
                                                    value={ticketDraft.price}
                                                    onChange={(event) => setTicketDraft((current) => ({ ...current, price: event.target.value }))}
                                                    className="mt-2 h-10 w-full rounded-2xl border border-border-muted bg-bg-secondary px-3 text-sm"
                                                    disabled={!workspaceView.writeLane.enabled || mutating}
                                                />
                                            </label>
                                        ) : null}
                                        <label className="block">
                                            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">Stop Loss</div>
                                            <input
                                                value={ticketDraft.stopLoss}
                                                onChange={(event) => setTicketDraft((current) => ({ ...current, stopLoss: event.target.value }))}
                                                className="mt-2 h-10 w-full rounded-2xl border border-border-muted bg-bg-secondary px-3 text-sm"
                                                disabled={!workspaceView.writeLane.enabled || mutating}
                                            />
                                        </label>
                                        <label className="block">
                                            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">Take Profit</div>
                                            <input
                                                value={ticketDraft.takeProfit}
                                                onChange={(event) => setTicketDraft((current) => ({ ...current, takeProfit: event.target.value }))}
                                                className="mt-2 h-10 w-full rounded-2xl border border-border-muted bg-bg-secondary px-3 text-sm"
                                                disabled={!workspaceView.writeLane.enabled || mutating}
                                            />
                                        </label>
                                    </div>

                                    <label className="block">
                                        <div className="text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">Comment</div>
                                        <input
                                            value={ticketDraft.comment}
                                            onChange={(event) => setTicketDraft((current) => ({ ...current, comment: event.target.value }))}
                                            className="mt-2 h-10 w-full rounded-2xl border border-border-muted bg-bg-secondary px-3 text-sm"
                                            disabled={!workspaceView.writeLane.enabled || mutating}
                                            placeholder="Optional broker comment"
                                        />
                                    </label>

                                    <button
                                        type="submit"
                                        disabled={!workspaceView.writeLane.enabled || mutating}
                                        className="w-full rounded-full bg-accent px-4 py-2.5 text-sm font-black text-bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        Submit Approved Command
                                    </button>
                                </form>
                                <div className="rounded-3xl border border-border-muted bg-bg-tertiary/20 p-4">
                                    <div className="text-xs font-black uppercase tracking-[0.16em] text-text-muted">Pending Orders</div>
                                    <div className="mt-3 space-y-2">
                                        {workspace.orders.map((order) => (
                                            <div key={order.id} className={`rounded-2xl border px-3 py-3 ${selectedOrder?.id === order.id ? "border-accent/30 bg-accent/5" : "border-border-muted bg-bg-secondary/70"}`}>
                                                <div className="flex items-start justify-between gap-3">
                                                    <button
                                                        type="button"
                                                        onClick={() => setSelection({ kind: "order", id: order.id })}
                                                        className="text-left"
                                                    >
                                                        <div className="text-sm font-black text-text-primary">{order.symbol} {order.side}</div>
                                                        <div className="text-xs text-text-secondary">{order.orderType} / {order.status}</div>
                                                    </button>
                                                    <RowActionButton
                                                        label="Cancel"
                                                        disabled={!workspaceView.writeLane.enabled || mutating}
                                                        onClick={() => {
                                                            setSelection({ kind: "order", id: order.id });
                                                            void runCommand(
                                                                {
                                                                    commandType: "CANCEL_ORDER",
                                                                    brokerOrderId: order.brokerOrderId,
                                                                },
                                                                "Cancel order command dispatched.",
                                                            );
                                                        }}
                                                    />
                                                </div>
                                                <div className="mt-2 text-xs text-text-secondary">
                                                    Price {formatNumber(order.price, 5)} / Volume {formatNumber(order.requestedVolume, 2)} / Synced {formatDateTime(order.lastSyncedAt)}
                                                </div>
                                            </div>
                                        ))}
                                        {workspace.orders.length === 0 ? (
                                            <EmptySurface
                                                title="No pending orders"
                                                detail="Pending MT5 orders will appear here after mirror sync captures them."
                                            />
                                        ) : null}
                                    </div>
                                </div>
                            </div>
                        </SectionCard>
                    ) : null}

                    {activeTab === "history" ? (
                        <SectionCard
                            title="Deals & History"
                            description="Deal history"
                            icon={<History className="h-5 w-5" />}
                        >
                            <div className="mb-4 grid gap-4 rounded-3xl border border-border-muted bg-bg-tertiary/20 p-4 lg:grid-cols-[minmax(0,1fr)_auto]">
                                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                                    <label className="block">
                                        <div className="text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">From (UTC)</div>
                                        <input
                                            type="date"
                                            value={fromDate}
                                            max={toDate || undefined}
                                            onChange={(event) => setFromDate(event.target.value)}
                                            className="mt-2 h-10 w-full rounded-2xl border border-border-muted bg-bg-secondary px-3 text-sm"
                                        />
                                    </label>
                                    <label className="block">
                                        <div className="text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">To (UTC)</div>
                                        <input
                                            type="date"
                                            value={toDate}
                                            min={fromDate || undefined}
                                            onChange={(event) => setToDate(event.target.value)}
                                            className="mt-2 h-10 w-full rounded-2xl border border-border-muted bg-bg-secondary px-3 text-sm"
                                        />
                                    </label>
                                    <div className="rounded-2xl border border-border-muted bg-bg-secondary/70 px-4 py-3 text-sm text-text-secondary">
                                        <div className="text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">Active Range</div>
                                        <div className="mt-2 font-black text-text-primary">{historyRangeSummary ?? "Default bounded snapshot"}</div>
                                    </div>
                                    <div className="rounded-2xl border border-border-muted bg-bg-secondary/70 px-4 py-3 text-sm text-text-secondary">
                                        <div className="text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">Mirrored Deals Shown</div>
                                        <div className="mt-2 font-black text-text-primary">{historyDeals.length}</div>
                                    </div>
                                </div>
                                <div className="flex flex-wrap items-end gap-3">
                                    <button
                                        type="button"
                                        onClick={() => { void handleApplyHistoryRange(); }}
                                        disabled={historyLoading}
                                        className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2.5 text-sm font-black text-bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        {historyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <History className="h-4 w-4" />}
                                        Apply Range
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleResetHistoryRange}
                                        disabled={historyLoading}
                                        className="inline-flex items-center gap-2 rounded-full border border-border-muted bg-bg-tertiary px-4 py-2.5 text-sm font-black text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        Reset Range
                                    </button>
                                </div>
                            </div>

                            {historyRangeInvalid ? (
                                <StateBanner
                                    tone="caution"
                                    icon={<AlertTriangle className="h-4 w-4" />}
                                    message="Invalid date range. From must be before To."
                                    className="mb-4 rounded-2xl"
                                />
                            ) : null}

                            {historyError ? (
                                <StateBanner
                                    tone="caution"
                                    icon={<AlertTriangle className="h-4 w-4" />}
                                    message={historyError}
                                    className="mb-4 rounded-2xl"
                                />
                            ) : null}

                            {historyDeals.length > 0 ? (
                                <div className="overflow-x-auto">
                                    <table className="min-w-full text-left text-sm">
                                        <thead className="text-[11px] uppercase tracking-[0.16em] text-text-muted">
                                            <tr>
                                                <th className="px-3 py-2">Time</th>
                                                <th className="px-3 py-2">Symbol</th>
                                                <th className="px-3 py-2">Side</th>
                                                <th className="px-3 py-2">Volume</th>
                                                <th className="px-3 py-2">Price</th>
                                                <th className="px-3 py-2">PnL</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {historyDeals.map((deal) => (
                                                <tr
                                                    key={deal.id}
                                                    className={`border-t border-border-muted/60 ${selectedDeal?.id === deal.id ? "bg-accent/5" : ""}`}
                                                >
                                                    <td className="px-3 py-3">
                                                        <button
                                                            type="button"
                                                            onClick={() => setSelection({ kind: "deal", id: deal.id })}
                                                            className="text-left text-text-primary"
                                                        >
                                                            {formatDateTime(deal.executedAt)}
                                                        </button>
                                                    </td>
                                                    <td className="px-3 py-3 font-black text-text-primary">{deal.symbol}</td>
                                                    <td className="px-3 py-3">{deal.side}</td>
                                                    <td className="px-3 py-3">{formatNumber(deal.volume, 2)}</td>
                                                    <td className="px-3 py-3">{formatNumber(deal.price, 5)}</td>
                                                    <td className={`px-3 py-3 font-black ${deal.realizedPnl >= 0 ? "text-price-up" : "text-price-down"}`}>
                                                        {formatNumber(deal.realizedPnl, 2)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <EmptySurface
                                    title={hasActiveHistoryFilter ? "No mirrored deals in this UTC range" : "No mirrored history yet"}
                                    detail={hasActiveHistoryFilter
                                        ? "The selected UTC range returned zero mirrored deals. Adjust the dates or clear the filter to inspect other periods."
                                        : `Run a sync after ${getActivityLabel(workspace.summary.accountMode)} to populate account deal history.`}
                                />
                            )}
                        </SectionCard>
                    ) : null}

                    {activeTab === "automation" ? (
                        <SectionCard
                            title="Automation Bindings"
                            description="Automation bindings"
                            icon={<Bot className="h-5 w-5" />}
                        >
                            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
                                <form className="space-y-4 rounded-3xl border border-border-muted bg-bg-tertiary/20 p-4" onSubmit={(event) => { void handleCreateBinding(event); }}>
                                    <StateBanner
                                        tone={workspaceView.automationLane.enabled ? "success" : "neutral"}
                                        size="compact"
                                        title={workspaceView.automationLane.label}
                                        message={workspaceView.automationLane.message}
                                    />
                                    {automation?.autoExecuteLocked ? (
                                        <StateBanner
                                            tone="neutral"
                                            size="compact"
                                            icon={<ShieldAlert className="h-4 w-4" />}
                                            message="Auto-execute locked. Use observe or manual."
                                        />
                                    ) : workspace.summary.accountMode === "PAPER" ? (
                                        <StateBanner
                                            tone="success"
                                            size="compact"
                                            icon={<Bot className="h-4 w-4" />}
                                            message="Paper auto-execute enabled. Live blocked."
                                        />
                                    ) : null}
                                    <label className="block">
                                        <div className="text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">Indicator Instance</div>
                                        <select
                                            value={bindingDraft.indicatorInstanceId}
                                            onChange={(event) => setBindingDraft((current) => ({ ...current, indicatorInstanceId: event.target.value }))}
                                            className="mt-2 h-10 w-full rounded-2xl border border-border-muted bg-bg-secondary px-3 text-sm"
                                            disabled={!workspaceView.automationLane.enabled || mutating}
                                        >
                                            {automation?.availableIndicators.map((indicator) => (
                                                <option key={indicator.id} value={indicator.id}>
                                                    {indicator.name} / {indicator.symbol} / {indicator.timeframe}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                    <label className="block">
                                        <div className="text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">Binding Name</div>
                                        <input
                                            value={bindingDraft.name}
                                            onChange={(event) => setBindingDraft((current) => ({ ...current, name: event.target.value }))}
                                            className="mt-2 h-10 w-full rounded-2xl border border-border-muted bg-bg-secondary px-3 text-sm"
                                            disabled={!workspaceView.automationLane.enabled || mutating}
                                            placeholder="London Session Approval Flow"
                                        />
                                    </label>
                                    <label className="block">
                                        <div className="text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">Mode</div>
                                        <select
                                            value={bindingDraft.mode}
                                            onChange={(event) => setBindingDraft((current) => ({ ...current, mode: event.target.value as BindingDraft["mode"] }))}
                                            className="mt-2 h-10 w-full rounded-2xl border border-border-muted bg-bg-secondary px-3 text-sm"
                                            disabled={!workspaceView.automationLane.enabled || mutating}
                                        >
                                            <option value="OBSERVE">OBSERVE</option>
                                            <option value="MANUAL_APPROVAL">MANUAL_APPROVAL</option>
                                            <option value="AUTO_EXECUTE">
                                                {automation?.autoExecuteLocked ? "AUTO_EXECUTE (locked)" : "AUTO_EXECUTE"}
                                            </option>
                                        </select>
                                    </label>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <label className="flex items-center gap-2 rounded-2xl border border-border-muted bg-bg-secondary px-3 py-2 text-sm text-text-primary">
                                            <input
                                                type="checkbox"
                                                checked={bindingDraft.approvalRequired}
                                                onChange={(event) => setBindingDraft((current) => ({ ...current, approvalRequired: event.target.checked }))}
                                                disabled={!workspaceView.automationLane.enabled || mutating}
                                            />
                                            Approval required
                                        </label>
                                        <label className="flex items-center gap-2 rounded-2xl border border-border-muted bg-bg-secondary px-3 py-2 text-sm text-text-primary">
                                            <input
                                                type="checkbox"
                                                checked={bindingDraft.killSwitchActive}
                                                onChange={(event) => setBindingDraft((current) => ({ ...current, killSwitchActive: event.target.checked }))}
                                                disabled={!workspaceView.automationLane.enabled || mutating}
                                            />
                                            Start with kill switch
                                        </label>
                                    </div>
                                    {/* Risk — guided form */}
                                    <div className="space-y-3 rounded-2xl border border-border-muted bg-bg-tertiary/40 p-3">
                                        <div className="text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">Risk Config</div>
                                        <label className="block">
                                            <div className="flex items-center justify-between text-[11px] text-text-secondary">
                                                <span>Risk per trade</span>
                                                <span className="font-black text-text-primary">{bindingDraft.riskPercent.toFixed(1)}%</span>
                                            </div>
                                            <input
                                                type="range" min={0.1} max={5} step={0.1}
                                                value={bindingDraft.riskPercent}
                                                onChange={(e) => {
                                                    const v = Number(e.target.value);
                                                    setBindingDraft((c) => ({ ...c, riskPercent: v, maxDailyLossPct: Math.round(v * 3 * 10) / 10 }));
                                                }}
                                                className="mt-1.5 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-border-muted accent-accent"
                                                disabled={!workspaceView.automationLane.enabled || mutating}
                                            />
                                        </label>
                                        <label className="flex items-center justify-between gap-3">
                                            <span className="text-[11px] text-text-secondary">Max open positions</span>
                                            <input
                                                type="number" min={1} max={10}
                                                value={bindingDraft.maxOpenPositions}
                                                onChange={(e) => setBindingDraft((c) => ({ ...c, maxOpenPositions: Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1)) }))}
                                                className="w-16 rounded-xl border border-border-muted bg-bg-secondary px-2 py-1 text-sm font-black text-text-primary focus:border-accent focus:outline-none"
                                                disabled={!workspaceView.automationLane.enabled || mutating}
                                            />
                                        </label>
                                    </div>

                                    {/* Guardrails — guided form */}
                                    <div className="space-y-3 rounded-2xl border border-border-muted bg-bg-tertiary/40 p-3">
                                        <div className="text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">Guardrails</div>
                                        <label className="flex items-center justify-between gap-3">
                                            <span className="text-[11px] text-text-secondary">Max daily loss %</span>
                                            <input
                                                type="number" min={0.1} max={50} step={0.1}
                                                value={bindingDraft.maxDailyLossPct}
                                                onChange={(e) => setBindingDraft((c) => ({ ...c, maxDailyLossPct: Math.max(0.1, parseFloat(e.target.value) || 3) }))}
                                                className="w-20 rounded-xl border border-border-muted bg-bg-secondary px-2 py-1 text-sm font-black text-text-primary focus:border-accent focus:outline-none"
                                                disabled={!workspaceView.automationLane.enabled || mutating}
                                            />
                                        </label>
                                        <label className="flex items-center justify-between gap-3">
                                            <span className="text-[11px] text-text-secondary">Kill switch drawdown %</span>
                                            <input
                                                type="number" min={5} max={50} step={1}
                                                value={bindingDraft.killSwitchDrawdownPct}
                                                onChange={(e) => setBindingDraft((c) => ({ ...c, killSwitchDrawdownPct: Math.max(5, parseFloat(e.target.value) || 15) }))}
                                                className="w-20 rounded-xl border border-border-muted bg-bg-secondary px-2 py-1 text-sm font-black text-text-primary focus:border-accent focus:outline-none"
                                                disabled={!workspaceView.automationLane.enabled || mutating}
                                            />
                                        </label>
                                    </div>

                                    {/* Filters + Advanced JSON escape hatch */}
                                    <details
                                        open={bindingDraft.showAdvancedJson}
                                        onToggle={(e) => setBindingDraft((c) => ({ ...c, showAdvancedJson: (e.target as HTMLDetailsElement).open }))}
                                    >
                                        <summary className="cursor-pointer select-none text-[11px] font-bold text-text-muted hover:text-text-secondary">
                                            Advanced: filters + raw JSON override
                                        </summary>
                                        <div className="mt-3 space-y-3">
                                            <label className="block">
                                                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">Filters JSON</div>
                                                <textarea
                                                    value={bindingDraft.filtersJson}
                                                    onChange={(event) => setBindingDraft((current) => ({ ...current, filtersJson: event.target.value }))}
                                                    className="mt-2 min-h-16 w-full rounded-2xl border border-border-muted bg-bg-secondary px-3 py-2 text-sm"
                                                    disabled={!workspaceView.automationLane.enabled || mutating}
                                                    placeholder='{"session":"london"}'
                                                />
                                            </label>
                                            <label className="block">
                                                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">Risk Config JSON (overrides sliders)</div>
                                                <textarea
                                                    value={bindingDraft.riskConfigJson}
                                                    onChange={(event) => setBindingDraft((current) => ({ ...current, riskConfigJson: event.target.value }))}
                                                    className="mt-2 min-h-16 w-full rounded-2xl border border-border-muted bg-bg-secondary px-3 py-2 text-sm"
                                                    disabled={!workspaceView.automationLane.enabled || mutating}
                                                    placeholder='{"riskPercent":0.5,"maxOpenPositions":1}'
                                                />
                                            </label>
                                            <label className="block">
                                                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">Guardrails JSON (overrides fields)</div>
                                                <textarea
                                                    value={bindingDraft.guardrailsJson}
                                                    onChange={(event) => setBindingDraft((current) => ({ ...current, guardrailsJson: event.target.value }))}
                                                    className="mt-2 min-h-16 w-full rounded-2xl border border-border-muted bg-bg-secondary px-3 py-2 text-sm"
                                                    disabled={!workspaceView.automationLane.enabled || mutating}
                                                    placeholder='{"maxOpenPositions":1,"maxDailyLossPct":3,"killSwitchDrawdownPct":15}'
                                                />
                                            </label>
                                        </div>
                                    </details>
                                    <button
                                        type="submit"
                                        disabled={!workspaceView.automationLane.enabled || mutating || !automation?.availableIndicators.length}
                                        className="w-full rounded-full bg-accent px-4 py-2.5 text-sm font-black text-bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        Create Binding
                                    </button>
                                </form>
                                <div className="space-y-4">
                                    <div className="space-y-3 rounded-3xl border border-border-muted bg-bg-tertiary/20 p-4">
                                        <div className="flex items-center justify-between gap-3">
                                            <div>
                                                <div className="text-xs font-black uppercase tracking-[0.16em] text-text-muted">Active Binding State</div>
                                                <div className="mt-1 text-sm text-text-secondary">
                                                    {automation?.pendingApprovalCount ?? 0} item(s) currently waiting for approval.
                                                </div>
                                            </div>
                                            <div className="rounded-full border border-border-muted bg-bg-secondary px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-text-secondary">
                                                {automation?.bindings.length ?? 0} bindings
                                            </div>
                                        </div>

                                        {automation?.bindings.map((binding) => (
                                            <article
                                                key={binding.id}
                                                className={`rounded-2xl border p-4 ${selectedBinding?.id === binding.id ? "border-accent/30 bg-accent/5" : "border-border-muted bg-bg-secondary/60"}`}
                                            >
                                                <div className="flex items-start justify-between gap-3">
                                                    <button
                                                        type="button"
                                                        onClick={() => setSelection({ kind: "binding", id: binding.id })}
                                                        className="text-left"
                                                    >
                                                        <div className="text-sm font-black text-text-primary">{binding.name}</div>
                                                        <div className="mt-1 text-xs text-text-secondary">
                                                            {binding.indicatorName} / {binding.symbol} / {binding.timeframe}
                                                        </div>
                                                    </button>
                                                    <span className="rounded-full border border-border-muted bg-bg-tertiary px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-text-secondary">
                                                        {binding.status}
                                                    </span>
                                                </div>
                                                <div className="mt-3 flex flex-wrap gap-2">
                                                    <RowActionButton
                                                        label="Inspect"
                                                        onClick={() => setSelection({ kind: "binding", id: binding.id })}
                                                    />
                                                    <RowActionButton
                                                        label="Approve"
                                                        disabled={!workspaceView.automationLane.enabled || mutating}
                                                        onClick={() => {
                                                            void handleBindingStatus(binding, "ACTIVE");
                                                        }}
                                                    />
                                                    <RowActionButton
                                                        label={binding.killSwitchActive ? "Clear Kill" : "Kill Switch"}
                                                        disabled={!workspaceView.automationLane.enabled || mutating}
                                                        onClick={() => {
                                                            void handleBindingStatus(binding, binding.status as "PENDING_APPROVAL" | "ACTIVE" | "PAUSED" | "ARCHIVED", !binding.killSwitchActive);
                                                        }}
                                                    />
                                                    <RowActionButton
                                                        label="Pause"
                                                        disabled={!workspaceView.automationLane.enabled || mutating}
                                                        onClick={() => {
                                                            void handleBindingStatus(binding, "PAUSED");
                                                        }}
                                                    />
                                                    <RowActionButton
                                                        label="Archive"
                                                        disabled={!workspaceView.automationLane.enabled || mutating}
                                                        onClick={() => {
                                                            void handleBindingStatus(binding, "ARCHIVED");
                                                        }}
                                                    />
                                                </div>
                                            </article>
                                        ))}

                                        {automation?.bindings.length === 0 ? (
                                            <EmptySurface
                                                title="No automation bindings"
                                                detail="Approved indicator instances can be attached to the MT5 account here without hiding manual trading or monitoring surfaces."
                                            />
                                        ) : null}
                                    </div>

                                    <div className="space-y-3 rounded-3xl border border-border-muted bg-bg-tertiary/20 p-4">
                                        <div className="flex items-center justify-between gap-3">
                                            <div>
                                                <div className="text-xs font-black uppercase tracking-[0.16em] text-text-muted">Recent Worker Intents</div>
                                                <div className="mt-1 text-sm text-text-secondary">
                                                    Paper auto-execution attempts stay visible here even when command execution is rejected or fails closed.
                                                </div>
                                            </div>
                                            <div className="rounded-full border border-border-muted bg-bg-secondary px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-text-secondary">
                                                {intents.length} intents
                                            </div>
                                        </div>

                                        {intents.map((intent) => (
                                            <article
                                                key={intent.id}
                                                className={`rounded-2xl border p-4 ${selectedIntent?.id === intent.id ? "border-accent/30 bg-accent/5" : "border-border-muted bg-bg-secondary/60"}`}
                                            >
                                                <div className="flex items-start justify-between gap-3">
                                                    <button
                                                        type="button"
                                                        onClick={() => setSelection({ kind: "intent", id: intent.id })}
                                                        className="text-left"
                                                    >
                                                        <div className="text-sm font-black text-text-primary">{intent.bindingName}</div>
                                                        <div className="mt-1 text-xs text-text-secondary">
                                                            {intent.symbol} / {intent.side ?? "n/a"} / {intent.eventType} / {formatDateTime(intent.createdAt)}
                                                        </div>
                                                    </button>
                                                    <span className="rounded-full border border-border-muted bg-bg-tertiary px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-text-secondary">
                                                        {intent.status}
                                                    </span>
                                                </div>
                                                <div className="mt-2 text-xs text-text-secondary">
                                                    Command {intent.executionCommandStatus ?? "pending"} / Volume {formatNumber(intent.volume, 2)} / Entry {formatNumber(intent.entryPrice, 5)}
                                                </div>
                                                {intent.statusReason ? (
                                                    <div className="mt-3 rounded-xl border border-border-muted bg-bg-tertiary/30 px-3 py-2 text-xs text-text-secondary">
                                                        {intent.statusReason}
                                                    </div>
                                                ) : null}
                                                <div className="mt-3 flex flex-wrap gap-2">
                                                    <RowActionButton
                                                        label="Inspect"
                                                        onClick={() => setSelection({ kind: "intent", id: intent.id })}
                                                    />
                                                </div>
                                            </article>
                                        ))}

                                        {intents.length === 0 ? (
                                            <EmptySurface
                                                title="No worker intents yet"
                                                detail="When a live indicator emits a supported ENTRY signal for an active paper AUTO_EXECUTE binding, the queued worker intent will appear here."
                                            />
                                        ) : null}
                                    </div>
                                </div>
                            </div>
                        </SectionCard>
                    ) : null}

                    {activeTab === "external" ? (
                        <div className="space-y-5">
                            <TradingExternalDeploymentPanel
                                enabled={readEnabled}
                                writeEnabled={writeEnabled}
                                status={externalStatus}
                                deployments={externalDeployments}
                                indicatorCandidates={automation?.availableIndicators ?? []}
                                error={externalError}
                                refreshing={externalRefreshing}
                                mutating={externalMutating}
                                selectedDeploymentId={selectedExternalDeploymentId}
                                onSelectDeployment={setSelectedExternalDeploymentId}
                                onRefresh={refreshExternalActions}
                                onCreate={createDeployment}
                                onEnable={enableDeployment}
                                onPause={pauseDeployment}
                                onArchive={archiveDeployment}
                            />
                            <TradingExternalActionAuditPanel
                                enabled={readEnabled}
                                writeEnabled={writeEnabled}
                                status={externalStatus}
                                deployments={externalDeployments}
                                events={externalEvents}
                                deliveries={externalDeliveries}
                                error={externalError}
                                refreshing={externalRefreshing}
                                mutating={externalMutating}
                                selectedDeploymentId={selectedExternalDeploymentId}
                                onSelectDeployment={setSelectedExternalDeploymentId}
                                onRefresh={refreshExternalActions}
                                onReplay={replayEvent}
                            />
                        </div>
                    ) : null}

                    {activeTab === "audit" ? (
                        <SectionCard
                            title="Command & Sync Audit"
                            description="Execution audit"
                            icon={<TerminalSquare className="h-5 w-5" />}
                        >
                            <div className="grid gap-5 lg:grid-cols-2">
                                <div className="space-y-3 rounded-3xl border border-border-muted bg-bg-tertiary/20 p-4">
                                    <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-text-muted">
                                        <TerminalSquare className="h-3.5 w-3.5" />
                                        Commands
                                    </div>
                                    {commands.map((command) => (
                                        <button
                                            key={command.id}
                                            type="button"
                                            onClick={() => setSelection({ kind: "command", id: command.id })}
                                            className={`flex w-full items-start justify-between gap-3 rounded-2xl border px-3 py-3 text-left ${selectedCommand?.id === command.id ? "border-accent/30 bg-accent/5" : "border-border-muted bg-bg-secondary/70"}`}
                                        >
                                            <div>
                                                <div className="text-sm font-black text-text-primary">{command.commandType}</div>
                                                <div className="mt-1 text-xs text-text-secondary">
                                                    {formatDateTime(command.requestedAt)} / {command.symbol ?? command.brokerPositionId ?? command.brokerOrderId ?? "account-wide"}
                                                </div>
                                            </div>
                                            <span className="rounded-full border border-border-muted bg-bg-tertiary px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-text-secondary">
                                                {command.status}
                                            </span>
                                        </button>
                                    ))}
                                    {commands.length === 0 ? (
                                        <EmptySurface
                                            title="No command audit entries"
                                            detail="Force syncs and manual broker actions will create lifecycle records here."
                                        />
                                    ) : null}
                                </div>

                                <div className="space-y-3 rounded-3xl border border-border-muted bg-bg-tertiary/20 p-4">
                                    <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-text-muted">
                                        <RefreshCcw className="h-3.5 w-3.5" />
                                        Sync Runs
                                    </div>
                                    {workspace.syncRuns.map((syncRun) => (
                                        <button
                                            key={syncRun.id}
                                            type="button"
                                            onClick={() => setSelection({ kind: "sync", id: syncRun.id })}
                                            className={`flex w-full items-start justify-between gap-3 rounded-2xl border px-3 py-3 text-left ${selectedSyncRun?.id === syncRun.id ? "border-accent/30 bg-accent/5" : "border-border-muted bg-bg-secondary/70"}`}
                                        >
                                            <div>
                                                <div className="text-sm font-black text-text-primary">{syncRun.syncKind}</div>
                                                <div className="mt-1 text-xs text-text-secondary">{formatDateTime(syncRun.startedAt)}</div>
                                            </div>
                                            <span className="rounded-full border border-border-muted bg-bg-tertiary px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-text-secondary">
                                                {syncRun.status}
                                            </span>
                                        </button>
                                    ))}
                                    {workspace.syncRuns.length === 0 ? (
                                        <EmptySurface
                                            title="No sync audit entries"
                                            detail="Sync attempts will be recorded here once the account mirror starts reconciling against MT5."
                                        />
                                    ) : null}
                                </div>
                            </div>

                            <Link
                                href="/trading/history"
                                className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-border-muted bg-bg-tertiary px-3 py-1.5 text-xs font-bold text-text-primary transition-colors hover:border-accent hover:text-accent"
                            >
                                <History className="h-3 w-3" />
                                Open Trade History & Audit Timeline
                            </Link>
                        </SectionCard>
                    ) : null}
                </div>

                <aside className="space-y-5 2xl:sticky 2xl:top-3 2xl:self-start">
                    {detailRail}
                    <SectionCard
                        title="History Metrics"
                        description="History metrics"
                        variant="compact"
                        icon={<History className="h-4 w-4" />}
                    >
                        <div className="space-y-3">
                            <div className="rounded-2xl border border-border-muted bg-bg-tertiary/35 px-4 py-3 text-sm text-text-secondary">
                                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">History Range</div>
                                <div className="mt-2 font-black text-text-primary">{historyMetrics.rangeLabel}</div>
                                <div className="mt-1 text-xs leading-5">{historyMetrics.sourceLabel}</div>
                            </div>
                            <MetricCard
                                label="Win Rate"
                                value={formatPercent(historyMetrics.winRate)}
                                detail={`${historyMetrics.wins}W / ${historyMetrics.losses}L / ${historyMetrics.flat} flat`}
                                accent={historyMetrics.winRate === null ? "neutral" : historyMetrics.winRate >= 50 ? "up" : "down"}
                            />
                            <MetricCard
                                label="PnL"
                                value={formatSignedCurrency(historyMetrics.netPnl, workspace?.summary.baseCurrency ?? null)}
                                detail={`${historyMetrics.shownDeals} mirrored deal(s) shown`}
                                accent={historyMetrics.pnlAccent}
                            />
                            <MetricCard
                                label="Volume"
                                value={formatNumber(historyMetrics.totalVolume, 2)}
                                detail={activeTab === "history"
                                    ? "Updates immediately when the History UTC range changes."
                                    : "Open History to change the UTC range used for these metrics."}
                            />
                            <div className="rounded-2xl border border-border-muted bg-bg-tertiary/25 px-4 py-3 text-xs leading-5 text-text-secondary">
                                Account: <span className="font-black text-text-primary">{workspace?.summary.accountLabel ?? "n/a"}</span>
                                {" / "}
                                Chart context: <span className="font-black text-text-primary">{marketSymbol} / {timeframe}</span>
                            </div>
                        </div>
                    </SectionCard>
                </aside>
            </div>
        </section>,
    );
}
